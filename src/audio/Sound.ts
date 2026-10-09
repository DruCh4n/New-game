/**
 * All sounds are synthesised with the Web Audio API: no audio files, works offline.
 * The context starts on the first user interaction (browser autoplay rules).
 */
export type Sfx = 'click' | 'coin' | 'build' | 'demolish' | 'error' | 'month' | 'done' | 'talk';

const STORE = 'kotabaru.sound';

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientGain: GainNode | null = null;
  private birdTimer = 0;
  volume = 0.6;
  muted = false;
  ambient = true;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      if (typeof s.volume === 'number') this.volume = s.volume;
      if (typeof s.muted === 'boolean') this.muted = s.muted;
      if (typeof s.ambient === 'boolean') this.ambient = s.ambient;
    } catch { /* ignore */ }
  }

  /** Call from a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.ambientGain = this.ctx.createGain();
    this.ambientGain.connect(this.master);
    this.apply();
    this.startAmbient();
  }

  private persist() {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, muted: this.muted, ambient: this.ambient })); } catch { /* ignore */ }
  }

  private apply() {
    if (!this.master || !this.ambientGain || !this.ctx) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
    this.ambientGain.gain.setTargetAtTime(this.ambient ? 0.35 : 0, this.ctx.currentTime, 0.3);
  }

  setVolume(v: number) { this.volume = v; this.apply(); this.persist(); }
  setMuted(m: boolean) { this.muted = m; this.apply(); this.persist(); }
  setAmbient(a: boolean) { this.ambient = a; this.apply(); this.persist(); }

  play(name: Sfx) {
    const c = this.ctx, out = this.master;
    if (!c || !out || this.muted) return;
    const t = c.currentTime;
    switch (name) {
      case 'click': this.tone(1400, 0.03, 'triangle', 0.08, t); break;
      case 'talk': this.tone(520, 0.05, 'sine', 0.06, t); this.tone(660, 0.05, 'sine', 0.05, t + 0.06); break;
      case 'coin':
        this.tone(988, 0.08, 'square', 0.07, t);
        this.tone(1319, 0.25, 'square', 0.07, t + 0.08);
        break;
      case 'done':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, t + i * 0.09));
        break;
      case 'month':
        [784, 988].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.08, t + i * 0.18));
        break;
      case 'error': this.tone(180, 0.18, 'sawtooth', 0.07, t); this.tone(150, 0.2, 'sawtooth', 0.07, t + 0.12); break;
      case 'build':
        this.noise(0.12, 300, 0.25, t);
        this.tone(90, 0.15, 'sine', 0.3, t);
        this.noise(0.1, 800, 0.12, t + 0.18);
        break;
      case 'demolish':
        this.noise(0.6, 500, 0.35, t);
        this.tone(60, 0.4, 'sine', 0.3, t);
        this.noise(0.3, 1500, 0.15, t + 0.25);
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, at: number) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  private noise(dur: number, cutoff: number, gain: number, at: number, dest?: AudioNode) {
    const c = this.ctx!;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dest ?? this.master!);
    src.start(at);
  }

  /** Distant traffic hum plus occasional birds. */
  private startAmbient() {
    const c = this.ctx!;
    const len = c.sampleRate * 4;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; } // brown noise
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf;
    src.loop = true;
    f.type = 'lowpass';
    f.frequency.value = 420;
    g.gain.value = 0.18;
    src.connect(f).connect(g).connect(this.ambientGain!);
    src.start();
    const bird = () => {
      if (this.ctx && this.ambient && !this.muted) {
        const t = this.ctx.currentTime;
        const base = 2400 + Math.random() * 1800;
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          const o = this.ctx.createOscillator(), gg = this.ctx.createGain();
          const at = t + i * (0.09 + Math.random() * 0.05);
          o.frequency.setValueAtTime(base, at);
          o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), at + 0.06);
          gg.gain.setValueAtTime(0, at);
          gg.gain.linearRampToValueAtTime(0.025, at + 0.01);
          gg.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
          o.connect(gg).connect(this.ambientGain!);
          o.start(at);
          o.stop(at + 0.1);
        }
      }
      this.birdTimer = window.setTimeout(bird, 2500 + Math.random() * 6000);
    };
    window.clearTimeout(this.birdTimer);
    bird();
  }
}

export const sound = new SoundEngine();
