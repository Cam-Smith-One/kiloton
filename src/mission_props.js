// ============================================================================
// KILOTON — mission_props.js   OWNER: MISSION
// Small three.js props for the operation: the friendly uplink relay, the
// citadel command core, and the objective light beams. Chunky box-built shapes
// (they stand in a voxel world), emissive parts brighter than 1.0 so they bloom.
// If MODELS ships a 'relay' kind it is used instead of the built-in one.
// ============================================================================
import { G, THREE, clamp } from './core.js';

const RS = {};

let geoBox = null, geoBeam = null;
const mats = {};
function mat(key, make) { return mats[key] || (mats[key] = make()); }
function std(key, color, rough, metal) { return mat(key, () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })); }
function glow(r, g, b) { return new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false }); }
function bx(parent, m, w, h, d, x, y, z) {
  const o = new THREE.Mesh(geoBox || (geoBox = new THREE.BoxGeometry(1, 1, 1)), m);
  o.scale.set(w, h, d); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
}

/** Friendly uplink relay: drum base, lattice column, slow-turning dish, cyan core. Origin at the feet. */
export function makeRelay() {
  try {
    if (G.models && G.models.DIM && G.models.DIM.relay) {                  // MODELS' field relay (6 m): scaled up a little so it reads across the plaza
      const r = G.models.create('relay'), K = 1.5;
      if (r && r.root) {
        r.root.scale.setScalar(K);
        return { root: r.root, rig: r, height: (r.height || 6) * K, radius: (r.radius || 1) * K,
          update(dt, k, on) { if (r.setDamage) r.setDamage(on ? clamp(1 - k, 0, 0.97) : 0); r.update(dt, RS); },
          hit() { if (r.trigger) r.trigger('hit'); }, die() { if (r.trigger) r.trigger('death'); },
          dispose() { r.root.removeFromParent(); if (r.dispose) r.dispose(); } };
      }
    }
  } catch (e) { /* fall through to the built-in prop */ }
  const root = new THREE.Group();
  const hull = std('hull', 0x4c5661, 0.55, 0.7), dark = std('dark', 0x23282e, 0.6, 0.6), pale = std('pale', 0x9aa5ae, 0.45, 0.5);
  const cy = glow(0.25, 1.9, 2.3), cyDim = glow(0.05, 0.25, 0.3);
  const lights = [];
  bx(root, dark, 3.0, 0.5, 3.0, 0, 0.25, 0);
  bx(root, hull, 2.4, 0.9, 2.4, 0, 0.95, 0);
  for (const [x, z] of [[1.25, 0], [-1.25, 0], [0, 1.25], [0, -1.25]]) bx(root, pale, x ? 0.3 : 1.2, 1.1, x ? 1.2 : 0.3, x, 0.85, z);
  lights.push(bx(root, cy, 2.5, 0.14, 2.5, 0, 1.45, 0));
  bx(root, dark, 1.5, 0.5, 1.5, 0, 1.75, 0);
  for (const [x, z] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]]) bx(root, hull, 0.22, 3.4, 0.22, x, 3.7, z);
  for (let n = 0; n < 3; n++) bx(root, dark, 1.3, 0.14, 1.3, 0, 2.7 + n * 1.0, 0);
  lights.push(bx(root, cy, 0.5, 3.2, 0.5, 0, 3.7, 0));                       // core column inside the lattice
  bx(root, hull, 1.7, 0.4, 1.7, 0, 5.6, 0);
  const head = new THREE.Group(); head.position.set(0, 5.9, 0); root.add(head);
  bx(head, dark, 0.5, 0.9, 0.5, 0, 0.4, 0);
  const dish = new THREE.Group(); dish.position.set(0, 0.95, 0.2); dish.rotation.x = -0.55; head.add(dish);
  bx(dish, pale, 2.6, 2.6, 0.18, 0, 0, 0); bx(dish, hull, 3.2, 0.5, 0.2, 0, 0, 0.06); bx(dish, hull, 0.5, 3.2, 0.2, 0, 0, 0.06);
  bx(dish, dark, 0.16, 0.16, 1.2, 0, 0, 0.7); lights.push(bx(dish, cy, 0.34, 0.34, 0.34, 0, 0, 1.35));
  bx(root, dark, 0.12, 1.9, 0.12, -0.6, 6.9, -0.6);
  const tip = bx(root, cy, 0.24, 0.24, 0.24, -0.6, 7.95, -0.6);
  let t = 0;
  return {
    root, height: 8, radius: 1.5,
    update(dt, k, on) {                              // k = hp fraction, on = uplink powered
      t += dt; head.rotation.y += dt * (on ? 0.5 : 0.08);
      const hurt = k < 0.35 && Math.sin(t * 23) > 0.2;
      for (const l of lights) l.material = on && !hurt ? cy : cyDim;
      tip.visible = on ? (t * 1.4) % 1 < 0.5 : false;
    },
    hit() {}, die() { root.rotation.z = 0.5; for (const l of lights) l.material = cyDim; tip.visible = false; this.update = () => {}; },
    dispose() { root.removeFromParent(); },
  };
}

/** Vanta command core: oxblood cage around stacked counter-rotating orange blocks. Sits over the voxel core. */
export function makeCore() {
  const root = new THREE.Group();
  const ox = std('ox', 0x3a1518, 0.5, 0.7), hot = glow(3.2, 0.9, 0.2), hotDim = glow(0.5, 0.12, 0.04);
  const parts = [];
  for (let n = 0; n < 3; n++) { const g = new THREE.Group(); g.position.y = 0.75 + n * 0.75; g.rotation.y = n * 0.5; root.add(g); bx(g, hot, 1.25 - n * 0.2, 0.5, 1.25 - n * 0.2, 0, 0, 0).castShadow = false; parts.push(g); }
  for (const [x, z] of [[1.1, 1.1], [-1.1, 1.1], [1.1, -1.1], [-1.1, -1.1]]) bx(root, ox, 0.3, 2.9, 0.3, x, 1.45, z);
  bx(root, ox, 2.6, 0.25, 2.6, 0, 2.95, 0);
  let t = 0;
  return {
    root, height: 3, radius: 1.4,
    update(dt, k, on) { t += dt; for (let n = 0; n < parts.length; n++) { parts[n].rotation.y += dt * (n & 1 ? -1.6 : 1.3) * (on ? 1 : 0.2); parts[n].children[0].material = on && !(k < 0.3 && Math.sin(t * 31) > 0) ? hot : hotDim; } },
    dispose() { root.removeFromParent(); },
  };
}

/** Objective beam: a faint additive column so a set piece reads from across the district. */
export function makeBeam(team, height) {
  const m = new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.2, 1.2, 1.5) : new THREE.Color(1.8, 0.5, 0.1), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const o = new THREE.Mesh(geoBeam || (geoBeam = new THREE.CylinderGeometry(0.35, 0.35, 1, 8, 1, true)), m);
  o.scale.y = height; o.position.y = height / 2; o.renderOrder = 4; o.frustumCulled = false;
  return o;
}
export function disposeProps() { /* geometries / materials are shared and tiny: kept for the next run */ }
