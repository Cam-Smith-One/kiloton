// ============================================================================
// KILOTON — ui.js   OWNER: UI.   G.ui: title screen, HUD, pause / settings, debrief.
// DOM + CSS + inline SVG + one 2D canvas (radar) inside #kt-ui. See notes/ui.md.
//   ui.js       module, screens, settings, phase glue        ui_hud.js   the in-game instrument cluster
//   ui_css.js   stylesheet                                   ui_demo.js  fake state for ?ui=title|hud|rig|pause|over
// ============================================================================
import { G, bus, input } from './core.js';
import { CSS, FONT_URL } from './ui_css.js';
import { createHud } from './ui_hud.js';
import { createDemo } from './ui_demo.js';
import { createBay } from './ui_bay.js';
import { createLobby } from './ui_coop.js';

const LS_MODE = 'kiloton.mode', LS_SET = 'kiloton.settings', LS_BEST = 'kiloton.best', LS_TIPS = 'kiloton.tips';
const lsGet = k => { try { return window.localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, v); } catch (e) { /* sandboxed: settings last for the session only */ } };
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmt = n => Math.round(n || 0).toLocaleString('en-US');
const clampN = (v, a, b, d) => (typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : d);

// ---- wordmark: our own block letters, sheared along a fault line, shedding voxels ------------------------------
function logoSVG() {
  const K = 'M0 0H22V100H0Z M22 38L50 0H78L42 48L78 100H51L22 60Z', I = 'M0 0H22V100H0Z', Lt = 'M0 0H22V78H62V100H0Z';
  const O = 'M14 0H58L72 14V86L58 100H14L0 86V14Z M22 22V78H50V22Z', Tt = 'M0 0H72V22H47V100H25V22H0Z', N = 'M0 0H24L50 56V0H72V100H48L22 44V100H0Z';
  const xs = [[K, 0], [I, 92], [Lt, 128], [O, 204], [Tt, 290], [O, 376], [N, 462]];
  let g = '';
  for (const [d, x] of xs) g += `<path transform="translate(${x} 0)" fill-rule="evenodd" d="${d}"/>`;
  return `<svg viewBox="-2 -14 584 118" role="img" aria-label="Kiloton">
    <defs><clipPath id="ku-ca"><path d="M-4 -20H560V50L-4 60Z"/></clipPath><clipPath id="ku-cb"><path d="M-10 65L560 55V104H-10Z"/></clipPath></defs>
    <g class="lt" clip-path="url(#ku-ca)">${g}</g>
    <g class="lt" clip-path="url(#ku-cb)"><g transform="translate(-6 0)">${g}</g></g>
    <rect class="vx" x="543" y="38" width="13" height="13"/><rect class="vx2" x="562" y="22" width="9" height="9"/><rect class="vx" x="556" y="2" width="6" height="6"/><rect class="vx2" x="574" y="-10" width="5" height="5"/>
  </svg>`;
}
const REF = {
  Pilot: [['WASD', 'Move'], ['Shift', 'Sprint'], ['Space', 'Jump <small>/ jetpack / mantle</small>'], ['C', 'Crouch <small>/ slide</small>'], ['X', 'Combat roll'], ['LMB', 'Rifle'], ['RMB', 'Launcher'], ['Q', 'Seeker AA <small>hold, release</small>'], ['R', 'Reload'], ['1-3', 'Pick loadout'], ['V', 'Call rig drop'], ['E', 'Board <small>/ plant charge</small>']],
  Rig: [['WASD', 'Move'], ['Shift', 'Dash <small>/ air dash</small>'], ['Space', 'Jump jets <small>hold</small>'], ['C', 'Slam <small>/ brace</small>'], ['LMB', 'Arm weapons'], ['RMB', 'Shoulder group'], ['Q', 'Lock group <small>hold, release</small>'], ['G', 'Equipment <small>T = right arm</small>'], ['F', 'Punch <small>/ bash / tear</small>'], ['E', 'Grab <small>/ throw</small>'], ['X', 'Eject <small>hold</small>']],
};
function refHTML() {
  let s = '<div class="ku-ref">';
  for (const k in REF) { s += `<section><h3>${k}</h3><dl>`; for (const r of REF[k]) s += `<dt><kbd>${r[0]}</kbd></dt><dd>${r[1]}</dd>`; s += '</dl></section>'; }
  return s + '</div>';
}
const range = (key, label, min, max, step) => `<label class="ku-row"><span>${label}</span><input type="range" data-set="${key}" min="${min}" max="${max}" step="${step}"><output></output></label>`;
function menusHTML() {
  return `
<div class="ku-scr ku-title" data-k="title" hidden>
  <div class="ku-t-scrim"></div>
  <div class="ku-t-top"><span>Halden Yard</span><i>/</i><span>Vanta incursion</span><i>/</i><span>Wave survival</span><span>Mouse + keyboard</span></div>
  <div class="ku-t-main">
    <h1 class="ku-logo">${logoSVG()}</h1>
    <p class="ku-pitch">Call down your rig. Bring down the city. <em>Outlast Vanta.</em></p>
    <div class="ku-modes" role="radiogroup" aria-label="Mode" data-k="modes">
      <button type="button" class="ku-mode" role="radio" data-mode="survival"><b>Survival</b><span>Endless Vanta waves. Take a field perk after each one.</span></button>
      <button type="button" class="ku-mode" role="radio" data-mode="operation"><b>Operation Blackout</b><span>Four stages: cut the signal, hold the relay, breach the citadel, kill the Dreadnought.</span></button>
    </div>
    <div class="ku-t-row">
      <button type="button" class="ku-btn pri big" data-k="start"><span>Start run</span><kbd>Enter</kbd></button>
      <button type="button" class="ku-btn big sec" data-k="tbay"><span>Rig bay</span><kbd>B</kbd></button>
      <button type="button" class="ku-btn big sec" data-k="tcoop"><span>Co-op</span></button>
      <div class="ku-best"><span>Best wave</span><b data-k="best">–</b></div>
      <div class="ku-best"><span>Salvage</span><b data-k="tsalv">0</b></div>
    </div>
    <p class="ku-note" data-k="tnote">Esc pauses. Settings live in the pause menu.</p>
    <p class="ku-credit">A game design by Cam Smith</p>
  </div>
  <div class="ku-t-ref">${refHTML()}</div>
</div>
<div class="ku-scr ku-pause" data-k="pause" hidden>
  <div class="ku-card" role="dialog" aria-modal="true" aria-label="Paused">
    <header><div><small>Halden Yard / hold</small><h2>Paused</h2></div>
      <div class="ku-acts"><button type="button" class="ku-btn pri" data-k="resume"><span>Resume</span><kbd>Esc</kbd></button><button type="button" class="ku-btn" data-k="pbay">Rig bay</button><button type="button" class="ku-btn" data-k="restart">Restart</button><button type="button" class="ku-btn" data-k="totitle">Title</button></div></header>
    <div class="ku-cols">
      <section><h3>Settings</h3>
        ${range('sens', 'Sensitivity', 0.2, 3, 0.05)}
        ${range('volume', 'Master volume', 0, 1, 0.01)}
        ${range('music', 'Music volume', 0, 1, 0.01)}
        ${range('shake', 'Camera shake', 0, 1.5, 0.05)}
        <div class="ku-row"><span>Quality</span><div class="ku-seg" role="group" aria-label="Quality" data-k="qual"><button type="button" data-q="low">Low</button><button type="button" data-q="med">Med</button><button type="button" data-q="high">High</button></div></div>
        <div class="ku-row"><span>Invert Y</span><button type="button" class="ku-sw" role="switch" aria-checked="false" aria-label="Invert Y" data-k="inv"><i></i><b>Off</b></button></div>
      </section>
      <section><h3>Controls</h3>${refHTML()}</section>
    </div>
    <p class="ku-note" data-k="pnote"></p>
  </div>
</div>
<div class="ku-scr ku-deploy" data-k="deploy" role="button" tabindex="0" aria-label="Deploy: click to take control" hidden>
  <div><small>Co-op / the run is live</small><b>Deploy</b><span>Click to take control</span><em><kbd>Esc</kbd>Menu</em></div>
</div>
<div class="ku-scr ku-over" data-k="over" hidden>
  <div class="ku-o-scrim"></div>
  <div class="ku-deb" role="dialog" aria-label="Debrief">
    <small data-k="oTag">Pilot down</small>
    <h2><span data-k="oH">Wave</span><b data-k="oWave">00</b><em data-k="oBest" hidden>New best</em></h2>
    <p class="ku-cause" data-k="oCause"></p>
    <dl class="ku-stats">
      <div><dt>Kills</dt><dd data-k="oKills">0</dd></div><div><dt>Score</dt><dd data-k="oScore">0</dd></div><div><dt>Time</dt><dd data-k="oTime">0:00</dd></div><div><dt>Salvage earned</dt><dd class="am" data-k="oSalv">0</dd></div>
      <div><dt>Rigs called</dt><dd data-k="oRigs">0</dd></div><div><dt>Voxels</dt><dd data-k="oVox">0</dd></div><div><dt>Buildings</dt><dd data-k="oBld">0</dd></div><div><dt>Perks</dt><dd data-k="oPerks">0</dd></div>
    </dl>
    <div class="ku-acts"><button type="button" class="ku-btn pri" data-k="retry"><span>Retry</span><kbd>Enter</kbd></button><button type="button" class="ku-btn" data-k="otitle">Title</button></div>
    <p class="ku-l-txt ku-l-wait" data-k="oWait" hidden>Waiting for host to restart</p>
  </div>
</div>`;
}
const CAUSE = {
  debris: 'Buried under falling masonry.', crush: 'Crushed.', fall: 'The fall did it.', explosion: 'Caught in the blast.', rocket: 'Caught in the blast.',
  bullet: 'Cut down by Vanta rifle fire.', pulse: 'Burned through by pulse fire.', melee: 'Flattened by a Vanta rig.', slam: 'Flattened by a Vanta rig.', shell: 'Shelled by Vanta armour.',
};
const TIPS = {
  pilot: ['[WASD] move, [Shift] sprint. [Space] jumps; again in the air fires the jetpack, into a ledge mantles it.',
    'Hold [C] to crouch behind cover; the tag by your health shows when you are covered. [C] while sprinting slides.',
    'Tap [X] for a combat roll. [C] or [X] just before landing rolls out of a long fall.',
    '[LMB] rifle, [RMB] launcher, [R] reload. Rockets open walls.',
    'Hold [Q] on aircraft to lock the Seeker, up to two targets, then release to fire.',
    'Kills fill the rig meter. [1] [2] [3] pick which Rig Bay loadout drops. Every wall in Halden Yard can come down.',
    'Close to a Vanta rig on foot? [E] climbs it and plants a charge.'],
  ready: ['Rig ready. Aim at open ground and press [V]. Whatever is under the drop gets flattened.'],
  land: ['The Warden is down and waiting. Reach it and press [E] to board.'],
  rig: ['[LMB] pulse cannons build heat: ease off before they lock out. [RMB] fires the rocket salvo.', 'Hold [Q] on aircraft to lock Skylance, up to four targets, then release to launch. [F] punches through walls.', 'Hold [Space] for the jump jets, [C] in the air slams down. [E] grabs rubble; [E] or [LMB] throws it.', '[G] works arm equipment: hold for the Aegis shield, tap for the grapple. [F] while hooked to a rig tears a limb.',
    'Chassis ability on [C]: Warden slams from the air, Bastion braces on the ground. Harrier dashes twice, in the air too.',
    'Armour does not repair. Hold [X] to eject before the reactor goes.'],
};

