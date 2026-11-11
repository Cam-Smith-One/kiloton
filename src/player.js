// ============================================================================
// KILOTON — player.js   OWNER: PLAYER
// Pilot controller, Warden rig controller, rig meter / drop / board / eject
// cycle, score. The camera lives in player_cam.js.
// ============================================================================
import { G, THREE, bus, input, ents, clamp, sat, lerp, damp, dampAngle, wrapPi, NX, WX, WY, WZ, GROUND_Y } from './core.js';
import { cam, CAM_PRESET } from './player_cam.js';
import './rigs.js';
import './progress.js';

// ---- tuning ------------------------------------------------------------------
export const TUNE = {
  // pilot
  pRun: 6.6, pSprint: 9.6, pAccel: 70, pDecel: 55, pAirAccel: 22, pGrav: 25, pJump: 8.6, pCoyote: 0.13, pJumpBuf: 0.13,
  pJetAccel: 46, pJetMaxVy: 9.5, pJetKick: 4.5, pJetTime: 1.5, pJetRegen: 2.2, pJetRegenDelay: 0.45,
  slideBoost: 1.12, slideMax: 12.5, slideFriction: 7.5, slideEnd: 4, slideSteer: 1.3, slideH: 0.9, slideMinT: 0.25,
  rollTime: 0.55, rollSpeed0: 11.5, rollSpeed1: 6.5, rollIframes: 0.25, rollCd: 0.6, rollH: 1.0, landRollWindow: 0.3, landRollHard: 12, landRollDmg: 0.2,
  crouchH: 1.1, crouchSpeed: 3.2, crouchSpread: -0.003, popTime: 0.4, coverRange: 120, coverNear: 2.6,
  mantleMax: 1.65, mantleMin: 0.1, mantleTime: 0.32,
  seekLocks: 2, reviveReach: 3.5, reviveTime: 4,
  // phase B: rig depth
  airDashCd: 1.6, twinRate: 1.5, siegeRecoil: 7, naniteDelay: 5, naniteRate: 12,
  shieldMax: 700, shieldArc: 1.15, shieldDelay: 1.2, shieldUpkeep: 12, shieldRegen: 90, bashDmg: 300, bashLunge: 12,
  grappleRange: 55, grappleSpeed: 42, grappleCd: 1.2, grapplePull: 20, grappleDrag: 6, clinchTime: 3.5, yankTime: 0.35, yankDmg: 600, tearDmg: 450,
  comboWindow: 1.2, comboHeavy: 1.8, wallSlamDmg: 80, finisherHp: 0.25, finisherReach: 6,
  chargeReach: 3.2, chargeMount: 1.6, chargeFuse: 0.8, chargeDmg: 650,
  pFallSafe: 23, pFallDmg: 7, pHp: 100, pRegenDelay: 4, pRegen: 14,
  // rig
  rSpeed: 7.6, rAccel: 13, rDecel: 11, rOverDecel: 32, rAirAccel: 6, rGrav: 27, rTorsoRate: 3.3, rLegRate: 3.2,
  rDashSpeed: 25, rDashTime: 0.3, rDashCd: 2.0, rJump: 9, rJetAccel: 44, rJetMaxVy: 11, rJetTime: 2.3, rJetRegen: 3.2,
  rSlamSpeed: 52, rSlamMinH: 2.5, rHp: 1800, rFireCone: 0.75,
  stompLow: 50, stompHigh: 92, stompDash: 125, crushDmg: 500,
  punchWind: 0.2, punchCd: 0.7, punchReach: 7.5, punchRadius: 1.7, punchDepth: 5, punchPower: 210, punchDmg: 430, punchKnock: 16,
  grabReach: 11, grabR: 2.1, throwSpeed: 44, throwWind: 0.16,
  lockTime: 0.42, lockCone: 0.26, lockKeep: 0.6, lockRange: 280, lockMax: 4,
  // cycle
  meterTime: 1 / 150, meterKill: { soldier: 0.07, drone: 0.09, tank: 0.22, gunship: 0.28, emech: 0.55 },
  points: { soldier: 100, drone: 150, tank: 500, gunship: 750, emech: 1500 }, comboTime: 4.5,
  dropEta: 4, dropHeight: 250, dropRadius: 7, dropPower: 175, dropDmg: 600, dropMaxDist: 110,
  boardDist: 5, boardTime: 0.85, ejectHold: 0.65, ejectVy: 36.5, ejectFuse: 0.62,
  blastAuto: 12, blastManual: 16, blastPower: 235,
};
const T = TUNE;

const S = G.state, SP = S.player;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();
const _ft = new THREE.Vector3();
const CROUCH_OPTS = { spread: 0 };
const KIND_LABEL = { soldier: 'SOLDIER', drone: 'DRONE', tank: 'TANK', gunship: 'GUNSHIP', emech: 'ENEMY RIG' };
const WRECK_COLORS = [0x3a4450, 0x566574, 0x232a31, 0x2ee6ff, 0x8a949e];

// ---- runtime state -----------------------------------------------------------
let pilot = null, pilotModel = null, mech = null, mechModel = null;
let mode = 'pilot';                       // 'pilot' | 'mech' | 'dead'
const mine = new Set();                   // every entity this module ever owned in the run (kill credit)
let wRifle, wLauncher, wSeek;
const pilotLockWs = [];
const pilotWeapons = [], rigWeapons = [];
const pilotS = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0 };
const rigS = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0 };

const ps = {            // pilot controller state
  yaw: 0, coyote: 0, jumpBuf: 0, jet: false, fuel: 1, fuelDelay: 0, faceT: 0, noFall: false, invulnT: 0, stride: 0, semiBuf: 0, deadT: 0,
  crouch: false, crouchK: 0, popT: 0, lowCover: false, coverT: 0, inCover: false,
  slide: false, slideT: 0, roll: -1, rollCd: 0, rollDx: 0, rollDz: 1, rollV0: 0, rollIf: 0, landRoll: 0, mantle: -1,
};
const mantleFrom = new THREE.Vector3(), mantleTo = new THREE.Vector3();
const rs = {            // rig controller state
  legYaw: 0, torsoYaw: 0, dashT: 0, dashCd: 0, jet: false, fuel: 1, fuelDelay: 0, slamming: false, slamY: 0, peakY: 0,
  punchT: -1, punchSide: 0, punchCd: 0, side: 0, stride: 0, carveT: 0, ejectHold: 0, throwT: -1, hitT: 0, canGrab: false, airT: 0,
};
let held = null;                          // chunk carried by the rig
let drop = null;                          // { t, x, z, landY }   rig falling from orbit
let boarding = null;                      // { t, from:Vector3 }
let ejecting = null;                      // { t, real, manual, fuse, x,y,z }
const boardFrom = new THREE.Vector3();
let meter = 0, mechReady = false, comboT = 0, hitMarker = 0, god = false;
let prompt = '';
const lock = { targets: [], owners: [], cand: null, candW: null, prog: 0, active: false, group: 0 };
const overPos = new THREE.Vector3();
let marker = null, markerBeam = null, markerT = 0;
const dropSpot = { x: 0, z: 0, y: 0, ok: false };

// ---- helpers -----------------------------------------------------------------
function approach2(v, tx, tz, maxStep) {
  const dx = tx - v.x, dz = tz - v.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d <= maxStep || d < 1e-6) { v.x = tx; v.z = tz; } else { v.x += dx / d * maxStep; v.z += dz / d * maxStep; }
}
function turnToward(a, b, maxStep) { const d = wrapPi(b - a); return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep; }
function sockPos(model, name, out, fallbackEnt, fy) {
  const s = model && model.sockets && model.sockets[name];
  if (s) return s.getWorldPosition(out);
  return out.copy(fallbackEnt.pos).setY(fallbackEnt.pos.y + fallbackEnt.height * (fy == null ? 0.7 : fy));
}
// direction from a muzzle to the aim point; falls back to the camera direction when the aim is too close / behind
function aimDir(origin, out) {
  out.subVectors(cam.aim.point, origin);
  const l = out.length();
  if (l < 1.5 || out.dot(cam.dir) < l * 0.35) return out.copy(cam.dir);
  return out.multiplyScalar(1 / l);
}
function timing(name, def) { const t = G.models.TIMING; return t && t[name] > 0 ? Math.min(0.45, t[name]) : def; }
function shiftDown() { return input.down('ShiftLeft') || input.down('ShiftRight'); }
function shiftPressed() { return input.pressed('ShiftLeft') || input.pressed('ShiftRight'); }
function msg(text, sub, kind, dur) { bus.emit('ui:message', { text, sub: sub || '', kind: kind || 'info', dur: dur || 2.5 }); }
function groundTop(x, z, y) { return G.grid.topBelow(x, y, z); }

function makeBody(e, hw, h, stepUp) { e.hw = hw; e.h = h; e.stepUp = stepUp; e.onGround = false; e.hitWall = false; e.hitCeil = false; e.landSpeed = 0; return e; }

function createPilotEnt(x, y, z) {
  const m = pilotModel;
  const e = makeBody({
    kind: 'pilot', team: 0, isPlayer: true, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
    radius: m.radius || 0.35, height: m.height || 1.8, hp: T.pHp * PM('pilotHp'), maxHp: T.pHp * PM('pilotHp'), yaw: 0, rig: m,
    onDamage(amount, info) {
      // (COMBAT already scales the owner's share of its own blasts to 35 %)
      if (info && info.type === 'debris' && info.src && mine.has(info.src)) amount *= 0.35;
      cam.shake(clamp(amount / 40, 0.12, 0.6));
      return amount;
    },
    onDeath(info) { pilotDied(info); },
  }, 0.33, 1.8, 0.55);
  e.onGround = true;
  return e;
}
// ---- rig configuration (Rig Bay loadout -> runtime numbers, weapons, equipment) ---------------
const KEY_OF = ['', 'LMB', 'RMB', 'Q'];
// ---- field perks (G.progress) --------------------------------------------------------------------
const PM = (k) => { const P = G.progress; return P ? P.mult(k) : 1; };
const offering = () => { const P = G.progress; return !!(P && P.offer); };
let won = false;
// (Re)apply every perk multiplier that is stored rather than read at the point of use.
function applyPerks(repair) {
  // pilot: health
  if (pilot) { const mh = T.pHp * PM('pilotHp'), d = mh - pilot.maxHp; pilot.maxHp = mh; if (d > 0 && pilot.alive) pilot.hp = Math.min(mh, pilot.hp + d); else if (pilot.hp > mh) pilot.hp = mh; }
  // pilot: rifle magazine
  if (wRifle && wRifle.clipMax != null && isFinite(wRifle.clipMax)) {
    if (wRifle._ktBase == null) wRifle._ktBase = wRifle.clipMax;
    const nm = Math.round(wRifle._ktBase * PM('mag')), d = nm - wRifle.clipMax; wRifle.clipMax = nm; if (d > 0 && !wRifle.reloading) wRifle.clip += d; else if (wRifle.clip > nm) wRifle.clip = nm;
  }
  // rig: armour (plating repairs by the amount it adds), speed, turn, dash, jets, shield pool
  if (mech && rc) {
    const mh = Math.round(rc.hp * PM('rigArmor')), d = mh - mech.maxHp; mech.maxHp = mh;
    if (d > 0 && mech.alive && repair !== false) mech.hp = Math.min(mh, mech.hp + d); else if (mech.hp > mh) mech.hp = mh;
    const b = rc.base, k = PM('rigSpeed');
    rc.speed = b.speed * k; rc.dash = b.dash * k; rc.turn = b.turn * k; rc.jet = b.jet * PM('jet');
    const sm = T.shieldMax * PM('shield'), sd = sm - sh.max; sh.max = sm; if (mech.shield && sd > 0) mech.shield.hp = Math.min(sm, mech.shield.hp + sd);
  }
}
// Damage perks for weapons live here because COMBAT does not read G.progress: top the hit up after the fact.
const _bonus = { type: '', src: null, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, weapon: '', bonus: true };
function perkBonus(d) {
  const info = d.info, o = d.ent;
  if (!info || info.bonus || !o.alive || o.team !== 1 || !info.src || !mine.has(info.src)) return;
  let k = 1;
  if (info.type === 'explosion') k = PM('blast');
  else if (info.weapon === 'pulse' || info.weapon === 'lance' || info.weapon === 'e_pulse' || (!info.weapon && info.type === 'pulse')) k = PM('energy');
  if (k <= 1.0001) return;
  _bonus.type = info.type; _bonus.src = info.src; _bonus.x = info.x || 0; _bonus.y = info.y || 0; _bonus.z = info.z || 0; _bonus.dx = info.dx || 0; _bonus.dy = info.dy || 0; _bonus.dz = info.dz || 0; _bonus.weapon = info.weapon || '';
  ents.damage(o, d.amount * (k - 1), _bonus);
}
const SLOT_ALIAS = { armL: 'muzzleL', armR: 'muzzleR', shL: 'rocketPod', shR: 'aaPod', back: 'rocketPod' };
const LEGACY_FIRE = { armL: 'fireL', armR: 'fireR', shL: 'fireRocket', shR: 'fireAA', back: 'fireRocket' };
let rc = null;                            // config of the current rig (one player rig exists at a time)
function currentLoadout() { const R = G.rigs; return R ? R.bay.current : null; }
function buildRigConfig(lo) {
  const R = G.rigs, C = G.combat;
  const d = R && lo ? R.derive(lo) : null, ch = d ? d.chassis : { id: 'warden', radius: 1.8, height: 8.5, punch: 1, stomp: 1, ability: 'slam', slots: ['armL', 'armR', 'shL', 'shR', 'back'] };
  const c = {
    lo, d, ch, chassis: ch.id, hp: d ? d.hp : T.rHp, speed: d ? d.speed : T.rSpeed, dash: d ? d.dash : T.rDashSpeed, jet: d ? d.jet : T.rJetTime, turn: d ? d.turn : T.rTorsoRate,
    punchK: ch.punch * (1 + 0.25 * (d ? d.emptyArms : 0)), stompK: ch.stomp, ability: ch.ability,
    weapons: [], groups: [[], [], [], []], lockers: [[], [], [], []], cad: {}, rr: [0, 0, 0, 0],
    shieldSlot: d && d.equip.shield || null, grappleSlot: d && d.equip.grapple || null, nanite: !!(d && d.equip.nanite), reactor: !!(d && d.equip.reactor), booster: !!(d && d.equip.booster),
    shieldKey: 'KeyG', grappleKey: 'KeyG', hijacked: false, dashMax: ch.ability === 'airdash' ? 2 : 1,
  };
  if (c.shieldSlot && c.grappleSlot) { if (c.shieldSlot === 'armR') c.shieldKey = 'KeyT'; else c.grappleKey = 'KeyT'; }
  c.base = { speed: c.speed, dash: c.dash, turn: c.turn, jet: c.jet };
  const slots = d ? ch.slots : [];
  if (!d) {                               // no Rig Bay data (should not happen): classic Warden
    addRigWeapon(c, 'pulse', 'armL', 1); addRigWeapon(c, 'salvo', 'shL', 2); addRigWeapon(c, 'skylance', 'shR', 3);
  }
  for (let g = 1; g <= 3; g++) for (const slot of slots) {
    if (d.groups[g].indexOf(slot) < 0) continue;
    const m = R.MODULES[lo.slots[slot]]; if (!m || m.type !== 'weapon') continue;
    addRigWeapon(c, m.weapon, slot, g);
  }
  c.weapons.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot));
  return c;
}
function addRigWeapon(c, id, slot, g) {
  const C = G.combat;
  if (C.WEAPONS && !C.WEAPONS[id]) return null;           // COMBAT has not shipped this one yet: the hardpoint stays silent
  let w; try { w = C.createWeapon(id); } catch (e) { return null; }
  if (!w) return null;
  w.slot = slot; w.key = KEY_OF[g]; w.group = g;
  c.weapons.push(w);
  if (w.kind === 'lock') c.lockers[g].push(w); else c.groups[g].push(w);
  return w;
}
function rigSock(slot, out) {
  const s = mechModel.sockets;
  if (s && s[slot]) return s[slot].getWorldPosition(out);
  return sockPos(mechModel, SLOT_ALIAS[slot] || slot, out, mech, 0.75);
}
function stagger(o, sec) { o._ktStag = Math.max(o._ktStag || 0, G.time + sec); if (typeof o.stagger === 'function') { try { o.stagger(sec); } catch (e) {} } }
function isStaggered(o) { return (o._ktStag || 0) > G.time || o.staggered === true; }
function isBigRig(o) { return o.kind === 'emech' || o.kind === 'mech' || (o.radius >= 1.4 && o.height >= 5 && !o.airborne); }

