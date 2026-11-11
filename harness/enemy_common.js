// Shared harness tooling for ENEMY: stand-in player, damage accounting, top-down debug map.
import { THREE, bus } from '../src/core.js';

export function installHarness(G, wantStandin) {
  const P = G.params, mode = P.get('standin') || (wantStandin ? 'still' : 'none');
  const h = G.h = { dmg: {}, dealt: 0, t0: 0, events: {}, standin: null, trail: [] };
  const count = (n) => bus.on(n, () => { h.events[n] = (h.events[n] || 0) + 1; });
  ['wave:start', 'wave:clear', 'mech:incoming', 'mech:land', 'ace:called', 'ace:charging', 'punch', 'slam', 'jet', 'footstep', 'ui:message', 'lock:warning', 'explosion', 'shot'].forEach(count);
  h.msgs = []; bus.on('ui:message', m => h.msgs.push(m.text));
  bus.on('ent:damage', d => { if (d.ent.team === 0) { const k = d.info && d.info.src ? (d.info.src.variant || d.info.src.kind) : (d.info && d.info.type) || '?'; h.dmg[k] = (h.dmg[k] || 0) + d.amount; h.dealt += d.amount; } });
  let ent = null, mesh = null, t = 0;
  function makeStandin() {
    const rig = mode.startsWith('rig'), s = G.city.spawns.player;
    const sx = P.has('px') ? +P.get('px') : s.x, sz = P.has('pz') ? +P.get('pz') : s.z;
    const hp = +(P.get('hp') || 1e9);
    ent = G.ents.add({ kind: rig ? 'mech' : 'pilot', team: 0, isPlayer: true, pos: new THREE.Vector3(sx, G.grid.topBelow(sx, 5.4, sz), sz), vel: new THREE.Vector3(), radius: rig ? 1.8 : 0.35, height: rig ? 8.5 : 1.8, hp, maxHp: hp });
    ent.body = { pos: ent.pos, vel: ent.vel, hw: rig ? 1.6 : 0.32, h: ent.height, stepUp: rig ? 1.5 : 0.5, onGround: false };
    G.state.player.ent = ent; if (rig) { G.state.player.mech = ent; G.state.player.mode = 'mech'; } else G.state.player.pilot = ent;
    mesh = new THREE.Mesh(new THREE.BoxGeometry(ent.radius * 2, ent.height, ent.radius * 2), new THREE.MeshStandardMaterial({ color: 0x39c6b0, emissive: 0x0a4a44 }));
    G.scene.add(mesh); h.standin = ent; h.cx = sx; h.cz = sz;
  }
  bus.on('game:start', () => { if (mode !== 'none') { if (mesh) mesh.removeFromParent(); makeStandin(); } h.dmg = {}; h.dealt = 0; h.t0 = G.time; });
  // stand-in mover runs as a tiny module-like hook on the frame via bus-free polling of G.time
  let lastT = 0;
  const tick = () => {
    const dt = G.time - lastT; lastT = G.time;
    if (ent && ent.alive && dt > 0 && dt < 0.2) {
      t += dt;
      if (mode.endsWith('loop')) {
        const R = +(P.get('loopr') || 14), w = (mode === 'rigloop' ? 5 : 5.5) / R;
        const tx = h.cx + Math.sin(t * w) * R, tz = h.cz + Math.cos(t * w) * R;
        ent.vel.x = (tx - ent.pos.x) * 4; ent.vel.z = (tz - ent.pos.z) * 4;
      } else { ent.vel.x *= 0.9; ent.vel.z *= 0.9; }
      ent.vel.y -= 24 * dt; G.grid.moveBody(ent.body, dt); G.grid.unstick(ent.body, 8);
      mesh.position.set(ent.pos.x, ent.pos.y + ent.height / 2, ent.pos.z);
    }
  };
  const origUpdate = G.enemy.update.bind(G.enemy);
  const follow = (P.get('follow') || '').split(',').map(Number);   // follow=height,back[,side]: camera rides above the target
  if (P.has('follow') || P.get('map') === '0') for (const el of G.uiRoot.children) if (/baseline/.test(el.textContent)) el.style.display = 'none';
  G.enemy.update = (dt) => { tick(); origUpdate(dt);
    if (P.has('follow')) { const t = G.state.player.ent || G.state.player.pilot; if (t) { G.camera.position.set(t.pos.x + (follow[2] || 0), t.pos.y + (follow[0] || 40), t.pos.z + (follow[1] || 30)); G.camera.lookAt(t.pos.x, t.pos.y + 2, t.pos.z); } } if (map) { trail(); const n = performance.now(); if (n - lastDraw > 120) { lastDraw = n; drawMap(); } } };
  h.run = (sec, dt = 1 / 30) => { G.debugStep(Math.round(sec / dt), dt); return h.report(); };
  h.report = () => {
    const E = G.enemy, el = Math.max(0.01, G.time - h.t0), by = {};
    for (const u of E.list) { const k = u.variant; by[k] = (by[k] || 0) + 1; }
    let minD = 1e9, maxD = 0, sumD = 0, stuck = 0, los = 0;
    for (const u of E.list) { minD = Math.min(minD, u.dist); maxD = Math.max(maxD, u.dist); sumD += u.dist; if (u.stuck >= 2) stuck++; if (u.los) los++; }
    const r = (x) => +x.toFixed(2);
    const dps = {}; for (const k in h.dmg) dps[k] = r(h.dmg[k] / el);
    return { t: r(G.time), wave: Object.assign({}, G.state.wave), units: E.list.length, by, minD: r(minD), avgD: r(sumD / Math.max(1, E.list.length)), maxD: r(maxD), los, stuck, reloc: E.stats.relocations,
      aiMs: r(E.stats.ms), peakMs: r(E.stats.peakMs), modelMs: r(E.stats.modelMs), dps, dpsTotal: r(h.dealt / el), tokens: E.tokens.used + '/' + E.tokens.max, ev: h.events, msgs: h.msgs.slice(-6), hp: ent ? ent.hp : null };
  };
  h.units = () => G.enemy.list.map(u => ({ k: u.variant, st: u.st, x: +u.ent.pos.x.toFixed(1), y: +u.ent.pos.y.toFixed(1), z: +u.ent.pos.z.toFixed(1), d: +u.dist.toFixed(1), los: u.los, stuck: u.stuck, hp: u.ent.hp }));
  // measure the module's own cpu per update over n steps (ms): avg and worst
  h.cost = (n = 300, dt = 1 / 60) => { let sum = 0, worst = 0, wd = null, navSum = 0; const all = [], ty = [0, 0, 0, 0, 0]; for (let i = 0; i < n; i++) { G.time += dt; G.dt = dt; G.frame++; const a = performance.now(); origUpdate(dt); const m = G.enemy.stats.lastMs; all.push(m); sum += m; if (m > worst) { wd = [G.enemy.stats.navMs.toFixed(2), G.enemy.stats.typeMs.map(v => +v.toFixed(2)), G.enemy.stats.thinks]; } navSum += G.enemy.stats.navMs; for (let q = 0; q < 5; q++) ty[q] += G.enemy.stats.typeMs[q]; if (m > worst) worst = m; G.combat.update && G.combat.update(dt); G.destruct.update && G.destruct.update(dt); } all.sort((x, y) => x - y); return { avg: +(sum / n).toFixed(3), p50: +all[n >> 1].toFixed(3), p95: +all[(n * 0.95) | 0].toFixed(3), p99: +all[(n * 0.99) | 0].toFixed(3), worst: +worst.toFixed(2), wd, nav: +(navSum / n).toFixed(3), ty: ty.map(v => +(v / n).toFixed(3)), units: G.enemy.list.length, model: +G.enemy.stats.modelMs.toFixed(3) }; };

  // ---- top-down map: nav cost, flow distance, units with trails ----
  let map = null, ctx = null, base = null, baseT = -9;
  const SC = 4, COL = { rifle: '#ff7a5a', rocketeer: '#ffd23e', ace: '#ff3bd0', drone: '#9be0ff', tank: '#ff9a2e', gunship: '#c9a0ff', standard: '#ff2a2a', heavy: '#ff0000' };
  if (P.get('map') !== '0') {
    map = document.createElement('canvas'); map.width = map.height = 96 * SC;
    map.style.cssText = 'position:absolute;right:8px;top:8px;width:' + (P.get('map') === 'big' ? 700 : 384) + 'px;image-rendering:pixelated;border:1px solid #fff4;background:#000';
    G.uiRoot.appendChild(map); ctx = map.getContext('2d', { willReadFrequently: true });
    base = document.createElement('canvas'); base.width = base.height = 96;
  }
  const trails = new Map(); let lastDraw = 0;
  function trail() { if (G.frame % 6) return; for (const u of G.enemy.list) { let tr = trails.get(u.id); if (!tr) trails.set(u.id, tr = []); tr.push(u.ent.pos.x, u.ent.pos.z); if (tr.length > 240) tr.splice(0, 2); } }
  function drawMap() {
    const nav = G.enemy.nav, W = nav.W;
    if (G.time - baseT > 0.5) {
      baseT = G.time; const b = base.getContext('2d'), img = b.createImageData(96, 96), f = nav.fields[+(P.get('field') || 0)];
      for (let c = 0; c < nav.N; c++) {
        let r = 20, g = 22, bl = 26;
        if (!nav.passS[c]) { r = 70; g = 70; bl = 78; if (nav.obR[c] === 3) { r = 110; g = 110; bl = 120; } }
        else { const d = f.valid ? f.dist[c] : Infinity; if (d !== Infinity) { const k = (d % 40) / 40; g = 30 + 50 * k; bl = 50 + 40 * (1 - k); } else { r = 60; g = 10; bl = 40; } if (nav.costS[c] > 1) r += 30; }
        img.data[c * 4] = r; img.data[c * 4 + 1] = g; img.data[c * 4 + 2] = bl; img.data[c * 4 + 3] = 255;
      }
      b.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = false; ctx.drawImage(base, 0, 0, 96 * SC, 96 * SC);
    const k = SC / 2;
    for (const u of G.enemy.list) {
      const tr = trails.get(u.id) || [];
      ctx.strokeStyle = COL[u.variant] + '88'; ctx.lineWidth = 1; ctx.beginPath();
      for (let i = 0; i < tr.length; i += 2) { if (i) ctx.lineTo(tr[i] * k, tr[i + 1] * k); else ctx.moveTo(tr[i] * k, tr[i + 1] * k); }
      ctx.stroke();
      ctx.fillStyle = COL[u.variant] || '#fff'; const s = u.kind === 'soldier' ? 3 : u.kind === 'drone' ? 3 : 6;
      ctx.fillRect(u.ent.pos.x * k - s / 2, u.ent.pos.z * k - s / 2, s, s);
      if (u.los) { ctx.fillStyle = '#fff'; ctx.fillRect(u.ent.pos.x * k - 0.5, u.ent.pos.z * k - 0.5, 1, 1); }
      if (u.coverC >= 0) { ctx.strokeStyle = '#5f5'; ctx.strokeRect(nav.cellX(u.coverC) * k - 2, nav.cellZ(u.coverC) * k - 2, 4, 4); }
    }
    const t = G.state.player.ent || G.state.player.pilot;
    if (t) { ctx.fillStyle = '#3ff'; ctx.beginPath(); ctx.arc(t.pos.x * k, t.pos.z * k, 4, 0, 6.3); ctx.fill(); }
    ctx.fillStyle = '#fff'; ctx.font = '11px monospace';
    ctx.fillText(`wave ${G.state.wave.n} alive ${G.state.wave.alive}/${G.state.wave.total} units ${G.enemy.list.length} ai ${G.enemy.stats.ms.toFixed(2)}ms t ${G.time.toFixed(0)}`, 4, 12);
  }
}
