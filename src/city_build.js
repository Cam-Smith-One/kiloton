// ============================================================================
// KILOTON — city_build.js   OWNER: CITY.
// Building recipes. Every building is a structural frame (2x2 columns on a bay
// grid + 1-voxel slabs every 7 voxels) with a facade "style" hung on it.
// ============================================================================
import { M } from './materials.js';
import { C, J0, FH, put, box, ring, get, begin, end, surface, fput, fbox, ftext, blade, textW, sideLo, sideHi, hsh, READ_DIR } from './city_util.js';
import { car, tree, crateStack, barrels, sandbags, billboard, container, planter } from './city_props.js';

// ---- frame planning -----------------------------------------------------------
function fit(L, bays) {
  let best = null;
  for (const b of bays) { const n = Math.floor((L - 2) / b); if (n < 1) continue; const used = n * b + 2; if (!best || used > best.used) best = { b, n, used }; }
  return best || { b: Math.max(2, L - 2), n: 1, used: L };
}
// A = available rect (inclusive). Returns facade rect + column lines (each column is 2x2 at xs[n], zs[n]).
export function plan(A, o = {}) {
  const skin = o.skin || 0, bays = o.bays || [8, 7, 6];
  const fx = fit(A.i1 - A.i0 + 1 - 2 * skin, o.baysX || bays), fz = fit(A.k1 - A.k0 + 1 - 2 * skin, o.baysZ || bays);
  const w = fx.used + 2 * skin, d = fz.used + 2 * skin;
  const ax = o.alignX === undefined ? 0.5 : o.alignX, az = o.alignZ === undefined ? 0.5 : o.alignZ;
  const i0 = A.i0 + Math.floor((A.i1 - A.i0 + 1 - w) * ax), k0 = A.k0 + Math.floor((A.k1 - A.k0 + 1 - d) * az);
  const xs = [], zs = [];
  for (let n = 0; n <= fx.n; n++) xs.push(i0 + skin + n * fx.b);
  for (let n = 0; n <= fz.n; n++) zs.push(k0 + skin + n * fz.b);
  return { i0, k0, i1: i0 + w - 1, k1: k0 + d - 1, xs, zs, bx: fx.b, bz: fz.b, nx: fx.n, nz: fz.n, skin };
}
export function sub(P, a0, a1, c0, c1) { return { i0: P.xs[a0] - P.skin, i1: P.xs[a1] + 1 + P.skin, k0: P.zs[c0] - P.skin, k1: P.zs[c1] + 1 + P.skin }; }
const inset = (r, n) => ({ i0: r.i0 + n, k0: r.k0 + n, i1: r.i1 - n, k1: r.k1 - n });

// ---- the mass builder -----------------------------------------------------------
const q = { s: 0, a: 0, p: 0, bi: 0, b: 8, h: 0, f: 0, nf: 0, id: 0, n: 0 };
function bay(ls, b, a) {
  const rel = a - ls[0], last = ls[ls.length - 1];
  if (rel < 0 || a > last + 1) { q.p = -1; q.bi = rel < 0 ? 0 : ls.length - 1; } else { q.p = rel % b; q.bi = (rel / b) | 0; }
  q.b = b; q.a = a; q.n = ls.length - 1;
}
function ringStyle(P, r, j, style) {
  for (let i = r.i0; i <= r.i1; i++) {
    bay(P.xs, P.bx, i);
    q.s = 0; let m = style(q); if (m) put(i, j, r.k0, m);
    q.s = 1; m = style(q); if (m) put(i, j, r.k1, m);
  }
  for (let k = r.k0 + 1; k < r.k1; k++) {
    bay(P.zs, P.bz, k);
    q.s = 2; let m = style(q); if (m) put(r.i0, j, k, m);
    q.s = 3; m = style(q); if (m) put(r.i1, j, k, m);
  }
}
// Builds `floors` storeys on rect r starting at j0. Returns the j of the roof slab.
export function mass(P, r, j0, floors, style, o = {}) {
  const col = o.col || M.concrete, slab = o.slab || M.floor, roof = o.roof || M.roof_tar;
  q.id = C.cur.id; q.nf = (o.f0 || 0) + floors;
  if (o.nf) q.nf = o.nf;
  for (let f = 0; f < floors; f++) {
    const jb = j0 + f * FH; q.f = f + (o.f0 || 0);
    box(r.i0, jb + 6, r.k0, r.i1, jb + 6, r.k1, f === floors - 1 ? roof : slab);
    const fr = (f === 0 && o.arcade) ? o.arcade : r;
    for (let h = 0; h < 6; h++) { q.h = h; ringStyle(P, fr, jb + h, style); }
    q.h = 6; ringStyle(P, r, jb + 6, style);
    for (const x of P.xs) if (x >= r.i0 && x + 1 <= r.i1) for (const z of P.zs) if (z >= r.k0 && z + 1 <= r.k1) box(x, jb, z, x + 1, jb + 5, z + 1, col);
  }
  return j0 + floors * FH - 1;
}

// ---- facade styles ---------------------------------------------------------------
const litU = (q, unit, frac) => hsh(q.id * 13 + q.s * 3 + 1, q.f * 5 + 2, unit * 7 + 3) < frac;
const boost = (q) => { const h = hsh(q.id, q.f, 99); return h < 0.18 ? 2.1 : h < 0.55 ? 1 : 0.45; };
export const ST = {
  // glass curtain wall in front of the columns
  curtain: (v) => (q) => {
    if (q.h === 6) return v.span;
    if (q.p < 0) return v.mull;
    const half = q.b >> 1;
    if (q.p === 0 || q.p === half) return v.mull;
    if (v.sill && q.h === 0) return v.span;
    return litU(q, q.bi * 2 + (q.p > half ? 1 : 0), v.lit * boost(q)) ? M.window_lit : v.glass;
  },
  // horizontal ribbon windows between solid bands, columns show as piers
  ribbon: (v) => (q) => {
    if (q.h === 6 || q.h === 0 || q.h === 5 || q.p < 0) return v.wall;
    return litU(q, q.bi, v.lit * boost(q)) ? M.window_lit : v.glass;
  },
  // masonry/concrete grid: piers at the columns, spandrels, glazed infill
  pier: (v) => (q) => {
    if (q.h === 6 || q.p < 2) return v.wall;
    if (q.h < (v.sill ?? 1) || q.h >= (v.head ?? 5)) return v.span || v.wall;
    if (v.mid && q.b >= 7 && q.p === 2 + ((q.b - 2) >> 1)) return v.mid;
    return litU(q, q.bi, v.lit * boost(q)) ? M.window_lit : v.glass;
  },
  // load-bearing wall with punched windows, stone sills
  punched: (v) => (q) => {
    if (q.h === 6) return v.band || v.wall;
    if (q.p < 2) return v.wall;
    const n = q.b - 2, ww = Math.min(v.ww || 3, n - 1), w0 = 2 + ((n - ww) >> 1);
    if (q.p >= w0 && q.p < w0 + ww) {
      if (q.h === 1) return v.trim || M.stone;
      if (q.h >= 2 && q.h <= 4) return litU(q, q.bi, v.lit) ? M.window_lit : v.glass;
    }
    return v.wall;
  },
  // shop front: big panes between piers, dark fascia
  shop: (v) => (q) => {
    if (q.h === 6 || q.p < 2) return v.wall;
    if (q.h === 0) return v.base || v.wall;
    if (q.h === 5) return v.fascia || M.metal_dark;
    return litU(q, q.bi, v.lit ?? 0.65) ? M.window_lit : (v.glass || M.glass);
  },
  lobby: (v) => (q) => {
    if (q.h === 6) return v.wall;
    if (q.p < 2) return v.wall;
    if (q.h === 5) return M.metal_dark;
    if (q.p === 2 + ((q.b - 2) >> 1)) return M.metal_dark;
    return litU(q, q.bi, v.lit ?? 0.5) ? M.window_lit : v.glass;
  },
  blank: (m) => () => m,
};

// ---- parts -----------------------------------------------------------------------
function parapet(r, j, h, m, cornice) {
  ring(r.i0, j + 1, r.k0, r.i1, j + h, r.k1, m);
  if (cornice) ring(r.i0 - 1, j + h, r.k0 - 1, r.i1 + 1, j + h, r.k1 + 1, cornice);
}
// door opening centred at aC on side s of rect r, with a canopy
function door(r, s, aC, w, h, canopy = M.metal_dark, depth = 3) {
  const a0 = aC - (w >> 1), a1 = a0 + w - 1;
  fbox(r, s, a0, a1, J0, J0 + h - 1, 0, 0, 0);
  fbox(r, s, a0 - 1, a0 - 1, J0, J0 + h, 0, 0, M.metal_dark); fbox(r, s, a1 + 1, a1 + 1, J0, J0 + h, 0, 0, M.metal_dark);
  fbox(r, s, a0 - 1, a1 + 1, J0 + h, J0 + h, 0, 0, M.metal_dark);
  if (canopy) { fbox(r, s, a0 - 1, a1 + 1, J0 + h, J0 + h, 1, depth, canopy); fput(r, s, aC, J0 + h - 1, 1, M.light_white); }
}
function awning(r, s, a0, a1, m, j = J0 + 5) {
  fbox(r, s, a0, a1, j, j, 1, 3, m); fbox(r, s, a0, a1, j - 1, j - 1, 3, 3, m);
}
// projecting pilaster strips in front of every column line (relief on masonry fronts)
function pilasters(P, r, j0, j1, m, sides = [0, 1, 2, 3]) {
  for (const s of sides) { const ls = s < 2 ? P.xs : P.zs; for (const a of ls) if (a >= sideLo(r, s) && a + 1 <= sideHi(r, s)) fbox(r, s, a, a + 1, j0, j1, 1, 1, m); }
}
// louvred mechanical penthouse
function penthouse(r, j, h, m) {
  box(r.i0, j + 1, r.k0, r.i1, j + h, r.k1, m); box(r.i0 + 1, j + 1, r.k0 + 1, r.i1 - 1, j + h - 1, r.k1 - 1, 0);
  for (let y = j + 2; y < j + h; y += 2) ring(r.i0, y, r.k0, r.i1, y, r.k1, M.metal_dark);
  box(r.i0 + 1, j + h + 1, r.k0 + 1, r.i0 + 2, j + h + 1, r.k0 + 2, M.hvac); box(r.i1 - 3, j + h + 1, r.k1 - 2, r.i1 - 1, j + h + 2, r.k1 - 1, M.hvac);
}
const mid = (r, s) => (sideLo(r, s) + sideHi(r, s)) >> 1;

