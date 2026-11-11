// ============================================================================
// KILOTON — models_vanta.js   OWNER: MODELS.
// The Vanta rig: a hunched, horned predator. Long forward carapace with a low
// visor head, tall blade pylons on the shoulders, straight armoured legs,
// a rotary cannon arm and a pincer arm. Oxblood plate, orange-red emissives.
// variant 'heavy' adds tower shields, glacis, twin salvo racks (and is scaled 1.235x by the caller).
// ============================================================================
import { Builder, lin, mul3 } from './models_kit.js';
import { panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, STEEL, DARK } from './models_parts.js';

const C = {
  arm: lin(0x561318), armL: lin(0x74201f), armD: lin(0x340b0f), frame: lin(0x171313), frame2: lin(0x262021),
  bone: lin(0xb9a88c), glow: lin(0xff4a10), heat: lin(0xff7a1c), jet: lin(0xffb070), rocket: lin(0x2b2526), tip: lin(0xd8a013),
};
const GLOW = mul3(C.glow, 2.6), HEAT = mul3(C.heat, 1), JET = mul3(C.jet, 1);

export const VANTA_CFG = {
  hipH: 4.5, hipX: 0.95, hipY: -0.1, l1: 2.0, l2: 1.95, meta: 0.5, am: 0.0, amAir: 0.15, ankle: 0.45, homeX: 1.15, homeZ: 0.15,
  strideMax: 3.3, s0: 1.2, sk: 0.42, duty: 0.6, Tmin: 0.85, Tmax: 1.5, Tturn: 1.15, stepH: 0.8, toeLen: 1.0,
  bob: 0.14, sway: 0.24, roll: 0.05, yawSw: 0.1, leanK: 0.014, stepImpulse: 1.2, dipK: 58, dipC: 8,
  torsoY: 0.6, hangY: 3.5, hangZ: -0.4, deathDrop: 2.3, jetRest: 0.45, flareR: 0.4, flareLen: 2.4, heavy: true, podSide: -1,
};

