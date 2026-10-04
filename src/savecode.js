// 7-character save code (Crockford base32, e.g. "K7M-2QXA"), 35 bits:
//   payload 25 bits = levels cleared in order (7) | total stars (7) | coins/10 (11)
//   scrambled with an invertible multiply so neighbouring saves look unrelated, + 10-bit checksum.
const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MOD = 1n << 25n;
const K = 0x16a09e5n; // odd -> invertible mod 2^25
const KINV = (() => {
  let x = 1n; // Newton iteration for the modular inverse of an odd number mod 2^k
  for (let i = 0; i < 6; i++) x = (x * (2n - K * x)) % MOD;
  return ((x % MOD) + MOD) % MOD;
})();

function check10(v) {
  let h = Math.imul(v ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x165667b1);
  return (h >>> 9) & 1023;
}

export function encodeSave(save, levels) {
  let p = 0;
  let stars = 0;
  while (p < levels.length && save.stars[levels[p].id]) stars += save.stars[levels[p++].id];
  p = Math.min(p, 127);
  stars = Math.min(stars, 127);
  const coins = Math.min(2047, Math.floor((save.coins || 0) / 10));
  const payload = p | (stars << 7) | (coins << 14);
  const scr = Number((BigInt(payload) * K) % MOD);
  let n = BigInt(scr) * 1024n + BigInt(check10(payload));
  let out = '';
  for (let i = 0; i < 7; i++) {
    out = ALPH[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out.slice(0, 4) + '-' + out.slice(4);
}

export function decodeSave(code) {
  const s = String(code || '')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
  if (s.length !== 7) return null;
  let n = 0n;
  for (const ch of s) {
    const v = ALPH.indexOf(ch);
    if (v < 0) return null;
    n = n * 32n + BigInt(v);
  }
  const chk = Number(n & 1023n);
  const scr = n >> 10n;
  const payload = Number((scr * KINV) % MOD);
  if (check10(payload) !== chk) return null;
  return { cleared: payload & 127, stars: (payload >> 7) & 127, coins: ((payload >> 14) & 2047) * 10 };
}

// Rebuild a save from a decoded code (stars are spread over the cleared levels).
export function applyCode(save, data, levels) {
  const p = Math.min(data.cleared, levels.length);
  save.stars = {};
  let left = data.stars;
  for (let i = 0; i < p; i++) {
    const remainingLevels = p - i;
    const s = Math.max(1, Math.min(3, Math.round(left / remainingLevels)));
    save.stars[levels[i].id] = s;
    left -= s;
  }
  save.coins = data.coins;
  save.tutorialPlays = Math.max(save.tutorialPlays || 0, p > 0 ? 3 : 0);
  return save;
}
