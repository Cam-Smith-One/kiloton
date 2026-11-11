// ============================================================================
// KILOTON — models_modules.js   OWNER: MODELS.
// Hardpoint modules for the player's rigs (ids from src/rigs.js). Each module
// is its own small blueprint (bone 'm' at the mount, socket 'muzzle'), built
// once per id / slot kind / side and shared by every rig that fits it.
// Arm modules sit on the outside of the forearm (local +Z = along the forearm,
// fist front at z ~3.05); shoulder and back modules sit on a deck mount.
// Each is designed around one loud shape so it reads from the chase camera.
// ============================================================================
import { Builder, lin, mul3 } from './models_kit.js';
import { panel, groove, vent, hazard, strip, bolts, stencil, GLYPH, BLACK, YELLOW, STEEL, DARK, PA, G_ACC, C_HEAT, C_JET } from './models_parts.js';

const TAU = Math.PI * 2;
const GUN = lin(0x3a3f45), BRASS = lin(0xb08a3a), GREEN = lin(0x49ff8a);

const ARM = {
  // twin-coil energy cannon: finned housing, short fat barrel with coil rings
  pulse(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(0, 0, 0.85, 0.58, 0.72, 2.1, PA.armD, { b: 0.08 });
    B.box(0, 0.43, 0.9, 0.36, 0.2, 1.5, PA.armL, { b: 0.05 });
    for (let i = 0; i < 6; i++) B.box(s * 0.31, 0, 0.25 + i * 0.25, 0.08, 0.6, 0.1, PA.armL, { edge: 0.5 });
    vent(B, 0, 0.54, 0.5, 0.26, 0.5, 'y+', 4, PA.armD, 'heat', C_HEAT);
    strip(B, s * 0.295, 0, 1.75, 0.3, 0.07, [0, s * Math.PI / 2, 0], G_ACC);
    BARE();
    B.cyl(0, 0, 2.3, 0.21, 0.9, GUN, { axis: 'z', n: 10, rough: 0.3 });
    B.cyl(0, 0, 2.68, 0.28, 0.26, DARK, { axis: 'z', n: 10, rough: 0.35 });
    B.cyl(0, 0, 2.05, 0.27, 0.18, STEEL, { axis: 'z', n: 10 });
    for (let i = 0; i < 3; i++) B.cyl(0, 0, 2.22 + i * 0.13, 0.245, 0.05, DARK, { axis: 'z', n: 10 });
    B.chan('heat').cyl(0, 0, 2.815, 0.15, 0.02, mul3(C_HEAT, 1.2), { axis: 'z', n: 10 }).chan('glow').cyl(0, 0, 2.812, 0.2, 0.01, mul3(G_ACC, 0.5), { axis: 'z', n: 10 }).chan('a');
    FRAME(); B.tube(0, 0.28, -0.1, s * -0.48, 0.78, -0.2, 0.09, DARK); B.tube(0, 0.08, -0.15, 0, 0, 0.0, 0.14, PA.frame2);
    B.socket('muzzle', 0, 0, 2.85);
  },
  // rotary autocannon: big ammo drum, belt feed, five long thin barrels that spin
  autocannon(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(0, 0, 0.75, 0.6, 0.66, 1.5, PA.armD, { b: 0.08 });
    B.box(0, 0.4, 0.8, 0.4, 0.16, 1.0, PA.armL, { b: 0.04 });
    B.cyl(s * 0.12, -0.52, 0.55, 0.46, 0.5, PA.arm, { axis: 'x', n: 12 });                              // drum
    B.cyl(s * 0.39, -0.52, 0.55, 0.3, 0.06, PA.armL, { axis: 'x', n: 12 });
    hazard(B, s * 0.12, -0.52, 1.02, 0.4, 0.1, 'z+');
    for (let i = 0; i < 6; i++) B.box(s * 0.33, -0.3 + i * 0.07, 0.2 + i * 0.07, 0.1, 0.07, 0.16, BRASS, { rough: 0.35, metal: 0.9, r: [-0.7, 0, 0] });   // belt
    strip(B, s * 0.305, 0.12, 0.9, 0.5, 0.06, [0, s * Math.PI / 2, 0], G_ACC);
    FRAME(); B.cyl(0, 0, 1.6, 0.34, 0.3, PA.frame2, { axis: 'z', n: 10 });
    B.bone('spin', 'm', 0, 0, 1.75);
    BARE();
    for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; B.cyl(Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0.7, 0.062, 1.4, GUN, { axis: 'z', n: 6, rough: 0.3 }); }
    B.cyl(0, 0, 0.7, 0.07, 1.3, DARK, { axis: 'z', n: 6 });
    for (const z of [0.25, 0.8, 1.32]) B.cyl(0, 0, z, 0.28, 0.07, DARK, { axis: 'z', n: 10, rough: 0.4 });
    B.chan('heat').cyl(0, 0, 1.41, 0.24, 0.015, mul3(C_HEAT, 0.9), { axis: 'z', n: 10 }).chan('a');
    B.to('m'); B.socket('muzzle', 0, 0, 3.2);
  },
  // arc lance: a long open fork with a glowing core and a focusing ring at the tip
  lance(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(0, 0, 0.5, 0.56, 0.7, 1.2, PA.armD, { b: 0.08 });
    for (let i = 0; i < 4; i++) B.cyl(0, 0, 0.1 + i * 0.3, 0.42, 0.12, i % 2 ? PA.armL : PA.arm, { axis: 'z', n: 10 });     // capacitor stack
    B.box(0, 0.42, 0.5, 0.3, 0.14, 0.9, PA.armL, { b: 0.04 });
    BARE();
    for (const t of [1, -1]) {
      B.box(0, t * 0.26, 2.2, 0.16, 0.12, 2.6, GUN, { b: 0.03, tz: 1, rough: 0.3 });                     // rails
      B.box(0, t * 0.34, 1.6, 0.22, 0.1, 0.9, PA.armL, { b: 0.03 });
      for (let i = 0; i < 4; i++) B.box(0, t * 0.26, 1.4 + i * 0.5, 0.24, 0.16, 0.08, DARK, { rough: 0.4 });
    }
    B.chan('glow').box(0, 0, 2.2, 0.07, 0.07, 2.5, mul3(G_ACC, 1.3)).chan('heat').box(0, 0, 2.2, 0.12, 0.2, 2.3, mul3(C_HEAT, 0.5)).chan('a');
    B.push(0, 0, 3.45, Math.PI / 2, 0, 0); B.arc(0, 0, 0, 0.42, 0.42, -0.07, 0.07, 0, TAU, STEEL, { thick: 0.1, n: 10, inner: true, rough: 0.25, metal: 1 }); B.pop();   // focus ring
    B.chan('glow').cyl(0, 0, 3.45, 0.1, 0.05, mul3(G_ACC, 1.5), { axis: 'z', n: 8 }).chan('a');
    B.socket('muzzle', 0, 0, 3.55);
  },
  // siege cannon: one enormous barrel, block breech, slab muzzle brake, recoil cylinders
  siege(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(s * 0.1, 0.05, 0.1, 1.0, 1.05, 1.6, PA.arm, { b: 0.12 });                                      // breech
    B.box(s * 0.1, 0.62, 0.1, 0.7, 0.16, 1.2, PA.armL, { b: 0.05 });
    hazard(B, s * 0.605, 0.05, 0.1, 1.2, 0.18, s > 0 ? 'x+' : 'x-');
    hazard(B, s * 0.1, 0.05, -0.705, 0.8, 0.16, 'z-');
    bolts(B, s * 0.1, 0.705, 0.1, 0.9, 4, 'y+', STEEL, 0.05, Math.PI / 2);
    BARE();
    B.cyl(s * 0.1, 0.05, 2.35, 0.36, 3.2, GUN, { axis: 'z', n: 12, rough: 0.3 });                        // barrel
    B.cyl(s * 0.1, 0.05, 1.3, 0.46, 0.9, lin(0x33373c), { axis: 'z', n: 12, rough: 0.45, metal: 0.7 });   // sleeve
    B.cyl(s * 0.1, 0.05, 2.6, 0.41, 0.14, DARK, { axis: 'z', n: 12 });
    B.box(s * 0.1, 0.05, 3.95, 1.0, 0.62, 0.6, DARK, { b: 0.08, rough: 0.4 });                           // muzzle brake
    B.box(s * 0.1, 0.05, 3.95, 1.06, 0.26, 0.3, BLACK, { edge: 0 });
    for (const t of [1, -1]) B.piston(s * 0.1 + t * 0.42, 0.5, 0.6, s * 0.1 + t * 0.42, 0.5, 2.3, 0.08, PA.frame2, STEEL);
    B.chan('heat').cyl(s * 0.1, 0.05, 4.26, 0.26, 0.02, mul3(C_HEAT, 0.8), { axis: 'z', n: 12 }).chan('a');
    strip(B, s * 0.605, 0.4, 0.1, 0.9, 0.07, [0, s * Math.PI / 2, 0], G_ACC);
    B.socket('muzzle', s * 0.1, 0.05, 4.3);
  },
  // aegis shield: a tall hexagonal emitter slab on the forearm with three prongs; the energy disc is channel 'shield'
  shield(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(s * 0.12, 0.1, 1.3, 0.26, 2.0, 2.5, PA.arm, { b: 0.1, bz: 0.62, tz: 0.62 });                    // slab
    B.box(s * 0.27, 0.1, 1.3, 0.1, 1.3, 1.6, PA.armL, { b: 0.04, bz: 0.6, tz: 0.6 });
    strip(B, s * 0.325, 0.1, 1.3, 0.1, 1.0, [0, s * Math.PI / 2, 0], G_ACC);
    strip(B, s * 0.325, 0.1, 1.3, 1.2, 0.08, [0, s * Math.PI / 2, 0], G_ACC);
    hazard(B, s * 0.255, -0.72, 1.3, 1.2, 0.12, s > 0 ? 'x+' : 'x-');
    FRAME(); B.box(s * -0.1, 0, 1.0, 0.3, 0.4, 1.0, PA.frame2, { b: 0.05 });
    BARE();
    for (const [y, z] of [[1.0, 2.2], [-0.8, 2.2], [0.1, 2.75]]) { B.box(s * 0.12, y, z, 0.12, 0.12, 0.6, STEEL, { b: 0.03 }); B.chan('glow').box(s * 0.12, y, z + 0.33, 0.1, 0.1, 0.06, mul3(G_ACC, 1.2)).chan('a'); }
    // energy disc in front of the fist, centred on the forearm axis
    B.chan('shield');
    const cx = s * -0.78, R = 2.7;
    B.cyl(cx, 0.1, 3.7, R, 0.02, [0.06, 0.06, 0.06], { axis: 'z', n: 6, ph: 0 });
    B.push(cx, 0.1, 3.7, Math.PI / 2, 0, 0);
    for (const [r, k] of [[R, 1.6], [R * 0.66, 0.7], [R * 0.33, 0.7]]) B.arc(0, 0, 0, r, r, -0.03, 0.03, 0, TAU, [k, k, k], { thick: 0, n: 6, tr: 1 });
    B.pop();
    for (let i = 0; i < 3; i++) B.box(cx, 0.1, 3.71, R * 1.9, 0.04, 0.02, [0.3, 0.3, 0.3], { r: [0, 0, i * Math.PI / 3] });
    B.chan('a');
    B.socket('muzzle', cx, 0.1, 3.75);
  },
  // grapple claw: cable drum on the forearm, harpoon head with three hooked talons out past the fist
  grapple(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(0, 0, 0.6, 0.5, 0.6, 1.2, PA.armD, { b: 0.07 });
    B.cyl(0, 0, 0.7, 0.5, 0.36, PA.arm, { axis: 'x', n: 12 });                                           // drum cheeks
    FRAME(); B.cyl(0, 0, 0.7, 0.42, 0.44, lin(0x2a2520), { axis: 'x', n: 12, rough: 0.9, metal: 0.1 });   // wound cable
    BARE(); B.cyl(s * 0.24, 0, 0.7, 0.16, 0.06, STEEL, { axis: 'x', n: 8 });
    B.cyl(0, 0, 1.9, 0.11, 1.6, GUN, { axis: 'z', n: 8, rough: 0.3 });                                   // launch tube
    B.cyl(0, 0, 2.75, 0.2, 0.3, DARK, { axis: 'z', n: 8 });
    B.cyl(0, 0, 3.05, 0.14, 0.4, STEEL, { axis: 'z', n: 8, r2: 0.03 });                                  // harpoon tip
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU + Math.PI / 2, cx = Math.cos(a), cy = Math.sin(a);
      B.tube(cx * 0.16, cy * 0.16, 2.7, cx * 0.5, cy * 0.5, 3.15, 0.07, STEEL, { n: 4, rough: 0.25, metal: 1 });
      B.tube(cx * 0.5, cy * 0.5, 3.15, cx * 0.2, cy * 0.2, 3.6, 0.06, STEEL, { n: 4, r2: 0.015, rough: 0.25, metal: 1 });
    }
    PAINT(); hazard(B, s * 0.255, 0, 1.0, 0.5, 0.1, s > 0 ? 'x+' : 'x-');
    strip(B, 0, 0.305, 0.3, 0.3, 0.06, 'y+', G_ACC);
    B.socket('muzzle', 0, 0, 3.6);
  },
};

