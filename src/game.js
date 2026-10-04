import * as THREE from 'three';
import { Physics } from './physics.js';
import { makeMat, shared, blobTexture } from './materials.js';
import { getItemType, mergeParts, setDetail, ITEM_DEFS } from './items.js';
import { ROOMS, ROOM, buildRoom, slotPose } from './rooms.js';
import { FX } from './fx.js';
import { Meadow } from './meadow.js';
import { sfx } from './audio.js';
import { loadSave, writeSave } from './storage.js';
import { Quality } from './quality.js';
import { detectTier, TIER_CFG } from './tier.js';
import { encodeSave, decodeSave, applyCode } from './savecode.js';
import { clamp, lerp, rand, shuffle, smooth, easeOutBack, easeOutCubic, easeOutElastic, isMobile } from './util.js';

const FOV = 30;
const TARGET = new THREE.Vector3(-0.2, 1.7, 0.1);
const BOUNDS = [new THREE.Vector3(-5.0, -0.9, -4.1), new THREE.Vector3(4.8, 5.9, 3.9)];
const BOX_POS = new THREE.Vector3(3.5, 0, 2.55);
const GRAVITY = 24;
const HINT_COST = 15;
const UP = new THREE.Vector3(0, 1, 0);
const ZOOM_MIN = 0.72;
const ZOOM_MAX = 3.2;
const IDLE_TUTORIAL_S = 9; // hand reappears after this long without input
const REST_AFTER_S = 45; // ambient animation slows down further after this long idle
const TUTORIAL_PLAYS = 3; // guided hand only on the first 3 levels played

export const LEVELS = [];
ROOMS.forEach((r, ri) => r.stages.forEach((s, si) => LEVELS.push({ id: `${r.id}-${si + 1}`, room: ri, stage: si, name: `${r.name} ${si + 1}` })));

