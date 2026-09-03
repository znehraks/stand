// CONTRACT — implemented by the instrument-table agent.
// Sounding ranges per level; `transposition` = semitones to ADD to a sounding pitch to get the written pitch.
import type { Instrument, Level } from './types';

// ---------------------------------------------------------------------------
// RANGE SOURCES
//
// Every range below is a *comfortable sounding* range, not an absolute limit — the point is that a
// write outside it should be questioned, not that the note is unplayable.
//
//   elementary — first-year band/orchestra/choir tessitura as taught in the standard beginning
//                methods: Essential Elements 2000 Book 1 (Hal Leonard), Standard of Excellence
//                Book 1 (Neil A. Kjos), Sound Innovations Book 1 (Alfred), and for strings the
//                Essential Elements for Strings Book 1 first-position note charts. Roughly the
//                notes a student owns after one year, no altissimo, no extreme low register.
//   middle     — Book 2 / second- and third-year extensions of the same methods (clarinet over the
//                break to written D6, sax to written A5, brass a fifth wider at both ends,
//                strings the full first position).
//   high       — typical U.S. all-state audition and grade 3–4 concert-band writing ranges;
//                strings through third/fifth position.
//   adult      — professional practical ranges as tabulated in Samuel Adler, *The Study of
//                Orchestration*, and Alfred Blatter, *Instrumentation and Orchestration*
//                (excluding altissimo/pedal extremes that only specialists write).
//
// Each level is a strict superset of the level below it. Elementary is materially narrower than
// adult for every pitched instrument. Unpitched percussion carries a deliberately permissive range
// and `unpitched: true`; it is written on a single line and must never be range-checked.
// ---------------------------------------------------------------------------

/** 'C4..C6' -> ['C4', 'C6'] */
function span(s: string): [string, string] {
  const i = s.indexOf('..');
  return [s.slice(0, i), s.slice(i + 2)];
}

/** Four level spans, low..high, in the order elementary / middle / high / adult. */
function R(elementary: string, middle: string, high: string, adult: string): Record<Level, [string, string]> {
  return { elementary: span(elementary), middle: span(middle), high: span(high), adult: span(adult) };
}

