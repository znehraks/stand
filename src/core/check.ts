// CONTRACT — implemented by the checker agent.
import type { CheckIssue, Measure, Part, Score } from './types';

/** Every issue in the score: ranges, bar lengths, level-appropriate rhythm and key, leaps, voice crossing, parallel fifths. */
export function checkScore(score: Score): CheckIssue[] {
  return [];
}

/** Issues for one part only. */
export function checkPart(score: Score, partId: string): CheckIssue[] {
  return [];
}

/**
 * Validate a proposed write BEFORE it lands. Errors reject the write; warnings pass through.
 * Must catch: bar length ≠ time signature, unknown pitches, notes outside the instrument's
 * sounding range at the score's level, rhythms too fine for the level, and locked bars (warning).
 */
export function validateWrite(score: Score, part: Part, from: number, measures: Measure[]): CheckIssue[] {
  return [];
}

/** Human-readable one-liner for an issue list. */
export function describeIssue(score: Score, issue: CheckIssue): string {
  return issue.message;
}
