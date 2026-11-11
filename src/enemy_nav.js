// ============================================================================
// KILOTON — enemy_nav.js   OWNER: ENEMY.
// Coarse 2D navigation for Vanta ground units, derived from the voxels and kept
// current while the city is being demolished.
//   * 2 m cells (4x4 voxel columns), 96 x 96.
//   * per cell: pilot-sized walkability + floor height, and how obstructed the
//     cell is for a tank (2.6 m clearance) and for a rig (8.5 m clearance).
//   * refresh: event-driven dirty queue (explosions, collapses, debris) plus a
//     rolling full sweep whenever grid.version has moved.
//   * three time-sliced Dijkstra flow fields to the player (soldier/tank/rig),
//     double buffered so readers always see a complete field.
// ============================================================================
import { G, VS, NX, NZ, GROUND_J, GROUND_Y, bus } from './core.js';
import { SOLID, STRENGTH } from './materials.js';

export const CELL = 2, CV = 4, W = NX / CV, H = NZ / CV, N = W * H;
const NXZ = NX * NZ;
const JTOP = GROUND_J + 8;          // highest floor (voxel j) a walker is expected to stand on: 4 m above the street
const RIG_J = 17, TANK_J = 6;       // clearance (voxels) checked above the floor
const HCAP = N * 8;

const passS = new Uint8Array(N), costS = new Uint8Array(N), hS = new Float32Array(N).fill(GROUND_Y);
const obR = new Uint8Array(N), obT = new Uint8Array(N);     // 0 clear, 1 weak, 2 solid, 3 hard (rig only)
const costR = new Uint8Array(N), costT = new Uint8Array(N); // derived when a field starts
const queued = new Uint8Array(N), queue = new Int32Array(N);
let qHead = 0, qTail = 0, qCount = 0;
let sweepPos = 0, sweepLeft = 0, seenVersion = -1;
const colF = new Int8Array(16), hist = new Uint8Array(JTOP + 2);
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1], LEN = [1, 1, 1, 1, 1.4142, 1.4142, 1.4142, 1.4142];
const RC = [1, 2, 7, 16], TC = [1, 3, 40];

function scan(c) {
  const d = G.grid.data, cx = c % W, cz = (c / W) | 0, i0 = cx * CV, k0 = cz * CV;
  hist.fill(0);
  let n = 0;
  for (let k = k0; k < k0 + CV; k++) for (let i = i0; i < i0 + CV; i++) {
    const b = i + NX * k; let f = -1;
    for (let j = 1; j <= JTOP; j++) {
      if (SOLID[d[b + NXZ * (j - 1)]] && !SOLID[d[b + NXZ * j]] && !SOLID[d[b + NXZ * (j + 1)]] && !SOLID[d[b + NXZ * (j + 2)]] && !SOLID[d[b + NXZ * (j + 3)]]) { f = j; break; }
    }
    colF[n++] = f; if (f >= 0) hist[f]++;
  }
  let mode = -1, mc = 0;
  for (let j = 1; j <= JTOP; j++) if (hist[j] > mc) { mc = hist[j]; mode = j; }
  let stand = 0, hsum = 0, lo = 99, hi = 0;
  if (mode >= 0) for (let q = 0; q < 16; q++) { const f = colF[q]; if (f >= 0 && f - mode <= 2 && mode - f <= 2) { stand++; hsum += f; if (f < lo) lo = f; if (f > hi) hi = f; } }
  let pass = stand >= 11 ? 1 : 0;
  if (pass && stand < 16) {            // a thin wall crossing the cell blocks it: any row or column with at most one standable voxel column
    for (let a = 0; a < 4 && pass; a++) {
      let row = 0, col = 0;
      for (let q = 0; q < 4; q++) { let f = colF[a * 4 + q]; if (f >= 0 && f - mode <= 2 && mode - f <= 2) row++; f = colF[q * 4 + a]; if (f >= 0 && f - mode <= 2 && mode - f <= 2) col++; }
      if (row <= 1 || col <= 1) pass = 0;
    }
  }
  passS[c] = pass;
  hS[c] = stand ? (hsum / stand) * VS : GROUND_Y;
  costS[c] = pass ? 1 + (stand < 15 ? 1 : 0) + (hi - lo >= 2 ? 1 : 0) : 0;
  // obstruction above the floor for the big classes
  const jb = mode >= 0 ? Math.round(hsum / Math.max(1, stand)) : GROUND_J;
  let nT = 0, sT = 0, nR = 0, sR = 0;
  for (let k = k0; k < k0 + CV; k++) for (let i = i0; i < i0 + CV; i++) {
    let o = i + NX * k + NXZ * jb;
    for (let j = 0; j < RIG_J; j++, o += NXZ) {
      const m = d[o];
      if (m && SOLID[m]) { const s = STRENGTH[m]; nR++; if (s > sR) sR = s; if (j < TANK_J) { nT++; if (s > sT) sT = s; } }
    }
  }
  obT[c] = nT === 0 ? 0 : (nT <= 6 || (sT <= 60 && nT <= 44)) ? 1 : 2;
  obR[c] = nR === 0 ? 0 : (nR <= 8 || sR <= 60) ? 1 : sR < 100 ? 2 : 3;
}

