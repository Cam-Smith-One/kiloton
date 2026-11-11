// ============================================================================
// KILOTON — mission.js   OWNER: MISSION.   G.mission
// Mission director. Operation "Blackout" (CONTRACT-C C2): four escalating
// stages in Halden Yard with a win state, plus a light bonus objective in
// survival mode. See notes/mission.md.
//   G.mission = { active, stage, objectives[], markers[], start(), reset(), update(dt), fail(reason),
//                 relay, core, boss (entities, or null), TUNE, stats, debug }
// Runs only when G.state.mode === 'operation' (or ?mode=operation). Everything
// hostile is spawned through G.enemy; set pieces are voxels (mission_build.js).
// ============================================================================
import { G, THREE, bus, clamp, VS, WX, WZ, GROUND_Y } from './core.js';
import { buildPylon, buildRelayPad, buildCitadel, buildNest, sampleBuilding, recount } from './mission_build.js';
import { makeRelay, makeCore, makeBeam } from './mission_props.js';

export const TUNE = {
  liveCap: 22,                  // most Vanta units alive at once (queued groups wait for room)
  introLull: 5, outroLull: 9,   // s of quiet before a stage's objective goes live / after it completes
  // stage 1
  pylonKill: 0.55,              // a pylon is down when this share of its tracked voxels is gone
  guardRange: 78,               // a pylon's garrison deploys when the pilot comes this close (or the previous one falls)
  s1Trickle: [34, 27, 21],      // s between reinforcement squads with 0 / 1 / 2 pylons down
  s1Cap: 15,
  // stage 2
  relayHp: 4200, relayTime: 150,
  // stage 3
  coreHp: 2600, coreVoxKill: 0.6, plateH: 19, turretHp: 0 /* 0 = ENEMY default */, s3Trickle: 30, s3Cap: 18, gunshipEvery: 50, gunshipMax: 5,
  // stage 4
  bossHp: 9000, s4Escort: 38, s4Cap: 8,
  // salvage
  pay: { pylon: 60, stage1: 200, stage2: 250, stage3: 300, win: 600, bonus: 250 },
  // survival bonus objective
  bonusWave: 2, bonusKill: 0.6,
};
const TITLES = [null,
  ['Cut the signal', 'Three Vanta jammer pylons are blinding the district. Bring them all down.'],
  ['Hold the relay', 'The uplink is live on the plaza. Vanta wants it dark. Keep it alive.'],
  ['Breach the citadel', 'The command core is mid-height in the armoured tower. Cut your way in or drop the building.'],
  ['Dreadnought', 'Vanta command has dropped its flagship. Break it.']];
const GREEK = ['Alpha', 'Bravo', 'Cinder'];

// ---- runtime state ---------------------------------------------------------------
let pending = false, startStage = 1;
let phase = '';                 // 'intro' | 'run' | 'outro'
let phT = 0, stT = 0, opT = 0, tick = 0, tickN = 0, netRelay = 1, asClient = false;
let pylons = [], pad = null, cit = null, bonus = null;
let relayEnt = null, relayProp = null, coreEnt = null, coreProp = null, bossU = null;
let beams = [], relayBeam = null, citBeam = null;
let builds = [], dones = [], netStage = 0, netSeen = 0, netEnd = '', winStats = null;
const netBeams = new Map();
const queue = [];               // pending spawn groups { list, x, z, opts, air }
const says = [];                // timed radio lines { t, text, sub, kind, dur }
const script = [];              // stage events { t, fn }
let scriptI = 0, trickleT = 0, gunT = 0, gunN = 0, escortT = 0, siegeT = 0, queueT = 0, lastTimer = -1, bossPh = 1, edgeT = null, dirBase = 0;
const _o = new THREE.Vector3(), _d = new THREE.Vector3();
const stats = { ms: 0, peakMs: 0, kills: 0, spawned: 0, stageTimes: [0, 0, 0, 0, 0], buildMs: 0, time: 0 };

const SP = () => G.state.player;
function playerEnt() { const L = G.ents.players ? G.ents.players() : null; if (L && L.length) return L[0]; const p = SP(); return p.ent && p.ent.alive ? p.ent : p.pilot && p.pilot.alive ? p.pilot : null; }
/** distance from (x,z) to the nearest player (co-op: every peer's pilot or rig) */
function pd(x, z) { const L = G.ents.players ? G.ents.players() : null; if (!L || !L.length) return Math.hypot(x - px(), z - pz()); let d = 1e9; for (let n = 0; n < L.length; n++) { const q = Math.hypot(x - L[n].pos.x, z - L[n].pos.z); if (q < d) d = q; } return d; }
const isClient = () => !!(G.net && G.net.online && !G.net.isHost);
function px() { const e = playerEnt(); return e ? e.pos.x : G.city.spawns.player.x; }
function pz() { const e = playerEnt(); return e ? e.pos.z : G.city.spawns.player.z; }
const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const hasC3 = () => typeof G.enemy.spawnGroup === 'function';
const live = () => (G.enemy.list ? G.enemy.list.length : 0);
function msg(text, sub, kind, dur) { bus.emit('ui:message', { text, sub, kind: kind || 'info', dur: dur || 4.5 }); }
function say(delay, text, sub, kind, dur) { says.push({ t: opT + delay, text, sub, kind, dur }); }

// ---- objectives --------------------------------------------------------------------
function objective(id, text, sub, kind, x, y, z) {
  const o = { id, text, sub: sub || '', kind, progress: 0, count: 0, total: 0, timer: null, done: false, failed: false, x: x == null ? null : x, y: y == null ? null : y, z: z == null ? null : z, ent: null, optional: false, _p: 0 };
  mission.objectives.push(o); bus.emit('objective:new', { objective: o }); return o;
}
function touch(o) { o._p = o.progress; bus.emit('objective:update', { objective: o }); }
function setProgress(o, p) { p = clamp(p, 0, 1); o.progress = p; if (Math.abs(p - o._p) >= 0.01 || (p === 1 && o._p !== 1)) touch(o); }
function marker(id, kind, label, x, y, z, ent) { const m = { id, kind, label, x, y, z, ent: ent || null, active: true }; mission.markers.push(m); return m; }
function dropMarker(id) { const M = mission.markers; for (let n = M.length - 1; n >= 0; n--) if (M[n].id === id) M.splice(n, 1); }
function compass(b) { return ['south', 'south-east', 'east', 'north-east', 'north', 'north-west', 'west', 'south-west'][((Math.round(b / (Math.PI / 4)) % 8) + 8) % 8]; }     // bearing: atan2(dx, dz), +z is south
function where(x, z) {
  const c = G.city.plaza || { x: WX / 2, z: WZ / 2 }, dx = x - c.x, dz = z - c.z;
  if (Math.hypot(dx, dz) < 14) return 'central plaza';
  const ns = dz < -12 ? 'north' : dz > 12 ? 'south' : '', ew = dx < -12 ? 'west' : dx > 12 ? 'east' : '';
  return (ns && ew ? ns + '-' + ew : ns || ew) + ' of the plaza';
}

