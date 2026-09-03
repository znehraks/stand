// Stand — the WebMCP tool surface. docs/TOOLS.md is the contract; this file must match it.
//
// House rules, enforced here and nowhere else:
//  - Bar numbers are 1-based in the tool API and 0-based in the store. Convert at this boundary,
//    in both directions, including inside error text.
//  - Pitches crossing this boundary are SOUNDING (concert) pitch. Written pitch is derived.
//  - Every write returns what changed plus a next_step sentence; every failure returns
//    { ok: false, error, issues? } with the bar named and a fix suggested.
//  - Nothing throws out of an executor: a thrown Error becomes { ok: false, error }.

import type { ToolSpec } from './webmcp';
import type { StandStore, EnsembleSpec } from '../store';
import type { Player } from '../audio/player';
import { checkPart, checkScore, validateWrite } from '../core/check';
import { harmonize as harmonizeDraft } from '../core/harmonize';
import { findInstrument, INSTRUMENTS } from '../core/instruments';
import { PRESETS } from '../data/presets';
import { isMinorKey, isRest, keyFifths, keyFromFifths, fifthsDelta, pitchToMidi, transposePitch, writtenKey } from '../core/pitch';
import {
  DUR_TICKS,
  LEVELS,
  measureCount,
  type Articulation,
  type CheckIssue,
  type Dur,
  type Dynamic,
  type Instrument,
  type Level,
  type Measure,
  type Note,
  type Part,
  type Score,
  type TimeSig,
} from '../core/types';

export interface ToolEnv {
  store: StandStore;
  player: Player;
  /** Trigger an export the way the human button does — used only by export_plan's guidance, never to export. */
  origin: string;
}

// ---------------------------------------------------------------- constants

const KEYS = [
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm',
];
const TIMES: TimeSig[] = ['4/4', '3/4', '2/4', '2/2', '6/8'];
const SECTIONS = ['woodwind', 'brass', 'percussion', 'string', 'voice', 'keyboard'];
const DURS_IN: Dur[] = ['w', 'hd', 'h', 'qd', 'q', '8d', '8', '16'];
const DYNAMICS: Dynamic[] = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
const ARTICULATIONS: Articulation[] = ['staccato', 'accent', 'tenuto'];
const STYLES = ['block', 'pad', 'countermelody'] as const;
const NEEDS_GESTURE = 'The browser will not start audio until the person clicks. Ask them to press ▶ once, then call play again.';
const REOPEN_YES = 'Yes, reopen it';
const REOPEN_NO = 'No, leave it exported';

type Input = Record<string, unknown>;

// ---------------------------------------------------------------- tiny helpers

