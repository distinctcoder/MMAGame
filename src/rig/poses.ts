// Turn pose specs from the data files into world-space rig states.
import type { FightData, LimbKey, Pole, PoseSpec, Role, StrikeData, Target, TargetSpec, Vec3 } from '../data/types';
import { LIMBS, V, add, bodyJoints, qEuler, rot, solveLimbs, type BodyFrames, type Joints, type JointName, type Limb, type RigState, type Vector3 } from './math';

const isVec = (v: unknown): v is Vec3 => Array.isArray(v);
const vec = (v: Vec3): Vector3 => V(v[0], v[1], v[2]);
const poleKey = (k: LimbKey) => (k + 'p') as `${LimbKey}p`;

function defaultPole(L: Limb, f: BodyFrames): Vector3 {
  return L.arm ? rot(f.Qc, [0.6 * L.side, -1, -0.3]).normalize() : rot(f.Qp, [0, 0, 1]);
}
function poleFrom(spec: Pole | undefined, L: Limb, f: BodyFrames): Vector3 {
  if (!spec) return defaultPole(L, f);
  if (isVec(spec)) return rot(L.arm ? f.Qc : f.Qp, spec).normalize();
  return vec(spec.w).normalize();
}

// ---------- Standing poses: one fighter, in their own facing frame ----------

export interface StandBody { x: number; z: number; yaw: number }
export interface Opponent { joints: Joints; yaw: number }

export function standSpec(sd: StrikeData, name: string): PoseSpec {
  return { ...sd.poses.stance, ...(sd.poses[name] || {}) } as PoseSpec;
}

/** Resolve a standing pose. Targets like {j: 'opp.head'} aim at the opponent's joints. wobbleDeg sways a rocked fighter. */
export function resolveStand(s: PoseSpec, body: StandBody, opp: Opponent | null, wobbleDeg = 0): RigState {
  const Qy = qEuler([0, body.yaw, 0]);
  const Qp = Qy.clone().multiply(qEuler(s.rot));
  if (wobbleDeg) Qp.multiply(qEuler([0, 0, wobbleDeg]));
  const Qc = Qp.clone().multiply(qEuler(s.spine));
  const Qh = Qc.clone().multiply(qEuler(s.head));
  const base = V(body.x, 0, body.z);
  const pelvis = s.pelvis as { b: Vec3 };
  const frames: BodyFrames = { P: add(base, Qy, pelvis.b), Qp, Qc, Qh, Qy };
  const j = bodyJoints(frames);
  const point = (spec: Target | undefined): Vector3 => {
    const t = spec as TargetSpec;
    if (t.h) return add(base, Qy, t.h);
    if (t.hc) return add(j.chest, Qy, t.hc);
    if (!opp || !t.j) return j.pelvis.clone();
    const name = t.j.split('.')[1] as JointName;
    return add(opp.joints[name] || opp.joints.pelvis, qEuler([0, opp.yaw, 0]), t.o || [0, 0, 0]);
  };
  const tt = {} as Record<LimbKey, Vector3>, pp = {} as Record<LimbKey, Vector3>;
  for (const L of LIMBS) {
    tt[L.k] = point(s[L.k]);
    pp[L.k] = poleFrom(s[poleKey(L.k)], L, frames);
  }
  return { ...frames, t: tt, p: pp, fd: rot(Qy, [0, 0, 1]) };
}

// ---------- Paired poses: two fighters in one shared frame ----------

type Ctx = Partial<Record<Role, { st: BodyFrames & Partial<RigState>; j: Joints }>>;

function pairPoint(spec: Target | undefined, self: { st: BodyFrames; j: Joints } | null, ctx: Ctx): Vector3 | null {
  if (!spec) return null;
  if (isVec(spec)) return vec(spec);
  if (self && spec.l) return add(self.st.P, self.st.Qp, spec.l);
  if (self && spec.c) return add(self.j.chest, self.st.Qc, spec.c);
  if (self && spec.hc) return add(self.j.chest, self.st.Qy, spec.hc);
  if (self && spec.h) return add(V(self.st.P.x, 0, self.st.P.z), self.st.Qy, spec.h);
  const [role, name] = (spec.j || '').split('.') as [Role, JointName];
  const ref = ctx[role];
  if (!ref) return null;
  const base = ref.j[name] || ref.j.pelvis;
  if (spec.oc) return add(base, ref.st.Qc, spec.oc);
  return add(base, ref.st.Qy, spec.o || [0, 0, 0]);
}

