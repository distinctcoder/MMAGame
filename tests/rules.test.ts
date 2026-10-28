import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import * as R from '../src/fight/rules';

const S = SD.strikes, mma = SD.styles.mma;
const block = (zone: 'high' | 'left' | 'right' | 'body' | 'low', sinceMs = 400): R.Defense => ({ type: 'block', zone, sinceMs });
const evade = (kind: 'slip_left' | 'slip_right' | 'duck' | 'sway', active = true): R.Defense => ({ type: 'evade', kind, active });

describe('blocking', () => {
  it('stops straights with the high guard', () => {
    expect(R.defend(S.jab, block('high'))).toEqual({ result: 'blocked', mult: 0, counterMul: undefined });
    expect(R.defend(S.cross, block('high')).mult).toBe(0);
  });
  it('needs the matching side for hooks; a high guard catches half', () => {
    expect(R.defend(S.lead_hook, block('right')).mult).toBe(0);
    expect(R.defend(S.lead_hook, block('high'))).toEqual({ result: 'partial', mult: 0.5 });
    expect(R.defend(S.lead_hook, block('left'))).toEqual({ result: 'hit', mult: 1 });
    expect(R.defend(S.rear_hook, block('left')).mult).toBe(0);
  });
  it('lets some of a correctly blocked kick through', () => {
    expect(R.defend(S.body_kick, block('body')).mult).toBe(R.KICK_THROUGH);
    expect(R.defend(S.head_kick, block('left')).mult).toBe(R.KICK_THROUGH);
  });
  it('checks low kicks completely', () => {
    expect(R.defend(S.low_kick, block('low'))).toEqual({ result: 'checked', mult: 0 });
  });
  it('turns a late block into a parry with a counter', () => {
    const late = R.defend(S.jab, block('high', R.PERFECT_PARRY_MS));
    expect(late.result).toBe('parried');
    expect(late.counterMul).toBe(R.PARRY_COUNTER);
    expect(R.defend(S.jab, block('high', R.PERFECT_PARRY_MS + 1)).result).toBe('blocked');
  });
});

describe('head movement', () => {
  it('makes straights miss with any slip, duck or sway', () => {
    for (const k of ['slip_left', 'slip_right', 'duck', 'sway'] as const) {
      expect(R.defend(S.jab, evade(k))).toEqual({ result: 'dodged', mult: 0, counterMul: R.DODGE_COUNTER });
    }
  });
  it('punishes slipping into a hook and ducking into an uppercut or body kick', () => {
    expect(R.defend(S.lead_hook, evade('slip_right'))).toEqual({ result: 'into', mult: 1.3 });
    expect(R.defend(S.uppercut, evade('duck'))).toEqual({ result: 'into', mult: 1.4 });
    expect(R.defend(S.body_kick, evade('duck')).result).toBe('into');
  });
  it('takes half a hook on a sway back', () => {
    expect(R.defend(S.rear_hook, evade('sway'))).toEqual({ result: 'grazed', mult: 0.5 });
  });
  it('does nothing against a low kick, or once the window has closed', () => {
    expect(R.defend(S.low_kick, evade('duck')).result).toBe('hit');
    expect(R.defend(S.jab, evade('slip_left', false)).result).toBe('hit');
  });
  it('earns a faster, stronger counter than a parry', () => {
    expect(R.DODGE_COUNTER).toBeGreaterThan(R.PARRY_COUNTER);
    const base = R.windupTime(S.cross, mma);
    expect(R.windupTime(S.cross, mma, { counter: true, counterMul: R.DODGE_COUNTER })).toBeCloseTo(base * 0.5);
    expect(R.windupTime(S.cross, mma, { counter: true, counterMul: R.PARRY_COUNTER })).toBeCloseTo(base * 0.6);
  });
});

