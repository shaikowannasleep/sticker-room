import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// ---------------------------------------------------------------------------
// Part DSL -> one merged, vertex-coloured geometry per item (1 draw call, +1 outline).
//   t: s=sphere b=rounded box c=cylinder k=cone t=torus star heart moon
// ---------------------------------------------------------------------------
const tmpE = new THREE.Euler();
const tmpQ = new THREE.Quaternion();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();

function starShape(R) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? R * 0.5 : R;
    const a = (Math.PI * i) / 5 + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r - R * 0.08;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

function heartShape(k) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5 * k);
  s.bezierCurveTo(-0.15 * k, -0.35 * k, -0.55 * k, -0.1 * k, -0.55 * k, 0.15 * k);
  s.bezierCurveTo(-0.55 * k, 0.4 * k, -0.2 * k, 0.5 * k, 0, 0.28 * k);
  s.bezierCurveTo(0.2 * k, 0.5 * k, 0.55 * k, 0.4 * k, 0.55 * k, 0.15 * k);
  s.bezierCurveTo(0.55 * k, -0.1 * k, 0.15 * k, -0.35 * k, 0, -0.5 * k);
  return s;
}

function moonShape(R) {
  const r2 = R * 0.84;
  const cx = R * 0.44;
  const cy = R * 0.2;
  const d = Math.hypot(cx, cy);
  const a = (R * R - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(R * R - a * a);
  const ux = cx / d;
  const uy = cy / d;
  const p1 = [ux * a - uy * h, uy * a + ux * h];
  const p2 = [ux * a + uy * h, uy * a - ux * h];
  const t1 = Math.atan2(p1[1], p1[0]);
  const t2 = Math.atan2(p2[1], p2[0]);
  const f1 = Math.atan2(p2[1] - cy, p2[0] - cx);
  const f2 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const s = new THREE.Shape();
  s.absarc(0, 0, R, t1, t2 + Math.PI * 2, false);
  s.absarc(cx, cy, r2, f1, f2 - Math.PI * 2, true);
  return s;
}

function extruded(shape, depth, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: DETAIL === 0 ? 2 : 3,
    curveSegments: [6, 8, 10][DETAIL],
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

// 0 = low (weak phones), 1 = mid, 2 = high. Set once before anything is built.
let DETAIL = 2;
export function setDetail(d) {
  DETAIL = d;
}
const segs = (n, min = 3) => Math.max(min, Math.round(n * [0.6, 0.78, 1][DETAIL]));

function partGeo(d) {
  let g;
  switch (d.t) {
    case 's': {
      const w = segs(d.seg || 16, 6);
      g = new THREE.SphereGeometry(d.r, w, Math.max(4, Math.round(w * 0.75)));
      break;
    }
    case 'b':
      g = new RoundedBoxGeometry(d.w, d.h, d.d, DETAIL === 0 ? 1 : 2, d.rad ?? Math.min(d.w, d.h, d.d) * 0.28);
      break;
    case 'c':
      g = new THREE.CylinderGeometry(d.rt, d.rb ?? d.rt, d.h, segs(d.seg || 20, 6), 1);
      break;
    case 'k':
      g = new THREE.ConeGeometry(d.r, d.h, d.seg ? d.seg : segs(14, 6), 1);
      break;
    case 't':
      g = new THREE.TorusGeometry(d.R, d.r, segs(8, 5), segs(d.seg || 20, 8), d.arc ?? Math.PI * 2);
      break;
    case 'star':
      g = extruded(starShape(d.R), d.depth ?? 0.18, d.bevel ?? 0.09);
      break;
    case 'heart':
      g = extruded(heartShape(d.k), d.depth ?? 0.2, d.bevel ?? 0.1);
      break;
    case 'moon':
      g = extruded(moonShape(d.R), d.depth ?? 0.16, d.bevel ?? 0.08);
      break;
    default:
      throw new Error('unknown part ' + d.t);
  }
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv'); // nothing samples textures on stickers/furniture -> lets seams weld
  tmpE.set(d.rot ? d.rot[0] : 0, d.rot ? d.rot[1] : 0, d.rot ? d.rot[2] : 0, 'YXZ');
  tmpQ.setFromEuler(tmpE);
  tmpP.set(...(d.p || [0, 0, 0]));
  tmpS.set(...(d.sc || [1, 1, 1]));
  tmpM.compose(tmpP, tmpQ, tmpS);
  g.applyMatrix4(tmpM);
  tmpC.set(d.c || '#ffffff');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = tmpC.r;
    col[i * 3 + 1] = tmpC.g;
    col[i * 3 + 2] = tmpC.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Merge parts and weld duplicate vertices -> indexed mesh (~5x fewer vertices to shade on the GPU).
export function mergeParts(parts) {
  const geos = parts.map(partGeo);
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  const welded = mergeVertices(merged, 1e-4);
  merged.dispose();
  return welded;
}

export function buildOutlineGeo(geo) {
  let og = new THREE.BufferGeometry();
  og.setAttribute('position', geo.attributes.position.clone());
  if (geo.index) og.setIndex(geo.index.clone());
  og = mergeVertices(og, 1e-3);
  og.computeVertexNormals();
  return og;
}

// ---------------------------------------------------------------------------
// helpers for cute faces
// ---------------------------------------------------------------------------
const ell = (rx, ry, rz, cx = 0, cy = 0, cz = 0) => (x, y) =>
  cz + rz * Math.sqrt(Math.max(0.03, 1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2));
const flat = (z) => () => z;

function face(zf, y, sp = 0.16, sz = 0.065, o = {}) {
  const out = [];
  const ink = o.ink || '#2b2540';
  for (const s of [-1, 1]) {
    const ex = s * sp;
    const ez = zf(ex, y);
    out.push({ t: 's', r: sz, p: [ex, y, ez], sc: [1, 1.3, 0.55], c: ink, seg: 10 });
    out.push({ t: 's', r: sz * 0.38, p: [ex + sz * 0.3, y + sz * 0.5, ez + sz * 0.35], c: '#ffffff', seg: 8 });
    if (o.blush !== false) {
      const bx = s * sp * 1.85;
      out.push({ t: 's', r: sz * 1.15, p: [bx, y - sz * 1.7, zf(bx, y - sz * 1.7) - 0.005], sc: [1, 0.62, 0.3], c: o.blushC || '#ff9db8', seg: 10 });
    }
  }
  if (o.mouth !== false) {
    const my = y - sz * 1.2;
    out.push({ t: 't', R: sz * 0.5, r: sz * 0.15, arc: Math.PI, p: [0, my, zf(0, my) + 0.004], rot: [0, 0, Math.PI], c: ink, seg: 10 });
  }
  return out;
}

function leaf(a, tilt, len, w, x0, y0, z0, c) {
  const dh = Math.cos(tilt);
  const dx = Math.sin(a) * dh;
  const dy = Math.sin(tilt);
  const dz = Math.cos(a) * dh;
  return {
    t: 's',
    r: 0.5,
    p: [x0 + (dx * len) / 2, y0 + (dy * len) / 2, z0 + (dz * len) / 2],
    sc: [w, 0.2, len],
    rot: [-tilt, a, 0],
    c,
    seg: 12,
  };
}

const shift = (parts, dx = 0, dy = 0, dz = 0) => parts.map((q) => ({ ...q, p: [(q.p?.[0] || 0) + dx, (q.p?.[1] || 0) + dy, (q.p?.[2] || 0) + dz] }));
const front = (x, y, z, ry, d) => [x + Math.sin(ry) * d, y, z + Math.cos(ry) * d];
const rodBetween = (a, b, r, c) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return { t: 'c', rt: r, rb: r, h: Math.hypot(dx, dy), p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, a[2] ?? 0], rot: [0, 0, Math.atan2(-dx, dy)], c, seg: 6 };
};

const POT = '#f0a083';
const POT2 = '#e88c6e';
const pot = (h = 0.5, r = 0.42) => [
  { t: 'c', rt: r, rb: r * 0.78, h, p: [0, h / 2, 0], c: POT },
  { t: 'c', rt: r * 1.1, rb: r * 1.1, h: h * 0.26, p: [0, h - h * 0.13, 0], c: POT2 },
  { t: 'c', rt: r * 0.92, rb: r * 0.92, h: 0.02, p: [0, h + 0.005, 0], c: '#7a5539' },
];

// ---------------------------------------------------------------------------
// ITEM LIBRARY  (all models stand on y=0, face +z, wall items face +z too)
// scale = overall size factor; round = cylinder collider; wall = hangs on a wall
// ---------------------------------------------------------------------------
export const ITEM_DEFS = {
  cactus: {
    name: 'Cactus',
    round: true,
    parts: () => [
      ...pot(0.5, 0.42),
      { t: 's', r: 0.42, p: [0, 1.1, 0], sc: [1, 1.35, 1], c: '#7fd6a0' },
      { t: 's', r: 0.13, p: [0.5, 1.12, 0], sc: [1, 1.8, 1], c: '#7fd6a0' },
      { t: 's', r: 0.13, p: [-0.48, 0.95, 0], sc: [1, 1.7, 1], c: '#7fd6a0' },
      { t: 'b', w: 0.4, h: 0.12, d: 0.12, rad: 0.05, p: [0.35, 0.95, 0], c: '#7fd6a0' },
      { t: 's', r: 0.1, p: [0.02, 1.74, 0], sc: [1, 0.8, 1], c: '#ff8fb1' },
      { t: 's', r: 0.05, p: [0.02, 1.8, 0.03], c: '#ffe08a' },
      ...face(ell(0.42, 0.57, 0.42, 0, 1.1, 0), 1.08, 0.15, 0.055),
    ],
  },
  fern: {
    name: 'Monstera',
    round: true,
    parts: () => {
      const P = [...pot(0.5, 0.42)];
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.3;
        P.push(leaf(a, 0.75 + (i % 3) * 0.22, 0.95 + (i % 2) * 0.25, 0.55, Math.sin(a) * 0.08, 0.5, Math.cos(a) * 0.08, i % 2 ? '#5fc68a' : '#7fd6a0'));
      }
      return P;
    },
  },
  succulent: {
    name: 'Succulent',
    round: true,
    parts: () => {
      const P = [...pot(0.42, 0.38)];
      for (let i = 0; i < 6; i++) P.push(leaf((i * Math.PI * 2) / 6, 0.5, 0.62, 0.34, 0, 0.44, 0, i % 2 ? '#9fe3b5' : '#7fd6a0'));
      for (let i = 0; i < 4; i++) P.push(leaf((i * Math.PI * 2) / 4 + 0.4, 0.95, 0.5, 0.28, 0, 0.5, 0, '#c4f0cf'));
      P.push({ t: 's', r: 0.1, p: [0, 0.82, 0], c: '#ffb3cf' });
      return P;
    },
  },
  teddy: {
    name: 'Teddy',
    parts: () => {
      const fur = '#d9a273';
      return [
        { t: 's', r: 0.5, p: [0, 0.52, 0], sc: [1, 0.95, 0.9], c: fur },
        { t: 's', r: 0.33, p: [0, 0.5, 0.3], sc: [1, 1, 0.45], c: '#f8e0c6' },
        { t: 's', r: 0.43, p: [0, 1.3, 0], c: fur },
        { t: 's', r: 0.16, p: [-0.33, 1.65, 0], sc: [1, 1, 0.7], c: fur },
        { t: 's', r: 0.16, p: [0.33, 1.65, 0], sc: [1, 1, 0.7], c: fur },
        { t: 's', r: 0.09, p: [-0.33, 1.65, 0.07], sc: [1, 1, 0.5], c: '#ffb3c7' },
        { t: 's', r: 0.09, p: [0.33, 1.65, 0.07], sc: [1, 1, 0.5], c: '#ffb3c7' },
        { t: 's', r: 0.17, p: [0, 1.2, 0.36], sc: [1.1, 0.8, 0.7], c: '#f8e0c6' },
        { t: 's', r: 0.055, p: [0, 1.26, 0.5], sc: [1.3, 0.85, 0.8], c: '#4a3350' },
        { t: 's', r: 0.17, p: [-0.55, 0.7, 0.12], sc: [1, 1.5, 1], rot: [0, 0, -0.4], c: fur },
        { t: 's', r: 0.17, p: [0.55, 0.7, 0.12], sc: [1, 1.5, 1], rot: [0, 0, 0.4], c: fur },
        { t: 's', r: 0.2, p: [-0.28, 0.16, 0.3], sc: [1, 0.8, 1.2], c: fur },
        { t: 's', r: 0.2, p: [0.28, 0.16, 0.3], sc: [1, 0.8, 1.2], c: fur },
        { t: 's', r: 0.09, p: [-0.15, 0.96, 0.32], c: '#ff8fb1' },
        { t: 's', r: 0.09, p: [0.15, 0.96, 0.32], c: '#ff8fb1' },
        { t: 's', r: 0.06, p: [0, 0.96, 0.37], c: '#ff6f9c' },
        ...face(ell(0.43, 0.43, 0.43, 0, 1.3, 0), 1.36, 0.17, 0.06, { mouth: false }),
      ];
    },
  },
  kitty: {
    name: 'Kitty',
    parts: () => {
      const fur = '#ffd0a0';
      return [
        { t: 's', r: 0.5, p: [0, 0.5, -0.05], sc: [1, 0.95, 0.95], c: fur },
        { t: 's', r: 0.32, p: [0, 0.42, 0.28], sc: [1, 1, 0.5], c: '#fff6ea' },
        { t: 's', r: 0.46, p: [0, 1.3, 0.02], sc: [1.1, 0.95, 1], c: fur },
        { t: 'k', r: 0.17, h: 0.34, p: [-0.34, 1.78, 0], rot: [0, 0, 0.3], c: fur },
        { t: 'k', r: 0.17, h: 0.34, p: [0.34, 1.78, 0], rot: [0, 0, -0.3], c: fur },
        { t: 'k', r: 0.09, h: 0.2, p: [-0.34, 1.74, 0.07], rot: [0, 0, 0.3], c: '#ffb3c7' },
        { t: 'k', r: 0.09, h: 0.2, p: [0.34, 1.74, 0.07], rot: [0, 0, -0.3], c: '#ffb3c7' },
        { t: 'b', w: 0.1, h: 0.2, d: 0.08, rad: 0.03, p: [0, 1.62, 0.43], c: '#f2a46c' },
        { t: 'b', w: 0.08, h: 0.24, d: 0.08, rad: 0.03, p: [-0.16, 1.6, 0.43], rot: [0, 0, 0.35], c: '#f2a46c' },
        { t: 'b', w: 0.08, h: 0.24, d: 0.08, rad: 0.03, p: [0.16, 1.6, 0.43], rot: [0, 0, -0.35], c: '#f2a46c' },
        { t: 's', r: 0.05, p: [0, 1.22, 0.47], sc: [1.3, 0.8, 0.8], c: '#ff8fb1' },
        { t: 't', R: 0.5, r: 0.09, arc: 2.4, p: [0.46, 0.2, -0.42], rot: [Math.PI / 2, 0, 0.3], c: fur },
        { t: 's', r: 0.19, p: [-0.27, 0.15, 0.3], sc: [1, 0.8, 1.2], c: fur },
        { t: 's', r: 0.19, p: [0.27, 0.15, 0.3], sc: [1, 0.8, 1.2], c: fur },
        ...face(ell(0.5, 0.44, 0.46, 0, 1.3, 0.02), 1.34, 0.19, 0.06),
        { t: 'b', w: 0.35, h: 0.012, d: 0.012, rad: 0.005, p: [-0.42, 1.22, 0.38], rot: [0, 0.5, 0.12], c: '#6b5a70' },
        { t: 'b', w: 0.35, h: 0.012, d: 0.012, rad: 0.005, p: [0.42, 1.22, 0.38], rot: [0, -0.5, -0.12], c: '#6b5a70' },
      ];
    },
  },
  bunny: {
    name: 'Bunny',
    parts: () => {
      const fur = '#f6ecff';
      return [
        { t: 's', r: 0.46, p: [0, 0.48, 0], sc: [1, 0.95, 0.9], c: fur },
        { t: 's', r: 0.3, p: [0, 0.42, 0.26], sc: [1, 1, 0.45], c: '#ffffff' },
        { t: 's', r: 0.42, p: [0, 1.2, 0], c: fur },
        { t: 's', r: 0.15, p: [-0.18, 1.95, 0], sc: [1, 2.9, 0.6], rot: [0, 0, 0.12], c: fur },
        { t: 's', r: 0.15, p: [0.18, 1.95, 0], sc: [1, 2.9, 0.6], rot: [0, 0, -0.12], c: fur },
        { t: 's', r: 0.08, p: [-0.18, 1.95, 0.05], sc: [1, 2.8, 0.5], rot: [0, 0, 0.12], c: '#ffc2d6' },
        { t: 's', r: 0.08, p: [0.18, 1.95, 0.05], sc: [1, 2.8, 0.5], rot: [0, 0, -0.12], c: '#ffc2d6' },
        { t: 's', r: 0.05, p: [0, 1.14, 0.42], sc: [1.3, 0.85, 0.8], c: '#ff8fb1' },
        { t: 's', r: 0.13, p: [0, 0.2, -0.45], c: '#ffffff' },
        { t: 's', r: 0.17, p: [-0.25, 0.14, 0.3], sc: [1, 0.8, 1.3], c: fur },
        { t: 's', r: 0.17, p: [0.25, 0.14, 0.3], sc: [1, 0.8, 1.3], c: fur },
        ...face(ell(0.42, 0.42, 0.42, 0, 1.2, 0), 1.26, 0.16, 0.06, { mouth: false }),
      ];
    },
  },
  penguin: {
    name: 'Penguin',
    parts: () => [
      { t: 's', r: 0.58, p: [0, 0.78, 0], sc: [1, 1.3, 0.95], c: '#4b4a73' },
      { t: 's', r: 0.4, p: [0, 0.7, 0.3], sc: [1, 1.5, 0.5], c: '#fffaf5' },
      { t: 's', r: 0.17, p: [-0.58, 0.8, 0], sc: [0.7, 1.8, 1], rot: [0, 0, 0.35], c: '#3d3c63' },
      { t: 's', r: 0.17, p: [0.58, 0.8, 0], sc: [0.7, 1.8, 1], rot: [0, 0, -0.35], c: '#3d3c63' },
      { t: 's', r: 0.2, p: [-0.24, 0.1, 0.25], sc: [1.1, 0.5, 1.5], c: '#ffb066' },
      { t: 's', r: 0.2, p: [0.24, 0.1, 0.25], sc: [1.1, 0.5, 1.5], c: '#ffb066' },
      { t: 'k', r: 0.11, h: 0.2, p: [0, 1.15, 0.52], rot: [Math.PI / 2, 0, 0], sc: [1.4, 1, 0.7], c: '#ffb066' },
      ...face(ell(0.58, 0.75, 0.55, 0, 0.82, 0), 1.25, 0.2, 0.06, { mouth: false }),
    ],
  },
  duck: {
    name: 'Ducky',
    parts: () => [
      { t: 's', r: 0.58, p: [0, 0.5, 0], sc: [1, 0.85, 1.15], c: '#ffe27a' },
      { t: 's', r: 0.4, p: [0, 1.1, 0.2], c: '#ffe27a' },
      { t: 's', r: 0.3, p: [0.0, 0.58, -0.55], sc: [1, 1.1, 0.6], rot: [0.5, 0, 0], c: '#ffe27a' },
      { t: 's', r: 0.25, p: [-0.5, 0.58, 0], sc: [0.4, 0.7, 1], rot: [0, 0, 0.3], c: '#ffd84f' },
      { t: 's', r: 0.25, p: [0.5, 0.58, 0], sc: [0.4, 0.7, 1], rot: [0, 0, -0.3], c: '#ffd84f' },
      { t: 'b', w: 0.34, h: 0.12, d: 0.26, rad: 0.05, p: [0, 1.0, 0.58], c: '#ff9f5a' },
      ...face(ell(0.4, 0.4, 0.4, 0, 1.1, 0.2), 1.18, 0.15, 0.055, { mouth: false }),
    ],
  },
  piggy: {
    name: 'Piggy Bank',
    parts: () => [
      { t: 's', r: 0.68, p: [0, 0.68, 0], sc: [1.15, 0.95, 1], c: '#ffb3c9' },
      { t: 'c', rt: 0.2, rb: 0.2, h: 0.14, p: [0, 0.68, 0.76], rot: [Math.PI / 2, 0, 0], sc: [1.2, 1, 1], c: '#ff94b4' },
      { t: 's', r: 0.04, p: [-0.07, 0.68, 0.85], c: '#c9567f' },
      { t: 's', r: 0.04, p: [0.07, 0.68, 0.85], c: '#c9567f' },
      { t: 'k', r: 0.16, h: 0.26, p: [-0.35, 1.34, 0.1], rot: [0.2, 0, 0.3], c: '#ff94b4' },
      { t: 'k', r: 0.16, h: 0.26, p: [0.35, 1.34, 0.1], rot: [0.2, 0, -0.3], c: '#ff94b4' },
      { t: 'c', rt: 0.16, rb: 0.16, h: 0.26, p: [-0.4, 0.13, 0.3], c: '#ff94b4' },
      { t: 'c', rt: 0.16, rb: 0.16, h: 0.26, p: [0.4, 0.13, 0.3], c: '#ff94b4' },
      { t: 'c', rt: 0.16, rb: 0.16, h: 0.26, p: [-0.4, 0.13, -0.3], c: '#ff94b4' },
      { t: 'c', rt: 0.16, rb: 0.16, h: 0.26, p: [0.4, 0.13, -0.3], c: '#ff94b4' },
      { t: 'b', w: 0.5, h: 0.06, d: 0.1, rad: 0.02, p: [0, 1.34, -0.1], c: '#c9567f' },
      { t: 's', r: 0.22, p: [0.0, 0.8, -0.72], sc: [0.5, 0.5, 0.5], c: '#ff94b4' },
      ...face(ell(0.78, 0.65, 0.68, 0, 0.7, 0), 0.9, 0.3, 0.07, { mouth: false }),
    ],
  },
  mug: {
    name: 'Cute Mug',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.42, rb: 0.38, h: 0.66, p: [0, 0.33, 0], c: '#ffb3d0' },
      { t: 'c', rt: 0.36, rb: 0.36, h: 0.02, p: [0, 0.66, 0], c: '#9a6a4a' },
      { t: 't', R: 0.2, r: 0.055, p: [0.46, 0.34, 0], rot: [0, 0, 0], c: '#ffb3d0', seg: 16 },
      { t: 'c', rt: 0.43, rb: 0.43, h: 0.08, p: [0, 0.62, 0], c: '#fff0f6' },
      ...face(ell(0.42, 50, 0.42, 0, 0, 0), 0.36, 0.15, 0.055),
    ],
  },
  boba: {
    name: 'Boba Tea',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.4, rb: 0.3, h: 0.98, p: [0, 0.49, 0], c: '#f3d9c0' },
      { t: 'c', rt: 0.4, rb: 0.36, h: 0.5, p: [0, 0.3, 0], c: '#d9a77c' },
      { t: 'c', rt: 0.43, rb: 0.43, h: 0.1, p: [0, 1.02, 0], c: '#ffd0e4' },
      { t: 's', r: 0.43, p: [0, 1.04, 0], sc: [1, 0.35, 1], c: '#ffe3f0' },
      { t: 'c', rt: 0.045, rb: 0.045, h: 0.9, p: [0.08, 1.45, 0], rot: [0, 0, -0.15], c: '#8fe3c4' },
      ...[[-0.16, 0.06, 0.2], [0.14, 0.06, 0.2], [0, 0.06, 0.3], [-0.05, 0.14, 0.12]].map(([x, y, z]) => ({ t: 's', r: 0.06, p: [x, y, z], c: '#3a2a35', seg: 8 })),
      ...face(ell(0.38, 50, 0.38, 0, 0, 0), 0.62, 0.14, 0.05),
    ],
  },
  teapot: {
    name: 'Teapot',
    parts: () => [
      { t: 's', r: 0.58, p: [0, 0.5, 0], sc: [1, 0.85, 1], c: '#a8e6cf' },
      { t: 'c', rt: 0.3, rb: 0.34, h: 0.06, p: [0, 0.9, 0], c: '#c8f2e0' },
      { t: 's', r: 0.3, p: [0, 0.93, 0], sc: [1, 0.55, 1], c: '#a8e6cf' },
      { t: 's', r: 0.08, p: [0, 1.13, 0], c: '#ff9fbd' },
      { t: 'c', rt: 0.07, rb: 0.16, h: 0.55, p: [0.72, 0.62, 0], rot: [0, 0, -0.9], c: '#a8e6cf' },
      { t: 't', R: 0.27, r: 0.065, arc: Math.PI * 1.3, p: [-0.6, 0.56, 0], rot: [0, 0, 1.9], c: '#a8e6cf' },
      { t: 'c', rt: 0.4, rb: 0.4, h: 0.07, p: [0, 0.03, 0], c: '#c8f2e0' },
      ...face(ell(0.58, 0.5, 0.58, 0, 0.5, 0), 0.54, 0.2, 0.06),
    ],
  },
  cupcake: {
    name: 'Cupcake',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.42, rb: 0.3, h: 0.46, p: [0, 0.23, 0], c: '#ffd1e0' },
      { t: 'c', rt: 0.4, rb: 0.29, h: 0.09, p: [0, 0.14, 0], c: '#ffb3cf' },
      { t: 'c', rt: 0.41, rb: 0.35, h: 0.09, p: [0, 0.32, 0], c: '#ffb3cf' },
      { t: 's', r: 0.46, p: [0, 0.56, 0], sc: [1, 0.6, 1], c: '#fff6f0' },
      { t: 's', r: 0.34, p: [0, 0.8, 0], sc: [1, 0.65, 1], c: '#ffc2dd' },
      { t: 's', r: 0.22, p: [0, 1.0, 0], sc: [1, 0.7, 1], c: '#fff6f0' },
      { t: 's', r: 0.1, p: [0, 1.17, 0], c: '#ff5c7a' },
      ...[[-0.25, 0.7, 0.3], [0.2, 0.62, 0.35], [0.3, 0.8, -0.1], [-0.2, 0.88, -0.2]].map(([x, y, z], i) => ({ t: 'b', w: 0.12, h: 0.04, d: 0.04, rad: 0.015, p: [x, y, z], rot: [0, i, 0.5], c: i % 2 ? '#8fd3ff' : '#ffe08a' })),
      ...face(ell(0.36, 50, 0.36, 0, 0, 0), 0.26, 0.13, 0.045, { mouth: false }),
    ],
  },
  donut: {
    name: 'Donut',
    round: true,
    parts: () => [
      { t: 't', R: 0.46, r: 0.26, p: [0, 0.27, 0], rot: [Math.PI / 2, 0, 0], seg: 24, c: '#f2c28b' },
      { t: 't', R: 0.46, r: 0.27, p: [0, 0.31, 0], rot: [Math.PI / 2, 0, 0], sc: [1, 1, 0.8], seg: 24, c: '#ff9fc8' },
      ...Array.from({ length: 9 }, (_, i) => {
        const a = i * 0.7;
        return { t: 'b', w: 0.13, h: 0.045, d: 0.045, rad: 0.018, p: [Math.cos(a) * 0.46, 0.5, Math.sin(a) * 0.46], rot: [0, -a + i, 0.2], c: ['#fff', '#8fd3ff', '#ffe08a', '#b6f0c8'][i % 4] };
      }),
      ...face(() => 0.62, 0.3, 0.14, 0.05, { blush: true }).map((p) => ({ ...p, p: [p.p[0], p.p[1], 0.7] })),
    ],
  },
  strawberry: {
    name: 'Strawberry',
    round: true,
    parts: () => [
      { t: 's', r: 0.55, p: [0, 0.62, 0], sc: [1, 1.1, 1], c: '#ff6b81' },
      { t: 's', r: 0.2, p: [0, 0.28, 0], sc: [1, 1, 1], c: '#ff6b81' },
      ...Array.from({ length: 6 }, (_, i) => leaf((i * Math.PI * 2) / 6, 0.4, 0.4, 0.2, 0, 1.2, 0, '#6fcf97')),
      { t: 'c', rt: 0.04, rb: 0.05, h: 0.22, p: [0, 1.28, 0], c: '#4aa56f' },
      ...[[-0.3, 0.45, 0.4], [0.3, 0.45, 0.4], [0, 0.9, 0.5], [-0.35, 0.85, 0.3], [0.35, 0.85, 0.3], [0, 0.3, 0.45], [0.45, 0.65, 0.2], [-0.45, 0.65, 0.2]].map(([x, y, z]) => ({ t: 's', r: 0.035, p: [x, y, z], sc: [1, 1.4, 0.6], c: '#ffe9a0', seg: 8 })),
      ...face(ell(0.55, 0.6, 0.55, 0, 0.62, 0), 0.7, 0.16, 0.06),
    ],
  },
  books: {
    name: 'Books',
    parts: () => [
      { t: 'b', w: 1.2, h: 0.24, d: 0.85, rad: 0.05, p: [0, 0.12, 0], rot: [0, 0.06, 0], c: '#ff9fb5' },
      { t: 'b', w: 1.12, h: 0.04, d: 0.78, rad: 0.015, p: [0.04, 0.12, 0.02], rot: [0, 0.06, 0], c: '#fff6e8' },
      { t: 'b', w: 1.05, h: 0.22, d: 0.8, rad: 0.05, p: [0.05, 0.35, 0], rot: [0, -0.1, 0], c: '#8fd3ff' },
      { t: 'b', w: 0.98, h: 0.04, d: 0.74, rad: 0.015, p: [0.08, 0.35, 0.02], rot: [0, -0.1, 0], c: '#fff6e8' },
      { t: 'b', w: 0.9, h: 0.2, d: 0.7, rad: 0.05, p: [-0.02, 0.56, 0], rot: [0, 0.14, 0], c: '#ffe08a' },
      { t: 's', r: 0.1, p: [0.2, 0.7, 0.2], sc: [1, 0.6, 1], c: '#ff7aa2' },
      ...face(flat(0.43), 0.14, 0.2, 0.04, { mouth: false, blush: false }).map((p) => ({ ...p, p: [p.p[0] - 0.02, p.p[1], 0.43] })),
    ],
  },
  lamp: {
    name: 'Lamp',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.3, rb: 0.34, h: 0.12, p: [0, 0.06, 0], c: '#ffffff' },
      { t: 'c', rt: 0.05, rb: 0.05, h: 0.8, p: [0, 0.5, 0], c: '#ffd3e4' },
      { t: 'c', rt: 0.34, rb: 0.58, h: 0.62, p: [0, 1.15, 0], c: '#ffe9a8' },
      { t: 'c', rt: 0.36, rb: 0.6, h: 0.05, p: [0, 0.86, 0], c: '#ffd35e' },
      { t: 'c', rt: 0.36, rb: 0.36, h: 0.05, p: [0, 1.45, 0], c: '#ffd35e' },
      ...face(ell(0.46, 0.5, 0.46, 0, 1.15, 0.05), 1.1, 0.15, 0.05).map((p) => ({ ...p, p: [p.p[0], p.p[1], p.p[2] + 0.04] })),
    ],
  },
  mushroom: {
    name: 'Mushroom Lamp',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.28, rb: 0.36, h: 0.7, p: [0, 0.35, 0], c: '#fff3df' },
      { t: 's', r: 0.78, p: [0, 0.82, 0], sc: [1, 0.7, 1], c: '#ff7a8a' },
      ...[[0, 1.3, 0.1, 0.16], [-0.42, 1.12, 0.3, 0.12], [0.45, 1.1, 0.25, 0.13], [-0.1, 1.0, 0.65, 0.1], [0.3, 0.92, -0.5, 0.12], [-0.5, 0.95, -0.35, 0.11]].map(([x, y, z, r]) => ({ t: 's', r, p: [x, y, z], sc: [1, 0.5, 1], c: '#fffaf0' })),
      ...face(ell(0.3, 50, 0.3, 0, 0, 0), 0.4, 0.12, 0.05),
    ],
  },
  alarm: {
    name: 'Alarm Clock',
    round: true,
    parts: () => [
      { t: 's', r: 0.55, p: [0, 0.7, 0], sc: [1, 1, 0.65], c: '#ff8fa8' },
      { t: 's', r: 0.43, p: [0, 0.7, 0.2], sc: [1, 1, 0.4], c: '#fffaf3' },
      { t: 's', r: 0.2, p: [-0.34, 1.28, 0], sc: [1, 0.8, 1], c: '#ffd35e' },
      { t: 's', r: 0.2, p: [0.34, 1.28, 0], sc: [1, 0.8, 1], c: '#ffd35e' },
      { t: 'b', w: 0.06, h: 0.3, d: 0.03, rad: 0.015, p: [0, 0.83, 0.32], c: '#3b3350' },
      { t: 'b', w: 0.2, h: 0.05, d: 0.03, rad: 0.015, p: [0.1, 0.7, 0.32], rot: [0, 0, 0.5], c: '#3b3350' },
      { t: 's', r: 0.04, p: [0, 0.7, 0.33], c: '#3b3350' },
      { t: 's', r: 0.1, p: [-0.3, 0.1, 0.1], c: '#ffd35e' },
      { t: 's', r: 0.1, p: [0.3, 0.1, 0.1], c: '#ffd35e' },
      { t: 's', r: 0.03, p: [-0.15, 0.55, 0.34], c: '#ff8fa8' },
      { t: 's', r: 0.03, p: [0.15, 0.55, 0.34], c: '#ff8fa8' },
    ],
  },
  pillow: {
    name: 'Pillow',
    parts: () => [
      { t: 'b', w: 1.3, h: 0.5, d: 1.0, rad: 0.24, p: [0, 0.25, 0], c: '#d9c7ff' },
      { t: 's', r: 0.07, p: [0, 0.52, 0], sc: [1, 0.5, 1], c: '#ffb3d0' },
      { t: 'b', w: 1.32, h: 0.06, d: 0.1, rad: 0.03, p: [0, 0.14, 0.45], c: '#bfa6f5' },
      ...face(flat(0.51), 0.26, 0.2, 0.055),
    ],
  },
  heart: {
    name: 'Heart Cushion',
    parts: () => [
      { t: 'heart', k: 1.5, depth: 0.28, bevel: 0.14, p: [0, 0.8, 0], c: '#ff8fb5' },
      ...face(flat(0.44), 0.85, 0.2, 0.06),
    ],
  },
  gift: {
    name: 'Gift Box',
    parts: () => [
      { t: 'b', w: 1.0, h: 0.8, d: 1.0, rad: 0.1, p: [0, 0.4, 0], c: '#9fd8ff' },
      { t: 'b', w: 1.1, h: 0.22, d: 1.1, rad: 0.08, p: [0, 0.88, 0], c: '#8cc9f5' },
      { t: 'b', w: 0.18, h: 1.04, d: 1.12, rad: 0.04, p: [0, 0.5, 0], c: '#ffd35e' },
      { t: 'b', w: 1.12, h: 1.04, d: 0.18, rad: 0.04, p: [0, 0.5, 0], c: '#ffd35e' },
      { t: 's', r: 0.2, p: [-0.2, 1.1, 0], sc: [1.3, 0.8, 0.9], rot: [0, 0, 0.5], c: '#ffd35e' },
      { t: 's', r: 0.2, p: [0.2, 1.1, 0], sc: [1.3, 0.8, 0.9], rot: [0, 0, -0.5], c: '#ffd35e' },
      { t: 's', r: 0.1, p: [0, 1.06, 0], c: '#ffbe3d' },
    ],
  },
  laptop: {
    name: 'Laptop',
    parts: () => [
      { t: 'b', w: 1.5, h: 0.1, d: 1.0, rad: 0.04, p: [0, 0.05, 0.1], c: '#e4dcf5' },
      { t: 'b', w: 1.2, h: 0.02, d: 0.4, rad: 0.01, p: [0, 0.11, 0.25], c: '#cfc3ec' },
      { t: 'b', w: 1.5, h: 0.95, d: 0.08, rad: 0.03, p: [0, 0.55, -0.4], rot: [-0.18, 0, 0], c: '#e4dcf5' },
      { t: 'b', w: 1.34, h: 0.8, d: 0.02, rad: 0.01, p: [0, 0.55, -0.35], rot: [-0.18, 0, 0], c: '#9fd8ff' },
      { t: 's', r: 0.06, p: [-0.2, 0.6, -0.33], sc: [1, 1.3, 0.3], rot: [-0.18, 0, 0], c: '#2b2540', seg: 8 },
      { t: 's', r: 0.06, p: [0.2, 0.6, -0.33], sc: [1, 1.3, 0.3], rot: [-0.18, 0, 0], c: '#2b2540', seg: 8 },
      { t: 't', R: 0.08, r: 0.018, arc: Math.PI, p: [0, 0.5, -0.33], rot: [-0.18, 0, Math.PI], c: '#2b2540', seg: 10 },
    ],
  },
  camera: {
    name: 'Camera',
    parts: () => [
      { t: 'b', w: 1.2, h: 0.75, d: 0.6, rad: 0.14, p: [0, 0.38, 0], c: '#ffc2d6' },
      { t: 'b', w: 1.22, h: 0.26, d: 0.62, rad: 0.1, p: [0, 0.6, 0], c: '#ffffff' },
      { t: 'c', rt: 0.26, rb: 0.26, h: 0.2, p: [0, 0.38, 0.38], rot: [Math.PI / 2, 0, 0], c: '#4b4a73' },
      { t: 'c', rt: 0.18, rb: 0.18, h: 0.06, p: [0, 0.38, 0.48], rot: [Math.PI / 2, 0, 0], c: '#8fd3ff' },
      { t: 's', r: 0.05, p: [0.04, 0.42, 0.52], c: '#ffffff', seg: 8 },
      { t: 'b', w: 0.22, h: 0.15, d: 0.16, rad: 0.04, p: [-0.35, 0.86, 0], c: '#ffd35e' },
      { t: 'b', w: 0.16, h: 0.1, d: 0.12, rad: 0.04, p: [0.35, 0.82, 0], c: '#ff8fa8' },
    ],
  },
  yarn: {
    name: 'Yarn Ball',
    round: true,
    parts: () => [
      { t: 's', r: 0.5, p: [0, 0.5, 0], c: '#ffb3cf' },
      ...[0, 1, 2, 3, 4].map((i) => ({ t: 't', R: 0.5, r: 0.025, p: [0, 0.5, 0], rot: [i * 0.6, i * 1.1, 0.4 * i], seg: 24, c: '#ff8fb5' })),
      { t: 't', R: 0.35, r: 0.04, arc: 3.4, p: [0.5, 0.06, 0.4], rot: [Math.PI / 2, 0, 0.5], c: '#ffb3cf' },
      ...face(ell(0.5, 0.5, 0.5, 0, 0.5, 0), 0.54, 0.16, 0.055),
    ],
  },
  candle: {
    name: 'Candle',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.42, rb: 0.4, h: 0.6, p: [0, 0.3, 0], c: '#ffd9ec' },
      { t: 'c', rt: 0.35, rb: 0.35, h: 0.1, p: [0, 0.64, 0], c: '#fff6e8' },
      { t: 'c', rt: 0.02, rb: 0.02, h: 0.12, p: [0, 0.74, 0], c: '#4a3350' },
      { t: 's', r: 0.1, p: [0, 0.92, 0], sc: [0.8, 1.5, 0.8], c: '#ffb23d' },
      { t: 's', r: 0.05, p: [0, 0.88, 0.02], sc: [0.8, 1.5, 0.8], c: '#fff2a0' },
      ...face(ell(0.41, 50, 0.41, 0, 0, 0), 0.3, 0.14, 0.05),
    ],
  },
  vase: {
    name: 'Flower Vase',
    round: true,
    parts: () => {
      const P = [
        { t: 's', r: 0.42, p: [0, 0.42, 0], sc: [1, 1.05, 1], c: '#9fd8ff' },
        { t: 'c', rt: 0.17, rb: 0.2, h: 0.3, p: [0, 0.86, 0], c: '#9fd8ff' },
      ];
      const fl = [[-0.3, 1.55, 0.05, '#ff8fb5'], [0.28, 1.65, -0.02, '#ffe08a'], [0, 1.85, 0.05, '#ff9f7a'], [0.05, 1.45, 0.25, '#d9c7ff']];
      fl.forEach(([x, y, z, c]) => {
        P.push({ t: 'c', rt: 0.018, rb: 0.018, h: y - 0.9, p: [x * 0.5, 0.9 + (y - 0.9) / 2, z * 0.5], rot: [0, 0, -x * 0.25], c: '#5fc68a', seg: 6 });
        for (let i = 0; i < 5; i++) {
          const a = (i * Math.PI * 2) / 5;
          P.push({ t: 's', r: 0.1, p: [x + Math.cos(a) * 0.13, y + Math.sin(a) * 0.13, z], sc: [1, 1, 0.5], c, seg: 8 });
        }
        P.push({ t: 's', r: 0.08, p: [x, y, z + 0.02], sc: [1, 1, 0.6], c: '#fff0a8', seg: 8 });
      });
      P.push(leaf(1.2, 0.5, 0.5, 0.25, 0, 0.95, 0, '#6fcf97'), leaf(-1.2, 0.5, 0.5, 0.25, 0, 0.95, 0, '#6fcf97'));
      P.push(...face(ell(0.42, 0.44, 0.42, 0, 0.42, 0), 0.44, 0.14, 0.05));
      return P;
    },
  },
  toaster: {
    name: 'Toaster',
    parts: () => [
      { t: 'b', w: 1.2, h: 0.78, d: 0.8, rad: 0.22, p: [0, 0.39, 0], c: '#ffd9a0' },
      { t: 'b', w: 0.4, h: 0.4, d: 0.5, rad: 0.1, p: [-0.28, 0.9, 0], c: '#f3c07a' },
      { t: 'b', w: 0.4, h: 0.4, d: 0.5, rad: 0.1, p: [0.28, 0.88, 0], c: '#f3c07a' },
      { t: 'b', w: 0.2, h: 0.08, d: 0.1, rad: 0.03, p: [0.55, 0.5, 0.42], c: '#ff8fa8' },
      ...face(flat(0.4), 0.45, 0.22, 0.06),
    ],
  },
  clock: {
    name: 'Wall Clock',
    wall: true,
    parts: () => [
      { t: 'c', rt: 0.62, rb: 0.62, h: 0.14, p: [0, 0, 0], rot: [Math.PI / 2, 0, 0], c: '#ff9fbd' },
      { t: 'c', rt: 0.5, rb: 0.5, h: 0.05, p: [0, 0, 0.07], rot: [Math.PI / 2, 0, 0], c: '#fffaf3' },
      ...[0, 1, 2, 3].map((i) => ({ t: 's', r: 0.04, p: [Math.sin((i * Math.PI) / 2) * 0.4, Math.cos((i * Math.PI) / 2) * 0.4, 0.1], c: '#7a5a8a', seg: 8 })),
      { t: 'b', w: 0.07, h: 0.34, d: 0.03, rad: 0.015, p: [0, 0.14, 0.12], c: '#3b3350' },
      { t: 'b', w: 0.26, h: 0.07, d: 0.03, rad: 0.015, p: [0.1, 0, 0.12], rot: [0, 0, 0.5], c: '#3b3350' },
      { t: 's', r: 0.05, p: [0, 0, 0.12], c: '#ff6f9c', seg: 8 },
    ],
  },
  frame: {
    name: 'Photo Frame',
    wall: true,
    parts: () => [
      { t: 'b', w: 1.3, h: 1.6, d: 0.12, rad: 0.05, p: [0, 0, 0], c: '#d9a273' },
      { t: 'b', w: 1.04, h: 1.34, d: 0.06, rad: 0.02, p: [0, 0, 0.05], c: '#bfe6ff' },
      { t: 's', r: 0.2, p: [0.2, 0.3, 0.1], sc: [1, 1, 0.3], c: '#ffe27a' },
      { t: 's', r: 0.4, p: [-0.12, -0.5, 0.06], sc: [1.1, 0.5, 0.25], c: '#9be3b5' },
      { t: 's', r: 0.32, p: [0.3, -0.5, 0.08], sc: [1, 0.5, 0.25], c: '#7fd6a0' },
      { t: 's', r: 0.12, p: [-0.15, 0.25, 0.1], sc: [1.6, 0.8, 0.3], c: '#ffffff' },
    ],
  },
  star: {
    name: 'Star',
    wall: true,
    parts: () => [{ t: 'star', R: 0.78, depth: 0.14, bevel: 0.1, c: '#ffe27a' }, ...face(flat(0.18), -0.02, 0.17, 0.055)],
  },
  moon: {
    name: 'Moon',
    wall: true,
    parts: () => [{ t: 'moon', R: 0.78, depth: 0.14, bevel: 0.1, c: '#ffeaa0' }, ...face(flat(0.18), 0.02, 0.0, 0.05, { mouth: false, blush: false }).filter((p) => p.p[0] <= 0).map((p) => ({ ...p, p: [p.p[0] - 0.4, p.p[1], 0.18] }))],
  },
  cloud: {
    name: 'Cloud',
    wall: true,
    parts: () => [
      { t: 's', r: 0.4, p: [-0.45, 0, 0], sc: [1, 1, 0.45], c: '#ffffff' },
      { t: 's', r: 0.55, p: [0, 0.18, 0], sc: [1, 1, 0.45], c: '#ffffff' },
      { t: 's', r: 0.4, p: [0.5, 0, 0], sc: [1, 1, 0.45], c: '#ffffff' },
      { t: 'b', w: 1.4, h: 0.5, d: 0.3, rad: 0.2, p: [0.02, -0.12, 0], c: '#ffffff' },
      ...face(flat(0.25), 0.0, 0.2, 0.055, { blushC: '#ffb3cf' }),
    ].map((p) => (p.c === '#ffffff' && p.t !== 's' ? { ...p, c: '#f2f7ff' } : p)),
  },
  rainbow: {
    name: 'Rainbow',
    wall: true,
    parts: () => {
      const cols = ['#ff7a8a', '#ffb066', '#ffe27a', '#8fe3b5', '#8fd3ff'];
      const P = cols.map((c, i) => ({ t: 't', R: 0.95 - i * 0.17, r: 0.09, arc: Math.PI, sc: [1, 1, 0.9], p: [0, -0.4, 0], seg: 28, c }));
      P.push({ t: 's', r: 0.28, p: [-0.95, -0.35, 0.02], sc: [1, 0.8, 0.5], c: '#ffffff' }, { t: 's', r: 0.24, p: [-0.7, -0.4, 0.04], sc: [1, 0.8, 0.5], c: '#ffffff' });
      P.push({ t: 's', r: 0.28, p: [0.95, -0.35, 0.02], sc: [1, 0.8, 0.5], c: '#ffffff' }, { t: 's', r: 0.24, p: [0.7, -0.4, 0.04], sc: [1, 0.8, 0.5], c: '#ffffff' });
      return P;
    },
  },
  // ======================= expansion pack =======================
  tv: {
    name: 'Retro TV',
    parts: () => [
      { t: 'b', w: 1.4, h: 1.05, d: 0.9, rad: 0.22, p: [0, 0.68, 0], c: '#ffb3c7' },
      { t: 'b', w: 1.0, h: 0.75, d: 0.1, rad: 0.12, p: [-0.12, 0.7, 0.43], c: '#bfe6ff' },
      { t: 's', r: 0.06, p: [0.5, 0.85, 0.45], c: '#ffe27a' },
      { t: 's', r: 0.06, p: [0.5, 0.62, 0.45], c: '#8fe3b5' },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.6, p: [-0.2, 1.42, 0], rot: [0, 0, 0.5], c: '#7a5a8a', seg: 6 },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.6, p: [0.2, 1.42, 0], rot: [0, 0, -0.5], c: '#7a5a8a', seg: 6 },
      { t: 's', r: 0.06, p: [-0.34, 1.68, 0], c: '#ff8fb5' },
      { t: 's', r: 0.06, p: [0.34, 1.68, 0], c: '#ff8fb5' },
      { t: 'c', rt: 0.06, rb: 0.08, h: 0.16, p: [-0.45, 0.08, 0], c: '#d98fa6' },
      { t: 'c', rt: 0.06, rb: 0.08, h: 0.16, p: [0.45, 0.08, 0], c: '#d98fa6' },
      ...shift(face(flat(0.49), 0.74, 0.17, 0.06), -0.12),
    ],
  },
  sunflower: {
    name: 'Sunflower',
    round: true,
    parts: () => {
      const P = [...pot(0.5, 0.4)];
      P.push({ t: 'c', rt: 0.04, rb: 0.05, h: 1.0, p: [0, 1.0, 0], c: '#5fc68a', seg: 8 });
      P.push(leaf(1.4, 0.3, 0.5, 0.3, 0, 0.9, 0, '#6fcf97'), leaf(-1.6, 0.4, 0.45, 0.28, 0, 1.1, 0, '#7fd6a0'));
      const cy = 1.62;
      const cz = 0.06;
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        P.push({ t: 's', r: 0.13, p: [Math.cos(a) * 0.33, cy + Math.sin(a) * 0.33, cz], sc: [1.6, 0.75, 0.35], rot: [0, 0, a], c: i % 2 ? '#ffd84f' : '#ffe27a', seg: 10 });
      }
      P.push({ t: 'c', rt: 0.26, rb: 0.26, h: 0.12, p: [0, cy, cz + 0.02], rot: [Math.PI / 2, 0, 0], c: '#a8673f' });
      P.push(...face(flat(cz + 0.09), cy + 0.02, 0.1, 0.045));
      return P;
    },
  },
  tulips: {
    name: 'Tulips',
    round: true,
    parts: () => {
      const P = [
        { t: 'c', rt: 0.34, rb: 0.28, h: 0.55, p: [0, 0.275, 0], c: '#fff3df' },
        { t: 'c', rt: 0.36, rb: 0.36, h: 0.1, p: [0, 0.55, 0], c: '#ffd0e4' },
      ];
      [[-0.2, 1.25, 0, '#ff7a8a'], [0.2, 1.35, 0.05, '#ffb3cf'], [0.0, 1.52, -0.1, '#ffe08a']].forEach(([x, y, z, c]) => {
        P.push({ t: 'c', rt: 0.025, rb: 0.025, h: y - 0.55, p: [x * 0.5, (y + 0.55) / 2, z * 0.5], rot: [0, 0, -x * 0.3], c: '#5fc68a', seg: 6 });
        P.push({ t: 's', r: 0.15, p: [x, y, z], sc: [1, 1.3, 1], c, seg: 12 });
        P.push({ t: 'k', r: 0.09, h: 0.14, p: [x - 0.06, y + 0.2, z], c, seg: 8 });
        P.push({ t: 'k', r: 0.09, h: 0.14, p: [x + 0.06, y + 0.2, z], c, seg: 8 });
      });
      P.push(leaf(0.6, 0.9, 0.6, 0.25, 0, 0.55, 0, '#7fd6a0'), leaf(-2.4, 0.9, 0.55, 0.25, 0, 0.55, 0, '#6fcf97'));
      P.push(...face(ell(0.32, 50, 0.32), 0.3, 0.12, 0.045));
      return P;
    },
  },
  watering: {
    name: 'Watering Can',
    parts: () => [
      { t: 'c', rt: 0.4, rb: 0.45, h: 0.7, p: [0, 0.35, 0], c: '#8fe3c4' },
      { t: 'c', rt: 0.36, rb: 0.4, h: 0.06, p: [0, 0.72, 0], c: '#a8f0d6' },
      { t: 't', R: 0.3, r: 0.05, arc: Math.PI, p: [0, 0.75, 0], rot: [0, Math.PI / 2, 0], c: '#6fd6ad' },
      { t: 'c', rt: 0.05, rb: 0.08, h: 0.7, p: [0.55, 0.65, 0], rot: [0, 0, -1.0], c: '#8fe3c4' },
      { t: 'c', rt: 0.11, rb: 0.06, h: 0.1, p: [0.85, 0.88, 0], rot: [0, 0, -1.0], c: '#6fd6ad' },
      ...face(ell(0.42, 50, 0.42), 0.38, 0.14, 0.05),
    ],
  },
  soap: {
    name: 'Soap',
    parts: () => [
      { t: 'b', w: 0.95, h: 0.42, d: 0.65, rad: 0.18, p: [0, 0.21, 0], c: '#ffc2dd' },
      { t: 's', r: 0.14, p: [-0.25, 0.55, -0.05], c: '#e8f6ff' },
      { t: 's', r: 0.1, p: [0.05, 0.6, 0.1], c: '#ffffff' },
      { t: 's', r: 0.17, p: [0.25, 0.62, -0.1], c: '#dff1ff' },
      { t: 's', r: 0.07, p: [0.0, 0.85, -0.05], c: '#ffffff' },
      ...face(flat(0.33), 0.22, 0.15, 0.045),
    ],
  },
  towels: {
    name: 'Towels',
    parts: () => {
      const roll = (x, y, c, c2) => [
        { t: 'c', rt: 0.22, rb: 0.22, h: 0.8, p: [x, y, 0], rot: [Math.PI / 2, 0, 0], c },
        { t: 'c', rt: 0.12, rb: 0.12, h: 0.82, p: [x, y, 0], rot: [Math.PI / 2, 0, 0], c: c2 },
      ];
      return [
        ...roll(-0.23, 0.22, '#a8d8ff', '#cfe9ff'),
        ...roll(0.23, 0.22, '#ffc2dd', '#ffe0ee'),
        ...roll(0, 0.6, '#b6f0c8', '#dcf8e5'),
        ...face(flat(0.42), 0.62, 0.09, 0.035, { mouth: false }),
      ];
    },
  },
  toothcup: {
    name: 'Toothbrush Cup',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.3, rb: 0.26, h: 0.6, p: [0, 0.3, 0], c: '#9fd8ff' },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.8, p: [-0.08, 0.85, 0], rot: [0, 0, 0.25], c: '#ff8fb5', seg: 6 },
      { t: 'b', w: 0.09, h: 0.2, d: 0.09, rad: 0.03, p: [-0.19, 1.22, 0.03], rot: [0, 0, 0.25], c: '#ffffff' },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.8, p: [0.1, 0.85, 0], rot: [0, 0, -0.2], c: '#ffd35e', seg: 6 },
      { t: 'b', w: 0.09, h: 0.2, d: 0.09, rad: 0.03, p: [0.18, 1.22, 0.03], rot: [0, 0, -0.2], c: '#ffffff' },
      ...face(ell(0.29, 50, 0.29), 0.3, 0.11, 0.045),
    ],
  },
  blocks: {
    name: 'Toy Blocks',
    parts: () => {
      const B = [[-0.34, 0.31, 0, 0.2, '#ff8fa8'], [0.34, 0.31, 0.05, -0.15, '#8fd3ff'], [0, 0.93, 0, 0.45, '#ffe27a']];
      const P = [];
      B.forEach(([x, y, z, ry, c], i) => {
        P.push({ t: 'b', w: 0.62, h: 0.62, d: 0.62, rad: 0.08, p: [x, y, z], rot: [0, ry, 0], c });
        P.push({ t: i === 2 ? 'heart' : 'star', R: 0.15, k: 0.36, depth: 0.03, bevel: 0.02, p: front(x, y, z, ry, 0.32), rot: [0, ry, 0], c: '#ffffff' });
      });
      return P;
    },
  },
  ball: {
    name: 'Beach Ball',
    round: true,
    parts: () => [
      { t: 's', r: 0.5, p: [0, 0.5, 0], seg: 20, c: '#ffffff' },
      { t: 't', R: 0.5, r: 0.1, p: [0, 0.5, 0], seg: 28, c: '#ff7a8a' },
      { t: 't', R: 0.5, r: 0.1, p: [0, 0.5, 0], rot: [0, Math.PI / 3, 0], seg: 28, c: '#ffe27a' },
      { t: 't', R: 0.5, r: 0.1, p: [0, 0.5, 0], rot: [0, -Math.PI / 3, 0], seg: 28, c: '#8fd3ff' },
      { t: 's', r: 0.1, p: [0, 1.0, 0], sc: [1, 0.4, 1], c: '#ff7a8a' },
      ...face(ell(0.5, 0.5, 0.5, 0, 0.5, 0), 0.48, 0.17, 0.055),
    ],
  },
  rocket: {
    name: 'Toy Rocket',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.3, rb: 0.34, h: 1.0, p: [0, 0.75, 0], c: '#f3f0ff' },
      { t: 'k', r: 0.31, h: 0.45, p: [0, 1.47, 0], c: '#ff7a8a' },
      { t: 'c', rt: 0.34, rb: 0.26, h: 0.2, p: [0, 0.15, 0], c: '#b79cff' },
      ...[Math.PI / 3, Math.PI, (5 * Math.PI) / 3].map((a) => ({ t: 'b', w: 0.08, h: 0.45, d: 0.32, rad: 0.03, p: [Math.sin(a) * 0.36, 0.35, Math.cos(a) * 0.36], rot: [0, a, 0], c: '#ff7a8a' })),
      { t: 'c', rt: 0.14, rb: 0.14, h: 0.06, p: [0, 1.0, 0.31], rot: [Math.PI / 2, 0, 0], c: '#8fd3ff' },
      { t: 't', R: 0.15, r: 0.035, p: [0, 1.0, 0.33], c: '#b79cff' },
      ...face(ell(0.32, 50, 0.32), 0.62, 0.12, 0.045),
    ],
  },
  dino: {
    name: 'Dino',
    parts: () => {
      const g = '#8fe3a0';
      const d = '#6fcf87';
      return [
        { t: 's', r: 0.5, p: [0, 0.55, -0.05], sc: [1, 0.95, 1.1], c: g },
        { t: 's', r: 0.32, p: [0, 0.55, 0.25], sc: [1, 1.1, 0.5], c: '#e8ffd9' },
        { t: 's', r: 0.38, p: [0, 1.25, 0.15], sc: [1, 0.95, 1.05], c: g },
        { t: 's', r: 0.26, p: [0, 1.12, 0.42], sc: [1.1, 0.8, 0.8], c: g },
        { t: 'k', r: 0.22, h: 0.75, p: [0, 0.4, -0.75], rot: [-1.75, 0, 0], c: g },
        { t: 'k', r: 0.1, h: 0.2, p: [0, 1.63, 0.08], c: '#ffb3cf' },
        { t: 'k', r: 0.1, h: 0.2, p: [0, 1.48, -0.22], rot: [-0.6, 0, 0], c: '#ffb3cf' },
        { t: 'k', r: 0.1, h: 0.2, p: [0, 1.0, -0.52], rot: [-1.0, 0, 0], c: '#ffb3cf' },
        { t: 'k', r: 0.1, h: 0.2, p: [0, 0.62, -0.6], rot: [-1.4, 0, 0], c: '#ffb3cf' },
        { t: 's', r: 0.17, p: [-0.28, 0.13, 0.2], sc: [1, 0.8, 1.3], c: d },
        { t: 's', r: 0.17, p: [0.28, 0.13, 0.2], sc: [1, 0.8, 1.3], c: d },
        { t: 's', r: 0.1, p: [-0.38, 0.75, 0.3], sc: [1, 1.4, 1], c: d },
        { t: 's', r: 0.1, p: [0.38, 0.75, 0.3], sc: [1, 1.4, 1], c: d },
        ...face(ell(0.38, 0.36, 0.4, 0, 1.25, 0.15), 1.33, 0.14, 0.05, { mouth: false }),
        { t: 't', R: 0.08, r: 0.016, arc: Math.PI, p: [0, 1.09, 0.63], rot: [0, 0, Math.PI], c: '#2b2540', seg: 10 },
      ];
    },
  },
  robot: {
    name: 'Robot',
    parts: () => [
      { t: 'b', w: 0.8, h: 0.7, d: 0.6, rad: 0.12, p: [0, 0.55, 0], c: '#cfd8f5' },
      { t: 'b', w: 0.5, h: 0.25, d: 0.04, rad: 0.04, p: [0, 0.6, 0.31], c: '#9fd8ff' },
      { t: 's', r: 0.05, p: [-0.12, 0.6, 0.34], c: '#ff8fa8' },
      { t: 's', r: 0.05, p: [0.12, 0.6, 0.34], c: '#ffe27a' },
      { t: 'b', w: 0.75, h: 0.6, d: 0.6, rad: 0.18, p: [0, 1.22, 0], c: '#e4e9ff' },
      { t: 'b', w: 0.58, h: 0.38, d: 0.05, rad: 0.1, p: [0, 1.22, 0.3], c: '#4b4a73' },
      { t: 's', r: 0.06, p: [-0.13, 1.26, 0.33], sc: [1, 1.3, 0.5], c: '#8fffd0' },
      { t: 's', r: 0.06, p: [0.13, 1.26, 0.33], sc: [1, 1.3, 0.5], c: '#8fffd0' },
      { t: 't', R: 0.06, r: 0.014, arc: Math.PI, p: [0, 1.14, 0.33], rot: [0, 0, Math.PI], c: '#8fffd0', seg: 10 },
      { t: 'c', rt: 0.02, rb: 0.02, h: 0.25, p: [0, 1.63, 0], c: '#9a9ab8', seg: 6 },
      { t: 's', r: 0.07, p: [0, 1.78, 0], c: '#ff8fa8' },
      { t: 'b', w: 0.16, h: 0.45, d: 0.16, rad: 0.07, p: [-0.52, 0.55, 0], rot: [0, 0, -0.2], c: '#b9c3ea' },
      { t: 'b', w: 0.16, h: 0.45, d: 0.16, rad: 0.07, p: [0.52, 0.55, 0], rot: [0, 0, 0.2], c: '#b9c3ea' },
      { t: 'b', w: 0.22, h: 0.25, d: 0.3, rad: 0.08, p: [-0.2, 0.12, 0], c: '#9fa9d6' },
      { t: 'b', w: 0.22, h: 0.25, d: 0.3, rad: 0.08, p: [0.2, 0.12, 0], c: '#9fa9d6' },
      { t: 'c', rt: 0.08, rb: 0.08, h: 0.08, p: [-0.41, 1.22, 0], rot: [0, 0, Math.PI / 2], c: '#ffb3cf' },
      { t: 'c', rt: 0.08, rb: 0.08, h: 0.08, p: [0.41, 1.22, 0], rot: [0, 0, Math.PI / 2], c: '#ffb3cf' },
    ],
  },
  croissant: {
    name: 'Croissant',
    parts: () => {
      const P = [];
      const rs = [0.17, 0.23, 0.27, 0.23, 0.17];
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.15 + i * 0.175);
        P.push({ t: 's', r: rs[i], p: [Math.cos(a) * 0.48, rs[i] * 0.9, -Math.sin(a) * 0.48 + 0.2], sc: [1.1, 0.85, 1], rot: [0, -a, 0], c: i % 2 ? '#e9a55c' : '#f2b96e' });
      }
      P.push(...face(ell(0.3, 0.23, 0.27, 0, 0.243, -0.28), 0.27, 0.1, 0.04));
      return P;
    },
  },
  bread: {
    name: 'Bread Loaf',
    parts: () => [
      { t: 'b', w: 1.1, h: 0.42, d: 0.62, rad: 0.16, p: [0, 0.21, 0], c: '#f0b56d' },
      { t: 's', r: 0.55, p: [0, 0.42, 0], sc: [1, 0.5, 0.58], c: '#e9a55c' },
      ...[-0.3, 0, 0.3].map((x) => ({ t: 'b', w: 0.06, h: 0.04, d: 0.42, rad: 0.02, p: [x, 0.685, 0], rot: [0, 0.5, 0], c: '#c9844a' })),
      ...face(flat(0.32), 0.22, 0.17, 0.05),
    ],
  },
  cake: {
    name: 'Layer Cake',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.62, rb: 0.62, h: 0.08, p: [0, 0.04, 0], c: '#ffffff' },
      { t: 'c', rt: 0.5, rb: 0.5, h: 0.35, p: [0, 0.255, 0], c: '#ffd0e4' },
      { t: 'c', rt: 0.51, rb: 0.51, h: 0.07, p: [0, 0.45, 0], c: '#fff6e8' },
      { t: 'c', rt: 0.5, rb: 0.5, h: 0.3, p: [0, 0.63, 0], c: '#ffd0e4' },
      { t: 't', R: 0.46, r: 0.06, p: [0, 0.78, 0], rot: [Math.PI / 2, 0, 0], c: '#fff6e8', seg: 24 },
      { t: 's', r: 0.1, p: [0, 0.86, 0], c: '#ff5c7a' },
      { t: 'c', rt: 0.03, rb: 0.03, h: 0.22, p: [-0.24, 0.89, 0.05], c: '#8fd3ff', seg: 6 },
      { t: 'c', rt: 0.03, rb: 0.03, h: 0.22, p: [0.24, 0.89, 0.05], c: '#b6f0c8', seg: 6 },
      { t: 's', r: 0.04, p: [-0.24, 1.03, 0.05], sc: [1, 1.5, 1], c: '#ffd35e', seg: 8 },
      { t: 's', r: 0.04, p: [0.24, 1.03, 0.05], sc: [1, 1.5, 1], c: '#ffd35e', seg: 8 },
      ...face(ell(0.5, 50, 0.5), 0.27, 0.14, 0.045),
    ],
  },
  macarons: {
    name: 'Macarons',
    round: true,
    parts: () => {
      const P = [];
      ['#ffb3cf', '#b6f0c8', '#d9c7ff'].forEach((c, i) => {
        const y = i * 0.3;
        const x = [0, 0.06, -0.04][i];
        P.push({ t: 's', r: 0.38, p: [x, y + 0.08, 0], sc: [1, 0.32, 1], c });
        P.push({ t: 'c', rt: 0.33, rb: 0.33, h: 0.08, p: [x, y + 0.15, 0], c: '#fff6e8' });
        P.push({ t: 's', r: 0.38, p: [x, y + 0.22, 0], sc: [1, 0.32, 1], c });
      });
      P.push(...shift(face(flat(0.37), 0.52, 0.12, 0.04, { blush: false }), 0.06));
      return P;
    },
  },
  ukulele: {
    name: 'Ukulele',
    wall: true,
    parts: () => [
      { t: 's', r: 0.42, p: [0, -0.35, 0], sc: [1, 1, 0.3], c: '#f3b979' },
      { t: 's', r: 0.32, p: [0, 0.15, 0], sc: [1, 1, 0.3], c: '#f3b979' },
      { t: 'c', rt: 0.13, rb: 0.13, h: 0.04, p: [0, -0.12, 0.11], rot: [Math.PI / 2, 0, 0], c: '#5a3a2a' },
      { t: 'b', w: 0.14, h: 0.85, d: 0.08, rad: 0.03, p: [0, 0.75, 0.05], c: '#a0673f' },
      { t: 'b', w: 0.22, h: 0.25, d: 0.1, rad: 0.05, p: [0, 1.25, 0.03], c: '#8a5434' },
      { t: 'b', w: 0.28, h: 0.06, d: 0.06, rad: 0.02, p: [0, -0.55, 0.12], c: '#8a5434' },
      { t: 'heart', k: 0.22, depth: 0.03, bevel: 0.02, p: [0.22, -0.5, 0.12], c: '#ff8fb5' },
    ],
  },
  headphones: {
    name: 'Headphones',
    parts: () => [
      { t: 't', R: 0.42, r: 0.06, arc: Math.PI, p: [0, 0.38, 0], c: '#ff9fbd' },
      { t: 'c', rt: 0.21, rb: 0.21, h: 0.2, p: [-0.44, 0.24, 0], rot: [0, 0, Math.PI / 2], c: '#fff0f6' },
      { t: 'c', rt: 0.21, rb: 0.21, h: 0.2, p: [0.44, 0.24, 0], rot: [0, 0, Math.PI / 2], c: '#fff0f6' },
      { t: 'c', rt: 0.15, rb: 0.15, h: 0.22, p: [-0.44, 0.24, 0], rot: [0, 0, Math.PI / 2], c: '#ff9fbd' },
      { t: 'c', rt: 0.15, rb: 0.15, h: 0.22, p: [0.44, 0.24, 0], rot: [0, 0, Math.PI / 2], c: '#ff9fbd' },
      { t: 'k', r: 0.1, h: 0.18, p: [-0.22, 0.8, 0], rot: [0, 0, 0.4], c: '#ff9fbd' },
      { t: 'k', r: 0.1, h: 0.18, p: [0.22, 0.8, 0], rot: [0, 0, -0.4], c: '#ff9fbd' },
    ],
  },
  snowman: {
    name: 'Snowman',
    round: true,
    parts: () => [
      { t: 's', r: 0.48, p: [0, 0.45, 0], c: '#ffffff' },
      { t: 's', r: 0.36, p: [0, 1.12, 0], c: '#ffffff' },
      { t: 't', R: 0.3, r: 0.08, p: [0, 0.86, 0], rot: [Math.PI / 2, 0, 0], c: '#ff7a8a' },
      { t: 'b', w: 0.14, h: 0.4, d: 0.06, rad: 0.03, p: [0.2, 0.65, 0.33], rot: [0.3, 0, 0.2], c: '#ff7a8a' },
      { t: 'k', r: 0.06, h: 0.3, p: [0, 1.08, 0.45], rot: [Math.PI / 2, 0, 0], c: '#ffa04d', seg: 8 },
      { t: 'c', rt: 0.22, rb: 0.22, h: 0.32, p: [0, 1.6, 0], c: '#5b5a86' },
      { t: 'c', rt: 0.34, rb: 0.34, h: 0.05, p: [0, 1.45, 0], c: '#5b5a86' },
      { t: 'c', rt: 0.225, rb: 0.225, h: 0.07, p: [0, 1.52, 0], c: '#ff8fb5' },
      { t: 's', r: 0.05, p: [0, 0.55, 0.47], c: '#5b5a86', seg: 8 },
      { t: 's', r: 0.05, p: [0, 0.35, 0.46], c: '#5b5a86', seg: 8 },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.5, p: [0.6, 0.75, 0], rot: [0, 0, -1.0], c: '#8a5434', seg: 6 },
      { t: 'c', rt: 0.025, rb: 0.025, h: 0.5, p: [-0.6, 0.75, 0], rot: [0, 0, 1.0], c: '#8a5434', seg: 6 },
      ...face(ell(0.36, 0.36, 0.36, 0, 1.12, 0), 1.2, 0.13, 0.05, { mouth: false }),
    ],
  },
  xtree: {
    name: 'Holiday Tree',
    round: true,
    parts: () => {
      const P = [
        { t: 'c', rt: 0.3, rb: 0.25, h: 0.3, p: [0, 0.15, 0], c: '#ff8fa8' },
        { t: 'c', rt: 0.08, rb: 0.08, h: 0.25, p: [0, 0.4, 0], c: '#8a5434' },
        { t: 'k', r: 0.62, h: 0.7, p: [0, 0.8, 0], c: '#5fc68a' },
        { t: 'k', r: 0.5, h: 0.6, p: [0, 1.2, 0], c: '#6fcf97' },
        { t: 'k', r: 0.36, h: 0.5, p: [0, 1.58, 0], c: '#7fd6a0' },
        { t: 'star', R: 0.16, depth: 0.06, bevel: 0.04, p: [0, 1.92, 0], c: '#ffe27a' },
      ];
      const orn = [[0.6, -0.7, '#ff7a8a'], [0.6, 0.9, '#8fd3ff'], [0.62, 2.3, '#ffe27a'], [1.0, 0.1, '#ffb3cf'], [1.05, 1.9, '#d9c7ff'], [1.4, -0.4, '#ff7a8a']];
      orn.forEach(([y, a, c]) => {
        const base = y < 0.95 ? [0.45, 0.62, 0.7] : y < 1.35 ? [0.9, 0.5, 0.6] : [1.33, 0.36, 0.5];
        const r = base[1] * (1 - (y - base[0]) / base[2]) + 0.03;
        P.push({ t: 's', r: 0.06, p: [Math.sin(a) * r, y, Math.cos(a) * r], c, seg: 8 });
      });
      P.push(...face(flat(0.3), 1.1, 0.1, 0.04));
      return P;
    },
  },
  stocking: {
    name: 'Stocking',
    wall: true,
    parts: () => [
      { t: 'b', w: 0.45, h: 0.75, d: 0.18, rad: 0.12, p: [0, 0, 0], c: '#ff6b81' },
      { t: 's', r: 0.3, p: [0.15, -0.42, 0], sc: [1.2, 0.8, 0.32], c: '#ff6b81' },
      { t: 's', r: 0.14, p: [0.36, -0.45, 0.02], sc: [1, 1, 0.45], c: '#ffffff' },
      { t: 'b', w: 0.56, h: 0.22, d: 0.22, rad: 0.1, p: [0, 0.42, 0], c: '#ffffff' },
      { t: 'star', R: 0.12, depth: 0.04, bevel: 0.03, p: [0, 0.02, 0.1], c: '#ffe27a' },
    ],
  },
  cocoa: {
    name: 'Hot Cocoa',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.4, rb: 0.36, h: 0.62, p: [0, 0.31, 0], c: '#a8d8ff' },
      { t: 'c', rt: 0.36, rb: 0.36, h: 0.02, p: [0, 0.62, 0], c: '#8a5a3c' },
      { t: 's', r: 0.3, p: [0, 0.66, 0], sc: [1, 0.4, 1], c: '#fffaf3' },
      { t: 'b', w: 0.12, h: 0.12, d: 0.12, rad: 0.04, p: [-0.12, 0.8, 0.05], rot: [0.3, 0.4, 0], c: '#ffd0e4' },
      { t: 'b', w: 0.12, h: 0.12, d: 0.12, rad: 0.04, p: [0.1, 0.82, -0.05], rot: [0.1, 0.9, 0.3], c: '#ffffff' },
      { t: 't', R: 0.18, r: 0.055, p: [0.44, 0.33, 0], c: '#a8d8ff', seg: 16 },
      ...face(ell(0.4, 50, 0.4), 0.32, 0.14, 0.05),
    ],
  },
  globe: {
    name: 'Globe',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.25, rb: 0.32, h: 0.12, p: [0, 0.06, 0], c: '#e8b98a' },
      { t: 'c', rt: 0.04, rb: 0.04, h: 0.3, p: [0, 0.25, 0], c: '#e8b98a', seg: 6 },
      { t: 't', R: 0.5, r: 0.03, arc: Math.PI * 1.25, p: [0, 0.85, 0], rot: [0, Math.PI / 2, -1.2], c: '#d9a273' },
      { t: 's', r: 0.42, p: [0, 0.85, 0], seg: 20, c: '#8fd3ff' },
      ...[[0.5, 0.3, 0.8], [-0.6, 0.5, 0.5], [0.2, -0.5, 0.8], [-0.3, -0.2, -0.9], [0.8, 0.2, -0.4]].map(([x, y, z]) => {
        const l = Math.hypot(x, y, z);
        return { t: 's', r: 0.15, p: [(x / l) * 0.34, 0.85 + (y / l) * 0.34, (z / l) * 0.34], c: '#8fe3a0', seg: 10 };
      }),
      ...face(ell(0.42, 0.42, 0.42, 0, 0.85, 0), 0.9, 0.14, 0.05),
    ],
  },
  radio: {
    name: 'Radio',
    parts: () => [
      { t: 'b', w: 1.1, h: 0.7, d: 0.42, rad: 0.15, p: [0, 0.35, 0], c: '#a8e6cf' },
      { t: 'c', rt: 0.22, rb: 0.22, h: 0.06, p: [-0.25, 0.36, 0.21], rot: [Math.PI / 2, 0, 0], c: '#fff3df' },
      { t: 'b', w: 0.32, h: 0.14, d: 0.05, rad: 0.03, p: [0.25, 0.47, 0.21], c: '#fffaf0' },
      { t: 's', r: 0.06, p: [0.17, 0.23, 0.22], c: '#ff8fa8', seg: 8 },
      { t: 's', r: 0.06, p: [0.35, 0.23, 0.22], c: '#ffe27a', seg: 8 },
      { t: 't', R: 0.32, r: 0.04, arc: Math.PI, p: [0, 0.68, 0], c: '#7fd6b0' },
      { t: 'c', rt: 0.015, rb: 0.015, h: 0.6, p: [0.45, 0.95, -0.1], rot: [0, 0, -0.4], c: '#9a9ab8', seg: 6 },
      ...shift(face(flat(0.25), 0.38, 0.08, 0.035), -0.25),
    ],
  },
  mirror: {
    name: 'Mirror',
    wall: true,
    parts: () => [
      { t: 'c', rt: 0.62, rb: 0.62, h: 0.1, p: [0, 0, 0], rot: [Math.PI / 2, 0, 0], c: '#bfe6ff', seg: 28 },
      { t: 't', R: 0.62, r: 0.07, p: [0, 0, 0.03], seg: 28, c: '#ffb3cf' },
      { t: 'b', w: 0.5, h: 0.06, d: 0.02, rad: 0.02, p: [-0.15, 0.2, 0.06], rot: [0, 0, 0.8], c: '#eaf7ff' },
      { t: 'b', w: 0.25, h: 0.06, d: 0.02, rad: 0.02, p: [0.05, 0.3, 0.06], rot: [0, 0, 0.8], c: '#eaf7ff' },
      { t: 's', r: 0.1, p: [-0.12, 0.68, 0.05], sc: [1.3, 0.8, 0.6], rot: [0, 0, 0.5], c: '#ff8fb5' },
      { t: 's', r: 0.1, p: [0.12, 0.68, 0.05], sc: [1.3, 0.8, 0.6], rot: [0, 0, -0.5], c: '#ff8fb5' },
      { t: 's', r: 0.06, p: [0, 0.66, 0.08], c: '#ff6f9c' },
    ],
  },
  garland: {
    name: 'Bunting',
    wall: true,
    parts: () => {
      const P = [];
      const cols = ['#ff8fb5', '#ffe27a', '#8fd3ff', '#b6f0c8', '#d9c7ff'];
      const pts = [];
      for (let i = 0; i <= 6; i++) {
        const x = -1.35 + i * 0.45;
        pts.push([x, 0.14 * x * x - 0.1, 0]);
      }
      for (let i = 0; i < 6; i++) P.push(rodBetween(pts[i], pts[i + 1], 0.018, '#c98c52'));
      for (let i = 1; i < 6; i++) {
        const [x, y] = pts[i];
        P.push({ t: 'k', r: 0.2, h: 0.38, seg: 3, p: [x, y - 0.21, 0], rot: [Math.PI, 0, 0], sc: [1, 1, 0.3], c: cols[i - 1] });
        P.push({ t: 's', r: 0.035, p: [x, y, 0.03], c: '#ffffff', seg: 6 });
      }
      return P;
    },
  },
  basket: {
    name: 'Flower Basket',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.48, rb: 0.38, h: 0.45, p: [0, 0.225, 0], c: '#e0a96d' },
      { t: 't', R: 0.44, r: 0.035, p: [0, 0.14, 0], rot: [Math.PI / 2, 0, 0], c: '#c98c52' },
      { t: 't', R: 0.47, r: 0.035, p: [0, 0.32, 0], rot: [Math.PI / 2, 0, 0], c: '#c98c52' },
      { t: 't', R: 0.42, r: 0.04, arc: Math.PI, p: [0, 0.45, 0], c: '#c98c52' },
      ...[[-0.22, 0.55, 0.1, '#ff8fb5'], [0.18, 0.56, 0.15, '#ffe27a'], [0, 0.6, -0.15, '#d9c7ff'], [0.25, 0.52, -0.2, '#ffffff'], [-0.2, 0.5, -0.2, '#ff9f7a']].map(([x, y, z, c]) => ({ t: 's', r: 0.14, p: [x, y, z], c, seg: 10 })),
      ...face(ell(0.44, 50, 0.44), 0.22, 0.13, 0.045),
    ],
  },
  jar: {
    name: 'Candy Jar',
    round: true,
    parts: () => [
      { t: 'c', rt: 0.36, rb: 0.38, h: 0.65, p: [0, 0.33, 0], c: '#d6f0ff' },
      { t: 'c', rt: 0.3, rb: 0.3, h: 0.1, p: [0, 0.7, 0], c: '#ffb3cf' },
      { t: 's', r: 0.08, p: [0, 0.8, 0], c: '#ff8fb5' },
      ...[[-0.18, 0.15, '#ff8fb5'], [0.15, 0.2, '#ffe27a'], [0.0, 0.5, '#b6f0c8'], [-0.2, 0.52, '#d9c7ff'], [0.22, 0.48, '#ff9f7a']].map(([x, y, c]) => ({ t: 's', r: 0.08, p: [x, y, 0.33], sc: [1, 1, 0.5], c, seg: 8 })),
      { t: 'b', w: 0.36, h: 0.2, d: 0.04, rad: 0.05, p: [0, 0.33, 0.36], c: '#ffffff' },
      { t: 'heart', k: 0.16, depth: 0.03, bevel: 0.02, p: [0, 0.34, 0.39], c: '#ff8fb5' },
    ],
  },
  ginger: {
    name: 'Gingerbread',
    parts: () => {
      const c = '#d08a4f';
      return [
        { t: 's', r: 0.26, p: [0, 1.0, 0], sc: [1, 1, 0.45], c },
        { t: 'b', w: 0.5, h: 0.5, d: 0.22, rad: 0.1, p: [0, 0.55, 0], c },
        { t: 'b', w: 0.18, h: 0.42, d: 0.2, rad: 0.08, p: [-0.38, 0.68, 0], rot: [0, 0, 1.0], c },
        { t: 'b', w: 0.18, h: 0.42, d: 0.2, rad: 0.08, p: [0.38, 0.68, 0], rot: [0, 0, -1.0], c },
        { t: 'b', w: 0.2, h: 0.4, d: 0.2, rad: 0.09, p: [-0.15, 0.2, 0], rot: [0, 0, 0.15], c },
        { t: 'b', w: 0.2, h: 0.4, d: 0.2, rad: 0.09, p: [0.15, 0.2, 0], rot: [0, 0, -0.15], c },
        { t: 's', r: 0.045, p: [0, 0.65, 0.11], c: '#ff8fb5', seg: 8 },
        { t: 's', r: 0.045, p: [0, 0.48, 0.11], c: '#8fd3ff', seg: 8 },
        { t: 'b', w: 0.3, h: 0.05, d: 0.03, rad: 0.02, p: [-0.4, 0.68, 0.11], rot: [0, 0, 1.0], c: '#ffffff' },
        { t: 'b', w: 0.3, h: 0.05, d: 0.03, rad: 0.02, p: [0.4, 0.68, 0.11], rot: [0, 0, -1.0], c: '#ffffff' },
        ...face(flat(0.12), 1.02, 0.09, 0.035),
      ];
    },
  },
};

