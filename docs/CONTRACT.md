# KILOTON — build contract

Original third-person mech combat game in a fully destructible voxel city. Single self-contained HTML file,
three.js bundled inline, **no asset files of any kind** (all geometry, textures and audio are procedural).
Desktop only: mouse + keyboard. Single player now; keep entity-based design so multiplayer can be added later.

**Originality rule.** This is our own game. Do not use names, characters, designs, UI or audio from existing
franchises (no "Titan", "Titanfall", "BattleMech", "MechWarrior", "Gundam", etc.). Our vocabulary:
the game is **KILOTON**; the player's mech is a **Rig** (model name "Warden"); calling it in is a **Rig drop**;
the enemy faction is **Vanta**; the city district is **Halden Yard**.

## 1. The game in one paragraph

Wave survival. You start on foot as a rig pilot with a rifle and a rocket launcher. Vanta infantry, drones,
tanks, gunships and enemy rigs arrive in escalating waves. Kills (and time) fill the **rig meter**; when full,
press V to call a Rig drop: the Warden falls from orbit onto the spot you aim at, levelling whatever is under
it. Board it (E). In the rig you have twin **pulse cannons** (heat: overheat forces a cooldown), a **rocket
salvo** (recharges), **Skylance** anti-air missiles (hold to lock airborne targets, release to launch),
a **punch** that smashes walls and throws the masonry into whatever is behind them, **jump jets** with a
mid-air **ground slam**, and **grab and throw** (cars, rubble, wall chunks). When the rig is finished you
**eject** skyward and it self-destructs, flattening the block. Certain Vanta soldiers ("aces") earn their own
rigs if they live long enough. Every voxel of the city can be destroyed; buildings that lose their support
collapse and the falling masonry damages whatever it lands on. The run ends when the pilot dies.

## 2. Art direction (everyone)

"Voxel, but AAA." The world is built of 0.5 m voxels, crisp and honest about it, but lit like a film:
- **Golden hour.** Low sun raking down the avenues, long soft shadows, warm key (peach/gold) against cool
  blue-violet sky fill, light haze that thickens with distance and catches the sun, lit windows and neon signs
  starting to glow. Explosions, pulse fire and jets are the brightest things in frame and bloom.
- HDR linear pipeline, filmic tone map, restrained bloom, subtle grade, vignette. Never crushed blacks, never
  blown-out whites on plain concrete. Dust and smoke are *lit* (sun-warm on one side, sky-cool on the other),
  never flat grey cut-outs, never self-luminous.
- **Faction colour.** Player side: gunmetal + teal/cyan emissive. Vanta: dark oxblood + hot orange-red
  emissive. Pulse fire: player cyan-white, Vanta orange-red. This must read at a glance in a firefight.
- Models (rigs, soldiers, vehicles) are chunky hard-surface shapes built from boxes/bevelled blocks so they
  belong in a voxel world, with PBR materials, panel detail and emissive strips. No smooth organic blobs.
- Scale reads: pilot 1.8 m, rig 8.5 m, storeys 3.5 m, towers up to ~44 m. The rig must feel HEAVY: slow torso,
  ground-shaking steps, things break when it touches them.
- HUD: a military instrument cluster, not a web page. Thin strokes, condensed caps, cyan for the player's
  systems, amber for warnings, red for damage. Readable over a bright exploding scene.

## 3. World conventions

- Units: metres. **x east, y up, z south.** Voxel size `VS = 0.5`. Grid `NX×NY×NZ = 384×96×384`
  (192 × 48 × 192 m). Voxel `(i,j,k)` spans `[i*VS,(i+1)*VS]` etc. Index `i + NX*(k + NZ*j)`.
- Ground: voxels `j < GROUND_J (4)` are ground; `j = 0` is indestructible bedrock. Street surface `y = GROUND_Y = 2.0`.
  Craters can be up to 1.5 m deep.
- **Yaw**: `yaw = 0` faces +Z; forward = `(sin yaw, 0, cos yaw)`; model local forward is **+Z**, local right is **-X**
  when viewed from above (three.js right-handed; just use `root.rotation.y = yaw`). Pitch positive = up.
- Entity `pos` is the **feet / bottom-centre**. Teams: `0` player side, `1` Vanta.
- Time: `G.time` (game seconds, scaled), `G.dt` (scaled, 0 when paused), `G.rawDt` (unscaled, for UI).
  `dt` is clamped to 50 ms. Use `G.time`, never `performance.now()`, for gameplay timers.
