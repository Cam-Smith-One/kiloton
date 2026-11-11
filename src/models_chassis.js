// ============================================================================
// KILOTON — models_chassis.js   OWNER: MODELS.
// The other two player chassis (the Warden lives in models_warden.js).
//   HARRIER — light skirmisher: long thin digitigrade legs, a small beaked
//             torso slung forward, slim arms, a huge swept twin-nacelle jet pack.
//   BASTION — siege rig: pillar legs on slab feet, a wide barrel torso with
//             shoulders up at head height, a small armoured cupola, tower pauldrons.
// Same bone names as the Warden so MechRig drives all three; hardpoints are the
// empty mount bones mArmL/mArmR/mShL/mShR/mBack.
// ============================================================================
import { Builder, lin, mul3 } from './models_kit.js';
import { panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, WHITE, STEEL, DARK, PA, G_ACC, G_SOFT, C_HEAT, C_JET } from './models_parts.js';

const H = Math.PI / 2;

export const HARRIER_CFG = {
  hipH: 4.35, hipX: 0.8, hipY: -0.1, l1: 1.6, l2: 1.65, meta: 1.35, am: 0.55, ankle: 0.38, homeX: 0.95, homeZ: 0.2,
  strideMax: 3.5, s0: 1.4, sk: 0.36, duty: 0.55, Tmin: 0.56, Tmax: 1.05, Tturn: 0.75, stepH: 0.95, toeLen: 0.9,
  bob: 0.17, sway: 0.12, roll: 0.035, yawSw: 0.11, leanK: 0.014, stepImpulse: 0.7, dipK: 105, dipC: 9, landV: 3.8,
  torsoY: 0.45, hangY: 3.35, hangZ: -0.6, deathDrop: 2.0, jetRest: 0.36, flareR: 0.5, flareLen: 3.4, heavy: true, reach: 3.8,
  modScale: 0.78, slots: ['armL', 'armR', 'shR', 'back'],
};
export const BASTION_CFG = {
  hipH: 5.0, hipX: 1.45, hipY: -0.1, l1: 2.1, l2: 2.1, meta: 0.55, am: 0.0, amAir: 0.1, ankle: 0.6, homeX: 1.6, homeZ: 0.15,
  strideMax: 3.2, s0: 1.3, sk: 0.4, duty: 0.64, Tmin: 1.15, Tmax: 1.9, Tturn: 1.5, stepH: 0.7, toeLen: 1.2,
  bob: 0.12, sway: 0.34, roll: 0.06, yawSw: 0.07, leanK: 0.01, stepImpulse: 1.7, dipK: 44, dipC: 7.5, landV: 5.2,
  torsoY: 0.8, hangY: 4.0, hangZ: -0.3, deathDrop: 2.5, jetRest: 0.4, flareR: 0.45, flareLen: 2.2, heavy: true, reach: 5.6,
  modScale: 1.22, slots: ['armL', 'armR', 'shL', 'shR', 'back'],
};

function fist(B, s, z, k, PAINT, FRAME, BARE) {
  FRAME(); B.box(0, -0.02 * k, z, 0.82 * k, 0.8 * k, 0.5 * k, PA.frame2, { b: 0.08 });
  PAINT();
  B.box(0, 0, z + 0.42 * k, 0.98 * k, 0.92 * k, 0.5 * k, PA.armL, { b: 0.11 });
  for (let i = 0; i < 3; i++) B.box((-0.245 + i * 0.245) * k, 0, z + 0.665 * k, 0.035 * k, 0.8 * k, 0.03, BLACK, { edge: 0 });
  BARE(); for (let i = 0; i < 4; i++) B.box((-0.37 + i * 0.245) * k, 0.3 * k, z + 0.65 * k, 0.16 * k, 0.16 * k, 0.1 * k, STEEL, { b: 0.03 });
  PAINT(); B.box(s * -0.5 * k, -0.12 * k, z + 0.22 * k, 0.22 * k, 0.4 * k, 0.6 * k, PA.arm, { b: 0.07 });
  hazard(B, 0, 0.462 * k, z + 0.42 * k, 0.8 * k, 0.12 * k, 'y+');
  B.socket('hand' + (s > 0 ? 'L' : 'R'), 0, 0, z + 0.77 * k);
}

