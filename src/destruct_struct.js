// ============================================================================
// KILOTON — destruct_struct.js   OWNER: DESTRUCT
// Structural analysis. After removals a time-sliced flood fill (bounded by the
// affected building, or by a box around a street prop) finds voxel clusters
// that no longer reach the ground; an overload rule crushes storeys whose
// load-bearing cross-section has become too small. Detached clusters are cut
// into storey-sized modules, meshed over a few frames and released together.
// ============================================================================
import { G, VS, NX, NY, NZ, GROUND_J, bus } from './core.js';
import { STRUCT, DENSITY, GLASS, SOLID } from './materials.js';
import { data, LAYER, WATER, ctx, stats, rm, B, flush, flushHeld, heldPending, holdDirty, rnd, over, reseed } from './destruct_base.js';
import { bld, bldPush, makeBody, activate, newGroup, groupChunks, spawnBit, bitRoom, bodyCapNow, bodies, ensureRoom, MAXV } from './destruct_bodies.js';

export const STUNE = {
  globalRatio: 0.45,     // a storey crushes when its load-bearing section falls below this share of the original
  tileRatio: 0.25,        // a bay (8 m tile) fails below this share
  tile: 16,              // overload bay size (voxels)
  band: 7,               // storey height (voxels)
  debounce: 0.05,        // s after the last removal before a building is analysed
};
const TILE = STUNE.tile, BAND = STUNE.band;

// ---- jobs ------------------------------------------------------------------------------
let bJobs = [];                               // per building
const pJobs = [];                             // prop jobs (pooled objects)
for (let n = 0; n < 12; n++) pJobs.push({ active: false, i0: 0, j0: 0, k0: 0, i1: 0, j1: 0, k1: 0, owner: null, ex: 0, ey: 0, ez: 0, t: 0 });
const clusters = [];                          // detached clusters waiting to be prepared
let pristine = [];                            // per building: { ntx, ntz, nb, A0, O0, M0, crushedG, crushedT }
let seen = null;

export function queueCheck(i0, j0, k0, i1, j1, k1, owner, x, y, z, open) {
  if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= NX) i1 = NX - 1; if (k1 >= NZ) k1 = NZ - 1;
  const step = (i1 - i0) * (k1 - k0) > 4096 ? 2 : 1;
  for (let k = k0; k <= k1; k += step) for (let i = i0; i <= i1; i += step) {
    const b = B.at[i + NX * k]; if (!b || seen[b - 1] === 1) continue;
    seen[b - 1] = 1;
    const J = bJobs[b - 1];
    if (!J.dirty) { J.dirty = true; J.t0 = G.time; }
    J.t = G.time; J.owner = owner; J.ex = x; J.ey = y; J.ez = z;
  }
  seen.fill(0);
  if (open) {
    let P = null;
    for (let n = 0; n < pJobs.length; n++) { const p = pJobs[n]; if (p.active && i0 <= p.i1 + 8 && i1 >= p.i0 - 8 && k0 <= p.k1 + 8 && k1 >= p.k0 - 8) { P = p; break; } }
    if (P) { P.i0 = Math.min(P.i0, i0); P.i1 = Math.max(P.i1, i1); P.k0 = Math.min(P.k0, k0); P.k1 = Math.max(P.k1, k1); P.j0 = Math.min(P.j0, j0); P.j1 = Math.max(P.j1, j1); }
    else {
      for (let n = 0; n < pJobs.length; n++) if (!pJobs[n].active) { P = pJobs[n]; break; }
      if (!P) return;
      P.active = true; P.i0 = i0; P.i1 = i1; P.k0 = k0; P.k1 = k1; P.j0 = j0; P.j1 = j1;
    }
    P.owner = owner; P.ex = x; P.ey = y; P.ez = z; P.t = G.time;
  }
}

