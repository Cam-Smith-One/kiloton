import { launch, openGame, capture, shot, WORK } from './lib.mjs';
const q = process.argv[2] || 'auto=1&q=low&god=1&noenemy=1';
const b = await launch(); const t0 = Date.now();
const p = await openGame(b, q, { log: true });
console.log('loaded', Date.now() - t0);
const info = await p.evaluate(() => { const G = KT, c = G.city; const pl = G.state.player;
  return { keys: Object.keys(G), city: Object.keys(c), nb: c.buildings.length, b0: Object.fromEntries(Object.entries(c.buildings[0]).filter(([k, v]) => typeof v !== 'object')),
    player: { x: pl.x, y: pl.y, z: pl.z }, pkeys: Object.keys(pl), gas: c.gasMains.map(g => g.length + ':' + JSON.stringify(g[0]) + JSON.stringify(g[g.length - 1])).slice(0, 6),
    grid: Object.keys(G.grid).slice(0, 40), ui: G.uiRoot.innerHTML.length, tips: [...G.uiRoot.querySelectorAll('*')].filter(e => /tip/i.test(e.className + e.id)).map(e => e.tagName + '.' + e.className + '#' + e.id).slice(0, 20) }; });
console.log(JSON.stringify(info));
await shot(p, WORK + '/probe0.png');
const t1 = Date.now(); await capture(p, 'probe', 10); console.log('10 frames ms', Date.now() - t1);
await b.close();
