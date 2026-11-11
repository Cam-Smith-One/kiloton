// ============================================================================
// KILOTON — fx.js   OWNER: FX.   G.fx: particles and transient effects.
// Three GPU pools (one shader): LIT (smoke / dust / fireballs, premultiplied, sun+sky lit),
// ADD (sparks, embers, flames, glows, rings; purely emissive) and BEAM (stretched quads).
// Every particle is simulated in the vertex shader from its spawn parameters, so the CPU only
// writes 28 floats per spawn into a ring buffer and uploads the touched range once per frame.
// ============================================================================
import { G, THREE, bus, clamp, GROUND_Y, WX, WZ } from './core.js';
import { COLOR, GLASS, EMISSIVE, MAT } from './materials.js';
import { PARTICLE_VS, PARTICLE_FS, BEAM_VS, BEAM_FS } from './fx_shaders.js';

const STRIDE = 28, BSTRIDE = 16, BEAM_CAP = 384;
const NOFLOOR = -1000;
const TAU = Math.PI * 2;

// ---- fast private RNG (never touches G.rand so gameplay stays deterministic) -------------------
let _s = 0x2545f491;
const rnd = () => { _s ^= _s << 13; _s ^= _s >>> 17; _s ^= _s << 5; return (_s >>> 0) / 4294967296; };
const rr = (a, b) => a + (b - a) * rnd();
const rs = () => rnd() * 2 - 1;
const roundP = x => { const f = Math.floor(x); return f + (rnd() < x - f ? 1 : 0); };   // stochastic rounding
// random unit vector -> _d
const _d = { x: 0, y: 1, z: 0 };
function rdir(upBias) {
  const z = rs(), a = rnd() * TAU, r = Math.sqrt(1 - z * z);
  _d.x = r * Math.cos(a); _d.y = upBias ? Math.abs(z) * (1 - upBias) + upBias * (0.3 + 0.7 * rnd()) : z; _d.z = r * Math.sin(a);
  const l = Math.hypot(_d.x, _d.y, _d.z) || 1; _d.x /= l; _d.y /= l; _d.z /= l;
}

// ---- tuning --------------------------------------------------------------------------------------
const TUNE = {
  wind: [1.3, 0.0, 0.7],          // m/s, smoke and dust drift
  lightScale: 1,                  // G.render.sunColor / skyColor are albedo multipliers (lit = albedo * sunColor * NdotL)
  fireHDR: 0.8,                   // global multiplier on emissive brightness (1.0 reads hot under RENDER's bloom)
  smokeDensity: 1.0,
  maxFires: 10, maxColumns: 12,
  lodNear: 45, lodFar: 240, lodMin: 0.22,
};
const C_CYAN = [0.22, 0.85, 1.0], C_VANTA = [1.0, 0.3, 0.07], C_FIRE = [1.0, 0.5, 0.13], C_HOT = [1.0, 0.74, 0.38];
const teamCol = t => (t === 1 ? C_VANTA : C_CYAN);

// ---- pools ---------------------------------------------------------------------------------------
let LIT = null, ADD = null, BEAM = null, pMat = null, bMat = null, fogPatched = false;
const U = {
  uTime: { value: 0 }, uWind: { value: new THREE.Vector3() },
  uSunDir: { value: new THREE.Vector3(0.45, 0.75, 0.35).normalize() },
  uSunCol: { value: new THREE.Color(1.72, 1.06, 0.56) }, uSkyCol: { value: new THREE.Color(0.21, 0.29, 0.5) },
  uGndCol: { value: new THREE.Color(0.12, 0.09, 0.07) }, uExposure: { value: TUNE.lightScale },
  uFogCol: { value: new THREE.Color(0.6, 0.55, 0.55) }, uFog: { value: new THREE.Vector2(0, 0) },
  uLP: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  uLC: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
};

function makePool(cap, order, material) {
  const arr = new Float32Array(cap * STRIDE);
  const ib = new THREE.InstancedInterleavedBuffer(arr, STRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  for (let n = 0; n < 7; n++) geo.setAttribute('a' + n, new THREE.InterleavedBufferAttribute(ib, 4, n * 4));
  geo.instanceCount = cap;
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; mesh.renderOrder = order; mesh.matrixAutoUpdate = false; mesh.name = 'fx-particles';
  mesh.castShadow = false; mesh.receiveShadow = false;
  const pool = { cap, arr, ib, geo, mesh, cur: 0, dirty: 0, death: new Float32Array(cap), alive: 0, r0: { start: 0, count: 0 }, r1: { start: 0, count: 0 }, stride: STRIDE };
  ib.onUpload(() => { pool.dirty = 0; });
  G.scene.add(mesh);
  return pool;
}
function makeBeamPool(cap, material) {
  const arr = new Float32Array(cap * BSTRIDE);
  const ib = new THREE.InstancedInterleavedBuffer(arr, BSTRIDE, 1);
  ib.setUsage(THREE.DynamicDrawUsage);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  for (let n = 0; n < 4; n++) geo.setAttribute('b' + n, new THREE.InterleavedBufferAttribute(ib, 4, n * 4));
  geo.instanceCount = cap;
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false; mesh.renderOrder = 42; mesh.matrixAutoUpdate = false; mesh.name = 'fx-beams';
  const pool = { cap, arr, ib, geo, mesh, cur: 0, dirty: 0, death: new Float32Array(cap), alive: 0, r0: { start: 0, count: 0 }, r1: { start: 0, count: 0 }, stride: BSTRIDE };
  ib.onUpload(() => { pool.dirty = 0; });
  G.scene.add(mesh);
  return pool;
}
function flushPool(p) {
  if (!p.dirty) return;
  const ur = p.ib.updateRanges; ur.length = 0;
  if (p.dirty < p.cap) {
    let start = p.cur - p.dirty;
    if (start >= 0) { p.r0.start = start * p.stride; p.r0.count = p.dirty * p.stride; ur.push(p.r0); }
    else {
      start += p.cap;
      p.r0.start = 0; p.r0.count = p.cur * p.stride;
      p.r1.start = start * p.stride; p.r1.count = (p.cap - start) * p.stride;
      if (p.r0.count) ur.push(p.r0); ur.push(p.r1);
    }
  }
  p.ib.needsUpdate = true;
}
function clearPool(p) { p.arr.fill(0); p.death.fill(-1); p.cur = 0; p.dirty = p.cap; p.alive = 0; }
function disposePool(p) { if (!p) return; G.scene.remove(p.mesh); p.geo.dispose(); }
function countAlive(p, t) { let n = 0; const d = p.death; for (let i = 0; i < p.cap; i++) if (d[i] > t) n++; p.alive = n; return n; }

// raw particle write. 26 scalars, no allocation.
function W(p, x, y, z, vx, vy, vz, life, s0, s1, rot, spin, drag, grav, turb, r, g, b, a, er, eg, eb, hot, shape, stretch, floorY, pow) {
  const i = p.cur, o = i * STRIDE, A = p.arr, t = G.time;
  A[o] = x; A[o + 1] = y; A[o + 2] = z; A[o + 3] = t;
  A[o + 4] = vx; A[o + 5] = vy; A[o + 6] = vz; A[o + 7] = life;
  A[o + 8] = s0; A[o + 9] = s1; A[o + 10] = rot; A[o + 11] = spin;
  A[o + 12] = drag; A[o + 13] = grav; A[o + 14] = turb; A[o + 15] = rnd();
  A[o + 16] = r; A[o + 17] = g; A[o + 18] = b; A[o + 19] = a;
  A[o + 20] = er; A[o + 21] = eg; A[o + 22] = eb; A[o + 23] = hot;
  A[o + 24] = shape; A[o + 25] = stretch; A[o + 26] = floorY; A[o + 27] = pow;
  p.death[i] = t + life;
  p.cur = i + 1 === p.cap ? 0 : i + 1;
  if (p.dirty < p.cap) p.dirty++;
}

// ---- archetypes ----------------------------------------------------------------------------------
// lit smoke / dust puff
// craters are shallow: fade at street level so dust rolling out of one does not cut into the road
function softFloor(x, y, z) { let gy = groundY(x, y, z); if (gy < GROUND_Y && y > GROUND_Y - 1.6) gy = GROUND_Y; return y - gy < 3.5 ? gy - 0.05 : NOFLOOR; }
function puff(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav, turb) {
  W(LIT, x, y, z, vx, vy, vz, life, s0, s1, rnd() * TAU, rs() * 0.5, drag, grav, turb, r, g, b, a * TUNE.smokeDensity, 0, 0, 0, 0, 0, 0, softFloor(x, y, z), 2.2);
}
// fireball puff: burns for `hot` of its life then is smoke of the given albedo
function fireball(x, y, z, vx, vy, vz, life, s0, s1, hot, er, eg, eb, sr, sg, sb, sa, drag, grav, turb) {
  const k = TUNE.fireHDR;
  W(LIT, x, y, z, vx, vy, vz, life, s0, s1, rnd() * TAU, rs() * 0.9, drag, grav, turb, sr, sg, sb, sa * TUNE.smokeDensity, er * k, eg * k, eb * k, hot, 1, 0, softFloor(x, y, z), 2.6);
}
// pure additive flame lick (FLICK = extra height of the quad; set by fire sources, 0 for omnidirectional flashes)
let FLICK = 0;
function flame(x, y, z, vx, vy, vz, life, s0, s1, er, eg, eb, drag, grav, turb) {
  const k = TUNE.fireHDR;
  W(ADD, x, y, z, vx, vy, vz, life, s0, s1, 0, 0, drag, grav, turb, 0, 0, 0, 0, er * k, eg * k, eb * k, 1, 1, FLICK, NOFLOOR, 1.4);
}
function lick(x, y, z, vx, vy, vz, life, s0, s1, er, eg, eb, drag, grav, turb) { FLICK = 0.9; flame(x, y, z, vx, vy, vz, life, s0, s1, er, eg, eb, drag, grav, turb); FLICK = 0; }
function spark(x, y, z, vx, vy, vz, life, size, er, eg, eb, drag, grav, stretch, floorY) {
  const k = TUNE.fireHDR;
  W(ADD, x, y, z, vx, vy, vz, life, size, size * 0.35, 0, 0, drag, grav, 0, 0, 0, 0, 0, er * k, eg * k, eb * k, 1, 2, stretch, floorY, 1);
}
function ember(x, y, z, vx, vy, vz, life, size, er, eg, eb) {
  const k = TUNE.fireHDR;
  W(ADD, x, y, z, vx, vy, vz, life, size, size * 0.5, 0, 0, 0.9, -1.1, 1.6, 0, 0, 0, 0, er * k, eg * k, eb * k, 1.3, 2, 0.05, NOFLOOR, 1);
}
function glint(x, y, z, vx, vy, vz, life, size, er, eg, eb, floorY) {
  W(ADD, x, y, z, vx, vy, vz, life, size, size, 0, 0, 0.5, 9.8, 0, 0, 0, 0, 0, er, eg, eb, 1, 5, 0.02, floorY, 1);
}
function glow(x, y, z, s0, s1, life, er, eg, eb) {
  const k = TUNE.fireHDR;
  W(ADD, x, y, z, 0, 0, 0, life, s0, s1, 0, 0, 0.05, 0, 0, 0, 0, 0, 0, er * k, eg * k, eb * k, 1, 4, 0, NOFLOOR, 2);
}
function glowV(x, y, z, vx, vy, vz, s0, s1, life, er, eg, eb) {
  W(ADD, x, y, z, vx, vy, vz, life, s0, s1, 0, 0, 0.05, 0, 0, 0, 0, 0, 0, er, eg, eb, 1, 4, 0, NOFLOOR, 2);
}
// ground ring: lit dust (a > 0) and / or emissive front
function ring(x, y, z, s0, s1, life, r, g, b, a, er, eg, eb) {
  const lit = a > 0;
  W(lit ? LIT : ADD, x, y, z, 0, 0, 0, life, s0, s1, 0, 0, 0.05, 0, 0, r, g, b, a, er, eg, eb, (er + eg + eb) > 0 ? 1 : 0, 3, 0, NOFLOOR, 2.4);
}
function shell(x, y, z, s0, s1, life, er, eg, eb) {
  W(ADD, x, y, z, 0, 0, 0, life, s0, s1, rnd() * TAU, 0, 0.05, 0, 0, 0, 0, 0, 0, er, eg, eb, 1, 6, 0, NOFLOOR, 2.2);
}

// ---- beams ---------------------------------------------------------------------------------------
function beamW(x0, y0, z0, x1, y1, z1, life, r, g, b, width, mode, streak) {
  const p = BEAM, i = p.cur, o = i * BSTRIDE, A = p.arr, t = G.time;
  A[o] = x0; A[o + 1] = y0; A[o + 2] = z0; A[o + 3] = t;
  A[o + 4] = x1; A[o + 5] = y1; A[o + 6] = z1; A[o + 7] = life;
  A[o + 8] = r; A[o + 9] = g; A[o + 10] = b; A[o + 11] = width;
  A[o + 12] = mode; A[o + 13] = streak; A[o + 14] = rnd(); A[o + 15] = 0;
  p.death[i] = t + life;
  p.cur = i + 1 === p.cap ? 0 : i + 1;
  if (p.dirty < p.cap) p.dirty++;
}

// ---- LOD / budgets -------------------------------------------------------------------------------
let load = 1;                       // 1 = plenty of room, falls towards 0.25 as the pools fill
function lod(x, y, z) {
  const c = G.camera.position, d = Math.hypot(x - c.x, y - c.y, z - c.z);
  const k = d <= TUNE.lodNear ? 1 : Math.max(TUNE.lodMin, 1 - (d - TUNE.lodNear) / (TUNE.lodFar - TUNE.lodNear) * (1 - TUNE.lodMin));
  return k * load;
}
function camDist(x, y, z) { const c = G.camera.position; return Math.hypot(x - c.x, y - c.y, z - c.z); }
// token buckets: [tokens, perSecond, max]
const BK = { impact: [40, 260, 90], vox: [60, 300, 160], debris: [40, 160, 80], step: [20, 60, 40], collapse: [300, 380, 500], emit: [200, 900, 400], muzzle: [30, 200, 60] };
function take(b, n) { if (b[0] < n) { n = Math.max(0, Math.floor(b[0])); } b[0] -= n; return n; }

// ---- flash lights (forwarded to RENDER; mirrored to light the smoke) -----------------------------
const FL = []; for (let i = 0; i < 4; i++) FL.push({ x: 0, y: 0, z: 0, r: 0, cr: 0, cg: 0, cb: 0, t0: -9, dur: 0.001, pri: 0 });
let lastSmallFlash = -9;
function flash(x, y, z, col, intensity, radius, dur) {
  if (intensity < 3) { if (G.time - lastSmallFlash < 0.045) return; lastSmallFlash = G.time; }
  const hex = ((clamp(col[0], 0, 1) * 255) << 16) | ((clamp(col[1], 0, 1) * 255) << 8) | (clamp(col[2], 0, 1) * 255 | 0);
  const R = G.render;
  if (R && R.flash) { try { R.flash(x, y, z, hex, intensity, radius, dur); } catch (e) { /* renderer mid-edit */ } }
  // take the weakest slot
  let best = FL[0], bv = 1e9; const t = G.time;
  for (let i = 0; i < 4; i++) { const f = FL[i], u = (t - f.t0) / f.dur, v = u >= 1 ? 0 : f.pri * (1 - u); if (v < bv) { bv = v; best = f; } }
  if (bv > intensity) return;
  best.x = x; best.y = y; best.z = z; best.r = radius; best.cr = col[0] * intensity; best.cg = col[1] * intensity; best.cb = col[2] * intensity; best.t0 = t; best.dur = dur; best.pri = intensity;
}

// ---- recent-burst dedupe ---------------------------------------------------------------------------
const RC = new Float32Array(16 * 5); let rcN = 0;
function recent(tag, x, y, z, dist, dt) {
  const t = G.time;
  for (let i = 0; i < 16; i++) { const o = i * 5; if (RC[o + 4] === tag && t - RC[o + 3] < dt && t - RC[o + 3] >= 0 && Math.hypot(RC[o] - x, RC[o + 1] - y, RC[o + 2] - z) < dist) return true; }
  return false;
}
function mark(tag, x, y, z) { const o = (rcN++ & 15) * 5; RC[o] = x; RC[o + 1] = y; RC[o + 2] = z; RC[o + 3] = G.time; RC[o + 4] = tag; }
const TAG_PULSE = 1, TAG_LAND = 2, TAG_SD = 3, TAG_BOOM = 4, TAG_INCOMING = 5, TAG_SHIELD = 6, TAG_LANCE = 7, TAG_SIEGE = 8;

// ---- helpers ---------------------------------------------------------------------------------------
function groundY(x, y, z) {
  const g = G.grid; if (!g) return GROUND_Y;
  if (x < 0 || z < 0 || x >= WX || z >= WZ) return GROUND_Y;
  const t = g.topBelow(x, y + 0.6, z);
  return t > 0 ? t : GROUND_Y;
}
const _mc = [0.5, 0.47, 0.42];
function matDust(mat) {            // dust albedo (linear) for a voxel material: its colour pulled towards pale grit
  if (!mat || !MAT[mat]) { _mc[0] = 0.5; _mc[1] = 0.46; _mc[2] = 0.41; return _mc; }
  const r = COLOR[mat * 3], g = COLOR[mat * 3 + 1], b = COLOR[mat * 3 + 2];
  _mc[0] = 0.18 + 0.62 * r * r; _mc[1] = 0.165 + 0.62 * g * g; _mc[2] = 0.15 + 0.62 * b * b;
  return _mc;
}
const matClass = mat => { const m = MAT[mat]; if (!m) return 'concrete'; if (m.glass || m.sound === 'glass') return 'glass'; if (m.sound === 'metal') return 'metal'; if (m.sound === 'wood') return 'wood'; if (m.sound === 'dirt') return 'dirt'; if (m.sound === 'soft') return 'soft'; return 'concrete'; };
const weaponClass = w => { w = String(w || ''); if (w.indexOf('pulse') >= 0 || w === 'e_drone') return 'pulse'; if (w === 'lance') return 'beam'; if (w === 'mortar_b') return 'split'; if (/rifle|chain|autocannon|carbine|gun|mg/.test(w)) return 'bullet'; if (/shell|siege/.test(w)) return 'shell'; if (w === 'mortar') return 'mortar'; return 'heavy'; };
const weaponTeam = (w, team, shooter) => (team === 0 || team === 1) ? team : (shooter && shooter.team != null ? shooter.team : (String(w || '').indexOf('e_') === 0 ? 1 : 0));

// ---- emitters (persistent sources) -----------------------------------------------------------------
const EMAX = 56, E_FREE = 0, E_COLUMN = 1, E_FIRE = 2, E_REENTRY = 3, E_COLLAPSE = 4, E_TRAILUP = 5, E_SECOND = 6, E_HAZE = 7, E_TORCH = 8, E_POOL = 9, E_CHARGE = 10, E_SPARKS = 11;
const EM = [];
for (let i = 0; i < EMAX; i++) EM.push({ type: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t0: 0, dur: 0, scale: 1, acc: 0, a: 0, b: 0, c: 0, team: 0, ent: null, dirs: new Float32Array(16) });
function emitter(type, x, y, z, dur, scale) {
  let e = null, oldest = null, n = 0;
  for (let i = 0; i < EMAX; i++) { const q = EM[i]; if (q.type === E_FREE) { if (!e) e = q; } else if (q.type === type) { n++; if (!oldest || q.t0 < oldest.t0) oldest = q; } }
  const cap = type === E_FIRE ? TUNE.maxFires : type === E_COLUMN ? TUNE.maxColumns : 99;
  if (n >= cap || !e) { e = oldest; if (!e) { e = EM[0]; for (let i = 1; i < EMAX; i++) if (EM[i].t0 < e.t0 && EM[i].type !== E_REENTRY) e = EM[i]; } }
  e.type = type; e.x = x; e.y = y; e.z = z; e.vx = e.vy = e.vz = 0; e.t0 = G.time; e.dur = dur; e.scale = scale; e.acc = 0; e.a = e.b = e.c = 0; e.team = 0; e.ent = null;
  return e;
}

// which street directions are open around a point (for rolling dust)
function scanDirs(e, R) {
  const g = G.grid, d = e.dirs; let any = 0;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, cx = Math.cos(a), cz = Math.sin(a);
    let w = 1;
    if (g) {
      const y = e.y + 1.6;
      if (g.solidAt(e.x + cx * R, y, e.z + cz * R)) w = 0.12;
      else if (g.solidAt(e.x + cx * R * 2, y, e.z + cz * R * 2)) w = 0.45;
      else if (g.solidAt(e.x + cx * R * 3.2, y, e.z + cz * R * 3.2)) w = 0.8;
    }
    d[i] = w; any += w;
  }
  if (any < 2) for (let i = 0; i < 16; i++) d[i] = 1;
}
function pickDir(e) {              // -> _d (horizontal unit), weighted by openness
  for (let n = 0; n < 4; n++) {
    const a = rnd() * 16, i = a | 0;
    if (rnd() < e.dirs[i] || n === 3) { const an = a / 16 * TAU; _d.x = Math.cos(an); _d.z = Math.sin(an); _d.y = 0; return e.dirs[i]; }
  }
  return 1;
}

