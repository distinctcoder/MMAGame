// Boot: build the 3D stage, wire the fight to the HUD and input, run the menu and the frame loop.
import './styles.css';
import { SD } from './data';
import { Fight, type Color } from './fight/fight';
import type { Level } from './fight/rules';
import { Input, type Device } from './input/input';
import { loadProfile, recordFight, saveProfile, type Profile } from './profile/profile';
import { createStage, PALETTES, type Stage } from './rig/stage';
import { TrainingController } from './training/controller';
import { GameCamera } from './ui/camera';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let profile: Profile = loadProfile();
let screen: 'menu' | 'fight' | 'training' = 'menu';

let stage: Stage;
try { stage = createStage($<HTMLCanvasElement>('stage')); }
catch (err) { $('status').textContent = 'This browser could not start WebGL, which the 3D view needs.'; throw err; }
const meshes = { red: stage.makeFighter(PALETTES.red), blue: stage.makeFighter(PALETTES.blue), ref: stage.makeFighter(PALETTES.ref) };

let hud: Hud;
let input: Input;
let training: TrainingController;
const fight = new Fight(meshes, {
  pop: (at, text, kind) => hud.pop(at, text, kind),
  banner: (text, sub, ms) => hud.banner(text, sub, ms),
  log: (text, detail) => hud.log(text, detail),
  tell: s => hud.tell(s),
  rumble: (strength, ms) => input.rumble(strength, ms),
  key: name => input.key(name),
  changed: () => hud.refresh(),
  ended: onEnded,
  event: e => { if (screen === 'training') training.onEvent(e); }
});
input = new Input(fight, { active: () => screen !== 'menu', deviceChanged, restart });
hud = new Hud(fight, input, stage.camera);
const camera = new GameCamera(stage.camera, stage.panels);
training = new TrainingController(fight, input, hud, { get: () => profile, set: p => { profile = p; saveProfile(p); renderProfile(); } });

// ---------- Profile and setup ----------
function fillStyles(sel: HTMLSelectElement, value: string) {
  sel.innerHTML = '';
  for (const [id, s] of Object.entries(SD.styles)) sel.add(new Option(s.label, id, false, id === value));
}
function renderProfile() {
  $<HTMLInputElement>('p-name').value = profile.name;
  fillStyles($('p-style'), profile.style);
  fillStyles($('p-opp'), profile.opponentStyle);
  fillStyles($('style-red'), profile.style);
  fillStyles($('style-blue'), profile.opponentStyle);
  $<HTMLSelectElement>('p-level').value = profile.level;
  $<HTMLSelectElement>('level').value = profile.level;
  $<HTMLInputElement>('tells').checked = profile.tells;
  const r = profile.record;
  $('p-record').textContent = `${r.wins}-${r.losses}-${r.draws}`;
  const list = $('p-history');
  list.innerHTML = '';
  for (const h of profile.history) {
    const li = document.createElement('li');
    const res = document.createElement('span');
    res.className = 'res ' + h.result; res.textContent = h.result === 'win' ? 'Win' : h.result === 'loss' ? 'Loss' : 'Draw';
    const text = document.createElement('span');
    text.textContent = `${h.how} vs ${h.opponent}`;
    const date = document.createElement('span');
    date.className = 'muted'; date.textContent = h.date;
    li.append(res, text, date);
    list.appendChild(li);
  }
  $('red-name').textContent = profile.name;
}
function update(change: Partial<Profile>) {
  profile = { ...profile, ...change };
  saveProfile(profile);
  renderProfile();
}
$<HTMLInputElement>('p-name').addEventListener('change', e => update({ name: (e.target as HTMLInputElement).value.trim() || 'Red' }));
for (const [id, key] of [['p-style', 'style'], ['style-red', 'style'], ['p-opp', 'opponentStyle'], ['style-blue', 'opponentStyle'], ['p-level', 'level'], ['level', 'level']] as const) {
  $(id).addEventListener('change', e => {
    update({ [key]: (e.target as HTMLSelectElement).value } as Partial<Profile>);
    if (screen !== 'menu') restart();
  });
}
$('tells').addEventListener('change', e => {
  update({ tells: (e.target as HTMLInputElement).checked });
  fight.tells = profile.tells;
  if (!fight.tells) hud.tell(null);
});
$('restart').addEventListener('click', restart);

