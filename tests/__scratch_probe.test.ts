import { describe, it, expect } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/private/tmp/claude-501/-Users-designc/53a3ddcf-6ffe-4c31-90cb-dad9bedc5805/scratchpad/probe.txt';
try { writeFileSync(OUT, ''); } catch {}
const log = (...a: unknown[]) => appendFileSync(OUT, a.map(String).join(' ') + '\n');
import { StandStore } from '../src/store';
import { buildSurface, type ToolEnv } from '../src/lib/tools';
import type { Player } from '../src/audio/player';

function fakePlayer(armed = true): Player {
  return {
    unlock: async () => true,
    armed: () => armed,
    play: async () => {},
    playVariant: async () => {},
    stop: () => {},
    isPlaying: () => false,
    onCursor: () => () => {},
  };
}

function env(store: StandStore, armed = true): ToolEnv {
  return { store, player: fakePlayer(armed), origin: 'https://example.test' };
}

function surface(e: ToolEnv) {
  const { name, specs } = buildSurface(e);
  const byName = new Map(specs.map((s) => [s.name, s]));
  return { name, specs, byName, call: (n: string, i: any = {}) => byName.get(n)!.execute(i) as Promise<any> };
}

describe('probe', () => {
  it('names + annotations + description lengths', async () => {
    const store = new StandStore();
    store.now = () => Date.now();
    const empty = surface(env(store));
    log('EMPTY', empty.name, JSON.stringify(empty.specs.map((s) => [s.name, s.annotations?.readOnlyHint ?? false, s.description.length])));
    await empty.call('load_melody', { melody: (await empty.call('list_melodies')).melodies[0].id });
    const arr = surface(env(store));
    log('ARRANGING', arr.name, JSON.stringify(arr.specs.map((s) => [s.name, s.annotations?.readOnlyHint ?? false, s.description.length])));
    store.exported = true;
    const exp = surface(env(store));
    log('EXPORTED', exp.name, JSON.stringify(exp.specs.map((s) => [s.name, s.annotations?.readOnlyHint ?? false, s.description.length])));
    store.exported = false;
    expect(true).toBe(true);
  });

  it('bar conversion round trip', async () => {
    const store = new StandStore();
    store.now = () => Date.now();
    let s = surface(env(store));
    const mel = (await s.call('list_melodies')).melodies[0];
    log('MELODY', JSON.stringify(mel));
    await s.call('load_melody', { melody: mel.id });
    s = surface(env(store));
    const score0 = await s.call('get_score');
    log('SCORE0 bars', score0.bars, 'parts', JSON.stringify(score0.parts.map((p: any) => [p.id, p.bars_written, p.locked_bars])));

    // lock bar 2 (0-based index 1) by hand
    store.score!.parts[0].measures[1].locked = true;
    const score1 = await s.call('get_score');
    log('LOCKED_BARS(should be [2])', JSON.stringify(score1.parts[0].locked_bars));

    const rp = await s.call('read_part', { part: 'melody', from_bar: 2, to_bar: 3 });
    log('READ_PART bars', JSON.stringify(rp.bars.map((b: any) => [b.bar, b.locked])));

    // write into bars 2-3 -> bar 2 skipped as locked
    const w = await s.call('write_part', {
      part: 'melody',
      from_bar: 2,
      bars: [
        { notes: [{ pitch: 'C4', dur: 'w' }] },
        { notes: [{ pitch: 'D4', dur: 'w' }] },
      ],
    });
    log('WRITE ok', w.ok, 'written', JSON.stringify(w.written_bars), 'skipped', JSON.stringify(w.skipped_locked_bars), 'next', w.next_step);

    // short bar rejection at from_bar 5
    const bad = await s.call('write_part', { part: 'melody', from_bar: 5, bars: [{ notes: [{ pitch: 'C4', dur: 'q' }] }] });
    log('BAD', JSON.stringify(bad));

    // out-of-range rejection
    const oor = await s.call('write_part', { part: 'melody', from_bar: 4, bars: [{ notes: [{ pitch: 'C9', dur: 'w' }] }] });
    log('OOR', JSON.stringify(oor).slice(0, 900));

    // read_part reversed
    log('REV', JSON.stringify(await s.call('read_part', { part: 'melody', from_bar: 6, to_bar: 3 })));

    // play
    log('PLAY', JSON.stringify(await s.call('play', { from_bar: 2, to_bar: 4 })));
    log('PLAY_PAST_END', JSON.stringify(await s.call('play', { from_bar: 999 })));

    // chords
    log('CHORDS', JSON.stringify(await s.call('write_chords', { chords: ['C', 'G'], from_bar: 3 })).slice(0, 400));

    // check
    const c = await s.call('check');
    log('CHECK', JSON.stringify(c).slice(0, 800));

    // ensemble + harmonize
    log('ENS', JSON.stringify(await s.call('set_ensemble', { instruments: [{ instrument: 'flute' }, { instrument: 'clarinet' }], level: 'middle' })).slice(0, 700));
    s = surface(env(store));
    log('HARM', JSON.stringify(await s.call('harmonize', { source_part: 'flute', target_parts: ['clarinet'], style: 'block', from_bar: 1, to_bar: 4 })).slice(0, 900));
    log('HARM_REV', JSON.stringify(await s.call('harmonize', { source_part: 'flute', target_parts: ['clarinet'], style: 'block', from_bar: 6, to_bar: 2 })).slice(0, 400));

    // transpose
    log('TRANSPOSE', JSON.stringify(await s.call('transpose', { semitones: 2 })).slice(0, 700));
    log('TRANSPOSE_BIG', JSON.stringify(await s.call('transpose', { semitones: 12 })).slice(0, 900));

    // undo / no score errors
    log('UNDO', JSON.stringify(await s.call('undo')));
    log('SET_VIEW', JSON.stringify(await s.call('set_view', { mode: 'part', part: 'clarinet' })));
    log('EXPORT_PLAN', JSON.stringify(await s.call('export_plan')));
    log('STOP', JSON.stringify(await s.call('stop')));
    expect(true).toBe(true);
  });

  it('ask_human timeout returns null', async () => {
    const store = new StandStore();
    store.now = () => Date.now();
    let s = surface(env(store));
    await s.call('load_melody', { melody: (await s.call('list_melodies')).melodies[0].id });
    s = surface(env(store));
    const p = s.call('ask_human', { question: 'A or B?', options: [{ label: 'A' }, { label: 'B', part: 'melody', from_bar: 3, bars: [{ notes: [{ pitch: 'C4', dur: 'w' }] }] }] });
    // simulate the person answering B
    setTimeout(() => store.ask?.resolve('B'), 10);
    log('ASK', JSON.stringify(await p));
    const p2 = s.call('ask_human', { question: 'again?', options: [{ label: 'A' }] });
    setTimeout(() => store.ask?.resolve(null), 10);
    log('ASK_NULL', JSON.stringify(await p2));
    expect(true).toBe(true);
  });

  it('regression: clamping + locked transpose', async () => {
    const store = new StandStore();
    store.now = () => Date.now();
    let s = surface(env(store));
    await s.call('load_melody', { melody: 'ode-to-joy' });
    s = surface(env(store));
    log('PLAY_CLAMP', JSON.stringify(await s.call('play', { from_bar: 2, to_bar: 999 })));
    log('READ_PAST_END', JSON.stringify(await s.call('read_part', { part: 'melody', from_bar: 40 })));
    log('READ_REV', JSON.stringify(await s.call('read_part', { part: 'melody', from_bar: 6, to_bar: 3 })));
    log('HARM_PAST_END', JSON.stringify(await s.call('harmonize', { source_part: 'melody', target_parts: ['melody'], style: 'block', from_bar: 99 })).slice(0, 300));

    // lock bar 12 (the one whose transposed pitch would fall out of range) and transpose down
    store.score!.parts[0].measures[11].locked = true;
    log('T_LOCKED', JSON.stringify(await s.call('transpose', { semitones: -2 })).slice(0, 600));
    log('AFTER bar12', JSON.stringify(store.score!.parts[0].measures[11].notes.map((n) => n.pitch)));
    log('AFTER bar1', JSON.stringify(store.score!.parts[0].measures[0].notes.map((n) => n.pitch)));
    expect(true).toBe(true);
  });

  it('no-score errors', async () => {
    const store = new StandStore();
    store.now = () => Date.now();
    const s = surface(env(store));
    log('EMPTY_GET', JSON.stringify(await s.call('get_score')).slice(0, 400));
    log('BAD_LOAD', JSON.stringify(await s.call('load_melody', { melody: 'nope' })));
  });
});
