// Playing a friend online through the artifact viewer's `room` capability. The host's page runs the fight; the guest's
// page draws what the host shows it and sends its controls back. Anyone else who joins the room watches.
import { SD } from '../data';
import type { Fight, Color, Fighter, Timing, SubState } from '../fight/fight';
import { V, type RigState } from '../rig/math';
import {
  allowedCommand, CommandRing, decodeRig, encodeRig, EventRing, fitSnap, freshEvents, newCommands, roomCode, roomName,
  type GuestState, type NetEvent, type NetEventBody, type Snap
} from './protocol';

// ---- The parts of the room capability this uses (see the artifact runtime's room.d.ts) ----
interface Peer { peer: string; isMe: boolean; sameTab: boolean; presence: Readonly<Record<string, unknown>>; updatedAt: number }
interface NamedRoom {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly Peer[];
  onPeers(fn: (c: { peers: readonly Peer[]; joined: readonly Peer[]; left: readonly Peer[] }) => void): () => void;
  connected(): boolean;
  leave(): Promise<void> | void;
}
interface RoomApi { join(name: string): Promise<NamedRoom> }
declare global { interface Window { claude?: { use?: (name: string) => Promise<unknown> } } }

/** The room capability, or null when this page isn't running in a viewer that offers it. */
export async function getRoom(): Promise<RoomApi | null> {
  try { return (await window.claude?.use?.('room') as RoomApi | null) ?? null; } catch { return null; }
}

/** The host runs the fight; a guest plays blue if the host picked them, and otherwise watches. */
export type Role = 'host' | 'guest';
export interface OnlineHooks {
  /** Host: start a fight against this guest (null: nobody joined yet). */
  startFight(opp: { name: string; style: string } | null): void;
  /** Something to tell the player: waiting, joined, left, lost. */
  status(text: string, sub?: string): void;
  /** Guest: replay one of the host's events. */
  play(e: NetEvent): void;
  /** Guest: the fight's controls changed; refresh the buttons and prompts. */
  changed(): void;
  me(): { name: string; style: string };
}

const SEND_MS = 50;
const HOLD_MS = 90;
const LOST_MS = 3500;

export class Online {
  role: Role | null = null;
  code = '';
  private room: NamedRoom | null = null;
  private unsub: (() => void) | null = null;
  private lastSend = 0;
  // Host
  private ring = new EventRing();
  opp: string | null = null;
  private lastCmd = 0;
  private held = { g: '', l: '0,0' };
  private lastShake = 0;
  private lastKick: unknown = null;
  // Guest
  private cmds = new CommandRing();
  private hold = { m: '', mAt: 0, g: '', l: '0,0' };
  private seen = -1;
  private target: Record<'red' | 'blue' | 'ref', RigState> | null = null;
  private lastSnapAt = 0;
  private lastSnap: Snap | null = null;
  private lastKey = '';
  private lostShown = false;
  private timingKey = '';

  constructor(private fight: Fight, private hooks: OnlineHooks) {}

  get active() { return !!this.room; }

  /** Open a room and wait for a friend. Resolves false when rooms aren't available here. */
  async host(): Promise<boolean> {
    const api = await getRoom();
    if (!api) return false;
    this.code = roomCode();
    await this.open(api, 'host');
    return true;
  }
  async join(code: string): Promise<boolean> {
    const api = await getRoom();
    if (!api) return false;
    this.code = code.toUpperCase();
    await this.open(api, 'guest');
    return true;
  }
  private async open(api: RoomApi, role: Role) {
    this.leave();
    this.role = role;
    Object.assign(this, { opp: null, lastCmd: 0, seen: -1, target: null, lastSnap: null, lastSnapAt: performance.now(), lastKey: '', lostShown: false, isOpp: false, everStarted: false });
    this.ring = new EventRing(); this.cmds = new CommandRing();
    const room = this.room = await api.join(roomName(this.code));
    this.unsub = room.onPeers(c => this.onPeers(c));
  }
  /** Once the fight screen shows: the host waits for a friend, the guest looks for the host. */
  begin() {
    if (this.role === 'host') {
      this.hooks.startFight(null);
      this.hooks.status(`Room ${this.code}`, `Waiting for a friend. They open this game, choose Join and enter ${this.code}.`);
      // Someone may already be waiting.
      if (this.room) this.onPeers({ peers: this.room.peers(), left: [] });
    } else if (this.role === 'guest') this.hooks.status(`Joining ${this.code}`, 'Looking for the host…');
  }

