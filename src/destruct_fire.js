// ============================================================================
// KILOTON — destruct_fire.js   OWNER: DESTRUCT
// Fire and gas. A sparse, capped set of burning cells: each burns for a few
// seconds, spreads to flammable neighbours, then chars or consumes its voxel
// (which can drop whatever stood on it). Gas mains vent a burning jet and chain
// along the pipe run; fuel tanks go up as one blast and leave a burning pool.
// ============================================================================
import { G, VS, NX, NY, NZ, GROUND_J, bus } from './core.js';
import { M, MAT } from './materials.js';
import { data, INV, LAYER, CHARRED, BARREL, GAS, FUEL, EXPL, FLAM, ctx, stats, rm, put, B, noteBarrelBlast, scheduleBlast, canHurt, fireClient, hsh, hooks } from './destruct_base.js';
import { queueCheck } from './destruct_struct.js';

export const FTUNE = {
  cap: 320,              // burning cells
  damage: 22,            // hp / s for an entity standing in flames (scaled by heat)
  spread: 1,             // global spread multiplier
  maxGen: 36,            // a fire dies out this many voxel-to-voxel hops from where it was lit
  jetTime: 6,            // s a broken gas main vents
  gasHop: 12,            // voxels between successive blasts along a pipe run
  gasDelay: 0.32,        // s between hops
  gasMaxHops: 10,        // the break travels this many hops (~60 m) each way from where the main was hit
};
const CAP = 320;
// fire has its own random stream: only the host simulates it, so it must not disturb the stream the peers share
let fseed = 0x1f123bb5 | 0;
function frnd() { fseed ^= fseed << 13; fseed ^= fseed >>> 17; fseed ^= fseed << 5; return (fseed >>> 0) / 4294967296; }
// per material: burn seconds (min, extra), spread chance, what is left (0 removed, 1 charred or removed, 2 fuse: breaks -> chain blast)
const BMIN = new Float32Array(256), BVAR = new Float32Array(256), SPR = new Float32Array(256), LEFT = new Uint8Array(256);
for (const m of MAT) if (m && m.flammable) {
  const n = m.name, id = m.id;
  if (m.explosive) { BMIN[id] = 0.45; BVAR[id] = 0.5; SPR[id] = 0.9; LEFT[id] = 2; }
  else if (n === 'foliage' || n.startsWith('awning')) { BMIN[id] = 1.3; BVAR[id] = 1.4; SPR[id] = 0.65; LEFT[id] = 0; }
  else if (n === 'furniture' || n === 'crate') { BMIN[id] = 3.5; BVAR[id] = 3; SPR[id] = 0.55; LEFT[id] = 0; }
  else if (n === 'trunk') { BMIN[id] = 5; BVAR[id] = 3; SPR[id] = 0.3; LEFT[id] = 1; }
  else { BMIN[id] = 4.5; BVAR[id] = 3; SPR[id] = 0.42; LEFT[id] = 1; }
}
const IGN = new Uint8Array(256); for (let m = 0; m < 256; m++) IGN[m] = FLAM[m] && m !== GAS ? 1 : 0;   // a steel gas main does not catch fire: it has to be broken
const gi = new Int32Array(CAP), kind = new Uint8Array(CAP), mat = new Uint8Array(CAP), gen = new Uint8Array(CAP);
const life = new Float32Array(CAP), age = new Float32Array(CAP), tick = new Float32Array(CAP);
const owner = new Array(CAP).fill(null);
export const fires = { count: 0, x: new Float32Array(CAP), y: new Float32Array(CAP), z: new Float32Array(CAP), heat: new Float32Array(CAP) };
const NJ = 10;
export const jets = { count: 0, x: new Float32Array(NJ), y: new Float32Array(NJ), z: new Float32Array(NJ), t: new Float32Array(NJ) };
const jNext = new Float32Array(NJ), jBoom = new Float32Array(NJ), jOwner = new Array(NJ).fill(null);
const burning = new Set();
let lastStart = -9, lastOut = -9, dmgT = 0;