function createMechEnt(x, y, z, lo) {
  if (lo === undefined) lo = currentLoadout();
  rc = buildRigConfig(lo);
  const R = G.rigs;
  let m = null;
  if (lo && R) { try { const paint = R.PAINTS.find(p => p.id === lo.paint) || R.PAINTS[0]; m = G.models.create('mech', { chassis: lo.chassis, loadout: lo, paint }); } catch (e) { m = null; } }
  if (!m || !m.root) m = G.models.create('mech');
  tapTriggers(m, 'mech');
  const ch = rc.ch;
  const e = makeBody({
    kind: 'mech', team: 0, isPlayer: false, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(),
    radius: ch.radius || m.radius || 1.8, height: ch.height || m.height || 8.5, hp: rc.hp, maxHp: rc.hp, yaw: 0, rig: m, chassis: rc.chassis, loadout: lo,
    onDamage: rigOnDamage,
  }, 1.8, 8.5, 1.0);
  e.hw = Math.min(2.2, e.radius); e.h = Math.min(10.5, e.height);
  m.onFootstep = (side, p, heavy) => { m._steps = true; if (e === mech && !drop) emitStep(p.x, p.y, p.z, true, 'mech'); };
  mine.add(e);
  e.armor = 0.5;                       // an empty rig is hunkered down; full damage once the pilot is aboard
  if (god) e.invuln = true;
  mech = e; mechModel = m;
  G.scene.add(m.root);
  adoptRig();
  return e;
}
// reset the rig controller for whatever `mech` / `rc` now are
function adoptRig() {
  rigWeapons.length = 0; for (const w of rc.weapons) rigWeapons.push(w);
  Object.assign(rs, { legYaw: cam.yaw, torsoYaw: cam.yaw, fuel: 1, dashCd: 0, dashT: 0, dashN: rc.dashMax, slamming: false, jet: false, punchT: -1, throwT: -1, ejectHold: 0,
    brace: false, comboN: 0, lastPunch: -9, bashT: -1, busy: false, semiBuf1: 0, semiBuf2: 0 });
  sh.on = false; sh.max = T.shieldMax; sh.delay = 0; sh.broken = false;
  mech.shield = rc.shieldSlot ? { on: false, yaw: 0, arc: T.shieldArc, hp: T.shieldMax } : undefined;
  grReset(); fin.o = null;
  applyPerks(false); mech.hp = mech.maxHp > 0 && !rc.hijacked ? mech.maxHp : mech.hp; if (mech.shield) mech.shield.hp = sh.max;
  for (let n = 0; n < knocks.length; n++) knocks[n].ent = null;
  cam.scale = clamp(mech.height / 8.5, 0.8, 1.25);
}
function rigOnDamage(amount, info) {
  const e = this, m = e.rig;
  if (info) {
    if (info.type === 'debris' && info.src && mine.has(info.src)) amount *= 0.2;
    else if (info.type === 'debris' && G.time - rs.carveT < 1.2) amount *= 0.3;      // masonry we just walked through
    // Aegis shield: anything arriving inside the arc in front of the torso is paid for out of the shield pool
    const s = e.shield;
    if (s && s.on && s.hp > 0 && (info.type === 'explosion' || info.type === 'melee')) {      // COMBAT absorbs direct hits itself
      let fx = 0, fz = 0;
      if (info.dx != null && info.dz != null && (info.dx !== 0 || info.dz !== 0)) { fx = -info.dx; fz = -info.dz; }
      else if (info.src && info.src.pos) { fx = info.src.pos.x - e.pos.x; fz = info.src.pos.z - e.pos.z; }
      if ((fx !== 0 || fz !== 0) && Math.abs(wrapPi(Math.atan2(fx, fz) - s.yaw)) < s.arc) {
        const take = Math.min(amount, s.hp); s.hp -= take; amount -= take;
        bus.emit('shield:hit', { ent: e, x: info.x == null ? e.pos.x : info.x, y: info.y == null ? e.pos.y + e.height * 0.6 : info.y, z: info.z == null ? e.pos.z : info.z, amount: take });
        if (e.isPlayer) cam.shake(clamp(take / 500, 0.04, 0.25));
        if (amount <= 0) return 0;
      }
    }
  }
  if (e === mech && rs.brace) amount *= 0.5;
  if (e.isPlayer) cam.shake(clamp(amount / 220, 0.06, 0.5));
  if (G.time - rs.hitT > 0.25) { rs.hitT = G.time; m && m.trigger && m.trigger('hit'); }
  return amount;
}
function emitStep(x, y, z, heavy, kind) { bus.emit('footstep', { x, y, z, heavy, kind, team: 0 }); }

function disposeMech() {
  if (gr.mesh) gr.mesh.visible = false; gr.state = 'idle'; gr.ent = null;
  if (mechModel) { if (mechModel.root) mechModel.root.removeFromParent(); mechModel.dispose && mechModel.dispose(); }
  if (mech) ents.remove(mech);
  mech = null; mechModel = null;
}
function dropHeld(vel) {
  if (!held) return;
  const ch = held; held = null; SP.grab = null;
  if (!ch.object) return;
  if (G.destruct.dropChunk) { G.destruct.dropChunk(ch); return; }
  if (G.destruct.releaseChunk) { _a.copy(ch.object.position); _b.set(0, 0, 0); if (vel) _b.copy(vel); G.combat.throwObject(ch, _a, _b, mech || pilot); return; }
  ch.object.removeFromParent();
}

// ---- rig drop ------------------------------------------------------------------
const FOOT = [0, 0, 2, 0, -2, 0, 0, 2, 0, -2, 1.5, 1.5, -1.5, 1.5, 1.5, -1.5, -1.5, -1.5];
function footprintBlocked(x, z) {
  const g = G.grid; let high = 0;
  if (x < 6 || z < 6 || x > WX - 6 || z > WZ - 6) return 99;
  for (let n = 0; n < 18; n += 2) if (g.topBelow(x + FOOT[n], WY - 0.25, z + FOOT[n + 1]) > GROUND_Y + 3.6) high++;
  const lot = G.city && G.city.lot;
  if (lot && lot[Math.floor(x * 2) + NX * Math.floor(z * 2)] === 2) high += 2;
  return high;
}
function landHeight(x, z) {
  let y = 0;
  for (let n = 0; n < 10; n += 2) y = Math.max(y, groundTop(x + FOOT[n] * 0.6, z + FOOT[n + 1] * 0.6, GROUND_Y + 1.6));
  return y || GROUND_Y;
}
// Snap an aimed point to the nearest open ground. If nothing is open within 16 m the rig simply comes through the roof.
function findDropSpot(px, pz, out) {
  let x = clamp(px, 8, WX - 8), z = clamp(pz, 8, WZ - 8);
  out.ok = false;
  if (footprintBlocked(x, z) <= 1) out.ok = true;
  else {
    search: for (let r = 2; r <= 16; r += 2) {
      const n = r <= 4 ? 8 : 16;
      for (let q = 0; q < n; q++) {
        const a = q / n * Math.PI * 2, tx = px + Math.sin(a) * r, tz = pz + Math.cos(a) * r;
        if (footprintBlocked(tx, tz) <= 1) { x = tx; z = tz; out.ok = true; break search; }
      }
    }
  }
  out.x = x; out.z = z; out.y = landHeight(x, z);
  return out;
}
function aimedDropPoint(out) {
  const a = cam.aim, p = pilot.pos;
  let x = a.point.x, z = a.point.z;
  if (a.hit && a.ny < 0.5 && !a.ent) { x += a.nx * 2.8; z += a.nz * 2.8; }
  else if (!a.hit) { x = p.x + cam.dir.x * 60; z = p.z + cam.dir.z * 60; }
  const dx = x - p.x, dz = z - p.z, d = Math.sqrt(dx * dx + dz * dz);
  if (d > T.dropMaxDist) { x = p.x + dx / d * T.dropMaxDist; z = p.z + dz / d * T.dropMaxDist; }
  return findDropSpot(x, z, out);
}
function callDrop(x, z) {
  if (mech || drop) return false;
  const lo = currentLoadout();
  if (lo && G.progress && !G.progress.loadoutUnlocked(lo)) { msg('LOADOUT LOCKED', lo.name + ' uses parts you have not unlocked — pick another (1 / 2 / 3)', 'warn', 3); return false; }
  if (lo && G.rigs.derive(lo).over) { msg('OVERWEIGHT', 'this loadout cannot drop — fix it in the Rig Bay', 'warn', 3); return false; }
  if (x == null) aimedDropPoint(dropSpot); else findDropSpot(x, z, dropSpot);
  const e = createMechEnt(dropSpot.x, dropSpot.y + T.dropHeight, dropSpot.z);
  e.noHit = true; e.invuln = true;
  ents.add(e);
  drop = { t: 0, x: dropSpot.x, z: dropSpot.z, landY: dropSpot.y };
  rs.legYaw = rs.torsoYaw = Math.atan2(pilot.pos.x - dropSpot.x, pilot.pos.z - dropSpot.z);     // lands facing its pilot
  mechReady = false; meter = 0;
  S.stats.mechsCalled++;
  bus.emit('mech:incoming', { x: dropSpot.x, z: dropSpot.z, team: 0, eta: T.dropEta });
  netEvent({ type: 'drop', x: dropSpot.x, y: dropSpot.y, z: dropSpot.z, eta: T.dropEta, loadout: e.loadout || null });
  if (G.fx.burst) G.fx.burst('reentry', dropSpot.x, dropSpot.y + T.dropHeight * 0.8, dropSpot.z, 1);
  return true;
}
function updateDrop(dt) {
  const d = drop, e = mech, g = G.grid;
  d.t += dt;
  const u = sat(1 - d.t / T.dropEta);
  let y = d.landY + T.dropHeight * u;
  e.pos.set(d.x, y, d.z); e.vel.set(0, -T.dropHeight / T.dropEta, 0);
  // comes through anything in the way (awnings, trees, a roof if the pilot insisted)
  if (y < WY) { rs.carveT = G.time; G.destruct.carveBox(d.x - 2.1, Math.max(y, d.landY) + 0.05, d.z - 2.1, d.x + 2.1, Math.min(WY - 0.1, y + e.h), d.z + 2.1, 235, true); }
  if (G.fx.emit && y < 200) {
    sockPos(mechModel, 'jetL', _a, e, 0.5); G.fx.emit('trail_rocket', _a.x, _a.y + 1, _a.z, 0, 1, 0, 2);
    sockPos(mechModel, 'jetR', _a, e, 0.5); G.fx.emit('fire', _a.x, _a.y + 1, _a.z, 0, 1, 0, 2);
    if (u < 0.2) G.fx.emit('jet', e.pos.x, e.pos.y, e.pos.z, 0, -1, 0, 3);
  }
  rigS.speed = 0; rigS.fwd = 0; rigS.strafe = 0; rigS.aimYaw = 0; rigS.aimPitch = 0; rigS.grounded = false; rigS.vy = e.vel.y; rigS.jet = u < 0.25 ? 1 : 0; rigS.dead = false; rigS.heat = 0;
  if (d.t >= T.dropEta) {
    drop = null;
    e.pos.y = d.landY; e.vel.set(0, 0, 0); e.noHit = false; e.invuln = god; e.onGround = true;
    G.boom(d.x, d.landY + 1.2, d.z, { radius: T.dropRadius, power: T.dropPower, damage: T.dropDmg, owner: e, kind: 'mech', friendlyFire: false });
    bus.emit('mech:land', { x: d.x, y: d.landY, z: d.z, team: 0 });
    netEvent({ type: 'land', x: d.x, y: d.landY, z: d.z });
    mechModel.trigger && mechModel.trigger('land', 1);
    cam.kickFov(5);
    g.unstick(e, 12);
  }
}

// ---- boarding / eject ------------------------------------------------------------
function startBoarding() {
  lockClear('lost'); pilotClearMoves();
  boarding = { t: 0 }; boardFrom.copy(pilot.pos);
  pilot.invuln = true; pilot.vel.set(0, 0, 0);
  if (ps.jet) { ps.jet = false; bus.emit('jet', { ent: pilot, on: false }); }
  mechModel.trigger && mechModel.trigger('open');
}
function finishBoarding() {
  boarding = null;
  ents.remove(pilot); pilot.isPlayer = false; pilot.invuln = god;
  pilotModel.root.visible = false; pilotModel.root.scale.setScalar(1);
  mech.isPlayer = true; mech.armor = 0; mode = 'mech';
  rs.torsoYaw = rs.legYaw; rs.ejectHold = 0;
  cam.setPreset('mech');
  mechModel.trigger && (mechModel.trigger('close'), mechModel.trigger('boot'));
  bus.emit('mech:enter', { ent: mech, x: mech.pos.x, y: mech.pos.y, z: mech.pos.z });
  netEvent({ type: 'board', x: mech.pos.x, y: mech.pos.y, z: mech.pos.z, hijack: !!rc.hijacked });
}
function updateBoarding(dt) {
  const b = boarding; b.t += dt;
  const k = sat(b.t / T.boardTime), s = k * k * (3 - 2 * k);
  sockPos(mechModel, 'cockpit', _a, mech, 0.8);
  pilot.pos.lerpVectors(boardFrom, _a, s);
  pilot.pos.y += Math.sin(k * Math.PI) * 2.2 - s * 0.9;          // a hop up into the hatch
  pilot.vel.set(0, 0, 0);
  ps.yaw = dampAngle(ps.yaw, Math.atan2(mech.pos.x - pilot.pos.x, mech.pos.z - pilot.pos.z), 10, dt);
  pilotModel.root.scale.setScalar(1 - 0.75 * sat((k - 0.7) / 0.3));
  if (k >= 1) finishBoarding();
}
function eject(manual) {
  if (mode !== 'mech' || !mech || ejecting) return false;
  const e = mech;
  dropHeld(null);
  if (rs.jet) { rs.jet = false; bus.emit('jet', { ent: e, on: false }); }
  lockClear('lost');
  grReset(); sh.on = false; if (e.shield) e.shield.on = false; rs.brace = false; rs.busy = false; fin.o = null; e.invuln = false;
  sockPos(mechModel, 'cockpit', _a, e, 0.85);
  e.isPlayer = false; e.alive = false; e.hp = 0; e.noHit = true;
  pilot.pos.copy(_a); pilot.pos.y += 1.0;
  pilot.vel.set(-Math.sin(cam.yaw) * 4.5, T.ejectVy, -Math.cos(cam.yaw) * 4.5);
  pilot.isPlayer = true; pilot.onGround = false;
  ents.add(pilot);
  pilot.invuln = true; ps.invulnT = 3.2; ps.noFall = true; ps.fuel = 1; ps.jet = false; ps.coyote = 0; ps.yaw = cam.yaw;
  pilotModel.root.visible = true; pilotModel.root.scale.setScalar(1);
  pilotModel.trigger && pilotModel.trigger('jump');
  mode = 'pilot';
  cam.scale = 1; cam.setPreset('pilot'); cam.kickFov(16); cam.shake(0.55);
  ejecting = { t: 0, real: 0, manual: !!manual, x: e.pos.x, y: e.pos.y, z: e.pos.z };
  mechModel.trigger && (mechModel.trigger('open'), mechModel.trigger('death'));
  bus.emit('mech:eject', { ent: pilot, x: pilot.pos.x, y: pilot.pos.y, z: pilot.pos.z });
  netEvent({ type: 'eject', x: e.pos.x, y: e.pos.y, z: e.pos.z, manual: !!manual });
  return true;
}
function detonateRig(radius, dmg) {
  const e = mech; if (!e) return;
  const x = e.pos.x, y = e.pos.y, z = e.pos.z;
  disposeMech();
  if (G.destruct.burst) G.destruct.burst(x, y + 4.5, z, { count: 70, colors: WRECK_COLORS, speed: 24, size: 0.6, up: 0.7 });
  radius *= PM('blast');
  G.boom(x, y + 3.2, z, { radius, power: T.blastPower, damage: dmg, owner: e, kind: 'mech', friendlyFire: false, dmgRadius: radius * 1.5 });
  bus.emit('mech:selfdestruct', { ent: e, x, y, z });
  netEvent({ type: 'selfdestruct', x, y, z, radius });
  meter = 0; mechReady = false;
}
function updateEject(dt) {
  const j = ejecting; j.t += dt; j.real += G.rawDt || dt;
  // slow-motion beat on the launch, easing back as the fuse runs out
  if (S.phase === 'playing' && !offering() && !online()) G.timeScale = j.real < 0.4 ? 0.22 : lerp(0.22, 1, sat((j.real - 0.4) / 0.9));
  if (mech) { mech.pos.x = j.x; mech.pos.z = j.z; }
  if (mech && j.t >= T.ejectFuse) { detonateRig(j.manual ? T.blastManual : T.blastAuto, j.manual ? 1700 : 1100); cam.kickFov(8); }
  if (!mech && j.real > 1.4) { ejecting = null; if (S.phase === 'playing' && !offering()) G.timeScale = 1; }
}

