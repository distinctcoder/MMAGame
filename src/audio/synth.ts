// Sound effects synthesized with Web Audio: no sample files. Each function schedules one sound on any
// AudioContext (live or offline) at time t, into `out`. Power scales loudness and weight.
import type { BodyPart } from '../data/types';

export type Sfx =
  | { k: 'swing'; kick: boolean }
  | { k: 'hit'; part: BodyPart; dmg: number }
  | { k: 'block' | 'parry' | 'check' | 'whiff' | 'sprawl' | 'escape' | 'knockdown' | 'bell' | 'tap' | 'end' }
  | { k: 'slam'; heavy?: boolean }
  | { k: 'finish'; how: string }
  | { k: 'timing'; q: number }
  // Calls for the referee and announcer; they make no synthesized sound.
  | { k: 'round'; n: number; last: boolean }
  | { k: 'ref'; line: 'break' | 'standup' }
  | { k: 'ten' }
  | { k: 'decision'; draw: boolean };

export type UiSound = 'click' | 'cash' | 'level' | 'point' | 'combo' | 'miss';

type Ctx = BaseAudioContext;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function makeNoise(ac: Ctx): AudioBuffer {
  const len = Math.floor(ac.sampleRate * 2), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** A gain node with an attack-decay envelope starting at t. */
function env(ac: Ctx, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}
/** A burst of noise through a filter. */
function noise(ac: Ctx, out: AudioNode, buf: AudioBuffer, t: number, o: { type: BiquadFilterType; f: number; q?: number; f2?: number; peak: number; attack?: number; decay: number }) {
  const src = ac.createBufferSource();
  src.buffer = buf;
  const filt = ac.createBiquadFilter();
  filt.type = o.type; filt.Q.value = o.q ?? 0.8;
  filt.frequency.setValueAtTime(o.f, t);
  if (o.f2) filt.frequency.exponentialRampToValueAtTime(o.f2, t + (o.attack ?? 0.002) + o.decay);
  src.connect(filt).connect(env(ac, out, t, o.peak, o.attack ?? 0.002, o.decay));
  src.start(t, Math.random() * 1.5, (o.attack ?? 0.002) + o.decay + 0.05);
}
/** A tone whose pitch can sweep, e.g. the low thump under a punch. */
function tone(ac: Ctx, out: AudioNode, t: number, o: { type?: OscillatorType; f: number; f2?: number; peak: number; attack?: number; decay: number }) {
  const osc = ac.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.attack ?? 0.002) + o.decay);
  osc.connect(env(ac, out, t, o.peak, o.attack ?? 0.002, o.decay));
  osc.start(t);
  osc.stop(t + (o.attack ?? 0.002) + o.decay + 0.05);
}
/** A struck bell: inharmonic partials with long decays. */
function bell(ac: Ctx, out: AudioNode, t: number, peak = 0.35, f = 740) {
  [[1, 1, 2.2], [2.76, 0.5, 1.4], [5.4, 0.28, 0.8], [8.93, 0.14, 0.45]].forEach(([m, a, d]) => tone(ac, out, t, { f: f * m, peak: peak * a, attack: 0.003, decay: d }));
}
const vary = (v: number, by = 0.08) => v * (1 + (Math.random() * 2 - 1) * by);

