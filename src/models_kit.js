// ============================================================================
// KILOTON — models_kit.js   OWNER: MODELS.
// Procedural hard-surface kit: a Builder that emits flat-shaded bevelled boxes,
// tapered blocks, prisms and struts into per-bone merged geometries (one mesh
// per rigid segment), plus the shared materials, wear texture and env map.
// ============================================================================
import { THREE } from './core.js';

const V = () => new THREE.Vector3();
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
const _n = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _col = new THREE.Color();

/** sRGB hex -> linear [r,g,b] */
export function lin(hex, k = 1) { _col.setHex(hex); return [_col.r * k, _col.g * k, _col.b * k]; }
export const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

class Buf { constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.mr = []; } }

export class Builder {
  constructor(o = {}) {
    this.bones = []; this.byName = {}; this.cur = null; this.ch = 'a';
    this.M = new THREE.Matrix4(); this.stack = [];
    this.uvScale = o.uvScale || 0.22;
    this.rand = rng(o.seed || 7);
    this.rough = 0.55; this.metal = 0.45; this.edge = 0.4; this.jit = 0.05;
    this.sockets = [];
    this.tris = 0; this.bevelK = o.bevelK || 1; this._pm = 0;
  }
  /** define a bone (rest position relative to its parent bone) and make it current */
  bone(name, parent, x = 0, y = 0, z = 0) {
    const b = { name, parent: parent || null, pos: [x, y, z], bufs: {} };
    this.bones.push(b); this.byName[name] = b; return this.to(name);
  }
  to(name) { this.cur = this.byName[name]; if (!this.cur) throw new Error('no bone ' + name); this.M.identity(); this.stack.length = 0; this.ch = 'a'; return this; }
  chan(c) { this.ch = c; return this; }
  mat(rough, metal, edge) { this.rough = rough; this.metal = metal; if (edge != null) this.edge = edge; return this; }
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this.stack.push(this.M.clone());
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)); this.M.multiply(_m); _s.set(1, 1, 1);
    return this;
  }
  pop() { this.M.copy(this.stack.pop()); return this; }
  socket(name, x, y, z, rx = 0, ry = 0, rz = 0) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(this.M);
    this.sockets.push({ name, bone: this.cur.name, pos: [p.x, p.y, p.z], rot: [rx, ry, rz] }); return this;
  }
  _buf() { const b = this.cur.bufs; return b[this.ch] || (b[this.ch] = new Buf()); }
  /** convex polygon (points already in bone space), oriented away from `inside` */
  poly(pts, col, inside, rough, metal) {
    const n = pts.length; if (n < 3) return;
    _n.set(0, 0, 0);
    for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; _n.x += (p.y - q.y) * (p.z + q.z); _n.y += (p.z - q.z) * (p.x + q.x); _n.z += (p.x - q.x) * (p.y + q.y); }
    const len = _n.length(); if (len < 1e-7) return;
    _n.multiplyScalar(1 / len);
    _c.set(0, 0, 0); for (let i = 0; i < n; i++) _c.add(pts[i]); _c.multiplyScalar(1 / n);
    let flip = false;
    if (inside && _a.subVectors(_c, inside).dot(_n) < 0) { flip = true; _n.negate(); }
    const B = this._buf(), lit = this.ch === 'a';
    const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z), us = this.uvScale;
    const ao = lit ? (_n.y < -0.5 ? 0.74 : _n.y < 0.2 ? 0.93 : 1) : 1;
    const r = col[0] * ao, g = col[1] * ao, b = col[2] * ao;
    for (let i = 1; i < n - 1; i++) {
      const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
      for (const p of tri) {
        B.pos.push(p.x, p.y, p.z); B.nor.push(_n.x, _n.y, _n.z); B.col.push(r, g, b);
        if (lit) {
          if (ax >= ay && ax >= az) B.uv.push(p.z * us, p.y * us); else if (ay >= az) B.uv.push(p.x * us, p.z * us); else B.uv.push(p.x * us, p.y * us);
          B.mr.push(rough, metal, this._pm);
        }
      }
      this.tris++;
    }
  }
  /**
   * Bevelled / tapered box centred at (x,y,z), size (sx,sy,sz).
   * o: b (bevel m), tx,tz (top scale), bx,bz (bottom scale), ox,oz (top shear offset), oy (shear y along z: front lifts),
   *    r:[rx,ry,rz] (euler), edge (0..1 worn-edge highlight), jit (value jitter), rough, metal
   */
  box(x, y, z, sx, sy, sz, col, o) {
    o = o || {}; this._pm = o.pm != null ? o.pm : (col.pm || 0);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    let b = o.b == null ? 0 : o.b * this.bevelK; b = Math.min(b, hx * 0.49, hy * 0.49, hz * 0.49);
    const tx = o.tx == null ? 1 : o.tx, tz = o.tz == null ? 1 : o.tz, bx = o.bx == null ? 1 : o.bx, bz = o.bz == null ? 1 : o.bz;
    const ox = o.ox || 0, oz = o.oz || 0, oy = o.oy || 0;
    const lit = this.ch === 'a';
    const jit = lit ? 1 + (this.rand() - 0.5) * 2 * (o.jit == null ? this.jit : o.jit) : 1;
    const c = [col[0] * jit, col[1] * jit, col[2] * jit];
    const rough = o.rough == null ? this.rough : o.rough, metal = o.metal == null ? this.metal : o.metal;
    const edge = o.edge == null ? this.edge : o.edge;
    // worn edges: lighter, shinier, more metallic
    const lum = (c[0] + c[1] + c[2]) / 3;
    const ec = [c[0] + (lum * 1.9 + 0.04 - c[0]) * edge, c[1] + (lum * 1.9 + 0.04 - c[1]) * edge, c[2] + (lum * 1.9 + 0.045 - c[2]) * edge];
    this.stack.push(this.M.clone());
    const r = o.r || [0, 0, 0];
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(1, 1, 1)); this.M.multiply(_m);
    const M = this.M;
    const P = (px, py, pz) => {
      const t = hy > 0 ? (py / hy + 1) / 2 : 0.5;
      const v = new THREE.Vector3(px * (bx + (tx - bx) * t) + ox * t, py + oy * (hz > 0 ? pz / hz : 0), pz * (bz + (tz - bz) * t) + oz * t);
      return v.applyMatrix4(M);
    };
    const inside = P(0, 0, 0);
    if (b <= 0) {
      const v = []; for (let i = 0; i < 8; i++) v.push(P(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz));
      const Q = (a, b2, c2, d) => this.poly([v[a], v[b2], v[c2], v[d]], c, inside, rough, metal);
      Q(0, 1, 3, 2); Q(4, 5, 7, 6); Q(0, 1, 5, 4); Q(2, 3, 7, 6); Q(0, 2, 6, 4); Q(1, 3, 7, 5);
    } else {
      const S = [-1, 1];
      const vx = {}, vy = {}, vz = {};
      for (const a of S) for (const b2 of S) for (const c2 of S) {
        const k = a + ',' + b2 + ',' + c2;
        vx[k] = P(a * hx, b2 * (hy - b), c2 * (hz - b));
        vy[k] = P(a * (hx - b), b2 * hy, c2 * (hz - b));
        vz[k] = P(a * (hx - b), b2 * (hy - b), c2 * hz);
      }
      const K = (a, b2, c2) => a + ',' + b2 + ',' + c2;
      const er = rough * 0.6, em = Math.min(1, metal + 0.35);
      for (const s of S) {
        this.poly([vx[K(s, -1, -1)], vx[K(s, 1, -1)], vx[K(s, 1, 1)], vx[K(s, -1, 1)]], c, inside, rough, metal);
        this.poly([vy[K(-1, s, -1)], vy[K(1, s, -1)], vy[K(1, s, 1)], vy[K(-1, s, 1)]], c, inside, rough, metal);
        this.poly([vz[K(-1, -1, s)], vz[K(1, -1, s)], vz[K(1, 1, s)], vz[K(-1, 1, s)]], c, inside, rough, metal);
      }
      for (const a of S) for (const b2 of S) {
        this.poly([vx[K(a, b2, -1)], vx[K(a, b2, 1)], vy[K(a, b2, 1)], vy[K(a, b2, -1)]], ec, inside, er, em);   // X-Y edges
        this.poly([vx[K(a, -1, b2)], vx[K(a, 1, b2)], vz[K(a, 1, b2)], vz[K(a, -1, b2)]], ec, inside, er, em);   // X-Z edges
        this.poly([vy[K(-1, a, b2)], vy[K(1, a, b2)], vz[K(1, a, b2)], vz[K(-1, a, b2)]], ec, inside, er, em);   // Y-Z edges
      }
      for (const a of S) for (const b2 of S) for (const c2 of S) this.poly([vx[K(a, b2, c2)], vy[K(a, b2, c2)], vz[K(a, b2, c2)]], ec, inside, er, em);
    }
    this.M.copy(this.stack.pop());
    return this;
  }
  /** n-gon prism centred at (x,y,z) along `axis`; o: n, r2 (far radius), r:[euler], ph (phase), cap (default true), sx (x squash) */
  cyl(x, y, z, rad, len, col, o) {
    o = o || {}; this._pm = o.pm != null ? o.pm : (col.pm || 0);
    const n = o.n || 8, r2 = o.r2 == null ? rad : o.r2, ph = o.ph == null ? Math.PI / n : o.ph, axis = o.axis || 'y';
    const lit = this.ch === 'a';
    const jit = lit ? 1 + (this.rand() - 0.5) * 2 * (o.jit == null ? this.jit : o.jit) : 1;
    const c = [col[0] * jit, col[1] * jit, col[2] * jit];
    const rough = o.rough == null ? this.rough : o.rough, metal = o.metal == null ? this.metal : o.metal;
    this.stack.push(this.M.clone());
    const r = o.r || [0, 0, 0];
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(1, 1, 1)); this.M.multiply(_m);
    if (axis === 'z') { _m.makeRotationX(Math.PI / 2); this.M.multiply(_m); }
    else if (axis === 'x') { _m.makeRotationZ(-Math.PI / 2); this.M.multiply(_m); }
    const M = this.M, h = len / 2, sq = o.sx || 1;
    const bot = [], top = [];
    for (let i = 0; i < n; i++) {
      const a = ph + i / n * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
      bot.push(new THREE.Vector3(cs * rad * sq, -h, sn * rad).applyMatrix4(M));
      top.push(new THREE.Vector3(cs * r2 * sq, h, sn * r2).applyMatrix4(M));
    }
    const inside = new THREE.Vector3(0, 0, 0).applyMatrix4(M);
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; this.poly([bot[i], bot[j], top[j], top[i]], c, inside, rough, metal); }
    if (o.cap !== false) { if (rad > 1e-4) this.poly(bot, c, inside, rough, metal); if (r2 > 1e-4) this.poly(top, c, inside, rough, metal); }
    this.M.copy(this.stack.pop());
    return this;
  }
  /** strut / piston / cable between two points */
  tube(x0, y0, z0, x1, y1, z1, rad, col, o) {
    o = o || {};
    _a.set(x1 - x0, y1 - y0, z1 - z0); const len = _a.length(); if (len < 1e-5) return this;
    _a.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_b.set(0, 1, 0), _a);
    this.stack.push(this.M.clone());
    _m.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s.set(1, 1, 1)); this.M.multiply(_m);
    this.cyl(0, 0, 0, rad, len, col, Object.assign({ n: 6 }, o, { axis: 'y', r: null }));
    this.M.copy(this.stack.pop());
    return this;
  }
  /** two-stage piston: fat sleeve + thin chrome rod */
  piston(x0, y0, z0, x1, y1, z1, rad, colSleeve, colRod) {
    const mx = x0 + (x1 - x0) * 0.55, my = y0 + (y1 - y0) * 0.55, mz = z0 + (z1 - z0) * 0.55;
    this.tube(x0, y0, z0, mx, my, mz, rad, colSleeve, { rough: 0.5, metal: 0.7 });
    this.tube(mx, my, mz, x1, y1, z1, rad * 0.55, colRod, { rough: 0.18, metal: 1 });
    return this;
  }
  /** emit a triangle with explicit (smooth) normals. p*, n* are Vector3 in bone space. */
  _sv(p, n, r, g, b, rough, metal) {
    const B = this._buf(), us = this.uvScale;
    B.pos.push(p.x, p.y, p.z); B.nor.push(n.x, n.y, n.z);
    if (this.ch === 'a') {
      const ao = 0.8 + 0.2 * (n.y * 0.5 + 0.5);
      B.col.push(r * ao, g * ao, b * ao);
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      if (ax >= ay && ax >= az) B.uv.push(p.z * us, p.y * us); else if (ay >= az) B.uv.push(p.x * us, p.z * us); else B.uv.push(p.x * us, p.y * us);
      B.mr.push(rough, metal, this._pm);
    } else B.col.push(r, g, b);
  }
  /**
   * Smooth-shaded quad grid. rings[i][j] are Vector3 in bone space; `wrap` closes each ring; centers[i] is a point
   * inside ring i (used to orient the surface outward).
   */
  grid(rings, centers, col, wrap, rough, metal) {
    const R = rings.length, n = rings[0].length, N = [];
    for (let i = 0; i < R; i++) { N.push([]); for (let j = 0; j < n; j++) N[i].push(new THREE.Vector3()); }
    const segs = wrap ? n : n - 1, quads = [];
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3(), mid = new THREE.Vector3();
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < segs; j++) {
      const j2 = (j + 1) % n, a = rings[i][j], b = rings[i][j2], c = rings[i + 1][j2], d = rings[i + 1][j];
      e1.subVectors(c, a); e2.subVectors(d, b); fn.crossVectors(e1, e2);
      if (fn.lengthSq() < 1e-14) { quads.push(null); continue; }
      mid.copy(a).add(b).add(c).add(d).multiplyScalar(0.25).sub(e1.copy(centers[i]).add(centers[i + 1]).multiplyScalar(0.5));
      const flip = fn.dot(mid) < 0; if (flip) fn.negate();
      N[i][j].add(fn); N[i][j2].add(fn); N[i + 1][j2].add(fn); N[i + 1][j].add(fn);
      quads.push(flip);
    }
    for (let i = 0; i < R; i++) for (let j = 0; j < n; j++) { if (N[i][j].lengthSq() < 1e-14) N[i][j].subVectors(rings[i][j], centers[i]); N[i][j].normalize(); }
    let q = 0;
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < segs; j++) {
      const flip = quads[q++]; if (flip === null) continue;
      const j2 = (j + 1) % n;
      const A = [rings[i][j], N[i][j]], Bq = [rings[i][j2], N[i][j2]], C = [rings[i + 1][j2], N[i + 1][j2]], D = [rings[i + 1][j], N[i + 1][j]];
      const tris = flip ? [A, C, Bq, A, D, C] : [A, Bq, C, A, C, D];
      for (const v of tris) this._sv(v[0], v[1], col[0], col[1], col[2], rough, metal);
      this.tris += 2;
    }
  }
  /**
   * Smooth lathe / loft along local Y. prof = [[y, rx, rz?, ox?, oz?], ...].
   * o: n (segments), sq (superellipse exponent: 2 round .. 5 boxy), r:[euler], cap ('both'|'top'|'bottom'|false), jit, rough, metal
   */
  lathe(x, y, z, prof, col, o) {
    o = o || {}; this._pm = o.pm != null ? o.pm : (col.pm || 0);
    const n = o.n || 8, sq = o.sq || 2, ex = 2 / sq, lit = this.ch === 'a';
    const jit = lit ? 1 + (this.rand() - 0.5) * 2 * (o.jit == null ? this.jit : o.jit) : 1;
    const c = [col[0] * jit, col[1] * jit, col[2] * jit];
    const rough = o.rough == null ? this.rough : o.rough, metal = o.metal == null ? this.metal : o.metal;
    this.stack.push(this.M.clone());
    const r = o.r || [0, 0, 0];
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(1, 1, 1)); this.M.multiply(_m);
    const M = this.M, rings = [], centers = [];
    for (const p of prof) {
      const rx = p[1], rz = p[2] == null ? p[1] : p[2], ox = p[3] || 0, oz = p[4] || 0, ring = [];
      for (let j = 0; j < n; j++) {
        const a = (j + 0.5) / n * Math.PI * 2, cs = Math.cos(a), sn = Math.sin(a);
        ring.push(new THREE.Vector3(Math.sign(cs) * Math.pow(Math.abs(cs), ex) * rx + ox, p[0], Math.sign(sn) * Math.pow(Math.abs(sn), ex) * rz + oz).applyMatrix4(M));
      }
      rings.push(ring); centers.push(new THREE.Vector3(ox, p[0], oz).applyMatrix4(M));
    }
    this.grid(rings, centers, c, true, rough, metal);
    const cap = o.cap == null ? 'both' : o.cap, inside = centers[0].clone().add(centers[centers.length - 1]).multiplyScalar(0.5);
    if ((cap === 'both' || cap === 'bottom') && prof[0][1] > 1e-3) this.poly(rings[0], c, inside, rough, metal);
    if ((cap === 'both' || cap === 'top') && prof[prof.length - 1][1] > 1e-3) this.poly(rings[rings.length - 1], c, inside, rough, metal);
    this.M.copy(this.stack.pop());
    return this;
  }
  /** rounded limb (capsule-ish, smooth) between two points with radii r0 -> r1. o: n, sz (depth squash), sq, plus lathe opts */
  limb(x0, y0, z0, x1, y1, z1, r0, r1, col, o) {
    o = o || {};
    _a.set(x1 - x0, y1 - y0, z1 - z0); const len = _a.length(); if (len < 1e-5) return this;
    _a.multiplyScalar(1 / len);
    _q.setFromUnitVectors(_b.set(0, 1, 0), _a);
    this.stack.push(this.M.clone());
    _m.compose(_p.set(x0, y0, z0), _q, _s.set(1, 1, 1)); this.M.multiply(_m);
    if (o.twist) { _m.makeRotationY(o.twist); this.M.multiply(_m); }
    const sz = o.sz || 1, e = o.end == null ? 0.7 : o.end;
    const prof = o.flat ? [[0, r0, r0 * sz], [len, r1, r1 * sz]] : [[-r0 * e, r0 * 0.6, r0 * 0.6 * sz], [0, r0, r0 * sz], [len, r1, r1 * sz], [len + r1 * e, r1 * 0.6, r1 * 0.6 * sz]];
    if (o.mid && !o.flat) prof.splice(2, 0, [len * o.mid[0], o.mid[1], o.mid[1] * sz]);
    this.lathe(0, 0, 0, prof, col, Object.assign({}, o, { r: null }));
    this.M.copy(this.stack.pop());
    return this;
  }
  /**
   * Curved plate: a section of an elliptical shell around local Y. Angles from +Z toward +X (radians).
   * o: n, thick, tr (top radius scale), r:[euler], edge, rough, metal, jit
   */
  arc(x, y, z, rx, rz, y0, y1, a0, a1, col, o) {
    o = o || {}; this._pm = o.pm != null ? o.pm : (col.pm || 0);
    const n = o.n || 6, thick = o.thick == null ? 0.03 : o.thick, tr = o.tr == null ? 1 : o.tr, lit = this.ch === 'a';
    const jit = lit ? 1 + (this.rand() - 0.5) * 2 * (o.jit == null ? this.jit : o.jit) : 1;
    const c = [col[0] * jit, col[1] * jit, col[2] * jit];
    const rough = o.rough == null ? this.rough : o.rough, metal = o.metal == null ? this.metal : o.metal;
    const edge = o.edge == null ? this.edge : o.edge, lum = (c[0] + c[1] + c[2]) / 3;
    const ec = [c[0] + (lum * 1.9 + 0.04 - c[0]) * edge, c[1] + (lum * 1.9 + 0.04 - c[1]) * edge, c[2] + (lum * 1.9 + 0.045 - c[2]) * edge];
    this.stack.push(this.M.clone());
    const r = o.r || [0, 0, 0];
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(r[0], r[1], r[2])), _s.set(1, 1, 1)); this.M.multiply(_m);
    const M = this.M, rows = [[], []], inner = [[], []], cen = [new THREE.Vector3(0, y0, 0).applyMatrix4(M), new THREE.Vector3(0, y1, 0).applyMatrix4(M)];
    for (let k = 0; k < 2; k++) for (let j = 0; j <= n; j++) {
      const a = a0 + (a1 - a0) * j / n, sc = k ? tr : 1, yy = k ? y1 : y0;
      rows[k].push(new THREE.Vector3(Math.sin(a) * rx * sc, yy, Math.cos(a) * rz * sc).applyMatrix4(M));
      inner[k].push(new THREE.Vector3(Math.sin(a) * (rx * sc - thick), yy, Math.cos(a) * (rz * sc - thick)).applyMatrix4(M));
    }
    this.grid(rows, cen, c, false, rough, metal);
    if (thick > 0 && lit) {
      const er = rough * 0.6, em = Math.min(1, metal + 0.35), ins = new THREE.Vector3();
      for (let j = 0; j < n; j++) {
        ins.set(0, 0, 0); for (const k of [0, 1]) for (const jj of [j, j + 1]) ins.add(rows[k][jj]).add(inner[k][jj]); ins.multiplyScalar(1 / 8);
        this.poly([rows[1][j], rows[1][j + 1], inner[1][j + 1], inner[1][j]], ec, ins, er, em);
        this.poly([rows[0][j], rows[0][j + 1], inner[0][j + 1], inner[0][j]], ec, ins, er, em);
        if (o.inner) this.poly([inner[0][j], inner[0][j + 1], inner[1][j + 1], inner[1][j]], c, ins, rough, metal);
        if (j === 0) this.poly([rows[0][0], rows[1][0], inner[1][0], inner[0][0]], ec, ins, er, em);
        if (j === n - 1) this.poly([rows[0][n], rows[1][n], inner[1][n], inner[0][n]], ec, ins, er, em);
      }
    }
    this.M.copy(this.stack.pop());
    return this;
  }
  /** finish: build BufferGeometries. Returns a blueprint shared by all instances. */
  finish() {
    const bones = [];
    for (const b of this.bones) {
      const geo = {};
      for (const ch in b.bufs) {
        const B = b.bufs[ch]; if (!B.pos.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
        if (ch === 'a') { g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2)); g.setAttribute('mr', new THREE.Float32BufferAttribute(B.mr, 3)); }
        g.computeBoundingSphere(); g.computeBoundingBox();
        geo[ch] = g;
      }
      bones.push({ name: b.name, parent: b.parent, pos: b.pos, geo });
    }
    return { bones, sockets: this.sockets, tris: this.tris };
  }
}

