// COMBAT harness library: dummy targets, auto-firing gunners, numeric tests (KT.ct.*) and look-dev demos (?demo=…).
import { G, THREE, bus, VS } from '../src/core.js';
import { M, SOLID } from '../src/materials.js';

const DIM = { pilot: [0.35, 1.8], soldier: [0.35, 1.8], mech: [1.8, 8.5], emech: [1.8, 8.5], tank: [2.2, 2.6], drone: [0.9, 0.7], gunship: [3.2, 2.6] };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const dummies = [], gunners = [];
let C, log = [];
const geo = new THREE.BoxGeometry(1, 1, 1);
const mats = [new THREE.MeshStandardMaterial({ color: 0x3f6f78, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x7a2f2a, roughness: 0.6 })];

export function mk(kind, x, y, z, o = {}) {
  const d = DIM[kind] || DIM.soldier;
  const e = { kind, team: o.team == null ? 1 : o.team, pos: V(x, y, z), radius: d[0], height: d[1], hp: o.hp || C.HP_ASSUMED[o.hpKind || kind] || 100, airborne: kind === 'drone' || kind === 'gunship', mover: o.mover || null, t: 0 };
  if (o.invuln) e.invuln = true;
  G.ents.add(e);
  e.mesh = new THREE.Mesh(geo, mats[e.team]); e.mesh.scale.set(d[0] * 2, d[1], d[0] * 2); G.scene.add(e.mesh);
  dummies.push(e); sync(e); return e;
}
function sync(e) { e.mesh.position.set(e.pos.x, e.pos.y + e.height / 2, e.pos.z); e.mesh.visible = e.alive; }
export function clear() {
  for (const e of dummies) { G.ents.remove(e); e.mesh.removeFromParent(); }
  dummies.length = 0; gunners.length = 0; C.reset(); G.state.player.ent = null;
}
export function wall(x0, y0, z0, x1, y1, z1, mat) {
  let n = 0;
  for (let j = Math.floor(y0 / VS); j < Math.round(y1 / VS); j++) for (let k = Math.floor(z0 / VS); k < Math.round(z1 / VS); k++) for (let i = Math.floor(x0 / VS); i < Math.round(x1 / VS); i++) if (G.grid.set(i, j, k, mat)) n++;
  return n;
}
function solidIn(x0, y0, z0, x1, y1, z1) {
  let n = 0;
  for (let j = Math.floor(y0 / VS); j < Math.round(y1 / VS); j++) for (let k = Math.floor(z0 / VS); k < Math.round(z1 / VS); k++) for (let i = Math.floor(x0 / VS); i < Math.round(x1 / VS); i++) if (SOLID[G.grid.get(i, j, k)]) n++;
  return n;
}
// A gunner holds the trigger of weapon `id` from a fixed origin at a point / entity.
export function gunner(id, shooter, origin, aim, o = {}) {
  const g = { w: C.createWeapon(id), id, shooter, origin: origin.clone(), aim, on: true, fired: 0, firstT: -1, lastT: -1, dir: V(0, 0, 1), o };
  gunners.push(g); return g;
}
const _a = V(0, 0, 0), _b = V(0, 0, 0);
function tick(dt) {
  for (const e of dummies) { if (e.alive && e.mover) { e.t += dt; _a.copy(e.pos); e.mover(e, dt); if (dt > 0) e.vel.copy(e.pos).sub(_a).divideScalar(dt); } sync(e); }
  for (const g of gunners) {
    g.w.update(dt);
    if (!g.on || (g.shooter && !g.shooter.alive)) continue;
    const a = g.aim;
    if (a.isVector3) g.dir.copy(a).sub(g.origin).normalize();
    else if (a.pos) { if (g.o.lead) C.lead(g.id, g.origin, a, g.dir); else g.dir.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z).sub(g.origin).normalize(); }
    else g.dir.copy(a.dir);
    if (g.o.ballistic) C.aimBallistic(g.id, g.origin, a.isVector3 ? a : _a.set(a.pos.x, a.pos.y, a.pos.z), g.dir);
    if (g.o.aimAt) { const t = g.o.aimAt; (g.o.fire || (g.o.fire = {})).aim = t.isVector3 ? t : _b.set(t.pos.x, t.pos.y, t.pos.z); }
    if (g.o.max && g.fired >= g.o.max) continue;
    if (g.w.canFire()) {
      const o = g.origin;
      if (g.w.def.barrels === 2) {      // twin muzzles 1.6 m either side, converging on the aim point
        _a.set(g.dir.z, 0, -g.dir.x).normalize().multiplyScalar(g.w.side === 'L' ? 1.6 : -1.6).add(o);
        if (a.isVector3) g.dir.copy(a).sub(_a).normalize(); else if (a.pos && !g.o.lead) g.dir.set(a.pos.x, a.pos.y + a.height * 0.5, a.pos.z).sub(_a).normalize();
      } else _a.copy(o);
      if (g.w.fire(g.shooter, _a, g.dir, g.o.fire)) { g.fired++; if (g.firstT < 0) g.firstT = G.time; g.lastT = G.time; }
    }
  }
}
const run = (sec, dt, until) => { const n = Math.ceil(sec / dt); for (let i = 0; i < n; i++) { G.debugStep(1, dt); if (until && until()) return (i + 1) * dt; } return -1; };
const drain = (dt = 1 / 60) => run(14, dt, () => C.projectiles.length === 0);
const r2 = x => Math.round(x * 100) / 100;

