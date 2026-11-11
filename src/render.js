// ============================================================================
// KILOTON — render.js   OWNER: RENDER       module: G.render
// Chunk meshing of the voxel grid, voxel materials, sky, sun + ambient, shadows,
// fog and the HDR post chain. See notes/render.md.
//   render_atmo.js    atmosphere constants, shared GLSL, three fog patch
//   render_mesher.js  greedy mesher with baked AO
//   render_voxmat.js  voxel surface shader (opaque + glass)
//   render_sky.js     sky dome, outskirts beyond the grid, reflection environment
//   render_post.js    bloom / tone map / grade / FXAA
// ============================================================================
import { G, THREE, bus, VS, NX, NY, NZ, CS, CX, CY, CZ, WX, WZ, GROUND_Y, clamp } from './core.js';
import { ATMO, patchThreeFog } from './render_atmo.js';
import { meshChunk, TYPE } from './render_mesher.js';
import { makeVoxelMaterials, makeMaterialTexture, sharedUniforms } from './render_voxmat.js';
import { makeSky, makeEnvironment, makeOutskirts } from './render_sky.js';
import { Post } from './render_post.js';

const NCHUNK = CX * CY * CZ;
const FLASH_N = 6;                       // fixed pool: shaders never recompile
const REMESH_BUDGET_MS = 3.5;
const SHADOW_SPAN = { high: 124, med: 120, low: 112 };   // metres across the sun's shadow frustum
const SHADOW_DEPTH = 260;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(), _c = new THREE.Vector3();
const col = (v, k = 1) => new THREE.Color(v.x * k, v.y * k, v.z * k);

