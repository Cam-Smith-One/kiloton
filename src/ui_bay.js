// KILOTON — ui_bay.js   OWNER: UI. The Rig Bay: loadout builder over the live 3D preview (PLAYER draws the rig).
// Panel on the left ~38 % of the frame; the right side stays clear. Data and rules come from src/rigs.js (lead).
// Every edit: working copy -> bay.set(i, lo) when it is not overweight, state.bay.preview = lo, bus 'bay:preview'.
import { G, bus } from './core.js';
import { progress } from './progress.js';
import { SLOT_LABEL, CHASSIS, MODULES, PAINTS, DEFAULT_LOADOUTS, slotKind, platingTonnes, moduleFits, derive, sanitize, bay } from './rigs.js';

const CH_IDS = Object.keys(CHASSIS);
const MAXV = { hp: 0, speed: 0, jet: 0, capacity: 0 };
for (const id of CH_IDS) for (const k in MAXV) MAXV[k] = Math.max(MAXV[k], CHASSIS[id][k]);
const GROUP_KEY = { 1: 'LMB', 2: 'RMB', 3: 'Q' };
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hex = n => '#' + ('000000' + (n >>> 0).toString(16)).slice(-6);
const tn = v => (Math.round(v * 10) / 10).toString();
const clone = lo => ({ name: lo.name, chassis: lo.chassis, slots: Object.assign({}, lo.slots), plating: lo.plating, paint: lo.paint });

// Which key works a module in a slot of this loadout ('' = passive).
export function moduleKey(lo, slot, modId) {
  const m = MODULES[modId] || MODULES.none;
  if (m.type === 'weapon') return GROUP_KEY[(lo.groups && lo.groups[slot]) || m.group] || '';
  if (m.type === 'equip' && slotKind(slot) === 'arm') {
    const other = slot === 'armL' ? 'armR' : 'armL', om = MODULES[lo.slots[other]];
    return slot === 'armR' && om && om.type === 'equip' ? 'T' : 'G';
  }
  if (m.type === 'none' && slotKind(slot) === 'arm') return 'F';
  return '';
}

function bayHTML() {
  let tabs = '', chassis = '', paints = '';
  for (let i = 0; i < 3; i++) tabs += `<button type="button" class="ku-b-tab" role="tab" data-tab="${i}"><kbd>${i + 1}</kbd><span></span><em>Drop</em></button>`;
  const bar = (label, v) => `<div class="ku-b-sb"><span>${label}</span><i><b style="transform:scaleX(${v.toFixed(3)})"></b></i></div>`;
  for (const id of CH_IDS) {
    const c = CHASSIS[id];
    chassis += `<button type="button" class="ku-b-ch" role="radio" data-ch="${id}"><em class="ku-b-lk" hidden></em><strong>${esc(c.name)}</strong><small>${esc(c.role)}</small>
      ${bar('Armour', c.hp / MAXV.hp)}${bar('Speed', c.speed / MAXV.speed)}${bar('Jets', c.jet / MAXV.jet)}${bar('Load', c.capacity / MAXV.capacity)}</button>`;
  }
  for (const p of PAINTS) paints += `<button type="button" class="ku-b-pt" role="radio" data-paint="${p.id}" aria-label="${esc(p.name)}" title="${esc(p.name)}"><i style="background:${hex(p.armor)}"></i><i style="background:${hex(p.accent)}"></i></button>`;
  return `
<div class="ku-scr ku-bay" data-k="bay" hidden>
  <div class="ku-b-cap" data-b="cap"><small>Preview</small><b></b><span></span></div>
  <div class="ku-b-p" role="dialog" aria-label="Rig bay">
    <header class="ku-b-h"><div><small>Halden Yard / Hangar 3</small><h2>Rig bay</h2></div><div class="ku-b-sal"><span>Salvage</span><b data-b="sal">0</b></div><button type="button" class="ku-btn" data-b="back"><span>Back</span><kbd>Esc</kbd></button></header>
    <div class="ku-b-body" data-b="body">
      <div class="ku-b-tabs" role="tablist" aria-label="Loadouts">${tabs}</div>
      <label class="ku-b-name"><span>Name</span><input type="text" data-b="name" maxlength="24" spellcheck="false" autocomplete="off"></label>
      <h3>Chassis</h3>
      <div class="ku-b-chs" role="radiogroup" aria-label="Chassis">${chassis}</div>
      <p class="ku-b-blurb" data-b="blurb"></p>
      <h3>Hardpoints</h3>
      <div class="ku-b-hps" data-b="hps"></div>
      <div class="ku-b-grp" data-b="grp"></div>
      <h3>Plating</h3>
      <label class="ku-row ku-b-plate"><span data-b="plateT">0 t</span><input type="range" data-b="plate" min="0" max="1" step="0.05" aria-label="Plating"><output data-b="plateV"></output></label>
      <h3>Paint <em data-b="paintN"></em></h3>
      <div class="ku-b-pts" role="radiogroup" aria-label="Paint">${paints}</div>
    </div>
    <footer class="ku-b-f">
      <div class="ku-b-ton" data-b="ton"><div class="ku-b-ton-h"><span>Tonnage</span><b data-b="tonV"></b></div>
        <div class="ku-b-ton-b"><i data-b="tonM"></i><i class="pl" data-b="tonP"></i><u></u></div><p data-b="tonMsg"></p></div>
      <dl class="ku-b-stats"><div><dt>Armour</dt><dd data-b="sHp"></dd></div><div><dt>Speed</dt><dd data-b="sSp"></dd></div><div><dt>Dash</dt><dd data-b="sDa"></dd></div><div><dt>Jets</dt><dd data-b="sJe"></dd></div></dl>
      <div class="ku-b-btns"><button type="button" class="ku-btn pri" data-b="drop"><span>Set as drop</span></button><button type="button" class="ku-btn" data-b="reset">Reset</button><span class="ku-b-saved" data-b="saved"></span></div></footer>
  </div>
</div>`;
}

