// ============================================================================
// KILOTON — city_util.js   OWNER: CITY.
// Low-level writers for the generator: voxel put/box with per-building bounds
// tracking, facade-relative helpers, a 3x5 voxel font, shared context.
// ============================================================================
import { NX, NY, NZ, GROUND_J, hash3 } from './core.js';
import { M } from './materials.js';

export const J0 = GROUND_J;      // first voxel layer above the street
export const FH = 7;             // storey height in voxels (3.5 m), slab is the top voxel of a storey
export const C = { d: null, cur: null, lot: null, bAt: null, rng: null, buildings: null, seed: 0 };

export function get(i, j, k) {
  if (i < 0 || j < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return 0;
  return C.d[i + NX * (k + NZ * j)];
}
export function put(i, j, k, m) {
  if (i < 0 || j < 1 || k < 0 || i >= NX || j >= NY || k >= NZ) return;
  C.d[i + NX * (k + NZ * j)] = m;
  const c = C.cur;
  if (c && m && j >= J0) {
    if (i < c.i0) c.i0 = i; if (i > c.i1) c.i1 = i; if (j > c.j1) c.j1 = j;
    if (k < c.k0) c.k0 = k; if (k > c.k1) c.k1 = k;
    C.bAt[i + NX * k] = c.id + 1;
  }
}
export function box(i0, j0, k0, i1, j1, k1, m) {
  let t;
  if (i0 > i1) { t = i0; i0 = i1; i1 = t; } if (j0 > j1) { t = j0; j0 = j1; j1 = t; } if (k0 > k1) { t = k0; k0 = k1; k1 = t; }
  if (i0 < 0) i0 = 0; if (j0 < 1) j0 = 1; if (k0 < 0) k0 = 0;
  if (i1 >= NX) i1 = NX - 1; if (j1 >= NY) j1 = NY - 1; if (k1 >= NZ) k1 = NZ - 1;
  if (i0 > i1 || j0 > j1 || k0 > k1) return;
  const d = C.d;
  for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const o = NX * (k + NZ * j); d.fill(m, o + i0, o + i1 + 1); }
  const c = C.cur;
  if (c && m && j1 >= J0) {
    if (i0 < c.i0) c.i0 = i0; if (i1 > c.i1) c.i1 = i1; if (j1 > c.j1) c.j1 = j1;
    if (k0 < c.k0) c.k0 = k0; if (k1 > c.k1) c.k1 = k1;
    const id = c.id + 1, bAt = C.bAt;
    for (let k = k0; k <= k1; k++) bAt.fill(id, i0 + NX * k, i1 + 1 + NX * k);
  }
}
// hollow ring (walls of a box), 1 voxel thick
export function ring(i0, j0, k0, i1, j1, k1, m) {
  box(i0, j0, k0, i1, j1, k0, m); box(i0, j0, k1, i1, j1, k1, m);
  box(i0, j0, k0, i0, j1, k1, m); box(i1, j0, k0, i1, j1, k1, m);
}
export function begin(kind, name) {
  const b = { id: C.buildings.length, kind, name, i0: NX, j0: J0, k0: NZ, i1: -1, j1: J0, k1: -1, voxels: 0, alive: true };
  C.buildings.push(b); C.cur = b; return b;
}
export function end() { C.cur = null; }
// ground surface (j = 3) and lot code for a rectangle
export function surface(i0, k0, i1, k1, m, lot) {
  const save = C.cur; C.cur = null;
  if (m) box(i0, J0 - 1, k0, i1, J0 - 1, k1, m);
  C.cur = save;
  if (lot !== undefined) {
    if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= NX) i1 = NX - 1; if (k1 >= NZ) k1 = NZ - 1;
    for (let k = k0; k <= k1; k++) C.lot.fill(lot, i0 + NX * k, i1 + 1 + NX * k);
  }
}

// ---- facade-relative writers ------------------------------------------------
// sides: 0 north (k = k0, faces -z), 1 south (k = k1), 2 west (i = i0), 3 east (i = i1)
// a = absolute coordinate along the face (i for sides 0/1, k for sides 2/3), out = voxels outward from the wall plane
export function fput(r, s, a, j, out, m) {
  if (s === 0) put(a, j, r.k0 - out, m); else if (s === 1) put(a, j, r.k1 + out, m);
  else if (s === 2) put(r.i0 - out, j, a, m); else put(r.i1 + out, j, a, m);
}
export function fbox(r, s, a0, a1, j0, j1, o0, o1, m) {
  if (s === 0) box(a0, j0, r.k0 - o0, a1, j1, r.k0 - o1, m); else if (s === 1) box(a0, j0, r.k1 + o0, a1, j1, r.k1 + o1, m);
  else if (s === 2) box(r.i0 - o0, j0, a0, r.i0 - o1, j1, a1, m); else box(r.i1 + o0, j0, a0, r.i1 + o1, j1, a1, m);
}
export const sideLo = (r, s) => s < 2 ? r.i0 : r.k0;
export const sideHi = (r, s) => s < 2 ? r.i1 : r.k1;
export const READ_DIR = [-1, 1, 1, -1];     // direction of increasing `a` that reads left-to-right from outside

// ---- 3x5 voxel font -----------------------------------------------------------
const GL = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', ' ': '000000000000000', '-': '000000111000000', '+': '000010111010000',
};
export const textW = (s) => s.length * 4 - 1;
// Draws text on a vertical plane. cell(c, row, on) is called for every cell of the w x 5 block
// (c = column left->right as read, row 0 = top).
export function glyphs(str, cell) {
  for (let n = 0; n < str.length; n++) {
    const g = GL[str[n]] || GL[' '];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) cell(n * 4 + c, r, g[r * 3 + c] === '1');
    if (n < str.length - 1) for (let r = 0; r < 5; r++) cell(n * 4 + 3, r, false);
  }
}
// Text embedded in / mounted on a facade. aC = centre coordinate along the face, jB = bottom row.
// Every cell of the text block is written (fg where the glyph is, bg elsewhere; bg 0 = leave as is).
export function ftext(r, s, str, aC, jB, out, fg, bg) {
  const w = textW(str), dir = READ_DIR[s], a0 = aC - dir * (w >> 1);
  glyphs(str, (c, row, on) => { if (on) fput(r, s, a0 + dir * c, jB + 4 - row, out, fg); else if (bg) fput(r, s, a0 + dir * c, jB + 4 - row, out, bg); });
}
// Vertical blade sign: letters stacked top to bottom on a board that sticks out of the facade at coordinate a.
export function blade(r, s, str, a, jTop, fg, bg) {
  const h = str.length * 6 + 1;
  fbox(r, s, a, a, jTop - h + 1, jTop, 1, 5, bg);
  for (let n = 0; n < str.length; n++) {
    const g = GL[str[n]] || GL[' '];
    for (let row = 0; row < 5; row++) for (let c = 0; c < 3; c++) if (g[row * 3 + c] === '1') {
      // read from the side the street traffic sees: outward = left to right
      fput(r, s, a, jTop - 1 - n * 6 - row, 2 + c, fg);
    }
  }
}
export function hsh(a, b, c) { return hash3(a + C.seed, b, c); }
export { M };
