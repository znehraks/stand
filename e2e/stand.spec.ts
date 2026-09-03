// End-to-end: everything here goes through the REAL registered WebMCP tools (via the shim)
// or through the real UI. Nothing is stubbed. Run the app first: `npm run dev -- --port 5182`.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { WEBMCP_SHIM } from './webmcp-shim';
import { keyFifths, midiToPitch, pitchToMidi, writtenKey } from '../src/core/pitch';
import { DUR_TICKS, TIME_TICKS, type Dur, type TimeSig } from '../src/core/types';

type Any = Record<string, any>;

declare global {
  interface Window {
    __agent: { names(): Promise<string[]>; call(name: string, input?: unknown): Promise<any> };
    __ask?: Promise<any>;
  }
}

const EMPTY_TOOLS = ['get_score', 'list_instruments', 'list_melodies', 'load_melody'];
const BAND = [
  { instrument: 'flute', count: 2 },
  { instrument: 'clarinet' },
  { instrument: 'alto sax' },
  { instrument: 'trumpet' },
  { instrument: 'trombone' },
];

const tools = (page: Page) => page.evaluate(() => window.__agent.names());
const call = (page: Page, name: string, input: Any = {}): Promise<Any> =>
  page.evaluate(({ n, i }) => window.__agent.call(n, i), { n: name, i: input });

/** Ranges may be reported as ['C4','G5'], {low,high} or 'C4–G5'. Accept all three. */
function parseRange(v: unknown): [string, string] | null {
  if (Array.isArray(v) && typeof v[0] === 'string' && typeof v[1] === 'string') return [v[0], v[1]];
  if (v && typeof v === 'object') {
    const o = v as Any;
    const lo = o.low ?? o.lo ?? o.min;
    const hi = o.high ?? o.hi ?? o.max;
    if (typeof lo === 'string' && typeof hi === 'string') return [lo, hi];
  }
  if (typeof v === 'string') {
    const p = v.split(/\s*(?:–|—|\.\.|to|-)\s*/i).filter(Boolean);
    if (p.length >= 2 && pitchToMidi(p[0]) !== null && pitchToMidi(p[1]) !== null) return [p[0], p[1]];
  }
  return null;
}

/** A pitch safely inside a part's sounding range at the score's level. */
function mid(part: Any): string {
  const r = parseRange(part?.range_at_level);
  if (!r) return 'G4';
  return midiToPitch(Math.round(((pitchToMidi(r[0]) ?? 60) + (pitchToMidi(r[1]) ?? 72)) / 2));
}

/** One legal bar of `time`, split evenly between `pitches`. */
function fillBar(time: TimeSig, pitches: string[]): { notes: { pitch: string; dur: Dur }[] } {
  const each = (TIME_TICKS[time] ?? 1920) / pitches.length;
  const dur = (Object.entries(DUR_TICKS) as [Dur, number][]).find(([, t]) => t === each)?.[0] ?? 'q';
  return { notes: pitches.map((pitch) => ({ pitch, dur })) };
}

const find = (score: Any, re: RegExp): Any =>
  (score.parts as Any[]).find((p) => re.test(`${p.id} ${p.instrument ?? ''} ${p.label ?? ''}`)) as Any;

async function loadMelody(page: Page): Promise<Any> {
  const { melodies } = await call(page, 'list_melodies');
  expect(melodies.length, 'the empty surface must offer public-domain melodies').toBeGreaterThan(0);
  const loaded = await call(page, 'load_melody', { melody: melodies[0].id });
  expect(loaded.ok).toBe(true);
  await expect.poll(() => tools(page)).toContain('write_part');
  return call(page, 'get_score');
}

async function band(page: Page, level = 'elementary'): Promise<Any> {
  await loadMelody(page);
  const set = await call(page, 'set_ensemble', { instruments: BAND, level });
  expect(set.ok).toBe(true);
  return call(page, 'get_score');
}

/** The lock control the person clicks on bar `bar` (1-based) of `partId`. */
const lockControl = (page: Page, partId: string, bar: number): Locator =>
  page
    .locator(`[data-testid="lock-${partId}-${bar}"], [data-lock="${partId}:${bar}"], [data-testid="lock"][data-part="${partId}"][data-bar="${bar}"]`)
    .or(page.getByRole('button', { name: new RegExp(`(un)?lock\\b.*\\bbar ${bar}\\b`, 'i') }))
    .or(page.locator('.score-view').getByRole('button', { name: /lock/i }).nth(bar - 1))
    .first();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(WEBMCP_SHIM);
  await page.goto('/');
  await expect.poll(() => tools(page)).toContain('load_melody');
});

