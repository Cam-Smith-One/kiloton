// ============================================================================
// KILOTON — enemy.js   OWNER: ENEMY.   G.enemy
// Wave director and all Vanta AI: infantry squads (rifle / rocketeer / ace),
// drones, tanks, gunships and enemy rigs (standard / heavy).
// Navigation lives in enemy_nav.js. See notes/enemy.md for the knobs.
// ============================================================================
import { G, THREE, bus, clamp, sat, lerp, damp, dampAngle, wrapPi, WX, WZ, GROUND_Y } from './core.js';
import nav from './enemy_nav.js';

const rnd = Math.random;
const rr = (a, b) => a + (b - a) * rnd();
const T_SOLDIER = 0, T_DRONE = 1, T_TANK = 2, T_GUNSHIP = 3, T_EMECH = 4, T_TURRET = 5;
const TYPE = { soldier: T_SOLDIER, drone: T_DRONE, tank: T_TANK, gunship: T_GUNSHIP, emech: T_EMECH, turret: T_TURRET };
// soldier states
const S_ADV = 0, S_TOCOVER = 1, S_HIDE = 2, S_PEEK = 3, S_OPEN = 4, S_FLEE = 5, S_BOARD = 6;
// rig states
const E_DROP = 0, E_DORMANT = 1, E_STALK = 2;
// aircraft states
const A_ORBIT = 0, A_RUN = 1, A_BREAK = 2, A_ENTER = 3;
const GRAV = 24;

// ---- tuning ----------------------------------------------------------------
export const TUNE = {
  hpMul: 1, dmgSpreadMul: 1,           // global difficulty: enemy hp, and a multiplier on every aim error
  intermission: 8, firstDelay: 5,
  aceChargeTime: 35, dropEta: 4.0,
  capBase: 8, capPerWave: 3, capMax: 34,
  tokensBase: 2, tokensPerWave: 0.5, tokensMax: 6,   // infantry allowed to be mid-burst at the pilot at once
  meleeRig: 230, meleePilot: 60, meleeKnock: 13,
  coreMul: 1.75, coreRadius: 2.6,
  tearDamage: 450, disabledAt: 0.12, disabledTime: 12, shieldHp: 500,
  lockWarn: false,                     // COMBAT already raises 'lock:warning' for homing rockets; ours would fight it
};
const DEF = {
  rifle: { hp: 40, r: 0.35, hw: 0.32, h: 1.8, speed: 4.5, eye: 1.55, step: 1.0, sight: 95, nav: 0, bandMin: 13, bandMax: 34, spread0: 0.085, spread1: 0.022, tight: 3.5 },
  rocketeer: { hp: 40, r: 0.35, hw: 0.32, h: 1.8, speed: 4.2, eye: 1.55, step: 1.0, sight: 110, nav: 0, bandMin: 22, bandMax: 50, spread0: 0.07, spread1: 0.02, tight: 3 },
  ace: { hp: 90, r: 0.35, hw: 0.32, h: 1.8, speed: 4.8, eye: 1.55, step: 1.0, sight: 110, nav: 0, bandMin: 26, bandMax: 48, spread0: 0.06, spread1: 0.015, tight: 2.5 },
  drone: { hp: 60, r: 0.9, h: 0.7, speed: 11, eye: 0.2, sight: 90, spread0: 0.06, spread1: 0.02, tight: 2.5 },
  tank: { hp: 600, r: 2.2, hw: 1.9, h: 2.6, speed: 5, eye: 2.3, step: 1.0, sight: 150, nav: 1, spread0: 0.035, spread1: 0.008, tight: 5 },
  gunship: { hp: 500, r: 3.2, h: 2.6, speed: 17, eye: 0.4, sight: 170, spread0: 0.08, spread1: 0.03, tight: 4 },
  standard: { hp: 1500, r: 1.8, hw: 1.6, h: 8.5, speed: 6.2, eye: 7.0, step: 1.5, sight: 170, nav: 2, spread0: 0.07, spread1: 0.02, tight: 4, reach: 5.2 },
  heavy: { hp: 2600, r: 2.2, hw: 1.9, h: 10.5, speed: 4.8, eye: 8.6, step: 2.0, sight: 170, nav: 2, spread0: 0.07, spread1: 0.02, tight: 4, reach: 6.2 },
  dreadnought: { hp: 9000, r: 3.4, hw: 2.2, h: 17, speed: 3.6, eye: 13, step: 2.5, sight: 220, nav: 2, spread0: 0.06, spread1: 0.02, tight: 4, reach: 8 },
  turret: { hp: 320, r: 1.1, hw: 0.9, h: 1.9, speed: 0, eye: 1.5, step: 0, sight: 115, spread0: 0.07, spread1: 0.025, tight: 3 },
};
const COL_VANTA = [0x3a1518, 0x5a201c, 0x1c1a19, 0x2a2224, 0xff5a1e];
const COL_SOLDIER = [0x3a1518, 0x2a2224, 0x5a201c];

// ---- scratch ---------------------------------------------------------------
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _h = new THREE.Vector3();
const _wp = { x: 0, z: 0 };
const anim = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0, crouch: 0, shield: 0, brace: 0 };
const deathQ = [], dying = [];
const tokens = { used: 0, max: 2 };
let claim = null;                      // Int16Array per nav cell: unit id holding that cover cell
let uid = 1, coverBudget = 0, warnCount = 0, modelMs = 0, extMs = 0;
// Calls into other modules are timed separately so stats.ms is the AI's own cost.
function boom(x, y, z, o) {
  if (puppetMode) { bus.emit('explosion', { x, y, z, radius: o.radius || 3, power: o.power == null ? 120 : o.power, kind: o.kind || 'rocket', owner: null, cosmetic: true }); return; }   // clients: the host's blast arrives as a replicated destruct op
  const t = performance.now(); G.boom(x, y, z, o); extMs += performance.now() - t;
}
const X = {
  punch(a, b, c, d, e, f, g, h, i, j) { const t = performance.now(), n = G.destruct.punch(a, b, c, d, e, f, g, h, i, j); extMs += performance.now() - t; return n; },
  carveBox(a, b, c, d, e, f, g, h) { const t = performance.now(), n = G.destruct.carveBox(a, b, c, d, e, f, g, h); extMs += performance.now() - t; return n; },
  explode(a, b, c, d, e, f) { const t = performance.now(), n = G.destruct.explode(a, b, c, d, e, f); extMs += performance.now() - t; return n; },
  burst(a, b, c, o) { const t = performance.now(); G.destruct.burst(a, b, c, o); extMs += performance.now() - t; },
};
let glowGeo = null, glowMat = null, ringGeo = null, ringMat = null;

function hasW(id) { const W = G.combat && G.combat.WEAPONS; return !!(W && Object.prototype.hasOwnProperty.call(W, id)); }
let tGeoA = null, tGeoB = null, tGeoC = null, tMatA = null, tMatB = null;
function turretRig(D) {                // stand-in emplacement until MODELS ships a 'turret' kind (shared geometry / materials)
  if (!tGeoA) {
    tGeoA = new THREE.BoxGeometry(1.8, 0.9, 1.8); tGeoB = new THREE.BoxGeometry(1.1, 0.8, 1.3); tGeoC = new THREE.BoxGeometry(0.22, 0.22, 1.6);
    tMatA = new THREE.MeshStandardMaterial({ color: 0x3a1518, roughness: 0.6, metalness: 0.6 }); tMatB = new THREE.MeshStandardMaterial({ color: 0x2a2224, roughness: 0.5, metalness: 0.8, emissive: new THREE.Color(1.2, 0.25, 0.05), emissiveIntensity: 0.35 });
  }
  const root = new THREE.Group(), base = new THREE.Mesh(tGeoA, tMatA), head = new THREE.Group(), hm = new THREE.Mesh(tGeoB, tMatB), gun = new THREE.Mesh(tGeoC, tMatA), muz = new THREE.Object3D();
  base.position.y = 0.45; head.position.y = 1.3; gun.position.set(0, 0, 1.2); muz.position.set(0, 0, 2.05);
  base.castShadow = hm.castShadow = gun.castShadow = true;
  head.add(hm, gun, muz); root.add(base, head);
  return { kind: 'turret', root, sockets: { muzzleR: muz, muzzleL: muz, eye: head }, radius: D.r, height: D.h, update(dt, s) { head.rotation.y = s.aimYaw; gun.rotation.x = -s.aimPitch; muz.position.y = Math.sin(s.aimPitch) * 0.8; }, trigger() {}, setDamage() {}, dispose() { root.removeFromParent(); } };
}
function fallbackRig(kind, D) {        // only if G.models.create throws (another module mid-edit)
  const root = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(D.r * 2, D.h, D.r * 1.4), new THREE.MeshStandardMaterial({ color: 0x5a201c }));
  m.position.y = D.h / 2; root.add(m);
  return { kind, root, sockets: {}, radius: D.r, height: D.h, update() {}, trigger() {}, dispose() { root.removeFromParent(); m.geometry.dispose(); m.material.dispose(); } };
}
function sockPos(u, name, out) {
  const s = u.rig.sockets && u.rig.sockets[name];
  if (s) { s.getWorldPosition(out); if (out.x === out.x) return out; }
  const p = u.ent.pos, f = u.aimYaw;
  return out.set(p.x + Math.sin(f) * (u.D.r + 0.2), p.y + u.D.eye, p.z + Math.cos(f) * (u.D.r + 0.2));
}
function warn(on) {
  const was = warnCount > 0; warnCount = Math.max(0, warnCount + (on ? 1 : -1));
  if (TUNE.lockWarn && was !== (warnCount > 0)) bus.emit('lock:warning', { on: warnCount > 0 });
}
function msg(text, sub, kind, dur) { bus.emit('ui:message', { text, sub, kind: kind || 'warn', dur: dur || 3 }); }

// ---- unit record -------------------------------------------------------------
function makeUnit(kind, variant, x, y, z) {
  const key = kind === 'soldier' ? (variant || 'rifle') : kind === 'emech' ? (variant in DEF ? variant : 'standard') : kind;
  const D = DEF[key] || DEF.rifle;
  let rig;
  const mt = performance.now();
  try { if (kind !== 'turret' || (G.models.DIM && G.models.DIM.turret)) rig = G.models.create(kind, { variant: kind === 'soldier' || kind === 'emech' ? key : undefined }); } catch (e) { rig = null; }
  if (kind === 'turret' && (!rig || !rig.root || rig.kind !== 'turret')) { if (rig && rig.dispose) { try { rig.dispose(); } catch (e) {} } rig = turretRig(D); }
  if (key === 'dreadnought' && rig && rig.root && rig.height < D.h * 0.8) rig.root.scale.setScalar(D.h / (rig.height || 8.5));   // MODELS has no dreadnought yet: a scaled-up rig
  extMs += performance.now() - mt;
  if (!rig || !rig.root) rig = fallbackRig(kind, D);
  rig.root.rotation.order = 'YXZ';
  const air = kind === 'drone' || kind === 'gunship';
  const hp = Math.round(D.hp * TUNE.hpMul);
  const ent = G.ents.add({ kind, variant: key, team: 1, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(), radius: D.r, height: D.h, hp, maxHp: hp, airborne: air, name: 'Vanta ' + key });
  const u = {
    id: uid++, type: TYPE[kind], kind, variant: key, D, ent, rig,
    tgtOv: null, hold: false, holdX: x, holdZ: z, holdR: 9, fi: D.nav || 0, boss: key === 'dreadnought', bph: 1, escortCd: 4, ringT: 0,
    body: air ? null : { pos: ent.pos, vel: ent.vel, hw: D.hw, h: D.h, stepUp: D.step, onGround: false, hitWall: false, hitCeil: false, landSpeed: 0 },
    yaw: 0, aimYaw: 0, aimPitch: 0, w1: null, w2: null,
    thinkT: rnd() * 0.3, st: 0, stT: 0, age: 0,
    los: false, dist: 999, seeT: 0, lastSeenT: -99, lsx: x, lsy: y, lsz: z,
    wx: x, wz: z, navR: 0, sepX: 0, sepZ: 0, wantMove: false,
    goalX: x, goalZ: z, coverC: -1, peekX: x, peekZ: z, hideT: 0, coverCd: 0, pkArr: false, fired: false,
    burstN: 0, fireCd: rr(0.5, 2), token: false, telling: false, tellT: 0, ax: 0, ay: 0, az: 0,
    side: 0, squad: 0, flankT: 0, openT: 0, openPh: 0, strafe: rnd() < 0.5 ? -1 : 1, sideT: 0, sideX: 0, sideZ: 0,
    anchorX: x, anchorZ: z, anchorT: 0, stuck: 0, trapT: 0, hopCd: 0, noLosT: 0,
    charge: 0, chargeEmit: 0, called: false, myRig: null, owner: null, abandonT: -1,
    phase: rnd() * 6.283, orbR: 0, alt: 0, runT: rr(4, 9), bank: 0, breakT: 0, breakCd: 0, rx: 0, rz: 0, rocketN: 0, rocketT: 0, locked: false,
    punchCd: 1, punchT: -1, punchSide: 'L', salvoCd: rr(5, 9), jetCd: rr(3, 7), jetting: false, jetT: 0, wasGround: true, carveT: 0, stepT: 0, footSeen: false, meleeT: 0, meleeCd: rr(6, 10), dropT: 0, dormant: false,
    ramT: 0, mode: 0, relocN: 0, stagT: 0, armL: true, armR: true, loadout: '', w3: null, siegeCd: rr(6, 10), siegeT: -1, hitT: -99, shDown: 0, disT: -1, wasDisabled: false, stompCd: 0, tgt: null, retT: 0, hurtBy: null, hurtT: -99, puppet: false, carveT2: 0, jumped: false, pLock: false, released: false, lowCover: false, crouch: 0, scatterT: 0, dead: false, counted: false, glow: null, ring: null, deathInfo: null,
  };
  ent.ctrl = u; ent.rig = rig; ent.netId = u.id & 0xffff;
  if (kind === 'emech' || kind === 'tank') installRigHooks(u);
  if (u.boss) {
    u.wasDisabled = true;
    // weak point: once the armour is off the core (damage > 30 %), hits landing near it count for more
    ent.onDamage = (amount, info) => {
      const c = rig.sockets && rig.sockets.core;
      if (!c || !info || info.x == null || ent.hp > ent.maxHp * 0.7 || info.type === 'melee') return amount;
      c.getWorldPosition(_h);
      const dx = info.x - _h.x, dy = info.y - _h.y, dz = info.z - _h.z;
      if (dx * dx + dy * dy + dz * dz < TUNE.coreRadius * TUNE.coreRadius) { ent.coreHitT = G.time; return amount * TUNE.coreMul; }
      return amount;
    };
  }
  ent.onDeath = (info) => { if (!u.dead) { u.dead = true; u.deathInfo = info || null; deathQ.push(u); } };
  // weapons
  const C = G.combat;
  if (kind === 'soldier') u.w1 = C.createWeapon(key === 'rocketeer' ? 'e_rpg' : 'e_rifle');
  else if (kind === 'drone') u.w1 = C.createWeapon('e_drone');
  else if (kind === 'tank') u.w1 = C.createWeapon('e_shell');
  else if (kind === 'turret') u.w1 = C.createWeapon(hasW('e_turret') ? 'e_turret' : 'e_chain');
  else if (kind === 'gunship') { u.w1 = C.createWeapon('e_chain'); u.w2 = C.createWeapon('e_gsrocket'); }
  else { u.w1 = C.createWeapon('e_pulse'); u.w2 = C.createWeapon('e_salvo'); }
  // tell glow (shared geometry / material)
  const gs = kind === 'tank' || kind === 'turret' ? 'muzzleR' : kind === 'emech' ? 'rocketPod' : key === 'rocketeer' ? 'muzzleR' : key === 'ace' ? '' : null;
  if (gs !== null) {
    const g = u.glow = new THREE.Mesh(glowGeo, glowMat); g.visible = false; g.frustumCulled = false;
    const s = gs && rig.sockets && rig.sockets[gs];
    if (s) s.add(g); else { rig.root.add(g); g.position.set(0, key === 'ace' ? D.h + 0.55 : D.eye, key === 'ace' ? 0 : D.r); }
  }
  if (kind === 'emech') rig.onFootstep = (side, pos, heavy) => { u.footSeen = true; footstep(u, pos.x, pos.y, pos.z); };
  rig.root.position.copy(ent.pos); G.scene.add(rig.root);
  return u;
}
function footstep(u, x, y, z) {
  bus.emit('footstep', { x, y, z, heavy: true, kind: 'emech', team: 1, chassis: u.boss ? 'dreadnought' : u.variant === 'heavy' ? 'vanta_heavy' : 'vanta' });
  const t = target(); if (t) { const dx = t.pos.x - x, dz = t.pos.z - z, d = Math.sqrt(dx * dx + dz * dz); if (d < 45) bus.emit('shake', { amount: 0.16 * (1 - d / 45) * (u.variant === 'heavy' ? 1.4 : 1) }); }
}
function disposeUnit(u) {
  if (u.glow) { u.glow.removeFromParent(); u.glow = null; }
  if (u.ring) { u.ring.removeFromParent(); u.ring.material.dispose(); u.ring = null; }
  if (u.rig) { u.rig.onFootstep = null; u.rig.root.removeFromParent(); try { u.rig.dispose(); } catch (e) {} }
  if (u.token) { u.token = false; tokens.used--; }
  if (u.telling) { u.telling = false; warn(false); }
  if (u.coverC >= 0) { if (claim[u.coverC] === u.id) claim[u.coverC] = 0; u.coverC = -1; }
  if (u.jetting) { u.jetting = false; bus.emit('jet', { ent: u.ent, on: false }); }
}