// ---- spawning ------------------------------------------------------------------------
// Everything goes through G.enemy. spawnGroup / opts.target / opts.hold / 'turret' / 'dreadnought' are used when
// ENEMY has them; otherwise plain spawn() in a loop (see notes: fallbacks).
function spawnList(list, x, z, opts) {
  const E = G.enemy; let out = null;
  try {
    if (hasC3()) out = E.spawnGroup(list, x, z, opts || {});
    else {
      out = []; let gi = 0;
      for (const it of list) {
        let kind = typeof it === 'string' ? it : it.kind; const o = Object.assign({}, opts, typeof it === 'object' ? it : null);
        if (kind.indexOf(':') > 0) { const q = kind.split(':'); kind = q[0]; o.variant = q[1]; }
        if (kind === 'turret') { kind = 'rocketeer'; }                                    // no emplacements yet: a rocketeer on the roof
        if (kind === 'dreadnought') { kind = 'emech'; o.variant = 'heavy'; }
        const air = kind === 'drone' || kind === 'gunship', a = gi * 2.4, r = air ? 5 : kind === 'tank' || kind === 'emech' || kind === 'heavy' ? 5 + gi * 2 : 1.2 + gi * 0.7; gi++;
        if (air && o.y == null) o.y = GROUND_Y + (kind === 'drone' ? 16 : 34);
        const u = E.spawn(kind, clamp(x + Math.sin(a) * r, 3, WX - 3), clamp(z + Math.cos(a) * r, 3, WZ - 3), o);
        if (u) out.push(u);
      }
    }
  } catch (e) { console.error('mission: spawn failed', e); }
  if (out) stats.spawned += out.length;
  return out || [];
}
function enqueue(list, x, z, opts) { queue.push({ list, x, z, opts: opts || null }); }
/** A street mouth on the map edge: away from the pilot, towards `bearing` from (tx,tz) if given, not reused at once. */
function pickEdge(tx, tz, bearing) {
  const E = G.city.spawns.edge, ax = px(), az = pz();
  if (!edgeT || edgeT.length !== E.length) edgeT = new Float32Array(E.length).fill(-99);
  let best = 0, bs = 1e9;
  for (let n = 0; n < E.length; n++) {
    const e = E[n], dp = pd(e.x, e.z);
    let s = dp < 40 ? 500 : 0;
    if (bearing != null) { let da = Math.abs(Math.atan2(e.x - tx, e.z - tz) - bearing) % (Math.PI * 2); if (da > Math.PI) da = Math.PI * 2 - da; s += da * 70; }
    else s += hyp(e.x, e.z, tx, tz) * 0.6;
    if (opT - edgeT[n] < 25) s += 60;
    s += G.rand() * 22;
    if (s < bs) { bs = s; best = n; }
  }
  edgeT[best] = opT; return E[best];
}
function pickAir(tx, tz) {
  const A = G.city.spawns.air, ax = px(), az = pz(); let best = A[0], bs = 1e9;
  for (const a of A) { const s = (pd(a.x, a.z) < 60 ? 300 : 0) + hyp(a.x, a.z, tx, tz) * 0.3 + G.rand() * 60; if (s < bs) { bs = s; best = a; } }
  return best;
}
/** A clear rig landing zone rMin..rMax from (tx,tz), not on top of the pilot or a set piece. */
function pickDrop(tx, tz, rMin, rMax) {
  const D = G.city.spawns.mechDrops, ax = px(), az = pz(); let best = null, bs = 1e9;
  for (const d of D) {
    const r = hyp(d.x, d.z, tx, tz); if (r < rMin) continue;
    if (pad && hyp(d.x, d.z, pad.x, pad.z) < 12) continue;
    let bad = false; for (const p of pylons) if (hyp(d.x, d.z, p.s.x, p.s.z) < 8 && !p.o.done) bad = true; if (bad) continue;
    const s = (r > rMax ? (r - rMax) * 3 : 0) + (pd(d.x, d.z) < 24 ? 200 : 0) + G.rand() * 15;
    if (s < bs) { bs = s; best = d; }
  }
  return best || { x: clamp(tx + rMin, 8, WX - 8), z: clamp(tz, 8, WZ - 8) };
}
function wave(list, tx, tz, bearing, opts) { const e = pickEdge(tx, tz, bearing); enqueue(list, e.x, e.z, opts); }
function airWave(list, tx, tz, opts) { const a = pickAir(tx, tz); enqueue(list, a.x, a.z, Object.assign({ y: a.y }, opts)); }
function fillMeter() {
  const p = SP(); if (p.mech || p.mechIncoming > 0 || p.mechReady) return;
  try { if (G.player.debug && G.player.debug.fillMeter) G.player.debug.fillMeter(); else if (G.player.fillMeter) G.player.fillMeter(); else { p.meter = 1; p.mechReady = true; bus.emit('meter:ready', {}); } } catch (e) {}
}
function at(t, fn) { script.push({ t, fn }); }
function clearScript() { script.length = 0; scriptI = 0; }

// ---- set pieces -----------------------------------------------------------------------
function pickPylonSites() {
  const C = G.city, sp = C.spawns.player, pl = C.plaza || { x: WX / 2, z: WZ / 2 };
  let cand = (C.sites && C.sites.length ? C.sites.filter(s => s.kind !== 'plaza') : C.spawns.mechDrops).filter(s => s.x > 20 && s.z > 20 && s.x < WX - 20 && s.z < WZ - 20);
  cand = cand.filter(s => hyp(s.x, s.z, pl.x, pl.z) > 26 && hyp(s.x, s.z, sp.x, sp.z) > 38);
  if (cand.length < 3) cand = C.spawns.mechDrops.filter(s => hyp(s.x, s.z, pl.x, pl.z) > 20 && hyp(s.x, s.z, sp.x, sp.z) > 25);
  // greedy spread: first the candidate nearest the pilot, then always the one farthest from those chosen
  const out = []; cand = cand.slice();
  cand.sort((a, b) => hyp(a.x, a.z, sp.x, sp.z) - hyp(b.x, b.z, sp.x, sp.z));
  if (cand.length) out.push(cand.shift());
  while (out.length < 3 && cand.length) {
    let bi = 0, bd = -1;
    for (let n = 0; n < cand.length; n++) { let d = 1e9; for (const o of out) d = Math.min(d, hyp(cand[n].x, cand[n].z, o.x, o.z)); if (d > bd) { bd = d; bi = n; } }
    out.push(cand.splice(bi, 1)[0]);
  }
  // visit order: a chain starting with the nearest (so the tank waits at the last one)
  if (out.length === 3 && hyp(out[0].x, out[0].z, out[2].x, out[2].z) < hyp(out[0].x, out[0].z, out[1].x, out[1].z)) { const t = out[1]; out[1] = out[2]; out[2] = t; }
  return out;
}
function pickCitadel() {
  const C = G.city, B = C.buildings;
  if (C.citadel != null && C.citadel >= 0 && B[C.citadel]) return B[C.citadel];
  let best = null; const sp = C.spawns.player;
  for (const b of B) if ((b.kind === 'office' || b.kind === 'hotel') && hyp((b.i0 + b.i1) * 0.25, (b.k0 + b.k1) * 0.25, sp.x, sp.z) > 30 && (!best || b.j1 > best.j1)) best = b;
  return best;
}
function addBeam(x, y, z, team, h) { if (G.params.has('nobeam')) return null; const b = makeBeam(team, h); b.position.set(x, y + h / 2, z); G.scene.add(b); beams.push(b); return b; }
function killBeam(b) { if (!b) return; b.removeFromParent(); if (b.material) b.material.dispose(); const i = beams.indexOf(b); if (i >= 0) beams.splice(i, 1); }

