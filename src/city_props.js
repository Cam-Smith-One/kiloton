// ============================================================================
// KILOTON — city_props.js   OWNER: CITY.
// Small things: vehicles, trees, street furniture, signs. All take voxel coords.
// Everything is 6-connected to the ground so nothing floats for the collapse solver.
// ============================================================================
import { M } from './materials.js';
import { C, J0, put, box, get, glyphs, textW } from './city_util.js';

const CAR_COLS = [M.car_blue, M.car_red, M.car_white, M.car_yellow, M.car_white, M.metal_dark, M.car_blue, M.metal_panel];

// Car: 9 long x 4 wide x 4 high. ax = 0 length along x, 1 along z. dir = +1/-1 (front towards +/-).
// (i,k) = min corner. Has a barrel_red fuel voxel buried in the back.
export function car(i, j, k, ax, dir, col) {
  const rng = C.rng; col = col || rng.pick(CAR_COLS);
  const P = (l, w, h, m) => { const ll = dir > 0 ? l : 8 - l; if (ax === 0) put(i + ll, j + h, k + w, m); else put(i + w, j + h, k + ll, m); };
  const taxi = col === M.car_yellow;
  for (let l = 0; l < 9; l++) for (let w = 0; w < 4; w++) {
    const side = w === 0 || w === 3, wheel = side && (l === 1 || l === 2 || l === 6 || l === 7);
    P(l, w, 0, wheel ? M.rubber : (l === 0 || l === 8) ? M.metal_dark : col);
    P(l, w, 1, col);
    if (l >= 2 && l <= 6) {
      const pillar = (l === 2 || l === 6) && side;
      P(l, w, 2, pillar ? col : (side || l === 2 || l === 6) ? M.glass_dark : M.furniture);
      P(l, w, 3, col);
    }
  }
  P(8, 0, 1, M.light_white); P(8, 3, 1, M.light_white); P(0, 0, 1, M.light_red); P(0, 3, 1, M.light_red);
  P(1, 1, 1, M.barrel_red);
  if (taxi) { P(4, 1, 4, M.light_amber); P(4, 2, 4, M.light_amber); }
}
// Van / box truck: 13 x 5 x 6
export function truck(i, j, k, ax, dir, col) {
  const P = (l, w, h, m) => { const ll = dir > 0 ? l : 12 - l; if (ax === 0) put(i + ll, j + h, k + w, m); else put(i + w, j + h, k + ll, m); };
  col = col || M.car_white;
  for (let l = 0; l < 13; l++) for (let w = 0; w < 5; w++) for (let h = 0; h < 6; h++) {
    const side = w === 0 || w === 4, cab = l >= 10;
    let m = cab ? M.car_blue : col;
    if (h === 0) m = side && (l === 1 || l === 2 || l === 10 || l === 11) ? M.rubber : (l >= 1 && l <= 11 && !side) ? M.metal_dark : (side && (l < 1 || (l > 2 && l < 10) || l > 11)) ? 0 : M.metal_dark;
    else if (cab && h >= 5) m = 0;
    else if (cab && h >= 3 && (side || l === 12)) m = M.glass_dark;
    else if (!cab && !(side || l === 0 || l === 9 || h === 1 || h === 5)) m = (l === 5 && w === 2 && h === 2) ? M.barrel_red : (h === 2 && (l + w) % 3 === 0) ? M.crate : 0;
    else if (!cab && h === 3 && side) m = M.car_red;
    if (m) P(l, w, h, m);
  }
  P(12, 0, 1, M.light_white); P(12, 4, 1, M.light_white); P(0, 0, 1, M.light_red); P(0, 4, 1, M.light_red);
}
// City bus: 24 x 5 x 6
export function bus(i, j, k, ax, dir) {
  const P = (l, w, h, m) => { const ll = dir > 0 ? l : 23 - l; if (ax === 0) put(i + ll, j + h, k + w, m); else put(i + w, j + h, k + ll, m); };
  for (let l = 0; l < 24; l++) for (let w = 0; w < 5; w++) for (let h = 0; h < 6; h++) {
    const side = w === 0 || w === 4, endc = l === 0 || l === 23, shell = side || endc || h === 5 || h === 1;
    let m = 0;
    if (h === 0) m = side && ((l >= 3 && l <= 5) || (l >= 17 && l <= 19)) ? M.rubber : side ? 0 : M.metal_dark;
    else if (!shell) m = (h === 2 && l % 3 === 1 && w !== 2) ? M.furniture : (l === 2 && w === 2 && h === 2) ? M.barrel_red : 0;
    else if (h === 1) m = M.car_white;
    else if (h === 2) m = M.tile_teal;
    else if (h === 5) m = M.car_white;
    else m = (l % 6 === 5 && side) ? M.car_white : M.glass_dark;
    if (m) P(l, w, h, m);
  }
  P(23, 0, 1, M.light_white); P(23, 4, 1, M.light_white); P(0, 0, 1, M.light_red); P(0, 4, 1, M.light_red);
  P(23, 1, 5, M.light_amber); P(23, 2, 5, M.light_amber); P(23, 3, 5, M.light_amber);
}
// Shipping container 12 x 5 x 5 (hollow)
export function container(i, j, k, ax, col) {
  const li = ax === 0 ? 11 : 4, lk = ax === 0 ? 4 : 11;
  box(i, j, k, i + li, j + 4, k + lk, col);
  box(i + 1, j + 1, k + 1, i + li - 1, j + 3, k + lk - 1, 0);
  for (let t = 1; t < 11; t += 2) { if (ax === 0) { box(i + t, j, k, i + t, j + 4, k, M.metal_dark); box(i + t, j, k + 4, i + t, j + 4, k + 4, M.metal_dark); } else { box(i, j, k + t, i, j + 4, k + t, M.metal_dark); box(i + 4, j, k + t, i + 4, j + 4, k + t, M.metal_dark); } }
  put(i + (ax === 0 ? 5 : 2), j + 1, k + (ax === 0 ? 2 : 5), M.crate);
}

