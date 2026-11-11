// ============================================================================
// KILOTON — models_biped.js   OWNER: MODELS.
// Procedural animation for two-legged units. Walker = gait + leg IK + body
// springs (shared by rigs and infantry). MechRig = the rig's upper body,
// one-shot actions (punch, slam, grab, recoil, boot, death) and emissives.
// Nothing here allocates per frame.
// ============================================================================
import { THREE, clamp, damp, dampAngle, wrapPi } from './core.js';
import { spring, keys, legIK, ease, flareGeo, glowMat, instantiate } from './models_kit.js';

const _v = new THREE.Vector3(), _qi = new THREE.Quaternion();
const TAU = Math.PI * 2;
const frac = x => x - Math.floor(x);

export class Walker {
  constructor(inst, cfg, scale = 1) {
    this.cfg = cfg; this.scale = scale; this.n = inst.nodes; this.inst = inst;
    this.root = new THREE.Group();
    inst.root.scale.setScalar(scale); this.root.add(inst.root);
    this.sockets = inst.sockets;
    this.onFootstep = null;
    this.phase = 0; this.amp = 0; this.stride = 0; this.dx = 0; this.dz = 1; this.air = 0; this.gspeed = 0;
    this.prevP = new Float32Array([0, 0.5]);
    this.fx = new Float32Array(2); this.fy = new Float32Array(2); this.fz = new Float32Array(2);
    this.fp = new Float32Array(2); this.fam = new Float32Array(2);
    this.dip = { x: 0, v: 0 }; this.pit = { x: 0, v: 0 }; this.rol = { x: 0, v: 0 };
    this.lastYaw = null; this.yawRate = 0; this.prevSpeed = 0; this.acc = 0; this.t = Math.random() * 20;
    this.ik = new Float32Array(5);
    this.wasGrounded = true; this.prevVy = 0; this.lastLandT = -9;
    this.footPos = new THREE.Vector3();
    this.legs = [
      { hip: this.n.hipL, thigh: this.n.thighL, shin: this.n.shinL, meta: this.n.metaL || null, foot: this.n.footL || null, side: 'L', sx: 1 },
      { hip: this.n.hipR, thigh: this.n.thighR, shin: this.n.shinR, meta: this.n.metaR || null, foot: this.n.footR || null, side: 'R', sx: -1 },
    ];
    this.n.pelvis.rotation.order = 'YXZ';
  }
  /** advance the gait; fills foot targets (body space, sole centre) and returns nothing. */
  gait(dt, s, frozen) {
    const c = this.cfg, sc = this.scale;
    const grounded = s.grounded !== false;
    const speed = frozen ? 0 : Math.max(0, (s.speed || 0)) / sc;
    // movement direction in model space (strafe + = right = -X)
    let ix = -(s.strafe || 0), iz = s.fwd == null ? 1 : s.fwd, il = Math.hypot(ix, iz);
    if (il > 0.1 && speed > 0.1) { ix /= il; iz /= il; this.dx = damp(this.dx, ix, 9, dt); this.dz = damp(this.dz, iz, 9, dt); }
    // yaw rate from the owner's root rotation (stepping in place while turning)
    const yaw = this.root.rotation.y;
    if (this.lastYaw == null) this.lastYaw = yaw;
    const yr = dt > 1e-5 ? wrapPi(yaw - this.lastYaw) / dt : 0; this.lastYaw = yaw;
    this.yawRate = damp(this.yawRate, yr, 10, dt);
    this.acc = damp(this.acc, dt > 1e-5 ? (speed - this.prevSpeed) / dt : 0, 6, dt); this.prevSpeed = speed;
    this.air = damp(this.air, grounded ? 0 : 1, grounded ? 16 : 7, dt);
    const moving = grounded && speed > 0.2;
    const turning = grounded && !moving && !frozen && Math.abs(this.yawRate) > 0.4;
    const S = Math.min(c.strideMax, c.s0 + c.sk * speed);
    let T = clamp(S / (Math.max(speed, 0.01) * c.duty), c.Tmin, c.Tmax); if (turning) T = c.Tturn;
    const Sact = moving ? Math.min(S, speed * c.duty * T) : 0;
    this.stride = damp(this.stride, Sact, 7, dt);
    this.amp = damp(this.amp, moving || turning ? 1 : 0, moving ? 9 : 5, dt);
    this.gspeed = speed;
    if (moving || turning || this.amp > 0.04) this.phase = frac(this.phase + dt / T);
    const liftK = turning && !moving ? 0.45 : clamp(0.45 + this.stride / c.strideMax * 0.75, 0.45, 1);
    for (let i = 0; i < 2; i++) {
      const p = frac(this.phase + i * 0.5);
      let along, lift = 0, pitch = 0, am = 0;
      if (p < c.duty) {
        const u = p / c.duty; along = 0.5 - u;
        if (u > 0.72) { const r = (u - 0.72) / 0.28; pitch = r * r * 0.5; am = -0.28 * r * r; }
        else if (u < 0.1) pitch = -0.18 * (1 - u / 0.1);
      } else {
        const w = (p - c.duty) / (1 - c.duty); along = -0.5 + ease(w);
        lift = Math.sin(Math.PI * Math.pow(w, 0.85)); lift = lift * (0.35 + 0.65 * lift);
        pitch = 0.5 + (-0.18 - 0.5) * ease(Math.min(1, w * 1.15)); am = -0.28 * (1 - w) * (1 - w) + 0.4 * Math.sin(Math.PI * w);
      }
      const a = this.amp;
      this.fx[i] = (i ? -c.homeX : c.homeX) + this.dx * along * this.stride;
      this.fz[i] = c.homeZ + this.dz * along * this.stride;
      this.fy[i] = lift * c.stepH * liftK * a;
      this.fp[i] = pitch * a * Math.min(1, 0.3 + this.stride / (c.strideMax * 0.6));
      this.fam[i] = am * a;
      // foot plant
      if (p < this.prevP[i] && a > 0.35 && grounded) {
        const k = 0.45 + 0.55 * Math.min(1, this.stride / c.strideMax);
        this.dip.v -= c.stepImpulse * k;
        this.rol.v += (i ? -1 : 1) * 0.12 * k * (c.heavy ? 1 : 0.4);
        if (this.onFootstep) {
          this.root.updateWorldMatrix(true, false);
          this.footPos.set(this.fx[i] * sc, 0, this.fz[i] * sc).applyMatrix4(this.root.matrixWorld);
          this.onFootstep(i ? 'R' : 'L', this.footPos, !!c.heavy);
        }
      }
      this.prevP[i] = p;
    }
    // landing detection (if the owner never sends 'land')
    if (grounded && !this.wasGrounded && this.t - this.lastLandT > 0.25) this.land(clamp(-this.prevVy / (c.heavy ? 22 : 12), 0.15, 1));
    this.wasGrounded = grounded; this.prevVy = s.vy || 0;
  }
  land(strength) { this.lastLandT = this.t; this.dip.v -= (this.cfg.landV || 4.6) * clamp(strength == null ? 0.6 : strength, 0, 1.3); }
  /**
   * Place the pelvis (body space) and solve both legs to the current foot targets.
   * hang: distance hip->sole used while airborne; hz: foot z offset in the air; hp: foot pitch in the air.
   */
  placeLegs(px, py, pz, pitch, roll, yaw, hang, hz, hp) {
    const c = this.cfg, pel = this.n.pelvis, air = this.air;
    pel.position.set(px, py, pz); pel.rotation.set(pitch, yaw, roll);
    _qi.copy(pel.quaternion).invert();
    for (let i = 0; i < 2; i++) {
      const L = this.legs[i];
      // blend ground target and airborne hang pose
      let tx = this.fx[i], ty = this.fy[i], tz = this.fz[i], fp = this.fp[i], am = c.am + this.fam[i];
      if (air > 0.002) {
        const hx = (i ? -c.homeX : c.homeX) * 0.92 + px, hy = py + c.hipY - hang - (i ? 0.0 : 0.12 * (c.heavy ? 1 : 0.3)), hzz = pz + hz + (i ? 0.25 : -0.1) * (c.heavy ? 1 : 0.25);
        tx += (hx - tx) * air; ty += (hy - ty) * air; tz += (hzz - tz) * air; fp += (hp - fp) * air; am += (c.amAir == null ? 0.25 : c.amAir) * air;
      }
      // ankle rises as the foot pitches about toe / heel
      const ay = ty + c.ankle + (fp > 0 ? Math.sin(fp) * c.toeLen : Math.sin(-fp) * c.toeLen * 0.5);
      _v.set(tx - px, ay - py, tz - pz).applyQuaternion(_qi);
      const dx = _v.x - L.sx * c.hipX, dy = _v.y - c.hipY, dz = _v.z;
      const k = legIK(dx, dy, dz, c.l1, c.l2, c.meta, am, this.ik);
      L.hip.rotation.z = k[0]; L.thigh.rotation.x = k[1]; L.shin.rotation.x = k[2];
      if (L.meta) L.meta.rotation.x = k[3];
      if (L.foot) { L.foot.rotation.x = fp + am - pitch; L.foot.rotation.z = -k[0] - roll; }
      else if (c.footOnShin) { /* boot is part of the shin: nothing to do */ }
    }
  }
}

