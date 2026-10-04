import * as THREE from 'three';
import { mergeParts } from './items.js';
import { makeMat, patternTexture, blobTexture, shared } from './materials.js';

// Room box:  x in [-4.5, 4.5], z in [-3.5, 3.5], floor top at y = 0, walls: back (z=-3.5) + left (x=-4.5).
export const ROOM = { x0: -4.5, x1: 4.5, z0: -3.5, z1: 3.5, h: 5.6 };

const W = { // wall-mounted part helper: returns a box part on 'back' or 'left' wall
  box(wall, u, y, w, h, depth, off, c, rad) {
    return wall === 'back'
      ? { t: 'b', w, h, d: depth, rad, p: [u, y, ROOM.z0 + off + depth / 2], c }
      : { t: 'b', w: depth, h, d: w, rad, p: [ROOM.x0 + off + depth / 2, y, u], c };
  },
  ball(wall, u, y, r, depth, off, c) {
    return wall === 'back'
      ? { t: 's', r, p: [u, y, ROOM.z0 + off], sc: [1, 1, depth], c }
      : { t: 's', r, p: [ROOM.x0 + off, y, u], sc: [depth, 1, 1], c };
  },
};

function windowParts(wall, u, y, w, h, o = {}) {
  const P = [];
  const sky = o.sky || ['#9fd8ff', '#d9f1ff'];
  P.push(W.box(wall, u, y, w + 0.5, h + 0.5, 0.2, 0, o.frame || '#ffffff', 0.08));
  P.push(W.box(wall, u, y + h * 0.25, w, h * 0.5 - 0.005, 0.1, 0.135, sky[0], 0.02));
  P.push(W.box(wall, u, y - h * 0.25, w, h * 0.5 - 0.005, 0.1, 0.135, sky[1], 0.02));
  P.push(W.ball(wall, u + w * 0.22, y + h * 0.18, 0.28, 0.2, 0.25, o.sun || '#ffe27a'));
  P.push(W.ball(wall, u - w * 0.18, y - h * 0.12, 0.2, 0.2, 0.25, '#ffffff'));
  P.push(W.ball(wall, u - w * 0.05, y - h * 0.16, 0.26, 0.2, 0.255, '#ffffff'));
  P.push(W.box(wall, u, y, 0.1, h, 0.1, 0.17, o.frame || '#ffffff', 0.02));
  P.push(W.box(wall, u, y, w, 0.1, 0.09, 0.175, o.frame || '#ffffff', 0.02));
  P.push(W.box(wall, u, y - h / 2 - 0.2, w + 0.8, 0.14, 0.45, 0, o.frame || '#ffffff', 0.05));
  if (o.curtain) {
    const cw = w * 0.32;
    P.push(W.box(wall, u - w / 2 - 0.1, y + 0.05, cw, h + 0.7, 0.2, 0.18, o.curtain, 0.1));
    P.push(W.box(wall, u + w / 2 + 0.1, y + 0.05, cw, h + 0.7, 0.2, 0.18, o.curtain, 0.1));
    P.push(W.box(wall, u, y + h / 2 + 0.38, w + 1.1, 0.1, 0.1, 0.2, '#d9a273', 0.04));
  }
  return P;
}

