# CITY — Halden Yard generator

Files: `src/city.js` (layout, roads, block dispatch, plaza, park, street furniture, metadata),
`src/city_build.js` (frame/mass builder, facade styles, building recipes), `src/city_props.js` (vehicles,
trees, lamps, signs…), `src/city_util.js` (voxel writers with per-building bounds, facade helpers, 3×5 font).
Harness: `harness/city.js` + `harness/city_view.js` (cheap greedy-meshed look-dev renderer). Shots: `shots/city-final-*.png`.

## What is built

- **Layout** (voxels): 20-wide ring road (3-voxel rim walk + 8.5 m roadway), 5×5 parcels of uneven size
  (x: 44/58/52/58/44, z: 48/52/56/52/48) separated by 22-voxel (11 m) roadways. Each parcel carries a 5-voxel
  sidewalk, so facades are **16 m apart** on interior streets and 12.5 m on the ring. Two 4.5 m alleys per
  split apartment block (pilots only). Centre parcel is the plaza (flush paving emblem, kept clear for a rig drop).
- **Deterministic from the seed**: the block template is fixed (so it is always a designed downtown) and the seed
  picks one of four mirrored variants plus heights, materials, names, lit windows, cars, trees, roof plant.
- **41 entries in `buildings`** (36 real buildings + crane, gas canopy, tank farm, monument, bandstand):
  7 towers (stepped glass slab on pilotis with service core and neon crown; glass slab with mast and sign;
  three-tier stone deco tower with uplit setbacks and spire; podium + ribbon tower with roof garden; podium +
  tower with helipad; two-volume glass twin with rooftop billboard; 8-storey brick office with pilasters),
  a mansard hotel with blade sign and marquee, a teal-tile mid-rise, 9 brick apartment blocks (balcony stacks,
  fire escapes, cornices, water tanks), 15 shops (awnings, lit fronts, neon rooftop/false-front signs), open-deck
  parking structure (scissor ramps, parked cars on every deck, stair tower), sawtooth-roof warehouse (roll-up
  doors, crates, barrels, container yard), construction site (steel skeleton, partial decks, rebar, debris net,
  hoarding, tower crane with hanging load), gas station (canopy, pumps and tanks with `barrel_red` cores, loose
  barrels, kiosk, pylon), park (fountain, trees, bandstand).
- **Structure**: every building is 2×2 columns on a regular bay (5–11 voxels, fitted per building) + 1-voxel
  `floor` slabs every 7 voxels, built by `mass()`; the facade is a "style" function hung on the outer ring.
  Curtain-wall towers stand on columns only (glass/metal skin is non-`struct`); masonry buildings use
  load-bearing `struct` walls. Interiors: drywall partitions with door gaps, furniture, ceiling lights.
  Harness check (`KT.cityCheck().ko`): deleting the ground-storey struct voxels of the tallest office leaves
  **0 of ~24 000** struct voxels above with a struct path to the ground. Nothing floats: 0 voxels are
  disconnected from the ground (6-connected), and only ~600 struct voxels (sign legs, tank shells) hang from
  non-struct parts.
- **Street level**: lane lines, crosswalks, stop lines, kerb-lane dashes, manholes/patches, lamps, traffic lights
  (2 per junction, on the sidewalk corners so junction boxes stay clear), street trees, bins, hydrants, bollards,
  benches, bus + bus shelter, ~45 parked cars / vans / taxis (each with a buried `barrel_red`), 3 pole billboards.
- **Budget** (seed 1337): **1.09 M solid voxels** (ground 0.59 M + city 0.50 M) of the 3.2 M allowed;
  generation 110–300 ms on an idle core (≤ 0.9 s measured with the machine at load 20+).

## API (contract 6.1) and extras

`buildings[] {id, kind, name, i0,j0,k0,i1,j1,k1, voxels, alive}` — kinds: `office hotel apartment shop parking
warehouse construction crane canopy tanks monument pavilion`. `voxels` = SOLID voxels at j ≥ 4 in columns
where `buildingAt === id+1`. Overhangs (awnings, balconies, crane jib) are inside the bounds and in `buildingAt`
but `lot` stays sidewalk/road there. Street props, cars, trees, pole billboards, container yard and the fuel
pylon are **not** buildings (`buildingAt` 0).
`lot`, `buildingAt`, `roadNodes` (36 grid nodes on the ring + street centre lines, plus the plaza centre and
the four mid-street nodes around it = 41 nodes / 68 links), `spawns.player` (on the avenue beside the plaza,
far end, looking down its length; parked cars are kept away), `spawns.edge` (20: both ends of all 8 streets on
the ring + 4 corners), `spawns.air` (12, y = 44, verified clear), `spawns.mechDrops` (33: 16 junctions, plaza
centre, 16 ring/street mouths; each verified at generation as a clear 10×10 m box up to 9 m).