// =============================================================================== HARRIER
export function buildHarrier() {
  const B = new Builder({ seed: 131, uvScale: 0.22, bevelK: 1.5 });
  const PAINT = () => B.mat(0.48, 0.38, 0.42), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);
  const C = PA, GLOW = G_ACC;
  B.bone('body', null, 0, 0, 0);
  B.bone('pelvis', 'body', 0, 4.35, 0);
  FRAME();
  B.box(0, 0, 0, 1.1, 0.6, 1.0, C.frame, { b: 0.09 });
  B.cyl(0, 0.34, 0, 0.55, 0.2, C.frame2, { n: 10 });
  for (const s of [1, -1]) B.cyl(s * 0.7, -0.1, 0, 0.4, 0.4, C.frame2, { axis: 'x', n: 10 });
  PAINT();
  B.box(0, -0.25, 0.5, 0.5, 0.8, 0.25, C.arm, { b: 0.06, bx: 0.4, r: [-0.2, 0, 0] });
  B.box(0, -0.1, -0.5, 0.7, 0.5, 0.25, C.armD, { b: 0.06 });
  strip(B, 0, -0.2, 0.64, 0.07, 0.4, [-0.2, 0, 0], GLOW);

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('hip' + S, 'pelvis', s * 0.8, -0.1, 0);
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.36, 0.45, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.8, 0, 0.36, 1.4, 0.45, C.frame, { b: 0.05 });
    B.piston(0, -0.2, -0.32, 0, -1.45, -0.22, 0.07, C.frame2, STEEL);
    PAINT();
    B.arc(s * 0.04, -0.7, 0.1, 0.36, 0.36, -0.7, 0.55, -1.0, 1.0, C.arm, { thick: 0.05, n: 6, tr: 1.2 });           // teardrop cuisse
    B.box(s * 0.26, -0.5, 0.02, 0.12, 1.1, 0.7, C.armL, { b: 0.04, bz: 0.55 });
    strip(B, s * 0.325, -0.5, 0.02, 0.5, 0.06, xf, GLOW);
    B.bone('shin' + S, 'thigh' + S, 0, -1.6, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.32, 0.62, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.82, -0.02, 0.3, 1.5, 0.36, C.frame, { b: 0.05 });
    B.piston(0, -0.15, -0.26, 0, -1.5, -0.24, 0.06, C.frame2, STEEL);
    PAINT();
    B.box(0, 0.12, 0.3, 0.5, 0.5, 0.3, C.armL, { b: 0.07, tx: 0.5, tz: 0.5 });                                       // knee spur
    B.arc(0, -0.8, 0.04, 0.32, 0.32, -0.7, 0.6, -1.0, 1.0, C.arm, { thick: 0.04, n: 6, tr: 1.25 });
    strip(B, 0, -0.8, 0.385, 0.06, 0.7, 'z+', GLOW);
    B.bone('meta' + S, 'shin' + S, 0, -1.65, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.27, 0.56, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.68, 0, 0.26, 1.15, 0.3, C.frame, { b: 0.04 });
    PAINT();
    B.box(0, -0.6, -0.2, 0.4, 1.2, 0.18, C.armL, { b: 0.05, tx: 0.7 });
    B.box(0, 0.25, -0.3, 0.3, 0.8, 0.2, C.arm, { b: 0.05, tx: 0.3, tz: 0.4, r: [0.45, 0, 0] });                      // long hock spur
    B.bone('foot' + S, 'meta' + S, 0, -1.35, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.25, 0.7, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.33, 0.25, 0.75, 0.1, 1.9, BLACK, { b: 0.03, edge: 0.1 });
    PAINT();
    B.box(0, -0.16, 0.1, 0.7, 0.3, 0.9, C.arm, { b: 0.07, tz: 0.7, tx: 0.8 });
    for (const t of [1, -1]) { B.box(t * 0.2, -0.2, 0.95, 0.28, 0.24, 1.0, C.armL, { b: 0.05, tz: 0.4, tx: 0.6, oz: -0.1, r: [0, t * -0.12, 0] }); }   // two long talons
    B.box(0, -0.2, -0.55, 0.3, 0.22, 0.55, C.armD, { b: 0.05, tz: 0.4, oz: 0.1 });
    hazard(B, 0, -0.008, 0.1, 0.5, 0.08, 'y+');
    B.socket('foot' + S, 0, -0.38, 0.2);
  }

  // torso: small, slung forward, ending in a beak
  B.bone('torso', 'pelvis', 0, 0.45, 0);
  FRAME();
  B.cyl(0, 0.08, 0, 0.55, 0.18, C.frame2, { n: 10 });
  B.box(0, 0.4, 0.05, 1.0, 0.6, 1.0, C.frame, { b: 0.08 });
  for (const s of [1, -1]) B.piston(s * 0.5, 0.1, -0.2, s * 0.7, 0.7, -0.35, 0.06, C.frame2, STEEL);
  PAINT();
  B.box(0, 1.15, 0.15, 2.0, 1.0, 1.9, C.arm, { b: 0.13, bx: 0.6, tx: 0.8, tz: 0.8 });                               // core
  B.box(0, 1.1, 1.5, 1.15, 0.75, 1.5, C.arm, { b: 0.1, tz: 0.25, tx: 0.45, bx: 0.8, oz: 0.25 });                    // beak
  B.box(0, 0.72, 1.35, 0.7, 0.2, 1.3, C.armD, { b: 0.05, tz: 0.4 });                                                // chin
  B.push(0, 1.25, 0.2, H, 0, 0); B.arc(0, 0, 0, 1.0, 0.55, -0.9, 1.0, Math.PI - 1.2, Math.PI + 1.2, C.armL, { thick: 0.06, n: 8 }); B.pop();   // rolled spine shell
  hazard(B, 0, 0.9, 2.2, 0.5, 0.1, [0.5, 0, 0]);
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    vent(B, s * 0.62, 1.05, 1.15, 0.4, 0.4, [0, s * 0.6, 0], 4, C.armD);
    panel(B, s * 0.92, 1.25, -0.1, 1.2, 0.4, xf, C.acc, 0.04, { edge: 0.5 });
    strip(B, s * 0.955, 0.95, -0.1, 1.0, 0.06, xf, GLOW);
    FRAME(); B.cyl(s * 1.02, 1.3, 0.1, 0.36, 0.4, C.frame2, { axis: 'x', n: 10 }); PAINT();
    B.box(s * 0.5, 1.72, -0.75, 0.5, 0.3, 0.6, C.frame2, { b: 0.06 });
  }
  stencil(B, 0, 1.8, -0.2, 'y+', GLYPH.K, 0.08);
  // sensor mast ("eye") under the beak
  FRAME(); B.box(0, 0.62, 1.95, 0.3, 0.22, 0.4, C.frame2, { b: 0.05 });
  B.chan('glow').box(0, 0.62, 2.16, 0.2, 0.1, 0.02, GLOW).chan('a');
  B.socket('eye', 0, 0.62, 2.2); B.socket('cockpit', 0, 1.2, 0.9);
  // back: spine, heat slats
  FRAME(); B.box(0, 1.1, -0.95, 1.0, 1.0, 0.4, C.frame, { b: 0.08 });
  B.chan('heat'); for (let i = 0; i < 4; i++) B.box(0, 0.8 + i * 0.2, -1.17, 0.7, 0.08, 0.03, C_HEAT); B.chan('a');
  B.tube(0.6, 1.9, -0.7, 0.7, 3.0, -1.0, 0.02, DARK, { n: 4 }); B.chan('glow').box(0.7, 3.02, -1.0, 0.05, 0.05, 0.05, GLOW).chan('a');
  B.bone('plateBack', 'torso', 0, 0, 0); PAINT();
  for (let i = 0; i < 4; i++) B.box(0, 0.76 + i * 0.2, -1.2, 0.9, 0.08, 0.16, C.armL, { r: [-0.6, 0, 0], edge: 0.5 });
  B.bone('plateChest', 'torso', 0, 0, 0); PAINT();
  B.box(0, 0.75, 0.62, 1.1, 0.4, 0.3, C.armL, { b: 0.06, bx: 0.6, r: [0.3, 0, 0] });

  // canopy: a long glowing strip along the top of the beak, hinged at the back
  B.bone('canopy', 'torso', 0, 1.62, 0.95);
  PAINT();
  B.box(0, 0.02, 0.1, 0.8, 0.1, 0.3, C.armL, { b: 0.04 });
  for (const s of [1, -1]) B.box(s * 0.36, -0.08, 0.75, 0.06, 0.08, 1.2, C.armD, { r: [0.2, s * -0.2, 0] });
  B.chan('glow');
  B.box(0, -0.06, 0.75, 0.62, 0.06, 1.15, G_SOFT, { tz: 1, tx: 1, bx: 1, r: [0.2, 0, 0], bz: 1 });
  B.box(0, -0.22, 1.38, 0.3, 0.2, 0.06, mul3(G_SOFT, 0.8), { r: [-0.5, 0, 0] });
  B.chan('a');

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('sh' + S, 'torso', s * 1.3, 1.3, 0.1);
    FRAME();
    B.cyl(0, 0, 0, 0.42, 0.45, C.frame2, { axis: 'x', n: 10 });
    B.box(s * 0.05, -0.62, 0, 0.36, 1.0, 0.45, C.frame, { b: 0.05 });
    B.piston(s * 0.05, -0.15, -0.3, s * 0.05, -1.05, -0.25, 0.06, C.frame2, STEEL);
    B.cyl(s * 0.05, -1.2, 0, 0.32, 0.56, C.frame2, { axis: 'x', n: 10 });
    PAINT();
    B.push(s * 0.12, 0.0, 0, 0, 0, H); B.arc(0, 0, 0, 0.52, 0.62, -0.32, 0.32, 0.2, Math.PI - 0.2, C.arm, { thick: 0.06, n: 8 }); B.pop();   // small round shoulder cap
    B.box(s * 0.46, -0.1, 0, 0.12, 0.8, 0.9, C.armL, { b: 0.04, bz: 0.5, r: [0, 0, s * 0.12] });
    strip(B, s * 0.53, -0.1, 0, 0.5, 0.06, [0, s * H, 0], GLOW);
    B.box(s * 0.22, -0.6, 0, 0.14, 0.8, 0.55, C.arm, { b: 0.04 });
    B.bone('fa' + S, 'sh' + S, s * 0.05, -1.2, 0);
    FRAME();
    B.box(0, 0, 0.8, 0.5, 0.52, 1.5, C.frame, { b: 0.06 });
    B.cyl(0, 0, 1.6, 0.26, 0.2, C.frame2, { axis: 'z', n: 10 });
    PAINT();
    B.box(0, 0.05, 0.85, 0.7, 0.68, 1.1, C.arm, { b: 0.08, tz: 0.8 });
    B.box(0, 0.42, 0.8, 0.45, 0.1, 0.8, C.armL, { b: 0.03 });
    B.box(0, 0.3, 0.12, 0.4, 0.5, 0.6, C.armL, { b: 0.06, tz: 0.2, oz: -0.3 });                                     // elbow blade
    fist(B, s, 1.78, 0.72, PAINT, FRAME, BARE);
    B.bone('mArm' + S, 'fa' + S, s * 0.6, 0.08, 0);
  }
  B.bone('mShR', 'torso', -0.55, 1.72, -0.75); B.bone('mBack', 'torso', 0, 1.75, -1.0);

  // the jet pack: two big swept nacelles with tail fins (the Harrier's signature from behind)
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('jet' + S, 'torso', s * 1.05, 1.5, -1.05);
    PAINT();
    B.box(0, 0.1, -0.1, 0.85, 2.1, 0.95, C.arm, { b: 0.12, tx: 0.7, tz: 0.7, bx: 0.9 });                            // nacelle
    B.arc(0, 0.2, -0.1, 0.48, 0.56, -0.9, 0.9, Math.PI - 1.1, Math.PI + 1.1, C.armL, { thick: 0.05, n: 6, tr: 0.75 });
    B.box(s * 0.25, 0.85, -0.6, 0.1, 1.0, 1.1, C.armL, { b: 0.04, tz: 0.3, oz: -0.45, r: [0, 0, s * -0.22] });        // tail fin
    panel(B, s * 0.31, 0.75, -0.6, 0.6, 0.5, [0, s * H, s * -0.22], C.acc, 0.02, { edge: 0.4 });
    B.box(0, 1.05, 0.25, 0.6, 0.4, 0.5, C.armD, { b: 0.07, tz: 0.4 });                                              // intake
    vent(B, 0, 1.05, 0.5, 0.45, 0.3, [-0.3, 0, 0], 3, C.armD);
    hazard(B, 0, -0.55, -0.565, 0.7, 0.14, 'z-');
    strip(B, 0, 0.3, -0.585, 0.07, 1.0, 'z-', GLOW);
    strip(B, s * 0.43, 0.2, -0.1, 0.07, 1.2, s > 0 ? 'x+' : 'x-', GLOW);
    BARE();
    B.cyl(0, -1.05, -0.1, 0.34, 0.3, DARK, { n: 10, rough: 0.4 });
    B.cyl(0, -1.4, -0.1, 0.56, 0.55, lin(0x33373c), { n: 10, r2: 0.36, rough: 0.35 });
    B.cyl(0, -1.66, -0.1, 0.58, 0.06, STEEL, { n: 10 });
    B.chan('jet').cyl(0, -1.6, -0.1, 0.46, 0.04, C_JET, { n: 10 }).chan('a');
    B.socket('jet' + S, 0, -1.7, -0.1);
  }
  return B.finish();
}