// ---------------------------------------------------------------------------
// Room specs. blocks: furniture (visual + collider). slot: {t,x,z,y|on} floor/furniture, {t,wall,u,yc} wall.
// ---------------------------------------------------------------------------
const BASE_ROOMS = [
  {
    id: 'bedroom',
    name: 'Dreamy Bedroom',
    emoji: '🛏️',
    bg: ['#ffc9e3', '#fff1e6'],
    sky: '#fff4fa',
    ground: '#e8c3dc',
    wall: { style: 'stars', a: '#ffd3e3', b: '#fff0f6' },
    floor: { style: 'wood', a: '#f3cfa8', b: '#e9bf94' },
    base: '#d89aa8',
    trim: '#ffffff',
    box: '#f0b98b',
    blocks: [
      { n: 'bed', x: -3.25, z: -1.75, w: 2.5, d: 3.5, h: 0.55, c: '#ecb99a', rad: 0.12 },
      { n: 'mattress', x: -3.25, z: -1.8, w: 2.35, d: 3.35, h: 0.42, y0: 0.55, c: '#fff4e8', rad: 0.16 },
      { n: 'blanket', x: -3.25, z: -0.95, w: 2.4, d: 1.9, h: 0.16, y0: 0.97, c: '#ffb3cf', rad: 0.08 },
      { n: 'headboard', x: -3.2, z: -3.37, w: 2.6, d: 0.24, h: 1.75, c: '#e5a688', rad: 0.1, noAO: true },
      { n: 'nightstand', x: -1.15, z: -2.95, w: 1.3, d: 1.1, h: 1.05, c: '#ffd9c2', rad: 0.1 },
      { n: 'ns-drawer', x: -1.15, z: -2.38, w: 1.0, d: 0.06, h: 0.34, y0: 0.52, c: '#ffb89a', rad: 0.03, solid: false, noAO: true },
      { n: 'dresser', x: 2.5, z: -2.9, w: 3.0, d: 1.2, h: 1.3, c: '#ffe0cf', rad: 0.12 },
      { n: 'dr-d1', x: 1.8, z: -2.28, w: 1.2, d: 0.06, h: 0.42, y0: 0.7, c: '#ffc2a4', rad: 0.03, solid: false, noAO: true },
      { n: 'dr-d2', x: 3.2, z: -2.28, w: 1.2, d: 0.06, h: 0.42, y0: 0.7, c: '#ffc2a4', rad: 0.03, solid: false, noAO: true },
      { n: 'shelf', x: 2.5, z: -3.2, w: 2.8, d: 0.6, h: 0.14, y0: 2.85, c: '#e5a688', rad: 0.05, noAO: true },
    ],
    rug: { x: 0.4, z: 1.35, r: 1.9, c: '#ffc4dc', c2: '#fff0f6' },
    deco: () => [
      ...windowParts('left', -1.75, 3.35, 2.1, 1.7, { curtain: '#ffb3cf' }),
      { t: 'k', r: 0.1, h: 0.35, p: [-4.2, 3.05, -3.38], c: '#ffffff' },
    ],
    stages: [
      [
        { t: 'pillow', x: -3.25, z: -2.8, y: 0.97, ry: 0 },
        { t: 'teddy', x: -3.2, z: -1.2, y: 1.13, ry: 0.5 },
        { t: 'lamp', x: -1.5, z: -2.95, y: 1.05, ry: 0 },
        { t: 'alarm', x: -0.85, z: -2.7, y: 1.05, ry: 0.3 },
        { t: 'cactus', x: 1.5, z: -2.9, y: 1.3, ry: 0.3 },
      ],
      [
        { t: 'frame', wall: 'back', u: -1.15, yc: 3.1 },
        { t: 'clock', wall: 'back', u: 0.35, yc: 3.8 },
        { t: 'books', x: 1.7, z: -3.2, y: 2.99, ry: 0.1 },
        { t: 'mushroom', x: 3.3, z: -2.9, y: 1.3, ry: -0.2 },
        { t: 'kitty', x: 0.3, z: 1.3, y: 0, ry: 0.5 },
        { t: 'yarn', x: -1.0, z: 1.9, y: 0, ry: 0 },
      ],
      [
        { t: 'rainbow', wall: 'back', u: 2.5, yc: 4.45 },
        { t: 'star', wall: 'left', u: 1.7, yc: 3.4 },
        { t: 'moon', wall: 'left', u: 2.9, yc: 4.4 },
        { t: 'candle', x: 3.1, z: -3.2, y: 2.99, ry: 0 },
        { t: 'gift', x: -2.3, z: 1.2, y: 0, ry: 0.3 },
        { t: 'bunny', x: 1.6, z: 1.7, y: 0, ry: 0.4 },
        { t: 'heart', x: -3.5, z: -0.1, y: 1.13, ry: 0.7 },
      ],
    ],
  },
  {
    id: 'cafe',
    name: 'Sweet Café',
    emoji: '🧁',
    bg: ['#bff0d9', '#fff6d6'],
    sky: '#fbfff6',
    ground: '#d4e8c8',
    wall: { style: 'gingham', a: '#d6f5e6', b: '#a8e6cf' },
    floor: { style: 'tiles', a: '#fff3df', b: '#ffd9c2' },
    base: '#7fc9a8',
    trim: '#ffffff',
    box: '#f0b98b',
    blocks: [
      { n: 'counter', x: -1.9, z: -2.95, w: 5.4, d: 1.1, h: 1.4, c: '#ffe9c9', rad: 0.12 },
      { n: 'ct-top', x: -1.9, z: -2.9, w: 5.6, d: 1.3, h: 0.12, y0: 1.4, c: '#8fd9bb', rad: 0.05, noAO: true },
      { n: 'ct-d1', x: -3.7, z: -2.38, w: 1.5, d: 0.06, h: 0.9, y0: 0.2, c: '#ffd5a1', rad: 0.03, solid: false, noAO: true },
      { n: 'ct-d2', x: -1.9, z: -2.38, w: 1.5, d: 0.06, h: 0.9, y0: 0.2, c: '#ffd5a1', rad: 0.03, solid: false, noAO: true },
      { n: 'ct-d3', x: -0.1, z: -2.38, w: 1.5, d: 0.06, h: 0.9, y0: 0.2, c: '#ffd5a1', rad: 0.03, solid: false, noAO: true },
      { n: 'shelfA', x: -3.0, z: -3.2, w: 2.4, d: 0.6, h: 0.14, y0: 3.0, c: '#e8b98a', rad: 0.05, noAO: true },
      { n: 'shelfB', x: 0.1, z: -3.2, w: 2.0, d: 0.6, h: 0.14, y0: 3.0, c: '#e8b98a', rad: 0.05, noAO: true },
      { n: 'table', x: 3.0, z: -1.6, cyl: 0.95, h: 1.15, c: '#fff6ea', rad: 0.05 },
      { n: 'tbl-leg', x: 3.0, z: -1.6, cyl: 0.18, h: 1.0, c: '#f1c9a0', solid: false, noAO: true },
      { n: 'stool', x: 3.4, z: 0.2, cyl: 0.5, h: 0.75, c: '#ffb3c7', rad: 0.05 },
    ],
    rug: { x: 0.3, z: 1.45, r: 1.8, c: '#ffe08a', c2: '#fff6d6' },
    deco: () => [
      ...windowParts('back', 2.9, 3.5, 2.0, 1.7, { curtain: '#ffd0a8' }),
      ...windowParts('left', 0.6, 3.3, 1.8, 1.6, { curtain: '#a8e6cf' }),
      // espresso-ish menu board
      W.box('left', 2.8, 2.7, 1.3, 1.6, 0.1, 0, '#4b4a73', 0.05),
      W.box('left', 2.8, 2.7, 1.1, 1.4, 0.05, 0.1, '#5b5a86', 0.03),
    ],
    stages: [
      [
        { t: 'teapot', x: -3.6, z: -2.9, y: 1.52, ry: 0.3 },
        { t: 'mug', x: -2.4, z: -2.8, y: 1.52, ry: 0.4 },
        { t: 'cupcake', x: 2.7, z: -1.6, y: 1.15, ry: 0.2 },
        { t: 'toaster', x: -0.9, z: -2.9, y: 1.52, ry: 0.15 },
        { t: 'strawberry', x: 0.2, z: -2.8, y: 1.52, ry: 0 },
      ],
      [
        { t: 'boba', x: 3.5, z: -1.4, y: 1.15, ry: 0 },
        { t: 'donut', x: -1.6, z: -2.7, y: 1.52, ry: 0.5 },
        { t: 'clock', wall: 'left', u: 1.4, yc: 4.4 },
        { t: 'succulent', x: -3.3, z: -3.2, y: 3.14, ry: 0.2 },
        { t: 'books', x: -2.5, z: -3.2, y: 3.14, ry: 0.1 },
        { t: 'duck', x: 3.4, z: 0.2, y: 0.75, ry: 0.4 },
      ],
      [
        { t: 'vase', x: 2.5, z: -1.9, y: 1.15, ry: 0 },
        { t: 'frame', wall: 'back', u: -0.2, yc: 4.4 },
        { t: 'cloud', wall: 'back', u: -2.6, yc: 4.6 },
        { t: 'candle', x: 0.5, z: -3.2, y: 3.14, ry: 0 },
        { t: 'kitty', x: 0.4, z: 1.2, y: 0, ry: 0.5 },
        { t: 'gift', x: -2.2, z: 1.4, y: 0, ry: 0.3 },
        { t: 'piggy', x: -0.2, z: 3.0, y: 0, ry: 0.7 },
      ],
    ],
  },
  {
    id: 'study',
    name: 'Cozy Study',
    emoji: '📚',
    bg: ['#d4c6ff', '#e6f3ff'],
    sky: '#f6f4ff',
    ground: '#cfc6ee',
    wall: { style: 'dots', a: '#dcd3ff', b: '#f3efff' },
    floor: { style: 'carpet', a: '#b9c9ff', b: '#a8b9f5' },
    base: '#9d8ce0',
    trim: '#ffffff',
    box: '#f0b98b',
    blocks: [
      { n: 'desk', x: 0.6, z: -2.95, w: 4.4, d: 1.2, h: 0.14, y0: 1.3, c: '#f3d6b3', rad: 0.06 },
      { n: 'desk-l1', x: -1.3, z: -2.95, w: 0.3, d: 1.1, h: 1.3, c: '#e0b98c', rad: 0.06 },
      { n: 'desk-l2', x: 2.5, z: -2.95, w: 0.3, d: 1.1, h: 1.3, c: '#e0b98c', rad: 0.06 },
      { n: 'drawers', x: 1.8, z: -2.95, w: 1.2, d: 1.1, h: 1.3, c: '#e8c79c', rad: 0.08 },
      { n: 'dw-1', x: 1.8, z: -2.38, w: 1.0, d: 0.06, h: 0.4, y0: 0.7, c: '#cf9f72', rad: 0.03, solid: false, noAO: true },
      { n: 'dw-2', x: 1.8, z: -2.38, w: 1.0, d: 0.06, h: 0.4, y0: 0.2, c: '#cf9f72', rad: 0.03, solid: false, noAO: true },
      { n: 'bk-back', x: -4.38, z: -1.0, w: 0.12, d: 3.1, h: 4.4, c: '#d9b48a', rad: 0.03, solid: false, noAO: true },
      { n: 'bk-side1', x: -3.55, z: -2.6, w: 1.8, d: 0.14, h: 4.4, c: '#e8c79c', rad: 0.04, noAO: true },
      { n: 'bk-side2', x: -3.55, z: 0.6, w: 1.8, d: 0.14, h: 4.4, c: '#e8c79c', rad: 0.04, noAO: true },
      { n: 'bk-s0', x: -3.55, z: -1.0, w: 1.8, d: 3.2, h: 0.14, y0: 0.0, c: '#e8c79c', rad: 0.04 },
      { n: 'bk-s1', x: -3.55, z: -1.0, w: 1.8, d: 3.2, h: 0.14, y0: 1.5, c: '#e8c79c', rad: 0.04, noAO: true },
      { n: 'bk-s2', x: -3.55, z: -1.0, w: 1.8, d: 3.2, h: 0.14, y0: 2.8, c: '#e8c79c', rad: 0.04, noAO: true },
      { n: 'bk-s3', x: -3.55, z: -1.0, w: 1.8, d: 3.2, h: 0.14, y0: 4.1, c: '#e8c79c', rad: 0.04, noAO: true },
      { n: 'beanbag', x: 2.6, z: 0.7, cyl: 0.85, h: 0.8, c: '#ffb3c7', rad: 0.3 },
    ],
    rug: { x: 0.5, z: 1.5, r: 2.0, c: '#9fb3ff', c2: '#c5d3ff' },
    deco: () => [
      ...windowParts('back', 0.7, 3.9, 2.4, 1.6, { curtain: '#cdb4ff', sky: ['#7fa8ff', '#bcd6ff'] }),
      // books on the shelf (static filler)
      ...[0, 1, 2, 3, 4].map((i) => ({ t: 'b', w: 0.22, h: 0.9 + (i % 2) * 0.15, d: 0.7, rad: 0.04, p: [-3.5, 0.07 + 0.5 + (i % 2) * 0.07, -2.3 + i * 0.28], c: ['#ff9fb5', '#ffe08a', '#8fd3ff', '#b6f0c8', '#d9c7ff'][i] })),
    ],
    stages: [
      [
        { t: 'laptop', x: 0.2, z: -2.85, y: 1.44, ry: 0.15 },
        { t: 'lamp', x: -0.9, z: -3.05, y: 1.44, ry: 0 },
        { t: 'books', x: 2.1, z: -3.0, y: 1.44, ry: -0.1 },
        { t: 'succulent', x: 2.9, z: -2.9, y: 1.44, ry: 0.3 },
        { t: 'pillow', x: 2.6, z: 0.7, y: 0.8, ry: 0.2 },
      ],
      [
        { t: 'penguin', x: -3.4, z: -1.9, y: 1.64, ry: 0.5 },
        { t: 'camera', x: -3.4, z: -0.2, y: 1.64, ry: 0.6 },
        { t: 'mug', x: 1.0, z: -2.8, y: 1.44, ry: 0.5 },
        { t: 'clock', wall: 'back', u: 3.5, yc: 3.8 },
        { t: 'frame', wall: 'back', u: -1.7, yc: 3.8 },
        { t: 'teddy', x: -3.4, z: -1.0, y: 2.94, ry: 0.5 },
      ],
      [
        { t: 'alarm', x: -3.4, z: -2.0, y: 2.94, ry: 0.5 },
        { t: 'gift', x: -3.3, z: 0.0, y: 2.94, ry: 0.4 },
        { t: 'succulent', x: -3.4, z: -1.5, y: 4.24, ry: 0.3 },
        { t: 'cloud', wall: 'left', u: 2.0, yc: 3.4 },
        { t: 'star', wall: 'left', u: 3.0, yc: 4.4 },
        { t: 'kitty', x: 0.4, z: 1.5, y: 0, ry: 0.5 },
        { t: 'heart', x: 1.4, z: 2.2, y: 0, ry: 0.4 },
      ],
    ],
  },
  {
    id: 'garden',
    name: 'Sunny Garden',
    emoji: '🌷',
    bg: ['#b7e8ff', '#e8ffd9'],
    sky: '#f7fff3',
    ground: '#c8e5b8',
    wall: { style: 'clouds', a: '#bfe8ff', b: '#ffffff' },
    floor: { style: 'tiles', a: '#b9e8a8', b: '#a6dc94' },
    base: '#7cc77f',
    trim: '#ffffff',
    box: '#f0b98b',
    blocks: [
      { n: 'planter', x: -1.6, z: -3.0, w: 5.0, d: 1.0, h: 0.9, c: '#f0b98b', rad: 0.1 },
      { n: 'soil', x: -1.6, z: -3.0, w: 4.7, d: 0.8, h: 0.06, y0: 0.9, c: '#8a5a3c', rad: 0.02, noAO: true },
      { n: 'bench', x: 3.2, z: -2.9, w: 2.3, d: 0.9, h: 0.15, y0: 0.9, c: '#ffd9a0', rad: 0.05 },
      { n: 'bench-l1', x: 2.3, z: -2.9, w: 0.2, d: 0.8, h: 0.9, c: '#e8b98a', rad: 0.04 },
      { n: 'bench-l2', x: 4.1, z: -2.9, w: 0.2, d: 0.8, h: 0.9, c: '#e8b98a', rad: 0.04 },
      { n: 'bench-back', x: 3.2, z: -3.35, w: 2.3, d: 0.12, h: 0.8, y0: 1.05, c: '#ffd9a0', rad: 0.05, solid: false, noAO: true },
      { n: 'standA', x: -4.1, z: -0.8, w: 0.7, d: 2.4, h: 0.14, y0: 1.6, c: '#ffd9a0', rad: 0.05, noAO: true },
      { n: 'standB', x: -4.1, z: -0.8, w: 0.7, d: 2.4, h: 0.14, y0: 3.0, c: '#ffd9a0', rad: 0.05, noAO: true },
      { n: 'standS1', x: -4.1, z: -1.9, w: 0.4, d: 0.12, h: 3.1, c: '#e8b98a', rad: 0.03, solid: false, noAO: true },
      { n: 'standS2', x: -4.1, z: 0.3, w: 0.4, d: 0.12, h: 3.1, c: '#e8b98a', rad: 0.03, solid: false, noAO: true },
      { n: 'picnic', x: 2.9, z: 0.4, w: 2.4, d: 1.9, h: 0.1, y0: 0.0, c: '#ff9fb5', rad: 0.04 },
    ],
    rug: null,
    deco: () => [
      ...[0, 1, 2, 3, 4, 5].map((i) => ({ t: 's', r: 0.28 + (i % 3) * 0.05, p: [-3.5 + i * 0.85, 1.05, -3.0 + (i % 2) * 0.1], sc: [1, 0.8, 1], c: ['#6fcf97', '#8fe3b5', '#5fc68a'][i % 3] })),
      ...[0, 1, 2, 3].map((i) => ({ t: 's', r: 0.1, p: [-3.2 + i * 1.2, 1.35, -2.7], c: ['#ff8fb5', '#ffe08a', '#ffffff', '#ff9f7a'][i] })),
      W.box('back', -1.0, 3.8, 2.6, 1.7, 0.08, 0, '#ffffff', 0.05),
    ],
    stages: [
      [
        { t: 'fern', x: -3.0, z: -3.0, y: 0.96, ry: 0.2 },
        { t: 'cactus', x: -1.0, z: -3.0, y: 0.96, ry: 0.3 },
        { t: 'teapot', x: 2.8, z: -2.9, y: 1.05, ry: 0.4 },
        { t: 'bunny', x: 3.6, z: -2.9, y: 1.05, ry: 0.3 },
        { t: 'succulent', x: -4.1, z: -1.3, y: 1.74, ry: 0 },
      ],
      [
        { t: 'vase', x: -2.0, z: -3.0, y: 0.96, ry: 0 },
        { t: 'strawberry', x: 2.6, z: 0.4, y: 0.1, ry: 0.5 },
        { t: 'cupcake', x: 3.4, z: 0.9, y: 0.1, ry: 0.2 },
        { t: 'boba', x: 3.2, z: 0.0, y: 0.1, ry: 0 },
        { t: 'duck', x: -4.1, z: -0.2, y: 1.74, ry: 0.5 },
        { t: 'rainbow', wall: 'back', u: -1.0, yc: 3.9 },
      ],
      [
        { t: 'cloud', wall: 'left', u: 1.6, yc: 4.0 },
        { t: 'kitty', x: -0.8, z: 1.6, y: 0, ry: 0.5 },
        { t: 'candle', x: -4.1, z: -1.2, y: 3.14, ry: 0 },
        { t: 'mushroom', x: 0.9, z: -3.0, y: 0.96, ry: 0.2 },
        { t: 'gift', x: 2.5, z: -0.2, y: 0.1, ry: 0.3 },
        { t: 'star', wall: 'back', u: 1.2, yc: 3.8 },
        { t: 'piggy', x: -4.1, z: -0.2, y: 3.14, ry: 0.4 },
      ],
    ],
  },
];


