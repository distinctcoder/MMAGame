// The fight: standing exchanges, the clinch, takedowns, the ground game, submissions, rounds and the referee.
// Rendering and the DOM stay outside; this module talks to them through FightEvents.
import { FD, SD } from '../data';
import type { BodyPart, EvadeKind, Position, Role, Strike, Style, Zone } from '../data/types';
import { blendState, bodyJoints, clamp, cloneJoints, ease, qEuler, rot, V, add, type Joints, type RigState, type Vector3 } from '../rig/math';
import { PairPoses, resolveStand, standSpec, toWorld, type Opponent } from '../rig/poses';
import type { FighterMesh } from '../rig/stage';
import { Quaternion } from 'three';
import * as R from './rules';
import * as W from './weight';
import type { Sfx } from '../audio/synth';
import { cpuClinch, cpuDefend, cpuGround, cpuSeesWindup, cpuStand } from './cpu';

export type Color = 'red' | 'blue';
export type Mode = 'stand' | 'grapple' | 'clinch' | 'ground' | 'break';
export type PopKind = 'hit' | 'block' | 'miss' | 'gold';

export interface StrikeAction {
  type: 'strike'; key: string; s: Strike; phase: 'wind' | 'extend' | 'hold' | 'recover';
  tHit: number; counter: boolean; counterMul: number; gassed: boolean; aim: Joints;
  /** How far the striker was turned away from the target when they threw, degrees. */
  attErr: number;
  /** When the windup started. */
  t0: number;
  recoverMul: number; tRecover: number; tEnd: number;
}
export type Action =
  | { type: 'idle'; since: number }
  | StrikeAction
  | { type: 'step' | 'stun'; tEnd: number }
  | { type: 'grapple' | 'down' | 'done' };

interface Queued { kind: 'strike' | 'shoot'; key?: string; at: number }
export interface Plan { at: number; zone?: Zone; evade?: EvadeKind }
interface Anim { from: RigState | null; fn: () => RigState; t0: number; dur: number }
interface Animated { shown: RigState | null; anim: Anim | null }

export interface Fighter extends Animated {
  color: Color; name: string; style: string; mesh: FighterMesh;
  /** The style's stats with any boosts from training and gear. */
  stats: Style;
  x: number; z: number; fromX: number; toX: number; fromZ: number; toZ: number; moveT0: number; moveDur: number;
  dir: 1 | -1; yaw: number;
  /** The last step: in, out or to the side, and when it finished. A planted lead foot adds power. */
  stepKind: 'in' | 'out' | 'side' | null; stepEnd: number;
  /** When this fighter first saw they were turned away from the opponent (0 when facing them). */
  turnSince: number;
  /** The guard (weight per zone) and head lean, easing toward their targets. */
  guard: R.Guard; guardTarget: Zone | null; guardSince: number;
  lean: R.Lean; leanTarget: R.Lean;
  /** Taps (touch buttons, the CPU) hold a guard or lean until this time. */
  holdUntil: number;
  /** The last hit taken: the head snaps and the body folds away from `dir`, then springs back. */
  jolt: { t0: number; dir: Vector3; snap: number; fold: number } | null;
  headMax: number; headHP: number; body: number; legs: number; sta: number;
  action: Action; queued: Queued | null;
  counterUntil: number; counterMul: number;
  dealt: number; roundDealt: number;
  bodyJoints: Joints; nextThink: number; plannedBlock: Plan | null; clinchUntil: number;
}
export interface Referee extends Animated { x: number; z: number; yaw: number; mesh: FighterMesh }

export interface Timing { title: string; width: number; center: number; start: number; period: number; resolve: (q: number) => void }
export interface SubState {
  att: Fighter; def: Fighter; attStat: number; defStat: number; name: string; v: number;
  start: number; last: number; acc: { att: number; def: number }; resolve: (r: 'tap' | 'escape') => void;
}

export interface FightEvents {
  pop(at: Vector3, text: string, kind: PopKind): void;
  banner(text: string, sub?: string | null, ms?: number): void;
  log(text: string, detail?: string): void;
  tell(s: Strike | null): void;
  rumble(strength: number, ms: number): void;
  /** Control label for prompts, e.g. key('block') -> 'Space' or 'L1'. */
  key(name: string): string;
  /** The set of available moves changed; refresh contextual controls. */
  changed(): void;
  ended(winner: Color | null, how: string): void;
  /** Optional structured events, used by training drills. */
  event?(e: FightEvent): void;
  /** Optional sound cues. */
  sfx?(e: Sfx): void;
  /** Optional impact effect at a point: how hard (0 to 1) and what kind. */
  impact?(at: Vector3, power: number, kind: 'hit' | 'block' | 'parry'): void;
}

/** Steers the CPU for training. Anything left out keeps normal fight behavior. */
export interface CpuPlan {
  attack?: boolean;            // false: never strikes, clinches or works on the ground
  defend?: boolean;            // false: never blocks or dodges
  move?: boolean;              // false: stands still
  mix?: Record<string, number>; // strike weights, replacing the style's mix
  interval?: [number, number]; // steady gap between strikes in ms, instead of the style's aggression
  keepRange?: number;          // preferred distance, instead of the style's range
  shootEvery?: number;         // shoot a takedown this often (ms) when close enough
  takedowns?: boolean;         // false: never shoots
  clinch?: boolean;            // false: never ties up; true: always closes in to tie up
}
export interface FightConfig {
  infinite?: boolean;    // finishes refill both fighters instead of ending the fight; no knockdowns
  noClock?: boolean;     // the round clock does not run
  resetGround?: boolean; // after a takedown lands, both fighters reset to the feet
  startDist?: number;    // distance between the fighters at the start
  cpu?: CpuPlan;
  rounds?: number;       // number of rounds (default 3)
  roundMs?: number;      // round length in ms (default 90 s)
}
export interface FightSetup {
  redStyle: string; blueStyle: string; level: R.Level; redName?: string; blueName?: string; config?: FightConfig;
  /** Stat points added to each fighter's style, e.g. from park training and gear. */
  redBoost?: R.Boost; blueBoost?: R.Boost;
}

/** Structured events for scoring (training drills, stats). */
export type FightEvent =
  | { type: 'throw'; attacker: Color; key: string }
  | { type: 'strike'; attacker: Color; key: string; result: R.DefenseResult | 'whiff' }
  | { type: 'takedown'; attacker: Color; outcome: 'stuffed' | 'sprawl' | Position }
  | { type: 'shoot'; attacker: Color };

class Abort extends Error {}
/** An angle folded into -180..180 degrees. */
const wrapDeg = (a: number) => ((a + 540) % 360) - 180;
const UP = V(0, 1, 0);

const blankJoints = (): Joints => bodyJoints({ P: V(), Qp: qEuler(), Qc: qEuler(), Qh: qEuler(), Qy: qEuler() });

export class Fight {
  readonly red: Fighter;
  readonly blue: Fighter;
  readonly ref: Referee;
  readonly poses = new PairPoses(FD);
  rng: R.Rng = Math.random;

  now = 0; scale = 1; slowUntil = 0;
  mode: Mode = 'stand'; over = false; busy = false;
  round = 1; clock = R.ROUND_MS; scores: [number, number][] = [];
  level: R.Level = 'normal'; tells = true;
  shake = 0;
  /** Hit-stop: fight time stands still until this real time. */
  freezeUntil = 0;
  realNow = 0;
  /** The camera's jolt along the last hit's direction. */
  kick: { dir: Vector3; amp: number; t0: number } | null = null;
  top: Fighter | null = null; bot: Fighter | null = null; anchor = 0; d = 1; pos: Position | null = null; pairName = '';
  subV = 0; timing: Timing | null = null; sub: SubState | null = null;
  lastAction = 0; blockAt = -1e9; blockZone: Zone | null = null; clinchSince = 0; nextShoot = 0;
  camOverride: { pos: Vector3; look: Vector3; fov: number } | null = null;
  koCam: Fighter | null = null;
  config: FightConfig = {};
  nextAttack = 0;
  private gen = 0;

  constructor(meshes: Record<Color | 'ref', FighterMesh>, private ev: FightEvents) {
    const fighter = (color: Color, name: string): Fighter => ({
      color, name, style: 'mma', stats: SD.styles.mma, mesh: meshes[color], x: 0, z: 0, fromX: 0, toX: 0, fromZ: 0, toZ: 0, moveT0: 0, moveDur: 0, dir: 1, yaw: 90,
      stepKind: null, stepEnd: 0, turnSince: 0, guard: {}, guardTarget: null, guardSince: 0, lean: { x: 0, y: 0 }, leanTarget: { x: 0, y: 0 }, holdUntil: 0, jolt: null,
      headMax: 100, headHP: 100, body: 0, legs: 0, sta: 100, action: { type: 'idle', since: 0 }, queued: null,
      counterUntil: 0, counterMul: R.PARRY_COUNTER, dealt: 0, roundDealt: 0, shown: null, anim: null,
      bodyJoints: blankJoints(), nextThink: 0, plannedBlock: null, clinchUntil: 0
    });
    this.red = fighter('red', 'Red');
    this.blue = fighter('blue', 'Blue');
    this.ref = { x: 195, z: -120, yaw: -90, mesh: meshes.ref, shown: null, anim: null };
  }

