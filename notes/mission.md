# MISSION — Operation "Blackout" director

Files: `src/mission.js` (director: stages, objectives, spawning, win/fail), `src/mission_build.js` (voxel set
pieces + cheap "voxels left" bookkeeping), `src/mission_props.js` (relay adapter / fallback prop, command core
prop, objective beams). Harness: `harness/mission.js` (real city, destruct, models, combat, player, enemy; baseline
render/fx/audio/ui: fast logic runs), `harness/mission_full.js` (every real module, for looks),
`harness/mission_lib.js` (`KT.mt` test helpers). Shots: `shots/mission-*.png`.

Runs only when `G.state.mode === 'operation'`. `?mode=operation` forces the mode (set in `init` and again on
`'game:start'`). The operation starts on the first update after `'game:start'`.

## API

`G.mission = { name, active, won, failed, stage (0 = none, 1..4), objectives[], markers[], relay, core, boss
(entities or null), start(stage?), reset(), update(dt), fail(reason), TUNE, stats, debug }`

- `objectives[]`: `{ id, text, sub, kind, progress 0..1, count, total, timer (s or null), done, failed, x, y, z }`
  as in C2, plus `ent` (the entity behind it: relay / core / boss; the defend objective also has `target`) and
  `optional` (survival bonus). Ids: `jammer0..2`, `relay`, `core`, `boss`, `depot`. The boss objective's x/y/z
  follow the boss. Finished rows of a stage are removed when the next stage's briefing starts.
- `markers[]`: `{ id, kind:'jammer'|'relay'|'core'|'boss'|'depot', label, x, y, z, ent, active }` for the
  objectives that are live now.
- `fail(reason)`: marks open objectives failed, emits `'mission:failed' {reason}` then `'player:dead' {cause:'mission'}`.
- `debug.info()` (JSON state summary), `serialize()` / `applyState(o)` (co-op, see Wire contract), `debug.skip(sec)` (advance the current lull / stage clock), `debug.bonus()`.

## Events

| Event | When |
|---|---|
| `mission:stage {n, title, text, of:4}` | start of each stage's briefing lull |
| `objective:new {objective}` | when the stage goes live (5 s after the briefing) |
| `objective:update {objective}` | progress moved ≥ 1 %, once a second for timers, on done/failed |
| `objective:done {objective, salvage}` | **once per stage** (stages 1–3; synthetic stage objective `s1..s3`), and for the survival bonus. `progress.js` turns each into salvage + a perk offer, so individual jammers do not emit it: they report through `objective:update` with `done:true`, a `ui:message`, and `progress.award(60)` |
| `mission:won {stats}` then `game:won {stats}` | Dreadnought destroyed. stats: `time, stageTimes[4], kills, missionKills, relayHp, voxelsDestroyed, buildingsLevelled` |
| `mission:failed {reason}` | relay destroyed (then `player:dead {cause:'mission'}`), or the pilot died (`reason:'Pilot down'`, the run is already ending) |
| `ui:message` | briefing / radio lines; `shake` when a jammer or the core goes |

## Stages

All set pieces are built at mission start with `G.grid.set` (≈ 20–80 ms once; boot's grid restore removes them
on restart and `start()` rebuilds). Each stage: `mission:stage` → 5 s lull → live → on completion 9 s lull
(waits for a pending perk pick) → next. The rig meter is filled at the start of stages 2–4.

1. **Cut the signal.** Three jammer pylons at the three most spread-out `G.city.sites` intersections (≥ 38 m
   from the spawn, ≥ 26 m from the plaza), visited nearest-first. A pylon is a 16.5 m `armor_enemy` lattice mast
   with a `neon_orange` core column and emitter head on four **`concrete_dark` footings** (the weak point: the
   pilot's rockets cannot break armour 170 but do break the footings; three or four rockets and the mast comes
   down as a rigid body), a fuel generator with `barrel_red` beside one footing, and a low sandbag / barrier ring
   with gaps on the street axes (1 m: rigs and tanks step over it). Progress = share of its 579 tracked voxels gone
   ÷ `pylonKill` (0.55). Garrisons (`hold`) deploy when the pilot comes within 78 m or the previous pylon falls;
   the last has a tank. Reinforcement squads arrive from a street mouth away from the pilot every 34 / 27 / 21 s.
2. **Hold the relay.** An octagonal uplink pad on the plaza centre with MODELS' `relay` on it (scaled 1.5×);
   the entity is `kind:'prop', team:0`, 4200 hp, invulnerable outside this stage and immune to the player's own
   fire. 150 s timer; nine scripted waves rotating round the compass (infantry, drones, a tank at 62 s, two tanks
   at 96 s, a Vanta rig drop at 113 s, a last push), most with `opts.target = relay`, some for the pilot.
   Undefended, the relay dies at ≈ 107 s. Relay death → fail. On success the attackers are turned on the pilot.
