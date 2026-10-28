// Who drives each side: CPU vs CPU fights on its own, two people each command their own fighter, and the timing bar
// belongs to one of them.
import { describe, expect, it } from 'vitest';
import { Fight, type Color, type FightEvents } from '../src/fight/fight';

const mesh = () => ({ update() {} });
const events = (): FightEvents => ({
  pop() {}, banner() {}, log() {}, tell() {}, rumble() {}, key: k => k, changed() {}, ended() {}
});
function make(ev = events()) {
  const f = new Fight({ red: mesh(), blue: mesh(), ref: mesh() } as never, ev);
  let s = 7;
  f.rng = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return f;
}
// A pretend real clock: hit-stop and slow motion are timed against it.
let real = 1e6;
const run = (f: Fight, ms: number) => { for (let t = 0; t < ms; t += 16) { f.update(real += 16, 16); f.animate(); } };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
(globalThis as { window?: unknown }).window ??= globalThis;
const both = { red: 'human', blue: 'human' } as const;

describe('controls', () => {
  it('lets two CPUs fight each other with nobody pressing anything', () => {
    const thrown: Color[] = [];
    const f = make({ ...events(), event: e => { if (e.type === 'throw') thrown.push(e.attacker); } });
    f.start({ redStyle: 'boxing', blueStyle: 'muay_thai', level: 'normal', control: { red: 'cpu', blue: 'cpu' }, config: { noClock: true } });
    run(f, 20000);
    expect(thrown).toContain('red');
    expect(thrown).toContain('blue');
  });

  it('sends each command to its own side and ignores commands for a CPU', () => {
    const f = make();
    f.start({ redStyle: 'mma', blueStyle: 'mma', level: 'normal', control: both, config: { noClock: true, startDist: 90 } });
    run(f, 100);
    f.command('strike:jab', 'blue');
    expect(f.blue.action.type).toBe('strike');
    expect(f.red.action.type).toBe('idle');
    f.command('guard:high', 'red');
    expect(f.red.guardTarget).toBe('high');
    f.control.blue = 'cpu';
    window.__passiveCpu = true;
    run(f, 1500);
    f.command('strike:cross', 'blue');
    expect(f.blue.action.type).toBe('idle');
    window.__passiveCpu = false;
  });

  it('only lets the owner of a timing bar stop it', async () => {
    const f = make();
    f.start({ redStyle: 'mma', blueStyle: 'mma', level: 'normal', control: both, config: { noClock: true, startDist: 90 } });
    run(f, 100);
    f.shoot(f.red);
    await wait(320);
    expect(f.timing?.owner).toBe('red');
    expect(f.timing?.title.startsWith(f.red.name + ':')).toBe(true);
    f.command('time', 'blue');
    expect(f.timing?.owner).toBe('red');
    f.command('time@0.5', 'red');
    await wait(10);
    // Red's bar is done; now blue has to read the level change.
    expect(f.timing?.owner).toBe('blue');
  });
});
