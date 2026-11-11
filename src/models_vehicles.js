// ============================================================================
// KILOTON — models_vehicles.js   OWNER: MODELS.
// Vanta vehicles: tank (tracked, traversing turret), drone (twin ducted fans),
// gunship (lift-fan attack craft with stub wings, rocket pods and a chin gun).
// ============================================================================
import { THREE, clamp, damp, wrapPi } from './core.js';
import { Builder, lin, mul3, spring, glowMat, instantiate, flareGeo } from './models_kit.js';
import { panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, STEEL, DARK } from './models_parts.js';

const C = {
  arm: lin(0x561318), armL: lin(0x74201f), armD: lin(0x340b0f), frame: lin(0x171313), frame2: lin(0x262021),
  bone: lin(0xb9a88c), glow: lin(0xff4a10), heat: lin(0xff7a1c), jet: lin(0xffb070), gun: lin(0x2e2c2d), tip: lin(0xd8a013), glass: lin(0xff6a20),
};
const GLOW = mul3(C.glow, 2.6), HEAT = mul3(C.heat, 1), JET = mul3(C.jet, 1);
const TAU = Math.PI * 2;

function ring(B, x, y, z, R, h, t, col, n = 10, o) {
  const seg = 2 * R * Math.tan(Math.PI / n) * 1.04;
  for (let i = 0; i < n; i++) { const a = i / n * TAU; B.box(x + Math.cos(a) * R, y, z + Math.sin(a) * R, t, h, seg, col, Object.assign({ r: [0, -a, 0], b: Math.min(0.03, t * 0.3) }, o)); }
}

// ------------------------------------------------------------------------- TANK
const LUG = 0.36;
export function buildTank() {
  const B = new Builder({ seed: 61, uvScale: 0.3, bevelK: 1.5 });
  const PAINT = () => B.mat(0.5, 0.38, 0.28), FRAME = () => B.mat(0.75, 0.55, 0.18), BARE = () => B.mat(0.25, 1, 0.3);
  B.bone('body', null, 0, 0, 0);
  B.bone('hull', 'body', 0, 0, 0);
  FRAME();
  B.box(0, 0.72, 0, 2.5, 0.75, 5.7, C.frame, { b: 0.08, bz: 0.82 });
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    B.box(s * 1.68, 0.58, 0, 0.86, 0.95, 6.1, BLACK, { b: 0.12, bz: 0.72, edge: 0.12, rough: 0.85, metal: 0.3 });        // track belt
    for (let i = 0; i < 6; i++) { B.cyl(s * 2.06, 0.42, -2.15 + i * 0.86, 0.38, 0.14, C.frame2, { axis: 'x', n: 10 }); BARE(); B.cyl(s * 2.14, 0.42, -2.15 + i * 0.86, 0.14, 0.05, STEEL, { axis: 'x', n: 6 }); FRAME(); }
    B.cyl(s * 2.06, 0.72, 2.75, 0.4, 0.14, C.frame2, { axis: 'x', n: 8 }); B.cyl(s * 2.06, 0.72, -2.75, 0.4, 0.14, C.frame2, { axis: 'x', n: 8 });
    PAINT();
    B.box(s * 1.7, 1.12, -0.3, 1.0, 0.1, 5.0, C.arm, { b: 0.04 });                                                              // fender
    B.box(s * 1.7, 1.0, 3.0, 1.0, 0.3, 0.3, C.armD, { b: 0.05, r: [0.6, 0, 0] }); B.box(s * 1.7, 1.0, -3.0, 1.0, 0.3, 0.3, C.armD, { b: 0.05, r: [-0.6, 0, 0] });
    for (let i = 0; i < 4; i++) { B.box(s * 2.17, 0.86, -1.95 + i * 1.3, 0.09, 0.5, 1.22, i % 2 ? C.arm : C.armL, { b: 0.03 }); bolts(B, s * 2.215, 1.02, -1.95 + i * 1.3, 0.9, 3, xf, C.bone, 0.03); }   // side skirts
    strip(B, s * 2.215, 0.8, 1.95, 0.5, 0.06, xf, GLOW);
    B.box(s * 1.45, 1.3, -0.2, 0.5, 0.26, 2.2, C.armD, { b: 0.05 });                                                         // stowage bins
    groove(B, s * 1.45, 1.435, -0.2, 0.4, 0.03, 'y+');
  }
  PAINT();
  B.box(0, 1.22, -0.2, 2.9, 0.42, 5.2, C.arm, { b: 0.1, tz: 0.86, tx: 0.9 });                                                 // upper hull
  B.box(0, 1.0, 2.75, 2.5, 0.6, 0.9, C.armL, { b: 0.08, r: [0.75, 0, 0] });                                                   // glacis
  hazard(B, 0, 1.2, 3.03, 2.0, 0.16, [-0.82, 0, 0], 0, C.glow);
  for (const s of [1, -1]) { B.chan('glow').box(s * 0.95, 0.82, 3.1, 0.3, 0.1, 0.04, mul3(lin(0xffd9a0), 2)).chan('a'); B.box(s * 0.95, 0.82, 3.05, 0.4, 0.2, 0.1, DARK, { b: 0.03 }); }
  // engine deck
  vent(B, 0.6, 1.44, -2.0, 0.9, 1.0, 'y+', 5, C.armD, 'heat', HEAT); vent(B, -0.6, 1.44, -2.0, 0.9, 1.0, 'y+', 5, C.armD, 'heat', HEAT);
  B.box(0, 1.0, -2.9, 2.4, 0.6, 0.3, C.armD, { b: 0.06 });
  BARE(); for (const s of [1, -1]) { B.cyl(s * 0.9, 1.05, -3.1, 0.13, 0.4, DARK, { axis: 'z', n: 6 }); }
  PAINT();
  hazard(B, 0, 0.82, -3.055, 1.4, 0.14, 'z-', 0, C.glow);
  stencil(B, 0, 1.435, 1.5, 'y+', GLYPH.V, 0.1, C.bone);
  B.tube(-1.2, 1.45, -2.4, -1.2, 3.2, -2.6, 0.02, DARK, { n: 4 });
  B.cyl(0, 1.46, -0.3, 1.2, 0.08, C.frame2, { n: 12 });                                                                      // turret ring
  // moving track lugs (ground run + visible front/rear wrap)
  B.bone('lugs', 'hull', 0, 0, 0);
  FRAME();
  for (const s of [1, -1]) for (let i = -6; i <= 6; i++) B.box(s * 1.68, 0.06, i * LUG, 0.92, 0.1, 0.16, lin(0x1a1a1c), { edge: 0.35, rough: 0.6, metal: 0.6 });
  B.bone('lugsT', 'hull', 0, 0, 0);
  for (const s of [1, -1]) for (let i = -7; i <= 7; i++) B.box(s * 1.68, 1.04, i * LUG, 0.92, 0.07, 0.16, lin(0x1a1a1c), { edge: 0.35, rough: 0.6, metal: 0.6 });

  B.bone('turret', 'hull', 0, 1.5, -0.3);
  PAINT();
  B.box(0, 0.4, 0.0, 2.5, 0.72, 2.9, C.arm, { b: 0.12, tx: 0.78, tz: 0.8, bz: 0.92 });
  B.box(0, 0.42, 1.25, 1.7, 0.6, 0.8, C.armL, { b: 0.1, tz: 0.6, bx: 1.1 });                                                  // cheek wedge
  B.box(0, 0.38, -1.6, 1.9, 0.55, 0.8, C.armD, { b: 0.08 });                                                                  // bustle
  B.arc(0, 0.4, 0.55, 1.08, 1.05, -0.3, 0.3, -1.0, 1.0, C.armL, { thick: 0.08, n: 8, tr: 0.88 });                              // curved frontal shield
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    B.box(s * 1.22, 0.38, -0.1, 0.16, 0.5, 2.0, C.armL, { b: 0.05, r: [0, 0, s * -0.16] });                                   // spaced armour
    strip(B, s * 1.31, 0.36, -0.1, 1.2, 0.06, [0, s * Math.PI / 2, 0], GLOW);
    for (let i = 0; i < 3; i++) { BARE(); B.cyl(s * (0.85 + i * 0.16), 0.72, 1.15 - i * 0.05, 0.07, 0.3, DARK, { n: 6, r: [0.7, 0, 0] }); PAINT(); }   // smoke dischargers
    bolts(B, s * 0.8, 0.765, -0.5, 1.4, 4, 'y+', C.bone, 0.03, Math.PI / 2);
  }
  B.cyl(-0.55, 0.88, -0.4, 0.42, 0.24, C.armD, { n: 8 }); B.cyl(-0.55, 1.02, -0.4, 0.3, 0.08, C.armL, { n: 8 });              // cupola
  B.box(0.6, 0.92, -0.2, 0.36, 0.3, 0.42, C.armD, { b: 0.05 });                                                               // sight head
  B.chan('glow').box(0.6, 0.94, 0.015, 0.22, 0.12, 0.02, GLOW).chan('a');
  B.socket('eye', 0.6, 0.94, 0.05);
  B.tube(0.9, 0.75, -1.5, 0.95, 2.3, -1.7, 0.018, DARK, { n: 4 });
  groove(B, 0, 0.765, 0.2, 1.6, 0.03, 'y+'); hazard(B, 0, 0.4, -2.005, 1.4, 0.14, 'z-', 0, C.glow);
  stencil(B, -0.2, 0.765, -1.0, 'y+', GLYPH.BAR3, 0.09, C.bone);
  B.bone('gun', 'turret', 0, 0.42, 1.35);
  PAINT(); B.box(0, 0, 0.2, 0.9, 0.62, 0.7, C.armD, { b: 0.1, tz: 0.7 });
  BARE();
  B.cyl(0, 0, 2.0, 0.15, 3.2, C.gun, { axis: 'z', n: 10, rough: 0.3 });
  B.cyl(0, 0, 1.3, 0.21, 1.3, lin(0x39343a), { axis: 'z', n: 10, rough: 0.5, metal: 0.6 });                                   // thermal sleeve
  B.cyl(0, 0, 2.5, 0.19, 0.12, DARK, { axis: 'z', n: 10 });
  B.box(0, 0, 3.72, 0.5, 0.34, 0.5, DARK, { b: 0.06, rough: 0.4 });                                                           // muzzle brake
  B.box(0, 0, 3.72, 0.54, 0.14, 0.24, BLACK, { edge: 0 });
  B.chan('heat').cyl(0, 0, 3.98, 0.1, 0.02, HEAT, { axis: 'z', n: 8 }).chan('a');
  B.socket('muzzleL', 0, 0, 4.02); B.socket('muzzleR', 0, 0, 4.02);
  return B.finish();
}

