// Playback engine — Tone.js. Sounding pitches straight to frequencies; no samples, no network.
// Tone is imported lazily so this module stays importable in Node/vitest (no AudioContext at load time).
import { DUR_TICKS, TIME_TICKS, type Dynamic, type Measure, type Part, type Score, type Section } from '../core/types';
import { findInstrument } from '../core/instruments';
import { isRest, pitchToMidi } from '../core/pitch';
import type { Gain, Reverb } from 'tone';

export interface PlayOptions {
  /** 0-based bar to start at. */
  from?: number;
  /** 0-based bar to stop after (inclusive). */
  to?: number;
  /** Part ids to play; omit for all unmuted parts. */
  parts?: string[];
  loop?: boolean;
}

export interface CursorPos {
  measure: number;
  tick: number;
}

export interface Player {
  /** Browsers only start audio after a gesture. Call from a click handler. Returns true when audio is running. */
  unlock(): Promise<boolean>;
  /** True once the audio context is running. */
  armed(): boolean;
  play(score: Score, opts?: PlayOptions): Promise<void>;
  /** Play a candidate passage in place of the part's own bars, for A/B choices. */
  playVariant(score: Score, variant: { partId: string; from: number; measures: Measure[] }, opts?: PlayOptions): Promise<void>;
  stop(): void;
  isPlaying(): boolean;
  onCursor(fn: (pos: CursorPos | null) => void): () => void;
}

// ---------------------------------------------------------------------------
// Schedule building — pure, testable, no audio.
// ---------------------------------------------------------------------------

/** One sounding event, positioned in ticks from the first played bar. */
export interface ScheduledNote {
  partId: string;
  /** Ticks from the start of the played range. */
  startTick: number;
  /** Notated length in ticks (ties already merged). */
  durTicks: number;
  /** Length actually held, after articulation. */
  holdTicks: number;
  midi: number;
  /** 0..1 */
  velocity: number;
}

export interface Schedule {
  from: number;
  to: number;
  barTicks: number;
  /** Length of the run in ticks, including a note that overhangs the last bar. */
  totalTicks: number;
  secPerTick: number;
  tempo: number;
  parts: Part[];
  notes: ScheduledNote[];
}

const DYN_VEL: Record<Dynamic, number> = { pp: 0.22, p: 0.34, mp: 0.48, mf: 0.62, f: 0.78, ff: 0.95 };
const DEFAULT_DYN: Dynamic = 'mf';

function clamp(n: number, lo: number, hi: number): number {
  return n < lo ? lo : n > hi ? hi : n;
}

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (clamp(midi, 0, 127) - 69) / 12);
}

interface RawEvent {
  start: number;
  dur: number;
  midi: number;
  dyn: Dynamic;
  art?: 'staccato' | 'accent' | 'tenuto';
  tie: boolean;
}

/**
 * Flatten a score into absolute-tick note events.
 * Bars are laid out on the nominal bar grid (bar n starts at n * TIME_TICKS), so a malformed
 * bar in one part never drags the other parts out of sync — the checker flags it instead.
 */
export function buildSchedule(score: Score, opts: PlayOptions = {}): Schedule {
  const barTicks = TIME_TICKS[score.time] ?? 1920;
  const bars = score.parts.reduce((n, p) => Math.max(n, p.measures.length), 0);
  const last = Math.max(0, bars - 1);
  const from = clamp(Math.floor(opts.from ?? 0), 0, last);
  const to = clamp(Math.floor(opts.to ?? last), from, last);
  const tempo = clamp(Number(score.tempo) || 100, 20, 400);
  const secPerTick = 60 / (tempo * DUR_TICKS.q);

  const wanted = opts.parts && opts.parts.length ? new Set(opts.parts) : null;
  const parts = score.parts.filter((p) => (wanted ? wanted.has(p.id) : !p.muted));

  const notes: ScheduledNote[] = [];
  let totalTicks = bars > 0 ? (to - from + 1) * barTicks : 0;

  for (const part of parts) {
    // Dynamics carry forward from earlier in the part, even from before the played range.
    let dyn: Dynamic = DEFAULT_DYN;
    for (let b = 0; b < from; b++) {
      for (const n of part.measures[b]?.notes ?? []) if (n.dyn) dyn = n.dyn;
    }

    const raw: RawEvent[] = [];
    for (let b = from; b <= to; b++) {
      const m = part.measures[b];
      if (!m) continue;
      let t = (b - from) * barTicks;
      for (const n of m.notes) {
        const d = DUR_TICKS[n.dur] ?? 0;
        if (n.dyn) dyn = n.dyn;
        if (!isRest(n.pitch)) {
          const midi = pitchToMidi(n.pitch);
          if (midi !== null) raw.push({ start: t, dur: d, midi, dyn, art: n.art, tie: !!n.tie });
        }
        t += d;
      }
    }

    // Ties merge into one longer note: same pitch, and the next note starts exactly where this one ends.
    const merged: RawEvent[] = [];
    for (const ev of raw) {
      const prev = merged[merged.length - 1];
      if (prev && prev.tie && prev.midi === ev.midi && Math.abs(prev.start + prev.dur - ev.start) < 1) {
        prev.dur += ev.dur;
        prev.tie = ev.tie;
        if (!prev.art) prev.art = ev.art;
        continue;
      }
      merged.push({ ...ev });
    }

    for (const ev of merged) {
      const base = DYN_VEL[ev.dyn] ?? DYN_VEL[DEFAULT_DYN];
      const velocity = clamp(ev.art === 'accent' ? base * 1.3 : base, 0.05, 1);
      const ratio = ev.art === 'staccato' ? 0.5 : ev.art === 'tenuto' ? 1 : 0.92;
      const holdTicks = Math.max(Math.min(ev.dur, 40), ev.dur * ratio);
      notes.push({ partId: part.id, startTick: ev.start, durTicks: ev.dur, holdTicks, midi: ev.midi, velocity });
      totalTicks = Math.max(totalTicks, ev.start + ev.dur);
    }
  }

  notes.sort((a, b) => a.startTick - b.startTick);
  return { from, to, barTicks, totalTicks, secPerTick, tempo, parts, notes };
}

