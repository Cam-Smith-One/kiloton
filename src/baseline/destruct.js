// BASELINE destruct (lead). Sphere carve by material strength; no debris, no collapse.
import { G, VS, bus } from '../core.js';
import { STRENGTH } from '../materials.js';
export default {
  name: 'destruct', stats: { debris: 0, sleeping: 0 },
  init() {}, reset() {}, update() {},
  explode(x, y, z, radius, power) {
    const g = G.grid, r = Math.ceil(radius / VS), ci = Math.floor(x / VS), cj = Math.floor(y / VS), ck = Math.floor(z / VS);
    let n = 0;
    for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) for (let i = -r; i <= r; i++) {
      const d = Math.sqrt(i * i + j * j + k * k) / r; if (d > 1) continue;
      const m = g.get(ci + i, cj + j, ck + k);
      if (m && STRENGTH[m] < power * (1.15 - d) && g.set(ci + i, cj + j, ck + k, 0)) n++;
    }
    if (n) { G.state.stats.voxelsDestroyed += n; bus.emit('voxels:destroyed', { x, y, z, count: n, mat: 8, radius }); }
    return n;
  },
  impact(x, y, z, dx, dy, dz, power, radius) { return this.explode(x + dx * 0.2, y + dy * 0.2, z + dz * 0.2, radius || 0.4, power); },
  punch(x, y, z, dx, dy, dz, radius, depth, power) { let n = 0; for (let t = 0; t <= depth; t += radius * 0.7) n += this.explode(x + dx * t, y + dy * t, z + dz * t, radius, power); return n; },
  carveBox(x0, y0, z0, x1, y1, z1, power) {
    const g = G.grid; let n = 0;
    for (let j = Math.floor(y0 / VS); j <= Math.floor(y1 / VS); j++) for (let k = Math.floor(z0 / VS); k <= Math.floor(z1 / VS); k++) for (let i = Math.floor(x0 / VS); i <= Math.floor(x1 / VS); i++) { const m = g.get(i, j, k); if (m && STRENGTH[m] < power && g.set(i, j, k, 0)) n++; }
    return n;
  },
  spawnDebris() {}, burst() {}, grabChunk() { return null; },
};
