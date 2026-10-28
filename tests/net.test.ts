// The online protocol: poses survive the trip, snapshots fit in presence, events and commands play once and in order.
import { describe, expect, it } from 'vitest';
import { SD } from '../src/data';
import { standSpec, resolveStand } from '../src/rig/poses';

import {
  allowedCommand, CommandRing, decodeRig, encodeRig, EventRing, fitSnap, freshEvents, MAX_BYTES, newCommands, roomCode, roomName, type Snap
} from '../src/net/protocol';

const pose = () => resolveStand(standSpec(SD, 'stance'), { x: 30, z: -12, yaw: 90 }, null);

describe('online protocol', () => {
  it('sends a pose as 46 numbers and gets it back within a millimeter', () => {
    const st = pose(), a = encodeRig(st), b = decodeRig(JSON.parse(JSON.stringify(a)))!;
    expect(a).toHaveLength(46);
    expect(b.P.distanceTo(st.P)).toBeLessThan(0.1);
    expect(b.t.lh.distanceTo(st.t.lh)).toBeLessThan(0.1);
    expect(Math.abs(b.Qc.angleTo(st.Qc))).toBeLessThan(0.01);
    expect(decodeRig([1, 2, 3])).toBeNull();
    expect(decodeRig(Array(46).fill('x') as never)).toBeNull();
  });

  it('keeps a full snapshot under the presence limit by dropping old events', () => {
    const ring = new EventRing();
    for (let i = 0; i < 40; i++) ring.push(0, ['l', 'x'.repeat(100), 'y'.repeat(140)]);
    const rig = encodeRig(pose());
    const snap: Snap = {
      v: 1, opp: 'p1', ack: 3, m: 'stand', o: 0, b: 0, r: 1, c: 90000, rounds: 3, pos: null, top: null, pn: '',
      f: [{ n: 'Red', s: 'mma', g: '', v: [100, 100, 100, 0, 0, -60, 0, 90, 0, 0] }, { n: 'Blue', s: 'mma', g: 'high', v: [100, 100, 100, 0, 0, 60, 0, -90, 0, 0] }],
      rig: [rig, rig, rig], tm: null, sb: null, cam: null, ko: null, ev: ring.list(0)
    };
    const { snap: out, bytes } = fitSnap(snap);
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(out.ev.length).toBeGreaterThan(0);
    expect(out.ev[out.ev.length - 1][0]).toBe(ring.seq);
  });

  it('forgets events after a moment and plays each one once, in order', () => {
    const ring = new EventRing();
    ring.push(0, ['h', 5]); ring.push(100, ['h', 6]); ring.push(2000, ['h', 7]);
    expect(ring.list(2000).map(e => e[0])).toEqual([3]);
    const ev = [[3, 'h', 7], [2, 'h', 6]] as never;
    expect(freshEvents(ev, 1).map(e => e[0])).toEqual([2, 3]);
    expect(freshEvents(ev, 3)).toEqual([]);
  });

  it('resends commands until acknowledged, and the host runs only new ones', () => {
    const r = new CommandRing();
    r.push('strike:jab'); r.push('strike:cross'); r.push('shoot');
    expect(newCommands(r.items, 1).map(c => c[1])).toEqual(['strike:cross', 'shoot']);
    r.ack(2);
    expect(r.items).toEqual([[3, 'shoot']]);
    expect(newCommands('nope', 0)).toEqual([]);
    expect(newCommands([[5, 'x'.repeat(100)], ['a', 'b']], 0)).toEqual([]);
  });

  it('accepts only fight commands from a guest', () => {
    for (const c of ['strike:jab', 'guard:high', 'lean:-0.5,1', 'move:1,-1', 'time@0.412', 'submit', 'cblock:body']) expect(allowedCommand(c), c).toBe(true);
    for (const c of ['restart', 'strike:<b>', 'move:5,0', 'lean:1;x', '']) expect(allowedCommand(c), c).toBe(false);
  });

  it('makes readable codes and valid room names', () => {
    const c = roomCode();
    expect(c).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(roomName(c)).toMatch(/^[a-z][a-z0-9_.-]{0,47}$/);
  });
});
