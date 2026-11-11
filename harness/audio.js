// AUDIO harness: real audio module on the lead's baselines + structural / numerical tests.
//   node build.mjs harness/audio.js h-audio --dev
//   node tools/shot.mjs dist/h-audio.html shots/audio-01.png --q "auto=1&panel=1" --eval "AT.all()" --wait 3000
// Query: panel=1 shows an audition board (click a name to hear it; needs real speakers).
import { boot } from '../src/boot.js';
import audio from '../src/audio.js';
import { stats as synthStats } from '../src/audio_synth.js';
import { THREE } from '../src/core.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function analyse(buf) {
  const L = buf.getChannelData(0), Rr = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, n = L.length, sr = buf.sampleRate;
  let peak = 0, sum = 0, nan = 0, last = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = L[i], b = Rr[i]; if (a !== a || b !== b) { nan++; continue; }
    const m = Math.max(Math.abs(a), Math.abs(b)); if (m > peak) peak = m; if (m > 0.002) last = i;
    mono[i] = (a + b) * 0.5; sum += mono[i] * mono[i];
  }
  const W = 4096, re = new Float32Array(W), im = new Float32Array(W), ps = new Float64Array(W / 2);
  for (let o = 0; o + W <= n; o += W / 2) {
    for (let i = 0; i < W; i++) { re[i] = mono[o + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / W)); im[i] = 0; }
    fft(re, im); for (let i = 0; i < W / 2; i++) ps[i] += re[i] * re[i] + im[i] * im[i];
  }
  let tot = 0, cen = 0; const band = [0, 0, 0, 0];
  for (let i = 1; i < W / 2; i++) { const f = i * sr / W, e = ps[i]; tot += e; cen += e * f; band[f < 150 ? 0 : f < 600 ? 1 : f < 4000 ? 2 : 3] += e; }
  const pc = x => Math.round(100 * x / (tot || 1));
  return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / n).toFixed(4), nan, dur: +(Math.max(0, last / sr - 0.05)).toFixed(2), centroid: Math.round(cen / (tot || 1)), sub: pc(band[0]), low: pc(band[1]), mid: pc(band[2]), high: pc(band[3]) };
}