// ---- pilot ---------------------------------------------------------------------
function pilotDied(info) {
  if (mode === 'dead' || mode === 'down') return;
  if (online()) { setDown(info); return; }
  mode = 'dead'; ps.deadT = 0; lockClear('lost'); endSlide(); setCrouch(false); ps.roll = -1; ps.mantle = -1; pilotHeight(1.8);
  overPos.copy(pilot.pos);
  if (ps.jet) { ps.jet = false; bus.emit('jet', { ent: pilot, on: false }); }
  pilotModel.trigger && pilotModel.trigger('death');
  cam.shake(0.6);
  bus.emit('player:dead', { cause: (info && info.type) || 'unknown', x: pilot.pos.x, y: pilot.pos.y, z: pilot.pos.z });
}
function pilotHeight(h) { pilot.h = h; pilot.height = h; }
function canStand() { const e = pilot, g = G.grid; return !g.boxSolid(e.pos.x - e.hw, e.pos.y + 0.05, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + 1.8, e.pos.z + e.hw); }
function setCrouch(on) { if (ps.crouch === on) return; ps.crouch = on; bus.emit('crouch', { ent: pilot, on }); }
function endSlide() { if (!ps.slide) return; ps.slide = false; bus.emit('slide', { ent: pilot, on: false }); }
function startRoll(dx, dz, speed) {
  const e = pilot;
  endSlide(); setCrouch(false);
  ps.roll = 0; ps.rollDx = dx; ps.rollDz = dz; ps.rollV0 = Math.max(T.rollSpeed0, speed || 0); ps.rollIf = T.rollIframes; ps.rollCd = T.rollTime + T.rollCd;
  e.invuln = true; pilotHeight(T.rollH);
  ps.yaw = Math.atan2(dx, dz);
  pilotModel.trigger && pilotModel.trigger('roll');
  bus.emit('roll', { ent: e });
}
// stop every special move (boarding, death, reset)
function pilotClearMoves() {
  endSlide(); setCrouch(false); ps.popT = 0; ps.roll = -1; ps.mantle = -1; ps.landRoll = 0; ps.rollIf = 0;
  if (pilot) { pilotHeight(1.8); if (ps.invulnT <= 0) pilot.invuln = god; }
}
// A ledge in front of an airborne pilot, top within reach, room to stand on it and room to rise past it?
function tryMantle(dx, dz) {
  const e = pilot, g = G.grid, p = e.pos, hw = e.hw;
  const px = p.x + dx * (hw + 0.4), pz = p.z + dz * (hw + 0.4);
  const top = g.topBelow(px, p.y + T.mantleMax + 0.2, pz), rise = top - p.y;
  if (rise < T.mantleMin || rise > T.mantleMax) return false;
  if (g.boxSolid(px - hw, top + 0.02, pz - hw, px + hw, top + 1.8, pz + hw)) return false;
  if (g.boxSolid(p.x - hw, p.y + 0.05, p.z - hw, p.x + hw, top + 1.8, p.z + hw)) return false;
  mantleFrom.copy(p); mantleTo.set(px, top, pz); ps.mantle = 0;
  bus.emit('mantle', { ent: e });
  if (ps.jet) { ps.jet = false; bus.emit('jet', { ent: e, on: false }); }
  pilotClearMovesKeepMantle();
  return true;
}
function pilotClearMovesKeepMantle() { const m = ps.mantle; pilotClearMoves(); ps.mantle = m; }
function updateMantle(dt) {
  const e = pilot;
  ps.mantle += dt / T.mantleTime;
  const k = sat(ps.mantle), up = sat(k / 0.6), fw = sat((k - 0.35) / 0.65);
  e.pos.x = lerp(mantleFrom.x, mantleTo.x, fw * fw * (3 - 2 * fw)); e.pos.z = lerp(mantleFrom.z, mantleTo.z, fw * fw * (3 - 2 * fw));
  e.pos.y = lerp(mantleFrom.y, mantleTo.y + 0.02, 1 - (1 - up) * (1 - up));
  e.vel.set(0, 0, 0);
  if (k >= 1) {
    ps.mantle = -1; e.onGround = true; ps.coyote = T.pCoyote;
    const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw), f = input.axisY() > 0 ? T.pRun * 0.8 : 0;
    e.vel.set(sy * f, 0, cy * f);                      // step off the ledge already moving
  }
}
const _near = [null, null, null], _nd = [0, 0, 0];
// Low cover ahead (for the pop-up) and "are the nearest enemies' sight lines blocked right next to us" (state.player.inCover).
function updateCover(dt) {
  const e = pilot, g = G.grid, p = e.pos;
  const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw);
  let low = false, clear = true;
  for (let n = 0; n < 2; n++) {
    const d = 0.65 + n * 0.5, x = p.x + fx * d, z = p.z + fz * d;
    if (g.solidAt(x, p.y + 0.75, z) || g.solidAt(x, p.y + 1.2, z)) low = true;
    if (g.solidAt(x, p.y + 1.62, z)) clear = false;
  }
  ps.lowCover = low && clear;
  ps.coverT -= dt; if (ps.coverT > 0) return;
  ps.coverT = 0.15;
  _near[0] = _near[1] = _near[2] = null; _nd[0] = _nd[1] = _nd[2] = T.coverRange * T.coverRange;
  const L = ents.list;
  for (let n = 0; n < L.length; n++) {
    const o = L[n]; if (!o.alive || o.team !== 1) continue;
    const dx = o.pos.x - p.x, dy = o.pos.y - p.y, dz = o.pos.z - p.z; let d = dx * dx + dy * dy + dz * dz, c = o;
    for (let q = 0; q < 3; q++) if (d < _nd[q]) { const td = _nd[q], tc = _near[q]; _nd[q] = d; _near[q] = c; d = td; c = tc; if (!c) break; }
  }
  let any = false, all = true;
  const cy = p.y + e.h * 0.62;
  for (let q = 0; q < 3; q++) {
    const o = _near[q]; if (!o) continue; any = true;
    const dx = o.pos.x - p.x, dy = o.pos.y + o.height * 0.8 - cy, dz = o.pos.z - p.z;
    if (!g.raycast(p.x, cy, p.z, dx, dy, dz, T.coverNear, true).hit) { all = false; break; }
  }
  ps.inCover = any && all;
}
function updatePilotMove(dt, ctl) {
  if (updateCharge(dt)) return;
  if (ps.mantle >= 0) { updateMantle(dt); pilot.yaw = ps.yaw; return; }
  const e = pilot, v = e.vel, g = G.grid;
  let ix = ctl ? input.axisX() : 0, iy = ctl ? input.axisY() : 0;
  const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const wx = sy * iy - cy * ix, wz = cy * iy + sy * ix;
  const sprint = ctl && shiftDown() && iy > 0.1 && ps.faceT < 0.9;
  const speed = sprint ? T.pSprint : T.pRun;
  ps.sprint = sprint && il > 0;
  const sp0 = Math.hypot(v.x, v.z);
  // --- slide / roll (C) ---
  ps.rollCd -= dt; ps.landRoll -= dt;
  const cDown = ctl && input.down('KeyC');
  if (ctl && (input.pressed('KeyC') || input.pressed('KeyX')) && !e.onGround) ps.landRoll = T.landRollWindow;   // primed: a hard landing becomes a roll
  if (ctl && input.pressed('KeyC') && e.onGround && !ps.slide && ps.roll < 0 && shiftDown() && iy > 0.1 && Math.abs(ix) < 0.5 && sp0 > T.pRun + 0.4) {
    setCrouch(false);
    ps.slide = true; ps.slideT = 0; pilotHeight(T.slideH);
    const ns = Math.min(T.slideMax, Math.max(sp0 * T.slideBoost, T.pSprint)); v.x *= ns / sp0; v.z *= ns / sp0;
    cam.kickFov(7); bus.emit('slide', { ent: e, on: true });
  }
  if (ctl && input.pressed('KeyX') && e.onGround && ps.roll < 0 && ps.rollCd <= 0) {
    if (il > 0.1) startRoll(wx / il, wz / il, 0); else startRoll(Math.sin(ps.yaw), Math.cos(ps.yaw), 0);
    cam.kickFov(3);
  }
  if (ps.slide) {
    ps.slideT += dt;
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.01) {
      // a little steering, then friction
      if (il > 0.1) { const a = Math.atan2(v.x, v.z), na = turnToward(a, Math.atan2(wx, wz), T.slideSteer * dt); v.x = Math.sin(na) * sp; v.z = Math.cos(na) * sp; }
      const ns = Math.max(0, sp - T.slideFriction * dt) / sp; v.x *= ns; v.z *= ns;
    }
    const want = input.down('KeyC') || ps.slideT < T.slideMinT;
    if (sp < T.slideEnd || !want || !ctl || !e.onGround && ps.coyote < -0.2) {
      if (cDown && e.onGround) { endSlide(); setCrouch(true); pilotHeight(T.crouchH); }       // slide settles into a crouch
      else if (canStand()) { endSlide(); pilotHeight(1.8); }
    }
  } else if (ps.roll >= 0) {
    ps.roll += dt / T.rollTime;
    const k = sat(ps.roll), rsp = lerp(ps.rollV0, Math.min(ps.rollV0, T.rollSpeed1), k);
    if (e.onGround || k < 0.2) { v.x = ps.rollDx * rsp; v.z = ps.rollDz * rsp; }
    if (ps.rollIf > 0) { ps.rollIf -= dt; if (ps.rollIf <= 0 && ps.invulnT <= 0) e.invuln = god; }
    if (k >= 1 && canStand()) { ps.roll = -1; pilotHeight(1.8); if (ps.invulnT <= 0) e.invuln = god; }
  } else {
    // crouch (hold C). Behind low cover, shooting pops the pilot up over it and ducks back shortly after.
    const wantCrouch = cDown && e.onGround || ps.crouch && !canStand();
    if (wantCrouch !== ps.crouch) setCrouch(wantCrouch);
    if (ps.popT > 0) ps.popT -= dt;
    const up = !ps.crouch || ps.popT > 0 && ps.lowCover && canStand();
    if (up) { if (e.h < 1.8 && canStand()) pilotHeight(1.8); } else if (e.h !== T.crouchH) pilotHeight(T.crouchH);
  }
  ps.crouchK = damp(ps.crouchK, ps.crouch && e.h < 1.8 ? 1 : ps.crouch ? 0.2 : 0, 14, dt);
  const special = ps.slide || ps.roll >= 0;
  if (ps.crouch && speed > T.crouchSpeed) { ps.sprint = false; }
  if (special) { /* velocity is owned by the move */ }
  else if (e.onGround) { const gs = ps.crouch ? T.crouchSpeed : speed; approach2(v, wx * gs, wz * gs, (il > 0 ? T.pAccel : T.pDecel) * dt); }
  else if (il > 0) {
    // air control: steer without throwing away momentum above run speed
    const cur = Math.hypot(v.x, v.z), sp = Math.max(speed, Math.min(cur, 16));
    approach2(v, wx * sp, wz * sp, (ps.jet ? T.pAirAccel * 1.6 : T.pAirAccel) * dt);
  } else { const k = Math.exp(-0.35 * dt); v.x *= k; v.z *= k; }

  // jump / jetpack
  if (e.onGround) ps.coyote = T.pCoyote; else ps.coyote -= dt;
  ps.jumpBuf -= dt;
  if (ctl && input.pressed('Space')) {
    if (ps.coyote > 0) ps.jumpBuf = T.pJumpBuf;
    else if (ps.fuel > 0.04 && !ps.jet) { ps.jet = true; if (v.y < T.pJetKick) v.y = Math.max(v.y * 0.4, 0) + T.pJetKick; bus.emit('jet', { ent: e, on: true }); }
    else ps.jumpBuf = T.pJumpBuf;
  }
  if (ps.jumpBuf > 0 && ps.coyote > 0 && ps.roll < 0 && canStand()) {
    if (ps.slide) endSlide();                                               // slide-hop: momentum carries
    setCrouch(false); pilotHeight(1.8);                        // slide-hop: momentum carries
    v.y = T.pJump; ps.coyote = 0; ps.jumpBuf = 0; e.onGround = false;
    pilotModel.trigger && pilotModel.trigger('jump');
  }
  if (ps.jet) {
    if (!ctl || !input.down('Space') || ps.fuel <= 0 || e.onGround) { ps.jet = false; bus.emit('jet', { ent: e, on: false }); }
    else {
      if (v.y < T.pJetMaxVy) v.y = Math.min(T.pJetMaxVy, v.y + T.pJetAccel * dt);
      ps.fuel = Math.max(0, ps.fuel - dt / (T.pJetTime * PM('jet'))); ps.fuelDelay = T.pJetRegenDelay;
      if (G.fx.emit) G.fx.emit('jet', e.pos.x - sy * 0.25, e.pos.y + 1.05, e.pos.z - cy * 0.25, 0, -1, 0, 1);
    }
  }
  if (e.onGround && !ps.jet) { ps.fuelDelay -= dt; if (ps.fuelDelay <= 0) ps.fuel = Math.min(1, ps.fuel + dt / T.pJetRegen); }
  v.y = Math.max(-60, v.y - T.pGrav * dt);

  const wasGround = e.onGround, y0 = e.pos.y;
  g.moveBody(e, dt);
  if (e.landSpeed > 0) {
    const ls = e.landSpeed;
    const rolled = ps.landRoll > 0 && ls > T.landRollHard && ps.roll < 0;
    if (ls > T.pFallSafe && !ps.noFall) ents.damage(e, (ls - T.pFallSafe) * T.pFallDmg * (rolled ? T.landRollDmg : 1), { type: 'fall', src: null, x: e.pos.x, y: e.pos.y, z: e.pos.z });
    if (rolled && e.alive) {
      const hs = Math.hypot(v.x, v.z);
      if (hs > 1) startRoll(v.x / hs, v.z / hs, hs); else startRoll(Math.sin(cam.yaw), Math.cos(cam.yaw), 0);
      ps.landRoll = 0;
    }
    if (ls > 5) { pilotModel.trigger && pilotModel.trigger('land', sat(ls / 22)); cam.dip = Math.min(0.5, ls * 0.018); emitStep(e.pos.x, e.pos.y, e.pos.z, false, 'pilot'); }
    ps.noFall = false;
  }
  // mantle: airborne, pushing into something we can get on top of
  if (ctl && !e.onGround && e.hitWall && il > 0.1 && v.y > -9 && !special && tryMantle(wx / il, wz / il)) { e.yaw = ps.yaw = Math.atan2(wx, wz); return; }
  cam.low = ps.slide ? 0.8 : ps.roll >= 0 ? 0.55 : e.h < 1.8 ? 0.65 : 0;
  updateCover(dt);
  // rubble landed on us / world edits under us
  if (g.boxSolid(e.pos.x - e.hw, e.pos.y + 0.05, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + e.h, e.pos.z + e.hw)) {
    g.unstick(e, 8);
    if (g.boxSolid(e.pos.x - e.hw, e.pos.y + 0.05, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + e.h, e.pos.z + e.hw)) e.pos.y = g.topBelow(e.pos.x, WY - 0.3, e.pos.z) + 0.01;
    if (v.y < 0) v.y = 0;
  }
  if (!(e.pos.x === e.pos.x) || !(e.pos.y === e.pos.y) || !(e.pos.z === e.pos.z)) { const sp = G.city.spawns.player; e.pos.set(sp.x, GROUND_Y + 0.5, sp.z); v.set(0, 0, 0); g.unstick(e, 30); }

  // facing: the camera when shooting / recently shot, otherwise the direction of travel
  const sp2 = Math.hypot(v.x, v.z);
  ps.faceT -= dt;
  if (ps.roll >= 0) ps.yaw = Math.atan2(ps.rollDx, ps.rollDz);
  else if (ps.faceT > 0) ps.yaw = dampAngle(ps.yaw, cam.yaw, 22, dt);
  else if (sp2 > 0.8 && (il > 0 || ps.slide)) ps.yaw = dampAngle(ps.yaw, Math.atan2(v.x, v.z), 12, dt);
  e.yaw = ps.yaw;
  // footsteps when the model does not report them
  if (e.onGround && !pilotModel._steps) { ps.stride += sp2 * dt; if (ps.stride > 1.25) { ps.stride = 0; emitStep(e.pos.x, e.pos.y, e.pos.z, false, 'pilot'); } }
  // regeneration
  if (e.alive && e.hp < e.maxHp && G.time - (e.lastHitT || -99) > T.pRegenDelay / PM('pilotHp')) e.hp = Math.min(e.maxHp, e.hp + T.pRegen * dt);
  if (ps.invulnT > 0) { ps.invulnT -= dt; if (ps.invulnT <= 0 && !boarding && ps.rollIf <= 0) e.invuln = god; }
}
function pilotAnim(dt) {
  const e = pilot, v = e.vel, s = pilotS;
  const sy = Math.sin(ps.yaw), cy = Math.cos(ps.yaw);
  s.speed = Math.hypot(v.x, v.z);
  s.fwd = clamp((v.x * sy + v.z * cy) / T.pRun, -1, 1.5); s.strafe = clamp((-v.x * cy + v.z * sy) / T.pRun, -1, 1);
  s.aimYaw = ps.faceT > 0 || mode !== 'pilot' ? wrapPi(cam.yaw - ps.yaw) : clamp(wrapPi(cam.yaw - ps.yaw), -1.1, 1.1);
  s.aimPitch = cam.pitch; s.grounded = e.onGround; s.vy = v.y; s.jet = ps.jet ? 1 : 0; s.dead = mode === 'dead' || mode === 'down'; s.heat = 0; s.slide = ps.slide ? 1 : 0; s.roll = ps.roll >= 0 ? 1 : 0; s.crouch = ps.crouchK;
  pilotModel.update(dt, s);
  pilotModel.root.position.copy(e.pos); pilotModel.root.rotation.y = ps.yaw;
}
function pilotActions(dt, ctl) {
  const e = pilot;
  for (let n = 0; n < pilotWeapons.length; n++) { const w = pilotWeapons[n]; w.update(w === wLauncher && w.reloading ? dt * (1 + 0.6 * (PM('mag') - 1)) : dt); }
  if (!ctl) return;
  const busy = ps.roll >= 0 || ps.mantle >= 0;
  CROUCH_OPTS.spread = T.crouchSpread;
  if (wSeek) updateLock(dt, !busy && input.down('KeyQ'), input.pressed('KeyQ'), e, pilotModel, pilotLockWs, 9);
  if (input.pressed('KeyR')) { wRifle.reload && wRifle.reload(); wLauncher.reload && wLauncher.reload(); }
  if (lock.active) ps.faceT = 1.3;
  if ((input.button(0) || ps.semiBuf > 0 || lock.active) && ps.crouch) ps.popT = T.popTime;
  const hidden = ps.crouch && ps.lowCover && pilot.h < 1.8;                 // still rising from behind cover: hold fire a beat
  if (input.button(0) && !busy && !hidden) {
    ps.faceT = 1.3;
    const w = wRifle;
    if (w.clip === 0 && !w.reloading && w.reload) w.reload();
    if (w.canFire() && Math.abs(wrapPi(cam.yaw - ps.yaw)) < 1.0) {
      sockPos(pilotModel, pilotModel.sockets.muzzleR ? 'muzzleR' : 'muzzleL', _a, e, 0.75);
      if (w.fire(e, _a, aimDir(_a, _b), ps.crouch ? CROUCH_OPTS : undefined)) {
        SP.activeWeapon = 0; pilotModel.trigger && pilotModel.trigger('fireR');
        cam.recoil(0.0055, (Math.random() - 0.5) * 0.004); cam.shake(0.045);
      }
    }
  }
  if (input.buttonPressed(2)) ps.semiBuf = 0.25;
  if (ps.semiBuf > 0 && !busy && !hidden) {
    ps.semiBuf -= dt; ps.faceT = 1.3;
    const w = wLauncher;
    if (w.clip === 0 && !w.reloading && w.reload) w.reload();
    if (w.canFire() && Math.abs(wrapPi(cam.yaw - ps.yaw)) < 1.0) {
      sockPos(pilotModel, pilotModel.sockets.rocketPod ? 'rocketPod' : pilotModel.sockets.muzzleL ? 'muzzleL' : 'muzzleR', _a, e, 0.85);
      if (w.fire(e, _a, aimDir(_a, _b))) {
        ps.semiBuf = 0; SP.activeWeapon = 1; pilotModel.trigger && pilotModel.trigger('fireRocket');
        cam.recoil(0.03, 0); cam.kickFov(4); cam.shake(0.25);
      }
    }
  }
  // loadout select (1 / 2 / 3), rig drop, boarding, boarding charge
  if (G.rigs && !mech && !drop) for (let n = 0; n < 3; n++) if (input.pressed('Digit' + (n + 1)) && G.rigs.bay.active !== n) {
    G.rigs.bay.select(n);
    const lo = G.rigs.bay.current; msg('LOADOUT ' + (n + 1), lo.name + (G.rigs.derive(lo).over ? ' — OVERWEIGHT' : ''), 'info', 1.6);
  }
  if (mechReady && !mech && !drop) {
    if (input.pressed('KeyV')) callDrop();
  }
  SP.canPlant = false; SP.canHijack = false;
  if (updateRevive(dt, !busy && !boarding && !bc.o, e)) return;
  if (!bc.o && !boarding && !busy) {
    const o = findChargeTarget();
    if (o) {
      const hj = o.disabled === true && !mech && !drop && !!(o.rig || o.model);
      SP.canPlant = !hj; SP.canHijack = hj;
      if (input.pressed('KeyE')) { if (!(hj && hijack(o))) startCharge(o); return; }
    }
  }
  if (mech && !drop && !boarding && !ejecting && mech.alive) {
    const dx = mech.pos.x - e.pos.x, dz = mech.pos.z - e.pos.z, dy = e.pos.y - mech.pos.y;
    SP.canEnter = dx * dx + dz * dz < (T.boardDist + mech.radius) * (T.boardDist + mech.radius) && dy > -4 && dy < mech.height + 3;
    if (SP.canEnter && input.pressed('KeyE')) startBoarding();
  }
}