const MORE_ROOMS = [
  {
    id: 'living',
    name: 'Cozy Living Room',
    emoji: '🛋️',
    bg: ['#ffd8c2', '#fff4e3'],
    sky: '#fff8f0',
    ground: '#ead1c0',
    wall: { style: 'stripes', a: '#ffe8da', b: '#ffdccb' },
    floor: { style: 'wood', a: '#e9c39b', b: '#ddb185' },
    base: '#e7a37e',
    trim: '#ffffff',
    blocks: [
      { n: 'sofa', x: -1.5, z: -2.85, w: 3.6, d: 1.3, h: 0.7, c: '#ff9fb5', rad: 0.2 },
      { n: 'sofa-back', x: -1.5, z: -3.32, w: 3.6, d: 0.36, h: 1.55, c: '#ff8fab', rad: 0.16, noAO: true },
      { n: 'sofa-armL', x: -3.12, z: -2.75, w: 0.36, d: 1.5, h: 1.05, c: '#ff8fab', rad: 0.16, noAO: true },
      { n: 'sofa-armR', x: 0.12, z: -2.75, w: 0.36, d: 1.5, h: 1.05, c: '#ff8fab', rad: 0.16, noAO: true },
      { n: 'cushL', x: -2.2, z: -2.75, w: 1.4, d: 1.1, h: 0.14, y0: 0.7, c: '#ffc2d1', rad: 0.06, noAO: true },
      { n: 'cushR', x: -0.8, z: -2.75, w: 1.4, d: 1.1, h: 0.14, y0: 0.7, c: '#ffc2d1', rad: 0.06, noAO: true },
      { n: 'tvstand', x: 3.0, z: -2.95, w: 2.4, d: 1.0, h: 0.9, c: '#f6e0c4', rad: 0.1 },
      { n: 'tv-d1', x: 2.45, z: -2.43, w: 1.0, d: 0.06, h: 0.4, y0: 0.25, c: '#e9c39b', rad: 0.03, solid: false, noAO: true },
      { n: 'tv-d2', x: 3.55, z: -2.43, w: 1.0, d: 0.06, h: 0.4, y0: 0.25, c: '#e9c39b', rad: 0.03, solid: false, noAO: true },
      { n: 'table', x: -0.9, z: 0.0, w: 2.2, d: 1.1, h: 0.55, c: '#e5b48a', rad: 0.12 },
      { n: 'shelf', x: 3.0, z: -3.2, w: 2.2, d: 0.6, h: 0.14, y0: 3.0, c: '#e5a688', rad: 0.05, noAO: true },
    ],
    rug: { x: -0.6, z: 0.4, r: 2.1, c: '#ffd0a8', c2: '#fff2e4' },
    deco: () => [...windowParts('left', -0.2, 3.4, 2.0, 1.6, { curtain: '#ffb08a' })],
    stages: [
      [
        { t: 'pillow', x: -2.2, z: -2.7, y: 0.84, ry: 0.2 },
        { t: 'tv', x: 3.3, z: -2.95, y: 0.9, ry: -0.1 },
        { t: 'mug', x: -1.5, z: 0.1, y: 0.55, ry: 0.4 },
        { t: 'fern', x: -3.9, z: -1.2, y: 0, ry: 0.3 },
        { t: 'heart', x: -0.6, z: -2.7, y: 0.84, ry: -0.2 },
      ],
      [
        { t: 'frame', wall: 'back', u: -1.5, yc: 3.2 },
        { t: 'clock', wall: 'back', u: 0.9, yc: 3.4 },
        { t: 'books', x: -0.4, z: -0.1, y: 0.55, ry: 0.1 },
        { t: 'kitty', x: 0.9, z: 1.4, y: 0, ry: 0.5 },
        { t: 'radio', x: 2.45, z: -3.2, y: 3.14, ry: 0.1 },
        { t: 'succulent', x: 3.65, z: -3.2, y: 3.14, ry: 0.2 },
      ],
      [
        { t: 'garland', wall: 'back', u: -1.5, yc: 4.7 },
        { t: 'lamp', x: 2.1, z: -2.95, y: 0.9, ry: 0 },
        { t: 'cloud', wall: 'left', u: 2.0, yc: 3.2 },
        { t: 'star', wall: 'left', u: 2.9, yc: 4.5 },
        { t: 'teddy', x: 1.9, z: 1.0, y: 0, ry: 0.4 },
        { t: 'piggy', x: -2.1, z: 1.7, y: 0, ry: 0.6 },
        { t: 'ball', x: 0.5, z: 2.7, y: 0, ry: 0 },
      ],
    ],
  },
  {
    id: 'bath',
    name: 'Bubbly Bathroom',
    emoji: '🛁',
    bg: ['#bfe9ff', '#effaff'],
    sky: '#f4fcff',
    ground: '#c8dfee',
    wall: { style: 'tiles', a: '#eef9ff', b: '#d9f1ff' },
    floor: { style: 'tiles', a: '#ffffff', b: '#d6eeff' },
    base: '#7fbfe6',
    trim: '#ffffff',
    blocks: [
      { n: 'tub', x: -3.35, z: -1.7, w: 2.2, d: 3.4, h: 0.95, c: '#ffffff', rad: 0.3 },
      { n: 'water', x: -3.35, z: -1.7, w: 1.8, d: 3.0, h: 0.04, y0: 0.95, c: '#9fdcff', rad: 0.02, solid: false, noAO: true },
      { n: 'counter', x: 1.2, z: -3.0, w: 2.8, d: 1.0, h: 1.15, c: '#ffd9e6', rad: 0.12 },
      { n: 'ct-d1', x: 0.5, z: -2.48, w: 1.1, d: 0.06, h: 0.6, y0: 0.3, c: '#ffc2d6', rad: 0.03, solid: false, noAO: true },
      { n: 'ct-d2', x: 1.9, z: -2.48, w: 1.1, d: 0.06, h: 0.6, y0: 0.3, c: '#ffc2d6', rad: 0.03, solid: false, noAO: true },
      { n: 'basin', x: 1.2, z: -3.05, cyl: 0.45, h: 0.1, y0: 1.15, c: '#ffffff', solid: false, noAO: true },
      { n: 'shelfA', x: 3.6, z: -3.2, w: 1.7, d: 0.6, h: 0.14, y0: 2.2, c: '#9fd3f0', rad: 0.05, noAO: true },
      { n: 'shelfB', x: 3.6, z: -3.2, w: 1.7, d: 0.6, h: 0.14, y0: 3.3, c: '#9fd3f0', rad: 0.05, noAO: true },
      { n: 'hamper', x: 3.7, z: -1.3, cyl: 0.5, h: 0.9, c: '#c9b3ff', rad: 0.05 },
    ],
    rug: { x: 0.6, z: 0.8, r: 1.5, c: '#ffd0e4', c2: '#ffffff' },
    deco: () => [
      ...windowParts('left', -1.7, 3.5, 1.6, 1.2, { curtain: '#bfe6ff' }),
      { t: 'c', rt: 0.06, rb: 0.06, h: 0.45, p: [1.2, 1.38, -3.42], c: '#d9dde8' },
      { t: 'b', w: 0.1, h: 0.08, d: 0.35, rad: 0.03, p: [1.2, 1.56, -3.28], c: '#d9dde8' },
      { t: 's', r: 0.16, p: [-2.9, 1.0, -3.0], c: '#ffffff' },
      { t: 's', r: 0.11, p: [-2.65, 1.0, -3.15], c: '#eaf7ff' },
      { t: 's', r: 0.13, p: [-4.0, 1.0, 0.0], c: '#ffffff' },
    ],
    stages: [
      [
        { t: 'duck', x: -3.4, z: -0.9, y: 0.95, ry: 0.5 },
        { t: 'soap', x: 0.25, z: -2.85, y: 1.15, ry: 0.3 },
        { t: 'toothcup', x: 2.2, z: -3.05, y: 1.15, ry: 0 },
        { t: 'mirror', wall: 'back', u: 1.2, yc: 2.75 },
        { t: 'towels', x: 3.6, z: -3.2, y: 2.34, ry: 0 },
      ],
      [
        { t: 'duck', x: -3.0, z: -2.3, y: 0.95, ry: 0.2 },
        { t: 'candle', x: -4.0, z: -3.0, y: 0.95, ry: 0 },
        { t: 'cloud', wall: 'left', u: 1.4, yc: 3.6 },
        { t: 'jar', x: 3.7, z: -1.3, y: 0.9, ry: 0.3 },
        { t: 'succulent', x: 3.25, z: -3.2, y: 3.44, ry: 0.2 },
        { t: 'penguin', x: 0.6, z: 0.8, y: 0, ry: 0.5 },
      ],
      [
        { t: 'star', wall: 'left', u: 3.0, yc: 4.3 },
        { t: 'soap', x: -3.8, z: -1.6, y: 0.95, ry: 0.6 },
        { t: 'tulips', x: 4.05, z: -3.2, y: 3.44, ry: 0 },
        { t: 'bunny', x: -1.4, z: 1.6, y: 0, ry: 0.4 },
        { t: 'ball', x: 1.8, z: 2.1, y: 0, ry: 0 },
        { t: 'rainbow', wall: 'back', u: -1.2, yc: 3.6 },
        { t: 'gift', x: 2.8, z: 0.9, y: 0, ry: 0.3 },
      ],
    ],
  },
  {
    id: 'kids',
    name: 'Kids Playroom',
    emoji: '🧸',
    bg: ['#fff1a8', '#e3f6ff'],
    sky: '#fffdf0',
    ground: '#e8e0b8',
    wall: { style: 'dots', a: '#fff3c4', b: '#ffffff' },
    floor: { style: 'carpet', a: '#bdeccd', b: '#a8e0bd' },
    base: '#f2b84b',
    trim: '#ffffff',
    blocks: [
      { n: 'bed', x: -3.35, z: -1.9, w: 2.2, d: 3.0, h: 0.6, c: '#9fd3ff', rad: 0.12 },
      { n: 'mattress', x: -3.35, z: -1.95, w: 2.05, d: 2.8, h: 0.35, y0: 0.6, c: '#ffffff', rad: 0.14 },
      { n: 'blanket', x: -3.35, z: -1.1, w: 2.1, d: 1.4, h: 0.12, y0: 0.95, c: '#ffd35e', rad: 0.06 },
      { n: 'headboard', x: -3.35, z: -3.36, w: 2.3, d: 0.22, h: 1.5, c: '#7fc0f0', rad: 0.1, noAO: true },
      { n: 'chest', x: -0.7, z: -2.95, w: 2.0, d: 1.1, h: 0.95, c: '#ff9fa8', rad: 0.14 },
      { n: 'chest-band', x: -0.7, z: -2.38, w: 2.02, d: 0.06, h: 0.12, y0: 0.7, c: '#ffe08a', rad: 0.03, solid: false, noAO: true },
      { n: 'cubby', x: 2.6, z: -3.0, w: 3.2, d: 1.0, h: 1.5, c: '#c7b6ff', rad: 0.12 },
      { n: 'cub-1', x: 1.85, z: -2.48, w: 1.2, d: 0.05, h: 0.5, y0: 0.2, c: '#a996ee', rad: 0.04, solid: false, noAO: true },
      { n: 'cub-2', x: 3.35, z: -2.48, w: 1.2, d: 0.05, h: 0.5, y0: 0.2, c: '#a996ee', rad: 0.04, solid: false, noAO: true },
      { n: 'cub-3', x: 1.85, z: -2.48, w: 1.2, d: 0.05, h: 0.4, y0: 0.85, c: '#a996ee', rad: 0.04, solid: false, noAO: true },
      { n: 'cub-4', x: 3.35, z: -2.48, w: 1.2, d: 0.05, h: 0.4, y0: 0.85, c: '#a996ee', rad: 0.04, solid: false, noAO: true },
      { n: 'table', x: 1.4, z: -0.6, w: 1.6, d: 1.1, h: 0.7, c: '#ffe08a', rad: 0.12 },
      { n: 'shelf', x: -0.7, z: -3.2, w: 2.2, d: 0.6, h: 0.14, y0: 2.7, c: '#ffb3c7', rad: 0.05, noAO: true },
    ],
    rug: { x: 0.2, z: 1.4, r: 1.8, c: '#ffb3cf', c2: '#fff0f6' },
    deco: () => [...windowParts('back', 2.6, 3.75, 2.2, 1.3, { curtain: '#ffe08a' })],
    stages: [
      [
        { t: 'teddy', x: -3.35, z: -0.9, y: 1.07, ry: 0.5 },
        { t: 'blocks', x: 1.4, z: -0.6, y: 0.7, ry: 0.3 },
        { t: 'ball', x: 0.4, z: 1.5, y: 0, ry: 0 },
        { t: 'rocket', x: 1.9, z: -3.0, y: 1.5, ry: 0.2 },
        { t: 'duck', x: -0.2, z: -2.9, y: 0.95, ry: 0.4 },
      ],
      [
        { t: 'dino', x: 3.4, z: -2.95, y: 1.5, ry: 0.5 },
        { t: 'robot', x: -1.25, z: -2.9, y: 0.95, ry: 0.3 },
        { t: 'star', wall: 'left', u: -2.0, yc: 3.2 },
        { t: 'moon', wall: 'left', u: -0.4, yc: 4.2 },
        { t: 'books', x: -1.2, z: -3.2, y: 2.84, ry: 0.1 },
        { t: 'pillow', x: -3.35, z: -2.85, y: 0.95, ry: 0 },
      ],
      [
        { t: 'rainbow', wall: 'back', u: -0.7, yc: 4.35 },
        { t: 'bunny', x: 0.9, z: 2.4, y: 0, ry: 0.4 },
        { t: 'camera', x: -0.15, z: -3.2, y: 2.84, ry: 0.3 },
        { t: 'yarn', x: -1.3, z: 2.3, y: 0, ry: 0 },
        { t: 'cloud', wall: 'left', u: 1.4, yc: 3.3 },
        { t: 'gift', x: 3.3, z: -0.6, y: 0, ry: 0.3 },
        { t: 'piggy', x: -2.3, z: 1.0, y: 0, ry: 0.6 },
      ],
    ],
  },
  {
    id: 'bakery',
    name: 'Sugar Bakery',
    emoji: '🥐',
    bg: ['#ffd6e0', '#fff3e0'],
    sky: '#fff7f2',
    ground: '#ecd2cf',
    wall: { style: 'stripes', a: '#fff0ea', b: '#ffdce4' },
    floor: { style: 'tiles', a: '#fff3df', b: '#efd2b8' },
    base: '#d98f7a',
    trim: '#ffffff',
    blocks: [
      { n: 'counter', x: -1.9, z: -2.95, w: 5.0, d: 1.1, h: 1.25, c: '#ffe3d1', rad: 0.12 },
      { n: 'ct-top', x: -1.9, z: -2.9, w: 5.2, d: 1.3, h: 0.1, y0: 1.25, c: '#ff9fb5', rad: 0.04, noAO: true },
      { n: 'ct-p1', x: -3.4, z: -2.38, w: 1.4, d: 0.06, h: 0.7, y0: 0.25, c: '#ffd0bd', rad: 0.03, solid: false, noAO: true },
      { n: 'ct-p2', x: -1.9, z: -2.38, w: 1.4, d: 0.06, h: 0.7, y0: 0.25, c: '#ffd0bd', rad: 0.03, solid: false, noAO: true },
      { n: 'ct-p3', x: -0.4, z: -2.38, w: 1.4, d: 0.06, h: 0.7, y0: 0.25, c: '#ffd0bd', rad: 0.03, solid: false, noAO: true },
      { n: 'shelfA', x: -2.3, z: -3.2, w: 3.4, d: 0.6, h: 0.14, y0: 2.5, c: '#e5a688', rad: 0.05, noAO: true },
      { n: 'shelfB', x: -2.3, z: -3.2, w: 3.4, d: 0.6, h: 0.14, y0: 3.6, c: '#e5a688', rad: 0.05, noAO: true },
      { n: 'table', x: 3.0, z: -1.4, cyl: 0.9, h: 1.1, c: '#fff6ea', rad: 0.05 },
      { n: 'stand', x: 3.1, z: -3.05, w: 2.6, d: 0.8, h: 0.9, c: '#ffd0e4', rad: 0.1 },
    ],
    rug: { x: 0.4, z: 1.4, r: 1.6, c: '#ffc4d4', c2: '#fff6ea' },
    deco: () => [
      ...windowParts('left', -1.4, 3.4, 1.8, 1.5, { curtain: '#ff9fb5' }),
      W.box('left', 1.8, 2.8, 1.4, 1.5, 0.1, 0, '#5b4a6a', 0.05),
      W.box('left', 1.8, 2.8, 1.2, 1.3, 0.05, 0.1, '#6d5c80', 0.03),
      W.ball('left', 1.55, 3.05, 0.12, 0.3, 0.16, '#ffb3cf'),
      W.ball('left', 2.05, 2.55, 0.1, 0.3, 0.16, '#ffe27a'),
    ],
    stages: [
      [
        { t: 'cake', x: -3.4, z: -2.9, y: 1.35, ry: 0.2 },
        { t: 'bread', x: -2.1, z: -2.85, y: 1.35, ry: 0.15 },
        { t: 'croissant', x: -0.9, z: -2.7, y: 1.35, ry: 0 },
        { t: 'cupcake', x: 2.7, z: -1.5, y: 1.1, ry: 0.2 },
        { t: 'teapot', x: 3.75, z: -3.05, y: 0.9, ry: 0.3 },
      ],
      [
        { t: 'macarons', x: 0.15, z: -2.9, y: 1.35, ry: 0.3 },
        { t: 'donut', x: 3.35, z: -1.2, y: 1.1, ry: 0.4 },
        { t: 'jar', x: -3.4, z: -3.2, y: 2.64, ry: 0.2 },
        { t: 'mug', x: -2.3, z: -3.2, y: 2.64, ry: 0.4 },
        { t: 'clock', wall: 'back', u: 3.1, yc: 3.2 },
        { t: 'strawberry', x: -1.25, z: -3.2, y: 2.64, ry: 0 },
      ],
      [
        { t: 'croissant', x: -3.4, z: -3.2, y: 3.74, ry: 0.3 },
        { t: 'bread', x: -2.25, z: -3.2, y: 3.74, ry: 0 },
        { t: 'candle', x: -1.15, z: -3.2, y: 3.74, ry: 0 },
        { t: 'garland', wall: 'back', u: 3.0, yc: 4.6 },
        { t: 'kitty', x: 0.8, z: 1.2, y: 0, ry: 0.5 },
        { t: 'cake', x: 2.5, z: -3.05, y: 0.9, ry: -0.2 },
        { t: 'piggy', x: -1.6, z: 1.8, y: 0, ry: 0.6 },
      ],
    ],
  },
  {
    id: 'flower',
    name: 'Bloom Flower Shop',
    emoji: '💐',
    bg: ['#d9f7d0', '#fff0f5'],
    sky: '#f8fff4',
    ground: '#d0e8c4',
    wall: { style: 'hearts', a: '#e6f8ea', b: '#ffd6e4' },
    floor: { style: 'wood', a: '#f0d6b8', b: '#e6c7a3' },
    base: '#8fcf9a',
    trim: '#ffffff',
    blocks: [
      { n: 'step1', x: -1.5, z: -2.3, w: 4.2, d: 2.4, h: 0.55, c: '#f6dcc0', rad: 0.1 },
      { n: 'step2', x: -1.5, z: -2.7, w: 4.2, d: 1.6, h: 1.1, c: '#f1d1b1', rad: 0.1, noAO: true },
      { n: 'step3', x: -1.5, z: -3.1, w: 4.2, d: 0.8, h: 1.65, c: '#ebc6a3', rad: 0.1, noAO: true },
      { n: 'counter', x: 3.3, z: -2.4, w: 2.0, d: 1.2, h: 1.2, c: '#ffd0e4', rad: 0.12 },
      { n: 'ct-band', x: 3.3, z: -1.78, w: 2.02, d: 0.05, h: 0.2, y0: 0.8, c: '#b6f0c8', rad: 0.03, solid: false, noAO: true },
    ],
    rug: { x: 0.8, z: 1.6, r: 1.5, c: '#ffd6e4', c2: '#fff6f9' },
    deco: () => [
      ...windowParts('back', 3.3, 3.6, 1.8, 1.4, { curtain: '#b6f0c8' }),
      ...[[-3.2, -1.35, '#ff8fb5'], [-2.5, -1.3, '#ffe27a'], [0.2, -1.3, '#d9c7ff']].map(([x, z, c]) => ({ t: 's', r: 0.09, p: [x, 0.62, z], c })),
    ],
    stages: [
      [
        { t: 'sunflower', x: -2.8, z: -3.1, y: 1.65, ry: 0.2 },
        { t: 'tulips', x: -1.5, z: -2.3, y: 1.1, ry: 0.3 },
        { t: 'cactus', x: -0.2, z: -1.5, y: 0.55, ry: 0.3 },
        { t: 'basket', x: 3.0, z: -2.4, y: 1.2, ry: 0.2 },
        { t: 'watering', x: 1.4, z: -1.0, y: 0, ry: 0.3 },
      ],
      [
        { t: 'fern', x: -0.2, z: -3.1, y: 1.65, ry: 0.3 },
        { t: 'succulent', x: -3.0, z: -2.3, y: 1.1, ry: 0.2 },
        { t: 'vase', x: -2.9, z: -1.5, y: 0.55, ry: 0 },
        { t: 'tulips', x: 0.0, z: -2.3, y: 1.1, ry: -0.2 },
        { t: 'frame', wall: 'left', u: 1.2, yc: 4.0 },
        { t: 'candle', x: -1.6, z: -1.5, y: 0.55, ry: 0 },
      ],
      [
        { t: 'sunflower', x: -1.55, z: -3.1, y: 1.65, ry: -0.2 },
        { t: 'garland', wall: 'back', u: -1.5, yc: 4.5 },
        { t: 'bunny', x: 0.6, z: 1.8, y: 0, ry: 0.4 },
        { t: 'cloud', wall: 'left', u: -1.8, yc: 3.6 },
        { t: 'jar', x: 3.9, z: -2.2, y: 1.2, ry: 0.2 },
        { t: 'kitty', x: -2.6, z: 0.4, y: 0, ry: 0.5 },
        { t: 'heart', x: 2.4, z: 1.0, y: 0, ry: 0.3 },
      ],
    ],
  },
  {
    id: 'cabin',
    name: 'Winter Cabin',
    emoji: '🎄',
    bg: ['#c9c4ff', '#ffe3ef'],
    sky: '#f6f2ff',
    ground: '#d5c8e8',
    wall: { style: 'wood', a: '#f0cfae', b: '#e8c29d' },
    floor: { style: 'wood', a: '#d4a07a', b: '#c8926b' },
    base: '#a8735a',
    trim: '#fff6ee',
    blocks: [
      { n: 'fireplace', x: 1.0, z: -3.1, w: 2.8, d: 0.8, h: 1.6, c: '#f0c4b4', rad: 0.1 },
      { n: 'mantel', x: 1.0, z: -3.0, w: 3.2, d: 1.0, h: 0.14, y0: 1.6, c: '#a8735a', rad: 0.05, noAO: true },
      { n: 'firebox', x: 1.0, z: -2.69, w: 1.4, d: 0.04, h: 0.9, y0: 0.1, c: '#4b3a4a', rad: 0.02, solid: false, noAO: true },
      { n: 'chair', x: -2.8, z: -2.3, w: 1.6, d: 1.4, h: 0.7, c: '#9fc8ff', rad: 0.18 },
      { n: 'chair-back', x: -2.8, z: -3.1, w: 1.6, d: 0.4, h: 1.6, c: '#8fbaf5', rad: 0.16, noAO: true },
      { n: 'chair-armL', x: -3.6, z: -2.3, w: 0.3, d: 1.4, h: 1.0, c: '#8fbaf5', rad: 0.12, noAO: true },
      { n: 'chair-armR', x: -2.0, z: -2.3, w: 0.3, d: 1.4, h: 1.0, c: '#8fbaf5', rad: 0.12, noAO: true },
      { n: 'sidetable', x: -1.2, z: -2.6, cyl: 0.5, h: 0.9, c: '#c98f68', rad: 0.05 },
    ],
    rug: { x: 0.6, z: 0.2, r: 2.0, c: '#ff9fb5', c2: '#ffe3ef' },
    deco: () => [
      ...windowParts('left', -1.6, 3.4, 1.8, 1.5, { curtain: '#ff9fb5', sky: ['#7b78d6', '#b9b2ff'], sun: '#fff6c8' }),
      { t: 'c', rt: 0.08, rb: 0.08, h: 1.0, p: [1.0, 0.2, -2.6], rot: [0, 0, Math.PI / 2], c: '#8a5434' },
      { t: 's', r: 0.24, p: [0.82, 0.48, -2.6], sc: [1, 1.35, 0.5], c: '#ff8a4d' },
      { t: 's', r: 0.2, p: [1.18, 0.44, -2.58], sc: [1, 1.45, 0.5], c: '#ffb03d' },
      { t: 's', r: 0.13, p: [1.0, 0.42, -2.52], sc: [1, 1.6, 0.5], c: '#ffe27a' },
    ],
    stages: [
      [
        { t: 'xtree', x: 3.6, z: -2.6, y: 0, ry: 0.3 },
        { t: 'cocoa', x: -1.2, z: -2.6, y: 0.9, ry: 0.4 },
        { t: 'stocking', wall: 'back', u: -1.0, yc: 2.6 },
        { t: 'pillow', x: -2.8, z: -2.2, y: 0.7, ry: 0.2 },
        { t: 'candle', x: 0.0, z: -3.0, y: 1.74, ry: 0 },
      ],
      [
        { t: 'snowman', x: -0.6, z: 1.3, y: 0, ry: 0.3 },
        { t: 'stocking', wall: 'back', u: -1.8, yc: 2.6 },
        { t: 'clock', wall: 'back', u: 1.0, yc: 3.25 },
        { t: 'gift', x: 3.0, z: -1.1, y: 0, ry: 0.4 },
        { t: 'kitty', x: 0.9, z: 0.5, y: 0, ry: 0.5 },
        { t: 'books', x: 2.0, z: -3.0, y: 1.74, ry: -0.1 },
      ],
      [
        { t: 'ginger', x: 1.0, z: -2.95, y: 1.74, ry: 0 },
        { t: 'teddy', x: -2.4, z: 1.2, y: 0, ry: 0.5 },
        { t: 'yarn', x: -1.6, z: 0.4, y: 0, ry: 0 },
        { t: 'moon', wall: 'left', u: 1.4, yc: 3.6 },
        { t: 'star', wall: 'left', u: 2.9, yc: 4.4 },
        { t: 'garland', wall: 'back', u: 1.0, yc: 4.7 },
        { t: 'ukulele', wall: 'left', u: -0.1, yc: 2.9 },
      ],
    ],
  },
];

