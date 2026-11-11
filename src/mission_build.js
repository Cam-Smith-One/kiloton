// ============================================================================
// KILOTON — mission_build.js   OWNER: MISSION
// Voxel set pieces for Operation Blackout, written with G.grid.set so chunks
// remesh: jammer pylons, the relay housing, the citadel fortification and its
// core. Each builder returns a "structure": the list of tracked cells (grid
// index + original material) so the director can count what is left cheaply.
// ============================================================================
import { G, VS, NX, NZ, NY, GROUND_J } from './core.js';
import { M, SOLID, STRUCT } from './materials.js';

const J0 = GROUND_J;
let rec = null;                              // structure being recorded

function put(i, j, k, m, track) {
  if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1 || j < 1 || j >= NY) return;
  G.grid.set(i, j, k, m);
  if (track && rec && m) { rec._i.push(i + NX * (k + NZ * j)); rec._m.push(m); }
}
function box(i0, j0, k0, i1, j1, k1, m, track) { for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) put(i, j, k, m, track); }
function begin(kind, x, y, z) { rec = { kind, x, y, z, _i: [], _m: [], idx: null, mat: null, total: 0, left: 0, frac: 0 }; return rec; }
function end() {
  const s = rec; rec = null;
  // a later put may have overwritten an earlier tracked cell: keep the last material per cell
  const last = new Map(); for (let n = 0; n < s._i.length; n++) last.set(s._i[n], s._m[n]);
  s.idx = new Int32Array(last.size); s.mat = new Uint8Array(last.size);
  let n = 0; for (const [g, m] of last) { s.idx[n] = g; s.mat[n++] = m; }
  s.total = s.left = n; s._i = s._m = null;
  return s;
}
/** Recount a structure's surviving voxels (cells that still hold their original material). O(cells), cells ~ 300-700. */
export function recount(s) {
  const d = G.grid.data, idx = s.idx, mat = s.mat; let left = 0;
  for (let n = 0; n < idx.length; n++) if (d[idx[n]] === mat[n]) left++;
  s.left = left; s.frac = s.total ? 1 - left / s.total : 1;
  return s.frac;
}
/** Remove whatever is left of a structure (silent; the director adds the explosion). */
export function erase(s) { const d = G.grid.data, idx = s.idx, mat = s.mat; for (let n = 0; n < idx.length; n++) if (d[idx[n]] === mat[n]) { const g = idx[n], j = (g / (NX * NZ)) | 0, r = g - j * NX * NZ, k = (r / NX) | 0; G.grid.set(r - k * NX, j, k, 0); } s.left = 0; s.frac = 1; }

