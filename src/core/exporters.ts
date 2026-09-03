// Stand — export. MusicXML 4.0 (conductor score and single parts), Standard MIDI, and a text summary.
//
// The score model holds SOUNDING pitch. MusicXML shows WRITTEN pitch for every part plus a
// <transpose> element telling the reader how to get back to sounding, so a Bb clarinet part reads
// a whole step up with <chromatic>-2</chromatic>. MIDI is always sounding — a synth needs concert pitch.

import {
  DUR_TICKS,
  IS_DOTTED,
  TIME_BEATS,
  emptyMeasure,
  type Dur,
  type Dynamic,
  type Instrument,
  type Measure,
  type Note,
  type Part,
  type Score,
} from './types';
import { findInstrument } from './instruments';
import { isRest, keyFifths, midiToPitch, parsePitch, pitchToMidi, transposePitch, writtenKey } from './pitch';

// midi-writer-js resolves through an exports map with no "types" condition, so TypeScript cannot
// reach its bundled declarations. Import it untyped and describe the slice of the API used here.
// @ts-ignore
import MidiWriterUntyped from 'midi-writer-js';

interface MidiTrack {
  addEvent(event: unknown): MidiTrack;
  addTrackName(name: string): MidiTrack;
  setTempo(bpm: number, tick?: number): MidiTrack;
  setTimeSignature(numerator: number, denominator: number): MidiTrack;
  setKeySignature(key: string, mode?: number): MidiTrack;
}
interface MidiWriterApi {
  Track: new () => MidiTrack;
  NoteEvent: new (fields: Record<string, unknown>) => unknown;
  InstrumentNameEvent: new (fields: { text: string }) => unknown;
  Writer: new (tracks: MidiTrack[]) => { buildFile(): Uint8Array };
}
const MidiWriter = MidiWriterUntyped as MidiWriterApi;

/** MusicXML divisions per quarter note. DUR_TICKS is already 480 per quarter, so ticks map 1:1. */
const DIVISIONS = 480;
/** midi-writer-js default resolution. Our 480-per-quarter ticks scale by 128/480. */
const MIDI_TICKS_PER_QUARTER = 128;

const TYPE_NAME: Record<Dur, string> = {
  w: 'whole',
  hd: 'half',
  h: 'half',
  qd: 'quarter',
  q: 'quarter',
  '8d': 'eighth',
  '8': 'eighth',
  '16': '16th',
};

const ACCIDENTAL_NAME: Record<number, string> = {
  2: 'double-sharp',
  1: 'sharp',
  0: 'natural',
  '-1': 'flat',
  '-2': 'flat-flat',
};

const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
/** Diatonic steps spanned by 0..11 semitones (m2 and M2 both span one step, and so on). */
const DIATONIC_OF_SEMITONE = [0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6];

const VELOCITY: Record<Dynamic, number> = { pp: 20, p: 32, mp: 48, mf: 62, f: 78, ff: 92 };
const DEFAULT_VELOCITY = VELOCITY.mf;

const ARTICULATION_TAG: Record<string, string> = { staccato: 'staccato', accent: 'accent', tenuto: 'tenuto' };

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fallbackInstrument(part: Part): Instrument {
  const label = part.label || part.instrumentId || 'Instrument';
  return {
    id: part.instrumentId || part.id,
    name: label,
    short: label.slice(0, 4),
    clef: 'treble',
    section: 'keyboard',
    transposition: 0,
    range: { elementary: ['C4', 'C5'], middle: ['C4', 'C5'], high: ['C4', 'C5'], adult: ['C4', 'C5'] },
  };
}

/** The instrument behind a part, or a neutral C-treble stand-in if the table does not know it. */
function instrumentOf(part: Part): Instrument {
  return findInstrument(part.instrumentId) ?? fallbackInstrument(part);
}

