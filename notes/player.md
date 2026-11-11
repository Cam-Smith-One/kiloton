# PLAYER — notes

Files: `src/player.js` (pilot, Warden rig, meter / drop / board / eject cycle, score), `src/player_cam.js`
(third-person camera, aim ray, shake, orbits), `harness/player.js` (baseline modules), `harness/player_full.js`
(real CITY / DESTRUCT / FX / MODELS / COMBAT, `real=enemy,render` opts into those too), `harness/player_util.js`
(look-dev HUD, dummy targets, scripted input `PT`).

## What is built

**Pilot.** `grid.moveBody` body (0.33 × 1.8 m, step-up 0.55). Run 6.6 m/s, sprint 9.6 (Shift, forward only, not
while firing), ground accel 70 / decel 55 m/s² (snappy), air control 22 m/s² that keeps momentum, gravity 25,
jump 8.6 m/s with 0.13 s coyote time and 0.13 s jump buffer. Space again in the air = jetpack: kick + sustained
thrust while held, 1.5 s of fuel, recharges on the ground. Body yaw follows travel; it snaps to the camera yaw
while firing and for 1.3 s after. Rifle (LMB, hold) and launcher (RMB, 0.25 s press buffer) fire from the model's
`muzzleR` / `rocketPod` sockets toward `state.player.aim`; R reloads both; empty magazines auto-reload.
HP 100, regenerates 14 hp/s after 4 s without damage. Fall damage above 23 m/s impact (≈ 10.5 m drop); a 30 m
fall kills. Death → `player:dead {cause,x,y,z}`.

**Rig (Warden).** Body 1.8 × 8.5 m, step-up 1 m. Walk 7.6 m/s with 13 m/s² accel / 11 decel (momentum), torso
chases the camera at ≤ 3.3 rad/s (guns only fire when the torso is within 0.75 rad of the crosshair), legs turn at
3.2 rad/s toward travel and walk backwards when travel opposes the torso. Dash (Shift): 25 m/s for 0.3 s, 2 s
cooldown, works in the air, smashes through concrete, body-checks tanks / rigs (260 dmg). Jump jets: Space jumps,
hold to burn (2.3 s fuel, ≈ 22 m apex), recharge on the ground. Ground slam (C in the air, > 2.5 m up): 52 m/s
dive, `G.boom` radius 4–10 m / power 110–190 / damage 220 + 32·h scaled by fall height, `slam` event.
Pulse cannons (LMB, alternating `muzzleL/R`, follows `w.side`), salvo (RMB, `rocketPod`, ripple kept glued to the
pod with `w.setAim`), Skylance (hold Q: one lock per `w.lockTime` on airborne Vanta inside a 15° cone with line
of sight, up to `w.maxLocks`/available shots; `lock` events `locking / locked / lost / fired`; release fires from
`aaPod` with `opts.targets`). Punch (F, alternating, hit lands at `G.models.TIMING.punchHit`): `G.destruct.punch`
radius 1.7 / depth 5 / power 210 from the punching shoulder toward the crosshair, 430 melee damage + knockback to
enemies within 7.5 m in a 60° half-arc, `punch` event. Grab / throw (E on anything above street level within 11 m
→ `grabChunk`, carried above `handR`; E or LMB throws at 44 m/s along the aim via `G.combat.throwObject`; dropped
with `G.destruct.dropChunk` on eject). Stomping: every frame the moving body `carveBox`es what it overlaps
(street layer only gives to strength < 50; everything above gives below 92, i.e. brick, panels, lamp posts, floor
slabs but not concrete; dash / slam use 125) and loses momentum per voxel; Vanta infantry under the body take 500
crush damage; tanks and rigs push back. Heavy `footstep` events come from `rig.onFootstep` (stride timer if the
model never reports). HP 1800, no regeneration; an empty rig has 50 % armour.

