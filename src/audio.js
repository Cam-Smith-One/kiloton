// ============================================================================
// KILOTON — audio.js   OWNER: AUDIO
// The whole soundscape, synthesised with the Web Audio API. No samples.
//   G.audio.unlock()                       create/resume the AudioContext (user gesture)
//   G.audio.play(name, { x,y,z, vol, pitch, own, ... })   one-shot (names: G.audio.names)
//   G.audio.setVolume(master, music)       0..1 each (also follows state.settings)
//   G.audio.update(dt)                     listener, loops, repeating cues, music scheduler
// Graph:  voices -> [gain -> lowpass -> pan] -> sfx ┐
//                                   └-> reverb send ┤-> master -> compressor -> limiter -> soft clip -> out
//         music layers -> duck -> music ────────────┘
// Recipes live in audio_synth.js, the score in audio_music.js.
// ============================================================================
import { G, bus, clamp, sat, GROUND_Y } from './core.js';
import { MAT } from './materials.js';
import { SOUNDS, SOUND_NAMES, stats as synthStats, noiseBuffer, gain, filt } from './audio_synth.js';
import { createMusic, MUSIC_STATES } from './audio_music.js';

// ---- sound table: name -> [family, gain, reference distance (m), reverb send] ----
const DEF = {
  rifle: ['wp', 0.6, 16, 0.3], rocket_launch: ['rocket', 0.7, 22, 0.35], grenade: ['wp', 0.5, 14, 0.2],
  pulse: ['wp', 0.7, 24, 0.35], overheat: ['mech', 0.4, 12, 0.1], salvo_rocket: ['rocket', 0.65, 24, 0.35], salvo: ['rocket', 0.5, 24, 0.3],
  lock_beep: ['alert', 0.3, 0, 0], lock_on: ['alert', 0.35, 0, 0], lock_tone: ['alert', 0.3, 0, 0], lock_lost: ['alert', 0.3, 0, 0],
  skylance_launch: ['rocket', 0.55, 24, 0.3], rocket_flyby: ['rocket', 0.5, 10, 0.1],
  e_rifle: ['we', 0.6, 14, 0.25], e_rocket: ['rocket', 0.55, 20, 0.3], e_shell: ['we', 0.8, 40, 0.4], e_drone: ['we', 0.35, 12, 0.15],
  e_chain: ['we', 0.5, 22, 0.3], e_pulse: ['we', 0.55, 24, 0.3],
  impact_concrete: ['impact', 0.6, 9, 0.15], impact_metal: ['impact', 0.35, 9, 0.2], impact_glass: ['impact', 0.35, 8, 0.15],
  impact_wood: ['impact', 0.4, 8, 0.1], impact_dirt: ['impact', 0.75, 8, 0.05], impact_soft: ['impact', 0.35, 7, 0.05], impact_armor: ['impact', 0.45, 12, 0.2],
  whiz: ['whiz', 0.35, 0, 0],
  explosion: ['explosion', 1.0, 50, 0.55], collapse: ['collapse', 1.0, 65, 0.5], crumble: ['crumble', 0.5, 16, 0.2],
  glass_shatter: ['glass', 0.45, 14, 0.3], debris_concrete: ['debris', 0.85, 11, 0.15], debris_metal: ['debris', 0.4, 12, 0.25],
  debris_glass: ['debris', 0.3, 9, 0.2], debris_wood: ['debris', 0.4, 9, 0.1], debris_dirt: ['debris', 0.4, 8, 0.05], levelled: ['sting', 0.5, 0, 0.5],
  footstep_rig: ['step', 0.85, 20, 0.3], footstep_pilot: ['step', 0.5, 6, 0.05],
  punch_windup: ['mech', 0.5, 14, 0.15], punch: ['mech', 0.95, 24, 0.35], jet_ignite: ['mech', 0.5, 20, 0.2], jet_off: ['mech', 0.35, 16, 0.2],
  jet: ['mech', 0.5, 20, 0.2], jetpack: ['mech', 0.4, 10, 0.1], slam: ['big', 1.0, 45, 0.5], dash: ['mech', 0.55, 16, 0.2],
  grab: ['mech', 0.5, 14, 0.2], throw: ['mech', 0.55, 14, 0.2],
  rig_drop_incoming: ['big', 0.75, 120, 0.4], rig_land: ['big', 1.0, 70, 0.5], board: ['big', 0.55, 12, 0.1],
  selfdestruct_alarm: ['alert', 0.35, 0, 0], eject: ['big', 0.6, 20, 0.2], selfdestruct: ['big', 1.0, 80, 0.5],
  damage_pilot: ['hurt', 0.5, 0, 0], damage_rig: ['hurt', 0.5, 0, 0.1], heartbeat: ['alert', 0.6, 0, 0], alarm_low: ['alert', 0.28, 0, 0],
  soldier_down: ['death', 0.4, 9, 0.1], drone_down: ['death', 0.45, 16, 0.2], wreck: ['death', 0.7, 30, 0.4],
  hit_confirm: ['confirm', 0.2, 0, 0], kill_confirm: ['confirm', 0.25, 0, 0],
  reload: ['ui', 0.35, 5, 0], reload_heavy: ['ui', 0.4, 8, 0.05], weapon_empty: ['ui', 0.35, 4, 0], weapon_ready: ['ui', 0.22, 0, 0],
  lock_warning: ['alert', 0.3, 0, 0], ace_warning: ['alert', 0.3, 30, 0.2], ace_called: ['sting', 0.45, 0, 0.3],
  rig_ready: ['sting', 0.45, 0, 0.25], wave_start: ['sting', 0.5, 0, 0.3], wave_clear: ['sting', 0.5, 0, 0.35],
  enemy_drop: ['sting', 0.4, 0, 0.2], defeat: ['sting', 0.6, 0, 0.4],
  autocannon: ['wp', 0.6, 22, 0.3], autocannon_wind: ['mech', 0.3, 12, 0.1], lance_start: ['wp', 0.55, 20, 0.25], lance_stop: ['mech', 0.35, 14, 0.2],
  siege: ['big', 1.0, 60, 0.6], recoil: ['mech', 0.6, 14, 0.15], swarm_launch: ['rocket', 0.45, 20, 0.3], swarm: ['rocket', 0.45, 20, 0.3],
  mortar: ['rocket', 0.8, 30, 0.4], mortar_split: ['explosion', 0.6, 35, 0.5],
  shield_up: ['equip', 0.5, 14, 0.15], shield_down: ['equip', 0.35, 12, 0.1], shield_hit: ['shield', 0.6, 16, 0.2], shield_break: ['equip', 0.8, 22, 0.3],
  grapple_fire: ['equip', 0.6, 16, 0.2], grapple_latch: ['equip', 0.6, 20, 0.3], grapple_miss: ['equip', 0.35, 10, 0.1], grapple_release: ['equip', 0.4, 10, 0.1],
  limb_torn: ['big', 0.9, 30, 0.4], finisher_grab: ['equip', 0.7, 20, 0.2], finisher: ['big', 1.0, 40, 0.5], brace_on: ['equip', 0.7, 16, 0.2], brace_off: ['equip', 0.45, 12, 0.1],
  airdash: ['mech', 0.55, 16, 0.2], charge_mount: ['equip', 0.5, 8, 0.1], charge_planted: ['alert', 0.4, 14, 0.1], hijack: ['big', 0.55, 12, 0.15],
  fire_start: ['crumble', 0.4, 12, 0.2], fire_out: ['crumble', 0.25, 10, 0.15], gas_jet: ['explosion', 0.7, 35, 0.4], bay_fit: ['ui', 0.45, 0, 0.25], bay_paint: ['ui', 0.3, 0, 0.1], bay_open: ['ui', 0.4, 0, 0.3],
  objective_new: ['sting', 0.35, 0, 0.2], objective_done: ['sting', 0.45, 0, 0.3], stage_banner: ['sting', 0.5, 0, 0.35], perk_offer: ['ui', 0.4, 0, 0.3], perk_pick: ['sting', 0.45, 0, 0.25],
  salvage: ['confirm', 0.25, 0, 0.1], boss_arrive: ['big', 0.2, 0, 0.5], boss_phase: ['big', 0.65, 0, 0.45], victory: ['big', 0.6, 0, 0.4], mission_failed: ['sting', 0.45, 0, 0.3],
  seeker_launch: ['rocket', 0.5, 20, 0.25], roll: ['step', 0.4, 6, 0.05], crouch: ['step', 0.25, 5, 0], mantle: ['step', 0.4, 6, 0.05],
  amb_gunfire: ['amb', 0.1, 0, 0.9], amb_boom: ['amb', 0.11, 0, 0.8], amb_siren: ['amb', 0.07, 0, 0.9], ui_confirm: ['ui', 0.3, 0, 0],
  ui_click: ['ui', 0.3, 0, 0], ui_hover: ['ui', 0.2, 0, 0], ui_back: ['ui', 0.3, 0, 0], ui_start: ['ui', 0.45, 0, 0.15],
  ui_pause: ['ui', 0.3, 0, 0], ui_resume: ['ui', 0.3, 0, 0], ui_msg: ['ui', 0.22, 0, 0],
};
// family -> [max simultaneous voices, min seconds between starts, protected from the global cap]
const FAMDEF = {
  wp: [8, 0.02], we: [8, 0.03], rocket: [7, 0.03], impact: [8, 0.025], whiz: [3, 0.07], explosion: [6, 0.04, 1], collapse: [2, 0.4, 1],
  crumble: [4, 0.08], glass: [4, 0.06], debris: [8, 0.04], step: [6, 0.04], mech: [6, 0.03], big: [5, 0, 1], hurt: [3, 0.08],
  amb: [4, 0.2], equip: [5, 0.03], shield: [3, 0.06], alert: [5, 0.02], death: [5, 0.03], confirm: [3, 0.04], ui: [6, 0.015], sting: [3, 0.05, 1],
};
const FAM = {};
for (const k in FAMDEF) FAM[k] = { max: FAMDEF[k][0], gap: FAMDEF[k][1], keep: !!FAMDEF[k][2], n: 0, last: -9 };
const MAX_VOICES = 56, SOUND_SPEED = 343, MUSIC_GAIN = 0.85, SFX_DRIVE = 1.5, MAKEUP = 1.5, OWN_BOOST = 1.3;
const SHOT = {
  rifle: 'rifle', launcher: 'rocket_launch', grenade: 'grenade', pulse: 'pulse', salvo: 'salvo_rocket', skylance: 'skylance_launch', seeker: 'seeker_launch',
  autocannon: 'autocannon', lance: 'lance_start', siege: 'siege', swarm: 'swarm_launch', mortar: 'mortar', mortar_b: 'mortar_split',
  e_turret: 'e_chain', e_siege: 'e_shell', e_swarm: 'e_rocket',
  e_rifle: 'e_rifle', e_rpg: 'e_rocket', e_shell: 'e_shell', e_drone: 'e_drone', e_chain: 'e_chain', e_gsrocket: 'e_rocket', e_pulse: 'e_pulse', e_salvo: 'e_rocket',
};
const SHOT_PITCH = { e_gsrocket: 1.2, e_salvo: 0.85, e_turret: 1.25, e_siege: 0.7, e_swarm: 1.45 };
const EMPTY = {};