let fromNet = false;
function add(i, j, k, kd, lf, own, gn = 0) {
  if (!fromNet && fireClient()) return false;
  if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1 || j < 1 || j >= NY) return false;
  const g = i + NX * (k + NZ * j);
  if (burning.has(g)) { if (kd === 1) for (let n = 0; n < fires.count; n++) if (gi[n] === g) { if (life[n] < lf) life[n] = lf; break; } return false; }
  const n = fires.count; if (n >= FTUNE.cap || n >= CAP) return false;
  fires.count = n + 1; burning.add(g);
  gi[n] = g; kind[n] = kd; gen[n] = gn; mat[n] = data[g]; life[n] = lf; age[n] = 0; tick[n] = G.time + 0.15 + frnd() * 0.3; owner[n] = own || null;
  fires.x[n] = (i + 0.5) * VS; fires.y[n] = (j + 0.5) * VS; fires.z[n] = (k + 0.5) * VS; fires.heat[n] = 0.1;
  if (G.time - lastStart > 0.35) { lastStart = G.time; bus.emit('fire:start', { x: fires.x[n], y: fires.y[n], z: fires.z[n] }); }
  return true;
}
function drop(n) {
  burning.delete(gi[n]);
  const l = --fires.count;
  if (n !== l) { stamp[n] = stamp[l]; gi[n] = gi[l]; kind[n] = kind[l]; gen[n] = gen[l]; mat[n] = mat[l]; life[n] = life[l]; age[n] = age[l]; tick[n] = tick[l]; owner[n] = owner[l]; fires.x[n] = fires.x[l]; fires.y[n] = fires.y[l]; fires.z[n] = fires.z[l]; fires.heat[n] = fires.heat[l]; }
  owner[l] = null;
  if (l === 0 && G.time - lastOut > 0.5) { lastOut = G.time; bus.emit('fire:out', { x: fires.x[0], y: fires.y[0], z: fires.z[0] }); }
}
// Set a flammable voxel alight (used by explosions). Returns true if a new cell started.
export function igniteVoxel(i, j, k, own) {
  const m = data[i + NX * (k + NZ * j)]; if (!IGN[m]) return false;
  return add(i, j, k, 0, BMIN[m] + frnd() * BVAR[m], own);
}
// Ignite flammable voxels in a sphere. intensity 0..1 = chance per voxel. Returns the number of new burning cells.
export function ignite(x, y, z, radius, intensity = 1, own = null) {
  const r = Math.max(0.3, radius) * INV, ci = x * INV, cj = y * INV, ck = z * INV, r2 = r * r;
  const i0 = Math.max(1, Math.floor(ci - r)), i1 = Math.min(NX - 2, Math.floor(ci + r)), j0 = Math.max(1, Math.floor(cj - r)), j1 = Math.min(NY - 1, Math.floor(cj + r)), k0 = Math.max(1, Math.floor(ck - r)), k1 = Math.min(NZ - 2, Math.floor(ck + r));
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
    const row = NX * (k + NZ * j);
    for (let i = i0; i <= i1; i++) {
      const m = data[row + i]; if (!IGN[m]) continue;
      const dx = i + 0.5 - ci, dy = j + 0.5 - cj, dz = k + 0.5 - ck; if (dx * dx + dy * dy + dz * dz > r2) continue;
      if (frnd() < intensity && add(i, j, k, 0, BMIN[m] + frnd() * BVAR[m], own)) n++;
    }
  }
  return n;
}
// A pool of burning fuel on whatever surface is there (does not need flammable voxels).
export function burnPool(x, y, z, radius, dur = 8, own = null) {
  const r = radius * INV, ci = Math.floor(x * INV), ck = Math.floor(z * INV), cj = Math.min(NY - 2, Math.floor(y * INV) + 4), R = Math.ceil(r);
  let n = 0;
  for (let dk = -R; dk <= R; dk++) for (let di = -R; di <= R; di++) {
    const d2 = di * di + dk * dk; if (d2 > r * r || frnd() > 0.5) continue;
    const i = ci + di, k = ck + dk; if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1) continue;
    let j = cj, o = i + NX * (k + NZ * j);
    while (j > 1 && !data[o - LAYER] && cj - j < 12) { j--; o -= LAYER; }
    if (data[o] || !data[o - LAYER]) continue;
    if (add(i, j, k, 1, dur * (0.6 + 0.4 * frnd()) * (1 - 0.4 * Math.sqrt(d2) / (r + 0.1)), own)) n++;
  }
  return n;
}

