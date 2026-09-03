// Records the Stand demo. Everything the agent does goes through the page's real WebMCP tools
// (via the test shim); everything a person does is a real click. Captions are injected.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const { WEBMCP_SHIM } = await import('../../e2e/webmcp-shim.ts');
const base = process.env.BASE_URL ?? 'https://stand.znehraks.workers.dev';
const scenes = JSON.parse(fs.readFileSync('docs/video/build/scenes.json', 'utf8'));
const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
const dir = 'docs/video/build/rec';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAP_CSS = `#__cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1120px;background:rgba(8,8,12,.93);color:#fff;font:500 21px/1.35 Inter,system-ui,sans-serif;padding:12px 20px;border-radius:12px;z-index:99999;box-shadow:0 12px 40px rgba(0,0,0,.55);text-align:center}#__cap:empty{opacity:0}#__cap small{display:block;font-size:13px;color:#b9b7b0;margin-top:4px}`;
async function cap(page, text, sub = '') {
  await page.evaluate(([t, s, css]) => {
    let st = document.getElementById('__capcss');
    if (!st) { st = document.createElement('style'); st.id = '__capcss'; st.textContent = css; document.head.appendChild(st); }
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id = '__cap'; document.body.appendChild(el); }
    el.innerHTML = t ? t + (s ? `<small>${s}</small>` : '') : '';
  }, [text, sub, CAP_CSS]);
}
const agent = (page, name, input) => page.evaluate(([n, i]) => window.__agent.call(n, i ?? {}), [name, input]);
const SUB = 'Tool calls driven by a test harness through the page’s WebMCP API — ChatGPT calls the same tools.';

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const A = await ctx.newPage();
await A.addInitScript(WEBMCP_SHIM);
const marks = {};
const t0 = Date.now();
const mark = (id) => { marks[id] = (Date.now() - t0) / 1000; console.log('scene', id, marks[id].toFixed(2)); };
const until = (id, startedAt, extra = 0) => sleep(Math.max(0, S[id].audio * 1000 + extra - (Date.now() - startedAt)));

await A.goto(base + '/');
await A.waitForSelector('text=WebMCP detected', { timeout: 20000 }).catch(() => {});
// One real click so the browser lets the page make sound.
await A.mouse.click(640, 400);
await sleep(600);

// S2 — the brief
let st = Date.now(); mark('02-brief');
await cap(A, S['02-brief'].caption, SUB);
await sleep(6000);
await agent(A, 'load_melody', { melody: 'ode-to-joy' });
await sleep(3000);
await until('02-brief', st, 300);

// S3 — the agent writes the parts
st = Date.now(); mark('03-writes');
await cap(A, S['03-writes'].caption, SUB);
await agent(A, 'set_ensemble', {
  instruments: [{ instrument: 'flute', count: 2 }, { instrument: 'clarinet' }, { instrument: 'alto-sax' }, { instrument: 'trumpet' }, { instrument: 'trombone' }, { instrument: 'snare' }],
  level: 'elementary',
});
await sleep(2500);
const score = await agent(A, 'get_score');
const parts = (score.parts ?? []).map((p) => p.id);
await agent(A, 'harmonize', { source_part: parts[0], target_parts: parts.slice(1, 5), style: 'block' });
await until('03-writes', st, 300);

