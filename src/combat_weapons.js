// ============================================================================
// KILOTON — combat_weapons.js   OWNER: COMBAT
// The WEAPONS table (every number that defines a gun) and the per-wielder
// weapon state machine returned by G.combat.createWeapon(id).
// ============================================================================
import { THREE, bus, mulberry32 } from './core.js';

// Entity hp this table was balanced against (owned by PLAYER / ENEMY; an assumption, see notes/combat.md).
export const HP_ASSUMED = { soldier: 40, drone: 60, tank: 600, gunship: 500, emech: 1500, heavy: 2600, pilot: 100, mech: 1800 };

// Armour class by entity kind. A weapon's `pen[class]` multiplies its DIRECT damage against that class
// (missing = 1). Blast damage is never reduced here. An entity may override with `ent.armorClass`.
export const ARMOR_CLASS = { mech: 'heavy', emech: 'heavy', tank: 'heavy', gunship: 'medium' };

// ---------------------------------------------------------------------------
// Field reference (units: metres, seconds, radians, hp)
//   name / label / key  HUD strings (label is the short card caption, key the default binding shown on the card)
//   kind                'auto' | 'semi' | 'heat' | 'charge' | 'lock'     (how the trigger / ammo works)
//   proj                'bullet' | 'pulse' | 'rocket' | 'missile' | 'shell' | 'grenade'
//   rate                shots per second while the trigger is held
//   damage              direct-hit hp (before `pen`);   pen {heavy, medium}  direct multipliers by armour class
//   speed/accel/maxSpeed  muzzle speed, thrust, top speed;   gravity (m/s^2, shells + grenades)
//   spread              cone half-angle;  bloom/bloomMax/bloomRecover: extra spread per shot, cap, recovery per second
//   clip/reload         magazine size and reload time                     (auto / semi)
//   heatPerShot/coolRate/coolDelay/overheatCool   heat model              (heat)   heat is 0..1
//   recharge            seconds for charge 0 -> 1;  shots: how many launches a full charge holds (lock)
//   burst/burstGap      rockets per trigger pull, ripple interval
//   blast {radius, power, damage, dmgRadius, kind, bury}   explosion on impact (G.boom); bury = metres into the surface
//   world {power, radius}   chip for non-explosive hits (G.destruct.impact)
//   splash {radius, damage} small entity-only splash for pulse bolts
//   range / life        bullets die at range; everything dies at life (explosives detonate)
//   turnRate/navGain/prox/boost   homing: max turn (rad/s), PN gain, proximity fuse (m), unguided launch time
//   fuse/bounce         grenade timer and restitution
//   lockTime/lockRange/lockCone/maxLocks   lock-on parameters for the wielder + HUD (COMBAT does not run the lock)
//   tell                suggested wind-up the AI shows before firing (COMBAT does not delay the shot)
//   pad                 projectile "fatness" for entity hits (m);   wobble: rocket heading wobble (rad)
//   barrels             2 = alternate L / R muzzles (w.side is the NEXT barrel)
//   rateMin/spinUp/spinDown   spin-up guns: rate ramps rateMin -> rate over spinUp seconds of held fire (w.spin 0..1)
//   beam                continuous beam: `rate` is damage ticks per second, `damage` hp per tick, one voxel cut per tick
//   lob/lobScatter      fired in a high arc onto opts.aim (metres of scatter between the shells of a burst)
//   cluster {id,count,alt,spread}   shell splits into `count` projectiles of weapon `id` when `alt` metres above what is below it
//   windup              seconds between fire() and the shot leaving; 'weapon:tell' {weapon, shooter, time} is emitted at fire()
//   volley / autoTarget lock weapons: one pull launches every missile available / targets G.state.player.ent when none is given
//   recoil              0..1: emits 'weapon:recoil' (+ 'shake') on fire
//   lockGround/lockAir  what a lock weapon may lock (the wielder runs the lock);   hidden: not a wieldable weapon
// ---------------------------------------------------------------------------
export const WEAPONS = {
  // ---- player, on foot ------------------------------------------------------
  rifle: {
    name: 'VK-9 Rifle', label: 'RIFLE', key: 'LMB', kind: 'auto', proj: 'bullet', faction: 0,
    rate: 10, damage: 11, pen: { heavy: 0.25, medium: 0.5 }, speed: 320, spread: 0.005, bloom: 0.0035, bloomMax: 0.03, bloomRecover: 0.07,
    clip: 30, reload: 1.7, world: { power: 36, radius: 0.3 }, range: 220, life: 1.2,
  },
  launcher: {
    name: 'Lancet Launcher', label: 'LAUNCHER', key: 'RMB', kind: 'semi', proj: 'rocket', faction: 0,
    rate: 1, damage: 145, speed: 38, accel: 70, maxSpeed: 95, spread: 0.004, wobble: 0.006, pad: 0.15,
    clip: 1, reload: 2.4, blast: { radius: 3.0, power: 140, damage: 110, dmgRadius: 4.0, kind: 'rocket', bury: 0.3 }, range: 320, life: 6,
  },
  grenade: {
    name: 'Frag Charge', label: 'GRENADE', key: 'G', kind: 'charge', proj: 'grenade', faction: 0,
    rate: 1, damage: 0, speed: 22, gravity: 14, spread: 0.01, fuse: 2.0, bounce: 0.4, pad: 0.1,
    recharge: 6, burst: 1, blast: { radius: 3.5, power: 130, damage: 130, dmgRadius: 5.0, kind: 'grenade', bury: 0 }, range: 80, life: 4,
  },
  seeker: {
    name: 'Seeker AA', label: 'SEEKER', kind: 'lock', proj: 'missile', faction: 0,
    rate: 2.5, damage: 160, pen: { heavy: 0.4 }, speed: 32, accel: 100, maxSpeed: 105, spread: 0.04, pad: 0.3,
    recharge: 6, shots: 2, burstGap: 0.14, turnRate: 7.0, navGain: 4, prox: 3.0, boost: 0.06,
    lockTime: 0.6, lockRange: 180, lockCone: 0.3, maxLocks: 2, lockGround: false, lockAir: true,
    blast: { radius: 1.8, power: 80, damage: 30, dmgRadius: 3.0, kind: 'rocket', bury: 0 }, range: 320, life: 6,
  },
  // ---- player, Warden rig ----------------------------------------------------
  pulse: {
    name: 'Twin Pulse Cannons', label: 'PULSE', kind: 'heat', proj: 'pulse', faction: 0, key: 'LMB', barrels: 2,
    rate: 8, damage: 26, speed: 170, spread: 0.007, pad: 0.25,
    heatPerShot: 0.04, coolRate: 0.45, coolDelay: 0.35, overheatCool: 0.4,
    world: { power: 130, radius: 1.2 }, splash: { radius: 1.6, damage: 12 }, range: 260, life: 1.8,
  },
  salvo: {
    name: 'Hailstorm Salvo', label: 'SALVO', kind: 'charge', proj: 'rocket', faction: 0, key: 'RMB',
    rate: 1, damage: 60, speed: 32, accel: 80, maxSpeed: 90, spread: 0.035, wobble: 0.02, pad: 0.2,
    recharge: 8, burst: 6, burstGap: 0.085, blast: { radius: 3.2, power: 150, damage: 70, dmgRadius: 4.5, kind: 'rocket', bury: 0.3 }, range: 320, life: 6,
  },
  skylance: {
    name: 'Skylance AA', label: 'SKYLANCE', key: 'Q', kind: 'lock', proj: 'missile', faction: 0,
    rate: 2.5, damage: 250, pen: { heavy: 0.4 }, speed: 36, accel: 120, maxSpeed: 120, spread: 0.06, pad: 0.3,
    recharge: 10, shots: 4, burstGap: 0.12, turnRate: 7.5, navGain: 4, prox: 3.2, boost: 0.06,
    lockTime: 0.7, lockRange: 220, lockCone: 0.35, maxLocks: 4, lockGround: false, lockAir: true,
    blast: { radius: 2.5, power: 100, damage: 50, dmgRadius: 4.0, kind: 'rocket', bury: 0 }, range: 400, life: 7,
  },
  // ---- Rig Bay modules (phase B) ------------------------------------------------
  autocannon: {
    name: 'Rotary Autocannon', label: 'AUTOCANNON', kind: 'auto', proj: 'bullet', faction: 0,
    rate: 16, rateMin: 4, spinUp: 0.6, spinDown: 0.9,           // rate ramps rateMin -> rate while the trigger is held
    damage: 9, pen: { heavy: 0.2, medium: 0.6 }, speed: 300, spread: 0.012, bloom: 0.001, bloomMax: 0.012, bloomRecover: 0.05,
    clip: 120, reload: 2.6, world: { power: 54, radius: 0.3 }, range: 240, life: 1.2,
  },
  lance: {
    name: 'Arc Lance', label: 'LANCE', kind: 'heat', proj: 'beam', beam: true, faction: 0,
    rate: 10, damage: 22, speed: 0, spread: 0, pad: 0.15,       // 10 ticks/s: 220 dps, one voxel cut per tick
    heatPerShot: 0.036, coolRate: 0.5, coolDelay: 0.4, overheatCool: 0.4,
    world: { power: 150, radius: 0.3, fire: true }, range: 90, life: 0,
  },
  siege: {
    name: 'Siege Cannon', label: 'SIEGE', kind: 'charge', proj: 'shell', faction: 0, recoil: 1,
    rate: 1, damage: 180, speed: 140, gravity: 4, spread: 0.003, pad: 0.3, size: 1.7,
    recharge: 4, burst: 1, blast: { radius: 6.5, power: 250, damage: 520, dmgRadius: 9, kind: 'shell', bury: 0.8, ignite: 3.5 }, range: 400, life: 6,
  },
  swarm: {
    name: 'Swarm Rack', label: 'SWARM', kind: 'lock', proj: 'missile', faction: 0, size: 0.6,
    rate: 3, damage: 60, speed: 50, accel: 140, maxSpeed: 130, spread: 0.12, pad: 0.2,
    recharge: 9, shots: 6, burstGap: 0.07, turnRate: 4.5, navGain: 4, prox: 1.2, boost: 0.18,
    lockTime: 0.3, lockRange: 160, lockCone: 0.4, maxLocks: 6, lockGround: true, lockAir: true,
    blast: { radius: 1.5, power: 70, damage: 20, dmgRadius: 2.5, kind: 'rocket', bury: 0 }, range: 320, life: 6,
  },
  mortar: {
    name: 'Thunder Mortar', label: 'MORTAR', kind: 'charge', proj: 'shell', faction: 0, lob: true, lobScatter: 2.5, recoil: 0.5,
    rate: 1, damage: 40, speed: 38, gravity: 14, spread: 0.01, pad: 0.2, size: 1.1,
    recharge: 7, burst: 3, burstGap: 0.28, cluster: { id: 'mortar_b', count: 5, alt: 9, spread: 5 },
    blast: { radius: 3.0, power: 130, damage: 90, dmgRadius: 4.5, kind: 'shell', bury: 0.2, ignite: 2 }, range: 100, life: 12,
  },
  mortar_b: {                                                       // bomblet a mortar shell splits into (not a wieldable weapon)
    name: 'Bomblet', label: 'BOMBLET', kind: 'semi', proj: 'shell', faction: 0, hidden: true, size: 0.5,
    rate: 1, damage: 20, speed: 30, gravity: 14, spread: 0, pad: 0.15,
    clip: 1, reload: 1, blast: { radius: 2.4, power: 120, damage: 40, dmgRadius: 3.6, kind: 'grenade', bury: 0.1, ignite: 1.6 }, range: 100, life: 6,
  },
  // ---- Vanta -----------------------------------------------------------------
  e_rifle: {
    name: 'Vanta Carbine', label: 'CARBINE', kind: 'auto', proj: 'bullet', faction: 1,
    rate: 5, damage: 5, pen: { heavy: 0.3, medium: 0.5 }, speed: 95, spread: 0.03,
    clip: 10, reload: 2.2, world: { power: 28, radius: 0.3 }, range: 120, life: 1.6,
  },
  e_rpg: {
    name: 'Vanta RPG', label: 'RPG', kind: 'semi', proj: 'rocket', faction: 1, tell: 0.7,
    rate: 1, damage: 90, speed: 24, accel: 30, maxSpeed: 46, spread: 0.015, wobble: 0.012, pad: 0.15,
    clip: 1, reload: 4.5, blast: { radius: 2.6, power: 125, damage: 80, dmgRadius: 3.6, kind: 'rocket', bury: 0.25 }, range: 200, life: 7,
  },
  e_shell: {
    name: 'Tank Gun', label: 'SHELL', kind: 'semi', proj: 'shell', faction: 1, tell: 1.1,
    rate: 1, damage: 150, speed: 42, gravity: 12, spread: 0.012, pad: 0.2,
    clip: 1, reload: 5, blast: { radius: 4.0, power: 165, damage: 140, dmgRadius: 6.0, kind: 'shell', bury: 0.5 }, range: 260, life: 9,
  },
  e_drone: {
    name: 'Drone Stinger', label: 'STINGER', kind: 'auto', proj: 'pulse', faction: 1,
    rate: 3, damage: 4, pen: { heavy: 0.5 }, speed: 60, spread: 0.03, pad: 0.1, size: 0.55,
    clip: 6, reload: 1.6, world: { power: 30, radius: 0.3 }, range: 110, life: 2.2,
  },
  e_chain: {
    name: 'Gunship Chaingun', label: 'CHAINGUN', kind: 'auto', proj: 'bullet', faction: 1, tell: 0.5,
    rate: 12, damage: 6, pen: { heavy: 0.6 }, speed: 120, spread: 0.035,
    clip: 36, reload: 3.5, world: { power: 62, radius: 0.35 }, range: 180, life: 1.8,
  },
  e_gsrocket: {
    name: 'Gunship Rockets', label: 'ROCKETS', kind: 'semi', proj: 'rocket', faction: 1, tell: 0.6,
    rate: 2.5, damage: 45, speed: 30, accel: 40, maxSpeed: 60, spread: 0.03, wobble: 0.015, pad: 0.15,
    turnRate: 0.7, navGain: 3, boost: 0.3,                       // only homes when fired with a target
    clip: 4, reload: 6, blast: { radius: 2.8, power: 135, damage: 60, dmgRadius: 4.0, kind: 'rocket', bury: 0.25 }, range: 240, life: 7,
  },
  e_pulse: {
    name: 'Vanta Pulse Cannons', label: 'PULSE', kind: 'heat', proj: 'pulse', faction: 1, barrels: 2,
    rate: 4, damage: 20, speed: 80, spread: 0.02, pad: 0.25,
    heatPerShot: 0.07, coolRate: 0.4, coolDelay: 0.5, overheatCool: 0.35,
    world: { power: 115, radius: 1.0 }, splash: { radius: 1.4, damage: 8 }, range: 220, life: 3,
  },
  e_salvo: {
    name: 'Vanta Salvo', label: 'SALVO', kind: 'charge', proj: 'rocket', faction: 1, tell: 1.0,
    rate: 1, damage: 50, speed: 26, accel: 35, maxSpeed: 55, spread: 0.05, wobble: 0.02, pad: 0.2,
    recharge: 10, burst: 4, burstGap: 0.14, blast: { radius: 3.0, power: 145, damage: 60, dmgRadius: 4.2, kind: 'rocket', bury: 0.3 }, range: 260, life: 8,
  },
  // ---- Vanta, phase C: emplacements and the dreadnought ---------------------------
  e_turret: {
    name: 'Emplacement Gun', label: 'TURRET', kind: 'auto', proj: 'bullet', faction: 1, tell: 0.5,
    rate: 9, damage: 6, pen: { heavy: 0.5 }, speed: 110, spread: 0.03,
    clip: 8, reload: 1.6, world: { power: 50, radius: 0.3 }, range: 170, life: 1.8,       // 8-round bursts, 1.6 s between them
  },
  e_siege: {
    name: 'Dreadnought Siege Gun', label: 'SIEGE', kind: 'charge', proj: 'shell', faction: 1, windup: 2.2, tell: 2.2, recoil: 1,
    rate: 1, damage: 200, speed: 34, gravity: 6, spread: 0.01, pad: 0.4, size: 2.2,
    recharge: 9, burst: 1, blast: { radius: 7, power: 230, damage: 360, dmgRadius: 9, kind: 'shell', bury: 0.8 }, range: 300, life: 10,
  },
  e_swarm: {
    name: 'Dreadnought Swarm', label: 'SWARM', kind: 'lock', proj: 'missile', faction: 1, tell: 0.8, size: 0.6, volley: true, autoTarget: true,
    rate: 1, damage: 22, speed: 28, accel: 40, maxSpeed: 58, spread: 0.25, pad: 0.2,
    recharge: 12, shots: 8, burstGap: 0.11, turnRate: 2.6, navGain: 3, prox: 1.0, boost: 0.35,
    lockTime: 0, lockRange: 200, maxLocks: 1, lockGround: true, lockAir: true,
    blast: { radius: 1.5, power: 70, damage: 14, dmgRadius: 2.5, kind: 'rocket', bury: 0 }, range: 300, life: 8,
  },
};
for (const id in WEAPONS) WEAPONS[id].id = id;

