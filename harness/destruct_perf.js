// DESTRUCT perf / correctness test without a browser:  node harness/destruct_perf.js [demo] [seconds]
// Uses process.threadCpuUsage() (CPU time, immune to a loaded machine) around destruct.update.
import { G, THREE, bus, VS, ents } from '../src/core.js';
import '../src/voxels.js';
import { M } from '../src/materials.js';
import destruct from '../src/destruct.js';
const demo = process.argv[2] || 'tower', secs = +(process.argv[3] || 8), tier = process.argv[4] || 'high';
const city = (await import(process.env.CITY ? '../src/city.js' : '../src/baseline/city.js')).default;
G.scene = new THREE.Scene(); G.city = city; G.destruct = destruct;
G.quality.tier = tier; G.quality.debrisMax = tier === 'high' ? 3500 : tier === 'med' ? 2200 : 1200;
await city.init(G); destruct.init(G);
const B = city.buildings; let b = B[0]; for (const q of B) if (q.j1 - q.j0 > b.j1 - b.j0) b = q;
if (process.env.B) b = B[+process.env.B];
const cx = (b.i0 + b.i1 + 1) / 2 * VS, cz = (b.k0 + b.k1 + 1) / 2 * VS, gy = b.j0 * VS;
let shooter, sold, rig;
function mkEnts() {
  shooter = ents.add({ name: 'shooter', kind: 'pilot', team: 0, pos: new THREE.Vector3(5, 2, 5), radius: 0.35, height: 1.8, hp: 1e6 });
}
function mkVictims() {
  sold = ents.add({ name: 'soldier', kind: 'soldier', team: 1, pos: new THREE.Vector3(cx, G.grid.topBelow(cx, gy + 2, cz), cz), radius: 0.35, height: 1.8, hp: 100 });
  rig = ents.add({ name: 'rig', kind: 'emech', team: 1, pos: new THREE.Vector3(cx + 4, G.grid.topBelow(cx + 4, gy + 2, cz + 3), cz + 3), radius: 1.8, height: 8.5, hp: 1800 });
}
mkEnts();
const ev = {}; for (const e of ['collapse', 'building:levelled', 'voxels:destroyed', 'debris:impact']) bus.on(e, d => { ev[e] = (ev[e] || 0) + 1; if (e !== 'voxels:destroyed' && e !== 'debris:impact') console.log(' ', G.time.toFixed(2), e, JSON.stringify(d).slice(0, 120)); });
const dmg = {}; bus.on('ent:damage', d => { const k = d.ent.name + ':' + d.info.type; dmg[k] = (dmg[k] || 0) + Math.round(d.amount); });
bus.on('ent:death', d => console.log(' ', G.time.toFixed(2), 'DEATH', d.ent.name, d.info.type, 'src', d.info.src && d.info.src.name));
const script = [];
const ring = (t, y, f, st = 3) => { for (let x = b.i0 * VS; x <= (b.i1 + 1) * VS + 0.1; x += st) for (let z = b.k0 * VS; z <= (b.k1 + 1) * VS + 0.1; z += st) if (!f || f(x, z)) script.push([t, () => G.boom(x, y, z, { radius: 4, power: 170, damage: 100, owner: shooter })]); };
if (demo === 'tower') ring(1, gy + 1.6);
else if (demo === 'corner') ring(1, gy + 1.6, (x, z) => x < cx - 1);
else if (demo === 'mid') ring(1, gy + Math.floor((b.j1 - b.j0) / 14) * 3.5 + 1.6);
else if (demo === 'siege') { let s = 12345; const r = () => (s = (s * 16807) % 2147483647) / 2147483647; for (let n = 0; n < 300; n++) script.push([1 + n * 0.06, () => { const q = B[(r() * B.length) | 0]; G.boom((q.i0 + r() * (q.i1 - q.i0)) * VS, (q.j0 + r() * Math.min(24, q.j1 - q.j0)) * VS, (q.k0 + r() * (q.k1 - q.k0)) * VS, { radius: 2.5 + r() * 2.5, power: 150, owner: shooter }); }]); }
else if (demo === 'chip') { for (let n = 0; n < 400; n++) script.push([1 + n * 0.02, () => G.destruct.impact(b.i0 * VS + 0.1, gy + 1 + (n % 5) * 0.5, cz + ((n * 7) % 40) * 0.25 - 5, 1, 0, 0, 120, 0.45)]); }
script.push([1.15, mkVictims]);
script.sort((a, c) => a[0] - c[0]);
let si = 0, ms = [], wall = [];
function run() {
const dt = 1 / 60;
for (let f = 0; f < secs * 60; f++) {
  G.time += dt; G.dt = dt; G.frame++;
  const c0 = process.threadCpuUsage(), w0 = performance.now();
  while (si < script.length && G.time >= script[si][0]) script[si++][1]();
  const c1 = process.threadCpuUsage(c0);
  const c2 = process.threadCpuUsage(); destruct.update(dt); const c3 = process.threadCpuUsage(c2);
  ms.push((c3.user + c3.system) / 1000); wall.push(performance.now() - w0);
  if (process.env.SPIKES && ms[ms.length - 1] > +process.env.SPIKES) console.log('  spike', G.time.toFixed(2), ms[ms.length - 1].toFixed(1), 'prof', destruct.stats.prof.map(v => v.toFixed(1)).join(' '), 'bodies', destruct.stats.bodies, 'bits', destruct.stats.debris);
  destruct.stats.prof.fill(0);
  if (G.frame % 2 === 0) G.grid.takeDirty(6);        // a renderer that remeshes 3 chunks a frame
  if (process.env.TRACE && f % 15 === 0) console.log(G.time.toFixed(2), 'bodies', destruct.stats.bodies, 'bits', destruct.stats.debris, 'pend', destruct.stats.pending, 'top', G.grid.topBelow(cx, 47, cz), 'cpu', Math.max(...ms.slice(-15)).toFixed(1));
}
}
run();
if (process.env.WARM !== '0') { console.log('--- second (warm) run ---'); ents.clear(); G.grid.restore(); G.grid.dirty.clear(); G.time = 0; destruct.reset(); Object.assign(G.state.stats, { voxelsDestroyed: 0, buildingsLevelled: 0 }); mkEnts(); si = 0; ms = []; wall = []; for (const k in dmg) delete dmg[k]; for (const k in ev) delete ev[k]; run(); }
const s = ms.slice().sort((a, c) => a - c), sum = ms.reduce((a, c) => a + c, 0);
// floaters: anything not connected to bedrock
const d = G.grid.data, NX = G.NX, NZ = G.NZ, L = NX * NZ, seen = new Uint8Array(d.length), st = [];
for (let o = L; o < 2 * L; o++) if (d[o]) { seen[o] = 1; st.push(o); }
while (st.length) { const o = st.pop(), i = o % NX; for (const dd of [1, -1, NX, -NX, L, -L]) { const q = o + dd; if (q < L || q >= d.length || seen[q] || !d[q]) continue; if ((dd === 1 && i === NX - 1) || (dd === -1 && i === 0)) continue; seen[q] = 1; st.push(q); } }
let fl = 0; const ex = []; for (let o = L; o < d.length; o++) if (d[o] && !seen[o]) { fl++; if (ex.length < 6) ex.push([o % NX, Math.floor(o / L), Math.floor(o / NX) % NZ, d[o]]); }
console.log(JSON.stringify({ demo, tier, frames: ms.length, cpuAvg: +(sum / ms.length).toFixed(3), p50: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], p99: s[Math.floor(s.length * 0.99)], max: s[s.length - 1], over4: ms.filter(v => v > 4).length, over8: ms.filter(v => v > 8).length, wallMax: +Math.max(...wall).toFixed(1),
  stats: { ...destruct.stats, prof: undefined }, ev, dmg, hp: { soldier: sold.hp, rig: Math.round(rig.hp) }, destroyed: G.state.stats.voxelsDestroyed, levelled: G.state.stats.buildingsLevelled, top: G.grid.topBelow(cx, 47, cz), floating: fl, ex }));
