// CONTRACT — implemented by the panels agent.
import type { CheckIssue, Level, Score, TimeSig, Activity } from '../core/types';
import type { AskRequest, EnsembleSpec, View } from '../store';
import type { Preset } from '../data/presets';
import type { CursorPos } from '../audio/player';

export interface EnsemblePanelProps {
  score: Score;
  issues: CheckIssue[];
  onSetEnsemble: (specs: EnsembleSpec[], level?: Level) => void;
  onSetMeta: (patch: { title?: string; tempo?: number; level?: Level }) => void;
  onSetKey: (key: string) => void;
  onSetTime: (time: TimeSig) => void;
}
export function EnsemblePanel(_p: EnsemblePanelProps) {
  return <section className="card" />;
}

export interface TransportProps {
  score: Score;
  playing: boolean;
  position: CursorPos | null;
  view: View;
  onPlay: (from?: number) => void;
  onStop: () => void;
  onTempo: (tempo: number) => void;
  onToggleMute: (partId: string, muted: boolean) => void;
  onView: (view: View) => void;
}
export function Transport(_p: TransportProps) {
  return <section className="transport" />;
}

export interface AskHumanCardProps {
  ask: AskRequest | null;
  playingOption: string | null;
  onPlayOption: (label: string) => void;
  onAnswer: (label: string | null) => void;
}
export function AskHumanCard(_p: AskHumanCardProps) {
  return null;
}

export interface ExportBarProps {
  score: Score;
  exported: boolean;
  onExport: (what: 'musicxml' | 'parts' | 'midi' | 'print') => void;
  onReopen: () => void;
}
export function ExportBar(_p: ExportBarProps) {
  return <section className="export-bar" />;
}

export interface EmptyStateProps {
  presets: Preset[];
  agentDetected: boolean;
  onLoadPreset: (id: string) => void;
  onJudge: () => void;
}
export function EmptyState(_p: EmptyStateProps) {
  return <section className="empty-state" />;
}

export interface IssueListProps {
  score: Score;
  issues: CheckIssue[];
  onFocus: (partId: string, measure: number) => void;
}
export function IssueList(_p: IssueListProps) {
  return <section className="issues" />;
}

export interface ActivityFeedProps {
  log: Activity[];
}
export function ActivityFeed(_p: ActivityFeedProps) {
  return <section className="activity" />;
}
