// ============================================================================
// KILOTON — models_infantry.js   OWNER: MODELS.
// Pilot (player, teal) and Vanta soldiers (rifle / rocketeer / ace). 1.8 m,
// people in armour: smooth-shaded rounded helmets, tapered limbs and a shaped
// torso (lathe / capsule segments) under crisp-edged armour plates.
// Animation: run cycle with planted feet, aim, recoil, slide, combat roll,
// crumple death.
// ============================================================================
import { THREE, clamp, damp, dampAngle, wrapPi } from './core.js';
import { Builder, lin, mul3, spring, keys, flareGeo, glowMat, instantiate } from './models_kit.js';
import { Walker } from './models_biped.js';
import { BLACK, STEEL, DARK } from './models_parts.js';

export const ROLL_TIME = 0.55;
export const TROOPER_CFG = {
  hipH: 0.93, hipX: 0.1, hipY: -0.02, l1: 0.43, l2: 0.43, meta: 0, am: 0, amAir: 0, ankle: 0.07, homeX: 0.12, homeZ: 0.0,
  strideMax: 1.35, s0: 0.45, sk: 0.17, duty: 0.52, Tmin: 0.44, Tmax: 0.95, Tturn: 0.55, stepH: 0.2, toeLen: 0.16,
  bob: 0.035, sway: 0.02, roll: 0.03, yawSw: 0.16, leanK: 0.022, stepImpulse: 0.22, dipK: 170, dipC: 17, landV: 1.7,
  hangY: 0.78, hangZ: -0.12, heavy: false, footOnShin: true, flareR: 0.07, flareLen: 0.55,
};

const PAL = {
  pilot: { suit: lin(0x4b5663), arm: lin(0x7f8c98), armL: lin(0xaab6c0), accent: lin(0x1a8f94), glow: lin(0x14f2dc), gun: lin(0x2b2f34), boot: lin(0x23272c) },
  vanta: { suit: lin(0x231e1e), arm: lin(0x5c1419), armL: lin(0x7c2422), accent: lin(0x340b0f), glow: lin(0xff4a10), gun: lin(0x1b1a1b), boot: lin(0x121112) },
};
const PI2 = Math.PI * 2;