class Vehicle {
  constructor(kind, bp, mats, radius, height) {
    this.glows = { glow: glowMat(), heat: glowMat(), jet: glowMat() };
    this.inst = instantiate(bp, mats, this.glows);
    this.root = new THREE.Group(); this.root.add(this.inst.root);
    this.n = this.inst.nodes; this.sockets = this.inst.sockets; this.mats = mats;
    this.kind = kind; this.radius = radius; this.height = height; this.onFootstep = null;
    this.t = Math.random() * 20; this.deathT = -1; this.damage = 0; this.dside = 1;
    this.pit = { x: 0, v: 0 }; this.rol = { x: 0, v: 0 }; this.prevSpeed = 0;
  }
  setDamage(d) {
    d = clamp(d || 0, 0, 1); this.damage = d;
    const A = this.inst.armor, m = this.mats.armor;
    for (let i = 0; i < A.length; i++) { const h = (i * 0.61803 + 0.3) % 1; A[i].material = d > 0.66 + 0.33 * h ? m[2] : d > 0.25 + 0.45 * h ? m[1] : m[0]; }
  }
  die() { if (this.deathT < 0) { this.deathT = 0; this.dside = Math.random() < 0.5 ? -1 : 1; this.setDamage(1); } }
  glow(dead, k = 1) {
    const t = this.t; let fl = 1;
    if (this.damage > 0.5 && !dead) { const q = Math.sin(t * 23.7) * Math.sin(t * 7.3 + 1.3); if (q > 1.25 - this.damage) fl = 0.25; }
    this.glows.glow.color.setScalar(dead ? Math.max(0, 1 - this.deathT * 3) : k * fl * (1 + 0.08 * Math.sin(t * 3)));
  }
  dispose() { this.root.removeFromParent(); this.glows.glow.dispose(); this.glows.heat.dispose(); this.glows.jet.dispose(); }
}