// ---------------------------------------------------------------------------
// Shared materials
// ---------------------------------------------------------------------------
let _mats = null;

function wearTexture() {
  const S = 512, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), R = rng(4242);
  g.fillStyle = '#e4e4e4'; g.fillRect(0, 0, S, S);
  const wrap = (fn) => { for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) { g.save(); g.translate(dx, dy); fn(); g.restore(); } };
  // broad grime clouds
  for (let i = 0; i < 46; i++) {
    const x = R() * S, y = R() * S, r = 30 + R() * 90, dark = R() < 0.6;
    wrap(() => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, dark ? 'rgba(60,56,50,0.20)' : 'rgba(255,255,255,0.20)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); });
  }
  // vertical rain / oil streaks (v = up on side faces)
  for (let i = 0; i < 70; i++) {
    const x = R() * S, y = R() * S, h = 20 + R() * 110, w = 1 + R() * 3;
    wrap(() => { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, 'rgba(40,34,28,0.26)'); gr.addColorStop(1, 'rgba(40,34,28,0)'); g.fillStyle = gr; g.fillRect(x, y, w, h); });
  }
  // fine scratches
  for (let i = 0; i < 260; i++) {
    const x = R() * S, y = R() * S, a = R() * Math.PI, l = 4 + R() * 26, light = R() < 0.7;
    wrap(() => { g.strokeStyle = light ? `rgba(255,255,255,${0.18 + R() * 0.3})` : `rgba(30,28,26,${0.15 + R() * 0.25})`; g.lineWidth = 0.6 + R() * 0.9; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); });
  }
  // chips
  for (let i = 0; i < 420; i++) {
    const x = R() * S, y = R() * S, r = 0.6 + R() * 2.2;
    g.fillStyle = R() < 0.5 ? `rgba(255,255,255,${0.25 + R() * 0.3})` : `rgba(25,22,20,${0.2 + R() * 0.3})`; g.fillRect(x, y, r, r);
  }
  // per-pixel grain
  const id = g.getImageData(0, 0, S, S), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (R() - 0.5) * 16; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true;
  return t;
}

