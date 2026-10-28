// Park progress: cash, rep, training levels and gear. Pure functions over ParkState; nothing here touches the DOM.
import { STATS, type Boost, type Stat } from '../fight/rules';
import type { Palette } from '../rig/stage';
import {
  CLASS_PRICE_PER_LEVEL, DRAW_PURSE, DRAW_REP, FIRST_WIN_BONUS, GEAR_BY_ID, LOSS_PURSE, LOSS_REP, MAX_LEVEL, REP_TITLES,
  SLOTS, STARTER_GEAR, START_CASH, STAT_PER_LEVEL, xpToNext, type GymClass, type ParkFighter, type Slot
} from './data';

export interface ParkState {
  cash: number;
  rep: number;
  /** Total XP earned per stat. */
  xp: Partial<Record<Stat, number>>;
  owned: string[];
  equipped: Record<Slot, string>;
  /** Park fighters you have beaten at least once. */
  beaten: string[];
  king: boolean;
}

export function defaultPark(): ParkState {
  return { cash: START_CASH, rep: 0, xp: {}, owned: Object.values(STARTER_GEAR), equipped: { ...STARTER_GEAR }, beaten: [], king: false };
}

/** Fill in anything missing from an older or damaged save. */
export function normalizePark(saved: Partial<ParkState> | undefined): ParkState {
  const base = defaultPark();
  if (!saved || typeof saved !== 'object') return base;
  const owned = Array.isArray(saved.owned) ? saved.owned.filter(id => GEAR_BY_ID[id]) : [];
  const equipped = { ...base.equipped };
  for (const slot of SLOTS) {
    const id = saved.equipped?.[slot];
    if (id && GEAR_BY_ID[id]?.slot === slot) equipped[slot] = id;
  }
  return {
    cash: Number.isFinite(saved.cash) ? Math.max(0, saved.cash!) : base.cash,
    rep: Number.isFinite(saved.rep) ? Math.max(0, saved.rep!) : 0,
    xp: { ...saved.xp },
    owned: [...new Set([...base.owned, ...owned, ...Object.values(equipped)])],
    equipped,
    beaten: Array.isArray(saved.beaten) ? saved.beaten : [],
    king: !!saved.king
  };
}

export interface LevelInfo { level: number; into: number; need: number; max: boolean }
/** Turn total XP into a level and the progress toward the next one. */
export function levelOf(xp = 0): LevelInfo {
  let level = 0, rest = Math.max(0, xp);
  while (level < MAX_LEVEL && rest >= xpToNext(level)) { rest -= xpToNext(level); level++; }
  if (level >= MAX_LEVEL) return { level, into: 0, need: 0, max: true };
  return { level, into: rest, need: xpToNext(level), max: false };
}

export interface XpGain { stat: Stat; xp: number; from: number; to: number }
/** Split XP evenly across the stats. XP past the max level is not stored. */
export function addXp(p: ParkState, stats: Stat[], amount: number): { park: ParkState; gains: XpGain[] } {
  const xp = { ...p.xp }, gains: XpGain[] = [];
  const each = Math.round(amount / Math.max(1, stats.length));
  if (each <= 0) return { park: p, gains };
  for (const stat of stats) {
    const before = levelOf(xp[stat]);
    if (before.max) continue;
    xp[stat] = (xp[stat] || 0) + each;
    gains.push({ stat, xp: each, from: before.level, to: levelOf(xp[stat]).level });
  }
  return { park: { ...p, xp }, gains };
}

/** All stat points your fighter gets in park fights: training levels plus equipped gear. */
export function boosts(p: ParkState): Boost {
  const out: Boost = {};
  for (const stat of STATS) {
    const lv = levelOf(p.xp[stat]).level * STAT_PER_LEVEL;
    if (lv) out[stat] = lv;
  }
  for (const slot of SLOTS) {
    for (const [stat, n] of Object.entries(GEAR_BY_ID[p.equipped[slot]]?.boost || {}) as [Stat, number][]) out[stat] = (out[stat] || 0) + n;
  }
  return out;
}

