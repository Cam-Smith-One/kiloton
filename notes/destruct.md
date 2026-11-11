# DESTRUCT notes

All runtime grid changes, structural collapse, rigid debris, fire and gas.

## Files
| File | Contents |
|---|---|
| `src/destruct.js` | Module + public API (`explode impact punch carveBox burst grabChunk releaseChunk dropChunk ignite burnPool update reset`), chain-blast queue processing, levelled-building check |
| `src/destruct_base.js` | Fast grid writes with own dirty-chunk flags (normal + "held" set), building loss accounting, explosive chain queue, material tables (`EXPL`, `FLAM`, `SCORCH`, linear colours) |
| `src/destruct_struct.js` | Time-sliced flood fill per building / per prop box, overload rule, staged collapse preparation and release |
| `src/destruct_bodies.js` | Debris cubes ("bits", instanced), rigid voxel bodies (own merged mesh), grid collision, crush / split / shatter, rubble deposit with angle of repose, entity damage |
| `src/destruct_fire.js` | Burning cells, spread / char / burn-through, fire damage, gas-main jets and pipe-run chaining, fuel-tank blasts and burning pools |
| `harness/destruct.js` | Browser harness with scripted demos |
| `harness/destruct_perf.js` | Node (no browser) correctness + CPU test: `node harness/destruct_perf.js <tower\|corner\|mid\|siege\|chip> <seconds> <low\|med\|high>`, env `CITY=1` (real city), `B=<building index>`, `TRACE=1`, `SPIKES=<ms>` |
| `harness/destruct_net.js` | Node test of the co-op wire layer: tap / applyRemote determinism, chunk hash / RLE round trip / heal |
| `harness/destruct_seq.js` | Screenshot sequence in one page load: `node harness/destruct_seq.js "<query>" shots/destruct-x 1.5,2.4,3.4` |

## How it works
- **Carving.** `explode` uses the baseline rule (`STRENGTH < power * (1.15 - d)`) with a ragged edge, scorches the rim to `charred`, throws up to ~90 removed voxels as cubes, shoves loose debris, ignites flammables in the rim. `punch` turns every carved voxel into a fast cube along `d`. Bedrock and strength 255 never break.
- **Structure.** Every removal queues a check for the buildings whose footprint the removal box touches (debounced 50 ms, one job per building) and/or a prop job for open ground. The check floods from the layer on bedrock through the building's bounds (+4 voxels, other buildings' columns excluded), then scans for unvisited solids = detached clusters. Free-standing things at the edge of the analysed box get the benefit of the doubt (anchored if they touch something outside).
- **Overload.** At init each building gets per-storey (7 voxels), per-bay (16×16 voxels) counts of load-bearing (`STRUCT`) voxels at the weakest layer, plus the mass above. At runtime the same counts come out of the scan for free. A storey crushes when its section falls below 45 % of the original (scaled by how much mass is still above); a bay fails below 25 % and comes down with a crack plane up its sides if it has a failed neighbour or is a corner. Relative thresholds, so no pristine building can ever fail, whatever CITY builds.
- **Staged collapse.** A big cluster is cut into storey modules (16 voxel tiles × 7 voxel bands, staggered like brickwork, coarser when the body cap needs it), meshed over a few frames while still standing, then released in one frame: voxels leave the grid, the crushed storey (held dirty flags) vanishes in the same frame, the modules wait frozen until the renderer has remeshed the affected chunks (max 0.3 s), then fall together with a slow topple towards the damaged side and a little spin each so cracks open. Each module crushes when it lands (closing speed > 1.5 m/s): heap of rubble with angle of repose, sprayed cubes, dust, a few tumbling chunks; top-storey modules keep 70 % as slabs so the roof lies broken on the pile. No body-body collision is needed: lower modules are already grid rubble when the next ones arrive.
- **Rigid bodies.** Position, velocity, quaternion, angular velocity, diagonal inertia from the voxel distribution; ≤ 44 sample points (extreme corners + stride) tested against the grid; sequential impulses with restitution and Coulomb friction, positional push-out, ≤ 4 substeps. Big bodies crush, medium ones split across their long axis on hard hits, small ones bounce, roll, rest and are written back intact. Everything deposited drops down its column until supported, so nothing is left floating.
- **Damage.** Cubes: `bitDamage * mass * relative speed`, once per cube, never the owner. Bodies: `bodyDamage * sqrt(mass) * relative speed`, capped per hit, one hit per entity per 0.3 s, owner takes 35 %. All `type:'debris'`, `src` = whoever caused the destruction. Measured under a 10-storey collapse: soldier (100 hp) dead, rig (1800 hp) loses 700–1300.
- **Chains.** Any `MAT[id].explosive` voxel that breaks queues a blast after 0.09–0.25 s (deduplicated in space; barrels cap the chain depth at 7). `barrel_red`: `G.boom` r 2.8. `gas_pipe`: blast r 2.3, a 6 s venting jet (flame cells + small booms), and the break travels along the pipe run 12 voxels at a time, 0.32 s per hop, both directions and up risers, for at most 10 hops (~60 m) each way so one hit erupts a street, not the whole network. `fuel_tank`: the whole connected tank is removed and goes up as one boom (r 3–7.5 by size) plus a burning pool.
- **Fire.** ≤ 320 burning cells. A cell burns 1.3–8 s depending on material, tries twice per ~0.4 s to light a neighbour (radiating across gaps of up to 3 voxels, weaker with distance and with hop count, dies out 36 hops from ignition), then removes its voxel (foliage, awnings, furniture, crates), or chars / removes it (wood, trunks: 55 % `charred`), or breaks it if explosive (fuse). Removed voxels queue structure checks, so a burnt timber floor drops what stood on it. Entities in flames take `FTUNE.damage` hp/s (`type:'fire'`, not airborne ones). A steel gas main does not catch fire; it has to be broken.

