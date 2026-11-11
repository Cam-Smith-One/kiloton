// Deterministic compositor: window.renderFrame(f) draws output frame f (30 fps). window.TOTAL = frame count.
const FPS = 30, $ = id => document.getElementById(id);
const cl = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const E = x => { x = cl(x); return x * x * (3 - 2 * x); };
const O = x => { x = cl(x); return 1 - Math.pow(1 - x, 3); };                 // ease-out
const io = (f, a, b, din = 10, dout = 8) => Math.min(E((f - a) / din), E((b - f) / dout));   // 0..1 visible window
const put = (el, o, dy = 0, extra = '') => { if (typeof el === 'string') el = $(el); el.style.opacity = o.toFixed(3); el.style.transform = `translateY(${((1 - o) * dy).toFixed(2)}px) ${extra}`; };
const NUM = n => String(n).padStart(4, '0');

const LOAD = ['Pouring concrete', 'Raising the skyline', 'Weakening the load paths', 'Mixing dust and fire', 'Tuning the sirens', 'Bolting the rig together', 'Loading magazines', 'Strapping the pilot in', 'Briefing Vanta', 'Marking objectives', 'Opening comms', 'Calibrating instruments', 'Ready'];
const AGENTS = ['City', 'Render', 'Destruct', 'FX', 'Audio', 'Models', 'Combat', 'Player', 'Enemy', 'UI', 'Mission', 'Net'];
const STEPS = ['Build a test harness', 'Screenshot it in a headless browser', 'Critique the picture', 'Fix it and go again'];
const SHOTS = [['destruct-d-2.6.png', 'Destruct · harness'], ['models-b1-all.png', 'Models · harness'], ['ui-d3-bay.png', 'UI · harness'], ['int-col-90.png', 'Integrated build']];
const ITEMS = ['Structural destruction', 'Pilot, then rig', 'The Rig Bay', 'Fire and gas mains', 'Operation Blackout', 'Four-player co-op'];

// ---- one-time DOM construction -------------------------------------------------
const nodePos = AGENTS.map((_, i) => { const a = (-90 - 45 + i * 30 + 15 - 30) * Math.PI / 180; return [640 + Math.cos(a) * 455, 372 + Math.sin(a) * 186]; });
$('b-nodes').innerHTML = AGENTS.map((n, i) => `<div class="node${i >= 10 ? ' late' : ''}" id="n${i}" style="left:${nodePos[i][0]}px;top:${nodePos[i][1]}px">${n}<small>${i >= 10 ? 'added later' : 'one system'}</small></div>`).join('');
$('b-svg').innerHTML = nodePos.map((p, i) => `<line id="ln${i}" x1="640" y1="372" x2="${p[0]}" y2="${p[1]}" stroke="${i >= 10 ? '#ffb23e' : '#49e0d2'}" stroke-opacity=".55" stroke-width="1.5" ${i >= 10 ? 'stroke-dasharray="5 5"' : ''}/>`).join('');
$('l-steps').innerHTML = STEPS.map((s, i) => `<div class="step" id="st${i}"><span class="mono">0${i + 1}</span><span class="t">${s}</span></div>`).join('<div class="arrow">↓</div>') + '<div class="arrow">↺ repeat</div>';
$('l-strip').innerHTML = SHOTS.map((s, i) => `<div class="shot" id="sh${i}"><div class="im"><img src="../shots/${s[0]}"></div><em>${s[1]}</em><span class="mono">shots/${s[0]}</span></div>`).join('');
$('i-items').innerHTML = ITEMS.map((s, i) => `<div class="item" id="it${i}"><i>0${i + 1}</i>${s}</div>`).join('');

