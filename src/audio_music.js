// ============================================================================
// KILOTON — audio_music.js   OWNER: AUDIO
// Adaptive score. A 16th-note lookahead scheduler on the audio clock drives
// five layers (pad, bass, drums, brass, arp) whose gains crossfade with the
// game state: title | foot | inbound | rig | intermission | defeat.
// D minor, 126 bpm in play. Bass and arp are persistent monosynths (automation
// only, no node churn); drums, pads and brass are short scheduled voices.
//   const m = createMusic(ctx, dst, reverbIn); m.setState('foot'); m.update(ctx.currentTime)
// Works on any BaseAudioContext (tests render it offline).
// ============================================================================
import { tone, nz, gain, filt, env, stats } from './audio_synth.js';

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const N = n => { stats.nodes++; return n; };
const D = 38, F = 41, G_ = 31, A = 33, Bb = 34, C = 36;      // roots (MIDI), octave 2-ish
const MIN = [0, 3, 7], MAJ = [0, 4, 7];

// mix: [pad, bass, drums, brass, arp] (arp and drums get + intensity terms in targetMix)
const STATES = {
  title: {
    bpm: 96, mix: [0.9, 0.5, 0.25, 0, 0.45], padCut: 1500,
    chords: [[D, [0, 3, 7, 14]], [Bb, [0, 4, 7, 11]], [G_ + 12, [0, 3, 7, 14]], [A, [0, 5, 7, 10]]],
    bass: 'x.........x.....', arp: '0.2.1.3.2.1.2.3.',
    drums: [{ kick: 'x.........x.....' }, { kick: 'x.........x.....' }],
  },
  foot: {
    bpm: 126, mix: [0.4, 0.9, 0.75, 0, 0.2], padCut: 1100,
    chords: [[D, MIN], [D, [0, 3, 7, 10]], [Bb, MAJ], [C, MAJ]],
    bass: 'x.xx.x.xx.xx.xo.', arp: '0.1.2.1.3.1.2.1.',
    drums: [
      { kick: 'x.......x.......', hat: '..x...x...x...x.' },
      { kick: 'x..x....x.x.....', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx' },
    ],
  },
  inbound: {
    bpm: 132, mix: [0.5, 0.9, 1, 0.6, 0.6], padCut: 2200,
    chords: [[A, [0, 4, 7, 10]], [A, [0, 4, 7, 10]], [A, [0, 4, 7, 10]], [A, [0, 4, 7, 10]]],   // dominant pedal: resolves to Dm on touchdown
    bass: 'xxxxxxxxxxxxxxxx', arp: '0123012301230123', brass: ['L...............'],
    drums: [{ kick: 'x...x...x...x...' }, { kick: 'x...x...x...x...' }],
  },
  rig: {
    bpm: 126, mix: [0.35, 1.5, 1.2, 1, 0.3], padCut: 1300,
    chords: [[D, MIN], [F, MAJ], [Bb, MAJ], [A, MAJ]],
    bass: 'x..x..x.x..x.xo.', arp: '0.1.2.3.2.1.2.3.',
    brass: ['x.....x...x.....', 'x..x..x.....x.x.', 'x.....x...x.....', 'x..x..x...L.....'],
    horn: [[[0, 62, 6], [8, 65, 4], [12, 64, 4]], [[0, 60, 8], [10, 57, 6]], [[0, 62, 6], [8, 65, 4], [12, 67, 4]], [[0, 64, 8], [8, 61, 8]]],
    drums: [
      { kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', boom: 1 },
      { kick: 'x..x..x.x..x..x.', snare: '....x.......x...', clank: '..x...x.x.x...x.', hat: 'x.xxx.xxx.xxx.xx', fill: 1, boom: 1 },
    ],
  },
  intermission: {
    bpm: 126, mix: [0.9, 0.55, 0.3, 0, 0.6], padCut: 2000,
    chords: [[Bb, [0, 4, 7, 14]], [F, MAJ], [C, [0, 4, 7, 14]], [D, [0, 3, 7, 10]]],
    bass: 'x.......x.....x.', arp: '0.2.1.2.3.2.1.2.',
    drums: [{ kick: 'x...............', hat: '....x.......x...' }, { kick: 'x...............', hat: '....x.......x...' }],
  },
  defeat: {
    bpm: 72, mix: [1, 0.5, 0.2, 0.5, 0.4], padCut: 900,
    chords: [[D, MIN], [D, [0, 5, 8]], [Bb, MAJ], [A, MAJ]],
    bass: 'x...............', arp: '..2...1...0.....',
    horn: [[[0, 62, 14]], [[0, 60, 14]], [[0, 58, 14]], [[0, 57, 14]]],
    drums: [{ tom: 'x...............' }, { tom: 'x...............' }],
  },
};
export const MUSIC_STATES = Object.keys(STATES);

export function createMusic(ctx, dst, reverbIn) {
  // ---- persistent graph ----------------------------------------------------
  const sum = gain(ctx, 1), tilt = filt(ctx, 'lowpass', 18000, 0.5);
  sum.connect(tilt); tilt.connect(dst);
  const L = {};
  for (const n of ['pad', 'bass', 'drums', 'brass', 'arp']) { L[n] = gain(ctx, 0); L[n].connect(sum); }
  if (reverbIn) { const rs = gain(ctx, 0.35); L.pad.connect(rs); L.brass.connect(rs); L.arp.connect(rs); const rd = gain(ctx, 0.12); L.drums.connect(rd); rs.connect(reverbIn); rd.connect(reverbIn); }
  const padF = filt(ctx, 'lowpass', 1200, 0.6); padF.connect(L.pad);
  // bass monosynth
  const bO1 = N(ctx.createOscillator()), bO2 = N(ctx.createOscillator()), bF = filt(ctx, 'lowpass', 300, 4), bA = gain(ctx, 0), bSub = gain(ctx, 0.3);
  bO1.type = 'sawtooth'; bO2.type = 'square'; bO1.connect(bF); bO2.connect(bSub); bSub.connect(bF); bF.connect(bA); bA.connect(L.bass);
  bO1.start(); bO2.start();
  // arp monosynth + dotted-eighth echo
  const aO = N(ctx.createOscillator()), aF = filt(ctx, 'lowpass', 2400, 1.5), aA = gain(ctx, 0);
  aO.type = 'square'; aO.connect(aF); aF.connect(aA); aA.connect(L.arp);
  const dl = N(ctx.createDelay(1)), fb = gain(ctx, 0.35), dw = gain(ctx, 0.4);
  dl.delayTime.value = 60 / 126 * 0.75; aA.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(dw); dw.connect(L.arp);
  aO.start();

  const M = {
    state: '', intensity: 0, step: 0, bar: 0, nextT: 0, phrase: 0,
    eta: 0, inboundT0: 0, riser: null, layers: L, tilt, started: false,
    setState(name, opts) {
      if (!STATES[name] || name === this.state) return;
      const prev = this.state; this.state = name;
      const now = ctx.currentTime;
      if (name === 'inbound') { this.eta = (opts && opts.eta) || 4; this.inboundT0 = now; this.startRiser(now + 0.02, this.eta); }
      else this.killRiser(now);
      if (name === 'rig' || name === 'inbound' || name === 'defeat' || !prev) { this.step = 0; this.bar = 0; this.phrase = 0; }   // land on the downbeat
      this.applyMix(name === 'rig' || name === 'inbound' ? 0.12 : 0.5);
      padF.frequency.setTargetAtTime(STATES[name].padCut, now, 0.5);
      dl.delayTime.setTargetAtTime(60 / STATES[name].bpm * 0.75, now, 0.2);
    },
    setIntensity(v) {
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      if (Math.abs(v - this.intensity) < 0.04) return;
      this.intensity = v; this.applyMix(0.6);
    },
    applyMix(tc) {
      const S = STATES[this.state]; if (!S) return;
      const now = ctx.currentTime, I = this.intensity, m = S.mix;
      L.pad.gain.setTargetAtTime(m[0] * 0.85, now, tc);
      L.bass.gain.setTargetAtTime(m[1] * 0.24, now, tc);
      L.drums.gain.setTargetAtTime(m[2] * (0.55 + 0.45 * I) * 0.42, now, tc);
      L.brass.gain.setTargetAtTime(m[3] * 0.62, now, tc);
      L.arp.gain.setTargetAtTime(Math.min(1, m[4] + 0.5 * I * (this.state === 'foot' || this.state === 'rig' ? 1 : 0)) * 0.3, now, tc);
    },
    // muffle for the pause menu (0 = open, 1 = under water)
    setMuffle(v) { tilt.frequency.setTargetAtTime(v > 0.5 ? 650 : 18000, ctx.currentTime, 0.15); },

    // schedule everything due before now + ahead
    update(now, ahead = 0.3) {
      const S = STATES[this.state]; if (!S) return;
      if (!this.started || this.nextT < now - 0.25) { this.nextT = now + 0.06; this.started = true; }
      let guard = 0;
      while (this.nextT < now + ahead && guard++ < 4096) {
        const S2 = STATES[this.state], d16 = 60 / S2.bpm / 4;
        this.sched(S2, this.bar, this.step, this.nextT, d16);
        this.nextT += d16;
        if (++this.step >= 16) { this.step = 0; if (++this.bar >= 4) { this.bar = 0; this.phrase++; } }
      }
    },

    sched(S, bar, s, t, d16) {
      const ch = S.chords[bar], root = ch[0], q = ch[1], I = this.intensity, st = this.state;
      const prog = st === 'inbound' ? Math.min(1, (t - this.inboundT0) / Math.max(0.5, this.eta)) : 0;
      // ---- pad: one chord per bar
      if (s === 0) this.pad(t, root + 24, q, d16 * 16.5, st === 'title' || st === 'intermission' || st === 'defeat' ? 1 : 0.8);
      // ---- bass
      const bc = S.bass[s];
      if (bc !== '.') {
        let len = 1; while (s + len < 16 && S.bass[s + len] === '.' && len < 6) len++;
        const m = root + (bc === 'o' ? 12 : bc === '5' ? 7 : 0);
        this.bassNote(t, m, d16 * (len > 1 ? len * 0.9 : 0.8), (s % 4 === 0 ? 1 : 0.75) * (st === 'inbound' ? 0.5 + 0.5 * prog : 1), st === 'rig' || st === 'inbound' ? 1 : 0.6);
      }
      // ---- arp
      const ac = S.arp[s];
      if (ac !== '.' && (I > 0.25 || (st !== 'foot' && st !== 'rig'))) {
        const k = +ac, m = root + 36 + (k >= q.length ? 12 + q[k - q.length] : q[k]) + (st === 'inbound' ? Math.floor(prog * 3) * 12 - 12 : 0);
        this.arpNote(t, m, d16 * (st === 'title' || st === 'defeat' ? 1.8 : 0.85), s % 4 === 0 ? 1 : 0.7);
      }
      // ---- drums
      const dk = S.drums[I > 0.5 ? 1 : 0], heavy = st === 'rig';
      if (dk.kick && dk.kick[s] === 'x') this.kick(t, st === 'title' ? 0.5 : 1, heavy);
      if (dk.snare && dk.snare[s] === 'x') this.snare(t, 1, heavy);
      if (dk.hat && dk.hat[s] === 'x') this.hat(t, (s % 4 === 2 ? 0.8 : 0.45) * (0.6 + 0.4 * I), s === 14 && bar === 3);
      if (dk.clank && dk.clank[s] === 'x') this.clank(t, 0.6);
      if (dk.tom && dk.tom[s] === 'x') this.tom(t, 70, 1);
      if (dk.boom && s === 0 && bar === 0) tone(ctx, L.drums, t, { f: 62, f1: 30, dur: 1.2, vol: 0.9, a: 0.005 });
      if (bar === 3 && s >= 12 && (dk.fill || (heavy && this.phrase % 2 === 1))) this.tom(t, 150 - (s - 12) * 22, 0.9);
      if (st === 'inbound') {                                     // snare roll that tightens as the rig falls
        const v = 0.25 + 0.75 * prog;
        if (prog < 0.33) { if (s % 2 === 0) this.snare(t, v * 0.7, false); }
        else if (prog < 0.7) this.snare(t, v * (s % 2 ? 0.6 : 0.85), false);
        else { this.snare(t, v, false); this.snare(t + d16 * 0.5, v * 0.8, false); }
      }
      // ---- brass
      if (S.brass) {
        const bp = S.brass[bar % S.brass.length], b = bp[s];
        if (b === 'x') this.stab(t, root + 12, d16 * 1.7, 1);
        else if (b === 'L') this.stab(t, root + 12, d16 * (st === 'inbound' ? 15 : 6), 0.9);
      }
      if (S.horn && (st === 'defeat' || (I > 0.45 && this.phrase % 2 === 1) || I > 0.8)) {
        const hn = S.horn[bar];
        for (let i = 0; i < hn.length; i++) if (hn[i][0] === s) this.horn(t, hn[i][1], d16 * hn[i][2] * 0.95, st === 'defeat' ? 0.7 : 1);
      }
    },

    // ---- instruments ---------------------------------------------------------
    bassNote(t, m, dur, vel, bright) {
      const f = mtof(m);
      bO1.frequency.setValueAtTime(f, t); bO2.frequency.setValueAtTime(f / 2, t); bSub.gain.setValueAtTime(bright > 0.9 ? 0.55 : 0.3, t);
      bF.frequency.setValueAtTime(420 + 2200 * vel * bright, t); bF.frequency.exponentialRampToValueAtTime(300, t + Math.max(0.05, dur));
      bA.gain.setValueAtTime(0, t); bA.gain.linearRampToValueAtTime(0.8 * vel, t + 0.006); bA.gain.setTargetAtTime(0, t + dur * 0.75, 0.025);
    },
    arpNote(t, m, dur, vel) {
      aO.frequency.setValueAtTime(mtof(m), t);
      aF.frequency.setValueAtTime(900 + 2600 * vel, t); aF.frequency.exponentialRampToValueAtTime(500, t + dur);
      aA.gain.setValueAtTime(0, t); aA.gain.linearRampToValueAtTime(0.5 * vel, t + 0.004); aA.gain.setTargetAtTime(0, t + dur * 0.5, 0.04);
    },
    pad(t, root, q, dur, vel) {
      const g = gain(ctx, 0);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.11 * vel, t + dur * 0.3); g.gain.setValueAtTime(0.11 * vel, t + dur * 0.7); g.gain.linearRampToValueAtTime(0, t + dur);
      g.connect(padF);
      let last = null;
      for (let i = 0; i < q.length && i < 4; i++) for (let k = 0; k < 2; k++) {
        const o = N(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = mtof(root + q[i]); o.detune.value = k ? 8 : -8;
        o.connect(g); o.start(t); o.stop(t + dur + 0.02); last = o;
      }
      last.onended = () => g.disconnect();
    },
    brassVoice(t, notes, dur, vol, cut, att) {
      const f = filt(ctx, 'lowpass', 250, 1.1), g = gain(ctx, 0);
      f.frequency.setValueAtTime(260, t); f.frequency.exponentialRampToValueAtTime(cut, t + att * 1.5); f.frequency.exponentialRampToValueAtTime(cut * 0.45, t + dur);
      env(g.gain, t, att, vol, dur, dur * 0.55);
      f.connect(g); g.connect(L.brass);
      let last = null;
      for (let i = 0; i < notes.length; i++) {
        const o = N(ctx.createOscillator()); o.type = 'sawtooth'; o.frequency.value = mtof(notes[i]); o.detune.value = (i & 1 ? 7 : -7);
        o.connect(f); o.start(t); o.stop(t + dur + 0.02); last = o;
      }
      last.onended = () => g.disconnect();
    },
    stab(t, m, dur, vel) { this.brassVoice(t, [m - 12, m, m, m + 7, m + 12], dur, 0.2 * vel, 1700, 0.035); },
    horn(t, m, dur, vel) { this.brassVoice(t, [m, m, m - 12], dur, 0.2 * vel, 2100, 0.07); },
    kick(t, vel, heavy) {
      tone(ctx, L.drums, t, { f: heavy ? 130 : 160, f1: heavy ? 36 : 44, glide: 0.08, dur: heavy ? 0.4 : 0.22, vol: (heavy ? 1.1 : 0.85) * vel, a: 0.002 });
      if (heavy) tone(ctx, L.drums, t, { type: 'triangle', f: 190, f1: 75, glide: 0.06, dur: 0.16, vol: 0.5 * vel, a: 0.002 });
      nz(ctx, L.drums, t, { ft: 'lowpass', f: heavy ? 4500 : 3000, dur: 0.025, vol: 0.6 * vel });
    },
    snare(t, vel, heavy) {
      nz(ctx, L.drums, t, { ft: 'bandpass', f: heavy ? 1500 : 2000, q: 0.6, dur: heavy ? 0.26 : 0.14, vol: 1.0 * vel });
      tone(ctx, L.drums, t, { type: 'triangle', f: heavy ? 190 : 230, f1: heavy ? 120 : 160, dur: 0.09, vol: 0.5 * vel });
      if (heavy) nz(ctx, L.drums, t, { color: 'pink', ft: 'lowpass', f: 700, dur: 0.3, vol: 0.4 * vel });
    },
    hat(t, vel, open) { nz(ctx, L.drums, t, { ft: 'highpass', f: 7500, dur: open ? 0.2 : 0.04, vol: 0.5 * vel }); },
    tom(t, f, vel) { tone(ctx, L.drums, t, { f: f * 1.5, f1: f, glide: 0.06, dur: 0.3, vol: 0.8 * vel }); },
    clank(t, vel) {
      const f = filt(ctx, 'bandpass', 2300, 3); f.connect(L.drums);
      tone(ctx, f, t, { type: 'square', f: 587, dur: 0.07, vol: 0.5 * vel });
      const o = tone(ctx, f, t, { type: 'square', f: 845, dur: 0.07, vol: 0.5 * vel });
      o.addEventListener('ended', () => f.disconnect());
    },
    // the rising build for a Rig drop: lasts `eta` seconds, holds a little if the rig is late
    startRiser(t, eta) {
      this.killRiser(t);
      const g = gain(ctx, 1), f = filt(ctx, 'lowpass', 300, 2); f.connect(g); g.connect(L.brass);
      f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(6000, t + eta);
      const stop = t + eta + 1.5, srcs = [];
      for (const [m, det] of [[45, -9], [45, 9], [52, 0]]) {
        const o = N(ctx.createOscillator()), og = gain(ctx, 0); o.type = 'sawtooth'; o.detune.value = det;
        o.frequency.setValueAtTime(mtof(m), t); o.frequency.exponentialRampToValueAtTime(mtof(m + 24), t + eta);
        og.gain.setValueAtTime(0.0005, t); og.gain.exponentialRampToValueAtTime(0.22, t + eta); og.gain.linearRampToValueAtTime(0, stop);
        o.connect(og); og.connect(f); o.start(t); o.stop(stop + 0.02); srcs.push(o);
      }
      const nf = nz(ctx, g, t, { ft: 'highpass', f: 6000, f1: 1200, dur: eta + 0.05, vol: 0.35, a: eta * 0.97 });
      srcs[0].onended = () => { try { g.disconnect(); } catch (e) {} if (this.riser && this.riser.g === g) this.riser = null; };
      this.riser = { g, srcs, nf };
    },
    killRiser(t) {
      const r = this.riser; if (!r) return; this.riser = null;
      r.g.gain.cancelScheduledValues(t); r.g.gain.setTargetAtTime(0, t, 0.03);
      for (const o of r.srcs) { try { o.stop(t + 0.25); } catch (e) {} }
    },
    // touchdown: the build resolves. A stacked D hit, sub and a wash, on the downbeat of the rig theme.
    hit(t) {
      this.killRiser(t);
      this.brassVoice(t, [26, 38, 38, 45, 50, 57, 62], 2.6, 0.5, 3200, 0.01);
      tone(ctx, L.drums, t, { f: 110, f1: 28, glide: 0.3, dur: 2.0, vol: 1, a: 0.003 });
      nz(ctx, L.drums, t, { ft: 'highpass', f: 5000, dur: 2.4, vol: 0.3, a: 0.004 });
      nz(ctx, L.drums, t, { ft: 'bandpass', f: 1400, q: 0.5, dur: 0.4, vol: 0.7 });
    },
    stop() { const now = ctx.currentTime; for (const k in L) L[k].gain.setTargetAtTime(0, now, 0.1); this.state = ''; this.killRiser(now); },
  };
  return M;
}
