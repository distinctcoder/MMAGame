// Shapes of the game data in strikes.json and fight.json.

export type Vec3 = [number, number, number];

/** Where a hand or foot should reach. See the notes in strikes.json and fight.json. */
export interface TargetSpec {
  h?: Vec3;   // a point on the mat around the fighter, in their facing frame
  hc?: Vec3;  // offset from the fighter's upper chest, in their facing frame
  c?: Vec3;   // offset from the upper chest, in the chest's own frame
  l?: Vec3;   // offset from the hips, in the hip frame
  j?: string; // another body's joint, e.g. 'opp.head' or 'bot.chest'
  o?: Vec3;   // offset from that joint in its owner's facing frame
  oc?: Vec3;  // offset from that joint in its owner's chest frame
}
export type Target = Vec3 | TargetSpec;
export type Pole = Vec3 | { w: Vec3 };
export type LimbKey = 'lh' | 'rh' | 'lf' | 'rf';

export interface PoseSpec {
  pelvis: { b: Vec3 } | Vec3 | TargetSpec;
  rot?: Vec3;
  spine?: Vec3;
  head?: Vec3;
  lh?: Target; rh?: Target; lf?: Target; rf?: Target;
  lhp?: Pole; rhp?: Pole; lfp?: Pole; rfp?: Pole;
  fd?: Vec3;
}

export type Zone = 'high' | 'left' | 'right' | 'body' | 'low';
export type EvadeKind = 'slip_left' | 'slip_right' | 'duck' | 'sway';
export type BodyPart = 'head' | 'body' | 'legs';

export interface Strike {
  label: string;
  key: string;
  wind: string;
  hit: string;
  windup: number;
  recover: number;
  dmg: number;
  part: BodyPart;
  zone: Zone;
  cost: number;
  range: [number, number];
  kick?: boolean;
  track?: boolean;
  evade?: Partial<Record<EvadeKind, number>>;
}

export interface Style {
  label: string;
  power: number; speed: number; defense: number; chin: number; cardio: number; kicks: number;
  evasion: number; clinch: number;
  takedowns: number; td_defense: number; top: number; guard: number;
  range: number; aggression: number;
  mix: Record<string, number>;
}

export interface StrikeData {
  poses: Record<string, Partial<PoseSpec>> & { stance: PoseSpec };
  strikes: Record<string, Strike>;
  zones: Record<Zone, { label: string; key: string; arrow: string; covers: string }>;
  evades: Record<EvadeKind, { label: string; short: string; arrow: string; key: string }>;
  styles: Record<string, Style>;
}

export type Role = 'top' | 'bot';
export interface Pair {
  order: Role[];
  label?: string;
  top: PoseSpec;
  bot: PoseSpec;
  layers?: string[];
  overlays?: Record<string, Partial<Record<Role, Partial<PoseSpec>>>>;
}
export interface Sub {
  label: string;
  by: Role;
  flip: boolean;
  order: Role[];
  center: Vec3;
  cine: { pos: Vec3; look: Vec3; fov: number };
  loose: Record<Role, PoseSpec>;
  tight: Partial<Record<Role, Partial<PoseSpec>>>;
}
export type Position = 'guard' | 'side' | 'mount';
export interface FightData {
  notes: string;
  pairs: Record<string, Pair>;
  subs: Record<string, Sub>;
  positions: Position[];
  sub_from: Partial<Record<Position, string>>;
}
