// KILOTON — ui_hud.js   OWNER: UI. The in-game instrument cluster.
// Reads a "view" ({ state, ents }) that is G.state / G.ents.list in the game and a fake in ?ui= demo mode.
// Rule for this file: every DOM write is guarded by a cached value; nothing is allocated per frame.
import { G, THREE, sat } from './core.js';

const KEY_BY_ID = { rifle: 'LMB', launcher: 'RMB', grenade: 'G', pulse: 'LMB', salvo: 'RMB', skylance: 'Q', seeker: 'Q', punch: 'F', autocannon: 'LMB', lance: 'LMB', siege: 'LMB', swarm: 'Q', mortar: 'RMB' };
const KEY_BY_IDX = ['LMB', 'RMB', 'Q', 'F'];
const XH_BY_ID = { rifle: 'rifle', launcher: 'launcher', grenade: 'launcher', pulse: 'pulse', salvo: 'salvo', skylance: 'lock', seeker: 'lock', swarm: 'lock', autocannon: 'rifle', lance: 'pulse', siege: 'launcher', mortar: 'salvo' };
const XH_BY_KIND = { auto: 'rifle', semi: 'launcher', heat: 'pulse', charge: 'salvo', lock: 'lock' };
const XH_ALL = ['rifle', 'launcher', 'pulse', 'salvo', 'lock', 'none'];
// Short card names when four or more weapon cards share the row (w.short / w.def.short win if COMBAT adds them).
const SHORT = { pulse: 'Pulse', autocannon: 'Autocannon', lance: 'Arc lance', siege: 'Siege', salvo: 'Hailstorm', skylance: 'Skylance', swarm: 'Swarm', mortar: 'Mortar', seeker: 'Seeker', rifle: 'Rifle', launcher: 'Launcher', e_pulse: 'Pulse', e_salvo: 'Salvo' };
const OBJ_LABEL = { destroy: 'Destroy', defend: 'Defend', reach: 'Go here', kill: 'Target', survive: 'Hold' };
const KIND_LABEL = { soldier: 'Infantry', drone: 'Drone', tank: 'Tank', gunship: 'Gunship', emech: 'Vanta rig' };
const RADAR_RANGE = 75;            // metres at the rim
const N_OBJ = 4, N_MARK = 12, N_LOCK = 8, N_ARC = 6, N_TOAST = 3, N_FEED = 5, N_WP = 5;
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- markup ---------------------------------------------------------------------------------------------------
const two = (tag, attrs, cls = '') => `<${tag} class="o ${cls}" ${attrs}/><${tag} class="f ${cls}" ${attrs}/>`;
const L = (x1, y1, x2, y2) => two('line', `x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"`);
const P = d => two('path', `d="${d}"`);
const T = (dx, dy, inner) => `<g data-d="${dx},${dy}">${inner}</g>`;
function crosshairSVG() {
  const d = 0.707;
  const v = {
    rifle: T(0, -1, L(0, -6, 0, -13)) + T(0, 1, L(0, 6, 0, 13)) + T(-1, 0, L(-6, 0, -13, 0)) + T(1, 0, L(6, 0, 13, 0)),
    launcher: two('circle', 'r="15"') + T(0, -1, L(0, -18, 0, -23)) + T(-1, 0, L(-18, 0, -23, 0)) + T(1, 0, L(18, 0, 23, 0)) + L(-4, 6, 4, 6) + L(-2.5, 10.5, 2.5, 10.5),
    pulse: T(-1, 0, P('M -8 -11 A 14 14 0 0 0 -8 11')) + T(1, 0, P('M 8 -11 A 14 14 0 0 1 8 11')) + T(0, -1, L(0, -16, 0, -20)) + T(0, 1, L(0, 16, 0, 20)),
    salvo: P('M 0 -13 L 13 0 L 0 13 L -13 0 Z') + T(-d, -d, L(-11, -11, -16, -16)) + T(d, -d, L(11, -11, 16, -16)) + T(-d, d, L(-11, 11, -16, 16)) + T(d, d, L(11, 11, 16, 16)),
    lock: T(-d, -d, P('M -17 -9 V -17 H -9')) + T(d, -d, P('M 17 -9 V -17 H 9')) + T(-d, d, P('M -17 9 V 17 H -9')) + T(d, d, P('M 17 9 V 17 H 9')) + L(-5, 0, -2, 0) + L(2, 0, 5, 0) + L(0, -5, 0, -2) + L(0, 2, 0, 5),
    none: T(0, -1, L(0, -5, 0, -9)) + T(0, 1, L(0, 5, 0, 9)) + T(-1, 0, L(-5, 0, -9, 0)) + T(1, 0, L(5, 0, 9, 0)),
  };
  let s = '<svg class="ku-xh x-none" data-k="xh" viewBox="-60 -60 120 120" aria-hidden="true">';
  for (const k of XH_ALL) s += `<g class="v v-${k}" data-v="${k}">${v[k]}</g>`;
  s += '<circle class="o dot" r="2.3"/><circle class="f dot" r="1.25"/>';
  s += '<path class="arc-t" d="M -19.3 23 A 30 30 0 0 0 19.3 23"/><path class="arc-v" data-k="xhArc" pathLength="100" stroke-dasharray="100 100" d="M -19.3 23 A 30 30 0 0 0 19.3 23"/>';
  s += `<g class="hit" data-k="hit">${L(7, 7, 13, 13)}${L(-7, 7, -13, 13)}${L(7, -7, 13, -13)}${L(-7, -7, -13, -13)}</g>`;
  s += `<g class="kill" data-k="kill">${L(9, 9, 18, 18)}${L(-9, 9, -18, 18)}${L(9, -9, 18, -18)}${L(-9, -9, -18, -18)}</g>`;
  return s + '</svg>';
}
function hudHTML() {
  let arcs = '';
  for (let i = 0; i < N_ARC; i++) arcs += '<g><path class="o" d="M -22 -76.9 A 80 80 0 0 1 22 -76.9"/><path class="f" d="M -22 -76.9 A 80 80 0 0 1 22 -76.9"/><polygon class="p" points="0,-90.5 -4.5,-84.5 4.5,-84.5"/></g>';
  let world = '';
  for (let i = 0; i < N_LOCK; i++) world += '<div class="ku-lk" hidden><i></i><i></i><i></i><i></i><b></b></div>';
  for (let i = 0; i < N_MARK; i++) world += '<div class="ku-mk" hidden><div class="ar"></div><div class="ic"></div><div class="tx"><b></b><span></span></div></div>';
  let toasts = '';
  for (let i = 0; i < N_TOAST; i++) toasts += '<div class="ku-toast"><b></b><span></span></div>';
  let feed = '';
  for (let i = 0; i < N_FEED; i++) feed += '<div><span></span><em></em></div>';
  let wps = '';
  for (let i = 0; i < N_WP; i++) wps += '<div class="ku-wp"><div class="ku-wp-h"><kbd></kbd><span></span></div><div class="ku-wp-m"><b><i style="font-style:normal"></i><small></small></b><em></em></div><div class="ku-bar"><i></i></div></div>';
  return `
<div class="ku-hud" data-k="hud" hidden>
  <div class="ku-vig" data-k="vig"></div><div class="ku-flash" data-k="flash"></div>
  <div class="ku-world" data-k="world">${world}</div>
  <svg class="ku-arcs" data-k="arcs" viewBox="-100 -100 200 200" aria-hidden="true">${arcs}</svg>
  ${crosshairSVG()}
  <div class="ku-warn" data-k="warn" hidden>Missile lock</div>
  <div class="ku-prompt" data-k="prompt" hidden><kbd></kbd><span></span></div>
  <div class="ku-top">
    <div class="ku-wave" data-k="wave">
      <div class="ku-wv-r"><span class="ku-lab">Wave</span><b data-k="wvN">00</b><i class="sep"></i><b data-k="wvC">0</b><span class="ku-lab" data-k="wvL">Hostiles</span></div>
      <div class="ku-bar xs"><i data-k="wvBar"></i></div>
      <div class="ku-wv-m" data-k="wvMech" hidden></div>
    </div>
    <div class="ku-stage" data-k="stage" hidden><span class="ku-lab">Stage</span><b data-k="stN">1</b><i class="sep"></i><span class="t" data-k="stT">Operation Blackout</span></div>
    <div class="ku-gauge ku-relay" data-k="relay" hidden><div class="h"><span>Relay integrity</span><b data-k="relayV"></b></div><div class="ku-bar"><i data-k="relayFill"></i></div></div>
    <div class="ku-gauge ku-boss" data-k="boss" hidden><div class="h"><b data-k="bossN">Dreadnought</b><span data-k="bossP"></span></div><div class="ku-bar"><i class="lag" data-k="bossLag"></i><i data-k="bossFill"></i><u></u></div></div>
    <div class="ku-ban" data-k="ban"><b></b><span></span></div>
    ${toasts}
  </div>
  <div class="ku-tl">
    <canvas class="ku-radar" data-k="radar" width="2" height="2"></canvas>
    <div class="ku-rd-f"><span>Hdg <b data-k="hdg">000</b></span><span>${RADAR_RANGE} m</span></div>
    <div class="ku-obj" data-k="obj" hidden><small>Objectives</small>${'<div class="ku-ob"><i></i><div><b></b><span></span><div class="ku-bar xs"><i></i></div></div><em></em></div>'.repeat(N_OBJ)}</div>
    <div class="ku-team" data-k="team" hidden>${'<div class="ku-tm"><i></i><b></b><em></em><div class="ku-bar s"><i></i></div></div>'.repeat(3)}</div>
    <div class="ku-tips" data-k="tips"><small>Field notes</small><p></p></div>
  </div>
  <div class="ku-tr">
    <div class="ku-score"><span class="ku-lab">Score</span><b data-k="score">0</b>
      <div class="ku-score-r"><span>Kills <em data-k="kills">0</em></span><span class="ku-combo" data-k="combo" hidden></span></div>
      <div class="ku-net" data-k="net" hidden></div>
      <div class="ku-salv"><span>Salvage <em data-k="salv">0</em></span><b data-k="salvD"></b></div></div>
    <div class="ku-feed" data-k="feed">${feed}</div>
  </div>
  <div class="ku-perk" data-k="perk" hidden><small>Field upgrade</small><h3>Choose one</h3>
    <div class="ku-perk-c">${[1, 2, 3].map(i => `<button type="button" data-pi="${i - 1}"><kbd>${i}</kbd><b></b><span></span></button>`).join('')}</div></div>
  <div class="ku-rev" data-k="rev" hidden><span><kbd>E</kbd><b data-k="revT">Hold to revive</b></span><div class="ku-bar s"><i data-k="revFill"></i></div></div>
  <div class="ku-spec" data-k="spec" hidden><b>You are down</b><span data-k="specT">A teammate can revive you</span><em><kbd>LMB</kbd>Next teammate</em></div>
  <div class="ku-capt" data-k="capt" hidden>Click to capture the mouse</div>
  <div class="ku-bot" data-k="bot">
    <div class="ku-bl"><div class="ku-pk" data-k="pk"></div><div class="ku-vit" data-k="vit">
      <div class="ku-vh"><span class="ku-lab"><span data-k="vitLab">Pilot</span><em class="ku-tag" data-k="tag" hidden></em></span><b><i style="font-style:normal" data-k="vitNum">100</i><small data-k="vitMax"></small></b></div>
      <div class="ku-bar ku-hp"><i class="lag" data-k="hpLag"></i><i class="fill" data-k="hpFill"></i><u></u></div>
      <div class="ku-vsub">
        <div class="ku-mini pil" data-k="miniPil" hidden><span>Pilot</span><div class="ku-bar s"><i data-k="pilFill"></i></div><b data-k="pilNum">100</b></div>
        <div class="ku-mini jet" data-k="miniJet"><span data-k="jetLab">Jetpack</span><div class="ku-bar s"><i data-k="jetFill"></i></div></div>
      </div>
      <div class="ku-eq" data-k="eq" hidden>
        <div class="ku-mini shd" data-k="shd" hidden><span>Shield</span><div class="ku-bar s"><i data-k="shdFill"></i></div><kbd>G</kbd></div>
        <div class="ku-mini grp" data-k="grp" hidden><span>Grapple</span><b data-k="grpTxt"></b></div>
      </div>
    </div></div>
    <div class="ku-bc"><div class="ku-mt" data-k="mt">
      <div class="ku-mt-rdy"><i></i><span>Rig ready</span><kbd>V</kbd><i></i></div>
      <div class="ku-mt-sub">Aim at open ground to call the drop</div>
      <div class="ku-mt-h"><span class="ku-lab" data-k="mtLab">Rig drop</span><b data-k="mtVal">0%</b></div>
      <div class="ku-bar"><i data-k="mtFill"></i><u></u></div>
    </div><div class="ku-lo" data-k="lo" hidden></div></div>
    <div class="ku-br">
      <div class="ku-hints" data-k="hints"></div>
      <div class="ku-wps" data-k="wps">${wps}</div>
    </div>
  </div>
</div>`;
}
const HINTS = {
  pilot: '<span><kbd>R</kbd>Reload</span><span><kbd>C</kbd>Crouch / slide</span><span><kbd>X</kbd>Roll</span><span><kbd>1-3</kbd>Loadout</span>',
  mech: '<span><kbd>F</kbd>Punch</span><span><kbd>C</kbd>Ability</span><span><kbd>G</kbd>Equipment</span><span><kbd>E</kbd>Grab</span><span><kbd>X</kbd>Eject</span>',
};

