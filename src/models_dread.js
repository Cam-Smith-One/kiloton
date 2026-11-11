// ============================================================================
// KILOTON — models_dread.js   OWNER: MODELS.
// The DREADNOUGHT: Vanta's operation boss. A walking furnace: splayed
// digitigrade legs under a hunched hull with a round reactor core in its chest
// behind four armoured petals, a colossal siege cannon for a right arm, a
// crusher claw on the left, a swarm-rack hump over the left shoulder and a
// stand of exhaust stacks over the right. Authored at half size with dense
// detail and instanced at 2x (17 m). Phases read through setDamage: petals and
// shrouds fall away (cfg.plateAt), the core is exposed, emissives run hotter.
// ============================================================================
import { Builder, lin, mul3 } from './models_kit.js';
import { panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, STEEL, DARK } from './models_parts.js';

const C = {
  arm: lin(0x4a1014), armL: lin(0x6a1c1b), armD: lin(0x2c090c), frame: lin(0x151111), frame2: lin(0x231d1e),
  bone: lin(0xb9a88c), glow: lin(0xff4a10), heat: lin(0xff7a1c), jet: lin(0xffb070), gun: lin(0x2a2829), tip: lin(0xd8a013), brass: lin(0x8a6a2a),
};
const GLOW = mul3(C.glow, 2.6), HEAT = mul3(C.heat, 1), JET = mul3(C.jet, 1);
const TAU = Math.PI * 2, H = Math.PI / 2;

export const DREAD_SCALE = 2;
export const DREAD_CFG = {
  hipH: 4.0, hipX: 1.25, hipY: -0.1, l1: 1.75, l2: 1.7, meta: 0.9, am: 0.35, amAir: 0.15, ankle: 0.5, homeX: 1.65, homeZ: 0.2,
  strideMax: 2.6, s0: 1.1, sk: 0.5, duty: 0.66, Tmin: 1.55, Tmax: 2.4, Tturn: 1.9, stepH: 0.6, toeLen: 1.1,
  bob: 0.1, sway: 0.3, roll: 0.05, yawSw: 0.06, leanK: 0.012, stepImpulse: 1.5, dipK: 30, dipC: 6, landV: 5,
  torsoY: 0.7, hangY: 3.2, hangZ: -0.3, deathDrop: 2.3, jetRest: 0.4, flareR: 0.4, flareLen: 2.0, heavy: true, podSide: 1,
  // armour that falls away as it is damaged, in bone order: 4 core petals, hump shroud, stack cowl, brow, right gun-shield
  plateAt: [0.3, 0.3, 0.34, 0.34, 0.6, 0.7, 0.85, 0.64], heatDmg: 3.2, hotShift: true, glowK: 1.15,
};