// Every structure is built from a small descriptor so a co-op client can replay it (applyState) and get the same voxels:
//   { type:'pylon', site, x, z } | { type:'relay', x, z } | { type:'citadel', id } | { type:'nest', x, y, z }
// Builders are pure functions of (descriptor, city, grid): no RNG. `own` = this peer runs the mission (creates entities).
function doBuild(d, own) {
  builds.push(d);
  if (d.type === 'pylon') { const st = buildPylon(d.x, d.z, d.site); pylons.push({ s: st, o: null, guards: d.site === 0 ? 1 : 0, beam: null, n: d.site }); }
  else if (d.type === 'relay') {
    pad = buildRelayPad(d.x, d.z);
    relayProp = makeRelay();
    const ry = G.grid.topBelow(pad.x, GROUND_Y + 3, pad.z);
    relayProp.root.position.set(pad.x, ry, pad.z); G.scene.add(relayProp.root);
    relayEnt = G.ents.add({ kind: 'prop', variant: 'relay', team: 0, name: 'Uplink relay', netId: 'm:relay', remote: !own, pos: new THREE.Vector3(pad.x, ry, pad.z), radius: relayProp.radius, height: relayProp.height * 0.8, hp: TUNE.relayHp, maxHp: TUNE.relayHp, invuln: true, relay: true,
      onDamage(a, info) { if (info && info.src && info.src.team === 0) return 0; if (relayProp && a > 15) relayProp.hit(); return a; },
      onDeath() { if (!this.remote) relayLost(); } });
  } else if (d.type === 'citadel') {
    const b = G.city.buildings[d.id]; cit = b ? buildCitadel(b, TUNE.plateH) : null;
    if (cit) {
      coreProp = makeCore(); coreProp.root.position.set(cit.cx, cit.cy + 0.5, cit.cz); G.scene.add(coreProp.root);
      coreEnt = G.ents.add({ kind: 'prop', variant: 'core', team: 1, name: 'Command core', netId: 'm:core', remote: !own, pos: new THREE.Vector3(cit.cx, cit.cy + 0.5, cit.cz), radius: 1.35, height: 2.6, hp: TUNE.coreHp, maxHp: TUNE.coreHp, invuln: true, noHit: true, core: true });
    }
  } else if (d.type === 'nest') buildNest(d.x, d.y, d.z);
}
function buildWorld(fromStage) {
  const t0 = performance.now(), C = G.city, pl = C.plaza || { x: WX / 2, z: WZ / 2 };
  if (fromStage <= 1) pickPylonSites().forEach((s, n) => doBuild({ type: 'pylon', site: n, x: s.x, z: s.z }, true));
  doBuild({ type: 'relay', x: pl.x, z: pl.z }, true);
  const b = pickCitadel(); if (b) doBuild({ type: 'citadel', id: b.id }, true);
  stats.voxMs = stats.buildMs = performance.now() - t0;
}

// ---- stage flow -----------------------------------------------------------------------
function enterStage(n) {
  mission.stage = n; phase = 'intro'; phT = 0; stT = 0; clearScript(); trickleT = 0; lastTimer = -1;
  const T = TITLES[n];
  bus.emit('mission:stage', { n, title: T[0], text: T[1], of: 4 });
  if (n > 1 || startStage > 1) { fillMeter(); bus.emit('mission:refill', { stage: n }); }
  if (n === 1) {
    say(1.2, 'Operation Blackout', 'Pilot on the ground. Jammers first: hit the footings or the fuel cell beside them.', 'info', 6);
    pylons.forEach((p, i) => { p.o = objective('jammer' + i, 'Destroy jammer ' + GREEK[i], where(p.s.x, p.s.z), 'destroy', p.s.x, p.s.y, p.s.z); p.beam = addBeam(p.s.x, GROUND_Y + 18, p.s.z, 1, 60); marker('jammer' + i, 'jammer', GREEK[i], p.s.x, p.s.y, p.s.z); });
    if (!pylons.length) { phase = 'run'; completeStage(); }
  } else if (n === 2) {
    say(1.5, 'Signal restored', 'Rig drop authorised. Get to the plaza: Vanta is coming for the relay.', 'good', 6);
  } else if (n === 3) {
    say(1.5, 'Relay holding', 'We have their command post. The glowing floor is the core. Watch the roof guns.', 'info', 6);
  } else if (n === 4) {
    say(1.0, 'Seismic contact', 'Something very large is inbound. All of it is hostile.', 'warn', 6);
  }
}
function goLive() {
  phase = 'run'; stT = 0; const n = mission.stage;
  if (n === 1) { deployGuards(0); }
  else if (n === 2) startRelay();
  else if (n === 3) startCitadel();
  else if (n === 4) startBoss();
}
function completeStage() {
  const n = mission.stage, o = { id: 's' + n, text: TITLES[n][0], sub: 'Stage ' + n + ' complete', kind: 'survive', progress: 1, count: 1, total: 1, timer: null, done: true, failed: false, x: null, y: null, z: null };
  stats.stageTimes[n] = +(opT - (stats.stageTimes[0] || 0)).toFixed(1); stats.stageTimes[0] = opT;
  if (n === 4) return win();
  dones.push({ id: o.id, text: o.text, sub: o.sub, salvage: TUNE.pay['stage' + n] || 150 });
  bus.emit('objective:done', { objective: o, salvage: TUNE.pay['stage' + n] || 150 });      // progress.js: salvage + perk offer
  phase = 'outro'; phT = 0; clearScript(); queue.length = 0;
}
function nextStage() {
  // drop finished objective rows and their markers before the next briefing
  for (let i = mission.objectives.length - 1; i >= 0; i--) if (mission.objectives[i].done && !mission.objectives[i].optional) mission.objectives.splice(i, 1);
  enterStage(mission.stage + 1);
}

