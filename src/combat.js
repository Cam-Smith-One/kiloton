// ============================================================================
// KILOTON — combat.js   OWNER: COMBAT          module G.combat
// Weapons and projectiles for everyone (player pilot, Warden rig, Vanta).
//   combat_weapons.js  WEAPONS table + createWeapon state machine
//   combat_draw.js     the two instanced draw calls for projectile bodies / glow
// Projectiles live in a fixed pool; update() allocates nothing while they fly
// (objects are only created on rare events: a shot, a hit, an explosion).
// ============================================================================
import { G, THREE, bus, mulberry32, WX, WZ, VS } from './core.js';
import { GLASS } from './materials.js';
import { WEAPONS, HP_ASSUMED, ARMOR_CLASS, makeWeapon, penFor, ttk, shotsToKill, spreadDir } from './combat_weapons.js';
import { createDraw } from './combat_draw.js';

const MAX = 640;                                   // pool size (projectiles alive at once)
const K_BULLET = 0, K_PULSE = 1, K_ROCKET = 2, K_MISSILE = 3, K_SHELL = 4, K_GRENADE = 5;
const KI = { bullet: K_BULLET, pulse: K_PULSE, rocket: K_ROCKET, missile: K_MISSILE, shell: K_SHELL, grenade: K_GRENADE };
const DMG_TYPE = ['bullet', 'pulse', 'rocket', 'rocket', 'rocket', 'explosion'];
const TRAIL = [null, null, 'trail_rocket', 'trail_missile', 'trail_shell', null];

// Tuning knobs that are not per-weapon.
export const TUNE = {
  friendlyBlast: [0.35, 0.25],   // share of an explosion's damage its owner's own team takes (player / Vanta)
  pursuit: 2.5,                  // homing: pursuit bias added to proportional navigation (1/s)
  glassPen: 3,                   // panes of glass a bullet / bolt can go through
  beamTracers: false,            // also call G.fx.beam for bullet steps (off: FX draws beams from the 'tracer' event)
  bounds: 40,                    // metres outside the map before a projectile is dropped
  ceiling: 150,
  // HDR linear colours [player, Vanta]
  tracer: [[1.5, 5.6, 6.6], [9.0, 2.5, 0.65]],
  bolt: [[0.9, 5.2, 8.5], [10.5, 1.9, 0.45]],
  flame: [[2.2, 5.6, 9.0], [10.0, 3.4, 0.8]],
  paint: [[0.10, 0.80, 0.85], [0.95, 0.20, 0.08]],
};

const rng = mulberry32(0x51DEC0DE);
const pool = [], live = [], free = new Int16Array(MAX);
let top = 0, uid = 0, epoch = 0, draw = null, warnOn = false;
const _v = new THREE.Vector3(), _d = new THREE.Vector3();
const _tr = { weapon: '', x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0, team: 0 };   // shared 'tracer' payload (copy what you keep)
const _eh = { ent: null, dist: 0, x: 0, y: 0, z: 0 };
const stats = { live: 0, peak: 0, fired: 0, hits: 0, dropped: 0, ms: 0, msPeak: 0, glow: 0, bodies: 0 };

function makeProj(slot) {
  return {
    slot, active: false, uid: 0,
    id: '', kind: '', pos: new THREE.Vector3(), vel: new THREE.Vector3(), team: 0, target: null,     // the public part
    k: 0, def: null, shooter: null, faction: 0, ignoreTeam: null, age: 0, life: 0, dist: 0, speed: 0, pen: 0, dmgMul: 1,
    remote: false, seed: 1, trail: 0, rest: false, tHas: false, tx: 0, ty: 0, tz: 0, tvx: 0, tvy: 0, tvz: 0,
    ph1: 0, ph2: 0, w1: 0, w2: 0, roll: 0, spin: 0,
  };
}

