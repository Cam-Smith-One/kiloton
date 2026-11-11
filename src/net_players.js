// ============================================================================
// KILOTON — net_players.js   OWNER: NET
// Player replication: the local player's state / one-shots / shots go out,
// remote players come in as interpolated puppet entities with real models.
// Also the hit-claim path and enemy-shot replay (same messages).
// ============================================================================
import { G, bus, THREE, clamp, wrapPi } from './core.js';
import { T, StreamClock } from './net_wire.js';

const INTERP = 0.12, RATE = 1 / 20, PID0 = 0xF000;
const SLOTS = ['armL', 'armR', 'shL', 'shR', 'back'];
const NB = 8;
let N = null;                             // the net module
let sendT = 0, lastLo, loT = 0;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
const _opt = { remote: true, seed: 0, target: null, slot: null, team: 0 };
const _it = { x: 0, y: 0, z: 0, yaw: 0, aimYaw: 0, aimPitch: 0 };
const _pl = [];
const SP = () => G.state.player;
const safe = (fn) => { try { return fn(); } catch (e) { if (G.debug) console.warn('net', e); return undefined; } };

export function init(net) {
  N = net;
  bus.on('shot', onShot);
  bus.on('beam', onBeam);
  bus.on('ent:death', onDeath);
}

// ---- peers --------------------------------------------------------------------
export function makePeer(id, name) {
  const buf = []; for (let i = 0; i < NB; i++) buf.push({ t: 0, x: 0, y: 0, z: 0, yaw: 0, aimYaw: 0, aimPitch: 0 });
  return {
    id, name: name || 'Pilot', ready: false, ent: null, pilot: null, mech: null, state: null,
    pm: null, mm: null, lo: null, hijack: false, clk: new StreamClock(), buf, bh: 0, bn: 0, drop: null, ejectT: 0, wasJet: false, down: false, seen: false,
    st: { t: 0, mode: 0, grounded: true, crouch: false, slide: false, roll: false, shield: false, brace: false, dash: false, grab: false, hasRig: false, incoming: false, down: false,
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0, speed: 0, fwd: 0, strafe: 0, heat: 0, jet: 0, hp: 1, rx: 0, ry: 0, rz: 0, ryaw: 0, rhp: 1 },
    anim: { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0, crouch: 0, slide: 0, roll: 0, shield: 0, brace: 0 },
    ranim: { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false, heat: 0, shield: 0, brace: 0 },
  };
}
const netIdOf = (pid, mech) => PID0 + pid * 2 + (mech ? 1 : 0);

function listed(e, want) {
  if (!e) return;
  const L = G.ents.list, i = L.indexOf(e);
  if (want && i < 0) { const a = e.alive, id = e.netId; G.ents.add(e); e.alive = a; e.netId = id; }
  else if (!want && i >= 0) G.ents.remove(e);
}
function disposeModel(m) { if (!m) return; safe(() => { m.onFootstep = null; m.root.removeFromParent(); m.dispose && m.dispose(); }); }

