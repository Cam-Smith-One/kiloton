// ============================================================================
// KILOTON — audio_synth.js   OWNER: AUDIO
// Every one-shot sound in the game as a pure synthesis recipe:
//     SOUNDS[name](ctx, dst, t, o) -> duration in seconds
// `ctx` is ANY BaseAudioContext (the live AudioContext or an OfflineAudioContext
// in the tests), `dst` the node to play into, `t` the start time on ctx's clock,
// `o` options ({ pitch, size, lag, kind, hit, alt, dur, pulse ... }).
// Recipes are level-normalised (peaks around 1); the engine applies per-sound
// gain, spatialisation and voice limiting. No samples, no worklets.
// ============================================================================
export const stats = { nodes: 0 };            // every node ever created through this kit
const N = n => { stats.nodes++; return n; };
const R = Math.random;
const rr = (a, b) => a + (b - a) * R();
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const min = Math.min, max = Math.max;

// ---- cached noise buffers (per context) -----------------------------------
const noiseCache = new WeakMap();
export function noiseBuffer(ctx, color = 'white') {
  let m = noiseCache.get(ctx); if (!m) noiseCache.set(ctx, m = {});
  if (m[color]) return m[color];
  const len = Math.floor(ctx.sampleRate * 2.0), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  if (color === 'white') { for (let i = 0; i < len; i++) d[i] = R() * 2 - 1; }
  else if (color === 'pink') {                // Paul Kellet's filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
  } else if (color === 'crackle') {            // fire: sparse pops with short decays over a faint hiss
    let e = 0, lp = 0;
    for (let i = 0; i < len; i++) {
      if (R() < 0.0009) e = 0.3 + 0.7 * R();
      e *= 0.9965; const w = R() * 2 - 1; lp += 0.5 * (w - lp);
      d[i] = lp * e + w * 0.012;
    }
  } else {                                     // brown: leaky integrator
    let v = 0;
    for (let i = 0; i < len; i++) { v = (v + 0.02 * (R() * 2 - 1)) / 1.02; d[i] = v * 3.5; }
  }
  // normalise to peak 1 and cross-fade the loop point
  let pk = 0; for (let i = 0; i < len; i++) pk = max(pk, Math.abs(d[i]));
  const k = 1 / (pk || 1); for (let i = 0; i < len; i++) d[i] *= k;
  const xf = 512; for (let i = 0; i < xf; i++) { const a = i / xf; d[len - xf + i] = d[len - xf + i] * (1 - a) + d[i] * a; }
  return m[color] = buf;
}

const curves = new Map();
function driveCurve(k) {
  let c = curves.get(k);
  if (!c) { c = new Float32Array(1024); const n = Math.tanh(k); for (let i = 0; i < 1024; i++) c[i] = Math.tanh(k * (i / 511.5 - 1)) / n; curves.set(k, c); }
  return c;
}

// ---- node kit ---------------------------------------------------------------
export function gain(c, v) { const g = N(c.createGain()); g.gain.value = v; return g; }
export function filt(c, type, f, q) { const b = N(c.createBiquadFilter()); b.type = type; b.frequency.value = f; if (q != null) b.Q.value = q; return b; }
export function drive(c, k) { const w = N(c.createWaveShaper()); w.curve = driveCurve(k); return w; }
const fin = (src, last) => { src.onended = () => { try { last.disconnect(); } catch (e) {} }; };

// attack / hold / exponential decay; the source is stopped just after t+dur
export function env(p, t, a, peak, dur, hold) {
  peak = max(1e-4, peak);
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + a);
  let td = t + a;
  if (hold) { td += hold; p.setValueAtTime(peak, td); }
  p.exponentialRampToValueAtTime(peak * 0.002, max(td + 0.004, t + dur));
}

// oscillator with pitch glide and amplitude envelope.  o: { type, f, f1, glide, dur, a, vol, hold, det }
export function tone(c, dst, t, o) {
  const osc = N(c.createOscillator()); osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(max(1, o.f), t);
  if (o.f1 != null) osc.frequency.exponentialRampToValueAtTime(max(1, o.f1), t + (o.glide || o.dur));
  if (o.det) osc.detune.value = o.det;
  const g = gain(c, 0); env(g.gain, t, o.a == null ? 0.003 : o.a, o.vol == null ? 1 : o.vol, o.dur, o.hold || 0);
  osc.connect(g); g.connect(dst); osc.start(t); osc.stop(t + o.dur + 0.02); fin(osc, g);
  return osc;
}

// filtered noise burst.  o: { color, ft, f, f1, sweep, q, dur, a, vol, hold, rate }
export function nz(c, dst, t, o) {
  const s = N(c.createBufferSource()); s.buffer = noiseBuffer(c, o.color || 'white'); s.loop = true;
  if (o.rate) s.playbackRate.value = o.rate;
  const f = filt(c, o.ft || 'lowpass', max(10, o.f), o.q == null ? 0.7 : o.q);
  f.frequency.setValueAtTime(max(10, o.f), t);
  if (o.f1 != null) f.frequency.exponentialRampToValueAtTime(max(10, o.f1), t + o.dur * (o.sweep || 1));
  const g = gain(c, 0); env(g.gain, t, o.a == null ? 0.002 : o.a, o.vol == null ? 1 : o.vol, o.dur, o.hold || 0);
  s.connect(f); f.connect(g); g.connect(dst); s.start(t, R() * 1.8); s.stop(t + o.dur + 0.02); fin(s, g);
  return f;
}

// unfiltered noise grain (source + gain) for clouds that share one filter
function grain(c, dst, t, color, dur, vol, rate) {
  const s = N(c.createBufferSource()); s.buffer = noiseBuffer(c, color); s.loop = true; s.playbackRate.value = rate || 1;
  const g = gain(c, 0); env(g.gain, t, 0.002, vol, dur, 0);
  s.connect(g); g.connect(dst); s.start(t, R() * 1.8); s.stop(t + dur + 0.02); fin(s, g);
}

// two-operator FM zap.  o: { f, f1, ratio, index, dur, vol, a, type }
function fm(c, dst, t, o) {
  const car = N(c.createOscillator()), mod = N(c.createOscillator()), mg = gain(c, 0), g = gain(c, 0);
  car.type = o.type || 'sine'; car.frequency.setValueAtTime(o.f, t);
  if (o.f1) car.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  mod.frequency.setValueAtTime(o.f * o.ratio, t); if (o.f1) mod.frequency.exponentialRampToValueAtTime(o.f1 * o.ratio, t + o.dur);
  mg.gain.setValueAtTime(o.f * o.index, t); mg.gain.exponentialRampToValueAtTime(max(1, o.f * o.index * 0.02), t + o.dur);
  env(g.gain, t, o.a || 0.002, o.vol == null ? 1 : o.vol, o.dur, 0);
  mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(dst);
  car.start(t); mod.start(t); car.stop(t + o.dur + 0.02); mod.stop(t + o.dur + 0.02); fin(car, g);
}

// struck metal: three inharmonic partials
function clang(c, dst, t, f, dur, vol, type) {
  tone(c, dst, t, { type: type || 'sine', f, dur, vol: vol * 0.6 });
  tone(c, dst, t, { type: 'sine', f: f * 2.76, dur: dur * 0.7, vol: vol * 0.4 });
  tone(c, dst, t, { type: 'sine', f: f * 5.4, dur: dur * 0.45, vol: vol * 0.25 });
}
const thud = (c, dst, t, f0, f1, dur, vol) => tone(c, dst, t, { f: f0, f1, glide: dur * 0.6, dur, vol, a: 0.004 });
const beep = (c, dst, t, f, dur, vol, type) => tone(c, dst, t, { type: type || 'sine', f, dur, vol, a: 0.004, hold: dur * 0.7 });

// The heavy core shared by everything that should hit the chest: a sub thump with a pitch drop, a low-mid
// body and a click, summed INTO a saturator so the layers fuse and gain density instead of just level.
// o: { sub, subEnd, subDur, body, bodyDur, k (drive), click (Hz, 0 = none), vol }
function weight(c, d, t, o) {
  const g = gain(c, o.vol == null ? 1 : o.vol), dr = drive(c, o.k || 4); g.connect(dr); dr.connect(d);
  const e = o.subEnd || o.sub * 0.5;
  tone(c, g, t, { f: o.sub, f1: e, glide: o.subDur * 0.45, dur: o.subDur, vol: 0.9, a: 0.003 });
  tone(c, g, t, { type: 'triangle', f: o.sub * 2, f1: e * 2, glide: o.subDur * 0.3, dur: o.subDur * 0.6, vol: 0.45, a: 0.003 });
  tone(c, g, t, { type: 'triangle', f: o.body, f1: o.body * 0.55, dur: o.bodyDur, vol: 0.7, a: 0.002 });
  nz(c, g, t, { color: 'pink', ft: 'bandpass', f: o.body * 1.1, f1: o.body * 0.7, q: 0.7, dur: o.bodyDur * 1.3, vol: 0.9, a: 0.002 });
  if (o.click) { nz(c, d, t, { ft: 'highpass', f: o.click, dur: 0.014, vol: 0.9, a: 0.0005 }); tone(c, d, t, { type: 'square', f: o.click * 0.5, f1: o.click * 0.12, dur: 0.012, vol: 0.35, a: 0.0005 }); }
}

function rocket(c, d, t, p, len, vol) {
  nz(c, d, t, { ft: 'bandpass', f: 320 * p, f1: 1900 * p, q: 1.1, dur: len, vol: vol, a: 0.015, hold: len * 0.15 });
  nz(c, d, t, { ft: 'highpass', f: 3200, dur: len * 0.8, vol: vol * 0.35, a: 0.01 });
  thud(c, d, t, 120 * p, 46, 0.22, vol * 0.9);
}

