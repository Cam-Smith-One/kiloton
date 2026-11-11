// ============================================================================
// KILOTON — fx_shaders.js   OWNER: FX.  GLSL for the particle and beam pools.
// Particles are simulated entirely in the vertex shader from spawn parameters:
//   a0 = pos.xyz, birth        a1 = vel.xyz, life
//   a2 = size0, size1, rot, spin
//   a3 = drag, gravity(+down), turbulence, seed
//   a4 = albedo.rgb, opacity   (the LIT part: smoke / dust)
//   a5 = emissive.rgb (HDR), hot (fraction of life the particle stays incandescent; 0 = never)
//   a6 = shape, stretch, floorY, sizePow
// shapes: 0 soft lit puff | 1 flame / fireball puff | 2 spark (velocity stretched) | 3 ground ring
//         4 glow flash | 5 glint (twinkling shard) | 6 soft sphere shell (air shock)
// Output is PREMULTIPLIED (blend ONE, ONE_MINUS_SRC_ALPHA): emissive adds, lit smoke occludes, so one
// particle can start as fire and cool into black smoke.
// ============================================================================

export const PARTICLE_VS = /* glsl */`
attribute vec4 a0, a1, a2, a3, a4, a5, a6;
uniform float uTime;
uniform vec3 uWind;
uniform vec3 uSunDir;
uniform vec4 uLP[4];      // flash lights: xyz, radius
uniform vec3 uLC[4];      // flash lights: colour * intensity
varying vec2 vUv;         // quad coords -1..1 (screen aligned)
varying vec2 vUvR;        // rotated coords for the noise lookup
varying vec4 vAlb;
varying vec4 vEmi;        // rgb, heat 0..1
varying vec4 vP;          // shape, u (age / life), seed, aspect
varying vec3 vSunV;
varying vec3 vUpV;
varying vec3 vPL;
varying float vNear;
varying float vFloor;
varying float vFogDepth;

void main() {
  float age = uTime - a0.w;
  float life = a1.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / life;
  float k = max(a3.x, 0.05);
  float ek = exp(-k * age);
  float f = (1.0 - ek) / k;
  float h = (age - f) / k;
  vec3 p = a0.xyz + a1.xyz * f + uWind * (age - f);
  p.y -= a3.y * h;
  float sd = a3.w;
  vec3 ph = vec3(sd * 61.7, sd * 37.3, sd * 47.9);
  p += (sin(ph + age * vec3(1.1, 0.8, 0.95)) - sin(ph)) * a3.z * vec3(1.0, 0.45, 1.0);
  if (a6.z > -500.0) p.y = max(p.y, a6.z);

  float shape = a6.x;
  float s = mix(a2.x, a2.y, 1.0 - pow(1.0 - u, a6.w));
  vec2 c = position.xy;
  float aspect = 1.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vNear = 1.0;
  vFloor = 4.0;

  if (shape > 2.5 && shape < 3.5) {                     // ground ring: world XZ quad
    mv = viewMatrix * vec4(p + vec3(c.x, 0.0, c.y) * s, 1.0);
    vUvR = c;
  } else if ((shape > 1.5 && shape < 2.5) || (shape > 4.5 && shape < 5.5)) {   // spark / glint: stretched along velocity
    vec3 v = a1.xyz * ek + uWind * (1.0 - ek);
    v.y -= a3.y * f;
    if (a6.z > -500.0 && p.y <= a6.z + 0.001) v *= 0.0;
    vec3 vv = (viewMatrix * vec4(v, 0.0)).xyz;
    float sp = length(vv.xy);
    vec2 d = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
    float len = s * (1.0 + a6.y * sp);
    // keep far sparks at least ~1 px wide so they do not shimmer away
    float px = -mv.z * 0.0011;
    float w = max(s, px);
    len = max(len, w);
    aspect = len / w;
    mv.xy += d * c.x * len + vec2(-d.y, d.x) * c.y * w;
    vUvR = c;
  } else {                                              // camera facing billboard
    float a = a2.z + a2.w * age;
    float ca = cos(a), sa = sin(a);
    vUvR = vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
    mv.xy += c * s * vec2(1.0, 1.0 + a6.y);
    if (shape < 1.5) {
      vNear = smoothstep(0.4, 0.4 + s * 1.3, -mv.z);
      // soft contact with the ground: fade the part of the billboard that would cut into the street
      if (a6.z > -500.0) vFloor = (p.y + s * (c.x * viewMatrix[0][1] + c.y * viewMatrix[1][1]) - a6.z) / (0.5 * s + 0.12);
    }
  }
  vUv = c;
  vAlb = a4;
  float heat = a5.w > 0.0 ? clamp(1.0 - u / a5.w, 0.0, 1.0) : 0.0;
  vEmi = vec4(a5.rgb, heat);
  vP = vec4(shape, u, sd, aspect);
  vSunV = (viewMatrix * vec4(uSunDir, 0.0)).xyz;
  vUpV = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
  vec3 pl = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec3 dl = uLP[i].xyz - p;
    float att = max(0.0, 1.0 - length(dl) / max(uLP[i].w, 0.01));
    pl += uLC[i] * att * att;
  }
  vPL = pl;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

export const PARTICLE_FS = /* glsl */`
uniform float uTime;
uniform vec3 uSunCol;
uniform vec3 uSkyCol;
uniform vec3 uGndCol;
uniform float uExposure;
uniform vec3 uFogCol;
uniform vec2 uFog;        // optical depth = x * d + y * d * d
varying vec2 vUv;
varying vec2 vUvR;
varying vec4 vAlb;
varying vec4 vEmi;
varying vec4 vP;
varying vec3 vSunV;
varying vec3 vUpV;
varying vec3 vPL;
varying float vNear;
varying float vFloor;
varying float vFogDepth;

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x), mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.5 * vnoise(p); p = p * 2.03 + 17.3;
  s += 0.25 * vnoise(p); p = p * 2.01 + 9.1;
  s += 0.125 * vnoise(p);
  return s / 0.875;
}
// incandescence ramp: deep saturated at low temperature, towards white-hot at high
vec3 fireRamp(float t, vec3 tint) {
  t = clamp(t, 0.0, 1.5);
  vec3 deep = tint * tint * vec3(1.0, 0.62, 0.45);
  vec3 hot = tint + vec3(0.16, 0.2, 0.22);
  return mix(deep, hot, smoothstep(0.45, 1.3, t)) * t * t;
}

