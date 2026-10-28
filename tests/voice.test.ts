// Who speaks when: the referee and announcer call the fight, the corner reacts to the human fighter.
import { describe, expect, it } from 'vitest';
import { COACH_GAP_MS, COACH_REPEAT_MS, trimBounds, VOICE, VoiceDirector } from '../src/audio/voice';

function director() {
  const said: string[] = [];
  return { d: new VoiceDirector(id => said.push(id)), said };
}
const stand = { mode: 'stand', over: false, bottom: null };

describe('voice director', () => {
  it('only asks for lines that exist', () => {
    const { d, said } = director();
    d.cue({ k: 'round', n: 1, last: false }, 0);
    d.cue({ k: 'round', n: 2, last: false }, 100000);
    d.cue({ k: 'round', n: 3, last: true }, 200000);
    d.cue({ k: 'decision', draw: false }, 300000);
    d.cue({ k: 'finish', how: 'KO' }, 400000);
    for (const id of said) expect(VOICE[id], id).toBeDefined();
  });

  it('opens a fight with the round, touch gloves and fight; later rounds skip touching gloves', () => {
    const { d, said } = director();
    d.cue({ k: 'round', n: 1, last: false }, 0);
    expect(said).toEqual(['ann_round1', 'ref_touch', 'ref_fight']);
    said.length = 0;
    d.cue({ k: 'round', n: 3, last: true }, 1000);
    expect(said).toEqual(['ann_final', 'ref_fight']);
  });

  it('calls a one-round fight round one, not the final round', () => {
    const { d, said } = director();
    d.cue({ k: 'round', n: 1, last: true }, 0);
    expect(said[0]).toBe('ann_round1');
  });

  it('has the corner say breathe at the end of a round, but not at its start', () => {
    const { d, said } = director();
    d.cue({ k: 'round', n: 1, last: false }, 0);
    d.cue({ k: 'bell' }, 0);
    expect(said).not.toContain('coach_breathe');
    d.cue({ k: 'bell' }, 90000);
    expect(said).toContain('coach_breathe');
  });

  it('shouts sprawl when the opponent shoots, and not when you do', () => {
    const { d, said } = director();
    d.event({ type: 'shoot', attacker: 'red' }, 10000);
    expect(said).toEqual([]);
    d.event({ type: 'shoot', attacker: 'blue' }, 20000);
    expect(said).toEqual(['coach_sprawl']);
  });

  it('wants head movement after three head shots land, and hands up after one big one', () => {
    const { d, said } = director();
    d.event({ type: 'strike', attacker: 'blue', key: 'head_kick', result: 'hit' }, 10000);
    expect(said).toEqual(['coach_hands']);
    said.length = 0;
    for (const t of [30000, 31000, 32000]) d.event({ type: 'strike', attacker: 'blue', key: 'jab', result: 'hit' }, t);
    expect(said).toEqual(['coach_head']);
  });

  it('tells you to go to the body after three blocked head shots', () => {
    const { d, said } = director();
    for (const t of [10000, 11000, 12000]) d.event({ type: 'strike', attacker: 'red', key: 'jab', result: 'blocked' }, t);
    expect(said).toEqual(['coach_body']);
  });

  it('wants your hands going when you stop throwing, and you up when stuck on your back', () => {
    const { d, said } = director();
    d.reset(0);
    d.frame(stand, 9000);
    expect(said).toEqual(['coach_handsgo']);
    said.length = 0;
    d.frame({ mode: 'ground', over: false, bottom: 'red' }, 30000);
    d.frame({ mode: 'ground', over: false, bottom: 'red' }, 34000);
    expect(said).toEqual(['coach_getup']);
  });

  it('never repeats a shout too soon, leaves gaps between shouts, and stays quiet in drills', () => {
    const { d, said } = director();
    d.event({ type: 'shoot', attacker: 'blue' }, 10000);
    d.event({ type: 'shoot', attacker: 'blue' }, 10000 + COACH_REPEAT_MS - 1);
    expect(said).toEqual(['coach_sprawl']);
    d.event({ type: 'strike', attacker: 'blue', key: 'head_kick', result: 'hit' }, 10000 + COACH_GAP_MS - 1);
    expect(said).toEqual(['coach_sprawl']);
    d.corner = false;
    d.event({ type: 'shoot', attacker: 'blue' }, 100000);
    expect(said).toEqual(['coach_sprawl']);
  });
});

describe('silence trimming', () => {
  it('finds the speech inside padding, with a little lead-in and tail', () => {
    const rate = 1000, data = new Float32Array(3000);
    for (let i = 1000; i < 1500; i++) data[i] = 0.5;
    const [a, b] = trimBounds(data, rate);
    expect(a).toBe(1000 - 30);
    expect(b).toBe(1499 + 120);
  });
  it('returns an empty range for silence', () => {
    expect(trimBounds(new Float32Array(100), 1000)).toEqual([0, 0]);
  });
});
