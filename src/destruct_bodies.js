// ============================================================================
// KILOTON — destruct_bodies.js   OWNER: DESTRUCT
// Debris: "bits" (single cubes, point physics, instanced) and rigid voxel
// bodies (clusters with pose + angular velocity, own mesh, sampled collision
// against the grid). Resting debris is written back into the grid as rubble.
// ============================================================================
import { G, THREE, VS, NX, NY, NZ, bus } from './core.js';
import { SOLID, DENSITY, GLASS, EMISSIVE } from './materials.js';
import { data, INV, LAYER, GRAV, LIN, ctx, stats, put, RUBBLE, BARREL, CHARRED, hooks, rnd, hsh, flush, canHurt, over, clock, reseed } from './destruct_base.js';

// ---- tuning -------------------------------------------------------------------
export const TUNE = {
  bitDamage: 0.8,           // hp per (mass * m/s) for a flying cube
  bodyDamage: 1.2,          // hp per (sqrt(mass) * m/s) for a rigid body
  bodyDamageCap: 260,       // per hit; an entity takes at most one body hit per 0.3 s
  thrownDamage: 3, thrownDamageCap: 700,   // a thrown chunk / car hitting an entity directly
  crushSpeedTile: 1.5,      // m/s closing speed at which a collapsing storey module crushes
  crushSpeedBody: 5,        // same for a loose big body
  splitSpeed: 8.5,          // medium bodies break in two above this
  heapDust: 0.2,           // share of a crushed module lost as dust
  heapBits: 0.07,           // share thrown out as cubes
  heapChunks: 0.2,         // share of 2 m cells that tumble away as smaller bodies
  rubbleMix: 0.3,           // share of heap voxels deposited as grey `rubble` instead of their own material
};

// ============================================================================
// Bits
// ============================================================================
export const MAXB = 3500;
const X = new Float32Array(MAXB), Y = new Float32Array(MAXB), Z = new Float32Array(MAXB);
const VX = new Float32Array(MAXB), VY = new Float32Array(MAXB), VZ = new Float32Array(MAXB);
const AX = new Float32Array(MAXB), AY = new Float32Array(MAXB), AZ = new Float32Array(MAXB);
const ANG = new Float32Array(MAXB), SPIN = new Float32Array(MAXB), SZ = new Float32Array(MAXB);
const LIFE = new Float32Array(MAXB), REST = new Float32Array(MAXB);
const CR = new Float32Array(MAXB), CG = new Float32Array(MAXB), CB = new Float32Array(MAXB);
const MT = new Uint8Array(MAXB), FL = new Uint8Array(MAXB);     // FL: 1 deposit when resting, 2 damaging, 4 shrinking out
const OWN = new Array(MAXB).fill(null);
let nb = 0, cursor = 0, bitCap = MAXB, bitMesh = null, bodyMat = null, bodyCap = 200;
export function bitCount() { return nb; }
export function bitRoom() { return bitCap - nb; }

function slot() {
  if (nb < bitCap) return nb++;
  cursor = (cursor + 1) % bitCap; return cursor;              // at the cap: recycle (oldest-ish first)
}
export function spawnBit(x, y, z, vx, vy, vz, mat, size, flags, owner) {
  const n = slot(), v = 0.78 + 0.4 * rnd(), e = 1 + EMISSIVE[mat] * 0.6;
  X[n] = x; Y[n] = y; Z[n] = z; VX[n] = vx; VY[n] = vy; VZ[n] = vz;
  CR[n] = LIN[mat * 3] * v * e; CG[n] = LIN[mat * 3 + 1] * v * e; CB[n] = LIN[mat * 3 + 2] * v * e;
  finishBit(n, mat, size, flags, owner);
}
export function spawnBitRGB(x, y, z, vx, vy, vz, r, g, b, size) {
  const n = slot();
  X[n] = x; Y[n] = y; Z[n] = z; VX[n] = vx; VY[n] = vy; VZ[n] = vz; CR[n] = r; CG[n] = g; CB[n] = b;
  finishBit(n, 0, size, 0, null);
}
function finishBit(n, mat, size, flags, owner) {
  let ax = rnd() - 0.5, ay = rnd() - 0.5, az = rnd() - 0.5; const l = 1 / (Math.sqrt(ax * ax + ay * ay + az * az) + 1e-6);
  AX[n] = ax * l; AY[n] = ay * l; AZ[n] = az * l; ANG[n] = rnd() * 6.28; SPIN[n] = (rnd() - 0.5) * 18;
  SZ[n] = size; LIFE[n] = 5 + rnd() * 4; REST[n] = 0; MT[n] = mat; FL[n] = flags; OWN[n] = owner || null;
}
function killBit(n) {
  const l = --nb;
  if (n !== l) {
    X[n] = X[l]; Y[n] = Y[l]; Z[n] = Z[l]; VX[n] = VX[l]; VY[n] = VY[l]; VZ[n] = VZ[l]; AX[n] = AX[l]; AY[n] = AY[l]; AZ[n] = AZ[l];
    ANG[n] = ANG[l]; SPIN[n] = SPIN[l]; SZ[n] = SZ[l]; LIFE[n] = LIFE[l]; REST[n] = REST[l]; CR[n] = CR[l]; CG[n] = CG[l]; CB[n] = CB[l];
    MT[n] = MT[l]; FL[n] = FL[l]; OWN[n] = OWN[l];
  }
  OWN[l] = null;
}
function sol(x, y, z) {
  const j = Math.floor(y * INV); if (j < 0) return 1; if (j >= NY) return 0;
  const i = Math.floor(x * INV), k = Math.floor(z * INV);
  if (i < 0 || k < 0 || i >= NX || k >= NZ) return 0;
  return SOLID[data[i + NX * (k + NZ * j)]];
}
function cellSolid(i, j, k) {
  if (j < 0) return 1; if (j >= NY || i < 0 || k < 0 || i >= NX || k >= NZ) return 0;
  return SOLID[data[i + NX * (k + NZ * j)]];
}