// ---- stage 1: jammers -----------------------------------------------------------------
function deployGuards(i) {
  const p = pylons[i]; if (!p || p.guards === 2) return; p.guards = 2;
  const x = p.s.x, z = p.s.z, ax = px(), az = pz(), d = Math.max(1, hyp(x, z, ax, az)), ox = (x - ax) / d, oz = (z - az) / d;
  const squads = [['rifle', 'rifle', 'rifle', 'rocketeer'], ['rifle', 'rifle', 'rifle', 'rifle', 'rocketeer', 'rocketeer'], ['rifle', 'rifle', 'rifle', 'rifle', 'rocketeer', 'rocketeer']];
  // inside the ring, on the far side from the pilot
  enqueue(squads[Math.min(i, 2)], x + ox * 3.5, z + oz * 3.5, { hold: 11 });
  if (i >= 1) enqueue(['rifle', 'rifle'], x - oz * 9, z + ox * 9, { hold: 14 });
  if (i >= 2) { enqueue(['tank'], x + ox * 12, z + oz * 12, { hold: 22 }); say(0.5, 'Armour at jammer ' + GREEK[i], 'A Vanta tank is parked on the last pylon. Rockets, or drop a wall on it.', 'warn', 5); }
}
function pylonDown(p) {
  const s = p.s; p.o.done = true; p.o.progress = 1; touch(p.o);
  killBeam(p.beam); p.beam = null; dropMarker(p.o.id);
  if (s.left > 30) { G.boom(s.x, GROUND_Y + 4, s.z, { radius: 4.5, power: 300, damage: 40, kind: 'mech' }); G.boom(s.x, GROUND_Y + 10.5, s.z, { radius: 4.5, power: 300, damage: 20, kind: 'mech' }); }
  let left = 0; for (const q of pylons) if (!q.o.done) left++;
  try { G.progress.award(TUNE.pay.pylon, 'jammer'); } catch (e) {}
  msg('Jammer ' + GREEK[p.n] + ' down', left ? left + ' still transmitting' : 'The district can hear us again', 'good', 4);
  bus.emit('shake', { amount: 0.5, x: s.x, y: s.y, z: s.z });
  if (!left) completeStage(); else { const nx = pylons.find(q => !q.o.done && q.guards === 0); if (nx) deployGuards(nx.n); trickleT = Math.min(trickleT, 8); }
}
function tickStage1(dt) {
  // one pylon recount per tick (4 Hz), round robin
  const p = pylons[tickN % pylons.length];
  if (p && !p.o.done) { const f = recount(p.s); setProgress(p.o, f / TUNE.pylonKill); if (f >= TUNE.pylonKill) { pylonDown(p); if (phase !== 'run') return; } }
  let down = 0, nearest = null, nd = 1e9; const ax = px(), az = pz();
  for (const q of pylons) { if (q.o.done) { down++; continue; } const d = pd(q.s.x, q.s.z); if (d < nd) { nd = d; nearest = q; } if (q.guards === 0 && d < TUNE.guardRange) deployGuards(q.n); }
  trickleT -= dt;
  if (trickleT <= 0 && nearest) {
    trickleT = TUNE.s1Trickle[Math.min(2, down)] * (0.85 + G.rand() * 0.3);
    if (stT > 20 && live() + queueCount() < TUNE.s1Cap) {
      const list = down === 0 ? ['rifle', 'rifle', 'rifle'] : down === 1 ? ['rifle', 'rifle', 'rifle', 'rocketeer'] : ['rifle', 'rifle', 'rocketeer', 'rocketeer'];
      wave(list, nearest.s.x, nearest.s.z, null);
      if (down >= 1 && G.rand() < 0.6) airWave(['drone', 'drone'], ax, az);
    }
  }
}
function queueCount() { let n = 0; for (const q of queue) n += q.list.length; return n; }

// ---- stage 2: relay ---------------------------------------------------------------------
function startRelay() {
  const r = relayEnt; if (!r || !r.alive) { fail('The relay was lost'); return; }
  r.invuln = false; r.hp = r.maxHp;
  const o = objective('relay', 'Hold the relay', 'Uplink integrity 100 %', 'defend', r.pos.x, r.pos.y + 4, r.pos.z);
  o.timer = TUNE.relayTime; o.ent = r; o.target = r;
  marker('relay', 'relay', 'Relay', r.pos.x, r.pos.y + 4, r.pos.z, r);
  relayBeam = addBeam(r.pos.x, r.pos.y + 8, r.pos.z, 0, 70);
  const x = r.pos.x, z = r.pos.z, T = { target: r }, B = dirBase = G.rand() * 6.28, H = Math.PI / 2;
  const k = TUNE.relayTime / 150;
  at(3 * k, () => { wave(['rifle', 'rifle', 'rifle'], x, z, B, T); wave(['rifle', 'rifle'], x, z, B, null); say(0, 'Contacts ' + compass(B), 'Infantry moving on the relay.', 'warn', 3.5); });
  at(17 * k, () => airWave(['drone', 'drone', 'drone'], x, z, T));
  at(30 * k, () => { wave(['rifle', 'rifle', 'rocketeer', 'rocketeer'], x, z, B + 2 * H, T); wave(['rifle', 'rifle'], x, z, B + 2 * H, null); });
  at(46 * k, () => { airWave(['drone', 'drone', 'drone', 'drone'], x, z, T); wave(['rifle', 'rifle', 'rifle'], x, z, B + H, T); });
  at(62 * k, () => { wave(['tank', 'rifle', 'rifle', 'rocketeer'], x, z, B + 3 * H, T); say(1, 'Armour inbound', 'A tank is ranging the relay. Kill it first.', 'warn', 4.5); });
  at(80 * k, () => { wave(['rifle', 'rifle', 'rifle', 'rocketeer', 'rocketeer', 'rocketeer'], x, z, B, T); airWave(['drone', 'drone', 'drone'], x, z, null); });
  at(96 * k, () => { wave(['tank', 'rifle', 'rifle'], x, z, B + H, T); wave(['tank', 'rocketeer'], x, z, B + 2 * H, T); say(1, 'Two more tanks', 'They are shelling from both ends of the avenue.', 'warn', 4.5); });
  at(113 * k, () => { const d = pickDrop(x, z, 22, 40); enqueue([{ kind: 'emech', variant: 'standard', drop: true }], d.x, d.z, T); wave(['rifle', 'rifle', 'rifle', 'rocketeer'], x, z, B + 3 * H, T); say(0.5, 'Vanta rig dropping', 'It is going straight for the uplink.', 'warn', 5); });
  at(131 * k, () => { wave(['rifle', 'rifle', 'rifle', 'rocketeer', 'rocketeer'], x, z, B + H, T); airWave(['drone', 'drone', 'drone', 'drone'], x, z, T); say(0.5, 'Last push', 'Twenty seconds. Hold.', 'info', 4); });
}
function relayLost() {
  if (!mission.active) return;
  const r = relayEnt; if (r) { G.boom(r.pos.x, r.pos.y + 2.5, r.pos.z, { radius: 6, power: 200, damage: 0, kind: 'mech' }); G.ents.remove(r); }
  if (relayProp) relayProp.die();                       // the mast topples; the wreck stays until the run is reset
  const o = mission.objectives.find(q => q.id === 'relay'); if (o) { o.failed = true; touch(o); }
  mission.fail('The relay was destroyed');
}
function tickStage2(dt) {
  const r = relayEnt, o = mission.objectives.find(q => q.id === 'relay'); if (!o || !r) return;
  o.timer = Math.max(0, TUNE.relayTime - stT); o.progress = clamp(stT / TUNE.relayTime, 0, 1);
  const hpP = Math.round(100 * Math.max(0, r.hp) / r.maxHp), sec = Math.ceil(o.timer);
  if (sec !== lastTimer) { lastTimer = sec; o.sub = 'Uplink integrity ' + hpP + ' %'; touch(o); if (hpP < 35 && sec % 12 === 0) msg('Relay critical', hpP + ' % integrity', 'warn', 3); }
  if (!hasC3()) siege(dt, r);
  if (stT >= TUNE.relayTime) {
    o.done = true; o.timer = null; o.progress = 1; o.sub = 'Uplink integrity ' + hpP + ' %'; touch(o);
    r.invuln = true; dropMarker('relay'); killBeam(relayBeam); relayBeam = null;
    // whoever was sent at the relay turns on the pilot (guarded poke at the controller: see notes, requests)
    const L = G.enemy.list || []; for (let i = 0; i < L.length; i++) { const u = L[i]; if (u && u.tgtOv === r) { u.tgtOv = null; if (u.D && u.D.nav != null && u.fi != null) u.fi = u.D.nav; } }
    completeStage();
  }
}
// Fallback while ENEMY has no opts.target: units with a line of sight to the relay put real rounds into it.
const SIEGE_W = { soldier: 'e_rifle', drone: 'e_drone', tank: 'e_shell', gunship: 'e_gsrocket', emech: 'e_pulse' };
function siege(dt, r) {
  siegeT -= dt; if (siegeT > 0) return;
  const L = G.enemy.list || []; if (!L.length || !G.combat.fireProjectile) { siegeT = 1; return; }
  siegeT = clamp(2.6 / L.length, 0.3, 1.4);
  const u = L[(G.rand() * L.length) | 0], e = u && u.ent; if (!e || !e.alive || e.invuln) return;
  const ty = r.pos.y + 2 + G.rand() * 3;
  _o.set(e.pos.x, e.pos.y + e.height * 0.8, e.pos.z); _d.set(r.pos.x - _o.x, ty - _o.y, r.pos.z - _o.z);
  const dist = _d.length(); if (dist > 85 || dist < 3) return; _d.multiplyScalar(1 / dist);
  _o.addScaledVector(_d, e.radius + 0.6);
  if (!G.grid.los(_o.x, _o.y, _o.z, r.pos.x, ty, r.pos.z)) return;
  const w = e.variant === 'rocketeer' ? 'e_rpg' : SIEGE_W[e.kind] || 'e_rifle';
  try { G.combat.fireProjectile(w, e, _o, _d, { spread: 0.03 }); } catch (err) {}
}

