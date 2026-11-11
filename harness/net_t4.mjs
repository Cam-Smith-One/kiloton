// NET test 4: Operation Blackout over the wire (mission state, structures), announcements, blast events, ping, pause pump.
//   node harness/net_t4.mjs
import { startRelay, startHttp, launch, lobby, step, until, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const diff = async (A, B) => (await ev(B, `KT.nt.diffChunks(${JSON.stringify(await ev(A, 'KT.nt.hashes()'))})`));
try {
  const { pages } = await lobby(br, srv, 2, 'god=1', 'god=1');
  const [H, C] = pages;
  await ev(C, 'window.__ev = { ex: [], msg: [], st: [], on: [] }; KT.bus.on("explosion", d => __ev.ex.push([d.kind, !!d.remote, +d.radius.toFixed(1)])); KT.bus.on("ui:message", d => __ev.msg.push(d.text)); KT.bus.on("mission:stage", d => __ev.st.push(d.n)); KT.bus.on("objective:new", d => __ev.on.push(d.objective && d.objective.id)); 0');
  await ev(H, 'KT.net.start({mode:"operation"})'); await step(pages, 30);
  check('operation started on both', (await ev(C, 'KT.state.mode')) === 'operation' && (await ev(C, 'KT.nt.info()')).phase === 'playing');
  await step(pages, 330, 1 / 30, 3);
  const hm = await ev(H, '({ active: KT.mission.active, stage: KT.mission.stage, obj: KT.mission.objectives.map(o => [o.id, +(o.progress || 0).toFixed(2), !!o.done]), mk: KT.mission.markers.length, units: KT.enemy.list.length })');
  const cm = await ev(C, '({ active: KT.mission.active, stage: KT.mission.stage, obj: KT.mission.objectives.map(o => [o.id, +(o.progress || 0).toFixed(2), !!o.done]), mk: KT.mission.markers.length, units: KT.enemy.list.length, ev: window.__ev })');
  check('mission state replicated', cm.stage === hm.stage && cm.obj.length === hm.obj.length && hm.obj.length > 0 && cm.mk === hm.mk, { host: hm, client: { stage: cm.stage, obj: cm.obj, mk: cm.mk, units: cm.units }, stageEvents: cm.ev.st, objectiveNew: cm.ev.on });
  const d0 = await diff(H, C), f = d0.length ? await until(pages, async () => (await diff(H, C)).length === 0, 900) : 0;
  check('mission structures identical on the client', f >= 0, { differingChunksAfterStart: d0.length, secondsToConverge: +(f / 30).toFixed(1), solid: [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')] });
  check('host announcements reach the client', cm.ev.msg.length > 0, cm.ev.msg.slice(0, 4));
  // a blast that is not a projectile (rig drop, slam, mission charge): the hole AND the explosion event must arrive
  await ev(C, '__ev.ex.length = 0; 0');
  const s0 = await ev(C, 'KT.nt.solid()');
  await ev(H, '(() => { const p = KT.state.player.ent.pos; KT.boom(p.x + 12, p.y + 0.5, p.z + 6, { radius: 4, power: 160, damage: 0, kind: "slam", owner: KT.state.player.ent }); })()');
  await step(pages, 12);
  const ex = await ev(C, '__ev.ex');
  check('non-projectile blast: hole + explosion event on the client', ex.length === 1 && ex[0][0] === 'slam' && ex[0][1] === true && (await ev(C, 'KT.nt.solid()')) < s0, { events: ex, removed: s0 - await ev(C, 'KT.nt.solid()') });
  // a projectile blast: exactly one explosion event on the client (from the replayed rocket), not two
  await ev(C, '__ev.ex.length = 0; 0');
  await ev(H, '(() => { const p = KT.state.player.ent.pos; KT.nt.fireAt("launcher", p.x - 14, p.y + 0.2, p.z + 8); })()');
  await step(pages, 60);
  const ex2 = await ev(C, '__ev.ex');
  check('rocket blast announced once on the client', ex2.filter(e => e[0] === 'rocket').length === 1, ex2);
  // ping + keeping the link alive while the frame loop is not running
  const t0 = await ev(C, 'KT.net.stats.msgsOut'); await sleep(2500);
  const pg = await ev(C, '({ ping: KT.net.ping, sent: KT.net.stats.msgsOut })'), hp = await ev(H, 'KT.net.ping');
  check('ping measured, link pumped without frames', pg.sent > t0 && pg.ping >= 0 && pg.ping < 500, { clientToHostMs: pg.ping, hostToRelayMs: hp, messagesWhileIdle: pg.sent - t0 });
  // host returns to the title -> the client follows into the lobby, still connected
  await ev(H, 'KT.bus.emit("ui:title"); 0'); await step(pages, 20);
  const li = [await ev(H, 'KT.nt.info()'), await ev(C, 'KT.nt.info()')];
  check('host to title -> both back in the lobby', li[0].status === 'lobby' && li[1].status === 'lobby' && li[1].phase === 'title' && (await ev(C, 'KT.enemy.puppetMode')) === false, [li[0].status, li[1].status, li[1].phase]);
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 30);
  check('second run from the lobby', (await ev(C, 'KT.nt.info()')).phase === 'playing' && (await ev(C, 'KT.state.mode')) === 'survival' && (await ev(H, 'KT.nt.peers()'))[0].seen);
  // the client quits: host carries on alone, client is offline at the title
  await ev(C, 'KT.net.leave(); 0'); await sleep(300); await step(pages, 15);
  const q = [await ev(H, 'KT.nt.info()'), await ev(C, 'KT.nt.info()')];
  check('client leave()', q[0].phase === 'playing' && (await ev(H, 'KT.net.peers.size')) === 0 && q[1].status === 'offline' && q[1].phase === 'title', [q[0].status, q[1].status, q[1].phase]);
  const errs = errors(pages); check('no console errors', errs.length === 0, errs.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
