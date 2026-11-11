# KILOTON — Phase D addendum: co-op multiplayer

Read with CONTRACT.md, -B and -C. Goal: **2–4 player co-op** in Survival and Operation Blackout over a relay.
Team battles come later; do not build PvP now, but do not hard-code "one player" where "each player" is as easy.

## D0. Infrastructure (lead, done)
- Relay: `server/server.ts` (Bun), deployed on Fly as `kiloton-server`; `G.RELAY_URL = 'wss://kiloton-server.fly.dev/ws'`
  (`?relay=` overrides; for local tests run `scratch bun run server/server.ts` → `ws://127.0.0.1:8080/ws`).
  Protocol (read `server/server.ts`): JSON text frames `{t:'create',name}` / `{t:'join',code,name}` →
  `{t:'room',code,id,host,hostId,peers:[{id,name}]}`; `{t:'peer+',id,name}`, `{t:'peer-',id}`, `{t:'closed'}`,
  `{t:'error',error}`, `{t:'ping',s}`→`{t:'pong',s}`; relayed data `{t:'d',to,d}` → `{t:'d',from,d}` (`to` omitted =
  everyone else, `'h'` = host, n = peer id); **binary** frames: byte 0 = target (0 all others, 255 host, n peer),
  relayed with byte 0 replaced by the sender id. Max 4 peers, 256 KiB per message, 240 messages/s per socket.
  Rooms die when the host leaves (no host migration).
- The game is also hosted as a normal web page (`G.WEB_URL`), because the artifact frame blocks WebSockets.
  `G.net.available()` must detect that (try the socket; on failure report "Co-op needs the web version" + `G.WEB_URL`).
