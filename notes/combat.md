# COMBAT — notes

Module `G.combat`: every weapon and projectile in the game (player pilot, Warden rig, Vanta).

## Files

| File | What |
|---|---|
| `src/combat.js` | module: projectile pool, swept collision, homing, damage / explosions, events, API |
| `src/combat_weapons.js` | `WEAPONS` table (all numbers), `createWeapon` state machine, analytic TTK |
| `src/combat_draw.js` | rendering: 2 draw calls (instanced glow quad, instanced boxy bodies) |
| `harness/combat.js` | harness on the lead's baselines → `dist/h-combat.html` |
| `harness/combat_int.js` | integration harness with real RENDER / FX / DESTRUCT / CITY (`?int=fx,destruct,…`) → `dist/h-combat-int.html` |
| `harness/combat_lib.js` | dummy targets, auto-firing gunners, numeric tests `KT.ct.*`, look-dev demos |
| `shots/combat-01…06.png` | range, Vanta fire, line-up (two angles), firefight, Skylance volley |

## What it does

- **Projectiles** in a fixed pool of 640, zero allocation while flying (objects are only created on a shot, a hit or
  an explosion). Each step is a swept test: `grid.raycast` over the step, then entities over the same segment
  (`ents.raycast`; a padded copy of it for fat projectiles: bolts 0.25 m, rockets 0.15–0.2 m, missiles 0.3 m).
  The shooter and the shooter's team are ignored (`opts.friendlyFire` turns that off). Nothing tunnels at any dt.
  - bullet — straight, fast (95–320 m/s), dies at `range`; goes through up to 3 panes of glass (breaking them).
  - pulse — straight glowing bolt, chips the world, small entity-only splash.
  - rocket — accelerates to `maxSpeed`, bounded heading wobble, explodes on contact, on timeout (if inside the map).
  - missile — proportional navigation (`navGain`) + pursuit bias, turn-rate limited, unguided for `boost` seconds,
    proximity fuse (`prox`) on its target, loses lock when the target dies and flies on dumb. Target velocity is
    estimated from the target's own motion, so owners do not have to maintain `ent.vel`.
  - shell — ballistic (`gravity`), explodes on contact.
  - grenade — ballistic, bounces (`bounce`), comes to rest, detonates on its `fuse` or on touching an enemy.
  - Missiles and ballistic rounds are sub-stepped (2–3×) when dt > 18 ms.
- **Damage.** Direct hit: `G.ents.damage(ent, def.damage × pen, {type, src, x,y,z, dx,dy,dz, weapon})`.
  `pen` is the weapon's multiplier against the target's armour class (`ARMOR_CLASS`: mech / emech / tank = heavy,
  gunship = medium; an entity can override with `ent.armorClass`). That is how the rifle "tickles armour" without
  PLAYER / ENEMY having to set `ent.armor`. Bullets / bolts then call `G.destruct.impact` (centred on the voxel that was
  hit, so a pane breaks regardless of where on its face the round landed); explosives call `G.boom`.
  A direct hit with an explosive therefore deals `damage + blast.damage` to what it hit.
