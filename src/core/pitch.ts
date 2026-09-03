// Pitch and key arithmetic. Sounding pitches in, written pitches out. No dependencies.

const STEPS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const STEP_SEMIS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export interface ParsedPitch {
  step: string;
  /** -2..2 semitones of accidental */
  alter: number;
  octave: number;
}

export function isRest(pitch: string): boolean {
  return !pitch || pitch === 'r' || pitch === 'R';
}

export function parsePitch(pitch: string): ParsedPitch | null {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|)(-?\d{1,2})$/.exec(pitch.trim());
  if (!m) return null;
  const step = m[1].toUpperCase();
  const acc = m[2];
  const alter = acc.startsWith('#') ? acc.length : acc.startsWith('b') ? -acc.length : 0;
  const octave = Number(m[3]);
  if (octave < -1 || octave > 9) return null;
  return { step, alter, octave };
}

/** Scientific pitch to MIDI number. C4 = 60. Returns null for rests and garbage. */
export function pitchToMidi(pitch: string): number | null {
  if (isRest(pitch)) return null;
  const p = parsePitch(pitch);
  if (!p) return null;
  return (p.octave + 1) * 12 + STEP_SEMIS[p.step] + p.alter;
}

/** MIDI number to a pitch name, spelled for the given key signature (fifths). */
export function midiToPitch(midi: number, fifths = 0): string {
  const pc = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const name = fifths > 0 ? SHARP_NAMES[pc] : FLAT_NAMES[pc];
  return `${name}${octave}`;
}

/** Transpose a sounding pitch by semitones, spelled for a target key signature. Rests pass through. */
export function transposePitch(pitch: string, semitones: number, fifths = 0): string {
  if (isRest(pitch)) return 'r';
  const midi = pitchToMidi(pitch);
  if (midi === null) return pitch;
  return midiToPitch(midi + semitones, fifths);
}

const KEY_FIFTHS: Record<string, number> = {
  C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7,
  Am: 0, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, Dm: -1, Gm: -2, Cm: -3, Fm: -4, Bbm: -5, Ebm: -6,
};

export function keyFifths(key: string): number {
  const k = key.trim();
  if (k in KEY_FIFTHS) return KEY_FIFTHS[k];
  const alt = k.replace(/ (major|minor)$/i, (s) => (s.toLowerCase().includes('minor') ? 'm' : ''));
  return KEY_FIFTHS[alt] ?? 0;
}

export function isMinorKey(key: string): boolean {
  return /m$/.test(key.trim()) || /minor/i.test(key);
}

const MAJOR_BY_FIFTHS: Record<number, string> = { 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#', [-1]: 'F', [-2]: 'Bb', [-3]: 'Eb', [-4]: 'Ab', [-5]: 'Db', [-6]: 'Gb', [-7]: 'Cb' };
const MINOR_BY_FIFTHS: Record<number, string> = { 0: 'Am', 1: 'Em', 2: 'Bm', 3: 'F#m', 4: 'C#m', 5: 'G#m', 6: 'D#m', [-1]: 'Dm', [-2]: 'Gm', [-3]: 'Cm', [-4]: 'Fm', [-5]: 'Bbm', [-6]: 'Ebm', [-7]: 'Abm' };

export function keyFromFifths(fifths: number, minor = false): string {
  const f = Math.max(-7, Math.min(7, fifths));
  return (minor ? MINOR_BY_FIFTHS : MAJOR_BY_FIFTHS)[f] ?? (minor ? 'Am' : 'C');
}

/** Fifths delta for a transposition in semitones: +2 semitones = +2 fifths, +3 = -3, +9 = +3. */
export function fifthsDelta(semitones: number): number {
  let d = ((semitones * 7) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

/** The key signature a transposing instrument reads, given the concert key. */
export function writtenKey(concertKey: string, transposition: number): string {
  const minor = isMinorKey(concertKey);
  return keyFromFifths(keyFifths(concertKey) + fifthsDelta(transposition), minor);
}

/** Semitone distance between two pitches (absolute). Rests return 0. */
export function interval(a: string, b: string): number {
  const ma = pitchToMidi(a);
  const mb = pitchToMidi(b);
  if (ma === null || mb === null) return 0;
  return Math.abs(mb - ma);
}

/** Pitch class name without the octave, e.g. 'Bb4' -> 'Bb'. */
export function pitchClassName(pitch: string): string {
  const p = parsePitch(pitch);
  if (!p) return pitch;
  return p.step + (p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '');
}

/** VexFlow key string for a sounding pitch and transposition, e.g. 'bb/4'. */
export function vexKey(soundingPitch: string, transposition: number, writtenFifths: number): string {
  const written = transposePitch(soundingPitch, transposition, writtenFifths);
  const p = parsePitch(written);
  if (!p) return 'b/4';
  const acc = p.alter > 0 ? '#'.repeat(p.alter) : p.alter < 0 ? 'b'.repeat(-p.alter) : '';
  return `${p.step.toLowerCase()}${acc}/${p.octave}`;
}

export const STEP_ORDER = STEPS;