export class TankRig extends Vehicle {
  constructor(bp, mats) { super('tank', bp, mats, 2.2, 2.6); this.yaw = 0; this.pitch = 0; this.rec = 0; this.tread = 0; this.n.hull.rotation.order = 'YXZ'; this.update(0, { speed: 0 }); }
  trigger(name) {
    if (name === 'fireL' || name === 'fireR' || name === 'fireRocket') { this.rec = 1; this.pit.v -= Math.cos(this.yaw) * 2.2; this.rol.v += Math.sin(this.yaw) * 2.2; }
    else if (name === 'hit') { this.pit.v += (Math.random() - 0.5) * 2; this.rol.v += (Math.random() - 0.5) * 2; }
    else if (name === 'death') this.die(); else if (name === 'revive') { this.deathT = -1; }
  }
  update(dt, s) {
    this.t += dt; const n = this.n, t = this.t;
    if (s.dead) this.die();
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    const sp = dead ? 0 : (s.speed || 0) * ((s.fwd == null ? 1 : s.fwd) < -0.1 ? -1 : 1);
    this.tread += sp * dt;
    const o = ((this.tread % LUG) + LUG) % LUG;
    n.lugs.position.z = -o; n.lugsT.position.z = o;
    const acc = dt > 1e-5 ? (sp - this.prevSpeed) / dt : 0; this.prevSpeed = sp;
    spring(this.pit, clamp(-acc * 0.004, -0.05, 0.05), 60, 9, dt); spring(this.rol, 0, 60, 9, dt);
    const rumble = dead ? 0 : (0.004 + Math.min(0.01, Math.abs(sp) * 0.002));
    n.hull.rotation.x = this.pit.x * 0.06 + Math.sin(t * 9.1) * rumble * 0.6; n.hull.rotation.z = this.rol.x * 0.05 + Math.sin(t * 7.3) * rumble * 0.4;
    n.hull.position.y = Math.sin(t * 27) * rumble * 0.6 + (dead ? -0.06 : 0);
    if (!dead) {
      // limited traverse rate: the turret visibly chases the aim
      const d = wrapPi((s.aimYaw || 0) - this.yaw), m = 1.9 * dt; this.yaw += clamp(d, -m, m);
      const dp = clamp(s.aimPitch || 0, -0.14, 0.55) - this.pitch, mp = 1.2 * dt; this.pitch += clamp(dp, -mp, mp);
    }
    this.rec = damp(this.rec, 0, 5, dt);
    const dk = dead ? Math.min(1, this.deathT * 2.5) : 0;
    n.turret.rotation.set(dk * 0.07, this.yaw + dk * 0.3 * this.dside, dk * 0.12 * (this.dside || 1)); n.turret.position.y = 1.5 + dk * 0.1;
    n.gun.rotation.x = -this.pitch + dk * 0.22; n.gun.position.z = 1.35 - this.rec * 0.5;
    this.glow(dead);
    this.glows.heat.color.setScalar(dead ? 2.2 * (0.7 + 0.3 * Math.sin(t * 13)) * Math.max(0.25, 1 - this.deathT * 0.08) : 0.1 + this.rec * 5 + Math.min(1.0, Math.abs(sp) * 0.12));
  }
}

// ------------------------------------------------------------------------ DRONE
export function buildDrone() {
  const B = new Builder({ seed: 71, uvScale: 0.8, bevelK: 1.4 });
  const PAINT = () => B.mat(0.48, 0.4, 0.28), FRAME = () => B.mat(0.7, 0.6, 0.2), BARE = () => B.mat(0.25, 1, 0.3);
  B.bone('body', null, 0, 0.36, 0);
  B.bone('hull', 'body', 0, 0, 0);
  PAINT();
  B.box(0, 0.02, 0.05, 0.56, 0.3, 1.0, C.arm, { b: 0.06, tz: 0.7, tx: 0.7, bx: 0.8 });
  B.box(0, 0.14, -0.1, 0.36, 0.14, 0.6, C.armL, { b: 0.04, tz: 0.6 });
  B.box(0, -0.02, 0.6, 0.4, 0.2, 0.3, C.armD, { b: 0.05, tz: 0.5, tx: 0.6 });                      // nose
  B.chan('glow').box(0, 0.0, 0.752, 0.2, 0.07, 0.02, GLOW).chan('a');                               // eye
  B.socket('eye', 0, 0, 0.78);
  FRAME();
  B.box(0, 0.02, -0.7, 0.1, 0.1, 0.6, C.frame2, { b: 0.02 });                                        // tail boom
  PAINT();
  for (const s of [1, -1]) {
    B.box(s * 0.16, 0.12, -0.95, 0.03, 0.34, 0.26, C.armL, { b: 0.01, tz: 0.5, oz: -0.1, r: [0, 0, s * -0.5] });   // V fins
    FRAME(); B.box(s * 0.38, 0.02, 0.0, 0.3, 0.07, 0.16, C.frame2, { b: 0.02 }); PAINT();            // fan arm
    ring(B, s * 0.62, 0.02, 0, 0.3, 0.2, 0.05, s > 0 ? C.arm : C.arm, 8);
    B.chan('glow').box(s * 0.945, 0.02, 0, 0.012, 0.05, 0.22, GLOW).chan('a');                        // tip light
    hazard(B, s * 0.62, 0.125, 0.3, 0.3, 0.05, 'y+', 0, C.glow);
  }
  B.chan('jet').box(0, 0.02, -0.56, 0.2, 0.1, 0.02, JET).chan('a');
  B.socket('jetL', 0, 0.02, -0.6); B.socket('jetR', 0, 0.02, -0.6);
  for (const s of [1, -1]) {
    B.bone('rotor' + (s > 0 ? 'L' : 'R'), 'hull', s * 0.62, 0.03, 0);
    BARE(); B.cyl(0, 0, 0, 0.06, 0.12, DARK, { n: 6 });
    B.box(0, 0.02, 0, 0.52, 0.015, 0.07, lin(0x1c1c1e), { r: [0.2, 0, 0], edge: 0.3 }); B.box(0, 0.02, 0, 0.07, 0.015, 0.52, lin(0x1c1c1e), { r: [0, 0, 0.2], edge: 0.3 });
  }
  B.bone('gun', 'hull', 0, -0.17, 0.2);
  FRAME(); B.box(0, 0, 0, 0.16, 0.14, 0.3, C.frame2, { b: 0.03 });
  BARE(); for (const s of [1, -1]) B.cyl(s * 0.045, -0.02, 0.33, 0.028, 0.44, C.gun, { axis: 'z', n: 6 });
  B.chan('heat').box(0, -0.02, 0.555, 0.12, 0.04, 0.01, HEAT).chan('a');
  B.socket('muzzleL', 0.045, -0.02, 0.57); B.socket('muzzleR', -0.045, -0.02, 0.57);
  return B.finish();
}

