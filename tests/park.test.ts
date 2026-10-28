// Park progress: levels, XP, gear, classes, pickup payouts, save repair, and the data the park refers to.
import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { STAT_CAP, STATS, withBoost } from '../src/fight/rules';
import {
  CLASSES, DRILL_TRAINS, GEAR, GEAR_BY_ID, MAX_LEVEL, PARK_FIGHTERS, SLOTS, STARTER_GEAR, START_CASH, STAT_PER_LEVEL, xpToNext
} from '../src/park/data';
import {
  addXp, applyFight, boosts, buyGear, canChallenge, classPrice, defaultPark, equip, levelOf, normalizePark, payout, repTitle, takeClass,
  type ParkState
} from '../src/park/progress';
import { walkSpec } from '../src/park/walk';
import { LIMBS } from '../src/rig/math';
import { resolveStand } from '../src/rig/poses';
import { DRILLS } from '../src/training/drills';

describe('park data', () => {
  it('refers only to real styles, drills and gear', () => {
    for (const f of PARK_FIGHTERS) expect(SD.styles[f.style], f.id).toBeDefined();
    for (const id of Object.keys(DRILL_TRAINS)) expect(DRILLS[id as keyof typeof DRILLS], id).toBeDefined();
    for (const slot of SLOTS) expect(GEAR_BY_ID[STARTER_GEAR[slot]].slot).toBe(slot);
    for (const g of GEAR) for (const s of Object.keys(g.boost)) expect(STATS).toContain(s);
    for (const c of CLASSES) for (const s of c.stats) expect(STATS).toContain(s);
  });
  it('orders the ladder by rep, and starter gear is free', () => {
    for (let i = 1; i < PARK_FIGHTERS.length; i++) expect(PARK_FIGHTERS[i].rep).toBeGreaterThanOrEqual(PARK_FIGHTERS[i - 1].rep);
    expect(PARK_FIGHTERS.some(f => f.rep === 0)).toBe(true);
    for (const id of Object.values(STARTER_GEAR)) expect(GEAR_BY_ID[id].price).toBe(0);
  });
});

describe('levels and XP', () => {
  it('turns XP into levels with growing costs, and stops at the max', () => {
    expect(levelOf(0)).toEqual({ level: 0, into: 0, need: xpToNext(0), max: false });
    expect(levelOf(xpToNext(0)).level).toBe(1);
    expect(levelOf(xpToNext(0) + 5)).toMatchObject({ level: 1, into: 5 });
    expect(levelOf(1e9)).toMatchObject({ level: MAX_LEVEL, max: true });
  });
  it('splits XP between stats and reports level-ups', () => {
    const { park, gains } = addXp(defaultPark(), ['speed', 'power'], 240);
    expect(park.xp).toEqual({ speed: 120, power: 120 });
    expect(gains.map(g => [g.stat, g.from, g.to])).toEqual([['speed', 0, 1], ['power', 0, 1]]);
  });
  it('does not store XP for a maxed stat', () => {
    const p = { ...defaultPark(), xp: { cardio: 1e6 } };
    expect(addXp(p, ['cardio'], 500).gains).toEqual([]);
  });
});