// ---- rig -----------------------------------------------------------------------
function rigMove(dt, ctl) {
  const e = mech, v = e.vel, g = G.grid;
  if (rs.busy) ctl = false;
  let ix = ctl ? input.axisX() : 0, iy = ctl ? input.axisY() : 0;
  const il = Math.hypot(ix, iy); if (il > 1) { ix /= il; iy /= il; }
  const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
  const wx = sy * iy - cy * ix, wz = cy * iy + sy * ix;
  // torso chases the camera at a limited rate
  if (ctl) { const err = wrapPi(cam.yaw - rs.torsoYaw); rs.torsoYaw = turnToward(rs.torsoYaw, cam.yaw, Math.min(rc.turn, Math.abs(err) * 9 + 0.2) * dt); }

  // Bastion: brace (hold C on the ground) — rooted, damage halved
  const brace = ctl && rc.ability === 'brace' && input.down('KeyC') && e.onGround && gr.state === 'idle';
  if (brace !== rs.brace) { rs.brace = brace; bus.emit('brace', { ent: e, on: brace }); if (brace) { mechModel.trigger && mechModel.trigger('land', 0.5); cam.shake(0.2); } }
  const walk = rs.brace ? 0 : rc.speed * (sh.on ? 0.7 : 1);

  // dash (Harrier: two charges, in the air too)
  rs.dashT -= dt;
  if (rs.dashN < rc.dashMax) { rs.dashCd -= dt; if (rs.dashCd <= 0) { rs.dashN++; rs.dashCd = rc.dashMax > 1 ? T.airDashCd : T.rDashCd; } }
  if (ctl && shiftPressed() && rs.dashN > 0 && !rs.slamming && !rs.brace && (e.onGround || rc.ability === 'airdash') && gr.state === 'idle') {
    let dx = wx, dz = wz; if (il < 0.1) { dx = Math.sin(rs.torsoYaw); dz = Math.cos(rs.torsoYaw); }
    v.x = dx * rc.dash; v.z = dz * rc.dash; if (!e.onGround && v.y < 3) v.y = 3;
    if (rs.dashN === rc.dashMax) rs.dashCd = rc.dashMax > 1 ? T.airDashCd : T.rDashCd;
    rs.dashT = T.rDashTime; rs.dashN--;
    cam.kickFov(11); cam.shake(0.3);
    bus.emit('dash', { ent: e, air: !e.onGround });
    if (G.fx.emit) { sockPos(mechModel, 'jetL', _a, e, 0.55); G.fx.emit('jet', _a.x, _a.y, _a.z, -dx, 0, -dz, 6); sockPos(mechModel, 'jetR', _a, e, 0.55); G.fx.emit('jet', _a.x, _a.y, _a.z, -dx, 0, -dz, 6); }
  }
  const reeling = grReel(dt, ctl);                       // grapple owns the velocity while it reels
  const sp = Math.hypot(v.x, v.z);
  if (!reeling && rs.dashT <= 0 && !rs.slamming) {
    if (e.onGround) {
      // bleed dash speed quickly, then ordinary heavy accel / decel
      const top = Math.max(walk, 0.01);
      if (sp > top + 0.5) { const ns = Math.max(top, sp - T.rOverDecel * dt); v.x *= ns / sp; v.z *= ns / sp; }
      approach2(v, wx * walk, wz * walk, (il > 0 && walk > 0 ? T.rAccel * rc.speed / 7.6 : T.rDecel * (rs.brace ? 3 : 1)) * dt);
    } else if (il > 0) {
      const tsp = Math.max(walk, Math.min(sp, 16));
      approach2(v, wx * tsp, wz * tsp, T.rAirAccel * (rs.jet ? 2.2 : 1) * dt);
    }
  }
  // jump jets
  if (ctl && input.pressed('Space') && !rs.slamming && !rs.brace && !reeling) {
    if (e.onGround) { v.y = T.rJump; e.onGround = false; mechModel.trigger && mechModel.trigger('jump'); cam.shake(0.2); }
    if (rs.fuel > 0.05 && !rs.jet) { rs.jet = true; bus.emit('jet', { ent: e, on: true }); }
  }
  if (rs.jet) {
    if (!ctl || !input.down('Space') || rs.fuel <= 0 || rs.slamming || reeling) { rs.jet = false; bus.emit('jet', { ent: e, on: false }); }
    else {
      if (v.y < T.rJetMaxVy) v.y = Math.min(T.rJetMaxVy, v.y + T.rJetAccel * dt);
      rs.fuel = Math.max(0, rs.fuel - dt / rc.jet); rs.fuelDelay = 0.5;
      if (G.fx.emit) { sockPos(mechModel, 'jetL', _a, e, 0.55); G.fx.emit('jet', _a.x, _a.y, _a.z, 0, -1, 0, 3); sockPos(mechModel, 'jetR', _a, e, 0.55); G.fx.emit('jet', _a.x, _a.y, _a.z, 0, -1, 0, 3); }
    }
  }
  if (e.onGround && !rs.jet) { rs.fuelDelay -= dt; if (rs.fuelDelay <= 0) rs.fuel = Math.min(1, rs.fuel + dt / (T.rJetRegen * (rc.booster ? 0.65 : 1))); }
  // ground slam (Warden)
  if (ctl && rc.ability === 'slam' && input.pressed('KeyC') && !e.onGround && !rs.slamming && e.pos.y - groundTop(e.pos.x, e.pos.z, e.pos.y + 0.5) > T.rSlamMinH) {
    if (gr.state !== 'idle') grRelease(0.3);
    rs.slamming = true; rs.slamY = Math.max(rs.peakY, e.pos.y);
    v.y = -T.rSlamSpeed; v.x *= 0.25; v.z *= 0.25;
    mechModel.trigger && mechModel.trigger('slam');
    cam.kickFov(9);
  }
  if (rs.slamming) { v.y = -T.rSlamSpeed; v.x *= Math.exp(-4 * dt); v.z *= Math.exp(-4 * dt); }
  else if (gr.state !== 'reel') v.y = Math.max(-70, v.y - T.rGrav * dt);

  rigStomp(dt, rs.dashT > 0 || rs.slamming || gr.state === 'reel');
  if (!e.onGround) { rs.airT += dt; if (e.pos.y > rs.peakY) rs.peakY = e.pos.y; } else { rs.airT = 0; rs.peakY = e.pos.y; }
  g.moveBody(e, dt);
  if (e.landSpeed > 0) rigLanded(e.landSpeed);
  rigUnstick();

  // legs turn toward travel (walking backwards when travel opposes the torso)
  const sp2 = Math.hypot(v.x, v.z);
  let legT = rs.legYaw;
  if (sp2 > 0.8) { legT = Math.atan2(v.x, v.z); if (Math.abs(wrapPi(legT - rs.torsoYaw)) > 1.9) legT += Math.PI; }
  else if (Math.abs(wrapPi(rs.torsoYaw - rs.legYaw)) > 1.0) legT = rs.torsoYaw;
  rs.legYaw = turnToward(rs.legYaw, legT, rc.turn * dt);
  e.yaw = rs.legYaw; e.aimYaw = rs.torsoYaw;
  if (e.onGround && !mechModel._steps) { rs.stride += sp2 * dt; if (rs.stride > 3.1) { rs.stride = 0; emitStep(e.pos.x, e.pos.y, e.pos.z, true, 'mech'); } }
  // repair nanites
  if (rc.nanite && e.alive && e.hp < e.maxHp && G.time - (e.lastHitT || -99) > T.naniteDelay) e.hp = Math.min(e.maxHp, e.hp + T.naniteRate * dt);
}
function rigLanded(ls) {
  const e = mech, x = e.pos.x, y = e.pos.y, z = e.pos.z;
  if (rs.slamming) {
    rs.slamming = false;
    const h = Math.max(1, rs.slamY - y);
    const radius = clamp(3.6 + h * 0.3, 4, 10);
    G.boom(x, y + 0.6, z, { radius, power: clamp(105 + h * 5, 110, 190), damage: (220 + h * 32) * PM('melee'), owner: e, kind: 'slam', friendlyFire: false, dmgRadius: radius * 1.6 });
    bus.emit('slam', { x, y, z, radius, team: 0 });
    netEvent({ type: 'slam', x, y, z, radius });
    mechModel.trigger && mechModel.trigger('land', 1);
    cam.kickFov(6); e.vel.x = e.vel.z = 0;
  } else if (ls > 7) {
    const k = sat((ls - 7) / 22);
    mechModel.trigger && mechModel.trigger('land', k);
    cam.shake(0.25 + k * 0.5); cam.dip = 0.3 + k * 0.9;
    emitStep(x, y, z, true, 'mech');
    if (ls > 16) { rs.carveT = G.time; G.destruct.carveBox(x - e.hw - 0.6, y - 0.5, z - e.hw - 0.6, x + e.hw + 0.6, y + 0.5, z + e.hw + 0.6, 60, true); bus.emit('shake', { amount: 0.3 + k * 0.4, x, y, z }); }
  }
}
function rigUnstick() {
  const e = mech, g = G.grid;
  if (g.boxSolid(e.pos.x - e.hw, e.pos.y + 0.05, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + e.h, e.pos.z + e.hw)) {
    // shrug off what fell on us, then climb out of whatever is left
    rs.carveT = G.time;
    G.destruct.carveBox(e.pos.x - e.hw, e.pos.y + 1.05, e.pos.z - e.hw, e.pos.x + e.hw, e.pos.y + e.h, e.pos.z + e.hw, 100, true);
    if (g.unstick(e, 12) > 0 && e.vel.y < 0) e.vel.y = 0;
  }
}
// Wading: weak voxels the body overlaps break; Vanta infantry underfoot are crushed; big bodies push back.
function rigStomp(dt, charging) {
  const e = mech, v = e.vel, p = e.pos, sp = Math.hypot(v.x, v.z);
  if (sp > 0.6 || charging || v.y < -6) {
    const ax = sp > 0.01 ? v.x / sp * 0.45 : 0, az = sp > 0.01 ? v.z / sp * 0.45 : 0, m = e.hw + 0.05;
    const x0 = p.x - m + Math.min(0, ax), x1 = p.x + m + Math.max(0, ax), z0 = p.z - m + Math.min(0, az), z1 = p.z + m + Math.max(0, az);
    const yb = v.y < -6 ? p.y - 0.6 : p.y + 0.05;
    // the street layer itself (kerbs, pavements) only gives to weak stuff; everything above it is shouldered aside
    const split = Math.max(yb, GROUND_Y + 0.5), pw = Math.min(200, (charging ? T.stompDash : T.stompHigh) * rc.stompK);
    let n = 0;
    if (yb < split - 0.01) n += G.destruct.carveBox(x0, yb, z0, x1, split - 0.02, z1, T.stompLow, true) || 0;
    n += G.destruct.carveBox(x0, split, z0, x1, p.y + e.h + e.stepUp, z1, pw, true) || 0;
    if (n > 0) {
      rs.carveT = G.time;
      if (!charging && sp > 2.5) { const k = Math.max(2.5, sp - n * 0.02 / rc.stompK) / sp; v.x *= k; v.z *= k; }      // masonry costs momentum
      if (n > 12) cam.shake(Math.min(0.3, n * 0.004));
    }
  }
  const L = ents.list;
  for (let n = L.length - 1; n >= 0; n--) {
    const o = L[n]; if (!o.alive || o.team === 0 || o.airborne || o === fin.o || o === gr.ent) continue;
    const dx = o.pos.x - p.x, dz = o.pos.z - p.z, rr = e.radius + o.radius, d2 = dx * dx + dz * dz;
    if (d2 > rr * rr || o.pos.y > p.y + e.h || o.pos.y + o.height < p.y - 0.5) continue;
    if (o.height < 3 && o.radius < 1) {
      if (sp > 1 || v.y < -3 || charging) ents.damage(o, T.crushDmg, { type: 'crush', src: e, x: o.pos.x, y: o.pos.y, z: o.pos.z, dx: v.x, dy: -1, dz: v.z });
    } else {
      // tanks and rigs: shove ourselves back out, and a dash is a body-check
      const d = Math.sqrt(d2) || 0.01, pen = rr - d, nx = dx / d, nz = dz / d;
      const vn = v.x * nx + v.z * nz;
      if (charging && vn > 8 && G.time - (o._ktRam || -9) > 0.6) {
        o._ktRam = G.time;
        ents.damage(o, 260 * rc.stompK, { type: 'melee', src: e, x: o.pos.x, y: o.pos.y + o.height * 0.5, z: o.pos.z, dx: nx, dy: 0.2, dz: nz });
        knock(o, nx * 10, nz * 10); stagger(o, 0.5);
        cam.shake(0.5); bus.emit('shake', { amount: 0.4, x: o.pos.x, y: o.pos.y, z: o.pos.z });
      }
      if (vn > 0) { v.x -= nx * vn; v.z -= nz * vn; }
      v.x -= nx * Math.min(6, pen * 8); v.z -= nz * Math.min(6, pen * 8);
    }
  }
}
function idleRig(dt) {             // a rig standing empty still obeys gravity (and the ground may be shot away)
  const e = mech, v = e.vel;
  v.x = damp(v.x, 0, 6, dt); v.z = damp(v.z, 0, 6, dt); v.y = Math.max(-70, v.y - T.rGrav * dt);
  G.grid.moveBody(e, dt);
  if (e.landSpeed > 12) { mechModel.trigger && mechModel.trigger('land', sat(e.landSpeed / 30)); bus.emit('shake', { amount: 0.4, x: e.pos.x, y: e.pos.y, z: e.pos.z }); }
  rigUnstick();
  rs.torsoYaw = dampAngle(rs.torsoYaw, rs.legYaw, 3, dt);
  e.yaw = rs.legYaw; e.aimYaw = rs.torsoYaw;
}
function rigAnim(dt) {
  const e = mech, v = e.vel, s = rigS;
  if (!drop) {
    const sy = Math.sin(rs.legYaw), cy = Math.cos(rs.legYaw);
    s.speed = Math.hypot(v.x, v.z);
    s.fwd = clamp((v.x * sy + v.z * cy) / rc.speed, -1, 1.5); s.strafe = clamp((-v.x * cy + v.z * sy) / rc.speed, -1, 1);
    s.aimYaw = wrapPi(rs.torsoYaw - rs.legYaw); s.aimPitch = mode === 'mech' ? clamp(cam.pitch, -0.8, 0.9) : 0;
    let heat = 0; for (let n = 0; n < rigWeapons.length; n++) if (rigWeapons[n].heat > heat) heat = rigWeapons[n].heat;
    s.grounded = e.onGround; s.vy = v.y; s.jet = rs.jet || gr.state === 'reel' ? 1 : 0; s.dead = !e.alive; s.heat = heat; s.brace = rs.brace ? 1 : 0; s.shield = sh.on ? 1 : 0;
  }
  mechModel.update(dt, s);
  mechModel.root.position.copy(e.pos); mechModel.root.rotation.y = rs.legYaw;
  if (mechModel.setDamage) mechModel.setDamage(1 - e.hp / e.maxHp);
  if (mechModel.setShield) mechModel.setShield(sh.on && e.shield ? sat(e.shield.hp / sh.max) : 0);
}

// ---- lock-on (shared by the pilot's Seeker and every rig lock weapon) --------------------------
function lockClear(state) {
  if (lock.targets.length || lock.cand) bus.emit('lock', { state, target: lock.targets[0] || lock.cand });
  lock.targets.length = 0; lock.owners.length = 0; lock.cand = null; lock.candW = null; lock.prog = 0; lock.active = false; lock.group = 0;
}
function lockAngle(o, range) {     // angle between the crosshair and the target centre, or 9 if out of range
  const pv = cam.pivot;
  _d.set(o.pos.x - pv.x, o.pos.y + o.height * 0.5 - pv.y, o.pos.z - pv.z);
  const l = _d.length(); if (l > range || l < 4) return 9;
  return Math.acos(clamp(_d.dot(cam.dir) / l, -1, 1));
}
function lockRoom(w) {
  let n = 0; for (let i = 0; i < lock.owners.length; i++) if (lock.owners[i] === w) n++;
  return Math.min(w.maxLocks || 4, w.shots == null ? 9 : Math.max(1, w.shots)) - n;
}
function lockSock(model, w, e, out) { return model === mechModel && w.slot ? rigSock(w.slot, out) : sockPos(model, w.sock || 'aaPod', out, e, 1); }
const _lt = [];
// ws: the lock weapons bound to one key; holding: that key is down; group: id of the key (so two keys cannot share a lock run)
function updateLock(dt, holding, pressed, e, model, ws, group) {
  if (!ws.length) return;
  if (lock.active && lock.group !== group) return;
  if (holding && !lock.active) {
    let ok = false; for (let i = 0; i < ws.length; i++) if (ws[i].canFire()) ok = true;
    if (ok) { lock.active = true; lock.group = group; } else if (pressed) bus.emit('weapon:empty', { weapon: ws[0].id, shooter: e });
  }
  if (!lock.active) return;
  // drop targets that died or wandered far off the crosshair
  for (let n = lock.targets.length - 1; n >= 0; n--) {
    const o = lock.targets[n];
    if (!o.alive || lockAngle(o, 400) > T.lockKeep) { lock.targets.splice(n, 1); lock.owners.splice(n, 1); bus.emit('lock', { state: 'lost', target: o }); }
  }
  if (holding) {
    // best unlocked candidate inside the cone, for whichever weapon may take it (air and / or ground per its def)
    let best = null, bestA = T.lockCone, bestW = null;
    const L = ents.list;
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i], def = w.def || {};
      if (!w.canFire() || lockRoom(w) <= 0) continue;
      const la = w.lockAir != null ? w.lockAir : def.lockAir, lg = w.lockGround != null ? w.lockGround : def.lockGround;
      const air = !!la || (!la && !lg), ground = !!lg, range = w.lockRange || T.lockRange;
      for (let n = 0; n < L.length; n++) {
        const o = L[n]; if (!o.alive || o.team !== 1 || (o.airborne ? !air : !ground) || lock.targets.indexOf(o) >= 0) continue;
        const a = lockAngle(o, range); if (a >= bestA) continue;
        if (!G.grid.los(cam.pivot.x, cam.pivot.y, cam.pivot.z, o.pos.x, o.pos.y + o.height * 0.5, o.pos.z)) continue;
        best = o; bestA = a; bestW = w;
      }
    }
    if (best !== lock.cand) { lock.cand = best; lock.candW = bestW; lock.prog = 0; if (best) bus.emit('lock', { state: 'locking', target: best }); }
    if (best) {
      lock.prog += dt / (bestW.lockTime || T.lockTime);
      if (G.fx.beam && (G.frame & 3) === 0) { lockSock(model, bestW, e, _a); G.fx.beam(_a.x, _a.y, _a.z, best.pos.x, best.pos.y + best.height * 0.5, best.pos.z, 'lock'); }
      if (lock.prog >= 1) { lock.targets.push(best); lock.owners.push(bestW); lock.cand = null; lock.candW = null; lock.prog = 0; bus.emit('lock', { state: 'locked', target: best }); }
    }
  } else {
    // released: every weapon launches at its own locks
    let fired = false; const t0 = lock.targets[0];
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]; _lt.length = 0;
      for (let n = 0; n < lock.targets.length; n++) if (lock.owners[n] === w) _lt.push(lock.targets[n]);
      if (!_lt.length || !w.canFire()) continue;
      lockSock(model, w, e, _a);
      const t = _lt[0];
      _b.set(t.pos.x - _a.x, t.pos.y + t.height * 0.5 - _a.y, t.pos.z - _a.z).normalize();
      if (w.def && w.def.speed) { _b.y += 0.55; _b.normalize(); }            // real missiles pop up out of the rack first
      if (w.fire(e, _a, _b, { targets: _lt.slice(), slot: w.slot, aim: cam.aim.point })) {
        fired = true; SP.activeWeapon = Math.max(0, SP.weapons.indexOf(w));
        if (model.trigger) { model.trigger('fire', w.slot); model.trigger('fireAA'); }
      }
    }
    if (fired) {
      cam.shake(0.3); cam.kickFov(3);
      bus.emit('lock', { state: 'fired', target: t0 });
      lock.targets.length = 0; lock.owners.length = 0; lock.cand = null; lock.candW = null; lock.prog = 0; lock.active = false; lock.group = 0;
    } else lockClear('lost');
  }
}