// ---- Phase B hooks on rigs and tanks: stagger, torn limbs, disabled / hijack ------
function cancelActions(u) {
  if (u.telling) { u.telling = false; warn(false); }
  if (u.glow) u.glow.visible = false;
  u.burstN = 0; u.punchT = -1; u.siegeT = -1; u.tellT = 0;
  if (u.jetting) { u.jetting = false; bus.emit('jet', { ent: u.ent, on: false }); }
}
function installRigHooks(u) {
  const e = u.ent;
  e.staggered = false;
  e.stagger = (sec) => {
    if (u.dead || !e.alive) return;
    if (u.puppet) { if (G.net && G.net.enemyCmd) G.net.enemyCmd(e.netId, 'stagger', sec); try { u.rig.trigger('hit', 1.5); } catch (er) {} return; }
    if (u.boss) sec = (sec || 0.5) * 0.35;
    u.stagT = Math.max(u.stagT, sec || 0.5); e.staggered = true; cancelActions(u);
    u.fireCd = Math.max(u.fireCd, 0.4); u.punchCd = Math.max(u.punchCd, 0.5);
    try { u.rig.trigger('hit', 1.5); } catch (er) {}
  };
  if (u.type !== T_EMECH) return;
  e.limbs = { armL: true, armR: true };
  e.tearLimb = (limb, by) => {
    if (u.puppet) { if ((limb !== 'armL' && limb !== 'armR') || !u[limb]) return false; if (G.net && G.net.enemyCmd) G.net.enemyCmd(e.netId, 'tearLimb', limb); return true; }
    if (u.dead || !e.alive || (limb !== 'armL' && limb !== 'armR') || !u[limb]) return false;
    if (u.boss && u.bph < 3) return false;                 // the dreadnought's arms only come off once it is enraged
    u[limb] = false; e.limbs[limb] = false;
    try { u.rig.setLimbLost && u.rig.setLimbLost(limb); } catch (er) {}
    if (limb === 'armL' && e.shield) { e.shield.on = false; e.shield.hp = 0; e.shield = null; try { u.rig.setShield && u.rig.setShield(0); } catch (er) {} }
    if (limb === 'armR' && u.w3) u.w3 = null;
    e.stagger(1.5);
    G.ents.damage(e, TUNE.tearDamage, { type: 'melee', src: by || null, x: e.pos.x, y: e.pos.y + u.D.h * 0.6, z: e.pos.z, dx: 0, dy: 0, dz: 0, limb });
    return true;
  };
  e.onHijack = () => { cancelActions(u); };
}
function disableRig(u) {
  const e = u.ent, p = e.pos;
  u.wasDisabled = true; u.disT = TUNE.disabledTime; e.disabled = true; cancelActions(u);
  if (e.shield) { e.shield.on = false; try { u.rig.setShield && u.rig.setShield(0); } catch (er) {} }
  try { u.rig.trigger('hit', 2); } catch (er) {}
  bus.emit('rig:disabled', { ent: e, x: p.x, y: p.y, z: p.z });
  // the Vanta pilot bails out on foot
  const c = nav.walkableNear(p.x + Math.sin(u.yaw + 3.14) * 3, p.z + Math.cos(u.yaw + 3.14) * 3, 1, 0);
  if (c >= 0) enemy.spawn('soldier', nav.cellX(c), nav.cellZ(c), { variant: 'rifle' });
}
// Give a unit to someone else (PLAYER hijack): stop driving it, keep the entity and its model alive.
function release(ent) {
  const u = ent && ent.ctrl; if (!u || u.ent !== ent || u.released) return false;
  const i = enemy.list.indexOf(u); if (i >= 0) enemy.list.splice(i, 1);
  cancelActions(u);
  if (u.glow) { u.glow.removeFromParent(); u.glow = null; }
  if (u.ring) { u.ring.removeFromParent(); u.ring.material.dispose(); u.ring = null; }
  if (u.token) { u.token = false; tokens.used--; }
  releaseCover(u);
  if (u.counted) { dir.killed++; u.counted = false; }
  if (u.type === T_EMECH && !u.dormant && u.st !== E_DROP) G.state.wave.enemyMechs = Math.max(0, G.state.wave.enemyMechs - 1);
  u.rig.onFootstep = null; u.rig.root.rotation.x = 0; u.rig.root.rotation.z = 0;
  ent.rig = u.rig; ent.yaw = u.yaw; ent.disabled = false; ent.staggered = false; ent.onDeath = undefined; ent.ctrl = null;
  ent.stagger = undefined; ent.tearLimb = undefined; ent.onHijack = undefined; if (ent.shield) { ent.shield.on = false; ent.shield = null; }
  u.released = true; u.dead = true; u.rig = null;
  return true;
}

// ---- targets -----------------------------------------------------------------
function target() {
  const P = G.state.player;
  if (P.ent && P.ent.alive) return P.ent;
  if (P.pilot && P.pilot.alive) return P.pilot;
  if (G.net && G.net.online) { const L = G.ents.players(); for (let i = 0; i < L.length; i++) if (L[i] && L[i].alive) return L[i]; }
  return null;
}
// Co-op (host): each unit keeps its own target among the players: nearest, biased toward whoever hurt it last and
// toward the one it already has. With one player this is never called.
function choosePlayer(u, players, fallback) {
  const p = u.ent.pos; let best = null, bs = 1e18;
  for (let i = 0; i < players.length; i++) {
    const t = players[i]; if (!t || !t.alive) continue;
    const dx = t.pos.x - p.x, dz = t.pos.z - p.z; let s = dx * dx + dz * dz;
    if (t === u.tgt) s *= 0.55;                                   // stickiness
    if (t === u.hurtBy && G.time - u.hurtT < 5) s *= 0.4;         // most threatening: the one shooting at us
    if ((u.variant === 'rocketeer' || u.type === T_TANK) && t.height > 4) s *= 0.6;
    if (s < bs) { bs = s; best = t; }
  }
  return best || fallback;
}
function targetFor(u, main) {          // rocketeers and tanks would rather shoot the rig
  if (!main) return null;
  if (u.tgtOv) return main;
  if (u.variant === 'rocketeer' || u.type === T_TANK) {
    const m = G.state.player.mech;
    if (m && m.alive && m !== main && !u.los) { const dx = m.pos.x - u.ent.pos.x, dz = m.pos.z - u.ent.pos.z; if (dx * dx + dz * dz < 70 * 70) return m; }
  }
  return main;
}
function perceive(u, tgt) {
  const p = u.ent.pos, ey = p.y + u.D.eye;
  const tx = tgt.pos.x, ty = tgt.pos.y + tgt.height * 0.6, tz = tgt.pos.z;
  const dx = tx - p.x, dy = ty - ey, dz = tz - p.z;
  u.dist = Math.sqrt(dx * dx + dz * dz);
  u.los = dx * dx + dy * dy + dz * dz < u.D.sight * u.D.sight && G.grid.los(p.x, ey, p.z, tx, ty, tz);
  if (u.los) { u.lastSeenT = G.time; u.lsx = tgt.pos.x; u.lsy = tgt.pos.y; u.lsz = tgt.pos.z; }
}
// Aim point with partial lead (so shots are dodgeable). Writes _a.
function aimPoint(u, tgt, w, leadK) {
  const def = w && w.def, sp = def && def.speed > 0 ? (def.maxSpeed ? (def.speed + def.maxSpeed) * 0.5 : def.speed) : 0;
  let t = sp ? Math.min(1.3, u.dist / sp) * leadK : 0;
  const v = tgt.vel; let vx = 0, vz = 0; if (v) { vx = v.x; vz = v.z; }
  const feet = def && def.blast && tgt.height < 3 && !tgt.airborne && tgt.pos.y < u.ent.pos.y + u.D.eye + 2;
  _a.set(tgt.pos.x + vx * t, tgt.pos.y + (feet ? 0.15 : tgt.height * 0.55), tgt.pos.z + vz * t);
  return _a;
}
function spreadFor(u, tgt) {
  const D = u.D; let s = lerp(D.spread0, D.spread1, sat(u.seeT / D.tight));
  const v = tgt.vel; if (v) { const sp = Math.sqrt(v.x * v.x + v.z * v.z); s += Math.min(0.045, sp * 0.0035); }
  const wn = G.state.wave.n; if (wn < 5) s *= 1 + (5 - wn) * 0.08;
  return s * TUNE.dmgSpreadMul;
}
// Fire weapon w from a socket at (tx,ty,tz) with an aim error. Returns true if a shot left.
function shoot(u, w, sock, tx, ty, tz, spread, trig, opts) {
  sockPos(u, sock, _o);
  let dx = tx - _o.x, dy = ty - _o.y, dz = tz - _o.z;
  const dh = Math.sqrt(dx * dx + dz * dz) || 1e-3;
  const def = w.def;
  if (def && def.gravity > 0 && def.speed > 0) {       // ballistic low arc
    const v2 = def.speed * def.speed, g = def.gravity, disc = v2 * v2 - g * (g * dh * dh + 2 * dy * v2);
    const tanA = disc > 0 ? (v2 - Math.sqrt(disc)) / (g * dh) : 1;
    dy = tanA * dh;
  }
  let l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= l; dy /= l; dz /= l;
  const sx = (rnd() + rnd() - 1) * spread, sy = (rnd() + rnd() - 1) * spread * 0.7;
  const rl = Math.sqrt(dx * dx + dz * dz) || 1, rx = dz / rl, rz = -dx / rl;
  _d.set(dx + rx * sx - dx * dy / rl * sy, dy + rl * sy, dz + rz * sx - dz * dy / rl * sy).normalize();
  const ft = performance.now(), ok = w.fire(u.ent, _o, _d, opts); extMs += performance.now() - ft;
  if (ok && trig) u.rig.trigger(trig);
  return ok;
}

// ---- ground movement -----------------------------------------------------------
function groundMove(u, dt, mx, mz, speed, accel) {
  const v = u.ent.vel, b = u.body;
  v.x = damp(v.x, mx * speed + u.sepX, accel, dt); v.z = damp(v.z, mz * speed + u.sepZ, accel, dt);
  v.y -= GRAV * dt; if (v.y < -45) v.y = -45;
  u.wasGround = b.onGround;
  G.grid.moveBody(b, dt);
  u.wantMove = speed > 0.8;
}
function separation(u, list) {
  const p = u.ent.pos; let sx = 0, sz = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i]; if (o === u || !o.body || o.st === E_DROP && o.type === T_EMECH) continue;
    const q = o.ent.pos, dx = p.x - q.x, dz = p.z - q.z, rs = u.D.r + o.D.r + (u.type === T_SOLDIER && o.type === T_SOLDIER ? 0.9 : 0.6);
    const d2 = dx * dx + dz * dz; if (d2 > rs * rs || d2 < 1e-4) continue;
    if (p.y > q.y + o.D.h || q.y > p.y + u.D.h) continue;
    const d = Math.sqrt(d2), f = (rs - d) / rs * (o.type > u.type ? 5 : 2.5);
    sx += dx / d * f; sz += dz / d * f;
  }
  u.sepX = clamp(sx, -4, 4); u.sepZ = clamp(sz, -4, 4);
}
// Last resort: put a trapped unit on the nearest cell that can reach the player.
function relocate(u) {
  const p = u.ent.pos, cls = u.D.nav, f = nav.fields[u.fi];
  const s0 = Math.min(40, u.relocN * 5); u.relocN++;
  for (let s = s0; s < s0 + 60; s++) {
    const c = nav.walkableNear(p.x, p.z, s, cls); if (c < 0) break;
    if (f.valid && f.dist[c] === Infinity) continue;
    if (claim[c] && claim[c] !== u.id) continue;
    const hw = u.body.hw, y = nav.hS[c] + 0.05, g = G.grid; let ok = false;
    for (let q = 0; q < 5 && !ok; q++) {
      const x = nav.cellX(c) + (q === 1 || q === 3 ? -0.5 : q === 2 || q === 4 ? 0.5 : 0), z = nav.cellZ(c) + (q === 1 || q === 2 ? -0.5 : q === 3 || q === 4 ? 0.5 : 0);
      if (!g.boxSolid(x - hw, y + 0.5, z - hw, x + hw, y + Math.min(u.body.h, 3), z + hw)) { p.set(x, y, z); ok = true; }
    }
    if (!ok) continue;
    u.ent.vel.set(0, 0, 0); g.unstick(u.body, 1.5);
    u.stuck = 0; u.trapT = 0; u.anchorX = p.x; u.anchorZ = p.z; enemy.stats.relocations++;
    return true;
  }
  return false;
}
function stuckCheck(u, dtThink) {
  const p = u.ent.pos, b = u.body;
  u.anchorT += dtThink;
  if (u.anchorT >= 1) {
    const dx = p.x - u.anchorX, dz = p.z - u.anchorZ;
    if (u.wantMove && dx * dx + dz * dz < 0.36) u.stuck++; else u.stuck = 0;
    u.anchorX = p.x; u.anchorZ = p.z; u.anchorT = 0;
  }
  if (G.grid.boxSolid(p.x - b.hw, p.y + 0.3, p.z - b.hw, p.x + b.hw, p.y + b.h, p.z + b.hw)) {      // rubble came down on us
    const y0 = p.y; G.grid.unstick(b, 3);
    if (G.grid.boxSolid(p.x - b.hw, p.y + 0.3, p.z - b.hw, p.x + b.hw, p.y + b.h, p.z + b.hw)) { p.y = y0; relocate(u); }
  }
  if (u.navR === 0 || u.navR === 3) u.trapT += dtThink; else u.trapT = 0;
}