// ---- key curves (module constants: no per-frame arrays) -----------------------
const K_P_SH = [0, 0, 0.16, 0.6, 0.26, -1.42, 0.42, -1.36, 0.85, 0];        // shoulder pitch offset (rot.x)
const K_P_EL = [0, 0, 0.16, -0.6, 0.26, 1.22, 0.42, 1.15, 0.85, 0];         // elbow
const K_P_TW = [0, 0, 0.16, 0.42, 0.27, -0.5, 0.45, -0.42, 0.9, 0];         // torso twist (x side sign)
const K_P_TP = [0, 0, 0.16, -0.07, 0.27, 0.17, 0.45, 0.12, 0.9, 0];         // torso pitch
const K_P_LZ = [0, 0, 0.16, -0.22, 0.28, 0.5, 0.45, 0.42, 0.9, 0];          // pelvis lunge z
const K_P_W = [0, 0, 0.1, 1, 0.5, 1, 0.85, 0];                              // weight of the punch pose over aim
const K_S_SH = [0, -0.5, 0.12, -0.35, 0.3, -0.5, 0.75, 0];                  // slam impact: shoulder (added to raise blend)
const K_S_W = [0, 1, 0.3, 1, 0.8, 0];
const K_T_SH = [0, -1.15, 0.16, -2.0, 0.3, -0.55, 0.42, -0.5, 0.7, 0];      // throw
const K_T_EL = [0, 0.35, 0.16, -0.3, 0.3, 1.0, 0.42, 0.9, 0.7, 0];
const K_T_W = [0, 1, 0.42, 1, 0.7, 0];
const K_BOOT_C = [0, 1, 0.35, 1, 1.5, 0];                                   // boot: crouch/slump weight
const K_BOOT_G = [0, 0, 0.12, 0.6, 0.18, 0.05, 0.32, 0.8, 0.4, 0.15, 0.6, 1.25, 0.8, 0.9, 1.2, 1];   // boot: glow flicker
const K_D_DROP = [0, 0, 0.25, 0.12, 0.7, 0.55, 1.05, 1.06, 1.25, 0.96, 1.5, 1];     // death: knees buckle (0..1 of deathDrop)
const K_D_TP = [0, 0, 0.3, -0.12, 0.9, 0.25, 1.4, 0.62, 1.7, 0.55];
const K_D_G = [0, 1, 0.1, 0.2, 0.2, 1.1, 0.35, 0.1, 0.5, 0.8, 0.7, 0.05, 0.9, 0.45, 1.2, 0];
const K_LAND_SH = [0, 0, 0.12, 0.25, 0.6, 0];

