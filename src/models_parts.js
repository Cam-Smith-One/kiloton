// ============================================================================
// KILOTON — models_parts.js   OWNER: MODELS.
// Reusable surface-detail helpers on top of the Builder (panels, vents, hazard
// stripes, glow strips, bolts). Each helper draws in a local frame whose +Z is
// the outward normal of the surface it sits on.
// ============================================================================
import { lin, paintCol, accentCol } from './models_kit.js';

export const BLACK = lin(0x0c0d0f), YELLOW = lin(0xd9a012), WHITE = lin(0xc9cdcf), STEEL = lin(0x8d949b), DARK = lin(0x17191c), RUBBER = lin(0x101113);

const FACE = { 'z+': [0, 0, 0], 'z-': [0, Math.PI, 0], 'x+': [0, Math.PI / 2, 0], 'x-': [0, -Math.PI / 2, 0], 'y+': [-Math.PI / 2, 0, 0], 'y-': [Math.PI / 2, 0, 0] };
/** enter a surface frame at (x,y,z) facing `f` (string or euler array), extra roll about the normal */
export function face(B, x, y, z, f, roll = 0) {
  const r = typeof f === 'string' ? FACE[f] : f;
  B.push(x, y, z, r[0], r[1], r[2]);
  if (roll) B.push(0, 0, 0, 0, 0, roll);
  B._faceRoll = B._faceRoll || []; B._faceRoll.push(roll ? 2 : 1);
  return B;
}
export function unface(B) { let n = B._faceRoll.pop(); while (n--) B.pop(); return B; }

/** raised armour panel */
export function panel(B, x, y, z, w, h, f, col, t = 0.05, o) {
  face(B, x, y, z, f); B.box(0, 0, t / 2, w, h, t, col, Object.assign({ b: Math.min(0.03, t * 0.45) }, o)); return unface(B);
}
/** recessed dark groove (panel line) */
export function groove(B, x, y, z, w, h, f, roll = 0) {
  face(B, x, y, z, f, roll); B.box(0, 0, 0.004, w, h, 0.012, BLACK, { edge: 0, jit: 0, rough: 0.9, metal: 0.2 }); return unface(B);
}
/** louvred vent: dark recess with n slats; optional heat glow behind (channel) */
export function vent(B, x, y, z, w, h, f, n, col, glowCh, glowCol) {
  face(B, x, y, z, f);
  B.box(0, 0, 0.01, w, h, 0.03, BLACK, { edge: 0, jit: 0, rough: 0.9, metal: 0.2 });
  if (glowCh) { B.chan(glowCh); B.box(0, 0, 0.03, w * 0.9, h * 0.9, 0.02, glowCol); B.chan('a'); }
  const sh = h / n;
  for (let i = 0; i < n; i++) B.box(0, -h / 2 + sh * (i + 0.5), 0.07, w, sh * 0.5, 0.07, col, { r: [0.55, 0, 0], edge: 0.5, b: 0 });
  // frame
  B.box(-w / 2 - 0.03, 0, 0.05, 0.06, h + 0.12, 0.1, col, { b: 0.015 }); B.box(w / 2 + 0.03, 0, 0.05, 0.06, h + 0.12, 0.1, col, { b: 0.015 });
  B.box(0, h / 2 + 0.03, 0.05, w, 0.06, 0.1, col, { b: 0.015 }); B.box(0, -h / 2 - 0.03, 0.05, w, 0.06, 0.1, col, { b: 0.015 });
  return unface(B);
}
/** hazard chevron band */
export function hazard(B, x, y, z, w, h, f, roll = 0, colA = YELLOW) {
  face(B, x, y, z, f, roll);
  B.box(0, 0, 0.008, w, h, 0.016, BLACK, { edge: 0, jit: 0, rough: 0.8, metal: 0.1 });
  const n = Math.max(2, Math.round(w / (h * 0.9))), sw = w / n;
  for (let i = 0; i < n; i++) B.box(-w / 2 + sw * (i + 0.5) - sw * 0.22, 0, 0.018, sw * 0.5, h, 0.012, colA, { ox: sw * 0.44, edge: 0, jit: 0.03, rough: 0.65, metal: 0.1 });
  return unface(B);
}
/** emissive strip in a dark bezel */
export function strip(B, x, y, z, w, h, f, col, ch = 'glow', roll = 0) {
  face(B, x, y, z, f, roll);
  B.box(0, 0, 0.012, w + 0.06, h + 0.06, 0.024, BLACK, { edge: 0.2, jit: 0, rough: 0.6, metal: 0.5 });
  B.chan(ch); B.box(0, 0, 0.03, w, h, 0.03, col); B.chan('a');
  return unface(B);
}
/** row of bolt heads along local x */
export function bolts(B, x, y, z, len, n, f, col = STEEL, r = 0.035, roll = 0) {
  face(B, x, y, z, f, roll);
  for (let i = 0; i < n; i++) B.cyl(n === 1 ? 0 : -len / 2 + len * i / (n - 1), 0, 0.012, r, 0.03, col, { axis: 'z', n: 6, rough: 0.3, metal: 1, jit: 0.1 });
  return unface(B);
}
/** stencilled marking: a row of small light blocks (reads as lettering / unit code at distance) */
export function stencil(B, x, y, z, f, pattern, s = 0.09, col = WHITE, roll = 0) {
  face(B, x, y, z, f, roll);
  const rows = pattern.length, cols = pattern[0].length;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (pattern[r][c] !== ' ') B.box((c - (cols - 1) / 2) * s, ((rows - 1) / 2 - r) * s, 0.006, s * 0.92, s * 0.92, 0.012, col, { edge: 0, jit: 0.04, rough: 0.7, metal: 0.05 });
  return unface(B);
}
export const GLYPH = {
  W7: ['# # # ###', '# # #   #', '# # #  # ', '## ##  # ', '#   #  # '],
  V: ['#   #', '#   #', ' # # ', ' # # ', '  #  '],
  BAR3: ['# # #', '# # #', '# # #'],
  ARROW: ['  #  ', ' ### ', '# # #', '  #  ', '  #  '],
  K: ['#  #', '# # ', '##  ', '# # ', '#  #'],
};

// ---- player-rig palette: armour takes the instance paint (pm 1), accent panels the accent (pm 2); emissives are
// neutral intensities multiplied by the accent colour on the per-instance glow material.
export const PA = { arm: paintCol(1.15), armL: paintCol(1.85), armD: paintCol(0.6), acc: accentCol(1), frame: lin(0x1c1f23), frame2: lin(0x2a2e33), rocket: lin(0xd8dadc), red: lin(0xb3261a), gun: lin(0x3a3f45) };
export const G_ACC = [2.3, 2.3, 2.3], G_SOFT = [1.25, 1.25, 1.25], C_HEAT = lin(0xff6a1c), C_JET = lin(0x8fe9ff);
