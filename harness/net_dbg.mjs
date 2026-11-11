// NET debug: why does a healed chunk not stay healed? Dumps the differing voxels host vs client over time.
import { startRelay, startHttp, launch, lobby, step, ev, sleep } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const diff = async (A, B) => (await ev(B, `KT.nt.diffChunks(${JSON.stringify(await ev(A, 'KT.nt.hashes()'))})`));
const dump = (c) => `(() => { const c = ${c}, ci = c % KT.CX, ck = ((c / KT.CX) | 0) % KT.CZ, cj = (c / (KT.CX * KT.CZ)) | 0, d = KT.grid.data, out = []; for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) for (let i = ci * 32; i < ci * 32 + 32; i++) out.push(d[i + KT.NX * (k + KT.NZ * j)]); return { o: [ci * 32, cj * 32, ck * 32], d: out }; })()`;
try {
  const { pages } = await lobby(br, srv, 2, 'noenemy=1', 'noenemy=1');
  const [H, C] = pages;
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 20);
  for (const p of pages) await ev(p, 'KT.destruct.FTUNE.cap = 0');
  await ev(C, `(() => { const b = KT.city.buildings.filter(q => q.alive !== false).sort((p, q) => (q.j1 - q.j0) - (p.j1 - p.j0))[0]; const VS = KT.VS, x0 = b.i0 * VS, x1 = (b.i1 + 1) * VS, z0 = b.k0 * VS, z1 = (b.k1 + 1) * VS, e = KT.state.player.ent; for (let lv = 0; lv < 2; lv++) for (let x = x0 + 2; x < x1; x += 4.5) for (let z = z0 + 2; z < z1; z += 4.5) KT.boom(x, b.j0 * VS + 2 + lv * 3.5, z, { radius: 4.2, power: 250, damage: 0, owner: e, kind: 'shell' }); })()`);
  await step(pages, 420, 1 / 30, 2);
  for (let r = 0; r < 30; r++) {
    await step(pages, 60, 1 / 30, 2);
    const d = await diff(H, C); const st = (await ev(C, 'KT.nt.info()')).stats;
    console.log('t+' + (r + 1) + 's diff', JSON.stringify(d), 'healed', st.healed, 'reqs', st.chunkReqs, 'bodies', JSON.stringify(await ev(C, 'KT.destruct.stats')).slice(0, 200));
    for (const c of d.slice(0, 2)) {
      const a = await ev(H, dump(c)), b = await ev(C, dump(c)); const out = [];
      for (let q = 0; q < a.d.length && out.length < 8; q++) if (a.d[q] !== b.d[q]) { const i = q % 32, k = ((q / 32) | 0) % 32, j = (q / 1024) | 0; out.push([a.o[0] + i, a.o[1] + j, a.o[2] + k, 'host', a.d[q], 'client', b.d[q]]); }
      console.log('  chunk', c, JSON.stringify(out));
    }
  }
  console.log(JSON.stringify(await ev(C, 'KT.nt.log.slice(-20)')));
} catch (e) { console.log('ERR', e); }
await br.close(); srv.close(); relay.kill(); process.exit(0);
