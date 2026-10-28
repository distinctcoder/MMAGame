// Keyboard and gamepads (PS5 DualSense or any standard-mapping controller) turned into fight commands.
// Each device sits on a side (seat): one player uses the keyboard and a controller; two players can each take a controller.
import type { Zone } from '../data/types';
import type { Color, Fight } from '../fight/fight';

export type Device = 'keyboard' | 'pad' | 'blocked';

export const LABELS: Record<'keyboard' | 'pad', Record<string, string>> = {
  keyboard: {
    time: 'Space', block: 'Space', blockhigh: 'W+Space', evade: 'F', jab: 'J', cross: 'K', lead_hook: 'U', rear_hook: 'I', uppercut: 'Y',
    low_kick: 'L', body_kick: 'O', head_kick: 'P', shoot: 'G', clinch: 'C', back: '←', fwd: '→', sideup: '↑', sidedown: '↓',
    knee: 'L', elbow: 'J', trip: 'G', pummel: 'C', breakaway: 'R', punch: 'J', advance: 'G', sweep: 'G', submit: 'H', getup: 'R'
  },
  pad: {
    time: '✕', block: 'L1', blockhigh: 'L1+up', evade: 'R stick', jab: '□', cross: '△', lead_hook: 'R1+□', rear_hook: 'R1+△',
    uppercut: 'R1+✕', low_kick: '✕', body_kick: '○', head_kick: 'R1+○', shoot: 'L2', clinch: 'R1+L2', back: 'Stick ←', fwd: 'Stick →',
    sideup: 'Stick ↑', sidedown: 'Stick ↓',
    knee: '✕', elbow: '□', trip: 'L2', pummel: 'R1', breakaway: 'R2', punch: '□', advance: 'L2', sweep: 'L2', submit: '○', getup: 'R2'
  }
};

const KEYMAP: Record<string, string> = {
  j: 'strike:jab', k: 'strike:cross', u: 'strike:lead_hook', i: 'strike:rear_hook', y: 'strike:uppercut',
  l: 'strike:low_kick', o: 'strike:body_kick', p: 'strike:head_kick',
  g: 'shoot', c: 'clinch', h: 'submit', r: 'getup'
};
const CLINCH_KEYS: Record<string, string> = { j: 'elbow', k: 'elbow', u: 'elbow', i: 'elbow', l: 'knee', o: 'knee', g: 'trip', c: 'pummel', r: 'breakaway' };
const DIR_ZONE: Record<string, Zone> = { w: 'high', a: 'left', d: 'right', s: 'low' };
// Standard gamepad mapping. On a DualSense: 0 cross, 1 circle, 2 square, 3 triangle.
const BTN = { cross: 0, circle: 1, square: 2, triangle: 3, l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, up: 12, down: 13, left: 14, right: 15 };

interface Stick { left: boolean; right: boolean; up: boolean; down: boolean }

export interface InputHooks {
  /** Only route input while the fight screen is showing. */
  active(): boolean;
  deviceChanged(kind: Device, id?: string): void;
  restart(): void;
  /** Leave the fight (the controller's Create button). */
  back?(): void;
  /** Which side a device drives: the keyboard (and touch buttons) or the pad at this index among connected pads. Default red. */
  seat?(dev: 'keyboard' | number, pads: number): Color | null;
}
/** Where commands go: the local fight, or the network when playing someone in a room. */
export type Sink = (cmd: string, who: Color) => void;
type Held = { guard: string | null; lean: string };

export class Input {
  device: 'keyboard' | 'pad' = 'keyboard';
  private held = new Set<string>();
  private pads: Gamepad[] = [];
  private padPrev = new Map<number, boolean[]>();
  private padBlocked = false;
  // The guard and lean last sent from each device, so held input only sends changes.
  private sent = new Map<string, Held>();
  sink: Sink;

  constructor(private fight: Fight, private hooks: InputHooks) {
    this.sink = (cmd, who) => fight.command(cmd, who);
  }
  /** How many controllers are connected right now. */
  get padCount() { return this.pads.length; }

  private seatOf(dev: 'keyboard' | number): Color | null {
    return this.hooks.seat ? this.hooks.seat(dev, this.pads.length) : 'red';
  }
  /** A command from the keyboard or an on-screen button. */
  command(cmd: string) { const who = this.seatOf('keyboard'); if (who) this.sink(cmd, who); }