test('the empty surface offers only the empty-phase tools, and loading a melody swaps it', async ({ page }) => {
  expect(await tools(page)).toEqual(EMPTY_TOOLS);
  expect((await call(page, 'get_score')).phase).toBe('empty');

  await loadMelody(page);
  const after = await tools(page);
  expect(after).not.toContain('load_melody');
  expect(after).not.toContain('list_melodies');
  expect(after).toEqual(
    expect.arrayContaining(['set_ensemble', 'write_part', 'harmonize', 'check', 'play', 'stop', 'ask_human', 'set_view', 'undo', 'export_plan', 'read_part']),
  );
});

test('set_ensemble builds the parts and get_score reports each written key', async ({ page }) => {
  const score = await band(page);
  const labels = (score.parts as Any[]).map((p) => p.label);
  expect(labels).toEqual(expect.arrayContaining(['Flute 1', 'Flute 2']));
  expect(score.parts.length).toBe(6); // two flutes + four singles
  expect(score.level).toBe('elementary');

  const clarinet = find(score, /clarinet/i);
  expect(clarinet, 'a Bb clarinet part').toBeTruthy();
  expect(clarinet.transposition).toBe(2);
  // A Bb clarinet reads one whole step up — two fifths sharper than concert.
  expect(clarinet.written_key).toBe(writtenKey(score.key, 2));
  expect(keyFifths(clarinet.written_key) - keyFifths(score.key)).toBe(2);
  expect(find(score, /trumpet/i).written_key).toBe(writtenKey(score.key, 2));
  expect(find(score, /trombone/i).written_key).toBe(score.key); // C instrument
});

test('a bar that does not fill the bar is rejected by name; a legal write lands', async ({ page }) => {
  const score = await band(page);
  const trumpet = find(score, /trumpet/i);
  const p = mid(trumpet);

  const short = await call(page, 'write_part', { part: trumpet.id, from_bar: 2, bars: [{ notes: [{ pitch: p, dur: 'q' }] }] });
  expect(short.ok).toBe(false);
  expect(String(short.error)).toMatch(/\b2\b/);
  expect(String(short.error)).toMatch(/bar|measure|m\./i);

  const good = await call(page, 'write_part', {
    part: trumpet.id,
    from_bar: 2,
    bars: [fillBar(score.time, [p, p, p, p]), fillBar(score.time, [p, p, p, p])],
  });
  expect(good.ok).toBe(true);
  const after = find(await call(page, 'get_score'), /trumpet/i);
  expect(after.bars_written).toBeGreaterThanOrEqual(2);
  const read = await call(page, 'read_part', { part: trumpet.id, from_bar: 2, to_bar: 2 });
  expect(read.bars[0].notes[0].pitch).toBe(p);
});

test('a note above the elementary range is refused, and the same note passes at adult', async ({ page }) => {
  const score = await band(page);
  const trumpet = find(score, /trumpet/i);
  const table = ((await call(page, 'list_instruments')).instruments as Any[]).find((i) => /trumpet/i.test(`${i.id} ${i.name}`));
  const elem = parseRange(table?.range_by_level?.elementary);
  const adult = parseRange(table?.range_by_level?.adult);
  expect(elem && adult, 'list_instruments must report range_by_level per level').toBeTruthy();

  const tooHigh = midiToPitch(pitchToMidi(elem![1])! + 1);
  expect(pitchToMidi(tooHigh)!).toBeLessThanOrEqual(pitchToMidi(adult![1])!);
  const bars = [fillBar(score.time, [mid(trumpet), mid(trumpet), mid(trumpet), tooHigh])];

  const refused = await call(page, 'write_part', { part: trumpet.id, from_bar: 1, bars });
  expect(refused.ok).toBe(false);
  expect(String(refused.error)).toMatch(/range|high|above/i);

  expect((await call(page, 'set_meta', { level: 'adult' })).ok).toBe(true);
  await expect.poll(async () => (await call(page, 'get_score')).level).toBe('adult');
  expect((await call(page, 'write_part', { part: trumpet.id, from_bar: 1, bars })).ok).toBe(true);
});