// Drop a voxel of material m into the grid at/near (i,j,k): up out of occupied cells, down until supported,
// optionally sliding off steep piles (angle of repose). Guarantees nothing is left floating.
const SDI = [1, -1, 0, 0], SDK = [0, 0, 1, -1];
export function settle(i, j, k, m, slide) {
  if (i < 1 || k < 1 || i >= NX - 1 || k >= NZ - 1) return false;
  if (j >= NY) j = NY - 1; if (j < 1) j = 1;
  if (m === BARREL) m = CHARRED;                 // spent barrels do not re-arm in the rubble
  let o = i + NX * (k + NZ * j), up = 0;
  while (data[o]) { j++; o += LAYER; if (++up > 5 || j >= NY) return false; }
  while (j > 1 && !data[o - LAYER]) { j--; o -= LAYER; }
  if (slide) {
    // roll downhill: move to the lowest neighbouring column while it is at least 2 voxels lower
    for (let s = 0; s < 6 && j > 2; s++) {
      const h = (Math.imul(i * 7 + k * 13 + j * 3 + s, 2654435761) >>> 28) & 3; let bestD = 1, bq = -1;
      for (let d = 0; d < 4; d++) {
        const q = (h + d) & 3, ni = i + SDI[q], nk = k + SDK[q];
        if (ni < 1 || nk < 1 || ni >= NX - 1 || nk >= NZ - 1) continue;
        let no = o + SDI[q] + NX * SDK[q]; if (data[no]) continue;
        let dep = 0; while (dep < 5 && dep < j - 1 && !data[no - LAYER]) { no -= LAYER; dep++; }
        if (dep > bestD) { bestD = dep; bq = q; }
      }
      if (bq < 0) break;
      i += SDI[bq]; k += SDK[bq]; o += SDI[bq] + NX * SDK[bq] - bestD * LAYER; j -= bestD;
      while (j > 1 && !data[o - LAYER]) { j--; o -= LAYER; }
    }
  }
  put(i, j, k, m); stats.deposited++;
  return true;
}

export function updateBits(dt) {
  const L = G.ents.list, ne = L.length, parity = G.frame & 1;
  for (let n = nb - 1; n >= 0; n--) {
    let f = FL[n];
    if (f & 4) { SZ[n] -= dt * 0.8; if (SZ[n] < 0.04) { killBit(n); continue; } }
    LIFE[n] -= dt;
    let x = X[n], y = Y[n], z = Z[n], vx = VX[n], vy = VY[n] - GRAV * dt, vz = VZ[n];
    const h = SZ[n] * 0.5;
    const m = Math.max(Math.abs(vx), Math.abs(vy), Math.abs(vz)) * dt;
    const steps = m > 0.45 ? Math.min(4, Math.ceil(m / 0.45)) : 1, sdt = dt / steps;
    let grounded = false;
    for (let s = 0; s < steps; s++) {
      const nx = x + vx * sdt;
      if (sol(nx + (vx > 0 ? h : -h), y, z)) { vx *= -0.3; vy *= 0.85; vz *= 0.85; } else x = nx;
      const nz = z + vz * sdt;
      if (sol(x, y, nz + (vz > 0 ? h : -h))) { vz *= -0.3; vy *= 0.85; vx *= 0.85; } else z = nz;
      const ny = y + vy * sdt;
      if (vy <= 0) {
        if (sol(x, ny - h, z)) {
          y = (Math.floor((ny - h) * INV) + 1) * VS + h;
          if (vy < -3) vy *= -0.26; else { vy = 0; grounded = true; }
          vx *= 0.7; vz *= 0.7;
        } else y = ny;
      } else if (sol(x, ny + h, z)) vy *= -0.2; else y = ny;
    }
    const sp2 = vx * vx + vy * vy + vz * vz;
    // hit entities (alternate halves per frame)
    if ((f & 2) && sp2 > 30 && (n & 1) === parity) {
      for (let q = 0; q < ne; q++) {
        const e = L[q]; if (!e.alive || e === OWN[n] || !canHurt(e)) continue;
        const p = e.pos, r = e.radius + h;
        const dx = x - p.x; if (dx > r || dx < -r) continue;
        const dz = z - p.z; if (dz > r || dz < -r) continue;
        const dy = y - p.y; if (dy < -h || dy > e.height + h) continue;
        const ev = e.vel, rx = vx - ev.x, ry = vy - ev.y, rz = vz - ev.z, rel = Math.sqrt(rx * rx + ry * ry + rz * rz);
        const s3 = SZ[n] * 2, mass = Math.max(0.2, DENSITY[MT[n]]) * s3 * s3 * s3;
        G.ents.damage(e, TUNE.bitDamage * mass * rel, { type: 'debris', src: OWN[n], x, y, z, dx: vx, dy: vy, dz: vz });
        vx *= -0.15; vz *= -0.15; vy *= 0.3; f &= ~2; FL[n] = f;
        break;
      }
    }
    if (grounded && vx * vx + vz * vz < 0.35) REST[n] += dt; else REST[n] = 0;
    if (grounded) SPIN[n] *= 0.8;
    ANG[n] += SPIN[n] * dt;
    X[n] = x; Y[n] = y; Z[n] = z; VX[n] = vx; VY[n] = vy; VZ[n] = vz;
    if (REST[n] > 0.2 || LIFE[n] < 0 || y < -2) {
      if ((f & 1) && grounded && !(f & 4)) { settle(Math.floor(x * INV), Math.floor(y * INV), Math.floor(z * INV), MT[n], 1); killBit(n); }
      else if (!(f & 4)) FL[n] = f | 4;
    }
  }
}
function writeBits() {
  const a = bitMesh.instanceMatrix.array, c = bitMesh.instanceColor.array;
  for (let n = 0, o = 0, p = 0; n < nb; n++, o += 16, p += 3) {
    const ax = AX[n], ay = AY[n], az = AZ[n], s = Math.sin(ANG[n]), co = Math.cos(ANG[n]), t = 1 - co, sz = SZ[n];
    a[o] = (t * ax * ax + co) * sz; a[o + 1] = (t * ax * ay + s * az) * sz; a[o + 2] = (t * ax * az - s * ay) * sz; a[o + 3] = 0;
    a[o + 4] = (t * ax * ay - s * az) * sz; a[o + 5] = (t * ay * ay + co) * sz; a[o + 6] = (t * ay * az + s * ax) * sz; a[o + 7] = 0;
    a[o + 8] = (t * ax * az + s * ay) * sz; a[o + 9] = (t * ay * az - s * ax) * sz; a[o + 10] = (t * az * az + co) * sz; a[o + 11] = 0;
    a[o + 12] = X[n]; a[o + 13] = Y[n]; a[o + 14] = Z[n]; a[o + 15] = 1;
    c[p] = CR[n]; c[p + 1] = CG[n]; c[p + 2] = CB[n];
  }
  if (nb || bitMesh.count) { bitMesh.instanceMatrix.needsUpdate = true; bitMesh.instanceColor.needsUpdate = true; }
  bitMesh.count = nb;
}

// ============================================================================
// Rigid bodies
// ============================================================================
export const MAXV = 16384;                    // voxels per body
const NSMAX = 44;                             // collision sample points per body
export const bld = { n: 0, lat: new Int16Array(3 * MAXV), mat: new Uint8Array(MAXV) };
export function bldPush(i, j, k, m) { const n = bld.n; if (n >= MAXV) return; bld.lat[3 * n] = i; bld.lat[3 * n + 1] = j; bld.lat[3 * n + 2] = k; bld.mat[n] = m; bld.n = n + 1; }

