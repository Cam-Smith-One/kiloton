// ============================================================================
// KILOTON — net.js   OWNER: NET.   G.net  (CONTRACT-D D1 / D2, notes/net.md)
// Co-op over the relay: socket + lobby + clock here;
//   net_wire.js     binary writer / reader, message ids
//   net_players.js  player state, puppets, shots, hit claims, kill credit
//   net_world.js    destruction ops, chunk checksums and healing
//   net_shared.js   waves, mission, announcements, game over, revive-all
// Offline nothing here runs: update / lateUpdate return on the first test.
// ============================================================================
import { G, bus } from './core.js';
import { Writer, Reader, T } from './net_wire.js';
import * as PL from './net_players.js';
import * as WD from './net_world.js';
import * as SH from './net_shared.js';

const SNAP_DT = 1 / 12;
let ws = null, opening = null, pumpId = 0, availAt = -1e9, availVal = false;
const inQ = [];
const outs = new Map();                   // target byte -> Writer
const jq = new Map();                     // JSON batches: target ('' = all) -> array
const handlers = new Map();               // custom messages (net.on)
const rd = new Reader(), pingW = new Writer(16);
let lastReal = 0, lastUpd = 0, pendingLate = false, lastDt = 0, snapT = 0, pingT = 0, relayPingT = 0, secT = 0, secOut = 0, secIn = 0, msgSec = 0, msgT = 0;
let starting = false, byHost = false;
let pendSnap = null, pendSnapT = 0;
const instr = [];                         // [module, originalUpdate, wrapper] while playing online
const S = () => G.state;
const safe = (fn) => { try { return fn(); } catch (e) { if (G.debug) console.warn('net', e); return undefined; } };