export function createBay(root, opts) {
  root.insertAdjacentHTML('beforeend', bayHTML());
  const el = root.querySelector('[data-k="bay"]'), B = {};
  for (const n of el.querySelectorAll('[data-b]')) B[n.dataset.b] = n;
  const tabs = [...el.querySelectorAll('.ku-b-tab')], chs = [...el.querySelectorAll('.ku-b-ch')], pts = [...el.querySelectorAll('.ku-b-pt')];
  const S = G.state; if (!S.bay) S.bay = { open: false, editing: 0, preview: null };
  const work = [null, null, null];          // working copies (may be overweight = not yet saved)
  let cur = 0, openSlot = '', isOpen = false, hoverMod = '';
  const lo = () => work[cur];
  const play = n => { if (opts && opts.play) opts.play(n); };

  const lockedParts = l => {            // ids in this loadout that still need buying, chassis first
    const out = []; if (!progress.isUnlocked(l.chassis)) out.push(l.chassis);
    for (const s of CHASSIS[l.chassis].slots) { const m = l.slots[s]; if (m && !progress.isUnlocked(m) && out.indexOf(m) < 0) out.push(m); }
    return out;
  };
  const partName = id => (CHASSIS[id] || MODULES[id] || { name: id }).name;
  const lockTag = id => `<em class="ku-b-lk"><i class="ku-lock"></i>${progress.cost(id)}</em>`;
  function commit(silent) {
    const l = lo(), d = derive(l);
    if (d.valid && !lockedParts(l).length) bay.set(cur, l);
    S.bay.editing = cur; S.bay.preview = l;
    bus.emit('bay:preview', { loadout: l, index: cur, valid: d.valid });
    render(); if (!silent) play('ui_click');
  }
  function slotsHTML(l, d) {
    const ch = CHASSIS[l.chassis]; let s = '';
    for (const slot of ch.slots) {
      const mid = l.slots[slot] || 'none', m = MODULES[mid] || MODULES.none, key = moduleKey(l, slot, mid), open = slot === openSlot;
      s += `<div class="ku-b-hp${open ? ' open' : ''}${mid === 'none' ? ' empty' : ''}"><button type="button" class="ku-b-hpr" data-slot="${slot}" data-f="s-${slot}" aria-expanded="${open}">
        <span class="s">${esc(SLOT_LABEL[slot])}</span><span class="m">${progress.isUnlocked(mid) ? '' : '<i class="ku-lock"></i>'}${esc(m.name)}</span>${key ? `<kbd>${key}</kbd>` : '<kbd class="no">Auto</kbd>'}<span class="t">${m.t ? tn(m.t) + ' t' : '–'}</span><i></i></button>`;
      if (open) {
        s += '<div class="ku-b-opts" role="listbox">';
        for (const id in MODULES) {
          if (!moduleFits(l.chassis, slot, id)) continue;
          const o = MODULES[id], k = moduleKey(Object.assign({}, l, { slots: Object.assign({}, l.slots, { [slot]: id }) }), slot, id);
          const over = d.tonnes - m.t + o.t > d.capacity + 1e-6;
          const lk = !progress.isUnlocked(id);
          s += `<button type="button" role="option" class="ku-b-opt${id === mid ? ' cur' : ''}${over ? ' over' : ''}${lk ? ' lockd' : ''}" aria-selected="${id === mid}" data-slot="${slot}" data-mod="${id}" data-f="o-${slot}-${id}"><span>${esc(o.name)}</span>${lk ? lockTag(id) : k ? `<kbd>${k}</kbd>` : ''}<em>${o.t ? tn(o.t) + ' t' : '–'}</em></button>`;
        }
        const show = MODULES[hoverMod] && moduleFits(l.chassis, slot, hoverMod) ? MODULES[hoverMod] : m;
        s += `<p class="ku-b-desc" data-b="desc"><b>${esc(show.name)}</b> ${esc(show.text)}</p></div>`;
      }
      s += '</div>';
    }
    return s;
  }
  function render() {
    const l = lo(); if (!l) return;
    const d = derive(l), ch = CHASSIS[l.chassis];
    for (let i = 0; i < 3; i++) {
      const w = work[i], t = tabs[i];
      t.children[1].textContent = w.name || CHASSIS[w.chassis].name;
      t.setAttribute('aria-selected', String(i === cur)); t.classList.toggle('drop', bay.active === i); t.classList.toggle('over', derive(w).over); t.classList.toggle('lock', lockedParts(w).length > 0);
    }
    if (document.activeElement !== B.name) B.name.value = l.name;
    for (const c of chs) {
      c.setAttribute('aria-checked', String(c.dataset.ch === l.chassis));
      const lk = !progress.isUnlocked(c.dataset.ch), tag = c.firstElementChild;
      c.classList.toggle('locked', lk); tag.hidden = !lk; if (lk) tag.innerHTML = '<i class="ku-lock"></i>' + progress.cost(c.dataset.ch);
    }
    B.sal.textContent = progress.salvage.toLocaleString('en-US');
    B.blurb.innerHTML = `${esc(ch.blurb)} <b>${esc(ch.abilityText)}.</b>`;
    // hardpoints (rebuilt; keep focus on the same control)
    const a = document.activeElement, fk = a && B.hps.contains(a) ? a.dataset.f : '';
    B.hps.innerHTML = slotsHTML(l, d);
    if (fk) { const n = B.hps.querySelector('[data-f="' + fk + '"]') || B.hps.querySelector('[data-f="s-' + fk.split('-')[1] + '"]'); if (n) try { n.focus({ preventScroll: true }); } catch (e) {} }
    const pt = platingTonnes(l.chassis, l.plating);
    B.plate.value = l.plating; B.plate.style.setProperty('--p', (l.plating * 100).toFixed(0) + '%');
    B.plateV.textContent = Math.round(l.plating * 100) + '%'; B.plateT.textContent = tn(pt) + ' t of armour';
    const scale = d.capacity * 1.2, mt = d.tonnes - pt;
    B.tonM.style.transform = 'scaleX(' + Math.min(1, mt / scale).toFixed(3) + ')';
    B.tonP.style.transform = 'translateX(' + (Math.min(1, mt / scale) * 100).toFixed(1) + '%) scaleX(' + Math.max(0, Math.min(1, d.tonnes / scale) - Math.min(1, mt / scale)).toFixed(3) + ')';
    B.tonV.textContent = tn(d.tonnes) + ' / ' + d.capacity + ' t';
    B.ton.classList.toggle('over', d.over);
    B.tonMsg.textContent = d.over ? 'Overweight — cannot drop. Shed ' + tn(d.tonnes - d.capacity) + ' t.' : tn(d.capacity - d.tonnes) + ' t spare. Lighter rigs move faster.';
    const paint = PAINTS.find(p => p.id === l.paint) || PAINTS[0];
    for (const p of pts) p.setAttribute('aria-checked', String(p.dataset.paint === paint.id));
    B.paintN.textContent = paint.name;
    B.sHp.innerHTML = d.hp.toLocaleString('en-US') + '<small>hp</small>'; B.sSp.innerHTML = d.speed.toFixed(1) + '<small>m/s</small>';
    B.sDa.innerHTML = d.dash.toFixed(0) + '<small>m/s</small>'; B.sJe.innerHTML = d.jet.toFixed(1) + '<small>s</small>';
    // fire groups
    let g = '';
    const names = slots => { const n = {}; for (const s of slots) { const nm = MODULES[l.slots[s]].name; n[nm] = (n[nm] || 0) + 1; } return Object.keys(n).map(k => esc(k) + (n[k] > 1 ? ' ×' + n[k] : '')).join(', '); };
    for (const k of [1, 2, 3]) if (d.groups[k].length) g += `<span><kbd>${GROUP_KEY[k]}</kbd>${names(d.groups[k])}</span>`;
    for (const s of ch.slots) { const m = MODULES[l.slots[s]]; if (m && m.type === 'equip' && slotKind(s) === 'arm') g += `<span><kbd>${moduleKey(l, s, m.id)}</kbd>${esc(m.name)}</span>`; }
    if (d.emptyArms) g += `<span><kbd>F</kbd>Fist${d.emptyArms > 1 ? 's' : ''} +${d.emptyArms * 25}%</span>`;
    B.grp.innerHTML = g || '<span>No weapons fitted</span>';
    // footer
    const isDrop = bay.active === cur, locked = lockedParts(l), need = locked[0], afford = need ? progress.canAfford(need) : true;
    B.drop.disabled = d.over || (!!need && !afford);
    B.drop.classList.toggle('done', isDrop && !d.over && !need); B.drop.classList.toggle('unlock', !!need && afford && !d.over);
    B.drop.firstElementChild.innerHTML = d.over ? 'Overweight' : need ? (afford ? 'Unlock ' : '<i class="ku-lock"></i>') + esc(partName(need)) + ' \u2014 ' + progress.cost(need) : isDrop ? 'Selected for drop' : 'Set as drop';
    B.saved.textContent = d.over ? 'Not saved' : need ? (locked.length > 1 ? locked.length + ' parts locked' : 'Locked part') : 'Saved';
    B.saved.classList.toggle('warn', d.over || !!need);
    B.cap.children[1].textContent = l.name; B.cap.children[2].textContent = ch.name + ' / ' + ch.role + ' · ' + tn(d.tonnes) + ' of ' + d.capacity + ' t';
  }

  // ---- edits -------------------------------------------------------------------------------------------------
  function setTab(i) { cur = Math.max(0, Math.min(2, i | 0)); openSlot = ''; hoverMod = ''; commit(); }
  function setChassis(id) {
    if (!CHASSIS[id] || lo().chassis === id) return;
    const l = lo(), wasDefault = !l.name || CH_IDS.some(c => l.name === CHASSIS[c].name) || DEFAULT_LOADOUTS.some(dl => dl.name === l.name);
    const n = sanitize(Object.assign(clone(l), { chassis: id }));
    if (wasDefault) n.name = (DEFAULT_LOADOUTS.find(dl => dl.chassis === id) || {}).name || CHASSIS[id].name;
    work[cur] = n; openSlot = ''; commit();
  }
  function setModule(slot, id) { const l = lo(); if (!moduleFits(l.chassis, slot, id)) return; l.slots[slot] = id; hoverMod = ''; commit(); }
  function cycleModule(slot, dir) {
    const l = lo(), fit = Object.keys(MODULES).filter(id => moduleFits(l.chassis, slot, id)); if (!fit.length) return;
    const i = fit.indexOf(l.slots[slot] || 'none'); setModule(slot, fit[(i + dir + fit.length) % fit.length]);
  }
  function setDrop() {
    const l = lo(); if (derive(l).over) { play('ui_back'); return false; }
    const need = lockedParts(l)[0];
    if (need) {                              // the primary action buys the next locked part; the drop stays where it was
      if (!progress.unlock(need)) { play('ui_back'); return false; }
      commit(); bus.emit('bay:changed', { active: bay.active, loadout: bay.current }); return false;
    }
    bay.select(cur); render(); play('ui_click'); return true;
  }
  function reset() { work[cur] = sanitize(DEFAULT_LOADOUTS[cur]); openSlot = ''; commit(); }

  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
    if (b.dataset.tab != null) setTab(+b.dataset.tab);
    else if (b.dataset.ch) setChassis(b.dataset.ch);
    else if (b.dataset.mod) { const s = b.dataset.slot; openSlot = ''; setModule(s, b.dataset.mod); const r = B.hps.querySelector('[data-f="s-' + s + '"]'); if (r) try { r.focus({ preventScroll: true }); } catch (er) {} }
    else if (b.dataset.slot) { openSlot = openSlot === b.dataset.slot ? '' : b.dataset.slot; hoverMod = ''; render(); play('ui_click'); if (openSlot) { const o = B.hps.querySelector('.ku-b-opts'); if (o && o.scrollIntoView) try { o.scrollIntoView({ block: 'nearest' }); } catch (er) {} } }
    else if (b.dataset.paint) { lo().paint = b.dataset.paint; commit(); }
    else if (b.dataset.b === 'drop') setDrop();
    else if (b.dataset.b === 'reset') reset();
    else if (b.dataset.b === 'back') close();
  });
  const descFor = e => {
    const b = e.target.closest && e.target.closest('.ku-b-opt'); if (!b || b.dataset.mod === hoverMod) return;
    hoverMod = b.dataset.mod; const m = MODULES[hoverMod], p = B.hps.querySelector('.ku-b-desc');
    if (m && p) p.innerHTML = `<b>${esc(m.name)}</b> ${esc(m.text)}`;
  };
  B.hps.addEventListener('mouseover', descFor); B.hps.addEventListener('focusin', descFor);
  B.plate.addEventListener('input', () => { lo().plating = +B.plate.value; commit(true); });
  B.name.addEventListener('input', () => { lo().name = B.name.value.slice(0, 24); commit(true); });
  B.name.addEventListener('blur', () => { if (!lo().name.trim()) { lo().name = CHASSIS[lo().chassis].name; commit(true); } });
  bus.on('bay:changed', () => { if (isOpen) render(); });

  function open() {
    if (isOpen) return;
    for (let i = 0; i < 3; i++) work[i] = clone(bay.loadouts[i]);
    if (!progress.loadoutUnlocked(bay.current)) { const ok = bay.loadouts.findIndex(x => progress.loadoutUnlocked(x)); if (ok >= 0) bay.select(ok); }
    cur = bay.active; openSlot = ''; isOpen = true; el.hidden = false;
    S.bay.open = true; S.bay.editing = cur; S.bay.preview = lo();
    render(); B.body.scrollTop = 0;
    bus.emit('bay:open', { index: cur, loadout: lo() }); bus.emit('bay:preview', { loadout: lo(), index: cur, valid: true });
  }
  function close() {
    if (!isOpen) return;
    isOpen = false; el.hidden = true; S.bay.open = false; S.bay.preview = null;
    bus.emit('bay:close', {}); if (opts && opts.onClose) opts.onClose();
  }
  // Keyboard (called by ui.js from bus 'key'; core swallows arrows/Tab/Space so traversal is ours). Returns true if used.
  function key(code, a) {
    if (!isOpen) return false;
    const inText = a === B.name;
    if (code === 'Escape') { if (openSlot) { const s = openSlot; openSlot = ''; render(); const r = B.hps.querySelector('[data-f="s-' + s + '"]'); if (r) r.focus(); } else close(); return true; }
    if (inText) { if (code === 'Enter' || code === 'NumpadEnter') { B.name.blur(); return true; } return code !== 'Tab' && code !== 'ArrowUp' && code !== 'ArrowDown'; }
    if (code === 'Digit1' || code === 'Digit2' || code === 'Digit3') { setTab(+code.slice(5) - 1); return true; }
    if (a && el.contains(a) && (code === 'ArrowLeft' || code === 'ArrowRight')) {
      const dir = code === 'ArrowLeft' ? -1 : 1;
      if (a.classList.contains('ku-b-hpr')) { cycleModule(a.dataset.slot, dir); return true; }
      const grp = a.dataset.tab != null ? tabs : a.dataset.ch ? chs : a.dataset.paint ? pts : a.dataset.mod ? [...B.hps.querySelectorAll('.ku-b-opt')] : null;
      if (grp) { const n = grp[(grp.indexOf(a) + dir + grp.length) % grp.length]; n.focus(); if (!a.dataset.mod) n.click(); return true; }
    }
    return false;
  }
  return { el, B, open, close, key, setDrop, get isOpen() { return isOpen; }, get loadout() { return lo(); }, get index() { return cur; },
    edit(fn) { fn(lo()); commit(true); }, setTab, setChassis, setModule, toggleSlot(s) { openSlot = s; render(); } };
}
