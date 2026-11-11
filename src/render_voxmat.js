// ============================================================================
// KILOTON — render_voxmat.js   OWNER: RENDER
// The voxel surface shader (opaque + glass variants) and the shared lighting
// GLSL used by the outskirts too. Uses three's light uniforms for the flash
// point-light pool and three's shadow map for the sun.
// ============================================================================
import { THREE, VS, NX, NZ } from './core.js';
import { MAT, M, COLOR, EMISSIVE } from './materials.js';
import { ATMO, GLSL_ATMO } from './render_atmo.js';

export const EMISSIVE_SCALE = 1.8;

// material "kinds" drive small shader differences
const KIND = { base: 0, asphalt: 1, brick: 2, metal: 3, glass: 4, light: 5, window: 6, plant: 7, water: 8, line: 9, soft: 10, paint: 11 };
function kindOf(m) {
  const n = m.name;
  if (n === 'asphalt' || n === 'roof_tar') return KIND.asphalt;
  if (n.startsWith('line_')) return KIND.line;
  if (n.startsWith('brick') || n === 'roof_tile' || n.startsWith('tile_')) return KIND.brick;
  if (n === 'window_lit') return KIND.window;
  if (n === 'water') return KIND.water;
  if (m.glass) return KIND.glass;
  if (m.emissive > 0.5) return KIND.light;
  if (n === 'foliage' || n === 'grass') return KIND.plant;
  if (n.startsWith('car_') || n === 'solar' || n === 'hazard' || n === 'barrel_red' || n === 'fuel_tank' || n === 'gas_pipe') return KIND.paint;
  if (m.metal > 0.5) return KIND.metal;
  if (n.startsWith('awning') || n === 'rubber' || n === 'dirt' || n === 'charred' || n === 'rubble' || n === 'sandbag') return KIND.soft;
  return KIND.base;
}
const s2l = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