// ============================================================================
// SOLDIERS
// ============================================================================
// opts.hold: stay near the post. Points the waypoint at the post when the unit has strayed (returns true), else parks it.
function holdPost(u) {
  const p = u.ent.pos, dx = u.holdX - p.x, dz = u.holdZ - p.z;
  if (dx * dx + dz * dz > u.holdR * u.holdR) { u.wx = u.holdX; u.wz = u.holdZ; return true; }
  u.wx = p.x; u.wz = p.z; return false;
}
function releaseCover(u) { if (u.coverC >= 0) { if (claim[u.coverC] === u.id) claim[u.coverC] = 0; u.coverC = -1; } }
function setS(u, st) { u.st = st; u.stT = 0; }
function endBurst(u, cd) {
  u.burstN = 0; if (u.token) { u.token = false; tokens.used--; }
  if (u.telling) { u.telling = false; warn(false); if (u.glow) u.glow.visible = false; }
  u.fireCd = cd;
}
function startBurst(u, tgt) {
  if (u.fireCd > 0 || u.burstN > 0 || u.telling) return false;
  if (!u.token) { if (tokens.used >= tokens.max) return false; u.token = true; tokens.used++; }
  if (u.variant === 'rocketeer') {
    u.telling = true; u.tellT = (u.w1.def && u.w1.def.tell) || 0.8; if (tgt.isPlayer || tgt === G.state.player.ent) warn(true); else warn(true);
  } else u.burstN = u.variant === 'ace' ? 5 : 3 + ((rnd() * 3) | 0);
  u.fired = false;
  return true;
}
function soldierFire(u, dt, tgt) {
  const w = u.w1;
  if (u.telling) {                       // rocketeer: shoulder, hold still, laser, fire
    u.tellT -= dt;
    if (!tgt || G.time - u.lastSeenT > 1.2) { endBurst(u, 1.5); return; }
    aimPoint(u, tgt, w, 0.55);
    if (u.glow) { u.glow.visible = true; const k = 0.25 + 0.5 * (1 - sat(u.tellT / 0.8)); u.glow.scale.set(k, k, k); }
    if (u.tellT <= 0) {
      shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, spreadFor(u, tgt) * 0.5, 'fireR');
      u.fired = true; endBurst(u, rr(4.5, 7));
    }
    return;
  }
  if (u.burstN > 0) {
    if (!tgt || (!u.los && G.time - u.lastSeenT > 0.7)) { endBurst(u, rr(0.6, 1.2)); u.fired = true; return; }
    if (w.canFire()) {
      aimPoint(u, tgt, w, 0.5);
      let sp = spreadFor(u, tgt); if (u.st === S_ADV) sp += 0.03;
      if (shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, sp, 'fireR')) { u.burstN--; if (u.burstN <= 0) { u.fired = true; endBurst(u, rr(1.1, 2.4)); } }
    } else if (w.clip === 0 && !w.reloading && w.reload) { w.reload(u.ent); u.fired = true; endBurst(u, rr(1.2, 2)); }
  }
}
// Look for a cell near the soldier with solid voxels between it and the target and a step-out with a firing line.
function findCover(u, tgt) {
  const p = u.ent.pos, D = u.D, c0 = nav.cellOf(p.x, p.z), W = nav.W;
  const cx0 = c0 % W, cz0 = (c0 / W) | 0, f = nav.fields[u.fi];
  const tx = tgt.pos.x, ty = tgt.pos.y + tgt.height * 0.6, tz = tgt.pos.z, g = G.grid;
  let best = -1, bs = -1e9, bpx = 0, bpz = 0, blow = false;
  let rays = 0;
  for (let n = 0; n < 48 && rays < 12; n++) {
    const cx = cx0 + ((rnd() * 15) | 0) - 7, cz = cz0 + ((rnd() * 15) | 0) - 7;
    if (cx < 1 || cz < 1 || cx >= W - 1 || cz >= nav.H - 1) continue;
    const c = cx + cz * W;
    if (!nav.passS[c] || (claim[c] && claim[c] !== u.id) || (f.valid && f.dist[c] === Infinity)) continue;
    // only cells that touch something: clutter inside the cell or a blocked neighbour
    if (nav.costS[c] < 2 && nav.passS[c - 1] && nav.passS[c + 1] && nav.passS[c - W] && nav.passS[c + W]) continue;
    rays++;
    const x = nav.cellX(c), z = nav.cellZ(c), y = nav.hS[c];
    const dx = tx - x, dz = tz - z, dT = Math.sqrt(dx * dx + dz * dz);
    if (dT < D.bandMin * 0.8 || dT > D.bandMax * 1.25) continue;
    const r = g.raycast(x, y + 0.7, z, dx, ty - (y + 0.7), dz, Math.min(dT, 4), true);
    if (!r.hit) continue;                                   // nothing solid close by on the target side
    if (c !== c0 && !nav.lineOK(0, c0, c)) continue;
    // low cover (barrier, sandbags, a car, rubble): crouch behind it and pop up to fire from the same spot
    if (g.los(x, y + D.eye, z, tx, ty, tz)) {
      const du = Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
      const s = 3.5 - du * 0.9 - Math.abs(dT - (D.bandMin + D.bandMax) * 0.5) * 0.35 + rnd() * 2;
      if (s > bs) { bs = s; best = c; bpx = x; bpz = z; blow = true; }
      continue;
    }
    // step-out: one of the two cells perpendicular to the target line
    const sgn = Math.abs(dx) > Math.abs(dz) ? 1 : 0;        // perpendicular axis: z if target is mostly along x
    let px = 0, pz = 0, okPeek = false;
    for (let s = -1; s <= 1 && !okPeek; s += 2) {
      const pc = sgn ? c + s * W : c + s;
      if (!nav.passS[pc] || Math.abs(nav.hS[pc] - y) > 1) continue;
      const qx = sgn ? x : x + s * 1.6, qz = sgn ? z + s * 1.6 : z, qy = nav.hS[pc];
      if (g.los(qx, qy + D.eye, qz, tx, ty, tz)) { px = qx; pz = qz; okPeek = true; }
    }
    if (!okPeek) continue;
    const du = Math.sqrt((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z));
    const pref = (D.bandMin + D.bandMax) * 0.5;
    const cross = (x - p.x) * (tz - p.z) - (z - p.z) * (tx - p.x);     // which side of our line to the target
    const s = -du * 0.9 - Math.abs(dT - pref) * 0.35 + (u.side ? (cross * u.side < 0 ? 2.5 : -1) : 0) + rnd() * 2;
    if (s > bs) { bs = s; best = c; bpx = px; bpz = pz; blow = false; }
  }
  if (best < 0) return false;
  releaseCover(u); u.coverC = best; claim[best] = u.id;
  u.goalX = nav.cellX(best); u.goalZ = nav.cellZ(best); u.peekX = bpx; u.peekZ = bpz; u.lowCover = blow;
  return true;
}
function soldierThink(u, tgt, dtT) {
  const p = u.ent.pos, D = u.D;
  stuckCheck(u, dtT); separation(u, enemy.list);
  if (u.stuck >= 6 || u.trapT > 9) { relocate(u); releaseCover(u); setS(u, S_ADV); }
  else if (u.stuck >= 2 && u.sideT <= 0) { const a = rnd() * 6.283; u.sideT = 0.8; u.sideX = Math.sin(a); u.sideZ = Math.cos(a); }
  if (!tgt) return;
  perceive(u, tgt);
  if (u.los) u.noLosT = 0; else u.noLosT += dtT;
  const push = dir.push;
  // a rig walking at you: scatter
  if (tgt.kind === 'mech' && u.dist < 13 && u.st !== S_FLEE && u.st !== S_BOARD) { releaseCover(u); endBurst(u, 1); setS(u, S_FLEE); }
  // a swarm rack has locked on: break and run sideways
  if (u.locked) { u.locked = false; if (u.st !== S_FLEE && u.st !== S_BOARD) { releaseCover(u); endBurst(u, 1); setS(u, S_FLEE); u.scatterT = 2.2; u.strafe = rnd() < 0.5 ? -1 : 1; } }
  // the player's shield is up: riflemen work round the sides
  if (tgt.shield && tgt.shield.on && u.side === 0) { u.side = u.id & 1 ? 1 : -1; } if (tgt.shield && tgt.shield.on && u.st === S_ADV) u.flankT = Math.max(u.flankT, 4);
  if (u.variant === 'ace' && u.myRig && u.myRig.st === E_DORMANT && !u.myRig.dead && u.st !== S_BOARD) { releaseCover(u); endBurst(u, 1); setS(u, S_BOARD); }
  switch (u.st) {
    case S_ADV: {
      let r;
      if (u.flankT > 0 && u.side && u.dist > 14 && u.dist < 60) { r = nav.flankStep(p.x, p.z, u.side, 3.2, _wp, u.fi, tgt.pos.x, tgt.pos.z); u.flankT -= dtT; if (!r) r = nav.waypoint(u.fi, p.x, p.z, _wp); }
      else r = nav.waypoint(u.fi, p.x, p.z, _wp);
      u.navR = r;
      if (r === 2 || r === 0) { u.wx = tgt.pos.x; u.wz = tgt.pos.z; } else { u.wx = _wp.x; u.wz = _wp.z; }
      if (u.hold) holdPost(u);
      if (u.los && u.dist < D.bandMin * 0.8) { setS(u, S_OPEN); u.openPh = 1; u.openT = 1; break; }
      const engage = u.dist < D.bandMax && (u.los || u.dist < D.bandMin + 6);
      if (engage && u.coverCd <= 0 && coverBudget > 0 && !(push && u.dist > D.bandMin)) {
        coverBudget--; u.coverCd = 1.2;
        if (findCover(u, tgt)) setS(u, S_TOCOVER);
        else if (u.los && u.dist < D.bandMax * 0.9) { setS(u, S_OPEN); u.openPh = 1; u.openT = 1.2; }
      } else if (u.los && u.dist < (push ? D.bandMin : D.bandMax * 0.75) && u.coverCd > 0) { setS(u, S_OPEN); u.openPh = 1; u.openT = 1.2; }
      break;
    }
    case S_TOCOVER: if (u.stuck >= 2 || u.stT > 7) { releaseCover(u); setS(u, S_ADV); } break;
    case S_HIDE: {
      // is the cover still there? (it may have been shot away, or the target has walked round it)
      const cdx = tgt.pos.x - p.x, cdz = tgt.pos.z - p.z;
      if (!G.grid.raycast(p.x, p.y + 0.7, p.z, cdx, tgt.pos.y + tgt.height * 0.6 - (p.y + 0.7), cdz, Math.min(u.dist, 5), true).hit) { releaseCover(u); u.coverCd = 0; setS(u, S_ADV); enemy.stats.coverLost++; break; }
      const far = u.dist > D.bandMax * 1.35, stale = u.noLosT > (push ? 3 : 9) && G.time - u.lastSeenT > (push ? 3 : 9);
      if (far || stale || u.dist < 6) { releaseCover(u); setS(u, u.dist < 6 ? S_OPEN : S_ADV); u.coverCd = 3; u.openPh = 1; u.openT = 1; }
      break;
    }
    case S_OPEN: {
      if (u.dist > D.bandMax * 1.2 || (!u.los && u.noLosT > 1.5)) setS(u, S_ADV);
      else if (u.coverCd <= 0 && coverBudget > 0 && u.burstN === 0 && !u.telling && !push) { coverBudget--; u.coverCd = 2.5; if (findCover(u, tgt)) setS(u, S_TOCOVER); }
      break;
    }
  }
}
function updSoldier(u, dt, main) {
  const e = u.ent, p = e.pos, D = u.D;
  const tgt = targetFor(u, main);
  u.coverCd -= dt; u.fireCd -= dt; u.hopCd -= dt; u.sideT -= dt;
  u.thinkT -= dt;
  if (u.thinkT <= 0) { const dtT = 0.24 + rnd() * 0.08; soldierThink(u, tgt, dtT); u.thinkT = dtT; enemy.stats.thinks++; }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt * 1.5);
  let mx = 0, mz = 0, sp = 0, face = false;
  if (tgt) switch (u.st) {
    case S_ADV: {
      mx = u.wx - p.x; mz = u.wz - p.z; sp = D.speed;
      if (dir.push === false && u.dist < 4) sp = 0;
      if (u.los && u.dist < D.bandMax + 8 && u.variant !== 'rocketeer') startBurst(u, tgt);
      break;
    }
    case S_TOCOVER: {
      mx = u.goalX - p.x; mz = u.goalZ - p.z; sp = D.speed;
      if (mx * mx + mz * mz < 0.3) { setS(u, S_HIDE); u.hideT = u.fired ? rr(1.3, 3.0) : rr(0.3, 1.0); if (u.variant === 'ace') u.hideT *= 1.5; sp = 0; }
      break;
    }
    case S_HIDE:
      face = true;
      if (u.stT > u.hideT && u.fireCd <= 0.3) { setS(u, S_PEEK); u.pkArr = false; u.fired = false; }
      break;
    case S_PEEK: {
      face = true;
      if (!u.pkArr) {
        mx = u.peekX - p.x; mz = u.peekZ - p.z; sp = D.speed * 0.8;
        if (u.lowCover) { mx = mz = 0; sp = 0; }
        if (u.lowCover ? u.stT > 0.25 : (mx * mx + mz * mz < 0.25 || u.stT > 1.6)) { u.pkArr = true; perceive(u, tgt); u.stT = 0; sp = 0; }
      } else {
        if (!u.fired && u.burstN === 0 && !u.telling) {
          if (u.los) startBurst(u, tgt);
          if (u.stT > 1.4 && u.burstN === 0 && !u.telling) {       // no line or no token: duck back, or give the spot up
            if (!u.los) { releaseCover(u); setS(u, S_ADV); u.coverCd = 2; } else { u.fired = true; }
          }
        }
        if (u.fired && u.burstN === 0 && !u.telling) { setS(u, S_TOCOVER); if (u.coverC < 0) setS(u, S_ADV); }
      }
      break;
    }
    case S_OPEN: {
      face = true; u.openT -= dt;
      if (u.openPh === 0) {
        const dx = tgt.pos.x - p.x, dz = tgt.pos.z - p.z, d = u.dist || 1;
        const rad = u.dist < D.bandMin ? -1 : u.dist > D.bandMax * 0.8 ? 0.8 : 0;
        mx = -dz / d * u.strafe + dx / d * rad; mz = dx / d * u.strafe + dz / d * rad; sp = D.speed * 0.75;
        if (u.openT <= 0 || u.body.hitWall) { u.openPh = 1; u.openT = rr(1.2, 1.9); if (u.body.hitWall) u.strafe = -u.strafe; }
      } else {
        if (u.los) startBurst(u, tgt);
        if (u.openT <= 0 && u.burstN === 0 && !u.telling) { u.openPh = 0; u.openT = rr(0.7, 1.4); if (rnd() < 0.4) u.strafe = -u.strafe; }
      }
      break;
    }
    case S_FLEE: {
      mx = p.x - tgt.pos.x; mz = p.z - tgt.pos.z; sp = D.speed * 1.2;
      if (u.body.hitWall || u.scatterT > 0) { const t = mx; mx = -mz * u.strafe + mx * 0.3; mz = t * u.strafe + mz * 0.3; }
      u.scatterT -= dt;
      if (u.stT > 2.5 && (u.dist > 18 || tgt.kind !== 'mech' || u.stT > 6)) setS(u, S_ADV);
      break;
    }
    case S_BOARD: {
      const r = u.myRig;
      if (!r || r.dead) { setS(u, S_ADV); break; }
      mx = r.ent.pos.x - p.x; mz = r.ent.pos.z - p.z; sp = D.speed * 1.25;
      const d2 = mx * mx + mz * mz;
      if (d2 < 16 || (u.stT > 14 && d2 < 400) || u.stT > 25) { boardRig(u, r); return; }
      const w = nav.cellOf(p.x, p.z) !== nav.cellOf(r.ent.pos.x, r.ent.pos.z) && d2 > 100;
      if (w && u.navR === 1) { mx = u.wx - p.x; mz = u.wz - p.z; }
      break;
    }
  }
  u.stT += dt;
  if (u.telling || (u.burstN > 0 && u.st !== S_ADV)) sp = 0;
  if (u.sideT > 0 && sp > 0) { mx = u.sideX; mz = u.sideZ; }
  const ml = Math.sqrt(mx * mx + mz * mz);
  if (ml > 1e-3) { mx /= ml; mz /= ml; } else sp = 0;
  groundMove(u, dt, mx, mz, sp, 10);
  if (u.body.hitWall && u.body.onGround && sp > 0 && u.hopCd <= 0) { e.vel.y = 8.2; u.hopCd = 0.7; }
  // facing + aim
  let ay = u.yaw, ap = 0;
  if (tgt && (face || u.burstN > 0 || u.telling) && G.time - u.lastSeenT < 4) {
    const dx = tgt.pos.x - p.x, dz = tgt.pos.z - p.z; ay = Math.atan2(dx, dz);
    ap = Math.atan2(tgt.pos.y + tgt.height * 0.5 - (p.y + D.eye), u.dist || 1);
    u.yaw = dampAngle(u.yaw, ay, 10, dt);
  } else if (sp > 0.5) u.yaw = dampAngle(u.yaw, Math.atan2(e.vel.x, e.vel.z), 8, dt);
  u.aimYaw = ay; u.aimPitch = ap;
  soldierFire(u, dt, tgt);
  if (u.variant === 'ace') aceCharge(u, dt);
  // crouch in cover (the hit box really is lower), kneel to shoulder the launcher
  const cr = u.st === S_HIDE || (u.st === S_TOCOVER && sp === 0) ? 1 : u.telling ? 0.6 : 0;
  u.crouch = cr; e.height = cr >= 1 ? 1.15 : D.h;
  // model
  const vx = e.vel.x, vz = e.vel.z, s = Math.sin(u.yaw), c = Math.cos(u.yaw);
  anim.speed = Math.sqrt(vx * vx + vz * vz); anim.fwd = clamp((vx * s + vz * c) / D.speed, -1, 1); anim.strafe = clamp((-vx * c + vz * s) / D.speed, -1, 1);
  anim.aimYaw = wrapPi(ay - u.yaw); anim.aimPitch = ap; anim.grounded = u.body.onGround; anim.vy = e.vel.y; anim.jet = 0; anim.dead = false; anim.heat = 0; anim.crouch = u.crouch;
}

// ---- aces ------------------------------------------------------------------------
function aceCharge(u, dt) {
  if (u.called) { if (u.glow) { u.glow.visible = true; const k = 0.5 + 0.2 * Math.sin(G.time * 14); u.glow.scale.set(k, k * 2, k); } return; }
  u.charge += dt / TUNE.aceChargeTime;
  u.chargeEmit -= dt;
  if (u.glow) { u.glow.visible = true; const k = 0.18 + 0.4 * u.charge; u.glow.scale.set(k, k + u.charge * 1.2, k); }
  if (u.charge >= 1) {
    u.charge = 1; u.called = true;
    const p = u.ent.pos, spot = pickDrop(p.x, p.z, 6, 28, target());
    const r = enemy.spawn('emech', spot.x, spot.z, { variant: 'standard', drop: true, dormant: true });
    r.owner = u; u.myRig = r;
    bus.emit('ace:called', { ent: u.ent, progress: 1 });
    msg('ACE HAS CALLED A RIG', 'Vanta rig drop inbound', 'warn', 3.5);
  } else if (u.chargeEmit <= 0) { u.chargeEmit = 0.25; bus.emit('ace:charging', { ent: u.ent, progress: u.charge }); }
}
function boardRig(u, r) {
  r.dormant = false; r.owner = null; r.counted = u.counted; u.counted = false; r.st = E_STALK; r.stT = 0; r.ent.invuln = false;
  r.ent.hp = r.ent.maxHp; G.state.wave.enemyMechs++;
  const i = enemy.list.indexOf(u); if (i >= 0) enemy.list.splice(i, 1);
  u.dead = true; u.ent.alive = false; G.ents.remove(u.ent); disposeUnit(u);
  msg('ACE RIG ONLINE', 'The ace is in its rig', 'warn', 3);
}

// ============================================================================
// TANKS
// ============================================================================
function carveAhead(u, fx, fz, y0, y1, reach, power) {
  const p = u.ent.pos, hw = u.body.hw, cx = p.x + fx * (hw + reach * 0.5), cz = p.z + fz * (hw + reach * 0.5), hx = hw * Math.abs(fz) + (reach * 0.5 + 0.3) * Math.abs(fx) + 0.2, hz = hw * Math.abs(fx) + (reach * 0.5 + 0.3) * Math.abs(fz) + 0.2;
  if (!G.grid.boxSolid(cx - hx, p.y + y0, cz - hz, cx + hx, p.y + y1, cz + hz)) return 0;
  return X.carveBox(cx - hx, p.y + y0, cz - hz, cx + hx, p.y + y1, cz + hz, power, true) || 0;
}
function updTank(u, dt, main) {
  const e = u.ent, p = e.pos, D = u.D, w = u.w1;
  const tgt = targetFor(u, main);
  if (u.stagT > 0 || e.held) {
    if (u.stagT > 0) { u.stagT -= dt; if (u.stagT <= 0) e.staggered = false; }
    e.vel.x = damp(e.vel.x, 0, 3, dt); e.vel.z = damp(e.vel.z, 0, 3, dt);
    if (!e.held) { e.vel.y -= GRAV * dt; G.grid.moveBody(u.body, dt); }
    u.wantMove = false; u.stuck = 0;
    anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.aimYaw = wrapPi(u.aimYaw - u.yaw); anim.aimPitch = u.aimPitch; anim.grounded = true; anim.vy = 0; anim.jet = 0; anim.dead = false; anim.heat = 0;
    return;
  }
  u.fireCd -= dt; u.thinkT -= dt;
  if (u.thinkT <= 0) {
    const dtT = 0.25 + rnd() * 0.08; u.thinkT = dtT; enemy.stats.thinks++;
    stuckCheck(u, dtT); separation(u, enemy.list);
    if (u.stuck >= 7 || u.trapT > 12) relocate(u);
    if (tgt) {
      perceive(u, tgt);
      if (u.los) u.noLosT = 0; else u.noLosT += dtT;
      const r = nav.waypoint(u.fi, p.x, p.z, _wp, 5); u.navR = r;
      if (r === 2 || r === 0) { u.wx = tgt.pos.x; u.wz = tgt.pos.z; } else { u.wx = _wp.x; u.wz = _wp.z; }
      const inRange = u.los && u.dist < 62;
      u.mode = inRange ? (u.dist < 24 ? 2 : 1) : (u.dist < 20 ? 1 : 0);
      if (dir.push && !u.los) u.mode = 0;
      if (u.hold) { u.mode = holdPost(u) ? 0 : 1; }
    } else u.mode = 1;
  }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt);
  // turret
  let fireNow = false;
  if (u.telling) {
    u.tellT -= dt;
    if (u.glow) { u.glow.visible = true; const k = 0.5 + 1.1 * (1 - sat(u.tellT / 1.1)); u.glow.scale.set(k, k, k); }
    if (u.tellT <= 0) fireNow = true;
  } else if (tgt) {
    const siege = !u.los && u.noLosT > 4 && u.dist < 85;
    const dx = tgt.pos.x - p.x, dz = tgt.pos.z - p.z, want = Math.atan2(dx, dz);
    const err = wrapPi(want - u.aimYaw), stepA = 1.1 * dt;
    u.aimYaw += clamp(err, -stepA, stepA);
    u.aimPitch = damp(u.aimPitch, Math.atan2(tgt.pos.y + tgt.height * 0.5 - (p.y + D.eye), u.dist || 1), 4, dt);
    if (Math.abs(err) < 0.05 && u.fireCd <= 0 && w.canFire() && (u.los || siege) && u.dist > 7) {
      u.telling = true; u.tellT = (w.def && w.def.tell) || 1.1; warn(true);
      if (u.los) aimPoint(u, tgt, w, 0.6); else _a.set(tgt.pos.x, tgt.pos.y + tgt.height * 0.5, tgt.pos.z);
      u.ax = _a.x; u.ay = _a.y; u.az = _a.z;
      u.aimYaw = Math.atan2(u.ax - p.x, u.az - p.z);
    }
  }
  if (fireNow) {
    shoot(u, w, 'muzzleR', u.ax, u.ay, u.az, lerp(D.spread0, D.spread1, sat(u.seeT / D.tight)) * TUNE.dmgSpreadMul, 'fireR');
    bus.emit('shake', { amount: u.dist < 40 ? 0.1 : 0.03 });
    u.telling = false; warn(false); if (u.glow) u.glow.visible = false;
    u.fireCd = u.los ? rr(4.2, 6) : rr(6, 8.5);
  }
  // hull
  let mx = 0, mz = 0, sp = 0;
  if (tgt && !u.telling) {
    if (u.mode === 0) { mx = u.wx - p.x; mz = u.wz - p.z; sp = D.speed; }
    else if (u.mode === 2) { mx = p.x - tgt.pos.x; mz = p.z - tgt.pos.z; sp = D.speed * 0.6; }
  }
  const ml = Math.sqrt(mx * mx + mz * mz); if (ml > 1e-3) { mx /= ml; mz /= ml; } else sp = 0;
  let fwd = 0;
  if (sp > 0) {
    const want = u.mode === 2 ? Math.atan2(-mx, -mz) : Math.atan2(mx, mz), err = wrapPi(want - u.yaw), stepA = 1.4 * dt;
    u.yaw += clamp(err, -stepA, stepA);
    const k = Math.max(0, Math.cos(err)); fwd = (u.mode === 2 ? -1 : 1) * k * k;
    mx = Math.sin(u.yaw) * fwd; mz = Math.cos(u.yaw) * fwd; sp *= 1;
  }
  groundMove(u, dt, mx, mz, sp, 3);
  if (sp > 0 && Math.abs(fwd) > 0.3) {
    u.carveT -= dt;
    if (u.body.hitWall || u.carveT <= 0) {
      u.carveT = 0.2; const s = fwd < 0 ? -1 : 1;
      if (u.body.hitWall) u.ramT += 0.2;
      const n = carveAhead(u, Math.sin(u.yaw) * s, Math.cos(u.yaw) * s, 0.55, D.h + 0.3, 1.0, u.stuck >= 2 || u.ramT > 1.5 ? 175 : 88);
      if (n > 0) u.ramT = 0;
    }
  }
  anim.speed = Math.abs(fwd) * sp; anim.fwd = fwd; anim.strafe = 0; anim.aimYaw = wrapPi(u.aimYaw - u.yaw); anim.aimPitch = u.aimPitch;
  anim.grounded = u.body.onGround; anim.vy = e.vel.y; anim.jet = 0; anim.dead = false; anim.heat = u.telling ? 1 - sat(u.tellT) : 0;
}

