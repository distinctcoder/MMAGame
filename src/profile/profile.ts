// Your fighter: name, style, preferences and fight record. Saved in this browser only.
import type { Level } from '../fight/rules';
import { defaultPark, normalizePark, type ParkState } from '../park/progress';

export interface FightRecord { date: string; opponent: string; result: 'win' | 'loss' | 'draw'; how: string }
export interface Profile {
  name: string;
  style: string;
  opponentStyle: string;
  level: Level;
  tells: boolean;
  record: { wins: number; losses: number; draws: number };
  history: FightRecord[];
  /** Best score per training drill. */
  training: Record<string, number>;
  /** Partner behavior for sparring. */
  sparBehavior: string;
  /** Cash, rep, training levels and gear from the park. */
  park: ParkState;
}

const KEY = 'mma-game.profile.v1';
const HISTORY = 8;

export function defaultProfile(): Profile {
  return { name: 'Red', style: 'muay_thai', opponentStyle: 'wrestling', level: 'normal', tells: true, record: { wins: 0, losses: 0, draws: 0 }, history: [], training: {}, sparBehavior: 'normal', park: defaultPark() };
}

/** Reads the saved profile. Storage can be missing or blocked (private windows, previews), so this never throws. */
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultProfile();
    const saved = JSON.parse(raw) as Partial<Profile>;
    const base = defaultProfile();
    return { ...base, ...saved, record: { ...base.record, ...saved.record }, history: Array.isArray(saved.history) ? saved.history : [], training: { ...saved.training }, park: normalizePark(saved.park) };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable: keep playing without saving */ }
}

/** Keeps the higher score. Returns the updated profile and whether this was a new best. */
export function recordDrill(p: Profile, drill: string, score: number): { profile: Profile; best: boolean } {
  const prev = p.training[drill];
  if (prev !== undefined && prev >= score) return { profile: p, best: false };
  return { profile: { ...p, training: { ...p.training, [drill]: score } }, best: true };
}

export function recordFight(p: Profile, result: FightRecord['result'], how: string, opponent: string): Profile {
  const record = { ...p.record };
  if (result === 'win') record.wins++;
  else if (result === 'loss') record.losses++;
  else record.draws++;
  const entry: FightRecord = { date: new Date().toISOString().slice(0, 10), opponent, result, how };
  return { ...p, record, history: [entry, ...p.history].slice(0, HISTORY) };
}
