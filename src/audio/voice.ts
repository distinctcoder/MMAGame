// Recorded voice lines (generated with Higgsfield, in public/voice/) and the director that decides who speaks:
// the referee and ring announcer call the fight, and Coach Ruiz shouts from your corner.
// The director only reads fight cues and events, so it is plain logic with no audio inside; tests drive it directly.
import { SD } from '../data';
import type { Color, FightEvent } from '../fight/fight';
import type { Sfx } from './synth';

export type Speaker = 'ref' | 'announcer' | 'coach';
export interface VoiceLine { file: string; who: Speaker; text: string }

export const VOICE: Record<string, VoiceLine> = {
  ref_touch: { file: 'ref_touch', who: 'ref', text: 'Touch gloves.' },
  ref_fight: { file: 'ref_fight', who: 'ref', text: 'Fight!' },
  ref_stop: { file: 'ref_stop', who: 'ref', text: "Stop! Stop! It's over!" },
  ref_break: { file: 'ref_break', who: 'ref', text: 'Break!' },
  ref_standup: { file: 'ref_standup', who: 'ref', text: "Stand up. Let's go." },
  ref_ten: { file: 'ref_ten', who: 'ref', text: 'Ten seconds!' },
  ann_round1: { file: 'ann_round1', who: 'announcer', text: 'Round one!' },
  ann_round2: { file: 'ann_round2', who: 'announcer', text: 'Round two!' },
  ann_round3: { file: 'ann_round3', who: 'announcer', text: 'Round three!' },
  ann_round4: { file: 'ann_round4', who: 'announcer', text: 'Round four!' },
  ann_final: { file: 'ann_final', who: 'announcer', text: 'Final round!' },
  ann_over: { file: 'ann_over', who: 'announcer', text: "It's all over!" },
  ann_cards: { file: 'ann_cards', who: 'announcer', text: "We go to the judges' scorecards." },
  ann_intro: { file: 'ann_intro', who: 'announcer', text: "Ladies and gentlemen... it's fight night!" },
  ann_champ: { file: 'ann_champ', who: 'announcer', text: 'And new... champion of the world!' },
  ann_draw: { file: 'ann_draw', who: 'announcer', text: "It's a draw!" },
  coach_hands: { file: 'coach_hands', who: 'coach', text: 'Hands up!' },
  coach_sprawl: { file: 'coach_sprawl', who: 'coach', text: 'Sprawl! Sprawl!' },
  coach_head: { file: 'coach_head', who: 'coach', text: 'Move your head!' },
  coach_good: { file: 'coach_good', who: 'coach', text: 'Good! Keep working!' },
  coach_getup: { file: 'coach_getup', who: 'coach', text: 'Get up! Get up!' },
  coach_breathe: { file: 'coach_breathe', who: 'coach', text: 'Breathe. Stick to the game plan.' },
  coach_body: { file: 'coach_body', who: 'coach', text: 'Go to the body!' },
  coach_handsgo: { file: 'coach_handsgo', who: 'coach', text: 'Let your hands go!' }
};

/**
 * Where a clip's speech starts and ends, skipping the silent padding the generator adds.
 * Keeps a little lead-in and tail so words aren't clipped.
 */
export function trimBounds(data: Float32Array, rate: number, threshold = 0.015): [number, number] {
  let first = -1, last = -1;
  for (let i = 0; i < data.length; i++) if (Math.abs(data[i]) > threshold) { if (first < 0) first = i; last = i; }
  if (first < 0) return [0, 0];
  return [Math.max(0, first - Math.round(rate * 0.03)), Math.min(data.length, last + Math.round(rate * 0.12))];
}

/** The coach never repeats a shout sooner than this, and leaves this much quiet after any shout. */
export const COACH_REPEAT_MS = 14000;
export const COACH_GAP_MS = 4500;
/** Head hits on you within this window count toward "Move your head!". */
const HEAD_WINDOW_MS = 5000;
/** No strikes thrown for this long while standing: "Let your hands go!". */
const IDLE_MS = 8000;
/** Stuck on your back this long: "Get up!". */
const BOTTOM_MS = 3500;