function onEnded(winner: Color | null, how: string) {
  if (screen !== 'fight') return;
  const result = winner === 'red' ? 'win' : winner ? 'loss' : 'draw';
  profile = recordFight(profile, result, how, SD.styles[profile.opponentStyle].label);
  saveProfile(profile);
  renderProfile();
}

function deviceChanged(kind: Device, id?: string) {
  $('device').classList.toggle('on', kind === 'pad');
  $('device-text').textContent = kind === 'pad' ? `Controller connected${id && /dualsense|054c/i.test(id) ? ' (DualSense)' : ''}. Options restarts.`
    : kind === 'blocked' ? 'This view blocks controllers. Open the game in its own tab or run it locally to use one.'
    : 'Keyboard. Connect a PS5 controller and press any button.';
  hud.buildActions();
  hud.buildControlsTable();
  hud.refresh();
}

// ---------- Screens ----------
function restart() {
  if (screen === 'training') training.start();
  else startFight();
}
function startFight() {
  hud.clearLog();
  hud.clearBanner();
  fight.tells = profile.tells;
  fight.start({ redStyle: profile.style, blueStyle: profile.opponentStyle, level: profile.level as Level, redName: profile.name });
  $('red-style').textContent = SD.styles[profile.style].label;
  $('blue-style').textContent = SD.styles[profile.opponentStyle].label;
}
function resize() {
  const canvas = $<HTMLCanvasElement>('stage'), w = canvas.clientWidth || 800, h = Math.round(w * 9 / 16);
  stage.renderer.setSize(w, h, false);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
}
function route() {
  const next = location.hash === '#fight' ? 'fight' : location.hash === '#training' ? 'training' : 'menu';
  $('menu').hidden = next !== 'menu';
  $('fight-screen').hidden = next === 'menu';
  $('training-panel').hidden = next !== 'training';
  $('screen-label').textContent = next === 'training' ? 'Training' : 'Fight night \u00b7 3 rounds';
  $('restart').textContent = next === 'training' ? 'Restart drill' : 'Restart fight';
  document.querySelector<HTMLLabelElement>('label[for="style-blue"]')!.textContent = next === 'training' ? 'Partner style' : 'CPU style';
  if (next === screen && next === 'menu') return;
  screen = next;
  if (screen === 'menu') { hud.tell(null); training.stop(); renderProfile(); }
  else {
    resize();
    if (screen === 'training') training.start();
    else { training.stop(); startFight(); }
  }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
addEventListener('resize', resize);

// ---------- Frame loop ----------
let last = performance.now();
function frame(real: number) {
  const rdt = Math.min(50, real - last);
  last = real;
  input.poll();
  if (screen !== 'menu') {
    fight.update(real, rdt);
    fight.animate();
    camera.update(fight, rdt);
    hud.frame();
    if (screen === 'training') training.frame();
    stage.renderer.render(stage.scene, stage.camera);
  }
  requestAnimationFrame(frame);
}

// ---------- Debug hooks for automated browser tests ----------
declare global {
  interface Window {
    __fight?: () => unknown;
    __standPose?: (red: string, blue: string, dist: number, strike?: string) => void;
    __pairPose?: (name: string, top: Color, ov?: Record<string, string>, subU?: number) => void;
  }
}
window.__fight = () => ({
  tie: fight.mode === 'clinch' ? fight.top?.name : null, mode: fight.mode, pos: fight.pos, top: fight.top?.name, round: fight.round,
  over: fight.over, busy: fight.busy, timing: !!fight.timing, sub: !!fight.sub,
  red: { head: Math.round(fight.red.headHP), sta: Math.round(fight.red.sta), act: fight.red.action.type },
  blue: { head: Math.round(fight.blue.headHP), sta: Math.round(fight.blue.sta), act: fight.blue.action.type }
});
window.__standPose = (red, blue, dist, strike) => fight.debugStandPose(red, blue, dist, strike);
window.__pairPose = (name, top, ov, subU) => fight.debugPairPose(name, top, ov, subU);

// ---------- Boot ----------
stage.readColors();
input.attach();
hud.buildActions();
hud.buildPads();
hud.buildDefenseChart();
hud.buildControlsTable();
renderProfile();
training.build();
$('status').hidden = true;
route();
requestAnimationFrame(frame);