- Scene renders in **linear HDR**; anything emissive/additive brighter than ~1.0 blooms. Do not tone-map in your
  own shaders. Custom ShaderMaterials should include three's fog chunks (or fade to `G.render.fogColor`).

## 4. Files and ownership

Lead-owned, **read-only for agents**: `CONTRACT.md`, `build.mjs`, `tools/*`, `src/core.js`, `src/materials.js`,
`src/voxels.js`, `src/boot.js`, `src/main.js`, `src/shell.html`, `src/baseline/*`.

| Agent | Owns (may create more files with the same prefix, e.g. `src/render_sky.js`) | Module name |
|---|---|---|
| CITY | `src/city.js`, `src/city_*.js` | `G.city` |
| RENDER | `src/render.js`, `src/render_*.js` | `G.render` |
| DESTRUCT | `src/destruct.js`, `src/destruct_*.js` | `G.destruct` |
| FX | `src/fx.js`, `src/fx_*.js` | `G.fx` |
| AUDIO | `src/audio.js`, `src/audio_*.js` | `G.audio` |
| MODELS | `src/models.js`, `src/models_*.js` | `G.models` |
| COMBAT | `src/combat.js`, `src/combat_*.js` | `G.combat` |
| PLAYER | `src/player.js`, `src/player_*.js` | `G.player` |
| ENEMY | `src/enemy.js`, `src/enemy_*.js` | `G.enemy` |
| UI | `src/ui.js`, `src/ui_*.js` | `G.ui` |

Each agent also owns `harness/<agent>*.js`, `notes/<agent>.md`, `shots/<agent>-*.png`, `dist/h-<agent>*.html`.
**Never edit a file you do not own.** If the contract or a lead file blocks you, work around it and write the
request in `notes/<agent>.md` under "Requests for lead".

A module is a default export: `{ name, init(G) (may be async), reset(), update(dt), ...api }`. `boot` sets
`G[name] = module` for all modules **before** any `init` runs, then inits in this order:
`city, render, destruct, fx, audio, models, combat, player, enemy, ui`. Per frame:
`input.frame → player, enemy, combat, destruct, fx, audio, ui (update) → render.update → render.render`.
`reset()` is called on restart after the grid has been restored and `G.ents` cleared: drop all runtime state
(debris, particles, projectiles, enemies, timers) and return to a fresh run. It must not leak scene objects.

`src/<name>.js` currently re-exports the lead's baseline; **replace the whole file**. Baselines
(`src/baseline/*.js`) stay as they are: they are the minimal reference implementation of every API below and
they are what your harness runs for every module you do not import. Read the baseline of any module you call.

## 5. Lead APIs (read the source: `src/core.js`, `src/voxels.js`, `src/materials.js`)

- `G` namespace, `bus.on/off/emit`, helpers `clamp sat lerp smooth damp dampAngle wrapPi mulberry32 hash3`.
- `G.input`: `down(code) pressed(code) released(code) button(b) buttonPressed(b) buttonReleased(b) mdx mdy wheel
  axisX() axisY() lock() unlock() locked fallbackLook`. Codes are `KeyboardEvent.code`.
- `G.ents`: `list add(e) remove(e) damage(e, amount, info) radiusDamage(x,y,z,r,dmg,info,exceptTeam)
  raycast(ox,oy,oz,dx,dy,dz,maxDist,ignore,ignoreTeam) forEachInRadius(x,y,z,r,fn)`. Entity fields are
  documented in `core.js`. **All damage goes through `G.ents.damage`** so score, meter, HUD and audio hear it.
- `G.grid`: `get set fill fillBox matAt solidAt boxSolid topBelow raycast los moveBody unstick takeDirty
  markAllDirty snapshot restore version`. `raycast` returns a shared object: copy what you keep.
- `G.boom(x,y,z,{radius,power,damage,owner,kind,dmgRadius})`: the one call for an explosion (world + entities + event).
- Materials: `MAT[id]`, `M.<name>` ids, flat tables `SOLID STRENGTH STRUCT GLASS DENSITY EMISSIVE COLOR`.
- `G.quality { tier:'low'|'med'|'high', shadowRes, post, debrisMax, particlesMax, pixelRatio }`; bus `'quality'`.
- `G.state`: see `core.js`. Writers: `phase` → boot; `state.player.*` → PLAYER; `state.wave.*` → ENEMY;
  `state.stats.voxelsDestroyed/buildingsLevelled` → DESTRUCT; `state.stats.mechsCalled` → PLAYER;
  `state.settings.*` → UI (everyone reads).
