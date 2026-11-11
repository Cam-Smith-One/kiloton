// ============================================================================
// KILOTON — voxels.js   OWNER: lead. Other modules must not edit this file.
// The voxel grid: storage, dirty-chunk tracking, ray casting, box queries and
// the character mover. Index = i + NX * (k + NZ * j)   (i east, j up, k south).
// World metres = voxel index * VS. Outside the grid: below = bedrock, else air.
// ============================================================================
import { G, VS, NX, NY, NZ, CS, CX, CY, CZ, bus } from './core.js';
import { SOLID, M } from './materials.js';

const INV = 1 / VS;
const data = new Uint8Array(NX * NY * NZ);
const dirty = new Set();
const NXZ = NX * NZ;
const _ray = { hit: false, i: 0, j: 0, k: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, mat: 0, dist: 0 };

function markDirty(i, j, k) {
  const ci = i >> 5, cj = j >> 5, ck = k >> 5;
  dirty.add(ci + CX * (ck + CZ * cj));
  const li = i & 31, lj = j & 31, lk = k & 31;       // boundary voxels touch the neighbour chunk's faces / AO
  if (li === 0 && ci > 0) dirty.add(ci - 1 + CX * (ck + CZ * cj)); else if (li === 31 && ci < CX - 1) dirty.add(ci + 1 + CX * (ck + CZ * cj));
  if (lj === 0 && cj > 0) dirty.add(ci + CX * (ck + CZ * (cj - 1))); else if (lj === 31 && cj < CY - 1) dirty.add(ci + CX * (ck + CZ * (cj + 1)));
  if (lk === 0 && ck > 0) dirty.add(ci + CX * (ck - 1 + CZ * cj)); else if (lk === 31 && ck < CZ - 1) dirty.add(ci + CX * (ck + 1 + CZ * cj));
}