function ensurePilot(p) {
  if (p.pilot) return;
  const m = p.pm = safe(() => G.models.create('pilot')); if (!m) return;
  m.onFootstep = (side, w) => bus.emit('footstep', { x: w.x, y: w.y, z: w.z, heavy: false, kind: 'pilot', team: 0, remote: true });
  G.scene.add(m.root);
  p.pilot = { kind: 'pilot', team: 0, remote: true, netOwner: p.id, netId: netIdOf(p.id, false), isPlayer: false, name: p.name,
    pos: new THREE.Vector3(p.st.x, p.st.y, p.st.z), vel: new THREE.Vector3(), radius: m.radius || 0.35, height: m.height || 1.8, hp: 100, maxHp: 100, yaw: 0, rig: m, down: false };
  listed(p.pilot, true);
}
function ensureMech(p) {
  if (p.mech) return;
  const lo = p.lo && typeof p.lo === 'object' ? p.lo : null;
  let m = null;
  if (p.hijack) m = safe(() => G.models.create('emech', { variant: 'standard' }));
  else if (lo) m = safe(() => G.models.create('mech', { chassis: lo.chassis, loadout: lo, paint: lo.paint }));
  if (!m || !m.root) m = safe(() => G.models.create('mech'));
  if (!m) return;
  p.mm = m;
  m.onFootstep = (side, w) => bus.emit('footstep', { x: w.x, y: w.y, z: w.z, heavy: true, kind: 'mech', team: 0, remote: true });
  G.scene.add(m.root);
  let hp = 1800; if (lo && G.rigs) safe(() => { hp = G.rigs.derive(lo).hp || hp; });
  p.mech = { kind: 'mech', team: 0, remote: true, netOwner: p.id, netId: netIdOf(p.id, true), isPlayer: false, name: p.name, chassis: lo ? lo.chassis : 'warden', loadout: lo,
    pos: new THREE.Vector3(p.st.rx, p.st.ry, p.st.rz), vel: new THREE.Vector3(), radius: m.radius || 1.8, height: m.height || 8.5, hp, maxHp: hp, yaw: 0, rig: m };
}
function dropMech(p) {
  if (!p.mech) return;
  if (p.wasJet) { p.wasJet = false; bus.emit('jet', { ent: p.mech, on: false, remote: true }); }
  listed(p.mech, false); disposeModel(p.mm); p.mech.alive = false; p.mech = null; p.mm = null; p.drop = null; p.ejectT = 0; p.hijack = false;
}
export function disposePeer(p) {
  dropMech(p);
  if (p.pilot) { listed(p.pilot, false); p.pilot.alive = false; }
  disposeModel(p.pm); p.pilot = null; p.pm = null; p.ent = null; p.bn = 0; p.seen = false; p.clk.reset(); p.down = false;
}
export function reset() { for (const p of N.peers.values()) disposePeer(p); sendT = 0; lastLo = undefined; for (const e of heldBy.keys()) e.held = false; heldBy.clear(); pb.sendT.clear(); pb.n = 0; }

// ---- lookups --------------------------------------------------------------------
export function entById(id) {
  if (!id) return null;
  if (typeof id === 'string') {             // mission props ('m:relay', 'm:core'): MISSION's entity on this peer
    const M = G.mission; if (M && M.entByNetId) { const e = safe(() => M.entByNetId(id)); if (e) return e; }
    const L = G.ents.list; for (let i = 0; i < L.length; i++) if (L[i].netId === id) return L[i];
    return null;
  }
  if (id >= PID0) {
    const pid = (id - PID0) >> 1, mech = (id & 1) === 1;
    if (pid === N.id) { const s = SP(); return (mech ? s.mech : s.pilot) || null; }
    const p = N.peers.get(pid); return p ? (mech ? p.mech : p.pilot) || null : null;
  }
  const E = G.enemy;
  if (E && E.byNetId) { const u = safe(() => E.byNetId(id)); if (u) return u.ent || null; }
  const L = G.ents.list; for (let i = 0; i < L.length; i++) if (L[i].netId === id) return L[i];
  return null;
}
function tagLocal() {
  const s = SP();
  if (s.pilot) { s.pilot.netId = netIdOf(N.id, false); if (!s.pilot.name) s.pilot.name = N.name; }
  if (s.mech) s.mech.netId = netIdOf(N.id, true);
}
export function players() {
  _pl.length = 0;
  const s = SP(), me = s.ent || (G.player && G.player.ent) || null;
  if (me) _pl.push(me);
  for (const p of N.peers.values()) if (p.ent) _pl.push(p.ent);
  return _pl;
}
export function localDown() { const s = SP(); return !!(s.down || s.mode === 'down' || s.mode === 'dead'); }

// ---- outgoing: state, loadout, one-shots ---------------------------------------------
const FB = { mode: 'pilot', chassis: '', loadout: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0, speed: 0, fwd: 0, strafe: 0, grounded: true, jet: 0, heat: 0, hpFrac: 1,
  flags: { crouch: false, slide: false, roll: false, shield: false, brace: false, dash: false, down: false, grab: false }, hasRig: false, rigX: 0, rigY: 0, rigZ: 0, rigYaw: 0, rigHpFrac: 1, incoming: null };