export interface FightView {
  mode: string;
  over: boolean;
  /** The color on the bottom on the ground, if any. */
  bottom: Color | null;
}

/**
 * Turns fight cues into voice lines. `say` queues a line; the corner only talks for the human fighter (red),
 * and only during real fights (`corner` on).
 */
export class VoiceDirector {
  corner = true;
  private lastSaid: Record<string, number> = {};
  private lastCoach = -1e9;
  private headHits: number[] = [];
  private landed: number[] = [];
  private blockedHigh = 0;
  private lastThrow = 0;
  private bottomSince: number | null = null;
  private lastRoundAt = -1e9;

  constructor(private say: (id: string) => void) {}

  /** A new fight: reset the corner's memory. */
  reset(now: number) {
    this.headHits = []; this.landed = []; this.blockedHigh = 0; this.lastThrow = now; this.bottomSince = null;
  }

  private coach(id: string, now: number) {
    if (!this.corner || now - this.lastCoach < COACH_GAP_MS || now - (this.lastSaid[id] ?? -1e9) < COACH_REPEAT_MS) return;
    this.lastCoach = this.lastSaid[id] = now;
    this.say(id);
  }

  /** Referee and announcer calls from the fight's sound cues. */
  cue(e: Sfx, now: number) {
    switch (e.k) {
      case 'round':
        this.lastRoundAt = now;
        this.say(e.last && e.n > 1 ? 'ann_final' : e.n <= 4 ? `ann_round${e.n}` : 'ann_final');
        if (e.n === 1) this.say('ref_touch');
        this.say('ref_fight');
        this.lastThrow = now;
        break;
      case 'ref': this.say(e.line === 'break' ? 'ref_break' : 'ref_standup'); break;
      case 'ten': this.say('ref_ten'); break;
      case 'finish': this.say('ref_stop'); break;
      case 'decision': this.say('ann_over'); this.say(e.draw ? 'ann_draw' : 'ann_cards'); break;
      case 'bell':
        // A bell that doesn't open a round ends one: a word from the corner while the fighters reset.
        if (now - this.lastRoundAt > 1000) { this.lastCoach = -1e9; this.coach('coach_breathe', now); }
        break;
    }
  }

  /** Corner shouts from what happens to the human fighter. */
  event(e: FightEvent, now: number) {
    if (e.type === 'throw') { if (e.attacker === 'red') this.lastThrow = now; return; }
    if (e.type === 'shoot') { if (e.attacker === 'blue') this.coach('coach_sprawl', now); else this.lastThrow = now; return; }
    if (e.type !== 'strike') return;
    const s = SD.strikes[e.key];
    const landed = e.result === 'hit' || e.result === 'into' || e.result === 'grazed';
    if (e.attacker === 'blue') {
      if (!landed || s?.part !== 'head') return;
      this.headHits = [...this.headHits.filter(t => now - t < HEAD_WINDOW_MS), now];
      if (this.headHits.length >= 3) { this.headHits = []; this.coach('coach_head', now); }
      else if (s.dmg >= 8) this.coach('coach_hands', now);
      return;
    }
    if (landed) {
      this.blockedHigh = 0;
      this.landed = [...this.landed.filter(t => now - t < 5000), now];
      if (this.landed.length >= 3) { this.landed = []; this.coach('coach_good', now); }
    } else if ((e.result === 'blocked' || e.result === 'parried') && s?.part === 'head') {
      if (++this.blockedHigh >= 3) { this.blockedHigh = 0; this.coach('coach_body', now); }
    }
  }

  /** Once a frame: shouts that come from time passing rather than an event. */
  frame(view: FightView, now: number) {
    if (view.over) { this.bottomSince = null; return; }
    if (view.mode === 'ground' && view.bottom === 'red') {
      this.bottomSince ??= now;
      if (now - this.bottomSince > BOTTOM_MS) { this.bottomSince = now; this.coach('coach_getup', now); }
    } else this.bottomSince = null;
    if (view.mode === 'stand' && now - this.lastThrow > IDLE_MS) { this.lastThrow = now; this.coach('coach_handsgo', now); }
    if (view.mode !== 'stand') this.lastThrow = Math.max(this.lastThrow, now - IDLE_MS / 2);
  }
}
