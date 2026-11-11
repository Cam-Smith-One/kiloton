// ============================================================================
// KILOTON — render_mesher.js   OWNER: RENDER
// Greedy chunk mesher. One 32^3 chunk -> two vertex streams (opaque, glass).
//  - faces culled against neighbours (a padded 34^3 copy makes this branch-free)
//  - per-vertex ambient occlusion (0..3), quads merged only where the merge
//    keeps the AO interpolation exact (so merged and unmerged look identical)
//  - 8 bytes per vertex: x y z _ | material, ao + 4*face, _ _   (chunk-local
//    voxel coordinates 0..32; the mesh is scaled by VS)
//  - vertex order is arranged so every quad uses the index pattern 0 1 2 0 2 3
// Zero allocation while meshing; the caller copies the result out.
// ============================================================================
import { NX, NY, NZ, CS, CX, CZ, GROUND_J } from './core.js';
import { GLASS, MAT, EMISSIVE, M } from './materials.js';

const P = CS + 2, P2 = P * P, P3 = P * P * P;
const pad = new Uint8Array(P3);

// 0 air, 1 opaque, 2 translucent (separate pass)
export const TYPE = new Uint8Array(256);
const OCC = new Uint8Array(256);            // occludes ambient light
for (let id = 1; id < 256; id++) {
  const m = MAT[id];
  if (!m) { TYPE[id] = 1; OCC[id] = 1; continue; }
  TYPE[id] = (GLASS[id] && id !== M.window_lit) ? 2 : 1;
  OCC[id] = TYPE[id] === 1 && !(EMISSIVE[id] > 0.5) && id !== M.foliage ? 1 : 0;
}

// merge legality by AO pattern (a0 | a1<<2 | a2<<4 | a3<<6): constant along u / along v
const U_OK = new Uint8Array(256), V_OK = new Uint8Array(256);
for (let a = 0; a < 256; a++) {
  const a0 = a & 3, a1 = (a >> 2) & 3, a2 = (a >> 4) & 3, a3 = (a >> 6) & 3;
  U_OK[a] = (a0 === a1 && a3 === a2) ? 1 : 0;
  V_OK[a] = (a0 === a3 && a1 === a2) ? 1 : 0;
}

const mask = new Int32Array(CS * CS);
const STRIDE = [1, P2, P];                 // x, y, z strides in the padded copy
const UAX = [1, 2, 0], VAX = [2, 0, 1];    // u x v = w for w = x, y, z

function Stream() { this.buf = new Uint8Array(1 << 16); this.n = 0; this.min = [0, 0, 0]; this.max = [0, 0, 0]; }
export const opaque = new Stream(), glass = new Stream();
export const result = { opaque, glass, hash: 0, empty: true };

function grow(s) { const b = new Uint8Array(s.buf.length * 2); b.set(s.buf); s.buf = b; }

// Copy the chunk plus a one-voxel border. Returns a hash of the copy (unchanged hash = nothing to rebuild).
function fillPad(ci, cj, ck, data) {
  const i0 = ci * CS - 1, a = i0 < 0 ? 1 : 0, b = i0 + P > NX ? P - 1 : P;
  for (let y = 0; y < P; y++) {
    const j = cj * CS + y - 1, under = j < GROUND_J ? 1 : 0;
    for (let z = 0; z < P; z++) {
      const k = ck * CS + z - 1, o = P * (z + P * y);
      if (j < 0) pad.fill(1, o, o + P);
      else if (j >= NY || k < 0 || k >= NZ) pad.fill(under, o, o + P);
      else {
        const src = i0 + NX * (k + NZ * j);
        pad.set(data.subarray(src + a, src + b), o + a);
        if (a) pad[o] = under;
        if (b < P) pad[o + P - 1] = under;
      }
    }
  }
  let h = 2166136261 | 0;
  for (let n = 0; n < P3; n++) h = Math.imul(h ^ pad[n], 16777619);
  return h | 0;
}

