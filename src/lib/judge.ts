// Judge mode — a scripted demo that drives the very same registered tools an agent would.
// There is no LLM here: every step is a real `registry.run(name, input, 'demo')` against the
// live tool surface, so what a judge watches is exactly what an agent's call would do —
// including the write the page refuses. Captions narrate; the abort signal ends it instantly.

import type { ToolRegistry } from './webmcp';
import { store } from '../store';
import { DUR_TICKS, TIME_TICKS, type Dur, type Measure, type TimeSig } from '../core/types';
import { isRest, midiToPitch, pitchToMidi, transposePitch } from '../core/pitch';

export interface JudgeHooks {
  say: (caption: string | null) => void;
  done: () => void;
}

export interface JudgeRunner {
  stop: () => void;
}

type Rec = Record<string, unknown>;

/** Thrown by `guard` so `stop()` unwinds the script wherever it happens to be. */
class Aborted extends Error {}

/** The out-of-range note the demo writes on purpose, so the page can refuse it on camera. */
const TOO_HIGH = 'D6';

function guard(signal: AbortSignal): void {
  if (signal.aborted) throw new Aborted('judge stopped');
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });
}

function durFor(ticks: number): Dur | null {
  for (const [d, t] of Object.entries(DUR_TICKS) as [Dur, number][]) if (t === ticks) return d;
  return null;
}

/** One bar filled by `pitches` in equal values; falls back to quarter notes when that is not exact. */
function bar(time: TimeSig, pitches: string[]): Measure {
  const total = TIME_TICKS[time] ?? 1920;
  const each = durFor(total / Math.max(1, pitches.length));
  if (each) return { notes: pitches.map((pitch) => ({ pitch, dur: each })) };
  const beats = Math.max(1, Math.round(total / DUR_TICKS.q));
  return { notes: Array.from({ length: beats }, (_, i) => ({ pitch: pitches[i % pitches.length], dur: 'q' as Dur })) };
}