  // ---------- Helpers ----------
  other(f: Fighter) { return f === this.red ? this.blue : this.red; }
  style(f: Fighter): Style { return f.stats; }
  private rounds() { return this.config.rounds ?? R.ROUNDS; }
  private roundMs() { return this.config.roundMs ?? R.ROUND_MS; }
  isHuman(f: Fighter) { return f === this.red; }
  human() { return this.red; }
  roleOf(f: Fighter): Role { return f === this.top ? 'top' : 'bot'; }
  rand(a: number, b: number) { return a + this.rng() * (b - a); }
  private sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
  private async step<T>(p: Promise<T>): Promise<T> {
    const g = this.gen, r = await p;
    if (g !== this.gen) throw new Abort();
    return r;
  }

  // ---------- Setup ----------
  start(setup: FightSetup) {
    this.gen++;
    this.red.style = setup.redStyle; this.blue.style = setup.blueStyle; this.level = setup.level;
    this.red.stats = R.withBoost(SD.styles[setup.redStyle], setup.redBoost);
    this.blue.stats = R.withBoost(SD.styles[setup.blueStyle], setup.blueBoost);
    this.config = setup.config || {};
    this.nextAttack = this.now + 1200;
    this.red.name = setup.redName || 'Red';
    this.blue.name = setup.blueName || 'Blue';
    Object.assign(this, { over: false, busy: false, mode: 'stand', round: 1, clock: this.roundMs(), scale: 1, slowUntil: 0, koCam: null,
      timing: null, sub: null, top: null, bot: null, pos: null, camOverride: null, nextShoot: this.now + 5000, scores: [] });
    const half = (this.config.startDist ?? 120) / 2;
    this.resetFighter(this.red, -half); this.resetFighter(this.blue, half);
    for (const f of [this.red, this.blue]) { this.face(f); this.stand(f, 'stance', 0); }
    this.primeBodies();
    Object.assign(this.ref, { x: 195, z: -120, yaw: -90, shown: null });
    this.moveRef('ref_stand');
    this.ev.tell(null);
    if (!this.config.noClock) { this.ev.sfx?.({ k: 'round', n: 1, last: this.rounds() === 1 }); this.ev.sfx?.({ k: 'bell' }); }
    if (!this.config.noClock) this.ev.log('Round 1', `${this.red.name} (${this.style(this.red).label}) vs ${this.blue.name} (${this.style(this.blue).label})`);
    this.ev.changed();
  }
  private resetFighter(f: Fighter, x: number) {
    Object.assign(f, { x, z: 0, fromX: x, toX: x, fromZ: 0, toZ: 0, moveDur: 0, stepKind: null, stepEnd: 0, turnSince: 0,
      guard: {}, guardTarget: null, guardSince: 0, lean: { x: 0, y: 0 }, leanTarget: { x: 0, y: 0 }, holdUntil: 0, jolt: null, headMax: R.headMax(this.style(f)), body: 0, legs: 0, sta: 100,
      action: { type: 'idle', since: 0 }, clinchUntil: 0, queued: null, counterUntil: 0, dealt: 0, roundDealt: 0,
      shown: null, anim: null, nextThink: 0, plannedBlock: null });
    f.headHP = f.headMax;
  }
  /** Turn straight to the opponent (resets, round starts). */
  face(f: Fighter) {
    const o = this.other(f);
    f.dir = f.x <= o.x ? 1 : -1;
    if (f.x === o.x) f.dir = f === this.red ? 1 : -1;
    f.yaw = this.yawTo(f, o);
    f.turnSince = 0;
  }
  /** The yaw that faces from a to b. */
  yawTo(a: Fighter, b: Fighter) {
    if (Math.abs(b.x - a.x) < 0.01 && Math.abs(b.z - a.z) < 0.01) return a.yaw;
    return Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI;
  }
  /** How far f is turned away from their opponent, degrees. */
  facingError(f: Fighter) { return Math.abs(wrapDeg(this.yawTo(f, this.other(f)) - f.yaw)); }
  /** Distance between the fighters on the mat. */
  gap() { return Math.hypot(this.red.x - this.blue.x, this.red.z - this.blue.z); }
  /** The footwork picture for a strike from att on def. */
  footing(att: Fighter, def: Fighter, attErr: number): R.Footing {
    const left = rot(qEuler([0, def.yaw, 0]), [1, 0, 0]);
    const side = (att.x - def.x) * left.x + (att.z - def.z) * left.z;
    const since = this.now - att.stepEnd, stepping = att.moveDur > 0;
    return {
      dist: this.gap(), attErr, defErr: this.facingError(def), side,
      planted: att.stepKind === 'in' && (stepping || since < R.PLANTED_MS),
      backing: att.stepKind === 'out' && (stepping || since < 150)
    };
  }
  /** Turn toward the opponent: the mover turns as they step; anyone else reacts after a moment, then pivots. */
  private updateFacing(f: Fighter, dt: number) {
    const o = this.other(f), err = wrapDeg(this.yawTo(f, o) - f.yaw);
    f.dir = f.x <= o.x ? 1 : -1;
    const type = f.action.type;
    if (type === 'step') { f.yaw += clamp(err, -0.6 * dt, 0.6 * dt); f.turnSince = 0; return; }
    if (Math.abs(err) < 2) { f.turnSince = 0; return; }
    if (type !== 'idle') return;
    if (!f.turnSince) f.turnSince = this.now;
    const delay = R.turnDelay(this.style(f), this.isHuman(f) ? 0 : R.LEVELS[this.level].def, this.isHuman(f));
    if (this.now - f.turnSince < delay) return;
    const step = R.turnRate(this.style(f)) * dt / 1000;
    f.yaw += clamp(err, -step, step);
  }
  primeBodies() {
    for (const f of [this.red, this.blue]) {
      const Qy = qEuler([0, f.yaw, 0]);
      f.bodyJoints = bodyJoints({ P: add(V(f.x, 0, 0), Qy, (SD.poses.stance.pelvis as { b: [number, number, number] }).b), Qp: Qy, Qc: Qy, Qh: Qy, Qy });
    }
  }

  // ---------- Animation ----------
  private setAnim(f: Animated, fn: () => RigState, dur: number) { f.anim = { from: f.shown || null, fn, t0: this.now, dur }; }
  private standState(f: Fighter | Referee, name: string): RigState {
    const spec = standSpec(SD, name);
    if (!('color' in f)) return resolveStand(spec, f, null);
    const o = this.other(f), a = f.action;
    const opp: Opponent = { joints: a.type === 'strike' && !a.s.track ? a.aim : o.bodyJoints, yaw: o.yaw };
    const wobble = R.rocked(f.headHP) && !this.over && this.mode === 'stand' ? Math.sin(this.now / 260) * 5 : 0;
    return resolveStand(spec, f, opp, wobble);
  }
  stand(f: Fighter | Referee, name: string, dur: number) {
    this.setAnim(f, () => {
      const t = this.standState(f, name);
      if (name !== 'stance' || this.over) return t;
      const breathing = blendState(t, this.standState(f, 'stance_b'), 0.5 - 0.5 * Math.cos(this.now / 900 * Math.PI * 2));
      return 'color' in f ? this.layered(f, breathing) : breathing;
    }, dur);
  }
  /** The stance with the head lean and the guard blended on top, so both move freely. */
  private layered(f: Fighter, base: RigState): RigState {
    let st = base;
    const l = f.lean;
    if (Math.abs(l.x) > 0.01) st = blendState(st, this.standState(f, l.x < 0 ? 'slip_left' : 'slip_right'), Math.min(1, Math.abs(l.x)));
    if (Math.abs(l.y) > 0.01) st = blendState(st, this.standState(f, l.y < 0 ? 'duck' : 'sway'), Math.min(1, Math.abs(l.y)));
    // Each guard zone blends in by its weight (a running weighted average keeps the total right).
    let acc = 1 - Object.values(f.guard).reduce((n, w) => n + (w || 0), 0);
    for (const [z, w] of Object.entries(f.guard) as [Zone, number][]) {
      if (!w || w < 0.01) continue;
      acc += w;
      st = blendState(st, this.standState(f, 'block_' + z), w / Math.max(acc, 1e-3));
    }
    return st;
  }
  pair(name: string, dur: number, ov: Partial<Record<Role, string>> = {}) {
    this.pairName = name;
    for (const f of [this.top!, this.bot!]) {
      const r = this.roleOf(f);
      this.setAnim(f, () => toWorld(this.poses.pair(name, ov.top, ov.bot)[r], this.d, this.anchor), dur);
    }
    return this.sleep(dur);
  }
  roleAnim(f: Fighter, overName: string | null, dur: number) {
    const r = this.roleOf(f), name = this.pairName;
    this.setAnim(f, () => toWorld(this.poses.pair(name, r === 'top' ? overName : null, r === 'bot' ? overName : null)[r], this.d, this.anchor), dur);
    return this.sleep(dur);
  }
  private subAnim(name: string, dur: number) {
    const s = FD.subs[name];
    for (const f of [this.top!, this.bot!]) {
      const r = this.roleOf(f);
      this.setAnim(f, () => {
        const d = this.d * (s.flip ? -1 : 1);
        return blendState(toWorld(this.poses.sub(name, false)[r], d, this.anchor), toWorld(this.poses.sub(name, true)[r], d, this.anchor), this.subV);
      }, dur);
    }
  }
  private animState(f: Animated): RigState {
    const a = f.anim!, target = a.fn();
    if (!a.from || !a.dur) return target;
    const u = clamp((this.now - a.t0) / a.dur, 0, 1);
    return u >= 1 ? target : blendState(a.from, target, ease(u));
  }
  /** Pose every body for this frame and push it to the meshes. */
  animate() {
    for (const f of [this.red, this.blue, this.ref] as Animated[]) {
      f.shown = this.animState(f);
      // Weight is drawn on top and never fed back into the animation, so transitions start from the clean pose.
      const drawn = 'color' in f ? this.addWeight(f as Fighter, f.shown) : f.shown;
      (f as Fighter | Referee).mesh.update(drawn);
      if ('color' in f) (f as Fighter).bodyJoints = bodyJoints(drawn);
    }
  }