const $ = (id) => document.getElementById(id);
const now = () => performance.now() / 1000; // wall clock (game time pauses while idle-throttled)
const COL_WHITE = [new THREE.Color('#ffffff')];
const COL_HINT = [new THREE.Color('#fff3a0')];
const COL_BOX = [new THREE.Color('#ffe9c4'), new THREE.Color('#ffffff')];

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
    this.pointers = new Map();
    this.pinch = null;
    this.panCand = null;
    this.lastTap = { t: -10, x: 0, y: 0 };
    this.view = { zoom: 1, tz: 1, px: 0, pz: 0, tpx: 0, tpz: 0 };
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
    this.lastInput = now();
    this.physKick = 0;
    this.needIdleRender = true;
    this.bgCache = new Map();
    this.thumbs = new Map();
    this.tmp = { v: new THREE.Vector3(), v2: new THREE.Vector3(), v3: new THREE.Vector3(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), e: new THREE.Euler(), r: new THREE.Ray(), s: new THREE.Vector3(), plane: new THREE.Plane() };
  }

  // ============================================================== setup
  async init() {
    this.tier = detectTier(this.save.settings.gfx);
    this.cfg = TIER_CFG[this.tier];
    setDetail(this.cfg.detail);
    const dpr = window.devicePixelRatio || 1;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.cfg.aa && dpr < 2,
      alpha: false,
      stencil: false,
      powerPreference: this.tier === 'high' ? 'high-performance' : 'low-power',
    }));
    this.quality = new Quality(this.cfg.dprCap);
    renderer.setPixelRatio(this.quality.dpr);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 1, 320);
    this.fitCam = new THREE.PerspectiveCamera(FOV, 1, 1, 320);
    this.fx = new FX(this.scene);
    this.fx.setQuality(this.cfg.motes ? 1 : 0);
    this.phys = new Physics();
    this.meadow = new Meadow(this.cfg);
    this.scene.add(this.meadow.group);

    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.roomGroup = new THREE.Group();
    this.piecesGroup = new THREE.Group();
    this.world.add(this.roomGroup, this.piecesGroup);

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
    this.resize(true);
    // coalesce resize storms (mobile URL bar, desktop window dragging) into one per frame
    window.addEventListener('resize', () => {
      if (!this._rz) this._rz = requestAnimationFrame(() => ((this._rz = 0), this.resize()));
    });
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      if (this.hidden) sfx.suspend();
      else {
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
      this.needIdleRender = true;
    });
    setInterval(() => this.checkIdle(), 1000);

    // warm shaders so the first level has no hitch
    this.loadRoom(0, 0, 'dream');
    renderer.compile(this.scene, this.camera);
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  resize(force) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!force && w === this.W && h === this.H) return;
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
    const V = this.view;
    const tgt = this.tmp.v3.set(TARGET.x + V.px, TARGET.y - (V.zoom > 1 ? Math.min(0.6, (V.zoom - 1) * 0.35) : 0), TARGET.z + V.pz);
    const d = (lerp(this.fitGame, this.fitMenu, this.menuK) * this.zoom * lerp(1.18, 1, easeOutCubic(this.camIntro))) / V.zoom;
    const dir = this.tmp.s.copy(this.dirBase).applyAxisAngle(UP, this.yaw + (1 - easeOutCubic(this.camIntro)) * -0.45);
    cam.position.copy(tgt).addScaledVector(dir, d);
    cam.lookAt(tgt);
    cam.updateMatrixWorld();
    const shift = this.menuK * d * 0.085;
    if (shift) {
      const up = this.tmp.v.setFromMatrixColumn(cam.matrixWorld, 1);
      cam.position.addScaledVector(up, shift);
      cam.lookAt(this.tmp.v2.copy(tgt).addScaledVector(up, shift));
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
    document.querySelectorAll('#set-gfx button').forEach((b) => b.classList.toggle('on', b.dataset.v === (s.gfx || 'auto')));
    $('gfx-note').textContent = `Now: ${{ low: 'Smooth', mid: 'Balanced', high: 'Pretty' }[this.tier]}`;
  }

  // ============================================================== UI
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
    on('btn-zen', () => this.showZenRooms());
    on('btn-code', () => this.showCode());
    on('btn-settings', () => this.show('settings', true));
    on('settings-close', () => this.show('settings', false));
    on('settings-code', () => {
      this.show('settings', false);
      this.showCode();
    });
    on('levels-close', () => this.show('levels', false));
    on('code-close', () => this.show('code', false));
    on('code-copy', () => this.copyCode());
    on('code-go', () => this.useCode($('code-in').value));
    $('code-in').addEventListener('keydown', (e) => e.key === 'Enter' && this.useCode(e.target.value));
    on('btn-pause', () => this.setPaused(true));
    on('btn-resume', () => this.setPaused(false));
    on('pause-code', () => this.showCode());
    on('btn-restart', () => {
      this.setPaused(false);
      this.state === 'zen' ? this.startZen(this.roomIdx) : this.startLevel(this.levelIdx);
    });
    on('btn-quit', () => {
      this.setPaused(false);
      this.showMenu();
    });
    on('btn-hint', () => this.useHint());
    on('btn-next', () => (this.levelIdx >= LEVELS.length - 1 ? this.showMenu() : this.startLevel(this.levelIdx + 1)));
    on('btn-replay', () => this.startLevel(this.levelIdx));
    on('btn-win-menu', () => this.showMenu());
    on('win-code', () => this.copyCode());
    on('zoom-in', () => this.zoomAt(this.W / 2, this.H / 2, this.view.tz * 1.45));
    on('zoom-out', () => this.zoomAt(this.W / 2, this.H / 2, this.view.tz / 1.45));
    on('zoom-reset', () => this.resetView());
    on('zen-clear', () => this.zenClear());
    on('zen-photo', () => this.setPhoto(true));
    on('btn-reset', () => {
      if (confirm('Reset all progress?')) {
        this.save.stars = {};
        this.save.coins = 100;
        this.save.tutorialPlays = 0;
        this.save.zen = {};
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
    document.querySelectorAll('#set-gfx button').forEach((b) =>
      b.addEventListener('click', () => {
        if (this.save.settings.gfx === b.dataset.v) return;
        this.save.settings.gfx = b.dataset.v;
        writeSave(this.save);
        this.applySettings();
        this.toast('Applying graphics…', 900);
        setTimeout(() => location.reload(), 450);
      })
    );
    $('photo-exit').addEventListener('click', () => this.setPhoto(false));
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

  roomUnlocked(ri) {
    return this.isUnlocked(LEVELS.findIndex((l) => l.room === ri));
  }

  showLevels() {
    const list = $('levels-list');
    $('levels-title').textContent = 'Rooms';
    list.innerHTML = '';
    const total = LEVELS.reduce((a, l) => a + (this.save.stars[l.id] || 0), 0);
    const head = document.createElement('div');
    head.className = 'levels-sum';
    head.textContent = `★ ${total} / ${LEVELS.length * 3}`;
    list.appendChild(head);
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
        const open = this.isUnlocked(idx);
        b.className = 'stage' + (open ? '' : ' locked');
        b.innerHTML = open ? `${idx + 1}<span class="st">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>` : '';
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

  showZenRooms() {
    const list = $('levels-list');
    $('levels-title').textContent = '🌿 Zen Mode';
    list.innerHTML = `<p class="zen-intro">No goals, no timer. Drag stickers from the tray and decorate however you like. Your rooms are saved automatically.</p>`;
    ROOMS.forEach((r, ri) => {
      const open = this.roomUnlocked(ri);
      const n = (this.save.zen[r.id] || []).length;
      const b = document.createElement('button');
      b.className = 'zen-room' + (open ? '' : ' locked');
      b.innerHTML = `<span class="em">${r.emoji}</span><span class="nm">${r.name}<small>${open ? (n ? `${n} stickers placed` : 'Empty room') : 'Unlock in story mode'}</small></span>`;
      b.onclick = () => {
        if (!open) return;
        sfx.init();
        sfx.click();
        this.show('levels', false);
        this.startZen(ri);
      };
      list.appendChild(b);
    });
    this.show('levels', true);
  }

  // ---------- save codes
  currentCode() {
    return encodeSave(this.save, LEVELS);
  }

  showCode() {
    $('code-now').textContent = this.currentCode();
    $('code-in').value = '';
    $('code-err').textContent = '';
    this.show('code', true);
  }

  copyCode() {
    const c = this.currentCode();
    navigator.clipboard?.writeText(c).then(
      () => this.toast(`Copied ${c} 📋`),
      () => this.toast(`Your code: ${c}`)
    );
    if (!navigator.clipboard) this.toast(`Your code: ${c}`);
  }

  useCode(raw) {
    const data = decodeSave(raw);
    if (!data) {
      sfx.wrong();
      $('code-err').textContent = 'That code doesn’t look right — check for typos.';
      return;
    }
    applyCode(this.save, data, LEVELS);
    writeSave(this.save);
    sfx.win();
    this.show('code', false);
    this.toast(`Welcome back! ${data.cleared} rooms restored ✨`, 3000);
    this.showMenu();
  }

  setPaused(v) {
    if (!['play', 'box', 'unpack', 'zen'].includes(this.state) && !this.paused) return;
    this.paused = v;
    $('pause-title').textContent = this.state === 'zen' ? 'Zen paused' : 'Paused';
    this.show('pause', v);
    if (!v) this.lastFrame = performance.now();
    this.needIdleRender = true;
  }

  setPhoto(v) {
    document.body.classList.toggle('photo', v);
    if (v) this.toast('Photo mode — tap 👁 to come back', 1800);
  }

  // ============================================================== scene building
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
    this.setTutorial(false);
    this.box.group.visible = false;
    this.box.shadow.visible = false;
    this.resetView(true);
  }

  /**
   * mode 'dream': all stages placed (menu preview)
   * mode 'level': stages before `stage` placed, `stage` becomes ghosts + boxed pieces
   * mode 'zen'  : furniture only, the player's own saved arrangement
   */
  loadRoom(ri, stage, mode) {
    this.clearRoom();
    const spec = ROOMS[ri];
    this.roomIdx = ri;
    this.roomSpec = spec;
    shared.uSky.value.set(spec.sky);
    shared.uGround.value.set(spec.ground);
    this.scene.background = this.bgTexture(spec);
    this.meadow.setHorizon(spec.bg[1]);
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', spec.bg[0]);
    this.room = buildRoom(spec, this.phys);
    this.roomGroup.add(this.room.group);

    if (mode !== 'zen') {
      spec.stages.forEach((defs, si) => {
        const placed = mode === 'dream' || si < stage;
        const current = mode === 'level' && si === stage;
        defs.forEach((def) => {
          const type = getItemType(def.t);
          const pose = slotPose(def, type);
          const slot = { def, type, pose, filled: false, cur: current, piece: null, ghost: null, hot: false };
          this.slots.push(slot);
          if (placed) this.placePiece(this.makePiece(type), slot, true);
          else if (current) this.makeGhost(slot);
        });
      });
    }
    this.setProgress();

    if (mode === 'level') {
      shuffle(this.slots.filter((s) => s.cur)).forEach((slot) => {
        const piece = this.makePiece(slot.type);
        piece.state = 'box';
        piece.group.visible = false;
        piece.shadow.visible = false;
        piece.targetSlot = slot;
        this.pieces.push(piece);
      });
    }
    this.needIdleRender = true;
  }

  makePiece(type) {
    const mat = makeMat();
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(type.geo, mat);
    const outline = new THREE.Mesh(type.outline, this.outlineMat);
    group.add(mesh, outline);
    mesh.matrixAutoUpdate = outline.matrixAutoUpdate = false;
    mesh.updateMatrix();
    outline.updateMatrix();
    this.piecesGroup.add(group);
    const sm = new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false, opacity: 0.6 });
    const shadow = new THREE.Mesh(this.shadowGeo, sm);
    shadow.renderOrder = 2;
    this.piecesGroup.add(shadow);
    return { type, group, mesh, mat, body: null, staticBody: null, state: 'static', slot: null, shadow, yaw: 0, lastVy: 0, wiggle: 0 };
  }

  disposePiece(p) {
    this.piecesGroup.remove(p.group);
    this.piecesGroup.remove(p.shadow);
    p.mat.dispose();
    p.shadow.material.dispose();
    if (p.body) this.phys.remove(p.body);
    if (p.staticBody) this.phys.remove(p.staticBody);
    p.body = p.staticBody = null;
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
    if (!slot || !slot.ghost || slot.hot === hot) return;
    slot.hot = hot;
    slot.ghostFill.material = hot ? this.ghostFillHot : this.ghostFill;
    slot.ghostEdge.material = hot ? this.ghostEdgeHot : this.ghostEdge;
  }

  shapeFor(type) {
    const c = type.col;
    return c.kind === 'box' ? this.phys.boxShape(c.hx, c.hy, c.hz) : this.phys.cylShape(c.hh, c.r);
  }

  // Any free outline this sticker can go to (duplicates may share several valid spots)
  slotFor(piece) {
    if (piece.targetSlot && !piece.targetSlot.filled) return piece.targetSlot;
    let best = null;
    let bd = 1e9;
    for (const s of this.slots) {
      if (!s.cur || s.filled || s.type !== piece.type) continue;
      const d = (s.pose.x - piece.group.position.x) ** 2 + (s.pose.z - piece.group.position.z) ** 2;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  placePiece(piece, slot, instant) {
    const p = slot.pose;
    piece.state = 'placed';
    piece.slot = slot;
    slot.filled = true;
    slot.piece = piece;
    piece.group.position.set(p.x, p.y, p.z);
    piece.group.rotation.set(0, p.ry, 0);
    piece.group.scale.setScalar(1);
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
    if (t.wall && piece.state !== 'free' && piece.state !== 'held') {
      piece.shadow.visible = false;
      return;
    }
    const bottom = y - t.half.y;
    const sy = this.room.supportY(x, z, bottom + 0.1);
    const h = Math.max(0, bottom - sy);
    const s = Math.max(t.half.x, t.half.z) * 2.5 * (1 + h * 0.12);
    piece.shadow.visible = true;
    piece.shadow.position.set(x + 0.05 + h * 0.1, sy + 0.02, z + 0.06 + h * 0.1);
    piece.shadow.scale.set(s, 1, s * 0.92);
    piece.shadow.material.opacity = clamp(0.7 - h * 0.18, 0.1, 0.7);
  }

  // ============================================================== box + unpacking
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
    this.box = { group: g, flapL, flapR, shadow: sh };
  }

  startBoxIntro() {
    const b = this.box;
    b.group.visible = true;
    b.shadow.visible = true;
    b.flapL.rotation.z = b.flapR.rotation.z = 0;
    b.group.scale.setScalar(1);
    b.group.position.set(BOX_POS.x, 9, BOX_POS.z);
    this.addTween(0.75, (k) => {
      b.group.position.y = k < 0.55 ? 9 * (1 - (k / 0.55) ** 2) : k < 0.8 ? Math.sin(((k - 0.55) / 0.25) * Math.PI) : 0.25 * Math.sin(((k - 0.8) / 0.2) * Math.PI);
      b.shadow.material.opacity = 0.7 * smooth(Math.min(1, k * 1.5));
    }, () => {
      b.group.position.y = 0;
      sfx.thud(0.9);
      this.fx.ring(BOX_POS.x, 0.05, BOX_POS.z, 0xffe9c4);
      this.fx.sparkle(BOX_POS.x, 0.3, BOX_POS.z, 10, { speed: 2, size: 18, colors: COL_BOX });
      this.state = 'box';
      this.toast(isMobile ? 'Tap the box to unpack! 📦' : 'Click the box to unpack! 📦', 3500);
    }, (k) => k);
  }

  openBox() {
    if (this.boxOpened) return;
    this.boxOpened = true;
    this.state = 'unpack';
    const b = this.box;
    $('toast').classList.remove('show');
    this.addTween(0.5, (k) => {
      const e = easeOutBack(k, 2.4);
      b.flapL.rotation.z = e * 1.9;
      b.flapR.rotation.z = -e * 1.9;
      const sq = Math.sin(k * Math.PI);
      b.group.scale.set(1 + sq * 0.14, 1 - sq * 0.12, 1 + sq * 0.14);
    }, null, (k) => k);
    const queue = this.pieces.filter((p) => p.state === 'box');
    const cells = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) cells.push([-3.1 + c * 1.12 + (r % 2) * 0.5 + rand(-0.12, 0.12), 1.25 + r * 0.95 + rand(-0.1, 0.1)]);
    const pick = shuffle(cells.filter(([x]) => x < 2.55)).slice(0, queue.length);
    queue.forEach((piece, i) => this.addTween(0.28 + i * 0.13, null, () => this.popOut(piece, pick[i] || [0, 2], i), (k) => k));
    this.addTween(0.28 + queue.length * 0.13 + 0.5, null, () => {
      if (this.state === 'unpack') this.state = 'play';
      this.addTween(0.45, (k) => {
        const e = easeOutBack(k, 2);
        b.group.scale.setScalar(Math.max(0.001, 1 - e));
        b.group.position.y = Math.sin(k * Math.PI) * 0.6;
        b.shadow.material.opacity = 0.7 * (1 - k);
      }, () => {
        b.group.visible = false;
        b.shadow.visible = false;
        this.fx.sparkle(BOX_POS.x, 0.6, BOX_POS.z, 14, { speed: 2.5, size: 20, colors: COL_BOX });
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
    this.tmp.q.setFromEuler(this.tmp.e.set(rand(-0.12, 0.12), rand(0, 6.28), rand(-0.12, 0.12)));
    piece.body = this.phys.addDynamic(this.shapeFor(t), start.x, start.y, start.z, this.tmp.q, { friction: 0.8, restitution: 0.22 });
    this.phys.setVel(piece.body, vx, vy, vz);
    this.phys.setAng(piece.body, rand(-1.5, 1.5), rand(-8, 8), rand(-1.5, 1.5));
    this.physKick = 8;
    piece.state = 'free';
    piece.group.visible = true;
    piece.shadow.visible = true;
    piece.group.position.copy(start);
    sfx.pop(i);
    this.buzz(8);
    this.fx.sparkle(start.x, start.y, start.z, 6, { speed: 1.6, size: 18 });
    this.addTween(0.35, (k) => piece.group.scale.setScalar(Math.max(0.01, easeOutBack(k, 2.2))), () => piece.group.scale.setScalar(1), (k) => k);
  }

  // ============================================================== modes
  enterScene(fn) {
    ['menu', 'win', 'levels', 'settings', 'pause', 'code'].forEach((id) => this.show(id, false));
    this.paused = false;
    this.setPhoto(false);
    const fade = $('fade');
    fade.classList.add('on');
    setTimeout(() => {
      fn();
      this.applyCamera();
      fade.classList.remove('on');
      this.needIdleRender = true;
    }, 320);
  }

  startLevel(idx) {
    this.enterScene(() => {
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
      document.body.classList.remove('zen');
      $('lvl-name').textContent = `${ROOMS[L.room].emoji} ${idx + 1}. ${L.name}`;
      this.setCoins(this.save.coins);
      this.updateHintLabel();
      $('btn-hint').style.visibility = '';
      this.show('hud', true);
      this.addTween(1.1, (k) => (this.camIntro = k), () => (this.camIntro = 1), (k) => k);
      setTimeout(() => this.startBoxIntro(), 450);
    });
  }

  startZen(ri) {
    this.enterScene(() => {
      this.loadRoom(ri, 0, 'zen');
      this.state = 'zen';
      this.menuK = 0;
      this.zoom = 1;
      this.yaw = 0;
      this.camIntro = 0;
      document.body.classList.add('zen');
      $('lvl-name').textContent = `🌿 ${ROOMS[ri].name}`;
      this.setCoins(this.save.coins);
      this.show('hud', true);
      this.zenLoad();
      this.buildTray();
      this.addTween(1.1, (k) => (this.camIntro = k), () => (this.camIntro = 1), (k) => k);
      if (!this.save.zenSeen) {
        this.save.zenSeen = true;
        writeSave(this.save);
        setTimeout(() => this.toast('Drag stickers up from the tray · tap one to turn it · drop it on the tray to put away', 5200), 900);
      }
    });
  }

  showMenu() {
    this.enterScene(() => {
      const idx = this.firstOpenLevel();
      this.loadRoom(LEVELS[idx].room, 0, 'dream');
      this.state = 'menu';
      document.body.classList.remove('zen');
      this.show('hud', false);
      this.show('menu', true);
      this.camIntro = 1;
      this.zoom = 1;
      this.menuK = 1;
    });
  }

  updateHintLabel() {
    $('hint-cost').textContent = this.hintFreeUsed ? String(HINT_COST) : 'free';
  }

  useHint() {
    if (this.state !== 'play' && this.state !== 'unpack') return;
    const cands = this.pieces.filter((p) => p.state === 'free' && this.slotFor(p));
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
    this.hintSlot = this.slotFor(piece);
    this.hintT = 4.5;
    this.setGhostHot(this.hintSlot, true);
    sfx.hint();
    this.toast('Bring the glowing sticker to its outline ✨', 2600);
  }

  clearHint() {
    if (!this.hintPiece) return;
    const p = this.hintPiece;
    p.mat.uniforms.uGlow.value = 0;
    p.mat.uniforms.uTintAmt.value = 0;
    if (this.hintSlot && !this.hintSlot.filled) this.setGhostHot(this.hintSlot, false);
    this.hintPiece = null;
    this.hintSlot = null;
  }

  // ---------- tutorial hand: first 3 plays, and again whenever the player idles
  maybeTutorial() {
    if ((this.save.tutorialPlays || 0) >= TUTORIAL_PLAYS) return;
    this.save.tutorialPlays = (this.save.tutorialPlays || 0) + 1;
    writeSave(this.save);
    this.setTutorial(true);
  }

  setTutorial(on) {
    this.tutorial = on;
    const hand = $('hand');
    if (!on) {
      hand.classList.remove('on');
      return;
    }
    this.updateHand();
    hand.classList.add('on');
  }

  checkIdle() {
    if (this.paused || this.hidden) return;
    const idle = now() - this.lastInput;
    if (this.state === 'play' && !this.drag && !this.tutorial && idle > IDLE_TUTORIAL_S && this.pieces.some((p) => p.state === 'free')) {
      this.setTutorial(true);
      this.toast('Psst… drag a sticker onto its matching outline ✨', 2600);
      this.needIdleRender = true;
    }
  }

  updateHand() {
    const hand = $('hand');
    const piece = this.pieces.find((p) => p.state === 'free' && this.slotFor(p));
    if (!piece) {
      hand.classList.remove('on');
      return;
    }
    const s = this.slotFor(piece).pose;
    const a = this.screenOf(piece.group.position, this.tmp.v);
    const b = this.screenOf(this.tmp.v2.set(s.x, s.y, s.z), this.tmp.v);
    hand.style.setProperty('--ax', (a.x - 18).toFixed(0) + 'px');
    hand.style.setProperty('--ay', (a.y + 6).toFixed(0) + 'px');
    hand.style.setProperty('--bx', (b.x - 18).toFixed(0) + 'px');
    hand.style.setProperty('--by', (b.y + 6).toFixed(0) + 'px');
  }

  // ============================================================== ZEN mode
  zenMax() {
    return this.tier === 'low' ? 28 : 45;
  }

  unlockedItems() {
    const set = new Set(ROOMS[0].stages[0].map((d) => d.t));
    LEVELS.forEach((l) => {
      if (this.save.stars[l.id]) ROOMS[l.room].stages[l.stage].forEach((d) => set.add(d.t));
    });
    // the current room's own stickers are always available in its zen space
    ROOMS[this.roomIdx]?.stages.flat().forEach((d) => set.add(d.t));
    return Object.keys(ITEM_DEFS).filter((id) => set.has(id));
  }

  buildTray() {
    const list = $('tray-list');
    list.innerHTML = '';
    const ids = this.unlockedItems();
    const all = Object.keys(ITEM_DEFS).length;
    $('tray-count').textContent = `${ids.length}/${all}`;
    ids.forEach((id) => {
      const b = document.createElement('button');
      b.className = 'tray-item';
      b.title = ITEM_DEFS[id].name;
      b.style.backgroundImage = `url(${this.thumb(id)})`;
      b.addEventListener('pointerdown', (e) => this.trayDown(e, id));
      list.appendChild(b);
    });
  }

  // Renders a sticker once into a small transparent PNG for the tray.
  thumb(id) {
    if (this.thumbs.has(id)) return this.thumbs.get(id);
    const S = 112;
    if (!this.thumbRT) {
      this.thumbRT = new THREE.WebGLRenderTarget(S, S, { samples: this.cfg.aa ? 4 : 0 });
      this.thumbRT.texture.colorSpace = THREE.SRGBColorSpace;
      this.thumbScene = new THREE.Scene();
      this.thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      this.thumbBuf = new Uint8Array(S * S * 4);
      this.thumbCanvas = document.createElement('canvas');
      this.thumbCanvas.width = this.thumbCanvas.height = S;
    }
    const type = getItemType(id);
    const m = new THREE.Mesh(type.geo, makeMat());
    const o = new THREE.Mesh(type.outline, this.outlineMat);
    this.thumbScene.add(m, o);
    const d = (type.radius * 1.12) / Math.sin((15 * Math.PI) / 180);
    this.thumbCam.position.set(0.35, 0.3, 1).normalize().multiplyScalar(d);
    this.thumbCam.lookAt(0, 0, 0);
    const r = this.renderer;
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.thumbRT);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.thumbScene, this.thumbCam);
    r.readRenderTargetPixels(this.thumbRT, 0, 0, S, S, this.thumbBuf);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, prevAlpha);
    this.thumbScene.remove(m, o);
    m.material.dispose();
    const ctx = this.thumbCanvas.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) img.data.set(this.thumbBuf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    ctx.putImageData(img, 0, 0);
    const url = this.thumbCanvas.toDataURL('image/png');
    this.thumbs.set(id, url);
    return url;
  }

  zenPieces() {
    return this.pieces.filter((p) => p.zen);
  }

  zenSpawn(id, x, y, z, yaw = rand(-0.6, 0.6)) {
    const type = getItemType(id);
    const piece = this.makePiece(type);
    piece.zen = true;
    piece.state = 'free';
    this.tmp.q.setFromAxisAngle(UP, yaw);
    piece.body = this.phys.addDynamic(this.shapeFor(type), x, y, z, this.tmp.q, { friction: 0.85, restitution: 0.15 });
    piece.group.position.set(x, y, z);
    piece.group.quaternion.copy(this.tmp.q);
    this.pieces.push(piece);
    this.physKick = 8;
    return piece;
  }

  trayDown(e, id) {
    if (this.state !== 'zen' || this.paused || this.drag) return;
    e.preventDefault();
    sfx.init();
    this.lastInput = now();
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    this.trayDrag = { id, pointerId: e.pointerId, x: e.clientX, y: e.clientY, el: e.currentTarget };
    e.currentTarget.classList.add('pressed');
  }

  trayMove(e) {
    const t = this.trayDrag;
    if (!t || e.pointerId !== t.pointerId) return;
    const trayTop = $('tray').getBoundingClientRect().top;
    if (t.y - e.clientY > 18 || e.clientY < trayTop - 4) {
      // pulled the sticker out of the tray -> spawn it under the finger and keep dragging
      this.trayDrag = null;
      t.el.classList.remove('pressed');
      if (this.zenPieces().length >= this.zenMax()) {
        sfx.wrong();
        this.toast('This room is full — put something away first 🧺');
        return;
      }
      const plane = this.tmp.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(this.tmp.v).negate(), this.tmp.v2.set(TARGET.x, 2.2, 0.6));
      const hit = this.rayToPlane(e.clientX, e.clientY - (isMobile ? 46 : 0), plane, this.tmp.v3) || this.tmp.v3.set(0, 2.5, 1);
      const type = getItemType(t.id);
      hit.x = clamp(hit.x, -4.4 + type.half.x, 4.3 - type.half.x);
      hit.z = clamp(hit.z, -3.4 + type.half.z, 3.4 - type.half.z);
      hit.y = clamp(hit.y, type.half.y + 0.1, 5.2);
      const piece = this.zenSpawn(t.id, hit.x, hit.y, hit.z, 0.3);
      sfx.pop(3);
      this.buzz(8);
      this.fx.sparkle(hit.x, hit.y, hit.z, 8, { speed: 1.8, size: 18 });
      this.addTween(0.3, (k) => piece.group.scale.setScalar(Math.max(0.01, easeOutBack(k, 2.2))), () => piece.group.scale.setScalar(1), (k) => k);
      this.beginDrag(piece, e);
    }
  }

  trayUp(e) {
    const t = this.trayDrag;
    if (!t || e.pointerId !== t.pointerId) return;
    this.trayDrag = null;
    t.el.classList.remove('pressed');
    // simple tap: drop it into the middle of the room with a little hop
    if (this.zenPieces().length >= this.zenMax()) {
      sfx.wrong();
      this.toast('This room is full — put something away first 🧺');
      return;
    }
    const type = getItemType(t.id);
    const piece = this.zenSpawn(t.id, rand(-1.2, 1.8), 3.6 + type.half.y, rand(0.6, 2.2));
    this.phys.setAng(piece.body, rand(-1, 1), rand(-5, 5), rand(-1, 1));
    sfx.pop(2);
    this.addTween(0.3, (k) => piece.group.scale.setScalar(Math.max(0.01, easeOutBack(k, 2.2))), () => piece.group.scale.setScalar(1), (k) => k);
    this.zenSaveSoon();
  }

  overTray(y) {
    const r = $('tray').getBoundingClientRect();
    return y > r.top - 6;
  }

  // On release near a wall, wall decor sticks to it (static); everything else stays physical.
  zenRelease(piece) {
    const t = piece.type;
    const p = piece.group.position;
    if (!t.wall) return false;
    const dBack = p.z - ROOM.z0;
    const dLeft = p.x - ROOM.x0;
    if (Math.min(dBack, dLeft) > 1.4) return false;
    const back = dBack <= dLeft;
    const pose = back
      ? { x: clamp(p.x, -4.3 + t.half.x, 4.4 - t.half.x), y: clamp(p.y, t.half.y + 0.35, 5.45 - t.half.y), z: ROOM.z0 + t.half.z + 0.02, ry: 0 }
      : { x: ROOM.x0 + t.half.z + 0.02, y: clamp(p.y, t.half.y + 0.35, 5.45 - t.half.y), z: clamp(p.z, -3.3 + t.half.x, 3.4 - t.half.x), ry: Math.PI / 2 };
    this.stickPiece(piece, pose, true);
    return true;
  }

  stickPiece(piece, pose, animate) {
    if (piece.body) this.phys.remove(piece.body);
    piece.body = null;
    piece.state = 'stuck';
    piece.pose = pose;
    const g = piece.group;
    const q1 = new THREE.Quaternion().setFromAxisAngle(UP, pose.ry);
    const fin = () => {
      g.position.set(pose.x, pose.y, pose.z);
      g.quaternion.copy(q1);
      piece.staticBody = this.phys.addStaticShape(this.shapeFor(piece.type), pose.x, pose.y, pose.z, q1);
      piece.shadow.visible = false;
    };
    if (!animate) return fin();
    const p0 = g.position.clone();
    const q0 = g.quaternion.clone();
    this.addTween(0.22, (k) => {
      g.position.lerpVectors(p0, this.tmp.v.set(pose.x, pose.y, pose.z), easeOutBack(k, 1.4));
      g.quaternion.slerpQuaternions(q0, q1, k);
    }, () => {
      fin();
      sfx.snap(2);
      this.fx.sparkle(pose.x, pose.y, pose.z, 10, { speed: 2, size: 20 });
      this.zenSaveSoon();
    }, (k) => k);
  }

  zenRemove(piece) {
    const p = piece.group.position.clone();
    this.pieces.splice(this.pieces.indexOf(piece), 1);
    this.addTween(0.25, (k) => piece.group.scale.setScalar(Math.max(0.001, 1 - easeOutBack(k, 2))), () => this.disposePiece(piece), (k) => k);
    if (piece.body) {
      this.phys.remove(piece.body);
      piece.body = null;
    }
    this.fx.sparkle(p.x, p.y, p.z, 12, { speed: 2.4, size: 20 });
    sfx.pop(0);
    this.buzz(10);
    this.zenSaveSoon();
  }

  zenClear() {
    if (this.state !== 'zen' || !this.zenPieces().length) return;
    if (!confirm('Put every sticker back in the tray?')) return;
    this.zenPieces().forEach((p) => this.zenRemove(p));
  }

  zenSaveSoon() {
    if (this.state !== 'zen') return;
    clearTimeout(this._zenT);
    this._zenT = setTimeout(() => this.zenSave(), 500);
  }

  zenSave() {
    if (this.state !== 'zen') return;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    this.save.zen[this.roomSpec.id] = this.zenPieces().map((p) => {
      const g = p.group;
      return [p.type.id, r3(g.position.x), r3(g.position.y), r3(g.position.z), r3(g.quaternion.x), r3(g.quaternion.y), r3(g.quaternion.z), r3(g.quaternion.w), p.state === 'stuck' ? 1 : 0];
    });
    writeSave(this.save);
  }

  zenLoad() {
    const list = this.save.zen[this.roomSpec.id] || [];
    for (const [id, x, y, z, qx, qy, qz, qw, stuck] of list) {
      if (!ITEM_DEFS[id]) continue;
      const type = getItemType(id);
      if (stuck) {
        const piece = this.makePiece(type);
        piece.zen = true;
        this.pieces.push(piece);
        const ry = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(qx, qy, qz, qw), 'YXZ').y;
        this.stickPiece(piece, { x, y, z, ry }, false);
      } else {
        const piece = this.zenSpawn(id, x, y, z, 0);
        const q = this.tmp.q.set(qx, qy, qz, qw).normalize();
        this.phys.setTransform(piece.body, x, y, z, q);
        piece.group.quaternion.copy(q);
        this.placeShadow(piece, x, y, z);
      }
    }
  }

  // ============================================================== view (zoom & pan)
  resetView(instant) {
    const V = this.view;
    V.tz = 1;
    V.tpx = V.tpz = 0;
    if (instant) {
      V.zoom = 1;
      V.px = V.pz = 0;
    }
    this.updateZoomUI();
  }

  clampPan() {
    const V = this.view;
    const lim = Math.max(0, 1 - 1 / V.tz);
    V.tpx = clamp(V.tpx, -4.6 * lim, 4.4 * lim);
    V.tpz = clamp(V.tpz, -3.6 * lim, 3.4 * lim);
  }

  // zoom so that the world point under (x,y) stays (roughly) under the cursor
  zoomAt(x, y, z, instant) {
    if (!this.canZoom()) return;
    const V = this.view;
    const nz = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const hit = this.rayToPlane(x, y, this.tmp.plane.set(UP, -1.0), this.tmp.v3);
    if (hit && nz > 1) {
      const k = 1 - V.tz / nz;
      V.tpx += (hit.x - (TARGET.x + V.tpx)) * k;
      V.tpz += (hit.z - (TARGET.z + V.tpz)) * k;
    }
    V.tz = nz;
    this.clampPan();
    if (instant) {
      V.zoom = V.tz;
      V.px = V.tpx;
      V.pz = V.tpz;
    }
    this.lastInput = now();
    this.updateZoomUI();
    this.needIdleRender = true;
  }

  panBy(x0, y0, x1, y1) {
    const plane = this.tmp.plane.set(UP, -1.0);
    const a = this.rayToPlane(x0, y0, plane, this.tmp.v3);
    if (!a) return;
    const ax = a.x;
    const az = a.z;
    const b = this.rayToPlane(x1, y1, plane, this.tmp.v3);
    if (!b) return;
    const V = this.view;
    V.tpx -= b.x - ax;
    V.tpz -= b.z - az;
    this.clampPan();
    V.px = V.tpx;
    V.pz = V.tpz;
    this.needIdleRender = true;
  }

  canZoom() {
    return ['play', 'unpack', 'box', 'zen'].includes(this.state) && !this.paused;
  }

  updateZoomUI() {
    $('zoom-reset').classList.toggle('dim', Math.abs(this.view.tz - 1) < 0.02);
  }

  // ============================================================== input
  bindInput() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e), { passive: true });
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomAt(e.clientX, e.clientY, this.view.tz * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
      },
      { passive: false }
    );
    window.addEventListener('keydown', (e) => {
      this.lastInput = now();
      if (e.key === '+' || e.key === '=') this.zoomAt(this.W / 2, this.H / 2, this.view.tz * 1.3);
      if (e.key === '-') this.zoomAt(this.W / 2, this.H / 2, this.view.tz / 1.3);
      if (e.key === '0') this.resetView();
      if (e.key === 'Escape' && document.body.classList.contains('photo')) this.setPhoto(false);
    });
  }

  screenOf(v, out) {
    out.copy(v).project(this.camera);
    return { x: (out.x * 0.5 + 0.5) * this.W, y: (-out.y * 0.5 + 0.5) * this.H, z: out.z };
  }

  pxPerUnitAt(pos) {
    const d = this.camera.position.distanceTo(pos);
    return this.H / 2 / Math.tan((FOV * Math.PI) / 360) / d;
  }

  pickPiece(x, y, states) {
    let best = null;
    let bestScore = 1e9;
    const v = this.tmp.v2;
    for (const p of this.pieces) {
      if (!states.includes(p.state)) continue;
      v.copy(p.group.position);
      const s = this.screenOf(v, this.tmp.v);
      const r = Math.max(p.type.radius * this.pxPerUnitAt(p.group.position) * 0.95, isMobile ? 38 : 26);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d > r) continue;
      const score = d / r - s.z * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  onDown(e) {
    sfx.init();
    this.lastInput = now();
    if (this.tutorial) this.setTutorial(false);
    if (this.paused) return;
    if (document.body.classList.contains('photo')) {
      this.setPhoto(false);
      return;
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    // second finger -> pinch zoom (ignored while carrying a sticker)
    if (this.pointers.size === 2 && !this.drag && this.canZoom()) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      this.panCand = null;
      return;
    }
    if (this.pointers.size > 1) return;
    if (this.state === 'box') {
      this.openBox();
      return;
    }
    const interactive = this.state === 'play' || this.state === 'unpack' || this.state === 'zen';
    if (!interactive || this.drag) return;
    const piece = this.pickPiece(e.clientX, e.clientY, this.state === 'zen' ? ['free', 'stuck'] : ['free']);
    if (piece) {
      this.canvas.setPointerCapture?.(e.pointerId);
      this.beginDrag(piece, e);
      return;
    }
    this.panCand = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.trayDrag) this.trayMove(e);
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.panBy(this.pinch.mx, this.pinch.my, mx, my);
      this.zoomAt(mx, my, this.view.tz * (d / Math.max(10, this.pinch.d)), true);
      this.pinch.d = d;
      this.pinch.mx = mx;
      this.pinch.my = my;
      this.lastInput = now();
      return;
    }
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.ptr.x = e.clientX;
      this.ptr.y = e.clientY;
      this.lastInput = now();
      if (this.state === 'zen') $('tray').classList.toggle('trash', this.overTray(e.clientY));
      return;
    }
    const pc = this.panCand;
    if (pc && e.pointerId === pc.id) {
      if (!pc.moved && Math.hypot(e.clientX - pc.x, e.clientY - pc.y) > 7) pc.moved = true;
      if (pc.moved && this.view.tz > 1.02) this.panBy(pc.lx, pc.ly, e.clientX, e.clientY);
      pc.lx = e.clientX;
      pc.ly = e.clientY;
      this.lastInput = now();
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.trayDrag) this.trayUp(e);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    if (this.drag && e.pointerId === this.drag.pointerId) {
      this.endDrag(e);
      return;
    }
    const pc = this.panCand;
    if (pc && e.pointerId === pc.id) {
      this.panCand = null;
      if (pc.moved) return;
      // tap on empty space: double-tap zooms, single tap wiggles decor
      const tnow = now();
      if (tnow - this.lastTap.t < 0.32 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 30 && this.canZoom()) {
        this.view.tz > 1.15 ? this.resetView() : this.zoomAt(e.clientX, e.clientY, 2.2);
        this.lastTap.t = -10;
        return;
      }
      this.lastTap = { t: tnow, x: e.clientX, y: e.clientY };
      const deco = this.pickPiece(e.clientX, e.clientY, ['placed']);
      if (deco) this.wiggle(deco);
    }
  }

  beginDrag(piece, e) {
    const cam = this.camera;
    if (piece.state === 'stuck') {
      // un-stick wall decor so it can be carried again
      if (piece.staticBody) this.phys.remove(piece.staticBody);
      piece.staticBody = null;
      piece.body = this.phys.addDynamic(this.shapeFor(piece.type), piece.group.position.x, piece.group.position.y, piece.group.position.z, piece.group.quaternion, { friction: 0.85, restitution: 0.15 });
      piece.state = 'free';
    }
    const pos = piece.group.position;
    const n = cam.getWorldDirection(this.tmp.v).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, pos);
    const hit = this.rayToPlane(e.clientX, e.clientY, plane, new THREE.Vector3());
    this.drag = {
      piece,
      plane,
      off: hit ? pos.clone().sub(hit) : new THREE.Vector3(),
      t: 0,
      sx: e.clientX,
      sy: e.clientY,
      pointerId: e.pointerId,
      magnet: null,
      lastMag: null,
    };
    this.ptr.x = e.clientX;
    this.ptr.y = e.clientY;
    this.tmp.e.setFromQuaternion(piece.group.quaternion, 'YXZ');
    piece.yaw = this.tmp.e.y;
    piece.state = 'held';
    this.phys.setHeld(piece.body, true);
    this.phys.wake(piece.body);
    sfx.grab();
    this.buzz(6);
    if (this.hintPiece === piece) this.clearHint();
    this.addTween(0.18, (k) => piece.group.scale.setScalar(1 + 0.12 * Math.sin(k * Math.PI * 0.5)), null, (k) => k);
  }

  rayToPlane(x, y, plane, out) {
    const ndc = this.tmp.v2.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1, 0.5);
    ndc.unproject(this.camera);
    const ray = this.tmp.r;
    ray.origin.copy(this.camera.position);
    ray.direction.copy(ndc).sub(this.camera.position).normalize();
    return ray.intersectPlane(plane, out);
  }

  endDrag(e) {
    const d = this.drag;
    this.drag = null;
    const piece = d.piece;
    if (piece.state !== 'held') return;
    this.phys.setHeld(piece.body, false);
    const lv = piece.body.GetLinearVelocity();
    const sp = Math.hypot(lv.GetX(), lv.GetY(), lv.GetZ());
    if (sp > 12) this.phys.setVel(piece.body, (lv.GetX() / sp) * 12, (lv.GetY() / sp) * 12, (lv.GetZ() / sp) * 12);
    piece.state = 'free';
    this.physKick = 8;
    this.addTween(0.2, (k) => piece.group.scale.setScalar(1.12 - 0.12 * k), () => piece.group.scale.setScalar(1), (k) => k);

    if (this.state === 'zen') {
      $('tray').classList.remove('trash');
      const tap = d.t < 0.25 && Math.hypot((e?.clientX ?? d.sx) - d.sx, (e?.clientY ?? d.sy) - d.sy) < 9;
      if (e && this.overTray(e.clientY) && !tap) return this.zenRemove(piece);
      if (tap && !piece.type.wall) {
        // tap = turn 45°
        const g = piece.group;
        this.tmp.e.setFromQuaternion(g.quaternion, 'YXZ');
        this.tmp.q.setFromAxisAngle(UP, this.tmp.e.y + Math.PI / 4);
        this.phys.setTransform(piece.body, g.position.x, g.position.y + 0.12, g.position.z, this.tmp.q);
        this.phys.setVel(piece.body, 0, 2.5, 0);
        sfx.pop(4);
      } else if (!this.zenRelease(piece)) sfx.thud(0.3);
      this.zenSaveSoon();
      return;
    }

    if (d.magnet && d.magnet.k > 0.35) {
      this.snapPiece(piece, d.magnet.slot);
    } else {
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
      const sq = Math.sin(k * Math.PI * 4) * (1 - k) * 0.14;
      g.scale.set(1 + sq, 1 - sq * 1.2, 1 + sq);
    }, () => {
      g.scale.setScalar(1);
      piece.wiggle = 0;
    }, (k) => k);
    this.fx.sparkle(g.position.x, g.position.y + piece.type.half.y, g.position.z, 4, { speed: 1.2, size: 14 });
  }

  // ============================================================== snapping
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
      g.position.lerpVectors(p0, p1, easeOutBack(k, 1.6));
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
    this.addTween(0.55, (k) => {
      const sq = (1 - easeOutElastic(k)) * 0.28;
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
    this.setTutorial(false);
    this.resetView();
    $('btn-hint').style.visibility = 'hidden';
    const L = LEVELS[this.levelIdx];
    const stars = clamp(3 - (this.hintsUsed > 1 ? 1 : 0) - (this.misses > 6 ? 1 : 0), 1, 3);
    this.save.stars[L.id] = Math.max(this.save.stars[L.id] || 0, stars);
    const reward = 25 + stars * 10;
    this.setCoins(this.save.coins + reward, true);
    this.winStars = stars;
    this.winReward = reward;
    this.addTween(0.5, null, () => {
      sfx.win();
      this.buzz(60);
      for (let i = 0; i < 4; i++) this.addTween(i * 0.18, null, () => this.fx.confetti(-0.2 + rand(-3, 3), 4.5 + i * 0.3, rand(-1, 2), 60), (k) => k);
      this.fx.sparkle(-0.2, 3, 0, 40, { speed: 6, size: 34 });
    }, (k) => k);
    const y0 = this.yaw;
    this.addTween(3.2, (k) => {
      this.yaw = y0 + Math.sin(k * Math.PI) * 0.35;
      this.zoom = 1 - Math.sin(k * Math.PI) * 0.12;
    }, null, smooth);
    setTimeout(() => this.showWin(), 1700);
  }

  showWin() {
    if (this.state !== 'win') return;
    const stars = $('win-stars').children;
    for (let i = 0; i < 3; i++) {
      stars[i].className = i < this.winStars ? 'on' : 'off';
      stars[i].style.setProperty('--d', 0.35 + i * 0.3 + 's');
      stars[i].style.animation = 'none';
      void stars[i].offsetWidth;
      stars[i].style.animation = '';
    }
    $('win-coins').textContent = '+' + this.winReward;
    $('win-code-txt').textContent = this.currentCode();
    $('btn-next').textContent = this.levelIdx >= LEVELS.length - 1 ? '🏠 Home' : 'Next ▶';
    this.show('win', true);
    for (let i = 0; i < this.winStars; i++) setTimeout(() => sfx.snap(i + 3), 400 + i * 300);
  }

  // ============================================================== tweens
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

  // ============================================================== main loop
  // Render-on-demand: full rate only while something moves; ambient rate (per device tier) when idle,
  // even lower after a long rest, and nothing at all on weak devices or hidden tabs.
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    if (this.hidden || this.ctxLost) return;
    const active = this.isActive();
    let interval = this.minInterval;
    if (!active) {
      let fps = this.state === 'menu' ? this.cfg.menuFps : this.cfg.idleFps;
      if (now() - this.lastInput > REST_AFTER_S) fps = Math.min(fps, 8);
      if (this.paused) fps = 0;
      interval = fps > 0 ? 1000 / fps : Infinity;
    }
    if (t - this.lastRender < interval - 2.5 && !this.needIdleRender) {
      // keep the clock honest while skipping frames
      return;
    }
    const dtMs = Math.min(t - this.lastFrame, 250);
    this.lastFrame = t;
    this.lastRender = t;
    const dt = Math.min(dtMs / 1000, 0.05);
    this.time += dtMs / 1000;
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.needIdleRender = false;
    if (active && !this.paused && this.quality.sample(dtMs)) {
      this.renderer.setPixelRatio(this.quality.dpr);
      this.renderer.setSize(this.W, this.H, false);
      this.fx.setScale(this.renderer.domElement.height, FOV);
    }
  }

  isActive() {
    if (this.paused) return false;
    const V = this.view;
    const viewMoving = Math.abs(V.zoom - V.tz) > 0.002 || Math.abs(V.px - V.tpx) > 0.002 || Math.abs(V.pz - V.tpz) > 0.002;
    return !!(this.drag || this.pinch || viewMoving || this.tweens.length || this.fx.active || this.bodiesAwake || this.physKick > 0 || this.hintPiece || ['box', 'intro', 'win'].includes(this.state));
  }

  update(dt) {
    const t = this.time;
    if (this.paused) return;
    shared.uTime.value = t;
    this.updateTweens(dt);

    if (this.state === 'menu' && this.cfg.menuFps > 0) this.yaw = Math.sin(t * 0.22) * 0.22;
    const V = this.view;
    const k = 1 - Math.exp(-14 * dt);
    V.zoom = lerp(V.zoom, V.tz, k);
    V.px = lerp(V.px, V.tpx, k);
    V.pz = lerp(V.pz, V.tpz, k);
    this.applyCamera();

    if (this.state !== 'menu' && (this.drag || this.bodiesAwake || this.physKick > 0)) {
      if (this.drag) this.updateDrag(dt);
      this.phys.step(dt);
      this.syncPieces();
      if (this.physKick > 0) this.physKick--;
    }

    const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
    this.ghostFill.uniforms.uAlpha.value = 0.3 + pulse * 0.16;
    this.ghostFillHot.uniforms.uAlpha.value = 0.5 + pulse * 0.3;
    for (const s of this.slots) if (s.ghost) s.ghost.scale.setScalar(s.hot ? 1.0 + pulse * 0.05 : 1);

    if (this.state === 'box') {
      const b = this.box;
      const kk = Math.sin(t * 5) * 0.5 + 0.5;
      b.group.scale.set(1 + kk * 0.05, 1 - kk * 0.04, 1 + kk * 0.05);
      b.group.rotation.y = 0.35 + Math.sin(t * 2.4) * 0.05;
    }

    if (this.hintPiece) {
      const p = this.hintPiece;
      this.hintT -= dt;
      p.mat.uniforms.uGlow.value = 0.35 + 0.45 * Math.sin(t * 9) ** 2;
      p.mat.uniforms.uTint.value.set('#ffe680');
      const s = this.hintSlot && !this.hintSlot.filled ? this.hintSlot.pose : null;
      if (s && Math.floor(t * 12) !== Math.floor((t - dt) * 12)) {
        const kk = (t * 1.6) % 1;
        this.fx.sparkle(lerp(p.group.position.x, s.x, kk), lerp(p.group.position.y, s.y, kk) + 0.3, lerp(p.group.position.z, s.z, kk), 1, { speed: 0.3, size: 20, dur: 0.5, colors: COL_HINT });
      }
      if (this.hintT <= 0 || !s) this.clearHint();
    }

    this.fx.update(dt, t);
    if (this.tutorial) this.updateHand();
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
    const pos = piece.group.position;
    const half = piece.type.half;
    // surface-following carry: hover just above whatever the finger points at (floor, furniture, wall)
    if (this.surfaceUnder(ex, ey, piece, target)) {
      (d.lastT || (d.lastT = new THREE.Vector3())).copy(target);
      d.wallYaw = this._surfYaw;
    } else if (d.lastT) target.copy(d.lastT);
    else return;
    let best = null;
    let bestD = 1e9;
    if (this.state !== 'zen') {
      const R = clamp(0.13 * Math.min(this.W, this.H), 54, 100) * Math.min(1.6, Math.sqrt(this.view.zoom));
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
        const kk = 1 - clamp((bestD - R * 0.35) / (R * 0.65), 0, 1);
        d.magnet = { slot: best, k: kk };
        const sp = best.pose;
        const m = smooth(kk);
        target.x = lerp(target.x, sp.x, m);
        target.y = lerp(target.y, sp.y + 0.15 * (1 - m), m);
        target.z = lerp(target.z, sp.z, m);
        piece.yaw = lerpAngle(piece.yaw, sp.ry, 1 - Math.exp(-10 * dt));
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
      }
    }
    if (!best && piece.type.wall) piece.yaw = lerpAngle(piece.yaw, d.wallYaw ?? 0.3, 1 - Math.exp(-8 * dt));

    const kv = 26;
    let vx = (target.x - pos.x) * kv;
    let vy = (target.y - pos.y) * kv;
    let vz = (target.z - pos.z) * kv;
    const sp = Math.hypot(vx, vy, vz);
    if (sp > 46) {
      const s = 46 / sp;
      vx *= s;
      vy *= s;
      vz *= s;
    }
    this.phys.setVel(piece.body, vx, vy, vz);

    const tiltX = clamp(vz * 0.018, -0.45, 0.45);
    const tiltZ = clamp(-vx * 0.018, -0.45, 0.45);
    const qT = this.tmp.q2.setFromEuler(this.tmp.e.set(tiltX, piece.yaw, tiltZ, 'YXZ'));
    const qErr = qT.multiply(this.tmp.q.copy(piece.group.quaternion).invert());
    if (qErr.w < 0) qErr.set(-qErr.x, -qErr.y, -qErr.z, -qErr.w);
    const ang = 2 * Math.acos(clamp(qErr.w, -1, 1));
    const sn = Math.sqrt(1 - qErr.w * qErr.w);
    if (sn > 1e-4 && ang > 1e-3) {
      const m = Math.min(ang * 16, 40) / sn;
      this.phys.setAng(piece.body, qErr.x * m, qErr.y * m, qErr.z * m);
    } else this.phys.setAng(piece.body, 0, 0, 0);
  }

  // Ray from the screen point against floor / furniture tops / the two walls. Writes the carry target.
  surfaceUnder(x, y, piece, out) {
    const ndc = this.tmp.v2.set((x / this.W) * 2 - 1, -(y / this.H) * 2 + 1, 0.5).unproject(this.camera);
    const o = this.camera.position;
    const dx = ndc.x - o.x;
    const dy = ndc.y - o.y;
    const dz = ndc.z - o.z;
    const half = piece.type.half;
    const HOVER = 0.32;
    let bestT = Infinity;
    let kind = null;
    let hx = 0;
    let hy = 0;
    let hz = 0;
    const top = (yy, x0, x1, z0, z1) => {
      if (dy >= -1e-5) return;
      const t = (yy - o.y) / dy;
      if (t <= 0 || t >= bestT) return;
      const px = o.x + dx * t;
      const pz = o.z + dz * t;
      if (px < x0 || px > x1 || pz < z0 || pz > z1) return;
      bestT = t;
      kind = 'top';
      hx = px;
      hy = yy;
      hz = pz;
    };
    top(0, ROOM.x0, ROOM.x1, ROOM.z0, ROOM.z1);
    for (const t of this.room.tops) top(t.y, t.x0, t.x1, t.z0, t.z1);
    if (dz < 0) {
      const t = (ROOM.z0 - o.z) / dz;
      const px = o.x + dx * t;
      const py = o.y + dy * t;
      if (t > 0 && t < bestT && px > ROOM.x0 && px < ROOM.x1 && py > 0 && py < ROOM.h) {
        bestT = t;
        kind = 'back';
        hx = px;
        hy = py;
        hz = ROOM.z0;
      }
    }
    if (dx < 0) {
      const t = (ROOM.x0 - o.x) / dx;
      const pz = o.z + dz * t;
      const py = o.y + dy * t;
      if (t > 0 && t < bestT && pz > ROOM.z0 && pz < ROOM.z1 && py > 0 && py < ROOM.h) {
        bestT = t;
        kind = 'left';
        hx = ROOM.x0;
        hy = py;
        hz = pz;
      }
    }
    if (!kind) return false;
    this._surfYaw = undefined;
    if (kind === 'top') {
      out.set(hx, hy + half.y + HOVER, hz);
    } else if (piece.type.wall) {
      // wall decor previews flat against the wall it points at
      this._surfYaw = kind === 'back' ? 0 : Math.PI / 2;
      out.set(kind === 'back' ? hx : ROOM.x0 + half.z + 0.12, clamp(hy, half.y + 0.3, ROOM.h - half.y - 0.1), kind === 'back' ? ROOM.z0 + half.z + 0.12 : hz);
    } else {
      // pointing at a wall with a normal sticker: rest it on whatever is under that spot
      const ox = kind === 'back' ? hx : ROOM.x0 + Math.max(half.x, half.z) + 0.05;
      const oz = kind === 'back' ? ROOM.z0 + Math.max(half.x, half.z) + 0.05 : hz;
      out.set(ox, this.room.supportY(ox, oz, hy) + half.y + HOVER, oz);
    }
    out.x = clamp(out.x, ROOM.x0 + (piece.type.wall ? half.z : half.x), ROOM.x1 - 0.1 - half.x);
    out.z = clamp(out.z, ROOM.z0 + half.z, ROOM.z1 - 0.05 - half.z);
    out.y = clamp(out.y, this.room.supportY(out.x, out.z, 6.5) + half.y + 0.05, ROOM.h - 0.2);
    return true;
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
        if (uy < 0.985 && speed < 4.5 && g.position.y > -1) this.phys.setAng(body, -uz * 7, body.GetAngularVelocity().GetY() * 0.9, ux * 7);
      }
      if (!held && p.lastVy < -2.5 && vy > p.lastVy + 2) {
        sfx.thud(clamp(-p.lastVy / 12, 0.15, 0.8));
        if (p.lastVy < -6) this.fx.sparkle(g.position.x, g.position.y - p.type.half.y, g.position.z, 2, { speed: 0.8, size: 12, dur: 0.35, colors: COL_WHITE });
      }
      p.lastVy = vy;
      this.placeShadow(p, g.position.x, g.position.y, g.position.z);
    }
    if (this.state === 'zen' && this.bodiesAwake && !awake) this.zenSaveSoon();
    this.bodiesAwake = awake;
  }
}

function lerpAngle(a, b, t) {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
