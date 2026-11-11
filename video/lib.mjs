// Shared capture helpers for the KILOTON explainer video.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const WORK = path.join(HERE, 'work');
const { chromium } = createRequire(path.join(ROOT, 'tools/shot.mjs'))('playwright');
export const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--allow-file-access-from-files'];
export async function launch() { return chromium.launch({ args: ARGS }); }

// Opens the game, waits for it to be playing, freezes real time and installs a camera hook (window.__cam = [x,y,z,tx,ty,tz] or null).
export async function openGame(browser, query, { w = 1280, h = 720, log = false } = {}) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  p.setDefaultTimeout(600000);
  p.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)));
  if (log) p.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)); });
  await p.addInitScript(() => {
    // Manual frame pump: the game's requestAnimationFrame callbacks only run when __pump() is called (or on a slow timer while loading).
    window.__rafQ = []; window.__auto = true; let id = 0;
    window.requestAnimationFrame = (cb) => { window.__rafQ.push(cb); return ++id; };
    window.__pump = () => { const q = window.__rafQ; window.__rafQ = []; const now = performance.now(); for (const cb of q) { try { cb(now); } catch (e) { console.error(e); } } };
    setInterval(() => { if (window.__auto) window.__pump(); }, 100);
  });
  await p.goto('file://' + path.join(ROOT, 'dist/index.html') + '?' + query);
  await p.waitForFunction('window.KT && window.__KT_STATS && (KT.state.phase === "playing" || KT.state.phase === "title")');
  await p.evaluate(() => {
    window.__auto = false; const G = window.KT; G.timeScale = 0;
    const set = () => { const c = window.__cam; if (c) { G.camera.position.set(c[0], c[1], c[2]); G.camera.lookAt(c[3], c[4], c[5]); if (c[6]) { G.camera.fov = c[6]; G.camera.updateProjectionMatrix(); } } };
    const ru = G.render.update, rr = G.render.render;
    if (ru) G.render.update = function (dt) { set(); return ru.call(this, dt); };
    G.render.render = function (dt) { set(); return rr.call(this, dt); };
    window.__raf = async () => { window.__pump(); };
  });
  return p;
}

// Capture n frames. `tick` is a function body string run in page each frame with (i, n, t) BEFORE the step; `post` after it.
const PREVIEW = +(process.env.PREVIEW || 0);
export async function capture(p, name, n, { tick = null, post = null, dt = 1 / 30, sub = 1, every = 1 } = {}) {
  if (PREVIEW) { every = PREVIEW; name = 'pv-' + name; }
  const ONLY = process.env.ONLY; if (ONLY && !ONLY.split(',').includes(name.replace('pv-', ''))) { every = 1e9; name = 'dry-' + name; }
  const dir = path.join(WORK, 'clips', name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  await p.evaluate(([tick, post]) => { window.__tick = tick ? new Function('i', 'n', 't', tick) : null; window.__post = post ? new Function('i', 'n', 't', post) : null; }, [tick, post]);
  let out = 0;
  for (let i = 0; i < n; i++) {
    const ms = await p.evaluate(async ([i, n, dt, sub, draw]) => {
      const T = performance.now();
      const G = window.KT; G.timeScale = 0;
      if (window.__tick) window.__tick(i, n, i * dt);
      G.debugStep(sub, dt / sub);
      if (window.__post) window.__post(i, n, i * dt);
      if (draw) { await window.__raf(); KT.renderer.getContext().finish(); } return performance.now() - T;
    }, [i, n, dt, sub, i % every === 0 && every < 1e9]);
    if (i % every === 0 && every < 1e9) { await p.screenshot({ path: path.join(dir, String(out++).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 95 }); }
    if (i % 30 === 0) console.log(name, i + '/' + n, 'render ms', ms.toFixed(0), ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  console.log(name, 'done', out, 'frames in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  return dir;
}
export async function shot(p, file) { await p.evaluate('window.__raf()'); await p.screenshot({ path: file }); }
