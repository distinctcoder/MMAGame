// Story progress: which bout is next, the current fight camp, and the career record. Pure functions over StoryState.
import type { ParkState } from '../park/progress';
import { BOUTS, BOUT_BY_ID, SHOW_MONEY, type Bout } from './data';

export type Result = 'win' | 'loss' | 'draw';
export interface StoryState {
  /** Index into BOUTS of the next fight. Equal to BOUTS.length once you are champion. */
  next: number;
  /** Camp sessions used before the next fight, e.g. 'drill:sprawl' or 'class:roadwork'. */
  camp: string[];
  record: { wins: number; losses: number; draws: number };
  history: { bout: string; result: Result; how: string }[];
  /** The last fight's result, until you read what the coach has to say about it. */
  last: { bout: string; result: Result; how: string } | null;
}

export function defaultStory(): StoryState {
  return { next: 0, camp: [], record: { wins: 0, losses: 0, draws: 0 }, history: [], last: null };
}

export function normalizeStory(saved: Partial<StoryState> | undefined): StoryState {
  const base = defaultStory();
  if (!saved || typeof saved !== 'object') return base;
  const next = Number.isInteger(saved.next) ? Math.max(0, Math.min(BOUTS.length, saved.next!)) : 0;
  const last = saved.last && BOUT_BY_ID[saved.last.bout] ? saved.last : null;
  return {
    next,
    camp: Array.isArray(saved.camp) ? saved.camp.filter(s => typeof s === 'string') : [],
    record: { ...base.record, ...saved.record },
    history: Array.isArray(saved.history) ? saved.history.filter(h => BOUT_BY_ID[h?.bout]) : [],
    last
  };
}

export const champion = (s: StoryState) => s.next >= BOUTS.length;
export const nextBout = (s: StoryState): Bout | null => BOUTS[s.next] || null;
export function campLeft(s: StoryState): number {
  const b = nextBout(s);
  return b ? Math.max(0, b.camp - s.camp.length) : 0;
}

/** Spend a camp session. Classes are one per camp; drills can repeat. */
export function useSession(s: StoryState, session: string): StoryState | null {
  if (!nextBout(s) || campLeft(s) <= 0) return null;
  if (session.startsWith('class:') && s.camp.includes(session)) return null;
  return { ...s, camp: [...s.camp, session] };
}

export interface Pay { cash: number; rep: number }
/** Wins pay the full purse and rep; anything else pays show money. */
export function boutPay(b: Bout, result: Result): Pay {
  return result === 'win' ? { cash: b.purse, rep: b.rep } : { cash: Math.round(b.purse * SHOW_MONEY), rep: 0 };
}

/** Record a fight. Only a win moves the career on; any result starts a fresh camp. */
export function applyBout(s: StoryState, park: ParkState, result: Result, how: string): { story: StoryState; park: ParkState; pay: Pay } | null {
  const b = nextBout(s);
  if (!b) return null;
  const pay = boutPay(b, result);
  const record = { ...s.record };
  if (result === 'win') record.wins++; else if (result === 'loss') record.losses++; else record.draws++;
  const entry = { bout: b.id, result, how };
  return {
    story: { next: s.next + (result === 'win' ? 1 : 0), camp: [], record, history: [...s.history, entry], last: entry },
    park: { ...park, cash: park.cash + pay.cash, rep: park.rep + pay.rep },
    pay
  };
}

export const resultOf = (s: StoryState, boutId: string): Result | null => {
  const h = s.history.filter(x => x.bout === boutId);
  if (h.some(x => x.result === 'win')) return 'win';
  return h.length ? h[h.length - 1].result : null;
};
