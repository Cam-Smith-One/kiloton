// ============================================================================
// KILOTON — boot.js   OWNER: lead. Other modules must not edit this file.
// Creates the renderer, installs modules, runs the frame loop and the phase
// machine (title -> playing <-> paused -> over -> restart).
//   boot({ use: { destruct: realModule, ... }, after(G) {} })
// Every module not named in `use` runs its BASELINE (src/baseline/*), so a
// harness only depends on the real modules it chooses to import.
// ============================================================================
import { G, THREE, bus, input, ents } from './core.js';
import './voxels.js';
import './rigs.js';
import './progress.js';
import bCity from './baseline/city.js';
import bRender from './baseline/render.js';
import bDestruct from './baseline/destruct.js';
import bFx from './baseline/fx.js';
import bAudio from './baseline/audio.js';
import bModels from './baseline/models.js';
import bCombat from './baseline/combat.js';
import bPlayer from './baseline/player.js';
import bEnemy from './baseline/enemy.js';
import bUi from './baseline/ui.js';
import bMission from './baseline/mission.js';
import bNet from './baseline/net.js';

// init order (dependencies first) and per-frame update order
const INIT_ORDER = ['city', 'render', 'destruct', 'fx', 'audio', 'models', 'combat', 'player', 'enemy', 'mission', 'net', 'ui'];
const UPDATE_ORDER = ['net', 'player', 'enemy', 'mission', 'combat', 'destruct', 'fx', 'audio', 'ui'];   // then render.update + render.render
const BASE = { city: bCity, render: bRender, destruct: bDestruct, fx: bFx, audio: bAudio, models: bModels, combat: bCombat, player: bPlayer, enemy: bEnemy, mission: bMission, net: bNet, ui: bUi };