- New module slot **`G.net`** (agent NET owns `src/net.js`, `src/net_*.js`, `harness/net*`, `notes/net.md`):
  init order `… mission, net, ui`; per frame `net.update(dt)` runs FIRST (apply received messages), and
  `net.lateUpdate(dt)` runs after all module updates (send this frame's state). Baseline is offline.
- `input.consume(code)` exists now (swallow a key press).

## D1. Model: host-authoritative world, owner-authoritative players
- **Host** (room creator) runs the whole simulation exactly as single player: ENEMY AI, wave director, MISSION,
  enemy projectiles, world destruction it causes, pickups, timers.
- **Every peer owns its own pilot and rig**: its PLAYER controller runs locally and is authoritative for those
  entities' position, animation, hp and weapons. Damage to a player is always *applied by its owner*.
- **Remote players** appear on every other peer as **puppet entities** (`ent.remote = true`, `ent.netOwner = peerId`,
  team 0) with models built from the owner's replicated loadout/paint, interpolated from snapshots.
- **Enemies on clients are puppets** (`ent.remote = true`, `ent.netId`), created/updated/removed from host snapshots.
- **Hits**: a peer's own projectiles are simulated locally and visibly. When they would damage a remote entity,
  `G.ents.damage` must not change hp locally: core does this — if `e.remote` and `G.net.online`, it calls
  `G.net.claimHit(e, amount, info)` and returns 0 (lead implements this in `core.js`). NET sends the claim to the
  entity's owner (host for enemies, the owning peer for players); the owner applies it with real `ents.damage`,
  `info.src` = the claimant's puppet/own entity so kills, score and meter are credited to the right player.
  Friendly fire between players stays off.
- **Enemy fire** on clients: host broadcasts each enemy `'shot'` (weapon, origin, dir, shooter netId, target);
  clients replay it with `G.combat.fireProjectile(id, shooterPuppet, origin, dir, { remote: true })` — a real local
  projectile that damages only entities the local peer owns (its own pilot/rig) and the local world visually.
  The host's copy of that projectile likewise damages only what the host owns (enemies never; host's player yes)
  and does not damage remote-player puppets (the owning client's replayed copy does).
- **Destruction** is replicated as **operations**, not voxels: every mutating DESTRUCT call made *locally*
  (explode, impact, punch, carveBox, ignite, releaseChunk, mission structure builds via grid.set batches) is
  reported through `G.destruct.tap(op, args, seed)`; NET broadcasts it; peers run `G.destruct.applyRemote(op, args,
  seed)` (same call, not re-tapped, debris RNG seeded from `seed` so piles match closely). To heal divergence the
  host sends, a few times per second, checksums of recently edited 32³ chunks; a client whose checksum differs
  requests that chunk and overwrites it from the host's RLE-compressed copy (`grid.set` per differing voxel).
  Debris damages only entities the local peer owns.
- **Shared state** from host: `state.wave`, mission stage/objectives/markers, perk offers (each player picks their
  own perk; `progress` stays per player), announcements (`ui:message`), game over / won. Clients never run the
  wave director or MISSION logic (they render replicated state).
- **Players down**: a dead pilot spectates a living teammate; teammates revive by standing close for 4 s, and
  everyone revives at the start of the next wave / mission stage. The run ends when all players are down.
- **Scaling**: wave size and enemy hp scale with player count (×1, ×1.6, ×2.2, ×2.8 units; boss hp ×1 / 1.7 / 2.4 / 3).
- Rates: player state 20 Hz, enemy snapshots 12 Hz (binary, quantised), events immediately. Budget ≤ 40 KiB/s per
  client at 40 enemies. Interpolation delay ~120 ms; own player has zero added latency.
- Starting: host picks mode and presses Start in the lobby → `{start, seed, mode}` → everyone sets
  `state.seed`, regenerates the city if the seed differs, and starts. Late join is not supported (lobby only).

## D2. NET — `G.net`
`{ online, isHost, id, hostId, room (code), status ('offline'|'connecting'|'lobby'|'playing'|'error'), error,
ping, peers: Map(id → { id, name, ready, ent (puppet pilot or rig currently controlled), pilot, mech, state }),
available() → Promise<bool>, create(name), join(code, name), leave(), start({mode}), send(type, data, to?),
on(type, fn), claimHit(ent, amount, info), tapDestruct(op, args, seed), players() → array of every player's
controlled entity incl. the local one (for AI targeting), localOwns(ent) → bool, update(dt), lateUpdate(dt) }`.
Owns: the socket, lobby, clock/ping, serialisation (compact binary for snapshots), interpolation buffers,
puppet lifetime for remote players (creating entities + models via `G.models`, calling `rig.update` with the
replicated animation inputs, replaying their `'shot'`/`trigger` events so their weapons are seen and heard),
chunk checksums and resync, replicating shared state and the bus events other peers need (`explosion` is local
on each peer already via replicated ops; replicate `ui:message`, `wave:*`, `objective:*`, `mission:*`, `boss:*`,
`mech:incoming/land` for all rigs, `ent:death` for enemies). Bus: `'net:status'`, `'net:peer+'`, `'net:peer-'`,
`'net:start'`, `'net:closed'`. Must be a perfect no-op offline. Test with two (and four) headless pages against a
local relay; measure bandwidth; verify a full co-op wave: both see the same enemies, either can kill them, kills
are credited, a rocket from A makes the same hole on B, a tower dropped by A falls on B, a chunk checksum
mismatch heals, a player dies and is revived, host leaving ends the game cleanly on the client.

## D3. Hooks each owner adds (small, guarded, zero cost offline)
- **core (lead)**: `ents.damage` claim path for `e.remote`; `ents` helper `players()`.
- **ENEMY**: `G.enemy.setPuppetMode(on)` (clients: no AI, no director; `G.enemy.applySnapshot(view)` /
  `serialize(writer)` pair that it defines together with NET: per unit netId, kind, variant, pos, yaw, aim,
  hp fraction, anim flags, limbs, phase, shield, disabled); host targets the nearest/most threatening of
  `G.net.players()` instead of only `state.player.ent`; scaling by player count; aces/hijack/release still work on host.
- **COMBAT**: `opts.remote` projectiles (see D1 ownership rules, use `G.net.localOwns(ent)` to decide whether a hit
  applies); include everything needed to replay a shot in the `'shot'` event (`weapon, origin, dir, shooter, target,
  slot, seed`); lock-on works on puppet enemies.
- **DESTRUCT**: `tap` / `applyRemote` with seeded debris RNG, `chunkHash(c)`, `encodeChunk(c)` / `applyChunk(c, bytes)`;
  debris damage only to locally owned entities when online.
- **PLAYER**: expose `G.player.netState()` (compact: mode, chassis/loadout/paint when changed, pos, vel, yaw, aim
  yaw/pitch, anim inputs, hp fraction, flags: crouch/slide/roll/jet/shield/brace/down) and
  `G.player.applyRevive()`, `G.player.setDown()`; spectate camera when down; revive interaction (hold E near a
  downed teammate puppet); own damage from `G.net` hit claims arrives through normal `ents.damage`.
- **MISSION**: host only when online; objectives replicate through NET (expose `serialize()` / `applyState(o)`).
- **UI**: title "Co-op" entry → lobby (name field, Create game → shows the 4-letter code to share, Join with a
  code, player list with ready state, host picks mode and Starts; clear errors; "needs the web version" notice with
  the link when `available()` is false); HUD: teammate plates (name, health, rig/pilot, down state, distance),
  world markers over teammates, "hold E to revive" prompt, spectating banner, ping/host indicator, kill feed names.
