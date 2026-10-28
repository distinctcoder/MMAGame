// Pure fight rules: no rendering, no timers. Random rolls are passed in so tests can pin them.
import type { BodyPart, EvadeKind, Position, Strike, Style, Zone } from '../data/types';

export type Rng = () => number;
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

export const ROUND_MS = 90000;
export const ROUNDS = 3;

export const LEVELS = {
  easy:   { def: -22, aggr: 0.6, react: 1.35, grap: -12 },
  normal: { def: 0,   aggr: 1,   react: 1,    grap: 0 },
  hard:   { def: 14,  aggr: 1.35, react: 0.8, grap: 10 }
};
export type Level = keyof typeof LEVELS;

/** Damage multiplier for [strike zone][block zone]. Missing entries mean the block did nothing. */
export const BLOCK_TABLE: Record<Zone, Partial<Record<Zone, number>>> = {
  high: { high: 0 }, left: { left: 0, high: 0.5 }, right: { right: 0, high: 0.5 }, body: { body: 0 }, low: { low: 0 }
};
/** A correctly blocked kick still lets this much through. */
export const KICK_THROUGH = 0.2;
/** A block raised this close to impact is a parry. */
export const PERFECT_PARRY_MS = 170;
export const PARRY_COUNTER = 1.5;
export const DODGE_COUNTER = 1.7;
export const COUNTER_WINDOW_MS = 900;
export const EVADED: Record<EvadeKind, string> = { slip_left: 'Slipped', slip_right: 'Slipped', duck: 'Ducked', sway: 'Swayed' };

export const POS_MULT: Record<Position, number> = { guard: 0.6, side: 1, mount: 1.25 };
export const NEXT: Partial<Record<Position, Position>> = { guard: 'side', side: 'mount' };
export const SWEEP: Record<Position, { name: string; to: Position; swap: boolean; bonus: number }> = {
  mount: { name: 'Upa sweep', to: 'guard', swap: true, bonus: 8 },
  guard: { name: 'Scissor sweep', to: 'mount', swap: true, bonus: 0 },
  side: { name: 'Guard recovery', to: 'guard', swap: false, bonus: 4 }
};

// ---------- Fighter condition ----------
export const headMax = (style: Style) => 80 + style.chin * 0.7;
export const maxStamina = (body: number) => 100 - body * 0.4;
export function staminaRegen(style: Style, body: number, idle: boolean, dtMs: number) {
  return dtMs / 1000 * 8 * (style.cardio / 70) * (1 - body / 200) * (idle ? 1 : 0.4);
}
export const rocked = (headHP: number) => headHP < 30;
export const speedMul = (style: Style, isRocked: boolean) => (1.25 - style.speed / 200) * (isRocked ? 1.15 : 1);

export interface Damageable { headHP: number; body: number; legs: number; sta: number }
export function applyDamage(f: Damageable, part: BodyPart, dmg: number) {
  if (part === 'head') f.headHP = Math.max(0, f.headHP - dmg);
  else if (part === 'body') { f.body = Math.min(100, f.body + dmg * 1.6); f.sta = Math.max(0, f.sta - dmg); }
  else f.legs = Math.min(100, f.legs + dmg * 1.5);
}
/** Which kind of finish this damage state is, if any. */
export function finishedBy(f: Damageable): 'head' | 'legs' | 'body' | null {
  return f.headHP <= 0 ? 'head' : f.legs >= 100 ? 'legs' : f.body >= 100 ? 'body' : null;
}

// ---------- Striking ----------
export interface WindupMods { rocked?: boolean; chained?: boolean; counter?: boolean; counterMul?: number; gassed?: boolean }
export function windupTime(s: Strike, style: Style, m: WindupMods = {}) {
  let w = s.windup * speedMul(style, !!m.rocked) * (s.kick ? 1.15 - style.kicks / 400 : 1);
  if (m.chained) w *= 0.8;
  if (m.counter) w *= (m.counterMul || PARRY_COUNTER) > PARRY_COUNTER ? 0.5 : 0.6;
  if (m.gassed) w *= 1.4;
  return w;
}
export const inRange = (s: Strike, dist: number) => dist >= s.range[0] - 6 && dist <= s.range[1];
export const blockWindow = (style: Style, levelDef = 0) => 380 + (style.defense + levelDef) * 1.5;
export function evadeWindow(style: Style, kind: EvadeKind, levelDef = 0) {
  return { active: 250 + style.evasion * 1.1 + levelDef, recover: kind === 'duck' ? 230 : 190 };
}
export const evadeCost = (kind: EvadeKind) => (kind === 'duck' ? 4 : 3);

export type Defense =
  | { type: 'none' }
  | { type: 'block'; zone: Zone; sinceMs: number }
  | { type: 'evade'; kind: EvadeKind; active: boolean };
export type DefenseResult = 'hit' | 'dodged' | 'grazed' | 'into' | 'blocked' | 'parried' | 'checked' | 'partial';
export interface DefenseOutcome { result: DefenseResult; mult: number; counterMul?: number }

