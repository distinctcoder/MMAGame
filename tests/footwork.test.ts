// Footwork and free-form defense rules: range sweet spots, angles, the lead foot, planted punches,
// a guard held across zones, and head movement that counts as far as the head has moved.
import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { evadeMult, footwork, guardMult, resolveDefense, type Footing } from '../src/fight/rules';

const S = SD.strikes;
const base: Footing = { dist: 0, attErr: 0, defErr: 0, side: 0, planted: false, backing: false };
const at = (key: string, frac: number) => S[key].range[0] + (S[key].range[1] - S[key].range[0]) * frac;

describe('footwork', () => {
  it('hits hardest a little inside full reach; reaching or jammed loses power', () => {
    const ideal = footwork('cross', S.cross, { ...base, dist: at('cross', 0.7) }).dmg;
    const reach = footwork('cross', S.cross, { ...base, dist: at('cross', 1) }).dmg;
    const jam = footwork('cross', S.cross, { ...base, dist: at('cross', 0) }).dmg;
    expect(ideal).toBeCloseTo(1, 5);
    expect(reach).toBeLessThan(ideal);
    expect(jam).toBeLessThan(reach);
    expect(jam).toBeGreaterThanOrEqual(0.7);
  });
  it('rewards the angle: more damage and blocks leak, and names it', () => {
    const m = footwork('jab', S.jab, { ...base, dist: at('jab', 0.7), defErr: 35 });
    expect(m.dmg).toBeGreaterThan(1.15);
    expect(m.leak).toBeGreaterThan(0.4);
    expect(m.tags).toContain('Angle');
  });
  it('punishes throwing while turned away, and misses entirely when far off', () => {
    expect(footwork('jab', S.jab, { ...base, dist: at('jab', 0.7), attErr: 35 }).dmg).toBeLessThan(0.85);
    expect(footwork('jab', S.jab, { ...base, dist: at('jab', 0.7), attErr: 60 }).offTarget).toBe(true);
  });
  it('lines up the rear hand from outside the lead foot, and costs it from inside', () => {
    const d = at('cross', 0.7);
    const out = footwork('cross', S.cross, { ...base, dist: d, side: 25 });
    const inside = footwork('cross', S.cross, { ...base, dist: d, side: -25 });
    expect(out.dmg).toBeGreaterThan(1.1);
    expect(out.tags).toContain('Outside foot');
    expect(inside.dmg).toBeLessThan(1);
    // The lead hand prefers the inside.
    expect(footwork('lead_hook', S.lead_hook, { ...base, dist: at('lead_hook', 0.7), side: -25 }).dmg).toBeGreaterThan(1);
  });
  it('adds power off a planted lead foot and takes it away on the back foot', () => {
    const d = at('cross', 0.7);
    expect(footwork('cross', S.cross, { ...base, dist: d, planted: true }).dmg).toBeGreaterThan(1.1);
    expect(footwork('cross', S.cross, { ...base, dist: d, backing: true }).dmg).toBeLessThan(0.85);
  });
});

describe('free-form defense', () => {
  it('counts head movement by how far the head moved', () => {
    expect(evadeMult(S.jab, { x: -1, y: 0 })).toBe(0);
    const half = evadeMult(S.jab, { x: -0.5, y: 0 });
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.9);
    expect(evadeMult(S.jab, { x: 0, y: 0 })).toBe(1);
  });
  it('lets a bob and weave clear a hook even though the slip alone walks into it', () => {
    expect(evadeMult(S.lead_hook, { x: 1, y: 0 })).toBeGreaterThan(1);
    expect(evadeMult(S.lead_hook, { x: 1, y: -1 })).toBe(0);
  });
  it('blends the guard across zones', () => {
    expect(guardMult(S.jab, { high: 1 })).toBe(0);
    expect(guardMult(S.jab, { high: 0.5 })).toBeCloseTo(0.5, 5);
    expect(guardMult(S.jab, { body: 1 })).toBe(1);
    expect(guardMult(S.lead_hook, { high: 1 })).toBe(0.5);
  });
  it('resolves blocks, parries, checks, dodges, grazes and leaning into it', () => {
    expect(resolveDefense(S.jab, { high: 0.9 }, { x: 0, y: 0 }, false).result).toBe('blocked');
    expect(resolveDefense(S.jab, { high: 0.9 }, { x: 0, y: 0 }, true).result).toBe('parried');
    expect(resolveDefense(S.low_kick, { low: 0.9 }, { x: 0, y: 0 }, false).result).toBe('checked');
    expect(resolveDefense(S.cross, {}, { x: 1, y: 0 }, false)).toMatchObject({ result: 'dodged', mult: 0 });
    expect(resolveDefense(S.cross, {}, { x: 0.5, y: 0 }, false).result).toBe('grazed');
    expect(resolveDefense(S.uppercut, {}, { x: 0, y: -1 }, false).result).toBe('into');
    expect(resolveDefense(S.jab, {}, { x: 0, y: 0 }, false)).toEqual({ result: 'hit', mult: 1 });
    // A kick blocked in the right zone still lets some through.
    expect(resolveDefense(S.body_kick, { body: 1 }, { x: 0, y: 0 }, false).mult).toBeGreaterThan(0);
  });
});