export const INSTRUMENTS: Record<string, Instrument> = {
  // ---------------- woodwinds ----------------
  flute: {
    id: 'flute',
    name: 'Flute',
    short: 'Fl.',
    clef: 'treble',
    section: 'woodwind',
    transposition: 0,
    orderHint: 12,
    aliases: ['fl', 'fl.', 'flutes', 'concert flute', 'c flute', 'flute 1', 'flute 2'],
    // Beginners live in the first two octaves; the third octave is a middle-school skill.
    range: R('C4..C6', 'C4..G6', 'C4..A6', 'B3..C7'),
  },
  piccolo: {
    id: 'piccolo',
    name: 'Piccolo',
    short: 'Picc.',
    clef: 'treble',
    section: 'woodwind',
    transposition: -12, // sounds an octave above the written pitch
    orderHint: 10,
    aliases: ['picc', 'picc.', 'piccolo flute', 'ottavino'],
    range: R('D5..D7', 'D5..G7', 'D5..A7', 'D5..C8'),
  },
  oboe: {
    id: 'oboe',
    name: 'Oboe',
    short: 'Ob.',
    clef: 'treble',
    section: 'woodwind',
    transposition: 0,
    orderHint: 20,
    aliases: ['ob', 'ob.', 'oboes', 'hautbois'],
    range: R('C4..F5', 'Bb3..A5', 'Bb3..D6', 'Bb3..G6'),
  },
  bassoon: {
    id: 'bassoon',
    name: 'Bassoon',
    short: 'Bsn.',
    clef: 'bass',
    section: 'woodwind',
    transposition: 0,
    orderHint: 25,
    aliases: ['bsn', 'bsn.', 'bassoons', 'fagott', 'fagotto'],
    range: R('F2..C4', 'Bb1..G4', 'Bb1..C5', 'Bb1..Eb5'),
  },
  clarinet: {
    id: 'clarinet',
    name: 'Clarinet',
    short: 'Cl.',
    clef: 'treble',
    section: 'woodwind',
    transposition: 2, // Bb: written = sounding + 2
    orderHint: 30,
    aliases: [
      'bb clarinet',
      'b flat clarinet',
      'clarinet in bb',
      'soprano clarinet',
      'cl',
      'cl.',
      'clarinets',
      'clarinet 1',
      'clarinet 2',
      'klarinette',
    ],
    // elementary = written E3..G5 (just over the break); adult = written E3..C7.
    range: R('D3..F5', 'D3..C6', 'D3..G6', 'D3..Bb6'),
  },
  'bass-clarinet': {
    id: 'bass-clarinet',
    name: 'Bass Clarinet',
    short: 'B. Cl.',
    clef: 'treble', // written in treble clef, sounding a major ninth lower
    section: 'woodwind',
    transposition: 14, // Bb bass: written = sounding + 14
    orderHint: 34,
    aliases: ['bass clarinet', 'bass cl', 'bass cl.', 'bcl', 'b. cl.', 'bass clarinet in bb', 'clarinet bass', 'bassklarinette'],
    // elementary = written E3..C5; adult assumes a low-C instrument (written C3..G6).
    range: R('D2..Bb3', 'D2..F4', 'Db2..C5', 'Bb1..F5'),
  },
  'alto-sax': {
    id: 'alto-sax',
    name: 'Alto Saxophone',
    short: 'A. Sax',
    clef: 'treble',
    section: 'woodwind',
    transposition: 9, // Eb: written = sounding + 9
    orderHint: 40,
    aliases: ['alto sax', 'alto saxophone', 'eb alto sax', 'e flat alto sax', 'alto saxaphone', 'asax', 'sax', 'saxophone'],
    // elementary = written C4..F5; adult = written Bb3..F6 (no altissimo).
    range: R('Eb3..Ab4', 'Db3..C5', 'Db3..F5', 'Db3..Ab5'),
  },
  'tenor-sax': {
    id: 'tenor-sax',
    name: 'Tenor Saxophone',
    short: 'T. Sax',
    clef: 'treble',
    section: 'woodwind',
    transposition: 14, // Bb: written = sounding + 14
    orderHint: 44,
    aliases: ['tenor sax', 'tenor saxophone', 'bb tenor sax', 'b flat tenor sax', 'tenor saxaphone', 'tsax'],
    range: R('Bb2..Eb4', 'Ab2..G4', 'Ab2..C5', 'Ab2..Eb5'),
  },
  'bari-sax': {
    id: 'bari-sax',
    name: 'Baritone Saxophone',
    short: 'Bari Sax',
    clef: 'treble',
    section: 'woodwind',
    transposition: 21, // Eb: written = sounding + 21
    orderHint: 48,
    aliases: ['bari sax', 'baritone sax', 'baritone saxophone', 'bary sax', 'eb baritone sax', 'bari', 'bsax'],
    // adult assumes a low-A horn (written A3 sounds C2).
    range: R('Eb2..Ab3', 'Db2..C4', 'Db2..F4', 'C2..Ab4'),
  },

  // ---------------- brass ----------------
  trumpet: {
    id: 'trumpet',
    name: 'Trumpet',
    short: 'Tpt.',
    clef: 'treble',
    section: 'brass',
    transposition: 2, // Bb: written = sounding + 2
    orderHint: 10,
    aliases: ['bb trumpet', 'b flat trumpet', 'trumpet in bb', 'tpt', 'tpt.', 'trumpets', 'cornet', 'flugelhorn', 'trumpet 1', 'trumpet 2'],
    range: R('F#3..C5', 'E3..F5', 'E3..Bb5', 'E3..E6'),
  },
  horn: {
    id: 'horn',
    name: 'Horn in F',
    short: 'Hn.',
    clef: 'treble',
    section: 'brass',
    transposition: 7, // F: written = sounding + 7
    orderHint: 20,
    aliases: ['french horn', 'f horn', 'horn in f', 'hn', 'hn.', 'french horns', 'horns', 'waldhorn'],
    // elementary = written G3..D5; adult = written F#2..G6.
    range: R('C3..G4', 'G2..C5', 'F2..F5', 'B1..C6'),
  },
  trombone: {
    id: 'trombone',
    name: 'Trombone',
    short: 'Tbn.',
    clef: 'bass',
    section: 'brass',
    transposition: 0,
    orderHint: 30,
    aliases: ['tbn', 'tbn.', 'trombones', 'tenor trombone', 'slide trombone', 'bone', 'posaune', 'trombone 1', 'trombone 2'],
    range: R('F2..C4', 'E2..F4', 'E2..Bb4', 'E2..D5'),
  },
  euphonium: {
    id: 'euphonium',
    name: 'Euphonium',
    short: 'Euph.',
    clef: 'bass',
    section: 'brass',
    transposition: 0, // notated in concert-pitch bass clef in this app
    orderHint: 40,
    aliases: ['euph', 'euph.', 'baritone', 'baritone horn', 'euphoniums', 'bari horn', 'tenor tuba'],
    // adult assumes a four-valve compensating instrument.
    range: R('F2..C4', 'E2..F4', 'E2..Bb4', 'Bb1..C5'),
  },
  tuba: {
    id: 'tuba',
    name: 'Tuba',
    short: 'Tuba',
    clef: 'bass',
    section: 'brass',
    transposition: 0,
    orderHint: 50,
    aliases: ['tba', 'bass tuba', 'contrabass tuba', 'sousaphone', 'bbb tuba', 'tubas'],
    range: R('Bb1..F3', 'F1..Bb3', 'E1..D4', 'D1..F4'),
  },

  // ---------------- percussion ----------------
  snare: {
    id: 'snare',
    name: 'Snare Drum',
    short: 'S.D.',
    clef: 'percussion',
    section: 'percussion',
    transposition: 0,
    orderHint: 10,
    unpitched: true,
    aliases: ['snare drum', 'snare drums', 'drums', 'drum', 'drum set', 'drumset', 'sd', 's.d.', 'percussion', 'battery', 'caisse claire'],
    // Unpitched: written on a single line and never range-checked. The span below is deliberately
    // permissive so that any pitch a writer happens to park the drum on validates.
    range: R('C1..C8', 'C1..C8', 'C1..C8', 'C1..C8'),
  },

  // ---------------- strings ----------------
  violin: {
    id: 'violin',
    name: 'Violin',
    short: 'Vln.',
    clef: 'treble',
    section: 'string',
    transposition: 0,
    orderHint: 10,
    aliases: ['vln', 'vln.', 'vn', 'fiddle', 'violins', 'violin 1', 'violin 2', 'violino', 'geige'],
    // middle = the complete first position; high adds third and fifth position.
    range: R('G3..D5', 'G3..B5', 'G3..E6', 'G3..E7'),
  },
  viola: {
    id: 'viola',
    name: 'Viola',
    short: 'Vla.',
    clef: 'alto',
    section: 'string',
    transposition: 0,
    orderHint: 20,
    aliases: ['vla', 'vla.', 'violas', 'bratsche', 'alto violin'],
    range: R('C3..G4', 'C3..E5', 'C3..A5', 'C3..E6'),
  },
  cello: {
    id: 'cello',
    name: 'Cello',
    short: 'Vc.',
    clef: 'bass',
    section: 'string',
    transposition: 0,
    orderHint: 30,
    aliases: ['vc', 'vc.', 'violoncello', 'cellos', 'violoncelli'],
    range: R('C2..D4', 'C2..G4', 'C2..C5', 'C2..A5'),
  },

  // ---------------- voices ----------------
  soprano: {
    id: 'soprano',
    name: 'Soprano',
    short: 'S',
    clef: 'treble',
    section: 'voice',
    transposition: 0,
    orderHint: 10,
    aliases: ['soprano voice', 'sopranos', 'sop', 'descant', 'treble voice', 'sopran'],
    // elementary/middle are unchanged children's voices; adult is the trained soprano tessitura.
    range: R('C4..D5', 'B3..F5', 'A3..A5', 'A3..C6'),
  },
  alto: {
    id: 'alto',
    name: 'Alto',
    short: 'A',
    clef: 'treble',
    section: 'voice',
    transposition: 0,
    orderHint: 20,
    aliases: ['alto voice', 'altos', 'contralto', 'mezzo', 'mezzo-soprano', 'mezzo soprano'],
    range: R('C4..C5', 'A3..D5', 'G3..E5', 'F3..F5'),
  },
  tenor: {
    id: 'tenor',
    name: 'Tenor',
    short: 'T',
    clef: 'treble', // treble-8: written in treble clef, sounding an octave lower
    section: 'voice',
    transposition: 12, // written = sounding + 12
    orderHint: 30,
    aliases: ['tenor voice', 'tenors', 'tenore', 'changed voice'],
    range: R('C3..D4', 'B2..G4', 'A2..A4', 'A2..C5'),
  },
  'bass-voice': {
    id: 'bass-voice',
    name: 'Bass',
    short: 'B',
    clef: 'bass',
    section: 'voice',
    transposition: 0,
    orderHint: 40,
    aliases: ['bass voice', 'bass', 'basses', 'bass singer', 'bass-baritone', 'baritone voice'],
    range: R('G2..C4', 'F2..D4', 'E2..E4', 'D2..F4'),
  },

  // ---------------- keyboard ----------------
  piano: {
    id: 'piano',
    name: 'Piano',
    short: 'Pno.',
    clef: 'treble',
    section: 'keyboard',
    transposition: 0,
    orderHint: 10,
    aliases: ['pno', 'pno.', 'pf', 'keyboard', 'keys', 'piano accompaniment', 'klavier'],
    range: R('C3..C6', 'F2..C7', 'C2..C8', 'A0..C8'),
  },
};