// ============================================================================
// EFFECT RECIPES
// ============================================================================
const DUST = [0.5, 0.455, 0.4];
let _h = 1;

// Explosion. S = 1 is a rocket (3 m blast radius). air = no ground interaction.
function explode(x, y, z, S, air, tint) {
  const L = lod(x, y, z), gy = groundY(x, y, z);
  const onGround = !air && (y - gy) < 1.4 * S + 1.2;
  const fy = onGround ? Math.max(y, gy + 0.3 * S) : y;
  const s13 = Math.pow(S, 1.25), sq = Math.sqrt(S);
  const hot = tint || C_FIRE;
  // --- flash
  glow(x, fy, z, 3.5 * S, 7.5 * S, 0.14, 10 * C_HOT[0], 10 * C_HOT[1], 10 * C_HOT[2]);
  glow(x, fy, z, 5 * S, 3.5 * S, 0.5 + 0.1 * S, 2.6 * hot[0], 2.6 * hot[1], 2.6 * hot[2]);
  flash(x, fy + 0.8, z, C_HOT, 3 + 2.2 * S, 12 + 9 * S, 0.22 + 0.06 * S);
  // --- fireball that cools into rolling smoke
  let n = roundP(clamp(9 * s13, 5, 70) * L);
  for (let i = 0; i < n; i++) {
    rdir(onGround ? 0.35 : 0);
    const sp = rr(1.5, 6.5) * sq * (0.6 + S * 0.4), o = rr(0.1, 0.7) * S;
    const life = rr(1.7, 3.4) * (0.75 + 0.25 * S), dark = rr(0.07, 0.17);
    fireball(x + _d.x * o, fy + _d.y * o, z + _d.z * o, _d.x * sp, _d.y * sp + 1.2 * sq, _d.z * sp, life,
      rr(0.6, 1.0) * S, rr(1.9, 2.9) * S, rr(0.2, 0.38), hot[0] * (_h = rr(3.2, 5.6)), hot[1] * _h, hot[2] * _h,
      dark, dark * 0.95, dark * 0.9, rr(0.75, 0.95), rr(1.8, 2.6), -rr(1.2, 2.6), rr(0.2, 0.7) * S);
  }
  // --- hot licks in the first instants
  n = roundP(clamp(6 * S, 3, 30) * L);
  for (let i = 0; i < n; i++) {
    rdir(onGround ? 0.3 : 0);
    const sp = rr(3, 11) * sq;
    flame(x, fy, z, _d.x * sp, _d.y * sp, _d.z * sp, rr(0.22, 0.5), rr(0.5, 0.9) * S, rr(1.2, 2.0) * S, C_HOT[0] * 5, C_HOT[1] * 5, C_HOT[2] * 5, 3.5, -2, 0);
  }
  // --- sparks
  n = roundP(clamp(22 * S, 8, 110) * L);
  for (let i = 0; i < n; i++) {
    rdir(onGround ? 0.25 : 0);
    const sp = rr(7, 26) * sq;
    spark(x, fy, z, _d.x * sp, _d.y * sp + 2, _d.z * sp, rr(0.45, 1.5), rr(0.045, 0.1) * (0.7 + 0.3 * S), 9, rr(4, 6.5), rr(1, 2.2), rr(0.5, 1.4), 9.8, 0.05, onGround ? gy + 0.03 : NOFLOOR);
  }
  // --- embers drifting up afterwards
  n = roundP(clamp(8 * S, 3, 40) * L);
  for (let i = 0; i < n; i++) {
    rdir(0.4);
    const sp = rr(1, 5) * sq;
    ember(x + _d.x * S, fy + _d.y * S, z + _d.z * S, _d.x * sp, _d.y * sp + 1.5, _d.z * sp, rr(2, 4.5), rr(0.04, 0.075), 7, rr(2.6, 3.8), rr(0.5, 1));
  }
  if (onGround) {
    // --- ground shock front + dust skirt
    ring(x, gy + 0.12, z, 1.2 * S, 8.5 * S, 0.3 + 0.05 * S, 0, 0, 0, 0, 1.6, 1.2, 0.8);
    ring(x, gy + 0.1, z, 1.5 * S, 9.5 * S, 0.9 + 0.2 * S, DUST[0], DUST[1], DUST[2], 0.5, 0, 0, 0);
    n = roundP(clamp(10 * S, 5, 46) * L);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = rr(4, 10) * sq * (0.6 + 0.4 * S), c = rr(0.85, 1.1);
      puff(x + Math.cos(a) * S * 0.8, gy + rr(0.3, 0.9) * S, z + Math.sin(a) * S * 0.8, Math.cos(a) * sp, rr(0.2, 1.6), Math.sin(a) * sp,
        rr(2.6, 5) * (0.8 + 0.2 * S), rr(0.6, 1.0) * S, rr(2.2, 3.6) * S, DUST[0] * c, DUST[1] * c, DUST[2] * c, rr(0.34, 0.55), rr(1.6, 2.6), -0.25, 0.3 * S);
    }
    // --- debris plume thrown up
    n = roundP(clamp(5 * S, 2, 20) * L);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, o = rnd() * S, sp = rr(5, 12) * sq;
      puff(x + Math.cos(a) * o, gy + 0.5, z + Math.sin(a) * o, Math.cos(a) * sp * 0.25, sp, Math.sin(a) * sp * 0.25, rr(2, 3.6), rr(0.5, 0.8) * S, rr(1.6, 2.6) * S, 0.3, 0.27, 0.24, rr(0.4, 0.6), rr(1.4, 2), 2.5, 0.3);
    }
    // --- aftermath
    if (S >= 0.75 && L > 0.3) {
      const e = emitter(E_COLUMN, x, gy + 0.4, z, rr(5, 9) * (0.6 + 0.4 * S), Math.min(S, 3)); e.a = rr(0.5, 1);
      if (rnd() < 0.55 + 0.2 * S) { const a = rnd() * TAU, o = rnd() * S * 1.2; emitter(E_FIRE, x + Math.cos(a) * o, groundY(x + Math.cos(a) * o, y + 1, z + Math.sin(a) * o) + 0.1, z + Math.sin(a) * o, rr(7, 16), rr(0.6, 1.1) * Math.min(1.6, sq)); }
    }
  } else {
    shell(x, y, z, 1.5 * S, 7.5 * S, 0.28, 1.5, 1.1, 0.75);
    n = roundP(clamp(5 * S, 3, 18) * L);
    for (let i = 0; i < n; i++) { rdir(0); const sp = rr(2, 5) * sq; puff(x + _d.x * S, y + _d.y * S, z + _d.z * S, _d.x * sp, _d.y * sp, _d.z * sp, rr(2.5, 4.5), rr(0.8, 1.2) * S, rr(2.2, 3.2) * S, 0.1, 0.095, 0.09, 0.6, 1.6, -0.5, 0.5); }
  }
  mark(TAG_BOOM, x, y, z);
}

function pulseHit(x, y, z, S, team, nx, ny, nz) {
  if (recent(TAG_PULSE, x, y, z, 0.8, 0.06)) return;
  mark(TAG_PULSE, x, y, z);
  const c = teamCol(team), L = lod(x, y, z);
  const hasN = nx || ny || nz;
  glow(x, y, z, 1.6 * S, 3.4 * S, 0.12, c[0] * 12 + 3, c[1] * 12 + 3, c[2] * 12 + 3);
  glow(x, y, z, 2.6 * S, 1.6 * S, 0.34, c[0] * 2.4, c[1] * 2.4, c[2] * 2.4);
  shell(x, y, z, 0.5 * S, 2.6 * S, 0.2, c[0] * 2.5, c[1] * 2.5, c[2] * 2.5);
  flash(x, y, z, c, 3.2 * S, 9 * S, 0.14);
  let n = roundP(12 * S * L);
  for (let i = 0; i < n; i++) {
    rdir(0);
    if (hasN && _d.x * nx + _d.y * ny + _d.z * nz < 0) { _d.x = -_d.x; _d.y = -_d.y; _d.z = -_d.z; }
    const sp = rr(5, 20);
    spark(x, y, z, _d.x * sp, _d.y * sp, _d.z * sp, rr(0.2, 0.6), rr(0.04, 0.075), c[0] * 8 + 1.5, c[1] * 8 + 1.5, c[2] * 8 + 1.5, 2.5, 5, 0.05, NOFLOOR);
  }
  n = roundP(4 * S * L);
  for (let i = 0; i < n; i++) {
    rdir(0);
    flame(x, y, z, _d.x * 3, _d.y * 3, _d.z * 3, rr(0.15, 0.3), 0.3 * S, rr(0.7, 1.1) * S, c[0] * 5, c[1] * 5, c[2] * 5, 4, 0, 0);
  }
  n = roundP(3 * S * L);
  for (let i = 0; i < n; i++) {
    rdir(0.3);
    puff(x, y, z, _d.x * 2.5 + (nx || 0) * 2, _d.y * 2.5 + (ny || 0) * 2, _d.z * 2.5 + (nz || 0) * 2, rr(0.9, 1.7), 0.35 * S, rr(1.1, 1.7) * S, 0.34, 0.32, 0.3, 0.4, 2.2, -0.6, 0.2);
  }
}

function sparksBurst(x, y, z, S, dx, dy, dz, col) {
  const L = lod(x, y, z), c = col || C_FIRE, n = roundP(12 * S * L), hasD = dx || dy || dz;
  for (let i = 0; i < n; i++) {
    rdir(0);
    const sp = rr(4, 16) * Math.sqrt(S), k = hasD ? rr(3, 9) * Math.sqrt(S) : 0;
    spark(x, y, z, _d.x * sp + dx * k, _d.y * sp + dy * k + 1.5, _d.z * sp + dz * k, rr(0.3, 1.0), rr(0.035, 0.07), c[0] * 9, c[1] * 9 + 1, c[2] * 9 + 0.6, 1, 9.8, 0.05, NOFLOOR);
  }
  glow(x, y, z, 0.5 * S, 1.3 * S, 0.09, c[0] * 6 + 1, c[1] * 6 + 1, c[2] * 6 + 0.8);
}

function glassBurst(x, y, z, S, count, dx, dy, dz) {
  const L = lod(x, y, z), gy = groundY(x, y, z) + 0.03, sc = U.uSunCol.value, sk = U.uSkyCol.value;
  const n = roundP(clamp(count == null ? 14 * S : count, 2, 40) * L);
  for (let i = 0; i < n; i++) {
    rdir(0.1);
    const sp = rr(1.5, 7), sun = rnd() < 0.6;
    glint(x + rs() * S * 0.6, y + rs() * S * 0.6, z + rs() * S * 0.6, _d.x * sp + (dx || 0) * 4, _d.y * sp + 1 + (dy || 0) * 4, _d.z * sp + (dz || 0) * 4, rr(0.8, 2.0), rr(0.03, 0.06),
      sun ? sc.r * 1.6 : sk.r * 2.2 + 0.4, sun ? sc.g * 1.6 : sk.g * 2.2 + 0.5, sun ? sc.b * 1.6 : sk.b * 2.2 + 0.6, gy);
  }
  // faint glittering mist
  const m = roundP(2 * S * L);
  for (let i = 0; i < m; i++) { rdir(0); puff(x, y, z, _d.x * 2 + (dx || 0) * 2, _d.y * 1.5, _d.z * 2 + (dz || 0) * 2, rr(0.7, 1.3), 0.3 * S, rr(0.9, 1.5) * S, 0.62, 0.7, 0.75, 0.16, 2.5, 0.4, 0.2); }
}

function dustCloud(x, y, z, S, col, a) {
  const L = lod(x, y, z), c = col || DUST, n = roundP(clamp(7 * S, 2, 30) * L);
  for (let i = 0; i < n; i++) {
    rdir(0.25);
    const sp = rr(0.8, 3.2) * Math.sqrt(S), o = rr(0, 0.7) * S, k = rr(0.85, 1.12);
    puff(x + _d.x * o, y + _d.y * o * 0.6, z + _d.z * o, _d.x * sp, _d.y * sp * 0.7 + 0.3, _d.z * sp, rr(2.2, 4.6), rr(0.45, 0.8) * S, rr(1.5, 2.5) * S, c[0] * k, c[1] * k, c[2] * k, (a || 0.42) * rr(0.8, 1.15), rr(1.5, 2.4), -0.1, 0.35);
  }
}

function shockwave(x, y, z, S, tint) {
  const gy = groundY(x, y, z), c = tint || C_HOT;
  ring(x, gy + 0.12, z, 0.8 * S, 7 * S, 0.34, 0, 0, 0, 0, c[0] * 1.8, c[1] * 1.8, c[2] * 1.8);
  ring(x, gy + 0.1, z, 1.2 * S, 8 * S, 0.9, DUST[0], DUST[1], DUST[2], 0.5, 0, 0, 0);
}

// radial ground dust wall: n puffs racing outwards at speed v, hanging for `life`
function dustWall(x, gy, z, n, r0, v, size, life, alpha, col) {
  const c = col || DUST;
  for (let i = 0; i < n; i++) {
    const a = (i + rnd()) / n * TAU, sp = v * rr(0.65, 1.15), k = rr(0.86, 1.1);
    puff(x + Math.cos(a) * r0, gy + size * rr(0.25, 0.6), z + Math.sin(a) * r0, Math.cos(a) * sp, rr(0.2, 1.5), Math.sin(a) * sp, life * rr(0.7, 1.2), size * rr(0.5, 0.8), size * rr(2.0, 3.0), c[0] * k, c[1] * k, c[2] * k, alpha * rr(0.8, 1.1), rr(1.3, 1.9), -0.12, size * 0.25);
  }
}

function muzzle(x, y, z, dx, dy, dz, S, cls, team) {
  const d = camDist(x, y, z); if (d > 260) return;
  const L = lod(x, y, z);
  if (cls === 'pulse') {
    const c = teamCol(team);
    glow(x + dx * 0.4 * S, y + dy * 0.4 * S, z + dz * 0.4 * S, 1.3 * S, 2.4 * S, 0.085, c[0] * 9 + 2.5, c[1] * 9 + 2.5, c[2] * 9 + 2.5);
    for (let i = 0; i < 3; i++) flame(x + dx * (0.3 + i * 0.45) * S, y + dy * (0.3 + i * 0.45) * S, z + dz * (0.3 + i * 0.45) * S, dx * 14, dy * 14, dz * 14, rr(0.07, 0.13), (0.42 - i * 0.09) * S, 0.12 * S, c[0] * 7 + 1, c[1] * 7 + 1, c[2] * 7 + 1, 6, 0, 0);
    const n = roundP(4 * L);
    for (let i = 0; i < n; i++) { rdir(0); const sp = rr(6, 16); spark(x, y, z, dx * sp + _d.x * 4, dy * sp + _d.y * 4, dz * sp + _d.z * 4, rr(0.12, 0.3), 0.04 * S, c[0] * 7 + 1, c[1] * 7 + 1, c[2] * 7 + 1, 3, 2, 0.05, NOFLOOR); }
    flash(x + dx, y + dy, z + dz, c, 2.2 * S, 9 * S, 0.07);
    return;
  }
  if (cls === 'bullet') {
    glow(x + dx * 0.25 * S, y + dy * 0.25 * S, z + dz * 0.25 * S, 0.5 * S, 0.95 * S, 0.055, 9, 6.5, 3.2);
    flame(x + dx * 0.2 * S, y + dy * 0.2 * S, z + dz * 0.2 * S, dx * 9, dy * 9, dz * 9, 0.06, 0.2 * S, 0.34 * S, 8, 5, 2, 8, 0, 0);
    flame(x + dx * 0.55 * S, y + dy * 0.55 * S, z + dz * 0.55 * S, dx * 9, dy * 9, dz * 9, 0.05, 0.13 * S, 0.2 * S, 7, 4, 1.4, 8, 0, 0);
    if (rnd() < 0.5 * L) puff(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, dx * 2 + rs(), dy * 2 + 0.6, dz * 2 + rs(), rr(0.5, 0.9), 0.1 * S, 0.5 * S, 0.5, 0.5, 0.5, 0.16, 3, -0.5, 0.1);
    flash(x + dx * 0.5, y + dy * 0.5, z + dz * 0.5, C_HOT, 1.2 * S, 5 * S, 0.05);
    return;
  }
  // heavy: launcher back-blast / tank gun
  const big = cls === 'shell';
  const k = big ? 2.2 * S : S;
  glow(x + dx * 0.5 * k, y + dy * 0.5 * k, z + dz * 0.5 * k, 1.2 * k, 2.8 * k, 0.1, 11, 7.5, 3.6);
  flash(x + dx, y + dy, z + dz, C_HOT, 3 * k, 10 * k, 0.1);
  let n = roundP((big ? 7 : 3) * L + 1);
  for (let i = 0; i < n; i++) { rdir(0); const sp = rr(8, 22); flame(x, y, z, dx * sp + _d.x * 3 * k, dy * sp + _d.y * 3 * k, dz * sp + _d.z * 3 * k, rr(0.1, 0.24), 0.3 * k, rr(0.6, 1.0) * k, 8, 4.6, 1.5, 5, 0, 0); }
  n = roundP((big ? 8 : 5) * L);
  const back = big ? 0.25 : -1;        // launchers vent backwards, guns blow smoke forwards
  for (let i = 0; i < n; i++) {
    rdir(0); const sp = rr(2.5, 8) * back;
    puff(x, y, z, dx * sp + _d.x * 1.6 * k, dy * sp + _d.y * 1.6 * k + 0.4, dz * sp + _d.z * 1.6 * k, rr(1.0, 2.2), 0.25 * k, rr(0.9, 1.5) * k, 0.55, 0.53, 0.5, rr(0.25, 0.4), 2.6, -0.5, 0.25);
  }
  if (big) {
    const gy = groundY(x, y, z);
    if (y - gy < 4) dustWall(x, gy, z, roundP(9 * L), 1.2, 6, 0.7, 2.2, 0.32);
    for (let i = 0; i < 6; i++) { rdir(0); const sp = rr(14, 30); spark(x, y, z, dx * sp + _d.x * 5, dy * sp + _d.y * 5, dz * sp + _d.z * 5, rr(0.2, 0.5), 0.05, 9, 5.5, 2, 1.5, 9.8, 0.05, NOFLOOR); }
  }
}

