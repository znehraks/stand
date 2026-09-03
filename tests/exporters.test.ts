import { describe, expect, it } from 'vitest';
import { INSTRUMENTS } from '../src/core/instruments';
import { toMidiBytes, toMusicXML, toPartMusicXML, toTextSummary } from '../src/core/exporters';
import type { Instrument, Level, Measure, Part, Score } from '../src/core/types';
import { DUR_TICKS } from '../src/core/types';
import { keyFifths, writtenKey } from '../src/core/pitch';

// The instrument table is owned by another module. Register exactly the entries these tests need,
// under their own ids, without disturbing anything the table already defines.
function range(lo: string, hi: string): Record<Level, [string, string]> {
  return { elementary: [lo, hi], middle: [lo, hi], high: [lo, hi], adult: [lo, hi] };
}
function ensure(inst: Instrument): string {
  if (!INSTRUMENTS[inst.id]) INSTRUMENTS[inst.id] = inst;
  return inst.id;
}

const FLUTE = ensure({
  id: 'test-flute',
  name: 'Flute',
  short: 'Fl.',
  clef: 'treble',
  section: 'woodwind',
  transposition: 0,
  range: range('C4', 'C7'),
});
const CLARINET = ensure({
  id: 'test-bb-clarinet',
  name: 'Bb Clarinet',
  short: 'Cl.',
  clef: 'treble',
  section: 'woodwind',
  transposition: 2,
  range: range('E3', 'C6'),
});
const TENOR_SAX = ensure({
  id: 'test-bb-tenor-sax',
  name: 'Bb Tenor Sax',
  short: 'T. Sx.',
  clef: 'treble',
  section: 'woodwind',
  transposition: 14,
  range: range('Ab2', 'E5'),
});
const ALTO_SAX = ensure({
  id: 'test-eb-alto-sax',
  name: 'Eb Alto Sax',
  short: 'A. Sx.',
  clef: 'treble',
  section: 'woodwind',
  transposition: 9,
  range: range('Db3', 'A5'),
});
const SNARE = ensure({
  id: 'test-snare',
  name: 'Snare Drum',
  short: 'S.D.',
  clef: 'percussion',
  section: 'percussion',
  transposition: 0,
  unpitched: true,
  range: range('C5', 'C5'),
});

function part(id: string, instrumentId: string, label: string, measures: Measure[]): Part {
  return { id, instrumentId, label, measures };
}

/** Concert Bb major, 4/4, two bars, one part per exported shape we care about. */
function fixture(): Score {
  return {
    title: 'Test Arrangement',
    key: 'Bb',
    time: '4/4',
    tempo: 96,
    level: 'middle',
    source: 'public domain',
    chords: ['Bb', 'F7/A'],
    parts: [
      part(`flute-1`, FLUTE, 'Flute 1', [
        { notes: [{ pitch: 'Bb4', dur: 'q', dyn: 'mf' }, { pitch: 'C5', dur: 'q' }, { pitch: 'D5', dur: 'h', tie: true }] },
        { notes: [{ pitch: 'D5', dur: 'h' }, { pitch: 'r', dur: 'q' }, { pitch: 'F5', dur: 'q', art: 'staccato' }] },
      ]),
      part('clarinet-1', CLARINET, 'Clarinet 1', [
        { notes: [{ pitch: 'F4', dur: 'qd' }, { pitch: 'G4', dur: '8' }, { pitch: 'B4', dur: 'h' }] },
        { notes: [{ pitch: 'Bb4', dur: 'w', lyric: 'ah' }] },
      ]),
      part('tenor-sax-1', TENOR_SAX, 'Tenor Sax', [
        { notes: [{ pitch: 'Bb2', dur: 'h' }, { pitch: 'F3', dur: 'h' }] },
        { notes: [{ pitch: 'Bb2', dur: 'w' }] },
      ]),
      part('alto-sax-1', ALTO_SAX, 'Alto Sax', [
        { notes: [{ pitch: 'D4', dur: 'w' }] },
        { notes: [{ pitch: 'C4', dur: 'h' }, { pitch: 'Bb3', dur: 'h' }] },
      ]),
      part('snare-1', SNARE, 'Snare Drum', [
        { notes: [{ pitch: 'C5', dur: '8' }, { pitch: 'C5', dur: '8' }, { pitch: 'C5', dur: 'q' }, { pitch: 'C5', dur: 'h' }] },
        { notes: [{ pitch: 'r', dur: 'w' }] },
      ]),
    ],
  };
}

/** The <part>…</part> blocks of a partwise document, in order. */
function partBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<part id="[^"]+">([\s\S]*?)<\/part>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) blocks.push(m[1]);
  return blocks;
}

