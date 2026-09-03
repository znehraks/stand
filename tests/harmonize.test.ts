import { describe, expect, it } from 'vitest';
import { checkScore } from '../src/core/check';
import { harmonize } from '../src/core/harmonize';
import { INSTRUMENTS } from '../src/core/instruments';
import { pitchToMidi } from '../src/core/pitch';
import {
  DUR_TICKS,
  TIME_TICKS,
  type Dur,
  type Level,
  type Measure,
  type Note,
  type Part,
  type Score,
  type TimeSig,
} from '../src/core/types';

// ---------------------------------------------------------------- fixtures

const q = (...pitches: string[]): Measure => ({ notes: pitches.map((pitch) => ({ pitch, dur: 'q' as Dur })) });
const halves = (a: string, b: string): Measure => ({ notes: [{ pitch: a, dur: 'h' }, { pitch: b, dur: 'h' }] });
const restBar = (): Measure => ({ notes: [{ pitch: 'r', dur: 'w' }] });

function part(id: string, instrumentId: string, label: string, measures: Measure[]): Part {
  return { id, instrumentId, label, measures };
}

function makeScore(
  melody: Measure[],
  chords: string[],
  level: Level,
  targets: [string, string][],
  time: TimeSig = '4/4',
): Score {
  return {
    title: 'test',
    key: 'C',
    time,
    tempo: 96,
    level,
    chords,
    parts: [
      part('melody', 'flute', 'Flute 1', melody),
      ...targets.map(([id, inst]) => part(id, inst, id, melody.map(() => restBar()))),
    ],
  };
}

function rangeMidi(instrumentId: string, level: Level): [number, number] {
  const span = INSTRUMENTS[instrumentId].range[level];
  return [pitchToMidi(span[0]) as number, pitchToMidi(span[1]) as number];
}

function sounding(m: Measure): Note[] {
  return m.notes.filter((n) => n.pitch !== 'r');
}

function ticks(m: Measure): number {
  return m.notes.reduce((s, n) => s + DUR_TICKS[n.dur], 0);
}

/** Merge a harmonize result back into the score so the checker sees the whole picture. */
function merged(score: Score, from: number, byPart: Record<string, Measure[]>): Score {
  return {
    ...score,
    parts: score.parts.map((p) => {
      const written = byPart[p.id];
      if (!written) return p;
      const bars = p.measures.slice();
      while (bars.length < from + written.length) bars.push(restBar());
      written.forEach((m, i) => (bars[from + i] = m));
      return { ...p, measures: bars };
    }),
  };
}

const PCS: Record<string, number[]> = { C: [0, 4, 7], F: [5, 9, 0], G: [7, 11, 2], Am: [9, 0, 4], G7: [7, 11, 2, 5] };

// A four-bar tune over C–F–G–C, comfortably inside a middle-school flute range.
const TUNE: Measure[] = [q('E5', 'G5', 'E5', 'C5'), q('F5', 'A5', 'F5', 'C5'), q('D5', 'G5', 'B4', 'D5'), halves('E5', 'C5')];
const PROGRESSION = ['C', 'F', 'G', 'C'];

// ---------------------------------------------------------------- tests