- Phases: `'title' | 'playing' | 'paused' | 'over'`. Bus: `'phase' {phase, from}`, `'game:start'`, `'game:pause'`,
  `'game:resume'`, `'game:over' {…}`. UI requests transitions by emitting `'ui:start' 'ui:pause' 'ui:resume'
  'ui:restart' 'ui:title'`. PLAYER ends the run by emitting `'player:dead' {cause}`.
  In `'title'` modules still update (PLAYER flies a title camera over the city; nothing spawns).
  In `'over'` time runs at 35 % so the death plays out behind the debrief card.
- Loading: bus `'load' {step,total,label}`; the veil `#kt-load` in `shell.html` is lead-owned.

## 6. Module APIs

### 6.1 `G.city` (CITY)
`init()` generates Halden Yard into the grid from `G.state.seed` (deterministic), then `grid.snapshot()` and
`grid.markAllDirty()`. Exposes:
- `buildings[]`: `{ id, kind, name, i0,j0,k0,i1,j1,k1 (inclusive voxel bounds), voxels (solid count at start), alive }`
- `lot: Uint8Array(NX*NZ)` per column: `0` road, `1` sidewalk, `2` building footprint, `3` plaza/park.
- `buildingAt: Int16Array(NX*NZ)`: building id + 1, or 0.
- `spawns`: `{ player:{x,z,yaw}, edge:[{x,z}…] (≥8 street mouths at the map edge where ground enemies enter),
  air:[{x,y,z}…] (≥6 entry points above the roofline at the edge), mechDrops:[{x,z}…] (open street/plaza spots
  ≥ 10 m clear, good landing zones for rigs) }`
- `roadNodes[]`: `{ x, z, links:[index…] }` intersections and street ends (AI routing graph).
Design: a dense downtown grid of ~5×5 blocks around a central plaza, streets 14–18 m wide (a rig is 3.6 m wide
and must fit everywhere; some alleys 4–5 m for pilots only), sidewalks, crosswalks, lane markings. ~35–45
buildings of clearly different kinds: glass office towers (steel/concrete frame, curtain wall), brick
apartment blocks (windows, balconies, some lit), concrete parking structure (open decks, ramps), low shops
with awnings and neon, a warehouse, a construction site with a steel skeleton and crane, a gas station with
explosive barrels, a small park with trees. **Buildings are hollow and structural**: columns and load-bearing
walls (`struct` materials) on a regular bay, floor slabs every 7 voxels (3.5 m), cladding and glass hung on
the frame, sparse interiors (partition drywall, furniture blocks, ceiling lights). Blow out the ground-floor
columns and the frame above has nothing left to stand on. Street props: lamps, traffic lights, parked cars
(with an explosive fuel voxel `barrel_red` inside), bus stop, bins, planters, billboards, rooftop HVAC, water
tanks, antennas. Leave the outermost ~10 m as a ring road so enemies can enter anywhere. Total solid voxels
should stay under ~3.2 M (hollow buildings) so meshing stays fast.

### 6.2 `G.render` (RENDER)
Owns chunk meshing of the voxel grid, voxel materials, sky, sun/ambient lights, shadows, fog, post.
- `init()`: builds all chunk meshes (show progress with `bus.emit('load', …)` if slow), sky, lights, composer.
- `update(dt)`: remesh dirty chunks from `grid.takeDirty(n)` within a time budget (≤ 4 ms/frame; chunks near
  the camera first; a remesh must never leave a visible hole for a frame), move the shadow frustum with the camera.
- `render(dt)`: draws the frame (composer). `setQuality(tier)`.
- `flash(x,y,z, colorHex, intensity, radius, duration)`: short dynamic light from a fixed pool (explosions,
  muzzle flashes). Pool size fixed so shaders never recompile at runtime.
- `sunDir: Vector3` (towards the sun), `sunColor: Color`, `skyColor: Color`, `fogColor: Color`, `ambient: Color`
  (linear HDR values other modules use to light particles and debris consistently).
- Everything else in the scene (rigs, debris, particles) is ordinary three.js objects added to `G.scene` by its
  owner; RENDER's lights/shadows/fog/post apply to them. Standard materials only need `castShadow/receiveShadow`.
