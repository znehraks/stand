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
    'Tune NEW BRITAIN, anonymous early-American melody first printed in William Walker’s ' +
    '“Southern Harmony” (1835); words by John Newton (1779). Anonymous tune published ~190 years ago — public domain.',
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
    '본조 아리랑 (Standard / Gyeonggi Arirang) — Korean folk song, traditional, no known author; ' +
    'transcribed in print by the early 1900s. Anonymous folk tradition, public domain ' +
    '(UNESCO Intangible Cultural Heritage of Humanity, 2012).',
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
  chords: [
    'Em', 'Em', 'D', 'C', 'B', 'Em', 'D', 'B7', 'Em',
    'G', 'F#m', 'Em', 'B', 'G', 'D', 'B7', 'Em',
  ],
  source:
    'English traditional, “A New Northern Dittye of the Lady Greene Sleeves”, entered at the ' +
    'Stationers’ Company in 1580 and printed in Playford’s “The Dancing Master” (1686). ' +
    'Anonymous 16th-century tune — public domain.',
};

// ---------------------------------------------------------------------------
// 5. Simple Gifts — Joseph Brackett Jr., 1848
// From the Mary Hazzard manuscript reading in C, transposed down a fourth to G
// so the whole tune sits in D4–D5. Two-beat pickup is written as rests in bar 1.
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
// Four two-bar phrases, each stated twice; a canon over a static tonic, which is
// why every bar carries the same chord.
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
    'French traditional round, anonymous; earliest known source the manuscript of Jean-Philippe ' +
    'Rameau’s circle (c. 1780) and printed in Paris by 1811. Anonymous folk round — public domain.',
};

export const PRESETS: Preset[] = [
  ODE_TO_JOY,
  AMAZING_GRACE,
  ARIRANG,
  GREENSLEEVES,
  SIMPLE_GIFTS,
  FRERE_JACQUES,
];