function clip(s: string, n: number): string {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 1-based bar number from the API → 0-based store index. */
function toIndex(v: unknown, fallback: number): number {
  const n = asNumber(v);
  if (n === undefined) return fallback;
  return Math.max(0, Math.round(n) - 1);
}

/** 0-based store index → 1-based bar number for the API. */
function toBar(index: number): number {
  return index + 1;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function instrumentOf(part: Part): Instrument | null {
  return INSTRUMENTS[part.instrumentId] ?? findInstrument(part.instrumentId);
}

function hasSound(m: Measure): boolean {
  return m.notes.some((n) => !isRest(n.pitch));
}

function soundingNotes(m: Measure): number {
  return m.notes.filter((n) => !isRest(n.pitch)).length;
}

function partIds(score: Score | null): string {
  return score && score.parts.length ? score.parts.map((p) => p.id).join(', ') : '(none yet)';
}

// ---------------------------------------------------------------- issue wire format

interface WireIssue {
  severity: 'error' | 'warning';
  kind: string;
  part?: string;
  /** 1-based. */
  bar?: number;
  /** 1-based position inside the bar. */
  note?: number;
  message: string;
  suggestion?: string;
}

function wireIssue(i: CheckIssue): WireIssue {
  const w: WireIssue = { severity: i.severity, kind: i.kind, message: clip(i.message, 180) };
  if (i.partId) w.part = i.partId;
  if (typeof i.measure === 'number') w.bar = toBar(i.measure);
  if (typeof i.note === 'number') w.note = i.note + 1;
  if (i.suggestion) w.suggestion = clip(i.suggestion, 180);
  return w;
}

function issueLine(i: CheckIssue): string {
  const where = [i.partId, typeof i.measure === 'number' ? `bar ${toBar(i.measure)}` : null].filter(Boolean).join(' ');
  return clip(where ? `${where}: ${i.message}` : i.message, 180);
}

/**
 * Make sure a rejection names the offending bar in 1-based numbers even when the checker's own
 * sentence does not. Never rewrites the checker's words — only prefixes the bars it left implicit.
 */
function withBarPrefix(error: string, issues: CheckIssue[]): string {
  const bars = [...new Set(issues.filter((i) => i.severity === 'error' && typeof i.measure === 'number').map((i) => toBar(i.measure as number)))];
  if (!bars.length) return error;
  const unnamed = bars.filter((b) => !new RegExp(`(^|\\D)${b}(\\D|$)`).test(error));
  if (!unnamed.length) return error;
  return `${bars.length === 1 ? 'bar' : 'bars'} ${bars.join(', ')}: ${error}`;
}

function summarizeIssues(issues: CheckIssue[], first = 5): { errors: number; warnings: number; first: WireIssue[] } {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { errors: errors.length, warnings: warnings.length, first: [...errors, ...warnings].slice(0, first).map(wireIssue) };
}

// ---------------------------------------------------------------- guards

function fail(error: string, extra: Input = {}): Input {
  return { ok: false, error, ...extra };
}

function needScore(env: ToolEnv): Score {
  const score = env.store.score;
  if (!score) throw new Error('no score yet — call load_melody with one of the melodies from list_melodies first.');
  return score;
}

function needPart(env: ToolEnv, raw: unknown, field = 'part'): Part {
  const score = needScore(env);
  const q = asString(raw);
  if (!q) throw new Error(`${field} is required — one of: ${partIds(score)}`);
  const part = env.store.findPart(q);
  if (!part) throw new Error(`no part “${q}”. Parts on this score: ${partIds(score)}`);
  return part;
}

/** Every executor returns a value; a thrown Error becomes { ok: false, error }. */
function guard(spec: ToolSpec): ToolSpec {
  return {
    ...spec,
    execute: async (input: Input) => {
      try {
        return await spec.execute((input ?? {}) as Input);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}

const READ = { readOnlyHint: true } as const;

function obj(properties: Record<string, unknown>, required: string[] = []): object {
  return { type: 'object', properties, required, additionalProperties: false };
}

const BARS_SCHEMA = {
  type: 'array',
  minItems: 1,
  maxItems: 64,
  description: 'One entry per bar, in order, starting at from_bar.',
  items: obj(
    {
      notes: {
        type: 'array',
        minItems: 1,
        items: obj(
          {
            pitch: { type: 'string', description: 'Sounding (concert) pitch: "C4", "Bb3", "F#5", or "r" for a rest.' },
            dur: { type: 'string', enum: DURS_IN },
            tie: { type: 'boolean' },
            dyn: { type: 'string', enum: DYNAMICS },
            art: { type: 'string', enum: ARTICULATIONS },
            lyric: { type: 'string' },
          },
          ['pitch', 'dur'],
        ),
      },
    },
    ['notes'],
  ),
};

// ---------------------------------------------------------------- parsing input music

/** Turn tool input bars into store measures, rejecting malformed payloads with the bar named (1-based). */
function parseBars(raw: unknown, fromBar: number, time: TimeSig): { measures?: Measure[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: `bars must be a non-empty array, one entry per bar: [{"notes":[{"pitch":"C4","dur":"q"}]}]. Every bar must total exactly one bar of ${time}.` };
  }
  if (raw.length > 64) return { error: 'write at most 64 bars in one call — split the passage.' };
  const measures: Measure[] = [];
  for (let i = 0; i < raw.length; i++) {
    const bar = fromBar + i;
    const entry = raw[i] as { notes?: unknown } | null;
    const notes = entry && typeof entry === 'object' ? entry.notes : undefined;
    if (!Array.isArray(notes) || notes.length === 0) {
      return { error: `bar ${bar}: give {"notes":[{"pitch":"C4","dur":"q"}, …]} — the bar must total exactly one bar of ${time}.` };
    }
    const out: Note[] = [];
    for (let j = 0; j < notes.length; j++) {
      const n = notes[j] as Record<string, unknown> | null;
      const pitch = n && typeof n === 'object' ? asString(n.pitch) : undefined;
      const dur = n && typeof n === 'object' ? asString(n.dur) : undefined;
      if (!pitch) return { error: `bar ${bar}, note ${j + 1}: pitch is required — a sounding pitch like "Bb4", or "r" for a rest.` };
      if (!dur || !(dur in DUR_TICKS)) {
        return { error: `bar ${bar}, note ${j + 1}: dur “${dur ?? ''}” is not a duration. Use w h q 8 16, or dotted hd qd 8d.` };
      }
      const note: Note = { pitch: isRest(pitch) ? 'r' : pitch, dur: dur as Dur };
      if (n && n.tie === true) note.tie = true;
      const dyn = n ? asString(n.dyn) : undefined;
      if (dyn && (DYNAMICS as string[]).includes(dyn)) note.dyn = dyn as Dynamic;
      const art = n ? asString(n.art) : undefined;
      if (art && (ARTICULATIONS as string[]).includes(art)) note.art = art as Articulation;
      const lyric = n ? asString(n.lyric) : undefined;
      if (lyric) note.lyric = clip(lyric, 24);
      out.push(note);
    }
    measures.push({ notes: out });
  }
  return { measures };
}

// ---------------------------------------------------------------- briefing

function melodyList(): Input[] {
  return PRESETS.map((p) => ({ id: p.id, title: p.title, key: p.key, time: p.time, bars: p.melody.length, source: clip(p.source, 90) }));
}

function nextStepArranging(env: ToolEnv): string {
  const score = env.store.score;
  if (!score) return 'Call load_melody with one of the melodies from list_melodies.';
  const bars = measureCount(score);
  const errors = env.store.issues.filter((i) => i.severity === 'error');
  if (score.parts.length <= 1) {
    return 'Call set_ensemble with the instruments and level the person named, then fill each part with write_part.';
  }
  if (errors.length) {
    return `Fix ${plural(errors.length, 'error')} first — ${issueLine(errors[0])} — then call write_part again for that bar (bars are 1-based).`;
  }
  const empty = score.parts.filter((p) => !p.measures.some(hasSound));
  if (empty.length) {
    return `Write ${empty[0].label} next with write_part (bars 1–${bars}, sounding pitch), or call harmonize to draft it from the melody.`;
  }
  if (!env.player.armed()) return 'Ask the person to press ▶ once so the browser lets audio start, then call play.';
  return 'Call play so the person can hear it, then ask_human to let them choose between two versions. They export with the buttons on the page.';
}

function briefing(env: ToolEnv): Input {
  const store = env.store;
  const score = needScore(env);
  const bars = measureCount(score);
  const issues = store.issues;
  const parts = score.parts.slice(0, 24).map((p) => {
    const inst = instrumentOf(p);
    const transposition = inst?.transposition ?? 0;
    const range = inst && !inst.unpitched ? inst.range?.[score.level] ?? null : null;
    return {
      id: p.id,
      label: p.label,
      instrument: inst?.name ?? p.instrumentId,
      transposition,
      written_key: writtenKey(score.key, transposition),
      range_at_level: range,
      bars_written: p.measures.filter(hasSound).length,
      locked_bars: p.measures.flatMap((m, i) => (m.locked ? [toBar(i)] : [])),
      muted: p.muted === true,
    };
  });
  const chords = score.chords.slice(0, 64);
  return {
    phase: store.phase,
    parts_not_shown: score.parts.length > parts.length ? `${score.parts.length - parts.length} more part(s); call read_part by id.` : undefined,
    title: score.title,
    key: score.key,
    time: score.time,
    tempo: score.tempo,
    level: score.level,
    bars,
    source: score.source ? clip(score.source, 90) : undefined,
    parts,
    chords: chords.some((c) => c) ? chords : [],
    issues: summarizeIssues(issues),
    playing: env.player.isPlaying(),
    audio_armed: env.player.armed(),
    view: { mode: store.view.mode, part: store.view.partId ?? null },
    next_step: store.phase === 'exported'
      ? 'The person exported this. Read it or call export_plan; call reopen only if they want to keep editing — it asks them first.'
      : nextStepArranging(env),
  };
}

// ---------------------------------------------------------------- shared specs

function listInstrumentsSpec(env: ToolEnv): ToolSpec {
  return {
    name: 'list_instruments',
    title: 'List instruments',
    description:
      'List the instruments this page knows: clef, transposition in semitones (written pitch = sounding pitch + transposition), the key signature that player reads in the current concert key, and the comfortable SOUNDING range at every level (elementary, middle, high, adult). Filter by section. Read this before set_ensemble, and before writing anything high or low.',
    inputSchema: obj({ section: { type: 'string', enum: SECTIONS } }),
    annotations: READ,
    execute: async (input: Input) => {
      const section = asString(input.section);
      const key = env.store.score?.key ?? 'C';
      const all = Object.values(INSTRUMENTS).filter((i) => !section || i.section === section);
      return {
        concert_key: key,
        instruments: all.map((i) => ({
          id: i.id,
          name: i.name,
          section: i.section,
          clef: i.clef,
          transposition: i.transposition,
          written_key_example: writtenKey(key, i.transposition),
          range_by_level: i.unpitched ? null : i.range,
        })),
        note: 'Ranges are sounding pitch. written_key_example is what this player reads while the score is in ' + key + '.',
      };
    },
  };
}

function exportPlanSpec(env: ToolEnv): ToolSpec {
  return {
    name: 'export_plan',
    title: 'How this leaves the page',
    description:
      'Explain how the finished arrangement leaves the page: full-score MusicXML, one MusicXML per transposed part, MIDI, or print/PDF. Exporting is the person’s move — the buttons are on the page — so name the button they should press instead of trying to export yourself.',
    inputSchema: obj({}),
    annotations: READ,
    execute: async () => ({
      formats: ['musicxml', 'parts', 'midi', 'print'],
      note: 'the person exports with the buttons on the page',
      page: env.origin,
    }),
  };
}

// ---------------------------------------------------------------- empty surface

function emptySpecs(env: ToolEnv): ToolSpec[] {
  return [
    {
      name: 'get_score',
      title: 'Read the page',
      description:
        'Read the whole page state in one call. Nothing is loaded yet, so this returns the public-domain melodies you can load, how many instruments the page knows, and next_step. Call it first, and again after every write, instead of guessing what changed.',
      inputSchema: obj({}),
      annotations: READ,
      execute: async () => ({
        phase: 'empty' as const,
        melodies: melodyList(),
        instruments_available: Object.keys(INSTRUMENTS).length,
        audio_armed: env.player.armed(),
        next_step: PRESETS.length
          ? `Call load_melody with one of these ids: ${PRESETS.map((p) => p.id).join(', ')}. The person can also load a melody of their own by hand.`
          : 'No melodies are loaded on this build — ask the person to enter a melody on the page before you arrange it.',
      }),
    },
    {
      name: 'list_melodies',
      title: 'List melodies',
      description:
        'List the public-domain melodies this page can load: id, title, key, time signature, bar count and source. Pass one id to load_melody. Use it when the person names a tune, or asks what is available.',
      inputSchema: obj({}),
      annotations: READ,
      execute: async () => ({ melodies: melodyList() }),
    },
    listInstrumentsSpec(env),
    {
      name: 'load_melody',
      title: 'Load a melody',
      description:
        'Load one public-domain melody as the “melody” part and start the arrangement. Pass an id from list_melodies. Returns the title, bar count, concert key and time signature. Call it once, at the start; after this the arranging tools appear.',
      inputSchema: obj({ melody: { type: 'string', description: 'Melody id from list_melodies.' } }, ['melody']),
      execute: async (input: Input) => {
        const id = asString(input.melody);
        if (!id) return fail(`melody is required. Available: ${PRESETS.map((p) => p.id).join(', ') || '(none)'}`);
        const r = env.store.loadPreset(id, 'agent');
        if (!r.ok) return fail(r.error ?? `could not load “${id}” — call list_melodies and pass one of the ids it returns.`);
        const score = env.store.score!;
        return {
          ok: true,
          title: score.title,
          bars: measureCount(score),
          key: score.key,
          time: score.time,
          tempo: score.tempo,
          source: clip(score.source ?? '', 90),
          next_step: 'Call set_ensemble with the instruments and level the person named, then write each part with write_part (bars are 1-based, pitches are sounding).',
        };
      },
    },
  ];
}

// ---------------------------------------------------------------- arranging surface

function arrangingSpecs(env: ToolEnv): ToolSpec[] {
  const specs: ToolSpec[] = [];

  specs.push({
    name: 'get_score',
    title: 'Read the score',
    description:
      'One-call briefing on the arrangement: title, concert key, time signature, tempo, level, bar count, and for every part its instrument, transposition, written key, sounding range at the level, bars written, locked bars and mute state — plus chord symbols, issue counts with the first five, whether audio is armed and playing, the current view and next_step. Bars are 1-based. Call it before your first write and whenever a write surprises you.',
    inputSchema: obj({}),
    annotations: READ,
    execute: async () => briefing(env),
  });

  specs.push({
    name: 'read_part',
    title: 'Read one part',
    description:
      'Read one part bar by bar. Every note carries both pitch (sounding/concert, what you write) and written (what this player actually reads after transposition), plus dur and any tie, dynamic, articulation or lyric. from_bar/to_bar are 1-based and inclusive; omit them for the whole part. Read a passage before you rewrite it so you keep what is already there.',
    inputSchema: obj(
      {
        part: { type: 'string', description: 'Part id or label, e.g. "trumpet" or "Flute 1".' },
        from_bar: { type: 'integer', minimum: 1 },
        to_bar: { type: 'integer', minimum: 1 },
      },
      ['part'],
    ),
    annotations: READ,
    execute: async (input: Input) => {
      const score = needScore(env);
      const part = needPart(env, input.part);
      const inst = instrumentOf(part);
      const transposition = inst?.transposition ?? 0;
      const wkey = writtenKey(score.key, transposition);
      const wfifths = keyFifths(wkey);
      const total = part.measures.length;
      const from = toIndex(input.from_bar, 0);
      // Keep the bar the caller asked for for the error text, and the clamped one for the read.
      const askedTo = input.to_bar !== undefined;
      const wantedTo = askedTo ? toIndex(input.to_bar, total - 1) : total - 1;
      const to = Math.min(total - 1, wantedTo);
      if (total === 0) return { part: part.id, label: part.label, instrument: inst?.name ?? part.instrumentId, written_key: wkey, bars: [] };
      if (askedTo && from > wantedTo) {
        return fail(`from_bar ${toBar(from)} is after to_bar ${toBar(wantedTo)} — call read_part again with the lower bar as from_bar; this part has bars 1–${total}.`);
      }
      if (from > to) return fail(`from_bar ${toBar(from)} is past the end — call read_part again with a from_bar inside bars 1–${total}.`);
      const capped = Math.min(to, from + 31);
      const bars = [];
      for (let i = from; i <= capped; i++) {
        const m = part.measures[i];
        bars.push({
          bar: toBar(i),
          locked: m.locked === true,
          notes: m.notes.map((n) => {
            const rest = isRest(n.pitch);
            const out: Input = {
              pitch: rest ? 'r' : n.pitch,
              written: rest ? 'r' : transposePitch(n.pitch, transposition, wfifths),
              dur: n.dur,
            };
            if (n.tie) out.tie = true;
            if (n.dyn) out.dyn = n.dyn;
            if (n.art) out.art = n.art;
            if (n.lyric) out.lyric = n.lyric;
            return out;
          }),
        });
      }
      return {
        part: part.id,
        label: part.label,
        instrument: inst?.name ?? part.instrumentId,
        transposition,
        written_key: wkey,
        range_at_level: inst && !inst.unpitched ? inst.range?.[score.level] ?? null : null,
        bars,
        total_bars: total,
        more: capped < to ? `bars ${toBar(capped + 1)}–${toBar(to)} not shown; call read_part again from ${toBar(capped + 1)}.` : undefined,
      };
    },
  });

  specs.push(listInstrumentsSpec(env));

  specs.push({
    name: 'set_ensemble',
    title: 'Set the ensemble',
    description:
      'Replace the ensemble with the instruments the person named, e.g. [{"instrument":"flute","count":2},{"instrument":"alto sax"}]. instrument takes an id or a human name; count 1–4 makes numbered parts. Parts whose instrument stays keep their music, and a melody with nowhere to go moves onto the first empty part. level (elementary, middle, high, adult) drives every range and rhythm check. Call this before write_part.',
    inputSchema: obj(
      {
        instruments: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: obj(
            {
              instrument: { type: 'string', description: 'Instrument id or human name, e.g. "trumpet", "Bb clarinet".' },
              count: { type: 'integer', minimum: 1, maximum: 4 },
              label: { type: 'string' },
            },
            ['instrument'],
          ),
        },
        level: { type: 'string', enum: LEVELS },
      },
      ['instruments'],
    ),
    execute: async (input: Input) => {
      needScore(env);
      const raw = input.instruments;
      if (!Array.isArray(raw) || raw.length === 0) {
        return fail('instruments must be a non-empty array like [{"instrument":"flute","count":2}]. Call list_instruments for the names this page knows.');
      }
      const specsIn: EnsembleSpec[] = [];
      for (const entry of raw as Input[]) {
        const name = entry && typeof entry === 'object' ? asString(entry.instrument) : undefined;
        if (!name) return fail('every entry needs an instrument name, e.g. {"instrument":"trumpet"}.');
        specsIn.push({ instrument: name, count: asNumber(entry.count), label: asString(entry.label) });
      }
      const level = asString(input.level) as Level | undefined;
      if (level && !LEVELS.includes(level)) return fail(`level must be one of: ${LEVELS.join(', ')}`);
      const r = env.store.setEnsemble(specsIn, level, 'agent');
      if (!r.ok) return fail(r.error ?? 'could not set the ensemble — call list_instruments and pass names from that list.');
      const score = needScore(env);
      const kept = score.parts.filter((p) => p.measures.some(hasSound)).map((p) => p.id);
      const emptyParts = score.parts.filter((p) => !p.measures.some(hasSound));
      return {
        ok: true,
        parts: score.parts.map((p) => ({ id: p.id, label: p.label, instrument: instrumentOf(p)?.name ?? p.instrumentId })),
        level: score.level,
        kept_music: kept,
        bars: measureCount(score),
        warning: r.error,
        issues: summarizeIssues(env.store.issues),
        next_step: emptyParts.length
          ? `Write ${emptyParts[0].label} with write_part (bars 1–${measureCount(score)}, sounding pitch), or call harmonize to draft the inner parts from the melody.`
          : 'Every part has music. Call check, then play so the person can hear it.',
      };
    },
  });

  specs.push({
    name: 'set_meta',
    title: 'Set title, tempo, level',
    description:
      'Set the title, the tempo in BPM (30–240), and/or the playing level (elementary, middle, high, adult). Level drives every range and rhythm check, so set it before writing parts — lowering it can turn existing bars into errors, which this call reports.',
    inputSchema: obj({ title: { type: 'string' }, tempo: { type: 'integer', minimum: 30, maximum: 240 }, level: { type: 'string', enum: LEVELS } }),
    execute: async (input: Input) => {
      const score = needScore(env);
      const patch: { title?: string; tempo?: number; level?: Level } = {};
      const title = asString(input.title);
      if (title) patch.title = title;
      const tempo = asNumber(input.tempo);
      if (tempo !== undefined) patch.tempo = tempo;
      const level = asString(input.level) as Level | undefined;
      if (level) {
        if (!LEVELS.includes(level)) return fail(`level must be one of: ${LEVELS.join(', ')}`);
        patch.level = level;
      }
      if (!Object.keys(patch).length) return fail('give at least one of title, tempo or level.');
      const before = { title: score.title, tempo: score.tempo, level: score.level };
      const r = env.store.setMeta(patch, 'agent');
      if (!r.ok) return fail(r.error ?? `could not change the score — send a title, a tempo of 30–240, or a level of ${LEVELS.join(', ')}, then call set_meta again.`);
      const after = env.store.score!;
      const changed: string[] = [];
      if (patch.title !== undefined && after.title !== before.title) changed.push(`title → ${after.title}`);
      if (patch.tempo !== undefined && after.tempo !== before.tempo) changed.push(`tempo → ${after.tempo}`);
      if (patch.level !== undefined && after.level !== before.level) changed.push(`level → ${after.level}`);
      const issues = summarizeIssues(env.store.issues);
      return {
        ok: true,
        changed: changed.length ? changed : ['nothing changed — the score already had those values'],
        title: after.title,
        tempo: after.tempo,
        level: after.level,
        issues,
        next_step: issues.errors
          ? `That level leaves ${plural(issues.errors, 'error')} — call check, then rewrite the bars it names with write_part.`
          : nextStepArranging(env),
      };
    },
  });

  specs.push({
    name: 'set_key',
    title: 'Set the key signature',
    description:
      'Change the concert key signature only — every note stays exactly where it is. Returns the key signature each transposing part now reads. When the person wants the music itself to move up or down, call transpose instead.',
    inputSchema: obj({ key: { type: 'string', enum: KEYS, description: 'Concert key, e.g. "Bb" or "Dm".' } }, ['key']),
    execute: async (input: Input) => {
      const key = asString(input.key);
      if (!key) return fail(`key is required. Use one of: ${KEYS.join(', ')}`);
      if (!KEYS.includes(key)) return fail(`“${key}” is not a key this page knows. Use one of: ${KEYS.join(', ')}`);
      const r = env.store.setKey(key, 'agent');
      if (!r.ok) return fail(r.error ?? `could not set the key — call get_score for the current key, then try set_key again with one of: ${KEYS.join(', ')}`);
      const score = needScore(env);
      const written: Record<string, string> = {};
      for (const p of score.parts) written[p.id] = writtenKey(key, instrumentOf(p)?.transposition ?? 0);
      return {
        ok: true,
        key,
        written_keys: written,
        issues: summarizeIssues(env.store.issues),
        next_step: 'The notes did not move — call transpose if the person wanted the music in a new key, or read_part to see the new written pitches.',
      };
    },
  });

  specs.push({
    name: 'set_time',
    title: 'Set the time signature',
    description:
      'Change the time signature. Rejected, with the offending bars named (1-based), when bars already written would no longer total exactly one bar. Rewrite those bars with write_part first, then call this again.',
    inputSchema: obj({ time: { type: 'string', enum: TIMES } }, ['time']),
    execute: async (input: Input) => {
      needScore(env);
      const time = asString(input.time) as TimeSig | undefined;
      if (!time || !TIMES.includes(time)) return fail(`time must be one of: ${TIMES.join(', ')}`);
      const r = env.store.setTime(time, 'agent');
      if (!r.ok) return fail(r.error ?? `could not change the time signature — call check to see which bars are in the way, rewrite them with write_part, then call set_time again with ${time}.`);
      return { ok: true, time, next_step: 'Every bar must now total one bar of ' + time + '. Call check to confirm, then play.' };
    },
  });

  specs.push({
    name: 'write_part',
    title: 'Write bars into a part',
    description:
      'Write bars into one part. from_bar is 1-based; bars is an array of {"notes":[{"pitch","dur"}]}. Pitches are SOUNDING (concert): "Bb4", "F#5", "r" for a rest. Durations w h q 8 16, dotted hd qd 8d — each bar must total exactly one bar of the time signature. Bars the person locked are skipped, never overwritten. A short bar, an unknown pitch, or a note outside this player’s range at the score’s level rejects the whole write and returns issues naming the bar and the fix.',
    inputSchema: obj(
      {
        part: { type: 'string', description: 'Part id or label.' },
        from_bar: { type: 'integer', minimum: 1, description: '1-based bar to start at.' },
        bars: BARS_SCHEMA,
      },
      ['part', 'from_bar', 'bars'],
    ),
    execute: async (input: Input) => {
      const score = needScore(env);
      const part = needPart(env, input.part);
      const fromBar = Math.max(1, Math.round(asNumber(input.from_bar) ?? 1));
      const parsed = parseBars(input.bars, fromBar, score.time);
      if (!parsed.measures) return fail(parsed.error!, { suggestion: `Send one entry per bar and call write_part again with from_bar ${fromBar}.` });
      const r = env.store.writePart(part.id, fromBar - 1, parsed.measures, 'agent');
      if (!r.ok) {
        const issues = (r.issues ?? []).filter((i) => i.severity === 'error');
        return fail(withBarPrefix(r.error ?? 'the write was rejected.', issues), {
          issues: (r.issues ?? []).map(wireIssue),
          suggestion:
            issues[0]?.suggestion ??
            `Fix the bar named above — each bar must total exactly one bar of ${score.time}, and every sounding pitch must sit inside ${part.label}’s range at the ${score.level} level (read_part and list_instruments show both) — then call write_part again with from_bar ${fromBar}.`,
        });
      }
      const written = r.written ?? [];
      const skipped = r.skipped ?? [];
      const warnings = (r.issues ?? []).map(issueLine);
      const emptyParts = env.store.score!.parts.filter((p) => !p.measures.some(hasSound));
      const next = skipped.length
        ? `${skipped.length === 1 ? `Bar ${skipped[0]} is` : `Bars ${skipped.join(', ')} are`} locked by the person, so the music already there stayed — only they can unlock a bar, so ask before changing one.`
        : emptyParts.length
          ? `Write ${emptyParts[0].label} next with write_part, or call harmonize to draft it.`
          : 'Call check, then play so the person can hear it.';
      return {
        ok: true,
        part: part.id,
        written_bars: written,
        skipped_locked_bars: skipped,
        warnings,
        issues: summarizeIssues(env.store.issues),
        next_step: next,
      };
    },
  });

  specs.push({
    name: 'write_chords',
    title: 'Write chord symbols',
    description:
      'Write one chord symbol per bar — "C", "G7", "Am", "" for none — starting at from_bar (1-based, default 1). Chord symbols show above the top staff and guide harmonize, so write them before harmonizing.',
    inputSchema: obj(
      {
        chords: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string' } },
        from_bar: { type: 'integer', minimum: 1 },
      },
      ['chords'],
    ),
    execute: async (input: Input) => {
      needScore(env);
      const raw = input.chords;
      if (!Array.isArray(raw) || raw.length === 0) return fail('chords must be a non-empty array of symbols, one per bar, e.g. ["C","G","Am","F"].');
      if (raw.length > 64) return fail('write at most 64 chord symbols in one call.');
      const from = toIndex(input.from_bar, 0);
      const r = env.store.writeChords(raw.map((c) => String(c ?? '')), from, 'agent');
      if (!r.ok) return fail(r.error ?? `could not write the chords — send one symbol per bar and call write_chords again with from_bar ${toBar(from)}.`);
      const score = needScore(env);
      return {
        ok: true,
        chords: score.chords,
        from_bar: toBar(from),
        next_step: 'Call harmonize to draft the accompanying parts from these chords, or write them yourself with write_part.',
      };
    },
  });

  specs.push({
    name: 'harmonize',
    title: 'Draft supporting parts',
    description:
      'Draft supporting parts from one part’s melody, kept inside every target’s range at the score’s level: style "block" = chordal harmony, "pad" = sustained tones, "countermelody" = a moving second line. from_bar/to_bar are 1-based and inclusive (default: the whole piece). Each target is written through the same checks as write_part, so locked bars are skipped and out-of-range drafts are reported. Treat the result as a first draft you may rewrite.',
    inputSchema: obj(
      {
        source_part: { type: 'string', description: 'Part id or label holding the melody.' },
        target_parts: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string' } },
        style: { type: 'string', enum: STYLES },
        from_bar: { type: 'integer', minimum: 1 },
        to_bar: { type: 'integer', minimum: 1 },
      },
      ['source_part', 'target_parts', 'style'],
    ),
    execute: async (input: Input) => {
      const score = needScore(env);
      const source = needPart(env, input.source_part, 'source_part');
      const rawTargets = input.target_parts;
      if (!Array.isArray(rawTargets) || rawTargets.length === 0) return fail(`target_parts must name at least one part. Parts: ${partIds(score)}`);
      const targets: Part[] = [];
      for (const t of rawTargets) {
        const p = env.store.findPart(String(t));
        if (!p) return fail(`no part “${String(t)}” in target_parts. Parts: ${partIds(score)}`);
        if (p.id === source.id) return fail(`${p.id} is the source part — harmonize writes the other parts, not the melody itself.`);
        if (!targets.some((x) => x.id === p.id)) targets.push(p);
      }
      const style = asString(input.style) as (typeof STYLES)[number] | undefined;
      if (!style || !(STYLES as readonly string[]).includes(style)) return fail(`style must be one of: ${STYLES.join(', ')}`);
      const bars = measureCount(score);
      const from = toIndex(input.from_bar, 0);
      const askedTo = input.to_bar !== undefined;
      const wantedTo = askedTo ? toIndex(input.to_bar, bars - 1) : bars - 1;
      if (askedTo && from > wantedTo) {
        return fail(`from_bar ${toBar(from)} is after to_bar ${toBar(wantedTo)}. Call harmonize again with the lower bar as from_bar; this score has bars 1–${bars}.`);
      }
      if (from >= bars) return fail(`from_bar ${toBar(from)} is past the end. Call harmonize again with a from_bar inside bars 1–${bars}.`);
      // Report only bars this score actually has, so the range in every message is real.
      const to = Math.min(wantedTo, bars - 1);
      const draft = harmonizeDraft(score, { sourcePart: source.id, targetParts: targets.map((t) => t.id), style, from, to });
      const ids = Object.keys(draft.measuresByPart);
      if (!ids.length) {
        return fail(
          `harmonize produced nothing for ${targets.map((t) => t.id).join(', ')} in bars ${toBar(from)}–${toBar(to)}. Write those bars yourself with write_part, or write chord symbols first with write_chords.`,
        );
      }
      const start = Number.isFinite(draft.from) ? Math.max(0, Math.round(draft.from)) : from;
      const wrote: Record<string, number> = {};
      const skipped: Record<string, number[]> = {};
      const rejected: Input[] = [];
      for (const id of ids) {
        const measures = draft.measuresByPart[id];
        if (!Array.isArray(measures) || !measures.length) continue;
        const r = env.store.writePart(id, start, measures, 'agent');
        if (!r.ok) {
          rejected.push({ part: id, error: clip(withBarPrefix(r.error ?? 'rejected', r.issues ?? []), 180), issues: (r.issues ?? []).slice(0, 3).map(wireIssue) });
          continue;
        }
        wrote[id] = (r.written ?? []).length;
        if (r.skipped?.length) skipped[id] = r.skipped;
      }
      const wroteAny = Object.keys(wrote).length > 0;
      return {
        ok: wroteAny,
        error: wroteAny ? undefined : `every target was rejected: ${rejected.map((x) => x.error).join(' | ')}`,
        wrote,
        skipped_locked_bars: skipped,
        rejected: rejected.length ? rejected : undefined,
        from_bar: toBar(start),
        notes: draft.notes.slice(0, 8).map((n) => clip(n, 160)),
        issues: summarizeIssues(env.store.issues),
        next_step: wroteAny
          ? 'Read the draft with read_part, fix anything dull with write_part, then call play so the person can hear it.'
          : 'Write those parts by hand with write_part — the draft did not fit their ranges at this level.',
      };
    },
  });

  specs.push({
    name: 'transpose',
    title: 'Transpose the whole score',
    description:
      'Move the whole arrangement: give to_key (a concert key) or semitones (positive up, negative down). Every sounding pitch and the key signature move together, and bars the person locked keep their original notes. Checked before anything changes: if the move would push a part outside its range at the current level the call is rejected and nothing moves. Use set_key when only the key signature should change.',
    inputSchema: obj({ to_key: { type: 'string', enum: KEYS }, semitones: { type: 'integer', minimum: -12, maximum: 12 } }),
    execute: async (input: Input) => {
      const score = needScore(env);
      const toKey = asString(input.to_key);
      const semitonesIn = asNumber(input.semitones);
      if (!toKey && semitonesIn === undefined) return fail('give to_key (a concert key like "Bb") or semitones (e.g. -2 to go down a whole step).');
      if (toKey && !KEYS.includes(toKey)) return fail(`“${toKey}” is not a key this page knows. Use one of: ${KEYS.join(', ')}`);
      let semitones: number;
      if (semitonesIn !== undefined) {
        semitones = Math.round(semitonesIn);
      } else {
        const fromMidi = keyTonicMidi(score.key);
        const toMidi = keyTonicMidi(toKey!);
        if (fromMidi === null || toMidi === null) return fail(`cannot work out the distance from ${score.key} to ${toKey}. Pass semitones instead.`);
        let d = (((toMidi - fromMidi) % 12) + 12) % 12;
        if (d > 6) d -= 12;
        semitones = d;
      }
      if (semitones === 0) {
        return { ok: true, key: score.key, semitones: 0, moved_notes: 0, issues: summarizeIssues(env.store.issues), next_step: 'The score is already in that key — nothing moved.' };
      }
      const targetKey = toKey ?? keyFromFifths(keyFifths(score.key) + fifthsDelta(semitones), isMinorKey(score.key));
      const fifths = keyFifths(targetKey);
      // A locked bar never moves, so it goes into the plan untouched. Transposing it here would let
      // a bar the write is going to skip anyway reject the whole move.
      const plan = score.parts.map((part) => ({
        part,
        measures: part.measures.map((m) =>
          m.locked
            ? ({ notes: m.notes.map((n) => ({ ...n })) } as Measure)
            : ({ notes: m.notes.map((n) => ({ ...n, pitch: isRest(n.pitch) ? 'r' : transposePitch(n.pitch, semitones, fifths) })) } as Measure),
        ),
      }));
      const blocking: CheckIssue[] = [];
      for (const { part, measures } of plan) {
        for (const i of validateWrite(score, part, 0, measures)) if (i.severity === 'error') blocking.push(i);
      }
      if (blocking.length) {
        const bars = new Set(blocking.map((i) => `${i.partId ?? ''}:${i.measure ?? ''}`));
        return fail(`moving ${semitones > 0 ? '+' : ''}${semitones} semitones would push ${plural(bars.size, 'bar')} out of range: ${issueLine(blocking[0])}`, {
          issues: blocking.slice(0, 8).map(wireIssue),
          suggestion: `Nothing moved. Try the other direction (${semitones > 0 ? semitones - 12 : semitones + 12} semitones), or raise the level with set_meta, or move only the parts that fit with write_part.`,
        });
      }
      env.store.setKey(targetKey, 'agent');
      let moved = 0;
      const lockedKept: Record<string, number[]> = {};
      const rejected: Input[] = [];
      for (const { part, measures } of plan) {
        const r = env.store.writePart(part.id, 0, measures, 'agent');
        if (!r.ok) {
          rejected.push({ part: part.id, error: clip(withBarPrefix(r.error ?? 'rejected', r.issues ?? []), 180) });
          continue;
        }
        for (const bar of r.written ?? []) moved += soundingNotes(measures[bar - 1] ?? { notes: [] });
        if (r.skipped?.length) lockedKept[part.id] = r.skipped;
      }
      return {
        ok: rejected.length === 0,
        error: rejected.length ? `these parts did not move: ${rejected.map((x) => `${x.part} (${x.error})`).join(' | ')}` : undefined,
        key: targetKey,
        semitones,
        moved_notes: moved,
        locked_bars_kept: lockedKept,
        issues: summarizeIssues(env.store.issues),
        next_step: Object.keys(lockedKept).length
          ? 'Locked bars kept their original pitches — tell the person which ones so they can unlock them if they want the whole piece moved.'
          : `The score is in ${targetKey} now. Call play so the person can hear it in the new key.`,
      };
    },
  });

  specs.push({
    name: 'check',
    title: 'Check the arrangement',
    description:
      'Report every problem the page can see: notes outside a player’s range at the current level, bars that do not total one bar, rhythms too fine for the level, awkward leaps, voice crossing and parallel fifths. Bars are 1-based. Pass part to check one part only. Call it after a batch of writes and before play, so the person hears something clean.',
    inputSchema: obj({ part: { type: 'string' } }),
    annotations: READ,
    execute: async (input: Input) => {
      const score = needScore(env);
      const wanted = asString(input.part);
      let issues: CheckIssue[];
      let scope = '';
      if (wanted) {
        const part = needPart(env, wanted);
        issues = checkPart(score, part.id);
        scope = ` in ${part.label}`;
      } else {
        issues = checkScore(score);
      }
      const errors = issues.filter((i) => i.severity === 'error');
      const warnings = issues.filter((i) => i.severity === 'warning');
      const summary =
        errors.length || warnings.length
          ? `${plural(errors.length, 'error')}, ${plural(warnings.length, 'warning')}${scope}. ${errors.length ? 'Errors reject writes — rewrite the bars named above with write_part.' : 'Warnings are advice; the music still plays.'}`
          : `No problems${scope}: every bar fills, and every note sits inside its player’s range at the ${score.level} level.`;
      return {
        errors: errors.slice(0, 20).map(wireIssue),
        warnings: warnings.slice(0, 20).map(wireIssue),
        summary,
        truncated: errors.length > 20 || warnings.length > 20 ? 'showing the first 20 of each' : undefined,
      };
    },
  });

  specs.push({
    name: 'play',
    title: 'Play it for the person',
    description:
      'Play the arrangement through the page’s speakers so the person can hear it — you cannot hear it yourself. from_bar/to_bar are 1-based and inclusive, parts limits which staves sound, loop repeats the passage. Returns straight away while playback continues. If audio is not armed yet the call fails with needs_gesture: true — ask the person to press ▶ once, then call play again.',
    inputSchema: obj({
      from_bar: { type: 'integer', minimum: 1 },
      to_bar: { type: 'integer', minimum: 1 },
      parts: { type: 'array', items: { type: 'string' }, maxItems: 16 },
      loop: { type: 'boolean' },
    }),
    execute: async (input: Input) => {
      const score = needScore(env);
      if (!env.player.armed()) return { ok: false, needs_gesture: true, error: NEEDS_GESTURE };
      const bars = measureCount(score);
      const from = toIndex(input.from_bar, 0);
      const wantedTo = input.to_bar === undefined ? undefined : toIndex(input.to_bar, bars - 1);
      if (from >= bars) return fail(`bar ${toBar(from)} is past the end — this score has bars 1–${bars}. Call play again with a from_bar inside that range.`);
      if (wantedTo !== undefined && wantedTo < from) {
        return fail(`to_bar ${toBar(wantedTo)} is before from_bar ${toBar(from)}. Call play again with from_bar first.`);
      }
      // Never report playing past the last bar: playing_to has to name a bar this score has.
      const to = wantedTo === undefined ? undefined : Math.min(wantedTo, bars - 1);
      let ids: string[] | undefined;
      if (Array.isArray(input.parts) && input.parts.length) {
        ids = [];
        for (const raw of input.parts) {
          const p = env.store.findPart(String(raw));
          if (!p) return fail(`no part “${String(raw)}”. Parts: ${partIds(score)}`);
          ids.push(p.id);
        }
      }
      const loop = input.loop === true;
      void Promise.resolve(env.player.play(score, { from, to, parts: ids, loop })).catch(() => {});
      env.store.recordPublic('agent', `played bars ${toBar(from)}${to !== undefined ? `–${toBar(to)}` : '–end'}${ids ? ` (${ids.join(', ')})` : ''}`);
      return {
        ok: true,
        playing_from: toBar(from),
        playing_to: to === undefined ? bars : toBar(to),
        parts: ids ?? 'all unmuted parts',
        loop,
        audio_armed: true,
        next_step: 'The person is listening now. Call stop to end it, or ask_human with two playable options when only their ears can settle a choice.',
      };
    },
  });

  specs.push({
    name: 'stop',
    title: 'Stop playback',
    description: 'Stop playback immediately. Safe to call when nothing is playing.',
    inputSchema: obj({}),
    execute: async () => {
      env.player.stop();
      return { ok: true, playing: false, next_step: 'Ask the person what they thought, or keep writing with write_part.' };
    },
  });

  specs.push({
    name: 'ask_human',
    title: 'Ask the person',
    description:
      'Ask the person one question and wait up to 120 s for their answer. Each option may carry bars (same shape as write_part) with part and from_bar (1-based): the page then shows a ▶ per option so they hear each candidate before choosing. Returns the chosen label, or answer: null with status "no_answer" if they did not answer. Use it for anything only ears can settle — two endings, two voicings — then write their choice with write_part. Never guess the answer yourself.',
    inputSchema: obj(
      {
        question: { type: 'string', description: 'One short question, in the person’s language.' },
        options: {
          type: 'array',
          minItems: 1,
          maxItems: 6,
          items: obj(
            {
              label: { type: 'string' },
              part: { type: 'string', description: 'Part this candidate belongs to; defaults to the first part.' },
              from_bar: { type: 'integer', minimum: 1 },
              bars: BARS_SCHEMA,
            },
            ['label'],
          ),
        },
      },
      ['question', 'options'],
    ),
    execute: async (input: Input) => {
      const score = needScore(env);
      const question = asString(input.question);
      if (!question) return fail('question is required — ask one short question the person can answer by listening.');
      const raw = input.options;
      if (!Array.isArray(raw) || raw.length === 0) return fail('options must hold at least one {label} — give two playable candidates when you want them to choose by ear.');
      if (raw.length > 6) return fail('give at most 6 options.');
      const options: { label: string; variant?: { partId: string; from: number; measures: Measure[] } }[] = [];
      for (const entry of raw as Input[]) {
        const label = entry && typeof entry === 'object' ? asString(entry.label) : undefined;
        if (!label) return fail('every option needs a label.');
        const option: { label: string; variant?: { partId: string; from: number; measures: Measure[] } } = { label };
        if (entry.bars !== undefined) {
          const partName = asString(entry.part);
          const part = partName ? env.store.findPart(partName) : score.parts[0];
          if (!part) return fail(`option “${label}”: no part “${partName ?? ''}”. Parts: ${partIds(score)}`);
          const fromBar = Math.max(1, Math.round(asNumber(entry.from_bar) ?? 1));
          const parsed = parseBars(entry.bars, fromBar, score.time);
          if (!parsed.measures) return fail(`option “${label}”: ${parsed.error}`);
          option.variant = { partId: part.id, from: fromBar - 1, measures: parsed.measures };
        }
        options.push(option);
      }
      const t0 = env.store.now();
      const answer = await env.store.askHuman(question, options);
      const t1 = env.store.now();
      const elapsed = t1 > 0 && t1 >= t0 ? t1 - t0 : null;
      if (answer === null) {
        return {
          answer: null,
          status: 'no_answer',
          question,
          next_step:
            'Nobody answered, so there is no choice to report — never present one as theirs. Say the question is still open, take the safer option as your own call and name it as yours, or ask again more simply.',
        };
      }
      const chosen = options.find((o) => o.label === answer);
      return {
        answer,
        answered_in_ms: elapsed,
        next_step: chosen?.variant
          ? `They chose “${answer}”. Write it in with write_part on ${chosen.variant.partId} from bar ${toBar(chosen.variant.from)} — asking does not write it.`
          : `They chose “${answer}”. Act on it now with write_part or set_meta.`,
      };
    },
  });

  specs.push({
    name: 'set_view',
    title: 'Change what the person sees',
    description:
      'Show the full score, or one part alone as that player reads it (transposed, in their own key). Use it before you talk about a part so the person is looking at the same music you are.',
    inputSchema: obj({ mode: { type: 'string', enum: ['full', 'part'] }, part: { type: 'string' } }, ['mode']),
    execute: async (input: Input) => {
      const score = needScore(env);
      const mode = asString(input.mode);
      if (mode !== 'full' && mode !== 'part') return fail('mode must be "full" or "part".');
      if (mode === 'full') {
        env.store.setView({ mode: 'full' }, 'agent');
        return { ok: true, view: { mode: 'full', part: null }, next_step: 'The person sees the whole score. Call play so they can follow it.' };
      }
      const partName = asString(input.part);
      if (!partName) return fail(`mode "part" needs part. Parts: ${partIds(score)}`);
      const part = needPart(env, partName);
      env.store.setView({ mode: 'part', partId: part.id }, 'agent');
      return {
        ok: true,
        view: { mode: 'part', part: part.id },
        written_key: writtenKey(score.key, instrumentOf(part)?.transposition ?? 0),
        next_step: `The person sees ${part.label} alone, written in ${writtenKey(score.key, instrumentOf(part)?.transposition ?? 0)}. Call play with parts:["${part.id}"] so they hear just that line.`,
      };
    },
  });

  specs.push({
    name: 'undo',
    title: 'Undo the last change',
    description: 'Undo the last change to the score, whoever made it — you or the person. One step per call. Use it when a write turned out worse than what it replaced.',
    inputSchema: obj({}),
    execute: async () => {
      const done = env.store.undo('agent');
      if (!done) {
        return fail('nothing to undo — the score is already at its earliest state in this session.', {
          suggestion: 'Call get_score to see where it stands, then make the change you meant with write_part.',
        });
      }
      return { ok: true, issues: summarizeIssues(env.store.issues), next_step: 'Call get_score to see what the score looks like now.' };
    },
  });

  specs.push(exportPlanSpec(env));
  return specs;
}

// ---------------------------------------------------------------- exported surface

function exportedSpecs(env: ToolEnv): ToolSpec[] {
  return [
    {
      name: 'get_score',
      title: 'Read the finished score',
      description:
        'Read the arrangement the person exported: the same briefing as while arranging, with phase "exported". Writing tools are gone until they confirm reopen, so report what is there rather than trying to change it.',
      inputSchema: obj({}),
      annotations: READ,
      execute: async () => briefing(env),
    },
    exportPlanSpec(env),
    {
      name: 'reopen',
      title: 'Reopen for editing',
      description:
        'Ask the person to confirm, then reopen the exported arrangement so the writing tools come back. They decide: if they decline, nothing changes and the result carries status "cancelled_by_human". Call it only when they have asked for another change.',
      inputSchema: obj({ reason: { type: 'string', description: 'One line on what you would change, shown to the person.' } }),
      execute: async (input: Input) => {
        const reason = asString(input.reason);
        const question = reason ? `Reopen this arrangement for more editing? (${clip(reason, 120)})` : 'Reopen this arrangement for more editing?';
        const answer = await env.store.askHuman(question, [{ label: REOPEN_YES }, { label: REOPEN_NO }]);
        if (answer !== REOPEN_YES) {
          return {
            ok: false,
            status: 'cancelled_by_human',
            answer,
            error: answer === null ? 'The person did not answer, so the arrangement stays exported.' : `The person answered “${answer}”, so the arrangement stays exported.`,
            next_step: 'Leave it as it is. Say what you would have changed and let them decide.',
          };
        }
        env.store.reopen('agent');
        return {
          ok: true,
          phase: env.store.phase,
          answer,
          next_step: 'The arranging tools are back. Call get_score, make the one change they asked for, then let them export again.',
        };
      },
    },
  ];
}

// ---------------------------------------------------------------- key helpers

/** Middle-octave MIDI number of a key's tonic, so two keys can be compared. */
function keyTonicMidi(key: string): number | null {
  const tonic = key.trim().replace(/\s*(major|minor)\s*$/i, '').replace(/m$/, '');
  return pitchToMidi(`${tonic}4`);
}

// ---------------------------------------------------------------- surface

/** Tool surface for the current phase: 'empty' | 'arranging' | 'exported'. */
export function buildSurface(env: ToolEnv): { name: string; specs: ToolSpec[] } {
  const phase = env.store.phase;
  if (phase === 'empty') return { name: 'empty:no-score', specs: emptySpecs(env).map(guard) };
  const score = env.store.score!;
  const n = score.parts.length;
  const name = `${phase}:${n}-${n === 1 ? 'part' : 'parts'}:${score.level}`;
  const specs = phase === 'exported' ? exportedSpecs(env) : arrangingSpecs(env);
  return { name, specs: specs.map(guard) };
}
