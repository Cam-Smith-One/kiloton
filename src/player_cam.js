// ============================================================================
// KILOTON — player_cam.js   OWNER: PLAYER
// Third-person camera: over-the-shoulder boom with voxel collision, crosshair
// ray -> aim point, recoil, FOV kicks, trauma shake, title and wreck orbits.
// The gameplay code (player.js) sets `follow` targets; this file owns G.camera.
// ============================================================================
import { G, THREE, input, clamp, damp, WX, WZ, GROUND_Y } from './core.js';

const _v = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _o = new THREE.Vector3();
const SENS = 0.0022;                       // rad per mouse count at settings.sens = 1

// Boom presets. up: pivot height above the feet, side: shoulder offset (to the character's right),
// dist: boom length, fov: base vertical fov, rad: collision probe half-size, lag: follow stiffness.
export const CAM_PRESET = {
  pilot: { up: 1.9, side: 0.8, dist: 3.4, fov: 64, rad: 0.2, lag: 26, pMin: -1.35, pMax: 1.3 },
  mech: { up: 8.7, side: 3.9, dist: 14.5, fov: 68, rad: 0.45, lag: 11, pMin: -1.1, pMax: 1.15 },
};

function noise(t, s) { return Math.sin(t * 37.1 + s) * 0.55 + Math.sin(t * 61.7 + s * 2.3) * 0.3 + Math.sin(t * 17.3 + s * 5.1) * 0.15; }