export function buildTrooper(variant) {
  const pilot = variant === 'pilot', ace = variant === 'ace', rocketeer = variant === 'rocketeer';
  const P = pilot ? PAL.pilot : PAL.vanta;
  const GLOW = mul3(P.glow, ace ? 3.2 : 2.4), TRIM = mul3(P.glow, pilot ? 0.9 : 0.6);
  const BONE = lin(0xb9a88c);
  const B = new Builder({ seed: 41 + variant.length, uvScale: 1.1 });
  B.jit = 0.05;
  const CLOTH = () => B.mat(0.88, 0.05, 0.12), PLATE = () => B.mat(0.46, 0.4, 0.4), GUN = () => B.mat(0.4, 0.8, 0.35), RUB = () => B.mat(0.8, 0.1, 0.15);
  /** thin emissive piping ring around local Y (rim light that separates the figure from the street) */
  const band = (y, rx, rz, h = 0.012, col = TRIM) => { B.chan('glow').arc(0, 0, 0, rx, rz, y, y + h, 0, PI2, col, { thick: 0, n: 8 }).chan('a'); };

  B.bone('body', null, 0, 0, 0);
  // ------------------------------------------------------------------ pelvis
  B.bone('pelvis', 'body', 0, 0.93, 0);
  CLOTH();
  B.lathe(0, 0, 0, [[-0.11, 0.1, 0.085], [-0.04, 0.15, 0.105], [0.06, 0.152, 0.105], [0.12, 0.138, 0.1]], P.suit, { n: 8, sq: 2.5 });
  PLATE();
  B.lathe(0, 0.07, 0, [[-0.028, 0.162, 0.114], [0.028, 0.16, 0.112]], DARK, { n: 8, sq: 2.5 });                 // belt
  B.box(0, 0.07, 0.115, 0.07, 0.05, 0.02, STEEL, { b: 0.008, rough: 0.3, metal: 1 });
  for (const s of [1, -1]) B.arc(0, 0, 0, 0.176, 0.124, -0.1, 0.035, s * 1.57 - 0.6, s * 1.57 + 0.6, P.arm, { thick: 0.018, n: 4, tr: 0.96 });   // hip guards
  B.arc(0, 0, 0, 0.13, 0.118, -0.11, 0.03, -0.42, 0.42, P.armL, { thick: 0.016, n: 3, tr: 1.15 });               // groin plate
  B.box(0, -0.01, -0.105, 0.14, 0.1, 0.04, P.accent, { b: 0.015 });                                              // rear pouch

  // -------------------------------------------------------------------- legs
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('hip' + S, 'pelvis', s * 0.1, -0.02, 0);
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    CLOTH(); B.limb(0, 0, 0, 0, -0.43, 0, 0.09, 0.066, P.suit, { n: 6, sz: 1.06, flat: true });
    PLATE();
    B.lathe(0, -0.2, 0.01, [[-0.12, 0.08, 0.086], [0, 0.094, 0.1], [0.11, 0.1, 0.104]], P.arm, { n: 6 });         // cuisse
    B.arc(0, -0.2, 0.01, 0.104, 0.112, -0.09, 0.09, -0.7, 0.7, P.armL, { thick: 0.012, n: 4 });
    if (pilot) { B.push(0, -0.2, 0.01); band(-0.122, 0.084, 0.09); B.pop(); }
    B.box(s * 0.085, -0.15, 0, 0.035, 0.13, 0.09, P.accent, {});                                       // thigh pouch / holster

    B.bone('shin' + S, 'thigh' + S, 0, -0.43, 0);
    CLOTH(); B.limb(0, 0, 0, 0, -0.37, 0, 0.068, 0.05, P.suit, { n: 6, flat: true });
    PLATE();
    B.lathe(0, 0, 0.04, [[-0.058, 0.03, 0.022], [-0.03, 0.058, 0.04], [0.02, 0.062, 0.042], [0.058, 0.034, 0.024]], P.armL, { n: 6 });   // knee cop
    B.lathe(0, -0.21, 0.006, [[-0.13, 0.058, 0.062], [0, 0.074, 0.08], [0.12, 0.07, 0.072]], P.arm, { n: 6 });   // greave
    B.arc(0, -0.21, 0.006, 0.08, 0.088, -0.11, 0.1, -0.6, 0.6, P.armL, { thick: 0.01, n: 4, tr: 0.95 });
    if (pilot) { B.push(0, -0.21, 0.006); band(0.122, 0.072, 0.074); B.pop(); }
    RUB();
    B.lathe(0, -0.39, 0, [[-0.045, 0.06, 0.066], [0.03, 0.064, 0.068]], P.boot, { n: 6 });                        // ankle cuff
    B.limb(0, -0.452, -0.04, 0, -0.462, 0.165, 0.062, 0.05, P.boot, { n: 6, sz: 0.8, end: 0.6 });                // boot
    B.box(0, -0.493, 0.055, 0.118, 0.03, 0.31, BLACK, { b: 0.012, edge: 0.1 });                                  // sole
    PLATE(); B.arc(0, -0.455, 0.12, 0.062, 0.075, -0.035, 0.03, -0.9, 0.9, P.accent, { thick: 0.012, n: 4 });    // toe cap
    B.socket('foot' + S, 0, -0.5, 0.04);
  }

  // ------------------------------------------------------------------- torso (origin at the waist)
  B.bone('torso', 'pelvis', 0, 0.12, 0);
  CLOTH();
  B.lathe(0, 0, 0, [[-0.02, 0.135, 0.1], [0.12, 0.138, 0.104], [0.28, 0.182, 0.124], [0.4, 0.188, 0.12], [0.455, 0.11, 0.09], [0.5, 0.062, 0.062]], P.suit, { n: 8, sq: 2.4 });
  PLATE();
  B.lathe(0, 0, 0.006, [[0.15, 0.148, 0.116], [0.27, 0.198, 0.142], [0.4, 0.204, 0.136], [0.452, 0.128, 0.1]], P.arm, { n: 8, sq: 2.6 });   // cuirass
  B.arc(0, 0, 0.008, 0.212, 0.158, 0.27, 0.42, -0.72, 0.72, P.armL, { thick: 0.02, n: 4, tr: 0.97 });            // breastplate
  B.arc(0, 0, 0, 0.152, 0.118, 0.03, 0.135, -0.95, 0.95, P.accent, { thick: 0.014, n: 5 });                      // abdomen plates
  B.arc(0, 0, 0, 0.212, 0.15, 0.25, 0.41, Math.PI - 0.6, Math.PI + 0.6, P.armL, { thick: 0.018, n: 4 });         // back plate
  for (const s of [1, -1]) {
    B.lathe(s * 0.228, 0.4, 0, [[-0.065, 0.098, 0.115], [0, 0.104, 0.12], [0.05, 0.08, 0.092], [0.078, 0.03, 0.035]], P.armL, { n: 8, r: [0, 0, s * -0.3], cap: 'bottom' });   // pauldron
    if (!pilot) B.box(s * 0.25, 0.485, 0, 0.05, 0.03, 0.15, P.arm, { b: 0.01, r: [0, 0, s * -0.3] });
    B.box(s * 0.09, 0.2, 0.128, 0.07, 0.085, 0.035, P.accent, {});                                     // mag pouches
  }
  B.lathe(0, 0, 0, [[0.44, 0.1, 0.092], [0.505, 0.085, 0.082]], DARK, { n: 8 });                                  // collar
  B.chan('glow').box(0, 0.35, 0.166, 0.09, 0.025, 0.012, GLOW).chan('a');                                        // chest light
  if (pilot) {
    band(0.142, 0.156, 0.124);
    // jetpack: twin rounded tanks + nozzles
    B.box(0, 0.29, -0.185, 0.24, 0.32, 0.1, P.arm, { b: 0.04 });
    for (const s of [1, -1]) {
      B.limb(s * 0.115, 0.1, -0.24, s * 0.115, 0.42, -0.24, 0.062, 0.058, P.armL, { n: 8 });
      GUN(); B.cyl(s * 0.115, 0.03, -0.24, 0.06, 0.09, DARK, { n: 8, r2: 0.042 }); PLATE();
      B.chan('jet').cyl(s * 0.115, -0.018, -0.24, 0.045, 0.01, mul3(lin(0x8fe9ff), 1), { n: 8 }).chan('a');
      B.chan('glow').box(s * 0.115, 0.3, -0.303, 0.022, 0.16, 0.008, mul3(GLOW, 0.8)).chan('a');
      B.socket('jet' + (s > 0 ? 'L' : 'R'), s * 0.115, -0.03, -0.24);
    }
    B.box(0, 0.46, -0.2, 0.16, 0.06, 0.1, P.accent, { b: 0.02 });
    // launcher slung across the back
    GUN(); B.cyl(0.02, 0.3, -0.335, 0.045, 0.72, P.gun, { n: 8, r: [0, 0, 0.7] }); B.cyl(-0.19, 0.5, -0.335, 0.058, 0.12, P.accent, { n: 8, r: [0, 0, 0.7] }); PLATE();
  } else {
    B.box(0, 0.27, -0.185, rocketeer ? 0.32 : 0.26, rocketeer ? 0.4 : 0.3, 0.12, P.accent, { b: 0.04 });
    B.limb(-0.08, 0.13, -0.2, 0.08, 0.13, -0.2, 0.05, 0.05, P.arm, { n: 6 });                                    // bedroll canister
    B.chan('glow').box(0, 0.31, -0.248, 0.11, 0.025, 0.008, GLOW).chan('a');
    if (rocketeer) for (const s of [-1, 0, 1]) { GUN(); B.cyl(s * 0.095, 0.5, -0.19, 0.033, 0.26, P.gun, { n: 6 }); B.cyl(s * 0.095, 0.67, -0.19, 0.038, 0.1, lin(0xd8a013), { n: 6, r2: 0.005, rough: 0.5, metal: 0.2 }); PLATE(); }
    if (ace) {
      // half-cape, tall antenna with pennant, command beacon
      CLOTH();
      B.arc(0.03, 0, -0.02, 0.2, 0.25, -0.42, 0.4, Math.PI - 0.75, Math.PI + 0.55, lin(0x4a0c10), { thick: 0.012, n: 5, tr: 0.72, edge: 0.1 });
      B.arc(0.03, 0, -0.02, 0.204, 0.254, -0.425, -0.39, Math.PI - 0.75, Math.PI + 0.55, BONE, { thick: 0.014, n: 5, tr: 0.995, edge: 0.1 });
      GUN(); B.tube(-0.12, 0.4, -0.2, -0.14, 1.3, -0.24, 0.012, DARK, { n: 4 });
      CLOTH(); B.box(-0.14, 1.2, -0.34, 0.015, 0.14, 0.2, lin(0xd9801a), { tz: 0.3, edge: 0 });
      B.chan('heat').box(-0.14, 1.32, -0.24, 0.05, 0.05, 0.05, mul3(P.glow, 1)).box(0, 0.43, 0.158, 0.2, 0.02, 0.012, mul3(P.glow, 0.8)).chan('a');
      PLATE();
    }
  }
  B.socket('cockpit', 0, 0.3, 0);

  // -------------------------------------------------------------------- head
  B.bone('head', 'torso', 0, 0.5, 0);
  CLOTH(); B.limb(0, -0.04, 0, 0, 0.05, 0, 0.052, 0.05, DARK, { n: 6, end: 0.1 });
  PLATE();
  const helm = pilot ? P.armL : P.arm;
  B.lathe(0, 0, 0, [[0.02, 0.092, 0.104], [0.07, 0.12, 0.134], [0.15, 0.128, 0.142], [0.225, 0.11, 0.124], [0.272, 0.068, 0.08], [0.29, 0.018, 0.022]], helm, { n: 10, sq: 2.2, edge: 0.3 });
  B.arc(0, 0, 0, 0.127, 0.142, 0.03, 0.105, -0.85, 0.85, DARK, { thick: 0.03, n: 4, tr: 1.0 });                  // jaw guard
  B.box(0, 0.045, 0.135, 0.07, 0.05, 0.04, P.accent, { b: 0.012 });                                              // rebreather
  for (const s of [1, -1]) { B.cyl(s * 0.128, 0.11, 0, 0.036, 0.03, DARK, { axis: 'x', n: 8 }); B.tube(s * 0.05, 0.04, 0.13, s * 0.1, 0.02, 0.06, 0.012, DARK, { n: 4 }); }
  B.arc(0, 0, 0, 0.136, 0.15, 0.188, 0.215, -1.05, 1.05, helm, { thick: 0.02, n: 5, tr: 0.97 });                 // brow ridge
  B.chan('glow');
  if (pilot) B.arc(0, 0, 0, 0.131, 0.146, 0.105, 0.188, -0.88, 0.88, mul3(GLOW, 0.75), { thick: 0, n: 6 });      // full visor
  else {
    B.arc(0, 0, 0, 0.131, 0.146, 0.125, 0.165, -0.8, 0.8, GLOW, { thick: 0, n: 6 });                             // slit
    if (ace) B.box(0, 0.16, 0.146, 0.034, 0.1, 0.012, GLOW);
    B.chan('a'); B.arc(0, 0, 0, 0.129, 0.144, 0.105, 0.188, -0.9, 0.9, DARK, { thick: 0.01, n: 6 }); B.chan('glow');
  }
  B.chan('a');
  if (pilot) { band(0.045, 0.112, 0.125, 0.012); B.box(0, 0.282, -0.02, 0.034, 0.03, 0.2, P.accent, { b: 0.012 }); B.tube(0.12, 0.16, -0.05, 0.125, 0.33, -0.07, 0.008, DARK, { n: 4 }); }
  else if (ace) B.box(0, 0.335, -0.04, 0.03, 0.12, 0.24, BONE, { b: 0.01, tz: 0.45, oz: -0.04, rough: 0.6, metal: 0.1 });   // crest
  else B.box(0, 0.28, -0.01, 0.05, 0.03, 0.2, P.armL, { b: 0.012 });
  B.socket('eye', 0, 0.14, 0.16);

  // ----------------------------------------------- arms + weapon: one rigid aiming assembly at the shoulder line
  B.bone('arms', 'torso', 0, 0.4, 0);
  const arm = (sx, ex, ey, ez, hx, hy, hz) => {
    CLOTH();
    B.limb(sx, 0, 0, ex, ey, ez, 0.06, 0.05, P.suit, { n: 6, flat: true });
    B.limb(ex, ey, ez, hx, hy, hz, 0.05, 0.04, P.suit, { n: 6, flat: true });
    PLATE();
    const a = 0.25, b = 0.82;
    B.limb(ex + (hx - ex) * a, ey + (hy - ey) * a, ez + (hz - ez) * a, ex + (hx - ex) * b, ey + (hy - ey) * b, ez + (hz - ez) * b, 0.06, 0.052, P.arm, { n: 6, flat: true });   // bracer
    B.lathe(ex, ey, ez, [[-0.045, 0.03], [-0.015, 0.058], [0.02, 0.058], [0.045, 0.03]], P.armL, { n: 6 });       // elbow cop
    RUB();
    const dx = hx - ex, dy = hy - ey, dz = hz - ez, l = Math.hypot(dx, dy, dz);
    B.limb(hx, hy, hz, hx + dx / l * 0.07, hy + dy / l * 0.07, hz + dz / l * 0.07, 0.042, 0.04, BLACK, { n: 6, sz: 0.8 });   // glove
  };
  arm(-0.235, -0.225, -0.21, 0.1, -0.09, -0.125, 0.28);       // right (trigger hand)
  arm(0.235, 0.2, -0.21, 0.2, 0.01, -0.135, 0.47);            // left (fore-grip)
  GUN();
  if (rocketeer) {
    B.cyl(-0.19, 0.08, 0.2, 0.062, 1.15, P.gun, { axis: 'z', n: 10 });
    B.cyl(-0.19, 0.08, 0.8, 0.082, 0.14, P.accent, { axis: 'z', n: 10 }); B.cyl(-0.19, 0.08, -0.38, 0.09, 0.1, DARK, { axis: 'z', n: 10, r2: 0.065 });
    B.cyl(-0.19, 0.08, 0.92, 0.058, 0.2, lin(0xd8a013), { axis: 'z', n: 8, r2: 0.005, rough: 0.5, metal: 0.2 });
    B.box(-0.19, 0.0, 0.3, 0.03, 0.12, 0.04, DARK, { b: 0.008 }); B.box(-0.12, 0.16, 0.25, 0.04, 0.07, 0.12, DARK, { b: 0.012 });
    B.socket('muzzleR', -0.19, 0.08, 1.02); B.socket('muzzleL', -0.19, 0.08, 1.02); B.socket('rocketPod', -0.19, 0.08, 1.02);
  } else {
    B.box(-0.07, -0.07, 0.36, 0.055, 0.11, 0.5, P.gun, { b: 0.016 });
    B.box(-0.07, -0.08, 0.04, 0.045, 0.09, 0.22, P.gun, { b: 0.016, tz: 0.8 });                // stock
    B.cyl(-0.07, -0.05, 0.76, 0.02, 0.36, DARK, { axis: 'z', n: 8 });
    B.cyl(-0.07, -0.05, 0.93, 0.03, 0.08, STEEL, { axis: 'z', n: 8 });
    B.cyl(-0.07, -0.05, 0.62, 0.034, 0.16, P.gun, { axis: 'z', n: 8 });                        // handguard
    B.box(-0.07, -0.17, 0.33, 0.04, 0.14, 0.07, P.gun, { r: [0.2, 0, 0], b: 0.01 });           // magazine
    B.cyl(-0.07, 0.015, 0.34, 0.024, 0.16, DARK, { axis: 'z', n: 8 });                         // optic
    B.chan('glow').cyl(-0.07, 0.015, 0.423, 0.017, 0.006, GLOW, { axis: 'z', n: 8 }).chan('a');
    if (pilot) B.box(-0.07, -0.1, 0.6, 0.05, 0.05, 0.2, P.accent, { b: 0.012 });
    B.socket('muzzleR', -0.07, -0.05, 0.98); B.socket('muzzleL', -0.07, -0.05, 0.98);
    B.socket('rocketPod', pilot ? -0.2 : -0.07, pilot ? 0.1 : -0.05, pilot ? 0.5 : 0.98);
  }
  B.socket('handR', -0.09, -0.125, 0.28); B.socket('handL', 0.01, -0.135, 0.47);
  return B.finish();
}

