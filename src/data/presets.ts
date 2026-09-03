// CONTRACT — implemented by the preset agent. Public-domain melodies only, with the source named.
import type { Dur, Measure, Note, TimeSig } from '../core/types';

export interface Preset {
  id: string;
  title: string;
  key: string;
  time: TimeSig;
  tempo: number;
  /** Sounding pitches. Every bar must total exactly one bar of `time`. */
  melody: Measure[];
  chords?: string[];
  /** Where it comes from and why it is public domain. */
  source: string;
}

// ---------------------------------------------------------------------------
// Compact bar notation
//
// Each measure is written as "pitch/dur pitch/dur …", e.g. "E4/q E4/q F4/q G4/q".
// 'r' is a rest ("r/h"). A trailing '~' ties the note into the next one ("E4/q~").
// Durations are the Dur codes from core/types: w hd h qd q 8d 8 16.
// A pickup is written as leading rests inside bar 1 so that every bar is complete.
// ---------------------------------------------------------------------------

const DUR_CODES: Record<string, Dur> = {
  w: 'w', hd: 'hd', h: 'h', qd: 'qd', q: 'q', '8d': '8d', '8': '8', '16': '16',
};

function toDur(code: string): Dur {
  const d = DUR_CODES[code];
  if (!d) throw new Error(`presets: unknown duration code “${code}”`);
  return d;
}

function bar(spec: string): Measure {
  const notes: Note[] = spec.trim().split(/\s+/).map((token) => {
    const tie = token.endsWith('~');
    const body = tie ? token.slice(0, -1) : token;
    const cut = body.lastIndexOf('/');
    if (cut < 1) throw new Error(`presets: bad note token “${token}”`);
    const note: Note = { pitch: body.slice(0, cut), dur: toDur(body.slice(cut + 1)) };
    if (tie) note.tie = true;
    return note;
  });
  return { notes };
}

// ---------------------------------------------------------------------------
// 1. Ode to Joy — Beethoven, Symphony No. 9 (1824)
// Melody after the "Anthem of Europe" reading of the theme, transposed G → C.
// Bar 12 keeps Beethoven's dip to the low dominant (G3) and the tie back into bar 13.
// ---------------------------------------------------------------------------
const ODE_TO_JOY: Preset = {
  id: 'ode-to-joy',
  title: 'Ode to Joy',
  key: 'C',
  time: '4/4',
  tempo: 120,
  melody: [
    bar('E4/q E4/q F4/q G4/q'),
    bar('G4/q F4/q E4/q D4/q'),
    bar('C4/q C4/q D4/q E4/q'),
    bar('E4/qd D4/8 D4/h'),
    bar('E4/q E4/q F4/q G4/q'),
    bar('G4/q F4/q E4/q D4/q'),
    bar('C4/q C4/q D4/q E4/q'),
    bar('D4/qd C4/8 C4/h'),
    bar('D4/q D4/q E4/q C4/q'),
    bar('D4/q E4/8 F4/8 E4/q C4/q'),
    bar('D4/q E4/8 F4/8 E4/q D4/q'),
    bar('C4/q D4/q G3/q E4/q~'),
    bar('E4/q E4/q F4/q G4/q'),
    bar('G4/q F4/q E4/q D4/q'),
    bar('C4/q C4/q D4/q E4/q'),
    bar('D4/qd C4/8 C4/h'),
  ],
  chords: ['C', 'G', 'C', 'G', 'C', 'G', 'C', 'C', 'G', 'C', 'G', 'C', 'C', 'G', 'C', 'C'],
  source:
    'Ludwig van Beethoven, “An die Freude” theme from Symphony No. 9 in D minor, Op. 125 (1824). ' +
    'Composed 1824, first published 1826, composer died 1827 — copyright expired everywhere; public domain.',
};

