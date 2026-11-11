// ENEMY test runner (patient version of tools/shot.mjs for a loaded machine).
// node harness/enemy_run.mjs <html> <out.png|-> "<query>" "<js eval>" [settleMs]
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [file, out, q, ev, settle] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
p.on('pageerror', e => errs.push('[pageerror] ' + String(e.stack || e).slice(0, 600)));
await p.goto('file://' + path.resolve(file) + (q ? '?' + q : ''));
const t0 = Date.now();
await p.waitForFunction('window.KT && window.KT.debugStep && window.KT.state.phase === "playing"', null, { timeout: 240000 });
console.log('ready after', Date.now() - t0, 'ms');
if (ev) { try { console.log('eval ->', JSON.stringify(await p.evaluate(ev))); } catch (e) { errs.push('[eval] ' + e.message); } }
await p.waitForTimeout(+(settle || 1500));
if (out && out !== '-') { try { await p.screenshot({ path: out, timeout: 180000 }); } catch (e) { errs.push('[shot] ' + e.message.slice(0, 100)); } }
try { console.log('stats', JSON.stringify(await p.evaluate('window.__KT_STATS||null'))); } catch {}
console.log(errs.length ? [...new Set(errs)].slice(0, 20).join('\n') : 'no console errors');
await b.close();
