# FX — particles and transient effects (`G.fx`)

Files: `src/fx.js` (system, recipes, bus handlers, API), `src/fx_shaders.js` (GLSL).
Harnesses: `harness/fx.js` (baseline world + stand-in golden-hour lights + a small HDR bloom/ACES post),
`harness/fx_world.js` (the same with the REAL destruct: debris, collapse, fire, gas), `harness/fx_real.js`
(real render + city + destruct), shared demo driver `harness/fx_demo.js`, look-dev helpers `harness/fx_lookdev.js`.

## What it is

- **Three GPU pools, two draw calls for particles + one for beams.** `LIT` (smoke, dust, fireballs) and `ADD`
  (sparks, embers, flame licks, glows, rings, glints) share one `ShaderMaterial`; `BEAM` is a pool of stretched
  quads. Capacity: `G.quality.particlesMax` split 50/50 between LIT and ADD (rebuilt on the `quality` event),
  384 beams.
- **Simulated in the vertex shader.** A spawn writes 28 floats (birth, position, velocity, life, size curve,
  spin, drag, gravity, turbulence, albedo, emissive, "hot" fraction, shape, stretch, floor) into a ring buffer;
  the shader integrates drag / gravity / wind / turbulence analytically from `uTime = G.time`. The CPU never
  touches a particle again. One `bufferSubData` per pool per frame covering only the range written (two ranges on
  wrap). No per-frame allocation; `update` is ~0.03–0.1 ms plus spawning.
- **One blend mode: premultiplied** (`ONE, ONE_MINUS_SRC_ALPHA`). Emissive adds, lit smoke occludes, so a single
  fireball particle starts incandescent and cools into rolling black smoke (`hot` = share of its life it glows).
- **Looks are procedural** (value-noise fbm in the fragment shader, no textures): noise-eroded cauliflower puffs
  whose erosion grows with age; a fake volume normal (sphere + noise bump) lit by `G.render.sunDir/sunColor`
  (wrapped diffuse + back-light through thin edges), `skyColor` from above, ground bounce from below, and by the
  four strongest recent flashes (explosions light the smoke around them). Smoke is never self-luminous. Fire uses a
  temperature ramp (deep red → orange → white-hot) and is HDR (peaks ~5–15) so RENDER's bloom catches it.
- **Soft ground contact.** No depth texture is available, so puffs that are born near the ground carry the ground
  height and fade the part of the billboard below it. Puffs also fade when the camera is inside them.
- **Fog.** Own cheap fog (absorbs emissive, fades lit colour to `G.render.fogColor`), matched to the scene fog:
  detects RENDER's patched height fog (`ktFogAmount`) and uses a linear optical depth, else three's exp² / linear.
- **Persistent emitters** (fixed pool of 56, CPU): smoke columns, small fires, re-entry streak, collapse dust,
  street haze, eject trail, secondary explosions, gas torches, burning pools, planted charge, arcing stumps.
- **Budgets.** Every recipe is scaled by distance to the camera (`lod`: 1 inside 45 m → 0.22 at 240 m) and by
  pool fill (`load`: spawn counts drop once a pool is > 55 % alive). Event floods go through token buckets
  (`impact`, `voxels:destroyed`, `debris:impact`, `footstep`, `collapse`, direct `emit`, muzzles). Nearby collapse
  events merge into one emitter. The ring buffer is the hard cap: the oldest particles are overwritten.
- `reset()` clears pools, emitters, flash mirrors, pending events and budgets. Nothing else is added to the scene.

## API (contract + additions)

- `emit(kind, x,y,z, dx,dy,dz, amount, team?)`
  - Continuous, **call once per frame per source**, `amount` = intensity (emission is `G.dt`-scaled):
    `'jet'` (d = exhaust direction; amount 1 = rig nozzle, 0.3 = jetpack, > 1 grows slowly up to 2.4×; `team` 1 =
    orange Vanta jets; kicks dust off the ground when pointing down), `'smoke'`, `'steam'`, `'fire'`, `'ember'`,
    `'trail_rocket'`, `'trail_missile'`, `'trail_shell'` (d = projectile velocity in m/s; the gap travelled this
    frame is filled), `'torch'` (gas jet along d), `'pool'` (burning pool, amount = radius in metres).
  - Impulses, `amount` = size of a one-off puff: `'dust'`, `'debris_dust'`, `'spark'`, `'blood'` (= spark, no gore).