function hvac(i, j, k) { const rng = C.rng, w = rng.int(3, 5), d = rng.int(3, 4), h = rng.int(2, 3); box(i, j, k, i + w - 1, j + h - 1, k + d - 1, M.hvac); box(i + 1, j + h, k + 1, i + w - 2, j + h, k + d - 2, M.metal_dark); }
function tank(i, j, k) {
  for (const [a, c] of [[1, 1], [3, 1], [1, 3], [3, 3]]) box(i + a, j, k + c, i + a, j + 2, k + c, M.steel_beam);
  for (let dj = 3; dj <= 8; dj++) for (let a = 0; a < 5; a++) for (let c = 0; c < 5; c++) {
    if ((a === 0 || a === 4) && (c === 0 || c === 4)) continue;
    put(i + a, j + dj, k + c, dj === 3 || dj === 6 ? M.wood_dark : M.wood);
  }
  box(i + 1, j + 9, k + 1, i + 3, j + 9, k + 3, M.wood_dark); put(i + 2, j + 10, k + 2, M.wood_dark);
}
function bulkhead(i, j, k, m) {
  ring(i, j, k, i + 4, j + 4, k + 4, m); box(i, j + 5, k, i + 4, j + 5, k + 4, M.roof_tar);
  box(i + 2, j, k, i + 2, j + 3, k, 0); put(i + 2, j + 4, k - 1, M.light_white);
}
function antenna(i, j, k, h) {
  box(i, j, k, i, j + h, k, M.metal_dark); put(i, j + h + 1, k, M.light_red);
  put(i - 1, j + h - 2, k, M.metal_dark); put(i + 1, j + h - 2, k, M.metal_dark); put(i, j + h - 5, k - 1, M.metal_dark); put(i, j + h - 5, k + 1, M.metal_dark);
  box(i - 1, j, k - 1, i + 1, j, k + 1, M.metal_dark);
}
function solar(i, j, k) { for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) { box(i + a * 3, j, k + c * 3, i + a * 3 + 1, j, k + c * 3 + 1, M.metal_dark); box(i + a * 3, j + 1, k + c * 3, i + a * 3 + 1, j + 1, k + c * 3 + 1, M.solar); } box(i, j + 1, k, i + 4, j + 1, k + 4, M.solar); box(i + 2, j + 1, k, i + 2, j + 1, k + 4, M.metal_dark); }
function skylight(i, j, k) { box(i, j, k, i + 4, j, k + 4, M.metal_dark); box(i + 1, j, k + 1, i + 3, j, k + 3, M.window_lit); }
// scatter rooftop plant on a roof whose slab is at level j
function roofKit(r, j, o = {}) {
  const rng = C.rng, x0 = r.i0 + 3, z0 = r.k0 + 3, nx = Math.floor((r.i1 - r.i0 - 4) / 7), nz = Math.floor((r.k1 - r.k0 - 4) / 7);
  let tanks = o.tank ? 0 : 1, bh = o.noBulk ? 1 : 0, n = 0;
  if (nx * nz === 0 && r.i1 - r.i0 >= 4 && r.k1 - r.k0 >= 4) {   // narrow roof: one unit and a mast along the long axis
    const cx = (r.i0 + r.i1) >> 1, cz = (r.k0 + r.k1) >> 1, lx = r.i1 - r.i0 > r.k1 - r.k0;
    hvac(cx - 2 - (lx ? 5 : 0), j + 1, cz - 2 - (lx ? 0 : 5)); antenna(cx + (lx ? 5 : 0), j + 1, cz + (lx ? 0 : 5), rng.int(5, 9));
    if (o.tank && (lx ? r.i1 - r.i0 : r.k1 - r.k0) > 22) tank(cx - 2 + (lx ? 9 : 0), j + 1, cz - 2 + (lx ? 0 : 9));
    return;
  }
  for (let a = 0; a < nx; a++) for (let c = 0; c < nz; c++) {
    const i = x0 + a * 7 + rng.int(0, 1), k = z0 + c * 7 + rng.int(0, 1); let t = rng(); n++;
    if (o.skip && o.skip(i, k)) continue;
    if (!bh && (n === 1 || t < 0.12)) { bulkhead(i, j + 1, k, o.wall || M.concrete); bh = 1; }
    else if (!tanks && t < 0.4) { tank(i, j + 1, k); tanks = 1; }
    else if (t < 0.5) hvac(i, j + 1, k);
    else if (t < 0.62) solar(i, j + 1, k);
    else if (t < 0.7) skylight(i, j + 1, k);
    else if (t < 0.78) antenna(i + 2, j + 1, k + 2, rng.int(6, 11));
    else if (t < 0.88) { box(i, j + 1, k + 2, i + 6, j + 1, k + 2, M.pipe); box(i + 3, j + 1, k, i + 3, j + 2, k + 2, M.pipe); }
  }
}
// sparse interior for one storey: drywall partitions with door gaps, furniture, a few ceiling lights
function fitout(P, r, jb, o = {}) {
  const rng = C.rng;
  const pe = (i, j, k, m) => { if (get(i, j, k) === 0) put(i, j, k, m); };
  const zi = P.zs.filter(z => z > r.k0 + 4 && z < r.k1 - 6), xi = P.xs.filter(x => x > r.i0 + 4 && x < r.i1 - 6);
  if (zi.length && rng() < (o.part ?? 0.75)) {
    const z = rng.pick(zi) + 2, ph = rng.int(0, 8);
    for (let i = r.i0 + 1; i < r.i1; i++) { if ((i + ph) % 9 >= 6) continue; for (let h = 0; h < 6; h++) pe(i, jb + h, z, M.drywall); }
  }
  if (xi.length && rng() < (o.part ?? 0.75) * 0.7) {
    const x = rng.pick(xi) + 2, ph = rng.int(0, 8);
    for (let k = r.k0 + 1; k < r.k1; k++) { if ((k + ph) % 9 >= 6) continue; for (let h = 0; h < 6; h++) pe(x, jb + h, k, M.drywall); }
  }
  const area = (r.i1 - r.i0) * (r.k1 - r.k0), nf = Math.round(area / 150 * (o.furn ?? 1));
  for (let t = 0; t < nf; t++) {
    const i = rng.int(r.i0 + 2, r.i1 - 4), k = rng.int(r.k0 + 2, r.k1 - 4), w = rng.int(1, 3), d = rng.int(1, 2), h = rng.int(1, 2);
    for (let a = 0; a < w; a++) for (let c = 0; c < d; c++) for (let y = 0; y < h; y++) pe(i + a, jb + y, k + c, M.furniture);
  }
  for (let a = 0; a < P.nx; a++) for (let c = 0; c < P.nz; c++) if ((a + c + (jb >> 1)) % 3 === 0) {
    const i = P.xs[a] + (P.bx >> 1), k = P.zs[c] + (P.bz >> 1);
    if (i > r.i0 && i < r.i1 && k > r.k0 && k < r.k1) pe(i, jb + 5, k, M.light_white);
  }
}
function fitAll(P, r, j0, floors, o) { for (let f = 0; f < floors; f++) fitout(P, r, j0 + f * FH, o); }
// free-standing rooftop sign on the wall line of side s
function roofSign(r, s, str, j, fg) {
  const w = textW(str) + 2, a0 = mid(r, s) - (w >> 1), a1 = a0 + w - 1;
  fbox(r, s, a0, a1, j, j + 7, 0, 0, M.metal_dark);
  ftext(r, s, str, a0 + (w >> 1), j + 2, 0, fg, 0);
  fbox(r, s, a0 + 1, a0 + 1, j, j + 3, -1, -2, M.steel_beam); fbox(r, s, a1 - 1, a1 - 1, j, j + 3, -1, -2, M.steel_beam);
}

// ============================ RECIPES =============================================

