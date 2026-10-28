// The park screen: walk the street, step into the gym, the shop or the court, and run pickup fights.
import { SD } from '../data';
import type { Color, Fight } from '../fight/fight';
import { STATS, type Stat } from '../fight/rules';
import type { UiSound } from '../audio/synth';
import type { Device } from '../input/input';
import { V } from '../rig/math';
import { resolveStand, standSpec } from '../rig/poses';
import { PALETTES, type FighterMesh, type Stage, type Venue } from '../rig/stage';
import type { Profile } from '../profile/profile';
import { DRILLS, type DrillId } from '../training/drills';
import type { GameCamera } from '../ui/camera';
import {
  CLASSES, DRILL_TRAINS, GEAR, MAX_LEVEL, PARK_FIGHTERS, PARK_FIGHTER_BY_ID, PICKUP_CONFIG, SLOTS, SLOT_LABEL, STAT_LABEL, STAT_PER_LEVEL,
  type Gear, type ParkFighter
} from './data';
import {
  applyFight, boosts, buyGear, canChallenge, classPrice, equip, gearPalette, levelOf, repTitle, takeClass, type ParkState, type XpGain
} from './progress';
import { walkSpec } from './walk';
import { BOUNDS, COURT_SPOTS, PLACES, type ParkWorld, type Place, type PlaceId } from './world';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = (n: number) => '$' + n.toLocaleString('en-US');

const WALK = 210, JOG = 360;
const START_X = -840;
const BTN = { cross: 0, circle: 1, up: 12, down: 13, left: 14, right: 15 };

export interface ParkHooks {
  get(): Profile;
  set(p: Profile): void;
  startDrill(id: DrillId): void;
  startPickup(id: string): void;
  device(): Device;
  ui?(kind: UiSound): void;
}

interface Npc { mesh: FighterMesh; spot: { x: number; z: number }; fighter: ParkFighter | null; yaw: number; t0: number }
type Spot = { kind: 'place'; place: Place } | { kind: 'npc'; npc: Npc };

export class ParkController {
  private x = START_X;
  private yaw = 90;
  private phase = 0;
  private speed = 0;
  private open: PlaceId | null = null;
  private autoTo: { x: number; then: PlaceId | null } | null = null;
  private held = new Set<string>();
  private touchDir = 0;
  private padDir = 0;
  private padPrev: boolean[] = [];
  private active = false;
  private npcs: Npc[];
  private message = '';
  private pickup: ParkFighter | null = null;

  private hide: FighterMesh[];

  /** player, opponent and ref are the fight's meshes; the opponent and ref hide while you walk the street. */
  constructor(private stage: Stage, private world: ParkWorld, private player: FighterMesh, private opponent: FighterMesh, ref: FighterMesh,
    makeNpc: () => FighterMesh, private camera: GameCamera, private hooks: ParkHooks) {
    this.hide = [opponent, ref];
    this.npcs = COURT_SPOTS.map((spot, i) => {
      const mesh = makeNpc();
      world.street.add(mesh.root);
      return { mesh, spot, fighter: null, yaw: 0, t0: i * 900 };
    });
  }

  private get park(): ParkState { return this.hooks.get().park; }
  private setPark(park: ParkState) {
    this.hooks.set({ ...this.hooks.get(), park });
    this.dressPlayer();
  }

  /** Your fighter's mesh wears the equipped gear in every mode. */
  dressPlayer() { this.player.setPalette(gearPalette(this.park, PALETTES.red)); }

  /** Show the cage, the street or the cage with the skyline behind it. */
  setVenue(v: Venue) {
    this.stage.setVenue(v);
    this.world.street.visible = v === 'park';
    this.world.skyline.visible = v !== 'arena';
  }

