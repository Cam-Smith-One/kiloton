// ============================================================================
// KILOTON — destruct.js   OWNER: DESTRUCT
// All runtime changes to the voxel grid, structural collapse and debris.
//   destruct_base.js    grid writes, dirty chunks, building accounting, barrels
//   destruct_struct.js  flood fill / overload analysis, staged collapse release
//   destruct_bodies.js  debris cubes + rigid voxel bodies, rubble deposit
// ============================================================================
import { G, THREE, VS, NX, NY, NZ, CX, CZ, GROUND_J, bus } from './core.js';
import { STRENGTH, GLASS, SOLID, DENSITY } from './materials.js';
import { data, INV, LAYER, BARREL, GAS, FUEL, EXPL, FLAM, CHARRED, SCORCH, ctx, stats, hooks, rnd, hsh, rm, put, flush, B, initBuildings, bq, noteBarrelBlast, resetBarrels, tally, dominant, reseed, seedState, seedRestore, editT, canHurt, clock, fireClient } from './destruct_base.js';
import { TUNE, spawnBit, spawnBitRGB, bitRoom, updateBits, updateBodies, initBodies, resetBodies, setQuality as bodiesQuality, blast, bld, bldPush, makeBody, activate, discardBody, ensureRoom, purgeChunk } from './destruct_bodies.js';
import { STUNE, queueCheck, initStruct, resetStruct, stepStruct } from './destruct_struct.js';
import { FTUNE, fires, jets, ignite, igniteVoxel, burnPool, gasBlast, fuelBlast, updateFire, resetFire, chainBoom, applyBurn, serializeFires, applyFires } from './destruct_fire.js';

const cand = new Int32Array(4096), candM = new Uint8Array(4096);
const held = new Set();
let levelT = 0, msAcc = 0, msN = 0;
const _q = new THREE.Quaternion(), _c = new THREE.Color();

// carve a sphere; shared by explode / impact / debris impacts. Returns the number of voxels removed.
let cN = 0, openHit = false;
function carveSphere(x, y, z, radius, power, scorch, ragged) {
  const r = radius * INV, ci = x * INV, cj = y * INV, ck = z * INV, R = Math.ceil(r * (scorch ? 1.12 : 1)) + 1;
  const i0 = Math.max(0, Math.floor(ci - R)), i1 = Math.min(NX - 1, Math.floor(ci + R)), j0 = Math.max(1, Math.floor(cj - R)), j1 = Math.min(NY - 1, Math.floor(cj + R)), k0 = Math.max(0, Math.floor(ck - R)), k1 = Math.min(NZ - 1, Math.floor(ck + R));
  const lim = scorch ? 1.12 : 1, ir = 1 / r;
  let n = 0, lit = 0; cN = 0; openHit = false;
  for (let j = j0; j <= j1; j++) {
    const dy = j + 0.5 - cj;
    for (let k = k0; k <= k1; k++) {
      const dz = k + 0.5 - ck, row = NX * (k + NZ * j);
      for (let i = i0; i <= i1; i++) {
        const m = data[row + i]; if (!m) continue;
        const dx = i + 0.5 - ci, d = Math.sqrt(dx * dx + dy * dy + dz * dz) * ir;
        if (d > lim) continue;
        const st = STRENGTH[m];
        if (d <= 1 && st !== 255 && st < power * (1.15 - d) * (ragged ? 0.86 + 0.28 * hsh(i, j, k) : 1)) {
          rm(i, j, k); n++; tally[m]++;
          if (j >= GROUND_J - 1 && !B.at[i + NX * k]) openHit = true;
          if (cN < 4096) { cand[cN] = row + i; candM[cN++] = m; } else { const q = (rnd() * 4096) | 0; cand[q] = row + i; candM[q] = m; }
        } else if (scorch) {
          if (FLAM[m]) { if (lit < 26 && power >= 70 && hsh(j, k, i) < 0.45 && igniteVoxel(i, j, k, ctx.owner)) lit++; }
          else if (SCORCH[m] && j >= GROUND_J - 1 && power * (1.6 - d) > st && hsh(k, i, j) < 0.6) put(i, j, k, CHARRED);
        }
      }
    }
  }
  if (n) queueCheck(i0, j0, k0, i1, j1, k1, ctx.owner, x, y, z, openHit);
  return n;
}
function finishOp(n, x, y, z, radius) {
  flush();
  if (n) { G.state.stats.voxelsDestroyed += n; bus.emit('voxels:destroyed', { x, y, z, count: n, mat: dominant(), radius }); } else tally.fill(0);
}