function bulletImpact(x, y, z, nx, ny, nz, mat, power, entKind) {
  const d = camDist(x, y, z); if (d > 200) return;
  const L = lod(x, y, z);
  let budget = take(BK.impact, 8); if (budget <= 0) return;
  const cls = entKind ? (entKind === 'soldier' || entKind === 'pilot' ? 'soft' : 'metal') : matClass(mat);
  const P = clamp((power || 30) / 30, 0.6, 2.2);
  if (cls === 'metal') {
    const n = Math.min(budget, roundP(7 * L * P));
    for (let i = 0; i < n; i++) { rdir(0); const sp = rr(4, 15); spark(x, y, z, nx * sp * 0.6 + _d.x * sp * 0.7, ny * sp * 0.6 + _d.y * sp * 0.7 + 1, nz * sp * 0.6 + _d.z * sp * 0.7, rr(0.2, 0.7), rr(0.028, 0.05), 9, 6, 2.4, 1.2, 9.8, 0.055, NOFLOOR); }
    glow(x, y, z, 0.3 * P, 0.75 * P, 0.07, 8, 6, 3.4);
    flash(x + nx * 0.3, y + ny * 0.3, z + nz * 0.3, C_HOT, 0.9, 3.5, 0.05);
  } else if (cls === 'glass') {
    glassBurst(x, y, z, 0.5, Math.min(budget, 7), nx, ny, nz);
  } else if (cls === 'soft') {
    // soldiers: armour spall, no gore
    const n = Math.min(budget, roundP(4 * L));
    for (let i = 0; i < n; i++) { rdir(0); const sp = rr(2, 7); spark(x, y, z, nx * 3 + _d.x * sp, ny * 3 + _d.y * sp + 1, nz * 3 + _d.z * sp, rr(0.15, 0.4), 0.03, 7, 4.6, 2.2, 2, 9.8, 0.05, NOFLOOR); }
    puff(x, y, z, nx * 1.5, ny * 1.5 + 0.4, nz * 1.5, rr(0.5, 0.9), 0.12, 0.55, 0.42, 0.4, 0.38, 0.3, 3, -0.3, 0.1);
  } else {
    const c = matDust(mat);
    const n = Math.min(budget, roundP(3 * L * P + 0.5));
    for (let i = 0; i < n; i++) {
      rdir(0); const sp = rr(1.5, 5) * P;
      puff(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1, nx * sp + _d.x * 1.1, ny * sp + _d.y * 1.1 + 0.3, nz * sp + _d.z * 1.1, rr(0.7, 1.6), rr(0.1, 0.18) * P, rr(0.5, 0.95) * P, c[0], c[1], c[2], rr(0.32, 0.5), rr(2.6, 4), 0.3, 0.12);
    }
    // grit chips: tiny unlit-looking sparks would be wrong for concrete; a couple of dull hot flecks only
    if (cls !== 'dirt' && cls !== 'wood' && rnd() < 0.6) { rdir(0); spark(x, y, z, nx * 6 + _d.x * 4, ny * 6 + _d.y * 4 + 1, nz * 6 + _d.z * 4, rr(0.15, 0.35), 0.026, 6, 3.6, 1.2, 1.5, 9.8, 0.05, NOFLOOR); }
    if (rnd() < 0.5) glow(x, y, z, 0.2, 0.5, 0.05, 5, 3.6, 2);
  }
}

function footstep(x, y, z, heavy) {
  const d = camDist(x, y, z);
  if (heavy) {
    if (d > 220) return;
    const L = lod(x, y, z), n = take(BK.step, roundP(9 * L));
    const gy = groundY(x, y + 0.5, z);
    const c = matDust(G.grid ? G.grid.matAt(x, gy - 0.25, z) : 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = rr(1.8, 4.6), k = rr(0.9, 1.1);
      puff(x + Math.cos(a) * 0.7, gy + rr(0.15, 0.4), z + Math.sin(a) * 0.7, Math.cos(a) * sp, rr(0.3, 1.3), Math.sin(a) * sp, rr(1.3, 2.4), rr(0.3, 0.5), rr(1.2, 2.0), c[0] * k, c[1] * k, c[2] * k, rr(0.26, 0.4), rr(2, 3), -0.15, 0.25);
    }
    if (n > 0) ring(x, gy + 0.08, z, 0.8, 3.6, 0.5, c[0], c[1], c[2], 0.3, 0, 0, 0);
  } else {
    if (d > 45 || take(BK.step, 1) < 1) return;
    const gy = groundY(x, y + 0.3, z);
    puff(x, gy + 0.08, z, rs() * 0.6, 0.35, rs() * 0.6, rr(0.5, 0.9), 0.08, rr(0.3, 0.45), DUST[0], DUST[1], DUST[2], 0.2, 3, -0.1, 0.05);
  }
}

function landing(x, y, z, S, team) {
  if (recent(TAG_LAND, x, y, z, 6, 0.6)) return;
  mark(TAG_LAND, x, y, z);
  const L = lod(x, y, z), gy = groundY(x, y + 1, z), c = teamCol(team);
  // contact flash: retro wash in faction colour + white-hot core
  glow(x, gy + 1.5, z, 4 * S, 12 * S, 0.18, 6 + c[0] * 5, 5.5 + c[1] * 5, 4.5 + c[2] * 5);
  glow(x, gy + 1.2, z, 9 * S, 6 * S, 0.7, c[0] * 2 + 1.2, c[1] * 2 + 0.8, c[2] * 2 + 0.5);
  flash(x, gy + 3, z, [0.6 + c[0] * 0.4, 0.6 + c[1] * 0.4, 0.55 + c[2] * 0.45], 6.5 * S, 42 * S, 0.4);
  // shock rings
  ring(x, gy + 0.14, z, 2 * S, 26 * S, 0.5, 0, 0, 0, 0, 1.4 + c[0], 1.2 + c[1], 1.0 + c[2]);
  ring(x, gy + 0.12, z, 2.5 * S, 22 * S, 1.3, DUST[0], DUST[1], DUST[2], 0.62, 0, 0, 0);
  ring(x, gy + 0.1, z, 1.5 * S, 13 * S, 2.0, DUST[0] * 0.9, DUST[1] * 0.9, DUST[2] * 0.9, 0.5, 0, 0, 0);
  // dust wall: fast outer ring + slower fat inner ring that hangs
  dustWall(x, gy, z, roundP(30 * L), 2.5 * S, 17 * S, 1.5 * S, 5.5, 0.52);
  dustWall(x, gy, z, roundP(20 * L), 1.5 * S, 8 * S, 2.0 * S, 7.5, 0.5);
  // vertical kick
  let n = roundP(16 * L);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, o = rr(0.5, 3.2) * S, sp = rr(7, 17);
    puff(x + Math.cos(a) * o, gy + 0.6, z + Math.sin(a) * o, Math.cos(a) * 2.5, sp, Math.sin(a) * 2.5, rr(2.6, 4.4), rr(0.7, 1.1) * S, rr(2.4, 3.6) * S, 0.36, 0.33, 0.29, rr(0.45, 0.62), rr(1.3, 1.9), 3.2, 0.5);
  }
  n = roundP(46 * L);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, sp = rr(8, 26), up = rr(2, 15);
    spark(x + Math.cos(a) * S, gy + 0.3, z + Math.sin(a) * S, Math.cos(a) * sp, up, Math.sin(a) * sp, rr(0.5, 1.4), rr(0.05, 0.1), 9, rr(4.5, 6.5), rr(1.2, 2.4), 0.6, 9.8, 0.05, gy + 0.03);
  }
  const e = emitter(E_COLUMN, x, gy + 0.5, z, 4, 1.2 * S); e.a = 0; e.b = 1;   // pale dust column, no fire
}

function slamFx(x, y, z, radius, team) {
  const L = lod(x, y, z), gy = groundY(x, y + 1, z), c = teamCol(team), R = radius || 8;
  glow(x, gy + 0.8, z, R * 0.25, R * 0.7, 0.16, 3 + c[0] * 5, 3 + c[1] * 5, 2.5 + c[2] * 5);
  flash(x, gy + 2, z, [0.5 + c[0] * 0.5, 0.5 + c[1] * 0.5, 0.5 + c[2] * 0.5], 7, R * 3, 0.28);
  ring(x, gy + 0.16, z, R * 0.2, R * 1.35, 0.42, 0, 0, 0, 0, c[0] * 3 + 0.8, c[1] * 3 + 0.8, c[2] * 3 + 0.8);
  ring(x, gy + 0.14, z, R * 0.15, R * 1.0, 0.3, 0, 0, 0, 0, 1.8, 1.5, 1.1);
  ring(x, gy + 0.1, z, R * 0.25, R * 1.5, 1.2, DUST[0], DUST[1], DUST[2], 0.6, 0, 0, 0);
  dustWall(x, gy, z, roundP(26 * L), R * 0.2, R * 1.9, R * 0.14, 4.2, 0.5);
  let n = roundP(10 * L);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, o = rr(0.2, 0.5) * R, sp = rr(6, 13);
    puff(x + Math.cos(a) * o, gy + 0.4, z + Math.sin(a) * o, Math.cos(a) * 2, sp, Math.sin(a) * 2, rr(1.8, 3), R * 0.09, R * 0.3, 0.38, 0.35, 0.31, 0.5, 1.6, 3.5, 0.4);
  }
  n = roundP(30 * L);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, sp = rr(6, 22);
    spark(x, gy + 0.3, z, Math.cos(a) * sp, rr(1, 11), Math.sin(a) * sp, rr(0.35, 1.1), rr(0.04, 0.08), 9, 5.5, 2, 0.7, 9.8, 0.05, gy + 0.03);
  }
}

function selfDestruct(x, y, z, S) {
  if (recent(TAG_SD, x, y, z, 10, 1.5)) return;
  mark(TAG_SD, x, y, z);
  const gy = groundY(x, y + 1, z), cy = Math.max(y, gy + 2), L = lod(x, y, z), K = 4.2 * S;
  // reactor flash: blue-white, then the fire
  glow(x, cy + 2, z, 16 * S, 60 * S, 0.28, 13, 14, 17);
  glow(x, cy + 2, z, 30 * S, 22 * S, 1.3, 5, 2.8, 1.0);
  shell(x, cy, z, 6 * S, 55 * S, 0.5, 1.4, 1.2, 1.0);
  flash(x, cy + 4, z, [1, 0.85, 0.65], 14 * S, 110 * S, 0.7);
  explode(x, cy, z, K, false);
  // rising pillar -> mushroom cap
  let n = roundP(26 * L);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, o = rnd() * 2.5 * S, sp = rr(9, 26) * S, dark = rr(0.03, 0.09);
    fireball(x + Math.cos(a) * o, cy + rr(0, 3), z + Math.sin(a) * o, Math.cos(a) * 3, sp, Math.sin(a) * 3, rr(3.5, 6.5), rr(2, 3) * S, rr(5, 8) * S, rr(0.3, 0.5), rr(6, 10), rr(3, 4.6), rr(0.7, 1.3), dark, dark, dark, 0.9, rr(0.9, 1.4), -2.4, 1.2);
  }
  // ground shock + the dust wall that flattens the street
  ring(x, gy + 0.2, z, 4 * S, 75 * S, 0.75, 0, 0, 0, 0, 2.6, 2.0, 1.4);
  ring(x, gy + 0.16, z, 3 * S, 60 * S, 1.8, DUST[0], DUST[1], DUST[2], 0.7, 0, 0, 0);
  ring(x, gy + 0.12, z, 2 * S, 34 * S, 2.6, DUST[0] * 0.85, DUST[1] * 0.85, DUST[2] * 0.85, 0.6, 0, 0, 0);
  dustWall(x, gy, z, roundP(40 * L), 5 * S, 34 * S, 2.6 * S, 8, 0.56);
  dustWall(x, gy, z, roundP(26 * L), 3 * S, 16 * S, 3.4 * S, 11, 0.55);
  n = roundP(120 * L);
  for (let i = 0; i < n; i++) {
    rdir(0.3); const sp = rr(14, 55);
    spark(x, cy, z, _d.x * sp, _d.y * sp + 4, _d.z * sp, rr(0.8, 2.4), rr(0.07, 0.15), 10, rr(4.5, 7), rr(1.2, 2.6), 0.35, 9.8, 0.045, gy + 0.03);
  }
  n = roundP(50 * L);
  for (let i = 0; i < n; i++) { rdir(0.5); const sp = rr(2, 10), o = rr(2, 9) * S; ember(x + _d.x * o, cy + _d.y * o, z + _d.z * o, _d.x * sp, _d.y * sp + 2, _d.z * sp, rr(3, 7), rr(0.05, 0.09), 7, rr(2.6, 3.8), rr(0.5, 1)); }
  // secondaries cooking off + long aftermath
  const e = emitter(E_SECOND, x, cy, z, 1.5, S); e.a = 6; e.b = 9 * S;
  const c = emitter(E_COLUMN, x, gy + 1, z, 26, 3.4 * S); c.a = 1;
  for (let i = 0; i < 4; i++) { const a = rnd() * TAU, o = rr(2, 8) * S; const fx = x + Math.cos(a) * o, fz = z + Math.sin(a) * o; emitter(E_FIRE, fx, groundY(fx, cy + 2, fz) + 0.1, fz, rr(14, 26), rr(1.0, 1.7)); }
}

function ejectFx(x, y, z, ent) {
  const L = lod(x, y, z);
  glow(x, y, z, 2, 6, 0.14, 12, 9, 5);
  flash(x, y, z, C_HOT, 6, 20, 0.2);
  shell(x, y, z, 1, 7, 0.3, 1.6, 1.3, 1.0);
  let n = roundP(14 * L);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(4, 10); puff(x, y, z, Math.cos(a) * sp, rr(-0.5, 1.5), Math.sin(a) * sp, rr(1.4, 2.6), 0.5, rr(1.6, 2.4), 0.6, 0.58, 0.55, 0.42, 2.2, -0.4, 0.3); }
  n = roundP(26 * L);
  for (let i = 0; i < n; i++) { rdir(0.4); const sp = rr(6, 20); spark(x, y, z, _d.x * sp, _d.y * sp + 3, _d.z * sp, rr(0.4, 1.1), 0.06, 9, 5.6, 2, 0.8, 9.8, 0.05, NOFLOOR); }
  const e = emitter(E_TRAILUP, x, y, z, 1.6, 1); e.vy = 30; e.ent = ent && ent.kind === 'pilot' ? ent : null;
}

function reentry(x, z, eta, team) {
  if (recent(TAG_INCOMING, x, 0, z, 3, 0.3)) return;
  mark(TAG_INCOMING, x, 0, z);
  eta = Math.max(0.15, eta || 3);
  const e = emitter(E_REENTRY, x, 0, z, eta, 1);
  e.team = team === 1 ? 1 : 0;
  e.a = Math.min(430, 62.5 * eta);                     // start altitude above the ground (PLAYER drops 250 m in 4 s)
  e.vx = 0; e.vz = 0;
  e.y = groundY(x, 60, z); e.b = 0; e.c = -1;
  e.ent = findFalling(x, z, e.team);
}
// the entity that is actually falling towards (x,z), if its owner has created it already
function findFalling(x, z, team) {
  const L = G.ents.list;
  for (let i = L.length - 1; i >= 0; i--) { const q = L[i]; if ((q.kind === 'mech' || q.kind === 'emech') && q.pos && q.pos.y > 25 && Math.abs(q.pos.x - x) < 3 && Math.abs(q.pos.z - z) < 3) return q; }
  return null;
}
// position of a reentry emitter at normalised time u -> _d
function reentryPos(e, u) {
  const k = (1 - u);
  _d.x = e.x; _d.y = e.y + e.a * k; _d.z = e.z;
}

function collapseFx(x, y, z, mass, height) {
  const d = camDist(x, y, z); if (d > 330) return;
  const R = clamp(Math.cbrt(Math.max(1, mass)) * 0.5, 2.5, 13);
  const gy = GROUND_Y;
  // merge with a collapse already running nearby (a tower comes down as many clusters)
  for (let i = 0; i < EMAX; i++) { const q = EM[i]; if (q.type === E_COLLAPSE && Math.hypot(q.x - x, q.z - z) < 10 && G.time - q.t0 < q.dur) { q.dur = Math.min(q.dur + 0.5, G.time - q.t0 + 3.5); q.scale = Math.min(13, Math.max(q.scale, R) + 0.4); q.a = Math.max(q.a, y - gy); return; } }
  const e = emitter(E_COLLAPSE, x, gy, z, 1.4 + Math.sqrt(Math.max(0, y - gy)) * 0.36, R);
  e.a = Math.max(1, y - gy); e.b = Math.max(2, height || 4);
  scanDirs(e, R + 2);
}