describe('harmonize — block', () => {
  const score = makeScore(TUNE, PROGRESSION, 'middle', [
    ['clar', 'clarinet'],
    ['hn', 'horn'],
    ['tba', 'tuba'],
  ]);
  const out = harmonize(score, { sourcePart: 'melody', targetParts: ['clar', 'hn', 'tba'], style: 'block' });

  it('writes one bar per source bar into every target', () => {
    expect(out.from).toBe(0);
    expect(Object.keys(out.measuresByPart).sort()).toEqual(['clar', 'hn', 'tba']);
    for (const id of ['clar', 'hn', 'tba']) expect(out.measuresByPart[id]).toHaveLength(4);
  });

  it('puts chord tones in each target and nothing outside its range', () => {
    for (const [id, inst] of [
      ['clar', 'clarinet'],
      ['hn', 'horn'],
      ['tba', 'tuba'],
    ]) {
      const [lo, hi] = rangeMidi(inst, 'middle');
      out.measuresByPart[id].forEach((bar, i) => {
        const wanted = PCS[PROGRESSION[i]];
        expect(sounding(bar).length).toBeGreaterThan(0);
        for (const n of sounding(bar)) {
          const midi = pitchToMidi(n.pitch) as number;
          expect(midi).not.toBeNull();
          expect(midi).toBeGreaterThanOrEqual(lo);
          expect(midi).toBeLessThanOrEqual(hi);
          expect(wanted).toContain(((midi % 12) + 12) % 12);
        }
      });
    }
  });

  it('aligns rhythmically with the melody and fills every bar exactly', () => {
    for (const id of ['clar', 'hn', 'tba']) {
      out.measuresByPart[id].forEach((bar, i) => {
        expect(ticks(bar)).toBe(TIME_TICKS['4/4']);
        expect(bar.notes.map((n) => n.dur)).toEqual(TUNE[i].notes.map((n) => n.dur));
      });
    }
  });

  it('doubles the root in the lowest part and never crosses voices', () => {
    out.measuresByPart.tba.forEach((bar, i) => {
      const root = PCS[PROGRESSION[i]][0];
      for (const n of sounding(bar)) expect(((pitchToMidi(n.pitch) as number) % 12 + 12) % 12).toBe(root);
    });
    for (let bar = 0; bar < 4; bar++) {
      const rows = ['clar', 'hn', 'tba'].map((id) => out.measuresByPart[id][bar].notes);
      for (let i = 0; i < rows[0].length; i++) {
        const stack = rows.map((r) => (r[i].pitch === 'r' ? null : (pitchToMidi(r[i].pitch) as number)));
        for (let v = 1; v < stack.length; v++) {
          if (stack[v] === null || stack[v - 1] === null) continue;
          expect(stack[v]).toBeLessThan(stack[v - 1] as number);
        }
      }
    }
  });

  it('passes the checker with no errors', () => {
    const issues = checkScore(merged(score, out.from, out.measuresByPart)).filter((i) => i.severity === 'error');
    expect(issues).toEqual([]);
  });

  it('explains itself in plain sentences', () => {
    expect(out.notes.length).toBeGreaterThan(0);
    expect(out.notes.join(' ')).toMatch(/Flute 1/);
  });
});

describe('harmonize — range fitting', () => {
  it('shifts a chord tone by an octave rather than writing it out of range', () => {
    const score = makeScore(TUNE, PROGRESSION, 'elementary', [['tba', 'tuba']]);
    const out = harmonize(score, { sourcePart: 'melody', targetParts: ['tba'], style: 'block' });
    const [lo, hi] = rangeMidi('tuba', 'elementary'); // Bb1..F3 — nowhere near the melody
    const heard = out.measuresByPart.tba.flatMap((m) => sounding(m).map((n) => pitchToMidi(n.pitch) as number));
    expect(heard.length).toBeGreaterThan(0);
    for (const midi of heard) {
      expect(midi).toBeGreaterThanOrEqual(lo);
      expect(midi).toBeLessThanOrEqual(hi);
    }
    // The chord tone is still the root of each bar's chord, just an octave or two down.
    out.measuresByPart.tba.forEach((bar, i) => {
      for (const n of sounding(bar)) expect(((pitchToMidi(n.pitch) as number) % 12 + 12) % 12).toBe(PCS[PROGRESSION[i]][0]);
    });
  });

  it('rests, and says so, when no octave of the chord tone fits at all', () => {
    INSTRUMENTS['test-narrow'] = {
      id: 'test-narrow',
      name: 'Test Narrow',
      short: 'Nar.',
      clef: 'treble',
      section: 'woodwind',
      transposition: 0,
      // D4..E4 holds no C, F or G — no octave of any root in the progression fits.
      range: { elementary: ['D4', 'E4'], middle: ['D4', 'E4'], high: ['D4', 'E4'], adult: ['D4', 'E4'] },
    };
    const score = makeScore(TUNE, PROGRESSION, 'middle', [['nar', 'test-narrow']]);
    const out = harmonize(score, { sourcePart: 'melody', targetParts: ['nar'], style: 'block' });
    expect(out.measuresByPart.nar.every((m) => sounding(m).length === 0)).toBe(true);
    expect(out.measuresByPart.nar.every((m) => ticks(m) === TIME_TICKS['4/4'])).toBe(true);
    expect(out.notes.join(' ')).toMatch(/rest/i);
    delete INSTRUMENTS['test-narrow'];
  });
});

