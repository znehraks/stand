// Stand — the checker. This is the component that lets the page push back on an agent's write.
// Everything in here is pure: a Score goes in, a list of CheckIssue comes out. Errors reject a
// write (the store refuses it and hands the agent the reason); warnings are reported and allowed.
//
// Pitches in a Score are SOUNDING. Ranges in the instrument table are SOUNDING. Written pitch and
// the written key signature are derived here only so the message says what the player will read.

import { INSTRUMENTS, findInstrument, rangeFor, scoreOrder } from './instruments';
import {
  fifthsDelta,
  isMinorKey,
  isRest,
  keyFifths,
  keyFromFifths,
  midiToPitch,
  parsePitch,
  pitchToMidi,
  transposePitch,
  writtenKey,
} from './pitch';
import {
  DUR_TICKS,
  TIME_BEATS,
  TIME_TICKS,
  type CheckIssue,
  type Dur,
  type Instrument,
  type Level,
  type Measure,
  type Note,
  type Part,
  type Score,
  type TimeSig,
} from './types';

// ---------------------------------------------------------------- level rules

/** How many sharps/flats the WRITTEN key signature may carry at each level. */
const KEY_TOLERANCE: Record<Level, number> = { elementary: 2, middle: 3, high: 4, adult: 7 };
/** Widest comfortable melodic leap, in semitones. 12 = an octave, 19 = a twelfth. */
const LEAP_LIMIT: Record<Level, number> = { elementary: 12, middle: 19, high: 127, adult: 127 };
/** Durations that are simply too fine to read at this level. */
const BANNED_DURS: Record<Level, Dur[]> = { elementary: ['16', '8d'], middle: [], high: [], adult: [] };
/** Longest run of consecutive sixteenths tolerated at this level. */
const MAX_SIXTEENTH_RUN: Record<Level, number> = { elementary: 0, middle: 4, high: 64, adult: 64 };

const DUR_NAME: Record<Dur, string> = {
  w: 'whole note',
  hd: 'dotted half note',
  h: 'half note',
  qd: 'dotted quarter note',
  q: 'quarter note',
  '8d': 'dotted eighth note',
  '8': 'eighth note',
  '16': 'sixteenth note',
};

const LIMIT_NAME: Record<number, string> = { 12: 'an octave', 19: 'a twelfth' };

// ---------------------------------------------------------------- small helpers

function barTicksOf(time: TimeSig): number {
  return TIME_TICKS[time] ?? 1920;
}

function beatTicks(time: TimeSig): number {
  const [, denom] = TIME_BEATS[time] ?? [4, 4];
  return 1920 / denom;
}