// ============================================================================
// ENEMY RIGS
// ============================================================================
function pickDrop(x, z, rMin, rMax, avoid) {
  const drops = (G.city.spawns && G.city.spawns.mechDrops) || [];
  let best = null, bs = -1e9;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i], dx = d.x - x, dz = d.z - z, dd = Math.sqrt(dx * dx + dz * dz);
    let s = -Math.abs(dd - (rMin + rMax) * 0.5) * 0.08 + rnd() * 1.5; if (dd < rMin || dd > rMax) s -= 4 + Math.abs(dd - rMax) * 0.05;
    if (avoid) { const ax = d.x - avoid.pos.x, az = d.z - avoid.pos.z; if (ax * ax + az * az < 18 * 18) s -= 20; }
    for (let k = 0; k < enemy.list.length; k++) { const o = enemy.list[k]; if (o.type === T_EMECH) { const ox = d.x - o.ent.pos.x, oz = d.z - o.ent.pos.z; if (ox * ox + oz * oz < 100) s -= 20; } }
    if (s > bs) { bs = s; best = d; }
  }
  if (best && bs > -6) return best;
  // no listed zone fits: any open rig-sized cell in the ring
  for (let n = 0; n < 40; n++) {
    const a = rnd() * 6.283, r = rr(rMin, rMax), px = clamp(x + Math.sin(a) * r, 8, WX - 8), pz = clamp(z + Math.cos(a) * r, 8, WZ - 8);
    if (avoid) { const ax = px - avoid.pos.x, az = pz - avoid.pos.z; if (ax * ax + az * az < 16 * 16) continue; }
    const c = nav.walkableNear(px, pz, 0, 2); if (c >= 0) return { x: nav.cellX(c), z: nav.cellZ(c) };
  }
  return best || { x: clamp(x + rMax, 8, WX - 8), z: z };
}
function rigPunch(u, tgt, dx, dy, dz) {
  const hand = u.punchSide === 'L' ? 'handL' : 'handR';
  sockPos(u, hand, _h);
  const p = u.ent.pos, D = u.D;
  if (!(u.rig.sockets && u.rig.sockets[hand])) _h.set(p.x + dx * D.r, p.y + D.h * 0.55, p.z + dz * D.r);
  const n = X.punch(_h.x, _h.y, _h.z, dx, dy, dz, 1.5, D.reach, 190, u.ent) || 0;
  let hit = false;
  if (tgt) {
    const tx = tgt.pos.x - p.x, tz = tgt.pos.z - p.z, td = Math.sqrt(tx * tx + tz * tz);
    const reach = D.r + tgt.radius + D.reach;
    if (td < reach && tgt.pos.y < p.y + D.h && tgt.pos.y + tgt.height > p.y && (td < 2 || (tx * dx + tz * dz) / td > 0.55)) {
      hit = true;
      const big = tgt.height > 4;
      G.ents.damage(tgt, big ? TUNE.meleeRig * (u.variant === 'heavy' ? 1.3 : 1) : TUNE.meleePilot, { type: 'melee', src: u.ent, x: _h.x, y: _h.y, z: _h.z, dx, dy, dz });
      if (tgt.vel) { const k = TUNE.meleeKnock * (big ? 1 : 1.3); tgt.vel.x += dx * k; tgt.vel.z += dz * k; tgt.vel.y += big ? 4 : 7; }
      tgt.knock = G.time;
      bus.emit('shake', { amount: 0.6 });
    }
  }
  bus.emit('punch', { x: _h.x, y: _h.y, z: _h.z, dx, dy, dz, hit: hit || n > 0, team: 1 });
  u.punchSide = u.punchSide === 'L' ? 'R' : 'L'; pickArm(u);
  return hit || n > 0;
}
function pickArm(u) { if (u.punchSide === 'L' ? !u.armL : !u.armR) u.punchSide = u.punchSide === 'L' ? 'R' : 'L'; }
function rigStomp(u) {
  const p = u.ent.pos;
  u.rig.trigger('land', 0.8);
  X.explode(p.x, p.y + 0.4, p.z, 2.6, 85, { owner: u.ent });
  G.ents.radiusDamage(p.x, p.y + 0.5, p.z, 6, 70, { type: 'slam', src: u.ent }, 1);
  bus.emit('slam', { x: p.x, y: p.y, z: p.z, radius: 6, team: 1 });
}
function showRing(u, x, y, z, k) {      // ground marker: where the dreadnought's shell or jump-slam will come down
  if (!u.ring) { u.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.9, 0.25), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); u.ring.renderOrder = 5; G.scene.add(u.ring); }
  u.ring.visible = true; u.ring.position.set(x, Math.max(0.6, G.grid.topBelow(x, y + 3, z)) + 0.15, z); u.ring.scale.setScalar(k);
}
function hideRing(u) { if (u.ring) u.ring.visible = false; }
function bossPhase(u, dt, tgt) {
  const e = u.ent, f = e.hp / e.maxHp, ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3;
  if (ph > u.bph) {
    u.bph = ph; e.phase = ph; cancelActions(u); hideRing(u); u.stagT = 2.2; e.staggered = true;
    try { u.rig.trigger('hit', 2); } catch (er) {}
    if (ph === 2) { e.shield = { on: false, yaw: u.aimYaw, arc: 2.4, hp: 1500, max: 1500 }; u.escortCd = 1; msg('DREADNOUGHT — SHIELD UP', 'It is advancing behind an aegis with drone escorts. Flank it or break the shield', 'warn', 4.5); }
    else { if (e.shield) { e.shield.on = false; e.shield = null; if (u.rig.setShield) u.rig.setShield(0); } u.jetCd = 1.5; u.meleeT = 2; msg('DREADNOUGHT ENRAGED', 'Shield down. It will jump on you — keep moving, tear its arms off', 'warn', 4.5); }
    bus.emit('boss:phase', { ent: e, phase: ph });
    bus.emit('shake', { amount: 0.5 });
  }
  if (u.bph === 2 && tgt) {              // drone escorts, a few at a time
    u.escortCd -= dt;
    if (u.escortCd <= 0) {
      u.escortCd = 18; let n = 0; const L = enemy.list;
      for (let i = 0; i < L.length; i++) if (L[i].owner === u && L[i].type === T_DRONE) n++;
      for (let i = n; i < Math.min(6, n + 3); i++) { const d = enemy.spawn('drone', e.pos.x + rr(-4, 4), e.pos.z + rr(-4, 4), { y: e.pos.y + u.D.h + 3 + i }); if (d) d.owner = u; }
    }
  }
}
function rigLand(u, hard) {
  const p = u.ent.pos;
  if (u.boss && !u.jumped) { u.rig.trigger('land', 0.4); bus.emit('shake', { amount: 0.25 }); return; }
  u.jumped = false;
  if (u.boss) {                          // jump-slam: levels what it lands on
    u.rig.trigger('land', 1); if (u.jetting) { u.jetting = false; bus.emit('jet', { ent: u.ent, on: false }); }
    boom(p.x, p.y + 1.5, p.z, { radius: 9, power: 215, damage: 125, dmgRadius: 10, owner: u.ent, kind: 'mech', friendlyFire: false });
    bus.emit('slam', { x: p.x, y: p.y, z: p.z, radius: 9, team: 1 });
    G.grid.unstick(u.body, 6);
    return;
  }
  u.rig.trigger('land', hard ? 1 : 0.6);
  if (u.jetting) { u.jetting = false; bus.emit('jet', { ent: u.ent, on: false }); }
  X.explode(p.x, p.y + 0.4, p.z, 2.4, 80, { owner: u.ent });
  G.ents.radiusDamage(p.x, p.y + 0.5, p.z, 5.5, 32, { type: 'slam', src: u.ent }, 1);
  bus.emit('slam', { x: p.x, y: p.y, z: p.z, radius: 5.5, team: 1 });
}
function updEmech(u, dt, main) {
  const e = u.ent, p = e.pos, D = u.D, b = u.body, tgt = main;
  // ---- arriving by rig drop ----
  if (u.st === E_DROP) {
    u.dropT -= dt;
    if (u.ring) { const k = 1 + 0.15 * Math.sin(G.time * 12); u.ring.scale.set(k, k, k); u.ring.material.opacity = 0.5 + 0.4 * Math.sin(G.time * 12); }
    if (u.dropT > 0) {
      p.y = u.ay + u.dropT * 36 + u.dropT * u.dropT * 3;
      if (G.fx) { G.fx.emit('fire', p.x, p.y + 1, p.z, 0, 1, 0, 2); G.fx.emit('smoke', p.x, p.y + 4, p.z, 0, 1, 0, 1); }
      anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.aimYaw = 0; anim.aimPitch = 0; anim.grounded = false; anim.vy = -36; anim.jet = 1; anim.dead = false; anim.heat = 0;
      return;
    }
    p.y = u.ay;
    if (u.ring) { u.ring.removeFromParent(); u.ring.material.dispose(); u.ring = null; }
    boom(p.x, p.y + 0.6, p.z, { radius: 6.5, power: 150, damage: 150, owner: e, kind: 'mech', friendlyFire: false });
    p.y = Math.max(0.5, G.grid.topBelow(p.x, p.y + 1, p.z)); G.grid.unstick(b, 8);
    bus.emit('mech:land', { x: p.x, y: p.y, z: p.z, team: 1 });
    u.rig.trigger('land', 1);
    e.invuln = false; e.noHit = false;
    u.st = u.dormant ? E_DORMANT : E_STALK; u.stT = 0;
    if (!u.dormant) G.state.wave.enemyMechs++;
    if (u.boss) bus.emit('boss:spawn', { ent: e });
  }
  if (u.st === E_DORMANT) {
    e.vel.x = e.vel.z = 0; groundMove(u, dt, 0, 0, 0, 5);
    if (u.abandonT >= 0) { u.abandonT -= dt; if (u.abandonT <= 0) { e.alive = false; u.dead = true; u.deathInfo = null; u.counted = false; deathQ.push(u); } }
    else if (!u.owner || u.owner.dead) u.abandonT = 2.5;
    anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.aimYaw = 0; anim.aimPitch = -0.3; anim.grounded = true; anim.vy = 0; anim.jet = 0; anim.dead = false; anim.heat = 0;
    return;
  }
  // ---- Phase B: disabled (hijackable), staggered, or in someone's grip: no steering, no aiming, no firing ----
  if (!u.wasDisabled && e.hp < e.maxHp * TUNE.disabledAt && e.alive) disableRig(u);
  if (u.disT >= 0 || u.stagT > 0 || e.held) {
    if (u.disT >= 0) {
      u.disT -= dt;
      if (G.fx && (G.frame & 3) === 0) G.fx.emit('spark', p.x + rr(-1.2, 1.2), p.y + D.h * rr(0.4, 0.8), p.z + rr(-1.2, 1.2), 0, 1, 0, 1);
      if (u.disT < 0) { e.disabled = false; G.ents.damage(e, 1e6, { type: 'explosion', src: null }); return; }     // nobody took it: reactor goes
    }
    if (u.stagT > 0) { u.stagT -= dt; if (u.stagT <= 0) { e.staggered = false; u.thinkT = 0; } }
    e.vel.x = damp(e.vel.x, 0, 3, dt); e.vel.z = damp(e.vel.z, 0, 3, dt);
    if (!e.held) { e.vel.y -= GRAV * dt; G.grid.moveBody(b, dt); }
    u.wantMove = false; u.stuck = 0;
    anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.aimYaw = clamp(wrapPi(u.aimYaw - u.yaw), -1.5, 1.5); anim.aimPitch = u.disT >= 0 ? -0.6 : u.aimPitch;
    anim.grounded = b.onGround; anim.vy = e.vel.y; anim.jet = 0; anim.dead = false; anim.heat = 0; anim.brace = u.disT >= 0 ? 1 : 0; anim.crouch = u.disT >= 0 ? 1 : 0;
    return;
  }
  if (u.boss) bossPhase(u, dt, tgt);
  u.fireCd -= dt; u.punchCd -= dt; u.salvoCd -= dt; u.jetCd -= dt; u.meleeCd -= dt; u.thinkT -= dt; u.siegeCd -= dt; u.stompCd -= dt;
  const big = tgt && tgt.height > 4;
  const noArms = !u.armL && !u.armR;
  const P = G.state.player, braced = (big && P.brace === true) || (u.boss && u.bph === 1), pShield = big && tgt.shield && tgt.shield.on;
  if (u.thinkT <= 0) {
    const dtT = 0.2 + rnd() * 0.06; u.thinkT = dtT; enemy.stats.thinks++;
    stuckCheck(u, dtT); separation(u, enemy.list);
    if (u.stuck >= 9) relocate(u);
    if (tgt) {
      perceive(u, tgt);
      if (u.los) u.noLosT = 0; else u.noLosT += dtT;
      const r = nav.waypoint(u.fi, p.x, p.z, _wp, 5); u.navR = r;
      if (r === 2 || r === 0) { u.wx = tgt.pos.x; u.wz = tgt.pos.z; } else { u.wx = _wp.x; u.wz = _wp.z; }
      u.mode = u.hold ? (holdPost(u) ? 2 : 1) : 0;
      // close in for a punch now and then (always against a pilot who is under our feet)
      if (u.meleeT > 0) { u.meleeT -= dtT; if (u.meleeT <= 0) u.meleeCd = rr(7, 12); }
      else if (u.meleeCd <= 0 && big && u.dist < 48) u.meleeT = rr(5, 8);
      if (u.boss && u.bph === 3) u.meleeT = 2;           // enraged: always closing
      if (braced) u.meleeT = 0;                          // do not walk into a braced Bastion
      else if ((noArms || pShield) && u.dist < 60) u.meleeT = Math.max(u.meleeT, 1);   // armless: ram. Shield up: get round it
      if (u.locked) { u.locked = false; u.strafe = -u.strafe; u.openT = rr(2, 4); if (u.jetCd > 2) u.jetCd = 2; }   // swarm lock: jink
      // jump jets: over rubble, out of a jam, or to cut a long detour
      if (b.onGround && u.jetCd <= 0 && !u.telling && u.punchT < 0) {
        const fd = nav.fieldDist(u.fi, p.x, p.z);
        const detour = u.dist > 18 && u.dist < 70 && fd > u.dist * 2.2 + 25;
        const up = tgt.pos.y - p.y > 5 && u.dist < 35;
        const rage = u.boss && u.bph === 3 && u.dist > 13 && u.dist < 70;
        if (u.stuck >= 3 || detour || up || rage || (u.meleeT > 0 && u.dist > 22 && u.dist < 45 && rnd() < 0.25)) {
          const dx = tgt.pos.x - p.x, dz = tgt.pos.z - p.z, d = u.dist || 1, land = Math.max(0, Math.min(d - (D.r + tgt.radius + 3), 38));
          const hs = clamp(land / 2.3, 4, 16);
          e.vel.x = dx / d * hs; e.vel.z = dz / d * hs; e.vel.y = 17 + (up ? Math.min(8, (tgt.pos.y - p.y) * 0.5) : 0);
          b.onGround = false; u.jumped = true; u.jetting = true; u.jetT = 0.9; u.jetCd = rage ? rr(5.5, 7.5) : rr(8, 13); u.stuck = 0;
          if (u.boss) showRing(u, p.x + dx / d * land, tgt.pos.y, p.z + dz / d * land, 1.5);
          u.rig.trigger('jump'); bus.emit('jet', { ent: e, on: true });
        }
      }
    }
  }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt);
  // ---- movement ----
  let mx = 0, mz = 0, sp = 0;
  const inAir = !b.onGround;
  if (tgt && !u.telling && u.punchT < 0) {
    const dx = tgt.pos.x - p.x, dz = tgt.pos.z - p.z, d = u.dist || 1;
    const reach = D.r + tgt.radius + D.reach - 1.2;
    const wantMelee = (u.meleeT > 0 || (!big && u.dist < 12)) && u.mode === 0;
    if (wantMelee) {
      if (d > reach * 0.7) {
        if (u.navR === 1 && d > 14) { mx = u.wx - p.x; mz = u.wz - p.z; } else { mx = dx; mz = dz; }
        if (pShield && d < 30 && d > reach) {            // come at a raised shield from the side it does not cover
          const sy = tgt.shield.yaw || 0, fx = Math.sin(sy), fz = Math.cos(sy), front = (-dx * fx - dz * fz) / d;
          if (front > 0.2) { mx = dx / d - fz * u.strafe * 1.3; mz = dz / d + fx * u.strafe * 1.3; }
        }
        sp = D.speed * 1.15;
      }
    }
    else if (u.los && d < (braced ? 70 : 44)) {
      const rad = braced ? (d < 42 ? -0.9 : d > 58 ? 0.5 : 0) : d < 20 ? -0.9 : d > 34 ? 0.6 : 0;
      mx = -dz / d * u.strafe + dx / d * rad; mz = dx / d * u.strafe + dz / d * rad; sp = D.speed * 0.5;
      u.openT -= dt; if (u.openT <= 0 || b.hitWall) { u.openT = rr(3, 6); u.strafe = -u.strafe; }
    } else { mx = u.wx - p.x; mz = u.wz - p.z; sp = D.speed; }
    if (u.mode === 2) { mx = u.wx - p.x; mz = u.wz - p.z; sp = D.speed; } else if (u.mode === 1 && !u.los) sp = 0;
    if (u.boss && u.bph === 3) sp *= 1.6;
    if (braced && !u.los && d < 45 && u.mode === 0) sp = 0;
  }
  const ml = Math.sqrt(mx * mx + mz * mz); if (ml > 1e-3) { mx /= ml; mz /= ml; } else sp = 0;
  if (e.shield && e.shield.on) sp *= 0.7;
  if (inAir) {                                         // ballistic hop under jets
    if (u.jetting) {
      u.jetT -= dt; e.vel.y += GRAV * 0.55 * dt;
      if (G.fx) { sockPos(u, 'jetL', _o); G.fx.emit('jet', _o.x, _o.y, _o.z, 0, -1, 0, 1); sockPos(u, 'jetR', _o); G.fx.emit('jet', _o.x, _o.y, _o.z, 0, -1, 0, 1); }
      if (u.jetT <= 0) { u.jetting = false; bus.emit('jet', { ent: e, on: false }); }
    }
    e.vel.y -= GRAV * dt; u.wasGround = false; G.grid.moveBody(b, dt); u.wantMove = false;
    if (b.hitWall) carveAhead(u, Math.sign(e.vel.x) || 0, 0, 0.5, D.h, 1.2, 120), carveAhead(u, 0, Math.sign(e.vel.z) || 0, 0.5, D.h, 1.2, 120);
    if (b.onGround && b.landSpeed > 7) rigLand(u, b.landSpeed > 14);
    if (b.onGround && u.ring && u.st !== E_DROP) hideRing(u);
  } else {
    if (sp > 0) u.yaw = dampAngle(u.yaw, Math.atan2(mx, mz), 2.2, dt);
    else if (tgt) u.yaw = dampAngle(u.yaw, Math.atan2(tgt.pos.x - p.x, tgt.pos.z - p.z), 1.5, dt);
    groundMove(u, dt, mx, mz, sp, 2.5);
    if (b.onGround && !u.wasGround && b.landSpeed > 10) rigLand(u, false);
    // wade through whatever is in the way; punch what will not give
    if (sp > 0) {
      u.carveT -= dt;
      if (u.carveT <= 0 || b.hitWall) {
        u.carveT = 0.12;
        const n = carveAhead(u, mx, mz, 0.55, D.h, 1.0, 100);
        if (n > 0 && u.dist < 50) bus.emit('shake', { amount: 0.05 });
        if (b.hitWall && n === 0) u.ramT += 0.12; else if (!b.hitWall) u.ramT = 0;
        if (u.ramT > 0.5 && u.punchCd <= 0 && u.punchT < 0 && noArms) { carveAhead(u, mx, mz, 0.55, D.h, 1.4, 190); u.punchCd = 0.9; u.ramT = 0; }
        else if (u.ramT > 0.5 && u.punchCd <= 0 && u.punchT < 0) { pickArm(u); u.punchT = 0.4; u.ax = mx; u.ay = 0; u.az = mz; u.pLock = false; u.rig.trigger('punch', u.punchSide); u.ramT = 0; }
      }
      if (!u.footSeen) { u.stepT -= dt * (sp / D.speed); if (u.stepT <= 0) { u.stepT = 0.62; footstep(u, p.x, p.y, p.z); } }
    }
  }
  // ---- torso + weapons ----
  let aligned = false;
  if (tgt) {
    aimPoint(u, tgt, u.w1, 0.55);
    const want = Math.atan2(_a.x - p.x, _a.z - p.z), err = wrapPi(want - u.aimYaw), stepA = 1.7 * dt;
    u.aimYaw += clamp(err, -stepA, stepA);
    u.aimPitch = damp(u.aimPitch, Math.atan2(_a.y - (p.y + D.eye), u.dist || 1), 5, dt);
    aligned = Math.abs(err) < 0.14;
    const rel = wrapPi(u.aimYaw - u.yaw);
    if (Math.abs(rel) > 1.3 && sp === 0) u.yaw = dampAngle(u.yaw, u.aimYaw, 2, dt);
    // punch
    if (u.punchT >= 0) {
      u.punchT -= dt;
      if (u.punchT < 0) {
        let dx = u.ax, dy = u.ay, dz = u.az;
        if (u.pLock) { sockPos(u, u.punchSide === 'L' ? 'handL' : 'handR', _h); dx = tgt.pos.x - p.x; dz = tgt.pos.z - p.z; dy = big ? 0 : (tgt.pos.y + 0.9 - (p.y + D.h * 0.55)); const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; dx /= l; dy /= l; dz /= l; }
        rigPunch(u, u.pLock ? tgt : null, dx, dy, dz);
        u.punchCd = u.pLock ? (u.boss ? rr(2.6, 3.4) : rr(1.3, 1.9)) : 0.7; u.punchT = -1;
      }
    } else if (!inAir && u.punchCd <= 0 && u.dist < D.r + tgt.radius + D.reach - 0.6 && tgt.pos.y < p.y + D.h * 0.8 && tgt.pos.y + tgt.height > p.y - 1) {
      const wy = Math.atan2(tgt.pos.x - p.x, tgt.pos.z - p.z);
      if (noArms) {                                        // nothing left to swing: stomp
        if (u.stompCd <= 0) { u.stompCd = 2.2; u.punchCd = 1; rigStomp(u); }
      } else if (Math.abs(wrapPi(wy - u.yaw)) < 0.9) { pickArm(u); u.punchT = big ? 0.5 : 0.65; u.pLock = true; u.rig.trigger('punch', u.punchSide); }
      else u.yaw = dampAngle(u.yaw, wy, 4, dt);
    }
    // Aegis-style shield (guardian loadout): up while taking fire from the front, recharges when lowered
    const sh = e.shield;
    if (sh) {
      const want = (u.boss ? !u.telling : G.time - u.hitT < 2.5) && sh.hp > (sh.on ? 0 : (sh.max || TUNE.shieldHp) * 0.35) && u.punchT < 0;
      if (sh.on && sh.hp <= 0) { sh.hp = 0; u.shDown = G.time; }
      if (want !== sh.on) { sh.on = want; if (!want) u.shDown = G.time; bus.emit('shield', { ent: e, on: want }); }
      const smax = sh.max || TUNE.shieldHp;
      if (!sh.on && G.time - u.shDown > 2.5 && sh.hp < smax) sh.hp = Math.min(smax, sh.hp + (u.boss ? 110 : 45) * dt);
      sh.yaw = u.aimYaw;
      if (u.rig.setShield) u.rig.setShield(sh.on ? Math.max(0.15, sh.hp / smax) : 0);
    }
    // siege gun (heavy loadout): plant, long obvious charge, one building-breaking shell
    if (u.w3) {
      if (u.siegeT >= 0) {
        u.siegeT -= dt;
        if (u.glow) { u.glow.visible = true; const k = 0.8 + 2.2 * (1 - sat(u.siegeT / 1.6)) + 0.2 * Math.sin(G.time * 45); u.glow.scale.set(k, k, k); }
        const wind = !!(u.w3.def && u.w3.def.windup);     // e_siege: the weapon itself holds the shell for its tell; keep feeding it the aim
        if (wind && u.siegeT > 0.6) { u.carveT2 -= dt; if (u.carveT2 <= 0) { u.carveT2 = 0.15; if (u.los) { aimPoint(u, tgt, u.w3, 0.3); u.ax = _a.x; u.ay = _a.y; u.az = _a.z; if (u.boss) showRing(u, u.ax, tgt.pos.y, u.az, 1.15); aimPoint(u, tgt, u.w1, 0.55); } shoot(u, u.w3, 'muzzleR', u.ax, u.ay, u.az, 0, null); } }
        if (u.siegeT < 0) {
          if (!wind) shoot(u, u.w3, 'muzzleR', u.ax, u.ay, u.az, 0.012, 'fireR'); else u.rig.trigger('fireR');
          if (u.boss) hideRing(u); u.salvoCd = Math.max(u.salvoCd, 5);
          bus.emit('shake', { amount: u.dist < 50 ? 0.25 : 0.08 });
          u.telling = false; warn(false); if (u.glow) u.glow.visible = false; u.siegeCd = u.boss ? (u.bph === 1 ? rr(5, 7) : rr(10, 14)) : rr(9, 13); u.fireCd = 1.5;
        }
      } else if (u.siegeCd <= 0 && !u.telling && aligned && u.punchT < 0 && !inAir && u.dist > 18 && u.dist < 110 && (u.los || u.noLosT > 3) && u.w3.canFire()) {
        u.telling = true; warn(true); u.siegeT = u.w3.def && u.w3.def.windup ? u.w3.def.windup : u.boss ? 2.2 : 1.6; u.burstN = 0; u.carveT2 = 0.15;
        if (u.los) aimPoint(u, tgt, u.w3, 0.6); else _a.set(tgt.pos.x, tgt.pos.y + tgt.height * 0.5, tgt.pos.z);
        u.ax = _a.x; u.ay = _a.y; u.az = _a.z; if (u.boss) showRing(u, u.ax, tgt.pos.y, u.az, 1.15); if (u.w3.def && u.w3.def.windup) shoot(u, u.w3, 'muzzleR', u.ax, u.ay, u.az, 0, null); aimPoint(u, tgt, u.w1, 0.55);
      }
    }
    // salvo: charge (tell) then ripple
    if (u.telling && u.siegeT >= 0) { /* siege charge owns the tell */ }
    else if (u.telling) {
      u.tellT -= dt;
      if (u.glow) { u.glow.visible = true; const k = 0.6 + 1.6 * (1 - sat(u.tellT / 1.3)) + 0.15 * Math.sin(G.time * 40); u.glow.scale.set(k, k, k); }
      if (u.tellT <= 0) {
        aimPoint(u, tgt, u.w2, 0.5);
        const swarm = u.w2.id === 'e_swarm';
        shoot(u, u.w2, 'rocketPod', _a.x, _a.y + (swarm ? 10 + u.dist * 0.25 : big ? 0 : 0.3), _a.z, 0.02, 'fireRocket');
        u.telling = false; warn(false); if (u.glow) u.glow.visible = false;
        u.salvoCd = swarm ? rr(20, 28) : rr(9, 14); u.fireCd = 1.2; if (u.w3) u.siegeCd = Math.max(u.siegeCd, 5);
      }
    } else if (u.salvoCd <= 0 && !noArms && u.siegeT < 0 && u.los && aligned && u.dist > 14 && u.dist < 80 && u.punchT < 0 && !inAir && u.w2.canFire()) {
      u.telling = true; u.tellT = Math.max(1.2, (u.w2.def && u.w2.def.tell) || 1.2); warn(true); u.burstN = 0;
    }
    // pulse bursts
    if (!u.telling && u.punchT < 0) {
      if (u.burstN > 0) {
        if (!u.los && G.time - u.lastSeenT > 0.8) { u.burstN = 0; u.fireCd = 1; }
        else if (aligned && u.w1.canFire()) {
          let side = u.w1.side || u.punchSide;
          const okL = u.armL && u.loadout !== 'guardian', okR = u.armR && u.loadout !== 'siege';
          if (side === 'L' ? !okL : !okR) side = side === 'L' ? 'R' : 'L';
          if (shoot(u, u.w1, side === 'L' ? 'muzzleL' : 'muzzleR', _a.x, _a.y, _a.z, spreadFor(u, tgt) * (big ? 1 : 2.2), side === 'L' ? 'fireL' : 'fireR', side === 'L' ? OPT_L : OPT_R)) {
            if (!u.w1.side) u.punchSide = side === 'L' ? 'R' : 'L';
            if (--u.burstN <= 0) u.fireCd = rr(1.5, 2.6);
          }
        } else if (u.w1.overheated) { u.burstN = 0; u.fireCd = 2; }
      } else if (u.fireCd <= 0 && u.los && aligned && u.dist < 120 && ((u.armL && u.loadout !== 'guardian') || (u.armR && u.loadout !== 'siege'))) u.burstN = (u.armL && u.armR && u.loadout === 'striker' ? 6 : 4) + ((rnd() * 4) | 0);
    }
  }
  const vx = e.vel.x, vz = e.vel.z, s = Math.sin(u.yaw), c = Math.cos(u.yaw);
  anim.speed = Math.sqrt(vx * vx + vz * vz); anim.fwd = clamp((vx * s + vz * c) / D.speed, -1, 1); anim.strafe = clamp((-vx * c + vz * s) / D.speed, -1, 1);
  anim.aimYaw = clamp(wrapPi(u.aimYaw - u.yaw), -1.5, 1.5); anim.aimPitch = u.aimPitch; anim.grounded = b.onGround; anim.vy = e.vel.y; anim.jet = u.jetting ? 1 : 0; anim.dead = false; anim.heat = u.w1.heat || 0; anim.shield = e.shield && e.shield.on ? 1 : 0;
}
const PROF = G.params.has('eprof');
const NO_PLAYERS = [];
let puppetMode = false;
const OPT_L = { side: 'L' }, OPT_R = { side: 'R' }, OPT_T = { target: null };