export function penFor(def, ent) {
  if (!def.pen || !ent) return 1;
  const c = ent.armorClass || ARMOR_CLASS[ent.kind];
  const m = c ? def.pen[c] : null;
  return m == null ? 1 : m;
}

// ---- time-to-kill, analytic (trigger held, every shot a direct hit, blast at the target's feet included) ----
// Returns seconds from the first shot leaving the barrel to the killing shot leaving it (flight time excluded),
// or Infinity when the weapon cannot do it in 60 s.
// hp one projectile deals on a direct hit (cluster shells: every bomblet landing on the target)
function perShot(d, ent) {
  if (d.cluster) { const b = WEAPONS[d.cluster.id]; return d.cluster.count * perShot(b, ent); }
  return d.damage * penFor(d, ent) + (d.blast ? d.blast.damage : 0);
}
export function ttk(id, kind, hp) {
  const d = WEAPONS[id]; if (!d) return Infinity;
  if (hp == null) hp = HP_ASSUMED[kind];
  const ent = { kind: kind === 'heavy' ? 'emech' : kind };
  const per = perShot(d, ent);
  if (per <= 0) return Infinity;
  const w = makeWeapon(id, d, null);
  let t = 0, dealt = 0; const dt = 1 / 240;
  for (let n = 0; n < 240 * 60; n++) {
    if (w.canFire()) {
      const k = w._consume(1);
      dealt += per * k;
      if (dealt >= hp - 1e-6) return t + (k - 1) * (d.burstGap || 0) * Math.min(1, (hp - (dealt - per * k)) / (per * k));
    }
    w.update(dt); t += dt;
  }
  return Infinity;
}
export function shotsToKill(id, kind, hp) {
  const d = WEAPONS[id]; if (hp == null) hp = HP_ASSUMED[kind];
  const per = perShot(d, { kind: kind === 'heavy' ? 'emech' : kind });
  return per > 0 ? Math.ceil(hp / per - 1e-9) : Infinity;
}

