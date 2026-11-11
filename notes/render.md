# RENDER notes

Module `G.render` — files `src/render.js`, `src/render_atmo.js`, `src/render_mesher.js`, `src/render_voxmat.js`,
`src/render_sky.js`, `src/render_post.js`. Harnesses `harness/render.js` (baseline city + look-dev props),
`harness/render_city.js` (real city), shared helpers `harness/render_demo.js`.

## What is built

**Meshing** (`render_mesher.js`). Greedy face-culled mesher, one 32³ chunk at a time, from a padded 34³ copy.
Baked per-vertex AO (4 levels); quads merge along runs and into rectangles only where the AO pattern is constant
along the merge direction, so merging never changes the look. Quad diagonal is flipped by AO to avoid the
anisotropy artefact. 8 bytes per vertex (chunk-local voxel coords + material id + AO/face), meshes are scaled by
`VS`. Opaque and translucent (glass, water) faces go to separate streams/meshes. Outside the grid below street
level counts as solid, so the map edge has no hidden cliff faces.
- Cost (node, real Halden Yard, 1.10 M solid voxels → 359 k opaque + 6 k glass quads ≈ 0.73 M triangles):
  **median 0.71 ms, p95 1.40 ms, max 1.77 ms per chunk**; all 432 chunks in ~0.35 s. Meshing allocates nothing;
  the upload copies an exact-size buffer.
- Remesh: `update()` drains `grid.takeDirty` into its own pending set and rebuilds **nearest chunk to the camera
  first** within 3.5 ms per frame (always at least one). The new geometry is built first and swapped into the
  existing mesh in one assignment, so there is never a frame with a hole. Each chunk keeps a hash of its padded
  content: a dirty chunk whose content did not change is skipped, which makes `reset()` after `grid.restore()`
  rebuild only what was actually damaged (it does that synchronously, as part of the restart).

**Voxel shader** (`render_voxmat.js`). Custom `ShaderMaterial` (`lights: true`) using three's sun shadow map and
point-light uniforms. Material id → colour / emissive / rough / metal / "kind" via a 256×2 float lookup texture
built from `materials.js` (ids not in the table render mid-grey; ids 61–63 are covered: `gas_pipe` and
`fuel_tank` shade as glossy painted metal, `barrier` as masonry). Per fragment, from world position: voxel cell
(`floor(pos/0.5)` nudged inside the face), per-voxel value hash, thin anti-aliased edge line + soft cushion (both
fade with distance so nothing shimmers), macro weathering noise quantised per voxel, grime towards the pavement,
streaks on walls. Kinds: asphalt (lifted ×2.1 — the table value is a black hole at dusk — with wet patches,
low roughness and a sun streak), brick, metal, car paint, plant, light, lit window, glass, water, road line.
GGX sun highlight, analytic sky reflection with Fresnel, tiny per-voxel normal tilt on glass/metal/wet asphalt so
reflections break into facets. Glass is a separate premultiplied-alpha pass: dark tinted body, sky reflection,
alpha rising with Fresnel; it does not cast shadows, so sun enters interiors.
- **Emissives**: `EMISSIVE[id] × colour × 1.8`. Lamps/neon have a hot core and a saturated rim inside each voxel
  face and are dimmed to 42 % within ~6 m (full from 38 m), so a lamp at arm's length is a glowing lamp, not a
  blank white cube; bloom carries the halo. Lit windows vary per room (bay × storey): brightness, warmth, a few
  dark, with a vertical falloff.

**Light.** Golden hour: sun 25° up in the WSW (`sunDir ≈ (-0.76, 0.42, 0.49)`), warm key against blue-violet
fill. One `DirectionalLight` with a PCF-soft shadow map: frustum 124 m (high) / 120 (med) / 112 (low) across,
centred ahead of the camera, **texel-snapped** in light space (no swimming), resolution from
`G.quality.shadowRes`: ~6 cm per texel on high. Beyond the map (and blended in at its edge) voxels use a
**far shadow**: a 384×384 height field swept away from the sun on the CPU (~1 ms, refreshed at most every 0.2 s
after remeshes), so distant towers still throw their long shadows in overhead views. `HemisphereLight` +
`scene.environment` (PMREM of the sky without the sun disc) light other agents' standard materials; metals get
real golden-hour reflections.

**Fog** (`render_atmo.js`). Height fog integrated analytically along the view ray, coloured by direction: cool
away from the sun, peach towards it, extra glow near the sun. `patchThreeFog()` replaces three's four fog
chunks, so **every** material with `fog: true` in the scene gets the same fog. `scene.fog` is a `FogExp2` whose
density is the street-level optical depth per metre (0.0026).

**Sky and beyond** (`render_sky.js`). Dome shader: gradient, sun disc (HDR, blooms), sun glow, cirrus streaks and
eroded cumulus lit from the sun side, slow drift. Outside the 192 m grid: a ground plane (same asphalt shading)
and ~600 blocks of procedural buildings in one draw call (voxel-quantised window grids, a share of lit windows,
towers further out for a skyline), all in the same fog.

