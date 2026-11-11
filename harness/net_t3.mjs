// NET test 3: four players, a real wave, rigs, bandwidth at 10 / 25 / 40 enemies, CPU cost.
//   node harness/net_t3.mjs
import { startRelay, startHttp, launch, lobby, step, until, ev, check, errors, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const NP = +(process.env.PLAYERS || 4);
try {
  const { pages } = await lobby(br, srv, NP, 'god=1', 'god=1');
  const [H, C] = pages;
  check('lobby of ' + NP, (await ev(H, 'KT.net.peers.size')) === NP - 1 && (await ev(pages[NP - 1], 'KT.net.peers.size')) === NP - 1, await ev(H, 'KT.nt.peers().map(p => p.name)'));
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 30);
  const pos = []; for (const p of pages) pos.push(await ev(p, 'KT.nt.me()'));
  let minD = 1e9; for (let a = 0; a < NP; a++) for (let b = a + 1; b < NP; b++) minD = Math.min(minD, Math.hypot(pos[a].x - pos[b].x, pos[a].z - pos[b].z));
  check('spawns fanned out', minD > 1, +minD.toFixed(2));
  let ok = true, worst = 0;
  for (let a = 0; a < NP; a++) { const seen = await ev(pages[a], 'KT.nt.peers()'); if (seen.length !== NP - 1 || seen.some(s => !s.seen || !s.inScene)) ok = false; for (const s of seen) { const real = pos[s.id - 1]; worst = Math.max(worst, Math.hypot(real.x - s.x, real.z - s.z)); } }
  check('everyone sees everyone', ok && worst < 0.2, { worstErr: +worst.toFixed(3) });
  // --- first wave by the real director, scaled for the player count ---
  const f = await until(pages, async () => (await ev(H, 'KT.state.wave.n')) >= 1 && (await ev(H, 'KT.enemy.list.length')) >= 3, 900);
  await step(pages, 30);
  const hw = await ev(H, 'KT.nt.info()'), cw = await ev(C, 'KT.nt.info()');
  const he = await ev(H, 'KT.nt.enemies()'), ce = await ev(pages[NP - 1], 'KT.nt.enemies()');
  check('wave state replicated', f >= 0 && cw.wave.n === hw.wave.n && cw.wave.total === hw.wave.total && Math.abs(cw.wave.alive - hw.wave.alive) <= 1, { host: hw.wave, client: cw.wave, clientSawWaveStart: await ev(C, 'KT.nt.log.some(l => l[0] === "wave:start")') });
  check('wave 1 scaled for ' + NP + ' players', hw.wave.total > 5, { total: hw.wave.total, units: he.length, lastClientUnits: ce.length });
  // --- a client calls its rig in (debug hook) and boards: every peer sees the right chassis ---
  await ev(C, '(() => { KT.rigs.bay.active = 2; const e = KT.state.player.ent; KT.player.debug.spawnRig(e.pos.x + 6, e.pos.z, true, 2); })()');
  await step(pages, 60);
  const cm = await ev(C, 'KT.nt.me()'), seen = (await ev(H, 'KT.nt.peers()')).find(p => p.id === 2), seen3 = (await ev(pages[NP - 1], 'KT.nt.peers()')).find(p => p.id === 2);
  check('rig puppet with the owner\'s chassis', cm.mode === 'mech' && seen.kind === 'mech' && seen.chassis === 'bastion' && (NP < 3 || seen3.chassis === 'bastion') && Math.hypot(cm.x - seen.x, cm.z - seen.z) < 0.3, { owner: cm.mode, onHost: [seen.kind, seen.chassis], err: +Math.hypot(cm.x - seen.x, cm.z - seen.z).toFixed(3), hpOnHost: seen.hp, hp: cm.hp });
  // --- bandwidth and CPU at 10 / 25 / 40 enemies (everyone fighting: players fire rifles, enemies fire back) ---
  for (const n of [10, 25, 40]) {
    await ev(H, `(() => { const E = KT.enemy; E.dir.active = false; E.clearAll(); const p = KT.state.player.ent.pos; const kinds = ['rifle','rifle','rifle','rocketeer','drone','rifle','tank','rifle','drone','gunship','rifle','rocketeer','emech','rifle','rifle','drone','rifle','tank','rifle','rifle']; const L = []; for (let i = 0; i < ${n}; i++) L.push(kinds[i % kinds.length]); for (let g = 0; g < L.length; g += 5) { const a = g * 1.3; E.spawnGroup(L.slice(g, g + 5), p.x + Math.sin(a) * 38, p.z + Math.cos(a) * 38, { hp: 1e6 }); } return E.list.length; })()`);
    await step(pages, 60);
    for (const p of pages) await ev(p, 'KT.net.stats.updMax = KT.net.stats.lateMax = 0; window.__m = { o: KT.net.stats.bytesOut, i: KT.net.stats.bytesIn, t: KT.net.time, u: 0, l: 0, n: 0 }; 0');
    const SEC = 12;
    for (let s = 0; s < SEC * 30; s += 3) {
      if (s % 9 === 0) for (const p of pages) await ev(p, `(() => { const L = KT.enemy.list; if (L.length) { const e = L[(Math.random() * L.length) | 0].ent; KT.nt.fireAt('rifle', e.pos.x, e.pos.y + e.height * 0.5, e.pos.z); } })()`);
      await step(pages, 3, 1 / 30, 4);
    }
    const m = []; for (const p of pages) m.push(await ev(p, '(() => { const s = KT.net.stats, m = window.__m, dt = KT.net.time - m.t; return { out: Math.round((s.bytesOut - m.o) / dt), in: Math.round((s.bytesIn - m.i) / dt), upd: +s.updMs.toFixed(3), late: +s.lateMs.toFixed(3), updMax: +s.updMax.toFixed(1), lateMax: +s.lateMax.toFixed(1), units: KT.enemy.list.length, dt: +dt.toFixed(1) }; })()'));
    check(`bandwidth at ${n} enemies (${NP} players)`, m[1].in < 40 * 1024, { units: m[0].units, hostOutBps: m[0].out, hostInBps: m[0].in, clientInBps: m[1].in, clientOutBps: m[1].out, hostCpuMs: [m[0].upd, m[0].late], hostMaxMs: [m[0].updMax, m[0].lateMax], clientCpuMs: [m[1].upd, m[1].late], clientMaxMs: [m[1].updMax, m[1].lateMax] });
  }
  const he2 = await ev(H, 'KT.nt.enemies()'), ce2 = await ev(C, 'KT.nt.enemies()');
  let miss = 0, maxErr = 0, sum = 0, nn = 0; for (const a of he2) { const b = ce2.find(q => q.id === a.id); if (!b) { miss++; continue; } const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z); maxErr = Math.max(maxErr, d); sum += d; nn++; }
  check('40-unit fight: same set, positions within tolerance', miss <= 1 && Math.abs(he2.length - ce2.length) <= 1 && maxErr < 6, { host: he2.length, client: ce2.length, missing: miss, meanErr: +(sum / Math.max(1, nn)).toFixed(2), maxErr: +maxErr.toFixed(2) });
  console.log('host stats', JSON.stringify((await ev(H, 'KT.nt.info()')).stats));
  console.log('client stats', JSON.stringify((await ev(C, 'KT.nt.info()')).stats));
  // one client leaves: the others carry on
  if (NP > 2) { await pages[NP - 1].close(); await step(pages.slice(0, NP - 1), 20, 1 / 30, 20); check('a client leaving is clean', (await ev(H, 'KT.net.peers.size')) === NP - 2 && (await ev(C, 'KT.net.peers.size')) === NP - 2 && (await ev(H, 'KT.nt.info()')).phase === 'playing', await ev(H, 'KT.nt.log.slice(-3)')); pages.pop(); }
  const errs = errors(pages); check('no console errors', errs.length === 0, errs.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