// ---- runtime ------------------------------------------------------------------
let ctx = null, graph = null, music = null, muted = false, wired = false;
let volMaster = 0.8, volMusic = 0.6, seenVol = -1, seenMus = -1;
const voices = [], freeVoices = [];
const stats = { voices: 0, peakVoices: 0, played: 0, dropped: 0, stolen: 0, nodes: 0, state: 'off', music: '' };
// listener (camera), refreshed every update
const Lp = { x: 96, y: 20, z: 150, rx: 1, ry: 0, rz: 0, bx: 0, by: 0, bz: 1 };
const sp = { att: 1, pan: 0, lp: 20000, dly: 0, d: 0 };
// state for continuous / repeating sounds
const loops = {};
const jets = [];
let pulseAlt = 0, heat = 0, lockState = '', lockT = 0, warnOn = false, warnT = 0, beatT = 0, aceT = -9, duckT = -9;
const tg = [0, 0, 0], tp = [0, 0, 0], tl = [0, 0, 0];
let grappleOn = false, grappleT = 0, lanceWas = false, spinWas = 0, bayPaint = '', bayChassis = '', bayActive = -1, bayT = -9, fireStartT = -9;
const CHASSIS_STEP = { harrier: [1.3, 0.7, 0.75], warden: [1, 1, 1], bastion: [0.78, 1.35, 1.2] };   // [pitch, mass, level]
let won = false, salvT = -9, salvN = 0, bossT = -9;
let slideEnt = null, ambGunT = 3, ambBoomT = 8, ambSirenT = 14, lastMusHeat = -1;
let inboundUntil = 0, pausedMuffle = false, musicTimer = 0, lastHurtT = -9;
const rocketKind = {};

// Master chain for any context (live or offline): returns the buses.
export function buildGraph(c) {
  const master = gain(c, 1), comp = c.createDynamicsCompressor(), lim = c.createDynamicsCompressor(), clip = c.createWaveShaper();
  comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.006; comp.release.value = 0.16;   // firm bus glue; the 6 ms attack lets transients through
  lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
  const makeup = gain(c, MAKEUP);
  const cv = new Float32Array(2048);            // soft clip: transparent below ~0.6, never above 0.97
  for (let i = 0; i < 2048; i++) { const x = (i / 1023.5 - 1) * 2, a = Math.abs(x); cv[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.37 * Math.tanh((a - 0.6) / 0.37)); }
  clip.curve = cv;
  const pre = gain(c, 0.5), post = gain(c, 1);  // the curve spans inputs of -2..2
  master.connect(comp); comp.connect(makeup); makeup.connect(lim); lim.connect(pre); pre.connect(clip); clip.connect(post); post.connect(c.destination);
  const sfx = gain(c, SFX_DRIVE), mus = gain(c, 1), duck = gain(c, 1), sat = c.createWaveShaper(), satOut = gain(c, 0.8);
  const sc = new Float32Array(2048);            // bus saturation: density rather than level (input range -3..3)
  for (let i = 0; i < 2048; i++) { const x = (i / 1023.5 - 1) * 3; sc[i] = Math.tanh(x * 1.1) / Math.tanh(1.1) * 0.9; }
  sat.curve = sc; const satIn = gain(c, 1 / 3);
  sfx.connect(satIn); satIn.connect(sat); sat.connect(satOut); satOut.connect(master); duck.connect(mus); mus.connect(master);
  // "city" reverb: procedurally built impulse — slap-back echoes off facades, then a dark diffuse tail
  const sr = c.sampleRate, len = Math.floor(sr * 2.4), ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr, k = 0.05 + 0.5 * Math.exp(-t * 2.2);          // tail gets darker with time
      lp += k * ((Math.random() * 2 - 1) - lp);
      d[i] = lp * Math.exp(-t * 2.6) * (t < 0.012 ? t / 0.012 : 1) * 1.6;
    }
    const taps = ch ? [0.071, 0.137, 0.223, 0.331] : [0.059, 0.149, 0.211, 0.367];
    for (let n = 0; n < taps.length; n++) {
      const i0 = Math.floor(taps[n] * sr), a = 0.55 / (1 + n);
      for (let i = 0; i < 90; i++) d[i0 + i] += a * (Math.random() * 2 - 1) * Math.exp(-i / 22);
    }
  }
  const conv = c.createConvolver(); conv.buffer = ir;
  const revIn = gain(c, 1), revOut = gain(c, 0.5);
  revIn.connect(conv); conv.connect(revOut); revOut.connect(sfx);
  return { master, sfx, music: mus, duck, revIn, comp, lim };
}