function asArray(v: unknown): Rec[] {
  return Array.isArray(v) ? (v as Rec[]) : [];
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** get_score reports a part's sounding range at the score level; accept every plausible shape. */
function parseRange(v: unknown): [string, string] | null {
  if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  if (v && typeof v === 'object') {
    const o = v as Rec;
    const lo = str(o.low ?? o.lo ?? o.min ?? o.lowest);
    const hi = str(o.high ?? o.hi ?? o.max ?? o.highest);
    if (lo && hi) return [lo, hi];
  }
  if (typeof v === 'string') {
    const parts = v.split(/\s*(?:–|—|\.\.|to|-)\s*/i).filter(Boolean);
    if (parts.length >= 2 && pitchToMidi(parts[0]) !== null && pitchToMidi(parts[1]) !== null) return [parts[0], parts[1]];
  }
  return null;
}

function isPercussion(part: Rec): boolean {
  return /perc|snare|drum|cymb|timp|kit/i.test(`${str(part.instrument)} ${str(part.label)} ${str(part.id)}`);
}

/** Sounding pitches of a part, in order, rests dropped. */
function pitchesOf(readPartResult: Rec): string[] {
  const out: string[] = [];
  for (const b of asArray(readPartResult.bars)) {
    for (const n of asArray(b.notes)) {
      const p = str(n.pitch);
      if (p && !isRest(p)) out.push(p);
    }
  }
  return out;
}

/** Bars of a part as write_part input: sounding pitch + duration only. */
function barsOf(readPartResult: Rec): { notes: { pitch: string; dur: Dur }[] }[] {
  return asArray(readPartResult.bars).map((b) => ({
    notes: asArray(b.notes).map((n) => ({ pitch: str(n.pitch, 'r'), dur: (str(n.dur, 'q') as Dur) })),
  }));
}

export function runJudge(registry: ToolRegistry, hooks: JudgeHooks): JudgeRunner {
  const controller = new AbortController();
  void script(registry, hooks, controller.signal)
    .catch((e: unknown) => {
      if (!(e instanceof Aborted)) console.warn('judge mode stopped early:', e);
    })
    .finally(() => {
      // Never leave a question hanging or a caption stuck on screen.
      store.ask?.resolve(null);
      hooks.say(null);
      hooks.done();
    });
  return { stop: () => controller.abort() };
}

async function script(reg: ToolRegistry, hooks: JudgeHooks, signal: AbortSignal): Promise<void> {
  /** Caption, then hold long enough to read it. */
  const say = async (text: string, hold = 1800): Promise<void> => {
    guard(signal);
    hooks.say(text);
    await sleep(hold, signal);
    guard(signal);
  };
  /** Run a real tool, then let the page settle so the change is visible. */
  const call = async (name: string, input: Rec = {}, settle = 800): Promise<Rec> => {
    guard(signal);
    const out = await reg.run(name, input, 'demo');
    await sleep(settle, signal);
    guard(signal);
    return (out && typeof out === 'object' ? (out as Rec) : {}) as Rec;
  };

  // 1 — the brief.
  await say('A melody, an ensemble, and a level — that is the whole brief.');
  let loaded = await call('load_melody', { melody: 'ode-to-joy' });
  if (loaded.ok === false) {
    const first = str(asArray((await call('list_melodies')).melodies)[0]?.id);
    if (first) loaded = await call('load_melody', { melody: first });
  }
  await say(`Loaded “${str(loaded.title, 'the melody')}” — ${num(loaded.bars, 8)} bars of public-domain tune, in ${str(loaded.key, 'C')}.`, 1600);

  // 2 — the room we actually have.
  await say('Two flutes, clarinet, alto sax, trumpet, trombone, snare. Elementary level.');
  await call('set_ensemble', {
    instruments: [
      { instrument: 'flute', count: 2 },
      { instrument: 'clarinet' },
      { instrument: 'alto sax' },
      { instrument: 'trumpet' },
      { instrument: 'trombone' },
      { instrument: 'snare' },
    ],
    level: 'elementary',
  });

  const score = await call('get_score', {}, 400);
  const rawTime = str(score.time, '4/4');
  const time: TimeSig = (rawTime in TIME_TICKS ? rawTime : '4/4') as TimeSig;
  const parts = asArray(score.parts);
  const pitched = parts.filter((p) => !isPercussion(p));
  const melody = [...pitched].sort((a, b) => num(b.bars_written) - num(a.bars_written))[0] ?? pitched[0];
  const melodyId = str(melody?.id, 'melody');
  const doubler = pitched.find((p) => p.id !== melody?.id && str(p.instrument) === str(melody?.instrument)) ?? melody;
  const trumpet = parts.find((p) => /trumpet/i.test(`${str(p.instrument)} ${str(p.label)}`));
  const trumpetId = str(trumpet?.id, 'trumpet');

  // 3 — the agent writes, and the page checks every bar.
  await say('The agent writes the parts. The page checks every one.');
  const melodyRead = await call('read_part', { part: melodyId }, 300);
  const melodyBars = barsOf(melodyRead);
  if (melodyBars.length && doubler && str(doubler.id) !== melodyId) {
    await call('write_part', { part: str(doubler.id), from_bar: 1, bars: melodyBars });
    await say(`${str(doubler.label, 'Flute 2')} doubles the tune — ${melodyBars.length} bars, sounding pitch in, written pitch out.`, 1600);
  }

  const range = parseRange(trumpet?.range_at_level);
  const midRange = range ? midiToPitch(Math.round(((pitchToMidi(range[0]) ?? 60) + (pitchToMidi(range[1]) ?? 72)) / 2)) : 'G4';
  await say('Now the trumpet — and the agent aims a fourth too high.');
  const rejected = await call('write_part', {
    part: trumpetId,
    from_bar: 1,
    bars: [bar(time, [midRange, midRange, midRange, TOO_HIGH])],
  });
  await say(
    rejected.ok === false
      ? `The page refused: ${TOO_HIGH} is above a beginner trumpet. ${str(rejected.error).slice(0, 160)}`
      : `The page refused: ${TOO_HIGH} is above a beginner trumpet.`,
    2600,
  );

  let fixed = transposePitch(TOO_HIGH, -12);
  const hi = range ? pitchToMidi(range[1]) : null;
  if (hi !== null && (pitchToMidi(fixed) ?? 0) > hi) fixed = midiToPitch(hi);
  await say(`Down an octave, to ${fixed} — and the same phrase fits the horn.`);
  await call('write_part', { part: trumpetId, from_bar: 1, bars: [bar(time, [midRange, midRange, midRange, fixed])] });

  // 4 — the page's own harmony draft.
  // Leave the melody, its doubling and the trumpet the agent just corrected exactly as they are.
  const spoken = new Set([melodyId, str(doubler?.id), trumpetId]);
  const targets = pitched.filter((p) => !spoken.has(str(p.id))).map((p) => str(p.id));
  if (targets.length) {
    await say('Harmony is the page’s job, not a guess: block voicing, inside every player’s range.');
    await call('harmonize', { source_part: melodyId, target_parts: targets, style: 'block' }, 1200);
  }

  // 5 — what is left over.
  await say('And then the page audits the whole score.');
  const checked = await call('check', {}, 400);
  const errs = asArray(checked.errors);
  const warnings = asArray(checked.warnings).length;
  const headline = str(errs[0]?.message) || str(asArray(checked.warnings)[0]?.message);
  await say(
    errs.length === 0 && warnings === 0
      ? 'No errors, no warnings — every part playable as written.'
      : `${errs.length} error${errs.length === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} left for a human to weigh. ${headline.slice(0, 150)}`,
    3000,
  );

  // 6 — sound.
  await say('Four bars, out loud.');
  const played = await call('play', { from_bar: 1, to_bar: 4 }, 400);
  if (played.needs_gesture === true || played.ok === false) {
    await say('Click anywhere once to let the browser start audio', 2600);
  } else {
    await sleep(3000, signal);
    guard(signal);
  }

  // 7 — the one thing the agent cannot do: listen and decide.
  const tunes = pitchesOf(melodyRead);
  const last = tunes[tunes.length - 1] ?? 'C4';
  const penult = tunes[tunes.length - 2] ?? transposePitch(last, 2);
  const lastBar = Math.max(1, num(score.bars, melodyBars.length || 8));
  const optionA = 'A — hold the last note';
  const optionB = 'B — step down and land';
  await say('The agent cannot hear. So it plays both endings and asks.');
  guard(signal);
  const asking = reg.run(
    'ask_human',
    {
      question: 'Two endings. Listen to both — which one closes the piece?',
      options: [
        { label: optionA, part: melodyId, from_bar: lastBar, bars: [bar(time, [last])] },
        { label: optionB, part: melodyId, from_bar: lastBar, bars: [bar(time, [penult, last])] },
      ],
    },
    'demo',
  );

  await sleep(8000, signal);
  const pending = store.ask;
  if (pending) {
    if (signal.aborted) pending.resolve(null);
    else {
      await say('Nobody at the desk — so the demo chooses A itself. In the room, you choose.', 1800);
      pending.resolve(optionA);
    }
  }
  guard(signal);
  const answered = (await Promise.race([asking, sleep(2500, signal).then(() => null)])) as Rec | null;
  const answer = str(answered?.answer, optionA);
  await say(`Chosen: ${answer}. The agent writes what the person picked, never the other way round.`, 2200);

  // 8 — the page a player actually reads.
  await say('And this is the page the trumpet player reads — transposed, in its own key.');
  await call('set_view', { mode: 'part', part: trumpetId }, 2600);

  // 9 — the line that never gets crossed.
  await call('export_plan', {}, 300);
  await say('Every note came from the agent; every decision that leaves the page is yours.', 4500);
  hooks.say(null);
}
