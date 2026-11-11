// ============================================================================
// KILOTON — destruct_base.js   OWNER: DESTRUCT
// Shared low-level pieces of the destruction module: fast grid writes with our
// own dirty-chunk bookkeeping, building loss accounting, barrel chain queue.
// ============================================================================
import { G, VS, NX, NY, NZ, CX, CY, CZ, GROUND_J } from './core.js';
import { grid } from './voxels.js';
import { M, COLOR, MAT, STRENGTH } from './materials.js';

export const data = grid.data;
export const INV = 1 / VS, LAYER = NX * NZ;
export const GRAV = 13;                       // m/s² for debris (a little heavier than real: reads as weight at this scale)
export const GAS = M.gas_pipe || 0, FUEL = M.fuel_tank || 0;
export const EXPL = new Uint8Array(256), FLAM = new Uint8Array(256);
for (const m of MAT) if (m) { if (m.explosive) EXPL[m.id] = 1; if (m.flammable) FLAM[m.id] = 1; }
export const BARREL = M.barrel_red, WATER = M.water, RUBBLE = M.rubble, CHARRED = M.charred;

// linear colour per material (COLOR is sRGB)
export const LIN = new Float32Array(768);
for (let i = 0; i < 768; i++) LIN[i] = Math.pow(COLOR[i], 2.2);
// materials that can be scorched to `charred`
export const SCORCH = new Uint8Array(256);
for (const m of MAT) if (m && m.id > 1 && m.strength <= 110 && !m.glass && !m.emissive && m.solid && m.id !== CHARRED && m.id !== BARREL &&
  (m.sound === 'concrete' || m.sound === 'wood' || m.sound === 'dirt')) SCORCH[m.id] = 1;

export const ctx = { owner: null, depth: 0, noBarrel: false };
export const stats = { debris: 0, bodies: 0, pending: 0, ms: 0, msMax: 0, checks: 0, collapses: 0, deposited: 0, fires: 0, prof: [0, 0, 0, 0] /* worst ms: barrels+booms, structure, bits, bodies */ };
export const hooks = { impactCarve: null, thrownImpact: null, queueCheck: null, ignite: null, burnTap: null };