// ---- rig weapons: fire groups ------------------------------------------------------------------
const FIRE_OPTS = { side: 'L', slot: '', aim: null, targets: undefined };
function fireRigWeapon(w) {
  const e = mech, slot = w.slot;
  rigSock(slot, _a);
  FIRE_OPTS.side = slot === 'armR' || slot === 'shR' ? 'R' : 'L'; FIRE_OPTS.slot = slot; FIRE_OPTS.aim = cam.aim.point;
  if (!w.fire(e, _a, aimDir(_a, _b), FIRE_OPTS)) return false;
  SP.activeWeapon = Math.max(0, rigWeapons.indexOf(w));
  if (mechModel.trigger) { mechModel.trigger('fire', slot); mechModel.trigger(LEGACY_FIRE[slot] || 'fireL'); }
  const k = w.kind, sgn = FIRE_OPTS.side === 'L' ? 1 : -1;
  if (w.id === 'siege' || w.id === 'mortar') {
    // camera kick and knock-back come from COMBAT's 'weapon:recoil'
  } else if (k === 'charge' || k === 'semi') { cam.recoil(0.012, 0); cam.kickFov(3.5); cam.shake(0.22); }
  else if (w.id === 'lance') cam.shake(0.03);
  else { cam.recoil(0.0035, sgn * 0.0025); cam.shake(0.07); }
  return true;
}
function fireGroup(g, down, pressed, dt) {
  const ws = rc.groups[g], n = ws.length;
  if (!n) return;
  if (pressed) rs['semiBuf' + g] = 0.25; else if (rs['semiBuf' + g] > 0) rs['semiBuf' + g] -= dt;
  if (!down && !(rs['semiBuf' + g] > 0)) return;
  const start = rc.rr[g] % n;
  for (let q = 0; q < n; q++) {
    const i = (start + q) % n, w = ws[i];
    if (w.kind === 'semi' && !(rs['semiBuf' + g] > 0)) continue;
    if (w.kind !== 'semi' && !down) continue;
    if (w.id === 'lance' || (w.def && w.def.beam)) { if (!w.overheated) fireRigWeapon(w); continue; }     // beam: every frame refreshes it
    if (!w.canFire()) continue;
    // identical weapons on one trigger alternate instead of doubling up on the same frame
    let same = 0; for (let j = 0; j < n; j++) if (ws[j].id === w.id) same++;
    if (same > 1 && w.id !== 'lance' && G.time < (rc.cad[w.id] || 0)) continue;
    if (fireRigWeapon(w)) {
      if (same > 1 && w.id !== 'lance') { rc.cad[w.id] = G.time + 1 / (((w.def && w.def.rate) || 8) * T.twinRate); rc.rr[g] = i + 1; }
      if (w.kind === 'semi') rs['semiBuf' + g] = 0;
    }
  }
}

// ---- equipment: Aegis shield -------------------------------------------------------------------
const sh = { on: false, max: 700, delay: 0, broken: false };
function updateShield(dt, ctl) {
  const e = mech, s = e.shield; if (!s) return;
  const want = ctl && input.down(rc.shieldKey) && !sh.broken && s.hp > 0 && !held && gr.state === 'idle';
  if (want !== sh.on) { sh.on = want; bus.emit('shield', { ent: e, on: want }); if (!want) sh.delay = T.shieldDelay; }
  s.on = sh.on; s.yaw = rs.torsoYaw;
  if (sh.on) { s.hp -= T.shieldUpkeep * dt; if (s.hp <= 0) { s.hp = 0; sh.broken = true; sh.on = false; s.on = false; sh.delay = T.shieldDelay * 2; bus.emit('shield', { ent: e, on: false, broken: true }); cam.shake(0.4); } }
  else { sh.delay -= dt; if (sh.delay <= 0 && s.hp < sh.max) s.hp = Math.min(sh.max, s.hp + T.shieldRegen * PM('shield') * dt); if (sh.broken && s.hp >= sh.max * 0.35) sh.broken = false; }
}
function doBash() {
  const e = mech, sy = Math.sin(rs.torsoYaw), cy = Math.cos(rs.torsoYaw);
  const ox = e.pos.x + sy * (e.radius + 0.6), oy = e.pos.y + e.height * 0.5, oz = e.pos.z + cy * (e.radius + 0.6);
  rs.carveT = G.time;
  const n = G.destruct.punch(ox, oy, oz, sy, 0, cy, T.punchRadius * 1.35, 4, Math.min(240, T.punchPower * rc.punchK), e) || 0;
  let hitEnt = false; const L = ents.list;
  for (let i = L.length - 1; i >= 0; i--) {
    const o = L[i]; if (!o.alive || o.team === 0) continue;
    const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d > e.radius + o.radius + 5 || o.pos.y > e.pos.y + e.height || o.pos.y + o.height < e.pos.y) continue;
    if (d > 0.5 && (dx * sy + dz * cy) / d < 0.45) continue;
    hitEnt = true;
    ents.damage(o, T.bashDmg * rc.punchK * PM('melee'), { type: 'melee', src: e, x: o.pos.x, y: o.pos.y + o.height * 0.5, z: o.pos.z, dx: sy, dy: 0.1, dz: cy });
    knock(o, sy * T.punchKnock * 1.5, cy * T.punchKnock * 1.5); stagger(o, 1.3);
  }
  bus.emit('punch', { x: ox + sy * 2, y: oy, z: oz + cy * 2, dx: sy, dy: 0, dz: cy, hit: n > 0 || hitEnt, team: 0, bash: true });
  if (n > 0 || hitEnt) { cam.shake(0.65); cam.kickFov(5); }
}

// ---- equipment: grapple claw ---------------------------------------------------------------------
const gr = { state: 'idle', x: 0, y: 0, z: 0, ent: null, t: 0, cd: 0, mesh: null };
function grReset() { gr.state = 'idle'; gr.ent = null; gr.t = 0; gr.cd = 0; if (gr.mesh) gr.mesh.visible = false; }
function grRelease(cd) { if (gr.state !== 'idle') bus.emit('grapple', { ent: mech, state: 'release' }); gr.state = 'idle'; gr.ent = null; gr.cd = cd; }
function grFire() {
  const e = mech, a = cam.aim;
  rigSock(rc.grappleSlot, _a);
  const d = _a.distanceTo(a.point);
  mechModel.trigger && mechModel.trigger('fire', rc.grappleSlot);
  if (!a.hit || d > T.grappleRange) {      // nothing to bite: the claw snaps out and back
    aimDir(_a, _b); gr.x = _a.x + _b.x * T.grappleRange; gr.y = _a.y + _b.y * T.grappleRange; gr.z = _a.z + _b.z * T.grappleRange;
    gr.state = 'miss'; gr.t = 0; bus.emit('grapple', { ent: e, state: 'miss' }); return;
  }
  gr.t = 0; gr.x = a.point.x; gr.y = a.point.y; gr.z = a.point.z;
  if (a.ent && a.ent.alive && a.ent.team === 1) { gr.ent = a.ent; gr.state = isBigRig(a.ent) ? 'pull' : 'yank'; }
  else { gr.ent = null; gr.state = 'reel'; if (rs.jet) { rs.jet = false; bus.emit('jet', { ent: e, on: false }); } }
  cam.shake(0.2);
  bus.emit('grapple', { ent: e, state: gr.state, x: gr.x, y: gr.y, z: gr.z, target: gr.ent });
}
// world hook: fly to the anchor. Returns true while the cable owns the rig's velocity.
function grReel(dt, ctl) {
  if (gr.state !== 'reel') return false;
  const e = mech, v = e.vel;
  gr.t += dt;
  const cx = e.pos.x, cyy = e.pos.y + e.height * 0.6, cz = e.pos.z;
  let dx = gr.x - cx, dy = gr.y - cyy, dz = gr.z - cz; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.01;
  const done = d < e.radius + 2.2 || gr.t > 4 || !ctl || input.pressed('Space') || (gr.t > 0.15 && input.pressed(rc.grappleKey)) || (e.hitWall && gr.t > 0.3 && d < e.radius + 6) || (e.hitCeil && gr.t > 0.3);
  if (done) {
    // let go: carry some of the speed and pop upward so the rig lands on top of what it flew at
    const sp = Math.hypot(v.x, v.z), k = sp > 16 ? 16 / sp : 1; v.x *= k; v.z *= k; v.y = Math.max(Math.min(v.y, 12), 7);
    grRelease(T.grappleCd); return false;
  }
  const s = Math.min(T.grappleSpeed, 12 + gr.t * 90);
  v.x = dx / d * s; v.y = dy / d * s; v.z = dz / d * s; e.onGround = false;
  if (G.fx.emit && (G.frame & 1) === 0) { sockPos(mechModel, 'jetL', _a, e, 0.55); G.fx.emit('jet', _a.x, _a.y, _a.z, -dx / d, -dy / d, -dz / d, 2); }
  return true;
}
function tearLimb(o) {
  const e = mech;
  o._ktTorn = o._ktTorn || {};
  const limb = !o._ktTorn.armR ? 'armR' : !o._ktTorn.armL ? 'armL' : null;
  if (limb) {
    o._ktTorn[limb] = true;
    if (typeof o.tearLimb === 'function') { try { o.tearLimb(limb, e); } catch (err) {} }
    else {
      const m = o.rig || o.model; if (m && m.setLimbLost) { try { m.setLimbLost(limb); } catch (err) {} }
      ents.damage(o, T.tearDmg, { type: 'melee', src: e, x: o.pos.x, y: o.pos.y + o.height * 0.7, z: o.pos.z, dx: Math.sin(rs.torsoYaw), dy: 0, dz: Math.cos(rs.torsoYaw) });
    }
    bus.emit('limb:torn', { ent: o, limb, by: e });
    if (G.destruct.burst) G.destruct.burst(o.pos.x, o.pos.y + o.height * 0.7, o.pos.z, { count: 16, colors: [0x3a2f33, 0x7a2f2a, 0xff7a1a], speed: 12, size: 0.5, up: 0.5 });
  } else ents.damage(o, T.tearDmg, { type: 'melee', src: e, x: o.pos.x, y: o.pos.y + o.height * 0.7, z: o.pos.z, dx: Math.sin(rs.torsoYaw), dy: 0, dz: Math.cos(rs.torsoYaw) });
  stagger(o, 1.6);
  mechModel.trigger && mechModel.trigger('punch', 'R');
  cam.shake(0.7); cam.kickFov(5);
}
function updateGrapple(dt, ctl) {
  const e = mech;
  if (gr.cd > 0) gr.cd -= dt;
  if (gr.state === 'idle') { if (ctl && input.pressed(rc.grappleKey) && gr.cd <= 0 && !held && !sh.on) grFire(); }
  else if (gr.state === 'miss') { gr.t += dt; if (gr.t > 0.22) grRelease(0.5); }
  else if (gr.state === 'pull' || gr.state === 'clinch' || gr.state === 'yank') {
    const o = gr.ent; gr.t += dt;
    if (!o || !o.alive || !ctl) { grRelease(T.grappleCd); }
    else {
      gr.x = o.pos.x; gr.y = o.pos.y + o.height * 0.6; gr.z = o.pos.z;
      const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 0.01, nx = dx / d, nz = dz / d, gap = e.radius + o.radius + 1.2;
      if (gr.state === 'pull') {
        // both rigs close: we lunge along the cable, the target is dragged off its feet toward us
        if (d > gap) {
          e.vel.x = nx * T.grapplePull; e.vel.z = nz * T.grapplePull;
          const step = Math.min(d - gap, T.grappleDrag * dt); o.pos.x -= nx * step; o.pos.z -= nz * step;
          if (gr.t > 3.5 || input.pressed(rc.grappleKey) && gr.t > 0.15) grRelease(T.grappleCd);
        } else { gr.state = 'clinch'; gr.t = 0; e.vel.x *= 0.2; e.vel.z *= 0.2; stagger(o, 0.8); bus.emit('grapple', { ent: e, state: 'clinch', target: o }); }
      } else if (gr.state === 'clinch') {
        if (d > gap + 4 || gr.t > T.clinchTime) grRelease(T.grappleCd);
        else if (input.pressed('KeyF')) { tearLimb(o); rs.punchCd = T.punchCd; grRelease(T.grappleCd * 1.5); }
      } else {                               // yank: small things come to us and get smashed
        const k = sat(gr.t / T.yankTime), fy = e.pos.y + e.height * 0.5 - o.height * 0.5;
        const tx = e.pos.x + Math.sin(rs.torsoYaw) * (e.radius + o.radius + 1), tz = e.pos.z + Math.cos(rs.torsoYaw) * (e.radius + o.radius + 1);
        o.pos.x += (tx - o.pos.x) * k; o.pos.z += (tz - o.pos.z) * k; o.pos.y += ((o.airborne || o.height < 3 ? fy : o.pos.y) - o.pos.y) * k;
        if (o.vel) o.vel.set(0, 0, 0);
        if (k >= 1) {
          ents.damage(o, T.yankDmg, { type: 'melee', src: e, x: o.pos.x, y: o.pos.y + o.height * 0.5, z: o.pos.z, dx: -nx, dy: -0.3, dz: -nz });
          bus.emit('punch', { x: o.pos.x, y: o.pos.y + o.height * 0.5, z: o.pos.z, dx: -nx, dy: -0.3, dz: -nz, hit: true, team: 0 });
          mechModel.trigger && mechModel.trigger('punch', rc.grappleSlot === 'armL' ? 'R' : 'L');
          if (o.alive) { knock(o, nx * 8, nz * 8); stagger(o, 1); }
          cam.shake(0.5); grRelease(T.grappleCd);
        }
      }
    }
  }
  // cable
  const m = gr.mesh;
  if (m) {
    if (gr.state === 'idle') m.visible = false;
    else {
      rigSock(rc.grappleSlot, _a);
      let ex = gr.x, ey = gr.y, ez = gr.z;
      if (gr.state === 'miss') { const k = gr.t < 0.11 ? gr.t / 0.11 : Math.max(0, 2 - gr.t / 0.11); ex = _a.x + (ex - _a.x) * k; ey = _a.y + (ey - _a.y) * k; ez = _a.z + (ez - _a.z) * k; }
      _b.set(ex - _a.x, ey - _a.y, ez - _a.z); const len = _b.length() || 0.01;
      m.position.set((_a.x + ex) * 0.5, (_a.y + ey) * 0.5, (_a.z + ez) * 0.5);
      m.quaternion.setFromUnitVectors(_m.set(0, 1, 0), _b.multiplyScalar(1 / len));
      m.scale.set(1, len, 1); m.visible = true;
    }
  }
}

// ---- brawling: knockback into buildings, finisher ----------------------------------------------
const knocks = [{ ent: null, vx: 0, vz: 0, t: 0, hit: false }, { ent: null, vx: 0, vz: 0, t: 0, hit: false }, { ent: null, vx: 0, vz: 0, t: 0, hit: false }, { ent: null, vx: 0, vz: 0, t: 0, hit: false }];
function knock(o, vx, vz) {
  if (o.vel) { o.vel.x += vx * 0.4; o.vel.z += vz * 0.4; o.vel.y += 3; }
  if (!isBigRig(o) && o.kind !== 'tank') { if (o.vel) { o.vel.x += vx * 0.6; o.vel.z += vz * 0.6; } return; }
  let k = knocks[0];
  for (let n = 0; n < knocks.length; n++) { if (knocks[n].ent === o) { k = knocks[n]; break; } if (!knocks[n].ent) k = knocks[n]; }
  k.ent = o; k.vx = vx; k.vz = vz; k.t = 0.55; k.hit = false;
}
// A rig that has been hit hard slides back; if a building is in the way it goes into the wall.
function updateKnocks(dt) {
  const g = G.grid;
  for (let n = 0; n < knocks.length; n++) {
    const k = knocks[n], o = k.ent; if (!o) continue;
    k.t -= dt;
    if (k.t <= 0 || !o.alive) { k.ent = null; continue; }
    const sp = Math.hypot(k.vx, k.vz), r = Math.min(2.2, o.radius), h = Math.min(10, o.height);
    const nx = o.pos.x + k.vx * dt, nz = o.pos.z + k.vz * dt;
    if (nx < r + 1 || nz < r + 1 || nx > WX - r - 1 || nz > WZ - r - 1) { k.ent = null; continue; }
    if (g.boxSolid(nx - r, o.pos.y + 0.6, nz - r, nx + r, o.pos.y + h, nz + r)) {
      const c = G.destruct.carveBox(nx - r - 0.3, o.pos.y + 0.55, nz - r - 0.3, nx + r + 0.3, o.pos.y + h, nz + r + 0.3, Math.min(190, 70 + sp * 7), true) || 0;
      if (!k.hit) {
        k.hit = true;
        ents.damage(o, T.wallSlamDmg + sp * 6, { type: 'crush', src: mech || pilot, x: nx, y: o.pos.y + h * 0.5, z: nz, dx: k.vx, dy: 0, dz: k.vz });
        bus.emit('shake', { amount: 0.5, x: nx, y: o.pos.y + 3, z: nz });
        bus.emit('debris:impact', { x: nx, y: o.pos.y + h * 0.5, z: nz, speed: sp, mass: 400, mat: 8 });
        stagger(o, 1.2);
      }
      k.vx *= 0.55; k.vz *= 0.55;
      if (c === 0 || g.boxSolid(nx - r, o.pos.y + 0.6, nz - r, nx + r, o.pos.y + h, nz + r)) { k.ent = null; continue; }
    }
    o.pos.x = nx; o.pos.z = nz;
    const f = Math.exp(-3.2 * dt); k.vx *= f; k.vz *= f;
  }
}
const fin = { o: null, t: 0, done: false, gy: 0 };
function findFinisherTarget() {
  const e = mech, sy = Math.sin(rs.torsoYaw), cy = Math.cos(rs.torsoYaw), L = ents.list;
  for (let i = 0; i < L.length; i++) {
    const o = L[i]; if (!o.alive || o.team !== 1 || !isBigRig(o) || o.airborne) continue;
    if (o.hp > o.maxHp * T.finisherHp || !isStaggered(o)) continue;
    const dx = o.pos.x - e.pos.x, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d > e.radius + o.radius + T.finisherReach || (dx * sy + dz * cy) / (d || 1) < 0.3) continue;
    return o;
  }
  return null;
}
function startFinisher(o) {
  fin.o = o; fin.t = 0; fin.done = false; fin.gy = o.pos.y; rs.busy = true;
  mech.invuln = true; stagger(o, 3);
  mechModel.trigger && mechModel.trigger('grab');
  bus.emit('finisher', { ent: o, by: mech, state: 'start' });
}
function updateFinisher(dt) {
  const e = mech, o = fin.o;
  fin.t += dt;
  if (!fin.done && (!o.alive || ents.list.indexOf(o) < 0)) fin.done = true;
  const sy = Math.sin(rs.torsoYaw), cy = Math.cos(rs.torsoYaw), fx = e.pos.x + sy * (e.radius + o.radius + 0.6), fz = e.pos.z + cy * (e.radius + o.radius + 0.6);
  e.vel.x = e.vel.z = 0;
  if (!fin.done) {
    // grab, lift, slam
    const t = fin.t, lift = t < 0.5 ? sat(t / 0.5) : t < 0.8 ? 1 : Math.max(0, 1 - (t - 0.8) / 0.14);
    const k = sat(t / 0.3);
    o.pos.x += (fx - o.pos.x) * k; o.pos.z += (fz - o.pos.z) * k; o.pos.y = fin.gy + lift * lift * (3 - 2 * lift) * 3.4;
    if (o.vel) o.vel.set(0, 0, 0);
    if (t >= 0.8 && !fin.slamAnim) { fin.slamAnim = true; mechModel.trigger && mechModel.trigger('slam'); }
    if (t >= 0.94) {
      fin.done = true; o.pos.y = fin.gy;
      const x = o.pos.x, y = o.pos.y, z = o.pos.z;
      ents.damage(o, 1e6, { type: 'melee', src: e, finisher: true, x, y: y + 2, z, dx: 0, dy: -1, dz: 0 });
      G.boom(x, y + 1, z, { radius: 5, power: 150, damage: 320, owner: e, kind: 'slam', friendlyFire: false });
      bus.emit('finisher', { ent: o, by: e, state: 'slam', x, y, z });
      bus.emit('slam', { x, y, z, radius: 5, team: 0 });
      cam.shake(1); cam.kickFov(8);
    }
  }
  if (fin.t >= 1.3) { fin.o = null; fin.slamAnim = false; rs.busy = false; e.invuln = god; }
}

