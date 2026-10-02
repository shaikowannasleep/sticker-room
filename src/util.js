export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const smooth = (t) => t * t * (3 - 2 * t);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t, s = 1.9) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
export const easeOutElastic = (t) =>
  t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin(((t * 10 - 0.75) * (2 * Math.PI)) / 3) + 1;

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (navigator.maxTouchPoints > 1 && /Macintosh/i.test(navigator.userAgent));
