import * as THREE from 'three';
import { sparkTexture } from './materials.js';
import { rand } from './util.js';

const N_SPARK = 220;
const N_CONF = 110;
const N_RING = 6;

const SPARK_VERT = /* glsl */ `
attribute float aSize;
attribute float aLife;
attribute vec3 aColor;
uniform float uScale;
varying float vLife;
varying vec3 vColor;
void main() {
  vLife = aLife;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = aSize * (1.0 - aLife * 0.6) * step(aLife, 0.999);
  gl_PointSize = s * uScale / -mv.z;
}`;
const SPARK_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying float vLife;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(uTex, gl_PointCoord);
  float a = t.a * (1.0 - vLife * vLife);
  gl_FragColor = vec4(vColor * (0.6 + t.r * 0.7), a);
  #include <colorspace_fragment>
}`;

const MOTE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  float t = uTime * 0.12 + aSeed.w * 10.0;
  vec3 p = position;
  p.x += sin(t * 1.7 + aSeed.x * 6.28) * 0.5;
  p.z += cos(t * 1.3 + aSeed.y * 6.28) * 0.5;
  p.y += mod(t * 0.6 + aSeed.z * 5.0, 5.0) - 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = smoothstep(0.0, 0.8, 1.0 - abs(mod(t * 0.6 + aSeed.z * 5.0, 5.0) / 5.0 - 0.5) * 2.0);
  gl_PointSize = (0.05 + aSeed.x * 0.05) * uScale / -mv.z;
}`;
const MOTE_FRAG = /* glsl */ `
uniform sampler2D uTex;
varying float vA;
void main() {
  float a = texture2D(uTex, gl_PointCoord).a * vA * 0.55;
  gl_FragColor = vec4(1.0, 0.96, 0.85, a);
  #include <colorspace_fragment>
}`;

const PALETTE = ['#ff8fb5', '#ffe27a', '#8fd3ff', '#b6f0c8', '#d9c7ff', '#ffb066', '#ffffff'].map((c) => new THREE.Color(c));

export class FX {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.tex = sparkTexture();