  // ---------- DOM ----------
  build() {
    addEventListener('keydown', e => {
      if (!this.active) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('select, input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
      this.held.add(k);
      if (e.repeat) return;
      if (k === 'arrowup' || k === 'w' || k === 'e' || (k === 'enter' && !t?.closest('button, a'))) this.interact();
      if (k === 'escape' || k === 'arrowdown' || k === 's') this.close();
    });
    addEventListener('keyup', e => this.held.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.held.clear(); this.touchDir = 0; });

    for (const [id, dir] of [['pk-left', -1], ['pk-right', 1]] as const) {
      const b = $(id);
      const stop = () => { if (this.touchDir === dir) this.touchDir = 0; };
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.autoTo = null; this.touchDir = dir; b.setPointerCapture?.(e.pointerId); });
      b.addEventListener('pointerup', stop);
      b.addEventListener('pointercancel', stop);
      b.addEventListener('lostpointercapture', stop);
    }
    $('pk-enter').addEventListener('click', () => this.interact());
    $('park-panel').addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
      if (b && !b.disabled) this.act(b.dataset.act!, b.dataset.id || '');
    });
    $('pr-park').addEventListener('click', () => { location.hash = '#park'; });
    $('pr-again').addEventListener('click', () => { if (this.pickup) this.hooks.startPickup(this.pickup.id); });
  }

  /** Enter the park screen. */
  enter(at?: number) {
    this.active = true;
    if (at !== undefined) this.x = at;
    this.held.clear(); this.touchDir = this.padDir = 0; this.autoTo = null; this.open = null; this.message = '';
    this.setVenue('park');
    for (const m of this.hide) m.root.visible = false;
    this.dressPlayer();
    this.placeNpcs();
    $('pickup-result').hidden = true;
    this.camera.snap(V(this.x + 40, 175, 1180), V(this.x + 40, 118, 0), 20);
    this.render();
  }

  leave() {
    this.active = false;
    this.held.clear(); this.touchDir = 0;
    for (const m of this.hide) m.root.visible = true;
    this.setVenue('arena');
  }

  /** The court shows the top fighters you can take on, plus the next one you can't yet. */
  private placeNpcs() {
    const p = this.park;
    const open = PARK_FIGHTERS.filter(f => canChallenge(p, f));
    const next = PARK_FIGHTERS.find(f => !canChallenge(p, f));
    const shown = [...open.slice(-(next ? 3 : 4)), ...(next ? [next] : [])];
    this.npcs.forEach((n, i) => {
      n.fighter = shown[i] || null;
      n.mesh.root.visible = !!n.fighter;
      if (n.fighter) n.mesh.setPalette({ ...PALETTES.blue, ...n.fighter.palette });
    });
  }

  // ---------- Frame ----------
  frame(now: number, rdt: number) {
    const dt = rdt / 1000;
    this.pollPad();
    let dir = this.touchDir || this.padDir;
    if (this.held.has('arrowleft') || this.held.has('a')) dir = -1;
    if (this.held.has('arrowright') || this.held.has('d')) dir = 1;
    if (dir) this.autoTo = null;
    if (this.autoTo) {
      // Arrive when the target is within this frame's step, so a slow frame can't overshoot back and forth.
      const d = this.autoTo.x - this.x;
      if (Math.abs(d) <= Math.max(4, this.speed * dt)) {
        const then = this.autoTo.then;
        this.x = this.autoTo.x; this.autoTo = null; this.speed = 0;
        if (then) this.openPlace(then);
      } else dir = Math.sign(d);
    }
    const jog = this.held.has('shift') || !!this.autoTo;
    const target = dir ? (jog ? JOG : WALK) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 10);
    if (Math.abs(this.speed) < 2 && !dir) this.speed = 0;
    if (dir) {
      this.x = Math.max(BOUNDS[0], Math.min(BOUNDS[1], this.x + dir * this.speed * dt));
      if (this.open) this.close();
    }
    this.phase += (this.speed * dt) / 17;

    // Face where you walk; face the door when a place is open.
    const wantYaw = this.open ? 180 : dir ? (dir > 0 ? 90 : -90) : this.yaw;
    let dy = ((wantYaw - this.yaw + 540) % 360) - 180;
    this.yaw += dy * Math.min(1, dt * 12);
    const v = this.speed / WALK;
    this.player.update(resolveStand(walkSpec(this.phase, v, Math.sin(now / 600)), { x: this.x, z: 0, yaw: this.yaw }, null));

    for (const n of this.npcs) {
      if (!n.fighter) continue;
      const close = Math.abs(n.spot.x - this.x) < 240;
      const want = close ? (Math.atan2(this.x - n.spot.x, 0 - n.spot.z) * 180) / Math.PI : 0;
      dy = ((want - n.yaw + 540) % 360) - 180;
      n.yaw += dy * Math.min(1, dt * 5);
      const body = { x: n.spot.x, z: n.spot.z, yaw: n.yaw };
      const bounce = Math.sin((now + n.t0) / 260) * 1.6;
      const st = close && canChallenge(this.park, n.fighter)
        ? resolveStand({ ...standSpec(SD, 'stance'), pelvis: { b: [0, 92 + bounce, 0] } }, body, null)
        : resolveStand(walkSpec(0, 0, Math.sin((now + n.t0) / 700)), body, null);
      n.mesh.update(st);
    }

    this.camera.follow(V(this.x + 40, 175, 1180), V(this.x + 40, 118, 0), 20, rdt);
    this.updatePrompt();
  }

  private pollPad() {
    let gp: Gamepad | undefined;
    try { gp = [...(navigator.getGamepads?.() || [])].find((p): p is Gamepad => !!p && p.connected); } catch { return; }
    if (!gp) { this.padDir = 0; return; }
    const now = gp.buttons.map(b => b.pressed), was = this.padPrev;
    const down = (i: number) => now[i] && !was[i];
    this.padPrev = now;
    const ax = gp.axes[0] || 0;
    this.padDir = 0;
    if (this.open) {
      // In a panel the stick and d-pad move between buttons.
      if (down(BTN.up) || down(BTN.left)) this.moveFocus(-1);
      if (down(BTN.down) || down(BTN.right)) this.moveFocus(1);
      if (down(BTN.cross)) {
        const f = document.activeElement as HTMLElement | null;
        if (f?.closest('#park-panel button')) (f as HTMLButtonElement).click(); else this.moveFocus(1);
      }
      if (down(BTN.circle)) this.close();
      return;
    }
    const left = ax < -0.4 || !!now[BTN.left], right = ax > 0.4 || !!now[BTN.right];
    this.padDir = left ? -1 : right ? 1 : 0;
    if (down(BTN.cross) || down(BTN.up)) this.interact();
  }

  private moveFocus(step: number) {
    const list = [...document.querySelectorAll<HTMLButtonElement>('#park-panel button:not(:disabled)')];
    if (!list.length) return;
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = list[(i + step + list.length) % list.length] || list[0];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
  }

  /** The place or fighter you are standing next to. */
  private spot(): Spot | null {
    let best: Spot | null = null, bestD = Infinity;
    for (const place of PLACES) {
      const d = Math.abs(place.x - this.x);
      if (d < place.reach && d < bestD) { best = { kind: 'place', place }; bestD = d; }
    }
    for (const npc of this.npcs) {
      const d = Math.abs(npc.spot.x - this.x);
      if (npc.fighter && d < 55 && d < bestD) { best = { kind: 'npc', npc }; bestD = d; }
    }
    return best;
  }

  private updatePrompt() {
    const s = this.open ? null : this.spot();
    const pad = this.hooks.device() === 'pad';
    const key = pad ? '✕' : '↑';
    let text = '';
    if (s?.kind === 'place') text = `${s.place.id === 'court' ? 'Check the board' : 'Enter ' + s.place.name}`;
    else if (s?.kind === 'npc') {
      const f = s.npc.fighter!;
      text = canChallenge(this.park, f) ? `Challenge ${f.name} · ${money(f.purse)}` : `${f.name} wants ${f.rep} rep first`;
    }
    const el = $('park-prompt');
    const html = text ? `<kbd>${key}</kbd> ${esc(text)}` : '';
    if (el.innerHTML !== html) el.innerHTML = html;
    el.hidden = !text;
    const enter = $<HTMLButtonElement>('pk-enter');
    enter.disabled = !text;
    enter.textContent = s?.kind === 'npc' ? 'Challenge' : 'Enter';
    const p = this.park;
    const hud = `<b>${money(p.cash)}</b><span>Rep ${p.rep} · ${esc(repTitle(p))}</span>`;
    if ($('park-hud').innerHTML !== hud) $('park-hud').innerHTML = hud;
  }

  private interact() {
    const s = this.spot();
    if (!s || this.open) return;
    if (s.kind === 'place') this.openPlace(s.place.id);
    else if (canChallenge(this.park, s.npc.fighter!)) this.hooks.startPickup(s.npc.fighter!.id);
    else { this.message = `${s.npc.fighter!.name} won't fight a nobody. Earn ${s.npc.fighter!.rep} rep at the court first.`; this.openPlace('court'); }
  }

  private openPlace(id: PlaceId) {
    const place = PLACES.find(p => p.id === id)!;
    this.x = Math.max(this.x, place.x - place.reach + 1);
    this.x = Math.min(this.x, place.x + place.reach - 1);
    this.open = id;
    this.render();
    // Bring the panel into view on narrow screens, where it sits under the street.
    if (matchMedia('(max-width: 860px)').matches) $('park-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (this.hooks.device() === 'pad') this.moveFocus(1);
  }

  private close() {
    if (!this.open) return;
    this.open = null; this.message = '';
    this.render();
  }

  private act(act: string, id: string) {
    const p = this.park;
    if (act === 'go') { const place = PLACES.find(pl => pl.id === id)!; this.open = null; this.autoTo = { x: place.x, then: place.id }; this.render(); return; }
    if (act === 'close') return this.close();
    if (act === 'drill') return this.hooks.startDrill(id as DrillId);
    if (act === 'fight') return this.hooks.startPickup(id);
    if (act === 'class') {
      const c = CLASSES.find(k => k.id === id)!;
      const r = takeClass(p, c);
      if (!r.ok) this.message = r.why === 'cash' ? `You need ${money(classPrice(p, c))} for ${c.name}.` : `You've learned all ${c.name} can teach.`;
      else { this.setPark(r.park); this.message = `${c.name}: ${gainText(r.gains)}`; this.hooks.ui?.(r.gains.some(g => g.to > g.from) ? 'level' : 'click'); }
    }
    if (act === 'buy') {
      const g = GEAR.find(k => k.id === id)!;
      const r = buyGear(p, id);
      if (!r.ok) this.message = r.why === 'cash' ? `${g.name} costs ${money(g.price)}.` : r.why === 'rep' ? `The shop keeps ${g.name} for regulars (${g.rep} rep).` : '';
      else { this.setPark(r.park); this.message = `Bought and put on: ${g.name}.`; this.hooks.ui?.('cash'); }
    }
    if (act === 'equip') {
      const r = equip(p, id);
      if (r.ok) { this.setPark(r.park); this.message = `Wearing ${GEAR.find(k => k.id === id)!.name}.`; this.hooks.ui?.('click'); }
    }
    this.render();
  }

  // ---------- Panels ----------
  private render() {
    const p = this.park, prof = this.hooks.get();
    let html = '';
    const msg = this.message ? `<p class="pk-msg">${esc(this.message)}</p>` : '';
    const back = `<button type="button" data-act="close" class="pk-back">&larr; Back to the street</button>`;
    if (!this.open) {
      html = `<div class="pk-head"><h2>Downtown</h2><span class="pk-sub">Walk with &larr; &rarr; or A/D, hold Shift to jog</span></div>
        <div class="pk-card">
          <div><span class="label">Fighter</span><b>${esc(prof.name)}</b><span class="muted">${esc(SD.styles[prof.style].label)}</span></div>
          <div><span class="label">Cash</span><b>${money(p.cash)}</b></div>
          <div><span class="label">Rep</span><b>${p.rep}</b><span class="muted">${esc(repTitle(p))}</span></div>
        </div>
        <ul class="pk-list">${PLACES.map(pl => `<li><div><b>${esc(pl.name)}</b><span class="muted">${PLACE_BLURB[pl.id]}</span></div>
          <button type="button" data-act="go" data-id="${pl.id}">Go</button></li>`).join('')}</ul>
        <h3>Your stats in park fights</h3>
        ${this.statTable(p)}
        <p class="muted small">Training and gear count in park fights. Quick fights and training drills use the plain style.</p>`;
    } else if (this.open === 'gym') {
      html = `<div class="pk-head"><h2>Iron Gym</h2>${back}</div>${msg}
        <h3>Drills <span class="muted">free · XP from your score</span></h3>
        <ul class="pk-list">${(Object.keys(DRILL_TRAINS) as DrillId[]).map(id => {
          const d = DRILLS[id], best = prof.training[id];
          return `<li><div><b>${esc(d.name)}</b><span class="muted">Trains ${DRILL_TRAINS[id]!.map(s => STAT_LABEL[s]).join(', ')}${best !== undefined ? ` · best ${best}` : ''}</span></div>
            <button type="button" data-act="drill" data-id="${id}">Train</button></li>`;
        }).join('')}</ul>
        <h3>Classes <span class="muted">paid · instant XP</span></h3>
        <ul class="pk-list">${CLASSES.map(c => {
          const price = classPrice(p, c), maxed = c.stats.every(s => levelOf(p.xp[s]).max);
          return `<li><div><b>${esc(c.name)}</b><span class="muted">${esc(c.blurb)}</span><span class="muted">+${c.xp} XP · ${c.stats.map(s => `${STAT_LABEL[s]} Lv ${levelOf(p.xp[s]).level}`).join(', ')}</span></div>
            <button type="button" data-act="class" data-id="${c.id}" ${maxed || price > p.cash ? 'disabled' : ''}>${maxed ? 'Maxed' : money(price)}</button></li>`;
        }).join('')}</ul>`;
    } else if (this.open === 'shop') {
      html = `<div class="pk-head"><h2>Fight Shop</h2>${back}</div>${msg}
        <p class="muted small">You have ${money(p.cash)}. New gear goes on as soon as you buy it.</p>
        ${SLOTS.map(slot => `<h3>${SLOT_LABEL[slot]}</h3><ul class="pk-list">${GEAR.filter(g => g.slot === slot).map(g => this.gearRow(p, g)).join('')}</ul>`).join('')}`;
    } else {
      html = `<div class="pk-head"><h2>The Court</h2>${back}</div>${msg}
        <p class="muted small">One round, two minutes. Wins pay the purse and build rep; a first win over someone pays half again. Losses still pay a little.</p>
        <ul class="pk-list">${PARK_FIGHTERS.map(f => {
          const ok = canChallenge(p, f), beat = p.beaten.includes(f.id);
          return `<li class="${ok ? '' : 'locked'}"><div><b>${esc(f.name)}${beat ? ' <span class="pk-tag">Beaten</span>' : ''}</b>
            <span class="muted">${esc(SD.styles[f.style].label)} · ${f.level} · ${money(f.purse)} · +${f.repWin} rep</span><span class="muted">${esc(f.blurb)}</span></div>
            <button type="button" data-act="fight" data-id="${f.id}" ${ok ? '' : 'disabled'}>${ok ? 'Fight' : `${f.rep} rep`}</button></li>`;
        }).join('')}</ul>`;
    }
    $('park-panel').innerHTML = html;
  }

  private gearRow(p: ParkState, g: Gear) {
    const owned = p.owned.includes(g.id), on = p.equipped[g.slot] === g.id, locked = (g.rep || 0) > p.rep;
    const swatch = g.colors ? `<i class="sw" style="background:${Object.values(g.colors)[0]}"></i>` : '';
    const boost = Object.entries(g.boost).map(([s, n]) => `+${n} ${STAT_LABEL[s as Stat]}`).join(', ') || 'No stat bonus';
    const btn = on ? `<button type="button" disabled>Wearing</button>`
      : owned ? `<button type="button" data-act="equip" data-id="${g.id}">Wear</button>`
      : locked ? `<button type="button" disabled>${g.rep} rep</button>`
      : `<button type="button" data-act="buy" data-id="${g.id}" ${g.price > p.cash ? 'disabled' : ''}>${money(g.price)}</button>`;
    return `<li><div><b>${swatch}${esc(g.name)}</b><span class="muted">${boost}</span></div>${btn}</li>`;
  }

  private statTable(p: ParkState) {
    const total = boosts(p), base = SD.styles[this.hooks.get().style];
    return `<div class="pk-stats">${STATS.map(s => {
      const lv = levelOf(p.xp[s]), pct = lv.max ? 100 : Math.round((lv.into / lv.need) * 100);
      return `<div class="pk-stat"><span>${STAT_LABEL[s]}</span><b>${Math.min(99, base[s] + (total[s] || 0))}</b>
        <span class="lv" title="Training level ${lv.level} of ${MAX_LEVEL}">Lv ${lv.level}</span><i class="bar"><i style="width:${pct}%"></i></i></div>`;
    }).join('')}</div>
    <p class="muted small">Each training level adds ${STAT_PER_LEVEL} to a stat, up to level ${MAX_LEVEL}. Numbers include your gear.</p>`;
  }

  // ---------- Pickup fights ----------
  /** Start a pickup fight against a park fighter. Returns false if they won't fight you yet. */
  startPickup(fight: Fight, id: string): boolean {
    const f = PARK_FIGHTER_BY_ID[id], prof = this.hooks.get();
    if (!f || !canChallenge(prof.park, f)) return false;
    this.pickup = f;
    this.active = false;
    for (const m of this.hide) m.root.visible = true;
    for (const n of this.npcs) n.mesh.root.visible = false;
    this.setVenue('court');
    this.dressPlayer();
    this.opponent.setPalette({ ...PALETTES.blue, ...f.palette });
    $('pickup-result').hidden = true;
    fight.start({
      redStyle: prof.style, blueStyle: f.style, level: f.level, redName: prof.name, blueName: f.name,
      redBoost: boosts(prof.park), blueBoost: f.boost, config: { ...PICKUP_CONFIG }
    });
    return true;
  }

  /** Pay out a finished pickup fight and show the result over the cage. */
  endPickup(winner: Color | null) {
    const f = this.pickup;
    if (!f) return;
    const result = winner === 'red' ? 'win' : winner ? 'loss' : 'draw';
    const { park, pay } = applyFight(this.park, f, result);
    this.setPark(park);
    setTimeout(() => this.hooks.ui?.('cash'), 900);
    $('pr-title').textContent = result === 'win' ? (pay.king ? 'King of the Court' : 'You won') : result === 'loss' ? 'You lost' : 'Draw';
    $('pr-cash').textContent = '+' + money(pay.cash);
    $('pr-rep').textContent = `+${pay.rep} rep`;
    $('pr-detail').textContent = pay.king ? 'You beat The King. The court is yours.'
      : pay.first ? `First win over ${f.name}: purse plus half again.`
      : result === 'loss' ? `${f.name} still paid you for showing up. Train and come back.` : `Rep ${park.rep} · ${repTitle(park)}`;
    $('pickup-result').hidden = false;
    $('pr-again').hidden = !canChallenge(park, f);
  }

  /** Leaving a pickup fight: restore the default opponent colors. */
  endPickupScreen() {
    this.opponent.setPalette(PALETTES.blue);
    $('pickup-result').hidden = true;
  }
}

const PLACE_BLURB: Record<PlaceId, string> = {
  gym: 'Drills and classes. Raise your stats.',
  shop: 'Gloves, shorts, wraps and mouthguards.',
  court: 'Pickup fights for cash and rep.'
};

function gainText(gains: XpGain[]) {
  return gains.map(g => `+${g.xp} ${STAT_LABEL[g.stat]} XP${g.to > g.from ? ` (level ${g.to}!)` : ''}`).join(', ');
}