  // ---------- Frame update ----------
  update(real: number, rdt: number) {
    this.realNow = real;
    if (this.slowUntil && real > this.slowUntil) { this.scale = 1; this.slowUntil = 0; }
    const dt = real < this.freezeUntil ? 0 : rdt * this.scale;
    this.now += dt;
    if (this.timing && real - this.timing.start > this.timing.period * 2.2) this.endTiming(0);
    if (this.sub) this.tickSub(real);
    if (!this.over && this.mode !== 'break') {
      if (!this.config.noClock) {
        const before = this.clock;
        this.clock -= dt;
        if (before > 10000 && this.clock <= 10000) this.ev.sfx?.({ k: 'ten' });
        if (this.clock <= 0) { this.clock = 0; this.endRound(); }
      }
      for (const f of [this.red, this.blue]) {
        f.sta = Math.min(R.maxStamina(f.body), f.sta + R.staminaRegen(this.style(f), f.body, f.action.type === 'idle', dt));
      }
    }
    if (this.mode === 'stand') {
      cpuStand(this, this.blue); cpuDefend(this, this.blue);
      for (const f of [this.red, this.blue]) { this.updateStriker(f); this.updateFacing(f, dt); this.updateDefense(f, dt); }
    } else if (this.mode === 'clinch') {
      cpuClinch(this);
      if (!this.busy && !this.over && (this.now - this.lastAction > 9000 || this.now - this.clinchSince > 15000)) {
        this.lastAction = this.now;
        this.act(async () => {
          this.ev.banner('Break', 'The referee breaks the clinch'); this.ev.log('Referee breaks the clinch');
          this.ev.sfx?.({ k: 'ref', line: 'break' });
          this.moveRef('ref_stop'); await this.step(this.sleep(400)); await this.backToFeet(500);
        });
      }
    } else if (this.mode === 'ground') {
      cpuGround(this);
      if (!this.busy && !this.over && this.now - this.lastAction > 15000) {
        this.lastAction = this.now;
        this.act(async () => {
          this.ev.banner('Stand up', 'The referee stands them up'); this.ev.log('Referee stands them up');
          this.ev.sfx?.({ k: 'ref', line: 'standup' });
          this.moveRef('ref_stop'); await this.step(this.sleep(500)); await this.backToFeet(600);
        });
      }
    }
    this.updateRef(rdt);
  }

  // ---------- Striking ----------
  private speedMul(f: Fighter) { return R.speedMul(this.style(f), R.rocked(f.headHP)); }
  startStrike(f: Fighter, key: string, chained: boolean) {
    const s = SD.strikes[key];
    const counter = this.now < f.counterUntil, counterMul = f.counterMul, gassed = f.sta < s.cost;
    // Turned away from the target, the strike has to turn first: slower, and less accurate (see impact).
    const attErr = this.facingError(f);
    const windup = R.windupTime(s, this.style(f), { rocked: R.rocked(f.headHP), chained, counter, counterMul, gassed }) + Math.min(attErr, 60) * 1.5;
    f.yaw = this.yawTo(f, this.other(f)); f.turnSince = 0;
    // Striking drops the guard.
    f.guardTarget = null; f.holdUntil = 0;
    f.sta = Math.max(0, f.sta - s.cost);
    f.counterUntil = 0;
    // Strikes go where the target was when thrown, so head movement can make them miss.
    const aim = cloneJoints(this.other(f).bodyJoints);
    f.action = { type: 'strike', key, s, phase: 'wind', tHit: this.now + windup, counter, counterMul, gassed, aim, attErr, t0: this.now, recoverMul: 1, tRecover: 0, tEnd: 0 };
    this.stand(f, s.wind, Math.max(80, windup - 70));
    cpuSeesWindup(this, this.other(f), f, s, windup);
    if (!this.isHuman(f) && this.tells) this.ev.tell(s);
    this.lastAction = this.now;
    this.ev.event?.({ type: 'throw', attacker: f.color, key });
  }
  // ---------- Free-form defense ----------
  /** Hold the guard in a zone, or drop it (null). Raising it into a new zone starts the parry window. */
  setGuard(f: Fighter, zone: Zone | null) {
    if (zone && (f.action.type === 'strike' || f.action.type === 'stun')) return;
    if (zone !== f.guardTarget) { f.guardTarget = zone; if (zone) f.guardSince = this.now; }
    f.holdUntil = 0;
  }
  /** Lean the head: x from slip left (-1) to slip right (1), y from duck (-1) to sway back (1). */
  setLean(f: Fighter, x: number, y: number) {
    f.leanTarget = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    f.holdUntil = 0;
  }
  /** A tap: hold a guard zone for a moment (touch buttons and the CPU). */
  holdGuard(f: Fighter, zone: Zone, ms = 450) {
    if (this.mode !== 'stand' || this.over) return false;
    this.setGuard(f, zone);
    f.holdUntil = this.now + ms;
    return true;
  }
  /** A tap: hold a head movement for a moment. */
  holdLean(f: Fighter, kind: EvadeKind, ms = 420) {
    if (this.mode !== 'stand' || this.over) return false;
    const v = { slip_left: [-1, 0], slip_right: [1, 0], duck: [0, -1], sway: [0, 1] }[kind];
    this.setLean(f, v[0], v[1]);
    f.sta = Math.max(0, f.sta - R.evadeCost(kind));
    f.holdUntil = this.now + ms;
    return true;
  }
  /** Ease the guard and lean toward their targets; holding them costs a little stamina. */
  private updateDefense(f: Fighter, dt: number) {
    if (f.holdUntil && this.now > f.holdUntil) { f.holdUntil = 0; f.guardTarget = null; f.leanTarget = { x: 0, y: 0 }; }
    const st = this.style(f), busy = f.action.type === 'strike' || f.action.type === 'stun';
    const up = R.guardSpeed(st) * dt / 1000, down = up * 0.8;
    for (const z of Object.keys(SD.zones) as Zone[]) {
      const w = f.guard[z] || 0, target = !busy && f.guardTarget === z ? 1 : 0;
      const next = w + clamp(target - w, -down * (busy ? 2 : 1), up);
      if (next > 0.005) f.guard[z] = next; else delete f.guard[z];
    }
    const k = R.leanSpeed(st) * dt / 1000 * (f.sta < 15 ? 0.6 : 1);
    f.lean = { x: f.lean.x + clamp(f.leanTarget.x - f.lean.x, -k, k), y: f.lean.y + clamp(f.leanTarget.y - f.lean.y, -k, k) };
    const holding = f.guardTarget !== null || Math.abs(f.lean.x) + Math.abs(f.lean.y) > 0.5;
    if (holding) f.sta = Math.max(0, f.sta - R.HOLD_COST * dt / 1000);
  }

