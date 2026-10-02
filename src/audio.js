// Tiny WebAudio synth: no audio files to download, ~zero CPU when idle.
const PENTA = [0, 2, 4, 7, 9];

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this._musicTimer = 0;
    this._step = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.5 : 0;
    // cheap feedback delay for dreamy music tail
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    delay.connect(fb).connect(delay);
    this.musicGain.connect(this.master);
    this.musicGain.connect(delay);
    delay.connect(this.master);
    // noise buffer for thuds
    const len = ctx.sampleRate * 0.25;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    this.noise = buf;
    this.startMusic();
  }

  setEnabled(v) {
    this.enabled = v;
  }

  setMusic(v) {
    this.musicOn = v;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(v ? 0.5 : 0, this.ctx.currentTime, 0.2);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  tone(freq, dur, { type = 'sine', vol = 0.2, slide = 0, delay = 0, dest = null, attack = 0.005 } = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest || this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  note(semi, base = 261.63) {
    return base * Math.pow(2, semi / 12);
  }

  click() {
    if (!this.enabled) return;
    this.tone(660, 0.08, { type: 'triangle', vol: 0.15, slide: 1.4 });
  }

  grab() {
    if (!this.enabled) return;
    this.tone(420, 0.09, { type: 'sine', vol: 0.18, slide: 1.5 });
  }

  pop(i = 0) {
    if (!this.enabled) return;
    const f = 300 + (i % 12) * 55;
    this.tone(f, 0.16, { type: 'sine', vol: 0.22, slide: 2.2 });
    this.tone(f * 2, 0.08, { type: 'triangle', vol: 0.06, slide: 1.5, delay: 0.01 });
  }

  snap(combo = 1) {
    if (!this.enabled) return;
    const k = Math.min(combo - 1, 9);
    const s = PENTA[k % 5] + 12 * Math.floor(k / 5);
    const f = this.note(s + 7);
    this.tone(f, 0.45, { type: 'triangle', vol: 0.22 });
    this.tone(f * 2, 0.35, { type: 'sine', vol: 0.1, delay: 0.03 });
    this.tone(f * 1.5, 0.3, { type: 'sine', vol: 0.08, delay: 0.07 });
    this.thud(0.5);
  }

  thud(v = 0.5) {
    if (!this.enabled || !this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 380 + v * 300;
    const g = ctx.createGain();
    g.gain.value = Math.min(0.5, v * 0.45);
    src.connect(f).connect(g).connect(this.master);
    src.start();
    this.tone(120, 0.1, { type: 'sine', vol: Math.min(0.3, v * 0.3), slide: 0.5 });
  }

  wrong() {
    if (!this.enabled) return;
    this.tone(220, 0.18, { type: 'triangle', vol: 0.16, slide: 0.7 });
  }

  coin() {
    if (!this.enabled) return;
    this.tone(988, 0.08, { type: 'square', vol: 0.05 });
    this.tone(1319, 0.2, { type: 'square', vol: 0.05, delay: 0.07 });
  }

  hint() {
    if (!this.enabled) return;
    [0, 4, 7, 12].forEach((s, i) => this.tone(this.note(s + 12), 0.25, { type: 'sine', vol: 0.12, delay: i * 0.06 }));
  }

  win() {
    if (!this.enabled) return;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) =>
      this.tone(this.note(s), 0.5, { type: 'triangle', vol: 0.2, delay: i * 0.09 })
    );
    [0, 7, 12].forEach((s) => this.tone(this.note(s + 12), 1.2, { type: 'sine', vol: 0.1, delay: 0.7 }));
  }

  startMusic() {
    if (this._musicTimer) return;
    const chords = [0, -3, -7, -5]; // I vi IV V roots (C, A, F, G)
    const ctx = this.ctx;
    let nextTime = ctx.currentTime + 0.2;
    const tick = () => {
      if (!this.ctx) return;
      while (nextTime < ctx.currentTime + 0.6) {
        if (this.musicOn && ctx.state === 'running') {
          const bar = Math.floor(this._step / 8) % chords.length;
          const root = chords[bar];
          const n = PENTA[(Math.random() * 5) | 0] + root + 12;
          const delay = Math.max(0, nextTime - ctx.currentTime);
          if (this._step % 8 === 0) this.tone(this.note(root - 12), 3.2, { type: 'sine', vol: 0.09, delay, dest: this.musicGain, attack: 0.4 });
          if (Math.random() < 0.72) this.tone(this.note(n + 12), 0.9, { type: 'triangle', vol: 0.05, delay, dest: this.musicGain, attack: 0.01 });
        }
        this._step++;
        nextTime += 0.46;
      }
    };
    this._musicTimer = setInterval(tick, 250);
  }
}

export const sfx = new Sfx();