**Meter / drop / board / eject.** Meter fills 1/150 per second plus kills (contract percentages); it only runs
while no rig exists. `meter:ready` → V calls the drop on the aimed point: pushed off walls, clamped to 110 m,
snapped to the nearest open footprint within 16 m (a cyan ground ring previews the spot; if nothing is open the rig
comes through the roof, carving as it falls). `mech:incoming {x,z,team:0,eta:4}`, a 250 m scripted descent with
trail FX and a landing beam, touchdown `G.boom` (radius 7, power 175, damage 600, friendly-fire off) +
`mech:land`. The rig then idles (gravity still applies). Within 5 m: `canEnter`, E → 0.85 s hop into the cockpit,
`mech:enter`. Eject: hold X 0.65 s (bigger blast, radius 16) or automatically at 0 hp (radius 12): `mech:eject`,
pilot launched at 36.5 m/s (≈ 30 m), `G.timeScale` 0.22 for 0.4 s easing back over 0.9 s, rig detonates after
0.62 s game time (`mech:selfdestruct`, wreck `burst`), pilot is invulnerable for 3.2 s and takes no fall damage
from that landing. Meter restarts from zero. An empty rig that is destroyed detonates small (radius 9).

**Camera.** Pilot: pivot 1.9 m up, 0.8 m right, 3.4 m boom, fov 64. Rig: pivot 8.7 m up, 3.9 m right, 14.5 m boom,
fov 68. Presets blend over ~0.25 s (boarding / eject). Mouse → yaw / pitch directly (sens 0.0022 rad/count ×
`settings.sens`, `invertY`); works unchanged with `input.fallbackLook`. Collision: shoulder ray clamps the side
offset, then 5 boom rays (centre + near-plane corners); pulls in instantly, eases back out; pilot model hidden
below 0.9 m. Aim = grid ray + `ents.raycast(ignoreTeam 0)` from the pivot along the view (the boom is clear, so the
player's own body can never block it). Recoil kicks pitch/yaw and recovers, FOV kicks on dash / drop / eject /
launch, sprint +5°. Trauma-squared shake from `explosion`, `mech:land`, `collapse`, `slam`, `mech:selfdestruct`,
heavy `footstep`, `debris:impact`, `shake`, own damage; distance falloff; scaled by `settings.shake`.
Phase `title`: slow orbit over the district. `over` (mode `dead`): collision-aware orbit of the body.

**Score.** `ent:death` of a team-1 entity whose `info.src` is any entity this module owned in the run (so debris
thrown by DESTRUCT with our owner, the drop, slam and self-destruct all count). Points soldier 100, drone 150,
tank 500, gunship 750, enemy rig 1500 (ace ×3, heavy ×1.5), ×1.5 crushed / buried, ×1.25 punched, +10 % per combo
step (4.5 s window, max +90 %). Emits `score {points,label,x,y,z}`.

## API beyond the contract

- `G.player.ent`, `G.player.cameraShake(a)`, `G.player.tune` (all knobs, live-editable), `G.player.camPreset`,
  `G.player.cam` (yaw, pitch, dist, pivot, pos, dir, aim{point,hit,ent,dist,nx,ny,nz,mat}).
- `G.player.debug`: `spawnRig(x,z,board)`, `callDrop(x,z)`, `board()`, `eject(manual)`, `fillMeter()`,
  `teleport(x,y,z)`, `look(yaw,pitch)`, `lookAt(x,y,z)`, `info()`.
- Extra `state.player` fields (optional for the HUD): `aimEnt`, `ejectHold` 0..1, `dash` 0..1 (cooldown),
  `sprint`, `lock.targets[]` (all completed locks). `lock.target` is the candidate being acquired, else the newest
  lock; `lock.progress` is progress toward the next lock.
- Entities carry `rig` (the model), `yaw`, and on the rig `aimYaw` (torso). The pilot entity is removed from
  `G.ents` while aboard and re-added on eject (new id). The falling rig has `noHit` + `invuln`.
- `player:dead` payload `{cause, x, y, z}`; `punch.x/y/z` is the impact point.
- Prompts written: `E — BOARD RIG`, `V — CALL RIG DROP` (`… (DANGER CLOSE)` when no open ground was found),
  `RIG INBOUND`, `RIG WAITING`, `E — GRAB`, `LMB / E — THROW`, `HOLD X — EJECT` (rig below 20 %), `EJECTING…`,
  `SKYLANCE SEEKING`, `RELEASE Q — FIRE SKYLANCE ×n`.

## Debug params

`mech=1` start aboard a rig at the spawn, `meter=1` drop ready, `god=1` pilot and rig invulnerable.
Harness only: `dummies=1` static Vanta targets, `nohud=1`, `real=enemy,render` (player_full).

## Verified (headless, numeric + screenshots)

Baseline harness and the real-module harness: movement speeds, jump / jetpack / fall damage, drop → land (4.0 s) →
board → walk / dash / jets / slam → pulse / salvo / lock ×n / punch (wall and enemy rig) / grab / throw → manual and
automatic eject → self-destruct → meter restart → pilot death → `ui:restart` (no leaked scene objects from this
module). No console errors. Shots: `shots/player-*.png`.

## Round 2 — movement, cover, on-foot anti-air

**Key map (final).**

| Key | On foot | In the rig |
|---|---|---|
| WASD / mouse | move / aim | move / aim (torso lags) |
| Shift | sprint (forward) | dash |
| Space | jump; again in the air = jetpack; into a ledge ≤ 1.65 m = mantle | jump jets (hold) |
| C | hold = crouch; while sprinting = slide (settles into a crouch if still held); in the air = prime a landing roll | ground slam (in the air) |
| X | tap = combat roll in the move direction; in the air = prime a landing roll | hold = eject |
| LMB / RMB | rifle / launcher | pulse cannons / rocket salvo (LMB also throws) |
| Q | hold = Seeker lock (up to 2 airborne), release = fire | hold = Skylance lock (up to 4), release = fire |
| R | reload | — |
| F | — | punch |
| E | board the rig | grab / throw |
| V | call the Rig drop | — |

- **Slide**: hitbox 0.9 m, speed ×1.12 (max 12.5 m/s), friction 7.5 m/s² (10.8 → 4 m/s in ≈ 0.9 s, ≈ 9 m), steer
  1.3 rad/s, can fire, ends on low speed / C released (after 0.25 s) / leaving the ground; Space jumps out keeping
  the speed. Camera drops 0.8 m, FOV +7. `slide {ent,on}`, `s.slide = 1`.
- **Crouch**: hitbox 1.1 m, 3.2 m/s, rifle `opts.spread −0.003`, camera drops 0.65 m. `crouch {ent,on}`,
  `s.crouch` 0..1 (drops to 0.2 while popped up). Stays crouched under a low ceiling.
- **Roll** (X): 0.55 s, ≈ 5.4 m (11.5 → 6.5 m/s), invulnerable for the first 0.25 s, 0.6 s cooldown after it ends,
  no firing during it. `roll {ent}`, `rig.trigger('roll')`, `s.roll = 1`.
  **Landing roll**: C or X within 0.3 s before a landing faster than 12 m/s → fall damage ×0.2 and the roll keeps
  the horizontal speed (20 m fall: 61 → 12 damage).
- **Mantle**: airborne, pushing into a ledge whose top is 0.1–1.65 m above the feet with standing room → 0.32 s
  pull-up, `mantle {ent}`.
- **Cover**: `state.player.inCover` is true when the sight lines from the (up to 3) nearest Vanta are all blocked by
  voxels within 2.6 m of the pilot (re-checked every 0.15 s). Crouched behind low cover (solid at 0.75–1.2 m ahead,
  free at 1.6 m), firing or holding Q stands the pilot up to shoot over it and ducks back 0.4 s after the last shot.
  Shoulder swap: if the crosshair ray from the current shoulder is blocked within 2.4 m and the other shoulder's
  is not, the camera changes sides (returns to the right after 0.7 s clear). `state.player.shoulder` is ±1.
- **Seeker**: third pilot weapon when `G.combat.WEAPONS.seeker` exists (the game runs without it). Same lock code,
  `lock` events and `state.player.lock` fields as Skylance; fires from the pilot's `aaPod` socket.
- **Punch height fixed**: the swing starts at fist height (half the rig's height) and, for targets closer than
  ~7 m with a roughly level look, goes straight out at that height; it follows the crosshair's height as the target
  recedes (fully by 16 m) or when the pitch is beyond ±0.35 rad.
- Extra `state.player` fields: `slide`, `roll`, `crouch`, `inCover`, `shoulder`. New prompts: `SEEKER SEEKING`,
  `RELEASE Q — FIRE SEEKER ×n`. PLAYER owns no control-reference strings; the UI's tips need the key map above.
- New tuning knobs in `G.player.tune`: `slide*`, `roll*`, `landRoll*`, `crouch*`, `popTime`, `cover*`, `mantle*`.

## Phase B — Rig Bay loadouts and rig depth

**Final key map.**

| Key | On foot | In the rig |
|---|---|---|
| WASD / mouse | move / aim | move / aim (torso lags) |
| Shift | sprint (forward) | dash (Harrier: two charges, also in the air) |
| Space | jump; again in the air = jetpack; into a ledge = mantle | jump jets (hold); releases a grapple reel |
| C | hold = crouch; while sprinting = slide; in the air = prime landing roll | Warden: ground slam (air) · Bastion: hold = brace · Harrier: — |
| X | tap = combat roll | hold = eject |
| LMB / RMB / Q | rifle / launcher / Seeker (hold-lock) | fire group 1 / 2 / 3 (lock weapons: hold to lock, release to fire) |
| G (T) | — | arm equipment: shield (hold) or grapple (tap). With two, G = left arm, T = right arm |
| F | — | punch combo · shield bash (shield raised) · tear limb (clinch) · finisher (prompted) |
| E | board own rig · plant charge / hijack on a Vanta rig | grab / throw |
| V | call the Rig drop | — |
| 1 / 2 / 3 | choose the loadout that drops | — |
| R | reload | — |

- **Loadout drop.** The rig is built with `G.models.create('mech', {chassis, loadout, paint})` (falls back to the plain
  Warden if that throws) and `G.rigs.derive(loadout)` sets hp, walk speed, dash speed, jet seconds, torso/leg turn
  rate, body radius/height (hitbox capped at 2.2 × 10.5 m), punch scale (× 1.25 per empty arm) and stomp scale.
  An overweight loadout refuses to drop. `state.player.loadout = {name, chassis, index}`; chase camera scales with
  the chassis height.
- **Weapons.** One state per fitted weapon in slot order, each with `slot`, `key`, `group`. A module whose weapon id
  is not in `G.combat.WEAPONS` is skipped. Muzzle = `rig.sockets[slot]` (old socket names as fallback); fire passes
  `opts.slot / side / aim`; `trigger('fire', slot)` plus the legacy trigger. Identical weapons on one trigger
  alternate at 1.5 × one weapon's rate (`tune.twinRate`); the lance is called every frame. Siege / mortar kick comes
  from `weapon:recoil` (camera + 7 m/s·strength knock-back unless braced). Reactor: weapon `update(dt × 1.3)`.
  Lock weapons on any key share one lock run per key: each takes air and/or ground targets per `lockAir/lockGround`
  (neither set = air only), up to its own `maxLocks`/shots; on release each fires at its own locks.
- **Shield** (hold G/T): `ent.shield = {on, yaw (torso), arc 1.15 rad, hp ≤ 700}`; 12/s upkeep, recharges 90/s after
  1.2 s lowered, breaks at 0 until 35 %. `onDamage` absorbs frontal `explosion` and `melee` damage from the pool
  (COMBAT absorbs direct hits) and emits `shield:hit`. Walk −30 %. F = bash: 12 m/s lunge, 300 × punch scale,
  heavy knock-back, 1.3 s stagger, wall carve. `rig.setShield(energy)`; bus `shield {ent,on,broken?}`.
- **Grapple** (tap G/T, 55 m, cable mesh): world → reel at up to 42 m/s, released on arrival / Space / G / wall
  contact with an upward pop (C slams out of it on the Warden); Vanta rig → both close (`pull`), then `clinch` for
  3.5 s where F tears a limb (`target.tearLimb(limb, by)` if present, else `rig.setLimbLost` + 450 damage;
  `limb:torn {ent, limb, by}`; armR first, then armL); anything smaller → yanked in over 0.35 s and smashed for 600.
  Bus `grapple {ent, state: reel|pull|clinch|yank|miss|release}`.
- **Nanites** 12 hp/s after 5 s without damage; **booster** from `derive` plus 35 % faster refuel.
- **Abilities.** Harrier: 2 dash charges, 1.6 s recharge each, usable airborne (other chassis dash on the ground
  only). Warden: slam. Bastion: brace (hold C on the ground): rooted, damage × 0.5, no recoil; its stomp scale 1.6
  walks through concrete at all times. Bus `brace {ent,on}`; `s.brace`, `s.shield` passed to the rig model.
- **Brawling.** Punches on rigs / tanks stagger (`target.stagger(sec)` if present, plus a private timer) and knock
  them back; PLAYER slides the target for 0.55 s and, if a building is in the way, carves it around the body and
  adds crush damage (80 + 6 × speed). Combo: three F presses within 1.2 s of each other; the third is an overhead
  at × 1.8 damage, bigger radius, 1.5 s stagger (`punch.combo`, `punch.heavy`). Finisher: a staggered rig below
  25 % hp within 6 m in front → prompt `F — FINISHER` → 1.3 s grab / lift / slam, kill, `G.boom` radius 5, both
  `finisher {ent, by, state: start|slam}` and `slam`; the player is invulnerable for the sequence.
- **Boarding charge.** On foot within 3.2 m of a Vanta rig: `E — PLANT CHARGE` → 1.6 s on its back (invulnerable,
  `noHit`), jetpack leap clear, 0.8 s fuse, 650 damage + 2 s stagger. Bus `charge:mount`, `charge:planted`.
  **Hijack**: only when the target has `disabled === true` and exposes its model as `ent.rig`/`ent.model`, and the
  player has no rig: calls `ent.onHijack?.(pilot)` and `G.enemy.release?.(ent)`, turns the entity into the player's
  rig as-is (team 0, hp kept, `e_pulse` → LMB, `e_salvo` → RMB) and boards it. Bus `mech:hijack {ent, by}`.
  ENEMY must stop driving that entity in `onHijack` / `release`.
- **Rig Bay preview.** While `state.bay.open` in `title` or `paused`: a rig built from `state.bay.preview` (or the
  active loadout) stands on open ground at the map centre, turning slowly; rebuilt 0.12 s after `bay:preview`;
  camera at fov 38 with the rig centred in the right part of the screen (centred at ≤ 700 px). In `paused` it runs
  from PLAYER's own animation frame (the sim is frozen) and the gameplay camera is restored on close. Disposed on
  `bay:close`, on leaving those phases and on reset.
- **State for the HUD.** `weapons[i].slot/key`, `loadout`, `equip {shield:{on,energy,broken,key}|null,
  grapple:{state,key}|null}`, `dash` (0..1), `dashCharges`, `brace`, `chassis`, `canPlant`, `canHijack`.
  New prompts: `E — PLANT CHARGE`, `E — HIJACK RIG`, `PLANTING CHARGE…`, `F — TEAR LIMB`, `F — FINISHER`,
  `SPACE — RELEASE`, `BRACED`, `SEEKING LOCK`, `RELEASE <key> — FIRE ×n`.
- **Debug.** `mech=1&loadout=0|1|2`, `bay=1`; `G.player.debug.spawnRig(x, z, board, loadoutIndex)`, `.rc`, `.gr`,
  `.sh`, `.fin`, `.bc`, `.pv`, `.stagger(ent, sec)`, `.hijack(ent)`.
- **Verified** with the real MODELS / COMBAT modules for all three default loadouts: derived hp / speed applied,
  each trigger fires the right weapon ids from the right sockets, frontal blast fully absorbed by the shield and a
  rear blast not, brace halves damage and cancels siege recoil, two air dashes, 41 m grapple reel, pull → clinch →
  limb torn, drone yanked and killed, combo 430 / 430 / 774, wall knock carving 68 voxels, finisher, boarding charge
  650, hijack of a `disabled` dummy, preview build / rebuild / dispose in title and paused. 30 s scripted fights per
  loadout against the real ENEMY ran without console errors.
- **Limits.** `tearLimb`, `stagger`, `disabled` are not in ENEMY yet, so tear falls back to damage, stagger is only
  PLAYER's own timer (it gates the finisher but does not stop the enemy acting), and hijack never triggers in play.
  Knock-back, grapple pull and the finisher move enemy entities directly; ENEMY's own movement may fight that until
  it honours `stagger`. None of the Phase B visuals (cable, shield disc, preview framing in the real plaza) were
  reviewed in full-game screenshots.

## Phase C — field perks, unlocks, victory

- `G.progress.mult(k)` is applied as follows (re-applied on `perk:taken` and `game:start` by `applyPerks`):
  `rigArmor` → rig max hp (taking it also repairs by the amount added); `rigSpeed` → walk, dash and turn rate;
  `jet` → rig jet seconds and jetpack seconds; `cool` → rig weapon `update(dt × cool)` (stacks with the reactor);
  `melee` → punch, combo, bash and slam damage; `shield` → shield pool and recharge rate; `pilotHp` → pilot max hp
  and regen delay ÷ 1.5; `meter` → time and kill fill; `mag` → rifle `clipMax` × 1.5 and launcher reload ≈ 30 %
  faster; `blast` → radius of the self-destruct, and +15 % damage on every explosion credited to the player;
  `energy` → +20 % on pulse / lance hits.
- COMBAT does not read `G.progress`, so `energy` and `blast` damage are added as a second, smaller
  `G.ents.damage` call (flagged `info.bonus`) right after the original hit. Weapon blast **radius** is not
  enlarged; that needs COMBAT to read `mult('blast')` in its detonation.
- A loadout that is not `progress.loadoutUnlocked` refuses to drop (`LOADOUT LOCKED` message).
- While `G.progress.offer` is non-null all player input (move, look, fire, abilities, 1/2/3 loadout keys) is
  ignored and the eject slow-motion does not touch `G.timeScale`. Camera smoothing runs on unscaled time.
- `game:won` → input stops, locks clear, and the camera orbits the pilot / rig (radius scales with its height)
  until the next `game:start` or reset. `G.player.debug.won`, `G.player.debug.applyPerks()`.
- Verified numerically: every multiplier above, the locked-loadout refusal, zero movement / shots / look with the
  picker open at `timeScale` 0.05, and the victory orbit.

## Phase D — co-op hooks and wire contract

Everything below is behind `G.net && G.net.online`; offline nothing is pushed, allocated or changed.

### Wire contract

`G.player.netState()` → the **same object every call**, rewritten in place (copy what you keep):

```
{ mode: 'pilot'|'mech'|'down'|'dead',
  chassis: ''|'harrier'|'warden'|'bastion',      // of the player's rig, if one exists
  loadout: object|null,                           // reference to the rig's loadout (send when the reference changes)
  paint: string,                                  // loadout.paint id, '' without a rig
  x, y, z, vx, vy, vz,                            // the CONTROLLED entity (rig when mode 'mech', else pilot), feet
  yaw,                                            // body yaw (rig: legs)
  aimYaw, aimPitch,                               // absolute world yaw of the aim (rig: torso yaw), pitch up +
  speed, fwd, strafe, grounded, jet, heat,        // the animation inputs passed to rig.update
  hpFrac,                                         // 0..1 of the controlled entity
  flags: { crouch, slide, roll, shield, brace, dash, down, grab },   // booleans
  hasRig, rigX, rigY, rigZ, rigYaw, rigHpFrac,    // an unboarded rig standing in the world (valid when hasRig)
  incoming: null | { x, z, eta } }                // own Rig drop in flight (eta seconds)
```
For a puppet's `rig.update`, `aimYaw` relative to the body is `wrapPi(aimYaw - yaw)`.

`G.player.netEvents` → array NET drains (`length = 0`) each frame; capped at 64. Shapes:

| type | fields |
|---|---|
| `trigger` | `who: 'pilot'|'mech'`, `name`, `arg` (null if none) — every `rig.trigger` call on the local models |
| `punch` | `x,y,z` (impact point), `dx,dy,dz`, `hit`, `heavy`, `side: 'L'|'R'` |
| `slam` | `x,y,z`, `radius` |
| `drop` | `x,y,z` (landing point), `eta`, `loadout` |
| `land` | `x,y,z` |
| `board` | `x,y,z`, `hijack` |
| `eject` | `x,y,z` (rig position), `manual` |
| `selfdestruct` | `x,y,z`, `radius` |
| `down` / `revived` | `x,y,z` |
| `revive` | `target` (the downed puppet's `netOwner`) — also emitted on the bus as `revive {ent, by}` |

The world effects of punch / slam / self-destruct reach other peers through DESTRUCT's replicated ops and the
explosion events; these one-shots are for the puppet's animation, sound and markers.

### Behaviour
- **Down instead of dead.** Online, the pilot at 0 hp calls `setDown`: mode `'down'`, `pilot.down = true`,
  `alive = false`, `noHit`, bus `player:down {ent, cause, x,y,z}`. No input, meter frozen. The camera spectates a
  living entry of `G.net.players()` (LMB cycles; pilot or rig boom to suit), or orbits the body if none.
  `G.player.applyRevive(frac = 0.5)` stands the pilot up where they fell at 50 % hp with 2 s of invulnerability and
  emits `player:revived`. `G.player.setDown()` forces the state.
- **Run over.** `G.player.allDown(cause)` emits `player:dead`. NET should call it when everyone is down. As a
  fallback PLAYER calls it itself after 1.5 s down with no living teammate in `G.net.players()`; set
  `G.net.reportsAllDown = true` to switch that fallback off.
- **Reviving.** Within 3.5 m of an entity with `remote && down && team 0` (on foot or in the rig): prompt
  `HOLD E — REVIVE`, `state.player.revive {ent, progress}`; after 4 s held → bus `revive {ent, by}`. E does nothing
  else while a candidate is in reach.
- **Teammates are never targets**: punch, bash, stomp, ram, grapple, lock-on, finisher and boarding charge only
  consider team 1; every `G.boom` PLAYER makes passes `friendlyFire: false`.
- **Credit** is by `info.src ∈` the entities this PLAYER owns, so a claimed hit applied with `info.src` = our
  entity (or a replicated `ent:death` carrying it) scores, feeds the meter and counts the kill here only.
- The eject slow-motion does not touch `G.timeScale` online.
- HUD fields: `state.player.mode` may be `'down'`; `down`, `spectating` (entity or null), `revive`. Prompts:
  `HOLD E — REVIVE`, `LMB — NEXT TEAMMATE`.
- **For NET:** hits on remote entities return 0 from `ents.damage` with no local `ent:damage`, so the hit marker
  and the `energy` / `blast` perk top-ups do not fire on clients unless NET re-emits `ent:damage` for confirmed
  claims (the top-up then goes out as a second claim) or calls `G.player.hitConfirm()` for the marker.
- Verified with a fake `G.net`: offline unchanged (no events queued), `netState` on foot / waiting rig / incoming
  drop / in the rig, trigger and one-shot events, revive hold (progress 0.5 at 2 s, event at 4 s), down → spectate
  → revive → move, claimed-kill credit, all-down → `player:dead`. Not tested against the real `src/net.js`.

## Known issues / limits

- Grab still aims at the crosshair, whose pivot is 8.7 m up: look down to grab things at street level.
- When the rig wades into a building the shoulder pivot can end up inside a room and the boom pulls in hard. It
  never clips, but the view is cramped until the rig is back in the open.
- A boom probe grazing a wall face parallel to the view pulls the camera in more than strictly needed.
- Entities do not block the pilot (only the rig is pushed out of tanks / rigs).
- The eject apex depends on the slow-motion ramp only visually; game-time physics are unchanged (≈ 30–36 m).
- Full-game screenshots take minutes on the software GPU, so most look iteration was done on the harnesses.

## Requests for lead

- None blocking. COMBAT already applies the 35 % own-blast share, so PLAYER does not scale explosions again.
- `tools/shot.mjs` has a fixed 30 s screenshot timeout, which the full build exceeds on a loaded machine.
