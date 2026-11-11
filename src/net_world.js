// ============================================================================
// KILOTON — net_world.js   OWNER: NET
// Destruction replication: operations out / in (G.destruct.tap / applyRemote),
// host chunk checksums, client resync requests, RLE chunk transfer.
// ============================================================================
import { G, bus, CX, CY, CZ, NX, NZ, VS } from './core.js';
import { T } from './net_wire.js';
import { entById } from './net_players.js';

const OPS = ['explode', 'impact', 'punch', 'carveBox', 'ignite', 'burnPool', 'grab', 'release', 'burn'];
const BURN = 8;
const KINDS = ['rocket', 'shell', 'pulse', 'mech', 'slam', 'grenade'];
const NCH = CX * CY * CZ;
const CHK_DT = 0.2, CHK_RECENT = 9, CHK_SWEEP = 5, REQ_PER_TICK = 2, MISMATCH_AGE = 0.8, REQ_GAP = 1.5;
let N = null;
const pending = [];                       // ops tapped this frame
let fireT = 0, fireLive = false;
let applying = false, chkT = 0, sweep = 0, recentI = 0, reqT = 0;
const hot = [];                           // host: chunks to hash next (mission builds, fresh joins)
const mmT = new Float32Array(NCH).fill(-1), reqAt = new Float32Array(NCH).fill(-99), hostHash = new Uint32Array(NCH);
const want = new Set(), miss = new Set(), asked = new Set();   // miss: differs from the host's last hash; want: still differs after MISMATCH_AGE
const serve = [];                         // host: [peer, chunk, …] requests waiting
const _args = [];
const wrapped = [];                       // FALLBACK taps installed on a DESTRUCT without `tap`
const safe = (fn) => { try { return fn(); } catch (e) { if (G.debug) console.warn('net', e); return undefined; } };

export function init(net) {
  N = net;
  // G.boom emits 'explosion' right after the explode op it caused was tapped: note which blasts other peers must
  // announce themselves (everything except projectile hits, whose replay does it, and unit wrecks, whose puppet does).
  bus.on('explosion', (d) => {
    if (!N.online || !pending.length || !d || d.remote || d.cosmetic) return;
    const p = pending[pending.length - 1], a = p.a;
    if (p.o !== 0 || a[0] !== d.x || a[1] !== d.y || a[2] !== d.z) return;
    const cur = N.cur, ow = d.owner;
    if (cur === 'combat') return;
    if (cur === 'enemy' && !(ow && ow.team === 1 && ow.alive)) return;
    p.fx = KINDS.indexOf(d.kind) + 1 || 1;
  });
  bus.on('objective:new', (d) => { const o = d && d.objective; if (N.online && N.isHost && o && o.x != null) heat(o.x, o.z); });
}
function heat(x, z) {                     // queue the chunk columns round a point for an early checksum
  const ci = Math.floor(x / VS / 32), ck = Math.floor(z / VS / 32);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let cj = 0; cj < CY; cj++) {
    const i = ci + a, k = ck + b; if (i < 0 || k < 0 || i >= CX || k >= CZ) continue;
    const c = i + CX * (k + CZ * cj); if (hot.indexOf(c) < 0) hot.push(c);
  }
}
export function heatAll() { hot.length = 0; sweep = 0; }

// ---- tap ---------------------------------------------------------------------------
function tap(op, args, seed) {
  if (applying || !N.online || N.status !== 'playing') return;
  const o = OPS.indexOf(op); if (o < 0) return;
  pending.push({ o, a: args, s: seed >>> 0, fx: 0 });
  N.stats.opsOut++;
}
export function tapDestruct(op, args, seed) { tap(op, args, seed); }
export function enable(on) {
  const D = G.destruct; if (!D) return;
  if ('tap' in D) { D.tap = on ? tap : null; return; }
  // FALLBACK (a DESTRUCT without the tap hook, i.e. the lead's baseline): wrap the two primitive carvers
  if (on && !wrapped.length) {
    for (const name of ['explode', 'carveBox']) {
      const orig = D[name]; if (typeof orig !== 'function') continue;
      const w = function (...a) {
        const r = orig.apply(this, a);
        if (r && !applying) tap(name, name === 'explode' ? [a[0], a[1], a[2], a[3], a[4], 0] : [a[0], a[1], a[2], a[3], a[4], a[5], a[6], 1], 1);
        return r;
      };
      D[name] = w; wrapped.push(name, orig, w);
    }
  } else if (!on) { for (let i = 0; i < wrapped.length; i += 3) if (D[wrapped[i]] === wrapped[i + 2]) D[wrapped[i]] = wrapped[i + 1]; wrapped.length = 0; }
}
export function reset() {
  pending.length = 0; want.clear(); miss.clear(); asked.clear(); serve.length = 0; hot.length = 0; mmT.fill(-1); reqAt.fill(-99); chkT = 0; sweep = 0; recentI = 0; fireT = 0; fireLive = false;
}

