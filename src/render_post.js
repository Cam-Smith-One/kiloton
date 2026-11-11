// ============================================================================
// KILOTON — render_post.js   OWNER: RENDER
// HDR post chain: scene -> (MSAA) half-float target -> bloom pyramid ->
// composite (sun veil, exposure, filmic tone map, grade, vignette, grain)
// -> optional FXAA -> canvas.
// ============================================================================
import { THREE } from './core.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const PREFILTER = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uKnee;
varying vec2 vUv;
vec3 pick(vec2 uv) { return min(texture2D(tSrc, uv).rgb, vec3(48.0)); }
void main() {
  // 4-tap box with luma weighting (kills fireflies from tiny hot pixels)
  vec3 a = pick(vUv + uTexel * vec2(-1.0, -1.0)), b = pick(vUv + uTexel * vec2(1.0, -1.0));
  vec3 c = pick(vUv + uTexel * vec2(-1.0, 1.0)), d = pick(vUv + uTexel * vec2(1.0, 1.0));
  float wa = 1.0 / (1.0 + dot(a, vec3(0.3, 0.6, 0.1))), wb = 1.0 / (1.0 + dot(b, vec3(0.3, 0.6, 0.1)));
  float wc = 1.0 / (1.0 + dot(c, vec3(0.3, 0.6, 0.1))), wd = 1.0 / (1.0 + dot(d, vec3(0.3, 0.6, 0.1)));
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd);
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float contrib = max(soft, br - uThreshold) / max(br, 1e-4);
  gl_FragColor = vec4(col * contrib, 1.0);
}
`;
const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 4.0;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c * 0.125, 1.0);
}
`;
const UP = /* glsl */`
uniform sampler2D tSrc; uniform sampler2D tAdd; uniform vec2 uTexel; uniform float uWeight; varying vec2 vUv;
void main() {
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-t.x * 2.0, 0.0)).rgb + texture2D(tSrc, vUv + vec2(t.x * 2.0, 0.0)).rgb;
  c += texture2D(tSrc, vUv + vec2(0.0, -t.y * 2.0)).rgb + texture2D(tSrc, vUv + vec2(0.0, t.y * 2.0)).rgb;
  c += (texture2D(tSrc, vUv + vec2(-t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x, -t.y)).rgb + texture2D(tSrc, vUv + vec2(t.x, -t.y)).rgb) * 2.0;
  gl_FragColor = vec4(texture2D(tAdd, vUv).rgb + c * (uWeight / 12.0), 1.0);
}
`;
const COMPOSITE = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom;
uniform float uBloom; uniform float uExposure; uniform float uTime; uniform float uVignette; uniform float uSaturation; uniform float uContrast;
uniform vec3 uSunScreen;     // xy = uv of the sun, z = visibility 0..1
uniform float uAspect; uniform float uFlash; uniform vec3 uTint;
varying vec2 vUv;
// ACES fit (Stephen Hill), keeps saturated emissives from clipping to flat primaries
vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c) {
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(O * RRTAndODTFit(I * c), 0.0, 1.0);
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  vec3 bl = texture2D(tBloom, vUv).rgb;
  c += bl * uBloom;
  // veiling glare when the sun is in frame: a soft warm wash around it
  vec2 sv = (vUv - uSunScreen.xy) * vec2(uAspect, 1.0);
  float sdist = length(sv);
  c += vec3(1.0, 0.62, 0.30) * uSunScreen.z * (0.10 * exp(-sdist * 2.6) + 0.08 * exp(-sdist * 9.0));
  c *= uExposure;
  c = aces(c / 0.6);
  // grade in display-linear: split tone (cool shadows, warm highlights), gentle contrast, saturation
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSaturation);
  c += vec3(-0.004, 0.002, 0.014) * (1.0 - smoothstep(0.0, 0.35, l));
  c *= mix(vec3(1.0), vec3(1.035, 1.0, 0.955), smoothstep(0.25, 0.9, l));
  c *= uTint;
  c = max(c, 0.0);
  c = pow(c, vec3(1.0 / 2.2));
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  c = c * 0.985 + 0.012;                                  // lifted toe: blacks are never crushed
  vec2 q = vUv - 0.5;
  float vig = 1.0 - uVignette * smoothstep(0.25, 1.05, length(q * vec2(1.15, 1.0)) * 1.55);
  c *= vig;
  c += uFlash;
  c += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) * (1.6 / 255.0);
  gl_FragColor = vec4(c, dot(c, vec3(0.299, 0.587, 0.114)));
}
`;
// FXAA 3.11-style, compact (luma in alpha)
const FXAA = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec4 m = texture2D(tSrc, vUv);
  float lM = m.a;
  float lNW = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).a, lNE = texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).a;
  float lSW = texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).a, lSE = texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).a;
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.035, lMax * 0.10)) { gl_FragColor = vec4(m.rgb, 1.0); return; }
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), (lNW + lSW) - (lNE + lSE));
  float red = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  dir = clamp(dir / (min(abs(dir.x), abs(dir.y)) + red), -8.0, 8.0) * uTexel;
  vec3 a = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 b = a * 0.5 + 0.25 * (texture2D(tSrc, vUv - dir * 0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lB = dot(b, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
}
`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.tri = new THREE.Mesh(g, null); this.tri.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.tri);
    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.mPre = mk(PREFILTER, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThreshold: { value: 1.25 }, uKnee: { value: 0.7 } });
    this.mDown = mk(DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mUp = mk(UP, { tSrc: { value: null }, tAdd: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } });
    this.mComp = mk(COMPOSITE, {
      tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0.13 }, uExposure: { value: 1.0 }, uTime: { value: 0 },
      uVignette: { value: 0.30 }, uSaturation: { value: 1.06 }, uContrast: { value: 0.22 }, uSunScreen: { value: new THREE.Vector3(0.5, 0.5, 0) },
      uAspect: { value: 1 }, uFlash: { value: 0 }, uTint: { value: new THREE.Vector3(1, 1, 1) },
    });
    this.mFxaa = mk(FXAA, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.params = this.mComp.uniforms;
    this.levels = 6; this.samples = 4; this.fxaa = false; this.bloomOn = true;
    this.w = 0; this.h = 0; this.hdr = null; this.ldr = null; this.down = []; this.up = [];
  }
  configure(tier) {
    this.samples = tier === 'high' ? 4 : tier === 'med' ? 2 : 0;
    this.fxaa = tier === 'low';
    this.levels = tier === 'low' ? 4 : tier === 'med' ? 5 : 6;
    this.scale = tier === 'low' ? 0.8 : 1;            // low renders the scene at 80 % and upscales in the composite
    this.bloomShift = tier === 'low' ? 2 : 1;         // low starts the bloom pyramid at quarter resolution
    this.setSize(this.w, this.h, true);
  }
  setSize(w, h, force) {
    w = Math.max(8, w | 0); h = Math.max(8, h | 0);
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.dispose();
    const sw = Math.max(8, Math.round(w * (this.scale || 1))), sh = Math.max(8, Math.round(h * (this.scale || 1)));
    const HF = THREE.HalfFloatType;
    this.hdr = new THREE.WebGLRenderTarget(sw, sh, { type: HF, format: THREE.RGBAFormat, samples: this.samples, depthBuffer: true, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.hdr.texture.name = 'kt-hdr';
    if (this.fxaa) this.ldr = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    let bw = sw >> (this.bloomShift || 1), bh = sh >> (this.bloomShift || 1);
    for (let i = 0; i < this.levels; i++) {
      bw = Math.max(2, bw); bh = Math.max(2, bh);
      const o = { type: HF, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
      this.down.push(new THREE.WebGLRenderTarget(bw, bh, o));
      if (i < this.levels - 1) this.up.push(new THREE.WebGLRenderTarget(bw, bh, o));
      bw >>= 1; bh >>= 1;
    }
    this.mComp.uniforms.uAspect.value = w / h;
  }
  dispose() {
    if (this.hdr) this.hdr.dispose(); if (this.ldr) this.ldr.dispose(); this.ldr = null;
    for (const t of this.down) t.dispose(); for (const t of this.up) t.dispose();
    this.down.length = 0; this.up.length = 0;
  }
  pass(mat, target) { this.tri.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam); }
  render(scene, camera, time) {
    const r = this.r;
    r.setRenderTarget(this.hdr);
    r.render(scene, camera);
    const D = this.down, U = this.up, n = this.levels;
    if (this.bloomOn) {
      let u = this.mPre.uniforms; u.tSrc.value = this.hdr.texture; u.uTexel.value.set(0.5 / D[0].width, 0.5 / D[0].height);
      this.pass(this.mPre, D[0]);
      for (let i = 1; i < n; i++) {
        u = this.mDown.uniforms; u.tSrc.value = D[i - 1].texture; u.uTexel.value.set(1 / D[i - 1].width, 1 / D[i - 1].height);
        this.pass(this.mDown, D[i]);
      }
      // up: U[i] = D[i] + blur(U[i+1])   (the smallest level feeds from D[n-1])
      let src = D[n - 1];
      for (let i = n - 2; i >= 0; i--) {
        u = this.mUp.uniforms; u.tSrc.value = src.texture; u.tAdd.value = D[i].texture; u.uTexel.value.set(0.5 / src.width, 0.5 / src.height);
        u.uWeight.value = 1.0;
        this.pass(this.mUp, U[i]); src = U[i];
      }
    }
    const c = this.mComp.uniforms;
    c.tScene.value = this.hdr.texture; c.tBloom.value = this.bloomOn ? U[0].texture : null; c.uTime.value = time;
    if (!this.bloomOn) c.uBloom.value = 0;
    if (this.fxaa) {
      this.pass(this.mComp, this.ldr);
      const f = this.mFxaa.uniforms; f.tSrc.value = this.ldr.texture; f.uTexel.value.set(1 / this.w, 1 / this.h);
      this.pass(this.mFxaa, null);
    } else this.pass(this.mComp, null);
  }
}