function levelledFx(id) {
  const b = G.city && G.city.buildings && G.city.buildings[id]; if (!b) return;
  const VSZ = G.VS, x = (b.i0 + b.i1 + 1) * 0.5 * VSZ, z = (b.k0 + b.k1 + 1) * 0.5 * VSZ;
  const R = clamp(Math.max(b.i1 - b.i0, b.k1 - b.k0) * VSZ * 0.5, 4, 14);
  const e = emitter(E_HAZE, x, GROUND_Y, z, 3.5, R); scanDirs(e, R + 2);
}

// ---- emitter update ----------------------------------------------------------------------------------
function updateEmitters(dt) {
  const t = G.time;
  for (let i = 0; i < EMAX; i++) {
    const e = EM[i]; if (e.type === E_FREE) continue;
    const age = t - e.t0, u = age / e.dur;
    if (u >= 1 || age < 0) { e.type = E_FREE; e.ent = null; continue; }
    const S = e.scale;
    switch (e.type) {
      case E_COLUMN: {
        const L = lod(e.x, e.y, e.z), k = 1 - u;
        e.acc += dt * (3.5 + 3 * S) * (0.3 + 0.7 * k) * L;
        while (e.acc >= 1) {
          e.acc -= 1;
          const o = rr(0, 0.7) * S, a = rnd() * TAU;
          if (e.b) {          // pale dust column
            puff(e.x + Math.cos(a) * o, e.y + rr(0, 1), e.z + Math.sin(a) * o, rs() * 0.6, rr(1, 2.6), rs() * 0.6, rr(3.5, 6), rr(0.8, 1.3) * S, rr(2.6, 4) * S, DUST[0], DUST[1], DUST[2], 0.34 * k + 0.08, 0.7, -0.5, 0.6);
          } else {            // oily smoke, darkest while fresh
            const dark = rr(0.07, 0.15) + (1 - k) * 0.12 + (1 - e.a) * 0.1;
            puff(e.x + Math.cos(a) * o, e.y + rr(0, 0.6), e.z + Math.sin(a) * o, rs() * 0.5, rr(1.6, 3.4), rs() * 0.5, rr(4.5, 8) * (0.8 + 0.1 * S), rr(0.55, 0.9) * S, rr(2.4, 3.8) * S, dark, dark * 0.97, dark * 0.94, rr(0.5, 0.78) * (0.4 + 0.6 * k), 0.55, -rr(0.9, 1.8), 0.7);
          }
        }
        if (!e.b && rnd() < dt * 3 * L * k) ember(e.x + rs() * S, e.y + rr(0.2, 1.5), e.z + rs() * S, rs() * 1.2, rr(1, 3), rs() * 1.2, rr(2, 4.5), rr(0.035, 0.06), 6.5, rr(2.4, 3.4), rr(0.4, 0.9));
        break;
      }
      case E_FIRE: {
        const dc = camDist(e.x, e.y, e.z); if (dc > 200) break;
        const L = lod(e.x, e.y, e.z), k = Math.min(1, (1 - u) * 3) * Math.min(1, age * 2);
        e.acc += dt * 22 * L * (0.4 + 0.6 * k);
        while (e.acc >= 1) {
          e.acc -= 1;
          const o = rr(0, 0.55) * S, a = rnd() * TAU, h = rr(0.5, 1.0);
          lick(e.x + Math.cos(a) * o, e.y + rr(0.05, 0.3), e.z + Math.sin(a) * o, rs() * 0.5, rr(1.6, 3.6) * (0.6 + 0.4 * S), rs() * 0.5, rr(0.35, 0.75), rr(0.3, 0.5) * S * k + 0.08, 0.1 * S, C_FIRE[0] * 2.5 * h, C_FIRE[1] * 2.5 * h, C_FIRE[2] * 2.5 * h, 1.2, -2.5, 0.25);
        }
        if (rnd() < dt * 5 * L) { const dark = rr(0.05, 0.12); puff(e.x + rs() * 0.4 * S, e.y + rr(0.7, 1.3) * S, e.z + rs() * 0.4 * S, rs() * 0.4, rr(1.4, 2.6), rs() * 0.4, rr(3, 5.5), 0.35 * S, rr(1.5, 2.4) * S, dark, dark, dark, rr(0.35, 0.55) * k, 0.6, -1.2, 0.5); }
        if (rnd() < dt * 4.5 * L) ember(e.x + rs() * 0.5 * S, e.y + rr(0.3, 1.2), e.z + rs() * 0.5 * S, rs() * 1.4, rr(1.2, 3.2), rs() * 1.4, rr(1.8, 4), rr(0.03, 0.055), 6.5, rr(2.4, 3.4), rr(0.4, 0.9));
        if (rnd() < dt * 2.2) glow(e.x, e.y + 0.5 * S, e.z, 1.6 * S, 2.2 * S, rr(0.25, 0.45), 1.1 * k, 0.5 * k, 0.12 * k);
        break;
      }
      case E_REENTRY: {
        const c = teamCol(e.team);
        const u0 = e.c < 0 ? Math.max(0, u - dt / e.dur) : e.c; e.c = u;
        if (!e.ent && age < 0.4) e.ent = findFalling(e.x, e.z, e.team);
        let px, py, pz, qx, qy, qz;
        if (e.ent && e.ent.pos && e.ent.pos.y > e.y + 0.5) {
          const q = e.ent, hh = (q.height || 8) * 0.25;
          qx = q.pos.x; qy = q.pos.y + hh; qz = q.pos.z;
          if (e.b === 0) { px = qx; py = qy + 1; pz = qz; } else { px = e.vx; py = e.vy; pz = e.vz; }
          e.vx = qx; e.vy = qy; e.vz = qz; e.b = 1;
          if (py - qy > 40) py = qy + 40;
        } else {
          if (e.b === 1) break;               // the real rig has landed: the streak is over
          reentryPos(e, u0); px = _d.x; py = _d.y; pz = _d.z;
          reentryPos(e, u); qx = _d.x; qy = _d.y; qz = _d.z;
        }
        const seg = Math.hypot(qx - px, qy - py, qz - pz), vx = (qx - px) / Math.max(dt, 1e-3), vy = (qy - py) / Math.max(dt, 1e-3), vz = (qz - pz) / Math.max(dt, 1e-3);
        const dc = camDist(qx, qy, qz), far = clamp(dc / 120, 1, 3.2);     // keep it readable high in the sky
        const heat = 1 - u * 0.55;
        // plasma head: white core in a faction-coloured corona
        glowV(qx, qy, qz, vx, vy, vz, 1.7 * far, 1.1 * far, Math.max(0.06, dt * 2.2), 3 + c[0] * 5, 2.6 + c[1] * 5, 2.2 + c[2] * 5);
        glowV(qx, qy, qz, vx, vy, vz, 7 * far, 5 * far, Math.max(0.09, dt * 3), (0.8 * C_FIRE[0] + c[0] * 0.45) * heat, (0.8 * C_FIRE[1] + c[1] * 0.45) * heat, (0.8 * C_FIRE[2] + c[2] * 0.45) * heat);
        // burning wake + smoke contrail, filled in along the frame's travel
        const steps = clamp(Math.ceil(seg / (1.3 * far)), 1, 14);
        for (let s = 0; s < steps; s++) {
          const f = (s + rnd()) / steps, sx = px + (qx - px) * f, sy = py + (qy - py) * f, sz = pz + (qz - pz) * f;
          flame(sx + rs() * 0.5, sy + rs() * 0.5, sz + rs() * 0.5, vx * 0.12 + rs() * 2, vy * 0.12 + rs() * 2, vz * 0.12 + rs() * 2, rr(0.3, 0.75), rr(1.4, 2.2) * far * 0.8, 0.4 * far, C_FIRE[0] * 5 * heat + c[0], C_FIRE[1] * 5 * heat + c[1], C_FIRE[2] * 5 * heat + c[2], 1.5, 0, 0.4);
          if ((s & 1) === 0) { const g = rr(0.3, 0.46); puff(sx + rs(), sy + rs(), sz + rs(), vx * 0.04 + rs() * 1.5, vy * 0.04, vz * 0.04 + rs() * 1.5, rr(4, 7.5), rr(0.9, 1.4) * far * 0.8, rr(3, 4.6) * far * 0.8, g, g * 0.97, g * 0.94, rr(0.4, 0.58), 0.8, -0.2, 0.8); }
          if (rnd() < 0.5) { rdir(0); spark(sx, sy, sz, vx * 0.5 + _d.x * 14, vy * 0.5 + _d.y * 14, vz * 0.5 + _d.z * 14, rr(0.4, 1.1), 0.09 * far, 9, 5.5, 2.2, 0.6, 9.8, 0.03, NOFLOOR); }
        }
        // growing glow + retro wash on the ground just before touchdown
        const rem = e.dur - age;
        if (rem < 1.0) {
          const k = 1 - rem;
          if (rnd() < dt * 30) glow(e.x, e.y + 0.6, e.z, (2 + 5 * k), (3 + 7 * k), 0.12, (1 + c[0] * 2) * k * 1.3, (1 + c[1] * 2) * k * 1.3, (1 + c[2] * 2) * k * 1.3);
          e.acc += dt * 40 * k * lod(e.x, e.y, e.z);
          while (e.acc >= 1) { e.acc -= 1; const a = rnd() * TAU, sp = rr(5, 13) * k; puff(e.x + Math.cos(a) * 1.5, e.y + 0.4, e.z + Math.sin(a) * 1.5, Math.cos(a) * sp, rr(0.2, 1), Math.sin(a) * sp, rr(1.5, 2.6), 0.6, rr(1.8, 2.8), DUST[0], DUST[1], DUST[2], 0.3, 1.8, -0.1, 0.3); }
          flash(e.x, e.y + 4, e.z, c, 1 + 3 * k, 30, 0.1);
        }
        break;
      }
      case E_COLLAPSE: {
        const L = lod(e.x, e.y, e.z), R = S;
        // dust shed by the falling mass
        let n = take(BK.collapse, roundP(dt * 26 * L * (1 - u * 0.5)));
        for (let j = 0; j < n; j++) {
          const a = rnd() * TAU, o = rr(0.3, 1.0) * R, h = rnd() * e.a * (1 - u * 0.7), k = rr(0.85, 1.1);
          puff(e.x + Math.cos(a) * o, e.y + h + 1, e.z + Math.sin(a) * o, Math.cos(a) * rr(1, 4), -rr(0, 4), Math.sin(a) * rr(1, 4), rr(3, 6), rr(0.9, 1.6), rr(3, 5), DUST[0] * k, DUST[1] * k, DUST[2] * k, rr(0.34, 0.52), 1.1, 0.5, 0.6);
        }
        // the surge along the street once it starts hitting the ground
        const surge = clamp((u - 0.3) / 0.25, 0, 1) * (1 - clamp((u - 0.8) / 0.2, 0, 1));
        n = take(BK.collapse, roundP(dt * 70 * L * surge * (0.5 + R / 10)));
        for (let j = 0; j < n; j++) {
          const w = pickDir(e), sp = rr(7, 17) * (0.55 + 0.45 * w) * (0.7 + R / 16), k = rr(0.84, 1.1), sz = rr(1.3, 2.2) * (0.7 + R / 14);
          puff(e.x + _d.x * R * rr(0.5, 1.1) + rs() * 2, e.y + sz * rr(0.5, 1.1), e.z + _d.z * R * rr(0.5, 1.1) + rs() * 2, _d.x * sp + rs() * 1.5, rr(0.2, 2.2), _d.z * sp + rs() * 1.5,
            rr(7, 13), sz, sz * rr(2.6, 3.8), DUST[0] * k, DUST[1] * k, DUST[2] * k, rr(0.4, 0.58), rr(0.75, 1.2), -rr(0.05, 0.25), sz * 0.5);
        }
        break;
      }
      case E_HAZE: {
        const L = lod(e.x, e.y, e.z);
        const n = take(BK.collapse, roundP(dt * 22 * L * (1 - u)));
        for (let j = 0; j < n; j++) {
          pickDir(e); const sp = rr(1, 5), k = rr(0.85, 1.1), o = rnd() * S;
          puff(e.x + _d.x * o + rs() * 3, e.y + rr(1, 5), e.z + _d.z * o + rs() * 3, _d.x * sp, rr(0.3, 1.6), _d.z * sp, rr(9, 15), rr(2.2, 3.4), rr(6, 9), DUST[0] * k, DUST[1] * k, DUST[2] * k, rr(0.26, 0.4), 0.6, -0.12, 1.2);
        }
        break;
      }
      case E_TRAILUP: {
        if (e.ent && e.ent.pos) { e.x = e.ent.pos.x; e.y = e.ent.pos.y; e.z = e.ent.pos.z; }
        else { e.y += e.vy * dt; e.vy = Math.max(0, e.vy - 20 * dt); }
        const L = lod(e.x, e.y, e.z), k = 1 - u;
        e.acc += dt * 60 * L * k;
        while (e.acc >= 1) {
          e.acc -= 1;
          flame(e.x + rs() * 0.15, e.y - rnd() * 0.5, e.z + rs() * 0.15, rs(), -rr(4, 9), rs(), rr(0.12, 0.25), 0.3, 0.08, 9, 6, 2.6, 3, 0, 0);
          if (rnd() < 0.5) puff(e.x + rs() * 0.2, e.y - 0.4, e.z + rs() * 0.2, rs() * 0.8, -rr(1, 3), rs() * 0.8, rr(1.6, 3), 0.25, rr(0.9, 1.5), 0.62, 0.6, 0.58, 0.36, 1.8, -0.2, 0.3);
        }
        if (rnd() < dt * 40) glow(e.x, e.y - 0.3, e.z, 0.9, 1.5, 0.07, 8 * k, 5.5 * k, 2.6 * k);
        break;
      }
      case E_TORCH: {
        const k = Math.min(1, age * 4) * Math.min(1, (1 - u) * e.dur * 1.5);
        torchTick(e.x, e.y, e.z, e.vx, e.vy, e.vz, S * (0.35 + 0.65 * k), dt);
        break;
      }
      case E_POOL: {
        const k = Math.min(1, age * 2) * Math.min(1, (1 - u) * e.dur * 0.5);
        poolTick(e.x, e.y, e.z, S, k, dt);
        break;
      }
      case E_CHARGE: {
        if (e.ent && e.ent.pos) { e.x = e.ent.pos.x + e.vx; e.y = e.ent.pos.y + e.vy; e.z = e.ent.pos.z + e.vz; }
        // beeps accelerate towards the bang
        const rate = 5 + 14 * u; e.acc += dt * rate;
        if (e.acc >= 1) { e.acc -= 1; glow(e.x, e.y, e.z, 0.5, 1.8 + 1.5 * u, 0.1, 12, 1.6, 0.7); shell(e.x, e.y, e.z, 0.3, 1.6 + 2 * u, 0.16, 3, 0.5, 0.25); flash(e.x, e.y, e.z, [1, 0.2, 0.1], 1.5 + 2 * u, 7, 0.08); }
        break;
      }
      case E_SPARKS: {
        if (e.ent && e.ent.pos) { e.x = e.ent.pos.x + e.vx; e.y = e.ent.pos.y + e.vy; e.z = e.ent.pos.z + e.vz; }
        const L = lod(e.x, e.y, e.z), k = 1 - u;
        e.acc += dt * 70 * k * L * S;
        while (e.acc >= 1) { e.acc -= 1; rdir(0.1); const sp = rr(3, 13); spark(e.x, e.y, e.z, _d.x * sp, _d.y * sp + 1, _d.z * sp, rr(0.3, 0.9), rr(0.035, 0.07), 9, rr(4.5, 6.5), rr(1.4, 3), 1, 9.8, 0.05, NOFLOOR); }
        if (rnd() < dt * 9 * k) { const g = rr(0.05, 0.12); puff(e.x, e.y, e.z, rs(), rr(1, 2.5), rs(), rr(1.6, 3), 0.3, rr(1.2, 1.9), g, g, g, 0.5, 0.9, -1.2, 0.4); }
        if (rnd() < dt * 7 * k) glow(e.x, e.y, e.z, 0.6, 1.8, 0.07, 5, 6, 9);
        break;
      }
      case E_SECOND: {
        // a times over the duration, at offsets up to b metres
        const due = Math.floor(u * e.a) + 1;
        while (e.c < due && e.c < e.a) {
          e.c++;
          const a = rnd() * TAU, o = rr(0.3, 1) * e.b, sx = e.x + Math.cos(a) * o, sz = e.z + Math.sin(a) * o;
          explode(sx, groundY(sx, e.y + 3, sz) + rr(0.5, 3), sz, rr(1.1, 2.0) * S, false);
        }
        break;
      }
    }
  }
}

// ---- damaged machines trail smoke ---------------------------------------------------------------------
function updateDamaged(dt) {
  const L = G.ents.list;
  for (let i = 0; i < L.length; i++) {
    const e = L[i]; if (!e.alive || !e.maxHp) continue;
    const k = e.kind; if (k !== 'mech' && k !== 'emech' && k !== 'tank' && k !== 'gunship') continue;
    const f = e.hp / e.maxHp; if (f > 0.4) continue;
    const sev = 1 - f / 0.4, x = e.pos.x, y = e.pos.y + (e.height || 2) * 0.78, z = e.pos.z;
    if (camDist(x, y, z) > 180) continue;
    const r = (e.radius || 1) * 0.5;
    if (rnd() < dt * (3 + 7 * sev) * load) { const dark = rr(0.05, 0.14); puff(x + rs() * r, y, z + rs() * r, e.vel.x * 0.3 + rs() * 0.5, rr(1, 2.4), e.vel.z * 0.3 + rs() * 0.5, rr(2, 3.6), 0.3, rr(1.1, 1.9), dark, dark, dark, 0.3 + 0.3 * sev, 0.8, -1.2, 0.4); }
    if (sev > 0.5 && rnd() < dt * 5 * sev) { rdir(0.2); spark(x + rs() * r, y - rnd() * 1.5, z + rs() * r, _d.x * 5, _d.y * 5 + 1, _d.z * 5, rr(0.3, 0.8), 0.04, 9, 5.5, 2, 1, 9.8, 0.05, NOFLOOR); }
    if (sev > 0.7 && rnd() < dt * 8) flame(x + rs() * r, y - 0.3, z + rs() * r, rs() * 0.5, rr(1.5, 3), rs() * 0.5, rr(0.25, 0.5), 0.35, 0.1, 4.5, 2.2, 0.6, 1.2, -2, 0.2);
  }
}