  key(name: string) { return LABELS[this.device][name] || name; }

  attach() {
    addEventListener('keydown', e => this.onKey(e));
    addEventListener('keyup', e => this.held.delete(e.key.toLowerCase()));
    addEventListener('blur', () => this.held.clear());
    addEventListener('gamepadconnected', e => this.setDevice('pad', (e as GamepadEvent).gamepad.id));
    addEventListener('gamepaddisconnected', () => { if (this.pads.length <= 1) this.setDevice('keyboard'); });
  }

  private setDevice(kind: Device, id?: string) {
    const next = kind === 'pad' ? 'pad' : 'keyboard';
    const changed = next !== this.device;
    this.device = next;
    if (changed || kind === 'blocked') this.hooks.deviceChanged(kind, id);
  }

  private heldDir<T>(map: Record<string, T>, fallback: T): T {
    for (const k of ['w', 'a', 'd', 's']) if (this.held.has(k)) return map[k];
    return fallback;
  }

  private onKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (!this.hooks.active() || target?.closest('select, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase(), f = this.fight;
    if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
    if (e.repeat) return;
    this.held.add(k);
    this.setDevice('keyboard');
    if (k === ' ') {
      if (f.timing || f.sub) return this.command('time');
      if (f.mode === 'clinch') return this.command('cblock:' + (this.held.has('w') ? 'high' : 'body'));
      if (f.mode === 'ground') return this.command('block');
      return; // standing, the guard is held (see holdKeys)
    }
    if (k === 'f' || k.startsWith('arrow')) return; // lean and footwork are held too
    if (f.mode === 'clinch') { if (CLINCH_KEYS[k]) this.command(CLINCH_KEYS[k]); return; }
    if (f.mode === 'ground') {
      if (k === 'j' || k === 'k') return this.command('punch');
      if (k === 'g') return this.command('pass');
    }
    if (KEYMAP[k]) this.command(KEYMAP[k]);
  }

  /** Read the controller once per frame. Uses button edges so a held button fires once. */
  poll() {
    if (this.hooks.active()) this.holdKeys();
    let pads: (Gamepad | null)[] = [];
    try { pads = navigator.getGamepads ? [...navigator.getGamepads()] : []; }
    catch { if (!this.padBlocked) { this.padBlocked = true; this.setDevice('blocked'); } return; }
    const had = this.pads.length;
    this.pads = pads.filter((p): p is Gamepad => !!p && p.connected);
    if (!this.pads.length) { if (had) this.setDevice('keyboard'); return; }
    this.pads.forEach((gp, n) => {
      const now = gp.buttons.map(b => b.pressed), was = this.padPrev.get(gp.index) || [];
      const down = (i: number) => now[i] && !was[i], on = (i: number) => !!now[i];
      if (now.some((b, i) => b && !was[i])) this.setDevice('pad', gp.id);
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const stick: Stick = { left: ax < -0.55 || on(BTN.left), right: ax > 0.55 || on(BTN.right), up: ay < -0.55 || on(BTN.up), down: ay > 0.55 || on(BTN.down) };
      const who = this.seatOf(n);
      if (down(BTN.options) && this.hooks.active()) this.hooks.restart();
      else if (down(BTN.create) && this.hooks.active()) this.hooks.back?.();
      else if (who && this.hooks.active()) this.padCommands('pad' + gp.index, who, down, on, stick, gp.axes);
      this.padPrev.set(gp.index, now);
    });
  }

  /** Send a held guard or lean only when it changes. */
  private send(dev: string, who: Color, guard: string | null, lean: string) {
    let s = this.sent.get(dev);
    if (!s) this.sent.set(dev, s = { guard: null, lean: '0,0' });
    if (guard !== s.guard) { this.sink('guard:' + (guard ?? 'off'), who); s.guard = guard; }
    if (lean !== s.lean) { this.sink('lean:' + lean, who); s.lean = lean; }
  }
  /** Forget what was sent, e.g. when a new fight starts or seats change. */
  resetHeld() { this.sent.clear(); }

  /**
   * Held keyboard controls, read every frame: Space + W/A/S/D holds the guard in a zone, F + any of W/A/S/D leans
   * (combine them: S and A is a bob to the left), and the arrows keep stepping: left and right in and out,
   * up and down around the opponent.
   */
  private holdKeys() {
    const h = this.held, f = this.fight, who = this.seatOf('keyboard');
    if (!who) return;
    if (f.mode !== 'stand' || f.over) { this.send('keys', who, null, '0,0'); return; }
    const guard = h.has(' ') ? this.heldDir(DIR_ZONE, 'body') : null;
    let lx = 0, ly = 0;
    if (h.has('f')) {
      lx = (h.has('d') ? 1 : 0) - (h.has('a') ? 1 : 0);
      ly = (h.has('w') ? 1 : 0) - (h.has('s') ? 1 : 0);
      if (!lx && !ly) ly = -1;
    }
    this.send('keys', who, guard, `${lx},${ly}`);
    const mx = (h.has('arrowright') ? 1 : 0) - (h.has('arrowleft') ? 1 : 0), mz = (h.has('arrowdown') ? 1 : 0) - (h.has('arrowup') ? 1 : 0);
    if (mx || mz) this.sink(`move:${mx},${mz}`, who);
  }

  private padCommands(dev: string, who: Color, down: (i: number) => boolean, on: (i: number) => boolean, stick: Stick, axes: readonly number[]) {
    const f = this.fight, cmd = (c: string) => this.sink(c, who);
    if (f.timing || f.sub) { if (down(BTN.cross) || down(BTN.square)) cmd('time'); return; }
    if (f.mode === 'stand') {
      const r1 = on(BTN.r1);
      if (down(BTN.square)) cmd(r1 ? 'strike:lead_hook' : 'strike:jab');
      if (down(BTN.triangle)) cmd(r1 ? 'strike:rear_hook' : 'strike:cross');
      if (down(BTN.cross)) cmd(r1 ? 'strike:uppercut' : 'strike:low_kick');
      if (down(BTN.circle)) cmd(r1 ? 'strike:head_kick' : 'strike:body_kick');
      if (down(BTN.l2)) cmd(r1 ? 'clinch' : 'shoot');
      // Guard: hold L1, aim it with the stick.
      const guard = on(BTN.l1) ? (stick.up ? 'high' : stick.left ? 'left' : stick.right ? 'right' : stick.down ? 'low' : 'body') : null;
      // Head movement: the right stick leans as far as you push it; or hold R2 and lean with the left stick.
      const dz = (v: number) => (Math.abs(v) < 0.2 ? 0 : Math.round(v * 10) / 10);
      let lx = dz(axes[2] || 0), ly = -dz(axes[3] || 0);
      if (on(BTN.r2)) { lx = dz(axes[0] || 0); ly = -dz(axes[1] || 0); if (!lx && !ly) ly = -1; }
      this.send(dev, who, guard, `${lx},${ly}`);
      // Footwork: the left stick steps in, out and around.
      if (!on(BTN.l1) && !on(BTN.r2)) {
        const mx = stick.right ? 1 : stick.left ? -1 : 0, mz = stick.down ? 1 : stick.up ? -1 : 0;
        if (mx || mz) cmd(`move:${mx},${mz}`);
      }
    } else if (f.mode === 'clinch') {
      if (down(BTN.l1)) cmd('cblock:' + (stick.up ? 'high' : 'body'));
      if (down(BTN.square) || down(BTN.triangle)) cmd('elbow');
      if (down(BTN.cross) || down(BTN.circle)) cmd('knee');
      if (down(BTN.l2)) cmd('trip');
      if (down(BTN.r1)) cmd('pummel');
      if (down(BTN.r2)) cmd('breakaway');
    } else if (f.mode === 'ground') {
      if (down(BTN.l1)) cmd('block');
      if (down(BTN.square) || down(BTN.triangle)) cmd('punch');
      if (down(BTN.l2)) cmd('pass');
      if (down(BTN.circle)) cmd('submit');
      if (down(BTN.r2)) cmd('getup');
    }
  }

  /** Shake the controllers that drive `to` (every controller when it's left out). */
  rumble(strength: number, ms: number, to?: Color) {
    this.pads.forEach((gp, n) => {
      if (to && this.seatOf(n) !== to) return;
      const act = (gp as Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }).vibrationActuator;
      act?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 0.7) }).catch(() => {});
    });
  }
}