Requirements: per-voxel shading detail computed in the shader from world position (subtle per-voxel value
variation, edge darkening / AO, material-specific response: glossy car paint, metal, matte brick), baked
vertex AO, emissive materials actually glow, glass is translucent with sky reflection and breaks cleanly,
wet-looking speculars on asphalt facing the sun. Sky: procedural golden-hour dome with sun disc, layered
clouds, distant skyline silhouettes beyond the map edge so the district does not float in a void, and a ground
plane beyond the grid. Post: bloom, tone map, grade, vignette, optional light FXAA/SMAA; cheap screen-space
sun shafts or height fog welcome if they hold 60 fps. Targets: 60 fps at 1080p on a mid-range desktop GPU with
~2.5 M triangles in view; a full remesh of one 32³ chunk ≤ 3 ms.

### 6.3 `G.destruct` (DESTRUCT)
All changes to the grid at runtime, structural collapse, and rigid debris.
- `explode(x,y,z, radius, power, opts?) → n` removes voxels whose `STRENGTH` is below the falling-off power,
  scorches the rim (`charred`), throws a share of the removed voxels out as debris, then queues a structural check.
  `opts.owner` (entity) is remembered so debris kills are credited.
- `impact(x,y,z, dx,dy,dz, power, radius=0.35) → n` bullet/pulse chip.
- `punch(x,y,z, dx,dy,dz, radius, depth, power, owner) → n` carves a cylinder along `d`; **all** carved voxels
  become fast debris travelling along `d` (this is how a rig knocks a wall onto an enemy).
- `carveBox(x0,y0,z0,x1,y1,z1, power, toDebris=true) → n` (a rig wading through lamp posts, cars, thin walls).
- `burst(x,y,z, { count, colors:[hex…], speed, size, up })` cosmetic debris (vehicle and rig wrecks).
- `grabChunk(x,y,z, r) → chunk | null` pulls a connected cluster (≤ r metres) out of the grid for the rig to
  hold: `{ object: THREE.Object3D (centred on its centre of mass), mass, size (m), voxels }`.
  `releaseChunk(chunk, pos:Vector3, vel:Vector3, owner)` turns it into a thrown rigid body that shatters on
  impact, carving and damaging what it hits.