/** small golden-hour environment so metal has something to reflect whatever RENDER does */
function buildEnv(renderer, sunDir) {
  try {
    const sc = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const sd = sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0.5, 0.35, 0.4).normalize();
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(pos, i).normalize();
      const up = d.y, hor = Math.exp(-Math.abs(up) * 4.5);
      let r, g, b;
      if (up >= 0) { r = 0.30 + 0.9 * hor; g = 0.42 + 0.62 * hor; b = 0.72 + 0.25 * hor; }
      else { const t = Math.min(1, -up * 3); r = (1.2) * (1 - t) + 0.10 * t; g = 1.04 * (1 - t) + 0.085 * t; b = 0.97 * (1 - t) + 0.075 * t; }
      const s = Math.max(0, d.dot(sd)), glow = Math.pow(s, 6) * 2.2 + Math.pow(s, 60) * 14;
      r += glow * 1.0; g += glow * 0.72; b += glow * 0.42;
      col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, toneMapped: false }));
    sc.add(m);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(sc, 0.03);
    pm.dispose(); geo.dispose(); m.material.dispose();
    return rt.texture;
  } catch (e) { console.warn('models: env map unavailable', e); return null; }
}

const WHITE_C = new THREE.Color(1, 1, 1);
function armorMat(tex, env, tint, roughK, paint, accent) {
  const uP = { value: paint || WHITE_C }, uA = { value: accent || WHITE_C };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: roughK, metalness: 1, envMap: env, envMapIntensity: 0.85, color: new THREE.Color(tint, tint, tint) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uKtPaint = uP; sh.uniforms.uKtAccent = uA;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 mr;\nvarying vec3 vKtMR;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKtMR = mr;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vKtMR;\nuniform vec3 uKtPaint;\nuniform vec3 uKtAccent;')
      .replace('#include <color_fragment>', '#include <color_fragment>\nvec3 ktP = uKtPaint; ktP *= mix(1.0, 0.6, smoothstep(0.2, 0.65, max(ktP.r, max(ktP.g, ktP.b))));\ndiffuseColor.rgb = min(diffuseColor.rgb * (vKtMR.z > 1.5 ? uKtAccent * 0.45 : mix(vec3(1.0), ktP, vKtMR.z)), vec3(0.9));')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * vKtMR.x, 0.05, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor * vKtMR.y, 0.0, 1.0);');
  };
  m.customProgramCacheKey = () => 'kt-armor-v3';
  return m;
}