// ============================================================================
// AIRCRAFT
// ============================================================================
// Steer an aircraft's velocity toward a wanted velocity, keep it above the terrain and out of walls.
function fly(u, dt, wvx, wvy, wvz, accel, clearance) {
  const e = u.ent, p = e.pos, v = e.vel, g = G.grid;
  // look ahead along the wanted course
  const sp = Math.sqrt(wvx * wvx + wvz * wvz);
  if (sp > 0.5) {
    const ax = p.x + wvx / sp * (2 + sp * 0.45), az = p.z + wvz / sp * (2 + sp * 0.45);
    const top = Math.max(g.topBelow(ax, 47.9, az), g.topBelow(p.x + wvx / sp * 1.5, 47.9, p.z + wvz / sp * 1.5));
    if (top + clearance > p.y) {
      if (top - p.y < 9 || u.type === T_GUNSHIP) wvy = Math.max(wvy, (top + clearance - p.y) * 2.5 + 2);          // hop the roof
      else { const s = u.strafe, t = wvx; wvx = -wvz * s * 0.9 + wvx * 0.1; wvz = t * s * 0.9 + wvz * 0.1; wvy = Math.max(wvy, 2); }   // too tall: go round
    }
  }
  const here = g.topBelow(p.x, 47.9, p.z);
  if (p.y < here + clearance * 0.6 && p.y > here - 3) wvy = Math.max(wvy, 4);
  v.x = damp(v.x, wvx + u.sepX, accel, dt); v.y = damp(v.y, wvy, accel * 1.3, dt); v.z = damp(v.z, wvz + u.sepZ, accel, dt);
  let nx = p.x + v.x * dt, ny = p.y + v.y * dt, nz = p.z + v.z * dt;
  const r = u.D.r * 0.7;
  if (g.boxSolid(nx - r, ny, nz - r, nx + r, ny + u.D.h, nz + r)) {
    if (!g.boxSolid(p.x - r, ny + 0.2, p.z - r, p.x + r, ny + 0.2 + u.D.h, p.z + r)) { nx = p.x; nz = p.z; ny = p.y + 5 * dt; v.x *= 0.5; v.z *= 0.5; v.y = 5; }
    else { nx = p.x; nz = p.z; ny = p.y + 6 * dt; v.x = -v.x * 0.3; v.z = -v.z * 0.3; v.y = 6; u.strafe = -u.strafe; }
  }
  p.set(clamp(nx, -30, WX + 30), Math.max(ny, 1), clamp(nz, -30, WZ + 30));
}
function airSeparation(u, list) {
  const p = u.ent.pos; let sx = 0, sz = 0;
  for (let i = 0; i < list.length; i++) {
    const o = list[i]; if (o === u || o.body) continue;
    const q = o.ent.pos, dx = p.x - q.x, dz = p.z - q.z, dy = p.y - q.y, rs = (u.D.r + o.D.r) * 2.2;
    const d2 = dx * dx + dz * dz + dy * dy; if (d2 > rs * rs || d2 < 1e-4) continue;
    const d = Math.sqrt(d2), f = (rs - d) / rs * 6; sx += dx / d * f; sz += dz / d * f;
  }
  u.sepX = sx; u.sepZ = sz;
}
function updDrone(u, dt, tgt) {
  const e = u.ent, p = e.pos, D = u.D, w = u.w1;
  u.fireCd -= dt; u.thinkT -= dt; u.runT -= dt;
  if (u.thinkT <= 0) {
    u.thinkT = 0.2 + rnd() * 0.08; enemy.stats.thinks++;
    airSeparation(u, enemy.list);
    if (tgt) perceive(u, tgt);
  }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt);
  let wvx = 0, wvy = 0, wvz = 0;
  if (tgt) {
    const tx = tgt.pos.x, tz = tgt.pos.z, ty = tgt.pos.y + tgt.height;
    if (u.st === A_RUN) {                               // strafing pass straight over the target
      const dx = u.rx - p.x, dz = u.rz - p.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
      wvx = dx / d * D.speed * 1.25; wvz = dz / d * D.speed * 1.25; wvy = (ty + 4.5 - p.y) * 1.6;
      if (d < 3 || u.stT > 6) { u.st = A_ORBIT; u.stT = 0; u.runT = rr(4.5, 8); u.phase = Math.atan2(p.x - tx, p.z - tz); }
      if (u.los && u.dist < 38 && u.fireCd <= 0 && u.burstN === 0) u.burstN = 5;
    } else {
      u.phase += u.strafe * dt * D.speed * 0.55 / u.orbR;
      const ox = tx + Math.sin(u.phase) * u.orbR, oz = tz + Math.cos(u.phase) * u.orbR;
      const dx = ox - p.x, dz = oz - p.z, d = Math.sqrt(dx * dx + dz * dz) || 1, s = Math.min(D.speed, d * 1.6);
      wvx = dx / d * s; wvz = dz / d * s; wvy = (ty + u.alt + Math.sin(G.time * 1.3 + u.phase) * 1.2 - p.y) * 1.5;
      if (u.runT <= 0 && u.dist < 45 && u.los) {
        const ddx = tx - p.x, ddz = tz - p.z, dd = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
        u.st = A_RUN; u.stT = 0; u.rx = tx + ddx / dd * 16; u.rz = tz + ddz / dd * 16;
      }
      if (u.los && u.dist < 40 && u.fireCd <= 0 && u.burstN === 0) u.burstN = 3;
    }
    if (u.burstN > 0) {
      if (!u.los) { u.burstN = 0; u.fireCd = 1; }
      else if (w.canFire()) {
        aimPoint(u, tgt, w, 0.5);
        if (shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, spreadFor(u, tgt), 'fireR') && --u.burstN <= 0) u.fireCd = u.st === A_RUN ? 0.6 : rr(2.2, 3.8);
      } else if (w.clip === 0 && !w.reloading && w.reload) { w.reload(e); u.burstN = 0; u.fireCd = 1.5; }
    }
  }
  u.stT += dt;
  fly(u, dt, wvx, clamp(wvy, -7, 7), wvz, 2.6, 2.2);
  const v = e.vel, hs = Math.sqrt(v.x * v.x + v.z * v.z);
  const face = tgt && (u.los || u.dist < 30) ? Math.atan2(tgt.pos.x - p.x, tgt.pos.z - p.z) : hs > 1 ? Math.atan2(v.x, v.z) : u.yaw;
  u.yaw = dampAngle(u.yaw, face, 6, dt);
  const s = Math.sin(u.yaw), c = Math.cos(u.yaw);
  u.rig.root.rotation.x = damp(u.rig.root.rotation.x, clamp((v.x * s + v.z * c) * 0.035, -0.5, 0.5), 5, dt);
  u.rig.root.rotation.z = damp(u.rig.root.rotation.z, clamp((-v.x * c + v.z * s) * -0.04, -0.6, 0.6), 5, dt);
  u.aimYaw = u.yaw; u.aimPitch = tgt ? Math.atan2(tgt.pos.y + tgt.height * 0.5 - p.y, u.dist || 1) : 0;
  anim.speed = hs; anim.fwd = 1; anim.strafe = 0; anim.aimYaw = 0; anim.aimPitch = u.aimPitch; anim.grounded = false; anim.vy = v.y; anim.jet = 1; anim.dead = false; anim.heat = 0;
}
function updGunship(u, dt, tgt) {
  const e = u.ent, p = e.pos, D = u.D, v = e.vel, P = G.state.player;
  u.fireCd -= dt; u.thinkT -= dt; u.runT -= dt; u.breakCd -= dt;
  if (u.thinkT <= 0) {
    u.thinkT = 0.2 + rnd() * 0.08; enemy.stats.thinks++;
    airSeparation(u, enemy.list);
    if (tgt) perceive(u, tgt);
    const lk = P.lock;
    const lockedOn = u.locked || (lk && lk.target === e && (lk.locked || lk.progress > 0.55));
    if (lockedOn && u.st !== A_BREAK && u.breakCd <= 0) {           // break off under lock
      if (u.telling) { u.telling = false; warn(false); }
      u.st = A_BREAK; u.stT = 0; u.breakT = rr(3.5, 5); u.burstN = 0; u.rocketN = 0; u.strafe = rnd() < 0.5 ? -1 : 1;
    }
    u.locked = false;
  }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt);
  let wvx = 0, wvy = 0, wvz = 0, wantAlt = 30, face = u.yaw;
  if (tgt) {
    const tx = tgt.pos.x, tz = tgt.pos.z, ty = tgt.pos.y;
    const dx = tx - p.x, dz = tz - p.z, d = Math.sqrt(dx * dx + dz * dz) || 1;
    if (u.st === A_BREAK) {
      const a = Math.atan2(-dx, -dz) + u.strafe * (0.9 + 0.5 * Math.sin(u.stT * 2.5));
      wvx = Math.sin(a) * D.speed * 1.5; wvz = Math.cos(a) * D.speed * 1.5; wantAlt = ty + 34 + 5 * Math.sin(u.stT * 3);
      face = Math.atan2(v.x, v.z);
      if (u.stT > u.breakT) { u.st = A_ORBIT; u.stT = 0; u.breakCd = rr(7, 10); u.runT = rr(6, 10); u.phase = Math.atan2(-dx, -dz); }
    } else if (u.st === A_RUN) {
      const rx = u.rx - p.x, rz = u.rz - p.z, rd = Math.sqrt(rx * rx + rz * rz) || 1;
      wvx = rx / rd * D.speed * 1.3; wvz = rz / rd * D.speed * 1.3; wantAlt = ty + 17;
      face = Math.atan2(v.x, v.z);
      const closing = dx * v.x + dz * v.z > 0;
      if (closing && d < 75 && u.los && u.fireCd <= 0 && u.burstN === 0) u.burstN = 22;
      if (closing && d < 62 && u.los && u.rocketN === 0 && !u.telling && u.w2.canFire() && u.rocketT <= 0) { u.telling = true; u.tellT = (u.w2.def && u.w2.def.tell) || 0.7; warn(true); }
      if (rd < 6 || u.stT > 9) { u.st = A_ORBIT; u.stT = 0; u.runT = rr(13, 19); u.phase = Math.atan2(-dx, -dz); u.burstN = 0; }
    } else {
      u.phase += u.strafe * dt * D.speed / u.orbR;
      const ox = tx + Math.sin(u.phase) * u.orbR, oz = tz + Math.cos(u.phase) * u.orbR;
      const qx = ox - p.x, qz = oz - p.z, qd = Math.sqrt(qx * qx + qz * qz) || 1, s = Math.min(D.speed, qd * 1.2 + 3);
      wvx = qx / qd * s; wvz = qz / qd * s; wantAlt = ty + u.alt;
      face = Math.atan2(dx, dz);
      if (u.los && d < 95 && u.fireCd <= 0 && u.burstN === 0 && u.st === A_ORBIT) u.burstN = 12;
      if (u.runT <= 0 && d < 90 && d > 30) { u.st = A_RUN; u.stT = 0; u.rx = tx + dx / d * 42; u.rz = tz + dz / d * 42; u.rocketT = 0; }
    }
    // chain gun
    if (u.burstN > 0) {
      const w = u.w1;
      if (!u.los) { u.burstN = 0; u.fireCd = 1.5; }
      else if (w.canFire()) {
        aimPoint(u, tgt, w, 0.5);
        if (shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, spreadFor(u, tgt), 'fireR') && --u.burstN <= 0) u.fireCd = rr(2.2, 3.6);
      } else if (w.clip === 0 && !w.reloading && w.reload) { w.reload(e); u.burstN = 0; u.fireCd = 2; }
    }
    // rockets: tell, then a ripple of four
    u.rocketT -= dt;
    if (u.telling) {
      u.tellT -= dt;
      if (u.tellT <= 0) { u.telling = false; warn(false); u.rocketN = 4; u.rocketT = 0; }
    } else if (u.rocketN > 0 && u.rocketT <= 0) {
      aimPoint(u, tgt, u.w2, 0.5);
      if (u.w2.canFire()) { OPT_T.target = tgt; shoot(u, u.w2, u.rocketN & 1 ? 'rocketPod' : 'aaPod', _a.x, _a.y, _a.z, 0.03, 'fireRocket', OPT_T); OPT_T.target = null; u.rocketN--; u.rocketT = 0.28; if (u.rocketN === 0) u.rocketT = 8; }
      else if (u.w2.clip === 0 || u.w2.reloading) { u.rocketN = 0; u.rocketT = 8; }
    }
  }
  u.stT += dt;
  const roof = Math.max(G.grid.topBelow(p.x, 47.9, p.z), G.grid.topBelow(p.x + v.x * 1.2, 47.9, p.z + v.z * 1.2));
  wantAlt = Math.max(wantAlt, roof + 6);
  wvy = clamp((wantAlt - p.y) * 1.2, -6, 8);
  fly(u, dt, wvx, wvy, wvz, u.st === A_BREAK ? 1.6 : 1.1, 5);
  const hs = Math.sqrt(v.x * v.x + v.z * v.z);
  const prev = u.yaw; u.yaw = dampAngle(u.yaw, face, 2.2, dt);
  const s = Math.sin(u.yaw), c = Math.cos(u.yaw), root = u.rig.root;
  root.rotation.x = damp(root.rotation.x, clamp((v.x * s + v.z * c) * 0.012, -0.3, 0.35) + (u.st === A_RUN ? 0.12 : 0), 3, dt);
  root.rotation.z = damp(root.rotation.z, clamp((-v.x * c + v.z * s) * -0.02 + wrapPi(u.yaw - prev) / Math.max(dt, 1e-3) * -0.25, -0.55, 0.55), 3, dt);
  u.aimYaw = tgt ? Math.atan2(tgt.pos.x - p.x, tgt.pos.z - p.z) : u.yaw; u.aimPitch = tgt ? Math.atan2(tgt.pos.y + tgt.height * 0.5 - p.y, u.dist || 1) : 0;
  anim.speed = hs; anim.fwd = 1; anim.strafe = 0; anim.aimYaw = wrapPi(u.aimYaw - u.yaw); anim.aimPitch = u.aimPitch; anim.grounded = false; anim.vy = v.y; anim.jet = 1; anim.dead = false; anim.heat = 0;
}