function spatial(x, y, z, ref) {
  const dx = x - Lp.x, dy = y - Lp.y, dz = z - Lp.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  sp.d = d;
  sp.att = ref / (ref + Math.max(0, d - 2)) * sat(1.15 - d / 260);
  const inv = d > 0.001 ? 1 / d : 0, side = (dx * Lp.rx + dy * Lp.ry + dz * Lp.rz) * inv, behind = (dx * Lp.bx + dy * Lp.by + dz * Lp.bz) * inv;
  sp.pan = clamp(side * 0.85 * sat(d / 3), -1, 1);
  sp.lp = clamp(20000 * Math.exp(-d / 55), 420, 20000) * (behind > 0.3 ? 0.65 : 1);       // air absorption + a rear cue
  sp.dly = d > 10 ? Math.min(d / SOUND_SPEED, 1.2) : 0;
}

function steal(fam, now) {
  let best = -1, bt = 1e9;
  for (let i = 0; i < voices.length; i++) { const v = voices[i]; if (v.fam === fam && !v.dead && v.start < bt) { bt = v.start; best = i; } }
  if (best < 0) return;
  const v = voices[best];
  v.g.gain.cancelScheduledValues(now); v.g.gain.setTargetAtTime(0, now, 0.012);
  v.end = now + 0.08; v.dead = true; fam.n--; stats.stolen++;
}

function play(name, o) {
  if (!ctx || ctx.state !== 'running') return 0;
  const def = DEF[name], fn = SOUNDS[name]; if (!def || !fn) return 0;
  o = o || EMPTY;
  const fam = FAM[def[0]], now = ctx.currentTime;
  if (now - fam.last < fam.gap) { stats.dropped++; return 0; }
  if (voices.length >= MAX_VOICES && !fam.keep) { stats.dropped++; return 0; }
  let vol = def[1] * (o.vol == null ? 1 : o.vol), dly = 0, pan = 0, lpf = 20000, send = def[3], pos = false, d = 0;
  if (o.x != null && def[2] > 0) {
    spatial(o.x, o.y == null ? Lp.y : o.y, o.z, def[2]);
    pos = true; d = sp.d;
    if (o.own) { pan = sp.pan * 0.35; vol *= OWN_BOOST; send *= 0.7; }   // the player's own gear: in front, dry, no delay
    else {
      vol *= sp.att; pan = sp.pan; lpf = sp.lp; dly = sp.dly; send *= 0.6 + Math.min(1.2, d / 50);
      if (o.floor) vol = Math.max(vol, def[1] * o.floor);
      if (o.nodelay) dly = 0;
    }
  }
  if (o.pan != null) pan = o.pan;
  if (o.own && !pos) vol *= OWN_BOOST;
  if (vol < 0.004) { stats.dropped++; return 0; }
  if (fam.n >= fam.max) steal(fam, now);
  // chain
  const v = freeVoices.pop() || { g: null, a: null, b: null, c: null, fam: null, start: 0, end: 0, dead: false };
  const g = gain(ctx, Math.min(vol, 1.6));
  let tail = g; v.a = v.b = v.c = null;
  if (pos && lpf < 16000) { const f = v.a = filt(ctx, 'lowpass', lpf, 0.5); tail.connect(f); tail = f; }
  if (send > 0.01) { const s = v.c = gain(ctx, send); tail.connect(s); s.connect(graph.revIn); }
  if (Math.abs(pan) > 0.02) { const p = v.b = ctx.createStereoPanner(); synthStats.nodes++; p.pan.value = pan; tail.connect(p); tail = p; }
  tail.connect(graph.sfx);
  const t0 = now + 0.004 + dly;
  let opts = o;
  if (pos && !o.own && (name === 'explosion' || name === 'selfdestruct')) { opts = Object.assign({}, o); opts.lag = Math.min(0.4, d * 0.002); }   // crack, then boom
  let dur = 0.5;
  try { dur = fn(ctx, g, t0, opts) || 0.5; } catch (e) { if (G.debug) console.warn('audio recipe', name, e); }
  v.g = g; v.fam = fam; v.start = now; v.end = t0 + dur + 0.12; v.dead = false;
  voices.push(v); fam.n++; fam.last = now; stats.played++;
  if (voices.length > stats.peakVoices) stats.peakVoices = voices.length;
  return dur;
}

function sweep(now) {
  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i];
    if (now < v.end) continue;
    try { v.g.disconnect(); if (v.a) v.a.disconnect(); if (v.b) v.b.disconnect(); if (v.c) v.c.disconnect(); } catch (e) {}
    if (!v.dead) v.fam.n--;
    v.g = v.a = v.b = v.c = null;
    voices[i] = voices[voices.length - 1]; voices.pop(); freeVoices.push(v);
  }
  stats.voices = voices.length;
}

// ---- continuous loops (built once at unlock, only their params move) ------------
function makeNoiseLoop(color, ftype, f, q, rate) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuffer(ctx, color); s.loop = true; s.playbackRate.value = rate || 1;
  const fl = filt(ctx, ftype, f, q), g = gain(ctx, 0), p = ctx.createStereoPanner();
  s.connect(fl); fl.connect(g); g.connect(p); p.connect(graph.sfx); s.start();
  return { s, f: fl, g, p, lg: 0, lp: 0, lf: f };
}
function setLoop(L, g, pan, f, now) {
  if (Math.abs(g - L.lg) > 0.004) { L.g.gain.setTargetAtTime(g, now, 0.06); L.lg = g; }
  if (Math.abs(pan - L.lp) > 0.03) { L.p.pan.setTargetAtTime(pan, now, 0.08); L.lp = pan; }
  if (f && Math.abs(f - L.lf) > L.lf * 0.03) { L.f.frequency.setTargetAtTime(f, now, 0.08); L.lf = f; }
}
function makeToneLoop(t1, t2, ratio, ftype, f, q) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), g2 = gain(ctx, 0.5), fl = filt(ctx, ftype, f, q), g = gain(ctx, 0), p = ctx.createStereoPanner();
  o1.type = t1; o2.type = t2; o1.frequency.value = 100; o2.frequency.value = 100 * ratio;
  o1.connect(fl); o2.connect(g2); g2.connect(fl); fl.connect(g); g.connect(p); p.connect(graph.sfx); o1.start(); o2.start();
  return { o1, o2, ratio, f: fl, g, p, lg: 0, lp: 0, lf: f, lo: 100 };
}
function setTone(L, g, pan, hz, now) {
  if (Math.abs(g - L.lg) > 0.003) { L.g.gain.setTargetAtTime(g, now, 0.05); L.lg = g; }
  if (Math.abs(pan - L.lp) > 0.03) { L.p.pan.setTargetAtTime(pan, now, 0.08); L.lp = pan; }
  if (g > 0 && Math.abs(hz - L.lo) > L.lo * 0.015) { L.o1.frequency.setTargetAtTime(hz, now, 0.04); L.o2.frequency.setTargetAtTime(hz * L.ratio, now, 0.04); L.lo = hz; }
}
function buildLoops() {
  loops.jet = makeNoiseLoop('pink', 'lowpass', 1500, 0.9, 1);          // the player's jets
  loops.jetLow = makeNoiseLoop('brown', 'lowpass', 300, 0.7, 1.3);
  loops.ejet = makeNoiseLoop('pink', 'lowpass', 1100, 0.9, 0.8);       // nearest other jet
  loops.rocket = makeNoiseLoop('white', 'bandpass', 900, 2.2, 1);      // nearest rocket in flight
  loops.wind = makeNoiseLoop('brown', 'lowpass', 420, 0.5, 0.7);       // the city's air
  loops.rumble = makeNoiseLoop('brown', 'lowpass', 85, 0.7, 0.5);      // the city's weight: traffic, plant, far-off war
  loops.slide = makeNoiseLoop('white', 'bandpass', 1900, 0.8, 0.6);    // pilot slide: gravel scrape
  loops.fire = makeNoiseLoop('crackle', 'bandpass', 2400, 0.4, 1);     // nearest fire
  loops.fireLow = makeNoiseLoop('brown', 'lowpass', 500, 0.6, 0.9);    // the roar under a big fire
  loops.torch = [];                                                    // burning gas jets: hiss band + low roar each, different rates so three do not phase
  for (let k = 0; k < 3; k++) { const T = makeNoiseLoop('pink', 'bandpass', 760 + k * 140, 0.8, 1.3 + k * 0.17); T.low = makeNoiseLoop('brown', 'lowpass', 240, 0.8, 1.0 + k * 0.2); loops.torch.push(T); }
  loops.sizzle = makeNoiseLoop('crackle', 'highpass', 2600, 0.7, 2.2); // lance at the point of contact
  loops.spin = makeToneLoop('sawtooth', 'square', 1.5, 'bandpass', 500, 2.5);        // autocannon motor
  loops.lance = makeToneLoop('sawtooth', 'sawtooth', 2.02, 'bandpass', 900, 1.2);     // arc lance hum
  loops.shield = makeToneLoop('sine', 'triangle', 1.498, 'lowpass', 900, 0.7);        // aegis hum
  loops.reel = makeToneLoop('sawtooth', 'square', 2.0, 'bandpass', 1400, 3);          // grapple winch
  loops.whistle = makeToneLoop('sine', 'sine', 1.007, 'lowpass', 6000, 0.5);          // mortar bombs coming down
  // rig reactor hum
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = filt(ctx, 'lowpass', 260, 2), g = gain(ctx, 0);
  o1.type = 'sawtooth'; o2.type = 'sawtooth'; o1.frequency.value = 48; o2.frequency.value = 72.4;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(graph.sfx); o1.start(); o2.start();
  loops.hum = { o1, o2, f, g, lg: 0, lf: 48 };
  // Skylance solid lock tone
  const l1 = ctx.createOscillator(), l2 = ctx.createOscillator(), lg2 = gain(ctx, 0.25), lg = gain(ctx, 0);
  l1.frequency.value = 1670; l2.type = 'triangle'; l2.frequency.value = 2505;
  l1.connect(lg); l2.connect(lg2); lg2.connect(lg); lg.connect(graph.sfx); l1.start(); l2.start();
  loops.lock = { g: lg, lg: 0 };
}