// ---- the state machine --------------------------------------------------------
const _o2 = new THREE.Vector3(), _w2 = new THREE.Vector3();
const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _u = new THREE.Vector3(), _w = new THREE.Vector3();
const rng = mulberry32(0xC0FFEE);
// Random direction inside a cone of half-angle `ang` around unit vector d (uniform over the disc). Writes `out`.
export function spreadDir(out, d, ang) {
  if (!(ang > 0)) return out.copy(d);
  if (Math.abs(d.y) < 0.99) _u.set(d.z, 0, -d.x).normalize(); else _u.set(1, 0, 0);
  _w.crossVectors(d, _u);
  const r = Math.tan(ang) * Math.sqrt(rng()), a = rng() * 6.2831853;
  return out.copy(d).addScaledVector(_u, Math.cos(a) * r).addScaledVector(_w, Math.sin(a) * r).normalize();
}


// C = the combat module (needs C._launch(def, shooter, ox,oy,oz, dx,dy,dz, target, opts)); null for dry simulation (ttk).
export function makeWeapon(id, def, C) {
  const clipMax = def.clip || 0;
  const emit = C ? (type, shooter, time) => bus.emit(type, time == null ? { weapon: id, shooter } : { weapon: id, shooter, time }) : () => {};
  const w = {
    id, def, name: def.name, label: def.label, kind: def.kind, proj: def.proj,
    clip: clipMax || Infinity, clipMax: clipMax || Infinity,
    reloading: 0,            // 0 = not reloading, else progress 0..1
    heat: 0, overheated: false,
    charge: 1,               // recharge progress 0..1
    shots: def.kind === 'lock' ? def.shots : def.kind === 'charge' ? 1 : 0,   // launches available now (lock / charge)
    shotsMax: def.kind === 'lock' ? def.shots : def.kind === 'charge' ? 1 : 0,
    cd: 0, ready: true,
    side: 'L', lastSide: 'L', // next barrel / barrel that fired last
    bloom: 0,                // current extra spread (rad) from sustained fire
    spreadNow: def.spread || 0,   // total cone the next shot uses (HUD crosshair bloom)
    burstLeft: 0,            // rockets still to leave the pod in the current ripple
    windup: 0, _wind: 0, _wopts: null,   // windup: 0, else 0..1 progress of the tell before the shot leaves
    spin: 0,                 // 0..1 barrel spin (spin-up guns);  rateNow: current shots per second
    rateNow: def.rateMin || def.rate, slot: null, lockGround: !!def.lockGround, lockAir: def.lockAir !== false && def.kind === 'lock',
    _aim: new THREE.Vector3(), _lob: false,
    lastFire: -1e9,          // seconds since last shot is `sinceFire`
    sinceFire: 1e9,
    maxLocks: def.maxLocks || 0, lockTime: def.lockTime || 0, lockRange: def.lockRange || 0,
    _cd: 0, _rt: 0, _auto: 0, _bt: 0, _emptyT: 0,
    _shooter: null, _off: new THREE.Vector3(), _dir: new THREE.Vector3(), _targets: [], _ti: 0, _spread: 0, _hasAim: false,

    canFire() {
      if (this._cd > 1e-6 || this.reloading || this.burstLeft || this._wind > 0) return false;
      switch (def.kind) {
        case 'heat': return !this.overheated;
        case 'charge': return this.charge >= 1;
        case 'lock': return this.charge * def.shots >= 1 - 1e-6;
        default: return this.clip > 0;
      }
    },
    // Spend ammo / heat / charge for one trigger pull; returns how many projectiles leave. (No projectiles here.)
    _consume(nWanted) {
      let n = 1;
      const iv = 1 / (def.spinUp ? this.rateNow : def.rate);
      this._cd = (this._cd < -iv ? 0 : this._cd) + iv;
      this.sinceFire = 0;
      if (def.bloom) this.bloom = Math.min(def.bloomMax, this.bloom + def.bloom);
      switch (def.kind) {
        case 'heat':
          this.heat += def.heatPerShot;
          if (this.heat >= 1 - 1e-6) { this.heat = 1; this.overheated = true; emit('weapon:overheat', this._shooter); }
          break;
        case 'charge': this.charge = 0; this.shots = 0; n = def.burst || 1; break;
        case 'lock': {
          const avail = Math.floor(this.charge * def.shots + 1e-6);
          n = def.volley ? Math.max(1, avail) : Math.max(1, Math.min(nWanted || 1, avail));
          this.charge = Math.max(0, this.charge - n / def.shots); this.shots = avail - n;
          break;
        }
        default:
          this.clip--;
          if (this.clip <= 0) { this.clip = 0; this._auto = 0.18; emit('weapon:empty', this._shooter); }
      }
      return n;
    },
    // fire(shooter, origin, dir, opts?) -> bool.   opts { targets:[ent…], target, spread (extra cone, rad), side:'L'|'R' }
    fire(shooter, origin, dir, opts) {
      if (def.beam) {            // continuous beam: call every frame while held; damage lands on the tick
        if (this.overheated || this.reloading) return false;
        const tick = this.canFire();
        this._shooter = shooter || null; if (opts && opts.slot) this.slot = opts.slot;
        if (C) C._beam(this, def, this._shooter, origin, dir, tick, this.sinceFire > 0.3);
        if (!tick) return false;
        this._consume(1); this.ready = false;
        return true;
      }
      if (def.windup && !(opts && opts._release)) {       // heavy shot with a tell: commit now, the shell leaves later
        if (this._wind > 0) { this.setAim(origin, dir); return false; }
        if (!this.canFire()) return false;
        this._shooter = shooter || null; this._wind = def.windup; this.windup = 1e-4; this._wopts = opts || null;
        this._dir.copy(dir).normalize();
        if (shooter && shooter.pos) { this._off.copy(origin).sub(shooter.pos); this._hasAim = true; } else { this._off.copy(origin); this._hasAim = false; }
        emit('weapon:tell', this._shooter, def.windup);
        this.ready = false;
        return true;
      }
      if (!this.canFire()) {
        if (def.clip && this.clip <= 0 && !this.reloading && this._emptyT <= 0) { this._emptyT = 0.4; this.reload(shooter); }
        return false;
      }
      this._shooter = shooter || null;
      const tg = opts && opts.targets;
      const T = this._targets; T.length = 0;
      if (def.autoTarget && !tg && !(opts && opts.target) && C && C.playerEnt()) T.push(C.playerEnt());
      else if (tg) for (let i = 0; i < tg.length && i < 8; i++) T.push(tg[i]);
      else if (opts && opts.target) T.push(opts.target);
      const n = this._consume(T.length || 1);
      this._spread = (def.spread || 0) + this.bloom - (def.bloom || 0) + (opts && opts.spread ? opts.spread : 0);
      if (def.barrels === 2) { this.lastSide = opts && opts.side ? opts.side : this.side; this.side = this.lastSide === 'L' ? 'R' : 'L'; }
      this._dir.copy(dir).normalize();
      if (shooter && shooter.pos) { this._off.copy(origin).sub(shooter.pos); this._hasAim = true; } else { this._off.copy(origin); this._hasAim = false; }
      this._ti = 0;
      if (opts && opts.slot) this.slot = opts.slot;
      this._lob = !!(def.lob && opts && opts.aim); if (this._lob) this._aim.copy(opts.aim);
      if (def.recoil && C) C._recoil(def, this._shooter, origin, this._dir);
      this._one(origin);
      if (n > 1) { this.burstLeft = n - 1; this._bt = def.burstGap || 0.08; }
      this.ready = false;
      return true;
    },
    // Optional: keep a running ripple glued to a moving pod / changing aim.
    setAim(origin, dir) { if (this._shooter && this._shooter.pos) this._off.copy(origin).sub(this._shooter.pos); else this._off.copy(origin); this._dir.copy(dir).normalize(); },
    _one(origin) {
      if (!C) return;
      const T = this._targets, target = T.length ? T[this._ti % T.length] : null; this._ti++;
      C._slotNow = this.slot;
      if (this._lob) {         // high arc onto the aim point, each shell of the burst scattered a little
        const sc = def.lobScatter || 0, a = rng() * 6.2832, r = this._ti > 1 ? sc * Math.sqrt(rng()) : 0;
        _o2.set(this._aim.x + Math.cos(a) * r, this._aim.y, this._aim.z + Math.sin(a) * r);
        C.aimBallistic(id, origin, _o2, _d, true);
        if (_d.y > 0.999) _d.set(this._dir.x * 0.05, 1, this._dir.z * 0.05).normalize();
      } else spreadDir(_d, this._dir, this._spread);
      C._launch(def, this._shooter, origin.x, origin.y, origin.z, _d.x, _d.y, _d.z, target, null);
    },
    reload(shooter) {
      if (!def.clip || this.reloading || this.clip >= this.clipMax) return false;
      if (shooter) this._shooter = shooter;
      this.reloading = 1e-4; this._rt = 0; this._auto = 0;
      emit('weapon:reload', this._shooter);
      return true;
    },
    update(dt) {
      this._cd -= dt; if (this._cd < -dt) this._cd = -dt;
      this.cd = this._cd > 0 ? this._cd : 0;
      this.sinceFire += dt; if (this._emptyT > 0) this._emptyT -= dt;
      if (this.bloom > 0) { this.bloom -= def.bloomRecover * dt * (this.sinceFire > 0.15 ? 3 : 1); if (this.bloom < 0) this.bloom = 0; }
      this.spreadNow = (def.spread || 0) + this.bloom;
      if (def.spinUp) {
        if (this.sinceFire < 1.5 / this.rateNow && !this.reloading) { this.spin += dt / def.spinUp; if (this.spin > 1) this.spin = 1; }
        else { this.spin -= dt / (def.spinDown || 1); if (this.spin < 0) this.spin = 0; }
        this.rateNow = def.rateMin + (def.rate - def.rateMin) * this.spin;
      }
      if (this._wind > 0) {    // tell running
        const s = this._shooter;
        if (s && s.alive === false) { this._wind = 0; this.windup = 0; }
        else {
          this._wind -= dt; this.windup = Math.min(1, 1 - this._wind / def.windup);
          if (this._wind <= 0) {
            this._wind = 0; this.windup = 0;
            if (this._hasAim && s && s.pos) _o.copy(s.pos).add(this._off); else _o.copy(this._off);
            const o = this._wopts || {}; o._release = true; _w2.copy(this._dir); this.fire(s, _o, _w2, o); o._release = false; this._wopts = null;
          }
        }
      }
      // ripple
      if (this.burstLeft > 0) {
        const s = this._shooter;
        if (s && s.alive === false) this.burstLeft = 0;
        else {
          this._bt -= dt;
          while (this.burstLeft > 0 && this._bt <= 0) {
            if (this._hasAim && s && s.pos) _o.copy(s.pos).add(this._off); else _o.copy(this._off);
            this._one(_o); this.burstLeft--; this._bt += def.burstGap || 0.08;
          }
        }
      }
      // magazine
      if (def.clip) {
        if (this.reloading) {
          this._rt += dt; this.reloading = Math.min(1, this._rt / def.reload);
          if (this._rt >= def.reload) { this.reloading = 0; this.clip = this.clipMax; emit('weapon:ready', this._shooter); }
        } else if (this.clip <= 0 && this._auto > 0) { this._auto -= dt; if (this._auto <= 0) this.reload(); }
      }
      // heat
      if (def.kind === 'heat' && this.heat > 0) {
        if (this.overheated) {
          this.heat -= def.overheatCool * dt;
          if (this.heat <= 0) { this.heat = 0; this.overheated = false; emit('weapon:ready', this._shooter); }
        } else if (this.sinceFire > def.coolDelay) { this.heat -= def.coolRate * dt; if (this.heat < 0) this.heat = 0; }
      }
      // recharge
      if (def.recharge && this.charge < 1) {
        this.charge += dt / def.recharge;
        if (this.charge >= 1) { this.charge = 1; emit('weapon:ready', this._shooter); }
        this.shots = def.kind === 'lock' ? Math.floor(this.charge * def.shots + 1e-6) : this.charge >= 1 ? 1 : 0;
      }
      this.ready = this.canFire();
    },
    // Back to a full, cold weapon (respawn / new rig).
    reset() {
      this.clip = this.clipMax; this.reloading = 0; this.heat = 0; this.overheated = false; this.charge = 1; this.shots = this.shotsMax;
      this._cd = 0; this.cd = 0; this.bloom = 0; this.burstLeft = 0; this.spin = 0; this._wind = 0; this.windup = 0; this._auto = 0; this.ready = true; this.side = 'L';
    },
  };
  return w;
}