- `update(dt)`, `stats { debris, bodies, pending }`.
Simulation: after any removal, find voxel clusters no longer connected to the ground (flood fill limited to the
affected building's bounds via `G.city.buildingAt/buildings`, time-sliced, ≤ 4 ms/frame). Detached clusters
become falling rigid bodies (position, velocity, quaternion, angular velocity; collide by sampling points
against the grid; impulse response with friction and restitution). Big bodies break into smaller ones on
impact, small ones bounce and come to rest. Also an **overload** rule so a tower does not stand on one column:
if the load-bearing cross-section under a mass is too small, the weak storey crushes and everything above
drops. Resting debris re-deposits into the grid as voxels of its own material (piles at the foot of ruins that
bodies can walk on), with a cap on live bodies (`G.quality.debrisMax`) by retiring the oldest/smallest.
Debris and bodies **damage entities** they hit: `G.ents.damage(e, f(mass, relative speed), {type:'debris', src: owner})`;
a collapsing storey landing on a rig should hurt it badly, on infantry it is fatal. `barrel_red` voxels that
break trigger a small `G.boom` (chain reactions; cap recursion). Rendering: instanced cubes (per-instance colour
from `COLOR`), shadows on high tier. Events to emit (FX and AUDIO listen):
`'voxels:destroyed' {x,y,z,count,mat,radius}` (aggregate, not per voxel), `'collapse' {x,y,z,mass,height}` when a
big cluster lets go, `'debris:impact' {x,y,z,speed,mass,mat}` (rate-limited), `'building:levelled' {id,name}`
when a building has lost > 70 % of its voxels (also `state.stats.buildingsLevelled++`).
Maintain `state.stats.voxelsDestroyed`.

### 6.4 `G.fx` (FX)
Particles and transient visuals. Listens to the bus (section 7) and offers a direct API for continuous effects:
- `emit(kind, x,y,z, dx,dy,dz, amount)` with kinds `'jet' 'smoke' 'fire' 'dust' 'spark' 'ember' 'steam'
  'trail_rocket' 'trail_missile' 'trail_shell' 'debris_dust' 'blood'`(no gore: use `'spark'`-like puffs for
  soldiers; `'blood'` is a no-op alias).
- `beam(x0,y0,z0,x1,y1,z1, kind)` kinds `'tracer' 'tracer_enemy' 'pulse' 'pulse_enemy' 'lock'`.
- `burst(kind, x,y,z, scale, opts)` kinds `'explosion' 'explosion_big' 'airburst' 'muzzle' 'muzzle_big' 'pulse_hit'
  'dustcloud' 'shockwave' 'sparks' 'glass' 'landing' 'selfdestruct' 'reentry'`.
- `stats { particles }`.
Uses GPU-instanced billboards with procedural shaders (no textures from files); lit by `G.render.sunColor /
skyColor`; respects `G.quality.particlesMax`; zero per-frame allocation. Calls `G.render.flash` for light.
Lingering smoke columns and small fires where big explosions happened; rolling dust when buildings fall.

### 6.5 `G.audio` (AUDIO)
Web Audio only, everything synthesised. `unlock()` (call from the first user gesture; UI calls it),
`play(name, { x,y,z, vol, pitch })` for direct one-shots, `setVolume(master, music)`, `update(dt)` (listener
follows `G.camera`). Listens to the bus (section 7) for weapons, explosions, collapses, debris, footsteps,
jets, UI. Distance attenuation + low-pass + speed-of-sound delay for far explosions. Adaptive music with
intensity layers (on foot: tense pulse; rig drop: a rising build that lands on the impact; in the rig: heavy
percussion and low brass-like synths; wave clear: release). `?mute=1` silences it. Reads `state.settings.volume/music`.

### 6.6 `G.models` (MODELS)
`create(kind, opts?) → rig`; kinds `'pilot' 'soldier' 'mech' 'emech' 'tank' 'drone' 'gunship'`.
`opts`: `{ variant }` — soldier variants `'rifle' | 'rocketeer' | 'ace'` (ace has a visible antenna/cape marker
and brighter emissives); emech variants `'standard' | 'heavy'` (heavy is 1.25× and bulkier).
A rig: `{ kind, root: THREE.Group (origin at the feet, forward +Z; the OWNER sets root.position and
root.rotation.y and adds root to G.scene), radius, height, sockets: { muzzleL, muzzleR, rocketPod, aaPod,
cockpit, handL, handR, jetL, jetR, eye, footL, footR } (Object3D; use getWorldPosition; a kind lacks some),
update(dt, s), trigger(name, arg), setDamage(0..1), onFootstep: null | (side, worldPos, heavy) => {} , dispose() }`.
`update(dt, s)` with `s = { speed (planar m/s), fwd (-1..1), strafe (-1..1), aimYaw (rad, relative to body),
aimPitch (rad, up +), grounded, vy, jet (0..1), dead }` drives procedural animation: walk/run cycles with
foot plants and body bob, torso twist to the aim, arm/weapon pitch, idle breathing, jet flaps.
`trigger`: `'fireL' 'fireR' 'fireRocket' 'fireAA' 'punch' (arg 'L'|'R') 'slam' 'land' (arg strength 0..1) 'hit'
'grab' 'throw' 'jump' 'boot' 'open' 'close' 'death'` — additive recoil / one-shot animations.
Nominal sizes (also in `G.models.DIM[kind] = [radius, height]`): pilot/soldier 0.35 × 1.8; mech/emech 1.8 × 8.5
(heavy 2.2 × 10.5); tank 2.2 × 2.6; drone 0.9 × 0.7; gunship 3.2 × 2.6.
The player's Warden rig is on screen from behind for most of the game: it gets the most love (silhouette,
back detail, jet nozzles, shoulder rocket pod and AA rack, glowing cockpit, heat vents that glow when the pulse
cannons are hot via `s.heat` 0..1). Meshes cast shadows. Share geometries/materials between instances.

### 6.7 `G.combat` (COMBAT)
Weapons and projectiles for everyone.
- `WEAPONS[id]` definitions. Player pilot: `'rifle'` (auto, 30-round magazine, reload), `'launcher'` (single
  rocket, reload), `'grenade'` (optional). Player rig: `'pulse'` (twin cannons, alternating barrels, heat),
  `'salvo'` (6 rockets ripple-fired, recharge), `'skylance'` (homing AA missiles at up to 4 locked targets,
  recharge). Vanta: `'e_rifle' 'e_rpg' 'e_shell' (tank) 'e_drone' 'e_chain' (gunship gun) 'e_gsrocket' (gunship)
  'e_pulse' 'e_salvo' (enemy rig)`.
- `createWeapon(id) → w`: `{ id, def, name, kind:'auto'|'semi'|'heat'|'charge'|'lock', clip, clipMax, reloading
  (0 = no, else 0..1 progress), heat (0..1), overheated, charge (0..1, recharge progress), cd, ready,
  update(dt), canFire(), fire(shooter, origin:Vector3, dir:Vector3, opts?) → bool, reload() }`.
  `opts`: `{ targets:[entity…] (lock weapons), spread, side:'L'|'R' }`. The wielder owns the state object and
  calls `update` every frame. The HUD reads these fields from `state.player.weapons`.