// ---- hashing / codec: DESTRUCT's when present, else the same algorithms on the raw grid ------
function chunkHash(c) {
  const D = G.destruct; if (D.chunkHash) return D.chunkHash(c);
  const data = G.grid.data, ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0;
  let h = 0x811c9dc5 | 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) { let o = ci * 32 + NX * (k + NZ * j); for (let e = o + 32; o < e; o++) h = Math.imul(h ^ data[o], 0x01000193); }
  return h >>> 0;
}
function encodeChunk(c) {
  const D = G.destruct; if (D.encodeChunk) return D.encodeChunk(c);
  const data = G.grid.data, ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0, out = [];
  let cur = -1, run = 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) { let o = ci * 32 + NX * (k + NZ * j); for (let e = o + 32; o < e; o++) { const m = data[o]; if (m === cur && run < 256) run++; else { if (run) out.push(cur, run - 1); cur = m; run = 1; } } }
  if (run) out.push(cur, run - 1);
  return Uint8Array.from(out);
}
function applyChunk(c, bytes) {
  const D = G.destruct; if (D.applyChunk) return D.applyChunk(c, bytes);
  const g = G.grid, data = g.data, ci = c % CX, ck = ((c / CX) | 0) % CZ, cj = (c / (CX * CZ)) | 0;
  let p = 0, m = 0, run = 0, changed = 0;
  for (let j = cj * 32; j < cj * 32 + 32; j++) for (let k = ck * 32; k < ck * 32 + 32; k++) for (let i = ci * 32; i < ci * 32 + 32; i++) {
    if (!run) { if (p + 1 >= bytes.length) return changed; m = bytes[p]; run = bytes[p + 1] + 1; p += 2; }
    run--; if (data[i + NX * (k + NZ * j)] !== m && g.set(i, j, k, m)) changed++;
  }
  return changed;
}

// ---- incoming ------------------------------------------------------------------------
export function onOps(r) {
  const n = r.u16(), D = G.destruct;
  for (let i = 0; i < n; i++) {
    const o = r.u8(), fx = r.u8(), seed = r.u32();
    if (o === BURN) { const nq = r.u16(); _args.length = nq * 4; for (let q = 0; q < nq * 4; q += 4) { _args[q] = r.u16(); _args[q + 1] = r.u8(); _args[q + 2] = r.u16(); _args[q + 3] = r.u8(); } }
    else { const na = r.u8(); _args.length = na; for (let q = 0; q < na; q++) _args[q] = r.f64(); }
    if (N.status !== 'playing' || !D) continue;
    const op = OPS[o], a = _args;
    N.stats.opsIn++;
    applying = true;
    try {
      if (D.applyRemote) D.applyRemote(op, a, seed);
      else if (op === 'explode') D.explode(a[0], a[1], a[2], a[3], a[4]);          // FALLBACK (baseline DESTRUCT)
      else if (op === 'carveBox') D.carveBox(a[0], a[1], a[2], a[3], a[4], a[5], a[6], !!a[7]);
    } catch (e) { if (G.debug) console.warn('net op', op, e); }
    applying = false;
    if (fx && op === 'explode') bus.emit('explosion', { x: a[0], y: a[1], z: a[2], radius: a[3], power: a[4], kind: KINDS[fx - 1] || 'rocket', owner: entById(a[5]), remote: true });
  }
}
export function onFires(r, len) { const D = G.destruct; if (N.isHost || N.status !== 'playing' || !D || !D.applyFires) return; const b = r.bytes(len); N.stats.firesIn++; safe(() => D.applyFires(b)); }
export function onChk(r) {                // client: compare the host's hashes with ours
  if (N.isHost || N.status !== 'playing') return;
  const n = r.u8(), now = N.time;
  for (let i = 0; i < n; i++) {
    const c = r.u16(), h = r.u32(); if (c >= NCH) continue;
    N.stats.chkIn++;
    if (chunkHash(c) === h) { mmT[c] = -1; want.delete(c); miss.delete(c); asked.delete(c); continue; }
    if (asked.has(c)) {                    // the answer to our recheck: only a chunk that has settled on the host is worth fetching
      asked.delete(c);
      if (h === hostHash[c]) { want.add(c); continue; }
      hostHash[c] = h; mmT[c] = now; miss.add(c); continue;
    }
    hostHash[c] = h;
    if (mmT[c] < 0 || want.has(c)) { if (mmT[c] < 0) mmT[c] = now; if (!want.has(c)) miss.add(c); }
  }
}
export function onReq(from, r) {         // host: chunk requests; bit 15 = "hash it again for me" (answered in the next checksum message)
  const n = r.u8();
  for (let i = 0; i < n; i++) { const v = r.u16(), c = v & 0x7fff; if (c >= NCH) continue; if (v & 0x8000) { if (hot.length < 200 && hot.indexOf(c) < 0) hot.push(c); } else if (serve.length < 400) serve.push(from, c); }
}
export function onChunk(r, len) {
  const c = r.u16(), h = r.u32(), bytes = r.bytes(len - 6);
  if (N.status !== 'playing' || c >= NCH) return;
  const ch = safe(() => applyChunk(c, bytes)) || 0;
  mmT[c] = -1; want.delete(c); miss.delete(c); asked.delete(c);
  N.stats.healed++; N.stats.healedVoxels += ch; N.stats.healBytes += bytes.length;
  if (ch) bus.emit('net:heal', { chunk: c, voxels: ch, ok: chunkHash(c) === h });
}

