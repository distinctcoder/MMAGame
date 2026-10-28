// Weight: what makes strikes feel heavy. The attacker loads back during the windup and drives through the strike
// with the hips (feet stay planted), the action freezes for a moment on impact (hit-stop), and the defender's head
// snaps away and springs back, or the body folds. Pure numbers here; fight.ts applies them to the poses.
import type { BodyPart } from '../data/types';
import type { DefenseResult } from './rules';

export interface StrikeWeight {
  /** cm the hips sink back while winding up, and drive forward at impact. */
  load: number; lunge: number;
  /** Degrees the hips turn at impact (the windup turns them the other way). Positive brings the rear side forward. */
  twist: number;
  /** cm the hips dip at impact (uppercuts and kicks sit down into it). */
  drop: number;
}
export const STRIKE_WEIGHT: Record<string, StrikeWeight> = {
  jab: { load: 2, lunge: 5, twist: -6, drop: 0 },
  cross: { load: 5, lunge: 8, twist: 14, drop: 1 },
  lead_hook: { load: 3, lunge: 3, twist: -16, drop: 2 },
  rear_hook: { load: 4, lunge: 4, twist: 16, drop: 2 },
  uppercut: { load: 3, lunge: 3, twist: 10, drop: 6 },
  low_kick: { load: 3, lunge: 2, twist: 14, drop: 2 },
  body_kick: { load: 4, lunge: 2, twist: 18, drop: 3 },
  head_kick: { load: 5, lunge: 1, twist: 22, drop: 4 }
};
const NONE: StrikeWeight = { load: 0, lunge: 0, twist: 0, drop: 0 };
export const weightOf = (key: string) => STRIKE_WEIGHT[key] || NONE;

const smooth = (u: number) => { const v = Math.max(0, Math.min(1, u)); return v * v * (3 - 2 * v); };

export interface StrikeTimes { phase: 'wind' | 'extend' | 'hold' | 'recover'; t0: number; tHit: number; tRecover: number; tEnd: number }
/**
 * Where the weight is, from -1 (loaded back) to 1 (driving through). Builds during the windup, whips to full drive
 * in the last moment before impact, holds, then eases off through the recovery.
 */
export function driveAmount(a: StrikeTimes, now: number): number {
  if (a.phase === 'wind') return -smooth((now - a.t0) / Math.max(1, a.tHit - 70 - a.t0));
  if (a.phase === 'extend') return -1 + 2 * smooth((now - (a.tHit - 70)) / 70);
  if (a.phase === 'hold') return 1;
  return 1 - smooth((now - a.tRecover) / Math.max(1, (a.tEnd - a.tRecover) * 0.8));
}

/** A struck head or body springs back past center once and settles: 1 at impact, decaying with a rebound. */
export const spring = (ms: number) => (ms < 0 ? 0 : Math.exp(-ms / 130) * Math.cos(ms * Math.PI * 2 / 300));
/** Knockback eases out without rebounding. */
export const settle = (ms: number) => (ms < 0 ? 0 : Math.exp(-ms / 200));

/** How long the action freezes on impact (ms of real time). Clean heavy shots freeze longest. */
export function hitStopMs(result: DefenseResult, dmg: number): number {
  if (result === 'dodged') return 0;
  if (result === 'parried') return 70;
  if (result === 'checked') return 55;
  if (result === 'blocked') return 35;
  return Math.max(40, Math.min(120, 30 + dmg * 5));
}
/** Very heavy shots also slow time for a moment after the freeze. */
export const SLOW_MO_DMG = 14;

export interface Reaction { snap: number; fold: number; push: number; shake: number }
/** How the defender moves: head snap and body fold in degrees, knockback in cm, and how hard the camera kicks. */
export function reaction(result: DefenseResult, part: BodyPart, dmg: number): Reaction {
  if (result === 'dodged') return { snap: 0, fold: 0, push: 0, shake: 0 };
  if (result === 'blocked' || result === 'parried' || result === 'checked')
    return { snap: 3, fold: part === 'body' ? 4 : 0, push: 3, shake: 2 };
  const hard = Math.min(1, dmg / 16);
  return {
    snap: part === 'head' ? 6 + 20 * hard : 3,
    fold: part === 'body' ? 8 + 16 * hard : part === 'legs' ? 4 : 0,
    push: dmg >= 4 ? 3 + 9 * hard : 1,
    shake: 2 + 10 * hard
  };
}