export class MechRig extends Walker {
  constructor(kind, bp, cfg, mats, scale, team, accent) {
    const glows = { glow: glowMat(), heat: glowMat(), jet: glowMat(), shield: null };
    const inst = instantiate(bp, mats, glows);
    super(inst, cfg, scale);
    this.kind = kind; this.mats = mats; this.glows = glows; this.team = team;
    this.accent = accent || null;                 // THREE.Color (linear): painted rigs bake neutral emissives
    this.mods = {}; this.slotKick = { shL: 0, shR: 0, back: 0 }; this.spins = []; this.shieldV = 0; this.shieldSlot = null; this.shieldMesh = null; this.lost = [false, false]; this.stumps = [null, null];
    this.mounts = { armL: inst.nodes.mArmL, armR: inst.nodes.mArmR, shL: inst.nodes.mShL, shR: inst.nodes.mShR, back: inst.nodes.mBack };
    this.radius = cfg.radius; this.height = cfg.height;
    const n = this.n;
    n.torso.rotation.order = 'YXZ';
    this.arms = [{ sh: n.shL, fa: n.faL, faZ: n.faL.position.z }, { sh: n.shR, fa: n.faR, faZ: n.faR.position.z }];
    for (const a of this.arms) a.sh.rotation.order = 'YXZ';
    // jet flares
    this.flares = [];
    for (const k of ['jetL', 'jetR']) {
      if (!n[k]) continue;
      const f = new THREE.Mesh(flareGeo(), team ? mats.flareHot : mats.flare); f.position.copy(inst.sockets[k].position); f.visible = false; f.frustumCulled = false;
      n[k].add(f); this.flares.push(f);
    }
    this.plates = []; for (const k in n) if (k.startsWith('plate')) this.plates.push(n[k]);
    this.yaw = 0; this.pitch = 0; this.heat = 0; this.jet = 0;
    this.rec = new Float32Array(2); this.punchT = new Float32Array([-1, -1]);
    this.podKick = 0; this.rackKick = 0;
    this.slam = 0; this.slamT = 0; this.slamUp = 0;
    this.hold = 0; this.holdTarget = 0; this.throwT = -1; this.grabT = -1;
    this.bootT = -1; this.canopy = 0; this.canopyTarget = 0;
    this.deathT = -1; this.damage = 0; this.power = 1; this.landT = -1;
    this.tp = { x: 0, v: 0 }; this.tr = { x: 0, v: 0 };            // torso flinch springs
    this.deadSide = 1;
    this.update(0, IDLE);
  }
  trigger(name, arg) {
    switch (name) {
      case 'fireL': if (this.mods.armL && this.mods.armL.spin) this.mods.armL.spinV = 34; this.rec[0] = 1; this.tp.v -= 0.5; this.tr.v += 0.35; break;
      case 'fireR': if (this.mods.armR && this.mods.armR.spin) this.mods.armR.spinV = 34; this.rec[1] = 1; this.tp.v -= 0.5; this.tr.v -= 0.35; break;
      case 'fire': {
        if (arg === 'armL') return this.trigger('fireL'); if (arg === 'armR') return this.trigger('fireR');
        if (!this.mounts[arg] && this.n.pod) { this.podKick = 1; this.tp.v -= 1.2; break; }
        if (arg in this.slotKick) { this.slotKick[arg] = 1; const m = this.mods[arg]; if (m && m.spin) m.spinV = 30; this.tp.v -= arg === 'back' ? 1.4 : 1.0; this.tr.v += arg === 'shL' ? 0.5 : arg === 'shR' ? -0.5 : 0; }
        break;
      }
      case 'fireRocket': if (this.rocketSlot) return this.trigger('fire', this.rocketSlot); this.podKick = 1; this.tp.v -= 1.2; this.tr.v += 0.5 * (this.cfg.podSide || 1); break;
      case 'fireAA': if (this.aaSlot) return this.trigger('fire', this.aaSlot); this.rackKick = 1; this.tp.v += 0.8; this.tr.v -= 0.4 * (this.cfg.podSide || 1); break;
      case 'punch': { const i = arg === 'R' ? 1 : 0; this.punchT[i] = 0; break; }
      case 'slam': this.slam = 1; this.slamT = 0; break;
      case 'land': this.land(arg == null ? 0.7 : arg); this.landT = 0; break;
      case 'hit': { const a = Math.random() * 6.283, k = typeof arg === 'number' ? clamp(arg, 0.2, 2) : 1; this.tp.v += Math.cos(a) * 2.2 * k; this.tr.v += Math.sin(a) * 2.2 * k; this.dip.v -= 0.5 * k; break; }
      case 'grab': this.holdTarget = 1; this.grabT = 0; this.throwT = -1; break;
      case 'throw': this.holdTarget = 0; this.throwT = 0; this.hold = 0; break;
      case 'drop': this.holdTarget = 0; break;
      case 'jump': this.dip.v -= 2.4; break;
      case 'boot': this.bootT = 0; this.deathT = -1; break;
      case 'open': this.canopyTarget = 1; break;
      case 'close': this.canopyTarget = 0; break;
      case 'death': if (this.deathT < 0) { this.deathT = 0; this.deadSide = Math.random() < 0.5 ? -1 : 1; } break;
      case 'revive': this.deathT = -1; break;
    }
  }
  setDamage(d) {
    d = clamp(d || 0, 0, 1);
    if (Math.abs(d - this.damage) < 0.004 && d !== 0 && d !== 1) return;
    this.damage = d;
    const A = this.inst.armor, m = this.mats.armor;
    for (let i = 0; i < A.length; i++) {
      const h = frac(i * 0.61803 + 0.137);
      A[i].material = d > 0.62 + 0.36 * h ? m[2] : d > 0.22 + 0.5 * h ? m[1] : m[0];
    }
    for (const k in this.mods) { const a = this.mods[k].armor; for (let i = 0; i < a.length; i++) a[i].material = d > 0.75 ? m[2] : d > 0.4 ? m[1] : m[0]; }
    const pa = this.cfg.plateAt;
    for (let i = 0; i < this.plates.length; i++) this.plates[i].visible = d < (pa ? pa[i] : 0.3 + 0.6 * (i + 0.5) / this.plates.length);
    if (this.cfg.hotShift) (this.accent || (this.accent = new THREE.Color())).setRGB(1 + d * 0.5, 1 + d * 1.6, 1 + d * 3.0);   // emissives run from red-orange to white-hot
  }
  update(dt, s) {
    const c = this.cfg, n = this.n;
    this.t += dt; const t = this.t;
    if (s.dead && this.deathT < 0) this.trigger('death');
    const dead = this.deathT >= 0;
    if (dead) this.deathT += dt;
    this.gait(dt, s, dead);
    const grounded = s.grounded !== false, air = this.air, amp = this.amp;
    const sN = Math.min(1, this.stride / c.strideMax);

    // ---- timers ---------------------------------------------------------------
    this.rec[0] = damp(this.rec[0], 0, 9, dt); this.rec[1] = damp(this.rec[1], 0, 9, dt);
    this.podKick = damp(this.podKick, 0, 6, dt); this.rackKick = damp(this.rackKick, 0, 6, dt);
    for (let i = 0; i < 2; i++) if (this.punchT[i] >= 0) { this.punchT[i] += dt; if (this.punchT[i] > 0.9) this.punchT[i] = -1; }
    if (this.throwT >= 0) { this.throwT += dt; if (this.throwT > 0.7) this.throwT = -1; }
    if (this.grabT >= 0) { this.grabT += dt; if (this.grabT > 0.5) this.grabT = -1; }
    if (this.landT >= 0) { this.landT += dt; if (this.landT > 0.6) this.landT = -1; }
    if (this.bootT >= 0) { this.bootT += dt; if (this.bootT > 1.6) this.bootT = -1; }
    this.hold = damp(this.hold, this.holdTarget, 9, dt);
    this.canopy = damp(this.canopy, this.canopyTarget, 5, dt);
    // slam: 1 = raised (in the air), 2 = impact follow-through
    if (this.slam === 1) { this.slamT += dt; if ((grounded && this.slamT > 0.22) || this.slamT > 3) { this.slam = 2; this.slamT = 0; this.dip.v -= 5.5; this.tp.v += 3; } }
    else if (this.slam === 2) { this.slamT += dt; if (this.slamT > 0.8) this.slam = 0; }
    this.slamUp = damp(this.slamUp, this.slam === 1 ? 1 : 0, this.slam === 1 ? 12 : 20, dt);
    const slamW = this.slam === 2 ? keys(this.slamT, K_S_W) : 0;

    // ---- springs ---------------------------------------------------------------
    spring(this.dip, 0, c.dipK, c.dipC, dt);
    spring(this.rol, 0, 70, 9, dt);
    spring(this.tp, 0, 90, 11, dt); spring(this.tr, 0, 90, 11, dt);
    if (this.dip.x < -1.5) { this.dip.x = -1.5; if (this.dip.v < 0) this.dip.v = 0; }

    // ---- aim --------------------------------------------------------------------
    if (!dead) { this.yaw = dampAngle(this.yaw, s.aimYaw || 0, 16, dt); this.pitch = damp(this.pitch, clamp(s.aimPitch || 0, -1.0, 1.1), 16, dt); }
    this.heat = damp(this.heat, s.heat || 0, 5, dt);
    this.jet = damp(this.jet, dead ? 0 : (s.jet || 0), 14, dt);

    // ---- boot / death weights ------------------------------------------------------
    const bootC = this.bootT >= 0 ? keys(this.bootT, K_BOOT_C) : 0;
    const dT = dead ? this.deathT : 0, dDrop = dead ? keys(dT, K_D_DROP) : 0, dTP = dead ? keys(dT, K_D_TP) : 0;
    let power = 1;
    if (this.bootT >= 0) power = keys(this.bootT, K_BOOT_G);
    if (dead) power = keys(dT, K_D_G);
    this.power = power;

    // ---- pelvis ---------------------------------------------------------------------
    const ph = this.phase;
    const bob = -c.bob * Math.cos(2 * TAU * ph) * amp * (0.35 + 0.65 * sN);
    const breathe = Math.sin(t * 1.45) * 0.022 * (1 - dDrop);
    let crouch = bootC * 0.85 + dDrop * c.deathDrop + slamW * 0.5 + this.hold * 0.12 + amp * 0.1 * sN;
    let pz = 0, pPitch = 0, pYaw = 0, tTwist = 0, tPitch = 0;
    for (let i = 0; i < 2; i++) {
      const pt = this.punchT[i]; if (pt < 0) continue;
      const sg = i ? -1 : 1;
      pz += keys(pt, K_P_LZ); tTwist += sg * keys(pt, K_P_TW); tPitch += keys(pt, K_P_TP); pYaw += sg * keys(pt, K_P_TW) * 0.25;
    }
    const lean = clamp(this.gspeed * c.leanK * this.dz + this.acc * 0.006, -0.12, 0.2) * (1 - air);
    this.pit.x = damp(this.pit.x, lean, 6, dt);
    const py = c.hipH + (bob + this.dip.x + breathe) * (1 - air * 0.6) - crouch * (1 - air);
    const px = c.sway * Math.sin(TAU * (ph - 0.05)) * amp * (0.4 + 0.6 * sN) + dDrop * 0.25 * this.deadSide;
    const pRoll = c.roll * Math.sin(TAU * (ph - 0.05)) * amp + this.rol.x * 0.35 + dDrop * 0.14 * this.deadSide - this.dx * 0.03 * amp * sN;
    pYaw += c.yawSw * Math.sin(TAU * (ph - 0.25)) * amp * sN;
    pPitch += this.pit.x + air * clamp(0.1 - (s.vy || 0) * 0.006, -0.1, 0.25) + dDrop * 0.22 + slamW * 0.25 + this.slamUp * -0.15;
    const vy = s.vy || 0;
    const hang = c.hangY + clamp(vy * 0.035, -0.35, 0.45) - this.slamUp * 0.7;
    this.placeLegs(px, py, pz + dDrop * 0.35, pPitch, pRoll, pYaw, hang, c.hangZ + this.slamUp * 0.9, 0.55 - this.slamUp * 0.3);

    // ---- torso ------------------------------------------------------------------------
    const tor = n.torso;
    const hum = Math.sin(t * 31) * 0.004 * power;
    tor.position.y = c.torsoY + breathe * 0.6 + hum - dDrop * 0.12;
    tor.rotation.y = this.yaw + tTwist - pYaw * 0.7;
    tor.rotation.x = -this.pitch * 0.22 + tPitch + this.tp.x * 0.05 + bootC * 0.42 + dTP + slamW * 0.5 - this.slamUp * 0.25 + amp * sN * 0.03 * Math.cos(2 * TAU * ph) - pPitch * 0.3;
    tor.rotation.z = -pRoll * 0.8 + this.tr.x * 0.05 + dDrop * 0.1 * this.deadSide;

    // ---- arms ---------------------------------------------------------------------------
    const armPitch = -this.pitch * 0.78;
    const droop = Math.max(bootC, dDrop);
    for (let i = 0; i < 2; i++) {
      const A = this.arms[i], sg = i ? -1 : 1;
      const swing = Math.sin(TAU * ph + (i ? 0 : Math.PI)) * 0.07 * amp * sN;
      let shx = armPitch + swing + Math.sin(t * 1.45 + i) * 0.012 - 0.05, el = 0, shy = 0, shz = 0;
      shx += this.rec[i] * 0.07 + this.tp.x * 0.02;
      // airborne: arms drift out and back
      shx += air * 0.12; shz += air * sg * 0.1;
      // landing brace
      if (this.landT >= 0) { const k = keys(this.landT, K_LAND_SH); shx += k; el += k * 0.6; }
      // grab / hold
      if (this.hold > 0.001) { const h = this.hold, r = this.grabT >= 0 ? Math.sin(Math.min(1, this.grabT / 0.5) * Math.PI) : 0; shx += h * (-0.45 - armPitch * 0.4 - r * 0.35); el += h * (0.5 + r * 0.35); shy += -sg * h * 0.34; }
      if (this.throwT >= 0) { const w = keys(this.throwT, K_T_W); shx = shx * (1 - w) + (keys(this.throwT, K_T_SH) + armPitch * 0.5) * w; el = el * (1 - w) + keys(this.throwT, K_T_EL) * w; shy += -sg * 0.3 * w * (1 - this.throwT / 0.7); }
      // punch
      const pt = this.punchT[i];
      if (pt >= 0) { const w = keys(pt, K_P_W); shx = shx * (1 - w * 0.5) + keys(pt, K_P_SH) + armPitch * 0.25 * w; el += keys(pt, K_P_EL); shy += -sg * 0.16 * w; }
      else if (this.punchT[1 - i] >= 0) { const w = keys(this.punchT[1 - i], K_P_W); shx += 0.3 * w; el -= 0.25 * w; }   // guard arm pulls back
      // slam
      if (this.slamUp > 0.001) { const u = this.slamUp; shx = shx * (1 - u) + (-2.55) * u; el = el * (1 - u) + 0.55 * u; shz += sg * 0.25 * u; }
      if (slamW > 0) { shx = shx * (1 - slamW) + (-0.75 + keys(this.slamT, K_S_SH)) * slamW; el = el * (1 - slamW) + 1.25 * slamW; }
      // shield arm: forearm swung across the body, disc forward
      if (this.shieldV > 0.001 && this.shieldSlot === (i ? 'armR' : 'armL')) { const v = this.shieldV; shx += -0.35 * v; shy += -sg * 0.55 * v; el += -0.15 * v; }
      // powered down / dead: hang
      if (droop > 0) { shx = shx * (1 - droop) + 0.12 * droop; el = el * (1 - droop) + 1.15 * droop; shz += -sg * 0.04 * droop; }
      A.sh.rotation.set(shx, shy, shz);
      A.fa.rotation.x = el;
      A.fa.position.z = A.faZ - this.rec[i] * 0.42;
    }
    // hardpoint modules: shoulder mounts follow a share of the aim pitch and kick on fire; rotary barrels spin down
    const sk = this.slotKick, mt = this.mounts;
    sk.shL = damp(sk.shL, 0, 6, dt); sk.shR = damp(sk.shR, 0, 6, dt); sk.back = damp(sk.back, 0, 6, dt);
    if (mt.shL) mt.shL.rotation.x = -this.pitch * 0.25 - sk.shL * 0.09;
    if (mt.shR) mt.shR.rotation.x = -this.pitch * 0.25 - sk.shR * 0.09;
    if (mt.back) mt.back.rotation.x = -sk.back * 0.08;
    for (let i = 0; i < this.spins.length; i++) { const m = this.spins[i]; m.spinV = damp(m.spinV, 0, 1.6, dt); m.spin.rotation.z += m.spinV * dt; }
    if (this.shieldMesh) { const v = this.shieldV; this.shieldMesh.visible = v > 0.01; if (v > 0.01) { const fk = 0.85 + 0.15 * Math.sin(t * 37) * Math.sin(t * 5.1); this.glows.shield.color.copy(this.accent || WHITE_C).multiplyScalar(v * 1.1 * fk); const sc = 0.6 + 0.4 * v; this.shieldMesh.scale.set(sc, sc, 1); } }
    if (n.pod) n.pod.rotation.x = -this.pitch * 0.25 - this.podKick * 0.09;
    if (n.rack) { n.rack.rotation.x = -this.rackKick * 0.1; n.rack.rotation.y = this.rackKick * 0.05; }
    if (n.canopy) n.canopy.rotation.x = -this.canopy * 1.05;
    if (n.head) { n.head.rotation.y = clamp(wrapPi((s.aimYaw || 0) - this.yaw), -0.5, 0.5) * (1 - droop); n.head.rotation.x = -this.pitch * 0.3 + droop * 0.4; }

    // ---- jets ------------------------------------------------------------------------------
    const jet = this.jet;
    for (let i = 0; i < this.flares.length; i++) {
      const f = this.flares[i], nz = i ? n.jetR : n.jetL;
      nz.rotation.x = c.jetRest + jet * 0.22 - this.pit.x * 1.5 + air * 0.1;
      nz.rotation.z = (i ? -1 : 1) * (-0.06 + jet * 0.1);
      if (jet > 0.02) {
        f.visible = true;
        const fl = 0.82 + 0.18 * Math.sin(t * 47 + i * 2.1) + 0.1 * Math.sin(t * 91 + i);
        f.scale.set(c.flareR * (0.7 + 0.3 * jet), c.flareLen * jet * fl, c.flareR * (0.7 + 0.3 * jet));
      } else f.visible = false;
    }
    // ---- emissives ---------------------------------------------------------------------------
    let fl = 1;
    if (this.damage > 0.5 && !dead) { const q = Math.sin(t * 23.7) * Math.sin(t * 7.3 + 1.3); if (q > 1.25 - this.damage) fl = 0.25; }
    const g = power * fl * (1 + 0.07 * Math.sin(t * 2.6)) * (c.glowK || 1);
    if (this.accent) this.glows.glow.color.copy(this.accent).multiplyScalar(g); else this.glows.glow.color.setScalar(g);
    const h = this.heat;
    this.glows.heat.color.setScalar((0.05 + 4.5 * h * h) * (dead ? 1 : power) + (dead ? Math.max(0, 2.5 - dT * 0.6) * (0.7 + 0.3 * Math.sin(t * 17)) : 0) + this.damage * this.damage * (c.heatDmg || 0.9) + (c.heatDmg ? 0.5 + 0.25 * Math.sin(t * 2.2) : 0));
    this.glows.jet.color.setScalar(0.05 + jet * 5 * (0.9 + 0.1 * Math.sin(t * 53)));
  }
  dispose() {
    this.root.removeFromParent();
    this.glows.glow.dispose(); this.glows.heat.dispose(); this.glows.jet.dispose(); if (this.glows.shield) this.glows.shield.dispose();
  }
  /** attach a module blueprint to a hardpoint. bpM may be null (empty slot). */
  fit(slot, id, bpM) {
    const mount = this.mounts[slot]; if (!mount) return;
    const k = this.cfg.modScale || 1;
    if (!bpM) { const o = new THREE.Object3D(); if (slot === 'armL' || slot === 'armR') { const h = this.sockets[slot === 'armL' ? 'handL' : 'handR']; h.parent.add(o); o.position.copy(h.position); } else mount.add(o); this.sockets[slot] = o; return; }
    if (id === 'shield' && !this.glows.shield) this.glows.shield = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mi = instantiate(bpM, this.mats, this.glows);
    mi.root.scale.setScalar(k); mount.add(mi.root);
    const m = { id, armor: mi.armor, spin: mi.nodes.spin || null, spinV: 0 };
    this.mods[slot] = m; if (m.spin) this.spins.push(m);
    this.sockets[slot] = mi.sockets.muzzle;
    if (id === 'shield') { this.shieldSlot = slot; mi.nodes.m.traverse(o => { if (o.name === 'm:shield') this.shieldMesh = o; }); if (this.shieldMesh) { this.shieldMesh.visible = false; this.shieldMesh.frustumCulled = false; } }
    if (id === 'booster') { /* its nozzle glows with the main jets via the shared jet material */ }
  }
  /** torn-limb stumps (hidden until setLimbLost) */
  addStumps(bpS, k) {
    for (let i = 0; i < 2; i++) {
      const si = instantiate(bpS, this.mats, this.glows), A = this.arms[i];
      si.root.position.copy(A.fa.position); si.root.scale.setScalar(k); si.root.visible = false; A.sh.add(si.root);
      this.stumps[i] = si.root; this.sockets[i ? 'stumpR' : 'stumpL'] = si.sockets.sparks;
    }
  }
  /** 0..1: raise the Aegis disc (no-op without a shield module) */
  setShield(v) { this.shieldV = clamp(v || 0, 0, 1); }
  /** 'armL' | 'armR': the forearm is torn off at the elbow, leaving a sparking stump (sockets.stumpL / stumpR) */
  setLimbLost(name, lost = true) {
    const i = name === 'armR' ? 1 : name === 'armL' ? 0 : -1; if (i < 0) return;
    this.lost[i] = lost; this.arms[i].fa.visible = !lost;
    if (this.stumps[i]) this.stumps[i].visible = lost;
  }
}
const WHITE_C = new THREE.Color(1, 1, 1);
const IDLE = { speed: 0, fwd: 0, strafe: 0, aimYaw: 0, aimPitch: 0, grounded: true, vy: 0, jet: 0, dead: false };
export const IDLE_STATE = IDLE;
