// CITY harness renderer: greedy-meshed, unlit vertex-colour look-dev view (cheap enough for a loaded
// software GPU). Bakes a low warm sun + cool sky into vertex colours; renders a few frames then idles.
import { G, THREE, VS, NX, NY, NZ, CS, CX, CY, CZ } from '../src/core.js';
import { COLOR, GLASS, EMISSIVE } from '../src/materials.js';
const SUN = new THREE.Vector3(-0.55, 0.42, 0.72).normalize();
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const mask = new Uint8Array(CS * CS);
export default {
  name: 'render', sunDir: SUN.clone(), meshes: new Map(), frames: 0,
  sunColor: new THREE.Color(1, 0.8, 0.6), skyColor: new THREE.Color(0.5, 0.6, 0.9), fogColor: new THREE.Color(0.8, 0.7, 0.6), ambient: new THREE.Color(0.4, 0.45, 0.6),
  init() {
    G.scene.background = new THREE.Color(0xe9c9a4);
    this.mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const t0 = performance.now();
    for (const c of G.grid.takeDirty(1e9)) this.buildChunk(c);
    this.meshMs = performance.now() - t0;
  },
  buildChunk(c) {
    const g = G.grid, d = g.data, ci = c % CX, ck = Math.floor(c / CX) % CZ, cj = Math.floor(c / (CX * CZ));
    const pos = [], col = [], idx = [];
    const o0 = [ci * CS, cj * CS, ck * CS];
    for (let f = 0; f < 6; f++) {
      const n = DIRS[f], ax = f >> 1, u = (ax + 1) % 3, v = (ax + 2) % 3;
      const ndl = Math.max(0, n[0] * SUN.x + n[1] * SUN.y + n[2] * SUN.z);
      const sky = 0.5 + 0.5 * n[1];
      const lr = 0.30 + 0.18 * sky + 1.25 * ndl, lg = 0.31 + 0.22 * sky + 0.95 * ndl, lb = 0.36 + 0.34 * sky + 0.62 * ndl;
      const p = [0, 0, 0];
      for (let s = 0; s < CS; s++) {
        let any = false;
        for (let b = 0; b < CS; b++) for (let a = 0; a < CS; a++) {
          p[ax] = o0[ax] + s; p[u] = o0[u] + a; p[v] = o0[v] + b;
          const m = d[p[0] + NX * (p[2] + NZ * p[1])];
          let vis = 0;
          if (m) { const nb = g.get(p[0] + n[0], p[1] + n[1], p[2] + n[2]); if (!(p[1] === 0 && f === 3) && (!nb || (GLASS[nb] && !GLASS[m]) || (nb === 25 && m !== 25))) vis = m; }
          mask[a + b * CS] = vis; if (vis) any = true;
        }
        if (!any) continue;
        for (let b = 0; b < CS; b++) for (let a = 0; a < CS;) {
          const m = mask[a + b * CS]; if (!m) { a++; continue; }
          let w = 1; while (a + w < CS && mask[a + w + b * CS] === m) w++;
          let h = 1; outer: for (; b + h < CS; h++) for (let t = 0; t < w; t++) if (mask[a + t + (b + h) * CS] !== m) break outer;
          for (let y = 0; y < h; y++) for (let t = 0; t < w; t++) mask[a + t + (b + y) * CS] = 0;
          const base = pos.length / 3, q = [0, 0, 0];
          const corners = [[0, 0], [w, 0], [w, h], [0, h]];
          for (const [da, db] of corners) { q[ax] = o0[ax] + s + (n[ax] > 0 ? 1 : 0); q[u] = o0[u] + a + da; q[v] = o0[v] + b + db; pos.push(q[0] * VS, q[1] * VS, q[2] * VS); }
          const e = EMISSIVE[m], gl = GLASS[m] && !e;
          let r = COLOR[m * 3], gg = COLOR[m * 3 + 1], bb = COLOR[m * 3 + 2];
          if (e) { r *= 1 + e * 0.25; gg *= 1 + e * 0.25; bb *= 1 + e * 0.25; }
          else { r *= lr; gg *= lg; bb *= lb; if (gl) { r = r * 0.6 + 0.25 * ndl + 0.05; gg = gg * 0.6 + 0.2 * ndl + 0.07; bb = bb * 0.6 + 0.16 * ndl + 0.12; } }
          for (let t = 0; t < 4; t++) col.push(r, gg, bb);
          if (n[ax] > 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3); else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
          a += w;
        }
      }
    }
    let mesh = this.meshes.get(c);
    if (mesh) { G.scene.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(c); }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    mesh = new THREE.Mesh(geo, this.mat); mesh.matrixAutoUpdate = false; G.scene.add(mesh); this.meshes.set(c, mesh);
  },
  update() { const dd = G.grid.takeDirty(8); for (const c of dd) this.buildChunk(c); if (dd.length) this.frames = 0; },
  flash() {}, setQuality() {}, reset() {},
  render() { if (this.frames++ < 3 || G.params.has('live')) G.renderer.render(G.scene, G.camera); },
};
