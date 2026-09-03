// Notation view. VexFlow 5 draws the black-and-white engraving once per score signature;
// everything that changes fast (playback cursor, selection, issues, locks, the "agent is
// writing here" accent) is layered on top as DOM overlays so a moving cursor never forces
// a re-engrave.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Accidental,
  Annotation,
  Articulation,
  Barline,
  Beam,
  Dot,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  StaveTie,
  Voice,
  type RenderContext,
} from 'vexflow';

import type { CursorPos } from '../audio/player';
import { findInstrument } from '../core/instruments';
import { isRest, keyFifths, vexKey, writtenKey } from '../core/pitch';
import {
  DUR_VEX,
  IS_DOTTED,
  TIME_BEATS,
  TIME_TICKS,
  type Articulation as Artic,
  type CheckIssue,
  type Clef,
  type Measure,
  type Note,
  type Part,
  type Score,
  type Section,
} from '../core/types';
import './score.css';

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

// ---------------------------------------------------------------- geometry model

interface BarBox {
  partId: string;
  measure: number;
  system: number;
  row: number;
  /** Bar rectangle in SVG/CSS pixels (they are 1:1). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Baseline for the little lock button that sits above the bar. */
  lockY: number;
}

interface ColumnBox {
  measure: number;
  system: number;
  x: number;
  w: number;
  /** Where notes actually start inside the bar (after clef/key/time on the first bar). */
  noteX: number;
  top: number;
  bottom: number;
}

interface RowBox {
  partId: string;
  system: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  width: number;
  height: number;
  systems: number;
  bars: BarBox[];
  columns: ColumnBox[];
  rows: RowBox[];
}

const EMPTY_LAYOUT: Layout = { width: 0, height: 0, systems: 0, bars: [], columns: [], rows: [] };

// ---------------------------------------------------------------- constants

const PAD_X = 16;
const PAD_TOP = 10;
const PAD_BOTTOM = 24;
/** Height of the bar-number strip above the top stave of a system. */
const NUM_ROW = 19;
/** Stave() places its first line `spaceAboveStaffLn * spacingBetweenLinesPx` below its y. */
const HEADROOM = 40;
/** Distance from the top line to the bottom line of a normal 5-line stave. */
const STAVE_SPAN = 40;
const UI_FONT = 'Inter, system-ui, -apple-system, sans-serif';
const CHORD_FONT = 'Inter, system-ui, -apple-system, sans-serif';
const INK = '#16161c';
const FAINT = '#8a8880';

const ART_CODE: Record<Artic, string> = { staccato: 'a.', accent: 'a>', tenuto: 'a-' };

/** Key specs VexFlow's key-signature table understands. */
const VEX_KEYS = new Set([
  'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb',
  'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm',
]);

const REST_KEY: Record<Clef, string> = { treble: 'b/4', bass: 'd/3', alto: 'c/4', percussion: 'b/4' };

/**
 * Unpitched percussion keeps a full-height stave slot but shows only its middle line, so
 * clefs, time signatures, rests and the system bracket all keep their normal geometry.
 * 'b/4' already sits on that middle line in every clef we use.
 */
const PERC_LINES = [
  { visible: false },
  { visible: false },
  { visible: true },
  { visible: false },
  { visible: false },
];
/** Stem.UP — percussion on a single line is always stemmed upward. */
const STEM_UP = 1;

// ---------------------------------------------------------------- part resolution

interface PartInfo {
  part: Part;
  clef: Clef;
  section: Section;
  transposition: number;
  unpitched: boolean;
  /** Written key signature this player reads. */
  keySpec: string;
  label: string;
  short: string;
}

function abbreviate(label: string): string {
  const trimmed = (label || '').trim();
  if (!trimmed) return '—';
  const tail = /\s(\d+)$/.exec(trimmed);
  const head = tail ? trimmed.slice(0, tail.index) : trimmed;
  const words = head.split(/\s+/);
  const stem = words.length > 1 ? words.map((w) => w[0]).join('') : head.slice(0, 3) + '.';
  return tail ? `${stem} ${tail[1]}` : stem;
}

function partInfo(part: Part, score: Score): PartInfo {
  const inst = findInstrument(part.instrumentId) ?? findInstrument(part.label ?? '');
  const transposition = inst?.transposition ?? 0;
  const raw = writtenKey(score.key, transposition);
  const keySpec = VEX_KEYS.has(raw) ? raw : 'C';
  return {
    part,
    clef: inst?.clef ?? 'treble',
    section: inst?.section ?? 'woodwind',
    transposition,
    unpitched: inst?.unpitched === true,
    keySpec,
    label: part.label || inst?.name || part.instrumentId,
    short: inst?.short || abbreviate(part.label || part.instrumentId),
  };
}