void main() {
  float shape = vP.x, u = vP.y, seed = vP.z;
  float r = length(vUv);
  vec3 rgb = vec3(0.0);
  float alpha = 0.0;

  if (shape < 1.5) {
    // ---- volumetric puff (smoke, dust, fireball) --------------------------------------------
    bool lick = shape > 0.5 && vAlb.a <= 0.0;      // pure flame: a teardrop that narrows upwards
    if (lick) r = length(vec2(vUv.x * (1.25 + 0.75 * vUv.y), vUv.y));
    if (r > 1.0) discard;
    vec2 q = (lick ? vUv * vec2(1.7, 1.0) : vUvR * 1.55) + seed * vec2(37.0, 91.0);
    float n = fbm(q + vec2(0.0, -u * (lick ? 2.2 : 0.7)));
    float n2 = fbm(q * 2.1 + 31.7 + vec2(u * 0.5, 0.0));
    float erode = mix(0.42, 1.0, u * u) + (shape > 0.5 ? 0.12 : 0.0);
    float body = (1.0 - r) - (1.0 - n) * erode * 0.95 - (0.5 - n2) * 0.22;
    float dens = smoothstep(0.0, 0.3, body) * smoothstep(0.0, 1.0, vFloor);
    if (dens < 0.004) discard;
    // fake volume normal: sphere + noise lumps
    vec2 bump = (vec2(n, n2) - 0.5) * 1.5;
    vec3 N = normalize(vec3(vUv * 1.05 + bump, 0.5 * sqrt(max(0.0, 1.0 - r * r)) + 0.22));
    float ndl = dot(N, vSunV);
    float wrap = clamp((ndl + 0.35) / 1.35, 0.0, 1.0);
    // light leaking through thin edges when the sun is behind the cloud
    float thin = 1.0 - smoothstep(0.0, 0.75, body);
    float back = clamp(-vSunV.z, 0.0, 1.0);
    float trans = back * back * thin * 0.9;
    float up = dot(N, vUpV);
    float occ = mix(0.55, 1.0, smoothstep(0.15, 0.8, n)) * mix(0.8, 1.0, smoothstep(0.0, 0.6, body));
    vec3 light = uSunCol * (wrap * wrap * 1.05 + trans) * occ
               + uSkyCol * (0.55 + 0.45 * up) * mix(0.75, 1.0, occ)
               + uGndCol * (0.5 - 0.5 * up)
               + vPL * (0.2 + 0.35 * occ);
    float fadeIn = shape > 0.5 ? 1.0 : smoothstep(0.0, 0.06, u);
    float fadeOut = 1.0 - smoothstep(0.5, 1.0, u);
    float heat = vEmi.a;
    float hh = heat * heat;
    alpha = dens * vAlb.a * fadeIn * fadeOut * vNear * (1.0 - 0.8 * hh);
    rgb = vAlb.rgb * light * uExposure * alpha;
    if (heat > 0.0) {
      // hot core breaking through cooler, darker crust
      float temp = heat * (0.2 + 1.3 * n) * (1.15 - r * 0.85) * (0.55 + 0.45 * dens) + hh * hh * 0.3;
      temp *= smoothstep(-0.05, 0.25, body);
      rgb += fireRamp(temp, normalize(vEmi.rgb + 1e-4) * 1.2) * length(vEmi.rgb) * vNear * (vAlb.a > 0.0 ? 1.0 : fadeOut);
    }
  } else if (shape < 2.5 || (shape > 4.5 && shape < 5.5)) {
    // ---- spark / ember / glint: capsule ---------------------------------------------------------
    float asp = vP.w;
    float dx = max(abs(vUv.x) * asp - (asp - 1.0), 0.0);
    float d = length(vec2(dx, vUv.y));
    if (d > 1.0) discard;
    float tail = asp > 1.5 ? mix(0.35, 1.0, vUv.x * 0.5 + 0.5) : 1.0;
    float core = exp(-d * d * 5.0) * (1.0 - d) + exp(-d * d * 40.0) * 1.5;
    float fade = 1.0 - smoothstep(0.55, 1.0, u);
    vec3 col = vEmi.rgb;
    if (shape < 2.5) {
      float heat = vEmi.a;
      col *= mix(vec3(0.75, 0.18, 0.04), vec3(1.0), smoothstep(0.0, 0.7, heat)) * (0.25 + 0.75 * heat);
    } else {
      float tw = fract(sin(seed * 913.7 + floor(uTime * 22.0 + seed * 40.0) * 12.9898) * 43758.5453);
      col *= 0.1 + 2.4 * step(0.62, tw);
    }
    rgb = col * core * fade * tail;
  } else if (shape < 3.5) {
    // ---- ground ring (shock front / dust ring) ---------------------------------------------------
    if (r > 1.0) discard;
    float ang = atan(vUv.y, vUv.x);
    float n = fbm(vec2(ang * 2.6 + seed * 40.0, r * 3.0 - u * 2.0 + seed * 9.0));
    float band = smoothstep(0.52, 0.86, r) * (1.0 - smoothstep(0.88, 1.0, r));
    float inner = (1.0 - smoothstep(0.0, 0.9, r)) * 0.18;
    float fade = (1.0 - u) * (1.0 - u);
    float m = (band * (0.45 + 0.9 * n) + inner) * fade;
    alpha = clamp(m * vAlb.a, 0.0, 1.0);
    vec3 light = uSunCol * 0.6 * clamp(vSunV.y * 0.0 + 0.8, 0.0, 1.0) + uSkyCol * 0.9 + vPL;
    rgb = vAlb.rgb * light * uExposure * alpha + vEmi.rgb * band * (0.5 + n) * fade * vEmi.a;
  } else if (shape < 4.5) {
    // ---- glow flash ----------------------------------------------------------------------------------
    if (r > 1.0) discard;
    float w = 1.0 - r;
    float g = (exp(-r * r * 7.0) + 0.35 * exp(-r * r * 1.8)) * w * w * (3.0 - 2.0 * w);
    float fade = (1.0 - u); fade *= fade;
    rgb = vEmi.rgb * g * fade;
  } else {
    // ---- thin spherical shell (air shock) ----------------------------------------------------------
    if (r > 1.0) discard;
    float n = fbm(vUvR * 3.0 + seed * 20.0);
    float band = smoothstep(0.8, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
    float fade = (1.0 - u); fade *= fade;
    rgb = vEmi.rgb * (band * (0.25 + 0.75 * n) * 0.6 + 0.012 * r) * fade;
  }

  // fog: lit part fades towards the fog colour, emissive part is absorbed
  float ff = 1.0 - exp(-(uFog.x + uFog.y * vFogDepth) * vFogDepth);
  rgb = mix(rgb, uFogCol * alpha, ff);
  gl_FragColor = vec4(rgb, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Beams: b0 = p0.xyz, birth   b1 = p1.xyz, life   b2 = rgb (HDR), width   b3 = mode, streakLen, seed, _
// mode 0 tracer (a streak that travels p0 -> p1 over its life)   1 pulse (bolt streak + fading afterglow line)
//      2 lock (thin steady line)   3 static flash line (fades in place)
export const BEAM_VS = /* glsl */`
attribute vec4 b0, b1, b2, b3;
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vP;     // mode, u, seed, lengthMetres
varying float vFogDepth;
void main() {
  float age = uTime - b0.w;
  float life = b1.w;
  if (age < 0.0 || age >= life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / life;
  float mode = b3.x;
  vec3 A = b0.xyz, B = b1.xyz;
  float L = max(length(B - A), 1e-3);
  vec3 dir = (B - A) / L;
  if (mode < 0.5) {
    float sl = min(b3.y, L);
    float head = mix(sl * 0.5, L, u);
    A = b0.xyz + dir * max(0.0, head - sl);
    B = b0.xyz + dir * head;
  }
  float seg = length(B - A);
  vec3 wp = mix(A, B, position.x * 0.5 + 0.5);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vec3 dv = (viewMatrix * vec4(dir, 0.0)).xyz;
  vec3 side = cross(dv, normalize(mv.xyz));
  float sl2 = length(side);
  side = sl2 > 1e-4 ? side / sl2 : vec3(0.0, 1.0, 0.0);
  float w = max(b2.w, -mv.z * 0.0013);
  mv.xyz += side * position.y * w;
  vUv = position.xy;
  vCol = vec4(b2.rgb * min(1.0, b2.w / w * 1.5 + 0.25), 1.0);
  vP = vec4(mode, u, b3.z, seg);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
export const BEAM_FS = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying vec4 vCol;
varying vec4 vP;
varying float vFogDepth;
uniform vec2 uFog;
void main() {
  float mode = vP.x, u = vP.y;
  float y = abs(vUv.y);
  float x = vUv.x * 0.5 + 0.5;            // 0 tail .. 1 head
  float across = exp(-y * y * 9.0) * (1.0 - y) + exp(-y * y * 90.0) * 1.6;
  float along = 1.0;
  vec3 col = vCol.rgb;
  if (mode < 0.5) {
    along = smoothstep(0.0, 0.85, x) * (1.0 - smoothstep(0.96, 1.0, x));
    along *= 1.0 - smoothstep(0.85, 1.0, u);
  } else if (mode < 1.5) {
    // afterglow line with a bright front that runs down it
    float front = exp(-pow((x - u * 1.25) * 5.0, 2.0)) * 2.2;
    float glow = (1.0 - u) * (1.0 - u) * 0.55 * smoothstep(0.0, 0.05, x) * (1.0 - smoothstep(0.97, 1.0, x));
    along = front * (1.0 - smoothstep(0.8, 1.0, u)) + glow;
    col = mix(col, col + vec3(0.6), exp(-y * y * 60.0) * 0.7);
  } else if (mode < 2.5) {
    float dash = step(0.45, fract(x * vP.w * 0.6 - uTime * 3.0));
    along = (0.35 + 0.65 * dash) * (1.0 - u);
    across = exp(-y * y * 14.0);
  } else {
    along = (1.0 - u) * (1.0 - u) * smoothstep(0.0, 0.04, x) * (1.0 - smoothstep(0.96, 1.0, x));
  }
  vec3 rgb = col * across * along;
  rgb *= exp(-(uFog.x + uFog.y * vFogDepth) * vFogDepth);
  gl_FragColor = vec4(rgb, 0.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
