import { describe, expect, it } from 'vitest';
import { checkPart, checkScore, describeIssue, validateWrite } from '../src/core/check';
import { INSTRUMENTS } from '../src/core/instruments';
import type { CheckIssue, Dur, Level, Measure, Note, Part, Score, TimeSig } from '../src/core/types';

// Fixtures are built by hand against the real instrument table: flute (C, elementary C4..C6),
// trumpet (Bb, elementary sounding F3..C5, adult E3..C6), trombone (C, bass clef).

function n(pitch: string, dur: Dur): Note {
  return { pitch, dur };
}

function bar(...notes: Note[]): Measure {
  return { notes };
}

function part(id: string, instrumentId: string, label: string, measures: Measure[]): Part {
  return { id, instrumentId, label, measures };
}

function score(over: Partial<Score> & { parts: Part[] }): Score {
  const time: TimeSig = over.time ?? '4/4';
  const bars = over.parts.reduce((m, p) => Math.max(m, p.measures.length), 0);
  return {
    title: over.title ?? 'Fixture',
    key: over.key ?? 'C',
    time,
    tempo: over.tempo ?? 96,
    level: (over.level ?? 'middle') as Level,
    parts: over.parts,
    chords: over.chords ?? Array.from({ length: bars }, () => ''),
  };
}

const errors = (issues: CheckIssue[]): CheckIssue[] => issues.filter((i) => i.severity === 'error');
const warnings = (issues: CheckIssue[]): CheckIssue[] => issues.filter((i) => i.severity === 'warning');

describe('the instrument table the fixtures rely on', () => {
  it('has flute, trumpet and trombone with the expected transpositions', () => {
    expect(INSTRUMENTS.flute?.transposition).toBe(0);
    expect(INSTRUMENTS.trumpet?.transposition).toBe(2);
    expect(INSTRUMENTS.trombone?.transposition).toBe(0);
  });
});

describe('measure length', () => {
  const short = score({
    parts: [part('flute', 'flute', 'Flute', [bar(n('C5', 'q'), n('D5', 'q'), n('E5', 'q'), n('F5', 'q')), bar(n('C5', 'q'), n('D5', 'q'), n('E5', 'q'))])],
  });

  it('rejects a bar that is one beat short and names the bar and the totals', () => {
    const issues = checkScore(short);
    const bad = errors(issues);
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe('measure-length');
    expect(bad[0].measure).toBe(1);
    expect(bad[0].message).toMatch(/bar 2/);
    expect(bad[0].message).toContain('1440');
    expect(bad[0].message).toContain('1920');
    expect(bad[0].message).toContain('Flute');
    expect(bad[0].suggestion).toMatch(/quarter note/);
  });

  it('describes the issue with a 1-based bar number', () => {
    const line = describeIssue(short, errors(checkScore(short))[0]);
    expect(line).toMatch(/bar 2/);
    expect(line.startsWith('Error')).toBe(true);
  });

  it('flags an over-long bar too', () => {
    const long = score({ parts: [part('flute', 'flute', 'Flute', [bar(n('C5', 'w'), n('D5', 'q'))])] });
    const bad = errors(checkScore(long));
    expect(bad).toHaveLength(1);
    expect(bad[0].message).toContain('2400');
    expect(bad[0].suggestion).toMatch(/over by 480/);
  });
});

describe('range', () => {
  const trumpetBar = () => bar(n('Bb5', 'q'), n('G4', 'q'), n('A4', 'q'), n('G4', 'q'));

  it('rejects a trumpet note above the elementary range and suggests the octave', () => {
    const s = score({ level: 'elementary', parts: [part('trumpet', 'trumpet', 'Trumpet', [trumpetBar()])] });
    const bad = errors(checkScore(s));
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe('range');
    expect(bad[0].measure).toBe(0);
    expect(bad[0].note).toBe(0);
    expect(bad[0].message).toContain('Trumpet');
    expect(bad[0].message).toMatch(/bar 1/);
    // written pitch (C6) and sounding pitch (Bb5) both named
    expect(bad[0].message).toContain('sounding Bb5');
    expect(bad[0].message).toContain('C6');
    expect(bad[0].suggestion).toMatch(/octave/i);
    expect(bad[0].suggestion).toContain('Bb4');
  });

  it('lets the same note through at adult level', () => {
    const s = score({ level: 'adult', parts: [part('trumpet', 'trumpet', 'Trumpet', [trumpetBar()])] });
    expect(errors(checkScore(s))).toHaveLength(0);
  });

  it('names another part in the score when an octave shift will not help', () => {
    const s = score({
      level: 'elementary',
      parts: [
        part('trombone', 'trombone', 'Trombone', [bar(n('C6', 'h'), n('F3', 'h'))]),
        part('flute', 'flute', 'Flute', [bar(n('C5', 'h'), n('D5', 'h'))]),
      ],
    });
    const bad = errors(checkScore(s)).filter((i) => i.kind === 'range');
    expect(bad).toHaveLength(1);
    expect(bad[0].suggestion).toContain('Flute');
    expect(bad[0].suggestion).toMatch(/Move this line/);
  });

  it('never range-checks unpitched percussion', () => {
    const drums = Object.values(INSTRUMENTS).find((i) => i.unpitched);
    if (!drums) return;
    const s = score({ level: 'elementary', parts: [part('perc', drums.id, 'Snare', [bar(n('C8', 'h'), n('C8', 'h'))])] });
    expect(errors(checkScore(s)).filter((i) => i.kind === 'range')).toHaveLength(0);
  });
});