// ---- slide scenes ---------------------------------------------------------------
const SLIDES = {
  title(f, n) {
    put('t-logo', O(f / 22), 0, `scaleX(.78) scale(${(1.04 - 0.04 * O(f / 40)).toFixed(4)})`);
    put('t-tag', E((f - 16) / 14), 8); put('t-bar', E((f - 24) / 10)); put('t-lab', E((f - 24) / 10));
    const u = cl((f - 28) / (n - 50)); $('t-bari').style.transform = `scaleX(${E(u).toFixed(4)})`;
    $('t-lab').textContent = LOAD[Math.min(LOAD.length - 1, Math.floor(E(u) * (LOAD.length - 0.01)))];
    put('t-f1', E((f - 40) / 14)); put('t-f2', E((f - 40) / 14));
  },
  built(f, n) {
    put('b-k', E(f / 10)); put('b-h', E((f - 4) / 14), 10, 'scaleX(.74)');
    put('b-core', E((f - 14) / 16), 0, 'translate(-50%,-50%)'); put('b-l2', E((f - 34) / 14));
    for (let i = 0; i < 12; i++) {
      const t0 = i < 10 ? 62 + i * 9 : 196 + (i - 10) * 14, u = O((f - t0) / 14), p = nodePos[i], ln = $('ln' + i);
      ln.setAttribute('x2', 640 + (p[0] - 640) * u); ln.setAttribute('y2', 372 + (p[1] - 372) * u); ln.style.opacity = u > 0 ? 1 : 0;
      put('n' + i, E((f - t0 - 6) / 10), 0, 'translate(-50%,-50%)');
    }
    put('b-line', E((f - 150) / 16), 8); put('b-stat', E((f - 236) / 16));
  },
  loop(f, n) {
    const act = f < 40 ? -1 : Math.floor((f - 40) / 34) % 4;
    for (let i = 0; i < 4; i++) { const s = $('st' + i); put(s, E((f - 10 - i * 7) / 12), 8); s.style.borderColor = i === act ? '#49e0d2' : '#ffffff26'; s.style.background = i === act ? '#132226' : '#12161b'; s.querySelector('.mono').style.color = i === act ? '#49e0d2' : '#8b9099'; }
    for (let i = 0; i < 4; i++) put('sh' + i, E((f - 44 - i * 16) / 16), 14);
    put('l-line', E((f - 140) / 16), 8);
  },
  list(f, n) { for (let i = 0; i < 6; i++) put('it' + i, E((f - 12 - i * 5) / 10), 8); },
  coop(f, n) {
    put('c-l', E((f - 6) / 14), 12); put('c-a', E((f - 16) / 14), 12); put('c-b', E((f - 26) / 14), 12); put('c-line', E((f - 46) / 16), 8); put('c-st', E((f - 60) / 16));
    const z = 1 + 0.03 * f / n; for (const id of ['c-a', 'c-b']) $(id).querySelector('img').style.transform = `scale(${z.toFixed(4)})`;
  },
  end(f, n) { put('e-logo', O(f / 20), 0, 'scaleX(.78)'); put('e-p', E((f - 16) / 12), 6); put('e-url', E((f - 24) / 14), 8); put('e-tag', E((f - 44) / 14)); put('e-b', E((f - 52) / 14)); },
};