// A boom that follows from an earlier operation (chains, jets). Every peer runs it, so online it must only
// hurt locally owned entities: the world part goes through G.boom with no damage, the damage is applied here.
export function chainBoom(x, y, z, o) {
  o._chain = true;
  const n = G.net;
  if (!(n && n.online && n.localOwns) || !o.damage) { G.boom(x, y, z, o); return; }
  const dmg = o.damage, r = (o.dmgRadius || o.radius * 1.6); o.damage = 0;
  G.boom(x, y, z, o);
  const L = G.ents.list;
  for (let q = L.length - 1; q >= 0; q--) {
    const e = L[q]; if (!e.alive || !n.localOwns(e)) continue;
    const cy = Math.min(Math.max(y, e.pos.y), e.pos.y + e.height), dx = e.pos.x - x, dy = cy - y, dz = e.pos.z - z;
    const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - e.radius);
    if (d < r) G.ents.damage(e, dmg * (1 - 0.75 * d / r), { type: 'explosion', src: o.owner || null, x, y, z, dx, dy: dy + 0.5, dz });
  }
}

// ---- gas mains -------------------------------------------------------------------------------
const seen = new Set(); const bfsG = new Int32Array(512), bfsD = new Uint8Array(512);
function isGas(g) { return g > 0 && g < data.length && data[g] === GAS; }
// The main at (x,y,z) has broken: blast, start a venting jet, and send the break along the run.
export function gasBlast(x, y, z, own, depth) {
  const i = Math.floor(x * INV), j = Math.floor(y * INV), k = Math.floor(z * INV), g0 = i + NX * (k + NZ * j);
  // walk the pipe run (26-connected so diagonal steps and risers still chain) to find the next break points
  seen.clear(); seen.add(g0); let head = 0, tail = 0; bfsG[tail] = g0; bfsD[tail++] = 0;
  // the blast that broke the main usually took its neighbours too: pick the run up again within 2.5 m
  for (let sr = 1; sr <= 5; sr++) for (let dj = -sr; dj <= sr; dj++) for (let dk = -sr; dk <= sr; dk++) for (let di = -sr; di <= sr; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj), Math.abs(dk)) !== sr) continue;
    const q = g0 + di + NX * dk + LAYER * dj;
    if (!isGas(q) || seen.has(q) || tail >= 500) continue;
    let adj = false;                       // only the nearest voxel of each stub seeds the walk
    for (let a = -1; a <= 1 && !adj; a++) for (let b = -1; b <= 1 && !adj; b++) for (let c = -1; c <= 1; c++) if (seen.has(q + c + NX * b + LAYER * a) && q + c + NX * b + LAYER * a !== g0) { adj = true; break; }
    if (!adj) { seen.add(q); bfsG[tail] = q; bfsD[tail++] = sr; }
  }
  const HOP = FTUNE.gasHop; let hops = 0;
  while (head < tail) {
    const g = bfsG[head], d = bfsD[head++];
    if (d >= HOP) {
      if (hops < 4 && depth < FTUNE.gasMaxHops) { const jj = (g / LAYER) | 0, r = g - jj * LAYER, kk = (r / NX) | 0; if (scheduleBlast((r - kk * NX + 0.5) * VS, (jj + 0.5) * VS, (kk + 0.5) * VS, G.time + FTUNE.gasDelay * (0.8 + 0.4 * hsh(g, 3, 7)), GAS, depth + 1, own, 1)) hops++; }
      continue;
    }
    for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      const q = g + di + NX * dk + LAYER * dj;
      if (q === g || seen.has(q) || !isGas(q) || tail >= 512) continue;
      // one branch per direction: skip voxels right next to an already queued hop
      seen.add(q); bfsG[tail] = q; bfsD[tail++] = d + 1;
    }
  }
  noteBarrelBlast(x, y, z);
  chainBoom(x, y, z, { radius: 2.3, power: 105, damage: 60, owner: own, kind: 'grenade' });
  // jet: at the surface above the break
  let jy = j, o = g0; while (jy < NY - 1 && data[o] && jy - j < 6) { jy++; o += LAYER; }
  if (fireClient()) return;                       // the host's jets arrive through applyFires
  let n = jets.count; if (n >= NJ) { n = 0; for (let q = 1; q < NJ; q++) if (jets.t[q] < jets.t[n]) n = q; } else jets.count++;
  jets.x[n] = x; jets.y[n] = jy * VS; jets.z[n] = z; jets.t[n] = FTUNE.jetTime * (0.8 + 0.4 * frnd()); jNext[n] = 0; jBoom[n] = 0.9 + frnd() * 0.6; jOwner[n] = own || null;
  bus.emit('gas:jet', { x, y: jy * VS, z, dur: jets.t[n] });
}
// A fuel tank has been breached at (x,y,z): the whole connected tank goes up at once and leaves a burning pool.
const tankG = new Int32Array(900);
export function fuelBlast(x, y, z, own) {
  const i = Math.floor(x * INV), j = Math.floor(y * INV), k = Math.floor(z * INV), g0 = i + NX * (k + NZ * j);
  seen.clear(); seen.add(g0); let head = 0, tail = 0; tankG[tail++] = g0;
  let sx = x, sy = y, sz = z, n = 1;
  ctx.noBarrel = true; ctx.owner = own;
  while (head < tail) {
    const g = tankG[head++];
    for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) for (let di = -1; di <= 1; di++) {
      const q = g + di + NX * dk + LAYER * dj;
      if (q <= LAYER || q >= data.length || seen.has(q) || data[q] !== FUEL || tail >= 900) continue;
      seen.add(q); tankG[tail++] = q;
      const jj = (q / LAYER) | 0, r = q - jj * LAYER, kk = (r / NX) | 0, ii = r - kk * NX;
      rm(ii, jj, kk); sx += (ii + 0.5) * VS; sy += (jj + 0.5) * VS; sz += (kk + 0.5) * VS; n++;
    }
  }
  ctx.noBarrel = false;
  G.state.stats.voxelsDestroyed += n - 1;
  sx /= n; sy /= n; sz /= n;
  const R = Math.min(7.5, 3 + Math.cbrt(n) * 0.5);
  noteBarrelBlast(sx, sy, sz);
  chainBoom(sx, sy, sz, { radius: R, power: 150, damage: 120 + Math.min(120, n), owner: own, kind: 'shell' });
  burnPool(sx, sy, sz, R * 0.95, 9, own);
  ignite(sx, sy, sz, R * 1.3, 0.6, own);
}