// Glass slab on pilotis: curtain wall, expressed service core, optional stepped top and lit crown.
export function towerGlass(A, v) {
  const P = plan(A, { skin: 1, bays: v.bays || [8, 7, 9, 6] });
  begin('office', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_white, 2);
  const mull = v.mull || M.metal_dark, back = v.front ^ 1, coreBi = ((back < 2 ? P.nx : P.nz) - 1) >> 1;
  const cw0 = ST.curtain({ glass: v.glass, span: v.span, mull, lit: v.lit ?? 0.2, sill: v.sill });
  const cw = (q) => (v.core && q.s === back && q.bi === coreBi && q.p >= 0) ? ((q.p === 2 || q.p === q.b - 1) ? mull : v.core) : cw0(q);
  const lob = ST.lobby({ glass: M.glass, wall: v.base || M.stone, lit: 0.45 });
  const arc = (P.nx >= 3 && P.nz >= 3 && v.arcade !== false) ? { i0: P.xs[1], k0: P.zs[1], i1: P.xs[P.nx - 1] + 1, k1: P.zs[P.nz - 1] + 1 } : null;
  const style = (q) => q.f === 0 ? lob(q) : cw(q);
  const n1 = v.floors - (v.step || 0);
  let top = mass(P, P, J0, n1, style, { arcade: arc, col: v.col || M.concrete, nf: v.floors });
  let R = P;
  fitAll(P, inset(P, 1), J0 + FH, n1 - 1, {});
  if (v.step) {   // upper block steps back one bay from the front and from one flank: an L-shaped terrace
    const f = v.front, fl = v.stepFlank ? 1 : 0;
    const a0 = (f === 2 ? 1 : 0) + (f < 2 && !fl ? 1 : 0), a1 = P.nx - (f === 3 ? 1 : 0) - (f < 2 && fl ? 1 : 0);
    const c0 = (f === 0 ? 1 : 0) + (f >= 2 && !fl ? 1 : 0), c1 = P.nz - (f === 1 ? 1 : 0) - (f >= 2 && fl ? 1 : 0);
    parapet(P, top, 1, mull); ring(P.i0, top + 2, P.k0, P.i1, top + 2, P.k1, M.glass);
    R = sub(P, a0, a1, c0, c1);
    const t2 = mass(P, R, top + 1, v.step, style, { f0: n1, col: v.col || M.concrete });
    fitAll(P, inset(R, 1), top + 1, v.step, {});
    // terrace planters
    for (let t = 0; t < 4; t++) { const i = f === 3 ? P.i1 - 5 : f === 2 ? P.i0 + 2 : P.i0 + 4 + t * 9, k = f === 1 ? P.k1 - 5 : f === 0 ? P.k0 + 2 : P.k0 + 4 + t * 9; if (i + 3 < P.i1 && k + 3 < P.k1) { box(i, top + 1, k, i + 3, top + 1, k + 3, M.stone); box(i + 1, top + 2, k + 1, i + 2, top + 2, k + 2, M.foliage); } }
    top = t2;
  }
  const dr = arc || P;
  for (const s of v.doors || [v.front]) door(dr, s, mid(dr, s), 4, 5, arc ? 0 : M.metal_dark);
  if (arc) { // soffit lights under the overhang
    for (let i = P.i0 + 3; i < P.i1 - 2; i += 4) { put(i, J0 + 5, P.k0 + 3, M.light_white); put(i, J0 + 5, P.k1 - 3, M.light_white); }
    for (let k = P.k0 + 3; k < P.k1 - 2; k += 4) { put(P.i0 + 3, J0 + 5, k, M.light_white); put(P.i1 - 3, J0 + 5, k, M.light_white); }
    box(dr.i0 + 3, J0, dr.k0 + 3, dr.i0 + 8, J0 + 1, dr.k0 + 5, M.furniture);       // reception desk
  }
  // crown
  if (v.crown === 'screen') {
    ring(R.i0, top + 1, R.k0, R.i1, top + 5, R.k1, mull);
    for (let i = R.i0 + 2; i < R.i1 - 1; i += 2) { box(i, top + 3, R.k0, i, top + 4, R.k0, 0); box(i, top + 3, R.k1, i, top + 4, R.k1, 0); }
    for (let k = R.k0 + 2; k < R.k1 - 1; k += 2) { box(R.i0, top + 3, k, R.i0, top + 4, k, 0); box(R.i1, top + 3, k, R.i1, top + 4, k, 0); }
    ring(R.i0, top + 6, R.k0, R.i1, top + 6, R.k1, v.neon || M.neon_cyan);
  } else {
    parapet(R, top, 2, mull);
    ring(R.i0, top + 3, R.k0, R.i1, top + 3, R.k1, v.neon || M.light_white);
  }
  if (v.core) { // the core rises past the roof as a blank shaft
    const ls = back < 2 ? P.xs : P.zs, b = back < 2 ? P.bx : P.bz, a0 = ls[coreBi] + 2, a1 = ls[coreBi] + b - 1;
    if (a0 >= sideLo(R, back) && a1 <= sideHi(R, back)) { fbox(R, back, a0, a1, top + 1, top + 8, 0, -5, v.core); fbox(R, back, a0 + 1, a1 - 1, top + 1, top + 7, -1, -4, 0); fput(R, back, a0, top + 9, 0, M.light_red); fput(R, back, a1, top + 9, 0, M.light_red); }
  }
  if (v.sign) roofSign(R, v.front, v.sign, top + (v.crown === 'screen' ? 7 : 4), v.signCol || M.neon_orange);
  const cx = (R.i0 + R.i1) >> 1, cz = (R.k0 + R.k1) >> 1;
  const ph = { i0: cx - 6, i1: cx + 6, k0: cz - 5, k1: cz + 5 };
  if (v.mast) { box(cx - 2, top + 1, cz - 2, cx + 2, top + 3, cz + 2, M.concrete_dark); box(cx - 1, top + 4, cz - 1, cx + 1, top + 5, cz + 1, M.metal_dark); antenna(cx, top + 6, cz, Math.max(4, Math.min(v.mast, 92 - top - 7))); }
  else penthouse(ph, top, 4, M.hvac);
  roofKit(inset(R, 2), top, { wall: M.concrete, skip: (i, k) => i > cx - 12 && i < cx + 8 && k > cz - 11 && k < cz + 7 });
  end();
}

// Stepped stone tower, three tiers, uplit setbacks and a spire.
export function towerDeco(A, v) {
  const P = plan(A, { skin: 0, bays: [8, 7, 6] });
  begin('office', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_white, 2);
  const wall = v.wall || M.stone, span = v.span || M.concrete_dark;
  const up = ST.pier({ wall, span, glass: M.glass_dark, lit: v.lit ?? 0.2, sill: 1, head: 5 });
  const gr = ST.shop({ wall, base: M.concrete_dark, lit: 0.6, fascia: M.copper });
  const style = (q) => q.f === 0 ? gr(q) : (q.h === 6 && q.f === q.nf - 1 && q.p >= 3 && q.p < q.b - 1 && (q.p & 1)) ? M.light_amber : up(q);
  let a0 = 0, a1 = P.nx, c0 = 0, c1 = P.nz, j = J0, f0 = 0, r = P, top = 0;
  const tiers = v.tiers || [5, 4, 3];
  for (let t = 0; t < tiers.length; t++) {
    r = sub(P, a0, a1, c0, c1);
    top = mass(P, r, j, tiers[t], style, { f0, col: M.concrete });
    fitAll(P, r, j + (t === 0 ? FH : 0), tiers[t] - (t === 0 ? 1 : 0), {});
    pilasters(P, r, j, top + 1, wall);
    parapet(r, top, 1, wall);
    for (const x of [r.i0, r.i1 - 1]) for (const z of [r.k0, r.k1 - 1]) { box(x, top + 1, z, x + 1, top + 3, z + 1, wall); put(x, top + 4, z, M.copper); put(x + 1, top + 4, z + 1, M.copper); put(x + 1, top + 4, z, M.copper); put(x, top + 4, z + 1, M.copper); }
    j = top + 1; f0 += tiers[t];
    let ch = false;
    if (a1 - a0 >= 3) { a0++; a1--; ch = true; }
    if (c1 - c0 >= 3) { c0++; c1--; ch = true; }
    if (!ch) break;
  }
  door(P, v.front, mid(P, v.front), 4, 5, M.copper);
  if (v.sign) ftext(P, v.front, v.sign, mid(P, v.front), J0 + FH + 1, 0, M.neon_orange, M.metal_dark);
  const cx = (r.i0 + r.i1) >> 1, cz = (r.k0 + r.k1) >> 1;
  box(cx - 2, top + 1, cz - 2, cx + 2, top + 2, cz + 2, wall); box(cx - 1, top + 3, cz - 1, cx + 1, top + 4, cz + 1, M.copper);
  antenna(cx, top + 5, cz, Math.max(3, Math.min(9, 92 - top - 6)));
  end();
}

// Wide podium with a slender ribbon-window tower at one corner and a roof garden.
export function towerPodium(A, v) {
  const P = plan(A, { skin: 0, bays: [8, 7, 6] });
  begin('office', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_white, 2);
  const pw = v.podWall || M.concrete, pf = v.podFloors || 3;
  const pst = ST.pier({ wall: pw, glass: M.glass, lit: 0.3, mid: M.metal_dark });
  const gst = ST.shop({ wall: pw, base: M.concrete_dark, lit: 0.7 });
  const ptop = mass(P, P, J0, pf, (q) => q.f === 0 ? gst(q) : pst(q), { col: M.concrete });
  fitAll(P, P, J0, pf, { furn: 1.3 });
  const tx = Math.min(P.nx, Math.max(2, Math.ceil(P.nx * 0.6))), tz = Math.min(P.nz, Math.max(2, Math.ceil(P.nz * 0.6)));
  const a0 = v.cx ? P.nx - tx : 0, c0 = v.cz ? P.nz - tz : 0;
  const r = sub(P, a0, a0 + tx, c0, c0 + tz);
  const tst = ST.ribbon({ wall: v.wall || M.tile_white, glass: v.glass || M.glass_dark, lit: v.lit ?? 0.22 });
  const top = mass(P, r, ptop + 1, v.floors, tst, { f0: pf, col: M.concrete_dark });
  fitAll(P, r, ptop + 1, v.floors, {});
  // podium roof garden with glass balustrade
  parapet(P, ptop, 1, pw); ring(P.i0, ptop + 2, P.k0, P.i1, ptop + 2, P.k1, M.glass);
  const inT = (i, k) => i >= r.i0 - 1 && i <= r.i1 + 1 && k >= r.k0 - 1 && k <= r.k1 + 1;
  for (let t = 0; t < 10; t++) {
    const i = C.rng.int(P.i0 + 3, P.i1 - 8), k = C.rng.int(P.k0 + 3, P.k1 - 8);
    if (inT(i, k) || inT(i + 5, k + 5) || inT(i + 5, k) || inT(i, k + 5)) continue;
    if (get(i, ptop + 1, k) || get(i + 4, ptop + 1, k + 4)) continue;
    box(i, ptop + 1, k, i + 4, ptop + 1, k + 4, M.stone); box(i + 1, ptop + 1, k + 1, i + 3, ptop + 1, k + 3, M.grass);
    if (t % 2 === 0) tree(i + 2, k + 2, 0, ptop + 2); else box(i + 1, ptop + 2, k + 1, i + 3, ptop + 2, k + 3, M.foliage);
  }
  for (const s of [v.front, v.front ^ 1]) { door(P, s, mid(P, s), 4, 5); awning(P, s, sideLo(P, s) + 2, mid(P, s) - 4, M.awning_green); awning(P, s, mid(P, s) + 4, sideHi(P, s) - 2, M.awning_green); }
  parapet(r, top, 2, v.wall || M.tile_white);
  if (v.sign) roofSign(r, v.front, v.sign, top + 3, v.signCol || M.neon_cyan);
  if (v.helipad) {
    const cx = (r.i0 + r.i1) >> 1, cz = (r.k0 + r.k1) >> 1;
    for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) { const d = Math.sqrt(a * a + c * c); if (d < 6.5) put(cx + a, top, cz + c, d > 5.3 ? M.line_yellow : M.concrete_dark); }
    box(cx - 2, top, cz - 3, cx - 2, top, cz + 3, M.line_white); box(cx + 2, top, cz - 3, cx + 2, top, cz + 3, M.line_white); box(cx - 2, top, cz, cx + 2, top, cz, M.line_white);
    for (const [a, c] of [[r.i0 + 1, r.k0 + 1], [r.i1 - 1, r.k0 + 1], [r.i0 + 1, r.k1 - 1], [r.i1 - 1, r.k1 - 1]]) put(a, top + 1, c, M.light_green);
  } else roofKit(inset(r, 2), top, { wall: M.concrete });
  end();
}

