// Panels — every piece of chrome around the score: ensemble editor, transport, the agent's
// question card, export bar, the first screen, the check list and the activity feed.
// Nothing here mutates the store directly; every control calls the prop it was handed.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LEVELS,
  TIME_BEATS,
  TIME_TICKS,
  measureCount,
  ticksOf,
  type Activity,
  type CheckIssue,
  type Instrument,
  type Level,
  type Part,
  type Score,
  type Section,
  type TimeSig,
} from '../core/types';
import type { AskRequest, EnsembleSpec, View } from '../store';
import type { Preset } from '../data/presets';
import { player, type CursorPos } from '../audio/player';
import { INSTRUMENTS, SECTION_ORDER, findInstrument, rangeFor, scoreOrder } from '../core/instruments';
import { writtenKey } from '../core/pitch';
import { describeIssue } from '../core/check';

// ---------------------------------------------------------------- shared bits

function instOf(part: Part): Instrument | null {
  return INSTRUMENTS[part.instrumentId] ?? findInstrument(part.instrumentId);
}

function rangeText(inst: Instrument | null, level: Level): string {
  if (!inst) return '—';
  if (inst.unpitched) return 'unpitched';
  const r = inst.range ? rangeFor(inst, level) : null;
  return r && r[0] && r[1] ? `${r[0]}–${r[1]}` : '—';
}

/** '+2 semitones (reads a step higher)' style hint for a transposing instrument. */
function transposeHint(inst: Instrument | null): string {
  if (!inst) return '';
  const t = inst.transposition;
  if (!t) return 'Concert pitch — written where it sounds.';
  const sign = t > 0 ? '+' : '−';
  return `Written ${sign}${Math.abs(t)} semitones from concert pitch.`;
}

/** True when the part label already says the instrument ('Flute 1' for a Flute), so we don't say it twice. */
function sameName(part: Part, inst: Instrument | null): boolean {
  if (!inst) return false;
  return part.label.toLowerCase().replace(/\s*\d+$/, '') === inst.name.toLowerCase();
}

function shortLabel(part: Part, inst: Instrument | null): string {
  if (inst?.short) {
    const n = /\s(\d)$/.exec(part.label);
    return n ? `${inst.short} ${n[1]}` : inst.short;
  }
  return part.label.length > 9 ? `${part.label.slice(0, 8)}…` : part.label;
}

const SECTION_TITLE: Record<string, string> = {
  woodwind: 'Woodwinds',
  brass: 'Brass',
  percussion: 'Percussion',
  string: 'Strings',
  voice: 'Voices',
  keyboard: 'Keyboard',
};

function groupedInstruments(): { section: string; items: Instrument[] }[] {
  const all = Object.values(INSTRUMENTS).sort((a, b) => scoreOrder(a) - scoreOrder(b) || a.name.localeCompare(b.name));
  const groups: { section: string; items: Instrument[] }[] = [];
  for (const section of SECTION_ORDER) {
    const items = all.filter((i) => i.section === section);
    if (items.length) groups.push({ section, items });
  }
  const rest = all.filter((i) => !SECTION_ORDER.includes(i.section));
  if (rest.length) groups.push({ section: 'other', items: rest });
  return groups;
}

/** The current ensemble expressed as specs, so a row can be added or dropped and sent back whole. */
function specsFromScore(score: Score): EnsembleSpec[] {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const p of score.parts) {
    if (!counts.has(p.instrumentId)) {
      order.push(p.instrumentId);
      labels.set(p.instrumentId, p.label);
    }
    counts.set(p.instrumentId, (counts.get(p.instrumentId) ?? 0) + 1);
  }
  return order.map((id) => {
    const count = counts.get(id) ?? 1;
    const spec: EnsembleSpec = { instrument: id, count };
    if (count === 1) spec.label = labels.get(id);
    return spec;
  });
}

function specsWithout(score: Score, partId: string): EnsembleSpec[] {
  const kept = score.parts.filter((p) => p.id !== partId);
  return specsFromScore({ ...score, parts: kept });
}