  /**
   * A step: fwd 1 in toward the opponent, -1 out; side moves around them, with +1 toward the camera (+z).
   * The fighter turns to face the opponent as they step; the opponent takes a moment to turn back.
   */
  startStep(f: Fighter, fwd: number, side = 0) {
    if (this.mode !== 'stand' || this.over || f.action.type !== 'idle' || (!fwd && !side)) return;
    const o = this.other(f), dx = o.x - f.x, dz = o.z - f.z, d = Math.hypot(dx, dz) || 1;
    const ux = dx / d, uz = dz / d;
    let px = -uz, pz = ux;
    if (pz * side < 0 || (Math.abs(pz) < 0.05 && px * side < 0)) { px = -px; pz = -pz; }
    let reach = 26;
    if (fwd > 0 && d - reach < 48) reach = Math.max(0, d - 48);
    let tx = f.x + ux * fwd * reach + px * Math.abs(side) * 30, tz = f.z + uz * fwd * reach + pz * Math.abs(side) * 30;
    // Stay inside the cage, and near enough the camera's line to read as side-on.
    tz = clamp(tz, -130, 130);
    const r = Math.hypot(tx, tz);
    if (r > 260) { tx *= 260 / r; tz *= 260 / r; }
    const dur = 200 * (1 + f.legs / 200) * (side && !fwd ? 1.1 : 1);
    f.action = { type: 'step', tEnd: this.now + dur };
    f.stepKind = fwd > 0 ? 'in' : fwd < 0 ? 'out' : 'side';
    f.stepEnd = this.now + dur;
    Object.assign(f, { fromX: f.x, toX: tx, fromZ: f.z, toZ: tz, moveT0: this.now, moveDur: dur });
    f.sta = Math.max(0, f.sta - (side ? 1.5 : 1));
  }
  // ---------- Weight ----------
  /**
   * The feel of an impact: freeze the action for a moment, snap the defender away from the blow and spring them back,
   * kick the camera along the blow, knock them back a step on heavy shots, and show a burst at the contact point.
   */
  private weigh(att: Fighter, def: Fighter, part: BodyPart, result: R.DefenseResult, dmg: number, at: Vector3, zone?: Zone) {
    const stop = W.hitStopMs(result, dmg);
    if (stop) this.freezeUntil = Math.max(this.freezeUntil, this.realNow + stop);
    if (result === 'dodged') return;
    const r = W.reaction(result, part, dmg);
    const dir = def.bodyJoints.chest.clone().sub(att.bodyJoints.chest).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(def.x >= att.x ? 1 : -1, 0, 0);
    dir.normalize();
    // Hooks and kicks land from the side: the head goes across, not just back.
    if (zone === 'left' || zone === 'right') {
      const left = rot(qEuler([0, def.yaw, 0]), [1, 0, 0]);
      dir.multiplyScalar(0.45).addScaledVector(left, zone === 'right' ? 1 : -1).normalize();
    }
    def.jolt = { t0: this.now, dir, snap: r.snap, fold: r.fold };
    this.kick = { dir: dir.clone(), amp: r.shake, t0: this.realNow };
    const clean = result === 'hit' || result === 'into' || result === 'grazed' || result === 'partial';
    this.ev.impact?.(at, clean ? clamp(dmg / 16, 0.15, 1) : 0.25, result === 'parried' ? 'parry' : clean ? 'hit' : 'block');
    if (clean && dmg >= W.SLOW_MO_DMG) { this.scale = Math.min(this.scale, 0.45); this.slowUntil = Math.max(this.slowUntil, this.realNow + stop + 260); }
    // Knockback: a real step back along the blow, standing only.
    if (this.mode === 'stand' && r.push >= 3) {
      let tx = def.x + dir.x * r.push, tz = clamp(def.z + dir.z * r.push, -130, 130);
      const rr = Math.hypot(tx, tz);
      if (rr > 260) { tx *= 260 / rr; tz *= 260 / rr; }
      Object.assign(def, { fromX: def.x, toX: tx, fromZ: def.z, toZ: tz, moveT0: this.now, moveDur: 140 });
    }
  }
  /** The weight layer, added on top of the animated pose: the striker's load and drive, and the hit reaction. */
  private addWeight(f: Fighter, st: RigState): RigState {
    let P = st.P, Qp = st.Qp, Qc = st.Qc, Qh = st.Qh;
    const a = f.action;
    if (a.type === 'strike' && this.mode === 'stand') {
      const w = W.weightOf(a.key), amt = W.driveAmount(a, this.now);
      if (amt) {
        // Feet stay planted (their targets are on the mat), so moving the hips reads as a weight shift.
        const fwd = rot(st.Qy, [0, 0, 1]);
        P = P.clone().addScaledVector(fwd, amt > 0 ? amt * w.lunge : amt * w.load);
        P.y -= Math.max(0, amt) * w.drop;
        const twist = (deg: number) => new Quaternion().setFromAxisAngle(UP, deg * Math.PI / 180);
        Qp = twist(amt * w.twist * 0.7).multiply(Qp);
        Qc = twist(amt * w.twist).multiply(Qc);
        Qh = twist(amt * w.twist * 0.5).multiply(Qh);
      }
    }
    const j = f.jolt;
    if (j) {
      const t = this.now - j.t0;
      if (t > 900) f.jolt = null;
      else {
        const sp = W.spring(t), axis = UP.clone().cross(j.dir).normalize();
        const turn = (deg: number) => new Quaternion().setFromAxisAngle(axis, deg * Math.PI / 180);
        // The head snaps away from the blow; a body shot folds the chest toward the attacker.
        if (j.snap) { Qh = turn(j.snap * sp).multiply(Qh); Qc = turn(j.snap * 0.3 * sp).multiply(Qc); }
        if (j.fold) { Qc = turn(-j.fold * sp).multiply(Qc); Qh = turn(-j.fold * 0.5 * sp).multiply(Qh); }
      }
    }
    return P === st.P && Qp === st.Qp && Qc === st.Qc && Qh === st.Qh ? st : { ...st, P, Qp, Qc, Qh };
  }

  private stun(f: Fighter, zone: Zone, dmg: number) {
    const name = { high: 'hit_high', left: 'hit_left', right: 'hit_right', body: 'hit_body', low: 'hit_low' }[zone];
    f.action = { type: 'stun', tEnd: this.now + 160 + dmg * 9 };
    f.queued = null; f.plannedBlock = null; f.guardTarget = null; f.leanTarget = { x: 0, y: 0 }; f.holdUntil = 0;
    if (!this.isHuman(f)) this.ev.tell(null);
    this.stand(f, name, 80);
  }
  private impact(att: Fighter) {
    const a = att.action as StrikeAction, s = a.s, def = this.other(att);
    const at = def.bodyJoints[s.part === 'legs' ? 'lhip' : s.part === 'body' ? 'chest' : 'head']!;
    const foot = R.footwork(a.key, s, this.footing(att, def, a.attErr));
    if (!R.inRange(s, this.gap()) || foot.offTarget) {
      this.ev.pop(at, foot.offTarget ? 'Off target' : 'Whiff', 'miss'); a.recoverMul = 1.6; this.ev.sfx?.({ k: 'whiff' });
      this.ev.event?.({ type: 'strike', attacker: att.color, key: a.key, result: 'whiff' });
      return;
    }
    let out = R.resolveDefense(s, def.guard, def.lean, def.guardTarget === s.zone && this.now - def.guardSince <= R.PERFECT_PARRY_MS);
    // An angle or a planted lead foot can get a shot past a correct block, or catch a late slip.
    if (out.result === 'blocked' && this.rng() < foot.leak) out = { result: 'partial', mult: 0.5 };
    else if (out.result === 'dodged' && this.rng() < foot.leak * 0.4) out = { result: 'grazed', mult: 0.4 };
    const da = def.lean;
    this.ev.event?.({ type: 'strike', attacker: att.color, key: a.key, result: out.result });
    if (out.result === 'dodged') {
      const kind: EvadeKind = Math.abs(da.y) >= Math.abs(da.x) ? (da.y < 0 ? 'duck' : 'sway') : da.x < 0 ? 'slip_left' : 'slip_right';
      this.ev.pop(at, R.EVADED[kind] + '! Counter', 'gold');
      this.ev.sfx?.({ k: 'whiff' });
      a.recoverMul = 1.6;
      def.counterUntil = this.now + R.COUNTER_WINDOW_MS; def.counterMul = out.counterMul!;
      this.ev.rumble(0.15, 60);
      this.lastAction = this.now;
      return;
    }
    let tag: [string, PopKind] | null = null;
    if (out.result === 'checked') { att.legs = Math.min(100, att.legs + R.checkedKickDamage); tag = ['Checked', 'block']; }
    else if (out.result === 'parried') { tag = ['Parry! Counter', 'gold']; def.counterUntil = this.now + R.COUNTER_WINDOW_MS; def.counterMul = out.counterMul!; }
    else if (out.result === 'blocked') tag = ['Blocked', 'block'];
    else if (out.result === 'partial') tag = ['Partly blocked', 'block'];
    const dmg = R.strikeDamage(s, this.style(att), out.mult * foot.dmg, a, this.rng());
    this.ev.sfx?.(out.result === 'checked' ? { k: 'check' } : out.result === 'parried' ? { k: 'parry' }
      : out.mult >= 0.5 && dmg >= 1 ? { k: 'hit', part: s.part, dmg } : { k: 'block' });
    this.weigh(att, def, s.part, out.result, dmg, at, s.zone);
    if (dmg >= 1) {
      this.hurt(def, s.part, dmg, att);
      if (out.mult >= 0.5) {
        this.stun(def, s.zone, dmg);
        this.ev.rumble(this.isHuman(def) ? 1 : 0.35, this.isHuman(def) ? 220 : 90);
        // Name what footwork did, so it is learnable: angle, outside foot, planted.
        const why = foot.tags.find(t => t === 'Angle' || t === 'Outside foot' || t === 'Planted');
        if (!tag) tag = [(out.result === 'into' ? 'Into it! ' : a.counter ? 'Counter ' : why ? why + '! ' : '') + Math.round(dmg), a.counter || why ? 'gold' : 'hit'];
        if (!this.config.infinite && R.knockdownCheck(s.part, dmg, def.headHP, def.headMax, this.rng())) { this.ev.pop(at, tag[0], tag[1]); return this.knockdown(att, def); }
      }
    }
    if (tag) this.ev.pop(at, tag[0], tag[1]);
    this.checkFinish(att, def, s.label);
  }
  hurt(def: Fighter, part: 'head' | 'body' | 'legs', dmg: number, att: Fighter) {
    R.applyDamage(def, part, dmg);
    att.dealt += dmg; att.roundDealt += dmg;
    this.lastAction = this.now;
  }
  private updateStriker(f: Fighter) {
    const a = f.action;
    if (f.moveDur) {
      const u = clamp((this.now - f.moveT0) / f.moveDur, 0, 1);
      f.x = f.fromX + (f.toX - f.fromX) * ease(u);
      f.z = f.fromZ + (f.toZ - f.fromZ) * ease(u);
      if (u >= 1) f.moveDur = 0;
    }
    if (a.type === 'strike') {
      if (a.phase === 'wind' && this.now >= a.tHit - 70) { a.phase = 'extend'; this.stand(f, a.s.hit, 70); this.ev.sfx?.({ k: 'swing', kick: !!a.s.kick }); }
      if (a.phase === 'extend' && this.now >= a.tHit) {
        a.phase = 'hold'; a.recoverMul = 1;
        if (!this.isHuman(f)) this.ev.tell(null);
        this.impact(f);
        a.tRecover = this.now + 60;
      }
      if (this.mode !== 'stand') return;
      if (a.phase === 'hold' && this.now >= a.tRecover && !this.over) {
        a.phase = 'recover';
        const dur = a.s.recover * a.recoverMul * this.speedMul(f);
        a.tEnd = this.now + dur;
        this.stand(f, 'stance', dur);
      }
      if (a.phase === 'recover' && this.now >= a.tEnd) this.toIdle(f);
    } else if ((a.type === 'stun' || a.type === 'step') && this.now >= a.tEnd) {
      if (a.type !== 'step') this.stand(f, 'stance', 220);
      this.toIdle(f);
    }
  }
  private toIdle(f: Fighter) {
    f.action = { type: 'idle', since: this.now };
    if (f.queued && !this.over && this.mode === 'stand') {
      const q = f.queued; f.queued = null;
      if (q.kind === 'strike') this.startStrike(f, q.key!, this.now - q.at < 600);
      else if (q.kind === 'shoot') this.shoot(f);
    }
  }