function fmtBeats(ticks: number, time: TimeSig): string {
  const b = ticks / beatTicks(time);
  return Number.isInteger(b) ? String(b) : b.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** '1200' -> 'half note + quarter note'. Used to say exactly what a short bar is missing. */
function spellTicks(ticks: number): string {
  let left = Math.max(0, Math.round(ticks));
  const names: string[] = [];
  for (const d of ['w', 'h', 'q', '8', '16'] as Dur[]) {
    while (left >= DUR_TICKS[d]) {
      names.push(DUR_NAME[d]);
      left -= DUR_TICKS[d];
    }
  }
  return names.length ? names.join(' + ') : `${Math.round(ticks)} ticks`;
}

function isKnownDur(d: unknown): d is Dur {
  return typeof d === 'string' && Object.prototype.hasOwnProperty.call(DUR_TICKS, d);
}

function instrumentOf(part: Part): Instrument | null {
  return INSTRUMENTS[part.instrumentId] ?? findInstrument(part.instrumentId);
}

function rangeOf(inst: Instrument, level: Level): [number, number] | null {
  const r = rangeFor(inst, level) ?? inst.range?.[level];
  if (!r) return null;
  const lo = pitchToMidi(r[0]);
  const hi = pitchToMidi(r[1]);
  if (lo === null || hi === null) return null;
  return lo <= hi ? [lo, hi] : [hi, lo];
}

function writtenFifthsOf(score: Score, inst: Instrument | null): number {
  return keyFifths(writtenKey(score.key, inst?.transposition ?? 0));
}

function written(pitch: string, inst: Instrument | null, fifths: number): string {
  return transposePitch(pitch, inst?.transposition ?? 0, fifths);
}

function partLabel(score: Score, partId: string | undefined): string {
  if (!partId) return '';
  return score.parts.find((p) => p.id === partId)?.label ?? partId;
}

// ---------------------------------------------------------------- tick timeline

interface Ev {
  /** 0-based bar. */
  bar: number;
  /** 0-based note index inside the bar. */
  index: number;
  /** Absolute tick, measured with nominal bar lengths so parts stay aligned. */
  start: number;
  end: number;
  note: Note;
  /** null for rests and unreadable pitches. */
  midi: number | null;
}

function timelineOf(time: TimeSig, measures: Measure[], firstBar = 0): Ev[] {
  const bar = barTicksOf(time);
  const out: Ev[] = [];
  measures.forEach((m, i) => {
    const base = (firstBar + i) * bar;
    let at = 0;
    (m.notes ?? []).forEach((n, j) => {
      const len = isKnownDur(n.dur) ? DUR_TICKS[n.dur] : 0;
      const midi = isRest(String(n.pitch ?? '')) ? null : pitchToMidi(String(n.pitch));
      out.push({ bar: firstBar + i, index: j, start: base + at, end: base + at + len, note: n, midi });
      at += len;
    });
  });
  return out;
}

/** The event sounding at an absolute tick, or null (rest, gap, or past the end). */
function soundingAt(events: Ev[], tick: number): Ev | null {
  for (const e of events) {
    if (e.midi === null) continue;
    if (e.start <= tick && tick < e.end) return e;
  }
  return null;
}

/** Beats a listener hears as structural — where parallel fifths are audible. */
function strongOffsets(time: TimeSig): number[] {
  switch (time) {
    case '4/4':
    case '2/2':
      return [0, 960];
    case '6/8':
      return [0, 720];
    default:
      return [0];
  }
}

// ---------------------------------------------------------------- per-bar checks

interface ScanOptions {
  /** checkScore skips bars nobody has written yet; validateWrite refuses them. */
  allowEmpty: boolean;
}

function lengthIssue(score: Score, part: Part, m: Measure, bar: number, opts: ScanOptions): CheckIssue | null {
  const notes = m.notes ?? [];
  const need = barTicksOf(score.time);
  if (notes.length === 0) {
    if (opts.allowEmpty) return null;
    return {
      severity: 'error',
      kind: 'measure-length',
      partId: part.id,
      measure: bar,
      message: `${part.label} bar ${bar + 1} is empty: 0 ticks (0 beats) where ${score.time} needs ${need} ticks (${fmtBeats(need, score.time)} beats).`,
      suggestion: `Fill it — ${spellTicks(need)} of notes or rests.`,
    };
  }
  const bad = notes.find((n) => !isKnownDur(n.dur));
  if (bad) {
    return {
      severity: 'error',
      kind: 'measure-length',
      partId: part.id,
      measure: bar,
      message: `${part.label} bar ${bar + 1} uses an unknown duration “${String(bad.dur)}”, so the bar cannot be measured.`,
      suggestion: 'Durations are w, hd, h, qd, q, 8d, 8, 16.',
    };
  }
  const got = notes.reduce((s, n) => s + DUR_TICKS[n.dur], 0);
  if (got === need) return null;
  const diff = Math.abs(need - got);
  return {
    severity: 'error',
    kind: 'measure-length',
    partId: part.id,
    measure: bar,
    message: `${part.label} bar ${bar + 1} adds up to ${got} ticks (${fmtBeats(got, score.time)} beats) but ${score.time} needs ${need} ticks (${fmtBeats(need, score.time)} beats).`,
    suggestion:
      got < need
        ? `It is short by ${diff} ticks — add ${spellTicks(diff)} (a rest will do).`
        : `It is over by ${diff} ticks — drop or shorten ${spellTicks(diff)}.`,
  };
}

function noteIssues(score: Score, part: Part, m: Measure, bar: number): CheckIssue[] {
  const out: CheckIssue[] = [];
  const inst = instrumentOf(part);
  const fifths = writtenFifthsOf(score, inst);
  const range = inst && !inst.unpitched ? rangeOf(inst, score.level) : null;
  (m.notes ?? []).forEach((n, j) => {
    const raw = String(n.pitch ?? '');
    if (isRest(raw)) return;
    if (!parsePitch(raw)) {
      out.push({
        severity: 'error',
        kind: 'unknown-pitch',
        partId: part.id,
        measure: bar,
        note: j,
        message: `${part.label} bar ${bar + 1} note ${j + 1}: “${raw}” is not a pitch I can read.`,
        suggestion: 'Use sounding scientific notation — C4, Bb3, F#5 — or “r” for a rest.',
      });
      return;
    }
    if (!range || !inst) return;
    const midi = pitchToMidi(raw);
    if (midi === null) return;
    const [lo, hi] = range;
    if (midi >= lo && midi <= hi) return;
    const above = midi > hi;
    const [loName, hiName] = rangeFor(inst, score.level) ?? [midiToPitch(lo, fifths), midiToPitch(hi, fifths)];
    out.push({
      severity: 'error',
      kind: 'range',
      partId: part.id,
      measure: bar,
      note: j,
      message: `${part.label}${part.label.toLowerCase() === inst.name.toLowerCase() ? '' : ` (${inst.name})`} bar ${bar + 1} note ${j + 1}: written ${written(raw, inst, fifths)} (sounding ${raw}) is ${above ? 'above' : 'below'} the ${score.level} range ${loName}–${hiName} sounding (${written(loName, inst, fifths)}–${written(hiName, inst, fifths)} written).`,
      suggestion: rangeSuggestion(score, part, inst, raw, midi, range, [loName, hiName], fifths, above),
    });
  });
  return out;
}

function rangeSuggestion(
  score: Score,
  part: Part,
  inst: Instrument,
  raw: string,
  midi: number,
  range: [number, number],
  names: [string, string],
  fifths: number,
  above: boolean,
): string {
  const [lo, hi] = range;
  const shifted = midi + (above ? -12 : 12);
  if (shifted >= lo && shifted <= hi) {
    const sounding = midiToPitch(shifted, keyFifths(score.key));
    return `${above ? 'Drop it an octave' : 'Raise it an octave'} to sounding ${sounding} (written ${written(sounding, inst, fifths)}).`;
  }
  for (const other of score.parts) {
    if (other.id === part.id) continue;
    const oi = instrumentOf(other);
    if (!oi || oi.unpitched) continue;
    const r = rangeOf(oi, score.level);
    if (!r || midi < r[0] || midi > r[1]) continue;
    return `Move this line to ${other.label} (${oi.name}) — it can play sounding ${raw} at ${score.level}.`;
  }
  return `No part in this score can play it at ${score.level} — rewrite the line inside ${names[0]}–${names[1]} sounding, or raise the level.`;
}

function rhythmIssues(score: Score, part: Part, m: Measure, bar: number): CheckIssue[] {
  const banned = BANNED_DURS[score.level] ?? [];
  if (!banned.length) return [];
  const out: CheckIssue[] = [];
  for (const d of banned) {
    const j = (m.notes ?? []).findIndex((n) => n.dur === d);
    if (j < 0) continue;
    out.push({
      severity: 'warning',
      kind: 'rhythm',
      partId: part.id,
      measure: bar,
      note: j,
      message: `${part.label} bar ${bar + 1} uses ${DUR_NAME[d]}s — that is finer than ${score.level} players read comfortably.`,
      suggestion: `Keep ${score.level} parts to whole, half, dotted-half, quarter and eighth notes.`,
    });
  }
  return out;
}

/** Runs of sixteenths, counted across bar lines. Reported on the bar where the run starts. */
function sixteenthRunIssues(score: Score, part: Part, measures: Measure[], firstBar: number): CheckIssue[] {
  const max = MAX_SIXTEENTH_RUN[score.level] ?? 64;
  if (max <= 0 || max >= 64) return [];
  const out: CheckIssue[] = [];
  let run = 0;
  let startBar = 0;
  let startNote = 0;
  const flush = () => {
    if (run > max) {
      out.push({
        severity: 'warning',
        kind: 'rhythm',
        partId: part.id,
        measure: startBar,
        note: startNote,
        message: `${part.label} bar ${startBar + 1} starts a run of ${run} sixteenth notes — ${score.level} players read at most ${max} in a row.`,
        suggestion: 'Break the run with an eighth note or a rest, or give half of it to another part.',
      });
    }
    run = 0;
  };
  measures.forEach((m, i) => {
    (m.notes ?? []).forEach((n, j) => {
      if (n.dur === '16') {
        if (run === 0) {
          startBar = firstBar + i;
          startNote = j;
        }
        run += 1;
      } else flush();
    });
  });
  flush();
  return out;
}

function leapIssues(score: Score, part: Part, measures: Measure[], firstBar: number): CheckIssue[] {
  const limit = LEAP_LIMIT[score.level] ?? 127;
  if (limit >= 127) return [];
  const out: CheckIssue[] = [];
  const sounded = timelineOf(score.time, measures, firstBar).filter((e) => e.midi !== null);
  for (let i = 1; i < sounded.length; i++) {
    const a = sounded[i - 1];
    const b = sounded[i];
    const semis = Math.abs((b.midi as number) - (a.midi as number));
    if (semis <= limit) continue;
    out.push({
      severity: 'warning',
      kind: 'leap',
      partId: part.id,
      measure: b.bar,
      note: b.index,
      message: `${part.label} bar ${b.bar + 1}: ${a.note.pitch} → ${b.note.pitch} leaps ${semis} semitones — wider than ${LIMIT_NAME[limit] ?? `${limit} semitones`}, which is the ${score.level} limit.`,
      suggestion: 'Approach the note by step, or hand the far end of the leap to another part.',
    });
  }
  return out;
}

function keyDifficultyIssue(score: Score, part: Part): CheckIssue | null {
  const inst = instrumentOf(part);
  const tol = KEY_TOLERANCE[score.level] ?? 7;
  const tr = inst?.transposition ?? 0;
  const wk = writtenKey(score.key, tr);
  const acc = Math.abs(keyFifths(wk));
  if (acc <= tol) return null;
  const minor = isMinorKey(score.key);
  const here = keyFifths(score.key);
  const delta = fifthsDelta(tr);
  let best: number | null = null;
  for (let f = -7; f <= 7; f++) {
    if (Math.abs(f + delta) > tol) continue;
    if (best === null || Math.abs(f - here) < Math.abs(best - here)) best = f;
  }
  const alt = best === null ? null : keyFromFifths(best, minor);
  return {
    severity: 'warning',
    kind: 'key-difficulty',
    partId: part.id,
    message: `${part.label} reads in ${wk} — ${acc} ${acc === 1 ? 'accidental' : 'accidentals'}, and ${score.level} parts should stay within ${tol}${tr ? ` (${inst?.name ?? 'the instrument'} transposes ${tr > 0 ? '+' : ''}${tr})` : ''}.`,
    suggestion: alt
      ? `Concert ${alt} would read as ${writtenKey(alt, tr)} (${Math.abs(keyFifths(writtenKey(alt, tr)))} accidentals).`
      : `Raise the level, or move this line to a part in a friendlier key.`,
  };
}

/** Everything that can be judged from one part's own notes. */
function scanMeasures(score: Score, part: Part, measures: Measure[], firstBar: number, opts: ScanOptions): CheckIssue[] {
  const out: CheckIssue[] = [];
  measures.forEach((m, i) => {
    const bar = firstBar + i;
    const len = lengthIssue(score, part, m, bar, opts);
    if (len) out.push(len);
    out.push(...noteIssues(score, part, m, bar));
    out.push(...rhythmIssues(score, part, m, bar));
  });
  out.push(...sixteenthRunIssues(score, part, measures, firstBar));
  out.push(...leapIssues(score, part, measures, firstBar));
  return out;
}

// ---------------------------------------------------------------- between parts

interface Line {
  part: Part;
  inst: Instrument | null;
  events: Ev[];
  order: number;
}

function linesOf(score: Score): Line[] {
  return score.parts.map((part, idx) => {
    const inst = instrumentOf(part);
    return {
      part,
      inst,
      events: timelineOf(score.time, part.measures ?? []),
      order: inst ? scoreOrder(inst) * 1000 + idx : 9_000_000 + idx,
    };
  });
}

function voiceCrossingIssues(score: Score, lines: Line[], focus: Set<string> | null): CheckIssue[] {
  const out: CheckIssue[] = [];
  const bar = barTicksOf(score.time);
  const sections = new Map<string, Line[]>();
  for (const l of lines) {
    if (!l.inst || l.inst.unpitched) continue;
    const key = l.inst.section;
    const group = sections.get(key);
    if (group) group.push(l);
    else sections.set(key, [l]);
  }
  for (const group of sections.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => a.order - b.order);
    for (let i = 0; i + 1 < ordered.length; i++) {
      const upper = ordered[i];
      const lower = ordered[i + 1];
      if (focus && !focus.has(upper.part.id) && !focus.has(lower.part.id)) continue;
      const bars = Math.max(upper.part.measures?.length ?? 0, lower.part.measures?.length ?? 0);
      for (let b = 0; b < bars; b++) {
        const us = upper.events.filter((e) => e.bar === b && e.midi !== null);
        const ls = lower.events.filter((e) => e.bar === b && e.midi !== null);
        if (!us.length || !ls.length) continue;
        let compared = 0;
        let crossed = 0;
        let sampleLower = '';
        let sampleUpper = '';
        for (const u of us) {
          for (const l of ls) {
            const start = Math.max(u.start, l.start);
            const end = Math.min(u.end, l.end);
            if (end <= start) continue;
            compared += end - start;
            if ((l.midi as number) > (u.midi as number)) {
              crossed += end - start;
              if (!sampleLower) {
                sampleLower = String(l.note.pitch);
                sampleUpper = String(u.note.pitch);
              }
            }
          }
        }
        if (compared === 0 || crossed !== compared || compared < bar / 2) continue;
        out.push({
          severity: 'warning',
          kind: 'voice-crossing',
          partId: lower.part.id,
          measure: b,
          message: `${lower.part.label} sits above ${upper.part.label} for all of bar ${b + 1} (${sampleLower} over ${sampleUpper}) — they are both ${upper.inst?.section} parts, and ${upper.part.label} is the upper staff.`,
          suggestion: `Swap the two lines in this bar, or drop ${lower.part.label} to the note below ${upper.part.label}.`,
        });
      }
    }
  }
  return out;
}