function markCell(c) { if (!queued[c]) { queued[c] = 1; queue[qTail] = c; qTail = (qTail + 1) % N; qCount++; } }
function markCircle(x, z, r) {
  const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.min(W - 1, Math.floor((x + r) / CELL));
  const z0 = Math.max(0, Math.floor((z - r) / CELL)), z1 = Math.min(H - 1, Math.floor((z + r) / CELL));
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) markCell(cx + cz * W);
}

// ---- flow fields -----------------------------------------------------------
function makeField(cls) {
  return { cls, dist: new Float32Array(N).fill(Infinity), next: new Int16Array(N).fill(-1), bdist: new Float32Array(N), bnext: new Int16Array(N),
    heapN: new Int32Array(HCAP), heapK: new Float32Array(HCAP), hn: 0, running: false, stamp: -1e9, need: false, gx: 0, gz: 0, goal: -1, bgoal: -1, valid: false };
}
// 0 soldier, 1 tank, 2 rig -> the player;  3,4,5 the same classes -> the alternate goal (a defended objective)
const fields = [makeField(0), makeField(1), makeField(2), makeField(0), makeField(1), makeField(2)];

function hpush(f, n, k) {
  if (f.hn >= HCAP) return;
  const hN = f.heapN, hK = f.heapK; let i = f.hn++;
  while (i > 0) { const p = (i - 1) >> 1; if (hK[p] <= k) break; hN[i] = hN[p]; hK[i] = hK[p]; i = p; }
  hN[i] = n; hK[i] = k;
}
let popN = 0, popK = 0;
function hpop(f) {
  const hN = f.heapN, hK = f.heapK; popN = hN[0]; popK = hK[0];
  const n = --f.hn; if (n <= 0) return;
  const ln = hN[n], lk = hK[n]; let i = 0;
  for (;;) { let ch = 2 * i + 1; if (ch >= n) break; if (ch + 1 < n && hK[ch + 1] < hK[ch]) ch++; if (hK[ch] >= lk) break; hN[i] = hN[ch]; hK[i] = hK[ch]; i = ch; }
  hN[i] = ln; hK[i] = lk;
}
// Seed one goal position into a field that is being started (soldier class: nearest walkable ring if the cell is blocked).
function seedGoal(f, x, z) {
  const cx = Math.min(W - 1, Math.max(0, Math.floor(x / CELL))), cz = Math.min(H - 1, Math.max(0, Math.floor(z / CELL)));
  const g = cx + cz * W;
  if (f.cls !== 0 || passS[g]) { if (f.bdist[g] > 0) { f.bdist[g] = 0; hpush(f, g, 0); } return; }
  let found = false;
  for (let r = 1; r <= 10 && !found; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
    const n = nx + nz * W; if (!passS[n]) continue;
    const k = Math.sqrt(dx * dx + dz * dz) * CELL; if (k < f.bdist[n]) { f.bdist[n] = k; hpush(f, n, k); } found = true;
  }
}
function startField(f, x, z) {
  const cx = Math.min(W - 1, Math.max(0, Math.floor(x / CELL))), cz = Math.min(H - 1, Math.max(0, Math.floor(z / CELL)));
  const g = cx + cz * W;
  f.bdist.fill(Infinity); f.bnext.fill(-1); f.hn = 0; f.gx = x; f.gz = z; f.bgoal = g;
  if (f.cls === 0) {
    if (passS[g]) { f.bdist[g] = 0; hpush(f, g, 0); }
    else {
      for (let r = 1; r <= 10 && f.hn === 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
        const n = nx + nz * W; if (!passS[n]) continue;
        const k = Math.sqrt(dx * dx + dz * dz) * CELL; f.bdist[n] = k; hpush(f, n, k);
      }
    }
  } else {
    const ob = f.cls === 1 ? obT : obR, tab = f.cls === 1 ? TC : RC, out = f.cls === 1 ? costT : costR;
    for (let c = 0; c < N; c++) {
      const x0 = c % W;
      let near = 0;
      if (x0 > 0 && ob[c - 1] >= 2) near = 1; else if (x0 < W - 1 && ob[c + 1] >= 2) near = 1; else if (c >= W && ob[c - W] >= 2) near = 1; else if (c < N - W && ob[c + W] >= 2) near = 1;
      out[c] = tab[ob[c]] + near * 2;
    }
    f.bdist[g] = 0; hpush(f, g, 0);
  }
  if (f.multi) for (let i = 1; i < goalN; i++) seedGoal(f, goalsX[i], goalsZ[i]);     // co-op: every player is a goal
  f.running = true;
}
function stepField(f, maxPops) {
  const bd = f.bdist, bn = f.bnext, cls = f.cls, cost = cls === 1 ? costT : costR, lim = cls === 1 ? 1.3 : 2.2;
  let pops = 0;
  while (pops < maxPops && f.hn > 0) {
    hpop(f); const c = popN, k = popK;
    if (k > bd[c]) continue;
    pops++;
    const cx = c % W, cz = (c / W) | 0, hc = hS[c];
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], nz = cz + DZ[d]; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nx + nz * W; let w;
      let dh = hS[n] - hc; if (dh < 0) dh = -dh;
      if (cls === 0) {
        if (!passS[n] || dh > 1.3) continue;
        if (d >= 4 && (!passS[cx + DX[d] + cz * W] || !passS[cx + nz * W])) continue;
        w = LEN[d] * (costS[n] + costS[c]);
      } else {
        w = LEN[d] * (cost[n] + cost[c]); if (dh > lim) w += 30;
        if (d >= 4) { const a = cost[cx + DX[d] + cz * W], b = cost[cx + nz * W]; if (a > 6 || b > 6) w += (a > b ? a : b); }
      }
      const nd = k + w;
      if (nd < bd[n]) { bd[n] = nd; bn[n] = c; hpush(f, n, nd); }
    }
  }
  if (f.hn === 0) {
    const td = f.dist, tn = f.next; f.dist = f.bdist; f.next = f.bnext; f.bdist = td; f.bnext = tn;
    f.goal = f.bgoal; f.running = false; f.stamp = G.time; f.valid = true;
  }
  return pops;
}