export const SECTION_ORDER: string[] = ['woodwind', 'brass', 'percussion', 'string', 'voice', 'keyboard'];

/** Lowercase, de-punctuate, unify flats/sharps and hyphens so 'B♭ Cl.' and 'bb clarinet' agree. */
function norm(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .replace(/[.,;:_/\\()[\]"']+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b([a-g]) (flat|sharp)\b/g, (_m, l: string, k: string) => l + (k === 'flat' ? 'b' : '#'))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Progressively looser spellings of a query: as typed, without a part number, singularised. */
function queryForms(raw: string): string[] {
  const forms: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !forms.includes(t)) forms.push(t);
  };
  const base = norm(raw);
  push(base);
  push(base.replace(/\s+(?:\d+|i{1,3}|iv|v)$/, '')); // 'trumpet 2', 'horn iii'
  const last = forms[forms.length - 1];
  if (/s$/.test(last) && !/ss$/.test(last)) push(last.replace(/s$/, ''));
  return forms;
}

function nameOf(i: Instrument): string {
  return norm(i.name);
}

function aliasesOf(i: Instrument): string[] {
  return (i.aliases ?? []).map(norm);
}

/** Resolve an id, name or alias ('trumpet', 'Bb Clarinet', 'alto sax') to an instrument. */
export function findInstrument(nameOrId: string): Instrument | null {
  const raw = String(nameOrId ?? '').toLowerCase().trim();
  if (!raw) return null;
  if (INSTRUMENTS[raw]) return INSTRUMENTS[raw];

  const list = Object.values(INSTRUMENTS);
  const forms = queryForms(raw);

  // 1. exact: id, then name, then alias.
  for (const q of forms) {
    const byId = INSTRUMENTS[q.replace(/ /g, '-')] ?? INSTRUMENTS[q];
    if (byId) return byId;
    const exact = list.find((i) => nameOf(i) === q || aliasesOf(i).includes(q));
    if (exact) return exact;
  }
  // 2. prefix: 'clar', 'trump', 'euph'.
  for (const q of forms) {
    if (q.length < 3) continue;
    const pre = list.find((i) => nameOf(i).startsWith(q) || i.id.startsWith(q.replace(/ /g, '-')) || aliasesOf(i).some((a) => a.startsWith(q)));
    if (pre) return pre;
  }
  // 3. substring either way: 'the clarinet part', 'saxophone (alto)'.
  for (const q of forms) {
    if (q.length < 3) continue;
    const sub = list.find((i) => nameOf(i).includes(q) || i.id.includes(q.replace(/ /g, '-')) || aliasesOf(i).some((a) => a.includes(q)));
    if (sub) return sub;
  }
  const base = norm(raw);
  for (const i of list) {
    const terms = [nameOf(i), ...aliasesOf(i)].filter((t) => t.length >= 4);
    if (terms.some((t) => base.includes(t))) return i;
  }
  return null;
}

export function instrumentIds(): string[] {
  return Object.keys(INSTRUMENTS);
}

/** Score order index (flutes above clarinets above brass above percussion, strings, voices). */
export function scoreOrder(instrument: Instrument): number {
  const s = SECTION_ORDER.indexOf(instrument.section);
  return (s < 0 ? 9 : s) * 100 + (instrument.orderHint ?? 50);
}

/** Sounding range for a level, inclusive. */
export function rangeFor(instrument: Instrument, level: Level): [string, string] {
  return instrument.range[level];
}
