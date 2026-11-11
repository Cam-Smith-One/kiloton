// ============================================================================
// KILOTON — render_sky.js   OWNER: RENDER
// Sky dome (gradient, sun, layered clouds), the world beyond the 192 m grid
// (ground plane, near blocks, hazy far skyline) and the reflection environment
// for other agents' PBR materials.
// ============================================================================
import { THREE, WX, WZ, GROUND_Y, mulberry32 } from './core.js';
import { ATMO, GLSL_ATMO } from './render_atmo.js';
import { GLSL_LIGHT } from './render_voxmat.js';

const g3 = v => `vec3(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;
const SKY_FRAG = /* glsl */`
${GLSL_ATMO}
uniform float uTime;
varying vec3 vDir;
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < KT_OCT; i++) { s += a * ktNoise2(p); p = p * 2.03 + vec2(17.3, 9.1); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  vec3 c = ktSky(d);
  float sd = dot(d, KT_SUN);
  if (d.y > -0.02) {
    float yy = max(d.y, 0.0);
    vec2 p = d.xz / (yy + 0.16);
    vec2 sdir = KT_SUNH.xz;
    float horizon = 1.0 - exp(-yy * 9.0);
    // high streaked cirrus
    vec2 q = vec2(dot(p, vec2(0.80, 0.60)), dot(p, vec2(-0.60, 0.80)));
    float ci = fbm(q * vec2(0.42, 2.3) + vec2(uTime * 0.004, 0.0));
    ci = smoothstep(0.56, 0.84, ci) * 0.42;
    float toSun = pow(max(sd, 0.0), 3.0);
    vec3 ciCol = mix(vec3(0.70, 0.46, 0.52), vec3(2.3, 1.3, 0.75), toSun * 0.8 + 0.15);
    c = mix(c, ciCol, ci * horizon);
    // lower broken cumulus with eroded edges, lit from the sun side
    vec2 w = p * 1.05 + vec2(uTime * 0.007, uTime * 0.003);
#if KT_OCT > 3
    float n1 = fbm(w) + (fbm(w * 3.3 + 11.0) - 0.5) * 0.30;
#else
    float n1 = fbm(w) * 1.04;
#endif
    float dens = smoothstep(0.55, 0.69, n1);
    if (dens > 0.001) {
      vec2 w2 = w + sdir * 0.11;
#if KT_OCT > 3
      float n2 = fbm(w2) + (fbm(w2 * 3.3 + 11.0) - 0.5) * 0.30;
#else
      float n2 = fbm(w2) * 1.04;
#endif
      float lit = clamp((n1 - n2) * 4.5 + 0.42, 0.0, 1.0);
      vec3 dark = mix(vec3(0.24, 0.22, 0.34), vec3(0.55, 0.30, 0.27), toSun);
      vec3 bright = mix(vec3(1.25, 0.80, 0.62), vec3(3.2, 1.8, 0.85), toSun);
      vec3 cc = mix(dark, bright, lit * lit);
      cc += KT_SUNGLOW * pow(max(sd, 0.0), 10.0) * (1.0 - dens) * 1.5;      // silver lining
      c = mix(c, cc, dens * 0.94 * horizon);
    }
    c = mix(ktSky(vec3(d.x, 0.0, d.z)), c, smoothstep(0.0, 0.10, yy) * 0.9 + 0.1);
  }
#ifndef KT_NO_DISC
  float disc = smoothstep(0.99970, 0.99986, sd);
  c += ${g3(ATMO.sunDisc)} * disc;
#endif
  gl_FragColor = vec4(c, 1.0);
}
`;

export function makeSky(octaves) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    defines: { KT_OCT: octaves }, depthWrite: false, depthTest: true, side: THREE.BackSide, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.matrixAutoUpdate = false;
  mesh.name = 'kt-sky';
  return mesh;
}

// Reflection environment for MeshStandardMaterial etc.: the sky without the sun disc, plus a dark warm ground.
export function makeEnvironment(renderer) {
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: SKY_FRAG, defines: { KT_OCT: 4, KT_NO_DISC: 1 }, side: THREE.BackSide, depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(50, 3), mat);
  scene.add(dome);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.03, 1, 200);
  pm.dispose(); mat.dispose(); dome.geometry.dispose();
  return rt;
}

// ---- the world beyond the grid ----------------------------------------------
const OUT_VERT = /* glsl */`
attribute vec4 aInfo;       // seed, kind (0 wall, 1 pavement slab, 2 open ground), height, lit share
varying vec3 vWorld; varying vec3 vN; varying vec4 vInfo;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz; vN = normal; vInfo = aInfo;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const OUT_FRAG = /* glsl */`
${GLSL_ATMO}
${GLSL_LIGHT}
uniform float uFogDensity;
varying vec3 vWorld; varying vec3 vN; varying vec4 vInfo;
void main() {
  vec3 N = normalize(vN);
  vec3 V = vWorld - cameraPosition;
  vec3 Vn = normalize(V);
  float seed = vInfo.x, kind = vInfo.y;
  vec3 cellp = vWorld * 2.0 - N * 0.5;
  vec3 cell = floor(cellp);
  vec3 col;
  float ndl = max(dot(N, KT_SUN), 0.0);
  float y = vWorld.y - ${GROUND_Y.toFixed(1)};
  if (kind > 1.5) {
    // open ground: asphalt, shaded by buildings that are not there in patches
    vec3 vx = ktVoxel(cellp, N, 0.05, 0.10);
    float mac = ktNoise2(cell.xz * 0.085);
    vec3 alb = vec3(0.0296, 0.0319, 0.0382) * 2.1 * vx.x * (0.80 + 0.40 * mac);
    float wet = smoothstep(0.42, 0.70, ktNoise2(cell.xz * 0.045 + 3.7) * 0.7 + mac * 0.3);
    alb *= mix(1.0, 0.80, wet);
    float sh = smoothstep(0.52, 0.66, ktNoise2(vWorld.xz * 0.021 + 40.0));
    float rough = mix(0.62, 0.20, wet);
    vec3 H = normalize(KT_SUN - Vn);
    float sp = min(ktGGX(max(dot(N, H), 0.0), rough * rough) * 0.785, 24.0) * 0.04 * ndl * sh;
    float fres = pow(1.0 - max(dot(N, -Vn), 0.0), 5.0);
    vec3 R = reflect(Vn, N);
    col = alb * (uSun * ndl * sh + ktAmbient(N)) + uSun * sp + ktSky(vec3(R.x, abs(R.y) + 0.02, R.z)) * (0.04 + (1.0 - rough) * fres) * (1.0 - rough) * (1.0 - rough);
  } else if (kind > 0.5) {
    vec3 vx = ktVoxel(cellp, N, 0.14, 0.13);
    vec3 alb = vec3(0.27, 0.275, 0.29) * vx.x;
    float sh = smoothstep(0.50, 0.66, ktNoise2(vWorld.xz * 0.021 + 40.0));
    col = alb * (uSun * ndl * sh + ktAmbient(N));
  } else {
    float h1 = fract(seed * 7.13), h2 = fract(seed * 13.7), h3 = fract(seed * 29.3);
    vec3 wallC = h1 < 0.30 ? vec3(0.33, 0.34, 0.36) : h1 < 0.52 ? vec3(0.30, 0.085, 0.060) : h1 < 0.70 ? vec3(0.46, 0.33, 0.20) : h1 < 0.86 ? vec3(0.115, 0.125, 0.14) : vec3(0.66, 0.64, 0.59);
    wallC *= 0.8 + 0.4 * h2;
    vec3 vx = ktVoxel(cellp, N, 0.14, 0.12);
    float mac = ktNoise3(cell * 0.085);
    vec3 alb = wallC * vx.x * (0.82 + 0.36 * mac);
    float wall = 1.0 - abs(N.y);
    // window grid quantised to voxels: storeys of 7, bays of 4..6
    float bay = 4.0 + floor(h3 * 3.0);
    float along = abs(N.x) > 0.5 ? cell.z : cell.x;
    float fy = mod(cell.y - 4.0, 7.0), fx = mod(along + floor(seed * 31.0), bay);
    bool tower = h1 >= 0.70 && h1 < 0.86;
    bool win = wall > 0.5 && y > 3.0 && ((tower && fy > 0.5 && fx > 0.5) || (!tower && fy > 1.5 && fy < 5.5 && fx > 0.5 && fx < bay - 1.5));
    // sun: lower storeys sit in the shadow of the next block
    float shH = 5.0 + 22.0 * ktNoise2(vWorld.xz * 0.013 + seed);
    float sh = N.y > 0.5 ? 1.0 : smoothstep(shH - 2.5, shH + 2.5, y);
    float low = exp(-max(y, 0.0) * 0.35);
    alb *= 1.0 - wall * 0.22 * low;
    col = alb * (uSun * ndl * sh + ktAmbient(N) * mix(0.55, 1.0, smoothstep(0.0, 9.0, y)));
    if (N.y > 0.5) col = mix(vec3(0.045, 0.047, 0.052), vec3(0.16, 0.145, 0.125), h2 * h2) * vx.x * (uSun * ndl + ktAmbient(N));
    if (win) {
      vec3 room = vec3(floor(along / bay), floor((cell.y - 4.0) / 7.0), seed * 91.0);
      float rh = ktHash13(room + 3.0), rh2 = ktHash13(room + 9.0);
      vec3 R = reflect(Vn, N);
      float fres = 0.06 + 0.94 * pow(1.0 - max(dot(N, -Vn), 0.0), 4.0);
      vec3 gl = vec3(0.020, 0.030, 0.042) * (uSun * ndl * sh + ktAmbient(N)) + ktSky(vec3(R.x, abs(R.y) + 0.03, R.z)) * fres * mix(0.3, 0.9, sh);
      float lit = step(rh, vInfo.w);
      vec3 warm = mix(vec3(1.0, 0.55, 0.22), vec3(0.75, 0.85, 1.0), step(0.85, rh2));
      gl += warm * lit * mix(0.5, 1.7, rh2) * (0.8 + 0.2 * vx.x);
      col = gl * (1.0 - 0.25 * vx.z);
    }
  }
  col = ktApplyFog(col, V, cameraPosition.y, uFogDensity);
  gl_FragColor = vec4(col, 1.0);
}
`;