export class DroneRig extends Vehicle {
  constructor(bp, mats) { super('drone', bp, mats, 0.9, 0.7); this.spin = 0; this.rec = 0; this.bank = 0; this.nose = 0; this.pitch = 0; this.spinV = 40; this.update(0, { speed: 0 }); }
  trigger(name) {
    if (name === 'fireL' || name === 'fireR') { this.rec = 1; this.pit.v -= 2; }
    else if (name === 'hit') { this.pit.v += (Math.random() - 0.5) * 9; this.rol.v += (Math.random() - 0.5) * 9; }
    else if (name === 'death') this.die(); else if (name === 'revive') this.deathT = -1;
  }
  update(dt, s) {
    this.t += dt; const n = this.n, t = this.t;
    if (s.dead) this.die();
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    const sp = s.speed || 0, f = s.fwd == null ? 1 : s.fwd, st = s.strafe || 0;
    this.spinV = damp(this.spinV, dead ? 6 : 42 + sp * 1.5, dead ? 1.2 : 4, dt);
    this.spin = (this.spin + this.spinV * dt) % TAU;
    n.rotorL.rotation.y = this.spin; n.rotorR.rotation.y = -this.spin * 1.07;
    this.nose = damp(this.nose, clamp(sp * f * 0.035, -0.35, 0.4), 5, dt); this.bank = damp(this.bank, clamp(sp * st * 0.05, -0.5, 0.5), 5, dt);
    spring(this.pit, 0, 90, 8, dt); spring(this.rol, 0, 90, 8, dt);
    const b = n.body;
    b.rotation.x = this.nose + this.pit.x * 0.05 + (dead ? Math.min(0.9, this.deathT * 1.4) : 0); b.rotation.z = this.bank + this.rol.x * 0.05 + (dead ? this.deathT * 3 * this.dside : 0);
    b.position.y = 0.36 + (dead ? 0 : Math.sin(t * 2.3) * 0.05); b.position.x = dead ? 0 : Math.sin(t * 1.7) * 0.03;
    this.pitch = damp(this.pitch, clamp(s.aimPitch || 0, -1.2, 0.5), 12, dt); this.rec = damp(this.rec, 0, 14, dt);
    n.gun.rotation.x = -this.pitch - this.nose; n.gun.rotation.y = clamp(s.aimYaw || 0, -0.8, 0.8); n.gun.position.z = 0.2 - this.rec * 0.04;
    this.glow(dead, 1 + 0.25 * Math.sin(t * 9));
    this.glows.heat.color.setScalar(0.2 + this.rec * 6); this.glows.jet.color.setScalar(dead ? 0 : 0.6 + Math.min(3, sp * 0.3));
  }
}