function specsPlus(score: Score, instrumentId: string): EnsembleSpec[] {
  const specs = specsFromScore(score);
  const hit = specs.find((s) => s.instrument === instrumentId);
  if (hit) {
    hit.count = Math.min(4, (hit.count ?? 1) + 1);
    delete hit.label;
    return specs;
  }
  const inst = INSTRUMENTS[instrumentId] ?? findInstrument(instrumentId);
  const next: EnsembleSpec[] = [...specs, { instrument: instrumentId, count: 1 }];
  // Keep the page order musical: winds above brass above percussion above strings above voices.
  if (inst) {
    next.sort((a, b) => {
      const ia = INSTRUMENTS[a.instrument] ?? findInstrument(a.instrument);
      const ib = INSTRUMENTS[b.instrument] ?? findInstrument(b.instrument);
      return (ia ? scoreOrder(ia) : 999) - (ib ? scoreOrder(ib) : 999);
    });
  }
  return next;
}

// ---------------------------------------------------------------- EnsemblePanel

const KEY_PAIRS: [string, string][] = [
  ['C', 'Am'],
  ['F', 'Dm'],
  ['Bb', 'Gm'],
  ['Eb', 'Cm'],
  ['Ab', 'Fm'],
  ['G', 'Em'],
  ['D', 'Bm'],
  ['A', 'F#m'],
];
const TIMES: TimeSig[] = ['4/4', '3/4', '2/4', '2/2', '6/8'];
const LEVEL_SHORT: Record<Level, string> = { elementary: 'elem', middle: 'middle', high: 'high', adult: 'adult' };

interface EnsemblePresetDef {
  id: string;
  name: string;
  hint: string;
  level: Level;
  want: { section: Section; queries: string[]; count?: number }[];
}

const ENSEMBLE_PRESETS: EnsemblePresetDef[] = [
  {
    id: 'beginning-band',
    name: 'Beginning band',
    hint: '7 players · elementary',
    level: 'elementary',
    want: [
      { section: 'woodwind', queries: ['flute'], count: 2 },
      { section: 'woodwind', queries: ['clarinet'] },
      { section: 'woodwind', queries: ['alto sax', 'saxophone'] },
      { section: 'brass', queries: ['trumpet', 'cornet'] },
      { section: 'brass', queries: ['trombone', 'horn'] },
      { section: 'percussion', queries: ['snare', 'drum'] },
    ],
  },
  {
    id: 'string-trio',
    name: 'String trio',
    hint: '3 players · high school',
    level: 'high',
    want: [
      { section: 'string', queries: ['violin'] },
      { section: 'string', queries: ['viola'] },
      { section: 'string', queries: ['cello', 'violoncello'] },
    ],
  },
  {
    id: 'satb',
    name: 'SATB choir',
    hint: '4 voices · adult',
    level: 'adult',
    want: [
      { section: 'voice', queries: ['soprano'] },
      { section: 'voice', queries: ['alto'] },
      { section: 'voice', queries: ['tenor'] },
      { section: 'voice', queries: ['bass'] },
    ],
  },
];

/** Resolve inside one section, so 'alto' finds the voice and never the saxophone. */
function pickInSection(section: Section, queries: string[]): string | null {
  const pool = Object.values(INSTRUMENTS).filter((i) => i.section === section);
  for (const raw of queries) {
    const q = raw.toLowerCase();
    const hit =
      pool.find((i) => i.id === q) ??
      pool.find((i) => i.name.toLowerCase() === q) ??
      pool.find((i) => (i.aliases ?? []).includes(q)) ??
      pool.find((i) => i.name.toLowerCase().includes(q) || (i.aliases ?? []).some((a) => a.includes(q)));
    if (hit) return hit.id;
  }
  return null;
}

function presetSpecs(preset: EnsemblePresetDef): EnsembleSpec[] {
  return preset.want.map((w) => ({ instrument: pickInSection(w.section, w.queries) ?? w.queries[0], count: w.count ?? 1 }));
}

export interface EnsemblePanelProps {
  score: Score;
  issues: CheckIssue[];
  onSetEnsemble: (specs: EnsembleSpec[], level?: Level) => void;
  onSetMeta: (patch: { title?: string; tempo?: number; level?: Level }) => void;
  onSetKey: (key: string) => void;
  onSetTime: (time: TimeSig) => void;
}

