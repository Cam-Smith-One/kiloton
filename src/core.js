// ============================================================================
// KILOTON — core.js   OWNER: lead. Other modules must not edit this file.
// Namespace G, constants, event bus, math/RNG helpers, input, entity registry.
// ============================================================================
import * as THREE from 'three';

export const VS = 0.5;                 // voxel size (m)
export const NX = 384, NY = 96, NZ = 384;   // grid dims (voxels)  -> 192 x 48 x 192 m
export const WX = NX * VS, WY = NY * VS, WZ = NZ * VS;
export const CS = 32;                  // chunk size (voxels)
export const CX = NX / CS, CY = NY / CS, CZ = NZ / CS;
export const GROUND_J = 4;             // voxels j < GROUND_J are ground (j=0 bedrock)
export const GROUND_Y = GROUND_J * VS; // street surface height (2.0 m)

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

export const G = {
  THREE, VS, NX, NY, NZ, WX, WY, WZ, CS, CX, CY, CZ, GROUND_J, GROUND_Y,
  params,
  debug: params.has('debug'),
  renderer: null, scene: null, camera: null, canvas: null, uiRoot: null,
  time: 0, dt: 0, frame: 0, timeScale: 1,
  quality: { tier: 'high', shadowRes: 2048, post: true, debrisMax: 3500, particlesMax: 12000, pixelRatio: 1 },
  modules: [],
  // --- shared game state. Writers are named in CONTRACT.md -----------------
  state: {
    mode: 'survival',          // 'survival' | 'operation'   (writer: UI on the title screen; read by ENEMY and MISSION)
    phase: 'title',            // 'title' | 'playing' | 'paused' | 'over'      (writer: main)
    seed: (parseInt(params.get('seed')) || 1337) >>> 0,
    settings: { sens: 1, volume: 0.8, music: 0.6, invertY: false, quality: 'auto', shake: 1 },
    player: {                  // writer: PLAYER
      mode: 'pilot',           // 'pilot' | 'mech' | 'dead'
      ent: null,               // entity currently controlled
      pilot: null, mech: null, // entities (mech may exist while player is on foot)
      meter: 0, mechReady: false, mechIncoming: 0,   // 0..1 charge, drop available, seconds until landing (0 = none)
      yaw: 0, pitch: 0,
      weapons: [],             // weapon states of the CURRENT mode, in HUD order (from G.combat.createWeapon)
      activeWeapon: 0,
      lock: { target: null, progress: 0, locked: false },
      jet: 1,                  // jump-jet / jetpack fuel 0..1
      canEnter: false, canEject: false, grab: null, prompt: '',
      aim: new THREE.Vector3(), // world point under the crosshair
      hitMarker: 0, kills: 0, score: 0, combo: 0,
    },
    wave: { n: 0, alive: 0, total: 0, intermission: 0, enemyMechs: 0, bestWave: 0 },   // writer: ENEMY
    bay: { open: false, editing: 0, preview: null },   // Rig Bay overlay (writer: UI). preview = loadout being edited
    stats: { voxelsDestroyed: 0, buildingsLevelled: 0, timeAlive: 0, mechsCalled: 0 },
  },
};

// ---- event bus -------------------------------------------------------------
const handlers = new Map();
export const bus = {
  on(type, fn) { let a = handlers.get(type); if (!a) handlers.set(type, a = []); a.push(fn); return fn; },
  off(type, fn) { const a = handlers.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
  emit(type, data) {
    const a = handlers.get(type); if (!a) return;
    for (let i = 0; i < a.length; i++) { try { a[i](data); } catch (e) { console.error('bus handler for', type, e); } }
  },
};
G.bus = bus;

// ---- scalar helpers --------------------------------------------------------
export const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
export const sat = x => x < 0 ? 0 : x > 1 ? 1 : x;
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));   // frame-rate independent
export const wrapPi = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
export const dampAngle = (a, b, lambda, dt) => a + wrapPi(b - a) * (1 - Math.exp(-lambda * dt));

