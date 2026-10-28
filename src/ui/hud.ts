// Everything drawn over and around the cage: meters, clock, prompts, pops, tells, contest panels, buttons and charts.
import type * as THREE from 'three';
import { FD, SD } from '../data';
import type { EvadeKind, Strike, Zone } from '../data/types';
import type { Fight, PopKind } from '../fight/fight';
import { NEXT, SWEEP } from '../fight/rules';
import { LABELS, type Input } from '../input/input';
import { clamp, type Vector3 } from '../rig/math';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// Contextual on-screen buttons. Each has a command and a label key for the keyboard or controller glyph.
type Ctx = 'stand' | 'clinch' | 'top' | 'bot' | 'time' | 'none';
const ACTIONS: { ctx: Ctx; cmd: string; text: string; key: string }[] = [
  { ctx: 'stand', cmd: 'strike:jab', text: 'Jab', key: 'jab' },
  { ctx: 'stand', cmd: 'strike:cross', text: 'Cross', key: 'cross' },
  { ctx: 'stand', cmd: 'strike:lead_hook', text: 'Lead hook', key: 'lead_hook' },
  { ctx: 'stand', cmd: 'strike:rear_hook', text: 'Rear hook', key: 'rear_hook' },
  { ctx: 'stand', cmd: 'strike:uppercut', text: 'Uppercut', key: 'uppercut' },
  { ctx: 'stand', cmd: 'strike:low_kick', text: 'Low kick', key: 'low_kick' },
  { ctx: 'stand', cmd: 'strike:body_kick', text: 'Body kick', key: 'body_kick' },
  { ctx: 'stand', cmd: 'strike:head_kick', text: 'Head kick', key: 'head_kick' },
  { ctx: 'stand', cmd: 'shoot', text: 'Shoot takedown', key: 'shoot' },
  { ctx: 'stand', cmd: 'clinch', text: 'Clinch', key: 'clinch' },
  { ctx: 'stand', cmd: 'step:-1', text: 'Step left', key: 'back' },
  { ctx: 'stand', cmd: 'step:1', text: 'Step right', key: 'fwd' },
  { ctx: 'clinch', cmd: 'knee', text: 'Knee', key: 'knee' },
  { ctx: 'clinch', cmd: 'elbow', text: 'Elbow', key: 'elbow' },
  { ctx: 'clinch', cmd: 'cblock:body', text: 'Block knee', key: 'block' },
  { ctx: 'clinch', cmd: 'cblock:high', text: 'Block elbow', key: 'blockhigh' },
  { ctx: 'clinch', cmd: 'pummel', text: 'Pummel for the tie', key: 'pummel' },
  { ctx: 'clinch', cmd: 'trip', text: 'Trip', key: 'trip' },
  { ctx: 'clinch', cmd: 'breakaway', text: 'Break away', key: 'breakaway' },
  { ctx: 'top', cmd: 'punch', text: 'Ground and pound', key: 'punch' },
  { ctx: 'top', cmd: 'advance', text: 'Pass / advance', key: 'advance' },
  { ctx: 'top', cmd: 'submit', text: 'Submit', key: 'submit' },
  { ctx: 'top', cmd: 'getup', text: 'Stand up', key: 'getup' },
  { ctx: 'bot', cmd: 'block', text: 'Block', key: 'block' },
  { ctx: 'bot', cmd: 'sweep', text: 'Sweep', key: 'sweep' },
  { ctx: 'bot', cmd: 'submit', text: 'Submit', key: 'submit' },
  { ctx: 'bot', cmd: 'getup', text: 'Get up', key: 'getup' },
  { ctx: 'time', cmd: 'time', text: 'Time it / mash', key: 'time' }
];

export class Hud {
  private box = $('box');
  private bannerTimer = 0;

  constructor(private fight: Fight, private input: Input, private camera: THREE.PerspectiveCamera) {}