const net = {
  name: 'net', online: false, isHost: true, id: 0, hostId: 0, room: null, status: 'offline', error: '', ping: 0, peers: new Map(),
  myName: 'Pilot', ready: false, webUrl: '', reportsAllDown: true, simClock: false, time: 0, idleDt: 0.016, frameN: 0, cur: '', seedMismatch: false,
  stats: { outBps: 0, inBps: 0, bytesOut: 0, bytesIn: 0, msgsOut: 0, msgsIn: 0, updMs: 0, lateMs: 0, updMax: 0, lateMax: 0, opsOut: 0, opsIn: 0, shotsOut: 0, shotsIn: 0, claimsOut: 0, claimsIn: 0,
    pushesOut: 0, pushesIn: 0, firesOut: 0, firesIn: 0, fireBytes: 0, chkOut: 0, chkIn: 0, chunkReqs: 0, chunksOut: 0, healed: 0, healedVoxels: 0, healBytes: 0, snapsOut: 0, snapsIn: 0, snapBytes: 0 },

  init() {
    this.webUrl = G.WEB_URL || '';
    PL.init(this); WD.init(this); SH.init(this);
    bus.on('game:start', () => {
      if (!this.online) return;
      PL.reset(); WD.reset(); SH.reset();
      if (this.isHost && !starting && this.status === 'playing') this.sendJ({ k: 'start', seed: S().seed, mode: S().mode, restart: true });   // host pressed Retry
      spreadSpawn();
    });
    bus.on('phase', (d) => {
      if (!this.online || this.status !== 'playing' || !d || d.phase !== 'title') return;
      if (this.isHost) { this.sendJ({ k: 'lobby' }); toLobby(); } else if (!byHost) this.leave();
    });
  },
  reset() { if (this.online) { PL.reset(); WD.reset(); SH.reset(); } },

  // ---- connection / lobby --------------------------------------------------------------
  available() {
    const now = performance.now();
    if (ws && ws.readyState === 1) return Promise.resolve(true);
    if (now - availAt < 20000) return Promise.resolve(availVal);
    return new Promise((res) => {
      let done = false, s = null;
      const fin = (ok) => { if (done) return; done = true; availAt = performance.now(); availVal = ok; if (!ok) { this.error = 'Co-op needs the web version: ' + this.webUrl; } safe(() => s && s.close()); res(ok); };
      try { s = new WebSocket(G.RELAY_URL); s.onopen = () => fin(true); s.onerror = () => fin(false); s.onclose = () => fin(false); setTimeout(() => fin(false), 6000); } catch (e) { fin(false); }
    });
  },
  create(name) { return enter({ t: 'create', name: this.myName = clean(name) }); },
  join(code, name) { return enter({ t: 'join', code: String(code || '').toUpperCase().trim(), name: this.myName = clean(name) }); },
  leave() {
    if (!ws && this.status === 'offline') return;
    const playing = this.status === 'playing', host = this.isHost;
    safe(() => { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' })); });
    goOffline('offline', '');
    if (playing && !host && S().phase !== 'title') bus.emit('ui:title');
  },
  setReady(on) { this.ready = !!on; if (this.online) this.sendJ({ k: 'hi', name: this.myName, ready: this.ready }); bus.emit('net:status', this); },
  // host: start (or restart) the run for everyone. opts { mode }
  start(opts) {
    if (!this.online || !this.isHost || (this.status !== 'lobby' && this.status !== 'playing')) return false;
    const mode = (opts && opts.mode) || S().mode || 'survival', seed = S().seed >>> 0;
    this.sendJ({ k: 'start', seed, mode });
    flush();
    begin(seed, mode);
    return true;
  },

  // ---- messaging -----------------------------------------------------------------------
  // custom messages for other modules: send('type', data, to?) / on('type', (data, from) => {})   (to: peer id | 'h' | omitted = everyone else)
  send(type, data, to) { if (this.online) this.sendJ({ k: 'x', t: type, d: data }, to); },
  on(type, fn) { let a = handlers.get(type); if (!a) handlers.set(type, a = []); a.push(fn); return fn; },
  sendJ(d, to) { if (!this.online) return; const key = to == null ? '' : to; let a = jq.get(key); if (!a) jq.set(key, a = []); a.push(d); },
  out(to) {                               // Writer of the binary frame going to `to` (0 everyone else, 255 host, n peer)
    let w = outs.get(to); if (!w) { outs.set(to, w = new Writer(4096)); w.u8(to); }
    if (w.o > 120000) { sendBin(w); w.reset().u8(to); }
    return w;
  },

  // ---- hooks other modules call ------------------------------------------------------------
  claimHit(ent, amount, info) { PL.claimHit(ent, amount, info); },
  tapDestruct(op, args, seed) { WD.tapDestruct(op, args, seed); },
  players() { return PL.players(); },
  localOwns(ent) { return !!ent && !ent.remote; },
  entById(id) { return PL.entById(id); },
  enemyCmd(netId, cmd, arg) {
    if (!this.online || this.status !== 'playing') return;
    if (this.isHost) PL.hostCmd(netId, cmd, arg, G.state.player.ent);
    else this.sendJ({ k: 'cmd', id: netId, c: cmd, a: arg == null ? null : arg }, 'h');
  },
  _push: { before: PL.pushBefore, after: PL.pushAfter },    // tests
  revive(ent) { if (this.online && ent && ent.netOwner != null) this.sendJ({ k: 'pev', e: [{ type: 'revive', target: ent.netOwner }] }); },

  // ---- frame -------------------------------------------------------------------------------
  update(dt) {
    if (!ws) return;
    const t0 = performance.now();
    pendingLate = true; lastDt = dt; lastUpd = t0; this.frameN++;
    const real = Math.min(1, Math.max(0, (t0 - lastReal) / 1000)); lastReal = t0; this.idleDt = Math.max(0.001, real);   // wall time for the send timers when the sim is not advancing (paused / pumped)
    this.time += this.simClock ? (dt > 0 ? G.rawDt || dt : 0) : real;
    if (this.online && this.status === 'playing' && G.timeScale !== 1 && S().phase === 'playing') G.timeScale = 1;   // no slow motion in a shared world
    drain();
    if (this.online && this.status === 'playing') { PL.update(dt); SH.update(dt); if (this.isHost) PL.hostHolds(); }
    const st = this.stats, ms = performance.now() - t0; st.updMs += (ms - st.updMs) * 0.05; if (ms > st.updMax) st.updMax = ms;
  },
  lateUpdate(dt) {
    if (!ws || !pendingLate) return;           // once per update
    pendingLate = false;
    if (!this.online) return;
    const t0 = performance.now(), real = dt > 0 ? dt : this.idleDt;
    if (this.status === 'playing') {
      PL.late(dt);
      if (this.isHost && this.peers.size && (snapT -= real) <= 0) {            // enemy snapshot, 12 Hz
        snapT += SNAP_DT; if (snapT < -SNAP_DT) snapT = 0;
        const E = G.enemy, b = E && E.serialize ? safe(() => E.serialize()) : null;
        if (b && b.length) { const w = this.out(0); w.begin(T.ESNAP); w.f32(this.time); w.bytes(b); w.end(); this.stats.snapsOut++; this.stats.snapBytes += b.length + 7; }
      }
      WD.late(dt); SH.late(dt);
    }
    // clock: clients ping the host through the relay; the host pings the relay
    if ((pingT -= real) <= 0) {
      pingT = 1;
      if (!this.isHost) { const w = pingW.reset(); w.u8(255); w.begin(T.PING); w.f64(performance.now()); w.end(); rawBin(w.buf.slice(0, w.o)); }
      else if ((relayPingT -= 1) <= 0) { relayPingT = 2; raw(JSON.stringify({ t: 'ping', s: performance.now() })); }
    }
    flush();
    const st = this.stats, now = performance.now(), ms = now - t0; st.lateMs += (ms - st.lateMs) * 0.05; if (ms > st.lateMax) st.lateMax = ms;
    if (now - secT >= 1000) { const k = 1000 / (now - secT); st.outBps = Math.round((st.bytesOut - secOut) * k); st.inBps = Math.round((st.bytesIn - secIn) * k); secOut = st.bytesOut; secIn = st.bytesIn; secT = now; }
  },
};
const clean = (s) => String(s == null ? 'Pilot' : s).replace(/[^\w \-]/g, '').slice(0, 16) || 'Pilot';

// ---- socket ----------------------------------------------------------------------------
function setStatus(s, err) { net.status = s; net.error = err || ''; bus.emit('net:status', net); }
function connect() {
  if (ws && ws.readyState === 1) return Promise.resolve();
  if (opening) return opening;
  return opening = new Promise((res, rej) => {
    let s;
    try { s = new WebSocket(G.RELAY_URL); } catch (e) { opening = null; rej(e); return; }
    s.binaryType = 'arraybuffer';
    const to = setTimeout(() => { if (s.readyState !== 1) { safe(() => s.close()); } }, 8000);
    s.onopen = () => { clearTimeout(to); ws = s; opening = null; lastReal = performance.now(); if (!pumpId) pumpId = setInterval(pump, 250); res(); };
    s.onerror = () => { if (s !== ws) { clearTimeout(to); opening = null; availAt = performance.now(); availVal = false; rej(new Error('unreachable')); } };
    s.onclose = () => { if (s === ws) { ws = null; inQ.push({ t: 'lost' }); pump(true); } else if (opening) { opening = null; rej(new Error('unreachable')); } };
    s.onmessage = (e) => {
      const d = e.data;
      if (typeof d === 'string') { net.stats.bytesIn += d.length; net.stats.msgsIn++; let m; try { m = JSON.parse(d); } catch (er) { return; } if (m.t === 'pong') { if (net.isHost) net.ping = Math.round(performance.now() - m.s); return; } inQ.push(m); }
      else {
        const b = new Uint8Array(d); net.stats.bytesIn += b.length; net.stats.msgsIn++;
        // answer pings at once so the measured round trip does not include a frame of waiting
        if (b.length === 12 && b[1] === T.PING && net.isHost) { const w = new Uint8Array(12); w.set(b); w[0] = b[0]; w[1] = T.PONG; rawBin(w); return; }
        if (b.length === 12 && b[1] === T.PONG) { net.ping = Math.round(performance.now() - new DataView(b.buffer).getFloat64(4, true)); return; }
        inQ.push(b);
      }
    };
  });
}
function raw(str) { if (ws && ws.readyState === 1) { safe(() => ws.send(str)); net.stats.bytesOut += str.length; net.stats.msgsOut++; msgSec++; } }
function rawBin(b) { if (ws && ws.readyState === 1) { safe(() => ws.send(b)); net.stats.bytesOut += b.length; net.stats.msgsOut++; msgSec++; } }
function sendBin(w) { if (w.o > 1) rawBin(w.buf.slice(0, w.o)); }
function flush() {
  const now = performance.now(); if (now - msgT >= 1000) { msgT = now; msgSec = 0; }
  if (msgSec > 200) return;               // relay limit is 240 messages / s: hold everything for a later frame
  for (const [key, a] of jq) { if (!a.length) continue; const m = { t: 'd', d: a.length === 1 ? a[0] : { k: 'b', a } }; if (key !== '') m.to = key; raw(JSON.stringify(m)); a.length = 0; }
  for (const [to, w] of outs) if (w.o > 1) { sendBin(w); w.reset().u8(to); }
}
function pump(force) {                    // keeps the link alive while the frame loop is paused or the tab is hidden
  if (!ws && !inQ.length) { if (pumpId && net.status === 'offline') { clearInterval(pumpId); pumpId = 0; } return; }
  if (force === true || performance.now() - lastUpd > 400) { if (ws) { net.update(0); net.lateUpdate(0); } else drain(); }
}
function enter(msg) {
  if (net.status === 'playing') return Promise.reject(new Error('in a game'));
  setStatus('connecting');
  return connect().then(() => new Promise((res, rej) => {
    net._wait = { res, rej };
    raw(JSON.stringify(msg));
    setTimeout(() => { if (net._wait && net._wait.res === res) { net._wait = null; setStatus('error', 'The server did not answer.'); rej(new Error(net.error)); } }, 8000);
  }), (e) => { setStatus('error', 'Co-op needs the web version: ' + net.webUrl); throw e; });
}
function goOffline(status, err) {
  const was = net.online;
  enableSim(false);
  PL.reset(); WD.reset(); SH.reset();
  net.peers.clear();
  const s = ws; ws = null; if (s) safe(() => { s.onclose = null; s.close(); });
  outs.clear(); jq.clear(); inQ.length = 0; pendingLate = false;
  net.online = false; net.isHost = true; net.id = 0; net.hostId = 0; net.room = null; net.ready = false; net.ping = 0;
  if (net._wait) { const w = net._wait; net._wait = null; w.rej(new Error(err || 'left')); }
  setStatus(status, err);
  if (was) bus.emit('net:closed', { reason: err || 'left' });
}
function toLobby() { enableSim(false); PL.reset(); WD.reset(); SH.reset(); setStatus('lobby'); }

// ---- playing: taps, puppet mode, module instrumentation ----------------------------------------
function enableSim(on) {
  WD.enable(on);
  const E = G.enemy; if (E && E.setPuppetMode) safe(() => E.setPuppetMode(on && !net.isHost));
  const M = G.mission;
  if (on && !instr.length) {
    // which module is updating right now (tells shared announcements from personal ones, projectile blasts from the rest)
    for (const name of ['player', 'enemy', 'mission', 'combat', 'destruct']) {
      const m = G[name]; if (!m || typeof m.update !== 'function') continue;
      const orig = m.update, stub = name === 'mission' && !net.isHost && !m.applyState;     // FALLBACK: a MISSION without co-op hooks must not run on clients
      const push = name === 'player' && !net.isHost;
      const w = function (dt) { if (stub) return; net.cur = name; if (push) PL.pushBefore(); try { return orig.call(this, dt); } finally { net.cur = ''; if (push) PL.pushAfter(); } };
      m.update = w; instr.push(m, orig, w);
    }
  } else if (!on) { for (let i = 0; i < instr.length; i += 3) if (instr[i].update === instr[i + 2]) instr[i].update = instr[i + 1]; instr.length = 0; net.cur = ''; }
  if (!on && M && M.setRemote) safe(() => M.setRemote(false));
}
function begin(seed, mode) {
  const st = S();
  if (mode) st.mode = mode;
  net.seedMismatch = false;
  if ((seed >>> 0) !== (st.seed >>> 0)) {            // another city: regenerate (modules that cached the old one may lag; chunk healing covers the voxels)
    st.seed = seed >>> 0; net.seedMismatch = true;
    safe(() => { const C = G.city; if (C.generate) C.generate(st.seed); else C.init(); if (!G.grid.pristine) G.grid.snapshot(); G.grid.markAllDirty(); });
  }
  net.status = 'playing';
  enableSim(true);
  starting = true;
  bus.emit('net:status', net);
  bus.emit('net:start', { seed, mode: st.mode, host: net.isHost });
  try { bus.emit(st.phase === 'title' ? 'ui:start' : 'ui:restart'); } finally { starting = false; }
  WD.heatAll(); snapT = 0;
}
function spreadSpawn() {                  // everyone spawns on the same marker: fan out by peer id
  const p = S().player.pilot; if (!p || !p.pos) return;
  const ids = [net.id, ...net.peers.keys()].sort((a, b) => a - b), i = ids.indexOf(net.id), a = i * 1.5708 + 0.6;
  if (ids.length < 2) return;
  p.pos.x += Math.sin(a) * 2.4; p.pos.z += Math.cos(a) * 2.4;
  safe(() => G.grid.unstick(p, 8));
}

// ---- incoming ----------------------------------------------------------------------------
function drain() {
  pendSnap = null;
  for (let i = 0; i < inQ.length; i++) {
    const m = inQ[i];
    try { if (m instanceof Uint8Array) onBinary(m); else onControl(m); } catch (e) { if (G.debug) console.warn('net message', e); }
    if (!ws && net.status === 'offline') break;
  }
  inQ.length = 0;
  // enemy snapshots: only the newest of a batch is applied (after a stall, e.g. a hidden tab, there can be dozens)
  if (pendSnap && net.status === 'playing') { const E = G.enemy, b = pendSnap, t = pendSnapT; if (E && E.applySnapshot) safe(() => E.applySnapshot(b, t)); }
  pendSnap = null;
}
function addPeer(id, name) { if (id === net.id || net.peers.has(id)) return; const p = PL.makePeer(id, name); net.peers.set(id, p); bus.emit('net:peer+', p); }
function onControl(m) {
  switch (m.t) {
    case 'room': {
      net.online = true; net.room = m.code; net.id = m.id; net.isHost = !!m.host; net.hostId = m.hostId; net.peers.clear(); net.ready = false;
      for (const p of m.peers || []) addPeer(p.id, p.name);
      setStatus('lobby');
      net.sendJ({ k: 'hi', name: net.myName, ready: net.ready });
      if (net._wait) { const w = net._wait; net._wait = null; w.res(m.code); }
      break;
    }
    case 'peer+':
      addPeer(m.id, m.name); net.sendJ({ k: 'hi', name: net.myName, ready: net.ready }, m.id);
      if (net.isHost && net.status === 'playing') net.sendJ({ k: 'busy' }, m.id);
      bus.emit('net:status', net);
      break;
    case 'peer-': {
      const p = net.peers.get(m.id); if (!p) break;
      PL.disposePeer(p); net.peers.delete(m.id); bus.emit('net:peer-', p);
      if (net.status === 'playing') bus.emit('ui:message', { text: p.name.toUpperCase() + ' LEFT', sub: '', kind: 'info', dur: 3 });
      bus.emit('net:status', net);
      break;
    }
    case 'closed': case 'lost': {
      if (!net.online && net.status !== 'connecting') break;
      const playing = net.status === 'playing', reason = m.t === 'closed' ? 'The host left the game.' : 'Connection lost.';
      goOffline('error', reason);
      if (playing) { if (S().phase !== 'title') bus.emit('ui:title'); bus.emit('ui:message', { text: 'CO-OP ENDED', sub: reason, kind: 'warn', dur: 5 }); }
      break;
    }
    case 'error': {
      const err = m.error || 'Server error.';
      if (net._wait) { const w = net._wait; net._wait = null; setStatus('error', err); w.rej(new Error(err)); } else { net.error = err; bus.emit('net:status', net); }
      break;
    }
    case 'd': if (m.d && m.d.k === 'b') { for (const d of m.d.a) onData(m.from, d); } else if (m.d) onData(m.from, m.d); break;
  }
}
function onData(from, d) {
  const p = net.peers.get(from);
  switch (d.k) {
    case 'hi': if (p) { if (d.name) p.name = clean(d.name); p.ready = !!d.ready; bus.emit('net:status', net); } break;
    case 'start': if (from === net.hostId && !net.isHost) { byHost = true; try { begin(d.seed, d.mode); } finally { byHost = false; } } break;
    case 'lobby': if (from === net.hostId && net.status === 'playing') { toLobby(); byHost = true; try { if (S().phase !== 'title') bus.emit('ui:title'); } finally { byHost = false; } } break;
    case 'busy': if (from === net.hostId && net.status === 'lobby') { net.leave(); setStatus('error', 'That game has already started.'); } break;
    case 'pl': if (p) PL.onLoadout(p, d); break;
    case 'pev': if (p) PL.onEvents(p, d.e); break;
    case 'ev': if (from === net.hostId) SH.onEvent(d); break;
    case 'ms': if (from === net.hostId) SH.onMission(d); break;
    case 'over': if (from === net.hostId) SH.onOver(d); break;
    case 'reviveAll': if (from === net.hostId) PL.reviveLocal(); break;
    case 'cmd': if (net.isHost && p && net.status === 'playing') PL.hostCmd(d.id, d.c, d.a, p.ent); break;
    case 'x': { const a = handlers.get(d.t); if (a) for (const fn of a) safe(() => fn(d.d, from)); break; }
  }
}
function onBinary(b) {
  const from = b[0], p = net.peers.get(from), r = rd;
  let o = 1;
  while (o + 3 <= b.length) {
    const type = b[o], len = b[o + 1] | (b[o + 2] << 8); o += 3;
    if (o + len > b.length) break;
    r.set(b, o, len);
    switch (type) {
      case T.PSTATE: if (p && net.status === 'playing') PL.onState(p, r); break;
      case T.SHOT: case T.BEAM: PL.onShotMsg(r); break;
      case T.ESNAP: if (from === net.hostId && !net.isHost && net.status === 'playing') { pendSnapT = r.f32(); pendSnap = b.subarray(r.o, o + len); net.stats.snapsIn++; } break;
      case T.OPS: WD.onOps(r); break;
      case T.CHK: if (from === net.hostId) WD.onChk(r); break;
      case T.FIRES: if (from === net.hostId) WD.onFires(r, len); break;
      case T.CHREQ: if (net.isHost) WD.onReq(from, r); break;
      case T.CHUNK: if (from === net.hostId) WD.onChunk(r, len); break;
      case T.CLAIM: PL.onClaim(from, r); break;
      case T.EDEATH: if (from === net.hostId) PL.onDeathMsg(r); break;
      case T.WAVE: if (from === net.hostId) SH.onWave(r); break;
    }
    o += len;
  }
}
export default net;
