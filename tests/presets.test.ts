import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/data/presets';
import { DUR_TICKS, TIME_TICKS, ticksOf } from '../src/core/types';
import type { Dur, TimeSig } from '../src/core/types';
import { isRest, keyFifths, parsePitch, pitchToMidi } from '../src/core/pitch';

const LOW = pitchToMidi('C3')!; // 48
const HIGH = pitchToMidi('C6')!; // 84

describe('presets', () => {
  it('ships at least six melodies with unique kebab-case ids', () => {
    expect(PRESETS.length).toBeGreaterThanOrEqual(6);
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('has a non-empty title, key and tempo on every preset', () => {
    for (const p of PRESETS) {
      expect(p.title.trim().length).toBeGreaterThan(0);
      expect(Object.keys(TIME_TICKS)).toContain(p.time);
      expect(typeof keyFifths(p.key)).toBe('number');
      expect(p.tempo).toBeGreaterThanOrEqual(40);
      expect(p.tempo).toBeLessThanOrEqual(208);
    }
  });

  it('is 8 to 17 bars long, pickups included', () => {
    for (const p of PRESETS) {
      expect(p.melody.length, p.id).toBeGreaterThanOrEqual(8);
      expect(p.melody.length, p.id).toBeLessThanOrEqual(17);
    }
  });

  it('fills every bar exactly for its time signature', () => {
    for (const p of PRESETS) {
      const want = TIME_TICKS[p.time as TimeSig];
      p.melody.forEach((m, i) => {
        expect(m.notes.length, `${p.id} bar ${i + 1} is empty`).toBeGreaterThan(0);
        expect(ticksOf(m), `${p.id} bar ${i + 1}`).toBe(want);
      });
    }
  });

  it('uses only known duration codes', () => {
    for (const p of PRESETS) {
      for (const m of p.melody) {
        for (const n of m.notes) {
          expect(DUR_TICKS[n.dur as Dur], `${p.id}: ${n.dur}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses pitches that parse and sit between C3 and C6', () => {
    for (const p of PRESETS) {
      p.melody.forEach((m, i) => {
        for (const n of m.notes) {
          if (isRest(n.pitch)) continue;
          expect(parsePitch(n.pitch), `${p.id} bar ${i + 1}: ${n.pitch}`).not.toBeNull();
          const midi = pitchToMidi(n.pitch)!;
          expect(midi, `${p.id} bar ${i + 1}: ${n.pitch} too low`).toBeGreaterThanOrEqual(LOW);
          expect(midi, `${p.id} bar ${i + 1}: ${n.pitch} too high`).toBeLessThanOrEqual(HIGH);
        }
      });
    }
  });

  it('names a public-domain source and gives one chord per bar', () => {
    for (const p of PRESETS) {
      expect(p.source.trim().length, p.id).toBeGreaterThan(20);
      expect(p.source.toLowerCase(), p.id).toContain('public domain');
      expect(p.chords, p.id).toBeDefined();
      expect(p.chords!.length, p.id).toBe(p.melody.length);
      for (const c of p.chords!) expect(c.trim().length, p.id).toBeGreaterThan(0);
    }
  });

  it('starts Ode to Joy on E4 E4 F4 G4', () => {
    const ode = PRESETS.find((p) => p.id === 'ode-to-joy');
    expect(ode).toBeDefined();
    expect(ode!.key).toBe('C');
    expect(ode!.melody[0].notes.map((n) => n.pitch)).toEqual(['E4', 'E4', 'F4', 'G4']);
    expect(ode!.melody[0].notes.map((n) => n.dur)).toEqual(['q', 'q', 'q', 'q']);
    // second bar completes the phrase: G F E D
    expect(ode!.melody[1].notes.map((n) => n.pitch)).toEqual(['G4', 'F4', 'E4', 'D4']);
  });

  it('keeps Arirang in 3/4 and pentatonic, Greensleeves in 6/8 and minor', () => {
    const arirang = PRESETS.find((p) => p.id === 'arirang')!;
    expect(arirang.time).toBe('3/4');
    const classes = new Set(
      arirang.melody.flatMap((m) => m.notes.filter((n) => !isRest(n.pitch)).map((n) => n.pitch.replace(/-?\d+$/, ''))),
    );
    expect([...classes].sort()).toEqual(['A', 'C', 'D', 'F', 'G']); // F major pentatonic

    const green = PRESETS.find((p) => p.id === 'greensleeves')!;
    expect(green.time).toBe('6/8');
    expect(green.key).toMatch(/m$/);
  });

  it('starts every pickup as a rest inside bar 1, never a short bar', () => {
    for (const p of PRESETS) {
      const first = p.melody[0];
      const lead = first.notes[0];
      // if bar 1 opens with a rest it is a pickup bar; it must still be complete
      if (isRest(lead.pitch)) expect(ticksOf(first)).toBe(TIME_TICKS[p.time as TimeSig]);
    }
  });
});