boot({
  use: { audio },
  after(G) {
    const bus = G.bus;
    const me = G.ents.add({ kind: 'pilot', team: 0, isPlayer: true, pos: new THREE.Vector3(96, 2, 130), radius: 0.35, height: 1.8, hp: 100 });
    G.state.player.ent = me;
    const foe = G.ents.add({ kind: 'soldier', team: 1, pos: new THREE.Vector3(110, 2, 110), radius: 0.35, height: 1.8, hp: 1e6 });
    const errs = []; const ce = console.error; console.error = (...a) => { errs.push(a.map(String).join(' ').slice(0, 300)); ce.apply(console, a); };
    const P = (x = 104, y = 3, z = 112) => ({ x, y, z });
    const EVENTS = [
      ...['rifle', 'launcher', 'grenade', 'pulse', 'pulse', 'salvo', 'skylance'].map(w => ['shot', { weapon: w, ...P(96, 3, 130), dx: 0, dy: 0, dz: -1, shooter: me, team: 0 }]),
      ...['e_rifle', 'e_rpg', 'e_shell', 'e_drone', 'e_chain', 'e_gsrocket', 'e_pulse', 'e_salvo', 'mystery'].map(w => ['shot', { weapon: w, ...P(), dx: 0, dy: 0, dz: 1, shooter: foe, team: 1 }]),
      ['tracer', { weapon: 'e_rifle', x0: 96, y0: 10, z0: 60, x1: 96, y1: 10, z1: 190, team: 1 }],
      ...[8, 14, 17, 20, 2, 25, undefined].map(m => ['impact', { weapon: 'rifle', ...P(), nx: 0, ny: 1, nz: 0, mat: m, power: 30 }]),
      ['impact', { weapon: 'pulse', ...P(), mat: 8, power: 110 }], ['impact', { weapon: 'rifle', ...P(), power: 30, ent: foe }],
      ['impact', { weapon: 'e_pulse', ...P(), power: 90, ent: { kind: 'tank' } }],
      ...[[1.2, 'grenade'], [3, 'rocket'], [5, 'shell'], [1.6, 'pulse'], [7, 'mech'], [12, 'mech'], [6, 'slam']].map(([r, k]) => ['explosion', { ...P(100, 3, 100), radius: r, power: 140, kind: k, owner: null }]),
      ['explosion', { x: 30, y: 4, z: 20, radius: 6, power: 150, kind: 'rocket' }],
      ['voxels:destroyed', { ...P(), count: 40, mat: 17, radius: 2 }], ['voxels:destroyed', { ...P(), count: 300, mat: 8, radius: 3 }],
      ['voxels:destroyed', { ...P(), count: 60, mat: 14, radius: 3 }], ['voxels:destroyed', { ...P(), count: 2, mat: 8, radius: 1 }],
      ['collapse', { ...P(90, 12, 90), mass: 20000, height: 20 }], ['collapse', { ...P(90, 12, 90), mass: 300, height: 5 }],
      ...[8, 14, 17, 20, 2, 25].map(m => ['debris:impact', { ...P(), speed: 12, mass: 30, mat: m }]),
      ['building:levelled', { id: 3, name: 'Test' }],
      ['ent:damage', { ent: me, amount: 20, info: { type: 'bullet', src: foe } }], ['ent:damage', { ent: foe, amount: 9, info: { type: 'bullet', src: me } }],
      ['ent:damage', { ent: { kind: 'mech', isPlayer: true }, amount: 150, info: {} }],
      ...['soldier', 'drone', 'tank', 'gunship', 'emech'].map(k => ['ent:death', { ent: { kind: k, team: 1, pos: new THREE.Vector3(104, 4, 112) }, info: { src: me } }]),
      ['footstep', { ...P(96, 2, 130), heavy: true, kind: 'mech', team: 0 }], ['footstep', { ...P(), heavy: true, kind: 'emech', team: 1 }],
      ['footstep', { ...P(96, 2, 130), heavy: false, kind: 'pilot', team: 0 }], ['footstep', { ...P(), heavy: false, kind: 'soldier', team: 1 }],
      ['punch', { ...P(96, 6, 128), dx: 0, dy: 0, dz: -1, hit: true, team: 0 }], ['punch', { ...P(), dx: 0, dy: 0, dz: 1, hit: false, team: 1 }],
      ['slam', { ...P(96, 2, 128), radius: 7, team: 0 }],
      ['jet', { ent: me, on: true }], ['jet', { ent: foe, on: true }], ['jet', { ent: me, on: false }], ['jet', { ent: foe, on: false }],
      ...['autocannon', 'lance', 'siege', 'swarm', 'mortar', 'mortar_b'].map(w => ['shot', { weapon: w, ...P(96, 5, 130), shooter: me, team: 0 }]),
      ['weapon:recoil', { weapon: 'siege', shooter: me, strength: 1, ...P(96, 5, 130), dx: 0, dy: 0, dz: -1 }], ['weapon:recoil', { weapon: 'mortar', shooter: me, strength: 0.5, ...P(96, 5, 130) }],
      ['impact', { weapon: 'lance', ...P(), mat: 8, power: 150 }],
      ['shield', { ent: me, on: true }], ['shield:hit', { ent: me, ...P(96, 5, 128), amount: 40 }], ['shield', { ent: me, on: false }], ['shield', { ent: me, on: false, broken: true }],
      ['grapple', { ent: me, state: 'reel', ...P(100, 20, 100) }], ['grapple', { ent: me, state: 'release' }], ['grapple', { ent: me, state: 'pull', ...P(), target: foe }], ['grapple', { ent: me, state: 'clinch', target: foe }],
      ['grapple', { ent: me, state: 'yank', ...P(), target: foe }], ['grapple', { ent: me, state: 'miss' }],
      ['limb:torn', { ent: foe, limb: 'armR', by: me }], ['finisher', { ent: foe, by: me, state: 'start' }], ['finisher', { ent: foe, by: me, state: 'slam', ...P() }],
      ['brace', { ent: me, on: true }], ['brace', { ent: me, on: false }], ['dash', { ent: me, air: true }],
      ['charge:mount', { ent: me, target: foe }], ['charge:planted', { ent: me, target: foe, ...P() }], ['mech:hijack', { ent: foe, by: me }], ['fire:start', P()], ['fire:out', P()], ['gas:jet', { ...P(), dur: 6 }], ['gas:jet', {}],
      ['bay:open', { index: 0 }], ['bay:preview', { loadout: { chassis: 'warden', slots: {}, paint: { armor: 1 } } }], ['bay:preview', { loadout: { chassis: 'warden', slots: { armL: 'siege' }, paint: { armor: 1 } } }],
      ['bay:preview', { loadout: { chassis: 'warden', slots: { armL: 'siege' }, paint: { armor: 2 } } }], ['bay:preview', { loadout: { chassis: 'bastion', slots: {}, paint: { armor: 2 } } }],
      ['bay:changed', { active: 0 }], ['bay:changed', { active: 1 }], ['bay:close', {}],
      ['shield', {}], ['shield:hit', {}], ['grapple', {}], ['limb:torn', {}], ['finisher', {}], ['brace', {}], ['charge:mount', {}], ['charge:planted', {}], ['mech:hijack', {}], ['weapon:recoil', {}], ['bay:preview', {}], ['bay:changed', {}],
      ['objective:new', { objective: {} }], ['objective:update', {}], ['objective:done', { objective: {}, salvage: 50 }], ['mission:stage', { n: 2, title: 'x', text: 'y' }],
      ['perk:offer', { perks: [] }], ['perk:taken', { perk: {} }], ['salvage', { amount: 25, total: 100 }], ['salvage', {}], ['boss:phase', { phase: 2 }],
      ['ent:add', { kind: 'emech', variant: 'dreadnought', pos: new THREE.Vector3(90, 2, 90) }], ['mission:failed', { reason: 'x' }], ['mission:won', {}], ['game:won', {}], ['game:start', {}],
      ...['e_turret', 'e_siege', 'e_swarm'].map(w => ['shot', { weapon: w, ...P(), shooter: foe, team: 1 }]),
      ['dash', { ent: me }], ['slide', { ent: me, on: true }], ['slide', { ent: me, on: false }], ['roll', { ent: me }], ['crouch', { ent: me, on: true }], ['crouch', { ent: me, on: false }], ['mantle', { ent: me }],
      ['shot', { weapon: 'seeker', ...P(96, 3, 130), shooter: me, team: 0 }], ['ui:sound', { name: 'confirm' }], ['ui:sound', { name: 'back' }], ['ui:sound', { name: 'tick' }], ['ui:sound', {}], ['slide', {}], ['roll', {}], ['crouch', {}], ['mantle', {}],
      ['mech:incoming', { x: 96, z: 120, team: 0, eta: 3 }], ['mech:incoming', { x: 60, z: 60, team: 1, eta: 4 }],
      ['mech:land', { x: 96, y: 2, z: 120, team: 0 }], ['mech:land', { x: 60, y: 2, z: 60, team: 1 }],
      ['mech:enter', { ent: me, ...P(96, 2, 120) }], ['mech:eject', { ent: me, ...P(96, 2, 120) }], ['mech:selfdestruct', { ent: me, ...P(96, 2, 120) }],
      ['grab', { ent: me, ...P(96, 5, 126) }], ['throw', { ent: me, ...P(96, 5, 126) }],
      ['weapon:reload', { weapon: 'rifle', shooter: me }], ['weapon:reload', { weapon: 'launcher', shooter: me }], ['weapon:reload', { weapon: 'e_rifle', shooter: foe }],
      ['weapon:overheat', { weapon: 'pulse', shooter: me }], ['weapon:empty', { weapon: 'rifle', shooter: me }], ['weapon:ready', { weapon: 'salvo', shooter: me }],
      ['lock', { state: 'locking', target: foe }], ['lock', { state: 'locked', target: foe }], ['lock', { state: 'fired', target: foe }],
      ['lock', { state: 'locking', target: foe }], ['lock', { state: 'lost', target: foe }],
      ['lock:warning', { on: true }], ['lock:warning', { on: false }],
      ['score', { points: 100, label: 'x', ...P() }], ['meter:ready', {}],
      ['ace:charging', { ent: foe, progress: 0.5 }], ['ace:called', { ent: foe, progress: 1 }],
      ['wave:start', { n: 1, total: 6, label: 'WAVE 1' }], ['wave:clear', { n: 1 }],
      ['ui:message', { text: 'x', kind: 'warn' }], ['shake', { amount: 0.5 }],
      ['game:pause', {}], ['game:resume', {}], ['game:over', {}], ['ui:title', {}], ['game:start', {}], ['quality', 'low'], ['resize', {}],
      // malformed payloads must not throw
      ['shot', {}], ['shot', undefined], ['impact', {}], ['explosion', {}], ['collapse', {}], ['debris:impact', {}], ['voxels:destroyed', {}],
      ['ent:damage', {}], ['ent:death', {}], ['footstep', {}], ['punch', {}], ['slam', {}], ['jet', {}], ['dash', {}], ['mech:incoming', {}], ['mech:land', {}],
      ['mech:enter', {}], ['lock', {}], ['lock:warning', {}], ['ace:charging', {}], ['tracer', {}],
    ];
    const AT = window.AT = {
      analyse,
      async unlock() { audio.unlock(); for (let i = 0; i < 40 && (!audio.ctx || audio.ctx.state !== 'running'); i++) await sleep(50); return audio.ctx ? audio.ctx.state : 'none'; },
      // every bus event: no exceptions, modest node creation, bounded voices
      async events() {
        const st = await AT.unlock(), rows = {}; let maxNodes = 0, maxName = '', silent = [];
        for (const [type, data] of EVENTS) {
          await sleep(90);                                  // let family rate limits pass
          const n0 = synthStats.nodes, p0 = audio.stats.played;
          bus.emit(type, data);
          const dn = synthStats.nodes - n0, key = type + (data && data.weapon ? ':' + data.weapon : data && data.kind ? ':' + data.kind : data && data.state ? ':' + data.state : '');
          rows[key] = Math.max(rows[key] || 0, dn);
          if (dn > maxNodes) { maxNodes = dn; maxName = key; }
          if (audio.stats.played === p0 && data && Object.keys(data).length) silent.push(key);
        }
        const peak = audio.stats.peakVoices;
        return { ctx: st, events: EVENTS.length, errors: errs.slice(), maxNodesPerEvent: maxNodes, maxName, peakVoices: peak, silent, nodesByEvent: rows };
      },
      // every play() name, near and far
      async names() {
        await AT.unlock(); const out = {}, bad = [];
        for (const n of audio.names) {
          await sleep(60);
          const n0 = synthStats.nodes;
          const d1 = audio.play(n, {}); await sleep(50); const d2 = audio.play(n, { x: 60, y: 6, z: 80, vol: 1, pitch: 1.1 });
          out[n] = [+(d1 || 0).toFixed(2), synthStats.nodes - n0];
          if (!d1 || !audio.defs[n]) bad.push(n);
        }
        return { count: audio.names.length, missingDef: audio.names.filter(n => !audio.defs[n]), defWithoutRecipe: Object.keys(audio.defs).filter(n => !audio.names.includes(n)), notPlayed: bad, errors: errs.slice(), durAndNodes: out };
      },
      // a firefight: voices stay bounded, update stays cheap, everything is released afterwards
      async stress(seconds = 3) {
        await AT.unlock(); await sleep(300);
        const n0 = synthStats.nodes, pl0 = audio.stats.played, dr0 = audio.stats.dropped, st0 = audio.stats.stolen; let maxV = 0, ticks = 0, upd = 0, updN = 0;
        const t0 = performance.now(), W = ['rifle', 'pulse', 'e_rifle', 'e_chain', 'e_pulse', 'salvo', 'e_drone'];
        while (performance.now() - t0 < seconds * 1000) {
          for (let i = 0; i < 6; i++) { const w = W[(ticks + i) % W.length]; bus.emit('shot', { weapon: w, x: 96 + Math.random() * 60 - 30, y: 3, z: 120 + Math.random() * 60 - 30, shooter: w[0] === 'e' ? foe : me, team: w[0] === 'e' ? 1 : 0 }); }
          for (let i = 0; i < 6; i++) bus.emit('impact', { weapon: 'pulse', x: 96 + Math.random() * 40 - 20, y: 3, z: 120 + Math.random() * 40 - 20, mat: [8, 14, 17, 20, 2][i % 5], power: 60 });
          if (ticks % 3 === 0) bus.emit('explosion', { x: 96 + Math.random() * 80 - 40, y: 3, z: 120 + Math.random() * 80 - 40, radius: 2 + Math.random() * 6, kind: 'rocket' });
          for (let i = 0; i < 4; i++) bus.emit('debris:impact', { x: 100, y: 3, z: 110, speed: 10, mass: 20, mat: 8 });
          if (ticks % 5 === 0) bus.emit('voxels:destroyed', { x: 100, y: 3, z: 110, count: 200, mat: ticks % 10 ? 8 : 17 });
          if (ticks % 20 === 0) bus.emit('collapse', { x: 100, y: 10, z: 100, mass: 5000 });
          bus.emit('footstep', { x: 96, y: 2, z: 130, heavy: true, team: 0 });
          const a = performance.now(); audio.update(0.016); upd += performance.now() - a; updN++;
          maxV = Math.max(maxV, audio.stats.voices); ticks++;
          await sleep(16);
        }
        const res = { ticks, eventsFired: ticks * 17, played: audio.stats.played - pl0, dropped: audio.stats.dropped - dr0, stolen: audio.stats.stolen - st0, maxVoices: maxV, nodesCreated: synthStats.nodes - n0, nodesPerSecond: Math.round((synthStats.nodes - n0) / seconds), updateMsAvg: +(upd / updN).toFixed(3) };
        await sleep(9000); audio.update(0.016);
        res.voicesAfter9s = audio.stats.voices; res.familiesAfter = Object.fromEntries(Object.entries(audio.families).filter(([, f]) => f.n !== 0).map(([k, f]) => [k, f.n]));
        res.ctx = audio.ctx.state; res.errors = errs.slice();
        return res;
      },
      // idle update cost and node churn with music running
      async idle(seconds = 4, state = 'rig') {
        await AT.unlock(); audio.forceMusic = state; audio.heat = 1; await sleep(500);
        const n0 = synthStats.nodes; let upd = 0, n = 0; const t0 = performance.now();
        while (performance.now() - t0 < seconds * 1000) { const a = performance.now(); audio.update(0.016); upd += performance.now() - a; n++; await sleep(16); }
        const r = { state, updateMsAvg: +(upd / n).toFixed(3), musicNodesPerSecond: Math.round((synthStats.nodes - n0) / seconds), voices: audio.stats.voices, ctxTime: +audio.ctx.currentTime.toFixed(2) };
        audio.forceMusic = null; return r;
      },
      // offline renders through the master chain
      async offline(list) {
        const cases = list || [
          ['rifle'], ['pulse', { alt: 0 }], ['pulse', { alt: 1 }], ['e_pulse'], ['e_rifle'], ['rocket_launch'], ['e_rocket'], ['skylance_launch'], ['salvo'], ['e_shell'], ['overheat'],
          ['explosion', { size: 0.15 }, 'explosion_small'], ['explosion', { size: 0.4 }, 'explosion_med'], ['explosion', { size: 0.8 }, 'explosion_large'], ['explosion', { size: 1.6, kind: 'mech' }, 'explosion_huge'],
          ['explosion', { size: 0.6, lag: 0.3 }, 'explosion_far_lag'],
          ['collapse', { size: 1 }], ['crumble', { size: 0.6 }], ['glass_shatter', { size: 0.7 }], ['debris_concrete'], ['debris_metal'], ['debris_glass'],
          ['impact_concrete'], ['impact_metal'], ['impact_glass'], ['impact_wood'], ['impact_dirt'],
          ['footstep_rig'], ['footstep_pilot'], ['punch', { hit: true }], ['slam'], ['dash'], ['jet'], ['rig_drop_incoming', { dur: 4 }], ['rig_land'], ['board'], ['eject'], ['selfdestruct'],
          ['heartbeat'], ['lock_beep'], ['lock_tone'], ['lock_warning'], ['rig_ready'], ['wave_start'], ['wave_clear'], ['defeat'], ['ui_click'], ['wreck'], ['levelled'], ['footstep_rig', { pitch: 1.3, w: 0.7, vol: 0.75 }, 'footstep_harrier'], ['footstep_rig', { pitch: 0.78, w: 1.35, vol: 1.2 }, 'footstep_bastion'],
          ['autocannon'], ['lance_start'], ['siege'], ['recoil'], ['swarm'], ['mortar'], ['mortar_split'], ['shield_up'], ['shield_hit'], ['shield_break'], ['grapple_fire'], ['grapple_latch'], ['limb_torn'], ['finisher_grab'], ['finisher'], ['brace_on'], ['airdash'], ['charge_planted'], ['hijack'], ['bay_fit'], ['bay_paint'],
          ['objective_done'], ['stage_banner'], ['perk_pick'], ['salvage'], ['boss_arrive'], ['boss_phase'], ['victory'],
          ['gas_jet'], ['seeker_launch'], ['roll'], ['mantle'], ['amb_gunfire'], ['amb_boom'], ['amb_siren'],
        ];
        const out = {};
        for (const [name, opts, label] of cases) {
          const dur = (opts && opts.dur ? opts.dur : 0) + (name === 'selfdestruct' || name === 'collapse' || name === 'amb_siren' || name === 'victory' ? 9.5 : name === 'explosion' || name === 'rig_land' || name === 'slam' ? 6.5 : 4.5);
          out[label || name] = analyse(await audio.renderOffline(name, Object.assign({ dry: true }, opts), dur));
        }
        // loudest plausible pile-up through the limiter: 6 huge explosions at once, full reverb
        const oc = new OfflineAudioContext(2, 44100 * 4, 44100), { buildGraph } = await import('../src/audio.js'), g = buildGraph(oc);
        const { SOUNDS } = await import('../src/audio_synth.js');
        for (let i = 0; i < 6; i++) { SOUNDS.explosion(oc, g.sfx, 0.05 + i * 0.01, { size: 1.6 }); SOUNDS.rig_land(oc, g.sfx, 0.05, {}); SOUNDS.explosion(oc, g.revIn, 0.05, { size: 1.6 }); }
        out.PILEUP_6x_huge = analyse(await oc.startRendering());
        return out;
      },
      async music(seconds = 16) {
        const out = {};
        for (const s of audio.musicStates) { const n0 = synthStats.nodes; const a = analyse(await audio.renderMusicOffline(s, seconds, 0.8)); a.nodesPerSec = Math.round((synthStats.nodes - n0) / seconds); out[s] = a; }
        out.foot_calm = analyse(await audio.renderMusicOffline('foot', seconds, 0));
        return out;
      },
      // bar-by-bar level of a theme (is there rhythm?): rms in 16th-note slots over one bar, averaged
      async rhythm(state = 'rig', bpm = 126) {
        const buf = await audio.renderMusicOffline(state, 16, 0.8), d = buf.getChannelData(0), sr = buf.sampleRate, d16 = 60 / bpm / 4, slots = new Array(16).fill(0), cnt = new Array(16).fill(0);
        for (let i = Math.floor(0.06 * sr); i < d.length; i++) { const s = Math.floor((i / sr - 0.06) / d16) % 16; slots[s] += d[i] * d[i]; cnt[s]++; }
        return slots.map((v, i) => +Math.sqrt(v / cnt[i]).toFixed(3));
      },
      // Phase B loops: fake the state they follow and read back the loop gains
      async loops() {
        await AT.unlock(); const P = G.state.player, o = {}, L = audio.loops, s = sleep;
        const read = () => Object.fromEntries(['spin', 'lance', 'sizzle', 'shield', 'reel', 'whistle', 'fire', 'fireLow'].map(k => [k, +L[k].lg.toFixed(3)]).concat(L.torch.map((T, i) => ['torch' + i, +T.lg.toFixed(3)])));
        G.state.phase = 'playing'; P.mode = 'mech'; P.weapons = [{ id: 'autocannon', spin: 0.8 }]; me.shield = { on: true, hp: 500 };
        const cb = G.combat, ob = cb.beams, op = cb.projectiles, od = G.destruct.fires, oj = G.destruct.jets;
        cb.beams = [{ ttl: 0.2, shooter: me, ox: 96, oy: 5, oz: 130, dx: 0, dy: 0, dz: -1, len: 20, hit: true }];
        cb.projectiles = [{ id: 'mortar_b', kind: 'shell', pos: new THREE.Vector3(100, 20, 125), vel: new THREE.Vector3(0, -25, 0) }];
        G.destruct.fires = { count: 3, x: new Float32Array([98, 99, 110]), y: new Float32Array([3, 3, 3]), z: new Float32Array([128, 128, 120]), heat: new Float32Array([1, 0.6, 1.2]) };
        G.destruct.jets = { count: 4, x: new Float32Array([100, 60, 120, 96]), y: new Float32Array([2, 2, 2, 2]), z: new Float32Array([126, 60, 130, 20]), t: new Float32Array([5, 5, 5, 5]) };
        bus.emit('grapple', { ent: me, state: 'reel', x: 100, y: 20, z: 100 });
        for (let i = 0; i < 12; i++) { audio.update(0.016); await s(30); }
        o.on = read();
        P.weapons = [{ id: 'autocannon', spin: 0 }]; me.shield.on = false; cb.beams = []; cb.projectiles = []; G.destruct.fires = { count: 0 }; G.destruct.jets = { count: 0 }; bus.emit('grapple', { ent: me, state: 'release' });
        const p0 = audio.stats.played; for (let i = 0; i < 12; i++) { audio.update(0.016); await s(30); }
        o.off = read(); o.tailSounds = audio.stats.played - p0;
        G.destruct.fires = undefined; G.destruct.jets = undefined; for (let i = 0; i < 3; i++) audio.update(0.016); o.noFiresOk = true;
        cb.beams = ob; cb.projectiles = op; G.destruct.fires = od; G.destruct.jets = oj; P.mode = 'pilot'; P.weapons = []; o.errors = errs.slice();
        return o;
      },
      async muteCheck() { return { hasCtx: !!audio.ctx, played: audio.play('rifle', {}), unlock: audio.unlock() }; },
      async all() { return { events: await AT.events(), names: await AT.names() }; },
    };

    if (G.params.has('panel')) {
      const el = document.createElement('div');
      el.style.cssText = 'position:absolute;inset:8px;overflow:auto;pointer-events:auto;font:11px/1.3 ui-monospace,monospace;color:#bfe;background:#0b1114e6;padding:10px;border:1px solid #2ee6ff55';
      const mk = (label, fn, col) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = `margin:2px;padding:3px 6px;background:#12202a;color:${col || '#9fe8ff'};border:1px solid #2a4a58;font:inherit;cursor:pointer`; b.onclick = () => { audio.unlock(); fn(); }; el.appendChild(b); };
      const h = t => { const d = document.createElement('div'); d.textContent = t; d.style.cssText = 'margin:8px 0 2px;color:#ffb347;letter-spacing:.12em'; el.appendChild(d); };
      h('KILOTON AUDIO — AUDITION BOARD   (click = at the listener, shift+click = 80 m away)');
      h('MUSIC'); for (const s of audio.musicStates) mk(s, () => { audio.forceMusic = s; }, '#ffd27a'); mk('auto', () => { audio.forceMusic = null; }, '#ffd27a'); mk('intensity 0', () => { audio.heat = 0; }, '#ffd27a'); mk('intensity 1', () => { audio.heat = 1; }, '#ffd27a');
      h('ONE-SHOTS'); for (const n of audio.names) mk(n, () => audio.play(n, window.event && window.event.shiftKey ? { x: G.camera.position.x + 60, y: 4, z: G.camera.position.z - 55 } : {}));
      const st = document.createElement('pre'); st.style.cssText = 'margin-top:10px;color:#7fa'; el.appendChild(st);
      setInterval(() => { st.textContent = JSON.stringify(audio.stats); }, 250);
      G.uiRoot.appendChild(el);
    }
  },
});
