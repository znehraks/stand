// CONTRACT — implemented by the harmony agent.
import type { Measure, Score } from './types';

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

/** Rule-based voicing draft the agent can accept or rewrite. Never exceeds each target's range at the score level. */
export function harmonize(score: Score, opts: HarmonizeOptions): HarmonizeResult {
  return { measuresByPart: {}, from: opts.from ?? 0, notes: [] };
}
