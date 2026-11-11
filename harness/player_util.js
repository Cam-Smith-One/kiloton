// Shared helpers for the PLAYER harnesses.
import { THREE, bus } from '../src/core.js';
export function installGrabStub(G) {
  // baseline destruct cannot hand out chunks: give the rig something to hold so grab / throw can be exercised
  if (G.destruct.grabChunk && G.destruct.grabChunk(0, -99, 0, 1) === null && !G.destruct.releaseChunk) {
    G.destruct.grabChunk = (x, y, z, r) => {
      const n = G.destruct.explode(x, y, z, r * 0.8, 200); if (!n) return null;
      const object = new THREE.Mesh(new THREE.BoxGeometry(r, r, r), new THREE.MeshStandardMaterial({ color: 0x8a8d90 }));
      object.position.set(x, y, z);
      return { object, mass: n * 30, size: r, voxels: n };
    };
  }
}
export function installDummies(G) {
  if (!G.params.has('dummies')) return;
  const sp = G.city.spawns.player, list = [];
  const add = (kind, dx, dy, dz, hp, airborne) => {
    const m = G.models.create(kind);
    const e = { kind, team: 1, pos: new THREE.Vector3(sp.x + dx, 2 + dy, sp.z + dz), vel: new THREE.Vector3(), radius: m.radius, height: m.height, hp, airborne: !!airborne, rig: m };
    m.root.position.copy(e.pos); G.scene.add(m.root); G.ents.add(e); list.push(e);
    e.onDeath = () => { m.root.removeFromParent(); G.ents.remove(e); };
    return e;
  };
  const spawnAll = () => {
    list.length = 0;
    for (let n = 0; n < 5; n++) add('soldier', -6 + n * 3, 0, 14, 40);
    add('tank', 10, 0, 22, 600); add('emech', -14, 0, 30, 1500);
    add('drone', -4, 14, 26, 60, true); add('drone', 4, 16, 28, 60, true); add('drone', 0, 20, 34, 60, true); add('gunship', 12, 22, 40, 300, true);
  };
  spawnAll();
  bus.on('game:start', () => { if (!G.ents.list.some(e => e.team === 1)) spawnAll(); });
  G.dummies = list;
  // keep models glued to entities that get knocked around
  const up = G.enemy.update; G.enemy.update = (dt) => { up && up.call(G.enemy, dt); for (const e of list) if (e.alive) { if (!e.airborne) { e.pos.x += e.vel.x * dt; e.pos.z += e.vel.z * dt; e.vel.multiplyScalar(Math.exp(-3 * dt)); } e.rig.root.position.copy(e.pos); } };
}
// Minimal look-dev HUD (crosshair + state line) and scripted-input helpers:  PT.hold('KeyW'); PT.step(60); PT.info()
export function installHud(G) {
  for (const el of Array.from(G.uiRoot.children)) el.style.display = 'none';
  const x = document.createElement('div');
  x.style.cssText = 'position:absolute;left:50%;top:50%;width:18px;height:18px;margin:-9px 0 0 -9px;border:1.5px solid #9ff;border-radius:50%;box-shadow:0 0 0 1px #0008';
  const t = document.createElement('div');
  t.style.cssText = 'position:absolute;left:12px;bottom:10px;color:#bff;font:12px/1.4 monospace;white-space:pre;text-shadow:0 1px 2px #000';
  if (!G.params.has('nohud')) G.uiRoot.append(x, t);
  const up = G.ui.update;
  G.ui.update = (dt) => {
    up && up.call(G.ui, dt); for (const el of Array.from(G.uiRoot.children)) if (el !== x && el !== t) el.style.display = 'none';
    const p = G.state.player, e = p.ent; if (!e) return;
    t.textContent = `${p.mode}  hp ${Math.round(e.hp)}/${e.maxHp}  meter ${(p.meter * 100).toFixed(0)}%${p.mechReady ? ' READY' : ''}${p.mechIncoming ? '  eta ' + p.mechIncoming.toFixed(1) : ''}  jet ${(p.jet * 100).toFixed(0)}  kills ${p.kills}  score ${p.score}  x${p.combo}\n` +
      p.weapons.map(w => `${w.name} ${w.clip ?? ''} h${(w.heat || 0).toFixed(2)} c${(w.charge ?? 1).toFixed(2)}`).join(' | ') + `\n${p.prompt}`;
  };
  const I = G.input;
  window.PT = {
    hold(...c) { for (const k of c) I._q.push([0, k]); }, release(...c) { for (const k of c) I._q.push([1, k]); },
    tap(c, n = 1) { I._q.push([0, c]); G.debugStep(n); I._q.push([1, c]); G.debugStep(1); },
    btn(b, down) { I._q.push([down ? 2 : 3, b]); },
    mouse(dx, dy) { I.fallbackLook = true; I._ax += dx; I._ay += dy; },
    step(n = 60, dt = 1 / 60) { return G.debugStep(n, dt); },
    info() { return G.player.debug.info(); },
  };
}
