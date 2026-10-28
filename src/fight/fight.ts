// The fight: standing exchanges, the clinch, takedowns, the ground game, submissions, rounds and the referee.
// Rendering and the DOM stay outside; this module talks to them through FightEvents.
import { FD, SD } from '../data';
import type { EvadeKind, Position, Role, Strike, Style, Zone } from '../data/types';
import { blendState, bodyJoints, clamp, cloneJoints, ease, qEuler, V, add, type Joints, type RigState, type Vector3 } from '../rig/math';
import { PairPoses, resolveStand, standSpec, toWorld, type Opponent } from '../rig/poses';
import type { FighterMesh } from '../rig/stage';
import * as R from './rules';
import { cpuClinch, cpuDefend, cpuGround, cpuSeesWindup, cpuStand } from './cpu';

export type Color = 'red' | 'blue';
export type Mode = 'stand' | 'grapple' | 'clinch' | 'ground' | 'break';
export type PopKind = 'hit' | 'block' | 'miss' | 'gold';

export interface StrikeAction {
  type: 'strike'; key: string; s: Strike; phase: 'wind' | 'extend' | 'hold' | 'recover';
  tHit: number; counter: boolean; counterMul: number; gassed: boolean; aim: Joints;
  recoverMul: number; tRecover: number; tEnd: number;
}
export type Action =
  | { type: 'idle'; since: number }
  | StrikeAction
  | { type: 'block'; zone: Zone; t0: number; tEnd: number }
  | { type: 'evade'; kind: EvadeKind; t0: number; tActive: number; tEnd: number; back: boolean }
  | { type: 'step' | 'stun'; tEnd: number }
  | { type: 'grapple' | 'down' | 'done' };

interface Queued { kind: 'strike' | 'block' | 'evade' | 'shoot'; key?: string; zone?: string; at: number }
export interface Plan { at: number; zone?: Zone; evade?: EvadeKind }
interface Anim { from: RigState | null; fn: () => RigState; t0: number; dur: number }
interface Animated { shown: RigState | null; anim: Anim | null }

export interface Fighter extends Animated {
  color: Color; name: string; style: string; mesh: FighterMesh;
  x: number; z: number; fromX: number; toX: number; moveT0: number; moveDur: number;
  dir: 1 | -1; yaw: number;
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
}
export interface FightSetup { redStyle: string; blueStyle: string; level: R.Level; redName?: string; config?: FightConfig }

/** Structured events for scoring (training drills, stats). */
export type FightEvent =
  | { type: 'throw'; attacker: Color; key: string }
  | { type: 'strike'; attacker: Color; key: string; result: R.DefenseResult | 'whiff' }
  | { type: 'takedown'; attacker: Color; outcome: 'stuffed' | 'sprawl' | Position };