export function makeMaterialTexture() {
  const d = new Float32Array(256 * 2 * 4);
  for (let id = 0; id < 256; id++) {
    const m = MAT[id];
    const o = id * 4, o2 = (256 + id) * 4;
    if (!m) { d[o] = d[o + 1] = d[o + 2] = 0.2; d[o2] = 0.9; continue; }
    d[o] = s2l(COLOR[id * 3]); d[o + 1] = s2l(COLOR[id * 3 + 1]); d[o + 2] = s2l(COLOR[id * 3 + 2]); d[o + 3] = EMISSIVE[id];
    d[o2] = m.rough; d[o2 + 1] = m.metal; d[o2 + 2] = kindOf(m); d[o2 + 3] = 0;
  }
  const t = new THREE.DataTexture(d, 256, 2, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true;
  return t;
}

// ---- lighting shared by voxels and outskirts --------------------------------
// expects: uniforms uSun uSkyUp uSkySide uGround, GLSL_ATMO
export const GLSL_LIGHT = /* glsl */`
uniform vec3 uSun; uniform vec3 uSkyUp; uniform vec3 uSkySide; uniform vec3 uGround;
vec3 ktAmbient(vec3 N) {
  float up = N.y;
  vec3 a = mix(uSkySide, uSkyUp, max(up, 0.0));
  a = mix(a, uGround, max(-up, 0.0));
  // walls facing the sun side of the sky pick up a little of its warmth
  a += vec3(0.085, 0.045, 0.012) * max(dot(N, KT_SUNH), 0.0) * (1.0 - abs(up));
  return a;
}
float ktGGX(float ndh, float a) { float a2 = a * a; float d = ndh * ndh * (a2 - 1.0) + 1.0; return a2 / (3.14159 * d * d); }
// Per-voxel surface detail. cellp = voxel-space position nudged inside the voxel, N = face normal.
// returns: x = value multiplier, y = per-voxel hash, z = edge line (0..1)
vec3 ktVoxel(vec3 cellp, vec3 N, float varAmt, float lineAmt) {
  vec3 cell = floor(cellp);
  vec3 f = cellp - cell;
  vec2 uv = abs(N.x) > 0.5 ? f.zy : (abs(N.y) > 0.5 ? f.xz : f.xy);
  float h = ktHash13(cell);
  vec2 e = min(uv, 1.0 - uv);
  float ed = min(e.x, e.y);
  vec2 fw = fwidth(abs(N.x) > 0.5 ? cellp.zy : (abs(N.y) > 0.5 ? cellp.xz : cellp.xy));
  float aa = max(fw.x, fw.y);
  float fade = clamp(1.0 - aa * 3.5, 0.0, 1.0);
  float line = 1.0 - smoothstep(0.02, 0.045 + aa * 1.2, ed);
  float cushion = smoothstep(0.0, 0.32, ed);
  float v = 1.0 + (h - 0.5) * varAmt * (0.35 + 0.65 * fade);
  v *= 1.0 - lineAmt * (line * fade + 0.10 * (1.0 - fade));
  v *= mix(1.0, 0.93 + 0.07 * cushion, fade);
  return vec3(v, h, line * fade);
}
`;

const VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
attribute vec4 aData;
uniform sampler2D uMatTex;
varying vec3 vWorld;
varying vec3 vViewPos;
varying vec3 vN;
varying vec4 vCol;
varying vec4 vProp;
const vec3 KT_NORMALS[6] = vec3[6](vec3(1.,0.,0.), vec3(-1.,0.,0.), vec3(0.,1.,0.), vec3(0.,-1.,0.), vec3(0.,0.,1.), vec3(0.,0.,-1.));
void main() {
  int mat = int(aData.x + 0.5);
  int pk = int(aData.y + 0.5);
  vec3 objectNormal = KT_NORMALS[pk >> 2];
  vCol = texelFetch(uMatTex, ivec2(mat, 0), 0);
  vProp = texelFetch(uMatTex, ivec2(mat, 1), 0);
  vProp.w = float(pk & 3) * 0.3333333;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vec4 mvPosition = viewMatrix * worldPosition;
  vWorld = worldPosition.xyz;
  vViewPos = mvPosition.xyz;
  vN = objectNormal;
  vec3 transformedNormal = mat3(viewMatrix) * objectNormal;
  gl_Position = projectionMatrix * mvPosition;
  #include <shadowmap_vertex>
}
`;

const FRAG = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${GLSL_ATMO}
${GLSL_LIGHT}
uniform float uFogDensity;
uniform float uTime;
uniform sampler2D uFarShadow;
uniform float uFarShadowOn;
varying vec3 vWorld;
varying vec3 vViewPos;
varying vec3 vN;
varying vec4 vCol;
varying vec4 vProp;

// Long-range sun shadow from the height field (R = height below which a column is in shadow).
float ktFarShadow(vec3 wp, vec3 N) {
  vec3 p = wp + N * 0.3;
  vec2 uv = p.xz / vec2(${(NX * VS).toFixed(1)}, ${(NZ * VS).toFixed(1)});
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  float hs = texture2D(uFarShadow, uv).r * 64.0;
  return smoothstep(-0.9, 0.5, p.y - hs);
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = vWorld - cameraPosition;
  float dist = length(V);
  vec3 Vn = V / dist;
  float kind = vProp.z;
  float rough = vProp.x, metal = vProp.y, ao = vProp.w;
  vec3 albedo = vCol.rgb;
  float em = vCol.a;

  vec3 cellp = vWorld * ${(1 / VS).toFixed(1)} - N * 0.5;
  vec3 cell = floor(cellp);

  bool isAsphalt = kind > 0.5 && kind < 1.5;
  bool isBrick = kind > 1.5 && kind < 2.5;
  bool isMetal = (kind > 2.5 && kind < 3.5) || kind > 10.5;
  bool isPaint = kind > 10.5;
  bool isLight = kind > 4.5 && kind < 5.5;
  bool isWindow = kind > 5.5 && kind < 6.5;
  bool isPlant = kind > 6.5 && kind < 7.5;
  bool isWater = kind > 7.5 && kind < 8.5;
  bool isLine = kind > 8.5 && kind < 9.5;

  float varAmt = isBrick ? 0.30 : isPlant ? 0.42 : isMetal ? 0.07 : isAsphalt ? 0.05 : 0.14;
  float lineAmt = isPlant ? 0.10 : isMetal ? 0.18 : isAsphalt ? 0.10 : 0.13;
#ifdef KT_GLASS
  varAmt = 0.05; lineAmt = 0.0;
#endif
  vec3 vx = ktVoxel(cellp, N, varAmt, lineAmt);
  float h = vx.y;

  // macro variation: weathering in big soft patches, quantised per voxel so it stays honest
#ifdef KT_LOW
  float mac = ktNoise3(cell * 0.085);
#else
  float mac = ktNoise3(cell * 0.085) * 0.62 + ktNoise3(cell * 0.31 + 17.0) * 0.38;
#endif
  float wall = 1.0 - abs(N.y);
#ifndef KT_GLASS
  if (em < 0.5) {
    if (isAsphalt) albedo *= 2.1;      // sun-bleached tarmac: the table value reads as a black hole at dusk
    albedo *= vx.x;
    albedo *= 0.80 + 0.40 * mac;
    // grime: darker towards the pavement and in streaks under the weather
#ifdef KT_LOW
    float streak = 0.5;
#else
    float streak = ktNoise2(vec2(cell.x * 0.9 + cell.z * 0.7, cell.y * 0.07));
#endif
    float low = exp(-max(vWorld.y - ${(2.0).toFixed(1)}, 0.0) * 0.45);
    albedo *= 1.0 - wall * (0.20 * low + 0.14 * streak * (isMetal ? 0.3 : 1.0));
    if (isBrick) albedo *= mix(vec3(0.90, 0.95, 1.02), vec3(1.10, 1.0, 0.92), h);
    if (isPlant) albedo *= mix(vec3(0.75, 0.95, 0.7), vec3(1.25, 1.1, 0.8), h);
  }
#endif

  // roughness / wetness
  float wet = 0.0;
  if (isAsphalt) {
#ifdef KT_LOW
    wet = smoothstep(0.42, 0.70, mac) * N.y;
#else
    wet = smoothstep(0.42, 0.70, ktNoise2(cell.xz * 0.045 + 3.7) * 0.7 + mac * 0.3) * N.y;
#endif
    rough = mix(0.62, 0.20, wet) + (h - 0.5) * 0.10;
    albedo *= mix(1.0, 0.80, wet);
  }
  if (isLine) rough = 0.5;
  rough = clamp(rough + (h - 0.5) * 0.08, 0.05, 1.0);

  // a hair of per-voxel tilt breaks up reflections into facets (glass panes, wet tiles, car panels)
  vec3 Ns = N;
  float tilt = isAsphalt ? 0.018 + 0.022 * wet : isMetal ? 0.035 : 0.0;
#ifdef KT_GLASS
  tilt = 0.022;
#endif
#if defined(KT_LOW) && !defined(KT_GLASS)
  tilt = 0.0;
#endif
  if (tilt > 0.0) {
    vec3 j = vec3(ktHash13(cell + 7.3), ktHash13(cell + 19.1), ktHash13(cell + 31.7)) - 0.5;
    Ns = normalize(N + j * tilt * 2.0);
  }

  // ---- direct sun --------------------------------------------------------
  float ndl = max(dot(N, KT_SUN), 0.0);
  float shadow = 1.0;
  if (ndl > 0.0) {
    shadow = getShadowMask();
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
      vec3 sc = vDirectionalShadowCoord[0].xyz / vDirectionalShadowCoord[0].w;
      vec2 sq = abs(sc.xy - 0.5) * 2.0;
      float inMap = (1.0 - smoothstep(0.86, 0.99, max(sq.x, sq.y))) * step(sc.z, 1.0);
    #else
      float inMap = 0.0;
    #endif
    if (uFarShadowOn > 0.5) {
      float far = ktFarShadow(vWorld, N);
      shadow = mix(far, shadow, inMap);
    }
  }
  float aoS = 0.32 + 0.68 * ao;
  aoS *= aoS < 1.0 ? mix(0.9, 1.0, ao) : 1.0;
  vec3 direct = uSun * (ndl * shadow) * mix(0.72, 1.0, ao);
  vec3 ambient = ktAmbient(N) * aoS;

  // ---- flash pool (three point lights) -------------------------------------
  vec3 pl = vec3(0.0);
  #if NUM_POINT_LIGHTS > 0
    vec3 Nv = normalize(mat3(viewMatrix) * N);
    for (int i = 0; i < NUM_POINT_LIGHTS; i++) {
      vec3 L = pointLights[i].position - vViewPos;
      float ld = length(L);
      float att = getDistanceAttenuation(ld, pointLights[i].distance, pointLights[i].decay);
      pl += pointLights[i].color * (att * max(dot(Nv, L / ld) * 0.85 + 0.15, 0.0));
    }
    pl *= RECIPROCAL_PI;
  #endif

  // ---- specular: sun highlight + sky reflection -----------------------------
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  float ndv = max(dot(Ns, -Vn), 0.0);
  float fres = pow(1.0 - ndv, 5.0);
  vec3 H = normalize(KT_SUN - Vn);
  float ndh = max(dot(Ns, H), 0.0);
  float a = rough * rough;
  float sunNdl = max(dot(Ns, KT_SUN), 0.0);
  vec3 Fh = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, -Vn), 0.0), 5.0);
  vec3 spec = uSun * Fh * min(ktGGX(ndh, max(a, 0.02)) * 0.25 * 3.14159, 24.0) * sunNdl * shadow;
  vec3 R = reflect(Vn, Ns);
#if defined(KT_LOW) && !defined(KT_GLASS)
  vec3 skyR = mix(KT_HAZE_COOL, KT_ZENITH, clamp(abs(R.y) * 1.5, 0.0, 1.0));
#else
  vec3 skyR = ktSky(normalize(vec3(R.x, abs(R.y) * 0.9 + 0.02, R.z)));
#endif
  float gloss = (1.0 - rough);
  vec3 env = skyR * (F0 + (max(vec3(gloss), F0) - F0) * fres) * gloss * gloss * mix(0.45, 1.0, ao);

#ifdef KT_GLASS
  // translucent pane: dark tinted body, strong sky reflection, premultiplied alpha
  float fg = 0.06 + 0.94 * pow(1.0 - ndv, 4.0);
  vec3 skyG = ktSky(normalize(vec3(R.x, abs(R.y) + 0.03, R.z)));
  // reflections of the street side of the world: darker below the roofline
  skyG *= mix(0.35, 1.0, smoothstep(-0.05, 0.35, R.y));
  float alpha = isWater ? 0.78 : mix(0.30, 0.94, fg);
  vec3 body = albedo * (direct * 0.5 + ambient) * 0.55;
  vec3 col = body * alpha + skyG * fg * 0.9 + spec * 1.5 + pl * albedo * 0.3;
  col += albedo * em * ${EMISSIVE_SCALE.toFixed(2)} * alpha;
  float fa = ktFogAmount(V, cameraPosition.y, uFogDensity);
  col = mix(col, ktHaze(Vn) * alpha, fa);
  gl_FragColor = vec4(col, alpha);
#else
  vec3 diff = albedo * (1.0 - metal * 0.85) * (direct + ambient + pl);
  vec3 col = diff + spec + env;
  if (em > 0.0) {
    // lamps glow without turning into blank white cubes: hot core, coloured rim, dimmed up close (bloom carries the rest)
    float near = 0.42 + 0.58 * smoothstep(6.0, 38.0, dist);
    vec3 cf = cellp - cell;
    vec2 cuv = abs(N.x) > 0.5 ? cf.zy : (abs(N.y) > 0.5 ? cf.xz : cf.xy);
    vec2 ce = min(cuv, 1.0 - cuv);
    float core = smoothstep(0.0, 0.42, min(ce.x, ce.y));
    float e = em * near;
    vec3 ec = albedo;
    if (isWindow) {
      // rooms differ: per-bay brightness and warmth, a few are dark
      vec3 room = floor(vec3(cell.x / 4.0, cell.y / 7.0, cell.z / 4.0));
      float rh = ktHash13(room + 5.0), rh2 = ktHash13(room + 11.0);
      e *= rh < 0.12 ? 0.08 : mix(0.35, 0.80, rh2);
      ec *= mix(vec3(1.0, 0.82, 0.62), vec3(0.95, 1.0, 1.05), step(0.82, rh2));
      e *= 0.82 + 0.18 * vx.x + 0.22 * (h - 0.5);
      e *= 0.72 + 0.28 * core;
      e *= mix(1.12, 0.80, fract((cell.y - 4.0) / 7.0));
      col = albedo * 0.10 * (direct + ambient) + env * 2.0 + spec;
    } else if (isLight) {
      e *= 0.94 + 0.06 * sin(uTime * (7.0 + h * 9.0) + h * 40.0);
      e *= 0.30 + 0.70 * core;
      ec = mix(ec * ec, ec, core);
      col *= 0.3;
    } else {
      e *= 0.9 + 0.1 * vx.x;
    }
    col += ec * e * ${EMISSIVE_SCALE.toFixed(2)};
  }
  col = ktApplyFog(col, V, cameraPosition.y, uFogDensity);
  gl_FragColor = vec4(col, 1.0);
#endif
}
`;

export function makeVoxelMaterials(shared) {
  const mk = (glass) => {
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.lights, {}]);
    Object.assign(u, shared);
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG, lights: true, fog: false,
      defines: glass ? { KT_GLASS: 1 } : {},
    });
    if (glass) { m.transparent = true; m.depthWrite = false; m.premultipliedAlpha = true; }
    return m;
  };
  return { opaque: mk(false), glass: mk(true) };
}

export function sharedUniforms() {
  return {
    uSun: { value: ATMO.sun.clone() }, uSkyUp: { value: ATMO.skyUp.clone() }, uSkySide: { value: ATMO.skySide.clone() }, uGround: { value: ATMO.ground.clone() },
    uFogDensity: { value: ATMO.fogDensity }, uTime: { value: 0 },
    uMatTex: { value: null }, uFarShadow: { value: null }, uFarShadowOn: { value: 0 },
  };
}