export function EnsemblePanel({ score, issues, onSetEnsemble, onSetMeta, onSetKey, onSetTime }: EnsemblePanelProps) {
  const [pick, setPick] = useState('');
  const [title, setTitle] = useState(score.title);
  const [tempo, setTempo] = useState(String(score.tempo));

  useEffect(() => setTitle(score.title), [score.title]);
  useEffect(() => setTempo(String(score.tempo)), [score.tempo]);

  const groups = useMemo(groupedInstruments, [Object.keys(INSTRUMENTS).length]);
  const errorsByPart = useMemo(() => {
    const m = new Map<string, { total: number; range: number }>();
    for (const i of issues) {
      if (i.severity !== 'error' || !i.partId) continue;
      const e = m.get(i.partId) ?? { total: 0, range: 0 };
      e.total += 1;
      if (i.kind === 'range') e.range += 1;
      m.set(i.partId, e);
    }
    return m;
  }, [issues]);

  const keyOptions = useMemo(() => {
    const majors = KEY_PAIRS.map((p) => p[0]);
    const minors = KEY_PAIRS.map((p) => p[1]);
    if (!majors.includes(score.key) && !minors.includes(score.key)) majors.unshift(score.key);
    return { majors, minors };
  }, [score.key]);

  const timeFits = useCallback(
    (t: TimeSig) => score.parts.every((p) => p.measures.every((m) => m.notes.length === 0 || ticksOf(m) === TIME_TICKS[t])),
    [score],
  );

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(score.title);
    if (t !== score.title) onSetMeta({ title: t });
  };
  const commitTempo = () => {
    const n = Math.round(Number(tempo));
    if (!Number.isFinite(n) || n < 30 || n > 240) return setTempo(String(score.tempo));
    if (n !== score.tempo) onSetMeta({ tempo: n });
  };

  return (
    <section className="card ens" data-testid="ensemble-panel">
      <div className="card-h">
        <h3>Ensemble</h3>
        <span className="pill">{score.parts.length} {score.parts.length === 1 ? 'part' : 'parts'}</span>
      </div>
      <div className="card-b stack">
        <div className="ens-presets">
          {ENSEMBLE_PRESETS.map((p) => (
            <button
              key={p.id}
              className="btn sm ghost ens-preset"
              data-testid={`ens-preset-${p.id}`}
              title={`Replace the ensemble with ${p.name.toLowerCase()} (${p.hint})`}
              onClick={() => onSetEnsemble(presetSpecs(p), p.level)}
            >
              <b>{p.name}</b>
              <span className="muted">{p.hint}</span>
            </button>
          ))}
        </div>

        <ul className="ens-parts">
          {score.parts.map((part) => {
            const inst = instOf(part);
            const err = errorsByPart.get(part.id);
            return (
              <li key={part.id} className={`ens-part${err ? ' has-error' : ''}`} data-testid={`ens-part-${part.id}`}>
                <div className="ens-part-head">
                  <b>{part.label}</b>
                  <span className="muted small">{sameName(part, inst) ? '' : inst?.name ?? part.instrumentId}</span>
                  <button
                    className="ens-remove"
                    aria-label={`Remove ${part.label}`}
                    title={score.parts.length > 1 ? `Remove ${part.label}` : 'A score needs at least one part'}
                    disabled={score.parts.length <= 1}
                    onClick={() => onSetEnsemble(specsWithout(score, part.id))}
                  >
                    ×
                  </button>
                </div>
                <div className="ens-pills">
                  <span className="pill" title={transposeHint(inst)}>
                    reads {inst ? writtenKey(score.key, inst.transposition) : score.key}
                  </span>
                  <span className="pill mono" title={`Comfortable sounding range at the ${score.level} level`}>
                    {rangeText(inst, score.level)}
                  </span>
                  {err && (
                    <span className="pill bad" title="Open the checks below to fix these">
                      {err.range ? `${err.range} out of range` : `${err.total} ${err.total === 1 ? 'error' : 'errors'}`}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="ens-add">
          <select
            aria-label="Add an instrument"
            value={pick}
            onChange={(e) => {
              const id = e.target.value;
              setPick('');
              if (id) onSetEnsemble(specsPlus(score, id));
            }}
          >
            <option value="">＋ Add an instrument…</option>
            {groups.map((g) => (
              <optgroup key={g.section} label={SECTION_TITLE[g.section] ?? g.section}>
                {g.items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="ens-meta">
          <div className="field-row">
            <span className="field-label">Level</span>
            <div className="seg">
              {LEVELS.map((l) => (
                <button key={l} className={l === score.level ? 'on' : ''} title={`${l} players`} onClick={() => onSetMeta({ level: l })}>
                  {LEVEL_SHORT[l]}
                </button>
              ))}
            </div>
          </div>

          <div className="ens-grid">
            <label className="field">
              Key
              <select value={score.key} onChange={(e) => onSetKey(e.target.value)}>
                <optgroup label="major">
                  {keyOptions.majors.map((k) => (
                    <option key={k} value={k}>
                      {k} major
                    </option>
                  ))}
                </optgroup>
                <optgroup label="minor">
                  {keyOptions.minors.map((k) => (
                    <option key={k} value={k}>
                      {k.replace(/m$/, '')} minor
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>

            <label className="field">
              Time
              <select value={score.time} onChange={(e) => onSetTime(e.target.value as TimeSig)}>
                {TIMES.map((t) => (
                  <option key={t} value={t} disabled={t !== score.time && !timeFits(t)}>
                    {t}
                    {t !== score.time && !timeFits(t) ? ' — bars would break' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              Tempo
              <input
                type="number"
                min={30}
                max={240}
                value={tempo}
                onChange={(e) => setTempo(e.target.value)}
                onBlur={commitTempo}
                onKeyDown={(e) => e.key === 'Enter' && commitTempo()}
              />
            </label>
          </div>

          <label className="field">
            Title
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && commitTitle()}
            />
          </label>
        </div>

        <p className="small muted ens-foot">
          Ranges are sounding pitch at the {score.level} level.{' '}
          {(() => {
            const seen = new Set<string>();
            const reads = score.parts
              .map((p) => instOf(p))
              .filter((i): i is Instrument => !!i && writtenKey(score.key, i.transposition) !== score.key)
              .filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true)))
              .map((i) => `${i.short} in ${writtenKey(score.key, i.transposition)}`);
            if (!reads.length) return `Every part reads the concert key of ${score.key}.`;
            return `Concert ${score.key}, but each player reads its own key: ${reads.slice(0, 4).join(', ')}${reads.length > 4 ? '…' : ''}.`;
          })()}
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Transport

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

export function Transport({ score, playing, position, view, onPlay, onStop, onTempo, onToggleMute, onView }: TransportProps) {
  const [tempo, setTempo] = useState(score.tempo);
  const [from, setFrom] = useState(1);
  useEffect(() => setTempo(score.tempo), [score.tempo]);

  const bars = Math.max(1, measureCount(score));
  const beatTicks = 1920 / TIME_BEATS[score.time][1];
  const bar = position ? position.measure + 1 : null;
  const beat = position ? Math.floor(position.tick / beatTicks) + 1 : null;
  const armed = player.armed();
  const commitTempo = () => {
    if (tempo !== score.tempo) onTempo(tempo);
  };

  return (
    <section className="transport" data-testid="transport">
      <div className="tp-row tp-main">
        <button className="btn accent" data-testid="play" onClick={() => onPlay(Math.max(0, Math.min(bars - 1, from - 1)))}>
          ▶ Play
        </button>
        <button className="btn sm" data-testid="stop" disabled={!playing} onClick={onStop}>
          ■ Stop
        </button>
        <label className="tp-from small muted">
          from bar
          <input
            type="number"
            min={1}
            max={bars}
            value={from}
            aria-label="Play from bar"
            onChange={(e) => setFrom(Math.max(1, Math.min(bars, Math.round(Number(e.target.value) || 1))))}
          />
        </label>
        <span className={`tp-pos mono${playing ? ' live' : ''}`} data-testid="position" aria-live="off">
          {bar ? `bar ${bar} · beat ${beat}` : `bar — · beat —`}
          <span className="muted"> / {bars}</span>
        </span>

        <label className="tp-tempo">
          <span className="mono">♩={tempo}</span>
          <input
            type="range"
            min={40}
            max={200}
            step={1}
            value={tempo}
            aria-label="Tempo"
            onChange={(e) => setTempo(Number(e.target.value))}
            onPointerUp={commitTempo}
            onKeyUp={commitTempo}
            onBlur={commitTempo}
          />
        </label>
      </div>

      <div className="tp-row tp-secondary">
        <div className="seg" role="group" aria-label="Score view">
          <button className={view.mode === 'full' ? 'on' : ''} onClick={() => onView({ mode: 'full' })} data-testid="view-full">
            Full score
          </button>
          <button
            className={view.mode === 'part' ? 'on' : ''}
            data-testid="view-part"
            onClick={() => onView({ mode: 'part', partId: view.partId ?? score.parts[0]?.id })}
          >
            Part
          </button>
        </div>
        <select
          aria-label="Which part"
          className="tp-partpick"
          disabled={view.mode !== 'part'}
          value={view.partId ?? score.parts[0]?.id ?? ''}
          onChange={(e) => onView({ mode: 'part', partId: e.target.value })}
        >
          {score.parts.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>

        <div className="tp-mutes" role="group" aria-label="Mute parts">
          {score.parts.map((p) => (
            <button
              key={p.id}
              className={`mute${p.muted ? ' off' : ''}`}
              aria-pressed={!p.muted}
              title={p.muted ? `Unmute ${p.label}` : `Mute ${p.label}`}
              onClick={() => onToggleMute(p.id, !p.muted)}
            >
              {p.muted ? '🔇 ' : ''}
              {shortLabel(p, instOf(p))}
            </button>
          ))}
        </div>
      </div>

      {!armed && (
        <p className="tp-hint small" data-testid="audio-hint">
          🔈 click anywhere once to enable sound
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- AskHumanCard

export interface AskHumanCardProps {
  ask: AskRequest | null;
  playingOption: string | null;
  onPlayOption: (label: string) => void;
  onAnswer: (label: string | null) => void;
}

export function AskHumanCard({ ask, playingOption, onPlayOption, onAnswer }: AskHumanCardProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ask) return;
    cardRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onAnswer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ask, onAnswer]);

  if (!ask) return null;

  return (
    <div className="ask-scrim" data-testid="ask-card">
      <div className="ask-card" role="dialog" aria-modal="true" aria-label="The agent is asking you to listen" tabIndex={-1} ref={cardRef}>
        <div className="ask-head">
          <span className="ask-badge">🤖 → 🎧</span>
          <div>
            <b>Your agent can't hear.</b>
            <span className="muted small"> It wrote both versions. You decide which one sounds right.</span>
          </div>
        </div>

        <p className="ask-q">{ask.question}</p>

        <ul className="ask-opts">
          {ask.options.map((o) => {
            const spinning = playingOption === o.label;
            const v = o.variant;
            return (
              <li key={o.label} className="ask-opt" data-label={o.label}>
                <button
                  className={`btn sm ask-play${spinning ? ' busy' : ''}`}
                  data-testid="ask-play"
                  data-label={o.label}
                  aria-label={`Play ${o.label}`}
                  disabled={spinning}
                  onClick={() => onPlayOption(o.label)}
                >
                  {spinning ? <i className="spinner" aria-hidden /> : '▶'}
                  <span>{spinning ? 'playing' : 'listen'}</span>
                </button>
                <span className="ask-opt-main">
                  <b>{o.label}</b>
                  {v && (
                    <span className="muted small mono">
                      {v.partId} · bars {v.from + 1}–{v.from + v.measures.length}
                    </span>
                  )}
                </span>
                <button className="btn sm primary" data-testid="ask-choose" data-label={o.label} onClick={() => onAnswer(o.label)}>
                  Choose
                </button>
              </li>
            );
          })}
        </ul>

        <div className="ask-foot">
          <span className="small muted">Nothing is written until you pick. The agent waits up to two minutes.</span>
          <button className="btn xs ghost" data-testid="ask-dismiss" onClick={() => onAnswer(null)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ExportBar

const EXPORTS: { key: 'musicxml' | 'parts' | 'midi' | 'print'; label: string; note: string }[] = [
  { key: 'musicxml', label: 'MusicXML', note: 'Full score — opens in MuseScore, Sibelius, Finale, Dorico' },
  { key: 'parts', label: 'Parts', note: 'One transposed file per player' },
  { key: 'midi', label: 'MIDI', note: 'Sounding pitch, for a DAW or a playback rehearsal track' },
  { key: 'print', label: 'Print', note: 'The score as it sits on the page' },
];

export interface ExportBarProps {
  score: Score;
  exported: boolean;
  onExport: (what: 'musicxml' | 'parts' | 'midi' | 'print') => void;
  onReopen: () => void;
}

export function ExportBar({ score, exported, onExport, onReopen }: ExportBarProps) {
  const bars = measureCount(score);
  return (
    <section className="export-bar" data-testid="export-bar">
      {exported && (
        <div className="export-done" role="status" data-testid="export-done">
          <span className="pill ok">✓ exported</span>
          <span className="small">
            The files left the page. Your agent can read the score but can't take it — only you can.
          </span>
          <button className="btn xs" data-testid="reopen" onClick={onReopen}>
            Reopen to keep editing
          </button>
        </div>
      )}
      <div className="export-row">
        <div className="export-meta small muted">
          <b className="ink">{score.title}</b> · {bars} {bars === 1 ? 'bar' : 'bars'} · {score.parts.length}{' '}
          {score.parts.length === 1 ? 'part' : 'parts'} · {score.key} {score.time}
        </div>
        <div className="export-btns">
          {EXPORTS.map((e) => (
            <button key={e.key} className={`btn sm${e.key === 'musicxml' ? ' primary' : ''}`} title={e.note} data-testid={`export-${e.key}`} onClick={() => onExport(e.key)}>
              {e.label}
            </button>
          ))}
        </div>
      </div>
      <p className="export-note small muted">Exporting is a human action. The agent can plan the files; you press the button.</p>
    </section>
  );
}

// ---------------------------------------------------------------- EmptyState

const SAMPLE_ASK =
  '“Arrange this for my fifth-grade band — two flutes, clarinet, alto sax, trumpet, trombone, snare. Easy key, easy rhythms.”';

export interface EmptyStateProps {
  presets: Preset[];
  agentDetected: boolean;
  onLoadPreset: (id: string) => void;
  onJudge: () => void;
}

export function EmptyState({ presets, agentDetected, onLoadPreset, onJudge }: EmptyStateProps) {
  return (
    <section className="empty-state" data-testid="empty-state">
      <div className="hero">
        <p className="eyebrow mono">WEBMCP · ARRANGING STUDIO</p>
        <h1 className="serif">An arranging studio your agent can write in.</h1>
        <p className="lede">
          Bring an ensemble and a level. Your agent writes the parts through this page's tools — the page checks every range and
          transposition and rejects what your players can't play. Then you listen, and you decide what leaves the page.
        </p>
        <div className="hero-actions">
          <button className="btn accent" data-testid="judge" onClick={onJudge}>
            ▶ Watch a 60-second demo (no agent needed)
          </button>
          <span className={`pill ${agentDetected ? 'ok' : ''}`} data-testid="agent-state">
            {agentDetected ? '● agent connected' : '○ no agent on this page'}
          </span>
        </div>
        <p className="agent-line small">
          {agentDetected ? (
            <>
              Your agent can see this page's tools. Say: <em>{SAMPLE_ASK}</em>
            </>
          ) : (
            <>
              Open Stand in ChatGPT's browser, or in Chrome with WebMCP enabled (<span className="mono">chrome://flags/#web-model-context</span>), then
              say: <em>{SAMPLE_ASK}</em> — or drive every tool by hand in the console below.
            </>
          )}
        </p>
      </div>

      <ol className="how">
        <li>
          <b>Pick a melody</b>
          <span className="muted small">Public domain, 8–16 bars. Or let your agent load one.</span>
        </li>
        <li>
          <b>Name your players</b>
          <span className="muted small">Two flutes and no trombone? Say so. Elementary through adult.</span>
        </li>
        <li>
          <b>Listen and choose</b>
          <span className="muted small">The page plays; the agent asks; you keep the last word.</span>
        </li>
      </ol>

      <div className="melodies">
        <div className="melodies-h">
          <h2>Start from a melody</h2>
          <span className="muted small">{presets.length} public-domain tunes</span>
        </div>
        {presets.length === 0 ? (
          <p className="muted small">No melodies are loaded yet. Ask your agent for <span className="mono">list_melodies</span>.</p>
        ) : (
          <div className="melody-grid">
            {presets.map((p) => (
              <button key={p.id} className="melody" data-testid={`preset-${p.id}`} onClick={() => onLoadPreset(p.id)}>
                <b>{p.title}</b>
                <span className="mono small">
                  {p.key} · {p.time} · {p.melody.length} bars · ♩={p.tempo}
                </span>
                <span className="melody-src muted small">{p.source}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- IssueList

/** Drop a locator the checker already wrote into its message, so the chip isn't said twice. */
function trimLocator(text: string, label: string, bar: number | null): string {
  if (bar === null || !label) return text;
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${esc}\\s*(\\([^)]*\\))?\\s*(bar|m\\.?)\\s*${bar}\\s*(note\\s*\\d+)?\\s*[:,—-]?\\s*`, 'i');
  const out = text.replace(re, '');
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : text;
}

export interface IssueListProps {
  score: Score;
  issues: CheckIssue[];
  onFocus: (partId: string, measure: number) => void;
}

export function IssueList({ score, issues, onFocus }: IssueListProps) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const line = (issue: CheckIssue, i: number) => {
    const part = issue.partId ? score.parts.find((p) => p.id === issue.partId) : undefined;
    const bar = typeof issue.measure === 'number' ? issue.measure + 1 : null;
    const label = part?.label ?? issue.partId ?? '';
    const text = trimLocator(issue.message || describeIssue(score, issue), label, bar);
    const fix = issue.suggestion && !issue.message.includes(issue.suggestion) ? issue.suggestion : null;
    const clickable = !!issue.partId && bar !== null;
    const body = (
      <>
        <span className={`issue-dot ${issue.severity}`} aria-hidden />
        <span className="issue-body">
          {(label || bar !== null) && (
            <span className="issue-loc mono">
              {label}
              {bar !== null ? ` bar ${bar}` : ''}
              {typeof issue.note === 'number' ? ` · note ${issue.note + 1}` : ''}
            </span>
          )}
          <span className="issue-msg" title={text}>
            {text}
          </span>
          {fix && (
            <span className="issue-fix muted small" title={fix}>
              {fix}
            </span>
          )}
        </span>
      </>
    );
    const key = `${issue.severity}-${issue.kind}-${issue.partId ?? ''}-${issue.measure ?? ''}-${issue.note ?? ''}-${i}`;
    return clickable ? (
      <li key={key}>
        <button className={`issue ${issue.severity}`} data-testid="issue" onClick={() => onFocus(issue.partId as string, issue.measure as number)}>
          {body}
        </button>
      </li>
    ) : (
      <li key={key}>
        <div className={`issue ${issue.severity} static`} data-testid="issue">
          {body}
        </div>
      </li>
    );
  };

  return (
    <section className="card issues" data-testid="issue-list">
      <div className="card-h">
        <h3>Checks</h3>
        <span className="row" style={{ gap: 6 }}>
          {errors.length > 0 && <span className="pill bad">{errors.length} error{errors.length === 1 ? '' : 's'}</span>}
          {warnings.length > 0 && <span className="pill warn">{warnings.length} warning{warnings.length === 1 ? '' : 's'}</span>}
          {errors.length === 0 && warnings.length === 0 && <span className="pill ok">clear</span>}
        </span>
      </div>
      <div className="card-b">
        {errors.length === 0 && warnings.length === 0 ? (
          <p className="issues-empty small muted">
            Every note sits inside its player's range at the {score.level} level, and every bar fills its time signature.
          </p>
        ) : (
          <ul className="issue-list">
            {errors.map(line)}
            {warnings.map((w, i) => line(w, errors.length + i))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- ActivityFeed

const ICONS: Record<Activity['by'], string> = { agent: '🤖', hand: '✋', system: '⚙' };

function ago(now: number, at: number): string {
  if (!at || at <= 0 || now <= 0) return '';
  const ms = Math.max(0, now - at);
  if (ms < 5000) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export interface ActivityFeedProps {
  log: Activity[];
}

export function ActivityFeed({ log }: ActivityFeedProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);
  const entries = useMemo(() => [...log].reverse(), [log]);

  return (
    <section className="card activity" data-testid="activity-feed">
      <div className="card-h">
        <h3>Activity</h3>
        <span className="pill">{log.length}</span>
      </div>
      <div className="card-b">
        {entries.length === 0 ? (
          <p className="small muted">Nothing yet. Every agent call and every hand edit lands here, in one line each.</p>
        ) : (
          <ul className="act-list">
            {entries.map((a) => (
              <li key={a.id} className={`act by-${a.by}`} data-testid="activity-row">
                <span className="act-icon" aria-hidden>
                  {ICONS[a.by] ?? '·'}
                </span>
                <span className="act-text">{a.text}</span>
                <span className="act-time mono muted">{ago(now, a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
