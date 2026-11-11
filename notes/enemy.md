# ENEMY — notes

Files: `src/enemy.js` (director, every unit type, Phase B/C hooks), `src/enemy_nav.js` (navigation),
`harness/enemy.js` (baseline modules + stand-in player), `harness/enemy_int.js` (real CITY / RENDER / DESTRUCT /
COMBAT / MODELS + stand-in), `harness/enemy_full.js` (every real module, real PLAYER), `harness/enemy_common.js`
(stand-in, damage accounting, top-down debug map), `harness/enemy_run.mjs` (patient runner, see "Testing").

## What is built

**Navigation (`enemy_nav.js`).** 96 × 96 grid of 2 m cells derived from the voxels. Per cell: pilot-sized
walkability and floor height (lowest standable spot per voxel column, mode over the 16 columns, a thin wall crossing
the cell blocks it), and an obstruction class for a tank (2.6 m clearance) and a rig (8.5 m): clear / weak / solid /
hard, from the count and maximum strength of the voxels above the floor. Refresh is incremental: explosions,
`voxels:destroyed`, collapses, debris impacts, rig landings and punches queue the cells around them (96 cells a
frame), and any change of `grid.version` starts a rolling full sweep (40 cells a frame, about 4 s for the map).
Flow fields are time-sliced Dijkstra (binary heap, 2200 pops a frame, double buffered): soldier / tank / rig to the
player, plus the same three to one alternate goal (a defended objective). Only classes somebody needs are computed;
each is refreshed 2–4 times a second. Soldiers cannot cross blocked cells; tanks and rigs can, at a price, so they
prefer streets but go through things when the street is gone. Units follow the field with a look-ahead that takes
the farthest parent cell reachable in a straight walkable line (no 8-direction zig-zag).

**Staying unstuck.** Ground units move with `grid.moveBody` (soldiers step 1 m and hop 1.4 m; tanks step 1 m; rigs
1.5–2.5 m). A unit that wants to move and has not covered 0.6 m in a second counts as stuck: soldiers sidestep, tanks
ram (`carveBox`, power 88, then 175), rigs wade (`carveBox` power 100 along their path every 0.12 s), punch what
does not give (`punch`, power 190) and use jump jets. A unit embedded in rubble is pushed up with `grid.unstick`
(3 m); if that fails, or it stays stuck / off the field for 6–12 s, it is moved to the nearest cell that can reach
the player (`stats.relocations`).

**Units** (team 1; hp soldier 40, ace 90, drone 60, tank 600, gunship 500, rig 1500, heavy 2600, turret 320,
dreadnought 9000). Everything fires real `G.combat` weapons from the model's sockets; aim error starts wide and
tightens with time in view (`spread0 → spread1` over `tight` seconds), grows with the target's speed, and is larger
in waves 1–4.
- *Infantry* arrive in squads of four with a left and a right flanker (flow-field step biased sideways for 6–10 s).
  States: advance → pick cover (a cell with solid voxels on the target side within 4 m and a step-out with a firing
  line; low cover is used by crouching and popping up in place) → hide (crouched, hit box 1.15 m) → peek → burst →
  back. No cover in reach: strafe-and-burst in the open. Cover is re-checked every think and abandoned when it has
  been destroyed or outflanked. A fire-token pool limits how many soldiers are mid-burst at once (2 in wave 1, up
  to 6; +3 when the target is a rig). Riflemen scatter from a rig within 13 m and from a swarm lock. Rocketeers
  kneel for the weapon's tell (muzzle glow) before each rocket and prefer the player's rig.
- *Aces*: tougher riflemen with a beacon that grows as their charge fills (35 s, `ace:charging` 4 × a second). At
  full charge: `ace:called`, a rig drop on the nearest landing zone, then the ace runs to it and boards. Kill the
  ace first and the empty rig powers down and blows up harmlessly.
- *Drones* orbit at 13–20 m, 5–9 m above the target, and make strafing passes straight over it; they hop low
  roofs and go round tall ones.