const R = {
  name: 'render',
  // ---- contract API values (linear HDR "albedo multipliers": lit = albedo * (sunColor * NdotL + ambient)) ----
  sunDir: ATMO.sunDir.clone(),
  sunColor: col(ATMO.sun),
  skyColor: col(ATMO.skyUp),
  fogColor: new THREE.Color(0.62, 0.50, 0.50),
  ambient: new THREE.Color((ATMO.skyUp.x + ATMO.skySide.x) * 0.5, (ATMO.skyUp.y + ATMO.skySide.y) * 0.5, (ATMO.skyUp.z + ATMO.skySide.z) * 0.5),
  groundColor: col(ATMO.ground),
  stats: { chunks: 0, quads: 0, pending: 0, remeshMs: 0, lastChunkMs: 0, maxChunkMs: 0, initMs: 0, rebuilt: 0 },
  post: null, sun: null, hemi: null, sky: null, outskirts: null,

  init() {
    const t0 = performance.now();
    const r = G.renderer, s = G.scene;
    patchThreeFog();
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    r.setClearColor(0x8a7470, 1);
    s.background = null;
    s.fog = new THREE.FogExp2(0x9c8580, ATMO.fogDensity);

    // ---- lights for every standard material in the scene ----------------------
    const sun = this.sun = new THREE.DirectionalLight(col(ATMO.sun), Math.PI);
    sun.castShadow = true;
    sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.035;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = SHADOW_DEPTH * 2;
    s.add(sun); s.add(sun.target);
    const hemi = this.hemi = new THREE.HemisphereLight(col(ATMO.skyUp), col(ATMO.ground), Math.PI * 0.62);
    s.add(hemi);
    this.flashes = [];
    for (let i = 0; i < FLASH_N; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.position.set(0, -1000, 0); l.userData.t = 0; l.userData.dur = 0; l.userData.peak = 0;
      s.add(l); this.flashes.push(l);
    }

    // ---- sky, world beyond the grid, reflections --------------------------------
    this.uniforms = sharedUniforms();
    this.uniforms.uMatTex.value = makeMaterialTexture();
    const tier = G.quality.tier;
    this.sky = makeSky(tier === 'low' ? 3 : 5); s.add(this.sky);
    this.outskirts = makeOutskirts(G.state.seed, this.uniforms); s.add(this.outskirts);
    try { this.envRT = makeEnvironment(r); s.environment = this.envRT.texture; s.environmentIntensity = 0.55; } catch (e) { console.warn('render: no environment', e); }

    // ---- far shadow height field ------------------------------------------------
    this.topH = new Uint8Array(NX * NZ);            // top solid voxel (j + 1) per column
    this.farS = new Float32Array(NX * NZ);
    this.farBytes = new Uint8Array(NX * NZ);
    const ft = this.farTex = new THREE.DataTexture(this.farBytes, NX, NZ, THREE.RedFormat, THREE.UnsignedByteType);
    ft.minFilter = ft.magFilter = THREE.LinearFilter; ft.generateMipmaps = false; ft.wrapS = ft.wrapT = THREE.ClampToEdgeWrapping; ft.needsUpdate = true;
    this.uniforms.uFarShadow.value = ft; this.uniforms.uFarShadowOn.value = 1;
    this.farDirty = true; this.farTimer = 0;

    // ---- chunks -------------------------------------------------------------------
    this.mats = makeVoxelMaterials(this.uniforms);
    this.meshO = new Array(NCHUNK).fill(null); this.meshG = new Array(NCHUNK).fill(null);
    this.hash = new Int32Array(NCHUNK); this.hashed = new Uint8Array(NCHUNK);
    this.pend = new Uint8Array(NCHUNK); this.pendList = [];
    this.group = new THREE.Group(); this.group.name = 'kt-voxels'; this.group.matrixAutoUpdate = false; s.add(this.group);
    this.collectDirty();
    this.flushAll(true);
    this.updateFarShadow(true);

    // ---- post ---------------------------------------------------------------------
    this.post = new Post(r);
    const sz = r.getDrawingBufferSize(new THREE.Vector2());
    this.post.w = sz.x; this.post.h = sz.y;
    this.setQuality(tier);
    bus.on('resize', () => { const z = r.getDrawingBufferSize(new THREE.Vector2()); this.post.setSize(z.x, z.y); });
    // look-dev overrides
    const P = G.params;
    if (P.has('exposure')) this.post.params.uExposure.value = +P.get('exposure');
    if (P.has('bloom')) this.post.params.uBloom.value = +P.get('bloom');
    if (P.has('nofar')) this.uniforms.uFarShadowOn.value = 0;
    this.sunVis = 0;
    this.stats.initMs = performance.now() - t0;
  },

  // ---- chunk meshing ----------------------------------------------------------------
  collectDirty() {
    const d = G.grid.dirty;
    if (d.size === 0) return;
    const list = G.grid.takeDirty(NCHUNK);
    for (let n = 0; n < list.length; n++) { const c = list[n]; if (!this.pend[c]) { this.pend[c] = 1; this.pendList.push(c); } }
  },
  buildGeometry(st) {
    const arr = st.buf.slice(0, st.n);
    const ib = new THREE.InterleavedBuffer(arr, 8);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0, false));
    geo.setAttribute('aData', new THREE.InterleavedBufferAttribute(ib, 4, 4, false));
    const nv = st.n >> 3, nq = nv >> 2;
    const idx = nv > 65535 ? new Uint32Array(nq * 6) : new Uint16Array(nq * 6);
    for (let q = 0, o = 0, b = 0; q < nq; q++, b += 4) { idx[o++] = b; idx[o++] = b + 1; idx[o++] = b + 2; idx[o++] = b; idx[o++] = b + 2; idx[o++] = b + 3; }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mn = st.min, mx = st.max;
    const cx = (mn[0] + mx[0]) * 0.5, cy = (mn[1] + mx[1]) * 0.5, cz = (mn[2] + mx[2]) * 0.5;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), 0.5 * Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) + 0.01);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(mn[0], mn[1], mn[2]), new THREE.Vector3(mx[0], mx[1], mx[2]));
    geo.userData.quads = nq;
    return geo;
  },
  swap(arr, c, st, mat, ci, cj, ck, glass) {
    let mesh = arr[c];
    if (st.n === 0) {
      if (mesh) { this.stats.quads -= mesh.geometry.userData.quads; this.group.remove(mesh); mesh.geometry.dispose(); arr[c] = null; }
      return;
    }
    const geo = this.buildGeometry(st);
    this.stats.quads += geo.userData.quads;
    if (mesh) { const old = mesh.geometry; this.stats.quads -= old.userData.quads; mesh.geometry = geo; old.dispose(); return; }   // atomic: never a frame without geometry
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ci * CS * VS, cj * CS * VS, ck * CS * VS); mesh.scale.setScalar(VS);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix(); mesh.matrixWorld.copy(mesh.matrix); mesh.matrixWorldAutoUpdate = false;
    mesh.receiveShadow = true; mesh.castShadow = !glass;
    if (glass) mesh.renderOrder = 10;
    this.group.add(mesh); arr[c] = mesh;
  },
  // Rebuild one chunk if its content changed. Returns true if it was rebuilt.
  buildChunk(c) {
    const ci = c % CX, ck = Math.floor(c / CX) % CZ, cj = Math.floor(c / (CX * CZ));
    const res = meshChunk(ci, cj, ck, G.grid.data, this.hashed[c] ? this.hash[c] : undefined);
    if (!res) return false;
    this.hash[c] = res.hash; this.hashed[c] = 1;
    this.swap(this.meshO, c, res.opaque, this.mats.opaque, ci, cj, ck, false);
    this.swap(this.meshG, c, res.glass, this.mats.glass, ci, cj, ck, true);
    this.columnTops(ci, ck);
    this.stats.rebuilt++;
    return true;
  },
  flushAll(progress) {
    const list = this.pendList, n = list.length;
    for (let i = 0; i < n; i++) {
      const c = list[i]; this.pend[c] = 0; this.buildChunk(c);
      if (progress && (i & 63) === 0) bus.emit('load', { step: 1 + i / n, total: 10, label: 'render' });
    }
    list.length = 0;
    this.countChunks();
  },
  countChunks() { let n = 0; for (let c = 0; c < NCHUNK; c++) { if (this.meshO[c]) n++; if (this.meshG[c]) n++; } this.stats.chunks = n; },
  remesh(budgetMs) {
    this.collectDirty();
    const list = this.pendList;
    if (list.length === 0) { this.stats.pending = 0; return; }
    const cam = G.camera.position, t0 = performance.now(), half = CS * VS * 0.5;
    let built = 0;
    while (list.length) {
      // nearest pending chunk to the camera first
      let best = 0, bd = Infinity;
      for (let i = 0; i < list.length; i++) {
        const c = list[i], ci = c % CX, ck = Math.floor(c / CX) % CZ, cj = Math.floor(c / (CX * CZ));
        const dx = ci * CS * VS + half - cam.x, dy = cj * CS * VS + half - cam.y, dz = ck * CS * VS + half - cam.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
      const c = list[best]; list[best] = list[list.length - 1]; list.pop(); this.pend[c] = 0;
      const t1 = performance.now();
      if (this.buildChunk(c)) {
        built++;
        const dt = performance.now() - t1; this.stats.lastChunkMs = dt; if (dt > this.stats.maxChunkMs) this.stats.maxChunkMs = dt;
      }
      if (performance.now() - t0 > budgetMs) break;
    }
    if (built) this.farDirty = true;
    this.stats.remeshMs = performance.now() - t0; this.stats.pending = list.length;
  },

  // ---- far shadows: sweep the height field away from the sun --------------------------
  columnTops(ci, ck) {
    const d = G.grid.data, top = this.topH;
    for (let k = ck * CS; k < ck * CS + CS; k++) for (let i = ci * CS; i < ci * CS + CS; i++) {
      let j = NY - 1; const o = i + NX * k;
      for (; j >= 0; j--) if (TYPE[d[o + NX * NZ * j]] === 1) break;
      top[o] = j + 1;
    }
  },
  updateFarShadow(force) {
    if (!this.farDirty && !force) return;
    this.farDirty = false;
    const S = this.farS, H = this.topH, out = this.farBytes;
    const sx = this.sunDir.x, sz = this.sunDir.z, hl = Math.hypot(sx, sz), tanE = this.sunDir.y / hl;
    const xMajor = Math.abs(sx) >= Math.abs(sz);
    const A = xMajor ? NX : NZ, B = xMajor ? NZ : NX;            // sweep along a, interpolate along b
    const sa = xMajor ? sx : sz, sb = xMajor ? sz : sx;
    const dir = sa > 0 ? -1 : 1;                                 // march away from the sun
    const slope = sb / Math.abs(sa);                             // b offset (cells) of the upwind sample
    const b0 = Math.floor(slope), fr = slope - b0;
    const drop = VS * tanE * hl / Math.abs(sa) / VS;             // height lost per step, in voxels
    const at = xMajor ? (a, b) => a + NX * b : (a, b) => b + NX * a;
    for (let n = 0, a = dir > 0 ? 0 : A - 1; n < A; n++, a += dir) {
      const pa = a - dir;
      for (let b = 0; b < B; b++) {
        const o = at(a, b);
        let s = 0;
        if (n > 0) {
          const q0 = b + b0, q1 = q0 + 1;
          const s0 = q0 >= 0 && q0 < B ? S[at(pa, q0)] : 0, s1 = q1 >= 0 && q1 < B ? S[at(pa, q1)] : 0;
          s = s0 + (s1 - s0) * fr - drop;
        }
        const h = H[o];
        S[o] = s > h ? s : h;
        const v = S[o] * VS * (255 / 64);
        out[o] = v > 255 ? 255 : v;
      }
    }
    this.farTex.needsUpdate = true;
  },

  // ---- per frame ----------------------------------------------------------------------
  update(dt) {
    this.remesh(REMESH_BUDGET_MS);
    this.farTimer -= G.rawDt || dt || 0.016;
    if (this.farDirty && this.farTimer <= 0 && this.stats.remeshMs < 2.5) { this.updateFarShadow(); this.farTimer = 0.2; }
    this.updateShadowFrustum();
    // flash pool decay
    const F = this.flashes;
    for (let i = 0; i < FLASH_N; i++) {
      const l = F[i], u = l.userData;
      if (u.dur <= 0) continue;
      u.t += dt;
      const k = 1 - u.t / u.dur;
      if (k <= 0) { u.dur = 0; l.intensity = 0; l.position.y = -1000; } else l.intensity = u.peak * k * k;
    }
  },
  updateShadowFrustum() {
    const cam = G.camera, sun = this.sun, L = this.sunDir, sh = sun.shadow;
    const span = SHADOW_SPAN[G.quality.tier] || 120, res = sh.mapSize.x;
    cam.getWorldDirection(_v); _v.y = 0;
    const fl = _v.length(); if (fl > 1e-4) _v.multiplyScalar(1 / fl); else _v.set(0, 0, 0);
    // centre the map ahead of the camera, on the streets; looking down needs less lead
    _c.copy(cam.position).addScaledVector(_v, span * 0.30 * fl);
    _c.y = clamp(cam.position.y * 0.5, 4, 26);
    _right.set(0, 1, 0).cross(L).normalize(); _up.copy(L).cross(_right).normalize();
    const texel = span / res;
    const cr = Math.round(_c.dot(_right) / texel) * texel, cu = Math.round(_c.dot(_up) / texel) * texel, cl = Math.round(_c.dot(L) / 2) * 2;
    _c.set(0, 0, 0).addScaledVector(_right, cr).addScaledVector(_up, cu).addScaledVector(L, cl);
    sun.target.position.copy(_c); sun.target.updateMatrixWorld();
    sun.position.copy(_c).addScaledVector(L, SHADOW_DEPTH); sun.updateMatrixWorld();
    const oc = sh.camera, h = span * 0.5;
    if (oc.right !== h) { oc.left = -h; oc.right = h; oc.top = h; oc.bottom = -h; oc.updateProjectionMatrix(); }
  },
  render(dt) {
    const r = G.renderer, cam = G.camera, u = this.uniforms;
    r.info.reset();
    u.uTime.value = G.time;
    this.sky.material.uniforms.uTime.value = G.time;
    this.sky.matrixWorld.makeTranslation(cam.position.x, cam.position.y, cam.position.z);
    // sun veil: is the sun in frame and not behind masonry?
    _v.copy(cam.position).addScaledVector(this.sunDir, 500).project(cam);
    cam.getWorldDirection(_v2);
    let vis = 0;
    if (_v2.dot(this.sunDir) > 0.1) {
      const ex = Math.max(Math.abs(_v.x), Math.abs(_v.y));
      vis = 1 - clamp((ex - 0.9) / 0.5, 0, 1);
      if (vis > 0) {
        const p = cam.position, h = G.grid.raycast(p.x, p.y, p.z, this.sunDir.x, this.sunDir.y, this.sunDir.z, 240, true);
        if (h.hit) vis *= 0.15;
      }
    }
    this.sunVis += (vis - this.sunVis) * Math.min(1, (G.rawDt || 0.016) * 6);
    const pu = this.post.params;
    pu.uSunScreen.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, this.sunVis);
    this.post.render(G.scene, cam, G.time);
  },

  // ---- API ----------------------------------------------------------------------------
  // intensity ~ "albedo multiplier" at a quarter of the radius (the sun is about 1.7)
  flash(x, y, z, colorHex = 0xffc890, intensity = 2, radius = 14, duration = 0.2) {
    const F = this.flashes; let best = F[0], bs = Infinity;
    for (let i = 0; i < FLASH_N; i++) { const l = F[i], u = l.userData; const sc = u.dur <= 0 ? -1 : l.intensity; if (sc < bs) { bs = sc; best = l; } }
    const peak = intensity * radius * radius * 0.2;
    if (bs > peak) return;                                    // pool is full of brighter lights
    best.position.set(x, y, z); best.color.setHex(colorHex); best.distance = radius; best.intensity = peak;
    best.userData.t = 0; best.userData.dur = Math.max(0.03, duration); best.userData.peak = peak;
  },
  setQuality(tier) {
    if (!this.post) return;
    const sh = this.sun.shadow, res = G.quality.shadowRes || 2048;
    if (sh.mapSize.x !== res) { sh.mapSize.set(res, res); if (sh.map) { sh.map.dispose(); sh.map = null; } }
    sh.camera.right = 0;                                      // force a frustum refresh
    const oct = tier === 'low' ? 3 : 5, sm = this.sky.material;
    for (const m of [this.mats.opaque, this.mats.glass]) {
      const low = tier === 'low';
      if (!!m.defines.KT_LOW !== low) { if (low) m.defines.KT_LOW = 1; else delete m.defines.KT_LOW; m.needsUpdate = true; }
    }
    if (sm.defines.KT_OCT !== oct) { sm.defines.KT_OCT = oct; sm.needsUpdate = true; }
    this.post.bloomOn = G.quality.post !== false;
    this.post.configure(tier);
  },
  reset() {
    for (const l of this.flashes) { l.intensity = 0; l.userData.dur = 0; l.position.y = -1000; }
    this.collectDirty();
    this.flushAll(false);                                     // only chunks whose content really changed are rebuilt
    this.updateFarShadow(true);
  },
};
export default R;