/** Schedule a fight sound. Returns how exciting it was for the crowd (0 to 1). */
export function playSfx(ac: Ctx, out: AudioNode, buf: AudioBuffer, e: Sfx, t = ac.currentTime): number {
  switch (e.k) {
    case 'swing':
    case 'whiff': {
      const kick = e.k === 'swing' && e.kick;
      noise(ac, out, buf, t, { type: 'bandpass', f: vary(kick ? 260 : 420), f2: vary(kick ? 900 : 1700), q: 1.4, peak: kick ? 0.9 : 0.7, attack: kick ? 0.07 : 0.04, decay: kick ? 0.16 : 0.09 });
      return 0;
    }
    case 'hit': {
      const p = clamp(e.dmg / 12, 0.35, 1.25);
      // Heavy shots get a sub-bass thud underneath, felt more than heard.
      if (e.dmg >= 8) tone(ac, out, t, { f: 70, f2: 34, peak: 0.5 * clamp((e.dmg - 6) / 10, 0.2, 1), attack: 0.004, decay: 0.32 });
      if (e.part === 'head') {
        tone(ac, out, t, { f: vary(150), f2: 55, peak: 0.75 * p, decay: 0.16 });
        noise(ac, out, buf, t, { type: 'bandpass', f: vary(1900), q: 0.9, peak: 0.85 * p, decay: 0.06 });
        noise(ac, out, buf, t, { type: 'highpass', f: 3500, peak: 0.3 * p, decay: 0.03 });
      } else if (e.part === 'body') {
        tone(ac, out, t, { f: vary(110), f2: 42, peak: 0.85 * p, decay: 0.24 });
        noise(ac, out, buf, t, { type: 'bandpass', f: vary(850), q: 0.8, peak: 0.6 * p, decay: 0.09 });
      } else {
        tone(ac, out, t, { f: vary(180), f2: 80, peak: 0.55 * p, decay: 0.12 });
        noise(ac, out, buf, t, { type: 'bandpass', f: vary(2600), q: 1.1, peak: 0.6 * p, decay: 0.05 });
      }
      return clamp(e.dmg / 25, 0, 0.6);
    }
    case 'block':
      tone(ac, out, t, { f: vary(95), f2: 60, peak: 0.35, decay: 0.08 });
      noise(ac, out, buf, t, { type: 'lowpass', f: vary(650), peak: 0.35, decay: 0.08 });
      return 0;
    case 'parry':
      tone(ac, out, t, { f: vary(95), f2: 60, peak: 0.3, decay: 0.07 });
      noise(ac, out, buf, t, { type: 'lowpass', f: 700, peak: 0.3, decay: 0.07 });
      tone(ac, out, t + 0.01, { type: 'triangle', f: 1760, peak: 0.18, decay: 0.07 });
      return 0.15;
    case 'check':
      tone(ac, out, t, { f: vary(220), f2: 90, peak: 0.5, decay: 0.09 });
      noise(ac, out, buf, t, { type: 'bandpass', f: vary(1300), q: 2, peak: 0.5, decay: 0.05 });
      tone(ac, out, t + 0.035, { f: 160, f2: 70, peak: 0.3, decay: 0.08 });
      return 0.1;
    case 'slam':
    case 'knockdown': {
      const heavy = e.k === 'knockdown' || (e.k === 'slam' && !!e.heavy);
      tone(ac, out, t, { f: vary(95), f2: 32, peak: heavy ? 0.85 : 0.75, decay: heavy ? 0.5 : 0.38 });
      noise(ac, out, buf, t, { type: 'lowpass', f: 450, peak: 0.6, decay: 0.3 });
      noise(ac, out, buf, t + 0.02, { type: 'bandpass', f: 1500, q: 0.7, peak: 0.25, decay: 0.12 });
      return heavy ? 1 : 0.55;
    }
    case 'sprawl':
      tone(ac, out, t, { f: 120, f2: 50, peak: 0.55, decay: 0.2 });
      noise(ac, out, buf, t, { type: 'bandpass', f: 600, f2: 300, q: 0.6, peak: 0.35, attack: 0.02, decay: 0.25 });
      return 0.35;
    case 'escape':
      noise(ac, out, buf, t, { type: 'bandpass', f: 300, f2: 1200, q: 1.2, peak: 0.7, attack: 0.05, decay: 0.2 });
      return 0.6;
    case 'tap':
      for (let i = 0; i < 3; i++) noise(ac, out, buf, t + i * 0.18, { type: 'bandpass', f: vary(1500), q: 1.2, peak: 0.5, decay: 0.05 });
      return 1;
    case 'bell':
      bell(ac, out, t);
      return 0.2;
    case 'end':
      for (let i = 0; i < 3; i++) bell(ac, out, t + i * 0.32, 0.3);
      return 0.8;
    case 'finish':
      for (let i = 0; i < 3; i++) bell(ac, out, t + 0.5 + i * 0.32, 0.3);
      return 1;
    case 'timing':
      if (e.q > 0.9) { tone(ac, out, t, { type: 'triangle', f: 880, peak: 0.2, decay: 0.08 }); tone(ac, out, t + 0.07, { type: 'triangle', f: 1320, peak: 0.22, decay: 0.12 }); }
      else if (e.q > 0.6) tone(ac, out, t, { type: 'triangle', f: 880, peak: 0.2, decay: 0.1 });
      else tone(ac, out, t, { type: 'square', f: 196, f2: 150, peak: 0.08, decay: 0.14 });
      return 0;
    case 'round': case 'ref': case 'ten': case 'decision':
      return 0;
  }
}

/** Menu, shop and score sounds. `step` raises the pitch, e.g. for a training streak. */
export function playUi(ac: Ctx, out: AudioNode, kind: UiSound, step = 0, t = ac.currentTime) {
  const up = Math.pow(2, Math.min(step, 12) / 12);
  if (kind === 'click') tone(ac, out, t, { type: 'triangle', f: 1200, peak: 0.08, decay: 0.03 });
  else if (kind === 'point') tone(ac, out, t, { type: 'triangle', f: 660 * up, peak: 0.14, decay: 0.12 });
  else if (kind === 'combo') [0, 4, 7].forEach((s, i) => tone(ac, out, t + i * 0.06, { type: 'triangle', f: 660 * up * Math.pow(2, s / 12), peak: 0.14, decay: 0.12 }));
  else if (kind === 'miss') tone(ac, out, t, { type: 'square', f: 185, f2: 140, peak: 0.06, decay: 0.15 });
  else if (kind === 'cash') { tone(ac, out, t, { type: 'triangle', f: 1568, peak: 0.16, decay: 0.08 }); tone(ac, out, t + 0.08, { type: 'triangle', f: 2093, peak: 0.18, decay: 0.25 }); }
  else if (kind === 'level') [0, 4, 7, 12].forEach((s, i) => tone(ac, out, t + i * 0.08, { type: 'triangle', f: 523 * Math.pow(2, s / 12), peak: 0.16, decay: i === 3 ? 0.4 : 0.12 }));
}
