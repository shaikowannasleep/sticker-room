import initJolt from 'jolt-physics/wasm';
import wasmUrl from 'jolt-physics/jolt-physics.wasm.wasm?url';

export const LAYER = { STATIC: 0, MOVING: 1, HELD: 2 };
const NUM_LAYERS = 3;
const FIXED_DT = 1 / 60;

export let Jolt = null;

export async function loadJolt() {
  Jolt = await initJolt({ locateFile: () => wasmUrl });
  return Jolt;
}

// Thin, allocation-free wrapper around Jolt for this game's needs.
export class Physics {
  constructor() {
    const J = Jolt;
    const settings = new J.JoltSettings();
    settings.mMaxWorkerThreads = 0;
    settings.mMaxBodies = 512;
    settings.mMaxBodyPairs = 2048;
    settings.mMaxContactConstraints = 1024;

    const pairFilter = new J.ObjectLayerPairFilterTable(NUM_LAYERS);
    pairFilter.EnableCollision(LAYER.STATIC, LAYER.MOVING);
    pairFilter.EnableCollision(LAYER.MOVING, LAYER.MOVING);
    pairFilter.EnableCollision(LAYER.HELD, LAYER.MOVING); // carried items shove loose ones, ignore furniture
    const bpStatic = new J.BroadPhaseLayer(0);
    const bpMoving = new J.BroadPhaseLayer(1);
    const bpi = new J.BroadPhaseLayerInterfaceTable(NUM_LAYERS, 2);
    bpi.MapObjectToBroadPhaseLayer(LAYER.STATIC, bpStatic);
    bpi.MapObjectToBroadPhaseLayer(LAYER.MOVING, bpMoving);
    bpi.MapObjectToBroadPhaseLayer(LAYER.HELD, bpMoving);
    settings.mObjectLayerPairFilter = pairFilter;
    settings.mBroadPhaseLayerInterface = bpi;
    settings.mObjectVsBroadPhaseLayerFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpi, 2, pairFilter, NUM_LAYERS);

    this.jolt = new J.JoltInterface(settings);
    J.destroy(settings);
    this.system = this.jolt.GetPhysicsSystem();
    this.bi = this.system.GetBodyInterface();
    this.system.SetGravity(new J.Vec3(0, -24, 0));

    const ps = this.system.GetPhysicsSettings();
    ps.mNumVelocitySteps = 6; // cheaper than default (10); plenty for cozy objects
    ps.mNumPositionSteps = 2;
    ps.mTimeBeforeSleep = 0.35;
    ps.mPointVelocitySleepThreshold = 0.06;
    this.system.SetPhysicsSettings(ps);

    // scratch objects, reused every frame (wasm allocations are never GC'd)
    this._v = new J.Vec3();
    this._r = new J.RVec3();
    this._q = new J.Quat();
    this.shapes = new Map();
    this.acc = 0;
    this.bodies = new Set();
  }

  _shape(key, make) {
    let s = this.shapes.get(key);
    if (!s) {
      s = make();
      s.AddRef();
      this.shapes.set(key, s);
    }
    return s;
  }

  boxShape(hx, hy, hz) {
    const J = Jolt;
    const k = `b${hx.toFixed(3)},${hy.toFixed(3)},${hz.toFixed(3)}`;
    return this._shape(k, () => {
      const v = new J.Vec3(hx, hy, hz);
      const s = new J.BoxShape(v, Math.min(0.03, hx * 0.5, hy * 0.5, hz * 0.5));
      J.destroy(v);
      return s;
    });
  }

  cylShape(hh, r) {
    const J = Jolt;
    return this._shape(`c${hh.toFixed(3)},${r.toFixed(3)}`, () => new J.CylinderShape(hh, r, Math.min(0.03, hh * 0.5, r * 0.5)));
  }

  sphShape(r) {
    const J = Jolt;
    return this._shape(`s${r.toFixed(3)}`, () => new J.SphereShape(r));
  }

  _create(shape, x, y, z, qx, qy, qz, qw, motion, layer, opts = {}) {
    const J = Jolt;
    this._r.Set(x, y, z);
    this._q.Set(qx, qy, qz, qw);
    const cs = new J.BodyCreationSettings(shape, this._r, this._q, motion, layer);
    if (motion === J.EMotionType_Dynamic) {
      cs.mFriction = opts.friction ?? 0.75;
      cs.mRestitution = opts.restitution ?? 0.18;
      cs.mLinearDamping = 0.06;
      cs.mAngularDamping = 0.9;
      cs.mMaxLinearVelocity = 40;
    } else {
      cs.mFriction = 0.8;
      cs.mRestitution = 0.1;
    }
    const body = this.bi.CreateBody(cs);
    J.destroy(cs);
    this.bi.AddBody(body.GetID(), motion === J.EMotionType_Static ? J.EActivation_DontActivate : J.EActivation_Activate);
    this.bodies.add(body);
    return body;
  }

  addStaticBox(cx, cy, cz, hx, hy, hz) {
    return this._create(this.boxShape(hx, hy, hz), cx, cy, cz, 0, 0, 0, 1, Jolt.EMotionType_Static, LAYER.STATIC);
  }

  addStaticShape(shape, x, y, z, q) {
    return this._create(shape, x, y, z, q.x, q.y, q.z, q.w, Jolt.EMotionType_Static, LAYER.STATIC);
  }

  addDynamic(shape, x, y, z, q, opts) {
    return this._create(shape, x, y, z, q.x, q.y, q.z, q.w, Jolt.EMotionType_Dynamic, LAYER.MOVING, opts);
  }

  remove(body) {
    if (!body || !this.bodies.has(body)) return;
    const id = body.GetID();
    this.bi.RemoveBody(id);
    this.bi.DestroyBody(id);
    this.bodies.delete(body);
  }

  setHeld(body, held) {
    const id = body.GetID();
    this.bi.SetObjectLayer(id, held ? LAYER.HELD : LAYER.MOVING);
    this.bi.SetGravityFactor(id, held ? 0 : 1);
    if (held) this.bi.ActivateBody(id);
  }

  setVel(body, x, y, z) {
    this._v.Set(x, y, z);
    this.bi.SetLinearVelocity(body.GetID(), this._v);
  }

  setAng(body, x, y, z) {
    this._v.Set(x, y, z);
    this.bi.SetAngularVelocity(body.GetID(), this._v);
  }

  setTransform(body, x, y, z, q) {
    this._r.Set(x, y, z);
    this._q.Set(q.x, q.y, q.z, q.w);
    this.bi.SetPositionAndRotation(body.GetID(), this._r, this._q, Jolt.EActivation_Activate);
  }

  wake(body) {
    this.bi.ActivateBody(body.GetID());
  }

  // Fixed 60Hz stepping with a hard cap on sub-steps so a slow frame never spirals.
  step(dt) {
    this.acc = Math.min(this.acc + dt, FIXED_DT * 3);
    let n = 0;
    while (this.acc >= FIXED_DT && n < 2) {
      this.jolt.Step(FIXED_DT, 1);
      this.acc -= FIXED_DT;
      n++;
    }
    if (n === 2) this.acc = 0;
    return n;
  }

  dispose() {
    for (const b of [...this.bodies]) this.remove(b);
  }
}