/** A copy of the score with `variant.measures` substituted into one part. Never mutates the input. */
export function withVariant(score: Score, variant: { partId: string; from: number; measures: Measure[] }): Score {
  const idx = score.parts.findIndex((p) => p.id === variant.partId);
  if (idx < 0) return score;
  const part = score.parts[idx];
  const measures = part.measures.slice();
  const at = Math.max(0, Math.floor(variant.from));
  for (let i = 0; i < variant.measures.length; i++) measures[at + i] = variant.measures[i];
  for (let i = 0; i < measures.length; i++) if (!measures[i]) measures[i] = { notes: [] };
  const parts = score.parts.slice();
  parts[idx] = { ...part, measures, muted: false };
  return { ...score, parts };
}

// ---------------------------------------------------------------------------
// Voices — one light synth per part, by section.
// ---------------------------------------------------------------------------

type ToneModule = typeof import('tone');

interface Voice {
  trigger(freq: number, dur: number, time: number, vel: number): void;
  release(): void;
  dispose(): void;
}

const SECTION_DB: Record<Section, number> = {
  woodwind: -13,
  brass: -16,
  string: -12,
  voice: -14,
  keyboard: -12,
  percussion: -17,
};

const HINTS: Array<[RegExp, Section]> = [
  [/drum|snare|cymbal|hi-?hat|tambourin|shaker|clave|castanet|conga|bongo|gong|tam-?tam|maraca|guiro|cabasa|woodblock|cowbell|perc/, 'percussion'],
  [/glockenspiel|xylophone|marimba|vibraphone|timpani|chime|bell|mallet/, 'percussion'],
  [/flute|piccolo|clarinet|oboe|bassoon|sax|recorder|english horn/, 'woodwind'],
  [/trumpet|horn|trombone|tuba|euphonium|cornet|flugel|brass/, 'brass'],
  [/violin|viola|cello|contrabass|double ?bass|harp|guitar|string/, 'string'],
  [/voice|vocal|choir|soprano|mezzo|tenor|baritone|chorus|sing/, 'voice'],
  [/piano|keyboard|organ|celesta|synth|rhodes/, 'keyboard'],
];

const UNPITCHED = /drum|snare|cymbal|hi-?hat|tambourin|shaker|clave|castanet|conga|bongo|gong|tam-?tam|maraca|guiro|cabasa|woodblock|cowbell|triangle/;
const NOISY = /snare|cymbal|hi-?hat|tambourin|shaker|clave|castanet|maraca|guiro|cabasa|woodblock|cowbell|triangle|gong|tam-?tam/;

function voiceKind(part: Part): { section: Section; unpitched: boolean; hint: string } {
  const hint = `${part.instrumentId} ${part.label}`.toLowerCase();
  const inst = findInstrument(part.instrumentId);
  if (inst) return { section: inst.section, unpitched: !!inst.unpitched, hint };
  for (const [re, section] of HINTS) if (re.test(hint)) return { section, unpitched: UNPITCHED.test(hint), hint };
  return { section: 'woodwind', unpitched: false, hint };
}