// ---- stage 3: citadel ---------------------------------------------------------------------
function startCitadel() {
  const c = coreEnt;
  if (!cit || !c || !c.alive || recount(cit.core) >= TUNE.coreVoxKill) {            // already rubble (or no suitable building): nothing left to breach
    msg('Citadel already down', 'Command core is gone. Moving on.', 'good', 4); coreGone(true); return;
  }
  c.invuln = false; c.noHit = false;
  const o = objective('core', 'Destroy the command core', cit.b.name ? cit.b.name + ', the glowing floor' : 'The glowing floor of the armoured tower', 'destroy', c.pos.x, c.pos.y + 1, c.pos.z);
  o.ent = c;
  marker('core', 'core', 'Core', c.pos.x, c.pos.y + 1, c.pos.z, c);
  citBeam = addBeam(cit.cx, cit.top, cit.cz, 1, 40);
  // roof guns
  const tops = cit.roof;
  for (let n = 0; n < tops.length; n++) { const t = tops[n]; doBuild({ type: 'nest', x: t.x, y: t.y, z: t.z }, true); const it = { kind: 'turret', weapon: n & 1 ? 'e_rpg' : undefined, y: t.y, hold: 2 }; if (TUNE.turretHp) it.hp = TUNE.turretHp; spawnList([it], t.x, t.z, null); }
  // garrison at the gates
  const gts = cit.gates.slice().sort((a, b) => hyp(a.x, a.z, px(), pz()) - hyp(b.x, b.z, px(), pz()));
  if (gts[0]) enqueue(['rifle', 'rifle', 'rifle', 'rocketeer'], gts[0].x, gts[0].z, { hold: 12 });
  if (gts[1]) enqueue(['rifle', 'rifle', 'rocketeer'], gts[1].x, gts[1].z, { hold: 12 });
  gunT = 6; gunN = 0; trickleT = 22;
  at(20, () => wave(['tank', 'rifle', 'rifle'], cit.cx, cit.cz, null));
  at(75, () => { const d = pickDrop(cit.cx, cit.cz, 24, 45); enqueue([{ kind: 'emech', variant: 'standard', drop: true }], d.x, d.z, null); say(0.5, 'Vanta rig dropping', 'Citadel guard is on the street.', 'warn', 4); });
  at(140, () => wave(['tank', 'rocketeer', 'rocketeer'], cit.cx, cit.cz, null));
}
function coreGone(quiet) {
  const c = coreEnt, o = mission.objectives.find(q => q.id === 'core');
  if (o) { o.done = true; o.progress = 1; touch(o); }
  dropMarker('core'); killBeam(citBeam); citBeam = null;
  if (c) {
    if (!quiet) { G.boom(c.pos.x, c.pos.y + 1.5, c.pos.z, { radius: 7, power: 240, damage: 200, kind: 'mech' }); bus.emit('shake', { amount: 0.8, x: c.pos.x, y: c.pos.y, z: c.pos.z }); }
    if (c.alive) { c.alive = false; } G.ents.remove(c); coreEnt = null;
  }
  if (coreProp) { coreProp.dispose(); coreProp = null; }
  if (!quiet) msg('Command core destroyed', 'Vanta command is off the air', 'good', 5);
  if (phase === 'run' && mission.stage === 3) completeStage(); else if (mission.stage === 3 && phase === 'intro') { phase = 'run'; completeStage(); }
}
function tickStage3(dt) {
  const c = coreEnt, o = mission.objectives.find(q => q.id === 'core'); if (!c || !o) return;
  const vox = recount(cit.core), hpF = 1 - Math.max(0, c.hp) / c.maxHp;
  setProgress(o, Math.max(hpF, vox / TUNE.coreVoxKill));
  if (!c.alive || vox >= TUNE.coreVoxKill) { coreGone(false); return; }
  gunT -= dt;
  if (gunT <= 0) {
    gunT = TUNE.gunshipEvery; let g = 0; const L = G.enemy.list || []; for (let i = 0; i < L.length; i++) if (L[i].kind === 'gunship') g++;
    if (g < 2 && gunN < TUNE.gunshipMax) { gunN++; airWave(['gunship'], cit.cx, cit.cz, null); if (gunN === 1) say(0.5, 'Gunship on station', 'Skylance it, or stay under cover.', 'warn', 4); if (g === 0 && gunN < TUNE.gunshipMax && stT > 40) { gunN++; airWave(['gunship'], cit.cx, cit.cz, null); } }
  }
  trickleT -= dt;
  if (trickleT <= 0) {
    trickleT = TUNE.s3Trickle * (0.85 + G.rand() * 0.3);
    if (live() + queueCount() < TUNE.s3Cap) { wave(G.rand() < 0.5 ? ['rifle', 'rifle', 'rifle', 'rocketeer'] : ['rifle', 'rifle', 'rocketeer', 'rocketeer'], cit.cx, cit.cz, null); if (G.rand() < 0.5) airWave(['drone', 'drone', 'drone'], px(), pz()); }
  }
}

