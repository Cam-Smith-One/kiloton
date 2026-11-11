// DESTRUCT harness. Query: demo=tower|corner|punch|barrels|grab|props|rain|siege, city=1 (real CITY), render=1 (real RENDER), fx=1, t=<seconds to fast-forward>
//   node build.mjs harness/destruct.js h-destruct --dev
//   node tools/shot.mjs dist/h-destruct.html shots/destruct-01.png --q "auto=1&demo=tower&cam=150,30,170,125,12,125" --eval "KT.demoRun(3)"
import { boot } from '../src/boot.js';
import { G, THREE, bus, VS } from '../src/core.js';
import { M } from '../src/materials.js';
import destruct from '../src/destruct.js';
import realCity from '../src/city.js';
import realRender from '../src/render.js';
import realFx from '../src/fx.js';
const P = new URLSearchParams(location.search), demo = P.get('demo') || 'tower';
const use = { destruct };
if (P.has('city')) use.city = realCity;
if (P.has('render')) use.render = realRender;
if (P.has('fx')) use.fx = realFx;
const log = { dmg: [], events: {}, frames: [] };
window.__D = log;
boot({ use, after(G) {
  const hud = document.createElement('pre'); hud.style.cssText = 'position:absolute;left:8px;top:8px;margin:0;color:#fff;font:12px monospace;text-shadow:0 1px 2px #000'; G.uiRoot.appendChild(hud);
  for (const ev of ['collapse', 'building:levelled', 'voxels:destroyed', 'debris:impact', 'fire:start', 'fire:out', 'gas:jet', 'explosion']) bus.on(ev, d => { log.events[ev] = (log.events[ev] || 0) + 1; if (ev === 'collapse' || ev === 'building:levelled') (log[ev] = log[ev] || []).push(Object.assign({ t: +G.time.toFixed(2) }, d)); });
  bus.on('ent:damage', d => log.dmg.push({ t: +G.time.toFixed(2), kind: d.ent.name || d.ent.kind, amt: Math.round(d.amount), type: d.info.type, src: d.info.src ? d.info.src.name : null, hp: Math.round(d.ent.hp) }));
  const markers = [];
  const fireMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85 }), 400); fireMesh.frustumCulled = false; fireMesh.count = 0; if (!P.has('fx')) G.scene.add(fireMesh);
  const _m = new THREE.Matrix4();
  const dummy = (name, kind, x, z, hp, r, h, y) => {
    const e = G.ents.add({ name, kind, team: 1, pos: new THREE.Vector3(x, y == null ? G.grid.topBelow(x, 4.5, z) : y, z), radius: r, height: h, hp });
    const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, h, r * 2), new THREE.MeshBasicMaterial({ color: kind === 'soldier' ? 0xff3020 : 0xff9020 }));
    m.position.set(x, e.pos.y + h / 2, z); G.scene.add(m); markers.push([e, m]); return e;
  };
  const shooter = G.ents.add({ name: 'shooter', kind: 'pilot', team: 0, pos: new THREE.Vector3(5, 2, 5), radius: 0.35, height: 1.8, hp: 1e6 });
  const B = G.city.buildings;
  // pick a building: tallest by default, or b=<index>
  let b = B[0]; for (const q of B) if (q.j1 - q.j0 > b.j1 - b.j0) b = q;
  if (P.has('b')) b = B[+P.get('b')];
  G.demoB = b;
  const cx = (b.i0 + b.i1 + 1) / 2 * VS, cz = (b.k0 + b.k1 + 1) / 2 * VS, gy = b.j0 * VS;
  const script = [];
  const at = (t, fn) => script.push([t, fn]);
  const ringBoom = (t, f) => {       // rockets round the ground storey
    const x0 = b.i0 * VS, x1 = (b.i1 + 1) * VS, z0 = b.k0 * VS, z1 = (b.k1 + 1) * VS; let n = 0;
    const st = +(P.get('step') || 3); for (let x = x0; x <= x1 + 0.1; x += st) for (let z = z0; z <= z1 + 0.1; z += st) { if (f && !f(x, z)) continue; at(t + (n++) * (P.has("slow") ? 0.03 : 0.004), () => G.boom(x, gy + 1.6, z, { radius: 4, power: 170, damage: 100, owner: shooter, kind: 'rocket' })); }
  };
  if (demo === 'tower') {
    dummy('soldier-in', 'soldier', cx, cz, 100, 0.35, 1.8); dummy('rig-in', 'emech', cx + 4, cz + 3, 1800, 1.8, 8.5);
    dummy('soldier-out', 'soldier', b.i0 * VS - 3, cz, 100, 0.35, 1.8); dummy('soldier-far', 'soldier', b.i0 * VS - 14, cz, 100, 0.35, 1.8);
    ringBoom(1);
  } else if (demo === 'corner') {
    ringBoom(1, (x, z) => x < cx - 1 );
  } else if (demo === 'mid') {       // a storey half way up is blown out
    const y = gy + Math.floor((b.j1 - b.j0) / 14) * 3.5 + 1.6;
    for (let x = b.i0 * VS; x <= (b.i1 + 1) * VS; x += 4) for (let z = b.k0 * VS; z <= (b.k1 + 1) * VS; z += 4) at(1, () => G.boom(x, y, z, { radius: 3.4, power: 150, owner: shooter }));
  } else if (demo === 'punch') {
    const x = b.i0 * VS - 1.5, y = gy + 3;
    dummy('soldier-behind', 'soldier', b.i0 * VS + 4, cz, 100, 0.35, 1.8); dummy('rig-behind', 'emech', b.i0 * VS + 6, cz + 2, 1800, 1.8, 8.5);
    at(1, () => { log.punch = G.destruct.punch(x, y, cz, 1, 0, 0, 1.6, 3.5, 120, shooter); });
    at(1.6, () => { log.punch2 = G.destruct.punch(x, y - 1.6, cz + 0.5, 1, 0, 0, 1.6, 3.5, 120, shooter); });
  } else if (demo === 'barrels') {
    const g = G.grid, z = Math.floor((b.k1 + 14)), j = G.GROUND_J;
    for (let n = 0; n < 7; n++) { const i = b.i0 + 4 + n * 5; for (let a = 0; a < 2; a++) for (let c = 0; c < 2; c++) for (let h = 0; h < 3; h++) g.set(i + a, j + h, z + c, M.barrel_red); }
    dummy('soldier-barrel', 'soldier', (b.i0 + 4 + 6 * 5) * VS + 1.6, z * VS + 0.5, 100, 0.35, 1.8);
    at(1, () => G.boom((b.i0 + 4.5) * VS, (j + 1) * VS, (z + 0.5) * VS, { radius: 1.2, power: 60, owner: shooter }));
  } else if (demo === 'grab') {
    at(1, () => { const ch = G.destruct.grabChunk(b.i0 * VS, gy + 3, cz, 2.2); log.grab = ch && { mass: ch.mass, size: ch.size, voxels: ch.voxels }; G.heldChunk = ch; if (ch) { G.scene.add(ch.object); ch.object.position.set(b.i0 * VS - 8, gy + 8, cz); } });
    dummy('rig-target', 'emech', b.i0 * VS - 22, cz, 1800, 1.8, 8.5);
    at(1.5, () => { const ch = G.heldChunk; if (ch) G.destruct.releaseChunk(ch, ch.object.position.clone(), new THREE.Vector3(-22, 3, 0), shooter); });
  } else if (demo === 'props') {      // a free-standing post and a T shape outside any building
    const g = G.grid, i = b.i0 - 20, k = b.k0 + 10, j = G.GROUND_J;
    for (let h = 0; h < 14; h++) g.set(i, j + h, k, M.steel_beam);
    for (let a = -5; a <= 5; a++) g.set(i + a, j + 13, k, M.metal_panel);
    for (let h = 0; h < 10; h++) g.set(i, j + h, k + 12, M.trunk);
    for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let h = 9; h < 14; h++) g.set(i + a, j + h, k + 12 + c, M.foliage);
    at(1, () => G.boom(i * VS, (j + 2) * VS, k * VS, { radius: 1.2, power: 200, owner: shooter }));
    at(1.2, () => G.destruct.impact(i * VS + 0.25, (j + 2) * VS, (k + 12) * VS + 0.25, 0, 0, 1, 80, 0.6));
    at(1.5, () => G.destruct.carveBox((b.i0 - 2) * VS, gy, (b.k0 + 4) * VS, (b.i0 + 3) * VS, gy + 4, (b.k0 + 12) * VS, 200, true));
    at(1.5, () => G.destruct.burst(cx, gy + 20, b.k1 * VS + 8, { count: 60, colors: [0x2ee6ff, 0x33383f, 0xff7a1a], speed: 12, size: 0.4, up: 0.5 }));
  } else if (demo === 'fire') {       // furnished wooden interior on the ground floor + a tree outside; lit by one small ignite
    const g = G.grid, j = b.j0;
    for (let k = b.k0 + 2; k <= b.k1 - 2; k += 3) for (let i = b.i0 + 2; i <= b.i1 - 2; i += 3) { if (((i + k) % 7) < 4) for (let h = 0; h < 2; h++) { g.set(i, j + h, k, M.furniture); g.set(i + 1, j + h, k, M.furniture); } else g.set(i, j, k, M.crate); }
    for (let i = b.i0 + 1; i < b.i1; i++) for (let h = 0; h < 6; h++) g.set(i, j + h, b.k0 + 12, M.wood);          // wooden partition
    for (let k = b.k0 + 1; k < b.k1; k++) for (let i = b.i0 + 1; i < b.i0 + 14; i++) if (g.get(i, j + 6, k) === M.floor) g.set(i, j + 6, k, M.wood_dark);   // a timber floor bay
    const ti = b.i0 - 10, tk = b.k0 + 8; for (let h = 0; h < 9; h++) g.set(ti, j + h, tk, M.trunk);
    for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let h = 7; h < 12; h++) if (a * a + c * c + (h - 9) * (h - 9) < 12) g.set(ti + a, j + h, tk + c, M.foliage);
    dummy('soldier-fire', 'soldier', (b.i0 + 5.5) * VS, (b.k0 + 6.5) * VS, 100, 0.35, 1.8);
    at(1, () => { log.lit = G.destruct.ignite((b.i0 + 3) * VS, gy + 0.5, (b.k0 + 3) * VS, 1.5, 1, shooter); log.lit2 = G.destruct.ignite(ti * VS, gy + 4.5, tk * VS, 1.2, 1, shooter); });
    at(0.9, () => G.destruct.carveBox((b.i0) * VS, gy, (b.k0 + 2) * VS, (b.i0 + 1) * VS, gy + 3, (b.k1 - 2) * VS, 250, false));     // open the wall so the camera sees in
  } else if (demo === 'gas') {        // a gas main one voxel under the road with a riser into the building; one end is broken
    const g = G.grid, j = G.GROUND_J - 2, k = b.k1 + 16;
    for (let i = b.i0 - 30; i <= b.i1 + 30; i++) g.set(i, j, k, M.gas_pipe);
    for (let kk = b.k1 + 1; kk < k; kk++) g.set(b.i0 + 10, j, kk, M.gas_pipe);
    for (let h = j; h < b.j0 + 5; h++) g.set(b.i0 + 10, h, b.k1, M.gas_pipe);
    dummy('soldier-gas', 'soldier', (b.i0 + 20) * VS, k * VS + 0.25, 100, 0.35, 1.8);
    at(1, () => G.boom((b.i0 - 29) * VS, (j + 1.5) * VS, (k + 0.5) * VS, { radius: 1.6, power: 140, owner: shooter }));
  } else if (demo === 'tank') {       // a tanker-sized fuel tank and a row of crates
    const g = G.grid, j = G.GROUND_J, k = b.k1 + 14, i = b.i0 + 6;
    for (let a = 0; a < 12; a++) for (let c = 0; c < 5; c++) for (let h = 1; h < 6; h++) if (a === 0 || a === 11 || c === 0 || c === 4 || h === 1 || h === 5) g.set(i + a, j + h, k + c, M.fuel_tank);
    for (let a = 0; a < 6; a++) g.set(i + 16 + a * 2, j, k + 2, M.crate);
    dummy('soldier-tank', 'soldier', (i + 20) * VS, (k + 6) * VS, 100, 0.35, 1.8); dummy('rig-tank', 'emech', (i + 6) * VS, (k + 14) * VS, 1800, 1.8, 8.5);
    at(1, () => G.destruct.impact((i + 6) * VS, (j + 3) * VS, (k + 0.5) * VS, 0, 0, 1, 200, 0.6, { owner: shooter }));
  } else if (demo === 'siege') {      // sustained random fire on every building
    for (let n = 0; n < 240; n++) at(1 + n * 0.08, () => { const q = B[(Math.random() * B.length) | 0]; G.boom((q.i0 + Math.random() * (q.i1 - q.i0)) * VS, (q.j0 + Math.random() * Math.min(20, q.j1 - q.j0)) * VS, (q.k0 + Math.random() * (q.k1 - q.k0)) * VS, { radius: 2.5 + Math.random() * 2.5, power: 150, owner: shooter }); });
  }
  script.sort((a, c) => a[0] - c[0]);
  let si = 0;
  bus.on('game:start', () => { si = 0; });
  // runs inside the frame loop via a fake module-ish hook on the bus-free path: poll G.time each update
  const orig = destruct.update.bind(destruct);
  destruct.update = (dt) => {
    while (si < script.length && G.time >= script[si][0]) script[si++][1]();
    const t0 = performance.now(); orig(dt); const ms = performance.now() - t0;
    log.frames.push(ms); if (log.frames.length > 4000) log.frames.shift();
    for (const [e, m] of markers) m.visible = e.alive;
    { const F = destruct.fires; for (let n = 0; n < F.count; n++) { const sc = 0.5 + F.heat[n] * (0.9 + 0.5 * Math.sin(G.time * 20 + n)); _m.makeScale(sc, sc * 1.6, sc); _m.setPosition(F.x[n], F.y[n] + 0.3, F.z[n]); fireMesh.setMatrixAt(n, _m); } fireMesh.count = F.count; fireMesh.instanceMatrix.needsUpdate = true; }
    const s = destruct.stats;
    hud.textContent = `t ${G.time.toFixed(2)}  bodies ${s.bodies}  bits ${s.debris}  pending ${s.pending}  fires ${s.fires} jets ${destruct.jets.count}  ms ${ms.toFixed(2)} avg ${s.ms.toFixed(2)} max ${s.msMax.toFixed(1)}\nchecks ${s.checks} collapses ${s.collapses} deposited ${s.deposited} destroyed ${G.state.stats.voxelsDestroyed} levelled ${G.state.stats.buildingsLevelled}`;
  };
  // fast-forward helper for --eval: run `sec` seconds of simulation, return a summary
  G.demoRun = (sec) => {
    const n = Math.round(sec * 60), f0 = log.frames.length; G.debugStep(n, 1 / 60);
    const fr = log.frames.slice(f0); let sum = 0, mx = 0, over4 = 0; for (const v of fr) { sum += v; if (v > mx) mx = v; if (v > 4) over4++; }
    const s = destruct.stats;
    return { t: +G.time.toFixed(2), avgMs: +(sum / fr.length).toFixed(2), maxMs: +mx.toFixed(1), over4, bodies: s.bodies, bits: s.debris, pending: s.pending, collapses: log.collapse, levelled: log['building:levelled'], events: log.events, dmg: log.dmg.slice(-14), destroyed: G.state.stats.voxelsDestroyed, grab: log.grab, punch: log.punch, fires: s.fires, jets: destruct.jets.count, prof: s.prof.map(v => +v.toFixed(1)) };
  };
  // count solid voxels that are not connected to the ground inside the demo building's box (+margin)
  G.floaters = () => {
    const g = G.grid, d = g.data, NX = G.NX, NZ = G.NZ, NY = G.NY, seen = new Uint8Array(d.length), st = [];
    for (let k = 0; k < NZ; k++) for (let i = 0; i < NX; i++) { const o = i + NX * (k + NZ * 1); if (d[o]) { seen[o] = 1; st.push(o); } }
    const L = NX * NZ;
    while (st.length) { const o = st.pop(); const i = o % NX; for (const dd of [1, -1, NX, -NX, L, -L]) { const q = o + dd; if (q < 0 || q >= d.length || seen[q] || !d[q]) continue; if ((dd === 1 && i === NX - 1) || (dd === -1 && i === 0)) continue; seen[q] = 1; st.push(q); } }
    let n = 0; const ex = []; for (let o = L; o < d.length; o++) if (d[o] && !seen[o]) { n++; if (ex.length < 5) ex.push([o % NX, Math.floor(o / L), Math.floor(o / NX) % NZ, d[o]]); }
    return { floating: n, ex };
  };
  if (P.has('t')) setTimeout(() => G.demoRun(+P.get('t')), 0);
} });
