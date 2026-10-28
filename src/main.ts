// Boot: build the 3D stage, wire the fight to the HUD and input, run the menu and the frame loop.
import './styles.css';
import { SD } from './data';
import { Fight, type Color } from './fight/fight';
import type { Level } from './fight/rules';
import { Input, type Device } from './input/input';
import { loadProfile, recordFight, saveProfile, type Profile } from './profile/profile';
import { ParkController } from './park/controller';
import { PARK_FIGHTER_BY_ID } from './park/data';
import { repTitle } from './park/progress';
import { buildPark, PLACES } from './park/world';
import { V } from './rig/math';
import { loadFighterModel, ModelBody } from './rig/model';
import { createStage, PALETTES, type Fighter3D, type Stage } from './rig/stage';
import { StoryController } from './story/controller';
import { champion } from './story/progress';
import { TrainingController } from './training/controller';
import { GameCamera } from './ui/camera';
import { Hud } from './ui/hud';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let profile: Profile = loadProfile();
type Screen = 'menu' | 'fight' | 'training' | 'park' | 'pickup' | 'story' | 'bout';
let screen: Screen = 'menu';
/** The park fighter for the current or next pickup fight. */
let pickupId = '';

let stage: Stage;
try { stage = createStage($<HTMLCanvasElement>('stage')); }
catch (err) { $('status').textContent = 'This browser could not start WebGL, which the 3D view needs.'; throw err; }
const meshes = { red: stage.makeFighter(PALETTES.red), blue: stage.makeFighter(PALETTES.blue), ref: stage.makeFighter(PALETTES.ref) };
/** Every fighter that can wear the rigged model (the referee keeps the shapes: the test model has no referee outfit). */
const wearers: Fighter3D[] = [meshes.red, meshes.blue];

// ---------- Fighter look ----------
const MODEL_URL = 'models/fighter_test.glb';
let modelTemplate: Promise<import('three').Object3D> | null = null;
let modelReady: import('three').Object3D | null = null;
function applyLook(f: Fighter3D) {
  const tpl = profile.look === 'model' ? modelReady : null;
  f.setModel(tpl ? pal => new ModelBody(tpl, stage.toon, pal) : null);
}
/** Switch every fighter to the profile's look, loading the model file the first time it's needed. */
function setLook() {
  if (profile.look === 'model' && !modelReady) {
    modelTemplate ??= loadFighterModel(MODEL_URL);
    modelTemplate.then(t => { modelReady = t; wearers.forEach(applyLook); })
      .catch(err => { console.error('Could not load the fighter model', err); modelTemplate = null; document.getElementById('look-note')!.textContent = 'The test model could not be loaded. Using the classic shapes.'; });
    return;
  }
  wearers.forEach(applyLook);
}


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
const FIGHTING: Screen[] = ['fight', 'training', 'pickup', 'bout'];
input = new Input(fight, { active: () => FIGHTING.includes(screen), deviceChanged, restart });
hud = new Hud(fight, input, stage.camera);
const camera = new GameCamera(stage.camera, stage.panels);
const store = { get: () => profile, set: (p: Profile) => { profile = p; saveProfile(p); renderProfile(); } };
training = new TrainingController(fight, input, hud, store);
const makeNpc = () => { const f = stage.makeFighter(PALETTES.blue); wearers.push(f); applyLook(f); return f; };
const park = new ParkController(stage, buildPark(stage), meshes.red, meshes.blue, meshes.ref, makeNpc, camera, {
  ...store,
  device: () => input.device,
  startDrill(id) { training.drillId = id; training.returnTo = 'park'; location.hash = '#training'; },
  startPickup(id) {
    pickupId = id;
    if (screen === 'pickup') restart(); else location.hash = '#pickup';
  }
});
const story = new StoryController(meshes.blue, {
  ...store,
  startDrill(id) { training.drillId = id; training.returnTo = 'story'; location.hash = '#training'; },
  startBout() { location.hash = '#bout'; }
});
// A drill run from a story camp uses a camp session.
training.onDrillEnd = id => { if (training.returnTo === 'story') story.drillDone(id); };

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
  $<HTMLSelectElement>('p-look').value = profile.look;
  $<HTMLSelectElement>('level').value = profile.level;
  $<HTMLInputElement>('tells').checked = profile.tells;
  const r = profile.record;
  $('p-record').textContent = `${r.wins}-${r.losses}-${r.draws}`;
  $('p-cash').textContent = '$' + profile.park.cash.toLocaleString('en-US');
  $('p-rep').textContent = `Rep ${profile.park.rep} · ${repTitle(profile.park)}`;
  const st = profile.story;
  $('story-tag').textContent = champion(st) ? 'Champion' : st.next || st.history.length ? 'Continue' : 'Play';
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
$('p-look').addEventListener('change', e => {
  update({ look: (e.target as HTMLSelectElement).value === 'model' ? 'model' : 'shapes' });
  $('look-note').textContent = '';
  setLook();
});
$('tells').addEventListener('change', e => {
  update({ tells: (e.target as HTMLInputElement).checked });
  fight.tells = profile.tells;
  if (!fight.tells) hud.tell(null);
});
$('restart').addEventListener('click', restart);