// Tree: trunk + noisy ellipsoid crown. size 0 small (street), 1 medium, 2 large.
export function tree(i, k, size = 1, j = J0) {
  const rng = C.rng, th = 4 + size * 2 + rng.int(0, 2), r = 2.4 + size * 0.9 + rng() * 0.6, ry = r * (0.8 + rng() * 0.25);
  box(i, j, k, i, j + th + Math.floor(ry), k, M.trunk);
  if (size >= 2) box(i, j, k, i + 1, j + th - 2, k + 1, M.trunk);
  const cy = j + th + ry * 0.6, R = Math.ceil(r) + 1, ox = rng() * 9, oz = rng() * 9;
  for (let dj = -R; dj <= R; dj++) for (let dk = -R; dk <= R; dk++) for (let di = -R; di <= R; di++) {
    const y = Math.round(cy) + dj;
    const n = Math.sin((i + di) * 1.3 + ox) * Math.cos((k + dk) * 1.1 + oz) * 0.45 + Math.sin(y * 1.7 + ox) * 0.25;
    const d = Math.sqrt(di * di + dk * dk) / r, e = dj / ry;
    if (d * d + e * e < 1 + n * 0.5 - 0.12 && get(i + di, y, k + dk) === 0) put(i + di, y, k + dk, M.foliage);
  }
}
// Street lamp: pole, arm towards (dx,dz), warm head.
export function lamp(i, k, dx, dz, h = 10) {
  box(i, J0 + 1, k, i, J0 + h, k, M.metal_dark);
  put(i, J0, k, M.concrete_dark);
  put(i + dx, J0 + h, k + dz, M.metal_dark); put(i + dx * 2, J0 + h, k + dz * 2, M.metal_dark);
  put(i + dx * 2, J0 + h - 1, k + dz * 2, M.light_white);
}
// Post-top park lamp
export function parkLamp(i, k) { box(i, J0, k, i, J0 + 5, k, M.metal_dark); put(i, J0 + 6, k, M.light_white); put(i, J0 + 7, k, M.metal_dark); }
// Traffic light on a corner post: a three-lamp head, one lamp lit.
export function trafficLight(i, k, state) {
  box(i, J0, k, i, J0 + 6, k, M.metal_dark);
  put(i, J0 + 7, k, state ? M.light_green : M.rubber);
  put(i, J0 + 8, k, M.rubber);
  put(i, J0 + 9, k, state ? M.rubber : M.light_red);
  put(i, J0 + 10, k, M.hazard);
}
export function bench(i, k, ax) {
  if (ax === 0) { box(i, J0, k, i + 3, J0, k, M.wood); box(i, J0 + 1, k, i + 3, J0 + 1, k, M.wood_dark); box(i, J0, k + 1, i + 3, J0, k + 1, M.wood); }
  else { box(i, J0, k, i, J0, k + 3, M.wood); box(i, J0 + 1, k, i, J0 + 1, k + 3, M.wood_dark); box(i + 1, J0, k, i + 1, J0, k + 3, M.wood); }
}
export function bin(i, k) { box(i, J0, k, i, J0 + 1, k, M.metal_dark); }
export function hydrant(i, k) { put(i, J0, k, M.car_red); put(i, J0 + 1, k, M.car_red); }
export function bollard(i, k) { put(i, J0, k, M.concrete_dark); put(i, J0 + 1, k, M.hazard); }
// Planter box with shrub or small tree. w x d footprint.
export function planter(i, k, w, d, withTree) {
  box(i, J0, k, i + w - 1, J0 + 1, k + d - 1, M.stone);
  box(i + 1, J0 + 1, k + 1, i + w - 2, J0 + 1, k + d - 2, M.dirt);
  box(i + 1, J0 + 2, k + 1, i + w - 2, J0 + 2, k + d - 2, M.foliage);
  if (withTree) tree(i + (w >> 1), k + (d >> 1), 0, J0 + 2);
}
// Bus shelter 10 long. ax = axis of its length, open towards (ox,oz).
export function busStop(i, k, ax, open) {
  const L = 9;
  for (let t = 0; t <= L; t++) {
    const x = ax === 0 ? i + t : i, z = ax === 0 ? k : k + t;
    const post = t === 0 || t === L;
    box(x, J0, z, x, J0 + 5, z, post ? M.metal_dark : M.glass);
    put(x, J0 + 6, z, M.metal_dark);
    const x2 = ax === 0 ? x : x + open, z2 = ax === 0 ? z + open : z;
    put(x2, J0 + 6, z2, M.metal_dark);
    const x3 = ax === 0 ? x : x + 2 * open, z3 = ax === 0 ? z + 2 * open : z;
    put(x3, J0 + 6, z3, M.metal_dark);
    if (post) box(x3, J0, z3, x3, J0 + 5, z3, M.metal_dark);
    if (t >= 2 && t <= 6) put(x2, J0, z2, M.wood);
  }
  const x = ax === 0 ? i + 4 : i, z = ax === 0 ? k : k + 4;
  put(x, J0 + 5, z, M.light_white); put(ax === 0 ? x + 1 : x, J0 + 5, ax === 0 ? z : z + 1, M.light_white);
  put(ax === 0 ? i + 8 : i, J0 + 3, ax === 0 ? k : k + 8, M.neon_cyan); put(ax === 0 ? i + 8 : i, J0 + 4, ax === 0 ? k : k + 8, M.neon_cyan);
}
// Billboard: lit panel with dark lettering and a colour stripe, on steel legs. ax = axis of the panel width.
// (i,k) = one end, panel bottom at j. Reads correctly from the side `face` (+1/-1 along the other axis).
export function billboard(i, j, k, ax, w, h, legs, str, face, accent) {
  const X = (t) => ax === 0 ? i + t : i, Z = (t) => ax === 0 ? k : k + t;
  for (const t of [2, w - 3]) box(X(t), j - legs, Z(t), X(t), j - 1, Z(t), M.steel_beam);
  for (let t = 0; t < w; t++) for (let y = 0; y < h; y++) {
    const edge = t === 0 || t === w - 1 || y === 0 || y === h - 1;
    put(X(t), j + y, Z(t), edge ? M.metal_dark : y === 1 || y === 2 ? accent : M.billboard);
  }
  if (str) {
    const tw = textW(str), t0 = (w - tw) >> 1, rd = (ax === 0 ? face : -face);
    glyphs(str, (c, row, on) => { if (on) { const t = rd > 0 ? t0 + c : w - 1 - t0 - c; put(X(t), j + h - 3 - row, Z(t), M.metal_dark); } });
  }
  // catwalk + lights
  for (let t = 1; t < w - 1; t += 4) { const x = ax === 0 ? X(t) : i + face, z = ax === 0 ? k + face : Z(t); put(x, j, z, M.metal_dark); put(x, j + 1, z, M.light_white); }
}
export function crateStack(i, j, k, n) {
  const rng = C.rng;
  for (let t = 0; t < n; t++) { const x = i + rng.int(0, 3) * 2, z = k + rng.int(0, 3) * 2, h = rng.int(1, 3); for (let y = 0; y < h; y++) if (get(x, j + y * 2, z) === 0) box(x, j + y * 2, z, x + 1, j + y * 2 + 1, z + 1, rng() < 0.75 ? M.crate : M.wood_dark); }
}
export function barrels(i, j, k, n, red = 0.6) {
  const rng = C.rng;
  for (let t = 0; t < n; t++) { const x = i + (t % 3), z = k + ((t / 3) | 0); const m = rng() < red ? M.barrel_red : M.pipe; put(x, j, z, m); put(x, j + 1, z, m); }
}
export function sandbags(i, j, k, ax, len) {
  for (let t = 0; t < len; t++) { const x = ax === 0 ? i + t : i, z = ax === 0 ? k : k + t; put(x, j, z, M.sandbag); if (t > 0 && t < len - 1) put(x, j + 1, z, M.sandbag); }
}

