import * as THREE from 'three';

// One cheap custom shader drives the whole game look: soft half-lambert toon,
// gloss highlight, rim light and a die-cut "sticker" outline pass.
// No shadow maps, no post-processing -> light on mobile GPUs.
export const shared = {
  uLightDir: { value: new THREE.Vector3(0.5, 0.85, 0.6).normalize() },
  uSky: { value: new THREE.Color('#fff6fb') },
  uGround: { value: new THREE.Color('#e3c4dc') },
  uLightCol: { value: new THREE.Color('#fff0dc') },
  uRim: { value: new THREE.Color('#ffd6f0') },
  uTime: { value: 0 },
};

const VERT = /* glsl */ `
uniform float uOutline;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  #ifdef USE_COLOR
    vCol = color;
  #else
    vCol = vec3(1.0);
  #endif
  #ifdef USE_INSTANCING_COLOR
    vCol *= instanceColor;
  #endif
  vUv = uv;
  vec3 p = position;
  #ifdef OUTLINE
    p += normal * uOutline;
  #endif
  #ifdef USE_INSTANCING
    mat4 mm = modelMatrix * instanceMatrix;
  #else
    mat4 mm = modelMatrix;
  #endif
  vec4 wp = mm * vec4(p, 1.0);
  #ifdef WIND
    float sway = sin(uTime * 1.7 + mm[3].x * 0.45 + mm[3].z * 0.31) + 0.4 * sin(uTime * 3.1 + mm[3].x);
    wp.xz += vec2(0.09, 0.05) * sway * max(position.y, 0.0);
  #endif
  vN = normalize(mat3(mm) * normal);
  vV = cameraPosition - wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLightDir;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uLightCol;
uniform vec3 uRim;
uniform vec3 uTint;
uniform vec3 uOutlineCol;
uniform float uTintAmt;
uniform float uAlpha;
uniform float uGlow;
#ifdef USE_MAP
  uniform sampler2D uMap;
#endif
varying vec3 vN;
varying vec3 vV;
varying vec3 vCol;
varying vec2 vUv;
void main() {
  #if defined(OUTLINE)
    gl_FragColor = vec4(uOutlineCol, uAlpha);
  #elif defined(GHOST)
    gl_FragColor = vec4(uTint, uAlpha);
  #else
    vec3 n = normalize(vN);
    vec3 v = normalize(vV);
    if (!gl_FrontFacing) n = -n;
    vec3 base = vCol;
    #ifdef USE_MAP
      base *= texture2D(uMap, vUv).rgb;
    #endif
    float ndl = dot(n, uLightDir);
    float wrap = ndl * 0.5 + 0.5;
    wrap = wrap * wrap;
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5);
    vec3 col = base * (amb * 0.78 + uLightCol * wrap * 0.62);
    vec3 h = normalize(uLightDir + v);
    float spec = pow(max(dot(n, h), 0.0), 40.0);
    col += spec * 0.22 * (0.4 + base);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    col += uRim * fres * 0.22;
    col = mix(col, uTint, uTintAmt);
    col += uTint * uGlow * (0.35 + fres);
    gl_FragColor = vec4(col, uAlpha);
  #endif
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function makeMat({ map = null, outline = false, ghost = false, vertexColors = true, doubleSide = false, wind = false } = {}) {
  const defines = {};
  if (wind) defines.WIND = '';
  if (outline) defines.OUTLINE = '';
  if (ghost) defines.GHOST = '';
  if (map) defines.USE_MAP = '';
  const m = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines,
    uniforms: {
      ...shared,
      uTint: { value: new THREE.Color(1, 1, 1) },
      uOutlineCol: { value: new THREE.Color('#fffaf3') },
      uTintAmt: { value: 0 },
      uAlpha: { value: 1 },
      uGlow: { value: 0 },
      uOutline: { value: 0.05 },
      uMap: { value: map },
    },
    vertexColors: vertexColors && !outline && !ghost,
    side: outline ? THREE.BackSide : doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    transparent: ghost,
    depthWrite: !ghost,
  });
  return m;
}

// ----- procedural textures (cached) -------------------------------------
const texCache = new Map();

export function patternTexture(style, a, b, size = 256) {
  const key = [style, a, b, size].join('|');
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = a;
  g.fillRect(0, 0, size, size);
  const S = size;
  g.fillStyle = b;
  g.strokeStyle = b;
  switch (style) {
    case 'stripes':
      for (let i = 0; i < 4; i++) g.fillRect((i * S) / 4 + S / 16, 0, S / 8, S);
      break;
    case 'dots':
      for (let y = 0; y < 2; y++)
        for (let x = 0; x < 2; x++) {
          g.beginPath();
          g.arc(S * (0.25 + x * 0.5) + (y % 2 ? S * 0.0 : 0), S * (0.25 + y * 0.5), S * 0.07, 0, 7);
          g.fill();
        }
      g.globalAlpha = 0.6;
      g.beginPath();
      g.arc(S * 0.5, S * 0.5, S * 0.05, 0, 7);
      g.arc(0, 0, S * 0.05, 0, 7);
      g.arc(S, 0, S * 0.05, 0, 7);
      g.arc(0, S, S * 0.05, 0, 7);
      g.arc(S, S, S * 0.05, 0, 7);
      g.fill();
      break;
    case 'stars': {
      const star = (cx, cy, r) => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const rr = i % 2 ? r * 0.45 : r;
          const an = (Math.PI * i) / 5 - Math.PI / 2;
          g.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr);
        }
        g.closePath();
        g.fill();
      };
      star(S * 0.25, S * 0.3, S * 0.09);
      star(S * 0.75, S * 0.75, S * 0.09);
      g.globalAlpha = 0.6;
      star(S * 0.75, S * 0.2, S * 0.045);
      star(S * 0.22, S * 0.8, S * 0.045);
      break;
    }
    case 'hearts': {
      const heart = (cx, cy, r) => {
        g.beginPath();
        g.moveTo(cx, cy + r * 0.9);
        g.bezierCurveTo(cx - r * 1.6, cy - r * 0.1, cx - r * 0.7, cy - r * 1.2, cx, cy - r * 0.35);
        g.bezierCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 1.6, cy - r * 0.1, cx, cy + r * 0.9);
        g.fill();
      };
      heart(S * 0.25, S * 0.25, S * 0.08);
      heart(S * 0.75, S * 0.75, S * 0.08);
      break;
    }
    case 'gingham':
      g.globalAlpha = 0.5;
      for (let i = 0; i < 4; i++) {
        g.fillRect((i * S) / 4, 0, S / 8, S);
        g.fillRect(0, (i * S) / 4, S, S / 8);
      }
      break;
    case 'tiles':
      g.fillStyle = b;
      g.fillRect(0, 0, S / 2, S / 2);
      g.fillRect(S / 2, S / 2, S / 2, S / 2);
      g.globalAlpha = 0.25;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, S, 3);
      g.fillRect(0, 0, 3, S);
      g.fillRect(0, S / 2, S, 2);
      g.fillRect(S / 2, 0, 2, S);
      break;
    case 'wood': {
      const rows = 4;
      for (let i = 0; i < rows; i++) {
        g.globalAlpha = 1;
        g.fillStyle = i % 2 ? a : b;
        g.fillRect(0, (i * S) / rows, S, S / rows);
        g.globalAlpha = 0.18;
        g.fillStyle = '#5a3320';
        g.fillRect(0, (i * S) / rows, S, 3);
        const off = (i * 0.37 + 0.2) * S;
        g.fillRect(off, (i * S) / rows, 3, S / rows);
        g.globalAlpha = 0.07;
        for (let k = 0; k < 6; k++) g.fillRect(0, (i * S) / rows + 6 + k * 9, S, 2);
      }
      break;
    }
    case 'carpet':
      g.globalAlpha = 0.12;
      for (let i = 0; i < 400; i++) g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
      break;
    case 'clouds':
      g.globalAlpha = 0.7;
      for (const [x, y, r] of [[0.3, 0.3, 0.08], [0.38, 0.28, 0.1], [0.46, 0.3, 0.08], [0.78, 0.78, 0.07], [0.85, 0.76, 0.09], [0.92, 0.79, 0.06]]) {
        g.beginPath();
        g.arc(S * x, S * y, S * r, 0, 7);
        g.fill();
      }
      break;
    default:
      break;
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.generateMipmaps = true;
  texCache.set(key, t);
  return t;
}

let blobTex = null;
export function blobTexture() {
  if (blobTex) return blobTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(60,30,80,0.55)');
  gr.addColorStop(0.55, 'rgba(60,30,80,0.22)');
  gr.addColorStop(1, 'rgba(60,30,80,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  blobTex = new THREE.CanvasTexture(c);
  blobTex.colorSpace = THREE.SRGBColorSpace;
  return blobTex;
}

let sparkTex = null;
export function sparkTexture() {
  if (sparkTex) return sparkTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  // 4-point star flare
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.moveTo(32, 2);
  g.quadraticCurveTo(34, 30, 62, 32);
  g.quadraticCurveTo(34, 34, 32, 62);
  g.quadraticCurveTo(30, 34, 2, 32);
  g.quadraticCurveTo(30, 30, 32, 2);
  g.fill();
  sparkTex = new THREE.CanvasTexture(c);
  sparkTex.colorSpace = THREE.SRGBColorSpace;
  return sparkTex;
}
