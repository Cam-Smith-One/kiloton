// FX demo driver shared by harness/fx.js (baseline renderer + look-dev post) and harness/fx_real.js (real modules).
//   ?demo=<name>&t=<age seconds>&hold=<timescale after the fast-forward, default 0.02>
// Each demo fires its effect(s) by faking the bus events other modules will send, then fast-forwards the
// simulation to age `t` with KT.debugStep so a slow headless frame captures exactly that moment.
import { bus } from '../src/core.js';
import { M } from '../src/materials.js';

// centre of the baseline intersection; real city demos pass their own origin with ?at=x,z
export function runDemo(G) {
  const P = G.params, name = P.get('demo') || 'explosion', T = parseFloat(P.get('t') || '0.5');
  const at = (P.get('at') || '100,100').split(',').map(Number), X = at[0], Z = at[1], Y = G.GROUND_Y;
  const fx = G.fx; G.M = M;
  const fakeEnt = (kind, team, x, y, z, r, h) => ({ kind, team, pos: new G.THREE.Vector3(x, y, z), vel: new G.THREE.Vector3(), radius: r, height: h, hp: 0, maxHp: 100, alive: false });
  let tick = null;
  const D = {
    explosion() { G.boom(X, Y + 0.6, Z, { radius: 3, power: 130, kind: 'rocket' }); },
    big() { G.boom(X, Y + 1, Z, { radius: 6.5, power: 170, kind: 'shell' }); },
    airburst() { bus.emit('explosion', { x: X, y: Y + 14, z: Z, radius: 3.5, power: 120, kind: 'rocket' }); },
    wall() { G.boom(95.2, Y + 5, 84, { radius: 3.2, power: 140, kind: 'rocket' }); },
    salvo() {
      let n = 0;
      tick = t => { while (n < 6 && t >= n * 0.12) { const a = n * 1.9; G.boom(X + Math.cos(a) * 5, Y + 0.6, Z + Math.sin(a) * 4 - 2, { radius: 3.4, power: 130, kind: 'rocket' }); n++; } };
    },
    pulse() {
      let n = 0;
      tick = t => {
        while (t >= n * 0.11 && n < 40) {
          const k = n % 2, s = k ? 1 : -1;
          // player rig (left, cyan) and a Vanta rig (right, orange) trading fire across the street
          const ox = X - 14, oz = Z + 6, tx = X + 14 + (n % 5) - 2, ty = Y + 2 + (n % 3) * 1.5, tz = Z - 8 + (n % 4);
          if ((n >> 1) % 2 === 0) {
            bus.emit('shot', { weapon: 'pulse', x: ox, y: Y + 6, z: oz + s * 1.6, dx: 0.9, dy: -0.1, dz: -0.4, team: 0 });
            bus.emit('tracer', { weapon: 'pulse', x0: ox, y0: Y + 6, z0: oz + s * 1.6, x1: tx, y1: ty, z1: tz, team: 0 });
            bus.emit('impact', { weapon: 'pulse', x: tx, y: ty, z: tz, nx: -1, ny: 0, nz: 0, mat: 8, power: 110, team: 0 });
          } else {
            bus.emit('shot', { weapon: 'e_pulse', x: X + 13, y: Y + 6, z: Z - 6 + s * 1.6, dx: -0.9, dy: -0.1, dz: 0.4, team: 1 });
            bus.emit('tracer', { weapon: 'e_pulse', x0: X + 13, y0: Y + 6, z0: Z - 6 + s * 1.6, x1: X - 12 + (n % 3), y1: Y + 1 + (n % 4), z1: Z + 5 + (n % 5), team: 1 });
            bus.emit('explosion', { x: X - 12 + (n % 3), y: Y + 1 + (n % 4), z: Z + 5 + (n % 5), radius: 1.6, power: 110, kind: 'pulse', owner: { team: 1 } });
          }
          n++;
        }
      };
    },
    bullets() {
      let n = 0;
      const mats = [8, 14, 17, 11, 15, 2, 20];
      tick = t => {
        while (t >= n * 0.07 && n < 80) {
          const m = mats[n % mats.length], col = n % 7, tx = X - 6 + col * 2, ty = Y + 0.05, tz = Z - 2 + ((n * 7) % 5) * 0.4;
          bus.emit('shot', { weapon: n % 3 ? 'rifle' : 'e_rifle', x: X - 3 + (n % 3) * 3, y: Y + 1.5, z: Z + 9, dx: 0, dy: 0, dz: -1, team: n % 3 ? 0 : 1 });
          bus.emit('tracer', { weapon: n % 3 ? 'rifle' : 'e_rifle', x0: X - 3 + (n % 3) * 3, y0: Y + 1.5, z0: Z + 9, x1: tx, y1: ty, z1: tz, team: n % 3 ? 0 : 1 });
          bus.emit('impact', { weapon: 'rifle', x: tx, y: ty, z: tz, nx: 0, ny: 1, nz: 0, mat: m, power: 30 });
          n++;
        }
      };
    },
    muzzle() {
      let n = 0;
      tick = t => {
        while (t >= n * 0.5 && n < 20) {
          bus.emit('shot', { weapon: 'rifle', x: X - 6, y: Y + 1.5, z: Z, dx: 0, dy: 0, dz: 1, team: 0 });
          bus.emit('shot', { weapon: 'pulse', x: X - 3, y: Y + 1.5, z: Z, dx: 0, dy: 0, dz: 1, team: 0 });
          bus.emit('shot', { weapon: 'e_pulse', x: X, y: Y + 1.5, z: Z, dx: 0, dy: 0, dz: 1, team: 1 });
          bus.emit('shot', { weapon: 'launcher', x: X + 3, y: Y + 1.5, z: Z, dx: 0, dy: 0, dz: 1, team: 0 });
          bus.emit('shot', { weapon: 'e_shell', x: X + 7, y: Y + 2, z: Z, dx: 0, dy: 0.1, dz: 1, team: 1 });
          n++;
        }
      };
    },
    trails() {
      tick = (t, dt) => {
        // three projectiles flying left to right: rocket, missile (curving up), shell (lobbed)
        const x = X - 30 + ((t * 38) % 70);
        fx.emit('trail_rocket', x, Y + 3, Z, 38, 0, 0, 1);
        const mx = X - 30 + ((t * 30) % 70), my = Y + 6 + Math.sin(mx * 0.12) * 3;
        fx.emit('trail_missile', mx, my, Z - 3, 30, Math.cos(mx * 0.12) * 10, 0, 1);
        const sx = X - 30 + ((t * 26) % 70), u = ((t * 26) % 70) / 70;
        fx.emit('trail_shell', sx, Y + 2 + 24 * u * (1 - u), Z - 7, 26, 24 * (1 - 2 * u), 0, 1);
      };
    },
    jet() {
      tick = t => {
        const h = Y + 1 + Math.min(9, t * 4);
        fx.emit('jet', X - 1.1, h, Z, 0, -1, 0, 1); fx.emit('jet', X + 1.1, h, Z, 0, -1, 0, 1);
        fx.emit('jet', X + 9, Y + 2.4, Z, 0.2, -1, 0, 0.3);          // pilot jetpack
        fx.emit('fire', X - 9, Y + 0.1, Z, 0, 0, 0, 1);
        fx.emit('smoke', X - 14, Y + 0.3, Z + 2, 0, 0, 0, 1);
        fx.emit('steam', X + 14, Y + 0.3, Z + 2, 0, 0, 0, 1);
        fx.emit('ember', X - 9, Y + 1, Z, 0, 0, 0, 1);
      };
    },
    steps() {
      let n = 0;
      tick = t => { while (t >= n * 0.55 && n < 30) { bus.emit('footstep', { x: X - 8 + n * 2.2, y: Y, z: Z + (n % 2 ? 1.2 : -1.2), heavy: true, kind: 'mech', team: 0 }); bus.emit('footstep', { x: X - 4 + n * 0.8, y: Y, z: Z + 7, heavy: false, kind: 'pilot', team: 0 }); n++; } };
    },
    drop() {
      const eta = parseFloat(P.get('eta') || '3.5'); let landed = false;
      bus.emit('mech:incoming', { x: X, z: Z, team: +(P.get('team') || 0), eta });
      tick = t => { if (!landed && t >= eta) { landed = true; G.boom(X, Y + 0.5, Z, { radius: 7, power: 150, kind: 'mech' }); bus.emit('mech:land', { x: X, y: Y, z: Z, team: +(P.get('team') || 0) }); } };
    },
    slam() { bus.emit('slam', { x: X, y: Y, z: Z, radius: 9, team: +(P.get('team') || 0) }); bus.emit('explosion', { x: X, y: Y, z: Z, radius: 6, power: 100, kind: 'slam', owner: { team: 0 } }); },
    punch() { bus.emit('punch', { x: 95.2, y: Y + 5, z: 84, dx: -1, dy: 0, dz: 0, hit: true, team: 0 }); G.destruct.punch(95.2, Y + 5, 84, -1, 0, 0, 1.6, 3, 160); },
    eject() {
      let done = false;
      bus.emit('mech:eject', { ent: null, x: X, y: Y + 8, z: Z });
      tick = t => { if (!done && t >= 1.1) { done = true; G.boom(X, Y + 4, Z, { radius: 12, power: 200, kind: 'mech' }); bus.emit('mech:selfdestruct', { ent: null, x: X, y: Y + 4, z: Z }); } };
    },
    selfdestruct() { G.boom(X, Y + 4, Z, { radius: 12, power: 200, kind: 'mech' }); bus.emit('mech:selfdestruct', { ent: null, x: X, y: Y + 4, z: Z }); },
    collapse() {
      // a tower's worth of clusters letting go over a second, plus the debris that follows
      let n = 0;
      const bx = +(P.get('bx') || 116), bz = +(P.get('bz') || 116);
      tick = t => {
        while (t >= n * 0.18 && n < 7) { bus.emit('collapse', { x: bx + (n % 3) - 1, y: Y + 30 - n * 3, z: bz + (n % 2), mass: 2600, height: 10 }); n++; }
        if (t > 1.2 && t < 4 && Math.random() < 0.5) bus.emit('debris:impact', { x: bx + (Math.random() - 0.5) * 22, y: Y, z: bz + (Math.random() - 0.5) * 22, speed: 14, mass: 12, mat: 8 });
        if (t > 3 && n === 7) { n++; bus.emit('building:levelled', { id: 3, name: 'Block 3' }); }
      };
    },
    glass() {
      let n = 0;
      tick = t => { while (t >= n * 0.25 && n < 12) { bus.emit('voxels:destroyed', { x: 95.2, y: Y + 3 + (n % 4) * 2.5, z: 78 + n * 1.0, count: 24, mat: 17, radius: 1.4 }); bus.emit('voxels:destroyed', { x: X - 3 + n, y: Y + 3, z: Z, count: 12, mat: n % 2 ? 36 : 11, radius: 1 }); n++; } };
    },
    deaths() {
      const kinds = ['soldier', 'drone', 'tank', 'gunship', 'emech'];
      let n = 0;
      tick = t => { while (t >= n * 0.6 && n < kinds.length) { const k = kinds[n], air = k === 'drone' || k === 'gunship'; bus.emit('ent:death', { ent: fakeEnt(k, 1, X - 16 + n * 8, Y + (air ? 12 : 0), Z, k === 'emech' ? 1.8 : 1, k === 'emech' ? 8.5 : 2), info: {} }); n++; } };
    },
    fires() {
      fx.burst('fire', X - 6, Y + 0.1, Z, 1.2, { dur: 60 }); fx.burst('fire', X + 1, Y + 0.1, Z + 2, 0.8, { dur: 60 }); fx.burst('fire', X + 7, Y + 0.1, Z - 1, 1.6, { dur: 60 });
      fx.burst('smokecolumn', X + 7, Y + 1, Z - 1, 2, { dur: 60 });
    },
    // ---- Phase B ----
    fire() {
      // fake G.destruct.fires: a burning shopfront + a pool, a gas jet, and a pool emitter
      const N = 90, F = { count: N, x: new Float32Array(N), y: new Float32Array(N), z: new Float32Array(N), heat: new Float32Array(N) };
      for (let i = 0; i < N; i++) { if (i < 50) { F.x[i] = X - 12 + (i % 10) * 0.5; F.y[i] = Y + 0.25 + Math.floor(i / 10) * 0.5; F.z[i] = Z - 2; } else { const a = i * 2.4, r = Math.sqrt((i - 50) / 40) * 3; F.x[i] = X + Math.cos(a) * r; F.y[i] = Y + 0.25; F.z[i] = Z + 2 + Math.sin(a) * r; } F.heat[i] = 0.5 + 0.5 * ((i * 7) % 10) / 10; }
      G.destruct.fires = F;
      bus.emit('gas:jet', { x: X + 9, y: Y, z: Z, dur: 60 });
      fx.burst('firepool', X + 16, Y, Z + 3, 0.8, { dur: 60 });
    },
    shield() {
      const ent = { team: 0, pos: new G.THREE.Vector3(X, Y, Z), height: 8.5, radius: 1.8, shield: { on: true, yaw: 0, arc: 1.15, hp: 400 } };
      let n = 0;
      tick = t => { while (t >= n * 0.16 && n < 60) { bus.emit('shield:hit', { ent, x: X - 1.5 + (n % 4), y: Y + 4 + (n % 3) * 1.4, z: Z + 2.6, amount: 20 + (n % 3) * 40 }); if (n === 6) bus.emit('shield', { ent, on: false, broken: true }); n++; } };
    },
    lance() {
      let n = 0;
      tick = (t) => {
        if (t < n * 0.1) return; n++;            // COMBAT ticks the lance at 10 Hz
        const sw = Math.sin(t * 1.3) * 5;
        fx.beam(X - 14, Y + 6, Z + 8, X + 6 + sw, Y + 0.05, Z - 2, 'lance');
        bus.emit('impact', { weapon: 'lance', x: X + 6 + sw, y: Y + 0.05, z: Z - 2, nx: 0, ny: 1, nz: 0, mat: 3, power: 150 });
      };
    },
    siege() {
      let n = 0;
      tick = t => {
        while (t >= n * 4 && n < 5) {
          bus.emit('shot', { weapon: 'siege', x: X - 4, y: Y + 5.5, z: Z + 4, dx: 0.95, dy: 0, dz: -0.3, team: 0 });
          bus.emit('weapon:recoil', { weapon: 'siege', strength: 1, x: X - 4, y: Y + 5.5, z: Z + 4, dx: 0.95, dy: 0, dz: -0.3 });
          bus.emit('shot', { weapon: 'mortar', x: X + 8, y: Y + 8, z: Z + 6, dx: 0.2, dy: 0.95, dz: -0.2, team: 0 });
          n++;
        }
        const u = (t * 1.4) % 1;
        fx.emit('trail_shell', X - 2 + u * 40, Y + 5.5, Z + 3.4 - u * 12, 133, 0, -42, 1.2);
      };
    },
    mortar() {
      let n = 0;
      tick = t => {
        while (t >= n * 0.5 && n < 12) {
          const bx = X - 8 + (n % 4) * 5, bz = Z - 3 + (n % 3) * 3;
          bus.emit('shot', { weapon: 'mortar_b', x: bx, y: Y + 9, z: bz, dx: 0.2, dy: -0.95, dz: 0, team: 0 });
          n++;
        }
        // swarm missiles corkscrewing across
        for (let i = 0; i < 6; i++) { const u = ((t * 0.9 + i * 0.13) % 1), a = u * 9 + i; fx.emit('trail_missile', X - 20 + u * 44, Y + 7 + Math.sin(a) * 1.5 + i * 0.5, Z - 6 + Math.cos(a) * 1.5, 40, Math.cos(a) * 6, -Math.sin(a) * 6, 0.6); }
      };
    },
    brawl() {
      const foe = fakeEnt('emech', 1, X + 4, Y, Z, 1.8, 8.5); foe.alive = true; foe.hp = 300; foe.maxHp = 1500; foe.yaw = 0;
      const me = fakeEnt('mech', 0, X - 12, Y, Z + 4, 1.8, 8.5);
      let st = 0;
      tick = t => {
        if (st === 0) { st = 1; bus.emit('grapple', { ent: me, state: 'pull', x: X + 3, y: Y + 5.5, z: Z + 1, target: foe }); bus.emit('grapple', { ent: me, state: 'reel', x: X - 6, y: Y + 9, z: Z - 9 }); }
        if (st === 1 && t >= 0.6) { st = 2; bus.emit('limb:torn', { ent: foe, limb: 'armR', by: me }); }
        if (st === 2 && t >= 1.6) { st = 3; bus.emit('charge:planted', { ent: me, target: foe, x: X + 4, y: Y + 6, z: Z - 1.6 }); }
        if (st === 3 && t >= 2.6) { st = 4; bus.emit('finisher', { ent: foe, by: me, state: 'start' }); }
        if (st === 4 && t >= 3.6) { st = 5; bus.emit('finisher', { ent: foe, by: me, state: 'slam', x: X + 4, y: Y, z: Z }); bus.emit('slam', { x: X + 4, y: Y, z: Z, radius: 5, team: 0 }); }
      };
    },
    // ---- with the REAL destruct (harness/fx_world.js): fire spreading through timber, a gas main, a fuel tank ----
    rfire() {
      const g = G.grid, M = G.M, i0 = Math.round((X - 7) / 0.5), k0 = Math.round((Z - 3) / 0.5), j = G.GROUND_J;
      for (let a = 0; a < 16; a++) for (let c = 0; c < 10; c++) for (let h = 0; h < 7; h++) if (a === 0 || a === 15 || c === 0 || h === 6 || (a % 4 === 2 && c % 3 === 1 && h < 2)) g.set(i0 + a, j + h, k0 + c, h === 6 ? M.wood_dark : (a % 4 === 2 && c % 3 === 1) ? M.crate : M.wood);
      const ti = i0 + 26, tk = k0 + 6; for (let h = 0; h < 9; h++) g.set(ti, j + h, tk, M.trunk);
      for (let a = -3; a <= 3; a++) for (let c = -3; c <= 3; c++) for (let h = 7; h < 12; h++) if (a * a + c * c + (h - 9) * (h - 9) < 12) g.set(ti + a, j + h, tk + c, M.foliage);
      let lit = false;
      tick = t => { if (!lit && t >= 0.2) { lit = true; G.destruct.ignite((i0 + 2) * 0.5, Y + 0.5, (k0 + 2) * 0.5, 1.5, 1, null); G.destruct.ignite(ti * 0.5, Y + 4.5, tk * 0.5, 1.2, 1, null); } };
    },
    rgas() {
      const g = G.grid, M = G.M, j = G.GROUND_J - 2, k = Math.round(Z / 0.5), i0 = Math.round((X - 22) / 0.5);
      for (let a = 0; a < 88; a++) g.set(i0 + a, j, k, M.gas_pipe);
      let lit = false;
      tick = t => { if (!lit && t >= 0.2) { lit = true; G.boom((i0 + 1) * 0.5, (j + 1.5) * 0.5, (k + 0.5) * 0.5, { radius: 1.6, power: 140, kind: 'rocket' }); } };
    },
    rtank() {
      const g = G.grid, M = G.M, j = G.GROUND_J, k = Math.round((Z - 1) / 0.5), i = Math.round((X - 3) / 0.5);
      for (let a = 0; a < 12; a++) for (let c = 0; c < 5; c++) for (let h = 1; h < 6; h++) if (a === 0 || a === 11 || c === 0 || c === 4 || h === 1 || h === 5) g.set(i + a, j + h, k + c, M.fuel_tank);
      for (let a = 0; a < 6; a++) g.set(i + 16 + a * 2, j, k + 2, M.crate);
      let lit = false;
      tick = t => { if (!lit && t >= 0.2) { lit = true; G.destruct.impact((i + 6) * 0.5, (j + 3) * 0.5, (k + 0.5) * 0.5, 0, 0, 1, 200, 0.6); } };
    },
    // ---- Phase C ----
    phasec() {
      let st = 0;
      tick = t => {
        if (st === 0) { st = 1; bus.emit('objective:done', { objective: { x: X - 10, y: Y, z: Z } }); }
        if (st === 1 && t >= 0.5) { st = 2; fx.burst('beacon', X, Y, Z + 4, 1, { color: [1, 0.72, 0.25] }); }
        if (st === 2 && t >= 1.0) { st = 3; bus.emit('boss:phase', { ent: fakeEnt('emech', 1, X + 12, Y, Z - 4, 2.6, 13), phase: 3 }); }
        if (st === 3 && t >= 1.2) { st = 4; G.state.player.ent = G.state.player.ent || fakeEnt('pilot', 0, X, Y, Z, 0.35, 1.8); bus.emit('game:won', {}); }
      };
    },
    stress() {
      // everything at once, repeatedly: the cap must hold
      let n = 0;
      tick = t => {
        while (t >= n * 0.05 && n < 400) {
          const a = n * 2.4, r = 6 + (n % 9) * 3;
          G.boom(X + Math.cos(a) * r, Y + 0.6, Z + Math.sin(a) * r, { radius: 3 + (n % 3), power: 130, kind: 'rocket' });
          bus.emit('collapse', { x: X + Math.cos(a) * 20, y: Y + 20, z: Z + Math.sin(a) * 20, mass: 3000, height: 10 });
          if (n % 20 === 0) bus.emit('mech:selfdestruct', { x: X + Math.cos(a) * 12, y: Y + 4, z: Z + Math.sin(a) * 12 });
          n++;
        }
      };
    },
  };
  const names = name.split(',');
  const ticks = [];
  for (const nm of names) { tick = null; if (D[nm]) D[nm](); else console.error('fx demo: unknown', nm); if (tick) ticks.push(tick); }
  const t0 = G.time, dt = 1 / 60, steps = Math.round(T / dt);
  const tp0 = performance.now();
  for (let s = 0; s < steps; s++) { for (const f of ticks) f(G.time - t0, dt); G.debugStep(1, dt); }
  for (const f of ticks) f(G.time - t0, dt);
  window.__FX_DEMO = { name, T, simMs: +(performance.now() - tp0).toFixed(1), steps, stats: Object.assign({}, fx.stats) };
  G.timeScale = parseFloat(P.get('hold') || '0.02');
  // keep continuous demos alive while the page idles
  bus.on('__fxdemo', () => {});
  const live = () => { for (const f of ticks) f(G.time - t0, G.dt); requestAnimationFrame(live); };
  requestAnimationFrame(live);
}