function emit(s, w, d, wc, u0, v0, u1, v1, m, ao) {
  if (s.n + 32 > s.buf.length) grow(s);
  const buf = s.buf, u = UAX[w], v = VAX[w];
  let a0 = ao & 3, a1 = (ao >> 2) & 3, a2 = (ao >> 4) & 3, a3 = (ao >> 6) & 3;
  // corners c0 (u0,v0) c1 (u1,v0) c2 (u1,v1) c3 (u0,v1); reverse for negative faces
  let cu0 = u0, cv0 = v0, cu1 = u1, cv1 = v0, cu2 = u1, cv2 = v1, cu3 = u0, cv3 = v1, t;
  if (d & 1) { t = cu1; cu1 = cu3; cu3 = t; t = cv1; cv1 = cv3; cv3 = t; t = a1; a1 = a3; a3 = t; }
  if (a0 + a2 < a1 + a3) {               // rotate so the split diagonal joins the brighter pair
    t = cu0; cu0 = cu1; cu1 = cu2; cu2 = cu3; cu3 = t;
    t = cv0; cv0 = cv1; cv1 = cv2; cv2 = cv3; cv3 = t;
    t = a0; a0 = a1; a1 = a2; a2 = a3; a3 = t;
  }
  let o = s.n; const dd = d << 2;
  buf[o + w] = wc; buf[o + u] = cu0; buf[o + v] = cv0; buf[o + 4] = m; buf[o + 5] = a0 | dd; o += 8;
  buf[o + w] = wc; buf[o + u] = cu1; buf[o + v] = cv1; buf[o + 4] = m; buf[o + 5] = a1 | dd; o += 8;
  buf[o + w] = wc; buf[o + u] = cu2; buf[o + v] = cv2; buf[o + 4] = m; buf[o + 5] = a2 | dd; o += 8;
  buf[o + w] = wc; buf[o + u] = cu3; buf[o + v] = cv3; buf[o + 4] = m; buf[o + 5] = a3 | dd;
  s.n += 32;
  const mn = s.min, mx = s.max;
  if (wc < mn[w]) mn[w] = wc; if (wc > mx[w]) mx[w] = wc;
  if (u0 < mn[u]) mn[u] = u0; if (u1 > mx[u]) mx[u] = u1;
  if (v0 < mn[v]) mn[v] = v0; if (v1 > mx[v]) mx[v] = v1;
}

// Mesh chunk (ci, cj, ck). If lastHash matches the chunk's current content, returns null (nothing changed).
export function meshChunk(ci, cj, ck, data, lastHash) {
  const hash = fillPad(ci, cj, ck, data);
  if (lastHash !== undefined && hash === lastHash) return null;
  opaque.n = 0; glass.n = 0;
  for (let a = 0; a < 3; a++) { opaque.min[a] = glass.min[a] = 255; opaque.max[a] = glass.max[a] = 0; }
  result.hash = hash;
  const OFF = 1 + P + P2;
  for (let d = 0; d < 6; d++) {
    const w = d >> 1, neg = d & 1, su = STRIDE[UAX[w]], sv = STRIDE[VAX[w]], sw = neg ? -STRIDE[w] : STRIDE[w];
    for (let wl = 0; wl < CS; wl++) {
      const base = OFF + wl * STRIDE[w];
      let any = 0, n = 0;
      for (let v = 0; v < CS; v++) {
        let p = base + v * sv;
        for (let u = 0; u < CS; u++, p += su, n++) {
          const m = pad[p];
          if (m === 0) { mask[n] = 0; continue; }
          const t = TYPE[m], q = p + sw, tn = TYPE[pad[q]];
          if (t === 1 ? tn === 1 : tn !== 0) { mask[n] = 0; continue; }
          let ao = 255;
          if (t === 1) {
            const s1 = OCC[pad[q - su]], s2 = OCC[pad[q + su]], s3 = OCC[pad[q - sv]], s4 = OCC[pad[q + sv]];
            const c00 = OCC[pad[q - su - sv]], c10 = OCC[pad[q + su - sv]], c11 = OCC[pad[q + su + sv]], c01 = OCC[pad[q - su + sv]];
            if (s1 | s2 | s3 | s4 | c00 | c10 | c11 | c01) {
              const a0 = (s1 & s3) ? 0 : 3 - s1 - s3 - c00, a1 = (s2 & s3) ? 0 : 3 - s2 - s3 - c10;
              const a2 = (s2 & s4) ? 0 : 3 - s2 - s4 - c11, a3 = (s1 & s4) ? 0 : 3 - s1 - s4 - c01;
              ao = a0 | (a1 << 2) | (a2 << 4) | (a3 << 6);
            }
          }
          mask[n] = m | (ao << 8) | (t === 2 ? 65536 : 0); any = 1;
        }
      }
      if (!any) continue;
      const wc = wl + (neg ? 0 : 1);
      n = 0;
      for (let v = 0; v < CS; v++) {
        for (let u = 0; u < CS;) {
          const key = mask[n];
          if (key === 0) { u++; n++; continue; }
          const ao = (key >> 8) & 255;
          let wd = 1, ht = 1;
          if (U_OK[ao]) while (u + wd < CS && mask[n + wd] === key) wd++;
          if (V_OK[ao]) {
            outer: for (; v + ht < CS; ht++) {
              const row = n + ht * CS;
              for (let x = 0; x < wd; x++) if (mask[row + x] !== key) break outer;
            }
          }
          for (let y = 0; y < ht; y++) { const row = n + y * CS; for (let x = 0; x < wd; x++) mask[row + x] = 0; }
          emit(key & 65536 ? glass : opaque, w, d, wc, u, v, u + wd, v + ht, key & 255, ao);
          u += wd; n += wd;
        }
      }
    }
  }
  result.empty = opaque.n === 0 && glass.n === 0;
  return result;
}

export function chunkCoords(c, out) { out[0] = c % CX; out[2] = Math.floor(c / CX) % CZ; out[1] = Math.floor(c / (CX * CZ)); return out; }