// ---- pristine load-path statistics ---------------------------------------------------------
let cnt = new Int32Array(1), occ = new Int32Array(1);
const massL = new Float32Array(NY);
function tileDims(b) { return { ntx: Math.max(1, (b.i1 - b.i0 + 1 + (TILE >> 1)) >> 4), ntz: Math.max(1, (b.k1 - b.k0 + 1 + (TILE >> 1)) >> 4) }; }
function clearLayerStats(P, h) { const need = h * P.ntx * P.ntz; if (cnt.length < need) { cnt = new Int32Array(need); occ = new Int32Array(need); } else { cnt.fill(0, 0, need); occ.fill(0, 0, need); } massL.fill(0); }
// reduce per-layer counts to per-band: A (weakest layer's struct count per tile), O (voxels above the band per tile), Mm (mass above the band)
function reduce(P, h, A, O, Mm) {
  const nt = P.ntx * P.ntz, nb = P.nb;
  for (let s = 0; s < nb; s++) {
    const l0 = s * BAND, l1 = Math.min(h - 1, l0 + BAND - 1);
    for (let t = 0; t < nt; t++) {
      let a = 1e9; for (let l = l0; l <= l1; l++) { const c = cnt[l * nt + t]; if (c < a) a = c; }
      A[s * nt + t] = l1 - l0 + 1 < 4 ? 0 : a;
    }
  }
  for (let t = 0; t < nt; t++) { let acc = 0; for (let s = nb - 1; s >= 0; s--) { O[s * nt + t] = acc; const l0 = s * BAND, l1 = Math.min(h - 1, l0 + BAND - 1); for (let l = l0; l <= l1; l++) acc += occ[l * nt + t]; } }
  let acc = 0; for (let s = nb - 1; s >= 0; s--) { Mm[s] = acc; const l0 = s * BAND, l1 = Math.min(h - 1, l0 + BAND - 1); for (let l = l0; l <= l1; l++) acc += massL[l]; }
}
export function initStruct() {
  bJobs = []; pristine = []; seen = new Uint8Array(Math.max(1, B.n));
  clusters.length = 0; cur.active = false; prep.active = false;
  for (let n = 0; n < pJobs.length; n++) { pJobs[n].active = false; pJobs[n].owner = null; }
  for (let n = 0; n < B.n; n++) {
    const b = B.list[n];
    bJobs.push({ dirty: false, t: 0, t0: 0, owner: null, ex: 0, ey: 0, ez: 0 });
    const P = tileDims(b), bj0 = Math.max(GROUND_J, b.j0), h = Math.max(1, Math.min(NY - 1, b.j1) - bj0 + 1);
    P.nb = Math.ceil(h / BAND); P.h = h; P.bj0 = bj0;
    const nt = P.ntx * P.ntz;
    P.A0 = new Int32Array(P.nb * nt); P.O0 = new Int32Array(P.nb * nt); P.M0 = new Float32Array(P.nb);
    P.A = new Int32Array(P.nb * nt); P.O = new Int32Array(P.nb * nt); P.Mm = new Float32Array(P.nb);
    P.crushedG = new Uint8Array(P.nb); P.crushedT = new Uint8Array(P.nb * nt); P.fail = new Uint8Array(nt);
    clearLayerStats(P, h);
    for (let j = bj0; j < bj0 + h; j++) for (let k = Math.max(0, b.k0); k <= Math.min(NZ - 1, b.k1); k++) {
      const tz = Math.min(P.ntz - 1, (k - b.k0) >> 4);
      for (let i = Math.max(0, b.i0); i <= Math.min(NX - 1, b.i1); i++) {
        if (B.at[i + NX * k] !== n + 1) continue;
        const m = data[i + NX * (k + NZ * j)]; if (!m) continue;
        const c = (j - bj0) * nt + Math.min(P.ntx - 1, (i - b.i0) >> 4) + P.ntx * tz;
        occ[c]++; if (STRUCT[m]) cnt[c]++; massL[j - bj0] += DENSITY[m];
      }
    }
    reduce(P, h, P.A0, P.O0, P.M0);
    pristine.push(P);
  }
}
export function resetStruct() {
  for (let n = 0; n < bJobs.length; n++) { const J = bJobs[n]; J.dirty = false; J.owner = null; pristine[n].crushedG.fill(0); pristine[n].crushedT.fill(0); }
  for (let n = 0; n < pJobs.length; n++) { pJobs[n].active = false; pJobs[n].owner = null; }
  clusters.length = 0; cur.active = false; prep.active = false; crushN = 0;
  holdDirty(false); flushHeld();
}