/** How a defense changes an incoming strike: the damage multiplier, and whether the defender earns a counter. */
export function defend(s: Strike, d: Defense): DefenseOutcome {
  if (d.type === 'evade' && d.active) {
    const m = s.evade?.[d.kind];
    if (m === 0) return { result: 'dodged', mult: 0, counterMul: DODGE_COUNTER };
    if (m !== undefined) return { result: m > 1 ? 'into' : 'grazed', mult: m };
  }
  if (d.type === 'block') {
    const m = BLOCK_TABLE[s.zone][d.zone];
    if (m === 0) {
      if (s.zone === 'low') return { result: 'checked', mult: 0 };
      const perfect = d.sinceMs <= PERFECT_PARRY_MS;
      return { result: perfect ? 'parried' : 'blocked', mult: s.kick ? KICK_THROUGH : 0, counterMul: perfect ? PARRY_COUNTER : undefined };
    }
    if (m !== undefined) return { result: 'partial', mult: m };
  }
  return { result: 'hit', mult: 1 };
}

export interface DamageMods { counter?: boolean; counterMul?: number; gassed?: boolean }
/** Strike damage. roll in [0, 1) gives the plus or minus 10% spread. */
export function strikeDamage(s: Strike, style: Style, mult: number, m: DamageMods, roll: number) {
  let dmg = s.dmg * (0.6 + style.power / 100 * 0.6) * (s.kick ? 0.5 + style.kicks / 100 * 0.7 : 1) * (0.9 + roll * 0.2) * mult;
  if (m.counter) dmg *= m.counterMul || PARRY_COUNTER;
  if (m.gassed) dmg *= 0.6;
  return round1(dmg);
}
export const checkedKickDamage = 6;
export function knockdownCheck(part: BodyPart, dmg: number, headHP: number, max: number, roll: number) {
  return part === 'head' && dmg >= 9 && headHP < max * 0.4 && headHP > 0 && roll < 0.45;
}

// ---------- Contests (timing bar) ----------
export const timingWidth = (stat: number) => 0.1 + stat / 100 * 0.14;
export const timingQuality = (needle: number, center: number, width: number) => clamp(1 - Math.abs(needle - center) / (width * 1.5), 0, 1);
export const cpuTiming = (stat: number, roll: number) => clamp(0.15 + stat / 100 * 0.55 + (roll - 0.5) * 0.5, 0, 1);
/** Attacker minus defender. rollA and rollD in [0, 1) add up to 14 points of luck each. */
export function contestMargin(aStat: number, qa: number, dStat: number, qd: number, defBonus: number, rollA: number, rollD: number) {
  return (aStat * 0.6 + qa * 30 + rollA * 14) - (dStat * 0.6 + qd * 30 + rollD * 14 + defBonus);
}
export const LEVEL_CHANGE_STUFF = -10;
export function takedownOutcome(margin: number): 'sprawl' | Position {
  return margin < -15 ? 'sprawl' : margin < -3 ? 'guard' : margin < 15 ? 'side' : 'mount';
}
export const tripLanding = (margin: number): Position => (margin < 8 ? 'guard' : margin < 20 ? 'side' : 'mount');

// ---------- Ground and clinch ----------
export const gnpBlockChance = (def: Style, att: Style) => clamp(0.2 + def.guard / 200 - att.top / 400, 0.05, 0.7);
export const gnpDamage = (att: Style, pos: Position, roll: number) => round1((4 + att.power / 12) * POS_MULT[pos] * (0.85 + roll * 0.3));
export const clinchBlockChance = (def: Style, attackerHasTie: boolean, levelDef = 0) =>
  clamp(0.22 + def.defense / 260 - (attackerHasTie ? 0.08 : 0) + levelDef / 200, 0.05, 0.75);
export function clinchDamage(kind: 'knee' | 'elbow', att: Style, hasTie: boolean, roll: number) {
  const base = kind === 'knee' ? 9 * (0.6 + att.clinch / 100 * 0.6) : 8;
  return round1(base * (0.6 + att.power / 100 * 0.6) * (hasTie ? 1 : 0.65) * (0.9 + roll * 0.2));
}
export const subDefense = (def: Style, headHP: number, max: number) => Math.round((def.guard * 0.6 + def.top * 0.4) * (0.6 + 0.4 * headHP / max));
export const subTap = (stat: number) => 2 + stat / 30;
export const subCpuRate = (stat: number) => 5.5 + stat / 25;
export const subDrift = (attStat: number, defStat: number, dtSec: number) => dtSec * (attStat - defStat) / 100 * 6;
export const SUB_TIME_MS = 7000;

// ---------- Judging ----------
export function judgeRound(red: number, blue: number): [number, number] {
  return Math.abs(red - blue) < 3 ? [10, 10] : red > blue ? [10, 9] : [9, 10];
}
export function decision(cards: [number, number][]) {
  const red = cards.reduce((n, c) => n + c[0], 0), blue = cards.reduce((n, c) => n + c[1], 0);
  return { red, blue, winner: red === blue ? null : red > blue ? 'red' as const : 'blue' as const };
}
