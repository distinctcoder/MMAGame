// Boot: build the 3D stage, wire the fight to the HUD and input, run the menu and the frame loop.
import './styles.css';
import { Sound, type Ambience } from './audio/sound';
import { VoiceDirector } from './audio/voice';
import { makeNoise, playSfx, playUi, type Sfx, type UiSound } from './audio/synth';
import { SD } from './data';
import { Fight, type Color, type PopKind } from './fight/fight';
import type { Level } from './fight/rules';
import { Input, type Device } from './input/input';
import { PadNav } from './input/padnav';
import { Online } from './net/online';
import type { NetEvent } from './net/protocol';
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
const sound = new Sound(profile.audio);
const sfxCounts: Record<string, number> = {};
const voiceLog: string[] = [];
const voices = new VoiceDirector(id => { voiceLog.push(id); sound.voice(id); });
// Browsers only start audio after the player interacts.
for (const ev of ['pointerdown', 'keydown'] as const) addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });
type Screen = 'menu' | 'fight' | 'training' | 'park' | 'pickup' | 'story' | 'bout' | 'versus' | 'watch' | 'online';
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
let online: Online;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** Everything the fight shows also goes to a guest's page when hosting a room. */
const net: Online['record'] = body => online?.record(body);
const fight = new Fight(meshes, {
  pop: (at, text, kind) => { hud.pop(at, text, kind); net(['p', r1(at.x), r1(at.y), r1(at.z), text.slice(0, 40), kind]); },
  banner: (text, sub, ms) => { hud.banner(text, sub, ms); net(['n', text.slice(0, 60), sub?.slice(0, 120) ?? null, ms ?? null]); },
  log: (text, detail) => { hud.log(text, detail); net(['l', text.slice(0, 100), detail?.slice(0, 140) ?? null]); },
  tell: s => hud.tell(s),
  rumble: (strength, ms, to) => { input.rumble(strength, ms, to); net(['r', strength, ms, to ?? null]); },
  key: name => input.key(name),
  changed: () => hud.refresh(),
  ended: onEnded,
  event: e => { if (screen === 'training') training.onEvent(e); voices.event(e, performance.now()); },
  sfx: e => { sfxCounts[e.k] = (sfxCounts[e.k] || 0) + 1; sound.play(e); voices.cue(e, performance.now()); net(['s', e]); },
  impact: (at, power, kind) => { hud.burst(at, power, kind); net(['i', r1(at.x), r1(at.y), r1(at.z), r1(power), kind]); }
});
const FIGHTING: Screen[] = ['fight', 'training', 'pickup', 'bout', 'versus', 'watch', 'online'];
/**
 * Which side each device plays. One player: everything is red. Two players on one screen: the keyboard is red, and with
 * one controller it is blue; with two, the first is red and the second blue. CPU vs CPU: nobody. Online: your side.
 */
