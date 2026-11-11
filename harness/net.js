// NET harness: every real module (or baselines via ?base=render,fx,audio,ui), as host or client.
//   ?net=host            create a room (code in KT.net.room)        ?net=join&code=ABCD   join it
//   ?relay=ws://127.0.0.1:8080/ws   local relay        ?manual=1  no frame loop: the test steps with KT.nt.step(n, dt)
//   ?base=a,b,c          run the lead's baseline for those modules   ?name=…
import { boot } from '../src/boot.js';
import city from '../src/city.js';
import render from '../src/render.js';
import destruct from '../src/destruct.js';
import fx from '../src/fx.js';
import audio from '../src/audio.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import ui from '../src/ui.js';
import mission from '../src/mission.js';
import net from '../src/net.js';

const Q = new URLSearchParams(location.search);
const base = new Set((Q.get('base') || '').split(',').filter(Boolean));
const all = { city, render, destruct, fx, audio, models, combat, player, enemy, mission, net, ui };
const use = {}; for (const k in all) if (!base.has(k)) use[k] = all[k];
const manual = Q.has('manual'), frames = [];
if (manual) { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (fn) => { frames.push(fn); return 0; }; window.__raf = raf; }

boot({ use, after(G) {
  const N = G.net, log = [];
  if (manual) N.simClock = true;
  for (const t of ['net:status', 'net:peer+', 'net:peer-', 'net:start', 'net:closed', 'net:heal', 'wave:start', 'wave:clear', 'player:down', 'player:revived', 'game:over', 'score', 'phase'])
    G.bus.on(t, (d) => { log.push([t, t === 'net:status' ? N.status + (N.error ? ':' + N.error : '') : t === 'score' ? d.points + ' ' + d.label : t === 'phase' ? d.phase : t === 'net:heal' ? d.chunk + ':' + d.voxels + ':' + d.ok : '']); if (log.length > 400) log.shift(); });
  const dmg = []; G.bus.on('ent:damage', (d) => { if (!d.claim) dmg.push([d.ent.kind, d.ent.netId || 0, +d.amount.toFixed(1), d.info && d.info.type, d.info && d.info.src ? d.info.src.netId || -1 : 0]); if (dmg.length > 300) dmg.shift(); });
  const nt = G.nt = {
    log, dmg,
    // advance the simulation n frames (net.update first, lateUpdate last, like the real frame loop), no rendering
    step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) { G.debugStep(1, dt); } return +G.time.toFixed(3); },
    frame() { const f = frames.splice(0); for (const fn of f) fn(performance.now()); return f.length; },   // one real rendered frame (manual mode)
    solid() { const d = G.grid.data; let n = 0; for (let i = 0; i < d.length; i++) if (d[i]) n++; return n; },
    hashes(list) { const D = G.destruct, out = {}; const L = list || [...Array(G.CX * G.CY * G.CZ).keys()]; for (const c of L) out[c] = D.chunkHash ? D.chunkHash(c) : 0; return out; },
    hashAll() { const D = G.destruct; let h = 0; for (let c = 0; c < G.CX * G.CY * G.CZ; c++) h = (Math.imul(h, 31) + D.chunkHash(c)) >>> 0; return h; },
    diffChunks(other) { const D = G.destruct, out = []; for (let c = 0; c < G.CX * G.CY * G.CZ; c++) if (D.chunkHash(c) !== other[c]) out.push(c); return out; },
    enemies() { return G.enemy.list.filter(u => !u.dead).map(u => ({ id: u.ent.netId, v: u.variant, x: +u.ent.pos.x.toFixed(2), y: +u.ent.pos.y.toFixed(2), z: +u.ent.pos.z.toFixed(2), hp: Math.round(u.ent.hp), mhp: u.ent.maxHp, remote: !!u.ent.remote })).sort((a, b) => a.id - b.id); },
    me() { const p = G.state.player, e = p.ent; return e ? { mode: p.mode, x: +e.pos.x.toFixed(2), y: +e.pos.y.toFixed(2), z: +e.pos.z.toFixed(2), hp: +e.hp.toFixed(1), mhp: e.maxHp, kills: p.kills, score: p.score, down: !!p.down, id: e.netId } : null; },
    peers() { return [...N.peers.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready, seen: p.seen, down: p.down, mode: p.st.mode, kind: p.ent && p.ent.kind, x: p.ent && +p.ent.pos.x.toFixed(2), y: p.ent && +p.ent.pos.y.toFixed(2), z: p.ent && +p.ent.pos.z.toFixed(2), hp: p.ent && +p.ent.hp.toFixed(1), mech: !!p.mech, chassis: p.mech && p.mech.chassis, vis: p.ent && p.ent.rig && p.ent.rig.root.visible, inScene: p.ent && p.ent.rig && !!p.ent.rig.root.parent })); },
    info() { return { status: N.status, err: N.error, room: N.room, id: N.id, host: N.isHost, ping: N.ping, phase: G.state.phase, t: +G.time.toFixed(2), nt: +N.time.toFixed(2), ents: G.ents.list.length, wave: Object.assign({}, G.state.wave), stats: Object.assign({}, N.stats) }; },
    // fire a weapon from the local player's entity at a world point
    fireAt(weapon, x, y, z) { const e = G.state.player.ent, o = new G.THREE.Vector3(e.pos.x, e.pos.y + e.height * 0.8, e.pos.z), d = new G.THREE.Vector3(x, y, z).sub(o).normalize(); o.addScaledVector(d, e.radius + 0.6); return !!G.combat.fireProjectile(weapon, e, o, d, {}); },
    moveTo(x, z, y) { const p = G.state.player, e = p.ent; e.pos.set(x, y == null ? G.grid.topBelow(x, 40, z) : y, z); e.vel.set(0, 0, 0); G.grid.unstick(e, 8); return nt.me(); },
    errors: [],
  };
  addEventListener('error', (e) => nt.errors.push(String(e.message)));
  const mode = Q.get('net'), name = Q.get('name') || (mode === 'host' ? 'Host' : 'Client');
  if (mode === 'host') N.create(name).catch(e => nt.errors.push('create ' + e.message));
  else if (mode === 'join') N.join(Q.get('code'), name).catch(e => nt.errors.push('join ' + e.message));
} });