function parallelFifthIssues(score: Score, lines: Line[], focus: Set<string> | null): CheckIssue[] {
  const out: CheckIssue[] = [];
  const barTicks = barTicksOf(score.time);
  const bars = Math.max(0, ...lines.map((l) => l.part.measures?.length ?? 0));
  if (bars < 1 || lines.length < 2) return out;
  const points: number[] = [];
  for (let b = 0; b < bars; b++) for (const off of strongOffsets(score.time)) points.push(b * barTicks + off);
  points.sort((a, b) => a - b);
  const usable = lines.filter((l) => !l.inst?.unpitched);
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      const A = usable[i];
      const B = usable[j];
      if (focus && !focus.has(A.part.id) && !focus.has(B.part.id)) continue;
      for (let k = 1; k < points.length; k++) {
        const t1 = points[k - 1];
        const t2 = points[k];
        const a1 = soundingAt(A.events, t1);
        const a2 = soundingAt(A.events, t2);
        const b1 = soundingAt(B.events, t1);
        const b2 = soundingAt(B.events, t2);
        if (!a1 || !a2 || !b1 || !b2) continue;
        const moveA = (a2.midi as number) - (a1.midi as number);
        const moveB = (b2.midi as number) - (b1.midi as number);
        if (moveA === 0 || moveB === 0) continue;
        if (Math.sign(moveA) !== Math.sign(moveB)) continue;
        const iv1 = Math.abs((a1.midi as number) - (b1.midi as number));
        const iv2 = Math.abs((a2.midi as number) - (b2.midi as number));
        if (iv1 % 12 !== 7 || iv2 % 12 !== 7) continue;
        const bar1 = Math.floor(t1 / barTicks);
        const bar2 = Math.floor(t2 / barTicks);
        const beat1 = Math.floor((t1 % barTicks) / beatTicks(score.time)) + 1;
        const beat2 = Math.floor((t2 % barTicks) / beatTicks(score.time)) + 1;
        out.push({
          severity: 'warning',
          kind: 'parallel-fifths',
          partId: focus && focus.has(B.part.id) && !focus.has(A.part.id) ? B.part.id : A.part.id,
          measure: bar2,
          message: `${A.part.label} and ${B.part.label} move in parallel fifths from bar ${bar1 + 1} beat ${beat1} to bar ${bar2 + 1} beat ${beat2} (${a1.note.pitch}/${b1.note.pitch} → ${a2.note.pitch}/${b2.note.pitch}).`,
          suggestion: `Move ${B.part.label} in the other direction on that beat, or land on a third or a sixth instead.`,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- public API

function collect(score: Score, focus: Set<string> | null): CheckIssue[] {
  const issues: CheckIssue[] = [];
  if (!score || !Array.isArray(score.parts)) return issues;
  for (const part of score.parts) {
    if (focus && !focus.has(part.id)) continue;
    issues.push(...scanMeasures(score, part, part.measures ?? [], 0, { allowEmpty: true }));
    const key = keyDifficultyIssue(score, part);
    if (key) issues.push(key);
  }
  const lines = linesOf(score);
  issues.push(...voiceCrossingIssues(score, lines, focus));
  issues.push(...parallelFifthIssues(score, lines, focus));
  return sortIssues(issues);
}

function sortIssues(issues: CheckIssue[]): CheckIssue[] {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
    const am = a.measure ?? -1;
    const bm = b.measure ?? -1;
    if (am !== bm) return am - bm;
    return (a.note ?? -1) - (b.note ?? -1);
  });
}

/** Every issue in the score: ranges, bar lengths, level-appropriate rhythm and key, leaps, voice crossing, parallel fifths. */
export function checkScore(score: Score): CheckIssue[] {
  return collect(score, null);
}

/** Issues for one part only — including the between-part issues it takes part in. */
export function checkPart(score: Score, partId: string): CheckIssue[] {
  if (!score || !Array.isArray(score.parts)) return [];
  const q = String(partId).toLowerCase().trim();
  const part =
    score.parts.find((p) => p.id.toLowerCase() === q) ??
    score.parts.find((p) => p.label.toLowerCase() === q) ??
    score.parts.find((p) => p.instrumentId.toLowerCase() === q);
  if (!part) return [];
  return collect(score, new Set([part.id]));
}

/**
 * Validate a proposed write BEFORE it lands. Errors reject the write; warnings pass through.
 * Bar numbers are absolute (`from` + index) so the message points at the bar on the page.
 */
export function validateWrite(score: Score, part: Part, from: number, measures: Measure[]): CheckIssue[] {
  if (!score || !part) return [];
  const start = Math.max(0, Math.round(from));
  const list = Array.isArray(measures) ? measures : [];
  const issues = scanMeasures(score, part, list, start, { allowEmpty: false });
  list.forEach((_, i) => {
    const idx = start + i;
    if (!part.measures?.[idx]?.locked) return;
    issues.push({
      severity: 'warning',
      kind: 'locked',
      partId: part.id,
      measure: idx,
      message: `${part.label} bar ${idx + 1} is locked — it stays as the person left it and this write skips it.`,
      suggestion: 'Unlock the bar on the page if it really should change.',
    });
  });
  return sortIssues(issues);
}

/** Human-readable one-liner for an issue. Bars are 1-based. */
export function describeIssue(score: Score, issue: CheckIssue): string {
  const label = partLabel(score, issue.partId);
  const bar = issue.measure === undefined ? '' : `bar ${issue.measure + 1}`;
  const head = issue.severity === 'error' ? 'Error' : 'Warning';
  const where: string[] = [];
  if (label && !issue.message.includes(label)) where.push(label);
  if (bar && !issue.message.includes(bar)) where.push(bar);
  const prefix = where.length ? `${where.join(' ')}: ` : '';
  const tail = issue.suggestion ? ` ${issue.suggestion}` : '';
  return `${head} (${issue.kind}) — ${prefix}${issue.message}${tail}`.replace(/\s+/g, ' ').trim();
}