describe('damage and timing', () => {
  it('scales strike damage with power, spread and modifiers', () => {
    const plain = R.strikeDamage(S.cross, mma, 1, {}, 0.5);
    expect(plain).toBeCloseTo(S.cross.dmg * (0.6 + mma.power / 100 * 0.6), 1);
    expect(R.strikeDamage(S.cross, mma, 1, { counter: true, counterMul: 1.5 }, 0.5)).toBeCloseTo(plain * 1.5, 0);
    expect(R.strikeDamage(S.cross, mma, 1, { gassed: true }, 0.5)).toBeCloseTo(plain * 0.6, 0);
    expect(R.strikeDamage(S.cross, mma, 0, {}, 0.5)).toBe(0);
  });
  it('makes faster styles throw sooner and gassed fighters throw later', () => {
    expect(R.windupTime(S.jab, SD.styles.boxing)).toBeLessThan(R.windupTime(S.jab, SD.styles.bjj));
    expect(R.windupTime(S.jab, mma, { gassed: true })).toBeCloseTo(R.windupTime(S.jab, mma) * 1.4);
    expect(R.windupTime(S.jab, mma, { rocked: true })).toBeGreaterThan(R.windupTime(S.jab, mma));
  });
  it('lands strikes only inside their range', () => {
    expect(R.inRange(S.lead_hook, 70)).toBe(true);
    expect(R.inRange(S.lead_hook, 110)).toBe(false);
    expect(R.inRange(S.head_kick, 40)).toBe(false);
  });
  it('applies damage to the right body part', () => {
    const f = { headHP: 100, body: 0, legs: 0, sta: 100 };
    R.applyDamage(f, 'head', 10); R.applyDamage(f, 'body', 10); R.applyDamage(f, 'legs', 10);
    expect(f).toEqual({ headHP: 90, body: 16, legs: 15, sta: 90 });
    expect(R.finishedBy({ headHP: 0, body: 0, legs: 0, sta: 0 })).toBe('head');
    expect(R.finishedBy({ headHP: 50, body: 0, legs: 100, sta: 0 })).toBe('legs');
    expect(R.finishedBy({ headHP: 50, body: 20, legs: 20, sta: 0 })).toBeNull();
  });
  it('only knocks down a hurt fighter with a big head shot', () => {
    expect(R.knockdownCheck('head', 12, 30, 120, 0.1)).toBe(true);
    expect(R.knockdownCheck('head', 12, 90, 120, 0.1)).toBe(false);
    expect(R.knockdownCheck('body', 12, 30, 120, 0.1)).toBe(false);
    expect(R.knockdownCheck('head', 5, 30, 120, 0.1)).toBe(false);
  });
});

describe('contests', () => {
  it('rewards timing: a centered press is perfect, far off is zero', () => {
    expect(R.timingQuality(0.5, 0.5, 0.2)).toBe(1);
    expect(R.timingQuality(0.9, 0.5, 0.2)).toBe(0);
  });
  it('maps takedown margins to outcomes', () => {
    expect(R.takedownOutcome(-20)).toBe('sprawl');
    expect(R.takedownOutcome(-10)).toBe('guard');
    expect(R.takedownOutcome(5)).toBe('side');
    expect(R.takedownOutcome(20)).toBe('mount');
  });
  it('favors the better stat with equal timing and luck', () => {
    expect(R.contestMargin(90, 0.5, 40, 0.5, 0, 0.5, 0.5)).toBeGreaterThan(0);
    expect(R.contestMargin(50, 0.5, 50, 0.5, 6, 0.5, 0.5)).toBe(-6);
  });
  it('gives a wrestler better takedown odds against a boxer than the reverse', () => {
    const w = SD.styles.wrestling, b = SD.styles.boxing;
    expect(R.contestMargin(w.takedowns, 0.5, b.td_defense, 0.5, 0, 0.5, 0.5)).toBeGreaterThan(R.contestMargin(b.takedowns, 0.5, w.td_defense, 0.5, 0, 0.5, 0.5));
  });
});

describe('ground, clinch and judging', () => {
  it('hits hardest from mount and softest from guard', () => {
    expect(R.gnpDamage(mma, 'mount', 0.5)).toBeGreaterThan(R.gnpDamage(mma, 'side', 0.5));
    expect(R.gnpDamage(mma, 'side', 0.5)).toBeGreaterThan(R.gnpDamage(mma, 'guard', 0.5));
  });
  it('makes clinch strikes stronger with the tie', () => {
    expect(R.clinchDamage('knee', SD.styles.muay_thai, true, 0.5)).toBeGreaterThan(R.clinchDamage('knee', SD.styles.muay_thai, false, 0.5));
  });
  it('defends submissions worse when hurt', () => {
    expect(R.subDefense(mma, 20, 100)).toBeLessThan(R.subDefense(mma, 100, 100));
  });
  it('scores close rounds even and decides on the cards', () => {
    expect(R.judgeRound(30, 28)).toEqual([10, 10]);
    expect(R.judgeRound(40, 20)).toEqual([10, 9]);
    expect(R.judgeRound(10, 30)).toEqual([9, 10]);
    expect(R.decision([[10, 9], [9, 10], [10, 9]])).toEqual({ red: 29, blue: 28, winner: 'red' });
    expect(R.decision([[10, 10], [10, 10], [10, 10]]).winner).toBeNull();
  });
});
