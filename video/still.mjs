// node still.mjs <query> <setup js> <out prefix> <cam;cam;...> [ui]   scouting stills (cam = x,y,z,tx,ty,tz[,fov] or "game")
import { launch, openGame, shot, WORK } from './lib.mjs';
const [q, js, out, cams, ui] = process.argv.slice(2);
const b = await launch(); const p = await openGame(b, q, { log: true });
if (!ui) await p.evaluate(() => { KT.uiRoot.style.display = 'none'; });
if (js) console.log(JSON.stringify(await p.evaluate(js)));
let k = 0; for (const c of cams.split(';')) { if (c[0] === 's') { console.log(c, JSON.stringify(await p.evaluate(n => { KT.debugStep(n, 1 / 30); return [KT.time, window.__probe ? window.__probe() : null]; }, +c.slice(1)))); continue; } await p.evaluate(c => { window.__cam = c === 'game' ? null : c.split(',').map(Number); KT.debugStep(1, 1 / 30); }, c); await shot(p, `${WORK}/${out}-${k++}.png`); }
await b.close();