class Body {
  constructor() {
    this.lat = null; this.mat = null; this.n = 0; this.smp = new Float32Array(3 * NSMAX); this.ns = 0; this.mesh = null;
    this.cx = 0; this.cy = 0; this.cz = 0;                    // centre of mass in lattice metres
    this.px = 0; this.py = 0; this.pz = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.qx = 0; this.qy = 0; this.qz = 0; this.qw = 1; this.wx = 0; this.wy = 0; this.wz = 0;
    this.mass = 1; this.inv = 1; this.iIx = 1; this.iIy = 1; this.iIz = 1;
    this.lox = 0; this.loy = 0; this.loz = 0; this.hix = 0; this.hiy = 0; this.hiz = 0; this.rad = 1;
    this.age = 0; this.restT = 0; this.gen = 0; this.grp = 0; this.frozen = false; this.thrown = false; this.dead = false; this.pend = 0;
    this.keep = 0; this.owner = null; this.gx = 0; this.gz = 0; this.topMat = 8; this.pvn = 0; this.phx = 0; this.phy = 0; this.phz = 0;
  }
}
export const bodies = [];
const pool = [];

// ---- geometry -----------------------------------------------------------------------
let occ = new Uint8Array(1 << 15);
// face: normal xyz, then 4 corners
const FACE = [1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, -1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0,
  0, -1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0];
const FSHADE = [0.9, 0.9, 1.0, 0.72, 0.84, 0.84];
function buildGeo(n, L, Mt, cx, cy, cz) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let v = 0, o = 0; v < n; v++, o += 3) { const x = L[o], y = L[o + 1], z = L[o + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const sx = x1 - x0 + 3, sy = y1 - y0 + 3, sz = z1 - z0 + 3, need = sx * sy * sz;
  if (occ.length < need) occ = new Uint8Array(need * 2); else occ.fill(0, 0, need);
  const sxz = sx * sz;
  for (let v = 0, o = 0; v < n; v++, o += 3) occ[(L[o] - x0 + 1) + sx * ((L[o + 2] - z0 + 1) + sz * (L[o + 1] - y0 + 1))] = 1;
  const DO = [1, -1, sxz, -sxz, sx, -sx];
  let faces = 0;
  for (let v = 0, o = 0; v < n; v++, o += 3) { const c = (L[o] - x0 + 1) + sx * ((L[o + 2] - z0 + 1) + sz * (L[o + 1] - y0 + 1)); for (let f = 0; f < 6; f++) if (!occ[c + DO[f]]) faces++; }
  const pos = new Float32Array(faces * 12), nor = new Int8Array(faces * 12), col = new Float32Array(faces * 12);
  const idx = faces * 4 > 65535 ? new Uint32Array(faces * 6) : new Uint16Array(faces * 6);
  let p = 0, q = 0, vi = 0;
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    const x = L[o], y = L[o + 1], z = L[o + 2], c = (x - x0 + 1) + sx * ((z - z0 + 1) + sz * (y - y0 + 1));
    const m = Mt[v], sh = (0.84 + 0.3 * hsh(x, y, z)) * (1 + EMISSIVE[m] * 0.5) * (GLASS[m] && !EMISSIVE[m] ? 0.3 : 1), cr = LIN[m * 3] * sh, cg = LIN[m * 3 + 1] * sh, cb = LIN[m * 3 + 2] * sh;
    for (let f = 0; f < 6; f++) {
      if (occ[c + DO[f]]) continue;
      const fo = f * 15, fs = FSHADE[f];
      for (let w = 0; w < 4; w++) {
        const co = fo + 3 + w * 3;
        pos[p] = (x + FACE[co]) * VS - cx; pos[p + 1] = (y + FACE[co + 1]) * VS - cy; pos[p + 2] = (z + FACE[co + 2]) * VS - cz;
        nor[p] = FACE[fo] * 127; nor[p + 1] = FACE[fo + 1] * 127; nor[p + 2] = FACE[fo + 2] * 127;
        col[p] = cr * fs; col[p + 1] = cg * fs; col[p + 2] = cb * fs; p += 3;
      }
      idx[q] = vi; idx[q + 1] = vi + 1; idx[q + 2] = vi + 2; idx[q + 3] = vi; idx[q + 4] = vi + 2; idx[q + 5] = vi + 3; q += 6; vi += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3, true));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// ---- construction ---------------------------------------------------------------------
const DIRS = [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 1, 1, 1, 1, 1, -1, 1, -1, 1, 1, -1, -1, -1, 1, 1, -1, 1, -1, -1, -1, 1, -1, -1, -1];
const best = new Float32Array(14), bestI = new Int32Array(14);
let r00 = 1, r01 = 0, r02 = 0, r10 = 0, r11 = 1, r12 = 0, r20 = 0, r21 = 0, r22 = 1;
function setRot(b) {
  const x = b.qx, y = b.qy, z = b.qz, w = b.qw;
  r00 = 1 - 2 * (y * y + z * z); r01 = 2 * (x * y - z * w); r02 = 2 * (x * z + y * w);
  r10 = 2 * (x * y + z * w); r11 = 1 - 2 * (x * x + z * z); r12 = 2 * (y * z - x * w);
  r20 = 2 * (x * z - y * w); r21 = 2 * (y * z + x * w); r22 = 1 - 2 * (x * x + y * y);
}
// Turn the voxels in `bld` into a body. With a parent, the lattice is the parent's and the child inherits its motion.
export function makeBody(parent) {
  const n = bld.n; if (!n) return null;
  const L = bld.lat, Mt = bld.mat;
  let mass = 0, sx = 0, sy = 0, sz = 0, x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9, top = 0, topY = -1e9;
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    const m = Math.max(0.15, DENSITY[Mt[v]]), x = L[o], y = L[o + 1], z = L[o + 2];
    mass += m; sx += m * x; sy += m * y; sz += m * z;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    if (y > topY) { topY = y; top = Mt[v]; }
  }
  const cx = (sx / mass + 0.5) * VS, cy = (sy / mass + 0.5) * VS, cz = (sz / mass + 0.5) * VS;
  let ixx = 0, iyy = 0, izz = 0;
  best.fill(-1e9); bestI.fill(-1);
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    const m = Math.max(0.15, DENSITY[Mt[v]]), dx = (L[o] + 0.5) * VS - cx, dy = (L[o + 1] + 0.5) * VS - cy, dz = (L[o + 2] + 0.5) * VS - cz;
    ixx += m * (dy * dy + dz * dz + 0.042); iyy += m * (dx * dx + dz * dz + 0.042); izz += m * (dx * dx + dy * dy + 0.042);
    if (!SOLID[Mt[v]]) continue;
    for (let d = 0; d < 14; d++) { const s = dx * DIRS[d * 3] + dy * DIRS[d * 3 + 1] + dz * DIRS[d * 3 + 2]; if (s > best[d]) { best[d] = s; bestI[d] = v; } }
  }
  const b = pool.pop() || new Body();
  b.n = n; b.lat = L.slice(0, 3 * n); b.mat = Mt.slice(0, n);
  b.cx = cx; b.cy = cy; b.cz = cz; b.mass = mass; b.inv = 1 / mass;
  const im = mass * 0.12;
  b.iIx = 1 / Math.max(ixx, im); b.iIy = 1 / Math.max(iyy, im); b.iIz = 1 / Math.max(izz, im);
  b.lox = x0 * VS - cx; b.loy = y0 * VS - cy; b.loz = z0 * VS - cz; b.hix = (x1 + 1) * VS - cx; b.hiy = (y1 + 1) * VS - cy; b.hiz = (z1 + 1) * VS - cz;
  const ex = Math.max(-b.lox, b.hix), ey = Math.max(-b.loy, b.hiy), ez = Math.max(-b.loz, b.hiz);
  b.rad = Math.sqrt(ex * ex + ey * ey + ez * ez); b.topMat = top;
  // collision samples: extreme voxels (outer corner) + a stride through the rest
  let ns = 0; const S = b.smp;
  for (let d = 0; d < 14; d++) {
    const v = bestI[d]; if (v < 0) continue;
    S[ns * 3] = (L[v * 3] + 0.5 + 0.48 * DIRS[d * 3]) * VS - cx; S[ns * 3 + 1] = (L[v * 3 + 1] + 0.5 + 0.48 * DIRS[d * 3 + 1]) * VS - cy; S[ns * 3 + 2] = (L[v * 3 + 2] + 0.5 + 0.48 * DIRS[d * 3 + 2]) * VS - cz; ns++;
  }
  const extra = Math.min(NSMAX - 14, n >> 3);
  if (extra > 0) {
    const stride = Math.max(1, Math.floor(n / extra));
    for (let v = stride >> 1; v < n && ns < NSMAX; v += stride) {
      if (!SOLID[Mt[v]]) continue;
      S[ns * 3] = (L[v * 3] + 0.5) * VS - cx; S[ns * 3 + 1] = (L[v * 3 + 1] + 0.5) * VS - cy; S[ns * 3 + 2] = (L[v * 3 + 2] + 0.5) * VS - cz; ns++;
    }
  }
  b.ns = ns;
  if (parent) {
    setRot(parent);
    const dx = cx - parent.cx, dy = cy - parent.cy, dz = cz - parent.cz;
    const rx = r00 * dx + r01 * dy + r02 * dz, ry = r10 * dx + r11 * dy + r12 * dz, rz = r20 * dx + r21 * dy + r22 * dz;
    b.px = parent.px + rx; b.py = parent.py + ry; b.pz = parent.pz + rz;
    b.qx = parent.qx; b.qy = parent.qy; b.qz = parent.qz; b.qw = parent.qw;
    b.wx = parent.wx; b.wy = parent.wy; b.wz = parent.wz;
    b.vx = parent.vx + parent.wy * rz - parent.wz * ry; b.vy = parent.vy + parent.wz * rx - parent.wx * rz; b.vz = parent.vz + parent.wx * ry - parent.wy * rx;
    b.gen = parent.gen + 1; b.owner = parent.owner; b.gx = parent.gx; b.gz = parent.gz; b.grp = parent.grp;
  } else {
    b.px = cx; b.py = cy; b.pz = cz; b.qx = b.qy = b.qz = 0; b.qw = 1; b.vx = b.vy = b.vz = b.wx = b.wy = b.wz = 0;
    b.gen = 0; b.owner = ctx.owner; b.gx = cx; b.gz = cz; b.grp = 0;
  }
  b.age = 0; b.restT = 0; b.frozen = false; b.thrown = false; b.dead = false; b.pend = 0; b.pvn = 0; b.keep = 0;
  const geo = buildGeo(n, L, Mt, cx, cy, cz);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), b.rad);
  const mesh = new THREE.Mesh(geo, bodyMat);
  mesh.matrixAutoUpdate = false; mesh.castShadow = G.quality.tier === 'high'; mesh.receiveShadow = true;
  b.mesh = mesh;
  return b;
}
function syncMesh(b) {
  const m = b.mesh; m.position.set(b.px, b.py, b.pz); m.quaternion.set(b.qx, b.qy, b.qz, b.qw); m.updateMatrix(); m.matrixWorldNeedsUpdate = true;
}
export function activate(b) { bodies.push(b); G.scene.add(b.mesh); syncMesh(b); }
function freeBody(b) {
  if (b.mesh) { b.mesh.removeFromParent(); b.mesh.geometry.dispose(); b.mesh = null; }
  b.lat = null; b.mat = null; b.owner = null; b.dead = true; pool.push(b);
}
export function discardBody(b) { freeBody(b); }
export function bodyRoom() { return bodyCap - bodies.length; }

