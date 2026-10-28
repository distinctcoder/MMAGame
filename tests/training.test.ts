import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { COMBO_GAP_MS, COMBOS, DRILLS, SPAR_BEHAVIORS } from '../src/training/drills';
import { currentCombo, handleEvent, newSession, tick, timeLeft } from '../src/training/session';
import { inRange, type DefenseResult } from '../src/fight/rules';

const partner = (result: DefenseResult | 'whiff', key = 'jab') => ({ type: 'strike' as const, attacker: 'blue' as const, key, result });
const mine = (key: string, result: DefenseResult | 'whiff' = 'hit') => ({ type: 'strike' as const, attacker: 'red' as const, key, result });

describe('drill data', () => {
  it('only uses strikes and styles that exist', () => {
    for (const d of Object.values(DRILLS)) {
      for (const k of Object.keys(d.config.cpu?.mix || {})) expect(SD.strikes[k], `${d.id} mix ${k}`).toBeDefined();
      if (d.partner) expect(SD.styles[d.partner], d.id).toBeDefined();
    }
    for (const [id, b] of Object.entries(SPAR_BEHAVIORS)) for (const k of Object.keys(b.cpu.mix || {})) expect(SD.strikes[k], `${id} ${k}`).toBeDefined();
    for (const combo of COMBOS) for (const k of combo) expect(SD.strikes[k], k).toBeDefined();
  });
  it('places the combo dummy where every combo strike can land', () => {
    const dist = DRILLS.combo.config.startDist!;
    for (const k of new Set(COMBOS.flat())) {
      const r = SD.strikes[k].range;
      expect(dist >= r[0] - 6 && dist <= r[1], `${k} at ${dist}`).toBe(true);
    }
  });
  it('places defense-drill partners where every strike in their mix lands', () => {
    for (const d of [DRILLS.block, DRILLS.dodge, DRILLS.read]) {
      for (const dist of [d.config.cpu!.keepRange!, d.config.startDist!]) for (const k of Object.keys(d.config.cpu!.mix!)) {
          expect(inRange(SD.strikes[k], dist), `${d.id}: ${k} at ${dist}`).toBe(true);
      }
    }
  });
});

describe('defense drills', () => {
  it('scores by outcome and adds a growing streak bonus', () => {
    const s = newSession(DRILLS.block, 0);
    expect(handleEvent(s, partner('blocked'), 0)!.points).toBe(60);
    expect(handleEvent(s, partner('parried'), 0)!.points).toBe(110); // 100 + one step of streak
    expect(handleEvent(s, partner('hit'), 0)).toEqual({ points: 0, label: 'Hit', good: false });
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(2);
    expect(s.score).toBe(170);
  });
  it('ignores your own strikes and ends after the set count', () => {
    const s = newSession(DRILLS.block, 0);
    expect(handleEvent(s, mine('jab'), 0)).toBeNull();
    for (let i = 0; i < 20; i++) handleEvent(s, partner('blocked'), 0);
    expect(s.over).toBe(true);
    expect(handleEvent(s, partner('blocked'), 0)).toBeNull();
    expect(s.count).toBe(20);
  });
  it('multiplies points in the no-tells drill', () => {
    const s = newSession(DRILLS.read, 0);
    expect(handleEvent(s, partner('blocked'), 0)!.points).toBe(90);
  });
  it('rewards dodges over blocks in the head movement drill', () => {
    const s = newSession(DRILLS.dodge, 0);
    const dodge = handleEvent(s, partner('dodged'), 0)!.points;
    const t = newSession(DRILLS.dodge, 0);
    expect(dodge).toBeGreaterThan(handleEvent(t, partner('blocked'), 0)!.points);
  });
});