## API beyond the contract
- `stats`: `{ debris, bodies, pending, fires, ms (30-frame average of update), msMax, checks, collapses, deposited, prof[4] }`.
- `impact(x,y,z,dx,dy,dz,power,radius,opts?)`: `opts.owner` credits the damage, `opts.fire:true` ignites what it touches (**the arc lance should pass this**, or call `ignite`).
- `ignite(x,y,z,radius=1,intensity=1,owner=null) → n`, `burnPool(x,y,z,radius=3,dur=8,owner=null) → n`.
- `fires { count, x, y, z, heat }` (Float32Array, compact, valid for `0..count-1`), `jets { count, x, y, z, t }` (venting gas mains, `t` = seconds left).
- Events: `'fire:start' {x,y,z}` (≥ 0.35 s apart), `'fire:out' {x,y,z}` when the last cell dies, `'gas:jet' {x,y,z,dur}` (not in the contract; FX/AUDIO can use it for the torch and roar).
- `dropChunk(chunk)` releases a held chunk without throwing. `chunk.voxels` is the voxel count.
- `G.destruct.TUNE / STUNE / FTUNE`: live tuning objects (below).
- Sets `building.alive = false` when a building is levelled (restored in `reset`).

## Wire contract (co-op, CONTRACT-D)
Everything here costs one `if (!this.tap)` per call offline.

**`G.destruct.tap`** — `null` or `function (op, args, seed)`. Called after a mutating call made locally from outside the module. `args` is a flat JSON array of numbers; entities are sent as `e.netId ?? e.id` (0 = none) and resolved on the other side through `G.net.entById(id)` if NET provides it, else by scanning `G.ents.list` for the same `netId`/`id`. `seed` is a non-zero uint32.

| op | args | tapped when |
|---|---|---|
| `explode` | `[x,y,z,radius,power,ownerId]` | always (covers every `G.boom`) |
| `impact` | `[x,y,z,dx,dy,dz,power,radius,ownerId,fire]` | a voxel broke, or `fire` |
| `punch` | `[x,y,z,dx,dy,dz,radius,depth,power,ownerId]` | a voxel broke |
| `carveBox` | `[x0,y0,z0,x1,y1,z1,power,toDebris]` | a voxel broke |
| `ignite` | `[x,y,z,radius,intensity,ownerId]` | a cell caught fire |
| `burnPool` | `[x,y,z,radius,dur,ownerId]` | a cell caught fire |
| `grab` | `[x,y,z,r]` — `seed` doubles as the chunk key | a chunk came out |
| `release` | `[grabKey,px,py,pz,vx,vy,vz,qx,qy,qz,qw,ownerId]` | always (`dropChunk` goes through it) |
| `burn` | `[i,j,k,mat, i,j,k,mat, …]` voxel coords, `mat` 0 = removed, else `charred` | host only: once per frame in which fire consumed or charred voxels (1–3 voxels typically) |