  // ---------- Contests (timing bar) ----------
  private timingBar(title: string, stat: number) {
    return new Promise<number>(resolve => {
      const width = R.timingWidth(stat), center = this.rand(0.3 + width / 2, 0.8 - width / 2);
      this.timing = { title, width, center, start: performance.now(), period: 1000, resolve };
      this.ev.changed();
    });
  }
  needlePos(real = performance.now()) {
    const t = this.timing;
    if (!t) return 0;
    const u = ((real - t.start) / t.period) % 2;
    return u < 1 ? u : 2 - u;
  }
  pressTiming() {
    const t = this.timing;
    if (t) this.endTiming(R.timingQuality(this.needlePos(), t.center, t.width));
  }
  private endTiming(q: number) {
    const t = this.timing;
    if (!t) return;
    this.timing = null;
    this.ev.banner(q > 0.9 ? 'Perfect' : q > 0.6 ? 'Good' : q > 0 ? 'Off' : 'Missed', null, 600);
    this.ev.sfx?.({ k: 'timing', q });
    t.resolve(q);
    this.ev.changed();
  }
  private async contest(o: { att: Fighter; def: Fighter; attStat: number; defStat: number; attTitle: string; defTitle: string; defBonus?: number }) {
    const lv = R.LEVELS[this.level].grap;
    const aStat = o.attStat + (this.isHuman(o.att) ? 0 : lv), dStat = o.defStat + (this.isHuman(o.def) ? 0 : lv);
    const qa = this.isHuman(o.att) ? await this.step(this.timingBar(o.attTitle, o.attStat)) : R.cpuTiming(aStat, this.rng());
    const qd = this.isHuman(o.def) ? await this.step(this.timingBar(o.defTitle, o.defStat)) : R.cpuTiming(dStat, this.rng());
    const margin = R.contestMargin(aStat, qa, dStat, qd, o.defBonus || 0, this.rng(), this.rng());
    const pct = (q: number) => Math.round(q * 100) + '%';
    return { margin, detail: `${o.att.name} ${Math.round(aStat)} + timing ${pct(qa)} vs ${o.def.name} ${Math.round(dStat)} + timing ${pct(qd)}, margin ${margin >= 0 ? '+' : ''}${Math.round(margin)}` };
  }

  // ---------- Grappling flows ----------
  act(fn: () => Promise<unknown>) {
    if (this.busy || this.over || this.mode === 'break') return;
    this.busy = true;
    const g = this.gen;
    this.ev.changed();
    fn().catch(err => { if (!(err instanceof Abort)) console.error(err); })
      .finally(() => {
        if (g !== this.gen) return;
        this.busy = false;
        for (const f of [this.red, this.blue]) f.nextThink = Math.max(f.nextThink || 0, this.now + 600);
        this.ev.changed();
      });
  }
  private beginPair(top: Fighter) {
    const bot = this.other(top);
    this.top = top; this.bot = bot;
    this.d = top.x <= bot.x ? 1 : -1;
    this.anchor = (top.x + bot.x) / 2;
    // Grappling happens on the camera's line: fold any angle back onto it.
    for (const f of [top, bot]) {
      f.action = { type: 'grapple' }; f.queued = null; f.plannedBlock = null; f.moveDur = 0; f.z = 0;
      f.guard = {}; f.guardTarget = null; f.lean = { x: 0, y: 0 }; f.leanTarget = { x: 0, y: 0 }; f.holdUntil = 0;
    }
    this.ev.tell(null);
  }
  private swapTop() { [this.top, this.bot] = [this.bot, this.top]; this.d = -this.d; }
  private label(pos: Position) { return (FD.pairs[pos].label || pos).toLowerCase(); }

  shoot(att: Fighter) {
    if (this.mode !== 'stand' || att.action.type !== 'idle') return;
    const def = this.other(att);
    if (this.gap() > 125) { if (this.isHuman(att)) this.ev.pop(att.bodyJoints.head, 'Too far', 'miss'); return; }
    this.ev.event?.({ type: 'shoot', attacker: att.color });
    this.act(async () => {
      this.mode = 'grapple';
      att.sta = Math.max(0, att.sta - 10);
      this.beginPair(att);
      this.ev.log(att.name + ' changes levels');
      await this.step(this.pair('level', 260));
      const sa = this.style(att), sd = this.style(def);
      const r1 = await this.contest({ att, def, attStat: sa.takedowns, defStat: sd.td_defense, attTitle: 'Level change: explode!', defTitle: 'Read the level change!' });
      if (r1.margin < R.LEVEL_CHANGE_STUFF) {
        this.ev.event?.({ type: 'takedown', attacker: att.color, outcome: 'stuffed' });
        this.ev.log(def.name + ' reads it and stuffs the shot', r1.detail);
        this.ev.banner('Stuffed', def.name + ' read the level change'); this.ev.sfx?.({ k: 'sprawl' });
        await this.step(this.pair('stuffed', 300));
        await this.step(this.sleep(450));
        return this.backToFeet(500);
      }
      await this.step(this.pair('shot', 220));
      const r2 = await this.contest({ att, def, attStat: sa.takedowns, defStat: sd.td_defense, attTitle: 'Grab: drive through!', defTitle: 'Sprawl!' });
      const land = R.takedownOutcome(r2.margin);
      this.ev.event?.({ type: 'takedown', attacker: att.color, outcome: land });
      if (land === 'sprawl') {
        this.ev.log(def.name + ' sprawls and stuffs the takedown', r2.detail);
        this.ev.banner('Sprawl', 'Takedown stuffed'); this.ev.sfx?.({ k: 'sprawl' });
        await this.step(this.pair('sprawl', 380));
        await this.step(this.sleep(700));
        return this.backToFeet(600);
      }
      await this.step(this.pair('drive', 240));
      this.enterGround(land, 300);
      await this.step(this.sleep(300));
      this.shake = 9; this.ev.rumble(0.8, 200); this.ev.sfx?.({ k: 'slam', heavy: land !== 'guard' });
      this.hurt(def, 'body', 4, att);
      if (land === 'guard') { this.ev.log(def.name + ' scrambles and lands in guard', r2.detail); this.ev.banner('Takedown', def.name + ' lands in closed guard'); }
      else { this.ev.log(`${att.name} takes it down to ${this.label(land)}`, r2.detail); this.ev.banner('Takedown', `${att.name} lands in ${this.label(land)}`); }
      if (this.config.resetGround) { await this.step(this.sleep(1300)); await this.backToFeet(500); }
    });
  }
  private enterGround(pos: Position, dur: number) {
    this.mode = 'ground'; this.pos = pos; this.lastAction = this.now;
    void this.pair(pos, dur);
    this.moveRef('ref_watch');
    this.ev.changed();
  }
  private backToFeet(dur: number) {
    const a = this.red.shown!.P.x, b = this.blue.shown!.P.x, m = clamp((a + b) / 2, -180, 180);
    const left = a <= b ? this.red : this.blue, right = this.other(left);
    left.x = m - 60; right.x = m + 60; left.z = right.z = 0;
    for (const f of [this.red, this.blue]) { this.face(f); f.action = { type: 'idle', since: this.now }; f.moveDur = 0; this.stand(f, 'stance', dur); }
    this.mode = 'stand'; this.pos = null; this.top = this.bot = null; this.camOverride = null;
    this.moveRef('ref_stand');
    this.ev.changed();
    return this.sleep(dur);
  }
  private knockdown(att: Fighter, def: Fighter) {
    this.act(async () => {
      this.mode = 'grapple';
      this.ev.banner('Knockdown', def.name + ' is down'); this.ev.sfx?.({ k: 'knockdown' });
      this.ev.log(att.name + ' drops ' + def.name);
      def.action = { type: 'grapple' };
      this.stand(def, 'ko', 500);
      await this.step(this.sleep(650));
      this.beginPair(att);
      this.anchor = def.x;
      this.enterGround('side', 450);
      await this.step(this.sleep(450));
    });
  }

