// KILOTON relay server (Bun). Rooms of up to 4 players; the first player in a room is the host and runs the
// simulation; the server only relays messages. No game state is stored here.
//   text frames  : JSON control  {t:'create',name} | {t:'join',code,name} | {t:'d',to,d} | {t:'ping'}
//   binary frames: byte 0 = target (0 = everyone else, 255 = host, n = peer id); relayed with byte 0 = sender id
const MAX_PEERS = 4, MAX_ROOMS = 300, MAX_MSG = 256 * 1024, RATE = 240;      // msgs per second per socket
type Sock = { id: number; room: string | null; name: string; n: number; t: number };
const rooms = new Map<string, { host: number; peers: Map<number, any>; next: number; made: number }>();
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = () => { let c = ''; do { c = ''; for (let i = 0; i < 4; i++) c += ALPHA[Math.floor(Math.random() * ALPHA.length)]; } while (rooms.has(c)); return c; };
const send = (ws: any, o: unknown) => { try { ws.send(JSON.stringify(o)); } catch {} };
const clean = (s: unknown) => String(s ?? 'Pilot').replace(/[^\w \-]/g, '').slice(0, 16) || 'Pilot';
function leave(ws: any) {
  const d: Sock = ws.data; if (!d.room) return;
  const rc = d.room, r = rooms.get(rc); d.room = null; if (!r) return;
  r.peers.delete(d.id);
  if (d.id === r.host || r.peers.size === 0) { for (const p of r.peers.values()) { send(p, { t: 'closed', reason: 'host left' }); p.data.room = null; } rooms.delete(rc); }
  else for (const p of r.peers.values()) send(p, { t: 'peer-', id: d.id });
}
const ORIGIN_OK = (o: string | null) => !o || o === 'null' || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || /^https:\/\/([a-z0-9-]+\.)*assembll\.xyz$/.test(o) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(o) || /^https:\/\/([a-z0-9-]+\.)*claude(usercontent)?\.(ai|com)$/.test(o);
Bun.serve({
  port: 8080,
  fetch(req, server) {
    const u = new URL(req.url);
    if (u.pathname === '/health') return new Response('ok');
    if (u.pathname === '/stats') return Response.json({ rooms: rooms.size, players: [...rooms.values()].reduce((a, r) => a + r.peers.size, 0) });
    if (u.pathname === '/ws') {
      if (!ORIGIN_OK(req.headers.get('origin'))) return new Response('forbidden', { status: 403 });
      if (server.upgrade(req, { data: { id: 0, room: null, name: 'Pilot', n: 0, t: 0 } })) return;
      return new Response('expected websocket', { status: 400 });
    }
    return new Response('Kiloton relay');
  },
  websocket: {
    maxPayloadLength: MAX_MSG, idleTimeout: 120,
    message(ws: any, msg: string | Buffer) {
      const d: Sock = ws.data, now = Date.now();
      if (now - d.t > 1000) { d.t = now; d.n = 0; }
      if (++d.n > RATE) return;
      const r = d.room ? rooms.get(d.room) : null;
      if (typeof msg !== 'string') {                       // binary relay
        if (!r || msg.length < 1) return;
        const to = msg[0]; msg[0] = d.id;
        if (to === 0) { for (const [id, p] of r.peers) if (id !== d.id) p.send(msg); }
        else { const p = r.peers.get(to === 255 ? r.host : to); if (p && p !== ws) p.send(msg); }
        return;
      }
      let m: any; try { m = JSON.parse(msg); } catch { return; }
      if (m.t === 'ping') return send(ws, { t: 'pong', s: m.s });
      if (m.t === 'create') {
        if (d.room) leave(ws);
        if (rooms.size >= MAX_ROOMS) return send(ws, { t: 'error', error: 'Server is full. Try again shortly.' });
        const c = code(); d.id = 1; d.room = c; d.name = clean(m.name);
        rooms.set(c, { host: 1, peers: new Map([[1, ws]]), next: 2, made: now });
        return send(ws, { t: 'room', code: c, id: 1, host: true, hostId: 1, peers: [] });
      }
      if (m.t === 'join') {
        if (d.room) leave(ws);
        const c = String(m.code || '').toUpperCase().slice(0, 4), room = rooms.get(c);
        if (!room) return send(ws, { t: 'error', error: 'No game with that code.' });
        if (room.peers.size >= MAX_PEERS) return send(ws, { t: 'error', error: 'That game is full.' });
        d.id = room.next++; d.room = c; d.name = clean(m.name);
        const peers = [...room.peers.values()].map((p: any) => ({ id: p.data.id, name: p.data.name }));
        for (const p of room.peers.values()) send(p, { t: 'peer+', id: d.id, name: d.name });
        room.peers.set(d.id, ws);
        return send(ws, { t: 'room', code: c, id: d.id, host: false, hostId: room.host, peers });
      }
      if (m.t === 'leave') return leave(ws);
      if (m.t === 'd' && r) {
        const out = JSON.stringify({ t: 'd', from: d.id, d: m.d });
        if (!m.to) { for (const [id, p] of r.peers) if (id !== d.id) p.send(out); }
        else { const p = r.peers.get(m.to === 'h' ? r.host : m.to); if (p && p !== ws) p.send(out); }
      }
    },
    close(ws: any) { leave(ws); },
  },
});
console.log('kiloton relay on :8080');
