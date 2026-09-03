import { describe, expect, it } from 'vitest';
import { buildSchedule, player, withVariant } from '../src/audio/player';
import { DUR_TICKS, type Measure, type Score } from '../src/core/types';

function bar(...notes: Measure['notes']): Measure {
  return { notes };
}

function scoreOf(parts: Score['parts'], patch: Partial<Score> = {}): Score {
  return {
    title: 'T',
    key: 'C',
    time: '4/4',
    tempo: 120,
    level: 'middle',
    parts,
    chords: [],
    ...patch,
  };
}

const melody: Score['parts'][number] = {
  id: 'flute-1',
  instrumentId: 'flute',
  label: 'Flute 1',
  measures: [
    bar({ pitch: 'C5', dur: 'q' }, { pitch: 'r', dur: 'q' }, { pitch: 'E5', dur: 'h', tie: true }),
    bar({ pitch: 'E5', dur: 'h' }, { pitch: 'G5', dur: 'q', art: 'staccato' }, { pitch: 'G5', dur: 'q', art: 'accent' }),
  ],
};

describe('buildSchedule', () => {
  it('converts ticks to seconds at the score tempo', () => {
    const s = buildSchedule(scoreOf([melody]));
    // quarter = 480 ticks; at 120 bpm that is 0.5 s.
    expect(s.secPerTick * DUR_TICKS.q).toBeCloseTo(0.5, 6);
    expect(buildSchedule(scoreOf([melody], { tempo: 60 })).secPerTick * DUR_TICKS.q).toBeCloseTo(1, 6);
  });

  it('places notes on the bar grid and lets rests advance time', () => {
    const { notes } = buildSchedule(scoreOf([melody]));
    expect(notes[0]).toMatchObject({ startTick: 0, midi: 72 });
    // the rest fills beat 2, so the half note lands on beat 3
    expect(notes[1].startTick).toBe(DUR_TICKS.q * 2);
    // bar 2 starts at 1920 ticks
    expect(notes[2].startTick).toBe(1920 + DUR_TICKS.h);
  });

  it('merges tied notes into one longer note', () => {
    const { notes } = buildSchedule(scoreOf([melody]));
    const tied = notes.find((n) => n.startTick === DUR_TICKS.q * 2)!;
    expect(tied.durTicks).toBe(DUR_TICKS.h * 2); // half tied across the barline into a half
    expect(notes.filter((n) => n.midi === 76)).toHaveLength(1);
  });

  it('applies articulation and dynamics', () => {
    const { notes } = buildSchedule(scoreOf([melody]));
    const stac = notes.find((n) => n.startTick === 1920 + DUR_TICKS.h)!;
    expect(stac.holdTicks).toBeCloseTo(DUR_TICKS.q * 0.5, 6);
    const acc = notes.find((n) => n.startTick === 1920 + DUR_TICKS.h + DUR_TICKS.q)!;
    expect(acc.velocity).toBeGreaterThan(stac.velocity);
  });

  it('carries a dynamic forward from before the played range', () => {
    const part = {
      id: 'p',
      instrumentId: 'flute',
      label: 'P',
      measures: [bar({ pitch: 'C4', dur: 'w', dyn: 'pp' as const }), bar({ pitch: 'D4', dur: 'w' })],
    };
    const { notes } = buildSchedule(scoreOf([part]), { from: 1 });
    expect(notes).toHaveLength(1);
    expect(notes[0].startTick).toBe(0); // ticks are relative to the first played bar
    expect(notes[0].velocity).toBeCloseTo(0.22, 6);
  });

  it('honours from/to, mutes and an explicit part list', () => {
    const other = { ...melody, id: 'clar-1', label: 'Clarinet', muted: true };
    const s = scoreOf([melody, other]);
    expect(buildSchedule(s).parts.map((p) => p.id)).toEqual(['flute-1']);
    expect(buildSchedule(s, { parts: ['clar-1'] }).parts.map((p) => p.id)).toEqual(['clar-1']);
    const one = buildSchedule(s, { from: 1, to: 1 });
    expect(one.totalTicks).toBe(1920);
    expect(one.notes.every((n) => n.startTick < 1920)).toBe(true);
    // out-of-range bars clamp instead of throwing
    expect(buildSchedule(s, { from: 99, to: 200 }).from).toBe(1);
  });

  it('keeps 3/4 bars 1440 ticks apart', () => {
    const part = { id: 'p', instrumentId: 'flute', label: 'P', measures: [bar({ pitch: 'C4', dur: 'hd' }), bar({ pitch: 'D4', dur: 'hd' })] };
    const { notes, barTicks } = buildSchedule(scoreOf([part], { time: '3/4' }));
    expect(barTicks).toBe(1440);
    expect(notes[1].startTick).toBe(1440);
  });
});

describe('withVariant', () => {
  it('substitutes bars without mutating the score', () => {
    const src = scoreOf([{ ...melody, muted: true }]);
    const snapshot = JSON.stringify(src);
    const swapped = withVariant(src, { partId: 'flute-1', from: 1, measures: [bar({ pitch: 'A4', dur: 'w' })] });
    expect(JSON.stringify(src)).toBe(snapshot);
    expect(swapped.parts[0].measures[1].notes[0].pitch).toBe('A4');
    expect(swapped.parts[0].measures[0].notes[0].pitch).toBe('C5');
    expect(swapped.parts[0].muted).toBe(false); // an A/B candidate always sounds
  });

  it('ignores an unknown part id', () => {
    const src = scoreOf([melody]);
    expect(withVariant(src, { partId: 'nope', from: 0, measures: [] })).toBe(src);
  });
});

describe('player without an audio context', () => {
  it('stays silent and resolves instead of throwing', async () => {
    expect(player.armed()).toBe(false);
    expect(player.isPlaying()).toBe(false);
    const seen: unknown[] = [];
    const off = player.onCursor((p) => seen.push(p));
    await player.play(scoreOf([melody]));
    await player.playVariant(scoreOf([melody]), { partId: 'flute-1', from: 0, measures: [bar({ pitch: 'A4', dur: 'w' })] });
    expect(player.armed()).toBe(false);
    expect(player.isPlaying()).toBe(false);
    player.stop();
    expect(seen).toEqual([null]); // stop always tells the UI the playhead is gone
    off();
    player.stop();
    expect(seen).toHaveLength(1); // unsubscribed
  });
});
