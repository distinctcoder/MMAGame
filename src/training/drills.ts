// Training drills: what the partner does, how long a drill runs, and what each outcome is worth.
import type { CpuPlan, FightConfig } from '../fight/fight';
import type { DefenseResult, Level } from '../fight/rules';

export type DrillId = 'spar' | 'block' | 'dodge' | 'read' | 'combo' | 'sprawl';
export type DrillKind = 'spar' | 'defense' | 'combo' | 'takedown';
export type Outcome = DefenseResult | 'whiff' | 'stuffed' | 'sprawl' | 'guard' | 'side' | 'mount';

export interface Drill {
  id: DrillId;
  name: string;
  blurb: string;
  kind: DrillKind;
  /** Ends after this many partner strikes or takedown attempts. */
  count?: number;
  /** Ends after this many seconds. */
  seconds?: number;
  /** Partner style, overriding the one you picked. */
  partner?: string;
  /** Partner level, overriding your CPU level, so the drill rewards good timing. */
  level?: Level;
  /** Force tells on or off. Left out: your setting. */
  tells?: boolean;
  /** Score multiplier. */
  mult?: number;
  points?: Partial<Record<Outcome, number>>;
  config: FightConfig;
}

const ALL_STRIKES = { jab: 2, cross: 2, lead_hook: 2, rear_hook: 2, uppercut: 1, low_kick: 2, body_kick: 2, head_kick: 1 };
const PUNCHES = { jab: 3, cross: 3, lead_hook: 2, rear_hook: 2, uppercut: 2 };
const BLOCK_POINTS: Drill['points'] = { parried: 100, checked: 90, blocked: 60, dodged: 70, partial: 30, grazed: 30 };
const TRAINING: FightConfig = { infinite: true, noClock: true };

export const DRILLS: Record<DrillId, Drill> = {
  spar: {
    id: 'spar', name: 'Sparring', kind: 'spar',
    blurb: 'Free practice. Nobody can be finished and there is no clock. Pick how your partner fights.',
    config: { ...TRAINING }
  },
  block: {
    id: 'block', name: 'Block drill', kind: 'defense', count: 20,
    blurb: '20 strikes of every kind. Raise the block that matches each one. Late blocks parry for bonus points; streaks add more.',
    points: BLOCK_POINTS,
    config: { ...TRAINING, startDist: 72, cpu: { mix: ALL_STRIKES, interval: [1100, 1700], keepRange: 74, defend: false, takedowns: false, clinch: false } }
  },
  dodge: {
    id: 'dodge', name: 'Head movement', kind: 'defense', count: 20,
    blurb: '20 punches. Slip, duck or sway so they miss completely. Blocks still score, but less. Duck an uppercut and you eat it.',
    points: { dodged: 100, parried: 50, blocked: 30, partial: 15, grazed: 20 },
    config: { ...TRAINING, startDist: 72, cpu: { mix: PUNCHES, interval: [1100, 1700], keepRange: 74, defend: false, takedowns: false, clinch: false } }
  },
  read: {
    id: 'read', name: 'Read the windup', kind: 'defense', count: 20, tells: false, mult: 1.5,
    blurb: 'The block drill with no tells. Read each strike from the windup alone. Points count 1.5 times.',
    points: BLOCK_POINTS,
    config: { ...TRAINING, startDist: 72, cpu: { mix: ALL_STRIKES, interval: [1200, 1800], keepRange: 74, defend: false, takedowns: false, clinch: false } }
  },
  combo: {
    id: 'combo', name: 'Combo challenge', kind: 'combo', seconds: 45,
    blurb: 'Land the combo shown, in order, keeping each strike close behind the last. The dummy stands still. 45 seconds.',
    config: { ...TRAINING, startDist: 72, cpu: { attack: false, defend: false, move: false } }
  },
  sprawl: {
    id: 'sprawl', name: 'Sprawl drill', kind: 'takedown', count: 10, partner: 'mma', level: 'easy',
    blurb: 'Your partner shoots 10 times. Read the level change to stuff it early, or sprawl on the grab. You reset to your feet after each one.',
    points: { stuffed: 150, sprawl: 100, guard: 20 },
    config: { ...TRAINING, resetGround: true, startDist: 100, cpu: { attack: false, defend: false, shootEvery: 2800, keepRange: 95 } }
  }
};

/** Partner behaviors for sparring. */
export const SPAR_BEHAVIORS: Record<string, { label: string; cpu: CpuPlan }> = {
  normal: { label: 'Fights normally', cpu: {} },
  straights: { label: 'Only jabs and crosses', cpu: { mix: { jab: 3, cross: 3 }, takedowns: false, clinch: false } },
  hooks: { label: 'Only hooks and uppercuts', cpu: { mix: { lead_hook: 3, rear_hook: 3, uppercut: 2 }, keepRange: 70, takedowns: false, clinch: false } },
  kicks: { label: 'Only kicks', cpu: { mix: { low_kick: 3, body_kick: 3, head_kick: 2 }, keepRange: 95, takedowns: false, clinch: false } },
  takedowns: { label: 'Shoots takedowns', cpu: { mix: { jab: 2, cross: 1 }, shootEvery: 4000, clinch: false } },
  clinch: { label: 'Clinch pressure', cpu: { mix: { jab: 1 }, keepRange: 70, takedowns: false, clinch: true } },
  defend: { label: 'Only defends', cpu: { attack: false } },
  bag: { label: 'Punching bag', cpu: { attack: false, defend: false, move: false } }
};

/** Combos for the combo challenge, cycled in order. All of them land from the dummy's distance. */
export const COMBOS: string[][] = [
  ['jab', 'cross'],
  ['jab', 'jab', 'cross'],
  ['jab', 'cross', 'lead_hook'],
  ['lead_hook', 'cross'],
  ['jab', 'cross', 'low_kick'],
  ['cross', 'lead_hook', 'uppercut'],
  ['jab', 'rear_hook', 'body_kick'],
  ['jab', 'cross', 'lead_hook', 'cross']
];
/** Each strike in a combo has to land within this long (game time) of the previous one. */
export const COMBO_GAP_MS = 1100;