/** Solve both fighters of a pair. Limbs run twice so a hand can grip a limb that is solved later. */
export function resolveCanon(specs: Record<Role, PoseSpec>, order: Role[]): Record<Role, RigState> {
  const ctx: Ctx = {};
  for (const r of order) {
    const s = specs[r], rotv = s.rot || [0, 0, 0];
    const Qp = qEuler(rotv), Qy = qEuler([0, rotv[1], 0]);
    const Qc = Qp.clone().multiply(qEuler(s.spine));
    const Qh = Qc.clone().multiply(qEuler(s.head));
    const P = pairPoint(s.pelvis as Target, null, ctx) || V();
    const st = { P, Qp, Qy, Qc, Qh };
    ctx[r] = { st, j: bodyJoints(st) };
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const r of order) {
      const s = specs[r], f = ctx[r]!;
      const t = {} as Record<LimbKey, Vector3>, p = {} as Record<LimbKey, Vector3>;
      for (const L of LIMBS) {
        t[L.k] = pairPoint(s[L.k], f, ctx) || add(f.j[L.root]!, f.st.Qp, [0, -40, 0]);
        p[L.k] = poleFrom(s[poleKey(L.k)], L, f.st);
      }
      const full: RigState = { ...f.st, t, p, fd: s.fd ? vec(s.fd).normalize() : rot(f.st.Qy, [0, 0, 1]) };
      f.st = full;
      solveLimbs(full, f.j);
    }
  }
  return { top: ctx.top!.st as RigState, bot: ctx.bot!.st as RigState };
}

const mergeRole = (a: PoseSpec, b?: Partial<PoseSpec>): PoseSpec => (b ? { ...a, ...b } : a);

/** Caches solved pairs, since a pair pose with given overlays never changes. */
export class PairPoses {
  private cache = new Map<string, Record<Role, RigState>>();
  constructor(private fd: FightData) {}

  pair(name: string, ovTop?: string | null, ovBot?: string | null): Record<Role, RigState> {
    const key = name + '|' + (ovTop || '') + '|' + (ovBot || '');
    let hit = this.cache.get(key);
    if (!hit) {
      const p = this.fd.pairs[name], ov = p.overlays || {};
      hit = resolveCanon({ top: mergeRole(p.top, ovTop ? ov[ovTop]?.top : undefined), bot: mergeRole(p.bot, ovBot ? ov[ovBot]?.bot : undefined) }, p.order);
      this.cache.set(key, hit);
    }
    return hit;
  }

  sub(name: string, tight: boolean): Record<Role, RigState> {
    const key = 'sub|' + name + '|' + tight;
    let hit = this.cache.get(key);
    if (!hit) {
      const s = this.fd.subs[name];
      hit = resolveCanon({ top: mergeRole(s.loose.top, tight ? s.tight.top : undefined), bot: mergeRole(s.loose.bot, tight ? s.tight.bot : undefined) }, s.order);
      this.cache.set(key, hit);
    }
    return hit;
  }
}

/** Place a canonical pair state in the world: rotate 180 degrees when the top fighter faces -x, then move to the anchor. */
export function toWorld(s: RigState, d: number, anchor: number): RigState {
  const q = qEuler([0, d > 0 ? 0 : 180, 0]), off = V(anchor, 0, 0);
  const tp = (p: Vector3) => p.clone().applyQuaternion(q).add(off);
  const t = {} as Record<LimbKey, Vector3>, p = {} as Record<LimbKey, Vector3>;
  for (const L of LIMBS) { t[L.k] = tp(s.t[L.k]); p[L.k] = s.p[L.k].clone().applyQuaternion(q); }
  return {
    P: tp(s.P), Qp: q.clone().multiply(s.Qp), Qc: q.clone().multiply(s.Qc), Qh: q.clone().multiply(s.Qh), Qy: q.clone().multiply(s.Qy),
    fd: s.fd.clone().applyQuaternion(q), t, p
  };
}