test('a bar a person locked in the UI is skipped, and its music is untouched', async ({ page }) => {
  const score = await band(page);
  const melody = (score.parts as Any[]).find((p) => (p.bars_written ?? 0) > 0) ?? score.parts[0];
  const before = (await call(page, 'read_part', { part: melody.id, from_bar: 1, to_bar: 1 })).bars[0];

  // One part on screen, so "bar 1" is unambiguous under the pointer.
  await call(page, 'set_view', { mode: 'part', part: melody.id });
  const lock = lockControl(page, melody.id, 1);
  await expect(lock, 'ScoreView must expose a per-bar lock control (data-testid="lock-<partId>-<bar>")').toBeVisible();
  await lock.click();
  await expect
    .poll(async () => (await call(page, 'read_part', { part: melody.id, from_bar: 1, to_bar: 1 })).bars[0].locked)
    .toBe(true);

  const p = mid(melody);
  const res = await call(page, 'write_part', { part: melody.id, from_bar: 1, bars: [fillBar(score.time, [p, p, p, p])] });
  expect(res.ok).toBe(true);
  expect(res.skipped_locked_bars).toContain(1);
  const after = (await call(page, 'read_part', { part: melody.id, from_bar: 1, to_bar: 1 })).bars[0];
  expect(after.notes.map((n: Any) => `${n.pitch}${n.dur}`)).toEqual(before.notes.map((n: Any) => `${n.pitch}${n.dur}`));
});

test('harmonize fills the target parts and check finds no errors', async ({ page }) => {
  const score = await band(page, 'middle');
  const melody = (score.parts as Any[]).find((p) => (p.bars_written ?? 0) > 0) ?? score.parts[0];
  const targets = [find(score, /clarinet/i).id, find(score, /alto/i).id, find(score, /trombone/i).id];

  const h = await call(page, 'harmonize', { source_part: melody.id, target_parts: targets, style: 'block' });
  expect(h.ok).toBe(true);
  expect(Object.keys(h.wrote)).toEqual(expect.arrayContaining(targets));
  const written = await call(page, 'get_score');
  for (const id of targets) {
    const part = (written.parts as Any[]).find((p) => p.id === id) as Any;
    expect(part.bars_written, `${id} received harmony`).toBeGreaterThan(0);
  }
  // The draft has to survive the page's own checker in every part it touched.
  for (const id of targets) {
    const one = await call(page, 'check', { part: id });
    expect(one.errors, `${id}: ${one.summary}`).toEqual([]);
  }
  const whole = await call(page, 'check');
  expect((whole.errors as Any[]).filter((e) => targets.includes(e.part)), 'harmonize introduced no errors').toEqual([]);
});

test('ask_human shows playable options and the person’s click resolves the tool', async ({ page }) => {
  const score = await band(page);
  const melody = (score.parts as Any[]).find((p) => (p.bars_written ?? 0) > 0) ?? score.parts[0];
  const p = mid(melody);
  const A = 'A — hold the last note';
  const B = 'B — step down and land';

  await page.evaluate(
    ({ id, a, b, barA, barB }) => {
      window.__ask = window.__agent.call('ask_human', {
        question: 'Which ending?',
        options: [
          { label: a, part: id, from_bar: 1, bars: [barA] },
          { label: b, part: id, from_bar: 1, bars: [barB] },
        ],
      });
    },
    { id: melody.id, a: A, b: B, barA: fillBar(score.time, [p]), barB: fillBar(score.time, [p, p]) },
  );

  const card = page.locator('[data-testid="ask-card"]').or(page.locator('.ask-card')).first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('Which ending?');
  await expect(card).toContainText(A);
  await expect(card).toContainText(B);
  const plays = card.locator('[data-testid="ask-play"]').or(card.getByRole('button', { name: /play|listen|▶/i }));
  expect(await plays.count(), 'every option is playable — the person listens before choosing').toBeGreaterThanOrEqual(2);

  const option = card.locator(`[data-label="${B}"]`).or(card.locator('.ask-opt, li').filter({ hasText: B })).first();
  await option.locator('[data-testid="ask-choose"]').or(option.getByRole('button', { name: /choose|select|pick/i })).first().click();
  expect((await page.evaluate(() => window.__ask!)).answer).toBe(B);
  await expect(card).toBeHidden();
});

test('exporting is human-only: no export tool exists, and the button downloads a file', async ({ page }) => {
  const noExport = (names: string[]) => names.filter((n) => n === 'export' || /^export_(?!plan$)/.test(n));
  expect(noExport(await tools(page))).toEqual([]);
  await band(page);
  expect(noExport(await tools(page))).toEqual([]);
  expect(await tools(page)).toContain('export_plan');

  const musicxml = page.locator('[data-testid="export-musicxml"]').or(page.getByRole('button', { name: /^musicxml$/i })).first();
  const [download] = await Promise.all([page.waitForEvent('download'), musicxml.click()]);
  expect(download.suggestedFilename()).toMatch(/\.musicxml$/);

  await expect.poll(async () => (await call(page, 'get_score')).phase).toBe('exported');
  const exported = await tools(page);
  expect(noExport(exported)).toEqual([]);
  expect(exported).toEqual(expect.arrayContaining(['get_score', 'export_plan', 'reopen']));
  expect(exported).not.toContain('write_part');
});