function rigActions(dt, ctl) {
  const e = mech;
  if (rs.busy) ctl = false;
  const wdt = dt * (rc.reactor ? 1.3 : 1) * PM('cool');
  for (let n = 0; n < rigWeapons.length; n++) rigWeapons[n].update(wdt);
  rs.punchCd -= dt;
  const torsoOk = Math.abs(wrapPi(cam.yaw - rs.torsoYaw)) < T.rFireCone;
  sockPos(mechModel, 'cockpit', _c, e, 0.7);                  // chest reference point
  if (fin.o) updateFinisher(dt);
  updateKnocks(dt);
  updateShield(dt, ctl);
  if (rc.grappleSlot) updateGrapple(dt, ctl);

  // --- grab / throw ---
  rs.canGrab = false;
  const reviving = !held && updateRevive(dt, ctl, e);
  if (reviving) { /* E belongs to the revive */ }
  else if (held) {
    sockPos(mechModel, 'handR', _a, e, 0.5);
    const lift = (held.size || 2) * 0.35;
    held.object.position.set(_a.x + Math.sin(rs.torsoYaw) * lift, _a.y + lift, _a.z + Math.cos(rs.torsoYaw) * lift);
    held.object.rotation.y = rs.torsoYaw;
    if (rs.throwT >= 0) {
      rs.throwT += dt;
      if (rs.throwT >= timing('throwRelease', T.throwWind)) {
        rs.throwT = -1;
        const ch = held; held = null;
        _a.copy(ch.object.position);
        aimDir(_a, _b); const dist = _a.distanceTo(cam.aim.point);
        _b.y += clamp(dist / 420, 0, 0.14); _b.normalize().multiplyScalar(T.throwSpeed).add(e.vel);
        if (G.destruct.releaseChunk) G.combat.throwObject(ch, _a, _b, e);
        else {                                                // baseline: no rigid bodies, land it as a blast at the aim point
          ch.object.removeFromParent();
          G.boom(cam.aim.point.x, cam.aim.point.y, cam.aim.point.z, { radius: 3, power: 130, damage: 300, owner: e, kind: 'shell', friendlyFire: false });
        }
        cam.shake(0.3); cam.kickFov(4);
        bus.emit('throw', { ent: e, x: _a.x, y: _a.y, z: _a.z });
      }
    } else if (ctl && (input.pressed('KeyE') || input.buttonPressed(0))) { rs.throwT = 0; mechModel.trigger && mechModel.trigger('throw'); }
  } else if (ctl && gr.state === 'idle') {
    const a = cam.aim;
    const gx = a.point.x - e.pos.x, gz = a.point.z - e.pos.z, gy = a.point.y - e.pos.y;
    if (a.hit && !a.ent && gx * gx + gz * gz < T.grabReach * T.grabReach && gy < e.height + 2.5 && a.point.y - a.ny * 0.3 > GROUND_Y + 0.05 && a.mat !== 1) {
      rs.canGrab = true;
      if (input.pressed('KeyE')) {
        mechModel.trigger && mechModel.trigger('grab');
        const ch = G.destruct.grabChunk(a.point.x - a.nx * 0.5, a.point.y - a.ny * 0.5, a.point.z - a.nz * 0.5, T.grabR);
        if (ch && ch.object) {
          held = ch; rs.throwT = -1; rs.carveT = G.time;
          if (!ch.object.parent) { G.scene.add(ch.object); ch._kt_own = true; }
          bus.emit('grab', { ent: e, x: a.point.x, y: a.point.y, z: a.point.z });
          cam.shake(0.2);
        } else msg('NOTHING TO GRIP', '', 'warn', 1.2);
      }
    }
  }

  // --- punch / shield bash / finisher (F) ---
  rs.finTarget = ctl && !held && rs.punchT < 0 ? findFinisherTarget() : null;
  if (ctl && input.pressed('KeyF') && rs.punchCd <= 0 && rs.punchT < 0 && rs.bashT < 0 && !held && gr.state !== 'clinch') {
    if (rs.finTarget) { startFinisher(rs.finTarget); rs.punchCd = 1.4; }
    else if (sh.on) {
      rs.bashT = 0; rs.punchCd = T.punchCd * 1.3;
      mechModel.trigger && mechModel.trigger('punch', rc.shieldSlot === 'armL' ? 'L' : 'R');
      e.vel.x += Math.sin(rs.torsoYaw) * T.bashLunge; e.vel.z += Math.cos(rs.torsoYaw) * T.bashLunge;
    } else {
      // three-hit combo: left, right, then a heavy overhead
      rs.comboN = G.time - rs.lastPunch < T.comboWindow ? rs.comboN % 3 + 1 : 1; rs.lastPunch = G.time;
      rs.punchT = 0; rs.punchCd = rs.comboN === 3 ? T.punchCd * 1.25 : T.punchCd * 0.8; rs.punchSide ^= 1;
      if (mechModel.trigger) { mechModel.trigger('punch', rs.punchSide ? 'L' : 'R'); if (rs.comboN === 3) mechModel.trigger('punch', rs.punchSide ? 'R' : 'L'); }
      // a short lunge into the swing
      const lg = rs.brace ? 0 : rs.comboN === 3 ? 5.5 : 3.5;
      e.vel.x += Math.sin(cam.yaw) * lg; e.vel.z += Math.cos(cam.yaw) * lg;
    }
  }
  if (rs.punchT >= 0) {
    rs.punchT += dt;
    if (rs.punchT >= timing('punchHit', T.punchWind) * (rs.comboN === 3 ? 1.25 : 1)) { rs.punchT = -1; doPunch(); }
  }
  if (rs.bashT >= 0) { rs.bashT += dt; if (rs.bashT >= 0.16) { rs.bashT = -1; doBash(); } }

  // --- guns: LMB group 1, RMB group 2, Q group 3 ---
  const armed = ctl && !held && rs.throwT < 0;
  const b0 = armed && torsoOk && input.button(0), b2 = armed && torsoOk && input.button(2), bq = armed && torsoOk && input.down('KeyQ');
  fireGroup(1, b0, armed && input.buttonPressed(0), dt);
  fireGroup(2, b2, armed && input.buttonPressed(2), dt);
  fireGroup(3, bq, armed && input.pressed('KeyQ'), dt);
  // ripples stay glued to their hardpoints
  for (let n = 0; n < rigWeapons.length; n++) {
    const w = rigWeapons[n];
    if (w.burstLeft > 0 && w.setAim) { rigSock(w.slot, _a); if (w.kind === 'lock') _b.set(Math.sin(rs.torsoYaw) * 0.6, 0.8, Math.cos(rs.torsoYaw) * 0.6); else aimDir(_a, _b); w.setAim(_a, _b); }
  }
  updateLock(dt, armed && input.button(0), armed && input.buttonPressed(0), e, mechModel, rc.lockers[1], 1);
  updateLock(dt, armed && input.button(2), armed && input.buttonPressed(2), e, mechModel, rc.lockers[2], 2);
  updateLock(dt, armed && input.down('KeyQ'), armed && input.pressed('KeyQ'), e, mechModel, rc.lockers[3], 3);

  // --- eject ---
  if (ctl && input.down('KeyX')) { rs.ejectHold += dt / T.ejectHold; if (rs.ejectHold >= 1) { rs.ejectHold = 0; eject(true); } }
  else rs.ejectHold = 0;
}
function doPunch() {
  const e = mech, left = rs.punchSide === 1, heavy = rs.comboN === 3;
  sockPos(mechModel, 'cockpit', _c, e, 0.7);
  // swing from the shoulder on the punching side, toward the aim point (kept within a sane arc)
  const sy = Math.sin(rs.torsoYaw), cy = Math.cos(rs.torsoYaw), side = left ? -1 : 1;
  _a.set(_c.x - cy * 1.4 * side, e.pos.y + e.height * 0.5, _c.z + sy * 1.4 * side);       // fist height, not eye height
  // The crosshair rides high above the rig, so a level look at point-blank would swing over everything in front of it:
  // up close the swing goes straight out at fist height, and only follows the crosshair's height as the target recedes.
  const ap = cam.aim.point, pd = Math.hypot(ap.x - e.pos.x, ap.z - e.pos.z);
  const ty = lerp(_a.y - 0.4, ap.y, sat((pd - 7) / 9));
  _b.set(ap.x - _a.x, (cam.pitch < -0.35 || cam.pitch > 0.35 ? ap.y : ty) - _a.y, ap.z - _a.z);
  const l = _b.length();
  if (l < 2 || _b.x * cam.dir.x + _b.z * cam.dir.z < 0) { _b.set(cam.dir.x, 0, cam.dir.z); if (_b.lengthSq() < 0.01) _b.set(sy, 0, cy); _b.normalize(); } else _b.multiplyScalar(1 / l);
  _b.y = clamp(_b.y - (heavy ? 0.25 : 0), -0.75, 0.6); _b.normalize();
  const ox = _a.x + _b.x * 1.2, oy = _a.y + _b.y * 1.2 + (heavy ? 1.2 : 0), oz = _a.z + _b.z * 1.2;
  rs.carveT = G.time;
  const pk = rc.punchK * (heavy ? T.comboHeavy : 1);
  const n = G.destruct.punch(ox, oy, oz, _b.x, _b.y, _b.z, T.punchRadius * (heavy ? 1.3 : 1) * Math.sqrt(rc.ch.punch), T.punchDepth, Math.min(245, T.punchPower * Math.sqrt(pk)), e) || 0;
  let hitEnt = false;
  const L = ents.list;
  for (let i = L.length - 1; i >= 0; i--) {
    const o = L[i]; if (!o.alive || o.team === 0) continue;
    const cyo = clamp(_a.y, o.pos.y, o.pos.y + o.height);
    const dx = o.pos.x - _a.x, dy = cyo - _a.y, dz = o.pos.z - _a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz), reach = T.punchReach + o.radius;
    if (d > reach) continue;
    if (d > o.radius + 1.5 && (dx * _b.x + dy * _b.y + dz * _b.z) / d < 0.5) continue;      // ~60° half-arc
    hitEnt = true;
    ents.damage(o, T.punchDmg * pk * PM('melee'), { type: 'melee', src: e, x: o.pos.x, y: cyo, z: o.pos.z, dx: _b.x, dy: _b.y, dz: _b.z, combo: rs.comboN });
    const kb = T.punchKnock * (heavy ? 1.5 : 1) * Math.sqrt(rc.ch.punch);
    if (isBigRig(o) || o.kind === 'tank') { knock(o, _b.x * kb * 0.8, _b.z * kb * 0.8); stagger(o, heavy ? 1.5 : 0.6); }
    else if (o.vel) { o.vel.x += _b.x * kb; o.vel.z += _b.z * kb; o.vel.y += 4 + _b.y * kb * 0.5; }
  }
  const hit = n > 0 || hitEnt;
  netEvent({ type: 'punch', x: ox + _b.x * 2, y: oy + _b.y * 2, z: oz + _b.z * 2, dx: _b.x, dy: _b.y, dz: _b.z, hit, heavy, side: left ? 'L' : 'R' });
  bus.emit('punch', { x: ox + _b.x * 2, y: oy + _b.y * 2, z: oz + _b.z * 2, dx: _b.x, dy: _b.y, dz: _b.z, hit, team: 0, combo: rs.comboN, heavy });
  if (hit) { cam.shake(heavy ? 0.8 : 0.55); cam.kickFov(heavy ? 6 : 4); cam.recoil(-0.01, side * 0.012); }
}