// ---- freeze groups (a released collapse waits for the chunk remesh before it moves) ---------------------
const NG = 8;
const groups = [];
for (let n = 0; n < NG; n++) groups.push({ active: false, t: 0, n: 0, chunks: new Int16Array(96) });
let grpSeq = 0;
export function newGroup() {
  grpSeq++; const g = groups[grpSeq % NG];
  if (g.active) thaw(grpSeq - NG);
  g.active = true; g.t = G.time + 0.3; g.n = 0;
  return grpSeq;
}
export function groupChunks(id) { return groups[id % NG]; }
function thaw(id) { for (let n = 0; n < bodies.length; n++) { const b = bodies[n]; if (b.grp === id) b.frozen = false; } groups[((id % NG) + NG) % NG].active = false; }
function updateGroups() {
  const dirty = G.grid.dirty;
  for (let n = 0; n < NG; n++) {
    const g = groups[n]; if (!g.active) continue;
    let waiting = false;
    if (clock.det) waiting = G.time < g.t - 0.15;          // co-op: fixed beat, independent of the renderer
    else if (G.time < g.t) for (let c = 0; c < g.n; c++) if (dirty.has(g.chunks[c])) { waiting = true; break; }
    if (!waiting) { let id = grpSeq; while (id % NG !== n) id--; thaw(id); }
  }
}