// death: knees buckle, the body folds, then it goes over and settles
const K_BUCKLE = [0, 0, 0.3, 1, 0.5, 0.92, 1, 1];
const K_FALL = [0.1, 0, 0.56, 1.07, 0.7, 0.96, 0.84, 1];
const K_LIMP = [0.15, 0, 0.75, 1];
const IDLE = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true };

export class Trooper extends Walker {
  constructor(kind, variant, bp, mats) {
    const glows = { glow: glowMat(), heat: glowMat(), jet: glowMat() };
    const inst = instantiate(bp, mats, glows);
    super(inst, TROOPER_CFG, 1);
    this.kind = kind; this.variant = variant; this.mats = mats; this.glows = glows;
    this.radius = 0.35; this.height = 1.8;
    this.n.torso.rotation.order = 'YXZ'; this.n.head.rotation.order = 'YXZ';
    this.flares = [];
    for (const k of ['jetL', 'jetR']) if (inst.sockets[k]) { const f = new THREE.Mesh(flareGeo(), mats.flare); f.position.copy(inst.sockets[k].position); f.visible = false; f.frustumCulled = false; this.n.torso.add(f); this.flares.push(f); }
    this.yaw = 0; this.pitch = 0; this.rec = 0; this.jet = 0; this.deathT = -1; this.fallDir = -1; this.fallRoll = 0; this.fallTw = 0; this.damage = 0; this.charge = 0;
    this.slideW = 0; this.rollT = -1; this.crouchW = 0;
    this.tp = { x: 0, v: 0 }; this.tr = { x: 0, v: 0 };
    this.glowK = variant === 'ace' ? 1.5 : 1;
    this.armsZ = this.n.arms.position.z;
    this.update(0, IDLE);
  }
  /** ace: 0..1 rig-call charge, lights the beacon */
  setCharge(p) { this.charge = clamp(p || 0, 0, 1); }
  trigger(name, arg) {
    switch (name) {
      case 'fireL': case 'fireR': this.rec = Math.min(1.2, this.rec + 0.7); break;
      case 'fireRocket': case 'fireAA': this.rec = 1.6; this.tp.v -= 3; break;
      case 'land': this.land(arg == null ? 0.6 : arg); break;
      case 'jump': this.dip.v -= 0.9; break;
      case 'roll': if (this.deathT < 0) this.rollT = 0; break;
      case 'hit': { const a = Math.random() * 6.283; this.tp.v += Math.cos(a) * 5; this.tr.v += Math.sin(a) * 5; break; }
      case 'death': if (this.deathT < 0) {
        this.deathT = 0; this.rollT = -1;
        this.fallDir = arg === 'fwd' ? 1 : arg === 'back' ? -1 : (Math.random() < 0.3 ? 1 : -1);
        this.fallRoll = (Math.random() - 0.5) * 0.9; this.fallTw = (Math.random() - 0.5) * 1.2;
      } break;
      case 'revive': case 'boot': this.deathT = -1; break;
    }
  }
  setDamage(d) {
    d = clamp(d || 0, 0, 1); this.damage = d;
    const A = this.inst.armor, m = this.mats.armor, mat = d > 0.85 ? m[2] : d > 0.45 ? m[1] : m[0];
    for (let i = 0; i < A.length; i++) A[i].material = mat;
  }
  update(dt, s) {
    const c = this.cfg, n = this.n;
    this.t += dt; const t = this.t;
    if (s.dead && this.deathT < 0) this.trigger('death');
    const dead = this.deathT >= 0; if (dead) this.deathT += dt;
    this.gait(dt, s, dead);
    const amp = this.amp, sN = Math.min(1, this.stride / c.strideMax), ph = this.phase, TAU = 6.2831853;
    spring(this.dip, 0, c.dipK, c.dipC, dt); spring(this.rol, 0, 120, 14, dt);
    spring(this.tp, 0, 140, 15, dt); spring(this.tr, 0, 140, 15, dt);
    if (this.dip.x < -0.45) this.dip.x = -0.45;
    this.rec = damp(this.rec, 0, 14, dt);
    if (!dead) {
      this.yaw = dampAngle(this.yaw, s.aimYaw || 0, 18, dt); this.pitch = damp(this.pitch, clamp(s.aimPitch || 0, -1.2, 1.3), 18, dt);
    }
    this.jet = damp(this.jet, dead ? 0 : (s.jet || 0), 14, dt);
    // ---- slide / roll / death weights ----------------------------------------------------
    const sl = this.slideW = damp(this.slideW, s.slide && !dead ? 1 : 0, s.slide ? 16 : 10, dt);
    const cr = (this.crouchW = damp(this.crouchW, dead ? 0 : clamp(s.crouch || 0, 0, 1), 11, dt)) * (1 - sl);
    let rollA = 0, tuck = 0;
    if (this.rollT >= 0) {
      this.rollT += dt;
      if (this.rollT >= ROLL_TIME) this.rollT = -1;
      else { const u = this.rollT / ROLL_TIME; rollA = TAU * (0.55 * u + 0.45 * u * u * (3 - 2 * u)); tuck = Math.pow(Math.sin(Math.PI * u), 0.6); }
    }
    const dT = dead ? this.deathT : 0, buckle = dead ? keys(dT, K_BUCKLE) : 0, fall = dead ? keys(dT, K_FALL) : 0, limp = dead ? keys(dT, K_LIMP) : 0;
    const fd = this.fallDir;
    if (tuck > this.air) this.air = tuck;
    const air = this.air;
    // ---- pelvis ------------------------------------------------------------------------------
    const breathe = Math.sin(t * 2.1) * 0.006;
    const bob = -c.bob * Math.cos(2 * TAU * ph) * amp * (0.4 + 0.6 * sN);
    const lean = clamp(this.gspeed * c.leanK * this.dz, -0.08, 0.2) * (1 - air) * (1 - sl);
    this.pit.x = damp(this.pit.x, lean, 8, dt);
    let py = c.hipH + (bob + this.dip.x + breathe) - amp * sN * 0.04;
    py += (0.6 - 0.5 * bob - py) * cr; py += (0.33 - py) * sl; py += (0.52 - py) * tuck; py += ((fd > 0 ? 0.5 : 0.4) - py) * buckle;
    const px = c.sway * Math.sin(TAU * (ph - 0.05)) * amp * (1 - sl) + buckle * 0.05 * this.fallRoll;
    const pz = -0.12 * sl - buckle * 0.1 * fd;
    const pRoll = (c.roll * Math.sin(TAU * (ph - 0.05)) * amp - this.dx * 0.05 * amp) * (1 - sl) + this.rol.x * 0.2 + sl * 0.12;
    const pYaw = c.yawSw * Math.sin(TAU * (ph - 0.25)) * amp * sN * (1 - sl) + sl * 0.25;
    const pPitch = this.pit.x * 0.5 + air * 0.1 * (1 - tuck) - sl * 0.78 + buckle * 0.25 * fd + cr * 0.12;
    // feet: slide = lead leg out front, trailing knee up; death = knees fold, one leg kicks out
    if (sl > 0.001 || dead || cr > 0.001) {
      const fx = this.fx, fy = this.fy, fz = this.fz, fp = this.fp;
      if (cr > 0.001) { fz[0] += 0.13 * cr; fz[1] -= 0.15 * cr; fx[0] += 0.04 * cr; fx[1] -= 0.04 * cr; }
      if (sl > 0.001) {
        fx[0] += (0.1 - fx[0]) * sl; fy[0] += (0.07 - fy[0]) * sl; fz[0] += (0.7 - fz[0]) * sl; fp[0] *= 1 - sl;
        fx[1] += (-0.15 - fx[1]) * sl; fy[1] += (0.0 - fy[1]) * sl; fz[1] += (0.3 - fz[1]) * sl; fp[1] *= 1 - sl;
      }
      // once the body is over, body-space -Y is 'along the ground away from the head': let the legs slide out flat
      if (dead) { fy[0] -= 0.3 * limp; fy[1] -= 0.14 * limp; fz[0] += (fd > 0 ? 0 : 0.06) * limp; fz[1] += (fd > 0 ? -0.25 : -0.08) * buckle * (1 - limp); fx[0] += 0.12 * limp; fx[1] -= 0.06 * limp; }
    }
    const vy = s.vy || 0;
    this.placeLegs(px, py, pz, pPitch, pRoll, pYaw, (c.hangY + clamp(vy * 0.012, -0.1, 0.08)) * (1 - tuck) + 0.4 * tuck, c.hangZ * (1 - tuck) + 0.16 * tuck, 0.5);
    // ---- torso: twist toward the aim, the head takes the rest -------------------------------------
    const yawT = clamp(wrapPi(this.yaw), -1.25, 1.25) * (1 - limp);
    const tor = n.torso;
    tor.rotation.y = yawT - pYaw * 0.8 + this.fallTw * limp;
    tor.rotation.x = this.pit.x + this.tp.x * 0.04 - this.pitch * 0.15 * (1 - tuck) + air * 0.08 * (1 - tuck) + sl * 0.5 + cr * 0.3 + tuck * 0.95 + buckle * (fd > 0 ? 0.55 : 0.3) - limp * (fd > 0 ? 0.3 : 0.45);
    tor.rotation.z = -pRoll * 0.7 + this.tr.x * 0.04 + this.fallRoll * 0.5 * limp;
    tor.position.y = 0.12 + breathe;
    const comp = sl * 0.28 - cr * 0.4;        // body leans back in the slide: keep the head and weapon level
    n.head.rotation.y = clamp(wrapPi(this.yaw - yawT), -1.0, 1.0) * (1 - limp) + this.fallTw * 0.6 * limp;
    n.head.rotation.x = (-this.pitch * 0.5 - this.pit.x * 0.5) * (1 - limp) + comp + tuck * 0.55 + buckle * 0.5 - limp * (fd > 0 ? 0.2 : 0.75);
    n.head.rotation.z = this.fallRoll * 0.5 * limp;
    const arms = n.arms;
    arms.rotation.x = (-this.pitch * 0.85 - this.pit.x * 0.8) * (1 - tuck) * (1 - limp) - this.rec * 0.07 + Math.sin(TAU * 2 * ph) * 0.03 * amp * sN + comp + tuck * 0.5
      + buckle * 0.7 + limp * (fd < 0 ? 0.85 : -1.9);
    arms.rotation.z = Math.sin(TAU * ph) * 0.03 * amp + this.fallTw * 0.35 * limp;
    arms.rotation.y = this.fallRoll * 0.6 * limp;
    arms.position.z = this.armsZ - this.rec * 0.035;
    // ---- whole body: roll about the body centre, or go over when dead ---------------------------------
    const body = n.body;
    if (dead) {
      body.rotation.x = fd * fall * 1.5; body.rotation.z = this.fallRoll * fall * 0.6;
      body.position.y = fall * (fd > 0 ? 0.3 : 0.12); body.position.z = fd * fall * (fd > 0 ? 0.2 : -0.1); body.position.x = 0;
    } else if (rollA > 0) {
      const h = 0.5;
      body.rotation.x = rollA; body.rotation.z = 0; body.position.set(0, h - h * Math.cos(rollA) - 0.06 * tuck, -h * Math.sin(rollA));
    } else if (body.rotation.x !== 0 || body.position.y !== 0) { body.rotation.set(0, 0, 0); body.position.set(0, 0, 0); }
    // ---- emissives ------------------------------------------------------------------------------------
    const live = dead ? Math.max(0, 1 - this.deathT * 1.6) * (Math.sin(t * 40) > -0.3 ? 1 : 0.3) : 1;
    this.glows.glow.color.setScalar(live * this.glowK * (1 + 0.08 * Math.sin(t * 3.1)));
    const ch = Math.max(this.charge, s.heat || 0);
    this.glows.heat.color.setScalar(live * (0.25 + ch * 4 * (0.75 + 0.25 * Math.sin(t * (6 + ch * 18)))));
    this.glows.jet.color.setScalar(0.05 + this.jet * 5);
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i];
      if (this.jet > 0.03) { f.visible = true; const k = 0.8 + 0.2 * Math.sin(t * 61 + i * 2); f.scale.set(c.flareR, c.flareLen * this.jet * k, c.flareR); } else f.visible = false;
    }
  }
  dispose() { this.root.removeFromParent(); this.glows.glow.dispose(); this.glows.heat.dispose(); this.glows.jet.dispose(); }
}
