// DESTRUCT co-op wire test (no browser):  node harness/destruct_net.js   [CITY=1 real city] [SCRIPT=fire: only a wooden interior fire + a gas main]
// The reference run is the HOST (simulates fire, taps ops, records serializeFires at 4 Hz); replays are CLIENTS (applyRemote + applyFires).
// 1. run 30 mixed ops locally with tap recording, settle, hash every chunk
// 2. restore the grid, replay the recorded ops through applyRemote with the same seeds at the same frames, hash, compare
// 3. encodeChunk / applyChunk round trip and sizes; heal the mismatching chunks and compare again
import { G, THREE, VS, ents, CX, CY, CZ } from '../src/core.js';
import '../src/voxels.js';
import { M } from '../src/materials.js';
import destruct from '../src/destruct.js';
const city = (await import(process.env.CITY ? '../src/city.js' : '../src/baseline/city.js')).default;
G.scene = new THREE.Scene(); G.city = city; G.destruct = destruct; await city.init(G); destruct.init(G);
destruct.deterministic = process.env.DET !== '0';
const g = G.grid, NCH = CX * CY * CZ, B = city.buildings;
// extra content so fire / gas / barrels take part
let tb = B[0]; for (const q of B) if (q.j1 - q.j0 > tb.j1 - tb.j0) tb = q;
const sb = B[0] === tb ? B[1] : B[0];
for (let i = sb.i0 + 2; i < sb.i1 - 1; i += 3) for (let k = sb.k0 + 2; k < sb.k1 - 1; k += 3) g.set(i, sb.j0, k, M.furniture);
for (let i = sb.i0 + 1; i < sb.i1; i++) for (let h = 0; h < 6; h++) g.set(i, sb.j0 + h, sb.k0 + 10, M.wood);
for (let k = sb.k0 + 1; k < sb.k1; k++) for (let i = sb.i0 + 1; i < sb.i0 + 12; i++) if (g.get(i, sb.j0 + 6, k)) g.set(i, sb.j0 + 6, k, M.wood_dark);
for (let i = sb.i0 - 20; i <= sb.i1 + 20; i++) g.set(i, 2, sb.k1 + 12, M.gas_pipe);
for (let n = 0; n < 5; n++) for (let h = 0; h < 3; h++) g.set(sb.i0 + n * 5, 4 + h, sb.k1 + 6, M.barrel_red);
g.snapshot(); destruct.reset(); destruct.init === 0;
const { initBuildings } = await import('../src/destruct_base.js'); const { initStruct } = await import('../src/destruct_struct.js'); initBuildings(); initStruct();
const owner = ents.add({ kind: 'pilot', team: 0, pos: new THREE.Vector3(5, 2, 5), radius: 0.35, height: 1.8, hp: 1e6 });
let s = 777; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
const P = b => [(b.i0 + r() * (b.i1 - b.i0)) * VS, (b.j0 + 1 + r() * Math.min(10, b.j1 - b.j0)) * VS, (b.k0 + r() * (b.k1 - b.k0)) * VS];
const script = [];        // [frame, fn]
for (let n = 0; n < 30; n++) {
  const f = 10 + n * 14, b = n % 3 === 0 ? tb : n % 3 === 1 ? sb : B[(r() * B.length) | 0], p = P(b), kind = n % 6;
  if (kind === 0) script.push([f, () => G.boom(p[0], p[1], p[2], { radius: 3 + r() * 2, power: 160, owner })]);
  else if (kind === 1) script.push([f, () => destruct.punch(b.i0 * VS - 1, b.j0 * VS + 2.5, p[2], 1, 0, 0, 1.6, 3.5, 130, owner)]);
  else if (kind === 2) script.push([f, () => destruct.impact(b.i0 * VS + 0.1, b.j0 * VS + 1.2, p[2], 1, 0, 0, 220, 0.6, { owner })]);
  else if (kind === 3) script.push([f, () => destruct.carveBox(p[0] - 1.5, b.j0 * VS, p[2] - 1.5, p[0] + 1.5, b.j0 * VS + 3, p[2] + 1.5, 200, true)]);
  else if (kind === 4) script.push([f, () => destruct.ignite(p[0], b.j0 * VS + 0.5, p[2], 3, 1, owner)]);
  else script.push([f, () => { const ch = destruct.grabChunk(b.i0 * VS, b.j0 * VS + 3, p[2], 2); if (ch) destruct.releaseChunk(ch, new THREE.Vector3(b.i0 * VS - 6, b.j0 * VS + 6, p[2]), new THREE.Vector3(18, 2, 0), owner); }]);
}
if (process.env.SCRIPT === 'fire') { script.length = 0; script.push([20, () => destruct.ignite((sb.i0 + 3) * VS, sb.j0 * VS + 0.5, (sb.k0 + 3) * VS, 2, 1, owner)]); script.push([30, () => destruct.ignite((sb.i0 + 6) * VS, sb.j0 * VS + 1, (sb.k0 + 10) * VS, 1.5, 1, owner)]); }
script.push([40, () => G.boom((sb.i0 - 19) * VS, 1.7, (sb.k1 + 12.5) * VS, { radius: 1.6, power: 140, owner })]);       // gas main
script.push([60, () => G.boom(sb.i0 * VS + 0.25, 2.6, (sb.k1 + 6.5) * VS, { radius: 1.2, power: 80, owner })]);          // barrel row
// ring of rockets: the tall building comes down in both runs
if (process.env.SCRIPT !== 'fire') for (let x = tb.i0 * VS; x <= (tb.i1 + 1) * VS; x += 3) for (let z = tb.k0 * VS; z <= (tb.k1 + 1) * VS; z += 3) script.push([300, () => G.boom(x, tb.j0 * VS + 1.6, z, { radius: 4, power: 170, owner })]);
script.sort((a, c) => a[0] - c[0]);
G.net = { online: true, isHost: true, localOwns: () => true };
const fireTape = new Map(); const fstat = { snaps: 0, bytes: 0, max: 0, maxCells: 0, applied: 0, exact: 0, burnOps: 0, burnVox: 0 };
function sameBytes(a, b) { if (a.length !== b.length) return false; const A2 = Array.from({ length: (a.length - 4) / 7 }, (_, q) => Array.from(a.subarray(4 + q * 7, 11 + q * 7)).join(',')).sort(), B2 = Array.from({ length: (b.length - 4) / 7 }, (_, q) => Array.from(b.subarray(4 + q * 7, 11 + q * 7)).join(',')).sort(); return A2.join(';') === B2.join(';'); }
function run(events, host) {        // events: [frame, fn]; returns hashes after settling
  G.net.isHost = !!host;
  ents.clear(); ents.add(owner); g.restore(); g.dirty.clear(); G.time = 0; G.frame = 0; destruct.reset();
  if (host) fireTape.clear();
  let e = 0, f = 0, idle = 0;
  for (; f < 60 * 120 && idle < 90; f++) {
    G.time += 1 / 60; G.dt = 1 / 60; G.frame++;
    frameNow = f; while (e < events.length && events[e][0] <= f) events[e++][1]();
    destruct.update(1 / 60); g.takeDirty(6);
    if (f % 15 === 0) {          // 4 Hz fire snapshots
      if (host) { const b = destruct.serializeFires().slice(); fireTape.set(f, b); fstat.snaps++; fstat.bytes += b.length; if (b.length > fstat.max) fstat.max = b.length; fstat.maxCells = Math.max(fstat.maxCells, destruct.fires.count); }
      else if (fireTape.has(f)) { destruct.applyFires(fireTape.get(f)); fstat.applied++; const mine = destruct.serializeFires(), ref = fireTape.get(f); if (sameBytes(mine, ref)) fstat.exact++; else if (process.env.DBG && !fstat.shown) { fstat.shown = 1; const T = a => Array.from({ length: (a.length - 4) / 7 }, (_, q) => Array.from(a.subarray(4 + q * 7, 11 + q * 7)).join(',')); const m = new Set(T(mine)), r2 = new Set(T(ref)); console.log('jets ref', T(ref).slice(-ref[2]), 'mine', T(mine).slice(-mine[2])); console.log('f', f, 'hdr', mine.slice(0, 3), ref.slice(0, 3), 'only mine', [...m].filter(x => !r2.has(x)).slice(0, 6), 'only ref', [...r2].filter(x => !m.has(x)).slice(0, 6)); } }
    }
    const st = destruct.stats; idle = e >= events.length && !st.pending && !st.bodies && !st.debris && !st.fires && !destruct.jets.count ? idle + 1 : 0;
  }
  const h = new Uint32Array(NCH); for (let c = 0; c < NCH; c++) h[c] = destruct.chunkHash(c);
  return { h, frames: f, data: g.data.slice() };
}
let frameNow = 0;
const base = new Uint32Array(NCH); for (let c = 0; c < NCH; c++) base[c] = destruct.chunkHash(c);
// ---- run A: local, tapped ----
const tape = [];
destruct.tap = (op, args, seed) => { tape.push([frameNow, op, JSON.parse(JSON.stringify(args)), seed]); if (op === 'burn') { fstat.burnOps++; fstat.burnVox += args.length / 4; } };
let curF = 0; const A = run(script.map(([f, fn]) => [f, () => { fn(); }]), true);
destruct.tap = null;
const ops = {}; for (const t of tape) ops[t[1]] = (ops[t[1]] || 0) + 1;
console.log('host fire: snapshots', fstat.snaps, 'avg bytes', Math.round(fstat.bytes / fstat.snaps), 'max bytes', fstat.max, 'max cells', fstat.maxCells, '| burn ops', fstat.burnOps, 'voxels', fstat.burnVox);
console.log('run A: frames', A.frames, 'taps', tape.length, JSON.stringify(ops), 'wire bytes (JSON)', JSON.stringify(tape.map(t => t.slice(1))).length);
// ---- run B: the tape through applyRemote ----
const Bq = tape.map(t => [t[0], () => destruct.applyRemote(t[1], t[2], t[3])]);
const Br = run(Bq);
function compare(X, Y, label) {
  let edited = 0, same = 0, vox = 0; const bad = [];
  for (let c = 0; c < NCH; c++) { if (X.h[c] === base[c] && Y.h[c] === base[c]) continue; edited++; if (X.h[c] === Y.h[c]) same++; else bad.push(c); }
  for (let o = 0; o < X.data.length; o++) if (X.data[o] !== Y.data[o]) vox++;
  console.log(label, 'edited chunks', edited, 'matching', same, '=', (100 * same / Math.max(1, edited)).toFixed(1) + '%', 'differing voxels', vox, 'of', X.data.length);
  return bad;
}
const bad = compare(A, Br, 'A (host) vs B (client replay, same frames):');
console.log('client fire sets identical to the host snapshot after applyFires:', fstat.exact + '/' + fstat.applied);
// ---- run C: the same tape but every op arrives 3 frames late (network latency) ----
const Cr = run(tape.map(t => [t[0] + 3, () => destruct.applyRemote(t[1], t[2], t[3])]));
compare(A, Cr, 'A vs C (ops 3 frames late):');
// ---- run E: every op arrives with its own 0-8 frame delay (jitter), order kept ----
let js = 99; const jr = () => (js = (js * 16807) % 2147483647) / 2147483647; let lastF = 0;
const Er = run(tape.map(t => { lastF = Math.max(lastF, t[0] + Math.floor(jr() * 9)); return [lastF, () => destruct.applyRemote(t[1], t[2], t[3])]; }));
compare(A, Er, 'A vs E (0-8 frames jitter per op):');
// ---- run D: replay again with identical timing (is the sim itself repeatable?) ----
const Dr = run(Bq);
compare(Br, Dr, 'B vs D (same tape twice):');
// ---- chunk codec: grid currently holds run D. Encode every edited chunk, check round trip + sizes, then heal D to A ----
let total = 0, mx = 0, n = 0, rt = 0; const t0 = performance.now();
const enc = []; for (let c = 0; c < NCH; c++) if (Dr.h[c] !== base[c]) { const b = destruct.encodeChunk(c); enc.push([c, b]); total += b.length; if (b.length > mx) mx = b.length; n++; }
const tEnc = (performance.now() - t0) / Math.max(1, n);
for (const [c, b] of enc) { if (destruct.applyChunk(c, b) === 0 && destruct.chunkHash(c) === Dr.h[c]) rt++; }
console.log('encodeChunk:', n, 'edited chunks, avg', Math.round(total / Math.max(1, n)), 'bytes, max', mx, '(raw 32768),', tEnc.toFixed(3), 'ms each; round trip unchanged', rt + '/' + n);
// heal: put run A's version of the chunks that differ into the grid holding run D
const cur = g.data.slice(); g.data.set(A.data); const encA = []; for (let c = 0; c < NCH; c++) if (A.h[c] !== Er.h[c]) encA.push([c, destruct.encodeChunk(c)]);
g.data.set(Er.data); let healed = 0, changed = 0; for (const [c, b] of encA) { changed += destruct.applyChunk(c, b); if (destruct.chunkHash(c) === A.h[c]) healed++; }
console.log('heal E -> A:', encA.length, 'chunks sent,', encA.reduce((a, e) => a + e[1].length, 0), 'bytes,', changed, 'voxels changed,', healed + '/' + encA.length, 'hashes now equal');
let th = 0; const t1 = performance.now(); for (let q = 0; q < 2000; q++) th += destruct.chunkHash(q % NCH); console.log('chunkHash', ((performance.now() - t1) / 2000).toFixed(4), 'ms each; recentChunks now', destruct.recentChunks(4).length);
