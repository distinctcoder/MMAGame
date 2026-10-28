// CPU opponent: chooses strikes, steps, clinches and takedowns on the feet, reads incoming strikes, and works the ground.
import { SD } from '../data';
import type { EvadeKind, Strike, Zone } from '../data/types';
import { qEuler, rot } from '../rig/math';
import { clamp, inRange, leanAmounts, LEVELS, NEXT } from './rules';
import type { Fight, Fighter } from './fight';

function weightedPick(f: Fight, mix: Record<string, number>, ok: (k: string) => boolean) {
  const items = Object.entries(mix).filter(([k]) => ok(k));
  let r = f.rng() * items.reduce((n, [, w]) => n + w, 0);
  for (const [k, w] of items) if ((r -= w) <= 0) return k;
  return items.length ? items[items.length - 1][0] : null;
}
const pick = <T>(f: Fight, list: T[]) => list[Math.floor(f.rng() * list.length)];

/** Weight up strikes that beat what the opponent is holding: a deep duck invites the uppercut, a high guard the body. */
function punishMix(mix: Record<string, number>, o: Fighter): Record<string, number> {
  const out = { ...mix };
  const amt = leanAmounts(o.lean);
  for (const k of Object.keys(out)) {
    const st = SD.strikes[k];
    for (const [kind, a] of Object.entries(amt) as [EvadeKind, number][]) {
      const m = st.evade?.[kind];
      if (a > 0.4 && (m === undefined || m > 1)) out[k] *= 1 + a * 2;
    }
    const held = Object.entries(o.guard).filter(([, w]) => (w || 0) > 0.5).map(([z]) => z);
    if (held.length && !held.includes(st.zone)) out[k] *= 1.8;
  }
  return out;
}

declare global { interface Window { __passiveCpu?: boolean } }

export function cpuStand(fight: Fight, f: Fighter) {
  if (fight.over || fight.mode !== 'stand' || f.action.type !== 'idle' || fight.now < f.nextThink || window.__passiveCpu) return;
  const plan = fight.config.cpu || {};
  const s = fight.style(f), lv = LEVELS[fight.level], o = fight.other(f), dist = fight.gap();
  f.nextThink = fight.now + fight.rand(220, 520) / lv.aggr;
  if (plan.shootEvery) {
    if (fight.now > fight.nextShoot && dist < 110) { fight.nextShoot = fight.now + plan.shootEvery; return fight.shoot(f); }
  } else if (plan.takedowns !== false && plan.attack !== false && fight.now > fight.nextShoot && dist < 110 && f.sta > 20 && fight.rng() < s.takedowns / 100 * 0.16 * lv.aggr) {
    fight.nextShoot = fight.now + 4000;
    return fight.shoot(f);
  }
  // Clinch fighters sometimes decide to close the distance and tie up.
  if (plan.clinch !== false && plan.attack !== false) {
    if (!f.clinchUntil && f.sta > 25 && (plan.clinch === true || fight.rng() < s.clinch / 100 * 0.07 * lv.aggr)) f.clinchUntil = fight.now + 2500;
    if (f.clinchUntil) {
      if (fight.now > f.clinchUntil) f.clinchUntil = 0;
      else if (dist <= 78) { f.clinchUntil = 0; return fight.enterClinch(f); }
      else return fight.startStep(f, 1);
    }
  }
  const range = plan.keepRange ?? s.range;
  if (plan.move !== false) {
    if (dist > range + 18 && fight.rng() < 0.7) return fight.startStep(f, 1);
    if (dist < range - 22 && fight.rng() < 0.45) return fight.startStep(f, -1);
    // Footwork: circle, mostly toward the outside of the opponent's lead foot, then strike off the angle.
    if (!plan.interval && dist < range + 30 && fight.rng() < s.evasion / 100 * 0.2 * lv.aggr) {
      const left = rot(qEuler([0, o.yaw, 0]), [1, 0, 0]);
      const outside = left.z >= 0 ? 1 : -1;
      f.nextThink = fight.now + fight.rand(60, 180);
      return fight.startStep(f, 0, fight.rng() < 0.65 ? outside : -outside);
    }
  }
  if (plan.attack === false) return;
  if (plan.interval ? fight.now < fight.nextAttack : fight.rng() > 0.65 * s.aggression * lv.aggr) return;
  // Drill partners (steady interval) only throw what will reach; fight CPUs can misjudge range a little.
  // Punish a held guard or lean with the strikes that beat it.
  const key = weightedPick(fight, plan.mix ? plan.mix : punishMix(s.mix, o), k => {
    const st = SD.strikes[k], r = st.range;
    return plan.interval ? inRange(st, dist) : dist >= r[0] - 4 && dist <= r[1] + 6 && f.sta >= st.cost * 0.7;
  });
  if (key) {
    fight.startStrike(f, key, false);
    if (plan.interval) fight.nextAttack = fight.now + fight.rand(plan.interval[0], plan.interval[1]);
  } else if (dist > range && plan.move !== false) fight.startStep(f, 1);
}