describe('unknown pitches', () => {
  it('rejects a pitch it cannot parse', () => {
    const s = score({ parts: [part('flute', 'flute', 'Flute', [bar(n('H4', 'h'), n('C5', 'h'))])] });
    const bad = errors(checkScore(s));
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe('unknown-pitch');
    expect(bad[0].message).toContain('H4');
  });
});

describe('rhythm by level', () => {
  const sixteenths = () => bar(...Array.from({ length: 16 }, (_, i) => n(i % 2 ? 'D5' : 'C5', '16')));

  it('warns about sixteenths at elementary', () => {
    const s = score({ level: 'elementary', parts: [part('flute', 'flute', 'Flute', [sixteenths()])] });
    const w = warnings(checkScore(s)).filter((i) => i.kind === 'rhythm');
    expect(w.length).toBeGreaterThan(0);
    expect(w[0].message).toMatch(/sixteenth/);
    expect(errors(checkScore(s))).toHaveLength(0);
  });

  it('passes the same bar at high level', () => {
    const s = score({ level: 'high', parts: [part('flute', 'flute', 'Flute', [sixteenths()])] });
    expect(checkScore(s).filter((i) => i.kind === 'rhythm')).toHaveLength(0);
  });

  it('warns at middle level only about runs longer than four sixteenths', () => {
    const s = score({ level: 'middle', parts: [part('flute', 'flute', 'Flute', [sixteenths()])] });
    const w = checkScore(s).filter((i) => i.kind === 'rhythm');
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/run of 16 sixteenth/);
    const ok = score({
      level: 'middle',
      parts: [part('flute', 'flute', 'Flute', [bar(n('C5', '16'), n('D5', '16'), n('E5', '16'), n('F5', '16'), n('G5', 'q'), n('G5', 'h'))])],
    });
    expect(checkScore(ok).filter((i) => i.kind === 'rhythm')).toHaveLength(0);
  });
});

describe('key difficulty and leaps', () => {
  it('warns when the written key carries more accidentals than the level tolerates', () => {
    const s = score({
      level: 'elementary',
      key: 'Db',
      parts: [part('clarinet', 'clarinet', 'Clarinet', [bar(n('Ab4', 'h'), n('F4', 'h'))])],
    });
    const w = checkScore(s).filter((i) => i.kind === 'key-difficulty');
    expect(w).toHaveLength(1);
    // Bb clarinet in concert Db reads in Eb — three flats, one past the elementary tolerance of two.
    expect(w[0].message).toContain('Eb');
    expect(w[0].suggestion).toMatch(/Concert/);
  });

  it('warns about a leap wider than an octave at elementary', () => {
    const s = score({ level: 'elementary', parts: [part('flute', 'flute', 'Flute', [bar(n('C4', 'h'), n('E5', 'h'))])] });
    const w = checkScore(s).filter((i) => i.kind === 'leap');
    expect(w).toHaveLength(1);
    expect(w[0].measure).toBe(0);
    expect(w[0].message).toMatch(/16 semitones/);
    expect(checkScore({ ...s, level: 'middle' }).filter((i) => i.kind === 'leap')).toHaveLength(0);
  });
});

describe('between parts', () => {
  it('detects parallel fifths on consecutive strong beats', () => {
    const s = score({
      level: 'adult',
      parts: [
        part('flute-1', 'flute', 'Flute 1', [bar(n('G5', 'h'), n('A5', 'h'))]),
        part('flute-2', 'flute', 'Flute 2', [bar(n('C5', 'h'), n('D5', 'h'))]),
      ],
    });
    const w = checkScore(s).filter((i) => i.kind === 'parallel-fifths');
    expect(w).toHaveLength(1);
    expect(w[0].measure).toBe(0);
    expect(w[0].message).toContain('Flute 1');
    expect(w[0].message).toContain('Flute 2');
    expect(errors(checkScore(s))).toHaveLength(0);
  });

  it('leaves contrary motion alone', () => {
    const s = score({
      level: 'adult',
      parts: [
        part('flute-1', 'flute', 'Flute 1', [bar(n('G5', 'h'), n('F5', 'h'))]),
        part('flute-2', 'flute', 'Flute 2', [bar(n('C5', 'h'), n('D5', 'h'))]),
      ],
    });
    expect(checkScore(s).filter((i) => i.kind === 'parallel-fifths')).toHaveLength(0);
  });

  it('flags a lower part that sits above the part above it for a whole bar', () => {
    const s = score({
      level: 'adult',
      parts: [
        part('flute-1', 'flute', 'Flute 1', [bar(n('C5', 'h'), n('D5', 'h'))]),
        part('flute-2', 'flute', 'Flute 2', [bar(n('G5', 'h'), n('A5', 'h'))]),
      ],
    });
    const w = checkScore(s).filter((i) => i.kind === 'voice-crossing');
    expect(w).toHaveLength(1);
    expect(w[0].partId).toBe('flute-2');
    expect(w[0].message).toMatch(/bar 1/);
  });
});