function fallbackState() {             // FALLBACK (no G.player.netState, e.g. the baseline fly camera): the controlled entity, or the camera
  const s = SP(), e = s.ent, n = FB;
  if (e) { n.mode = s.mode === 'mech' ? 'mech' : s.mode === 'dead' ? 'dead' : 'pilot'; n.x = e.pos.x; n.y = e.pos.y; n.z = e.pos.z; n.vx = e.vel.x; n.vy = e.vel.y; n.vz = e.vel.z; n.hpFrac = e.maxHp ? clamp(e.hp / e.maxHp, 0, 1) : 1; n.speed = Math.hypot(e.vel.x, e.vel.z); n.flags.down = !e.alive; }
  else { const c = G.camera.position; n.x = c.x; n.y = c.y - 1.6; n.z = c.z; }
  n.yaw = n.aimYaw = s.yaw || 0; n.aimPitch = s.pitch || 0;
  return n;
}
const MODE = { pilot: 0, mech: 1, down: 2, dead: 3 };
export function late(dt) {
  tagLocal();
  const P = G.player;
  // one-shot events queued by PLAYER (triggers, punch, slam, drop, land, board, eject, down, revive …)
  const ev = P && P.netEvents;
  if (ev && ev.length) {
    for (let i = 0; i < ev.length; i++) if (ev[i].type === 'revive' && ev[i].target === N.id) ev.splice(i--, 1);
    if (ev.length) N.sendJ({ k: 'pev', e: ev.slice() });
    ev.length = 0;
  }
  sendT -= dt > 0 ? dt : N.idleDt;
  if (sendT > 0) return;
  sendT += RATE; if (sendT < -RATE) sendT = 0;
  const n = (P && P.netState && safe(() => P.netState())) || fallbackState(), f = n.flags || FB.flags;
  if (n.loadout !== lastLo || (loT -= RATE) <= 0) {         // loadout / paint: when the reference changes, and every few seconds
    if (n.loadout !== lastLo || n.loadout) N.sendJ({ k: 'pl', lo: n.loadout && typeof n.loadout === 'object' ? n.loadout : null });
    lastLo = n.loadout; loT = 5;
  }
  const w = N.out(0); w.begin(T.PSTATE);
  w.f32(N.time);
  w.u8((MODE[n.mode] || 0) | (n.grounded ? 4 : 0) | (f.crouch ? 8 : 0) | (f.slide ? 16 : 0) | (f.roll ? 32 : 0) | (f.shield ? 64 : 0) | (f.brace ? 128 : 0));
  w.u8((f.dash ? 1 : 0) | (f.grab ? 2 : 0) | (n.hasRig ? 4 : 0) | (n.incoming ? 8 : 0) | (f.down ? 16 : 0));
  w.pos(n.x, n.y, n.z); w.i8(n.vx * 2); w.i8(n.vy * 2); w.i8(n.vz * 2);
  w.ang(n.yaw); w.ang(n.aimYaw); w.i8(n.aimPitch * 80);
  w.u8(clamp(Math.round((n.speed || 0) * 8), 0, 255)); w.i8((n.fwd || 0) * 64); w.i8((n.strafe || 0) * 100);
  w.unit(n.heat || 0); w.unit(n.jet || 0); w.unit(n.hpFrac == null ? 1 : n.hpFrac);
  if (n.hasRig) { w.pos(n.rigX, n.rigY, n.rigZ); w.ang(n.rigYaw); w.unit(n.rigHpFrac); }
  w.end();
}