// Padded version of G.ents.raycast for fat projectiles (bolts, rockets): bodies grow by `pad` on every side.
function sweepEnts(ox, oy, oz, dx, dy, dz, maxDist, ignore, ignoreTeam, pad) {
  if (!(pad > 0)) return G.ents.raycast(ox, oy, oz, dx, dy, dz, maxDist, ignore, ignoreTeam);
  let best = maxDist, hit = null;
  const L = G.ents.list;
  for (let n = 0; n < L.length; n++) {
    const e = L[n]; if (!e.alive || e === ignore || e.noHit || (ignoreTeam != null && e.team === ignoreTeam)) continue;
    const r = e.radius + pad, p = e.pos;
    let t0 = 0, t1 = best, lo = p.x - r - ox, hi = p.x + r - ox, a, b;
    if (Math.abs(dx) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { a = lo / dx; b = hi / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
    lo = p.y - pad - oy; hi = p.y + e.height + pad - oy;
    if (Math.abs(dy) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { a = lo / dy; b = hi / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
    lo = p.z - r - oz; hi = p.z + r - oz;
    if (Math.abs(dz) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { a = lo / dz; b = hi / dz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
    best = t0; hit = e;
  }
  if (!hit) return null;
  _eh.ent = hit; _eh.dist = best; _eh.x = ox + dx * best; _eh.y = oy + dy * best; _eh.z = oz + dz * best;
  return _eh;
}

// Aegis shield: ent.shield = { on, yaw, arc (full angle, rad; default 2.1), hp }. Damage arriving from inside the arc in
// front of `yaw` is taken from shield.hp instead; what the shield cannot hold passes through. (fx, fz) = horizontal
// direction FROM the entity TOWARDS where the damage comes from. Returns the damage left for the entity.
function shieldAbsorb(ent, dmg, fx, fz, x, y, z) {
  const s = ent.shield;
  if (!s || !s.on || !(s.hp > 0) || dmg <= 0) return dmg;
  const l = Math.sqrt(fx * fx + fz * fz); if (l < 1e-6) return dmg;
  const c = (fx * Math.sin(s.yaw) + fz * Math.cos(s.yaw)) / l;
  if (c < Math.cos((s.arc == null ? 2.1 : s.arc) * 0.5)) return dmg;
  const a = dmg < s.hp ? dmg : s.hp;
  s.hp -= a;
  bus.emit('shield:hit', { ent, x, y, z, amount: a });
  return dmg - a;
}

// Same falloff as core's radiusDamage (100 % at the centre, 25 % at the rim) with team / entity filters.
function radial(x, y, z, r, dmg, onlyTeam, exceptTeam, exceptEnt, type, src, weapon, flt) {
  const L = G.ents.list;
  for (let n = L.length - 1; n >= 0; n--) {
    const e = L[n]; if (!e || !e.alive || e === exceptEnt) continue;
    if (onlyTeam != null && e.team !== onlyTeam) continue;
    if (exceptTeam != null && e.team === exceptTeam) continue;
    if (flt && !mayDamage(flt, e)) continue;
    const cy = y < e.pos.y ? e.pos.y : y > e.pos.y + e.height ? e.pos.y + e.height : y;
    const dx = e.pos.x - x, dy = cy - y, dz = e.pos.z - z;
    const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - e.radius);
    if (d < r) { const a = shieldAbsorb(e, dmg * (1 - 0.75 * d / r) * cover(x, y, z, e, d), -dx, -dz, x, y, z); if (a > 0) G.ents.damage(e, a, { type, src, x, y, z, dx, dy: dy + 0.5, dz, weapon }); }
  }
}

function kill(p) { p.active = false; }
// 9th argument of G.destruct.impact (read synchronously by DESTRUCT; the baseline ignores it): credit + ignition
const _io = { owner: null, fire: false };
function impactOpts(owner, fire) { _io.owner = owner || null; _io.fire = fire; return _io; }

// Same cover rule as core's radiusDamage: a wall still standing after the blast shields what is behind it.
function cover(x, y, z, e, d) { return d > 0.5 && !G.grid.los(x, y, z, e.pos.x, e.pos.y + e.height * 0.6, e.pos.z) ? 0.3 : 1; }

// ---- co-op ownership (CONTRACT-D D1). Offline: always true, one property read. ---------------------------------
//   remote projectile (a replay of another peer's shot): visual; it damages only entities this peer owns, and only
//     when it is hostile to them. Replays of PLAYER shots (team 0) never damage anything: the firing peer's own
//     projectile already claims those hits, so applying them here as well would count them twice.
//   local projectile: damages normally (core turns hits on puppets into claims) except other players' puppets,
//     whose damage is decided by their owner's replayed copy.
function mayDamage(p, e) {
  const net = G.net; if (!net || !net.online) return true;
  if (p.remote) return p.team !== 0 && e.team !== p.team && !e.remote && (!net.localOwns || net.localOwns(e));
  return !(e.remote && (e.netOwner != null || e.team === 0));
}
const online = () => { const n = G.net; return !!(n && n.online); };
// per-projectile deterministic randoms (same seed -> same wobble, roll and cluster burst on every peer)
function prand(p) { p.seed = (Math.imul(p.seed, 1664525) + 1013904223) >>> 0; return p.seed / 4294967296; }
// Blast damage when online: every entity through the ownership filter (core's radiusDamage would turn an enemy shell
// near a teammate's puppet into a second, duplicate hit claim). Owner's team takes the reduced friendly share.
function radialNet(x, y, z, r, dmg, p) {
  const L = G.ents.list, owner = p.shooter;
  for (let n = L.length - 1; n >= 0; n--) {
    const e = L[n]; if (!e || !e.alive) continue;
    const sc = owner && e.team === owner.team ? TUNE.friendlyBlast[owner.team] || 0 : 1;
    if (sc <= 0 || !mayDamage(p, e)) continue;
    const cy = y < e.pos.y ? e.pos.y : y > e.pos.y + e.height ? e.pos.y + e.height : y;
    const dx = e.pos.x - x, dy = cy - y, dz = e.pos.z - z;
    const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - e.radius);
    if (d < r) { const a = shieldAbsorb(e, dmg * sc * (1 - 0.75 * d / r) * cover(x, y, z, e, d), -dx, -dz, x, y, z); if (a > 0) G.ents.damage(e, a, { type: 'explosion', src: owner, x, y, z, dx, dy: dy + 0.5, dz, weapon: p.id }); }
  }
}

function emitImpact(p, x, y, z, nx, ny, nz, mat, ent) {
  const d = p.def;
  bus.emit('impact', { weapon: p.id, x, y, z, nx, ny, nz, mat, power: d.blast ? d.blast.power : d.world ? d.world.power : 0, ent: ent || null, team: p.team, kind: p.kind });
}

function detonate(p, x, y, z) {
  const b = p.def.blast, owner = p.shooter, dmg = b.damage * p.dmgMul;
  // field perk 'blast': the player's explosions get a bigger radius (radius only: PLAYER adds the damage bonus)
  const rm = owner && owner.team === 0 && G.progress && G.progress.mult ? G.progress.mult('blast') || 1 : 1;
  const dr = (b.dmgRadius || b.radius * 1.6) * rm;
  const o = { radius: b.radius * rm, power: b.power, damage: dmg, dmgRadius: dr, owner, kind: b.kind || 'rocket', weapon: p.id };
  if (online()) {                                // co-op: carving only by the firing peer's own projectile; damage through the ownership filter
    if (p.remote) bus.emit('explosion', { x, y, z, radius: o.radius, power: o.power, kind: o.kind, owner, remote: true });
    else { o.damage = 0; G.boom(x, y, z, o); if (b.ignite && G.destruct.ignite) G.destruct.ignite(x, y, z, b.ignite * rm, 1, owner || null); }
    if (dmg > 0) radialNet(x, y, z, dr, dmg, p);
    return;
  }
  if (owner) o.friendlyFire = false;             // G.boom then skips the owner's team; they get the reduced share below
  G.boom(x, y, z, o);
  if (b.ignite && G.destruct.ignite) G.destruct.ignite(x, y, z, b.ignite * rm, 1, owner || null);      // incendiary blasts (real DESTRUCT only)
  if (owner && dmg > 0) {
    const s = TUNE.friendlyBlast[owner.team] || 0;
    if (s > 0) radial(x, y, z, dr, dmg * s, owner.team, null, null, 'explosion', owner, p.id);
  }
}

function hitEnt(p, ent, x, y, z, dx, dy, dz) {
  const def = p.def, dmg = mayDamage(p, ent) ? shieldAbsorb(ent, def.damage * penFor(def, ent) * p.dmgMul, -dx, -dz, x, y, z) : 0;
  stats.hits++;
  if (dmg > 0) G.ents.damage(ent, dmg, { type: DMG_TYPE[p.k], src: p.shooter, x, y, z, dx, dy, dz, weapon: p.id });
  emitImpact(p, x, y, z, -dx, -dy, -dz, 0, ent);
  if (def.splash) radial(x, y, z, def.splash.radius, def.splash.damage * p.dmgMul, null, p.ignoreTeam, ent, DMG_TYPE[p.k], p.shooter, p.id, p);
  if (def.blast) detonate(p, x, y, z);
  kill(p);
}

// returns true when the projectile carries on through what it hit (glass)
function hitWorld(p, x, y, z, nx, ny, nz, mat, dx, dy, dz, vi, vj, vk) {
  const def = p.def;
  if (def.blast) {
    const bury = def.blast.bury || 0;
    emitImpact(p, x, y, z, nx, ny, nz, mat, null);
    detonate(p, x - nx * bury, y - ny * bury, z - nz * bury);
    kill(p); return false;
  }
  const wd = def.world;
  // Chip centred on the voxel that was hit (DESTRUCT pushes the centre 0.2 m along d), so whether a pane breaks
  // does not depend on where on its face the round landed.
  const n = wd && !p.remote ? G.destruct.impact((vi + 0.5) * VS - dx * 0.2, (vj + 0.5) * VS - dy * 0.2, (vk + 0.5) * VS - dz * 0.2, dx, dy, dz, wd.power, wd.radius, impactOpts(p.shooter, false)) : 0;
  emitImpact(p, x, y, z, nx, ny, nz, mat, null);
  if (def.splash) radial(x, y, z, def.splash.radius, def.splash.damage * p.dmgMul, null, p.ignoreTeam, null, DMG_TYPE[p.k], p.shooter, p.id, p);
  if (GLASS[mat] && (n > 0 || p.remote) && p.pen < TUNE.glassPen) { p.pen++; return true; }   // a replay cannot break the pane itself: let it through
  kill(p); return false;
}

function tracer(p, x0, y0, z0, x1, y1, z1) {
  _tr.weapon = p.id; _tr.x0 = x0; _tr.y0 = y0; _tr.z0 = z0; _tr.x1 = x1; _tr.y1 = y1; _tr.z1 = z1; _tr.team = p.team;
  bus.emit('tracer', _tr);
  if (TUNE.beamTracers) G.fx.beam(x0, y0, z0, x1, y1, z1, p.faction ? 'tracer_enemy' : 'tracer');
}

// A cluster shell bursts into its bomblets (pool permitting) and is gone.
const _sopt = { silent: false, speedMul: 1, team: 0, damageMul: 1, remote: false, seed: 0, child: true };
function split(p) {
  const c = p.def.cluster, bd = WEAPONS[c.id], q = p.pos, v = p.vel;
  for (let i = 0; i < c.count; i++) {
    const vx = v.x + (prand(p) - 0.5) * 2 * c.spread, vy = v.y + (prand(p) - 0.5) * c.spread, vz = v.z + (prand(p) - 0.5) * 2 * c.spread;
    const sp = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    _sopt.silent = i > 0; _sopt.speedMul = sp / bd.speed; _sopt.team = p.team; _sopt.damageMul = p.dmgMul; _sopt.remote = p.remote; _sopt.seed = ((prand(p) * 4294967296) >>> 0) || 1;
    combat._launch(bd, p.shooter, q.x, q.y, q.z, vx / sp, vy / sp, vz / sp, null, _sopt);
  }
  kill(p);
}

function inMap(p) { const q = p.pos; return q.x > -2 && q.z > -2 && q.x < WX + 2 && q.z < WZ + 2 && q.y < TUNE.ceiling; }

// Homing: proportional navigation + a pursuit bias, limited to def.turnRate. Mutates p.vel direction (keeps |vel|).
function guide(p, dt, sp) {
  const T = p.target, def = p.def;
  if (!T.alive) { p.target = null; return; }                 // lock lost: fly on dumb
  if (p.age < (def.boost || 0)) return;
  const q = p.pos, v = p.vel;
  const tx = T.pos.x, ty = T.pos.y + T.height * 0.5, tz = T.pos.z;
  const rx = tx - q.x, ry = ty - q.y, rz = tz - q.z, R2 = rx * rx + ry * ry + rz * rz;
  if (R2 < 1e-4) return;
  const R = Math.sqrt(R2), ux = rx / R, uy = ry / R, uz = rz / R;
  const vl = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1, fx = v.x / vl, fy = v.y / vl, fz = v.z / vl;
  const vrx = p.tvx - v.x, vry = p.tvy - v.y, vrz = p.tvz - v.z;
  // LOS rotation  Ω = (r × vr) / R²,   closing speed Vc = -(r·vr)/R,   a = N·Vc·(Ω × r̂)
  const ox = (ry * vrz - rz * vry) / R2, oy = (rz * vrx - rx * vrz) / R2, oz = (rx * vry - ry * vrx) / R2;
  let Vc = -(rx * vrx + ry * vry + rz * vrz) / R; if (Vc < 0) Vc = 0;
  const N = (def.navGain || 3) * Vc;
  let ax = N * (oy * uz - oz * uy), ay = N * (oz * ux - ox * uz), az = N * (ox * uy - oy * ux);
  // pursuit bias: the part of the LOS that is not along the nose
  const c = ux * fx + uy * fy + uz * fz;
  let ex = ux - c * fx, ey = uy - c * fy, ez = uz - c * fz;
  if (c < 0) { const el = Math.sqrt(ex * ex + ey * ey + ez * ez); if (el > 1e-5) { ex /= el; ey /= el; ez /= el; } else { ex = fz; ey = 0; ez = -fx; } }
  const kp = TUNE.pursuit * sp; ax += ex * kp; ay += ey * kp; az += ez * kp;
  const al = ax * fx + ay * fy + az * fz; ax -= al * fx; ay -= al * fy; az -= al * fz;      // steer only
  const am = Math.sqrt(ax * ax + ay * ay + az * az), amax = def.turnRate * sp;
  if (am > amax) { const s = amax / am; ax *= s; ay *= s; az *= s; }
  let nx = fx * sp + ax * dt, ny = fy * sp + ay * dt, nz = fz * sp + az * dt;
  const nl = sp / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
  v.set(nx * nl, ny * nl, nz * nl);
}

// Advance one projectile by dt. All collision is swept: nothing tunnels at any frame rate.
function step(p, dt) {
  const def = p.def, k = p.k, q = p.pos, v = p.vel, grid = G.grid;
  p.age += dt;
  if (p.age >= p.life) {                                                          // fuse / timeout
    if (def.blast && inMap(p)) detonate(p, q.x, q.y, q.z);
    kill(p); return;
  }
  if (k >= K_ROCKET && k <= K_MISSILE) {
    let sp = p.speed;
    if (def.accel) { sp += def.accel * dt; if (sp > def.maxSpeed) sp = def.maxSpeed; p.speed = sp; }
    if (p.target) guide(p, dt, sp);
    let l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1, fx = v.x / l, fy = v.y / l, fz = v.z / l;
    if (def.wobble && !p.target) {                                                // slight corkscrew, bounded heading error
      let ux, uz; if (Math.abs(fy) < 0.99) { const h = 1 / Math.sqrt(fx * fx + fz * fz); ux = fz * h; uz = -fx * h; } else { ux = 1; uz = 0; }
      const wx = fy * uz, wy = fz * ux - fx * uz, wz = -fy * ux;
      const a1 = def.wobble * p.w1 * Math.cos(p.w1 * p.age + p.ph1) * dt, a2 = def.wobble * p.w2 * Math.cos(p.w2 * p.age + p.ph2) * dt;
      fx += ux * a1 + wx * a2; fy += wy * a2; fz += uz * a1 + wz * a2;
      l = Math.sqrt(fx * fx + fy * fy + fz * fz); fx /= l; fy /= l; fz /= l;
    }
    v.set(fx * sp, fy * sp, fz * sp);
  } else if (k >= K_SHELL) {
    if (p.rest) {                                                                 // grenade lying on the ground
      if (grid.solidAt(q.x, q.y - 0.15, q.z)) return;
      p.rest = false;
    }
    v.y -= def.gravity * dt;
    if (def.cluster && v.y < 0 && q.y - grid.topBelow(q.x, q.y, q.z) < def.cluster.alt) { split(p); return; }
  }
  const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  let rem = sp * dt;
  if (rem < 1e-7) return;
  const dx = v.x / sp, dy = v.y / sp, dz = v.z / sp;
  const pad = def.pad || 0, sh = p.shooter, it = p.ignoreTeam;
  let ox = q.x, oy = q.y, oz = q.z, sx = ox, sy = oy, sz = oz;
  for (let pass = 0; pass < 5; pass++) {
    const gr = grid.raycast(ox, oy, oz, dx, dy, dz, rem, false);
    const gHit = gr.hit, gDist = gHit ? gr.dist : rem;
    const gx = gr.x, gy = gr.y, gz = gr.z, nx = gr.nx, ny = gr.ny, nz = gr.nz, mat = gr.mat, vi = gr.i, vj = gr.j, vk = gr.k;   // shared object: copy now
    const eh = sweepEnts(ox, oy, oz, dx, dy, dz, gDist, sh, it, pad);
    // proximity fuse on the locked target (closest approach inside this step)
    const T = p.target;
    if (T && def.prox) {
      const tyc = T.pos.y + T.height * 0.5;
      let s = (T.pos.x - ox) * dx + (tyc - oy) * dy + (T.pos.z - oz) * dz;
      const lim = eh ? eh.dist : gDist; if (s < 0) s = 0; else if (s > lim) s = lim;
      const cx = ox + dx * s, cy = oy + dy * s, cz = oz + dz * s;
      const ex = Math.max(0, Math.abs(cx - T.pos.x) - T.radius), ey = Math.max(0, Math.abs(cy - tyc) - T.height * 0.5), ez = Math.max(0, Math.abs(cz - T.pos.z) - T.radius);
      if (ex * ex + ey * ey + ez * ez < def.prox * def.prox && T.alive) {
        q.set(cx, cy, cz); hitEnt(p, T, cx, cy, cz, dx, dy, dz); return;
      }
    }
    if (eh) { if (k === K_BULLET) tracer(p, sx, sy, sz, eh.x, eh.y, eh.z); q.set(eh.x, eh.y, eh.z); hitEnt(p, eh.ent, eh.x, eh.y, eh.z, dx, dy, dz); return; }
    if (!gHit) { ox += dx * rem; oy += dy * rem; oz += dz * rem; break; }
    if (k === K_GRENADE) {                                                        // bounce
      q.set(gx + nx * 0.04, gy + ny * 0.04, gz + nz * 0.04);
      const vn = v.x * nx + v.y * ny + v.z * nz, b = def.bounce || 0.4;
      v.x = (v.x - vn * nx) * 0.7 - b * vn * nx; v.y = (v.y - vn * ny) * 0.7 - b * vn * ny; v.z = (v.z - vn * nz) * 0.7 - b * vn * nz;
      if (-vn > 3) emitImpact(p, gx, gy, gz, nx, ny, nz, mat, null);
      if (ny > 0.5 && v.x * v.x + v.y * v.y + v.z * v.z < 2.2) { v.set(0, 0, 0); p.rest = true; }
      p.dist += gDist; return;
    }
    q.set(gx, gy, gz);
    if (k === K_BULLET) { tracer(p, sx, sy, sz, gx, gy, gz); sx = gx; sy = gy; sz = gz; }
    if (!hitWorld(p, gx, gy, gz, nx, ny, nz, mat, dx, dy, dz, vi, vj, vk)) return;
    ox = gx + dx * 0.05; oy = gy + dy * 0.05; oz = gz + dz * 0.05; rem -= gDist + 0.05;   // through the pane
    if (rem <= 0) break;
  }
  if (k === K_BULLET) tracer(p, sx, sy, sz, ox, oy, oz);
  const moved = sp * dt;
  q.set(ox, oy, oz); p.dist += moved;
  if ((k <= K_PULSE && p.dist >= def.range) || q.x < -TUNE.bounds || q.z < -TUNE.bounds || q.x > WX + TUNE.bounds || q.z > WZ + TUNE.bounds || q.y > TUNE.ceiling || q.y < -4) kill(p);
}

// ---- continuous beams (lance) -----------------------------------------------------------------------------
const BEAMS = 16, beams = [];
for (let i = 0; i < BEAMS; i++) beams.push({ slot: null, remote: false, w: null, ttl: 0, id: '', def: null, kind: 'beam', team: 0, faction: 0, shooter: null, ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 1, len: 0, hit: false });
function castBeam(b) {     // -> end distance; leaves the grid hit in G.grid's shared object and the entity hit in _eh / null
  const gr = G.grid.raycast(b.ox, b.oy, b.oz, b.dx, b.dy, b.dz, b.def.range, false);
  return gr;
}
function updateBeams(dt) {
  for (let i = 0; i < BEAMS; i++) {
    const b = beams[i]; if (b.ttl <= 0) continue;
    b.ttl -= dt;
    if (b.ttl <= 0 || (b.shooter && b.shooter.alive === false)) { b.ttl = 0; b.w = null; b.slot = null; b.shooter = null; continue; }
    const gr = castBeam(b), gd = gr.hit ? gr.dist : b.def.range;
    const eh = sweepEnts(b.ox, b.oy, b.oz, b.dx, b.dy, b.dz, gd, b.shooter, b.team < 0 ? null : b.team, b.def.pad || 0);
    b.len = eh ? eh.dist : gd; b.hit = !!eh || gr.hit;
  }
}

function render() {
  const d = draw; d.begin();
  const t = G.time;
  for (let i = 0; i < BEAMS; i++) {
    const b = beams[i]; if (b.ttl <= 0 || b.len <= 0.05) continue;
    const c = TUNE.bolt[b.faction ? 1 : 0], fl = 0.8 + 0.2 * Math.sin(t * 90 + i * 2.1), L = b.len;
    d.beam(b.ox, b.oy, b.oz, b.dx * L, b.dy * L, b.dz * L, 0.16, c[0] * fl, c[1] * fl, c[2] * fl);
    d.beam(b.ox, b.oy, b.oz, b.dx * L, b.dy * L, b.dz * L, 0.42, c[0] * 0.18, c[1] * 0.18, c[2] * 0.18);
    d.sprite(b.ox, b.oy, b.oz, 0.55, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
    if (b.hit) d.sprite(b.ox + b.dx * L, b.oy + b.dy * L, b.oz + b.dz * L, 0.9 * fl, c[0], c[1], c[2]);
  }
  for (let i = 0; i < live.length; i++) {
    const p = live[i], q = p.pos, v = p.vel, def = p.def, f = p.faction ? 1 : 0;
    const sp = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    let dx = 0, dy = 0, dz = 1; if (sp > 1e-4) { dx = v.x / sp; dy = v.y / sp; dz = v.z / sp; }
    const s = def.size || 1;
    switch (p.k) {
      case K_BULLET: {
        const c = TUNE.tracer[f];
        let L = sp * 0.024; if (L < 1.6) L = 1.6; else if (L > 7) L = 7; if (L > p.dist + 0.3) L = p.dist + 0.3;
        const w = f ? 0.07 : 0.055;
        d.ribbon(q.x - dx * L, q.y - dy * L, q.z - dz * L, dx * L, dy * L, dz * L, w, c[0], c[1], c[2]);
        break;
      }
      case K_PULSE: {
        const c = TUNE.bolt[f];
        let L = sp * 0.03; if (L < 1.4) L = 1.4; else if (L > 5) L = 5; L *= s; if (L > p.dist + 0.4) L = p.dist + 0.4;
        d.ribbon(q.x - dx * L, q.y - dy * L, q.z - dz * L, dx * L, dy * L, dz * L, 0.2 * s, c[0], c[1], c[2]);
        d.sprite(q.x - dx * 0.15, q.y - dy * 0.15, q.z - dz * 0.15, 0.5 * s, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8);
        break;
      }
      case K_ROCKET: case K_MISSILE: {
        const c = TUNE.flame[f], pt = TUNE.paint[f], m = p.k === K_MISSILE;
        const len = (m ? 1.25 : 1.0) * s, th = (m ? 0.15 : 0.19) * s;
        d.solid(q.x, q.y, q.z, dx, dy, dz, th, th, len, pt[0], pt[1], pt[2], p.roll + p.age * p.spin);
        const fl = (m ? 2.4 : 1.7) * (0.75 + 0.25 * Math.sin(t * 61 + p.ph1 * 7)), tb = len * 0.48;
        const bx = q.x - dx * tb, by = q.y - dy * tb, bz = q.z - dz * tb;
        d.ribbon(bx - dx * fl, by - dy * fl, bz - dz * fl, dx * fl, dy * fl, dz * fl, m ? 0.2 : 0.24, c[0], c[1], c[2]);
        d.sprite(bx, by, bz, m ? 0.6 : 0.7, c[0], c[1], c[2]);
        break;
      }
      case K_SHELL: {
        const c = TUNE.flame[f], pt = TUNE.paint[f];
        d.solid(q.x, q.y, q.z, dx, dy, dz, 0.34 * s, 0.34 * s, 0.75 * s, pt[0], pt[1], pt[2], p.roll + p.age * 9);
        let L = sp * 0.05; if (L > p.dist) L = p.dist;
        d.ribbon(q.x - dx * (L + 0.3), q.y - dy * (L + 0.3), q.z - dz * (L + 0.3), dx * L, dy * L, dz * L, 0.26, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7);
        d.sprite(q.x - dx * 0.35 * s, q.y - dy * 0.35 * s, q.z - dz * 0.35 * s, 0.8 * s, c[0], c[1], c[2]);
        break;
      }
      default: {   // grenade: tumbling block with a blink that speeds up as the fuse runs down
        const c = TUNE.flame[f], pt = TUNE.paint[f];
        const a = p.rest ? p.roll : p.roll + p.age * 11;
        d.solid(q.x, q.y + 0.12, q.z, Math.sin(a), 0, Math.cos(a), 0.2, 0.2, 0.32, pt[0], pt[1], pt[2], a * 0.7);
        const left = p.life - p.age, hz = left < 0.6 ? 14 : left < 1.2 ? 7 : 3.5;
        if (Math.sin(p.age * hz * 6.2832) > 0) d.sprite(q.x, q.y + 0.25, q.z, 0.4, c[0], c[1], c[2]);
      }
    }
  }
  d.end();
  stats.glow = d.glowCount; stats.bodies = d.bodyCount;
}

const combat = {
  name: 'combat',
  WEAPONS, HP_ASSUMED, ARMOR_CLASS, TUNE, MAX,
  beams,                      // live beams: entries with ttl > 0 are firing { id, shooter, team, ox,oy,oz, dx,dy,dz, len, hit }
  _slotNow: null,
  projectiles: live,          // live list: { id, kind, pos, vel, team, target, shooter, age, life } — read only, do not keep references
  stats,

  init() {
    if (!pool.length) for (let i = 0; i < MAX; i++) pool.push(makeProj(i));
    for (let i = 0; i < MAX; i++) { pool[i].active = false; free[i] = MAX - 1 - i; }
    top = MAX; live.length = 0;
    if (!draw) draw = createDraw(MAX * 2 + 64, MAX);
    if (G.scene) draw.attach(G.scene);
    this.draw = draw;
  },

  reset() {
    epoch++;
    for (let i = 0; i < live.length; i++) { const p = live[i]; p.active = false; p.target = null; p.shooter = null; free[top++] = p.slot; }
    live.length = 0; stats.live = 0;
    for (let i = 0; i < BEAMS; i++) { beams[i].ttl = 0; beams[i].w = null; beams[i].shooter = null; }
    if (warnOn) { warnOn = false; bus.emit('lock:warning', { on: false }); }
    if (draw) { draw.begin(); draw.end(); if (G.scene && !draw.glow.parent) draw.attach(G.scene); }
  },

  createWeapon(id) {
    let def = WEAPONS[id];
    if (!def) { console.warn('combat: unknown weapon', id); def = WEAPONS.rifle; id = 'rifle'; }
    return makeWeapon(id, def, this);
  },

  // Launch one projectile of weapon `id` (no ammo, heat or cooldown: that is the weapon state's job).
  //   opts { target (homing), spread (rad), team (when there is no shooter), friendlyFire, damageMul, speedMul, silent }
  fireProjectile(id, shooter, origin, dir, opts) {
    const def = WEAPONS[id]; if (!def) return null;
    if (def.beam) {            // replay of one beam tick (the 'beam' event of another peer): keeps the beam alive ~0.16 s
      this._beam(shooter || def, def, shooter || null, origin, dir, true, false, opts && opts.slot, !!(opts && opts.remote));
      return null;
    }
    _d.copy(dir); if (_d.lengthSq() < 1e-12) return null; _d.normalize();
    if (opts && opts.spread) spreadDir(_d, _v.copy(_d), opts.spread);
    return this._launch(def, shooter || null, origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, opts ? opts.target || (opts.targets && opts.targets[0]) || null : null, opts || null);
  },

  _launch(def, shooter, ox, oy, oz, dx, dy, dz, target, opts) {
    if (top <= 0) { stats.dropped++; return null; }
    const p = pool[free[--top]];
    p.active = true; p.uid = ++uid; p.id = def.id; p.def = def; p.kind = def.proj; p.k = KI[def.proj];
    p.shooter = shooter;
    p.team = shooter ? shooter.team : opts && opts.team != null ? opts.team : -1;
    p.faction = p.team >= 0 ? p.team : def.faction;
    p.ignoreTeam = (opts && opts.friendlyFire) || p.team < 0 ? null : p.team;
    p.speed = def.speed * (opts && opts.speedMul ? opts.speedMul : 1);
    p.pos.set(ox, oy, oz); p.vel.set(dx * p.speed, dy * p.speed, dz * p.speed);
    p.target = def.turnRate && target && target.alive !== false ? target : null;
    p.age = 0; p.life = p.k === K_GRENADE ? def.fuse : def.life; p.dist = 0; p.pen = 0; p.trail = 0; p.rest = false; p.tHas = false;
    p.tvx = p.tvy = p.tvz = 0;
    p.dmgMul = opts && opts.damageMul ? opts.damageMul : 1;
    p.remote = !!(opts && opts.remote);
    const seed = opts && opts.seed ? opts.seed >>> 0 : ((rng() * 4294967296) >>> 0) || 1;
    p.seed = seed;
    p.ph1 = prand(p) * 6.2832; p.ph2 = prand(p) * 6.2832; p.w1 = 6 + prand(p) * 5; p.w2 = 5 + prand(p) * 6; p.roll = prand(p) * 6.2832; p.spin = (prand(p) - 0.5) * 8;
    const slot = this._slotNow || (opts && opts.slot) || null; this._slotNow = null;
    live.push(p);
    stats.fired++;
    if (!(opts && opts.silent)) bus.emit('shot', { weapon: def.id, x: ox, y: oy, z: oz, dx, dy, dz, shooter, team: p.team, kind: def.proj, slot, target: p.target, seed, remote: p.remote, child: !!(opts && opts.child) });
    return p;
  },

  // Continuous beam, called by a beam weapon's fire() every frame it is held. `tick` = apply damage / cut this call.
  _beam(w, def, shooter, origin, dir, tick, starting, slot, remote) {
    let b = null; if (slot === undefined) slot = w.slot || null;
    for (let i = 0; i < BEAMS; i++) if (beams[i].w === w && beams[i].slot === slot) { b = beams[i]; break; }
    if (!b) for (let i = 0; i < BEAMS; i++) if (beams[i].ttl <= 0) { b = beams[i]; break; }
    if (!b) return;
    const l = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z) || 1;
    b.slot = slot; b.remote = !!remote;
    b.w = w; b.def = def; b.id = def.id; b.shooter = shooter; b.team = shooter ? shooter.team : -1; b.faction = b.team >= 0 ? b.team : def.faction;
    b.ox = origin.x; b.oy = origin.y; b.oz = origin.z; b.dx = dir.x / l; b.dy = dir.y / l; b.dz = dir.z / l;
    if (b.ttl <= 0) { b.len = 0; b.hit = false; }
    b.ttl = 1.6 / def.rate;
    if (!tick) return;
    if (starting) bus.emit('shot', { weapon: def.id, x: b.ox, y: b.oy, z: b.oz, dx: b.dx, dy: b.dy, dz: b.dz, shooter, team: b.team, kind: 'beam', slot, target: null, seed: 0, remote: b.remote });
    if (!b.remote && online()) bus.emit('beam', { weapon: def.id, x: b.ox, y: b.oy, z: b.oz, dx: b.dx, dy: b.dy, dz: b.dz, shooter, team: b.team, slot });   // one per damage tick, for NET to replay
    const gr = castBeam(b), gHit = gr.hit, gd = gHit ? gr.dist : def.range;
    const gx = gr.x, gy = gr.y, gz = gr.z, nx = gr.nx, ny = gr.ny, nz = gr.nz, mat = gr.mat, vi = gr.i, vj = gr.j, vk = gr.k;
    const eh = sweepEnts(b.ox, b.oy, b.oz, b.dx, b.dy, b.dz, gd, shooter, b.team < 0 ? null : b.team, def.pad || 0);
    let ex, ey, ez;
    if (eh) {
      ex = eh.x; ey = eh.y; ez = eh.z; const ent = eh.ent;
      const dmg = mayDamage(b, ent) ? shieldAbsorb(ent, def.damage * penFor(def, ent), -b.dx, -b.dz, ex, ey, ez) : 0;
      stats.hits++;
      if (dmg > 0) G.ents.damage(ent, dmg, { type: 'pulse', src: shooter, x: ex, y: ey, z: ez, dx: b.dx, dy: b.dy, dz: b.dz, weapon: def.id });
      emitImpact(b, ex, ey, ez, -b.dx, -b.dy, -b.dz, 0, ent);
    } else if (gHit) {
      ex = gx; ey = gy; ez = gz;
      if (!b.remote) G.destruct.impact((vi + 0.5) * VS - b.dx * 0.2, (vj + 0.5) * VS - b.dy * 0.2, (vk + 0.5) * VS - b.dz * 0.2, b.dx, b.dy, b.dz, def.world.power, def.world.radius, impactOpts(shooter, !!def.world.fire));
      emitImpact(b, ex, ey, ez, nx, ny, nz, mat, null);
    } else { ex = b.ox + b.dx * gd; ey = b.oy + b.dy * gd; ez = b.oz + b.dz * gd; }
    b.len = eh ? eh.dist : gd; b.hit = !!eh || gHit;
    if (G.fx && G.fx.beam) G.fx.beam(b.ox, b.oy, b.oz, ex, ey, ez, 'lance');
  },
  _recoil(def, shooter, origin, dir) {
    bus.emit('weapon:recoil', { weapon: def.id, shooter, strength: def.recoil, x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z });
    bus.emit('shake', { amount: 0.5 * def.recoil, x: origin.x, y: origin.y, z: origin.z });
  },

  playerEnt() { return G.state.player.ent || (G.player && G.player.ent) || null; },

  throwObject(chunk, origin, vel, owner) {
    const D = G.destruct;
    if (chunk && D && D.releaseChunk) return D.releaseChunk(chunk, origin, vel, owner || null);
    return null;
  },

  update(dt) {
    const t0 = performance.now();
    if (dt > 0 && live.length) {
      const ep = epoch;
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        if (p.active) {
          let n = 1;
          if (p.k >= K_MISSILE || p.target) {
            const T = p.target;
            if (T) {                                         // target velocity from its own motion (owners need not maintain ent.vel)
              const tx = T.pos.x, ty = T.pos.y + T.height * 0.5, tz = T.pos.z;
              if (p.tHas) { p.tvx = (tx - p.tx) / dt; p.tvy = (ty - p.ty) / dt; p.tvz = (tz - p.tz) / dt; }
              else if (T.vel) { p.tvx = T.vel.x; p.tvy = T.vel.y; p.tvz = T.vel.z; }
              p.tx = tx; p.ty = ty; p.tz = tz; p.tHas = true;
            }
            n = dt > 0.034 ? 3 : dt > 0.018 ? 2 : 1;         // finer steering / arcs at low frame rates
          }
          const h = dt / n;
          for (let s = 0; s < n && p.active; s++) step(p, h);
          const tk = TRAIL[p.k];                             // smoke: FX wants position + velocity once a frame
          if (tk && p.active && !p.rest) G.fx.emit(tk, p.pos.x, p.pos.y, p.pos.z, p.vel.x, p.vel.y, p.vel.z, p.k === K_SHELL ? 1.2 : 1);
          if (ep !== epoch) return;                          // reset() ran inside an event handler
        }
        if (!p.active) {
          const last = live.pop(); if (last !== p) live[i] = last;
          p.target = null; p.shooter = null; free[top++] = p.slot;
        }
      }
    }
    // incoming-missile warning for the player
    const pe = G.state.player.ent || (G.player && G.player.ent) || null;
    let inbound = false;
    if (pe) for (let i = 0; i < live.length; i++) if (live[i].target === pe) { inbound = true; break; }
    if (inbound !== warnOn) { warnOn = inbound; bus.emit('lock:warning', { on: inbound, source: 'missile' }); }
    updateBeams(dt);
    render();
    stats.live = live.length; if (live.length > stats.peak) stats.peak = live.length;
    const ms = performance.now() - t0; stats.ms = stats.ms * 0.9 + ms * 0.1; if (ms > stats.msPeak) stats.msPeak = ms;
  },

  // ---- helpers for wielders (PLAYER / ENEMY) ---------------------------------
  // Launch direction for a ballistic weapon (e_shell, grenade) to land on `target`. `out` = unit dir; false if out of reach
  // (then `out` is the 45° maximum-range attempt). high=true picks the mortar arc.
  aimBallistic(id, origin, target, out, high) {
    const def = WEAPONS[id], v = def.speed, g = def.gravity || 0;
    const dx = target.x - origin.x, dz = target.z - origin.z, dy = target.y - origin.y, x = Math.sqrt(dx * dx + dz * dz);
    if (x < 1e-4 || g <= 0) { out.set(dx, dy, dz).normalize(); return true; }
    const disc = v * v * v * v - g * (g * x * x + 2 * dy * v * v);
    let ok = true, tan;
    if (disc < 0) { ok = false; tan = 1; } else tan = (v * v + (high ? 1 : -1) * Math.sqrt(disc)) / (g * x);
    const c = 1 / Math.sqrt(1 + tan * tan);
    out.set(dx / x * c, tan * c, dz / x * c);
    return ok;
  },
  // Unit direction that leads a moving entity for weapon `id` (straight-flying projectiles). tvel optional (defaults ent.vel).
  lead(id, origin, ent, out, tvel) {
    const def = WEAPONS[id], tv = tvel || ent.vel, sp = def.maxSpeed ? (def.speed + def.maxSpeed) * 0.5 : def.speed;
    let t = 0;
    for (let n = 0; n < 3; n++) {
      out.set(ent.pos.x + (tv ? tv.x * t : 0) - origin.x, ent.pos.y + ent.height * 0.5 + (tv ? tv.y * t : 0) - origin.y, ent.pos.z + (tv ? tv.z * t : 0) - origin.z);
      t = out.length() / sp;
    }
    return out.normalize();
  },
  ttk, shotsToKill,
  // { weaponId: { targetKind: seconds } } against HP_ASSUMED
  ttkTable() {
    const o = {};
    for (const id in WEAPONS) { if (WEAPONS[id].hidden) continue; o[id] = {}; for (const k in HP_ASSUMED) { const t = ttk(id, k); o[id][k] = isFinite(t) ? +t.toFixed(2) : null; } }
    return o;
  },
};
export default combat;