  leave() {
    this.unsub?.(); this.unsub = null;
    try { void this.room?.leave(); } catch { /* already gone */ }
    this.room = null; this.role = null; this.opp = null;
  }

  private myPeer() { return this.room?.peers().find(p => p.isMe && p.sameTab)?.peer ?? null; }

  private onPeers(c: { peers: readonly Peer[]; left: readonly Peer[] }) {
    if (this.role !== 'host') return;
    if (this.opp && c.left.some(p => p.peer === this.opp)) {
      this.opp = null;
      this.fight.control.blue = 'cpu';
      this.hooks.status('Opponent left', 'The CPU takes over until someone else joins.');
    }
    if (!this.opp) {
      const g = c.peers.find(p => !p.isMe && p.presence.role === 'guest' && typeof (p.presence.g as GuestState | undefined)?.name === 'string');
      if (g && (this.fight.over || this.fight.control.blue !== 'human' || !this.everStarted)) this.takeOpponent(g);
    }
  }
  private everStarted = false;
  private takeOpponent(p: Peer) {
    const g = p.presence.g as GuestState;
    this.opp = p.peer; this.lastCmd = 0; this.held = { g: '', l: '0,0' };
    // Acknowledge whatever they already queued (from a lobby or an older fight).
    for (const [s] of newCommands(g.cmds, 0)) this.lastCmd = Math.max(this.lastCmd, s);
    this.everStarted = true;
    const style = SD.styles[g.style] ? g.style : 'mma';
    // Two fighters with one name would make every log line ambiguous.
    let name = String(g.name).slice(0, 24) || 'Guest';
    if (name === this.hooks.me().name) name += ' 2';
    this.hooks.startFight({ name, style });
  }
  /** Host restart: fight whoever is playing, or the next guest waiting. */
  rematch() {
    if (this.role !== 'host' || !this.room) return;
    const peers = this.room.peers();
    const cur = this.opp && peers.find(p => p.peer === this.opp);
    const next = cur || peers.find(p => !p.isMe && p.presence.role === 'guest' && (p.presence.g as GuestState | undefined)?.name);
    if (next) this.takeOpponent(next);
    else { this.opp = null; this.hooks.startFight(null); }
  }

  // ---------- Host ----------
  /** Record an event to replay on the guest's page. */
  record(body: NetEventBody) { if (this.role === 'host') this.ring.push(performance.now(), body); }

  /** Host, once a frame after the fight updates: run the guest's controls and publish the fight. */
  hostFrame(real: number) {
    if (this.role !== 'host' || !this.room) return;
    const f = this.fight;
    if (f.shake > this.lastShake + 1) this.record(['h', Math.round(f.shake)]);
    this.lastShake = f.shake;
    if (f.kick && f.kick !== this.lastKick) this.record(['k', +f.kick.dir.x.toFixed(2), +f.kick.dir.y.toFixed(2), +f.kick.dir.z.toFixed(2), +f.kick.amp.toFixed(1)]);
    this.lastKick = f.kick;
    const peer = this.opp ? this.room.peers().find(p => p.peer === this.opp) : null;
    const g = peer?.presence.g as GuestState | undefined;
    if (g && f.control.blue === 'human') {
      for (const [s, cmd] of newCommands(g.cmds, this.lastCmd)) { this.lastCmd = s; if (allowedCommand(cmd)) f.command(cmd, 'blue'); }
      const gz = typeof g.g === 'string' ? g.g : '', lean = typeof g.l === 'string' ? g.l : '0,0';
      if (gz !== this.held.g && allowedCommand('guard:' + (gz || 'off'))) { f.command('guard:' + (gz || 'off'), 'blue'); this.held.g = gz; }
      if (lean !== this.held.l && allowedCommand('lean:' + lean)) { f.command('lean:' + lean, 'blue'); this.held.l = lean; }
      if (g.m && allowedCommand('move:' + g.m)) f.command('move:' + g.m, 'blue');
    }
    if (real - this.lastSend < SEND_MS) return;
    this.lastSend = real;
    const { snap } = fitSnap(this.snapshot());
    this.room.presence({ role: 'host', code: this.code, s: snap }).catch(() => {});
  }

