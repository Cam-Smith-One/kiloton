# NET — notes

Co-op netcode for 2–4 players over the relay (CONTRACT-D D1 / D2). Host-authoritative world, owner-authoritative
players. Offline the module does nothing: `update` / `lateUpdate` return on `if (!ws)`, no hook is installed, no
method of another module is wrapped.

Files: `src/net.js` (socket, lobby, clock, framing, public API), `src/net_wire.js` (binary writer / reader, message
ids, stream clock), `src/net_players.js` (player state, puppets, shots, hit claims, kill credit),
`src/net_world.js` (destruction ops, checksums, chunk healing), `src/net_shared.js` (waves, mission, announcements,
game over, revive-all). Harness: `harness/net.js` (page), `harness/net_lib.mjs` (relay + pages + lockstep),
`harness/net_t1..t7.mjs` (tests), `harness/net_shots.mjs` (screenshots), `harness/net_dbg.mjs` (voxel diff dump).

## API (`G.net`)

Fields: `online`, `isHost`, `id`, `hostId`, `room` (4-letter code), `status` (`'offline' | 'connecting' | 'lobby' |
'playing' | 'error'`), `error` (text for the lobby), `ping` (ms: client ↔ host through the relay; on the host,
host ↔ relay), `peers: Map(id → peer)` (**the other players only**), `myName`, `ready`, `webUrl`,
`reportsAllDown = true`, `seedMismatch`, `stats` (below), `time` (net clock, s), `cur` (module updating right now,
while playing).