// ---- simulation -----------------------------------------------------------------------------------
let hitVn = 0, hitX = 0, hitY = 0, hitZ = 0, contacts = 0;
function stepBody(b, dt) {
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) + Math.sqrt(b.wx * b.wx + b.wy * b.wy + b.wz * b.wz) * b.rad;
  const steps = Math.min(4, Math.max(1, Math.ceil((sp + GRAV * dt) * dt / 0.2))), sdt = dt / steps;
  const S = b.smp, ns = b.ns, e = b.n > 60 ? 0.08 : 0.22, mu = 0.6;
  hitVn = 0; contacts = 0;
  for (let s = 0; s < steps; s++) {
    b.vy -= GRAV * sdt;
    b.px += b.vx * sdt; b.py += b.vy * sdt; b.pz += b.vz * sdt;
    const qx = b.qx, qy = b.qy, qz = b.qz, qw = b.qw, wx = b.wx, wy = b.wy, wz = b.wz, hd = 0.5 * sdt;
    let nx = qx + hd * (wx * qw + wy * qz - wz * qy), ny = qy + hd * (wy * qw + wz * qx - wx * qz), nz = qz + hd * (wz * qw + wx * qy - wy * qx), nw = qw - hd * (wx * qx + wy * qy + wz * qz);
    const il = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
    b.qx = nx * il; b.qy = ny * il; b.qz = nz * il; b.qw = nw * il;
    setRot(b);
    let pushX = 0, pushY = 0, pushZ = 0, cnt = 0;
    for (let q = 0, o = 0; q < ns; q++, o += 3) {
      const lx = S[o], ly = S[o + 1], lz = S[o + 2];
      const rx = r00 * lx + r01 * ly + r02 * lz, ry = r10 * lx + r11 * ly + r12 * lz, rz = r20 * lx + r21 * ly + r22 * lz;
      const wxp = b.px + rx, wyp = b.py + ry, wzp = b.pz + rz;
      const ci = Math.floor(wxp * INV), cj = Math.floor(wyp * INV), ck = Math.floor(wzp * INV);
      if (!cellSolid(ci, cj, ck)) continue;
      // contact normal from the free neighbours of the cell
      let ex = (cellSolid(ci + 1, cj, ck) ? 0 : 1) - (cellSolid(ci - 1, cj, ck) ? 0 : 1);
      let ey = (cellSolid(ci, cj + 1, ck) ? 0 : 1) - (cellSolid(ci, cj - 1, ck) ? 0 : 1);
      let ez = (cellSolid(ci, cj, ck + 1) ? 0 : 1) - (cellSolid(ci, cj, ck - 1) ? 0 : 1);
      if (ex === 0 && ey === 0 && ez === 0) ey = 1;
      let depth = 0.5;
      if (ex > 0) depth = Math.min(depth, (ci + 1) * VS - wxp); else if (ex < 0) depth = Math.min(depth, wxp - ci * VS);
      if (ey > 0) depth = Math.min(depth, (cj + 1) * VS - wyp); else if (ey < 0) depth = Math.min(depth, wyp - cj * VS);
      if (ez > 0) depth = Math.min(depth, (ck + 1) * VS - wzp); else if (ez < 0) depth = Math.min(depth, wzp - ck * VS);
      const nl = 1 / Math.sqrt(ex * ex + ey * ey + ez * ez); ex *= nl; ey *= nl; ez *= nl;
      pushX += ex * depth; pushY += ey * depth; pushZ += ez * depth; cnt++;
      // velocity of the contact point
      let ux = b.vx + b.wy * rz - b.wz * ry, uy = b.vy + b.wz * rx - b.wx * rz, uz = b.vz + b.wx * ry - b.wy * rx;
      const vn = ux * ex + uy * ey + uz * ez;
      if (vn >= 0) continue;
      if (-vn > hitVn) { hitVn = -vn; hitX = wxp; hitY = wyp; hitZ = wzp; }
      // normal impulse
      let cxn = ry * ez - rz * ey, cyn = rz * ex - rx * ez, czn = rx * ey - ry * ex;
      let l0 = (r00 * cxn + r10 * cyn + r20 * czn) * b.iIx, l1 = (r01 * cxn + r11 * cyn + r21 * czn) * b.iIy, l2 = (r02 * cxn + r12 * cyn + r22 * czn) * b.iIz;
      let ax = r00 * l0 + r01 * l1 + r02 * l2, ay = r10 * l0 + r11 * l1 + r12 * l2, az = r20 * l0 + r21 * l1 + r22 * l2;
      const kn = b.inv + (ay * rz - az * ry) * ex + (az * rx - ax * rz) * ey + (ax * ry - ay * rx) * ez;
      const jn = -(1 + e) * vn / kn;
      b.vx += jn * b.inv * ex; b.vy += jn * b.inv * ey; b.vz += jn * b.inv * ez;
      b.wx += jn * ax; b.wy += jn * ay; b.wz += jn * az;
      // friction
      ux = b.vx + b.wy * rz - b.wz * ry; uy = b.vy + b.wz * rx - b.wx * rz; uz = b.vz + b.wx * ry - b.wy * rx;
      const un = ux * ex + uy * ey + uz * ez; ux -= un * ex; uy -= un * ey; uz -= un * ez;
      const tl = Math.sqrt(ux * ux + uy * uy + uz * uz);
      if (tl > 1e-3) {
        ux /= tl; uy /= tl; uz /= tl;
        cxn = ry * uz - rz * uy; cyn = rz * ux - rx * uz; czn = rx * uy - ry * ux;
        l0 = (r00 * cxn + r10 * cyn + r20 * czn) * b.iIx; l1 = (r01 * cxn + r11 * cyn + r21 * czn) * b.iIy; l2 = (r02 * cxn + r12 * cyn + r22 * czn) * b.iIz;
        ax = r00 * l0 + r01 * l1 + r02 * l2; ay = r10 * l0 + r11 * l1 + r12 * l2; az = r20 * l0 + r21 * l1 + r22 * l2;
        const kt = b.inv + (ay * rz - az * ry) * ux + (az * rx - ax * rz) * uy + (ax * ry - ay * rx) * uz;
        const jt = Math.min(mu * jn, tl / kt);
        b.vx -= jt * b.inv * ux; b.vy -= jt * b.inv * uy; b.vz -= jt * b.inv * uz;
        b.wx -= jt * ax; b.wy -= jt * ay; b.wz -= jt * az;
      }
    }
    if (cnt) {
      let ax = pushX / cnt * 0.7, ay = pushY / cnt * 0.7, az = pushZ / cnt * 0.7;
      const l = Math.sqrt(ax * ax + ay * ay + az * az); if (l > 0.25) { const f = 0.25 / l; ax *= f; ay *= f; az *= f; }
      b.px += ax; b.py += ay; b.pz += az;
      const dv = Math.max(0, 1 - 2.5 * sdt), dw = Math.max(0, 1 - 4 * sdt);
      b.vx *= dv; b.vy *= dv; b.vz *= dv; b.wx *= dw; b.wy *= dw; b.wz *= dw;
      contacts += cnt;
    }
  }
  const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
  if (w2 > 144) { const f = 12 / Math.sqrt(w2); b.wx *= f; b.wy *= f; b.wz *= f; }
}