- `fireProjectile(id, shooter, origin, dir, opts)`, `projectiles[]` (live list: `{id, kind, pos, vel, team, target}`
  for radar/warnings), `throwObject(chunk, origin, vel, owner)` (delegates to `G.destruct.releaseChunk`).
- `update(dt)`: integrates projectiles (bullets as very fast tracers, rockets with slight wobble and smoke,
  pulse bolts, homing missiles with limited turn rate, lobbed tank shells), tests the grid (`grid.raycast`
  along the step) and entities (`ents.raycast`), applies `ents.damage` / `G.boom` / `G.destruct.impact`,
  emits `'shot' 'tracer' 'impact'`, and draws the projectile bodies (instanced, emissive, bloom-bright).
Balance intent: rifle kills a soldier in ~4 hits and tickles armour; a rocket kills soldiers in a 3 m radius,
takes 1/6 of an enemy rig and punches a 3 m hole in a wall; pulse bolts chew through concrete walls in a
second of fire and kill a tank in ~3 s; a full salvo wrecks a small building's ground floor; Skylance one-shots
drones and two-shots gunships. Vanta weapons are readable and dodgeable: visible travel time, tells before
heavy shots. Friendly fire off for direct hits; the player's own explosions hurt the player at 35 %.

### 6.8 `G.player` (PLAYER)
The pilot and Warden controllers, the third-person camera, the rig meter / drop / board / eject cycle.
Creates entities (`kind:'pilot'` and `'mech'`, `team:0`, `isPlayer:true` on the controlled one), rigs via
`G.models`, weapons via `G.combat.createWeapon`. Writes `state.player.*` every frame. Exposes
`G.player.ent` (controlled entity), `G.player.cameraShake(amount)`.
Controls — pilot: WASD move, mouse aim, Shift sprint, Space jump (again in air: jetpack boost, fuel),
LMB rifle, RMB launcher, R reload, V call Rig drop at the aimed spot (when ready), E board.
Rig: WASD, mouse aim (torso turns slower than the camera), Shift dash, Space jump jets (hold, fuel),
C in mid-air ground slam, LMB pulse cannons, RMB rocket salvo, Q hold-to-lock Skylance / release to fire,
F punch (alternating fists; also auto-smashes weak voxels the rig walks through with `carveBox`),
E grab / throw, X hold to eject (self-destruct). Number keys/wheel are not required.
Camera: over-the-shoulder for the pilot (~3.4 m back), high chase for the rig (~15 m back, 9 m up), collision
against voxels (pull in, never clip), aim point = first hit of the crosshair ray (grid + entities) written to
`state.player.aim`; weapons converge on it from the rig's muzzle sockets. Shake from explosions, steps,
landings (listen to `'explosion' 'mech:land' 'collapse' 'slam'`; scale by distance and `settings.shake`), FOV
kick on dash/drop, a title-screen orbit over the city in phase `'title'`, a slow orbit of the wreck in `'over'`.
Rig drop: `'mech:incoming' {x,z,team:0,eta}` → falling rig with FX → on touchdown `G.boom` (radius ~7) +
`'mech:land' {x,y,z,team}` → idle, glowing, waiting; `state.player.canEnter` when within 5 m → E →
`'mech:enter'`. Meter: fills by kills (soldier 7 %, drone 9 %, tank 22 %, gunship 28 %, enemy rig 55 %) and
slowly with time (so the first rig arrives in ~60–90 s of decent play). Pilot hp 100 with regeneration after
4 s out of fire; rig hp 1800, no regeneration. Rig at 0 hp: automatic ejection (pilot launched ~30 m up,
slow-motion beat, then the rig detonates: `G.boom` radius ~12, `'mech:selfdestruct'`); manual eject (hold X)
does the same with a larger blast. Pilot death → `'player:dead'`. Debug params: `mech=1` start in the rig,
`meter=1` start with the drop ready, `god=1` invulnerable.