// ============================================================================
// BUS HANDLERS
// ============================================================================
const pendingMech = []; for (let i = 0; i < 6; i++) pendingMech.push({ on: false, x: 0, y: 0, z: 0, r: 0, t: 0 });
const handlers = [];
function on(type, fn) { bus.on(type, fn); handlers.push([type, fn]); }

function onExplosion(e) {
  const S = (e.radius || 3) / 3, k = e.kind || 'rocket';
  if (k === 'pulse') { pulseHit(e.x, e.y, e.z, clamp(S * 1.6, 0.6, 2), e.owner ? e.owner.team : 0); return; }
  if (k === 'slam') { if (!recent(TAG_BOOM + 10, e.x, e.y, e.z, 6, 0.3)) { mark(TAG_BOOM + 10, e.x, e.y, e.z); slamFx(e.x, e.y, e.z, (e.radius || 6) * 1.2, e.owner ? e.owner.team : 0); } return; }
  if (k === 'mech') {
    // a rig touching down or blowing up: 'mech:land' / 'mech:selfdestruct' say which, in the same frame.
    if (recent(TAG_LAND, e.x, e.y, e.z, 8, 0.6) || recent(TAG_SD, e.x, e.y, e.z, 10, 1.5)) return;
    for (let i = 0; i < pendingMech.length; i++) { const p = pendingMech[i]; if (!p.on) { p.on = true; p.x = e.x; p.y = e.y; p.z = e.z; p.r = e.radius || 8; p.t = G.time; return; } }
    return;
  }
  const gy = groundY(e.x, e.y, e.z);
  explode(e.x, e.y, e.z, clamp(S, 0.35, 5), (e.y - gy) > 2.5 * S + 2 && !(G.grid && nearSolid(e.x, e.y, e.z, S * 1.5)));
}
function nearSolid(x, y, z, r) { const g = G.grid; return g.solidAt(x + r, y, z) || g.solidAt(x - r, y, z) || g.solidAt(x, y, z + r) || g.solidAt(x, y, z - r) || g.solidAt(x, y - r, z); }
function resolvePendingMech() {
  for (let i = 0; i < pendingMech.length; i++) {
    const p = pendingMech[i]; if (!p.on || G.time === p.t) continue;
    p.on = false;
    if (recent(TAG_LAND, p.x, p.y, p.z, 8, 0.8) || recent(TAG_SD, p.x, p.y, p.z, 10, 1.6)) continue;
    if (p.r >= 10) selfDestruct(p.x, p.y, p.z, p.r / 12);
    else explode(p.x, p.y, p.z, clamp(p.r / 3, 0.5, 5), false);
  }
}

function onVoxels(e) {
  const count = e.count || 1, d = camDist(e.x, e.y, e.z); if (d > 260) return;
  const L = lod(e.x, e.y, e.z), cls = matClass(e.mat), R = Math.max(0.3, e.radius || 0.5);
  const m = MAT[e.mat];
  if (cls === 'glass' && !(m && m.emissive > 2)) { const n = take(BK.vox, roundP(clamp(count * 0.8, 2, 22) * L)); if (n) glassBurst(e.x, e.y, e.z, R, n, 0, 0, 0); return; }
  if (m && m.emissive > 2) {      // neon / lamps pop electrically in their own colour
    const n = take(BK.vox, roundP(clamp(count, 2, 10) * L)), r = COLOR[e.mat * 3], g = COLOR[e.mat * 3 + 1], b = COLOR[e.mat * 3 + 2];
    for (let i = 0; i < n; i++) { rdir(0.1); const sp = rr(2, 9); spark(e.x + rs() * R, e.y + rs() * R, e.z + rs() * R, _d.x * sp, _d.y * sp + 1, _d.z * sp, rr(0.3, 0.9), 0.045, r * r * 9 + 0.6, g * g * 9 + 0.6, b * b * 9 + 0.6, 1.2, 9.8, 0.05, NOFLOOR); }
    if (n) glow(e.x, e.y, e.z, 0.6, 1.8, 0.1, r * r * 7, g * g * 7, b * b * 7);
    return;
  }
  const c = matDust(e.mat);
  let n = take(BK.vox, roundP(clamp(Math.sqrt(count) * 0.75, 0.6, 12) * L));
  for (let i = 0; i < n; i++) {
    rdir(0.2);
    const o = rnd() * R, sp = rr(0.6, 2.8) * (1 + R * 0.25), k = rr(0.85, 1.12), sz = clamp(0.25 + R * 0.3, 0.3, 1.6);
    puff(e.x + _d.x * o, e.y + _d.y * o, e.z + _d.z * o, _d.x * sp, _d.y * sp + 0.3, _d.z * sp, rr(2, 4.4), sz * rr(0.7, 1), sz * rr(2.2, 3.4), c[0] * k, c[1] * k, c[2] * k, rr(0.34, 0.52), rr(1.6, 2.4), -0.05, 0.3);
  }
  if (cls === 'metal' && count > 2) { n = take(BK.vox, roundP(clamp(count * 0.5, 2, 10) * L)); for (let i = 0; i < n; i++) { rdir(0.15); const sp = rr(4, 13); spark(e.x, e.y, e.z, _d.x * sp, _d.y * sp + 1, _d.z * sp, rr(0.3, 0.9), 0.04, 9, 5.6, 2, 1, 9.8, 0.05, NOFLOOR); } }
}

function onDebrisImpact(e) {
  const d = camDist(e.x, e.y, e.z); if (d > 200) return;
  const L = lod(e.x, e.y, e.z), E = clamp(Math.cbrt(Math.max(0.2, (e.mass || 1))) * clamp((e.speed || 4) / 8, 0.4, 2), 0.3, 3.2);
  const cls = matClass(e.mat), c = matDust(e.mat);
  let n = take(BK.debris, roundP(clamp(1.6 * E, 0.6, 6) * L));
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, sp = rr(0.8, 3) * E, k = rr(0.86, 1.1);
    puff(e.x, e.y + 0.15, e.z, Math.cos(a) * sp, rr(0.3, 1.4) * E, Math.sin(a) * sp, rr(1.4, 3.2), 0.22 * E + 0.1, rr(0.8, 1.3) * E + 0.3, c[0] * k, c[1] * k, c[2] * k, rr(0.3, 0.46), 2.2, -0.05, 0.2);
  }
  if (cls === 'metal' && (e.speed || 0) > 5) { n = take(BK.debris, roundP(3 * L)); for (let i = 0; i < n; i++) { rdir(0.3); const sp = rr(3, 9); spark(e.x, e.y + 0.1, e.z, _d.x * sp, _d.y * sp, _d.z * sp, rr(0.2, 0.6), 0.035, 9, 5.6, 2, 1, 9.8, 0.05, NOFLOOR); } }
  else if (cls === 'glass') { n = take(BK.debris, 3); if (n) glassBurst(e.x, e.y + 0.1, e.z, 0.3, n, 0, 0, 0); }
}

function onShot(e) {
  if (take(BK.muzzle, 1) < 1) return;
  const w = e.weapon, cls = weaponClass(w), team = weaponTeam(w, e.team, e.shooter);
  let S = 1;
  const dx = e.dx || 0, dy = e.dy || 0, dz = e.dz || 0;
  if (cls === 'beam') { const c = C_LANCE; glow(e.x, e.y, e.z, 1.2, 3, 0.16, c[0] * 8, c[1] * 8, c[2] * 8); flash(e.x, e.y, e.z, c, 2.5, 10, 0.12); return; }
  if (cls === 'split') { bombletSplit(e.x, e.y, e.z, dx, dy, dz); return; }
  if (cls === 'mortar') { mortarThump(e.x, e.y, e.z, dx, dy, dz); return; }
  if (cls === 'shell' && w === 'siege') { muzzle(e.x, e.y, e.z, dx, dy, dz || 1, 1.5, 'shell', team); siegeBlast(e.x, e.y, e.z, dx, dy, dz, 1); return; }
  if (cls === 'bullet') S = /chain/.test(w) ? 1.9 : w === 'autocannon' ? 1.6 : 0.85;
  else if (cls === 'pulse') S = 1.25;
  else if (cls === 'heavy') S = /salvo|gsrocket|skylance/.test(w) ? 0.8 : 0.9;
  muzzle(e.x, e.y, e.z, e.dx || 0, e.dy || 0, e.dz || 1, S, cls, team);
}
function onTracer(e) {
  const cls = weaponClass(e.weapon), team = weaponTeam(e.weapon, e.team, null);
  if (cls === 'bullet') API.beam(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1, team === 1 ? 'tracer_enemy' : 'tracer');
  else if (cls === 'pulse') API.beam(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1, team === 1 ? 'pulse_enemy' : 'pulse');
}
function onImpact(e) {
  const cls = weaponClass(e.weapon);
  const nx = e.nx || 0, ny = e.ny || 0, nz = e.nz || 0;
  if (cls === 'pulse') { pulseHit(e.x, e.y, e.z, 1, weaponTeam(e.weapon, e.team, null), nx, ny, nz); return; }
  if (cls === 'beam') { lanceHit(e.x, e.y, e.z, nx, ny, nz, e.ent); return; }
  if (cls !== 'bullet') return;                         // the explosion event carries the rest
  bulletImpact(e.x, e.y, e.z, nx, (nx || ny || nz) ? ny : 1, nz, e.mat, e.power, e.ent ? e.ent.kind : null);
}

function onDeath(d) {
  const e = d.ent; if (!e || !e.pos) return;
  const x = e.pos.x, y = e.pos.y + (e.height || 1) * 0.5, z = e.pos.z, k = e.kind;
  if (camDist(x, y, z) > 320) return;
  if (k === 'soldier' || k === 'pilot') {
    const L = lod(x, y, z), c = teamCol(e.team);
    let n = roundP(8 * L);
    for (let i = 0; i < n; i++) { rdir(0.3); const sp = rr(2, 8); spark(x, y, z, _d.x * sp, _d.y * sp + 2, _d.z * sp, rr(0.3, 0.8), 0.04, c[0] * 6 + 2, c[1] * 6 + 1.4, c[2] * 6 + 0.8, 1.5, 9.8, 0.05, NOFLOOR); }
    glow(x, y, z, 0.5, 1.6, 0.12, c[0] * 5 + 1, c[1] * 5 + 1, c[2] * 5 + 1);
    n = roundP(3 * L);
    for (let i = 0; i < n; i++) { rdir(0.3); puff(x, y, z, _d.x * 1.5, _d.y * 1.5 + 0.5, _d.z * 1.5, rr(0.9, 1.6), 0.25, rr(0.8, 1.2), 0.4, 0.38, 0.36, 0.34, 2.2, -0.3, 0.2); }
  } else if (k === 'drone') {
    explode(x, y, z, 0.6, true);
    sparksBurst(x, y, z, 1.5, 0, 0, 0, C_FIRE);
  } else if (k === 'tank') {
    explode(x, e.pos.y + 1.2, z, 1.7, false);
    emitter(E_FIRE, x, e.pos.y + 1.6, z, rr(16, 26), 1.5);
    const c = emitter(E_COLUMN, x, e.pos.y + 2, z, 22, 1.7); c.a = 1;
  } else if (k === 'gunship') {
    explode(x, y, z, 2.2, true);
    sparksBurst(x, y, z, 3, 0, 0, 0, C_FIRE);
    const gy = groundY(x, y, z); const c = emitter(E_COLUMN, x, gy + 0.5, z, 14, 1.6); c.a = 1; c.t0 = G.time + 0;   // wreck burns where it comes down
  } else if (k === 'emech') {
    const big = (e.height || 8.5) > 9.5 ? 1.25 : 1;
    explode(x, y, z, 2.6 * big, false);
    const s = emitter(E_SECOND, x, y, z, 1.1, 0.6 * big); s.a = 4; s.b = 3.5;
    emitter(E_FIRE, x, groundY(x, y, z) + 0.2, z, rr(18, 28), 1.6);
    const c = emitter(E_COLUMN, x, e.pos.y + 3, z, 24, 2.2 * big); c.a = 1;
    // the faction-coloured reactor pop
    glow(x, y, z, 4, 16, 0.22, 16, 6, 2.5);
    shell(x, y, z, 2, 18, 0.35, 2.4, 0.9, 0.4);
  } else if (k === 'turret' || k === 'prop') {
    explode(x, y, z, 0.9, false);
  }
}

// ============================================================================
// PHASE B: fire, gas, shields, lance, siege, mortar, grapple, brawling
// ============================================================================
const C_LANCE = [0.55, 0.8, 1.0];

// one frame of a roaring gas torch at (x,y,z) along unit d
function torchTick(x, y, z, dx, dy, dz, S, dt) {
  const dc = camDist(x, y, z); if (dc > 260) return;
  const L = lod(x, y, z);
  let n = take(BK.emit, roundP(dt * 120 * L));
  for (let i = 0; i < n; i++) {
    const sp = rr(13, 24) * (0.6 + 0.4 * S), f = rnd(), blue = rnd() < 0.3;
    // blue-white at the root, orange body
    if (blue) flame(x + dx * f * 0.6, y + dy * f * 0.6, z + dz * f * 0.6, dx * sp * 1.2 + rs() * 0.8, dy * sp * 1.2 + rs() * 0.8, dz * sp * 1.2 + rs() * 0.8, rr(0.08, 0.16), 0.3 * S, 0.1 * S, 3, 5, 9, 2, 0, 0);
    else flame(x + dx * f + rs() * 0.12 * S, y + dy * f, z + dz * f + rs() * 0.12 * S, dx * sp + rs() * 1.6, dy * sp + rs() * 1.6, dz * sp + rs() * 1.6, rr(0.28, 0.6), rr(0.4, 0.65) * S, rr(1.0, 1.6) * S, C_FIRE[0] * 5.5, C_FIRE[1] * 5.5, C_FIRE[2] * 5.5, 1.9, -3, 0.3 * S);
  }
  if (rnd() < dt * 26) glow(x + dx * 2 * S, y + dy * 2 * S, z + dz * 2 * S, 3 * S, 4.5 * S, 0.1, 3.4, 1.7, 0.45);
  if (rnd() < dt * 9 * L) { const g = rr(0.05, 0.11), o = rr(5, 8) * S; puff(x + dx * o + rs(), y + dy * o + rs(), z + dz * o + rs(), dx * 3 + rs(), dy * 3 + 1.5, dz * 3 + rs(), rr(3, 5.5), 0.8 * S, rr(2.2, 3.4) * S, g, g, g, 0.55, 0.7, -1.4, 0.6); }
  if (rnd() < dt * 24 * L) { const sp = rr(8, 20); spark(x, y, z, dx * sp + rs() * 4, dy * sp + rs() * 4, dz * sp + rs() * 4, rr(0.4, 1.2), 0.05, 9, 5.5, 2, 0.7, 9.8, 0.05, NOFLOOR); }
  if (rnd() < dt * 7) flash(x + dx * 2, y + dy * 2, z + dz * 2, C_FIRE, 2.6 * S, 16 * S, 0.16);
}
function gasJet(x, y, z, dx, dy, dz, dur, S) {
  const l = Math.hypot(dx, dy, dz) || 1;
  const e = emitter(E_TORCH, x, y, z, dur, S); e.vx = dx / l; e.vy = dy / l; e.vz = dz / l;
  glow(x, y, z, 2 * S, 7 * S, 0.2, 10, 6, 2.5); flash(x, y + 1, z, C_HOT, 4, 18, 0.25);
}
// one frame of a burning pool of radius R on the ground at y
function poolTick(x, y, z, R, k, dt) {
  const dc = camDist(x, y, z); if (dc > 240) return;
  const L = lod(x, y, z), area = Math.min(60, R * R); if (dc < 0) return;
  let n = take(BK.emit, roundP(dt * (14 + 7 * area) * L * k));
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, o = Math.sqrt(rnd()) * R, edge = o / R, h = rr(0.55, 1) * (1.15 - 0.5 * edge);
    lick(x + Math.cos(a) * o, y + rr(0.05, 0.3), z + Math.sin(a) * o, rs() * 0.5, rr(1.8, 4.2) * h, rs() * 0.5, rr(0.4, 0.85), rr(0.45, 0.8) * h, 0.12, C_FIRE[0] * 2.5 * h, C_FIRE[1] * 2.5 * h, C_FIRE[2] * 2.5 * h, 1.1, -2.8, 0.3);
  }
  if (rnd() < dt * (3 + area * 0.5) * L * k) { const a = rnd() * TAU, o = Math.sqrt(rnd()) * R * 0.7, g = rr(0.04, 0.1); puff(x + Math.cos(a) * o, y + rr(1, 2.2), z + Math.sin(a) * o, rs() * 0.5, rr(1.8, 3.2), rs() * 0.5, rr(4, 7), rr(0.7, 1.1), rr(2.4, 3.8), g, g, g, rr(0.5, 0.7), 0.55, -1.5, 0.7); }
  if (rnd() < dt * (2 + area * 0.4) * L * k) { const a = rnd() * TAU, o = Math.sqrt(rnd()) * R; ember(x + Math.cos(a) * o, y + rr(0.3, 1.5), z + Math.sin(a) * o, rs() * 1.5, rr(1.5, 3.5), rs() * 1.5, rr(2, 4.5), rr(0.035, 0.06), 6.5, rr(2.4, 3.4), rr(0.4, 0.9)); }
  if (rnd() < dt * 5 * k) glow(x + rs() * R * 0.4, y + 0.6, z + rs() * R * 0.4, R * 1.1, R * 1.5, rr(0.25, 0.45), 1.3, 0.6, 0.14);
  if (rnd() < dt * 4 * k) flash(x, y + 1.2, z, C_FIRE, 1.6 + R * 0.25, 8 + R * 2.5, 0.3);
}
function firePool(x, y, z, R, dur) {
  emitter(E_POOL, x, groundY(x, y + 1, z) + 0.05, z, dur, R);
}

