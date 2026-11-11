// Usage: node tools/shot.mjs <dist/file.html> <out.png> [--q "a=1&b=2"] [--wait 4000] [--w 1280] [--h 720]
//        [--eval "js run in page before the shot"] [--keys "KeyW,Space"] [--click]
// Prints console errors and window.__KT_STATS (if any). Software GL: expect low fps; judge looks, not speed.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import path from 'node:path';
const a = process.argv.slice(2);
const opt = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
const file = path.resolve(a[0]), out = a[1];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: +opt('w', 1280), height: +opt('h', 720) }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`[${m.type()}] ${m.text().slice(0, 400)}`); else if (a.includes('--log')) console.log('[log]', m.text().slice(0, 300)); });
p.on('pageerror', e => errs.push('[pageerror] ' + String(e.stack || e).slice(0, 800)));
p.setDefaultTimeout(300000);
await p.goto('file://' + file + (opt('q') ? '?' + opt('q') : ''));
if (a.includes('--click')) await p.mouse.click(640, 360);
const keys = opt('keys'); if (keys) for (const k of keys.split(',')) await p.keyboard.down(k);
await p.waitForTimeout(+opt('wait', 4000));
const ev = opt('eval'); if (ev) { try { console.log('eval ->', JSON.stringify(await p.evaluate(ev))); } catch (e) { errs.push('[eval] ' + e.message); } await p.waitForTimeout(+opt('wait2', 600)); }
await p.screenshot({ path: out, timeout: +opt('shotTimeout', 300000) });
try { console.log('stats', JSON.stringify(await p.evaluate('window.__KT_STATS||null'))); } catch {}
console.log(errs.length ? errs.slice(0, 25).join('\n') : 'no console errors');
await b.close();
