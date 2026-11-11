// NET test 2: destruction replication (rocket hole, tower drop, forced checksum mismatch), down / revive, host leaving, offline.
//   node harness/net_t2.mjs
import { startRelay, startHttp, launch, lobby, openPage, step, until, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const diff = async (A, B) => (await ev(B, `KT.nt.diffChunks(${JSON.stringify(await ev(A, 'KT.nt.hashes()'))})`));
try {
  const { pages } = await lobby(br, srv, 2, 'noenemy=1', 'noenemy=1');
  const [H, C] = pages;
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 20);
  // fire is on (the host decides what burns); NOFIRE=1 switches it off
  if (process.env.NOFIRE) for (const p of pages) await ev(p, 'KT.destruct.FTUNE.cap = 0');
  const s0 = [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')];
  check('same city at start', s0[0] === s0[1] && (await diff(H, C)).length === 0, { solid: s0 });
  // --- one launcher rocket from the client into a wall ---
  const wall = await ev(C, `(() => { const e = KT.state.player.ent, g = KT.grid; let best = null; for (let a = 0; a < 16; a++) { const dx = Math.sin(a * 0.3927), dz = Math.cos(a * 0.3927); const r = g.raycast(e.pos.x, e.pos.y + 4, e.pos.z, dx, 0, dz, 80); if (r.hit && r.dist > 8 && (!best || r.dist < best.d)) best = { d: r.dist, x: r.x, y: r.y, z: r.z }; } return best; })()`);
  await ev(C, `KT.nt.fireAt('launcher', ${wall.x}, ${wall.y}, ${wall.z})`);
  await step(pages, 90);
  const s1 = [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')], d1 = await diff(H, C);
  check('client rocket carved on both', s0[0] - s1[0] > 20 && s0[1] - s1[1] > 20, { removedHost: s0[0] - s1[0], removedClient: s0[1] - s1[1], wallDist: +wall.d.toFixed(1) });
  check('same hole (voxel count + chunk hashes)', s1[0] === s1[1] && d1.length === 0, { solidHost: s1[0], solidClient: s1[1], differingChunks: d1.length });
  // host rocket too
  await ev(H, `KT.nt.fireAt('launcher', ${wall.x + 1.5}, ${wall.y + 2}, ${wall.z})`);
  await step(pages, 90);
  const s1b = [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')];
  check('host rocket: same hole', s1b[0] === s1b[1] && s1b[0] < s1[0] && (await diff(H, C)).length === 0, { removed: s1[0] - s1b[0], solid: s1b });
  // --- forced checksum mismatch on the client heals ---
  const ch = await ev(C, `(() => { const g = KT.grid; let n = 0; for (let i = 100; i < 110; i++) for (let k = 100; k < 110; k++) for (let j = 4; j < 9; j++) if (g.set(i, j, k, 9)) n++; return { n, c: (100 >> 5) + KT.CX * ((100 >> 5) + KT.CZ * 0) }; })()`);
  const dm = await diff(H, C), healed0 = (await ev(C, 'KT.nt.info()')).stats.healed;
  const frames = await until(pages, async () => (await diff(H, C)).length === 0, 900);
  const cs = (await ev(C, 'KT.nt.info()')).stats;
  check('forced mismatch heals', dm.length >= 1 && frames >= 0, { voxelsCorrupted: ch.n, chunksDiffBefore: dm.length, framesToHeal: frames, seconds: +(frames / 30).toFixed(1), chunksHealed: cs.healed - healed0, healedVoxels: cs.healedVoxels, bytes: cs.healBytes });
  // --- tower dropped by the client ---
  const b = await ev(C, `(() => { const b = KT.city.buildings.filter(q => q.alive !== false).sort((p, q) => (q.j1 - q.j0) - (p.j1 - p.j0))[0]; return { id: b.id, name: b.name, i0: b.i0, i1: b.i1, k0: b.k0, k1: b.k1, j0: b.j0, j1: b.j1, vox: b.voxels }; })()`);
  const cnt = `(() => { const g = KT.grid.data, NX = KT.NX, NZ = KT.NZ; let n = 0; for (let j = ${b.j0 + 16}; j <= ${b.j1}; j++) for (let k = ${b.k0}; k <= ${b.k1}; k++) for (let i = ${b.i0}; i <= ${b.i1}; i++) if (g[i + NX * (k + NZ * j)]) n++; return n; })()`;
  const up0 = [await ev(H, cnt), await ev(C, cnt)];
  await ev(C, `(() => { const VS = KT.VS, x0 = ${b.i0} * VS, x1 = (${b.i1} + 1) * VS, z0 = ${b.k0} * VS, z1 = (${b.k1} + 1) * VS, e = KT.state.player.ent; for (let lv = 0; lv < 2; lv++) for (let x = x0 + 2; x < x1; x += 4.5) for (let z = z0 + 2; z < z1; z += 4.5) KT.boom(x, ${b.j0} * VS + 2 + lv * 3.5, z, { radius: 4.2, power: 250, damage: 0, owner: e, kind: 'shell' }); })()`);
  await step(pages, 30);
  const opsOut = (await ev(C, 'KT.nt.info()')).stats.opsOut, opsIn = (await ev(H, 'KT.nt.info()')).stats.opsIn;
  await step(pages, 420, 1 / 30, 3);
  const up1 = [await ev(H, cnt), await ev(C, cnt)], dAfter = await diff(H, C);
  check('tower comes down on both', up1[0] < up0[0] * 0.5 && up1[1] < up0[1] * 0.5, { building: b.name, upperVoxelsBefore: up0, after14s: up1, ops: [opsOut, opsIn], differingChunksAt14s: dAfter.length });
  const f2 = await until(pages, async () => (await diff(H, C)).length === 0, 1500);
  const cs2 = (await ev(C, 'KT.nt.info()')).stats, sEnd = [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')];
  check('world converges after the collapse', f2 >= 0 && sEnd[0] === sEnd[1], { extraSeconds: +(f2 / 30).toFixed(1), chunksHealedTotal: cs2.healed, healKB: +(cs2.healBytes / 1024).toFixed(1), solid: sEnd });
  // --- down and revive ---
  await ev(C, 'KT.nt.moveTo(80, 150); 0'); await ev(H, 'KT.nt.moveTo(82, 150); 0'); await step(pages, 20);
  await ev(C, 'KT.ents.damage(KT.state.player.pilot, 1e5, { type: "bullet" }); 0'); await step(pages, 20);
  const dn = { c: await ev(C, 'KT.nt.me()'), hp: (await ev(H, 'KT.nt.peers()'))[0], phC: (await ev(C, 'KT.nt.info()')).phase, spec: await ev(C, '!!KT.state.player.spectating') };
  check('client down, seen by host, run continues', dn.c.down && dn.hp.down && dn.phC === 'playing' && dn.spec, { clientMode: dn.c.mode, puppetDown: dn.hp.down, phase: dn.phC, spectating: dn.spec });
  await ev(H, 'KT.input.keys.add("KeyE"); 0');
  const fr = await until(pages, async () => !(await ev(C, 'KT.nt.me()')).down, 240);
  await ev(H, 'KT.input.keys.delete("KeyE"); 0'); await step(pages, 10);
  const rv = { c: await ev(C, 'KT.nt.me()'), hp: (await ev(H, 'KT.nt.peers()'))[0] };
  check('revived by holding E for 4 s', fr >= 0 && !rv.c.down && !rv.hp.down && rv.c.hp > 0, { seconds: +(fr / 30).toFixed(1), clientHp: rv.c.hp, puppetDownOnHost: rv.hp.down });
  // everyone down -> run over on both
  await ev(C, 'KT.ents.damage(KT.state.player.pilot, 1e5, { type: "bullet", fromNet: true }); 0'); await ev(C, 'KT.state.player.pilot.invuln = false; KT.ents.damage(KT.state.player.pilot, 1e5, { type: "bullet" }); 0');
  await ev(H, 'KT.state.player.pilot.invuln = false; KT.ents.damage(KT.state.player.pilot, 1e5, { type: "bullet" }); 0');
  await step(pages, 45);
  const ov = [(await ev(H, 'KT.nt.info()')).phase, (await ev(C, 'KT.nt.info()')).phase];
  check('all down ends the run for both', ov[0] === 'over' && ov[1] === 'over', ov);
  // host restarts -> both play again
  await ev(H, 'KT.bus.emit("ui:restart"); 0'); await step(pages, 30);
  const rs = [(await ev(H, 'KT.nt.info()')), (await ev(C, 'KT.nt.info()'))];
  check('host restart restarts both', rs[0].phase === 'playing' && rs[1].phase === 'playing' && rs[1].t < 3 && (await ev(H, 'KT.nt.peers()'))[0].seen, { phases: [rs[0].phase, rs[1].phase], clientTime: rs[1].t, solid: [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')] });
  const errs = errors(pages); check('no console errors', errs.length === 0, errs.length);
  // --- host leaves ---
  await H.close(); await sleep(600); await step([C], 10);
  const ce = await ev(C, '({ i: KT.nt.info(), tap: KT.destruct.tap, puppet: KT.enemy.puppetMode, peers: KT.net.peers.size, online: KT.net.online, log: KT.nt.log.slice(-5) })');
  check('host leaving ends the game cleanly on the client', !ce.online && ce.i.phase === 'title' && ce.tap == null && !ce.puppet && ce.peers === 0 && C.errs.length === 0, { status: ce.i.status, err: ce.i.err, phase: ce.i.phase, log: ce.log });
  // the ex-client can play offline afterwards
  await ev(C, 'KT.bus.emit("ui:start"); 0'); await step([C], 30);
  check('ex-client plays offline afterwards', (await ev(C, 'KT.nt.info()')).phase === 'playing' && C.errs.length === 0);
  // --- offline page: nothing network-related runs ---
  const O = await openPage(br, srv, 'manual=1&q=low&base=render,fx,audio,ui&auto=1', 'offline');
  await ev(O, 'KT.nt.step(400)');
  const oi = await ev(O, '({ i: KT.nt.info(), tap: KT.destruct.tap, puppet: KT.enemy.puppetMode, units: KT.enemy.list.length, players: KT.ents.players().length, wrapped: KT.player.update.name })');
  check('offline unchanged', oi.i.status === 'offline' && oi.i.stats.bytesOut === 0 && oi.i.stats.msgsOut === 0 && oi.tap == null && !oi.puppet && oi.i.wave.n >= 1 && oi.units > 0 && oi.players === 1 && O.errs.length === 0, { wave: oi.i.wave.n, units: oi.units, bytesOut: oi.i.stats.bytesOut, updateFn: oi.wrapped });
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
