// ============================================================================
// KILOTON — models_warden.js   OWNER: MODELS.
// The player's rig: WARDEN. Digitigrade heavy biped, broad asymmetric shoulders
// (rocket pod left, Skylance rack right), forearm pulse cannons over big fists,
// twin back jump jets, glowing teal canopy. Geometry only; animation lives in
// models_biped.js.
// ============================================================================
import { Builder, lin, mul3 } from './models_kit.js';
import { face, unface, panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, YELLOW, WHITE, STEEL, DARK, PA, G_ACC, G_SOFT, C_HEAT, C_JET } from './models_parts.js';

const C = { arm: PA.arm, armL: PA.armL, armD: PA.armD, frame: PA.frame, frame2: PA.frame2, teal: PA.acc, white: WHITE, rocket: PA.rocket, red: PA.red };
const GLOW = G_ACC, GLOW_SOFT = G_SOFT, HEAT = C_HEAT, JET = C_JET;

export const WARDEN_CFG = {
  hipH: 4.25, hipX: 1.15, hipY: -0.15, l1: 1.7, l2: 1.7, meta: 1.25, am: 0.6, ankle: 0.5, homeX: 1.3, homeZ: 0.25,
  strideMax: 3.3, s0: 1.3, sk: 0.42, duty: 0.6, Tmin: 0.82, Tmax: 1.45, Tturn: 1.1, stepH: 0.85, toeLen: 1.2,
  bob: 0.13, sway: 0.2, roll: 0.045, yawSw: 0.09, leanK: 0.012, stepImpulse: 1.15, dipK: 62, dipC: 8.5,
  torsoY: 0.65, shX: 2.05, shY: 2.0, upper: 1.5, hangY: 3.3, hangZ: -0.5, deathDrop: 2.15,
  jetRest: 0.5, flareR: 0.42, flareLen: 2.6, heavy: true, reach: 4.6, modScale: 1, slots: ['armL', 'armR', 'shL', 'shR', 'back'],
};