- *Tanks* follow the tank field until they see the target inside 62 m, hold, back off inside 24 m. The turret
  slews at 1.1 rad/s; before a shot it settles (hull stops, turret freezes on a led aim point, muzzle glow for the
  weapon's tell) so the shell can be dodged. Without a line of sight for 4 s it shells whatever is in the way.
- *Gunships* orbit at 44–54 m above the roofline, fire chain-gun bursts, and every 13–19 s make a low strafing run
  with a ripple of four lightly homing rockets (COMBAT raises `lock:warning`). They break off for 3.5–5 s when a
  Skylance lock is on them.
- *Rigs* arrive by drop (`mech:incoming {team:1, eta}`, a pulsing ring on the landing spot, `G.boom` radius 6.5,
  `mech:land`). They stalk at 20–34 m firing alternating pulse bursts, charge a salvo (1.2 s glow on the pod),
  close in every 7–12 s to punch (`G.destruct.punch` along the swing, 230 damage to a rig / 60 to a pilot,
  knock-back on `ent.vel`, bus `punch`), and jump (bus `jet`, landing = small crater, 32 slam damage, bus `slam`)
  to cross rubble, cut a long detour or reach a target above them. Loadouts: `striker` (pulse both arms + salvo),
  `guardian` (shield on the left arm, raised while hit from the front), `siege` (heavies: a tank-class shell from
  the right arm with a 1.6 s charge).
- *Deaths*: entity removed, `G.destruct.burst` in Vanta colours; drones, tanks, turrets and rigs also `G.boom` with
  `owner` = the killer. Gunships fall burning and explode where they hit. All of it is deferred to ENEMY's own
  update, never done inside `onDeath`.

**Wave director.** `state.wave { n, alive, total, intermission, enemyMechs, bestWave }`; `alive` is "still to be
killed this wave" (spawned or not). 5 s before wave 1, 8 s between waves. Composition: 1 five riflemen · 2 + a
rocketeer and 3 drones · 3 + tank · 4 + ace · 5 gunship + rig · 6 two tanks, gunship, ace · 7 rig, gunship, ace ·
8+ growing mix, a heavy rig on every wave divisible by 5 from wave 10. Groups arrive on a schedule (squads every
6 s, drones from 8 s, tank 12 s, gunship 16 s, rig 21 s), held back while the live count is at the cap
(8 + 3 × wave, max 34) and brought forward when the field is empty. Edge spawns are scored for distance (≈ 75 m),
being out of the player's sight, not being reused, and having a route. Call-outs via `ui:message` for aces, tanks
(first time), gunships and rig drops. When the queue is empty and three or fewer remain, they stop hiding and push.

## API beyond the contract

- `G.enemy.spawn(kind, x, z, opts)` → controller `{ ent, rig, kind, variant, … }`. Kinds `soldier drone tank gunship
  emech turret` (aliases `rifle rocketeer ace heavy dreadnought`). `opts`: `variant`, `y`, `drop` (rigs: fall from
  orbit), `eta`, `loadout` (`striker|guardian|siege`), `target` (entity to attack instead of the player), `hold`
  (true or a radius in metres: stay near the spawn point), `hp`, `weapon` (turret: `'e_rpg'`), `counted` (director).
- `G.enemy.spawnGroup(list, x, z, opts)` → controllers. `list` items are kind strings (`'rifle'`, `'emech:heavy'`)
  or `{kind, variant, …opts}`; infantry get formation slots and flank roles; `opts` applies to all.
- `G.enemy.clearAll()` removes every unit with no deaths, score or explosions. `G.enemy.killAll(src)` kills them.
- `G.enemy.release(ent)` (hijack): ENEMY stops driving the entity, counts it as a wave kill, leaves entity and
  model (`ent.rig`) alive.
- `G.enemy.startWave(n)`, `G.enemy.list`, `G.enemy.nav`, `G.enemy.TUNE`, `G.enemy.stats { ms, lastMs, navMs,
  modelMs, peakMs, thinks, units, relocations, coverLost }` (`ms` excludes time spent inside other modules).
- On every ENEMY entity: `ent.ctrl` (controller), `ent.rig` (model), `ent.variant`.
- Rigs and tanks: `ent.stagger(sec)`, `ent.staggered`; rigs: `ent.tearLimb('armL'|'armR', by)` → bool,
  `ent.limbs`, `ent.loadout`, `ent.shield` (guardian), `ent.disabled`, `ent.onHijack()`. While staggered, disabled
  or `ent.held`, ENEMY does no steering, aiming or firing and only lets `vel` decay.
- Dreadnought: `ent.boss = true`, `ent.phase` 1–3, `ent.coreHitT`.
- Extra bus events: `rig:disabled {ent,x,y,z}`, `shield {ent,on}` (Vanta shields), `boss:spawn {ent}`,
  `boss:phase {ent, phase}`, `boss:dead {x,y,z}`; `footstep` carries `chassis: 'vanta'|'vanta_heavy'|'dreadnought'`.

## Phase B

- **Stagger**: cancels tells, bursts, punches and jets; the unit stands still for the duration (verified: 0 shots in
  2.8 s against 12 in the 6 s before; it resumes afterwards).
- **Torn limbs**: 450 damage, 1.5 s stagger, `rig.setLimbLost`. Pulse only fires from arms that still exist; the left
  arm takes the shield with it, the right arm the siege gun. With both arms gone a rig has no ranged weapons and no
  punch: it runs at the player and stomps (70 slam damage, 6 m).
- **Disabled**: once, below 12 % hp, a rig kneels and sparks for 12 s, its pilot bails out as a rifleman, then the
  reactor goes (normal death, no kill credit). `release(ent)` in that window hands it to PLAYER.
- **Reactions**: riflemen scatter sideways from a swarm lock and work round a raised player shield; rigs jink on a
  lock, will not walk into a braced Bastion (hold 42–58 m instead), and approach a raised shield from its side.

## Phase C

- The wave director is idle when `state.mode === 'operation'`.
- **Turret**: static, falls with whatever it stands on (a long fall kills it), `e_turret` bursts after a 0.5 s tell
  or `e_rpg` after 0.9 s. Spawned without `y` it sits on the highest solid voxel of its column.
- **Dreadnought** (`emech` variant, 9000 hp, never disabled or hijacked, staggers at 35 % duration). Phase 1
  (> 66 % hp): keeps 42–58 m, `e_siege` every 5–7 s with the weapon's 2.2 s windup — the aim follows the player
  until 0.6 s before release, a ring marks the impact point — and an `e_swarm` volley at most every 20–28 s, never
  within 5 s of a shell. Phase 2: an aegis (1500, recharges when broken) that is up whenever it is not charging a
  shot, steady advance, three drone escorts every 18 s (max six; they die with it). Phase 3: shield gone, 1.6 ×
  speed, always closing, jump-slams every 5.5–7.5 s (landing ring, `G.boom` radius 9 power 215), arms tearable.
  Phase changes stagger it for 2.2 s and send `boss:phase` plus a `ui:message`. Hits within 2.6 m of the model's
  `core` socket count × 1.75 once it is below 70 % hp.

## Phase D — co-op

- **Host.** With `G.net.online`, every living entity of `G.ents.players()` is a goal of the three player flow fields
  (multi-source Dijkstra, no extra cost: a unit is led to the nearest player by path), and each unit keeps its own
  target: nearest player, × 0.55 distance² for the one it already has, × 0.4 for whoever damaged it in the last
  5 s, × 0.6 for a rig if it is a rocketeer or tank; re-chosen about once a second. The director drops each group
  relative to a random player. Wave unit counts × 1 / 1.6 / 2.2 / 2.8 for 1–4 players (per type, rounded; aces max
  3), live cap + 35 % per extra player, dreadnought hp × 1 / 1.7 / 2.4 / 3. Death blasts already carry
  `owner = info.src`, so a kill is credited to whichever player's entity NET puts in `info.src`.
- **Clients.** `G.enemy.setPuppetMode(true)` clears everything and stops AI, director and `spawn()` (returns null).
  `applySnapshot(bytes, t)` creates / updates / removes puppets: real entity (`remote = true`, `netId`, real hit box,
  crouch height), real model driven from the replicated inputs, position interpolated over the measured snapshot
  spacing with up to 30 % extrapolation, angles damped. A unit in the snapshot's dead list plays the normal death
  (burst, gunship fall, rig delay) but its blast is only an `'explosion' {…, cosmetic: true}` bus event: no
  `G.boom`, no world or entity damage. A unit simply missing from a snapshot is removed silently.
- `ent.stagger` / `ent.tearLimb` on a puppet do not change it: they call `G.net.enemyCmd?.(netId, 'stagger'|
  'tearLimb', arg)`; the host applies it with `G.enemy.command(netId, cmd, arg, byEnt)` (also `'release'`).
  `G.enemy.byNetId(id)`, `G.enemy.puppetDeath(id)`, `G.enemy.puppetMode`.
- Offline nothing changes and nothing extra runs (checked: wave 3 is still 12 units, cap 17).
- Verified in one page with a fake `G.net` and two player entities 130 m apart: wave 3 grew from 12 to 20 units,
  11 chose one player and 9 the other, boss hp 15 300. Round trip of 24 units (all kinds incl. turret, ace, a rig
  with a torn arm, the dreadnought): 24 puppets, all kinds / variants right, largest position error 3.4 mm, hp error
  0.3 %, torn arm reproduced; a dead-list entry removed one with cosmetics; an empty snapshot removed the rest.
  Not tested over a real connection, and puppets were not looked at in screenshots.

### Wire contract (`serialize()` → `Uint8Array`, little endian; `applySnapshot(bytes, t)`)

`serialize()` returns a view into a buffer that is reused on the next call: copy or send it at once.
`t` is the host time of the snapshot in seconds (optional; only differences are used).

Header, 6 bytes:

| off | type | field |
|---|---|---|
| 0 | u8 | version = 1 |
| 1 | u8 | D = number of dead ids at the end |
| 2 | u16 | N = number of unit records |
| 4 | u16 | sequence number (wraps) |

Then N records of 18 bytes:

| off | type | field |
|---|---|---|
| 0 | u16 | netId (`ent.netId`, same on host and clients) |
| 2 | u8 | variant index into `rifle, rocketeer, ace, drone, tank, gunship, standard, heavy, dreadnought, turret` (kind follows from it) |
| 3 | u8 | misc: bits 0–1 loadout (`striker, guardian, siege, dread`), bit 2 left arm lost, bit 3 right arm lost, bits 4–5 boss phase (0 = not a boss), bit 6 falling in a rig drop, bit 7 dormant (ace's rig waiting) |
| 4 | u16 | x = (x + 32) × 256 |
| 6 | u16 | y = y × 128 |
| 8 | u16 | z = (z + 32) × 256 |
| 10 | u8 | body yaw, 256 steps per turn |
| 11 | u8 | aim yaw (absolute), 256 steps per turn |
| 12 | i8 | aim pitch × 80 (rad) |
| 13 | u8 | hp fraction × 255, rounded up |
| 14 | u8 | planar speed × 8 (m/s) |
| 15 | u8 | flags: 1 grounded, 2 firing, 4 staggered, 8 disabled, 16 shield on, 32 crouch, 64 jets / airborne, 128 charging a tell |
| 16 | u8 | charge × 255: ace charge, or tell progress while bit 128 is set |
| 17 | u8 | heading of travel, 256 steps per turn (for walk / strafe animation) |

Then D × u16: netIds of units that died on the host in the last 1.5 s (repeated across snapshots so a lost packet
does not lose a death). 40 units = 726 bytes; at 12 Hz about 8.5 KiB/s.
For NET: enemy shots are not in the snapshot (replay the host's `'shot'` events; `shooter.netId` identifies the
puppet, `G.enemy.byNetId(id).ent` is the entity). ENEMY emits `'explosion'` with `cosmetic: true` for puppet deaths,
so do not also replicate the host's `'explosion'` for unit deaths. `mech:incoming/land`, `boss:*`, `ace:called`,
`wave:*` and `ui:message` are not produced on clients; `ace:charging` is (from the replicated charge).

## Debug params

`wave=N` start at wave N · `noenemy=1` · `spawn=kind,kind,…` (kinds and aliases above, `kind:variant`; spawned in a
ring round the player, no waves) · `drop=1` with `spawn=emech` makes it arrive by rig drop · `eprof=1` per-type cost
in `stats.typeMs`. Harness only: `standin=still|loop|rig|rigloop|none`, `hp=N`, `loopr=R`, `px= pz=` (stand-in
position), `map=0|big` (top-down nav / flow / trail map), `field=0..5` (which flow field the map shows),
`follow=height,back[,side]` (camera rides above the target). In the page: `KT.h.run(sec)`, `KT.h.report()`,
`KT.h.units()`, `KT.h.cost(n)`.

## Tuning knobs (`G.enemy.TUNE`, and the `DEF` table at the top of `enemy.js`)

`hpMul`, `dmgSpreadMul` (multiplies every aim error; the main difficulty dial), `intermission`, `firstDelay`,
`aceChargeTime`, `dropEta`, `capBase / capPerWave / capMax`, `tokensBase / tokensPerWave / tokensMax`,
`meleeRig / meleePilot / meleeKnock`, `tearDamage`, `disabledAt`, `disabledTime`, `shieldHp`, `coreMul`,
`coreRadius`, `lockWarn`. `DEF` per unit: hp, size, speed, eye height, step, sight, range band, spread.
Wave composition is `compose(n)`.

## Measurements (real CITY / DESTRUCT / COMBAT / MODELS, stand-in player, `KT.debugStep`)

- Reach: 40 riflemen from all 20 edge spawns: 39 within 45 m of the player after 80 s, the last one still walking.
- After 130 large explosions across the routes (105 000 voxels gone, 11 collapses): of 27 units nobody was stuck at
  the end; 6–14 relocations.
- Damage per unit against a pilot (standing still / circling at 5.5 m/s): rifleman 3.3 / 2.1 hp/s, rocketeer
  6.2 / 5.6, drone 1.8 / 1.0 (before its spread was tightened), tank 19 / 13, gunship 19 / 12, rig 34 / 26,
  heavy 34 / 25. Against a circling rig: rig 74, heavy 84, tank 20, rocketeer 6, rifleman 0.7.
  Dreadnought against a circling rig: phase 3 deals 78 hp/s (final build, real model and `e_siege` / `e_swarm`);
  phases 1 and 2 measured 38 and 93 hp/s on an earlier build and were not re-measured. In phase 1 it held 48 m
  with no slams; a 100-damage hit on the exposed core took 175.
- Waves 1–9 start, fill and clear when everything is killed with `G.ents.damage`; restart resets cleanly.
- Ace: called at 35 s, rig landed and boarded 10 s later.
- AI cost with 40 units (22 infantry, 3 tanks, 3 rigs, 9 drones, 3 gunships): median 0.4–0.5 ms per update,
  mean ≈ 1.0–1.4 ms. The machine was shared with nine other builds (load 17–37), so the tail is scheduler noise as
  much as code: p95 3–5 ms, isolated 100–200 ms outliers landing in a different section every run.
  Not measured on an idle machine.

## Known issues

- Low cover (crouch and pop up) was never chosen in the test runs near the player spawn (0 of ~200 samples); the
  crouch pose itself is used in ordinary hides (about 8 % of soldier samples). Infantry spend more time advancing
  and strafing in the open than in cover.
- Only one alternate goal has flow fields. Units given different `opts.target` entities all route to the most
  recently processed one's position (they still shoot at their own target).
- `opts.hold` is ignored by drones and gunships.
- A tank holds at up to 62 m once it sees the target, so it can sit a long way off on a long avenue.
- A staggered rig still slides about 1 m while its velocity decays. An `e_siege` shell already in its windup is
  released by the weapon even if the dreadnought is staggered meanwhile.
- The bailed-out pilot of a disabled rig and the dreadnought's escorts are not counted by the director; a wave can
  clear while such a soldier is still alive.
- Rigs target only the player (rocketeers and tanks also go for an unoccupied player rig they can reach).
- Co-op: all players share one set of flow fields, so a unit whose chosen target is not the nearest player by path
  first walks toward the nearer one. Hijacking a disabled rig from a client needs NET to send `'release'` and to
  hand the entity over; ENEMY only provides the host side.
- `lock:warning` is not emitted by ENEMY (`TUNE.lockWarn = false`): COMBAT owns that flag for homing projectiles and
  a second emitter would switch it off under it. Tells are shown with a glow on the weapon instead.
- Screenshots were reviewed for rig drops, jump jets, tells and the nav map; infantry formations were judged from
  the top-down trail map, not from close-up renders. The Phase B/C behaviours (shield, disabled kneel, turret,
  dreadnought phases) were verified numerically, not visually.

## Requests for lead

- `tools/shot.mjs` has a fixed 30 s screenshot timeout and no wait-for-ready; on the loaded machine it failed for
  anything using the real city. `harness/enemy_run.mjs` is the same tool with a readiness wait and long timeouts.
- PLAYER: enemy punches add knock-back to `ent.vel` of the player's entity and set `ent.knock = G.time`; nothing
  else is needed if the rig controller integrates `vel`.