let goalX = 96, goalZ = 96, altX = 96, altZ = 96, rr = 0;
const NF = 6;
const goalsX = new Float32Array(8), goalsZ = new Float32Array(8); let goalN = 1;
const nav = {
  CELL, W, H, N, passS, costS, hS, obR, obT, fields,
  stats: { scanned: 0, pops: 0, queue: 0 },
  init() {
    bus.on('explosion', e => markCircle(e.x, e.z, (e.radius || 3) + 3));
    bus.on('voxels:destroyed', e => markCircle(e.x, e.z, (e.radius || 1) + 2));
    bus.on('collapse', e => markCircle(e.x, e.z, 12));
    bus.on('debris:impact', e => markCircle(e.x, e.z, 2.5));
    bus.on('mech:land', e => markCircle(e.x, e.z, 9));
    bus.on('punch', e => markCircle(e.x + (e.dx || 0) * 2, e.z + (e.dz || 0) * 2, 5));
    this.rebuild();
  },
  rebuild() {
    for (let c = 0; c < N; c++) scan(c);
    queued.fill(0); qHead = qTail = qCount = 0; sweepLeft = 0; seenVersion = G.grid.version;
    for (const f of fields) { f.dist.fill(Infinity); f.next.fill(-1); f.running = false; f.valid = false; f.stamp = -1e9; f.hn = 0; }
  },
  setGoal(x, z) { goalX = x; goalZ = z; goalN = 1; },
  // co-op: several goals; the player fields then lead to the nearest one by path
  addGoal(x, z) { if (goalN < 8) { goalsX[goalN] = x; goalsZ[goalN] = z; goalN++; } },
  setAltGoal(x, z) { altX = x; altZ = z; },
  // Called every frame. Scans dirty cells and advances the flow fields within a small budget.
  update() {
    const g = G.grid;
    if (g.version !== seenVersion) { seenVersion = g.version; sweepLeft = N; }
    let done = 0;
    while (qCount > 0 && done < 96) { const c = queue[qHead]; qHead = (qHead + 1) % N; qCount--; queued[c] = 0; scan(c); done++; }
    if (sweepLeft > 0) { for (let n = 0; n < 40; n++) { scan(sweepPos); sweepPos = (sweepPos + 1) % N; } sweepLeft -= 40; done += 40; }
    this.stats.scanned = done; this.stats.queue = qCount;
    // one field at a time, round robin over the classes somebody needs
    let pops = 0, budget = 2200;
    for (let tries = 0; tries < 4 && budget > 0; tries++) {
      let f = fields[rr];
      if (!f.running) {
        let found = false;
        for (let s = 0; s < NF; s++) { const q = fields[(rr + s) % NF]; if (q.running) { rr = (rr + s) % NF; f = q; found = true; break; } }
        if (!found) for (let s = 1; s <= NF; s++) { const fi = (rr + s) % NF, q = fields[fi]; if (q.need && G.time - q.stamp > (q.cls === 0 ? 0.25 : 0.45)) { rr = fi; f = q; f.multi = fi < 3 && goalN > 1; if (fi < 3) startField(f, goalX, goalZ); else startField(f, altX, altZ); found = true; break; } }
        if (!found) break;
      }
      const p = stepField(f, budget); pops += p; budget -= p;
      if (f.running) break;
    }
    this.stats.pops = pops;
  },
  cellOf(x, z) {
    const cx = x < 0 ? 0 : x >= NX * VS ? W - 1 : (x / CELL) | 0, cz = z < 0 ? 0 : z >= NZ * VS ? H - 1 : (z / CELL) | 0;
    return cx + cz * W;
  },
  cellX(c) { return (c % W + 0.5) * CELL; },
  cellZ(c) { return (((c / W) | 0) + 0.5) * CELL; },
  // Straight line between two cells crosses only cells this class can walk without trouble.
  lineOK(cls, a, b) {
    const ax = a % W, az = (a / W) | 0, bx = b % W, bz = (b / W) | 0;
    const dx = bx - ax, dz = bz - az, n = Math.max(Math.abs(dx), Math.abs(dz)) * 2;
    if (n === 0) return true;
    let ph = hS[a];
    const cost = cls === 1 ? costT : costR;
    for (let s = 1; s <= n; s++) {
      const t = s / n, fx = ax + 0.5 + dx * t, fz = az + 0.5 + dz * t, c = (fx | 0) + (fz | 0) * W;
      if (cls === 0) {
        if (!passS[c] || costS[c] > 2) return false;
        const ox = fx - (fx | 0), oz = fz - (fz | 0);       // close to a cell corner: the diagonal neighbours matter too
        if (ox < 0.2 || ox > 0.8) { const c2 = c + (ox < 0.5 ? -1 : 1); if (c2 >= 0 && c2 < N && !passS[c2]) return false; }
        if (oz < 0.2 || oz > 0.8) { const c2 = c + (oz < 0.5 ? -W : W); if (c2 >= 0 && c2 < N && !passS[c2]) return false; }
      } else if (cost[c] > 3) return false;
      const h = hS[c]; if (h - ph > 1.3 || ph - h > 1.3) return false; ph = h;
    }
    return true;
  },
  nearestFinite(f, c, R) {
    const cx = c % W, cz = (c / W) | 0; let best = -1, bd = 1e9;
    for (let r = 1; r <= R && best < 0; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nx + nz * W; if (f.dist[n] === Infinity) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = n; }
    }
    return best;
  },
  // Where should a unit of this class standing at (x,z) walk next? Writes out.x/out.z.
  // Returns 0 no route, 1 on route, 2 in the goal cell (walk straight at the target), 3 off the field (heading to its edge).
  waypoint(fi, x, z, out, look) {
    const f = fields[fi], cls = f.cls; f.need = true;
    if (!f.valid) return 0;
    const c = this.cellOf(x, z);
    if (f.dist[c] === Infinity) {
      const n = this.nearestFinite(f, c, 4); if (n < 0) return 0;
      out.x = this.cellX(n); out.z = this.cellZ(n); return 3;
    }
    let p = f.next[c]; if (p < 0) return 2;
    let best = p;
    for (let s = 1; s < (look || 6); s++) { const p2 = f.next[p]; if (p2 < 0) break; if (!this.lineOK(cls, c, p2)) break; best = p2; p = p2; }
    out.x = this.cellX(best); out.z = this.cellZ(best);
    return 1;
  },
  // Flanking step for infantry: prefer neighbours that circle the goal on `side` (+1 / -1) without losing much ground.
  flankStep(x, z, side, k, out, fi, gx, gz) {
    const f = fields[fi || 0]; f.need = true; if (!f.valid) return 0;
    if (gx == null) { gx = f.gx; gz = f.gz; }
    const c = this.cellOf(x, z), d0 = f.dist[c]; if (d0 === Infinity) return 0;
    const cx = c % W, cz = (c / W) | 0;
    let tx = gx - x, tz = gz - z; const tl = Math.sqrt(tx * tx + tz * tz) || 1; tx /= tl; tz /= tl;
    let best = -1, bs = 1e9;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], nz = cz + DZ[d]; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const n = nx + nz * W; if (!passS[n] || f.dist[n] === Infinity || f.dist[n] > d0 + 3.5) continue;
      let dh = hS[n] - hS[c]; if (dh < 0) dh = -dh; if (dh > 1.3) continue;
      if (d >= 4 && (!passS[cx + DX[d] + cz * W] || !passS[cx + nz * W])) continue;
      const tang = (DX[d] * -tz + DZ[d] * tx) / LEN[d];       // + = to the left of the line to the goal
      const s = f.dist[n] - k * side * tang;
      if (s < bs) { bs = s; best = n; }
    }
    if (best < 0) return 0;
    out.x = this.cellX(best); out.z = this.cellZ(best); return 1;
  },
  fieldDist(fi, x, z) { const f = fields[fi]; return f.valid ? f.dist[this.cellOf(x, z)] : Infinity; },
  // i-th walkable cell in a square spiral around (x,z) (formation slots, safe teleports). Returns cell or -1.
  walkableNear(x, z, skip, cls) {
    const c0 = this.cellOf(x, z), cx = c0 % W, cz = (c0 / W) | 0; let seen = 0;
    for (let r = 0; r <= 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 1 || nz < 1 || nx >= W - 1 || nz >= H - 1) continue;
      const n = nx + nz * W;
      const ok = cls === 2 ? obR[n] === 0 && passS[n] : cls === 1 ? obT[n] === 0 && passS[n] : passS[n] === 1;
      if (!ok) continue;
      if (seen++ >= (skip || 0)) return n;
    }
    return -1;
  },
};
export default nav;