  snapshot(): Snap {
    const f = this.fight, now = performance.now();
    const fs = (x: Fighter) => {
      const gz = Object.entries(x.guard).find(([, w]) => (w || 0) > 0.5)?.[0] || '';
      return { n: x.name, s: x.style, g: gz, v: [x.headHP, x.headMax, x.sta, x.body, x.legs, x.x, x.z, x.yaw, x.lean.x, x.lean.y].map(n => Math.round(n * 10) / 10) };
    };
    const rig = f.red.drawn && f.blue.drawn && f.ref.drawn ? [encodeRig(f.red.drawn), encodeRig(f.blue.drawn), encodeRig(f.ref.drawn)] as Snap['rig'] : null;
    const t = f.timing, s = f.sub, cam = f.camOverride;
    return {
      v: 1, opp: this.opp, ack: this.lastCmd,
      m: f.mode, o: f.over ? 1 : 0, b: f.busy ? 1 : 0, r: f.round, c: Math.round(f.clock), rounds: f.config.rounds ?? 3,
      pos: f.pos, top: f.top?.color ?? null, pn: f.pairName,
      f: [fs(f.red), fs(f.blue)], rig,
      tm: t ? [t.owner, t.title, +t.width.toFixed(3), +t.center.toFixed(3), Math.round(now - t.start), t.period] : null,
      sb: s ? [s.att.color, Math.round(s.v * 10) / 10, s.name] : null,
      cam: cam ? [cam.pos.x, cam.pos.y, cam.pos.z, cam.look.x, cam.look.y, cam.look.z, cam.fov].map(n => Math.round(n)) : null,
      ko: f.koCam?.color ?? null,
      ev: this.ring.list(now)
    };
  }

  // ---------- Guest ----------
  /** The guest's input sink: held controls go in presence as state, everything else as numbered commands. */
  send(cmd: string) {
    if (this.role !== 'guest') return;
    const [kind, arg] = cmd.split(':');
    if (kind === 'move') { this.hold.m = arg; this.hold.mAt = performance.now(); return; }
    if (kind === 'guard') { this.hold.g = arg === 'off' ? '' : arg; return; }
    if (kind === 'lean') { this.hold.l = arg; return; }
    // The guest's own needle: where they saw it when they pressed.
    if (cmd === 'time' && this.fight.timing) cmd = 'time@' + this.fight.needlePos().toFixed(3);
    this.cmds.push(cmd);
  }
  /** Is this page playing (not only watching)? */
  get playing() { return this.role === 'guest' && this.isOpp; }
  private isOpp = false;