- `beam(x0,y0,z0, x1,y1,z1, kind)`: `'tracer'` (pale cyan-white), `'tracer_enemy'` (orange-red), `'pulse'`,
  `'pulse_enemy'` (bolt front + afterglow), `'lock'` (dashed amber, lasts 0.13 s: refresh at ≥ 8 Hz), `'lance'`
  (hot core + halo flash for one tick, plus molten sparks at the end point).
- `burst(kind, x,y,z, scale, opts)`: contract kinds `'explosion' 'explosion_big' 'airburst' 'muzzle' 'muzzle_big'
  'pulse_hit' 'dustcloud' 'shockwave' 'sparks' 'glass' 'landing' 'selfdestruct' 'reentry'`, plus `'slam' 'eject'
  'collapse' 'fire' 'smokecolumn' 'gasjet' 'firepool' 'shield_hit' 'lance_hit' 'split' 'limb' 'beacon' 'bossphase'
  'victory'`. `opts`: `team`, `dx,dy,dz`, `nx,ny,nz`, `color:[r,g,b]`, `mat`, `air`, `pulse`, `eta`, `dur`, `ent`,
  `count`, `alpha`, `mass`, `height`, `limb`, `phase`.
- `stats { particles, lit, add, beams, emitters, cap, cpuMs (with ?debug) }`, `tune` (see below).

## Bus events handled

`explosion` (by `kind`: rocket / shell / grenade scale with radius; `pulse` → pulse hit in the owner's faction
colour; `slam` → slam ring; `mech` → deferred one frame and resolved against `mech:land` / `mech:selfdestruct` so
neither is doubled), `voxels:destroyed` (dust in the material's own colour, glass sprinkle, electric pop for neon
and lamps, metal sparks), `collapse` (dust shed by the falling mass, then a surge that rolls out along the open
street directions and hangs 7–13 s), `building:levelled` (haze over the footprint), `debris:impact`, `shot`,
`tracer`, `impact` (by material class and by entity kind), `footstep`, `punch`, `slam`, `jet`, `dash`,
`mech:incoming` (re-entry streak that follows the real falling rig entity if there is one, growing ground glow and
retro wash in the last second), `mech:land`, `mech:eject`, `mech:selfdestruct`, `mech:enter`, `grab`, `throw`,
`weapon:overheat` (steam), `ent:death` (soldier / pilot / drone / tank / gunship / emech / turret), `quality`.
Damaged rigs, tanks and gunships (< 40 % hp) trail smoke, then sparks, then flame, read from `G.ents`.