// ---- flood fill state ----------------------------------------------------------------------
let vis = new Uint8Array(1 << 16), colF = new Uint8Array(1 << 10);
let sl = new Int32Array(1 << 16), sg = new Int32Array(1 << 16), cl = new Int32Array(1 << 14);
const dl = new Int32Array(6), dg = new Int32Array([1, -1, NX, -NX, LAYER, -LAYER]);
const cur = { active: false, bid: -1, phase: 0, i0: 0, j0: 0, k0: 0, sx: 0, sy: 0, sz: 0, layer: 0, sp: 0, sj: 0, sk: 0, si: 0, cn: 0, anchored: false, found: 0, owner: null, ex: 0, ey: 0, ez: 0 };

function begin(bid, i0, j0, k0, i1, j1, k1, owner, ex, ey, ez) {
  if (i0 < 1) i0 = 1; if (k0 < 1) k0 = 1; if (i1 > NX - 2) i1 = NX - 2; if (k1 > NZ - 2) k1 = NZ - 2; if (j1 > NY - 1) j1 = NY - 1; j0 = 1;
  const sx = i1 - i0 + 3, sy = j1 - j0 + 3, sz = k1 - k0 + 3, layer = sx * sz, vol = layer * sy;
  if (vis.length < vol) { vis = new Uint8Array(vol + (vol >> 2)); sl = new Int32Array(vis.length); sg = new Int32Array(vis.length); } else vis.fill(0, 0, vol);
  if (colF.length < layer) colF = new Uint8Array(layer * 2);
  Object.assign(cur, { active: true, bid, phase: 1, i0, j0, k0, sx, sy, sz, layer, sp: 0, sj: j0, sk: k0, si: i0, cn: 0, anchored: false, found: 0, owner, ex, ey, ez });
  dl[0] = 1; dl[1] = -1; dl[2] = sx; dl[3] = -sx; dl[4] = layer; dl[5] = -layer;
  // padding shell = 2 (not a member)
  vis.fill(2, 0, layer); vis.fill(2, vol - layer, vol);
  for (let j = 1; j < sy - 1; j++) {
    const o = j * layer; vis.fill(2, o, o + sx); vis.fill(2, o + layer - sx, o + layer);
    for (let k = 1; k < sz - 1; k++) { vis[o + k * sx] = 2; vis[o + k * sx + sx - 1] = 2; }
  }
  // column flags: 0 own building, 1 open ground (benefit of the doubt at the border), 2 someone else's
  let sp = 0;
  for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
    const own = B.at[i + NX * k], lc = (i - i0 + 1) + sx * (k - k0 + 1);
    const f = own === bid + 1 ? (bid < 0 ? 1 : 0) : own === 0 ? 1 : 2;
    colF[lc] = f;
    if (f === 2) { for (let j = 1; j < sy - 1; j++) vis[lc + j * layer] = 2; continue; }
    // ground layers are always grounded: seed from them
    const g = i + NX * (k + NZ), l = lc + layer;        // j = 1 rests on bedrock: the seed layer
    if (data[g]) { vis[l] = 1; sl[sp] = l; sg[sp] = g; sp++; }
  }
  cur.sp = sp;
  if (bid >= 0) { const P = pristine[bid]; clearLayerStats(P, P.h); }
  stats.checks++;
}

