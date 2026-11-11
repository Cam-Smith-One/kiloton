// ============================================================================
// KILOTON — models.js   OWNER: MODELS.   G.models
// Procedural models + procedural animation for every unit. See notes/models.md.
//   create(kind, opts?) -> rig { kind, variant, root, radius, height, sockets, update(dt,s), trigger(name,arg),
//                                setDamage(0..1), onFootstep, dispose() }
// Blueprints (merged per-bone geometry) are built once per kind/variant and shared by all instances;
// armour materials are shared by everything, each rig owns three tiny emissive materials (same program).
// ============================================================================
import { G, THREE } from './core.js';
import { getMats, paintMats } from './models_kit.js';
import { CHASSIS, MODULES, PAINTS, DEFAULT_LOADOUTS, slotKind } from './rigs.js';
import { buildHarrier, HARRIER_CFG, buildBastion, BASTION_CFG } from './models_chassis.js';
import { buildModule, buildStump } from './models_modules.js';
import { MechRig } from './models_biped.js';
import { buildWarden, WARDEN_CFG } from './models_warden.js';
import { buildVanta, VANTA_CFG } from './models_vanta.js';
import { buildTrooper, Trooper, ROLL_TIME } from './models_infantry.js';
import { buildTank, TankRig, buildDrone, DroneRig, buildGunship, GunshipRig, buildTurret, TurretRig, buildRelay, RelayRig } from './models_vehicles.js';
import { buildDreadnought, DREAD_CFG, DREAD_SCALE } from './models_dread.js';

const DIM = { pilot: [0.35, 1.8], soldier: [0.35, 1.8], mech: [1.8, 8.5], emech: [1.8, 8.5], emech_heavy: [2.2, 10.5], emech_dreadnought: [3.6, 17], turret: [1.2, 2.2], relay: [1.0, 6], tank: [2.2, 2.6], drone: [0.9, 0.7], gunship: [3.2, 2.6] };
const HEAVY_SCALE = 10.5 / 8.5;
const cache = new Map();
const bp = (key, fn) => { let b = cache.get(key); if (!b) cache.set(key, b = fn()); return b; };
const SOCKETS = ['muzzleL', 'muzzleR', 'rocketPod', 'aaPod', 'cockpit', 'handL', 'handR', 'jetL', 'jetR', 'eye', 'footL', 'footR'];
const FALLBACK = { muzzleL: ['muzzleR', 'eye'], muzzleR: ['muzzleL', 'eye'], rocketPod: ['aaPod', 'muzzleL'], aaPod: ['rocketPod', 'muzzleR'], cockpit: ['eye'], handL: ['muzzleL'], handR: ['muzzleR'], eye: ['cockpit', 'muzzleL'] };

const CH = { warden: [buildWarden, WARDEN_CFG, 1.0], harrier: [buildHarrier, HARRIER_CFG, 0.75], bastion: [buildBastion, BASTION_CFG, 1.3] };
const DEFAULT_PAINT = { armor: 0x56616c, accent: 0x14f2dc };
const SLOT_SIDE = { armL: 1, armR: -1, shL: 1, shR: -1, back: 1 };
/** create('mech', { chassis, loadout, paint }): chassis + a module mesh on every fitted hardpoint, painted per instance. */
function createPlayerRig(mats, opts) {
  const lo = opts.loadout || null;
  const chId = CH[opts.chassis] ? opts.chassis : lo && CH[lo.chassis] ? lo.chassis : 'warden';
  const def = CH[chId], info = CHASSIS[chId];
  let paint = opts.paint != null ? opts.paint : lo ? lo.paint : null;
  if (typeof paint === 'string') paint = PAINTS.find(p => p.id === paint) || null;
  if (!paint || paint.armor == null) paint = DEFAULT_PAINT;
  const accent = new THREE.Color(paint.accent == null ? DEFAULT_PAINT.accent : paint.accent);
  const pm = Object.assign({}, mats, { armor: paintMats(paint.armor, paint.accent == null ? DEFAULT_PAINT.accent : paint.accent) });
  const rig = new MechRig('mech', bp('mech:' + chId, def[0]), Object.assign({ radius: info.radius, height: info.height }, def[1]), pm, 1, 0, accent);
  rig.chassis = chId; rig.paint = paint;
  const slots = (lo && lo.slots) || (opts.slots) || (chId === 'warden' && !lo ? DEFAULT_LOADOUTS[0].slots : {});
  rig.loadout = {};
  for (const slot of info.slots) {
    let id = slots[slot] || 'none'; const kind = slotKind(slot), m = MODULES[id];
    if (!m || !m.fits.includes(kind)) id = 'none';
    const side = SLOT_SIDE[slot];
    const key = 'mod:' + id + ':' + (kind === 'arm' ? 'arm' : 'deck') + ':' + side;
    rig.fit(slot, id, id === 'none' ? null : bp(key, () => buildModule(id, kind, side)));
    rig.loadout[slot] = id;
  }
  const sk = rig.sockets, L = rig.loadout;
  for (const s of ['shL', 'shR', 'back']) if (!sk[s]) sk[s] = sk.shR || sk.shL || sk.cockpit;      // slots this chassis lacks
  sk.muzzleL = sk.armL; sk.muzzleR = sk.armR;
  const find = (ids) => ['shL', 'shR', 'back'].find(s => ids.includes(L[s])) || null;
  rig.rocketSlot = find(['salvo', 'mortar', 'swarm']) || (info.slots.includes('shL') ? 'shL' : 'shR');
  rig.aaSlot = find(['skylance', 'swarm']) || 'shR';
  sk.rocketPod = sk[rig.rocketSlot]; sk.aaPod = sk[rig.aaSlot];
  rig.addStumps(bp('stump', buildStump), def[2]);
  return rig;
}

