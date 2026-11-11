// BASELINE city (lead). Flat ground and a few box buildings so other modules have something to stand on.
import { G, NX, NZ, GROUND_J, VS } from '../core.js';
import { M } from '../materials.js';
export default {
  name: 'city', buildings: [], lot: new Uint8Array(NX * NZ), buildingAt: new Int16Array(NX * NZ),
  spawns: { player: { x: 96, z: 100, yaw: 0 }, edge: [{ x: 8, z: 96 }, { x: 184, z: 96 }, { x: 96, z: 8 }, { x: 96, z: 184 }], air: [{ x: 20, y: 40, z: 20 }, { x: 170, y: 40, z: 170 }], mechDrops: [{ x: 96, z: 90 }] },
  roadNodes: [],
  init() { this.generate(G.state.seed); },
  generate() {
    const g = G.grid;
    g.fillBox(0, 0, 0, NX - 1, 0, NZ - 1, M.bedrock);
    g.fillBox(0, 1, 0, NX - 1, GROUND_J - 2, NZ - 1, M.dirt);
    g.fillBox(0, GROUND_J - 1, 0, NX - 1, GROUND_J - 1, NZ - 1, M.asphalt);
    this.buildings.length = 0;
    const add = (i0, k0, w, d, h, wall) => {
      const j0 = GROUND_J, i1 = i0 + w - 1, k1 = k0 + d - 1, j1 = j0 + h - 1;
      for (let j = j0; j <= j1; j++) {
        const slab = (j - j0) % 7 === 6 || j === j1;
        for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
          const edge = i === i0 || i === i1 || k === k0 || k === k1;
          const col = (i - i0) % 8 === 0 && (k - k0) % 8 === 0;
          if (slab) g.fill(i, j, k, M.floor);
          else if (edge) g.fill(i, j, k, ((i + k) % 4 < 2 && (j - j0) % 7 > 1 && (j - j0) % 7 < 5) ? M.glass : wall);
          else if (col) g.fill(i, j, k, M.concrete);
          if (!slab || true) { this.lot[i + NX * k] = 2; this.buildingAt[i + NX * k] = this.buildings.length + 1; }
        }
      }
      this.buildings.push({ id: this.buildings.length, kind: 'office', name: 'Block ' + this.buildings.length, i0, j0, k0, i1, j1, k1, voxels: 0, alive: true });
    };
    add(150, 150, 40, 32, 56, M.concrete); add(210, 150, 32, 32, 35, M.brick_red); add(150, 215, 28, 40, 28, M.brick_tan); add(215, 215, 36, 36, 70, M.concrete_dark);
    g.snapshot(); g.markAllDirty();
  },
  reset() {},
};
