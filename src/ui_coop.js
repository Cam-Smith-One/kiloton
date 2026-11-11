// KILOTON — ui_coop.js   OWNER: UI. Co-op lobby (title → CO-OP). Talks only to the G.net surface from CONTRACT-D:
// status, error, room, id, isHost, peers, available(), create(name), join(code, name), leave(), start({mode}).
// `getNet()` returns G.net (or the fake one in ?ui=lobby), so nothing here depends on the real transport.
import { G, bus, input } from './core.js';

const LS_NAME = 'kiloton.name';
const lsGet = k => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) {} };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cleanName = s => String(s || '').replace(/[^\w \-.']/g, '').trim().slice(0, 14);
const cleanCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);

// Name of the rig a peer has selected: NET may expose it in a few places; fall back to a dash.
export function peerRig(p) {
  if (!p) return '';
  const st = p.state || {}, lo = p.loadout || p.lo || st.loadout;
  const ch = p.chassis || st.chassis || (lo && lo.chassis), C = G.rigs && G.rigs.CHASSIS;
  return p.rig || p.rigName || st.rig || st.loadoutName || (lo && lo.name) || (ch && C && C[ch] ? C[ch].name : '') || '';
}

function lobbyHTML() {
  return `
<div class="ku-scr ku-lobby" data-k="lobby" hidden>
  <div class="ku-b-p ku-l-p" role="dialog" aria-label="Co-op lobby">
    <header class="ku-b-h"><div><small>Halden Yard / relay</small><h2>Co-op</h2></div><button type="button" class="ku-btn" data-l="back"><span>Back</span><kbd>Esc</kbd></button></header>
    <div class="ku-b-body">
      <p class="ku-l-lead">Two to four pilots, one city. Survival or Operation Blackout.</p>
      <div class="ku-l-sec" data-l="unavail" hidden>
        <h3>Co-op needs the web version</h3>
        <p class="ku-l-txt">This frame cannot open a connection to the relay. Open the game as a normal page to play together:</p>
        <p class="ku-l-txt"><a data-l="link" target="_blank" rel="noopener noreferrer"></a></p>
        <p class="ku-l-txt">Single player works right here. Press Back.</p>
      </div>
      <div class="ku-l-sec" data-l="check" hidden><p class="ku-l-txt ku-l-wait">Checking the relay</p></div>
      <div class="ku-l-sec" data-l="entry" hidden>
        <label class="ku-b-name ku-l-name"><span>Pilot name</span><input type="text" data-l="name" maxlength="14" spellcheck="false" autocomplete="off"></label>
        <h3>Host</h3>
        <button type="button" class="ku-btn pri" data-l="create"><span>Create game</span></button>
        <h3>Join</h3>
        <div class="ku-l-join"><input type="text" data-l="code" maxlength="4" spellcheck="false" autocomplete="off" placeholder="CODE" aria-label="Room code"><button type="button" class="ku-btn" data-l="join">Join</button></div>
        <p class="ku-l-err" data-l="err" role="alert"></p>
      </div>
      <div class="ku-l-sec" data-l="room" hidden>
        <h3>Room code</h3>
        <div class="ku-l-code"><b data-l="roomCode"></b><button type="button" class="ku-btn" data-l="copy">Copy</button></div>
        <p class="ku-l-txt">Give this code to your squad. They choose Co-op, type it and press Join.</p>
        <h3>Pilots <em data-l="count"></em></h3>
        <div class="ku-l-list" data-l="list"></div>
        <div data-l="hostBox">
          <h3>Mission</h3>
          <div class="ku-l-modes" role="radiogroup" aria-label="Mode"><button type="button" class="ku-mode" role="radio" data-lmode="survival"><b>Survival</b><span>Endless waves, scaled to the squad.</span></button><button type="button" class="ku-mode" role="radio" data-lmode="operation"><b>Operation Blackout</b><span>Four stages and the Dreadnought.</span></button></div>
        </div>
        <p class="ku-l-txt ku-l-wait" data-l="waitHost" hidden>Waiting for host</p>
        <p class="ku-l-err" data-l="err2" role="alert"></p>
      </div>
    </div>
    <footer class="ku-b-f" data-l="foot" hidden><div class="ku-b-btns"><button type="button" class="ku-btn pri" data-l="start"><span>Start</span></button><button type="button" class="ku-btn" data-l="leave">Leave</button><span class="ku-b-saved" data-l="stat"></span></div></footer>
  </div>
</div>`;
}

export function createLobby(root, opts) {
  root.insertAdjacentHTML('beforeend', lobbyHTML());
  const el = root.querySelector('[data-k="lobby"]'), L = {};
  for (const n of el.querySelectorAll('[data-l]')) L[n.dataset.l] = n;
  const modeBtns = [...el.querySelectorAll('[data-lmode]')];
  const net = () => (opts.getNet && opts.getNet()) || G.net || {};
  const play = n => { if (opts.play) opts.play(n); };
  let isOpen = false, avail = null, mode = G.state.mode || 'survival', localErr = '', busy = false, copyT = 0, sig = '';
  L.name.value = cleanName(lsGet(LS_NAME)) || 'Pilot';
  L.link.href = G.WEB_URL || '#'; L.link.textContent = (G.WEB_URL || '').replace(/^https?:\/\//, '') || 'web version';
  const name = () => { const n = cleanName(L.name.value) || 'Pilot'; lsSet(LS_NAME, n); return n; };

  function render() {
    const N = net(), st = N.status || 'offline', inRoom = st === 'lobby' || (st === 'playing' && !!N.room);
    const err = localErr || (st === 'error' || (N.error && st !== 'lobby') ? String(N.error || 'Connection failed') : '');
    L.unavail.hidden = avail !== false; L.check.hidden = avail !== null;
    L.entry.hidden = avail !== true || inRoom; L.room.hidden = avail !== true || !inRoom; L.foot.hidden = L.room.hidden;
    const connecting = st === 'connecting' || busy;
    L.create.disabled = connecting; L.join.disabled = connecting;
    L.create.firstElementChild.textContent = connecting ? 'Connecting' : 'Create game';
    L.err.textContent = inRoom ? '' : err; L.err2.textContent = inRoom ? (localErr || (N.error ? String(N.error) : '')) : '';
    if (!inRoom) return;
    L.roomCode.textContent = N.room || '----';
    // roster: local player first (unless NET already lists it), then peers
    const rows = [], me = N.id, peers = N.peers && N.peers.values ? [...N.peers.values()] : [];
    const bayLo = G.rigs && G.rigs.bay ? G.rigs.bay.current : null;
    if (!peers.some(p => p.id === me)) rows.push({ id: me, name: name(), you: true, host: !!N.isHost, rig: bayLo ? bayLo.name : '' });
    for (const p of peers) rows.push({ id: p.id, name: p.name || 'Pilot ' + p.id, you: p.id === me, host: N.hostId != null ? p.id === N.hostId : (p.host || (p.id === me && N.isHost)), rig: p.id === me && bayLo ? bayLo.name : peerRig(p), ready: p.ready });
    let h = '';
    for (let i = 0; i < 4; i++) {
      const r = rows[i];
      h += r ? `<div class="ku-l-row${r.you ? ' you' : ''}"><i>${i + 1}</i><b>${esc(r.name)}</b>${r.host ? '<em class="host">Host</em>' : ''}${r.you ? '<em>You</em>' : ''}<span>${esc(r.rig || '–')}</span></div>`
        : `<div class="ku-l-row empty"><i>${i + 1}</i><b>Open slot</b></div>`;
    }
    const s2 = h + '|' + N.isHost + mode; if (s2 !== sig) { sig = s2; L.list.innerHTML = h; }
    L.count.textContent = rows.length + ' / 4';
    L.hostBox.hidden = !N.isHost; L.waitHost.hidden = !!N.isHost; L.start.hidden = !N.isHost;
    for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.lmode === mode));
    L.stat.textContent = (N.isHost ? 'You host' : 'Joined') + (N.ping ? ' · ' + Math.round(N.ping) + ' ms' : '');
    L.start.firstElementChild.textContent = mode === 'operation' ? 'Start operation' : 'Start survival';
  }
  async function check() {
    avail = null; render();
    let ok = false; try { ok = !!(await net().available()); } catch (e) { ok = false; }
    avail = ok; render();
  }
  function open() { if (isOpen) return; isOpen = true; el.hidden = false; localErr = ''; busy = false; mode = G.state.mode || mode; check(); }
  function close(keepRoom) {
    if (!isOpen) return; isOpen = false; el.hidden = true;
    if (!keepRoom) { const N = net(); try { if (N.status && N.status !== 'offline' && N.leave) N.leave(); } catch (e) {} }
    if (opts.onClose) opts.onClose();
  }
  const call = async (fn) => { localErr = ''; busy = true; render(); try { await fn(); } catch (e) { localErr = String((e && e.message) || e || 'Connection failed'); } busy = false; render(); };
  function doCreate() { play('ui_click'); return call(() => net().create(name())); }
  function doJoin() {
    const code = cleanCode(L.code.value); L.code.value = code;
    if (code.length < 4) { localErr = 'Room codes are four characters.'; play('ui_back'); render(); try { L.code.focus(); } catch (e) {} return; }
    play('ui_click'); return call(() => net().join(code, name()));
  }
  function doStart() {
    const N = net(); if (!N.isHost) return;
    // host's click is the gesture: capture the mouse and wake audio before the run begins
    input.lock(); try { if (G.audio && G.audio.unlock) G.audio.unlock(); } catch (e) {}
    G.state.mode = mode; play('ui_click');
    try { N.start({ mode }); } catch (e) { localErr = String((e && e.message) || e); render(); }
  }
  function doCopy() {
    const code = net().room || ''; let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(code).catch(() => {}); ok = true; } } catch (e) {}
    if (!ok) try { const t = document.createElement('textarea'); t.value = code; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); ok = document.execCommand('copy'); t.remove(); } catch (e) {}
    L.copy.textContent = ok ? 'Copied' : 'Select it'; clearTimeout(copyT); copyT = setTimeout(() => { L.copy.textContent = 'Copy'; }, 1600); play('ui_click');
  }
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const k = b.dataset.l;
    if (k === 'back') close(); else if (k === 'create') doCreate(); else if (k === 'join') doJoin(); else if (k === 'start') doStart();
    else if (k === 'leave') { play('ui_back'); try { net().leave(); } catch (er) {} localErr = ''; render(); }
    else if (k === 'copy') doCopy();
    else if (b.dataset.lmode) { mode = b.dataset.lmode; G.state.mode = mode; play('ui_click'); render(); }
  });
  L.code.addEventListener('input', () => { const c = cleanCode(L.code.value); if (c !== L.code.value) L.code.value = c; if (localErr) { localErr = ''; render(); } });
  L.name.addEventListener('change', name);
  for (const t of ['net:status', 'net:peer+', 'net:peer-']) bus.on(t, () => { if (isOpen) render(); });
  bus.on('net:closed', (d) => { if (isOpen) { localErr = d && d.reason && d.reason !== 'left' ? String(d.reason) : d && d.reason === 'left' ? '' : 'The host closed the room.'; render(); } });
  bus.on('bay:changed', () => { if (isOpen) { sig = ''; render(); } });

  // Keyboard, called from ui.js (core swallows Space / arrows, so text fields are handled by hand). Returns true if used.
  function key(code, a) {
    if (!isOpen) return false;
    if (code === 'Escape') { close(); return true; }
    const text = a === L.name || a === L.code;
    if (text) {
      if (code === 'Enter' || code === 'NumpadEnter') { if (a === L.code) doJoin(); else a.blur(); return true; }
      if (code === 'Space') { if (a === L.name) try { a.setRangeText(' ', a.selectionStart, a.selectionEnd, 'end'); } catch (e) {} return true; }
      if (code === 'ArrowLeft' || code === 'ArrowRight') { try { const p = Math.max(0, Math.min(a.value.length, a.selectionStart + (code === 'ArrowLeft' ? -1 : 1))); a.setSelectionRange(p, p); } catch (e) {} return true; }
      return code !== 'Tab' && code !== 'ArrowUp' && code !== 'ArrowDown';
    }
    if (a && a.dataset && a.dataset.lmode && (code === 'ArrowLeft' || code === 'ArrowRight')) { const n = modeBtns[(modeBtns.indexOf(a) + 1) % 2]; n.focus(); n.click(); return true; }
    return false;
  }
  return { el, L, open, close, key, render, check, get isOpen() { return isOpen; }, get mode() { return mode; } };
}
