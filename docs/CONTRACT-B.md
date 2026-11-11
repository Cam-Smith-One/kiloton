# KILOTON — Phase B addendum: the Rig Bay (configurator) and rig depth

Read with CONTRACT.md (still in force: ownership, conventions, build/test workflow, definition of done).
New lead-owned, read-only file: **`src/rigs.js`** (`G.rigs`) — read it first. It defines chassis
(`harrier` light, `warden` medium, `bastion` heavy), hardpoint slots (`armL armR shL shR back`), modules
(weapons and equipment, tonnes), paints, `derive(loadout)` (hp, speed, dash, jet, turn, fire groups, equipment,
validity) and `bay` (three saved loadouts + `active`, persisted; bus `'bay:changed'`).
A loadout: `{ name, chassis, slots:{armL,armR,shL,shR,back → module id}, plating 0..1, paint }`.
New state: `G.state.bay { open, editing, preview }` (writer: UI).

The user's words: "I love the rig class, as part of the configurator" (a mech-lab style loadout builder).
Originality rule from CONTRACT.md still applies: our own names and designs only.

## B1. MODELS
`create('mech', { chassis, loadout, paint })`:
- Three distinct chassis silhouettes at the sizes in `CHASSIS` (radius/height): **Harrier** (lean, long digitigrade
  legs, small torso, big jet pack), **Warden** (existing), **Bastion** (wide, squat-shouldered, thick legs, heavy
  plating, tall). Same bone/animation system; gait weight differs (Harrier quick and springy, Bastion ponderous).
- Hardpoints drawn from `loadout.slots`: a distinct mesh per module id on each fitted slot (pulse cannon,
  autocannon with rotating barrels, arc lance emitter, huge siege cannon, aegis shield projector with an energy
  disc shown by `rig.setShield(0..1)`, grapple claw, hailstorm pod, skylance rack, swarm rack, mortar tube,
  nanite tank, jet booster, reactor fins); `none` on an arm shows a bare power fist; unfitted shoulders are clean.
- Paint: `paint {armor, accent}` hex colours drive armour base colour and emissive accent per instance.
- Sockets: `sockets[slot]` (muzzle/emit point for each of `armL armR shL shR back`) in addition to the existing
  names (keep those as aliases: muzzleL→armL etc.). `trigger('fire', slot)` recoils that slot (keep old triggers).
- `rig.setLimbLost(name)` for `'armL' | 'armR'` (limb torn off: stump with sparks socket) on mech and emech.
- `opts` omitted → current Warden with default loadout (nothing else breaks).

## B2. COMBAT
New `WEAPONS` (HUD fields as before; lock weapons expose lockTime/lockRange/maxLocks and `def.lockGround` / `def.lockAir`):
- `autocannon` — arm, kind 'auto' with spin-up (rate ramps over ~0.6 s), fast tracers, strong vs infantry/drones/
  glass, weak vs rig armour, light wall chipping.
- `lance` — arm, kind 'heat' continuous beam: while fired each frame it ray-casts to the first hit (range ~90 m),
  applies dps to entities, carves a thin line through voxels (`G.destruct.impact` along the beam at the hit, cuts
  through ~1 voxel per 0.1 s), draws via `G.fx.beam(..., 'lance')` (guard) and its own glowing beam mesh; heats fast.
- `siege` — arm, kind 'charge' single shell: slow fire (≈4 s), heavy recoil event, fast shell, `G.boom` radius ~6.5,
  power 250, 520 damage; the wall, the room and the floor above are gone.
- `swarm` — shoulder, kind 'lock', ground + air targets, up to 6 locks, small fast micro-missiles (60 dmg, radius 1.5).
- `mortar` — shoulder/back, kind 'charge': 3 cluster shells lobbed in a high arc onto `opts.aim` (Vector3), each
  splitting into 5 bomblets before impact; ~7 s recharge. Use `aimBallistic`.
`fire(shooter, origin, dir, opts)` gets `opts.slot` (hardpoint name) and `opts.aim`. Add all to the TTK table and tests.
Shield support: entities may carry `ent.shield = { on, yaw, arc, hp }`; direct hits and blasts arriving within the
arc in front of `yaw` are absorbed from `shield.hp` instead (emit `'shield:hit' {ent,x,y,z,amount}`); implement in
your damage path for projectiles (blasts: scale `G.boom` damage via an `ent.onDamage` the wielder installs — PLAYER does that).