function measureBlocks(partXml: string): string[] {
  const blocks: string[] = [];
  const re = /<measure number="\d+">([\s\S]*?)<\/measure>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(partXml))) blocks.push(m[1]);
  return blocks;
}

function latin1(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

describe('toMusicXML', () => {
  const score = fixture();
  const xml = toMusicXML(score);

  it('is a MusicXML 4.0 partwise document declaring Stand as the software', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN"');
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<work-title>Test Arrangement</work-title>');
    expect(xml).toContain('<software>Stand</software>');
    expect(xml).toContain('</score-partwise>');
  });

  it('lists one score-part per part, with name and abbreviation', () => {
    const scoreParts = xml.match(/<score-part id="[^"]+">/g) ?? [];
    expect(scoreParts).toHaveLength(score.parts.length);
    expect(partBlocks(xml)).toHaveLength(score.parts.length);
    for (const p of score.parts) expect(xml).toContain(`<part-name>${p.label}</part-name>`);
    expect(xml).toContain('<part-abbreviation>Cl.</part-abbreviation>');
    expect(xml).toContain('<instrument-name>Bb Clarinet</instrument-name>');
  });

  it('opens every part with divisions, key, time and clef', () => {
    for (const block of partBlocks(xml)) {
      expect(block).toContain('<divisions>480</divisions>');
      expect(block).toContain('<time><beats>4</beats><beat-type>4</beat-type></time>');
      expect(block).toMatch(/<clef><sign>[GFC]|<clef><sign>percussion/);
      expect((block.match(/<attributes>/g) ?? [])).toHaveLength(1);
    }
  });

  it('writes the Bb clarinet a whole step up: chromatic -2 and a key two fifths sharper', () => {
    const clarinet = partBlocks(xml)[1];
    expect(clarinet).toContain('<diatonic>-1</diatonic>');
    expect(clarinet).toContain('<chromatic>-2</chromatic>');
    expect(clarinet).not.toContain('<octave-change>');
    const concert = keyFifths(score.key); // Bb -> -2
    const written = Number(/<key><fifths>(-?\d+)<\/fifths><\/key>/.exec(clarinet)![1]);
    expect(written).toBe(concert + 2);
    expect(written).toBe(keyFifths(writtenKey(score.key, 2)));
    // Concert Bb4 is written C5 for a clarinet in Bb.
    expect(clarinet).toContain('<step>C</step>');
    // The concert B4 leaves the written key signature, so it prints an accidental.
    expect(clarinet).toContain('<accidental>');
  });

  it('gives the C flute no transpose and the wider transposers an octave-change', () => {
    const [flute, , tenor, alto] = partBlocks(xml);
    expect(flute).not.toContain('<transpose>');
    expect(flute).toContain('<key><fifths>-2</fifths></key>');
    expect(tenor).toContain('<chromatic>-2</chromatic>');
    expect(tenor).toContain('<octave-change>-1</octave-change>');
    expect(alto).toContain('<diatonic>-5</diatonic>');
    expect(alto).toContain('<chromatic>-9</chromatic>');
    expect(alto).not.toContain('<octave-change>');
    expect(keyFifths(writtenKey(score.key, 9))).toBe(1); // Bb concert -> G for alto sax
    expect(alto).toContain('<key><fifths>1</fifths></key>');
  });

  it('fills every 4/4 bar to exactly 1920 divisions', () => {
    for (const block of partBlocks(xml)) {
      const measures = measureBlocks(block);
      expect(measures).toHaveLength(2);
      for (const measure of measures) {
        const total = [...measure.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((s, m) => s + Number(m[1]), 0);
        expect(total).toBe(DUR_TICKS.w);
      }
    }
  });

  it('marks dots, rests, ties, articulations and lyrics', () => {
    const [flute, clarinet] = partBlocks(xml);
    expect(flute).toContain('<tie type="start"/>');
    expect(flute).toContain('<tied type="start"/>');
    expect(flute).toContain('<tie type="stop"/>');
    expect(flute).toContain('<tied type="stop"/>');
    expect(flute).toContain('<rest/>');
    expect(flute).toContain('<staccato/>');
    expect(flute).toContain('<dynamics><mf/></dynamics>');
    expect(clarinet).toContain('<dot/>');
    expect(clarinet).toContain('<text>ah</text>');
  });

  it('puts chord symbols above the top part only', () => {
    const blocks = partBlocks(xml);
    expect(blocks[0]).toContain('<root-step>B</root-step>');
    expect(blocks[0]).toContain('<root-alter>-1</root-alter>');
    expect(blocks[0]).toContain('<kind text="7">dominant</kind>');
    expect(blocks[0]).toContain('<bass-step>A</bass-step>');
    for (const other of blocks.slice(1)) expect(other).not.toContain('<harmony');
  });

  it('writes percussion on an unpitched staff', () => {
    const snare = partBlocks(xml)[4];
    expect(snare).toContain('<clef><sign>percussion</sign><line>2</line></clef>');
    expect(snare).toContain('<key><fifths>0</fifths></key>'); // no key signature on an unpitched staff
    expect(snare).toContain('<staff-details><staff-lines>1</staff-lines></staff-details>');
    expect(snare).toContain('<unpitched>');
    expect(snare).toContain('<display-step>C</display-step>');
    expect(snare).not.toContain('<pitch>');
    expect(snare).not.toContain('<transpose>');
  });

  it('survives a part whose instrument the table does not know', () => {
    const odd: Score = { ...fixture(), parts: [part('mystery', 'no-such-instrument', 'Mystery', [{ notes: [{ pitch: 'C4', dur: 'w' }] }])] };
    const out = toMusicXML(odd);
    expect(out).toContain('<part-name>Mystery</part-name>');
    expect(out).toContain('<step>C</step>');
  });
});

describe('toPartMusicXML', () => {
  const score = fixture();

  it('exports one part, titled score — part', () => {
    const xml = toPartMusicXML(score, 'clarinet-1');
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(xml).toContain('<work-title>Test Arrangement — Clarinet 1</work-title>');
    expect(xml.match(/<score-part id="[^"]+">/g) ?? []).toHaveLength(1);
    expect(partBlocks(xml)).toHaveLength(1);
    expect(xml).toContain('<chromatic>-2</chromatic>');
    expect(xml).not.toContain('<part-name>Flute 1</part-name>');
  });

  it('returns a valid empty document for an unknown part id', () => {
    const xml = toPartMusicXML(score, 'nope');
    expect(xml).toContain('<score-partwise version="4.0">');
    expect(partBlocks(xml)).toHaveLength(0);
  });
});

describe('toMidiBytes', () => {
  it('writes a standard MIDI file with one track per part', () => {
    const score = fixture();
    const bytes = toMidiBytes(score);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(50);
    const text = latin1(bytes);
    expect(text.slice(0, 4)).toBe('MThd');
    expect((text.match(/MTrk/g) ?? [])).toHaveLength(score.parts.length);
    expect(text).toContain('Flute 1');
  });

  it('merges a tie into one note instead of two', () => {
    const base: Score = {
      title: 'Tie',
      key: 'C',
      time: '4/4',
      tempo: 100,
      level: 'middle',
      chords: [],
      parts: [
        part('t', FLUTE, 'Tied', [
          { notes: [{ pitch: 'C5', dur: 'h', tie: true }, { pitch: 'C5', dur: 'h' }] },
        ]),
      ],
    };
    const split: Score = {
      ...base,
      parts: [part('t', FLUTE, 'Tied', [{ notes: [{ pitch: 'C5', dur: 'h' }, { pitch: 'C5', dur: 'h' }] }])],
    };
    expect(toMidiBytes(base).length).toBeLessThan(toMidiBytes(split).length);
  });

  it('handles an empty score without throwing', () => {
    const empty: Score = { title: 'Empty', key: 'C', time: '4/4', tempo: 100, level: 'elementary', chords: [], parts: [] };
    const text = latin1(toMidiBytes(empty));
    expect(text.slice(0, 4)).toBe('MThd');
  });
});

describe('toTextSummary', () => {
  it('names the score, its settings, every part and the chords', () => {
    const score = fixture();
    const text = toTextSummary(score);
    expect(text).toContain('Test Arrangement');
    expect(text).toContain('Bb');
    expect(text).toContain('4/4');
    expect(text).toContain('96');
    expect(text).toContain('middle');
    expect(text).toContain('2 bars');
    for (const p of score.parts) expect(text).toContain(p.label);
    expect(text).toContain('Bb Clarinet');
    expect(text).toContain('written C'); // clarinet reads C major against concert Bb
    expect(text).toContain('Bb4–F5'); // flute's sounding range
    expect(text).toContain('unpitched'); // the snare gets no written key or range
    expect(text).toContain('| Bb | F7/A |');
    expect(text).toContain('public domain');
  });

  it('says so when a part has nothing in it', () => {
    const score: Score = {
      title: 'Bare',
      key: 'C',
      time: '4/4',
      tempo: 80,
      level: 'elementary',
      chords: [],
      parts: [part('p', FLUTE, 'Flute 1', [{ notes: [{ pitch: 'r', dur: 'w' }] }])],
    };
    const text = toTextSummary(score);
    expect(text).toContain('silent');
    expect(text).toContain('(no chords)');
  });
});