// ---------------------------------------------------------------------- GUNSHIP
export function buildGunship() {
  const B = new Builder({ seed: 83, uvScale: 0.3, bevelK: 1.5 });
  const PAINT = () => B.mat(0.48, 0.4, 0.28), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.25, 1, 0.3);
  B.bone('body', null, 0, 1.25, 0);
  B.bone('hull', 'body', 0, 0, 0);
  PAINT();
  B.box(0, 0, 0.2, 1.7, 1.3, 4.4, C.arm, { b: 0.14, bx: 0.7, tz: 0.9 });                             // fuselage
  B.box(0, -0.1, 2.9, 1.4, 1.0, 1.6, C.arm, { b: 0.12, tz: 0.35, tx: 0.6, bx: 0.7, oz: -0.2 });      // nose
  B.box(0, 0.5, 2.0, 1.15, 0.6, 1.5, C.armD, { b: 0.1, tz: 0.4, tx: 0.7, oz: -0.2 });                // armoured cockpit hood
  B.push(0, 0.1, 0.3, Math.PI / 2, 0, 0); B.arc(0, 0, 0, 0.92, 0.72, -1.9, 2.0, Math.PI - 1.2, Math.PI + 1.2, C.arm, { thick: 0.06, n: 8 }); B.pop();   // rolled upper fuselage
  B.chan('glow');
  B.box(0, 0.52, 2.72, 0.8, 0.14, 0.06, mul3(C.glass, 2.0), { r: [-0.5, 0, 0] });                    // vision slit
  for (const s of [1, -1]) B.box(s * 0.52, 0.5, 2.1, 0.04, 0.16, 0.7, mul3(C.glass, 1.6), { r: [0, s * 0.18, s * 0.25] });
  B.chan('a');
  B.box(0, 0.2, 3.72, 0.2, 0.14, 0.4, DARK, { b: 0.03 }); B.chan('glow').box(0, 0.2, 3.93, 0.1, 0.07, 0.02, GLOW).chan('a');   // nose sensor
  B.socket('eye', 0, 0.2, 3.95); B.socket('cockpit', 0, 0.3, 2.0);
  B.box(0, 0.78, -0.3, 1.2, 0.36, 3.0, C.armL, { b: 0.08, tz: 0.7, tx: 0.8 });                       // spine
  vent(B, 0, 0.965, -0.9, 0.7, 1.0, 'y+', 5, C.armD, 'heat', HEAT);
  stencil(B, 0, 0.965, 0.5, 'y+', GLYPH.V, 0.1, C.bone);
  // tail boom + V tail
  B.box(0, 0.25, -3.1, 0.7, 0.7, 2.6, C.armD, { b: 0.1, bz: 1, tz: 1, tx: 0.8 });
  B.box(0, 0.25, -3.1, 0.6, 0.6, 2.7, C.arm, { b: 0.08, bx: 0.6 });
  for (const s of [1, -1]) {
    B.box(s * 0.75, 0.9, -4.0, 0.1, 1.5, 1.0, C.armL, { b: 0.04, tz: 0.5, oz: -0.4, r: [0, 0, s * -0.55] });
    strip(B, s * 0.36, 0.25, -3.2, 1.4, 0.06, [0, s * Math.PI / 2, 0], GLOW);
    B.box(s * 0.5, -0.2, -4.1, 1.0, 0.08, 0.6, C.armD, { b: 0.03, tz: 0.6 });
  }
  BARE(); B.cyl(0, 0.25, -4.5, 0.36, 0.4, DARK, { axis: 'z', n: 8, r2: 0.3 });
  B.chan('jet').cyl(0, 0.25, -4.71, 0.28, 0.02, JET, { axis: 'z', n: 8 }).chan('a');
  B.socket('jetL', 0, 0.25, -4.75); B.socket('jetR', 0, 0.25, -4.75);
  PAINT();
  // stub wings, lift-fan ducts at the tips, rocket pods beneath
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.box(s * 1.45, 0.1, 0.1, 1.5, 0.22, 1.7, C.arm, { b: 0.07, bz: 1, tz: 0.9, r: [0, 0, s * -0.08] });
    hazard(B, s * 1.4, 0.24, 0.6, 1.0, 0.12, [-Math.PI / 2, 0, 0], 0, C.glow);
    groove(B, s * 1.4, 0.23, 0.0, 1.2, 0.03, 'y+');
    ring(B, s * 2.3, 0.35, 0.1, 0.8, 0.5, 0.1, C.armL, 12);
    ring(B, s * 2.3, 0.62, 0.1, 0.82, 0.08, 0.14, C.armD, 12, { edge: 0.5 });
    FRAME(); B.box(s * 2.3, 0.3, 0.1, 1.5, 0.07, 0.1, C.frame2, {}); B.box(s * 2.3, 0.3, 0.1, 0.1, 0.07, 1.5, C.frame2, {}); PAINT();
    B.chan('glow').box(s * 3.16, 0.35, 0.1, 0.02, 0.1, 0.6, GLOW).chan('a');
    // pylon + rocket pod
    FRAME(); B.box(s * 1.35, -0.2, 0.2, 0.14, 0.4, 0.6, C.frame2, { b: 0.03 }); PAINT();
    B.cyl(s * 1.35, -0.6, 0.3, 0.34, 1.7, C.armD, { axis: 'z', n: 8 });
    B.cyl(s * 1.35, -0.6, 1.17, 0.3, 0.06, BLACK, { axis: 'z', n: 8, edge: 0 });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; B.cyl(s * 1.35 + Math.cos(a) * 0.19, -0.6 + Math.sin(a) * 0.19, 1.2, 0.065, 0.1, C.tip, { axis: 'z', n: 6, r2: 0.01, rough: 0.5, metal: 0.2 }); }
    B.cyl(s * 1.35, -0.6, 1.2, 0.065, 0.1, C.tip, { axis: 'z', n: 6, r2: 0.01, rough: 0.5, metal: 0.2 });
    B.cyl(s * 1.35, -0.6, -0.5, 0.36, 0.1, C.arm, { axis: 'z', n: 8 });
    B.socket(s > 0 ? 'rocketPod' : 'aaPod', s * 1.35, -0.6, 1.3);
    // skids
    FRAME(); B.box(s * 0.75, -1.15, 0.5, 0.12, 0.1, 2.8, C.frame2, { b: 0.03 }); B.tube(s * 0.6, -0.6, 1.2, s * 0.75, -1.12, 1.2, 0.05, DARK); B.tube(s * 0.6, -0.6, -0.4, s * 0.75, -1.12, -0.4, 0.05, DARK); PAINT();
    panel(B, s * 0.72, 0.1, -0.6, 1.4, 0.6, xf, C.armD, 0.05); bolts(B, s * 0.775, 0.33, -0.6, 1.2, 5, xf, C.bone, 0.03);
    B.bone('rotor' + S, 'hull', s * 2.3, 0.4, 0.1);
    BARE(); B.cyl(0, 0, 0, 0.14, 0.2, DARK, { n: 8 });
    for (let i = 0; i < 3; i++) B.box(Math.cos(i * 2.094) * 0.38, 0.03, Math.sin(i * 2.094) * 0.38, 0.72, 0.02, 0.13, lin(0x1c1c1e), { r: [0.18, -i * 2.094, 0], edge: 0.3 });
    B.to('hull'); PAINT();
  }
  // chin turret
  B.bone('chin', 'hull', 0, -0.7, 2.5);
  FRAME(); B.cyl(0, 0, 0, 0.36, 0.3, C.frame2, { n: 8 }); PAINT(); B.box(0, -0.2, 0.05, 0.5, 0.3, 0.6, C.armD, { b: 0.06 });
  B.bone('gun', 'chin', 0, -0.22, 0.2);
  BARE();
  for (const s of [1, -1]) B.cyl(s * 0.09, 0, 0.75, 0.05, 1.3, C.gun, { axis: 'z', n: 6 });
  B.box(0, 0, 0.3, 0.3, 0.2, 0.5, DARK, { b: 0.04 }); B.box(0, 0, 1.3, 0.3, 0.14, 0.12, DARK, { b: 0.02 });
  B.chan('heat').box(0, 0, 1.41, 0.24, 0.06, 0.01, HEAT).chan('a');
  B.socket('muzzleL', 0.09, 0, 1.42); B.socket('muzzleR', -0.09, 0, 1.42);
  return B.finish();
}