/** Which steps the key signature already alters, e.g. two sharps -> { F: 1, C: 1, ... }. */
function keyAlters(fifths: number): Record<string, number> {
  const alters: Record<string, number> = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  for (let i = 0; i < Math.max(0, Math.min(7, fifths)); i++) alters[SHARP_ORDER[i]] = 1;
  for (let i = 0; i < Math.max(0, Math.min(7, -fifths)); i++) alters[FLAT_ORDER[i]] = -1;
  return alters;
}

function clefXml(inst: Instrument): string {
  switch (inst.clef) {
    case 'bass':
      return '<sign>F</sign><line>4</line>';
    case 'alto':
      return '<sign>C</sign><line>3</line>';
    case 'percussion':
      return '<sign>percussion</sign><line>2</line>';
    default:
      return '<sign>G</sign><line>2</line>';
  }
}

/**
 * <transpose> for a part. Instrument.transposition adds to SOUNDING to get WRITTEN; MusicXML wants
 * the other direction, so chromatic = -transposition, split into an octave-change plus an interval.
 * Bb clarinet (+2) -> diatonic -1, chromatic -2. Bb tenor sax (+14) -> -1 / -2 / octave-change -1.
 */
function transposeXml(transposition: number, pad: string): string {
  if (!transposition) return '';
  const total = -transposition;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const octaves = Math.floor(abs / 12);
  const semis = abs % 12;
  const lines = [
    `${pad}<transpose>`,
    `${pad}  <diatonic>${sign * DIATONIC_OF_SEMITONE[semis]}</diatonic>`,
    `${pad}  <chromatic>${sign * semis}</chromatic>`,
  ];
  if (octaves) lines.push(`${pad}  <octave-change>${sign * octaves}</octave-change>`);
  lines.push(`${pad}</transpose>`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// chord symbols -> <harmony>
// ---------------------------------------------------------------------------

const CHORD_KINDS: Record<string, string> = {
  '': 'major',
  M: 'major',
  maj: 'major',
  major: 'major',
  m: 'minor',
  mi: 'minor',
  min: 'minor',
  minor: 'minor',
  '-': 'minor',
  '5': 'power',
  '6': 'major-sixth',
  M6: 'major-sixth',
  maj6: 'major-sixth',
  m6: 'minor-sixth',
  min6: 'minor-sixth',
  '-6': 'minor-sixth',
  '7': 'dominant',
  dom7: 'dominant',
  maj7: 'major-seventh',
  M7: 'major-seventh',
  ma7: 'major-seventh',
  Maj7: 'major-seventh',
  m7: 'minor-seventh',
  min7: 'minor-seventh',
  '-7': 'minor-seventh',
  mM7: 'major-minor',
  mmaj7: 'major-minor',
  dim: 'diminished',
  o: 'diminished',
  '°': 'diminished',
  dim7: 'diminished-seventh',
  o7: 'diminished-seventh',
  '°7': 'diminished-seventh',
  m7b5: 'half-diminished',
  min7b5: 'half-diminished',
  'ø': 'half-diminished',
  'ø7': 'half-diminished',
  aug: 'augmented',
  '+': 'augmented',
  aug7: 'augmented-seventh',
  '7#5': 'augmented-seventh',
  '+7': 'augmented-seventh',
  '9': 'dominant-ninth',
  maj9: 'major-ninth',
  M9: 'major-ninth',
  m9: 'minor-ninth',
  min9: 'minor-ninth',
  '11': 'dominant-11th',
  '13': 'dominant-13th',
  sus: 'suspended-fourth',
  sus4: 'suspended-fourth',
  sus2: 'suspended-second',
  add9: 'major',
  '2': 'suspended-second',
};

function rootParts(text: string): { step: string; alter: number } | null {
  const m = /^([A-Ga-g])(#{1,2}|b{1,2}|)$/.exec(text.trim());
  if (!m) return null;
  const acc = m[2];
  return { step: m[1].toUpperCase(), alter: acc.startsWith('#') ? acc.length : acc.startsWith('b') ? -acc.length : 0 };
}

/** One chord symbol ('C', 'Am7', 'F#m7b5', 'G7/B') as a MusicXML <harmony> block. */
function harmonyXml(symbol: string, pad: string): string {
  const raw = String(symbol ?? '').trim();
  if (!raw || raw === '-' || raw === 'N.C.' || raw === 'NC') return '';
  const slash = raw.indexOf('/');
  const main = slash > 0 ? raw.slice(0, slash) : raw;
  const bassText = slash > 0 ? raw.slice(slash + 1) : '';
  const m = /^([A-Ga-g](?:#{1,2}|b{1,2}|))(.*)$/.exec(main.trim());
  if (!m) return '';
  const root = rootParts(m[1]);
  if (!root) return '';
  const quality = m[2].trim();
  const kind = CHORD_KINDS[quality] ?? CHORD_KINDS[quality.toLowerCase()] ?? 'other';
  const kindText = quality ? ` text="${esc(quality)}"` : '';
  const lines = [`${pad}<harmony print-frame="no">`, `${pad}  <root>`, `${pad}    <root-step>${root.step}</root-step>`];
  if (root.alter) lines.push(`${pad}    <root-alter>${root.alter}</root-alter>`);
  lines.push(`${pad}  </root>`, `${pad}  <kind${kindText}>${kind}</kind>`);
  const bass = bassText ? rootParts(bassText) : null;
  if (bass) {
    lines.push(`${pad}  <bass>`, `${pad}    <bass-step>${bass.step}</bass-step>`);
    if (bass.alter) lines.push(`${pad}    <bass-alter>${bass.alter}</bass-alter>`);
    lines.push(`${pad}  </bass>`);
  }
  lines.push(`${pad}</harmony>`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------

interface TieFlags {
  start: boolean;
  stop: boolean;
}

/** Tie flags per note, resolved across bar lines: a tie only lands if the next note is the same pitch. */
function tieFlags(measures: Measure[]): TieFlags[][] {
  const flags = measures.map((m) => m.notes.map(() => ({ start: false, stop: false })));
  const flat: Array<{ note: Note; m: number; n: number }> = [];
  measures.forEach((m, mi) => m.notes.forEach((note, ni) => flat.push({ note, m: mi, n: ni })));
  for (let i = 0; i < flat.length - 1; i++) {
    const cur = flat[i];
    const next = flat[i + 1];
    if (!cur.note.tie || isRest(cur.note.pitch) || isRest(next.note.pitch)) continue;
    const a = pitchToMidi(cur.note.pitch);
    const b = pitchToMidi(next.note.pitch);
    if (a === null || b === null || a !== b) continue;
    flags[cur.m][cur.n].start = true;
    flags[next.m][next.n].stop = true;
  }
  return flags;
}

function directionXml(dyn: Dynamic | undefined, pad: string): string {
  if (!dyn) return '';
  return (
    `${pad}<direction placement="below">\n` +
    `${pad}  <direction-type>\n` +
    `${pad}    <dynamics><${dyn}/></dynamics>\n` +
    `${pad}  </direction-type>\n` +
    `${pad}</direction>\n`
  );
}

function noteXml(
  note: Note,
  flags: TieFlags,
  inst: Instrument,
  writtenFifths: number,
  alters: Record<string, number>,
  pad: string,
): string {
  const ticks = DUR_TICKS[note.dur] ?? DUR_TICKS.q;
  const lines: string[] = [`${pad}<note>`];
  let accidental = '';

  if (isRest(note.pitch)) {
    lines.push(`${pad}  <rest/>`);
  } else if (inst.unpitched) {
    const p = parsePitch(note.pitch);
    lines.push(
      `${pad}  <unpitched>`,
      `${pad}    <display-step>${p ? p.step : 'B'}</display-step>`,
      `${pad}    <display-octave>${p ? p.octave : 4}</display-octave>`,
      `${pad}  </unpitched>`,
    );
  } else {
    const written = transposePitch(note.pitch, inst.transposition, writtenFifths);
    const p = parsePitch(written);
    if (!p) {
      lines.push(`${pad}  <rest/>`);
    } else {
      lines.push(`${pad}  <pitch>`, `${pad}    <step>${p.step}</step>`);
      if (p.alter) lines.push(`${pad}    <alter>${p.alter}</alter>`);
      lines.push(`${pad}    <octave>${p.octave}</octave>`, `${pad}  </pitch>`);
      // An accidental is printed only where the note leaves the key signature.
      if (p.alter !== (alters[p.step] ?? 0)) {
        const name = ACCIDENTAL_NAME[p.alter];
        if (name) accidental = `${pad}  <accidental>${name}</accidental>`;
      }
    }
  }

  lines.push(`${pad}  <duration>${ticks}</duration>`);
  if (flags.stop) lines.push(`${pad}  <tie type="stop"/>`);
  if (flags.start) lines.push(`${pad}  <tie type="start"/>`);
  lines.push(`${pad}  <voice>1</voice>`, `${pad}  <type>${TYPE_NAME[note.dur] ?? 'quarter'}</type>`);
  if (IS_DOTTED[note.dur]) lines.push(`${pad}  <dot/>`);
  if (accidental) lines.push(accidental);

  const art = note.art ? ARTICULATION_TAG[note.art] : '';
  if (flags.start || flags.stop || art) {
    lines.push(`${pad}  <notations>`);
    if (flags.stop) lines.push(`${pad}    <tied type="stop"/>`);
    if (flags.start) lines.push(`${pad}    <tied type="start"/>`);
    if (art) lines.push(`${pad}    <articulations><${art}/></articulations>`);
    lines.push(`${pad}  </notations>`);
  }
  if (note.lyric) {
    lines.push(
      `${pad}  <lyric number="1">`,
      `${pad}    <syllabic>single</syllabic>`,
      `${pad}    <text>${esc(note.lyric)}</text>`,
      `${pad}  </lyric>`,
    );
  }
  lines.push(`${pad}</note>`);
  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// MusicXML documents
// ---------------------------------------------------------------------------

function partsXml(score: Score, parts: Part[], bars: number, chordsOnFirstPart: boolean): string {
  let out = '';
  parts.forEach((part, pi) => {
    const inst = instrumentOf(part);
    const partId = `P${pi + 1}`;
    const wKey = writtenKey(score.key, inst.transposition);
    // An unpitched staff carries no key signature.
    const wFifths = inst.unpitched ? 0 : keyFifths(wKey);
    const alters = keyAlters(wFifths);
    const flags = tieFlags(part.measures);
    const [beats, beatType] = TIME_BEATS[score.time] ?? [4, 4];
    out += `  <part id="${partId}">\n`;
    for (let m = 0; m < bars; m++) {
      const measure = part.measures[m] ?? emptyMeasure(score.time);
      const measureFlags = flags[m] ?? measure.notes.map(() => ({ start: false, stop: false }));
      out += `    <measure number="${m + 1}">\n`;
      if (m === 0) {
        out += `      <attributes>\n`;
        out += `        <divisions>${DIVISIONS}</divisions>\n`;
        out += `        <key><fifths>${wFifths}</fifths></key>\n`;
        out += `        <time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>\n`;
        out += `        <clef>${clefXml(inst)}</clef>\n`;
        if (inst.unpitched) out += `        <staff-details><staff-lines>1</staff-lines></staff-details>\n`;
        out += transposeXml(inst.transposition, '        ');
        out += `      </attributes>\n`;
      }
      if (chordsOnFirstPart && pi === 0) out += harmonyXml(score.chords[m] ?? '', '      ');
      let dyn: Dynamic | undefined;
      measure.notes.forEach((note, ni) => {
        if (note.dyn && note.dyn !== dyn) {
          dyn = note.dyn;
          out += directionXml(note.dyn, '      ');
        }
        out += noteXml(note, measureFlags[ni] ?? { start: false, stop: false }, inst, wFifths, alters, '      ');
      });
      out += `    </measure>\n`;
    }
    out += `  </part>\n`;
  });
  return out;
}

function document(score: Score, parts: Part[], title: string): string {
  const bars = parts.reduce((n, p) => Math.max(n, p.measures.length), 0) || 1;
  let out = '<?xml version="1.0" encoding="UTF-8"?>\n';
  out += '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n';
  out += '<score-partwise version="4.0">\n';
  out += `  <work>\n    <work-title>${esc(title)}</work-title>\n  </work>\n`;
  out += '  <identification>\n';
  if (score.source) out += `    <rights>${esc(score.source)}</rights>\n`;
  out += '    <encoding>\n';
  out += `      <encoding-date>${new Date().toISOString().slice(0, 10)}</encoding-date>\n`;
  out += '      <software>Stand</software>\n';
  out += '    </encoding>\n';
  if (score.source) out += `    <source>${esc(score.source)}</source>\n`;
  out += '  </identification>\n';
  out += '  <part-list>\n';
  parts.forEach((part, pi) => {
    const inst = instrumentOf(part);
    const partId = `P${pi + 1}`;
    out += `    <score-part id="${partId}">\n`;
    out += `      <part-name>${esc(part.label)}</part-name>\n`;
    out += `      <part-abbreviation>${esc(inst.short)}</part-abbreviation>\n`;
    out += `      <score-instrument id="${partId}-I1">\n`;
    out += `        <instrument-name>${esc(inst.name)}</instrument-name>\n`;
    out += `      </score-instrument>\n`;
    if (inst.unpitched) {
      out += `      <midi-instrument id="${partId}-I1">\n`;
      out += `        <midi-channel>10</midi-channel>\n`;
      out += `      </midi-instrument>\n`;
    }
    out += `    </score-part>\n`;
  });
  out += '  </part-list>\n';
  out += partsXml(score, parts, bars, true);
  out += '</score-partwise>\n';
  return out;
}

/** Full conductor score as MusicXML 4.0 partwise, with <transpose> per transposing part. */
export function toMusicXML(score: Score): string {
  return document(score, score.parts, score.title || 'Untitled');
}

/** One part alone, in its written (transposed) notation. */
export function toPartMusicXML(score: Score, partId: string): string {
  const part = score.parts.find((p) => p.id === partId);
  if (!part) return document(score, [], score.title || 'Untitled');
  return document(score, [part], `${score.title || 'Untitled'} — ${part.label}`);
}

// ---------------------------------------------------------------------------
// MIDI
// ---------------------------------------------------------------------------

function toMidiTicks(ticks: number): number {
  return Math.round((ticks * MIDI_TICKS_PER_QUARTER) / DUR_TICKS.q);
}

/** MIDI meta text is bytes; midi-writer-js takes one byte per char, so hand it UTF-8 byte chars. */
function midiText(s: string): string {
  const bytes = new TextEncoder().encode(String(s ?? ''));
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

function flatNotes(part: Part): Note[] {
  const flat: Note[] = [];
  for (const m of part.measures) for (const n of m.notes) flat.push(n);
  return flat;
}

/** Standard MIDI file bytes (sounding pitches, one track per part). */
export function toMidiBytes(score: Score): Uint8Array {
  const tracks: MidiTrack[] = [];
  let pitchedChannel = 0;

  const parts = score.parts.length ? score.parts : [{ id: 'empty', instrumentId: '', label: score.title || 'Stand', measures: [] } as Part];

  parts.forEach((part, pi) => {
    const inst = instrumentOf(part);
    const track = new MidiWriter.Track();
    track.addTrackName(midiText(part.label || inst.name));
    track.addEvent(new MidiWriter.InstrumentNameEvent({ text: midiText(inst.name) }));
    if (pi === 0) {
      track.setTempo(score.tempo || 100);
      const [beats, beatType] = TIME_BEATS[score.time] ?? [4, 4];
      track.setTimeSignature(beats, beatType);
      track.setKeySignature(score.key || 'C');
    }

    let channel: number;
    if (inst.unpitched) {
      channel = 10;
    } else {
      // 1..16 skipping the percussion channel.
      const slots = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16];
      channel = slots[pitchedChannel % slots.length];
      pitchedChannel++;
    }

    const flat = flatNotes(part);
    let pendingRest = 0;
    let velocity = DEFAULT_VELOCITY;
    for (let i = 0; i < flat.length; i++) {
      const n = flat[i];
      let ticks = DUR_TICKS[n.dur] ?? DUR_TICKS.q;
      const midi = isRest(n.pitch) ? null : pitchToMidi(n.pitch);
      if (midi === null) {
        pendingRest += ticks;
        continue;
      }
      // Ties become one longer note.
      while (flat[i].tie && i + 1 < flat.length && pitchToMidi(flat[i + 1].pitch) === midi) {
        i++;
        ticks += DUR_TICKS[flat[i].dur] ?? 0;
      }
      if (n.dyn) velocity = VELOCITY[n.dyn] ?? velocity;
      track.addEvent(
        new MidiWriter.NoteEvent({
          pitch: [midi],
          duration: `T${toMidiTicks(ticks)}`,
          wait: `T${toMidiTicks(pendingRest)}`,
          velocity,
          channel,
        }),
      );
      pendingRest = 0;
    }
    tracks.push(track);
  });

  return new MidiWriter.Writer(tracks).buildFile();
}

// ---------------------------------------------------------------------------
// text summary
// ---------------------------------------------------------------------------

/** Lowest and highest SOUNDING pitch actually used by a part. */
function soundingRange(part: Part, fifths: number): string {
  let lo: number | null = null;
  let hi: number | null = null;
  for (const m of part.measures) {
    for (const n of m.notes) {
      const midi = isRest(n.pitch) ? null : pitchToMidi(n.pitch);
      if (midi === null) continue;
      if (lo === null || midi < lo) lo = midi;
      if (hi === null || midi > hi) hi = midi;
    }
  }
  if (lo === null || hi === null) return 'silent';
  return `${midiToPitch(lo, fifths)}–${midiToPitch(hi, fifths)}`;
}

/** Plain-text lead sheet fallback (title, key, chords, part list) for quick inspection. */
export function toTextSummary(score: Score): string {
  const bars = score.parts.reduce((n, p) => Math.max(n, p.measures.length), 0);
  const fifths = keyFifths(score.key);
  const lines: string[] = [];
  lines.push(`${score.title || 'Untitled'}`);
  lines.push(
    `${score.key || 'C'} · ${score.time} · ♩=${score.tempo} · ${score.level} · ${bars} bar${bars === 1 ? '' : 's'} · ${score.parts.length} part${score.parts.length === 1 ? '' : 's'}`,
  );
  if (score.source) lines.push(`source: ${score.source}`);
  lines.push('');

  const rows = score.parts.map((p) => {
    const inst = instrumentOf(p);
    return {
      label: p.label,
      name: inst.name,
      key: inst.unpitched ? '—' : writtenKey(score.key, inst.transposition),
      bars: `${p.measures.length} bars`,
      range: inst.unpitched ? 'unpitched' : soundingRange(p, fifths),
      muted: p.muted ? ' (muted)' : '',
    };
  });
  const w = (pick: (r: (typeof rows)[number]) => string) => rows.reduce((n, r) => Math.max(n, pick(r).length), 0);
  const wLabel = w((r) => r.label);
  const wName = w((r) => r.name);
  const wKey = w((r) => r.key);
  const wBars = w((r) => r.bars);
  for (const r of rows) {
    lines.push(
      `  ${r.label.padEnd(wLabel)}  ${r.name.padEnd(wName)}  written ${r.key.padEnd(wKey)}  ${r.bars.padEnd(wBars)}  ${r.range}${r.muted}`,
    );
  }
  if (!rows.length) lines.push('  (no parts)');
  lines.push('');

  const chords = score.chords ?? [];
  const chordLine = chords.length ? `| ${chords.map((c) => c || '—').join(' | ')} |` : '(no chords)';
  lines.push(`chords  ${chordLine}`);
  return lines.join('\n') + '\n';
}