// Two glass volumes of different height and tint sharing one frame.
export function towerTwin(A, v) {
  const P = plan(A, { skin: 1, bays: [8, 7, 9, 6] });
  begin('office', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_white, 2);
  const alongX = P.nx >= P.nz, n = alongX ? P.nx : P.nz, m = Math.max(1, Math.min(n - 1, Math.round(n * 0.55)));
  const flip = v.flip;
  const rT = alongX ? (flip ? sub(P, n - m, n, 0, P.nz) : sub(P, 0, m, 0, P.nz)) : (flip ? sub(P, 0, P.nx, n - m, n) : sub(P, 0, P.nx, 0, m));
  const rW = alongX ? (flip ? sub(P, 0, n - m, 0, P.nz) : sub(P, m, n, 0, P.nz)) : (flip ? sub(P, 0, P.nx, 0, n - m) : sub(P, 0, P.nx, m, n));
  const lob = ST.lobby({ glass: M.glass, wall: M.concrete_dark, lit: 0.5 });
  const cw1 = ST.curtain({ glass: M.glass, span: M.concrete, mull: M.metal_panel, lit: 0.25, sill: true });
  const cw2 = ST.curtain({ glass: v.glass || M.glass_dark, span: v.span || M.metal_dark, mull: M.metal_dark, lit: v.lit ?? 0.18 });
  const wtop = mass(P, rW, J0, v.wing, (q) => q.f === 0 ? lob(q) : cw1(q), {});
  const top = mass(P, rT, J0, v.floors, (q) => q.f === 0 ? lob(q) : cw2(q), { col: M.concrete_dark });
  fitAll(P, inset(rW, 1), J0 + FH, v.wing - 1, {}); fitAll(P, inset(rT, 1), J0 + FH, v.floors - 1, {});
  for (const s of [v.front, v.front ^ 1]) door(P, s, mid(rT, s) , 4, 5);
  parapet(rW, wtop, 2, M.concrete); parapet(rT, top, 3, M.metal_dark);
  ring(rT.i0, top + 4, rT.k0, rT.i1, top + 4, rT.k1, v.neon || M.neon_magenta);
  roofKit(inset(rT, 2), top, { wall: M.concrete_dark });
  // wing roof: billboard facing the front, plant
  const inTall = (i, k) => i >= rT.i0 - 6 && i <= rT.i1 + 2 && k >= rT.k0 - 6 && k <= rT.k1 + 2;
  roofKit(inset(rW, 3), wtop, { skip: inTall, noBulk: true });
  if (v.board) {
    const s = v.front, w = Math.min(23, (s < 2 ? rW.i1 - rW.i0 : rW.k1 - rW.k0) - 5), lo = mid(rW, s) - (w >> 1);
    if (s < 2) billboard(lo, wtop + 6, s === 0 ? rW.k0 + 1 : rW.k1 - 1, 0, w, 10, 5, v.board, s === 0 ? -1 : 1, M.neon_magenta);
    else billboard(s === 2 ? rW.i0 + 1 : rW.i1 - 1, wtop + 6, lo, 1, w, 10, 5, v.board, s === 2 ? -1 : 1, M.neon_magenta);
  }
  end();
}

// Masonry hotel: stone base, punched lit windows, mansard, blade sign, marquee.
export function hotel(A, v) {
  const P = plan(A, { skin: 0, bays: [7, 6, 8] });
  begin('hotel', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_white, 2);
  const wall = v.wall || M.brick_tan, nf = v.floors;
  const up = ST.punched({ wall, glass: M.glass_dark, lit: 0.42, ww: 3, trim: M.stone });
  const base = ST.shop({ wall: M.stone, base: M.concrete_dark, lit: 0.8, fascia: M.stone });
  const b2 = ST.punched({ wall: M.stone, glass: M.glass, lit: 0.6, ww: 4, trim: M.stone });
  const man = ST.punched({ wall: M.roof_tile, glass: M.window_lit, lit: 0.5, ww: 2, trim: M.roof_tile });
  const style = (q) => q.f === 0 ? base(q) : q.f === 1 ? b2(q) : q.f === nf - 1 ? man(q) : (q.h === 6 && q.f === nf - 2) ? M.stone : up(q);
  const top = mass(P, P, J0, nf, style, { roof: M.roof_tile });
  fitAll(P, P, J0 + FH, nf - 1, { part: 1, furn: 1.4 });
  const jc = J0 + (nf - 1) * FH - 1;
  ring(P.i0 - 1, jc, P.k0 - 1, P.i1 + 1, jc, P.k1 + 1, M.stone);                 // cornice under the mansard
  ring(P.i0 - 1, J0 + 2 * FH - 1, P.k0 - 1, P.i1 + 1, J0 + 2 * FH - 1, P.k1 + 1, M.stone);
  parapet(P, top, 1, M.roof_tile);
  pilasters(P, P, J0, J0 + 2 * FH - 2, M.stone);
  const s = v.front, m = mid(P, s);
  door(P, s, m, 6, 5, 0);
  fbox(P, s, m - 6, m + 6, J0 + 6, J0 + 7, 1, 4, M.awning_red); fbox(P, s, m - 6, m + 6, J0 + 5, J0 + 5, 4, 4, M.awning_red);
  for (let a = m - 5; a <= m + 5; a += 2) fput(P, s, a, J0 + 5, 2, M.light_white);
  fbox(P, s, m - 6, m - 6, J0, J0 + 5, 4, 4, M.metal_dark); fbox(P, s, m + 6, m + 6, J0, J0 + 5, 4, 4, M.metal_dark);
  const jt = Math.min(top - 8, J0 + 3 * FH + 31);
  blade(P, s, 'HOTEL', v.bladeAt === 'hi' ? sideHi(P, s) - 1 : sideLo(P, s) + 1, jt, v.signCol || M.neon_magenta, M.metal_dark);
  roofKit(inset(P, 2), top, { tank: true, wall: wall });
  end();
}

// Mid-rise office: masonry/tile grid, shop base, heavy cornice.
export function officeMid(A, v) {
  const P = plan(A, { skin: 0, bays: v.bays || [8, 7, 6], alignX: v.alignX, alignZ: v.alignZ });
  begin('office', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.floor, 2);
  const wall = v.wall, blank = v.blank || [];
  const up = ST.pier({ wall, span: v.span, glass: v.glass || M.glass, lit: v.lit ?? 0.25, mid: v.mid, sill: v.sill ?? 1 });
  const gr = ST.shop({ wall, base: v.base || M.concrete_dark, lit: 0.65 });
  const top = mass(P, P, J0, v.floors, (q) => blank.includes(q.s) ? wall : q.f === 0 ? gr(q) : up(q), { col: v.col || M.concrete });
  fitAll(P, P, J0, v.floors, {});
  if (v.pil) pilasters(P, P, J0, top + 2, v.pil, [0, 1, 2, 3].filter(s => !blank.includes(s)));
  parapet(P, top, 2, wall, v.cornice || M.stone);
  if (v.pil) ring(P.i0 - 2, top + 2, P.k0 - 2, P.i1 + 2, top + 2, P.k1 + 2, v.cornice || M.stone);
  for (const s of v.doors || [v.front]) { door(P, s, mid(P, s), 4, 5); }
  if (v.awn) for (const s of [0, 1, 2, 3]) if (!blank.includes(s) && s !== v.front) awning(P, s, sideLo(P, s) + 2, sideHi(P, s) - 2, v.awn);
  if (v.sign) roofSign(P, v.front, v.sign, top + 3, v.signCol || M.neon_orange);
  roofKit(inset(P, 2), top, { tank: v.tank, wall });
  end();
  return P;
}

