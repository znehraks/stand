// Stand — rule-based harmonization: the voicing draft an agent starts from and then edits by hand.
//
// The point of this module is that the first draft is always *playable*. Three guarantees, enforced
// here and asserted against the checker before anything is returned:
//   1. every bar it writes totals exactly TIME_TICKS[score.time];
//   2. every pitch it writes is a SOUNDING pitch inside that instrument's range at score.level —
//      chord tones are moved by octaves to fit, and when nothing fits the beat becomes a rest;
//   3. nothing it writes fails checkScore with an error.
//
// Bar indices here are 0-based (the store's convention); `to` is inclusive. The tool layer converts.

import { checkScore, validateWrite } from './check';
import { INSTRUMENTS, findInstrument, rangeFor } from './instruments';
import { isMinorKey, isRest, keyFifths, midiToPitch, pitchClassName, pitchToMidi } from './pitch';
import {
  DUR_TICKS,
  DURS,
  TIME_TICKS,
  type Dur,
  type Instrument,
  type Measure,
  type Note,
  type Part,
  type Score,
  type TimeSig,
} from './types';

export interface HarmonizeOptions {
  sourcePart: string;
  targetParts: string[];
  style: 'block' | 'pad' | 'countermelody';
  from?: number;
  to?: number;
}

export interface HarmonizeResult {
  measuresByPart: Record<string, Measure[]>;
  from: number;
  notes: string[];
}

// ---------------------------------------------------------------- chords

export type ChordQuality = 'major' | 'minor' | 'dominant7' | 'minor7' | 'diminished' | 'sus4';