function seat(dev: 'keyboard' | number, pads: number): Color | null {
  if (screen === 'watch') return null;
  if (screen === 'online') return online.role === 'host' ? 'red' : online.playing ? 'blue' : null;
  if (screen === 'versus') return dev === 'keyboard' ? 'red' : pads >= 2 && dev === 0 ? 'red' : 'blue';
  return 'red';
}
input = new Input(fight, { active: () => FIGHTING.includes(screen), deviceChanged, restart, seat, back: () => { location.hash = $<HTMLAnchorElement>('back').getAttribute('href') || '#'; } });
hud = new Hud(fight, input, stage.camera);
const camera = new GameCamera(stage.camera, stage.panels);
const localSink = input.sink;
online = new Online(fight, {
  startFight(opp) {
    hud.clearLog(); hud.clearBanner(); input.resetHeld(); resetVoices();
    fight.tells = false;
    fight.start({
      redStyle: profile.style, blueStyle: opp?.style ?? profile.opponentStyle, level: 'normal', redName: profile.name,
      blueName: opp?.name ?? 'Waiting…', control: { red: 'human', blue: 'human' }, config: opp ? {} : { noClock: true }
    });
    if (opp) hud.banner(opp.name + ' joined', `${profile.name} vs ${opp.name}`, 1800);
    setOnlineLabel();
  },
  status(text, sub) { if (text) hud.banner(text, sub, 0); else hud.clearBanner(); setOnlineLabel(); },
  play: playNet,
  changed() {
    hud.me = online.playing ? 'blue' : 'red';
    hud.note = online.role === 'guest' && !online.playing ? 'Watching. The host is fighting someone else.' : null;
    setOnlineLabel();
    hud.refresh();
  },
  me: () => ({ name: profile.name, style: profile.style })
});
function setOnlineLabel() {
  if (screen !== 'online') return;
  const side = online.role === 'host' ? 'you are red' : online.playing ? 'you are blue' : 'watching';
  $('screen-label').textContent = `Online \u00b7 room ${online.code} \u00b7 ${side}`;
}
/** On a guest's page: replay one of the host's events. The host's text is shown as text, never as markup. */
function playNet(e: NetEvent) {
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  try {
    switch (e[1]) {
      case 'p': hud.pop(V(num(e[2]), num(e[3]), num(e[4])), str(e[5]), (['hit', 'block', 'miss', 'gold'].includes(e[6]) ? e[6] : 'hit') as PopKind); break;
      case 'n': hud.banner(str(e[2]), e[3] ? str(e[3]) : null, e[4] == null ? undefined : num(e[4])); break;
      case 'l': hud.log(str(e[2]), e[3] ? str(e[3]) : undefined); break;
      case 's': if (e[2] && typeof e[2].k === 'string') { sound.play(e[2]); voices.cue(e[2], performance.now()); } break;
      case 'i': hud.burst(V(num(e[2]), num(e[3]), num(e[4])), Math.min(1, num(e[5])), e[6] === 'parry' ? 'parry' : e[6] === 'block' ? 'block' : 'hit'); break;
      case 'r': if (online.playing) input.rumble(Math.min(1, num(e[2])), Math.min(1000, num(e[3])), e[4] === 'red' || e[4] === 'blue' ? e[4] : undefined); break;
      case 'k': fight.kick = { dir: V(num(e[2]), num(e[3]), num(e[4])), amp: Math.min(12, num(e[5])), t0: performance.now() }; break;
      case 'h': fight.shake = Math.max(fight.shake, Math.min(12, num(e[2]))); break;
    }
  } catch { /* a malformed event is skipped */ }
}
async function goOnline(how: 'host' | 'join') {
  const status = $('online-status'), code = $<HTMLInputElement>('online-code').value.trim().toUpperCase();
  if (how === 'join' && !/^[A-Z0-9]{4,6}$/.test(code)) { status.textContent = 'Enter the 4-letter code your friend sees.'; return; }
  status.textContent = 'Connecting…';
  const ok = how === 'host' ? await online.host() : await online.join(code);
  if (!ok) {
    status.textContent = 'Online play needs the game open on claude.ai, where rooms are available. Open the shared game there, or play two players on one screen.';
    return;
  }
  status.textContent = '';
  location.hash = '#online';
}
$('online-host').addEventListener('click', () => void goOnline('host'));
$('online-join').addEventListener('click', () => void goOnline('join'));
$('online-code').addEventListener('keydown', e => { if (e.key === 'Enter') void goOnline('join'); });
const store = { get: () => profile, set: (p: Profile) => { profile = p; saveProfile(p); renderProfile(); } };
training = new TrainingController(fight, input, hud, store);
training.ui = (k, step) => sound.ui(k, step);
const makeNpc = () => { const f = stage.makeFighter(PALETTES.blue); wearers.push(f); applyLook(f); return f; };
const park = new ParkController(stage, buildPark(stage), meshes.red, meshes.blue, meshes.ref, makeNpc, camera, {
  ...store,
  device: () => input.device,
  ui: k => sound.ui(k),
  startDrill(id) { training.drillId = id; training.returnTo = 'park'; location.hash = '#training'; },
  startPickup(id) {
    pickupId = id;
    if (screen === 'pickup') restart(); else location.hash = '#pickup';
  }
});
const story = new StoryController(meshes.blue, {
  ...store,
  startDrill(id) { training.drillId = id; training.returnTo = 'story'; location.hash = '#training'; },
  startBout() { location.hash = '#bout'; },
  ui: k => sound.ui(k)
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
  $<HTMLInputElement>('p-volume').value = String(Math.round(profile.audio.volume * 100));
  $<HTMLInputElement>('p-mute').checked = profile.audio.muted;
  $<HTMLInputElement>('p-voices').checked = profile.audio.voices;
  const toggle = $('sound-toggle');
  toggle.textContent = profile.audio.muted ? 'Sound off' : 'Sound on';
  toggle.setAttribute('aria-pressed', String(profile.audio.muted));
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
// ---------- Sound settings ----------
function setAudio(change: Partial<Profile['audio']>) {
  update({ audio: { ...profile.audio, ...change } });
  sound.set(profile.audio);
}
$('p-volume').addEventListener('input', e => setAudio({ volume: Number((e.target as HTMLInputElement).value) / 100, muted: false }));
$('p-volume').addEventListener('change', () => sound.ui('point'));
$('p-mute').addEventListener('change', e => setAudio({ muted: (e.target as HTMLInputElement).checked }));
$('p-voices').addEventListener('change', e => setAudio({ voices: (e.target as HTMLInputElement).checked }));
$('sound-toggle').addEventListener('click', () => setAudio({ muted: !profile.audio.muted }));
addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'm' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  if ((e.target as HTMLElement | null)?.closest('input, select, textarea')) return;
  setAudio({ muted: !profile.audio.muted });
});

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
  if (screen === 'bout') {
    const titleWin = winner === 'red' && !!story.upcoming()?.title;
    story.endBout(winner, how);
    if (titleWin) sound.voice('ann_champ');
  }
}

