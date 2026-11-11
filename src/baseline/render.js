// BASELINE render (lead). Naive face-culled chunk mesher with vertex colours + plain lights. No post.
import { G, THREE, VS, NX, NY, NZ, CS, CX, CY, CZ } from '../core.js';
import { COLOR, GLASS, EMISSIVE } from '../materials.js';
const FACES = [[1, 0, 0, [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]], [-1, 0, 0, [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]]], [0, 1, 0, [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]], [0, -1, 0, [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]], [0, 0, 1, [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]]], [0, 0, -1, [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]]]];
export default {
  name: 'render', sunDir: new THREE.Vector3(0.45, 0.75, 0.35).normalize(), meshes: new Map(),
  init() {
    const s = G.scene; s.background = new THREE.Color(0x8fb3d9); s.fog = new THREE.Fog(0x8fb3d9, 80, 420);
    s.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a4238, 1.1));
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.copy(this.sunDir).multiplyScalar(100); s.add(sun);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.update(0, 1e9);
  },
  buildChunk(c) {
    const g = G.grid, d = g.data, ci = c % CX, ck = Math.floor(c / CX) % CZ, cj = Math.floor(c / (CX * CZ));
    const pos = [], col = [], nor = [], idx = [];
    for (let j = cj * CS; j < cj * CS + CS; j++) for (let k = ck * CS; k < ck * CS + CS; k++) for (let i = ci * CS; i < ci * CS + CS; i++) {
      const m = d[i + NX * (k + NZ * j)]; if (!m) continue;
      for (const f of FACES) {
        const n = g.get(i + f[0], j + f[1], k + f[2]);
        if (n && !(GLASS[n] && !GLASS[m])) continue;
        if (j === 0 && f[1] === -1) continue;
        const b = pos.length / 3, sh = (f[1] > 0 ? 1 : f[1] < 0 ? 0.5 : f[0] !== 0 ? 0.8 : 0.68) * (1 + EMISSIVE[m]);
        for (const v of f[3]) { pos.push((i + v[0]) * VS, (j + v[1]) * VS, (k + v[2]) * VS); nor.push(f[0], f[1], f[2]); col.push(COLOR[m * 3] * sh, COLOR[m * 3 + 1] * sh, COLOR[m * 3 + 2] * sh); }
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
    }
    let mesh = this.meshes.get(c);
    if (mesh) { G.scene.remove(mesh); mesh.geometry.dispose(); this.meshes.delete(c); }
    if (!idx.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx);
    mesh = new THREE.Mesh(geo, this.mat); mesh.matrixAutoUpdate = false; G.scene.add(mesh); this.meshes.set(c, mesh);
  },
  update(dt, budget) { for (const c of G.grid.takeDirty(budget || 6)) this.buildChunk(c); },
  flash() {}, setQuality() {},
  reset() {},
  render() { G.renderer.render(G.scene, G.camera); },
};
