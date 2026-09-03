// Stand's single source of truth. Every mutation — from an agent tool, from a person's click,
// from the judge-mode script — goes through this store, so validation, locks, undo and the
// activity log behave identically no matter who acted.

import { checkScore, validateWrite } from './core/check';
import { findInstrument, INSTRUMENTS } from './core/instruments';
import { PRESETS } from './data/presets';
import { isRest, pitchToMidi, midiToPitch, keyFifths } from './core/pitch';
import {
  DUR_TICKS,
  TIME_TICKS,
  emptyMeasure,
  measureCount,
  ticksOf,
  type Activity,
  type CheckIssue,
  type Dynamic,
  type Articulation,
  type Level,
  type Measure,
  type Note,
  type Part,
  type Phase,
  type Score,
  type TimeSig,
  type Variant,
} from './core/types';

export interface EnsembleSpec {
  /** Instrument id or a human name ('trumpet', 'Bb Clarinet'). */
  instrument: string;
  count?: number;
  label?: string;
}

export interface AskRequest {
  id: string;
  question: string;
  options: { label: string; variant?: Variant }[];
  resolve: (answer: string | null) => void;
}

export interface WriteResult {
  ok: boolean;
  error?: string;
  issues?: CheckIssue[];
  skipped?: number[];
  written?: number[];
}

export interface View {
  mode: 'full' | 'part';
  partId?: string;
}

type Listener = () => void;