// ---- timeline ---------------------------------------------------------------------
const C = window.CLIPS || {};          // { name: frameCount } injected by render.mjs
const clip = (name, rep = 1, max = 1e9) => ({ name, rep, n: Math.min(max, (C[name] || 0) * rep) });
const SCENES = [
  { id: 'title', slide: 'title', n: 135 },
  { id: 'city', clips: [clip('city')], caps: [{ a: 14, b: 204, mode: 'lt', l: 'One HTML page · about 1.5 MB', h: 'No asset files. Everything is code.', s: 'three.js on WebGL 2. Geometry, textures, effects, sound and music are all generated procedurally.' }] },
  { id: 'built', slide: 'built', n: 330 },
  { id: 'loop', slide: 'loop', n: 255 },
  { id: 'list', slide: 'list', n: 78 },
  { id: 'collapse', clips: [clip('collapse')], caps: [
    { a: 8, b: 108, mode: 'lt', l: '01 · Structural destruction', h: 'Remove the supports and it collapses.', s: 'Every building is a hollow structural frame of 0.5 m voxels.' },
    { a: 112, b: 210, mode: 'lt', l: '01 · Structural destruction', h: 'Rubble piles up and stays.', s: 'Falling masonry damages what it lands on.' }] },
  { id: 'pilot', clips: [clip('pilot'), clip('drop'), clip('rig')], caps: [
    { a: 8, b: 96, mode: 'plate', pos: 'br', l: '02 · Pilot, then rig', h: 'You start on foot.', s: 'Slide, roll, crouch, take cover.' },
    { a: 106, b: 304, mode: 'plate', pos: 'br', l: '02 · Pilot, then rig', h: 'Earn a rig. Call it down from orbit.', s: 'Then climb in.' }] },
  { id: 'bay', clips: [clip('bay', 2)], caps: [{ a: 10, b: 174, mode: 'plate', pos: 'bay', l: '03 · The Rig Bay', h: 'Harrier. Warden. Bastion.', s: 'Three chassis. Hardpoints, weapons, and equipment such as a shield and a grapple.' }] },
  { id: 'gas', clips: [clip('gas')], caps: [{ a: 10, b: 174, mode: 'lt', l: '04 · Fire and gas', h: 'Fire spreads. Gas mains chain-explode.', s: 'Break a main and the blast runs along the street.' }] },
  { id: 'boss', clips: [clip('boss')], caps: [{ a: 10, b: 204, mode: 'plate', pos: 'br', l: '05 · Operation Blackout', h: 'Four stages. One 17 m boss.', s: 'The mission ends with the Dreadnought.' }] },
  { id: 'coop', slide: 'coop', n: 186 },
  { id: 'end', slide: 'end', n: 186 },
];
let acc = 0; for (const s of SCENES) { if (s.clips) s.n = s.clips.reduce((a, c) => a + c.n, 0); s.start = acc; acc += s.n; }
window.TOTAL = acc; window.SCENES = SCENES.map(s => ({ id: s.id, start: s.start, n: s.n }));

const fimg = $('fimg'); let lastSrc = '';
async function setFoot(src) { if (src === lastSrc) return; lastSrc = src; fimg.src = src; await fimg.decode(); }
const PLATE_POS = { bay: { left: '500px', bottom: '16px', right: 'auto', top: 'auto', width: '470px' }, br: { right: '17px', bottom: '108px', left: 'auto', top: 'auto', width: '560px' }, tr: { right: '20px', top: '24px', left: 'auto', bottom: 'auto', width: '410px' }, bl: { left: '17px', bottom: '108px', right: 'auto', top: 'auto' } };

window.renderFrame = async function (F) {
  const sc = SCENES.find(s => F >= s.start && F < s.start + s.n) || SCENES[SCENES.length - 1], f = F - sc.start, n = sc.n;
  for (const el of document.querySelectorAll('.scene')) el.style.display = el.id === sc.slide ? 'block' : 'none';
  $('lt').style.display = 'none'; $('plate').style.display = 'none';
  if (sc.slide) { $('foot').style.display = 'none'; SLIDES[sc.slide](f, n); }
  else {
    $('foot').style.display = 'block';
    let k = f, c = sc.clips[0]; for (c of sc.clips) { if (k < c.n) break; k -= c.n; }
    await setFoot(`work/clips/${c.name}/${NUM(Math.min(C[c.name] - 1, Math.floor(k / c.rep)))}.jpg`);
    for (const cap of sc.caps || []) {
      const o = io(f, cap.a, cap.b); if (o <= 0) continue;
      if (cap.mode === 'lt') { $('lt').style.display = 'block'; $('lt').style.opacity = o; $('lt-l').textContent = cap.l; $('lt-h').textContent = cap.h; $('lt-s').textContent = cap.s; $('lt').querySelector('.in').style.transform = `translateY(${(1 - o) * 12}px)`; }
      else { const p = $('plate'); p.style.display = 'block'; Object.assign(p.style, PLATE_POS[cap.pos]); p.style.opacity = o; p.style.transform = `translateX(${(1 - o) * 16}px)`; $('pl-l').textContent = cap.l; $('pl-h').textContent = cap.h; $('pl-s').textContent = cap.s; }
    }
  }
  const first = F < 8 ? 0 : 1, last = F >= window.TOTAL - 16;
  $('black').style.opacity = Math.max(first ? 1 - E(f / 8) : 1 - E(F / 12), last ? E((F - (window.TOTAL - 16)) / 14) : 1 - E((n - f) / 6)).toFixed(3);
  $('b-stat').innerHTML = '<b>≈23,000</b> lines of source · <b>13</b> modules';
};
