// ============================================================================
// KILOTON — rigs.js   OWNER: lead. Other modules must not edit this file.
// Rig Bay data: chassis, hardpoints, modules, the player's saved loadouts.
// Everyone reads this; PLAYER applies it, MODELS draws it, UI edits it,
// COMBAT owns the weapon numbers behind each module's `weapon` id.
// ============================================================================
import { G, bus, clamp } from './core.js';

// Slots: armL, armR (arm mounts: guns over the fist, or equipment), shL, shR (shoulder mounts), back.
export const SLOTS = ['armL', 'armR', 'shL', 'shR', 'back'];
export const SLOT_LABEL = { armL: 'Left arm', armR: 'Right arm', shL: 'Left shoulder', shR: 'Right shoulder', back: 'Back' };

// hp = armour at 100 % plating; speed m/s walk; dash m/s; jet = fuel seconds; capacity = tonnes of modules + plating.
// model = G.models kind/variant opts for MODELS.  ability = chassis special (PLAYER implements).
export const CHASSIS = {
  harrier: { id: 'harrier', name: 'Harrier', role: 'Skirmisher', blurb: 'Light, fast, long jump jets. Hits and leaves.',
    hp: 1100, speed: 12.5, dash: 30, jet: 4.2, turn: 5.0, radius: 1.5, height: 7.2, capacity: 14, punch: 0.75, stomp: 0.7,
    slots: ['armL', 'armR', 'shR', 'back'], ability: 'airdash', abilityText: 'Double dash, in the air too' },
  warden: { id: 'warden', name: 'Warden', role: 'All-rounder', blurb: 'The line rig. Carries anything, does everything.',
    hp: 1800, speed: 9.0, dash: 24, jet: 2.6, turn: 3.4, radius: 1.8, height: 8.5, capacity: 22, punch: 1.0, stomp: 1.0,
    slots: ['armL', 'armR', 'shL', 'shR', 'back'], ability: 'slam', abilityText: 'Ground slam from any height' },
  bastion: { id: 'bastion', name: 'Bastion', role: 'Siege', blurb: 'Slow, huge, armoured. Walks through buildings.',
    hp: 2900, speed: 6.4, dash: 15, jet: 1.1, turn: 2.2, radius: 2.2, height: 10.2, capacity: 32, punch: 1.5, stomp: 1.6,
    slots: ['armL', 'armR', 'shL', 'shR', 'back'], ability: 'brace', abilityText: 'Brace: halves damage while standing still' },
};

// type: 'weapon' (fires a G.combat weapon id) | 'equip' (PLAYER-implemented behaviour).
// fits: slot kinds it can go in ('arm' | 'sh' | 'back').  group: default fire group (1 = LMB, 2 = RMB, 3 = Q).
// only: restrict to chassis ids.  t = tonnes.
export const MODULES = {
  none:       { id: 'none', name: 'Empty', type: 'none', fits: ['arm', 'sh', 'back'], t: 0, text: 'Nothing fitted. An empty arm punches 25 % harder.' },
  pulse:      { id: 'pulse', name: 'Pulse cannon', type: 'weapon', weapon: 'pulse', fits: ['arm'], group: 1, t: 4, text: 'Fast energy bolts. Builds heat.' },
  autocannon: { id: 'autocannon', name: 'Autocannon', type: 'weapon', weapon: 'autocannon', fits: ['arm'], group: 1, t: 3, text: 'Spin-up ballistic gun. Shreds infantry, drones and glass.' },
  lance:      { id: 'lance', name: 'Arc lance', type: 'weapon', weapon: 'lance', fits: ['arm'], group: 1, t: 5, text: 'Continuous cutting beam. Slices walls, cooks armour. Builds heat fast.' },
  siege:      { id: 'siege', name: 'Siege cannon', type: 'weapon', weapon: 'siege', fits: ['arm'], group: 1, t: 8, only: ['warden', 'bastion'], text: 'One enormous shell. Removes the wall, the room and the floor above.' },
  shield:     { id: 'shield', name: 'Aegis shield', type: 'equip', fits: ['arm'], group: 0, t: 4, text: 'Hold to raise an energy shield that stops fire from the front. Punch while raised to shield-bash.' },
  grapple:    { id: 'grapple', name: 'Grapple claw', type: 'equip', fits: ['arm'], group: 0, t: 2, only: ['harrier', 'warden'], text: 'Fire a cable: pull yourself to buildings, or reel an enemy rig in and tear a limb off.' },
  salvo:      { id: 'salvo', name: 'Hailstorm rockets', type: 'weapon', weapon: 'salvo', fits: ['sh'], group: 2, t: 4, text: 'Six-rocket ripple. Recharges.' },
  skylance:   { id: 'skylance', name: 'Skylance AA', type: 'weapon', weapon: 'skylance', fits: ['sh'], group: 3, t: 3, text: 'Lock up to four aircraft, release to launch.' },
  swarm:      { id: 'swarm', name: 'Swarm rack', type: 'weapon', weapon: 'swarm', fits: ['sh'], group: 3, t: 4, text: 'Lock up to six ground targets with micro-missiles.' },
  mortar:     { id: 'mortar', name: 'Thunder mortar', type: 'weapon', weapon: 'mortar', fits: ['sh', 'back'], group: 2, t: 5, text: 'Lobbed cluster shells over buildings onto the aim point.' },
  nanite:     { id: 'nanite', name: 'Repair nanites', type: 'equip', fits: ['back'], group: 0, t: 3, text: 'Slowly restores armour when out of fire.' },
  booster:    { id: 'booster', name: 'Jet booster', type: 'equip', fits: ['back'], group: 0, t: 2, text: '+60 % jump-jet fuel and faster recharge.' },
  reactor:    { id: 'reactor', name: 'Overcharged reactor', type: 'equip', fits: ['back'], group: 0, t: 3, text: 'Weapons cool and recharge 30 % faster.' },
};
export const slotKind = s => s === 'back' ? 'back' : s.startsWith('arm') ? 'arm' : 'sh';
export const PAINTS = [
  { id: 'teal', name: 'Corps teal', armor: 0x4a5560, accent: 0x49e0d2 }, { id: 'amber', name: 'Foundry amber', armor: 0x55504a, accent: 0xffb23e },
  { id: 'white', name: 'Arctic', armor: 0xc9ced3, accent: 0x5fb6ff }, { id: 'olive', name: 'Field olive', armor: 0x4d5540, accent: 0xd8ff5a },
  { id: 'violet', name: 'Night violet', armor: 0x3a3550, accent: 0xb48cff }, { id: 'crimson', name: 'Signal red', armor: 0x5a4040, accent: 0xff5a7a },
];

