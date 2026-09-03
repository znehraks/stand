// CONTRACT — implemented by the instrument-table agent.
// Sounding ranges per level; `transposition` = semitones to ADD to a sounding pitch to get the written pitch.
import type { Instrument, Level } from './types';

export const INSTRUMENTS: Record<string, Instrument> = {};
export const SECTION_ORDER: string[] = ['woodwind', 'brass', 'percussion', 'string', 'voice', 'keyboard'];

/** Resolve an id, name or alias ('trumpet', 'Bb Clarinet', 'alto sax') to an instrument. */
export function findInstrument(nameOrId: string): Instrument | null {
  const q = String(nameOrId).toLowerCase().trim();
  return (
    INSTRUMENTS[q] ??
    Object.values(INSTRUMENTS).find((i) => i.name.toLowerCase() === q) ??
    Object.values(INSTRUMENTS).find((i) => (i.aliases ?? []).includes(q)) ??
    Object.values(INSTRUMENTS).find((i) => i.name.toLowerCase().includes(q) || (i.aliases ?? []).some((a) => a.includes(q))) ??
    null
  );
}

export function instrumentIds(): string[] {
  return Object.keys(INSTRUMENTS);
}

/** Score order index (flutes above clarinets above brass above percussion, strings, voices). */
export function scoreOrder(instrument: Instrument): number {
  const s = SECTION_ORDER.indexOf(instrument.section);
  return (s < 0 ? 9 : s) * 100 + (instrument.orderHint ?? 50);
}

/** Sounding range for a level, inclusive. */
export function rangeFor(instrument: Instrument, level: Level): [string, string] {
  return instrument.range[level];
}
