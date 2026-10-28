// Walking and idle poses for the park, built from the same pose specs as the fight stances.
import type { PoseSpec } from '../data/types';

/**
 * A walk-cycle pose. phase advances with distance walked (radians); speed is 0 (standing) to 1 (full walk).
 * Arms swing against the legs and the hips turn a little with each step.
 */
export function walkSpec(phase: number, speed: number, breath = 0): PoseSpec {
  const s = Math.sin(phase), v = Math.max(0, Math.min(1, speed));
  const stride = 20 * v, lift = 10 * v;
  return {
    pelvis: { b: [0, 97 - 2 * v + Math.abs(Math.cos(phase)) * 2.5 * v + breath * 0.6, 0] },
    rot: [0, s * 7 * v, 0],
    spine: [4 + 3 * v, -s * 12 * v, 0],
    head: [-3, s * 5 * v, 0],
    lf: { h: [9, 7 + Math.max(0, s) * lift, s * stride] },
    rf: { h: [-9, 7 + Math.max(0, -s) * lift, -s * stride] },
    lh: { hc: [21, -50 + breath, -s * 15 * v + 2] },
    rh: { hc: [-21, -50 + breath, s * 15 * v + 2] },
    lhp: [0.4, -0.2, -1], rhp: [-0.4, -0.2, -1]
  };
}