Beyond the contract: `city.blocks[] {bx,bz,kind,x0,z0,x1,z1}` (metres), `city.streets {x:[6], z:[6]}` centre
lines in metres (index 0 and 5 are the ring), `city.plaza {x,z,r}`, `city.mirror {x,z}`, `city.genMs`,
`city.solid`, `city.generate(seed)` (regenerates in place; also re-snapshots the grid). `reset()` only sets
`alive = true` (boot restores the grid).

## Debug params

- `seed=N` (lead) — layout variant + details. `mirror=0..3` — force the mirrored variant (bit 0 = x, bit 1 = z).
- Harness only: `base=1` use the lead's baseline renderer instead of `city_view`; `live=1` keep rendering every
  frame (the harness view draws 3 frames and idles so screenshots work on a loaded machine).
- `KT.cityCheck()` in the harness returns counts, budget, connectivity, struct-support and spawn sanity.

## Tuning knobs

`city.js`: `RING, RW, SW, PWX, PWZ` (street grid), `TEMPLATE` (block kinds), per-kind options in `block()`
(floors, materials, lit fraction, signs), parked-car density (`rng() > 0.42`), tree/prop odds in `furniture()`.
`city_build.js`: `ST.*` facade styles, `boost()` (per-floor lit multiplier), `roofKit()` odds, `fitout()` density.

## Known issues / notes

- Sidewalks, plaza and building floors are **flush with the road** (y = 2.0); curbs are a material line, not a
  step, so movers never snag. Park wall, fountain rim and planters are 0.5 m steps.
- Rooftop/blade signs read mirrored from behind (letters are single-layer voxels in the board).
- Top storey of towers reaches j = 87; spires/antennas/crane reach j = 95 (grid top is 96).
- Parking decks have 3 m headroom: pilots and soldiers only. The rig can walk every street, the ring and the plaza.
- Water (`water`, non-solid) fills the park fountain and the plaza pool at ground level; bodies sink 0.5 m there.
- The full game build (`dist/full-city.html`) builds and boots with this city (phase `playing`, 41 buildings);
  I could not get a full-game screenshot because the shared machine was saturated (software GL timeouts).

## Requests for lead

- None blocking. FYI for DESTRUCT/ENEMY: small props have `buildingAt = 0`; use `city.streets` / `roadNodes`
  for routing and `spawns.mechDrops` for rig drops. RENDER: `window_lit`, neon and `light_*` voxels are used
  generously (windows ~20–40 % lit, street lamps, signs) so they should bloom, not blow out.

## Round 2 (CONTRACT-B B6, CONTRACT-C C2)

- **Gas mains** (`utilities()` in `city.js`): `gas_pipe` trunks at j = 2 (one voxel under the asphalt) the full
  length of two avenues and two cross streets, lane-centre; `pipe`+`hazard` valve covers on the surface every 13 m;
  up to 16 service branches run under the sidewalk to the nearest facade and rise 3 m up the wall (skipped where
  something already stands). `G.city.gasMains` = array of polylines, each an array of `{x,y,z}` in metres
  (4 trunks first, then branches: trunk tap → foot of riser → top of riser). 17–20 polylines depending on seed.
- **Tankers**: 4 fuel tankers (16×5×6 voxels, hollow `fuel_tank` drum = one cluster, red cab) parked mid-block in
  kerb lanes, never near the player spawn. `G.city.tankers[] = { x, z, y, yaw, length, width, i0,k0,i1,k1 }`.
- **Gas station**: two `fuel_tank` storage tanks buried at j = 1..2 under the forecourt, `hazard` filler caps on the surface.
- **Infantry cover**: `barrier` rows (1 m, 3-long segments with gaps, hazard cap), sandbag nests (1–1.5 m, U-shaped)
  and crate cover in empty kerb-lane slots (same footprint rule as parked cars, so driving lanes and junctions
  stay clear) and on the plaza rim.
- **Plaza centre**: nothing stands above the paving within 7 m of `city.plaza` (14 m circle, enforced by a final
  clearing pass and checked in the harness: `plazaClear`). Lamps moved to the plaza edge, the pool is now flush.
  The monument column stays on the north edge, 8.5 m from the centre.
- **Mission hooks**: `G.city.sites[] = { x, z, kind:'intersection'|'plaza', clear }` — 17 spots, each verified as a
  clear 12 m square up to 12 m high; ordered spread-first with those > 45 m from the player spawn first (14–15 of
  them), the plaza last. `G.city.citadel` = id of the tallest office/hotel on the block north of the plaza
  (streets on all four sides); it is the stepped glass tower or the hotel depending on the mirror variant.
- Re-verified on 4 seed/mirror variants: 0 floating voxels, 33 drop zones, all spawns/nodes open, knock-out test
  still 0 supported, 1.08–1.10 M solid voxels, generation 75–170 ms. Full build compiles.
- Shots: `shots/city-b-*.png`.