function unlock() {
  if (muted) return false;
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      ctx = new AC({ latencyHint: 'interactive' });
      graph = buildGraph(ctx);
      buildLoops();
      music = createMusic(ctx, graph.duck, graph.revIn);
      applyVolume(true);
      if (!musicTimer) musicTimer = setInterval(() => { if (ctx && ctx.state === 'running' && music) music.update(ctx.currentTime, 0.45); }, 120);   // keeps the score alive when frames stall
      A.ctx = ctx; A.music = music;
    }
    if (ctx.state !== 'running') { const p = ctx.resume(); if (p && p.catch) p.catch(() => {}); }
  } catch (e) { if (G.debug) console.warn('audio unlock failed', e); return false; }
  return true;
}

function applyVolume(now) {
  if (!ctx) return;
  const t = ctx.currentTime, m = clamp(volMaster, 0, 1), mu = clamp(volMusic, 0, 1);
  graph.master.gain.setTargetAtTime(m * m * 1.25, t, now ? 0.001 : 0.05);
  graph.music.gain.setTargetAtTime(mu * mu * MUSIC_GAIN * (1 - 0.3 * heat), t, now ? 0.001 : 0.05);
}

function duck(amount, now) {
  if (now - duckT < 0.25) return; duckT = now;
  graph.duck.gain.cancelScheduledValues(now);
  graph.duck.gain.setTargetAtTime(1 - amount, now, 0.02);
  graph.duck.gain.setTargetAtTime(1, now + 0.35, 0.5);
}

const matSound = (m) => { const t = typeof m === 'number' ? MAT[m] : null; const s = t ? t.sound : typeof m === 'string' ? m : 'concrete'; return s === 'soft' ? 'soft' : s; };
const isOwn = (e) => !!e && (e.isPlayer || e === G.state.player.ent);
const nearPlayer = (x, y, z, r) => { const e = G.state.player.ent; if (!e || !e.pos) return false; const dx = e.pos.x - x, dy = e.pos.y - y, dz = e.pos.z - z; return dx * dx + dy * dy + dz * dz < r * r; };

