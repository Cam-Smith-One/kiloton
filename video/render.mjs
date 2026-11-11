// node render.mjs [from] [to] [--only f1,f2,...]   renders composited frames to work/out/%05d.png
import { createRequire } from 'node:module'; import fs from 'node:fs'; import path from 'node:path';
import { HERE, ROOT, WORK } from './lib.mjs';
const { chromium } = createRequire(path.join(ROOT, 'tools/shot.mjs'))('playwright');
const clips = {}; for (const d of fs.existsSync(WORK + '/clips') ? fs.readdirSync(WORK + '/clips') : []) clips[d] = fs.readdirSync(`${WORK}/clips/${d}`).filter(f => f.endsWith('.jpg')).length;
const a = process.argv.slice(2), only = a.includes('--only') ? a[a.indexOf('--only') + 1].split(',').map(Number) : null;
const outDir = a.includes('--out') ? WORK + '/' + a[a.indexOf('--out') + 1] : WORK + '/out'; fs.mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ args: ['--allow-file-access-from-files', '--font-render-hinting=none'] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
p.on('pageerror', e => console.log('[pageerror]', String(e))); p.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text()); });
await p.addInitScript(c => { window.CLIPS = c; }, clips);
await p.goto('file://' + HERE + '/compose.html'); await p.evaluate(() => document.fonts.ready);
const total = await p.evaluate('window.TOTAL'); const scenes = await p.evaluate('window.SCENES'); console.log('total frames', total, (total / 30).toFixed(2) + 's', JSON.stringify(await p.evaluate('window.SCENES')));
const at = a.includes('--at') ? a[a.indexOf('--at') + 1].split(',').map(x => { const [id, f] = x.split(':'); return scenes.find(s => s.id === id).start + +f; }) : null;
const num = a.filter(x => /^\d+$/.test(x)); a[0] = num[0]; a[1] = num[1];
const list = at || only || Array.from({ length: Math.min(total, +(a[1] || total)) - +(a[0] || 0) }, (_, i) => i + +(a[0] || 0));
const stage = p.locator('#stage'); const t0 = Date.now();
for (const f of list) { await p.evaluate(f => window.renderFrame(f), f); await p.screenshot({ path: `${outDir}/${String(f).padStart(5, '0')}.png`, clip: { x: 0, y: 0, width: 1280, height: 720 } }); if (f % 150 === 0) console.log(f, ((Date.now() - t0) / 1000).toFixed(0) + 's'); }
await b.close();