## B3. PLAYER
- **Drop the active loadout**: on Rig drop build the rig with `G.models.create('mech', {chassis, loadout, paint})`,
  apply `G.rigs.derive(loadout)` (hp, speed, dash, jet, turn, radius/height, punch and stomp scale). Keys **1/2/3**
  on foot select `bay.select(i)` (before calling the drop); show which in `state.player.loadout` (name, chassis, index).
- **Fire groups** from `derive().groups`: LMB fires every group-1 weapon (alternating / together), RMB group 2,
  Q group 3 (lock weapons: hold to lock per their def — air and/or ground — release to fire; a non-lock weapon in
  group 3 just fires). `state.player.weapons` = one state per fitted weapon in slot order, each with extra fields
  `slot`, `key` ('LMB'|'RMB'|'Q'), so the HUD needs no knowledge of loadouts. Muzzles from `rig.sockets[slot]`.
  Mortar gets `opts.aim = state.player.aim`.
- **Equipment** (key **G** = use arm equipment; if two are fitted, G = left, T = right):
  - `shield`: hold to raise (`ent.shield` as in B2, energy pool that drains while absorbing and recharges when
    lowered, `rig.setShield`), walk speed −30 % while raised; F while raised = **shield bash** (short lunge, heavy
    knockback + stagger, breaks walls like a punch).
  - `grapple`: fire a cable along the aim (range ~55 m, draw the cable). Hooked to **world** → reel the rig to it
    fast (flying through the air; release with Space or on arrival; combine with slam). Hooked to an **enemy rig**
    → reel it in / close the distance, then **F tears a limb**: call `target.tearLimb?.('armL'|'armR')` if the
    enemy exposes it (ENEMY adds this in its round), else deal 450 damage; emit `'limb:torn' {ent, limb, by}`.
    Hooked to a tank/drone/gunship/soldier → yank it toward you and smash (big damage).
  - `nanite` (regen 12 hp/s after 5 s out of fire), `booster` (in derive), `reactor` (weapon `update(dt*1.3)`).
  - Empty arms punch 25 % harder each (`derive().emptyArms`).
- **Chassis abilities**: Harrier `airdash` (two dash charges, usable in the air, short recharge); Warden `slam`
  (existing C); Bastion `brace` (hold C on the ground: rooted, incoming damage ×0.5, siege/mortar recoil ignored,
  walking through buildings carves with higher power via the `stomp` scale at all times).
- **Rig vs rig brawling**: punches on enemy rigs cause stagger (`target.stagger?.(sec)`) and knockback into
  buildings (a rig knocked into a wall carves it: `carveBox` around its body at impact speed); a three-hit
  punch combo (L, R, overhead) with the third hit heavier; if the enemy is staggered and below 25 % hp, F performs
  a **finisher** (short canned sequence: grab, lift, slam into the ground, `G.boom`).
- **Pilot vs rig — boarding charge**: on foot within reach of an enemy rig, E mounts it (pilot attached to its
  back for ~1.6 s, cannot be shot by that rig), plants a charge, auto-leaps clear with a jetpack burst; the charge
  detonates 0.8 s later for 650 damage + `stagger`. Prompt "E — PLANT CHARGE". **Hijack**: if the target has
  `ent.disabled === true` (ENEMY sets this on badly damaged rigs later), E boards it and it becomes the player's
  rig as-is (keep its model and hp; map its `e_pulse`/`e_salvo` to LMB/RMB); guard so it simply never triggers until ENEMY supports it.
- **Rig Bay preview**: while `state.bay.open` in phase 'title' or 'paused', keep a preview rig standing on the
  central plaza built from `state.bay.preview` (rebuild on bus `'bay:preview' {loadout}`, debounce), slowly
  rotating or idle-animating, with the camera framing it on the right two-thirds of the screen (the UI panel
  occupies the left third); dispose it when the bay closes. In 'paused' the world is frozen: update only the preview.
- Debug: `mech=1&loadout=0|1|2`, `bay=1` (open the bay preview at start).