// returns true when the job is finished
function run(deadline) {
  const c = cur, layer = c.layer, sx = c.sx;
  let sp = c.sp, it = 0;
  if (c.phase === 1) {
    while (sp > 0) {
      sp--; const l = sl[sp], g = sg[sp];
      for (let d = 0; d < 6; d++) {
        const nl = l + dl[d];
        if (vis[nl] === 0) { const m = data[g + dg[d]]; if (m !== 0 && m !== WATER) { vis[nl] = 1; sl[sp] = nl; sg[sp] = g + dg[d]; sp++; } }
      }
      if ((++it & 2047) === 0 && over(deadline, 1)) { c.sp = sp; return false; }
    }
    c.phase = 2; c.sp = 0;
  }
  const i1 = c.i0 + sx - 3, k1 = c.k0 + c.sz - 3, j1 = c.j0 + c.sy - 3;
  const b = c.bid >= 0 ? B.list[c.bid] : null, P = b ? pristine[c.bid] : null, nt = P ? P.ntx * P.ntz : 0;
  for (;;) {
    if (c.phase === 3) {               // collecting one unsupported cluster
      while (sp > 0) {
        sp--; const l = sl[sp], g = sg[sp];
        if (c.cn >= cl.length) { const n = new Int32Array(cl.length * 2); n.set(cl); cl = n; }
        cl[c.cn++] = g;
        const open = colF[l % layer] === 1;
        for (let d = 0; d < 6; d++) {
          const nl = l + dl[d], v = vis[nl];
          if (v === 0) { const m = data[g + dg[d]]; if (m !== 0 && m !== WATER) { vis[nl] = 3; sl[sp] = nl; sg[sp] = g + dg[d]; sp++; } }
          else if (v === 2 && open && d !== 5 && data[g + dg[d]]) c.anchored = true;      // touches something outside the analysed set
          else if (v === 1) c.anchored = true;                                               // (cannot happen; safety)
        }
        if ((++it & 2047) === 0 && over(deadline, 1)) { c.sp = sp; return false; }
      }
      if (!c.anchored && c.cn > 0) { clusters.push({ idx: cl.slice(0, c.cn), n: c.cn, bid: c.bid, owner: c.owner, ex: c.ex, ey: c.ey, ez: c.ez }); c.found++; }
      c.phase = 2; c.cn = 0;
    }
    // phase 2: scan for unvisited solids, gather load-path statistics on the way
    let started = false;
    for (let j = c.sj; j <= j1 && !started; j++) {
      for (let k = (j === c.sj ? c.sk : c.k0); k <= k1 && !started; k++) {
        const iS = (j === c.sj && k === c.sk) ? c.si : c.i0;
        let g = iS + NX * (k + NZ * j), l = (iS - c.i0 + 1) + sx * (k - c.k0 + 1) + layer * (j - c.j0 + 1);
        const stat = P && j >= P.bj0 && j < P.bj0 + P.h && k >= b.k0 && k <= b.k1;
        const tz = stat ? Math.min(P.ntz - 1, (k - b.k0) >> 4) * P.ntx + (j - P.bj0) * nt : 0;
        for (let i = iS; i <= i1; i++, g++, l++) {
          const m = data[g]; if (!m) continue;
          const v = vis[l];
          if (v === 1) {
            if (stat && i >= b.i0 && i <= b.i1 && colF[l % layer] === 0) {
              const t = tz + Math.min(P.ntx - 1, (i - b.i0) >> 4);
              occ[t]++; if (STRUCT[m]) cnt[t]++; massL[j - P.bj0] += DENSITY[m];
            }
          } else if (v === 0 && m !== WATER) {
            vis[l] = 3; sl[0] = l; sg[0] = g; sp = 1; c.cn = 0; c.anchored = false; c.phase = 3;
            c.sj = j; c.sk = k; c.si = i + 1; started = true; break;
          }
        }
        if (!started && (++it & 15) === 0 && over(deadline, 0.25)) { c.sj = j; c.sk = k + 1; c.si = c.i0; c.sp = 0; return false; }
      }
    }
    if (!started) break;
  }
  // done scanning
  if (b) overload(c.bid, c);
  if (!c.found && heldPending() && !clusters.length && !forcePending()) releaseHeld();
  c.active = false;
  return true;
}

