import { describe, it, expect } from 'vitest';
import { INSTRUMENTS, SECTION_ORDER, findInstrument, instrumentIds, rangeFor, scoreOrder } from '../src/core/instruments';
import { LEVELS, type Level } from '../src/core/types';
import { pitchToMidi, writtenKey, transposePitch, parsePitch } from '../src/core/pitch';

const all = Object.values(INSTRUMENTS);
const midi = (p: string): number => {
  const m = pitchToMidi(p);
  expect(m, `pitch ${p} must parse`).not.toBeNull();
  return m as number;
};

describe('table shape', () => {
  it('holds at least 20 instruments, each keyed by its own id', () => {
    expect(all.length).toBeGreaterThanOrEqual(20);
    for (const [key, inst] of Object.entries(INSTRUMENTS)) expect(inst.id).toBe(key);
    expect(instrumentIds()).toEqual(Object.keys(INSTRUMENTS));
  });

  it('covers the required roster', () => {
    const required = [
      'flute', 'piccolo', 'oboe', 'clarinet', 'bass-clarinet', 'alto-sax', 'tenor-sax', 'bari-sax', 'bassoon',
      'trumpet', 'horn', 'trombone', 'euphonium', 'tuba', 'snare',
      'violin', 'viola', 'cello', 'soprano', 'alto', 'tenor', 'bass-voice', 'piano',
    ];
    for (const id of required) expect(INSTRUMENTS[id], `missing ${id}`).toBeTruthy();
  });

  it('gives every instrument a name, short label, known clef and known section', () => {
    for (const i of all) {
      expect(i.name.length, i.id).toBeGreaterThan(0);
      expect(i.short.length, i.id).toBeGreaterThan(0);
      expect(['treble', 'bass', 'alto', 'percussion']).toContain(i.clef);
      expect(SECTION_ORDER).toContain(i.section);
      expect((i.aliases ?? []).length, `${i.id} needs aliases`).toBeGreaterThan(0);
      for (const a of i.aliases ?? []) expect(a, `alias "${a}" must be lowercase`).toBe(a.toLowerCase());
    }
  });
});

describe('ranges', () => {
  it('parses and orders low < high at every level', () => {
    for (const i of all) {
      for (const level of LEVELS) {
        const [lo, hi] = rangeFor(i, level);
        expect(parsePitch(lo), `${i.id}/${level} low ${lo}`).not.toBeNull();
        expect(parsePitch(hi), `${i.id}/${level} high ${hi}`).not.toBeNull();
        expect(midi(hi), `${i.id}/${level}`).toBeGreaterThan(midi(lo));
      }
    }
  });

  it('makes each level a superset of the level below', () => {
    for (const i of all) {
      for (let n = 1; n < LEVELS.length; n++) {
        const lower = rangeFor(i, LEVELS[n - 1] as Level);
        const upper = rangeFor(i, LEVELS[n] as Level);
        expect(midi(upper[0]), `${i.id} ${LEVELS[n]} low must reach ${LEVELS[n - 1]}`).toBeLessThanOrEqual(midi(lower[0]));
        expect(midi(upper[1]), `${i.id} ${LEVELS[n]} high must reach ${LEVELS[n - 1]}`).toBeGreaterThanOrEqual(midi(lower[1]));
      }
    }
  });

  it('keeps elementary noticeably narrower than adult for every pitched instrument', () => {
    for (const i of all) {
      if (i.unpitched) continue;
      const e = rangeFor(i, 'elementary');
      const a = rangeFor(i, 'adult');
      const eSpan = midi(e[1]) - midi(e[0]);
      const aSpan = midi(a[1]) - midi(a[0]);
      expect(aSpan - eSpan, `${i.id}: adult span ${aSpan} vs elementary ${eSpan}`).toBeGreaterThanOrEqual(7);
    }
  });

  it('keeps every range musically plausible (within A0..C8, at least an octave at elementary)', () => {
    for (const i of all) {
      if (i.unpitched) continue;
      for (const level of LEVELS) {
        const [lo, hi] = rangeFor(i, level);
        expect(midi(lo), `${i.id}/${level}`).toBeGreaterThanOrEqual(midi('A0'));
        expect(midi(hi), `${i.id}/${level}`).toBeLessThanOrEqual(midi('C8'));
      }
      expect(midi(rangeFor(i, 'elementary')[1]) - midi(rangeFor(i, 'elementary')[0]), `${i.id} elementary`).toBeGreaterThanOrEqual(12);
    }
  });

  it('marks the snare unpitched and gives it a range that never rejects a drum note', () => {
    const snare = INSTRUMENTS['snare'];
    expect(snare.unpitched).toBe(true);
    expect(snare.clef).toBe('percussion');
    for (const level of LEVELS) {
      const [lo, hi] = rangeFor(snare, level);
      expect(midi(lo)).toBeLessThanOrEqual(midi('C2'));
      expect(midi(hi)).toBeGreaterThanOrEqual(midi('C6'));
    }
  });
});

