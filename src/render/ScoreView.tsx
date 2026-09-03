// CONTRACT — implemented by the notation agent (VexFlow).
import type { CheckIssue, Score } from '../core/types';
import type { CursorPos } from '../audio/player';

export interface Selection {
  partId: string;
  measure: number;
  note: number;
}

export interface ScoreViewProps {
  score: Score;
  /** 'full' = conductor score (all parts, braced system); 'part' = one part alone in its written key. */
  view: { mode: 'full' | 'part'; partId?: string };
  cursor: CursorPos | null;
  issues: CheckIssue[];
  selection: Selection | null;
  /** The part an agent is writing right now — highlight its staff. */
  writingPart: string | null;
  onSelectNote: (sel: Selection | null) => void;
  /** Arrow keys / drag: move the selected note by semitones. */
  onNudgeNote: (sel: Selection, semitones: number) => void;
  onToggleLock: (partId: string, measure: number) => void;
}

export function ScoreView(props: ScoreViewProps) {
  return <div className="score-view" data-parts={props.score.parts.length} />;
}