3. **Breach the citadel.** `G.city.citadel` (Hotel Castellan on seed 1337): armour plating on the lowest 9.5 m
   with hazard-framed `metal_dark` gates on each side, buttress fins, corner ribs, a crenellated crown, Vanta
   banners, and `neon_orange` bands on the facade at the core storey. The core is a voxel block plus a `prop`
   entity (team 1, 2600 hp) mid-height; it dies when shot down **or** when 60 % of its voxels are gone / have
   fallen (bring the building down). Four rooftop `turret`s in sandbag nests, gate garrisons, gunships (up to
   two at once), a tank, a rig drop at 75 s, infantry trickle.
4. **Dreadnought.** `emech:dreadnought` drops on a clear landing zone near the plaza; objective progress = damage,
   sub shows ENEMY's phase. Light escorts. Its death wins the operation.

Fallbacks (only used if `G.enemy.spawnGroup` is missing): plain `spawn()` loops, rocketeers instead of turrets, a
heavy rig with 9000 hp and mission-driven phases as the boss, and units with line of sight putting real
projectiles into the relay.

**Survival bonus**: at wave 2 an optional objective "level the Vanta supply depot" (the warehouse) appears;
progress from a 500-voxel sample checked once a second; reward 250 salvage + a perk offer. `?nobonus` disables.

## Verified (harness, `KT.mt`)

- `KT.mt.run()`: whole operation won end to end (pylons felled with rocket-strength `KT.boom` on the footings,
  units killed through `KT.ents.damage`, relay held 150 s, core shot, boss killed): 4 × `mission:stage`,
  3 × `objective:done` + perk offers, `mission:won`, `game:won`, no console errors. `run({collapse:1})` with
  `stage=3` completes the citadel by demolition; `run({noKill:1})` with `stage=2` fails at ≈ 107 s.
- `failRelay()` → `mission:failed` + `game:over {cause:'mission'}`; `failPlayer()` → `mission:failed 'Pilot down'`;
  `restart()` after each: scene child count and entities return to the same numbers, set pieces rebuilt.
- Cost: `update` ≈ 0.002–0.03 ms/frame (one 579-cell recount per 0.25 s tick at most), no per-frame allocation;
  the only spike is the one-off build at start.

## Wire contract (co-op, CONTRACT-D)

When `G.net.online`, the mission runs **on the host only** (`G.net.isHost`). A client never starts the operation,
spawns, builds on its own, counts voxels or judges anything: its `update` only animates the props, and everything
else arrives through `applyState`. Offline nothing changes.

- `G.mission.serialize()` → plain JSON-safe object, ≈ 0.6–1.1 KB as JSON (measured), cheap enough for 2–4 Hz:
  `{ v:1, a (active 0/1), won, failed, end (fail reason), stage, phase, t (operation clock, s), relay (hp 0..1),
  core (hp 0..1), obj:[{ id, text, sub, kind, p (progress), c (count), n (total), tm (timer s|null), d (done), f
  (failed), opt, x, y, z, netId? (entity behind it, if NET gave it one), hp? (that entity's hp 0..1) }],
  mk:[{ id, kind, label, x, y, z, netId? }], builds:[descriptor…], dones:[{ id, text, sub, salvage }] (cumulative
  stage completions), stats (win stats | null) }`
- Structure descriptors, in build order (append-only during a run): `{type:'pylon', site, x, z}`,
  `{type:'relay', x, z}`, `{type:'citadel', id}` (building id), `{type:'nest', x, y, z}` (rooftop sandbag nests,
  added when stage 3 goes live). The builders are pure functions of (descriptor, city, grid) with no RNG, so with
  the same `state.seed` both peers write identical voxels. They are **not** sent through `G.destruct.tap`.
  Late divergence (a descriptor applied after local damage at that spot) is left to NET's chunk checksums.