describe('sprawl drill', () => {
  it('scores reading the shot above sprawling above a scramble', () => {
    const s = newSession(DRILLS.sprawl, 0);
    const pts = (outcome: 'stuffed' | 'sprawl' | 'guard' | 'side') => handleEvent(newSession(DRILLS.sprawl, 0), { type: 'takedown', attacker: 'blue', outcome }, 0)!.points;
    expect(pts('stuffed')).toBeGreaterThan(pts('sprawl'));
    expect(pts('sprawl')).toBeGreaterThan(pts('guard'));
    expect(pts('side')).toBe(0);
    expect(handleEvent(s, { type: 'takedown', attacker: 'red', outcome: 'side' }, 0)).toBeNull();
  });
});

describe('combo challenge', () => {
  it('pays out when the whole combo lands in order, in time', () => {
    const s = newSession(DRILLS.combo, 0);
    expect(currentCombo(s)).toEqual({ seq: ['jab', 'cross'], idx: 0 });
    expect(handleEvent(s, mine('jab'), 100)).toBeNull();
    expect(handleEvent(s, mine('cross'), 600)).toEqual({ points: 200, label: 'Combo!', good: true });
    expect(currentCombo(s)!.seq).toEqual(COMBOS[1]);
  });
  it('breaks the chain on the wrong strike, a whiff, or a slow follow-up', () => {
    const s = newSession(DRILLS.combo, 0);
    handleEvent(s, mine('jab'), 0);
    expect(handleEvent(s, mine('lead_hook'), 100)!.label).toBe('Chain broken');
    handleEvent(s, mine('jab'), 200);
    expect(handleEvent(s, mine('cross', 'whiff'), 300)!.label).toBe('Chain broken');
    handleEvent(s, mine('jab'), 400);
    expect(handleEvent(s, mine('cross'), 400 + COMBO_GAP_MS + 1)!.label).toBe('Chain broken');
    expect(s.score).toBe(0);
  });
  it('lets the breaking strike start the combo again', () => {
    const s = newSession(DRILLS.combo, 0);
    handleEvent(s, mine('jab'), 0);
    handleEvent(s, mine('jab'), 0 + COMBO_GAP_MS + 50); // too slow for "cross", but restarts with a jab
    expect(currentCombo(s)!.idx).toBe(1);
  });
  it('times out a half-finished combo and ends after its time', () => {
    const s = newSession(DRILLS.combo, 0);
    handleEvent(s, mine('jab'), 0);
    expect(tick(s, COMBO_GAP_MS + 1)!.label).toBe('Too slow');
    expect(timeLeft(s, 15000)).toBe(30);
    tick(s, 45000);
    expect(s.over).toBe(true);
  });
});

describe('sparring', () => {
  it('tracks your landed strikes and the strikes you stopped', () => {
    const s = newSession(DRILLS.spar, 0);
    handleEvent(s, { type: 'throw', attacker: 'red', key: 'jab' }, 0);
    handleEvent(s, mine('jab', 'hit'), 0);
    handleEvent(s, partner('blocked'), 0);
    handleEvent(s, partner('hit'), 0);
    expect(s).toMatchObject({ thrown: 1, landed: 1, faced: 2, stopped: 1, score: 0 });
  });
});

describe('sprawl drill balance', () => {
  it('lets perfect timing beat the partner, and no timing lose', async () => {
    const R = await import('../src/fight/rules');
    const d = DRILLS.sprawl, partner = SD.styles[d.partner!], me = SD.styles.muay_thai;
    const att = partner.takedowns + R.LEVELS[d.level!].grap, cpuQ = R.cpuTiming(att, 0.5);
    // Average luck on both sides.
    const margin = (myTiming: number) => R.contestMargin(att, cpuQ, me.td_defense, myTiming, 0, 0.5, 0.5);
    expect(margin(1)).toBeLessThan(R.LEVEL_CHANGE_STUFF);        // perfect read stuffs it at the level change
    expect(R.takedownOutcome(margin(1))).toBe('sprawl');           // and would sprawl on the grab
    expect(R.takedownOutcome(margin(0))).not.toBe('sprawl');       // a missed timing bar gets taken down
  });
});
