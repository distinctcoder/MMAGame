// The online protocol: what the host's page shows the guest, and what the guest's page sends back.
// Both travel as room presence (one small object per page, refreshed about 20 times a second), which can drop
// updates, so every message is absolute state: the latest poses, the last few events, and every unacknowledged command.
import type { LimbKey } from '../data/types';
import { LIMBS, V, type RigState } from '../rig/math';
import { Quaternion } from 'three';
import type { Color, Mode } from '../fight/fight';
import type { Position } from '../data/types';
import type { Sfx } from '../audio/synth';

/** Presence must stay under 4 KiB; leave room for the wrapper. */
export const MAX_BYTES = 3800;
/** How long an event stays in the host's ring, ms. */
export const EVENT_TTL = 1500;
export const MAX_EVENTS = 16;
export const MAX_CMDS = 24;

const LIMB_KEYS: LimbKey[] = LIMBS.map(l => l.k);
const cm = (v: number) => Math.round(v * 10);
const unit = (v: number) => Math.round(v * 1000);

/** A pose as 46 integers: positions in millimeters, rotations and directions in thousandths. */
export function encodeRig(st: RigState): number[] {
  const out = [cm(st.P.x), cm(st.P.y), cm(st.P.z)];
  for (const q of [st.Qp, st.Qc, st.Qh, st.Qy]) out.push(unit(q.x), unit(q.y), unit(q.z), unit(q.w));
  for (const k of LIMB_KEYS) out.push(cm(st.t[k].x), cm(st.t[k].y), cm(st.t[k].z));
  for (const k of LIMB_KEYS) out.push(unit(st.p[k].x), unit(st.p[k].y), unit(st.p[k].z));
  out.push(unit(st.fd.x), unit(st.fd.y), unit(st.fd.z));
  return out;
}
export function decodeRig(a: number[]): RigState | null {
  if (!Array.isArray(a) || a.length !== 46 || !a.every(n => typeof n === 'number' && Number.isFinite(n))) return null;
  let i = 0;
  const pos = () => V(a[i++] / 10, a[i++] / 10, a[i++] / 10);
  const dir = () => V(a[i++] / 1000, a[i++] / 1000, a[i++] / 1000).normalize();
  const quat = () => new Quaternion(a[i++] / 1000, a[i++] / 1000, a[i++] / 1000, a[i++] / 1000).normalize();
  const P = pos(), Qp = quat(), Qc = quat(), Qh = quat(), Qy = quat();
  const t = {} as Record<LimbKey, ReturnType<typeof V>>, p = {} as Record<LimbKey, ReturnType<typeof V>>;
  for (const k of LIMB_KEYS) t[k] = pos();
  for (const k of LIMB_KEYS) p[k] = dir();
  return { P, Qp, Qc, Qh, Qy, t, p, fd: dir() };
}

/** Something that happened, replayed on the guest's page: a pop, banner, log line, sound, impact burst, camera kick or shake. */
export type NetEvent =
  | [seq: number, k: 'p', x: number, y: number, z: number, text: string, kind: string]
  | [seq: number, k: 'n', text: string, sub: string | null, ms: number | null]
  | [seq: number, k: 'l', text: string, detail: string | null]
  | [seq: number, k: 's', sfx: Sfx]
  | [seq: number, k: 'i', x: number, y: number, z: number, power: number, kind: string]
  | [seq: number, k: 'r', strength: number, ms: number, to: Color | null]
  | [seq: number, k: 'k', x: number, y: number, z: number, amp: number]
  | [seq: number, k: 'h', amount: number];
type Body<E> = E extends [number, ...infer R] ? R : never;
export type NetEventBody = Body<NetEvent>;

/** The host's last few events, each with a sequence number so the guest plays each one once. */
export class EventRing {
  seq = 0;
  private items: { at: number; e: NetEvent }[] = [];
  push(now: number, body: NetEventBody) {
    this.items.push({ at: now, e: [++this.seq, ...body] as NetEvent });
    this.trim(now);
  }
  trim(now: number) {
    this.items = this.items.filter(x => now - x.at <= EVENT_TTL).slice(-MAX_EVENTS);
  }
  list(now: number): NetEvent[] { this.trim(now); return this.items.map(x => x.e); }
}

export interface FighterSnap {
  /** name, style id, head, head max, stamina, body, legs, x, z, yaw, guard zone held ('' none), lean x, lean y */
  n: string; s: string; v: number[]; g: string;
}
export interface Snap {
  v: 1;
  /** The guest peer playing blue, and the last of their commands the host ran. */
  opp: string | null; ack: number;
  m: Mode; o: number; b: number; r: number; c: number; rounds: number;
  pos: Position | null; top: Color | null; pn: string;
  f: [FighterSnap, FighterSnap];
  rig: [number[], number[], number[]] | null;
  /** Timing bar: owner, title, width, center, age ms, period. */
  tm: [Color, string, number, number, number, number] | null;
  /** Submission: attacker, meter 0..100, submission id. */
  sb: [Color, number, string] | null;
  cam: number[] | null; ko: Color | null;
  ev: NetEvent[];
}

/** Drop the oldest events (then shorten log details) until the snapshot fits in presence. */
export function fitSnap(s: Snap): { snap: Snap; bytes: number } {
  const size = (x: Snap) => new TextEncoder().encode(JSON.stringify(x)).length;
  let out = s, bytes = size(out);
  while (bytes > MAX_BYTES && out.ev.length) {
    out = { ...out, ev: out.ev.slice(1) };
    bytes = size(out);
  }
  return { snap: out, bytes };
}

/** Which events in a snapshot the guest has not played yet. */
export function freshEvents(ev: NetEvent[], lastSeen: number): NetEvent[] {
  return ev.filter(e => e[0] > lastSeen).sort((a, b) => a[0] - b[0]);
}

/** What the guest sends: held controls (always current) and discrete commands until the host acknowledges them. */
export interface GuestState {
  name: string; style: string;
  cmds: [number, string][];
  /** Held: move direction ('' none), guard zone ('' none), lean 'x,y'. */
  m: string; g: string; l: string;
}

export class CommandRing {
  seq = 0;
  items: [number, string][] = [];
  push(cmd: string) {
    this.items.push([++this.seq, cmd]);
    if (this.items.length > MAX_CMDS) this.items = this.items.slice(-MAX_CMDS);
  }
  ack(n: number) { this.items = this.items.filter(([s]) => s > n); }
}

/** On the host: the guest's commands not yet run, in order. */
export function newCommands(cmds: unknown, last: number): [number, string][] {
  if (!Array.isArray(cmds)) return [];
  return cmds.filter((c): c is [number, string] => Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'string' && c[1].length < 40 && c[0] > last)
    .sort((a, b) => a[0] - b[0]);
}

/** Commands a guest may send; anything else is dropped. */
const ALLOWED = /^(strike:[a-z_]+|block:[a-z]+|evade:[a-z_]+|guard:[a-z]+|lean:-?[\d.]+,-?[\d.]+|step:-?1|side:-?1|move:-?[01],-?[01]|time(@[\d.]+)?|shoot|clinch|knee|elbow|cblock:[a-z]+|pummel|trip|breakaway|punch|block|advance|sweep|pass|submit|getup)$/;
export const allowedCommand = (cmd: string) => ALLOWED.test(cmd);

/** Short, easy-to-read room codes (no 0/O or 1/I). */
export function roomCode(rnd: () => number = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(rnd() * A.length)];
  return s;
}
export const roomName = (code: string) => 'mma-' + code.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
