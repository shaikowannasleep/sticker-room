import * as THREE from 'three';
import { Physics, LAYER } from './physics.js';
import { makeMat, shared, blobTexture } from './materials.js';
import { getItemType, mergeParts } from './items.js';
import { ROOMS, buildRoom, slotPose } from './rooms.js';
import { FX } from './fx.js';
import { sfx } from './audio.js';
import { loadSave, writeSave } from './storage.js';
import { Quality } from './quality.js';
import { clamp, lerp, damp, rand, shuffle, smooth, easeOutBack, easeOutCubic, easeOutElastic, isMobile } from './util.js';

const FOV = 30;
const TARGET = new THREE.Vector3(-0.2, 1.7, 0.1);
const BOUNDS = [
  new THREE.Vector3(-5.0, -0.9, -4.1),
  new THREE.Vector3(4.8, 5.9, 3.9),
];
const BOX_POS = new THREE.Vector3(3.5, 0, 2.55);
const GRAVITY = 24;
const HINT_COST = 15;
const UP = new THREE.Vector3(0, 1, 0);

export const LEVELS = [];
ROOMS.forEach((r, ri) =>
  r.stages.forEach((s, si) => LEVELS.push({ id: `${r.id}-${si + 1}`, room: ri, stage: si, name: `${r.name} ${si + 1}` }))
);