describe('harmonize — pad', () => {
  const score = makeScore(TUNE, PROGRESSION, 'middle', [
    ['clar', 'clarinet'],
    ['hn', 'horn'],
    ['tba', 'tuba'],
  ]);
  const out = harmonize(score, { sourcePart: 'melody', targetParts: ['clar', 'hn', 'tba'], style: 'pad' });

  it('holds one chord tone per bar, root at the bottom, in range', () => {
    for (const id of ['clar', 'hn', 'tba']) {
      out.measuresByPart[id].forEach((bar) => {
        expect(ticks(bar)).toBe(TIME_TICKS['4/4']);
        expect(sounding(bar)).toHaveLength(1);
      });
    }
    out.measuresByPart.tba.forEach((bar, i) => {
      expect(((pitchToMidi(sounding(bar)[0].pitch) as number) % 12 + 12) % 12).toBe(PCS[PROGRESSION[i]][0]);
    });
    const [lo, hi] = rangeMidi('horn', 'middle');
    for (const bar of out.measuresByPart.hn) {
      const midi = pitchToMidi(sounding(bar)[0].pitch) as number;
      expect(midi).toBeGreaterThanOrEqual(lo);
      expect(midi).toBeLessThanOrEqual(hi);
    }
  });

  it('passes the checker with no errors', () => {
    const issues = checkScore(merged(score, out.from, out.measuresByPart)).filter((i) => i.severity === 'error');
    expect(issues).toEqual([]);
  });
});

describe('harmonize — countermelody', () => {
  // Two half notes a bar, so the strong-beat grid lines up one-to-one with the melody.
  const melody: Measure[] = [
    halves('C5', 'E5'),
    halves('G5', 'A5'),
    halves('B5', 'C6'),
    halves('B5', 'A5'),
    halves('G5', 'F5'),
    halves('E5', 'D5'),
    halves('C5', 'E5'),
    halves('G5', 'C6'),
  ];
  const chords = ['C', 'F', 'G', 'C', 'G', 'F', 'C', 'C'];
  const score = makeScore(melody, chords, 'middle', [
    ['clar', 'clarinet'],
    ['hn', 'horn'],
    ['tba', 'tuba'],
  ]);
  const out = harmonize(score, { sourcePart: 'melody', targetParts: ['clar', 'hn', 'tba'], style: 'countermelody' });

  it('moves opposite to the melody more often than with it', () => {
    const line = out.measuresByPart.clar.flatMap((m) => m.notes.map((n) => (n.pitch === 'r' ? null : (pitchToMidi(n.pitch) as number))));
    const tune = melody.flatMap((m) => m.notes.map((n) => pitchToMidi(n.pitch) as number));
    expect(line).toHaveLength(tune.length);
    let contrary = 0;
    let similar = 0;
    for (let i = 1; i < tune.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (a === null || b === null) continue;
      const melodyStep = Math.sign(tune[i] - tune[i - 1]);
      const counterStep = Math.sign(b - a);
      if (!melodyStep || !counterStep) continue;
      if (melodyStep === counterStep) similar += 1;
      else contrary += 1;
    }
    expect(contrary + similar).toBeGreaterThan(4);
    expect(contrary).toBeGreaterThan(similar);
  });

  it('keeps the countermelody stepwise, in range and on chord tones', () => {
    const [lo, hi] = rangeMidi('clarinet', 'middle');
    const line = out.measuresByPart.clar.flatMap((m, i) => sounding(m).map((n) => ({ midi: pitchToMidi(n.pitch) as number, bar: i })));
    for (const { midi, bar } of line) {
      expect(midi).toBeGreaterThanOrEqual(lo);
      expect(midi).toBeLessThanOrEqual(hi);
      expect(PCS[chords[bar]]).toContain(((midi % 12) + 12) % 12);
    }
    const leaps = line.slice(1).filter((n, i) => Math.abs(n.midi - line[i].midi) > 7);
    expect(leaps.length).toBeLessThanOrEqual(2);
  });

  it('gives the remaining targets a pad and fills every bar', () => {
    for (const id of ['clar', 'hn', 'tba']) {
      for (const bar of out.measuresByPart[id]) expect(ticks(bar)).toBe(TIME_TICKS['4/4']);
    }
    for (const bar of out.measuresByPart.hn) expect(sounding(bar)).toHaveLength(1);
    const issues = checkScore(merged(score, out.from, out.measuresByPart)).filter((i) => i.severity === 'error');
    expect(issues).toEqual([]);
  });
});