export function buildWarden() {
  const B = new Builder({ seed: 11, uvScale: 0.2, bevelK: 1.5 });
  const PAINT = () => B.mat(0.5, 0.35, 0.42), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);

  // ------------------------------------------------------------------ pelvis
  B.bone('body', null, 0, 0, 0);
  B.bone('pelvis', 'body', 0, 4.25, 0);
  FRAME();
  B.box(0, 0, 0, 1.75, 0.9, 1.5, C.frame, { b: 0.12 });
  B.cyl(0, 0.52, 0, 0.92, 0.26, C.frame2, { n: 12 });                          // waist bearing
  B.cyl(0, 0.42, 0, 1.02, 0.1, STEEL, { n: 12, rough: 0.25, metal: 1 });
  for (const s of [1, -1]) {
    B.cyl(s * 0.98, -0.15, 0, 0.58, 0.5, C.frame2, { axis: 'x', n: 10 });      // hip housing
    BARE(); B.cyl(s * 1.2, -0.15, 0, 0.3, 0.2, STEEL, { axis: 'x', n: 8 }); FRAME();
    B.tube(s * 0.5, 0.3, -0.7, s * 0.9, -0.3, -0.55, 0.07, DARK);              // hydraulic lines
    B.tube(s * 0.35, 0.3, -0.72, s * 0.75, -0.4, -0.6, 0.05, C.frame2);
  }
  PAINT();
  B.box(0, -0.28, 0.82, 0.95, 1.15, 0.42, C.arm, { b: 0.08, bx: 0.55, r: [-0.16, 0, 0] });     // front codpiece
  B.box(0, -0.2, -0.8, 1.1, 0.95, 0.4, C.arm, { b: 0.08, bx: 0.6, r: [0.14, 0, 0] });         // rear plate
  B.box(0, 0.22, 0.86, 1.5, 0.3, 0.3, C.armL, { b: 0.06 });
  hazard(B, 0, 0.22, 1.012, 1.3, 0.16, 'z+');
  strip(B, 0, -0.3, 1.0, 0.1, 0.5, [-0.16, 0, 0], GLOW);
  groove(B, 0, -0.2, -1.0, 0.9, 0.03, [0.14, Math.PI, 0]);
  stencil(B, 0, -0.38, -1.03, [0.14, Math.PI, 0], GLYPH.BAR3, 0.07);
  for (const s of [1, -1]) panel(B, s * 0.89, 0.05, 0, 1.1, 0.5, s > 0 ? 'x+' : 'x-', C.armD, 0.06);

  // -------------------------------------------------------------------- legs
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('hip' + S, 'pelvis', s * 1.15, -0.15, 0);
    // thigh: 1.7 long along -Y
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.5, 0.62, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.85, 0, 0.62, 1.5, 0.75, C.frame, { b: 0.08 });
    B.piston(0, -0.25, -0.52, 0, -1.55, -0.3, 0.1, C.frame2, STEEL);
    B.piston(s * -0.25, -0.2, 0.45, s * -0.25, -1.45, 0.4, 0.07, C.frame2, STEEL);
    B.tube(s * -0.33, -0.2, -0.2, s * -0.33, -1.6, -0.1, 0.05, DARK);
    PAINT();
    B.box(s * 0.08, -0.72, 0.3, 0.95, 1.55, 0.55, C.arm, { b: 0.1, bx: 0.78, r: [-0.05, 0, 0] });           // front thigh armour
    B.box(s * 0.08, -1.42, 0.5, 0.8, 0.5, 0.4, C.armL, { b: 0.08, tx: 0.85, r: [0.35, 0, 0] });             // knee guard upper
    B.arc(s * 0.08, -0.72, 0.2, 0.5, 0.43, -0.66, 0.56, -0.95, 0.95, C.armL, { thick: 0.06, n: 6, tr: 1.1 });                 // curved cuisse
    groove(B, s * 0.08, -0.5, 0.585, 0.8, 0.03, [-0.05, 0, 0]);
    groove(B, s * 0.08, -1.0, 0.56, 0.7, 0.03, [-0.05, 0, 0]);
    bolts(B, s * 0.08, -0.12, 0.6, 0.6, 4, [-0.05, 0, 0]);
    B.box(s * 0.36, 0.25, 0, 0.5, 0.75, 1.25, C.armL, { b: 0.1, tz: 0.7 });                                   // hip cap
    hazard(B, s * 0.615, 0.2, 0, 0.9, 0.14, s > 0 ? 'x+' : 'x-');
    // rear thigh fairing
    B.box(s * 0.05, -0.65, -0.44, 0.8, 1.15, 0.32, C.arm, { b: 0.08, bx: 0.8 });
    strip(B, s * 0.05, -0.65, -0.602, 0.07, 0.6, 'z-', GLOW);

    // detachable outer thigh slab (damage plate)
    B.bone('plateTh' + S, 'thigh' + S, 0, 0, 0);
    PAINT();
    B.box(s * 0.5, -0.75, 0.08, 0.22, 1.45, 1.15, C.armL, { b: 0.07, bz: 0.8, r: [0, 0, s * 0.03] });
    panel(B, s * 0.615, -0.45, 0.08, 0.7, 0.5, s > 0 ? 'x+' : 'x-', C.teal, 0.03, { edge: 0.5 });
    strip(B, s * 0.62, -1.05, 0.08, 0.6, 0.07, s > 0 ? 'x+' : 'x-', GLOW);
    bolts(B, s * 0.62, -0.1, 0.08, 0.8, 4, s > 0 ? 'x+' : 'x-');
    stencil(B, s * 0.635, -0.45, 0.08, s > 0 ? 'x+' : 'x-', GLYPH.BAR3, 0.07);

    // shin: 1.7 long along -Y (in pose it runs back and down)
    B.bone('shin' + S, 'thigh' + S, 0, -1.7, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.44, 0.95, C.frame2, { axis: 'x', n: 10 });
    BARE(); B.cyl(s * 0.5, 0, 0, 0.2, 0.08, STEEL, { axis: 'x', n: 8 }); FRAME();
    B.box(0, -0.85, -0.05, 0.52, 1.5, 0.6, C.frame, { b: 0.07 });
    B.piston(0, -0.15, -0.4, 0, -1.5, -0.38, 0.09, C.frame2, STEEL);
    B.tube(s * 0.3, -0.1, 0.1, s * 0.3, -1.6, 0.1, 0.045, DARK);
    PAINT();
    B.box(0, 0.12, 0.42, 0.82, 0.62, 0.42, C.armL, { b: 0.1, tx: 0.8, bx: 0.9 });                             // knee cap
    B.box(0, -0.85, 0.32, 0.92, 1.4, 0.36, C.arm, { b: 0.09, bx: 0.72 });
    B.box(0, -0.8, -0.38, 0.7, 1.2, 0.26, C.armD, { b: 0.07, bx: 0.75 });                                       // shin plate
    B.box(s * 0.4, -0.8, 0, 0.16, 1.25, 0.8, C.armL, { b: 0.05, bz: 0.8 });
    B.box(s * -0.36, -0.8, 0, 0.12, 1.1, 0.7, C.armD, { b: 0.04 });
    B.arc(0, -0.85, 0.1, 0.5, 0.45, -0.66, 0.64, -1.05, 1.05, C.armL, { thick: 0.06, n: 6, tr: 1.06 });                       // curved shin shell
    groove(B, 0, -0.5, 0.505, 0.7, 0.03, 'z+'); groove(B, 0, -1.1, 0.505, 0.55, 0.03, 'z+');
    strip(B, s * 0.485, -0.8, 0.0, 0.08, 0.8, s > 0 ? 'x+' : 'x-', GLOW);
    hazard(B, 0, 0.12, 0.635, 0.5, 0.12, 'z+');

    // metatarsus: 1.25 long along -Y (leans forward to the ankle)
    B.bone('meta' + S, 'shin' + S, 0, -1.7, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.38, 0.85, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.62, 0, 0.46, 1.0, 0.5, C.frame, { b: 0.06 });
    B.piston(0, -0.1, 0.32, 0, -1.1, 0.3, 0.07, C.frame2, STEEL);
    PAINT();
    B.box(0, -0.55, -0.28, 0.8, 1.2, 0.3, C.arm, { b: 0.08, tx: 0.8 });
    B.box(0, -0.6, 0.2, 0.62, 0.9, 0.22, C.armD, { b: 0.06 });                                    // rear greave
    B.box(0, 0.1, -0.42, 0.5, 0.6, 0.3, C.armL, { b: 0.07, tx: 0.4, tz: 0.5, r: [0.5, 0, 0] });               // hock spur
    groove(B, 0, -0.6, -0.435, 0.6, 0.03, 'z-');

    // foot: origin at the ankle, sole at y = -0.5
    B.bone('foot' + S, 'meta' + S, 0, -1.25, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.34, 1.0, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.44, 0.2, 1.1, 0.12, 2.3, RUBBERISH, { b: 0.03, edge: 0.1 });                                  // sole
    PAINT();
    B.box(0, -0.2, 0.1, 1.2, 0.42, 1.25, C.arm, { b: 0.09, tz: 0.82, tx: 0.9 });                              // main block
    B.box(0, 0.08, 0.3, 0.8, 0.3, 0.7, C.armL, { b: 0.07, tz: 0.6, oz: 0.12 });                               // instep armour
    for (const t of [1, -1]) {
      B.box(t * 0.33, -0.22, 1.05, 0.5, 0.38, 0.95, C.armL, { b: 0.08, tz: 0.7, tx: 0.85, oz: -0.1 });        // toes
      B.box(t * 0.33, -0.3, 1.52, 0.4, 0.22, 0.22, C.armD, { b: 0.05 });
      hazard(B, t * 0.33, -0.022, 0.98, 0.34, 0.1, 'y+');
    }
    B.box(0, -0.24, -0.78, 0.55, 0.34, 0.75, C.armD, { b: 0.08, tz: 0.6, tx: 0.8, oz: 0.12 });                // heel spur
    B.tube(0.4 * s, 0.05, -0.2, 0.4 * s, -0.25, -0.6, 0.05, DARK);
    bolts(B, 0, 0.012, -0.25, 0.8, 4, 'y+');
    B.socket('foot' + S, 0, -0.5, 0.25);
  }

  // ------------------------------------------------------------------- torso
  B.bone('torso', 'pelvis', 0, 0.65, 0);
  FRAME();
  B.cyl(0, 0.12, 0, 0.9, 0.24, C.frame2, { n: 12 });
  B.box(0, 0.5, 0, 1.7, 0.75, 1.5, C.frame, { b: 0.1 });                                                     // abdomen
  for (let i = 0; i < 3; i++) B.box(0, 0.28 + i * 0.22, 0.78, 1.2 - i * 0.05, 0.16, 0.12, C.frame2, { b: 0.03, edge: 0.4 });
  for (const s of [1, -1]) {
    B.tube(s * 0.6, 0.2, 0.7, s * 0.75, 0.95, 0.85, 0.07, DARK); B.tube(s * 0.45, 0.2, 0.74, s * 0.5, 0.95, 0.9, 0.05, C.frame2);
    B.piston(s * 0.8, 0.15, -0.3, s * 1.05, 0.95, -0.4, 0.09, C.frame2, STEEL);
  }
  PAINT();
  // main chest: wide wedge, narrower at the waist
  B.box(0, 1.55, 0.0, 3.1, 1.55, 2.3, C.arm, { b: 0.14, bx: 0.72, bz: 0.82 });
  B.box(0, 2.42, -0.2, 2.7, 0.36, 1.9, C.armL, { b: 0.1, tx: 0.9, tz: 0.9 });                                // upper deck
  // cockpit prow
  B.box(0, 1.5, 1.3, 1.6, 1.25, 0.9, C.arm, { b: 0.1, bx: 0.7, tz: 0.75, oz: -0.1 });
  B.box(0, 0.98, 1.38, 1.2, 0.3, 0.7, C.armL, { b: 0.08, bx: 0.7, r: [0.35, 0, 0] });                        // chin
  hazard(B, 0, 1.02, 1.74, 0.9, 0.12, [0.35, 0, 0]);
  for (const s of [1, -1]) {
    B.box(s * 1.18, 1.7, 0.98, 0.9, 1.1, 0.5, C.armL, { b: 0.09, tz: 0.8, r: [0, s * 0.3, 0] });             // cheek armour
    vent(B, s * 1.24, 1.72, 1.2, 0.5, 0.6, [0, s * 0.3, 0], 5, C.armD);
    strip(B, s * 0.84, 1.25, 1.66, 0.07, 0.42, [0, s * 0.1, 0], GLOW);
    groove(B, s * 1.2, 1.25, 1.07, 0.6, 0.03, [0, s * 0.3, 0]);
    // collar
    B.box(s * 0.82, 2.3, 0.95, 0.5, 0.35, 0.9, C.armD, { b: 0.07, tz: 0.7 });
    // side of chest
    panel(B, s * 1.52, 1.75, -0.1, 1.5, 0.75, s > 0 ? 'x+' : 'x-', C.armD, 0.07);
    groove(B, s * 1.47, 1.2, -0.1, 1.5, 0.03, s > 0 ? 'x+' : 'x-');
    bolts(B, s * 1.6, 2.02, -0.1, 1.2, 5, s > 0 ? 'x+' : 'x-');
    // shoulder trunnion
    FRAME(); B.cyl(s * 1.62, 2.0, 0, 0.52, 0.5, C.frame2, { axis: 'x', n: 10 }); PAINT();
    // top deck rails + strips (the chase camera sees these)
    strip(B, s * 1.12, 2.605, -0.45, 0.07, 1.1, 'y+', GLOW);
    B.box(s * 0.6, 2.63, -0.2, 0.08, 0.08, 1.5, C.armD, { b: 0.02 });
  }
  // top hatch + deck detail
  panel(B, 0, 2.6, 0.25, 0.9, 0.7, 'y+', C.armD, 0.06);
  bolts(B, 0, 2.66, 0.55, 0.7, 4, 'y+'); bolts(B, 0, 2.66, -0.05, 0.7, 4, 'y+');
  B.box(0.28, 2.7, 0.25, 0.1, 0.06, 0.4, STEEL, { rough: 0.3, metal: 1 });
  hazard(B, 0, 2.602, -0.95, 1.6, 0.16, 'y+');
  stencil(B, 0, 2.61, -0.55, 'y+', GLYPH.W7, 0.085);
  // sensor cluster ("eye"), right of the canopy
  B.box(-0.98, 2.42, 1.05, 0.42, 0.34, 0.5, C.armD, { b: 0.06 });
  FRAME(); B.cyl(-0.98, 2.42, 1.32, 0.13, 0.12, BLACK, { axis: 'z', n: 8 }); PAINT();
  B.chan('glow').cyl(-0.98, 2.42, 1.385, 0.09, 0.02, GLOW, { axis: 'z', n: 8 }).chan('a');
  B.box(-0.72, 2.3, 1.22, 0.14, 0.14, 0.3, DARK, { b: 0.02 });
  B.socket('eye', -0.98, 2.42, 1.42);
  B.socket('cockpit', 0, 1.75, 1.0);
  // back: reactor, drum, spine
  FRAME();
  B.box(0, 1.5, -1.22, 1.7, 1.7, 0.6, C.frame, { b: 0.1 });
  B.box(0, 1.5, -1.5, 1.1, 1.3, 0.12, BLACK, { edge: 0, rough: 0.9, metal: 0.2 });                           // core recess
  B.chan('heat'); for (let i = 0; i < 5; i++) B.box(0, 1.0 + i * 0.25, -1.55, 0.95, 0.11, 0.04, HEAT); B.chan('a');
  B.cyl(0, 0.52, -0.98, 0.42, 1.5, C.frame2, { axis: 'x', n: 10 });                                          // ammo drum
  BARE(); for (const s of [1, -1]) B.cyl(s * 0.78, 0.52, -0.98, 0.46, 0.08, STEEL, { axis: 'x', n: 10 }); FRAME();
  for (const s of [1, -1]) {
    B.tube(s * 0.25, 0.9, -1.45, s * 0.3, 0.2, -0.85, 0.08, DARK);
    B.tube(s * 0.62, 2.2, -1.3, s * 0.95, 2.45, -0.9, 0.07, DARK);
    B.box(s * 0.92, 1.85, -1.2, 0.5, 0.9, 0.5, C.frame2, { b: 0.06 });                                       // jet mounts
  }
  PAINT();
  for (const s of [1, -1]) {
    B.box(s * 0.72, 1.5, -1.52, 0.2, 1.6, 0.22, C.armL, { b: 0.05 });                                        // core frame rails
    strip(B, s * 1.38, 1.35, -0.985, 0.08, 0.9, [0.105, Math.PI, 0], GLOW);                                  // rear edge lights
    panel(B, s * 1.12, 0.92, -0.86, 0.5, 0.3, [0.105, Math.PI, 0], C.armD, 0.05);
  }
  B.box(0, 2.3, -1.38, 1.7, 0.22, 0.4, C.armL, { b: 0.06 });
  hazard(B, 0, 0.72, -1.47, 0.9, 0.14, 'z-');
  B.box(0, 0.72, -1.4, 1.0, 0.24, 0.14, C.armD, { b: 0.04 });
  // whip antenna + comms mast (back right)
  FRAME(); B.box(-1.25, 2.72, -0.95, 0.2, 0.25, 0.2, C.frame2, { b: 0.04 }); B.tube(-1.25, 2.8, -0.95, -1.32, 4.1, -1.1, 0.025, DARK, { n: 4 });
  B.chan('glow').box(-1.32, 4.12, -1.1, 0.06, 0.06, 0.06, GLOW).chan('a');

  // detachable chest + back plates (blown off by damage, exposing the frame / the reactor)
  B.bone('plateChest', 'torso', 0, 0, 0); PAINT();
  B.box(0.98, 1.05, 0.72, 0.9, 0.5, 0.5, C.armL, { b: 0.08, bx: 0.8, r: [0.2, 0.25, 0] });
  B.box(-0.98, 1.05, 0.72, 0.9, 0.5, 0.5, C.armL, { b: 0.08, bx: 0.8, r: [0.2, -0.25, 0] });
  B.bone('plateBack', 'torso', 0, 0, 0); PAINT();
  for (let i = 0; i < 5; i++) B.box(0, 0.95 + i * 0.25, -1.6, 1.25, 0.1, 0.2, C.armL, { r: [-0.6, 0, 0], b: 0.02, edge: 0.5 });   // louvres over the core
  B.box(0, 2.14, -1.56, 1.3, 0.14, 0.2, C.arm, { b: 0.04 }); B.box(0, 0.86, -1.56, 1.3, 0.1, 0.2, C.arm, { b: 0.03 });

  // ------------------------------------------------------------------ canopy
  B.bone('canopy', 'torso', 0, 2.42, 0.95);        // hinge at the top rear of the prow; glass runs forward and down
  PAINT();
  B.box(0, 0.02, 0.3, 1.25, 0.14, 0.75, C.armL, { b: 0.05, tz: 0.9 });                                       // hood
  B.push(0, -0.12, 0.3, 0, 0, Math.PI / 2); B.arc(0, 0, 0, 0.26, 0.5, -0.66, 0.66, 0.35, Math.PI - 0.5, C.arm, { thick: 0.05, n: 6 }); B.pop();
  for (const s of [1, -1]) B.box(s * 0.6, -0.33, 0.52, 0.09, 0.75, 0.12, C.armD, { r: [-0.55, 0, s * -0.12], b: 0.02 });
  B.box(0, -0.33, 0.6, 0.07, 0.75, 0.1, C.armD, { r: [-0.55, 0, 0], b: 0.02 });
  B.box(0, -0.68, 0.78, 1.15, 0.1, 0.16, C.armD, { b: 0.03 });
  B.chan('glow');
  B.box(0, -0.33, 0.5, 1.1, 0.72, 0.1, GLOW_SOFT, { r: [-0.55, 0, 0], bx: 0.92 });                           // front glass
  for (const s of [1, -1]) B.box(s * 0.62, -0.36, 0.22, 0.06, 0.6, 0.6, mul3(GLOW_SOFT, 0.8), { r: [-0.2, 0, 0] });
  B.chan('a');

  // -------------------------------------------------------------------- arms
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('sh' + S, 'torso', s * 2.05, 2.0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.6, 0.6, C.frame2, { axis: 'x', n: 10 });
    B.box(s * 0.1, -0.8, 0, 0.66, 1.25, 0.8, C.frame, { b: 0.08 });                                          // upper arm
    B.piston(s * 0.1, -0.2, -0.5, s * 0.1, -1.35, -0.4, 0.09, C.frame2, STEEL);
    B.tube(s * -0.25, -0.2, 0.3, s * -0.2, -1.4, 0.35, 0.06, DARK);
    B.cyl(s * 0.1, -1.5, 0, 0.46, 0.85, C.frame2, { axis: 'x', n: 10 });                                     // elbow
    BARE(); B.cyl(s * 0.56, -1.5, 0, 0.2, 0.06, STEEL, { axis: 'x', n: 8 });
    PAINT();
    B.box(s * 0.3, -0.75, 0, 0.3, 1.1, 0.95, C.arm, { b: 0.07, bz: 0.85 });                                  // bicep plate
    groove(B, s * 0.455, -0.75, 0, 0.8, 0.03, s > 0 ? 'x+' : 'x-');
    // pauldron: big sloped slab
    B.box(s * 0.32, 0.42, 0, 1.6, 0.85, 2.1, C.arm, { b: 0.14, tx: 0.72, tz: 0.8, ox: s * -0.12 });
    B.box(s * 0.2, 0.9, 0, 1.0, 0.2, 1.5, C.armL, { b: 0.07, tx: 0.85, tz: 0.85 });
    B.push(s * 0.32, 0.2, 0, 0, 0, Math.PI / 2); B.arc(0, 0, 0, 0.83, 1.1, -0.42, 0.42, 0.32, Math.PI - 0.32, C.armL, { thick: 0.08, n: 8 }); B.pop();   // rolled shoulder shell
    panel(B, s * 0.3, 0.845, 0.72, 0.9, 0.3, [-1.25, 0, 0], C.teal, 0.03, { edge: 0.5 });                     // teal paint band front
    panel(B, s * 0.3, 0.845, -0.72, 0.9, 0.3, [-1.9, 0, 0], C.teal, 0.03, { edge: 0.5 });                     // and rear
    hazard(B, s * 0.3, 0.26, -1.055, 1.2, 0.16, 'z-');
    strip(B, s * 0.3, 0.3, 1.055, 0.9, 0.07, 'z+', GLOW);
    bolts(B, s * 0.2, 1.01, 0, 1.1, 5, 'y+', STEEL, 0.04, Math.PI / 2);
    // outer skirt
    B.box(s * 1.06, -0.05, 0, 0.24, 1.25, 1.85, C.armL, { b: 0.08, bz: 0.75, r: [0, 0, s * 0.1] });
    strip(B, s * 1.2, -0.05, 0, 1.1, 0.08, [0, s * Math.PI / 2, 0], GLOW);
    stencil(B, s * 1.16, 0.3, 0, [0, s * Math.PI / 2, 0], s > 0 ? GLYPH.W7 : GLYPH.ARROW, 0.075);
    groove(B, s * 1.2, -0.38, 0, 1.3, 0.03, [0, s * Math.PI / 2, 0]);

    // forearm: origin at the elbow, runs along +Z
    B.bone('fa' + S, 'sh' + S, s * 0.1, -1.5, 0);
    FRAME();
    B.box(0, 0, 1.0, 0.7, 0.72, 1.9, C.frame, { b: 0.08 });
    B.piston(s * -0.3, -0.25, 0.2, s * -0.3, -0.25, 1.7, 0.07, C.frame2, STEEL);
    B.cyl(0, 0, 2.02, 0.36, 0.3, C.frame2, { axis: 'z', n: 10 });                                            // wrist
    PAINT();
    B.box(0, 0.08, 1.1, 0.98, 0.95, 1.45, C.arm, { b: 0.1, r: [0, 0, 0] });                                  // gauntlet
    B.box(0, 0.6, 1.05, 0.7, 0.16, 1.1, C.armL, { b: 0.05, tz: 0.85 });
    groove(B, 0, 0.56, 1.1, 0.8, 0.03, 'y+');
    hazard(B, 0, 0.69, 0.75, 0.5, 0.1, 'y+');
    B.box(0, 0.1, 0.25, 0.9, 0.9, 0.4, C.armD, { b: 0.08, bz: 0.7 });                                        // elbow guard
    const cx = s * 0.78;
    B.bone('mArm' + S, 'fa' + S, cx, 0.12, 0); B.to('fa' + S); FRAME();
    // fist
    B.box(0, -0.02, 2.38, 0.82, 0.8, 0.5, C.frame2, { b: 0.08 });                                            // palm
    PAINT();
    B.box(0, 0.0, 2.8, 0.98, 0.92, 0.5, C.armL, { b: 0.11 });                                                // knuckle block
    for (let i = 0; i < 3; i++) B.box(-0.245 + i * 0.245, 0, 3.045, 0.035, 0.8, 0.03, BLACK, { edge: 0 });
    for (let i = 0; i < 4; i++) { BARE(); B.box(-0.37 + i * 0.245, 0.3, 3.03, 0.16, 0.16, 0.1, STEEL, { b: 0.03 }); PAINT(); }
    B.box(s * -0.5, -0.12, 2.6, 0.22, 0.4, 0.6, C.arm, { b: 0.07 });                                         // thumb
    hazard(B, 0, 0.462, 2.8, 0.8, 0.12, 'y+');
    B.socket('hand' + S, 0, 0, 3.15);
  }
  // detachable right pauldron cap
  B.bone('plateSh', 'shR', 0, 0, 0); PAINT();
  B.box(-0.55, 0.62, 0.55, 0.9, 0.3, 0.8, C.armL, { b: 0.08, r: [0.25, 0, 0.15] });
  bolts(B, -0.55, 0.78, 0.55, 0.6, 3, [-1.3, 0, 0]);

  // hardpoint mounts (modules are separate blueprints: models_modules.js)
  B.bone('mShL', 'torso', 1.08, 2.6, -0.2); B.bone('mShR', 'torso', -1.08, 2.6, -0.3); B.bone('mBack', 'torso', 0, 2.5, -1.15);

  // -------------------------------------------------------------- jump jets (on the back)
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('jet' + S, 'torso', s * 0.92, 1.95, -1.5);
    PAINT();
    B.box(0, 0, -0.15, 0.95, 1.15, 0.8, C.arm, { b: 0.1, bx: 0.85 });
    B.box(0, 0.45, -0.2, 0.75, 0.3, 0.9, C.armL, { b: 0.07, tz: 0.8 });
    B.arc(0, 0.38, -0.15, 0.5, 0.47, -0.2, 0.2, Math.PI - 1.0, Math.PI + 1.0, C.armL, { thick: 0.05, n: 6 });
    hazard(B, 0, -0.3, -0.555, 0.8, 0.15, 'z-');
    strip(B, 0, 0.0, -0.555, 0.6, 0.07, 'z-', GLOW);
    vent(B, s * 0.48, 0.1, -0.15, 0.5, 0.5, s > 0 ? 'x+' : 'x-', 4, C.armD);

    BARE();
    B.cyl(0, -0.72, -0.15, 0.3, 0.3, DARK, { n: 10, rough: 0.4 });
    B.cyl(0, -1.02, -0.15, 0.48, 0.5, lin(0x33373c), { n: 10, r2: 0.32, rough: 0.35 });                       // bell (wide end down)
    B.cyl(0, -1.25, -0.15, 0.5, 0.06, STEEL, { n: 10 });
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; B.box(Math.cos(a) * 0.46, -1.0, -0.15 + Math.sin(a) * 0.46, 0.08, 0.5, 0.08, C.armD, { edge: 0.4 }); }
    B.chan('jet').cyl(0, -1.2, -0.15, 0.4, 0.04, JET, { n: 10 }).chan('a');
    B.socket('jet' + S, 0, -1.3, -0.15);
  }
  return B.finish();
}
const RUBBERISH = lin(0x121315);