// ---- stage 4: dreadnought --------------------------------------------------------------------
function startBoss() {
  const pl = G.city.plaza || { x: WX / 2, z: WZ / 2 }, d = pickDrop(pl.x, pl.z, 14, 50);
  const us = spawnList([{ kind: 'emech', variant: hasC3() ? 'dreadnought' : 'heavy', drop: true, eta: 6 }], d.x, d.z, null);
  bossU = us[0] || null;
  if (!bossU) { console.error('mission: boss did not spawn'); completeStage(); return; }
  const e = bossU.ent;
  if (!e.boss) { e.hp = e.maxHp = TUNE.bossHp; e.boss = true; e.phase = 1; e.name = 'Vanta Dreadnought'; bossU._fake = true; }     // stand-in: a heavy rig with the boss's armour
  bossPh = 1; mission.boss = e;
  const o = objective('boss', 'Destroy the Dreadnought', 'Phase 1 of 3', 'kill', e.pos.x, GROUND_Y + 8, e.pos.z);
  o.ent = e;
  marker('boss', 'boss', 'Dreadnought', e.pos.x, GROUND_Y + 8, e.pos.z, e);
  escortT = 30;
}
function tickStage4(dt) {
  const o = mission.objectives.find(q => q.id === 'boss'), e = bossU && bossU.ent; if (!o || !e) return;
  o.x = e.pos.x; o.y = e.pos.y + e.height * 0.6; o.z = e.pos.z;
  const mk = mission.markers[mission.markers.length - 1]; if (mk && mk.id === 'boss') { mk.x = o.x; mk.y = o.y; mk.z = o.z; }
  const f = Math.max(0, e.hp) / e.maxHp;
  if (bossU._fake) { const ph = f > 0.66 ? 1 : f > 0.33 ? 2 : 3; if (ph !== e.phase && e.alive) { e.phase = ph; bus.emit('boss:phase', { ent: e, phase: ph }); } }
  if ((e.phase | 0) !== bossPh && e.alive) { bossPh = e.phase | 0; o.sub = 'Phase ' + bossPh + ' of 3'; touch(o); if (bossU._fake) msg(bossPh === 2 ? 'Dreadnought advancing' : 'Dreadnought enraged', bossPh === 2 ? 'It is closing in. Keep buildings between you.' : 'It is coming straight for you. Keep moving.', 'warn', 5); }
  setProgress(o, 1 - f);
  if (!e.alive) { o.done = true; o.progress = 1; o.sub = 'Destroyed'; touch(o); dropMarker('boss'); completeStage(); return; }
  escortT -= dt;
  if (escortT <= 0) { escortT = TUNE.s4Escort * (0.85 + G.rand() * 0.3); if (live() + queueCount() < TUNE.s4Cap) { wave(['rifle', 'rifle', 'rocketeer'], e.pos.x, e.pos.z, null); if (f < 0.66) airWave(['drone', 'drone'], px(), pz()); } }
}

// ---- win / fail ---------------------------------------------------------------------------
function win() {
  const S = G.state; phase = ''; mission.active = false; mission.won = true; queue.length = 0; clearScript();
  stats.time = +opT.toFixed(1);
  const out = { time: stats.time, stageTimes: stats.stageTimes.slice(1), kills: SP().kills | 0, missionKills: stats.kills, relayHp: relayEnt ? Math.max(0, relayEnt.hp) / relayEnt.maxHp : 0, voxelsDestroyed: S.stats.voxelsDestroyed, buildingsLevelled: S.stats.buildingsLevelled };
  try { G.progress.award(TUNE.pay.win, 'operation'); } catch (e) {}
  // the pilot cannot lose a won operation to a stray shell during the victory orbit
  const p = SP(); if (p.pilot) p.pilot.invuln = true; if (p.mech) p.mech.invuln = true;
  msg('Operation Blackout complete', 'Halden Yard is ours', 'good', 8);
  winStats = out;
  bus.emit('mission:won', { stats: out });
  bus.emit('game:won', { stats: out });
}

// ---- survival bonus: level the Vanta supply depot ----------------------------------------------
function bonusStart() {
  const B = G.city.buildings; let b = B.find(q => q.kind === 'warehouse' && q.alive !== false) || null;
  if (!b) { let best = null; for (const q of B) if (q.kind === 'shop' && (!best || q.voxels > best.voxels)) best = q; b = best; }
  if (!b) return;
  const s = sampleBuilding(b, 500); if (s.total < 60) return;
  const x = (b.i0 + b.i1 + 1) * 0.5 * VS, z = (b.k0 + b.k1 + 1) * 0.5 * VS, y = (b.j1 + 1) * VS;
  const o = objective('depot', 'Bonus: level the Vanta supply depot', (b.name || 'Warehouse') + ', ' + where(x, z), 'destroy', x, y, z);
  o.optional = true;
  bonus = { b, s, o, beam: addBeam(x, y, z, 1, 40) };
  marker('depot', 'depot', 'Depot', x, y, z);
  msg('Bonus objective', 'Vanta is staging out of ' + (b.name || 'the warehouse') + '. Flatten it for salvage and a field perk.', 'info', 6);
}
function bonusTick() {
  if (!bonus || bonus.o.done) return;
  const f = recount(bonus.s); setProgress(bonus.o, f / TUNE.bonusKill);
  if (f >= TUNE.bonusKill) {
    bonus.o.done = true; bonus.o.progress = 1; touch(bonus.o); killBeam(bonus.beam); bonus.beam = null; dropMarker('depot');
    msg('Supply depot levelled', 'Salvage recovered', 'good', 4);
    dones.push({ id: 'depot', text: bonus.o.text, sub: bonus.o.sub, salvage: TUNE.pay.bonus });
    bus.emit('objective:done', { objective: bonus.o, salvage: TUNE.pay.bonus });
  }
}