Phase B: `G.destruct.fires` (flames, smoke, embers, a flickering light; a fixed flame budget shared by all cells),
`G.destruct.jets` (a roaring torch per venting main, drawn every frame) and `gas:jet`, `fire:start`, `fire:out`,
`shield:hit` (ripples + deflected sparks in the wielder's colour), `shield {broken}` (shatter), `shot` for
`lance` / `siege` / `mortar` / `mortar_b` (bomblet split) / `autocannon` / `swarm`, `weapon:recoil` (muzzle-brake
blast and street dust), `impact` for `lance` (molten slag), `grapple`, `limb:torn` (shower, burning hydraulic
spray, an arcing stump that follows the rig for 3 s), `finisher` (start / slam), `charge:planted` (accelerating red
blink that follows the target until the bang), `brace`, `mech:hijack`.
Phase C: `objective:done` (beacon at the objective, or on the player), `perk:taken` (amber beacon on the player),
`boss:spawn {ent}` and `boss:phase {ent, phase}` (reactor vent; phase 3 keeps arcing), `game:won` / `mission:won`
(flares for 6 s).

## Debug / look-dev

Harness query params: `demo=<name[,name]>`, `t=<seconds to fast-forward before the frame is held>`,
`hold=<time scale afterwards, default 0.02>`, `at=x,z` (origin, default 100,100), `nopost=1`, `ui=1`, `eta`, `team`.
Demos: `explosion big airburst wall salvo pulse bullets muzzle trails jet steps drop slam punch eject selfdestruct
collapse glass deaths fires fire shield lance siege mortar brawl phasec stress`, and with `fx_world`:
`rfire rgas rtank` (real DESTRUCT fire, gas main, fuel tank).
Example: `node build.mjs harness/fx.js h-fx --dev` then open
`dist/h-fx.html?auto=1&q=high&demo=salvo&t=1.1&cam=104,5.5,113,100,4.5,100`.

## Tuning knobs (`G.fx.tune`)

`wind [x,y,z]` (m/s drift of smoke and dust), `fireHDR` 0.8, `lightScale` (multiplies sun/sky on smoke; 1 matches RENDER's
"albedo multiplier" colours), `fireHDR` (all emissive brightness), `smokeDensity` (all lit opacity), `maxFires`,
`maxColumns`, `lodNear / lodFar / lodMin`. Budgets are the `BK` table in `fx.js`; pool split is in `_build`.

## Verified

- Cap: `demo=stress` (100 rockets, 100 collapses, 5 self-destructs in 5 s) peaks at 6466 / 12000 alive on high and
  2348 / 3500 on low; `update` itself is 0.03–0.1 ms, spawning included in the event that causes it.
- Real DESTRUCT fire (`rfire`), gas main chain (`rgas`) and fuel tank (`rtank`) draw from `G.destruct.fires / jets`.
- Real RENDER + CITY + DESTRUCT: one salvo scene (`shots/fx-r01.png`, low tier) and a short run of the full build
  with no console errors. `tune.fireHDR` was lowered to 0.8 after that shot because RENDER's bloom is stronger
  than the look-dev one. Everything else was judged on the look-dev harness only.
- Shots: `fx-t01..t09` explosion / big / salvo / pulse / drop / landing / collapse / self-destruct (0.5 s, 3 s),
  `fx-f01..f04` fire, gas, tank, fake fire cells, `fx-b01..b06` shield, lance, siege, mortar + swarm, limb torn,
  finisher, `fx-c01` Phase C, `fx-s02` stress, `fx-r01` real renderer. Some were taken one tuning pass before the
  final values (`fx-f03`, `fx-b03`, `fx-b04`, `fx-b06`, `fx-t05`, `fx-t08`): flames, shells, glows and missile
  trails were toned down / thickened afterwards and not re-shot.

## Known issues

- No soft particles against walls (needs scene depth): smoke meets building faces with a hard edge. The ground
  is handled, walls are not.
- Particles are not depth-sorted. With premultiplied blending this is rarely visible, but a fresh fireball can
  draw over older smoke that is nearer the camera.
- Particles do not collide: sparks clamp to the ground height sampled at spawn, smoke passes through buildings.
- Smoke does not receive the sun's shadow map (a column in a shaded street is lit as if in the open).
- The re-entry streak assumes a vertical fall (it follows the real entity when it finds one within 3 m of the
  announced spot).
- Looks were iterated on the look-dev harness (baseline world with RENDER's sun / sky values and a simple
  bloom + ACES); see the report for what was and was not checked under the real renderer.

## Requests for lead / other agents

- RENDER: a scene depth texture uniform (e.g. `G.render.depthTexture` + near/far) would allow soft particles.
- COMBAT: a distinct trail kind or `amount` for swarm micro-missiles and the siege shell would let them differ
  from ordinary missiles / tank shells (today: `trail_missile` amount 1, `trail_shell` amount 1.2).
- Anyone calling `emit('jet', …)`: pass `team` as the 9th argument for Vanta-orange jets.
