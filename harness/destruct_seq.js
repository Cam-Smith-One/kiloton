// Screenshot sequence in one page load:  node harness/destruct_seq.js "<query>" <prefix> t1,t2,t3...   (cumulative game seconds to fast-forward before each shot)
import { createRequire } from 'node:module';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)('playwright');
const [q, prefix, ts, w = '1280', h = '720'] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const p = await b.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
p.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 600)));
await p.goto('file://' + path.resolve('dist/h-destruct.html') + '?' + q);
await p.waitForFunction('window.KT && KT.demoRun && KT.state.phase === "playing"', null, { timeout: 120000 });
await p.evaluate('KT.timeScale = 0'); const t00 = await p.evaluate('KT.time');
let prev = 0;
for (const t of ts.split(',').map(Number)) {
  const r = await p.evaluate(`(() => { const r = KT.demoRun(${t - prev}); return { t: r.t, bodies: r.bodies, bits: r.bits, pending: r.pending, avgMs: r.avgMs, maxMs: r.maxMs, dmg: r.dmg, levelled: r.levelled, grab: r.grab, punch: r.punch, fires: r.fires, jets: r.jets, events: r.events }; })()`);
  prev = t;
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `${prefix}-${t}.png`, timeout: 120000 });
  console.log(JSON.stringify(r).slice(0, 700));
}
console.log(errs.length ? errs.join('\n') : 'no console errors');
await b.close();
