// BASELINE models (lead). Box rigs with the contract's interface.
import { THREE } from '../core.js';
const DIM = { pilot: [0.35, 1.8, 0x39c6b0], soldier: [0.35, 1.8, 0xb0413a], mech: [1.8, 8.5, 0x4d6a86], emech: [1.8, 8.5, 0x7a2f2a], tank: [2.2, 2.6, 0x5b5148], drone: [0.9, 0.7, 0x66343a], gunship: [3.2, 2.6, 0x55343a] };
export default {
  name: 'models', init() {}, reset() {}, DIM,
  create(kind) {
    const d = DIM[kind] || DIM.soldier, root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(d[0] * 2, d[1], d[0] * 1.4), new THREE.MeshStandardMaterial({ color: d[2] }));
    body.position.y = d[1] / 2; root.add(body);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(d[0] * 0.5, d[1] * 0.12, d[0]), new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0x554400 }));
    nose.position.set(0, d[1] * 0.8, d[0]); root.add(nose);
    const sock = (x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); root.add(o); return o; };
    const sockets = { muzzleL: sock(-d[0], d[1] * 0.7, d[0]), muzzleR: sock(d[0], d[1] * 0.7, d[0]), rocketPod: sock(-d[0], d[1], 0), aaPod: sock(d[0], d[1], 0), cockpit: sock(0, d[1] * 0.8, 0), handR: sock(d[0], d[1] * 0.5, d[0]), handL: sock(-d[0], d[1] * 0.5, d[0]), jetL: sock(-d[0] * 0.6, d[1] * 0.55, -d[0]), jetR: sock(d[0] * 0.6, d[1] * 0.55, -d[0]), eye: sock(0, d[1] * 0.9, d[0] * 0.5), footL: sock(-d[0] * 0.5, 0, 0), footR: sock(d[0] * 0.5, 0, 0) };
    return { kind, root, sockets, radius: d[0], height: d[1], update() {}, trigger() {}, setTint() {}, dispose() { root.removeFromParent(); } };
  },
};
