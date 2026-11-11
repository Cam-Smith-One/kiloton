// KILOTON — ui_demo.js   OWNER: UI. Fake state for `?ui=title|hud|rig|pause|over` so every screen can be
// screenshotted without the rest of the game. Never touches G.state.player/wave: the HUD reads this object instead.
//   uis=ready|drop|wait|low|inter|hot   optional sub-state for hud / rig
import { G, THREE } from './core.js';

const W = (id, name, kind, o) => Object.assign({ id, name, kind, clip: 0, clipMax: 0, reloading: 0, heat: 0, overheated: false, charge: 1, cd: 0, ready: true }, o);
const ent = (kind, team, hp, maxHp, radius, height, o) => Object.assign({ kind, team, hp, maxHp, radius, height, alive: true, pos: new THREE.Vector3(), vel: new THREE.Vector3() }, o);

export function createDemo(which, sub, fire) {
  const rig = which === 'rig' || which === 'boss';
  const coop = which === 'coop';
  const ops = which === 'objectives' || which === 'boss' || which === 'won';
  const pilot = ent('pilot', 0, sub === 'low' ? 22 : 78, 100, 0.35, 1.8, { isPlayer: !rig });
  const mech = ent('mech', 0, sub === 'low' ? 310 : 1130, 1800, 1.8, 8.5, { isPlayer: rig });
  const pilotW = [W('rifle', 'VK-9 Rifle', 'auto', { clip: 19, clipMax: 30 }), W('launcher', 'Lancet Launcher', 'semi', { clip: 0, clipMax: 1, reloading: 0.4 }), W('seeker', 'Seeker AA', 'lock', { charge: 1 })];
  const rigW = [W('pulse', 'Pulse cannon', 'heat', { heat: 0.62, key: 'LMB', slot: 'armL' }), W('autocannon', 'Autocannon', 'auto', { clip: 142, clipMax: 200, key: 'LMB', slot: 'armR' }), W('salvo', 'Hailstorm rockets', 'charge', { charge: 0.45, ready: false, key: 'RMB', slot: 'shL' }), W('swarm', 'Swarm rack', 'lock', { charge: 1, key: 'Q', slot: 'shR' }), W('mortar', 'Thunder mortar', 'charge', { charge: 1, key: 'RMB', slot: 'back' })];
  const E = [
    ent('soldier', 1, 60, 60, 0.35, 1.8), ent('soldier', 1, 60, 60, 0.35, 1.8), ent('soldier', 1, 60, 60, 0.35, 1.8), ent('soldier', 1, 60, 60, 0.35, 1.8),
    ent('soldier', 1, 80, 80, 0.35, 1.8, { variant: 'ace' }),
    ent('drone', 1, 40, 40, 0.9, 0.7, { airborne: true }), ent('drone', 1, 40, 40, 0.9, 0.7, { airborne: true }),
    ent('tank', 1, 600, 600, 2.2, 2.6), ent('gunship', 1, 500, 500, 3.2, 2.6, { airborne: true }), ent('emech', 1, 1500, 1500, 1.8, 8.5),
  ];
  //            ahead, right, up   (metres from the fake player, camera-relative)
  const LAYOUT = [[38, -9, 0], [44, -4, 0], [22, 31, 0], [-18, -26, 0], [52, 15, 0], [64, -30, 16], [70, -22, 19], [-40, 22, 0], [86, 22, 24], [96, -48, 0]];
  const state = {
    player: {
      mode: rig ? 'mech' : 'pilot', ent: rig ? mech : pilot, pilot, mech: rig || sub === 'wait' ? mech : null,
      meter: sub === 'ready' ? 1 : 0.64, mechReady: sub === 'ready', mechIncoming: sub === 'drop' ? 3.4 : 0, yaw: 0, pitch: 0,
      weapons: rig ? rigW : pilotW, activeWeapon: 0,
      lock: { target: rig ? E[8] : null, progress: rig ? 0.6 : 0, locked: false },
      jet: sub === 'low' ? 0.12 : 0.7, canEnter: false, canEject: rig, grab: null, prompt: sub === 'wait' ? 'E — Board the Warden' : '',
      equip: rig ? { shield: { on: true, energy: 0.72 }, grapple: { state: 'ready' } } : null, loadout: { name: 'Warden / Line', chassis: 'warden', index: 0 },
      inCover: !rig && sub !== 'low', crouch: !rig, slide: false, roll: false, shoulder: 1,
      aim: new THREE.Vector3(), hitMarker: 0, kills: 23, score: 14850, combo: 3,
    },
    wave: { n: 4, alive: 9, total: 16, intermission: sub === 'inter' ? 5.3 : 0, enemyMechs: rig ? 1 : 0, bestWave: 6 },
    stats: { voxelsDestroyed: 48211, buildingsLevelled: 3, timeAlive: which === 'won' ? 842 : 412, mechsCalled: 2 },
    mode: ops ? 'operation' : 'survival',
  };
  // fake Operation Blackout (MISSION's objective shape from CONTRACT-C section C2)
  const O = (id, text, sub, kind, o) => Object.assign({ id, text, sub, kind, progress: 0, count: 0, total: 0, timer: null, done: false, failed: false, x: null, y: null, z: null }, o);
  const relay = ent('prop', 0, sub === 'low' ? 210 : 640, 1000, 2, 4, { name: 'Relay' });
  const mission = { active: ops, relay, stage: which === 'boss' ? 4 : sub === 'relay' ? 2 : 1, markers: [], objectives: !ops ? [] : which === 'boss' ? [
    O('boss', 'Destroy the Dreadnought', 'It drops its shield when the escorts die.', 'kill', { progress: 0.4 }),
  ] : sub === 'relay' ? [
    O('relay', 'Hold the relay', 'Keep Vanta off the uplink until it finishes.', 'defend', { progress: 0.42, timer: 87, ent: relay }),
    O('bonus', 'Level the supply depot', 'Optional. Extra salvage.', 'destroy', { progress: 0.15 }),
  ] : [
    O('p1', 'Jammer pylon Alpha', 'Blow the base and it falls.', 'destroy', { progress: 1, done: true }),
    O('p2', 'Jammer pylon Bravo', 'Guarded by a squad.', 'destroy', { progress: 0.45 }),
    O('p3', 'Jammer pylon Charlie', 'A tank holds the plaza.', 'destroy', { progress: 0 }),
  ] };
  if (which === 'boss') Object.assign(E[9], { variant: 'dreadnought', name: 'Dreadnought', hp: sub === 'rage' ? 2100 : 5400, maxHp: 9000, radius: 3.6, height: 17, phase: sub === 'rage' ? 3 : 2 });

  if (sub === 'inter') { state.wave.alive = 0; }
  if (sub === 'hot') { rigW[0].heat = 1; rigW[0].overheated = true; }
  if (sub === 'low' && !rig) { pilotW[0].clip = 5; }
  const P = state.player;
  // ---- fake G.net (CONTRACT-D surface) for ui=lobby / ui=coop --------------------------------------------------------
  let net = null;
  if (which === 'lobby' || coop) {
    const peers = new Map(), calls = [];
    const mate = (id, name, kind, hp, maxHp, o) => { const e = ent(kind, 0, hp, maxHp, kind === 'mech' ? 1.8 : 0.35, kind === 'mech' ? 8.5 : 1.8, Object.assign({ remote: true, netOwner: id, name }, o)); peers.set(id, { id, name, ready: true, ent: e, pilot: e, mech: null, state: { loadoutName: o && o.rig } }); return e; };
    net = { online: coop, isHost: sub !== 'join' && sub !== 'clientover' && sub !== 'deploy', id: sub === 'join' ? 2 : 1, hostId: 1, room: null, status: 'offline', error: '', ping: 38, peers, calls,
      available() { return Promise.resolve(sub !== 'unavailable'); },
      create(name) { calls.push(['create', name]); this.status = 'lobby'; this.room = 'KTNX'; this.isHost = true; },
      join(code, name) { calls.push(['join', code, name]); if (sub === 'error') { this.status = 'error'; this.error = 'No room with that code. Check it with your host.'; return; } this.status = 'lobby'; this.room = code; this.isHost = false; },
      leave() { calls.push(['leave']); this.status = 'offline'; this.room = null; this.error = ''; },
      start(o) { calls.push(['start', o]); }, send() {}, on() {} };
    if (coop || sub === 'host' || sub === 'join') {
      net.status = coop ? 'playing' : 'lobby'; net.room = 'KTNX';
      const a = mate(2, 'Okonkwo', 'pilot', 64, 100, { rig: 'Harrier / Knife' }), b = mate(3, 'Vasquez', 'mech', 1210, 1800, { rig: 'Warden / Line' }), c = mate(4, 'Lindqvist', 'pilot', 0, 100, { rig: 'Bastion / Hammer', down: true });
      if (sub === 'join') { peers.set(1, { id: 1, name: 'Okonkwo', ready: true, state: { loadoutName: 'Harrier / Knife' } }); peers.get(2).name = 'You'; peers.delete(4); }
      if (coop) { E.push(a, b, c); LAYOUT.push([14, -7, 0], [40, 16, 0], [9, 8, 0]); P.revive = { ent: c, progress: 0.45 }; if (sub === 'down') { P.mode = 'down'; P.down = true; P.spectating = b; P.revive = { ent: null, progress: 0 }; pilot.hp = 0; } }
    }
    if (sub === 'error') { net.status = 'error'; net.error = 'No room with that code. Check it with your host.'; }
  }
  let t = 0, placed = 0, tA = 0.4, tB = 0.2, tC = 0.9, started = false, feedI = 0;
  const FEED = [['Infantry', 100], ['Drone', 150], ['Tank destroyed', 600], ['Infantry ×2', 250]];
  const f = new THREE.Vector3(), r = new THREE.Vector3();
  function place(e, row, origin) { e.pos.set(origin.x + f.x * row[0] + r.x * row[1], G.GROUND_Y + row[2], origin.z + f.z * row[0] + r.z * row[1]); }

  return {
    state, mission, net, ents: E.concat(state.player.mech && !rig ? [mech] : [], ops && sub === 'relay' ? [relay] : []), projectiles: [],
    update(dt) {
      t += dt;
      const cam = G.camera;
      if (placed < 12) {          // let the camera settle (title orbit / cam= override) then pin the fakes to the world
        placed++;
        cam.getWorldDirection(f); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, 1); f.normalize(); r.set(-f.z, 0, f.x);
        const o = (rig ? mech : pilot).pos; o.copy(cam.position).addScaledVector(f, rig ? 15 : 3.4); o.y = G.GROUND_Y;
        for (let i = 0; i < E.length; i++) place(E[i], LAYOUT[i], o);
        if (sub === 'wait') place(mech, [34, 12, 0], o);
        if (ops) {
          const spots = [[60, -20, 0], [48, 6, 0], [70, 34, 0]], ob = mission.objectives;
          for (let i = 0; i < ob.length; i++) { const sp = spots[i % 3]; ob[i].x = o.x + f.x * sp[0] + r.x * sp[1]; ob[i].y = G.GROUND_Y; ob[i].z = o.z + f.z * sp[0] + r.z * sp[1]; }
          if (which === 'boss') { ob[0].x = E[9].pos.x; ob[0].z = E[9].pos.z; ob[0].y = G.GROUND_Y + 16; }
          place(relay, [26, 10, 0], o);
        }
        if (sub === 'drop') fire('mech:incoming', { x: o.x + f.x * 30 - r.x * 6, z: o.z + f.z * 30 - r.z * 6, team: 0, eta: 5 });
        return;
      }
      if (!started) {
        started = true;
        if (!ops) fire('wave:start', { n: 4, total: 16, label: 'Armour inbound' });
        else fire('mission:stage', which === 'boss' ? { n: 4, title: 'Dreadnought', text: 'Vanta command has dropped its flagship. Break it.' } : sub === 'relay' ? { n: 2, title: 'Hold the relay', text: 'Vanta wants the uplink back. Keep it alive.' } : { n: 1, title: 'Cut the signal', text: 'Three jammer pylons. Bring them all down.' });
        if (which === 'perks' && G.progress) fire('perk:offer', { perks: G.progress.PERKS.slice(0, 3) });
        fire('salvage', { amount: 140, reason: 'objective', total: 1390 });
        if (rig) fire('lock', { state: 'locked', target: E[5] });
        if (rig) fire('lock:warning', { on: true });
        if (sub === 'tips') fire('demo:tip', {});
      }
      // looping values so a still frame at any time shows live-looking instruments
      if (rig) {
        const w0 = rigW[0], w1 = rigW[2];
        if (sub !== 'hot') w0.heat = 0.62 + 0.2 * Math.sin(t * 1.3);
        w1.charge = (0.45 + t * 0.05) % 1; w1.ready = false;
        P.lock.progress = (0.35 + t * 0.2) % 1;
        P.jet = 0.55 + 0.25 * Math.sin(t * 0.7);
      } else {
        pilotW[1].reloading = ((0.4 + t * 0.3) % 1) || 0.01;
        pilot.vel.x = 3;
      }
      if (sub === 'drop') { P.mechIncoming = 3.4 - (t % 3.3); }
      if (sub === 'inter') state.wave.intermission = 5.3 - (t % 5);
      tA -= dt; tB -= dt; tC -= dt;
      if (tA <= 0) {              // being shot from two directions
        tA = 1.1;
        fire('ent:damage', { ent: P.ent, amount: rig ? 40 : 6, info: { type: 'bullet', src: E[3] } });
        fire('ent:damage', { ent: P.ent, amount: rig ? 90 : 9, info: { type: 'explosion', src: E[2] } });
        fire('ent:damage', { ent: E[0], amount: 20, info: { type: 'bullet', src: P.ent } });
        fire('shot', { weapon: rig ? 'pulse' : 'rifle', shooter: P.ent, team: 0 });
      }
      if (tB <= 0) { tB = 1.5; const e = FEED[feedI++ % FEED.length]; fire('score', { points: e[1], label: e[0] }); }
      if (tC <= 0) {
        tC = 4.2;
        fire('ace:charging', { ent: E[4], progress: 0.64 });
        fire('ui:message', rig ? { text: 'Skylance ready', sub: 'Hold Q on aircraft, release to launch.', kind: 'good', dur: 4 } : { text: 'Halden Tower levelled', sub: 'Structural collapse on 4th Avenue.', kind: 'info', dur: 4 });
      }
      fire('ace:charging', { ent: E[4], progress: 0.64 });
    },
  };
}
