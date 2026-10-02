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
  P.push(W.box(wall, u, y + h * 0.25, w, h * 0.5, 0.1, 0.1, sky[0], 0.02));
  P.push(W.box(wall, u, y - h * 0.25, w, h * 0.5, 0.1, 0.1, sky[1], 0.02));
  P.push(W.ball(wall, u + w * 0.22, y + h * 0.18, 0.28, 0.2, 0.21, '#ffe27a'));
  P.push(W.ball(wall, u - w * 0.18, y - h * 0.12, 0.2, 0.2, 0.21, '#ffffff'));
  P.push(W.ball(wall, u - w * 0.05, y - h * 0.16, 0.26, 0.2, 0.21, '#ffffff'));
  P.push(W.box(wall, u, y, 0.1, h, 0.08, 0.13, o.frame || '#ffffff', 0.02));
  P.push(W.box(wall, u, y, w, 0.1, 0.08, 0.13, o.frame || '#ffffff', 0.02));
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
export const ROOMS = [
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
  parts.push({ t: 'b', w: 0.4, h: ROOM.h, d: 7.4, rad: 0.12, p: [ROOM.x0 - 0.2, ROOM.h / 2, 0.0], c: spec.trim });
  parts.push({ t: 'b', w: 10.0, h: 0.3, d: 0.6, rad: 0.1, p: [-0.05, ROOM.h + 0.05, ROOM.z0 - 0.2], c: spec.base });
  parts.push({ t: 'b', w: 0.6, h: 0.3, d: 7.6, rad: 0.1, p: [ROOM.x0 - 0.2, ROOM.h + 0.05, 0.0], c: spec.base });
  // baseboards
  parts.push({ t: 'b', w: 9.0, h: 0.28, d: 0.14, rad: 0.04, p: [0, 0.14, ROOM.z0 + 0.07], c: spec.trim });
  parts.push({ t: 'b', w: 0.14, h: 0.28, d: 7.0, rad: 0.04, p: [ROOM.x0 + 0.07, 0.14, 0], c: spec.trim });

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