// ---- helpers --------------------------------------------------------------------------------------------------
const _v = new THREE.Vector3();
const scr = { x: 0, y: 0, on: false, depth: 0, ang: 0 };
function project(x, y, z, mx, my) {            // world -> screen px; clamps to an inset box when off screen / behind
  const cam = G.camera, w = G.width || innerWidth, h = G.height || innerHeight, pe = cam.projectionMatrix.elements;
  _v.set(x, y, z).applyMatrix4(cam.matrixWorldInverse);
  const cz = -_v.z; scr.depth = cz;
  let nx, ny;
  if (cz > 0.2) { nx = _v.x * pe[0] / cz; ny = _v.y * pe[5] / cz; }
  else { const l = Math.hypot(_v.x, _v.y); if (l < 1e-4) { nx = 0; ny = -8; } else { nx = _v.x / l * 8; ny = _v.y / l * 8; } }
  const ex = Math.max(0.1, 1 - 2 * mx / w), ey = Math.max(0.1, 1 - 2 * my / h);
  if (cz > 0.2 && Math.abs(nx) <= ex && Math.abs(ny) <= ey) scr.on = true;
  else {
    // off screen: park it on an ellipse inside the frame, so edge markers never sit on the corner clusters (radar, score, cards)
    const px = nx * w, py = ny * h, l = Math.hypot(px / (ex * w), py / (ey * h)) || 1;
    nx = px / l / w; ny = py / l / h; scr.on = false; scr.ang = Math.atan2(nx * w, ny * h);
  }
  scr.x = (nx * 0.5 + 0.5) * w; scr.y = (0.5 - ny * 0.5) * h;
  return scr;
}
function tog(el, name, on) { const k = '_c' + name; if (el[k] !== on) { el[k] = on; el.classList.toggle(name, on); } }
function show(el, on) { if (el._sh !== on) { el._sh = on; el.hidden = !on; } }
function setBar(el, v) { v = Math.round(sat(v) * 250) / 250; if (el._v !== v) { el._v = v; el.style.transform = 'scaleX(' + v + ')'; } }
function setTxt(el, s) { if (el._t !== s) { el._t = s; el.textContent = s; } }
function setNum(el, n) { if (el._n !== n) { el._n = n; el.textContent = n; } }
const pad2 = n => (n < 10 ? '0' : '') + n;
const fmt = n => { n = Math.round(n); return n < 1000 ? '' + n : n.toLocaleString('en-US'); };
function isPlayers(P, e) { return !!e && (e === P.ent || e === P.pilot || e === P.mech || e.isPlayer === true); }
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- HUD ------------------------------------------------------------------------------------------------------
export function createHud(root, view) {
  root.insertAdjacentHTML('beforeend', hudHTML());
  const el = root.querySelector('[data-k="hud"]');
  const $ = k => el.querySelector('[data-k="' + k + '"]');
  const D = {};
  for (const n of el.querySelectorAll('[data-k]')) D[n.dataset.k] = n;

  // crosshair parts
  const xh = { cur: 'none', bloom: -1, kick: 0, b: 0, ticks: {}, arc: -1, arcCls: 0 };
  for (const g of D.xh.querySelectorAll('[data-v]')) {
    const list = [];
    for (const t of g.querySelectorAll('[data-d]')) { const p = t.dataset.d.split(','); list.push({ el: t, dx: +p[0], dy: +p[1] }); }
    xh.ticks[g.dataset.v] = list;
  }
  // pools
  const arcs = []; for (const g of D.arcs.children) arcs.push({ el: g, t: 0, x: 0, z: 0, rot: -999, op: -1, str: 1 });
  const locks = []; for (const n of el.querySelectorAll('.ku-lk')) locks.push({ el: n, b: n.lastElementChild, x: -1, y: -1, s: -1, st: -1 });
  const marks = []; for (const n of el.querySelectorAll('.ku-mk')) marks.push({ el: n, ar: n.children[0], b: n.querySelector('b'), sp: n.querySelector('span'), x: -1, y: -1, cls: '', lab: '', sk: -1, sv: -1, rot: -999 });
  const toasts = []; for (const n of el.querySelectorAll('.ku-toast')) toasts.push({ el: n, b: n.children[0], sp: n.children[1], t: 0, text: '', out: false });
  const feedRows = []; for (const n of D.feed.children) feedRows.push({ el: n, lab: n.children[0], pts: n.children[1] });
  const feed = []; for (let i = 0; i < N_FEED; i++) feed.push({ label: '', pts: 0, t: 0 });
  let feedN = 0;
  const wps = []; for (const n of D.wps.children) wps.push({ el: n, key: n.querySelector('kbd'), name: n.querySelector('.ku-wp-h span'), num: n.querySelector('.ku-wp-m i'), unit: n.querySelector('small'), st: n.querySelector('em'), bar: n.querySelector('.ku-bar i'), cls: '', stc: -1, w: null });
  const objRows = []; for (const n of D.obj.querySelectorAll('.ku-ob')) objRows.push({ el: n, b: n.querySelector('b'), sp: n.querySelector('span'), bar: n.querySelector('.ku-bar i'), em: n.lastElementChild, o: null, txt: null, sub: null, st: -1, pq: -1, rk: null });
  const perkBtns = [...D.perk.querySelectorAll('button')];
  const teamRows = []; for (const n of D.team.children) teamRows.push({ el: n, b: n.children[1], em: n.children[2], bar: n.querySelector('.ku-bar i'), name: null, cls: '', d: -1 });
  const netOf = () => view.net || G.net;
  const peerName = e => { if (!e) return ''; if (e.name && e.remote) return e.name; const N = netOf(), p = N && N.peers && N.peers.get && e.netOwner != null ? N.peers.get(e.netOwner) : null; return (p && p.name) || e.name || 'Teammate'; };
  const peerDown = p => { const e = p.ent, s = p.state; return !!(p.down || (e && e.down) || (s && (s.down || s.mode === 'down'))); };
  let perkOffer = null, bossE = null, relayE = null;
  const tipsP = D.tips.querySelector('p');
  const banB = D.ban.children[0], banS = D.ban.children[1];

  const c = {            // cached scalars
    mech: null, lag: 1, lagHold: 0, vig: -1, flash: 0, meterSt: '', eta0: 0, hintsFor: '', waveSt: -1, warnT: 0, warnOn: false,
    promptRaw: null, ban: 0, banPend: false, capt: 0, frame: 0, fx: 0, fz: 1, em: 13, radarPx: 0, dpr: 1, lockedN: 0, mechsN: -1,
    mxX: 70, mxY: 80, mxB: 120,
  };
  const incoming = [{ on: false, x: 0, z: 0, t: 0 }, { on: false, x: 0, z: 0, t: 0 }];   // by team
  const aces = []; for (let i = 0; i < 4; i++) aces.push({ ent: null, progress: 0, seen: 0 });
  const lockedSet = [];        // entities with a completed lock (from 'lock' events), max N_LOCK-1
  const tipQ = []; let tipT = 0, tipGap = 0;
  let me = null;

  // ---- radar -------------------------------------------------------------------------------------------------
  const rc = D.radar, rctx = rc.getContext('2d');
  const rbg = document.createElement('canvas'), rbgx = rbg.getContext('2d');
  function resize() {
    let em = 13; try { em = parseFloat(getComputedStyle(root).fontSize) || 13; } catch (e) {}
    c.em = em; c.mxX = em * 4.5; c.mxY = em * 5.5;
    const narrow = (root.clientWidth || innerWidth) <= 760;
    c.mxB = em * (narrow ? 17 : 9);
    if (narrow !== c.narrow) {             // small frames: tracker and tips join the centre column so nothing overlaps under the radar
      c.narrow = narrow; const top = D.ban.parentNode, tl = D.radar.parentNode;
      if (narrow) { top.insertBefore(D.obj, D.ban); top.insertBefore(D.team, D.ban); top.appendChild(D.tips); } else { tl.appendChild(D.obj); tl.appendChild(D.team); tl.appendChild(D.tips); }
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1), px = Math.round((narrow ? 8.4 : 11) * em * dpr);
    if (px === c.radarPx) return;
    c.radarPx = px; c.dpr = dpr; rc.width = rc.height = rbg.width = rbg.height = px;
    const g = rbgx, m = px / 2, R = m - 2.5 * dpr;
    g.clearRect(0, 0, px, px);
    g.beginPath(); g.arc(m, m, R, 0, 6.2832); g.fillStyle = 'rgba(4,6,9,0.66)'; g.fill();
    g.beginPath(); g.moveTo(m, m); g.arc(m, m, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62); g.closePath(); g.fillStyle = 'rgba(73,224,210,0.09)'; g.fill();
    g.lineWidth = 3 * dpr; g.strokeStyle = 'rgba(4,6,9,0.7)'; g.beginPath(); g.arc(m, m, R, 0, 6.2832); g.stroke();
    g.lineWidth = 1.2 * dpr; g.strokeStyle = 'rgba(233,228,216,0.7)'; g.beginPath(); g.arc(m, m, R, 0, 6.2832); g.stroke();
    g.lineWidth = dpr; g.strokeStyle = 'rgba(233,228,216,0.2)';
    g.beginPath(); g.arc(m, m, R * 0.66, 0, 6.2832); g.stroke(); g.beginPath(); g.arc(m, m, R * 0.33, 0, 6.2832); g.stroke();
    g.strokeStyle = 'rgba(233,228,216,0.55)'; g.beginPath();
    for (let a = 0; a < 12; a++) { const an = a * Math.PI / 6, r0 = R - (a % 3 === 0 ? 6 : 3) * dpr; g.moveTo(m + Math.cos(an) * r0, m + Math.sin(an) * r0); g.lineTo(m + Math.cos(an) * R, m + Math.sin(an) * R); }
    g.stroke();
  }
  function blip(g, kind, x, y, s, far, variant) {
    // each blip: dark keyline then colour, so it survives a bright sky behind the translucent dish
    if (kind === 'soldier') {
      g.beginPath(); g.arc(x, y, (far ? 1.6 : 2.3) * s, 0, 6.2832); g.fill(); g.stroke();
      if (variant === 'ace') { g.save(); g.strokeStyle = '#ffb23e'; g.lineWidth = 1.4 * s; g.beginPath(); g.arc(x, y, 4.6 * s, 0, 6.2832); g.stroke(); g.restore(); }
    } else if (kind === 'drone' || kind === 'gunship') {
      const r = (kind === 'gunship' ? 5.4 : 3.4) * s * (far ? 0.75 : 1);
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.9, y + r * 0.75); g.lineTo(x - r * 0.9, y + r * 0.75); g.closePath();
      if (kind === 'gunship') g.fill(); else { g.save(); g.fillStyle = 'rgba(4,6,9,0.75)'; g.fill(); g.strokeStyle = '#ff4b3a'; g.lineWidth = 1.5 * s; g.stroke(); g.restore(); return; }
      g.stroke();
    } else if (kind === 'tank') {
      const r = 3.3 * s * (far ? 0.75 : 1); g.beginPath(); g.rect(x - r, y - r, r * 2, r * 2); g.fill(); g.stroke();
    } else {                     // rigs: the biggest mark on the dish
      const r = 6.4 * s * (far ? 0.75 : 1);
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fill(); g.stroke();
    }
  }
  function drawRadar(px0, pz0, t) {
    const g = rctx, px = c.radarPx, m = px / 2, dpr = c.dpr, R = m - 2.5 * dpr, sc = (R - 5 * dpr) / RADAR_RANGE, fx = c.fx, fz = c.fz;
    g.clearRect(0, 0, px, px); g.drawImage(rbg, 0, 0);
    // north pip
    { const u = -fz, r = -fx; g.fillStyle = '#e9e4d8'; g.font = '700 ' + Math.round(8.5 * dpr) + 'px Arial,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', m + r * (R - 9 * dpr), m - u * (R - 9 * dpr)); }
    g.lineWidth = dpr; g.strokeStyle = 'rgba(4,6,9,0.85)';
    const E = view.ents;
    for (let n = 0; n < E.length; n++) {
      const e = E[n]; if ((!e.alive && !(e.remote && e.down)) || e === me || !e.pos) continue;
      if (e.team === 0 && e.remote) {             // teammates: cyan, rigs as diamonds, downed ones ringed red
        if (e.kind !== 'pilot' && e.kind !== 'mech') continue;
        const dx = e.pos.x - px0, dz = e.pos.z - pz0; let r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
        const d = Math.sqrt(r * r + u * u); if (d > RADAR_RANGE) { const k = RADAR_RANGE / d; r *= k; u *= k; }
        const x = m + r * sc, y = m - u * sc, rr = (e.kind === 'mech' ? 4.6 : 2.8) * dpr;
        g.fillStyle = '#49e0d2'; g.beginPath();
        if (e.kind === 'mech') { g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); g.closePath(); } else g.arc(x, y, rr, 0, 6.2832);
        g.fill(); g.stroke();
        if (e.down) { g.save(); g.strokeStyle = '#ff4b3a'; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(x, y, 5.5 * dpr, 0, 6.2832); g.stroke(); g.restore(); }
        continue;
      }
      if (e.team === 0 && e.kind !== 'mech') continue;
      if (e.kind === 'prop') continue;
      const dx = e.pos.x - px0, dz = e.pos.z - pz0;
      let r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
      const d = Math.sqrt(r * r + u * u), far = d > RADAR_RANGE;
      if (far) { const k = RADAR_RANGE / d; r *= k; u *= k; }
      const x = m + r * sc, y = m - u * sc;
      if (e.team === 0) {         // the waiting Warden: hollow cyan diamond
        const rr = 6 * dpr; g.save(); g.beginPath(); g.moveTo(x, y - rr); g.lineTo(x + rr, y); g.lineTo(x, y + rr); g.lineTo(x - rr, y); g.closePath();
        g.fillStyle = 'rgba(4,6,9,0.7)'; g.fill(); g.strokeStyle = '#49e0d2'; g.lineWidth = 1.8 * dpr; g.stroke(); g.fillStyle = '#49e0d2'; g.fillRect(x - 1.5 * dpr, y - 1.5 * dpr, 3 * dpr, 3 * dpr); g.restore();
        continue;
      }
      g.globalAlpha = far ? 0.6 : 1; g.fillStyle = '#ff4b3a';
      blip(g, e.kind, x, y, dpr, far, e.variant || (e.ace ? 'ace' : ''));
    }
    g.globalAlpha = 1;
    // objectives with a place
    const Mi = view.mission || G.mission, obs = Mi && Mi.objectives;
    if (obs) for (let n = 0; n < obs.length; n++) {
      const o = obs[n]; if (!o || o.done || o.failed || typeof o.x !== 'number' || typeof o.z !== 'number') continue;
      const dx = o.x - px0, dz = o.z - pz0; let r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
      const d = Math.sqrt(r * r + u * u); if (d > RADAR_RANGE) { const k = RADAR_RANGE / d; r *= k; u *= k; }
      const x = m + r * sc, y = m - u * sc, rr = 4.2 * dpr;
      g.fillStyle = 'rgba(4,6,9,0.8)'; g.strokeStyle = o.kind === 'defend' ? '#49e0d2' : '#e9e4d8'; g.lineWidth = 1.7 * dpr;
      g.beginPath(); g.rect(x - rr, y - rr, rr * 2, rr * 2); g.fill(); g.stroke();
    }
    const mks = Mi && Mi.markers;
    if (mks) for (let n = 0; n < mks.length; n++) {
      const o = mks[n]; if (!o || o.active === false) continue;
      const e = o.ent && o.ent.pos && o.ent.alive !== false ? o.ent : null, wx = e ? e.pos.x : o.x, wz = e ? e.pos.z : o.z;
      if (typeof wx !== 'number' || typeof wz !== 'number' || o.kind === 'boss') continue;      // the boss already has the biggest red blip
      const dx = wx - px0, dz = wz - pz0; let r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
      const d = Math.sqrt(r * r + u * u); if (d > RADAR_RANGE) { const k = RADAR_RANGE / d; r *= k; u *= k; }
      const x = m + r * sc, y = m - u * sc, rr = 4.2 * dpr;
      g.fillStyle = 'rgba(4,6,9,0.8)'; g.strokeStyle = o.kind === 'relay' ? '#49e0d2' : o.kind === 'core' ? '#ff4b3a' : '#e9e4d8'; g.lineWidth = 1.7 * dpr;
      g.beginPath(); g.rect(x - rr, y - rr, rr * 2, rr * 2); g.fill(); g.stroke();
    }
    g.lineWidth = dpr; g.strokeStyle = 'rgba(4,6,9,0.85)';
    // inbound drops
    for (let tm = 0; tm < 2; tm++) {
      const inc = incoming[tm]; if (!inc.on) continue;
      const dx = inc.x - px0, dz = inc.z - pz0; let r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
      const d = Math.sqrt(r * r + u * u); if (d > RADAR_RANGE) { const k = RADAR_RANGE / d; r *= k; u *= k; }
      const x = m + r * sc, y = m - u * sc, ph = REDUCED ? 0.5 : (t * 1.6) % 1;
      g.strokeStyle = tm === 0 ? '#49e0d2' : '#ff4b3a'; g.lineWidth = 1.6 * dpr;
      g.globalAlpha = 1 - ph; g.beginPath(); g.arc(x, y, (3 + ph * 9) * dpr, 0, 6.2832); g.stroke();
      g.globalAlpha = 1; g.beginPath(); g.moveTo(x - 4 * dpr, y); g.lineTo(x + 4 * dpr, y); g.moveTo(x, y - 4 * dpr); g.lineTo(x, y + 4 * dpr); g.stroke();
    }
    // hostile ordnance
    const pr = view.projectiles || (G.combat && G.combat.projectiles);
    if (pr && pr.length) {
      g.fillStyle = '#ffb23e';
      for (let n = 0, k = Math.min(pr.length, 48); n < k; n++) {
        const p = pr[n]; if (!p || p.team !== 1 || !p.pos || p.kind === 'bullet' || p.kind === 'tracer') continue;
        const dx = p.pos.x - px0, dz = p.pos.z - pz0, r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
        if (r * r + u * u > RADAR_RANGE * RADAR_RANGE) continue;
        g.fillRect(m + r * sc - dpr, m - u * sc - dpr, 2 * dpr, 2 * dpr);
      }
    }
    // own ship
    g.fillStyle = '#49e0d2'; g.strokeStyle = 'rgba(4,6,9,0.9)'; g.lineWidth = dpr;
    g.beginPath(); g.moveTo(m, m - 5.5 * dpr); g.lineTo(m + 4.2 * dpr, m + 4.5 * dpr); g.lineTo(m, m + 2.2 * dpr); g.lineTo(m - 4.2 * dpr, m + 4.5 * dpr); g.closePath(); g.fill(); g.stroke();
  }

  // ---- transient pieces ---------------------------------------------------------------------------------------
  function anim(node, frames, dur) { try { if (node.animate) node.animate(frames, { duration: dur, easing: 'ease-out' }); } catch (e) {} }
  const HIT_F = REDUCED ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'scale(1.35)' }, { opacity: 1, transform: 'scale(1)', offset: 0.35 }, { opacity: 0, transform: 'scale(1)' }];
  const KILL_F = REDUCED ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: 'scale(0.7)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.3 }, { opacity: 0, transform: 'scale(1.3)' }];
  function toast(text, sub, kind, dur) {
    if (!text) return;
    text = String(text);
    let slot = null;
    for (const s of toasts) if (s.t > 0 && s.text === text) slot = s;
    if (!slot) for (const s of toasts) if (s.t <= 0) { slot = s; break; }
    if (!slot) { slot = toasts[0]; for (const s of toasts) if (s.t < slot.t) slot = s; }
    slot.text = text; slot.t = Math.max(1, dur || 3.5); slot.out = false;
    slot.b.textContent = text; slot.sp.textContent = sub || ''; slot.sp.hidden = !sub;
    slot.el.className = 'ku-toast on ' + (kind === 'warn' || kind === 'good' || kind === 'bad' ? kind : '');
  }
  function banner(title, sub, good) {
    banB.textContent = title; banS.textContent = sub || ''; banS.hidden = !sub;
    D.ban.className = 'ku-ban' + (good ? ' good' : ''); c.banPend = true; c.ban = 3.4;
  }
  function renderFeed() {
    for (let i = 0; i < N_FEED; i++) {
      const r = feedRows[i], on = i < feedN;
      if (on) { r.lab.textContent = feed[i].label; r.pts.textContent = feed[i].pts ? '+' + fmt(feed[i].pts) : ''; }
      r.el.className = on ? 'on' : '';
    }
  }
  function pushFeed(label, pts) {
    const o = feed.pop(); o.label = label; o.pts = pts || 0; o.t = 5; feed.unshift(o);
    if (feedN < N_FEED) feedN++;
    renderFeed();
  }
  function renderLoadouts() {            // on-foot chips: which saved loadout the next drop brings (keys 1/2/3)
    const b = G.rigs && G.rigs.bay; if (!b || !b.loadouts) { D.lo.innerHTML = ''; return; }
    let s = '';
    for (let i = 0; i < b.loadouts.length && i < 3; i++) {
      const l = b.loadouts[i], ch = G.rigs.CHASSIS[l.chassis], on = i === b.active;
      const lk = G.progress && G.progress.loadoutUnlocked && !G.progress.loadoutUnlocked(l);
      s += '<span' + (on ? ' class="on' + (lk ? ' lk' : '') + '"' : lk ? ' class="lk"' : '') + '><kbd>' + (i + 1) + '</kbd>' + (lk ? '<i class="ku-lock"></i>' : '') + '<em style="font-style:normal">' + esc(on ? (l.name || ch.name) : ch.name) + '</em></span>';
    }
    D.lo.innerHTML = s;
  }
  function paintSalvage(total) { const v = total != null ? total : (G.progress ? G.progress.salvage : 0); if (D.salv._n !== v) { D.salv._n = v; D.salv.textContent = fmt(v); } }
  function renderPerks() {               // taken perks as small plates above the vitals
    const P = G.progress, list = (P && P.perks) || []; let s = '';
    for (const id of list) { const p = P.PERKS.find(q => q.id === id); if (!p) continue; const w = p.name.split(/\s+/); s += '<i title="' + esc(p.name + ': ' + p.text) + '">' + esc((w[0][0] + (w[1] ? w[1][0] : w[0][1] || '')).toUpperCase()) + '</i>'; }
    D.pk.innerHTML = s;
  }
  function openPerks(perks) {
    if (!perks || !perks.length) return;
    perkOffer = perks.slice(0, 3);
    for (let i = 0; i < 3; i++) { const b = perkBtns[i], p = perkOffer[i]; b.hidden = !p; if (p) { b.children[1].textContent = p.name; b.children[2].textContent = p.text; } }
    D.perk.hidden = false;
    const N = netOf(); c.perkSlow = !(N && N.online);       // offline: near-freeze instead of a pause (keeps pointer lock). Online the clock is shared: never touch it
    if (c.perkSlow) G.timeScale = 0.05;
  }
  function closePerks() { if (!perkOffer) return; perkOffer = null; D.perk.hidden = true; if (c.perkSlow) { c.perkSlow = false; G.timeScale = 1; } }
  function pickPerk(i) {
    const p = perkOffer && perkOffer[i]; if (!p) return false;
    try { if (G.progress && G.progress.takePerk) G.progress.takePerk(p.id); } catch (e) {}
    try { if (G.audio && typeof G.audio.play === 'function') G.audio.play('ui_click'); } catch (e) {}
    closePerks(); renderPerks(); toast(p.name, p.text, 'good', 3.5); return true;
  }
  D.perk.addEventListener('click', e => { const b = e.target.closest('button[data-pi]'); if (b) pickPerk(+b.dataset.pi); });
  function tipHTML(s) { return esc(s).replace(/\[([^\]]+)\]/g, '<kbd>$1</kbd>'); }
  function queueTips(list) { for (const s of list) tipQ.push(s); }
  function clearTips() { tipQ.length = 0; tipT = 0; tipGap = 0; D.tips.className = 'ku-tips'; }
  function addArc(x, z, strength) {
    let a = arcs[0];
    for (const o of arcs) { if (o.t <= 0) { a = o; break; } if (o.t < a.t) a = o; }
    // merge with a live arc from nearly the same spot
    for (const o of arcs) if (o.t > 0 && Math.abs(o.x - x) + Math.abs(o.z - z) < 4) { a = o; break; }
    a.x = x; a.z = z; a.t = 1.6; a.str = strength;
  }

  // ---- bus handlers (ui.js wires these; the demo calls them directly) ----------------------------------------
  const on = {
    'ent:damage'(d) {
      const Pl = view.state.player, e = d.ent, info = d.info || {};
      if (!e) return;
      if (isPlayers(Pl, e) && (e === me || e.isPlayer)) {
        const f = sat(d.amount / Math.max(1, e.maxHp || 100) * (e.kind === 'mech' ? 9 : 3.2));
        c.flash = Math.min(1, Math.max(c.flash, 0.25 + f * 0.75));
        const s = info.src;
        if (s && s !== e && s.pos && !isPlayers(Pl, s)) addArc(s.pos.x, s.pos.z, f);
        else if (typeof info.x === 'number' && typeof info.z === 'number' && (Math.abs(info.x - e.pos.x) + Math.abs(info.z - e.pos.z)) > 0.8) addArc(info.x, info.z, f);
      } else if (e.team === 1 && isPlayers(Pl, info.src)) anim(D.hit, HIT_F, 240);
    },
    'ent:death'(d) {
      const Pl = view.state.player, e = d.ent, info = d.info || {};
      if (e && e.team === 1 && isPlayers(Pl, info.src)) anim(D.kill, KILL_F, 420);
      for (let i = lockedSet.length - 1; i >= 0; i--) if (lockedSet[i] === e) lockedSet.splice(i, 1);
      for (const a of aces) if (a.ent === e) a.ent = null;
    },
    shot(d) { if (d && d.shooter && d.shooter === me) xh.kick = Math.min(9, xh.kick + (d.weapon === 'pulse' ? 1.5 : d.weapon === 'rifle' ? 2.2 : 5)); },
    score(d) {
      if (!d) return; let label = d.label || 'Kill';
      const N = netOf(); if (N && N.online) { const w = d.name || (d.by && (typeof d.by === 'string' ? d.by : peerName(d.by))) || (d.player && d.player.name); if (w) label = w + ' \u00b7 ' + label; }
      pushFeed(label, d.points);
    },
    'player:revived'(d) { if (!d || !d.remote) toast('Back in the fight', '', 'good', 2.5); },
    'building:levelled'(d) { if (d && d.name) pushFeed(d.name + ' levelled', 0); },
    'ui:message'(d) { if (d) toast(d.text, d.sub, d.kind, d.dur); },
    'wave:start'(d) { d = d || {}; banner('Wave ' + pad2(d.n || view.state.wave.n || 1), d.label || (d.total ? d.total + ' hostiles inbound' : 'Vanta inbound'), false); },
    'wave:clear'(d) { banner('Wave clear', 'Next wave inbound', true); },
    'lock:warning'(d) { c.warnOn = !!(d && d.on); c.warnT = 8; },
    lock(d) {
      if (!d) return;
      if (d.state === 'locked' && d.target) { if (lockedSet.indexOf(d.target) < 0 && lockedSet.length < N_LOCK - 1) lockedSet.push(d.target); }
      else if (d.state === 'lost') { if (d.target) { const i = lockedSet.indexOf(d.target); if (i >= 0) lockedSet.splice(i, 1); } else lockedSet.length = 0; }
      else if (d.state === 'fired') lockedSet.length = 0;
    },
    'mech:incoming'(d) {
      if (!d) return; const tm = d.team === 1 ? 1 : 0, inc = incoming[tm];
      inc.on = true; inc.x = d.x; inc.z = d.z; inc.t = (d.eta || 4) + 1.5;
      if (tm === 0) c.eta0 = d.eta || 0;
    },
    'mech:land'(d) { if (d) incoming[d.team === 1 ? 1 : 0].on = false; },
    'ace:charging'(d) {
      if (!d || !d.ent) return;
      let slot = null; for (const a of aces) if (a.ent === d.ent) slot = a;
      if (!slot) { for (const a of aces) if (!a.ent) { slot = a; break; } if (!slot) return; slot.ent = d.ent; slot.told = false; }
      slot.progress = d.progress || 0; slot.seen = 4;
      if (!slot.told && slot.progress >= 0.5) { slot.told = true; toast('Ace charging', 'Half way to a rig drop. Kill it now.', 'warn', 4.5); }
    },
    'ace:called'(d) { if (d) for (const a of aces) if (a.ent === d.ent) a.ent = null; },
    resize() { resize(); },
    'mission:stage'(d) {
      if (!d) return; c.stN = d.n; D.stN.textContent = d.n == null ? '' : d.n; D.stT.textContent = d.title || 'Operation Blackout';
      banner(d.title || 'Stage ' + d.n, 'Stage ' + (d.n || 1) + (d.of ? ' of ' + d.of : ' / Operation Blackout'), false);
      if (d.text) toast('Stage ' + (d.n || 1) + ' briefing', d.text, 'info', 7);
    },
    'objective:done'(d) { const o = d && d.objective; if (o && o.text) pushFeed(o.text, 0); },
    'mission:failed'(d) { toast('Operation failed', d && d.reason, 'bad', 6); },
    salvage(d) { if (!d) return; c.salvAdd = (c.salvT > 0 ? c.salvAdd : 0) + (d.amount || 0); c.salvT = 2.6; D.salvD.textContent = '+' + fmt(c.salvAdd); paintSalvage(d.total); },
    'progress:unlock'() { paintSalvage(); renderLoadouts(); },
    'perk:offer'(d) { openPerks(d && d.perks); },
    'boss:spawn'(d) { if (d && d.ent) { bossE = d.ent; c.bossLag = 0; } },
    'boss:dead'() { bossE = null; },
    'perk:taken'() { renderPerks(); },
    'bay:changed'() { renderLoadouts(); },
  };

  // ---- per-frame --------------------------------------------------------------------------------------------
  function hasMarker(mks, o) {
    if (!mks) return false;
    for (let i = 0; i < mks.length; i++) { const m = mks[i]; if (!m || m.active === false) continue; if ((o.ent && m.ent === o.ent) || (typeof m.x === 'number' && Math.abs(m.x - o.x) + Math.abs(m.z - o.z) < 4)) return true; }
    return false;
  }
  function placeMark(i, wx, wy, wz, cls, lab, sk, sv) {
    const mk = marks[i], p = project(wx, wy, wz, c.mxX, c.mxY);
    const yMax = (G.height || innerHeight) - c.mxB;
    const x = Math.round(p.x), y = Math.round(p.y > yMax ? yMax : p.y);
    show(mk.el, true);
    if (x !== mk.x || y !== mk.y) { mk.x = x; mk.y = y; mk.el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }
    const full = p.on ? cls : cls + ' off';
    if (full !== mk.cls) { mk.cls = full; mk.el.className = 'ku-mk ' + full; }
    if (!p.on) { const rot = Math.round(p.ang * 57.2958 / 3) * 3; if (rot !== mk.rot) { mk.rot = rot; mk.ar.style.transform = 'rotate(' + rot + 'deg)'; } }
    if (lab !== mk.lab) { mk.lab = lab; mk.b.textContent = lab; }
    if (sk !== mk.sk || sv !== mk.sv) {
      mk.sk = sk; mk.sv = sv;
      mk.sp.textContent = sk === 4 ? 'Down \u00b7 ' + sv + ' m' : sk === 1 ? sv + ' m' : sk === 2 ? 'T-' + (sv / 10).toFixed(1) : sk === 3 ? sv + '%' : '';
    }
  }
  function placeLock(i, e, prog, locked) {
    const lk = locks[i], h = e.height || 2, p = project(e.pos.x, e.pos.y + h * 0.5, e.pos.z, 0, 0);
    if (!p.on || p.depth < 0.5) { show(lk.el, false); return; }
    const hpx = (G.height || innerHeight) * 0.5 * G.camera.projectionMatrix.elements[5] / p.depth;
    let s = Math.max(c.em * 2.4, Math.max(h, (e.radius || 1) * 2) * hpx * 1.15);
    if (!locked) s *= 1.9 - 0.9 * sat(prog);
    s = Math.round(s / 2) * 2;
    const x = Math.round(p.x - s / 2), y = Math.round(p.y - s / 2);
    show(lk.el, true);
    if (s !== lk.s) { lk.s = s; lk.el.style.width = lk.el.style.height = s + 'px'; }
    if (x !== lk.x || y !== lk.y) { lk.x = x; lk.y = y; lk.el.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)'; }
    const st = locked ? 100 : Math.round(sat(prog) * 10);
    if (st !== lk.st) { lk.st = st; lk.el.className = locked ? 'ku-lk locked' : 'ku-lk'; lk.b.textContent = locked ? 'Lock' : 'Locking ' + st * 10 + '%'; }
  }

  function update(dt) {
    const S = view.state, Pl = S.player, Wv = S.wave, cam = G.camera, t = performance.now() / 1000;
    const mech = Pl.mode === 'mech';
    me = Pl.ent || (mech ? Pl.mech : Pl.pilot) || null;
    c.frame++;

    // camera heading in the ground plane
    const ce = cam.matrixWorld.elements; let fx = -ce[8], fz = -ce[10]; const fl = Math.hypot(fx, fz);
    if (fl > 0.05) { c.fx = fx / fl; c.fz = fz / fl; }
    fx = c.fx; fz = c.fz;
    const px0 = me && me.pos ? me.pos.x : cam.position.x, pz0 = me && me.pos ? me.pos.z : cam.position.z;

    // ---- vitals
    const pilotE = Pl.pilot || (!mech ? Pl.ent : null), mechE = Pl.mech || (mech ? Pl.ent : null), prim = mech ? mechE : pilotE;
    if (c.mech !== mech) {
      c.mech = mech;
      D.vitLab.textContent = mech ? ((Pl.chassis && G.rigs && G.rigs.CHASSIS[Pl.chassis] ? G.rigs.CHASSIS[Pl.chassis].name : 'Rig') + ' armour') : 'Pilot';
      D.jetLab.textContent = mech ? 'Jets' : 'Jetpack';
      show(D.miniPil, mech);
      D.hints.innerHTML = mech ? HINTS.mech : HINTS.pilot;
      c.lag = 0; D.vitMax._n = null; tog(D.bot, 'mech', mech);
    }
    const hp = prim ? Math.max(0, prim.hp) : 100, hpMax = prim ? (prim.maxHp || 100) : 100, hf = sat(hp / hpMax);
    setNum(D.vitNum, Math.ceil(hp));
    if (mech) { if (D.vitMax._n !== hpMax) { D.vitMax._n = hpMax; D.vitMax.textContent = '/ ' + Math.round(hpMax); } }
    else if (D.vitMax._n !== 0) { D.vitMax._n = 0; D.vitMax.textContent = ''; }
    setBar(D.hpFill, hf);
    if (hf >= c.lag) { c.lag = hf; c.lagHold = 0.45; } else if (c.lagHold > 0) c.lagHold -= dt; else c.lag = Math.max(hf, c.lag - dt * 0.5);
    setBar(D.hpLag, c.lag);
    tog(D.vit, 'low', hf < 0.3);
    if (mech) {
      const ph = pilotE ? Math.max(0, pilotE.hp) : 100, pm = pilotE ? (pilotE.maxHp || 100) : 100;
      setBar(D.pilFill, ph / pm); setNum(D.pilNum, Math.ceil(ph)); tog(D.miniPil, 'low', ph / pm < 0.3);
    }
    const tg = mech ? 0 : Pl.inCover ? 1 : Pl.slide ? 2 : Pl.roll ? 3 : Pl.crouch ? 4 : 0;
    if (tg !== c.tag) { c.tag = tg; show(D.tag, tg > 0); if (tg) { D.tag.textContent = tg === 1 ? 'In cover' : tg === 2 ? 'Slide' : tg === 3 ? 'Roll' : 'Crouch'; tog(D.tag, 'cov', tg === 1); } }
    // equipment (PLAYER writes state.player.equip only when fitted)
    const eq = mech ? Pl.equip : null, shd = eq && eq.shield, grp = eq && eq.grapple;
    show(D.eq, !!(shd || grp)); 
    if (shd || grp) {
      show(D.shd, !!shd); show(D.grp, !!grp);
      if (shd) { const en = sat(shd.energy == null ? 1 : shd.energy); setBar(D.shdFill, en); tog(D.shd, 'up', !!shd.on); tog(D.shd, 'low', en < 0.25); }
      if (grp) { const gs = grp.state || 'ready'; if (gs !== c.grpSt) { c.grpSt = gs; D.grpTxt.textContent = gs === 'idle' || gs === 'ready' ? 'Ready' : String(gs); tog(D.grp, 'live', !(gs === 'idle' || gs === 'ready')); } }
    }
    const jet = Pl.jet == null ? 1 : Pl.jet; setBar(D.jetFill, jet); tog(D.miniJet, 'low', jet < 0.2);

    // low-health vignette + damage flash
    let vg = Pl.mode === 'down' ? 0.7 : sat((0.5 - hf) / 0.42); vg = vg * (REDUCED ? 0.9 : 0.82 + 0.18 * Math.sin(t * (4 + vg * 4)));
    if (Pl.mode === 'dead') vg = 1;
    vg = Math.round(vg * 40) / 40;
    if (vg !== c.vig) { c.vig = vg; D.vig.style.opacity = vg; }
    if (c.flash > 0 || D.flash._o) {
      c.flash = Math.max(0, c.flash - dt * 2.4);
      const o = Math.round(c.flash * 20) / 20; if (D.flash._o !== o) { D.flash._o = o; D.flash.style.opacity = o; }
    }

    // ---- rig meter
    const inc = Pl.mechIncoming || 0;
    const waiting = !mech && mechE && mechE.alive !== false && !inc;
    const mst = mech ? 'mech' : inc > 0 ? 'drop' : waiting ? 'wait' : Pl.mechReady ? 'ready' : 'fill';
    if (mst !== c.meterSt) {
      c.meterSt = mst; show(D.mt, mst !== 'mech'); show(D.lo, mst === 'fill' || mst === 'ready'); D.mt.className = 'ku-mt ' + mst;
      D.mtLab.textContent = mst === 'drop' ? 'Rig inbound' : mst === 'wait' ? 'Warden standing by' : 'Rig drop';
      D.mtVal._n = null; if (mst === 'drop' && !(c.eta0 >= inc)) c.eta0 = inc;
    }
    if (mst === 'fill') { const m = sat(Pl.meter || 0), pc = Math.floor(m * 100); setBar(D.mtFill, m); if (D.mtVal._n !== pc) { D.mtVal._n = pc; D.mtVal.textContent = pc + '%'; } }
    else if (mst === 'drop') { if (inc > c.eta0) c.eta0 = inc; const k = Math.ceil(inc * 10); setBar(D.mtFill, 1 - inc / (c.eta0 || 1)); if (D.mtVal._n !== k) { D.mtVal._n = k; D.mtVal.textContent = 'T-' + (k / 10).toFixed(1); } }
    else if (mst === 'wait') { const d = Math.round(Math.hypot(mechE.pos.x - px0, mechE.pos.z - pz0)); setBar(D.mtFill, 1); if (D.mtVal._n !== d) { D.mtVal._n = d; D.mtVal.textContent = d + ' m'; } }

    // ---- weapons
    const ws = Pl.weapons || [], act = Pl.activeWeapon | 0;
    tog(D.wps, 'many', ws.length >= 4);
    for (let i = 0; i < N_WP; i++) {
      const cd = wps[i], w = ws[i];
      if (!w) { if (cd.cls !== '') { cd.cls = ''; cd.el.className = 'ku-wp'; cd.w = null; } continue; }
      if (cd.w !== w || cd.mech !== mech || cd.many !== (ws.length >= 4)) {
        cd.w = w; cd.mech = mech; cd.stc = -1; cd.num._n = null; cd.unit._t = null;
        cd.many = ws.length >= 4;
        cd.name.textContent = (cd.many && (w.short || (w.def && w.def.short) || SHORT[w.id])) || w.name || w.id || 'Weapon';
        cd.key.textContent = w.key || (w.def && w.def.key) || KEY_BY_ID[w.id] || KEY_BY_IDX[i] || '';
      }
      let cls = 'ku-wp on', stc = 0, val = 0, bar = 0;
      const kind = w.kind;
      if (kind === 'heat') {
        const h = sat(w.heat || 0); val = Math.round(h * 100); bar = h;
        if (w.overheated) { cls += ' bad'; stc = 11; } else if (h > 0.7) { cls += ' hot'; stc = 12; } else stc = 10;
        if (cd.unit._t !== '%') { cd.unit._t = '%'; cd.unit.textContent = '%'; }
      } else if (kind === 'charge' || kind === 'lock') {
        const ch = sat(w.charge == null ? 1 : w.charge), rdy = ch >= 0.999 && w.ready !== false;
        val = Math.floor(ch * 100); bar = ch;
        if (!rdy) { cls += ' wait'; stc = 20; }
        else if (kind === 'lock') { stc = Pl.lock && (Pl.lock.locked || c.lockedN > 0) ? 23 : Pl.lock && Pl.lock.target ? 22 : 24; cls += ' rdy'; }
        else { stc = 21; cls += ' rdy'; }
        if (cd.unit._t !== '%') { cd.unit._t = '%'; cd.unit.textContent = '%'; }
      } else {
        const mx = w.clipMax || 0, cl = w.clip | 0; val = cl;
        if (w.reloading > 0) { bar = sat(w.reloading); cls += ' wait'; stc = 31; }
        else { bar = mx ? cl / mx : 1; if (cl <= 0 && mx) { cls += ' bad'; stc = 32; } else if (mx && cl <= mx * 0.25 && mx > 2) { cls += ' hot'; stc = 33; } else stc = 30; }
        if (cd.unit._t !== mx) { cd.unit._t = mx; cd.unit.textContent = mx ? '/ ' + mx : ''; }
      }
      if (i === act) cls += ' act';
      if (cls !== cd.cls) { cd.cls = cls; cd.el.className = cls; }
      setNum(cd.num, val); setBar(cd.bar, bar);
      if (stc !== cd.stc) {
        cd.stc = stc;
        cd.st.textContent = stc === 10 ? 'Heat' : stc === 11 ? 'Overheat' : stc === 12 ? 'Hot' : stc === 20 ? 'Charging' : stc === 21 ? 'Ready' : stc === 22 ? 'Locking' : stc === 23 ? 'Locked' : stc === 24 ? 'Hold to lock'
          : stc === 31 ? 'Reloading' : stc === 32 ? 'Empty' : stc === 33 ? 'Low' : '';
      }
    }

    // ---- crosshair
    const aw = ws[act] || ws[0], lockActive = !!(Pl.lock && Pl.lock.target);
    const variant = lockActive ? 'lock' : aw ? (XH_BY_ID[aw.id] || XH_BY_KIND[aw.kind] || 'none') : 'none';
    if (variant !== xh.cur) { D.xh.classList.remove('x-' + xh.cur); D.xh.classList.add('x-' + variant); xh.cur = variant; xh.bloom = -1; }
    let target = 0;
    if (me && me.vel && !mech) target += Math.min(5, Math.hypot(me.vel.x, me.vel.z) * 0.45);
    if (aw) {
      if (aw.spread > 0) target += aw.spread * (G.height || 720) * 0.5 * cam.projectionMatrix.elements[5] * (120 / (c.em * 9.4));
      if (aw.kind === 'heat') target += (aw.heat || 0) * 5;
    }
    xh.kick = Math.max(0, xh.kick - dt * 26);
    xh.b += (target + xh.kick - xh.b) * (1 - Math.exp(-22 * dt));
    const bq = Math.round(Math.min(26, xh.b) * 2) / 2;
    if (bq !== xh.bloom) {
      xh.bloom = bq; const tl = xh.ticks[variant];
      for (let i = 0; i < tl.length; i++) tl[i].el.setAttribute('transform', 'translate(' + tl[i].dx * bq + ' ' + tl[i].dy * bq + ')');
    }
    let af = 1, acl = 0;
    if (aw) {
      if (aw.kind === 'heat') { af = sat(aw.heat || 0); acl = aw.overheated ? 2 : af > 0.7 ? 1 : 0; }
      else if (aw.kind === 'charge' || aw.kind === 'lock') af = sat(aw.charge == null ? 1 : aw.charge);
      else if (aw.reloading > 0) { af = sat(aw.reloading); acl = 1; }
      else if (aw.clipMax) { af = (aw.clip | 0) / aw.clipMax; acl = af <= 0 ? 2 : af <= 0.25 ? 1 : 0; }
    }
    const aq = Math.round(af * 100);
    if (aq !== xh.arc) { xh.arc = aq; D.xhArc.setAttribute('stroke-dasharray', aq + ' 100'); }
    if (acl !== xh.arcCls) { xh.arcCls = acl; D.xhArc.setAttribute('class', acl === 2 ? 'arc-v bad' : acl === 1 ? 'arc-v hot' : 'arc-v'); }

    // ---- damage arcs
    for (let i = 0; i < N_ARC; i++) {
      const a = arcs[i]; if (a.t <= 0) { if (a.op !== 0) { a.op = 0; a.el.style.opacity = 0; } continue; }
      a.t -= dt;
      const dx = a.x - px0, dz = a.z - pz0, r = dx * -fz + dz * fx, u = dx * fx + dz * fz;
      const rot = Math.round(Math.atan2(r, u) * 57.2958 / 2) * 2;
      if (rot !== a.rot) { a.rot = rot; a.el.setAttribute('transform', 'rotate(' + rot + ')'); }
      const op = a.t <= 0 ? 0 : Math.round(sat(a.t / 0.9) * (0.6 + 0.4 * a.str) * 16) / 16;
      if (op !== a.op) { a.op = op; a.el.style.opacity = op; }
    }

    // ---- warning, prompt
    if (c.warnOn) { c.warnT -= dt; if (c.warnT <= 0) c.warnOn = false; }
    show(D.warn, c.warnOn);
    const pr = Pl.prompt || '';
    if (pr !== c.promptRaw) {
      c.promptRaw = pr;
      const quiet = !pr || /^rig (inbound|waiting)$/i.test(pr) || /next teammate/i.test(pr);      // the rig meter already says these
      show(D.prompt, !quiet);
      if (!quiet) {
        let m = /^\s*\[?\s*((?:LMB|RMB|[A-Za-z0-9]{1,5})(?:\s*\/\s*(?:LMB|RMB|[A-Za-z0-9]{1,5}))?)\s*\]?\s*[\u2014\u2013\-:\u00b7|]\s*(.+)$/.exec(pr), key = '', txt = pr;
        if (m) { key = m[1]; txt = m[2]; }
        else if ((m = /^\s*(hold|release)\s+(\w{1,5})\s*[\u2014\u2013\-:]\s*(.+)$/i.exec(pr))) { key = m[2]; txt = m[1] + ': ' + m[3]; }
        else if ((m = /^\s*(press|hold)\s+\[?(\w{1,5})\]?\s+(?:to\s+)?(.+)$/i.exec(pr))) { key = m[2]; txt = (m[1].toLowerCase() === 'hold' ? 'Hold to ' : '') + m[3]; }
        D.prompt.children[0].textContent = key; D.prompt.children[0].hidden = !key; D.prompt.children[1].textContent = txt;
        D.prompt.className = key ? 'ku-prompt' : 'ku-prompt nokey';
      }
    }

    // ---- wave status
    const inter = Wv.intermission > 0, wst = Wv.n <= 0 && !inter ? 0 : inter ? 2 : 1;
    if (wst !== c.waveSt) { c.waveSt = wst; D.wvL.textContent = wst === 2 ? 'Next wave' : wst === 0 ? 'Stand by' : 'Hostiles'; tog(D.wave, 'inter', wst !== 1); D.wvC._n = null; }
    if (D.wvN._n !== Wv.n) { D.wvN._n = Wv.n; D.wvN.textContent = pad2(Math.max(0, Wv.n | 0)); }
    if (wst === 2) { const s = Math.ceil(Wv.intermission); if (D.wvC._n !== s) { D.wvC._n = s; D.wvC.textContent = '0:' + pad2(s); } if (!(c.inter0 >= Wv.intermission)) c.inter0 = Wv.intermission; setBar(D.wvBar, 1 - Wv.intermission / (c.inter0 || 8)); }
    else { c.inter0 = 0; setNum(D.wvC, wst === 0 ? '–' : Math.max(0, Wv.alive | 0)); setBar(D.wvBar, Wv.total > 0 ? Wv.alive / Wv.total : 0); }
    const em = Wv.enemyMechs | 0;
    if (em !== c.mechsN) { c.mechsN = em; show(D.wvMech, em > 0); if (em > 0) D.wvMech.textContent = em > 1 ? 'Vanta rigs × ' + em : 'Vanta rig on the field'; }

    // ---- co-op: teammate plates, revive, spectating, link state (all hidden and free offline)
    const N = view.net || G.net, online = !!(N && N.online);
    if (online !== c.online) { c.online = online; show(D.net, online); c.netK = null; if (!online) { show(D.team, false); show(D.rev, false); show(D.spec, false); } }
    if (online) {
      if ((c.frame % 20) === 0) {
        const pg = Math.round(N.ping || 0), nk = pg + (N.isHost ? 1e5 : 0);
        if (nk !== c.netK) { c.netK = nk; D.net.innerHTML = (N.isHost ? '<em>Host</em>' : '') + '<span>' + esc(N.room || '') + '</span><span>' + pg + ' ms</span>'; }
      }
      let k = 0;
      if (N.peers) for (const p of N.peers.values()) {
        if (!p || p.id === N.id) continue; if (k >= 3) break;
        const r = teamRows[k++], e = p.ent && p.ent.pos ? p.ent : null, down = peerDown(p), rig = !!(e && e.kind === 'mech');
        const nm = p.name || 'Pilot ' + p.id; if (nm !== r.name) { r.name = nm; r.b.textContent = nm; }
        const cls = 'ku-tm on' + (down ? ' down' : '') + (rig ? ' rig' : ''); if (cls !== r.cls) { r.cls = cls; r.el.className = cls; r.d = -1; }
        const hf = down ? 0 : e && e.maxHp ? Math.max(0, e.hp) / e.maxHp : p.state && typeof p.state.hp === 'number' ? p.state.hp : 1;
        setBar(r.bar, hf);
        const d = e ? Math.round(Math.hypot(e.pos.x - px0, e.pos.z - pz0)) : -2;
        if (d !== r.d) { r.d = d; r.em.textContent = down ? (d >= 0 ? 'Down \u00b7 ' + d + ' m' : 'Down') : d >= 0 ? d + ' m' : ''; }
      }
      for (let i = k; i < 3; i++) { const r = teamRows[i]; if (r.cls !== 'ku-tm') { r.cls = 'ku-tm'; r.el.className = 'ku-tm'; } }
      show(D.team, k > 0);
      const rv = Pl.revive, rvE = rv && rv.ent;
      show(D.rev, !!rvE);
      if (rvE) { setBar(D.revFill, rv.progress || 0); if (rvE !== c.revE) { c.revE = rvE; D.revT.textContent = 'Hold to revive ' + peerName(rvE); } } else c.revE = null;
      const dwn = Pl.mode === 'down' || Pl.down === true;
      show(D.spec, dwn);
      if (dwn) { const sp = Pl.spectating || null; if (sp !== c.specE) { c.specE = sp; D.specT.textContent = sp ? 'Spectating ' + peerName(sp) + '. A teammate can revive you.' : 'A teammate can revive you.'; } }
    }

    // ---- operation: stage line, objective tracker, relay and boss gauges
    const op = S.mode === 'operation';
    if (op !== c.op) { c.op = op; show(D.wave, !op); show(D.stage, op); }
    const Mi = view.mission || G.mission, obs = Mi && Mi.objectives;
    if (op && c.stN == null && Mi && typeof Mi.stage === 'number' && D.stN._n !== Mi.stage) { D.stN._n = Mi.stage; D.stN.textContent = Mi.stage; }
    let rN = 0, defend = null;
    if (obs && obs.length) for (let i = 0; i < obs.length; i++) {
      const o = obs[i]; if (!o) continue;
      if (o.done || o.failed) { o._kuT = (o._kuT || 0) + dt; if (o._kuT > 5) continue; }
      else if (o.kind === 'defend' && !defend) defend = o;
      if (rN >= N_OBJ) continue;
      const r = objRows[rN++];
      if (r.o !== o) { r.o = o; r.txt = r.sub = r.rk = null; r.st = r.pq = -1; }
      if (o.text !== r.txt) { r.txt = o.text; r.b.textContent = o.text || ''; }
      const sub = o.sub || ''; if (sub !== r.sub) { r.sub = sub; r.sp.textContent = sub; r.sp.hidden = !sub; }
      const st = o.failed ? 2 : o.done ? 1 : 0;
      if (st !== r.st) { r.st = st; r.el.className = 'ku-ob on' + (st === 1 ? ' done' : st === 2 ? ' fail' : o.kind === 'defend' ? ' def' : ''); }
      const pq = Math.round(sat(o.done ? 1 : o.progress || 0) * 100);
      if (pq !== r.pq) { r.pq = pq; r.bar.style.transform = 'scaleX(' + pq / 100 + ')'; }
      const tm = o.timer != null && o.timer >= 0 ? Math.ceil(o.timer) : -1;
      const rk = st === 1 ? -1 : st === 2 ? -2 : tm >= 0 ? 1e6 + tm : o.total > 0 ? 2e6 + (o.count | 0) * 1000 + o.total : 3e6 + pq;
      if (rk !== r.rk) { r.rk = rk; r.em.textContent = st === 1 ? 'Done' : st === 2 ? 'Failed' : tm >= 0 ? Math.floor(tm / 60) + ':' + pad2(tm % 60) : o.total > 0 ? (o.count | 0) + ' / ' + o.total : pq + '%'; }
    }
    for (let i = rN; i < N_OBJ; i++) { const r = objRows[i]; if (r.o) { r.o = null; r.el.className = 'ku-ob'; } }
    show(D.obj, rN > 0);
    if ((c.frame & 15) === 0) {            // look for the things the gauges track
      if (bossE && bossE.alive === false) bossE = null;
      relayE = null; const E = view.ents;
      for (let n = 0; n < E.length; n++) { const e = E[n]; if (!e.alive) continue; if (e.team === 1 && (e.variant === 'dreadnought' || e.boss)) { if (!bossE) bossE = e; } else if (e.team === 0 && e.kind === 'prop' && e.maxHp > 0 && !relayE) relayE = e; }
    }
    const rl = defend ? (defend.ent || defend.target || relayE) : null;
    const rlF = !defend ? -1 : rl && rl.maxHp ? Math.max(0, rl.hp) / rl.maxHp : typeof defend.hp === 'number' ? defend.hp / (defend.maxHp || 1) : -1;
    show(D.relay, rlF >= 0);
    if (rlF >= 0) { setBar(D.relayFill, rlF); setNum(D.relayV, Math.round(rlF * 100)); tog(D.relay, 'low', rlF < 0.3); }
    const bs = bossE && bossE.alive !== false ? bossE : null;
    show(D.boss, !!bs);
    if (bs) {
      const bf = sat(Math.max(0, bs.hp) / (bs.maxHp || 1)), bp = bs.phase > 0 ? bs.phase | 0 : bf > 0.66 ? 1 : bf > 0.33 ? 2 : 3;
      setBar(D.bossFill, bf);
      if (!(c.bossLag >= bf)) c.bossLag = bf; else c.bossLag = Math.max(bf, c.bossLag - dt * 0.12);
      setBar(D.bossLag, c.bossLag);
      if (bp !== c.bossP) { c.bossP = bp; D.bossP.textContent = 'Phase ' + bp + ' / 3'; tog(D.boss, 'rage', bp >= 3); }
      const bn = bs.name || 'Dreadnought'; if (bn !== c.bossN) { c.bossN = bn; D.bossN.textContent = bn; }
    } else c.bossLag = 0;
    if (c.salvT > 0) { c.salvT -= dt; if (c.salvT <= 0) D.salvD.textContent = ''; }

    // ---- score
    if (D.score._n !== Pl.score) { D.score._n = Pl.score; D.score.textContent = fmt(Pl.score || 0); }
    setNum(D.kills, Pl.kills | 0);
    const combo = Pl.combo | 0;
    if (combo !== c.combo) { c.combo = combo; show(D.combo, combo > 1); if (combo > 1) D.combo.textContent = 'Combo ×' + combo; }
    if (feedN) {
      let ch = false;
      for (let i = 0; i < feedN; i++) feed[i].t -= dt;
      while (feedN && feed[feedN - 1].t <= 0) { feedN--; ch = true; }
      if (ch) renderFeed();
    }

    // ---- banner / toasts / tips
    if (c.banPend) { c.banPend = false; D.ban.classList.add('on'); }
    else if (c.ban > 0) { c.ban -= dt; if (c.ban <= 0) D.ban.classList.remove('on'); }
    for (let i = 0; i < N_TOAST; i++) {
      const s = toasts[i]; if (s.t <= 0) continue;
      s.t -= dt;
      if (s.t <= 0) { s.el.className = 'ku-toast'; s.text = ''; }
      else if (s.t < 0.3 && !s.out) { s.out = true; s.el.classList.add('out'); }
    }
    if (tipT > 0) { tipT -= dt; if (tipT <= 0) { D.tips.className = 'ku-tips'; tipGap = 0.6; } }
    else if (tipGap > 0) tipGap -= dt;
    else if (tipQ.length) { tipsP.innerHTML = tipHTML(tipQ.shift()); D.tips.className = 'ku-tips on'; tipT = 7; }

    // ---- compass + radar
    let hdg = Math.round(Math.atan2(fx, -fz) * 57.2958); if (hdg < 0) hdg += 360;
    if (D.hdg._n !== hdg) { D.hdg._n = hdg; D.hdg.textContent = (hdg < 10 ? '00' : hdg < 100 ? '0' : '') + hdg; }
    for (let tm = 0; tm < 2; tm++) if (incoming[tm].on) { incoming[tm].t -= dt; if (incoming[tm].t <= 0) incoming[tm].on = false; }
    if ((c.frame & 1) === 0 && c.radarPx > 4) drawRadar(px0, pz0, t);

    // ---- world markers
    let n = 0;
    if (waiting && mechE.pos) {
      const d = Math.round(Math.hypot(mechE.pos.x - px0, mechE.pos.z - pz0));
      if (d > 5) placeMark(n++, mechE.pos.x, mechE.pos.y + (mechE.height || 8.5) + 1.2, mechE.pos.z, '', 'Warden', 1, d);
    }
    if (incoming[0].on && inc > 0) placeMark(n++, incoming[0].x, G.GROUND_Y + 1, incoming[0].z, 'pulse', 'Rig drop', 2, Math.ceil(inc * 10));
    if (incoming[1].on) placeMark(n++, incoming[1].x, G.GROUND_Y + 1, incoming[1].z, 'bad pulse', 'Vanta drop', 1, Math.round(Math.hypot(incoming[1].x - px0, incoming[1].z - pz0)));
    for (let i = 0; i < aces.length && n < N_MARK; i++) {
      const a = aces[i]; if (!a.ent) continue;
      a.seen -= dt; if (a.seen <= 0 || a.ent.alive === false || !a.ent.pos) { a.ent = null; continue; }
      placeMark(n++, a.ent.pos.x, a.ent.pos.y + (a.ent.height || 1.8) + 0.9, a.ent.pos.z, a.progress > 0.75 ? 'bad' : 'warn', 'Ace', 3, Math.round(sat(a.progress) * 100));
    }
    const mks = Mi && Mi.markers;
    if (obs) for (let i = 0; i < obs.length && n < N_MARK; i++) {
      const o = obs[i]; if (!o || o.done || o.failed || typeof o.x !== 'number' || typeof o.z !== 'number') continue;
      if (hasMarker(mks, o)) continue;          // MISSION already marks this one (relay, core, boss, depot)
      placeMark(n++, o.x, (typeof o.y === 'number' ? o.y : G.GROUND_Y) + 2.5, o.z, o.kind === 'defend' ? 'obj def' : 'obj', o.label || OBJ_LABEL[o.kind] || 'Objective', 1, Math.round(Math.hypot(o.x - px0, o.z - pz0)));
    }
    if (mks) for (let i = 0; i < mks.length && n < N_MARK; i++) {
      const o = mks[i]; if (!o || o.hidden || o.active === false) continue;
      const e = o.ent && o.ent.pos && o.ent.alive !== false ? o.ent : null;       // follow the entity when there is one
      const wx = e ? e.pos.x : o.x, wz = e ? e.pos.z : o.z, wy = e ? e.pos.y + (e.height || 2) + 1.2 : (typeof o.y === 'number' ? o.y : G.GROUND_Y) + 1.5;
      if (typeof wx !== 'number' || typeof wz !== 'number') continue;
      if (o.kind !== 'boss' && Math.abs(wx - px0) + Math.abs(wz - pz0) < 6) continue;       // standing on it
      placeMark(n++, wx, wy, wz, o.kind === 'relay' ? 'obj def' : o.kind === 'boss' || o.kind === 'core' ? 'obj bad' : 'obj', o.label || o.text || 'Marker', 1, Math.round(Math.hypot(wx - px0, wz - pz0)));
    }
    if (online && N.peers) for (const p of N.peers.values()) {
      if (!p || p.id === N.id || n >= N_MARK) continue; const e = p.ent; if (!e || !e.pos) continue;
      const d = Math.round(Math.hypot(e.pos.x - px0, e.pos.z - pz0)), down = peerDown(p);
      if (d < 4 && !down) continue;
      placeMark(n++, e.pos.x, e.pos.y + (e.height || 1.8) + (e.kind === 'mech' ? 1.4 : 0.7), e.pos.z, down ? 'mate bad pulse' : 'mate', p.name || 'Teammate', down ? 4 : 1, d);
    }
    for (; n < N_MARK; n++) show(marks[n].el, false);

    // ---- lock brackets
    let k = 0; c.lockedN = lockedSet.length;
    for (let i = lockedSet.length - 1; i >= 0; i--) { const e = lockedSet[i]; if (!e || e.alive === false || !e.pos) lockedSet.splice(i, 1); }
    for (let i = 0; i < lockedSet.length && k < N_LOCK; i++) placeLock(k++, lockedSet[i], 1, true);
    const lt = Pl.lock && Pl.lock.target;
    if (lt && lt.pos && lt.alive !== false && lockedSet.indexOf(lt) < 0 && k < N_LOCK) placeLock(k++, lt, Pl.lock.progress || 0, !!Pl.lock.locked);
    for (; k < N_LOCK; k++) show(locks[k].el, false);
  }

  function reset() {
    for (const a of arcs) a.t = 0;
    for (const s of toasts) { s.t = 0; s.text = ''; s.el.className = 'ku-toast'; }
    feedN = 0; renderFeed(); clearTips(); closePerks(); renderPerks(); paintSalvage(); c.stN = null; c.salvT = 0; D.salvD.textContent = ''; bossE = relayE = null;
    lockedSet.length = 0; for (const a of aces) a.ent = null;
    incoming[0].on = incoming[1].on = false;
    c.flash = 0; c.ban = 0; c.banPend = false; D.ban.className = 'ku-ban'; c.warnOn = false; c.lag = 1; c.eta0 = 0; xh.kick = 0; xh.b = 0;
  }
  resize(); renderLoadouts(); paintSalvage(); renderPerks();
  return { el, D, update, reset, on, pickPerk, closePerks, get perkOpen() { return !!perkOffer; }, toast, banner, queueTips, clearTips, resize, cache: c };
}
