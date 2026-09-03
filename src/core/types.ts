// Stand — shared domain types. This file is the contract every module compiles against.
// Pitches are stored as SOUNDING (concert) pitch, scientific notation: 'C4', 'Bb3', 'F#5', or 'r' for a rest.
// Written (transposed) notation is derived at render/export time via Instrument.transposition.

export type Level = 'elementary' | 'middle' | 'high' | 'adult';
export const LEVELS: Level[] = ['elementary', 'middle', 'high', 'adult'];

/** Duration codes. 'd' suffix = dotted. */
export type Dur = 'w' | 'h' | 'q' | '8' | '16' | 'hd' | 'qd' | '8d';
export const DUR_TICKS: Record<Dur, number> = { w: 1920, hd: 1440, h: 960, qd: 720, q: 480, '8d': 360, '8': 240, '16': 120 };
export const DURS: Dur[] = ['w', 'hd', 'h', 'qd', 'q', '8d', '8', '16'];
/** VexFlow duration strings, without the dot flag. */
export const DUR_VEX: Record<Dur, string> = { w: 'w', hd: 'h', h: 'h', qd: 'q', q: 'q', '8d': '8', '8': '8', '16': '16' };
export const IS_DOTTED: Record<Dur, boolean> = { w: false, hd: true, h: false, qd: true, q: false, '8d': true, '8': false, '16': false };

export type Dynamic = 'pp' | 'p' | 'mp' | 'mf' | 'f' | 'ff';
export type Articulation = 'staccato' | 'accent' | 'tenuto';

export interface Note {
  /** Sounding pitch ('C4', 'Bb3', 'F#5') or 'r' for a rest. */
  pitch: string;
  dur: Dur;
  /** Tie into the next note of the same pitch. */
  tie?: boolean;
  dyn?: Dynamic;
  art?: Articulation;
  lyric?: string;
}

export interface Measure {
  notes: Note[];
  /** A locked measure is never overwritten by an agent. Only a person can lock or unlock it. */
  locked?: boolean;
}

export type Clef = 'treble' | 'bass' | 'alto' | 'percussion';
export type Section = 'woodwind' | 'brass' | 'percussion' | 'string' | 'voice' | 'keyboard';

export interface Instrument {
  id: string;
  name: string;
  /** Short label used on the staff, e.g. 'Fl.' */
  short: string;
  clef: Clef;
  section: Section;
  /** Semitones to ADD to a sounding pitch to get the written pitch. Bb clarinet = +2, Eb alto sax = +9, F horn = +7, piccolo = -12, C instruments = 0. */
  transposition: number;
  /** Comfortable SOUNDING range per level, inclusive: [lowest, highest]. */
  range: Record<Level, [string, string]>;
  /** Unpitched percussion is written on a single line and never range-checked. */
  unpitched?: boolean;
  /** Search aliases (lowercase). */
  aliases?: string[];
  /** Lower sorts higher on the page within a section. */
  orderHint?: number;
}

export interface Part {
  /** Unique within the score, e.g. 'flute-1'. */
  id: string;
  instrumentId: string;
  /** Human label shown on the staff, e.g. 'Flute 1'. */
  label: string;
  measures: Measure[];
  muted?: boolean;
}

export type TimeSig = '4/4' | '3/4' | '2/4' | '2/2' | '6/8';
export const TIME_TICKS: Record<TimeSig, number> = { '4/4': 1920, '3/4': 1440, '2/4': 960, '2/2': 1920, '6/8': 1440 };
export const TIME_BEATS: Record<TimeSig, [number, number]> = { '4/4': [4, 4], '3/4': [3, 4], '2/4': [2, 4], '2/2': [2, 2], '6/8': [6, 8] };

export interface Score {
  title: string;
  /** Concert key, e.g. 'C', 'F', 'Bb', 'Eb', 'G', 'D', 'A', 'Ab', 'Db'. Minor keys use 'Am' style. */
  key: string;
  time: TimeSig;
  tempo: number;
  level: Level;
  parts: Part[];
  /** One chord symbol per measure ('' = none), e.g. ['C', 'G', 'Am', 'F']. */
  chords: string[];
  /** Provenance note shown in the UI, e.g. the public-domain source of the melody. */
  source?: string;
}

export type IssueKind =
  | 'range'
  | 'measure-length'
  | 'rhythm'
  | 'key-difficulty'
  | 'leap'
  | 'voice-crossing'
  | 'parallel-fifths'
  | 'unknown-pitch'
  | 'locked';

export interface CheckIssue {
  severity: 'error' | 'warning';
  kind: IssueKind;
  partId?: string;
  /** 0-based measure index. */
  measure?: number;
  /** 0-based note index inside the measure. */
  note?: number;
  message: string;
  suggestion?: string;
}

export interface Activity {
  id: string;
  at: number;
  by: 'agent' | 'hand' | 'system';
  text: string;
}

export type Phase = 'empty' | 'arranging' | 'exported';

/** A candidate passage an agent can play for the person to choose between. */
export interface Variant {
  partId: string;
  from: number;
  measures: Measure[];
}

export function ticksOf(m: Measure): number {
  return m.notes.reduce((s, n) => s + (DUR_TICKS[n.dur] ?? 0), 0);
}

export function emptyMeasure(time: TimeSig): Measure {
  const total = TIME_TICKS[time];
  const notes: Note[] = [];
  let left = total;
  for (const d of ['w', 'h', 'q', '8', '16'] as Dur[]) {
    while (left >= DUR_TICKS[d]) {
      notes.push({ pitch: 'r', dur: d });
      left -= DUR_TICKS[d];
    }
  }
  return { notes };
}

export function measureCount(score: Score): number {
  return score.parts.reduce((n, p) => Math.max(n, p.measures.length), 0);
}
