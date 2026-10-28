// The park: gear, gym classes, the pickup-fight ladder and what each drill trains. Tuning lives here.
import type { Level, Stat } from '../fight/rules';
import type { Palette } from '../rig/stage';
import type { DrillId } from '../training/drills';

export const STAT_LABEL: Record<Stat, string> = {
  power: 'Power', speed: 'Hand speed', defense: 'Defense', chin: 'Chin', cardio: 'Cardio', kicks: 'Kicks',
  evasion: 'Head movement', clinch: 'Clinch', takedowns: 'Takedowns', td_defense: 'Takedown defense', top: 'Top game', guard: 'Guard'
};

/** Training levels per stat. Each level adds STAT_PER_LEVEL points in park fights. */
export const MAX_LEVEL = 10;
export const STAT_PER_LEVEL = 2;
/** XP needed to go from this level to the next. */
export const xpToNext = (level: number) => 100 + 60 * level;

/** Which stats a drill trains. Drill XP is split between them. */
export const DRILL_TRAINS: Partial<Record<DrillId, Stat[]>> = {
  block: ['defense'], dodge: ['evasion'], read: ['defense', 'evasion'], combo: ['speed', 'power'], sprawl: ['td_defense']
};
export const drillXp = (score: number) => Math.round(Math.max(0, score) / 12);

export interface GymClass { id: string; name: string; blurb: string; stats: Stat[]; price: number; xp: number }
/** Paid classes cover what the drills don't. Price rises with your level in the stats they train. */
export const CLASSES: GymClass[] = [
  { id: 'roadwork', name: 'Roadwork', blurb: 'Morning runs and hill sprints.', stats: ['cardio'], price: 60, xp: 120 },
  { id: 'bag', name: 'Heavy bag rounds', blurb: 'Sit down on your shots.', stats: ['power'], price: 80, xp: 120 },
  { id: 'hard_spar', name: 'Hard sparring', blurb: 'Rounds with the pros. You learn to take one.', stats: ['chin'], price: 90, xp: 120 },
  { id: 'thai_pads', name: 'Thai pads', blurb: 'Kicks, knees and the plum clinch with a pad holder.', stats: ['kicks', 'clinch'], price: 120, xp: 160 },
  { id: 'wrestling', name: 'Wrestling class', blurb: 'Chain wrestling, shots and riding.', stats: ['takedowns', 'top'], price: 120, xp: 160 },
  { id: 'bjj', name: 'Jiu-jitsu class', blurb: 'Guard work, sweeps and pressure passing.', stats: ['guard', 'top'], price: 120, xp: 160 }
];
export const CLASS_PRICE_PER_LEVEL = 15;

export type Slot = 'gloves' | 'shorts' | 'wraps' | 'mouthguard';
export const SLOTS: Slot[] = ['gloves', 'shorts', 'wraps', 'mouthguard'];
export const SLOT_LABEL: Record<Slot, string> = { gloves: 'Gloves', shorts: 'Shorts', wraps: 'Hand wraps', mouthguard: 'Mouthguard' };

export interface Gear {
  id: string; slot: Slot; name: string; price: number; boost: Partial<Record<Stat, number>>;
  colors?: Partial<Pick<Palette, 'shorts' | 'trim' | 'glove' | 'cuff'>>;
  /** Park rep needed before the shop sells it. */
  rep?: number;
}
export const GEAR: Gear[] = [
  { id: 'gloves_basic', slot: 'gloves', name: 'Bag gloves', price: 0, boost: {}, colors: { glove: '#23252b' } },
  { id: 'gloves_red', slot: 'gloves', name: 'Red pro gloves', price: 250, boost: { power: 2 }, colors: { glove: '#b3121b' } },
  { id: 'gloves_white', slot: 'gloves', name: 'Sparring whites', price: 400, boost: { defense: 3 }, colors: { glove: '#ededea' } },
  { id: 'gloves_gold', slot: 'gloves', name: 'Gold 4 oz gloves', price: 700, boost: { power: 3, speed: 2 }, colors: { glove: '#d4a017' }, rep: 60 },
  { id: 'shorts_basic', slot: 'shorts', name: 'Gym shorts', price: 0, boost: {}, colors: { shorts: '#c8232c', trim: '#f2f2f2' } },
  { id: 'shorts_thai', slot: 'shorts', name: 'Thai shorts', price: 300, boost: { kicks: 3 }, colors: { shorts: '#1d3fa8', trim: '#f0c419' } },
  { id: 'shorts_grapple', slot: 'shorts', name: 'Grappling shorts', price: 300, boost: { takedowns: 2, guard: 2 }, colors: { shorts: '#1f2329', trim: '#3fbf74' } },
  { id: 'shorts_champ', slot: 'shorts', name: 'Champion trunks', price: 1200, boost: { cardio: 3, chin: 3 }, colors: { shorts: '#141414', trim: '#d4a017' }, rep: 150 },
  { id: 'wraps_basic', slot: 'wraps', name: 'Red tape', price: 0, boost: {}, colors: { cuff: '#c8232c' } },
  { id: 'wraps_black', slot: 'wraps', name: 'Black wraps', price: 120, boost: { clinch: 2 }, colors: { cuff: '#141414' } },
  { id: 'wraps_gold', slot: 'wraps', name: 'Gold wraps', price: 350, boost: { speed: 2 }, colors: { cuff: '#d4a017' }, rep: 25 },
  { id: 'mg_none', slot: 'mouthguard', name: 'None', price: 0, boost: {} },
  { id: 'mg_basic', slot: 'mouthguard', name: 'Boil-and-bite', price: 90, boost: { chin: 2 } },
  { id: 'mg_custom', slot: 'mouthguard', name: 'Custom fit', price: 400, boost: { chin: 4, cardio: 1 }, rep: 80 }
];
export const GEAR_BY_ID: Record<string, Gear> = Object.fromEntries(GEAR.map(g => [g.id, g]));
export const STARTER_GEAR: Record<Slot, string> = { gloves: 'gloves_basic', shorts: 'shorts_basic', wraps: 'wraps_basic', mouthguard: 'mg_none' };