const destruct = {
  name: 'destruct', stats, TUNE, STUNE, FTUNE, fires, jets,

  init() {
    initBuildings(); initStruct(); initBodies();
    hooks.impactCarve = (x, y, z, r, power) => { const n = carveSphere(x, y, z, r, power, false, true); finishOp(n, x, y, z, r); };
    hooks.thrownImpact = (b, x, y, z, speed) => {
      const power = Math.min(140, 40 + Math.sqrt(b.mass) * speed * 0.5), r = Math.min(2.6, 0.7 + b.rad * 0.5);
      ctx.owner = b.owner; ctx.depth = 0;
      const n = carveSphere(x, y, z, r, power, false, true); finishOp(n, x, y, z, r);
      const dmg = Math.min(500, 8 * Math.sqrt(b.mass) * speed * 0.12 + 20), dr = r + 1.2, L = G.ents.list;
      for (let q = L.length - 1; q >= 0; q--) {
        const e = L[q]; if (!e.alive || !canHurt(e)) continue;
        const cy = Math.min(Math.max(y, e.pos.y), e.pos.y + e.height), ex = e.pos.x - x, ey = cy - y, ez = e.pos.z - z, d = Math.max(0, Math.sqrt(ex * ex + ey * ey + ez * ez) - e.radius);
        if (d < dr) G.ents.damage(e, dmg * (1 - 0.75 * d / dr), { type: 'debris', src: b.owner, x, y, z, dx: ex, dy: ey + 0.5, dz: ez });
      }
      let ex = 0; for (let v = 0; v < b.n; v++) if (EXPL[b.mat[v]]) ex++;
      if (ex) { chainBoom(x, y, z, { radius: Math.min(6, 3.2 + ex * 0.02), power: 130, damage: 110 + Math.min(120, ex), owner: b.owner, kind: 'grenade' }); burnPool(x, y, z, 2.5 + Math.min(3, ex * 0.02), 7, b.owner); }
    };
    bus.on('quality', () => bodiesQuality());
  },

  reset() {
    resetBodies(); resetStruct(); resetBarrels(); resetFire(); flush();
    for (const ch of held) if (ch._body) discardBody(ch._body);
    held.clear(); remoteChunks.clear();
    for (let n = 0; n < B.n; n++) { if (B.done[n]) B.list[n].alive = true; B.done[n] = 0; B.lost[n] = 0; }
    stats.ms = stats.msMax = 0; stats.checks = stats.collapses = stats.deposited = 0; ctx.owner = null; ctx.depth = 0;
  },

  // ---- explosions -----------------------------------------------------------------
  explode(x, y, z, radius, power, opts) {
    const owner = (opts && opts.owner) || null;
    ctx.owner = owner; if (!(opts && opts._chain)) ctx.depth = 0; else reseed((Math.round(x * 4) * 73856093) ^ (Math.round(y * 4) * 19349663) ^ (Math.round(z * 4) * 83492791));   // derived blasts: same debris on every peer
    const n = carveSphere(x, y, z, radius, power, radius >= 1 && power >= 60, true);
    // throw a share of what broke
    const want = Math.min(cN, bitRoom() > 400 ? Math.min(90, 10 + radius * 16) : 12, Math.ceil(n * 0.4));
    for (let s = 0; s < want; s++) {
      const q = (rnd() * cN) | 0, g = cand[q], m = candM[q];
      const j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX;
      const px = (i + 0.5) * VS, py = (j + 0.5) * VS, pz = (k + 0.5) * VS;
      let dx = px - x, dy = py - y + 0.4, dz = pz - z; const l = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01, f = 1 / l;
      const sp = (5 + power * 0.07 * rnd()) * Math.max(0.35, 1.2 - l / (radius + 0.01));
      dx = dx * f + (rnd() - 0.5) * 0.5; dy = dy * f + 0.35 + rnd() * 0.4; dz = dz * f + (rnd() - 0.5) * 0.5;
      if (GLASS[m]) spawnBit(px, py, pz, dx * sp, dy * sp, dz * sp, m, 0.14 + rnd() * 0.14, 0, owner);
      else spawnBit(px, py, pz, dx * sp, dy * sp, dz * sp, m, rnd() < 0.55 ? 0.5 : 0.25 + rnd() * 0.15, rnd() < 0.6 ? 3 : 2, owner);
    }
    blast(x, y, z, radius * 1.7, power);
    finishOp(n, x, y, z, radius);
    return n;
  },

  // opts (optional): { owner, fire } — fire:true also ignites what the hit touches (arc lance, incendiaries)
  impact(x, y, z, dx, dy, dz, power, radius = 0.35, opts) {
    ctx.owner = (opts && opts.owner) || null; ctx.depth = 0;
    if (opts && opts.fire) ignite(x, y, z, radius + 0.6, 1, ctx.owner);
    const cx = x + dx * 0.2, cy = y + dy * 0.2, cz = z + dz * 0.2;
    const n = carveSphere(cx, cy, cz, radius, power, false, false);
    const nb = Math.min(cN, 3, bitRoom() > 200 ? 3 : 1);
    for (let s = 0; s < nb; s++) {
      const m = candM[s], sp = 3 + rnd() * 4;
      spawnBit(x - dx * 0.3, y - dy * 0.3, z - dz * 0.3, (-dx + (rnd() - 0.5) * 1.2) * sp, (-dy + rnd() * 0.8) * sp, (-dz + (rnd() - 0.5) * 1.2) * sp, m, 0.1 + rnd() * 0.14, 0, null);
    }
    finishOp(n, cx, cy, cz, radius);
    return n;
  },

  // Carve a cylinder along d; everything carved flies off along d as damaging debris.
  punch(x, y, z, dx, dy, dz, radius, depth, power, owner) {
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= l; dy /= l; dz /= l;
    ctx.owner = owner || null; ctx.depth = 0;
    const ex = x + dx * depth, ey = y + dy * depth, ez = z + dz * depth, pad = radius + VS;
    const i0 = Math.max(0, Math.floor((Math.min(x, ex) - pad) * INV)), i1 = Math.min(NX - 1, Math.floor((Math.max(x, ex) + pad) * INV));
    const j0 = Math.max(1, Math.floor((Math.min(y, ey) - pad) * INV)), j1 = Math.min(NY - 1, Math.floor((Math.max(y, ey) + pad) * INV));
    const k0 = Math.max(0, Math.floor((Math.min(z, ez) - pad) * INV)), k1 = Math.min(NZ - 1, Math.floor((Math.max(z, ez) + pad) * INV));
    const r2 = radius * radius; let n = 0, open = false, budget = Math.min(260, bitRoom() + 60);
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      const m = data[i + NX * (k + NZ * j)]; if (!m) continue;
      const px = (i + 0.5) * VS - x, py = (j + 0.5) * VS - y, pz = (k + 0.5) * VS - z;
      const t = px * dx + py * dy + pz * dz; if (t < -0.3 || t > depth) continue;
      if (px * px + py * py + pz * pz - t * t > r2) continue;
      const st = STRENGTH[m]; if (st === 255 || st >= power) continue;
      rm(i, j, k); n++; tally[m]++;
      if (j >= GROUND_J - 1 && !B.at[i + NX * k]) open = true;
      if (budget-- > 0 || rnd() < 0.15) {
        const sp = 15 + rnd() * 11, g = GLASS[m];
        spawnBit(x + px, y + py, z + pz, dx * sp + (rnd() - 0.5) * 5, dy * sp + 1 + rnd() * 3.5, dz * sp + (rnd() - 0.5) * 5, m, g ? 0.2 : rnd() < 0.7 ? 0.5 : 0.3, g ? 0 : 3, owner || null);
      }
    }
    if (n) queueCheck(i0, j0, k0, i1, j1, k1, ctx.owner, x, y, z, open);
    blast(x + dx * depth * 0.5, y + dy * depth * 0.5, z + dz * depth * 0.5, radius + 1.5, power * 0.6);
    finishOp(n, x + dx * depth * 0.5, y + dy * depth * 0.5, z + dz * depth * 0.5, radius);
    return n;
  },

  carveBox(x0, y0, z0, x1, y1, z1, power, toDebris = true) {
    ctx.depth = 0; ctx.owner = null;
    const i0 = Math.max(0, Math.floor(Math.min(x0, x1) * INV)), i1 = Math.min(NX - 1, Math.floor(Math.max(x0, x1) * INV - 1e-4));
    const j0 = Math.max(1, Math.floor(Math.min(y0, y1) * INV)), j1 = Math.min(NY - 1, Math.floor(Math.max(y0, y1) * INV - 1e-4));
    const k0 = Math.max(0, Math.floor(Math.min(z0, z1) * INV)), k1 = Math.min(NZ - 1, Math.floor(Math.max(z0, z1) * INV - 1e-4));
    let n = 0, open = false, budget = toDebris ? Math.min(36, bitRoom()) : 0;
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const row = NX * (k + NZ * j);
      for (let i = i0; i <= i1; i++) {
        const m = data[row + i]; if (!m) continue;
        const st = STRENGTH[m]; if (st === 255 || st >= power) continue;
        rm(i, j, k); n++; tally[m]++;
        if (j >= GROUND_J - 1 && !B.at[i + NX * k]) open = true;
        if (toDebris && (budget-- > 0 || rnd() < 0.05)) { const g = GLASS[m]; spawnBit((i + 0.5) * VS, (j + 0.5) * VS, (k + 0.5) * VS, (rnd() - 0.5) * 5, 1 + rnd() * 3, (rnd() - 0.5) * 5, m, g ? 0.2 : rnd() < 0.5 ? 0.5 : 0.3, g ? 0 : 1, null); }
      }
    }
    const mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5, mz = (z0 + z1) * 0.5;
    if (n) queueCheck(i0, j0, k0, i1, j1, k1, ctx.owner, mx, my, mz, open);
    finishOp(n, mx, my, mz, Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0)) * 0.5);
    return n;
  },

  // Cosmetic debris (wrecks): { count, colors:[hex…], speed, size, up }
  burst(x, y, z, o = {}) {
    const count = Math.min(o.count || 12, bitRoom() + 20), cols = o.colors && o.colors.length ? o.colors : [0x555555], sp = o.speed || 8, size = o.size || 0.35, up = o.up == null ? 0.6 : o.up;
    for (let n = 0; n < count; n++) {
      _c.setHex(cols[(rnd() * cols.length) | 0]);
      const a = rnd() * 6.283, e = rnd(), s = sp * (0.4 + 0.6 * rnd()), h = Math.sqrt(1 - e * e * 0.6);
      spawnBitRGB(x + (rnd() - 0.5) * 0.6, y + (rnd() - 0.5) * 0.6, z + (rnd() - 0.5) * 0.6, Math.cos(a) * h * s, (e * 0.8 + up) * s, Math.sin(a) * h * s, _c.r, _c.g, _c.b, size * (0.6 + 0.8 * rnd()));
    }
  },

  // ---- fire -------------------------------------------------------------------------------
  // Set flammable voxels within `radius` alight (intensity 0..1 = chance per voxel). Returns the number of new burning cells.
  ignite(x, y, z, radius = 1, intensity = 1, owner = null) { return ignite(x, y, z, radius, intensity, owner); },
  // Burning fuel on any surface for `dur` seconds (wrecks, tankers).
  burnPool(x, y, z, radius = 3, dur = 8, owner = null) { return burnPool(x, y, z, radius, dur, owner); },

  // ---- grab / throw ---------------------------------------------------------------------
  grabChunk(x, y, z, r) {
    const R = Math.max(1, Math.min(14, Math.ceil(r * INV))), ci = Math.floor(x * INV), cj = Math.floor(y * INV), ck = Math.floor(z * INV);
    // nearest grabbable voxel within 1.5 m
    let si = -1, sj = 0, sk = 0, bd = 1e9;
    for (let j = cj - 3; j <= cj + 3; j++) for (let k = ck - 3; k <= ck + 3; k++) for (let i = ci - 3; i <= ci + 3; i++) {
      if (j < GROUND_J || j >= NY || i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1) continue;
      const m = data[i + NX * (k + NZ * j)]; if (!m || STRENGTH[m] === 255) continue;
      const d = (i - ci) * (i - ci) + (j - cj) * (j - cj) + (k - ck) * (k - ck); if (d < bd) { bd = d; si = i; sj = j; sk = k; }
    }
    if (si < 0) return null;
    // breadth-first flood, nearest first, inside the sphere
    const S = 2 * R + 1, vis = grabVis.length >= S * S * S ? grabVis : (grabVis = new Uint8Array(S * S * S));
    vis.fill(0, 0, S * S * S);
    const MAXN = 700, R2 = R * R; let head = 0, tail = 0;
    const push = (i, j, k) => {
      if (j < GROUND_J || j >= NY || i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1) return;
      const a = i - si, b = j - sj, c = k - sk; if (a * a + b * b + c * c > R2) return;
      const v = (a + R) + S * ((c + R) + S * (b + R)); if (vis[v]) return; vis[v] = 1;
      const m = data[i + NX * (k + NZ * j)]; if (!m || STRENGTH[m] === 255 || tail >= MAXN) return;
      grabQ[tail * 3] = i; grabQ[tail * 3 + 1] = j; grabQ[tail * 3 + 2] = k; tail++;
    };
    push(si, sj, sk);
    while (head < tail) { const i = grabQ[head * 3], j = grabQ[head * 3 + 1], k = grabQ[head * 3 + 2]; head++; push(i + 1, j, k); push(i - 1, j, k); push(i, j + 1, k); push(i, j - 1, k); push(i, j, k + 1); push(i, j, k - 1); }
    if (!tail) return null;
    bld.n = 0; ctx.noBarrel = true; ctx.owner = null;
    let i0 = 1e9, j0 = 1e9, k0 = 1e9, i1 = -1, j1 = -1, k1 = -1, open = false;
    for (let q = 0; q < tail; q++) {
      const i = grabQ[q * 3], j = grabQ[q * 3 + 1], k = grabQ[q * 3 + 2], m = rm(i, j, k);
      if (m) bldPush(i, j, k, m);
      if (!B.at[i + NX * k]) open = true;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k;
    }
    ctx.noBarrel = false;
    const b = makeBody(null);
    queueCheck(i0, j0, k0, i1, j1, k1, null, x, y, z, open); flush();
    if (!b) return null;
    b.mesh.matrixAutoUpdate = true; b.mesh.position.set(b.px, b.py, b.pz);
    const chunk = { _key: 0, object: b.mesh, mass: b.mass, size: Math.max(i1 - i0 + 1, j1 - j0 + 1, k1 - k0 + 1) * VS, voxels: b.n, _body: b };
    held.add(chunk);
    return chunk;
  },
  releaseChunk(chunk, pos, vel, owner) {
    if (!chunk || !chunk._body || !held.has(chunk)) return;
    held.delete(chunk);
    const b = chunk._body, m = b.mesh; chunk._body = null;
    m.getWorldQuaternion(_q); m.removeFromParent(); m.matrixAutoUpdate = false; m.scale.set(1, 1, 1);
    b.px = pos.x; b.py = pos.y; b.pz = pos.z; b.vx = vel.x; b.vy = vel.y; b.vz = vel.z;
    b.qx = _q.x; b.qy = _q.y; b.qz = _q.z; b.qw = _q.w;
    b.wx = (rnd() - 0.5) * 5; b.wy = (rnd() - 0.5) * 3; b.wz = (rnd() - 0.5) * 5;
    b.owner = owner || null; b.thrown = true; b.age = 0;
    ensureRoom(1); activate(b);
  },
  // Drop a held chunk without throwing it (e.g. the holder died).
  dropChunk(chunk) { if (chunk && chunk._body && held.has(chunk)) { const p = new THREE.Vector3(); chunk.object.getWorldPosition(p); this.releaseChunk(chunk, p, new THREE.Vector3(0, 0, 0), null); } },

  // ---- frame ----------------------------------------------------------------------------
  update(dt) {
    if (dt <= 0) return;
    const t0 = performance.now();
    // barrel chain
    for (let n = bq.n - 1; n >= 0; n--) {
      if (G.time < bq.t[n]) continue;
      const x = bq.x[n], y = bq.y[n], z = bq.z[n], owner = bq.owner[n], depth = bq.depth[n], pm = bq.mat[n], ph = bq.hop[n];
      const l = --bq.n; bq.x[n] = bq.x[l]; bq.y[n] = bq.y[l]; bq.z[n] = bq.z[l]; bq.t[n] = bq.t[l]; bq.depth[n] = bq.depth[l]; bq.mat[n] = bq.mat[l]; bq.hop[n] = bq.hop[l]; bq.owner[n] = bq.owner[l]; bq.owner[l] = null;
      ctx.depth = depth; ctx.owner = owner;
      if (pm === GAS && GAS) {
        if (ph) { const i = Math.floor(x * INV), j = Math.floor(y * INV), k = Math.floor(z * INV); if (data[i + NX * (k + NZ * j)] !== GAS) { ctx.depth = 0; continue; } ctx.noBarrel = true; rm(i, j, k); ctx.noBarrel = false; }
        gasBlast(x, y, z, owner, depth);
      } else if (pm === FUEL && FUEL) fuelBlast(x, y, z, owner);
      else { noteBarrelBlast(x, y, z); chainBoom(x, y, z, { radius: 2.8, power: 112, damage: 85, owner, kind: 'grenade' }); ignite(x, y, z, 3.2, 0.5, owner); }
      ctx.depth = 0;
    }
    const busy = stats.bodies > 0;
    const t1 = performance.now();
    clock.det = this.deterministic || !!(G.net && G.net.online); clock.acc = 0; clock.lim = busy ? 14 : 22;
    stepStruct(t0 + (busy ? 1.6 : 2.6));
    const t2 = performance.now();
    updateFire(dt);
    updateBits(dt);
    const t3 = performance.now();
    clock.acc = 0; clock.lim = 6;
    updateBodies(dt, t0 + 3.2);
    flush();
    const t4 = performance.now(), pf = stats.prof;
    if (t1 - t0 > pf[0]) pf[0] = t1 - t0; if (t2 - t1 > pf[1]) pf[1] = t2 - t1; if (t3 - t2 > pf[2]) pf[2] = t3 - t2; if (t4 - t3 > pf[3]) pf[3] = t4 - t3;
    // levelled buildings
    if ((levelT -= dt) <= 0) {
      levelT = 0.4;
      for (let n = 0; n < B.n; n++) if (!B.done[n] && B.vox[n] > 0 && B.lost[n] > 0.7 * B.vox[n]) {
        B.done[n] = 1; const b = B.list[n]; b.alive = false; G.state.stats.buildingsLevelled++;
        bus.emit('building:levelled', { id: b.id, name: b.name });
      }
    }
    const ms = performance.now() - t0;
    msAcc += ms; if (++msN >= 30) { stats.ms = msAcc / msN; msAcc = 0; msN = 0; }
    if (ms > stats.msMax) stats.msMax = ms;
  },
};
let grabVis = new Uint8Array(1), grabQ = new Int16Array(3 * 700);