// ---- incoming -------------------------------------------------------------------------
export function onState(p, r) {
  const s = p.st, t = r.f32(), a = r.u8(), b = r.u8();
  s.t = t; s.mode = a & 3; s.grounded = !!(a & 4); s.crouch = !!(a & 8); s.slide = !!(a & 16); s.roll = !!(a & 32); s.shield = !!(a & 64); s.brace = !!(a & 128);
  s.dash = !!(b & 1); s.grab = !!(b & 2); s.hasRig = !!(b & 4); s.incoming = !!(b & 8); s.down = !!(b & 16);
  s.x = r.px(); s.y = r.py(); s.z = r.px(); s.vx = r.i8() / 2; s.vy = r.i8() / 2; s.vz = r.i8() / 2;
  s.yaw = r.ang(); s.aimYaw = r.ang(); s.aimPitch = r.i8() / 80;
  s.speed = r.u8() / 8; s.fwd = r.i8() / 64; s.strafe = r.i8() / 100; s.heat = r.unit(); s.jet = r.unit(); s.hp = r.unit();
  if (s.hasRig) { s.rx = r.px(); s.ry = r.py(); s.rz = r.px(); s.ryaw = r.ang(); s.rhp = r.unit(); }
  p.clk.sample(t, N.time);
  const q = p.buf[p.bh]; p.bh = (p.bh + 1) % NB; if (p.bn < NB) p.bn++;
  q.t = t; q.x = s.x; q.y = s.y; q.z = s.z; q.yaw = s.yaw; q.aimYaw = s.aimYaw; q.aimPitch = s.aimPitch;
  p.state = s; p.seen = true;
}
export function onLoadout(p, d) {
  const lo = d.lo && typeof d.lo === 'object' ? d.lo : null, was = p.lo ? JSON.stringify(p.lo) : '';
  if (lo && JSON.stringify(lo) === was) return;
  p.lo = lo;
  if (p.mech && lo && !p.hijack) { const pos = p.mech.pos.clone(), dr = p.drop; dropMech(p); ensureMech(p); if (p.mech) { p.mech.pos.copy(pos); p.drop = dr; } }
}
export function onEvents(p, list) {
  if (N.status !== 'playing' || !Array.isArray(list)) return;
  for (const e of list) safe(() => {
    switch (e.type) {
      case 'trigger': { const m = e.who === 'mech' ? p.mm : p.pm; if (m && m.trigger) m.trigger(e.name, e.arg == null ? undefined : e.arg); break; }
      case 'punch': bus.emit('punch', { x: e.x, y: e.y, z: e.z, dx: e.dx, dy: e.dy, dz: e.dz, hit: e.hit, team: 0, remote: true }); break;
      case 'slam': bus.emit('slam', { x: e.x, y: e.y, z: e.z, radius: e.radius, team: 0, remote: true }); break;
      case 'drop':
        if (e.loadout && typeof e.loadout === 'object') p.lo = e.loadout;
        dropMech(p); p.hijack = false; ensureMech(p);
        if (p.mech) { p.drop = { x: e.x, y: e.y, z: e.z, t: e.eta || 3 }; p.mech.pos.set(e.x, e.y + 400, e.z); }
        bus.emit('mech:incoming', { x: e.x, z: e.z, team: 0, eta: e.eta || 3, remote: true, netOwner: p.id });
        break;
      case 'land':
        if (p.mech) { p.drop = null; p.mech.pos.set(e.x, e.y, e.z); if (p.mm && p.mm.trigger) p.mm.trigger('land', 1); }
        bus.emit('mech:land', { x: e.x, y: e.y, z: e.z, team: 0, remote: true, netOwner: p.id });
        break;
      case 'board': if (e.hijack && !p.hijack) { dropMech(p); p.hijack = true; ensureMech(p); if (p.mech) p.mech.pos.set(e.x, e.y, e.z); } break;
      case 'eject': p.ejectT = 4; break;
      case 'selfdestruct': dropMech(p); break;
      case 'down': p.down = true; bus.emit('player:down', { ent: p.pilot, x: e.x, y: e.y, z: e.z, remote: true, name: p.name }); bus.emit('ui:message', { text: p.name.toUpperCase() + ' IS DOWN', sub: 'Hold E beside them to revive', kind: 'warn', dur: 3 }); break;
      case 'revived': p.down = false; bus.emit('player:revived', { ent: p.pilot, remote: true, name: p.name }); break;
      case 'revive': if (e.target === N.id) reviveLocal(); break;
    }
  });
}
export function reviveLocal() { const P = G.player; if (P && P.applyRevive) safe(() => P.applyRevive()); }

