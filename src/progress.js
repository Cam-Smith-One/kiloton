// ============================================================================
// KILOTON — progress.js   OWNER: lead. Other modules must not edit this file.
// Progression: salvage (persistent currency), unlocks for chassis/modules,
// and field perks chosen during a run. PLAYER applies perk multipliers,
// UI shows the shop / perk picker, MISSION and ENEMY award salvage via events.
// ============================================================================
import { G, bus, clamp } from './core.js';
import { CHASSIS, MODULES } from './rigs.js';

// Salvage costs. Anything not listed is free / unlocked from the start.
export const COST = { harrier: 600, bastion: 900, lance: 350, siege: 500, shield: 300, grapple: 300, swarm: 350, mortar: 400, nanite: 250, booster: 200, reactor: 300 };
// Field perks: offered three at a time after each cleared wave / objective. `k` = multiplier key PLAYER reads with G.progress.mult(k).
export const PERKS = [
  { id: 'plating', name: 'Field plating', text: 'Rig armour +20 % and repaired by that amount now.', k: 'rigArmor', v: 1.2 },
  { id: 'coolant', name: 'Coolant loop', text: 'Rig weapons cool and recharge 25 % faster.', k: 'cool', v: 1.25 },
  { id: 'servos', name: 'Tuned servos', text: 'Rig moves and turns 12 % faster.', k: 'rigSpeed', v: 1.12 },
  { id: 'fists', name: 'Hardened fists', text: 'Punch, bash and slam damage +35 %.', k: 'melee', v: 1.35 },
  { id: 'jets', name: 'Jet tanks', text: 'Jump-jet and jetpack fuel +40 %.', k: 'jet', v: 1.4 },
  { id: 'warheads', name: 'Hot warheads', text: 'Explosive damage and blast radius +15 %.', k: 'blast', v: 1.15 },
  { id: 'capacitor', name: 'Capacitor bank', text: 'Energy weapons (pulse, lance) deal +20 %.', k: 'energy', v: 1.2 },
  { id: 'vest', name: 'Pilot plate carrier', text: 'Pilot health +50 % and regenerates sooner.', k: 'pilotHp', v: 1.5 },
  { id: 'fastdrop', name: 'Priority drop', text: 'Rig meter fills 35 % faster.', k: 'meter', v: 1.35 },
  { id: 'magazine', name: 'Extended magazines', text: 'Pilot rifle magazine +50 %, launcher reloads 30 % faster.', k: 'mag', v: 1.5 },
  { id: 'aegis', name: 'Aegis capacitor', text: 'Shield energy +50 % and recharges faster.', k: 'shield', v: 1.5 },
  { id: 'salvager', name: 'Salvage rights', text: 'Salvage earned +30 %.', k: 'salvage', v: 1.3 },
];
const KEY = 'kiloton.progress.v1';
const freeAll = G.params.has('unlock');
export const progress = {
  COST, PERKS,
  salvage: 0, unlocked: {}, runSalvage: 0, perks: [], offer: null, _mult: {},
  load() { try { const d = JSON.parse(localStorage.getItem(KEY) || 'null'); if (d) { this.salvage = Math.max(0, d.salvage | 0); this.unlocked = d.unlocked || {}; } } catch (e) {} },
  save() { try { localStorage.setItem(KEY, JSON.stringify({ salvage: this.salvage, unlocked: this.unlocked })); } catch (e) {} },
  cost(id) { return COST[id] || 0; },
  isUnlocked(id) { return freeAll || !COST[id] || !!this.unlocked[id]; },
  canAfford(id) { return this.salvage >= this.cost(id); },
  unlock(id) { if (this.isUnlocked(id)) return true; if (!this.canAfford(id)) return false; this.salvage -= this.cost(id); this.unlocked[id] = 1; this.save(); bus.emit('progress:unlock', { id }); return true; },
  // A loadout is usable only if its chassis and every fitted module are unlocked.
  loadoutUnlocked(lo) { if (!this.isUnlocked(lo.chassis)) return false; for (const s in lo.slots) if (!this.isUnlocked(lo.slots[s])) return false; return true; },
  award(amount, reason) { amount = Math.round(amount * this.mult('salvage')); if (amount <= 0) return; this.salvage += amount; this.runSalvage += amount; this.save(); bus.emit('salvage', { amount, reason, total: this.salvage }); },
  mult(k) { return this._mult[k] || 1; },
  hasPerk(id) { return this.perks.includes(id); },
  // Three perks the player does not have yet (fewer if nearly all are taken). UI shows them; the sim keeps running slowly or is paused by UI.
  offerPerks() { const pool = PERKS.filter(p => !this.perks.includes(p.id)); const out = []; while (out.length < 3 && pool.length) out.push(pool.splice(Math.floor(G.rand() * pool.length), 1)[0]); this.offer = out.length ? out : null; if (this.offer) bus.emit('perk:offer', { perks: out }); return this.offer; },
  takePerk(id) { const p = PERKS.find(q => q.id === id); if (!p || this.perks.includes(id)) return false; this.perks.push(id); this._mult[p.k] = (this._mult[p.k] || 1) * p.v; this.offer = null; bus.emit('perk:taken', { perk: p }); return true; },
  resetRun() { this.perks = []; this._mult = {}; this.offer = null; this.runSalvage = 0; },
};
progress.load();
bus.on('game:start', () => progress.resetRun());
bus.on('score', (d) => { if (d && d.points > 0) progress.award(d.points * 0.1, 'kill'); });
bus.on('wave:clear', (d) => { progress.award(40 + 15 * ((d && d.n) || 1), 'wave'); if (G.state.mode !== 'operation') progress.offerPerks(); });
bus.on('objective:done', (d) => { progress.award((d && d.salvage) || 150, 'objective'); progress.offerPerks(); });
G.progress = progress;