// ---------------------------------------------------------------------------------- jammer pylon
// Lattice mast ~15 m: four concrete footings (the weak point: strength 100, a rocket breaks them),
// armour legs stepping in twice, cross-braced shaft around a glowing core column, emitter head with
// four horns and a whip antenna. A low sandbag / barrier ring with gaps on the street axes, a fuel
// generator wired to one footing (shoot it: the blast takes the footing with it).
export function buildPylon(x, z, variant) {
  const ci = Math.round(x / VS), ck = Math.round(z / VS);      // mast is even-sized: centred on a voxel corner
  const s = begin('pylon', ci * VS, (J0 + 12) * VS, ck * VS);
  const A = M.armor_enemy, D = M.metal_dark, N = M.neon_orange;
  // clear the footprint (lamps, signs) so the piece reads cleanly
  for (let j = J0; j < J0 + 34; j++) for (let k = ck - 6; k <= ck + 5; k++) for (let i = ci - 6; i <= ci + 5; i++) if (G.grid.get(i, j, k)) G.grid.set(i, j, k, 0);
  const frame = (r, j, m) => { for (let t = -r; t < r; t++) { put(ci + t, j, ck - r, m, true); put(ci + t, j, ck + r - 1, m, true); put(ci - r, j, ck + t, m, true); put(ci + r - 1, j, ck + t, m, true); } };
  const band = (r0, r1, j, m) => { for (let k = -r1; k < r1; k++) for (let i = -r1; i < r1; i++) { const a = Math.max(i < 0 ? -i : i + 1, k < 0 ? -k : k + 1); if (a > r0) put(ci + i, j, ck + k, m, true); } };
  const legs = (r, j0, j1, m, th) => { for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const i = sx < 0 ? ci - r : ci + r - th, k = sz < 0 ? ck - r : ck + r - th; box(i, j0, k, i + th - 1, j1, k + th - 1, m, true); } };
  // footings + lower legs (r = 4), first setback (r = 3), shaft (r = 2)
  legs(4, J0, J0 + 1, M.concrete_dark, 2);
  legs(4, J0 + 2, J0 + 2, M.hazard, 2);
  legs(4, J0 + 3, J0 + 5, A, 2);
  band(2, 4, J0 + 6, A);                                   // deck 1
  frame(4, J0 + 7, M.hazard);
  legs(3, J0 + 7, J0 + 10, A, 1);
  band(1, 3, J0 + 11, A);                                  // deck 2
  legs(2, J0 + 12, J0 + 25, A, 1);
  for (let j = J0 + 15; j <= J0 + 23; j += 4) frame(2, j, A);
  // cross bracing on the four shaft faces (alternating lean per bay)
  for (let j = J0 + 12; j <= J0 + 25; j++) {
    const t = (j - J0 - 12) % 4, lean = ((j - J0 - 12) >> 2) & 1, a = lean ? 3 - t : t;
    if (t === 3) continue;
    put(ci - 2 + a, j, ck - 2, D, true); put(ci + 1 - a, j, ck + 1, D, true); put(ci - 2, j, ck + 1 - a, D, true); put(ci + 1, j, ck - 2 + a, D, true);
  }
  // conduit up the middle, then the core column that glows through the lattice
  box(ci - 1, J0, ck - 1, ci, J0 + 5, ck, D, true);
  box(ci - 1, J0 + 7, ck - 1, ci, J0 + 10, ck, M.pipe, true);
  box(ci - 1, J0 + 12, ck - 1, ci, J0 + 24, ck, N, true);
  for (let j = J0 + 15; j <= J0 + 23; j += 4) box(ci - 1, j, ck - 1, ci, j, ck, D, true);
  // emitter head
  band(0, 3, J0 + 26, A);
  frame(3, J0 + 27, N);
  box(ci - 2, J0 + 27, ck - 2, ci + 1, J0 + 28, ck + 1, A, true);
  frame(2, J0 + 29, M.hazard);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {            // four horns
    for (let t = 3; t <= 4; t++) for (const o of [-1, 0]) put(ci + (dx ? (dx > 0 ? t : -t - 1) : o), J0 + 26, ck + (dz ? (dz > 0 ? t : -t - 1) : o), A, true);
    for (const o of [-1, 0]) { const i = ci + (dx ? (dx > 0 ? 4 : -5) : o), k = ck + (dz ? (dz > 0 ? 4 : -5) : o); box(i, J0 + 27, k, i, J0 + 29, k, A, true); put(i, J0 + 30, k, M.light_red, true); }
  }
  box(ci - 1, J0 + 29, ck - 1, ci, J0 + 29, ck, N, true);
  box(ci - 1, J0 + 30, ck - 1, ci - 1, J0 + 35, ck - 1, M.steel_beam, true);
  put(ci - 1, J0 + 36, ck - 1, M.light_red, true);
  const st = end();
  // --- untracked dressing: cover ring, generator, crates ---
  const R = 10.4;
  for (let k = -12; k <= 11; k++) for (let i = -12; i <= 11; i++) {
    const dx = i + 0.5, dz = k + 0.5, d = Math.sqrt(dx * dx + dz * dz);
    if (d < R - 0.9 || d >= R + 0.35) continue;
    if (Math.abs(dx) < 3 || Math.abs(dz) < 3) continue;                      // gaps on the street axes
    const q = (dx > 0 ? 1 : 0) + (dz > 0 ? 2 : 0), bags = ((q + variant) & 1) === 0;
    if (G.grid.get(ci + i, J0, ck + k)) continue;
    if (bags) { put(ci + i, J0, ck + k, M.sandbag); put(ci + i, J0 + 1, ck + k, M.sandbag); if (((i * 7 + k * 3) & 3) === 0) put(ci + i, J0 + 2, ck + k, M.sandbag); }
    else { put(ci + i, J0, ck + k, M.barrier); put(ci + i, J0 + 1, ck + k, ((i + k) & 3) === 0 ? M.hazard : M.barrier); }
  }
  // generator beside the east or west footing (explosive core), cable to the mast
  const gs = variant & 1 ? -1 : 1, gi = gs > 0 ? ci + 5 : ci - 8;
  box(gi, J0, ck - 2, gi + 2, J0 + 2, ck + 1, D);
  box(gi + 1, J0, ck - 1, gi + 1, J0 + 1, ck, M.barrel_red);
  put(gi + (gs > 0 ? 2 : 0), J0 + 2, ck - 2, N); put(gi + (gs > 0 ? 2 : 0), J0 + 2, ck + 1, N);
  put(gi + 1, J0 + 3, ck - 1, M.hazard); put(gi + 1, J0 + 3, ck, M.hazard);
  // ammo crates inside the ring
  const cs = variant & 2 ? -1 : 1;
  box(ci - 1, J0, ck + cs * 7 - 1, ci, J0 + 1, ck + cs * 7, M.crate); put(ci - 2, J0, ck + cs * 7, M.crate); put(ci + 1, J0, ck + cs * 7 - 1, M.wood_dark);
  st.gen = { x: (gi + 1.5) * VS, y: (J0 + 1) * VS, z: ck * VS };
  return st;
}