  guestFrame(real: number, rdt: number) {
    if (this.role !== 'guest' || !this.room) return;
    if (this.hold.m && real - this.hold.mAt > HOLD_MS) this.hold.m = '';
    const hostPeer = this.room.peers().find(p => !p.isMe && p.presence.role === 'host' && p.presence.s);
    const snap = hostPeer?.presence.s as Snap | undefined;
    // An unchanged presence is the same object, so a new object is a new snapshot.
    if (snap && snap.v === 1 && snap !== this.lastSnap) { this.lastSnap = snap; this.apply(snap, real); }
    if (real - this.lastSnapAt > LOST_MS && !this.lostShown) {
      this.lostShown = true;
      this.hooks.status(hostPeer ? 'Connection lost' : `Joining ${this.code}`, hostPeer ? 'Waiting for the host…' : 'Looking for the host. Check the code.');
    }
    // Ease the bodies toward the host's latest poses.
    if (this.target) this.fight.showPoses(this.target, 1 - Math.exp(-rdt / 45));
    if (real - this.lastSend >= SEND_MS) {
      this.lastSend = real;
      const me = this.hooks.me();
      const g: GuestState = { name: me.name, style: me.style, cmds: this.cmds.items, m: this.hold.m, g: this.hold.g, l: this.hold.l };
      this.room.presence({ role: 'guest', code: this.code, g }).catch(() => {});
    }
  }

  private apply(s: Snap, real: number) {
    const f = this.fight, first = this.seen < 0;
    if (this.lostShown || first) this.hooks.status('', '');
    this.lastSnapAt = real;
    this.lostShown = false;
    const me = this.myPeer();
    this.isOpp = !!me && s.opp === me;
    if (this.isOpp) this.cmds.ack(s.ack);
    // Events: on joining, skip the backlog; afterwards play each new one once.
    const evs = freshEvents(Array.isArray(s.ev) ? s.ev : [], this.seen);
    if (first) this.seen = evs.length ? evs[evs.length - 1][0] : 0;
    else for (const e of evs) { this.seen = e[0]; this.hooks.play(e); }
    // Fight state, so the HUD, camera and input read it as if the fight ran here.
    f.mode = s.m; f.over = !!s.o; f.busy = !!s.b; f.round = s.r; f.clock = s.c; f.pos = s.pos; f.pairName = s.pn;
    f.config.rounds = s.rounds;
    f.top = s.top ? f[s.top] : null; f.bot = s.top ? f.other(f[s.top]) : null;
    (['red', 'blue'] as Color[]).forEach((c, i) => {
      const x = f[c], d = s.f[i];
      if (!d) return;
      x.name = String(d.n).slice(0, 24); x.style = SD.styles[d.s] ? d.s : 'mma'; x.stats = SD.styles[x.style];
      [x.headHP, x.headMax, x.sta, x.body, x.legs, x.x, x.z, x.yaw] = d.v;
      x.lean = { x: d.v[8] || 0, y: d.v[9] || 0 };
      x.guard = d.g ? { [d.g]: 1 } : {};
    });
    if (s.tm) {
      const [owner, title, width, center, age, period] = s.tm, key = title + center;
      if (key !== this.timingKey || !f.timing) f.timing = { owner, title, width, center, period, start: performance.now() - age - 40, resolve: () => {} } as Timing;
      this.timingKey = key;
    } else { f.timing = null; this.timingKey = ''; }
    if (s.sb) {
      const att = f[s.sb[0]];
      f.sub = { att, def: f.other(att), v: s.sb[1], name: s.sb[2] } as unknown as SubState;
    } else f.sub = null;
    f.camOverride = s.cam ? { pos: V(s.cam[0], s.cam[1], s.cam[2]), look: V(s.cam[3], s.cam[4], s.cam[5]), fov: s.cam[6] } : null;
    f.koCam = s.ko ? f[s.ko] : null;
    if (s.rig) {
      const [r, b, ref] = s.rig.map(decodeRig);
      if (r && b && ref) this.target = { red: r, blue: b, ref };
      if (first && this.target) this.fight.showPoses(this.target, 1);
    }
    const key = [s.m, s.o, s.b, s.top, s.pos, !!s.tm, !!s.sb, this.isOpp].join('|');
    if (key !== this.lastKey) { this.lastKey = key; this.hooks.changed(); }
  }
}