// ---- pilot vs rig: boarding charge, hijack -------------------------------------------------------
const bc = { o: null, phase: '', t: 0, x: 0, y: 0, z: 0 };
function findChargeTarget() {
  const p = pilot.pos, L = ents.list; let best = null, bd = 1e9;
  for (let i = 0; i < L.length; i++) {
    const o = L[i]; if (!o.alive || o.team !== 1 || o.kind !== 'emech') continue;
    const dx = o.pos.x - p.x, dz = o.pos.z - p.z, d = Math.hypot(dx, dz) - o.radius;
    if (d > T.chargeReach || p.y < o.pos.y - 2 || p.y > o.pos.y + o.height + 1) continue;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}
function backPoint(o, out) { const yw = o.yaw || 0; return out.set(o.pos.x - Math.sin(yw) * o.radius * 0.95, o.pos.y + o.height * 0.68, o.pos.z - Math.cos(yw) * o.radius * 0.95); }
function startCharge(o) {
  lockClear('lost'); pilotClearMoves();
  bc.o = o; bc.phase = 'mount'; bc.t = 0;
  pilot.invuln = true; pilot.noHit = true; pilot.vel.set(0, 0, 0);
  if (ps.jet) { ps.jet = false; bus.emit('jet', { ent: pilot, on: false }); }
  pilotModel.trigger && pilotModel.trigger('jump');
  boardFrom.copy(pilot.pos);
  bus.emit('charge:mount', { ent: pilot, target: o });
}
function chargeLeap() {
  const o = bc.o, e = pilot, yw = (o && o.yaw) || cam.yaw + Math.PI;
  e.noHit = false; e.vel.set(-Math.sin(yw) * 9, 15, -Math.cos(yw) * 9); e.onGround = false;
  ps.noFall = true; ps.invulnT = 1.4; e.invuln = true; ps.fuel = Math.max(ps.fuel, 0.5); ps.coyote = 0;
  if (G.fx.emit) G.fx.emit('jet', e.pos.x, e.pos.y + 1, e.pos.z, 0, -1, 0, 5);
  bus.emit('jet', { ent: e, on: true }); bus.emit('jet', { ent: e, on: false });
  cam.kickFov(6);
}
// returns true while the pilot is riding the enemy rig (movement is ours)
function updateCharge(dt) {
  const o = bc.o; if (!o) return false;
  bc.t += dt;
  if (bc.phase === 'mount') {
    if (!o.alive || mode !== 'pilot') { chargeLeap(); bc.o = null; bc.phase = ''; return false; }
    backPoint(o, _a);
    const k = sat(bc.t / 0.35), e = pilot;
    e.pos.lerpVectors(boardFrom, _a, k * k * (3 - 2 * k)); e.pos.y += Math.sin(k * Math.PI) * 1.2; e.vel.set(0, 0, 0);
    ps.yaw = e.yaw = (o.yaw || 0);
    if (bc.t >= T.chargeMount) {
      bc.x = _a.x; bc.y = _a.y; bc.z = _a.z; bc.phase = 'fuse'; bc.t = 0;
      chargeLeap();
      bus.emit('charge:planted', { ent: pilot, target: o, x: bc.x, y: bc.y, z: bc.z });
      return false;
    }
    return true;
  }
  // fuse burning on the rig's back
  if (o.alive) { backPoint(o, _a); bc.x = _a.x; bc.y = _a.y; bc.z = _a.z; }
  if (bc.t >= T.chargeFuse) {
    bc.o = null; bc.phase = '';
    if (o.alive) { ents.damage(o, T.chargeDmg, { type: 'explosion', src: pilot, x: bc.x, y: bc.y, z: bc.z, dx: Math.sin(o.yaw || 0), dy: 0, dz: Math.cos(o.yaw || 0), charge: true }); if (o.alive) stagger(o, 2); }
    G.boom(bc.x, bc.y, bc.z, { radius: 2.6, power: 90, damage: 0, owner: pilot, kind: 'rocket', friendlyFire: false });
  }
  return false;
}
// A disabled Vanta rig (ENEMY sets ent.disabled) can be boarded and kept. Never triggers until ENEMY supports it.
function hijack(o) {
  const m = o.rig || o.model;
  if (!m || !m.root || mech) return false;
  try { if (typeof o.onHijack === 'function') o.onHijack(pilot); if (G.enemy && typeof G.enemy.release === 'function') G.enemy.release(o); } catch (e) {}
  rc = buildRigConfig(G.rigs ? G.rigs.DEFAULT_LOADOUTS[0] : null);
  rc.weapons.length = 0; for (let g = 0; g < 4; g++) { rc.groups[g].length = 0; rc.lockers[g].length = 0; }
  rc.shieldSlot = rc.grappleSlot = null; rc.hijacked = true; rc.hp = o.maxHp;
  addRigWeapon(rc, 'e_pulse', 'armL', 1) || addRigWeapon(rc, 'pulse', 'armL', 1);
  addRigWeapon(rc, 'e_salvo', 'shL', 2) || addRigWeapon(rc, 'salvo', 'shL', 2);
  o.team = 0; o.kind = 'mech'; o.disabled = false; o.isPlayer = false; o.hijacked = true;
  makeBody(o, Math.min(2.2, o.radius), Math.min(10.5, o.height), 1.0); o.onGround = true;
  o.onDamage = rigOnDamage; o.onDeath = undefined; o.rig = m; o.armor = 0.5;
  if (!o.vel) o.vel = new THREE.Vector3();
  m.onFootstep = (side, p) => { m._steps = true; if (o === mech) emitStep(p.x, p.y, p.z, true, 'mech'); };
  mine.add(o);
  mech = o; mechModel = m;
  if (ents.list.indexOf(o) < 0) ents.add(o);
  adoptRig(); rs.legYaw = rs.torsoYaw = o.yaw || 0;
  meter = 0; mechReady = false;
  bus.emit('mech:hijack', { ent: o, by: pilot });
  startBoarding();
  return true;
}

// ---- Rig Bay preview ---------------------------------------------------------------------------------
const pv = { model: null, lo: null, dirty: 0, yaw: 0.6, on: false, x: 0, y: 0, z: 0, placed: false, saved: false, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60, h: 8.5 };
const pvS = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0 };
function bayOpen() { const b = S.bay; return !!(b && b.open && (S.phase === 'title' || S.phase === 'paused')); }
function previewDispose() {
  if (pv.model) { pv.model.root && pv.model.root.removeFromParent(); pv.model.dispose && pv.model.dispose(); pv.model = null; }
  pv.lo = null;
}
function previewBuild() {
  const R = G.rigs, lo = (S.bay && S.bay.preview) || (R && R.bay.current);
  previewDispose();
  if (!lo) return;
  let m = null;
  try { const paint = R.PAINTS.find(p => p.id === lo.paint) || R.PAINTS[0]; m = G.models.create('mech', { chassis: lo.chassis, loadout: lo, paint }); } catch (e) { m = null; }
  if (!m || !m.root) { try { m = G.models.create('mech'); } catch (e) { return; } }
  pv.model = m; pv.lo = lo; pv.h = (R.CHASSIS[lo.chassis] || R.CHASSIS.warden).height;
  if (!pv.placed) { findDropSpot(WX / 2, WZ / 2, dropSpot); pv.x = dropSpot.x; pv.y = dropSpot.y; pv.z = dropSpot.z; pv.placed = true; }
  m.root.position.set(pv.x, pv.y, pv.z); m.root.rotation.y = pv.yaw;
  G.scene.add(m.root);
  if (m.setShield) m.setShield(lo.slots && (lo.slots.armL === 'shield' || lo.slots.armR === 'shield') ? 1 : 0);
}
// Runs every frame while the bay is open (title: from update; paused: from our own animation frame, the sim is frozen).
function previewFrame(raw) {
  const c = G.camera;
  if (!pv.on) {
    pv.on = true; pv.dirty = 0.001; pv.placed = false;
    pv.pos.copy(c.position); pv.quat.copy(c.quaternion); pv.fov = c.fov; pv.saved = true;
  }
  if (pv.dirty > 0) { pv.dirty -= raw; if (pv.dirty <= 0) previewBuild(); }
  else if (!pv.model || ((S.bay && S.bay.preview) && S.bay.preview !== pv.lo && pv.dirty <= 0)) pv.dirty = 0.12;
  const m = pv.model;
  if (m) { pv.yaw += raw * 0.3; m.root.rotation.y = pv.yaw; m.update(raw, pvS); }
  // frame the rig in the right two-thirds: the panel covers the left of the screen
  const h = pv.h, dist = h * 2.25, ty = pv.y + h * 0.5;
  // pick (once per placement) the viewing angle with the clearest line to the rig, so no lamp post or wall sits in front
  if (pv.aFor !== pv.x * 1000 + pv.z) {
    pv.aFor = pv.x * 1000 + pv.z; let best = -1; pv.a = 0.5;
    for (let n = 0; n < 16; n++) {
      const an = 0.5 + n * Math.PI / 8, cx = pv.x + Math.sin(an) * dist, cz = pv.z + Math.cos(an) * dist, cy = pv.y + h * 0.62; let sc = 0;
      for (let q = 0; q < 5; q++) { const ty2 = pv.y + h * (0.1 + 0.2 * q); if (G.grid.los(cx, cy, cz, pv.x, ty2, pv.z)) sc++; }
      if (!G.grid.solidAt(cx, cy, cz)) sc += 0.5;
      if (sc > best) { best = sc; pv.a = an; }
    }
  }
  const a = pv.a;
  // clip everything between the camera and the rig as a second guard
  const nearWant = Math.max(0.15, dist - h * 0.9);
  if (pv.near == null) pv.near = c.near;
  if (Math.abs(c.near - nearWant) > 0.01) { c.near = nearWant; c.updateProjectionMatrix(); }
  const narrow = (G.width || 1280) <= 700;
  const px = pv.x + Math.sin(a) * dist, pz = pv.z + Math.cos(a) * dist, py = pv.y + h * 0.62;
  const fov = 38, half = Math.tan(fov * Math.PI / 360) * dist * (c.aspect || 1.78);
  // camera right = (-cos a', 0, sin a') for a view direction pointing from the camera to the rig
  const dx = pv.x - px, dz = pv.z - pz, dl = Math.hypot(dx, dz) || 1, rx = -dz / dl * -1, rz = dx / dl * -1;
  const sh2 = narrow ? 0 : half * 0.36;
  c.position.set(px, py, pz); c.up.set(0, 1, 0);
  c.lookAt(pv.x + rx * sh2, ty, pv.z + rz * sh2);      // look to the rig's screen-left so it sits right of centre
  if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
}
function previewClose() {
  if (!pv.on) return;
  pv.on = false; previewDispose();
  if (pv.near != null) { G.camera.near = pv.near; pv.near = null; G.camera.updateProjectionMatrix(); }
  if (pv.saved && S.phase === 'paused') { const c = G.camera; c.position.copy(pv.pos); c.quaternion.copy(pv.quat); c.fov = pv.fov; c.updateProjectionMatrix(); }
  pv.saved = false; cam.hasFocus = cam.hasFocus && S.phase !== 'title';
}

// ---- co-op hooks (all guarded: nothing here runs or allocates offline) ---------------------------
const online = () => { const n = G.net; return !!(n && n.online); };
const netEvents = [];
function netEvent(ev) { if (!online()) return; if (netEvents.length >= 64) netEvents.shift(); netEvents.push(ev); }
// rig.trigger calls on our own models are one-shots other peers must replay on the puppet
function tapTriggers(m, who) {
  if (!m || !m.trigger || m._ktTap) return m;
  const orig = m.trigger; m._ktTap = true;
  m.trigger = function (name, arg) { if (online()) netEvent({ type: 'trigger', who, name, arg: arg == null ? null : arg }); return orig.call(m, name, arg); };
  return m;
}
const NS = {
  mode: 'pilot', chassis: '', loadout: null, paint: '', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0,
  speed: 0, fwd: 0, strafe: 0, grounded: true, jet: 0, heat: 0, hpFrac: 1,
  flags: { crouch: false, slide: false, roll: false, shield: false, brace: false, dash: false, down: false, grab: false },
  hasRig: false, rigX: 0, rigY: 0, rigZ: 0, rigYaw: 0, rigHpFrac: 1, incoming: null, _inc: { x: 0, z: 0, eta: 0 },
};
function netState() {
  const n = NS, inRig = mode === 'mech' && mech, e = inRig ? mech : pilot, s = inRig ? rigS : pilotS, f = n.flags;
  n.mode = mode; n.chassis = mech && rc ? rc.chassis : ''; n.loadout = mech ? mech.loadout || null : null; n.paint = n.loadout ? n.loadout.paint : '';
  n.x = e.pos.x; n.y = e.pos.y; n.z = e.pos.z; n.vx = e.vel.x; n.vy = e.vel.y; n.vz = e.vel.z;
  n.yaw = inRig ? rs.legYaw : ps.yaw; n.aimYaw = inRig ? rs.torsoYaw : cam.yaw; n.aimPitch = cam.pitch;
  n.speed = s.speed; n.fwd = s.fwd; n.strafe = s.strafe; n.grounded = !!e.onGround; n.jet = s.jet; n.heat = s.heat || 0;
  n.hpFrac = e.maxHp > 0 ? sat(e.hp / e.maxHp) : 0;
  f.crouch = !inRig && ps.crouch && e.h < 1.8; f.slide = !inRig && ps.slide; f.roll = !inRig && ps.roll >= 0;
  f.shield = !!inRig && sh.on; f.brace = !!inRig && rs.brace; f.dash = !!inRig && rs.dashT > 0; f.down = mode === 'down' || mode === 'dead'; f.grab = !!held;
  const waiting = mech && !inRig && !drop && mech.alive;
  n.hasRig = !!waiting;
  if (waiting) { n.rigX = mech.pos.x; n.rigY = mech.pos.y; n.rigZ = mech.pos.z; n.rigYaw = rs.legYaw; n.rigHpFrac = sat(mech.hp / mech.maxHp); }
  if (drop) { n.incoming = n._inc; n._inc.x = drop.x; n._inc.z = drop.z; n._inc.eta = Math.max(0, T.dropEta - drop.t); } else n.incoming = null;
  return n;
}
// --- downed / spectate / revive ---
const dn = { spec: 0, target: null, t: 0, revEnt: null, revT: 0, cause: '' };
function setDown(info) {
  if (mode === 'down' || mode === 'dead') return;
  if (mode === 'mech') eject(false);
  lockClear('lost'); pilotClearMoves(); bc.o = null; bc.phase = '';
  if (ps.jet) { ps.jet = false; bus.emit('jet', { ent: pilot, on: false }); }
  mode = 'down'; dn.t = 0; dn.target = null; dn.cause = (info && info.type) || 'unknown';
  pilot.alive = false; pilot.hp = 0; pilot.down = true; pilot.noHit = true;
  overPos.copy(pilot.pos);
  pilotModel.trigger && pilotModel.trigger('death');
  cam.shake(0.6);
  netEvent({ type: 'down', x: pilot.pos.x, y: pilot.pos.y, z: pilot.pos.z });
  bus.emit('player:down', { ent: pilot, cause: dn.cause, x: pilot.pos.x, y: pilot.pos.y, z: pilot.pos.z });
}
function applyRevive(frac) {
  if (mode !== 'down') return false;
  const e = pilot;
  e.alive = true; e.down = false; e.noHit = false; e.hp = e.maxHp * (frac || 0.5); e.vel.set(0, 0, 0); e.lastHitT = G.time;
  if (ents.list.indexOf(e) < 0) ents.add(e);
  mode = 'pilot'; ps.invulnT = 2; e.invuln = true; ps.fuel = 1; pilotHeight(1.8);
  G.grid.unstick(e, 8);
  pilotModel.root.visible = true;
  pilotModel.trigger && (pilotModel.trigger('revive'), pilotModel.trigger('land', 0.5));
  cam.setPreset('pilot'); cam.hasFocus = false; cam.scale = 1; dn.target = null;
  netEvent({ type: 'revived', x: e.pos.x, y: e.pos.y, z: e.pos.z });
  bus.emit('player:revived', { ent: e });
  return true;
}
function allDown(cause) {            // NET (or our own check) says nobody is left standing: the run is over
  if (mode === 'dead') return;
  if (mode !== 'down') setDown({ type: cause || 'unknown' });
  mode = 'dead'; ps.deadT = 0; overPos.copy(pilot.pos);
  bus.emit('player:dead', { cause: cause || dn.cause, x: pilot.pos.x, y: pilot.pos.y, z: pilot.pos.z });
}
function livingMate(skip) {          // skip-th living teammate, wrapping; null when there is none
  const L = G.net && G.net.players ? G.net.players() : null; if (!L) return null;
  let n = 0; for (let i = 0; i < L.length; i++) { const o = L[i]; if (o && o !== pilot && o !== mech && o.alive && !o.down) n++; }
  if (!n) return null;
  let k = ((skip % n) + n) % n;
  for (let i = 0; i < L.length; i++) { const o = L[i]; if (o && o !== pilot && o !== mech && o.alive && !o.down) { if (k-- === 0) return o; } }
  return null;
}
function updateDown(dt) {
  dn.t += dt;
  const v = pilot.vel; v.x = damp(v.x, 0, 3, dt); v.z = damp(v.z, 0, 3, dt); v.y = Math.max(-60, v.y - T.pGrav * dt);
  G.grid.moveBody(pilot, dt); G.grid.unstick(pilot, 8);
  overPos.lerp(pilot.pos, 0.2);
  if (!online()) { allDown(dn.cause); return; }                       // went offline while down
  if (input.buttonPressed(0)) dn.spec++;
  dn.target = livingMate(dn.spec);
  // nobody left: NET normally calls G.player.allDown(); fall back to our own count after a grace period
  const nt = G.net;
  if (!dn.target && dn.t > 1.5 && nt.reportsAllDown !== true) allDown(dn.cause);
}
function downCamera(dt) {
  const o = dn.target;
  if (!o) { cam.updateOver(dt, overPos); return; }
  const big = o.height > 4;
  cam.setPreset(big ? 'mech' : 'pilot'); cam.scale = big ? clamp(o.height / 8.5, 0.8, 1.25) : 1; cam.autoShoulder = false; cam.low = 0;
  cam.update(dt, o.pos, false);
}
// hold E next to a downed teammate
function updateRevive(dt, ctl, e) {
  dn.revEnt = null;
  if (!online() || !ctl) { dn.revT = 0; return false; }
  const L = ents.list; let best = null, bd = 1e9;
  for (let i = 0; i < L.length; i++) {
    const o = L[i]; if (!o.remote || !o.down || o.team !== 0) continue;
    const dx = o.pos.x - e.pos.x, dy = o.pos.y - e.pos.y, dz = o.pos.z - e.pos.z, d = Math.hypot(dx, dz) - e.radius;
    if (d < T.reviveReach && dy > -e.height - 2 && dy < e.height + 2 && d < bd) { bd = d; best = o; }
  }
  if (!best) { dn.revT = 0; return false; }
  dn.revEnt = best;
  if (input.down('KeyE')) { dn.revT += dt; if (dn.revT >= T.reviveTime) { dn.revT = 0; bus.emit('revive', { ent: best, by: e }); netEvent({ type: 'revive', target: best.netOwner == null ? null : best.netOwner }); } }
  else dn.revT = 0;
  return true;
}

// ---- drop marker -----------------------------------------------------------------
function buildMarker() {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.5, 1.9), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  marker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.3, 2.65, 40), mat); ring.rotation.x = -Math.PI / 2; marker.add(ring);
  const ring2 = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.45, 16), mat); ring2.rotation.x = -Math.PI / 2; marker.add(ring2);
  for (let n = 0; n < 4; n++) { const t = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 1.3), mat); t.rotation.x = -Math.PI / 2; t.rotation.z = n * Math.PI / 2; t.position.set(Math.sin(n * Math.PI / 2) * 3.4, 0, Math.cos(n * Math.PI / 2) * 3.4); marker.add(t); }
  const bm = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.9, 1.2), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  markerBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 8, 1, true), bm); markerBeam.scale.y = 160; markerBeam.position.y = 80; marker.add(markerBeam);
  marker.visible = false; marker.renderOrder = 5;
  G.scene.add(marker);
  gr.mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 1.9), fog: false }));
  gr.mesh.visible = false; gr.mesh.frustumCulled = false; G.scene.add(gr.mesh);
}
function updateMarker(dt) {
  let show = false;
  if (drop) {
    show = true; marker.position.set(drop.x, drop.landY + 0.12, drop.z); markerBeam.visible = true;
    const k = 1 + 0.5 * sat(1 - drop.t / T.dropEta); marker.scale.set(k, 1, k);
    marker.rotation.y += dt * 2.5;
  } else if (mode === 'pilot' && mechReady && !mech && S.phase === 'playing') {
    markerT -= dt;
    if (markerT <= 0) { markerT = 0.08; aimedDropPoint(dropSpot); }
    show = true; marker.position.set(dropSpot.x, dropSpot.y + 0.12, dropSpot.z); markerBeam.visible = false; marker.scale.set(1, 1, 1);
    marker.rotation.y += dt * 0.6;
  }
  marker.visible = show;
}

// ---- score / meter -----------------------------------------------------------------
function onDeath(d) {
  const e = d.ent, info = d.info || {};
  if (!e || e.team !== 1) return;
  if (!info.src || !mine.has(info.src)) return;
  const kind = e.kind;
  SP.kills++;
  SP.combo = comboT > 0 ? SP.combo + 1 : 1; comboT = T.comboTime;
  let pts = T.points[kind] || 100, label = KIND_LABEL[kind] || String(kind || 'KILL').toUpperCase();
  if (e.variant === 'ace' || e.ace) { pts *= 3; label = 'ACE'; }
  if (e.variant === 'heavy') { pts *= 1.5; label = 'HEAVY RIG'; }
  if (info.type === 'crush') { pts *= 1.5; label += ' · CRUSHED'; }
  else if (info.type === 'debris') { pts *= 1.5; label += ' · BURIED'; }
  else if (info.finisher) { pts *= 2; label += ' · FINISHER'; }
  else if (info.type === 'melee') { pts *= 1.25; label += ' · PUNCHED'; }
  else if (info.type === 'slam') label += ' · SLAMMED';
  pts = Math.round(pts * (1 + Math.min(9, SP.combo - 1) * 0.1) / 5) * 5;
  SP.score += pts;
  bus.emit('score', { points: pts, label, x: e.pos.x, y: e.pos.y + e.height, z: e.pos.z });
  if (!mech && !drop) addMeter((T.meterKill[kind] == null ? 0.07 : T.meterKill[kind]) * PM('meter'));
}
function addMeter(a) {
  if (mechReady) return;
  meter = Math.min(1, meter + a);
  if (meter >= 1) { mechReady = true; bus.emit('meter:ready', {}); }
}
function onEntDamage(d) {
  perkBonus(d);
  const info = d.info;
  if (d.ent && d.ent.team === 1 && info && info.src && mine.has(info.src)) hitMarker = 1;
}