// Flames and smoke for DESTRUCT's burning cells (G.destruct.fires = {count, x[], y[], z[], heat[]}, world metres).
let fireAcc = 0, fireLight = 0;
function updateFires(dt) {
  const F = G.destruct && G.destruct.fires; if (!F || !(F.count > 0) || !F.x) return;
  const n = F.count, cam = G.camera.position;
  // a fixed flame budget shared by all cells, so 400 burning voxels cost what 60 do
  fireAcc += dt * Math.min(260, 16 + n * 7) * load;
  let m = Math.min(40, Math.floor(fireAcc)); fireAcc -= m;
  for (let i = 0; i < m; i++) {
    const c = (rnd() * n) | 0, x = F.x[c], y = F.y[c], z = F.z[c];
    const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 200 * 200 || (d2 > 70 * 70 && rnd() < 0.6)) continue;
    const h = F.heat ? clamp(F.heat[c], 0.25, 1.5) : 1, r = rnd();
    lick(x + rs() * 0.3, y + rs() * 0.2, z + rs() * 0.3, rs() * 0.5, rr(1.4, 3.4) * h, rs() * 0.5, rr(0.35, 0.8), rr(0.4, 0.7) * (0.6 + 0.4 * h), 0.1, C_FIRE[0] * 2.6 * (0.6 + 0.4 * r), C_FIRE[1] * 2.6 * (0.6 + 0.4 * r), C_FIRE[2] * 2.6 * (0.6 + 0.4 * r), 1.1, -2.6, 0.25);
    if (r < 0.1) { const g = rr(0.05, 0.13); puff(x + rs() * 0.3, y + rr(0.6, 1.4), z + rs() * 0.3, rs() * 0.4, rr(1.4, 2.6), rs() * 0.4, rr(3.5, 6.5), rr(0.4, 0.7), rr(1.8, 3.0), g, g, g, rr(0.42, 0.62), 0.55, -1.3, 0.6); }
    else if (r < 0.17) ember(x + rs() * 0.4, y + rr(0.2, 1), z + rs() * 0.4, rs() * 1.5, rr(1.2, 3.2), rs() * 1.5, rr(2, 4.5), rr(0.03, 0.055), 6.5, rr(2.4, 3.4), rr(0.4, 0.9));
    else if (r < 0.2) glow(x, y + 0.4, z, 1.4, 2.2, rr(0.25, 0.45), 0.9 * h, 0.42 * h, 0.1 * h);
  }
  // one flickering light for the nearest part of the blaze
  fireLight -= dt;
  if (fireLight <= 0) {
    fireLight = rr(0.12, 0.22);
    let best = -1, bd = 1e12;
    for (let i = 0; i < 6; i++) { const c = (rnd() * n) | 0, dx = F.x[c] - cam.x, dy = F.y[c] - cam.y, dz = F.z[c] - cam.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 < bd) { bd = d2; best = c; } }
    if (best >= 0 && bd < 90 * 90) flash(F.x[best], F.y[best] + 1, F.z[best], C_FIRE, 3.2 + Math.min(3, n * 0.02), 14, 0.3);
  }
}

function shieldHit(ent, x, y, z, amount, teamOpt) {
  if (recent(TAG_SHIELD, x, y, z, 1.5, 0.07)) return;
  mark(TAG_SHIELD, x, y, z);
  const team = ent && ent.team != null ? ent.team : (teamOpt || 0), c = teamCol(team), K = clamp(amount / 40, 0.5, 2.2), L = lod(x, y, z);
  // ripples running out across the disc + a hot point of contact
  shell(x, y, z, 0.3 * K, 1.8 * K, 0.3, c[0] * 4 + 0.5, c[1] * 4 + 0.5, c[2] * 4 + 0.5);
  shell(x, y, z, 0.2 * K, 3.0 * K, 0.5, c[0] * 2.4, c[1] * 2.4, c[2] * 2.4);
  shell(x, y, z, 0.1, 1.5 * K, 0.18, 3, 3, 3);
  glow(x, y, z, 0.6 * K, 1.7 * K, 0.12, c[0] * 7 + 2, c[1] * 7 + 2, c[2] * 7 + 2);
  glow(x, y, z, 2.4 * K, 1.8 * K, 0.3, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
  flash(x, y, z, c, 2.4 * K, 10, 0.14);
  const n = roundP(9 * K * L);
  // deflected energy skates off sideways from the shield face
  let fx = 0, fz = 1; if (ent && ent.shield && ent.shield.yaw != null) { fx = Math.sin(ent.shield.yaw); fz = Math.cos(ent.shield.yaw); }
  for (let i = 0; i < n; i++) {
    rdir(0); const dot = _d.x * fx + _d.z * fz; _d.x -= fx * dot * 0.8; _d.z -= fz * dot * 0.8;
    const sp = rr(5, 16);
    spark(x, y, z, _d.x * sp + fx * 3, _d.y * sp, _d.z * sp + fz * 3, rr(0.2, 0.55), rr(0.035, 0.06), c[0] * 8 + 1.5, c[1] * 8 + 1.5, c[2] * 8 + 1.5, 2.5, 3, 0.05, NOFLOOR);
  }
}
function shieldBreak(ent) {
  const p = ent.pos, y = p.y + (ent.height || 8) * 0.6, c = teamCol(ent.team), L = lod(p.x, y, p.z);
  let fx = 0, fz = 1; if (ent.shield && ent.shield.yaw != null) { fx = Math.sin(ent.shield.yaw); fz = Math.cos(ent.shield.yaw); }
  const x = p.x + fx * ((ent.radius || 1.8) + 1), z = p.z + fz * ((ent.radius || 1.8) + 1);
  glow(x, y, z, 2, 5.5, 0.18, c[0] * 6 + 1.5, c[1] * 6 + 1.5, c[2] * 6 + 1.5);
  shell(x, y, z, 1, 7, 0.4, c[0] * 3, c[1] * 3, c[2] * 3);
  flash(x, y, z, c, 5, 18, 0.2);
  const n = roundP(40 * L);
  for (let i = 0; i < n; i++) { rdir(0); const sp = rr(3, 12); glint(x + rs() * 1.5, y + rs() * 2, z + rs() * 1.5, _d.x * sp + fx * 4, _d.y * sp + 2, _d.z * sp + fz * 4, rr(0.6, 1.4), rr(0.04, 0.08), c[0] * 6 + 1, c[1] * 6 + 1, c[2] * 6 + 1, NOFLOOR); }
}

function lanceBeam(x0, y0, z0, x1, y1, z1) {
  const c = C_LANCE;
  // COMBAT draws the steady beam; this is the crackle on top of it: a hot core flash + a wider halo
  beamW(x0, y0, z0, x1, y1, z1, 0.12, c[0] * 3.5 + 0.8, c[1] * 3.5 + 0.8, c[2] * 3.5 + 0.8, 0.06, 3, 0);
  beamW(x0, y0, z0, x1, y1, z1, 0.2, c[0] * 0.45, c[1] * 0.45, c[2] * 0.55, 0.3, 3, 0);
  lanceHit(x1, y1, z1, 0, 0, 0, null);
}
function lanceHit(x, y, z, nx, ny, nz, ent) {
  if (recent(TAG_LANCE, x, y, z, 1.2, 0.06)) return;
  mark(TAG_LANCE, x, y, z);
  const c = C_LANCE, L = lod(x, y, z), gy = groundY(x, y, z) + 0.03;
  glow(x, y, z, 0.6, 1.6, 0.12, c[0] * 5 + 3, c[1] * 5 + 2.4, c[2] * 5 + 1.8);
  glow(x, y, z, 2.0, 1.6, 0.25, 1.3, 0.6, 0.18);
  flash(x + nx * 0.4, y + ny * 0.4, z + nz * 0.4, [1, 0.75, 0.5], 2.6, 9, 0.14);
  // molten metal / slag: heavy, bright, bounces to rest and cools on the ground
  let n = roundP(9 * L);
  for (let i = 0; i < n; i++) {
    rdir(0); if (_d.x * nx + _d.y * ny + _d.z * nz < 0) { _d.x = -_d.x; _d.y = -_d.y; _d.z = -_d.z; }
    const sp = rr(2.5, 10);
    spark(x, y, z, _d.x * sp + nx * 3, _d.y * sp + ny * 3 + 2.2, _d.z * sp + nz * 3, rr(0.6, 1.7), rr(0.05, 0.1), 10, rr(5, 7.5), rr(1.2, 2.6), 0.5, 9.8, 0.045, gy);
  }
  if (rnd() < 0.6 * L) { const g = ent ? 0.12 : 0.3; puff(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2, nx * 1.5 + rs() * 0.5, ny * 1.5 + rr(0.8, 1.8), nz * 1.5 + rs() * 0.5, rr(1.2, 2.2), 0.2, rr(0.8, 1.3), g, g, g, 0.4, 1.4, -1.2, 0.3); }
  if (rnd() < 0.5) flame(x, y, z, nx * 2 + rs(), ny * 2 + 1.5, nz * 2 + rs(), rr(0.15, 0.3), 0.35, 0.1, 7, 4, 1.4, 2, -2, 0);
}

function siegeBlast(x, y, z, dx, dy, dz, strength) {
  if (recent(TAG_SIEGE, x, y, z, 4, 0.2)) return;
  mark(TAG_SIEGE, x, y, z);
  const L = lod(x, y, z), K = clamp(strength || 1, 0.5, 1.5), gy = groundY(x, y, z);
  // pressure wave off the muzzle and a long tongue of flame down the line of fire
  shell(x + dx * 1.5, y + dy * 1.5, z + dz * 1.5, 1.2, 7 * K, 0.22, 0.9, 0.7, 0.5);
  glow(x + dx * 2, y + dy * 2, z + dz * 2, 2.5 * K, 6.5 * K, 0.13, 9, 6, 2.8);
  flash(x + dx * 2, y + dy * 2, z + dz * 2, C_HOT, 7 * K, 34, 0.2);
  let n = roundP(9 * L);
  for (let i = 0; i < n; i++) { const f = (i + rnd()) / n, sp = rr(22, 46) * (1 - f * 0.5); flame(x + dx * f * 2, y + dy * f * 2, z + dz * f * 2, dx * sp + rs() * 2.5, dy * sp + rs() * 2.5, dz * sp + rs() * 2.5, rr(0.14, 0.34), 0.7 * K, rr(1.4, 2.4) * K, 9, 5.4, 1.8, 4.5, 0, 0); }
  // side vents (muzzle brake): two jets square to the barrel
  const sx = -dz, sz = dx, sl = Math.hypot(sx, sz) || 1;
  for (let s = -1; s <= 1; s += 2) for (let i = 0; i < 4; i++) { const sp = rr(9, 20) * s; flame(x, y, z, sx / sl * sp + dx * 3, rs() * 1.5, sz / sl * sp + dz * 3, rr(0.12, 0.26), 0.5 * K, rr(1.0, 1.7) * K, 8, 4.6, 1.5, 4, 0, 0); puff(x, y, z, sx / sl * sp * 0.6 + dx * 2, rr(0, 1.5), sz / sl * sp * 0.6 + dz * 2, rr(1.4, 2.6), 0.5 * K, rr(1.8, 2.8) * K, 0.52, 0.5, 0.48, 0.36, 2.2, -0.4, 0.3); }
  n = roundP(18 * L);
  for (let i = 0; i < n; i++) { rdir(0); const sp = rr(18, 50); spark(x, y, z, dx * sp + _d.x * 7, dy * sp + _d.y * 7, dz * sp + _d.z * 7, rr(0.25, 0.7), 0.06, 9, 5.5, 2, 1.2, 9.8, 0.05, NOFLOOR); }
  // the street answers: dust jumps off the ground under and ahead of the gun
  if (y - gy < 12) {
    ring(x, gy + 0.12, z, 2, 15 * K, 0.6, DUST[0], DUST[1], DUST[2], 0.3, 0, 0, 0);
    dustWall(x + dx * 3, gy, z + dz * 3, roundP(18 * L), 1.5, 11 * K, 0.9, 3.2, 0.4);
    n = roundP(8 * L);
    for (let i = 0; i < n; i++) { const f = rr(2, 16); puff(x + dx * f + rs() * 1.5, gy + 0.4, z + dz * f + rs() * 1.5, dx * rr(2, 7) + rs(), rr(0.6, 2.4), dz * rr(2, 7) + rs(), rr(2, 3.8), 0.7, rr(1.9, 2.9), DUST[0], DUST[1], DUST[2], 0.36, 1.6, -0.1, 0.4); }
  }
}
function mortarThump(x, y, z, dx, dy, dz) {
  const L = lod(x, y, z);
  glow(x + dx, y + dy, z + dz, 1.4, 3.6, 0.1, 10, 6.5, 3);
  flash(x + dx, y + dy, z + dz, C_HOT, 3, 12, 0.12);
  shell(x + dx * 0.6, y + dy * 0.6, z + dz * 0.6, 0.5, 3.4, 0.2, 1.4, 1.1, 0.8);
  let n = roundP(5 * L) + 1;
  for (let i = 0; i < n; i++) { const sp = rr(8, 20); flame(x, y, z, dx * sp + rs() * 2, dy * sp + rs() * 2, dz * sp + rs() * 2, rr(0.1, 0.24), 0.4, rr(0.8, 1.3), 8, 4.8, 1.6, 4.5, 0, 0); }
  n = roundP(9 * L);
  // a fat smoke ring rolling off the tube mouth
  for (let i = 0; i < n; i++) { rdir(0); const dot = _d.x * dx + _d.y * dy + _d.z * dz; _d.x -= dx * dot; _d.y -= dy * dot; _d.z -= dz * dot; const sp = rr(2, 4.5); puff(x + dx * 0.5, y + dy * 0.5, z + dz * 0.5, _d.x * sp + dx * 3.5, _d.y * sp + dy * 3.5, _d.z * sp + dz * 3.5, rr(1.5, 2.8), 0.35, rr(1.3, 2.0), 0.58, 0.56, 0.53, 0.4, 2, -0.4, 0.3); }
}
function bombletSplit(x, y, z, dx, dy, dz) {
  const L = lod(x, y, z);
  glow(x, y, z, 1.5, 4.5, 0.12, 12, 8.5, 4.2);
  shell(x, y, z, 0.6, 5.5, 0.24, 2, 1.5, 1.0);
  flash(x, y, z, C_HOT, 3, 16, 0.14);
  let n = roundP(7 * L);
  for (let i = 0; i < n; i++) { rdir(0); const sp = rr(2, 5), g = rr(0.3, 0.45); puff(x, y, z, _d.x * sp + dx * 3, _d.y * sp + dy * 3, _d.z * sp + dz * 3, rr(1.6, 3), 0.5, rr(1.6, 2.4), g, g, g, 0.5, 1.6, -0.2, 0.4); }
  n = roundP(16 * L);
  for (let i = 0; i < n; i++) { rdir(0); const sp = rr(6, 18); spark(x, y, z, _d.x * sp + dx * 8, _d.y * sp + dy * 8, _d.z * sp + dz * 8, rr(0.3, 0.8), 0.05, 9, 5.5, 2, 1, 9.8, 0.05, NOFLOOR); }
  // casing halves tumbling away, burning
  for (let i = 0; i < 2; i++) { rdir(0.3); const sp = rr(5, 9); fireball(x, y, z, _d.x * sp, _d.y * sp + 2, _d.z * sp, rr(1.2, 1.8), 0.25, 0.9, 0.5, 5, 2.4, 0.6, 0.25, 0.25, 0.25, 0.5, 0.5, 6, 0.2); }
}

function onGrapple(e) {
  const st = e.state;
  if (st === 'miss' || st === 'release') return;
  if (st === 'clinch') { const t = e.target; if (t && t.pos) { const y = t.pos.y + (t.height || 8) * 0.65; sparksBurst(t.pos.x, y, t.pos.z, 2.5, 0, 0, 0, C_FIRE); shell(t.pos.x, y, t.pos.z, 0.5, 5, 0.22, 1.6, 1.3, 1); flash(t.pos.x, y, t.pos.z, C_HOT, 3, 12, 0.12); } return; }
  if (e.x == null) return;
  // the claw bites: sparks back along the cable, grit off whatever it hit
  const s = e.ent, x = e.x, y = e.y, z = e.z;
  let dx = 0, dy = 0, dz = 0;
  if (s && s.pos) { dx = s.pos.x - x; dy = s.pos.y + (s.height || 8) * 0.6 - y; dz = s.pos.z - z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
  sparksBurst(x, y, z, 2, dx, dy, dz, C_FIRE);
  shell(x, y, z, 0.3, 3, 0.2, 1.6, 1.3, 1.0);
  flash(x, y, z, C_HOT, 2.4, 9, 0.1);
  if (!e.target) dustCloud(x, y, z, 0.9, matDust(G.grid ? G.grid.matAt(x - dx * 0.3, y - dy * 0.3, z - dz * 0.3) : 0), 0.4);
}

const _lp = { x: 0, y: 0, z: 0 };
function limbPos(ent, limb) {       // world point of a rig's shoulder
  const p = ent.pos, yaw = ent.yaw != null ? ent.yaw : (ent.rig && ent.rig.root ? ent.rig.root.rotation.y : ent.model && ent.model.root ? ent.model.root.rotation.y : 0);
  const side = limb === 'armL' ? 1 : -1, r = (ent.radius || 1.8) * 1.05;
  _lp.x = p.x + Math.cos(yaw) * side * r; _lp.y = p.y + (ent.height || 8.5) * 0.72; _lp.z = p.z - Math.sin(yaw) * side * r;
}
function limbTorn(ent, limb, x, y, z) {
  if (ent && ent.pos) { limbPos(ent, limb); x = _lp.x; y = _lp.y; z = _lp.z; }
  if (x == null) return;
  const L = lod(x, y, z), c = ent ? teamCol(ent.team) : C_VANTA;
  glow(x, y, z, 2, 7, 0.16, 12, 9, 5);
  glow(x, y, z, 4, 3, 0.5, c[0] * 3, c[1] * 3, c[2] * 3);
  shell(x, y, z, 0.6, 7, 0.26, 2, 1.6, 1.2);
  flash(x, y, z, C_HOT, 5, 18, 0.2);
  let n = roundP(46 * L);
  for (let i = 0; i < n; i++) { rdir(0.15); const sp = rr(5, 22); spark(x, y, z, _d.x * sp, _d.y * sp + 3, _d.z * sp, rr(0.4, 1.4), rr(0.045, 0.09), 9, rr(4.5, 6.5), rr(1.2, 2.6), 0.7, 9.8, 0.05, NOFLOOR); }
  // hydraulic fluid: dark spray, then it burns
  n = roundP(8 * L);
  for (let i = 0; i < n; i++) { rdir(0.2); const sp = rr(2, 7); fireball(x, y, z, _d.x * sp, _d.y * sp + 1, _d.z * sp, rr(1.4, 2.6), 0.4, rr(1.4, 2.2), rr(0.15, 0.3), 5, 2.5, 0.65, 0.06, 0.06, 0.06, 0.8, 1.8, -0.8, 0.4); }
  // the stump keeps arcing
  const e = emitter(E_SPARKS, x, y, z, 3.2, 1); e.ent = ent && ent.pos ? ent : null; if (e.ent) { e.vx = x - ent.pos.x; e.vy = y - ent.pos.y; e.vz = z - ent.pos.z; }
}
function onFinisher(e) {
  const o = e.ent;
  if (e.state === 'start') { if (o && o.pos) { const y = o.pos.y + (o.height || 8) * 0.6; sparksBurst(o.pos.x, y, o.pos.z, 3, 0, 1, 0, C_FIRE); flash(o.pos.x, y, o.pos.z, C_HOT, 3, 14, 0.15); const m = emitter(E_SPARKS, o.pos.x, y, o.pos.z, 1.3, 0.8); m.ent = o; m.vx = 0; m.vy = y - o.pos.y; m.vz = 0; } return; }
  if (e.x == null) return;
  // the kill: a column of sparks and fire out of the broken chassis on top of the slam ring
  const L = lod(e.x, e.y, e.z), gy = groundY(e.x, e.y + 1, e.z);
  glow(e.x, gy + 2, e.z, 3, 9, 0.18, 8, 5, 2.5);
  shell(e.x, gy + 2, e.z, 2, 14, 0.4, 1.2, 0.8, 0.5);
  let n = roundP(60 * L);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(2, 9), up = rr(10, 30); spark(e.x, gy + 1, e.z, Math.cos(a) * sp, up, Math.sin(a) * sp, rr(0.7, 1.9), rr(0.05, 0.1), 9, rr(4.5, 6.5), rr(1.2, 2.6), 0.5, 9.8, 0.045, gy + 0.03); }
  n = roundP(10 * L);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, sp = rr(1, 4), d = rr(0.05, 0.12); fireball(e.x + Math.cos(a), gy + 1.5, e.z + Math.sin(a), Math.cos(a) * sp, rr(6, 15), Math.sin(a) * sp, rr(2.4, 4), 1.2, rr(3, 4.4), rr(0.25, 0.4), 6, 3, 0.8, d, d, d, 0.85, 1.3, -2, 0.6); }
}