class Abort extends Error {}

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
      color, name, style: 'mma', mesh: meshes[color], x: 0, z: 0, fromX: 0, toX: 0, moveT0: 0, moveDur: 0, dir: 1, yaw: 90,
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
  style(f: Fighter): Style { return SD.styles[f.style]; }
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
    this.config = setup.config || {};
    this.nextAttack = this.now + 1200;
    this.red.name = setup.redName || 'Red';
    Object.assign(this, { over: false, busy: false, mode: 'stand', round: 1, clock: R.ROUND_MS, scale: 1, slowUntil: 0, koCam: null,
      timing: null, sub: null, top: null, bot: null, pos: null, camOverride: null, nextShoot: this.now + 5000, scores: [] });
    const half = (this.config.startDist ?? 120) / 2;
    this.resetFighter(this.red, -half); this.resetFighter(this.blue, half);
    for (const f of [this.red, this.blue]) { this.face(f); this.stand(f, 'stance', 0); }
    this.primeBodies();
    Object.assign(this.ref, { x: 195, z: -120, yaw: -90, shown: null });
    this.moveRef('ref_stand');
    this.ev.tell(null);
    if (!this.config.noClock) this.ev.log('Round 1', `${this.red.name} (${this.style(this.red).label}) vs Blue (${this.style(this.blue).label})`);
    this.ev.changed();
  }
  private resetFighter(f: Fighter, x: number) {
    Object.assign(f, { x, z: 0, fromX: x, toX: x, moveDur: 0, headMax: R.headMax(this.style(f)), body: 0, legs: 0, sta: 100,
      action: { type: 'idle', since: 0 }, clinchUntil: 0, queued: null, counterUntil: 0, dealt: 0, roundDealt: 0,
      shown: null, anim: null, nextThink: 0, plannedBlock: null });
    f.headHP = f.headMax;
  }
  face(f: Fighter) {
    const o = this.other(f);
    f.dir = f.x <= o.x ? 1 : -1;
    if (f.x === o.x) f.dir = f === this.red ? 1 : -1;
    f.yaw = f.dir > 0 ? 90 : -90;
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
      return blendState(t, this.standState(f, 'stance_b'), 0.5 - 0.5 * Math.cos(this.now / 900 * Math.PI * 2));
    }, dur);
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
      (f as Fighter | Referee).mesh.update(f.shown);
    }
    for (const f of [this.red, this.blue]) f.bodyJoints = bodyJoints(f.shown!);
  }

  // ---------- Frame update ----------
  update(real: number, rdt: number) {
    if (this.slowUntil && real > this.slowUntil) { this.scale = 1; this.slowUntil = 0; }
    const dt = rdt * this.scale;
    this.now += dt;
    if (this.timing && real - this.timing.start > this.timing.period * 2.2) this.endTiming(0);
    if (this.sub) this.tickSub(real);
    if (!this.over && this.mode !== 'break') {
      if (!this.config.noClock) {
        this.clock -= dt;
        if (this.clock <= 0) { this.clock = 0; this.endRound(); }
      }
      for (const f of [this.red, this.blue]) {
        f.sta = Math.min(R.maxStamina(f.body), f.sta + R.staminaRegen(this.style(f), f.body, f.action.type === 'idle', dt));
      }
    }
    if (this.mode === 'stand') {
      cpuStand(this, this.blue); cpuDefend(this, this.blue);
      for (const f of [this.red, this.blue]) this.updateStriker(f);
    } else if (this.mode === 'clinch') {
      cpuClinch(this);
      if (!this.busy && !this.over && (this.now - this.lastAction > 9000 || this.now - this.clinchSince > 15000)) {
        this.lastAction = this.now;
        this.act(async () => {
          this.ev.banner('Break', 'The referee breaks the clinch'); this.ev.log('Referee breaks the clinch');
          this.moveRef('ref_stop'); await this.step(this.sleep(400)); await this.backToFeet(500);
        });
      }
    } else if (this.mode === 'ground') {
      cpuGround(this);
      if (!this.busy && !this.over && this.now - this.lastAction > 15000) {
        this.lastAction = this.now;
        this.act(async () => {
          this.ev.banner('Stand up', 'The referee stands them up'); this.ev.log('Referee stands them up');
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
    const windup = R.windupTime(s, this.style(f), { rocked: R.rocked(f.headHP), chained, counter, counterMul, gassed });
    f.sta = Math.max(0, f.sta - s.cost);
    f.counterUntil = 0;
    // Strikes go where the target was when thrown, so head movement can make them miss.
    const aim = cloneJoints(this.other(f).bodyJoints);
    f.action = { type: 'strike', key, s, phase: 'wind', tHit: this.now + windup, counter, counterMul, gassed, aim, recoverMul: 1, tRecover: 0, tEnd: 0 };
    this.stand(f, s.wind, Math.max(80, windup - 70));
    cpuSeesWindup(this, this.other(f), f, s, windup);
    if (!this.isHuman(f) && this.tells) this.ev.tell(s);
    this.lastAction = this.now;
    this.ev.event?.({ type: 'throw', attacker: f.color, key });
  }
  startBlock(f: Fighter, zone: Zone) {
    if (this.mode !== 'stand' || this.over || !['idle', 'block'].includes(f.action.type)) return false;
    const win = R.blockWindow(this.style(f), this.isHuman(f) ? 0 : R.LEVELS[this.level].def);
    f.action = { type: 'block', zone, t0: this.now, tEnd: this.now + win };
    f.sta = Math.max(0, f.sta - 1);
    this.stand(f, 'block_' + zone, 80);
    return true;
  }
  // Head movement: a short window that makes the matching strikes miss entirely, then a brief recovery.
  startEvade(f: Fighter, kind: EvadeKind) {
    if (this.mode !== 'stand' || this.over || !['idle', 'block'].includes(f.action.type)) return false;
    const w = R.evadeWindow(this.style(f), kind, this.isHuman(f) ? 0 : R.LEVELS[this.level].def);
    f.action = { type: 'evade', kind, t0: this.now, tActive: this.now + w.active, tEnd: this.now + w.active + w.recover, back: false };
    f.sta = Math.max(0, f.sta - R.evadeCost(kind));
    this.stand(f, kind, 90);
    return true;
  }
  startStep(f: Fighter, dirn: number) {
    if (this.mode !== 'stand' || this.over || f.action.type !== 'idle') return;
    const o = this.other(f), dist = Math.abs(f.x - o.x);
    let to = f.x + dirn * f.dir * 26;
    if (dirn > 0 && dist - 26 < 48) to = o.x - f.dir * 48;
    to = clamp(to, -250, 250);
    const dur = 200 * (1 + f.legs / 200);
    f.action = { type: 'step', tEnd: this.now + dur };
    Object.assign(f, { fromX: f.x, toX: to, moveT0: this.now, moveDur: dur });
    f.sta = Math.max(0, f.sta - 1);
  }
  private stun(f: Fighter, zone: Zone, dmg: number) {
    const name = { high: 'hit_high', left: 'hit_left', right: 'hit_right', body: 'hit_body', low: 'hit_low' }[zone];
    f.action = { type: 'stun', tEnd: this.now + 160 + dmg * 9 };
    f.queued = null; f.plannedBlock = null;
    if (!this.isHuman(f)) this.ev.tell(null);
    this.stand(f, name, 80);
  }
  private impact(att: Fighter) {
    const a = att.action as StrikeAction, s = a.s, def = this.other(att);
    const at = def.bodyJoints[s.part === 'legs' ? 'lhip' : s.part === 'body' ? 'chest' : 'head']!;
    if (!R.inRange(s, Math.abs(att.x - def.x))) {
      this.ev.pop(at, 'Whiff', 'miss'); a.recoverMul = 1.6;
      this.ev.event?.({ type: 'strike', attacker: att.color, key: a.key, result: 'whiff' });
      return;
    }
    const da = def.action;
    const out = R.defend(s, da.type === 'evade' ? { type: 'evade', kind: da.kind, active: this.now <= da.tActive }
      : da.type === 'block' ? { type: 'block', zone: da.zone, sinceMs: this.now - da.t0 } : { type: 'none' });
    this.ev.event?.({ type: 'strike', attacker: att.color, key: a.key, result: out.result });
    if (out.result === 'dodged') {
      this.ev.pop(at, R.EVADED[(da as { kind: EvadeKind }).kind] + '! Counter', 'gold');
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
    const dmg = R.strikeDamage(s, this.style(att), out.mult, a, this.rng());
    if (dmg >= 1) {
      this.hurt(def, s.part, dmg, att);
      if (out.mult >= 0.5) {
        this.stun(def, s.zone, dmg);
        this.shake = Math.min(10, dmg * 0.5);
        this.ev.rumble(this.isHuman(def) ? 1 : 0.35, this.isHuman(def) ? 220 : 90);
        if (!tag) tag = [(out.result === 'into' ? 'Into it! ' : a.counter ? 'Counter ' : '') + Math.round(dmg), a.counter ? 'gold' : 'hit'];
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
      if (u >= 1) f.moveDur = 0;
    }
    if (a.type === 'strike') {
      if (a.phase === 'wind' && this.now >= a.tHit - 70) { a.phase = 'extend'; this.stand(f, a.s.hit, 70); }
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
    } else if (a.type === 'evade') {
      if (!a.back && this.now >= a.tActive) { a.back = true; this.stand(f, 'stance', a.tEnd - a.tActive + 60); }
      if (this.now >= a.tEnd) this.toIdle(f);
    } else if ((a.type === 'block' || a.type === 'stun' || a.type === 'step') && this.now >= a.tEnd) {
      if (a.type !== 'step') this.stand(f, 'stance', 220);
      this.toIdle(f);
    }
  }
  private toIdle(f: Fighter) {
    f.action = { type: 'idle', since: this.now };
    if (f.queued && !this.over && this.mode === 'stand') {
      const q = f.queued; f.queued = null;
      if (q.kind === 'strike') this.startStrike(f, q.key!, this.now - q.at < 600);
      else if (q.kind === 'block') this.startBlock(f, q.zone as Zone);
      else if (q.kind === 'evade') this.startEvade(f, q.zone as EvadeKind);
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
    for (const f of [top, bot]) { f.action = { type: 'grapple' }; f.queued = null; f.plannedBlock = null; f.moveDur = 0; }
    this.ev.tell(null);
  }
  private swapTop() { [this.top, this.bot] = [this.bot, this.top]; this.d = -this.d; }
  private label(pos: Position) { return (FD.pairs[pos].label || pos).toLowerCase(); }

  shoot(att: Fighter) {
    if (this.mode !== 'stand' || att.action.type !== 'idle') return;
    const def = this.other(att);
    if (Math.abs(att.x - def.x) > 125) { if (this.isHuman(att)) this.ev.pop(att.bodyJoints.head, 'Too far', 'miss'); return; }
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
        this.ev.banner('Stuffed', def.name + ' read the level change');
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
        this.ev.banner('Sprawl', 'Takedown stuffed');
        await this.step(this.pair('sprawl', 380));
        await this.step(this.sleep(700));
        return this.backToFeet(600);
      }
      await this.step(this.pair('drive', 240));
      this.enterGround(land, 300);
      await this.step(this.sleep(300));
      this.shake = 9; this.ev.rumble(0.8, 200);
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
    left.x = m - 60; right.x = m + 60;
    for (const f of [this.red, this.blue]) { this.face(f); f.action = { type: 'idle', since: this.now }; f.moveDur = 0; this.stand(f, 'stance', dur); }
    this.mode = 'stand'; this.pos = null; this.top = this.bot = null; this.camOverride = null;
    this.moveRef('ref_stand');
    this.ev.changed();
    return this.sleep(dur);
  }
  private knockdown(att: Fighter, def: Fighter) {
    this.act(async () => {
      this.mode = 'grapple';
      this.ev.banner('Knockdown', def.name + ' is down');
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
      if (blocked) { this.ev.pop(at, 'Blocked', 'block'); this.hurt(def, 'head', 1, att); }
      else {
        const dmg = R.gnpDamage(this.style(att), this.pos!, this.rng());
        this.ev.pop(at, String(Math.round(dmg)), 'hit');
        this.shake = 5; this.ev.rumble(this.isHuman(def) ? 0.9 : 0.3, 140);
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
      this.ev.banner('Escaped', sub.label);
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
    if (Math.abs(att.x - this.other(att).x) > 80) { if (this.isHuman(att)) this.ev.pop(att.bodyJoints.head, 'Too far', 'miss'); return; }
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
      if (blocked) { this.ev.pop(at, 'Blocked', 'block'); this.hurt(def, zone === 'body' ? 'body' : 'head', 1, att); }
      else {
        const dmg = R.clinchDamage(kind, this.style(att), ctrl, this.rng());
        this.ev.pop(at, String(Math.round(dmg)), 'hit');
        this.shake = Math.min(9, dmg * 0.6); this.ev.rumble(this.isHuman(def) ? 0.9 : 0.3, 160);
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
        this.shake = 8; this.ev.rumble(0.8, 200);
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
    this.ev.log(`${winner.name} wins by ${how.toLowerCase()}`, `${detail}, round ${this.round}`);
    this.ev.ended(winner.color, how);
    this.ev.changed();
  }
  private endRound() {
    const card = R.judgeRound(this.red.roundDealt, this.blue.roundDealt);
    this.scores.push(card);
    this.ev.log(`End of round ${this.round}: judges score it ${card[0]}-${card[1]}`, `Damage this round: ${this.red.name} ${Math.round(this.red.roundDealt)}, Blue ${Math.round(this.blue.roundDealt)}`);
    if (this.round >= R.ROUNDS) return this.decision();
    this.gen++;
    this.busy = false; this.timing = null; this.sub = null; this.camOverride = null;
    this.mode = 'break';
    this.ev.banner('Round ' + (this.round + 1), `${this.red.name} ${card[0]} – ${card[1]} Blue this round`, 2200);
    const g = this.gen;
    setTimeout(() => {
      if (this.over || g !== this.gen) return;
      this.round++; this.clock = R.ROUND_MS;
      this.red.x = -70; this.blue.x = 70;
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
    this.ev.tell(null);
    if (!r.winner) {
      this.ev.banner('Draw', `Judges: ${r.red}–${r.blue}`, 0);
      this.ev.log('Draw', `${r.red}–${r.blue}`);
    } else {
      const w = r.winner === 'red' ? this.red : this.blue;
      if (this.mode === 'stand') { w.action = { type: 'done' }; this.stand(w, 'win', 700); }
      this.ev.banner('Decision', `${w.name} wins ${Math.max(r.red, r.blue)}–${Math.min(r.red, r.blue)} on the cards`, 0);
      this.ev.log(w.name + ' wins by decision', `Judges: ${this.red.name} ${r.red}, Blue ${r.blue}`);
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
  // strike:<key>, block:<zone>, evade:<kind>, step:<screen dir>, shoot, clinch, knee, elbow, cblock:<zone>, pummel, trip,
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
        else if (a.type === 'strike' && a.phase !== 'wind') me.queued = { kind: 'strike', key: arg, at: this.now };
      } else if (kind === 'block') {
        if (!this.startBlock(me, arg as Zone) && a.type === 'strike' && a.phase === 'recover') me.queued = { kind: 'block', zone: arg, at: this.now };
      } else if (kind === 'evade') {
        if (!this.startEvade(me, arg as EvadeKind) && a.type === 'strike' && a.phase === 'recover') me.queued = { kind: 'evade', zone: arg, at: this.now };
      } else if (kind === 'step') this.startStep(me, +arg * me.dir);
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
    this.red.x = -dist / 2; this.blue.x = dist / 2;
    for (const f of [this.red, this.blue]) { this.face(f); f.moveDur = 0; f.action = { type: 'done' }; f.shown = null; }
    this.primeBodies();
    for (const f of [this.red, this.blue]) { this.stand(f, 'stance', 0); f.shown = this.animState(f); f.bodyJoints = bodyJoints(f.shown); }
    const s = SD.strikes[strikeKey || 'jab'];
    this.blue.action = { type: 'strike', key: strikeKey || 'jab', s, phase: 'extend', tHit: 0, counter: false, counterMul: 1, gassed: false, aim: cloneJoints(this.red.bodyJoints), recoverMul: 1, tRecover: 0, tEnd: 0 };
    this.stand(this.red, redPose, 0); this.stand(this.blue, bluePose, 0);
  }
  debugPairPose(name: string, topColor: Color, ov?: Partial<Record<Role, string>>, subU?: number) {
    this.gen++; this.busy = true;
    this.beginPair(this[topColor]); this.anchor = 0; this.mode = 'ground';
    if (FD.subs[name]) { this.subV = subU ?? 0.5; this.subAnim(name, 0); } else void this.pair(name, 0, ov || {});
  }
}