// =============================================================================== BASTION
export function buildBastion() {
  const B = new Builder({ seed: 173, uvScale: 0.18, bevelK: 1.5 });
  const PAINT = () => B.mat(0.52, 0.34, 0.42), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);
  const C = PA, GLOW = G_ACC;
  B.bone('body', null, 0, 0, 0);
  B.bone('pelvis', 'body', 0, 5.0, 0);
  FRAME();
  B.box(0, 0, 0, 2.6, 1.1, 1.9, C.frame, { b: 0.14 });
  B.cyl(0, 0.62, 0, 1.25, 0.3, C.frame2, { n: 12 });
  BARE(); B.cyl(0, 0.5, 0, 1.36, 0.1, STEEL, { n: 12 }); FRAME();
  for (const s of [1, -1]) B.cyl(s * 1.3, -0.1, 0, 0.72, 0.5, C.frame2, { axis: 'x', n: 10 });
  PAINT();
  B.box(0, -0.35, 1.0, 1.7, 1.5, 0.5, C.arm, { b: 0.1, bx: 0.7, r: [-0.1, 0, 0] });                                 // apron
  B.box(0, -0.2, -1.0, 1.9, 1.2, 0.45, C.armD, { b: 0.1, bx: 0.8 });
  B.box(0, 0.3, 1.1, 2.4, 0.36, 0.36, C.armL, { b: 0.07 });
  hazard(B, 0, 0.3, 1.285, 2.1, 0.2, 'z+');
  strip(B, 0, -0.5, 1.245, 0.12, 0.7, [-0.1, 0, 0], GLOW);
  bolts(B, 0, -1.0, 1.21, 1.0, 5, [-0.1, 0, 0], STEEL, 0.05);
  stencil(B, 0, -0.2, -1.235, 'z-', GLYPH.BAR3, 0.1);

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('hip' + S, 'pelvis', s * 1.45, -0.1, 0);
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.66, 0.8, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -1.05, 0, 0.85, 1.9, 0.95, C.frame, { b: 0.09 });
    B.piston(0, -0.3, -0.62, 0, -1.9, -0.5, 0.12, C.frame2, STEEL);
    PAINT();
    B.box(s * 0.05, -0.95, 0.3, 1.3, 1.9, 0.75, C.arm, { b: 0.13, bx: 0.9 });                                       // slab cuisse
    B.arc(s * 0.05, -0.95, 0.25, 0.7, 0.56, -0.9, 0.85, -1.0, 1.0, C.armL, { thick: 0.08, n: 6 });
    B.box(s * 0.68, -0.8, 0.0, 0.26, 2.1, 1.5, C.armL, { b: 0.09, bz: 0.8 });                                       // side skirt
    panel(B, s * 0.815, -0.5, 0, 1.0, 0.7, xf, C.acc, 0.04, { edge: 0.5 });
    strip(B, s * 0.82, -1.3, 0, 0.9, 0.09, xf, GLOW);
    hazard(B, s * 0.82, 0.0, 0, 1.2, 0.16, xf);
    bolts(B, s * 0.05, -0.15, 0.68, 0.9, 5, 'z+', STEEL, 0.05);
    B.box(s * 0.05, -0.9, -0.55, 1.1, 1.6, 0.36, C.armD, { b: 0.08 });
    B.bone('shin' + S, 'thigh' + S, 0, -2.1, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.6, 1.3, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -1.05, 0, 0.8, 1.9, 0.9, C.frame, { b: 0.08 });
    B.piston(0, -0.2, -0.56, 0, -1.9, -0.5, 0.11, C.frame2, STEEL);
    PAINT();
    B.box(0, 0.1, 0.55, 1.1, 0.8, 0.5, C.armL, { b: 0.12, tx: 0.85 });                                              // knee block
    hazard(B, 0, 0.1, 0.805, 0.8, 0.16, 'z+');
    B.box(0, -1.15, 0.4, 1.25, 1.8, 0.5, C.arm, { b: 0.12, bx: 1.12 });                                             // greave, flaring to the foot
    B.arc(0, -1.15, 0.3, 0.68, 0.5, -0.85, 0.8, -1.0, 1.0, C.armL, { thick: 0.07, n: 6, tr: 0.9 });
    B.box(s * 0.56, -1.1, 0, 0.2, 1.7, 1.1, C.armD, { b: 0.07 }); B.box(s * -0.52, -1.1, 0, 0.16, 1.6, 1.0, C.armD, { b: 0.06 });
    B.box(0, -1.1, -0.52, 1.0, 1.6, 0.3, C.arm, { b: 0.08 });
    strip(B, s * 0.665, -1.1, 0, 0.1, 1.1, xf, GLOW); strip(B, 0, -1.1, -0.675, 0.1, 0.9, 'z-', GLOW);
    B.bone('meta' + S, 'shin' + S, 0, -2.1, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.52, 1.2, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.28, 0, 0.8, 0.55, 0.9, C.frame, { b: 0.07 });
    B.bone('foot' + S, 'meta' + S, 0, -0.55, 0);
    FRAME();
    B.box(0, -0.53, 0.2, 1.9, 0.14, 2.9, BLACK, { b: 0.04, edge: 0.1 });
    PAINT();
    B.box(0, -0.22, 0.15, 1.8, 0.56, 2.3, C.arm, { b: 0.12, tx: 0.8, tz: 0.8 });                                    // slab foot
    B.box(0, 0.12, 0.1, 1.2, 0.3, 1.3, C.armL, { b: 0.09, tx: 0.8, tz: 0.7 });
    B.box(0, -0.28, 1.45, 1.7, 0.42, 0.5, C.armL, { b: 0.1, tz: 0.6 });                                             // toe bar
    hazard(B, 0, -0.26, 1.71, 1.4, 0.16, [0.25, 0, 0]);
    B.box(0, -0.3, -1.1, 1.3, 0.38, 0.4, C.armD, { b: 0.09 });
    for (const t of [1, -1]) B.piston(t * 0.7, 0.1, -0.5, t * 0.75, -0.2, -1.0, 0.08, C.frame2, STEEL);
    B.socket('foot' + S, 0, -0.6, 0.2);
  }

  // torso: a wide barrel with a sloped glacis; shoulders ride up at head height
  B.bone('torso', 'pelvis', 0, 0.8, 0);
  FRAME();
  B.cyl(0, 0.14, 0, 1.25, 0.28, C.frame2, { n: 12 });
  B.box(0, 0.5, 0, 2.6, 0.7, 2.0, C.frame, { b: 0.12 });
  for (const s of [1, -1]) { B.piston(s * 1.2, 0.15, -0.5, s * 1.6, 1.0, -0.7, 0.12, C.frame2, STEEL); B.tube(s * 0.8, 0.2, 0.95, s * 1.0, 0.9, 1.3, 0.09, DARK); }
  PAINT();
  B.box(0, 1.8, 0, 5.0, 2.1, 3.0, C.arm, { b: 0.18, bx: 0.78, bz: 0.85 });                                          // barrel
  B.box(0, 1.5, 1.55, 3.6, 1.8, 0.7, C.armL, { b: 0.14, bx: 0.7, tz: 0.6, r: [-0.28, 0, 0] });                      // glacis
  B.box(0, 0.75, 1.5, 2.4, 0.5, 0.8, C.arm, { b: 0.1, bx: 0.7, r: [0.4, 0, 0] });                                   // ram chin
  hazard(B, 0, 0.82, 1.92, 1.9, 0.18, [0.4, 0, 0]);
  B.box(0, 2.95, -0.1, 4.4, 0.3, 2.6, C.armL, { b: 0.1, tx: 0.92, tz: 0.9 });                                       // deck
  B.push(0, 2.3, 0.9, 0, 0, H); B.arc(0, 0, 0, 0.75, 0.9, -1.6, 1.6, -0.2, 1.5, C.arm, { thick: 0.1, n: 6 }); B.pop();   // rolled brow over the glacis
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    vent(B, s * 1.2, 1.55, 1.93, 0.8, 0.9, [-0.28, 0, 0], 6, C.armD);
    strip(B, s * 0.55, 1.5, 1.98, 0.1, 0.9, [-0.28, 0, 0], GLOW);
    panel(B, s * 2.47, 1.9, -0.1, 2.0, 1.0, xf, C.armD, 0.08);
    bolts(B, s * 2.56, 2.25, -0.1, 1.7, 6, xf, STEEL, 0.05);
    groove(B, s * 2.4, 1.2, -0.1, 2.2, 0.04, xf);
    FRAME(); B.cyl(s * 2.55, 2.0, 0, 0.75, 0.6, C.frame2, { axis: 'x', n: 10 }); PAINT();
    strip(B, s * 1.9, 3.105, -0.3, 0.1, 1.6, 'y+', GLOW);
    B.box(s * 1.6, 3.0, -0.2, 1.3, 0.25, 1.5, C.armD, { b: 0.06 });                                                 // mount plinth
  }
  hazard(B, 0, 3.105, -1.15, 2.6, 0.2, 'y+');
  stencil(B, 0, 3.11, 0.75, 'y+', GLYPH.K, 0.12);
  B.socket('cockpit', 0, 2.2, 0.8);
  // back: engine block, twin stacks
  FRAME();
  B.box(0, 1.7, -1.75, 2.8, 2.0, 0.7, C.frame, { b: 0.12 });
  B.box(0, 1.7, -2.08, 1.9, 1.5, 0.12, BLACK, { edge: 0 });
  B.chan('heat'); for (let i = 0; i < 6; i++) B.box(0, 1.1 + i * 0.24, -2.14, 1.7, 0.1, 0.04, C_HEAT); B.chan('a');
  B.cyl(0, 0.6, -1.3, 0.55, 2.2, C.frame2, { axis: 'x', n: 10 });
  for (const s of [1, -1]) {
    BARE(); B.cyl(s * 1.75, 3.1, -1.5, 0.22, 1.3, lin(0x2c2e31), { n: 8, r: [0.2, 0, 0] });
    B.chan('heat').cyl(s * 1.75, 3.74, -1.63, 0.16, 0.03, C_HEAT, { n: 8, r: [0.2, 0, 0] }).chan('a');
    PAINT(); B.box(s * 1.2, 1.7, -2.12, 0.26, 1.9, 0.3, C.armL, { b: 0.06 });
    strip(B, s * 2.2, 1.6, -1.335, 0.1, 1.3, [0.08, Math.PI, 0], GLOW);
  }
  hazard(B, 0, 0.8, -2.11, 1.6, 0.18, 'z-');
  B.bone('plateBack', 'torso', 0, 0, 0); PAINT();
  for (let i = 0; i < 6; i++) B.box(0, 1.05 + i * 0.24, -2.2, 2.0, 0.1, 0.22, C.armL, { r: [-0.6, 0, 0], edge: 0.5 });
  B.bone('plateChest', 'torso', 0, 0, 0); PAINT();
  B.box(0, 2.15, 1.72, 1.3, 0.5, 0.2, C.arm, { b: 0.07, r: [-0.28, 0, 0] });
  bolts(B, 0, 2.15, 1.83, 1.0, 4, [-0.28, 0, 0], STEEL, 0.05);

  // cupola: a small armoured head with a glowing slit, hatch hinges back
  FRAME(); B.cyl(0, 3.2, 0.5, 0.7, 0.24, C.frame2, { n: 10 });
  B.bone('canopy', 'torso', 0, 3.3, 0.0);
  PAINT();
  B.box(0, 0.32, 0.5, 1.3, 0.64, 1.3, C.arm, { b: 0.12, tx: 0.75, tz: 0.8 });
  B.arc(0, 0.3, 0.5, 0.72, 0.74, -0.1, 0.3, -1.3, 1.3, C.armL, { thick: 0.08, n: 6 });
  B.chan('glow').arc(0, 0.3, 0.5, 0.735, 0.755, 0.0, 0.16, -1.0, 1.0, G_SOFT, { thick: 0, n: 6 }).chan('a');
  B.box(0.45, 0.72, 0.3, 0.25, 0.2, 0.3, C.armD, { b: 0.04 });
  B.chan('glow').box(0.45, 0.72, 0.46, 0.14, 0.1, 0.02, GLOW).chan('a');
  B.socket('eye', 0.45, 0.72, 0.5);
  B.tube(-0.5, 0.6, 0.0, -0.55, 1.6, -0.2, 0.025, DARK, { n: 4 });

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('sh' + S, 'torso', s * 2.8, 2.0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.8, 0.8, C.frame2, { axis: 'x', n: 10 });
    B.box(s * 0.1, -1.0, 0, 0.9, 1.6, 1.0, C.frame, { b: 0.09 });
    B.piston(s * 0.1, -0.25, -0.65, s * 0.1, -1.7, -0.5, 0.12, C.frame2, STEEL);
    B.cyl(s * 0.1, -1.9, 0, 0.6, 1.1, C.frame2, { axis: 'x', n: 10 });
    PAINT();
    // tower pauldron: a tall slab box, top level with the cupola
    B.box(s * 0.25, 0.55, 0, 1.5, 1.9, 2.5, C.arm, { b: 0.16, tx: 0.85, tz: 0.85 });
    B.push(s * 0.3, 0.9, 0, 0, 0, H); B.arc(0, 0, 0, 0.75, 1.3, -0.7, 0.7, 0.25, Math.PI - 0.25, C.armL, { thick: 0.1, n: 8 }); B.pop();
    B.box(s * 1.08, 0.1, 0, 0.26, 2.5, 2.2, C.armL, { b: 0.1, bz: 0.75, r: [0, 0, s * 0.05] });                      // outer wall
    panel(B, s * 1.215, 0.6, 0, 1.4, 0.8, [0, s * H, 0], C.acc, 0.04, { edge: 0.5 });
    strip(B, s * 1.22, -0.3, 0, 1.6, 0.1, [0, s * H, 0], GLOW);
    stencil(B, s * 1.245, 0.6, 0, [0, s * H, 0], GLYPH.K, 0.11);
    hazard(B, s * 0.3, -0.2, 1.255, 1.4, 0.2, 'z+'); hazard(B, s * 0.3, -0.2, -1.255, 1.4, 0.2, 'z-');
    strip(B, s * 0.3, 0.9, 1.26, 1.1, 0.09, 'z+', GLOW);
    bolts(B, s * 0.3, 1.52, 0.9, 1.3, 5, 'y+', STEEL, 0.05);
    B.box(s * 0.42, -1.0, 0, 0.36, 1.4, 1.2, C.arm, { b: 0.08, bz: 0.85 });
    B.bone('fa' + S, 'sh' + S, s * 0.1, -1.9, 0);
    FRAME();
    B.box(0, 0, 1.2, 0.9, 0.9, 2.3, C.frame, { b: 0.09 });
    B.cyl(0, 0, 2.45, 0.46, 0.34, C.frame2, { axis: 'z', n: 10 });
    PAINT();
    B.box(0, 0.08, 1.35, 1.25, 1.2, 1.8, C.arm, { b: 0.13 });
    B.box(0, 0.74, 1.3, 0.9, 0.2, 1.4, C.armL, { b: 0.06, tz: 0.85 });
    hazard(B, 0, 0.85, 0.9, 0.7, 0.14, 'y+');
    B.box(0, 0.1, 0.3, 1.15, 1.15, 0.5, C.armD, { b: 0.1, bz: 0.7 });
    fist(B, s, 2.85, 1.25, PAINT, FRAME, BARE);
    B.bone('mArm' + S, 'fa' + S, s * 0.98, 0.15, 0);
  }
  B.bone('plateSh', 'shR', 0, 0, 0); PAINT();
  B.box(-0.6, 1.6, 0.7, 1.0, 0.25, 0.9, C.armL, { b: 0.08 });
  B.bone('mShL', 'torso', 1.6, 3.12, -0.2); B.bone('mShR', 'torso', -1.6, 3.12, -0.2); B.bone('mBack', 'torso', 0, 3.1, -1.55);

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('jet' + S, 'torso', s * 1.5, 1.0, -1.9);
    PAINT();
    B.box(0, 0, -0.1, 0.9, 0.9, 0.7, C.armD, { b: 0.1 });
    hazard(B, 0, 0.1, -0.455, 0.7, 0.14, 'z-');
    BARE();
    B.cyl(0, -0.7, -0.1, 0.5, 0.55, lin(0x33373c), { n: 10, r2: 0.32, rough: 0.35 });
    B.chan('jet').cyl(0, -0.94, -0.1, 0.42, 0.04, C_JET, { n: 10 }).chan('a');
    B.socket('jet' + S, 0, -1.0, -0.1);
  }
  return B.finish();
}
