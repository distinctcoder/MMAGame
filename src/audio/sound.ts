// The game's audio: one AudioContext, a master volume, effects, and a looping ambience (arena crowd, gym or street)
// that swells when something exciting happens. Browsers only allow sound after the player interacts, so the
// context starts on the first click or key press.
import { makeNoise, playSfx, playUi, type Sfx, type UiSound } from './synth';
import { trimBounds, VOICE } from './voice';

export type Ambience = 'arena' | 'gym' | 'street' | null;
export interface SoundSettings { volume: number; muted: boolean; voices: boolean }

/** Queued lines older than this are dropped: a late "Fight!" is worse than none. */
const STALE_MS = 4000;

const AMBIENCE: Record<Exclude<Ambience, null>, { f: number; q: number; base: number; swell: number }> = {
  arena: { f: 650, q: 0.45, base: 0.07, swell: 0.32 },  // crowd murmur that roars
  gym: { f: 900, q: 0.6, base: 0.025, swell: 0.08 },    // a few people and the odd shout
  street: { f: 220, q: 0.5, base: 0.05, swell: 0 }      // traffic rumble
};

export class Sound {
  private ac: AudioContext | null = null;
  private master!: GainNode;
  private fx!: GainNode;
  private bed!: { gain: GainNode; filter: BiquadFilterNode; depth: GainNode };
  private noise!: AudioBuffer;
  private amb: Ambience = null;
  private excitement = 0;
  private duck!: GainNode;
  private voiceBus!: GainNode;
  private clips = new Map<string, AudioBuffer>();
  private queue: { id: string; at: number }[] = [];
  private speakingUntil = 0;
  private voiceBase = 'voice/';

  constructor(private settings: SoundSettings) {}

  /** Start audio on the first user gesture. Safe to call many times. */
  unlock() {
    if (this.ac) { if (this.ac.state === 'suspended' && !document.hidden) void this.ac.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ac = this.ac = new AC();
    this.noise = makeNoise(ac);
    this.master = ac.createGain();
    // A gentle limiter so stacked hits never clip.
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 8; comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(comp).connect(ac.destination);
    this.fx = ac.createGain();
    this.fx.connect(this.master);
    this.voiceBus = ac.createGain();
    this.voiceBus.gain.value = 1.15;
    this.voiceBus.connect(this.master);
    this.buildBed();
    this.applyVolume();
    void this.loadVoices();
    this.setAmbience(this.amb, true);
    document.addEventListener('visibilitychange', () => { if (document.hidden) void ac.suspend(); else void ac.resume(); });
  }

  private buildBed() {
    const ac = this.ac!;
    const src = ac.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    const gain = ac.createGain();
    gain.gain.value = 0;
    // A slow wobble so the crowd breathes instead of hissing.
    const lfo = ac.createOscillator(), depth = ac.createGain();
    lfo.frequency.value = 0.23; depth.gain.value = 0;
    lfo.connect(depth).connect(gain.gain);
    // The crowd ducks under the voices so the calls stay clear.
    this.duck = ac.createGain();
    src.connect(filter).connect(gain).connect(this.duck).connect(this.master);
    src.start(); lfo.start();
    this.bed = { gain, filter, depth };
  }

  /** 'off' until the first click or key press, then the audio context's state. */
  get state(): string { return this.ac?.state ?? 'off'; }
  set(s: Partial<SoundSettings>) { this.settings = { ...this.settings, ...s }; this.applyVolume(); }
  private applyVolume() {
    if (!this.ac) return;
    const v = this.settings.muted ? 0 : this.settings.volume;
    this.master.gain.setTargetAtTime(v * v, this.ac.currentTime, 0.03);
  }

  setAmbience(a: Ambience, force = false) {
    if (a === this.amb && !force) return;
    this.amb = a;
    if (!this.ac) return;
    const t = this.ac.currentTime, conf = a ? AMBIENCE[a] : null;
    this.bed.filter.frequency.setTargetAtTime(conf?.f ?? 600, t, 0.2);
    this.bed.filter.Q.value = conf?.q ?? 0.5;
    this.bed.gain.gain.setTargetAtTime(conf?.base ?? 0, t, 0.4);
    this.bed.depth.gain.setTargetAtTime((conf?.base ?? 0) * 0.35, t, 0.4);
  }

  play(e: Sfx) {
    if (!this.ac || this.settings.muted) return;
    const thrill = playSfx(this.ac, this.fx, this.noise, e);
    if (thrill > 0) this.cheer(thrill);
  }
  ui(kind: UiSound, step = 0) {
    if (!this.ac || this.settings.muted) return;
    playUi(this.ac, this.fx, kind, step);
  }

  /** Fetch and decode every voice clip, trimming the silent padding. Missing clips are skipped. */
  private async loadVoices() {
    const ac = this.ac!;
    await Promise.all(Object.entries(VOICE).map(async ([id, line]) => {
      try {
        const res = await fetch(this.voiceBase + line.file + '.mp3');
        if (!res.ok) return;
        const buf = await ac.decodeAudioData(await res.arrayBuffer());
        const data = buf.getChannelData(0), [a, b] = trimBounds(data, buf.sampleRate);
        if (b <= a) return;
        const out = ac.createBuffer(buf.numberOfChannels, b - a, buf.sampleRate);
        for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c);
        this.clips.set(id, out);
      } catch { /* a missing or broken clip just stays silent */ }
    }));
  }

  /** Queue a voice line; lines play one at a time, in order. */
  voice(id: string) {
    if (!this.ac || this.settings.muted || !this.settings.voices) return;
    this.queue.push({ id, at: performance.now() });
  }
  /** Which clips are loaded (for checks and debugging). */
  get voicesLoaded(): number { return this.clips.size; }

  private pumpVoices() {
    const ac = this.ac!, now = performance.now();
    if (now < this.speakingUntil) return;
    while (this.queue.length) {
      const next = this.queue.shift()!;
      const clip = this.clips.get(next.id);
      if (!clip || now - next.at > STALE_MS) continue;
      const src = ac.createBufferSource();
      src.buffer = clip;
      src.connect(this.voiceBus);
      src.start();
      this.speakingUntil = now + clip.duration * 1000 + 120;
      this.duck.gain.setTargetAtTime(0.45, ac.currentTime, 0.05);
      this.duck.gain.setTargetAtTime(1, ac.currentTime + clip.duration, 0.3);
      return;
    }
  }

  /** Make the crowd roar, from 0 (a murmur) to 1 (a finish). */
  cheer(amount: number) {
    this.excitement = Math.min(1, this.excitement + amount);
  }

  /** Once a frame: the roar fades back to a murmur. */
  frame(dt: number) {
    if (!this.ac) return;
    this.pumpVoices();
    if (!this.amb) return;
    const conf = AMBIENCE[this.amb];
    this.excitement *= Math.exp(-dt / 1800);
    const t = this.ac.currentTime;
    this.bed.gain.gain.setTargetAtTime(conf.base + conf.swell * this.excitement, t, 0.08);
    if (this.amb !== 'street') this.bed.filter.frequency.setTargetAtTime(conf.f + 700 * this.excitement, t, 0.1);
  }
}