### 6.9 `G.enemy` (ENEMY)
Wave director and all Vanta AI. `list` (live enemy controllers), `spawn(kind, x, z, opts)`.
Kinds: `soldier` (variants rifle / rocketeer / ace), `drone`, `tank`, `gunship`, `emech` (standard / heavy).
Entities `team:1`; drones and gunships `airborne:true`. Uses `G.models`, `G.combat.createWeapon('e_*')`,
`grid.moveBody`, `grid.los`. Navigation: a coarse 2D cost grid (2 m cells) rebuilt incrementally from the
voxels at street level as the city changes + a flow field to the player; rigs and tanks smash through weak
obstacles with `G.destruct.carveBox/punch` rather than getting stuck. Behaviours: soldiers advance in
squads, take cover behind solid voxels, flank, rocketeers target the rig; drones swarm and strafe; tanks hold
range and shell (their shells wreck buildings); gunships orbit, strafe and fire rockets, break off when
locked; enemy rigs stalk, fire pulse and salvos, **punch walls and the player's rig** at close range, use
jump jets. Enemy rigs arrive by Rig drop like the player's (`'mech:incoming' {team:1}` with a visible warning).
**Aces**: a soldier variant with a visible charge that fills while alive (~35 s); when full they call a rig
drop and board it (kill them first). Waves: `state.wave { n, alive, total, intermission, enemyMechs }`,
`'wave:start' {n, total, label}`, `'wave:clear' {n}`, ~8 s intermission; composition escalates (wave 1: a few
infantry; 2: + drones; 3: + tank; 4: + ace; 5: gunships + enemy rig; then mixed and larger, a heavy rig every
5th). Difficulty should let a new player reach wave 4–6. Debug params: `wave=N`, `noenemy=1`,
`spawn=tank,emech,soldier…` (spawn that set near the player at start, no waves).

### 6.10 `G.ui` (UI)
DOM/CSS/SVG/2D-canvas inside `#kt-ui` (pointer-events only where needed). Title screen (name, one-line pitch,
controls for pilot and rig, Start; shows best wave from `localStorage` in try/catch), HUD (crosshair that
changes per weapon and blooms with spread, hit marker from `'ent:damage'` by the player, health / rig armour,
weapon cards with magazine, reload, heat and recharge states, jet fuel, the rig meter with "RIG READY — V",
drop countdown, wave banner and enemy count, a radar (2D canvas: enemies by type, rigs, the waiting rig, north
up or heading up), damage-direction arcs, lock-on brackets over locked/locking targets projected with
`G.camera`, incoming-missile warning, context prompts from `state.player.prompt`, score/kill feed, low-health
vignette, ace warning "ACE CHARGING" with a world marker), pause card with settings (mouse sensitivity, master
and music volume, quality low/med/high via `G.setQuality`, camera shake, invert Y) and controls, debrief card
(wave reached, kills, rigs called, voxels destroyed, buildings levelled, time; Retry / Title). Messages via
bus `'ui:message' {text, sub, kind:'info'|'warn'|'good', dur}`. Starts the game with `G.input.lock()` +
`G.audio.unlock()` + `bus.emit('ui:start')` from a click. Handles pointer-lock refusal gracefully (the game
still plays with `input.fallbackLook`). Debug: `ui=title|hud|rig|pause|over` forces a screen with plausible
fake state so it can be screenshotted.

## 7. Bus events (emitters → listeners). Positions are world metres.

| Event | Payload | Emitted by |
|---|---|---|
| `shot` | `{weapon, x,y,z, dx,dy,dz, shooter, team}` | COMBAT |
| `tracer` | `{weapon, x0,y0,z0, x1,y1,z1, team}` | COMBAT |
| `impact` | `{weapon, x,y,z, nx,ny,nz, mat, power, ent}` | COMBAT |
| `explosion` | `{x,y,z, radius, power, kind, owner}` | `G.boom` |
| `voxels:destroyed` | `{x,y,z, count, mat, radius}` | DESTRUCT |
| `collapse` | `{x,y,z, mass, height}` | DESTRUCT |
| `debris:impact` | `{x,y,z, speed, mass, mat}` | DESTRUCT |
| `building:levelled` | `{id, name}` | DESTRUCT |
| `ent:add` / `ent:remove` | entity | core |
| `ent:damage` | `{ent, amount, info}` | core |
| `ent:death` | `{ent, info}` | core |
| `footstep` | `{x,y,z, heavy, kind, team}` | owner of the rig (PLAYER / ENEMY) |
| `punch` | `{x,y,z, dx,dy,dz, hit, team}` | PLAYER / ENEMY |
| `slam` | `{x,y,z, radius, team}` | PLAYER / ENEMY |
| `jet` | `{ent, on}` (start/stop) | PLAYER / ENEMY |
| `dash` | `{ent}` | PLAYER |
| `mech:incoming` | `{x,z, team, eta}` | PLAYER / ENEMY |
| `mech:land` | `{x,y,z, team}` | PLAYER / ENEMY |
| `mech:enter` / `mech:eject` / `mech:selfdestruct` | `{ent, x,y,z}` | PLAYER |
| `grab` / `throw` | `{ent, x,y,z}` | PLAYER |
| `weapon:reload` / `weapon:overheat` / `weapon:empty` / `weapon:ready` | `{weapon, shooter}` | COMBAT |
| `lock` | `{state:'locking'|'locked'|'lost'|'fired', target}` | PLAYER |
| `lock:warning` | `{on}` (player is being locked / missile inbound) | COMBAT / ENEMY |
| `score` | `{points, label, x,y,z}` | PLAYER |
| `meter:ready` | `{}` | PLAYER |
| `ace:charging` / `ace:called` | `{ent, progress}` | ENEMY |
| `wave:start` / `wave:clear` | `{n, total, label}` / `{n}` | ENEMY |
| `ui:message` | `{text, sub, kind, dur}` | anyone |
| `shake` | `{amount (0..1), x,y,z?}` | anyone → PLAYER camera |
| `phase`, `game:*`, `player:dead`, `load`, `quality`, `resize`, `pointerlock`, `key` | see section 5 | boot / core |