A peer: `{ id, name, ready, ent (puppet currently controlled: pilot or rig), pilot, mech, state / st (last decoded
state), lo (their rig loadout object or null), down, seen (a state has arrived this run), hijack }`.
Puppet entities: `remote: true`, `netOwner: peerId`, `netId`, `team: 0`, `name`, `kind: 'pilot' | 'mech'`, `rig`
(model), `yaw`, `hp / maxHp`, and on the pilot `down` (then `alive = false`, `noHit = true`, but it stays in
`G.ents.list` so PLAYER's revive scan finds it).

Methods:
- `available() → Promise<bool>` tries the socket (6 s timeout, result cached 20 s); on failure
  `error = 'Co-op needs the web version: ' + G.WEB_URL`.
- `create(name) → Promise<code>`, `join(code, name) → Promise<code>` (reject with the relay's error text; `status`
  becomes `'error'`), `leave()` (a client that leaves mid-game goes back to the title), `setReady(bool)`.
- `start({ mode })` host only, from the lobby (or while playing: restart). Sends `{seed, mode}`; every peer sets
  `state.mode`, emits `net:start {seed, mode, host}`, then `ui:start` (or `ui:restart` when not on the title).
  The host pressing Retry (`ui:restart`) or going to the title is followed by the clients automatically.
- `send(type, data, to?)` / `on(type, fn(data, from))` custom JSON messages for other modules
  (`to`: peer id, `'h'` host, omitted = everyone else).
- `claimHit(ent, amount, info)` (called by core), `tapDestruct(op, args, seed)`, `players()` (local controlled
  entity first, then every peer's; downed ones included, callers test `alive`), `localOwns(ent)` (`!ent.remote`),
  `entById(netId)`, `enemyCmd(netId, cmd, arg)` (client → host → `G.enemy.command(netId, cmd, arg, puppetOfSender)`),
  `revive(puppetEnt)`, `_push` (test hooks), `out(target)` / `sendJ(obj, to)` (internal framing).
- Bus: `net:status` (the module), `net:peer+` / `net:peer-` (peer), `net:start {seed, mode, host}`,
  `net:closed {reason}`, `net:heal {chunk, voxels, ok}`. Replicated events carry `remote: true`.

Net ids: enemies use ENEMY's `ent.netId` (`u.id & 0xffff`); players are `0xF000 + peerId * 2 (+1 for the rig)`,
written onto the local pilot / rig every frame while playing; mission props keep MISSION's strings (`'m:relay'`,
`'m:core'`). On the wire an id is a `u16`, or `0xEFFF` followed by a length-prefixed string. `entById` resolves
strings through `G.mission.entByNetId(id)`, then by scanning `G.ents.list`.

## Wire formats

Transport: the relay's binary frames `[target u8] ([type u8][len u16][payload])*`, one frame per target per rendered
frame (sub-messages are batched), and JSON `{t:'d', to?, d}` where `d` is one message or `{k:'b', a:[…]}`. A frame
is held back if more than 200 messages went out in the current second (relay limit 240). Little endian.
Quantisers: position x / z `u16 = (v + 32) × 256`, y `u16 = (v + 16) × 128`; angle `u16` per turn; unit `u8 / 255`.

| id | name | direction | payload |
|---|---|---|---|
| 1 | PSTATE | each player → all, 20 Hz | `f32 time, u8 flagsA (mode 2 bits: pilot/mech/down/dead, grounded, crouch, slide, roll, shield, brace), u8 flagsB (dash, grab, hasRig, incoming, down), pos, i8 vel×2 ×3, ang yaw, ang aimYaw, i8 aimPitch×80, u8 speed×8, i8 fwd×64, i8 strafe×100, unit heat, unit jet, unit hp` + if hasRig `pos, ang yaw, unit hp` of the empty rig. 27 or 36 bytes + 3 |
| 2 / 13 | SHOT / BEAM | shooter's peer → all | `str weapon, f32 ×3 origin, i16 ×3 dir, u16 shooter netId, u16 target netId, u8 slot+1, u8 team, u32 seed` (≈ 31 bytes). Replayed with `G.combat.fireProjectile(weapon, puppet, origin, dir, {remote:true, seed, target, slot, team})`. Local player shots on every peer; enemy shots on the host. `remote` / `child` events are never forwarded; BEAM is COMBAT's per-tick `beam` event |
| 3 | ESNAP | host → all, 12 Hz | `f32 time` + the bytes of `G.enemy.serialize()` unchanged → `G.enemy.applySnapshot(bytes, time)` |
| 4 | OPS | each peer → all, per frame | `u16 n`, then `u8 op (explode, impact, punch, carveBox, ignite, burnPool, grab, release, burn), u8 fx (0, or 1 + index into rocket/shell/pulse/mech/slam/grenade), u32 seed, u8 nArgs, f64 × nArgs` (DESTRUCT's tap arguments, exact doubles so both sides carve the same voxels). `burn` (host fire consuming voxels) is instead `u16 count, (u16 i, u8 j, u16 k, u8 mat) × count` |
| 5 | CHK | host → all, 5 Hz | `u8 n`, `(u16 chunk, u32 hash) × n` |
| 6 | CHREQ | client → host | `u8 n`, `u16 × n`: chunk id, bit 15 set = "hash it again" (answered in the next CHK) |
| 7 | CHUNK | host → one client | `u16 chunk, u32 hash, RLE bytes` (`G.destruct.encodeChunk`) |
| 8 | CLAIM | client → host, host → owner | `id target, id source, f32 amount, u8 type index, str weapon, pos hit, i8 ×3 dir, u8 flags (finisher, bonus, limb L / R)` |
| 9 / 10 | PING / PONG | client ↔ host, 1 Hz, own frame | `f64 performance.now()`; answered from the socket handler, not the frame |
| 11 | EDEATH | host → all | `u16 netId, u16 killer netId, u8 type, u8 flags, str weapon` |
| 14 | FIRES | host → all, 4 Hz while any fire or jet is live, and once after | the bytes of `G.destruct.serializeFires()` → `G.destruct.applyFires(bytes)` |
| 12 | WAVE | host → all, 4 Hz | `u16 n, u16 alive, u16 total, u8 enemyMechs, f32 intermission` |

JSON kinds: `hi {name, ready}`, `start {seed, mode, restart?}`, `lobby`, `busy` (joined a running game),
`pl {lo}` (rig loadout, on change and every 5 s), `pev {e:[…]}` (PLAYER's `netEvents`, as is),
`ev {t, d}` (relayed bus event; entities travel as `{$e: netId}`), `ms {s}` (`G.mission.serialize()`, 3 Hz when
changed), `over {cause}`, `reviveAll`, `cmd {id, c, a}`, `x {t, d}` (`net.send`).

### Clock
There is no shared clock. Every stream is stamped with the sender's net time (wall clock; the sim clock when
`net.simClock` is set by the harness). The receiver keeps the smallest `arrival − stamp` it has seen per sender
(drifting up 2 % per sample) and plays that sender back 120 ms behind it (`StreamClock`). ENEMY's puppets
interpolate on their own snapshot spacing; they get the host stamp as `t`.

## What happens where

- **Players.** `G.player.netState()` at 20 Hz; puppets are created from it: pilot model, and a rig built from the
  owner's loadout (`G.models.create('mech', {chassis, loadout, paint})`, hp from `G.rigs.derive`) while the owner
  is in it, has it standing empty, has it falling (`drop` event: it descends for `eta` s, `mech:incoming` /
  `mech:land` are emitted with `team: 0, remote: true`), or just ejected (wreck kept up to 4 s until the
  `selfdestruct` event). Hijacked rigs show as a standard Vanta rig. Position / yaw / aim interpolated between
  samples, up to 0.25 s of extrapolation on the last velocity, jumps over 12 m snap. The models get the replicated
  animation inputs every frame, PLAYER's `trigger` events are replayed on them, their footsteps and jets emit
  `footstep` / `jet` (`remote: true`), `punch` / `slam` events are re-emitted. Rig boarding / eject are not
  re-emitted as `mech:enter` / `mech:eject` (AUDIO and UI treat those as the local player's).
- **Enemies.** Host: `serialize()` at 12 Hz. Clients: `setPuppetMode(true)` at start, `applySnapshot`. Unit deaths
  also go out at once as EDEATH with the killer, and the client emits `ent:death {ent, info: {src, type,
  fromNet}}` with `src` = the local pilot / rig or the killer's puppet, then calls `G.enemy.puppetDeath(id)`:
  score, meter, kill feed and death sounds work per player.
- **Hit claims.** `claimHit` drops anything whose `info.src` is a puppet (its owner claims). A client sends claims
  for enemies to the host; the host sends claims for player puppets to their owner (melee, slams, wreck blasts —
  whatever its simulation does to them outside projectiles, which COMBAT already filters); clients never claim on
  other players. The owner applies it with `G.ents.damage(target, amount, {…, src, fromNet: true})`, `src` being
  the claimant's puppet (a client can only name its own entities). On a claim against an enemy the claimant calls
  `G.player.hitConfirm()` and emits a local `ent:damage {ent, amount, info, claim: true}` (hit marker, hit sounds,
  PLAYER's perk top-up, which goes out as a second claim flagged `bonus`).
- **Destruction.** `G.destruct.tap = fn` while playing; ops are batched per frame and applied on arrival with
  `applyRemote`. An `explode` op is flagged `fx` when the blast is not a projectile's (those are announced by the
  replayed projectile) and not a unit wreck's (ENEMY's puppet does it): receivers then emit
  `explosion {…, kind, owner, remote: true}`. The flag comes from pairing the tap with the `explosion` event
  `G.boom` emits right after it and from which module is updating (`net.cur`).
- **Healing.** Host, every 0.2 s: hashes of up to 9 chunks from `recentChunks(6)` (round robin), 5 chunks of a
  full sweep (all 432 in 17 s), plus any "hot" chunks (around a new objective, rechecks asked by clients). Client:
  a differing chunk is noted; if it still differs after 0.8 s the client asks for a fresh hash; if the host's hash
  is unchanged (the chunk has settled there) and still differs, the chunk is requested, nearest to the player
  first, 2 requests per 0.2 s, at least 1.5 s between requests for one chunk. The host serves 2 chunks per frame.
- **Fire.** The host's fire is the only fire: FIRES carries the burning cells and jets, `burn` ops the voxels it
  consumes; jet booms arrive as ordinary `explode` ops (flagged `fx`, so clients see and hear them).
- **Mission props.** The relay and core puppets on clients (`remote`, string net id, no `netOwner`) take hits like
  enemy puppets: the claim goes to the host, which applies it to `G.mission.entByNetId(id)`. Their deaths go out
  as EDEATH too.
- **Pushes on enemies.** PLAYER moves enemy entities directly (knock-back adds velocity, the grapple drags the
  position and sets `held`). On a client those are puppets, so NET measures what PLAYER's update changed on each
  enemy puppet (velocity change over 0.5 m/s, any position change, at most 15 positions a second per unit) and
  sends `enemyCmd(netId, 'impulse', {vx, vy, vz})` / `enemyCmd(netId, 'pull', {x, y, z, held})`. The host tries
  `G.enemy.command` first; ENEMY does not know these two yet, so the FALLBACK writes the host entity: impulse →
  `ent.vel` += (clamped, ignored while `held`); pull with `held` → `ent.held = true`, position set, released 0.4 s
  after the last pull; pull without `held` (a rig being shoved) → x / z set if the spot is not solid; drags over
  30 m are ignored.
- **Shared state.** WAVE writes `state.wave` on clients (intermission counts down locally between updates).
  Forwarded bus events (host → clients, re-emitted there): `wave:start`, `wave:clear`, `ui:message` (only those
  emitted during ENEMY's or MISSION's update: PLAYER's are personal), `game:won`, `boss:spawn / phase / dead`,
  `mech:incoming` / `mech:land` of Vanta rigs, `ace:called`, `rig:disabled`, `weapon:tell`. `objective:*` and
  `mission:*` are forwarded only if MISSION has no `serialize` (it emits them itself from `applyState`).
  `wave:clear` re-emitted on a client makes `progress.js` pay salvage and offer perks there: each player picks
  their own.
- **Down / revive / over.** PLAYER's `down`, `revived`, `revive {target}` events travel in `pev`; the target peer
  calls `G.player.applyRevive()`. At every `wave:start` and `mission:stage` the host sends `reviveAll`. The host
  ends the run when every player has been down for 0.6 s (`over {cause:'squad'}` → `G.player.allDown(cause)` on
  every peer) and forwards its own `game:over` (mission failed) the same way.
- **Scaling** needs nothing here: ENEMY reads `G.ents.players().length`, which is `G.net.players()`.
- **Start.** Seeds: the host sends its `state.seed`. A client with another seed regenerates the city
  (`G.city.generate(seed)` or `init()`), sets `net.seedMismatch`, and relies on healing for anything a module cached.
  Everyone spawns on the same marker, so each pilot is moved 2.4 m out on a ring by peer index.
- **Leaving.** `peer-`: puppets disposed, `net:peer-`, a `ui:message`. `closed` (host left) or a dropped socket on
  a client: puppets and enemy puppets removed, tap and wrappers removed, `status = 'error'` with the reason,
  `net:closed`, `ui:title`, a `ui:message`; the page can play offline afterwards. A host whose clients leave
  carries on alone. Joining a running game is refused (`busy`).
- **No slow motion online**: `G.timeScale` is forced back to 1 each frame while playing.
- **Hidden tab.** boot now ignores `ui:pause` online and steps the sim from a worker timer at ~30 Hz while the tab
  is hidden; `update` / `lateUpdate` do not care who calls them (stamps are wall clock, send timers run on `dt`,
  one `lateUpdate` per `update`). A 250 ms timer still pumps the socket when nothing calls `update` (lobby in a
  hidden tab). After any stall only the newest enemy snapshot of the backlog is applied; player buffers are fixed
  rings of 8 samples, so nothing grows.

## Hooks used, and fallbacks

| Hook | State |
|---|---|
| ENEMY `setPuppetMode / serialize / applySnapshot / puppetDeath / byNetId / command` | real hooks used. No fallback snapshot was kept: without `serialize` no enemy data is sent and nothing throws |
| COMBAT `shot` (`slot, target, seed, remote, child`), `beam`, `opts.remote` | real hooks used |
| DESTRUCT `tap / applyRemote / chunkHash / recentChunks / encodeChunk / applyChunk / serializeFires / applyFires`, op `burn` | real hooks used. Fallback kept for a DESTRUCT without them (the lead's baseline): `explode` and `carveBox` are wrapped while playing and restored after, and the same FNV-1a hash / RLE codec run on `G.grid.data` |
| PLAYER `netState / netEvents / applyRevive / allDown / hitConfirm` | real hooks used. Fallback kept for a PLAYER without `netState` (baseline fly camera): the controlled entity, or the camera position, is sent as a pilot |
| MISSION `serialize / applyState / entByNetId` | real hooks used. Fallback kept for a MISSION without them: its `update` is stubbed on clients and the plain objective / marker fields are mirrored |
| core `ents.damage` claim path, `ents.players()` | used |
| ENEMY `command(…, 'impulse' / 'pull')` | **not there yet**: fallback writes the host entity (see "Pushes on enemies") |
| boot: no pause online, hidden-tab stepping, `debugStep` calls `lateUpdate` | used; the deferred-`lateUpdate` workaround is removed |

While playing online (and only then) `update` of player, enemy, mission, combat and destruct is wrapped by a
two-line shim that records which module is running (`net.cur`); the originals are put back when the game ends.

## Tests and measurements

All with `node harness/net_tN.mjs` (each starts the relay on :8080 and a static server, opens headless Chromium
pages in separate contexts and steps them in lockstep with `KT.nt.step`, 30 Hz; real CITY, DESTRUCT, MODELS, COMBAT,
PLAYER, ENEMY, MISSION; baseline render / fx / audio / ui unless `BASE=` says otherwise). 

### Results (65 checks in 7 scripts, all pass; no console errors in any page; fire ON everywhere)

**t1, two players (12 checks)**
- Lobby, start, both `playing`; `G.ents.players().length` = 2 on both. Puppet position error standing: 0.000 m.
- 4 host units (rifle, rocketeer, tank, drone): same ids / variants on the client, all `remote`; largest position
  difference while they move 0.59 m (the client shows them about 120 ms in the past).
- Client kills a soldier with the rifle: 4 shots → 4 claims out, 4 in on the host; kills 1 / score 100 on the
  client, 0 / 0 on the host. Host kills the rocketeer: host 1, client stays 1. Gone on both.
- A host soldier fires 25 `e_rifle` rounds at the client's puppet: 20 damage events (100 hp, pilot down) on the
  client, 0 on the host, host hp unchanged.

**t2, destruction, down / revive, leaving (15 checks)**
- Same city at start: 1 089 553 solid voxels on both, 0 of 432 chunk hashes differ.
- Client launcher rocket into a wall 8.5 m away: 57 voxels removed on both, counts equal, 0 chunks differ.
  Host rocket: 74 more on both (fire burning), counts equal, 0 differ.
- 500 voxels overwritten on the client only: healed after 16.7 s (found by the sweep), 1 chunk, 3.7 KB.
- Client fells Kestrel Court (46 m; 33 ops out, 33 in): upper 30 592 voxels → 0 on both after 14 s; all hashes equal
  by then after 24 healed chunks / 103 KB (runs before the fire change: 19–55 chunks, 95–227 KB, up to 27 s more).
- Client pilot killed: `down`, host's puppet `down`, phase still `playing`, client spectating. Host holds E beside
  it: revived after 4.0 s at 50 hp. Both down: `over` on both. Host Retry: both `playing`, world restored.
- Host page closed: client `status 'error'` "The host left the game.", `net:closed`, phase `title`, tap `null`,
  puppet mode off, 0 peers; it then starts an offline run.
- Offline page, 400 frames: wave 1, 5 units alive, 0 bytes and 0 messages sent, `tap` null, `player.update` unwrapped.

**t3, four players (12 checks)**
- Everyone sees the other three (error 0.000 m); spawns ≥ 3.4 m apart.
- Real director: wave 1 has 14 units for 4 players; `state.wave` equal on host and client, client got `wave:start`.
- Client boards a Bastion: `mech` / `bastion` puppet on the other peers, hp 3248 on both, position error 0.000 m.
- Bandwidth and CPU, 12 s of fighting each (every player firing a rifle burst 3 times a second, units firing back,
  units given 1e6 hp so the count holds), bytes per second of game time:

| Units | client in | client out | host out (to 3 clients, before relay fan-out) | host in |
|---|---|---|---|---|
| 10 | 5.4 KB/s | 0.88 KB/s | 3.9 KB/s | 2.6 KB/s |
| 25 | 9.6 KB/s | 0.87 KB/s | 8.1 KB/s | 2.6 KB/s |
| 40 | 19.4 KB/s | 0.90 KB/s | 20.7 KB/s | 2.7 KB/s |

  (budget: 40 KiB/s per client at 40 enemies; the 40-unit figure was 16.8 KB/s in the run before fire replication).
  Enemy snapshots are 6 + 18 × units bytes at 12 Hz (8.7 KB/s at 40); the rest is shots, ops, fire, checksums
  (0.6 KB/s) and healed chunks.
- CPU per frame (EMA; max in brackets), headless Chromium on a loaded machine: host `update` 0.09–0.18 ms (2.9),
  `lateUpdate` 0.18–0.26 ms (2.2); client `update` 0.21–0.29 ms (3.6), `lateUpdate` 0.07–0.09 ms (1.5).
- 40 units after the fight: same 40 ids on host and client, mean position difference 0.18 m, max 1.02 m.
- One client closes its page: the other three carry on.

**t4, operation and events (11 checks)**
- `start({mode:'operation'})`: after 12 s stage 1 with the same 3 jammer objectives and 3 markers on the client,
  `mission:stage` and 3 × `objective:new` emitted there by `applyState`; 0 chunks differ, 1 093 405 voxels on both.
  Host announcement "Operation Blackout" shown on the client.
- `G.boom` outside COMBAT on the host: 296 voxels gone on the client and exactly one `explosion {kind:'slam',
  remote:true}` there. Host launcher rocket: exactly one `explosion` on the client.
- Ping 1 ms (local relay); 6 messages sent in 2.5 s with no frames running (pump).
- Host to title: both `lobby`; second `start`: both play; client `leave()`: client offline at the title, host plays on.

**t5, real frame loops, wall clock, real UI loaded (5 checks)**: a client running in a circle at 2–2.8 m/s is
0.21–0.39 m behind on the host on average (max 1.12 m), i.e. 0.09–0.15 s; 5 units on both. Software GL ran the
pages well under 20 fps, so rates there are not representative.

**t6, the co-op fixes (7 checks)**
- Knock-back from a client (+14 m/s x, +5 m/s y on a soldier puppet during PLAYER's update): 1 impulse arrives,
  host unit velocity 10.4 m/s x three frames later, it ends 3.5 m away. `G.enemy.command(…, 'impulse')` returns
  false, so this is the fallback path.
- Grapple drag from a client (15 frames holding the puppet 2 m up): host unit `held`, y +2.0 m; 0.4 s after the
  drag stops `held` is false and it is back on the ground (9 pushes).
- Fire started by the client in a flammable shop front 6 m away (rocket blast + `ignite`): 114 cells at the peak;
  burning cell counts on host / client each second 107/107, 112/113, 63/67, 45/45, 49/49, 57/60, 55/55, 44/42,
  34/34, 34/34; 1 chunk (at most 2) differs while the flames are eating voxels and 0 from second 25 on with the
  fire still burning; solid voxels equal (1 088 892); 108 FIRES messages, 45 KB in 29 s (1.6 KB/s); 3 chunks healed.
- Hidden client: 20 s of host time with no client frames (only the pump), three host blasts meanwhile: still
  `playing` with the 6 units; one second after frames resume all 6 units within 0.55 m of the host's, the host's
  puppet exact, and the world hashes equal 13.9 s later.
- Client hits on the citadel core puppet (`'m:core'`, stage 3): 5 claims of 100 → host core 2600 → 2100.

**t7, hidden host (3 checks)**: host page with no animation frames and `document.hidden` forced, so boot's worker
timer drives it: 30.3 steps per second, game time 1.00 × wall time, 12.0 enemy snapshots per second, NET cost
0.03 ms `update` + 0.21 ms `lateUpdate`; the client (normal frame loop) received 96 snapshots in 8 s, saw units
travel up to 45 m, ground units within 1.3 m of the host's at the same instant.

**Screenshots** (`harness/net_shots.mjs`, real renderer, 800×450, low tier): `shots/net-01-host.png` /
`net-01-client.png` both on foot (the host's view shows the teammate mid-stride crossing the street ahead, in the
right place); `net-02-host.png` / `net-02-client.png` the client in a white Bastion with a shield arm, walking and
firing: the host's view shows the same rig, paint and loadout from the side with the blasts down the street, the
client's view shows it from behind. Looked at; two rounds (the first composition hid the teammate behind a wall and
the rig above an awning).

## Debug / harness

`dist/h-net.html` query: `net=host` | `net=join&code=XXXX`, `name=`, `relay=ws://127.0.0.1:8080/ws`,
`manual=1` (no frame loop; `KT.nt.step(n, dt)` advances, `KT.nt.frame()` renders one real frame),
`base=render,fx,…` (baseline for those modules), plus every module's own params (`noenemy`, `god`, …).
`KT.nt`: `info() me() peers() enemies() solid() hashes() diffChunks(h) fireAt(weapon, x, y, z) moveTo(x, z) log dmg`.
`G.net.stats`: `outBps inBps bytesOut bytesIn msgsOut msgsIn updMs lateMs updMax lateMax opsOut opsIn shotsOut
shotsIn claimsOut claimsIn chkOut chkIn chunkReqs chunksOut healed healedVoxels healBytes snapsOut snapsIn snapBytes`.
Tuning constants are at the top of each file (`INTERP 0.12`, `RATE 1/20`, `SNAP_DT 1/12`, `CHK_DT 0.2`,
`CHK_RECENT 9`, `CHK_SWEEP 5`, `REQ_PER_TICK 2`, `MISMATCH_AGE 0.8`, `REQ_GAP 1.5`).

## Known issues

- **A collapse is not identical while it happens**: debris piles differ until healed (about 20–55 chunks,
  95–230 KB per client for a 46 m tower, spread over 15–30 s). While a fire is eating voxels the chunk it is in can
  differ by a few voxels for a moment (ops in flight); it agrees again without waiting for the fire to end.
- **Pushes use a fallback on the host** (direct velocity / position writes) until ENEMY's `command` takes
  `'impulse'` and `'pull'`; a soldier's AI damps an impulse within a few frames, as it does offline. A rig knocked
  into a wall by a client is moved on the host but the wall-slam carve and crush damage are still the client's own
  (the carve is a tapped op, the damage a claim), so the two can disagree by a step.
- A hidden tab steps at ~30 Hz; browsers that also throttle workers in background tabs would slow the host.
- A client that restarts or goes to the title by itself leaves the room (title) or desyncs until the next host
  start (Retry): the UI should offer only "Leave" to clients.
- Different city seeds: regeneration is best effort (DESTRUCT's building table and ENEMY's nav are built at init).
  Everyone on the default seed is the tested path.
- Late join is refused, there is no host migration, and nothing is authenticated: a client could send claims of
  any size for its own entities.
- Send timers run on game `dt`, which boot clamps to 50 ms: a peer rendering under 20 fps sends proportionally
  less often (seen in software-GL real-time runs; puppets still tracked with the expected 0.1–0.15 s delay).
- Finisher lifts by a client act on the enemy puppet locally only.
- Not tested: the deployed relay (`wss://kiloton-server.fly.dev`), real latency / packet delay, more than one
  browser machine, the real UI lobby driving `create / join / start` by clicks (it was loaded, not clicked).

## Requests for lead

- **ENEMY**: accept `command(netId, 'impulse', {vx, vy, vz}, by)` and `command(netId, 'pull', {x, y, z, held}, by)`
  (return true) so pushes go through the unit's own stagger / held rules; NET then stops writing the entity itself.
- **core.js**: `G.boom` could pass `weapon` / a `source` tag through to the `explosion` event; NET now infers
  "projectile or not" from which module is updating.
- **server.ts**: no change needed (a page opened from `file://` connects to the local relay too).
- **UI**: hide Retry / Title for clients (host only), or route them to `G.net.leave()`.
