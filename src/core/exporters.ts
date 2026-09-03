// CONTRACT — implemented by the export agent.
import type { Score } from './types';

/** Full conductor score as MusicXML 4.0 partwise, with <transpose> per transposing part. */
export function toMusicXML(score: Score): string {
  return '';
}

/** One part alone, in its written (transposed) notation. */
export function toPartMusicXML(score: Score, partId: string): string {
  return '';
}

/** Standard MIDI file bytes (sounding pitches, one track per part). */
export function toMidiBytes(score: Score): Uint8Array {
  return new Uint8Array();
}

/** Plain-text lead sheet fallback (title, key, chords, part list) for quick inspection. */
export function toTextSummary(score: Score): string {
  return '';
}
