// Shared plumbing for the NET tests: local relay, static file server, headless pages stepped in lockstep.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export async function startRelay() {
  const p = spawn(path.join(ROOT, 'node_modules/.bin/bun'), ['run', 'server/server.ts'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let up = false; p.stdout.on('data', d => { if (String(d).includes('relay')) up = true; }); p.stderr.on('data', d => { if (process.env.RELAY_LOG) console.log('[relay]', String(d)); });
  for (let i = 0; i < 100 && !up; i++) await sleep(100);
  if (!up) throw new Error('relay did not start (port 8080 busy?)');
  return p;
}
export function startHttp() {
  return new Promise((res) => {
    const s = http.createServer((q, r) => {
      const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': 'text/html' }); r.end(d); } });
    }).listen(0, '127.0.0.1', () => res(s));
  });
}
export async function launch() {
  return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-background-timer-throttling'] });
}
export async function openPage(browser, httpSrv, query, tag, size) {
  const ctx = await browser.newContext({ viewport: size || { width: 640, height: 360 }, deviceScaleFactor: 1 });   // own context = own window, so no page is a throttled background tab
  const p = await ctx.newPage();
  p.errs = [];
  p.on('console', m => { if (m.type() === 'error') p.errs.push(`[${tag}] ${m.text().slice(0, 300)}`); });
  p.on('pageerror', e => p.errs.push(`[${tag}] pageerror ` + String(e.stack || e).slice(0, 600)));
  p.setDefaultTimeout(600000);
  await p.goto(`http://127.0.0.1:${httpSrv.address().port}/dist/h-net.html?relay=ws://127.0.0.1:8080/ws&${query}`);
  await p.waitForFunction('window.KT && KT.nt', null, { timeout: 600000, polling: 200 });
  p.tag = tag;
  return p;
}
export const ev = (p, js) => p.evaluate(js);
// advance every page n frames of dt, interleaved so messages cross between frames
export async function step(pages, n = 1, dt = 1 / 30, gap = 6) {
  for (let i = 0; i < n; i++) { for (const p of pages) await p.evaluate(`KT.nt.step(1, ${dt})`); if (gap) await sleep(gap); }
}
export async function until(pages, cond, max = 600, dt = 1 / 30) {
  for (let i = 0; i < max; i++) { if (await cond()) return i; await step(pages, 1, dt); }
  return -1;
}
// host + (n-1) clients in the lobby, manual stepping
export async function lobby(browser, httpSrv, n, hostQ = '', clientQ = '', size) {
  const common = 'manual=1&q=low&' + (process.env.BASE != null ? 'base=' + process.env.BASE : 'base=render,fx,audio,ui');
  const host = await openPage(browser, httpSrv, `${common}&net=host&name=Ava&${hostQ}`, 'host', size);
  await host.waitForFunction('KT.net.room', null, { timeout: 60000, polling: 100 });
  const code = await ev(host, 'KT.net.room');
  const pages = [host];
  for (let i = 1; i < n; i++) { const c = await openPage(browser, httpSrv, `${common}&net=join&code=${code}&name=${['Ben', 'Cy', 'Dee'][i - 1]}&${clientQ}`, 'c' + i, size); await c.waitForFunction('KT.net.status === "lobby"', null, { timeout: 60000, polling: 100 }); pages.push(c); }
  await step(pages, 4);
  return { pages, code };
}
export const R = { pass: 0, fail: 0, rows: [] };
export function check(name, ok, detail) { R[ok ? 'pass' : 'fail']++; R.rows.push([ok ? 'PASS' : 'FAIL', name, detail]); console.log(ok ? 'PASS' : 'FAIL', name, detail == null ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)); }
export function errors(pages) { const all = pages.flatMap(p => p.errs); if (all.length) console.log('console errors:\n' + all.slice(0, 20).join('\n')); return all; }