// ---------------------------------------------------------------------------
// 2. Amazing Grace — hymn tune NEW BRITAIN
// Follows the standard hymnal setting in G: pickup on the low D, phrase 2 rising
// to the upper D, phrase 3 the ornamented descent, phrase 4 back to the tonic.
// ---------------------------------------------------------------------------
const AMAZING_GRACE: Preset = {
  id: 'amazing-grace',
  title: 'Amazing Grace',
  key: 'G',
  time: '3/4',
  tempo: 84,
  melody: [
    bar('r/h D4/q'),
    bar('G4/h B4/8 G4/8'),
    bar('B4/h A4/q'),
    bar('G4/h E4/q'),
    bar('D4/h D4/q'),
    bar('G4/h B4/8 G4/8'),
    bar('B4/h A4/q'),
    bar('D5/hd~'),
    bar('D5/q r/q B4/q'),
    bar('D5/qd B4/8 D5/8 B4/8'),
    bar('G4/h D4/q'),
    bar('E4/qd G4/8 G4/8 E4/8'),
    bar('D4/h D4/q'),
    bar('G4/h B4/8 G4/8'),
    bar('B4/h A4/q'),
    bar('G4/hd'),
  ],
  chords: ['G', 'G', 'G', 'C', 'G', 'G', 'G', 'D7', 'D7', 'G', 'G', 'C', 'G', 'Em', 'D7', 'G'],
  source:
    'Tune NEW BRITAIN, anonymous early-American melody first printed in Spilman & Shaw’s ' +
    '“Columbian Harmony” (1829); first set to John Newton’s words, and given the name NEW BRITAIN, ' +
    'in William Walker’s “Southern Harmony” (1835). Text from Newton’s “Olney Hymns” (1779). ' +
    'Anonymous tune printed 1829, text published 1779 — copyright long expired; public domain.',
};

// ---------------------------------------------------------------------------
// 3. 아리랑 (Arirang) — Korean folk song, Bonjo / Gyeonggi Arirang
// The standard transcription is 9/8; this is the usual 3/4 reading of it
// (each compound beat becomes one quarter), F major pentatonic C–D–F–G–A.
// ---------------------------------------------------------------------------
const ARIRANG: Preset = {
  id: 'arirang',
  title: '아리랑 (Arirang)',
  key: 'F',
  time: '3/4',
  tempo: 92,
  melody: [
    bar('C4/qd D4/8 C4/q'),
    bar('F4/qd G4/8 F4/q'),
    bar('A4/q G4/8 A4/8 F4/8 D4/8'),
    bar('C4/h D4/8 C4/8'),
    bar('F4/qd G4/8 F4/q'),
    bar('A4/8d G4/16 F4/8d D4/16 C4/8d D4/16'),
    bar('F4/qd G4/8 F4/q'),
    bar('F4/h r/q'),
    bar('C5/h C5/q'),
    bar('C5/q A4/q G4/q'),
    bar('A4/q G4/8 A4/8 F4/8 D4/8'),
    bar('C4/h D4/8 C4/8'),
    bar('F4/qd G4/8 F4/q'),
    bar('A4/8d G4/16 F4/8d D4/16 C4/8d D4/16'),
    bar('F4/qd G4/8 F4/q'),
    bar('F4/h r/q'),
  ],
  chords: ['C', 'F', 'Dm', 'C', 'F', 'F', 'F', 'F', 'F', 'F', 'Dm', 'C', 'F', 'F', 'F', 'F'],
  source:
    '본조 아리랑 (Bonjo / “Standard” Arirang), the Seoul–Gyeonggi version popularised as the theme ' +
    'of the 1926 film 아리랑 — Korean folk song, traditional, no known author. Melody follows the ' +
    'standard 9/8 transcription in F major. Anonymous folk tradition with no identifiable author — ' +
    'public domain; inscribed on the UNESCO Representative List of the Intangible Cultural Heritage ' +
    'of Humanity (Republic of Korea, 2012).',
};

// ---------------------------------------------------------------------------
// 4. Greensleeves — English traditional, 16th century
// A-Dorian original transposed down a fourth to E, so the tune sits in B3–D5.
// Key signature Em; the Dorian C# and the raised leading tone D# are accidentals.
// ---------------------------------------------------------------------------
const GREENSLEEVES: Preset = {
  id: 'greensleeves',
  title: 'Greensleeves',
  key: 'Em',
  time: '6/8',
  tempo: 100,
  melody: [
    bar('r/qd r/q E4/8'),
    bar('G4/q A4/8 B4/8d C#5/16 B4/8'),
    bar('A4/q F#4/8 D4/8d E4/16 F#4/8'),
    bar('G4/q E4/8 E4/8d D#4/16 E4/8'),
    bar('F#4/q D#4/8 B3/q E4/8'),
    bar('G4/q A4/8 B4/8d C#5/16 B4/8'),
    bar('A4/q F#4/8 D4/8d E4/16 F#4/8'),
    bar('G4/8d F#4/16 E4/8 D#4/8d C#4/16 D#4/8'),
    bar('E4/hd'),
    bar('D5/qd D5/8d C#5/16 B4/8'),
    bar('A4/q F#4/8 D4/8d E4/16 F#4/8'),
    bar('G4/q E4/8 E4/8d D#4/16 E4/8'),
    bar('F#4/q D#4/8 B3/qd'),
    bar('D5/qd D5/8d C#5/16 B4/8'),
    bar('A4/q F#4/8 D4/8d E4/16 F#4/8'),
    bar('G4/8d F#4/16 E4/8 D#4/8d C#4/16 D#4/8'),
    bar('E4/hd'),
  ],
  // Bars 3, 7, 11 and 15 are the same phrase (A F# | D E F#) and all take D: it covers the
  // downbeat A and the second beat's D, which is why bar 11 is not the F#m some settings use.
  chords: [
    'Em', 'Em', 'D', 'C', 'B', 'Em', 'D', 'B7', 'Em',
    'G', 'D', 'Em', 'B', 'G', 'D', 'B7', 'Em',
  ],
  source:
    'English traditional. The ballad “A Newe Northen Dittye of ye Ladye Greene Sleves” was ' +
    'registered by Richard Jones at the London Stationers’ Company in September 1580; the tune ' +
    'survives in late-16th/early-17th-century lute sources (William Ballet’s Lute Book, Het ' +
    'Luitboek van Thysius) and appears in Playford’s “The Dancing Master” from the 7th edition ' +
    '(1686) as “Green-Sleeves and Pudding-Pies”. Anonymous 16th-century tune — public domain.',
};