function sample(p, rt, out) {
  const n = p.bn; let a = null, b = null;
  for (let i = 0; i < n; i++) { const s = p.buf[(p.bh - 1 - i + NB * 2) % NB]; if (s.t <= rt) { a = s; break; } b = s; }
  if (!a) a = b;
  if (!a) return false;
  if (!b || b === a) {                               // starved: run on with the last velocity for a moment
    const st = p.st, k = clamp(rt - a.t, 0, 0.25);
    out.x = a.x + st.vx * k; out.y = a.y + (st.grounded ? 0 : st.vy * k); out.z = a.z + st.vz * k; out.yaw = a.yaw; out.aimYaw = a.aimYaw; out.aimPitch = a.aimPitch; return true;
  }
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const k = dx * dx + dy * dy + dz * dz > 144 ? 1 : clamp((rt - a.t) / Math.max(1e-4, b.t - a.t), 0, 1);     // teleports snap
  out.x = a.x + dx * k; out.y = a.y + dy * k; out.z = a.z + dz * k;
  out.yaw = a.yaw + wrapPi(b.yaw - a.yaw) * k; out.aimYaw = a.aimYaw + wrapPi(b.aimYaw - a.aimYaw) * k; out.aimPitch = a.aimPitch + (b.aimPitch - a.aimPitch) * k;
  return true;
}

export function update(dt) {
  tagLocal();
  for (const p of N.peers.values()) {
    if (!p.seen) continue;
    const s = p.st, it = _it;
    if (!sample(p, p.clk.playout(N.time, INTERP), it)) continue;
    const inRig = s.mode === 1, down = s.mode >= 2 || s.down;
    ensurePilot(p);
    if (p.ejectT > 0) p.ejectT -= dt;
    const wantMech = inRig || s.hasRig || !!p.drop || p.ejectT > 0;
    if (wantMech) ensureMech(p); else if (p.mech) dropMech(p);
    // --- pilot ---
    const pe = p.pilot, pm = p.pm;
    if (pe && pm) {
      if (inRig) { listed(pe, false); pm.root.visible = false; pe.pos.set(it.x, it.y, it.z); }
      else {
        pe.pos.set(it.x, it.y, it.z); pe.vel.set(s.vx, s.vy, s.vz); pe.yaw = it.yaw;
        pe.down = down; pe.noHit = down; pe.alive = !down; pe.hp = down ? 0 : Math.max(1, s.hp * pe.maxHp);
        listed(pe, true); pe.alive = !down;
        const a = p.anim;
        a.speed = s.speed; a.fwd = s.fwd; a.strafe = s.strafe; a.aimYaw = wrapPi(it.aimYaw - it.yaw); a.aimPitch = it.aimPitch; a.grounded = s.grounded; a.vy = s.vy; a.jet = s.jet; a.dead = down; a.heat = 0;
        a.crouch = s.crouch ? 1 : 0; a.slide = s.slide ? 1 : 0; a.roll = s.roll ? 1 : 0;
        pm.root.visible = true; pm.root.position.copy(pe.pos); pm.root.rotation.y = it.yaw;
        safe(() => pm.update(dt, a));
        const jet = s.jet > 0.5 && !down; if (jet !== p.wasJet && !p.mech) { p.wasJet = jet; bus.emit('jet', { ent: pe, on: jet, remote: true }); }
      }
    }
    // --- rig ---
    const me = p.mech, mm = p.mm;
    if (me && mm) {
      const a = p.ranim; let yaw = me.yaw;
      if (p.drop) {
        const d = p.drop; d.t -= dt; const t = Math.max(0, d.t);
        me.pos.set(d.x, d.y + t * 36 + t * t * 3, d.z); me.noHit = true; me.alive = false; listed(me, false);
        a.speed = 0; a.fwd = 0; a.strafe = 0; a.grounded = false; a.vy = -40; a.jet = 1; a.dead = false;
        if (d.t < -1.5) p.drop = null;
      } else if (inRig) {
        me.pos.set(it.x, it.y, it.z); me.vel.set(s.vx, s.vy, s.vz); yaw = it.yaw;
        me.noHit = false; me.alive = true; me.hp = Math.max(1, s.hp * me.maxHp); me.armor = 0; listed(me, true); me.alive = true;
        a.speed = s.speed; a.fwd = s.fwd; a.strafe = s.strafe; a.aimYaw = wrapPi(it.aimYaw - it.yaw); a.aimPitch = clamp(it.aimPitch, -0.8, 0.9); a.grounded = s.grounded; a.vy = s.vy; a.jet = s.jet; a.dead = false; a.heat = s.heat;
        a.shield = s.shield ? 1 : 0; a.brace = s.brace ? 1 : 0;
        const jet = s.jet > 0.5; if (jet !== p.wasJet) { p.wasJet = jet; bus.emit('jet', { ent: me, on: jet, remote: true }); }
      } else if (s.hasRig) {                          // standing empty, waiting for its pilot
        const k = Math.min(1, dt * 10); me.pos.x += (s.rx - me.pos.x) * k; me.pos.y += (s.ry - me.pos.y) * k; me.pos.z += (s.rz - me.pos.z) * k; yaw = s.ryaw;
        if (Math.abs(s.rx - me.pos.x) + Math.abs(s.rz - me.pos.z) + Math.abs(s.ry - me.pos.y) > 20) me.pos.set(s.rx, s.ry, s.rz);
        me.vel.set(0, 0, 0); me.noHit = false; me.alive = true; me.hp = Math.max(1, s.rhp * me.maxHp); me.armor = 0.5; listed(me, true); me.alive = true;
        a.speed = 0; a.fwd = 0; a.strafe = 0; a.aimYaw = 0; a.aimPitch = 0; a.grounded = true; a.vy = 0; a.jet = 0; a.dead = false; a.heat = 0; a.shield = 0; a.brace = 0;
        if (p.wasJet) { p.wasJet = false; bus.emit('jet', { ent: me, on: false, remote: true }); }
      } else {                                        // ejected: the wreck stands until its self-destruct arrives
        me.alive = false; me.noHit = true; listed(me, false); a.dead = true; a.speed = 0; a.jet = 0;
      }
      me.yaw = yaw; mm.root.position.copy(me.pos); mm.root.rotation.y = yaw;
      safe(() => { mm.update(dt, a); if (mm.setDamage) mm.setDamage(1 - clamp(me.hp / me.maxHp, 0, 1)); if (mm.setShield) mm.setShield(a.shield ? 1 : 0); });
    }
    p.ent = inRig && me ? me : pe; p.down = down;
  }
}

