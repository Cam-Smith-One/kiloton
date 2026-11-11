// NET screenshots: host view and client view of the same moment, real renderer and models.
//   BASE=audio,ui node harness/net_shots.mjs
import { startRelay, startHttp, launch, lobby, step, ev, errors, sleep } from './net_lib.mjs';
process.env.BASE = process.env.BASE || 'audio,ui';
const relay = await startRelay(), srv = await startHttp(), br = await launch();
const frames = async (pages, n) => { for (let i = 0; i < n; i++) { for (const p of pages) await ev(p, 'KT.nt.frame()'); await sleep(30); } };
const look = (p, x, z) => ev(p, `(() => { const e = KT.state.player.ent, c = KT.player.cam; c.yaw = Math.atan2(${x} - e.pos.x, ${z} - e.pos.z); c.pitch = -0.05; })()`);
const shot = async (p, name) => { await ev(p, 'KT.uiRoot.style.display = "none"; KT.nt.frame()'); await p.screenshot({ path: 'shots/' + name, timeout: 300000 }); console.log('wrote', name); };
try {
  const { pages } = await lobby(br, srv, 2, 'noenemy=1&god=1', 'noenemy=1&god=1', { width: 800, height: 450 });
  const [H, C] = pages;
  await ev(H, 'KT.net.start({mode:"survival"})'); await step(pages, 20);
  const sp = await ev(H, 'KT.nt.me()');
  // 1: both on foot. Host stands back, client 7 m ahead running across, two Vanta soldiers beyond.
  await ev(H, `KT.nt.moveTo(${sp.x}, ${sp.z})`); await ev(C, `KT.nt.moveTo(${sp.x - 0.5}, ${sp.z + 4.5})`);
  await ev(H, `(() => { const E = KT.enemy; E.spawn('soldier', ${sp.x} - 3, ${sp.z} + 22, { variant: 'rifle', hp: 1e5 }); E.spawn('soldier', ${sp.x} + 6, ${sp.z} + 25, { variant: 'rocketeer', hp: 1e5 }); E.spawn('tank', ${sp.x} + 1, ${sp.z} + 38, { hp: 1e6 }); })()`);
  await ev(C, 'KT.input.keys.add("KeyD"); 0');
  await look(H, sp.x + 2, sp.z + 20); await look(C, sp.x - 3, sp.z + 22);
  for (let i = 0; i < 7; i++) { await look(C, sp.x - 3, sp.z + 22); await ev(C, `KT.nt.fireAt('rifle', ${sp.x - 3}, ${sp.y + 1}, ${sp.z + 22})`); await step(pages, 2); await look(H, sp.x + 2, sp.z + 20); }
  await frames(pages, 6);
  await shot(H, 'net-01-host.png'); await shot(C, 'net-01-client.png');
  console.log('1', JSON.stringify({ host: await ev(H, 'KT.nt.me()'), clientOnHost: (await ev(H, 'KT.nt.peers()'))[0], client: await ev(C, 'KT.nt.me()'), hostOnClient: (await ev(C, 'KT.nt.peers()'))[0], enemiesH: (await ev(H, 'KT.nt.enemies()')).length, enemiesC: (await ev(C, 'KT.nt.enemies()')).length }));
  await ev(C, 'KT.input.keys.delete("KeyD"); 0');
  // 2: the client boards a Bastion (white paint) and fires; the host watches from the side on foot.
  await ev(C, `(() => { KT.player.debug.spawnRig(${sp.x + 3}, ${sp.z + 12}, true, 2); })()`);
  await step(pages, 40);
  await ev(H, `KT.nt.moveTo(${sp.x - 3}, ${sp.z + 3})`);
  for (let i = 0; i < 10; i++) { await look(C, sp.x + 1, sp.z + 38); await ev(C, `KT.input.buttons[0] = true; if (${i} < 4) KT.input.keys.add("KeyW"); else KT.input.keys.delete("KeyW"); 0`); await step(pages, 2); const r = (await ev(H, 'KT.nt.peers()'))[0]; await look(H, r.x, r.z); await ev(H, 'KT.player.cam.pitch = 0.22'); }
  await frames(pages, 5);
  await shot(H, 'net-02-host.png'); await shot(C, 'net-02-client.png');
  console.log('2', JSON.stringify({ clientOnHost: (await ev(H, 'KT.nt.peers()'))[0], client: await ev(C, 'KT.nt.me()') }));
  // 3: the client goes down next to the host
  await ev(C, 'KT.input.buttons[0] = false; KT.input.keys.clear(); 0');
  errors(pages);
} catch (e) { console.log('ERR', e); }
await br.close(); srv.close(); relay.kill(); process.exit(0);