function onEnded(winner: Color | null, how: string) {
  if (screen !== 'fight' && screen !== 'pickup' && screen !== 'bout') return;
  const result = winner === 'red' ? 'win' : winner ? 'loss' : 'draw';
  const opponent = screen === 'pickup' ? `${fight.blue.name} (park)` : screen === 'bout' ? `${fight.blue.name} (story)` : SD.styles[profile.opponentStyle].label;
  profile = recordFight(profile, result, how, opponent);
  saveProfile(profile);
  renderProfile();
  if (screen === 'pickup') park.endPickup(winner);
  if (screen === 'bout') story.endBout(winner, how);
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
  else if (screen === 'pickup') { hud.clearLog(); hud.clearBanner(); fight.tells = profile.tells; if (!park.startPickup(fight, pickupId)) location.hash = '#park'; }
  else if (screen === 'bout') {
    // The result is already on the record; a finished bout goes back to camp rather than straight into the next one.
    if (fight.over && !$('bout-result').hidden) { location.hash = '#story'; return; }
    hud.clearLog(); hud.clearBanner(); fight.tells = profile.tells;
    if (!story.startBout(fight)) { location.hash = '#story'; return; }
    const o = fight.blue;
    hud.banner(o.name, `${profile.name} vs ${o.name} \u00b7 ${$('screen-label').textContent}`, 1800);
  }
  else if (screen === 'fight') startFight();
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
const SCREENS: Record<string, Screen> = { '#fight': 'fight', '#training': 'training', '#park': 'park', '#pickup': 'pickup', '#story': 'story', '#bout': 'bout' };
const LABELS: Record<Screen, string> = {
  menu: '', story: '', fight: 'Fight night \u00b7 3 rounds', training: 'Training', park: 'The park', pickup: 'Pickup fight \u00b7 1 round', bout: ''
};
function route() {
  let next: Screen = SCREENS[location.hash] || 'menu';
  if (next === 'pickup' && !PARK_FIGHTER_BY_ID[pickupId]) { location.replace('#park'); next = 'park'; }
  if (next === 'bout' && screen !== 'story' && screen !== 'bout') { location.replace('#story'); next = 'story'; }
  if (next === screen && (next === 'menu' || next === 'story')) return;
  const prev = screen;
  if (next !== 'training' && next !== 'park' && next !== 'story') training.returnTo = null;
  const fightScreen = next !== 'menu' && next !== 'story';
  $('menu').hidden = next !== 'menu';
  $('story-screen').hidden = next !== 'story';
  $('fight-screen').hidden = !fightScreen;
  $('fight-screen').dataset.screen = next;
  $('training-panel').hidden = next !== 'training';
  const bout = next === 'bout' ? story.upcoming() : null;
  $('screen-label').textContent = bout ? `${bout.event} \u00b7 ${bout.rounds} rounds` : LABELS[next];
  $('restart').textContent = next === 'training' ? 'Restart drill' : next === 'pickup' || next === 'bout' ? 'Restart' : 'Restart fight';
  document.querySelector<HTMLLabelElement>('label[for="style-blue"]')!.textContent = next === 'training' ? 'Partner style' : 'CPU style';
  const backTo = next === 'pickup' || (next === 'training' && training.returnTo === 'park') ? 'park'
    : next === 'bout' || (next === 'training' && training.returnTo === 'story') ? 'story' : null;
  $<HTMLAnchorElement>('back').href = backTo ? '#' + backTo : '#';
  $('back').innerHTML = backTo === 'park' ? '&larr; Park' : backTo === 'story' ? '&larr; Camp' : '&larr; Menu';
  screen = next;
  if (prev === 'park') { park.leave(); camera.snap(V(70, 128, 820), V(0, 102, 0), 17.5); }
  if (prev === 'pickup') park.endPickupScreen();
  if (prev === 'bout') story.endBoutScreen();
  if (prev === 'story') story.leave();
  if (next !== 'training') training.stop();
  hud.tell(null);
  if (screen === 'menu') { renderProfile(); window.scrollTo(0, 0); return; }
  if (screen === 'story') { story.enter(); window.scrollTo(0, 0); return; }
  resize();
  if (screen === 'park') {
    hud.clearBanner();
    // Coming back from the gym or the court puts you outside its door.
    const from = prev === 'pickup' ? 'court' : prev === 'training' ? 'gym' : null;
    park.enter(from ? PLACES.find(p => p.id === from)!.x : undefined);
  } else if (screen === 'training') training.start();
  else if (screen === 'pickup' || screen === 'bout') restart();
  else startFight();
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
  if (screen === 'story') story.poll();
  if (screen === 'park') {
    park.frame(real, rdt);
    stage.renderer.render(stage.scene, stage.camera);
  } else if (FIGHTING.includes(screen)) {
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
    __clock?: (ms: number) => void;
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
window.__clock = ms => { fight.clock = ms; };

// ---------- Boot ----------
stage.readColors();
input.attach();
hud.buildActions();
hud.buildPads();
hud.buildDefenseChart();
hud.buildControlsTable();
renderProfile();
setLook();
training.build();
park.build();
park.dressPlayer();
story.build();
$('r-park').addEventListener('click', () => { location.hash = training.returnTo === 'story' ? '#story' : '#park'; });
$('status').hidden = true;
route();
requestAnimationFrame(frame);