const $ = (id) => document.getElementById(id);

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.save = loadSave();
    this.state = 'loading';
    this.time = 0;
    this.tweens = [];
    this.pieces = [];
    this.slots = [];
    this.room = null;
    this.roomIdx = -1;
    this.levelIdx = 0;
    this.drag = null;
    this.ptr = { x: 0, y: 0 };
    this.yaw = 0;
    this.zoom = 1;
    this.menuK = 1;
    this.camIntro = 1;
    this.combo = 0;
    this.lastPlace = -10;
    this.hintPiece = null;
    this.hintT = 0;
    this.misses = 0;
    this.hintsUsed = 0;
    this.paused = false;
    this.lastFrame = 0;
    this.lastRender = 0;
    this.needIdleRender = true;
    this.bgCache = new Map();
    this.tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Plane(), r: new THREE.Ray(), s: new THREE.Vector3() };
  }

  // -------------------------------------------------------------- setup
  async init() {
    const dpr = window.devicePixelRatio || 1;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: dpr < 2,
      alpha: false,
      stencil: false,
      powerPreference: 'default',
    }));
    this.quality = new Quality(isMobile);
    renderer.setPixelRatio(this.quality.dpr);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 160);
    this.fitCam = new THREE.PerspectiveCamera(FOV, 1, 1, 160);
    this.fx = new FX(this.scene);
    this.phys = new Physics();

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.roomGroup = new THREE.Group();
    this.piecesGroup = new THREE.Group();
    this.world.add(this.roomGroup, this.piecesGroup);

    // shared materials
    this.outlineMat = makeMat({ outline: true });
    this.outlineMat.uniforms.uOutline.value = 0.042;
    // slot silhouettes: dark translucent fill (single blend thanks to depthWrite) + crisp opaque sticker edge
    const ghostFill = (tint, alpha) => {
      const m = makeMat({ ghost: true });
      m.depthWrite = true;
      m.polygonOffset = true;
      m.polygonOffsetFactor = -2;
      m.uniforms.uTint.value.set(tint);
      m.uniforms.uAlpha.value = alpha;
      return m;
    };
    const ghostEdge = (col, w) => {
      const m = makeMat({ outline: true });
      m.uniforms.uOutline.value = w;
      m.uniforms.uOutlineCol.value.set(col);
      return m;
    };
    this.ghostFill = ghostFill('#6a4a92', 0.4);
    this.ghostEdge = ghostEdge('#ffffff', 0.04);
    this.ghostFillHot = ghostFill('#ffd84a', 0.6);
    this.ghostEdgeHot = ghostEdge('#fff6c2', 0.07);

    this.shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadowTex = blobTexture();

    this.buildBox();
    this.bindUI();
    this.bindInput();
    this.applySettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hidden = true;
        sfx.suspend();
      } else {
        this.hidden = false;
        this.lastFrame = performance.now();
        sfx.resume();
        this.needIdleRender = true;
      }
    });
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.ctxLost = true;
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.ctxLost = false;
    });

    // warm shaders so the first level has no hitch
    this.loadRoom(0, 0, 'dream');
    renderer.compile(this.scene, this.camera);
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.W = w;
    this.H = h;
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setScale(this.renderer.domElement.height, FOV);
    this.dirBase = this.baseDir(w / h);
    this.fitGame = this.fitDistance(w / h, w / h < 0.7 ? 1.04 : 0.93, 0.8);
    this.fitMenu = this.fitDistance(w / h, 0.8, 0.6);
    this.applyCamera();
    this.needIdleRender = true;
  }

  baseDir(aspect) {
    const boost = clamp((0.85 - aspect) * 1.1, 0, 0.7);
    return new THREE.Vector3(0.62 - boost * 0.3, 0.8 + boost, 1.0).normalize();
  }

  fitDistance(aspect, mx, my) {
    const cam = this.fitCam;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const dir = this.baseDir(aspect);
    const v = new THREE.Vector3();
    let lo = 8;
    let hi = 160;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      cam.position.copy(TARGET).addScaledVector(dir, mid);
      cam.lookAt(TARGET);
      cam.updateMatrixWorld();
      cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
      let ok = true;
      for (let c = 0; c < 8 && ok; c++) {
        v.set(c & 1 ? BOUNDS[1].x : BOUNDS[0].x, c & 2 ? BOUNDS[1].y : BOUNDS[0].y, c & 4 ? BOUNDS[1].z : BOUNDS[0].z).project(cam);
        if (Math.abs(v.x) > mx || Math.abs(v.y) > my) ok = false;
      }
      if (ok) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  applyCamera() {
    const cam = this.camera;
    const d = lerp(this.fitGame, this.fitMenu, this.menuK) * this.zoom * lerp(1.18, 1, easeOutCubic(this.camIntro));
    const dir = this.tmp.s.copy(this.dirBase).applyAxisAngle(UP, this.yaw + (1 - easeOutCubic(this.camIntro)) * -0.45);
    cam.position.copy(TARGET).addScaledVector(dir, d);
    cam.lookAt(TARGET);
    cam.updateMatrixWorld();
    const shift = this.menuK * d * 0.085;
    if (shift) {
      const up = this.tmp.v.setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(up, shift);
      cam.lookAt(this.tmp.v2.copy(TARGET).addScaledVector(up, shift));
      cam.updateMatrixWorld();
    }
  }

  applySettings() {
    const s = this.save.settings;
    sfx.setEnabled(s.sound);
    sfx.musicOn = s.music;
    this.quality.setTargetFps(s.saver ? 30 : 60);
    this.minInterval = s.saver ? 1000 / 30 : 1000 / 60;
    $('set-sound').checked = s.sound;
    $('set-music').checked = s.music;
    $('set-haptics').checked = s.haptics;
    $('set-saver').checked = s.saver;
  }

  // -------------------------------------------------------------- UI
  bindUI() {
    const on = (id, fn) => {
      $(id).addEventListener('click', (e) => {
        sfx.init();
        sfx.click();
        fn(e);
      });
    };
    on('btn-play', () => this.startLevel(this.firstOpenLevel()));
    on('btn-levels', () => this.showLevels());
    on('btn-settings', () => this.show('settings', true));
    on('settings-close', () => this.show('settings', false));
    on('levels-close', () => this.show('levels', false));
    on('btn-pause', () => this.setPaused(true));
    on('btn-resume', () => this.setPaused(false));
    on('btn-restart', () => {
      this.setPaused(false);
      this.startLevel(this.levelIdx);
    });
    on('btn-quit', () => {
      this.setPaused(false);
      this.showMenu();
    });
    on('btn-hint', () => this.useHint());
    on('btn-next', () => (this.levelIdx >= LEVELS.length - 1 ? this.showMenu() : this.startLevel(this.levelIdx + 1)));
    on('btn-replay', () => this.startLevel(this.levelIdx));
    on('btn-win-menu', () => this.showMenu());
    on('btn-reset', () => {
      if (confirm('Reset all progress?')) {
        this.save.stars = {};
        this.save.coins = 100;
        this.save.tutorialDone = false;
        writeSave(this.save);
        this.show('settings', false);
        this.showMenu();
      }
    });
    const bindTog = (id, key, extra) =>
      $(id).addEventListener('change', (e) => {
        sfx.init();
        this.save.settings[key] = e.target.checked;
        writeSave(this.save);
        this.applySettings();
        if (extra) extra();
        sfx.click();
      });
    bindTog('set-sound', 'sound');
    bindTog('set-music', 'music', () => sfx.setMusic(this.save.settings.music));
    bindTog('set-haptics', 'haptics');
    bindTog('set-saver', 'saver');
  }

  show(id, v) {
    $(id).classList.toggle('hidden', !v);
  }

  toast(msg, ms = 2200) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  setCoins(n, bump) {
    this.save.coins = n;
    $('coins').textContent = n;
    writeSave(this.save);
    if (bump) {
      const p = document.querySelector('.coin-pill');
      p.classList.add('bump');
      setTimeout(() => p.classList.remove('bump'), 180);
    }
  }

  setProgress() {
    const total = this.slots.filter((s) => s.cur).length;
    const done = this.slots.filter((s) => s.cur && s.filled).length;
    $('bar-fill').style.width = total ? (done / total) * 100 + '%' : '0%';
    this.placedCount = done;
    this.totalCount = total;
  }

  floater(text, wx, wy, wz) {
    const v = this.tmp.v.set(wx, wy, wz).project(this.camera);
    const el = document.createElement('div');
    el.className = 'floater';
    el.textContent = text;
    el.style.left = ((v.x * 0.5 + 0.5) * this.W).toFixed(0) + 'px';
    el.style.top = ((-v.y * 0.5 + 0.5) * this.H).toFixed(0) + 'px';
    $('floaters').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }

  buzz(ms) {
    if (this.save.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
  }

  firstOpenLevel() {
    for (let i = 0; i < LEVELS.length; i++) if (!this.save.stars[LEVELS[i].id]) return i;
    return LEVELS.length - 1;
  }

  isUnlocked(i) {
    return i === 0 || !!this.save.stars[LEVELS[i - 1].id];
  }

  showLevels() {
    const list = $('levels-list');
    list.innerHTML = '';
    ROOMS.forEach((r, ri) => {
      const card = document.createElement('div');
      card.className = 'room-card';
      card.innerHTML = `<h3><span>${r.emoji}</span>${r.name}</h3>`;
      const row = document.createElement('div');
      row.className = 'stage-row';
      r.stages.forEach((s, si) => {
        const idx = LEVELS.findIndex((l) => l.room === ri && l.stage === si);
        const st = this.save.stars[LEVELS[idx].id] || 0;
        const b = document.createElement('button');
        b.className = 'stage' + (this.isUnlocked(idx) ? '' : ' locked');
        b.innerHTML = this.isUnlocked(idx) ? `${si + 1}<span class="st">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>` : '';
        b.onclick = () => {
          sfx.init();
          sfx.click();
          this.show('levels', false);
          this.startLevel(idx);
        };
        row.appendChild(b);
      });
      card.appendChild(row);
      list.appendChild(card);
    });
    this.show('levels', true);
  }

  setPaused(v) {
    if (this.state !== 'play' && this.state !== 'box' && !this.paused) return;
    this.paused = v;
    this.show('pause', v);
    if (!v) this.lastFrame = performance.now();
  }

  // -------------------------------------------------------------- scene building
  bgTexture(spec) {
    let t = this.bgCache.get(spec.id);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 128;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, spec.bg[0]);
    gr.addColorStop(1, spec.bg[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, 8, 128);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.bgCache.set(spec.id, t);
    return t;
  }

  clearRoom() {
    for (const p of this.pieces) this.disposePiece(p);
    this.pieces = [];
    for (const s of this.slots) if (s.ghost) this.roomGroup.remove(s.ghost);
    this.slots = [];
    this.phys.dispose();
    if (this.room) {
      this.roomGroup.remove(this.room.group);
      this.room.dispose();
      this.room = null;
    }
    this.tweens.length = 0;
    this.drag = null;
    this.hintPiece = null;
    this.boxOpened = false;
    this.bodiesAwake = false;
    this.tutorial = false;
    this.box.group.visible = false;
    this.box.shadow.visible = false;
  }

  /**
   * mode 'dream': all stages placed (menu preview)
   * mode 'level': stages before `stage` placed, `stage` becomes ghosts + boxed pieces
   */
  loadRoom(ri, stage, mode) {
    this.clearRoom();
    const spec = ROOMS[ri];
    this.roomIdx = ri;
    this.roomSpec = spec;
    shared.uSky.value.set(spec.sky);
    shared.uGround.value.set(spec.ground);
    this.scene.background = this.bgTexture(spec);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', spec.bg[0]);
    this.room = buildRoom(spec, this.phys);
    this.roomGroup.add(this.room.group);

    spec.stages.forEach((defs, si) => {
      const placed = mode === 'dream' || si < stage;
      const current = mode === 'level' && si === stage;
      defs.forEach((def) => {
        const type = getItemType(def.t);
        const pose = slotPose(def, type);
        const slot = { def, type, pose, filled: false, cur: current, piece: null, ghost: null, hot: false };
        this.slots.push(slot);
        if (placed) {
          const piece = this.makePiece(type, false);
          this.placePiece(piece, slot, true);
        } else if (current) {
          this.makeGhost(slot);
        }
      });
    });
    this.setProgress();

    if (mode === 'level') {
      // pieces waiting in the box, in a shuffled order
      const order = shuffle(this.slots.filter((s) => s.cur));
      order.forEach((slot) => {
        const piece = this.makePiece(slot.type, true);
        piece.state = 'box';
        piece.group.visible = false;
        piece.shadow.visible = false;
        piece.targetSlot = slot;
        this.pieces.push(piece);
      });
    }
    this.needIdleRender = true;
  }

  makePiece(type, withShadow) {
    const mat = makeMat();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(type.geo, mat);
    const outline = new THREE.Mesh(type.outline, this.outlineMat);
    group.add(mesh, outline);
    mesh.matrixAutoUpdate = outline.matrixAutoUpdate = false;
    mesh.updateMatrix();
    outline.updateMatrix();
    this.piecesGroup.add(group);
    const piece = { type, group, mesh, mat, body: null, state: 'static', slot: null, shadow: null, yaw: 0, lastVy: 0, scale: 1, wiggle: 0 };
    const sm = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.6 });
    const shadow = new THREE.Mesh(this.shadowGeo, sm);
    shadow.renderOrder = 2;
    this.piecesGroup.add(shadow);
    piece.shadow = shadow;
    if (!withShadow) shadow.visible = true; // placed items keep a soft contact shadow
    return piece;
  }

  disposePiece(p) {
    this.piecesGroup.remove(p.group);
    this.piecesGroup.remove(p.shadow);
    p.mat.dispose();
    p.shadow.material.dispose();
    if (p.body) this.phys.remove(p.body);
    if (p.staticBody) this.phys.remove(p.staticBody);
  }

  makeGhost(slot) {
    const g = new THREE.Group();
    const fill = new THREE.Mesh(slot.type.geo, this.ghostFill);
    const edge = new THREE.Mesh(slot.type.outline, this.ghostEdge);
    fill.renderOrder = 3;
    edge.renderOrder = 2;
    g.add(fill, edge);
    g.position.set(slot.pose.x, slot.pose.y, slot.pose.z);
    g.rotation.y = slot.pose.ry;
    slot.ghost = g;
    slot.ghostFill = fill;
    slot.ghostEdge = edge;
    this.roomGroup.add(g);
  }

  setGhostHot(slot, hot) {
    if (!slot.ghost || slot.hot === hot) return;
    slot.hot = hot;
    slot.ghostFill.material = hot ? this.ghostFillHot : this.ghostFill;
    slot.ghostEdge.material = hot ? this.ghostEdgeHot : this.ghostEdge;
  }

  shapeFor(type) {
    const c = type.col;
    return c.kind === 'box' ? this.phys.boxShape(c.hx, c.hy, c.hz) : this.phys.cylShape(c.hh, c.r);
  }

  // Turn a piece into permanent decoration at its slot (static collider so other items can rest on it)
  placePiece(piece, slot, instant) {
    const p = slot.pose;
    piece.state = 'placed';
    piece.slot = slot;
    slot.filled = true;
    slot.piece = piece;
    piece.group.position.set(p.x, p.y, p.z);
    piece.group.rotation.set(0, p.ry, 0);
    piece.group.scale.setScalar(1);
    piece.group.updateMatrix();
    this.tmp.q.setFromAxisAngle(UP, p.ry);
    piece.staticBody = this.phys.addStaticShape(this.shapeFor(piece.type), p.x, p.y, p.z, this.tmp.q);
    this.placeShadow(piece, p.x, p.y, p.z);
    if (slot.ghost) {
      this.roomGroup.remove(slot.ghost);
      slot.ghost = null;
    }
    if (instant) this.pieces.push(piece);
    piece.mat.uniforms.uGlow.value = 0;
    piece.mat.uniforms.uTintAmt.value = 0;
  }

  placeShadow(piece, x, y, z) {
    const t = piece.type;
    const bottom = y - t.half.y;
    if (t.wall) {
      piece.shadow.visible = false;
      return;
    }
    const sy = this.room.supportY(x, z, bottom + 0.1);
    const h = Math.max(0, bottom - sy);
    const s = Math.max(t.half.x, t.half.z) * 2.5 * (1 + h * 0.12);
    piece.shadow.visible = true;
    piece.shadow.position.set(x + 0.05 + h * 0.1, sy + 0.02, z + 0.06 + h * 0.1);
    piece.shadow.scale.set(s, 1, s * 0.92);
    piece.shadow.material.opacity = clamp(0.7 - h * 0.18, 0.1, 0.7);
  }

  // -------------------------------------------------------------- box + unpacking
  buildBox() {
    const col = '#f1bf8a';
    const body = mergeParts([
      { t: 'b', w: 1.7, h: 1.1, d: 1.5, rad: 0.09, p: [0, 0.55, 0], c: col },
      { t: 'b', w: 1.55, h: 0.04, d: 1.35, rad: 0.02, p: [0, 1.1, 0], c: '#7b4f33' },
      { t: 'b', w: 1.72, h: 0.2, d: 1.52, rad: 0.06, p: [0, 0.1, 0], c: '#e3a870' },
      { t: 'b', w: 0.38, h: 1.12, d: 1.52, rad: 0.03, p: [0, 0.55, 0], c: '#ffe9c4' },
      { t: 'heart', k: 0.8, depth: 0.04, bevel: 0.05, p: [-0.4, 0.62, 0.76], c: '#ff8fb5' },
      { t: 's', r: 0.05, p: [-0.48, 0.66, 0.84], sc: [1, 1.3, 0.5], c: '#2b2540', seg: 8 },
      { t: 's', r: 0.05, p: [-0.32, 0.66, 0.84], sc: [1, 1.3, 0.5], c: '#2b2540', seg: 8 },
    ]);
    const flapGeo = (sx) =>
      mergeParts([
        { t: 'b', w: 0.86, h: 0.07, d: 1.5, rad: 0.03, p: [sx * 0.43, 0.035, 0], c: col },
        { t: 'b', w: 0.2, h: 0.08, d: 1.52, rad: 0.03, p: [sx * 0.76, 0.04, 0], c: '#ffe9c4' },
      ]);
    const g = new THREE.Group();
    const bm = new THREE.Mesh(body, makeMat());
    const om = null;
    g.add(bm);
    const flapL = new THREE.Group();
    const flapR = new THREE.Group();
    flapL.position.set(-0.85, 1.1, 0);
    flapR.position.set(0.85, 1.1, 0);
    flapL.add(new THREE.Mesh(flapGeo(1), bm.material));
    flapR.add(new THREE.Mesh(flapGeo(-1), bm.material));
    g.add(flapL, flapR);
    g.position.copy(BOX_POS);
    g.rotation.y = 0.35;
    g.visible = false;
    this.roomGroup.add(g);
    const sh = new THREE.Mesh(this.shadowGeo, new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.7 }));
    sh.scale.set(3, 1, 2.8);
    sh.position.set(BOX_POS.x + 0.1, 0.02, BOX_POS.z + 0.1);
    this.roomGroup.add(sh);
    this.box = { group: g, flapL, flapR, shadow: sh, open: 0 };
  }

  startBoxIntro() {
    const b = this.box;
    b.group.visible = true;
    b.shadow.visible = true;
    b.flapL.rotation.z = b.flapR.rotation.z = 0;
    b.group.scale.setScalar(1);
    b.group.position.set(BOX_POS.x, 9, BOX_POS.z);
    this.boxDrop = 0;
    this.addTween(0.75, (k) => {
      // gravity-style drop followed by two small bounces
      b.group.position.y = k < 0.55 ? 9 * (1 - (k / 0.55) ** 2) : k < 0.8 ? Math.sin(((k - 0.55) / 0.25) * Math.PI) : 0.25 * Math.sin(((k - 0.8) / 0.2) * Math.PI);
      b.shadow.material.opacity = 0.7 * smooth(Math.min(1, k * 1.5));
    }, () => {
      b.group.position.y = 0;
      sfx.thud(0.9);
      this.fx.ring(BOX_POS.x, 0.05, BOX_POS.z, 0xffe9c4);
      this.fx.sparkle(BOX_POS.x, 0.3, BOX_POS.z, 10, { speed: 2, size: 18, colors: [new THREE.Color('#ffe9c4')] });
      this.state = 'box';
      this.toast(isMobile ? 'Tap the box to unpack! 📦' : 'Click the box to unpack! 📦', 3500);
    }, (k) => k);
  }

  openBox() {
    if (this.boxOpened) return;
    this.boxOpened = true;
    this.state = 'unpack';
    const b = this.box;
    sfx.init();
    $('toast').classList.remove('show');
    // flaps burst open + squash and stretch
    this.addTween(0.5, (k) => {
      const e = easeOutBack(k, 2.4);
      b.flapL.rotation.z = e * 1.9;
      b.flapR.rotation.z = -e * 1.9;
      const sq = Math.sin(k * Math.PI);
      b.group.scale.set(1 + sq * 0.14, 1 - sq * 0.12, 1 + sq * 0.14);
    }, null, (k) => k);
    const queue = this.pieces.filter((p) => p.state === 'box');
    // landing grid in the clear floor area in front of the furniture
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) cells.push([-3.1 + c * 1.12 + (r % 2) * 0.5 + rand(-0.12, 0.12), 1.25 + r * 0.95 + rand(-0.1, 0.1)]);
    const pick = cells.filter(([x]) => x < 2.55).sort(() => Math.random() - 0.5).slice(0, queue.length);
    queue.forEach((piece, i) => {
      const delay = 0.28 + i * 0.13;
      this.addTween(delay, () => {}, () => this.popOut(piece, pick[i] || [0, 2], i), (k) => k);
    });
    this.addTween(0.28 + queue.length * 0.13 + 0.5, () => {}, () => {
      if (this.state === 'unpack') this.state = 'play';
      // box hops away
      this.addTween(0.45, (k) => {
        const e = easeOutBack(k, 2);
        b.group.scale.setScalar(Math.max(0.001, 1 - e));
        b.group.position.y = Math.sin(k * Math.PI) * 0.6;
        b.shadow.material.opacity = 0.7 * (1 - k);
      }, () => {
        b.group.visible = false;
        b.shadow.visible = false;
        this.fx.sparkle(BOX_POS.x, 0.6, BOX_POS.z, 14, { speed: 2.5, size: 20, colors: [new THREE.Color('#ffe9c4'), new THREE.Color('#ffffff')] });
      }, (k) => k);
      this.maybeTutorial();
    }, (k) => k);
  }

  popOut(piece, cell, i) {
    const t = piece.type;
    const start = this.tmp.v.set(BOX_POS.x - 0.1, 1.5, BOX_POS.z);
    const ty = t.wall ? 0.15 + t.half.y : t.half.y + 0.05;
    const T = 0.62 + rand(0, 0.12);
    const vx = (cell[0] - start.x) / T;
    const vz = (cell[1] - start.z) / T;
    const vy = (ty - start.y + 0.5 * GRAVITY * T * T) / T;
    this.tmp.e.set(rand(-0.12, 0.12), rand(0, 6.28), rand(-0.12, 0.12));
    this.tmp.q.setFromEuler(this.tmp.e);
    piece.body = this.phys.addDynamic(this.shapeFor(t), start.x, start.y, start.z, this.tmp.q, { friction: 0.8, restitution: 0.22 });
    this.phys.setVel(piece.body, vx, vy, vz);
    this.phys.setAng(piece.body, rand(-1.5, 1.5), rand(-8, 8), rand(-1.5, 1.5));
    piece.state = 'free';
    piece.group.visible = true;
    piece.shadow.visible = true;
    piece.group.position.copy(start);
    piece.popT = 0;
    sfx.pop(i);
    this.buzz(8);
    this.fx.sparkle(start.x, start.y, start.z, 6, { speed: 1.6, size: 18 });
    this.addTween(0.35, (k) => piece.group.scale.setScalar(Math.max(0.01, easeOutBack(k, 2.2))), () => piece.group.scale.setScalar(1), (k) => k);
  }

  // -------------------------------------------------------------- levels
  startLevel(idx) {
    this.show('menu', false);
    this.show('win', false);
    this.show('levels', false);
    this.show('settings', false);
    this.show('pause', false);
    this.paused = false;
    const fade = $('fade');
    fade.classList.add('on');
    setTimeout(() => {
      const L = LEVELS[idx];
      this.levelIdx = idx;
      this.loadRoom(L.room, L.stage, 'level');
      this.state = 'intro';
      this.menuK = 0;
      this.zoom = 1;
      this.yaw = 0;
      this.camIntro = 0;
      this.combo = 0;
      this.misses = 0;
      this.hintsUsed = 0;
      this.hintFreeUsed = false;
      $('lvl-name').textContent = `${ROOMS[L.room].emoji} ${L.name}`;
      this.setCoins(this.save.coins);
      this.updateHintLabel();
      $('btn-hint').style.visibility = '';
      this.show('hud', true);
      this.applyCamera();
      fade.classList.remove('on');
      this.addTween(1.1, (k) => (this.camIntro = k), () => (this.camIntro = 1), (k) => k);
      setTimeout(() => this.startBoxIntro(), 450);
    }, 320);
  }

  showMenu() {
    const fade = $('fade');
    fade.classList.add('on');
    setTimeout(() => {
      const idx = this.firstOpenLevel();
      this.loadRoom(LEVELS[idx].room, 0, 'dream');
      this.state = 'menu';
      this.show('hud', false);
      this.show('win', false);
      this.show('pause', false);
      this.show('menu', true);
      this.camIntro = 1;
      this.zoom = 1;
      this.menuK = 1;
      this.applyCamera();
      fade.classList.remove('on');
    }, 320);
  }

  updateHintLabel() {
    const em = $('hint-cost');
    em.textContent = this.hintFreeUsed ? String(HINT_COST) : 'free';
  }

  useHint() {
    if (this.state !== 'play' && this.state !== 'unpack') return;
    const cands = this.pieces.filter((p) => p.state === 'free' && !p.slot);
    if (!cands.length) return;
    if (this.hintFreeUsed) {
      if (this.save.coins < HINT_COST) {
        sfx.wrong();
        this.toast('Not enough coins! Finish rooms to earn more 🪙');
        return;
      }
      this.setCoins(this.save.coins - HINT_COST);
    }
    this.hintFreeUsed = true;
    this.hintsUsed++;
    this.updateHintLabel();
    const piece = cands[(Math.random() * cands.length) | 0];
    this.clearHint();
    this.hintPiece = piece;
    this.hintT = 4.5;
    this.setGhostHot(piece.targetSlot, true);
    piece.mat.uniforms.uTint.value.set('#fff3a0');
    sfx.hint();
    this.toast('Bring the glowing sticker to its outline ✨', 2600);
  }

  clearHint() {
    if (!this.hintPiece) return;
    const p = this.hintPiece;
    p.mat.uniforms.uGlow.value = 0;
    p.mat.uniforms.uTintAmt.value = 0;
    if (p.targetSlot && !p.slot) this.setGhostHot(p.targetSlot, false);
    this.hintPiece = null;
  }

  maybeTutorial() {
    if (this.levelIdx !== 0 || this.save.tutorialDone) return;
    this.tutorial = true;
  }

  // -------------------------------------------------------------- input
  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  screenOf(v, out) {
    out.copy(v).project(this.camera);
    return { x: (out.x * 0.5 + 0.5) * this.W, y: (-out.y * 0.5 + 0.5) * this.H, z: out.z };
  }

  pxPerUnitAt(pos) {
    const d = this.camera.position.distanceTo(pos);
    return this.H / 2 / Math.tan((FOV * Math.PI) / 360) / d;
  }

  pickPiece(x, y, wantFree) {
    let best = null;
    let bestScore = 1e9;
    const v = this.tmp.v2;
    for (const p of this.pieces) {
      if (wantFree ? p.state !== 'free' : p.state !== 'placed') continue;
      v.copy(p.group.position);
      const s = this.screenOf(v, this.tmp.v);
      const r = Math.max(p.type.radius * this.pxPerUnitAt(p.group.position) * 0.95, isMobile ? 38 : 26);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > r) continue;
      const score = d / r - s.z * 0.2; // prefer nearer (smaller z in NDC) items on ties
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  onDown(e) {
    sfx.init();
    if (this.paused) return;
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    if (this.state === 'box') {
      this.openBox();
      return;
    }
    if (this.state !== 'play' && this.state !== 'unpack') return;
    if (this.drag) return;
    const piece = this.pickPiece(e.clientX, e.clientY, true);
    if (!piece) {
      const deco = this.pickPiece(e.clientX, e.clientY, false);
      if (deco) this.wiggle(deco);
      return;
    }
    this.canvas.setPointerCapture?.(e.pointerId);
    if (this.tutorial) {
      this.tutorial = false;
      this.save.tutorialDone = true;
      writeSave(this.save);
      $('hand').style.opacity = 0;
    }
    this.beginDrag(piece, e);
  }

  beginDrag(piece, e) {
    const cam = this.camera;
    const pos = piece.group.position;
    // camera-facing plane through the piece
    const n = cam.getWorldDirection(this.tmp.v).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, pos);
    const hit = this.rayToPlane(e.clientX, e.clientY, plane, new THREE.Vector3());
    this.drag = {
      piece,
      plane,
      off: hit ? pos.clone().sub(hit) : new THREE.Vector3(),
      t: 0,
      pointerId: e.pointerId,
      magnet: null,
      lastMag: null,
    };
    // current yaw
    this.tmp.e.setFromQuaternion(piece.group.quaternion, 'YXZ');
    piece.yaw = this.tmp.e.y;
    piece.state = 'held';
    this.phys.setHeld(piece.body, true);
    this.phys.wake(piece.body);
    sfx.grab();
    this.buzz(6);
    if (this.hintPiece === piece) this.clearHint();
    this.addTween(0.18, (k) => (piece.group.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI * 0.5))), null, (k) => k);
  }

  rayToPlane(x, y, plane, out) {
    const ndc = this.tmp.v2.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const ray = this.tmp.r;
    ray.origin.copy(this.camera.position);
    ray.direction.copy(ndc).sub(this.camera.position).normalize();
    return ray.intersectPlane(plane, out);
  }

  onMove(e) {
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
  }

  onUp(e) {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.endDrag();
  }

  endDrag() {
    const d = this.drag;
    this.drag = null;
    const piece = d.piece;
    if (piece.state !== 'held') return;
    this.phys.setHeld(piece.body, false);
    const lv = piece.body.GetLinearVelocity();
    const sp = Math.hypot(lv.GetX(), lv.GetY(), lv.GetZ());
    if (sp > 12) this.phys.setVel(piece.body, (lv.GetX() / sp) * 12, (lv.GetY() / sp) * 12, (lv.GetZ() / sp) * 12);
    piece.state = 'free';
    this.addTween(0.2, (k) => piece.group.scale.setScalar(1.12 - 0.12 * k), () => piece.group.scale.setScalar(1), (k) => k);
    if (d.magnet && d.magnet.k > 0.35) {
      this.snapPiece(piece, d.magnet.slot);
    } else {
      // dropped near a wrong outline? tiny feedback
      let wrong = false;
      for (const s of this.slots) {
        if (!s.cur || s.filled || s.type === piece.type) continue;
        const sc = this.screenOf(this.tmp.v2.set(s.pose.x, s.pose.y, s.pose.z), this.tmp.s);
        if (Math.hypot(sc.x - this.ptr.x, sc.y - this.ptr.y) < 40) wrong = true;
      }
      if (wrong) {
        this.misses++;
        sfx.wrong();
      }
      sfx.thud(0.3);
    }
    if (d.lastMag) this.setGhostHot(d.lastMag, false);
  }

  wiggle(piece) {
    if (piece.wiggle > 0) return;
    piece.wiggle = 0.0001;
    sfx.pop(2 + ((Math.random() * 4) | 0));
    this.buzz(5);
    const g = piece.group;
    this.addTween(0.5, (k) => {
      const s = easeOutElastic(k);
      const sq = Math.sin(k * Math.PI * 4) * (1 - k) * 0.14;
      g.scale.set(1 + sq, 1 - sq * 1.2, 1 + sq);
      g.updateMatrix();
    }, () => {
      g.scale.setScalar(1);
      piece.wiggle = 0;
    }, (k) => k);
    this.fx.sparkle(g.position.x, g.position.y + piece.type.half.y, g.position.z, 4, { speed: 1.2, size: 14 });
  }

  // -------------------------------------------------------------- snapping
  snapPiece(piece, slot) {
    this.phys.remove(piece.body);
    piece.body = null;
    piece.state = 'snapping';
    slot.filled = true; // reserve
    slot.piece = piece;
    if (this.hintPiece === piece) this.clearHint();
    const g = piece.group;
    const p0 = g.position.clone();
    const q0 = g.quaternion.clone();
    const q1 = new THREE.Quaternion().setFromAxisAngle(UP, slot.pose.ry);
    const p1 = new THREE.Vector3(slot.pose.x, slot.pose.y, slot.pose.z);
    this.setGhostHot(slot, false);
    this.addTween(0.28, (k) => {
      const e = easeOutBack(k, 1.6);
      g.position.lerpVectors(p0, p1, e);
      g.quaternion.slerpQuaternions(q0, q1, smooth(k));
      this.placeShadow(piece, g.position.x, g.position.y, g.position.z);
    }, () => {
      slot.filled = false;
      this.placePiece(piece, slot, false);
      this.onPlaced(piece, slot);
    }, (k) => k);
  }

  onPlaced(piece, slot) {
    const p = slot.pose;
    const g = piece.group;
    // sticker "boing"
    this.addTween(0.55, (k) => {
      const e = easeOutElastic(k);
      const sq = (1 - e) * 0.28;
      g.scale.set(1 + sq, 1 - sq, 1 + sq);
    }, () => g.scale.setScalar(1), (k) => k);
    const top = p.y + slot.type.half.y;
    this.fx.sparkle(p.x, p.y, p.z, 18, { speed: 3, size: 26, up: 1.2 });
    this.fx.ring(p.x, Math.max(0.03, p.y - slot.type.half.y + 0.03), p.z, 0xfff3b0);
    this.combo = this.time - this.lastPlace < 4.5 ? this.combo + 1 : 1;
    this.lastPlace = this.time;
    sfx.snap(this.combo);
    this.buzz(14);
    const coins = 5 + Math.min(this.combo - 1, 5) * 2;
    this.setCoins(this.save.coins + coins, true);
    this.floater(`+${coins}`, p.x, top + 0.3, p.z);
    if (this.combo >= 2) {
      const c = $('combo');
      c.textContent = `Combo x${this.combo}!`;
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
    this.setProgress();
    if (this.placedCount >= this.totalCount) this.win();
  }

  win() {
    this.state = 'win';
    this.clearHint();
    $('btn-hint').style.visibility = 'hidden';
    const L = LEVELS[this.levelIdx];
    let stars = 3 - (this.hintsUsed > 1 ? 1 : 0) - (this.misses > 6 ? 1 : 0);
    stars = clamp(stars, 1, 3);
    const prev = this.save.stars[L.id] || 0;
    this.save.stars[L.id] = Math.max(prev, stars);
    const reward = 25 + stars * 10;
    this.setCoins(this.save.coins + reward, true);
    this.winStars = stars;
    this.winReward = reward;
    this.addTween(0.5, () => {}, () => {
      sfx.win();
      this.buzz(60);
      const cx = -0.2;
      for (let i = 0; i < 4; i++) {
        this.addTween(i * 0.18, () => {}, () => this.fx.confetti(cx + rand(-3, 3), 4.5 + i * 0.3, rand(-1, 2), 60), (k) => k);
      }
      this.fx.sparkle(cx, 3, 0, 40, { speed: 6, size: 34 });
    }, (k) => k);
    // celebratory camera swing
    const y0 = this.yaw;
    this.addTween(3.2, (k) => {
      this.yaw = y0 + Math.sin(k * Math.PI) * 0.35;
      this.zoom = 1 - Math.sin(k * Math.PI) * 0.12;
    }, () => {}, smooth);
    setTimeout(() => this.showWin(), 1700);
  }

  showWin() {
    if (this.state !== 'win') return;
    const L = LEVELS[this.levelIdx];
    const stars = $('win-stars').children;
    for (let i = 0; i < 3; i++) {
      stars[i].className = i < this.winStars ? 'on' : 'off';
      stars[i].style.setProperty('--d', 0.35 + i * 0.3 + 's');
      stars[i].style.animation = 'none';
      void stars[i].offsetWidth;
      stars[i].style.animation = '';
    }
    $('win-coins').textContent = '+' + this.winReward;
    const last = this.levelIdx >= LEVELS.length - 1;
    $('btn-next').textContent = last ? '🏠 Home' : 'Next ▶';
    this.show('win', true);
    for (let i = 0; i < this.winStars; i++) setTimeout(() => sfx.snap(i + 3), 400 + i * 300);
  }

  // -------------------------------------------------------------- tweens
  addTween(dur, upd, end, ease = smooth) {
    this.tweens.push({ t: 0, dur: Math.max(dur, 0.0001), upd, end, ease });
  }

  updateTweens(dt) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      if (tw.upd) tw.upd(tw.ease(k));
      if (k >= 1) {
        this.tweens.splice(i, 1);
        if (tw.end) tw.end();
      }
    }
  }

  // -------------------------------------------------------------- main loop
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    if (this.hidden || this.ctxLost) return;
    const active = this.isActive();
    const interval = active ? this.minInterval : this.state === 'menu' ? 1000 / 30 : 1000 / 20;
    if (t - this.lastRender < interval - 2.5 && !this.needIdleRender) return;
    const dtMs = t - this.lastFrame;
    this.lastFrame = t;
    this.lastRender = t;
    const dt = Math.min(dtMs / 1000, 0.05);
    this.time += dt;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.needIdleRender = false;
    if (active && !this.paused && this.quality.sample(dtMs)) {
      this.renderer.setPixelRatio(this.quality.dpr);
      this.renderer.setSize(this.W, this.H, false);
      this.fx.setScale(this.renderer.domElement.height, FOV);
      this.fx.setQuality(this.quality.dpr >= 0.9 ? 1 : 0);
    }
  }

  isActive() {
    if (this.paused) return false;
    return this.drag || this.tweens.length > 0 || this.fx.active || this.bodiesAwake || this.state === 'box' || this.state === 'intro' || this.tutorial || this.hintPiece || this.state === 'win';
  }

  update(dt) {
    const t = this.time;
    if (this.paused) return;
    this.updateTweens(dt);

    if (this.state === 'menu') {
      this.yaw = Math.sin(t * 0.35) * 0.28;
    }
    this.applyCamera();

    // physics + drag
    if (this.state !== 'menu') {
      if (this.drag) this.updateDrag(dt);
      const steps = this.phys.step(dt);
      this.syncPieces(steps > 0);
    }

    // ghosts: soft pulse (cheap: uniform only)
    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    this.ghostFill.uniforms.uAlpha.value = 0.3 + pulse * 0.16;
    this.ghostFillHot.uniforms.uAlpha.value = 0.5 + pulse * 0.3;
    for (const s of this.slots) if (s.ghost) s.ghost.scale.setScalar(s.hot ? 1.0 + pulse * 0.05 : 1);

    // box idle bob
    if (this.state === 'box') {
      const b = this.box;
      const k = Math.sin(t * 5) * 0.5 + 0.5;
      b.group.scale.set(1 + k * 0.05, 1 - k * 0.04, 1 + k * 0.05);
      b.group.rotation.y = 0.35 + Math.sin(t * 2.4) * 0.05;
    }

    // hint
    if (this.hintPiece) {
      const p = this.hintPiece;
      this.hintT -= dt;
      p.mat.uniforms.uTintAmt.value = 0.0;
      p.mat.uniforms.uGlow.value = 0.35 + 0.45 * Math.sin(t * 9) ** 2;
      p.mat.uniforms.uTint.value.set('#ffe680');
      if (Math.floor(t * 12) !== Math.floor((t - dt) * 12)) {
        const s = p.targetSlot.pose;
        const k = (t * 1.6) % 1;
        this.fx.sparkle(lerp(p.group.position.x, s.x, k), lerp(p.group.position.y, s.y, k) + 0.3, lerp(p.group.position.z, s.z, k), 1, { speed: 0.3, size: 20, dur: 0.5, colors: [new THREE.Color('#fff3a0')] });
      }
      if (this.hintT <= 0) this.clearHint();
    }

    this.fx.update(dt, t);
    this.updateHand();
  }

  updateDrag(dt) {
    const d = this.drag;
    const piece = d.piece;
    if (piece.state !== 'held' || !piece.body) return;
    d.t += dt;
    const lift = isMobile ? 46 * Math.min(1, d.t / 0.15) : 0;
    const ex = this.ptr.x;
    const ey = this.ptr.y - lift;
    const target = this.tmp.v;
    const hit = this.rayToPlane(ex, ey, d.plane, target);
    const pos = piece.group.position;
    if (!hit) return;
    target.add(d.off);
    const half = piece.type.half;
    // keep inside the room box
    target.x = clamp(target.x, -4.5 + half.x, 4.4 - half.x);
    target.z = clamp(target.z, -3.45 + half.z, 3.45 - half.z);
    const floorY = this.room.supportY(target.x, target.z, 6) + (piece.type.wall ? half.y : half.y);
    target.y = clamp(target.y, floorY + 0.05, 5.3);

    // magnet towards the matching outline
    let best = null;
    let bestD = 1e9;
    const R = clamp(0.13 * Math.min(this.W, this.H), 54, 100);
    for (const s of this.slots) {
      if (!s.cur || s.filled || s.type !== piece.type) continue;
      const sc = this.screenOf(this.tmp.v2.set(s.pose.x, s.pose.y, s.pose.z), this.tmp.s);
      const dist = Math.hypot(sc.x - ex, sc.y - ey);
      if (dist < R && dist < bestD) {
        bestD = dist;
        best = s;
      }
    }
    if (best) {
      const k = 1 - clamp((bestD - R * 0.35) / (R * 0.65), 0, 1);
      d.magnet = { slot: best, k };
      const sp = best.pose;
      const m = smooth(k);
      target.x = lerp(target.x, sp.x, m);
      target.y = lerp(target.y, sp.y + 0.15 * (1 - m), m);
      target.z = lerp(target.z, sp.z, m);
      piece.yaw = lerpAngle(piece.yaw, sp.ry, 1 - Math.exp(-10 * dt) * 1);
      if (d.lastMag !== best) {
        if (d.lastMag) this.setGhostHot(d.lastMag, false);
        this.setGhostHot(best, true);
        d.lastMag = best;
        sfx.tone(880, 0.07, { type: 'sine', vol: 0.08, slide: 1.2 });
        this.buzz(4);
      }
    } else {
      d.magnet = null;
      if (d.lastMag) {
        this.setGhostHot(d.lastMag, false);
        d.lastMag = null;
      }
      // face the camera-ish while carrying
      piece.yaw = lerpAngle(piece.yaw, piece.type.wall ? 0.3 : piece.yaw, 1 - Math.exp(-6 * dt));
    }

    // velocity-driven carry: collides with loose items, feels weighty & springy
    const k = 26;
    let vx = (target.x - pos.x) * k;
    let vy = (target.y - pos.y) * k;
    let vz = (target.z - pos.z) * k;
    const sp = Math.hypot(vx, vy, vz);
    const maxV = 46;
    if (sp > maxV) {
      const s = maxV / sp;
      vx *= s;
      vy *= s;
      vz *= s;
    }
    this.phys.setVel(piece.body, vx, vy, vz);

    // sway: lean into the motion, then steer orientation with angular velocity
    const tiltX = clamp(vz * 0.018, -0.45, 0.45);
    const tiltZ = clamp(-vx * 0.018, -0.45, 0.45);
    const e = this.tmp.e.set(tiltX, piece.yaw, tiltZ, 'YXZ');
    const qT = this.tmp.q2.setFromEuler(e);
    const qC = this.tmp.q.copy(piece.group.quaternion);
    const qErr = qT.multiply(qC.invert());
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const ang = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const sn = Math.sqrt(1 - qErr.w * qErr.w);
    if (sn > 1e-4 && ang > 1e-3) {
      const m = Math.min(ang * 16, 40) / sn;
      this.phys.setAng(piece.body, qErr.x * m, qErr.y * m, qErr.z * m);
    } else {
      this.phys.setAng(piece.body, 0, 0, 0);
    }
  }

  syncPieces() {
    let awake = false;
    for (const p of this.pieces) {
      if (!p.body) continue;
      const body = p.body;
      const held = p.state === 'held';
      if (!held && !body.IsActive()) continue;
      awake = true;
      const pos = body.GetPosition();
      const rot = body.GetRotation();
      const g = p.group;
      g.position.set(pos.GetX(), pos.GetY(), pos.GetZ());
      g.quaternion.set(rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW());
      if (g.position.y < -3) {
        // safety net: never lose a sticker
        this.phys.setTransform(body, 0, 3, 2, this.tmp.q.identity());
        this.phys.setVel(body, 0, 0, 0);
      }
      const lv = body.GetLinearVelocity();
      const vy = lv.GetY();
      // "weeble" self-righting: settled stickers wobble back upright (wall stickers stay flat)
      if (!held && !p.type.wall) {
        const qx = rot.GetX();
        const qy = rot.GetY();
        const qz = rot.GetZ();
        const qw = rot.GetW();
        const ux = 2 * (qx * qy - qw * qz);
        const uy = 1 - 2 * (qx * qx + qz * qz);
        const uz = 2 * (qy * qz + qw * qx);
        const speed = Math.abs(lv.GetX()) + Math.abs(vy) + Math.abs(lv.GetZ());
        if (uy < 0.985 && speed < 4.5 && g.position.y > -1) {
          const wy = body.GetAngularVelocity().GetY();
          this.phys.setAng(body, -uz * 7, wy * 0.9, ux * 7);
        }
      }
      if (!held && p.lastVy < -2.5 && vy > p.lastVy + 2) {
        sfx.thud(clamp(-p.lastVy / 12, 0.15, 0.8));
        if (p.lastVy < -6) this.fx.sparkle(g.position.x, g.position.y - p.type.half.y, g.position.z, 2, { speed: 0.8, size: 12, dur: 0.35, colors: [new THREE.Color('#ffffff')] });
      }
      p.lastVy = vy;
      this.placeShadow(p, g.position.x, g.position.y, g.position.z);
    }
    this.bodiesAwake = awake;
  }

  updateHand() {
    const hand = $('hand');
    if (!this.tutorial) return;
    const piece = this.pieces.find((p) => p.state === 'free');
    if (!piece || this.bodiesAwake) {
      hand.style.opacity = 0;
      return;
    }
    const s = piece.targetSlot.pose;
    const a = this.screenOf(piece.group.position, this.tmp.v);
    const b = this.screenOf(this.tmp.v2.set(s.x, s.y, s.z), this.tmp.v);
    const k = (this.time % 2.4) / 2.4;
    const e = k < 0.15 ? 0 : k > 0.8 ? 1 : smooth((k - 0.15) / 0.65);
    const x = lerp(a.x, b.x, e);
    const y = lerp(a.y, b.y, e);
    const op = k < 0.08 ? k / 0.08 : k > 0.9 ? (1 - k) / 0.1 : 1;
    hand.style.opacity = op;
    hand.style.transform = `translate(${(x - 18).toFixed(1)}px, ${(y + 6).toFixed(1)}px) scale(${k > 0.12 && k < 0.82 ? 0.88 : 1})`;
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