function pickQuality() {
  const q = G.params.get('q') || G.state.settings.quality;
  let tier = ['low', 'med', 'high'].includes(q) ? q : null;
  let rendererName = '';
  try { const gl = G.renderer.getContext(), e = gl.getExtension('WEBGL_debug_renderer_info'); rendererName = e ? String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch (e) {}
  G.software = /swiftshader|llvmpipe|software|basic render/i.test(rendererName);
  if (!tier) tier = G.software ? 'low' : /Intel|Iris|UHD|HD Graphics|Mali|Adreno|PowerVR/i.test(rendererName) && !/Arc/i.test(rendererName) ? 'med' : 'high';
  setQuality(tier);
}
export function setQuality(tier) {
  const Q = G.quality; Q.tier = tier;
  Q.shadowRes = tier === 'high' ? 2048 : tier === 'med' ? 1536 : 1024;
  Q.post = true;
  Q.debrisMax = tier === 'high' ? 3500 : tier === 'med' ? 2200 : 1200;
  Q.particlesMax = tier === 'high' ? 12000 : tier === 'med' ? 7000 : 3500;
  Q.pixelRatio = Math.min(devicePixelRatio || 1, tier === 'high' ? 1.5 : tier === 'med' ? 1.25 : 1);
  if (G.renderer) { G.renderer.setPixelRatio(Q.pixelRatio); resize(); }
  if (G.render && G.render.setQuality) G.render.setQuality(tier);
  bus.emit('quality', tier);
}
G.setQuality = setQuality;

function resize() {
  const w = G.canvas.clientWidth || innerWidth, h = G.canvas.clientHeight || innerHeight;
  G.width = w; G.height = h;
  G.renderer.setSize(w, h, false);
  G.camera.aspect = w / h; G.camera.updateProjectionMatrix();
  bus.emit('resize', { w, h, pixelRatio: G.quality.pixelRatio });
}

const LOAD_LABEL = { city: 'Pouring concrete', render: 'Raising the skyline', destruct: 'Weakening the load paths', fx: 'Mixing dust and fire', audio: 'Tuning the sirens', models: 'Bolting the rig together', combat: 'Loading magazines', player: 'Strapping the pilot in', enemy: 'Briefing Vanta', mission: 'Marking objectives', net: 'Opening comms', ui: 'Calibrating instruments', ready: 'Ready' };
function veil(f, name) {
  const el = document.getElementById('kt-load'); if (!el) return;
  const bar = el.querySelector('i'), lab = el.querySelector('span');
  if (bar) bar.style.transform = `scaleX(${f})`; if (lab) lab.textContent = LOAD_LABEL[name] || name;
  if (name === 'ready') { el.classList.add('done'); setTimeout(() => el.remove(), 700); }
}
export async function boot(opts = {}) {
  const use = Object.assign({}, BASE, opts.use || {});
  G.canvas = document.getElementById('kt-canvas'); G.uiRoot = document.getElementById('kt-ui');
  try {
    G.renderer = new THREE.WebGLRenderer({ canvas: G.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  } catch (e) {
    G.uiRoot.innerHTML = '<div style="position:absolute;inset:0;display:grid;place-items:center;color:#e8e6df;font:16px system-ui;padding:24px;text-align:center">Kiloton needs WebGL 2. Open it in a current Chrome, Edge, Firefox or Safari with hardware acceleration on.</div>';
    return;
  }
  G.scene = new THREE.Scene();
  G.camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.15, 900);
  G.camera.position.set(96, 20, 150);
  input.init(G.canvas);
  pickQuality();
  addEventListener('resize', resize);

  for (const name of INIT_ORDER) { G[name] = use[name]; G.modules.push(use[name]); }
  let step = 0;
  for (const name of INIT_ORDER) {
    bus.emit('load', { step: step++, total: INIT_ORDER.length, label: name }); veil(step / (INIT_ORDER.length + 1), name);
    await new Promise(r => setTimeout(r, 0));             // let the loading veil paint
    const t0 = performance.now();
    await G[name].init(G);
    if (G.debug) console.log('init', name, (performance.now() - t0).toFixed(0) + 'ms');
  }
  if (!G.grid.pristine) G.grid.snapshot();
  resize();
  bus.emit('load', { step: INIT_ORDER.length, total: INIT_ORDER.length, label: 'ready' });
  veil(1, 'ready');

  // ---- phase machine --------------------------------------------------------
  const S = G.state;
  let played = false;
  const setPhase = (p) => { const from = S.phase; S.phase = p; bus.emit('phase', { phase: p, from }); };
  function start() {
    if (played) hardReset();
    played = true; setPhase('playing'); bus.emit('game:start', {});
  }
  function hardReset() {
    ents.clear(); G.grid.restore(); G.timeScale = 1; G.time = 0;
    Object.assign(S.stats, { voxelsDestroyed: 0, buildingsLevelled: 0, timeAlive: 0, mechsCalled: 0 });
    for (const name of INIT_ORDER) if (G[name].reset) G[name].reset();
  }
  bus.on('ui:start', () => { if (S.phase === 'title') start(); });
  bus.on('ui:restart', () => { start(); });
  bus.on('ui:pause', () => { if (G.net && G.net.online) return;   // co-op: the world never stops; UI shows its card as an overlay
    if (S.phase === 'playing') { setPhase('paused'); bus.emit('game:pause', {}); } });
  bus.on('ui:resume', () => { if (S.phase === 'paused') { setPhase('playing'); bus.emit('game:resume', {}); } });
  bus.on('ui:title', () => { hardReset(); played = false; setPhase('title'); });
  bus.on('player:dead', (d) => { if (S.phase === 'playing') { setPhase('over'); bus.emit('game:over', d || {}); } });   // PLAYER emits when the run ends
  bus.on('pointerlock', (locked) => { if (!locked && S.phase === 'playing' && !input.fallbackLook && !G.params.has('auto')) bus.emit('ui:pause'); });
  bus.on('key', (code) => { if (S.bay && S.bay.open) return; if (code === 'Escape' || code === 'KeyP') bus.emit(S.phase === 'playing' ? 'ui:pause' : S.phase === 'paused' ? 'ui:resume' : 'noop'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) bus.emit('ui:pause'); });

  if (opts.after) await opts.after(G);
  if (G.params.has('auto')) start();

  // ---- frame loop -----------------------------------------------------------
  let last = performance.now(), fpsT = 0, fpsN = 0, fps = 0, ms = 0;
  const camOverride = (G.params.get('cam') || '').split(',').map(Number);
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
    const paused = S.phase === 'paused';
    G.rawDt = raw;
    const dt = paused ? 0 : raw * G.timeScale * (S.phase === 'over' ? 0.35 : 1);
    G.dt = dt; G.time += dt; G.frame++;
    if (S.phase === 'playing') S.stats.timeAlive += dt;
    input.frame();
    const t0 = performance.now();
    if (!paused) { for (const name of UPDATE_ORDER) { const m = G[name]; if (m.update) m.update(dt); } }
    else { if (G.ui.update) G.ui.update(0); if (G.audio.update) G.audio.update(0); }
    if (!paused && G.net.lateUpdate) G.net.lateUpdate(dt);        // send this frame's state after everyone has moved
    if (camOverride.length === 6 && !camOverride.some(isNaN)) { G.camera.position.set(camOverride[0], camOverride[1], camOverride[2]); G.camera.lookAt(camOverride[3], camOverride[4], camOverride[5]); }
    if (G.render.update) G.render.update(dt);
    G.render.render(dt);
    ms = ms * 0.9 + (performance.now() - t0) * 0.1;
    fpsN++; fpsT += raw; if (fpsT >= 0.5) { fps = fpsN / fpsT; fpsN = 0; fpsT = 0; }
    const info = G.renderer.info;
    window.__KT_STATS = { fps: +fps.toFixed(1), cpuMs: +ms.toFixed(1), calls: info.render.calls, tris: info.render.triangles, ents: ents.list.length, phase: S.phase, t: +G.time.toFixed(1), q: G.quality.tier };
  }
  requestAnimationFrame(frame);
  // Co-op: a hidden tab gets no animation frames, which would freeze the world for everyone if it is the host.
  // While online and hidden, keep stepping the simulation (no rendering) from a worker timer, which is not throttled.
  function hiddenTick() {
    if (!document.hidden || !(G.net && G.net.online) || S.phase === 'title') return;
    const now = performance.now(), raw = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
    const dt = raw * G.timeScale * (S.phase === 'over' ? 0.35 : 1);
    G.rawDt = raw; G.dt = dt; G.time += dt; G.frame++;
    if (S.phase === 'playing') S.stats.timeAlive += dt;
    input.frame();
    for (const name of UPDATE_ORDER) { const m = G[name]; if (m.update) m.update(dt); }
    if (G.net.lateUpdate) G.net.lateUpdate(dt);
    if (G.render.update) G.render.update(dt);
  }
  try {
    const w = new Worker(URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},33)'], { type: 'text/javascript' })));
    w.onmessage = hiddenTick;
  } catch (e) { setInterval(hiddenTick, 33); }
  // Fast-forward the simulation without rendering (headless look-dev / tests).
  G.debugStep = (n = 60, dt = 1 / 60) => {
    for (let s = 0; s < n; s++) {
      G.rawDt = dt; G.dt = dt; G.time += dt; G.frame++; input.frame();
      for (const name of UPDATE_ORDER) { const m = G[name]; if (m.update) m.update(dt); }
      if (G.net.lateUpdate) G.net.lateUpdate(dt);
      if (G.render.update) G.render.update(dt);
    }
    return G.time;
  };
  window.KT = G;
  return G;
}