  // Ground and pound: the top fighter cocks, the bottom fighter can block before it lands.
  punch() {
    this.act(async () => {
      const att = this.top!, def = this.bot!, cpuDef = !this.isHuman(def);
      const cpuBlocks = cpuDef && this.rng() < R.gnpBlockChance(this.style(def), this.style(att));
      if (!cpuDef) this.ev.banner('Block!', 'Press ' + this.ev.key('block'), 500);
      void this.roleAnim(att, 'top_cock', this.isHuman(att) ? 170 : 300);
      if (cpuBlocks) void this.roleAnim(def, 'bot_block', 180);
      await this.step(this.sleep(this.isHuman(att) ? 170 : 340));
      const blocked = cpuDef ? cpuBlocks : performance.now() - this.blockAt < 520;
      await this.step(this.roleAnim(att, 'top_punch', 100));
      const at = def.bodyJoints.head;
      if (blocked) { this.ev.pop(at, 'Blocked', 'block'); this.ev.sfx?.({ k: 'block' }); this.weigh(att, def, 'head', 'blocked', 1, at); this.hurt(def, 'head', 1, att); }
      else {
        const dmg = R.gnpDamage(this.style(att), this.pos!, this.rng());
        this.ev.sfx?.({ k: 'hit', part: 'head', dmg });
        this.ev.pop(at, String(Math.round(dmg)), 'hit');
        this.weigh(att, def, 'head', 'hit', dmg, at);
        this.ev.rumble(this.isHuman(def) ? 0.9 : 0.3, 140);
        void this.roleAnim(def, 'bot_hit', 90);
        this.hurt(def, 'head', dmg, att);
      }
      await this.step(this.sleep(120));
      if (this.checkFinish(att, def, 'Ground and pound')) return;
      void this.roleAnim(att, null, 260);
      await this.step(this.roleAnim(def, null, 300));
    });
  }
  groundBlock() {
    if (this.mode !== 'ground' || this.bot !== this.human() || this.over) return;
    this.blockAt = performance.now();
    void this.roleAnim(this.bot, 'bot_block', 120);
    const at = this.blockAt;
    setTimeout(() => { if (this.blockAt === at && !this.busy && this.mode === 'ground') void this.roleAnim(this.bot!, null, 260); }, 600);
  }
  advance() {
    const to = this.pos && R.NEXT[this.pos];
    if (!to) return;
    this.act(async () => {
      const att = this.top!, def = this.bot!, from = this.pos!;
      const r = await this.contest({ att, def, attStat: this.style(att).top, defStat: this.style(def).guard, attTitle: 'Pass!', defTitle: 'Keep the position!', defBonus: from === 'guard' ? 6 : 0 });
      if (r.margin > 0) {
        this.pos = to; this.lastAction = this.now;
        await this.step(this.pair(to, 520));
        this.ev.log(`${att.name} advances to ${this.label(to)}`, r.detail);
        this.ev.banner(to === 'mount' ? 'Mount' : 'Guard passed');
      } else {
        await this.step(this.roleAnim(def, 'bot_try', 200));
        await this.step(this.roleAnim(def, null, 300));
        this.ev.log(`${def.name} keeps ${this.label(from)}`, r.detail);
      }
    });
  }
  sweep() {
    this.act(async () => {
      const att = this.bot!, def = this.top!, sw = R.SWEEP[this.pos!];
      await this.step(this.roleAnim(att, 'bot_try', 220));
      const r = await this.contest({ att, def, attStat: this.style(att).guard, defStat: this.style(def).top, attTitle: sw.name + '!', defTitle: 'Base out!', defBonus: sw.bonus });
      if (r.margin > 0) {
        if (sw.swap) this.swapTop();
        this.pos = sw.to; this.lastAction = this.now;
        await this.step(this.pair(sw.to, 600));
        this.shake = sw.swap ? 7 : 0;
        this.ev.log(`${att.name}${sw.swap ? ' sweeps into ' : ' recovers '}${this.label(sw.to)}`, r.detail);
        this.ev.banner(sw.swap ? 'Sweep' : 'Guard recovered', sw.name);
      } else {
        await this.step(this.roleAnim(att, null, 320));
        this.ev.log(`${def.name} bases out of the ${sw.name.toLowerCase()}`, r.detail);
      }
    });
  }
  // Top can always stand up and walk away; bottom has to win a contest to get up.
  standUp(f: Fighter) {
    this.act(async () => {
      if (f === this.top) { this.ev.log(`${f.name} stands up out of ${this.label(this.pos!)}`); return this.backToFeet(600); }
      const top = this.top!, sf = this.style(f);
      const r = await this.contest({ att: f, def: top, attStat: (sf.guard + sf.td_defense) / 2, defStat: this.style(top).top, attTitle: 'Get up!', defTitle: 'Hold them down!', defBonus: this.pos === 'mount' ? 15 : this.pos === 'side' ? 6 : 0 });
      if (r.margin > 0) { this.ev.log(f.name + ' gets back to the feet', r.detail); this.ev.banner('Back up'); return this.backToFeet(650); }
      await this.step(this.roleAnim(f, 'bot_try', 220));
      await this.step(this.roleAnim(f, null, 300));
      this.ev.log(`${top.name} holds ${f.name} down`, r.detail);
    });
  }
  canSubmit(f: Fighter) {
    const name = this.mode === 'ground' && this.pos ? FD.sub_from[this.pos] : undefined;
    return !!name && FD.subs[name].by === this.roleOf(f);
  }
  subName() { return this.pos ? FD.sub_from[this.pos] : undefined; }
  submit() {
    this.act(async () => {
      const name = this.subName()!, sub = FD.subs[name];
      const att = sub.by === 'top' ? this.top! : this.bot!, def = this.other(att);
      const attStat = sub.by === 'top' ? this.style(att).top : this.style(att).guard;
      const defStat = R.subDefense(this.style(def), def.headHP, def.headMax);
      this.ev.log(`${att.name} goes for the ${sub.label.toLowerCase()}`);
      const result = await this.step(this.subGame(att, def, attStat, defStat, name));
      this.camOverride = null;
      if (result === 'tap') return this.finish(att, def, 'Tap out', sub.label);
      this.ev.log(`${def.name} escapes the ${sub.label.toLowerCase()}`, `Attack ${attStat} vs defense ${defStat}`);
      this.ev.banner('Escaped', sub.label); this.ev.sfx?.({ k: 'escape' });
      this.lastAction = this.now;
      await this.step(this.pair(this.pos!, 500));
    });
  }
  private subGame(att: Fighter, def: Fighter, attStat: number, defStat: number, name: string) {
    return new Promise<'tap' | 'escape'>(resolve => {
      const sub = FD.subs[name], real = performance.now();
      this.subV = 0.4;
      this.sub = { att, def, attStat, defStat, name, v: 40, start: real, last: real, acc: { att: 0, def: 0 }, resolve };
      this.subAnim(name, 500);
      const d = this.d * (sub.flip ? -1 : 1), q = qEuler([0, d > 0 ? 0 : 180, 0]), off = V(this.anchor, 0, 0);
      const place = (v: [number, number, number]) => V(v[0], v[1], v[2]).applyQuaternion(q).add(off);
      this.camOverride = { pos: place(sub.cine.pos), look: place(sub.cine.look), fov: sub.cine.fov };
      this.ev.changed();
    });
  }
  subTap(side: 'att' | 'def') {
    const s = this.sub;
    if (s) s.v += (side === 'att' ? 1 : -1) * R.subTap(side === 'att' ? s.attStat : s.defStat);
  }
  private tickSub(real: number) {
    const s = this.sub!, dt = (real - s.last) / 1000;
    s.last = real;
    for (const side of ['att', 'def'] as const) {
      if (this.isHuman(s[side])) continue;
      s.acc[side] += dt * R.subCpuRate(side === 'att' ? s.attStat : s.defStat);
      while (s.acc[side] >= 1) { s.acc[side] -= 1; this.subTap(side); }
    }
    s.v = clamp(s.v + R.subDrift(s.attStat, s.defStat, dt), 0, 100);
    this.subV = s.v / 100;
    const done = s.v >= 100 ? 'tap' : (s.v <= 0 || real - s.start > R.SUB_TIME_MS) ? 'escape' : null;
    if (done) { this.sub = null; s.resolve(done); this.ev.changed(); }
  }