// ---- deterministic RNG + hash noise ---------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());     // inclusive
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  return f;
}
export function hash3(i, j, k) {       // -> [0,1)
  let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(k, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
G.rand = mulberry32(G.state.seed ^ 0x9e3779b9);   // gameplay RNG (non-deterministic use is fine)

// ---- input -----------------------------------------------------------------
// Keys use KeyboardEvent.code ('KeyW', 'Space', 'ShiftLeft', 'Digit1' ...). Mouse buttons 0/1/2.
export const input = {
  keys: new Set(), _pressed: new Set(), _released: new Set(),
  buttons: [false, false, false], _bPressed: [false, false, false], _bReleased: [false, false, false],
  mdx: 0, mdy: 0, wheel: 0, locked: false, enabled: true, _ax: 0, _ay: 0, _aw: 0,
  down(code) { return this.keys.has(code); },
  pressed(code) { return this._pressed.has(code); },       // went down this frame
  released(code) { return this._released.has(code); },
  button(b) { return this.buttons[b]; },
  buttonPressed(b) { return this._bPressed[b]; },
  buttonReleased(b) { return this._bReleased[b]; },
  consume(code) { for (let i = this._q.length - 1; i >= 0; i--) if (this._q[i][0] === 0 && this._q[i][1] === code) this._q.splice(i, 1); this._pressed.delete(code); },   // swallow a key press so no other module sees it
  axisX() { return (this.down('KeyD') || this.down('ArrowRight') ? 1 : 0) - (this.down('KeyA') || this.down('ArrowLeft') ? 1 : 0); },
  axisY() { return (this.down('KeyW') || this.down('ArrowUp') ? 1 : 0) - (this.down('KeyS') || this.down('ArrowDown') ? 1 : 0); },
  lock() { try { const p = G.canvas.requestPointerLock && G.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) {} },
  unlock() { try { document.exitPointerLock && document.exitPointerLock(); } catch (e) {} },
  _q: [],
  init(canvas) {
    const q = this._q;
    addEventListener('keydown', e => { if (e.repeat) return; q.push([0, e.code]); if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); bus.emit('key', e.code); });
    addEventListener('keyup', e => q.push([1, e.code]));
    addEventListener('blur', () => { q.push([4]); });
    canvas.addEventListener('mousedown', e => { q.push([2, e.button]); e.preventDefault(); });
    addEventListener('mouseup', e => q.push([3, e.button]));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('mousemove', e => {
      // Works locked or not: with no pointer lock we still turn while the cursor moves over the page.
      if (this.locked || this.fallbackLook) { this._ax += e.movementX || 0; this._ay += e.movementY || 0; }
    });
    addEventListener('wheel', e => { this._aw += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; bus.emit('pointerlock', this.locked); });
    document.addEventListener('pointerlockerror', () => { this.fallbackLook = true; bus.emit('pointerlock', false); });
  },
  fallbackLook: false,     // set true when pointer lock is refused: mouse-move still steers the camera
  frame() {                // called once per frame by main BEFORE module updates
    this._pressed.clear(); this._released.clear();
    this._bPressed[0] = this._bPressed[1] = this._bPressed[2] = false;
    this._bReleased[0] = this._bReleased[1] = this._bReleased[2] = false;
    for (const ev of this._q) {
      if (ev[0] === 0) { if (!this.keys.has(ev[1])) this._pressed.add(ev[1]); this.keys.add(ev[1]); }
      else if (ev[0] === 1) { this.keys.delete(ev[1]); this._released.add(ev[1]); }
      else if (ev[0] === 2) { if (ev[1] < 3) { this.buttons[ev[1]] = true; this._bPressed[ev[1]] = true; } }
      else if (ev[0] === 3) { if (ev[1] < 3) { this.buttons[ev[1]] = false; this._bReleased[ev[1]] = true; } }
      else { this.keys.clear(); this.buttons[0] = this.buttons[1] = this.buttons[2] = false; }
    }
    this._q.length = 0;
    this.mdx = this._ax; this.mdy = this._ay; this.wheel = this._aw; this._ax = this._ay = this._aw = 0;
    if (!this.enabled) { this.mdx = this.mdy = this.wheel = 0; }
  },
};
G.input = input;

// ---- entity registry -------------------------------------------------------
// Entity (plain object, created by its owner module, registered with ents.add):
//   kind   'pilot' | 'mech' | 'soldier' | 'tank' | 'drone' | 'gunship' | 'emech' | 'turret' | 'prop'
//   team   0 = player side, 1 = enemy
//   pos    THREE.Vector3, FEET / bottom-centre in world metres;   vel THREE.Vector3
//   radius (m, horizontal half extent), height (m)
//   hp, maxHp, alive (bool), airborne (true for aircraft), isPlayer (bool), armor (0..1 damage reduction, optional)
//   onDamage(amount, info) optional -> may return a modified amount;  onDeath(info) optional
// info: { type:'bullet'|'pulse'|'rocket'|'explosion'|'melee'|'debris'|'crush'|'fall'|'slam', src:entity|null, x,y,z, dx,dy,dz }
let nextId = 1;
const _pl = [];
const _hit = { ent: null, dist: 0, x: 0, y: 0, z: 0 };
export const ents = {
  list: [],
  add(e) {
    e.id = nextId++; e.alive = true; if (e.maxHp == null) e.maxHp = e.hp;
    if (!e.vel) e.vel = new THREE.Vector3();
    this.list.push(e); bus.emit('ent:add', e); return e;
  },
  remove(e) { const i = this.list.indexOf(e); if (i >= 0) { this.list.splice(i, 1); bus.emit('ent:remove', e); } },
  clear() { this.list.length = 0; },
  damage(e, amount, info) {
    if (!e || !e.alive || amount <= 0) return 0;
    info = info || {};
    if (e.invuln) return 0;
    // Multiplayer: entities simulated by another peer are never damaged here; the hit is claimed with their owner.
    if (e.remote && G.net && G.net.online && !info.fromNet) { if (G.net.claimHit) G.net.claimHit(e, amount, info); return 0; }
    if (e.armor) amount *= (1 - e.armor);
    if (e.onDamage) { const r = e.onDamage(amount, info); if (typeof r === 'number') amount = r; }
    if (amount <= 0) return 0;
    e.hp -= amount; e.lastHitT = G.time;
    bus.emit('ent:damage', { ent: e, amount, info });
    if (e.hp <= 0) {
      e.hp = 0; e.alive = false;
      bus.emit('ent:death', { ent: e, info });          // listeners: PLAYER (meter/score), ENEMY (wave count), FX, AUDIO, UI
      if (e.onDeath) e.onDeath(info);
    }
    return amount;
  },
  // Damage everything whose body is within r of the point, with linear falloff to 25 % at the edge.
  radiusDamage(x, y, z, r, dmg, info, exceptTeam) {
    const L = this.list;
    for (let n = L.length - 1; n >= 0; n--) {
      const e = L[n]; if (!e.alive || (exceptTeam != null && e.team === exceptTeam)) continue;
      const cy = clamp(y, e.pos.y, e.pos.y + e.height);
      const dx = e.pos.x - x, dy = cy - y, dz = e.pos.z - z;
      const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - e.radius);
      if (d < r) {
        const i2 = Object.assign({ type: 'explosion', x, y, z, dx, dy: dy + 0.5, dz }, info);
        // walls still standing after the blast shield what is behind them
        const cover = G.grid && d > 0.5 && !G.grid.los(x, y, z, e.pos.x, e.pos.y + e.height * 0.6, e.pos.z) ? 0.3 : 1;
        this.damage(e, dmg * (1 - 0.75 * d / r) * cover, i2);
      }
    }
  },
  // Nearest entity hit by a ray (bodies are upright boxes radius x height). Returns a SHARED result object or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist, ignore, ignoreTeam) {
    let best = maxDist, hit = null;
    const L = this.list;
    for (let n = 0; n < L.length; n++) {
      const e = L[n]; if (!e.alive || e === ignore || e.noHit || (ignoreTeam != null && e.team === ignoreTeam)) continue;
      const r = e.radius, p = e.pos;
      let t0 = 0, t1 = best;
      // slabs
      let lo = p.x - r - ox, hi = p.x + r - ox;
      if (Math.abs(dx) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { let a = lo / dx, b = hi / dx; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      lo = p.y - oy; hi = p.y + e.height - oy;
      if (Math.abs(dy) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { let a = lo / dy, b = hi / dy; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      lo = p.z - r - oz; hi = p.z + r - oz;
      if (Math.abs(dz) < 1e-9) { if (lo > 0 || hi < 0) continue; } else { let a = lo / dz, b = hi / dz; if (a > b) { const s = a; a = b; b = s; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) continue; }
      best = t0; hit = e;
    }
    if (!hit) return null;
    _hit.ent = hit; _hit.dist = best; _hit.x = ox + dx * best; _hit.y = oy + dy * best; _hit.z = oz + dz * best;
    return _hit;
  },
  // Every player's currently controlled entity (the local one offline). AI targets these.
  players() { if (G.net && G.net.online && G.net.players) return G.net.players(); const e = G.state.player.ent; _pl.length = 0; if (e && e.alive) _pl.push(e); return _pl; },
  forEachInRadius(x, y, z, r, fn) {
    const L = this.list;
    for (let n = L.length - 1; n >= 0; n--) {
      const e = L[n]; if (!e.alive) continue;
      const dx = e.pos.x - x, dy = e.pos.y + e.height * 0.5 - y, dz = e.pos.z - z;
      const rr = r + e.radius; if (dx * dx + dy * dy + dz * dz < rr * rr) fn(e);
    }
  },
};
G.ents = ents;

// One call for "something blew up here": carves the world, hurts entities, tells FX / AUDIO / camera.
//   o = { radius (m), power (0..255 vs material strength), damage (hp at centre), owner (entity|null), kind ('rocket'|'shell'|'pulse'|'mech'|'slam'|'grenade'), dmgRadius? }
// Network relay for multiplayer (see CONTRACT-D.md). Override with ?relay=wss://host/ws
G.RELAY_URL = params.get('relay') || 'wss://kiloton-server.fly.dev/ws';
G.WEB_URL = 'https://kiloton.assembll.xyz';
G.boom = function (x, y, z, o) {
  const radius = o.radius || 3, power = o.power == null ? 120 : o.power;
  G.destruct.explode(x, y, z, radius, power, o);
  if (o.damage) ents.radiusDamage(x, y, z, o.dmgRadius || radius * 1.6, o.damage, { type: 'explosion', src: o.owner || null }, o.friendlyFire === false && o.owner ? o.owner.team : null);
  bus.emit('explosion', { x, y, z, radius, power, kind: o.kind || 'rocket', owner: o.owner || null });
};

export { THREE };