// Brick walk-up: load-bearing walls, punched windows, balconies, fire escape, cornice, water tank.
export function apartment(A, v) {
  const P = plan(A, { skin: 0, bays: v.bays || [7, 6, 8], alignX: v.alignX, alignZ: v.alignZ });
  begin('apartment', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.floor, 2);
  const wall = v.wall, nf = v.floors, blank = v.blank || [], trim = v.trim || M.stone;
  const up = ST.punched({ wall, glass: M.glass_dark, lit: v.lit ?? 0.33, ww: 3, trim });
  const gr = ST.punched({ wall: v.base || M.stone, glass: M.glass_dark, lit: 0.4, ww: 3, trim });
  const style = (q) => blank.includes(q.s) ? (q.h === 6 && q.f === nf - 1 ? trim : wall) : q.f === 0 ? gr(q) : (q.h === 6 && q.f === nf - 1) ? trim : up(q);
  const top = mass(P, P, J0, nf, style, { col: wall });
  fitAll(P, P, J0, nf, { part: 1, furn: 1.5 });
  // balconies: whole vertical stacks on alternating bays
  for (const s of v.balc || []) {
    const ls = s < 2 ? P.xs : P.zs, b = s < 2 ? P.bx : P.bz, n = ls.length - 1;
    for (let bi = 0; bi < n; bi++) {
      if (hsh(C.cur.id, s, bi) > (v.balcFrac ?? 0.5)) continue;
      const a0 = ls[bi] + 2, a1 = ls[bi] + b - 1;
      for (let f = 1; f < nf; f++) {
        const jf = J0 + f * FH - 1;
        fbox(P, s, a0, a1, jf, jf, 1, 3, v.trim || M.stone);
        fbox(P, s, a0, a1, jf + 1, jf + 1, 3, 3, M.metal_dark); fbox(P, s, a0, a0, jf + 1, jf + 1, 1, 2, M.metal_dark); fbox(P, s, a1, a1, jf + 1, jf + 1, 1, 2, M.metal_dark); fput(P, s, a0, jf + 2, 3, M.metal_dark); fput(P, s, a1, jf + 2, 3, M.metal_dark);
        const w0 = a0 + ((b - 2 - 3) >> 1);
        fbox(P, s, w0, w0 + 1, jf + 1, jf + 5, 0, 0, hsh(C.cur.id + 5, f, bi * 4 + s) < 0.4 ? M.window_lit : M.glass_dark);
        if (hsh(C.cur.id + 9, f, bi * 4 + s) < 0.3) fput(P, s, a1 - 1, jf + 1, 2, M.foliage);
      }
    }
  }
  // fire escape: landings at every floor with a zig-zag stair
  if (v.fire !== undefined) {
    const s = v.fire, ls = s < 2 ? P.xs : P.zs, b = s < 2 ? P.bx : P.bz, bi = Math.min(ls.length - 2, v.fireBay ?? 0), a0 = ls[bi] + 1, a1 = ls[bi] + b;
    for (let f = 1; f < nf; f++) {
      const jf = J0 + f * FH - 1;
      fbox(P, s, a0, a1, jf, jf, 1, 2, M.metal_dark); fbox(P, s, a0, a1, jf + 2, jf + 2, 2, 2, M.metal_dark);
      fbox(P, s, a0, a0, jf + 1, jf + 2, 2, 2, M.metal_dark); fbox(P, s, a1, a1, jf + 1, jf + 2, 2, 2, M.metal_dark);
      if (f < nf - 1) for (let t = 0; t < 6; t++) { const a = (f & 1) ? a0 + 1 + t : a1 - 1 - t; fbox(P, s, a, a, jf + 1 + t, jf + 2 + t, 1, 1, M.metal_dark); }
    }
    fbox(P, s, a0 + 1, a0 + 1, J0 + 3, J0 + FH - 1, 1, 1, M.metal_dark);
  }
  parapet(P, top, 2, wall, trim);
  const s = v.front, m = mid(P, s);
  door(P, s, m, 3, 5, v.awn || M.awning_green, 3);
  fbox(P, s, m - 3, m + 3, J0, J0, 1, 2, M.stone);                                // stoop
  if (v.shopFront !== undefined) { const t = v.shopFront; awning(P, t, sideLo(P, t) + 2, sideHi(P, t) - 2, v.awn || M.awning_red); }
  if (v.paint) for (const bs of blank) if (textW(v.paint) + 4 <= sideHi(P, bs) - sideLo(P, bs) + 1 && nf >= 4) ftext(P, bs, v.paint, mid(P, bs), J0 + (nf - 2) * FH + 1, 0, M.tile_white, 0);
  roofKit(inset(P, 2), top, { tank: true, wall });
  end();
  return P;
}

// Small shop with an awning, lit window and a neon sign. A is the exact footprint.
export function shop(A, v) {
  const P = plan(A, { skin: 0, bays: [11, 10, 9, 8, 7, 6, 5] , baysZ: v.baysZ, baysX: v.baysX, alignX: v.alignX, alignZ: v.alignZ });
  begin('shop', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.tile_teal, 2);
  const wall = v.wall, nf = v.floors, blank = v.blank || [];
  const gr = ST.shop({ wall, base: v.base || M.concrete_dark, lit: 0.7, fascia: v.fascia || M.metal_dark });
  const up = ST.punched({ wall, glass: M.glass_dark, lit: 0.4, ww: 3, trim: v.trim || M.stone });
  const top = mass(P, P, J0, nf, (q) => blank.includes(q.s) ? wall : q.f === 0 ? gr(q) : up(q), { col: wall });
  fitAll(P, P, J0, nf, { part: 0.5, furn: 2.2 });
  // shelves / counter
  const cx = (P.i0 + P.i1) >> 1, cz = (P.k0 + P.k1) >> 1;
  box(cx - 2, J0, cz - 1, cx + 2, J0 + 1, cz, M.furniture);
  parapet(P, top, 2, wall, v.trim || 0);
  for (const s of v.fronts) {
    const m = mid(P, s), lo = sideLo(P, s), hi = sideHi(P, s);
    door(P, s, m + (v.doorOff || 0), 3, 5, 0);
    awning(P, s, lo + 1, hi - 1, v.awn);
    const L = hi - lo + 1, str = (v.sign && textW(v.sign) + 2 <= L) ? v.sign : (v.short && textW(v.short) + 2 <= L) ? v.short : null;
    if (str) {
      if (nf === 1) { // false front
        const w = Math.min(L, textW(str) + 6), a0 = m - (w >> 1);
        fbox(P, s, lo, hi, top + 1, top + 3, 0, 0, wall);
        fbox(P, s, a0, a0 + w - 1, top + 1, top + 8, 0, 0, wall); fbox(P, s, a0, a0 + w - 1, top + 9, top + 9, 0, 0, v.trim || M.stone);
        ftext(P, s, str, m, top + 3, 0, v.neon, M.metal_dark);
      } else roofSign(P, s, str, top + 3, v.neon);
    } else if (v.sign) fbox(P, s, lo + 2, hi - 2, top + 1, top + 1, 0, 0, v.neon);
    if (nf >= 2) fbox(P, s, lo, lo, J0 + 8, J0 + 12, 1, 2, v.neon);                 // small blade light at the party wall
  }
  if (v.paint && nf >= 2) for (const s of v.paintSides || []) if (textW(v.paint) + 4 <= sideHi(P, s) - sideLo(P, s) + 1) ftext(P, s, v.paint, mid(P, s), J0 + FH + 1, 0, M.tile_white, 0);
  roofKit(inset(P, 2), top, { wall, noBulk: nf === 1 });
  end();
  return P;
}