// ---------------------------------------------------------------------------------- relay housing
// Octagonal uplink pad on the plaza: raised deck with a cyan inlay, four light masts, low armoured
// parapets with gaps on the axes. The relay itself is an entity (mission_props) standing in the middle.
export function buildRelayPad(x, z) {
  const ci = Math.round(x / VS), ck = Math.round(z / VS);
  const s = begin('relay', ci * VS, (J0 + 1) * VS, ck * VS);
  for (let k = -11; k <= 10; k++) for (let i = -11; i <= 10; i++) {
    const dx = Math.abs(i + 0.5), dz = Math.abs(k + 0.5), o = Math.max(dx, dz, (dx + dz) * 0.72);
    if (o > 10.6) continue;
    for (let j = J0; j < J0 + 12; j++) if (G.grid.get(ci + i, j, ck + k)) G.grid.set(ci + i, j, ck + k, 0);
    const d = Math.sqrt(dx * dx + dz * dz);
    let m = M.metal_dark;
    if (o > 9.6) m = M.concrete_dark;
    else if (d > 6.2 && d < 7.3) m = (Math.abs(dx - dz) < 1.2) ? M.metal_dark : M.neon_cyan;
    else if (d < 3) m = M.metal_panel;
    else if (dx < 1 || dz < 1) m = M.metal_panel;
    put(ci + i, J0, ck + k, m, true);
    // parapet on the rim, open on the four axes
    if (o > 9.6 && dx > 3 && dz > 3) { put(ci + i, J0 + 1, ck + k, M.metal_dark, true); put(ci + i, J0 + 2, ck + k, ((i + k) & 3) === 0 ? M.neon_cyan : M.metal_panel, true); }
    else if (o > 9.6 && (dx > 3 || dz > 3) && Math.min(dx, dz) < 3 && Math.min(dx, dz) > 2) { box(ci + i, J0 + 1, ck + k, ci + i, J0 + 3, ck + k, M.steel_beam, true); put(ci + i, J0 + 4, ck + k, M.neon_cyan, true); }
  }
  // four light masts on the diagonals
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const i = sx < 0 ? ci - 7 : ci + 6, k = sz < 0 ? ck - 7 : ck + 6;
    box(i, J0 + 1, k, i, J0 + 7, k, M.steel_beam, true); put(i, J0 + 8, k, M.neon_cyan, true); put(i, J0 + 4, k, M.neon_cyan, true);
  }
  return end();
}