// ---- shots: the local player's and (host) the enemies' are broadcast and replayed ---------------
function sendShot(type, d) {
  const sh = d.shooter;
  if (!sh || sh.remote) return;
  if (sh.team !== 0 && !N.isHost) return;
  if (sh.team === 0 && sh !== SP().pilot && sh !== SP().mech) return;
  const tg = d.target && d.target.netId != null ? d.target.netId : 0;
  const w = N.out(0); w.begin(type);
  w.str(d.weapon); w.f32(d.x); w.f32(d.y); w.f32(d.z); w.dir(d.dx, d.dy, d.dz);
  w.id(sh.netId || 0); w.id(tg); w.u8(SLOTS.indexOf(d.slot) + 1); w.u8(sh.team & 255); w.u32(d.seed || 0);
  w.end();
  N.stats.shotsOut++;
}
function onShot(d) { if (!N.online || N.status !== 'playing' || !d || d.remote || d.child || d.kind === 'beam') return; sendShot(T.SHOT, d); }
function onBeam(d) { if (!N.online || N.status !== 'playing' || !d || d.remote) return; sendShot(T.BEAM, d); }
export function onShotMsg(r) {
  if (N.status !== 'playing') return;
  const id = r.str(); _o.set(r.f32(), r.f32(), r.f32()); _d.set(r.dirc(), r.dirc(), r.dirc());
  const sid = r.id(), tid = r.id(), slot = r.u8(), team = r.u8(), seed = r.u32();
  const C = G.combat; if (!C || !C.fireProjectile) return;
  _opt.seed = seed; _opt.target = tid ? entById(tid) : null; _opt.slot = slot ? SLOTS[slot - 1] : null; _opt.team = team;
  N.stats.shotsIn++;
  safe(() => C.fireProjectile(id, sid ? entById(sid) : null, _o, _d, _opt));
  _opt.target = null;
}