FX and AUDIO react to these; emitters never call FX/AUDIO for things an event already describes. Use the
direct `G.fx.emit/beam/burst` and `G.audio.play` only for continuous or bespoke effects (jet flames, trails).

## 8. Performance rules

- Target 60 fps at 1080p on a mid-range desktop GPU. CPU budget per frame: destruct ≤ 4 ms, remesh ≤ 4 ms,
  AI ≤ 2 ms, particles ≤ 2 ms, everything else small. No frame may hitch > 30 ms because of your module:
  time-slice big jobs.
- **No per-frame allocation** in hot paths (reuse vectors/arrays, pools, typed arrays). No `new` in `update`.
- Fixed pools for lights, particles, debris, projectiles. Instancing for anything numerous.
- Never add/remove lights at runtime (shader recompiles). Never change material defines at runtime.
- Dispose geometries/materials you replace. `reset()` must leave no orphans in `G.scene`.

## 9. How to build, run and look at your work

```
node build.mjs harness/<agent>.js h-<agent> --dev        # -> dist/h-<agent>.html   (bundle of your harness)
node tools/shot.mjs dist/h-<agent>.html shots/<agent>-01.png --q "auto=1&cam=60,30,60,96,12,96" --wait 6000
node build.mjs src/main.js full-<agent> --dev            # the whole game with every agent's current file
```
- A harness is `import { boot } from '../src/boot.js'; import mine from '../src/<mine>.js'; boot({ use: { <name>: mine }, after(G) {…} })`.
  Modules not listed in `use` run the lead's baseline, so your harness builds no matter what other agents
  are doing. You may also import other agents' real modules once they exist, to check integration; the full
  build can fail while someone else's file is mid-edit — retry later, do not "fix" their file.
- `tools/shot.mjs` options: `--q "<query string>"`, `--wait ms`, `--w/--h`, `--eval "<js>"` (run in page,
  prints the JSON result; `KT` is `G`), `--wait2 ms` (after eval), `--keys "KeyW,Space"` (held), `--click`, `--log`.
  It prints console errors and `window.__KT_STATS` (fps, cpuMs, draw calls, triangles).
- Headless Chromium uses a **software GPU**: frames are slow (expect 2–20 fps) and `dt` is clamped, so game
  time runs slower than wall time. Judge looks and correctness there, not speed. Measure CPU cost with
  `performance.now()` around your own code (print via `--eval`). `KT.debugStep(n, dt)` runs `n` simulation
  updates synchronously without rendering (handy to fast-forward a collapse or a wave before a screenshot).
- Lead query params: `auto=1` (skip title), `cam=x,y,z,tx,ty,tz` (fixed camera), `q=low|med|high`, `seed=N`, `debug`.
  Add your own for look-dev (`?demo=…`); list them in your notes.
- **Look at your screenshots** (Read the PNG) and critique them like an art director / playtester, then iterate.
  At least three rounds. Fix what looks cheap, broken, flat, noisy or unreadable.

## 10. Definition of done (every agent)

1. Your module file(s) replace the placeholder and implement the whole API in section 6 for your module.
2. `node build.mjs src/main.js full-<agent> --dev` builds (given other agents' files are intact) and your
   harness runs with **no console errors**.
3. You have looked at screenshots of your own work and iterated on quality.
4. `notes/<agent>.md` exists: what you built, final API (anything beyond the contract), debug params, tuning
   knobs, known issues, "Requests for lead".
5. Your final message is a short report: files, what works, what does not, anything the lead must wire up.