// ============================================================================
export const SOUNDS = {
  // ------------------------------------------------------------ player weapons
  rifle(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.96, 1.04);
    const dr = drive(c, 4); dr.connect(d);
    nz(c, d, t, { ft: 'highpass', f: 2400, dur: 0.1, vol: 1.0, a: 0.0005 });                                       // the crack
    nz(c, dr, t, { ft: 'bandpass', f: 1500 * p, f1: 380 * p, q: 0.8, dur: 0.19, vol: 1.0, a: 0.001 });
    weight(c, d, t, { sub: 135 * p, subEnd: 52, subDur: 0.15, body: 250 * p, bodyDur: 0.1, click: 4200, k: 4, vol: 0.9 });
    nz(c, d, t + 0.02, { color: 'pink', ft: 'lowpass', f: 3200, f1: 500, dur: 0.5, vol: 0.24, a: 0.01 });           // report rolling off the street
    return 0.55;
  },
  rocket_launch(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.95, 1.05);
    nz(c, d, t, { ft: 'lowpass', f: 900, f1: 200, dur: 0.12, vol: 0.9 });       // tube pop
    weight(c, d, t, { sub: 88 * p, subEnd: 38, subDur: 0.32, body: 220 * p, bodyDur: 0.16, click: 3000, k: 4 });
    rocket(c, d, t + 0.01, p, 0.8, 0.85);
    nz(c, d, t + 0.05, { color: 'pink', ft: 'lowpass', f: 1400, f1: 300, dur: 0.9, vol: 0.25, a: 0.05 });
    return 1.0;
  },
  grenade(c, d, t, o) {
    const p = o.pitch || 1;
    thud(c, d, t, 230 * p, 80 * p, 0.13, 1); nz(c, d, t, { ft: 'lowpass', f: 700, dur: 0.1, vol: 0.6 });
    nz(c, d, t, { ft: 'bandpass', f: 2400, q: 3, dur: 0.05, vol: 0.25 });
    return 0.2;
  },
  // twin pulse cannons: punchy, electric; o.alt (0|1) alternates the pitch per barrel
  pulse(c, d, t, o) {
    const p = (o.pitch || 1) * (o.alt ? 0.84 : 1) * rr(0.985, 1.015);
    const lp = filt(c, 'lowpass', 5200, 0.8); lp.connect(d);
    tone(c, lp, t, { type: 'sawtooth', f: 920 * p, f1: 105 * p, glide: 0.13, dur: 0.19, vol: 0.85 });
    fm(c, d, t, { f: 240 * p, f1: 70 * p, ratio: 2.51, index: 9, dur: 0.22, vol: 0.85 });
    nz(c, d, t, { ft: 'highpass', f: 4500, dur: 0.03, vol: 0.55 });
    weight(c, d, t, { sub: 98 * p, subEnd: 40, subDur: 0.24, body: 240 * p, bodyDur: 0.13, click: 5200, k: 5 });
    nz(c, d, t + 0.03, { ft: 'bandpass', f: 2600 * p, f1: 700, q: 2.5, dur: 0.3, vol: 0.2, a: 0.01 });     // ionised tail
    nz(c, d, t + 0.02, { color: 'pink', ft: 'lowpass', f: 1200, f1: 250, dur: 0.4, vol: 0.2, a: 0.01 });
    return 0.45;
  },
  overheat(c, d, t, o) {
    nz(c, d, t, { ft: 'highpass', f: 2600, dur: 1.7, vol: 0.55, a: 0.04, hold: 0.25 });
    nz(c, d, t, { ft: 'bandpass', f: 6500, f1: 1400, q: 1.6, dur: 1.5, vol: 0.4, a: 0.03 });
    tone(c, d, t, { type: 'sawtooth', f: 820, f1: 160, dur: 0.7, vol: 0.12, a: 0.01 });
    beep(c, d, t + 0.02, 520, 0.09, 0.3, 'square'); beep(c, d, t + 0.16, 390, 0.14, 0.3, 'square');
    return 1.8;
  },
  salvo_rocket(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.88, 1.14);
    nz(c, d, t, { ft: 'highpass', f: 2500, dur: 0.04, vol: 0.6 });
    weight(c, d, t, { sub: 92 * p, subEnd: 42, subDur: 0.22, body: 210 * p, bodyDur: 0.12, click: 0, k: 4, vol: 0.9 });
    rocket(c, d, t, p * 1.15, 0.5, 0.8);
    return 0.55;
  },
  salvo(c, d, t, o) { for (let i = 0; i < 6; i++) SOUNDS.salvo_rocket(c, d, t + i * 0.085 + rr(0, 0.012), o); return 1.0; },
  lock_beep(c, d, t, o) { beep(c, d, t, 1250 * (o.pitch || 1), 0.055, 0.5); beep(c, d, t, 2500 * (o.pitch || 1), 0.03, 0.12); return 0.08; },
  lock_on(c, d, t, o) { beep(c, d, t, 1250, 0.05, 0.5); beep(c, d, t + 0.06, 1670, 0.05, 0.5); beep(c, d, t + 0.12, 2500, 0.12, 0.45); return 0.28; },
  lock_tone(c, d, t, o) { const L = o.dur || 0.7; beep(c, d, t, 1670, L, 0.32); beep(c, d, t, 2505, L, 0.1, 'triangle'); return L + 0.05; },
  lock_lost(c, d, t, o) { tone(c, d, t, { type: 'triangle', f: 900, f1: 420, dur: 0.16, vol: 0.4 }); return 0.2; },
  skylance_launch(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.95, 1.06);
    nz(c, d, t, { ft: 'highpass', f: 3000, dur: 0.05, vol: 0.7 });
    nz(c, d, t, { ft: 'bandpass', f: 800 * p, f1: 4600 * p, q: 2, dur: 0.5, vol: 0.75, a: 0.01, hold: 0.1 });
    tone(c, d, t, { f: 520 * p, f1: 2600 * p, dur: 0.3, vol: 0.28, a: 0.01 });
    thud(c, d, t, 170, 60, 0.14, 0.6);
    return 0.55;
  },
  rocket_flyby(c, d, t, o) {
    const p = o.pitch || 1;
    nz(c, d, t, { ft: 'bandpass', f: 1500 * p, f1: 500 * p, q: 2.2, dur: 0.6, vol: 0.8, a: 0.25 });
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 600, dur: 0.6, vol: 0.4, a: 0.25 });
    return 0.65;
  },
  // -------------------------------------------------------------- Vanta weapons
  e_rifle(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.94, 1.06);
    tone(c, d, t, { type: 'square', f: 330 * p, f1: 105 * p, dur: 0.075, vol: 0.5 });
    nz(c, d, t, { ft: 'bandpass', f: 1500 * p, q: 2.2, dur: 0.09, vol: 0.9 });
    nz(c, d, t + 0.01, { color: 'pink', ft: 'lowpass', f: 1500, f1: 400, dur: 0.22, vol: 0.14 });
    return 0.25;
  },
  e_rocket(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.93, 1.07);
    nz(c, d, t, { ft: 'bandpass', f: 1300 * p, f1: 260 * p, q: 1.6, dur: 0.6, vol: 0.85, a: 0.01 });      // falls, where ours rise
    nz(c, d, t, { ft: 'highpass', f: 2600, dur: 0.4, vol: 0.3, a: 0.005 });
    tone(c, d, t, { type: 'sawtooth', f: 190 * p, f1: 70 * p, dur: 0.3, vol: 0.3 });
    thud(c, d, t, 100, 40, 0.2, 0.8);
    return 0.65;
  },
  e_shell(c, d, t, o) {                         // tank main gun
    const p = o.pitch || 1;
    nz(c, d, t, { ft: 'highpass', f: 1500, dur: 0.06, vol: 0.9 });
    const dr = drive(c, 3); dr.connect(d);
    nz(c, dr, t, { color: 'brown', ft: 'lowpass', f: 1300 * p, f1: 140, dur: 0.7, vol: 1 });
    thud(c, d, t, 92 * p, 30, 0.55, 1);
    nz(c, d, t + 0.05, { color: 'pink', ft: 'lowpass', f: 800, f1: 200, dur: 1.3, vol: 0.3, a: 0.08 });
    clang(c, d, t + 0.02, 310, 0.25, 0.25);
    return 1.4;
  },
  e_drone(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.95, 1.08);
    tone(c, d, t, { f: 2500 * p, f1: 620 * p, dur: 0.075, vol: 0.6 });
    tone(c, d, t, { type: 'square', f: 1250 * p, f1: 310 * p, dur: 0.06, vol: 0.2 });
    nz(c, d, t, { ft: 'highpass', f: 5000, dur: 0.025, vol: 0.4 });
    return 0.1;
  },
  e_chain(c, d, t, o) {                         // gunship chain gun
    const p = (o.pitch || 1) * rr(0.96, 1.04);
    tone(c, d, t, { type: 'square', f: 155 * p, f1: 68 * p, dur: 0.07, vol: 0.6 });
    nz(c, d, t, { ft: 'lowpass', f: 1900, f1: 500, dur: 0.09, vol: 0.9 });
    nz(c, d, t, { ft: 'bandpass', f: 3100, q: 4, dur: 0.035, vol: 0.3 });
    return 0.13;
  },
  e_pulse(c, d, t, o) {                         // enemy rig pulse: lower, square, dirty
    const p = (o.pitch || 1) * rr(0.97, 1.03);
    const dr = drive(c, 5), lp = filt(c, 'lowpass', 2600, 2); dr.connect(lp); lp.connect(d);
    tone(c, dr, t, { type: 'square', f: 540 * p, f1: 62 * p, glide: 0.2, dur: 0.24, vol: 0.5 });
    tone(c, dr, t, { type: 'sawtooth', f: 547 * p * 1.5, f1: 90 * p, glide: 0.2, dur: 0.2, vol: 0.3 });
    nz(c, d, t, { ft: 'bandpass', f: 750, q: 3, dur: 0.14, vol: 0.5 });
    thud(c, d, t, 110 * p, 40, 0.2, 0.9);
    return 0.3;
  },
  // ------------------------------------------------------------------- impacts
  impact_concrete(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.85, 1.2);
    nz(c, d, t, { ft: 'bandpass', f: 1900 * p, q: 0.9, dur: 0.06, vol: 0.9 });
    nz(c, d, t, { ft: 'lowpass', f: 520, dur: 0.09, vol: 0.7 });
    nz(c, d, t + 0.02, { ft: 'highpass', f: 3500, dur: 0.14, vol: 0.12, a: 0.01 });
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.2;
  },
  impact_metal(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.8, 1.3);
    nz(c, d, t, { ft: 'highpass', f: 3800, dur: 0.025, vol: 0.7 });
    clang(c, d, t, 1900 * p, 0.2, 0.7);
    if (R() < 0.3) tone(c, d, t, { f: 2900 * p, f1: 900 * p, dur: 0.28, vol: 0.22, a: 0.01 });        // ricochet
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.32;
  },
  impact_glass(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.85, 1.25);
    nz(c, d, t, { ft: 'highpass', f: 5200, dur: 0.045, vol: 0.8 });
    tone(c, d, t, { f: 4300 * p, dur: 0.07, vol: 0.35 }); tone(c, d, t, { f: 6150 * p, dur: 0.05, vol: 0.25 });
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.12;
  },
  impact_wood(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.85, 1.2);
    tone(c, d, t, { type: 'triangle', f: 340 * p, f1: 170 * p, dur: 0.055, vol: 0.8 });
    nz(c, d, t, { ft: 'bandpass', f: 950 * p, q: 1.5, dur: 0.045, vol: 0.7 });
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.1;
  },
  impact_dirt(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.85, 1.2);
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 750 * p, f1: 200, dur: 0.11, vol: 1 });
    nz(c, d, t + 0.02, { ft: 'bandpass', f: 2200, q: 0.6, dur: 0.1, vol: 0.1, a: 0.02 });
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.16;
  },
  impact_soft(c, d, t, o) {
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 420, dur: 0.07, vol: 1 });
    thud(c, d, t, 160, 80, 0.05, 0.5);
    if (o.pulse) pulseHit(c, d, t, 1);
    return 0.1;
  },
  impact_armor(c, d, t, o) {                    // a hit on a vehicle or rig
    const p = (o.pitch || 1) * rr(0.85, 1.2);
    nz(c, d, t, { ft: 'bandpass', f: 2600, q: 1.2, dur: 0.035, vol: 0.7 });
    clang(c, d, t, 760 * p, 0.26, 0.75, 'triangle');
    thud(c, d, t, 170, 70, 0.07, 0.5);
    if (o.pulse) pulseHit(c, d, t, p);
    return 0.3;
  },
  whiz(c, d, t, o) {
    const p = rr(0.8, 1.3);
    nz(c, d, t, { ft: 'bandpass', f: 4200 * p, f1: 1300 * p, q: 7, dur: 0.13, vol: 1, a: 0.03 });
    return 0.15;
  },
  // ---------------------------------------------------------------- explosions
  // o.size ~ radius/10 (0.1 pop .. 1.6 colossal); o.lag separates crack and boom with distance
  explosion(c, d, t, o) {
    const s = clamp(o.size == null ? 0.4 : o.size, 0.08, 1.6), s1 = min(1, s), kind = o.kind || 'rocket';
    const p = (o.pitch || 1) * rr(0.92, 1.08), tb = t + (o.lag || 0), tail = 0.9 + 2.6 * s;
    nz(c, d, t, { ft: 'highpass', f: 2300 - 900 * s1, dur: 0.05 + 0.05 * s, vol: 0.85 });                       // crack
    nz(c, d, t, { ft: 'bandpass', f: 1300 * p, f1: 300, q: 0.6, dur: 0.22 + 0.2 * s, vol: 1.0 });
    tone(c, d, tb, { f: (108 - 48 * s1) * p, f1: 27, glide: 0.22 + 0.35 * s, dur: 0.45 + 0.9 * s, vol: 1.0, a: 0.004 });   // sub thump
    if (s > 0.45) tone(c, d, tb, { f: 54 * p, f1: 21, dur: 0.8 + 1.1 * s, vol: 0.75, a: 0.012 });
    weight(c, d, tb, { sub: (82 - 30 * s1) * p, subEnd: 26, subDur: 0.55 + 1.0 * s, body: (270 - 110 * s1) * p, bodyDur: 0.28 + 0.4 * s, click: lagless(o) ? 2600 : 0, k: 5 });
    const dr = drive(c, 3); dr.connect(d);
    nz(c, dr, tb, { color: 'brown', ft: 'lowpass', f: 1700 * p, f1: 90, dur: 0.6 + 1.2 * s, vol: 1.0, a: 0.004 });         // body
    nz(c, dr, tb, { color: 'pink', ft: 'bandpass', f: 700 * p, f1: 260, q: 0.5, dur: 0.45 + 0.6 * s, vol: 0.8, a: 0.004 });      // mid punch (small speakers)
    nz(c, d, tb + 0.08, { color: 'pink', ft: 'lowpass', f: 900, f1: 170, dur: tail, vol: 0.6, a: 0.12 });                // roll-off
    nz(c, d, tb + 0.15, { ft: 'bandpass', f: 3200, f1: 1100, q: 0.8, dur: tail * 0.7, vol: 0.07 + 0.05 * s1, a: 0.2 });  // debris hiss
    const bus = filt(c, 'bandpass', 1800, 0.8); bus.connect(d);
    const n = 3 + Math.floor(5 * s1);
    for (let i = 0; i < n; i++) grain(c, bus, tb + 0.25 + rr(0, tail * 0.6), 'white', rr(0.03, 0.09), rr(0.08, 0.22), rr(0.5, 1.6));   // debris ticks
    if (kind === 'pulse') { tone(c, d, t, { type: 'sawtooth', f: 1500, f1: 180, dur: 0.14, vol: 0.25 }); nz(c, d, t, { ft: 'bandpass', f: 3000, f1: 800, q: 3, dur: 0.25, vol: 0.2 }); }
    else if (kind === 'shell') nz(c, d, t, { ft: 'bandpass', f: 500, q: 1.5, dur: 0.3, vol: 0.5 });
    else if (kind === 'mech' || kind === 'slam') clang(c, d, tb, 150, 0.9, 0.35, 'triangle');
    return (o.lag || 0) + tail + 0.3;
  },
  // ----------------------------------------------------------- destruction
  // o.size 0..1 from the mass that let go
  collapse(c, d, t, o) {
    const s = clamp(o.size == null ? 0.5 : o.size, 0.1, 1), L = 3.6 + 4.6 * s;
    const dr = drive(c, 3); dr.connect(d);
    nz(c, dr, t, { color: 'brown', ft: 'lowpass', f: 170, f1: 45, dur: L, vol: 0.8, a: 0.4, hold: L * 0.35 });      // deep rumble
    nz(c, dr, t, { color: 'pink', ft: 'lowpass', f: 1100, f1: 200, dur: L * 0.85, vol: 0.6, a: 0.5, hold: L * 0.25 });
    tone(c, d, t, { f: 38, f1: 26, dur: L * 0.9, vol: 0.6, a: L * 0.3, hold: L * 0.2 });
    const nc = 3 + Math.floor(4 * s);                                                                              // structure cracking
    for (let i = 0; i < nc; i++) {
      const tc = t + rr(0, L * 0.35), p = rr(0.7, 1.4);
      nz(c, d, tc, { ft: 'bandpass', f: 2100 * p, q: 2.2, dur: rr(0.05, 0.12), vol: rr(0.7, 1.2) });
      tone(c, d, tc, { type: 'triangle', f: 230 * p, f1: 80, dur: 0.09, vol: 0.4 });
    }
    const nh = 3 + Math.floor(4 * s);                                                                              // storeys landing, one after another
    for (let i = 0; i < nh; i++) {
      const u = (i + rr(0.1, 0.9)) / nh, th = t + L * (0.2 + 0.6 * u), v = (0.5 + 0.5 * s) * (1 - 0.35 * u);
      weight(c, d, th, { sub: rr(48, 66), subEnd: 24, subDur: rr(0.6, 1.0), body: rr(130, 210), bodyDur: 0.25, click: 1500, k: 5, vol: v });
    }
    const bus = filt(c, 'bandpass', 1100, 0.3); bus.connect(d);                                                    // cascading rubble
    const ng = 10 + Math.floor(8 * s);
    for (let i = 0; i < ng; i++) {
      const u = i / ng, tg = t + L * (0.15 + 0.75 * Math.pow(u, 0.7)) + rr(-0.05, 0.05);
      grain(c, bus, tg, i & 1 ? 'white' : 'pink', rr(0.05, 0.22), rr(0.6, 1.3) * (1 - 0.5 * u), rr(0.35, 1.5));
    }
    return L + 0.3;
  },
  crumble(c, d, t, o) {                         // masonry coming apart (voxels:destroyed)
    const s = clamp(o.size == null ? 0.3 : o.size, 0.05, 1), L = 0.35 + 0.9 * s, p = o.pitch || 1;
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 900 * p, f1: 220, dur: L, vol: 0.8, a: 0.01 });
    const bus = filt(c, 'bandpass', 1500 * p, 0.6); bus.connect(d);
    const n = 3 + Math.floor(5 * s);
    for (let i = 0; i < n; i++) grain(c, bus, t + rr(0, L * 0.8), 'white', rr(0.03, 0.1), rr(0.25, 0.6), rr(0.4, 1.4));
    return L + 0.1;
  },
  glass_shatter(c, d, t, o) {
    const s = clamp(o.size == null ? 0.5 : o.size, 0.1, 1), L = 0.4 + 0.6 * s;
    nz(c, d, t, { ft: 'highpass', f: 3200, dur: 0.13, vol: 0.9 });
    nz(c, d, t, { ft: 'bandpass', f: 5500, q: 1.2, dur: L, vol: 0.3, a: 0.01 });
    const g = gain(c, 1); g.connect(d);
    const n = 6 + Math.floor(7 * s);
    for (let i = 0; i < n; i++) tone(c, g, t + rr(0.01, L), { f: rr(2600, 7400), dur: rr(0.03, 0.1), vol: rr(0.08, 0.2) });
    return L + 0.15;
  },
  debris_concrete(c, d, t, o) {
    const s = clamp(o.size == null ? 0.3 : o.size, 0, 1), p = (o.pitch || 1) * rr(0.8, 1.25) * (1.3 - 0.6 * s);
    let tt = t; const n = 1 + (R() * 2.5 | 0);
    for (let i = 0; i < n; i++) {
      nz(c, d, tt, { ft: 'bandpass', f: 1000 * p * rr(0.8, 1.3), q: 1.4, dur: 0.05, vol: 0.9 / (1 + i) });
      nz(c, d, tt, { ft: 'lowpass', f: 380, dur: 0.07 + 0.08 * s, vol: (0.5 + 0.5 * s) / (1 + i) });
      tt += rr(0.04, 0.11);
    }
    return 0.4;
  },
  debris_metal(c, d, t, o) {
    const s = clamp(o.size == null ? 0.3 : o.size, 0, 1), p = (o.pitch || 1) * rr(0.75, 1.3) * (1.3 - 0.6 * s);
    nz(c, d, t, { ft: 'highpass', f: 2500, dur: 0.03, vol: 0.6 });
    clang(c, d, t, 540 * p, 0.35 + 0.3 * s, 0.8, 'triangle');
    if (R() < 0.5) clang(c, d, t + rr(0.07, 0.15), 610 * p, 0.2, 0.35);
    return 0.75;
  },
  debris_glass(c, d, t, o) {
    const n = 2 + (R() * 3 | 0);
    nz(c, d, t, { ft: 'highpass', f: 5000, dur: 0.04, vol: 0.6 });
    for (let i = 0; i < n; i++) tone(c, d, t + rr(0, 0.18), { f: rr(3000, 7000), dur: rr(0.03, 0.08), vol: rr(0.2, 0.4) });
    return 0.3;
  },
  debris_wood(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.8, 1.25);
    tone(c, d, t, { type: 'triangle', f: 290 * p, f1: 150 * p, dur: 0.07, vol: 0.9 });
    nz(c, d, t, { ft: 'bandpass', f: 800 * p, q: 2, dur: 0.05, vol: 0.6 });
    if (R() < 0.5) tone(c, d, t + rr(0.05, 0.1), { type: 'triangle', f: 360 * p, f1: 200 * p, dur: 0.05, vol: 0.4 });
    return 0.2;
  },
  debris_dirt(c, d, t, o) { nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 500, f1: 150, dur: 0.14, vol: 1 }); return 0.18; },
  levelled(c, d, t, o) {                        // a whole building is gone: a long low toll
    thud(c, d, t, 49, 31, 2.4, 1);
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 240, f1: 60, dur: 2.6, vol: 0.6, a: 0.05 });
    tone(c, d, t, { type: 'sawtooth', f: 73.4, dur: 2.2, vol: 0.12, a: 0.2 }); tone(c, d, t, { type: 'sawtooth', f: 77.8, dur: 2.2, vol: 0.1, a: 0.2 });
    return 2.7;
  },
  // ------------------------------------------------------------------ the rig
  footstep_rig(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.93, 1.07), w = o.w || 1;        // o.w: chassis mass (harrier 0.7, warden 1, bastion 1.35)
    weight(c, d, t, { sub: 62 * p, subEnd: 27 / Math.sqrt(w), subDur: 0.5 * w, body: 150 * p, bodyDur: 0.2 * w, click: 1800, k: 4 + w });
    if (w > 1.2) tone(c, d, t, { f: 44, f1: 22, dur: 0.75, vol: 0.7, a: 0.006 });                                   // the Bastion shakes the street
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 620 * p, f1: 100, dur: 0.4 * w, vol: 0.9 });
    nz(c, d, t + 0.03, { color: 'pink', ft: 'bandpass', f: 900, f1: 400, q: 0.6, dur: 0.45, vol: 0.18, a: 0.04 });   // grit settling
    clang(c, d, t, 185 * p, 0.12, 0.3, 'triangle');
    nz(c, d, t, { ft: 'bandpass', f: 1500, q: 1, dur: 0.05, vol: 0.25 });
    const lp = filt(c, 'lowpass', 1900, 2); lp.connect(d);                                                         // servo whine as the other leg lifts
    tone(c, lp, t + 0.09, { type: 'sawtooth', f: 250 * p, f1: 470 * p, glide: 0.2, dur: 0.3, vol: 0.09, a: 0.05, hold: 0.12 });
    tone(c, lp, t + 0.09, { type: 'square', f: 503 * p, f1: 940 * p, glide: 0.2, dur: 0.28, vol: 0.03, a: 0.05, hold: 0.1 });
    return 0.45 + 0.35 * w;
  },
  footstep_pilot(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.85, 1.2);
    nz(c, d, t, { ft: 'bandpass', f: 950 * p, f1: 420, q: 1.1, dur: 0.05, vol: 0.8 });
    nz(c, d, t, { ft: 'lowpass', f: 260, dur: 0.05, vol: 0.9 });
    return 0.08;
  },
  punch_windup(c, d, t, o) {
    nz(c, d, t, { ft: 'bandpass', f: 420, f1: 1700, q: 2, dur: 0.3, vol: 0.6, a: 0.22 });
    tone(c, d, t, { type: 'sawtooth', f: 95, f1: 240, dur: 0.3, vol: 0.2, a: 0.2 });
    return 0.32;
  },
  punch(c, d, t, o) {
    const p = (o.pitch || 1) * rr(0.94, 1.06);
    nz(c, d, t, { ft: 'bandpass', f: 500, f1: 2400, q: 2.5, dur: 0.09, vol: 0.5, a: 0.06 });                        // hydraulic ram
    tone(c, d, t, { type: 'sawtooth', f: 110 * p, f1: 330 * p, dur: 0.09, vol: 0.16, a: 0.06 });
    const ti = t + 0.08;
    if (o.hit === false || o.hit === 0) { nz(c, d, ti, { ft: 'bandpass', f: 900, f1: 220, q: 1.2, dur: 0.28, vol: 0.7, a: 0.03 }); return 0.4; }
    const dr = drive(c, 4); dr.connect(d);
    weight(c, d, ti, { sub: 78 * p, subEnd: 28, subDur: 0.5, body: 230 * p, bodyDur: 0.22, click: 3000, k: 5 });
    nz(c, d, ti + 0.05, { color: 'pink', ft: 'lowpass', f: 1500, f1: 250, dur: 0.7, vol: 0.3, a: 0.05 });
    nz(c, dr, ti, { color: 'brown', ft: 'lowpass', f: 2200, f1: 180, dur: 0.32, vol: 0.9 });
    nz(c, d, ti, { ft: 'highpass', f: 2000, dur: 0.05, vol: 0.6 });
    clang(c, d, ti, 260 * p, 0.35, 0.4, 'triangle');
    nz(c, d, ti + 0.1, { ft: 'highpass', f: 3000, dur: 0.35, vol: 0.14, a: 0.03 });                                // pressure release
    return 0.9;
  },
  jet_ignite(c, d, t, o) {
    const p = o.pitch || 1;
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 320 * p, f1: 2600 * p, dur: 0.38, vol: 0.9, a: 0.02, hold: 0.08 });
    thud(c, d, t, 120 * p, 45, 0.25, 0.8);
    return 0.42;
  },
  jet_off(c, d, t, o) {
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 2200 * (o.pitch || 1), f1: 180, dur: 0.4, vol: 0.6, a: 0.01 });
    return 0.42;
  },
  jet(c, d, t, o) {                             // one-shot roar (the engine also runs a continuous loop while jets are on)
    const L = o.dur || 1.2, p = o.pitch || 1;
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 1400 * p, dur: L, vol: 0.8, a: 0.06, hold: L * 0.7 });
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 260 * p, dur: L, vol: 0.9, a: 0.06, hold: L * 0.7 });
    nz(c, d, t, { ft: 'bandpass', f: 3200 * p, q: 0.8, dur: L, vol: 0.2, a: 0.06, hold: L * 0.7 });
    return L + 0.05;
  },
  jetpack(c, d, t, o) {                         // pilot boost
    nz(c, d, t, { ft: 'bandpass', f: 1300, f1: 2600, q: 0.9, dur: 0.5, vol: 0.8, a: 0.015, hold: 0.12 });
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 500, dur: 0.4, vol: 0.5, a: 0.01 });
    return 0.55;
  },
  slam(c, d, t, o) {
    const s = clamp(o.size == null ? 0.7 : o.size, 0.2, 1.4);
    const dr = drive(c, 4); dr.connect(d);
    nz(c, d, t, { ft: 'highpass', f: 1800, dur: 0.07, vol: 0.8 });
    weight(c, d, t, { sub: 66, subEnd: 22, subDur: 1.2 + 0.5 * s, body: 175, bodyDur: 0.5, click: 2200, k: 6 }); thud(c, d, t, 46, 20, 1.2 + 0.6 * s, 0.7);
    nz(c, dr, t, { color: 'brown', ft: 'lowpass', f: 1900, f1: 100, dur: 0.9, vol: 1 });
    clang(c, d, t, 132, 1.1, 0.4, 'triangle');
    nz(c, d, t + 0.1, { color: 'pink', ft: 'bandpass', f: 1400, f1: 500, q: 0.6, dur: 1.6, vol: 0.2, a: 0.15 });
    const bus = filt(c, 'bandpass', 1500, 0.7); bus.connect(d);
    for (let i = 0; i < 6; i++) grain(c, bus, t + rr(0.2, 1.3), 'white', rr(0.03, 0.09), rr(0.1, 0.25), rr(0.5, 1.5));
    return 2.0 + 0.6 * s;
  },
  dash(c, d, t, o) {
    nz(c, d, t, { ft: 'bandpass', f: 500, f1: 3200, sweep: 0.4, q: 1.4, dur: 0.42, vol: 0.8, a: 0.03, hold: 0.06 });
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 700, dur: 0.35, vol: 0.7, a: 0.01 });
    thud(c, d, t, 130, 45, 0.22, 0.8);
    tone(c, d, t, { type: 'sawtooth', f: 180, f1: 520, dur: 0.25, vol: 0.08, a: 0.03 });
    return 0.48;
  },
  grab(c, d, t, o) {
    tone(c, d, t, { type: 'sawtooth', f: 210, f1: 420, dur: 0.22, vol: 0.14, a: 0.03, hold: 0.1 });
    clang(c, d, t + 0.2, 330, 0.3, 0.6, 'triangle'); thud(c, d, t + 0.2, 120, 50, 0.12, 0.7);
    nz(c, d, t + 0.2, { ft: 'bandpass', f: 1200, q: 1, dur: 0.1, vol: 0.5 });
    return 0.55;
  },
  throw(c, d, t, o) {
    nz(c, d, t, { ft: 'bandpass', f: 380, f1: 1900, sweep: 0.5, q: 1.6, dur: 0.38, vol: 0.9, a: 0.1 });
    tone(c, d, t, { type: 'sawtooth', f: 300, f1: 120, dur: 0.3, vol: 0.14, a: 0.02 });
    thud(c, d, t + 0.08, 100, 45, 0.15, 0.5);
    return 0.42;
  },
  // the Rig drop: o.dur = seconds until touchdown. A bomb whistle and a growing roar, sonic boom on the way down.
  rig_drop_incoming(c, d, t, o) {
    const L = clamp(o.dur || 3, 0.8, 12), p = o.pitch || 1;
    const w = N(c.createOscillator()), wg = gain(c, 0);                                                            // sky whistle
    w.type = 'sine'; w.frequency.setValueAtTime(2900 * p, t); w.frequency.exponentialRampToValueAtTime(560 * p, t + L);
    wg.gain.setValueAtTime(0.0005, t); wg.gain.exponentialRampToValueAtTime(0.3, t + L * 0.9); wg.gain.linearRampToValueAtTime(0, t + L);
    w.connect(wg); wg.connect(d); w.start(t); w.stop(t + L + 0.02); fin(w, wg);
    nz(c, d, t, { ft: 'bandpass', f: 3400 * p, f1: 700 * p, q: 6, dur: L, vol: 0.55, a: L * 0.93 });               // air tearing
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 110, f1: 1300, dur: L, vol: 1.0, a: L * 0.96 });               // roar
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 300, f1: 3500, dur: L, vol: 0.5, a: L * 0.97 });
    const tb = t + L * 0.42;                                                                                        // sonic boom: ba-boom
    thud(c, d, tb, 72, 30, 0.5, 0.75); thud(c, d, tb + 0.13, 62, 27, 0.6, 0.85);
    nz(c, d, tb, { ft: 'lowpass', f: 1200, f1: 200, dur: 0.25, vol: 0.5 }); nz(c, d, tb + 0.13, { ft: 'lowpass', f: 1000, f1: 160, dur: 0.5, vol: 0.5 });
    return L + 0.05;
  },
  rig_land(c, d, t, o) {                        // colossal impact (G.boom's 'explosion' supplies the blast on top)
    const dr = drive(c, 5); dr.connect(d);
    nz(c, d, t, { ft: 'highpass', f: 1200, dur: 0.1, vol: 0.9 });
    weight(c, d, t, { sub: 58, subEnd: 19, subDur: 2.2, body: 185, bodyDur: 0.65, click: 2000, k: 6 }); thud(c, d, t, 38, 18, 2.8, 0.9);
    weight(c, d, t + 0.11, { sub: 72, subEnd: 30, subDur: 0.6, body: 140, bodyDur: 0.3, click: 0, k: 4, vol: 0.6 });   // the suspension bottoming out
    nz(c, dr, t, { color: 'brown', ft: 'lowpass', f: 2400, f1: 70, dur: 1.8, vol: 1 });
    clang(c, d, t, 98, 2.0, 0.5, 'triangle'); clang(c, d, t + 0.03, 233, 1.2, 0.25);
    nz(c, d, t + 0.1, { color: 'pink', ft: 'lowpass', f: 1500, f1: 200, dur: 3.2, vol: 0.4, a: 0.2 });
    nz(c, d, t + 0.5, { ft: 'highpass', f: 2800, dur: 1.4, vol: 0.14, a: 0.1 });                                   // shock absorbers venting
    const bus = filt(c, 'bandpass', 1400, 0.6); bus.connect(d);
    for (let i = 0; i < 9; i++) grain(c, bus, t + rr(0.3, 2.4), i & 1 ? 'white' : 'pink', rr(0.04, 0.14), rr(0.1, 0.3), rr(0.4, 1.5));
    return 3.5;
  },
  board(c, d, t, o) {                           // hatch, seal, reactor spin-up, systems green
    const lp = filt(c, 'lowpass', 1700, 2); lp.connect(d);
    tone(c, lp, t, { type: 'sawtooth', f: 180, f1: 330, dur: 0.38, vol: 0.14, a: 0.04, hold: 0.25 });                 // hatch servo
    thud(c, d, t + 0.4, 110, 45, 0.16, 0.9); clang(c, d, t + 0.4, 290, 0.3, 0.5, 'triangle');                        // clunk
    nz(c, d, t + 0.42, { ft: 'bandpass', f: 1300, q: 1, dur: 0.06, vol: 0.5 });
    nz(c, d, t + 0.5, { ft: 'highpass', f: 3500, dur: 0.4, vol: 0.25, a: 0.02 });                                   // seal hiss
    const hp = filt(c, 'lowpass', 220, 3); hp.connect(d);                                                           // power-up hum
    hp.frequency.setValueAtTime(220, t + 0.6); hp.frequency.exponentialRampToValueAtTime(2800, t + 2.0);
    tone(c, hp, t + 0.6, { type: 'sawtooth', f: 41, f1: 110, glide: 1.4, dur: 1.9, vol: 0.5, a: 1.1, hold: 0.3 });
    tone(c, hp, t + 0.6, { type: 'sawtooth', f: 61.5, f1: 165, glide: 1.4, dur: 1.9, vol: 0.3, a: 1.1, hold: 0.3 });
    tone(c, d, t + 0.6, { f: 30, f1: 55, glide: 1.4, dur: 1.9, vol: 0.6, a: 1.0, hold: 0.3 });
    beep(c, d, t + 2.0, 880, 0.07, 0.3, 'triangle'); beep(c, d, t + 2.1, 1174.7, 0.07, 0.3, 'triangle'); beep(c, d, t + 2.2, 1760, 0.16, 0.3, 'triangle');
    return 2.6;
  },
  selfdestruct_alarm(c, d, t, o) {
    const n = o.count || 4;
    for (let i = 0; i < n; i++) { beep(c, d, t + i * 0.24, 830, 0.11, 0.45, 'square'); beep(c, d, t + i * 0.24 + 0.12, 622, 0.11, 0.45, 'square'); }
    return n * 0.24 + 0.05;
  },
  eject(c, d, t, o) {                           // alarm, explosive bolts, the seat leaving
    SOUNDS.selfdestruct_alarm(c, d, t, { count: 2 });
    const tb = t + 0.3;
    nz(c, d, tb, { ft: 'highpass', f: 1600, dur: 0.07, vol: 0.9 }); thud(c, d, tb, 150, 40, 0.25, 0.9);
    nz(c, d, tb, { ft: 'bandpass', f: 600, f1: 3800, sweep: 0.5, q: 1.2, dur: 1.2, vol: 0.8, a: 0.03, hold: 0.25 });
    nz(c, d, tb, { color: 'pink', ft: 'lowpass', f: 1200, f1: 300, dur: 1.1, vol: 0.6, a: 0.02 });
    return 1.6;
  },
  selfdestruct(c, d, t, o) {                    // reactor implosion, then the block goes
    nz(c, d, t, { ft: 'bandpass', f: 300, f1: 5000, q: 2, dur: 0.3, vol: 0.6, a: 0.27 });
    tone(c, d, t, { type: 'sawtooth', f: 60, f1: 900, dur: 0.3, vol: 0.2, a: 0.26 });
    const L = SOUNDS.explosion(c, d, t + 0.3, { size: 1.6, kind: 'mech', lag: o.lag });
    weight(c, d, t + 0.3 + (o.lag || 0), { sub: 46, subEnd: 17, subDur: 3.4, body: 140, bodyDur: 1.1, click: 0, k: 6 });
    nz(c, d, t + 0.6 + (o.lag || 0), { color: 'brown', ft: 'lowpass', f: 400, f1: 70, dur: 5, vol: 0.5, a: 0.5 });
    return max(L + 0.3, 5.8 + (o.lag || 0));
  },
  // -------------------------------------------------------------------- pilot
  damage_pilot(c, d, t, o) {
    nz(c, d, t, { ft: 'bandpass', f: 520, q: 1, dur: 0.1, vol: 1 }); thud(c, d, t, 160, 62, 0.14, 0.9);
    tone(c, d, t, { f: 3150, dur: 0.3, vol: 0.06, a: 0.01 });
    return 0.32;
  },
  damage_rig(c, d, t, o) {
    nz(c, d, t, { ft: 'bandpass', f: 1900, q: 1, dur: 0.05, vol: 0.7 });
    clang(c, d, t, 410 * rr(0.85, 1.15), 0.35, 0.7, 'triangle'); thud(c, d, t, 105, 40, 0.2, 0.9);
    const bus = filt(c, 'highpass', 4000, 0.7); bus.connect(d);
    for (let i = 0; i < 3; i++) grain(c, bus, t + rr(0.03, 0.25), 'white', rr(0.01, 0.03), rr(0.2, 0.5), 1);          // sparks
    return 0.45;
  },
  heartbeat(c, d, t, o) {
    thud(c, d, t, 58, 36, 0.13, 1); nz(c, d, t, { ft: 'lowpass', f: 150, dur: 0.08, vol: 0.5 });
    thud(c, d, t + 0.21, 52, 34, 0.15, 0.75);
    return 0.4;
  },
  alarm_low(c, d, t, o) { beep(c, d, t, 880, 0.1, 0.4, 'triangle'); beep(c, d, t + 0.14, 660, 0.14, 0.4, 'triangle'); return 0.32; },
  soldier_down(c, d, t, o) {
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 600, f1: 200, dur: 0.14, vol: 1 }); thud(c, d, t, 130, 60, 0.1, 0.7);
    nz(c, d, t + 0.12, { ft: 'bandpass', f: 1800, q: 1.5, dur: 0.05, vol: 0.3 });                                   // kit hitting the street
    return 0.22;
  },
  drone_down(c, d, t, o) {
    tone(c, d, t, { type: 'sawtooth', f: 1300, f1: 140, dur: 0.5, vol: 0.3, a: 0.01 });
    fm(c, d, t, { f: 600, f1: 90, ratio: 3.3, index: 6, dur: 0.4, vol: 0.4 });
    nz(c, d, t, { ft: 'highpass', f: 3000, dur: 0.06, vol: 0.7 });
    return 0.55;
  },
  wreck(c, d, t, o) {                           // a vehicle or rig coming apart
    const bp = filt(c, 'bandpass', 420, 4); bp.connect(d);
    bp.frequency.setValueAtTime(520, t); bp.frequency.exponentialRampToValueAtTime(170, t + 1.3);
    tone(c, bp, t, { type: 'sawtooth', f: 92, f1: 38, dur: 1.4, vol: 0.9, a: 0.1, hold: 0.4 });                      // groan
    tone(c, bp, t, { type: 'sawtooth', f: 139, f1: 51, dur: 1.2, vol: 0.6, a: 0.1, hold: 0.3 });
    clang(c, d, t, 210, 0.8, 0.5, 'triangle'); clang(c, d, t + 0.35, 157, 0.9, 0.4, 'triangle');
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 900, f1: 150, dur: 1.2, vol: 0.7 });
    return 1.6;
  },
  hit_confirm(c, d, t, o) { tone(c, d, t, { f: 1900, dur: 0.035, vol: 0.5 }); tone(c, d, t, { f: 2850, dur: 0.025, vol: 0.3 }); return 0.05; },
  kill_confirm(c, d, t, o) { tone(c, d, t, { type: 'triangle', f: 1174.7, dur: 0.07, vol: 0.5 }); tone(c, d, t + 0.06, { type: 'triangle', f: 1760, dur: 0.14, vol: 0.5 }); return 0.22; },
  reload(c, d, t, o) {
    const click = (tt, f, v) => { nz(c, d, tt, { ft: 'bandpass', f, q: 3, dur: 0.03, vol: v }); tone(c, d, tt, { type: 'square', f: f * 0.25, dur: 0.02, vol: v * 0.3 }); };
    click(t, 2400, 0.7); click(t + 0.28, 1700, 0.9); click(t + 0.31, 3000, 0.5); click(t + 0.52, 2100, 0.8); click(t + 0.6, 2700, 0.6);
    return 0.66;
  },
  reload_heavy(c, d, t, o) {
    thud(c, d, t, 140, 60, 0.1, 0.8); nz(c, d, t, { ft: 'bandpass', f: 900, q: 1.5, dur: 0.06, vol: 0.7 });
    tone(c, d, t + 0.08, { type: 'sawtooth', f: 160, f1: 300, dur: 0.3, vol: 0.1, a: 0.03, hold: 0.2 });
    clang(c, d, t + 0.42, 420, 0.2, 0.5, 'triangle'); nz(c, d, t + 0.42, { ft: 'bandpass', f: 2000, q: 2, dur: 0.04, vol: 0.6 });
    return 0.65;
  },
  weapon_empty(c, d, t, o) { nz(c, d, t, { ft: 'bandpass', f: 2600, q: 4, dur: 0.025, vol: 0.9 }); tone(c, d, t, { type: 'square', f: 420, dur: 0.02, vol: 0.25 }); return 0.05; },
  weapon_ready(c, d, t, o) { beep(c, d, t, 1320, 0.05, 0.35, 'triangle'); beep(c, d, t + 0.07, 1760, 0.09, 0.35, 'triangle'); return 0.2; },
  // ------------------------------------------------------------- cues, alerts
  lock_warning(c, d, t, o) { beep(c, d, t, 1040, 0.09, 0.4, 'square'); beep(c, d, t + 0.11, 780, 0.09, 0.4, 'square'); return 0.24; },
  ace_warning(c, d, t, o) {
    const p = o.pitch || 1;
    for (let i = 0; i < 3; i++) tone(c, d, t + i * 0.13, { type: 'sawtooth', f: 587 * p * (1 + i * 0.12), f1: 540 * p * (1 + i * 0.12), dur: 0.1, vol: 0.3, a: 0.005, hold: 0.06 });
    return 0.42;
  },
  ace_called(c, d, t, o) {
    const lp = filt(c, 'lowpass', 1600, 1); lp.connect(d);
    for (const f of [146.8, 155.6, 220]) tone(c, lp, t, { type: 'sawtooth', f, dur: 1.4, vol: 0.3, a: 0.03, hold: 0.5 });   // minor-second snarl
    thud(c, d, t, 70, 30, 0.6, 0.9); SOUNDS.lock_warning(c, d, t + 0.1, o); SOUNDS.lock_warning(c, d, t + 0.4, o);
    return 1.5;
  },
  rig_ready(c, d, t, o) {                       // D A D rising, bell over a low swell
    const ns = [587.3, 880, 1174.7];
    for (let i = 0; i < 3; i++) { tone(c, d, t + i * 0.11, { type: 'triangle', f: ns[i], dur: 0.6, vol: 0.4 }); tone(c, d, t + i * 0.11, { f: ns[i] * 2, dur: 0.4, vol: 0.12 }); }
    tone(c, d, t, { type: 'sawtooth', f: 73.4, dur: 0.9, vol: 0.14, a: 0.25 }); thud(c, d, t + 0.22, 110, 55, 0.4, 0.5);
    return 1.0;
  },
  wave_start(c, d, t, o) {                      // low brass fall D-A-D, drum hit, rising air
    const lp = filt(c, 'lowpass', 500, 1.2); lp.connect(d);
    lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(2400, t + 0.15); lp.frequency.exponentialRampToValueAtTime(700, t + 1.4);
    for (const f of [73.4, 110, 146.8, 147.6, 220]) tone(c, lp, t, { type: 'sawtooth', f, dur: 1.5, vol: 0.26, a: 0.04, hold: 0.6 });
    for (const f of [87.3, 174.6]) tone(c, lp, t + 0.5, { type: 'sawtooth', f, dur: 1.0, vol: 0.18, a: 0.04, hold: 0.3 });
    thud(c, d, t, 85, 34, 0.6, 1); nz(c, d, t, { ft: 'lowpass', f: 900, f1: 200, dur: 0.3, vol: 0.5 });
    nz(c, d, t, { ft: 'highpass', f: 5000, dur: 1.2, vol: 0.12, a: 0.01 });
    return 1.7;
  },
  wave_clear(c, d, t, o) {                      // the release: D major swell with a shimmer
    const lp = filt(c, 'lowpass', 2600, 0.7); lp.connect(d);
    const ns = [146.8, 220, 293.7, 370, 440];
    for (let i = 0; i < ns.length; i++) tone(c, lp, t + i * 0.05, { type: 'sawtooth', f: ns[i], dur: 2.2, vol: 0.2, a: 0.25, hold: 0.6, det: (i & 1 ? 6 : -6) });
    for (let i = 0; i < 4; i++) tone(c, d, t + 0.3 + i * 0.12, { type: 'triangle', f: [1174.7, 1480, 1760, 2349.3][i], dur: 0.7, vol: 0.14 });
    thud(c, d, t, 73.4, 36.7, 0.8, 0.6);
    return 2.4;
  },
  enemy_drop(c, d, t, o) {                      // Vanta rig inbound
    for (let i = 0; i < 3; i++) tone(c, d, t + i * 0.3, { type: 'sawtooth', f: 311, f1: 233, dur: 0.24, vol: 0.3, a: 0.01, hold: 0.12 });
    thud(c, d, t, 60, 30, 0.8, 0.7);
    return 1.0;
  },
  defeat(c, d, t, o) {
    const lp = filt(c, 'lowpass', 1800, 0.8); lp.connect(d);
    lp.frequency.setValueAtTime(1800, t); lp.frequency.exponentialRampToValueAtTime(250, t + 3.2);
    for (const f of [146.8, 174.6, 220, 293.7]) { const os = tone(c, lp, t, { type: 'sawtooth', f, dur: 3.4, vol: 0.24, a: 0.02, hold: 1.2 }); os.frequency.exponentialRampToValueAtTime(f * 0.84, t + 3.2); }
    thud(c, d, t, 90, 20, 2.6, 1); nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 600, f1: 60, dur: 2.5, vol: 0.6 });
    return 3.5;
  },
  // ------------------------------------------------------------ Rig Bay arsenal
  autocannon(c, d, t, o) {                      // rotary cannon: dry, hard, mechanical; the motor is a loop in the engine
    const p = (o.pitch || 1) * rr(0.96, 1.04);
    const dr = drive(c, 5); dr.connect(d);
    nz(c, d, t, { ft: 'highpass', f: 2800, dur: 0.035, vol: 0.9, a: 0.0005 });
    nz(c, dr, t, { ft: 'bandpass', f: 900 * p, f1: 300 * p, q: 1, dur: 0.09, vol: 1 });
    tone(c, dr, t, { type: 'square', f: 170 * p, f1: 70 * p, dur: 0.07, vol: 0.6 });
    tone(c, d, t, { f: 110 * p, f1: 48, dur: 0.1, vol: 0.9 });
    nz(c, d, t + 0.015, { ft: 'bandpass', f: 3400, q: 5, dur: 0.03, vol: 0.25 });                                  // link / casing
    return 0.16;
  },
  autocannon_wind(c, d, t, o) {                 // barrels running down
    const lp = filt(c, 'bandpass', 900, 1.5); lp.connect(d);
    tone(c, lp, t, { type: 'sawtooth', f: 330, f1: 55, dur: 0.9, vol: 0.4, a: 0.01 });
    nz(c, d, t, { ft: 'bandpass', f: 2400, f1: 500, q: 2, dur: 0.8, vol: 0.2, a: 0.01 });
    return 0.95;
  },
  lance_start(c, d, t, o) {                     // arc strikes
    nz(c, d, t, { ft: 'highpass', f: 3500, dur: 0.06, vol: 0.9 });
    fm(c, d, t, { f: 180, f1: 420, ratio: 3.01, index: 8, dur: 0.22, vol: 0.7 });
    tone(c, d, t, { type: 'sawtooth', f: 2400, f1: 620, dur: 0.16, vol: 0.3 });
    thud(c, d, t, 120, 50, 0.14, 0.8);
    return 0.25;
  },
  lance_stop(c, d, t, o) { tone(c, d, t, { type: 'sawtooth', f: 520, f1: 90, dur: 0.22, vol: 0.4 }); nz(c, d, t, { ft: 'bandpass', f: 4000, f1: 900, q: 2, dur: 0.25, vol: 0.3 }); return 0.28; },
  siege(c, d, t, o) {                           // the biggest gun in the game
    const p = (o.pitch || 1) * rr(0.96, 1.04);
    const dr = drive(c, 5); dr.connect(d);
    nz(c, d, t, { ft: 'highpass', f: 1400, dur: 0.09, vol: 1, a: 0.0005 });
    weight(c, d, t, { sub: 70 * p, subEnd: 22, subDur: 1.3, body: 210 * p, bodyDur: 0.5, click: 2400, k: 7 });
    tone(c, d, t, { f: 44, f1: 20, dur: 1.8, vol: 0.9, a: 0.008 });
    nz(c, dr, t, { color: 'brown', ft: 'lowpass', f: 2600, f1: 110, dur: 1.1, vol: 1 });
    nz(c, dr, t, { color: 'pink', ft: 'bandpass', f: 600, f1: 220, q: 0.5, dur: 0.6, vol: 0.9 });
    clang(c, d, t + 0.03, 240, 0.7, 0.4, 'triangle');                                                              // breech ring
    nz(c, d, t + 0.1, { color: 'pink', ft: 'lowpass', f: 1300, f1: 180, dur: 2.6, vol: 0.5, a: 0.15 });             // the street answering
    nz(c, d, t + 0.25, { ft: 'highpass', f: 3000, dur: 0.9, vol: 0.12, a: 0.1 });                                   // recoil cylinders venting
    return 2.9;
  },
  recoil(c, d, t, o) {                          // the rig taking the kick: frame groan and servo catch
    const s = o.size == null ? 1 : o.size, lp = filt(c, 'bandpass', 380, 3); lp.connect(d);
    tone(c, lp, t + 0.04, { type: 'sawtooth', f: 120, f1: 62, dur: 0.5 * s + 0.2, vol: 0.7, a: 0.03 });
    clang(c, d, t + 0.05, 170, 0.4, 0.4 * s, 'triangle'); thud(c, d, t + 0.05, 80, 34, 0.3, 0.7 * s);
    tone(c, d, t + 0.25, { type: 'sawtooth', f: 200, f1: 420, dur: 0.35, vol: 0.08, a: 0.05, hold: 0.15 });
    return 0.7;
  },
  swarm_launch(c, d, t, o) {                    // micro-missile: a spit and a fizz; six make the ripple
    const p = (o.pitch || 1) * rr(0.85, 1.3);
    nz(c, d, t, { ft: 'highpass', f: 3200, dur: 0.03, vol: 0.7 });
    nz(c, d, t, { ft: 'bandpass', f: 1500 * p, f1: 4800 * p, q: 3, dur: 0.26, vol: 0.7, a: 0.008 });
    tone(c, d, t, { type: 'sawtooth', f: 400 * p, f1: 1500 * p, dur: 0.16, vol: 0.14, a: 0.01 });
    thud(c, d, t, 210 * p, 90, 0.07, 0.6);
    return 0.3;
  },
  swarm(c, d, t, o) { for (let i = 0; i < 6; i++) SOUNDS.swarm_launch(c, d, t + i * 0.07 + rr(0, 0.015), o); return 0.75; },
  mortar(c, d, t, o) {                          // tube thump: hollow and round
    const p = (o.pitch || 1) * rr(0.94, 1.06);
    weight(c, d, t, { sub: 96 * p, subEnd: 40, subDur: 0.4, body: 190 * p, bodyDur: 0.16, click: 0, k: 4 });
    const bp = filt(c, 'bandpass', 260 * p, 6); bp.connect(d);                                                      // tube resonance
    nz(c, bp, t, { ft: 'lowpass', f: 2000, dur: 0.35, vol: 1.6 });
    nz(c, d, t, { ft: 'lowpass', f: 1200, f1: 300, dur: 0.14, vol: 0.7 });
    nz(c, d, t + 0.03, { ft: 'highpass', f: 2500, dur: 0.3, vol: 0.12, a: 0.03 });
    return 0.5;
  },
  mortar_split(c, d, t, o) {                    // the shell opening overhead
    nz(c, d, t, { ft: 'highpass', f: 2200, dur: 0.05, vol: 1 }); thud(c, d, t, 180, 60, 0.14, 0.9);
    nz(c, d, t, { ft: 'bandpass', f: 1200, f1: 400, q: 0.8, dur: 0.25, vol: 0.7 });
    const bus = filt(c, 'highpass', 2500, 0.7); bus.connect(d);
    for (let i = 0; i < 5; i++) grain(c, bus, t + 0.03 + i * rr(0.02, 0.04), 'white', 0.03, rr(0.3, 0.6), rr(0.8, 1.5));
    return 0.4;
  },
  // ---------------------------------------------------------- equipment, brawling
  shield_up(c, d, t, o) {
    fm(c, d, t, { f: 90, f1: 220, ratio: 2.0, index: 3, dur: 0.35, vol: 0.6, a: 0.03 });
    nz(c, d, t, { ft: 'bandpass', f: 600, f1: 4200, q: 2.5, dur: 0.32, vol: 0.5, a: 0.2 });
    tone(c, d, t + 0.28, { type: 'triangle', f: 880, dur: 0.3, vol: 0.25 }); tone(c, d, t + 0.28, { f: 1320, dur: 0.25, vol: 0.15 });
    thud(c, d, t + 0.28, 110, 60, 0.12, 0.6);
    return 0.6;
  },
  shield_down(c, d, t, o) { fm(c, d, t, { f: 220, f1: 70, ratio: 2.0, index: 3, dur: 0.3, vol: 0.5 }); nz(c, d, t, { ft: 'bandpass', f: 3500, f1: 500, q: 2.5, dur: 0.28, vol: 0.35 }); return 0.32; },
  shield_hit(c, d, t, o) {                      // energy disc taking a round: a slap and a ring
    const p = (o.pitch || 1) * rr(0.88, 1.15);
    nz(c, d, t, { ft: 'bandpass', f: 2600 * p, q: 1.5, dur: 0.05, vol: 0.9 });
    fm(c, d, t, { f: 330 * p, f1: 250 * p, ratio: 1.41, index: 5, dur: 0.3, vol: 0.6 });
    tone(c, d, t, { f: 1760 * p, dur: 0.22, vol: 0.2 });
    thud(c, d, t, 140, 60, 0.12, 0.8);
    return 0.34;
  },
  shield_break(c, d, t, o) {                    // the field collapsing
    nz(c, d, t, { ft: 'highpass', f: 2500, dur: 0.12, vol: 1 });
    fm(c, d, t, { f: 520, f1: 55, ratio: 2.73, index: 10, dur: 0.8, vol: 0.8 });
    weight(c, d, t, { sub: 90, subEnd: 30, subDur: 0.6, body: 220, bodyDur: 0.2, click: 3000, k: 5 });
    const g = gain(c, 1); g.connect(d);
    for (let i = 0; i < 8; i++) tone(c, g, t + rr(0.02, 0.6), { f: rr(1800, 5200), f1: rr(600, 1500), dur: rr(0.05, 0.14), vol: rr(0.1, 0.22) });
    for (let i = 0; i < 2; i++) beep(c, d, t + 0.7 + i * 0.16, 392, 0.1, 0.3, 'square');
    return 1.1;
  },
  grapple_fire(c, d, t, o) {                    // gas charge, then cable paying out
    nz(c, d, t, { ft: 'highpass', f: 1800, dur: 0.05, vol: 0.9 }); thud(c, d, t, 170, 55, 0.16, 1);
    nz(c, d, t, { ft: 'bandpass', f: 800, q: 1.2, dur: 0.1, vol: 0.8 });
    nz(c, d, t + 0.03, { ft: 'bandpass', f: 2200, f1: 6500, q: 6, dur: 0.3, vol: 0.5, a: 0.02 });                   // zing
    tone(c, d, t + 0.03, { type: 'sawtooth', f: 700, f1: 2400, dur: 0.28, vol: 0.1, a: 0.02 });
    return 0.36;
  },
  grapple_latch(c, d, t, o) {
    clang(c, d, t, 480 * rr(0.9, 1.1), 0.4, 0.8, 'triangle'); nz(c, d, t, { ft: 'bandpass', f: 2600, q: 1.5, dur: 0.04, vol: 0.9 });
    thud(c, d, t, 130, 55, 0.14, 0.9);
    tone(c, d, t + 0.02, { type: 'sawtooth', f: 90, f1: 140, dur: 0.25, vol: 0.2, a: 0.04 });                       // cable taking the load
    return 0.45;
  },
  grapple_miss(c, d, t, o) { nz(c, d, t, { ft: 'bandpass', f: 5000, f1: 1500, q: 5, dur: 0.3, vol: 0.5, a: 0.02 }); tone(c, d, t + 0.25, { type: 'triangle', f: 520, f1: 300, dur: 0.12, vol: 0.3 }); return 0.4; },
  grapple_release(c, d, t, o) { nz(c, d, t, { ft: 'bandpass', f: 3000, q: 3, dur: 0.04, vol: 0.8 }); clang(c, d, t, 620, 0.15, 0.4); nz(c, d, t + 0.02, { ft: 'bandpass', f: 4000, f1: 1200, q: 4, dur: 0.22, vol: 0.3, a: 0.01 }); return 0.28; },
  limb_torn(c, d, t, o) {                       // metal shrieking, then the arm lets go
    const bp = filt(c, 'bandpass', 1400, 5), dr = drive(c, 6); bp.connect(dr); dr.connect(d);
    bp.frequency.setValueAtTime(700, t); bp.frequency.exponentialRampToValueAtTime(2600, t + 0.45);
    tone(c, bp, t, { type: 'sawtooth', f: 210, f1: 620, dur: 0.5, vol: 0.9, a: 0.04, hold: 0.3 });                   // shriek
    tone(c, bp, t, { type: 'sawtooth', f: 317, f1: 890, dur: 0.5, vol: 0.6, a: 0.04, hold: 0.3 });
    nz(c, bp, t, { ft: 'highpass', f: 800, dur: 0.5, vol: 0.5, a: 0.05, hold: 0.3 });
    const ts = t + 0.5;                                                                                             // the snap
    weight(c, d, ts, { sub: 80, subEnd: 28, subDur: 0.6, body: 240, bodyDur: 0.25, click: 3200, k: 6 });
    clang(c, d, ts, 190, 0.9, 0.6, 'triangle'); clang(c, d, ts + 0.04, 433, 0.5, 0.35);
    nz(c, d, ts, { ft: 'highpass', f: 1500, dur: 0.08, vol: 0.9 });
    const bus = filt(c, 'highpass', 3500, 0.7); bus.connect(d);
    for (let i = 0; i < 8; i++) grain(c, bus, ts + rr(0.02, 0.7), 'white', rr(0.01, 0.04), rr(0.25, 0.6), 1);         // sparks from the stump
    fm(c, d, ts, { f: 700, f1: 80, ratio: 3.3, index: 6, dur: 0.5, vol: 0.35 });
    return 1.5;
  },
  finisher_grab(c, d, t, o) {                   // clamp, lift
    clang(c, d, t, 260, 0.4, 0.7, 'triangle'); thud(c, d, t, 110, 45, 0.2, 1); nz(c, d, t, { ft: 'bandpass', f: 1500, q: 1, dur: 0.07, vol: 0.8 });
    const lp = filt(c, 'lowpass', 1600, 2.5); lp.connect(d);
    tone(c, lp, t + 0.1, { type: 'sawtooth', f: 70, f1: 260, dur: 1.0, vol: 0.4, a: 0.3, hold: 0.5 });                // hydraulics straining
    tone(c, lp, t + 0.1, { type: 'sawtooth', f: 106, f1: 392, dur: 1.0, vol: 0.25, a: 0.3, hold: 0.5 });
    nz(c, d, t + 0.1, { ft: 'bandpass', f: 500, f1: 2400, q: 2, dur: 1.0, vol: 0.3, a: 0.7 });
    return 1.2;
  },
  finisher(c, d, t, o) {                        // the kill: on top of the slam and the blast
    weight(c, d, t, { sub: 60, subEnd: 20, subDur: 1.6, body: 200, bodyDur: 0.5, click: 2600, k: 7 });
    clang(c, d, t, 120, 1.6, 0.6, 'triangle'); clang(c, d, t + 0.05, 277, 1.0, 0.35);
    const lp = filt(c, 'lowpass', 1800, 1); lp.connect(d);
    for (const f of [73.4, 110, 146.8, 220]) tone(c, lp, t, { type: 'sawtooth', f, dur: 1.6, vol: 0.2, a: 0.01, hold: 0.5 });   // a low D to mark it
    nz(c, d, t, { ft: 'highpass', f: 4000, dur: 1.4, vol: 0.15, a: 0.005 });
    return 1.8;
  },
  brace_on(c, d, t, o) {                        // anchors down: two clamps and a hiss
    for (let i = 0; i < 2; i++) { const tt = t + i * 0.14; thud(c, d, tt, 95, 38, 0.25, 1); clang(c, d, tt, 210 * (1 + i * 0.12), 0.25, 0.5, 'triangle'); nz(c, d, tt, { ft: 'bandpass', f: 1300, q: 1, dur: 0.06, vol: 0.7 }); }
    nz(c, d, t + 0.3, { ft: 'highpass', f: 3000, dur: 0.45, vol: 0.22, a: 0.02 });
    tone(c, d, t, { type: 'sawtooth', f: 240, f1: 110, dur: 0.3, vol: 0.1, a: 0.02 });
    return 0.8;
  },
  brace_off(c, d, t, o) { nz(c, d, t, { ft: 'highpass', f: 2600, dur: 0.25, vol: 0.25, a: 0.01 }); clang(c, d, t + 0.08, 250, 0.2, 0.4, 'triangle'); tone(c, d, t, { type: 'sawtooth', f: 110, f1: 240, dur: 0.25, vol: 0.1, a: 0.02 }); return 0.35; },
  airdash(c, d, t, o) {                         // Harrier: a sharp crack of thrust, lighter than the ground dash
    const p = (o.pitch || 1) * rr(0.95, 1.08);
    nz(c, d, t, { ft: 'highpass', f: 2000, dur: 0.04, vol: 0.9 });
    nz(c, d, t, { ft: 'bandpass', f: 900 * p, f1: 5200 * p, sweep: 0.35, q: 1.8, dur: 0.34, vol: 0.9, a: 0.012, hold: 0.05 });
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 1100, f1: 300, dur: 0.3, vol: 0.6, a: 0.005 });
    thud(c, d, t, 170 * p, 60, 0.16, 0.9);
    return 0.4;
  },
  charge_mount(c, d, t, o) {                    // boots and a magnetic clamp on enemy armour
    thud(c, d, t, 130, 60, 0.1, 0.8); nz(c, d, t, { ft: 'bandpass', f: 1100, q: 1.2, dur: 0.05, vol: 0.8 });
    clang(c, d, t + 0.22, 520, 0.25, 0.6, 'triangle'); nz(c, d, t + 0.22, { ft: 'bandpass', f: 2800, q: 3, dur: 0.03, vol: 0.7 });
    fm(c, d, t + 0.24, { f: 160, f1: 240, ratio: 2, index: 2, dur: 0.25, vol: 0.3 });
    return 0.55;
  },
  charge_planted(c, d, t, o) {                  // armed: beeps closing up over the 0.8 s fuse
    let tt = t, gap = 0.2;
    for (let i = 0; i < 7 && tt < t + 0.78; i++) { beep(c, d, tt, 1568 + i * 60, Math.min(0.06, gap * 0.6), 0.45, 'square'); tt += gap; gap *= 0.72; }
    beep(c, d, t + 0.72, 2093, 0.09, 0.5, 'square');
    return 0.85;
  },
  hijack(c, d, t, o) {                          // forcing a Vanta cockpit: glitching handshake, then our tone wins
    for (let i = 0; i < 6; i++) fm(c, d, t + i * 0.09, { f: rr(300, 1400), f1: rr(200, 900), ratio: rr(1.3, 4.1), index: 6, dur: 0.07, vol: 0.4 });
    tone(c, d, t, { type: 'sawtooth', f: 311, f1: 233, dur: 0.5, vol: 0.2, a: 0.01, hold: 0.3 });                     // their alarm, dying
    thud(c, d, t + 0.55, 110, 45, 0.2, 0.9); clang(c, d, t + 0.55, 290, 0.3, 0.5, 'triangle');
    const hp = filt(c, 'lowpass', 300, 3); hp.connect(d);
    hp.frequency.setValueAtTime(300, t + 0.6); hp.frequency.exponentialRampToValueAtTime(2600, t + 1.5);
    tone(c, hp, t + 0.6, { type: 'sawtooth', f: 55, f1: 110, glide: 0.9, dur: 1.2, vol: 0.5, a: 0.7, hold: 0.2 });
    beep(c, d, t + 1.5, 880, 0.07, 0.3, 'triangle'); beep(c, d, t + 1.6, 1174.7, 0.07, 0.3, 'triangle'); beep(c, d, t + 1.7, 1760, 0.16, 0.3, 'triangle');
    return 2.0;
  },
  gas_jet(c, d, t, o) {                         // a main lets go: bang, shriek of pressure, the torch catching
    nz(c, d, t, { ft: 'highpass', f: 1800, dur: 0.06, vol: 0.9 });
    weight(c, d, t, { sub: 85, subEnd: 34, subDur: 0.6, body: 230, bodyDur: 0.25, click: 2600, k: 5 });
    nz(c, d, t + 0.02, { ft: 'bandpass', f: 5200, f1: 1100, q: 2.5, dur: 0.9, vol: 0.6, a: 0.03 });                  // pressure
    nz(c, d, t + 0.12, { color: 'pink', ft: 'lowpass', f: 400, f1: 1800, dur: 0.9, vol: 0.8, a: 0.3 });               // whoomph into the loop
    return 1.1;
  },
  fire_out(c, d, t, o) { nz(c, d, t, { ft: 'highpass', f: 2200, dur: 0.6, vol: 0.4, a: 0.03 }); nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 700, f1: 200, dur: 0.5, vol: 0.4, a: 0.02 }); return 0.65; },
  fire_start(c, d, t, o) {                      // something catching: a soft whoomph
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 300, f1: 1600, dur: 0.5, vol: 0.9, a: 0.12 });
    thud(c, d, t, 90, 45, 0.3, 0.6);
    return 0.55;
  },
  // ------------------------------------------------------- campaign (Phase C)
  objective_new(c, d, t, o) { beep(c, d, t, 784, 0.07, 0.35, 'triangle'); beep(c, d, t + 0.09, 1174.7, 0.14, 0.35, 'triangle'); tone(c, d, t, { type: 'sawtooth', f: 73.4, dur: 0.5, vol: 0.1, a: 0.05 }); return 0.5; },
  objective_done(c, d, t, o) {                  // D A D F# rising, with a floor under it
    const ns = [587.3, 880, 1174.7, 1480];
    for (let i = 0; i < 4; i++) { tone(c, d, t + i * 0.09, { type: 'triangle', f: ns[i], dur: 0.7, vol: 0.38 }); tone(c, d, t + i * 0.09, { f: ns[i] * 2, dur: 0.4, vol: 0.1 }); }
    const lp = filt(c, 'lowpass', 1500, 0.8); lp.connect(d);
    for (const f of [146.8, 220, 293.7, 370]) tone(c, lp, t + 0.27, { type: 'sawtooth', f, dur: 1.3, vol: 0.16, a: 0.08, hold: 0.4 });
    thud(c, d, t + 0.27, 110, 45, 0.5, 0.8);
    return 1.7;
  },
  stage_banner(c, d, t, o) {                    // mission stage card: drum, low brass fifth, air
    const lp = filt(c, 'lowpass', 500, 1.2); lp.connect(d);
    lp.frequency.setValueAtTime(350, t); lp.frequency.exponentialRampToValueAtTime(2200, t + 0.2); lp.frequency.exponentialRampToValueAtTime(600, t + 1.8);
    for (const f of [73.4, 73.9, 110, 146.8, 220.6]) tone(c, lp, t, { type: 'sawtooth', f, dur: 1.9, vol: 0.25, a: 0.05, hold: 0.8 });
    weight(c, d, t, { sub: 80, subEnd: 32, subDur: 0.8, body: 180, bodyDur: 0.25, click: 1800, k: 4 });
    thud(c, d, t + 0.42, 70, 34, 0.6, 0.7);
    nz(c, d, t, { ft: 'highpass', f: 5000, dur: 1.5, vol: 0.1, a: 0.01 });
    return 2.1;
  },
  perk_offer(c, d, t, o) {                      // three cards fanning out
    nz(c, d, t, { ft: 'bandpass', f: 1200, f1: 6000, q: 1.5, dur: 0.5, vol: 0.3, a: 0.35 });
    for (let i = 0; i < 3; i++) { tone(c, d, t + 0.2 + i * 0.12, { type: 'triangle', f: [880, 1108.7, 1318.5][i], dur: 0.6, vol: 0.3 }); nz(c, d, t + 0.2 + i * 0.12, { ft: 'bandpass', f: 2600, q: 3, dur: 0.03, vol: 0.4 }); }
    tone(c, d, t + 0.2, { type: 'sawtooth', f: 110, dur: 0.9, vol: 0.1, a: 0.1 });
    return 1.2;
  },
  perk_pick(c, d, t, o) {                       // module locks in, power chord answers
    thud(c, d, t, 120, 50, 0.2, 0.9); clang(c, d, t, 330, 0.3, 0.5, 'triangle'); nz(c, d, t, { ft: 'bandpass', f: 1800, q: 1.5, dur: 0.04, vol: 0.7 });
    const lp = filt(c, 'lowpass', 2400, 0.8); lp.connect(d);
    for (const f of [146.8, 220, 293.7, 440]) tone(c, lp, t + 0.08, { type: 'sawtooth', f, dur: 1.0, vol: 0.18, a: 0.02, hold: 0.3 });
    beep(c, d, t + 0.1, 1174.7, 0.06, 0.3, 'triangle'); beep(c, d, t + 0.18, 1760, 0.14, 0.3, 'triangle');
    return 1.2;
  },
  salvage(c, d, t, o) {                         // ticker: a small bright clink, pitch climbs with o.pitch
    const p = (o.pitch || 1) * rr(0.97, 1.03);
    tone(c, d, t, { f: 2093 * p, dur: 0.09, vol: 0.4 }); tone(c, d, t, { f: 3136 * p, dur: 0.06, vol: 0.2 });
    nz(c, d, t, { ft: 'bandpass', f: 4200, q: 4, dur: 0.02, vol: 0.4 });
    return 0.12;
  },
  boss_arrive(c, d, t, o) {                     // the Dreadnought: a horn from under the street
    const lp = filt(c, 'lowpass', 300, 1.5), dr = drive(c, 4); lp.connect(dr); dr.connect(d);
    lp.frequency.setValueAtTime(220, t); lp.frequency.exponentialRampToValueAtTime(1500, t + 1.4); lp.frequency.exponentialRampToValueAtTime(400, t + 3.6);
    for (const f of [36.7, 55, 73.4, 77.8, 110, 116.5]) tone(c, lp, t, { type: 'sawtooth', f, dur: 3.8, vol: 0.3, a: 0.6, hold: 1.8 });   // D with the minor second grinding on top
    weight(c, d, t, { sub: 55, subEnd: 20, subDur: 2.4, body: 150, bodyDur: 0.6, click: 0, k: 6 });
    weight(c, d, t + 1.5, { sub: 60, subEnd: 22, subDur: 2.0, body: 160, bodyDur: 0.5, click: 1500, k: 6 });
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 200, f1: 60, dur: 4, vol: 0.7, a: 0.5, hold: 1.5 });
    for (let i = 0; i < 3; i++) tone(c, d, t + 2.2 + i * 0.4, { type: 'sawtooth', f: 311, f1: 220, dur: 0.32, vol: 0.2, a: 0.01, hold: 0.15 });
    return 4.2;
  },
  boss_phase(c, d, t, o) {                      // it changes: a tearing stab and a drop
    const p = o.pitch || 1, lp = filt(c, 'lowpass', 2600, 1), dr = drive(c, 5); lp.connect(dr); dr.connect(d);
    for (const f of [73.4, 103.8, 146.8, 207.7]) tone(c, lp, t, { type: 'sawtooth', f: f * p, f1: f * p * 0.9, dur: 1.6, vol: 0.3, a: 0.01, hold: 0.5 });   // tritone stack
    weight(c, d, t, { sub: 70, subEnd: 22, subDur: 1.5, body: 190, bodyDur: 0.4, click: 2400, k: 6 });
    fm(c, d, t, { f: 600, f1: 70, ratio: 2.9, index: 8, dur: 0.7, vol: 0.4 });
    nz(c, d, t, { ft: 'highpass', f: 3500, dur: 1.2, vol: 0.14, a: 0.005 });
    return 1.9;
  },
  victory(c, d, t, o) {                         // the district held: D major, rising, with drums
    const lp = filt(c, 'lowpass', 2800, 0.7); lp.connect(d);
    const ch = [[146.8, 220, 293.7, 370], [196, 246.9, 293.7, 392], [220, 277.2, 329.6, 440], [146.8, 220, 293.7, 370, 587.3]];
    for (let k = 0; k < 4; k++) {
      const tt = t + k * 0.62, L = k === 3 ? 3.2 : 0.7;
      for (let i = 0; i < ch[k].length; i++) tone(c, lp, tt, { type: 'sawtooth', f: ch[k][i], dur: L, vol: 0.17, a: 0.03, hold: L * 0.5, det: i & 1 ? 6 : -6 });
      tone(c, d, tt, { type: 'triangle', f: ch[k][ch[k].length - 1] * 2, dur: L * 0.8, vol: 0.2 });
      weight(c, d, tt, { sub: 75, subEnd: 32, subDur: k === 3 ? 1.6 : 0.5, body: 170, bodyDur: 0.2, click: 1500, k: 4, vol: k === 3 ? 1 : 0.7 });
    }
    nz(c, d, t + 1.86, { ft: 'highpass', f: 5000, dur: 3, vol: 0.2, a: 0.01 });
    return 5.2;
  },
  mission_failed(c, d, t, o) {                  // three falling notes; 'defeat' follows from game:over
    for (let i = 0; i < 3; i++) tone(c, d, t + i * 0.28, { type: 'sawtooth', f: [293.7, 277.2, 220][i], f1: [293.7, 277.2, 207][i], dur: 0.5, vol: 0.25, a: 0.01, hold: 0.2 });
    thud(c, d, t, 80, 30, 1.0, 0.8);
    return 1.2;
  },
  // ------------------------------------------------------------------ Rig Bay UI
  bay_fit(c, d, t, o) {                         // a module seating on its hardpoint; o.size 1 = chassis swap
    const s = o.size || 0.5, p = (o.pitch || 1) * rr(0.94, 1.06);
    tone(c, d, t, { type: 'sawtooth', f: 260 * p, f1: 180 * p, dur: 0.09, vol: 0.08, a: 0.01 });
    thud(c, d, t + 0.07, 120 * p / (0.6 + s), 50, 0.12 + 0.2 * s, 0.9); clang(c, d, t + 0.07, 340 * p / (0.6 + s), 0.2 + 0.3 * s, 0.5, 'triangle');
    nz(c, d, t + 0.07, { ft: 'bandpass', f: 1800, q: 1.5, dur: 0.04, vol: 0.7 });
    nz(c, d, t + 0.12, { ft: 'bandpass', f: 3400, q: 4, dur: 0.02, vol: 0.4 });                                      // latch
    return 0.3 + 0.3 * s;
  },
  bay_paint(c, d, t, o) {                       // spray pass
    nz(c, d, t, { ft: 'bandpass', f: 4200, f1: 5600, q: 0.8, dur: 0.38, vol: 0.5, a: 0.05, hold: 0.2 });
    nz(c, d, t, { ft: 'highpass', f: 7000, dur: 0.36, vol: 0.2, a: 0.05, hold: 0.2 });
    return 0.42;
  },
  bay_open(c, d, t, o) {                        // hangar lights and a shutter
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 300, f1: 1200, dur: 0.5, vol: 0.5, a: 0.2 });
    thud(c, d, t + 0.35, 90, 40, 0.3, 0.8); clang(c, d, t + 0.35, 220, 0.4, 0.3, 'triangle');
    beep(c, d, t + 0.4, 660, 0.05, 0.25, 'triangle'); beep(c, d, t + 0.47, 990, 0.09, 0.25, 'triangle');
    return 0.8;
  },
  // ------------------------------------------------- pilot movement, seeker, ambience
  seeker_launch(c, d, t, o) {                   // shoulder AA: a lighter, drier cousin of the Skylance
    const p = (o.pitch || 1) * rr(0.96, 1.06);
    nz(c, d, t, { ft: 'highpass', f: 3500, dur: 0.035, vol: 0.6 });
    nz(c, d, t, { ft: 'bandpass', f: 1100 * p, f1: 5200 * p, q: 2.4, dur: 0.36, vol: 0.6, a: 0.01, hold: 0.06 });
    tone(c, d, t, { f: 700 * p, f1: 3100 * p, dur: 0.2, vol: 0.2, a: 0.01 });
    thud(c, d, t, 190, 80, 0.09, 0.5);
    return 0.4;
  },
  roll(c, d, t, o) {                            // cloth and kit hitting the ground twice
    nz(c, d, t, { color: 'pink', ft: 'lowpass', f: 700, f1: 250, dur: 0.14, vol: 1 }); thud(c, d, t, 120, 55, 0.1, 0.7);
    nz(c, d, t + 0.02, { ft: 'bandpass', f: 2600, q: 0.8, dur: 0.22, vol: 0.2, a: 0.05 });
    nz(c, d, t + 0.2, { color: 'pink', ft: 'lowpass', f: 550, f1: 220, dur: 0.12, vol: 0.7 }); thud(c, d, t + 0.2, 100, 50, 0.09, 0.5);
    nz(c, d, t + 0.22, { ft: 'bandpass', f: 3400, q: 3, dur: 0.03, vol: 0.3 });
    return 0.4;
  },
  crouch(c, d, t, o) {                          // soft gear rustle; o.up for standing
    const up = o.up ? 1.25 : 1;
    nz(c, d, t, { ft: 'bandpass', f: 2200 * up, f1: 1300 * up, q: 0.7, dur: 0.16, vol: 0.6, a: 0.04 });
    nz(c, d, t + 0.07, { ft: 'bandpass', f: 3600, q: 3, dur: 0.025, vol: 0.25 });
    return 0.2;
  },
  mantle(c, d, t, o) {                          // hands, boots and webbing over a ledge: no voice
    nz(c, d, t, { ft: 'bandpass', f: 900, q: 1, dur: 0.06, vol: 0.9 }); thud(c, d, t, 150, 70, 0.07, 0.6);
    nz(c, d, t + 0.05, { ft: 'bandpass', f: 2400, f1: 1500, q: 0.7, dur: 0.25, vol: 0.3, a: 0.06 });
    nz(c, d, t + 0.16, { ft: 'bandpass', f: 3800, q: 4, dur: 0.03, vol: 0.4 }); tone(c, d, t + 0.16, { f: 2900, dur: 0.05, vol: 0.12 });
    nz(c, d, t + 0.3, { color: 'pink', ft: 'lowpass', f: 600, dur: 0.08, vol: 0.9 }); thud(c, d, t + 0.3, 110, 55, 0.08, 0.6);
    return 0.42;
  },
  amb_gunfire(c, d, t, o) {                     // a firefight some blocks away
    const n = 3 + (R() * 6 | 0), gap = rr(0.07, 0.13), p = rr(0.7, 1.3);
    for (let i = 0; i < n; i++) {
      const tt = t + i * gap + rr(0, 0.02);
      nz(c, d, tt, { color: 'pink', ft: 'lowpass', f: 700 * p, f1: 250, dur: 0.16, vol: rr(0.6, 1) });
      tone(c, d, tt, { f: 110 * p, f1: 55, dur: 0.1, vol: 0.5 });
    }
    return n * gap + 0.3;
  },
  amb_boom(c, d, t, o) {                        // distant detonation, all low end
    const p = rr(0.8, 1.2);
    tone(c, d, t, { f: 62 * p, f1: 28, dur: 1.3, vol: 1, a: 0.02 });
    nz(c, d, t, { color: 'brown', ft: 'lowpass', f: 320, f1: 70, dur: 2.2, vol: 0.9, a: 0.03 });
    return 2.4;
  },
  amb_siren(c, d, t, o) {                       // a civil-defence wail drifting over the roofs
    const L = 7, lp = filt(c, 'lowpass', 1100, 0.7), g = gain(c, 0); lp.connect(g); g.connect(d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.5, t + 1.5); g.gain.setValueAtTime(0.5, t + L - 2.5); g.gain.linearRampToValueAtTime(0, t + L);
    const p = rr(0.9, 1.1);
    for (const det of [0, 9]) {
      const os = N(c.createOscillator()); os.type = 'sawtooth'; os.detune.value = det;
      os.frequency.setValueAtTime(420 * p, t);
      for (let k = 0; k < 3; k++) { os.frequency.linearRampToValueAtTime(760 * p, t + k * 2.4 + 1.1); os.frequency.linearRampToValueAtTime(430 * p, t + k * 2.4 + 2.4); }
      os.connect(lp); os.start(t); os.stop(t + L + 0.02); if (det) fin(os, g);
    }
    return L + 0.1;
  },
  ui_confirm(c, d, t, o) { beep(c, d, t, 1320, 0.04, 0.4, 'triangle'); beep(c, d, t + 0.05, 1980, 0.08, 0.4, 'triangle'); thud(c, d, t, 140, 70, 0.08, 0.4); return 0.16; },
  ui_click(c, d, t, o) { tone(c, d, t, { f: 1800 * (o.pitch || 1), dur: 0.03, vol: 0.5 }); nz(c, d, t, { ft: 'highpass', f: 5000, dur: 0.012, vol: 0.4 }); return 0.05; },
  ui_hover(c, d, t, o) { tone(c, d, t, { f: 2400 * (o.pitch || 1), dur: 0.018, vol: 0.25 }); return 0.03; },
  ui_back(c, d, t, o) { tone(c, d, t, { f: 1100, f1: 760, dur: 0.06, vol: 0.5 }); return 0.08; },
  ui_start(c, d, t, o) {
    beep(c, d, t, 880, 0.06, 0.4, 'triangle'); beep(c, d, t + 0.07, 1320, 0.12, 0.4, 'triangle');
    thud(c, d, t, 110, 40, 0.4, 0.8); nz(c, d, t, { ft: 'highpass', f: 4000, dur: 0.5, vol: 0.1, a: 0.01 });
    return 0.55;
  },
  ui_pause(c, d, t, o) { beep(c, d, t, 660, 0.05, 0.4, 'triangle'); beep(c, d, t + 0.06, 440, 0.09, 0.4, 'triangle'); return 0.18; },
  ui_resume(c, d, t, o) { beep(c, d, t, 440, 0.05, 0.4, 'triangle'); beep(c, d, t + 0.06, 660, 0.09, 0.4, 'triangle'); return 0.18; },
  ui_msg(c, d, t, o) { tone(c, d, t, { type: 'triangle', f: 990 * (o.pitch || 1), dur: 0.09, vol: 0.4 }); tone(c, d, t + 0.05, { f: 1980 * (o.pitch || 1), dur: 0.06, vol: 0.12 }); return 0.14; },
};

const lagless = o => !(o.lag > 0.02);          // the click belongs to the crack: only when crack and boom coincide
function pulseHit(c, d, t, p) {                 // the electric sizzle a pulse bolt adds to any surface
  nz(c, d, t, { ft: 'bandpass', f: 3200 * p, f1: 800, q: 3, dur: 0.14, vol: 0.5 });
  tone(c, d, t, { type: 'sawtooth', f: 1300 * p, f1: 200, dur: 0.06, vol: 0.25 });
  thud(c, d, t, 120, 50, 0.08, 0.5);
}

export const SOUND_NAMES = Object.keys(SOUNDS);
