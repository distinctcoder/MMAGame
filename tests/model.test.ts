// The rigged test model (public/models/fighter_test.glb) must land on the engine's joints in every pose,
// or hands miss heads and grips miss limbs. This drives the real file through all standing and paired poses.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { FD, SD } from '../src/data';
import { joints, type RigState } from '../src/rig/math';
import { ModelBody, parseFighterModel, REQUIRED_BONES } from '../src/rig/model';
import { PairPoses, resolveStand, standSpec, toWorld } from '../src/rig/poses';
import { PALETTES } from '../src/rig/stage';

// Engine joint -> the bone whose head sits on it.
const AT: Record<string, string> = {
  pelvis: 'pelvis', abd: 'spine', chest: 'neck', head: 'head',
  lsh: 'upperarm_l', lel: 'forearm_l', lwr: 'hand_l', rsh: 'upperarm_r', rel: 'forearm_r', rwr: 'hand_r',
  lhip: 'thigh_l', lkn: 'shin_l', lan: 'foot_l', rhip: 'thigh_r', rkn: 'shin_r', ran: 'foot_r'
};
const TOLERANCE = 0.5; // cm

let template: THREE.Object3D;
beforeAll(async () => {
  const buf = readFileSync(new URL('../public/models/fighter_test.glb', import.meta.url));
  template = await parseFighterModel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
});
const toon = (c: string) => new THREE.MeshToonMaterial({ color: c });

/** Largest distance between an engine joint and the model bone that should sit on it. */
function worstError(body: ModelBody, st: RigState): { joint: string; cm: number } {
  body.update(st);
  const j = joints(st) as unknown as Record<string, THREE.Vector3>, bones = body.bonePositions();
  let worst = { joint: '', cm: 0 };
  for (const [joint, bone] of Object.entries(AT)) {
    const d = j[joint].distanceTo(bones[bone]);
    if (d > worst.cm) worst = { joint, cm: d };
  }
  return worst;
}

describe('test fighter model', () => {
  it('has every bone the spec names', () => {
    const names = new Set<string>();
    template.traverse(o => { if ((o as THREE.Bone).isBone) names.add(o.name); });
    for (const n of REQUIRED_BONES) expect(names.has(n), n).toBe(true);
  });

  it('follows every standing pose, facing either way', () => {
    const body = new ModelBody(template, toon, PALETTES.red);
    for (const name of Object.keys(SD.poses)) {
      if (name.startsWith('ref_')) continue;
      for (const yaw of [90, -90]) {
        const st = resolveStand(standSpec(SD, name), { x: 40, z: 0, yaw }, null);
        const w = worstError(body, st);
        expect(w.cm, `${name} yaw ${yaw}: ${w.joint} off by ${w.cm.toFixed(2)} cm`).toBeLessThan(TOLERANCE);
      }
    }
  });

  it('follows every clinch, takedown, ground and submission pose, top and bottom', () => {
    const body = new ModelBody(template, toon, PALETTES.red), poses = new PairPoses(FD);
    const check = (label: string, pair: Record<'top' | 'bot', RigState>) => {
      for (const role of ['top', 'bot'] as const) {
        for (const dir of [1, -1] as const) {
          const w = worstError(body, toWorld(pair[role], dir, 20));
          expect(w.cm, `${label} ${role} dir ${dir}: ${w.joint} off by ${w.cm.toFixed(2)} cm`).toBeLessThan(TOLERANCE);
        }
      }
    };
    for (const [name, p] of Object.entries(FD.pairs)) {
      check(name, poses.pair(name));
      for (const [ov, roles] of Object.entries(p.overlays || {})) check(`${name}+${ov}`, poses.pair(name, roles.top ? ov : null, roles.bot ? ov : null));
    }
    for (const name of Object.keys(FD.subs)) for (const tight of [false, true]) check(`${name}${tight ? ' tight' : ''}`, poses.sub(name, tight));
  });

  it('recolors gear without touching other parts', () => {
    const body = new ModelBody(template, toon, PALETTES.red);
    body.setPalette({ ...PALETTES.red, shorts: '#00ff00' });
    const colors: Record<string, string> = {};
    body.root.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
      if (m?.isMeshToonMaterial) colors[(o as THREE.Mesh).name] = '#' + m.color.getHexString();
    });
    expect(Object.entries(colors).filter(([, c]) => c === '#00ff00').map(([n]) => n)).toEqual(['shorts']);
  });
});