  // ---------- Clinch ----------
  // The 'top' role is whoever holds the dominant tie. Knees and elbows are telegraphed, so the other fighter can block them.
  enterClinch(att: Fighter) {
    if (this.mode !== 'stand' || att.action.type !== 'idle') return;
    if (this.gap() > 80) { if (this.isHuman(att)) this.ev.pop(att.bodyJoints.head, 'Too far', 'miss'); return; }
    this.act(async () => {
      this.mode = 'grapple';
      att.sta = Math.max(0, att.sta - 5);
      this.beginPair(att);
      await this.step(this.pair('clinch', 280));
      this.mode = 'clinch'; this.lastAction = this.now; this.clinchSince = this.now;
      this.ev.log(att.name + ' ties up in the clinch');
      this.ev.banner('Clinch', att.name + ' has the tie', 900);
    });
  }
  clinchStrike(att: Fighter, kind: 'knee' | 'elbow') {
    this.act(async () => {
      const def = this.other(att), ctrl = att === this.top, zone: Zone = kind === 'knee' ? 'body' : 'high', cpuDef = !this.isHuman(def);
      const cpuBlocks = cpuDef && this.rng() < R.clinchBlockChance(this.style(def), ctrl, R.LEVELS[this.level].def);
      if (!cpuDef) this.ev.banner(kind === 'knee' ? 'Knee!' : 'Elbow!', 'Block ' + (zone === 'body' ? this.ev.key('block') : this.ev.key('blockhigh')), 500);
      void this.roleAnim(att, kind + '_cock', this.isHuman(att) ? 160 : 280);
      if (cpuBlocks) void this.roleAnim(def, 'block' + zone, 160);
      await this.step(this.sleep(this.isHuman(att) ? 170 : 320));
      const blocked = cpuDef ? cpuBlocks : performance.now() - this.blockAt < 520 && this.blockZone === zone;
      att.sta = Math.max(0, att.sta - (kind === 'knee' ? 6 : 5));
      await this.step(this.roleAnim(att, kind, 100));
      const at = def.bodyJoints[kind === 'knee' ? 'abd' : 'head'];
      if (blocked) { this.ev.pop(at, 'Blocked', 'block'); this.ev.sfx?.({ k: 'block' }); this.weigh(att, def, zone === 'body' ? 'body' : 'head', 'blocked', 1, at); this.hurt(def, zone === 'body' ? 'body' : 'head', 1, att); }
      else {
        const dmg = R.clinchDamage(kind, this.style(att), ctrl, this.rng());
        this.ev.sfx?.({ k: 'hit', part: kind === 'knee' ? 'body' : 'head', dmg });
        this.ev.pop(at, String(Math.round(dmg)), 'hit');
        this.weigh(att, def, kind === 'knee' ? 'body' : 'head', 'hit', dmg, at);
        this.ev.rumble(this.isHuman(def) ? 0.9 : 0.3, 160);
        void this.roleAnim(def, kind === 'knee' ? 'hitbody' : 'hithead', 90);
        this.hurt(def, kind === 'knee' ? 'body' : 'head', dmg, att);
      }
      await this.step(this.sleep(120));
      if (this.checkFinish(att, def, kind === 'knee' ? 'Knees in the clinch' : 'Elbows in the clinch')) return;
      void this.roleAnim(att, null, 240);
      await this.step(this.roleAnim(def, null, 280));
    });
  }
  clinchBlock(zone: Zone) {
    if (this.mode !== 'clinch' || this.over) return;
    this.blockAt = performance.now(); this.blockZone = zone;
    const me = this.human(), at = this.blockAt;
    void this.roleAnim(me, 'block' + zone, 110);
    setTimeout(() => { if (this.blockAt === at && !this.busy && this.mode === 'clinch') void this.roleAnim(me, null, 240); }, 600);
  }
  pummel(att: Fighter) {
    if (att === this.top) return;
    this.act(async () => {
      const def = this.other(att);
      void this.pair('clinch', 200, { top: 'pummel', bot: 'pummel' });
      const r = await this.contest({ att, def, attStat: this.style(att).clinch, defStat: this.style(def).clinch, attTitle: 'Pummel for the tie!', defTitle: 'Keep the tie!' });
      if (r.margin > 0) {
        this.swapTop();
        this.ev.log(att.name + ' wins the inside tie', r.detail);
        this.ev.banner('Tie won', att.name + ' takes control', 800);
      } else this.ev.log(def.name + ' keeps the tie', r.detail);
      this.lastAction = this.now;
      await this.step(this.pair('clinch', 420));
    });
  }
  trip(att: Fighter) {
    this.act(async () => {
      const def = this.other(att), ctrl = att === this.top, sa = this.style(att);
      const r = await this.contest({ att, def, attStat: (sa.clinch + sa.takedowns) / 2 + (ctrl ? 10 : -8), defStat: this.style(def).td_defense, attTitle: 'Trip!', defTitle: 'Stay on your feet!' });
      if (r.margin > 0) {
        if (!ctrl) this.swapTop();
        await this.step(this.pair('drive', 260));
        const land = R.tripLanding(r.margin);
        this.enterGround(land, 300);
        await this.step(this.sleep(300));
        this.shake = 8; this.ev.rumble(0.8, 200); this.ev.sfx?.({ k: 'slam' });
        this.hurt(def, 'body', 4, att);
        this.ev.log(`${att.name} trips ${def.name} into ${this.label(land)}`, r.detail);
        this.ev.banner('Trip', `${att.name} lands in ${this.label(land)}`);
        if (this.config.resetGround) { await this.step(this.sleep(1300)); await this.backToFeet(500); }
      } else {
        this.ev.log(`${def.name} stays up and ${ctrl ? 'takes the tie' : 'keeps the tie'}`, r.detail);
        if (ctrl) this.swapTop();
        this.lastAction = this.now;
        await this.step(this.pair('clinch', 420));
      }
    });
  }
  breakAway(f: Fighter) {
    this.act(async () => {
      if (f === this.top) { this.ev.log(f.name + ' lets go of the clinch'); return this.backToFeet(500); }
      const o = this.other(f), sf = this.style(f);
      const r = await this.contest({ att: f, def: o, attStat: (sf.clinch + sf.defense) / 2, defStat: this.style(o).clinch, attTitle: 'Break free!', defTitle: 'Hold the clinch!' });
      if (r.margin > 0) { this.ev.log(f.name + ' breaks free', r.detail); return this.backToFeet(500); }
      this.ev.log(o.name + ' holds the clinch', r.detail);
      this.lastAction = this.now;
      await this.step(this.pair('clinch', 300, { top: 'pummel', bot: 'pummel' }));
      await this.step(this.pair('clinch', 300));
    });
  }