describe('harmonize — chords and edges', () => {
  it('infers a chord from the melody when the bar has no symbol', () => {
    const score = makeScore(TUNE, ['C', '', 'G', ''], 'middle', [['tba', 'tuba']]);
    const out = harmonize(score, { sourcePart: 'melody', targetParts: ['tba'], style: 'pad' });
    expect(out.notes.join(' ')).toMatch(/bar 2/);
    // Bar 2 is F–A–F–C over a C-major key: F is the only I/IV/V/vi chord that holds all of it.
    const bar2 = sounding(out.measuresByPart.tba[1])[0];
    expect(((pitchToMidi(bar2.pitch) as number) % 12 + 12) % 12).toBe(5);
  });

  it('honours from/to and reports the first bar it wrote', () => {
    const score = makeScore(TUNE, PROGRESSION, 'middle', [['hn', 'horn']]);
    const out = harmonize(score, { sourcePart: 'melody', targetParts: ['hn'], style: 'block', from: 1, to: 2 });
    expect(out.from).toBe(1);
    expect(out.measuresByPart.hn).toHaveLength(2);
    expect(out.measuresByPart.hn[0].notes.map((n) => n.dur)).toEqual(TUNE[1].notes.map((n) => n.dur));
  });

  it('reads a slash chord and a seventh', () => {
    const score = makeScore([q('E5', 'G5', 'E5', 'C5')], ['G7/B'], 'middle', [
      ['clar', 'clarinet'],
      ['tba', 'tuba'],
    ]);
    const out = harmonize(score, { sourcePart: 'melody', targetParts: ['clar', 'tba'], style: 'block' });
    for (const n of sounding(out.measuresByPart.tba[0])) {
      expect(((pitchToMidi(n.pitch) as number) % 12 + 12) % 12).toBe(11); // B, the written bass
    }
    for (const n of sounding(out.measuresByPart.clar[0])) {
      expect(PCS.G7).toContain(((pitchToMidi(n.pitch) as number) % 12 + 12) % 12);
    }
  });

  it('refuses politely when the source part is missing and skips unpitched targets', () => {
    const score = makeScore(TUNE, PROGRESSION, 'middle', [['sd', 'snare']]);
    const nothing = harmonize(score, { sourcePart: 'nope', targetParts: ['sd'], style: 'block' });
    expect(nothing.measuresByPart).toEqual({});
    expect(nothing.notes.join(' ')).toMatch(/nope/);
    const drums = harmonize(score, { sourcePart: 'melody', targetParts: ['sd'], style: 'block' });
    expect(drums.measuresByPart).toEqual({});
    expect(drums.notes.join(' ')).toMatch(/unpitched/i);
  });
});

describe('harmonize — other time signatures', () => {
  const cases: [TimeSig, Measure[]][] = [
    ['3/4', [{ notes: [{ pitch: 'E5', dur: 'q' }, { pitch: 'G5', dur: 'q' }, { pitch: 'C5', dur: 'q' }] }, { notes: [{ pitch: 'F5', dur: 'hd' }] }]],
    ['6/8', [{ notes: [{ pitch: 'E5', dur: '8' }, { pitch: 'G5', dur: '8' }, { pitch: 'C5', dur: '8' }, { pitch: 'A5', dur: 'qd' }] }, { notes: [{ pitch: 'F5', dur: 'hd' }] }]],
    ['2/4', [{ notes: [{ pitch: 'E5', dur: 'q' }, { pitch: 'G5', dur: 'q' }] }, { notes: [{ pitch: 'F5', dur: 'h' }] }]],
  ];

  for (const [time, melody] of cases) {
    for (const style of ['block', 'pad', 'countermelody'] as const) {
      it(`fills every bar of ${time} in ${style} style`, () => {
        const score = makeScore(melody, ['C', 'F'], 'middle', [['clar', 'clarinet'], ['tba', 'tuba']], time);
        const out = harmonize(score, { sourcePart: 'melody', targetParts: ['clar', 'tba'], style });
        for (const id of ['clar', 'tba']) {
          expect(out.measuresByPart[id]).toHaveLength(2);
          for (const bar of out.measuresByPart[id]) expect(ticks(bar)).toBe(TIME_TICKS[time]);
        }
        const errors = checkScore(merged(score, out.from, out.measuresByPart)).filter((i) => i.severity === 'error');
        expect(errors).toEqual([]);
      });
    }
  }
});