function makeVoice(T: ToneModule, part: Part, dest: Gain, trimDb: number): Voice {
  const { section, unpitched, hint } = voiceKind(part);
  const db = (SECTION_DB[section] ?? -13) + trimDb;

  if (section === 'percussion' && unpitched) {
    if (NOISY.test(hint)) {
      const noise = new T.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.05 },
      });
      noise.volume.value = db - 4;
      noise.connect(dest);
      return {
        trigger: (_f, dur, time, vel) => noise.triggerAttackRelease(Math.min(dur, 0.22), time, vel),
        release: () => noise.triggerRelease(),
        dispose: () => noise.dispose(),
      };
    }
    const drum = new T.MembraneSynth({
      pitchDecay: 0.035,
      octaves: 5,
      envelope: { attack: 0.001, decay: 0.32, sustain: 0, release: 0.2 },
    });
    drum.volume.value = db;
    drum.connect(dest);
    return {
      trigger: (_f, dur, time, vel) => drum.triggerAttackRelease(65.41, Math.min(dur, 0.5), time, vel),
      release: () => drum.triggerRelease(),
      dispose: () => drum.dispose(),
    };
  }

  let poly: InstanceType<ToneModule['PolySynth']>;
  let color: InstanceType<ToneModule['Vibrato']> | null = null;

  if (section === 'brass') {
    poly = new T.PolySynth(T.Synth, {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 18 },
      envelope: { attack: 0.028, decay: 0.14, sustain: 0.78, release: 0.24 },
    } as never);
    color = new T.Vibrato({ frequency: 5.4, depth: 0.05 });
  } else if (section === 'string') {
    poly = new T.PolySynth(T.AMSynth, {
      harmonicity: 2.2,
      oscillator: { type: 'sine' },
      envelope: { attack: 0.13, decay: 0.25, sustain: 0.92, release: 0.8 },
      modulation: { type: 'square' },
      modulationEnvelope: { attack: 0.4, decay: 0.1, sustain: 1, release: 0.5 },
    } as never);
  } else if (section === 'voice') {
    poly = new T.PolySynth(T.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 0.085, decay: 0.2, sustain: 0.86, release: 0.5 },
    } as never);
    color = new T.Vibrato({ frequency: 5.1, depth: 0.11 });
  } else if (section === 'keyboard' || section === 'percussion') {
    // Keyboards and pitched percussion (mallets, timpani): struck, quick decay.
    poly = new T.PolySynth(T.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.004, decay: 0.45, sustain: 0.16, release: 0.6 },
    } as never);
  } else {
    // woodwind: soft attack, sustained.
    poly = new T.PolySynth(T.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.055, decay: 0.16, sustain: 0.76, release: 0.4 },
    } as never);
  }

  poly.maxPolyphony = 6;
  poly.volume.value = db;
  if (color) {
    poly.connect(color);
    color.connect(dest);
  } else {
    poly.connect(dest);
  }

  let dead = false;
  return {
    trigger: (freq, dur, time, vel) => {
      if (dead) return;
      poly.triggerAttackRelease(freq, Math.max(0.03, dur), time, vel);
    },
    release: () => {
      if (!dead) poly.releaseAll();
    },
    dispose: () => {
      dead = true;
      poly.dispose();
      color?.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

let Tone: ToneModule | null = null;
let loading: Promise<ToneModule | null> | null = null;

async function loadTone(): Promise<ToneModule | null> {
  if (Tone) return Tone;
  if (!loading) {
    loading = import('tone')
      .then((m) => {
        Tone = m;
        return m;
      })
      .catch(() => null);
  }
  return loading;
}

const listeners = new Set<(pos: CursorPos | null) => void>();
let playing = false;
let runToken = 0;
let liveVoices: Voice[] = [];
let finishRun: (() => void) | null = null;
let safety: ReturnType<typeof setTimeout> | null = null;
let master: Gain | null = null;
let verb: Reverb | null = null;
let verbReady: Promise<void> = Promise.resolve();

function emit(pos: CursorPos | null): void {
  for (const fn of Array.from(listeners)) {
    try {
      fn(pos);
    } catch {
      /* a listener throwing must not stop the music */
    }
  }
}

function armedNow(): boolean {
  if (!Tone) return false;
  try {
    return Tone.getContext().state === 'running';
  } catch {
    return false;
  }
}

function ensureRig(T: ToneModule): Gain {
  if (master && verb) return master;
  verb = new T.Reverb({ decay: 1.7, preDelay: 0.012, wet: 0.16 });
  verbReady = verb.ready.catch(() => undefined) as Promise<void>;
  verb.toDestination();
  master = new T.Gain(0.85);
  master.connect(verb);
  return master;
}

function teardown(silent = false): void {
  runToken++;
  if (safety !== null) {
    clearTimeout(safety);
    safety = null;
  }
  if (Tone) {
    try {
      const tr = Tone.getTransport();
      tr.stop();
      tr.cancel(0);
      tr.loop = false;
    } catch {
      /* transport may not exist outside a browser */
    }
    try {
      Tone.getDraw().cancel();
    } catch {
      /* no draw queue */
    }
  }
  const dying = liveVoices;
  liveVoices = [];
  for (const v of dying) {
    try {
      v.release();
    } catch {
      /* already gone */
    }
  }
  if (dying.length) {
    // Let the release tail ring, then free the nodes so polyphony never accumulates.
    setTimeout(() => {
      for (const v of dying) {
        try {
          v.dispose();
        } catch {
          /* already disposed */
        }
      }
    }, 320);
  }
  playing = false;
  const done = finishRun;
  finishRun = null;
  if (done) done();
  if (!silent) emit(null);
}

async function startRun(score: Score, opts: PlayOptions): Promise<void> {
  teardown(true);
  const T = Tone;
  if (!T || !armedNow()) return;

  const token = ++runToken;
  const sched = buildSchedule(score, opts);
  if (sched.totalTicks <= 0 || sched.parts.length === 0) return;

  const dest = ensureRig(T);
  await verbReady;
  if (token !== runToken) return;

  const { secPerTick, barTicks, from, to } = sched;
  const rangeSec = (to - from + 1) * barTicks * secPerTick;
  const totalSec = sched.totalTicks * secPerTick;

  let transport: ReturnType<ToneModule['getTransport']>;
  try {
    transport = T.getTransport();
    transport.stop();
    transport.cancel(0);
    transport.bpm.value = sched.tempo;
    transport.seconds = 0;
  } catch {
    return;
  }

  // One voice per part, trimmed so a big ensemble does not clip.
  const trimDb = -Math.min(9, 6 * Math.log10(Math.max(1, sched.parts.length)));
  const voices = new Map<string, Voice>();
  for (const part of sched.parts) {
    try {
      voices.set(part.id, makeVoice(T, part, dest, trimDb));
    } catch {
      /* a synth that refuses to build simply stays silent */
    }
  }
  liveVoices = Array.from(voices.values());

  for (const n of sched.notes) {
    const voice = voices.get(n.partId);
    if (!voice) continue;
    const at = n.startTick * secPerTick;
    const dur = Math.max(0.03, n.holdTicks * secPerTick);
    const hz = midiToHz(n.midi);
    const vel = n.velocity;
    transport.schedule((time) => voice.trigger(hz, dur, time, vel), at);
  }

  const posAt = (sec: number): CursorPos => {
    let s = sec;
    if (opts.loop && rangeSec > 0) s = ((s % rangeSec) + rangeSec) % rangeSec;
    const ticks = Math.max(0, Math.round(s / secPerTick));
    const measure = clamp(from + Math.floor(ticks / barTicks), from, to);
    return { measure, tick: clamp(ticks % barTicks, 0, barTicks - 1) };
  };

  transport.scheduleRepeat(
    (time) => {
      let sec: number;
      try {
        sec = transport.getSecondsAtTime(time);
      } catch {
        sec = transport.seconds;
      }
      const pos = posAt(sec);
      try {
        T.getDraw().schedule(() => {
          if (token === runToken) emit(pos);
        }, time);
      } catch {
        if (token === runToken) emit(pos);
      }
    },
    '16n',
    0,
  );

  if (opts.loop) {
    transport.loop = true;
    transport.loopStart = 0;
    transport.loopEnd = rangeSec;
  } else {
    transport.loop = false;
    // End of the run: clean up outside the transport callback so the timeline is not mutated mid-drain.
    transport.schedule(() => {
      setTimeout(() => {
        if (token === runToken) teardown();
      }, 20);
    }, totalSec + 0.15);
  }

  playing = true;
  transport.start('+0.06');
  emit({ measure: from, tick: 0 });

  if (opts.loop) return;

  // Wall-clock backstop: a throttled tab can starve the transport callback, and the caller
  // (ask_human A/B, mostly) must never be left awaiting forever.
  safety = setTimeout(
    () => {
      if (token === runToken) teardown();
    },
    (totalSec + 2) * 1000,
  );

  return new Promise<void>((resolve) => {
    finishRun = resolve;
  });
}

export const player: Player = {
  async unlock() {
    const T = await loadTone();
    if (!T) return false;
    try {
      await T.start();
    } catch {
      /* still suspended — the caller asks the person for a click */
    }
    return armedNow();
  },

  armed() {
    return armedNow();
  },

  async play(score, opts = {}) {
    await startRun(score, opts);
  },

  async playVariant(score, variant, opts = {}) {
    const merged = withVariant(score, variant);
    const bars = Math.max(1, variant.measures.length);
    const at = Math.max(0, Math.floor(variant.from));
    await startRun(merged, {
      ...opts,
      from: opts.from ?? at,
      to: opts.to ?? at + bars - 1,
    });
  },

  stop() {
    teardown();
  },

  isPlaying() {
    if (!playing || !Tone) return false;
    try {
      return Tone.getTransport().state === 'started';
    } catch {
      return false;
    }
  },

  onCursor(fn) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
