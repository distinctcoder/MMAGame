// Rigged fighter models (glTF, see docs/MODEL_SPEC.md) driven by the same pose states as the shape-built fighters.
// Each frame the engine's joints and frames are turned into bone rotations: body frames rotate the pelvis, chest and
// head bones, limb bones aim at the IK-solved joint below them, and the bend plane (or the IK pole when a limb is
// straight) sets their twist. Rotations are measured against bases taken from the file's own rest pose, so the
// model's bone roll conventions don't matter.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Palette } from './stage';
import { joints, rot, V, type RigState, type Vector3 } from './math';

/** Model files are in metres; the game works in centimetres. */
const SCALE = 100;
/** Ink outline thickness in model units (metres), matching the shape-built fighters. */
const OUTLINE = 0.011;
/** How far the IK pole steers a limb's twist; it only matters once the limb is nearly straight (cm). */
const POLE_BIAS = 1.5;

const RECOLOR = ['skin', 'hair', 'shorts', 'trim', 'glove', 'cuff'] as const;

export async function loadFighterModel(url: string): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return gltf.scene;
}
/** Parse a .glb already in memory (tests, or a file the player drops in). */
export function parseFighterModel(data: ArrayBuffer): Promise<THREE.Object3D> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(data, '', g => resolve(g.scene), reject));
}