// ============================================================================
// MODULE
// ============================================================================
function cleanup() {
  for (const b of beams) { b.removeFromParent(); if (b.material) b.material.dispose(); }
  beams = []; relayBeam = citBeam = null;
  if (relayProp) relayProp.dispose(); if (coreProp) coreProp.dispose();
  if (relayEnt) G.ents.remove(relayEnt); if (coreEnt) G.ents.remove(coreEnt);
  relayProp = coreProp = null; relayEnt = coreEnt = null; bossU = null;
  pylons = []; pad = null; cit = null; bonus = null; builds = []; dones = []; netStage = 0; netSeen = 0; netEnd = ''; winStats = null; netRelay = 1; asClient = false;
  for (const b of netBeams.values()) { b.removeFromParent(); if (b.material) b.material.dispose(); } netBeams.clear();
  queue.length = 0; says.length = 0; clearScript();
  mission.objectives.length = 0; mission.markers.length = 0;
  mission.active = false; mission.won = false; mission.failed = false; mission.stage = 0; mission.relay = null; mission.core = null; mission.boss = null;
  phase = ''; phT = stT = opT = tick = 0; tickN = 0; edgeT = null; pending = false;
  stats.kills = 0; stats.spawned = 0; stats.stageTimes = [0, 0, 0, 0, 0]; stats.time = 0; stats.peakMs = 0;
}
const mission = {
  name: 'mission', active: false, won: false, failed: false, stage: 0, objectives: [], markers: [], relay: null, core: null, boss: null, TUNE, stats,
  init() {
    if (G.params.get('mode') === 'operation') G.state.mode = 'operation';
    bus.on('game:start', () => { if (G.params.get('mode') === 'operation') G.state.mode = 'operation'; pending = true; });
    bus.on('ent:death', (d) => { if (mission.active && d && d.ent && d.ent.team === 1) stats.kills++; });
    bus.on('game:over', (d) => { if (mission.active && !isClient()) { mission.active = false; mission.failed = true; for (const o of mission.objectives) if (!o.done) { o.failed = true; } if (!d || d.cause !== 'mission') { netEnd = G.net && G.net.online ? 'All pilots down' : 'Pilot down'; bus.emit('mission:failed', { reason: netEnd }); } } });
    bus.on('wave:start', (d) => { if (!isClient() && G.state.mode !== 'operation' && d && d.n === TUNE.bonusWave && !bonus && !G.params.has('nobonus')) bonusStart(); });
  },
  /** Begin the operation now (normally called by the first update after 'game:start' in operation mode). */
  start(stage) {
    cleanup();
    // today's ENEMY may still run its wave director in an operation: park it (harmless once ENEMY checks the mode itself)
    const d = G.enemy && G.enemy.dir; if (d && (d.active || d.running)) { d.active = false; d.running = false; }
    startStage = clamp(stage || parseInt(G.params.get('stage')) || 1, 1, 4);
    buildWorld(startStage);
    mission.relay = relayEnt; mission.core = coreEnt;
    mission.active = true; opT = 0; stats.stageTimes[0] = 0;
    enterStage(startStage);
    return true;
  },
  reset() { cleanup(); },
  fail(reason) {
    if (!mission.active) return;
    mission.active = false; mission.failed = true; phase = ''; queue.length = 0; clearScript();
    for (const o of mission.objectives) if (!o.done && !o.failed) { o.failed = true; touch(o); }
    msg('Operation failed', reason || '', 'warn', 6);
    netEnd = reason || 'Objective lost';
    bus.emit('mission:failed', { reason: netEnd });
    bus.emit('player:dead', { cause: 'mission' });
  },
  update(dt) {
    if (dt <= 0) return;
    const t0 = performance.now();
    if (pending && G.state.phase === 'playing') { pending = false; if (G.state.mode === 'operation' && !isClient()) this.start(); }
    if (asClient && !isClient()) cleanup();                                  // left the room: drop the replicated mission
    if (isClient()) { if (relayProp) relayProp.update(dt, netRelay, mission.stage >= 2 && netRelay > 0); if (coreProp) coreProp.update(dt, 1, true); return; }      // co-op client: the host judges; we only draw what applyState gave us
    // props animate in every mode they exist in
    if (relayProp && relayEnt) relayProp.update(dt, Math.max(0, relayEnt.hp) / relayEnt.maxHp, mission.stage >= 2 && relayEnt.alive);
    if (coreProp && coreEnt) coreProp.update(dt, Math.max(0, coreEnt.hp) / coreEnt.maxHp, true);
    if (!mission.active) { if (bonus && G.state.phase === 'playing') { tick += dt; if (tick >= 1) { tick = 0; bonusTick(); } } return; }
    if (G.state.phase !== 'playing') return;
    opT += dt; phT += dt;
    // radio lines
    for (let n = says.length - 1; n >= 0; n--) if (opT >= says[n].t) { const s = says[n]; says.splice(n, 1); msg(s.text, s.sub, s.kind, s.dur); }
    if (phase === 'intro') { if (phT >= TUNE.introLull) goLive(); }
    else if (phase === 'outro') { if (phT >= TUNE.outroLull && !(G.progress && G.progress.offer && phT < TUNE.outroLull + 20)) nextStage(); }
    else if (phase === 'run') {
      stT += dt;
      while (scriptI < script.length && stT >= script[scriptI].t) { const ev = script[scriptI++]; ev.fn(); }
      // spawn queue: one group per beat, when there is room
      queueT -= dt;
      if (queue.length && queueT <= 0) { const q = queue[0]; if (live() + q.list.length <= TUNE.liveCap || live() === 0) { queue.shift(); spawnList(q.list, q.x, q.z, q.opts); queueT = 0.6; } else queueT = 1; }
      tick += dt;
      if (tick >= 0.25) {
        const T = tick; tick = 0; tickN++;
        switch (mission.stage) { case 1: tickStage1(T); break; case 2: tickStage2(T); break; case 3: tickStage3(T); break; case 4: tickStage4(T); break; }
      }
    }
    const ms = performance.now() - t0; stats.ms = stats.ms * 0.95 + ms * 0.05; if (ms > stats.peakMs) stats.peakMs = ms;
  },
  /** Host: the real entity behind a mission net id ('m:relay' | 'm:core'), or null. NET applies clients' hit claims to it. */
  entByNetId(id) { const e = id === 'm:relay' ? relayEnt : id === 'm:core' ? coreEnt : null; return e && e.alive ? e : null; },
  /** Net ids of the mission entities alive right now. */
  propNetIds() { const out = []; if (relayEnt && relayEnt.alive) out.push('m:relay'); if (coreEnt && coreEnt.alive) out.push('m:core'); return out; },
  // ---- co-op wire (CONTRACT-D): host serialises, clients apply. See notes/mission.md "Wire contract".
  serialize() {
    const O = mission.objectives, M = mission.markers;
    return {
      v: 1, a: mission.active ? 1 : 0, won: mission.won ? 1 : 0, failed: mission.failed ? 1 : 0, end: netEnd, stage: mission.stage, phase, t: +opT.toFixed(1),
      relay: relayEnt ? +(Math.max(0, relayEnt.hp) / relayEnt.maxHp).toFixed(3) : relayProp ? 0 : 1,
      core: coreEnt ? +(Math.max(0, coreEnt.hp) / coreEnt.maxHp).toFixed(3) : 0,
      ra: relayEnt && relayEnt.alive ? (relayEnt.invuln ? 1 : 2) : 0, ca: coreEnt && coreEnt.alive ? (coreEnt.invuln ? 1 : 2) : 0,       // 0 gone, 1 alive but untouchable, 2 live target
      obj: O.map(o => ({ id: o.id, text: o.text, sub: o.sub, kind: o.kind, p: +o.progress.toFixed(3), c: o.count, n: o.total, tm: o.timer == null ? null : +o.timer.toFixed(1), d: o.done ? 1 : 0, f: o.failed ? 1 : 0, opt: o.optional ? 1 : 0, x: o.x == null ? null : +o.x.toFixed(1), y: o.y == null ? null : +o.y.toFixed(1), z: o.z == null ? null : +o.z.toFixed(1), netId: o.ent && o.ent.netId != null ? o.ent.netId : undefined, hp: o.ent ? +(Math.max(0, o.ent.hp) / (o.ent.maxHp || 1)).toFixed(3) : undefined })),
      mk: M.map(m => ({ id: m.id, kind: m.kind, label: m.label, x: +m.x.toFixed(1), y: +m.y.toFixed(1), z: +m.z.toFixed(1), netId: m.ent && m.ent.netId != null ? m.ent.netId : undefined })),
      builds: builds.slice(), dones: dones.slice(), stats: winStats,
    };
  },
  applyState(o) {
    if (!o || o.v !== 1) return false;
    if (!asClient && (builds.length || mission.active)) cleanup();          // leftovers of a local run
    asClient = true;
    if (!o.a && !o.won && !o.failed && !o.builds.length) { if (builds.length || mission.objectives.length) cleanup(); return true; }
    if (o.builds.length < builds.length || (o.stage < netStage && o.a)) cleanup();                 // the host restarted
    // structures this peer has not built yet (same builders, same city seed: identical voxels)
    for (let n = builds.length; n < o.builds.length; n++) doBuild(Object.assign({}, o.builds[n]), false);
    netRelay = o.relay;
    // puppet entities for the relay and the core: same body as the host's, hp from the replicated fractions.
    // ents.damage on them turns into G.net.claimHit (ent.remote); the host resolves the id with entByNetId.
    if (relayEnt) { if (o.ra) { relayEnt.hp = o.relay * relayEnt.maxHp; relayEnt.invuln = o.ra === 1; } else { relayEnt.hp = 0; relayEnt.alive = false; G.ents.remove(relayEnt); relayEnt = null; } }
    if (coreEnt) { if (o.ca) { coreEnt.hp = o.core * coreEnt.maxHp; coreEnt.invuln = coreEnt.noHit = o.ca === 1; } else { coreEnt.hp = 0; coreEnt.alive = false; G.ents.remove(coreEnt); coreEnt = null; } }
    mission.relay = relayEnt; mission.core = coreEnt;
    if (relayProp && !o.ra && !relayProp._dead) { relayProp._dead = true; relayProp.die(); }
    mission.active = !!o.a; phase = o.phase; opT = o.t;
    if (o.stage !== netStage && o.stage >= 1 && o.stage <= 4 && o.a) {
      netStage = mission.stage = o.stage; const T = TITLES[o.stage];
      for (let i = mission.objectives.length - 1; i >= 0; i--) if (!o.obj.some(q => q.id === mission.objectives[i].id)) mission.objectives.splice(i, 1);
      bus.emit('mission:stage', { n: o.stage, title: T[0], text: T[1], of: 4 });
      if (o.stage > 1) { fillMeter(); bus.emit('mission:refill', { stage: o.stage }); }
    }
    mission.stage = o.stage;
    // objectives: add / update / remove by id
    const O = mission.objectives;
    for (let i = O.length - 1; i >= 0; i--) if (!o.obj.some(q => q.id === O[i].id)) O.splice(i, 1);
    for (const q of o.obj) {
      let m = O.find(r => r.id === q.id), isNew = false;
      if (!m) { m = { id: q.id, ent: null, _p: 0 }; O.push(m); isNew = true; }
      const ch = isNew || m.progress !== q.p || m.done !== !!q.d || m.failed !== !!q.f || m.sub !== q.sub || m.count !== q.c || (q.tm == null ? m.timer != null : Math.ceil(q.tm) !== Math.ceil(m.timer == null ? -1 : m.timer));
      m.text = q.text; m.sub = q.sub; m.kind = q.kind; m.progress = q.p; m.count = q.c; m.total = q.n; m.timer = q.tm; m.done = !!q.d; m.failed = !!q.f; m.optional = !!q.opt; m.x = q.x; m.y = q.y; m.z = q.z; m.netId = q.netId;
      if (q.hp != null) { m.hp = q.hp; m.maxHp = 1; }
      m.ent = q.netId === 'm:relay' ? relayEnt : q.netId === 'm:core' ? coreEnt : null; if (q.id === 'relay') m.target = m.ent;
      if (isNew) bus.emit('objective:new', { objective: m }); else if (ch) bus.emit('objective:update', { objective: m });
    }
    if (coreProp && !o.ca) { coreProp.dispose(); coreProp = null; }
    // markers + their light columns
    const M = mission.markers; M.length = 0;
    for (const q of o.mk) M.push({ id: q.id, kind: q.kind, label: q.label, x: q.x, y: q.y, z: q.z, netId: q.netId, ent: q.netId === 'm:relay' ? relayEnt : q.netId === 'm:core' ? coreEnt : null, active: true });
    for (const [id, b] of netBeams) if (!o.mk.some(q => q.id === id)) { b.removeFromParent(); if (b.material) b.material.dispose(); netBeams.delete(id); }
    if (!G.params.has('nobeam')) for (const q of o.mk) if (q.kind !== 'boss' && !netBeams.has(q.id)) { const h = q.kind === 'relay' ? 70 : q.kind === 'jammer' ? 60 : 40, y0 = q.kind === 'jammer' ? GROUND_Y + 18 : q.kind === 'relay' ? q.y + 4 : cit && q.kind === 'core' ? cit.top : q.y, b = makeBeam(q.kind === 'relay' ? 0 : 1, h); b.position.set(q.x, y0 + h / 2, q.z); G.scene.add(b); netBeams.set(q.id, b); }
    // stage completions (salvage + perk offer are per player: progress.js listens on this peer too)
    for (; netSeen < o.dones.length; netSeen++) { const q = o.dones[netSeen]; bus.emit('objective:done', { objective: { id: q.id, text: q.text, sub: q.sub, kind: 'survive', progress: 1, count: 1, total: 1, timer: null, done: true, failed: false, x: null, y: null, z: null }, salvage: q.salvage }); }
    if (o.won && !mission.won) { mission.won = true; mission.active = false; const p = SP(); if (p.pilot) p.pilot.invuln = true; if (p.mech) p.mech.invuln = true; try { G.progress.award(TUNE.pay.win, 'operation'); } catch (e) {} bus.emit('mission:won', { stats: o.stats || {} }); }
    if (o.failed && !mission.failed) { mission.failed = true; mission.active = false; for (const m of O) if (!m.done) m.failed = true; bus.emit('mission:failed', { reason: o.end || 'Objective lost' }); }
    return true;
  },
  // ---- debug / harness helpers -------------------------------------------------------
  debug: {
    info() {
      return { active: mission.active, won: mission.won, failed: mission.failed, stage: mission.stage, phase, stT: +stT.toFixed(1), opT: +opT.toFixed(1), live: live(), queued: queueCount(), c3: hasC3(),
        objectives: mission.objectives.map(o => ({ id: o.id, p: +o.progress.toFixed(2), done: o.done, failed: o.failed, timer: o.timer == null ? null : +o.timer.toFixed(0), sub: o.sub })),
        pylons: pylons.map(p => ({ x: p.s.x, z: p.s.z, total: p.s.total, left: p.s.left, guards: p.guards })),
        relay: relayEnt ? { x: relayEnt.pos.x, y: relayEnt.pos.y, z: relayEnt.pos.z, hp: Math.round(relayEnt.hp), invuln: !!relayEnt.invuln } : null,
        core: coreEnt ? { x: coreEnt.pos.x, y: coreEnt.pos.y, z: coreEnt.pos.z, hp: Math.round(coreEnt.hp), vox: cit ? cit.core.left + '/' + cit.core.total : '' } : null,
        citadel: cit ? { name: cit.b.name, id: cit.b.id, plate: cit.plate, roof: cit.roof.length, gates: cit.gates.length, slab: cit.slab, top: cit.top } : null,
        boss: bossU ? { hp: Math.round(bossU.ent.hp), max: bossU.ent.maxHp, phase: bossU.ent.phase, fake: !!bossU._fake, x: +bossU.ent.pos.x.toFixed(1), z: +bossU.ent.pos.z.toFixed(1) } : null,
        ms: +stats.ms.toFixed(4), peakMs: +stats.peakMs.toFixed(3), buildMs: +stats.buildMs.toFixed(1), voxMs: +(stats.voxMs || 0).toFixed(1), stageTimes: stats.stageTimes.slice(1), spawned: stats.spawned, kills: stats.kills };
    },
    /** jump the clock of the current phase (skip a lull, or most of the relay timer) */
    skip(sec) { if (phase === 'run') stT += sec; else phT += sec; },
    bonus() { if (!bonus) bonusStart(); return bonus ? { name: bonus.b.name, total: bonus.s.total, x: bonus.o.x, z: bonus.o.z } : null; },
  },
};
export default mission;