function flareMat(r, g, b, k) { return new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(r * k, g * k, b * k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }); }
/** Shared materials. armor[0..2] = clean / worn / burnt (same program, swapped per mesh by setDamage). */
export function getMats(G) {
  if (_mats) return _mats;
  const tex = wearTexture();
  // RENDER's sky environment wins when it exists (scene.environment); otherwise bring our own golden-hour probe
  const env = G && G.scene && G.scene.environment ? null : (G && G.renderer ? buildEnv(G.renderer, G.render && G.render.sunDir) : null);
  _mats = {
    tex, env,
    armor: [armorMat(tex, env, 1, 1), armorMat(tex, env, 0.6, 1.25), armorMat(tex, env, 0.3, 1.6)],
    flare: flareMat(0.45, 0.9, 1.0, 2.4), flareHot: flareMat(1.0, 0.55, 0.22, 2.4),
    glowProto: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
  return _mats;
}
/** colour that takes the rig's paint: k = value relative to the paint colour (pm 1), or the accent (pm 2) */
export const paintCol = (k) => Object.assign([k, k, k], { pm: 1 });
export const accentCol = (k = 1) => Object.assign([k, k, k], { pm: 2 });
const _paintSets = new Map();
/** armour material set [clean, worn, burnt] for a paint; cached per colour pair so same-paint rigs share materials */
export function paintMats(armorHex, accentHex) {
  const key = armorHex + '_' + accentHex; let set = _paintSets.get(key);
  if (!set) { const p = new THREE.Color(armorHex), a = new THREE.Color(accentHex); _paintSets.set(key, set = [armorMat(_mats.tex, _mats.env, 1, 1, p, a), armorMat(_mats.tex, _mats.env, 0.6, 1.25, p, a), armorMat(_mats.tex, _mats.env, 0.3, 1.6, p, a)]); }
  return set;
}
/** per-instance emissive material (colour is the live intensity multiplier). Shares one shader program. */
export function glowMat() { return _mats.glowProto.clone(); }

// flare cone geometry (shared): base at origin, pointing -Y, unit length, colour fades to black at the tip
let _flareGeo = null;
export function flareGeo() {
  if (_flareGeo) return _flareGeo;
  const n = 8, pos = [], col = [];
  const ring = (r, y) => { const a = []; for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2; a.push([Math.cos(t) * r, y, Math.sin(t) * r]); } return a; };
  const lay = [[1, 0, 1], [1.12, -0.18, 0.75], [0.8, -0.5, 0.3], [0.0, -1, 0]];
  for (let l = 0; l < lay.length - 1; l++) {
    const A = ring(lay[l][0], lay[l][1]), B = ring(lay[l + 1][0], lay[l + 1][1]), ca = lay[l][2], cb = lay[l + 1][2];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      for (const [p, c] of [[A[i], ca], [A[j], ca], [B[j], cb], [A[i], ca], [B[j], cb], [B[i], cb]]) { pos.push(p[0], p[1], p[2]); col.push(c, c, c); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return (_flareGeo = g);
}

/**
 * Instantiate a blueprint: bones become Mesh (armour) / Object3D nodes; emissive channels become child meshes
 * with per-instance materials from `glows` ({glow, heat, jet} -> material).
 */
export function instantiate(bp, mats, glows) {
  const nodes = {}, armor = [];
  const root = new THREE.Group();
  for (const b of bp.bones) {
    let n;
    if (b.geo.a) { n = new THREE.Mesh(b.geo.a, mats.armor[0]); n.castShadow = true; n.receiveShadow = true; armor.push(n); }
    else n = new THREE.Object3D();
    n.name = b.name; n.position.set(b.pos[0], b.pos[1], b.pos[2]);
    (b.parent ? nodes[b.parent] : root).add(n);
    nodes[b.name] = n;
    for (const ch in b.geo) {
      if (ch === 'a') continue;
      const gm = new THREE.Mesh(b.geo[ch], glows[ch] || glows.glow); gm.name = b.name + ':' + ch; n.add(gm);
    }
  }
  const sockets = {};
  for (const s of bp.sockets) {
    const o = new THREE.Object3D(); o.name = 'socket:' + s.name; o.position.set(s.pos[0], s.pos[1], s.pos[2]); o.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
    nodes[s.bone].add(o); sockets[s.name] = o;
  }
  return { root, nodes, armor, sockets };
}

// ---------------------------------------------------------------------------
// Animation helpers (allocation-free)
// ---------------------------------------------------------------------------
/** critically-ish damped spring state stepped in place: o = {x, v} */
export function spring(o, target, k, c, dt) {
  // semi-implicit, sub-stepped for stability at 50 ms
  const n = dt > 0.02 ? 3 : 1, h = dt / n;
  for (let i = 0; i < n; i++) { o.v += (-(o.x - target) * k - o.v * c) * h; o.x += o.v * h; }
  return o.x;
}
export const ease = t => t * t * (3 - 2 * t);
export const easeOut = t => 1 - (1 - t) * (1 - t);
export const easeIn = t => t * t;
/** piecewise-linear key curve: keys = [t0,v0,t1,v1,...] with smoothstep between */
export function keys(t, k) {
  const n = k.length;
  if (t <= k[0]) return k[1];
  for (let i = 2; i < n; i += 2) {
    if (t <= k[i]) { const u = (t - k[i - 2]) / (k[i] - k[i - 2]); return k[i - 1] + (k[i + 1] - k[i - 1]) * (u * u * (3 - 2 * u)); }
  }
  return k[n - 1];
}

/**
 * Two-bone leg IK in the sagittal plane, with hip roll for lateral reach.
 * dx,dy,dz = ankle target minus hip, in the pelvis frame. l1,l2 = thigh, shin; meta/am = third segment length and
 * its absolute forward lean (0 for plantigrade). Writes out[0..4] = hipRoll, thighRotX, shinRotX, metaRotX, shinAbs
 */
export function legIK(dx, dy, dz, l1, l2, meta, am, out) {
  const roll = Math.atan2(dx, -dy);
  let down = Math.sqrt(dx * dx + dy * dy), fwd = dz;
  // hock = ankle - meta*(sin am, cos am)
  fwd -= meta * Math.sin(am); down -= meta * Math.cos(am);
  let L = Math.sqrt(fwd * fwd + down * down);
  const maxL = (l1 + l2) * 0.995, minL = Math.abs(l1 - l2) + 0.05;
  if (L > maxL) L = maxL; else if (L < minL) L = minL;
  const phi = Math.atan2(fwd, down);
  const ca = (l1 * l1 + L * L - l2 * l2) / (2 * l1 * L), alpha = Math.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca);
  const cb = (l1 * l1 + l2 * l2 - L * L) / (2 * l1 * l2), beta = Math.acos(cb < -1 ? -1 : cb > 1 ? 1 : cb);
  const a1 = phi + alpha, a2 = a1 - (Math.PI - beta);
  out[0] = roll; out[1] = -a1; out[2] = Math.PI - beta; out[3] = -(am - a2); out[4] = a2;
  return out;
}