- **Friendly fire.** Off for direct hits. Explosions: `G.boom` is called with `friendlyFire:false` and the owner's
  team then takes `TUNE.friendlyBlast[team]` of the blast (player side 0.35, Vanta 0.25) — so the player's own
  rockets hurt the player (and the player's parked rig) at 35 %.
- **Weapon state machines** (`createWeapon`): magazine + reload (auto-reload 0.18 s after the last round), heat with
  overheat lockout, recharge, ripple fire (the rest of a salvo leaves from `w.update`, glued to the shooter's
  position), alternating barrels, lock-on multi-target launch. Emits `weapon:reload / overheat / empty / ready`.
- **Events.** `shot` per projectile launched (also each ripple rocket), `tracer` per bullet step (segment flown this
  step; FX turns it into a beam), `impact` on every hit, `lock:warning {on, source:'missile'}` when the first homing
  projectile targets `G.state.player.ent` and when the last one is gone.
  **The `tracer` payload object is shared** (no per-frame allocation): copy the numbers, do not keep the object.
  `shot` and `impact` payloads are fresh objects. Extra fields beyond the contract: `shot.kind`, `impact.team`, `impact.kind`.
- **Rendering.** Glow: one instanced quad, additive, HDR, fog-aware; each instance is a camera-facing ribbon
  (tracers, bolts, exhaust flames) or a round sprite (bolt heads, engine glare, grenade blink). Never thinner than
  ~2 px (far tracers dim instead of flickering). Bodies: one `InstancedMesh` of a boxy finned rocket, lit by the
  scene, faction paint band. Player = cyan-white, Vanta = orange-red (colours in `TUNE`). 2 draw calls total.
  Smoke is FX's: `G.fx.emit('trail_rocket'|'trail_missile'|'trail_shell', pos, vel, scale)` once per frame per round.
- `reset()` empties the pool and clears the instance counts; the two meshes stay in the scene (they are not leaked:
  `init` adds them once).

## API (beyond / clarifying the contract)

```
G.combat.WEAPONS[id]                      table, see field reference at the top of combat_weapons.js
G.combat.createWeapon(id) -> w
G.combat.fireProjectile(id, shooter, origin, dir, opts) -> projectile | null
      opts { target, spread, team (no shooter), friendlyFire, damageMul, speedMul, silent (no 'shot' event) }
G.combat.projectiles[]                    live list: { id, kind, pos, vel, team, target, shooter, age, life } (pooled: do not keep)
G.combat.throwObject(chunk, origin, vel, owner)   -> G.destruct.releaseChunk
G.combat.aimBallistic(id, origin, targetVec3, outDir, high?) -> reachable?    launch direction for e_shell / grenade
G.combat.lead(id, origin, ent, outDir, tvel?)     unit direction that leads a moving entity
G.combat.ttk(id, kind, hp?) / shotsToKill(id, kind, hp?) / ttkTable()
G.combat.HP_ASSUMED, ARMOR_CLASS, TUNE, MAX, stats { live, peak, fired, hits, dropped, ms, msPeak, glow, bodies }
```

Weapon state `w` (the HUD reads these):

```
id, def, name, label, kind ('auto'|'semi'|'heat'|'charge'|'lock'), proj
clip, clipMax            Infinity for weapons without a magazine
reloading                0, else 0..1 progress
heat (0..1), overheated
charge (0..1)            recharge progress;  shots / shotsMax: launches available now (skylance 0..4, salvo 0..1)
cd (s), ready            ready === canFire()
side / lastSide          'L'|'R': the NEXT barrel / the one that just fired (pulse, e_pulse). Read w.side, take that
                         muzzle socket as the origin, fire. opts.side forces a barrel.
bloom, spreadNow         extra spread from sustained fire / total cone of the next shot (rad) for the crosshair
burstLeft                rockets still to leave in the current ripple
maxLocks, lockTime, lockRange     copied from the def for the wielder / HUD (COMBAT does not run the lock)
update(dt), canFire(), fire(shooter, origin, dir, opts) -> bool, reload(shooter?), reset(), setAim(origin, dir)
```

- `fire` opts: `{ targets:[ent…], target, spread (extra cone), side }`.
- `kind:'semi'` is only a label: the wielder decides press-vs-hold; `rate` still limits it.
- **Skylance**: a full charge holds 4 missiles; one pull launches one missile per entry of `opts.targets`
  (max = missiles available), each costs ¼ charge (2.5 s). The same entity may appear twice in `targets`
  (two missiles at one gunship). With no targets it fires one unguided missile.
- **Seeker** (round 2, pilot shoulder AA): same convention as Skylance with 2 missiles per charge — each entry of
  `opts.targets` costs ½ charge (3 s). `w.maxLocks` 2, `w.lockTime` 0.6, `w.lockRange` 180 (also `def.lockCone` 0.3).
  160 direct + 30 blast: one-shots a drone, 3 for a gunship (prox-fuse hits lose a little blast), 94 on an enemy rig.
  No `def.key` is set: PLAYER / UI choose the binding.
- **Salvo / e_salvo / grenade**: need a full charge, the pull empties it.
- `def.tell` is the wind-up COMBAT suggests the AI shows before a heavy shot; COMBAT does not delay the shot.
- `e_gsrocket` homes weakly (0.7 rad/s) **only** if fired with `opts.target`; that also raises `lock:warning`
  when the target is the player's entity. ENEMY currently fires it unguided.
- `setAim(origin, dir)` is optional: call it every frame during a ripple if the pod / aim moves a lot.

## Balance table

Entity hp is owned by PLAYER / ENEMY. **Assumed here:** soldier 40, drone 60, tank 600, gunship 500, enemy rig 1500,
heavy rig 2600, pilot 100, player rig 1800 (`HP_ASSUMED`). If those change, re-run `KT.ct.table()`.

| id | kind | proj | rate /s | direct | pen heavy / med | speed → max m/s | spread rad | ammo | blast r / power / dmg (dmg r) | world chip power / r | range m |
|---|---|---|---|---|---|---|---|---|---|---|---|
| rifle | auto | bullet | 10 | 11 | 0.25 / 0.5 | 320 | 0.005 (+bloom to 0.035) | clip 30, reload 1.7 s | – | 36 / 0.3 | 220 |
| launcher | semi | rocket | 1 | 145 | – | 38 → 95 | 0.004 | clip 1, reload 2.4 s | 3.0 / 140 / 110 (4.0) | – | 320 |
| seeker | lock | missile ×2 | 2.5 | 160 | 0.4 / – | 40 → 105, turn 3.0 rad/s, prox 2.0 m | 0.04 | 3 s per missile (6 s full) | 1.8 / 80 / 30 (3.0) | – | 320 |
| grenade | charge | grenade | – | 0 | – | 22, g 14, fuse 2 s | 0.01 | recharge 6 s | 3.5 / 130 / 130 (5.0) | – | – |
| pulse | heat | pulse | 8 | 26 (+12 splash 1.6 m) | – | 170 | 0.007 | 0.04 heat / shot → 25 shots, cool 0.45 /s after 0.35 s, overheat lock 2.5 s | – | 130 / 1.2 | 260 |
| salvo | charge | rocket ×6 | ripple 0.085 s | 60 | – | 32 → 90 | 0.035 | recharge 8 s | 3.2 / 150 / 70 (4.5) | – | 320 |
| skylance | lock | missile ×4 | 2.5 | 250 | 0.4 / – | 45 → 120, turn 3.5 rad/s, prox 2.2 m | 0.06 | 2.5 s per missile | 2.5 / 100 / 50 (4.0) | – | 400 |
| e_rifle | auto | bullet | 5 | 5 | 0.3 / 0.5 | 95 | 0.03 | clip 10, reload 2.2 s | – | 28 / 0.3 | 120 |
| e_rpg | semi | rocket | 1 | 90 | – | 24 → 46 | 0.015 | clip 1, reload 4.5 s, tell 0.7 s | 2.6 / 125 / 80 (3.6) | – | 200 |
| e_shell | semi | shell | 1 | 150 | – | 42, g 12 | 0.012 | clip 1, reload 5 s, tell 1.1 s | 4.0 / 165 / 140 (6.0) | – | 260 |
| e_drone | auto | pulse (small) | 3 | 4 | 0.5 / – | 60 | 0.03 | clip 6, reload 1.6 s | – | 30 / 0.3 | 110 |
| e_chain | auto | bullet | 12 | 6 | 0.6 / – | 120 | 0.035 | clip 36, reload 3.5 s, tell 0.5 s | – | 62 / 0.35 | 180 |
| e_gsrocket | semi | rocket | 2.5 | 45 | – | 30 → 60 (turn 0.7 with a target) | 0.03 | clip 4, reload 6 s, tell 0.6 s | 2.8 / 135 / 60 (4.0) | – | 240 |
| e_pulse | heat | pulse | 4 | 20 (+8 splash 1.4 m) | – | 80 | 0.02 | 0.07 heat / shot → 15 shots, overheat lock 2.9 s | – | 115 / 1.0 | 220 |
| e_salvo | charge | rocket ×4 | ripple 0.14 s | 50 | – | 26 → 55 | 0.05 | recharge 10 s, tell 1.0 s | 3.0 / 145 / 60 (4.2) | – | 260 |

### Time to kill (trigger held, every round a direct hit; seconds from first shot to killing shot leaving the barrel, flight time excluded; projectiles needed in brackets)

| weapon | soldier 40 | drone 60 | tank 600 | gunship 500 | enemy rig 1500 | heavy 2600 | pilot 100 | player rig 1800 |
|---|---|---|---|---|---|---|---|---|
| rifle | 0.3 s (4) | 0.5 s (6) | 34 s (219) | 14 s (91) | >60 s (546) | >60 s (946) | – | – |
| launcher | 1 rocket | 1 | 5.2 s (3) | 2.6 s (2) | 12.9 s (6) | 25.8 s (11) | – | – |
| seeker | 1 | 1 | 15 s (7) | 3.0 s (3) | 42 s (16) | >60 s (28) | – | – |
| grenade | 1 | 1 | 24 s (5) | 18 s (4) | >60 s (12) | >60 s (20) | – | – |
| pulse | 0.12 s (2) | 0.25 s (3) | 2.9 s (24) | 2.4 s (20) | 11.9 s (58) | 19.5 s (100) | – | – |
| salvo | 1 rocket | 1 | 0.33 s (5 of 6) | 0.27 s (4) | 8.4 s (12 = 2 salvos) | 24 s (20) | – | – |
| skylance | 1 | 1 | 1.2 s (4) | 0.4 s (2) | 15 s (10) | 35 s (18) | – | – |
| e_rifle | – | – | – | – | – | – | 6.0 s (20) | >60 s (1200) |
| e_rpg | – | – | – | – | – | – | 1 rocket | 46.8 s (11) |
| e_shell | – | – | – | – | – | – | 1 shell | 31.1 s (7) |
| e_drone | – | – | – | – | – | – | 13.8 s (25) | >60 s (900) |
| e_chain | – | – | – | – | – | – | 1.3 s (17) | >60 s (500) |
| e_gsrocket | – | – | – | – | – | – | 1 rocket | 29.9 s (18) |
| e_pulse | – | – | – | – | – | – | 1.0 s (5) | 35.3 s (90) |
| e_salvo | – | – | – | – | – | – | 1 rocket | 40.1 s (17) |

Vanta numbers are with perfect aim; the weapons' own spread plus ENEMY's aim error and the slow projectiles make the
real figures several times longer (that is the "dodgeable" part). Contract intent check: rifle 4 hits per soldier,
tickles armour; launcher = 255 on a rig (1/6 of 1500), kills soldiers out to ~3.5 m, 3 m hole in concrete with the
real DESTRUCT (4 m in brick); pulse kills a tank in 2.9 s (inside one heat bar: 25 shots = 3.0 s) and opens a
concrete wall with the first bolts; Skylance one-shots drones and two-shots gunships.

## Tests (all in `KT.ct`, run with `--eval`; numbers from the last run)

`node tools/shot.mjs dist/h-combat.html /tmp/x.png --q "auto=1" --wait 2500 --eval "KT.ct.all()"`

| Test | Result |
|---|---|
| `weapons()` | rifle 30 rounds at 10.0 /s then empty → reload 1.72 s; pulse overheats at shot 25 (3.02 s), lockout 2.48 s, barrels LRLRLR; salvo 6 rockets over 6 separate frames, refire refused, ready after 8.02 s; skylance 2 targets → 2 missiles, charge 0.5; launcher second pull refused, reload 2.42 s; events counted (reload / overheat / empty / ready / shot) |
| `walls()` | every weapon fired at a brick wall: voxels removed by all explosives / pulse / chaingun, live projectile count returns to 0 for all 15 (seeker included) |
| `tunnel(1/20)`, `tunnel(1/60)` | 0.5 m bedrock wall, 10 firing positions per weapon: no projectile position ever beyond the wall face (max z ≤ 50.50), 0 damage to the target behind; thin 0.7 m target at 55 m: 40/40 hits for rifle, pulse, e_chain, e_rifle at both step sizes |
| `ttk()` at 1/60 and 1/20 | simulated kills match the table + flight time (e.g. rifle>soldier 0.37 / 0.30 s vs 0.30; pulse>tank 3.02 / 3.00 vs 2.88; launcher>emech 13.5 / 13.7 vs 12.9; skylance>gunship 2 missiles; e_shell>mech 31.9 vs 31.1) |
| `homing()` at 1/60 and 1/20 | Skylance kills an aircraft crossing at 28 and 40 m/s, fleeing, closing, weaving, orbiting, and one behind the launcher (0.9–1.35 s); 4 drones → 4 missiles → 4 kills; target killed mid-flight → `target` goes null, missile flies on and is cleaned up; `lock:warning` true then false |
| `seeker()` at 1/60 and 1/20 | drone crossing (26 m/s) / fleeing / weaving: killed by the first missile (0.85–1.2 s); gunship crossing and fleeing: 3 missiles (4.1–4.75 s incl. recharge); a hard-weaving gunship took 4 (one miss); two drones locked → 2 missiles → 2 kills, charge 0, full again after 5 s; 89 hp to an enemy rig; pool drains every time |
| `self()` | pilot rocket at a wall 2.5 m away: self 20.8 hp vs 55.9 for an enemy at the same range (0.37; they stand 1 m apart); Vanta-on-Vanta 0.25 |
| `glass()` | rifle / chaingun / pulse rounds pass two panes and still hit; a rocket detonates on the first pane |
| `chew()` (real DESTRUCT) | launcher: 3 m hole in concrete, 4 m in brick; e_shell 4.5–5 m; salvo 3.5 m; 1 s of pulse opens concrete |
| `ballistic()` | `aimBallistic` lands e_shell within 0.5–0.6 m at 40 and 110 m |
| `reset()` | 640 live → 0, instance counts 0, pool refills to 640, overflow is dropped and counted |
| `perf(n)` | `update()` with 300 live: 0.95 ms avg; 600 live: 1.4 ms avg (headless software-GL box, 61 entities, includes instance buffer writes). Peaks are explosions: `G.boom` runs inside the step. |

Integration: `h-combat-int.html?int=fx,destruct` runs the same tests clean against the real FX and DESTRUCT. The full
game (`full-combat`) builds; in it the Warden's pulse / salvo / skylance fired and flew with no errors.
The real RENDER could not be screenshotted from my harness (page screenshot timed out in the headless software GL
while this was written), so the look was judged with the baseline renderer plus `?tm` (ACES preview) — bloom will
only add to it. Worth one look by the lead once RENDER is final: `TUNE.tracer / bolt / flame` are the brightness knobs.

## Phase B — Rig Bay weapons, beams, shields (CONTRACT-B.md B2)

New ids (module → weapon mapping is in `src/rigs.js`): `autocannon`, `lance`, `siege`, `swarm`, `mortar`
(+ hidden `mortar_b`, the bomblet; `def.hidden` ids are not wieldable and are skipped by `ttkTable`).

| id | kind | what | numbers |
|---|---|---|---|
| autocannon | auto, spin-up | fast tracers | rate 4 → 16 /s over 0.6 s of held fire (`w.spin` 0..1, `w.rateNow`), 9 dmg, pen heavy 0.2 / medium 0.6, 300 m/s, belt 120, reload 2.6 s, chip power 54 (glass, wood, drywall, plaster; not brick) |
| lance | heat, continuous beam | ray to first hit, 90 m | 10 ticks/s × 22 = 220 dps, full damage to armour, 0.036 heat / tick → overheats after 2.7 s, lockout 2.5 s; cuts one voxel per tick (power 150: everything except bedrock) |
| siege | charge | one fast shell (140 m/s, slight drop) | 180 direct + blast r 6.5 / power 250 / 520 dmg (dmg r 9), recharge 4 s, `weapon:recoil` strength 1 |
| swarm | lock, ground + air | 6 micro-missiles | 60 direct + 20 blast (r 1.5), 50 → 130 m/s, turn 4.5 rad/s, prox 1.2 m, 1.5 s per missile (9 s full), `lockTime` 0.3, `lockRange` 160, `maxLocks` 6, `lockGround` true, `lockAir` true |
| mortar | charge, lobbed | 3 cluster shells, ripple 0.28 s | high arc onto `opts.aim` (38 m/s, g 14 → reach ~100 m, 2.5 m scatter), each bursts 9 m above whatever is below it into 5 bomblets (20 direct + blast r 2.4 / power 120 / 40 dmg), recharge 7 s, `weapon:recoil` 0.5 |

Time to kill, same conventions as above (mortar assumes every bomblet lands on the target — a ceiling, not an expectation):

| weapon | soldier 40 | drone 60 | tank 600 | gunship 500 | enemy rig 1500 | heavy 2600 |
|---|---|---|---|---|---|---|
| autocannon | 0.58 s (5) | 0.72 s (7) | 27 s (334) | 6.1 s (93) | >60 s (834) | >60 s |
| lance | 0.1 s (2 ticks) | 0.2 s (3) | 2.7 s (28) | 2.2 s (23) | 11.6 s (69) | 21.4 s |
| siege | 1 shell | 1 | 1 | 1 | 8 s (3) | 12 s (4) |
| swarm | 1 missile | 1 | 3 s (8) | 2 s (7) | 19.5 s (19) | 40.5 s |
| mortar | 1 pull | (ground only) | 1 pull (2 shells) | (ground only) | 7.4 s (2 pulls) | 14.5 s (3 pulls) |

API additions:
- `fire(shooter, origin, dir, opts)` accepts `opts.slot` (stored as `w.slot`; also on the lance's `shot` event) and
  `opts.aim` (Vector3; the mortar lobs onto it with `aimBallistic(…, high)`; without it the mortar fires along `dir`).
- **Lance**: call `fire` every frame while the trigger is held. It returns true only on a damage tick, but every call
  refreshes the beam's origin and direction, so the beam follows the muzzle. `shot` is emitted once when a burst starts,
  `impact` on every tick; `G.fx.beam(…, 'lance')` is called per tick if FX has it. Live beams: `G.combat.beams`
  (entries with `ttl > 0`: `{ id, shooter, team, ox,oy,oz, dx,dy,dz, len, hit }`) for AUDIO loops. The beam is drawn
  by my glow mesh (still 2 draw calls). `fireProjectile('lance')` returns null.
- Weapon state: `spin`, `rateNow`, `slot`, `lockGround`, `lockAir` (also `def.lockGround / lockAir` on skylance, seeker, swarm).
- New events: `weapon:recoil {weapon, shooter, strength, x,y,z, dx,dy,dz}` (siege 1, mortar 0.5; a `shake` is emitted with it),
  `shield:hit {ent, x,y,z, amount}`.
- **Shields**: `ent.shield = { on, yaw, arc (full angle, default 2.1 rad), hp }`. Direct hits, lance ticks, pulse splash
  and my reduced friendly-blast share that arrive from inside the arc in front of `yaw` are taken from `shield.hp`;
  what the shield cannot hold passes through to the entity. Blast damage from `G.boom` itself is NOT absorbed here
  (core applies it): the wielder's `ent.onDamage` does that, per the contract.

Tests (`KT.ct.bay()` = `bayWeapons`, `bayTtk(dt)`, `lanceCarve`, `mortarBehind(dt)`, `shield`; `tunnel` / `walls` cover the new ids):

| Test | Result |
|---|---|
| `bayTtk` at 1/60 and 1/20 | every new weapon vs soldier / drone / tank / gunship / enemy rig: simulated kills match the table plus flight time (autocannon>gunship 6.18 / 6.25 vs 6.09; lance>tank 2.68 / 2.65 vs 2.7; siege>emech 3 shells 8.3 s; swarm>tank 8 missiles 3.4 s; mortar>tank 1 pull, 5.7 s of flight). Exception: mortar>enemy rig took 4 pulls / 27 s in the sim against the table's 2 pulls / 7.4 s, because the bomblets scatter and only some land on the rig. Pools drain |
| `bayWeapons` | autocannon 2 shots by 0.3 s, 11 by 1 s, 16 /s after ~0.7 s; lance overheats on tick 28 (2.72 s), lockout 2.48 s, beam gone afterwards; siege second pull refused, 4.02 s recharge, one recoil event; swarm 6 locks (4 soldiers + 2 drones) → 6 missiles, 5–6 kills |
| `tunnel` 1/20 and 1/60 | all new ids hold behind a 0.5 m wall with the real DESTRUCT (lance beam length stops at the wall, 0 damage behind). Siege "fails" the damage check only because its 9 m blast has no line of sight (core); its shell never passes the wall (max z 50.37). With the BASELINE destruct the siege's power 250 breaks the test's bedrock wall (the baseline has no 255 guard) |
| `lanceCarve` | 1.5 m of concrete cut through in 0.28 s, then damages the tank behind; a 2 s sweep cuts a 9 m slot; bedrock: nothing |
| `mortarBehind` 1/60 and 1/20 | over a 16 m building onto a point 12 m behind it: 3 shells → 15 bomblets, all 15 land behind the building, mean miss 1.0–1.65 m (max 3.3), apex 60 m, 6.1 s flight, pool drains |
| `shield` | front: rifle / pulse / autocannon / lance / direct part of launcher, siege, swarm all absorbed (entity takes only the `G.boom` blast: 107 / 507 / 18), one `shield:hit` per hit; back and side: full damage, no events; overflow (10 hp shield vs 26 bolt): 16 passes; lowered: full damage |

`shots/combat-08.png`: lance beam, siege hole, swarm and mortar trails (`demo=bay`).

## Phase C — emplacements, the dreadnought, blast perk (CONTRACT-C.md C6)

| id | kind | what | numbers |
|---|---|---|---|
| e_turret | auto | emplacement chain gun, readable bursts | 8-round bursts at 9 /s, 1.6 s between bursts, 6 dmg (pen heavy 0.5), 110 m/s, spread 0.03, `tell` 0.5 |
| e_siege | charge + windup | boss shell with a long tell | `windup` 2.2 s, then a big slow shell (34 m/s, g 6): 200 direct + blast r 7 / power 230 / 360 dmg (dmg r 9); recharge 9 s; `weapon:recoil` 1 |
| e_swarm | lock, volley | 8 micro-missiles at the player | one pull launches all 8 (ripple 0.11 s); 22 direct + 14 blast (r 1.5); 28 → 58 m/s, turn 2.6 rad/s; recharge 12 s; `tell` 0.8 |

- **`e_siege` windup.** `fire()` returns true and emits `weapon:tell {weapon, shooter, time: 2.2}` at once; the shell leaves
  2.2 s later from `w.update` (keep calling it), from the same offset to the shooter. `w.windup` is 0, else 0..1 progress.
  Calling `fire()` again during the tell returns false but refreshes origin / direction (so does `setAim`), which lets the
  boss track or deliberately not track. The tell is cancelled if the shooter dies. `def.windup` is generic: any def may set it.
- **`e_swarm`.** With no `opts.targets` / `opts.target` it homes on `G.state.player.ent` (`def.autoTarget`), so `lock:warning`
  goes true at launch and false when the last missile is gone. `def.volley`: every available missile leaves on one pull.
- **Blast perk.** For explosives whose shooter is team 0, blast radius and damage radius are multiplied by
  `G.progress.mult('blast')` (guarded if `G.progress` is missing). Damage is not scaled here.

Time to kill (perfect aim, conventions as above): `e_turret` pilot 5.1 s (17 rounds), player rig >60 s (600 rounds);
`e_siege` pilot 1 shell, player rig 27 s (4 shells, 560 each on a direct hit); `e_swarm` pilot 3 missiles, player rig 50 missiles (7 volleys).

Tests (`KT.ct.vantaC(dt)`, same at 1/60 and 1/20):

| Check | Result |
|---|---|
| e_turret vs pilot | 5.4–5.5 s, 20 rounds in bursts of 8 (table 5.1 s); 0.5 m wall holds; pool drains |
| e_siege | one `weapon:tell` with time 2.2 and the right shooter; second pull refused; shell leaves at 2.2 s, lands on a rig 51 m away 1.4 s later for 548; a rig walking sideways at 9 m/s from the tell takes 0; a concrete wall loses 306 voxels (10.5 m wide hole, baseline DESTRUCT) |
| e_swarm | 8 missiles, `lock:warning` true then false; 266 hp to a standing rig, 244–250 to one dashing sideways at 22 m/s (speed alone does not dodge it: break line of sight); 0.5 m wall holds; pool drains |
| blast perk | launcher radius 3.0 → 3.45 with `mult('blast')` 1.15 (45 → 69 voxels out of a brick wall); a soldier outside the old damage radius is now hit; a Vanta shooter with the same multiplier stays at 3.0 |

Not covered: the generic `tunnel` / `walls` loops fire `e_siege` through a gunner that is discarded before the 2.2 s windup
ends, so they report 0 shells for it. Its shell is the same swept `shell` kind as `e_shell` / `siege`, and the wall test above uses it directly.

## Fire hook-up (DESTRUCT fire)

- Every `G.destruct.impact` call passes a 9th argument `{ owner: shooter, fire }` (one reused object, read synchronously), so
  bullet-started collapses and chains are credited. The lance passes `fire: true` (`def.world.fire`).
- Blasts with `blast.ignite` (siege 3.5 m, mortar shell 2 m, bomblet 1.6 m) call `G.destruct.ignite(x, y, z, r, 1, owner)` after
  `G.boom`, guarded so the baseline DESTRUCT is unaffected. The radius also takes the blast perk multiplier.

## Wire contract (phase D co-op, CONTRACT-D D1 / D3)

Everything here is guarded by `G.net && G.net.online`; offline the only cost is that one check per hit.

**`shot` event** (one per projectile launched, fresh object):
`{ weapon, x,y,z, dx,dy,dz (final direction, spread already applied), shooter, team, kind, slot, target (entity | null, homing only), seed (uint32), remote (bool), child (bool) }`
- Replay it on another peer with `G.combat.fireProjectile(weapon, shooterPuppet, origin, dir, { remote: true, seed, target, slot })`.
  Ripple weapons, salvos and lock volleys emit one `shot` per projectile, so no weapon state has to be replicated.
- `seed` drives every per-projectile random (rocket wobble, roll, the mortar's cluster burst), so both peers see the same flight
  and the same bomblet pattern. `fireProjectile` makes one up when `opts.seed` is missing.
- **Do not forward** events with `remote: true` (they are replays) or `child: true` (mortar bomblets: each peer's copy of the
  parent shell spawns its own, as remote if the parent was).
- `weapon:tell` (boss siege windup) and `weapon:recoil` are separate events NET may forward for the visuals.

**Continuous beams (lance): per-tick event.** While online, the firing peer emits `beam { weapon, x,y,z, dx,dy,dz, shooter, team, slot }`
on every damage tick (10 /s). Replay with `G.combat.fireProjectile('lance', shooterPuppet, origin, dir, { remote: true, slot })`:
that draws the beam for 0.16 s (so consecutive ticks are continuous, and it stops by itself when the ticks stop — no stop
message). The usual `shot` (`kind:'beam'`) is still emitted once when a burst starts, for the muzzle sound; do not use it for replay.

**Ownership** (`mayDamage` in combat.js):

| Projectile | vs entity | Result |
|---|---|---|
| local, any team | locally simulated entity | normal damage |
| local player shot | enemy puppet (`ent.remote`) | `G.ents.damage` is called; core turns it into `G.net.claimHit` |
| local, any team | another player's puppet (`ent.remote` and `netOwner != null`, or team 0) | stops on it, no damage, no claim (its owner's replayed copy decides; player-vs-player friendly fire is off) |
| remote, hostile (replayed enemy shot) | entity this peer owns (`localOwns`, not remote, other team) | normal damage |
| remote, hostile | anything else | none |
| remote, team 0 (replayed teammate shot) | anything | none |

- **Deviation from the literal rule, on purpose:** "a remote projectile damages what the local peer owns" would let a teammate's
  replayed shot damage host-owned enemies while that teammate's own projectile also claims the hit — counted twice. So replays of
  team-0 shots never damage; the claim is the only path.
- **World:** only the local, non-remote projectile calls `G.destruct.impact` / `G.boom` / `ignite`. A remote explosive emits
  `explosion { …, remote: true }` itself (flash, sound, shake) and carves nothing; the hole arrives as a replicated DESTRUCT op.
  A remote bullet cannot break glass, so it passes through up to 3 panes instead of stopping on one the op has not removed yet.
- **Blasts online** do not use core's `radiusDamage`: `G.boom` is called with damage 0 and the blast goes through the same
  ownership filter (same falloff, same wall cover, same 35 % / 25 % friendly share). Otherwise a host enemy shell next to a
  teammate's puppet would raise a duplicate claim.
- **Lock-on** needs nothing special: missiles home on any entity with `pos / height / alive` and estimate its velocity from its
  motion, so interpolated puppets work; the hit becomes a claim.
- Shield absorption is only applied by the peer whose hit counts (same filter).

Tests: `KT.ct.coop()` with a fake `G.net = { online: true, localOwns: e => !e.remote, claimHit }` — the nine cells above for a
bullet, a rocket (direct + blast) and a pulse bolt all behave as in the table (e.g. local rocket on an enemy puppet: two claims,
145 + 103, puppet hp untouched; replayed enemy rocket: 164 to my rig, 0 to the teammate puppet). Local shots carve 51 voxels,
the same three replayed carve 0 and emit one `explosion` with `remote: true`. Lance: 6 `beam` events and 6 claims of 22 in 0.5 s;
replayed ticks keep one beam alive, deal 0, carve 0, and a hostile replay hits my rig for 22. Seeker locked on a moving enemy
puppet: hit arrives as claims. Same seed → identical rocket position after 40 steps and identical bomblet pattern; another seed differs.
Offline: the single-player suite gives the same numbers as before.

Also (not co-op): my own radial damage (friendly share, pulse splash) now applies the same wall-cover factor core added to
`radiusDamage` (×0.3 without line of sight after the blast), so the 35 % share stays 35 % of what an enemy would take.

## Debug params (harness only)

- `demo=range | vanta | air | fight | bay | lineup | stress` — look-dev scenes (`lineup&t=0.22` freezes one of everything mid-flight).
- `tm` — ACES tone mapping on the baseline renderer (rough HDR preview). `dusk` — dark backdrop. `ui` — keep the baseline title card.
- `int=render,fx,destruct,city` — (integration harness) which real modules to use.

## Tuning knobs

- Per weapon: everything in `WEAPONS` (plain objects; change live from the console: `KT.combat.WEAPONS.pulse.rate = 10`).
- Global `KT.combat.TUNE`: `friendlyBlast [0.35, 0.25]`, `pursuit` (homing bias), `glassPen`, `beamTracers`
  (also call `G.fx.beam` per bullet step — off because FX already draws a beam from the `tracer` event), `bounds`,
  `ceiling`, colours `tracer / bolt / flame / paint` (HDR linear, [player, Vanta]).
- Pool size `MAX = 640` in `combat.js`.

## Known issues / caveats

- Bullets are drawn twice when the real FX is in: my moving streak + FX's short beam for the same step. It reads as
  one tracer; if it is too hot, lower `TUNE.tracer`.
- Explosions have no line of sight (core `radiusDamage`): a blast hurts through a thin wall. Same for my 35 % share.
- `lock:warning` is also emitted by ENEMY for its tells; mine carries `source:'missile'`. If both are active the UI
  sees whichever came last.
- Entities are axis-aligned boxes: a round can hit the "corner" of a rig's box that looks like air.
- A projectile that starts inside a solid voxel explodes / stops immediately (muzzle pushed through a wall).
- Ripple rockets leave from the fire-time offset to the shooter (not the animated pod socket) unless the wielder calls `w.setAim`.

## Requests for lead

- None blocking. Note for whoever balances hp: if `ent.armor` is also set on tanks / rigs by ENEMY / PLAYER it stacks
  with my `pen` multipliers (rifle would do 0.25 × (1 − armor)); pick one place.