// ---- events (rate-limited) ------------------------------------------------------------
let lastImpactT = -9, impactsThisFrame = 0;
function emitImpact(x, y, z, speed, mass, mat) {
  if (impactsThisFrame >= 3 || (G.time - lastImpactT < 0.05 && mass < 200)) return;
  impactsThisFrame++; lastImpactT = G.time;
  bus.emit('debris:impact', { x, y, z, speed, mass, mat });
}

// ---- deposit / crush / split ---------------------------------------------------------------
const keys = new Int32Array(MAXV), fate = new Uint8Array(MAXV), childKey = new Int32Array(6);
function sortByHeight(b) {      // keys = voxel indices ordered bottom-up in world space
  const L = b.lat, n = b.n;
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    const lx = (L[o] + 0.5) * VS - b.cx, ly = (L[o + 1] + 0.5) * VS - b.cy, lz = (L[o + 2] + 0.5) * VS - b.cz;
    let wy = (b.py + r10 * lx + r11 * ly + r12 * lz) * 8 + 64; wy = wy < 0 ? 0 : wy > 8191 ? 8191 : wy | 0;
    keys[v] = (wy << 14) | v;
  }
  keys.subarray(0, n).sort();
}
// Write the body into the grid where it lies (shape kept; unsupported voxels drop down their column).
function depositIntact(b) {
  setRot(b); sortByHeight(b);
  const L = b.lat, Mt = b.mat, n = b.n;
  for (let s = 0; s < n; s++) {
    const v = keys[s] & 16383, o = v * 3, m = Mt[v];
    if (GLASS[m]) continue;
    const lx = (L[o] + 0.5) * VS - b.cx, ly = (L[o + 1] + 0.5) * VS - b.cy, lz = (L[o + 2] + 0.5) * VS - b.cz;
    settle(Math.floor((b.px + r00 * lx + r01 * ly + r02 * lz) * INV), Math.floor((b.py + r10 * lx + r11 * ly + r12 * lz) * INV), Math.floor((b.pz + r20 * lx + r21 * ly + r22 * lz) * INV), m, 0);
  }
  flush(); b.dead = true;
}
let aoeB = null, aoeSpeed = 0;
function aoeHit(e) {
  const b = aoeB;
  if (e.pos.y > b.py + b.rad || e.pos.y + e.height < b.py - b.rad - 0.5) return;
  hitEntity(b, e, aoeSpeed);
}
function hitEntity(b, e, rel) {
  if (!canHurt(e)) return;
  if (G.time - (e._ktDebrisT || -9) < 0.3) return;
  let dmg = b.thrown ? Math.min(TUNE.thrownDamageCap, TUNE.thrownDamage * Math.sqrt(b.mass) * rel) : Math.min(TUNE.bodyDamageCap, TUNE.bodyDamage * Math.sqrt(b.mass) * rel);
  if (e === b.owner) dmg *= 0.35;
  if (dmg < 1) return;
  e._ktDebrisT = G.time;
  G.ents.damage(e, dmg, { type: 'debris', src: b.owner, x: b.px, y: b.py, z: b.pz, dx: b.vx, dy: b.vy, dz: b.vz });
}
// A heavy piece hits hard: it becomes a heap of rubble where it landed, a spray of cubes, dust, and a few tumbling chunks.
function crush(b, speed, allowChunks) {
  setRot(b);
  reseed(Math.imul(b.n, 0x85EBCA6B) ^ (b.lat[0] + 1021 * b.lat[1] + 1048573 * b.lat[2]));     // what a piece breaks into depends only on the piece
  const L = b.lat, Mt = b.mat, n = b.n;
  if (speed > 6 && hooks.impactCarve) {
    ctx.owner = b.owner;
    hooks.impactCarve(hitX, hitY - 0.2, hitZ, Math.min(1.6, 0.5 + b.rad * 0.12), Math.min(125, 35 + Math.sqrt(b.mass) * speed * 0.35));
  }
  aoeB = b; aoeSpeed = speed; G.ents.forEachInRadius(b.px, b.py, b.pz, b.rad * 0.75, aoeHit);
  // decide the fate of every voxel
  let nChild = 0, dust = 0;
  const big = b.keep > 0.5, sh = big ? 3 : 2, pChunk = b.keep || TUNE.heapChunks;
  const room = allowChunks ? Math.min(big ? 6 : 5, bodyRoom() - 4) : 0, bitsOk = bitRoom() > 300 ? 1 : 0.35;
  const pBit = TUNE.heapBits * bitsOk, pDust = pBit + TUNE.heapDust;
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    const m = Mt[v];
    if (GLASS[m]) { fate[v] = 2; continue; }
    const key = (L[o] >> sh) + 97 * (L[o + 1] >> 3) + 9409 * (L[o + 2] >> sh);
    let f = 0;
    if (room > 0 && hsh(key, b.n, 7) < pChunk) {
      let c = 0; while (c < nChild && childKey[c] !== key) c++;
      if (c === nChild && nChild < room) childKey[nChild++] = key;
      if (c < nChild) f = 3 + c;
    }
    if (!f) { const r = rnd(); f = r < pBit ? 1 : r < pDust ? 2 : 0; }
    fate[v] = f;
  }
  sortByHeight(b);
  const gx = b.gx, gz = b.gz;
  for (let s = 0; s < n; s++) {
    const v = keys[s] & 16383, f = fate[v]; if (f > 2) continue;
    if (f === 2) { dust++; continue; }
    const o = v * 3, m = Mt[v];
    const lx = (L[o] + 0.5) * VS - b.cx, ly = (L[o + 1] + 0.5) * VS - b.cy, lz = (L[o + 2] + 0.5) * VS - b.cz;
    const wx = b.px + r00 * lx + r01 * ly + r02 * lz, wy = b.py + r10 * lx + r11 * ly + r12 * lz, wz = b.pz + r20 * lx + r21 * ly + r22 * lz;
    if (f === 1) {
      let ox = wx - gx, oz = wz - gz; const l = 1 / (Math.sqrt(ox * ox + oz * oz) + 0.5); ox *= l; oz *= l;
      const sp = 2 + rnd() * (4 + speed * 0.35);
      spawnBit(wx, wy + 0.3, wz, ox * sp + (rnd() - 0.5) * 3, 1.5 + rnd() * (3 + speed * 0.25), oz * sp + (rnd() - 0.5) * 3, m, rnd() < 0.6 ? 0.5 : 0.3, rnd() < 0.6 ? 3 : 2, b.owner);
    } else if (!settle(Math.floor(wx * INV), Math.floor(wy * INV), Math.floor(wz * INV), rnd() < TUNE.rubbleMix ? RUBBLE : m, 1)) dust++;
  }
  for (let c = 0; c < nChild; c++) {
    bld.n = 0;
    for (let v = 0, o = 0; v < n; v++, o += 3) if (fate[v] === 3 + c) bldPush(L[o], L[o + 1], L[o + 2], Mt[v]);
    const ch = makeBody(b); if (!ch) continue;
    let ox = ch.px - gx, oz = ch.pz - gz; const l = 1 / (Math.sqrt(ox * ox + oz * oz) + 0.5); ox *= l; oz *= l;
    const sp = 1.5 + rnd() * (3 + speed * 0.3);
    ch.vx = ox * sp + (rnd() - 0.5) * 2; ch.vz = oz * sp + (rnd() - 0.5) * 2; ch.vy = 1 + rnd() * (2.5 + speed * 0.2);
    ch.wx = (rnd() - 0.5) * 5; ch.wy = (rnd() - 0.5) * 3; ch.wz = (rnd() - 0.5) * 5; ch.py += 0.3;
    activate(ch);
  }
  flush();
  G.state.stats.voxelsDestroyed += dust;
  bus.emit('voxels:destroyed', { x: b.px, y: b.py, z: b.pz, count: dust + 1, mat: b.topMat, radius: b.rad });
  emitImpact(hitX, hitY, hitZ, speed, b.mass, b.topMat);
  b.dead = true;
}
// A medium piece breaks in two across its longest axis.
function split(b, speed) {
  const L = b.lat, Mt = b.mat, n = b.n;
  const ex = b.hix - b.lox, ey = b.hiy - b.loy, ez = b.hiz - b.loz;
  const ax = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
  const c = ax === 0 ? b.cx : ax === 1 ? b.cy : b.cz, cut = c + (rnd() - 0.5) * 0.3 * (ax === 0 ? ex : ax === 1 ? ey : ez);
  setRot(b);
  const dx = ax === 0 ? r00 : ax === 1 ? r01 : r02, dy = ax === 0 ? r10 : ax === 1 ? r11 : r12, dz = ax === 0 ? r20 : ax === 1 ? r21 : r22;
  for (let side = 0; side < 2; side++) {
    bld.n = 0;
    for (let v = 0, o = 0; v < n; v++, o += 3) {
      const p = (L[o + ax] + 0.5) * VS, jit = (hsh(L[o], L[o + 1], L[o + 2]) - 0.5) * 0.7;
      if ((p + jit < cut) === (side === 0) && !GLASS[Mt[v]]) bldPush(L[o], L[o + 1], L[o + 2], Mt[v]);
    }
    const ch = makeBody(b); if (!ch) continue;
    const s = (side ? 1 : -1) * (0.6 + rnd() * 1.4);
    ch.vx += dx * s; ch.vy += dy * s + rnd(); ch.vz += dz * s;
    ch.wx += (rnd() - 0.5) * 4; ch.wy += (rnd() - 0.5) * 3; ch.wz += (rnd() - 0.5) * 4;
    activate(ch);
  }
  const nbits = Math.min(6, bitRoom());
  for (let q = 0; q < nbits; q++) spawnBit(hitX + (rnd() - 0.5), hitY + 0.3, hitZ + (rnd() - 0.5), (rnd() - 0.5) * 6, 2 + rnd() * 4, (rnd() - 0.5) * 6, b.topMat, 0.2 + rnd() * 0.2, 0, null);
  emitImpact(hitX, hitY, hitZ, speed, b.mass, b.topMat);
  b.dead = true;
}
// A thrown chunk bursts on whatever it hits.
function shatter(b, speed) {
  setRot(b);
  const L = b.lat, Mt = b.mat, n = b.n, p = Math.min(1, 150 / n) * (bitRoom() > 200 ? 1 : 0.4);
  if (hooks.thrownImpact) hooks.thrownImpact(b, hitX, hitY, hitZ, speed);
  for (let v = 0, o = 0; v < n; v++, o += 3) {
    if (rnd() > p) continue;
    const lx = (L[o] + 0.5) * VS - b.cx, ly = (L[o + 1] + 0.5) * VS - b.cy, lz = (L[o + 2] + 0.5) * VS - b.cz;
    spawnBit(b.px + r00 * lx + r01 * ly + r02 * lz, b.py + r10 * lx + r11 * ly + r12 * lz, b.pz + r20 * lx + r21 * ly + r22 * lz,
      b.vx * 0.4 + (rnd() - 0.5) * 9, b.vy * 0.3 + rnd() * 6, b.vz * 0.4 + (rnd() - 0.5) * 9, Mt[v], GLASS[Mt[v]] ? 0.2 : 0.5, GLASS[Mt[v]] ? 0 : 3, b.owner);
  }
  emitImpact(hitX, hitY, hitZ, speed, b.mass, b.topMat);
  b.dead = true;
}