const ui = {
  name: 'ui',
  stats: { ms: 0, peak: 0 },
  hud: null, root: null, demo: null,

  init() {
    const S = G.state, set = S.settings, self = this;
    // ---- fonts + style + root ---------------------------------------------------------------------------------
    try {
      if (!document.querySelector('link[data-ku-font]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_URL; l.dataset.kuFont = '1'; document.head.appendChild(l);
      }
    } catch (e) {}
    const st = document.createElement('style'); st.textContent = CSS; G.uiRoot.appendChild(st);
    const root = this.root = document.createElement('div'); root.className = 'ku'; G.uiRoot.appendChild(root);

    // ---- settings: load, validate, apply ---------------------------------------------------------------------
    let stored = null; try { stored = JSON.parse(lsGet(LS_SET) || 'null'); } catch (e) {}
    if (stored && typeof stored === 'object') {
      set.sens = clampN(stored.sens, 0.2, 3, set.sens); set.volume = clampN(stored.volume, 0, 1, set.volume); set.music = clampN(stored.music, 0, 1, set.music);
      set.shake = clampN(stored.shake, 0, 1.5, set.shake); set.invertY = !!stored.invertY;
      if (['low', 'med', 'high'].includes(stored.quality)) set.quality = stored.quality;
    }
    if (['low', 'med', 'high'].includes(set.quality) && !G.params.get('q') && G.quality.tier !== set.quality && G.setQuality) G.setQuality(set.quality);
    const pushVolume = () => { try { if (G.audio && G.audio.setVolume) G.audio.setVolume(set.volume, set.music); } catch (e) {} };
    pushVolume();
    const save = () => lsSet(LS_SET, JSON.stringify(set));
    this.best = Math.max(parseInt(lsGet(LS_BEST), 10) || 0, 0);
    let tips = {}; try { tips = JSON.parse(lsGet(LS_TIPS) || '{}') || {}; } catch (e) { tips = {}; }
    if (G.params.has('tips')) tips = {};

    // ---- view (real state, or the fake one in ?ui= mode) ------------------------------------------------------
    const which = G.params.get('ui');
    const view = this.view = { state: S, ents: G.ents.list, projectiles: null, mission: null, net: null };
    const hud = this.hud = createHud(root, view);
    root.insertAdjacentHTML('beforeend', menusHTML());
    const D = this.D = {};
    for (const n of root.querySelectorAll('.ku-scr [data-k], .ku-scr[data-k]')) D[n.dataset.k] = n;
    if (which && ['title', 'hud', 'rig', 'pause', 'over', 'bay', 'objectives', 'perks', 'boss', 'won', 'lobby', 'coop'].includes(which)) {
      this.demo = createDemo(which, G.params.get('uis') || '', (type, data) => {
        if (type === 'demo:tip') hud.queueTips(TIPS.pilot); else if (hud.on[type]) hud.on[type](data);
      });
      this.demoWhich = which; this.demoPending = true;
      view.net = this.demo.net || null;
      if (which !== 'title' && which !== 'bay' && which !== 'lobby') { view.state = this.demo.state; view.ents = this.demo.ents; view.projectiles = this.demo.projectiles; view.mission = this.demo.mission; }
    }
    const demo = this.demo;

    // ---- HUD event wiring ------------------------------------------------------------------------------------
    for (const type in hud.on) bus.on(type, hud.on[type]);
    const tip = (key) => { if (tips[key] || demo) return; tips[key] = 1; lsSet(LS_TIPS, JSON.stringify(tips)); hud.queueTips(TIPS[key]); };
    bus.on('meter:ready', () => tip('ready'));
    bus.on('mech:land', d => { if (d && d.team === 0) tip('land'); });
    bus.on('mech:enter', () => tip('rig'));

    // ---- transitions (always from a click: pointer lock + audio need the gesture) ------------------------------
    const play = n => { try { if (G.audio && typeof G.audio.play === 'function') G.audio.play(n); } catch (e) {} };
    const sound = n => play(n === 'back' ? 'ui_back' : 'ui_click');      // direct calls only: AUDIO also maps bus 'ui:sound', emitting both would double up
    root.addEventListener('mouseover', e => {
      const b = e.target.closest && e.target.closest('button'); if (!b || b === self._hov) return;
      const from = e.relatedTarget; if (from && b.contains(from)) return;
      self._hov = b; play('ui_hover');
    });
    root.addEventListener('mouseout', e => { const b = e.target.closest && e.target.closest('button'); if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) self._hov = null; });
    const go = (evt) => {
      input.lock(); try { if (G.audio && G.audio.unlock) G.audio.unlock(); } catch (e) {}
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); G.canvas.focus({ preventScroll: true }); } catch (e) {}
      sound('confirm'); bus.emit(evt);
    };
    // Offline: back to the title. Online host: back to the lobby (net.js turns the title phase into "everyone to the lobby").
    // Online client: leave the room (net.js then sends this player to the title itself).
    const leave = () => {
      input.unlock(); sound('back'); self.soft = false;
      const N = netNow();
      if (N.online && !N.isHost) { try { if (N.leave) N.leave(); } catch (e) {} if (S.phase !== 'title') bus.emit('ui:title'); return; }
      bus.emit('ui:title');
    };
    // Which run-ending buttons exist depends on who you are online: clients only ever get "Leave game".
    const paintRoles = this.paintRoles = () => {
      const N = netNow(), on = !!N.online, host = on && !!N.isHost, client = on && !host;
      const tl = client ? 'Leave game' : host ? 'Back to lobby' : 'Title';
      if (!D.totitle.classList.contains('arm')) D.totitle.textContent = tl;
      D.otitle.textContent = tl;
      D.restart.hidden = client; D.pbay.hidden = on; D.retry.hidden = client; D.oWait.hidden = !client;
    };
    // ---- rig bay ---------------------------------------------------------------------------------------------------
    const bayUi = this.bay = createBay(root, { play, onClose: () => { screen(S.phase); try { (S.phase === 'paused' ? D.pbay : D.tbay).focus({ preventScroll: true }); } catch (e) {} } });
    let escGuard = false;
    // ---- co-op lobby ---------------------------------------------------------------------------------------------------
    const netNow = () => view.net || G.net || {};
    const online = () => !!netNow().online;
    const lobby = this.lobby = createLobby(root, { play, getNet: () => view.net || G.net, onClose: () => { screen(S.phase); try { D.tcoop.focus({ preventScroll: true }); } catch (e) {} } });
    const openLobby = this.openLobby = () => { if (S.phase !== 'title') return; sound('confirm'); lobby.open(); D.title.hidden = true; };
    D.tcoop.addEventListener('click', openLobby);
    bus.on('net:start', d => {            // host pressed Start: everyone leaves the lobby and the run begins (no gesture on clients: the capture hint covers that)
      if (d && d.mode) setMode(d.mode, true);
      if (lobby.isOpen) lobby.close(true);
      try { if (G.audio && G.audio.unlock) G.audio.unlock(); } catch (e) {}
      // net.js emits ui:start / ui:restart itself right after this event; only start here if nobody did (e.g. a fake net)
      setTimeout(() => { if (S.phase === 'title' && netNow().status === 'playing') bus.emit('ui:start'); }, 0);
    });
    for (const t of ['net:status', 'net:peer+', 'net:peer-']) bus.on(t, () => paintRoles());
    bus.on('net:closed', d => { paintRoles(); if (d && d.reason === 'left') { if (self.soft) { self.soft = false; screen(S.phase); } return; } if (self.soft) { self.soft = false; screen(S.phase); } if (S.phase === 'playing' || S.phase === 'paused') hud.toast('Connection closed', (d && d.reason) || 'The host left. The run continues offline.', 'bad', 7); });
    const openBay = this.openBay = () => { if (S.phase !== 'title' && S.phase !== 'paused') return; sound('confirm'); bayUi.open(); D.title.hidden = true; D.pause.hidden = true; };
    D.tbay.addEventListener('click', openBay); D.pbay.addEventListener('click', openBay);
    // ---- mode select (writes G.state.mode) ------------------------------------------------------------------------
    const modeBtns = [...D.modes.children];
    const setMode = this.setMode = (m, quiet) => {
      S.mode = m === 'operation' ? 'operation' : 'survival'; lsSet(LS_MODE, S.mode);
      for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.mode === S.mode));
      D.start.firstElementChild.textContent = S.mode === 'operation' ? 'Deploy' : 'Start run';
      if (!quiet) { sound('tick'); bus.emit('mode', S.mode); }
    };
    D.modes.addEventListener('click', e => { const b = e.target.closest('.ku-mode'); if (b) setMode(b.dataset.mode); });
    setMode(G.params.get('mode') || lsGet(LS_MODE) || S.mode || 'survival', true);
    D.start.addEventListener('click', () => go('ui:start'));
    D.resume.addEventListener('click', () => {
      if (self.soft) { self.soft = false; input.lock(); try { if (G.audio && G.audio.unlock) G.audio.unlock(); G.canvas.focus({ preventScroll: true }); } catch (e) {} sound('confirm'); screen(S.phase); return; }
      go('ui:resume');
    });
    D.retry.addEventListener('click', () => { const N = netNow(); if (N.online && !N.isHost) return; if (D.over.classList.contains('on')) go('ui:restart'); });
    D.otitle.addEventListener('click', () => { if (D.over.classList.contains('on')) leave(); });
    // Restart / Title from pause throw the run away: ask once more on the same button (no confirm() in the frame).
    const armed = (btn, label, fn) => {
      let tm = 0;
      const disarm = () => { clearTimeout(tm); if (btn.classList.contains('arm')) { btn.classList.remove('arm'); btn.textContent = typeof label === 'function' ? label() : label; } };
      btn.addEventListener('click', () => {
        if (btn.classList.contains('arm')) { disarm(); fn(); return; }
        btn.classList.add('arm'); btn.textContent = 'Confirm?'; sound('tick'); tm = setTimeout(disarm, 2600);
      });
      btn.addEventListener('blur', disarm);
      return disarm;
    };
    const disarmA = armed(D.restart, 'Restart', () => { self.soft = false; go('ui:restart'); });
    const disarmB = armed(D.totitle, () => { const N = netNow(); return N.online ? (N.isHost ? 'Back to lobby' : 'Leave game') : 'Title'; }, leave);
    // Enter on the title / debrief = click on the primary button (the click handler does the work).
    // core.js swallows Tab / Space / arrows for the game, so the menus do their own keyboard traversal.
    const focusables = () => { const scr = lobby.isOpen ? lobby.el : self.soft ? D.pause : bayUi.isOpen ? bayUi.el : S.phase === 'title' ? D.title : S.phase === 'paused' ? D.pause : S.phase === 'over' ? D.over : null; return scr ? [...scr.querySelectorAll('button,input,a[href]')].filter(n => !n.disabled && n.offsetParent !== null) : []; };
    bus.on('key', code => {
      const a = document.activeElement, mine = a && root.contains(a);
      if (self.soft && (code === 'Escape' || code === 'KeyP')) {      // online overlay: Esc closes it (boot's ui:pause for this same key is skipped once)
        self.soft = false; self.skipPause = G.frame; input.lock(); screen(S.phase); return;
      }
      if (!D.deploy.hidden && (code === 'Enter' || code === 'NumpadEnter' || code === 'Space')) { D.deploy.click(); return; }
      if (lobby.isOpen) {
        if (lobby.key(code, a)) return;
        if (code === 'ArrowUp' || code === 'ArrowDown') code = 'Tab' + (code === 'ArrowUp' ? '-' : '+');
      } else if (bayUi.isOpen) {
        // boot.js turns Esc / P into ui:resume while paused; the bay takes Esc for itself and re-pauses (see game:resume)
        if (mine && a === bayUi.B.name) {
          if (code === 'Space') { try { a.setRangeText(' ', a.selectionStart, a.selectionEnd, 'end'); a.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} return; }
          if (code === 'ArrowLeft' || code === 'ArrowRight') { try { const p = Math.max(0, Math.min(a.value.length, a.selectionStart + (code === 'ArrowLeft' ? -1 : 1))); a.setSelectionRange(p, p); } catch (e) {} return; }
        }
        if (code === 'KeyP' && a !== bayUi.B.name) { bayUi.close(); return; }
        if (bayUi.key(code, a)) return;
        if (code === 'ArrowUp' || code === 'ArrowDown') code = 'Tab' + (code === 'ArrowUp' ? '-' : '+');
      } else if (code === 'KeyB' && S.phase === 'title') { D.tbay.click(); return; }
      // perk picker: 1/2/3 pick a card. The key is taken off core's queue so it does not also switch loadout.
      if (S.phase === 'playing' && hud.perkOpen && !self.won && !self.soft) {
        const i = code === 'Digit1' || code === 'Numpad1' ? 0 : code === 'Digit2' || code === 'Numpad2' ? 1 : code === 'Digit3' || code === 'Numpad3' ? 2 : -1;
        if (i >= 0 && hud.pickPerk(i)) { try { if (input.consume) input.consume(code); else { const q = input._q, l = q && q[q.length - 1]; if (l && l[0] === 0 && l[1] === code) q.pop(); } } catch (e) {} return; }
      }
      if (mine && a.classList.contains('ku-mode') && (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown')) {
        const n = modeBtns[(modeBtns.indexOf(a) + 1) % modeBtns.length]; n.focus(); n.click(); return;
      }
      if (code === 'Tab' || code === 'Tab-' || code === 'Tab+') {
        const f = focusables(); if (!f.length) return;
        const back = code === 'Tab-' || (code === 'Tab' && (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight'))); let i = f.indexOf(a);
        i = i < 0 ? (back ? f.length - 1 : 0) : (i + (back ? f.length - 1 : 1)) % f.length;
        try { f[i].focus({ preventScroll: false }); } catch (e) {}
        return;
      }
      if (mine && a.tagName === 'BUTTON' && code === 'Space') { a.click(); return; }
      if (mine && a.tagName === 'INPUT' && (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown')) {
        if (code === 'ArrowLeft' || code === 'ArrowDown') a.stepDown(); else a.stepUp();
        a.dispatchEvent(new Event('input', { bubbles: true })); return;
      }
      if (code !== 'Enter' && code !== 'NumpadEnter') return;
      if (mine && a.tagName === 'BUTTON') return;
      if (S.phase === 'title') D.start.click(); else if (S.phase === 'over' || self.won) D.retry.click();
    });
    // If the run is live but the mouse is not captured (Esc-resume, or the request never resolved), a click on the view captures it.
    G.canvas.addEventListener('mousedown', () => { if (S.phase === 'playing' && !input.locked && !input.fallbackLook) input.lock(); });
    bus.on('game:resume', () => { if (escGuard) { escGuard = false; bus.emit('ui:pause'); return; } if (self.won) return; if (!input.locked && !input.fallbackLook) input.lock(); });
    let toldFallback = false;
    bus.on('pointerlock', locked => {
      if (locked || !input.fallbackLook) return;
      const msg = 'Mouse capture is not available in this frame. Move the mouse to look; everything else works.';
      D.tnote.textContent = msg; D.tnote.classList.add('warn'); D.pnote.textContent = msg; D.pnote.classList.add('warn');
      if (!toldFallback && S.phase === 'playing') { toldFallback = true; hud.toast('Mouse capture unavailable', 'Move the mouse to look. Everything else works.', 'warn', 6); }
    });

    // ---- settings controls -------------------------------------------------------------------------------------
    const FMT = { sens: v => v.toFixed(2) + '×', volume: v => Math.round(v * 100) + '%', music: v => Math.round(v * 100) + '%', shake: v => Math.round(v * 100) + '%' };
    const ranges = [...root.querySelectorAll('input[data-set]')];
    const paintRange = (inp) => {
      const v = +inp.value, min = +inp.min, max = +inp.max;
      inp.style.setProperty('--p', ((v - min) / (max - min) * 100).toFixed(1) + '%');
      inp.nextElementSibling.textContent = FMT[inp.dataset.set](v);
    };
    const paintQuality = () => { for (const b of D.qual.children) b.setAttribute('aria-pressed', String(b.dataset.q === G.quality.tier)); };
    const paintAll = this.refreshSettings = () => {
      for (const inp of ranges) { inp.value = set[inp.dataset.set]; paintRange(inp); }
      paintQuality(); D.inv.setAttribute('aria-checked', String(!!set.invertY)); D.inv.lastElementChild.textContent = set.invertY ? 'On' : 'Off';
    };
    for (const inp of ranges) inp.addEventListener('input', () => {
      const k = inp.dataset.set; set[k] = +inp.value; paintRange(inp);
      if (k === 'volume' || k === 'music') pushVolume();
      save(); bus.emit('settings', set);
    });
    D.qual.addEventListener('click', e => {
      const b = e.target.closest('button[data-q]'); if (!b) return;
      set.quality = b.dataset.q; if (G.setQuality) G.setQuality(set.quality); paintQuality(); save(); sound('tick'); bus.emit('settings', set);
    });
    D.inv.addEventListener('click', () => { set.invertY = !set.invertY; paintAll(); save(); sound('tick'); bus.emit('settings', set); });
    bus.on('quality', paintQuality);
    paintAll();

    // ---- phases ------------------------------------------------------------------------------------------------
    const paintBest = () => { const b = Math.max(self.best, S.wave.bestWave | 0); D.best.textContent = b > 0 ? pad2(b) : '–'; D.tsalv.textContent = fmt(G.progress ? G.progress.salvage : 0); };
    const screen = this.screen = (phase) => {
      if (bayUi.isOpen && phase !== 'title' && phase !== 'paused') bayUi.close();
      if (phase === 'title' || phase === 'over') { self.won = false; self.soft = false; }
      const won = self.won, soft = self.soft && phase === 'playing' && !won;
      D.title.hidden = phase !== 'title' || bayUi.isOpen || lobby.isOpen; D.pause.hidden = !(phase === 'paused' || soft) || bayUi.isOpen || won; D.pause.classList.toggle('soft', soft);
      paintRoles();
      if (phase === 'title' && !lobby.isOpen) { const N = netNow(); if (N.online && N.status === 'lobby') lobby.open(); }      // host sent everyone back to the lobby
      hud.el.hidden = phase !== 'playing' || won; hud.el._sh = undefined;
      if (phase !== 'over' && !won) { D.over.hidden = true; D.over.classList.remove('on'); self.overT = 0; }
      if (phase !== 'paused' && !soft) { disarmA(); disarmB(); }
      if (phase !== 'playing' || won) D.deploy.hidden = true;
      try { G.canvas.style.cursor = phase === 'playing' && !won && !soft ? 'none' : ''; } catch (e) {}
      if (phase === 'title') paintBest();
      if (phase === 'paused' || soft) paintAll();
      self.captT = 0;
    };
    bus.on('phase', d => screen(d.phase));
    bus.on('game:start', () => { self.won = false; screen(S.phase); hud.reset(); if (!tips.pilot && !demo) { tips.pilot = 1; lsSet(LS_TIPS, JSON.stringify(tips)); hud.queueTips(TIPS.pilot); } });
    const fillStats = () => {
      const V = view.state, t = Math.floor(V.stats.timeAlive || 0), P = G.progress;
      D.oSalv.textContent = '+' + fmt(demo ? 1840 : P ? P.runSalvage : 0); D.oPerks.textContent = demo ? 4 : P && P.perks ? P.perks.length : 0;
      return t;
    };
    bus.on('game:over', d => {
      if (self.won) return;
      hud.closePerks();
      const V = view.state, op = V.mode === 'operation', M = view.mission || G.mission;
      const n = op ? ((M && M.stage) | 0) : V.wave.n | 0, isBest = !op && n > self.best && n > 0, t = fillStats();
      if (isBest) { self.best = n; lsSet(LS_BEST, String(n)); }
      D.over.classList.remove('won'); D.oTag.textContent = op ? 'Operation failed' : 'Pilot down'; D.oH.textContent = op ? 'Stage' : 'Wave';
      D.oWave.textContent = pad2(n); D.oBest.hidden = !isBest; D.retry.firstElementChild.textContent = 'Retry';
      D.oCause.textContent = (d && d.cause === 'mission' ? 'The objective was lost.' : CAUSE[d && d.cause] || 'The pilot is down.') + ' Halden Yard held for ' + Math.floor(t / 60) + ':' + pad2(t % 60) + '.';
      D.oKills.textContent = fmt(V.player.kills); D.oScore.textContent = fmt(V.player.score); D.oTime.textContent = Math.floor(t / 60) + ':' + pad2(t % 60);
      D.oRigs.textContent = fmt(V.stats.mechsCalled); D.oVox.textContent = fmt(V.stats.voxelsDestroyed); D.oBld.textContent = fmt(V.stats.buildingsLevelled);
      D.over.hidden = false; self.overT = demo ? 0.05 : 1.3;      // let the death read before the card arrives
    });
    // Victory. boot.js has no 'won' phase: the phase stays 'playing', so the card is driven by a flag. The mouse is
    // released so the buttons can be clicked; boot then pauses, and we resume at once so PLAYER's victory orbit keeps moving.
    const showWon = this.showWon = (d) => {
      if (self.won) return;
      hud.closePerks(); self.won = true;
      const V = view.state, t = fillStats(), op = V.mode === 'operation';
      D.over.classList.add('won'); D.oTag.textContent = op ? 'Operation Blackout complete' : 'Run complete'; D.oH.textContent = '';
      D.oWave.textContent = 'Victory'; D.oBest.hidden = true; D.retry.firstElementChild.textContent = 'Play again';
      D.oCause.textContent = (op ? 'The Dreadnought is scrap and the signal is ours. ' : '') + 'Halden Yard taken back in ' + Math.floor(t / 60) + ':' + pad2(t % 60) + '.';
      D.oKills.textContent = fmt(V.player.kills); D.oScore.textContent = fmt(V.player.score); D.oTime.textContent = Math.floor(t / 60) + ':' + pad2(t % 60);
      D.oRigs.textContent = fmt(V.stats.mechsCalled); D.oVox.textContent = fmt(V.stats.voxelsDestroyed); D.oBld.textContent = fmt(V.stats.buildingsLevelled);
      screen(S.phase); D.over.hidden = false; self.overT = demo ? 0.05 : 2.2;
    };
    bus.on('game:won', showWon);
    // Online the world must not freeze. boot.js pauses on Esc / lost pointer lock, so the pause is bounced straight
    // back and the pause card is shown as an overlay over the running game instead.
    bus.on('game:pause', () => { if (self.won) bus.emit('ui:resume'); });
    // Online, boot.js ignores ui:pause (the world never stops); the pause card is shown as an overlay over the running game.
    bus.on('ui:pause', () => {
      if (!online() || S.phase !== 'playing' || self.won) return;
      if (self.skipPause != null && G.frame - self.skipPause < 3) { self.skipPause = null; return; }
      self.soft = true; screen(S.phase);
    });
    // "Deploy" overlay: online, playing, mouse not captured (a client when the host starts, or anyone after Esc).
    D.deploy.addEventListener('click', () => {
      input.lock(); try { if (G.audio && G.audio.unlock) G.audio.unlock(); G.canvas.focus({ preventScroll: true }); } catch (e) {}
      self.deployHold = 0.8; D.deploy.hidden = true; sound('confirm');
    });
    bus.on('salvage', () => { if (S.phase === 'title') paintBest(); });
    addEventListener('resize', () => hud.resize());
    this.overT = 0; this.captT = 0;
    screen(S.phase);
  },

  reset() { if (this.hud) this.hud.reset(); },

  update(dt) {
    const S = G.state, ph = S.phase, rdt = ph === 'paused' ? 0 : (G.rawDt || dt || 0), hud = this.hud;
    if (!hud) return;
    if (this.demoPending) {            // boot wires the phase machine after init, so force the screen on the first frame
      this.demoPending = false; const w = this.demoWhich;
      if (w === 'bay') {
        const sub = G.params.get('uis') || '', b = this.bay; this.openBay();
        const ch = ['warden', 'harrier', 'bastion'].indexOf(sub); if (ch >= 0) b.setTab(ch);
        if (sub === 'over') b.edit(l => { l.slots.armL = 'siege'; l.slots.armR = 'siege'; l.slots.back = 'mortar'; l.plating = 1; });
        if (sub === 'pick') b.toggleSlot('armL');
        return;
      }
      if (w === 'lobby') { this.openLobby(); return; }
      if (w === 'coop' && G.params.get('uis') === 'clientover') { if (ph === 'title') bus.emit('ui:start'); bus.emit('player:dead', { cause: 'bullet' }); return; }
      if (w !== 'title' && ph === 'title') bus.emit('ui:start');
      if (w === 'won') this.showWon({});
      if (w === 'pause') bus.emit('ui:pause');
      if (w === 'over') bus.emit('player:dead', { cause: 'debris' });
      return;
    }
    if (ph === 'playing' && !this.won) {
      const t0 = performance.now();
      if (this.demo && this.demoWhich !== 'title') this.demo.update(rdt);
      hud.update(rdt);
      const ms = performance.now() - t0; this.stats.ms += (ms - this.stats.ms) * 0.05; if (ms > this.stats.peak) this.stats.peak = ms;
      // mouse not captured and no fallback: say how to get it back (never blocks play)
      const free = !input.locked && !input.fallbackLook && !this.soft, N = this.view.net || G.net, onl = !!(N && N.online);
      // online: a full-screen "Deploy" prompt; offline: the small line
      if (this.deployHold > 0) this.deployHold -= rdt;
      const dep = onl && !(this.deployHold > 0) && (this.demo ? G.params.get('uis') === 'deploy' : free && !G.params.has('auto'));
      if (this.D.deploy.hidden === dep) this.D.deploy.hidden = !dep;
      const need = free && !onl && !G.params.has('auto') && !this.demo;
      if (need) this.captT += rdt; else this.captT = 0;
      const on = this.captT > 1.2; if (hud.D.capt._sh !== on) { hud.D.capt._sh = on; hud.D.capt.hidden = !on; }
    }
    if ((ph === 'over' || this.won) && this.overT > 0) {
      this.overT -= (G.rawDt || 0.016);
      if (this.overT <= 0) { this.D.over.classList.add('on'); if (this.won) input.unlock(); }
    }
  },

  // ---- public extras ---------------------------------------------------------------------------------------------
  message(text, sub, kind, dur) { if (this.hud) this.hud.toast(text, sub, kind, dur); },
  banner(title, sub, good) { if (this.hud) this.hud.banner(title, sub, good); },
};
export default ui;