// ---- outgoing --------------------------------------------------------------------------
function dist2(c) {                       // squared distance (in chunks) from a chunk to the local player
  const e = G.state.player.ent, p = e ? e.pos : G.camera.position;
  const dx = (c % CX) - p.x / 16, dz = (((c / CX) | 0) % CZ) - p.z / 16, dy = ((c / (CX * CZ)) | 0) - p.y / 16;
  return dx * dx + dy * dy + dz * dz;
}
export function late(dt) {
  // ops tapped this frame
  if (pending.length) {
    const w = N.out(0); w.begin(T.OPS); w.u16(pending.length);
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i], a = p.a;
      w.u8(p.o); w.u8(p.fx); w.u32(p.s);
      if (p.o === BURN) { const nq = Math.min(65535, a.length >> 2); w.u16(nq); for (let q = 0; q < nq * 4; q += 4) { w.u16(a[q]); w.u8(a[q + 1]); w.u16(a[q + 2]); w.u8(a[q + 3]); } continue; }   // [i,j,k,mat]… as 6 bytes each
      w.u8(a.length);
      for (let q = 0; q < a.length; q++) w.f64(+a[q] || 0);
    }
    w.end(); pending.length = 0;
  }
  const real = dt > 0 ? dt : N.idleDt;
  if (N.isHost) {
    // fire is the host's: the burning cells go out 4 times a second while anything burns, and once more when it is out
    const F = G.destruct;
    if (F && F.serializeFires && N.peers.size && (fireT -= real) <= 0) {
      fireT = 0.25;
      const live = ((F.fires && F.fires.count) | 0) + ((F.jets && F.jets.count) | 0) > 0;
      if (live || fireLive) { const b = safe(() => F.serializeFires()); if (b) { const w = N.out(0); w.begin(T.FIRES); w.bytes(b); w.end(); N.stats.firesOut++; N.stats.fireBytes += b.length + 3; } }
      fireLive = live;
    }
    // serve chunk requests, a couple per frame
    for (let n = 0; n < 2 && serve.length; n++) {
      const to = serve.shift(), c = serve.shift();
      if (!N.peers.has(to)) continue;
      const bytes = safe(() => encodeChunk(c)); if (!bytes) continue;
      const w = N.out(to); w.begin(T.CHUNK); w.u16(c); w.u32(chunkHash(c)); w.bytes(bytes); w.end();
      N.stats.chunksOut++;
    }
    if (N.peers.size && (chkT -= real) <= 0) {
      chkT = CHK_DT;
      const w = N.out(0); w.begin(T.CHK); const at = w.o; w.u8(0); let n = 0;
      const put = (c) => { w.u16(c); w.u32(chunkHash(c)); n++; };
      while (hot.length && n < CHK_RECENT + CHK_SWEEP + 8) put(hot.shift());
      const D = G.destruct, rc = D && D.recentChunks ? safe(() => D.recentChunks(6)) : null;
      if (rc && rc.length) for (let i = 0; i < CHK_RECENT && i < rc.length && n < CHK_RECENT + CHK_SWEEP; i++) { recentI = (recentI + 1) % rc.length; put(rc[recentI]); }
      for (let i = 0; i < CHK_SWEEP; i++) { put(sweep); sweep = (sweep + 1) % NCH; }
      w.buf[at] = n; w.end();
      N.stats.chkOut += n;
    }
  } else if ((want.size || miss.size) && (reqT -= real) <= 0) {
    reqT = CHK_DT;
    const now = N.time; let sent = 0;
    // a mismatch that outlives the ops still in flight is real (our copy may also have caught up by itself)
    const w = N.out(255); w.begin(T.CHREQ); const at = w.o; w.u8(0);
    for (const c of miss) if (now - mmT[c] >= MISMATCH_AGE && sent < 12) { miss.delete(c); if (chunkHash(c) === hostHash[c]) mmT[c] = -1; else { asked.add(c); w.u16(c | 0x8000); sent++; } }
    const cap = sent + REQ_PER_TICK;
    while (sent < cap) {                     // nearest first
      let best = -1, bd = 1e9;
      for (const c of want) { if (now - reqAt[c] < REQ_GAP) continue; const d = dist2(c); if (d < bd) { bd = d; best = c; } }
      if (best < 0) break;
      reqAt[best] = now; w.u16(best); sent++; N.stats.chunkReqs++;
    }
    w.buf[at] = sent; w.end();
  }
}
export const dbg = { chunkHash, want, pending };