export function buildVanta(heavy) {
  const B = new Builder({ seed: heavy ? 29 : 23, uvScale: 0.2, bevelK: 1.5 });
  const PAINT = () => B.mat(0.46, 0.4, 0.26), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);
  const K = heavy ? 1.3 : 1.14;        // limb thickness

  B.bone('body', null, 0, 0, 0);
  B.bone('pelvis', 'body', 0, 4.5, 0);
  FRAME();
  B.box(0, 0, 0, 1.5, 0.8, 1.3, C.frame, { b: 0.1 });
  B.cyl(0, 0.45, 0, 0.8, 0.24, C.frame2, { n: 10 });
  for (const s of [1, -1]) B.cyl(s * 0.85, -0.1, 0, 0.5, 0.45, C.frame2, { axis: 'x', n: 8 });
  PAINT();
  B.box(0, -0.45, 0.6, 0.7, 1.3, 0.35, C.arm, { b: 0.07, bx: 0.3, r: [-0.12, 0, 0] });          // long tabard
  B.box(0, -0.3, -0.62, 0.9, 0.9, 0.3, C.armD, { b: 0.07, bx: 0.5 });
  strip(B, 0, -0.2, 0.79, 0.08, 0.5, [-0.12, 0, 0], GLOW);
  stencil(B, 0, -0.75, 0.83, [-0.12, 0, 0], GLYPH.V, 0.06, C.bone);

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('hip' + S, 'pelvis', s * 0.95, -0.1, 0);
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.46, 0.6, C.frame2, { axis: 'x', n: 8 });
    B.box(0, -1.0, 0, 0.5 * K, 1.8, 0.6 * K, C.frame, { b: 0.07 });
    B.piston(0, -0.3, -0.42, 0, -1.8, -0.3, 0.09, C.frame2, STEEL);
    PAINT();
    B.box(s * 0.1, -0.85, 0.22, 0.8 * K, 1.5, 0.5 * K, C.arm, { b: 0.09, bx: 0.7, tx: 1.05 });
    B.box(s * 0.42 * K, -0.7, 0, 0.2, 1.5, 0.95 * K, C.armL, { b: 0.07, bz: 0.6, bx: 0.8 });           // hip tasset
    strip(B, s * (0.42 * K + 0.105), -0.75, 0, 0.07, 0.9, xf, GLOW);
    groove(B, s * 0.1, -0.6, 0.22 + 0.25 * K + 0.005, 0.6, 0.03, 'z+');
    B.box(s * 0.1, -0.9, -0.36 * K, 0.7 * K, 1.3, 0.28, C.armD, { b: 0.07, bx: 0.75 });

    B.bone('shin' + S, 'thigh' + S, 0, -2.0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.42, 0.85, C.frame2, { axis: 'x', n: 8 });
    B.box(0, -1.0, -0.02, 0.45 * K, 1.8, 0.5 * K, C.frame, { b: 0.06 });
    B.piston(0, -0.2, -0.36, 0, -1.75, -0.28, 0.08, C.frame2, STEEL);
    PAINT();
    B.box(0, 0.25, 0.42, 0.6 * K, 1.0, 0.36, C.armL, { b: 0.08, tx: 0.25, tz: 0.4, oz: 0.12 });        // knee spike
    B.box(0, -1.0, 0.24, 0.78 * K, 1.75, 0.4, C.arm, { b: 0.09, bx: 1.15, tx: 0.8 });                   // flared greave
    B.box(s * 0.36 * K, -1.1, -0.05, 0.14, 1.5, 0.75, C.armD, { b: 0.05, bz: 1.1 });
    B.arc(0, -1.0, 0.08, 0.47 * K, 0.4, -0.82, 0.7, -1.0, 1.0, C.armL, { thick: 0.05, n: 6, tr: 0.82 });
    strip(B, 0, -1.05, 0.475, 0.07, 0.36, 'z+', GLOW);
    B.box(0, -1.15, -0.34 * K, 0.7 * K, 1.3, 0.26, C.armD, { b: 0.07, bx: 1.1 });

    B.bone('meta' + S, 'shin' + S, 0, -1.95, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.36, 0.8, C.frame2, { axis: 'x', n: 8 });
    B.box(0, -0.25, 0, 0.5, 0.5, 0.55, C.frame, { b: 0.06 });

    B.bone('foot' + S, 'meta' + S, 0, -0.5, 0);          // ankle; sole at -0.45
    FRAME();
    B.box(0, -0.4, 0.2, 1.15 * K, 0.1, 2.0, BLACK, { b: 0.03, edge: 0.1 });
    PAINT();
    B.box(0, -0.14, 0.0, 1.0 * K, 0.5, 1.1, C.arm, { b: 0.09, tx: 0.7, tz: 0.7 });
    for (const t of [-1, 0, 1]) B.box(t * 0.4 * K, -0.22, 0.95, 0.32 * K, 0.3, 0.9, t ? C.armL : C.armD, { b: 0.06, tz: 0.55, tx: 0.7, oz: -0.12, r: [0, t * -0.22, 0] });   // three claws
    B.box(0, -0.22, -0.7, 0.42, 0.3, 0.6, C.armD, { b: 0.06, tz: 0.5, oz: 0.12 });
    B.socket('foot' + S, 0, -0.45, 0.2);
  }

  // ------------------------------------------------------------------- torso (carapace)
  B.bone('torso', 'pelvis', 0, 0.6, 0);
  FRAME();
  B.cyl(0, 0.1, 0, 0.8, 0.22, C.frame2, { n: 10 });
  B.box(0, 0.45, 0.1, 1.5, 0.7, 1.5, C.frame, { b: 0.1 });
  for (const s of [1, -1]) { B.tube(s * 0.5, 0.15, 0.7, s * 0.7, 0.8, 1.2, 0.07, DARK); B.piston(s * 0.7, 0.1, -0.3, s * 1.0, 0.8, -0.5, 0.08, C.frame2, STEEL); }
  PAINT();
  // main shell: wide, long, sloping down to the nose
  B.box(0, 1.2, 0.3, 3.5, 1.15, 3.0, C.arm, { b: 0.14, bx: 0.7, bz: 0.8, tx: 0.86, tz: 0.82 });
  B.box(0, 1.85, -0.1, 2.5, 0.4, 2.2, C.armL, { b: 0.1, tx: 0.7, tz: 0.75, oz: -0.2 });                  // dorsal hump
  B.push(0, 1.42, 0.25, Math.PI / 2, 0, 0); B.arc(0, 0, 0, 1.5, 0.62, -1.15, 1.2, Math.PI - 1.15, Math.PI + 1.15, C.arm, { thick: 0.08, n: 8 }); B.pop();   // rolled carapace
  B.box(0, 0.95, 1.95, 2.3, 0.8, 0.9, C.arm, { b: 0.1, tx: 0.8, tz: 0.4, bx: 0.6, oz: -0.2 });           // brow over the head
  B.box(0, 2.15, -0.5, 0.22, 0.9, 1.9, C.armD, { b: 0.05, tz: 0.35, oz: -0.5 });                         // dorsal fin
  strip(B, 0.115, 2.1, -0.6, 0.9, 0.07, 'x+', GLOW); strip(B, -0.115, 2.1, -0.6, 0.9, 0.07, 'x-', GLOW);
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    vent(B, s * 0.95, 1.2, 1.78, 0.6, 0.45, [0.1, s * 0.25, 0], 4, C.armD, 'heat', HEAT);
    B.box(s * 1.45, 1.0, 1.3, 0.5, 0.7, 1.2, C.armL, { b: 0.08, tz: 0.5, r: [0, s * 0.2, 0] });          // mandible plates
    panel(B, s * 1.62, 1.25, -0.1, 1.6, 0.55, xf, C.armD, 0.06);
    groove(B, s * 1.52, 0.85, 0.1, 2.0, 0.03, xf);
    bolts(B, s * 1.69, 1.44, -0.1, 1.3, 5, xf, C.bone);
    strip(B, s * 0.9, 2.065, 0.2, 0.07, 1.0, 'y+', GLOW);
    FRAME(); B.cyl(s * 1.7, 1.5, 0.2, 0.5, 0.5, C.frame2, { axis: 'x', n: 8 }); PAINT();
    // exhaust stacks
    BARE(); B.cyl(s * 0.75, 2.2, -1.0, 0.16, 0.9, lin(0x2c2a2a), { n: 8, r: [0.35, 0, 0] }); B.chan('heat').cyl(s * 0.75, 2.63, -1.16, 0.11, 0.03, HEAT, { n: 8, r: [0.35, 0, 0] }).chan('a'); PAINT();
  }
  hazard(B, 0, 0.72, -1.21, 1.4, 0.16, 'z-', 0, C.glow);
  stencil(B, 0.9, 2.07, -0.7, 'y+', GLYPH.V, 0.09, C.bone);
  // back: engine block
  FRAME();
  B.box(0, 1.15, -1.35, 1.9, 1.1, 0.6, C.frame, { b: 0.1 });
  B.chan('heat'); for (let i = 0; i < 4; i++) B.box(0, 0.82 + i * 0.22, -1.67, 1.3, 0.09, 0.04, HEAT); B.chan('a');
  PAINT();
  for (let i = 0; i < 4; i++) B.box(0, 0.78 + i * 0.22, -1.7, 1.5, 0.09, 0.2, C.armD, { r: [-0.6, 0, 0], edge: 0.5 });
  for (const s of [1, -1]) B.box(s * 0.85, 1.15, -1.62, 0.2, 1.2, 0.25, C.armL, { b: 0.05 });
  B.socket('cockpit', 0, 1.2, 0.8);
  if (heavy) {
    B.box(0, 0.75, 1.5, 2.6, 0.9, 0.3, C.armL, { b: 0.09, bx: 0.7, r: [0.5, 0, 0] });                    // glacis
    hazard(B, 0, 0.75, 1.69, 1.8, 0.14, [0.5, 0, 0], 0, C.glow);
    B.box(0, 0.5, -1.75, 1.2, 0.7, 0.9, C.armD, { b: 0.1, tz: 0.5, oz: -0.2 });                           // tail counterweight
    for (const s of [1, -1]) B.box(s * 1.2, 2.0, -0.7, 0.7, 0.5, 1.4, C.arm, { b: 0.09, tz: 0.7 });
  }
  B.bone('plateChest', 'torso', 0, 0, 0); PAINT();
  B.box(1.0, 1.72, 0.9, 1.0, 0.2, 1.1, C.armL, { b: 0.07, r: [0.14, 0, -0.08] });
  B.bone('plateBack', 'torso', 0, 0, 0); PAINT();
  B.box(-1.0, 1.72, 0.9, 1.0, 0.2, 1.1, C.armL, { b: 0.07, r: [0.14, 0, 0.08] });

  // ------------------------------------------------------------------- head (low visor wedge under the brow)
  B.bone('head', 'torso', 0, 0.75, 1.9);
  FRAME(); B.cyl(0, 0.05, -0.2, 0.3, 0.4, C.frame2, { n: 8 });
  PAINT();
  B.box(0, 0, 0.3, 1.1, 0.55, 1.0, C.armD, { b: 0.09, tz: 0.5, tx: 0.7, bx: 0.8, oz: 0.1 });
  B.box(0, -0.3, 0.35, 0.7, 0.2, 0.8, C.arm, { b: 0.06, bz: 0.6 });
  B.chan('glow');
  B.box(0, 0.03, 0.79, 0.86, 0.14, 0.1, mul3(GLOW, 1.3));                                                           // visor slit
  for (const s of [1, -1]) B.box(s * 0.5, 0.02, 0.5, 0.06, 0.1, 0.5, mul3(GLOW, 0.8), { r: [0, s * 0.2, 0] });
  B.chan('a');
  for (const s of [1, -1]) B.box(s * 0.5, 0.3, 0.1, 0.1, 0.5, 0.5, C.bone, { b: 0.03, tz: 0.3, oz: -0.3, rough: 0.6, metal: 0.1 });   // tusk fins
  B.socket('eye', 0, 0.02, 0.86);

  // ------------------------------------------------------------------- arms
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('sh' + S, 'torso', s * 2.05, 1.5, 0.2);
    FRAME();
    B.cyl(0, 0, 0, 0.55, 0.6, C.frame2, { axis: 'x', n: 8 });
    B.box(s * 0.05, -0.95, 0, 0.55 * K, 1.6, 0.65 * K, C.frame, { b: 0.07 });
    B.piston(s * 0.05, -0.2, -0.42, s * 0.05, -1.65, -0.35, 0.08, C.frame2, STEEL);
    B.cyl(s * 0.05, -1.8, 0, 0.42, 0.8, C.frame2, { axis: 'x', n: 8 });
    PAINT();
    B.box(s * 0.28, -0.9, 0, 0.26, 1.3, 0.8, C.arm, { b: 0.06, bz: 0.7 });
    // pauldron with a tall blade pylon (the horned silhouette)
    B.box(s * 0.3, 0.3, 0, 1.3, 0.75, 1.7, C.arm, { b: 0.12, tx: 0.6, tz: 0.7, ox: s * 0.1 });
    B.push(s * 0.3, 0.05, 0, 0, 0, Math.PI / 2); B.arc(0, 0, 0, 0.66, 0.9, -0.5, 0.5, 0.3, Math.PI - 0.3, C.armL, { thick: 0.07, n: 7 }); B.pop();
    B.box(s * 0.62, 1.2, -0.15, 0.26, 1.9, 1.3, C.armL, { b: 0.07, tz: 0.22, tx: 0.6, oz: -0.45, ox: s * 0.18 });     // blade
    B.box(s * 0.58, 0.95, 0.5, 0.2, 1.0, 0.6, C.armD, { b: 0.05, tz: 0.2, oz: 0.2, ox: s * 0.1 });                    // fore-horn
    strip(B, s * 0.78, 1.0, -0.2, 0.07, 1.1, [0, s * Math.PI / 2, s * -0.1], GLOW);
    hazard(B, s * 0.3, 0.2, 0.855, 0.9, 0.13, 'z+', 0, C.glow);
    bolts(B, s * 0.3, 0.2, -0.855, 0.9, 4, 'z-', C.bone);
    if (heavy) {                                                                                                      // tower shield
      B.box(s * 1.15, -0.5, 0.1, 0.22, 2.9, 2.0, C.arm, { b: 0.09, bz: 0.6, tz: 0.8, r: [0, 0, s * 0.06] });
      B.box(s * 1.28, -0.4, 0.1, 0.1, 1.9, 1.2, C.armL, { b: 0.04, bz: 0.6 });
      strip(B, s * 1.335, -0.4, 0.1, 0.08, 1.4, xf, GLOW);
      stencil(B, s * 1.335, 0.3, 0.55, xf, GLYPH.V, 0.08, C.bone);
    }
    B.bone('fa' + S, 'sh' + S, s * 0.05, -1.8, 0);
    FRAME();
    B.box(0, 0, 1.0, 0.6 * K, 0.6 * K, 2.0, C.frame, { b: 0.07 });
    PAINT();
    B.box(0, 0.05, 0.9, 0.85 * K, 0.8 * K, 1.5, C.arm, { b: 0.09, tz: 0.8, bz: 1 });
    B.box(0, 0.5 * K, 0.3, 0.5, 0.3, 1.0, C.armL, { b: 0.06, tz: 0.3, oz: -0.3 });                      // elbow spike (points back)
    groove(B, 0, 0.455 * K, 1.2, 0.6, 0.03, 'y+');
    strip(B, s * 0.43 * K, 0.05, 1.0, 0.9, 0.07, [0, s * Math.PI / 2, 0], GLOW);
    if (s < 0) {
      // right: three-barrel rotary pulse cannon
      FRAME(); B.cyl(0, 0, 2.05, 0.46, 0.5, C.frame2, { axis: 'z', n: 10 });
      BARE();
      for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.52; B.cyl(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 2.9, 0.13, 1.5, lin(0x2e2c2d), { axis: 'z', n: 8, rough: 0.3 }); }
      B.cyl(0, 0, 3.3, 0.42, 0.14, DARK, { axis: 'z', n: 10 }); B.cyl(0, 0, 2.6, 0.42, 0.1, DARK, { axis: 'z', n: 10 });
      B.cyl(0, 0, 3.62, 0.44, 0.16, STEEL, { axis: 'z', n: 10 });
      B.chan('heat').cyl(0, 0, 3.705, 0.3, 0.02, mul3(HEAT, 1.1), { axis: 'z', n: 10 }).chan('a');
      PAINT(); B.box(0, 0.5, 2.2, 0.4, 0.3, 0.9, C.armD, { b: 0.05 });
      vent(B, 0, -0.42 * K, 1.0, 0.5, 0.8, 'y-', 4, C.armD, 'heat', HEAT);
      B.socket('muzzleR', 0, 0, 3.75); B.socket('handR', 0, 0, 3.8);
    } else {
      // left: pincer claw over an under-slung gun
      FRAME(); B.cyl(0, 0, 2.1, 0.4, 0.4, C.frame2, { axis: 'z', n: 8 });
      PAINT();
      for (const t of [1, -1]) {
        B.box(t * 0.42, 0.05, 2.9, 0.26, 0.7, 1.5, C.armL, { b: 0.07, r: [0, t * -0.14, 0] });
        B.box(t * 0.33, 0.05, 3.85, 0.2, 0.55, 0.9, STEEL, { b: 0.04, tz: 0.15, tx: 0.5, r: [0, t * -0.4, 0], rough: 0.3, metal: 1 });   // talon tips
      }
      B.box(0, 0.42, 2.6, 0.9, 0.2, 0.9, C.armD, { b: 0.06 });
      BARE(); B.cyl(0, -0.42, 2.4, 0.15, 1.6, lin(0x2e2c2d), { axis: 'z', n: 8, rough: 0.3 }); B.cyl(0, -0.42, 3.15, 0.2, 0.2, DARK, { axis: 'z', n: 8 });
      B.chan('heat').cyl(0, -0.42, 3.26, 0.12, 0.02, mul3(HEAT, 1.1), { axis: 'z', n: 8 }).chan('a');
      PAINT(); B.box(0, -0.42, 1.6, 0.4, 0.4, 1.0, C.armD, { b: 0.06 });
      B.socket('muzzleL', 0, -0.42, 3.3); B.socket('handL', 0, 0.05, 3.9);
    }
  }
  B.bone('plateSh', 'shL', 0, 0, 0); PAINT();
  B.box(0.1, 0.72, 0.45, 0.8, 0.16, 0.7, C.armL, { b: 0.06, r: [0.2, 0, -0.2] });

  // ------------------------------------------------------------------- salvo rack(s) on the back
  B.bone('pod', 'torso', 0, 1.95, -0.95);
  const racks = heavy ? [1.15, -1.15] : [0];
  for (const rx of racks) {
    B.push(rx, 0.1, 0, -0.45, 0, 0);
    FRAME(); B.box(0, 0, 0, 0.5, 0.3, 0.6, C.frame2, { b: 0.05 });
    PAINT();
    B.box(0, 0.5, 0.1, heavy ? 1.1 : 1.7, 0.75, 1.6, C.arm, { b: 0.09 });
    B.box(0, 0.5, 0.91, heavy ? 1.0 : 1.6, 0.65, 0.06, BLACK, { edge: 0.1 });
    const cols = heavy ? 2 : 4;
    for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
      const tx = (c - (cols - 1) / 2) * 0.4, ty = 0.34 + r * 0.32;
      B.cyl(tx, ty, 0.93, 0.14, 0.08, C.armD, { axis: 'z', n: 8, edge: 0.5 });
      B.cyl(tx, ty, 0.96, 0.09, 0.12, C.tip, { axis: 'z', n: 8, r2: 0.02, rough: 0.4, metal: 0.2 });
    }
    strip(B, 0, 0.885, 0.1, 0.07, 1.2, 'y+', GLOW);
    vent(B, 0, 0.5, -0.71, 0.9, 0.5, 'z-', 3, C.armD);
    if (rx === racks[0]) B.socket('rocketPod', 0, 0.5, 1.0, -0.45, 0, 0);
    B.pop();
  }
  // jets low on the back
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R';
    B.bone('jet' + S, 'torso', s * 0.95, 0.75, -1.45);
    PAINT();
    B.box(0, 0, -0.1, 0.7, 0.8, 0.6, C.armD, { b: 0.08, bx: 0.8 });
    strip(B, 0, 0.1, -0.405, 0.4, 0.07, 'z-', GLOW);
    BARE();
    B.cyl(0, -0.62, -0.1, 0.4, 0.5, lin(0x2c2a2a), { n: 8, r2: 0.26, rough: 0.35 });
    B.chan('jet').cyl(0, -0.84, -0.1, 0.33, 0.04, JET, { n: 8 }).chan('a');
    B.socket('jet' + S, 0, -0.9, -0.1);
  }
  return B.finish();
}