// ---- Phase C: objectives, perks, boss, victory ---------------------------------------------------
let victoryT = 0, victoryAcc = 0;
// a pillar of light with motes rising in it and a ring running out along the ground
function beacon(x, y, z, c, S) {
  const gy = groundY(x, y + 1, z), L = lod(x, y, z);
  ring(x, gy + 0.15, z, 1 * S, 14 * S, 0.8, 0, 0, 0, 0, c[0] * 2.4, c[1] * 2.4, c[2] * 2.4);
  ring(x, gy + 0.13, z, 0.5 * S, 7 * S, 0.5, 0, 0, 0, 0, c[0] * 3 + 0.6, c[1] * 3 + 0.6, c[2] * 3 + 0.6);
  beamW(x, gy, z, x, gy + 45, z, 1.1, c[0] * 5 + 0.6, c[1] * 5 + 0.6, c[2] * 5 + 0.6, 0.5 * S, 3, 0);
  beamW(x, gy, z, x, gy + 45, z, 1.6, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 2.2 * S, 3, 0);
  glow(x, gy + 1.5, z, 4 * S, 9 * S, 0.5, c[0] * 6 + 1, c[1] * 6 + 1, c[2] * 6 + 1);
  flash(x, gy + 2, z, c, 4, 22, 0.4);
  const n = roundP(34 * L);
  for (let i = 0; i < n; i++) { const a = rnd() * TAU, o = rr(0.3, 2.6) * S; ember(x + Math.cos(a) * o, gy + rr(0.2, 5), z + Math.sin(a) * o, rs() * 0.6, rr(3, 9), rs() * 0.6, rr(1.2, 2.8), rr(0.04, 0.08), c[0] * 7 + 1, c[1] * 7 + 1, c[2] * 7 + 1); }
}
function playerBeacon(c, S) { const e = (G.player && G.player.ent) || G.state.player.ent; if (e && e.pos) beacon(e.pos.x, e.pos.y, e.pos.z, c, S); }
function bossPhase(q, phase) {
  const x = q.pos.x, y = q.pos.y + (q.height || 12) * 0.55, z = q.pos.z, gy = groundY(x, q.pos.y + 1, z), L = lod(x, y, z), K = (q.height || 12) / 10;
  const c = phase >= 3 ? [1.0, 0.16, 0.05] : C_VANTA;
  // the reactor vents: a faction-coloured pressure shell, a ground ring, a burst of sparks and black smoke
  glow(x, y, z, 4 * K, 14 * K, 0.3, c[0] * 8 + 2, c[1] * 8 + 1.4, c[2] * 8 + 0.8);
  shell(x, y, z, 3 * K, 30 * K, 0.6, c[0] * 3, c[1] * 3, c[2] * 3);
  shell(x, y, z, 2 * K, 16 * K, 0.35, 2.4, 1.8, 1.4);
  ring(x, gy + 0.15, z, 3 * K, 34 * K, 0.8, 0, 0, 0, 0, c[0] * 2.6, c[1] * 2.6, c[2] * 2.6);
  ring(x, gy + 0.12, z, 3 * K, 26 * K, 1.5, DUST[0], DUST[1], DUST[2], 0.55, 0, 0, 0);
  dustWall(x, gy, z, roundP(26 * L), 3 * K, 15 * K, 1.4 * K, 5, 0.46);
  flash(x, y, z, c, 9, 60, 0.5);
  let n = roundP(70 * L);
  for (let i = 0; i < n; i++) { rdir(0.2); const sp = rr(8, 34); spark(x, y, z, _d.x * sp, _d.y * sp + 3, _d.z * sp, rr(0.5, 1.6), rr(0.06, 0.12), c[0] * 9 + 1, c[1] * 9 + 2.5, c[2] * 9 + 1, 0.6, 9.8, 0.045, gy + 0.03); }
  n = roundP(14 * L);
  for (let i = 0; i < n; i++) { rdir(0.3); const sp = rr(3, 9), d = rr(0.04, 0.1); fireball(x + _d.x * 2, y + _d.y * 2, z + _d.z * 2, _d.x * sp, _d.y * sp + 2, _d.z * sp, rr(2.4, 4.2), 1.4 * K, rr(3.4, 5) * K, rr(0.2, 0.35), c[0] * 6, c[1] * 6 + 1, c[2] * 6 + 0.3, d, d, d, 0.85, 1.5, -1.6, 0.8); }
  if (phase >= 3) { const e = emitter(E_SPARKS, x, y, z, 6, 1.2); e.ent = q; e.vx = 0; e.vy = y - q.pos.y; e.vz = 0; }
}
// flares going up around the player for a few seconds after the win
function updateVictory(dt) {
  victoryT -= dt; victoryAcc += dt * 2.2;
  const e = (G.player && G.player.ent) || G.state.player.ent; if (!e || !e.pos) return;
  while (victoryAcc >= 1) {
    victoryAcc -= 1;
    const a = rnd() * TAU, o = rr(14, 42), x = e.pos.x + Math.cos(a) * o, z = e.pos.z + Math.sin(a) * o, y = e.pos.y + rr(26, 48);
    const c = rnd() < 0.65 ? C_CYAN : [1.0, 0.75, 0.3];
    glow(x, y, z, 3, 14, 0.3, c[0] * 12 + 3, c[1] * 12 + 3, c[2] * 12 + 3);
    shell(x, y, z, 1, 16, 0.5, c[0] * 2.4, c[1] * 2.4, c[2] * 2.4);
    flash(x, y, z, c, 3, 40, 0.3);
    for (let i = 0; i < 46; i++) { rdir(0); const sp = rr(8, 20); W(ADD, x, y, z, _d.x * sp, _d.y * sp, _d.z * sp, rr(1.2, 2.4), 0.11, 0.05, 0, 0, 1.6, 2.2, 0, 0, 0, 0, 0, c[0] * 9 + 1, c[1] * 9 + 1, c[2] * 9 + 1, 1.4, 2, 0.06, NOFLOOR, 1); }
    beamW(x + rs() * 3, e.pos.y, z + rs() * 3, x, y, z, 0.5, c[0] * 3, c[1] * 3, c[2] * 3, 0.12, 3, 0);
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================
const API = {
  name: 'fx',
  stats: { particles: 0, lit: 0, add: 0, beams: 0, emitters: 0, cap: 0, cpuMs: 0, spawned: 0 },
  tune: TUNE,

  init() {
    const uniforms = Object.assign({}, U);
    fogPatched = /ktFogAmount/.test(THREE.ShaderChunk.fog_fragment || '');
    pMat = new THREE.ShaderMaterial({
      name: 'fx-particle', uniforms, vertexShader: PARTICLE_VS, fragmentShader: PARTICLE_FS,
      transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true,
    });
    bMat = new THREE.ShaderMaterial({
      name: 'fx-beam', uniforms: { uTime: U.uTime, uFog: U.uFog },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, depthTest: true, fog: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      side: THREE.DoubleSide,
    });
    pMat.side = THREE.DoubleSide;
    this._build();
    on('explosion', onExplosion);
    on('voxels:destroyed', onVoxels);
    on('collapse', e => collapseFx(e.x, e.y, e.z, e.mass || 50, e.height || 4));
    on('debris:impact', onDebrisImpact);
    on('building:levelled', e => levelledFx(e.id));
    on('shot', onShot);
    on('tracer', onTracer);
    on('impact', onImpact);
    on('footstep', e => footstep(e.x, e.y, e.z, e.heavy || e.kind === 'mech' || e.kind === 'emech'));
    on('punch', e => {
      if (!e.hit) return;
      const L = lod(e.x, e.y, e.z), dx = e.dx || 0, dy = e.dy || 0, dz = e.dz || 0;
      sparksBurst(e.x, e.y, e.z, 2.2, dx, dy, dz, C_FIRE);
      shell(e.x, e.y, e.z, 0.6, 4, 0.2, 1.4, 1.2, 1.0);
      flash(e.x, e.y, e.z, C_HOT, 2.5, 10, 0.1);
      const n = roundP(9 * L);
      for (let i = 0; i < n; i++) { rdir(0); const sp = rr(3, 11); puff(e.x, e.y, e.z, dx * sp + _d.x * 3, dy * sp + _d.y * 3 + 0.5, dz * sp + _d.z * 3, rr(1.6, 3), 0.5, rr(1.6, 2.6), DUST[0], DUST[1], DUST[2], 0.42, 1.8, 0.2, 0.3); }
    });
    on('slam', e => { if (!recent(TAG_BOOM + 10, e.x, e.y, e.z, 6, 0.3)) { mark(TAG_BOOM + 10, e.x, e.y, e.z); slamFx(e.x, e.y, e.z, e.radius || 8, e.team); } });
    on('jet', e => { if (e.on && e.ent && e.ent.pos) { const p = e.ent.pos, gy = groundY(p.x, p.y + 0.5, p.z); if (p.y - gy < 1.5) dustWall(p.x, gy, p.z, roundP(8 * lod(p.x, p.y, p.z)), 0.6, 4 * (e.ent.radius || 0.4) + 2, 0.3 + (e.ent.radius || 0.4) * 0.3, 1.8, 0.3); } });
    on('dash', e => { if (e.ent && e.ent.pos) { const p = e.ent.pos; dustCloud(p.x, groundY(p.x, p.y + 0.5, p.z) + 0.4, p.z, 0.5 + (e.ent.radius || 0.4), DUST, 0.34); } });
    on('mech:incoming', e => reentry(e.x, e.z, e.eta, e.team));
    on('mech:land', e => landing(e.x, e.y == null ? GROUND_Y : e.y, e.z, 1, e.team));
    on('mech:eject', e => ejectFx(e.x, e.y, e.z, e.ent));
    on('mech:selfdestruct', e => selfDestruct(e.x, e.y, e.z, 1));
    on('mech:enter', e => { const c = C_CYAN; ring(e.x, groundY(e.x, e.y + 1, e.z) + 0.15, e.z, 1.5, 7, 0.5, 0, 0, 0, 0, c[0] * 2, c[1] * 2, c[2] * 2); glow(e.x, e.y + 5, e.z, 2, 6, 0.3, c[0] * 3, c[1] * 3, c[2] * 3); });
    on('grab', e => dustCloud(e.x, e.y, e.z, 1.2, DUST, 0.36));
    on('throw', e => dustCloud(e.x, e.y, e.z, 0.7, DUST, 0.25));
    on('weapon:overheat', e => { const s = e.shooter; if (s && s.pos) { const h = (s.height || 2) * 0.7; for (let i = 0; i < 8; i++) API.emit('steam', s.pos.x + rs() * (s.radius || 0.5), s.pos.y + h, s.pos.z + rs() * (s.radius || 0.5), 0, 1, 0, 60); } });
    on('ent:death', onDeath);
    // Phase C
    on('objective:done', e => { const o = e && e.objective; if (o && o.x != null) beacon(o.x, o.y == null ? GROUND_Y : o.y, o.z, C_CYAN, 1.4); else playerBeacon(C_CYAN, 0.8); });
    on('perk:taken', () => playerBeacon([1.0, 0.72, 0.25], 1));
    on('boss:phase', e => { const q = e && e.ent; if (q && q.pos) bossPhase(q, e.phase || 2); });
    on('boss:spawn', e => { const q = e && e.ent; if (q && q.pos) bossPhase(q, 1); });
    on('game:won', () => { victoryT = 6; });
    on('mission:won', () => { victoryT = 6; });
    // Phase B
    on('shield:hit', e => shieldHit(e.ent, e.x, e.y, e.z, e.amount || 20));
    on('shield', e => { if (e.broken && e.ent && e.ent.pos) shieldBreak(e.ent); });
    on('weapon:recoil', e => { if (e.weapon !== 'siege' && (e.strength || 0) >= 0.8) siegeBlast(e.x, e.y, e.z, e.dx || 0, e.dy || 0, e.dz || 0, e.strength); });
    on('grapple', onGrapple);
    on('limb:torn', e => limbTorn(e.ent, e.limb));
    on('finisher', onFinisher);
    on('charge:planted', e => { const m = emitter(E_CHARGE, e.x, e.y, e.z, 0.85, 1); m.ent = e.target || null; if (m.ent && m.ent.pos) { m.vx = e.x - m.ent.pos.x; m.vy = e.y - m.ent.pos.y; m.vz = e.z - m.ent.pos.z; } });
    on('brace', e => { if (e.on && e.ent && e.ent.pos) { const p = e.ent.pos, gy = groundY(p.x, p.y + 0.5, p.z); dustWall(p.x, gy, p.z, roundP(12 * lod(p.x, p.y, p.z)), 1.5, 6, 0.6, 2, 0.34); ring(p.x, gy + 0.1, p.z, 1.5, 7, 0.6, DUST[0], DUST[1], DUST[2], 0.4, 0, 0, 0); } });
    on('mech:hijack', e => { const q = e.ent; if (q && q.pos) { const c = C_CYAN; ring(q.pos.x, groundY(q.pos.x, q.pos.y + 1, q.pos.z) + 0.15, q.pos.z, 1.5, 9, 0.6, 0, 0, 0, 0, c[0] * 2.5, c[1] * 2.5, c[2] * 2.5); glow(q.pos.x, q.pos.y + (q.height || 8) * 0.6, q.pos.z, 3, 9, 0.35, c[0] * 4, c[1] * 4, c[2] * 4); } });
    on('fire:start', e => { if (camDist(e.x, e.y, e.z) < 150 && take(BK.vox, 3) >= 3) { glow(e.x, e.y, e.z, 0.6, 1.8, 0.25, 4, 2, 0.5); for (let i = 0; i < 3; i++) flame(e.x + rs() * 0.3, e.y, e.z + rs() * 0.3, rs(), rr(1.5, 3.5), rs(), rr(0.3, 0.6), 0.45, 0.1, 5, 2.5, 0.6, 1.2, -2.5, 0.2); } });
    on('fire:out', e => { if (e && e.x != null && camDist(e.x, e.y, e.z) < 120 && take(BK.vox, 2) >= 2) for (let i = 0; i < 2; i++) { const g = rr(0.1, 0.2); puff(e.x + rs() * 0.3, e.y + 0.3, e.z + rs() * 0.3, rs() * 0.3, rr(0.8, 1.6), rs() * 0.3, rr(2.5, 4.5), 0.3, rr(1.2, 1.8), g, g, g, 0.4, 0.7, -0.9, 0.4); } });
    on('gas:jet', e => {
      // DESTRUCT's own jets are drawn every frame from G.destruct.jets; anyone else's event gets an emitter
      if (G.destruct && G.destruct.jets) { glow(e.x, e.y + 0.5, e.z, 2, 7, 0.2, 10, 6, 2.5); flash(e.x, e.y + 1, e.z, C_HOT, 4, 18, 0.25); dustCloud(e.x, e.y + 0.3, e.z, 1.2, DUST, 0.4); }
      else gasJet(e.x, e.y, e.z, e.dx || 0, e.dy == null ? 1 : e.dy, e.dz || 0, e.dur || 6, e.scale || 1);
    });
    on('fire:pool', e => firePool(e.x, e.y, e.z, e.radius || 4, e.dur || 12));
    on('quality', () => { if (LIT && Math.floor((G.quality.particlesMax || 12000) * 0.5) !== LIT.cap) this._build(); });
    if (G.debug) console.log('fx: pools', LIT.cap, ADD.cap, BEAM.cap);
  },

  _build() {
    disposePool(LIT); disposePool(ADD); disposePool(BEAM);
    const max = Math.max(1000, G.quality.particlesMax || 12000);
    LIT = makePool(Math.floor(max * 0.5), 40, pMat);
    ADD = makePool(max - Math.floor(max * 0.5), 41, pMat);
    BEAM = makeBeamPool(BEAM_CAP, bMat);
    clearPool(LIT); clearPool(ADD); clearPool(BEAM);
    this.stats.cap = max;
  },

  reset() {
    clearPool(LIT); clearPool(ADD); clearPool(BEAM);
    for (let i = 0; i < EMAX; i++) { EM[i].type = E_FREE; EM[i].ent = null; }
    for (let i = 0; i < FL.length; i++) { FL[i].t0 = -9; FL[i].pri = 0; }
    for (let i = 0; i < pendingMech.length; i++) pendingMech[i].on = false;
    RC.fill(0); for (let i = 0; i < 16; i++) RC[i * 5 + 3] = -99;
    for (const k in BK) BK[k][0] = BK[k][2];
    lastSmallFlash = -9; load = 1; fireAcc = 0; fireLight = 0; victoryT = 0;
    this.stats.particles = this.stats.lit = this.stats.add = this.stats.beams = this.stats.emitters = 0;
  },

  update(dt) {
    const t0 = G.debug ? performance.now() : 0;
    const t = G.time, R = G.render;
    // light state from the renderer
    U.uTime.value = t;
    U.uWind.value.set(TUNE.wind[0], TUNE.wind[1], TUNE.wind[2]);
    U.uExposure.value = TUNE.lightScale;
    if (R) {
      if (R.sunDir) U.uSunDir.value.copy(R.sunDir).normalize();
      if (R.sunColor) U.uSunCol.value.copy(R.sunColor);
      if (R.skyColor) U.uSkyCol.value.copy(R.skyColor);
      const fg = G.scene.fog;
      if (R.fogColor) U.uFogCol.value.copy(R.fogColor); else if (fg) U.uFogCol.value.copy(fg.color);
      if (!fg) U.uFog.value.set(0, 0);
      else if (fg.isFogExp2) { if (fogPatched) U.uFog.value.set(fg.density * 0.55, 0); else U.uFog.value.set(0, fg.density * fg.density); }
      else U.uFog.value.set(0, 1.6 / (fg.far * fg.far));
      const s = U.uSunCol.value, k = U.uSkyCol.value;
      if (R.groundColor) U.uGndCol.value.copy(R.groundColor).multiplyScalar(0.6); else U.uGndCol.value.setRGB(s.r * 0.085 + k.r * 0.06, s.g * 0.07 + k.g * 0.06, s.b * 0.055 + k.b * 0.06);
    }
    for (let i = 0; i < 4; i++) {
      const f = FL[i], u = (t - f.t0) / f.dur, k = u >= 1 || u < 0 ? 0 : (1 - u) * (1 - u);
      U.uLP.value[i].set(f.x, f.y, f.z, f.r * 1.6); U.uLC.value[i].set(f.cr * k, f.cg * k, f.cb * k);
    }
    if (dt > 0) {
      for (const k in BK) { const b = BK[k]; b[0] = Math.min(b[2], b[0] + b[1] * dt); }
      resolvePendingMech();
      updateEmitters(dt);
      updateDamaged(dt);
      updateFires(dt);
      const J = G.destruct && G.destruct.jets;
      if (J && J.count > 0) for (let i = 0; i < J.count; i++) { const k = Math.min(1, J.t[i] * 1.2); torchTick(J.x[i], J.y[i] + 0.1, J.z[i], Math.sin(t * 3.1 + i * 2.3) * 0.12, 1, Math.cos(t * 2.3 + i * 1.7) * 0.12, 0.55 + 0.5 * k, dt); }
      if (victoryT > 0) updateVictory(dt);
    }
    // bookkeeping
    const nl = countAlive(LIT, t), na = countAlive(ADD, t), nb = countAlive(BEAM, t);
    const fill = Math.max(nl / LIT.cap, na / ADD.cap);
    load = fill < 0.55 ? 1 : Math.max(0.2, 1 - (fill - 0.55) / 0.4 * 0.8);
    const S = this.stats; S.lit = nl; S.add = na; S.beams = nb; S.particles = nl + na;
    let ne = 0; for (let i = 0; i < EMAX; i++) if (EM[i].type) ne++; S.emitters = ne;
    flushPool(LIT); flushPool(ADD); flushPool(BEAM);
    if (G.debug) S.cpuMs = S.cpuMs * 0.9 + (performance.now() - t0) * 0.1;
  },

  // Continuous sources. Call once per frame per source; `amount` is an intensity (1 = nominal).
  // 'dust' 'spark' 'debris_dust' 'blood' are impulses: `amount` scales a one-off puff.
  emit(kind, x, y, z, dx, dy, dz, amount, team) {
    if (!LIT) return;
    const a = amount == null ? 1 : amount; if (a <= 0) return;
    dx = dx || 0; dy = dy || 0; dz = dz || 0;
    const dt = G.dt || 0;
    const dl = Math.hypot(dx, dy, dz), ux = dl > 1e-5 ? dx / dl : 0, uy = dl > 1e-5 ? dy / dl : 0, uz = dl > 1e-5 ? dz / dl : 0;
    switch (kind) {
      case 'jet': {
        if (dt <= 0) return;
        const d = camDist(x, y, z); if (d > 260) return;
        const L = lod(x, y, z), S = a <= 1 ? Math.max(0.15, a) : Math.min(2.4, 1 + (a - 1) * 0.3), jy = dl > 1e-5 ? uy : -1;
        const n = take(BK.emit, roundP(dt * 85 * L));
        for (let i = 0; i < n; i++) {
          const sp = rr(14, 24) * (0.5 + 0.5 * S), f = rnd();
          flame(x + ux * f * 0.4 + rs() * 0.08 * S, y + (dl > 1e-5 ? uy : -1) * f * 0.4, z + uz * f * 0.4 + rs() * 0.08 * S, ux * sp + rs() * 1.2, jy * sp + rs() * 1.2, uz * sp + rs() * 1.2, rr(0.09, 0.2), rr(0.34, 0.5) * S, 0.07 * S, team === 1 ? 9 : 3.2, team === 1 ? 4.2 : 5.2, team === 1 ? 1.4 : 8.5, 2.5, 0, 0);
        }
        if (rnd() < dt * 45) glow(x + ux * 0.4 * S, y + jy * 0.4 * S, z + uz * 0.4 * S, 1.0 * S, 1.7 * S, 0.06, team === 1 ? 8 : 4, team === 1 ? 4.5 : 5.5, team === 1 ? 2 : 8);
        if (rnd() < dt * 26 * L) spark(x, y, z, ux * 16 + rs() * 4, jy * 16 + rs() * 4, uz * 16 + rs() * 4, rr(0.2, 0.5), 0.035 * (0.6 + S), 9, 6, 3, 1.5, 6, 0.04, NOFLOOR);
        // wash kicks dust up off the ground
        if (jy < -0.4) {
          const gy = groundY(x, y, z), h = y - gy;
          if (h < 9 * S + 2 && rnd() < dt * 22 * L * (1 - h / (9 * S + 2))) {
            const an = rnd() * TAU, sp = rr(3, 8) * (0.6 + 0.5 * S);
            puff(x + Math.cos(an) * 0.6, gy + 0.3, z + Math.sin(an) * 0.6, Math.cos(an) * sp, rr(0.3, 1.5), Math.sin(an) * sp, rr(1.4, 2.6), 0.4 * (0.5 + S), rr(1.4, 2.3) * (0.5 + S * 0.6), DUST[0], DUST[1], DUST[2], 0.3, 1.9, -0.1, 0.3);
          }
        }
        return;
      }
      case 'smoke': {
        if (dt <= 0) return;
        const n = take(BK.emit, roundP(dt * 14 * a * lod(x, y, z)));
        for (let i = 0; i < n; i++) { const g = rr(0.06, 0.16); puff(x + rs() * 0.2, y + rs() * 0.2, z + rs() * 0.2, dx + rs() * 0.5, dy + rr(0.8, 1.8), dz + rs() * 0.5, rr(2.4, 4.4), 0.3 * Math.sqrt(a), rr(1.3, 2.1) * Math.sqrt(a), g, g, g, rr(0.4, 0.6), 0.8, -1.2, 0.4); }
        return;
      }
      case 'steam': {
        if (dt <= 0) return;
        const n = take(BK.emit, roundP(dt * 14 * a * lod(x, y, z)));
        for (let i = 0; i < n; i++) puff(x + rs() * 0.15, y, z + rs() * 0.15, dx * 2 + rs() * 0.6, dy * 2 + rr(1, 2.4), dz * 2 + rs() * 0.6, rr(0.9, 1.8), 0.2, rr(0.9, 1.5), 0.82, 0.84, 0.86, rr(0.2, 0.34), 1.6, -1.6, 0.3);
        return;
      }
      case 'fire': {
        if (dt <= 0) return;
        const L = lod(x, y, z), S = Math.sqrt(a);
        let n = take(BK.emit, roundP(dt * 26 * L));
        for (let i = 0; i < n; i++) { const h = rr(0.5, 1); lick(x + rs() * 0.3 * S, y + rnd() * 0.2, z + rs() * 0.3 * S, dx + rs() * 0.5, dy + rr(1.6, 3.4), dz + rs() * 0.5, rr(0.3, 0.7), rr(0.3, 0.5) * S, 0.08 * S, C_FIRE[0] * 2.5 * h, C_FIRE[1] * 2.5 * h, C_FIRE[2] * 2.5 * h, 1.2, -2.5, 0.25); }
        if (rnd() < dt * 5 * L) { const g = rr(0.05, 0.12); puff(x, y + 0.8 * S, z, dx + rs() * 0.4, dy + rr(1.4, 2.4), dz + rs() * 0.4, rr(3, 5), 0.35 * S, rr(1.4, 2.2) * S, g, g, g, 0.5, 0.6, -1.2, 0.5); }
        if (rnd() < dt * 4 * L) ember(x + rs() * 0.4, y + 0.5, z + rs() * 0.4, rs() * 1.2, rr(1.2, 3), rs() * 1.2, rr(1.8, 4), 0.045, 6.5, 3, 0.7);
        return;
      }
      case 'ember': {
        if (dt <= 0) return;
        const n = take(BK.emit, roundP(dt * 10 * a * lod(x, y, z)));
        for (let i = 0; i < n; i++) ember(x + rs() * 0.6, y + rs() * 0.4, z + rs() * 0.6, dx + rs() * 1.3, dy + rr(0.8, 2.6), dz + rs() * 1.3, rr(1.8, 4.2), rr(0.035, 0.06), 6.5, rr(2.4, 3.4), rr(0.4, 0.9));
        return;
      }
      case 'trail_rocket': case 'trail_missile': case 'trail_shell': {
        if (dt <= 0) return;
        const d = camDist(x, y, z); if (d > 300) return;
        const L = lod(x, y, z), speed = dl > 1.5 ? dl : kind === 'trail_shell' ? 45 : 60, step = speed * dt;
        const missile = kind === 'trail_missile', shellT = kind === 'trail_shell';
        // exhaust flame at the tail
        if (!shellT) {
          const c = missile ? C_CYAN : C_FIRE;
          flame(x - ux * 0.3, y - uy * 0.3, z - uz * 0.3, -ux * 6, -uy * 6, -uz * 6, 0.09, 0.3 * a, 0.08, missile ? 4 + c[0] * 5 : 9, missile ? 5 + c[1] * 4 : 5.5, missile ? 6 + c[2] * 4 : 2.2, 4, 0, 0);
          if (rnd() < dt * 40) glow(x - ux * 0.2, y - uy * 0.2, z - uz * 0.2, 0.7 * a, 1.1 * a, 0.06, missile ? 3.5 : 7, missile ? 5.5 : 4.4, missile ? 7.5 : 1.8);
        }
        const sa = Math.sqrt(a);
        const n = take(BK.emit, roundP(clamp(step / (shellT ? 1.2 : 0.4 * sa), 0.5, 7) * Math.max(L, 0.5)));
        for (let i = 0; i < n; i++) {
          const f = (i + rnd()) / Math.max(1, n) * step, g = missile ? rr(0.6, 0.75) : shellT ? rr(0.3, 0.42) : rr(0.36, 0.56);
          const hot = shellT ? 0 : 0.12;
          if (hot) fireball(x - ux * f + rs() * 0.06, y - uy * f + rs() * 0.06, z - uz * f + rs() * 0.06, -ux * 2 + rs() * 0.5, -uy * 2 + rs() * 0.5 + 0.2, -uz * 2 + rs() * 0.5, missile ? rr(1.1, 1.9) : rr(1.6, 3.0), 0.2 * sa, rr(0.6, 1.0) * sa * (missile ? 0.85 : 1), hot, missile ? 2 : 6, missile ? 3 : 3, missile ? 4.5 : 0.9, g, g, g * (missile ? 1.05 : 1), rr(0.36, 0.52), 1.6, -0.25, 0.22);
          else puff(x - ux * f, y - uy * f, z - uz * f, rs() * 0.4, rs() * 0.4 + 0.2, rs() * 0.4, rr(0.8, 1.5), 0.14 * a, rr(0.5, 0.8) * a, g, g, g, 0.26, 1.8, -0.15, 0.15);
        }
        if (!shellT && rnd() < dt * 20 * L) { rdir(0); spark(x, y, z, -ux * 8 + _d.x * 3, -uy * 8 + _d.y * 3, -uz * 8 + _d.z * 3, rr(0.2, 0.5), 0.03, 9, 5.5, 2, 1.5, 9.8, 0.05, NOFLOOR); }
        return;
      }
      case 'torch': {                 // gas jet: call every frame; d = direction of the jet
        if (dt <= 0) return;
        torchTick(x, y, z, dl > 1e-5 ? ux : 0, dl > 1e-5 ? uy : 1, dl > 1e-5 ? uz : 0, Math.max(0.3, a), dt);
        return;
      }
      case 'pool': {                  // burning pool of radius `amount` metres: call every frame
        if (dt <= 0) return;
        poolTick(x, y, z, Math.max(0.5, a), 1, dt);
        return;
      }
      case 'dust': case 'debris_dust': {
        const n = take(BK.emit, roundP(clamp(3 * a, 0.5, 20) * lod(x, y, z)));
        const S = clamp(Math.sqrt(a), 0.4, 3);
        for (let i = 0; i < n; i++) { rdir(0.25); const sp = rr(0.6, 2.4) * S, k = rr(0.86, 1.1); puff(x + _d.x * 0.3 * S, y + _d.y * 0.2 * S, z + _d.z * 0.3 * S, dx + _d.x * sp, dy + _d.y * sp + 0.2, dz + _d.z * sp, rr(1.8, 3.8), rr(0.3, 0.5) * S, rr(1.2, 2.0) * S, DUST[0] * k, DUST[1] * k, DUST[2] * k, rr(0.3, 0.46), 2, -0.08, 0.3); }
        return;
      }
      case 'spark': case 'blood': {
        const n = take(BK.emit, roundP(clamp(6 * a, 1, 40) * lod(x, y, z)));
        for (let i = 0; i < n; i++) { rdir(0); const sp = rr(3, 12); spark(x, y, z, dx * 4 + _d.x * sp, dy * 4 + _d.y * sp + 1.5, dz * 4 + _d.z * sp, rr(0.25, 0.9), rr(0.03, 0.055), 9, 5.6, 2, 1, 9.8, 0.05, NOFLOOR); }
        return;
      }
    }
  },

  beam(x0, y0, z0, x1, y1, z1, kind) {
    if (!BEAM) return;
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0); if (L < 0.05) return;
    switch (kind) {
      case 'tracer': beamW(x0, y0, z0, x1, y1, z1, clamp(L / 320, 0.045, 0.6), 5, 7, 8, 0.045, 0, 11); break;
      case 'tracer_enemy': beamW(x0, y0, z0, x1, y1, z1, clamp(L / 260, 0.05, 0.7), 10, 2.6, 0.7, 0.05, 0, 11); break;
      case 'pulse': case 'pulse_enemy': {
        const c = kind === 'pulse' ? C_CYAN : C_VANTA;
        beamW(x0, y0, z0, x1, y1, z1, clamp(L / 240, 0.09, 0.5), c[0] * 9 + 0.8, c[1] * 9 + 0.8, c[2] * 9 + 0.8, 0.2, 1, 0);
        break;
      }
      case 'lock': beamW(x0, y0, z0, x1, y1, z1, 0.13, 6, 3.6, 0.6, 0.035, 2, 0); break;
      case 'lance': lanceBeam(x0, y0, z0, x1, y1, z1); break;
      default: beamW(x0, y0, z0, x1, y1, z1, 0.25, 6, 5, 4, 0.08, 3, 0);
    }
  },

  burst(kind, x, y, z, scale, opts) {
    if (!LIT) return;
    const S = scale == null ? 1 : scale, o = opts || NOOPTS;
    const team = o.team === 1 ? 1 : 0;
    switch (kind) {
      case 'explosion': explode(x, y, z, S, !!o.air, o.color); break;
      case 'explosion_big': explode(x, y, z, 2.2 * S, !!o.air, o.color); break;
      case 'airburst': explode(x, y, z, S, true, o.color); break;
      case 'muzzle': muzzle(x, y, z, o.dx || 0, o.dy || 0, o.dz == null ? 1 : o.dz, S, o.pulse ? 'pulse' : 'bullet', team); break;
      case 'muzzle_big': muzzle(x, y, z, o.dx || 0, o.dy || 0, o.dz == null ? 1 : o.dz, S, 'shell', team); break;
      case 'pulse_hit': pulseHit(x, y, z, S, team, o.nx || 0, o.ny || 0, o.nz || 0); break;
      case 'dustcloud': dustCloud(x, y, z, S, o.mat ? matDust(o.mat) : o.color, o.alpha); break;
      case 'shockwave': shockwave(x, y, z, S, o.color); break;
      case 'sparks': sparksBurst(x, y, z, S, o.dx || 0, o.dy || 0, o.dz || 0, o.color || (o.team != null ? teamCol(team) : null)); break;
      case 'glass': glassBurst(x, y, z, S, o.count, o.dx || 0, o.dy || 0, o.dz || 0); break;
      case 'landing': landing(x, y, z, S, team); break;
      case 'slam': slamFx(x, y, z, 8 * S, team); break;
      case 'selfdestruct': selfDestruct(x, y, z, S); break;
      case 'reentry': reentry(x, z, o.eta || 3, team); break;
      case 'eject': ejectFx(x, y, z, o.ent || null); break;
      case 'collapse': collapseFx(x, y, z, o.mass || 400 * S, o.height || 10); break;
      case 'fire': emitter(E_FIRE, x, y, z, o.dur || 12, S); break;
      case 'gasjet': case 'torch': gasJet(x, y, z, o.dx || 0, o.dy == null ? 1 : o.dy, o.dz || 0, o.dur || 6, S); break;
      case 'firepool': case 'pool': firePool(x, y, z, 4 * S, o.dur || 12); break;
      case 'shield_hit': shieldHit(o.ent || null, x, y, z, 40 * S, team); break;
      case 'lance_hit': lanceHit(x, y, z, o.nx || 0, o.ny || 0, o.nz || 0, null); break;
      case 'split': bombletSplit(x, y, z, o.dx || 0, o.dy == null ? -1 : o.dy, o.dz || 0); break;
      case 'limb': limbTorn(o.ent || null, o.limb, x, y, z); break;
      case 'beacon': beacon(x, y, z, o.color || teamCol(team), S); break;
      case 'bossphase': bossPhase({ pos: { x, y, z }, height: 12 * S }, o.phase || 2); break;
      case 'victory': victoryT = 6; break;
      case 'smokecolumn': { const e = emitter(E_COLUMN, x, y, z, o.dur || 12, S); e.a = 1; break; }
    }
  },

  // look-dev helpers
  _pools() { return { LIT, ADD, BEAM, EM, U }; },
};
const NOOPTS = Object.freeze({});
export default API;
