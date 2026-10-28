// The weight of a strike: load and drive timing, the reaction spring, hit-stop and how hard each result lands.
import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { driveAmount, hitStopMs, reaction, spring, STRIKE_WEIGHT } from '../src/fight/weight';

describe('weight', () => {
  it('has weight for every strike', () => {
    for (const k of Object.keys(SD.strikes)) expect(STRIKE_WEIGHT[k], k).toBeDefined();
  });

  it('loads back through the windup, whips through at impact, and lets go during recovery', () => {
    const a = { t0: 0, tHit: 400, tRecover: 460, tEnd: 800 };
    expect(driveAmount({ ...a, phase: 'wind' }, 0)).toBeCloseTo(0, 5);
    expect(driveAmount({ ...a, phase: 'wind' }, 330)).toBeCloseTo(-1, 5);
    expect(driveAmount({ ...a, phase: 'extend' }, 330)).toBeCloseTo(-1, 5);
    expect(driveAmount({ ...a, phase: 'extend' }, 400)).toBeCloseTo(1, 5);
    expect(driveAmount({ ...a, phase: 'hold' }, 430)).toBe(1);
    expect(driveAmount({ ...a, phase: 'recover' }, 800)).toBeCloseTo(0, 5);
  });

  it('springs back past center once and settles', () => {
    expect(spring(0)).toBe(1);
    expect(spring(150)).toBeLessThan(0);
    expect(Math.abs(spring(800))).toBeLessThan(0.01);
  });

  it('freezes longer for heavier clean shots, briefly for blocks, never for a dodge', () => {
    expect(hitStopMs('hit', 16)).toBeGreaterThan(hitStopMs('hit', 5));
    expect(hitStopMs('hit', 100)).toBeLessThanOrEqual(120);
    expect(hitStopMs('blocked', 10)).toBeLessThan(hitStopMs('hit', 10));
    expect(hitStopMs('parried', 10)).toBeGreaterThan(hitStopMs('blocked', 10));
    expect(hitStopMs('dodged', 10)).toBe(0);
  });

  it('snaps the head on head shots, folds the body on body shots, and barely moves a blocked fighter', () => {
    const head = reaction('hit', 'head', 14), body = reaction('hit', 'body', 14), block = reaction('blocked', 'head', 14);
    expect(head.snap).toBeGreaterThan(body.snap);
    expect(body.fold).toBeGreaterThan(head.fold);
    expect(block.snap).toBeLessThan(head.snap);
    expect(reaction('hit', 'head', 16).push).toBeGreaterThan(reaction('hit', 'head', 5).push);
    expect(reaction('dodged', 'head', 16)).toEqual({ snap: 0, fold: 0, push: 0, shake: 0 });
  });
});