// ---------------------------------------------------------------------------------------------------------
const T = {
  // every weapon at a brick wall: voxels removed, pool drains
  walls(dt = 1 / 60) {
    const out = {};
    for (const id in C.WEAPONS) {
      clear(); G.grid.restore();
      wall(36, 2, 40, 48, 9, 41, M.brick_red);
      const before = solidIn(30, 0.5, 34, 54, 12, 47);
      const s = mk('pilot', 42, 2, 20, { team: id[1] === '_' ? 1 : 0, invuln: true });
      const aim = V(42, 5, 40), org = V(42, 3.5, 20);
      const g = gunner(id, s, org, aim, { ballistic: !!C.WEAPONS[id].gravity });
      run(1.0, dt); g.on = false;
      const peak = C.stats.peak; const t = drain(dt);
      out[id] = { shots: g.fired, voxels: before - solidIn(30, 0.5, 34, 54, 12, 47), drained: t >= 0, live: C.projectiles.length };
    }
    clear(); G.grid.restore();
    return out;
  },
  // nothing gets through a 0.5 m indestructible wall, nothing skips a thin target, at any step size
  tunnel(dt = 1 / 20) {
    const out = { dt: r2(dt) };
    for (const id in C.WEAPONS) {
      const def = C.WEAPONS[id];
      clear(); G.grid.restore();
      wall(20, 2, 50.5, 64, 30, 51, M.bedrock);
      const victim = mk('mech', 42, 2, 62, { team: id[1] === '_' ? 0 : 1, hp: 1e6 });
      const s = mk('pilot', 42, 2, 20, { team: id[1] === '_' ? 1 : 0, invuln: true });
      let fired = 0, maxZ = 0;
      for (let n = 0; n < 10; n++) {
        const g = gunner(id, s, V(40 + n * 0.37, 3.2 + n * 0.21, 20 + n * 0.613), V(42 + n * 0.3 - 1.5, 4 + n * 0.5, 50.5), { ballistic: !!def.gravity });
        run(def.kind === 'auto' || def.kind === 'heat' ? 0.5 : 0.3, dt, () => { for (const p of C.projectiles) if (p.pos.z > maxZ) maxZ = p.pos.z; });
        g.on = false; fired += g.fired;
        run(12, dt, () => { for (const p of C.projectiles) if (p.pos.z > maxZ) maxZ = p.pos.z; return C.projectiles.length === 0; });
        gunners.length = 0;
      }
      out[id] = { fired, maxZ: r2(maxZ), dmgBehindWall: r2(1e6 - victim.hp), ok: maxZ <= 50.51 && victim.hp === 1e6 };
    }
    // thin target, fastest bullets: every round must connect
    clear(); G.grid.restore();
    const hit = {};
    for (const id of ['rifle', 'pulse', 'e_chain', 'e_rifle']) {
      clear();
      const tgt = mk('soldier', 42, 2, 75, { team: id[1] === '_' ? 0 : 1, hp: 1e6 });
      const s = mk('pilot', 42, 2, 20, { team: id[1] === '_' ? 1 : 0, invuln: true });
      let n = 0;
      for (let i = 0; i < 40; i++) { C.fireProjectile(id, s, V(42, 3, 20 + i * 0.731), V(0, 0, 1)); n++; run(0.1, dt); }
      drain(dt);
      const per = C.WEAPONS[id].damage + (C.WEAPONS[id].splash ? 0 : 0);
      hit[id] = { fired: n, hits: Math.round((1e6 - tgt.hp) / per) };
    }
    out.thinTarget = hit; clear(); G.grid.restore();
    return out;
  },
  // simulated time-to-kill (trigger held, target 30 m away) against the analytic table
  ttk(dt = 1 / 60) {
    const out = {};
    const pairs = [['rifle', 'soldier'], ['rifle', 'drone'], ['launcher', 'soldier'], ['launcher', 'tank'], ['launcher', 'emech'], ['pulse', 'soldier'], ['pulse', 'tank'], ['pulse', 'emech'],
      ['salvo', 'tank'], ['salvo', 'emech'], ['skylance', 'drone'], ['skylance', 'gunship'], ['e_rifle', 'pilot'], ['e_rpg', 'pilot'], ['e_rpg', 'mech'], ['e_shell', 'mech'], ['e_chain', 'pilot'], ['e_chain', 'mech'],
      ['e_drone', 'pilot'], ['e_gsrocket', 'mech'], ['e_pulse', 'mech'], ['e_pulse', 'pilot'], ['e_salvo', 'mech']];
    for (const [id, kind] of pairs) {
      clear(); const def = C.WEAPONS[id];
      const enemyW = id[1] === '_', air = kind === 'drone' || kind === 'gunship';
      const tgt = mk(kind, 42, air ? 22 : 2, 52, { team: enemyW ? 0 : 1 });
      const s = mk('pilot', 42, 2, 20, { team: enemyW ? 1 : 0, invuln: true });
      const g = gunner(id, s, V(42, 3.4, 22), tgt, { ballistic: !!def.gravity, fire: { targets: [tgt] } });
      const sp0 = def.spread, bl0 = def.bloom, wb0 = def.wobble; def.spread = 0; def.bloom = 0; def.wobble = 0;   // exact aim: spread changes who you hit, not how hard
      const hp0 = tgt.hp;
      const t = run(60, dt, () => !tgt.alive);
      def.spread = sp0; def.bloom = bl0; def.wobble = wb0;
      const sim = t < 0 ? null : r2(G.time - g.firstT);
      out[id + '>' + kind] = { hp: hp0, sim, fired: g.fired, table: r2(C.ttk(id, kind)), shotsTable: C.shotsToKill(id, kind) };
    }
    clear();
    return out;
  },
  // Skylance against aircraft that cross, flee, close and weave; lock loss; pool drains
  homing(dt = 1 / 60) {
    const out = {};
    const cases = {
      crossing: e => { e.pos.x += 28 * (1 / 1) * e.dtv; },
      crossingFast: e => { e.pos.x += 40 * e.dtv; },
      fleeing: e => { e.pos.z += 30 * e.dtv; },
      closing: e => { e.pos.z -= 30 * e.dtv; },
      weaving: e => { e.pos.x += 24 * e.dtv; e.pos.y = 45 + Math.sin(e.t * 2.2) * 6; e.pos.z = 110 + Math.cos(e.t * 1.7) * 8; },
      behind: e => { e.pos.z = -20; e.pos.x += 20 * e.dtv; },
      orbit: e => { e.pos.x = 60 + Math.cos(e.t * 0.5) * 50; e.pos.z = 80 + Math.sin(e.t * 0.5) * 50; },
    };
    for (const name in cases) {
      clear();
      const f = cases[name];
      const tgt = mk('gunship', name === 'closing' ? 60 : 10, 45, name === 'closing' ? 170 : 110, { hp: 250, mover: (e, d) => { e.dtv = d; f(e); } });
      const s = mk('mech', 60, 2, 30, { team: 0, invuln: true });
      const w = C.createWeapon('skylance');
      const hp0 = tgt.hp;
      w.fire(s, V(60, 11, 30), V(0, 0.8, 0.6).normalize(), { targets: [tgt] });
      const t = run(9, dt, () => !tgt.alive);
      const tDrain = drain(dt);
      out[name] = { killed: !tgt.alive, t: r2(t), dmg: r2(hp0 - tgt.hp), drained: tDrain >= 0 };
    }
    // four targets, one pull
    clear();
    const s = mk('mech', 60, 2, 30, { team: 0, invuln: true });
    const ds = [0, 1, 2, 3].map(i => mk('drone', 20 + i * 25, 30 + i * 4, 100 + i * 6, { mover: (e, d) => { e.pos.x += (i % 2 ? -12 : 12) * d; } }));
    const w = C.createWeapon('skylance'); gunners.push({ w, on: false });
    const f0 = C.stats.fired;
    w.fire(s, V(60, 11, 30), V(0, 0.8, 0.6).normalize(), { targets: ds });
    run(8, dt, () => ds.every(d => !d.alive));
    out.multi = { killed: ds.filter(d => !d.alive).length, missiles: C.stats.fired - f0, chargeLeft: r2(w.charge), shots: w.shots };
    drain(dt);
    // lock lost when the target dies mid-flight: missile flies on and is cleaned up
    clear();
    const s2 = mk('mech', 60, 2, 30, { team: 0, invuln: true }), d2 = mk('drone', 60, 40, 150);
    const w2 = C.createWeapon('skylance'); w2.fire(s2, V(60, 11, 30), V(0, 0.8, 0.6).normalize(), { targets: [d2] });
    run(0.6, dt); const hadTarget = C.projectiles[0] && C.projectiles[0].target === d2;
    G.ents.damage(d2, 1e6, {}); run(0.2, dt);
    const lost = C.projectiles[0] ? C.projectiles[0].target === null : 'gone';
    out.lockLost = { hadTarget, lost, drained: drain(dt) >= 0, live: C.projectiles.length };
    // incoming warning for the player
    clear(); const ev = []; const h = bus.on('lock:warning', e => ev.push(e.on));
    const me = mk('mech', 60, 2, 120, { team: 0, hp: 1e5 }); G.state.player.ent = me;
    const gs = mk('gunship', 60, 40, 40, {});
    C.fireProjectile('e_gsrocket', gs, V(60, 39, 42), V(0, -0.3, 1), { target: me });
    run(8, dt, () => C.projectiles.length === 0); G.debugStep(2, dt);
    bus.off('lock:warning', h);
    out.warning = { events: ev, hit: r2(1e5 - me.hp) };
    clear();
    return out;
  },
  // Seeker (pilot AA): lock -> kill on crossing / fleeing aircraft, two targets per charge, pool drains
  seeker(dt = 1 / 60) {
    const out = { dt: r2(dt) };
    const cases = { crossing: (e, d) => { e.pos.x += 26 * d; }, fleeing: (e, d) => { if (e.pos.z < 185) e.pos.z += 24 * d; else e.pos.x += 24 * d; }, weaving: (e, d) => { e.pos.x += 18 * d; e.pos.y = 30 + Math.sin(e.t * 2.5) * 5; } };
    for (const kind of ['drone', 'gunship']) for (const name in cases) {
      clear();
      const tgt = mk(kind, 15, 30, 90, { mover: cases[name] }), s = mk('pilot', 60, 2, 30, { team: 0, invuln: true });
      const g = gunner('seeker', s, V(60, 3.6, 30), { dir: V(0, 0.7, 0.7).normalize() }, { fire: { targets: [tgt] } });
      const t = run(20, dt, () => !tgt.alive); g.on = false;
      out[kind + ':' + name] = { killed: !tgt.alive, t: r2(t), missiles: g.fired, drained: drain(dt) >= 0, live: C.projectiles.length };
    }
    clear();
    const s = mk('pilot', 60, 2, 30, { team: 0, invuln: true }), a = mk('drone', 30, 28, 90, { mover: (e, d) => { e.pos.x += 14 * d; } }), b = mk('drone', 90, 34, 100, { mover: (e, d) => { e.pos.x -= 14 * d; } });
    const w = C.createWeapon('seeker'); gunners.push({ w, on: false });
    const f0 = C.stats.fired; w.fire(s, V(60, 3.6, 30), V(0, 0.7, 0.7).normalize(), { targets: [a, b] });
    const ch = r2(w.charge), can = w.canFire(); run(8, dt, () => !a.alive && !b.alive);
    let tr = 0; while (tr < 10 && w.charge < 1) { G.debugStep(1, dt); tr += dt; }
    out.pair = { killed: (!a.alive) + (!b.alive), missiles: C.stats.fired - f0, chargeAfter: ch, canFireAfter: can, rechargeFull: r2(tr + 0), maxLocks: w.maxLocks, lockTime: w.lockTime, lockRange: w.lockRange, drained: drain(dt) >= 0 };
    const e = mk('emech', 60, 2, 70, {}); C.fireProjectile('seeker', s, V(60, 3.6, 30), V(0, 0.05, 1).normalize(), { target: e }); drain(dt);
    out.rigDamage = r2(1500 - e.hp); clear();
    return out;
  },
  // ---- phase B: Rig Bay weapons -------------------------------------------------------------------------
  bayTtk(dt = 1 / 60) {
    const out = { dt: r2(dt) };
    for (const id of ['autocannon', 'lance', 'siege', 'swarm', 'mortar']) for (const kind of ['soldier', 'drone', 'tank', 'gunship', 'emech']) {
      clear(); const def = C.WEAPONS[id], air = kind === 'drone' || kind === 'gunship';
      if (id === 'mortar' && air) { out[id + '>' + kind] = 'n/a (lobbed at the ground)'; continue; }
      const tgt = mk(kind, 42, air ? 14 : 2, 52, {}), s = mk('mech', 42, 2, 14, { team: 0, invuln: true });
      const g = gunner(id, s, V(42, 8, 17), tgt, { fire: { targets: [tgt] }, aimAt: id === 'mortar' ? tgt : null });
      const sv = [def.spread, def.bloom, def.lobScatter]; def.spread = 0; def.bloom = 0; if (def.lob) def.lobScatter = 0;
      const t = run(60, dt, () => !tgt.alive); g.on = false;
      def.spread = sv[0]; def.bloom = sv[1]; if (def.lob) def.lobScatter = sv[2];
      out[id + '>' + kind] = { sim: t < 0 ? null : r2(G.time - g.firstT), pulls: g.fired, table: r2(C.ttk(id, kind)), n: C.shotsToKill(id, kind), drained: drain(dt) >= 0 };
    }
    clear(); G.grid.restore(); return out;
  },
  // autocannon spin-up, lance heat, siege recoil event, swarm 6 ground locks, opts.slot
  bayWeapons(dt = 1 / 60) {
    const out = {}; clear();
    const s = mk('mech', 42, 2, 20, { team: 0, invuln: true }), up = V(0, 1, 0.02).normalize();
    { const w = C.createWeapon('autocannon'); let n = 0, t = 0; const at = [];
      while (t < 2) { if (w.fire(s, V(42, 8, 20), up, { slot: 'armL' })) n++; w.update(dt); G.debugStep(1, dt); t += dt; if (Math.abs(t - 0.3) < dt / 2 || Math.abs(t - 1) < dt / 2 || Math.abs(t - 2) < dt / 2) at.push([r2(t), n, r2(w.rateNow), r2(w.spin)]); }
      out.autocannon = { 't,shots,rate,spin': at, slot: w.slot, clip: w.clip }; }
    { const w = C.createWeapon('lance'); let t = 0, ticks = 0, tHot = -1, tOk = -1;
      while (t < 9) { if (w.fire(s, V(42, 8, 20), up, { slot: 'armR' })) ticks++; w.update(dt); G.debugStep(1, dt); t += dt; if (w.overheated && tHot < 0) tHot = t; if (tHot >= 0 && !w.overheated) { tOk = t; break; } }
      out.lance = { ticksToOverheat: ticks, tOverheat: r2(tHot), lockout: r2(tOk - tHot), beamsLive: C.beams.filter(b => b.ttl > 0).length }; G.debugStep(20, dt); out.lance.beamsAfter = C.beams.filter(b => b.ttl > 0).length; }
    { const ev = []; const h = bus.on('weapon:recoil', e => ev.push([e.weapon, e.strength]));
      const w = C.createWeapon('siege'); const a = w.fire(s, V(42, 8, 20), up), b = w.fire(s, V(42, 8, 20), up); let t = 0; while (t < 8 && !w.canFire()) { w.update(dt); G.debugStep(1, dt); t += dt; }
      bus.off('weapon:recoil', h); out.siege = { first: a, second: b, recharge: r2(t), recoil: ev }; }
    { const w = C.createWeapon('swarm'); gunners.push({ w, on: false });
      const ts = [0, 1, 2, 3, 4, 5].map(i => mk(i < 4 ? 'soldier' : 'drone', 20 + i * 9, i < 4 ? 2 : 20, 70 + (i % 3) * 8, { mover: (e, d) => { e.pos.x += (i % 2 ? 4 : -4) * d; } }));
      const f0 = C.stats.fired; w.fire(s, V(42, 10, 20), V(0, 0.8, 0.6).normalize(), { targets: ts, slot: 'shR' });
      run(6, dt, () => ts.every(e => !e.alive));
      out.swarm = { killed: ts.filter(e => !e.alive).length, missiles: C.stats.fired - f0, charge: r2(w.charge), maxLocks: w.maxLocks, lockGround: w.lockGround, lockAir: w.lockAir, lockTime: w.lockTime, lockRange: w.lockRange, sky: [C.WEAPONS.skylance.lockGround, C.WEAPONS.skylance.lockAir] }; }
    out.drained = drain(dt) >= 0; clear(); return out;
  },
  // the lance cuts: fixed aim through a 1.5 m concrete wall, then a 2 s sweep along a 0.5 m wall
  lanceCarve(dt = 1 / 60) {
    const out = {}; clear(); G.grid.restore();
    wall(30, 2, 40, 54, 14, 41.5, M.concrete);
    const s = mk('mech', 42, 2, 20, { team: 0, invuln: true }), tgt = mk('tank', 42, 2, 50, { hp: 1e5 });
    const g = gunner('lance', s, V(42, 4, 22), V(42, 4, 40));
    let tThrough = -1; const b0 = solidIn(30, 2, 40, 54, 14, 41.5);
    run(2, dt, () => { if (tThrough < 0 && tgt.hp < 1e5) tThrough = G.time - g.firstT; });
    out.fixed = { cut: b0 - solidIn(30, 2, 40, 54, 14, 41.5) + 0, secondsToCutThrough1m5: r2(tThrough), dmgBehindAfter: r2(1e5 - tgt.hp) };
    clear(); G.grid.restore(); wall(30, 2, 40, 54, 14, 40.5, M.concrete);
    const s2 = mk('mech', 42, 2, 20, { team: 0, invuln: true }); const aim = V(38, 6, 40); const g2 = gunner('lance', s2, V(42, 6, 22), aim);
    run(2, dt, () => { aim.x += 4 * dt; });
    let n = 0, i0 = 1e9, i1 = -1; for (let j = 4; j < 28; j++) for (let i = 60; i < 108; i++) if (!SOLID[G.grid.get(i, j, 80)]) { n++; if (i < i0) i0 = i; if (i > i1) i1 = i; }
    out.sweep = { ticks: g2.fired, cutVoxels: n, slotLength: n ? (i1 - i0 + 1) * VS : 0 };
    // never through bedrock
    clear(); G.grid.restore(); wall(30, 2, 40, 54, 14, 40.5, M.bedrock);
    const s3 = mk('mech', 42, 2, 20, { team: 0, invuln: true }), t3 = mk('tank', 42, 2, 46, { hp: 1e5 }); gunner('lance', s3, V(42, 4, 22), V(42, 4, 40)); run(1.5, 1 / 20);
    out.bedrock = { dmgBehind: 1e5 - t3.hp, len: r2(Math.max(...C.beams.map(b => b.ttl > 0 ? b.len : 0))) };
    clear(); G.grid.restore(); return out;
  },
  // mortar over a 16 m building onto an aim point behind it
  mortarBehind(dt = 1 / 60) {
    clear(); G.grid.restore();
    wall(30, 2, 44, 54, 18, 50, M.bedrock);
    const s = mk('mech', 42, 2, 24, { team: 0, invuln: true }), aim = V(42, 2, 62), tgt = mk('tank', 42, 2, 62, { hp: 1e5 });
    const ex = []; const h = bus.on('explosion', e => ex.push(e));
    const w = C.createWeapon('mortar'); gunners.push({ w, on: false });
    const f0 = C.stats.fired; const ok = w.fire(s, V(42, 11, 24), V(0, 0.3, 1).normalize(), { aim, slot: 'shL' });
    let peak = 0; const t = run(14, dt, () => { for (const p of C.projectiles) if (p.pos.y > peak) peak = p.pos.y; return C.stats.fired - f0 >= 3 && C.projectiles.length === 0; });
    bus.off('explosion', h);
    const d = ex.map(e => Math.hypot(e.x - aim.x, e.z - aim.z));
    const out = { fired: ok, projectiles: C.stats.fired - f0, explosions: ex.length, behindBuilding: ex.filter(e => e.z > 50).length, meanMiss: r2(d.reduce((a, b) => a + b, 0) / (d.length || 1)), maxMiss: r2(Math.max(...d)), peakY: r2(peak), flight: r2(t), dmgToTankAtAim: r2(1e5 - tgt.hp), drained: C.projectiles.length === 0, recharge: C.WEAPONS.mortar.recharge };
    clear(); G.grid.restore(); return out;
  },
  // ent.shield: absorbs from the front arc, not from behind; overflow passes; 'shield:hit'
  shield(dt = 1 / 60) {
    const out = {}; const ev = []; const h = bus.on('shield:hit', e => ev.push(e.amount));
    for (const [name, yaw] of [['front', Math.PI], ['back', 0], ['side', Math.PI / 2]]) {
      const r = {};
      for (const id of ['rifle', 'pulse', 'autocannon', 'lance', 'launcher', 'siege', 'swarm']) {
        clear(); ev.length = 0;
        const e = mk('emech', 42, 2, 50, { hp: 1e5 }); e.shield = { on: true, yaw, arc: 2.1, hp: 1e4 };
        const s = mk('mech', 42, 2, 20, { team: 0, invuln: true });
        const g = gunner(id, s, V(42, 6, 23), V(42, 6, 50), { max: id === 'lance' ? 5 : 1, fire: { targets: [e] } }); run(0.6, dt); g.on = false; drain(dt);
        r[id] = { hp: r2(1e5 - e.hp), shield: r2(1e4 - e.shield.hp), events: ev.length };
      }
      out[name] = r;
    }
    // overflow + shield off
    clear(); ev.length = 0;
    const e = mk('emech', 42, 2, 50, { hp: 1e5 }); e.shield = { on: true, yaw: Math.PI, arc: 2.1, hp: 10 };
    const s = mk('mech', 42, 2, 20, { team: 0, invuln: true });
    C.fireProjectile('pulse', s, V(42, 6, 23), V(0, 0, 1)); drain(dt);
    out.overflow = { hp: r2(1e5 - e.hp), shieldLeft: e.shield.hp, absorbed: ev.slice() };
    e.shield.hp = 1e4; e.shield.on = false; const hp0 = e.hp; C.fireProjectile('pulse', s, V(42, 6, 23), V(0, 0, 1)); drain(dt);
    out.lowered = { hp: r2(hp0 - e.hp) };
    bus.off('shield:hit', h); clear(); return out;
  },
  // ---- phase C: emplacement gun, dreadnought siege gun + swarm, blast perk --------------------------------
  vantaC(dt = 1 / 60) {
    const out = { dt: r2(dt) };
    // turret: bursts
    { clear(); const me = mk('pilot', 42, 2, 60, { team: 0, hp: 100 }), tu = mk('tank', 42, 2, 20, { hp: 1e9 });
      const d = C.WEAPONS.e_turret, sp = d.spread; d.spread = 0;
      const g = gunner('e_turret', tu, V(42, 5, 23), me); const t = run(20, dt, () => !me.alive); d.spread = sp;
      out.turret = { pilotTtk: r2(G.time - g.firstT), fired: g.fired, table: r2(C.ttk('e_turret', 'pilot')), mechTable: C.ttk('e_turret', 'mech') > 1e9 ? '>60' : r2(C.ttk('e_turret', 'mech')), drained: drain(dt) >= 0 }; }
    // siege: tell event, shell leaves after the windup, dodgeable, wrecks a wall
    { clear(); G.grid.restore(); wall(30, 2, 70, 54, 14, 71, M.concrete);
      const me = mk('mech', 42, 2, 64, { team: 0, hp: 1e5 }), boss = mk('emech', 42, 2, 10, { hp: 1e9 }); G.state.player.ent = me;
      const ev = []; const h = bus.on('weapon:tell', e => ev.push([e.weapon, e.time, e.shooter === boss]));
      const w = C.createWeapon('e_siege'); gunners.push({ w, on: false });
      const o = V(42, 9, 13), dir = V(0, 0, 0); C.aimBallistic('e_siege', o, V(42, 6, 64), dir);
      const f0 = C.stats.fired, t0 = G.time; const a = w.fire(boss, o, dir), b = w.fire(boss, o, dir);
      let tLeave = -1, tHit = -1, prog = 0; const b0 = solidIn(30, 2, 70, 54, 14, 71);
      run(12, dt, () => { if (w.windup > prog) prog = w.windup; if (tLeave < 0 && C.stats.fired > f0) tLeave = G.time - t0; if (tHit < 0 && me.hp < 1e5) tHit = G.time - t0; return tLeave >= 0 && C.projectiles.length === 0; });
      bus.off('weapon:tell', h);
      out.siege = { started: a, secondPull: b, tell: ev, tLeave: r2(tLeave), tHit: r2(tHit), flight: r2(tHit - tLeave), dmgDirect: r2(1e5 - me.hp), maxWindup: r2(prog) };
      { clear(); G.grid.restore(); wall(30, 2, 60, 54, 16, 60.5, M.concrete); const bb = mk('emech', 42, 2, 10, { hp: 1e9 }); const w0 = solidIn(30, 2, 60, 54, 16, 60.5);
        C.fireProjectile('e_siege', bb, V(42, 9, 13), V(0, 0.05, 1)); drain(dt); let i0 = 1e9, i1 = -1; for (let j = 4; j < 32; j++) for (let i = 60; i < 108; i++) if (!SOLID[G.grid.get(i, j, 120)]) { if (i < i0) i0 = i; if (i > i1) i1 = i; }
        out.siege.wallVoxels = w0 - solidIn(30, 2, 60, 54, 16, 60.5); out.siege.holeWidth = i1 >= 0 ? (i1 - i0 + 1) * VS : 0; G.grid.restore(); }
      // dodge: rig walks sideways at 9 m/s from the moment of the tell
      clear(); const me2 = mk('mech', 42, 2, 64, { team: 0, hp: 1e5, mover: (e, d) => { e.pos.x += 9 * d; } }), boss2 = mk('emech', 42, 2, 10, { hp: 1e9 });
      const w2 = C.createWeapon('e_siege'); gunners.push({ w: w2, on: false }); w2.fire(boss2, o, dir); run(12, dt, () => w2.windup === 0 && C.stats.fired > f0 + 1 && C.projectiles.length === 0);
      out.siege.dodgedDmg = r2(1e5 - me2.hp); out.siege.drained = C.projectiles.length === 0; }
    // swarm: auto-targets the player, full volley, lock warning
    { clear(); G.grid.restore(); const me = mk('mech', 42, 2, 70, { team: 0, hp: 1e5 }), boss = mk('emech', 42, 2, 10, { hp: 1e9 }); G.state.player.ent = me;
      const ev = []; const h = bus.on('lock:warning', e => ev.push(e.on));
      const w = C.createWeapon('e_swarm'); gunners.push({ w, on: false }); const f0 = C.stats.fired;
      w.fire(boss, V(42, 11, 12), V(0, 0.8, 0.6).normalize());
      run(12, dt, () => C.stats.fired - f0 >= 8 && C.projectiles.length === 0); G.debugStep(2, dt); bus.off('lock:warning', h);
      const hitStill = r2(1e5 - me.hp);
      // moving rig at dash speed sideways
      clear(); const me2 = mk('mech', 42, 2, 70, { team: 0, hp: 1e5, mover: (e, d) => { e.pos.x += 22 * d; } }), boss2 = mk('emech', 42, 2, 10, { hp: 1e9 }); G.state.player.ent = me2;
      const w3 = C.createWeapon('e_swarm'); gunners.push({ w: w3, on: false }); w3.fire(boss2, V(42, 11, 12), V(0, 0.8, 0.6).normalize()); run(12, dt, () => C.projectiles.length === 0 && w3.burstLeft === 0);
      out.swarm = { missiles: C.stats.fired - f0 - 8 === 8 ? 8 : C.stats.fired - f0, warning: ev, dmgStanding: hitStill, dmgDashing: r2(1e5 - me2.hp), charge: r2(w.charge), drained: drain(dt) >= 0 }; }
    // blast perk: radius only, team 0 only
    { const P = G.progress, had = P && P._mult.blast; const res = {};
      for (const [name, m, team] of [['base', 1, 0], ['perk', 1.15, 0], ['vantaWithPerk', 1.15, 1]]) {
        clear(); G.grid.restore(); if (P) P._mult.blast = m; wall(30, 2, 40, 54, 14, 40.5, M.brick_red);
        const s = mk('pilot', 42, 2, 20, { team, invuln: true }), near = mk('soldier', 42, 2, 37.2, { team: 1 - team, hp: 1e5 }), far = mk('soldier', 46.3, 2, 39.4, { team: 1 - team, hp: 1e5 });
        let rad = 0; const h = bus.on('explosion', e => { rad = e.radius; });
        const b0 = solidIn(30, 2, 40, 54, 14, 40.5); C.fireProjectile('launcher', s, V(42, 6, 22), V(0, 0, 1)); drain(dt); bus.off('explosion', h);
        res[name] = { radius: r2(rad), voxels: b0 - solidIn(30, 2, 40, 54, 14, 40.5), dmgAt3m: r2(1e5 - near.hp), dmgAtEdge: r2(1e5 - far.hp) };
      }
      if (P) { if (had) P._mult.blast = had; else delete P._mult.blast; }
      out.blastPerk = P ? res : 'G.progress missing'; }
    clear(); G.grid.restore(); return out;
  },
  // ---- phase D: co-op ownership matrix with a fake G.net ----------------------------------------------------
  coop(dt = 1 / 60) {
    const out = {}; const real = G.net; const claims = [];
    const fake = { online: true, localOwns: e => !e.remote, claimHit: (e, amount, info) => claims.push([e.tag, r2(amount), info.type]) };
    const scene = () => {
      clear(); G.grid.restore(); claims.length = 0; wall(30, 2, 60, 54, 12, 60.5, M.brick_red);
      const me = mk('mech', 36, 2, 50, { team: 0, hp: 1e5 }); me.tag = 'me';
      const mate = mk('mech', 48, 2, 50, { team: 0, hp: 1e5 }); mate.remote = true; mate.netOwner = 2; mate.tag = 'mate';
      const foe = mk('emech', 36, 2, 20, { team: 1, hp: 1e5 }); foe.tag = 'foe';
      const foeP = mk('emech', 48, 2, 20, { team: 1, hp: 1e5 }); foeP.remote = true; foeP.netId = 7; foeP.tag = 'foePuppet';
      return { me, mate, foe, foeP };
    };
    const res = (E) => ({ me: r2(1e5 - E.me.hp), mate: r2(1e5 - E.mate.hp), foe: r2(1e5 - E.foe.hp), foePuppet: r2(1e5 - E.foeP.hp), claims: claims.slice() });
    const shoot = (id, shooter, from, to, remote) => { C.fireProjectile(id, shooter, from, to.clone().sub(from).normalize(), { remote }); };
    const at = (e, dy = 4) => V(e.pos.x, e.pos.y + dy, e.pos.z);
    try {
      G.net = fake;
      for (const [label, ids] of [['bullet', ['rifle', 'e_rifle']], ['rocket', ['launcher', 'e_rpg']], ['pulse', ['pulse', 'e_pulse']]]) {
        const o = {};
        // local player shots (I am 'me'): at a host-owned enemy, at an enemy puppet, at a teammate
        let E = scene(); shoot(ids[0], E.me, at(E.me, 6), at(E.foe), false); drain(dt); o.localPlayer_vs_ownedEnemy = res(E);
        E = scene(); shoot(ids[0], E.me, at(E.me, 6), at(E.foeP), false); drain(dt); o.localPlayer_vs_enemyPuppet = res(E);
        E = scene(); shoot(ids[0], E.me, at(E.me, 6), at(E.mate), false); drain(dt); o.localPlayer_vs_mate = res(E);
        // local enemy shots (I am the host): at my own player, at a remote player's puppet
        E = scene(); shoot(ids[1], E.foe, at(E.foe, 6), at(E.me), false); drain(dt); o.localEnemy_vs_me = res(E);
        E = scene(); shoot(ids[1], E.foe, at(E.foe, 6), at(E.mate), false); drain(dt); o.localEnemy_vs_matePuppet = res(E);
        // replayed enemy shots (I am a client)
        E = scene(); shoot(ids[1], E.foeP, at(E.foeP, 6), at(E.me), true); drain(dt); o.remoteEnemy_vs_me = res(E);
        E = scene(); shoot(ids[1], E.foeP, at(E.foeP, 6), at(E.mate), true); drain(dt); o.remoteEnemy_vs_matePuppet = res(E);
        // replayed teammate shots
        E = scene(); shoot(ids[0], E.mate, at(E.mate, 6), at(E.foe), true); drain(dt); o.remotePlayer_vs_ownedEnemy = res(E);
        E = scene(); shoot(ids[0], E.mate, at(E.mate, 6), at(E.foeP), true); drain(dt); o.remotePlayer_vs_enemyPuppet = res(E);
        out[label] = o;
      }
      // world: only the local, non-remote projectile carves; the replay still shows an explosion
      { const w = {};
        for (const remote of [false, true]) { const E = scene(); const ex = []; const h = bus.on('explosion', e => ex.push(!!e.remote));
          const b0 = solidIn(30, 2, 60, 54, 12, 60.5); shoot('launcher', E.me, V(42, 6, 40), V(42, 6, 60), remote); shoot('pulse', E.me, V(40, 4, 40), V(40, 4, 60), remote); shoot('rifle', E.me, V(44, 4, 40), V(44, 4, 60), remote); drain(dt); bus.off('explosion', h);
          w[remote ? 'remote' : 'local'] = { voxels: b0 - solidIn(30, 2, 60, 54, 12, 60.5), explosionEvents: ex }; }
        out.world = w; }
      // lance: local beam claims on a puppet + per-tick 'beam' events; a replayed tick shows the beam and does nothing else
      { let E = scene(); const bev = []; const h = bus.on('beam', e => bev.push(e.slot));
        const g = gunner('lance', E.me, at(E.me, 6), E.foeP, { fire: { slot: 'armL' } }); run(0.5, dt); g.on = false; bus.off('beam', h);
        const local = { beamEvents: bev.length, slot: bev[0], claims: claims.length, claimEach: claims[0] && claims[0][1], puppetHp: r2(1e5 - E.foeP.hp) };
        E = scene(); const b0 = solidIn(30, 2, 60, 54, 12, 60.5);
        for (let i = 0; i < 5; i++) { C.fireProjectile('lance', E.mate, at(E.mate, 6), at(E.foe).sub(at(E.mate, 6)).normalize(), { remote: true, slot: 'armR' }); G.debugStep(6, dt); }
        const live = C.beams.filter(b => b.ttl > 0).length;
        C.fireProjectile('lance', E.mate, V(42, 6, 40), V(0, 0, 1), { remote: true, slot: 'armR' }); G.debugStep(2, dt);
        C.fireProjectile('lance', E.foeP, at(E.foeP, 6), at(E.me).sub(at(E.foeP, 6)).normalize(), { remote: true }); G.debugStep(2, dt);
        out.lance = { local, replay: { beamLive: live, foeDmg: r2(1e5 - E.foe.hp), claims: claims.length, wallVoxels: b0 - solidIn(30, 2, 60, 54, 12, 60.5), hostileReplayOnMe: r2(1e5 - E.me.hp) } }; G.debugStep(30, dt);
        out.lance.beamsAfter = C.beams.filter(b => b.ttl > 0).length; }
      // lock-on missiles against a moving enemy puppet
      { const E = scene(); E.foeP.pos.set(20, 30, 90); E.foeP.mover = (e, d) => { e.pos.x += 20 * d; };
        const w = C.createWeapon('seeker'); gunners.push({ w, on: false }); const shots = []; const h = bus.on('shot', e => shots.push([e.weapon, e.target && e.target.tag, typeof e.seed, e.slot, e.remote]));
        w.fire(E.me, at(E.me, 9), V(0, 0.7, 0.7).normalize(), { targets: [E.foeP], slot: 'shR' }); run(6, dt, () => C.projectiles.length === 0); bus.off('shot', h);
        out.lockOnPuppet = { claims: claims.slice(), puppetHp: r2(1e5 - E.foeP.hp), shotEvent: shots[0] }; }
    } finally { G.net = real; }
    // seeds: the same seed gives the same flight (wobbling rocket) and the same cluster burst
    { clear(); G.grid.restore(); const s = mk('mech', 42, 2, 20, { team: 0, invuln: true }); const fly = (seed) => { const p = C.fireProjectile('salvo', s, V(42, 8, 22), V(0, 0.2, 1).normalize(), { seed }); G.debugStep(40, dt); const q = [r2(p.pos.x), r2(p.pos.y), r2(p.pos.z)]; C.reset(); return q; };
      const a = fly(1234), b = fly(1234), c = fly(99);
      const burst = (seed) => { const ex = []; const h = bus.on('explosion', e => ex.push(r2(e.x) + ',' + r2(e.z))); const d = V(0, 0, 0); C.aimBallistic('mortar', V(42, 10, 22), V(42, 2, 60), d, true); C.fireProjectile('mortar', s, V(42, 10, 22), d, { seed }); drain(dt); bus.off('explosion', h); G.grid.restore(); return ex.join(' '); };
      const m1 = burst(77), m2 = burst(77), m3 = burst(78);
      out.seed = { sameSeedSameFlight: a.join() === b.join(), otherSeedDiffers: a.join() !== c.join(), pos: a, clusterSame: m1 === m2 && m1.length > 0, clusterOtherDiffers: m1 !== m3, bomblets: m1.split(' ').length }; }
    clear(); G.grid.restore(); return out;
  },
  bay() { return { weapons: T.bayWeapons(), ttk60: T.bayTtk(1 / 60), ttk20: T.bayTtk(1 / 20), lance: T.lanceCarve(), mortar60: T.mortarBehind(1 / 60), mortar20: T.mortarBehind(1 / 20), shield: T.shield() }; },
  // weapon state machines + events
  weapons(dt = 1 / 60) {
    const out = {}; const ev = {}; const hs = [];
    for (const n of ['weapon:reload', 'weapon:overheat', 'weapon:empty', 'weapon:ready', 'shot']) hs.push([n, bus.on(n, e => { const k = n + ':' + e.weapon; ev[k] = (ev[k] || 0) + 1; })]);
    clear();
    const s = mk('pilot', 42, 2, 20, { team: 0, invuln: true });
    const up = V(0, 1, 0.02).normalize();
    // rifle: 30 rounds, auto reload, back to 30
    { const w = C.createWeapon('rifle'); let t = 0, n = 0, tEmpty = -1, tBack = -1;
      while (t < 8) { if (w.fire(s, V(42, 4, 20), up)) n++; w.update(dt); G.debugStep(1, dt); t += dt; if (w.clip === 0 && tEmpty < 0) tEmpty = t; if (tEmpty >= 0 && w.clip === 30 && tBack < 0) { tBack = t; break; } }
      out.rifle = { firedBeforeEmpty: n, tEmpty: r2(tEmpty), reloadTook: r2(tBack - tEmpty), rate: r2((n - 1) / (tEmpty - dt)) }; }
    // pulse: overheat, lockout, alternating barrels
    { const w = C.createWeapon('pulse'); let t = 0, n = 0, tHot = -1, tOk = -1, sides = '';
      while (t < 12) { if (w.fire(s, V(42, 4, 20), up)) { n++; if (n <= 6) sides += w.lastSide; } w.update(dt); G.debugStep(1, dt); t += dt; if (w.overheated && tHot < 0) { tHot = t; out.pulseShotsToOverheat = n; } if (tHot >= 0 && !w.overheated && tOk < 0) { tOk = t; break; } }
      out.pulse = { tOverheat: r2(tHot), lockout: r2(tOk - tHot), sides }; }
    // salvo: 6 rockets rippled over several frames, then recharge
    { const w = C.createWeapon('salvo'); const f0 = C.stats.fired; const per = [];
      w.fire(s, V(42, 6, 20), up); let t = 0, tReady = -1;
      for (let i = 0; i < 40; i++) { per.push(C.stats.fired - f0); w.update(dt); G.debugStep(1, dt); t += dt; }
      const again = w.fire(s, V(42, 6, 20), up);
      while (t < 12 && tReady < 0) { w.update(dt); G.debugStep(1, dt); t += dt; if (w.canFire()) tReady = t; }
      out.salvo = { launchedByFrame: per.filter((v, i) => i === 0 || v !== per[i - 1]).length, total: per[per.length - 1], refireEarly: again, recharge: r2(tReady) }; }
    // skylance: charge is per missile
    { const w = C.createWeapon('skylance'); const a = mk('drone', 42, 60, 60), b = mk('drone', 50, 60, 60); const f0 = C.stats.fired;
      w.fire(s, V(42, 6, 20), up, { targets: [a, b] }); for (let i = 0; i < 30; i++) { w.update(dt); G.debugStep(1, dt); }
      out.skylance = { missiles: C.stats.fired - f0, charge: r2(w.charge), shots: w.shots, canFire: w.canFire() }; }
    // launcher: single shot, reload
    { const w = C.createWeapon('launcher'); const a = w.fire(s, V(42, 6, 20), up), b = w.fire(s, V(42, 6, 20), up); let t = 0; while (t < 5 && !w.canFire()) { w.update(dt); G.debugStep(1, dt); t += dt; }
      out.launcher = { first: a, second: b, reload: r2(t) }; }
    drain(dt);
    for (const [n, h] of hs) bus.off(n, h);
    out.events = ev; clear();
    return out;
  },
  // the player's own blast: 35 %
  self() {
    clear(); G.grid.restore();
    wall(36, 2, 26, 48, 9, 27, M.bedrock);
    const me = mk('pilot', 42, 2, 23.5, { team: 0, hp: 1e4 }), foe = mk('soldier', 43, 2, 23.5, { team: 1, hp: 1e4 }), ally = mk('mech', 39, 2, 23.5, { team: 0, hp: 1e4 });
    C.fireProjectile('launcher', me, V(42, 3.4, 24), V(0, 0, 1)); drain();
    const a = 1e4 - me.hp, b = 1e4 - foe.hp;
    // Vanta shell near Vanta troops
    const tank = mk('tank', 42, 2, 10, { team: 1, hp: 1e4 }), vs = mk('soldier', 42, 2, 24.5, { team: 1, hp: 1e4 });
    const hpMe = me.hp; C.fireProjectile('e_rpg', tank, V(42, 4.2, 12.5), V(0, -0.02, 1)); drain();
    const out = { self: r2(a), enemySameDistance: r2(b), ratio: r2(a / b), allyRig: r2(1e4 - ally.hp), vantaOnVanta: r2(1e4 - vs.hp), vantaOnPlayer: r2(hpMe - me.hp) };
    clear(); G.grid.restore(); return out;
  },
  // bullets and bolts go through window glass (breaking it) and still hit what is behind
  glass(dt = 1 / 60) {
    const out = {};
    for (const id of ['rifle', 'pulse', 'e_chain', 'launcher']) {
      clear(); G.grid.restore();
      wall(36, 2, 40, 48, 9, 40.5, M.glass); wall(36, 2, 44, 48, 9, 44.5, M.glass);
      const tgt = mk('soldier', 42, 2, 50, { team: id[1] === '_' ? 0 : 1, hp: 1e5 }), s = mk('pilot', 42, 2, 20, { team: id[1] === '_' ? 1 : 0, invuln: true });
      const before = solidIn(36, 2, 40, 48, 9, 44.5);
      C.fireProjectile(id, s, V(42, 3, 22), V(0, 0, 1)); drain(dt);
      out[id] = { dmgBehindGlass: r2(1e5 - tgt.hp), glassBroken: before - solidIn(36, 2, 40, 48, 9, 44.5) };
    }
    clear(); G.grid.restore(); return out;
  },
  // one second of pulse fire into a concrete wall ("chews through"), and one launcher rocket (the 3 m hole)
  chew(dt = 1 / 60) {
    const out = {};
    for (const [id, mat] of [['pulse', 'concrete'], ['pulse', 'brick_red'], ['e_pulse', 'brick_red'], ['e_pulse', 'concrete'], ['launcher', 'concrete'], ['launcher', 'brick_red'], ['salvo', 'concrete'], ['e_shell', 'concrete'], ['e_chain', 'brick_red'], ['rifle', 'wood']]) {
      clear(); G.grid.restore();
      wall(30, 2, 40, 54, 14, 40.5, M[mat]);
      const s = mk('pilot', 42, 2, 20, { team: id[1] === '_' ? 1 : 0, invuln: true });
      const g = gunner(id, s, V(42, 6, 22), V(42, 6, 40), { ballistic: !!C.WEAPONS[id].gravity });
      run(1.0, dt); g.on = false; G.debugStep(20, dt); gunners.length = 0;
      // hole = air voxels in the wall plane right after the fire (before rubble settles); width/height of the opening
      let n = 0, i0 = 1e9, i1 = -1, j0 = 1e9, j1 = -1; const k = Math.floor(40 / VS);
      for (let j = 4; j < 28; j++) for (let i = 60; i < 108; i++) if (!SOLID[G.grid.get(i, j, k)]) { n++; if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
      out[id + '>' + mat] = { shots: g.fired, holeVoxels: n, holeW: n ? (i1 - i0 + 1) * VS : 0, holeH: n ? (j1 - j0 + 1) * VS : 0 };
      drain(dt);
    }
    clear(); G.grid.restore(); return out;
  },
  ballistic(dt = 1 / 60) {
    clear(); const out = {};
    for (const [id, d] of [['e_shell', 40], ['e_shell', 110], ['grenade', 22]]) {
      const tgt = V(42, 2, 20 + d), o = V(42, 4, 20), dir = V(0, 0, 0);
      const ok = C.aimBallistic(id, o, tgt, dir);
      let land = null; const h = bus.on('explosion', e => { if (!land) land = e; });
      C.fireProjectile(id, null, o, dir, { team: 1 }); drain(dt); bus.off('explosion', h);
      out[id + '@' + d] = { ok, miss: land ? r2(Math.hypot(land.x - tgt.x, land.z - tgt.z)) : null };
    }
    G.grid.restore(); return out;
  },
  // update cost with a few hundred live projectiles and a busy entity list
  perf(n = 400, dt = 1 / 60) {
    clear(); G.grid.restore();
    for (let i = 0; i < 60; i++) mk(i % 3 ? 'soldier' : 'drone', 10 + (i % 10) * 18, i % 3 ? 2 : 30, 20 + Math.floor(i / 10) * 28, { hp: 1e9 });
    const s = mk('pilot', 96, 2, 96, { team: 0, invuln: true });
    const ids = ['rifle', 'pulse', 'salvo', 'skylance', 'e_rifle', 'e_pulse', 'e_shell', 'e_chain'];
    const d = V(0, 0, 0), o = V(0, 0, 0);
    const refill = () => { let k = 0; while (C.projectiles.length < n && k++ < n) { const id = ids[(C.stats.fired) % ids.length]; const a = C.stats.fired * 2.399; d.set(Math.cos(a), 0.25 + 0.5 * Math.abs(Math.sin(a * 1.7)), Math.sin(a)).normalize(); o.set(96 + Math.cos(a) * 3, 6, 96 + Math.sin(a) * 3); C.fireProjectile(id, s, o, d, { silent: true, speedMul: 0.25 }); } };
    refill(); G.debugStep(30, dt);
    let sum = 0, peak = 0, liveSum = 0; const N = 240;
    for (let i = 0; i < N; i++) { refill(); liveSum += C.projectiles.length; const t0 = performance.now(); C.update(dt); const t = performance.now() - t0; sum += t; if (t > peak) peak = t; G.time += dt; }
    const out = { avgLive: Math.round(liveSum / N), avgMs: +(sum / N).toFixed(3), peakMs: +peak.toFixed(2), glow: C.stats.glow, bodies: C.stats.bodies, dropped: C.stats.dropped };
    clear(); G.grid.restore(); return out;
  },
  reset() {
    clear(); const s = mk('pilot', 42, 2, 20, { team: 0, invuln: true });
    for (let i = 0; i < 700; i++) C.fireProjectile(i % 2 ? 'salvo' : 'pulse', s, V(42, 5, 20), V(Math.sin(i), 1, Math.cos(i)), { silent: true });
    const live = C.projectiles.length, dropped = C.stats.dropped; G.debugStep(3);
    C.reset();
    const after = { live: C.projectiles.length, glow: C.draw.glow.geometry.instanceCount, bodies: C.draw.body.count, sceneObjs: G.scene.children.filter(o => o.name && o.name.startsWith('combat:')).length };
    for (let i = 0; i < 640; i++) C.fireProjectile('rifle', s, V(42, 5, 20), V(0, 1, 0), { silent: true });
    const refill = C.projectiles.length; C.reset(); clear();
    return { liveBefore: live, droppedWhenFull: dropped, after, refillAfterReset: refill };
  },
  table() { return C.ttkTable(); },
  all() { const o = {}; for (const k of ['weapons', 'walls', 'chew', 'ttk', 'homing', 'self', 'glass', 'ballistic', 'reset']) o[k] = T[k](); o.tunnel20 = T.tunnel(1 / 20); o.tunnel60 = T.tunnel(1 / 60); o.homing20 = T.homing(1 / 20); o.seeker60 = T.seeker(1 / 60); o.seeker20 = T.seeker(1 / 20); o.ttk20 = T.ttk(1 / 20); o.perf = T.perf(); return o; },
};

// ---------------------------------------------------------------------------------------------------------
const DEMOS = {
  // player weapons from the left, into a brick wall with Vanta dummies in front
  range() {
    wall(70, 2, 30, 71, 12, 70, M.brick_red); wall(70, 2, 30, 71, 12, 70, M.brick_red);
    const s = mk('mech', 20, 2, 50, { team: 0, invuln: true });
    const rows = [['rifle', 38], ['launcher', 44], ['pulse', 50], ['salvo', 57], ['grenade', 63]];
    for (const [id, z] of rows) {
      const t = mk(id === 'pulse' || id === 'salvo' ? 'tank' : 'soldier', 62, 2, z, { hp: 1e9 });
      gunner(id, s, V(22, id === 'pulse' || id === 'salvo' ? 7 : 3.6, z), id === 'grenade' ? V(55, 2, z) : V(62, 3.2, z), { ballistic: id === 'grenade' });
    }
  },
  // Vanta weapons toward the player's rig
  vanta() {
    const me = mk('mech', 28, 2, 50, { team: 0, hp: 1e9 }); G.state.player.ent = me;
    const rows = [['e_rifle', 'soldier', 38, 2], ['e_rpg', 'soldier', 42, 2], ['e_shell', 'tank', 47, 2], ['e_pulse', 'emech', 54, 2], ['e_salvo', 'emech', 62, 2], ['e_drone', 'drone', 44, 14], ['e_chain', 'gunship', 52, 20], ['e_gsrocket', 'gunship', 60, 22]];
    for (const [id, kind, z, y] of rows) {
      const e = mk(kind, 80, y, z, { hp: 1e9 });
      const o = V(80 - e.radius - 0.6, y + e.height * (kind === 'emech' ? 0.7 : 0.6), z);
      gunner(id, e, o, id === 'e_shell' ? V(28, 2, 50) : V(28, 5.5, 46 + (z - 38) * 0.35), { ballistic: id === 'e_shell', fire: id === 'e_gsrocket' ? { target: me } : null });
    }
  },
  // Skylance volleys at a flight of drones and a gunship
  air() {
    const s = mk('mech', 50, 2, 40, { team: 0, invuln: true });
    const ts = [];
    for (let i = 0; i < 4; i++) ts.push(mk(i === 3 ? 'gunship' : 'drone', 30 + i * 14, 26 + i * 3, 80, { hp: 1e9, mover: (e) => { e.pos.x = 50 + Math.cos(e.t * 0.5 + i * 1.6) * 30; e.pos.z = 85 + Math.sin(e.t * 0.5 + i * 1.6) * 18; } }));
    const g = gunner('skylance', s, V(51.5, 11, 40), { dir: V(0.1, 0.85, 0.5).normalize() }, { fire: { targets: ts } });
    g.w.def = Object.assign({}, g.w.def);
    gunner('pulse', s, V(50, 7, 41), ts[3], { lead: true });
  },
  // a firefight: both factions trading everything across a street
  fight() {
    const a = mk('mech', 30, 2, 50, { team: 0, hp: 1e9 }); G.state.player.ent = a;
    const p = mk('pilot', 34, 2, 58, { team: 0, hp: 1e9 });
    const b = mk('emech', 78, 2, 52, { hp: 1e9 }), t = mk('tank', 80, 2, 62, { hp: 1e9 }), so = mk('soldier', 74, 2, 44, { hp: 1e9 }), gs = mk('gunship', 84, 22, 46, { hp: 1e9 });
    gunner('pulse', a, V(30, 7, 51.5), b); gunner('salvo', a, V(31, 9.5, 49), t); gunner('rifle', p, V(34.4, 3.5, 58), so); gunner('launcher', p, V(34.4, 3.6, 58.4), t);
    gunner('e_pulse', b, V(76, 7, 52), a); gunner('e_salvo', b, V(77, 9.5, 53.5), V(30, 5, 48)); gunner('e_shell', t, V(77.5, 4.2, 62), V(34, 2, 57), { ballistic: true });
    gunner('e_rifle', so, V(73.6, 3.5, 44), p); gunner('e_chain', gs, V(81, 22, 46), a); gunner('e_gsrocket', gs, V(81, 21.6, 47), a, { fire: { target: a } });
    gunner('skylance', a, V(29, 10.5, 50), { dir: V(0.2, 0.9, 0.1).normalize() }, { fire: { targets: [gs] } });
  },
  // one of everything, frozen mid-flight for inspection: player row (near) and Vanta row (far), flying +x
  lineup() {
    const s0 = mk('pilot', 30, 2, 40, { team: 0, invuln: true }), s1 = mk('soldier', 30, 2, 60, { team: 1, invuln: true });
    s0.mesh.visible = s1.mesh.visible = false; s0.noHit = s1.noHit = true;
    const P = ['rifle', 'pulse', 'launcher', 'salvo', 'skylance', 'grenade'], E = ['e_rifle', 'e_chain', 'e_drone', 'e_pulse', 'e_rpg', 'e_gsrocket', 'e_shell'];
    const d = V(1, 0.02, 0).normalize();
    const t = +(G.params.get('t') || 0.22);
    P.forEach((id, i) => { const p = C.fireProjectile(id, s0, V(40 - C.WEAPONS[id].speed * t * (C.WEAPONS[id].accel ? 1.6 : 1), 4, 44 + i * 1.6), d); });
    E.forEach((id, i) => { C.fireProjectile(id, s1, V(40 - C.WEAPONS[id].speed * t * (C.WEAPONS[id].accel ? 1.3 : 1), 4, 43.2 + i * 1.6), d); });
    for (let i = 0; i < Math.round(t * 60); i++) C.update(1 / 60);
    G.timeScale = 0.0005;
  },
  // phase B weapons side by side: autocannon, lance into a wall, siege shell, swarm at ground targets, mortar over the wall
  bay() {
    wall(66, 2, 30, 67, 14, 60, M.concrete);
    const s = mk('mech', 24, 2, 46, { team: 0, invuln: true });
    const so = mk('soldier', 60, 2, 34, { hp: 1e9 }), tk = mk('tank', 60, 2, 52, { hp: 1e9 });
    gunner('autocannon', s, V(26, 7, 34), so); gunner('lance', s, V(26, 7, 40), V(66, 6, 40));
    gunner('siege', s, V(26, 7, 46), V(66, 7, 47)); gunner('swarm', s, V(25, 10, 50), { dir: V(0.4, 0.9, 0.1).normalize() }, { fire: { targets: [tk, so, tk, so, tk, tk] } });
    gunner('mortar', s, V(24, 10.5, 54), { dir: V(0.5, 1, 0).normalize() }, { aimAt: V(76, 2, 56) });
  },
  stress() {
    const s = mk('pilot', 50, 2, 50, { team: 0, invuln: true });
    for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283; gunner(i % 2 ? 'pulse' : i % 4 ? 'rifle' : 'salvo', s, V(50, 4, 50), { dir: V(Math.cos(a), 0.2 + (i % 5) * 0.12, Math.sin(a)).normalize() }); }
  },
};

export function setup(Gx, combat) {
  C = combat;
  const prev = G.enemy.update;
  G.enemy.update = (dt) => { if (prev) prev.call(G.enemy, dt); tick(dt); };
  G.ct = T; G.ctl = { mk, clear, wall, gunner, gunners, dummies, DEMOS };
  if (!G.params.has('ui')) G.uiRoot.style.display = 'none';      // the baseline title card dims the frame
  if (G.params.has('tm')) { G.renderer.toneMapping = THREE.ACESFilmicToneMapping; G.renderer.toneMappingExposure = 1; }   // baseline render only: rough HDR preview
  if (G.params.has('dusk')) { G.scene.background = new THREE.Color(0x2b2f3d); if (G.scene.fog) G.scene.fog.color.set(0x2b2f3d); }
  const demo = G.params.get('demo');
  if (demo && DEMOS[demo]) DEMOS[demo]();
}
