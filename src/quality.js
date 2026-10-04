// Adaptive resolution governor: keeps frame time low so phones stay cool.
// Only active (interactive) frames are sampled; idle frames are intentionally cheap.
export class Quality {
  constructor(cap) {
    const dpr = window.devicePixelRatio || 1;
    this.cap = Math.min(cap, dpr);
    this.dpr = this.cap;
    this.ceiling = this.cap;
    this.ema = 16.7;
    this.slow = 0;
    this.good = 0;
    this.target = 16.7;
  }

  setTargetFps(fps) {
    this.target = 1000 / fps;
    this.ema = this.target;
  }

  // returns true when dpr changed
  sample(dtMs) {
    if (dtMs > 120) return false; // tab switch / hitch, ignore
    this.ema = this.ema * 0.92 + dtMs * 0.08;
    if (this.ema > this.target * 1.32) {
      this.slow++;
      this.good = 0;
    } else {
      this.slow = Math.max(0, this.slow - 1);
      if (this.ema < this.target * 1.08) this.good++;
    }
    if (this.slow > 36 && this.dpr > 0.65) {
      this.dpr = Math.max(0.65, this.dpr - 0.2);
      this.ceiling = Math.min(this.ceiling, this.dpr + 0.2); // don't bounce straight back up
      this.slow = 0;
      this.good = 0;
      this.ema = this.target;
      return true;
    }
    if (this.good > 900 && this.dpr < this.ceiling) {
      this.dpr = Math.min(this.ceiling, this.dpr + 0.15);
      this.good = 0;
      return true;
    }
    return false;
  }
}
