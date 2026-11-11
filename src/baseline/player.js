// BASELINE player (lead). Fly camera: WASD + mouse, Space/C up/down, Shift fast, LMB rocket at the crosshair.
import { G, THREE, bus, input, clamp } from '../core.js';
const d = new THREE.Vector3(), o = new THREE.Vector3();
export default {
  name: 'player', pos: new THREE.Vector3(96, 14, 130),
  init() { const s = G.city.spawns.player; this.pos.set(s.x, 14, s.z + 30); G.state.player.yaw = Math.PI; },
  reset() { this.init(); },
  update(dt) {
    const p = G.state.player;
    p.yaw -= input.mdx * 0.0025; p.pitch = clamp(p.pitch - input.mdy * 0.0025, -1.5, 1.5);
    const sp = (input.down('ShiftLeft') ? 60 : 18) * (G.rawDt || dt);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    this.pos.x += (fx * input.axisY() - fz * input.axisX()) * sp; this.pos.z += (fz * input.axisY() + fx * input.axisX()) * sp;
    this.pos.y += ((input.down('Space') ? 1 : 0) - (input.down('KeyC') ? 1 : 0)) * sp;
    const cam = G.camera; cam.position.copy(this.pos);
    d.set(fx * Math.cos(p.pitch), Math.sin(p.pitch), fz * Math.cos(p.pitch)); o.copy(this.pos).add(d); cam.lookAt(o);
    if (input.buttonPressed(0)) { const r = G.grid.raycast(this.pos.x, this.pos.y, this.pos.z, d.x, d.y, d.z, 300); if (r.hit) G.boom(r.x, r.y, r.z, { radius: 4, power: 150, damage: 100, kind: 'rocket' }); }
  },
};