// Open-deck parking structure with scissor ramps and a stair tower.
export function parking(A, v) {
  const P = plan(A, { skin: 0, bays: [10, 9, 8] });
  begin('parking', v.name);
  surface(P.i0, P.k0, P.i1, P.k1, M.concrete_dark, 2);
  const decks = v.decks || 4, s0 = v.front, eb = Math.max(0, ((s0 < 2 ? P.nx : P.nz) >> 1));
  const st = (q) => {
    if (q.h === 6) return q.p >= 0 && q.p < 2 ? M.concrete_dark : M.concrete;
    if (q.h < 2) { if (q.f === 0 && q.s === s0 && (q.bi === eb || q.bi === eb - 1) && q.p >= 2) return 0; return q.p >= 0 && q.p < 2 ? M.concrete_dark : M.concrete; }
    return 0;
  };
  const top = mass(P, P, J0, decks, st, { col: M.concrete_dark, slab: M.concrete, roof: M.concrete });
  parapet(P, top, 2, M.concrete);
  // ramps: two strips along x in the first two z bays (far from the entrance side if possible)
  const zA = s0 === 0 ? P.nz - 1 : 0, zB = s0 === 0 ? P.nz - 2 : 1;
  const run = Math.min(24, P.xs[P.nx - 1] - P.xs[1] - 4);
  for (let f = 0; f < decks; f++) {
    const jb = J0 + f * FH, zi = (f & 1) ? zB : zA, k0 = P.zs[zi] + 2, k1 = P.zs[zi] + P.bz - 1;
    const xa = (f & 1) ? P.xs[P.nx - 1] - 2 : P.xs[1] + 3, dir = (f & 1) ? -1 : 1;
    for (let t = 0; t < run; t++) {
      const n = Math.floor(t * 6 / run) + 1, x = xa + dir * t;
      box(x, jb + 6, k0, x, jb + 6, k1, 0);
      box(x, jb - 2 + n, k0, x, jb - 1 + n, k1, M.concrete);
      if (t % 6 === 0) box(x, jb, k0, x, jb - 2 + n, k0, M.concrete_dark), box(x, jb, k1, x, jb - 2 + n, k1, M.concrete_dark);
    }
    for (let t = 0; t < run; t += 3) { const x = xa + dir * t; put(x, jb + 6, k0 - 1, M.hazard); put(x, jb + 6, k1 + 1, M.hazard); }
  }
  // parked cars + bay lines + lights
  const rng = C.rng;
  for (let f = 0; f <= decks; f++) {
    const j = J0 + f * FH;
    for (let c = 0; c < P.nz; c++) {
      if (c === zA || c === zB) continue;
      for (let a = 0; a < P.nx; a++) {
        const x = P.xs[a] + 2, z = P.zs[c] + 2;
        if (f > 0) put(P.xs[a] + (P.bx >> 1), j - 1, P.zs[c] + 1, M.line_white), put(P.xs[a] + (P.bx >> 1), j - 1, P.zs[c] + 2, M.line_white), put(P.xs[a] + (P.bx >> 1), j - 1, P.zs[c] + 3, M.line_white);
        if (f === 0 && c === 0 && s0 === 0 || f === 0 && c === P.nz - 1 && s0 === 1) continue;
        if (rng() < 0.3 && P.bz >= 9 + 0 && P.bx >= 8) car(x + rng.int(0, P.bx - 6), j, z + (P.bz > 10 ? 1 : 0), 1, rng() < 0.5 ? 1 : -1);
        if (f < decks && (a + c) % 2 === 0) put(P.xs[a] + (P.bx >> 1), j + 5, P.zs[c] + (P.bz >> 1), M.light_white);
      }
    }
  }
  // stair tower in a corner away from the ramps
  const ta = v.towerHi ? P.nx - 1 : 0, tc = s0 === 0 ? 0 : P.nz - 1;
  const tr = { i0: P.xs[ta] , i1: P.xs[ta] + 7, k0: tc === 0 ? P.k0 : P.k1 - 7, k1: tc === 0 ? P.k0 + 7 : P.k1 };
  if (ta > 0) { tr.i0 = P.i1 - 7; tr.i1 = P.i1; }
  ring(tr.i0, J0, tr.k0, tr.i1, top + 8, tr.k1, M.concrete_dark); box(tr.i0, top + 9, tr.k0, tr.i1, top + 9, tr.k1, M.concrete_dark);
  const ts = tc === 0 ? 0 : 1;
  fbox(tr, ts, tr.i0 + 3, tr.i0 + 4, J0 + 7, top + 6, 0, 0, M.window_lit);
  fbox(tr, ts, tr.i0 + 3, tr.i0 + 4, J0, J0 + 4, 0, 0, 0);
  for (let f = 1; f <= decks; f++) { const jj = J0 + f * FH; box(tr.i0 + 1, jj, tc === 0 ? tr.k1 : tr.k0, tr.i1 - 1, jj + 4, tc === 0 ? tr.k1 : tr.k0, 0); }
  ftext(tr, ts, 'P', tr.i0 + 3, top + 2, 0, M.neon_cyan, M.metal_dark);
  // entrance sign + barrier
  const m = P.xs !== undefined ? ((s0 < 2 ? P.xs[eb] : P.zs[eb]) + 1) : 0;
  ftext(P, s0, 'PARK', m, J0 + FH + 1, 0, M.neon_cyan, M.metal_dark);
  fbox(P, s0, m - 9, m + 9, J0 + FH, J0 + FH, 0, 0, M.metal_dark); fbox(P, s0, m - 9, m + 9, J0 + FH + 6, J0 + FH + 6, 0, 0, M.metal_dark);
  for (let t = -6; t <= 6; t += 2) fput(P, s0, m + t, J0 + 5, 0, M.hazard);
  for (let l = 2; l < 6; l++) put(P.xs[P.nx] - 1, top + l, tc === 0 ? P.k1 - 1 : P.k0 + 1, M.metal_dark);
  put(P.xs[P.nx] - 1, top + 6, tc === 0 ? P.k1 - 1 : P.k0 + 1, M.light_white);
  end();
}

// Brick warehouse with a sawtooth roof, roll-up doors, dock and a container yard.
export function warehouse(A, v) {
  const yard = 13, r = { i0: v.yardHi ? A.i0 : A.i0 + yard, k0: A.k0, i1: v.yardHi ? A.i1 - yard : A.i1, k1: A.k1 };
  const wall = M.brick_dark, eave = J0 + 19, s = v.front;
  begin('warehouse', v.name);
  surface(r.i0, r.k0, r.i1, r.k1, M.concrete_dark, 2);
  ring(r.i0, J0, r.k0, r.i1, eave, r.k1, wall); ring(r.i0, J0, r.k0, r.i1, J0 + 1, r.k1, M.concrete);
  ring(r.i0, eave, r.k0, r.i1, eave, r.k1, M.stone);
  const hx = (x) => eave + 4 - (((x - r.i0) % 8) >> 1);
  for (let x = r.i0; x <= r.i1; x++) {
    const t = (x - r.i0) % 8, h = hx(x);
    box(x, h - 1, r.k0, x, h, r.k1, M.metal_panel);
    box(x, eave + 1, r.k0, x, h, r.k0, wall); box(x, eave + 1, r.k1, x, h, r.k1, wall);
    if (t === 0) {
      box(x, eave + 1, r.k0 + 1, x, eave + 3, r.k1 - 1, M.glass);
      for (let k = r.k0 + 3; k < r.k1 - 2; k += 5) box(x, eave + 1, k, x, eave + 3, k, M.steel_beam);
      for (let k = r.k0 + 5; k < r.k1 - 6; k += 10) box(x, eave + 1, k, x, eave + 3, k + 2, M.window_lit);
      box(x, eave, r.k0 + 1, x, eave, r.k1 - 1, M.steel_beam);                  // truss
      box(x, J0, r.k0 + 1, x, eave - 1, r.k0 + 1, M.steel_beam); box(x, J0, r.k1 - 1, x, eave - 1, r.k1 - 1, M.steel_beam);
      if (x > r.i0 && x < r.i1) for (const kk of [r.k0, r.k1]) box(x, J0, kk, x + 1, eave, kk, M.brick_red);   // pilasters
    }
  }
  box(r.i0 + 1, eave, (r.k0 + r.k1) >> 1, r.i1 - 1, eave, (r.k0 + r.k1) >> 1, M.steel_beam);
  box(r.i1, eave + 1, r.k0, r.i1, eave + 1, r.k1, wall);
  // clerestory windows on the long sides
  for (let x = r.i0 + 3; x < r.i1 - 5; x += 8) for (const ss of [0, 1]) if (ss !== s) fbox(r, ss, x, x + 3, eave - 5, eave - 3, 0, 0, hsh(x, ss, 7) < 0.3 ? M.window_lit : M.glass_dark);
  // roll-up doors + dock on the front (a long side)
  const lo = sideLo(r, s), hi = sideHi(r, s), d1 = lo + 6, d2 = hi - 14;
  for (const [a, open] of [[d1, 3], [d2, 9]]) {
    fbox(r, s, a, a + 8, J0, J0 + 9, 0, 0, M.metal_panel);
    for (let y = 1; y < 10; y += 2) fbox(r, s, a, a + 8, J0 + y, J0 + y, 0, 0, M.metal_dark);
    fbox(r, s, a, a + 8, J0, J0 + open - 1, 0, 0, 0);
    fbox(r, s, a - 1, a + 9, J0 + 10, J0 + 10, 0, 1, M.hazard);
    fput(r, s, a + 4, J0 + 12, 1, M.light_white); fput(r, s, a + 4, J0 + 12, 0, M.metal_dark);
  }
  const mdl = (d1 + 9 + d2) >> 1;
  fbox(r, s, mdl - 1, mdl + 1, J0, J0 + 4, 0, 0, 0); fbox(r, s, mdl - 2, mdl + 2, J0 + 5, J0 + 5, 0, 1, M.metal_dark);
  if (v.sign && textW(v.sign) < hi - lo - 4) ftext(r, s, v.sign, (lo + hi) >> 1, eave - 7, 0, M.tile_white, 0);
  // interior stock
  const rng = C.rng;
  for (let t = 0; t < 7; t++) crateStack(rng.int(r.i0 + 3, r.i1 - 10), J0, rng.int(r.k0 + 3, r.k1 - 10), 5);
  barrels(r.i0 + 3, J0, r.k1 - 5, 6, 0.5); barrels(r.i1 - 6, J0, r.k0 + 3, 6, 0.5);
  // mezzanine office
  box(r.i1 - 12, J0 + 6, r.k0 + 1, r.i1 - 1, J0 + 6, r.k0 + 10, M.floor); box(r.i1 - 12, J0, r.k0 + 10, r.i1 - 12, J0 + 5, r.k0 + 10, M.steel_beam); box(r.i1 - 12, J0, r.k0 + 1, r.i1 - 12, J0 + 5, r.k0 + 1, M.steel_beam);
  box(r.i1 - 12, J0 + 7, r.k0 + 1, r.i1 - 12, J0 + 8, r.k0 + 10, M.metal_dark); put(r.i1 - 5, J0 + 5, r.k0 + 5, M.light_white);
  // chimney
  const cx = v.yardHi ? r.i0 + 3 : r.i1 - 5, cz = s === 0 ? r.k1 - 4 : r.k0 + 2;
  ring(cx, J0, cz, cx + 2, eave + 13, cz + 2, M.brick_red); ring(cx - 0, eave + 13, cz, cx + 2, eave + 13, cz + 2, M.stone);
  end();
  // yard: containers, fence, a truck-height stack
  const y0 = v.yardHi ? A.i1 - yard + 2 : A.i0, cols = [M.car_blue, M.car_red, M.copper, M.car_yellow, M.metal_panel, M.car_white];
  C.cur = null;
  surface(v.yardHi ? A.i1 - yard + 1 : A.i0, A.k0, v.yardHi ? A.i1 : A.i0 + yard - 1, A.k1, M.concrete_dark, 1);
  let k = A.k0 + 1;
  for (let n = 0; n < 3 && k + 12 < A.k1; n++) {
    const x = y0 + (n & 1 ? 5 : 0) + 0;
    container(x, J0, k, 1, cols[rng.int(0, 5)]);
    if (rng() < 0.6) container(x, J0 + 5, k, 1, cols[rng.int(0, 5)]);
    if (n === 0) container(x + 5, J0, k, 1, cols[rng.int(0, 5)]);
    k += 13;
  }
  end();
}