// ============================================================================
// TURRETS (static emplacements)
// ============================================================================
function updTurret(u, dt, tgt) {
  const e = u.ent, p = e.pos, D = u.D, w = u.w1, rpg = w.id === 'e_rpg';
  u.fireCd -= dt; u.thinkT -= dt;
  if (u.thinkT <= 0) { u.thinkT = 0.25 + rnd() * 0.1; enemy.stats.thinks++; if (tgt) perceive(u, tgt); else u.los = false; }
  if (tgt && u.los) u.seeT += dt; else u.seeT = Math.max(0, u.seeT - dt);
  // it sits on whatever is under it: if that goes, so does the turret
  e.vel.x = e.vel.z = 0; e.vel.y -= GRAV * dt; G.grid.moveBody(u.body, dt);
  if (u.body.landSpeed > 11) { G.ents.damage(e, 1e5, { type: 'fall', src: null }); return; }
  if ((G.frame + u.id) % 20 === 0 && G.grid.boxSolid(p.x - 0.6, p.y + 0.4, p.z - 0.6, p.x + 0.6, p.y + D.h, p.z + 0.6)) G.grid.unstick(u.body, 6);
  let aligned = false;
  if (tgt && G.time - u.lastSeenT < 3) {
    aimPoint(u, tgt, w, 0.5);
    const err = wrapPi(Math.atan2(_a.x - p.x, _a.z - p.z) - u.aimYaw), st = 2.2 * dt;
    u.aimYaw += clamp(err, -st, st); aligned = Math.abs(err) < 0.1;
    u.aimPitch = damp(u.aimPitch, Math.atan2(_a.y - (p.y + D.eye), u.dist || 1), 6, dt);
    if (u.telling) {
      u.tellT -= dt;
      if (u.glow) { u.glow.visible = true; const k = 0.3 + 0.7 * (1 - sat(u.tellT / 0.9)); u.glow.scale.set(k, k, k); }
      if (u.tellT <= 0) { u.telling = false; warn(false); if (u.glow) u.glow.visible = false; if (rpg) { shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, 0.02, 'fireR'); u.fireCd = rr(4.5, 6.5); } else u.burstN = 10; }
    } else if (u.burstN > 0) {
      if (!u.los) { u.burstN = 0; u.fireCd = 1; }
      else if (w.canFire()) { if (shoot(u, w, 'muzzleR', _a.x, _a.y, _a.z, spreadFor(u, tgt), 'fireR') && --u.burstN <= 0) u.fireCd = rr(2, 3.2); }
      else if (w.clip === 0 && !w.reloading && w.reload) { w.reload(e); u.burstN = 0; u.fireCd = 2; }
    } else if (u.los && aligned && u.fireCd <= 0 && w.canFire()) { u.telling = true; u.tellT = rpg ? 0.9 : 0.5; warn(true); }
  } else if (u.telling) { u.telling = false; warn(false); if (u.glow) u.glow.visible = false; }
  anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.aimYaw = wrapPi(u.aimYaw - u.yaw); anim.aimPitch = u.aimPitch; anim.grounded = true; anim.vy = 0; anim.jet = 0; anim.dead = false; anim.heat = 0;
}

// ============================================================================
// DEATHS
// ============================================================================
function handleDeath(u) {
  const list = enemy.list, i = list.indexOf(u); if (i >= 0) list.splice(i, 1);
  const e = u.ent, p = e.pos, info = u.deathInfo, killer = info && info.src ? info.src : null, W = G.state.wave;
  G.ents.remove(e);
  if (u.counted) { dir.killed++; u.counted = false; }
  if (G.net && G.net.online && !puppetMode) { grave.push(e.netId, G.time); }
  if (u.boss && !puppetMode) for (let k = 0; k < list.length; k++) if (list[k].owner === u && list[k].type === T_DRONE && !list[k].dead) G.ents.damage(list[k].ent, 1e5, { type: 'explosion', src: killer });
  const wasTelling = u.telling;
  const rig = u.rig;
  if (u.glow) { u.glow.removeFromParent(); u.glow = null; }
  if (u.ring) { u.ring.removeFromParent(); u.ring.material.dispose(); u.ring = null; }
  if (u.token) { u.token = false; tokens.used--; }
  if (wasTelling) { u.telling = false; warn(false); }
  releaseCover(u);
  if (u.jetting) { u.jetting = false; bus.emit('jet', { ent: e, on: false }); }
  rig.onFootstep = null;
  try { rig.trigger('death'); } catch (er) {}
  switch (u.type) {
    case T_SOLDIER:
      X.burst(p.x, p.y + 1, p.z, { count: 7, colors: COL_SOLDIER, speed: 4.5, size: 0.16, up: 3 });
      if (u.variant === 'ace' && u.myRig && !u.myRig.dead && u.myRig.dormant) msg('ACE DOWN', 'Its rig is powering down', 'good', 2.5);
      u.rig = null; rig.root.removeFromParent(); try { rig.dispose(); } catch (er) {}
      break;
    case T_DRONE:
      X.burst(p.x, p.y, p.z, { count: 14, colors: COL_VANTA, speed: 7, size: 0.2, up: 2 });
      boom(p.x, p.y, p.z, { radius: 1.6, power: 55, damage: 28, dmgRadius: 3.2, owner: killer, kind: 'rocket' });
      u.rig = null; rig.root.removeFromParent(); try { rig.dispose(); } catch (er) {}
      break;
    case T_TURRET:
      X.burst(p.x, p.y + 1, p.z, { count: 18, colors: COL_VANTA, speed: 8, size: 0.3, up: 5 });
      boom(p.x, p.y + 1, p.z, { radius: 2.6, power: 110, damage: 60, owner: killer, kind: 'rocket' });
      u.rig = null; rig.root.removeFromParent(); try { rig.dispose(); } catch (er) {}
      break;
    case T_TANK:
      X.burst(p.x, p.y + 1.5, p.z, { count: 42, colors: COL_VANTA, speed: 10, size: 0.42, up: 7 });
      boom(p.x, p.y + 1.2, p.z, { radius: 4.5, power: 140, damage: 130, owner: killer, kind: 'shell' });
      u.rig = null; rig.root.removeFromParent(); try { rig.dispose(); } catch (er) {}
      break;
    case T_GUNSHIP:
      dying.push({ rig, type: T_GUNSHIP, x: p.x, y: p.y, z: p.z, vx: e.vel.x, vy: e.vel.y, vz: e.vel.z, t: 0, spin: (rnd() < 0.5 ? -1 : 1) * rr(2.5, 4), killer, heavy: false, r: u.D.r, h: u.D.h });
      u.rig = null; break;
    default:
      if (!u.dormant && u.st !== E_DROP) W.enemyMechs = Math.max(0, W.enemyMechs - 1);
      dying.push({ rig, type: T_EMECH, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, t: 0, spin: 0, killer, heavy: u.variant === 'heavy' || u.boss, boss: u.boss, r: u.D.r, h: u.D.h, quiet: !info });
      u.rig = null; break;
  }
}
function updDying(dt) {
  for (let i = dying.length - 1; i >= 0; i--) {
    const d = dying[i]; d.t += dt; let done = false;
    const root = d.rig.root;
    if (d.type === T_GUNSHIP) {
      d.vy -= 14 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt; d.vx *= 1 - 0.3 * dt; d.vz *= 1 - 0.3 * dt;
      root.position.set(d.x, d.y, d.z); root.rotation.y += d.spin * dt; root.rotation.z = Math.min(0.9, d.t * 0.5); root.rotation.x = Math.min(0.5, d.t * 0.25);
      if (G.fx) { G.fx.emit('fire', d.x, d.y + 1, d.z, 0, 1, 0, 2); G.fx.emit('smoke', d.x, d.y + 1.5, d.z, 0, 1, 0, 2); }
      if (d.y < 0.6 || d.t > 9 || G.grid.boxSolid(d.x - 1.5, d.y, d.z - 1.5, d.x + 1.5, d.y + 1.5, d.z + 1.5)) {
        X.burst(d.x, d.y + 1, d.z, { count: 55, colors: COL_VANTA, speed: 13, size: 0.45, up: 8 });
        boom(d.x, d.y + 1, d.z, { radius: 6, power: 150, damage: 170, owner: d.killer, kind: 'shell' });
        done = true;
      }
    } else {
      try { anim.dead = true; anim.speed = 0; anim.fwd = 0; anim.strafe = 0; anim.grounded = true; anim.jet = 0; d.rig.update(dt, anim); } catch (er) {}
      if (G.fx && !d.quiet) G.fx.emit('spark', d.x + rr(-1.5, 1.5), d.y + d.h * rr(0.4, 0.9), d.z + rr(-1.5, 1.5), 0, 1, 0, 2);
      if (d.t > (d.quiet ? 0.5 : d.boss ? 2.6 : 1.0)) {
        X.burst(d.x, d.y + d.h * 0.5, d.z, { count: d.heavy ? 110 : 80, colors: COL_VANTA, speed: 14, size: 0.55, up: 9 });
        if (d.quiet) boom(d.x, d.y + d.h * 0.4, d.z, { radius: 3, power: 60, damage: 0, owner: null, kind: 'mech' });
        else if (d.boss) { boom(d.x, d.y + 3, d.z, { radius: 13, power: 230, damage: 300, owner: d.killer, kind: 'mech' }); bus.emit('boss:dead', { x: d.x, y: d.y, z: d.z }); }
        else boom(d.x, d.y + d.h * 0.45, d.z, { radius: d.heavy ? 8.5 : 7, power: 160, damage: d.heavy ? 260 : 200, owner: d.killer, kind: 'mech' });
        done = true;
      }
    }
    if (done) { root.removeFromParent(); try { d.rig.dispose(); } catch (er) {} dying.splice(i, 1); }
  }
}

// ============================================================================
// WAVE DIRECTOR
// ============================================================================
const dir = { active: false, n: 0, queue: [], qi: 0, t: 0, inter: 0, total: 0, killed: 0, running: false, push: false, cap: 8, pendingDebug: null, edgeUsed: new Float32Array(64).fill(-99), nextSquad: 1, pushT: 0 };

