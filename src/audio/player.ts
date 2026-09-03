// CONTRACT — implemented by the audio agent.
import type { Measure, Score } from '../core/types';

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

export const player: Player = {
  async unlock() {
    return false;
  },
  armed() {
    return false;
  },
  async play() {},
  async playVariant() {},
  stop() {},
  isPlaying() {
    return false;
  },
  onCursor() {
    return () => {};
  },
};
