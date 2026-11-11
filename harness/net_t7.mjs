// NET test 7: host tab hidden -> boot steps the sim from its worker timer (~30 Hz, no rendering); the client must not notice.
//   node harness/net_t7.mjs
import { startRelay, startHttp, launch, openPage, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
try {
  const common = 'q=low&base=render,fx,audio,ui&god=1&noenemy=1';
  // manual=1 on the host: no animation frames at all, exactly like a hidden tab; document.hidden is forced so boot's worker tick runs
  const H = await openPage(br, srv, common + '&manual=1&net=host&name=Ava', 'host');
  await sleep(3000);
  await ev(H, 'KT.net.simClock = false; Object.defineProperty(document, "hidden", { get: () => true }); 0');
  const C = await openPage(br, srv, common + '&net=join&name=Ben&code=' + await ev(H, 'KT.net.room'), 'client');
  await C.waitForFunction('KT.net.status === "lobby"', null, { timeout: 60000, polling: 100 });
  await ev(H, 'KT.net.start({mode:"survival"})'); await sleep(1500);
  await ev(H, '(() => { const p = KT.state.player.ent.pos; KT.enemy.spawnGroup(["rifle","rifle","rocketeer","drone","tank"], p.x + 5, p.z + 35, { hp: 1e6 }); })()');
  await sleep(1000);
  const a = await ev(H, '({ t: KT.time, f: KT.frame, w: performance.now(), s: KT.net.stats.snapsOut, b: KT.net.stats.bytesOut })');
  const ca = await ev(C, '({ e: KT.nt.enemies(), s: KT.net.stats.snapsIn })');
  await sleep(8000);
  const [b, cb] = await Promise.all([ev(H, '({ t: KT.time, f: KT.frame, w: performance.now(), s: KT.net.stats.snapsOut, b: KT.net.stats.bytesOut, e: KT.nt.enemies(), upd: KT.net.stats.updMs, late: KT.net.stats.lateMs })'),
    ev(C, '({ e: KT.nt.enemies(), s: KT.net.stats.snapsIn, peer: KT.nt.peers()[0], ping: KT.net.ping })')]);
  const wall = (b.w - a.w) / 1000, hz = (b.f - a.f) / wall, rate = (b.t - a.t) / wall, snapHz = (b.s - a.s) / wall;
  let moved = 0, maxErr = 0; for (const u of cb.e) { const o = ca.e.find(q => q.id === u.id), h = b.e.find(q => q.id === u.id); if (o) moved = Math.max(moved, Math.hypot(u.x - o.x, u.z - o.z)); if (h && u.v !== 'drone') maxErr = Math.max(maxErr, Math.hypot(u.x - h.x, u.z - h.z)); }
  check('hidden host keeps simulating from the worker timer', hz > 20 && hz < 40 && rate > 0.7 && snapHz > 8 && snapHz < 14, { stepsPerSecond: +hz.toFixed(1), gameTimePerWallSecond: +rate.toFixed(2), snapshotsPerSecond: +snapHz.toFixed(1), hostOutBps: Math.round((b.b - a.b) / wall), cpuMs: [+b.upd.toFixed(3), +b.late.toFixed(3)] });
  check('client keeps seeing a live world', cb.e.length === b.e.length && moved > 0.5 && maxErr < 4 && cb.peer.seen, { units: cb.e.length, furthestUnitMovedM: +moved.toFixed(1), maxGroundUnitErrVsHostM: +maxErr.toFixed(2), snapshotsIn: cb.s - ca.s, ping: cb.ping });
  const e = errors([H, C]); check('no console errors', e.length === 0, e.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