const UNIT_SCALE = [1, 1, 1.6, 2.2, 2.8], BOSS_SCALE = [1, 1, 1.7, 2.4, 3];
function playerCount() { return G.net && G.net.online ? clamp(G.ents.players().length, 1, 4) : 1; }
function compose(n) {
  let R, K, D, T, Gs, E, A, heavy = 0;
  if (n <= 1) { R = 5; K = 0; D = 0; T = 0; Gs = 0; E = 0; A = 0; }
  else if (n === 2) { R = 6; K = 1; D = 3; T = 0; Gs = 0; E = 0; A = 0; }
  else if (n === 3) { R = 6; K = 2; D = 3; T = 1; Gs = 0; E = 0; A = 0; }
  else if (n === 4) { R = 7; K = 2; D = 4; T = 1; Gs = 0; E = 0; A = 1; }
  else if (n === 5) { R = 6; K = 2; D = 4; T = 0; Gs = 1; E = 1; A = 0; }
  else if (n === 6) { R = 8; K = 3; D = 5; T = 2; Gs = 1; E = 0; A = 1; }
  else if (n === 7) { R = 8; K = 3; D = 5; T = 1; Gs = 1; E = 1; A = 1; }
  else {
    R = Math.min(9 + (n - 8), 14); K = Math.min(3 + ((n - 6) >> 1), 6); D = Math.min(5 + ((n - 6) >> 1), 9);
    T = Math.min(1 + (((n - 5) / 3) | 0), 3); Gs = Math.min(1 + (((n - 6) / 3) | 0), 3); E = Math.min(1 + (((n - 8) / 4) | 0), 3); A = n >= 9 ? 2 : 1;
  }
  if (n % 5 === 0 && n >= 10) heavy = 1;
  const pm = UNIT_SCALE[playerCount()];
  if (pm > 1) { R = Math.round(R * pm); K = Math.round(K * pm); D = Math.round(D * pm); T = Math.round(T * pm); Gs = Math.round(Gs * pm); E = Math.round(E * pm); A = Math.min(3, Math.round(A * pm)); }
  const q = [];
  // infantry squads of ~4: riflemen with a rocketeer, aces ride with the second squad
  const inf = []; for (let i = 0; i < R; i++) inf.push('rifle');
  for (let i = 0; i < K; i++) inf.splice(Math.min(inf.length, 2 + i * 4), 0, 'rocketeer');
  for (let i = 0; i < A; i++) inf.splice(Math.min(inf.length, 5 + i * 5), 0, 'ace');
  let t = 0;
  for (let i = 0; i < inf.length; i += 4) { q.push({ t, kind: 'squad', members: inf.slice(i, i + 4), n: Math.min(4, inf.length - i) }); t += n <= 1 ? 7 : 6; }
  for (let i = 0, k = 0; i < D; i += 3, k++) q.push({ t: 8 + k * 9, kind: 'drone', n: Math.min(3, D - i) });
  for (let i = 0; i < T; i++) q.push({ t: 12 + i * 14, kind: 'tank', n: 1 });
  for (let i = 0; i < Gs; i++) q.push({ t: 16 + i * 18, kind: 'gunship', n: 1 });
  for (let i = 0; i < E; i++) q.push({ t: 21 + i * 20, kind: 'emech', variant: heavy && i === 0 ? 'heavy' : 'standard', n: 1 });
  q.sort((a, b) => a.t - b.t);
  let total = 0; for (const g of q) total += g.n;
  const label = n === 1 ? 'INFANTRY' : n === 2 ? 'DRONE SWARM' : n === 3 ? 'ARMOUR' : n === 4 ? 'ACE INBOUND' : heavy ? 'HEAVY RIG' : E ? 'VANTA RIG' : 'ASSAULT';
  return { q, total, label };
}
function pickEdge(tgt, cls) {
  const E = (G.city.spawns && G.city.spawns.edge) || [];
  let best = -1, bs = -1e9;
  const f = nav.fields[cls || 0];
  for (let i = 0; i < E.length && i < 64; i++) {
    const s = E[i]; let sc = rnd() * 1.6;
    if (tgt) {
      const dx = s.x - tgt.pos.x, dz = s.z - tgt.pos.z, d = Math.sqrt(dx * dx + dz * dz);
      sc -= Math.abs(d - 75) * 0.025; if (d < 40) sc -= 5;
      if (G.grid.los(tgt.pos.x, tgt.pos.y + tgt.height * 0.8, tgt.pos.z, s.x, GROUND_Y + 1.5, s.z)) sc -= 2.5;
    }
    if (G.time - dir.edgeUsed[i] < 12) sc -= 2;
    const c = nav.walkableNear(s.x, s.z, 0, 0);
    if (c < 0) sc -= 10; else if (f.valid && f.dist[c] === Infinity) sc -= 6;
    if (sc > bs) { bs = sc; best = i; }
  }
  if (best < 0) return { x: 8, z: 8 };
  dir.edgeUsed[best] = G.time;
  return E[best];
}
function pickAir(tgt) {
  const A = (G.city.spawns && G.city.spawns.air) || [];
  if (!A.length) return { x: 10, y: 42, z: 10 };
  let best = A[0], bs = -1e9;
  for (let i = 0; i < A.length; i++) { const s = A[i]; let sc = rnd() * 40; if (tgt) { const dx = s.x - tgt.pos.x, dz = s.z - tgt.pos.z; sc += Math.min(90, Math.sqrt(dx * dx + dz * dz)); } if (sc > bs) { bs = sc; best = s; } }
  return best;
}
function spawnGroup(g, tgt) {
  if (g.kind === 'squad') {
    const s = pickEdge(tgt, 0), sq = dir.nextSquad++;
    for (let i = 0; i < g.members.length; i++) {
      const c = nav.walkableNear(s.x, s.z, i * 2, 0);
      const x = c >= 0 ? nav.cellX(c) : s.x, z = c >= 0 ? nav.cellZ(c) : s.z;
      const u = enemy.spawn('soldier', x + rr(-0.4, 0.4), z + rr(-0.4, 0.4), { variant: g.members[i], squad: sq, side: i % 4 === 1 ? -1 : i % 4 === 2 ? 1 : 0, counted: true });
      if (g.members[i] === 'ace') msg('ACE ON THE FIELD', 'Kill it before it calls a rig', 'warn', 3.5);
    }
  } else if (g.kind === 'drone') {
    const s = pickAir(tgt);
    for (let i = 0; i < g.n; i++) enemy.spawn('drone', s.x + rr(-5, 5), s.z + rr(-5, 5), { y: s.y + rr(-2, 3), counted: true });
  } else if (g.kind === 'gunship') {
    const s = pickAir(tgt); enemy.spawn('gunship', s.x, s.z, { y: Math.max(s.y, 36), counted: true });
    msg('GUNSHIP INBOUND', 'Vanta air support — break its line of sight', 'warn', 3.5);
  } else if (g.kind === 'tank') {
    const s = pickEdge(tgt, 1), c = nav.walkableNear(s.x, s.z, 0, 1);
    enemy.spawn('tank', c >= 0 ? nav.cellX(c) : s.x, c >= 0 ? nav.cellZ(c) : s.z, { counted: true });
    if (dir.n === 3) msg('ARMOUR', 'Vanta tank entering Halden Yard', 'warn', 3);
  } else if (g.kind === 'emech') {
    const s = tgt ? pickDrop(tgt.pos.x, tgt.pos.z, 26, 60, tgt) : pickDrop(96, 96, 0, 60, null);
    enemy.spawn('emech', s.x, s.z, { variant: g.variant, drop: true, counted: true });
    msg(g.variant === 'heavy' ? 'HEAVY RIG DROP' : 'VANTA RIG DROP', 'Enemy rig inbound — clear the landing zone', 'warn', 4);
  }
}
function startWave(n) {
  const W = G.state.wave, c = compose(n);
  dir.n = n; dir.queue = c.q; dir.qi = 0; dir.t = 0; dir.total = c.total; dir.killed = 0; dir.running = true; dir.push = false; dir.pushT = 0;
  dir.cap = Math.min(TUNE.capMax + 4 * (playerCount() - 1), Math.round((TUNE.capBase + TUNE.capPerWave * n) * (1 + 0.35 * (playerCount() - 1))));
  W.n = n; W.total = c.total; W.alive = c.total; W.intermission = 0;
  bus.emit('wave:start', { n, total: c.total, label: c.label });
}
function updDirector(dt, tgt) {
  const W = G.state.wave, list = enemy.list;
  tokens.max = Math.min(TUNE.tokensMax, Math.floor(TUNE.tokensBase + TUNE.tokensPerWave * Math.max(1, W.n))) + (tgt && tgt.height > 4 ? 3 : 0);
  if (dir.pendingDebug && G.state.phase === 'playing') {
    const t = tgt, px = t ? t.pos.x : G.city.spawns.player.x, pz = t ? t.pos.z : G.city.spawns.player.z;
    if (t || G.time > 1) { debugSpawn(dir.pendingDebug, px, pz); dir.pendingDebug = null; }
  }
  if (!dir.active || G.state.phase !== 'playing' || G.state.mode === 'operation') return;
  if (!dir.running) {
    dir.inter -= dt; W.intermission = Math.max(0, dir.inter);
    if (dir.inter <= 0) startWave(dir.n + 1);
    return;
  }
  dir.t += dt;
  let live = 0; for (let i = 0; i < list.length; i++) if (list[i].counted) live++;
  while (dir.qi < dir.queue.length) {
    const g = dir.queue[dir.qi];
    if (live === 0 && g.t > dir.t + 1.5) g.t = dir.t + 1.5;         // nothing left on the field: bring the next group forward
    if (g.t > dir.t || (live > 0 && live + g.n > dir.cap)) break;
    let st = tgt; if (G.net && G.net.online) { const L = G.ents.players(); if (L.length > 1) st = L[(rnd() * L.length) | 0] || tgt; }
    spawnGroup(g, st); live += g.n; dir.qi++;
  }
  W.alive = Math.max(0, dir.total - dir.killed);
  const done = dir.qi >= dir.queue.length;
  // last few stragglers stop hiding and come to the player
  dir.push = done && live <= 3;
  if (done && live === 0 && dying.length === 0) {
    dir.running = false; dir.inter = TUNE.intermission;
    if (dir.n > W.bestWave) W.bestWave = dir.n;
    W.alive = 0; W.intermission = dir.inter;
    bus.emit('wave:clear', { n: dir.n });
  }
}
function debugSpawn(spec, px, pz) {
  const items = spec.split(',').map(s => s.trim()).filter(Boolean);
  let k = 0;
  for (const it of items) {
    let [kind, variant] = it.split(':');
    if (kind === 'rocketeer' || kind === 'ace' || kind === 'rifle') { variant = kind; kind = 'soldier'; }
    if (kind === 'heavy' || kind === 'dreadnought') { variant = kind; kind = 'emech'; }
    if (!(kind in TYPE)) continue;
    const a = (k++ / items.length) * 6.283 + 0.6, r = kind === 'soldier' ? 24 : kind === 'emech' ? 38 : 34;
    const x = clamp(px + Math.sin(a) * r, 6, WX - 6), z = clamp(pz + Math.cos(a) * r, 6, WZ - 6);
    if (kind === 'drone' || kind === 'gunship') enemy.spawn(kind, x, z, { y: GROUND_Y + (kind === 'drone' ? 14 : 34) });
    else { const cls = kind === 'soldier' ? 0 : kind === 'tank' ? 1 : 2, c = nav.walkableNear(x, z, 0, cls); enemy.spawn(kind, c >= 0 ? nav.cellX(c) : x, c >= 0 ? nav.cellZ(c) : z, { variant, drop: kind === 'emech' && G.params.get('drop') === '1' }); }
  }
}

// ============================================================================
// CO-OP (Phase D): host serialises its units, clients show them as puppets.
// Wire layout: see notes/enemy.md "Wire contract". Nothing here runs offline.
// ============================================================================
const VARS = ['rifle', 'rocketeer', 'ace', 'drone', 'tank', 'gunship', 'standard', 'heavy', 'dreadnought', 'turret'];
const VKIND = ['soldier', 'soldier', 'soldier', 'drone', 'tank', 'gunship', 'emech', 'emech', 'emech', 'turret'];
const LOADS = ['striker', 'guardian', 'siege', 'dread'];
const NET_VER = 1, NET_HDR = 6, NET_REC = 18, TAU = 6.283185307179586;
const F_GROUND = 1, F_FIRING = 2, F_STAG = 4, F_DISABLED = 8, F_SHIELD = 16, F_CROUCH = 32, F_JET = 64, F_TELL = 128;
let netBuf = new Uint8Array(NET_HDR + 48 * NET_REC + 64), netDV = new DataView(netBuf.buffer), netSeq = 0, spawnInternal = false, snapStamp = 0, lastSnapT = -1;
const grave = [];                       // [netId, time, …] units that died on the host in the last 1.5 s
const puppets = new Map();              // netId -> controller (clients)
const a8 = (r) => ((Math.round(r / TAU * 256) % 256) + 256) % 256;
function serialize() {
  const L = enemy.list;
  while (grave.length && G.time - grave[1] > 1.5) grave.splice(0, 2);
  const nd = Math.min(255, grave.length >> 1), need = NET_HDR + L.length * NET_REC + nd * 2;
  if (need > netBuf.length) { netBuf = new Uint8Array(need * 2); netDV = new DataView(netBuf.buffer); }
  const dv = netDV; let o = NET_HDR, n = 0;
  for (let i = 0; i < L.length; i++) {
    const u = L[i]; if (u.dead) continue;
    const e = u.ent, p = e.pos, v = e.vel, em = u.type === T_EMECH;
    dv.setUint16(o, e.netId, true);
    dv.setUint8(o + 2, Math.max(0, VARS.indexOf(u.variant)));
    dv.setUint8(o + 3, (em ? Math.max(0, LOADS.indexOf(u.loadout)) : 0) | (u.armL ? 0 : 4) | (u.armR ? 0 : 8) | ((u.boss ? u.bph : 0) << 4) | (em && u.st === E_DROP ? 64 : 0) | (u.dormant ? 128 : 0));
    dv.setUint16(o + 4, clamp(Math.round((p.x + 32) * 256), 0, 65535), true);
    dv.setUint16(o + 6, clamp(Math.round(p.y * 128), 0, 65535), true);
    dv.setUint16(o + 8, clamp(Math.round((p.z + 32) * 256), 0, 65535), true);
    dv.setUint8(o + 10, a8(u.yaw)); dv.setUint8(o + 11, a8(u.aimYaw));
    dv.setInt8(o + 12, clamp(Math.round(u.aimPitch * 80), -127, 127));
    dv.setUint8(o + 13, clamp(Math.ceil(e.hp / e.maxHp * 255), 0, 255));
    const sp = Math.sqrt(v.x * v.x + v.z * v.z);
    dv.setUint8(o + 14, Math.min(255, Math.round(sp * 8)));
    const firing = u.burstN > 0 || (u.w1 && u.w1.sinceFire != null && u.w1.sinceFire < 0.25);
    dv.setUint8(o + 15, (u.body ? (u.body.onGround ? F_GROUND : 0) : 0) | (firing ? F_FIRING : 0) | (u.stagT > 0 ? F_STAG : 0) | (e.disabled ? F_DISABLED : 0) | (e.shield && e.shield.on ? F_SHIELD : 0) | (u.crouch >= 1 ? F_CROUCH : 0) | (u.jetting || !u.body ? F_JET : 0) | (u.telling ? F_TELL : 0));
    dv.setUint8(o + 16, Math.round(sat(u.variant === 'ace' ? u.charge : u.telling ? 1 - sat(u.tellT / 1.5) : 0) * 255));
    dv.setUint8(o + 17, sp > 0.2 ? a8(Math.atan2(v.x, v.z)) : a8(u.yaw));
    o += NET_REC; n++;
  }
  for (let i = 0; i < nd; i++) { dv.setUint16(o, grave[i * 2], true); o += 2; }
  dv.setUint8(0, NET_VER); dv.setUint8(1, nd); dv.setUint16(2, n, true); dv.setUint16(4, netSeq = (netSeq + 1) & 0xffff, true);
  return netBuf.subarray(0, o);
}
function puppetDeath(id) {
  const u = puppets.get(id); if (!u) return false;
  puppets.delete(id); u.dead = true; u.ent.alive = false; u.deathInfo = { src: null }; handleDeath(u); return true;
}
function applySnapshot(data, t) {
  if (!puppetMode || !data) return 0;
  const b = data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < NET_HDR || dv.getUint8(0) !== NET_VER) return 0;
  const nd = dv.getUint8(1), n = dv.getUint16(2, true);
  if (b.length < NET_HDR + n * NET_REC + nd * 2) return 0;
  // spacing between snapshots drives the interpolation time
  const now = t != null ? t : G.time; let dur = lastSnapT >= 0 ? now - lastSnapT : 1 / 12; lastSnapT = now;
  if (!(dur > 0.02 && dur < 0.5)) dur = 1 / 12;
  snapStamp++;
  let o = NET_HDR;
  for (let i = 0; i < n; i++, o += NET_REC) {
    const id = dv.getUint16(o, true), vi = Math.min(VARS.length - 1, dv.getUint8(o + 2)), misc = dv.getUint8(o + 3);
    const x = dv.getUint16(o + 4, true) / 256 - 32, y = dv.getUint16(o + 6, true) / 128, z = dv.getUint16(o + 8, true) / 256 - 32;
    let u = puppets.get(id);
    if (u && u.variant !== VARS[vi]) { puppets.delete(id); const k = enemy.list.indexOf(u); if (k >= 0) enemy.list.splice(k, 1); u.dead = true; u.ent.alive = false; G.ents.remove(u.ent); disposeUnit(u); u = null; }   // id reused
    if (!u) {
      spawnInternal = true;
      try { u = enemy.spawn(VKIND[vi], x, z, { variant: VARS[vi], y, loadout: LOADS[misc & 3] }); } finally { spawnInternal = false; }
      if (!u) continue;
      const e = u.ent; e.remote = true; e.netId = id; e.onDeath = undefined; u.puppet = true; u.st = VKIND[vi] === 'emech' ? E_STALK : 0;
      if (e.shield) e.shield.on = false;
      u.net = { fx: x, fy: y, fz: z, tx: x, ty: y, tz: z, it: 0, dur, yaw: 0, aim: 0, pitch: 0, speed: 0, dir: 0, flags: 0, charge: 0, misc: 0, stamp: 0, emitT: 0 };
      u.yaw = u.aimYaw = dv.getUint8(o + 10) / 256 * TAU;
      puppets.set(id, u);
    }
    const q = u.net, e = u.ent;
    q.fx = e.pos.x; q.fy = e.pos.y; q.fz = e.pos.z; q.tx = x; q.ty = y; q.tz = z; q.it = 0; q.dur = dur; q.stamp = snapStamp;
    const jump = (x - q.fx) * (x - q.fx) + (y - q.fy) * (y - q.fy) + (z - q.fz) * (z - q.fz) > 900; if (jump) { q.fx = x; q.fy = y; q.fz = z; }   // relocated: do not slide across the map
    q.yaw = dv.getUint8(o + 10) / 256 * TAU; q.aim = dv.getUint8(o + 11) / 256 * TAU; q.pitch = dv.getInt8(o + 12) / 80;
    e.hp = Math.max(1, dv.getUint8(o + 13) / 255 * e.maxHp);
    q.speed = dv.getUint8(o + 14) / 8; q.dir = dv.getUint8(o + 17) / 256 * TAU;
    const fl = dv.getUint8(o + 15);
    if ((fl & F_FIRING) && !(q.flags & F_FIRING)) { try { u.rig.trigger('fireR'); } catch (er) {} }
    q.flags = fl; q.charge = dv.getUint8(o + 16) / 255;
    e.staggered = !!(fl & F_STAG); e.disabled = !!(fl & F_DISABLED);
    if (misc !== q.misc) {
      q.misc = misc;
      if ((misc & 4) && u.armL) { u.armL = false; if (e.limbs) e.limbs.armL = false; try { u.rig.setLimbLost && u.rig.setLimbLost('armL'); } catch (er) {} }
      if ((misc & 8) && u.armR) { u.armR = false; if (e.limbs) e.limbs.armR = false; try { u.rig.setLimbLost && u.rig.setLimbLost('armR'); } catch (er) {} }
      const ph = (misc >> 4) & 3; if (ph) { u.bph = ph; e.phase = ph; }
      u.dormant = !!(misc & 128); e.noHit = !!(misc & 64);
    }
  }
  for (let i = 0; i < nd; i++, o += 2) puppetDeath(dv.getUint16(o, true));
  // anything the host no longer lists is gone (cleared, released or hijacked): remove it quietly
  for (const [id, u] of puppets) if (u.net.stamp !== snapStamp) {
    puppets.delete(id); const k = enemy.list.indexOf(u); if (k >= 0) enemy.list.splice(k, 1);
    u.dead = true; u.ent.alive = false; G.ents.remove(u.ent); disposeUnit(u);
  }
  return n;
}
function updPuppets(dt) {
  const list = enemy.list, camP = G.camera.position;
  for (let i = 0; i < list.length; i++) {
    const u = list[i], q = u.net; if (u.dead || !q || !u.rig) continue;
    const e = u.ent, p = e.pos, D = u.D, fl = q.flags;
    q.it += dt; const k = Math.min(1.3, q.it / q.dur);              // a little extrapolation covers a late snapshot
    const ox = p.x, oz = p.z;
    p.set(q.fx + (q.tx - q.fx) * k, q.fy + (q.ty - q.fy) * k, q.fz + (q.tz - q.fz) * k);
    if (dt > 0) e.vel.set((p.x - ox) / dt, 0, (p.z - oz) / dt);
    u.yaw = dampAngle(u.yaw, q.yaw, 14, dt); u.aimYaw = dampAngle(u.aimYaw, q.aim, 14, dt); u.aimPitch = damp(u.aimPitch, q.pitch, 14, dt);
    const cr = (fl & F_CROUCH) ? 1 : 0; u.crouch = cr; if (u.type === T_SOLDIER) e.height = cr ? 1.15 : D.h;
    const rel = wrapPi(q.dir - u.yaw), sp = q.speed, ds = D.speed || 1;
    anim.speed = sp; anim.fwd = u.body ? clamp(Math.cos(rel) * sp / ds, -1, 1) : 1; anim.strafe = u.body ? clamp(-Math.sin(rel) * sp / ds, -1, 1) : 0;
    anim.aimYaw = clamp(wrapPi(u.aimYaw - u.yaw), -1.5, 1.5); anim.aimPitch = u.aimPitch; anim.grounded = !!(fl & F_GROUND); anim.vy = 0; anim.jet = (fl & F_JET) ? 1 : 0;
    anim.dead = false; anim.heat = 0; anim.crouch = (fl & F_DISABLED) ? 1 : cr; anim.shield = (fl & F_SHIELD) ? 1 : 0; anim.brace = (fl & F_DISABLED) ? 1 : 0;
    if (u.rig.setShield && u.type === T_EMECH) u.rig.setShield((fl & F_SHIELD) ? 1 : 0);
    if (u.glow) {
      if (u.variant === 'ace') { u.glow.visible = true; const g = 0.18 + 0.4 * q.charge; u.glow.scale.set(g, g + q.charge * 1.2, g); q.emitT -= dt; if (q.emitT <= 0 && q.charge < 1) { q.emitT = 0.25; bus.emit('ace:charging', { ent: e, progress: q.charge }); } }
      else if (fl & F_TELL) { u.glow.visible = true; const g = 0.4 + 1.4 * q.charge; u.glow.scale.set(g, g, g); } else u.glow.visible = false;
    }
    const root = u.rig.root; root.position.copy(p); root.rotation.y = u.yaw;
    const dx = p.x - camP.x, dz = p.z - camP.z, far = dx * dx + dz * dz > 110 * 110;
    if (!far || ((G.frame + u.id) & 1) === 0) u.rig.update(far ? dt * 2 : dt, anim);
    if (e.maxHp > 100 && u.rig.setDamage) u.rig.setDamage(1 - e.hp / e.maxHp);
  }
  if (dying.length) updDying(dt);
}