// Construction site: hoarding, steel skeleton with partial decks, tower crane.
export function construction(A, v) {
  begin('construction', v.name);
  surface(A.i0, A.k0, A.i1, A.k1, M.dirt, 1);
  const rng = C.rng, s = v.front;
  // hoarding
  ring(A.i0, J0, A.k0, A.i1, J0 + 3, A.k1, M.wood);
  for (let i = A.i0; i <= A.i1; i++) for (const kk of [A.k0, A.k1]) { if (((i >> 1) & 1) === 0) put(i, J0 + 3, kk, M.hazard); if (i % 8 === 0) box(i, J0, kk, i, J0 + 4, kk, M.wood_dark); }
  for (let k = A.k0; k <= A.k1; k++) for (const ii of [A.i0, A.i1]) { if (((k >> 1) & 1) === 0) put(ii, J0 + 3, k, M.hazard); if (k % 8 === 0) box(ii, J0, k, ii, J0 + 4, k, M.wood_dark); }
  const gm = mid(A, s); fbox(A, s, gm - 5, gm + 5, J0, J0 + 4, 0, 0, 0);
  fbox(A, s, gm - 6, gm - 6, J0, J0 + 6, 0, 0, M.steel_beam); fbox(A, s, gm + 6, gm + 6, J0, J0 + 6, 0, 0, M.steel_beam); fput(A, s, gm - 6, J0 + 7, 0, M.light_amber); fput(A, s, gm + 6, J0 + 7, 0, M.light_amber);
  // skeleton: crane side keeps a strip free
  const cHi = v.craneHi, I = { i0: cHi ? A.i0 + 4 : A.i0 + 13, i1: cHi ? A.i1 - 13 : A.i1 - 4, k0: A.k0 + 4, k1: A.k1 - 4 };
  const P = plan(I, { skin: 0, bays: [8, 7] });
  const X0 = P.xs[0], X1 = P.xs[P.nx], Z0 = P.zs[0], Z1 = P.zs[P.nz], nf = v.floors || 6;
  surface(X0, Z0, X1, Z1, M.concrete, 2);
  for (let f = 0; f < nf; f++) {
    const jb = J0 + f * FH;
    const xa = f >= nf - 1 ? Math.ceil(P.nx / 2) : 0;                // the top storey only exists over half the plan
    for (let a = xa; a <= P.nx; a++) for (let c = 0; c <= P.nz; c++) box(P.xs[a], jb, P.zs[c], P.xs[a], jb + 6, P.zs[c], M.steel_beam);
    for (let c = 0; c <= P.nz; c++) box(P.xs[xa], jb + 6, P.zs[c], X1, jb + 6, P.zs[c], M.steel_beam);
    for (let a = xa; a <= P.nx; a++) box(P.xs[a], jb + 6, Z0, P.xs[a], jb + 6, Z1, M.steel_beam);
    // decks
    const cover = f < 2 ? P.nx : f === 2 ? Math.ceil(P.nx * 0.6) : f === 3 ? 1 : 0;
    for (let a = 0; a < cover; a++) for (let c = 0; c < P.nz; c++) {
      if (f >= 2 && hsh(a, c, f) < 0.25) continue;
      box(P.xs[P.nx - 1 - a] + 1, jb + 6, P.zs[c] + 1, P.xs[P.nx - a] - 1, jb + 6, P.zs[c + 1] - 1, f < 2 ? M.floor : M.metal_panel);
    }
    // loose material on the decks
    if (f < 3) for (let t = 0; t < 3; t++) { const i = rng.int(X0 + 2, X1 - 4), k = rng.int(Z0 + 2, Z1 - 4); if (get(i, jb + 6, k) && get(i + 1, jb + 6, k + 1)) { box(i, jb + 7, k, i + 1, jb + 7 + rng.int(0, 1), k + 1, rng() < 0.5 ? M.crate : M.sandbag); } }
  }
  // rebar starter bars + precast panels on the back, green debris net on one side
  for (let a = 0; a <= P.nx; a++) for (let c = 0; c <= P.nz; c++) { const jt = J0 + (a >= Math.ceil(P.nx / 2) ? nf : nf - 1) * FH; box(P.xs[a], jt, P.zs[c], P.xs[a], jt + 1 + ((a + c) & 1), P.zs[c], M.rebar); }
  const R = { i0: X0, i1: X1, k0: Z0, k1: Z1 }, back = s ^ 1;
  for (let f = 0; f < 2; f++) for (let a = sideLo(R, back); a <= sideHi(R, back) - (f ? 9 : 0); a++) for (let h = 0; h < 6; h++) {
    const pp = (a - sideLo(R, back)) % (back < 2 ? P.bx : P.bz);
    if (pp >= 3 && pp <= 5 && h >= 2 && h <= 4) continue;
    fput(R, back, a, J0 + f * FH + h, 0, M.concrete);
  }
  const net = s < 2 ? 2 : 0;
  fbox(R, net, sideLo(R, net), sideHi(R, net) - 6, J0 + FH, J0 + 4 * FH - 2, 1, 1, M.awning_green);
  for (let a = sideLo(R, net); a <= sideHi(R, net) - 6; a += 4) fbox(R, net, a, a, J0, J0 + 4 * FH, 1, 1, M.metal_dark);
  for (let f = 1; f <= 4; f++) fbox(R, net, sideLo(R, net), sideHi(R, net) - 6, J0 + f * FH - 1, J0 + f * FH - 1, 1, 2, M.wood);
  // ground clutter
  const cxs = cHi ? A.i1 - 11 : A.i0 + 2;
  sandbags(cxs, J0, A.k0 + 3, 0, 7); crateStack(cxs, J0, A.k1 - 12, 5);
  box(cxs + 1, J0, A.k0 + 7, cxs + 9, J0, A.k0 + 9, M.pipe); box(cxs + 1, J0 + 1, A.k0 + 7, cxs + 9, J0 + 1, A.k0 + 8, M.pipe);
  // site cabin
  const cb = { i0: cxs, i1: cxs + 8, k0: A.k1 - 22, k1: A.k1 - 17 };
  box(cb.i0, J0, cb.k0, cb.i1, J0 + 5, cb.k1, M.metal_panel); box(cb.i0 + 1, J0, cb.k0 + 1, cb.i1 - 1, J0 + 4, cb.k1 - 1, 0);
  box(cb.i0 + 2, J0 + 2, cb.k0, cb.i0 + 4, J0 + 3, cb.k0, M.window_lit); box(cb.i0, J0, cb.k0 + 2, cb.i0, J0 + 3, cb.k0 + 3, 0); box(cb.i0, J0 + 5, cb.k0, cb.i1, J0 + 5, cb.k1, M.hazard);
  // dirt mounds
  for (let t = 0; t < 3; t++) { const i = cxs + 2 + t * 2, k = (A.k0 + A.k1 >> 1) - 4 + t * 3; box(i - 2, J0, k - 2, i + 2, J0, k + 2, M.dirt); box(i - 1, J0 + 1, k - 1, i + 1, J0 + 1, k + 1, M.dirt); }
  end();
  // ---- tower crane (its own building so it can be toppled on its own) ----
  begin('crane', 'Tower crane');
  const ci = cHi ? A.i1 - 8 : A.i0 + 5, ck = (A.k0 + A.k1 >> 1) + 6, jT = 80;
  box(ci - 1, J0, ck - 1, ci + 3, J0 + 1, ck + 3, M.concrete);
  for (let j = J0 + 2; j <= jT; j++) {
    if ((j - J0) % 4 === 0) ring(ci, j, ck, ci + 2, j, ck + 2, M.hazard);
    else { put(ci, j, ck, M.hazard); put(ci + 2, j, ck, M.hazard); put(ci, j, ck + 2, M.hazard); put(ci + 2, j, ck + 2, M.hazard); if ((j - J0) % 4 === 2) { put(ci + 1, j, ck, M.hazard); put(ci + 1, j, ck + 2, M.hazard); put(ci, j, ck + 1, M.hazard); put(ci + 2, j, ck + 1, M.hazard); } }
  }
  box(ci - 1, jT + 1, ck - 1, ci + 3, jT + 1, ck + 3, M.metal_dark);
  const jd = cHi ? -1 : 1;                              // jib points over the skeleton (along x)
  const jl = Math.min(46, cHi ? ci - 6 : 377 - ci), cl = 11;
  for (let t = -cl; t <= jl; t++) {
    const x = ci + 1 + jd * t;
    put(x, jT + 2, ck, M.hazard); put(x, jT + 2, ck + 2, M.hazard);
    if (t % 4 === 0) { put(x, jT + 2, ck + 1, M.hazard); if (t > -cl && t < jl - 6) put(x, jT + 3, ck + 1, M.hazard); }
    if (t > -cl + 1 && t < jl - 6) put(x, jT + 4, ck + 1, M.hazard);
  }
  box(ci + 1, jT + 2, ck + 1, ci + 1, jT + 9, ck + 1, M.hazard); put(ci + 1, jT + 10, ck + 1, M.light_red);
  for (let t = 1; t <= 5; t++) { put(ci + 1 + jd * t, jT + 9 - t, ck + 1, M.metal_dark); put(ci + 1 + jd * t, jT + 8 - t, ck + 1, M.metal_dark); put(ci + 1 - jd * t, jT + 9 - t, ck + 1, M.metal_dark); put(ci + 1 - jd * t, jT + 8 - t, ck + 1, M.metal_dark); }
  // counterweight + cab
  box(ci + 1 - jd * cl, jT - 1, ck, ci + 1 - jd * (cl - 3), jT + 1, ck + 2, M.concrete_dark);
  box(ci + 1 + jd * 2, jT - 2, ck + 3, ci + 1 + jd * 4, jT + 1, ck + 5, M.metal_panel); box(ci + 1 + jd * 2, jT - 1, ck + 5, ci + 1 + jd * 4, jT, ck + 5, M.window_lit);
  box(ci + 1 + jd * 2, jT + 1, ck + 2, ci + 1 + jd * 4, jT + 1, ck + 3, M.metal_dark);
  // trolley, cable and a hanging beam bundle
  const hx = ci + 1 + jd * Math.round(jl * 0.62), hb = J0 + (v.floors || 6) * FH + 9;
  box(hx - 1, jT + 1, ck, hx + 1, jT + 1, ck + 2, M.metal_dark);
  box(hx, hb + 2, ck + 1, hx, jT, ck + 1, M.metal_dark);
  box(hx, hb, ck - 4, hx + 1, hb + 1, ck + 6, M.steel_beam); put(hx, hb + 2, ck + 1, M.hazard);
  end();
}