/** Your fighter's outfit colors from the equipped gear. */
export function gearPalette(p: ParkState, base: Palette): Palette {
  const pal = { ...base };
  for (const slot of SLOTS) Object.assign(pal, GEAR_BY_ID[p.equipped[slot]]?.colors);
  return pal;
}

export type Refusal = 'cash' | 'rep' | 'owned' | 'missing' | 'maxed';
export type Result = { ok: true; park: ParkState } | { ok: false; why: Refusal };

export function buyGear(p: ParkState, id: string): Result {
  const g = GEAR_BY_ID[id];
  if (!g) return { ok: false, why: 'missing' };
  if (p.owned.includes(id)) return { ok: false, why: 'owned' };
  if ((g.rep || 0) > p.rep) return { ok: false, why: 'rep' };
  if (g.price > p.cash) return { ok: false, why: 'cash' };
  return { ok: true, park: { ...p, cash: p.cash - g.price, owned: [...p.owned, id], equipped: { ...p.equipped, [g.slot]: id } } };
}

export function equip(p: ParkState, id: string): Result {
  const g = GEAR_BY_ID[id];
  if (!g) return { ok: false, why: 'missing' };
  if (!p.owned.includes(id)) return { ok: false, why: 'missing' };
  return { ok: true, park: { ...p, equipped: { ...p.equipped, [g.slot]: id } } };
}

export function classPrice(p: ParkState, c: GymClass): number {
  const avg = c.stats.reduce((n, s) => n + levelOf(p.xp[s]).level, 0) / c.stats.length;
  return Math.round(c.price + CLASS_PRICE_PER_LEVEL * avg);
}

export function takeClass(p: ParkState, c: GymClass): { ok: true; park: ParkState; gains: XpGain[] } | { ok: false; why: Refusal } {
  if (c.stats.every(s => levelOf(p.xp[s]).max)) return { ok: false, why: 'maxed' };
  const price = classPrice(p, c);
  if (price > p.cash) return { ok: false, why: 'cash' };
  const { park, gains } = addXp({ ...p, cash: p.cash - price }, c.stats, c.xp);
  return { ok: true, park, gains };
}

export const canChallenge = (p: ParkState, f: ParkFighter) => p.rep >= f.rep;

export interface Payout { cash: number; rep: number; first: boolean; king: boolean }
/** What a pickup fight pays. A first win over someone pays a bonus; beating The King takes the court. */
export function payout(p: ParkState, f: ParkFighter, result: 'win' | 'loss' | 'draw'): Payout {
  if (result === 'win') {
    const first = !p.beaten.includes(f.id);
    return { cash: Math.round(f.purse * (first ? 1 + FIRST_WIN_BONUS : 1)), rep: f.repWin, first, king: f.id === 'king' };
  }
  if (result === 'draw') return { cash: Math.round(f.purse * DRAW_PURSE), rep: DRAW_REP, first: false, king: false };
  return { cash: Math.round(f.purse * LOSS_PURSE), rep: LOSS_REP, first: false, king: false };
}

export function applyFight(p: ParkState, f: ParkFighter, result: 'win' | 'loss' | 'draw'): { park: ParkState; pay: Payout } {
  const pay = payout(p, f, result);
  const beaten = result === 'win' && !p.beaten.includes(f.id) ? [...p.beaten, f.id] : p.beaten;
  return { park: { ...p, cash: p.cash + pay.cash, rep: p.rep + pay.rep, beaten, king: p.king || pay.king }, pay };
}

export function repTitle(p: ParkState): string {
  if (p.king) return 'King of the Court';
  let title = REP_TITLES[0][1];
  for (const [need, name] of REP_TITLES) if (p.rep >= need) title = name;
  return title;
}