// ---- lifecycle -------------------------------------------------------------------
function setupRun() {
  const sp = G.city.spawns.player, g = G.grid;
  god = G.params.has('god') && G.params.get('god') !== '0';
  mine.clear();
  mode = 'pilot'; drop = null; boarding = null; ejecting = null; held = null; won = false;
  netEvents.length = 0; dn.target = null; dn.revEnt = null; dn.revT = 0; dn.spec = 0;
  meter = G.params.has('meter') ? 1 : 0; mechReady = meter >= 1; comboT = 0; hitMarker = 0; prompt = '';
  lock.targets.length = 0; lock.owners.length = 0; lock.cand = null; lock.candW = null; lock.prog = 0; lock.active = false; lock.group = 0;
  bc.o = null; bc.phase = '';
  Object.assign(ps, { yaw: sp.yaw || 0, coyote: 0, jumpBuf: 0, jet: false, fuel: 1, fuelDelay: 0, faceT: 0, noFall: false, invulnT: 0, stride: 0, semiBuf: 0, deadT: 0, slide: false, slideT: 0, roll: -1, rollCd: 0, rollIf: 0, landRoll: 0, mantle: -1, crouch: false, crouchK: 0, popT: 0, lowCover: false, coverT: 0, inCover: false });
  pilotModel = tapTriggers(G.models.create('pilot'), 'pilot');
  pilotModel.onFootstep = (side, p) => { pilotModel._steps = true; if (mode === 'pilot') emitStep(p.x, p.y, p.z, false, 'pilot'); };
  G.scene.add(pilotModel.root);
  pilot = createPilotEnt(sp.x, Math.max(GROUND_Y, g.topBelow(sp.x, GROUND_Y + 2.5, sp.z)), sp.z);
  g.unstick(pilot, 30);
  if (god) pilot.invuln = true;
  mine.add(pilot); ents.add(pilot);
  const C = G.combat;
  wRifle = C.createWeapon('rifle'); wLauncher = C.createWeapon('launcher');
  wSeek = C.WEAPONS && C.WEAPONS.seeker ? C.createWeapon('seeker') : null;      // on-foot anti-air (optional until COMBAT ships it)
  pilotWeapons.length = 0; pilotWeapons.push(wRifle, wLauncher); if (wSeek) pilotWeapons.push(wSeek);
  rigWeapons.length = 0;
  pilotLockWs.length = 0; if (wSeek) { wSeek.sock = pilotModel.sockets && pilotModel.sockets.aaPod ? 'aaPod' : 'rocketPod'; wSeek.key = 'Q'; pilotLockWs.push(wSeek); }
  wRifle.key = 'LMB'; wLauncher.key = 'RMB';
  cam.reset(sp.yaw || 0);
  Object.assign(SP, { mode: 'pilot', ent: pilot, pilot, mech: null, meter, mechReady, mechIncoming: 0, yaw: cam.yaw, pitch: cam.pitch, weapons: pilotWeapons, activeWeapon: 0, jet: 1, canEnter: false, canEject: false, grab: null, prompt: '', hitMarker: 0, kills: 0, score: 0, combo: 0 });
  SP.lock.target = null; SP.lock.progress = 0; SP.lock.locked = false; SP.lock.targets = lock.targets;
  SP.aim.copy(pilot.pos); SP.aimEnt = null; SP.ejectHold = 0; SP.dash = 1; SP.sprint = false;
  if (G.rigs && G.params.has('loadout')) G.rigs.bay.active = clamp(parseInt(G.params.get('loadout')) || 0, 0, 2);
  if (G.params.has('bay') && S.bay) { S.bay.open = true; if (!S.bay.preview) S.bay.preview = currentLoadout(); }
  if (G.params.has('mech') && G.params.get('mech') !== '0') debug.spawnRig(sp.x, sp.z, true);
}
function teardownRun() {
  if (held && held.object) held.object.removeFromParent(); held = null;
  disposeMech();
  if (pilotModel) { pilotModel.root.removeFromParent(); pilotModel.dispose && pilotModel.dispose(); pilotModel = null; }
  if (marker) marker.visible = false;
  previewClose(); bc.o = null; cam.scale = 1;
  G.timeScale = 1;
}

// debug / harness hooks (also handy for other agents' harnesses)
const debug = {
  spawnRig(x, z, board, loadout) {
    if (mech) return false;
    if (loadout != null && G.rigs) G.rigs.bay.active = clamp(loadout | 0, 0, 2);
    findDropSpot(x, z, dropSpot);
    const e = createMechEnt(dropSpot.x, dropSpot.y, dropSpot.z); ents.add(e); G.grid.unstick(e, 12); e.onGround = true;
    S.stats.mechsCalled++; meter = 0; mechReady = false;
    if (board) { pilot.pos.copy(e.pos); mechModel.trigger = mechModel.trigger || (() => {}); boarding = { t: T.boardTime }; boardFrom.copy(pilot.pos); finishBoarding(); cam.setPreset('mech', true); cam.hasFocus = false; }
    return true;
  },
  callDrop(x, z) { return callDrop(x, z); },
  board() { if (mech && !drop && mode === 'pilot' && !boarding) { startBoarding(); return true; } return false; },
  eject(manual) { return eject(manual !== false); },
  fillMeter() { addMeter(1); },
  teleport(x, y, z) { const e = mode === 'mech' ? mech : pilot; e.pos.set(x, y, z); e.vel.set(0, 0, 0); G.grid.unstick(e, 40); cam.hasFocus = false; },
  look(yaw, pitch) { cam.yaw = yaw; if (pitch != null) cam.pitch = pitch; if (mode === 'mech') rs.torsoYaw = yaw; else ps.yaw = yaw; },
  lookAt(x, y, z) { const pv = cam.pivot, dx = x - pv.x, dy = y - pv.y, dz = z - pv.z; debug.look(Math.atan2(dx, dz), Math.atan2(dy, Math.hypot(dx, dz))); },
  info() {
    const e = mode === 'mech' ? mech : pilot;
    return { mode, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2), vy: +e.vel.y.toFixed(2), sp: +Math.hypot(e.vel.x, e.vel.z).toFixed(2), ground: e.onGround, hp: Math.round(e.hp), pilotHp: Math.round(pilot.hp), mechHp: mech ? Math.round(mech.hp) : null, meter: +meter.toFixed(3), ready: mechReady, incoming: +SP.mechIncoming.toFixed(2), canEnter: SP.canEnter, fuel: +SP.jet.toFixed(2), aim: [+SP.aim.x.toFixed(1), +SP.aim.y.toFixed(1), +SP.aim.z.toFixed(1)], camDist: +cam.dist.toFixed(2), kills: SP.kills, score: SP.score, prompt: SP.prompt, held: !!held, locks: lock.targets.length, ts: G.timeScale };
  },
  cam, rs, ps, gr, sh, fin, bc, pv, applyPerks,
  get won() { return won; },
  get rc() { return rc; }, stagger, hijack,
};

export default {
  name: 'player', ent: null, tune: TUNE, camPreset: CAM_PRESET, debug, cam,
  init() {
    buildMarker();
    bus.on('ent:death', onDeath);
    bus.on('ent:damage', onEntDamage);
    bus.on('explosion', (d) => cam.shakeAt(clamp(d.radius / 7, 0.2, 1), d.x, d.y, d.z, 14 + d.radius * 4));
    bus.on('mech:land', (d) => cam.shakeAt(1, d.x, d.y, d.z, 60));
    bus.on('collapse', (d) => cam.shakeAt(clamp(0.3 + (d.mass || 0) / 4000, 0.3, 0.9), d.x, d.y, d.z, 45));
    bus.on('slam', (d) => cam.shakeAt(0.9, d.x, d.y, d.z, 30));
    bus.on('mech:selfdestruct', (d) => cam.shakeAt(1, d.x, d.y, d.z, 80));
    bus.on('shake', (d) => { if (d.x == null) cam.shake(d.amount || 0); else cam.shakeAt(d.amount || 0, d.x, d.y, d.z, 30); });
    bus.on('footstep', (d) => { if (d.heavy) cam.shakeAt(d.team === 0 && mode === 'mech' ? 0.16 : 0.22, d.x, d.y, d.z, 16); });
    bus.on('debris:impact', (d) => { if (d.mass > 20) cam.shakeAt(clamp(d.mass / 600, 0.05, 0.4), d.x, d.y, d.z, 14); });
    bus.on('game:start', () => { cam.hasFocus = false; cam.pitch = -0.06; won = false; applyPerks(false); });
    bus.on('perk:taken', () => applyPerks(true));
    bus.on('game:won', () => { if (won) return; won = true; lockClear('lost'); cam.hasFocus = true; cam.orbit = cam.yaw + Math.PI; if (rs.jet && mech) { rs.jet = false; bus.emit('jet', { ent: mech, on: false }); } });
    bus.on('weapon:recoil', (d) => {
      if (!d || d.shooter !== mech || mode !== 'mech') return;
      const k = d.strength == null ? 1 : d.strength;
      cam.recoil(0.04 * k, 0); cam.kickFov(6 * k); cam.shake(0.55 * k);
      if (!rs.brace) { mech.vel.x -= Math.sin(rs.torsoYaw) * T.siegeRecoil * k; mech.vel.z -= Math.cos(rs.torsoYaw) * T.siegeRecoil * k; }
    });
    bus.on('bay:preview', () => { pv.dirty = 0.12; });
    bus.on('bay:close', () => previewClose());
    // while paused the sim (and our update) is frozen: keep the Rig Bay preview alive from our own frame callback
    const tick = () => { requestAnimationFrame(tick); if (S.phase === 'paused') { if (bayOpen()) previewFrame(G.rawDt || 0.016); else if (pv.on) previewClose(); } };
    requestAnimationFrame(tick);
    setupRun();
  },
  reset() { teardownRun(); setupRun(); },
  cameraShake(amount) { cam.shake(amount); },
  // co-op hooks (see notes/player.md "Wire contract")
  netState, netEvents, setDown() { setDown(null); }, applyRevive, allDown, hitConfirm() { hitMarker = 1; },

  update(dt) {
    const phase = S.phase;
    if (phase === 'title') {
      // the pilot waits at the spawn; the camera tours the district
      if (pilot.alive) { updatePilotMove(dt, false); pilotAnim(dt); }
      if (mech) { idleRig(dt); rigAnim(dt); }
      if (bayOpen()) previewFrame(G.rawDt || dt); else { if (pv.on) previewClose(); cam.updateTitle(dt); }
      this.writeState(dt);
      return;
    }
    if (pv.on) previewClose();
    const playing = phase === 'playing';
    if (mode !== 'pilot' || boarding) cam.low = 0;
    cam.autoShoulder = mode === 'pilot' && !boarding;
    const pick = offering();                                   // perk picker open: the sim crawls, the keys belong to the UI
    const ctl = playing && !boarding && !pick && !won;
    cam.look(playing && mode !== 'dead' && !pick && !won);
    if (mode === 'down') updateDown(dt);

    // --- simulate bodies ---
    if (mode === 'pilot') {
      if (boarding) updateBoarding(dt);
      if (!boarding && mode === 'pilot') updatePilotMove(dt, ctl);
    } else if (mode === 'dead') {
      ps.deadT += dt;
      const v = pilot.vel; v.x = damp(v.x, 0, 3, dt); v.z = damp(v.z, 0, 3, dt); v.y = Math.max(-60, v.y - T.pGrav * dt);
      G.grid.moveBody(pilot, dt);
      overPos.lerp(pilot.pos, 0.2);
    }
    if (mech) {
      if (drop) updateDrop(dt);
      else if (mode === 'mech') rigMove(dt, ctl);
      else if (!ejecting) {
        idleRig(dt);
        if (!mech.alive) { detonateRig(9, 500); msg('RIG LOST', 'meter reset', 'warn', 3); }      // shot to pieces while empty
      }
    }
    if (mode === 'mech' && mech && !mech.alive && !ejecting) eject(false);     // armour gone: automatic ejection
    if (ejecting) updateEject(dt);

    // --- models (sockets must be current before the camera and the guns) ---
    if (mode !== 'mech') pilotAnim(dt);
    if (mech) rigAnim(dt);

    // --- camera + aim ---
    if (mode === 'dead') cam.updateOver(dt, overPos);
    else if (mode === 'down') downCamera(dt);
    else if (won) { const w = mode === 'mech' ? mech : pilot; _ft.copy(w.pos).setY(w.pos.y + w.height * 0.45); cam.updateOver(dt, _ft, 6 + w.height * 1.7); }
    else {
      let tgt = mode === 'mech' ? mech.pos : pilot.pos;
      if (boarding) { const k = sat(boarding.t / T.boardTime); _ft.lerpVectors(pilot.pos, mech.pos, k * k); tgt = _ft; if (k > 0.35) cam.setPreset('mech'); }
      cam.fovAdd = damp(cam.fovAdd, mode === 'pilot' && ps.sprint ? 5 : mode === 'mech' && rs.jet ? 3 : 0, 6, G.rawDt || dt);
      cam.update(dt, tgt, false);
      // the pilot model would fill the screen when the boom collapses against a wall
      if (mode === 'pilot' && !boarding) pilotModel.root.visible = cam.dist > 0.9;
    }

    // --- actions ---
    SP.canEnter = false;
    if (mode === 'pilot') pilotActions(dt, ctl && !ejecting || ctl && ejecting && ejecting.real > 0.3);
    else for (let n = 0; n < pilotWeapons.length; n++) pilotWeapons[n].update(dt);
    if (mode === 'mech' && mech) rigActions(dt, ctl);
    else for (let n = 0; n < rigWeapons.length; n++) rigWeapons[n].update(dt);

    // --- meter ---
    if (playing && mode === 'pilot' && !mech && !drop && !mechReady) addMeter(dt * T.meterTime * PM('meter'));
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) SP.combo = 0; }
    hitMarker = Math.max(0, hitMarker - (G.rawDt || dt) * 4);
    updateMarker(dt);
    this.writeState(dt);
  },

  writeState(dt) {
    const p = SP;
    this.ent = mode === 'mech' && mech ? mech : pilot;
    p.mode = mode; p.ent = this.ent; p.pilot = pilot; p.mech = mech;
    p.meter = meter; p.mechReady = mechReady; p.mechIncoming = drop ? Math.max(0.01, T.dropEta - drop.t) : 0;
    p.yaw = cam.yaw; p.pitch = cam.pitch;
    p.weapons = mode === 'mech' ? rigWeapons : pilotWeapons;
    if (mode === 'mech') { p.jet = rs.fuel; p.dash = rs.dashN / rc.dashMax; p.dashCharges = rs.dashN; } else { p.jet = ps.fuel; p.dash = 1; p.dashCharges = 0; }
    p.brace = mode === 'mech' && rs.brace; p.chassis = mode === 'mech' && rc ? rc.chassis : '';
    const R = G.rigs;
    if (R) { const lo = R.bay.current, L = p.loadout || (p.loadout = { name: '', chassis: '', index: 0, over: false }); L.name = lo.name; L.chassis = lo.chassis; L.index = R.bay.active; }
    const q = p.equip || (p.equip = { shield: null, grapple: null, _s: { on: false, energy: 1, broken: false, key: 'G' }, _g: { state: 'ready', key: 'G' } });
    if (mode === 'mech' && rc && rc.shieldSlot && mech.shield) { q.shield = q._s; q._s.on = sh.on; q._s.energy = sat(mech.shield.hp / sh.max); q._s.broken = sh.broken; q._s.key = rc.shieldKey === 'KeyT' ? 'T' : 'G'; } else q.shield = null;
    if (mode === 'mech' && rc && rc.grappleSlot) { q.grapple = q._g; q._g.state = gr.state === 'idle' ? (gr.cd > 0 ? 'cooldown' : 'ready') : gr.state; q._g.key = rc.grappleKey === 'KeyT' ? 'T' : 'G'; } else q.grapple = null;
    p.sprint = mode === 'pilot' && !!ps.sprint; p.slide = mode === 'pilot' && ps.slide; p.roll = mode === 'pilot' && ps.roll >= 0;
    p.crouch = mode === 'pilot' && ps.crouch; p.inCover = mode === 'pilot' && ps.inCover; p.shoulder = cam.sideWant;
    if (mode !== 'pilot') { p.canPlant = false; p.canHijack = false; }
    p.canEject = mode === 'mech' && !ejecting;
    p.ejectHold = mode === 'mech' ? rs.ejectHold : 0;
    p.grab = held;
    p.lock.target = lock.cand || lock.targets[lock.targets.length - 1] || null;
    p.lock.progress = lock.cand ? sat(lock.prog) : lock.targets.length ? 1 : 0;
    p.lock.locked = lock.targets.length > 0;
    p.aim.copy(cam.aim.point); p.aimEnt = cam.aim.ent;
    p.hitMarker = hitMarker;
    // context prompt (one line; the HUD styles it)
    let s = '';
    if (S.phase === 'playing') {
      if (mode === 'pilot') {
        if (boarding) s = '';
        else if (bc.phase === 'mount') s = 'PLANTING CHARGE…';
        else if (lock.active) s = lock.targets.length ? 'RELEASE Q — FIRE SEEKER ×' + lock.targets.length : 'SEEKER SEEKING';
        else if (dn.revEnt) s = 'HOLD E — REVIVE';
        else if (p.canEnter) s = 'E — BOARD RIG';
        else if (p.canHijack) s = 'E — HIJACK RIG';
        else if (p.canPlant) s = 'E — PLANT CHARGE';
        else if (drop) s = 'RIG INBOUND';
        else if (mechReady && !mech) s = dropSpot.ok ? 'V — CALL RIG DROP' : 'V — CALL RIG DROP (DANGER CLOSE)';
        else if (mech && !ejecting) s = 'RIG WAITING';
      } else if (mode === 'mech') {
        if (rs.ejectHold > 0) s = 'EJECTING…';
        else if (dn.revEnt) s = 'HOLD E — REVIVE';
        else if (held) s = 'LMB / E — THROW';
        else if (mech && mech.hp < mech.maxHp * 0.2) s = 'HOLD X — EJECT';
        else if (fin.o) s = '';
        else if (gr.state === 'clinch') s = 'F — TEAR LIMB';
        else if (rs.finTarget) s = 'F — FINISHER';
        else if (gr.state === 'reel') s = 'SPACE — RELEASE';
        else if (lock.active) { const k = KEY_OF[lock.group] || 'Q'; s = lock.targets.length ? 'RELEASE ' + k + ' — FIRE ×' + lock.targets.length : 'SEEKING LOCK'; }
        else if (rs.brace) s = 'BRACED';
        else if (rs.canGrab) s = 'E — GRAB';
      }
    }
    if (mode === 'down' && S.phase === 'playing') s = dn.target ? 'LMB — NEXT TEAMMATE' : '';
    p.prompt = s;
    p.down = mode === 'down'; p.spectating = mode === 'down' ? dn.target : null;
    const rv = p.revive || (p.revive = { ent: null, progress: 0 }); rv.ent = mode === 'down' ? null : dn.revEnt; rv.progress = rv.ent ? sat(dn.revT / T.reviveTime) : 0;
  },
};
