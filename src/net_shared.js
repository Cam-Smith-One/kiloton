// ============================================================================
// KILOTON — net_shared.js   OWNER: NET
// Host-owned shared state: wave counters, mission objectives, announcements and
// the bus events other peers need; game over / won; revive-all; enemy commands.
// ============================================================================
import { G, bus } from './core.js';
import { T } from './net_wire.js';
import { entById, localDown, reviveLocal } from './net_players.js';

// bus events the host forwards (payload entities travel as net ids)
const RELAY = ['wave:start', 'wave:clear', 'ui:message', 'objective:new', 'objective:update', 'objective:done', 'mission:stage', 'mission:won', 'mission:failed',
  'game:won', 'boss:spawn', 'boss:phase', 'boss:dead', 'mech:incoming', 'mech:land', 'ace:called', 'rig:disabled', 'weapon:tell'];
let N = null, relaying = false, waveT = 0, misT = 0, overT = 0, overSent = false, lastMis = '';
const updT = new Map();
const safe = (fn) => { try { return fn(); } catch (e) { if (G.debug) console.warn('net', e); return undefined; } };
const isEnt = (v) => v && typeof v === 'object' && v.pos && v.pos.isVector3;

function enc(v, depth) {
  if (v == null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'function') return undefined;
  if (isEnt(v)) return { $e: v.netId || 0 };
  if (depth > 2) return undefined;
  if (Array.isArray(v)) return v.map(q => enc(q, depth + 1));
  if (v.isVector3) return { x: v.x, y: v.y, z: v.z };
  const o = {};
  for (const k in v) { if (k[0] === '_') continue; const q = enc(v[k], depth + 1); if (q !== undefined) o[k] = q; }
  return o;
}
function dec(v) {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(dec);
  if ('$e' in v) return entById(v.$e);
  for (const k in v) v[k] = dec(v[k]);
  return v;
}

export function init(net) {
  N = net;
  for (const type of RELAY) bus.on(type, (d) => {
    if (relaying || !N.online || !N.isHost || N.status !== 'playing') return;
    if (d && d.remote) return;
    if ((type.startsWith('objective:') || type.startsWith('mission:')) && G.mission && G.mission.serialize) return;   // MISSION's applyState emits these itself
    if (type === 'ui:message' && N.cur !== 'enemy' && N.cur !== 'mission') return;      // PLAYER / UI messages are personal
    if ((type === 'mech:incoming' || type === 'mech:land') && d && d.team !== 1) return;  // players' rigs travel with their owner's events
    if (type === 'objective:update') { const id = d && d.objective && d.objective.id, t = updT.get(id) || -9; if (N.time - t < 0.25) return; updT.set(id, N.time); }
    N.sendJ({ k: 'ev', t: type, d: enc(d, 0) });
    if (type === 'wave:start' || type === 'mission:stage') { N.sendJ({ k: 'reviveAll' }); reviveLocal(); }
    if (type === 'wave:start' || type === 'wave:clear') waveT = 0;
  });
  // the host ending the run (everyone down, or the mission failed) ends it for everyone
  bus.on('game:over', (d) => { if (N.online && N.isHost && N.status === 'playing' && !overSent) { overSent = true; N.sendJ({ k: 'over', cause: (d && d.cause) || 'squad' }); } });
}
export function reset() { waveT = 0; misT = 0; overT = 0; overSent = false; lastMis = ''; updT.clear(); }

