// Joint math for the toon rig: body joints from hip, chest and head frames, and two-bone IK for the limbs.
import * as THREE from 'three';
import type { LimbKey, Vec3 } from '../data/types';

export type Vector3 = THREE.Vector3;
export type Quaternion = THREE.Quaternion;

export const D = Math.PI / 180;
export const V = (x = 0, y = 0, z = 0): Vector3 => new THREE.Vector3(x, y, z);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
export const ease = (u: number): number => u * u * (3 - 2 * u);

/** Body proportions, roughly in centimeters. */
export const DIM = { hipX: 10, hipY: -3, abd: 20, chest: 30, shX: 18, shY: -5, neck: 17, throat: 7, ua: 30, fa: 27, th: 44, sh: 44 };

export const qEuler = (a?: Vec3 | number[]): Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler((a?.[0] || 0) * D, (a?.[1] || 0) * D, (a?.[2] || 0) * D, 'YXZ'));
export const rot = (q: Quaternion, arr: Vec3 | number[]): Vector3 => V(arr[0], arr[1], arr[2]).applyQuaternion(q);
export const add = (p: Vector3, q: Quaternion, arr: Vec3 | number[]): Vector3 => p.clone().add(rot(q, arr));

export type JointName = 'pelvis' | 'abd' | 'chest' | 'head' | 'neck' | 'lsh' | 'rsh' | 'lhip' | 'rhip'
  | 'lel' | 'rel' | 'lwr' | 'rwr' | 'lkn' | 'rkn' | 'lan' | 'ran';
export type Joints = Partial<Record<JointName, Vector3>> & Record<'pelvis' | 'abd' | 'chest' | 'head' | 'neck' | 'lsh' | 'rsh' | 'lhip' | 'rhip', Vector3>;

export interface Limb { k: LimbKey; root: JointName; mid: JointName; end: JointName; l1: number; l2: number; arm: boolean; side: 1 | -1 }
export const LIMBS: Limb[] = [
  { k: 'lh', root: 'lsh', mid: 'lel', end: 'lwr', l1: DIM.ua, l2: DIM.fa, arm: true, side: 1 },
  { k: 'rh', root: 'rsh', mid: 'rel', end: 'rwr', l1: DIM.ua, l2: DIM.fa, arm: true, side: -1 },
  { k: 'lf', root: 'lhip', mid: 'lkn', end: 'lan', l1: DIM.th, l2: DIM.sh, arm: false, side: 1 },
  { k: 'rf', root: 'rhip', mid: 'rkn', end: 'ran', l1: DIM.th, l2: DIM.sh, arm: false, side: -1 }
];

/** The frames that place a body. */
export interface BodyFrames { P: Vector3; Qp: Quaternion; Qc: Quaternion; Qh: Quaternion; Qy: Quaternion }
/** A full pose in world space: body frames plus a target and bend direction for each limb, and the toe direction. */
export interface RigState extends BodyFrames {
  t: Record<LimbKey, Vector3>;
  p: Record<LimbKey, Vector3>;
  fd: Vector3;
}

export function bodyJoints(st: BodyFrames): Joints {
  const abd = add(st.P, st.Qp, [0, DIM.abd, 0]);
  const chest = add(abd, st.Qc, [0, DIM.chest, 0]);
  return {
    pelvis: st.P.clone(),
    abd,
    chest,
    head: add(chest, st.Qh, [0, DIM.neck, 0]),
    neck: add(chest, st.Qc, [0, DIM.throat, 0]),
    lsh: add(chest, st.Qc, [DIM.shX, DIM.shY, 0]),
    rsh: add(chest, st.Qc, [-DIM.shX, DIM.shY, 0]),
    lhip: add(st.P, st.Qp, [DIM.hipX, DIM.hipY, 0]),
    rhip: add(st.P, st.Qp, [-DIM.hipX, DIM.hipY, 0])
  };
}

/** Two-bone IK: place the elbow or knee so the hand or foot reaches the target, bending toward the pole. */
export function ik(root: Vector3, target: Vector3, l1: number, l2: number, pole: Vector3): [Vector3, Vector3] {
  const span = target.clone().sub(root);
  const dir = span.lengthSq() > 1e-6 ? span.clone().normalize() : V(0, -1, 0);
  const d = clamp(span.length(), Math.abs(l1 - l2) + 0.5, l1 + l2 - 0.3);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (p.lengthSq() < 1e-6) p.set(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y));
  p.normalize();
  return [root.clone().add(dir.clone().multiplyScalar(a)).add(p.multiplyScalar(h)), root.clone().add(dir.multiplyScalar(d))];
}

export function solveLimbs(st: RigState, j: Joints): void {
  for (const L of LIMBS) [j[L.mid], j[L.end]] = ik(j[L.root]!, st.t[L.k], L.l1, L.l2, st.p[L.k]);
}
export function joints(st: RigState): Required<Joints> {
  const j = bodyJoints(st);
  solveLimbs(st, j);
  return j as Required<Joints>;
}

export function blendState(a: RigState, b: RigState, u: number): RigState {
  const t = {} as Record<LimbKey, Vector3>, p = {} as Record<LimbKey, Vector3>;
  for (const L of LIMBS) {
    t[L.k] = a.t[L.k].clone().lerp(b.t[L.k], u);
    p[L.k] = a.p[L.k].clone().lerp(b.p[L.k], u).normalize();
  }
  return {
    P: a.P.clone().lerp(b.P, u), Qp: a.Qp.clone().slerp(b.Qp, u), Qc: a.Qc.clone().slerp(b.Qc, u),
    Qh: a.Qh.clone().slerp(b.Qh, u), Qy: a.Qy.clone().slerp(b.Qy, u), fd: a.fd.clone().lerp(b.fd, u).normalize(), t, p
  };
}

export function cloneJoints(j: Joints): Joints {
  return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, (v as Vector3).clone()])) as Joints;
}