function deviceChanged(kind: Device, id?: string) {
  $('device').classList.toggle('on', kind === 'pad');
  $('device-text').textContent = kind === 'pad' ? `Controller connected${id && /dualsense|054c/i.test(id) ? ' (DualSense)' : ''}. Options restarts, Create goes back.`
    : kind === 'blocked' ? 'This view blocks controllers. Open the game in its own tab or run it locally to use one.'
    : 'Keyboard. Connect a PS5 controller and press any button. In menus, the D-pad moves and ✕ selects.';
  hud.buildActions();
  hud.buildControlsTable();
  hud.refresh();
}

// ---------- Screens ----------
function restart() {
  resetVoices();
  if (screen === 'training') training.start();
  else if (screen === 'pickup') { hud.clearLog(); hud.clearBanner(); fight.tells = profile.tells; if (!park.startPickup(fight, pickupId)) location.hash = '#park'; }
  else if (screen === 'bout') {
    // The result is already on the record; a finished bout goes back to camp rather than straight into the next one.
    if (fight.over && !$('bout-result').hidden) { location.hash = '#story'; return; }
    hud.clearLog(); hud.clearBanner(); fight.tells = profile.tells;
    sound.voice('ann_intro');
    if (!story.startBout(fight)) { location.hash = '#story'; return; }
    const o = fight.blue;
    hud.banner(o.name, `${profile.name} vs ${o.name} \u00b7 ${$('screen-label').textContent}`, 1800);
  }
  else if (screen === 'fight') startFight();
  else if (screen === 'versus' || screen === 'watch') startFight();
  else if (screen === 'online') online.rematch();
}
/** A new fight: the corner forgets the last one. It only talks in real fights, not in drills. */
function resetVoices() {
  voices.reset(performance.now());
  voices.corner = screen === 'fight' || screen === 'pickup' || screen === 'bout';
}
function startFight() {
  hud.clearLog();
  hud.clearBanner();
  input.resetHeld();
  fight.tells = profile.tells;
  const red = SD.styles[profile.style].label, blue = SD.styles[profile.opponentStyle].label;
  if (screen === 'watch') fight.start({ redStyle: profile.style, blueStyle: profile.opponentStyle, level: profile.level as Level, redName: 'Red ' + red, blueName: 'Blue ' + blue, control: { red: 'cpu', blue: 'cpu' } });
  else if (screen === 'versus') {
    fight.start({ redStyle: profile.style, blueStyle: profile.opponentStyle, level: 'normal', redName: profile.name, blueName: 'Player 2', control: { red: 'human', blue: 'human' } });
    hud.banner('Two players', input.padCount ? (input.padCount >= 2 ? 'Controller 1 is red, controller 2 is blue' : 'Keyboard is red, the controller is blue') : 'Player 2: connect a controller and press any button', 2600);
  }
  else fight.start({ redStyle: profile.style, blueStyle: profile.opponentStyle, level: profile.level as Level, redName: profile.name });
  $('red-style').textContent = SD.styles[profile.style].label;
  $('blue-style').textContent = SD.styles[profile.opponentStyle].label;
}
function resize() {
  const canvas = $<HTMLCanvasElement>('stage'), w = canvas.clientWidth || 800, h = Math.round(w * 9 / 16);
  stage.renderer.setSize(w, h, false);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
}
const SCREENS: Record<string, Screen> = { '#versus': 'versus', '#watch': 'watch', '#online': 'online', '#fight': 'fight', '#training': 'training', '#park': 'park', '#pickup': 'pickup', '#story': 'story', '#bout': 'bout' };
const LABELS: Record<Screen, string> = {
  menu: '', story: '', fight: 'Fight night \u00b7 3 rounds', versus: 'Two players \u00b7 3 rounds', watch: 'CPU vs CPU \u00b7 3 rounds', online: 'Online', training: 'Training', park: 'The park', pickup: 'Pickup fight \u00b7 1 round', bout: ''
};
function route() {
  let next: Screen = SCREENS[location.hash] || 'menu';
  if (next === 'pickup' && !PARK_FIGHTER_BY_ID[pickupId]) { location.replace('#park'); next = 'park'; }
  if (next === 'bout' && screen !== 'story' && screen !== 'bout') { location.replace('#story'); next = 'story'; }
  if (next === 'online' && !online.active) { location.replace('#'); next = 'menu'; }
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
  // Leaving an online fight leaves the room; every other screen plays as red on this page.
  if (prev === 'online' && next !== 'online') online.leave();
  input.sink = next === 'online' && online.role === 'guest' ? cmd => online.send(cmd) : localSink;
  hud.me = 'red'; hud.note = next === 'watch' ? 'CPU vs CPU. Restart for a rematch; change the styles below.' : null;
  $('restart').hidden = next === 'online' && online.role === 'guest';
  $('actions').hidden = next === 'watch';
  const AMBIENCE: Record<Screen, Ambience> = { versus: 'arena', watch: 'arena', online: 'arena', menu: null, story: null, fight: 'arena', pickup: 'arena', bout: 'arena', training: 'gym', park: 'street' };
  sound.setAmbience(AMBIENCE[next]);
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
  } else if (screen === 'training') { resetVoices(); training.start(); }
  else if (screen === 'pickup' || screen === 'bout') restart();
  else if (screen === 'online') {
    if (online.role === 'guest') {
      // The guest never runs the fight; a fresh one just gives the bodies a pose until the host's arrive.
      hud.clearLog(); voices.reset(performance.now()); voices.corner = false;
      fight.start({ redStyle: profile.opponentStyle, blueStyle: profile.style, level: 'normal', redName: 'Host', blueName: profile.name, control: { red: 'human', blue: 'human' }, config: { noClock: true } });
      fight.animate();
    }
    online.begin();
    setOnlineLabel();
  }
  else { resetVoices(); startFight(); }
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);
addEventListener('resize', resize);