describe('boosts and gear', () => {
  it('adds training levels and equipped gear', () => {
    let p: ParkState = { ...defaultPark(), cash: 10000, xp: { power: xpToNext(0) + xpToNext(1) } };
    const r = buyGear(p, 'gloves_red');
    expect(r.ok).toBe(true);
    if (r.ok) p = r.park;
    expect(boosts(p).power).toBe(2 * STAT_PER_LEVEL + 2);
  });
  it('refuses gear you cannot afford, already own, or have not earned the rep for', () => {
    expect(buyGear(defaultPark(), 'gloves_red')).toEqual({ ok: false, why: 'cash' });
    expect(buyGear({ ...defaultPark(), cash: 1e5 }, 'gloves_gold')).toEqual({ ok: false, why: 'rep' });
    expect(buyGear(defaultPark(), 'gloves_basic')).toEqual({ ok: false, why: 'owned' });
  });
  it('buys, wears, and swaps back to owned gear', () => {
    const r = buyGear({ ...defaultPark(), cash: 500 }, 'shorts_thai');
    expect(r.ok && r.park.equipped.shorts).toBe('shorts_thai');
    expect(r.ok && r.park.cash).toBe(200);
    if (!r.ok) return;
    const back = equip(r.park, 'shorts_basic');
    expect(back.ok && back.park.equipped.shorts).toBe('shorts_basic');
    expect(equip(defaultPark(), 'shorts_thai').ok).toBe(false);
  });
  it('caps boosted stats in the fight', () => {
    const s = withBoost(SD.styles.muay_thai, { kicks: 50, power: 1 });
    expect(s.kicks).toBe(STAT_CAP);
    expect(s.power).toBe(SD.styles.muay_thai.power + 1);
    expect(withBoost(SD.styles.mma)).toBe(SD.styles.mma);
  });
});

describe('gym classes', () => {
  it('charges more as you level, and pays out XP', () => {
    const c = CLASSES.find(k => k.id === 'roadwork')!;
    const p = defaultPark();
    const r = takeClass(p, c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.park.cash).toBe(START_CASH - c.price);
    expect(r.park.xp.cardio).toBe(c.xp);
    expect(classPrice(r.park, c)).toBeGreaterThan(c.price);
    expect(takeClass({ ...p, cash: 0 }, c)).toEqual({ ok: false, why: 'cash' });
  });
});

describe('pickup fights', () => {
  const dex = PARK_FIGHTERS[0], king = PARK_FIGHTERS[PARK_FIGHTERS.length - 1];
  it('pays a first-win bonus once', () => {
    const first = applyFight(defaultPark(), dex, 'win');
    expect(first.pay).toMatchObject({ first: true, rep: dex.repWin });
    expect(first.pay.cash).toBeGreaterThan(dex.purse);
    expect(payout(first.park, dex, 'win')).toMatchObject({ first: false, cash: dex.purse });
    expect(first.park.beaten).toEqual([dex.id]);
  });
  it('still pays something for a loss or a draw', () => {
    expect(payout(defaultPark(), dex, 'loss').cash).toBeGreaterThan(0);
    expect(payout(defaultPark(), dex, 'draw').rep).toBeGreaterThan(payout(defaultPark(), dex, 'loss').rep);
  });
  it('locks fighters behind rep, and crowns you for beating The King', () => {
    expect(canChallenge(defaultPark(), king)).toBe(false);
    const p = applyFight({ ...defaultPark(), rep: king.rep }, king, 'win').park;
    expect(p.king).toBe(true);
    expect(repTitle(p)).toBe('King of the Court');
  });
});

describe('saves', () => {
  it('repairs missing or bad park data', () => {
    expect(normalizePark(undefined)).toEqual(defaultPark());
    const p = normalizePark({ cash: -5, owned: ['nope', 'gloves_red'], equipped: { gloves: 'shorts_thai' } as never });
    expect(p.cash).toBe(0);
    expect(p.owned).toContain('gloves_red');
    expect(p.owned).not.toContain('nope');
    expect(p.equipped.gloves).toBe('gloves_basic');
  });
});

describe('walk poses', () => {
  it('solve to finite numbers through the cycle', () => {
    for (let i = 0; i < 12; i++) {
      const st = resolveStand(walkSpec(i * 0.6, i % 3 / 2, Math.sin(i)), { x: 0, z: 0, yaw: 90 }, null);
      for (const v of [st.P, ...LIMBS.flatMap(L => [st.t[L.k], st.p[L.k]])]) expect([v.x, v.y, v.z].every(Number.isFinite)).toBe(true);
    }
  });
});
