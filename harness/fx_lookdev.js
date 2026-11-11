// FX harness helpers: golden-hour stand-in lighting + a tiny HDR post (bloom + ACES) for the BASELINE renderer,
// so effects can be judged the way the real pipeline will show them. Not part of the game.
import { THREE } from '../src/core.js';

export function goldenHour(G) {
  const R = G.render;
  R.sunDir = new THREE.Vector3(-0.62, 0.36, 0.5).normalize();
  R.sunColor = new THREE.Color(1.72, 1.06, 0.56);
  R.skyColor = new THREE.Color(0.21, 0.29, 0.5);
  R.fogColor = new THREE.Color(0.75, 0.62, 0.55);
  R.ambient = new THREE.Color(0.3, 0.34, 0.45);
  G.scene.traverse(o => {
    if (o.isDirectionalLight) { o.color.setRGB(1, 0.68, 0.37); o.intensity = 3.4; o.position.copy(R.sunDir).multiplyScalar(100); }
    if (o.isHemisphereLight) { o.color.setRGB(0.5, 0.62, 1.0); o.groundColor.setRGB(0.35, 0.27, 0.2); o.intensity = 1.0; }
  });
  G.scene.background = new THREE.Color(0.55, 0.52, 0.62);
  G.scene.fog = new THREE.Fog(new THREE.Color(0.7, 0.6, 0.56), 60, 520);
}

export function installPost(G) {
  const r = G.renderer;
  const mk = (w, h, depth) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: !!depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  let W = 0, H = 0, rt, b1a, b1b, b2a, b2b, b3a, b3b;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  const scene = new THREE.Scene(); scene.add(quad);
  const vs = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const bright = new THREE.ShaderMaterial({ uniforms: { t: { value: null } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb; float l = max(c.r, max(c.g, c.b)); c *= smoothstep(0.9, 1.8, l); gl_FragColor = vec4(min(c, vec3(40.0)), 1.0); }' });
  const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, d: { value: new THREE.Vector2() } }, vertexShader: vs, fragmentShader: 'uniform sampler2D t; uniform vec2 d; varying vec2 vUv; void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227; c += (texture2D(t, vUv + d * 1.385).rgb + texture2D(t, vUv - d * 1.385).rgb) * 0.316; c += (texture2D(t, vUv + d * 3.231).rgb + texture2D(t, vUv - d * 3.231).rgb) * 0.0703; gl_FragColor = vec4(c, 1.0); }' });
  const comp = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, a: { value: null }, b: { value: null }, c: { value: null } }, vertexShader: vs, fragmentShader: `
    uniform sampler2D t, a, b, c; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main(){ vec3 col = texture2D(t, vUv).rgb + texture2D(a, vUv).rgb * 0.22 + texture2D(b, vUv).rgb * 0.2 + texture2D(c, vUv).rgb * 0.16;
      col = aces(col * 0.9); vec2 q = vUv - 0.5; col *= 1.0 - dot(q, q) * 0.5; gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0); }` });
  const pass = (mat, target) => { quad.material = mat; r.setRenderTarget(target); r.render(scene, cam); };
  const blurInto = (src, tmp, dst) => { blur.uniforms.t.value = src.texture; blur.uniforms.d.value.set(1 / tmp.width, 0); pass(blur, tmp); blur.uniforms.t.value = tmp.texture; blur.uniforms.d.value.set(0, 1 / dst.height); pass(blur, dst); };
  G.render.render = function () {
    const s = r.getDrawingBufferSize(new THREE.Vector2());
    if (s.x !== W || s.y !== H) {
      W = s.x; H = s.y; for (const o of [rt, b1a, b1b, b2a, b2b, b3a, b3b]) if (o) o.dispose();
      rt = mk(W, H, true); b1a = mk(W >> 1, H >> 1); b1b = mk(W >> 1, H >> 1); b2a = mk(W >> 2, H >> 2); b2b = mk(W >> 2, H >> 2); b3a = mk(W >> 3, H >> 3); b3b = mk(W >> 3, H >> 3);
    }
    r.setRenderTarget(rt); r.render(G.scene, G.camera);
    bright.uniforms.t.value = rt.texture; pass(bright, b1a);
    blurInto(b1a, b1b, b1a); blurInto(b1a, b2b, b2a); blurInto(b2a, b3b, b3a); blurInto(b3a, b3b, b3a);
    comp.uniforms.t.value = rt.texture; comp.uniforms.a.value = b1a.texture; comp.uniforms.b.value = b2a.texture; comp.uniforms.c.value = b3a.texture;
    pass(comp, null);
  };
}