export class GunshipRig extends Vehicle {
  constructor(bp, mats) {
    super('gunship', bp, mats, 3.2, 2.6); this.spin = 0; this.spinV = 30; this.rec = 0; this.podK = 0; this.yaw = 0; this.pitch = 0; this.nose = 0; this.bank = 0; this.thr = 0;
    this.flare = new THREE.Mesh(flareGeo(), mats.flareHot); this.flare.position.copy(this.sockets.jetL.position); this.flare.rotation.x = Math.PI / 2; this.flare.frustumCulled = false; this.n.hull.add(this.flare);
    this.update(0, { speed: 0 });
  }
  trigger(name) {
    if (name === 'fireL' || name === 'fireR') { this.rec = 1; }
    else if (name === 'fireRocket' || name === 'fireAA') { this.podK = 1; this.pit.v -= 2.5; }
    else if (name === 'hit') { this.pit.v += (Math.random() - 0.5) * 6; this.rol.v += (Math.random() - 0.5) * 6; }
    else if (name === 'death') this.die(); else if (name === 'revive') this.deathT = -1;
  }
  update(dt, s) {
    this.t += dt; const n = this.n, t = this.t;
    if (s.dead) this.die();
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    const sp = s.speed || 0, f = s.fwd == null ? 1 : s.fwd, st = s.strafe || 0;
    this.spinV = damp(this.spinV, dead ? 5 : 34 + sp, dead ? 0.8 : 3, dt); this.spin = (this.spin + this.spinV * dt) % TAU;
    n.rotorL.rotation.y = this.spin; n.rotorR.rotation.y = -this.spin - 0.5;
    this.nose = damp(this.nose, clamp(sp * f * 0.02, -0.25, 0.32), 3, dt); this.bank = damp(this.bank, clamp(sp * st * 0.03, -0.45, 0.45), 3, dt);
    spring(this.pit, 0, 50, 7, dt); spring(this.rol, 0, 50, 7, dt);
    const b = n.body;
    b.rotation.x = this.nose + this.pit.x * 0.04 + (dead ? Math.min(0.5, this.deathT * 0.5) : 0); b.rotation.z = this.bank + this.rol.x * 0.04 + (dead ? Math.min(1.2, this.deathT * 0.9) * this.dside : 0);
    b.position.y = 1.25 + (dead ? 0 : Math.sin(t * 1.3) * 0.12); b.position.x = dead ? 0 : Math.sin(t * 0.9) * 0.06;
    if (!dead) { const d = wrapPi((s.aimYaw || 0) - this.yaw), m = 3.5 * dt; this.yaw += clamp(d, -m, m); this.pitch = damp(this.pitch, clamp(s.aimPitch || 0, -1.3, 0.25), 10, dt); }
    this.rec = damp(this.rec, 0, 16, dt); this.podK = damp(this.podK, 0, 5, dt);
    n.chin.rotation.y = this.yaw; n.gun.rotation.x = -this.pitch - this.nose; n.gun.position.z = 0.2 - this.rec * 0.08;
    this.thr = damp(this.thr, dead ? 0 : clamp(s.jet != null && s.jet > 0 ? s.jet : sp * f / 14, 0, 1), 4, dt);
    this.flare.visible = this.thr > 0.03; if (this.flare.visible) this.flare.scale.set(0.3, 2.2 * this.thr * (0.85 + 0.15 * Math.sin(t * 50)), 0.3);
    this.glow(dead);
    this.glows.heat.color.setScalar(dead ? 2 * (0.7 + 0.3 * Math.sin(t * 15)) : 0.3 + this.rec * 5 + this.podK * 2); this.glows.jet.color.setScalar(0.3 + this.thr * 5);
  }
}

// ----------------------------------------------------------------------- TURRET
// Static Vanta emplacement: bolted octagonal plinth, yawing armoured head, pitching twin barrels.
export function buildTurret() {
  const B = new Builder({ seed: 97, uvScale: 0.5, bevelK: 1.4 });
  const PAINT = () => B.mat(0.5, 0.38, 0.28), FRAME = () => B.mat(0.75, 0.55, 0.18), BARE = () => B.mat(0.25, 1, 0.3);
  B.bone('body', null, 0, 0, 0);
  B.bone('hull', 'body', 0, 0, 0);
  FRAME();
  B.cyl(0, 0.12, 0, 1.15, 0.24, C.frame, { n: 8 });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.box(Math.cos(a) * 1.05, 0.1, Math.sin(a) * 1.05, 0.7, 0.2, 0.36, C.frame2, { b: 0.04, r: [0, -a, 0] }); BARE(); B.cyl(Math.cos(a) * 1.25, 0.22, Math.sin(a) * 1.25, 0.07, 0.08, STEEL, { n: 6 }); FRAME(); }
  PAINT();
  B.cyl(0, 0.55, 0, 0.95, 0.65, C.arm, { n: 8, r2: 0.72 });
  hazard(B, 0, 0.5, 0.79, 0.6, 0.12, [-0.33, 0, 0], 0, C.glow);
  B.cyl(0, 0.94, 0, 0.66, 0.14, C.frame2, { n: 12 });
  for (const s of [1, -1]) { B.box(s * 0.75, 0.42, -0.5, 0.4, 0.4, 0.5, C.armD, { b: 0.05 }); strip(B, s * 0.955, 0.42, -0.5, 0.3, 0.05, s > 0 ? 'x+' : 'x-', GLOW); }   // ammo lockers
  B.tube(0.3, 0.3, -0.9, 0.2, 0.9, -0.5, 0.05, DARK);
  B.bone('turret', 'hull', 0, 1.0, 0);
  PAINT();
  B.box(0, 0.45, -0.05, 1.2, 0.8, 1.5, C.arm, { b: 0.1, tx: 0.75, tz: 0.8 });
  B.arc(0, 0.45, 0.2, 0.72, 0.7, -0.3, 0.32, -1.0, 1.0, C.armL, { thick: 0.07, n: 6, tr: 0.85 });       // curved gun shield
  B.box(0, 0.4, -0.85, 0.9, 0.5, 0.4, C.armD, { b: 0.07 });
  for (const s of [1, -1]) { FRAME(); B.cyl(s * 0.68, 0.42, 0.1, 0.26, 0.2, C.frame2, { axis: 'x', n: 10 }); PAINT(); bolts(B, s * 0.4, 0.86, -0.2, 0.8, 3, 'y+', C.bone, 0.03, Math.PI / 2); }
  B.box(-0.3, 0.98, -0.3, 0.3, 0.26, 0.36, C.armD, { b: 0.04 });
  B.chan('glow').box(-0.3, 1.0, -0.11, 0.2, 0.1, 0.02, GLOW).chan('a');
  B.socket('eye', -0.3, 1.0, -0.08);
  B.tube(0.4, 0.85, -0.6, 0.45, 1.9, -0.75, 0.015, DARK, { n: 4 });
  hazard(B, 0, 0.4, -1.055, 0.7, 0.1, 'z-', 0, C.glow);
  B.bone('gun', 'turret', 0, 0.42, 0.1);
  FRAME(); B.box(0, 0, 0.3, 1.5, 0.36, 0.7, C.frame2, { b: 0.06 });
  for (const s of [1, -1]) {
    PAINT(); B.box(s * 0.82, 0, 0.3, 0.3, 0.46, 1.1, C.armD, { b: 0.06 });
    BARE(); B.cyl(s * 0.82, 0, 1.45, 0.075, 1.5, C.gun, { axis: 'z', n: 8, rough: 0.3 }); B.cyl(s * 0.82, 0, 1.05, 0.11, 0.5, lin(0x39343a), { axis: 'z', n: 8, rough: 0.5 });
    B.cyl(s * 0.82, 0, 2.2, 0.11, 0.2, DARK, { axis: 'z', n: 8 });
    B.chan('heat').cyl(s * 0.82, 0, 2.31, 0.07, 0.01, HEAT, { axis: 'z', n: 8 }).chan('a');
    B.socket(s > 0 ? 'muzzleL' : 'muzzleR', s * 0.82, 0, 2.33);
  }
  return B.finish();
}
export class TurretRig extends Vehicle {
  constructor(bp, mats) { super('turret', bp, mats, 1.2, 2.2); this.yaw = 0; this.pitch = 0; this.rec = new Float32Array(2); this.scan = Math.random() * 6; this.update(0, {}); }
  trigger(name) {
    if (name === 'fireL') { this.rec[0] = 1; this.pit.v -= 1; } else if (name === 'fireR' || name === 'fireRocket') { this.rec[1] = 1; this.pit.v -= 1; }
    else if (name === 'hit') { this.pit.v += (Math.random() - 0.5) * 4; this.rol.v += (Math.random() - 0.5) * 4; }
    else if (name === 'death') this.die(); else if (name === 'revive') this.deathT = -1;
  }
  update(dt, s) {
    this.t += dt; const n = this.n, t = this.t;
    if (s.dead) this.die();
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    if (!dead) {
      const d = wrapPi((s.aimYaw || 0) - this.yaw), m = 2.6 * dt; this.yaw += clamp(d, -m, m);
      const dp = clamp(s.aimPitch || 0, -0.35, 1.1) - this.pitch, mp = 2 * dt; this.pitch += clamp(dp, -mp, mp);
    }
    spring(this.pit, 0, 120, 12, dt); spring(this.rol, 0, 120, 12, dt);
    this.rec[0] = damp(this.rec[0], 0, 16, dt); this.rec[1] = damp(this.rec[1], 0, 16, dt);
    const dk = dead ? Math.min(1, this.deathT * 3) : 0;
    n.turret.rotation.set(this.pit.x * 0.03 + dk * 0.12, this.yaw, this.rol.x * 0.03 + dk * 0.2 * this.dside);
    n.gun.rotation.x = -this.pitch + dk * 0.5; n.gun.position.z = 0.1 - (this.rec[0] + this.rec[1]) * 0.06;
    this.glow(dead, 1 + 0.2 * Math.sin(t * 5));
    this.glows.heat.color.setScalar(dead ? 1.5 * (0.6 + 0.4 * Math.sin(t * 14)) * Math.max(0.2, 1 - this.deathT * 0.15) : 0.1 + (this.rec[0] + this.rec[1]) * 5);
  }
}

