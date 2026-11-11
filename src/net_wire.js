// ============================================================================
// KILOTON — net_wire.js   OWNER: NET
// Compact binary writer / reader and the quantisers shared by every message.
// A frame on the wire is:  [target u8] ( [type u8] [len u16] [payload] )*
// ============================================================================
const TAU = 6.283185307179586;
const te = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
const td = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

// message types (binary sub-messages)
export const T = { PSTATE: 1, SHOT: 2, ESNAP: 3, OPS: 4, CHK: 5, CHREQ: 6, CHUNK: 7, CLAIM: 8, PING: 9, PONG: 10, EDEATH: 11, WAVE: 12, BEAM: 13, FIRES: 14 };

export class Writer {
  constructor(cap = 2048) { this.buf = new Uint8Array(cap); this.dv = new DataView(this.buf.buffer); this.o = 0; this.mark = 0; }
  need(n) { if (this.o + n <= this.buf.length) return; const b = new Uint8Array(Math.max(this.buf.length * 2, this.o + n + 256)); b.set(this.buf.subarray(0, this.o)); this.buf = b; this.dv = new DataView(b.buffer); }
  reset() { this.o = 0; return this; }
  u8(v) { this.need(1); this.dv.setUint8(this.o, v); this.o += 1; return this; }
  i8(v) { this.need(1); this.dv.setInt8(this.o, v < -127 ? -127 : v > 127 ? 127 : Math.round(v)); this.o += 1; return this; }
  u16(v) { this.need(2); this.dv.setUint16(this.o, v, true); this.o += 2; return this; }
  i16(v) { this.need(2); this.dv.setInt16(this.o, v < -32767 ? -32767 : v > 32767 ? 32767 : Math.round(v), true); this.o += 2; return this; }
  u32(v) { this.need(4); this.dv.setUint32(this.o, v >>> 0, true); this.o += 4; return this; }
  f32(v) { this.need(4); this.dv.setFloat32(this.o, v, true); this.o += 4; return this; }
  f64(v) { this.need(8); this.dv.setFloat64(this.o, v, true); this.o += 8; return this; }
  // quantised
  px(v) { return this.u16(q16((v + 32) * 256)); }             // x / z: -32 .. 224 m, 4 mm
  py(v) { return this.u16(q16((v + 16) * 128)); }             // y: -16 .. 496 m, 8 mm
  pos(x, y, z) { this.px(x); this.py(y); return this.px(z); }
  ang(a) { return this.u16(((Math.round(a / TAU * 65536) % 65536) + 65536) % 65536); }
  unit(v) { return this.u8(v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255)); }
  dir(x, y, z) { this.i16(x * 32767); this.i16(y * 32767); return this.i16(z * 32767); }
  str(s) { s = String(s == null ? '' : s); const b = te ? te.encode(s) : Uint8Array.from(s, c => c.charCodeAt(0) & 255); const n = Math.min(255, b.length); this.u8(n); this.need(n); this.buf.set(b.subarray(0, n), this.o); this.o += n; return this; }
  id(v) { if (typeof v === 'string') { this.u16(0xEFFF); return this.str(v); } return this.u16(v || 0); }   // net id: u16, or 0xEFFF + string (mission props 'm:relay')
  bytes(b) { this.need(b.length); this.buf.set(b, this.o); this.o += b.length; return this; }
  // sub-message framing: begin(type) ... end()
  begin(type) { this.u8(type); this.mark = this.o; this.u16(0); return this; }
  end() { this.dv.setUint16(this.mark, this.o - this.mark - 2, true); return this; }
  view() { return this.buf.subarray(0, this.o); }
}
const q16 = v => v < 0 ? 0 : v > 65535 ? 65535 : Math.round(v);

export class Reader {
  constructor() { this.buf = null; this.dv = null; this.o = 0; this.end = 0; }
  set(buf, o = 0, len) { this.buf = buf; this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength); this.o = o; this.end = len == null ? buf.length : o + len; return this; }
  get left() { return this.end - this.o; }
  u8() { const v = this.dv.getUint8(this.o); this.o += 1; return v; }
  i8() { const v = this.dv.getInt8(this.o); this.o += 1; return v; }
  u16() { const v = this.dv.getUint16(this.o, true); this.o += 2; return v; }
  i16() { const v = this.dv.getInt16(this.o, true); this.o += 2; return v; }
  u32() { const v = this.dv.getUint32(this.o, true); this.o += 4; return v; }
  f32() { const v = this.dv.getFloat32(this.o, true); this.o += 4; return v; }
  f64() { const v = this.dv.getFloat64(this.o, true); this.o += 8; return v; }
  px() { return this.u16() / 256 - 32; }
  py() { return this.u16() / 128 - 16; }
  ang() { return this.u16() / 65536 * TAU; }
  unit() { return this.u8() / 255; }
  dirc() { return this.i16() / 32767; }
  str() { const n = this.u8(), b = this.buf.subarray(this.o, this.o + n); this.o += n; return td ? td.decode(b) : String.fromCharCode.apply(null, b); }
  id() { const v = this.u16(); return v === 0xEFFF ? this.str() : v; }
  bytes(n) { const b = this.buf.subarray(this.o, this.o + n); this.o += n; return b; }
}

// Maps a remote sender's time stamps onto the local clock (min-filtered arrival offset with slow upward drift).
export class StreamClock {
  constructor() { this.off = null; }
  sample(stamp, now) { const e = now - stamp; if (this.off == null || e < this.off) this.off = e; else this.off += (e - this.off) * 0.02; }
  // sender time that should be on screen now, `delay` seconds in the past
  playout(now, delay) { return this.off == null ? 0 : now - this.off - delay; }
  reset() { this.off = null; }
}