export const ITEM_SCALE = 0.9;

// ---------------------------------------------------------------------------
// Built (cached) item types: geometry, outline, collider description
// ---------------------------------------------------------------------------
const cache = new Map();

export function getItemType(id) {
  let t = cache.get(id);
  if (t) return t;
  const def = ITEM_DEFS[id];
  if (!def) throw new Error('Unknown item ' + id);
  // (geometry detail follows setDetail(); call it before the first build)
  const sc = def.scale ?? ITEM_SCALE;
  let geo = mergeParts(def.parts());
  geo.scale(sc, sc, sc);
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  const center = bb.getCenter(new THREE.Vector3());
  geo.translate(-center.x, def.wall ? -center.y : -center.y, -center.z);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const size = geo.boundingBox.getSize(new THREE.Vector3());
  const outline = buildOutlineGeo(geo);
  const half = size.clone().multiplyScalar(0.5);
  t = {
    id,
    name: def.name,
    geo,
    outline,
    wall: !!def.wall,
    round: !!def.round,
    size,
    half,
    radius: geo.boundingSphere.radius,
    // collider (slightly smaller than visuals so items nest cutely)
    col: def.wall
      ? { kind: 'box', hx: half.x * 0.96, hy: half.y * 0.96, hz: Math.max(half.z * 0.9, 0.08) }
      : def.round
        ? { kind: 'cyl', hh: half.y * 0.94, r: Math.max(Math.min(half.x, half.z) * 0.92, 0.1) }
        : { kind: 'box', hx: half.x * 0.93, hy: half.y * 0.94, hz: half.z * 0.93 },
  };
  cache.set(id, t);
  return t;
}