// ---- overload ------------------------------------------------------------------------------
const crushS = new Float32Array(4 * 120); let crushN = 0, crushOwner = null;
function crushVoxel(i, j, k) {
  const m = rm(i, j, k); if (!m) return 0;
  if (crushN < 120 && rnd() < 0.08) { const o = crushN++ * 4; crushS[o] = (i + 0.5) * VS; crushS[o + 1] = (j + 0.5) * VS; crushS[o + 2] = (k + 0.5) * VS; crushS[o + 3] = m; }
  return 1;
}
function forcePending() { for (let n = 0; n < bJobs.length; n++) if (bJobs[n].force) return true; return false; }
function overload(bid, c) {
  const b = B.list[bid], P = pristine[bid], nt = P.ntx * P.ntz, ntx = P.ntx, ntz = P.ntz;
  reduce(P, P.h, P.A, P.O, P.Mm);
  for (let s = 0; s < P.nb; s++) {
    let sa = 0, sa0 = 0;
    for (let t = 0; t < nt; t++) { sa += P.A[s * nt + t]; sa0 += P.A0[s * nt + t]; }
    const m0 = P.M0[s], mm = P.Mm[s];
    let global = false, any = false;
    if (!P.crushedG[s] && sa0 >= 4 && m0 > 40 && mm > 0.1 * m0) {
      const need = STUNE.globalRatio * Math.min(1.3, Math.max(0.3, mm / m0));
      if (sa / sa0 < need) global = true;
    }
    if (!global) {
      if (nt < 2) continue;
      for (let t = 0; t < nt; t++) {
        const a0 = P.A0[s * nt + t], o0 = P.O0[s * nt + t], o = P.O[s * nt + t];
        P.fail[t] = (!P.crushedT[s * nt + t] && a0 >= 3 && P.A[s * nt + t] < STUNE.tileRatio * a0 && o >= 40 && o > 0.3 * o0) ? 1 : 0;
      }
      // a failed bay only comes down if it has a failed neighbour (or sits in a narrow building): one bay can cantilever
      for (let t = 0; t < nt; t++) {
        if (P.fail[t] !== 1) continue;
        const tx = t % ntx, tz = (t / ntx) | 0;
        const nbf = (tx > 0 && P.fail[t - 1]) || (tx < ntx - 1 && P.fail[t + 1]) || (tz > 0 && P.fail[t - ntx]) || (tz < ntz - 1 && P.fail[t + ntx]);
        if (nbf || nt <= 3 || tx === 0 && tz === 0 || tx === ntx - 1 && tz === 0 || tx === 0 && tz === ntz - 1 || tx === ntx - 1 && tz === ntz - 1) { P.fail[t] = 2; any = true; }
      }
      if (!any) continue;
    }
    // crush band s (whole storey, or the failed bays plus a crack up the sides)
    holdDirty(true); ctx.owner = c.owner; crushOwner = c.owner;
    const jA = P.bj0 + s * BAND, jB = Math.min(P.bj0 + P.h - 1, jA + BAND - 1), jTop = Math.min(NY - 1, b.j1 + 8);
    let n = 0, sx = 0, sz = 0;
    for (let k = Math.max(1, b.k0); k <= Math.min(NZ - 2, b.k1); k++) {
      const tz = Math.min(ntz - 1, (k - b.k0) >> 4);
      for (let i = Math.max(1, b.i0); i <= Math.min(NX - 2, b.i1); i++) {
        if (B.at[i + NX * k] !== bid + 1) continue;
        const tx = Math.min(ntx - 1, (i - b.i0) >> 4), t = tx + ntx * tz;
        if (global) { for (let j = jA; j <= jB; j++) n += crushVoxel(i, j, k); sx += i; sz += k; continue; }
        if (P.fail[t] !== 2) continue;
        for (let j = jA; j <= jB; j++) n += crushVoxel(i, j, k);
        sx += i; sz += k;
        // crack: the first/last column of the bay where the neighbour bay still stands
        const li = (i - b.i0) & 15, lk = (k - b.k0) & 15;
        const edge = (li === 0 && tx > 0 && P.fail[t - 1] !== 2) || (li === 15 && tx < ntx - 1 && P.fail[t + 1] !== 2 && ((i - b.i0) >> 4) === tx) ||
          (lk === 0 && tz > 0 && P.fail[t - ntx] !== 2) || (lk === 15 && tz < ntz - 1 && P.fail[t + ntx] !== 2 && ((k - b.k0) >> 4) === tz);
        if (edge) for (let j = jB + 1; j <= jTop; j++) n += crushVoxel(i, j, k);
      }
    }
    holdDirty(false);
    if (global) P.crushedG[s] = 1; else for (let t = 0; t < nt; t++) if (P.fail[t] === 2) P.crushedT[s * nt + t] = 1;
    G.state.stats.voxelsDestroyed += n;
    const J = bJobs[bid]; J.dirty = true; J.t = -1; J.t0 = -1; J.force = true; J.owner = c.owner;
    J.ey = (jA + 1) * VS;
    return;
  }
}
// the crushed storey becomes visible (and throws its debris) the moment its load is released
function releaseHeld(out, n = 0) {
  n = flushHeld(out, n);
  const room = Math.min(crushN, bitRoom());
  for (let q = 0; q < room; q++) {
    const o = q * 4, m = crushS[o + 3];
    spawnBit(crushS[o], crushS[o + 1], crushS[o + 2], (rnd() - 0.5) * 12, rnd() * 4, (rnd() - 0.5) * 12, m, GLASS[m] ? 0.2 : rnd() < 0.5 ? 0.5 : 0.3, GLASS[m] ? 0 : 3, crushOwner);
  }
  crushN = 0; crushOwner = null;
  return n;
}

