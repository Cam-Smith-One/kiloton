import { launch, openGame, shot, WORK } from './lib.mjs';
import fs from 'node:fs';
const b = await launch();
const p = await openGame(b, 'auto=1&q=med&god=1&noenemy=1', { log: true });
const info = await p.evaluate(() => { const G = KT, c = G.city;
  return { dims: [G.NX, G.NY, G.NZ, G.VS, G.GROUND_Y, G.WX, G.WY, G.WZ], pilot: (e => e && [e.x, e.y, e.z])(G.state.player.ent || G.player.ent),
    b: c.buildings.map(b => [b.id, b.kind, b.name, b.i0 / 2, b.k0 / 2, b.i1 / 2, b.k1 / 2, b.j1 / 2, b.voxels].join(' ')),
    plaza: JSON.stringify(c.plaza, (k, v) => typeof v === 'object' && v && k && !Array.isArray(v) && Object.keys(v).length > 12 ? '[obj]' : v).slice(0, 600), tankers: c.tankers.map(t => [t.x, t.z, t.yaw].join(' ')), citadel: c.citadel && (c.citadel.id ?? c.citadel), sites: JSON.stringify(c.sites).slice(0, 500), spawns: JSON.stringify(c.spawns).slice(0, 700),
    streets: JSON.stringify(c.streets).slice(0, 600), dbg: Object.keys(G.player.debug), bay: JSON.stringify(G.state.bay).slice(0, 400), rigs: Object.keys(G.rigs), load: JSON.stringify(G.rigs.loadouts || G.state.loadouts || null).slice(0, 800) }; });
fs.writeFileSync(WORK + '/scout.json', JSON.stringify(info, null, 1));
await p.evaluate(() => { KT.uiRoot.style.display = 'none'; });
const cams = { aerial1: [-30, 95, -30, 96, 5, 96], aerial2: [230, 80, 96, 96, 10, 96], aerial3: [96, 60, 230, 96, 15, 96], top: [96, 260, 97, 96, 0, 96] };
for (const [k, c] of Object.entries(cams)) { await p.evaluate(c => { window.__cam = c; }, c); await shot(p, `${WORK}/scout-${k}.png`); }
await b.close();