  // ---------- Messages ----------
  private project(p: Vector3) {
    const v = p.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.box.clientWidth, y: (1 - v.y) / 2 * this.box.clientHeight };
  }
  pop(at: Vector3, text: string, kind: PopKind) {
    const el = document.createElement('div');
    el.className = 'pop ' + kind; el.textContent = text;
    const s = this.project(at.clone().setY(at.y + 8));
    el.style.left = s.x + 'px'; el.style.top = s.y + 'px';
    this.box.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }
  banner(text: string, sub?: string | null, ms = 1200) {
    const el = $('banner');
    el.textContent = text;
    if (sub) { const s = document.createElement('small'); s.textContent = sub; el.appendChild(s); }
    el.classList.add('show');
    clearTimeout(this.bannerTimer);
    if (ms) this.bannerTimer = window.setTimeout(() => el.classList.remove('show'), ms);
  }
  clearBanner() { $('banner').classList.remove('show'); }
  log(text: string, detail?: string) {
    const list = $('log'), li = document.createElement('li');
    li.textContent = text;
    if (detail) { const s = document.createElement('small'); s.textContent = detail; li.appendChild(s); }
    list.prepend(li);
    while (list.children.length > 10) list.lastChild!.remove();
  }
  clearLog() { $('log').innerHTML = ''; }
  tell(s: Strike | null) {
    const el = $('tell');
    if (!s) { el.hidden = true; return; }
    const z = SD.zones[s.zone];
    const dodge = [...new Set((Object.keys(s.evade || {}) as EvadeKind[]).filter(k => s.evade![k] === 0).map(k => SD.evades[k].short))];
    el.innerHTML = `${s.label} &middot; block <b>${z.arrow} ${z.label}</b>${dodge.length ? ' or ' + dodge.join(' / ') : ''}`;
    el.hidden = false;
  }

  // ---------- Per-frame ----------
  frame() {
    const f = this.fight;
    for (const x of [f.red, f.blue]) {
      $(x.color + '-hp').style.width = (x.headHP / x.headMax * 100) + '%';
      $(x.color + '-sta').style.width = x.sta + '%';
      $(x.color + '-body').textContent = String(Math.round(x.body));
      $(x.color + '-legs').textContent = String(Math.round(x.legs));
      const name = $(x.color + '-name');
      if (name.textContent !== x.name) name.textContent = x.name;
    }
    const c = Math.max(0, Math.ceil(f.clock / 1000));
    $('clock').innerHTML = `<small>R${f.round}</small>${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
    const a = f.red.action;
    document.querySelectorAll<HTMLElement>('#blockpad button').forEach(b => b.classList.toggle('active', f.mode === 'stand' && a.type === 'block' && a.zone === b.dataset.zone));
    document.querySelectorAll<HTMLElement>('#evadepad button').forEach(b => b.classList.toggle('active', f.mode === 'stand' && a.type === 'evade' && a.kind === b.dataset.kind));
    $('timing').hidden = !f.timing;
    if (f.timing) $('timing-needle').style.left = (f.needlePos() * 100) + '%';
    $('sub').hidden = !f.sub;
    if (f.sub) $('sub-fill').style.width = (f.sub.att === f.red ? f.sub.v : 100 - f.sub.v) + '%';
    const tell = $('tell');
    if (!tell.hidden) {
      const s = this.project(f.blue.bodyJoints.head), room = this.box.clientWidth - tell.offsetWidth - 6;
      tell.style.left = clamp(s.x + 34, 6, room) + 'px'; tell.style.top = Math.max(s.y, 70) + 'px';
    }
  }

  // ---------- Controls that change with the situation ----------
  private ctx(): Ctx {
    const f = this.fight;
    if (f.timing || f.sub) return 'time';
    if (f.mode === 'stand') return 'stand';
    if (f.mode === 'clinch') return 'clinch';
    if (f.mode === 'ground') return f.top === f.human() ? 'top' : 'bot';
    return 'none';
  }
  refresh() {
    const f = this.fight, me = f.human(), ctx = this.ctx(), key = (k: string) => this.input.key(k);
    const subLabel = f.subName() ? FD.subs[f.subName()!].label : 'Submit';
    document.querySelectorAll<HTMLButtonElement>('#actions button').forEach(b => {
      const cmd = b.dataset.cmd!;
      b.hidden = b.dataset.ctx !== ctx;
      if (cmd === 'pummel') { b.hidden ||= f.top === me; b.disabled = f.busy; }
      else if (cmd.startsWith('cblock')) b.disabled = f.over;
      else if (cmd === 'advance') b.disabled = !(f.pos && NEXT[f.pos]) || f.busy;
      else if (cmd === 'submit') { b.hidden ||= !f.canSubmit(me); b.disabled = f.busy; b.querySelector('span')!.textContent = subLabel; }
      else if (cmd === 'sweep') { b.querySelector('span')!.textContent = f.pos === 'side' ? 'Escape to guard' : (f.pos && SWEEP[f.pos].name) || 'Sweep'; b.disabled = f.busy; }
      else b.disabled = f.over || (ctx !== 'stand' && ctx !== 'time' && f.busy && cmd !== 'block');
      b.classList.toggle('hot', ctx === 'time');
    });
    $('block-group').hidden = ctx !== 'stand';
    $('evade-group').hidden = ctx !== 'stand';
    const posLabel = (f.pos && FD.pairs[f.pos].label) || '';
    $('pos').textContent = f.mode === 'clinch' ? `Clinch · ${f.top!.name} has the tie` : f.mode === 'ground' ? `${posLabel} · ${f.top!.name} on top`
      : f.mode === 'grapple' ? 'Scramble' : f.mode === 'break' ? 'Between rounds' : 'Standing';
    $('timing-title').textContent = f.timing?.title || '';
    $('timing-hint').textContent = `Press ${key('time')} in the green`;
    if (f.timing) {
      const z = $('timing-zone');
      z.style.left = ((f.timing.center - f.timing.width / 2) * 100) + '%';
      z.style.width = (f.timing.width * 100) + '%';
    }
    if (f.sub) {
      $('sub-title').textContent = FD.subs[f.sub.name].label;
      $('sub-hint').textContent = `Mash ${key('time')} ${f.sub.att === me ? 'to finish it' : 'to escape'}`;
    }
    const pad = this.input.device === 'pad';
    let msg = '';
    if (f.over) msg = 'Fight over. Restart to go again, or use the back button above.';
    else if (f.timing) msg = `${f.timing.title} Press ${key('time')} when the needle is in the green.`;
    else if (f.sub) msg = `Mash ${key('time')} ${f.sub.att === me ? 'to finish it.' : 'to escape.'}`;
    else if (f.mode === 'stand') msg = `Strike, block with ${key('block')}${pad ? ' + stick' : ' + W/A/S/D'}, slip or duck with ${key('evade')}${pad ? '' : ' + W/A/S/D'}, clinch with ${key('clinch')} or shoot with ${key('shoot')}.`;
    else if (f.mode === 'clinch') msg = (f.top === me ? 'You have the tie: knees and elbows hit hardest, trips are easier. ' : 'They have the tie: pummel to take it, block their knees and elbows, or break away. ')
      + `Knee ${key('knee')}, elbow ${key('elbow')}, trip ${key('trip')}, break ${key('breakaway')}.`;
    else if (f.mode === 'ground' && f.top === me) msg = `On top in ${posLabel.toLowerCase()}. Punch, pass, ${f.canSubmit(me) ? subLabel.toLowerCase() + ', ' : ''}or stand up.`;
    else if (f.mode === 'ground') msg = `On the bottom in ${posLabel.toLowerCase()}. Block (${key('block')}) when they cock a punch, sweep, ${f.canSubmit(me) ? subLabel.toLowerCase() + ', ' : ''}or get up.`;
    $('prompt').textContent = msg;
  }

  // ---------- Built once (and again when the input device changes) ----------
  buildActions() {
    const row = $('actions');
    row.innerHTML = '';
    for (const a of ACTIONS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act'; b.dataset.ctx = a.ctx; b.dataset.cmd = a.cmd;
      const span = document.createElement('span'), kbd = document.createElement('kbd');
      span.textContent = a.text; kbd.textContent = this.input.key(a.key);
      b.append(span, ' ', kbd);
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.fight.command(a.cmd); });
      b.addEventListener('keydown', e => { if (e.key === 'Enter') this.fight.command(a.cmd); });
      row.appendChild(b);
    }
  }
  buildPads() {
    const blockpad = $('blockpad'), evadepad = $('evadepad');
    blockpad.innerHTML = ''; evadepad.innerHTML = '';
    for (const [zone, z] of Object.entries(SD.zones) as [Zone, typeof SD.zones[Zone]][]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'b-' + zone; b.dataset.zone = zone;
      b.textContent = `${z.arrow} ${z.label}`; b.title = 'Blocks ' + z.covers;
      b.addEventListener('pointerdown', e => { e.preventDefault(); this.fight.command('block:' + zone); });
      blockpad.appendChild(b);
    }
    for (const [kind, e] of Object.entries(SD.evades) as [EvadeKind, typeof SD.evades[EvadeKind]][]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'e-' + kind; b.dataset.kind = kind;
      b.textContent = `${e.arrow} ${e.label}`;
      b.title = 'Dodges ' + Object.values(SD.strikes).filter(s => s.evade?.[kind] === 0).map(s => s.label.toLowerCase()).join(', ');
      b.addEventListener('pointerdown', ev => { ev.preventDefault(); this.fight.command('evade:' + kind); });
      evadepad.appendChild(b);
    }
  }
  buildDefenseChart() {
    const group = (s: Strike, test: (m: number) => boolean) =>
      (Object.keys(s.evade || {}) as EvadeKind[]).filter(k => test(s.evade![k]!)).map(k => SD.evades[k].label.toLowerCase());
    let html = '<thead><tr><th>Strike</th><th>Block</th><th>Head movement</th></tr></thead><tbody>';
    for (const s of Object.values(SD.strikes)) {
      const z = SD.zones[s.zone];
      const parts = ([['Dodge', group(s, m => m === 0)], ['Half damage', group(s, m => m > 0 && m < 1)], ['Avoid', group(s, m => m > 1)]] as const).filter(([, l]) => l.length);
      const ev = parts.length ? parts.map(([w, l]) => `<b>${w}:</b> ${l.join(', ')}`).join('<br>') : 'Nothing dodges it. Check it.';
      html += `<tr><td>${s.label}</td><td>${z.arrow} ${z.label}</td><td>${ev}</td></tr>`;
    }
    $('defense').innerHTML = html + '</tbody>';
  }
  buildControlsTable() {
    const kb = this.input.device !== 'pad', L = LABELS[kb ? 'keyboard' : 'pad'];
    const rows: [string, string][] = [
      ['Jab / cross', `${L.jab} / ${L.cross}`], ['Lead hook / rear hook', `${L.lead_hook} / ${L.rear_hook}`], ['Uppercut', L.uppercut],
      ['Low / body / head kick', `${L.low_kick} / ${L.body_kick} / ${L.head_kick}`],
      ['Block', kb ? 'Space + W high, A left, D right, S check (Space alone: body)' : 'L1 + stick up high, left, right, down check (L1 alone: body)'],
      ['Head movement', kb ? 'F + W sway back, A slip left, D slip right, S duck (F alone: duck)' : 'Flick right stick: up sway back, left or right slip, down duck. Or R2 + left stick'],
      ['Move', kb ? '← / →' : 'Left stick or d-pad'], ['Shoot takedown', L.shoot], ['Clinch (close range)', L.clinch],
      ['In the clinch', kb ? 'L knee, J elbow, C pummel, G trip, R break away, Space block knee, W+Space block elbow'
        : '✕ knee, □ elbow, R1 pummel, L2 trip, R2 break away, L1 block knee, L1+up block elbow'],
      ['Timing bar / mash', L.time], ['Ground and pound (top)', L.punch], ['Pass (top) / sweep (bottom)', L.advance],
      ['Submission', L.submit], ['Stand up / get up', L.getup], ['Block on the ground', L.block]
    ];
    if (!kb) rows.push(['Restart', 'Options']);
    $('controls').innerHTML = `<thead><tr><th>Move</th><th>${kb ? 'Keyboard' : 'PS5 controller'}</th></tr></thead><tbody>`
      + rows.map(r => `<tr><td>${r[0]}</td><td><kbd>${r[1]}</kbd></td></tr>`).join('') + '</tbody>';
  }
}