const DECK = {
  // hailstorm: a fat box with six big tubes
  salvo(B, s, PAINT, FRAME, BARE) {
    FRAME();
    B.box(0, 0.1, -0.1, 0.7, 0.3, 0.9, PA.frame2, { b: 0.06 });
    B.cyl(0, 0.2, -0.1, 0.3, 1.0, PA.frame, { axis: 'x', n: 8 });
    PAINT();
    B.box(0, 0.56, 0.1, 1.55, 0.86, 2.1, PA.arm, { b: 0.1 });
    B.box(0, 0.56, 1.12, 1.45, 0.76, 0.1, BLACK, { edge: 0.1, rough: 0.8, metal: 0.3 });
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const tx = -0.45 + c * 0.45, ty = 0.38 + r * 0.36;
      B.cyl(tx, ty, 1.15, 0.165, 0.1, PA.armD, { axis: 'z', n: 8, edge: 0.5 });
      B.cyl(tx, ty, 1.17, 0.11, 0.12, PA.rocket, { axis: 'z', n: 8, r2: 0.03, rough: 0.4, metal: 0.2 });
    }
    B.box(0, 1.02, 0.1, 1.3, 0.1, 1.7, PA.armL, { b: 0.04 });
    groove(B, 0, 1.075, 0.1, 1.2, 0.03, 'y+'); groove(B, 0, 1.075, 0.6, 1.2, 0.03, 'y+'); groove(B, 0, 1.075, -0.4, 1.2, 0.03, 'y+');
    hazard(B, 0, 1.075, -0.75, 1.2, 0.14, 'y+');
    strip(B, s * 0.78, 0.56, 0.1, 1.5, 0.07, s > 0 ? 'x+' : 'x-', G_ACC);
    panel(B, s * -0.775, 0.56, 0.1, 1.2, 0.4, s > 0 ? 'x-' : 'x+', PA.armD, 0.04);
    stencil(B, s * 0.79, 0.82, -0.5, s > 0 ? 'x+' : 'x-', GLYPH.BAR3, 0.06, PA.red);
    vent(B, 0, 0.56, -0.95, 1.2, 0.6, 'z-', 4, PA.armD);
    B.socket('muzzle', 0, 0.56, 1.3);
  },
  // skylance: four long white missiles on an open rail frame raked up at the sky
  skylance(B, s, PAINT, FRAME, BARE) {
    FRAME();
    B.cyl(0, 0.08, 0, 0.42, 0.16, PA.frame2, { n: 10 });
    B.box(0, 0.3, 0, 0.3, 0.4, 0.5, PA.frame, { b: 0.05 });
    B.box(s * 0.55, 0.45, -0.55, 0.12, 0.6, 0.12, PA.frame2, {}); PAINT(); B.cyl(s * 0.55, 0.85, -0.5, 0.26, 0.08, PA.armL, { axis: 'z', n: 8, r2: 0.16 }); FRAME();
    B.push(0, 0.5, 0, -0.6, 0, 0);
    B.box(0, 0, 0, 1.25, 0.12, 1.7, PA.frame2, { b: 0.04 });
    PAINT();
    for (const t of [1, -1]) B.box(t * 0.66, 0.2, 0, 0.1, 0.6, 1.6, PA.arm, { b: 0.04, tz: 0.85 });
    B.box(0, 0.2, -0.82, 1.3, 0.55, 0.14, PA.armL, { b: 0.05 });
    hazard(B, 0, 0.2, -0.895, 1.0, 0.14, 'z-');
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
      const mx = -0.3 + c * 0.6, my = 0.17 + r * 0.32;
      B.cyl(mx, my, 0.15, 0.13, 1.9, PA.rocket, { axis: 'z', n: 8, rough: 0.4, metal: 0.2 });
      B.cyl(mx, my, 1.25, 0.13, 0.32, PA.red, { axis: 'z', n: 8, r2: 0.02, rough: 0.4, metal: 0.2 });
      B.cyl(mx, my, 0.75, 0.135, 0.1, PA.acc, { axis: 'z', n: 8 });
      for (const f of [0, 1]) B.box(mx, my, -0.7, f ? 0.4 : 0.03, f ? 0.03 : 0.4, 0.25, PA.armD, { edge: 0.4 });
    }
    strip(B, 0.715, 0.2, 0.1, 1.1, 0.06, 'x+', G_ACC); strip(B, -0.715, 0.2, 0.1, 1.1, 0.06, 'x-', G_ACC);
    B.socket('muzzle', 0, 0.33, 1.5, -0.6, 0, 0);
    B.pop();
  },
  // swarm rack: a wide, thin honeycomb slab tipped up, with a hinged lid standing open behind it
  swarm(B, s, PAINT, FRAME, BARE) {
    FRAME(); B.box(0, 0.15, -0.2, 0.5, 0.3, 0.7, PA.frame2, { b: 0.05 }); B.cyl(0, 0.3, -0.2, 0.2, 1.5, PA.frame, { axis: 'x', n: 8 });
    B.push(0, 0.42, 0, -0.42, 0, 0);
    PAINT();
    B.box(0, 0.2, 0.15, 1.9, 0.5, 1.5, PA.arm, { b: 0.07 });
    B.box(0, 0.2, 0.91, 1.8, 0.42, 0.04, BLACK, { edge: 0.1 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) {
      const tx = -0.77 + c * 0.22 + (r % 2 ? 0.055 : -0.055), ty = 0.07 + r * 0.13;
      B.cyl(tx, ty, 0.93, 0.05, 0.06, PA.red, { axis: 'z', n: 6, r2: 0.012, rough: 0.4, metal: 0.2 });
    }
    B.box(0, 0.62, -0.5, 1.9, 0.5, 0.06, PA.armL, { b: 0.025, r: [0.55, 0, 0] });                        // open lid
    for (const t of [1, -1]) { B.box(t * 1.0, 0.2, 0.15, 0.1, 0.62, 1.2, PA.armL, { b: 0.04, tz: 0.7 }); strip(B, t * 1.055, 0.2, 0.15, 0.8, 0.06, t > 0 ? 'x+' : 'x-', G_ACC); }
    hazard(B, 0, 0.455, 0.5, 1.6, 0.12, 'y+');
    B.socket('muzzle', 0, 0.2, 1.0, -0.42, 0, 0);
    B.pop();
  },
  // thunder mortar: one fat stubby tube pointing steeply up from a turntable, spring recuperators either side
  mortar(B, s, PAINT, FRAME, BARE) {
    FRAME(); B.cyl(0, 0.1, 0, 0.72, 0.2, PA.frame2, { n: 12 }); B.box(0, 0.3, -0.1, 1.2, 0.3, 0.9, PA.frame, { b: 0.06 });
    PAINT();
    for (const t of [1, -1]) B.box(t * 0.62, 0.62, -0.05, 0.16, 0.9, 0.9, PA.arm, { b: 0.06, tz: 0.6 });   // trunnion cheeks
    B.push(0, 0.55, -0.05, 0.6, 0, 0);
    BARE();
    B.cyl(0, 0.5, 0, 0.46, 1.3, GUN, { n: 12, rough: 0.35 });                                            // tube
    B.cyl(0, 1.1, 0, 0.54, 0.2, DARK, { n: 12 });
    B.cyl(0, -0.05, 0, 0.5, 0.3, PA.armD, { n: 12 });
    for (const t of [1, -1]) B.piston(t * 0.56, 0.0, 0, t * 0.56, 0.9, 0, 0.07, PA.frame2, STEEL);
    PAINT(); B.cyl(0, 0.6, 0, 0.5, 0.22, PA.armL, { n: 12 });
    B.push(0, 0.85, 0); hazard(B, 0, 0, 0.47, 0.6, 0.14, 'z+'); hazard(B, 0, 0, -0.47, 0.6, 0.14, 'z-'); B.pop();
    B.chan('heat').cyl(0, 1.205, 0, 0.4, 0.015, mul3(C_HEAT, 0.6), { n: 12 }).chan('a');
    B.socket('muzzle', 0, 1.25, 0, -0.97, 0, 0);
    B.pop();
    strip(B, 0, 0.3, 0.355, 0.8, 0.06, 'z+', G_ACC);
  },
  // repair nanites: three upright tanks with glowing sight bands and a manifold
  nanite(B, s, PAINT, FRAME, BARE) {
    FRAME(); B.box(0, 0.14, 0, 1.5, 0.28, 0.7, PA.frame2, { b: 0.06 });
    for (const x of [-0.5, 0, 0.5]) {
      PAINT(); B.limb(x, 0.3, 0, x, 1.15 + (x ? 0 : 0.2), 0, 0.23, 0.23, PA.armL, { n: 10, end: 0.5 });
      B.chan('heat').arc(x, 0.75, 0, 0.24, 0.24, -0.12, 0.12, 0, TAU, mul3(GREEN, 1.4), { thick: 0, n: 10 }).chan('a');
      BARE(); B.cyl(x, 1.42 + (x ? 0 : 0.2), 0, 0.07, 0.14, STEEL, { n: 6 });
    }
    FRAME(); B.tube(-0.5, 1.45, 0, 0.5, 1.45, 0, 0.05, DARK); B.tube(0, 1.5, 0, 0, 1.2, 0.4, 0.05, DARK);
    PAINT(); B.box(0, 0.42, 0.3, 1.3, 0.3, 0.12, PA.arm, { b: 0.04 }); stencil(B, 0, 0.42, 0.365, 'z+', GLYPH.ARROW, 0.05);
    B.socket('muzzle', 0, 1.0, 0);
  },
  // jet booster: a big third thruster bell between two spherical fuel tanks
  booster(B, s, PAINT, FRAME, BARE) {
    PAINT();
    B.box(0, 0.45, -0.1, 1.0, 0.9, 0.8, PA.arm, { b: 0.1 });
    for (const t of [1, -1]) { B.lathe(t * 0.78, 0.55, -0.05, [[-0.4, 0.1], [-0.28, 0.33], [0, 0.42], [0.28, 0.33], [0.4, 0.1]], PA.armL, { n: 10 }); hazard(B, t * 0.78, 0.55, 0.42, 0.4, 0.1, 'z+'); }
    strip(B, 0, 0.75, 0.305, 0.6, 0.07, 'z+', G_ACC);
    B.push(0, 0.3, -0.5, 0.75, 0, 0);
    BARE();
    B.cyl(0, -0.3, 0, 0.34, 0.4, DARK, { n: 12, rough: 0.4 });
    B.cyl(0, -0.75, 0, 0.62, 0.6, lin(0x33373c), { n: 12, r2: 0.36, rough: 0.35 });
    B.cyl(0, -1.05, 0, 0.64, 0.06, STEEL, { n: 12 });
    B.chan('jet').cyl(0, -1.0, 0, 0.52, 0.04, C_JET, { n: 12 }).chan('a');
    B.socket('muzzle', 0, -1.1, 0);
    B.pop();
  },
  // overcharged reactor: a fan of tall radiator blades with a hot core between them
  reactor(B, s, PAINT, FRAME, BARE) {
    FRAME(); B.box(0, 0.25, 0, 1.3, 0.5, 0.8, PA.frame, { b: 0.08 });
    B.chan('heat').box(0, 0.55, 0, 1.0, 0.16, 0.5, mul3(C_HEAT, 1.2)).chan('a');
    PAINT();
    for (let i = 0; i < 7; i++) {
      const u = (i - 3) / 3;
      B.box(u * 0.55, 1.15 - Math.abs(u) * 0.25, -0.1, 0.07, 1.5 - Math.abs(u) * 0.4, 0.75, i % 2 ? PA.armL : PA.arm, { r: [0.12, 0, -u * 0.5], tz: 0.55, oz: -0.2, edge: 0.6, b: 0.02 });
    }
    B.chan('heat'); for (let i = 0; i < 6; i++) { const u = (i - 2.5) / 3; B.box(u * 0.5, 0.85, -0.1, 0.04, 0.5, 0.3, mul3(C_HEAT, 0.8), { r: [0.12, 0, -u * 0.5] }); } B.chan('a');
    hazard(B, 0, 0.25, 0.405, 1.0, 0.12, 'z+');
    B.socket('muzzle', 0, 1.0, 0);
  },
};