// ============================================================================
// MODULE
// ============================================================================
const enemy = {
  name: 'enemy', list: [], TUNE, nav, dir, tokens,
  stats: { coverLost: 0, ms: 0, lastMs: 0, navMs: 0, typeMs: [0, 0, 0, 0, 0], peakMs: 0, modelMs: 0, thinks: 0, units: 0, relocations: 0 },
  init() {
    glowGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 1.7, 0.35), toneMapped: false, fog: false });
    ringGeo = new THREE.RingGeometry(5.2, 6.4, 40); ringGeo.rotateX(-Math.PI / 2);
    claim = new Int16Array(nav.N);
    nav.init();
    bus.on('game:start', () => this.begin());
    bus.on('shield:hit', (d) => { const c = d && d.ent && d.ent.ctrl; if (c) c.hitT = G.time; });
    bus.on('ent:damage', (d) => { const c = d.ent.ctrl; if (c && d.info && d.info.src && d.info.src.team === 0) { c.hurtBy = d.info.src; c.hurtT = G.time; } if (c && c.type === T_EMECH && d.ent.shield && d.info && d.info.src && d.info.src.team === 0) { const sx = d.info.src.pos.x - d.ent.pos.x, sz = d.info.src.pos.z - d.ent.pos.z; if (sx * Math.sin(c.aimYaw) + sz * Math.cos(c.aimYaw) > 0) c.hitT = G.time; } });
    bus.on('lock', (d) => { if (d && d.target && d.target.ctrl && (d.state === 'locked' || d.state === 'fired')) d.target.ctrl.locked = true; });
  },
  begin() {
    const P = G.params;
    dir.active = false; dir.running = false; dir.pendingDebug = null;
    if (P.has('noenemy') || puppetMode) return;
    if (G.state.mode === 'operation' && !P.get('spawn')) return;    // MISSION spawns everything in an operation
    if (P.get('spawn')) { dir.pendingDebug = P.get('spawn'); return; }
    dir.active = true; dir.n = Math.max(0, (parseInt(P.get('wave')) || 1) - 1); dir.inter = TUNE.firstDelay;
    G.state.wave.n = dir.n; G.state.wave.intermission = dir.inter;
  },
  startWave(n) { dir.active = true; startWave(n); },
  reset() {
    for (const u of this.list) disposeUnit(u);
    this.list.length = 0; deathQ.length = 0; puppets.clear(); grave.length = 0;
    for (const d of dying) { d.rig.root.removeFromParent(); try { d.rig.dispose(); } catch (e) {} }
    dying.length = 0;
    tokens.used = 0; if (warnCount > 0) { warnCount = 0; if (TUNE.lockWarn) bus.emit('lock:warning', { on: false }); }
    claim.fill(0);
    dir.active = false; dir.running = false; dir.queue = []; dir.qi = 0; dir.n = 0; dir.killed = 0; dir.total = 0; dir.push = false; dir.pendingDebug = null; dir.edgeUsed.fill(-99);
    const W = G.state.wave; W.n = 0; W.alive = 0; W.total = 0; W.intermission = 0; W.enemyMechs = 0;
    this.stats.relocations = 0; this.stats.peakMs = 0;
    nav.rebuild();
  },
  // spawn(kind, x, z, opts) -> controller.   opts { variant, y, drop (rig drop from orbit), dormant, squad, side, counted }
  spawn(kind, x, z, opts) {
    if (puppetMode && !spawnInternal) return null;
    opts = opts || {};
    if (!(kind in TYPE)) { if (kind === 'rocketeer' || kind === 'ace' || kind === 'rifle') { opts = Object.assign({ variant: kind }, opts); kind = 'soldier'; } else if (kind === 'heavy' || kind === 'dreadnought') { opts = Object.assign({ variant: kind }, opts); kind = 'emech'; } else return null; }
    const air = kind === 'drone' || kind === 'gunship';
    const sc = nav.cellOf(x, z);
    let y = opts.y != null ? opts.y : air ? 40 : kind === 'turret' ? Math.max(0.5, G.grid.topBelow(x, 47.9, z)) : nav.passS[sc] ? nav.hS[sc] : Math.max(0.5, G.grid.topBelow(x, GROUND_Y + 3.4, z));
    const u = makeUnit(kind, opts.variant, x, y, z);
    if (opts.target) { u.tgtOv = opts.target; if (u.D.nav != null) u.fi = u.D.nav + 3; }
    if (opts.hold) { u.hold = true; u.holdR = typeof opts.hold === 'number' ? opts.hold : 9; }
    if (opts.hp) { u.ent.hp = u.ent.maxHp = opts.hp; }
    if (kind === 'turret' && opts.weapon === 'e_rpg') u.w1 = G.combat.createWeapon('e_rpg');
    u.counted = !!opts.counted; u.squad = opts.squad || 0; u.side = opts.side || 0; u.flankT = u.side ? rr(6, 10) : 0;
    const t = target();
    u.yaw = u.aimYaw = t ? Math.atan2(t.pos.x - x, t.pos.z - z) : 0;
    if (kind === 'drone') { u.orbR = rr(13, 20); u.alt = rr(5, 9); u.st = A_ORBIT; u.runT = rr(4, 9); }
    else if (kind === 'gunship') { u.orbR = rr(44, 54); u.alt = rr(22, 27); u.st = A_ORBIT; u.runT = rr(9, 13); }
    else if (kind === 'emech') {
      u.st = E_STALK;
      const lo = u.loadout = u.boss ? 'dread' : opts.loadout || (u.variant === 'heavy' ? 'siege' : rnd() < 0.4 ? 'guardian' : 'striker');
      if (u.boss) { u.w3 = G.combat.createWeapon(hasW('e_siege') ? 'e_siege' : 'e_shell'); if (hasW('e_swarm')) { u.w2 = G.combat.createWeapon('e_swarm'); u.salvoCd = rr(14, 18); } u.siegeCd = 3; if (!opts.hp && !puppetMode) { const bm = BOSS_SCALE[playerCount()]; u.ent.hp = u.ent.maxHp = Math.round(u.ent.maxHp * bm); } u.ent.boss = true; u.ent.phase = 1; u.ent.name = 'Vanta Dreadnought'; }
      if (lo === 'guardian') u.ent.shield = { on: false, yaw: 0, arc: 2.1, hp: TUNE.shieldHp };
      else if (lo === 'siege') u.w3 = G.combat.createWeapon('e_shell');
      u.ent.loadout = lo;
      if (opts.drop) {
        u.st = E_DROP; u.dropT = opts.eta || TUNE.dropEta; u.ay = y; u.dormant = !!opts.dormant;
        u.ent.invuln = true; u.ent.noHit = true; u.ent.pos.y = y + u.dropT * 36 + u.dropT * u.dropT * 3;
        ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.9, 0.25), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
        u.ring = new THREE.Mesh(ringGeo, ringMat); u.ring.position.set(x, y + 0.12, z); u.ring.renderOrder = 5; G.scene.add(u.ring);
        bus.emit('mech:incoming', { x, z, team: 1, eta: u.dropT });
      } else if (!puppetMode) { G.state.wave.enemyMechs++; if (u.boss) bus.emit('boss:spawn', { ent: u.ent }); }
    } else if (kind !== 'tank' && u.body) G.grid.unstick(u.body, 6);
    u.rig.root.position.copy(u.ent.pos); u.rig.root.rotation.y = u.yaw;
    this.list.push(u);
    return u;
  },
  release(ent) { return release(ent); },
  // ---- co-op hooks (NET) ----
  get puppetMode() { return puppetMode; },
  setPuppetMode(on) { on = !!on; if (on === puppetMode) return; this.clearAll(); puppetMode = on; lastSnapT = -1; if (on) { dir.active = false; dir.running = false; dir.pendingDebug = null; } },
  serialize() { return serialize(); },
  applySnapshot(data, t) { return applySnapshot(data, t); },
  puppetDeath(netId) { return puppetDeath(netId); },
  byNetId(netId) { if (puppetMode) return puppets.get(netId) || null; for (const u of this.list) if (u.ent.netId === netId) return u; return null; },
  // host: a client did something to one of our units (its puppet hooks call G.net.enemyCmd; NET delivers it here)
  command(netId, cmd, arg, by) {
    const u = this.byNetId(netId); if (!u || u.dead || puppetMode) return false;
    if (cmd === 'stagger') { if (u.ent.stagger) u.ent.stagger(+arg || 0.5); return true; }
    if (cmd === 'tearLimb') return !!(u.ent.tearLimb && u.ent.tearLimb(arg, by || null));
    if (cmd === 'release') return release(u.ent);
    return false;
  },
  // spawnGroup(['rifle','rifle','rocketeer','tank','drone', 'emech:heavy', {kind:'turret', weapon:'e_rpg'}], x, z, opts) -> controllers
  spawnGroup(listIn, x, z, opts) {
    const out = [], sq = dir.nextSquad++; let gi = 0, ti = 0, ai = 0;
    for (const it of listIn || []) {
      let kind = typeof it === 'string' ? it : it.kind, variant = typeof it === 'string' ? undefined : it.variant;
      if (kind && kind.indexOf(':') > 0) { const q = kind.split(':'); kind = q[0]; variant = q[1]; }
      if (kind === 'rifle' || kind === 'rocketeer' || kind === 'ace') { variant = kind; kind = 'soldier'; }
      else if (kind === 'heavy' || kind === 'dreadnought') { variant = kind; kind = 'emech'; }
      if (!(kind in TYPE)) continue;
      const o = Object.assign({}, opts, typeof it === 'object' ? it : null, { variant });
      let u;
      if (kind === 'drone' || kind === 'gunship') { const a = ai++ * 2.4; u = this.spawn(kind, x + Math.sin(a) * 5, z + Math.cos(a) * 5, Object.assign(o, { y: o.y != null ? o.y : Math.max(G.grid.topBelow(x, 47.9, z) + 8, GROUND_Y + (kind === 'drone' ? 14 : 34)) })); }
      else if (kind === 'soldier') { const c = nav.walkableNear(x, z, gi * 2, 0); o.squad = sq; o.side = gi % 4 === 1 ? -1 : gi % 4 === 2 ? 1 : 0; gi++; u = this.spawn(kind, c >= 0 ? nav.cellX(c) : x, c >= 0 ? nav.cellZ(c) : z, o); }
      else if (kind === 'turret') { u = this.spawn(kind, x + (ti % 2) * 3, z + ((ti / 2) | 0) * 3, o); ti++; }
      else { const cls = kind === 'tank' ? 1 : 2, c = nav.walkableNear(x, z, 4 + ti * 9, cls); ti++; u = this.spawn(kind, c >= 0 ? nav.cellX(c) : x, c >= 0 ? nav.cellZ(c) : z, o); }
      if (u) { if (u.hold) { u.holdX = x; u.holdZ = z; } out.push(u); }
    }
    return out;
  },
  // Remove every Vanta unit at once, without deaths, score or explosions (mission stage changes).
  clearAll() {
    for (const u of this.list) { u.dead = true; u.ent.alive = false; G.ents.remove(u.ent); disposeUnit(u); }
    this.list.length = 0; deathQ.length = 0;
    for (const d of dying) { d.rig.root.removeFromParent(); try { d.rig.dispose(); } catch (e) {} }
    dying.length = 0; tokens.used = 0; claim.fill(0); warnCount = 0; G.state.wave.enemyMechs = 0; puppets.clear(); grave.length = 0;
  },
  killAll(src) { for (const u of this.list.slice()) { u.ent.invuln = false; G.ents.damage(u.ent, 1e6, { type: 'explosion', src: src || null }); } },
  update(dt) {
    if (dt <= 0) return;
    const t0 = performance.now(); modelMs = 0; extMs = 0;
    const list = this.list, S = this.stats; S.thinks = 0; if (PROF) S.typeMs.fill(0);
    if (puppetMode) { updPuppets(dt); return; }
    const tgt = target();
    if (tgt) nav.setGoal(tgt.pos.x, tgt.pos.z);
    // co-op host: every player is a nav goal and a possible target
    const players = G.net && G.net.online ? G.ents.players() : NO_PLAYERS, multi = players.length > 1;
    if (multi) for (let i = 0; i < players.length; i++) { const q = players[i]; if (q && q.alive && q !== tgt) nav.addGoal(q.pos.x, q.pos.z); }
    for (let i = 0; i < 6; i++) nav.fields[i].need = false;
    for (let i = 0; i < list.length; i++) { const q = list[i]; if (q.D.nav != null) { nav.fields[q.fi].need = true; if (q.tgtOv && q.tgtOv.alive) nav.setAltGoal(q.tgtOv.pos.x, q.tgtOv.pos.z); } }
    nav.update(); S.navMs = performance.now() - t0;
    updDirector(dt, tgt);
    coverBudget = 1;
    const camP = G.camera.position;
    for (let i = 0; i < list.length; i++) {
      const u = list[i]; if (u.dead) continue;
      u.age += dt;
      if (u.w1) u.w1.update(dt); if (u.w2) u.w2.update(dt); if (u.w3) u.w3.update(dt);
      const pt = PROF ? performance.now() : 0, pe = extMs;
      anim.crouch = 0; anim.shield = 0; anim.brace = 0;
      let ut = tgt;
      if (multi) { u.retT -= dt; if (u.retT <= 0 || !u.tgt || !u.tgt.alive) { u.retT = 0.8 + rnd() * 0.4; u.tgt = choosePlayer(u, players, tgt); } ut = u.tgt; }
      if (u.tgtOv) { if (u.tgtOv.alive) ut = u.tgtOv; else { u.tgtOv = null; u.fi = u.D.nav || 0; } }
      if (u.ent.held && u.type !== T_EMECH && u.type !== T_TANK) { u.rig.root.position.copy(u.ent.pos); continue; }   // grappled: PLAYER is moving it
      switch (u.type) {
        case T_SOLDIER: updSoldier(u, dt, ut); break;
        case T_DRONE: updDrone(u, dt, ut); break;
        case T_TANK: updTank(u, dt, ut); break;
        case T_GUNSHIP: updGunship(u, dt, ut); break;
        case T_TURRET: updTurret(u, dt, ut); break;
        default: updEmech(u, dt, ut);
      }
      if (PROF) S.typeMs[u.type] += performance.now() - pt - (extMs - pe);
      if (u.dead || !u.rig) continue;
      const root = u.rig.root, p = u.ent.pos;
      root.position.copy(p); root.rotation.y = u.yaw;
      // animation: every frame near the camera, every other frame far away
      const dx = p.x - camP.x, dz = p.z - camP.z, far = dx * dx + dz * dz > 110 * 110;
      if (!far || ((G.frame + u.id) & 1) === 0) { const m0 = performance.now(); u.rig.update(far ? dt * 2 : dt, anim); modelMs += performance.now() - m0; }
      if (u.ent.maxHp > 100 && u.rig.setDamage) u.rig.setDamage(1 - u.ent.hp / u.ent.maxHp);
    }
    while (deathQ.length) handleDeath(deathQ.pop());
    if (dying.length) updDying(dt);
    const ms = performance.now() - t0 - modelMs - extMs;
    S.lastMs = ms; S.ms = S.ms * 0.95 + ms * 0.05; if (ms > S.peakMs) S.peakMs = ms; S.modelMs = S.modelMs * 0.95 + modelMs * 0.05; S.units = list.length;
  },
};
export default enemy;
