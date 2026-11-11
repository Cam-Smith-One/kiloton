// NET test 1: lobby, start, puppets, enemies on both peers, kills + credit, enemy fire ownership.
//   node harness/net_t1.mjs
import { startRelay, startHttp, launch, lobby, step, until, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
try {
  const { pages, code } = await lobby(br, srv, 2, 'noenemy=1&god=0', 'noenemy=1');
  const [H, C] = pages;
  check('lobby', (await ev(H, 'KT.nt.info()')).status === 'lobby' && (await ev(C, 'KT.nt.info()')).status === 'lobby', { code, hostPeers: await ev(H, 'KT.nt.peers().map(p=>p.name)'), clientPeers: await ev(C, 'KT.nt.peers().map(p=>p.name)') });
  await ev(H, 'KT.net.start({mode:"survival"})');
  await step(pages, 20);
  const hi = await ev(H, 'KT.nt.info()'), ci = await ev(C, 'KT.nt.info()');
  check('started', hi.phase === 'playing' && ci.phase === 'playing' && ci.status === 'playing', { h: hi.phase, c: ci.phase });
  // --- puppets ---
  await ev(C, 'KT.nt.moveTo(KT.state.player.ent.pos.x + 6, KT.state.player.ent.pos.z + 3)');
  await step(pages, 30);
  const cm = await ev(C, 'KT.nt.me()'), hp = (await ev(H, 'KT.nt.peers()'))[0], hm = await ev(H, 'KT.nt.me()'), cp = (await ev(C, 'KT.nt.peers()'))[0];
  const d1 = Math.hypot(cm.x - hp.x, cm.y - hp.y, cm.z - hp.z), d2 = Math.hypot(hm.x - cp.x, hm.y - cp.y, hm.z - cp.z);
  check('puppet positions', d1 < 0.1 && d2 < 0.1 && hp.inScene && cp.inScene, { clientOnHostErr: +d1.toFixed(3), hostOnClientErr: +d2.toFixed(3), kind: hp.kind });
  check('players() count', (await ev(H, 'KT.ents.players().length')) === 2 && (await ev(C, 'KT.ents.players().length')) === 2);
  // --- enemies: host spawns, client sees puppets ---
  await ev(H, `(() => { const p = KT.state.player.ent.pos; const E = KT.enemy; E.spawn('soldier', p.x + 14, p.z + 20, {variant:'rifle'}); E.spawn('soldier', p.x - 10, p.z + 24, {variant:'rocketeer'}); E.spawn('tank', p.x + 4, p.z + 40, {}); E.spawn('drone', p.x, p.z + 30, {}); })()`);
  await step(pages, 45);
  const he = await ev(H, 'KT.nt.enemies()'), ce = await ev(C, 'KT.nt.enemies()');
  let maxErr = 0, same = he.length === ce.length;
  for (const a of he) { const b = ce.find(q => q.id === a.id); if (!b || b.v !== a.v) { same = false; continue; } maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)); }
  check('enemy set matches', same && he.length === 4 && ce.every(q => q.remote), { host: he.length, client: ce.length, maxPosErr: +maxErr.toFixed(2) });
  check('enemy positions within tolerance (moving units, 120 ms behind)', maxErr < 3, +maxErr.toFixed(2));
  // --- client kills a soldier with the rifle: claim -> host applies -> death -> credit on the client only ---
  const tgt = he.find(q => q.v === 'rifle');
  let killed = -1;
  for (let i = 0; i < 80 && killed < 0; i++) {
    await ev(C, `(() => { const u = KT.enemy.byNetId(${tgt.id}); if (u) { const e = u.ent; KT.nt.moveTo(e.pos.x + 5, e.pos.z); KT.nt.fireAt('rifle', e.pos.x, e.pos.y + 1.0, e.pos.z); } })()`);
    await step(pages, 3);
    if (!(await ev(H, 'KT.nt.enemies()')).some(q => q.id === tgt.id)) killed = i;
  }
  await step(pages, 20);
  const ck = await ev(C, 'KT.nt.me()'), hk = await ev(H, 'KT.nt.me()'), cst = (await ev(C, 'KT.nt.info()')).stats, hst = (await ev(H, 'KT.nt.info()')).stats;
  check('client kills enemy via claims', killed >= 0 && !(await ev(C, 'KT.nt.enemies()')).some(q => q.id === tgt.id), { shots: killed + 1, claimsOut: cst.claimsOut, claimsInHost: hst.claimsIn });
  check('kill credited to client only', ck.kills === 1 && hk.kills === 0 && ck.score > 0 && hk.score === 0, { clientKills: ck.kills, clientScore: ck.score, hostKills: hk.kills, hostScore: hk.score });
  // --- host kills the rocketeer: credited to host only ---
  const t2 = he.find(q => q.v === 'rocketeer');
  for (let i = 0; i < 80; i++) {
    await ev(H, `(() => { const u = KT.enemy.byNetId(${t2.id}); if (u) { const e = u.ent; KT.nt.moveTo(e.pos.x + 5, e.pos.z); KT.nt.fireAt('rifle', e.pos.x, e.pos.y + 1.0, e.pos.z); } })()`);
    await step(pages, 3);
    if (!(await ev(H, 'KT.nt.enemies()')).some(q => q.id === t2.id)) break;
  }
  await step(pages, 20);
  const ck2 = await ev(C, 'KT.nt.me()'), hk2 = await ev(H, 'KT.nt.me()');
  check('host kill credited to host only', hk2.kills === 1 && ck2.kills === 1, { hostKills: hk2.kills, clientKills: ck2.kills });
  check('enemy gone on both', !(await ev(C, 'KT.nt.enemies()')).some(q => q.id === t2.id));
  // --- enemy shot at the client: hurts the client's own player, not the host's puppet of it, nor the host ---
  await ev(H, 'KT.enemy.killAll(); 0'); await step(pages, 30);
  await ev(C, 'KT.nt.moveTo(60, 100); KT.nt.dmg.length = 0; 0'); await ev(H, 'KT.nt.moveTo(120, 100); KT.nt.dmg.length = 0; 0');
  await step(pages, 20);
  const before = { c: await ev(C, 'KT.nt.me()'), h: await ev(H, 'KT.nt.me()') };
  // a host-side Vanta soldier entity fires e_rifle rounds straight at the client's puppet
  await ev(H, `(() => { const p = [...KT.net.peers.values()][0].ent; const u = KT.enemy.spawn('soldier', p.pos.x + 8, p.pos.z, {variant:'rifle'}); u.ent.invuln = true; window.__u = u; KT.enemy.dir && (0); })()`);
  let hits = 0;
  for (let i = 0; i < 25; i++) {
    await ev(H, `(() => { const u = window.__u, p = [...KT.net.peers.values()][0].ent; u.ent.pos.set(p.pos.x + 8, p.pos.y, p.pos.z); const o = new KT.THREE.Vector3(p.pos.x + 7, p.pos.y + 1.2, p.pos.z), d = new KT.THREE.Vector3(-1, 0, 0); KT.combat.fireProjectile('e_rifle', u.ent, o, d, {}); })()`);
    await step(pages, 2);
  }
  await step(pages, 15);
  const after = { c: await ev(C, 'KT.nt.me()'), h: await ev(H, 'KT.nt.me()') };
  const cd = await ev(C, 'KT.nt.dmg.filter(d => d[0] === "pilot")'), hd = await ev(H, 'KT.nt.dmg.filter(d => d[0] === "pilot")');
  const hpOnHost = (await ev(H, 'KT.nt.peers()'))[0].hp;
  check('enemy fire hurts the client on the client', cd.length > 0 && hd.length === 0 && after.h.hp >= before.h.hp, { clientDamageEvents: cd.length, total: +cd.reduce((a, d) => a + d[2], 0).toFixed(1), hostDamageEvents: hd.length, clientHp: after.c.hp, hostHp: after.h.hp, puppetHpOnHost: hpOnHost, shotsIn: (await ev(C, 'KT.nt.info()')).stats.shotsIn });
  console.log('host', JSON.stringify((await ev(H, 'KT.nt.info()')).stats)); console.log('client', JSON.stringify((await ev(C, 'KT.nt.info()')).stats));
  console.log('log host', JSON.stringify(await ev(H, 'KT.nt.log.slice(-12)'))); console.log('log client', JSON.stringify(await ev(C, 'KT.nt.log.slice(-12)')));
  const errs = errors(pages); check('no console errors', errs.length === 0, errs.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