**Post** (`render_post.js`). Scene → half-float target (MSAA) → bloom (soft-knee threshold 1.25, firefly-safe
prefilter, 4–6 level dual-filter pyramid) → composite: sun veil when the sun is in frame and not behind
masonry, exposure, ACES fit, split-tone grade, contrast, lifted toe, vignette, grain/dither → FXAA on low.

## API beyond the contract
- `flash(x,y,z, colorHex=0xffc890, intensity=2, radius=14, duration=0.2)`: pool of 6 point lights, quadratic
  fade. `intensity` ≈ albedo multiplier at a quarter of the radius (the sun is ≈ 1.9). If the pool is full the
  weakest light is replaced, unless the new one is weaker.
- `sunColor / skyColor / ambient / groundColor`: albedo multipliers, i.e. `lit = albedo * (sunColor * NdotL *
  shadow + ambient)`. `fogColor`: an average haze colour for things that cannot use the fog chunks.
- `stats { chunks, quads, pending, remeshMs, lastChunkMs, maxChunkMs, initMs, rebuilt }`.
- `post.params` (composite uniforms: `uExposure uBloom uVignette uSaturation uContrast uTint uFlash`):
  e.g. `G.render.post.params.uFlash.value = 0.3` for a white-out, `uTint` for a damage tint.
- `sun`, `hemi` (the three lights), `uniforms` (shared voxel uniforms).

## Quality tiers (`setQuality`)
| | high | med | low |
|---|---|---|---|
| scene target | full res, MSAA ×4 | full res, MSAA ×2 | **80 % res**, no MSAA, FXAA |
| shadow map | 2048, 124 m | 1536, 120 m | 1024, 112 m |
| bloom | 6 levels from ½ res | 5 levels from ½ res | 4 levels from ¼ res |
| voxel shader | full | full | `KT_LOW`: one noise octave, no streak/wet noise, no facet tilt, flat sky reflection |
| clouds | 5 octaves + erosion | 5 + erosion | 3 octaves, no erosion |
Relative cost, one frame of the plaza chase view at 1280×720 on the headless software rasteriser (fill-rate
bound, so it is a fair proxy for fragment cost, not for real fps): **low 2.4 s, med 4.2 s, high 4.7 s** — low is
about half of high. `setQuality` recompiles the voxel and sky shaders once (it is a settings action).

## Checked
- Real city, street level / rig chase height / overhead, high and low tier: `shots/render-r5-*`, `render-r6-rig`,
  `render-r7-tier-low`, `render-r2-top`. Material wall incl. ids 61–63: `render-r8-swatch`.
- Tower collapse in the full build (real DESTRUCT, 20 charges under Halden Mutual): `render-r6-collapse1..3`,
  no holes; 4–22 chunks pending while it falls, drained within the budget; ~640 chunk rebuilds in total.
- `setQuality` low → med → high at runtime and `grid.restore()` + `reset()`: no console errors; reset after a
  9 m crater rebuilt 4 chunks.
- Rig-scale sun shadows were only seen on stand-in boxes (`render-r3-props`); the Warden shot had the rig in a
  shaded street. Worth one look on a real GPU.

## Debug / look-dev params
`exposure=<f>`, `bloom=<f>`, `nofar` (disable far shadows). Harness: `swatch=1` (wall of every material, cars,
lamp, neon, tree — baseline city), `props=1&px=&pz=` (standard-material stand-ins: rig, Vanta block, matte
cubes, chrome ball), `flash=1&flashpos=x,y,z`, `boom=x,y,z,r`.

## Tuning knobs
`ATMO` in `render_atmo.js` (sun direction/colour, sky fill, haze colours, fog density/height), `EMISSIVE_SCALE`
and the `varAmt / lineAmt` table in `render_voxmat.js`, `SHADOW_SPAN`, `FLASH_N`, `REMESH_BUDGET_MS` in
`render.js`, composite uniform defaults in `render_post.js`.

## For other agents
- Scene is linear HDR. Emissive ≈ 2–6 blooms with colour; > 10 goes white. Plain lit surfaces stay below the
  bloom threshold.
- Standard/Lambert/Basic/Points/Sprite materials need nothing special. Custom `ShaderMaterial`s that want fog
  must include all four fog chunks (`fog_pars_vertex`, `fog_vertex` after `mvPosition` exists,
  `fog_pars_fragment`, `fog_fragment`) and set `fog: true`; a shader that declares `vFogDepth` by hand without
  the chunks will not get `vKtFogV`.
- Do not add lights at runtime; use `flash`.

## Known issues
- Greedy quads create T-junctions; an occasional single-pixel sparkle on large flat surfaces is possible.
- The far shadow is a height field: overhangs shadow everything beneath them, and it only affects voxels (other
  meshes are simply unshadowed beyond the shadow map, ~60 m from the camera).
- Glass faces inside one chunk are not depth-sorted (fine for the pale tints used).
- The outskirts do not receive real shadows (faked) and are not destructible.
- Emissive voxels do not light their surroundings (bloom only).
- Frame rate was only ever observed on a software rasteriser; GPU cost per tier is estimated, not measured.

## Requests for lead
- None blocking. `tools/shot.mjs` has a 30 s screenshot timeout, which the software GL exceeds on the first frame
  at `q=high` when the machine is busy.