/** The CPU sees a windup and, after a reaction delay, plans a block or head movement that it hopes is right. */
export function cpuSeesWindup(fight: Fight, def: Fighter, att: Fighter, s: Strike, windup: number) {
  if (fight.isHuman(def) || fight.over || att.action.type !== 'strike' || fight.config.cpu?.defend === false) return;
  const lv = LEVELS[fight.level], st = fight.style(def), d = st.defense + lv.def, tHit = att.action.tHit;
  const delay = fight.rand(160, 380) * (1.25 - d / 200) * lv.react;
  if (delay > windup - 40) return;
  const dodges = (Object.keys(s.evade || {}) as EvadeKind[]).filter(k => s.evade![k] === 0);
  if (dodges.length && fight.rng() < st.evasion / 100 * 0.6) {
    const good = fight.rng() < clamp(0.2 + (st.evasion + lv.def) / 140 + (windup - 250) / 800, 0.08, 0.9);
    const others = (Object.keys(SD.evades) as EvadeKind[]).filter(k => !dodges.includes(k));
    const kind = good || !others.length ? pick(fight, dodges) : pick(fight, others);
    def.plannedBlock = { at: tHit - Math.min(windup - delay, fight.rand(70, 200)), evade: kind };
    return;
  }
  const correct = fight.rng() < clamp(0.3 + d / 130 + (windup - 250) / 700, 0.08, 0.93);
  const zones = (Object.keys(SD.zones) as Zone[]).filter(z => z !== s.zone);
  def.plannedBlock = { at: tHit - Math.min(windup - delay, fight.rand(90, 260)), zone: correct ? s.zone : pick(fight, zones) };
}

export function cpuDefend(fight: Fight, f: Fighter) {
  const p = f.plannedBlock;
  if (!p || fight.now < p.at) return;
  f.plannedBlock = null;
  if (f.action.type !== 'idle' && f.action.type !== 'step') return;
  if (p.evade) fight.holdLean(f, p.evade, fight.rand(300, 420));
  else if (p.zone) fight.holdGuard(f, p.zone, fight.rand(380, 520));
}

export function cpuClinch(fight: Fight, cpu: Fighter) {
  if (fight.mode !== 'clinch' || fight.busy || fight.over || fight.timing || fight.sub || fight.config.cpu?.attack === false) return;
  if (fight.now < cpu.nextThink) return;
  const s = fight.style(cpu), lv = LEVELS[fight.level], r = fight.rng();
  cpu.nextThink = fight.now + fight.rand(700, 1300) / lv.aggr;
  if (cpu === fight.top) {
    if (r < 0.5) fight.clinchStrike(cpu, 'knee');
    else if (r < 0.75) fight.clinchStrike(cpu, 'elbow');
    else if (r < 0.75 + s.takedowns / 600) fight.trip(cpu);
    else if (r > 0.96 - (fight.now - fight.clinchSince) / 40000) fight.breakAway(cpu);
  } else {
    if (r < 0.2 + s.clinch / 300) fight.pummel(cpu);
    else if (r < 0.62) fight.breakAway(cpu);
    else if (r < 0.82) fight.clinchStrike(cpu, 'knee');
    else fight.clinchStrike(cpu, 'elbow');
  }
}

export function cpuGround(fight: Fight, cpu: Fighter) {
  if (fight.mode !== 'ground' || fight.busy || fight.over || fight.timing || fight.sub || fight.config.cpu?.attack === false) return;
  const me = fight.other(cpu);
  if (fight.now < cpu.nextThink) return;
  const s = fight.style(cpu), lv = LEVELS[fight.level], r = fight.rng();
  if (cpu === fight.top) {
    cpu.nextThink = fight.now + fight.rand(900, 1500) / lv.aggr;
    if (fight.canSubmit(cpu) && r < 0.12 + (1 - me.headHP / me.headMax) / 4) fight.submit();
    else if (fight.pos && NEXT[fight.pos] && r < 0.32 * (s.top / 70)) fight.advance();
    else if (r > 0.97 - (s.top < 50 ? 0.12 : 0)) fight.standUp(cpu);
    else fight.punch();
  } else {
    cpu.nextThink = fight.now + fight.rand(2200, 3600) / lv.aggr;
    if (fight.canSubmit(cpu) && r < s.guard / 300) fight.submit();
    else if (r < 0.65) fight.sweep();
    else fight.standUp(cpu);
  }
}