  // ---------- Finish, rounds, judges ----------
  private checkFinish(att: Fighter, def: Fighter, what: string) {
    const by = R.finishedBy(def);
    if (!by) return false;
    if (this.config.infinite) {
      for (const f of [this.red, this.blue]) { f.headHP = f.headMax; f.body = 0; f.legs = 0; f.sta = 100; }
      this.ev.banner('Reset', `${def.name} would have been finished. Both fighters refilled.`, 1400);
      this.ev.log(`${att.name} would have won by ${by === 'head' ? 'KO' : 'TKO'}`, 'Training: both fighters refilled');
      return false;
    }
    const how = by === 'head' ? [this.mode === 'stand' ? 'KO' : 'TKO', what] : ['TKO', by === 'legs' ? 'leg kicks' : 'body shots'];
    this.finish(att, def, how[0], how[1]);
    return true;
  }
  private finish(winner: Fighter, loser: Fighter, how: string, detail: string) {
    if (this.over) return;
    this.over = true;
    this.ev.tell(null);
    this.timing = null; this.sub = null;
    if (this.mode === 'clinch') {
      const a = this.red.shown!.P.x, b = this.blue.shown!.P.x, left = a <= b ? this.red : this.blue;
      left.x = Math.min(a, b) - 15; this.other(left).x = Math.max(a, b) + 15;
      for (const f of [this.red, this.blue]) this.face(f);
      this.mode = 'stand'; this.top = this.bot = null;
    }
    if (this.mode === 'stand') {
      loser.action = { type: 'down' }; this.stand(loser, 'ko', 1100);
      winner.action = { type: 'done' }; this.stand(winner, 'stance', 300);
      setTimeout(() => this.stand(winner, 'win', 700), 1300);
      this.scale = 0.35; this.slowUntil = performance.now() + 1500;
      this.koCam = loser;
    }
    this.moveRef('ref_stop');
    this.ev.banner(how, `${winner.name} wins by ${detail.toLowerCase()}`, 0);
    this.ev.sfx?.(how === 'Tap out' ? { k: 'tap' } : { k: 'finish', how });
    if (how === 'Tap out') this.ev.sfx?.({ k: 'finish', how });
    this.ev.log(`${winner.name} wins by ${how.toLowerCase()}`, `${detail}, round ${this.round}`);
    this.ev.ended(winner.color, how);
    this.ev.changed();
  }
  private endRound() {
    const card = R.judgeRound(this.red.roundDealt, this.blue.roundDealt);
    this.scores.push(card);
    this.ev.log(`End of round ${this.round}: judges score it ${card[0]}-${card[1]}`, `Damage this round: ${this.red.name} ${Math.round(this.red.roundDealt)}, ${this.blue.name} ${Math.round(this.blue.roundDealt)}`);
    if (this.round >= this.rounds()) return this.decision();
    this.ev.sfx?.({ k: 'bell' });
    this.gen++;
    this.busy = false; this.timing = null; this.sub = null; this.camOverride = null;
    this.mode = 'break';
    this.ev.banner('Round ' + (this.round + 1), `${this.red.name} ${card[0]} – ${card[1]} ${this.blue.name} this round`, 2200);
    const g = this.gen;
    setTimeout(() => {
      if (this.over || g !== this.gen) return;
      this.round++; this.clock = this.roundMs();
      this.ev.sfx?.({ k: 'round', n: this.round, last: this.round === this.rounds() });
      this.ev.sfx?.({ k: 'bell' });
      this.red.x = -70; this.blue.x = 70; this.red.z = this.blue.z = 0;
      for (const f of [this.red, this.blue]) {
        f.moveDur = 0; f.roundDealt = 0; f.sta = R.maxStamina(f.body);
        f.headHP = Math.min(f.headMax, f.headHP + f.headMax * 0.12);
        f.legs = Math.max(0, f.legs - 10);
        this.face(f); f.action = { type: 'idle', since: this.now }; this.stand(f, 'stance', 600);
      }
      this.mode = 'stand'; this.pos = null; this.top = this.bot = null;
      this.moveRef('ref_stand');
      this.ev.changed();
    }, 2400);
    this.ev.changed();
  }
  private decision() {
    const r = R.decision(this.scores);
    this.over = true;
    this.ev.sfx?.({ k: 'end' });
    this.ev.sfx?.({ k: 'decision', draw: !r.winner });
    this.ev.tell(null);
    if (!r.winner) {
      this.ev.banner('Draw', `Judges: ${r.red}–${r.blue}`, 0);
      this.ev.log('Draw', `${r.red}–${r.blue}`);
    } else {
      const w = r.winner === 'red' ? this.red : this.blue;
      if (this.mode === 'stand') { w.action = { type: 'done' }; this.stand(w, 'win', 700); }
      this.ev.banner('Decision', `${w.name} wins ${Math.max(r.red, r.blue)}–${Math.min(r.red, r.blue)} on the cards`, 0);
      this.ev.log(w.name + ' wins by decision', `Judges: ${this.red.name} ${r.red}, ${this.blue.name} ${r.blue}`);
    }
    this.ev.ended(r.winner, 'Decision');
    this.ev.changed();
  }

  // ---------- Referee ----------
  moveRef(pose: string) { this.stand(this.ref, pose, 500); }
  private updateRef(rdt: number) {
    const grappling = this.mode === 'ground' || this.mode === 'grapple' || this.mode === 'clinch';
    const mid = grappling ? this.anchor : (this.red.x + this.blue.x) / 2;
    const side = mid > 120 ? -1 : 1;
    const tx = mid + side * (this.over ? 80 : 195), tz = this.over ? -30 : -120;
    const k = 1 - Math.pow(0.08, rdt / 1000);
    this.ref.x += (tx - this.ref.x) * k; this.ref.z += (tz - this.ref.z) * k;
    this.ref.yaw = side > 0 ? -90 : 90;
  }

  // ---------- Commands from any input device ----------
  // strike:<key>, block:<zone> and evade:<kind> (taps), guard:<zone|off> and lean:<x,y> (held), step:<screen dir>,
  // side:<+1 toward camera | -1 away>, move:<screen x>,<side>, shoot, clinch, knee, elbow, cblock:<zone>, pummel, trip,
  // breakaway, punch, block, advance, sweep, pass (advance or sweep), submit, getup, time.
  command(cmd: string) {
    const me = this.human();
    if (cmd === 'time') {
      if (this.timing) return this.pressTiming();
      if (this.sub) return this.subTap(this.sub.att === me ? 'att' : 'def');
    }
    if (this.over || this.timing || this.sub || this.mode === 'break') return;
    const [kind, arg] = cmd.split(':');
    if (this.mode === 'clinch') {
      if (kind === 'cblock') return this.clinchBlock(arg as Zone);
      if (this.busy) return;
      if (kind === 'knee' || kind === 'elbow') this.clinchStrike(me, kind);
      else if (kind === 'pummel') this.pummel(me);
      else if (kind === 'trip') this.trip(me);
      else if (kind === 'breakaway') this.breakAway(me);
      return;
    }
    if (this.mode === 'stand') {
      const a = me.action;
      if (kind === 'clinch') { if (a.type === 'idle') this.enterClinch(me); return; }
      if (kind === 'strike') {
        if (a.type === 'idle') this.startStrike(me, arg, this.now - a.since < 250);
        // Pressed mid-step or mid-combo, the strike fires as soon as the feet land or the last one recovers.
        else if ((a.type === 'strike' && a.phase !== 'wind') || a.type === 'step') me.queued = { kind: 'strike', key: arg, at: this.now };
      } else if (kind === 'block') this.holdGuard(me, arg as Zone);
      else if (kind === 'evade') this.holdLean(me, arg as EvadeKind);
      else if (kind === 'guard') this.setGuard(me, arg === 'off' ? null : arg as Zone);
      else if (kind === 'lean') { const [x, y] = arg.split(',').map(Number); this.setLean(me, x, y); }
      else if (kind === 'step') this.startStep(me, +arg * me.dir);
      else if (kind === 'side') this.startStep(me, 0, +arg);
      else if (kind === 'move') { const [x, z] = arg.split(',').map(Number); this.startStep(me, x * me.dir, z); }
      else if (kind === 'shoot') { if (a.type === 'idle') this.shoot(me); else if (a.type === 'strike') me.queued = { kind: 'shoot', at: this.now }; }
      return;
    }
    if (this.mode !== 'ground') return;
    if (kind === 'block') return this.groundBlock();
    if (this.busy) return;
    const top = this.top === me;
    if (kind === 'pass') return top ? this.advance() : this.sweep();
    if (kind === 'punch' && top) this.punch();
    else if (kind === 'advance' && top) this.advance();
    else if (kind === 'sweep' && !top) this.sweep();
    else if (kind === 'submit' && this.canSubmit(me)) this.submit();
    else if (kind === 'getup') this.standUp(me);
  }

  // ---------- Debug hooks for automated tests ----------
  debugStandPose(redPose: string, bluePose: string, dist: number, strikeKey?: string) {
    this.gen++; this.over = true; this.mode = 'stand';
    this.red.x = -dist / 2; this.blue.x = dist / 2; this.red.z = this.blue.z = 0;
    for (const f of [this.red, this.blue]) { this.face(f); f.moveDur = 0; f.action = { type: 'done' }; f.shown = null; }
    this.primeBodies();
    for (const f of [this.red, this.blue]) { this.stand(f, 'stance', 0); f.shown = this.animState(f); f.bodyJoints = bodyJoints(f.shown); }
    const s = SD.strikes[strikeKey || 'jab'];
    this.blue.action = { type: 'strike', key: strikeKey || 'jab', s, phase: 'extend', tHit: 0, counter: false, counterMul: 1, gassed: false, aim: cloneJoints(this.red.bodyJoints), attErr: 0, t0: 0, recoverMul: 1, tRecover: 0, tEnd: 0 };
    this.stand(this.red, redPose, 0); this.stand(this.blue, bluePose, 0);
  }
  debugPairPose(name: string, topColor: Color, ov?: Partial<Record<Role, string>>, subU?: number) {
    this.gen++; this.busy = true;
    this.beginPair(this[topColor]); this.anchor = 0; this.mode = 'ground';
    if (FD.subs[name]) { this.subV = subU ?? 0.5; this.subAnim(name, 0); } else void this.pair(name, 0, ov || {});
  }
}