**Not tapped**, because every peer derives them itself from the tapped op: structure checks, overload crushes, collapses, debris impacts and their carving, fire spread and burn-through, barrel / gas / fuel-tank chain blasts, jet booms, thrown-chunk impact blasts. These reach `G.boom` with `_chain: true`; NET must not forward `'explosion'` events as destruction. `burst` is cosmetic (no grid change) and is not tapped. Mission `grid.set` batches are not DESTRUCT calls and are not covered.

**`G.destruct.applyRemote(op, args, seed)`** — runs the operation without tapping. Remote `grab` removes the voxels and parks an invisible chunk under its key until the matching `release` (at most 16 parked; the oldest is dropped in place).

**Randomness.** A tapped op reseeds the module PRNG from `seed` on both sides (locally before it runs, remotely in `applyRemote`), so debris selection, velocities and whatever the stream feeds afterwards agree. A collapse reseeds from the cluster it releases and a crushed piece from its own voxels, so those do not depend on what happened in between. While `G.net.online` (or `G.destruct.deterministic = true`) time slicing counts work units instead of wall-clock milliseconds and the release beat no longer waits for the renderer.

**Fire is host-authoritative.** While `G.net.online && !G.net.isHost` a peer never creates, spreads, burns out or drops cells on its own and starts no jets: its `fires` / `jets` arrays change only in `applyFires`. Between snapshots it just counts life down for display and applies fire damage to the entities it owns.
- A client's own `ignite` / `burnPool` calls (and `impact` with `fire`) are always tapped, even though they light nothing locally; the host's `applyRemote` turns them into cells. Explosion-rim ignition happens on the host when it runs or replays the `explode`.
- Voxels the fire consumes or chars reach clients as the `burn` op, not through chunk healing. A burnt explosive voxel is removed by `burn` on the client too, so the chain blast that follows is derived on every peer as usual.
- Jet booms: online the host issues them as ordinary `G.boom` calls, so they are tapped as `explode` and replayed (clients do not tick jets).
- `serializeFires() → Uint8Array`: a view into a **reused buffer** (send or copy it before the next call). Little endian: `u16 cells, u8 jets, u8 0`; per cell 7 bytes `u16 i, u8 j | kind<<7, u16 k, u8 heat×255, u8 life×10` (voxel coords; kind 1 = flame on air / pool; life in 0.1 s, max 25.5); per jet 7 bytes `u16 x×64, u16 y×64, u16 z×64, u8 t×10`. 4 + 7·320 + 7·10 = 2314 bytes at the caps.
- `applyFires(bytes)`: makes cells and jets match the snapshot exactly (refresh, remove, create). New cells emit `'fire:start'` (rate-limited as offline), the last one going emits `'fire:out'`, new jets emit `'gas:jet'`. Array order may differ from the host's; the sets are equal. Call it on clients only.
- Fire has its own random stream, so the host simulating it does not disturb the stream peers share. Chain-blast delays and gas hop delays come from position hashes, and derived (`_chain`) blasts reseed from their position.

Fire test (`SCRIPT=fire node harness/destruct_net.js`, host run then client replay with `applyFires` at 4 Hz): a wooden, furnished interior lit twice plus a gas main and a barrel row.

| | Baseline city | Real city |
|---|---|---|
| client fire set equals the host snapshot after every `applyFires` | 391/391 | 284/284 |
| chunk hashes, same frames / 3 frames late | 100 % (11/11) | 100 % (20/20) |
| chunk hashes, 0–8 frames jitter per op | 64 % (64 voxels differ) | 60 % (236 voxels differ) |
| snapshot size, average / largest seen | 275 B / 1061 B (144 cells) | 330 B / 1439 B (195 cells) |
| `burn` ops | 538 ops, 580 voxels | 386 ops, 428 voxels |

In the 30-op mixed script (tower collapse included) the fire sets also matched on every snapshot (264/264); the grid matched on 59 of 60 edited chunks with matching timing (61 voxels differ, cause not tracked down) and 38 % under jitter, as before.