export default {
  name: 'models', DIM, HEAVY_SCALE,
  /** animation timings (s after the trigger) owners can sync gameplay to */
  TIMING: { punchHit: 0.26, punchReach: 5.2, punchTotal: 0.85, throwRelease: 0.3, boot: 1.6, death: 1.5, slamRecover: 0.8, roll: ROLL_TIME },
  init() { getMats(G); },
  reset() {},
  update() {},
  /** build every blueprint now (avoids a hitch the first time a kind spawns) */
  prewarm() { for (const k of ['pilot', 'soldier', 'mech', 'emech', 'tank', 'drone', 'gunship']) this.create(k).dispose(); for (const lo of DEFAULT_LOADOUTS) this.create('mech', { loadout: lo }).dispose(); for (const v of ['rocketeer', 'ace']) this.create('soldier', { variant: v }).dispose(); this.create('emech', { variant: 'heavy' }).dispose(); },
  create(kind, opts) {
    const mats = getMats(G); let variant = (opts && opts.variant) || null, rig;
    switch (kind) {
      case 'mech': rig = createPlayerRig(mats, opts || {}); variant = rig.chassis; break;
      case 'emech': {
        if (variant === 'dreadnought') {
          rig = new MechRig('emech', bp('emech:dreadnought', buildDreadnought), Object.assign({ radius: DIM.emech_dreadnought[0], height: DIM.emech_dreadnought[1] }, DREAD_CFG), mats, DREAD_SCALE, 1);
          rig.addStumps(bp('stump', buildStump), 1.5);
          const k = rig.sockets; k.armL = k.muzzleL; k.armR = k.siege = k.muzzleR; k.shL = k.shR = k.back = k.swarm = k.rocketPod; k.core = k.cockpit; k.aaPod = k.rocketPod; break;
        }
        const heavy = variant === 'heavy'; variant = heavy ? 'heavy' : 'standard';
        const d = heavy ? DIM.emech_heavy : DIM.emech;
        rig = new MechRig('emech', bp('emech:' + variant, () => buildVanta(heavy)), Object.assign({ radius: d[0], height: d[1] }, VANTA_CFG), mats, heavy ? HEAVY_SCALE : 1, 1);
        rig.addStumps(bp('stump', buildStump), 1.0);
        rig.sockets.armL = rig.sockets.muzzleL; rig.sockets.armR = rig.sockets.muzzleR; rig.sockets.shL = rig.sockets.shR = rig.sockets.back = rig.sockets.rocketPod; break;
      }
      case 'pilot': variant = 'pilot'; rig = new Trooper('pilot', variant, bp('pilot', () => buildTrooper('pilot')), mats); break;
      case 'tank': rig = new TankRig(bp('tank', buildTank), mats); break;
      case 'drone': rig = new DroneRig(bp('drone', buildDrone), mats); break;
      case 'gunship': rig = new GunshipRig(bp('gunship', buildGunship), mats); break;
      case 'turret': rig = new TurretRig(bp('turret', buildTurret), mats); break;
      case 'relay': case 'prop': rig = new RelayRig(bp('relay', buildRelay), mats); break;
      case 'soldier': default:
        variant = variant === 'rocketeer' || variant === 'ace' ? variant : 'rifle';
        rig = new Trooper('soldier', variant, bp('soldier:' + variant, () => buildTrooper(variant)), mats); kind = 'soldier'; break;
    }
    rig.variant = variant;
    // every contract socket resolves to something sensible, so owners never need to null-check
    const sk = rig.sockets;
    for (const n of SOCKETS) {
      if (sk[n]) continue;
      const fb = FALLBACK[n]; let o = null;
      if (fb) for (const f of fb) if (sk[f]) { o = sk[f]; break; }
      if (!o) { o = new THREE.Object3D(); o.position.set(0, n.startsWith('foot') ? 0 : rig.height * 0.6, 0); rig.root.add(o); }
      sk[n] = o;
    }
    if (!rig.setCharge) rig.setCharge = () => {};
    if (!rig.setShield) rig.setShield = () => {};
    if (!rig.setLimbLost) rig.setLimbLost = () => {};
    rig.setTint = () => {};
    return rig;
  },
};
