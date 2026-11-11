// BASELINE combat (lead). Hitscan-only weapons with the contract's interface.
import { G, bus, THREE } from '../core.js';
const W = { rifle: { name: 'Rifle', rate: 9, damage: 9, range: 160, power: 30 }, launcher: { name: 'Launcher', rate: 0.8, damage: 120, range: 200, boom: { radius: 3, power: 130, damage: 120 } }, pulse: { name: 'Pulse cannons', rate: 5, damage: 40, range: 220, boom: { radius: 1.6, power: 110, damage: 40 } }, salvo: { name: 'Rocket salvo', rate: 0.5, damage: 150, range: 220, boom: { radius: 4, power: 150, damage: 150 } }, flak: { name: 'Skylance', rate: 0.5, damage: 200, range: 300, boom: { radius: 3, power: 120, damage: 200 } } };
export default {
  name: 'combat', WEAPONS: W, init() {}, reset() {}, update() {}, projectiles: [],
  createWeapon(id) {
    const def = W[id] || W.rifle;
    return { id, def, name: def.name, cd: 0, heat: 0, overheated: false, ammo: Infinity, clip: Infinity, reloading: 0, ready: true, charge: 1,
      update(dt) { this.cd = Math.max(0, this.cd - dt); this.ready = this.cd <= 0; },
      canFire() { return this.cd <= 0; },
      fire(shooter, origin, dir) { if (this.cd > 0) return false; this.cd = 1 / def.rate; G.combat.hitscan(id, shooter, origin, dir); return true; } };
  },
  hitscan(id, shooter, o, d) {
    const def = W[id] || W.rifle, g = G.grid;
    const r = g.raycast(o.x, o.y, o.z, d.x, d.y, d.z, def.range), e = G.ents.raycast(o.x, o.y, o.z, d.x, d.y, d.z, r.dist, shooter, shooter ? shooter.team : null);
    const t = e ? e.dist : r.dist, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
    bus.emit('shot', { weapon: id, x: o.x, y: o.y, z: o.z, dx: d.x, dy: d.y, dz: d.z, shooter });
    bus.emit('tracer', { weapon: id, x0: o.x, y0: o.y, z0: o.z, x1: x, y1: y, z1: z });
    if (def.boom) G.boom(x, y, z, Object.assign({ owner: shooter, kind: 'rocket' }, def.boom));
    else { if (e) G.ents.damage(e.ent, def.damage, { type: 'bullet', src: shooter, x, y, z, dx: d.x, dy: d.y, dz: d.z }); else if (r.hit) G.destruct.impact(x, y, z, d.x, d.y, d.z, def.power, 0.3); }
  },
  fireProjectile(id, shooter, origin, dir) { this.hitscan(id, shooter, origin, dir); },
  throwObject() {},
};
