// ============================================================================
// KILOTON — combat_draw.js   OWNER: COMBAT
// Two draw calls for every projectile in the game:
//   glow  — one instanced quad, additive HDR. Each instance is either a camera-facing RIBBON along an axis
//           (tracers, pulse bolts, exhaust flames) or a round SPRITE (bolt heads, engine glare, grenade blink).
//   body  — one InstancedMesh of a chunky boxy rocket (rockets, missiles, shells, grenades), lit by the scene.
// Buffers are fixed size and written in place: no allocation after init.
// ============================================================================
import { G, THREE } from './core.js';

const VERT = /* glsl */`
attribute vec3 aStart; attribute vec3 aAxis; attribute vec3 aCol; attribute vec2 aParam;
uniform float uPix;
varying vec2 vUv; varying vec3 vCol; varying float vMode;
#include <common>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
void main() {
  vMode = aParam.y; vUv = position.xy;
  float w = aParam.x;
  bool rib = aParam.y < 0.5 || aParam.y > 1.5;
  vec3 base = aStart + aAxis * (rib ? position.y : 0.0);
  float dist = length(cameraPosition - base);
  float minW = dist * uPix;                       // never thinner than ~2 px: far tracers stay visible, dimmed instead
  float gain = 1.0;
  if (w < minW) { gain = max(0.35, w / minW); w = minW; }
  vec3 wp;
  if (rib) {
    vec3 ax = aAxis; float al = length(ax); ax = al > 1e-5 ? ax / al : vec3(0.0, 0.0, 1.0);
    vec3 side = cross(ax, cameraPosition - base); float sl = length(side);
    side = sl > 1e-5 ? side / sl : vec3(1.0, 0.0, 0.0);
    wp = base + side * (position.x * w);
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    wp = aStart + (right * position.x + up * (position.y * 2.0 - 1.0)) * w;
  }
  vCol = aCol * gain;
  vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <logdepthbuf_vertex>
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
varying vec2 vUv; varying vec3 vCol; varying float vMode;
#include <common>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float I, core;
  if (vMode < 0.5 || vMode > 1.5) {
    float a = 1.0 - abs(vUv.x);
    float along = vMode > 1.5 ? smoothstep(0.0, 0.02, vUv.y) : pow(vUv.y, 1.6) * (1.0 - smoothstep(0.86, 1.0, vUv.y) * 0.9);
    core = smoothstep(0.72, 0.98, a) * along;
    I = a * a * a * 0.3 * along + core * 0.7;
  } else {
    float r2 = vUv.x * vUv.x + (vUv.y * 2.0 - 1.0) * (vUv.y * 2.0 - 1.0);
    float halo = max(0.0, exp(-r2 * 5.0) - 0.0067) * 0.22;
    core = exp(-r2 * 46.0);
    I = halo + core * 0.75;
  }
  float peak = max(vCol.r, max(vCol.g, vCol.b));
  vec3 col = vCol * I + vec3(peak * 0.5) * core * core;         // white-hot centre, coloured halo
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    col *= 1.0 - 0.8 * fogFactor;                           // additive light fades into the haze, it does not turn grey
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function box(P, N, C, cx, cy, cz, sx, sy, sz, shade) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const F = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const n of F) {
    const u = n[0] ? [0, 1, 0] : [1, 0, 0], v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const q = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [a, b] of q) {
      P.push(cx + (n[0] + u[0] * a + v[0] * b) * hx, cy + (n[1] + u[1] * a + v[1] * b) * hy, cz + (n[2] + u[2] * a + v[2] * b) * hz);
      N.push(n[0], n[1], n[2]); C.push(shade, shade, shade);
    }
  }
}

export function createDraw(maxGlow, maxBody) {
  // ---- glow -----------------------------------------------------------------
  const gg = new THREE.InstancedBufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
  gg.setIndex([0, 1, 2, 0, 2, 3]);
  const aStart = new THREE.InstancedBufferAttribute(new Float32Array(maxGlow * 3), 3);
  const aAxis = new THREE.InstancedBufferAttribute(new Float32Array(maxGlow * 3), 3);
  const aCol = new THREE.InstancedBufferAttribute(new Float32Array(maxGlow * 3), 3);
  const aParam = new THREE.InstancedBufferAttribute(new Float32Array(maxGlow * 2), 2);
  for (const a of [aStart, aAxis, aCol, aParam]) a.setUsage(THREE.DynamicDrawUsage);
  gg.setAttribute('aStart', aStart); gg.setAttribute('aAxis', aAxis); gg.setAttribute('aCol', aCol); gg.setAttribute('aParam', aParam);
  gg.instanceCount = 0;
  const gm = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uPix: { value: 0.002 } }]),
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, fog: true, side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(gg, gm);
  glow.frustumCulled = false; glow.renderOrder = 20; glow.matrixAutoUpdate = false; glow.name = 'combat:glow';
  glow.castShadow = false; glow.receiveShadow = false;

  // ---- bodies ---------------------------------------------------------------
  const P = [], N = [], C = [];
  box(P, N, C, 0, 0, -0.05, 1, 1, 0.7, 0.28);        // casing (dark)
  box(P, N, C, 0, 0, 0.34, 1.04, 1.04, 0.1, 1.0);    // faction paint band
  box(P, N, C, 0, 0, 0.45, 0.62, 0.62, 0.12, 0.5);   // nose
  box(P, N, C, 0, 0, -0.34, 2.3, 0.16, 0.2, 0.16);   // fins
  box(P, N, C, 0, 0, -0.34, 0.16, 2.3, 0.2, 0.16);
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  bg.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  const bm = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, metalness: 0.55, roughness: 0.5 });
  const body = new THREE.InstancedMesh(bg, bm, maxBody);
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.setColorAt(0, new THREE.Color(1, 1, 1)); body.instanceColor.setUsage(THREE.DynamicDrawUsage);
  body.count = 0; body.frustumCulled = false; body.castShadow = false; body.receiveShadow = false; body.name = 'combat:bodies';

  const S = aStart.array, A = aAxis.array, K = aCol.array, Q = aParam.array, BM = body.instanceMatrix.array, BC = body.instanceColor.array;
  let ng = 0, nb = 0;
  const d = {
    glow, body, maxGlow, maxBody,
    attach(scene) { scene.add(glow); scene.add(body); },
    detach() { glow.removeFromParent(); body.removeFromParent(); },
    begin() { ng = 0; nb = 0; },
    // bright end is (x,y,z) + axis; faded tail is (x,y,z)
    ribbon(x, y, z, ax, ay, az, w, r, g, b) {
      if (ng >= maxGlow) return;
      const i = ng * 3; S[i] = x; S[i + 1] = y; S[i + 2] = z; A[i] = ax; A[i + 1] = ay; A[i + 2] = az; K[i] = r; K[i + 1] = g; K[i + 2] = b;
      Q[ng * 2] = w; Q[ng * 2 + 1] = 0; ng++;
    },
    // uniform beam from (x,y,z) along axis
    beam(x, y, z, ax, ay, az, w, r, g, b) {
      if (ng >= maxGlow) return;
      const i = ng * 3; S[i] = x; S[i + 1] = y; S[i + 2] = z; A[i] = ax; A[i + 1] = ay; A[i + 2] = az; K[i] = r; K[i + 1] = g; K[i + 2] = b;
      Q[ng * 2] = w; Q[ng * 2 + 1] = 2; ng++;
    },
    sprite(x, y, z, w, r, g, b) {
      if (ng >= maxGlow) return;
      const i = ng * 3; S[i] = x; S[i + 1] = y; S[i + 2] = z; A[i] = 0; A[i + 1] = 0; A[i + 2] = 1; K[i] = r; K[i + 1] = g; K[i + 2] = b;
      Q[ng * 2] = w; Q[ng * 2 + 1] = 1; ng++;
    },
    // boxy body centred at (x,y,z), local +Z along unit (dx,dy,dz), rolled by `roll` rad
    solid(x, y, z, dx, dy, dz, sx, sy, sz, r, g, b, roll) {
      if (nb >= maxBody) return;
      let ux, uy, uz;
      if (Math.abs(dy) < 0.985) { const l = 1 / Math.sqrt(dx * dx + dz * dz); ux = dz * l; uy = 0; uz = -dx * l; } else { ux = 1; uy = 0; uz = 0; }
      let vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux;
      if (roll) {
        const c = Math.cos(roll), s = Math.sin(roll);
        const ax = ux * c + vx * s, ay = uy * c + vy * s, az = uz * c + vz * s;
        vx = vx * c - ux * s; vy = vy * c - uy * s; vz = vz * c - uz * s; ux = ax; uy = ay; uz = az;
      }
      const o = nb * 16;
      BM[o] = ux * sx; BM[o + 1] = uy * sx; BM[o + 2] = uz * sx; BM[o + 3] = 0;
      BM[o + 4] = vx * sy; BM[o + 5] = vy * sy; BM[o + 6] = vz * sy; BM[o + 7] = 0;
      BM[o + 8] = dx * sz; BM[o + 9] = dy * sz; BM[o + 10] = dz * sz; BM[o + 11] = 0;
      BM[o + 12] = x; BM[o + 13] = y; BM[o + 14] = z; BM[o + 15] = 1;
      const c3 = nb * 3; BC[c3] = r; BC[c3 + 1] = g; BC[c3 + 2] = b; nb++;
    },
    end() {
      gg.instanceCount = ng; glow.visible = ng > 0;
      if (ng) {
        aStart.needsUpdate = aAxis.needsUpdate = aCol.needsUpdate = aParam.needsUpdate = true;
      }
      body.count = nb; body.visible = nb > 0;
      if (nb) {
        const im = body.instanceMatrix, ic = body.instanceColor;
        im.needsUpdate = true; ic.needsUpdate = true;
      }
      const cam = G.camera;
      if (cam && G.renderer) {
        const h = G.renderer.domElement.height || 720;
        gm.uniforms.uPix.value = 2 * Math.tan(cam.fov * Math.PI / 360) / h * 1.1;
      }
      d.glowCount = ng; d.bodyCount = nb;
    },
    glowCount: 0, bodyCount: 0,
    dispose() { d.detach(); gg.dispose(); gm.dispose(); bg.dispose(); bm.dispose(); body.dispose(); },
  };
  return d;
}