export const grid = {
  data, NX, NY, NZ, dirty,
  version: 0,                 // bumps on every edit (nav / AI caches can compare)
  pristine: null,             // copy of data taken after city generation (for restart)
  idx(i, j, k) { return i + NX * (k + NZ * j); },
  inside(i, j, k) { return i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ; },
  get(i, j, k) {
    if (j < 0) return M.bedrock;
    if (i < 0 || k < 0 || i >= NX || j >= NY || k >= NZ) return 0;
    return data[i + NX * (k + NZ * j)];
  },
  // Raw write for world generation (no dirty tracking; call markAllDirty() after).
  fill(i, j, k, m) { if (i >= 0 && j >= 0 && k >= 0 && i < NX && j < NY && k < NZ) data[i + NX * (k + NZ * j)] = m; },
  fillBox(i0, j0, k0, i1, j1, k1, m) {             // inclusive bounds, clipped
    if (i0 < 0) i0 = 0; if (j0 < 0) j0 = 0; if (k0 < 0) k0 = 0;
    if (i1 >= NX) i1 = NX - 1; if (j1 >= NY) j1 = NY - 1; if (k1 >= NZ) k1 = NZ - 1;
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) { const o = NX * (k + NZ * j); data.fill(m, o + i0, o + i1 + 1); }
  },
  // Runtime edit: tracks dirty chunks. Bedrock (j = 0) cannot be changed.
  set(i, j, k, m) {
    if (i < 0 || j < 1 || k < 0 || i >= NX || j >= NY || k >= NZ) return false;
    const o = i + NX * (k + NZ * j);
    if (data[o] === m) return false;
    data[o] = m; this.version++; markDirty(i, j, k); return true;
  },
  markAllDirty() { for (let c = 0; c < CX * CY * CZ; c++) dirty.add(c); this.version++; },
  takeDirty(max) {             // -> array of chunk ids (ci + CX*(ck + CZ*cj)), removed from the dirty set
    const out = [];
    for (const c of dirty) { out.push(c); if (out.length >= max) break; }
    for (const c of out) dirty.delete(c);
    return out;
  },
  snapshot() { this.pristine = data.slice(); },
  restore() { if (this.pristine) { data.set(this.pristine); this.markAllDirty(); } },

  // ---- world-space queries --------------------------------------------------
  matAt(x, y, z) { return this.get(Math.floor(x * INV), Math.floor(y * INV), Math.floor(z * INV)); },
  solidAt(x, y, z) { return SOLID[this.get(Math.floor(x * INV), Math.floor(y * INV), Math.floor(z * INV))] === 1; },
  // Any solid voxel overlapping the world box?
  boxSolid(x0, y0, z0, x1, y1, z1) {
    const e = 1e-4;
    let i0 = Math.floor(x0 * INV), i1 = Math.floor((x1 - e) * INV), j0 = Math.floor(y0 * INV), j1 = Math.floor((y1 - e) * INV), k0 = Math.floor(z0 * INV), k1 = Math.floor((z1 - e) * INV);
    if (j0 < 0) return true;
    if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= NX) i1 = NX - 1; if (j1 >= NY) j1 = NY - 1; if (k1 >= NZ) k1 = NZ - 1;
    for (let j = j0; j <= j1; j++) for (let k = k0; k <= k1; k++) {
      const o = NX * (k + NZ * j);
      for (let i = i0; i <= i1; i++) if (SOLID[data[o + i]]) return true;
    }
    return false;
  },
  // Height (m) of the top of the highest solid voxel at (x,z) at or below yStart. Returns 0 if none.
  topBelow(x, yStart, z) {
    const i = Math.floor(x * INV), k = Math.floor(z * INV);
    if (i < 0 || k < 0 || i >= NX || k >= NZ) return 0;
    let j = Math.min(NY - 1, Math.floor(yStart * INV));
    for (; j >= 0; j--) if (SOLID[data[i + NX * (k + NZ * j)]]) return (j + 1) * VS;
    return 0;
  },
  // Voxel DDA. Direction need not be normalised (it is normalised here). Returns a SHARED object:
  //   { hit, i,j,k (voxel), x,y,z (point), nx,ny,nz (face normal), mat, dist }
  // passGlass=true lets the ray continue through glass voxels (use for line-of-sight).
  raycast(ox, oy, oz, dx, dy, dz, maxDist, passGlass) {
    const r = _ray; r.hit = false; r.dist = maxDist; r.mat = 0;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz); if (len < 1e-9) return r;
    dx /= len; dy /= len; dz /= len;
    let i = Math.floor(ox * INV), j = Math.floor(oy * INV), k = Math.floor(oz * INV);
    const si = dx > 0 ? 1 : -1, sj = dy > 0 ? 1 : -1, sk = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(VS / dx) : Infinity, tdy = dy !== 0 ? Math.abs(VS / dy) : Infinity, tdz = dz !== 0 ? Math.abs(VS / dz) : Infinity;
    let tx = dx !== 0 ? ((dx > 0 ? (i + 1) * VS - ox : ox - i * VS)) / Math.abs(dx) : Infinity;
    let ty = dy !== 0 ? ((dy > 0 ? (j + 1) * VS - oy : oy - j * VS)) / Math.abs(dy) : Infinity;
    let tz = dz !== 0 ? ((dz > 0 ? (k + 1) * VS - oz : oz - k * VS)) / Math.abs(dz) : Infinity;
    let t = 0, face = -1;
    for (let n = 0; n < 2048; n++) {
      if (j < 0) { r.hit = true; r.mat = M.bedrock; break; }
      if (i >= 0 && k >= 0 && i < NX && j < NY && k < NZ) {
        const m = data[i + NX * (k + NZ * j)];
        if (m && SOLID[m] && !(passGlass && (m === 17 || m === 18 || m === 19))) { r.hit = true; r.mat = m; break; }
      } else if ((i < 0 && si < 0) || (i >= NX && si > 0) || (k < 0 && sk < 0) || (k >= NZ && sk > 0) || (j >= NY && sj > 0)) break;
      if (tx < ty && tx < tz) { t = tx; tx += tdx; i += si; face = 0; }
      else if (ty < tz) { t = ty; ty += tdy; j += sj; face = 1; }
      else { t = tz; tz += tdz; k += sk; face = 2; }
      if (t > maxDist) break;
    }
    if (r.hit) {
      r.i = i; r.j = j; r.k = k; r.dist = t;
      r.x = ox + dx * t; r.y = oy + dy * t; r.z = oz + dz * t;
      r.nx = face === 0 ? -si : 0; r.ny = face === 1 ? -sj : 0; r.nz = face === 2 ? -sk : 0;
      if (face < 0) { r.ny = 1; }
    }
    return r;
  },
  // Line of sight between two points (glass does not block).
  los(x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-6) return true;
    return !this.raycast(x0, y0, z0, dx, dy, dz, d - 0.3, true).hit;
  },

  // ---- character mover -------------------------------------------------------
  // body = { pos: Vector3 (feet centre), vel: Vector3, hw (half width m), h (height m), stepUp (m), onGround, hitWall, hitCeil, landSpeed }
  // Moves body by vel*dt against solid voxels, axis by axis, with auto step-up. Mutates pos / vel / flags.
  moveBody(b, dt) {
    const p = b.pos, v = b.vel, hw = b.hw, h = b.h;
    const dist = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)) * dt;
    const steps = Math.min(12, Math.max(1, Math.ceil(dist / (VS * 0.9))));
    const sdt = dt / steps;
    b.hitWall = false; b.hitCeil = false; b.landSpeed = 0;
    const wasGround = b.onGround;
    for (let s = 0; s < steps; s++) {
      // X
      let nx = p.x + v.x * sdt;
      if (v.x !== 0) {
        if (this.boxSolid(nx - hw, p.y + 0.02, p.z - hw, nx + hw, p.y + h, p.z + hw)) {
          let stepped = false;
          if ((wasGround || b.onGround) && b.stepUp > 0) {
            for (let up = VS; up <= b.stepUp + 1e-6; up += VS) {
              const ty = (Math.floor(p.y * INV + 1e-4) * VS) + up;
              if (!this.boxSolid(nx - hw, ty + 0.02, p.z - hw, nx + hw, ty + h, p.z + hw) && !this.boxSolid(p.x - hw, ty + 0.02, p.z - hw, p.x + hw, ty + h, p.z + hw)) { p.y = ty; p.x = nx; stepped = true; break; }
            }
          }
          if (!stepped) { v.x = 0; b.hitWall = true; }
        } else p.x = nx;
      }
      // Z
      let nz = p.z + v.z * sdt;
      if (v.z !== 0) {
        if (this.boxSolid(p.x - hw, p.y + 0.02, nz - hw, p.x + hw, p.y + h, nz + hw)) {
          let stepped = false;
          if ((wasGround || b.onGround) && b.stepUp > 0) {
            for (let up = VS; up <= b.stepUp + 1e-6; up += VS) {
              const ty = (Math.floor(p.y * INV + 1e-4) * VS) + up;
              if (!this.boxSolid(p.x - hw, ty + 0.02, nz - hw, p.x + hw, ty + h, nz + hw) && !this.boxSolid(p.x - hw, ty + 0.02, p.z - hw, p.x + hw, ty + h, p.z + hw)) { p.y = ty; p.z = nz; stepped = true; break; }
            }
          }
          if (!stepped) { v.z = 0; b.hitWall = true; }
        } else p.z = nz;
      }
      // Y
      const ny = p.y + v.y * sdt;
      if (v.y <= 0) {
        if (this.boxSolid(p.x - hw, ny - 0.02, p.z - hw, p.x + hw, ny + h, p.z + hw)) {
          // land on the top of the voxel layer we ran into
          const top = (Math.floor((ny - 0.02) * INV) + 1) * VS;
          if (!this.boxSolid(p.x - hw, top + 0.001, p.z - hw, p.x + hw, top + h, p.z + hw)) p.y = top;
          if (!b.onGround) b.landSpeed = Math.max(b.landSpeed, -v.y);
          v.y = 0; b.onGround = true;
        } else { p.y = ny; b.onGround = false; }
      } else {
        if (this.boxSolid(p.x - hw, ny, p.z - hw, p.x + hw, ny + h, p.z + hw)) { v.y = 0; b.hitCeil = true; }
        else { p.y = ny; b.onGround = false; }
      }
    }
    // keep bodies inside the map
    const m = hw + 0.5;
    if (p.x < m) { p.x = m; if (v.x < 0) v.x = 0; } else if (p.x > NX * VS - m) { p.x = NX * VS - m; if (v.x > 0) v.x = 0; }
    if (p.z < m) { p.z = m; if (v.z < 0) v.z = 0; } else if (p.z > NZ * VS - m) { p.z = NZ * VS - m; if (v.z > 0) v.z = 0; }
    if (p.y < 0.5) { p.y = 0.5; v.y = 0; b.onGround = true; }
  },
  // If a body is embedded in solid voxels (rubble fell on it), push it up to the first free spot. Returns metres moved.
  unstick(b, maxUp) {
    const p = b.pos; let up = 0;
    while (up < (maxUp || 6) && this.boxSolid(p.x - b.hw, p.y + 0.05, p.z - b.hw, p.x + b.hw, p.y + b.h, p.z + b.hw)) { p.y += VS; up += VS; }
    return up;
  },
};
G.grid = grid;
