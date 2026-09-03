import { chromium } from '@playwright/test';
import fs from 'node:fs';
const { WEBMCP_SHIM } = await import('../../e2e/webmcp-shim.ts');
const base = process.env.BASE_URL ?? 'https://attune.znehraks.workers.dev';
const scenes = JSON.parse(fs.readFileSync('docs/video/build/scenes.json', 'utf8'));
const S = Object.fromEntries(scenes.map((s) => [s.id, s]));
const dir = 'docs/video/build/rec';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CAP_CSS = `#__cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);max-width:1100px;background:rgba(20,20,26,.88);color:#fff;font:500 22px/1.35 Inter,system-ui,sans-serif;padding:12px 20px;border-radius:12px;z-index:9999;box-shadow:0 10px 30px rgba(0,0,0,.35);text-align:center}#__cap:empty{opacity:0}#__cap small{display:block;font-size:14px;color:#cfcdc5;margin-top:4px}`;
async function cap(page, text, sub = '') {
  await page.evaluate(([t, s, css]) => {
    let st = document.getElementById('__capcss');
    if (!st) { st = document.createElement('style'); st.id = '__capcss'; st.textContent = css; document.head.appendChild(st); }
    let el = document.getElementById('__cap');
    if (!el) { el = document.createElement('div'); el.id = '__cap'; document.body.appendChild(el); }
    el.innerHTML = t ? t + (s ? `<small>${s}</small>` : '') : '';
  }, [text, sub, CAP_CSS]);
}
const agent = (page, name, input) => page.evaluate(([n, i]) => window.__agent.call(n, i), [name, input ?? {}]);
const scrollToBlock = (page, id) => page.evaluate((i) => document.getElementById(`b-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), id);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
const A = await ctx.newPage();
await A.addInitScript(WEBMCP_SHIM);
const marks = {};
const t0 = Date.now();
const mark = (id) => { marks[id] = (Date.now() - t0) / 1000; console.log('scene', id, marks[id].toFixed(2)); };
const until = (id, startedAt, extra = 0) => sleep(Math.max(0, S[id].audio * 1000 + extra - (Date.now() - startedAt)));
const SUB = 'Tool calls driven by a test harness through the page’s WebMCP API here — ChatGPT calls the same tools.';

await A.goto(base + '/a/compound-interest');
await A.waitForSelector('text=WebMCP detected');
await agent(A, 'forget_me');
await sleep(500);

// S2 hook — action within the first seconds: needs + context declared on arrival
let st = Date.now(); mark('02-hook');
await cap(A, S['02-hook'].caption, SUB);
await sleep(3200);
await agent(A, 'declare_reader_needs', { vision: 'low-vision', light: 'dark-room', device: 'phone', note: 'set from what you told me earlier' });
await sleep(1800);
await agent(A, 'declare_reader_context', { level: 'intermediate', language: 'en', time_minutes: 3, goal: 'decide', knows: ['compounding'], note: 'you asked for the 3-minute version' });
await until('02-hook', st, 300);

// S3 composed — show edition + reasons
st = Date.now(); mark('03-composed');
await cap(A, S['03-composed'].caption, SUB);
await sleep(2500);
await A.mouse.wheel(0, 300); await sleep(3500);
await A.mouse.wheel(0, 300); await sleep(3500);
await A.evaluate(() => document.querySelector('.handshake')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(3000);
await A.mouse.wheel(0, -900);
await until('03-composed', st, 300);

// S4 calculator
st = Date.now(); mark('04-calc');
await cap(A, S['04-calc'].caption, SUB);
await agent(A, 'declare_reader_context', { time_minutes: 0 });
await sleep(800);
await A.evaluate(() => document.querySelector('.interactive-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(2200);
await agent(A, 'set_interactive', { id: 'compound-calculator', params: { monthly: 500, years: 40, fee: 1 } });
await sleep(2500);
await agent(A, 'get_interactive', { id: 'compound-calculator' });
await until('04-calc', st, 300);

// S5 why — reset display, show the home page copy
st = Date.now(); mark('05-why');
await agent(A, 'declare_reader_needs', { vision: 'typical', light: 'normal', device: 'unknown' });
await agent(A, 'set_display', { preset: 'default' });
await A.goto(base + '/');
await A.waitForSelector('text=WebMCP detected');
await cap(A, S['05-why'].caption);
await sleep(7000);
await A.mouse.wheel(0, 500); await sleep(6000);
await A.mouse.wheel(0, 500); await sleep(5000);
await until('05-why', st, 300);

// S5.5 studio — the author's agent drafts; the author approves by click
st = Date.now(); mark('055-studio');
await A.goto(base + '/studio/compound-interest');
await A.waitForSelector('text=WebMCP detected');
await A.evaluate(() => localStorage.removeItem('attune:studio:compound-interest'));
await A.reload();
await A.waitForSelector('text=WebMCP detected');
await cap(A, S['055-studio'].caption, SUB);
await sleep(2500);
const cov = await agent(A, 'get_article_coverage');
const tgt = cov.blocks_without_plainer_version[0];
await agent(A, 'propose_plainer_version', { block_id: tgt, text_en: 'This is the same idea in everyday words: money that earns money keeps earning on what it earned, so it grows faster every year. Leave it alone and the curve bends upward on its own.', text_ko: '같은 내용을 쉬운 말로: 돈이 번 돈이 다시 돈을 벌기 때문에 해마다 더 빨리 불어납니다. 가만히 두면 곡선이 저절로 위로 휩니다.', rationale: 'dense paragraph; readers re-read it' });
await sleep(1500);
const one = cov.blocks_written_for_one_level_only.find((b) => b.level === 'expert');
if (one) await agent(A, 'propose_level_variant', { block_id: one.block_id, level: 'novice', text_en: 'Here is the beginner version of that idea, with a small example instead of the formula: put in 100, earn 7, and next year you earn on 107.', text_ko: '입문자용으로, 공식 대신 작은 예시로: 100을 넣고 7을 벌면 다음 해에는 107에 대해 법니다.', rationale: 'section has no novice block' });
await sleep(1500);
await A.evaluate(() => document.querySelector('.proposal')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
await sleep(3000);
const approve = A.getByRole('button', { name: /Approve — publish this block/ }).first();
await approve.hover(); await sleep(600);
await approve.click();
await sleep(2500);
await until('055-studio', st, 300);

// S6 levels — Korean novice full edition on the WebMCP article
st = Date.now(); mark('06-levels');
await A.goto(base + '/a/webmcp');
await A.waitForSelector('text=WebMCP detected');
await cap(A, S['06-levels'].caption, SUB);
await sleep(1200);
await agent(A, 'declare_reader_context', { level: 'novice', language: 'ko', time_minutes: 0 });
await sleep(3500);
await A.mouse.wheel(0, 400); await sleep(3000);
await A.mouse.wheel(0, 400); await sleep(2500);
await until('06-levels', st, 300);

// S7 friction → simplify (english intermediate)
st = Date.now(); mark('07-friction');
await cap(A, S['07-friction'].caption, SUB);
await agent(A, 'declare_reader_context', { level: 'intermediate', language: 'en', time_minutes: 0 });
await sleep(800);
const sec = await agent(A, 'read_section');
let target = null;
for (const b of sec.blocks.filter((x) => x.kind === 'para')) { const rb = await agent(A, 'read_block', { block_id: b.block_id }); if (rb.has_simpler_version) { target = b.block_id; break; } }
if (!target) target = sec.blocks.find((x) => x.kind === 'para')?.block_id;
await scrollToBlock(A, target); await sleep(1800);
await A.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })); await sleep(2600);
await scrollToBlock(A, target); await sleep(1200);
await agent(A, 'get_reading_friction');
await sleep(800);
await agent(A, 'simplify_block', { block_id: target });
await until('07-friction', st, 300);

// S8 author + forget
st = Date.now(); mark('08-author');
await cap(A, S['08-author'].caption, SUB);
await A.evaluate(() => document.querySelector('.console')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
await sleep(700);
await agent(A, 'ask_author', { question: 'Does this work inside an iframe?' });
await sleep(3200);
await agent(A, 'ask_author', { question: 'What is the airspeed velocity of an unladen swallow?' });
await sleep(2200);
await agent(A, 'forget_me');
await until('08-author', st, 300);

// S9 publisher insights
st = Date.now(); mark('09-publisher');
await cap(A, S['09-publisher'].caption);
await A.goto(base + '/insights/compound-interest');
await cap(A, S['09-publisher'].caption);
await sleep(5500);
await A.goto(base + '/publishers');
await cap(A, S['09-publisher'].caption);
await until('09-publisher', st, 300);
mark('09-end');
await cap(A, '');
await sleep(500);
const videoA = await A.video().path();
await ctx.close();
await browser.close();
fs.writeFileSync('docs/video/build/marks.json', JSON.stringify({ videoA, marks }, null, 1));
console.log(JSON.stringify(marks));