describe('checkPart', () => {
  it('returns only the issues that involve one part', () => {
    const s = score({
      level: 'elementary',
      parts: [
        part('trumpet', 'trumpet', 'Trumpet', [bar(n('Bb5', 'q'), n('G4', 'q'), n('A4', 'q'), n('G4', 'q'))]),
        part('flute', 'flute', 'Flute', [bar(n('C5', 'q'), n('D5', 'q'), n('E5', 'q'))]),
      ],
    });
    const trumpet = checkPart(s, 'trumpet');
    expect(trumpet.some((i) => i.kind === 'range')).toBe(true);
    expect(trumpet.every((i) => i.partId === 'trumpet')).toBe(true);
    const flute = checkPart(s, 'Flute');
    expect(flute.some((i) => i.kind === 'measure-length')).toBe(true);
    expect(checkPart(s, 'tuba')).toHaveLength(0);
  });
});

describe('validateWrite', () => {
  const base = () =>
    score({
      level: 'elementary',
      parts: [
        part('trumpet', 'trumpet', 'Trumpet', [bar(n('G4', 'w')), bar(n('G4', 'w'))]),
        part('flute', 'flute', 'Flute', [bar(n('C5', 'w')), bar(n('C5', 'w'))]),
      ],
    });

  it('rejects a proposed bar that does not fill the time signature, with absolute bar numbers', () => {
    const s = base();
    const issues = validateWrite(s, s.parts[0], 1, [bar(n('G4', 'q'), n('A4', 'q'), n('G4', 'q'))]);
    const bad = errors(issues);
    expect(bad).toHaveLength(1);
    expect(bad[0].kind).toBe('measure-length');
    expect(bad[0].measure).toBe(1);
    expect(bad[0].message).toMatch(/bar 2/);
  });

  it('rejects an out-of-range note and an unreadable pitch in a proposed write', () => {
    const s = base();
    const issues = validateWrite(s, s.parts[0], 0, [bar(n('Bb5', 'h'), n('zz', 'h'))]);
    const kinds = errors(issues).map((i) => i.kind);
    expect(kinds).toContain('range');
    expect(kinds).toContain('unknown-pitch');
  });

  it('reports locked bars as warnings and lets the write through', () => {
    const s = base();
    s.parts[0].measures[1].locked = true;
    const issues = validateWrite(s, s.parts[0], 0, [bar(n('G4', 'w')), bar(n('A4', 'w'))]);
    expect(errors(issues)).toHaveLength(0);
    const locked = issues.filter((i) => i.kind === 'locked');
    expect(locked).toHaveLength(1);
    expect(locked[0].measure).toBe(1);
    expect(locked[0].message).toMatch(/bar 2/);
  });

  it('refuses an empty bar', () => {
    const s = base();
    const issues = validateWrite(s, s.parts[0], 0, [{ notes: [] }]);
    expect(errors(issues)).toHaveLength(1);
    expect(errors(issues)[0].kind).toBe('measure-length');
  });

  it('passes a clean write with no issues at all', () => {
    const s = base();
    expect(validateWrite(s, s.parts[0], 0, [bar(n('G4', 'h'), n('A4', 'h'))])).toHaveLength(0);
  });
});

describe('a correct score', () => {
  it('returns no errors', () => {
    const s = score({
      level: 'middle',
      key: 'F',
      parts: [
        part('flute', 'flute', 'Flute', [bar(n('F5', 'q'), n('G5', 'q'), n('A5', 'q'), n('F5', 'q')), bar(n('C5', 'h'), n('F5', 'h'))]),
        part('trombone', 'trombone', 'Trombone', [bar(n('F3', 'q'), n('A3', 'q'), n('C4', 'q'), n('A3', 'q')), bar(n('G3', 'h'), n('A3', 'h'))]),
      ],
    });
    expect(errors(checkScore(s))).toHaveLength(0);
    expect(checkScore(s)).toHaveLength(0);
  });
});