// ---- hit claims --------------------------------------------------------------------------
const TYPES = ['bullet', 'pulse', 'rocket', 'explosion', 'melee', 'debris', 'crush', 'fall', 'slam', 'fire'];
export function claimHit(ent, amount, info) {
  if (!N.online || N.status !== 'playing' || !ent || !(amount > 0)) return;
  info = info || {};
  const src = info.src || null;
  if (src && src.remote) return;                               // somebody else's entity did this: their peer decides
  let to;
  if (ent.netOwner != null) { if (!N.isHost || ent.netOwner === N.id) return; to = ent.netOwner; }   // another player: only the host's simulation hurts them
  else { if (N.isHost) return; to = 255; }
  if (ent.netId == null) return;
  const w = N.out(to); w.begin(T.CLAIM);
  w.id(ent.netId); w.id(src && src.netId != null ? src.netId : 0); w.f32(amount);
  const ti = TYPES.indexOf(info.type); w.u8(ti < 0 ? 255 : ti); w.str(info.weapon || '');
  if (info.x == null) w.pos(ent.pos.x, ent.pos.y + ent.height * 0.5, ent.pos.z); else w.pos(info.x, info.y, info.z);
  const dx = info.dx || 0, dy = info.dy || 0, dz = info.dz || 0, l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  w.i8(dx / l * 127); w.i8(dy / l * 127); w.i8(dz / l * 127);
  w.u8((info.finisher ? 1 : 0) | (info.bonus ? 2 : 0) | (info.limb === 'armL' ? 4 : info.limb === 'armR' ? 8 : 0));
  w.end();
  N.stats.claimsOut++;
  if (ent.team === 1 && src) {                                 // local feedback: hit marker, perk top-ups, hit FX / sound
    const P = G.player; if (P && P.hitConfirm) safe(() => P.hitConfirm());
    bus.emit('ent:damage', { ent, amount, info, claim: true });
  }
}
export function onClaim(from, r) {
  const tid = r.id(), sid = r.id(), amount = r.f32(), ti = r.u8(), weapon = r.str();
  const x = r.px(), y = r.py(), z = r.px(), dx = r.i8() / 127, dy = r.i8() / 127, dz = r.i8() / 127, fl = r.u8();
  if (N.status !== 'playing') return;
  const e = entById(tid); if (!e || !e.alive || e.remote) return;
  let src = sid ? entById(sid) : null;
  if (!src && from !== N.hostId) { const p = N.peers.get(from); src = p ? p.ent : null; }
  if (from !== N.hostId && src && src.netOwner !== from) return;          // a client can only claim for its own entities
  const info = { type: TYPES[ti] || 'bullet', src, x, y, z, dx, dy, dz, fromNet: true };
  if (weapon) info.weapon = weapon;
  if (fl & 1) info.finisher = true; if (fl & 2) info.bonus = true; if (fl & 4) info.limb = 'armL'; else if (fl & 8) info.limb = 'armR';
  N.stats.claimsIn++;
  G.ents.damage(e, amount, info);
}

// ---- enemy deaths: the host says who killed what, so score / meter / kill feed work on every peer -------
function onDeath(d) {
  if (!N.online || !N.isHost || N.status !== 'playing' || !d || !d.ent) return;
  const e = d.ent, info = d.info || {};
  if (e.remote || e.netId == null || info.fromRelay || (e.team !== 1 && typeof e.netId !== 'string')) return;   // Vanta units, and mission props of either side
  const src = info.src || null;
  const w = N.out(0); w.begin(T.EDEATH);
  w.id(e.netId); w.id(src && src.netId != null ? src.netId : 0);
  const ti = TYPES.indexOf(info.type); w.u8(ti < 0 ? 255 : ti); w.u8(info.finisher ? 1 : 0); w.str(info.weapon || '');
  w.end();
}
export function onDeathMsg(r) {
  const id = r.id(), sid = r.id(), ti = r.u8(), fl = r.u8(), weapon = r.str();
  if (N.status !== 'playing' || N.isHost) return;
  const e = entById(id); if (!e) return;
  const info = { type: TYPES[ti] || 'explosion', src: sid ? entById(sid) : null, fromNet: true, fromRelay: true };
  if (weapon) info.weapon = weapon; if (fl & 1) info.finisher = true;
  if (e.alive) { e.hp = 0; e.alive = false; bus.emit('ent:death', { ent: e, info }); }
  const E = G.enemy; if (typeof id === 'number' && E && E.puppetDeath) safe(() => E.puppetDeath(id));
}