// ---------------------------------------------------------------------------------- citadel
function footprint(b) {
  const bAt = G.city.buildingAt, lot = G.city.lot, id = b.id + 1;
  return (i, k) => i >= 0 && k >= 0 && i < NX && k < NZ && bAt[i + NX * k] === id && (!lot || lot[i + NX * k] === 2);
}
/** Fortify a building as the Vanta command post. Returns { plate (untracked count), core (structure), cx,cy,cz, roof:[{x,y,z}], gates:[{x,z}] } */
export function buildCitadel(b, plateH) {
  const inside = footprint(b), A = M.armor_enemy, N = M.neon_orange;
  let si = 0, sk = 0, sn = 0;
  for (let k = b.k0; k <= b.k1; k++) for (let i = b.i0; i <= b.i1; i++) if (inside(i, k)) { si += i; sk += k; sn++; }
  if (!sn) return null;
  const ci = Math.round(si / sn), ck = Math.round(sk / sn);
  // facade columns: footprint cells with an outside neighbour
  const cols = [];
  for (let k = b.k0; k <= b.k1; k++) for (let i = b.i0; i <= b.i1; i++) {
    if (!inside(i, k)) continue;
    const ox = !inside(i - 1, k) ? -1 : !inside(i + 1, k) ? 1 : 0, oz = !inside(i, k - 1) ? -1 : !inside(i, k + 1) ? 1 : 0;
    if (ox || oz) cols.push([i, k, ox, oz]);
  }
  const PH = plateH || 13, gates = [];
  let plate = 0;
  for (const [i, k, ox, oz] of cols) {
    const corner = ox && oz;
    const gate = !corner && ((ox && Math.abs(k - ck) <= 3) || (oz && Math.abs(i - ci) <= 3));
    const jamb = !corner && !gate && ((ox && Math.abs(k - ck) === 4) || (oz && Math.abs(i - ci) === 4));
    for (let j = J0; j < J0 + PH; j++) {
      let m = A;
      if (gate && j < J0 + 9) m = M.metal_dark;
      else if ((gate && j === J0 + 9) || (jamb && j < J0 + 10)) m = M.hazard;
      else if (j === J0 + PH - 1) m = ((i + k) & 3) < 2 ? M.hazard : A;
      else if (j === J0 + PH - 4 && !corner) m = ((i + k) & 3) !== 3 ? N : A;
      put(i, j, k, m); plate++;
    }
    if (gate && ((ox && k === ck) || (oz && i === ci))) gates.push({ x: (i + 0.5 + ox * 6) * VS, z: (k + 0.5 + oz * 6) * VS });
    // buttress fins every 8 voxels (not at gates), stepping out over the sidewalk
    const t = ox ? k : i;
    if (!corner && !gate && !jamb && ((t % 8) + 8) % 8 === 0) {
      for (let j = J0; j < J0 + 9; j++) if (!G.grid.get(i + ox, j, k + oz)) put(i + ox, j, k + oz, j === J0 + 8 ? M.hazard : A);
      for (let j = J0; j < J0 + 4; j++) if (!G.grid.get(i + ox * 2, j, k + oz * 2)) put(i + ox * 2, j, k + oz * 2, A);
    }
  }
  // --- core room: the storey nearest mid-height. Find its slab from the floor material around the centre.
  const d = G.grid.data, mid = Math.round((J0 + b.j1) * 0.5);
  let slab = -1, bestN = 0;
  for (let j = Math.min(b.j1 - 9, mid + 4); j >= Math.max(J0 + PH + 1, mid - 10); j--) {
    let n = 0;
    for (let k = ck - 6; k <= ck + 5; k += 2) for (let i = ci - 6; i <= ci + 5; i += 2) if (inside(i, k) && SOLID[d[i + NX * (k + NZ * j)]] && !SOLID[d[i + NX * (k + NZ * (j + 2))]]) n++;
    if (n > bestN + 2 || (n >= bestN && n > 12 && Math.abs(j - mid) < Math.abs(slab - mid))) { bestN = n; slab = j; }
  }
  if (slab < 0) slab = mid;
  // clear partitions and furniture out of the room (structure stays), lay an armoured deck, build the core
  for (let j = slab + 1; j <= slab + 6; j++) for (let k = ck - 7; k <= ck + 6; k++) for (let i = ci - 7; i <= ci + 6; i++) { const m = d[i + NX * (k + NZ * j)]; if (m && !STRUCT[m] && inside(i, k) && !(Math.abs(i - ci + 0.5) > 6 || Math.abs(k - ck + 0.5) > 6)) G.grid.set(i, j, k, 0); }
  box(ci - 5, slab, ck - 5, ci + 4, slab, ck + 4, A);
  const core = begin('core', ci * VS, (slab + 3.5) * VS, ck * VS);
  box(ci - 3, slab + 1, ck - 3, ci + 2, slab + 1, ck + 2, A, true);
  for (const sx of [-3, 2]) for (const sz of [-3, 2]) box(ci + sx, slab + 2, ck + sz, ci + sx, slab + 6, ck + sz, A, true);
  box(ci - 2, slab + 2, ck - 2, ci + 1, slab + 5, ck + 1, N, true);
  box(ci - 1, slab + 6, ck - 1, ci, slab + 6, ck, M.light_red, true);
  for (const [dx, dz] of [[-5, 0], [4, 0], [0, -5], [0, 4]]) { put(ci + dx, slab + 1, ck + dz, M.light_red); if (dx) put(ci + dx, slab + 1, ck - 1, M.light_red); else put(ci - 1, slab + 1, ck + dz, M.light_red); }
  const cs = end();
  // glowing bands on the facade at the core storey so the target reads from the street
  for (const [i, k] of cols) for (const j of [slab, slab + 7]) { const m = d[i + NX * (k + NZ * j)]; if (m && SOLID[m]) put(i, j, k, ((i + k) & 7) === 7 ? A : N); }
  // corner ribs up to the core storey, a crenellated armour crown on the roof line, banners over the gates
  for (const [i, k, ox, oz] of cols) {
    if (ox && oz) for (let j = J0 + PH; j <= slab + 7; j++) { const m = d[i + NX * (k + NZ * j)]; if (m && SOLID[m]) put(i, j, k, (j % 6) === 0 ? M.light_red : A); }
    let jt = b.j1; while (jt > slab + 8 && !SOLID[d[i + NX * (k + NZ * jt)]]) jt--;
    if (jt > slab + 8 && jt >= b.j1 - 16) { put(i, jt + 1, k, A); if (((i + k) & 3) < 2) put(i, jt + 2, k, A); else if (((i + k) & 7) === 3) put(i, jt + 2, k, M.light_red); }
    if (ox && oz) continue;
    const dt = ox ? k - ck : i - ci;
    if (Math.abs(dt + 0.5) <= 3.5) {
      const bi = i + ox, bk = k + oz, top = slab - 2, bot = J0 + PH + 1;
      for (let j = bot; j <= top; j++) {
        if (G.grid.get(bi, j, bk)) continue;
        const a = Math.abs(dt + 0.5) - 0.5, r = (top - j) % 9;                      // stacked chevrons
        put(bi, j, bk, (r >= 2 && r <= 5 && a === r - 2) || (r >= 3 && r <= 6 && a === r - 3) ? N : j === bot || j === top ? A : M.awning_red);
      }
    }
  }
  // roof emplacements: inset corners of the highest roof level
  const roof = [];
  for (const [fx, fz] of [[0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]]) {
    const x = (b.i0 + (b.i1 - b.i0) * fx + 0.5) * VS, z = (b.k0 + (b.k1 - b.k0) * fz + 0.5) * VS;
    const y = G.grid.topBelow(x, NY * VS - 0.5, z);
    if (y > (J0 + PH + 4) * VS) roof.push({ x, y, z });
  }
  return { plate, core: cs, cx: ci * VS, cy: (slab + 1) * VS, cz: ck * VS, slab, roof, gates, top: (b.j1 + 1) * VS, b };
}
/** Small emplacement nest under a rooftop turret (sandbag horseshoe + armour plate). */
export function buildNest(x, y, z) {
  const i = Math.floor(x / VS), k = Math.floor(z / VS), j = Math.round(y / VS);
  for (let a = -2; a <= 2; a++) for (let c = -2; c <= 2; c++) {
    const e = Math.max(Math.abs(a), Math.abs(c));
    if (e === 2 && !(a === 0 || c === 0)) { if (!G.grid.get(i + a, j, k + c)) put(i + a, j, k + c, M.sandbag); }
  }
}
/** Deterministic sample of a building's solid voxels (for a cheap "how much is left" estimate). */
export function sampleBuilding(b, want) {
  const d = G.grid.data, bAt = G.city.buildingAt, id = b.id + 1, out = [], mats = [];
  const vol = (b.i1 - b.i0 + 1) * (b.j1 - b.j0 + 1) * (b.k1 - b.k0 + 1), step = Math.max(1, Math.floor(vol / (want * 12)));
  let c = 0;
  for (let j = Math.max(J0, b.j0); j <= b.j1; j++) for (let k = b.k0; k <= b.k1; k++) for (let i = b.i0; i <= b.i1; i++) {
    if ((c++ % step) !== 0) continue;
    const g = i + NX * (k + NZ * j), m = d[g];
    if (m && SOLID[m] && bAt[i + NX * k] === id) { out.push(g); mats.push(m); }
  }
  return { kind: 'sample', idx: Int32Array.from(out), mat: Uint8Array.from(mats), total: out.length, left: out.length, frac: 0 };
}