// ============================================================================
// Co-op wire layer (CONTRACT-D). Costs one property test per call when `tap` is null.
// ============================================================================
const raw = { explode: destruct.explode, impact: destruct.impact, punch: destruct.punch, carveBox: destruct.carveBox, ignite: destruct.ignite, burnPool: destruct.burnPool, grabChunk: destruct.grabChunk, releaseChunk: destruct.releaseChunk };
let muted = false;
const remoteChunks = new Map();                  // grab seed -> chunk held on behalf of a remote peer
const newSeed = () => ((Math.random() * 4294967296) >>> 0) || 1;
const oid = e => (e ? (e.netId != null ? e.netId : e.id) : 0) || 0;
function ownerOf(id) {
  if (!id) return null;
  const n = G.net; if (n && n.entById) { const e = n.entById(id); if (e) return e; }
  const L = G.ents.list; for (let q = 0; q < L.length; q++) if ((L[q].netId != null ? L[q].netId : L[q].id) === id) return L[q];
  return null;
}
destruct.tap = null;
// host fire -> clients: voxels consumed / charred this tick go out as one 'burn' op [i,j,k,mat, ...]
hooks.burnTap = (list, n) => { if (destruct.tap && !muted) { const sd = newSeed(); destruct.tap('burn', Array.from(list.subarray(0, n * 4)), sd); } };
// Compact view of every live cell and jet (REUSED buffer: copy or send before the next call). See destruct_fire.js for the layout.
destruct.serializeFires = serializeFires;
// Make this peer's fires / jets match a host snapshot exactly (emits fire:start / fire:out / gas:jet for the differences).
destruct.applyFires = applyFires;
destruct.deterministic = false;        // true: work-unit time slicing even offline (tests); always on while G.net.online
destruct.explode = function (x, y, z, radius, power, opts) {
  if (!this.tap || muted || (opts && opts._chain)) return raw.explode.call(this, x, y, z, radius, power, opts);
  const sd = newSeed(); reseed(sd);
  const n = raw.explode.call(this, x, y, z, radius, power, opts);
  this.tap('explode', [x, y, z, radius, power, oid(opts && opts.owner)], sd); return n;
};
destruct.impact = function (x, y, z, dx, dy, dz, power, radius = 0.35, opts) {
  if (!this.tap || muted) return raw.impact.call(this, x, y, z, dx, dy, dz, power, radius, opts);
  const was = seedState(), sd = newSeed(); reseed(sd);
  const n = raw.impact.call(this, x, y, z, dx, dy, dz, power, radius, opts);
  if (n || (opts && opts.fire)) this.tap('impact', [x, y, z, dx, dy, dz, power, radius, oid(opts && opts.owner), opts && opts.fire ? 1 : 0], sd); else seedRestore(was);
  return n;
};
destruct.punch = function (x, y, z, dx, dy, dz, radius, depth, power, owner) {
  if (!this.tap || muted) return raw.punch.call(this, x, y, z, dx, dy, dz, radius, depth, power, owner);
  const was = seedState(), sd = newSeed(); reseed(sd);
  const n = raw.punch.call(this, x, y, z, dx, dy, dz, radius, depth, power, owner);
  if (n) this.tap('punch', [x, y, z, dx, dy, dz, radius, depth, power, oid(owner)], sd); else seedRestore(was);
  return n;
};
destruct.carveBox = function (x0, y0, z0, x1, y1, z1, power, toDebris = true) {
  if (!this.tap || muted) return raw.carveBox.call(this, x0, y0, z0, x1, y1, z1, power, toDebris);
  const was = seedState(), sd = newSeed(); reseed(sd);
  const n = raw.carveBox.call(this, x0, y0, z0, x1, y1, z1, power, toDebris);
  if (n) this.tap('carveBox', [x0, y0, z0, x1, y1, z1, power, toDebris ? 1 : 0], sd); else seedRestore(was);
  return n;
};
destruct.ignite = function (x, y, z, radius = 1, intensity = 1, owner = null) {
  if (!this.tap || muted) return raw.ignite.call(this, x, y, z, radius, intensity, owner);
  const was = seedState(), sd = newSeed(); reseed(sd);
  const n = raw.ignite.call(this, x, y, z, radius, intensity, owner);
  if (n || fireClient()) this.tap('ignite', [x, y, z, radius, intensity, oid(owner)], sd); else seedRestore(was);       // a client cannot light cells itself: the host decides
  return n;
};
destruct.burnPool = function (x, y, z, radius = 3, dur = 8, owner = null) {
  if (!this.tap || muted) return raw.burnPool.call(this, x, y, z, radius, dur, owner);
  const was = seedState(), sd = newSeed(); reseed(sd);
  const n = raw.burnPool.call(this, x, y, z, radius, dur, owner);
  if (n || fireClient()) this.tap('burnPool', [x, y, z, radius, dur, oid(owner)], sd); else seedRestore(was);       // a client cannot light cells itself: the host decides
  return n;
};
destruct.grabChunk = function (x, y, z, r) {
  const ch = raw.grabChunk.call(this, x, y, z, r);
  if (ch && this.tap && !muted) { ch._key = newSeed(); this.tap('grab', [x, y, z, r], ch._key); }
  return ch;
};
destruct.releaseChunk = function (chunk, pos, vel, owner) {
  if (!this.tap || muted || !chunk || !chunk._body) return raw.releaseChunk.call(this, chunk, pos, vel, owner);
  const sd = newSeed(); reseed(sd);
  chunk.object.getWorldQuaternion(_q);
  const a = [chunk._key, pos.x, pos.y, pos.z, vel.x, vel.y, vel.z, _q.x, _q.y, _q.z, _q.w, oid(owner)];
  raw.releaseChunk.call(this, chunk, pos, vel, owner);
  this.tap('release', a, sd);
};
const _rp = new THREE.Vector3(), _rv = new THREE.Vector3();
// Run an operation reported by another peer. Never re-tapped; its randomness comes from `seed`.
destruct.applyRemote = function (op, a, seed) {
  const was = muted; muted = true; if (op !== 'grab' && op !== 'burn') reseed(seed);
  try {
    switch (op) {
      case 'explode': return raw.explode.call(this, a[0], a[1], a[2], a[3], a[4], { owner: ownerOf(a[5]) });
      case 'impact': return raw.impact.call(this, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], { owner: ownerOf(a[8]), fire: !!a[9] });
      case 'punch': return raw.punch.call(this, a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], ownerOf(a[9]));
      case 'carveBox': return raw.carveBox.call(this, a[0], a[1], a[2], a[3], a[4], a[5], a[6], !!a[7]);
      case 'ignite': return raw.ignite.call(this, a[0], a[1], a[2], a[3], a[4], ownerOf(a[5]));
      case 'burnPool': return raw.burnPool.call(this, a[0], a[1], a[2], a[3], a[4], ownerOf(a[5]));
      case 'grab': { const ch = raw.grabChunk.call(this, a[0], a[1], a[2], a[3]); if (ch) { ch._key = seed; remoteChunks.set(seed, ch); if (remoteChunks.size > 16) { const k = remoteChunks.keys().next().value, old = remoteChunks.get(k); remoteChunks.delete(k); _rp.set(old._body.px, old._body.py, old._body.pz); _rv.set(0, 0, 0); raw.releaseChunk.call(this, old, _rp, _rv, null); } } return ch ? ch.voxels : 0; }
      case 'burn': applyBurn(a); flush(); return a.length >> 2;
      case 'release': { const ch = remoteChunks.get(a[0]); if (!ch) return 0; remoteChunks.delete(a[0]); ch.object.quaternion.set(a[7], a[8], a[9], a[10]); _rp.set(a[1], a[2], a[3]); _rv.set(a[4], a[5], a[6]); raw.releaseChunk.call(this, ch, _rp, _rv, ownerOf(a[11])); return 1; }
    }
  } finally { muted = was; }
  return 0;
};
// ---- chunk checksums / healing. Chunk id c = ci + CX * (ck + CZ * cj), 32 voxels a side. ----
destruct.chunkHash = function (c) {
  const ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0;
  let h = 0x811c9dc5 | 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) {
    let o = ci * 32 + NX * (k + NZ * j);
    for (let e = o + 32; o < e; o++) h = Math.imul(h ^ data[o], 0x01000193);
  }
  return h >>> 0;
};
const _recent = [];
destruct.recentChunks = function (seconds = 4) { _recent.length = 0; const t = G.time - seconds; for (let c = 0; c < editT.length; c++) if (editT[c] >= t) _recent.push(c); return _recent; };
const _enc = new Uint8Array(65536 + 8);
// RLE: pairs of [material, runLength - 1], voxels in j, k, i order.
destruct.encodeChunk = function (c) {
  const ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0;
  let n = 0, cur = -1, run = 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) {
    let o = ci * 32 + NX * (k + NZ * j);
    for (let e = o + 32; o < e; o++) { const m = data[o]; if (m === cur && run < 256) run++; else { if (run) { _enc[n++] = cur; _enc[n++] = run - 1; } cur = m; run = 1; } }
  }
  if (run) { _enc[n++] = cur; _enc[n++] = run - 1; }
  return _enc.slice(0, n);
};
// Overwrite a chunk from a peer's copy. Returns the number of voxels that differed.
destruct.applyChunk = function (c, bytes) {
  const ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0, g = G.grid;
  let p = 0, m = 0, run = 0, changed = 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) for (let i = ci * 32; i < ci * 32 + 32; i++) {
    if (!run) { if (p + 1 >= bytes.length) return changed; m = bytes[p]; run = bytes[p + 1] + 1; p += 2; }
    run--;
    if (data[i + NX * (k + NZ * j)] !== m && g.set(i, j, k, m)) changed++;
  }
  if (changed) {
    editT[c] = G.time;
    purgeChunk(ci * 32, cj * 32, ck * 32);
    queueCheck(ci * 32, cj * 32, ck * 32, ci * 32 + 31, cj * 32 + 31, ck * 32 + 31, null, (ci * 32 + 16) * VS, (cj * 32 + 16) * VS, (ck * 32 + 16) * VS, true);
  }
  return changed;
};
export default destruct;