// S4 — the page refuses
st = Date.now(); mark('04-refuse');
await cap(A, S['04-refuse'].caption, SUB);
const bad = await agent(A, 'write_part', { part: 'trumpet', from_bar: 1, bars: [{ notes: [{ pitch: 'D6', dur: 'q' }, { pitch: 'D6', dur: 'q' }, { pitch: 'C6', dur: 'h' }] }] });
console.log('refused:', JSON.stringify(bad).slice(0, 240));
await sleep(4500);
await agent(A, 'write_part', { part: 'trumpet', from_bar: 1, bars: [{ notes: [{ pitch: 'G4', dur: 'q' }, { pitch: 'G4', dur: 'q' }, { pitch: 'A4', dur: 'h' }] }] });
await sleep(2200);
// The tune itself dips below a beginner flute in bar 12 — the page flagged it, the agent lifts it.
const before = await agent(A, 'check', {});
console.log('errors before fix:', (before.errors ?? []).length);
await agent(A, 'write_part', { part: parts[0], from_bar: 12, bars: [{ notes: [{ pitch: 'C4', dur: 'q' }, { pitch: 'D4', dur: 'q' }, { pitch: 'G4', dur: 'q' }, { pitch: 'E4', dur: 'q' }] }] });
await sleep(1800);
const after = await agent(A, 'check', {});
console.log('errors after fix:', (after.errors ?? []).length);
await until('04-refuse', st, 300);

// S5 — the person decides by ear
st = Date.now(); mark('05-hear');
await cap(A, S['05-hear'].caption, SUB);
await agent(A, 'play', { from_bar: 1, to_bar: 4 });
await sleep(6000);
const askPromise = agent(A, 'ask_human', {
  question: 'Which ending do you prefer?',
  options: [
    { label: 'A — settle on the tonic', part: parts[0], from_bar: 7, bars: [{ notes: [{ pitch: 'E4', dur: 'q' }, { pitch: 'D4', dur: 'q' }, { pitch: 'C4', dur: 'h' }] }] },
    { label: 'B — lift to the third', part: parts[0], from_bar: 7, bars: [{ notes: [{ pitch: 'G4', dur: 'q' }, { pitch: 'F4', dur: 'q' }, { pitch: 'E4', dur: 'h' }] }] },
  ],
});
await A.waitForSelector('[data-testid="ask-card"]', { timeout: 10000 });
await sleep(1200);
for (const label of ['A — settle on the tonic', 'B — lift to the third']) {
  const play = A.locator(`[data-testid="ask-play"][data-label="${label}"]`);
  if (await play.count()) { await play.first().click(); await sleep(4200); }
}
await A.locator('[data-testid="ask-choose"][data-label="B — lift to the third"]').first().click();
console.log('chosen:', JSON.stringify(await askPromise));
await until('05-hear', st, 300);

// S6 — a locked bar
st = Date.now(); mark('06-lock');
await cap(A, S['06-lock'].caption, SUB);
const lock = A.locator('[data-testid^="lock-trumpet-"]').first();
if (await lock.count()) { await lock.scrollIntoViewIfNeeded(); await lock.click(); }
await sleep(2200);
const skipped = await agent(A, 'write_part', { part: 'trumpet', from_bar: 1, bars: [{ notes: [{ pitch: 'G4', dur: 'w' }] }, { notes: [{ pitch: 'A4', dur: 'w' }] }] });
console.log('lock respected:', JSON.stringify(skipped).slice(0, 200));
await sleep(3000);
await until('06-lock', st, 300);

// S7 — the transposed part and the export
st = Date.now(); mark('07-parts');
await cap(A, S['07-parts'].caption, SUB);
await agent(A, 'set_view', { mode: 'part', part: 'trumpet' });
await sleep(5000);
await agent(A, 'set_view', { mode: 'full' });
await sleep(1500);
await A.evaluate(() => document.querySelector('.export-bar')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(2000);
await until('07-parts', st, 300);

// S8 — why WebMCP (show the console)
st = Date.now(); mark('08-why');
await cap(A, S['08-why'].caption);
await A.evaluate(() => document.querySelector('.console')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(6000);
await agent(A, 'read_part', { part: 'trumpet', from_bar: 1, to_bar: 2 });
await sleep(4000);
await until('08-why', st, 300);
mark('08-end');
await cap(A, '');
await sleep(500);
const video = await A.video().path();
await ctx.close();
await browser.close();
fs.writeFileSync('docs/video/build/marks.json', JSON.stringify({ videoA: video, marks }, null, 1));
console.log(JSON.stringify(marks));