    // --- sparkles
    const g = new THREE.BufferGeometry();
    this.sPos = new Float32Array(N_SPARK * 3);
    this.sCol = new Float32Array(N_SPARK * 3);
    this.sSize = new Float32Array(N_SPARK);
    this.sLife = new Float32Array(N_SPARK).fill(1);
    this.sVel = new Float32Array(N_SPARK * 3);
    this.sDur = new Float32Array(N_SPARK).fill(1);
    this.sAge = new Float32Array(N_SPARK).fill(1);
    g.setAttribute('position', new THREE.BufferAttribute(this.sPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.sCol, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.sSize, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.sLife, 1).setUsage(THREE.DynamicDrawUsage));
    this.sparkMat = new THREE.ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      uniforms: { uTex: { value: this.tex }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sparks = new THREE.Points(g, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 10;
    this.group.add(this.sparks);
    this.sNext = 0;
    this.sActive = 0;

    // --- confetti
    const cg = new THREE.PlaneGeometry(0.16, 0.1);
    const cm = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true });
    this.conf = new THREE.InstancedMesh(cg, cm, N_CONF);
    this.conf.frustumCulled = false;
    this.conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.cData = Array.from({ length: N_CONF }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), life: 0 }));
    const m4 = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < N_CONF; i++) {
      this.conf.setMatrixAt(i, m4);
      this.conf.setColorAt(i, PALETTE[i % PALETTE.length]);
    }
    this.group.add(this.conf);
    this.cActive = 0;

    // --- rings
    const rg = new THREE.RingGeometry(0.55, 0.7, 40);
    rg.rotateX(-Math.PI / 2);
    this.rings = [];
    for (let i = 0; i < N_RING; i++) {
      const m = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      m.renderOrder = 5;
      this.group.add(m);
      this.rings.push({ m, t: 1 });
    }
    this.ringNext = 0;

    // --- ambient dust motes (animated fully on GPU)
    const NM = 36;
    const mp = new Float32Array(NM * 3);
    const ms = new Float32Array(NM * 4);
    for (let i = 0; i < NM; i++) {
      mp.set([rand(-4, 4), rand(0, 1), rand(-3, 3)], i * 3);
      ms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    mg.setAttribute('aSeed', new THREE.BufferAttribute(ms, 4));
    this.moteMat = new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      uniforms: { uTex: { value: this.tex }, uTime: { value: 0 }, uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.motes = new THREE.Points(mg, this.moteMat);
    this.motes.frustumCulled = false;
    this.group.add(this.motes);

    this.quality = 1;
  }

  setScale(heightPx, fov) {
    const s = (heightPx * 0.5) / Math.tan((fov * Math.PI) / 360);
    this.sparkMat.uniforms.uScale.value = s;
    this.moteMat.uniforms.uScale.value = s;
  }

  setQuality(q) {
    this.quality = q;
    this.motes.visible = q > 0;
  }

  get active() {
    return this.sActive > 0 || this.cActive > 0 || this.rings.some((r) => r.t < 1);
  }

  sparkle(x, y, z, count = 12, { speed = 2.2, size = 26, colors = PALETTE, up = 1.0, dur = 0.7, spread = 1 } = {}) {
    count = Math.ceil(count * (this.quality > 0 ? 1 : 0.5));
    for (let n = 0; n < count; n++) {
      const i = this.sNext;
      this.sNext = (this.sNext + 1) % N_SPARK;
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.3) * Math.PI * 0.6;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.sPos[i * 3] = x + (Math.random() - 0.5) * 0.2 * spread;
      this.sPos[i * 3 + 1] = y + (Math.random() - 0.5) * 0.2 * spread;
      this.sPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.2 * spread;
      this.sVel[i * 3] = Math.cos(a) * Math.cos(e) * sp * spread;
      this.sVel[i * 3 + 1] = Math.sin(e) * sp * up + 0.8;
      this.sVel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp * spread;
      const c = colors[(Math.random() * colors.length) | 0];
      this.sCol[i * 3] = c.r;
      this.sCol[i * 3 + 1] = c.g;
      this.sCol[i * 3 + 2] = c.b;
      this.sSize[i] = size * 0.0095 * (0.6 + Math.random() * 0.8); // world units
      this.sDur[i] = dur * (0.7 + Math.random() * 0.6);
      this.sAge[i] = 0;
      this.sLife[i] = 0;
    }
    this.sActive = N_SPARK;
  }

  ring(x, y, z, color = 0xffffff) {
    const r = this.rings[this.ringNext];
    this.ringNext = (this.ringNext + 1) % N_RING;
    r.t = 0;
    r.m.position.set(x, y, z);
    r.m.material.color.set(color);
    r.m.visible = true;
  }

  confetti(x, y, z, n = 80) {
    n = Math.min(N_CONF, Math.ceil(n * (this.quality > 0 ? 1 : 0.6)));
    for (let i = 0; i < n; i++) {
      const c = this.cData[i];
      c.p.set(x + rand(-0.6, 0.6), y, z + rand(-0.6, 0.6));
      const a = Math.random() * Math.PI * 2;
      const sp = rand(2, 7);
      c.v.set(Math.cos(a) * sp, rand(5, 11), Math.sin(a) * sp);
      c.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
      c.rv.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      c.life = rand(1.6, 2.6);
    }
    this.cActive = n;
  }

  update(dt, time) {
    this.moteMat.uniforms.uTime.value = time;
    if (this.sActive > 0) {
      let alive = 0;
      for (let i = 0; i < N_SPARK; i++) {
        if (this.sAge[i] >= 1) continue;
        this.sAge[i] += dt / this.sDur[i];
        this.sLife[i] = this.sAge[i];
        if (this.sAge[i] >= 1) {
          this.sLife[i] = 1;
          continue;
        }
        alive++;
        this.sVel[i * 3 + 1] -= 3.2 * dt;
        const d = Math.exp(-2.2 * dt);
        this.sVel[i * 3] *= d;
        this.sVel[i * 3 + 1] *= d;
        this.sVel[i * 3 + 2] *= d;
        this.sPos[i * 3] += this.sVel[i * 3] * dt;
        this.sPos[i * 3 + 1] += this.sVel[i * 3 + 1] * dt;
        this.sPos[i * 3 + 2] += this.sVel[i * 3 + 2] * dt;
      }
      const g = this.sparks.geometry.attributes;
      g.position.needsUpdate = g.aLife.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = true;
      this.sActive = alive;
    }
    if (this.cActive > 0) {
      let alive = 0;
      const m4 = FX._m;
      const q = FX._q;
      for (let i = 0; i < N_CONF; i++) {
        const c = this.cData[i];
        if (c.life <= 0) continue;
        c.life -= dt;
        if (c.life <= 0) {
          m4.makeScale(0, 0, 0);
          this.conf.setMatrixAt(i, m4);
          continue;
        }
        alive++;
        c.v.y -= 14 * dt;
        c.v.multiplyScalar(Math.exp(-0.9 * dt));
        c.p.addScaledVector(c.v, dt);
        c.r.x += c.rv.x * dt;
        c.r.y += c.rv.y * dt;
        c.r.z += c.rv.z * dt;
        q.setFromEuler(c.r);
        const s = Math.min(1, c.life * 2);
        m4.compose(c.p, q, FX._s.set(s, s, s));
        this.conf.setMatrixAt(i, m4);
      }
      this.conf.instanceMatrix.needsUpdate = true;
      if (this.conf.instanceColor) this.conf.instanceColor.needsUpdate = false;
      this.cActive = alive;
    }
    for (const r of this.rings) {
      if (r.t >= 1) continue;
      r.t += dt / 0.55;
      if (r.t >= 1) {
        r.m.visible = false;
        continue;
      }
      const k = 1 - Math.pow(1 - r.t, 3);
      r.m.scale.setScalar(0.4 + k * 1.9);
      r.m.material.opacity = (1 - r.t) * 0.9;
    }
  }
}
FX._m = new THREE.Matrix4();
FX._q = new THREE.Quaternion();
FX._s = new THREE.Vector3();