export interface HarmonyChord {
  symbol: string;
  /** Pitch class 0–11. */
  root: number;
  quality: ChordQuality;
  /** Pitch class of a slash bass ('C/E' → 4), else null. */
  bass: number | null;
  /** Pitch classes, root first. */
  tones: number[];
  /** True when the melody, not a chord symbol, produced this chord. */
  inferred: boolean;
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function pcOf(name: string): number | null {
  const midi = pitchToMidi(`${name}4`);
  return midi === null ? null : mod12(midi);
}

function pcName(pc: number, fifths: number): string {
  return pitchClassName(midiToPitch(60 + mod12(pc), fifths));
}

/** 'C', 'Am', 'G7', 'Dm7', 'Bbdim', 'Csus4', 'C/E' → root, quality, tones. '' → null. */
export function parseChordSymbol(symbol: string): HarmonyChord | null {
  const raw = String(symbol ?? '').trim();
  if (!raw) return null;
  const slash = raw.indexOf('/');
  const head = slash >= 0 ? raw.slice(0, slash) : raw;
  const bassText = slash >= 0 ? raw.slice(slash + 1).trim() : '';
  const m = /^([A-Ga-g])([#b]{0,2})(.*)$/.exec(head.trim());
  if (!m) return null;
  const root = pcOf(m[1].toUpperCase() + m[2]);
  if (root === null) return null;
  const suffix = m[3].replace(/\s+/g, '');
  const low = suffix.toLowerCase();

  let quality: ChordQuality;
  let intervals: number[];
  if (low.startsWith('sus')) {
    quality = 'sus4';
    intervals = low.startsWith('sus2') ? [0, 2, 7] : [0, 5, 7];
  } else if (low.startsWith('dim') || low.startsWith('°') || low.startsWith('o') || low.startsWith('ø') || low.startsWith('m7b5')) {
    quality = 'diminished';
    intervals = /7|ø/.test(low) ? [0, 3, 6, low.includes('ø') || low.includes('b5') ? 10 : 9] : [0, 3, 6];
  } else if (low.startsWith('maj') || low.startsWith('ma7') || suffix.startsWith('Δ') || /^M(?![a-z])/.test(suffix)) {
    quality = 'major';
    intervals = /7|9/.test(low) ? [0, 4, 7, 11] : [0, 4, 7];
  } else if (/^(m|min|-)/.test(low)) {
    const seventh = /7|9|11|13/.test(low);
    quality = seventh ? 'minor7' : 'minor';
    intervals = seventh ? [0, 3, 7, 10] : [0, 3, 7];
  } else if (/^(7|9|11|13)/.test(low)) {
    quality = 'dominant7';
    intervals = [0, 4, 7, 10];
  } else if (low.startsWith('6')) {
    quality = 'major';
    intervals = [0, 4, 7, 9];
  } else {
    quality = 'major';
    intervals = [0, 4, 7];
  }

  const bass = bassText ? pcOf(bassText.replace(/[^A-Ga-g#b]/g, '')) : null;
  return {
    symbol: raw,
    root,
    quality,
    bass: bass === null ? null : mod12(bass),
    tones: intervals.map((i) => mod12(root + i)),
    inferred: false,
  };
}

const QUALITY_SUFFIX: Record<ChordQuality, string> = {
  major: '',
  minor: 'm',
  dominant7: '7',
  minor7: 'm7',
  diminished: 'dim',
  sus4: 'sus4',
};

interface Candidate {
  degree: number;
  quality: ChordQuality;
}

/** I, IV, V and vi of the key (i, iv, v, VI in minor) — the four chords a school melody lives on. */
function candidateChords(key: string): Candidate[] {
  return isMinorKey(key)
    ? [
        { degree: 0, quality: 'minor' },
        { degree: 5, quality: 'minor' },
        { degree: 7, quality: 'major' },
        { degree: 8, quality: 'major' },
      ]
    : [
        { degree: 0, quality: 'major' },
        { degree: 5, quality: 'major' },
        { degree: 7, quality: 'major' },
        { degree: 9, quality: 'minor' },
      ];
}

const TRIAD: Record<ChordQuality, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dominant7: [0, 4, 7, 10],
  minor7: [0, 3, 7, 10],
  diminished: [0, 3, 6],
  sus4: [0, 5, 7],
};

/** Best consonant fit among I / IV / V / vi for one bar of melody. Null when the bar is silent. */
export function inferChordFromMelody(key: string, notes: Note[], fifths: number): HarmonyChord | null {
  const sounding = (notes ?? []).filter((n) => !isRest(String(n.pitch ?? '')) && pitchToMidi(String(n.pitch)) !== null);
  if (!sounding.length) return null;
  const tonic = pcOf((/^([A-Ga-g][#b]?)/.exec(key.trim())?.[1] ?? 'C').toUpperCase()) ?? 0;
  let best: { cand: Candidate; score: number } | null = null;
  for (const cand of candidateChords(key)) {
    const root = mod12(tonic + cand.degree);
    const tones = TRIAD[cand.quality].map((i) => mod12(root + i));
    let score = 0;
    sounding.forEach((n, i) => {
      const midi = pitchToMidi(String(n.pitch));
      if (midi === null) return;
      const pc = mod12(midi);
      const weight = (DUR_TICKS[n.dur] ?? 240) * (i === 0 ? 1.5 : 1);
      if (pc === root) score += weight * 1.4;
      else if (tones.includes(pc)) score += weight;
      else score -= weight * 0.6;
    });
    if (!best || score > best.score) best = { cand, score };
  }
  if (!best) return null;
  const root = mod12(tonic + best.cand.degree);
  return {
    symbol: `${pcName(root, fifths)}${QUALITY_SUFFIX[best.cand.quality]}`,
    root,
    quality: best.cand.quality,
    bass: null,
    tones: TRIAD[best.cand.quality].map((i) => mod12(root + i)),
    inferred: true,
  };
}

// ---------------------------------------------------------------- rhythm helpers

const DESCENDING: Dur[] = DURS.slice().sort((a, b) => DUR_TICKS[b] - DUR_TICKS[a]);

/** Greedy split of a tick span into legal durations. Every TIME_TICKS value closes exactly. */
function spanDurs(ticks: number): Dur[] {
  const out: Dur[] = [];
  let left = Math.max(0, Math.round(ticks));
  for (const d of DESCENDING) {
    while (left >= DUR_TICKS[d]) {
      out.push(d);
      left -= DUR_TICKS[d];
    }
  }
  return out;
}

function rests(ticks: number): Note[] {
  return spanDurs(ticks).map((dur) => ({ pitch: 'r', dur }));
}

/** One pitch held for a span, tied across the durations it needs. */
function sustain(pitch: string, ticks: number): Note[] {
  const durs = spanDurs(ticks);
  return durs.map((dur, i) => (i < durs.length - 1 ? { pitch, dur, tie: true } : { pitch, dur }));
}

function fullBarRest(time: TimeSig): Measure {
  return { notes: rests(TIME_TICKS[time] ?? 1920) };
}

/** Where a listener hears the bar's structural beats. */
function strongGrid(time: TimeSig, barTicks: number): Dur[] {
  let grid: Dur[];
  switch (time) {
    case '3/4':
      grid = ['q', 'q', 'q'];
      break;
    case '2/4':
      grid = ['q', 'q'];
      break;
    case '6/8':
      grid = ['qd', 'qd'];
      break;
    default:
      grid = ['h', 'h'];
  }
  const total = grid.reduce((s, d) => s + DUR_TICKS[d], 0);
  return total === barTicks ? grid : spanDurs(barTicks);
}

// ---------------------------------------------------------------- voices

interface Target {
  part: Part;
  label: string;
  lo: number;
  hi: number;
  /** Last pitch this voice sang, for voice leading. */
  prev: number | null;
  out: Measure[];
  /** Beats that had no chord tone in range. */
  silenced: number;
  /** Notes pushed out of the close voicing to stay in range. */
  stretched: number;
}

function instrumentOf(part: Part): Instrument | null {
  return INSTRUMENTS[part.instrumentId] ?? findInstrument(part.instrumentId);
}

/** Sounding range in MIDI. Unknown instruments fall back to a safe middle span. */
function rangeOf(score: Score, part: Part): { lo: number; hi: number; known: boolean } {
  const inst = instrumentOf(part);
  const span = inst ? rangeFor(inst, score.level) ?? inst.range?.[score.level] : null;
  const lo = span ? pitchToMidi(span[0]) : null;
  const hi = span ? pitchToMidi(span[1]) : null;
  if (lo === null || hi === null) return { lo: 48, hi: 79, known: false };
  return lo <= hi ? { lo, hi, known: true } : { lo: hi, hi: lo, known: true };
}

function octavesInRange(pc: number, lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let m = lo + mod12(pc - lo); m <= hi; m += 12) out.push(m);
  return out;
}

function aimInside(desired: number, lo: number, hi: number): number {
  if (desired > hi) return Math.max(lo, hi - 5);
  if (desired < lo) return Math.min(hi, lo + 5);
  return desired;
}

interface VoicePlan {
  target: Target;
  /** Allowed pitch classes, most wanted first. */
  pcs: number[];
  /** The first pitch class is the one the symbol asks for: take it whenever the range allows. */
  strict?: boolean;
}

/**
 * Place one chord across a stack of voices, top voice first. Each voice sits strictly below the one
 * above it (no crossing) and below `ceiling` (the melody) when its range allows; range always wins.
 */
function voiceStack(plans: VoicePlan[], ceiling: number | null): (number | null)[] {
  const out: (number | null)[] = [];
  const used = new Set<number>();
  let roof = ceiling;
  for (let j = 0; j < plans.length; j++) {
    const { target, pcs, strict } = plans[j];
    let pool: number[];
    if (strict && pcs.length && octavesInRange(pcs[0], target.lo, target.hi).length) {
      pool = [pcs[0]]; // the symbol asked for this bass note and the range can hold it
    } else {
      pool = pcs.filter((pc) => !used.has(pc));
      if (!pool.length) pool = pcs.slice();
    }
    const aim =
      target.prev !== null
        ? aimInside(target.prev, target.lo, target.hi)
        : aimInside(ceiling !== null ? ceiling - 2 - 4 * j : Math.round((target.lo + target.hi) / 2), target.lo, target.hi);

    let best: number | null = null;
    let bestPc = -1;
    let bestScore = Infinity;
    for (let pi = 0; pi < pool.length; pi++) {
      for (const midi of octavesInRange(pool[pi], target.lo, target.hi)) {
        const overRoof = roof !== null && midi > roof ? 1000 : 0;
        const score = Math.abs(midi - aim) + pi * 0.5 + overRoof;
        if (score < bestScore) {
          bestScore = score;
          best = midi;
          bestPc = pool[pi];
        }
      }
    }
    if (best === null) {
      out.push(null);
      continue;
    }
    if (bestScore >= 1000) target.stretched += 1;
    used.add(bestPc);
    roof = best - 1;
    out.push(best);
  }
  return out;
}

/** Chord tone assignment for block chords: distinct tones above, the root doubled at the bottom. */
function blockPlans(targets: Target[], chord: HarmonyChord): VoicePlan[] {
  const upper = chord.tones.filter((pc) => pc !== chord.root);
  return targets.map((target, j) => {
    if (j === targets.length - 1) {
      const bottom = chord.bass !== null ? [chord.bass, chord.root] : [chord.root];
      return { target, pcs: Array.from(new Set(bottom)), strict: true };
    }
    return { target, pcs: upper.length ? upper : chord.tones.slice() };
  });
}

/** Pad assignment, built from the bottom up: root, third, fifth, seventh, then doubles. */
function padPlans(targets: Target[], chord: HarmonyChord): VoicePlan[] {
  const n = targets.length;
  const stack: number[] = [];
  const bottom = chord.bass !== null ? chord.bass : chord.root;
  for (let i = 0; i < n; i++) stack.push(i === 0 ? bottom : chord.tones[i % chord.tones.length]);
  return targets.map((target, j) => ({ target, pcs: [stack[n - 1 - j]] }));
}

// ---------------------------------------------------------------- melody reading

interface MelodyEvent {
  dur: Dur;
  midi: number | null;
}

function melodyEvents(measure: Measure | undefined, barTicks: number): { events: MelodyEvent[]; tail: number } {
  const events: MelodyEvent[] = [];
  let used = 0;
  for (const n of measure?.notes ?? []) {
    const dur = n.dur;
    const ticks = DUR_TICKS[dur];
    if (!ticks) continue;
    if (used + ticks > barTicks) break;
    const raw = String(n.pitch ?? '');
    events.push({ dur, midi: isRest(raw) ? null : pitchToMidi(raw) });
    used += ticks;
  }
  return { events, tail: barTicks - used };
}

/** The melody pitch sounding at a tick offset inside the bar, or the next one to arrive. */
function melodyAt(events: MelodyEvent[], tick: number): number | null {
  let at = 0;
  let after: number | null = null;
  for (const e of events) {
    const end = at + DUR_TICKS[e.dur];
    if (at <= tick && tick < end && e.midi !== null) return e.midi;
    if (at > tick && after === null && e.midi !== null) after = e.midi;
    at = end;
  }
  return after;
}

function lowestMelody(events: MelodyEvent[]): number | null {
  let low: number | null = null;
  for (const e of events) if (e.midi !== null && (low === null || e.midi < low)) low = e.midi;
  return low;
}

// ---------------------------------------------------------------- countermelody

/** A chord tone that steps against the melody: contrary motion first, small steps second. */
function pickCounter(target: Target, chord: HarmonyChord, melody: number | null, dir: number): number | null {
  const roof = melody !== null ? melody - 1 : null;
  const centre = (target.lo + target.hi) / 2;
  const prev = target.prev;
  let best: number | null = null;
  let bestScore = Infinity;
  for (const pc of chord.tones) {
    for (const midi of octavesInRange(pc, target.lo, target.hi)) {
      let score = roof !== null && midi > roof ? 40 : 0;
      if (prev === null) {
        score += Math.abs(midi - aimInside(roof !== null ? roof - 4 : centre, target.lo, target.hi));
      } else {
        const step = midi - prev;
        const size = Math.abs(step);
        if (step === 0) score += 18;
        else if (dir !== 0 && Math.sign(step) !== dir) score += 60;
        score += size <= 2 ? 0 : size <= 4 ? 3 : size <= 7 ? 9 : 16 + size;
        score += 0.15 * Math.abs(midi - centre);
      }
      if (score < bestScore) {
        bestScore = score;
        best = midi;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- main

function findPart(score: Score, idOrLabel: string): Part | null {
  const q = String(idOrLabel ?? '').trim().toLowerCase();
  if (!q) return null;
  return (
    score.parts.find((p) => p.id.toLowerCase() === q) ??
    score.parts.find((p) => p.label.toLowerCase() === q) ??
    score.parts.find((p) => p.id.toLowerCase().startsWith(q)) ??
    null
  );
}

function barList(bars: number[]): string {
  const shown = bars.slice(0, 4).map((b) => b + 1);
  return shown.join(', ') + (bars.length > 4 ? `, …` : '');
}

/** Rule-based voicing draft the agent can accept or rewrite. Never exceeds each target's range at the score level. */
export function harmonize(score: Score, opts: HarmonizeOptions): HarmonizeResult {
  const notes: string[] = [];
  const measuresByPart: Record<string, Measure[]> = {};
  const time = score?.time ?? '4/4';
  const barTicks = TIME_TICKS[time] ?? 1920;
  const fifths = keyFifths(score?.key ?? 'C');

  const source = score ? findPart(score, opts.sourcePart) : null;
  if (!score || !source) {
    notes.push(`No melody part “${opts.sourcePart}” in this score, so nothing was written.`);
    return { measuresByPart, from: Math.max(0, Math.round(opts.from ?? 0)), notes };
  }

  const lastBar = Math.max(0, source.measures.length - 1);
  const from = Math.min(Math.max(0, Math.round(opts.from ?? 0)), lastBar);
  const to = Math.min(Math.max(from, Math.round(opts.to ?? lastBar)), lastBar);

  const targets: Target[] = [];
  for (const id of opts.targetParts ?? []) {
    const part = findPart(score, id);
    if (!part) {
      notes.push(`No part “${id}” to harmonize into — skipped it.`);
      continue;
    }
    if (part.id === source.id || targets.some((t) => t.part.id === part.id)) continue;
    const inst = instrumentOf(part);
    if (inst?.unpitched) {
      notes.push(`${part.label} is unpitched, so it was left alone.`);
      continue;
    }
    const span = rangeOf(score, part);
    if (!span.known) notes.push(`${part.label} has no instrument range on file — used a safe middle register.`);
    targets.push({ part, label: part.label, lo: span.lo, hi: span.hi, prev: null, out: [], silenced: 0, stretched: 0 });
  }
  if (!targets.length) {
    notes.push('No playable target part was given, so nothing was written.');
    return { measuresByPart, from, notes };
  }

  const style = opts.style === 'pad' || opts.style === 'countermelody' ? opts.style : 'block';
  const counterTarget = style === 'countermelody' ? targets[0] : null;
  const padTargets = style === 'countermelody' ? targets.slice(1) : targets;
  const inferred: { bar: number; symbol: string }[] = [];
  const silentBars: number[] = [];
  let prevMelody: number | null = null;
  let counterDir = -1;

  for (let bar = from; bar <= to; bar++) {
    const { events, tail } = melodyEvents(source.measures[bar], barTicks);
    const symbol = score.chords?.[bar] ?? '';
    let chord = parseChordSymbol(symbol);
    if (!chord) {
      chord = inferChordFromMelody(score.key, source.measures[bar]?.notes ?? [], fifths);
      if (chord) inferred.push({ bar, symbol: chord.symbol });
    }
    if (!chord) {
      silentBars.push(bar);
      for (const t of targets) t.out.push(fullBarRest(time));
      prevMelody = null;
      continue;
    }

    if (style === 'block') {
      const lines: Note[][] = targets.map(() => []);
      for (const ev of events) {
        if (ev.midi === null) {
          lines.forEach((l) => l.push({ pitch: 'r', dur: ev.dur }));
          continue;
        }
        const picks = voiceStack(blockPlans(targets, chord), ev.midi - 1);
        picks.forEach((midi, j) => {
          if (midi === null) {
            targets[j].silenced += 1;
            lines[j].push({ pitch: 'r', dur: ev.dur });
            return;
          }
          targets[j].prev = midi;
          lines[j].push({ pitch: midiToPitch(midi, fifths), dur: ev.dur });
        });
      }
      lines.forEach((l, j) => targets[j].out.push({ notes: [...l, ...rests(tail)] }));
      prevMelody = null;
      continue;
    }

    // countermelody: the first target answers the melody, everyone else pads underneath.
    let counterFloor: number | null = null;
    if (counterTarget) {
      const grid = strongGrid(time, barTicks);
      const line: Note[] = [];
      let at = 0;
      for (const dur of grid) {
        const melody: number | null = melodyAt(events, at) ?? prevMelody;
        // Contrary motion: the melody rises, this line falls. On a static melody it turns around.
        const desired =
          melody !== null && prevMelody !== null && melody !== prevMelody
            ? melody > prevMelody
              ? -1
              : 1
            : -counterDir;
        if (melody !== null) prevMelody = melody;
        const pick = pickCounter(counterTarget, chord, melody, desired);
        if (pick === null) {
          counterTarget.silenced += 1;
          line.push({ pitch: 'r', dur });
        } else {
          if (counterTarget.prev !== null && pick !== counterTarget.prev) {
            counterDir = pick > counterTarget.prev ? 1 : -1;
          }
          counterTarget.prev = pick;
          counterFloor = counterFloor === null ? pick : Math.min(counterFloor, pick);
          line.push({ pitch: midiToPitch(pick, fifths), dur });
        }
        at += DUR_TICKS[dur];
      }
      counterTarget.out.push({ notes: [...line, ...rests(barTicks - at)] });
    }

    if (padTargets.length) {
      const melodyLow = lowestMelody(events);
      const roof =
        counterFloor !== null && melodyLow !== null
          ? Math.min(counterFloor, melodyLow)
          : counterFloor !== null
            ? counterFloor
            : melodyLow;
      const picks = voiceStack(padPlans(padTargets, chord), roof === null ? null : roof - 1);
      picks.forEach((midi, j) => {
        const t = padTargets[j];
        if (midi === null) {
          t.silenced += 1;
          t.out.push(fullBarRest(time));
          return;
        }
        t.prev = midi;
        t.out.push({ notes: sustain(midiToPitch(midi, fifths), barTicks) });
      });
    }
    if (style === 'pad') prevMelody = lowestMelody(events) ?? prevMelody;
  }

  for (const t of targets) measuresByPart[t.part.id] = t.out;

  // ---- assert against the checker; repair anything it rejects -------------
  const repaired: number[] = [];
  for (const t of targets) {
    for (let pass = 0; pass < 2; pass++) {
      const errors = validateWrite(score, t.part, from, t.out).filter((i) => i.severity === 'error');
      if (!errors.length) break;
      for (const issue of errors) {
        const idx = (issue.measure ?? from) - from;
        if (idx < 0 || idx >= t.out.length) continue;
        t.out[idx] = fullBarRest(time);
        if (!repaired.includes(idx + from)) repaired.push(idx + from);
      }
    }
  }
  const draft: Score = {
    ...score,
    parts: score.parts.map((p) => {
      const written = measuresByPart[p.id];
      if (!written) return p;
      const merged = p.measures.slice();
      while (merged.length < from + written.length) merged.push(fullBarRest(time));
      written.forEach((m, i) => (merged[from + i] = m));
      return { ...p, measures: merged };
    }),
  };
  const left = checkScore(draft).filter(
    (i) =>
      i.severity === 'error' &&
      i.partId !== undefined &&
      measuresByPart[i.partId] !== undefined &&
      (i.measure ?? -1) >= from &&
      (i.measure ?? -1) <= to,
  );
  for (const issue of left) {
    const list = measuresByPart[issue.partId as string];
    const idx = (issue.measure ?? from) - from;
    if (list && idx >= 0 && idx < list.length) {
      list[idx] = fullBarRest(time);
      if (!repaired.includes(idx + from)) repaired.push(idx + from);
    }
  }

  // ---- the sentences the agent reads back to the person -------------------
  const names = targets.map((t) => t.label).join(', ');
  const span = from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}`;
  if (style === 'block') notes.push(`Block chords under ${source.label} in ${span}: ${names} take one chord tone per melody note.`);
  else if (style === 'pad') notes.push(`Sustained pad in ${span}: ${names} hold one chord tone each, root at the bottom.`);
  else
    notes.push(
      `${targets[0].label} answers ${source.label} in contrary motion across ${span}${
        padTargets.length ? `, with ${padTargets.map((t) => t.label).join(', ')} holding the chord` : ''
      }.`,
    );
  if (inferred.length) {
    const shown = inferred.slice(0, 4).map((i) => `bar ${i.bar + 1} → ${i.symbol}`);
    notes.push(`No chord symbol on ${inferred.length} bar${inferred.length > 1 ? 's' : ''}; read from the melody: ${shown.join(', ')}${inferred.length > 4 ? ', …' : ''}.`);
  }
  if (silentBars.length) notes.push(`Bars ${barList(silentBars)} have neither a chord nor a melody note, so they stay silent.`);
  for (const t of targets) {
    if (t.silenced) notes.push(`${t.label} had no chord tone inside its ${score.level} range on ${t.silenced} beat${t.silenced > 1 ? 's' : ''} — those are rests.`);
    if (t.stretched) notes.push(`${t.label} was moved by an octave on ${t.stretched} note${t.stretched > 1 ? 's' : ''} to stay inside its range.`);
  }
  const locked = targets.flatMap((t) =>
    t.out.map((_, i) => (t.part.measures[from + i]?.locked ? from + i : -1)).filter((b) => b >= 0),
  );
  if (locked.length) notes.push(`Bars ${barList(Array.from(new Set(locked)).sort((a, b) => a - b))} are locked; the store will keep what is already there.`);
  if (repaired.length) notes.push(`Bars ${barList(repaired.sort((a, b) => a - b))} did not pass the checker, so they were replaced with rests.`);

  return { measuresByPart, from, notes: notes.slice(0, 12) };
}