// Make room for k new bodies by retiring the oldest loose pieces (they are written into the grid at once).
export function ensureRoom(k) {
  let guard = 0;
  while (bodies.length + k > bodyCap && guard++ < 64) {
    let pick = null, score = -1;
    for (let n = 0; n < bodies.length; n++) {
      const b = bodies[n]; if (b.dead || b.frozen || b.thrown) continue;
      const s = b.age + (b.gen > 0 ? 100 : 0) - b.n * 0.002; if (s > score) { score = s; pick = b; }
    }
    if (!pick) break;
    depositIntact(pick); compact();
  }
}
function compact() {
  let w = 0;
  for (let n = 0; n < bodies.length; n++) { const b = bodies[n]; if (b.dead) freeBody(b); else bodies[w++] = b; }
  bodies.length = w;
}

function entityPass(b) {
  const L = G.ents.list;
  for (let q = 0; q < L.length; q++) {
    const e = L[q]; if (!e.alive) continue;
    const p = e.pos, hh = e.height * 0.5, dx = p.x - b.px, dy = p.y + hh - b.py, dz = p.z - b.pz, rr = b.rad + e.radius + hh;
    if (dx * dx + dy * dy + dz * dz > rr * rr) continue;
    // entity spine points in body space vs the body's box grown by the entity radius
    const er = e.radius;
    for (let t = 0; t < 3; t++) {
      const yy = (t === 0 ? Math.min(er, hh) : t === 1 ? hh : e.height - Math.min(er, hh)) + p.y - b.py;
      const lx = r00 * dx + r10 * yy + r20 * dz, ly = r01 * dx + r11 * yy + r21 * dz, lz = r02 * dx + r12 * yy + r22 * dz;
      if (lx < b.lox - er || lx > b.hix + er || ly < b.loy - er || ly > b.hiy + er || lz < b.loz - er || lz > b.hiz + er) continue;
      const ev = e.vel, rx = b.vx - ev.x, ry = b.vy - ev.y, rz = b.vz - ev.z;
      hitEntity(b, e, Math.sqrt(rx * rx + ry * ry + rz * rz));
      if (b.thrown) { hitX = p.x; hitY = p.y + hh; hitZ = p.z; b.pend = 3; }
      break;
    }
  }
}

