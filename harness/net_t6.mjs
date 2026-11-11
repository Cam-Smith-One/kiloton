// NET test 6: client pushes on enemies reach the host, mission props take client hits, synchronised fire, hidden-tab catch-up.
//   node harness/net_t6.mjs
import { startRelay, startHttp, launch, lobby, step, until, ev, check, errors, sleep, R } from './net_lib.mjs';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const diff = async (A, B) => (await ev(B, `KT.nt.diffChunks(${JSON.stringify(await ev(A, 'KT.nt.hashes()'))})`));
try {
  const { pages } = await lobby(br, srv, 2, 'noenemy=1&god=1', 'noenemy=1&god=1');
  const [H, C] = pages;
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 20);
  // --- pushes ---
  await ev(H, `(() => { const p = KT.state.player.ent.pos, E = KT.enemy; window.__t = E.spawn('tank', p.x + 3, p.z + 26, { hp: 1e6 }); window.__s = E.spawn('soldier', p.x - 4, p.z + 20, { variant: 'rifle', hp: 1e6, hold: 2 }); })()`);
  await step(pages, 30);
  const ids = await ev(H, '[__t.ent.netId, __s.ent.netId]');
  const before = await ev(H, '({ t: __t.ent.pos.toArray(), s: __s.ent.pos.toArray() })');
  // knock-back: PLAYER adds velocity to the puppet during its update; NET measures that and sends an impulse
  await ev(C, `(() => { const e = KT.enemy.byNetId(${ids[1]}).ent; KT.net._push.before(); e.vel.x += 14; e.vel.y += 5; KT.net._push.after(); })()`);
  await step(pages, 3);
  const vs = await ev(H, '__s.ent.vel.toArray()');
  await step(pages, 20);
  const mid = await ev(H, '({ s: __s.ent.pos.toArray() })');
  check('client knock-back reaches the host unit', (await ev(H, 'KT.net.stats.pushesIn')) >= 1 && vs[0] > 2, { hostVelAfter3Frames: vs.map(v => +v.toFixed(1)), movedX: +(mid.s[0] - before.s[0]).toFixed(2), impulseSupportedByEnemy: await ev(H, '(() => { try { return KT.enemy.command(0xffff, "impulse", {vx:0,vy:0,vz:0}) } catch (e) { return String(e) } })()') });
  // grapple yank: PLAYER holds the puppet and drags its position for half a second
  for (let i = 0; i < 15; i++) { await ev(C, `(() => { const e = KT.enemy.byNetId(${ids[1]}).ent; KT.net._push.before(); e.held = true; e.pos.x -= 0.4; e.pos.y = ${before.s[1]} + 2; KT.net._push.after(); window.__last = e.pos.toArray(); })()`); await step(pages, 1); }
  await step(pages, 3);
  const drag = await ev(H, '({ s: __s.ent.pos.toArray(), held: !!__s.ent.held })'), last = await ev(C, '__last');
  await ev(C, `KT.enemy.byNetId(${ids[1]}).ent.held = false; 0`); await step(pages, 30);
  const rel = await ev(H, '({ held: !!__s.ent.held, y: __s.ent.pos.y })');
  check('client grapple drag moves the host unit, then lets go', drag.held && drag.s[1] > before.s[1] + 1 && !rel.held && rel.y < before.s[1] + 1, { hostY: +drag.s[1].toFixed(2), heldDuring: drag.held, heldAfter: rel.held, yAfter: +rel.y.toFixed(2), pushes: await ev(H, 'KT.net.stats.pushesIn') });
  await ev(H, 'KT.enemy.clearAll(); 0'); await step(pages, 10);
  // --- fire with the host as the authority: an incendiary start in a flammable shop front, compare while it burns and after ---
  const hasFire = await ev(H, '!!(KT.destruct.serializeFires && KT.destruct.applyFires)');
  if (hasFire) {
    const spot = await ev(C, `(() => { const g = KT.grid, e = KT.state.player.ent; let best = null; const M = KT.grid.data; for (let i = 8; i < KT.NX - 8; i += 2) for (let k = 8; k < KT.NZ - 8; k += 2) for (let j = 5; j < 14; j += 2) { const m = M[i + KT.NX * (k + KT.NZ * j)]; if (m === 43 || m === 47) { const d = Math.hypot(i * 0.5 - e.pos.x, k * 0.5 - e.pos.z); if (!best || d < best.d) best = { d, x: i * 0.5, y: j * 0.5, z: k * 0.5 }; } } return best; })()`);
    await ev(C, `KT.boom(${spot.x}, ${spot.y}, ${spot.z}, { radius: 3, power: 130, damage: 0, owner: KT.state.player.ent, kind: 'rocket' }); KT.destruct.ignite(${spot.x}, ${spot.y}, ${spot.z}, 4, 1, KT.state.player.ent); 0`);
    const tl = [];
    for (let s = 0; s < 40; s++) {
      await step(pages, 30, 1 / 30, 3);
      const fh = await ev(H, 'KT.destruct.fires.count'), fc = await ev(C, 'KT.destruct.fires.count'), d = (await diff(H, C)).length;
      tl.push([s + 1, fh, fc, d]);
      if (fh === 0 && fc === 0 && d === 0 && s > 3) break;
      if (s >= 24 && tl.slice(-6).every(t => t[3] === 0)) break;
    }
    const peak = Math.max(...tl.map(t => t[1])), worst = Math.max(...tl.map(t => t[3])), end = tl[tl.length - 1], st = (await ev(C, 'KT.nt.info()')).stats, hs = (await ev(H, 'KT.nt.info()')).stats;
    const sameCount = tl.filter(t => t[1] > 0).every(t => Math.abs(t[1] - t[2]) <= Math.max(3, t[1] * 0.25));
    check('fire: same burning cells and same burnt voxels on both', peak > 3 && end[3] === 0 && sameCount, { spotDist: +spot.d.toFixed(1), peakCells: peak, seconds: end[0], maxChunksDifferingWhileBurning: worst, timeline: tl.filter((t, i) => i % 3 === 0), firesMsgs: st.firesIn, fireKB: +(hs.fireBytes / 1024).toFixed(1), healedChunks: st.healed, solid: [await ev(H, 'KT.nt.solid()'), await ev(C, 'KT.nt.solid()')] });
  } else console.log('SKIP fire sync: G.destruct.serializeFires / applyFires not present');
  // --- hidden client tab: no frames for 20 s of host time, only the pump; then it comes back ---
  await ev(H, `(() => { const p = KT.state.player.ent.pos; KT.enemy.spawnGroup(['rifle','rifle','rocketeer','drone','tank','rifle'], p.x, p.z + 30, { hp: 1e6 }); })()`);
  await step(pages, 20);
  for (let i = 0; i < 20; i++) { await step([H], 30, 1 / 30, 2); await ev(H, `(() => { const p = KT.state.player.ent.pos; if (${i} % 5 === 0) KT.boom(p.x + 20 + ${i}, p.y + 1, p.z + 10, { radius: 3, power: 140, damage: 0, kind: 'slam' }); })()`); }
  await sleep(600);
  const q = await ev(C, '({ t: KT.time, peer: KT.nt.peers()[0], units: KT.enemy.list.length, msgsIn: KT.net.stats.msgsIn, status: KT.net.status })');
  await ev(H, 'KT.nt.moveTo(KT.state.player.ent.pos.x + 5, KT.state.player.ent.pos.z); 0');
  await step(pages, 30);
  const he = await ev(H, 'KT.nt.enemies()'), ce = await ev(C, 'KT.nt.enemies()'), hm = await ev(H, 'KT.nt.me()'), cp = (await ev(C, 'KT.nt.peers()'))[0];
  let maxErr = 0; for (const a of he) { const b = ce.find(x => x.id === a.id); if (b) maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.z - b.z)); }
  const conv = await until(pages, async () => (await diff(H, C)).length === 0, 900);
  check('hidden client catches up', q.status === 'playing' && he.length === ce.length && maxErr < 3 && Math.hypot(hm.x - cp.x, hm.z - cp.z) < 0.3 && conv >= 0 && C.errs.length === 0, { unitsWhileHidden: q.units, host: he.length, client: ce.length, maxUnitErr: +maxErr.toFixed(2), hostPuppetErr: +Math.hypot(hm.x - cp.x, hm.z - cp.z).toFixed(3), worldConvergedAfterS: +(conv / 30).toFixed(1) });
  // host driven at ~30 Hz from a timer instead of requestAnimationFrame is what every step above already is (KT.debugStep)
  const errs = errors(pages); check('no console errors', errs.length === 0, errs.length);
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
// --- mission props (separate game): the client shoots the citadel core / the relay ---
try {
  const { pages } = await lobby(br, srv, 2, 'god=1&stage=3', 'god=1');
  const [H, C] = pages;
  await ev(H, 'KT.net.start({mode:"operation"})'); await step(pages, 30);
  if (await ev(H, '!!KT.mission.entByNetId')) {
    await until(pages, async () => !!(await ev(H, '(() => { const e = KT.mission.entByNetId("m:core"); return e && e.alive && !e.invuln; })()')), 600);
    await step(pages, 20);
    const c0 = await ev(H, '(() => { const e = KT.mission.entByNetId("m:core"); return e ? { hp: e.hp, mhp: e.maxHp, x: e.pos.x, y: e.pos.y, z: e.pos.z, team: e.team } : null; })()');
    const cc = await ev(C, '(() => { const e = KT.net.entById("m:core"); return e ? { remote: !!e.remote, x: e.pos.x, y: e.pos.y, z: e.pos.z, inList: KT.ents.list.includes(e) } : null; })()');
    await ev(C, '(() => { const e = KT.net.entById("m:core"); for (let i = 0; i < 5; i++) KT.ents.damage(e, 100, { type: "rocket", src: KT.state.player.ent, x: e.pos.x, y: e.pos.y + 1, z: e.pos.z, weapon: "launcher" }); })()');
    await step(pages, 10);
    const c1 = await ev(H, '(() => { const e = KT.mission.entByNetId("m:core"); return e ? e.hp : -1; })()');
    check('client hits on the mission core are applied by the host', cc && cc.remote && c0 && c1 < c0.hp, { hostCore: c0, clientCore: cc, hpAfter5x100: c1, claimsIn: await ev(H, 'KT.net.stats.claimsIn') });
    const errs = errors(pages); check('no console errors (operation)', errs.length === 0, errs.length);
  } else console.log('SKIP mission props: G.mission.entByNetId not present');
} catch (e) { console.log('TEST ERROR', e); R.fail++; }
console.log(`\n${R.pass} passed, ${R.fail} failed`);
await br.close(); srv.close(); relay.kill();
process.exit(R.fail ? 1 : 0);
