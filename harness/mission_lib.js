// MISSION test helpers (KT.mt). Drive with tools/shot.mjs --eval "KT.mt.run()" etc.
export function installTests(G) {
  const bus = G.bus, log = [], count = {};
  const rec = (name, f) => bus.on(name, (d) => { count[name] = (count[name] || 0) + 1; if (name !== 'objective:update') log.push(G.time.toFixed(1) + ' ' + name + (f ? ' ' + f(d) : '')); });
  rec('mission:stage', d => d.n + ' ' + d.title); rec('objective:new', d => d.objective.id); rec('objective:update'); rec('objective:done', d => d.objective.id + ' +' + d.salvage);
  rec('mission:won', d => JSON.stringify(d.stats.stageTimes)); rec('mission:failed', d => d.reason); rec('game:won'); rec('game:over', d => d && d.cause); rec('perk:offer'); rec('boss:phase', d => d.phase);
  const msgs = []; bus.on('ui:message', d => msgs.push(G.time.toFixed(1) + ' ' + d.text + ' | ' + (d.sub || '')));
  const M = () => G.mission, info = () => M().debug.info();
  const pe = () => G.state.player.ent || G.state.player.pilot;
  const mt = G.mt = {
    log, count, msgs, info,
    step(sec, dt = 1 / 30) { G.debugStep(Math.round(sec / dt), dt); return info(); },
    perk() { const o = G.progress.offer; if (o && o.length) { G.progress.takePerk(o[0].id); G.timeScale = 1; return o[0].id; } return null; },
    killAll() { let n = 0; for (const u of G.enemy.list.slice()) { if (u.ent.invuln) continue; if (u.ent.boss) continue; G.ents.damage(u.ent, 1e6, { type: 'explosion', src: pe() }); n++; } return n; },
    // knock a pylon down the way a player would: explosions on the footings
    boomPylon(i, shots = 1) { const p = info().pylons[i]; for (let s = 0; s < shots; s++) for (const [dx, dz] of [[-1.75, -1.75], [1.75, 1.75], [-1.75, 1.75], [1.75, -1.75]]) G.boom(p.x + dx, G.GROUND_Y + 0.6, p.z + dz, { radius: 3, power: 140, damage: 110, owner: pe(), kind: 'rocket' }); },
    untilPhase(ph, max = 60) { let t = 0; while (info().phase !== ph && t < max && M().active) { mt.step(1); mt.perk(); t++; } return t; },
    // ---- full run: every stage completed by "playing" it through the public world API
    run(opts = {}) {
      const R = { steps: [] }, note = (k, v) => R.steps.push(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)));
      const t0 = performance.now();
      mt.step(1); let I = info(); note('start', { active: I.active, stage: I.stage, phase: I.phase, pylons: I.pylons.map(p => p.total), buildMs: I.buildMs, citadel: I.citadel, c3: I.c3 });
      if (I.stage === 1) {
        mt.untilPhase('run'); mt.step(3); note('s1 live', { live: info().live });
        for (let i = 0; i < 3; i++) {
          let shots = 0;
          while (!info().objectives.find(o => o.id === 'jammer' + i).done && shots < 12) { mt.boomPylon(i); shots++; mt.step(2.5); }
          I = info(); note('jammer' + i, { shots, left: I.pylons[i].left, total: I.pylons[i].total, live: I.live, done: I.objectives.find(o => o.id === 'jammer' + i).done });
          mt.step(4); mt.killAll();
        }
        mt.step(1); note('s1 end', { phase: info().phase, stage: info().stage });
      }
      if (info().stage <= 2 && M().active) {
        mt.untilPhase('intro', 80); mt.untilPhase('run', 30); I = info(); note('s2 live', { stage: I.stage, relay: I.relay, meter: G.state.player.meter, ready: G.state.player.mechReady });
        let peak = 0, minHp = 1e9, kills = 0;
        for (let t = 0; t < 170 && info().stage === 2 && info().phase === 'run' && M().active; t += 5) { mt.step(5); I = info(); peak = Math.max(peak, I.live); if (I.relay) minHp = Math.min(minHp, I.relay.hp); if (!opts.noKill && I.live > (opts.letLive || 6)) kills += mt.killAll(); }
        I = info(); note('s2 end', { phase: I.phase, stage: I.stage, peakLive: peak, relayMinHp: minHp, kills, active: I.active, failed: I.failed });
      }
      if (info().stage <= 3 && M().active) {
        mt.untilPhase('intro', 80); mt.untilPhase('run', 30); mt.step(8); I = info(); note('s3 live', { stage: I.stage, core: I.core, live: I.live, turrets: G.enemy.list.filter(u => u.kind === 'turret').length });
        const c = I.core;
        if (c) {
          // shoot the core: pulse-like damage to the entity
          const e = M().core; let n = 0;
          if (opts.collapse) { for (let k = 0; k < 40 && info().stage === 3 && info().phase === 'run'; k++) { const a = k * 0.9; G.boom(c.x + Math.cos(a) * (3 + k % 5 * 3), G.GROUND_Y + 2 + (k % 3) * 3, c.z + Math.sin(a) * (3 + k % 5 * 3), { radius: 6, power: 320, damage: 0, owner: pe() }); mt.step(2); n++; } }
          else while (e && e.alive && n < 60 && info().phase === 'run') { G.ents.damage(e, 130, { type: 'pulse', src: pe() }); n++; if (n % 5 === 0) mt.step(1); }
          mt.step(2); I = info(); note('s3 end', { hits: n, phase: I.phase, stage: I.stage, live: I.live, obj: I.objectives });
        }
        mt.killAll();
      }
      if (M().active) {
        mt.untilPhase('intro', 80); mt.untilPhase('run', 30); mt.step(1); I = info(); note('s4 spawn', { stage: I.stage, boss: I.boss, live: I.live });
        mt.step(12); I = info(); note('s4 landed', { boss: I.boss });
        const b = M().boss; let n = 0;
        while (b && b.alive && n < 400) { G.ents.damage(b, 300, { type: 'rocket', src: pe() }); n++; if (n % 4 === 0) { mt.step(1); if (n % 20 === 0) note('boss', { hp: Math.round(b.hp), phase: b.phase, live: info().live }); } }
        mt.step(4); I = info(); note('s4 end', { hits: n, active: I.active, won: I.won, obj: I.objectives });
      }
      I = info();
      R.result = { won: I.won, failed: I.failed, stageTimes: I.stageTimes, ms: I.ms, peakMs: I.peakMs, spawned: I.spawned, kills: I.kills, salvage: G.progress.runSalvage, perks: G.progress.perks, phase: G.state.phase, playerAlive: !!(pe() && pe().alive) };
      R.count = count; R.log = log; R.msgs = msgs; R.wallMs = Math.round(performance.now() - t0);
      return R;
    },
    // ---- failure paths
    failRelay() {
      mt.untilPhase('run'); mt.step(2); const e = M().relay, r = {};
      r.invulnBefore = G.ents.damage(e, 500, { type: 'shell', src: null }) === 0 ? false : true; r.hp1 = Math.round(e.hp);
      r.friendly = G.ents.damage(e, 500, { type: 'rocket', src: pe() });
      let n = 0; while (e.alive && n++ < 100) G.ents.damage(e, 400, { type: 'shell', src: null });
      mt.step(1); const I = info();
      return { r, hits: n, active: I.active, failed: I.failed, phase: G.state.phase, obj: I.objectives, count, log };
    },
    failPlayer() {
      mt.untilPhase('run'); mt.step(2); const p = G.state.player.pilot; let n = 0;
      while (p.alive && n++ < 50) G.ents.damage(p, 1000, { type: 'shell', src: null });
      mt.step(6); const I = info();
      return { hits: n, active: I.active, failed: I.failed, phase: G.state.phase, obj: I.objectives, count, log };
    },
    // restart after an end state: everything must come back clean
    restart() {
      const before = { scene: G.scene.children.length, ents: G.ents.list.length };
      bus.emit('ui:restart'); mt.step(2); const I = info();
      return { before, after: { scene: G.scene.children.length, ents: G.ents.list.length }, active: I.active, stage: I.stage, phase: I.phase, pylons: I.pylons.map(p => p.left + '/' + p.total), objectives: I.objectives.length, phaseG: G.state.phase };
    },
    // ---- co-op wire: serialize on the host, wipe, applyState as a client -> same voxels and objectives
    hash() { const d = G.grid.data; let h = 2166136261 >>> 0, n = 0; for (let i = 0; i < d.length; i++) { const v = d[i]; if (v) { n++; h = Math.imul(h ^ (i * 31 + v), 16777619) >>> 0; } } return { h, n }; },
    wire(extra) {
      if (extra) extra();
      const m = M(), s = JSON.parse(JSON.stringify(m.serialize())), bytes = JSON.stringify(s).length, h1 = mt.hash();
      const objs = (o) => JSON.stringify(o.map(q => [q.id, q.text, q.sub, q.kind, +(+q.progress).toFixed(3), q.done, q.failed, q.timer == null ? null : +q.timer.toFixed(1), q.x, q.z]));
      const o1 = objs(m.objectives), mk1 = m.markers.length, sc1 = G.scene.children.length;
      // become a client on a pristine world
      m.reset(); for (const e of G.ents.list.slice()) if (e.kind === 'prop') G.ents.remove(e); G.grid.restore();
      const h0 = mt.hash();
      const ev0 = Object.assign({}, count);
      G.net = Object.assign(G.net || {}, { online: true, isHost: false });
      m.applyState(s); const h2 = mt.hash(), o2 = objs(m.objectives);
      m.applyState(s);                                   // idempotent: no rebuild, no duplicate events
      const ev = {}; for (const k in count) if (count[k] !== (ev0[k] || 0)) ev[k] = count[k] - (ev0[k] || 0);
      mt.step(1);                                        // client update must not spawn or judge
      const r = { bytes, builds: s.builds, host: h1, pristine: h0, client: h2, sameVoxels: h1.h === h2.h && h1.n === h2.n, sameObjectives: o1 === o2, markers: [mk1, m.markers.length], events: ev, stage: m.stage, enemiesAfterStep: G.enemy.list.length, hashAfterStep: mt.hash().h === h2.h, props: G.ents.list.filter(e => e.kind === 'prop').length, scene: [sc1, G.scene.children.length] };
      G.net.online = false; return r;
    },
    // ---- co-op: a client-side hit on the core becomes a claim with netId 'm:core'; the host resolves that id
    claim() {
      const m = M(), host = { ids: m.propNetIds(), core: !!m.entByNetId('m:core'), relay: !!m.entByNetId('m:relay'), coreIsReal: m.entByNetId('m:core') === m.core && !m.core.remote, hp0: m.core.hp };
      // host applies a claim the way NET would
      host.applied = G.ents.damage(m.entByNetId('m:core'), 200, { type: 'pulse', src: pe(), fromNet: true }); host.hp1 = m.core.hp;
      const s = JSON.parse(JSON.stringify(m.serialize()));
      m.reset(); G.grid.restore();
      const claims = []; G.net = Object.assign(G.net || {}, { online: true, isHost: false, claimHit(e, a, info) { claims.push({ netId: e.netId, amount: a, type: info.type }); } });
      m.applyState(s);
      const c = m.core, r = m.relay, cl = { core: c && { netId: c.netId, remote: c.remote, team: c.team, kind: c.kind, hp: c.hp, maxHp: c.maxHp, invuln: !!c.invuln, r: c.radius, h: c.height, y: c.pos.y, inList: G.ents.list.includes(c) }, relay: r && { netId: r.netId, remote: r.remote, team: r.team, hp: r.hp, invuln: !!r.invuln, inList: G.ents.list.includes(r) }, objEnt: m.objectives.map(o => o.id + ':' + (o.ent ? o.ent.netId : null)) };
      cl.ret = G.ents.damage(c, 130, { type: 'pulse', src: pe() }); cl.hpAfterHit = c.hp;
      // a ray from the street side hits the puppet body
      const h = G.ents.raycast(c.pos.x - 6, c.pos.y + 1.2, c.pos.z, 1, 0, 0, 20, null, 0); cl.rayHits = !!(h && h.ent === c);
      cl.relayHit = G.ents.damage(r, 50, { type: 'shell', src: null });                       // invulnerable outside stage 2: no claim
      // host says the core is gone
      s.ca = 0; s.core = 0; m.applyState(s); cl.afterGone = { core: m.core, inList: G.ents.list.some(e => e.netId === 'm:core'), alive: c.alive };
      m.reset(); cl.afterReset = G.ents.list.filter(e => e.kind === 'prop').length;
      G.net.online = false;
      return { host, claims, cl };
    },
    // cost of the director alone over n frames of the current stage
    cost(n = 600) { const m = M(); let worst = 0, sum = 0; for (let i = 0; i < n; i++) { G.time += 1 / 60; const t = performance.now(); m.update(1 / 60); const d = performance.now() - t; sum += d; if (d > worst) worst = d; } return { avgMs: +(sum / n).toFixed(4), worstMs: +worst.toFixed(3), stage: m.stage }; },
  };
}