/** kind: 'arm' | 'sh' | 'back'; s: +1 left (+X), -1 right. Returns a blueprint or null for 'none' / unknown ids. */
export function buildModule(id, kind, s) {
  const fn = kind === 'arm' ? ARM[id] : DECK[id];
  if (!fn) return null;
  const B = new Builder({ seed: 300 + id.length * 7 + (s > 0 ? 1 : 2), uvScale: 0.2, bevelK: 1.5 });
  const PAINT = () => B.mat(0.5, 0.35, 0.42), FRAME = () => B.mat(0.72, 0.6, 0.18), BARE = () => B.mat(0.22, 1, 0.3);
  B.bone('m', null, 0, 0, 0);
  fn(B, s, PAINT, FRAME, BARE);
  return B.finish();
}

/** torn-off limb stump: ragged collar, bent struts, glowing core; socket 'sparks' */
export function buildStump() {
  const B = new Builder({ seed: 911, uvScale: 0.2 });
  B.bone('m', null, 0, 0, 0); B.mat(0.8, 0.6, 0.3);
  B.cyl(0, 0, 0.1, 0.42, 0.3, lin(0x15171a), { axis: 'z', n: 7 });
  for (let i = 0; i < 6; i++) { const a = i * 1.05 + 0.3, l = 0.3 + (i * 37 % 5) * 0.09; B.tube(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.2, Math.cos(a + 0.5) * 0.42, Math.sin(a + 0.5) * 0.42, 0.2 + l, 0.045, i % 2 ? STEEL : DARK, { n: 4 }); }
  B.tube(0, 0, 0.2, 0.15, -0.5, 0.5, 0.06, DARK, { n: 5 }); B.tube(0.1, 0.1, 0.2, -0.2, -0.6, 0.35, 0.04, lin(0x2a2520), { n: 4 });
  B.chan('heat').cyl(0, 0, 0.27, 0.26, 0.02, mul3(C_HEAT, 3), { axis: 'z', n: 7 }).chan('a');
  B.socket('sparks', 0, 0, 0.35);
  return B.finish();
}
