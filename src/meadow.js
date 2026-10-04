import * as THREE from 'three';
import { makeMat } from './materials.js';
import { mergeParts } from './items.js';

// A tiny chill meadow around the diorama: rolling ground, hills, round trees, flowers and grass.
// Everything static is merged; flowers & grass are single InstancedMeshes (1 draw call each).
// Wind sway is done in the vertex shader -> zero CPU cost.

const CAM_DIR = new THREE.Vector2(0.52, 0.85).normalize(); // camera side (keep it clear of trees)
const rnd = (() => {
  let s = 1234567;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
})();
const R = (a, b) => a + rnd() * (b - a);

function insideDiorama(x, z, pad = 0) {
  return x > -5.4 - pad && x < 5.0 + pad && z > -4.4 - pad && z < 4.2 + pad;
}

export class Meadow {
  constructor(cfg) {
    this.group = new THREE.Group();
    this.cfg = cfg;
    this.horizon = new THREE.Color('#fff1e6');
    this.build();
  }

  build() {
    const g = this.group;
    const Y = -0.9;

    // --- ground: radial rings so we can fade into the sky colour at the horizon
    const ground = new THREE.RingGeometry(0.01, 150, 40, 14);
    ground.rotateX(-Math.PI / 2);
    ground.translate(0, Y, 0);
    ground.deleteAttribute('uv');
    this.groundGeo = ground;
    ground.setAttribute('color', new THREE.BufferAttribute(new Float32Array(ground.attributes.position.count * 3), 3));
    this.ground = new THREE.Mesh(ground, makeMat());
    g.add(this.ground);
    this.paintGround();

    // --- distant hills + trees + bushes + stones + clouds (one merged mesh)
    const P = [];
    const hillCols = ['#a9dc9a', '#b8e3a6', '#9fd48f', '#c4e9b1'];
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.62 + (i / 8) * Math.PI * 1.55;
      const d = R(48, 70);
      const r = R(16, 26);
      P.push({ t: 's', r, p: [Math.cos(a) * d, Y - r * 0.55, Math.sin(a) * d], sc: [1.5, 0.75, 1], c: hillCols[i % 4], seg: 18 });
    }
    const tree = (x, z, s) => {
      const c1 = ['#7fcf87', '#8fdb8f', '#6fc67f', '#a5e09a'][(rnd() * 4) | 0];
      const blossom = rnd() < 0.3;
      P.push({ t: 'c', rt: 0.22 * s, rb: 0.32 * s, h: 1.6 * s, p: [x, Y + 0.8 * s, z], c: '#b9825c', seg: 8 });
      P.push({ t: 's', r: 1.2 * s, p: [x, Y + 2.3 * s, z], c: blossom ? '#ffc4dc' : c1, seg: 12 });
      P.push({ t: 's', r: 0.85 * s, p: [x + 0.7 * s, Y + 2.0 * s, z + 0.3 * s], c: blossom ? '#ffb3cf' : c1, seg: 10 });
      P.push({ t: 's', r: 0.8 * s, p: [x - 0.6 * s, Y + 2.7 * s, z - 0.2 * s], c: blossom ? '#ffd6e6' : c1, seg: 10 });
    };
    let placed = 0;
    for (let tries = 0; placed < 22 && tries < 400; tries++) {
      const a = R(0, Math.PI * 2);
      const d = R(9, 32);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const along = (x * CAM_DIR.x + z * CAM_DIR.y) / d;
      if (along > -0.05 && d < 40) continue; // never between camera and room
      tree(x, z, R(0.9, 1.6));
      placed++;
    }
    for (let i = 0; i < 26; i++) {
      const a = R(0, Math.PI * 2);
      const d = R(6.8, 16);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (insideDiorama(x, z, 0.4)) continue;
      const along = (x * CAM_DIR.x + z * CAM_DIR.y) / d;
      if (along > 0.4 && d < 12) continue;
      const s = R(0.5, 0.95);
      P.push({ t: 's', r: s, p: [x, Y + s * 0.35, z], sc: [1.3, 0.8, 1.1], c: ['#8fd98f', '#a8e2a0', '#7fcf87'][i % 3], seg: 10 });
    }
    // stepping stones toward the viewer
    for (let i = 0; i < 6; i++) {
      const t = 6.2 + i * 1.5;
      P.push({ t: 'c', rt: 0.45, rb: 0.5, h: 0.12, p: [CAM_DIR.x * t + (i % 2 ? 0.35 : -0.35), Y + 0.04, CAM_DIR.y * t], c: '#efe6dc', seg: 10 });
    }
    // fluffy clouds far behind
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 0.9 + i * 0.45;
      const d = R(55, 75);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      const y = R(14, 26);
      for (let k = 0; k < 4; k++) P.push({ t: 's', r: R(3, 5), p: [x + k * 4 - 6, y + (k % 2) * 1.5, z], sc: [1.3, 0.75, 1], c: '#ffffff', seg: 10 });
    }
    // soft contact shadow ring under the diorama is part of the ground paint
    const scenery = mergeParts(P);
    this.scenery = new THREE.Mesh(scenery, makeMat());
    g.add(this.scenery);

    // --- flowers (instanced)
    const flowerGeo = mergeParts([
      { t: 'c', rt: 0.02, rb: 0.02, h: 0.3, p: [0, 0.15, 0], c: '#6fbf7a', seg: 5 },
      ...[0, 1, 2, 3, 4].map((i) => ({ t: 'c', rt: 0.075, rb: 0.075, h: 0.03, p: [Math.cos((i * Math.PI * 2) / 5) * 0.085, 0.32, Math.sin((i * Math.PI * 2) / 5) * 0.085], c: '#ffffff', seg: 6 })),
      { t: 'c', rt: 0.055, rb: 0.055, h: 0.05, p: [0, 0.335, 0], c: '#ffe27a', seg: 6 },
    ]);
    const nF = this.cfg.flowers;
    const flowers = new THREE.InstancedMesh(flowerGeo, makeMat({ wind: this.cfg.wind }), nF);
    const petal = ['#ffb3cf', '#ffffff', '#d9c7ff', '#ffe27a', '#ff9f9f', '#a8d8ff'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    let n = 0;
    for (let tries = 0; n < nF && tries < nF * 6; tries++) {
      const a = R(0, Math.PI * 2);
      const d = Math.sqrt(R(0, 1)) * 22 + 5.5;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (insideDiorama(x, z, 0.3)) continue;
      const s = R(1.1, 1.8);
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R(0, 6.28));
      flowers.setMatrixAt(n, m.compose(pos.set(x, Y, z), q, sc.set(s, s, s)));
      flowers.setColorAt(n, petal[n % petal.length]);
      n++;
    }
    flowers.count = n;
    flowers.frustumCulled = false;
    g.add(flowers);
    this.flowers = flowers;

    // --- grass tufts (instanced, wind)
    const nG = this.cfg.grass;
    if (nG > 0) {
      const tuft = mergeParts([
        { t: 'k', r: 0.06, h: 0.5, p: [0, 0.25, 0], rot: [0, 0, 0.1], c: '#8ed27f', seg: 4 },
        { t: 'k', r: 0.05, h: 0.4, p: [0.08, 0.2, 0.03], rot: [0.2, 0, -0.35], c: '#7cc56f', seg: 4 },
        { t: 'k', r: 0.05, h: 0.38, p: [-0.08, 0.19, -0.02], rot: [-0.2, 0, 0.35], c: '#9edb8c', seg: 4 },
      ]);
      const grass = new THREE.InstancedMesh(tuft, makeMat({ wind: this.cfg.wind }), nG);
      const tint = new THREE.Color();
      let k = 0;
      for (let tries = 0; k < nG && tries < nG * 6; tries++) {
        const a = R(0, Math.PI * 2);
        const d = Math.sqrt(R(0, 1)) * 26 + 5.2;
        const x = Math.cos(a) * d;
        const z = Math.sin(a) * d;
        if (insideDiorama(x, z, 0.1)) continue;
        const s = R(0.8, 1.45);
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, R(0, 6.28));
        grass.setMatrixAt(k, m.compose(pos.set(x, Y, z), q, sc.set(s, s * R(0.8, 1.3), s)));
        grass.setColorAt(k, tint.setHSL(0.27 + R(-0.03, 0.03), 0.5, R(0.82, 1.0)));
        k++;
      }
      grass.count = k;
      grass.frustumCulled = false;
      g.add(grass);
      this.grass = grass;
    }
  }

  // Grass green near the diorama, blending into the sky's horizon colour far away.
  paintGround() {
    const geo = this.groundGeo;
    const pos = geo.attributes.position;
    const col = geo.attributes.color;
    const near = new THREE.Color('#a7dd92');
    const mid = new THREE.Color('#bde6a5');
    const shade = new THREE.Color('#86c27a');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z);
      if (d < 7.5) c.copy(shade).lerp(near, Math.min(1, Math.max(0, (d - 4.5) / 3)));
      else if (d < 40) c.copy(near).lerp(mid, (d - 7.5) / 32.5);
      else c.copy(mid).lerp(this.horizon, Math.min(1, (d - 40) / 70));
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  }

  setHorizon(hex) {
    this.horizon.set(hex);
    this.paintGround();
  }
}