describe('transpositions', () => {
  const expected: Record<string, number> = {
    flute: 0, piccolo: -12, oboe: 0, clarinet: 2, 'bass-clarinet': 14,
    'alto-sax': 9, 'tenor-sax': 14, 'bari-sax': 21, bassoon: 0,
    trumpet: 2, horn: 7, trombone: 0, euphonium: 0, tuba: 0, snare: 0,
    violin: 0, viola: 0, cello: 0,
    soprano: 0, alto: 0, tenor: 12, 'bass-voice': 0, piano: 0,
  };

  it('matches the known transposition of every instrument', () => {
    for (const [id, semis] of Object.entries(expected)) {
      expect(INSTRUMENTS[id].transposition, id).toBe(semis);
    }
  });

  it('writes sounding pitches onto sane written staves', () => {
    // Bb clarinet: sounding D3 is written E3. Piccolo: sounding C6 is written C5.
    expect(transposePitch('D3', INSTRUMENTS['clarinet'].transposition)).toBe('E3');
    expect(transposePitch('C6', INSTRUMENTS['piccolo'].transposition)).toBe('C5');
    // Eb alto sax low Db3 is written Bb3; Eb bari sax low C2 is written A3.
    expect(transposePitch('Db3', INSTRUMENTS['alto-sax'].transposition, -2)).toBe('Bb3');
    expect(transposePitch('C2', INSTRUMENTS['bari-sax'].transposition, -2)).toBe('A3');
    // Bb bass clarinet sounding D2 is written E3, a major ninth higher.
    expect(transposePitch('D2', INSTRUMENTS['bass-clarinet'].transposition)).toBe('E3');
    // Tenor voice reads treble-8: sounding C3 is written C4.
    expect(transposePitch('C3', INSTRUMENTS['tenor'].transposition)).toBe('C4');
  });

  it('derives the right written key signature', () => {
    expect(writtenKey('C', INSTRUMENTS['clarinet'].transposition)).toBe('D');
    expect(writtenKey('Bb', INSTRUMENTS['alto-sax'].transposition)).toBe('G');
    expect(writtenKey('Bb', INSTRUMENTS['trumpet'].transposition)).toBe('C');
    expect(writtenKey('Eb', INSTRUMENTS['horn'].transposition)).toBe('Bb');
    expect(writtenKey('F', INSTRUMENTS['flute'].transposition)).toBe('F');
    expect(writtenKey('Bb', INSTRUMENTS['tenor-sax'].transposition)).toBe('C');
  });
});