// Fuel tanker: 16 long x 5 wide x 6 high. Cab + a hollow fuel_tank drum (one explosive cluster). (i,k) = min corner.
export function tanker(i, j, k, ax, dir) {
  const P = (l, w, h, m) => { const ll = dir > 0 ? l : 15 - l; if (ax === 0) put(i + ll, j + h, k + w, m); else put(i + w, j + h, k + ll, m); };
  for (let l = 0; l < 16; l++) for (let w = 0; w < 5; w++) {
    const side = w === 0 || w === 4, wheel = side && (l === 1 || l === 2 || l === 4 || l === 5 || l === 13 || l === 14);
    if (wheel) P(l, w, 0, M.rubber); else if (!side) P(l, w, 0, M.metal_dark);
    if (l <= 10) for (let h = 1; h <= 5; h++) {
      if (side && (h === 1 || h === 5)) continue;
      const core = l > 0 && l < 10 && w >= 1 && w <= 3 && h >= 2 && h <= 4;
      if (!core) P(l, w, h, M.fuel_tank);
    } else if (l >= 12) for (let h = 1; h <= 4; h++) {
      const shell = side || l === 12 || l === 15 || h === 1 || h === 4;
      if (shell) P(l, w, h, h === 3 && (side || l === 15) && !(side && l === 12) ? M.glass_dark : M.car_red);
    }
  }
  P(15, 0, 1, M.light_white); P(15, 4, 1, M.light_white); P(0, 1, 0, M.light_red); P(0, 3, 0, M.light_red);
  P(12, 2, 5, M.light_amber);
}
// Jersey barrier row: segments 3 long, 2 high (1 m), 1-voxel gaps.
export function barrierRow(i, k, ax, len) {
  for (let t = 0; t < len; t++) { if (t % 4 === 3) continue; const x = ax === 0 ? i + t : i, z = ax === 0 ? k : k + t; put(x, J0, z, M.barrier); put(x, J0 + 1, z, t % 4 === 1 ? M.hazard : M.barrier); }
}
// Sandbag nest: a U of bags 2-3 high (1-1.5 m) opening towards (ox,oz), with an ammo crate inside.
export function sandbagNest(i, k, ax, open) {
  for (let t = 0; t < 6; t++) for (let d = 0; d < 3; d++) {
    const wall = d === (open > 0 ? 0 : 2) || t === 0 || t === 5; if (!wall) continue;
    const x = ax === 0 ? i + t : i + d, z = ax === 0 ? k + d : k + t, h = (t === 2 || t === 3) && d !== 1 ? 2 : 3;
    for (let y = 0; y < h; y++) put(x, J0 + y, z, M.sandbag);
  }
  put(ax === 0 ? i + 2 : i + 1, J0, ax === 0 ? k + 1 : k + 2, M.crate);
}
// Low crate cover: 6 long, 2-3 high.
export function crateCover(i, k, ax) {
  const rng = C.rng;
  for (let t = 0; t < 6; t += 2) { const x = ax === 0 ? i + t : i, z = ax === 0 ? k : k + t, h = rng.int(1, 3) > 2 ? 3 : 2; box(x, J0, z, x + 1, J0 + h - 1, z + 1, t === 2 ? M.wood_dark : M.crate); }
}
