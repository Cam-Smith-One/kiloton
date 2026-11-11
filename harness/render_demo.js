// Look-dev helpers shared by the RENDER harnesses.
import { THREE, GROUND_J, GROUND_Y } from '../src/core.js';
import { MAT, M } from '../src/materials.js';

export function harnessAfter(G) {
  const P = G.params, g = G.grid;
  if (P.has('swatch')) {
    // a wall of every material, 3x3x1 voxels each, plus a few street props, around (70..110, 78)
    const ids = []; for (let id = 2; id < 64; id++) if (MAT[id]) ids.push(id);
    const k = 150, i0 = 120;
    ids.forEach((id, n) => {
      const col = n % 16, row = Math.floor(n / 16);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) g.set(i0 + col * 4 + a, GROUND_J + 1 + row * 4 + b, k, id);
    });
    for (let i = i0 - 2; i < i0 + 66; i++) for (let j = GROUND_J; j < GROUND_J + 18; j++) g.set(i, j, k + 1, M.concrete_dark);
    // a "car", a lamp, a neon sign, sidewalk strip, lane lines
    const car = (i, k2, m) => { for (let a = 0; a < 9; a++) for (let b = 0; b < 4; b++) { g.set(i + a, GROUND_J, k2 + b, (a === 1 || a === 7) && (b === 0 || b === 3) ? M.rubber : m); g.set(i + a, GROUND_J + 1, k2 + b, m); if (a > 1 && a < 7) g.set(i + a, GROUND_J + 2, k2 + b, a === 2 || a === 6 ? M.glass_dark : m); } g.set(i, GROUND_J + 1, k2 + 1, M.light_white); g.set(i, GROUND_J + 1, k2 + 2, M.light_white); g.set(i + 8, GROUND_J + 1, k2, M.light_red); g.set(i + 8, GROUND_J + 1, k2 + 3, M.light_red); };
    car(130, 132, M.car_red); car(146, 133, M.car_blue); car(164, 132, M.car_yellow);
    for (let j = GROUND_J; j < GROUND_J + 12; j++) g.set(126, j, 140, M.metal_dark);
    g.set(126, GROUND_J + 12, 139, M.metal_dark); g.set(126, GROUND_J + 11, 139, M.light_white); g.set(126, GROUND_J + 12, 138, M.metal_dark); g.set(126, GROUND_J + 11, 138, M.light_white);
    for (let i = 118; i < 190; i++) { for (let k2 = 141; k2 < 150; k2++) g.set(i, GROUND_J, k2, k2 === 141 ? M.curb : M.sidewalk); if (i % 8 < 5) g.set(i, GROUND_J - 1, 126, M.line_yellow); g.set(i, GROUND_J - 1, 118, M.line_white); }
    for (let i = 0; i < 14; i++) { g.set(132 + i, GROUND_J + 20, k, M.neon_cyan); g.set(150 + i, GROUND_J + 20, k, M.neon_magenta); if (i % 2) g.set(168 + i, GROUND_J + 20, k, M.neon_orange); }
    // a tree
    for (let j = GROUND_J; j < GROUND_J + 6; j++) g.set(184, j, 136, M.trunk);
    for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = 0; c < 5; c++) if (a * a + b * b + (c - 2) * (c - 2) * 2 < 11) g.set(184 + a, GROUND_J + 6 + c, 136 + b, M.foliage);
  }
  if (P.has('props')) {
    // stand-ins for other agents' meshes: must sit correctly in the light without special handling
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; G.scene.add(m); return m; };
    const gun = new THREE.MeshStandardMaterial({ color: 0x4a5058, metalness: 0.85, roughness: 0.42 });
    const teal = new THREE.MeshStandardMaterial({ color: 0x0a1418, emissive: 0x49e0d2, emissiveIntensity: 5 });
    const ox = new THREE.MeshStandardMaterial({ color: 0x4a1216, metalness: 0.6, roughness: 0.5 });
    const hot = new THREE.MeshStandardMaterial({ color: 0x180804, emissive: 0xff5a1e, emissiveIntensity: 6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.85 });
    const lam = new THREE.MeshLambertMaterial({ color: 0x9a9c9f });
    const px = +(P.get('px') || 70), pz = +(P.get('pz') || 62), y = GROUND_Y;
    // 8.5 m "rig" stand-in
    add(new THREE.BoxGeometry(1.1, 3.6, 1.3), gun, px - 1.0, y + 1.8, pz); add(new THREE.BoxGeometry(1.1, 3.6, 1.3), gun, px + 1.0, y + 1.8, pz);
    add(new THREE.BoxGeometry(3.6, 2.6, 2.4), gun, px, y + 5.0, pz); add(new THREE.BoxGeometry(1.6, 1.3, 1.6), gun, px, y + 7.0, pz);
    add(new THREE.BoxGeometry(1.0, 3.4, 1.0), gun, px - 2.5, y + 4.4, pz); add(new THREE.BoxGeometry(1.0, 3.4, 1.0), gun, px + 2.5, y + 4.4, pz);
    add(new THREE.BoxGeometry(3.0, 0.14, 0.1), teal, px, y + 5.6, pz - 1.22); add(new THREE.BoxGeometry(0.9, 0.3, 0.1), teal, px, y + 7.0, pz + 0.82);
    // Vanta stand-in
    add(new THREE.BoxGeometry(3.2, 5.5, 2.4), ox, px + 12, y + 2.75, pz + 2); add(new THREE.BoxGeometry(2.4, 0.18, 0.1), hot, px + 12, y + 4.2, pz + 0.78);
    // matte reference blocks: standard and lambert, 1.8 m "pilot"
    add(new THREE.BoxGeometry(2, 2, 2), white, px + 5, y + 1, pz - 2); add(new THREE.BoxGeometry(2, 2, 2), lam, px + 5, y + 1, pz + 2);
    add(new THREE.BoxGeometry(0.6, 1.8, 0.4), white, px - 5, y + 0.9, pz + 1);
    add(new THREE.SphereGeometry(1.2, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.15 }), px + 5, y + 3.4, pz - 2);
  }
  if (P.has('flash')) {
    const [fx, fy, fz] = (P.get('flashpos') || '80,5,70').split(',').map(Number);
    setInterval(() => { G.render.flash(fx, fy, fz, 0xffb060, 3, 22, 3.0); G.render.flash(fx + 14, fy, fz + 6, 0x49e0d2, 2, 12, 3.0); }, 400);
  }
  if (P.has('boom')) {
    const [x, y, z, r] = P.get('boom').split(',').map(Number);
    setTimeout(() => G.boom(x, y, z, { radius: r || 6, power: 200 }), 1500);
  }
}