// ---- bus wiring -------------------------------------------------------------
function wire() {
  if (wired) return; wired = true;
  const on = (t, f) => bus.on(t, (d) => { if (ctx && ctx.state === 'running') f(d || EMPTY); });
  const always = (t, f) => bus.on(t, (d) => f(d || EMPTY));      // state-tracking events are heard even before unlock
  on('shot', (e) => {
    const own = isOwn(e.shooter), w = e.weapon;
    let name = SHOT[w] || (e.team === 1 || (e.shooter && e.shooter.team === 1) ? 'e_rifle' : 'rifle');
    const pitch = SHOT_PITCH[w] || 1;
    if (name === 'pulse') { play(name, { x: e.x, y: e.y, z: e.z, own, alt: pulseAlt, pitch }); pulseAlt ^= 1; }
    else play(name, { x: e.x, y: e.y, z: e.z, own, pitch });
    heat = Math.min(1, heat + 0.03);
  });
  on('tracer', (e) => {                                   // near misses
    if (e.team === 0 || e.x0 == null) return;
    const ax = e.x1 - e.x0, ay = e.y1 - e.y0, az = e.z1 - e.z0, l2 = ax * ax + ay * ay + az * az; if (l2 < 4) return;
    const u = ((Lp.x - e.x0) * ax + (Lp.y - e.y0) * ay + (Lp.z - e.z0) * az) / l2; if (u < 0.05 || u > 0.98) return;
    const px = e.x0 + ax * u - Lp.x, py = e.y0 + ay * u - Lp.y, pz = e.z0 + az * u - Lp.z, d2 = px * px + py * py + pz * pz;
    if (d2 < 30) play('whiz', { vol: 1 - d2 / 40 });
  });
  on('impact', (e) => {
    const k = e.ent ? (e.ent.kind === 'soldier' || e.ent.kind === 'pilot' ? 'soft' : 'armor') : matSound(e.mat);
    const w = e.weapon || '';
    if (w === 'lance') return;                             // the beam's sizzle loop covers its ticks
    play('impact_' + k, { x: e.x, y: e.y, z: e.z, vol: clamp((e.power == null ? 40 : e.power) / 60, 0.5, 1.5), pulse: w === 'pulse' || w === 'e_pulse' });
  });
  on('explosion', (e) => {
    const r = e.radius || 3;
    play('explosion', { x: e.x, y: e.y, z: e.z, size: clamp(r / 10, 0.1, 1.6), kind: e.kind, vol: clamp(0.55 + r / 12, 0.6, 1.3) });
    spatial(e.x, e.y, e.z, 40);
    if (sp.d < 30 + r * 6) duck(clamp(r / 14, 0.15, 0.6) * sat(1.2 - sp.d / (30 + r * 6)), ctx.currentTime);
    heat = Math.min(1, heat + 0.12);
  });
  on('voxels:destroyed', (e) => {
    const k = matSound(e.mat), n = e.count || 1;
    if (k === 'glass') play('glass_shatter', { x: e.x, y: e.y, z: e.z, size: sat(n / 60), vol: clamp(0.5 + n / 80, 0.5, 1.3) });
    else if (n >= 6) play('crumble', { x: e.x, y: e.y, z: e.z, size: sat(n / 500), vol: clamp(0.4 + n / 300, 0.4, 1.3), pitch: k === 'metal' ? 1.5 : k === 'wood' ? 1.25 : k === 'dirt' ? 0.7 : 1 });
  });
  on('collapse', (e) => {
    const s = sat(Math.log10(1 + (e.mass || 100)) / 5);
    play('collapse', { x: e.x, y: e.y, z: e.z, size: s, vol: 0.6 + 0.6 * s });
    heat = Math.min(1, heat + 0.1);
  });
  on('debris:impact', (e) => {
    let k = matSound(e.mat); if (k === 'soft') k = 'dirt';
    const s = sat(Math.log10(1 + (e.mass || 1)) / 3);
    play('debris_' + k, { x: e.x, y: e.y, z: e.z, size: s, vol: sat((e.speed == null ? 8 : e.speed) / 14) * (0.5 + 0.8 * s) });
  });
  on('building:levelled', () => play('levelled'));
  on('ent:damage', (e) => {
    const ent = e.ent; if (!ent) return;
    if (isOwn(ent)) {
      lastHurtT = ctx.currentTime; heat = Math.min(1, heat + 0.1);
      play(ent.kind === 'mech' ? 'damage_rig' : 'damage_pilot', { vol: clamp(0.5 + e.amount / (ent.kind === 'mech' ? 200 : 40), 0.5, 1.3) });
    } else if (e.info && isOwn(e.info.src)) play('hit_confirm');
  });
  on('ent:death', (e) => {
    const ent = e.ent; if (!ent || !ent.pos) return;
    const k = ent.kind, p = ent.pos;
    if (k === 'soldier') play('soldier_down', { x: p.x, y: p.y + 1, z: p.z });
    else if (k === 'drone') play('drone_down', { x: p.x, y: p.y, z: p.z });
    else if (k === 'tank' || k === 'gunship' || k === 'emech' || k === 'mech') play('wreck', { x: p.x, y: p.y + 2, z: p.z, pitch: k === 'gunship' ? 1.3 : 1 });
    if (ent.team === 1 && e.info && isOwn(e.info.src)) play('kill_confirm');
  });
  on('footstep', (e) => {
    if (e.heavy) {
      const own = e.team === 0 && nearPlayer(e.x, e.y, e.z, 7), cs = (own && CHASSIS_STEP[G.state.player.chassis]) || (e.chassis && CHASSIS_STEP[e.chassis]) || CHASSIS_STEP.warden;
      play('footstep_rig', { x: e.x, y: e.y, z: e.z, own, pitch: cs[0] * (e.team === 1 ? 0.86 : 1), w: cs[1], vol: cs[2] });
    }
    else play('footstep_pilot', { x: e.x, y: e.y, z: e.z, own: e.team === 0 && nearPlayer(e.x, e.y, e.z, 2), pitch: e.team === 1 ? 0.9 : 1.05 });
  });
  on('punch', (e) => {
    const big = e.heavy || e.combo >= 3 || e.combo === true && e.heavy;
    play('punch', { x: e.x, y: e.y, z: e.z, hit: !!e.hit, own: e.team === 0, pitch: (e.team === 1 ? 0.88 : 1) * (big ? 0.8 : 1), vol: big ? 1.25 : 1 });
    if (e.bash) play('shield_hit', { x: e.x, y: e.y, z: e.z, own: true, pitch: 0.7 });
  });
  on('slam', (e) => { play('slam', { x: e.x, y: e.y, z: e.z, size: clamp((e.radius || 7) / 9, 0.3, 1.4), own: e.team === 0 }); duck(0.45, ctx.currentTime); });
  always('jet', (e) => {
    const ent = e.ent; if (!ent) return;
    const i = jets.indexOf(ent), pilot = ent.kind === 'pilot';
    if (e.on) {
      if (i < 0) jets.push(ent);
      const p = ent.pos; if (p) play(pilot ? 'jetpack' : 'jet_ignite', { x: p.x, y: p.y, z: p.z, own: isOwn(ent) });
    } else if (i >= 0) {
      jets.splice(i, 1);
      const p = ent.pos; if (p) play('jet_off', { x: p.x, y: p.y, z: p.z, own: isOwn(ent), pitch: pilot ? 1.6 : 1 });
    }
  });
  always('slide', (e) => { slideEnt = e.on && e.ent ? e.ent : null; });
  on('roll', (e) => { const p = e.ent && e.ent.pos; play('roll', p ? { x: p.x, y: p.y, z: p.z, own: isOwn(e.ent) } : EMPTY); });
  on('crouch', (e) => { const p = e.ent && e.ent.pos; play('crouch', p ? { x: p.x, y: p.y, z: p.z, own: isOwn(e.ent), up: !e.on } : { up: !e.on }); });
  on('mantle', (e) => { const p = e.ent && e.ent.pos; play('mantle', p ? { x: p.x, y: p.y, z: p.z, own: isOwn(e.ent) } : EMPTY); });
  on('ui:sound', (e) => play(e.name === 'confirm' ? 'ui_confirm' : e.name === 'back' ? 'ui_back' : e.name === 'tick' ? 'ui_hover' : DEF['ui_' + e.name] ? 'ui_' + e.name : 'ui_click'));
  on('dash', (e) => { const p = e.ent && e.ent.pos, n = e.air || (isOwn(e.ent) && G.state.player.chassis === 'harrier') ? 'airdash' : 'dash'; play(n, p ? { x: p.x, y: p.y, z: p.z, own: isOwn(e.ent) } : EMPTY); });
  // ---- Phase B: Rig Bay equipment and brawling
  const at = (e, extra) => { const o = extra || {}; if (e.x != null) { o.x = e.x; o.y = e.y; o.z = e.z; } else { const p = (e.ent && e.ent.pos) || (e.target && e.target.pos); if (p) { o.x = p.x; o.y = p.y + ((e.ent && e.ent.height) || 2) * 0.6; o.z = p.z; } } return o; };
  on('weapon:recoil', (e) => { play('recoil', { x: e.x, y: e.y, z: e.z, own: mine(e), size: e.strength == null ? 1 : e.strength }); if (e.strength >= 1) duck(0.35, ctx.currentTime); });
  on('shield', (e) => play(e.broken ? 'shield_break' : e.on ? 'shield_up' : 'shield_down', at(e, { own: isOwn(e.ent) })));
  on('shield:hit', (e) => play('shield_hit', at(e, { own: isOwn(e.ent), vol: clamp(0.6 + (e.amount || 20) / 120, 0.6, 1.4) })));
  always('grapple', (e) => {
    const s = e.state, own = isOwn(e.ent);
    if (s === 'reel' || s === 'pull' || s === 'yank' || s === 'miss') {
      const p = e.ent && e.ent.pos; play('grapple_fire', p ? { x: p.x, y: p.y + 4, z: p.z, own } : { own });
      if (s === 'miss') play('grapple_miss', { own }); else play('grapple_latch', at({ x: e.x, y: e.y, z: e.z, ent: e.target || e.ent }, { vol: 1 }));
    } else if (s === 'clinch') play('grapple_latch', at(e, { own, pitch: 0.8 }));
    else if (s === 'release') play('grapple_release', { own });
    grappleOn = own && (s === 'reel' || s === 'pull'); if (grappleOn && ctx) grappleT = ctx.currentTime;
  });
  on('limb:torn', (e) => { play('limb_torn', at(e, { floor: 0.5 })); duck(0.4, ctx.currentTime); });
  on('finisher', (e) => { if (e.state === 'slam') { play('finisher', at(e, { floor: 0.6 })); duck(0.55, ctx.currentTime); } else play('finisher_grab', at(e, { floor: 0.5 })); });
  on('brace', (e) => play(e.on ? 'brace_on' : 'brace_off', at(e, { own: isOwn(e.ent) })));
  on('charge:mount', (e) => play('charge_mount', at(e, { own: true })));
  on('charge:planted', (e) => play('charge_planted', at(e, { floor: 0.6 })));
  on('mech:hijack', (e) => play('hijack', { own: true }));
  // ---- Phase C: campaign
  on('objective:new', () => play('objective_new'));
  on('objective:done', () => play('objective_done'));
  on('mission:stage', () => { play('stage_banner'); heat = Math.max(heat, 0.4); });
  on('perk:offer', () => play('perk_offer'));
  on('perk:taken', () => play('perk_pick'));
  on('salvage', (e) => { const now = ctx.currentTime; salvN = now - salvT < 1.2 ? Math.min(salvN + 1, 10) : 0; salvT = now; play('salvage', { pitch: 1 + salvN * 0.06, vol: clamp(0.7 + (e.amount || 0) / 200, 0.7, 1.3) }); });
  const boss = () => { const now = ctx.currentTime; if (now - bossT < 6) return; bossT = now; play('boss_arrive'); duck(0.6, now); heat = 1; };
  on('boss:spawn', boss); on('boss:arrive', boss);
  on('ent:add', (e) => { if (e && (e.variant === 'dreadnought' || e.boss === true)) boss(); });
  on('boss:phase', (e) => { play('boss_phase', { pitch: e.phase >= 3 ? 1.12 : 1 }); duck(0.5, ctx.currentTime); heat = 1; });
  always('mission:won', () => { won = true; });
  always('game:won', () => { won = true; play('victory'); });
  always('game:start', () => { won = false; });
  on('mission:failed', () => play('mission_failed'));
  on('gas:jet', (e) => { play('gas_jet', at(e, { floor: 0.2 })); heat = Math.min(1, heat + 0.15); });
  on('fire:out', (e) => play('fire_out', at(e)));
  on('fire:start', (e) => { const now = ctx.currentTime; if (now - fireStartT < 0.5) return; fireStartT = now; play('fire_start', at(e)); });
  on('bay:open', () => { play('bay_open'); bayPaint = bayChassis = ''; });
  on('bay:close', () => play('ui_back'));
  on('bay:preview', (e) => {                              // every edit in the Rig Bay: hear what changed
    const lo = e.loadout; if (!lo) return;
    const now = ctx.currentTime, paint = JSON.stringify(lo.paint || ''), first = !bayChassis;
    if (!first && now - bayT > 0.09) {
      if (lo.chassis !== bayChassis) play('bay_fit', { size: 1, pitch: 0.8 });
      else if (paint !== bayPaint) play('bay_paint');
      else play('bay_fit', { size: 0.4 });
      bayT = now;
    }
    bayChassis = lo.chassis || 'x'; bayPaint = paint;
  });
  on('bay:changed', (e) => { if (e.active != null && e.active !== bayActive) { if (bayActive >= 0) play('ui_confirm'); bayActive = e.active; } });   // set as drop / 1-2-3
  on('mech:incoming', (e) => {
    const eta = clamp(e.eta || 3, 0.8, 12);
    play('rig_drop_incoming', { x: e.x, y: GROUND_Y + 30, z: e.z, dur: eta, floor: 0.45, nodelay: true });
    if (e.team === 1) play('enemy_drop');
    else { inboundUntil = ctx.currentTime + eta + 1.5; music.setState('inbound', { eta }); }
  });
  on('mech:land', (e) => {
    play('rig_land', { x: e.x, y: e.y, z: e.z, floor: e.team === 0 ? 0.5 : 0.15 });
    duck(0.5, ctx.currentTime);
    if (e.team !== 1) { inboundUntil = 0; music.hit(ctx.currentTime + 0.01); pickMusic(true); }
  });
  on('mech:enter', (e) => play('board', { x: e.x, y: e.y, z: e.z, own: true }));
  on('mech:eject', (e) => play('eject', { x: e.x, y: e.y, z: e.z, own: true }));
  on('mech:selfdestruct', (e) => { play('selfdestruct', { x: e.x, y: e.y, z: e.z, floor: 0.4 }); duck(0.6, ctx.currentTime); });
  on('grab', (e) => play('grab', { x: e.x, y: e.y, z: e.z, own: isOwn(e.ent) }));
  on('throw', (e) => play('throw', { x: e.x, y: e.y, z: e.z, own: isOwn(e.ent) }));
  const mine = (e) => !e.shooter || isOwn(e.shooter);
  on('weapon:reload', (e) => { if (mine(e)) play(e.weapon === 'rifle' || !e.weapon ? 'reload' : 'reload_heavy'); });
  on('weapon:overheat', (e) => { if (mine(e)) play('overheat'); });
  on('weapon:empty', (e) => { if (mine(e)) play('weapon_empty'); });
  on('weapon:ready', (e) => { if (mine(e)) play('weapon_ready'); });
  always('lock', (e) => {
    const s = e.state;
    if (s === 'locking') { if (lockState !== 'locking') lockT = 0; lockState = 'locking'; }
    else if (s === 'locked') { if (lockState !== 'locked') play('lock_on'); lockState = 'locked'; }
    else { if (s === 'lost' && lockState) play('lock_lost'); lockState = ''; }
  });
  always('lock:warning', (e) => { warnOn = !!e.on; if (warnOn) warnT = 0; });
  on('meter:ready', () => play('rig_ready'));
  on('ace:charging', (e) => {
    const now = ctx.currentTime; if (now - aceT < 2.2) return; aceT = now;
    const p = e.ent && e.ent.pos;
    play('ace_warning', p ? { x: p.x, y: p.y + 1.5, z: p.z, floor: 0.35, pitch: 1 + 0.4 * sat(e.progress || 0) } : { pitch: 1 + 0.4 * sat(e.progress || 0) });
  });
  on('ace:called', () => play('ace_called'));
  on('wave:start', () => { play('wave_start'); heat = Math.max(heat, 0.5); });
  on('wave:clear', () => play('wave_clear'));
  on('ui:message', (e) => play('ui_msg', { pitch: e.kind === 'warn' ? 0.75 : e.kind === 'good' ? 1.25 : 1 }));
  on('game:start', () => play('ui_start'));
  on('game:pause', () => play('ui_pause'));
  on('game:resume', () => play('ui_resume'));
  on('game:over', () => { if (!won) play('defeat'); });
  on('ui:title', () => play('ui_back'));
}