- `G.mission.applyState(o)` (clients): builds descriptors it has not built yet, creates **puppet entities for the
  relay and the core** (see below), then syncs stage, objectives (by id) and markers, and emits locally: `mission:stage`
  (+ local meter refill and `mission:refill {stage}` for stages 2–4), `objective:new`, `objective:update` (only on
  change), `objective:done` (once per entry of `dones`: each peer's `progress.js` then awards salvage and offers
  that player's perk), `mission:won {stats}`, `mission:failed {reason}`. It is idempotent, handles a host restart
  (shorter `builds` or lower stage → clean rebuild), and cleans up when the peer goes offline.
  **NET must therefore not also forward the raw `mission:*` / `objective:*` bus events**, or the HUD hears them
  twice. `game:won` / `player:dead` / `ui:message` / `boss:*` are not emitted by `applyState`: NET replicates those.
- **Mission entities and net ids.** The relay and the command core have fixed string ids on every peer:
  `ent.netId = 'm:relay'` / `'m:core'`. On the host they are the real entities; on clients `applyState` creates
  puppets with the same kind (`prop`), team (0 / 1), position, radius, height and maxHp, `ent.remote = true`,
  `hp` set from the replicated fractions, `invuln` (and `noHit` for the core) following the host (`ra` / `ca` in
  the state: 0 gone, 1 alive but untouchable, 2 live target), removed when the host's dies, on reset, on a host
  restart and when the peer leaves. A client's hit on the core therefore goes `ents.damage` → `G.net.claimHit(ent,
  amount, info)` with `ent.netId === 'm:core'`; **NET must route these string ids** (its claim packet currently
  writes `netId` as u16) to the host and apply them with `G.ents.damage(G.mission.entByNetId(id), amount,
  { …info, fromNet: true })`. `G.mission.entByNetId(id)` returns the live real entity or null;
  `G.mission.propNetIds()` lists the live ids. The relay ignores team-0 sources on the host, so a claimed friendly
  hit does nothing. The boss is an ENEMY unit and replicates as one.
- Client objectives and markers carry `ent` (the puppet) like the host's, plus `hp` / `maxHp` (0..1 / 1) and `netId`.
- Verified on one page with a fake `G.net` (`KT.mt.claim()`, `stage=3`): host `propNetIds()` = both ids and
  `entByNetId('m:core')` is the real core (a `fromNet` hit of 200 lands: 2600 → 2400); after `applyState` the client
  has a remote core puppet (2399.8 / 2600 hp, same body, in `G.ents.list`, hit by `ents.raycast`), a hit on it
  returns 0, changes no hp and produces exactly one claim `{netId:'m:core', amount:130}`; the still-invulnerable
  relay produces none; `ca = 0` removes the puppet; reset leaves no prop entities.
- Host side uses `G.ents.players()`: garrison triggers, spawn-edge / air / drop-zone choices keep away from the
  nearest of all players; `mission:failed` on `game:over` reads "All pilots down" online (the run only ends
  when PLAYER/NET end it). The host emits `mission:refill {stage}` and fills its own meter; clients do the same
  from `applyState`. On a win each peer makes its own pilot and rig invulnerable.
- Verified on one page (`KT.mt.wire()`): serialize on a host instance, reset + grid restore, `applyState` as a
  client → identical whole-grid voxel hash and count (stage 1: 5 builds, +3852 voxels; stage 3 with nests: 6
  builds), identical objectives and markers, events `mission:stage` ×1 + `objective:new` per objective, second
  `applyState` emits nothing, a client `update` spawns nothing and changes no voxel. Not tested over a real relay.

## Debug params

`mode=operation`, `stage=1..4` (start there; pylons are not built for 2+), `nobeam` (no objective light columns),
`nobonus`. Useful with them: `god=1`, `meter=1`, `mech=1` (PLAYER).

## Tuning knobs (`G.mission.TUNE`)

`liveCap`, `introLull`, `outroLull`, `pylonKill`, `guardRange`, `s1Trickle`, `s1Cap`, `relayHp`, `relayTime`
(the wave script scales with it), `coreHp`, `coreVoxKill`, `plateH`, `turretHp`, `s3Trickle`, `s3Cap`,
`gunshipEvery`, `gunshipMax`, `bossHp` (fallback boss only), `s4Escort`, `s4Cap`, `pay.*`, `bonusWave`, `bonusKill`.
Squad compositions and the relay wave script are in `deployGuards`, `startRelay`, `startCitadel`.

## Known issues

- Balance is from scripted runs, not human play. Expected length ≈ 12–15 min; stage 1 on foot may be the hardest.
- If the player wrecks the citadel core before stage 3, stage 3 completes at once with a message.
- The citadel's plating follows the building footprint (`lot === 2`); the hotel's ground-floor colonnade stands in
  front of it, so the armour reads as dark infill behind stone piers plus the black band above.
- The relay stands where PLAYER's Rig Bay preview rig stands (plaza centre) when the bay is opened mid-operation.
- Enemy rigs can land on or walk through the relay pad and pylon rings (they are ordinary voxels).
- No checkpoints (by design); restart rebuilds everything.

## Requests for lead

- **ENEMY**: an official `G.enemy.retarget(fromEnt, toEnt|null)`. After the relay stage I clear `u.tgtOv` (and
  reset `u.fi`) on the controllers directly, guarded.
- **PLAYER**: a public meter setter. I call `G.player.debug.fillMeter()` (guarded). Also on a win I set
  `invuln = true` on the pilot and rig entities so a stray shell cannot kill a won run; PLAYER may prefer to own that.
- **UI**: `objective:done` is per stage, not per jammer (see Events); jammer completion arrives as
  `objective:update` with `done:true`. `mission.relay / core / boss` and `objective.ent` are available for gauges.
- `mission.start()` parks `G.enemy.dir` if it is still active in operation mode (a no-op with the current ENEMY).