export function buildDreadnought() {
  const B = new Builder({ seed: 666, uvScale: 0.32, bevelK: 1.3 });
  const PAINT = () => B.mat(0.46, 0.42, 0.28), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);

  B.bone('body', null, 0, 0, 0);
  B.bone('pelvis', 'body', 0, 4.0, 0);
  FRAME();
  B.box(0, 0, 0, 2.4, 0.9, 1.8, C.frame, { b: 0.1 });
  B.cyl(0, 0.52, 0, 1.15, 0.24, C.frame2, { n: 14 });
  BARE(); B.cyl(0, 0.42, 0, 1.25, 0.08, STEEL, { n: 14 }); FRAME();
  for (const s of [1, -1]) { B.cyl(s * 1.12, -0.1, 0, 0.6, 0.5, C.frame2, { axis: 'x', n: 10 }); B.tube(s * 0.6, 0.3, -0.8, s * 1.0, -0.3, -0.6, 0.06, DARK); B.tube(s * 0.4, 0.3, -0.85, s * 0.85, -0.4, -0.7, 0.045, C.frame2); }
  PAINT();
  B.box(0, -0.45, 0.85, 1.1, 1.5, 0.36, C.arm, { b: 0.07, bx: 0.35, r: [-0.14, 0, 0] });                 // keel plate
  for (const s of [1, -1]) B.box(s * 0.75, -0.2, 0.8, 0.5, 0.9, 0.3, C.armL, { b: 0.06, bx: 0.5, r: [-0.14, s * 0.25, 0] });
  B.box(0, -0.25, -0.9, 1.6, 1.0, 0.36, C.armD, { b: 0.07, bx: 0.6 });
  strip(B, 0, -0.2, 1.045, 0.08, 0.6, [-0.14, 0, 0], GLOW);
  stencil(B, 0, -0.85, 1.12, [-0.14, 0, 0], GLYPH.V, 0.07, C.bone);
  hazard(B, 0, 0.25, 0.905, 1.6, 0.12, 'z+', 0, C.glow);

  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('hip' + S, 'pelvis', s * 1.25, -0.1, 0);
    B.bone('thigh' + S, 'hip' + S, 0, 0, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.56, 0.7, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.9, 0, 0.7, 1.6, 0.8, C.frame, { b: 0.07 });
    B.piston(0, -0.25, -0.55, 0, -1.6, -0.4, 0.1, C.frame2, STEEL); B.piston(s * -0.3, -0.2, 0.45, s * -0.3, -1.5, 0.42, 0.07, C.frame2, STEEL);
    PAINT();
    B.box(s * 0.08, -0.8, 0.3, 1.1, 1.7, 0.6, C.arm, { b: 0.1, bx: 0.75 });
    B.arc(s * 0.08, -0.8, 0.22, 0.6, 0.5, -0.8, 0.75, -1.0, 1.0, C.armL, { thick: 0.06, n: 6, tr: 1.1 });
    B.box(s * 0.58, -0.6, 0, 0.22, 1.8, 1.4, C.armL, { b: 0.07, bz: 0.6 });                              // tasset
    for (let i = 0; i < 3; i++) B.box(s * 0.7, -0.2 - i * 0.5, 0, 0.1, 0.3, 1.0 - i * 0.15, C.armD, { b: 0.03 });   // lamellar strips
    strip(B, s * 0.76, -1.35, 0, 0.6, 0.07, xf, GLOW);
    bolts(B, s * 0.08, -0.1, 0.61, 0.8, 5, 'z+', C.bone, 0.035);
    B.box(s * 0.05, -0.8, -0.5, 0.9, 1.3, 0.28, C.armD, { b: 0.06 });

    B.bone('shin' + S, 'thigh' + S, 0, -1.75, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.5, 1.05, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.85, -0.03, 0.6, 1.5, 0.7, C.frame, { b: 0.06 });
    B.piston(0, -0.15, -0.45, 0, -1.5, -0.42, 0.09, C.frame2, STEEL);
    PAINT();
    B.box(0, 0.3, 0.5, 0.75, 1.3, 0.4, C.armL, { b: 0.08, tx: 0.2, tz: 0.35, oz: 0.15 });                // knee horn
    B.box(0, -0.85, 0.3, 1.0, 1.5, 0.42, C.arm, { b: 0.09, bx: 1.15, tx: 0.8 });
    B.arc(0, -0.85, 0.2, 0.56, 0.44, -0.72, 0.68, -1.0, 1.0, C.armL, { thick: 0.05, n: 6, tr: 0.85 });
    B.box(s * 0.46, -0.9, -0.05, 0.16, 1.4, 0.9, C.armD, { b: 0.05 }); B.box(0, -0.9, -0.42, 0.8, 1.3, 0.24, C.armD, { b: 0.06 });
    strip(B, 0, -0.9, 0.645, 0.07, 0.5, 'z+', GLOW);

    B.bone('meta' + S, 'shin' + S, 0, -1.7, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.44, 0.95, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.45, 0, 0.56, 0.8, 0.6, C.frame, { b: 0.06 });
    PAINT(); B.box(0, -0.4, -0.32, 0.8, 0.95, 0.26, C.arm, { b: 0.07, tx: 0.8 }); B.box(0, 0.15, -0.5, 0.5, 0.7, 0.3, C.armL, { b: 0.07, tx: 0.3, tz: 0.4, r: [0.5, 0, 0] });

    B.bone('foot' + S, 'meta' + S, 0, -0.9, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.4, 1.1, C.frame2, { axis: 'x', n: 10 });
    B.box(0, -0.44, 0.25, 1.5, 0.12, 2.6, BLACK, { b: 0.03, edge: 0.1 });
    PAINT();
    B.box(0, -0.18, 0.05, 1.4, 0.5, 1.4, C.arm, { b: 0.1, tx: 0.75, tz: 0.75 });
    B.box(0, 0.12, 0.1, 0.9, 0.26, 0.8, C.armL, { b: 0.07, tz: 0.6 });
    for (const t of [-1, 0, 1]) { B.box(t * 0.5, -0.24, 1.15, 0.4, 0.36, 1.1, t ? C.armL : C.armD, { b: 0.07, tz: 0.5, tx: 0.7, oz: -0.12, r: [0, t * -0.2, 0] }); BARE(); B.box(t * 0.56, -0.3, 1.75, 0.24, 0.2, 0.3, STEEL, { b: 0.04, tz: 0.3, r: [0, t * -0.2, 0] }); PAINT(); }
    B.box(0, -0.25, -0.85, 0.6, 0.34, 0.7, C.armD, { b: 0.07, tz: 0.5, oz: 0.12 });
    hazard(B, 0, 0.255, 0.1, 0.7, 0.1, 'y+', 0, C.glow);
    B.socket('foot' + S, 0, -0.5, 0.25);
  }

  // ------------------------------------------------------------------- hull
  B.bone('torso', 'pelvis', 0, 0.7, 0);
  FRAME();
  B.cyl(0, 0.12, 0, 1.15, 0.24, C.frame2, { n: 14 });
  B.box(0, 0.5, 0, 2.6, 0.7, 2.0, C.frame, { b: 0.1 });
  for (const s of [1, -1]) { B.piston(s * 1.1, 0.15, -0.5, s * 1.5, 1.0, -0.8, 0.1, C.frame2, STEEL); B.tube(s * 0.7, 0.2, 0.95, s * 0.95, 0.95, 1.3, 0.08, DARK); B.tube(s * 0.5, 0.2, 1.0, s * 0.6, 0.95, 1.35, 0.05, C.frame2); }
  PAINT();
  B.box(0, 1.7, 0, 4.0, 2.0, 3.0, C.arm, { b: 0.16, bx: 0.72, bz: 0.82 });                               // lower hull
  B.box(0, 3.0, -0.35, 4.4, 1.3, 3.1, C.arm, { b: 0.14, tx: 0.72, tz: 0.7, oz: -0.2 });                  // hunch
  B.push(0, 2.9, -0.2, H, 0, 0); B.arc(0, 0, 0, 2.0, 0.95, -1.5, 1.45, Math.PI - 1.2, Math.PI + 1.2, C.armL, { thick: 0.09, n: 10 }); B.pop();
  // the furnace: a round core in the chest
  FRAME();
  B.cyl(0, 1.75, 1.42, 1.12, 0.3, C.frame2, { axis: 'z', n: 14 });                                       // bezel
  B.cyl(0, 1.75, 1.5, 0.95, 0.2, BLACK, { axis: 'z', n: 14, edge: 0 });
  B.chan('heat');
  B.cyl(0, 1.75, 1.6, 0.42, 0.06, mul3(HEAT, 2.2), { axis: 'z', n: 10 });                                // core
  B.push(0, 1.75, 1.6, H, 0, 0); for (const [r, k] of [[0.62, 1.2], [0.8, 0.8]]) B.arc(0, 0, 0, r, r, -0.03, 0.03, 0, TAU, mul3(HEAT, k), { thick: 0, n: 12 }); B.pop();
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; B.box(Math.cos(a) * 0.66, 1.75 + Math.sin(a) * 0.66, 1.6, 0.36, 0.05, 0.04, mul3(HEAT, 0.7), { r: [0, 0, a] }); }
  B.chan('a'); BARE();
  for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; B.box(Math.cos(a) * 0.72, 1.75 + Math.sin(a) * 0.72, 1.6, 0.5, 0.07, 0.14, C.gun, { r: [0, 0, a], rough: 0.4 }); }   // vanes
  for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; B.cyl(Math.cos(a) * 1.04, 1.75 + Math.sin(a) * 1.04, 1.585, 0.05, 0.05, C.bone, { axis: 'z', n: 6 }); }
  B.socket('cockpit', 0, 1.75, 1.7);
  PAINT();
  // visor band across the hunch + crown of sensor spikes
  B.box(0, 2.95, 1.12, 2.6, 0.5, 0.5, C.armD, { b: 0.08, tz: 0.6, tx: 0.9 });
  B.chan('glow').box(0, 2.95, 1.385, 1.9, 0.11, 0.04, mul3(GLOW, 1.2)).chan('a');
  B.socket('eye', 0, 2.95, 1.42);
  for (const x of [-0.7, -0.25, 0.3, 0.8]) B.box(x, 4.0 + Math.abs(x) * 0.2, 0.2, 0.12, 0.9 - Math.abs(x) * 0.3, 0.5, C.bone, { b: 0.03, tz: 0.2, oz: -0.2, rough: 0.6, metal: 0.1 });
  for (const s of [1, -1]) {
    const xf = s > 0 ? 'x+' : 'x-';
    vent(B, s * 1.35, 1.2, 1.3, 0.7, 0.6, [0.1, s * 0.25, 0], 5, C.armD, 'heat', HEAT);
    B.box(s * 1.75, 1.5, 0.9, 0.5, 1.5, 1.2, C.armL, { b: 0.09, tz: 0.6, r: [0, s * 0.2, 0] });          // flank bulwarks
    panel(B, s * 1.98, 1.9, -0.2, 2.0, 0.9, xf, C.armD, 0.07); bolts(B, s * 2.06, 2.22, -0.2, 1.7, 7, xf, C.bone, 0.035);
    groove(B, s * 1.9, 1.2, -0.2, 2.2, 0.03, xf);
    strip(B, s * 1.2, 3.67, -0.5, 0.08, 1.3, 'y+', GLOW);
    FRAME(); B.cyl(s * 2.05, 2.6, 0, 0.7, 0.5, C.frame2, { axis: 'x', n: 10 }); PAINT();
  }
  hazard(B, 0, 0.92, 1.26, 2.2, 0.16, [0.25, 0, 0], 0, C.glow);
  stencil(B, 1.3, 3.67, 0.4, 'y+', GLYPH.V, 0.11, C.bone);
  // back: boiler block, glowing grate, drive drum
  FRAME();
  B.box(0, 1.9, -1.7, 2.6, 2.2, 0.7, C.frame, { b: 0.1 });
  B.box(0, 1.9, -2.03, 1.8, 1.6, 0.1, BLACK, { edge: 0 });
  B.chan('heat'); for (let i = 0; i < 7; i++) B.box(0, 1.25 + i * 0.22, -2.09, 1.6, 0.09, 0.04, HEAT); B.chan('a');
  PAINT(); for (let i = 0; i < 7; i++) B.box(0, 1.2 + i * 0.22, -2.14, 1.9, 0.09, 0.2, C.armD, { r: [-0.6, 0, 0], edge: 0.5 });
  for (const s of [1, -1]) B.box(s * 1.1, 1.9, -2.06, 0.24, 2.0, 0.28, C.armL, { b: 0.05 });
  FRAME(); B.cyl(0, 0.6, -1.2, 0.5, 2.0, C.frame2, { axis: 'x', n: 10 });
  // exhaust stacks over the right shoulder
  for (const [x, z, h] of [[-1.35, -0.9, 1.25], [-0.95, -1.25, 0.95], [-1.7, -1.3, 0.8]]) {
    BARE(); B.cyl(x, 3.35 + h / 2, z, 0.2, h, lin(0x242223), { n: 8, r: [0.12, 0, 0] }); B.cyl(x, 3.35 + h, z - h * 0.06, 0.25, 0.14, DARK, { n: 8, r: [0.12, 0, 0] });
    B.chan('heat').cyl(x, 3.35 + h + 0.08, z - h * 0.065, 0.16, 0.02, mul3(HEAT, 1.3), { n: 8, r: [0.12, 0, 0] }).chan('a');
  }
  B.socket('stacks', -1.35, 4.7, -1.1);

  // ---- armour that falls away (order matters: see DREAD_CFG.plateAt)
  const petal = (i) => {
    B.bone('plateP' + i, 'torso', 0, 1.75, 1.66); PAINT();
    const a0 = i * H + 0.06, a1 = (i + 1) * H - 0.06;
    B.push(0, 0, 0, H, 0, 0); B.arc(0, 0, 0, 0.98, 0.98, -0.07, 0.07, a0, a1, C.armL, { thick: 0.93, n: 4, inner: true }); B.pop();
    const am = (a0 + a1) / 2; B.box(Math.sin(am) * 0.55, Math.cos(am) * 0.55, 0.09, 0.5, 0.1, 0.05, C.bone, { r: [0, 0, -am], rough: 0.6, metal: 0.1 });
  };
  for (let i = 0; i < 4; i++) petal(i);
  B.bone('plateHump', 'torso', 0, 0, 0); PAINT();                                                         // shroud over the swarm rack
  B.box(1.15, 4.28, -0.75, 2.1, 0.14, 2.0, C.armL, { b: 0.05, r: [-0.38, 0, 0] });
  B.box(2.16, 3.85, -0.7, 0.12, 0.9, 1.9, C.arm, { b: 0.04, r: [-0.38, 0, 0] });
  B.bone('plateCowl', 'torso', 0, 0, 0); PAINT();
  B.box(-1.35, 3.75, -1.1, 1.3, 0.7, 1.1, C.arm, { b: 0.1, tx: 0.7, tz: 0.7 });
  B.bone('plateBrow', 'torso', 0, 0, 0); PAINT();
  B.box(0, 3.3, 1.0, 3.0, 0.3, 0.7, C.armL, { b: 0.08, tz: 0.6, r: [0.2, 0, 0] });
  for (const s of [1, -1]) B.box(s * 1.0, 2.4, 1.45, 0.9, 0.5, 0.25, C.armL, { b: 0.07, r: [0, s * 0.15, 0] });

  // ---- swarm-rack hump over the left shoulder (bone 'pod': kicks on fireRocket)
  B.bone('pod', 'torso', 1.15, 3.3, -0.8);
  B.push(0, 0, 0, -0.38, 0, 0);
  FRAME(); B.box(0, 0.05, 0, 1.0, 0.2, 1.2, C.frame2, { b: 0.05 });
  PAINT();
  B.box(0, 0.5, 0.05, 1.9, 0.75, 1.8, C.arm, { b: 0.09 });
  B.box(0, 0.5, 0.96, 1.8, 0.66, 0.05, BLACK, { edge: 0.1 });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) B.cyl(-0.72 + c * 0.29, 0.3 + r * 0.2, 0.99, 0.075, 0.08, C.tip, { axis: 'z', n: 6, r2: 0.015, rough: 0.4, metal: 0.2 });
  strip(B, -0.955, 0.5, 0.05, 1.3, 0.07, 'x-', GLOW);
  vent(B, 0, 0.5, -0.86, 1.4, 0.5, 'z-', 4, C.armD);
  B.socket('rocketPod', 0, 0.5, 1.05, -0.38, 0, 0);
  B.pop();

  // ------------------------------------------------------------------- arms
  for (const s of [1, -1]) {
    const S = s > 0 ? 'L' : 'R', xf = s > 0 ? 'x+' : 'x-';
    B.bone('sh' + S, 'torso', s * 2.5, 2.6, 0);
    FRAME();
    B.cyl(0, 0, 0, 0.72, 0.7, C.frame2, { axis: 'x', n: 10 });
    B.box(s * 0.08, -0.9, 0, 0.75, 1.5, 0.85, C.frame, { b: 0.07 });
    B.piston(s * 0.08, -0.2, -0.55, s * 0.08, -1.5, -0.45, 0.1, C.frame2, STEEL);
    B.cyl(s * 0.08, -1.7, 0, 0.55, 1.0, C.frame2, { axis: 'x', n: 10 });
    PAINT();
    B.box(s * 0.36, -0.85, 0, 0.3, 1.3, 1.05, C.arm, { b: 0.07, bz: 0.8 });
    if (s > 0) {
      // left: layered round pauldron (under the hump)
      B.box(s * 0.3, 0.35, 0, 1.5, 0.9, 2.0, C.arm, { b: 0.14, tx: 0.7, tz: 0.75 });
      B.push(s * 0.3, 0.1, 0, 0, 0, H); B.arc(0, 0, 0, 0.92, 1.15, -0.7, 0.7, 0.3, Math.PI - 0.3, C.armL, { thick: 0.1, n: 8 }); B.pop();
      for (const z of [0.5, -0.5]) B.box(s * 0.3, 1.0, z, 0.9, 0.5, 0.12, C.bone, { b: 0.03, tx: 0.3, ty: 1, rough: 0.6, metal: 0.1 });
      strip(B, s * 1.02, -0.1, 0, 0.9, 0.08, [0, s * H, 0], GLOW);
    } else {
      // right: a square gun-shield tower that the siege arm hangs from
      B.box(s * 0.3, 0.45, 0, 1.5, 1.2, 2.0, C.arm, { b: 0.14, tx: 0.8, tz: 0.8 });
      hazard(B, s * 0.3, 0.1, 1.005, 1.2, 0.16, 'z+', 0, C.glow);
      B.bone('plateShR', 'shR', 0, 0, 0); PAINT();
      B.box(s * 1.1, 0.2, 0.1, 0.24, 2.6, 2.3, C.armL, { b: 0.09, bz: 0.65, tz: 0.8, r: [0, 0, s * 0.05] });
      B.box(s * 1.24, 0.4, 0.1, 0.1, 1.5, 1.3, C.arm, { b: 0.04 });
      strip(B, s * 1.295, 0.4, 0.1, 0.09, 1.1, xf, GLOW); stencil(B, s * 1.295, 1.2, 0.5, xf, GLYPH.V, 0.09, C.bone);
      B.to('shR');
    }
    B.bone('fa' + S, 'sh' + S, s * 0.08, -1.7, 0);
    if (s < 0) {
      // RIGHT: the siege arm. Breech block, recuperators, a barrel as long as a Warden is tall.
      PAINT();
      B.box(0, 0, 0.7, 1.4, 1.4, 2.0, C.arm, { b: 0.14 });
      B.box(0, 0.8, 0.7, 1.0, 0.2, 1.5, C.armL, { b: 0.06 });
      hazard(B, s * 0.705, 0, 0.7, 1.5, 0.2, xf, 0, C.glow); hazard(B, 0, 0, -0.305, 1.1, 0.18, 'z-', 0, C.glow);
      bolts(B, 0, 0.905, 0.7, 1.2, 5, 'y+', C.bone, 0.04, H);
      vent(B, 0, -0.72, 0.7, 0.8, 1.2, 'y-', 5, C.armD, 'heat', HEAT);
      BARE();
      B.cyl(0, 0, 3.6, 0.4, 4.2, C.gun, { axis: 'z', n: 12, rough: 0.3 });
      B.cyl(0, 0, 2.3, 0.56, 1.3, lin(0x2e2a2c), { axis: 'z', n: 12, rough: 0.45, metal: 0.7 });
      for (const z of [3.2, 3.9, 4.6]) B.cyl(0, 0, z, 0.47, 0.12, DARK, { axis: 'z', n: 12 });
      B.box(0, 0, 5.75, 1.2, 0.8, 0.7, DARK, { b: 0.09, rough: 0.4 }); B.box(0, 0, 5.75, 1.26, 0.3, 0.36, BLACK, { edge: 0 });
      for (const t of [1, -1]) B.piston(t * 0.52, 0.6, 1.5, t * 0.52, 0.6, 3.6, 0.09, C.frame2, STEEL);
      B.cyl(s * -0.8, -0.2, 0.5, 0.5, 0.5, C.brass, { axis: 'x', n: 10, rough: 0.4, metal: 0.9 });        // shell drum
      B.chan('heat').cyl(0, 0, 6.11, 0.3, 0.02, mul3(HEAT, 1.2), { axis: 'z', n: 12 }).chan('a');
      B.socket('muzzleR', 0, 0, 6.15); B.socket('handR', 0, 0, 6.2);
    } else {
      // LEFT: crusher claw with a twin gun on top
      FRAME(); B.box(0, 0, 1.0, 0.8, 0.8, 2.0, C.frame, { b: 0.08 }); B.cyl(0, 0, 2.15, 0.5, 0.4, C.frame2, { axis: 'z', n: 10 });
      PAINT();
      B.box(0, 0.05, 1.0, 1.15, 1.1, 1.6, C.arm, { b: 0.11, tz: 0.85 });
      B.box(0, 0.7, 0.3, 0.6, 0.4, 1.2, C.armL, { b: 0.07, tz: 0.3, oz: -0.35 });
      strip(B, s * 0.58, 0.05, 1.0, 1.0, 0.08, [0, s * H, 0], GLOW);
      for (const t of [1, -1]) {
        B.box(t * 0.55, 0, 3.1, 0.34, 0.95, 1.9, C.armL, { b: 0.08, r: [0, t * -0.16, 0] });
        BARE(); B.box(t * 0.38, 0, 4.25, 0.26, 0.75, 1.0, STEEL, { b: 0.05, tz: 0.12, tx: 0.5, r: [0, t * -0.45, 0], rough: 0.3, metal: 1 }); PAINT();
        for (let i = 0; i < 3; i++) B.box(t * 0.36, -0.3 + i * 0.3, 3.3, 0.12, 0.16, 0.3, C.bone, { tz: 0.2, r: [0, t * -1.2, 0], rough: 0.6, metal: 0.1 });   // teeth
      }
      B.box(0, 0.55, 2.7, 1.1, 0.22, 1.0, C.armD, { b: 0.06 });
      BARE(); for (const t of [1, -1]) { B.cyl(t * 0.2, 0.85, 2.6, 0.11, 1.8, C.gun, { axis: 'z', n: 8, rough: 0.3 }); B.cyl(t * 0.2, 0.85, 3.45, 0.15, 0.2, DARK, { axis: 'z', n: 8 }); }
      PAINT(); B.box(0, 0.85, 1.6, 0.7, 0.4, 0.9, C.armD, { b: 0.06 });
      B.chan('heat').box(0, 0.85, 3.56, 0.56, 0.12, 0.01, mul3(HEAT, 1.1)).chan('a');
      B.socket('muzzleL', 0, 0.85, 3.6); B.socket('handL', 0, 0, 4.4);
    }
  }
  // small manoeuvring jets low on the back
  for (const s of [1, -1]) {
    B.bone('jet' + (s > 0 ? 'L' : 'R'), 'torso', s * 1.3, 0.9, -1.75);
    PAINT(); B.box(0, 0, -0.1, 0.8, 0.8, 0.6, C.armD, { b: 0.08 });
    BARE(); B.cyl(0, -0.62, -0.1, 0.42, 0.5, lin(0x2c2a2a), { n: 8, r2: 0.28, rough: 0.35 });
    B.chan('jet').cyl(0, -0.84, -0.1, 0.34, 0.04, JET, { n: 8 }).chan('a');
    B.socket('jet' + (s > 0 ? 'L' : 'R'), 0, -0.9, -0.1);
  }
  return B.finish();
}