export const cam = {
  yaw: 0, pitch: 0,
  up: 1.9, side: 0.8, want: 3.4, dist: 3.4, fovBase: 64, rad: 0.2, lag: 26, pMin: -1.35, pMax: 1.3,
  focus: new THREE.Vector3(), target: new THREE.Vector3(), hasFocus: false,
  pivot: new THREE.Vector3(), pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1),
  trauma: 0, fovKick: 0, fovAdd: 0, recoilP: 0, recoilY: 0, dip: 0, low: 0, lowCur: 0, autoShoulder: false, scale: 1, sideWant: 1, sideSign: 1, swapT: 0, t: 0, orbit: 0,
  aim: { point: new THREE.Vector3(), hit: false, ent: null, dist: 0, nx: 0, ny: 1, nz: 0, mat: 0 },
  closeness: 1,                     // dist / want  (player.js hides the pilot model when the boom is nearly collapsed)

  reset(yaw) {
    this.yaw = yaw || 0; this.pitch = -0.06; this.trauma = 0; this.fovKick = 0; this.fovAdd = 0; this.recoilP = this.recoilY = 0; this.dip = 0;
    this.hasFocus = false; this.sideWant = this.sideSign = 1; this.swapT = 0; this.low = this.lowCur = 0; this.setPreset('pilot', true);
  },
  setPreset(name, snap) {
    const p = CAM_PRESET[name]; this.preset = p;
    if (snap) { this.up = p.up; this.side = p.side; this.want = this.dist = p.dist; this.fovBase = p.fov; this.rad = p.rad; this.lag = p.lag; }
    this.pMin = p.pMin; this.pMax = p.pMax;
  },
  shake(a) { this.trauma = Math.min(1, this.trauma + a); },
  // shake from a world event: amount at the source, falloff range in metres
  shakeAt(a, x, y, z, range) {
    const dx = x - this.focus.x, dy = y - this.focus.y, dz = z - this.focus.z;
    const q = Math.sqrt(dx * dx + dy * dy + dz * dz) / range;
    this.shake(a / (1 + q * q * 3));
  },
  kickFov(deg) { this.fovKick = Math.max(this.fovKick, deg); },
  recoil(pitch, yaw) { this.recoilP += pitch; this.recoilY += yaw; },

  // mouse look
  look(enabled) {
    if (!enabled) return;
    const s = G.state.settings, k = SENS * (s.sens || 1);
    const mx = clamp(input.mdx, -400, 400), my = clamp(input.mdy, -400, 400);
    this.yaw -= mx * k;
    if (this.yaw > Math.PI) this.yaw -= Math.PI * 2; else if (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
    this.pitch = clamp(this.pitch - my * k * (s.invertY ? -1 : 1), this.pMin, this.pMax);
  },

  // ---- gameplay camera: follow `target` (feet position) --------------------
  update(dt, target, snap) {
    const g = G.grid, p = this.preset, raw = G.rawDt || dt;
    this.t += raw;
    // ease boom parameters toward the active preset (pilot <-> rig transitions)
    const k = snap ? 1 : 1 - Math.exp(-4.5 * raw);
    const sc = p === CAM_PRESET.mech ? this.scale : 1;
    this.up += (p.up * sc - this.up) * k; this.side += (p.side * sc - this.side) * k; this.want += (p.dist * sc - this.want) * k;
    this.fovBase += (p.fov - this.fovBase) * k; this.rad += (p.rad - this.rad) * k; this.lag += (p.lag - this.lag) * k;
    // follow
    if (!this.hasFocus || snap) { this.focus.copy(target); this.hasFocus = true; }
    else {
      const kf = 1 - Math.exp(-this.lag * raw), ky = 1 - Math.exp(-this.lag * 0.6 * raw);
      this.focus.x += (target.x - this.focus.x) * kf; this.focus.z += (target.z - this.focus.z) * kf;
      this.focus.y += (target.y - this.focus.y) * ky;
      // never let the focus trail far behind a fast body (eject, dash)
      const lim = 2.5 + this.want * 0.25, dy = target.y - this.focus.y;
      if (dy > lim) this.focus.y = target.y - lim; else if (dy < -lim) this.focus.y = target.y + lim;
    }
    // recoil / dip recovery
    this.recoilP = damp(this.recoilP, 0, 9, raw); this.recoilY = damp(this.recoilY, 0, 9, raw); this.dip = damp(this.dip, 0, 7, raw);
    const pitch = clamp(this.pitch + this.recoilP, -1.5, 1.5), yaw = this.yaw + this.recoilY;
    const cp = Math.cos(pitch), d = this.dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
    _r.set(-Math.cos(yaw), 0, Math.sin(yaw));               // character's right
    // head point, then slide out to the shoulder as far as the voxels allow
    const hx = this.focus.x, hy = this.focus.y + this.up - this.dip - (this.lowCur = damp(this.lowCur, this.low, 12, raw)), hz = this.focus.z;
    // shoulder swap: if a wall right beside us blocks the crosshair from this shoulder but not from the other, change sides
    let h;
    if (this.autoShoulder) {
      const sw = this.sideWant, s0 = this.side;
      const bA = g.raycast(hx + _r.x * s0 * sw, hy, hz + _r.z * s0 * sw, d.x, d.y, d.z, 2.4).hit;
      if (bA) {
        const bB = g.raycast(hx - _r.x * s0 * sw, hy, hz - _r.z * s0 * sw, d.x, d.y, d.z, 2.4).hit;
        if (!bB) { this.swapT += raw; if (this.swapT > 0.12) { this.sideWant = -sw; this.swapT = 0; } } else this.swapT = 0;
      } else if (sw < 0) {
        // back to the default (right) shoulder once it has been clear for a moment
        const bR = g.raycast(hx + _r.x * s0, hy, hz + _r.z * s0, d.x, d.y, d.z, 4).hit;
        if (!bR) { this.swapT += raw; if (this.swapT > 0.7) { this.sideWant = 1; this.swapT = 0; } } else this.swapT = 0;
      } else this.swapT = 0;
    } else this.sideWant = 1;
    this.sideSign = damp(this.sideSign, this.sideWant, 9, raw);
    const sg = this.sideSign < 0 ? -1 : 1;
    let side = this.side * Math.abs(this.sideSign);
    h = g.raycast(hx, hy, hz, _r.x * sg, 0, _r.z * sg, side + this.rad + 0.15);
    if (h.hit) side = Math.max(0, h.dist - this.rad - 0.15);
    side *= sg;
    this.pivot.set(hx + _r.x * side, hy, hz + _r.z * side);
    // boom: centre ray plus four probes at the near-plane corners
    _u.crossVectors(d, _r).normalize();                     // camera up-ish (d x right)
    if (_u.y < 0) _u.negate();
    let want = this.want, best = want;
    const rad = this.rad, pv = this.pivot;
    for (let n = 0; n < 5; n++) {
      const sx = n === 1 ? rad : n === 2 ? -rad : 0, sy = n === 3 ? rad : n === 4 ? -rad : 0;
      _o.set(pv.x + _r.x * sx + _u.x * sy, pv.y + _u.y * sy, pv.z + _r.z * sx + _u.z * sy);
      if (n > 0 && g.solidAt(_o.x, _o.y, _o.z)) continue;
      h = g.raycast(_o.x, _o.y, _o.z, -d.x, -d.y, -d.z, want + 0.4);
      if (h.hit) { const dd = h.dist - 0.3; if (dd < best) best = dd; }
    }
    if (best < 0.2) best = 0.2;
    if (best < this.dist || snap) this.dist = best; else this.dist = Math.min(best, damp(this.dist, best, 5, raw));
    this.closeness = this.dist / Math.max(0.1, want);
    this.pos.set(pv.x - d.x * this.dist, pv.y - d.y * this.dist, pv.z - d.z * this.dist);

    // crosshair ray. The boom is clear between camera and pivot, so start at the pivot (skips the player's own body).
    const a = this.aim, R = 420;
    h = g.raycast(pv.x, pv.y, pv.z, d.x, d.y, d.z, R);
    let ad = R; a.hit = false; a.ent = null; a.nx = 0; a.ny = 1; a.nz = 0; a.mat = 0;
    if (h.hit) { ad = h.dist; a.hit = true; a.nx = h.nx; a.ny = h.ny; a.nz = h.nz; a.mat = h.mat; }
    const eh = G.ents.raycast(pv.x, pv.y, pv.z, d.x, d.y, d.z, ad, null, 0);
    if (eh) { ad = eh.dist; a.ent = eh.ent; a.hit = true; a.nx = -d.x; a.ny = -d.y; a.nz = -d.z; }
    a.dist = ad; a.point.set(pv.x + d.x * ad, pv.y + d.y * ad, pv.z + d.z * ad);

    this.apply(raw, 1);
  },

  // ---- cinematic orbits ----------------------------------------------------
  updateTitle(dt) {
    const raw = G.rawDt || dt; this.t += raw; this.orbit += raw * 0.045;
    const cx = WX / 2, cz = WZ / 2, a = this.orbit + 0.6, r = 92 + Math.sin(this.orbit * 0.7) * 14;
    this.pos.set(cx + Math.sin(a) * r, 50 + Math.sin(this.orbit * 0.9) * 7, cz + Math.cos(a) * r);
    _v.set(cx + Math.sin(a + 1.9) * 12, 13, cz + Math.cos(a + 1.9) * 12);
    this.dir.subVectors(_v, this.pos).normalize();
    this.fovBase = damp(this.fovBase, 50, 2, raw); this.hasFocus = false;
    this.apply(raw, 0);
  },
  updateOver(dt, centre, radius) {
    const raw = G.rawDt || dt, g = G.grid; this.t += raw; this.orbit += raw * 0.22;
    if (!this.hasFocus) { this.focus.copy(centre); this.hasFocus = true; }
    this.focus.lerp(centre, 1 - Math.exp(-3 * raw));
    const a = this.orbit, cy = this.focus.y + 1.4;
    _v.set(Math.sin(a) * 0.86, 0.5, Math.cos(a) * 0.86).normalize();
    let want = radius || 9.5;
    const h = g.raycast(this.focus.x, cy, this.focus.z, _v.x, _v.y, _v.z, want + 0.4);
    if (h.hit) want = Math.max(0.6, h.dist - 0.35);
    this.dist = want < this.dist ? want : damp(this.dist, want, 3, raw);
    this.pos.set(this.focus.x + _v.x * this.dist, cy + _v.y * this.dist, this.focus.z + _v.z * this.dist);
    this.dir.copy(_v).negate();
    this.fovBase = damp(this.fovBase, 58, 2, raw);
    this.apply(raw, 0.5);
  },

  // write G.camera (position, orientation, fov) with shake on top
  apply(raw, shakeScale) {
    const c = G.camera, s = G.state.settings;
    this.trauma = Math.max(0, this.trauma - raw * 1.35);
    this.fovKick = damp(this.fovKick, 0, 4.5, raw);
    const a = this.trauma * this.trauma * (s.shake == null ? 1 : s.shake) * shakeScale, t = this.t;
    const amp = 0.05 + this.dist * 0.022;                 // positional shake grows a little with the boom length
    c.position.set(this.pos.x + noise(t, 1.3) * a * amp, this.pos.y + noise(t, 7.7) * a * amp, this.pos.z + noise(t, 13.1) * a * amp);
    _v.copy(c.position).add(this.dir);
    c.up.set(0, 1, 0); c.lookAt(_v);
    if (a > 0.0005) { c.rotateX(noise(t, 21.9) * a * 0.03); c.rotateY(noise(t, 33.3) * a * 0.03); c.rotateZ(noise(t, 45.1) * a * 0.045); }
    const fov = clamp(this.fovBase + this.fovAdd + this.fovKick, 30, 110);
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
  },
};