export const DEFAULT_LOADOUTS = [
  { name: 'Warden / Line', chassis: 'warden', slots: { armL: 'pulse', armR: 'pulse', shL: 'salvo', shR: 'skylance', back: 'none' }, plating: 0.6, paint: 'teal' },
  { name: 'Harrier / Knife', chassis: 'harrier', slots: { armL: 'autocannon', armR: 'grapple', shR: 'salvo', back: 'booster' }, plating: 0.4, paint: 'amber' },
  { name: 'Bastion / Hammer', chassis: 'bastion', slots: { armL: 'siege', armR: 'shield', shL: 'mortar', shR: 'swarm', back: 'nanite' }, plating: 0.7, paint: 'white' },
];

// plating 0..1: tonnes spent on armour. Armour hp = chassis.hp * (0.7 + 0.6 * plating).
export const platingTonnes = (ch, plating) => +(CHASSIS[ch].capacity * 0.35 * plating).toFixed(1);
export function moduleFits(chassisId, slot, modId) {
  const ch = CHASSIS[chassisId], m = MODULES[modId];
  if (!ch || !m || !ch.slots.includes(slot)) return false;
  if (m.only && !m.only.includes(chassisId)) return false;
  return m.fits.includes(slotKind(slot));
}
// Derived numbers for a loadout: { hp, speed, dash, jet, turn, tonnes, capacity, over, valid, groups:{1:[slot…],2:[…],3:[…]}, equip:{shield:slot|null,…} }
export function derive(lo) {
  const ch = CHASSIS[lo.chassis] || CHASSIS.warden;
  let t = platingTonnes(ch.id, lo.plating);
  const groups = { 1: [], 2: [], 3: [] }, equip = {};
  for (const s of ch.slots) {
    const m = MODULES[lo.slots[s]] || MODULES.none; t += m.t;
    if (m.type === 'weapon') groups[(lo.groups && lo.groups[s]) || m.group].push(s);
    else if (m.type === 'equip') equip[m.id] = s;
  }
  const load = t / ch.capacity, over = t > ch.capacity + 1e-6;
  const mob = clamp(1.12 - 0.24 * load, 0.8, 1.12);          // lighter than capacity = faster
  return { chassis: ch, hp: Math.round(ch.hp * (0.7 + 0.6 * lo.plating) * (equip.nanite ? 1 : 1)), speed: +(ch.speed * mob).toFixed(2), dash: +(ch.dash * mob).toFixed(1),
    jet: +(ch.jet * (equip.booster ? 1.6 : 1)).toFixed(2), turn: +(ch.turn * mob).toFixed(2), tonnes: +t.toFixed(1), capacity: ch.capacity, over, valid: !over, groups, equip,
    emptyArms: ch.slots.filter(s => slotKind(s) === 'arm' && (lo.slots[s] || 'none') === 'none').length };
}
export function sanitize(lo) {
  const ch = CHASSIS[lo && lo.chassis] ? lo.chassis : 'warden', out = { name: String((lo && lo.name) || CHASSIS[ch].name).slice(0, 24), chassis: ch, slots: {}, plating: clamp(+(lo && lo.plating) || 0, 0, 1), paint: PAINTS.some(p => p.id === (lo && lo.paint)) ? lo.paint : 'teal' };
  for (const s of CHASSIS[ch].slots) { const m = lo && lo.slots && lo.slots[s]; out.slots[s] = moduleFits(ch, s, m) ? m : 'none'; }
  return out;
}

// ---- the player's bay: three saved loadouts + which one drops next ----------
const KEY = 'kiloton.bay.v1';
export const bay = {
  loadouts: DEFAULT_LOADOUTS.map(sanitize), active: 0,
  get current() { return this.loadouts[this.active] || this.loadouts[0]; },
  load() { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d && Array.isArray(d.loadouts) && d.loadouts.length === 3) { this.loadouts = d.loadouts.map(sanitize); this.active = clamp(d.active | 0, 0, 2); } } catch (e) {} },
  save() { try { localStorage.setItem(KEY, JSON.stringify({ loadouts: this.loadouts, active: this.active })); } catch (e) {} bus.emit('bay:changed', { active: this.active, loadout: this.current }); },
  set(i, lo) { this.loadouts[i] = sanitize(lo); this.save(); },
  select(i) { this.active = clamp(i | 0, 0, 2); this.save(); },
};
bay.load();
G.rigs = { SLOTS, SLOT_LABEL, CHASSIS, MODULES, PAINTS, DEFAULT_LOADOUTS, slotKind, platingTonnes, moduleFits, derive, sanitize, bay };