// ---- cheap RNG (no allocation) ----------------------------------------------
let seed = 0x2f6e2b1 | 0;
export function reseed(v) { seed = (Math.imul(v | 0, 0x9E3779B1) ^ 0x5bd1e995) | 0; if (!seed) seed = 0x2f6e2b1; }
export function seedState() { return seed; }
export function seedRestore(v) { seed = v; }
export function rnd() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; }
export function hsh(i, j, k) {
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---- dirty chunk tracking ------------------------------------------------------
// Two flag sets: A is flushed at the end of every operation, B ("held") is flushed
// when a staged collapse is released, so a crushed storey vanishes in the same frame
// its load starts to fall.
const NCH = CX * CY * CZ;
const touchA = new Uint8Array(NCH), touchB = new Uint8Array(NCH);
let T = touchA, anyA = false, anyB = false;
export function holdDirty(on) { T = on ? touchB : touchA; }
function mark(i, j, k) {
  const ci = i >> 5, cj = j >> 5, ck = k >> 5, c = ci + CX * (ck + CZ * cj), t = T;
  t[c] = 1; if (t === touchA) anyA = true; else anyB = true;
  const li = i & 31, lj = j & 31, lk = k & 31;
  if (li === 0) { if (ci > 0) t[c - 1] = 1; } else if (li === 31) { if (ci < CX - 1) t[c + 1] = 1; }
  if (lk === 0) { if (ck > 0) t[c - CX] = 1; } else if (lk === 31) { if (ck < CZ - 1) t[c + CX] = 1; }
  if (lj === 0) { if (cj > 0) t[c - CX * CZ] = 1; } else if (lj === 31) { if (cj < CY - 1) t[c + CX * CZ] = 1; }
}
export const editT = new Float32Array(NCH).fill(-1e9);     // G.time of the last edit per chunk (co-op checksums)
function flushSet(t, out, n) {
  const d = grid.dirty, now = G.time;
  for (let c = 0; c < NCH; c++) if (t[c]) { t[c] = 0; d.add(c); editT[c] = now; if (out && n < out.length) out[n++] = c; }
  grid.version++;
  return n;
}
// Push pending dirty chunks to the grid. `out` (Int16Array) optionally collects the chunk ids; returns the count.
export function flush(out, n = 0) { if (anyA) { anyA = false; n = flushSet(touchA, out, n); } return n; }
export function flushHeld(out, n = 0) { if (anyB) { anyB = false; n = flushSet(touchB, out, n); } return n; }
export function heldPending() { return anyB; }

// ---- buildings -------------------------------------------------------------------
export const B = { at: null, list: [], n: 0, vox: null, lost: null, done: null };
export function initBuildings() {
  const city = G.city;
  B.at = city.buildingAt; B.list = city.buildings; B.n = B.list.length;
  B.vox = new Int32Array(B.n); B.lost = new Int32Array(B.n); B.done = new Uint8Array(B.n);
  for (let n = 0; n < B.n; n++) {
    const b = B.list[n]; let c = 0;
    const j0 = Math.max(GROUND_J, b.j0), j1 = Math.min(NY - 1, b.j1);
    for (let k = Math.max(0, b.k0); k <= Math.min(NZ - 1, b.k1); k++) for (let i = Math.max(0, b.i0); i <= Math.min(NX - 1, b.i1); i++) {
      if (B.at[i + NX * k] !== n + 1) continue;
      let o = i + NX * (k + NZ * j0);
      for (let j = j0; j <= j1; j++, o += LAYER) if (data[o]) c++;
    }
    B.vox[n] = c;
  }
}

// ---- explosive chain queue (barrels, gas mains, fuel tanks) ---------------------------------
const QB = 32;
export const bq = { n: 0, x: new Float32Array(QB), y: new Float32Array(QB), z: new Float32Array(QB), t: new Float32Array(QB), depth: new Uint8Array(QB), mat: new Uint8Array(QB), hop: new Uint8Array(QB), owner: new Array(QB).fill(null) };
const recent = new Float32Array(8 * 4); let recentN = 0;      // x,y,z,time of the last chain blasts
export function noteBarrelBlast(x, y, z) { const r = (recentN++ & 7) * 4; recent[r] = x; recent[r + 1] = y; recent[r + 2] = z; recent[r + 3] = G.time; }
export function resetBarrels() { bq.n = 0; bq.owner.fill(null); recent.fill(-99); recentN = 0; }
// Schedule a chain blast directly (gas hops along a pipe run). hop = 1: the voxel at the spot is broken when it fires.
export function scheduleBlast(x, y, z, t, mat, depth, owner, hop) {
  if (bq.n >= QB) return false;
  if (hop) for (let q = 0; q < bq.n; q++) { const dx = bq.x[q] - x, dy = bq.y[q] - y, dz = bq.z[q] - z; if (dx * dx + dy * dy + dz * dz < 6) return false; }
  const n = bq.n++;
  bq.x[n] = x; bq.y[n] = y; bq.z[n] = z; bq.t[n] = t; bq.depth[n] = depth; bq.mat[n] = mat; bq.hop[n] = hop ? 1 : 0; bq.owner[n] = owner || null;
  return true;
}
function queueBarrel(i, j, k, m) {
  if ((ctx.depth >= 7 && m === BARREL) || bq.n >= QB) return;
  const x = (i + 0.5) * VS, y = (j + 0.5) * VS, z = (k + 0.5) * VS, near = m === BARREL ? 2.6 : m === GAS ? 12 : 30;
  for (let n = 0; n < bq.n; n++) { const dx = bq.x[n] - x, dy = bq.y[n] - y, dz = bq.z[n] - z; if (dx * dx + dy * dy + dz * dz < near) return; }
  for (let r = 0; r < 32; r += 4) { if (G.time - recent[r + 3] > 0.6) continue; const dx = recent[r] - x, dy = recent[r + 1] - y, dz = recent[r + 2] - z; if (dx * dx + dy * dy + dz * dz < near * 0.8) return; }
  scheduleBlast(x, y, z, G.time + 0.09 + hsh(i, j, k) * 0.16, m, ctx.depth + 1, ctx.owner, 0);      // delay from position: co-op peers agree
}

// ---- voxel writes ----------------------------------------------------------------
// Remove the voxel at (i,j,k). Caller guarantees it is inside the grid and j >= 1. Returns the old material.
export function rm(i, j, k) {
  const o = i + NX * (k + NZ * j), m = data[o];
  if (!m) return 0;
  data[o] = 0; mark(i, j, k);
  if (j >= GROUND_J) { const b = B.at[i + NX * k]; if (b) B.lost[b - 1]++; }
  if (EXPL[m] && !ctx.noBarrel) queueBarrel(i, j, k, m);
  return m;
}
export function put(i, j, k, m) { data[i + NX * (k + NZ * j)] = m; mark(i, j, k); }
export function canBreak(m, power) { const s = STRENGTH[m]; return s !== 255 && s < power; }

// per-operation material tally for the 'voxels:destroyed' event
export const tally = new Int32Array(64);
export function dominant() { let b = 8, c = 0; for (let m = 1; m < 64; m++) if (tally[m] > c) { c = tally[m]; b = m; } tally.fill(0); return b; }

// co-op: debris and fire only hurt entities this peer owns (offline: everything)
export function canHurt(e) { const n = G.net; return !(n && n.online && n.localOwns) || n.localOwns(e); }

// Time slicing. Offline the budgets are wall-clock; in deterministic mode (co-op) they are counted work units, so
// two peers that apply the same operations on the same frames slice the work identically.
export const clock = { det: false, acc: 0, lim: 0 };
export function over(deadline, w) { if (clock.det) { clock.acc += w; return clock.acc > clock.lim; } return performance.now() > deadline; }

// co-op: a client does not simulate fire; the host's cells are the truth
export function fireClient() { const n = G.net; return !!(n && n.online && !n.isHost); }
