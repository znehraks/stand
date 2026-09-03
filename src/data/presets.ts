// CONTRACT — implemented by the preset agent. Public-domain melodies only, with the source named.
import type { Measure, TimeSig } from '../core/types';

export interface Preset {
  id: string;
  title: string;
  key: string;
  time: TimeSig;
  tempo: number;
  /** Sounding pitches. Every bar must total exactly one bar of `time`. */
  melody: Measure[];
  chords?: string[];
  /** Where it comes from and why it is public domain. */
  source: string;
}

export const PRESETS: Preset[] = [];