function pickParts(score: Score, view: ScoreViewProps['view']): Part[] {
  if (view.mode === 'part' && view.partId) {
    const one = score.parts.find((p) => p.id === view.partId);
    if (one) return [one];
  }
  return score.parts;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function barsPerSystem(width: number, mode: 'full' | 'part', rows: number): number {
  if (mode === 'part') return clamp(Math.round(width / 165), 2, 12);
  let per = Math.round(width / 250);
  if (rows > 10) per -= 2;
  else if (rows > 6) per -= 1;
  return clamp(per, width < 420 ? 1 : 2, 8);
}

/**
 * Cheap identity of everything VexFlow actually draws. Locks, mutes, the cursor and the
 * selection are deliberately absent — those are overlay-only, so they never re-engrave.
 */
function scoreSignature(score: Score, view: ScoreViewProps['view']): string {
  const parts = pickParts(score, view);
  const body = parts
    .map(
      (p) =>
        `${p.id}~${p.instrumentId}~${p.label}~` +
        p.measures
          .map((m) => m.notes.map((n) => `${n.pitch}${n.dur}${n.tie ? '_' : ''}${n.dyn ?? ''}${n.art ?? ''}${n.lyric ?? ''}`).join(' '))
          .join('|'),
    )
    .join(';');
  return [
    view.mode,
    view.partId ?? '',
    score.title,
    score.key,
    score.time,
    score.tempo,
    score.level,
    score.chords.join(','),
    body,
  ].join('');
}

// ---------------------------------------------------------------- note building

interface Cell {
  info: PartInfo;
  stave: Stave;
  notes: StaveNote[];
  /** Index into the source measure, or -1 for a synthesised whole-bar rest. */
  source: number[];
  voice: Voice | null;
  beams: Beam[];
  measure: number;
}

function buildNote(n: Note, info: PartInfo, alone: boolean): StaveNote {
  const rest = isRest(n.pitch);
  const duration = DUR_VEX[n.dur] + (rest ? 'r' : '');
  const clef = info.unpitched ? 'percussion' : info.clef;
  const keys = rest
    ? [REST_KEY[info.clef] ?? 'b/4']
    : info.unpitched
      ? ['b/4']
      : [vexKey(n.pitch, info.transposition, keyFifths(info.keySpec))];
  const note = new StaveNote({
    keys,
    duration,
    clef,
    alignCenter: rest && alone,
    ...(info.unpitched && !rest ? { stemDirection: STEM_UP } : {}),
  });
  if (IS_DOTTED[n.dur]) Dot.buildAndAttach([note], { all: true });
  if (!rest && n.art) note.addModifier(new Articulation(ART_CODE[n.art]));
  if (n.dyn) {
    note.addModifier(
      new Annotation(n.dyn)
        .setVerticalJustification(Annotation.VerticalJustify.BOTTOM)
        .setFont('Instrument Serif, Georgia, serif', '13px', 'bold', 'italic'),
    );
  }
  if (n.lyric) {
    note.addModifier(
      new Annotation(n.lyric).setVerticalJustification(Annotation.VerticalJustify.BOTTOM).setFont(UI_FONT, '11px', 'normal'),
    );
  }
  return note;
}

function fullBarRest(info: PartInfo): StaveNote {
  return new StaveNote({
    keys: [REST_KEY[info.clef] ?? 'b/4'],
    duration: 'wr',
    clef: info.unpitched ? 'percussion' : info.clef,
    alignCenter: true,
  });
}

/** A stave for this part: five lines, but percussion shows only the middle one. */
function makeStave(info: PartInfo, x: number, y: number, w: number): Stave {
  const stave = new Stave(x, y, w);
  if (info.unpitched) stave.setConfigForLines(PERC_LINES);
  return stave;
}

/** Width the clef + key signature (+ time signature) eat at the head of a system. */
function probeBeginWidth(infos: PartInfo[], ctx: RenderContext, x: number, y: number, withTime: boolean, time: string): number {
  if (!infos.length) return 0;
  const probes = infos.map((info) => {
    const st = makeStave(info, x, y, 320);
    if (!info.unpitched) {
      st.addClef(info.clef);
      st.addKeySignature(info.keySpec);
    }
    if (withTime) st.addTimeSignature(time);
    st.setContext(ctx);
    return st;
  });
  Stave.formatBegModifiers(probes);
  const startX = probes.reduce((m, st) => Math.max(m, st.getNoteStartX()), x);
  return Math.max(0, Math.round(startX - x) + 4);
}

function sectionGroups(infos: PartInfo[]): { from: number; to: number; kind: 'brace' | 'bracket' }[] {
  const out: { from: number; to: number; kind: 'brace' | 'bracket' }[] = [];
  let i = 0;
  while (i < infos.length) {
    let j = i;
    while (j + 1 < infos.length && infos[j + 1].section === infos[i].section) j += 1;
    if (j > i) out.push({ from: i, to: j, kind: infos[i].section === 'keyboard' ? 'brace' : 'bracket' });
    i = j + 1;
  }
  return out;
}

// ---------------------------------------------------------------- engraving

function drawScore(host: HTMLDivElement, score: Score, view: ScoreViewProps['view'], width: number): Layout {
  host.textContent = '';
  const infos = pickParts(score, view).map((p) => partInfo(p, score));
  const rows = infos.length;
  if (!rows || width < 80) return EMPTY_LAYOUT;

  const barCount = Math.max(1, infos.reduce((n, i) => Math.max(n, i.part.measures.length), 0));
  const [numBeats, beatValue] = TIME_BEATS[score.time] ?? [4, 4];
  const beamGroups = Beam.getDefaultBeamGroups(score.time);

  const renderer = new Renderer(host, Renderer.Backends.SVG);
  const ctx = renderer.getContext();

  ctx.setFont(UI_FONT, '12px', 'normal');
  const labelW = infos.reduce((m, i) => Math.max(m, ctx.measureText(i.label).width), 0);
  ctx.setFont(UI_FONT, '11px', 'normal');
  const shortW = infos.reduce((m, i) => Math.max(m, ctx.measureText(i.short).width), 0);

  const margin0 = Math.ceil(labelW) + 16;
  const marginN = Math.ceil(shortW) + 14;
  const hasChords = score.chords.some((c) => !!c && c.trim() !== '');
  const chordH = hasChords ? 22 : 0;
  const tempoH = 20;
  const pitch = view.mode === 'part' ? 112 : rows <= 4 ? 96 : rows <= 8 ? 84 : 76;
  const gap = view.mode === 'part' ? 26 : 34;
  const per = barsPerSystem(width, view.mode, rows);
  const systems = Math.ceil(barCount / per);
  const sysH = chordH + NUM_ROW + rows * pitch + gap;
  const height = Math.round(PAD_TOP + tempoH + systems * sysH + PAD_BOTTOM);

  renderer.resize(width, height);
  const svg = host.querySelector('svg');
  if (svg) {
    svg.style.removeProperty('width');
    svg.style.removeProperty('height');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('class', 'score-svg');
  }

  const bars: BarBox[] = [];
  const columns: ColumnBox[] = [];
  const rowBoxes: RowBox[] = [];
  const groups = rows > 1 ? sectionGroups(infos) : [];

  const ink = () => {
    ctx.setFillStyle(INK);
    ctx.setStrokeStyle(INK);
    ctx.setLineWidth(1);
  };

  // tempo mark, once, above the first system
  ink();
  ctx.setFont(UI_FONT, '12px', 'normal');
  ctx.fillText(`♩ = ${Math.round(score.tempo)}`, PAD_X + 2, PAD_TOP + 13);

  for (let s = 0; s < systems; s += 1) {
    const from = s * per;
    const to = Math.min(barCount, from + per);
    const count = Math.max(1, to - from);
    const first = s === 0;
    const sysTop = PAD_TOP + tempoH + s * sysH;
    const chordY = sysTop + 15;
    const numY = sysTop + chordH + 11;
    const staffTop = sysTop + chordH + NUM_ROW;
    const x0 = PAD_X + (first ? margin0 : marginN);
    const availW = Math.max(140, width - PAD_X - x0);
    const extra = probeBeginWidth(infos, ctx, x0, staffTop - HEADROOM, first, score.time);
    const barW = Math.max(46, (availW - extra) / count);

    const staves: Stave[][] = [];
    for (let j = 0; j < rows; j += 1) {
      const info = infos[j];
      const y = staffTop + j * pitch - HEADROOM;
      const line: Stave[] = [];
      for (let k = 0; k < count; k += 1) {
        const bx = x0 + (k === 0 ? 0 : extra + k * barW);
        const bw = k === 0 ? extra + barW : barW;
        const st = makeStave(info, bx, y, bw);
        if (k === 0) {
          if (!info.unpitched) {
            st.addClef(info.clef);
            st.addKeySignature(info.keySpec);
          }
          if (first) st.addTimeSignature(score.time);
        }
        if (from + k === barCount - 1) st.setEndBarType(Barline.type.END);
        st.setContext(ctx);
        line.push(st);
      }
      staves.push(line);
    }
    for (let k = 0; k < count; k += 1) Stave.formatBegModifiers(staves.map((line) => line[k]));

    // staves + connectors
    ink();
    for (let j = 0; j < rows; j += 1) for (let k = 0; k < count; k += 1) staves[j][k].draw();
    if (rows > 1) {
      const brace = new StaveConnector(staves[0][0], staves[rows - 1][0]).setType('singleLeft');
      brace.setContext(ctx).draw();
      for (const g of groups) {
        const c = new StaveConnector(staves[g.from][0], staves[g.to][0]).setType(g.kind);
        c.setContext(ctx).draw();
      }
    }

    // part labels
    ctx.setFillStyle(INK);
    ctx.setFont(UI_FONT, first ? '12px' : '11px', 'normal');
    for (let j = 0; j < rows; j += 1) {
      const text = first ? infos[j].label : infos[j].short;
      const w = ctx.measureText(text).width;
      const lineTop = staffTop + j * pitch;
      ctx.fillText(text, Math.max(2, x0 - 10 - w), lineTop + STAVE_SPAN / 2 + 4);
    }

    // bar numbers + chord symbols
    for (let k = 0; k < count; k += 1) {
      const bx = staves[0][k].getX();
      ctx.setFillStyle(FAINT);
      ctx.setFont(UI_FONT, '10px', 'normal');
      ctx.fillText(String(from + k + 1), bx + (k === 0 ? 5 : 3), numY);
      const chord = score.chords[from + k];
      if (hasChords && chord && chord.trim()) {
        ctx.setFillStyle(INK);
        ctx.setFont(CHORD_FONT, '13px', 'bold');
        ctx.fillText(chord.trim(), staves[0][k].getNoteStartX() - 2, chordY);
      }
    }

    // ---- notes
    const cells: Cell[][] = [];
    for (let j = 0; j < rows; j += 1) {
      const info = infos[j];
      const line: Cell[] = [];
      for (let k = 0; k < count; k += 1) {
        const m = from + k;
        const stave = staves[j][k];
        const measure: Measure | undefined = info.part.measures[m];
        const src = measure?.notes ?? [];
        const notes: StaveNote[] = [];
        const source: number[] = [];
        if (src.length) {
          const alone = src.length === 1;
          for (let i = 0; i < src.length; i += 1) {
            try {
              notes.push(buildNote(src[i], info, alone));
              source.push(i);
            } catch {
              /* a malformed note is reported by the checker; skip it here */
            }
          }
        }
        if (!notes.length) {
          notes.push(fullBarRest(info));
          source.push(-1);
        }
        for (const n of notes) n.setStave(stave);
        const voice = new Voice({ numBeats, beatValue }).setMode(Voice.Mode.SOFT);
        voice.addTickables(notes);
        voice.setStave(stave);
        if (!info.unpitched) Accidental.applyAccidentals([voice], info.keySpec);
        const beams = Beam.generateBeams(notes, { groups: beamGroups, beamRests: false });
        line.push({ info, stave, notes, source, voice, beams, measure: m });
      }
      cells.push(line);
    }

    // format each bar column across every stave so simultaneous attacks line up
    for (let k = 0; k < count; k += 1) {
      const voices = cells.map((line) => line[k].voice).filter((v): v is Voice => v !== null);
      if (!voices.length) continue;
      const head = staves[0][k];
      const startX = head.getNoteStartX();
      const justify = Math.max(24, head.getWidth() - (startX - head.getX()) - Stave.defaultPadding);
      try {
        const f = new Formatter();
        f.joinVoices(voices);
        f.format(voices, justify);
        f.postFormat();
      } catch {
        for (const v of voices) {
          try {
            new Formatter().joinVoices([v]).format([v], justify);
          } catch {
            /* leave unformatted rather than losing the whole system */
          }
        }
      }
    }

    // draw notes (each in its own tagged <g> so overlays can address it), then beams, then ties
    ink();
    for (let j = 0; j < rows; j += 1) {
      for (let k = 0; k < count; k += 1) {
        const cell = cells[j][k];
        for (let i = 0; i < cell.notes.length; i += 1) {
          const g = ctx.openGroup('note') as SVGGElement;
          try {
            cell.notes[i].setContext(ctx).draw();
          } catch {
            /* keep engraving the rest of the score */
          }
          ctx.closeGroup();
          if (cell.source[i] >= 0) tagNote(g, cell.info.part.id, cell.measure, cell.source[i], cell.notes[i]);
          else g.setAttribute('class', 'vf-note vf-filler');
        }
        for (const b of cell.beams) {
          try {
            b.setContext(ctx).draw();
          } catch {
            /* ignore a beam that cannot be resolved */
          }
        }
      }
    }
    for (let j = 0; j < rows; j += 1) {
      for (let k = 0; k < count; k += 1) {
        const cell = cells[j][k];
        const src = cell.info.part.measures[cell.measure]?.notes ?? [];
        for (let i = 0; i < cell.notes.length; i += 1) {
          const idx = cell.source[i];
          if (idx < 0 || !src[idx]?.tie) continue;
          const firstNote = cell.notes[i];
          let lastNote: StaveNote | undefined;
          if (i + 1 < cell.notes.length) lastNote = cell.notes[i + 1];
          else if (k + 1 < count) lastNote = cells[j][k + 1].notes[0];
          try {
            new StaveTie({ firstNote, lastNote }).setContext(ctx).draw();
          } catch {
            /* a tie that cannot be placed is not worth losing the page over */
          }
        }
      }
    }

    // ---- geometry for the overlays
    const topLine = staffTop;
    const bottomLine = staffTop + (rows - 1) * pitch + STAVE_SPAN;
    for (let k = 0; k < count; k += 1) {
      const head = staves[0][k];
      columns.push({
        measure: from + k,
        system: s,
        x: head.getX(),
        w: head.getWidth(),
        noteX: head.getNoteStartX(),
        top: topLine - 14,
        bottom: bottomLine + 14,
      });
    }
    for (let j = 0; j < rows; j += 1) {
      const lineTop = staffTop + j * pitch;
      rowBoxes.push({
        partId: infos[j].part.id,
        system: s,
        x: PAD_X,
        y: lineTop - 14,
        w: width - PAD_X * 2,
        h: STAVE_SPAN + 28,
      });
      for (let k = 0; k < count; k += 1) {
        const st = staves[j][k];
        bars.push({
          partId: infos[j].part.id,
          measure: from + k,
          system: s,
          row: j,
          x: st.getX(),
          y: lineTop - 12,
          w: st.getWidth(),
          h: STAVE_SPAN + 24,
          lockY: lineTop - 15,
        });
      }
    }
  }

  return { width, height, systems, bars, columns, rows: rowBoxes };
}

/** Give a drawn note a stable identity plus a generous, clickable hit area. */
function tagNote(g: SVGGElement, partId: string, measure: number, note: number, drawn: StaveNote): void {
  g.setAttribute('class', 'vf-note');
  g.setAttribute('data-note', '');
  g.dataset.part = partId;
  g.dataset.measure = String(measure);
  g.dataset.index = String(note);
  let box: { x: number; y: number; w: number; h: number };
  try {
    const bb = drawn.getBoundingBox();
    box = { x: bb.getX(), y: bb.getY(), w: bb.getW(), h: bb.getH() };
  } catch {
    return;
  }
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('class', 'hit');
  rect.setAttribute('x', String(box.x - 5));
  rect.setAttribute('y', String(box.y - 4));
  rect.setAttribute('width', String(Math.max(12, box.w + 10)));
  rect.setAttribute('height', String(Math.max(22, box.h + 8)));
  rect.setAttribute('fill', 'none');
  // the enclosing <g> carries the notation ink; the hit target must not inherit it
  rect.setAttribute('stroke', 'none');
  rect.setAttribute('pointer-events', 'all');
  g.insertBefore(rect, g.firstChild);
}

// ---------------------------------------------------------------- selection helpers

interface Step {
  measure: number;
  note: number;
}

function stepsOf(part: Part): Step[] {
  const out: Step[] = [];
  part.measures.forEach((m, mi) => m.notes.forEach((_, ni) => out.push({ measure: mi, note: ni })));
  return out;
}

function moveSelection(part: Part, sel: Selection, delta: number): Selection | null {
  const steps = stepsOf(part);
  if (!steps.length) return null;
  let at = steps.findIndex((s) => s.measure === sel.measure && s.note === sel.note);
  if (at < 0) at = 0;
  const next = clamp(at + delta, 0, steps.length - 1);
  if (next === at) return null;
  return { partId: part.id, measure: steps[next].measure, note: steps[next].note };
}

function issueKey(i: CheckIssue): string | null {
  if (!i.partId || i.measure === undefined || i.note === undefined) return null;
  return `${i.partId}${i.measure}${i.note}`;
}

// ---------------------------------------------------------------- component

export function ScoreView(props: ScoreViewProps) {
  const { score, view, cursor, issues, selection, writingPart, onSelectNote, onNudgeNote, onToggleLock } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT);
  const [failed, setFailed] = useState(false);

  // container width, quantised so a scrollbar appearing cannot oscillate the layout
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const read = () => {
      const w = Math.floor((el.clientWidth - 2) / 4) * 4;
      setWidth(Math.max(320, w));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The store mutates the score in place, so the object identity never changes — recompute the
  // engraving signature on every render (a string build over a few hundred notes) instead of
  // memoising on `score`, which would freeze the drawing at the first arrangement we ever saw.
  const signature = scoreSignature(score, view);

  // engrave — only when the notation itself changed, or the page got wider/narrower
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || width <= 0) return;
    try {
      setLayout(drawScore(host, score, view, width));
      setFailed(false);
    } catch (err) {
      host.textContent = '';
      setLayout(EMPTY_LAYOUT);
      setFailed(true);
      console.error('[ScoreView] engraving failed', err);
    }
    // score/view are read through the latest effect closure; the signature is the real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, width]);

  // selection + issue state, applied straight to the DOM so nothing re-engraves
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const marks = new Map<string, { state: string; message: string }>();
    for (const i of issues) {
      const key = issueKey(i);
      if (!key) continue;
      const prev = marks.get(key);
      if (prev && prev.state === 'error') continue;
      marks.set(key, { state: i.severity, message: i.message });
    }
    const selKey = selection ? `${selection.partId}${selection.measure}${selection.note}` : null;
    const nodes = host.querySelectorAll<SVGGElement>('g.vf-note[data-note]');
    nodes.forEach((g) => {
      const key = `${g.dataset.part ?? ''}${g.dataset.measure ?? ''}${g.dataset.index ?? ''}`;
      const mark = marks.get(key);
      const selected = selKey !== null && key === selKey;
      const state = selected ? 'selected' : mark ? mark.state : '';
      if (state) g.setAttribute('data-state', state);
      else g.removeAttribute('data-state');
      if (selected) g.setAttribute('data-selected', '');
      else g.removeAttribute('data-selected');
      const existing = g.querySelector('title');
      if (mark) {
        const title = existing ?? document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = mark.message;
        if (!existing) g.appendChild(title);
      } else if (existing) {
        existing.remove();
      }
    });
  }, [layout, issues, selection]);

  // keep the sounding bar in view without fighting a person's own scrolling:
  // only chase the cursor when it actually moves to a different bar.
  const chasedRef = useRef<number | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !cursor) {
      chasedRef.current = null;
      return;
    }
    if (chasedRef.current === cursor.measure) return;
    chasedRef.current = cursor.measure;
    const col = layout.columns.find((c) => c.measure === cursor.measure);
    if (!col) return;
    const top = col.top - 24;
    const bottom = col.bottom + 24;
    if (top < el.scrollTop || bottom > el.scrollTop + el.clientHeight) {
      el.scrollTo({ top: Math.max(0, top - 16), behavior: 'smooth' });
    }
  }, [cursor, layout]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      rootRef.current?.focus({ preventScroll: true });
      const target = e.target as Element | null;
      const g = target?.closest?.('g.vf-note[data-note]') as SVGGElement | null;
      if (!g) {
        onSelectNote(null);
        return;
      }
      const partId = g.dataset.part;
      const measure = Number(g.dataset.measure);
      const note = Number(g.dataset.index);
      if (!partId || !Number.isFinite(measure) || !Number.isFinite(note)) return;
      onSelectNote({ partId, measure, note });
    },
    [onSelectNote],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!selection) return;
      const part = score.parts.find((p) => p.id === selection.partId);
      if (!part) return;
      const octave = e.shiftKey;
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          onNudgeNote(selection, octave ? 12 : 1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          onNudgeNote(selection, octave ? -12 : -1);
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          const next = moveSelection(part, selection, -1);
          if (next) onSelectNote(next);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          const next = moveSelection(part, selection, 1);
          if (next) onSelectNote(next);
          break;
        }
        case 'Escape':
          e.preventDefault();
          onSelectNote(null);
          break;
        default:
          break;
      }
    },
    [score, selection, onNudgeNote, onSelectNote],
  );

  const lockedSet = useMemo(() => {
    const set = new Set<string>();
    for (const p of score.parts) p.measures.forEach((m, i) => m.locked && set.add(`${p.id}${i}`));
    return set;
  }, [score]);

  const barIssues = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>();
    for (const i of issues) {
      if (!i.partId || i.measure === undefined) continue;
      const key = `${i.partId}${i.measure}`;
      if (map.get(key) === 'error') continue;
      map.set(key, i.severity);
    }
    return map;
  }, [issues]);

  const cursorCol = cursor ? layout.columns.find((c) => c.measure === cursor.measure) ?? null : null;
  const beatX = cursorCol
    ? cursorCol.noteX + clamp(cursor!.tick / (TIME_TICKS[score.time] || 1920), 0, 1) * Math.max(0, cursorCol.x + cursorCol.w - cursorCol.noteX - 6)
    : 0;

  return (
    <div
      className="score-view"
      ref={rootRef}
      tabIndex={0}
      role="group"
      aria-label={`Score: ${score.title}`}
      data-parts={score.parts.length}
      data-mode={view.mode}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      <div className="score-scroll" ref={scrollRef}>
        <div className="score-paper" style={{ width: layout.width || undefined, height: layout.height || undefined }}>
          <div className="score-under" aria-hidden="true">
            {layout.bars.map((b) =>
              lockedSet.has(`${b.partId}${b.measure}`) ? (
                <div key={`lk-${b.partId}-${b.measure}`} className="bar-locked" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
              ) : null,
            )}
            {layout.bars.map((b) => {
              const sev = barIssues.get(`${b.partId}${b.measure}`);
              return sev ? (
                <div key={`is-${b.partId}-${b.measure}`} className={`bar-issue ${sev}`} style={{ left: b.x, top: b.y + b.h - 2, width: b.w }} />
              ) : null;
            })}
            {cursorCol ? (
              <div
                className="cursor-band"
                style={{ left: cursorCol.x, top: cursorCol.top, width: cursorCol.w, height: cursorCol.bottom - cursorCol.top }}
              />
            ) : null}
          </div>

          <div className="score-plate" ref={hostRef} />

          <div className="score-chrome">
            {cursorCol ? (
              <div className="cursor-line" style={{ left: beatX, top: cursorCol.top, height: cursorCol.bottom - cursorCol.top }} />
            ) : null}
            {writingPart
              ? layout.rows
                  .filter((r) => r.partId === writingPart)
                  .map((r) => <div key={`w-${r.system}-${r.partId}`} className="writing-accent" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />)
              : null}
            {layout.bars.map((b) => {
              const locked = lockedSet.has(`${b.partId}${b.measure}`);
              return (
                <button
                  key={`b-${b.partId}-${b.measure}`}
                  type="button"
                  className={`bar-lock${locked ? ' on' : ''}`}
                  data-testid={`lock-${b.partId}-${b.measure + 1}`}
                  data-part={b.partId}
                  data-bar={b.measure + 1}
                  style={{ left: b.x + b.w / 2, top: b.lockY }}
                  aria-pressed={locked}
                  title={`${locked ? 'Unlock' : 'Lock'} bar ${b.measure + 1}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLock(b.partId, b.measure);
                  }}
                >
                  <span aria-hidden="true">{locked ? '🔒' : ''}</span>
                  <span className="sr-only">{`${locked ? 'Unlock' : 'Lock'} bar ${b.measure + 1}`}</span>
                </button>
              );
            })}
          </div>
        </div>

        {failed ? <p className="score-fallback">This passage could not be engraved. The activity log has the details.</p> : null}
        {!failed && !score.parts.length ? <p className="score-fallback">No parts yet — add an ensemble to start arranging.</p> : null}
      </div>
    </div>
  );
}