let inkMaterial: THREE.MeshBasicMaterial | null = null;
/** Inverted-hull ink: draw back faces pushed out along the skinned normal. */
function ink(): THREE.MeshBasicMaterial {
  if (inkMaterial) return inkMaterial;
  inkMaterial = new THREE.MeshBasicMaterial({ color: '#1a120d', side: THREE.BackSide });
  inkMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>\n  transformed += normalize(objectNormal) * ${OUTLINE.toFixed(4)};`);
  };
  return inkMaterial;
}

type Limb = { upper: string; lower: string; root: 'lsh' | 'rsh' | 'lhip' | 'rhip'; mid: 'lel' | 'rel' | 'lkn' | 'rkn'; end: 'lwr' | 'rwr' | 'lan' | 'ran'; pole: 'lh' | 'rh' | 'lf' | 'rf'; fold: 1 | -1 };
// fold: which way the lower bone folds relative to the body's forward axis at rest (elbows forward, knees back).
const LIMBS: Limb[] = [
  { upper: 'upperarm_l', lower: 'forearm_l', root: 'lsh', mid: 'lel', end: 'lwr', pole: 'lh', fold: 1 },
  { upper: 'upperarm_r', lower: 'forearm_r', root: 'rsh', mid: 'rel', end: 'rwr', pole: 'rh', fold: 1 },
  { upper: 'thigh_l', lower: 'shin_l', root: 'lhip', mid: 'lkn', end: 'lan', pole: 'lf', fold: -1 },
  { upper: 'thigh_r', lower: 'shin_r', root: 'rhip', mid: 'rkn', end: 'ran', pole: 'rf', fold: -1 }
];
/** Bones set straight from an engine frame. */
const FRAME_BONES: [string, 'Qp' | 'Qc' | 'Qh'][] = [['pelvis', 'Qp'], ['spine', 'Qc'], ['chest', 'Qc'], ['clavicle_l', 'Qc'], ['clavicle_r', 'Qc'], ['head', 'Qh']];
/** Parents are solved before children. */
const ORDER = ['pelvis', 'spine', 'chest', 'neck', 'head', 'clavicle_l', 'upperarm_l', 'forearm_l', 'hand_l', 'clavicle_r', 'upperarm_r', 'forearm_r', 'hand_r',
  'thigh_l', 'shin_l', 'foot_l', 'thigh_r', 'shin_r', 'foot_r'];
export const REQUIRED_BONES = ['root', ...ORDER];

/** A rotation from an orthonormal frame given by its Y and (approximate) Z axes. */
function basis(y: Vector3, zHint: Vector3): THREE.Quaternion {
  const Y = y.clone().normalize();
  const Z = zHint.clone().sub(Y.clone().multiplyScalar(zHint.dot(Y)));
  if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).sub(Y.clone().multiplyScalar(Y.z));
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}
/** The direction the lower bone folds toward, perpendicular to the upper bone. Uses the IK pole when the limb is straight. */
function foldDir(u: Vector3, mid: Vector3, end: Vector3, pole: Vector3): Vector3 {
  const perp = (v: Vector3) => v.clone().sub(u.clone().multiplyScalar(v.dot(u)));
  return perp(end.clone().sub(mid)).add(perp(pole).multiplyScalar(-POLE_BIAS));
}

export class ModelBody {
  readonly root = new THREE.Group();
  private bones: Record<string, THREE.Bone> = {};
  private rest: Record<string, THREE.Quaternion> = {};      // rest world rotation per bone
  private restBasisInv: Record<string, THREE.Quaternion> = {};
  private mats: Partial<Record<typeof RECOLOR[number], THREE.MeshToonMaterial>> = {};
  private world: Record<string, THREE.Quaternion> = {};

  constructor(template: THREE.Object3D, toon: (color: string) => THREE.MeshToonMaterial, pal: Palette) {
    const model = cloneSkinned(template);
    model.scale.setScalar(SCALE);
    this.root.add(model);
    const skinned: THREE.SkinnedMesh[] = [];
    model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
    for (const m of skinned) {
      const name = (m.material as THREE.Material).name;
      if (name === 'eye') m.material = new THREE.MeshBasicMaterial({ color: '#16100c' });
      else {
        const key = (RECOLOR as readonly string[]).includes(name) ? name as typeof RECOLOR[number] : 'skin';
        m.material = this.mats[key] ??= toon(pal[key]);
      }
      m.frustumCulled = false;
      if (name !== 'eye') {
        const outline = new THREE.SkinnedMesh(m.geometry, ink());
        outline.bind(m.skeleton, m.bindMatrix);
        outline.frustumCulled = false;
        m.parent!.add(outline);
      }
      for (const b of m.skeleton.bones) this.bones[b.name] = b;
    }
    const missing = REQUIRED_BONES.filter(n => !this.bones[n]);
    if (missing.length) throw new Error('Fighter model is missing bones: ' + missing.join(', '));

    // Rest pose: world rotations, and the frames the engine uses, measured on this file's skeleton.
    this.root.updateMatrixWorld(true);
    const p = (n: string) => this.bones[n].getWorldPosition(new THREE.Vector3());
    for (const n of ORDER) this.rest[n] = this.bones[n].getWorldQuaternion(new THREE.Quaternion());
    const fwd = V(0, 0, 1), up = V(0, 1, 0);
    const setBasis = (n: string, y: Vector3, z: Vector3) => { this.restBasisInv[n] = basis(y, z).invert(); };
    setBasis('neck', p('head').sub(p('neck')), fwd);
    for (const L of LIMBS) {
      const u = p(L.lower).sub(p(L.upper)), f = p(L.lower.startsWith('forearm') ? 'hand' + L.lower.slice(-2) : 'foot' + L.lower.slice(-2)).sub(p(L.lower));
      setBasis(L.upper, u, fwd);
      const X = new THREE.Vector3().crossVectors(u.clone().normalize(), fwd);
      setBasis(L.lower, f, X.clone().cross(f));
    }
    for (const s of ['_l', '_r']) {
      const ankle = p('foot' + s), ball = this.ballOf('foot' + s);
      setBasis('foot' + s, ball.sub(ankle), up);
    }
  }

  /** World position of the end of a foot bone (its tail), from the bone's rest length. */
  private ballOf(name: string): Vector3 {
    const b = this.bones[name];
    const child = b.children.find(c => (c as THREE.Bone).isBone);
    if (child) return child.getWorldPosition(new THREE.Vector3());
    // No child bone: the spec puts the ball of the foot 15 cm forward and 5 cm down from the ankle.
    return b.getWorldPosition(new THREE.Vector3()).add(V(0, -5, 15));
  }

  update(st: RigState) {
    const j = joints(st), W = this.world;
    const delta = (n: string, y: Vector3, z: Vector3) => basis(y, z).multiply(this.restBasisInv[n]);
    for (const [n, q] of FRAME_BONES) W[n] = st[q].clone().multiply(this.rest[n]);
    W.neck = delta('neck', j.head.clone().sub(j.chest), rot(st.Qh, [0, 0, 1])).multiply(this.rest.neck);
    for (const L of LIMBS) {
      const root = j[L.root], mid = j[L.mid], end = j[L.end];
      const u = mid.clone().sub(root).normalize(), f = end.clone().sub(mid);
      const Z = foldDir(u, mid, end, st.p[L.pole]).multiplyScalar(L.fold);
      W[L.upper] = delta(L.upper, u, Z).multiply(this.rest[L.upper]);
      const X = new THREE.Vector3().crossVectors(u, Z.normalize());
      W[L.lower] = delta(L.lower, f, X.clone().cross(f)).multiply(this.rest[L.lower]);
    }
    for (const s of ['_l', '_r'] as const) {
      // Wrists don't bend: the hand turns with the forearm.
      const fore = 'forearm' + s;
      W['hand' + s] = W[fore].clone().multiply(this.rest[fore].clone().invert()).multiply(this.rest['hand' + s]);
      // The foot points along the engine's toe direction, flattened against the shin.
      const an = j[s === '_l' ? 'lan' : 'ran'], kn = j[s === '_l' ? 'lkn' : 'rkn'];
      const shinUp = kn.clone().sub(an).normalize();
      const fd = st.fd.clone().sub(shinUp.clone().multiplyScalar(st.fd.dot(shinUp)));
      if (fd.lengthSq() < 1e-6) fd.copy(rot(st.Qy, [0, 0, 1]));
      fd.normalize();
      W['foot' + s] = delta('foot' + s, fd.multiplyScalar(15).sub(shinUp.clone().multiplyScalar(5)), shinUp).multiply(this.rest['foot' + s]);
    }

    // World rotations to local ones, parents first; the pelvis also takes the engine's hip position.
    const pelvis = this.bones.pelvis, parent = pelvis.parent!;
    parent.updateWorldMatrix(true, false);
    pelvis.position.copy(parent.worldToLocal(j.pelvis.clone()));
    const parentWorld = parent.getWorldQuaternion(new THREE.Quaternion());
    for (const n of ORDER) {
      const b = this.bones[n], pn = b.parent!.name;
      const pq = W[pn] ?? (b.parent === parent ? parentWorld : b.parent!.getWorldQuaternion(new THREE.Quaternion()));
      b.quaternion.copy(pq.clone().invert().multiply(W[n]));
    }
  }

  setPalette(p: Palette) {
    for (const k of RECOLOR) this.mats[k]?.color.set(p[k]);
  }

  /** World positions of named bones, for tests and debugging. */
  bonePositions(): Record<string, Vector3> {
    this.root.updateMatrixWorld(true);
    return Object.fromEntries(Object.entries(this.bones).map(([n, b]) => [n, b.getWorldPosition(new THREE.Vector3())]));
  }
}