let seq = 0;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq.toString(36)}`;
}

export class StandStore {
  score: Score | null = null;
  view: View = { mode: 'full' };
  writingPart: string | null = null;
  ask: AskRequest | null = null;
  log: Activity[] = [];
  exported = false;
  selection: { partId: string; measure: number; note: number } | null = null;
  private undoStack: Score[] = [];
  private listeners = new Set<Listener>();
  /** Monotonic clock injected by the app (avoids Date.now in pure modules). */
  now: () => number = () => 0;

  get phase(): Phase {
    if (!this.score) return 'empty';
    return this.exported ? 'exported' : 'arranging';
  }

  get issues(): CheckIssue[] {
    return this.score ? checkScore(this.score) : [];
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private record(by: Activity['by'], text: string): void {
    this.log = [...this.log.slice(-99), { id: nextId('a'), at: this.now(), by, text }];
  }

  private snapshot(): void {
    if (!this.score) return;
    this.undoStack = [...this.undoStack.slice(-29), structuredClone(this.score)];
  }

  undo(by: Activity['by'] = 'hand'): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.score = prev;
    this.record(by, 'undo');
    this.emit();
    return true;
  }

  // ---------- loading ----------

  loadPreset(id: string, by: Activity['by'] = 'hand'): { ok: boolean; error?: string } {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS.find((p) => p.title.toLowerCase().includes(id.toLowerCase()));
    if (!preset) return { ok: false, error: `No melody preset “${id}”. Available: ${PRESETS.map((p) => p.id).join(', ')}` };
    const melodyInstrument = INSTRUMENTS['flute'] ? 'flute' : Object.keys(INSTRUMENTS)[0];
    this.score = {
      title: preset.title,
      key: preset.key,
      time: preset.time,
      tempo: preset.tempo,
      level: 'middle',
      chords: preset.chords ? [...preset.chords] : preset.melody.map(() => ''),
      source: preset.source,
      parts: [{ id: 'melody', instrumentId: melodyInstrument, label: 'Melody', measures: structuredClone(preset.melody) }],
    };
    this.undoStack = [];
    this.exported = false;
    this.view = { mode: 'full' };
    this.record(by, `loaded the melody “${preset.title}” (${preset.melody.length} bars, ${preset.source})`);
    this.emit();
    return { ok: true };
  }

  loadScore(score: Score, by: Activity['by'] = 'hand'): void {
    this.score = structuredClone(score);
    this.undoStack = [];
    this.exported = false;
    this.record(by, `loaded a score: ${score.title}`);
    this.emit();
  }

  reset(): void {
    this.score = null;
    this.undoStack = [];
    this.log = [];
    this.exported = false;
    this.view = { mode: 'full' };
    this.selection = null;
    this.emit();
  }

  // ---------- settings ----------

  setMeta(patch: { title?: string; tempo?: number; level?: Level }, by: Activity['by'] = 'hand'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    this.snapshot();
    const changes: string[] = [];
    if (patch.title !== undefined) {
      this.score.title = String(patch.title).slice(0, 80);
      changes.push(`title → ${this.score.title}`);
    }
    if (patch.tempo !== undefined) {
      const t = Math.round(Number(patch.tempo));
      if (!Number.isFinite(t) || t < 30 || t > 240) return { ok: false, error: 'tempo must be 30–240' };
      this.score.tempo = t;
      changes.push(`tempo → ${t}`);
    }
    if (patch.level !== undefined) {
      this.score.level = patch.level;
      changes.push(`level → ${patch.level}`);
    }
    if (changes.length) this.record(by, changes.join(', '));
    this.emit();
    return { ok: true, issues: this.issues };
  }

  setKey(key: string, by: Activity['by'] = 'hand'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    this.snapshot();
    this.score.key = key;
    this.record(by, `key → ${key}`);
    this.emit();
    return { ok: true, issues: this.issues };
  }

  setTime(time: TimeSig, by: Activity['by'] = 'hand'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    const bad: string[] = [];
    for (const p of this.score.parts) {
      p.measures.forEach((m, i) => {
        if (ticksOf(m) !== TIME_TICKS[time] && m.notes.length > 0) bad.push(`${p.label} m.${i + 1}`);
      });
    }
    if (bad.length) return { ok: false, error: `changing to ${time} would break these bars: ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? '…' : ''}. Rewrite them first.` };
    this.snapshot();
    this.score.time = time;
    this.record(by, `time signature → ${time}`);
    this.emit();
    return { ok: true };
  }

  /** Replace the ensemble. Parts whose instrument is unchanged keep their music. */
  setEnsemble(specs: EnsembleSpec[], level: Level | undefined, by: Activity['by'] = 'hand'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet — load a melody first' };
    if (!specs.length) return { ok: false, error: 'give at least one instrument' };
    const bars = Math.max(1, measureCount(this.score));
    const old = this.score.parts;
    const kept = new Set<string>();
    const parts: Part[] = [];
    const unknown: string[] = [];
    for (const spec of specs) {
      const inst = findInstrument(spec.instrument);
      if (!inst) {
        unknown.push(spec.instrument);
        continue;
      }
      const count = Math.max(1, Math.min(4, Math.round(spec.count ?? 1)));
      for (let n = 1; n <= count; n++) {
        const id = count > 1 ? `${inst.id}-${n}` : inst.id;
        const label = spec.label && count === 1 ? spec.label : count > 1 ? `${inst.name} ${n}` : inst.name;
        const prior = old.find((p) => p.id === id) ?? (kept.has('melody') ? undefined : old.find((p) => p.instrumentId === inst.id && !kept.has(p.id)));
        if (prior) kept.add(prior.id);
        parts.push({
          id,
          instrumentId: inst.id,
          label,
          measures: prior ? structuredClone(prior.measures) : Array.from({ length: bars }, () => emptyMeasure(this.score!.time)),
        });
      }
    }
    if (!parts.length) return { ok: false, error: `no known instruments in [${specs.map((s) => s.instrument).join(', ')}]. Try: ${Object.keys(INSTRUMENTS).slice(0, 12).join(', ')}` };
    // Preserve the melody: if the old melody part is not represented, move its music into the first part that is empty.
    const melody = old.find((p) => p.id === 'melody');
    if (melody && !kept.has('melody')) {
      const target = parts.find((p) => p.measures.every((m) => m.notes.every((n) => isRest(n.pitch))));
      if (target) {
        target.measures = structuredClone(melody.measures);
        this.record('system', `moved the melody onto ${target.label}`);
      }
    }
    this.snapshot();
    this.score.parts = parts;
    if (level) this.score.level = level;
    for (const p of this.score.parts) {
      while (p.measures.length < bars) p.measures.push(emptyMeasure(this.score.time));
    }
    if (this.score.chords.length < bars) this.score.chords = [...this.score.chords, ...Array.from({ length: bars - this.score.chords.length }, () => '')];
    this.record(by, `ensemble → ${parts.map((p) => p.label).join(', ')}${level ? ` (${level})` : ''}`);
    this.emit();
    return { ok: true, error: unknown.length ? `unknown instruments ignored: ${unknown.join(', ')}` : undefined, issues: this.issues };
  }

  // ---------- writing music ----------

  /**
   * Write measures into a part starting at `from` (0-based). Locked measures are skipped, never
   * overwritten. If any measure fails validation the whole write is rejected with issues.
   */
  writePart(partId: string, from: number, measures: Measure[], by: Activity['by'] = 'agent'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    const part = this.findPart(partId);
    if (!part) return { ok: false, error: `no part “${partId}”. Parts: ${this.score.parts.map((p) => p.id).join(', ')}` };
    if (!Array.isArray(measures) || measures.length === 0) return { ok: false, error: 'measures must be a non-empty array' };
    if (measures.length > 64) return { ok: false, error: 'write at most 64 bars at a time' };
    const start = Math.max(0, Math.round(from));
    const issues = validateWrite(this.score, part, start, measures);
    const errors = issues.filter((i) => i.severity === 'error');
    if (errors.length) return { ok: false, error: errors.map((e) => e.message).join(' | '), issues };
    this.snapshot();
    const skipped: number[] = [];
    const written: number[] = [];
    measures.forEach((m, i) => {
      const idx = start + i;
      while (part.measures.length <= idx) part.measures.push(emptyMeasure(this.score!.time));
      if (part.measures[idx].locked) {
        skipped.push(idx + 1);
        return;
      }
      part.measures[idx] = { notes: m.notes.map((n) => ({ ...n })), locked: false };
      written.push(idx + 1);
    });
    const bars = measureCount(this.score);
    for (const p of this.score.parts) while (p.measures.length < bars) p.measures.push(emptyMeasure(this.score.time));
    while (this.score.chords.length < bars) this.score.chords.push('');
    this.record(by, `wrote ${part.label} bars ${written[0] ?? '-'}–${written[written.length - 1] ?? '-'}${skipped.length ? ` (skipped locked ${skipped.join(', ')})` : ''}`);
    this.emit();
    return { ok: true, written, skipped, issues: issues.filter((i) => i.severity === 'warning') };
  }

  writeChords(chords: string[], from = 0, by: Activity['by'] = 'agent'): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    this.snapshot();
    const bars = Math.max(measureCount(this.score), from + chords.length);
    const next = [...this.score.chords];
    while (next.length < bars) next.push('');
    chords.forEach((c, i) => (next[from + i] = String(c ?? '').slice(0, 12)));
    this.score.chords = next;
    this.record(by, `chords → ${chords.slice(0, 8).join(' | ')}${chords.length > 8 ? ' …' : ''}`);
    this.emit();
    return { ok: true };
  }

  /** Hand edit: move one note by semitones, or change its duration, or set dynamics/articulation. */
  editNote(
    partId: string,
    measure: number,
    note: number,
    patch: { semitones?: number; pitch?: string; dur?: Note['dur']; dyn?: Dynamic; art?: Articulation; rest?: boolean },
    by: Activity['by'] = 'hand',
  ): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    const part = this.findPart(partId);
    if (!part) return { ok: false, error: `no part “${partId}”` };
    const m = part.measures[measure];
    if (!m) return { ok: false, error: `no bar ${measure + 1} in ${part.label}` };
    const n = m.notes[note];
    if (!n) return { ok: false, error: `no note ${note + 1} in ${part.label} bar ${measure + 1}` };
    this.snapshot();
    const fifths = keyFifths(this.score.key);
    if (patch.rest) n.pitch = 'r';
    if (patch.pitch) n.pitch = patch.pitch;
    if (patch.semitones && !isRest(n.pitch)) {
      const midi = pitchToMidi(n.pitch);
      if (midi !== null) n.pitch = midiToPitch(midi + patch.semitones, fifths);
    }
    if (patch.dur) {
      const before = ticksOf(m);
      const delta = DUR_TICKS[patch.dur] - DUR_TICKS[n.dur];
      n.dur = patch.dur;
      const after = before + delta;
      const target = TIME_TICKS[this.score.time];
      if (after < target) m.notes.splice(note + 1, 0, { pitch: 'r', dur: shortestFor(target - after) });
      else if (after > target) {
        let over = after - target;
        for (let i = m.notes.length - 1; i > note && over > 0; i--) {
          const t = DUR_TICKS[m.notes[i].dur];
          if (t <= over) {
            m.notes.splice(i, 1);
            over -= t;
          }
        }
      }
    }
    if (patch.dyn) n.dyn = patch.dyn;
    if (patch.art) n.art = patch.art;
    this.record(by, `edited ${part.label} bar ${measure + 1}`);
    this.emit();
    return { ok: true, issues: this.issues };
  }

  toggleLock(partId: string, measure: number): WriteResult {
    if (!this.score) return { ok: false, error: 'no score yet' };
    const part = this.findPart(partId);
    if (!part || !part.measures[measure]) return { ok: false, error: 'no such bar' };
    part.measures[measure].locked = !part.measures[measure].locked;
    this.record('hand', `${part.measures[measure].locked ? 'locked' : 'unlocked'} ${part.label} bar ${measure + 1}`);
    this.emit();
    return { ok: true };
  }

  setMuted(partId: string, muted: boolean): void {
    const part = this.findPart(partId);
    if (!part) return;
    part.muted = muted;
    this.emit();
  }

  setView(view: View, by: Activity['by'] = 'hand'): void {
    this.view = view;
    if (view.mode === 'part' && view.partId) this.record(by, `showing ${this.findPart(view.partId)?.label ?? view.partId} alone`);
    this.emit();
  }

  setWritingPart(partId: string | null): void {
    this.writingPart = partId;
    this.emit();
  }

  setSelection(sel: StandStore['selection']): void {
    this.selection = sel;
    this.emit();
  }

  markExported(by: Activity['by'] = 'hand', what = 'score'): void {
    this.exported = true;
    this.record(by, `exported the ${what}`);
    this.emit();
  }

  reopen(by: Activity['by'] = 'hand'): void {
    this.exported = false;
    this.record(by, 'reopened the arrangement');
    this.emit();
  }

  findPart(idOrLabel: string): Part | undefined {
    if (!this.score) return undefined;
    const q = String(idOrLabel).toLowerCase().trim();
    return (
      this.score.parts.find((p) => p.id.toLowerCase() === q) ??
      this.score.parts.find((p) => p.label.toLowerCase() === q) ??
      this.score.parts.find((p) => p.label.toLowerCase().startsWith(q)) ??
      this.score.parts.find((p) => p.instrumentId === q)
    );
  }

  /** Ask the person a question with playable options. Resolves with the chosen label, or null on timeout/dismiss. */
  askHuman(question: string, options: AskRequest['options'], timeoutMs = 120000): Promise<string | null> {
    return new Promise((resolve) => {
      const id = nextId('ask');
      let done = false;
      const finish = (answer: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.ask = null;
        this.record(answer ? 'hand' : 'system', answer ? `chose “${answer}”` : 'did not answer the agent’s question');
        this.emit();
        resolve(answer);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      this.ask = { id, question, options, resolve: finish };
      this.record('agent', `asked: ${question}`);
      this.emit();
    });
  }

  recordPublic(by: Activity['by'], text: string): void {
    this.record(by, text);
    this.emit();
  }
}

function shortestFor(ticks: number): Note['dur'] {
  const order: Note['dur'][] = ['w', 'hd', 'h', 'qd', 'q', '8d', '8', '16'];
  for (const d of order) if (DUR_TICKS[d] <= ticks) return d;
  return '16';
}

export const store = new StandStore();