// ------------------------------------------------------------------------ RELAY
// The friendly objective: a field comm relay in the player's colours. Generator plinth, lattice mast, tracking
// dish, teal status lights. setDamage: lights go amber-red and stutter, the dish droops, the mast leans; 1 = down.
const RC = { arm: lin(0x55606b), armL: lin(0x7b8792), armD: lin(0x394049), frame: lin(0x1c1f23), frame2: lin(0x2a2e33), white: lin(0xc9cdcf), glow: lin(0x14f2dc), warn: lin(0xff5a1c) };
export function buildRelay() {
  const B = new Builder({ seed: 211, uvScale: 0.35, bevelK: 1.4 });
  const PAINT = () => B.mat(0.5, 0.35, 0.42), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.25, 1, 0.3);
  const GL = mul3(RC.glow, 2.4), WARN = mul3(RC.warn, 1);
  B.bone('body', null, 0, 0, 0);
  B.bone('hull', 'body', 0, 0, 0);
  FRAME();
  B.box(0, 0.1, 0, 2.0, 0.2, 2.0, RC.frame, { b: 0.05 });
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, x = Math.cos(a) * 1.25, z = Math.sin(a) * 1.25; B.tube(Math.cos(a) * 0.7, 0.5, Math.sin(a) * 0.7, x, 0.08, z, 0.07, RC.frame2); B.box(x, 0.05, z, 0.4, 0.1, 0.4, RC.frame2, { b: 0.03, r: [0, -a, 0] }); }   // outriggers
  PAINT();
  B.box(0, 0.75, 0, 1.5, 1.1, 1.3, RC.arm, { b: 0.1 });                                                  // generator cabinet
  B.box(0, 1.36, 0, 1.3, 0.14, 1.1, RC.armL, { b: 0.05 });
  vent(B, 0.3, 0.8, 0.655, 0.6, 0.6, 'z+', 5, RC.armD); vent(B, 0, 0.8, -0.655, 1.0, 0.6, 'z-', 5, RC.armD, 'heat', WARN);
  panel(B, -0.4, 0.8, 0.655, 0.5, 0.7, 'z+', RC.armD, 0.04);
  B.chan('glow'); for (let i = 0; i < 4; i++) B.box(-0.55 + i * 0.1, 1.0, 0.7, 0.06, 0.06, 0.02, GL); B.chan('heat'); for (let i = 0; i < 3; i++) B.box(-0.5 + i * 0.1, 0.85, 0.7, 0.06, 0.06, 0.02, mul3(WARN, 2)); B.chan('a');
  hazard(B, 0, 0.3, 0.655, 1.3, 0.12, 'z+'); hazard(B, 0.755, 0.3, 0, 1.1, 0.12, 'x+'); hazard(B, -0.755, 0.3, 0, 1.1, 0.12, 'x-');
  for (const s of [1, -1]) { strip(B, s * 0.755, 0.9, 0, 0.9, 0.07, s > 0 ? 'x+' : 'x-', GL); B.limb(s * 0.5, 1.45, -0.35, s * 0.5, 1.45, 0.35, 0.16, 0.16, RC.armL, { n: 8, end: 0.5 }); }   // fuel cells
  stencil(B, 0.2, 1.435, 0, 'y+', GLYPH.W7, 0.07, RC.white);
  B.tube(0.6, 0.3, 0.5, 0.9, 0.05, 1.3, 0.05, DARK); B.tube(-0.5, 0.3, -0.6, -1.2, 0.05, -0.9, 0.04, DARK);
  // mast (leans as it fails)
  B.bone('mast', 'hull', 0, 1.4, 0);
  FRAME();
  B.cyl(0, 0.15, 0, 0.3, 0.3, RC.frame2, { n: 8 });
  const legs = [[0.26, 0.26], [-0.26, 0.26], [-0.26, -0.26], [0.26, -0.26]];
  for (let i = 0; i < 4; i++) { const a = legs[i], b = legs[(i + 1) % 4]; B.tube(a[0], 0.2, a[1], a[0] * 0.45, 3.5, a[1] * 0.45, 0.04, RC.arm, { n: 4 }); for (let k = 0; k < 4; k++) { const y0 = 0.3 + k * 0.8, y1 = y0 + 0.8, f0 = 1 - 0.55 * (y0 - 0.2) / 3.3, f1 = 1 - 0.55 * (y1 - 0.2) / 3.3; B.tube(a[0] * f0, y0, a[1] * f0, b[0] * f1, y1, b[1] * f1, 0.022, RC.armD, { n: 4 }); } }
  PAINT();
  B.box(0, 3.55, 0, 0.5, 0.3, 0.5, RC.armL, { b: 0.06 });
  B.tube(0, 3.7, 0, 0, 4.55, 0, 0.03, DARK, { n: 5 });
  for (const y of [1.2, 2.4]) { B.box(0, y, 0, 0.5, 0.08, 0.5, RC.arm, { b: 0.02 }); B.chan('glow').arc(0, y, 0, 0.3, 0.3, 0.06, 0.1, 0, Math.PI * 2, mul3(GL, 0.7), { thick: 0, n: 8 }).chan('a'); }
  B.chan('glow').box(0, 4.6, 0, 0.1, 0.1, 0.1, mul3(GL, 1.4)).chan('heat').box(0, 4.45, 0, 0.12, 0.06, 0.12, mul3(WARN, 2)).chan('a');
  for (const s of [1, -1]) { B.box(s * 0.45, 3.0, 0, 0.5, 0.05, 0.05, RC.frame2, {}); B.box(s * 0.7, 3.0, 0, 0.06, 0.5, 0.3, RC.white, { b: 0.02, rough: 0.6, metal: 0.1 }); }   // panel antennas
  B.socket('eye', 0, 4.6, 0); B.socket('cockpit', 0, 2.0, 0);
  // dish (tracks slowly, droops when damaged)
  B.bone('dish', 'mast', 0, 3.2, 0.3);
  FRAME(); B.box(0, 0, 0.1, 0.16, 0.16, 0.4, RC.frame2, { b: 0.03 });
  PAINT();
  B.lathe(0, 0, 0.42, [[0, 0.1], [0.08, 0.45], [0.2, 0.75], [0.34, 0.9]], RC.white, { n: 12, r: [Math.PI / 2, 0, 0], cap: 'bottom', rough: 0.55, metal: 0.2 });
  { const N = 12, behind = new THREE.Vector3(0, 0, -6), P = (r, z, i) => new THREE.Vector3(Math.cos(i / N * 6.2832 + 0.2618) * r, Math.sin(i / N * 6.2832 + 0.2618) * r, z); B._pm = 0;   // concave face (looks toward +Z)
    const prof = [[0.08, 0.45], [0.42, 0.52], [0.72, 0.64], [0.88, 0.77]];
    for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < N; i++) B.poly([P(prof[k][0], prof[k][1], i), P(prof[k][0], prof[k][1], i + 1), P(prof[k + 1][0], prof[k + 1][1], i + 1), P(prof[k + 1][0], prof[k + 1][1], i)], k % 2 ? RC.armL : RC.white, behind, 0.5, 0.3); }
  BARE(); for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; B.tube(Math.cos(a) * 0.6, Math.sin(a) * 0.6, 0.66, 0, 0, 1.05, 0.02, STEEL, { n: 4 }); }
  B.cyl(0, 0, 1.08, 0.07, 0.14, DARK, { axis: 'z', n: 6 });
  B.chan('glow').cyl(0, 0, 1.16, 0.045, 0.02, GL, { axis: 'z', n: 6 }).chan('a');
  B.socket('muzzleL', 0, 0, 1.2);
  return B.finish();
}
export class RelayRig extends Vehicle {
  constructor(bp, mats) { super('relay', bp, mats, 1.0, 6); this.pan = Math.random() * 6; this.lean = 0; this.update(0, {}); }
  trigger(name) {
    if (name === 'hit') { this.pit.v += (Math.random() - 0.5) * 3; this.rol.v += (Math.random() - 0.5) * 3; }
    else if (name === 'death') this.die(); else if (name === 'revive' || name === 'boot') { this.deathT = -1; this.setDamage(0); }
  }
  update(dt, s) {
    this.t += dt; const n = this.n, t = this.t, d = this.damage;
    if (s && s.dead) this.die();
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    spring(this.pit, 0, 60, 5, dt); spring(this.rol, 0, 60, 5, dt);
    const fall = dead ? Math.min(1, this.deathT * 1.4) : 0, fe = fall * fall * (3 - 2 * fall);
    this.lean = damp(this.lean, Math.max(0, d - 0.55) * 0.3, 3, dt);
    n.mast.rotation.set(this.pit.x * 0.02 + this.lean * 0.6 + fe * 1.25, 0, this.rol.x * 0.02 - this.lean + fe * 0.35 * this.dside);
    if (!dead) this.pan += dt * 0.5 * (1 - d * 0.8);
    n.dish.rotation.set(-0.35 + d * 0.9 + fe * 0.5 + (d > 0.4 ? Math.sin(t * 31) * 0.01 * d : 0), (s && s.aimYaw != null && s.aimYaw !== 0) ? s.aimYaw : Math.sin(this.pan) * 0.9, d * 0.25);
    // status lights: steady teal -> stutter -> out; warning lights come up with damage and strobe when critical
    let g = 1 + 0.15 * Math.sin(t * 4);
    if (d > 0.3) { const q = Math.sin(t * (9 + d * 30)) * Math.sin(t * 3.7 + 1); if (q > 0.9 - d) g *= 0.15; g *= 1 - 0.6 * d; }
    this.glows.glow.color.setScalar(dead ? 0 : g);
    this.glows.heat.color.setScalar(dead ? Math.max(0, 1.5 - this.deathT) * (0.5 + 0.5 * Math.sin(t * 20)) : d < 0.25 ? 0.02 : d * 3 * (d > 0.7 ? (Math.sin(t * 14) > 0 ? 1 : 0.15) : 0.6 + 0.4 * Math.sin(t * 5)));
  }
}