describe('findInstrument', () => {
  it('resolves the names a person or agent actually types', () => {
    expect(findInstrument('trumpet')?.id).toBe('trumpet');
    expect(findInstrument('Bb Clarinet')?.id).toBe('clarinet');
    expect(findInstrument('alto sax')?.id).toBe('alto-sax');
    expect(findInstrument('french horn')?.id).toBe('horn');
    expect(findInstrument('drums')?.id).toBe('snare');
  });

  it('handles spellings, punctuation, plurals and part numbers', () => {
    expect(findInstrument('  TRUMPET 2 ')?.id).toBe('trumpet');
    expect(findInstrument('Clarinet in Bb')?.id).toBe('clarinet');
    expect(findInstrument('B♭ Clarinet')?.id).toBe('clarinet');
    expect(findInstrument('B flat clarinet')?.id).toBe('clarinet');
    expect(findInstrument('Bass Clarinet')?.id).toBe('bass-clarinet');
    expect(findInstrument('flutes')?.id).toBe('flute');
    expect(findInstrument('Fl.')?.id).toBe('flute');
    expect(findInstrument('snare drum')?.id).toBe('snare');
    expect(findInstrument('Baritone Saxophone')?.id).toBe('bari-sax');
    expect(findInstrument('baritone')?.id).toBe('euphonium');
    expect(findInstrument('Tenor Sax')?.id).toBe('tenor-sax');
    expect(findInstrument('tenor')?.id).toBe('tenor');
    expect(findInstrument('alto')?.id).toBe('alto');
    expect(findInstrument('bass')?.id).toBe('bass-voice');
    expect(findInstrument('cello')?.id).toBe('cello');
    expect(findInstrument('the clarinet part')?.id).toBe('clarinet');
  });

  it('round-trips every id, name and alias back to its own instrument', () => {
    for (const i of all) {
      expect(findInstrument(i.id)?.id, i.id).toBe(i.id);
      expect(findInstrument(i.name)?.id, i.name).toBe(i.id);
      for (const a of i.aliases ?? []) expect(findInstrument(a)?.id, `alias "${a}" of ${i.id}`).toBe(i.id);
    }
  });

  it('returns null for nonsense and empty input', () => {
    expect(findInstrument('zxqwv')).toBeNull();
    expect(findInstrument('')).toBeNull();
    expect(findInstrument('   ')).toBeNull();
  });
});

describe('scoreOrder', () => {
  const order = (id: string) => scoreOrder(INSTRUMENTS[id]);

  it('sorts sections top-down and instruments within a section', () => {
    expect(order('piccolo')).toBeLessThan(order('flute'));
    expect(order('flute')).toBeLessThan(order('oboe'));
    expect(order('oboe')).toBeLessThan(order('clarinet'));
    expect(order('clarinet')).toBeLessThan(order('bass-clarinet'));
    expect(order('bass-clarinet')).toBeLessThan(order('alto-sax'));
    expect(order('alto-sax')).toBeLessThan(order('tenor-sax'));
    expect(order('tenor-sax')).toBeLessThan(order('bari-sax'));
    expect(order('bari-sax')).toBeLessThan(order('trumpet'));
    expect(order('trumpet')).toBeLessThan(order('horn'));
    expect(order('horn')).toBeLessThan(order('trombone'));
    expect(order('trombone')).toBeLessThan(order('euphonium'));
    expect(order('euphonium')).toBeLessThan(order('tuba'));
    expect(order('tuba')).toBeLessThan(order('snare'));
    expect(order('snare')).toBeLessThan(order('violin'));
    expect(order('violin')).toBeLessThan(order('viola'));
    expect(order('viola')).toBeLessThan(order('cello'));
    expect(order('cello')).toBeLessThan(order('soprano'));
    expect(order('soprano')).toBeLessThan(order('alto'));
    expect(order('alto')).toBeLessThan(order('tenor'));
    expect(order('tenor')).toBeLessThan(order('bass-voice'));
    expect(order('bass-voice')).toBeLessThan(order('piano'));
  });

  it('is unique per instrument so a sort is stable and total', () => {
    const seen = new Set(all.map((i) => scoreOrder(i)));
    expect(seen.size).toBe(all.length);
  });
});