const ORDER = ['bedroom', 'cafe', 'living', 'study', 'bath', 'kids', 'garden', 'bakery', 'flower', 'cabin'];
const ALL = [...BASE_ROOMS, ...MORE_ROOMS];
export const ROOMS = ORDER.map((id) => ALL.find((r) => r.id === id));

// -------------------------------------------------------------------------
export function slotPose(slot, type) {
  const h = type.half;
  if (slot.wall === 'back') return { x: slot.u, y: slot.yc, z: ROOM.z0 + h.z + 0.02, ry: 0 };
  if (slot.wall === 'left') return { x: ROOM.x0 + h.z + 0.02, y: slot.yc, z: slot.u, ry: Math.PI / 2 };
  return { x: slot.x, y: slot.y + h.y, z: slot.z, ry: slot.ry || 0 };
}

export function buildRoom(spec, phys) {
  const group = new THREE.Group();
  const tops = []; // support surfaces for fake blob shadows {x0,x1,z0,z1,y}
  const disposables = [];
  const parts = [];
  const blobs = [];

  const slabC = spec.base;
  // diorama base + walls
  parts.push({ t: 'b', w: 10.0, h: 0.8, d: 8.0, rad: 0.22, p: [0.2, -0.4, 0.0], c: slabC });
  parts.push({ t: 'b', w: 10.3, h: 0.16, d: 8.3, rad: 0.08, p: [0.2, -0.78, 0.0], c: '#6f5a86' });
  parts.push({ t: 'b', w: 9.9, h: ROOM.h, d: 0.4, rad: 0.12, p: [-0.05, ROOM.h / 2, ROOM.z0 - 0.2], c: spec.trim });
  parts.push({ t: 'b', w: 0.4, h: ROOM.h - 0.02, d: 7.2, rad: 0.12, p: [ROOM.x0 - 0.2, ROOM.h / 2 - 0.01, 0.1], c: spec.trim });
  parts.push({ t: 'b', w: 10.0, h: 0.3, d: 0.6, rad: 0.1, p: [-0.05, ROOM.h + 0.05, ROOM.z0 - 0.2], c: spec.base });
  parts.push({ t: 'b', w: 0.6, h: 0.28, d: 7.6, rad: 0.1, p: [ROOM.x0 - 0.2, ROOM.h + 0.04, 0.12], c: spec.base });
  // baseboards
  parts.push({ t: 'b', w: 9.0, h: 0.28, d: 0.14, rad: 0.04, p: [0, 0.14, ROOM.z0 + 0.07], c: spec.trim });
  parts.push({ t: 'b', w: 0.13, h: 0.26, d: 6.86, rad: 0.04, p: [ROOM.x0 + 0.065, 0.13, 0.07], c: spec.trim });

  // furniture
  for (const b of spec.blocks) {
    const y0 = b.y0 ?? 0;
    if (b.cyl) {
      parts.push({ t: 'c', rt: b.cyl, rb: b.cyl, h: b.h, p: [b.x, y0 + b.h / 2, b.z], c: b.c, seg: 28 });
      if (b.solid !== false) {
        phys.addStaticShape(phys.cylShape(b.h / 2, b.cyl), b.x, y0 + b.h / 2, b.z, { x: 0, y: 0, z: 0, w: 1 });
        tops.push({ x0: b.x - b.cyl * 0.8, x1: b.x + b.cyl * 0.8, z0: b.z - b.cyl * 0.8, z1: b.z + b.cyl * 0.8, y: y0 + b.h });
      }
      if (!b.noAO) blobs.push([b.x, b.z, b.cyl * 2 + 0.9, b.cyl * 2 + 0.9]);
    } else {
      parts.push({ t: 'b', w: b.w, h: b.h, d: b.d, rad: b.rad ?? 0.08, p: [b.x, y0 + b.h / 2, b.z], c: b.c });
      if (b.solid !== false) {
        phys.addStaticBox(b.x, y0 + b.h / 2, b.z, b.w / 2, b.h / 2, b.d / 2);
        tops.push({ x0: b.x - b.w / 2, x1: b.x + b.w / 2, z0: b.z - b.d / 2, z1: b.z + b.d / 2, y: y0 + b.h });
      }
      if (!b.noAO && y0 === 0) blobs.push([b.x, b.z, b.w + 0.9, b.d + 0.9]);
    }
  }
  if (spec.deco) parts.push(...spec.deco());

  const staticGeo = mergeParts(parts);
  const staticMesh = new THREE.Mesh(staticGeo, makeMat());
  group.add(staticMesh);
  disposables.push(staticGeo, staticMesh.material);

  // textured walls / floor
  const mkPlane = (w, h, style, tile, rot) => {
    const g = new THREE.PlaneGeometry(w, h);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
    rot(g);
    return g;
  };
  const wallTex = patternTexture(spec.wall.style, spec.wall.a, spec.wall.b);
  const floorTex = patternTexture(spec.floor.style, spec.floor.a, spec.floor.b);
  const backWall = new THREE.Mesh(mkPlane(9, ROOM.h, 0, 2.6, (g) => g.translate(0, ROOM.h / 2, ROOM.z0 + 0.003)), makeMat({ map: wallTex, vertexColors: false }));
  const leftWall = new THREE.Mesh(mkPlane(7, ROOM.h, 0, 2.6, (g) => { g.rotateY(Math.PI / 2); g.translate(ROOM.x0 + 0.003, ROOM.h / 2, 0); }), backWall.material);
  const floor = new THREE.Mesh(mkPlane(9, 7, 0, spec.floor.style === 'wood' ? 3.2 : spec.floor.style === 'carpet' ? 1.6 : 2.2, (g) => { g.rotateX(-Math.PI / 2); g.translate(0, 0.004, 0); }), makeMat({ map: floorTex, vertexColors: false }));
  group.add(backWall, leftWall, floor);
  disposables.push(backWall.geometry, leftWall.geometry, floor.geometry, backWall.material, floor.material);

  // fake ambient occlusion blobs under furniture & wall contact
  const blobPos = [];
  const blobUv = [];
  const quad = (cx, cz, w, d, y) => {
    const hw = w / 2;
    const hd = d / 2;
    blobPos.push(cx - hw, y, cz - hd, cx - hw, y, cz + hd, cx + hw, y, cz + hd, cx - hw, y, cz - hd, cx + hw, y, cz + hd, cx + hw, y, cz - hd);
    blobUv.push(0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0);
  };
  blobs.forEach(([x, z, w, d]) => quad(x, z, w, d, 0.012));
  if (spec.rug) quad(spec.rug.x + 0.1, spec.rug.z + 0.1, spec.rug.r * 2 + 0.8, spec.rug.r * 2 + 0.8, 0.008);
  // wall corner shading strips
  quad(0, ROOM.z0 + 0.45, 9, 0.9, 0.013);
  quad(ROOM.x0 + 0.45, 0, 0.9, 7, 0.013);
  const blobGeo = new THREE.BufferGeometry();
  blobGeo.setAttribute('position', new THREE.Float32BufferAttribute(blobPos, 3));
  blobGeo.setAttribute('uv', new THREE.Float32BufferAttribute(blobUv, 2));
  const blobMat = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.8 });
  const blobMesh = new THREE.Mesh(blobGeo, blobMat);
  blobMesh.renderOrder = 1;
  group.add(blobMesh);
  disposables.push(blobGeo, blobMat);

  // rug (visual only, slightly raised)
  if (spec.rug) {
    const r = spec.rug;
    const g = mergeParts([
      { t: 'c', rt: r.r, rb: r.r, h: 0.04, p: [r.x, 0.02, r.z], seg: 40, c: r.c },
      { t: 'c', rt: r.r * 0.78, rb: r.r * 0.78, h: 0.05, p: [r.x, 0.022, r.z], seg: 40, c: r.c2 },
      { t: 'c', rt: r.r * 0.5, rb: r.r * 0.5, h: 0.06, p: [r.x, 0.024, r.z], seg: 40, c: r.c },
    ]);
    const m = new THREE.Mesh(g, makeMat());
    group.add(m);
    disposables.push(g, m.material);
  }

  // invisible physics shell
  phys.addStaticBox(0, -1, 0, 7, 1, 6); // floor, top at y=0
  phys.addStaticBox(0, 3, ROOM.z0 - 0.5, 6, 4, 0.5);
  phys.addStaticBox(ROOM.x0 - 0.5, 3, 0, 0.5, 4, 5);
  phys.addStaticBox(0, 3, ROOM.z1 + 0.6, 6, 4, 0.5);
  phys.addStaticBox(ROOM.x1 + 0.6, 3, 0, 0.5, 4, 5);
  phys.addStaticBox(0, 8, 0, 6, 0.5, 5);

  return {
    group,
    tops,
    // highest support surface under point (x,z) that is below maxY
    supportY(x, z, maxY) {
      let best = 0;
      for (let i = 0; i < tops.length; i++) {
        const t = tops[i];
        if (t.y <= maxY + 0.05 && t.y > best && x >= t.x0 && x <= t.x1 && z >= t.z0 && z <= t.z1) best = t.y;
      }
      return best;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
      shared.uSky.value.set(spec.sky);
    },
  };
}
