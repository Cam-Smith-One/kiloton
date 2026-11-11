// NET test 5: real frame loops (no manual stepping, wall clock): puppets and enemies still track; real UI loaded.
//   node harness/net_t5.mjs
import { startRelay, startHttp, launch, openPage, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
try {
  const common = 'q=low&base=' + (process.env.BASE || 'render,fx,audio') + '&god=1';
  const H = await openPage(br, srv, common + '&net=host&name=Ava', 'host');
  await sleep(3000);
  await H.waitForFunction('KT.net.room', null, { timeout: 60000, polling: 100 });
  const C = await openPage(br, srv, common + '&net=join&name=Ben&code=' + await ev(H, 'KT.net.room'), 'client');
  await C.waitForFunction('KT.net.status === "lobby"', null, { timeout: 60000, polling: 100 });
  await sleep(500);
  check('lobby (real UI present)', (await ev(H, 'KT.net.peers.size')) === 1 && (await ev(H, '!!KT.ui && KT.ui.name')) === 'ui');
  await ev(H, 'KT.net.start({mode:"survival"})');
  await sleep(1500);
  await ev(H, '(() => { const p = KT.state.player.ent.pos, E = KT.enemy; E.spawnGroup(["rifle","rifle","rocketeer","drone","tank"], p.x + 5, p.z + 35, { hp: 1e6 }); })()');
  // the client runs in a circle (real input) for 8 s of wall time
  await ev(C, 'KT.input.keys.add("KeyW"); window.__iv = setInterval(() => { KT.player.cam.yaw += 0.05; }, 16); 0');
  const errs = [];
  for (let i = 0; i < 16; i++) {
    await sleep(500);
    const [a, b] = await Promise.all([ev(C, '({ m: KT.nt.me(), t: performance.timeOrigin + performance.now(), v: KT.state.player.ent.vel.length() })'), ev(H, '({ p: KT.nt.peers()[0], t: performance.timeOrigin + performance.now() })')]);
    if (b.p && b.p.seen) errs.push({ d: Math.hypot(a.m.x - b.p.x, a.m.z - b.p.z), v: a.v });
  }
  await ev(C, 'clearInterval(window.__iv); KT.input.keys.clear(); 0');
  const mean = errs.reduce((s, e) => s + e.d, 0) / errs.length, max = Math.max(...errs.map(e => e.d)), sp = errs.reduce((s, e) => s + e.v, 0) / errs.length;
  check('moving puppet tracks its owner in real time', errs.length > 10 && max < 4, { samples: errs.length, meanLagM: +mean.toFixed(2), maxLagM: +max.toFixed(2), ownerSpeed: +sp.toFixed(1), impliedDelayS: +(mean / Math.max(0.1, sp)).toFixed(2) });
  await sleep(800);
  const he = await ev(H, 'KT.nt.enemies()'), ce = await ev(C, 'KT.nt.enemies()');
  check('enemies on both (real time)', he.length === ce.length && he.length >= 5, { host: he.length, client: ce.length });
  const hi = await ev(H, 'KT.nt.info()'), ci = await ev(C, 'KT.nt.info()');
  check('rates', ci.stats.inBps > 0, { phases: [hi.phase, ci.phase], totals: [hi.stats.bytesOut, ci.stats.bytesIn, hi.nt, hi.t], hostFps: await ev(H, 'window.__KT_STATS.fps'), clientFps: await ev(C, 'window.__KT_STATS.fps'), hostOutBps: hi.stats.outBps, clientInBps: ci.stats.inBps, clientOutBps: ci.stats.outBps, ping: ci.ping, hostCpu: [+hi.stats.updMs.toFixed(3), +hi.stats.lateMs.toFixed(3)], clientCpu: [+ci.stats.updMs.toFixed(3), +ci.stats.lateMs.toFixed(3)] });
  const e = errors([H, C]); check('no console errors', e.length === 0, e.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