## B4. UI
- **Rig Bay screen** (button on the title screen and in the pause card; Esc/Back returns): three loadout tabs
  (rename inline), chassis picker (three cards: name, role, blurb, ability, bars for armour / speed / jets /
  capacity), hardpoint list for the chassis' slots with a module picker per slot (only modules where
  `moduleFits`; show tonnes, description, fire key), plating slider, tonnage bar (red and "OVERWEIGHT — cannot
  drop" when `derive().over`), paint swatches, live derived stats (armour hp, speed, dash, jet seconds), "SET AS
  DROP" (`bay.select`), "RESET". Every edit: `bay.set(i, lo)` when valid, `state.bay.preview = lo`,
  `bus.emit('bay:preview', {loadout: lo})`. Layout: panel on the left ~38 % of the width, the 3D preview shows
  through on the right; at ≤ 700 px wide the panel goes full width with the preview hidden behind a scrim.
  Set `state.bay.open` true/false and emit `'bay:open'` / `'bay:close'`.
- HUD: weapon cards now come entirely from `state.player.weapons[i]` (`name`, `key`, `slot`, kind-specific
  fields) for 1–5 weapons; show the selected loadout chips "1 2 3" with names near the rig meter on foot
  (`bay.loadouts`, `bay.active`); shield energy and grapple state from `state.player.equip` (PLAYER writes
  `{ shield:{on,energy}, grapple:{state} }` when fitted); prompts for the new actions; update the controls
  reference and tips (G equipment, 1/2/3 loadout, E plant charge, Bastion brace, Harrier air dash).
- Debug: `ui=bay`.

## B5. Later this phase (agents currently unavailable; do not wait for them)
ENEMY: `tearLimb`, `stagger`, `disabled` (hijackable) on rigs, soldiers using crouch/cover poses, Vanta rigs with
varied loadouts. DESTRUCT/FX/CITY: spreading fire, gas mains, fuel trucks. RENDER: polish round.

## B6. World depth (added)
New materials in `src/materials.js`: `gas_pipe` (61), `fuel_tank` (62) — both `explosive` and `flammable` — and
`barrier` (63, heavy cover block). Any material with `MAT[id].explosive` chain-explodes when broken (not only `barrel_red`).
- **DESTRUCT — fire.** `G.destruct.ignite(x,y,z, radius, intensity)` and automatic ignition of `flammable` voxels
  touched by explosions/lance. Fire is a sparse set of burning cells (cap a few hundred): each burns for a few
  seconds, spreads to adjacent flammable voxels with a probability, then turns its voxel to `charred` (weakened)
  or removes it (foliage, awnings, furniture, crates); burning structure can therefore bring floors down.
  Entities standing in fire take damage (`type:'fire'`). Expose `G.destruct.fires` (`{count, x[], y[], z[], heat[]}`
  typed arrays for FX/AUDIO) and emit `'fire:start' {x,y,z}` / `'fire:out'` (rate-limited). A broken `gas_pipe`
  vents a burning jet for ~6 s (repeated `ignite` + small booms) and chains along the pipe run with a short delay
  so a street erupts in sequence; `fuel_tank` clusters go up as one large `G.boom` plus a burning pool.
- **CITY.** Gas mains: `gas_pipe` runs one voxel under the road surface along several streets (marked by valve
  covers), with risers into a few buildings; 3–4 tanker trucks (`fuel_tank` body) parked on streets; the gas
  station gets underground tanks; jersey `barrier` rows, sandbag nests and crate stacks along streets and the plaza
  as infantry cover (roughly 1.0–1.5 m high, gaps a rig can step over). Expose `G.city.gasMains` (polylines) and `G.city.tankers`.
- **FX.** Flames and smoke from `G.destruct.fires`, gas-jet torch, burning-pool, embers; shield hit ripple on
  `'shield:hit'`; lance beam (`beam(...,'lance')`) with molten impact sparks; siege muzzle blast and shell trail,
  mortar bomblet split, swarm trails; grapple cable hit sparks (`'grapple'`), limb torn (`'limb:torn'`), finisher (`'finisher'`), charge planted (`'charge:planted'`).
- **AUDIO.** Sounds for all of the above and for Phase B events: autocannon spin-up loop, lance hum and sizzle,
  siege boom, swarm launch, mortar thump and whistle, shield raise/hum/hit/break, grapple fire/reel/latch, limb
  tear, finisher, brace, air dash, charge beeps, fire crackle from `G.destruct.fires`, gas jet roar.
