# MODELS — notes

## What exists

All geometry is generated in code at first use, merged **per rigid segment** (one mesh per bone), flat-shaded
with bevels, vertex colours, a shared procedural wear texture and per-vertex roughness/metalness.

| File | Contents |
|---|---|
| `src/models.js` | `G.models` module: `create`, `DIM`, `TIMING`, `prewarm()`, socket fallbacks |
| `src/models_kit.js` | `Builder` (bevel/taper box, prism, tube, piston), blueprint → instance, shared materials, wear texture, fallback env map, springs / key curves / leg IK |
| `src/models_parts.js` | surface detail helpers: panels, grooves, louvred vents, hazard bands, glow strips, bolts, stencils |
| `src/models_biped.js` | `Walker` (gait, planted feet, leg IK, body springs) and `MechRig` (rig upper body, all one-shots, emissives) |
| `src/models_warden.js` | the player's Warden rig (geometry + gait config) |
| `src/models_vanta.js` | Vanta rig, standard and heavy |
| `src/models_infantry.js` | pilot, soldier rifle / rocketeer / ace (`Trooper`) |
| `src/models_vehicles.js` | tank, drone, gunship |
| `harness/models.js`, `harness/models_real.js`, `harness/models_common.js` | look-dev harness (baseline renderer with harness lighting / RENDER's real renderer) |

Designs (all original):
- **Warden** (`mech`): digitigrade three-segment legs, broad pauldrons, rocket pod on the left shoulder, Skylance
  rack on the right, forearm pulse cannons outboard of big fists, twin back jump jets, reactor louvres on the
  back that glow with `s.heat`, teal canopy that opens. ~18k triangles, 46 meshes.
- **Vanta rig** (`emech`): hunched forward carapace with a low visor head, tall blade pylons on the shoulders,
  straight armoured legs with knee spikes and three-claw feet, rotary cannon right arm, pincer + gun left arm,
  salvo rack on the back. `heavy` is scaled 10.5/8.5 and adds tower shields, glacis, tail and twin racks.
- **Infantry**: helmet + glowing visor (full visor pilot, slit soldier, cross ace), pack, weapon in hands.
  Pilot has a twin-nozzle jetpack and a slung launcher; rocketeer shoulders a launcher with spare rounds on the
  pack; ace has a crest, a half-cape, a tall antenna with pennant and a beacon.
- **Tank**: tracked hull with moving track lugs, turret with limited traverse rate, pitching gun with recoil.
- **Drone**: twin ducted fans, V tail, under-slung twin gun. **Gunship**: lift-fan ducts on stub wings, rocket
  pods, chin turret, V tail, tail thruster.

## API (contract 6.6 plus extras)

`G.models.create(kind, { variant }) → rig`

- `rig.root` — owner sets `position` / `rotation.y` and adds it to the scene. Do not scale it.
- `rig.radius`, `rig.height`, `rig.kind`, `rig.variant`.
- `rig.sockets` — **all twelve contract names always exist** on every kind (a missing one aliases the nearest
  sensible socket, e.g. tank `muzzleL === muzzleR`, emech `aaPod → rocketPod`). `aaPod` on the Warden is
  oriented along the rack's launch direction.
- `rig.update(dt, s)` — `s = { speed, fwd, strafe, aimYaw, aimPitch, grounded, vy, jet, heat, dead }`.
  Missing fields default to idle. `s.dead = true` is the same as `trigger('death')`.
- `rig.trigger(name, arg)` — `fireL fireR fireRocket fireAA punch('L'|'R') slam land(strength) hit grab throw
  jump boot open close death`, plus extras `drop` (let go of a held object without the throw) and `revive`.
- `rig.setDamage(0..1)` — swaps segments to worn / burnt armour, blows off bolt-on plates (rigs), makes the
  emissives flicker above 0.5.
- `rig.onFootstep = (side, worldPos, heavy) => {}` — called on every foot plant. `worldPos` is a **shared
  vector: copy it**. Also fires while the rig steps in place during a turn.
- `rig.setCharge(0..1)` — ace only (no-op elsewhere): lights the antenna beacon and chest bar as the rig call charges.
- `rig.dispose()` — removes the root and frees the per-instance emissive materials. Shared geometry stays cached.

`G.models.DIM[kind] = [radius, height]` (also `emech_heavy`). `G.models.HEAVY_SCALE`.
`G.models.TIMING = { punchHit: 0.26, punchReach: 5.2, punchTotal: 0.85, throwRelease: 0.3, boot: 1.6, death: 1.5, slamRecover: 0.8 }`
— seconds after the trigger; apply punch damage at `punchHit`, release a thrown object at `throwRelease`.
`G.models.prewarm()` builds every blueprint up front (each first `create` of a kind otherwise costs a few ms
to ~40 ms for the Warden).

### Conventions worth knowing
- **Left is +X** (contract section 3: forward +Z, right −X). `muzzleL`, `handL`, `footL`, the Warden's rocket
  pod are on +X. The baseline model has these mirrored.
- Slam: `trigger('slam')` raises both fists; the downswing starts when `s.grounded` becomes true (or after
  0.22 s if already on the ground). Landing squash is automatic on the air→ground transition if the owner does
  not send `'land'`.
- Grab: `'grab'` brings both arms forward into a two-handed hold that stays until `'throw'` or `'drop'`. Attach
  the held object between `handL` and `handR`.
- Torso yaw follows `aimYaw` with a light damp only; "slow torso" is the owner's job.
- Tank turret traverses at 1.9 rad/s, so it visibly chases `aimYaw`.
- Aircraft: `root` origin is the bottom-centre of the hull; `s.speed/fwd/strafe` bank and pitch the body,
  `s.jet` (or forward speed) drives the gunship thruster.

## Harness / debug params

`node build.mjs harness/models.js h-models --dev` (baseline world, harness sun + shadows + ACES) or
`harness/models_real.js h-models-real` (RENDER's real renderer). Query params:

- `kind=mech` | `emech:heavy,soldier:ace,…` | `all`; `gap=` extra spacing; `x= z= y= alt= yaw=`
- state: `speed fwd strafe aimYaw aimPitch air vy jet heat dead dmg`
- `t=` seconds simulated before the still (default 2), `trig=name:arg:age,…` (trigger is `age` seconds old in
  the still; `age` must be ≤ `t`), `move` (translate the root so plants can be checked against the ground)
- `view=q34|q34b|front|back|side|sideR|chase|title|top|low`, `dist=`, `fov=`; or the lead's `cam=`
- `live` keeps animating; otherwise rendering stops after `frames=` (3) frames so screenshots stay cheap
- `window.HM = { rigs, s, step(n,dt), trig(name,arg), info() }` for `--eval`

## Tuning knobs
- Gait per unit: `WARDEN_CFG`, `VANTA_CFG`, `TROOPER_CFG` (stride, cadence `Tmin/Tmax`, duty, step height, bob,
  sway, plant impulse `stepImpulse`, spring `dipK/dipC`).
- Punch / slam / throw / boot / death curves: `K_*` arrays at the top of `MechRig` in `models_biped.js`.
- Emissive levels: `GLOW` multipliers at the top of each geometry file (kept near 2.3–2.6 so strips stay
  coloured rather than clipping to white before bloom); heat response in `MechRig.update`.
- Armour response: `armorMat` in `models_kit.js` (three shared variants: clean / worn / burnt).

## Known issues
- Feet are planted while the stride fits (`strideMax`); above roughly 9–10 m/s the cadence is capped and the
  feet slide a little. Stopping eases the feet home rather than taking a settling step.
- Fists are solid blocks: no finger articulation for the grab.
- Rotor blades are plain spinning geometry (no blur disc).
- Each rig owns three small emissive materials (same shader program as every other rig) so glow can be driven
  per instance; armour materials and all geometry are shared.
- Soldier death is a keyed crumple (buckle, fold, go over, limbs slide out), not a physical ragdoll; it does not adapt to walls or slopes.
- Infantry are ~2.6k triangles (soldiers) and ~3.0k (pilot, incl. jetpack and trim), slightly over the 2.5k target.
- Screenshots were made under heavy machine load with a software GPU; motion was judged from stills at fixed
  phases, not from video.

## Requests for lead
- None blocking. If RENDER's `scene.environment` is present my materials use it; otherwise they fall back to
  a small built-in golden-hour probe.
- PLAYER / ENEMY: please read "Conventions worth knowing" (left = +X, `TIMING`, shared footstep vector).

## Round 2 (after the first playtest)

- **Infantry rebuilt as people in armour.** New kit primitives in `models_kit.js`: `lathe` (smooth-shaded loft with
  superellipse cross-section), `limb` (tapered capsule), `arc` (curved plate with crisp rim), `grid` (smooth quad
  mesh). Helmets, torso, pelvis, limbs, boots, gloves and pauldrons are smooth; plates over them keep hard rims.
  Same bones, sockets, API and faction read; the ace keeps crest, half-cape, antenna pennant and beacon.
- **Pilot separation:** suit and armour values lifted, plus faint teal piping (helmet rim, waist, thighs, shins,
  jetpack) on the emissive channel so the figure reads in shadow.
- **Rigs / vehicles:** all chamfers 1.4–1.5x wider (`bevelK` on the Builder) and rolled plates added: Warden
  shoulder shells, cuisses, shin shells, canopy hood, jet housings; Vanta shoulder shells, greaves, rolled
  carapace; tank frontal turret shield; gunship upper fuselage. Silhouettes, sockets and sizes unchanged.
- **New pilot / soldier animation inputs**
  - `s.slide` (0/1): low feet-first slide, lead leg out, trailing knee up, torso leaned back, weapon and head stay on the aim.
  - `s.crouch` (0..1): knees bent, hips at ~0.6 m, staggered feet, weapon still tracks `aimYaw/aimPitch`; the
    normal gait keeps running underneath, so moving while crouched is a crouch-walk. Blends with stand, slide and roll.
  - `trigger('roll')`: 0.55 s forward combat roll about the body centre, tucks, then returns to the run cycle.
    `G.models.TIMING.roll = 0.55`. The roll is always model-forward: point `root.rotation.y` along the roll.
  - `trigger('death', 'fwd'|'back')` (direction optional, random otherwise): crumple described above.
- Harness params added: `slide=1`, `crouch=0..1`; `trig=roll::0.27` for a mid-roll still.
- Shots: `shots/models-before-3m/15m.png` vs `models-after-3m/15m.png`, `models-after-back.png`,
  `models-r6-slide*.png`, `models-r6-crouch*.png`, `models-r6-roll-strip.png`, `models-r6-die-strip.png`,
  `models-r7-die.png`, `models-r6-real-warden.png`, `models-r7-real-pilot.png`.

## Phase B — Rig Bay (CONTRACT-B section B1)

`G.models.create('mech', { chassis, loadout, paint })`
- `loadout` is a `G.rigs` loadout (`{ chassis, slots, paint }`); `chassis` overrides its chassis; `paint` is a paint
  id, a `{ armor, accent }` object, or omitted (then `loadout.paint`). **No opts → the Warden with the default
  loadout** (pulse / pulse / hailstorm left / skylance right) in its original gunmetal + teal.
- Result has `rig.chassis`, `rig.loadout` (slot → fitted module id after validation), `rig.paint`, and
  `radius/height` from `G.rigs.CHASSIS`.

Chassis (`models_warden.js`, `models_chassis.js`), all on the same bones / `MechRig` animation:
- **Harrier** — long thin digitigrade legs, small beaked torso slung forward, slim arms, two big swept jet nacelles
  with tail fins. Quick springy gait (`HARRIER_CFG`). Slots armL armR shR back.
- **Warden** — unchanged silhouette; its guns, pod and rack are now modules.
- **Bastion** — pillar legs on slab feet, wide barrel torso with glacis, tower pauldrons at head height, small
  cupola. Slow, heavy gait (`BASTION_CFG`).
- Modules are scaled per chassis (`modScale` 0.78 / 1 / 1.22).

Modules (`models_modules.js`, one cached blueprint per id / slot kind / side):
arm — `pulse` (finned coil cannon), `autocannon` (ammo drum, belt, five barrels that spin when fired), `lance`
(open fork with glowing core and focus ring), `siege` (one enormous barrel with slab muzzle brake), `shield`
(emitter slab + hex energy disc), `grapple` (cable drum, harpoon, three talons), `none` (bare power fist);
shoulder — `salvo`, `skylance`, `swarm` (wide honeycomb slab with open lid), `mortar` (fat raked tube);
back — `mortar`, `nanite` (three tanks, green bands), `booster` (big third bell between fuel spheres; lights with
`s.jet`), `reactor` (fan of radiator blades with a hot core). Unfitted shoulders / back are clean deck.

New / changed rig API:
- `sockets.armL armR shL shR back` — muzzle / emit point of whatever is fitted (an empty arm → the fist; a slot the
  chassis lacks → nearest shoulder). Old names stay: `muzzleL/R → armL/R`, `rocketPod` → the slot holding
  salvo / mortar / swarm, `aaPod` → the slot holding skylance / swarm. Also `sockets.stumpL / stumpR`.
- `trigger('fire', slot)` — arm slots = `fireL/fireR` (forearm recoil; autocannon barrels spin up); shoulder / back
  mounts kick. `fireRocket` / `fireAA` still work and route to `rig.rocketSlot` / `rig.aaSlot`.
- `rig.setShield(0..1)` — raises the Aegis disc (accent colour, additive) and swings that forearm across the body.
- `rig.setLimbLost('armL'|'armR', lost = true)` — hides the forearm with its module and shows a sparking stump
  (FX can emit at `sockets.stumpL/R`). Works on `mech` and `emech`. Other kinds: no-op.
- `emech` also exposes `sockets.armL/armR/shL/shR/back` (aliases of its muzzles and rack).

Paint: armour geometry carries a per-vertex paint mask; `paintMats(armor, accent)` gives a cached set of the
three armour materials (clean / worn / burnt) per colour pair, so rigs with the same paint share materials.
Emissive strips, canopy and shield are neutral and multiplied by the accent on the rig's own glow material.
Very light paints are compressed in the shader so white does not clip.

Harness: `kind=rig:0|1|2` (default loadouts) or `kind=rig:<chassis>:<armL>:<armR>:<shL>:<shR>:<back>`,
`paint=<id>`, `shield=1`, `lost=armL`. Shots: `models-b2-title/chase/side-strip.png` (Harrier, Warden, Bastion
defaults), `models-b3-arms.png`, `models-b3-armsb.png` (module swaps, front and chase), `models-b3-harrier.png`
(crimson paint, shield up), `models-b2-paint-*.png`, `models-b2-lost.png`, `models-b2-real.png`, `models-b3-real-chase.png`.

Known issues (Phase B): the Harrier's fins and a Bastion shoulder mortar stand ~0.5–0.8 m above the chassis'
nominal height; the Aegis disc is a flat additive hexagon (no hit ripple — FX could add one at `sockets[slot]`);
the grapple claw does not open / extend (PLAYER draws the cable from `sockets[slot]`); PLAYER still calls
`create('mech')` with no opts until its Phase B round.

## Phase C (CONTRACT-C section C6)

- **`create('emech', { variant: 'dreadnought' })`** — the operation boss (`models_dread.js`). A walking furnace:
  splayed digitigrade legs, hunched hull with a round reactor core in the chest behind four armoured petals, a
  colossal siege cannon as the right arm, a crusher claw with a twin gun on the left, a swarm-rack hump over the
  left shoulder, exhaust stacks over the right. Authored at half size and instanced at 2x.
  `DIM.emech_dreadnought = [3.6, 17]` (hull top ~17 m; stacks and rack reach ~18.8 m). Very heavy gait (`DREAD_CFG`).
  - **Phases through `setDamage`**: < 0.3 sealed; 0.3–0.34 the core petals fall away and the core is exposed;
    0.6–0.7 the hump shroud, right gun-shield and stack cowl go; 0.85 the brow goes. All emissives shift from
    red-orange toward white-hot and the core / vents brighten with damage; armour segments go worn then burnt.
    Thresholds: `DREAD_CFG.plateAt` (in plate-bone order).
  - Sockets: `muzzleR` = `armR` = `siege` (cannon muzzle), `muzzleL` = `armL` (claw gun), `rocketPod` = `swarm` =
    `shL/shR/back`, `cockpit` = `core` (centre of the reactor, the weak point), `eye`, `stacks`, `handL/R`,
    `footL/R`, `jetL/R`, `stumpL/R`. `trigger('fireR')` recoils the siege arm, `'fireL'` the claw gun,
    `'fireRocket'` / `trigger('fire','shL')` kicks the rack. `setLimbLost('armL'|'armR')` tears either arm.
    All the usual rig triggers (punch, slam, hit, death…) work.
- **`create('turret')`** — static Vanta emplacement (`TurretRig`, 1.2 × 2.2): bolted plinth, head that traverses to
  `s.aimYaw` at 2.6 rad/s, twin barrels pitching to `s.aimPitch` (−0.35..1.1), `fireL` / `fireR` recoil, `hit`,
  `death` (head slumps, fire glow), sockets `muzzleL`, `muzzleR`, `eye`.
- **`create('relay')`** (alias `'prop'`) — the friendly objective (`RelayRig`, 1.0 × 6) in player gunmetal and
  teal: generator plinth on outriggers, lattice mast, tracking dish, status lights. `update(dt, s)` (`s` optional;
  `s.aimYaw` points the dish, otherwise it scans). `setDamage(d)`: teal lights stutter and dim, amber-red warning
  lights come up and strobe above 0.7, the dish droops, the mast leans above 0.55; `trigger('death')` topples the
  mast and kills the lights; `trigger('hit')` shakes it. Sockets `eye` (mast top), `cockpit` (mid mast), `muzzleL` (dish feed).
- Harness: `dmgs=0,0.5,0.9` gives each lined-up rig its own damage. Shots: `models-c1-dread.png`,
  `models-c1-dread-chase.png`, `models-c2-dmg.png` (damage 0 / 0.5 / 0.9), `models-c2-chase.png`,
  `models-c2-real.png` (real renderer, next to a Warden), `models-c2-relay.png` (relay 0 / 0.5 / dead + turret), `models-c1-small.png`.