// ---- pushes: PLAYER moves enemy puppets directly (knock-back, grapple yank). On a client that is only local, so the
// change it made during its update is measured and sent to the host as an enemy command. ----
const pb = { n: 0, u: [], v: new Float32Array(6 * 96), sendT: new Map() };
export function pushBefore() {
  const L = G.enemy && G.enemy.list; pb.n = 0; if (!L) return;
  const n = Math.min(96, L.length);
  for (let i = 0; i < n; i++) { const e = L[i].ent, o = i * 6; pb.u[i] = e; pb.v[o] = e.pos.x; pb.v[o + 1] = e.pos.y; pb.v[o + 2] = e.pos.z; pb.v[o + 3] = e.vel.x; pb.v[o + 4] = e.vel.y; pb.v[o + 5] = e.vel.z; }
  pb.n = n;
}
export function pushAfter() {
  for (let i = 0; i < pb.n; i++) {
    const e = pb.u[i], o = i * 6; pb.u[i] = null;
    if (!e || !e.remote || !e.alive || typeof e.netId !== 'number') continue;
    const dvx = e.vel.x - pb.v[o + 3], dvy = e.vel.y - pb.v[o + 4], dvz = e.vel.z - pb.v[o + 5];
    if (dvx * dvx + dvy * dvy + dvz * dvz > 0.25) { N.enemyCmd(e.netId, 'impulse', { vx: +dvx.toFixed(2), vy: +dvy.toFixed(2), vz: +dvz.toFixed(2) }); N.stats.pushesOut++; }
    const dx = e.pos.x - pb.v[o], dy = e.pos.y - pb.v[o + 1], dz = e.pos.z - pb.v[o + 2];
    if (dx * dx + dy * dy + dz * dz > 1e-4) {                    // dragged: at most 15 positions a second per unit
      const t = pb.sendT.get(e.netId) || -9;
      if (N.time - t >= 0.066) { pb.sendT.set(e.netId, N.time); N.enemyCmd(e.netId, 'pull', { x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2), held: !!e.held }); N.stats.pushesOut++; }
    }
  }
  pb.n = 0;
}
// host: apply a client's command. ENEMY's command() first; FALLBACK for pushes it does not know: write the entity directly.
const heldBy = new Map();                 // host entity -> net time its remote grapple hold expires
export function hostCmd(id, cmd, arg, by) {
  const E = G.enemy; if (!E) return;
  if (E.command && safe(() => E.command(id, cmd, arg, by)) === true) return;
  if (cmd !== 'impulse' && cmd !== 'pull') return;
  const u = E.byNetId ? safe(() => E.byNetId(id)) : null, e = u && u.ent; if (!e || !e.alive || !arg) return;
  N.stats.pushesIn++;
  if (cmd === 'impulse') {
    if (e.held) return;
    const vx = clamp(+arg.vx || 0, -40, 40), vy = clamp(+arg.vy || 0, -20, 20), vz = clamp(+arg.vz || 0, -40, 40);
    e.vel.x += vx; e.vel.y += vy; e.vel.z += vz;
  } else {
    const x = +arg.x, y = +arg.y, z = +arg.z; if (!(x === x && y === y && z === z)) return;
    const dx = x - e.pos.x, dy = y - e.pos.y, dz = z - e.pos.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > 30 * 30) return;                                  // not a plausible drag
    if (arg.held) { e.held = true; heldBy.set(e, N.time + 0.4); e.pos.set(x, y, z); e.vel.set(0, 0, 0); }
    else if (!e.held && !G.grid.boxSolid(x - e.radius * 0.8, y + 0.6, z - e.radius * 0.8, x + e.radius * 0.8, y + Math.min(e.height, 10), z + e.radius * 0.8)) { e.pos.x = x; e.pos.z = z; }
  }
}
export function hostHolds() { if (!heldBy.size) return; for (const [e, t] of heldBy) if (N.time > t || !e.alive) { heldBy.delete(e); e.held = false; } }