// ---- incoming ---------------------------------------------------------------------------
export function onEvent(m) {
  if (N.isHost || N.status !== 'playing') return;
  const d = dec(m.d) || {};
  if (m.t === 'objective:new' || m.t === 'objective:update' || m.t === 'objective:done') { const o = d.objective && mergeObjective(d.objective); if (o) d.objective = o; }
  relaying = true;
  try { bus.emit(m.t, d); } finally { relaying = false; }
}
export function onWave(r) {
  const W = G.state.wave, n = r.u16(), alive = r.u16(), total = r.u16(), em = r.u8(), inter = r.f32();
  if (N.isHost || N.status !== 'playing') return;
  W.n = n; W.alive = alive; W.total = total; W.enemyMechs = em; W.intermission = inter; if (n > (W.bestWave || 0)) W.bestWave = n;
}
export function onOver(m) {
  if (N.isHost || G.state.phase !== 'playing') return;
  const P = G.player;
  if (P && P.allDown) safe(() => P.allDown(m.cause || 'squad')); else bus.emit('player:dead', { cause: m.cause || 'squad' });
}
function mergeObjective(src) {            // keep object identity so the HUD's references stay valid
  const M = G.mission; if (!M || !M.objectives || src.id == null) return src;
  let o = M.objectives.find(q => q.id === src.id);
  if (!o) { o = {}; M.objectives.push(o); }
  return Object.assign(o, src);
}
export function onMission(m) {
  const M = G.mission; if (N.isHost || !M || N.status !== 'playing') return;
  if (M.applyState) { safe(() => M.applyState(m.s)); return; }
  // FALLBACK (MISSION without applyState): mirror the plain fields the HUD reads
  const s = m.s || {};
  M.active = !!s.active; M.stage = s.stage || 0; M.won = !!s.won; M.failed = !!s.failed;
  if (M.objectives && s.objectives) { for (let i = M.objectives.length - 1; i >= 0; i--) if (!s.objectives.some(q => q.id === M.objectives[i].id)) M.objectives.splice(i, 1); for (const o of s.objectives) mergeObjective(o); }
  if (M.markers && s.markers) { M.markers.length = 0; for (const k of s.markers) { k.ent = k.ent ? entById(k.ent) : null; M.markers.push(k); } }
}
function missionState() {
  const M = G.mission; if (!M) return null;
  if (M.serialize) return safe(() => M.serialize());
  if (!M.objectives) return null;         // FALLBACK (MISSION without serialize)
  return { active: !!M.active, stage: M.stage || 0, won: !!M.won, failed: !!M.failed,
    objectives: M.objectives.map(o => { const q = enc(o, 1); return q; }),
    markers: (M.markers || []).map(k => ({ id: k.id, kind: k.kind, label: k.label, x: k.x, y: k.y, z: k.z, active: k.active, ent: k.ent && k.ent.netId || 0 })) };
}

// ---- per frame ---------------------------------------------------------------------------
export function update(dt) {
  if (!N.isHost) { const W = G.state.wave; if (W.intermission > 0) W.intermission = Math.max(0, W.intermission - dt); }
}
export function late(dt) {
  if (!N.isHost) return;
  const real = dt > 0 ? dt : N.idleDt;
  if ((waveT -= real) <= 0) {
    waveT = 0.25;
    const W = G.state.wave, w = N.out(0);
    w.begin(T.WAVE); w.u16(W.n || 0); w.u16(W.alive || 0); w.u16(W.total || 0); w.u8(Math.min(255, W.enemyMechs || 0)); w.f32(W.intermission || 0); w.end();
  }
  if ((misT -= real) <= 0) {
    misT = 0.33;
    const s = missionState();
    if (s) { const js = JSON.stringify(s); if (js !== lastMis || (N.frameN & 15) === 0) { lastMis = js; if (js.length < 60000) N.sendJ({ k: 'ms', s }); } }
  }
  // everyone down -> the run is over for everyone
  if (G.state.phase === 'playing' && !overSent) {
    let all = localDown(), any = false;
    for (const p of N.peers.values()) { if (!p.seen) continue; any = true; if (!p.down) all = false; }
    if (all && (any || N.peers.size === 0)) { if ((overT += real) > 0.6) { overSent = true; N.sendJ({ k: 'over', cause: 'squad' }); const P = G.player; if (P && P.allDown) safe(() => P.allDown('squad')); else bus.emit('player:dead', { cause: 'squad' }); } }
    else overT = 0;
  }
}