// ---- collapse preparation ---------------------------------------------------------------------
const prep = { active: false, c: null, phase: 0, i0: 0, j0: 0, k0: 0, i1: 0, j1: 0, k1: 0, ts: 16, bh: 7, ntx: 1, ntz: 1, nby: 1, jb: 0, cell: 0, ncell: 0, order: null, start: null, bodies: [], mass: 0, sx: 0, sz: 0 };
function cellOf(p, g) {
  const j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX;
  const band = ((j - p.jb) / p.bh) | 0, sh = (band & 1) * (p.ts >> 1);
  return (((i - p.i0 + sh) / p.ts) | 0) + p.ntx * ((((k - p.k0 + sh) / p.ts) | 0) + p.ntz * band);
}
function startPrep(c) {
  const p = prep, idx = c.idx, n = c.n;
  let i0 = 1e9, j0 = 1e9, k0 = 1e9, i1 = -1, j1 = -1, k1 = -1;
  for (let q = 0; q < n; q++) { const g = idx[q], j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; if (k < k0) k0 = k; if (k > k1) k1 = k; }
  p.active = true; p.c = c; p.i0 = i0; p.j0 = j0; p.k0 = k0; p.i1 = i1; p.j1 = j1; p.k1 = k1;
  const sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1;
  p.jb = c.bid >= 0 ? Math.max(GROUND_J, B.list[c.bid].j0) : j0;
  if (p.jb > j0) p.jb -= Math.ceil((p.jb - j0) / BAND) * BAND;
  let ts = 16, bh = BAND;
  if (n < 420 && sx <= 24 && sy <= 24 && sz <= 24) { ts = 64; bh = 64; p.jb = j0; }
  const target = Math.max(10, Math.floor(bodyCapNow() * 0.55));
  for (;;) {
    p.ntx = Math.ceil((sx + (ts >> 1)) / ts); p.ntz = Math.ceil((sz + (ts >> 1)) / ts); p.nby = Math.floor((j1 - p.jb) / bh) + 1;
    const est = Math.ceil(sx / ts) * Math.ceil(sz / ts) * Math.ceil(sy / bh);
    if (est <= target || ts >= 64 && bh >= 28) break;
    if (ts < 64 && ts * ts <= bh * 80) ts += 8; else bh += BAND;
  }
  p.ts = ts; p.bh = bh; p.ncell = p.ntx * p.ntz * p.nby;
  // counting sort of the voxels by cell
  if (!p.start || p.start.length < p.ncell + 1) p.start = new Int32Array(p.ncell + 64);
  if (!p.order || p.order.length < n) p.order = new Int32Array(n + (n >> 1));
  const st = p.start; st.fill(0, 0, p.ncell + 1);
  for (let q = 0; q < n; q++) st[cellOf(p, idx[q]) + 1]++;
  for (let q = 0; q < p.ncell; q++) st[q + 1] += st[q];
  p.phase = 1; p.cell = 0; p.bodies.length = 0; p.mass = 0; p.sx = 0; p.sz = 0;
}
function runPrep(deadline) {
  const p = prep, c = p.c, idx = c.idx, n = c.n, st = p.start, ord = p.order;
  if (p.phase === 1) {                 // place (start[] becomes end[] after this pass; walk it backwards later)
    for (let q = 0; q < n; q++) { const ce = cellOf(p, idx[q]); ord[st[ce]++] = idx[q]; }
    p.phase = 2; p.cell = 0;
    if (over(deadline, 2)) return false;
  }
  if (p.phase === 2) {
    ctx.owner = c.owner;
    for (; p.cell < p.ncell; p.cell++) {
      const a = p.cell === 0 ? 0 : st[p.cell - 1], e = st[p.cell];
      if (e === a) continue;
      bld.n = 0;
      for (let q = a; q < e; q++) {
        const g = ord[q], m = data[g]; if (!m) continue;
        const j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0;
        bldPush(r - k * NX, j, k, m);
      }
      if (bld.n > 2) { const b = makeBody(null); if (b) { if (p.nby > 2 && ((p.cell / (p.ntx * p.ntz)) | 0) >= p.nby - 1) b.keep = 0.7; p.bodies.push(b); p.mass += b.mass; p.sx += b.px * b.mass; p.sz += b.pz * b.mass; } }
      if (over(deadline, 3)) { p.cell++; return false; }
    }
    p.phase = 3;
  }
  // ---- release: everything goes at once ----
  ctx.owner = c.owner;
  reseed(Math.imul(n, 0x9E3779B1) ^ idx[0]);          // randomness of a collapse depends only on what collapses (co-op peers agree)
  const small = p.bodies.length <= 1 && n < 400;
  const gid = small ? 0 : newGroup(), grp = small ? null : groupChunks(gid);
  let shards = Math.min(40, bitRoom());
  for (let q = 0; q < n; q++) {
    const g = idx[q], j = (g / LAYER) | 0, r = g - j * LAYER, k = (r / NX) | 0, i = r - k * NX;
    const m = rm(i, j, k);
    if (m && (GLASS[m] || p.bodies.length === 0) && shards > 0 && rnd() < 0.25) { shards--; spawnBit((i + 0.5) * VS, (j + 0.5) * VS, (k + 0.5) * VS, (rnd() - 0.5) * 3, rnd() * 2, (rnd() - 0.5) * 3, m, GLASS[m] ? 0.2 : 0.4, 0, null); }
  }
  G.state.stats.voxelsDestroyed += n;
  let nc = flush(grp ? grp.chunks : null, 0);
  if (!forcePending()) nc = releaseHeld(grp ? grp.chunks : null, nc);
  if (grp) grp.n = nc;
  const mass = p.mass || 1, cx = p.sx / mass, cz = p.sz / mass, yb = p.j0 * VS, height = (p.j1 - p.j0 + 1) * VS;
  // coherent start: a slow topple towards the side that was shot out
  let wx = 0, wz = 0;
  if (!small) {
    let dx = c.ex - cx, dz = c.ez - cz; const l = Math.sqrt(dx * dx + dz * dz);
    if (l > 0.5) { dx /= l; dz /= l; } else { const a = rnd() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
    const mag = Math.min(0.16, 0.03 + height * 0.0035) * (0.6 + 0.8 * rnd());
    wx = dz * mag; wz = -dx * mag;
  }
  ensureRoom(p.bodies.length);
  for (let q = 0; q < p.bodies.length; q++) {
    const b = p.bodies[q];
    b.owner = c.owner; b.gx = cx; b.gz = cz;
    if (small) {      // loose piece: tip it away from the blast, pivoting about its base
      let dx = b.px - c.ex, dz = b.pz - c.ez; const l = Math.sqrt(dx * dx + dz * dz);
      if (l > 0.3) { dx /= l; dz /= l; } else { const a = rnd() * 6.28; dx = Math.cos(a); dz = Math.sin(a); }
      const mag = 0.5 + rnd() * 0.9, ry = b.py - yb;
      b.wx = dz * mag + (rnd() - 0.5) * 0.5; b.wz = -dx * mag + (rnd() - 0.5) * 0.5; b.wy = (rnd() - 0.5) * 0.6;
      b.vx = -b.wz * ry; b.vz = b.wx * ry;
    }
    else {
      // each module also gets a little spin of its own, so cracks open between them on the way down
      b.grp = gid; b.frozen = true; b.wx = wx + (rnd() - 0.5) * 0.16; b.wz = wz + (rnd() - 0.5) * 0.16; b.wy = (rnd() - 0.5) * 0.05;
      const rx = b.px - cx, ry = b.py - yb, rz = b.pz - cz;
      b.vx = -wz * ry + (rnd() - 0.5) * 0.3; b.vy = wz * rx - wx * rz; b.vz = wx * ry + (rnd() - 0.5) * 0.3;
    }
    activate(b);
  }
  p.bodies.length = 0;
  if (n >= 150) { stats.collapses++; bus.emit('collapse', { x: cx, y: yb, z: cz, mass, height }); }
  if (c.bid >= 0) { const J = bJobs[c.bid]; if (!J.force) { J.dirty = true; const w = n > 400 ? 0.25 : 0; J.t = Math.max(J.t, G.time + w); J.t0 = G.time + w + 0.3; } }
  p.active = false; p.c = null;
  return true;
}

// ---- scheduler ----------------------------------------------------------------------------------
export function stepStruct(deadline) {
  let guard = 0;
  while (!over(deadline, 0.5) && guard++ < 64) {
    if (prep.active) { if (!runPrep(deadline)) break; continue; }
    if (clusters.length) { startPrep(clusters.shift()); continue; }
    if (cur.active) { if (!run(deadline)) break; continue; }
    // pick the next job
    let pick = -1, bt = 1e9; const now = G.time;
    for (let n = 0; n < bJobs.length; n++) {
      const J = bJobs[n]; if (!J.dirty) continue;
      if (J.force) { pick = n; break; }
      if ((now - J.t >= STUNE.debounce || now - J.t0 > 0.3) && J.t < bt) { bt = J.t; pick = n; }
    }
    if (pick >= 0) {
      const J = bJobs[pick], b = B.list[pick]; J.dirty = false; J.force = false;
      begin(pick, b.i0 - 4, 1, b.k0 - 4, b.i1 + 4, Math.min(NY - 1, b.j1 + 24), b.k1 + 4, J.owner, J.ex, J.ey, J.ez);
      continue;
    }
    let P = null;
    for (let n = 0; n < pJobs.length; n++) { const q = pJobs[n]; if (q.active && now - q.t >= STUNE.debounce) { P = q; break; } }
    if (!P) break;
    P.active = false;
    begin(-1, P.i0 - 12, 1, P.k0 - 12, P.i1 + 12, NY - 1, P.k1 + 12, P.owner, P.ex, P.ey, P.ez);
    P.owner = null;
  }
  let pend = (cur.active ? 1 : 0) + (prep.active ? 1 : 0) + clusters.length;
  for (let n = 0; n < bJobs.length; n++) if (bJobs[n].dirty) pend++;
  for (let n = 0; n < pJobs.length; n++) if (pJobs[n].active) pend++;
  stats.pending = pend;
}
export function structIdle() { return stats.pending === 0; }