function pushBox(P, Nn, I, IDX, x0, y0, z0, x1, y1, z1, seed, kind, lit, top = true) {
  const faces = [
    [1, 0, 0, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [-1, 0, 0, [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]],
    [0, 0, 1, [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]],
    [0, 0, -1, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
  ];
  if (top) faces.push([0, 1, 0, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]);
  for (const f of faces) {
    const b = P.length / 3;
    for (let c = 3; c < 7; c++) { P.push(f[c][0], f[c][1], f[c][2]); Nn.push(f[0], f[1], f[2]); I.push(seed, f[1] > 0 && kind === 0 ? 0 : kind, y1 - y0, lit); }
    IDX.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

export function makeOutskirts(seed, shared) {
  const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
  const P = [], Nn = [], I = [], IDX = [];
  const gy = GROUND_Y, cx = WX / 2, cz = WZ / 2;
  // block intervals along one axis: outside on both sides, 4 across the width of the map
  const GAP = 8, BL = 44, RD = 16, LIM = 760;
  const ivs = [];
  for (let n = 0; ; n++) { const b = -GAP - n * (BL + RD); if (b - BL < cx - LIM) break; ivs.push([b - BL, b, true]); }
  for (let n = 0; ; n++) { const a = WX + GAP + n * (BL + RD); if (a + BL > cx + LIM) break; ivs.push([a, a + BL, true]); }
  const mid = (WX + 2 * GAP - 3 * RD) / 4;
  for (let n = 0; n < 4; n++) { const a = -GAP + n * (mid + RD); ivs.push([a, a + mid, false]); }
  for (const ix of ivs) for (const iz of ivs) {
    if (!ix[2] && !iz[2]) continue;                               // the map itself
    const bx0 = ix[0], bx1 = ix[1], bz0 = iz[0], bz1 = iz[1];
    const mx = (bx0 + bx1) / 2, mz = (bz0 + bz1) / 2;
    const dx = Math.max(0, Math.abs(mx - cx) - WX / 2), dz = Math.max(0, Math.abs(mz - cz) - WZ / 2);
    const dist = Math.hypot(dx, dz);                              // distance from the map edge
    if (Math.hypot(mx - cx, mz - cz) > LIM) continue;
    // pavement slab under the block
    pushBox(P, Nn, I, IDX, bx0, gy - 0.5, bz0, bx1, gy + 0.15, bz1, rnd(), 1, 0);
    if (rnd() < 0.07 && dist > 60) continue;                      // an empty lot now and then
    // split the block into 1..4 buildings
    const nx = rnd() < 0.55 ? 2 : 1, nz = rnd() < 0.55 ? 2 : 1;
    const sx = bx0 + 3 + (bx1 - bx0 - 6) * (nx === 2 ? rnd.range(0.38, 0.62) : 1), sz = bz0 + 3 + (bz1 - bz0 - 6) * (nz === 2 ? rnd.range(0.38, 0.62) : 1);
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
      let x0 = a === 0 ? bx0 + 3 : sx + 1, x1 = a === nx - 1 && nx === 2 ? bx1 - 3 : sx - (nx === 2 ? 1 : 0);
      let z0 = b === 0 ? bz0 + 3 : sz + 1, z1 = b === nz - 1 && nz === 2 ? bz1 - 3 : sz - (nz === 2 ? 1 : 0);
      if (nx === 1) { x0 = bx0 + 3; x1 = bx1 - 3; } if (nz === 1) { z0 = bz0 + 3; z1 = bz1 - 3; }
      x0 = Math.round(x0 * 2) / 2; x1 = Math.round(x1 * 2) / 2; z0 = Math.round(z0 * 2) / 2; z1 = Math.round(z1 * 2) / 2;
      if (x1 - x0 < 6 || z1 - z0 < 6) continue;
      let storeys = rnd.int(3, 9);
      const far = Math.min(1, dist / 260);
      if (rnd() < 0.10 + 0.22 * far && dist > 40) storeys = rnd.int(14, 22 + Math.floor(26 * far));     // towers make the skyline
      else if (rnd() < 0.3) storeys = rnd.int(8, 13);
      const h = storeys * 3.5 + 0.5, sd = rnd(), lit = rnd.range(0.03, 0.15);
      pushBox(P, Nn, I, IDX, x0, gy, z0, x1, gy + h, z1, sd, 0, lit);
      if (storeys > 12 && rnd() < 0.6) {                         // a stepped crown
        const inx = (x1 - x0) * 0.22, inz = (z1 - z0) * 0.22, h2 = rnd.int(2, 5) * 3.5;
        pushBox(P, Nn, I, IDX, Math.round((x0 + inx) * 2) / 2, gy + h, Math.round((z0 + inz) * 2) / 2, Math.round((x1 - inx) * 2) / 2, gy + h + h2, Math.round((z1 - inz) * 2) / 2, sd, 0, lit);
      } else if (rnd() < 0.5) {                                   // roof plant
        const px = rnd.range(x0 + 1, x1 - 5), pz = rnd.range(z0 + 1, z1 - 5);
        pushBox(P, Nn, I, IDX, Math.round(px * 2) / 2, gy + h, Math.round(pz * 2) / 2, Math.round(px * 2) / 2 + 3, gy + h + 1.5, Math.round(pz * 2) / 2 + 3, 0.75, 0, 0);
      }
    }
  }
  // ground: a ring of four big quads around the grid (the grid supplies its own ground)
  const E = 1400, quad = (x0, z0, x1, z1) => {
    const b = P.length / 3;
    P.push(x0, gy, z1, x1, gy, z1, x1, gy, z0, x0, gy, z0);
    for (let c = 0; c < 4; c++) { Nn.push(0, 1, 0); I.push(0, 2, 0, 0); }
    IDX.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(cx - E, cz - E, cx + E, 0); quad(cx - E, WZ, cx + E, cz + E); quad(cx - E, 0, 0, WZ); quad(WX, 0, cx + E, WZ);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 4));
  geo.setIndex(IDX);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: shared.uSun, uSkyUp: shared.uSkyUp, uSkySide: shared.uSkySide, uGround: shared.uGround, uFogDensity: shared.uFogDensity },
    vertexShader: OUT_VERT, fragmentShader: OUT_FRAG, fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.name = 'kt-outskirts';
  return mesh;
}