export function updateBodies(dt, deadline) {
  impactsThisFrame = 0;
  updateGroups();
  const n0 = bodies.length;
  for (let n = n0 - 1; n >= 0; n--) {
    const b = bodies[n];
    if (b.dead || b.frozen) continue;
    b.age += dt;
    if (!b.pend) {
      stepBody(b, dt);
      if (b.py < -6 || b.px < -8 || b.pz < -8 || b.px > NX * VS + 8 || b.pz > NZ * VS + 8) { b.dead = true; continue; }
      const sp2 = b.vx * b.vx + b.vy * b.vy + b.vz * b.vz;
      if (sp2 > 6) { entityPass(b); }
      if (b.pend) { /* thrown chunk hit an entity */ }
      else if (b.thrown) { if (hitVn > 2.5 || (contacts && b.age > 5)) b.pend = 3; }
      else if (b.grp && b.gen === 0 && b.n >= 30) {
        if (hitVn > TUNE.crushSpeedTile) b.pend = 1;
        else if (contacts && sp2 < 2.2) b.pend = 4;
      }
      else if (b.n >= 160 && hitVn > TUNE.crushSpeedBody) b.pend = 1;
      else if (b.n >= 24 && hitVn > TUNE.splitSpeed && b.gen < 4) b.pend = 2;
      else {
        if (hitVn > 3) emitImpact(hitX, hitY, hitZ, hitVn, b.mass, b.topMat);
        const w2 = b.wx * b.wx + b.wy * b.wy + b.wz * b.wz;
        if (contacts && sp2 < 0.9 && w2 < 1.6) b.restT += dt; else b.restT = Math.max(0, b.restT - dt * 0.5);
        if (b.restT > 0.3 || b.age > 9) b.pend = 4;
      }
      if (b.pend) { b.pvn = Math.max(hitVn, Math.sqrt(sp2) * 0.5); b.phx = hitX; b.phy = hitY; b.phz = hitZ; }
    }
    if (b.pend) {
      // heavy work is budgeted: a piece that cannot be processed this frame waits where it is
      if (b.pend !== 4 && b.pend !== 3 && over(deadline, 1)) continue;
      hitX = b.phx; hitY = b.phy; hitZ = b.phz;
      if (hitVn === 0 && !contacts) { hitX = b.px; hitY = b.py; hitZ = b.pz; }
      const kind = b.pend, v = b.pvn;
      if (kind === 1) crush(b, v, true);
      else if (kind === 2) { if (bodyRoom() >= 2) split(b, v); else crush(b, v, false); }
      else if (kind === 3) shatter(b, v);
      else depositIntact(b);
    }
  }
  compact();
  if (bodies.length > bodyCap) ensureRoom(0);
  for (let n = 0; n < bodies.length; n++) { const b = bodies[n]; if (!b.frozen) syncMesh(b); }
  writeBits();
  stats.bodies = bodies.length; stats.debris = nb;
}

// Shove loose debris away from an explosion.
export function blast(x, y, z, r, power) {
  const r2 = r * r;
  for (let n = 0; n < bodies.length; n++) {
    const b = bodies[n]; if (b.frozen) continue;
    const dx = b.px - x, dy = b.py - y, dz = b.pz - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) continue;
    const d = Math.sqrt(d2) + 0.3, f = power * 0.06 * (1 - d / (r + 0.3)) / (1 + b.mass * 0.02) / d;
    b.vx += dx * f; b.vy += dy * f + f * 0.5; b.vz += dz * f; b.wx += (rnd() - 0.5) * f; b.wz += (rnd() - 0.5) * f; b.restT = 0;
  }
  for (let n = 0; n < nb; n++) {
    const dx = X[n] - x, dy = Y[n] - y, dz = Z[n] - z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > r2) continue;
    const d = Math.sqrt(d2) + 0.3, f = power * 0.08 * (1 - d / (r + 0.3)) / d;
    VX[n] += dx * f; VY[n] += dy * f + 2; VZ[n] += dz * f; REST[n] = 0;
  }
}

// ---- lifecycle -----------------------------------------------------------------------------------------
export function initBodies() {
  bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.02 });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  bitMesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0.03 }), MAXB);
  bitMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bitMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAXB * 3), 3);
  bitMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  bitMesh.count = 0; bitMesh.frustumCulled = false; bitMesh.receiveShadow = true;
  G.scene.add(bitMesh);
  setQuality();
}
export function setQuality() {
  const Q = G.quality;
  bitCap = Math.min(MAXB, Q.debrisMax | 0); bodyCap = Math.max(60, Math.round(Q.debrisMax / 14));
  if (nb > bitCap) { for (let n = bitCap; n < nb; n++) OWN[n] = null; nb = bitCap; }
  const sh = Q.tier === 'high';
  if (bitMesh) bitMesh.castShadow = sh;
  for (let n = 0; n < bodies.length; n++) bodies[n].mesh.castShadow = sh;
}
export function resetBodies() {
  for (let n = 0; n < bodies.length; n++) freeBody(bodies[n]);
  bodies.length = 0; nb = 0; cursor = 0; OWN.fill(null);
  for (let n = 0; n < NG; n++) groups[n].active = false;
  if (bitMesh) bitMesh.count = 0;
  stats.bodies = 0; stats.debris = 0;
}
export function bodyCapNow() { return bodyCap; }

// co-op chunk heal: drop debris that now sits inside solid voxels of the chunk at voxel origin (i0,j0,k0)
export function purgeChunk(i0, j0, k0) {
  for (let n = nb - 1; n >= 0; n--) {
    const i = Math.floor(X[n] * INV), j = Math.floor(Y[n] * INV), k = Math.floor(Z[n] * INV);
    if (i >= i0 && i < i0 + 32 && j >= j0 && j < j0 + 32 && k >= k0 && k < k0 + 32 && SOLID[data[i + NX * (k + NZ * j)]]) killBit(n);
  }
  let any = false;
  for (let n = 0; n < bodies.length; n++) {
    const b = bodies[n], i = Math.floor(b.px * INV), j = Math.floor(b.py * INV), k = Math.floor(b.pz * INV);
    if (i >= i0 && i < i0 + 32 && j >= j0 && j < j0 + 32 && k >= k0 && k < k0 + 32 && SOLID[data[i + NX * (k + NZ * j)]]) { b.dead = true; any = true; }
  }
  if (any) compact();
}