// which theme should be playing right now
function pickMusic(force) {
  const S = G.state, P = S.player, ph = S.phase;
  let st;
  if (ph === 'title') st = 'title';
  else if (won) st = 'intermission';                        // victory: the release theme under the debrief
  else if (ph === 'over' || P.mode === 'dead') st = 'defeat';
  else if (P.mode === 'mech') st = 'rig';
  else if (P.mechIncoming > 0 || ctx.currentTime < inboundUntil) st = 'inbound';
  else if (S.wave.intermission > 0 || (S.wave.n > 0 && S.wave.alive === 0)) st = 'intermission';
  else st = 'foot';
  if (st === 'inbound' && music.state !== 'inbound') music.setState('inbound', { eta: clamp(P.mechIncoming || 4, 0.8, 12) });
  else if (st !== music.state || force) music.setState(st);
  stats.music = music.state;
}

const A = {
  name: 'audio', stats, names: SOUND_NAMES, musicStates: MUSIC_STATES, ctx: null, music: null,
  init() {
    const p = G.params;
    muted = p.has('mute') && p.get('mute') !== '0';
    volMaster = G.state.settings.volume; volMusic = G.state.settings.music;
    seenVol = volMaster; seenMus = volMusic;
    wire();
    if (!muted) {                               // safety net: any first gesture unlocks, whoever owns the UI
      const h = () => { unlock(); if (ctx && ctx.state === 'running') { removeEventListener('pointerdown', h, true); removeEventListener('keydown', h, true); } };
      addEventListener('pointerdown', h, true); addEventListener('keydown', h, true);
    }
  },
  reset() {
    slideEnt = null; grappleOn = false; won = false; lanceWas = false; spinWas = 0;
    jets.length = 0; lockState = ''; warnOn = false; heat = 0; inboundUntil = 0; pulseAlt = 0; aceT = -9;
    if (ctx && music) music.killRiser(ctx.currentTime);
  },
  unlock, play,
  setVolume(master, mus) {
    if (master != null) volMaster = +master; if (mus != null) volMusic = +mus;
    applyVolume(false);
  },
  // force a theme for look-dev / tests (null returns control to the game state)
  forceMusic: null,
  update(dt) {
    if (!ctx) return;
    stats.state = ctx.state; stats.nodes = synthStats.nodes;
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime, S = G.state, P = S.player, set = S.settings;
    if (set.volume !== seenVol || set.music !== seenMus) { seenVol = volMaster = set.volume; seenMus = volMusic = set.music; applyVolume(false); }
    // listener: orientation from the camera, position pulled 40 % towards the controlled entity so the
    // high rig chase camera does not make the rig's own surroundings sound far away
    const cam = G.camera, e = cam.matrixWorld.elements, pe = P.ent;
    Lp.rx = e[0]; Lp.ry = e[1]; Lp.rz = e[2]; Lp.bx = e[8]; Lp.by = e[9]; Lp.bz = e[10];
    let lx = e[12], ly = e[13], lz = e[14];
    if (pe && pe.pos && pe.alive !== false) { lx += (pe.pos.x - lx) * 0.4; ly += (pe.pos.y + (pe.height || 1.8) * 0.7 - ly) * 0.4; lz += (pe.pos.z - lz) * 0.4; }
    Lp.x = lx; Lp.y = ly; Lp.z = lz;
    sweep(now);
    const playing = S.phase === 'playing', paused = S.phase === 'paused';
    heat = Math.max(0, heat - dt * 0.07);

    // ---- jets
    let pj = 0, pjPilot = false, eg = 0, epan = 0;
    for (let i = jets.length - 1; i >= 0; i--) {
      const j = jets[i];
      if (j.alive === false || !j.pos) { jets[i] = jets[jets.length - 1]; jets.pop(); continue; }
      if (isOwn(j)) { pj = 1; pjPilot = j.kind === 'pilot'; }
      else { spatial(j.pos.x, j.pos.y, j.pos.z, 20); if (sp.att * 0.4 > eg) { eg = sp.att * 0.4; epan = sp.pan; } }
    }
    if (paused) { pj = 0; eg = 0; }
    setLoop(loops.jet, pj * (pjPilot ? 0.16 : 0.3), 0, pjPilot ? 2600 : 1500, now);
    setLoop(loops.jetLow, pj * (pjPilot ? 0.05 : 0.4), 0, 0, now);
    setLoop(loops.ejet, eg, epan, 0, now);
    // ---- nearest rocket in flight
    let rg = 0, rpan = 0, rf = 900;
    const pr = G.combat && G.combat.projectiles;
    if (pr && pr.length && !paused) {
      let bd = 70 * 70, bp = null;
      for (let i = 0; i < pr.length; i++) {
        const p = pr[i], k = p.kind || p.id; if (!p.pos) continue;
        let isR = rocketKind[k]; if (isR === undefined) isR = rocketKind[k] = /rocket|missile|rpg|salvo|skylance|launcher|shell|grenade/i.test(String(p.kind) + ' ' + String(p.id));
        if (!isR) continue;
        const dx = p.pos.x - Lp.x, dy = p.pos.y - Lp.y, dz = p.pos.z - Lp.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; bp = p; }
      }
      if (bp) {
        spatial(bp.pos.x, bp.pos.y, bp.pos.z, 9);
        rg = sp.att * 0.32; rpan = sp.pan;
        if (bp.vel && sp.d > 0.5) {                           // Doppler: closing speed bends the band
          const cs = -((bp.pos.x - Lp.x) * bp.vel.x + (bp.pos.y - Lp.y) * bp.vel.y + (bp.pos.z - Lp.z) * bp.vel.z) / sp.d;
          rf = 900 * clamp(1 + cs / 240, 0.6, 1.7);
        }
      }
    }
    setLoop(loops.rocket, rg, rpan, rf, now);
    // ---- ambience bed: the city is never silent
    const inWorld = true, war = playing ? sat(0.25 + 0.5 * heat + (S.wave.alive > 0 ? 0.25 : 0) + S.wave.n * 0.03) : S.phase === 'title' ? 0.3 : 0.15;
    setLoop(loops.wind, paused ? 0.02 : 0.07 + 0.04 * sat((Lp.y - 10) / 40), 0, 0, now);
    setLoop(loops.rumble, paused ? 0.03 : 0.16 + 0.12 * war, 0, 0, now);
    if (!paused && inWorld) {
      if (now >= ambGunT) { play('amb_gunfire', { pan: Math.random() * 1.6 - 0.8, vol: 0.5 + Math.random() * 0.7 }); ambGunT = now + (1.2 + Math.random() * 5) * (1.6 - war); }
      if (now >= ambBoomT) { play('amb_boom', { pan: Math.random() * 1.4 - 0.7, vol: 0.5 + Math.random() * 0.6 }); ambBoomT = now + (4 + Math.random() * 10) * (1.6 - war); }
      if (now >= ambSirenT) { play('amb_siren', { pan: Math.random() * 1.6 - 0.8, vol: 0.6 + 0.6 * war }); ambSirenT = now + 16 + Math.random() * 30 * (1.4 - war); }
    }
    // ---- fire bed from DESTRUCT's burning cells: the nearest cluster sets level and pan, the mass of fire adds a roar
    let fg = 0, fpan = 0, fsum = 0;
    const DF = G.destruct && G.destruct.fires;
    if (!paused && DF && DF.count > 0 && DF.x) {
      const n = DF.count, step = n > 96 ? Math.ceil(n / 96) : 1, hx = DF.heat;
      let cx = 0, cy = 0, cz = 0, cw = 0, best = 0;
      for (let i = 0; i < n; i += step) {
        const dx = DF.x[i] - Lp.x, dy = DF.y[i] - Lp.y, dz = DF.z[i] - Lp.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 4900) continue;
        const h = hx ? Math.min(1.5, hx[i]) : 1, a = 7 / (7 + Math.sqrt(d2)), w = a * a * h * step;
        fsum += w; cx += dx * w; cy += dy * w; cz += dz * w; cw += w;                 // loudness-weighted centre = where the fire "is"
        if (a * h > best) best = a * h;
      }
      if (cw > 0) {
        const d = Math.sqrt(cx * cx + cy * cy + cz * cz) / cw;
        fpan = clamp((cx * Lp.rx + cy * Lp.ry + cz * Lp.rz) / cw / (d + 3), -1, 1);
        fg = Math.min(0.6, best * 0.4 + 0.07 * Math.sqrt(fsum));
      }
    }
    setLoop(loops.fire, fg, fpan, 0, now);
    setLoop(loops.fireLow, Math.min(0.35, 0.1 * Math.sqrt(fsum)), fpan * 0.5, 0, now);
    // ---- gas mains: one torch loop for each of the three nearest venting jets
    const DJ = G.destruct && G.destruct.jets;
    tg[0] = tg[1] = tg[2] = 0;
    if (!paused && DJ && DJ.count > 0) for (let i = 0; i < DJ.count; i++) {
      if (DJ.t && !(DJ.t[i] > 0)) continue;
      spatial(DJ.x[i], DJ.y[i] + 1.5, DJ.z[i], 18);
      let g = sp.att * 0.42 * (DJ.t ? sat(DJ.t[i] / 0.6) : 1), pn = sp.pan, lf = sp.lp;      // dies away over its last 0.6 s
      for (let k = 0; k < 3; k++) if (g > tg[k]) { const a = tg[k], b2 = tp[k], c2 = tl[k]; tg[k] = g; tp[k] = pn; tl[k] = lf; g = a; pn = b2; lf = c2; }
    }
    for (let k = 0; k < 3; k++) { const T = loops.torch[k]; setLoop(T, tg[k], tg[k] > 0 ? tp[k] : T.lp, 0, now); setLoop(T.low, tg[k] * 0.8, tg[k] > 0 ? tp[k] : T.low.lp, 0, now); }
    // ---- Rig Bay weapons and equipment
    let spin = 0, lanceG = 0, lanceP = 0, sizG = 0, sizP = 0, ownLance = false;
    const ws = P.weapons;
    if (ws && playing && P.mode === 'mech') for (let i = 0; i < ws.length; i++) { const w = ws[i]; if (w && w.id === 'autocannon' && w.spin > spin) spin = w.spin; }
    if (spin < 0.25 && spinWas >= 0.25 && spin < spinWas) play('autocannon_wind', { own: true, vol: 0.6 + spinWas });
    spinWas = spin;
    setTone(loops.spin, paused ? 0 : spin * 0.05, 0, 70 + 300 * spin, now);
    const bm = G.combat && G.combat.beams;
    if (bm && !paused) for (let i = 0; i < bm.length; i++) {
      const b = bm[i]; if (!(b.ttl > 0)) continue;
      const own = isOwn(b.shooter);
      if (own) { ownLance = true; if (0.09 > lanceG) { lanceG = 0.09; lanceP = 0; } }
      else { spatial(b.ox, b.oy, b.oz, 14); if (sp.att * 0.07 > lanceG) { lanceG = sp.att * 0.07; lanceP = sp.pan; } }
      if (b.len > 0.05) { spatial(b.ox + b.dx * b.len, b.oy + b.dy * b.len, b.oz + b.dz * b.len, 12); const g = sp.att * (b.hit === false ? 0.08 : 0.3); if (g > sizG) { sizG = g; sizP = sp.pan; } }
    }
    if (lanceWas && !ownLance) play('lance_stop', { own: true });
    lanceWas = ownLance;
    setTone(loops.lance, lanceG, lanceP, 118 + 6 * Math.sin(now * 31), now);
    setLoop(loops.sizzle, sizG, sizP, 0, now);
    const sh = pe && pe.shield, eq = P.equip && P.equip.shield;
    setTone(loops.shield, !paused && sh && sh.on ? 0.05 + 0.03 * (eq ? sat(eq.energy == null ? 1 : eq.energy > 1 ? eq.energy / 700 : eq.energy) : 1) : 0, 0, 98, now);
    if (grappleOn && (now - grappleT > 4 || P.mode !== 'mech')) grappleOn = false;
    setTone(loops.reel, grappleOn && !paused ? 0.045 : 0, 0, 180 + Math.min(1, (now - grappleT) / 0.8) * 420, now);
    // mortar bombs falling near the listener
    let wg = 0, wpan = 0, wf = 1500;
    if (pr && pr.length && !paused) for (let i = 0; i < pr.length; i++) {
      const q = pr[i]; if (!q.pos || !q.vel || q.vel.y > -4 || !(q.id === 'mortar' || q.id === 'mortar_b')) continue;
      const dx = q.pos.x - Lp.x, dy = q.pos.y - Lp.y, dz = q.pos.z - Lp.z, d2 = dx * dx + dy * dy + dz * dz; if (d2 > 8100) continue;
      const g = 0.07 * 25 / (25 + Math.sqrt(d2)) * sat(-q.vel.y / 20);
      if (g > wg) { wg = g; wpan = clamp((dx * Lp.rx + dy * Lp.ry + dz * Lp.rz) / (Math.sqrt(d2) + 2), -1, 1); wf = clamp(2600 - 28 * -q.vel.y - 12 * Math.max(0, 40 - dy), 700, 2600); }
    }
    setTone(loops.whistle, wg, wpan, wf, now);
    // ---- pilot slide scrape
    let sg = 0;
    if (slideEnt && !paused) { if (slideEnt.alive === false) slideEnt = null; else { const v = slideEnt.vel ? Math.min(1, Math.hypot(slideEnt.vel.x, slideEnt.vel.z) / 8) : 0.7; sg = isOwn(slideEnt) ? 0.1 + 0.16 * v : 0.05; } }
    setLoop(loops.slide, sg, 0, 0, now);
    // keep the score under the fight: the hotter it gets, the more the music gives way
    if (Math.abs(heat - lastMusHeat) > 0.04) { lastMusHeat = heat; const mu = clamp(volMusic, 0, 1); graph.music.gain.setTargetAtTime(mu * mu * MUSIC_GAIN * (1 - 0.3 * heat), now, 0.3); }
    // ---- rig reactor hum
    const inRig = P.mode === 'mech' && !paused && S.phase !== 'title';
    let hg = 0, hf = 48;
    if (inRig) { const v = pe && pe.vel ? Math.min(1, Math.hypot(pe.vel.x, pe.vel.z) / 12) : 0; hg = 0.05 + 0.05 * v; hf = 48 + 12 * v; }
    const H = loops.hum;
    if (Math.abs(hg - H.lg) > 0.004) { H.g.gain.setTargetAtTime(hg, now, 0.2); H.lg = hg; }
    if (Math.abs(hf - H.lf) > 1) { H.o1.frequency.setTargetAtTime(hf, now, 0.2); H.o2.frequency.setTargetAtTime(hf * 1.508, now, 0.2); H.lf = hf; }
    // ---- Skylance lock: beeps that close up, then a solid tone
    const lk = playing && lockState === 'locked' ? 0.07 : 0;
    if (Math.abs(lk - loops.lock.lg) > 0.001) { loops.lock.g.gain.setTargetAtTime(lk, now, 0.01); loops.lock.lg = lk; }
    if (playing && lockState === 'locking') {
      if (now >= lockT) { const pr2 = sat(P.lock ? P.lock.progress : 0); play('lock_beep', { pitch: 1 + 0.25 * pr2 }); lockT = now + 0.3 - 0.21 * pr2; }
    }
    if (!playing && lockState && S.phase !== 'paused') lockState = '';
    // ---- incoming-lock warning
    if (warnOn && playing && now >= warnT) { play('lock_warning'); warnT = now + 0.34; }
    // ---- low health: heartbeat on foot, armour alarm in the rig
    if (playing && pe && pe.alive !== false && pe.maxHp > 0 && P.mode !== 'dead') {
      const hp = pe.hp / pe.maxHp;
      if (hp < 0.35) {
        if (now >= beatT) {                                  // timed on the audio clock, so slow frames do not slow the pulse
          if (P.mode === 'mech') { play('alarm_low'); beatT = now + 0.9 + 1.2 * (hp / 0.35); }
          else { play('heartbeat', { vol: 1.1 - 1.2 * hp }); beatT = now + 0.55 + 0.5 * (hp / 0.35); }
        }
      } else beatT = 0;
    }
    // ---- music
    if (A.forceMusic) { if (music.state !== A.forceMusic) music.setState(A.forceMusic, { eta: 5 }); stats.music = music.state; }
    else pickMusic(false);
    const alive = S.wave.alive > 0 ? 0.3 + Math.min(0.25, S.wave.alive * 0.02) : 0;
    music.setIntensity(playing ? sat(alive + heat * 0.7 + (now - lastHurtT < 4 ? 0.15 : 0)) : A.forceMusic ? heat : 0);
    if (paused !== pausedMuffle) { pausedMuffle = paused; music.setMuffle(paused ? 1 : 0); graph.duck.gain.setTargetAtTime(paused ? 0.6 : 1, now, 0.1); }
    music.update(now, 0.3);
  },
  // ---- test / tooling helpers ----------------------------------------------------
  defs: DEF, loops,
  families: FAM,
  get intensity() { return music ? music.intensity : 0; },
  set heat(v) { heat = v; },
  // Render one sound through the full master chain with an OfflineAudioContext -> Promise<AudioBuffer>
  renderOffline(name, opts, seconds, sampleRate = 44100) {
    const oc = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), g = buildGraph(oc);
    g.master.gain.value = 1;
    const def = DEF[name], v = gain(oc, def ? def[1] * ((opts && opts.vol) || 1) : 1); v.connect(g.sfx);
    if (def && def[3] > 0 && !(opts && opts.dry)) { const s = gain(oc, def[3]); v.connect(s); s.connect(g.revIn); }
    SOUNDS[name](oc, v, 0.05, opts || {});
    return oc.startRendering();
  },
  renderMusicOffline(state, seconds, intensity = 0.7, sampleRate = 44100) {
    const oc = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate), g = buildGraph(oc);
    g.master.gain.value = 1; g.music.gain.value = 0.6 * 0.6 * MUSIC_GAIN;
    const m = createMusic(oc, g.duck, g.revIn);
    m.intensity = intensity; m.setState(state, { eta: seconds * 0.8 });
    for (const k in m.layers) m.layers[k].gain.value = 0;      // let the mix fade in as it does live
    m.applyMix(0.05);
    m.update(0, seconds);
    return oc.startRendering();
  },
};
export default A;
