// Drill scoring: turns fight events into points, streaks and progress. Pure, so it is unit-tested.
import type { FightEvent } from '../fight/fight';
import { COMBO_GAP_MS, COMBOS, type Drill, type Outcome } from './drills';

export interface ComboState { i: number; idx: number; lastAt: number; done: number }
export interface Session {
  drill: Drill;
  score: number;
  count: number;
  streak: number;
  bestStreak: number;
  tally: Partial<Record<Outcome, number>>;
  /** Sparring stats: your strikes thrown and landed, their strikes faced and stopped. */
  thrown: number; landed: number; faced: number; stopped: number;
  combo: ComboState | null;
  started: number;
  over: boolean;
}
export interface Award { points: number; label: string; good: boolean }

/** Outcomes that count as a successful defense and keep a streak going. */
const GOOD = new Set<Outcome>(['dodged', 'parried', 'blocked', 'checked', 'stuffed', 'sprawl']);
const LANDED = new Set<Outcome>(['hit', 'into', 'partial', 'grazed']);
export const OUTCOME_LABEL: Record<Outcome, string> = {
  parried: 'Parry', checked: 'Checked', blocked: 'Blocked', dodged: 'Dodged', partial: 'Partly blocked', grazed: 'Grazed',
  into: 'Moved into it', hit: 'Hit', whiff: 'Out of range', stuffed: 'Read the shot', sprawl: 'Sprawled',
  guard: 'Taken down to guard', side: 'Taken down', mount: 'Taken down to mount'
};
export const STREAK_BONUS = 10;
export const STREAK_CAP = 10;

export function newSession(drill: Drill, now: number): Session {
  return {
    drill, score: 0, count: 0, streak: 0, bestStreak: 0, tally: {}, thrown: 0, landed: 0, faced: 0, stopped: 0,
    combo: drill.kind === 'combo' ? { i: 0, idx: 0, lastAt: 0, done: 0 } : null, started: now, over: false
  };
}

export function handleEvent(s: Session, e: FightEvent, now: number): Award | null {
  if (s.over) return null;
  const d = s.drill;
  if (e.type === 'throw') { if (e.attacker === 'red') s.thrown++; return null; }
  if (e.type === 'takedown') return e.attacker === 'blue' && d.kind === 'takedown' ? award(s, e.outcome) : null;
  if (e.attacker === 'red') {
    if (LANDED.has(e.result)) s.landed++;
    return d.kind === 'combo' ? comboStep(s, e.key, e.result, now) : null;
  }
  s.faced++;
  if (GOOD.has(e.result)) s.stopped++;
  return d.kind === 'defense' ? award(s, e.result) : null;
}

function award(s: Session, outcome: Outcome): Award {
  const good = GOOD.has(outcome);
  s.streak = good ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  const bonus = good ? Math.min(s.streak - 1, STREAK_CAP) * STREAK_BONUS : 0;
  const points = Math.round(((s.drill.points?.[outcome] ?? 0) + bonus) * (s.drill.mult ?? 1));
  s.score += points;
  s.count++;
  s.tally[outcome] = (s.tally[outcome] ?? 0) + 1;
  if (s.drill.count && s.count >= s.drill.count) s.over = true;
  return { points, label: OUTCOME_LABEL[outcome], good };
}

export function currentCombo(s: Session) {
  return s.combo ? { seq: COMBOS[s.combo.i % COMBOS.length], idx: s.combo.idx } : null;
}

function comboStep(s: Session, key: string, result: Outcome, now: number): Award | null {
  const c = s.combo!, seq = COMBOS[c.i % COMBOS.length];
  const landed = result !== 'whiff' && result !== 'dodged';
  if (landed && key === seq[c.idx] && (c.idx === 0 || now - c.lastAt <= COMBO_GAP_MS)) {
    c.idx++; c.lastAt = now;
    if (c.idx < seq.length) return null;
    const points = 100 * seq.length;
    s.score += points; s.count++; c.done++; c.i++; c.idx = 0;
    s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak);
    return { points, label: 'Combo!', good: true };
  }
  // Wrong strike, a miss, or too slow: the chain breaks. The strike may start the combo over.
  const broke = c.idx > 0;
  c.idx = landed && key === seq[0] ? 1 : 0;
  c.lastAt = now;
  if (broke) s.streak = 0;
  return broke ? { points: 0, label: 'Chain broken', good: false } : null;
}

/** Per-frame upkeep: combos time out and timed drills end. */
export function tick(s: Session, now: number): Award | null {
  if (s.over) return null;
  if (s.drill.seconds && now - s.started >= s.drill.seconds * 1000) { s.over = true; return null; }
  const c = s.combo;
  if (c && c.idx > 0 && now - c.lastAt > COMBO_GAP_MS) {
    c.idx = 0; s.streak = 0;
    return { points: 0, label: 'Too slow', good: false };
  }
  return null;
}

export function timeLeft(s: Session, now: number) {
  return s.drill.seconds ? Math.max(0, s.drill.seconds - (now - s.started) / 1000) : null;
}