// ---- frame -----------------------------------------------------------------------------------------
const DI = [1, -1, 0, 0, 0, 0, 0, 0], DJ = [0, 0, 1, -1, 0, 0, 1, 1], DK = [0, 0, 0, 0, 1, -1, 0, 0];
export function updateFire(dt) {
  const now = G.time;
  if (fireClient()) {            // display + damage only; cells and jets are set by applyFires
    for (let n = 0; n < jets.count; n++) jets.t[n] = Math.max(0.05, jets.t[n] - dt);
    for (let n = 0; n < fires.count; n++) { age[n] += dt; life[n] = Math.max(0.05, life[n] - dt); }
    fireDamage(dt); stats.fires = fires.count; return;
  }
  burnN = 0;
  // gas jets
  for (let n = jets.count - 1; n >= 0; n--) {
    jets.t[n] -= dt;
    if (jets.t[n] <= 0) { const l = --jets.count; jets.x[n] = jets.x[l]; jets.y[n] = jets.y[l]; jets.z[n] = jets.z[l]; jets.t[n] = jets.t[l]; jNext[n] = jNext[l]; jBoom[n] = jBoom[l]; jOwner[n] = jOwner[l]; jOwner[l] = null; continue; }
    if ((jNext[n] -= dt) <= 0) {
      jNext[n] = 0.3;
      const i = Math.floor(jets.x[n] * INV), k = Math.floor(jets.z[n] * INV); let j = Math.floor(jets.y[n] * INV);
      for (let h = 0; h < 7 && j + h < NY; h++) { if (data[i + NX * (k + NZ * (j + h))]) { if (h === 0) continue; break; } add(i, j + h, k, 1, 0.5, jOwner[n]); }
      ignite(jets.x[n], jets.y[n] + 1.2, jets.z[n], 1.8, 0.7, jOwner[n]);
    }
    if ((jBoom[n] -= dt) <= 0) {
      jBoom[n] = 1.1 + frnd() * 0.8;
      const o = { radius: 1.3, power: 58, damage: 28, owner: jOwner[n], kind: 'grenade' }, bx = jets.x[n] + (frnd() - 0.5), bz = jets.z[n] + (frnd() - 0.5);
      if (G.net && G.net.online) G.boom(bx, jets.y[n] + 0.4, bz, o);       // host: an ordinary boom, so it is tapped and replayed by clients
      else chainBoom(bx, jets.y[n] + 0.4, bz, o);
    }
  }
  // burning cells
  for (let n = fires.count - 1; n >= 0; n--) {
    const g = gi[n], kd = kind[n];
    if (kd === 0 ? data[g] !== mat[n] : (data[g] !== 0 || !data[g - LAYER] && life[n] > 0.6)) { drop(n); continue; }   // the voxel is gone / the pool lost its floor
    age[n] += dt; life[n] -= dt;
    fires.heat[n] = Math.min(1, age[n] * 2.5, life[n] * 1.5 + 0.15);
    const j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX;
    if (life[n] <= 0) {
      if (kd === 0) {
        const m = mat[n], lf = LEFT[m];
        ctx.owner = owner[n]; ctx.depth = 0;
        if (lf === 1 && frnd() < 0.55) { put(i, j, k, CHARRED); noteBurn(i, j, k, CHARRED); }
        else { noteBurn(i, j, k, 0); rm(i, j, k); G.state.stats.voxelsDestroyed++; queueCheck(i, j, k, i, j, k, owner[n], fires.x[n], fires.y[n], fires.z[n], !B.at[i + NX * k]); }
      }
      drop(n); continue;
    }
    if (now >= tick[n]) {
      tick[n] = now + 0.22 + frnd() * 0.3;
      // two tries per tick; heat radiates across gaps of up to 3 voxels (sparse furniture still carries a fire)
      for (let t = 0; t < 2; t++) {
        const d = (frnd() * 8) | 0; let ni = i, nj = j, nk = k, m = 0, p = 1;
        for (let s = 0; s < 4; s++) {
          ni += DI[d]; nj += DJ[d]; nk += DK[d];
          if (nj < 1 || nj >= NY || ni < 1 || nk < 1 || ni >= NX - 1 || nk >= NZ - 1) break;
          m = data[ni + NX * (nk + NZ * nj)]; if (m) break;
          p *= 0.62;
        }
        if (IGN[m] && gen[n] < FTUNE.maxGen && frnd() < SPR[m] * p * fires.heat[n] * FTUNE.spread * (1 - 0.6 * gen[n] / FTUNE.maxGen)) add(ni, nj, nk, 0, BMIN[m] + frnd() * BVAR[m], owner[n], gen[n] + 1);
      }
    }
  }
  if (burnN && hooks.burnTap) hooks.burnTap(burnL, burnN);
  fireDamage(dt);
  stats.fires = fires.count;
}
// voxels changed by burning this tick: i, j, k, new material (0 = removed)
const burnL = new Uint16Array(4 * 400); let burnN = 0;
function noteBurn(i, j, k, m) { if (burnN < 400) { const o = burnN++ * 4; burnL[o] = i; burnL[o + 1] = j; burnL[o + 2] = k; burnL[o + 3] = m; } }
function fireDamage(dt) {
  // entities in the flames
  if ((dmgT -= dt) <= 0 && fires.count) {
    dmgT = 0.25;
    const L = G.ents.list, fx = fires.x, fy = fires.y, fz = fires.z, nf = fires.count;
    for (let q = L.length - 1; q >= 0; q--) {
      const e = L[q]; if (!e.alive || e.airborne || !canHurt(e)) continue;
      const p = e.pos, rr = e.radius + 0.8; let heat = 0, src = null;
      for (let n = 0; n < nf; n++) {
        const dx = fx[n] - p.x; if (dx > rr || dx < -rr) continue;
        const dz = fz[n] - p.z; if (dz > rr || dz < -rr) continue;
        const dy = fy[n] - p.y; if (dy < -0.8 || dy > e.height + 0.5) continue;
        if (fires.heat[n] > heat) { heat = fires.heat[n]; src = owner[n]; }
      }
      if (heat > 0.2) G.ents.damage(e, FTUNE.damage * 0.25 * heat, { type: 'fire', src, x: p.x, y: p.y, z: p.z });
    }
  } else if (!fires.count) dmgT = 0;
}
// Apply a host 'burn' list on a client.
export function applyBurn(a) {
  for (let o = 0; o + 3 < a.length; o += 4) {
    const i = a[o], j = a[o + 1], k = a[o + 2], m = a[o + 3];
    if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1 || j < 1 || j >= NY) continue;
    const cur = data[i + NX * (k + NZ * j)]; if (cur === m || !cur) continue;
    if (m) put(i, j, k, m);
    else { rm(i, j, k); G.state.stats.voxelsDestroyed++; queueCheck(i, j, k, i, j, k, null, (i + 0.5) * VS, (j + 0.5) * VS, (k + 0.5) * VS, !B.at[i + NX * k]); }
  }
}
// ---- host -> client fire state ----------------------------------------------------------------
// Layout (little endian): u16 cells, u8 jets, u8 0; per cell 7 bytes: u16 i, u8 j | kind << 7, u16 k, u8 heat*255, u8 life*10 (s, max 25.5);
// per jet 7 bytes: u16 x*64, u16 y*64, u16 z*64, u8 t*10.   320 cells + 10 jets = 2314 bytes.
const wire = new Uint8Array(4 + CAP * 7 + NJ * 7), stamp = new Uint8Array(CAP), jStamp = new Uint8Array(NJ);
export function serializeFires() {
  const nc = fires.count, nj = jets.count; let p = 4;
  wire[0] = nc & 255; wire[1] = nc >> 8; wire[2] = nj; wire[3] = 0;
  for (let n = 0; n < nc; n++) {
    const g = gi[n], j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX;
    wire[p++] = i & 255; wire[p++] = i >> 8; wire[p++] = j | (kind[n] << 7); wire[p++] = k & 255; wire[p++] = k >> 8;
    wire[p++] = Math.max(0, Math.min(255, Math.round(fires.heat[n] * 255))); wire[p++] = Math.max(1, Math.min(255, Math.round(life[n] * 10)));
  }
  for (let n = 0; n < nj; n++) {
    const x = Math.round(jets.x[n] * 64), y = Math.round(jets.y[n] * 64), z = Math.round(jets.z[n] * 64);
    wire[p++] = x & 255; wire[p++] = x >> 8; wire[p++] = y & 255; wire[p++] = y >> 8; wire[p++] = z & 255; wire[p++] = z >> 8; wire[p++] = Math.max(1, Math.min(255, Math.round(jets.t[n] * 10)));
  }
  return wire.subarray(0, p);
}
export function applyFires(b) {
  if (!b || b.length < 4) return;
  const nc = Math.min(CAP, b[0] | (b[1] << 8)), nj = Math.min(NJ, b[2]); let p = 4;
  if (b.length < 4 + nc * 7 + nj * 7) return;
  stamp.fill(0, 0, fires.count);
  for (let c = 0, q = 4; c < nc; c++, q += 7) {            // pass 1: refresh the cells we already have
    const g = (b[q] | (b[q + 1] << 8)) + NX * ((b[q + 3] | (b[q + 4] << 8)) + NZ * (b[q + 2] & 127));
    if (!burning.has(g)) continue;
    for (let n = 0; n < fires.count; n++) if (gi[n] === g) { kind[n] = b[q + 2] >> 7; life[n] = b[q + 6] / 10; fires.heat[n] = b[q + 5] / 255; stamp[n] = 1; break; }
  }
  for (let n = fires.count - 1; n >= 0; n--) if (!stamp[n]) drop(n);      // gone on the host
  fromNet = true;
  for (let c = 0; c < nc; c++, p += 7) {                    // pass 2: new cells
    const i = b[p] | (b[p + 1] << 8), j = b[p + 2] & 127, k = b[p + 3] | (b[p + 4] << 8);
    if (burning.has(i + NX * (k + NZ * j))) continue;
    if (add(i, j, k, b[p + 2] >> 7, b[p + 6] / 10, null)) fires.heat[fires.count - 1] = b[p + 5] / 255;
  }
  fromNet = false;
  // jets: match by position
  jStamp.fill(0);
  const jp = p;
  for (let pass = 0; pass < 2; pass++) {       // pass 0: keep / refresh matching jets and drop the rest; pass 1: create the new ones
    p = jp;
    for (let c = 0; c < nj; c++, p += 7) {
      const x = (b[p] | (b[p + 1] << 8)) / 64, y = (b[p + 2] | (b[p + 3] << 8)) / 64, z = (b[p + 4] | (b[p + 5] << 8)) / 64, t = b[p + 6] / 10;
      if (pass === 0) {
        for (let q = 0; q < jets.count; q++) if (!jStamp[q] && Math.abs(jets.x[q] - x) < 0.1 && Math.abs(jets.y[q] - y) < 0.1 && Math.abs(jets.z[q] - z) < 0.1) { jets.t[q] = t; jStamp[q] = 1 + c; break; }
      } else {
        let have = false; for (let q = 0; q < jets.count; q++) if (jStamp[q] === 1 + c) { have = true; break; }
        if (have || jets.count >= NJ) continue;
        const n = jets.count++; jets.x[n] = x; jets.y[n] = y; jets.z[n] = z; jets.t[n] = t; jOwner[n] = null; jStamp[n] = 1 + c;
        bus.emit('gas:jet', { x, y, z, dur: t });
      }
    }
    if (pass === 0) for (let n = jets.count - 1; n >= 0; n--) if (!jStamp[n]) { const l = --jets.count; jets.x[n] = jets.x[l]; jets.y[n] = jets.y[l]; jets.z[n] = jets.z[l]; jets.t[n] = jets.t[l]; jStamp[n] = jStamp[l]; jStamp[l] = 0; }
  }
  stats.fires = fires.count;
}
export function resetFire() {
  fires.count = 0; jets.count = 0; burning.clear(); owner.fill(null); jOwner.fill(null); lastStart = lastOut = -9; dmgT = 0; stats.fires = 0;
}
