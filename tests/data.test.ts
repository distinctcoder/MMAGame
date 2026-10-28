// Guards against typos in the data files: every name a move, pose or style refers to must exist, and every pose must solve.
import { describe, expect, it } from 'vitest';
import { FD, SD } from '../src/data';
import { LIMBS, type RigState } from '../src/rig/math';
import { PairPoses, resolveStand, standSpec } from '../src/rig/poses';

const finite = (st: RigState) => [st.P, ...LIMBS.flatMap(L => [st.t[L.k], st.p[L.k]]), st.fd].every(v => [v.x, v.y, v.z].every(Number.isFinite));

describe('strike data', () => {
  it('has a windup and a hit pose for every strike', () => {
    for (const [k, s] of Object.entries(SD.strikes)) {
      expect(SD.poses[s.wind], `${k}.wind`).toBeDefined();
      expect(SD.poses[s.hit], `${k}.hit`).toBeDefined();
    }
  });
  it('uses known zones and head movements, with sensible ranges', () => {
    for (const [k, s] of Object.entries(SD.strikes)) {
      expect(SD.zones[s.zone], `${k}.zone`).toBeDefined();
      for (const e of Object.keys(s.evade || {})) expect(SD.evades[e as keyof typeof SD.evades], `${k}.evade.${e}`).toBeDefined();
      expect(s.range[0]).toBeLessThan(s.range[1]);
    }
  });
  it('has poses for every block, head movement and hit reaction', () => {
    for (const z of Object.keys(SD.zones)) {
      expect(SD.poses['block_' + z], 'block_' + z).toBeDefined();
      expect(SD.poses['hit_' + z], 'hit_' + z).toBeDefined();
    }
    for (const e of Object.keys(SD.evades)) expect(SD.poses[e], e).toBeDefined();
  });
  it('gives every style every stat, and only known strikes in its mix', () => {
    const stats = ['power', 'speed', 'defense', 'chin', 'cardio', 'kicks', 'evasion', 'clinch', 'takedowns', 'td_defense', 'top', 'guard', 'range', 'aggression'];
    for (const [k, s] of Object.entries(SD.styles)) {
      for (const stat of stats) expect(typeof (s as unknown as Record<string, number>)[stat], `${k}.${stat}`).toBe('number');
      for (const m of Object.keys(s.mix)) expect(SD.strikes[m], `${k}.mix.${m}`).toBeDefined();
    }
  });
  it('solves every standing pose to finite numbers', () => {
    const opp = resolveStand(standSpec(SD, 'stance'), { x: 60, z: 0, yaw: -90 }, null);
    const joints = { pelvis: opp.P, abd: opp.P, chest: opp.P, head: opp.P, neck: opp.P, lsh: opp.P, rsh: opp.P, lhip: opp.P, rhip: opp.P };
    for (const name of Object.keys(SD.poses)) {
      expect(finite(resolveStand(standSpec(SD, name), { x: -60, z: 0, yaw: 90 }, { joints, yaw: -90 })), name).toBe(true);
    }
  });
});

describe('fight data', () => {
  const poses = new PairPoses(FD);
  it('solves every pair, with every overlay, to finite numbers', () => {
    for (const [name, p] of Object.entries(FD.pairs)) {
      const base = poses.pair(name);
      expect(finite(base.top) && finite(base.bot), name).toBe(true);
      for (const [ov, roles] of Object.entries(p.overlays || {})) {
        const st = poses.pair(name, roles.top ? ov : null, roles.bot ? ov : null);
        expect(finite(st.top) && finite(st.bot), `${name}+${ov}`).toBe(true);
      }
    }
  });
  it('solves every submission, loose and tight', () => {
    for (const name of Object.keys(FD.subs)) {
      for (const tight of [false, true]) {
        const st = poses.sub(name, tight);
        expect(finite(st.top) && finite(st.bot), `${name} ${tight}`).toBe(true);
      }
    }
  });
  it('has the ground positions and the overlays ground and pound needs', () => {
    for (const pos of FD.positions) {
      const ov = FD.pairs[pos].overlays || {};
      for (const name of ['top_cock', 'top_punch', 'bot_block', 'bot_hit', 'bot_try']) expect(ov[name], `${pos}.${name}`).toBeDefined();
    }
    for (const name of Object.values(FD.sub_from)) expect(FD.subs[name!], name).toBeDefined();
  });
  it('has the clinch pair with knees, elbows, blocks and pummeling', () => {
    const ov = FD.pairs.clinch.overlays || {};
    for (const name of ['knee_cock', 'knee', 'elbow_cock', 'elbow', 'hitbody', 'hithead', 'blockbody', 'blockhigh', 'pummel']) expect(ov[name], name).toBeDefined();
  });
});
