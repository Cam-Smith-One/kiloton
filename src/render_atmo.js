// ============================================================================
// KILOTON — render_atmo.js   OWNER: RENDER
// The golden-hour atmosphere in one place: sun, sky, haze constants (linear HDR)
// and the GLSL every RENDER shader shares (hash/noise, sky gradient, fog).
// Also patches three's fog chunks so EVERY material in the scene (rigs, debris,
// particles from other agents) gets the same height fog that catches the sun.
// ============================================================================
import { THREE, GROUND_Y } from './core.js';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
const elev = 25 * Math.PI / 180, azim = 33 * Math.PI / 180;     // sun 25° up, in the west-south-west

export const ATMO = {
  sunDir: v3(-Math.cos(elev) * Math.cos(azim), Math.sin(elev), Math.cos(elev) * Math.sin(azim)).normalize(),
  // "albedo multipliers": lit = albedo * (sun * NdotL * shadow + ambient(normal))
  sun: v3(1.95, 1.18, 0.60),            // warm key
  skyUp: v3(0.21, 0.29, 0.50),          // cool blue-violet fill from above
  skySide: v3(0.27, 0.27, 0.36),        // horizon fill on walls
  ground: v3(0.20, 0.145, 0.105),       // warm bounce from below
  // sky / haze radiance
  zenith: v3(0.085, 0.155, 0.40),
  hazeWarm: v3(1.05, 0.60, 0.33),       // horizon towards the sun
  hazeCool: v3(0.36, 0.40, 0.56),       // horizon away from the sun
  sunGlow: v3(1.9, 0.95, 0.38),
  sunDisc: v3(70, 42, 16),
  groundFar: v3(0.16, 0.15, 0.17),
  fogDensity: 0.0026,                   // optical depth per metre at street level
  fogHeight: 0.032,                     // falloff with height (1/m)
  fogBase: 0.28,                        // share of the haze that does not fall off with height
};

const f = n => { const s = (+n).toFixed(5); return s.includes('.') ? s : s + '.0'; };
const g3 = v => `vec3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`;
const sunH = v3(ATMO.sunDir.x, 0, ATMO.sunDir.z).normalize();

// ---- shared GLSL (guarded: three's patched fog chunk includes it too) -------
export const GLSL_ATMO = /* glsl */`
#ifndef KT_ATMO
#define KT_ATMO
const vec3 KT_SUN = ${g3(ATMO.sunDir)};
const vec3 KT_SUNH = ${g3(sunH)};
const vec3 KT_ZENITH = ${g3(ATMO.zenith)};
const vec3 KT_HAZE_WARM = ${g3(ATMO.hazeWarm)};
const vec3 KT_HAZE_COOL = ${g3(ATMO.hazeCool)};
const vec3 KT_SUNGLOW = ${g3(ATMO.sunGlow)};
const vec3 KT_GROUND_FAR = ${g3(ATMO.groundFar)};
// Colour of the haze looking along dir (matches the sky at the horizon, so far things melt into it).
vec3 ktHaze(vec3 dir) {
  vec2 h = dir.xz / max(length(dir.xz), 1e-4);
  float az = 0.5 + 0.5 * dot(h, KT_SUNH.xz);
  float sd = max(dot(dir, KT_SUN), 0.0);
  vec3 c = mix(KT_HAZE_COOL, KT_HAZE_WARM, az * az * az * (1.0 - 0.85 * dir.y * dir.y));
  return c + KT_SUNGLOW * (pow(sd, 6.0) * 0.36);
}
// Sky radiance without sun disc and clouds (also used for reflections).
vec3 ktSky(vec3 d) {
  float y = d.y;
  float sd = max(dot(d, KT_SUN), 0.0);
  vec3 haze = ktHaze(d);
  float t = pow(1.0 - clamp(y, 0.0, 1.0), 4.5);
  vec3 c = mix(KT_ZENITH, haze, t);
  // a soft violet-rose belt opposite the sun, low in the sky
  vec2 h = d.xz / max(length(d.xz), 1e-4);
  float anti = 0.5 - 0.5 * dot(h, KT_SUNH.xz);
  c += vec3(0.16, 0.07, 0.13) * anti * anti * exp(-abs(y - 0.16) * 9.0);
  c += KT_SUNGLOW * (pow(sd, 24.0) * 0.55 + pow(sd, 220.0) * 2.2);
  if (y < 0.0) c = mix(haze, KT_GROUND_FAR, smoothstep(0.0, -0.22, y));
  return c;
}
// Height fog with analytic integration along the view ray. V = fragment - camera (world).
float ktFogAmount(vec3 V, float camY, float density) {
  float d = length(V);
  float hf = ${f(ATMO.fogHeight)};
  float t = hf * V.y;
  float integ = abs(t) > 0.002 ? (1.0 - exp(-clamp(t, -30.0, 30.0))) / t : 1.0;
  float od = density * d * (${f(ATMO.fogBase)} + ${f(1 - ATMO.fogBase)} * exp(-hf * clamp(camY - ${f(GROUND_Y)}, -8.0, 400.0)) * integ);
  return 1.0 - exp(-od);
}
vec3 ktApplyFog(vec3 col, vec3 V, float camY, float density) {
  float a = ktFogAmount(V, camY, density);
  return mix(col, ktHaze(normalize(V)), a);
}
float ktHash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float ktHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float ktNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ktHash12(i), ktHash12(i + vec2(1.0, 0.0)), f.x), mix(ktHash12(i + vec2(0.0, 1.0)), ktHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float ktNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(ktHash13(i), ktHash13(i + vec3(1.0, 0.0, 0.0)), f.x), mix(ktHash13(i + vec3(0.0, 1.0, 0.0)), ktHash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(ktHash13(i + vec3(0.0, 0.0, 1.0)), ktHash13(i + vec3(1.0, 0.0, 1.0)), f.x), mix(ktHash13(i + vec3(0.0, 1.0, 1.0)), ktHash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
#endif
`;

// ---- three fog chunks -> our fog -------------------------------------------
// Works for every built-in material and any ShaderMaterial that includes the
// four standard fog chunks (fog: true). scene.fog must be a FogExp2; its
// density is the street-level optical depth per metre, its colour is unused.
let patched = false;
export function patchThreeFog() {
  if (patched) return; patched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vKtFogV;
#endif
`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vKtFogV = ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vKtFogV;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${GLSL_ATMO}
#endif
`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float ktFogD = fogDensity;
  #else
    float ktFogD = 2.0 / max( fogFar, 1.0 );
  #endif
  float fogFactor = ktFogAmount( vKtFogV, cameraPosition.y, ktFogD );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, ktHaze( normalize( vKtFogV ) ), fogFactor );
#endif
`;
}