export interface ParkFighter {
  id: string; name: string; style: string; level: Level;
  /** Rep you need before they'll fight you. */
  rep: number;
  purse: number; repWin: number;
  boost?: Partial<Record<Stat, number>>;
  palette: Pick<Palette, 'skin' | 'hair' | 'shorts' | 'trim' | 'glove' | 'cuff'>;
  blurb: string;
}
/** The pickup ladder at the court, easiest first. */
export const PARK_FIGHTERS: ParkFighter[] = [
  { id: 'dex', name: 'Dex', style: 'boxing', level: 'easy', rep: 0, purse: 120, repWin: 8, blurb: 'All hands, no kicks. Talks more than he throws.',
    palette: { skin: '#c48a62', hair: '#1c140f', shorts: '#e8e8e8', trim: '#c8232c', glove: '#c8232c', cuff: '#e8e8e8' } },
  { id: 'kenji', name: 'Kenji', style: 'karate', level: 'easy', rep: 0, purse: 140, repWin: 10, blurb: 'Bladed stance, long kicks, in and out.',
    palette: { skin: '#e4b896', hair: '#0f0c0a', shorts: '#f4f4f0', trim: '#141414', glove: '#2b2f37', cuff: '#141414' } },
  { id: 'rosa', name: 'Rosa', style: 'muay_thai', level: 'normal', rep: 25, purse: 220, repWin: 14, blurb: 'Chops the legs, then the plum clinch.',
    palette: { skin: '#a8714d', hair: '#2a1a12', shorts: '#e0398a', trim: '#f0c419', glove: '#e0398a', cuff: '#f0c419' } },
  { id: 'tank', name: 'Tank', style: 'wrestling', level: 'normal', rep: 50, purse: 260, repWin: 16, blurb: 'Shoots early and often. Heavy on top.',
    palette: { skin: '#e2a98a', hair: '#6b4a2e', shorts: '#2d6a3a', trim: '#f2f2f2', glove: '#23252b', cuff: '#2d6a3a' } },
  { id: 'lucia', name: 'Lucia', style: 'bjj', level: 'normal', rep: 80, purse: 320, repWin: 18, boost: { guard: 5 },
    blurb: 'Happy to pull guard. Do not leave an arm out.',
    palette: { skin: '#d49e78', hair: '#3b2416', shorts: '#5a2d91', trim: '#f2f2f2', glove: '#23252b', cuff: '#5a2d91' } },
  { id: 'marcus', name: 'Marcus', style: 'mma', level: 'hard', rep: 120, purse: 450, repWin: 22, blurb: 'Does everything well. Park regular for ten years.',
    palette: { skin: '#6e4530', hair: '#0b0807', shorts: '#2457b5', trim: '#f0c419', glove: '#23252b', cuff: '#2457b5' } },
  { id: 'sly', name: 'Sly', style: 'boxing', level: 'hard', rep: 170, purse: 600, repWin: 26, boost: { speed: 6, power: 4 },
    blurb: 'Former pro boxer. Fast hands, mean counters.',
    palette: { skin: '#8d5b3d', hair: '#0e0a08', shorts: '#141414', trim: '#d4a017', glove: '#d4a017', cuff: '#141414' } },
  { id: 'king', name: 'The King', style: 'mma', level: 'hard', rep: 240, purse: 1000, repWin: 40,
    boost: { power: 8, speed: 8, defense: 8, chin: 8, cardio: 8, takedowns: 8, td_defense: 8, top: 8, guard: 8, clinch: 8, kicks: 8, evasion: 8 },
    blurb: 'Owns the court. Beat him and it is yours.',
    palette: { skin: '#b07a55', hair: '#120c08', shorts: '#7a0e14', trim: '#d4a017', glove: '#d4a017', cuff: '#7a0e14' } }
];
export const PARK_FIGHTER_BY_ID: Record<string, ParkFighter> = Object.fromEntries(PARK_FIGHTERS.map(f => [f.id, f]));

/** Pickup fights: one round, a bit longer than a pro round. */
export const PICKUP_CONFIG = { rounds: 1, roundMs: 120000 };
/** A loss still pays a little and earns a little respect. */
export const LOSS_PURSE = 0.2;
export const LOSS_REP = 2;
export const DRAW_PURSE = 0.5;
export const DRAW_REP = 5;
/** Extra cash the first time you beat someone. */
export const FIRST_WIN_BONUS = 0.5;
export const START_CASH = 200;

export const REP_TITLES: [number, string][] = [[0, 'Newcomer'], [25, 'Regular'], [80, 'Local name'], [150, 'Park legend'], [240, 'Contender']];