**Checksums / healing.** Chunk id `c = ci + CX*(ck + CZ*cj)` (the grid's own id), 32 voxels a side.
- `chunkHash(c) → uint32` FNV-1a over the 32768 bytes (0.05–0.13 ms).
- `recentChunks(seconds = 4) → number[]` chunks edited in the last `seconds` of `G.time` (shared array, copy it).
- `encodeChunk(c) → Uint8Array` RLE pairs `[material, run-1]` in j, k, i order.
- `applyChunk(c, bytes) → changed` `grid.set` for differing voxels only, then removes debris cubes / bodies whose centre is now inside solid voxels of that chunk and queues a structure check for it (fire cells on changed voxels drop out on their own).

**Damage.** While `G.net.online`, cubes, bodies, thrown-chunk blasts, fire and chain blasts only damage entities for which `G.net.localOwns(e)` is true (chain blasts call `G.boom` with `damage: 0` and apply the falloff damage themselves).

**Determinism test** (`node harness/destruct_net.js`, `CITY=1` for the real city; fixed 60 Hz steps; numbers in this table are from before fire became host-authoritative, when both peers simulated fire): 30 mixed scripted ops plus a gas-main break, a barrel row and a 144-rocket ring that brings a tower down — 79–83 taps, about 4.5–5 KB as JSON.

| Comparison | Baseline city | Real city |
|---|---|---|
| local run vs `applyRemote` replay on the same frames | 100 % of edited chunks, 0 voxels differ | 100 % (66/66 chunks) |
| same tape replayed twice | 100 % | 100 % |
| every op 3 frames late | 94–100 % (0–6 voxels differ) | 100 % |
| each op 0–8 frames late (jitter, order kept) | 29–31 % of chunks, 6–7 k voxels differ | 24 % (19/80), 27 k voxels differ |

So the replay is exact when timing matches and nearly exact under a constant delay. With per-op jitter it diverges, and real peers also step with different `dt`, so expect the jitter row in practice. The cause is timing, not the carve ops: rockets that arrive over several frames instead of one reach the overload thresholds from different partial states, the 50 ms debounce and fire ticks compare against `G.time`, and rubble deposit is chaotic. What differs is almost entirely rubble piles and burnt voxels; the hash/heal path is what makes peers converge.

Codec on the same runs: edited chunks encode to 1.2–1.3 KB average / 11 KB max (baseline) and 3.3 KB average / 15 KB max (real city) against 32 KB raw, about 0.3 ms each; round trip unchanged on every chunk. Healing the jitter run to the reference took 39 chunks / 63 KB (baseline) and 61 chunks / 213 KB (real city), all hashes equal afterwards.

NET did not call any of this yet when it was tested, so it has only been exercised by the Node test, not over a connection.

## Debug params (harness only)
`demo=tower|corner|mid|punch|barrels|grab|props|fire|gas|tank|siege`, `b=<building index>` (default tallest), `city=1`, `render=1`, `fx=1` (real modules), `step=<m>` (rocket spacing), `slow` (stagger the rockets). `KT.demoRun(seconds)` fast-forwards and returns timings, events and damage; `KT.floaters()` counts voxels not connected to bedrock.

## Tuning knobs
- `TUNE` (bodies): `bitDamage 0.8`, `bodyDamage 1.2`, `bodyDamageCap 260`, `thrownDamage 3`, `thrownDamageCap 700`, `crushSpeedTile 1.5`, `crushSpeedBody 5`, `splitSpeed 8.5`, `heapDust 0.2`, `heapBits 0.07`, `heapChunks 0.2`, `rubbleMix 0.3`.
- `STUNE` (structure): `globalRatio 0.45`, `tileRatio 0.25`, `debounce 0.05`. Raise the ratios to make buildings fall sooner.
- `FTUNE` (fire): `cap 320`, `damage 22`, `spread 1`, `maxGen 36`, `jetTime 6`, `gasHop 12`, `gasDelay 0.32`, `gasMaxHops 10`.
- Gravity for debris is 13 m/s² (`GRAV` in `destruct_base.js`). Caps follow `G.quality.debrisMax`: cubes = `debrisMax`, bodies = `debrisMax / 14` (250 / 157 / 86).

## Measurements
Headless Chromium on this machine was sharing 4 cores with a load average of 25–40, so wall-clock numbers there are noise (a 3000-cube update that costs 0.2 ms showed up as 600 ms). The numbers below are thread CPU time of `destruct.update` from `harness/destruct_perf.js` (Node 22, second run so the JIT is warm, 60 Hz steps). The timer has a 4 ms tick, so single-frame values are coarse; the averages are sound.

| Scenario | avg ms | p99 ms | max ms | floating voxels after |
|---|---|---|---|---|
| Baseline 35 m tower, ground floor blown out (high) | 0.5–0.7 | 4.3–5.7 | 6.5–8.3 | 0 |
| Real city, Kestrel Court 46 m (high) | 0.4–0.8 | 4.2–5.0 | 5.2–10.7 | 0 |
| Real city, Tessaly Centre 46 m (high) | 0.5 | 4.8 | 6.2 | 0 |
| Real city, Halden Mutual 44 m (high) | 0.5 | 4.1 | 7.1 | 0 (one ground voxel before the seed fix) |
| Real city, Lumen Works (46 k voxels, high) | 0.4 | 4.5 | 5.6 | not recorded |
| Real city, 300 random rockets over 18 s, 60 s run (high, fire on) | 0.64 | — | 6.1 | 0 |
| Half a building (corner demo) | 0.24 | 4.0 | 4.7 | 0 |

Average is far inside the 4 ms budget; no frame came near 30 ms. Individual frames during flood fill, collapse preparation and the first storey impacts reach 4–10 ms. In the browser, fire with 80–200 cells cost 0.2–0.5 ms.

## What was looked at
Screenshots in `shots/destruct-*.png`: `d-*` tower sequence (baseline city), `e-*` half-building shear, `r-*` the same collapse in the real city with the real renderer and FX, `p-*` punch, `ba-*` barrel chain, `g-*` grab and throw, `pr-*` street props and a tree, `fire-*`, `gas-*`, `tank-*`. Rounds: (1) tower re-seated itself half a metre lower → modules now crush at 1.5 m/s; (2) glass vanished at release and the tower fell as one block → glass stays in the bodies, per-module spin opens cracks; (3) spiky rubble → downhill rolling to the lowest neighbour, roof slabs kept; (4) fire did not cross sparse furniture → radiant spread across gaps; (5) gas chain stalled on the first break → the walk now picks the run up again past the hole.

## Known issues
- No body-body collision. Falling modules pass through other moving bodies; it is hidden by the crush-on-landing rule but two thrown chunks will not hit each other.
- A storey blown out half way up drops the top onto the lower half, which usually survives with a pile on it (no guaranteed progressive collapse).
- Body meshes use a plain `MeshStandardMaterial` with vertex colours; lit windows go dark and glass turns opaque dark while a module falls. In the real renderer the swap is a slight pop.
- A tall thin piece (lamp post) that drops straight onto its stump can re-seat upright; it is tipped away from the blast, which normally prevents it.
- Explosions do not damage bodies in flight, only push them.
- `impact` without `opts.owner` has no owner, so collapses and barrel chains started by bullets are uncredited. COMBAT can pass `{ owner: shooter }` as the 9th argument.
- Rubble deposited inside a footprint counts as support for the overload rule (a pile can hold up what is left).
- Under continuous fire a floater can exist for the fraction of a second until its building's check runs (seen as 53 voxels at the instant a siege run was cut off; 0 once pending work drained).
- The real renderer at 1280×720 could not be screenshotted on the loaded machine (30 s screenshot timeouts); the real-stack shots are 800×450 at `q=low`.

## Requests for lead
- COMBAT: pass `{ owner: shooter }` to `impact`, and `{ fire: true }` for the arc lance (or call `G.destruct.ignite(x, y, z, 0.6, 1, shooter)` at the beam's hit point).
- FX / AUDIO: `G.destruct.fires`, `G.destruct.jets` and `'gas:jet'` exist now; nothing reads them yet (the harness draws orange boxes as a stand-in).
- CITY: mains and tankers arrived late; verified in Node on the real city (1785 pipe voxels, 4 tankers): breaking one main gave a bounded run of jets, breaking a tanker gave one blast and a pool. Not looked at in screenshots on the real city. The chain walks 26-connected `gas_pipe` voxels, so mains must be continuous.
- PLAYER / ENEMY: rubble is deposited on top of entities standing under a collapse; call `grid.unstick` when a body ends up embedded.