// ---------------------------------------------------------------------------
// 5. Simple Gifts — Joseph Brackett Jr., 1848
// Note for note the Mary Hazzard manuscript reading (which is in C), transposed up a fifth
// to G so the whole tune sits in D4–D5. Two-beat pickup is written as rests in bar 1.
// ---------------------------------------------------------------------------
const SIMPLE_GIFTS: Preset = {
  id: 'simple-gifts',
  title: 'Simple Gifts',
  key: 'G',
  time: '4/4',
  tempo: 116,
  melody: [
    bar('r/h D4/q D4/q'),
    bar('G4/q G4/8 A4/8 B4/8 G4/8 B4/8 C5/8'),
    bar('D5/q D5/8 D5/8 B4/q A4/8 G4/8'),
    bar('A4/q A4/q A4/q A4/q'),
    bar('A4/8 B4/8 A4/8 F#4/8 D4/q D4/q'),
    bar('G4/8 F#4/8 G4/8 A4/8 B4/q A4/8 A4/8'),
    bar('B4/q C5/q D5/qd D5/8'),
    bar('A4/q A4/8 B4/8 A4/q G4/8 G4/8'),
    bar('A4/q G4/8 F#4/8 G4/h'),
  ],
  chords: ['G', 'G', 'G', 'D', 'D', 'G', 'G', 'D', 'G'],
  source:
    'Joseph Brackett Jr. (1797–1882), Shaker dancing song written at Alfred, Maine, 1848; ' +
    'melody as in the Mary Hazzard manuscript, New Lebanon. Author died 1882 — public domain.',
};

// ---------------------------------------------------------------------------
// 6. Frère Jacques — French traditional round
// Four two-bar phrases, each stated twice. As a round all four phrases sound together, so
// every bar repeats the same harmony (F, with a passing C7 mid-bar) — hence one chord, F,
// on every bar.
// ---------------------------------------------------------------------------
const FRERE_JACQUES: Preset = {
  id: 'frere-jacques',
  title: 'Frère Jacques',
  key: 'F',
  time: '4/4',
  tempo: 108,
  melody: [
    bar('F4/q G4/q A4/q F4/q'),
    bar('F4/q G4/q A4/q F4/q'),
    bar('A4/q Bb4/q C5/h'),
    bar('A4/q Bb4/q C5/h'),
    bar('C5/8 D5/8 C5/8 Bb4/8 A4/q F4/q'),
    bar('C5/8 D5/8 C5/8 Bb4/8 A4/q F4/q'),
    bar('F4/q C4/q F4/h'),
    bar('F4/q C4/q F4/h'),
  ],
  chords: ['F', 'F', 'F', 'F', 'F', 'F', 'F', 'F'],
  source:
    'French traditional round, anonymous. The earliest known version of the melody is a c. 1780 ' +
    'French manuscript in the Bibliothèque nationale de France, where it appears as “Frère Blaise”; ' +
    'first printed in Paris in 1811 in “La Clé du Caveau à l’usage de tous les Chansonniers ' +
    'français”. A BnF manuscript of 86 canons credits Jean-Philippe Rameau (1683–1764), an ' +
    'attribution argued by musicologist Sylvie Bouissou. Anonymous 18th-century round — or Rameau, ' +
    'dead since 1764 — either way public domain.',
};

export const PRESETS: Preset[] = [
  ODE_TO_JOY,
  AMAZING_GRACE,
  ARIRANG,
  GREENSLEEVES,
  SIMPLE_GIFTS,
  FRERE_JACQUES,
];