// Gas station: lit canopy, pump islands, kiosk, fuel tanks full of trouble.
export function gasStation(A, v) {
  const rng = C.rng, s = v.front;         // front = side the forecourt opens to (2 or 3 expected, also works for 0/1)
  surface(A.i0, A.k0, A.i1, A.k1, M.concrete, 1);
  const alongZ = s >= 2;
  // kiosk at the back
  const kd = 11, K = alongZ ? (s === 3 ? { i0: A.i0, i1: A.i0 + kd, k0: A.k0 + 2, k1: A.k0 + 19 } : { i0: A.i1 - kd, i1: A.i1, k0: A.k0 + 2, k1: A.k0 + 19 })
    : (s === 1 ? { i0: A.i0 + 2, i1: A.i0 + 19, k0: A.k0, k1: A.k0 + kd } : { i0: A.i0 + 2, i1: A.i0 + 19, k0: A.k1 - kd, k1: A.k1 });
  const sp = shop(K, { name: v.name + ' kiosk', wall: M.tile_white, floors: 1, fronts: [s], awn: M.awning_red, sign: 'MART', neon: M.neon_orange, base: M.tile_teal, trim: M.tile_teal, fascia: M.car_red });
  // canopy
  begin('canopy', v.name);
  const c = alongZ ? (s === 3 ? { i0: A.i0 + kd + 5, i1: A.i1 - 2, k0: A.k0 + 3, k1: A.k0 + 27 } : { i0: A.i0 + 2, i1: A.i1 - kd - 5, k0: A.k0 + 3, k1: A.k0 + 27 })
    : (s === 1 ? { i0: A.i0 + 3, i1: A.i0 + 27, k0: A.k0 + kd + 5, k1: A.k1 - 2 } : { i0: A.i0 + 3, i1: A.i0 + 27, k0: A.k0 + 2, k1: A.k1 - kd - 5 });
  const jc = J0 + 10;
  box(c.i0, jc, c.k0, c.i1, jc + 1, c.k1, M.tile_white);
  ring(c.i0, jc + 1, c.k0, c.i1, jc + 1, c.k1, M.car_red); ring(c.i0, jc + 2, c.k0, c.i1, jc + 2, c.k1, M.neon_orange);
  const px = [c.i0 + 4, c.i1 - 5], pz = [c.k0 + 5, c.k1 - 6];
  for (const x of px) for (const z of pz) {
    box(x, J0, z, x + 1, jc - 1, z + 1, M.steel_beam);
    // pump island around each column
    const il = alongZ ? { i0: x - 1, i1: x + 2, k0: z - 3, k1: z + 4 } : { i0: x - 3, i1: x + 4, k0: z - 1, k1: z + 2 };
    box(il.i0, J0, il.k0, il.i1, J0, il.k1, M.curb);
    for (const d of [-2, 3]) {
      const ax = alongZ ? x : x + d, az = alongZ ? z + d : z;
      box(ax, J0 + 1, az, ax + (alongZ ? 1 : 0), J0 + 3, az + (alongZ ? 0 : 1), M.car_red);
      put(ax, J0 + 2, az, M.barrel_red);
      box(ax, J0 + 4, az, ax + (alongZ ? 1 : 0), J0 + 4, az + (alongZ ? 0 : 1), M.light_white);
    }
  }
  for (let i = c.i0 + 2; i < c.i1 - 1; i += 4) for (let k = c.k0 + 2; k < c.k1 - 1; k += 4) put(i, jc - 1, k, M.light_white);
  const fs = s, fr = c;
  ftext(fr, fs, 'FUEL', mid(fr, fs), jc + 3, 0, M.neon_orange, M.metal_dark);
  fbox(fr, fs, mid(fr, fs) - 9, mid(fr, fs) + 9, jc + 3, jc + 8, 0, 0, 0);     // clear then redraw with a border
  fbox(fr, fs, mid(fr, fs) - 9, mid(fr, fs) + 9, jc + 2, jc + 8, 0, 0, M.metal_dark);
  ftext(fr, fs, 'FUEL', mid(fr, fs), jc + 3, 0, M.neon_orange, 0);
  end();
  // tank farm + barrels in the remaining strip
  begin('tanks', v.name + ' tank farm');
  const T = alongZ ? { i0: A.i0 + 2, i1: A.i1 - 3, k0: A.k1 - 8, k1: A.k1 - 1 } : { i0: A.i1 - 8, i1: A.i1 - 1, k0: A.k0 + 2, k1: A.k1 - 3 };
  const tl = alongZ ? 0 : 1;
  for (let n = 0; n < 2; n++) {
    const a = (tl === 0 ? T.i0 : T.k0) + n * 15, len = 12;
    for (let t = 0; t < len; t++) for (let u = 0; u < 5; u++) for (let h = 0; h < 5; h++) {
      if ((u === 0 || u === 4) && (h === 0 || h === 4)) continue;
      const core = u >= 1 && u <= 3 && h >= 1 && h <= 3 && t > 0 && t < len - 1;
      const m = core ? ((t % 3 === 1 && u === 2 && h === 2) ? M.barrel_red : (t % 3 === 1 && u === 2 && h === 1) ? M.pipe : 0) : (t === 0 || t === len - 1) ? M.metal_panel : (t % 5 === 2 ? M.car_red : M.tile_white);
      if (m) { if (tl === 0) put(a + t, J0 + 1 + h, T.k0 + 1 + u, m); else put(T.i0 + 1 + u, J0 + 1 + h, a + t, m); }
    }
    for (const t of [2, len - 3]) { if (tl === 0) box(a + t, J0, T.k0 + 2, a + t, J0 + 1, T.k0 + 4, M.concrete_dark); else box(T.i0 + 2, J0, a + t, T.i0 + 4, J0 + 1, a + t, M.concrete_dark); }
    if (tl === 0) { box(a + 5, J0 + 6, T.k0 + 3, a + 5, J0 + 7, T.k0 + 3, M.pipe); } else box(T.i0 + 3, J0 + 6, a + 5, T.i0 + 3, J0 + 7, a + 5, M.pipe);
  }
  end();
  // underground storage tanks under the forecourt, with filler caps on the surface
  C.cur = null;
  for (let n = 0; n < 2; n++) {
    const u = alongZ ? { i0: c.i0 + 1 + n * 7, i1: c.i0 + 5 + n * 7, k0: c.k0 + 8, k1: c.k1 - 8 } : { i0: c.i0 + 8, i1: c.i1 - 8, k0: c.k0 + 1 + n * 7, k1: c.k0 + 5 + n * 7 };
    if (u.i1 > c.i1 || u.k1 > c.k1) continue;
    box(u.i0, 1, u.k0, u.i1, 2, u.k1, M.fuel_tank);
    const fx = alongZ ? u.i0 + 2 : u.i0 + 1, fz = alongZ ? u.k0 + 1 : u.k0 + 2;
    if (get(fx, J0, fz) === 0) put(fx, J0 - 1, fz, M.hazard);
    if (get(alongZ ? fx : u.i1 - 1, J0, alongZ ? u.k1 - 1 : fz) === 0) put(alongZ ? fx : u.i1 - 1, J0 - 1, alongZ ? u.k1 - 1 : fz, M.hazard);
  }
  // loose barrels and a price pylon
  const bx = alongZ ? (s === 3 ? A.i0 + 1 : A.i1 - 4) : A.i0 + 22, bz = alongZ ? A.k0 + 22 : (s === 1 ? A.k0 + 1 : A.k1 - 4);
  barrels(bx, J0, bz, 7, 0.85);
  const py = alongZ ? { i: s === 3 ? A.i1 : A.i0, k: A.k1 - 12 } : { i: A.i1 - 12, k: s === 1 ? A.k1 : A.k0 };
  C.cur = null;
  box(py.i, J0, py.k, py.i, J0 + 16, py.k, M.steel_beam);
  if (alongZ) { box(py.i, J0 + 9, py.k - 2, py.i, J0 + 17, py.k + 2, M.metal_dark); box(py.i, J0 + 14, py.k - 1, py.i, J0 + 16, py.k + 1, M.neon_orange); box(py.i, J0 + 10, py.k - 1, py.i, J0 + 12, py.k + 1, M.billboard); }
  else { box(py.i - 2, J0 + 9, py.k, py.i + 2, J0 + 17, py.k, M.metal_dark); box(py.i - 1, J0 + 14, py.k, py.i + 1, J0 + 16, py.k, M.neon_orange); box(py.i - 1, J0 + 10, py.k, py.i + 1, J0 + 12, py.k, M.billboard); }
  end();
  return sp;
}