// The main menu with a controller; ○ there does nothing (it's the top).
const menuNav = new PadNav(() => (screen === 'menu' ? $('menu') : null), () => {});

// ---------- Frame loop ----------
let last = performance.now();
function frame(real: number) {
  const rdt = Math.min(50, real - last);
  last = real;
  input.poll();
  menuNav.poll(real);
  sound.frame(rdt);
  if (FIGHTING.includes(screen)) voices.frame({ mode: fight.mode, over: fight.over, bottom: fight.mode === 'ground' ? fight.bot?.color ?? null : null }, performance.now());
  if (screen === 'story') story.poll();
  if (screen === 'park') {
    park.frame(real, rdt);
    stage.renderer.render(stage.scene, stage.camera);
  } else if (screen === 'online' && online.role === 'guest') {
    online.guestFrame(real, rdt);
    camera.update(fight, rdt);
    hud.frame();
    stage.renderer.render(stage.scene, stage.camera);
  } else if (FIGHTING.includes(screen)) {
    fight.update(real, rdt);
    fight.animate();
    if (screen === 'online') online.hostFrame(real);
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
    __sfx?: () => Record<string, number | string>;
    __renderSfx?: () => Promise<Record<string, { peak: number; rms: number; ms: number; low: number }>>;
  }
}
window.__fight = () => ({
  tie: fight.mode === 'clinch' ? fight.top?.name : null, mode: fight.mode, pos: fight.pos, top: fight.top?.name, round: fight.round,
  over: fight.over, busy: fight.busy, timing: !!fight.timing, sub: !!fight.sub,
  red: { head: Math.round(fight.red.headHP), sta: Math.round(fight.red.sta), act: fight.red.action.type, x: Math.round(fight.red.x), z: Math.round(fight.red.z), yaw: Math.round(fight.red.yaw), err: Math.round(fight.facingError(fight.red)) },
  bluePos: { x: Math.round(fight.blue.x), z: Math.round(fight.blue.z), yaw: Math.round(fight.blue.yaw), err: Math.round(fight.facingError(fight.blue)) },
  blue: { head: Math.round(fight.blue.headHP), sta: Math.round(fight.blue.sta), act: fight.blue.action.type }
});
window.__standPose = (red, blue, dist, strike) => fight.debugStandPose(red, blue, dist, strike);
window.__pairPose = (name, top, ov, subU) => fight.debugPairPose(name, top, ov, subU);
window.__clock = ms => { fight.clock = ms; };
window.__sfx = () => ({ ...sfxCounts, state: sound.state, muted: String(profile.audio.muted), voicesLoaded: sound.voicesLoaded, said: voiceLog.join(',') });
// Render every sound offline and measure it: loudness, how long it rings, and how much of it is bass (below 250 Hz).
window.__renderSfx = async () => {
  const cues: [string, Sfx | UiSound][] = [
    ['swing punch', { k: 'swing', kick: false }], ['swing kick', { k: 'swing', kick: true }], ['whiff', { k: 'whiff' }],
    ['hit head', { k: 'hit', part: 'head', dmg: 10 }], ['hit body', { k: 'hit', part: 'body', dmg: 10 }], ['hit legs', { k: 'hit', part: 'legs', dmg: 10 }],
    ['hit head weak', { k: 'hit', part: 'head', dmg: 3 }], ['block', { k: 'block' }], ['parry', { k: 'parry' }], ['check', { k: 'check' }],
    ['slam', { k: 'slam', heavy: true }], ['knockdown', { k: 'knockdown' }], ['sprawl', { k: 'sprawl' }], ['escape', { k: 'escape' }],
    ['tap', { k: 'tap' }], ['bell', { k: 'bell' }], ['end', { k: 'end' }], ['finish', { k: 'finish', how: 'KO' }],
    ['timing perfect', { k: 'timing', q: 1 }], ['timing miss', { k: 'timing', q: 0 }],
    ['ui point', 'point'], ['ui combo', 'combo'], ['ui cash', 'cash'], ['ui level', 'level'], ['ui click', 'click'], ['ui miss', 'miss']
  ];
  const out: Record<string, { peak: number; rms: number; ms: number; low: number }> = {};
  for (const [name, cue] of cues) {
    const render = async (lowpass: boolean) => {
      const ac = new OfflineAudioContext(1, 44100 * 3, 44100);
      let dest: AudioNode = ac.destination;
      if (lowpass) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 250; f.connect(ac.destination); dest = f; }
      if (typeof cue === 'string') playUi(ac, dest, cue, 0, 0); else playSfx(ac, dest, makeNoise(ac), cue, 0);
      return (await ac.startRendering()).getChannelData(0);
    };
    const d = await render(false), lo = await render(true);
    let peak = 0, sum = 0, sumLo = 0, last = 0;
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; sum += d[i] * d[i]; sumLo += lo[i] * lo[i]; if (a > 0.01) last = i; }
    out[name] = { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4), ms: Math.round(last / 44.1), low: +(sumLo / (sum || 1)).toFixed(2) };
  }
  return out;
};

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
