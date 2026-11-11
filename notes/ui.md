# UI — notes

## What is built
`G.ui` is the whole interface, DOM + CSS + inline SVG + one 2D canvas (radar), injected into `#kt-ui`
(one `<style>`, one `.ku` root). Font: Barlow Condensed from Google Fonts via `<link>` appended in `init`,
with a condensed system fallback stack; the wordmark is our own SVG lettering, so it does not depend on the font.

| File | Role |
|---|---|
| `src/ui.js` | module (`init/reset/update`), title / pause / debrief markup, settings, phase glue, keyboard traversal, tips |
| `src/ui_hud.js` | the in-game cluster: `createHud(root, view)`; all per-frame work lives here |
| `src/ui_css.js` | stylesheet (scoped under `.ku`, sized in `em` from one `clamp()`-ed root size) |
| `src/ui_demo.js` | fake state for `?ui=` (the HUD reads a `view`, so the demo never writes `G.state.player/wave`) |
| `harness/ui.js` | baseline everything + real UI; `bg=bright|dark|fire` legibility backdrops |
| `harness/ui_int.js` | real player / combat / models / enemy / audio + baseline city/render, for integration checks |

Screens
- **Title**: wordmark, pitch, Start (click, or Enter which clicks it), best wave, pilot + rig controls reference,
  the credit line "A game design by Cam Smith". Centre left open; one bottom scrim.
- **HUD**: crosshair (rifle / launcher / pulse / salvo / lock variants, bloom from movement, shots, heat and
  `weapon.spread` if present, resource arc under it, hit and kill markers); pilot health or Warden armour with a
  lagging damage bar, pilot mini-gauge while in the rig, jet fuel; weapon cards (magazine, reload progress, heat /
  overheat, recharge, lock states, key hints, active card); rig meter with four states (filling, **RIG READY — V**,
  inbound countdown, "Warden standing by" with distance); wave number / hostiles / intermission countdown /
  enemy-rig line; wave banner; toasts; heading-up radar; damage-direction arcs; lock brackets; missile-lock warning;
  world markers (waiting Warden, own drop, Vanta drop, charging aces) that clamp to the screen edge with an arrow;
  context prompt; score, kills, combo, kill feed; low-health vignette and damage flash; first-run tips.
- **Pause**: Resume / Restart / Title (Restart and Title ask "Confirm?" on the same button), settings, controls.
- **Debrief**: wave reached, new-best tag, cause line, kills, score, time, rigs called, voxels destroyed,
  buildings levelled, Retry / Title. Appears 1.3 s after `game:over` so the death reads first.

## What it reads
- `state.player`: `mode ent pilot mech meter mechReady mechIncoming weapons activeWeapon lock jet prompt score kills combo`.
  Health comes from `pilot.hp/maxHp` and `mech.hp/maxHp`.
- Weapon fields: `id name kind clip clipMax reloading heat overheated charge ready`, optional `spread` (radians)
  and `def.key`. Key hints default by id (`rifle/pulse` LMB, `launcher/salvo` RMB, `skylance` Q, `punch` F).
- `state.wave`: `n alive total intermission enemyMechs bestWave`. `state.stats.*` for the debrief.
- Bus: `ent:damage ent:death shot score building:levelled ui:message wave:start wave:clear lock lock:warning
  mech:incoming mech:land mech:enter meter:ready ace:charging ace:called phase game:start game:over game:resume
  pointerlock quality resize key`.
- Prompt strings are parsed into a key chip + text: `E — BOARD RIG`, `LMB / E — THROW`, `HOLD X — EJECT`,
  `Press E to board`. `RIG INBOUND` and `RIG WAITING` are not shown as prompts because the rig meter says them.
- Radar blips: soldier dot (ace gets an amber ring from `ent.variant === 'ace'`), drone hollow triangle, gunship
  filled triangle, tank square, enemy rig large diamond, waiting Warden hollow cyan diamond, drops as a pulsing
  cross, hostile non-bullet projectiles from `G.combat.projectiles` as amber specks. Range 75 m, rim-clamped.

## What it writes / emits
- `state.settings.{sens,volume,music,shake,invertY,quality}`; persisted to `localStorage['kiloton.settings']`
  (try/catch). On load a stored quality tier is applied with `G.setQuality` unless `?q=` is given.
  Volume changes also call `G.audio.setVolume(master, music)`.
- `localStorage['kiloton.best']` (best wave), `['kiloton.tips']` (which tip groups were shown).
- Emits `ui:start ui:resume ui:restart ui:title` from click handlers (after `input.lock()` + `audio.unlock()`).
- Extra, optional for others: `bus 'settings'` (the settings object, on every change).
- Menu sounds: `G.audio.play('ui_click')` on button actions, `'ui_back'` on Title, `'ui_hover'` on button hover
  (guarded if absent). Round 1 emitted `bus 'ui:sound'`; that is gone, because AUDIO maps it too and both would double up.
- Sets `G.canvas.style.cursor = 'none'` only in phase `playing`.

## API beyond the contract
`G.ui.message(text, sub, kind, dur)`, `G.ui.banner(title, sub, good)`, `G.ui.stats {ms, peak}` (HUD cost),
`G.ui.hud` (`update reset toast banner queueTips on{…}`), `G.ui.refreshSettings()`.
Toast kinds: `info | warn | good | bad`. A toast with the same text as a live one refreshes it instead of stacking.

## Pointer lock
- Refused (`pointerlockerror`, e.g. sandboxed frame): core sets `fallbackLook`; the run carries on, a 6 s toast
  says "Mouse capture unavailable — move the mouse to look", and the title / pause notes repeat it.
- Request neither granted nor refused, or the run was resumed with Esc: a small "Click to capture the mouse"
  line appears after 1.2 s and a click on the view requests the lock. Nothing blocks.

## Keyboard
core.js prevents the default action of Tab, Space and the arrows, so the menus do their own: Tab / Shift+Tab move
focus through the visible screen's controls, Space activates a focused button, arrows step a focused slider,
Enter = Start on the title and Retry on the debrief. Focus ring is amber (`:focus-visible`).

## Round 2 (PLAYER's final key map)
- Title and pause references, HUD key-hint strip and tips follow the final map: mantle, crouch / slide (C),
  combat roll (X), Seeker AA (Q) on foot; hold-Space jets, LMB also throws a held object, Skylance up to four in the rig.
- `seeker` (kind `lock`) gets the Q chip, the lock crosshair and the Skylance card states
  (Charging / Hold to lock / Locking / Locked). Three pilot cards fit at 1280 and at 420 px.
- A tag beside the PILOT label shows `In cover` (cyan) from `state.player.inCover`, else `Slide`, `Roll` or
  `Crouch` from `.slide/.roll/.crouch`. `.shoulder` is not displayed.
- Prompts: `SEEKER SEEKING` shows as plain text; `RELEASE Q — FIRE SEEKER ×n` shows a Q chip + "Release: fire Seeker ×n".
- New pilot tips: mantle, crouch and cover, slide, roll, Seeker lock.

## Phase B: Rig Bay and HUD (CONTRACT-B section B4)
- `src/ui_bay.js` (`createBay`), opened from the title (button or **B**) and from the pause card; `G.ui.bay`,
  `G.ui.openBay()`. Panel is `clamp(31em, 38vw, 47em)` on the left; right side stays clear apart from a small
  preview caption; at <= 700 px the panel is full width over a scrim.
- Layout: loadout tabs 1/2/3 (the drop loadout carries a DROP tag, an overweight one a red underline), name field,
  chassis cards with armour / speed / jets / load bars, blurb + ability, hardpoint rows (slot, module, fire key,
  tonnes) that open an inline picker of the modules where `moduleFits` (tonnes turn red if the pick would overload),
  fire-group summary, plating slider, paint swatches. Pinned footer: tonnage bar (modules cyan, plating ink, amber
  capacity tick; red with "OVERWEIGHT — CANNOT DROP. SHED n T." when `derive().over`), armour / speed / dash / jets,
  Set as drop, Reset.
- Edits act on a working copy per tab. Every edit: `bay.set(i, lo)` only if not overweight, `state.bay.editing = i`,
  `state.bay.preview = lo`, `bus 'bay:preview' {loadout, index, valid}`. Open / close set `state.bay.open` and emit
  `'bay:open' {index, loadout}` / `'bay:close'`. An overweight build is shown but never saved; Set as drop is
  disabled and `bay.select` is not called. Reset restores `DEFAULT_LOADOUTS[i]`.
- Fire keys shown: weapons by group (LMB / RMB / Q); arm equipment G, or T on the right arm when both arms carry
  equipment; empty arm F; back equipment "Auto".
- Keyboard: Tab / Shift+Tab or Up / Down move through controls; Left / Right cycle the module on a focused
  hardpoint row and move within tabs, chassis, paints and picker options; Enter / Space activate; 1 / 2 / 3 switch
  loadout; Esc closes the picker, then the bay. Space and Left / Right are re-implemented inside the name field
  because core.js swallows them.
- Esc / P while paused: boot.js turns them into `ui:resume`. With the bay open I close the bay and immediately
  re-emit `ui:pause`, so the game ends up paused, but `game:resume` + `game:pause` both fire in that tick.
- HUD: up to 5 weapon cards from `state.player.weapons[i]` (`key` wins over my id table; 4+ cards use a narrower
  card, two rows at <= 760 px); loadout chips 1/2/3 under the rig meter on foot (from `G.rigs.bay`, refreshed on
  `'bay:changed'`); in the rig a Shield gauge (`equip.shield.energy`, cyan label while `on`) and a Grapple state
  (`equip.grapple.state`; `idle`/`ready` read "Ready", anything else is shown as given) appear only when PLAYER
  writes those objects. Lock brackets pool raised to 8 for Swarm. Crosshair variants mapped for the new weapons.
  The rig meter column collapses in the rig so five cards fit at 1280.
- Controls reference, key-hint strip and tips cover G / T equipment, 1-3 loadout, E plant charge, slam / brace,
  air dash.
- Demo: `ui=bay` with `uis=warden|harrier|bastion|over|pick`; `ui=rig` now fakes five weapons with `key`/`slot`
  and `equip`.
- Checked with `--eval`: mouse edits (tab, module, paint, plating, name) land in `G.rigs.bay.loadouts` and
  `localStorage['kiloton.bay.v1']`; Set as drop changes `bay.active`; an overweight build leaves the saved loadout
  and `bay.active` untouched with the button disabled; digits, arrows, Tab and Esc work; Esc from a paused bay
  leaves the phase `paused`.
- Seen once over PLAYER's real preview rig via `harness/ui_int.js` (`shots/ui-b3-int-bay.png`, Bastion): the rig
  frames in the clear right side. Not seen: real `state.player.equip` values in play, and the bay opened from pause
  with the real player.

## Phase C: operations, salvage, perks (CONTRACT-C section C5)
- **Title**: mode select (Survival / Operation Blackout, one-line brief each) writes `G.state.mode`, persists to
  `localStorage['kiloton.mode']`, honours `?mode=`, emits `bus 'mode'`; Start reads "Deploy" for the operation.
  Salvage total sits beside best wave. Arrows switch mode when a mode card has focus.
- **Rig Bay**: locked chassis show a lock + price on the card, locked modules a lock on the hardpoint row and
  lock + price in the picker; salvage total in the header. Locked parts can still be fitted to look at them, but a
  loadout with locked parts is not saved (same rule as overweight) and cannot be the drop. The primary button
  becomes "Unlock <part> — n" (amber) and buys the next locked part with `progress.unlock(id)`; it is disabled
  with a lock when salvage is short. Once nothing is locked it is Set as drop again. On open, if the active drop
  loadout is locked the first unlocked one is selected. On-foot loadout chips show a lock on locked loadouts.
- **HUD, operation mode** (`state.mode === 'operation'`): the wave line is replaced by "Stage n / title" (from
  `'mission:stage'`, falling back to a numeric `G.mission.stage`); stage banner + briefing toast on `'mission:stage'`.
- **Objective tracker** under the radar from `G.mission.objectives` (up to 4 rows): text, sub, progress bar and a
  readout that is the timer if `timer != null`, else `count / total`, else percent; Done / Failed states linger 5 s.
  Objectives with `x,z` get a square world marker (`label` or a word for the kind, distance) and a square radar
  blip; `defend` ones are cyan. `G.mission.markers[]` entries `{x,y,z,label}` get the same marker.
- **Relay integrity** bar while a `defend` objective is live: hp from `objective.ent` / `.target`, else the first
  team-0 `prop` entity with hp, else `objective.hp/maxHp`; hidden if none of those exist.
- **Boss bar** for a live team-1 entity with `variant === 'dreadnought'` or `ent.boss`: name (`ent.name`), phase
  (`ent.phase`, else thirds of hp), lagging damage bar, ticks at the thirds.
- **Salvage ticker** in the score block on `'salvage'`: total plus an amber "+n" that accumulates for 2.6 s.
- **Perk picker** on `'perk:offer'`: three cards, click or 1 / 2 / 3; sets `G.timeScale = 0.05` and restores 1 on
  pick, on run reset and on game over; calls `progress.takePerk(id)`; never auto-picks. Taken perks show as
  two-letter plates above the vitals (full text in the title attribute). While it is open the digit keydown is
  popped off `input._q` so PLAYER does not also switch loadout; that reaches into core.js internals.
- **Debrief**: both variants now show Salvage earned (`progress.runSalvage`) and Perks. Victory on `'game:won'`:
  "Operation Blackout complete / Victory", Play again / Title. boot.js has no won phase, so the card is driven by
  `G.ui.won`; after 2.2 s the mouse is released, boot pauses on the lock loss and I re-emit `ui:resume` so the
  victory orbit keeps running (so `game:pause` + `game:resume` fire once). A failed operation reads
  "Operation failed / Stage n".
- **Five weapon cards**: with four or more cards the name uses `w.short`, `w.def.short` or my short table
  (Pulse, Autocannon, Arc lance, Siege, Hailstorm, Skylance, Swarm, Mortar, Seeker).
- **Small frames**: at <= 760 px the tracker and tips move into the centre column under the radar row, so stage
  line, gauges, tracker, banner and toasts stack instead of overlapping.
- Demo: `ui=objectives` (`uis=relay`), `ui=boss` (`uis=rage`), `ui=perks`, `ui=won`.
- Checked with `--eval`: mode cards write `state.mode`; with 0 salvage the Harrier loadout cannot be dropped; with
  salvage the button buys Harrier (1000 -> 400), then Grapple (-> 100), stalls on Jet booster until topped up,
  then sets the drop; progress lands in localStorage; `offerPerks()` opens the picker at timeScale 0.05, Digit2
  takes the second perk, timeScale returns to 1 and the key is swallowed; clicking a card works too;
  `'game:won'` shows the victory card with the phase still `playing`.
- Checked against the real MISSION and ENEMY (`harness/ui_ops.js`: real mission / enemy / player / combat / models
  on baseline city + render, `mode=operation&stage=N`): stage 2 shows "Stage 2 / Hold the relay", the tracker row
  with MISSION's sub ("Uplink integrity 100 %") and timer, the relay bar from `objective.ent`, and MISSION's relay
  marker; stage 4 shows the tracker row, the boss bar ("Vanta Dreadnought", phase from `ent.phase`, 9000 hp) and
  the boss marker. Shots `shots/ui-c4-ops-stage2.png`, `-stage4.png`.
- MISSION's markers are `{id, kind, label, x, y, z, ent, active}`: I follow `ent.pos` when there is one, skip
  `active === false`, colour `relay` cyan and `boss` / `core` red, and do not draw a second marker for an objective
  that already has one (same `ent`, or within 4 m). Markers within 6 m of the player are hidden (not the boss).
- Boss: `'boss:spawn' {ent}` binds the bar at once (a scan for `ent.boss` / `variant 'dreadnought'` every 16 frames
  is the fallback); the phase text reads `ent.phase` each frame, so `'boss:phase'` needs no handler; `'boss:dead'`
  or the entity dying hides it.
- Off-screen markers now park on an ellipse inside the frame instead of the frame's rectangle, so they no longer
  land on the radar or the other corner clusters.
- Not seen: stage 1 and stage 3 against the real MISSION. In the baseline-city harness stage 1 creates no
  objectives (it needs the real city), and the full build still cannot be screenshotted here. The jammer rows were
  only seen with the demo's fake objectives.

## Phase D: co-op (CONTRACT-D section D3, UI)
- **Title**: a CO-OP button opens the lobby (`src/ui_coop.js`, `G.ui.lobby`, `G.ui.openLobby()`), a left panel like
  the Rig Bay. It only uses the `G.net` surface: `status error room id hostId isHost ping peers available() create(name)
  join(code, name) leave() start({mode})` and bus `net:status net:peer+ net:peer- net:start net:closed`.
- Lobby states: "Checking the relay" while `await G.net.available()`; if false, "Co-op needs the web version" with
  `G.WEB_URL` as an ordinary link (new tab) and a line that single player works here; otherwise pilot name
  (persisted in `localStorage['kiloton.name']`, 14 characters), Create game, and Join with a 4-character code
  (upper-cased, validated before calling). In a room: the code large with Copy, four pilot slots (name, HOST / YOU
  tags, selected rig name), and for the host a Survival / Operation Blackout choice and Start; others see "Waiting
  for host". Errors come from `G.net.error` (or a thrown / rejected call) in red. Leave calls `G.net.leave()`;
  Back / Esc also leaves the room.
- A peer's rig name is read from, in order, `peer.rig`, `.rigName`, `.state.rig`, `.state.loadoutName`,
  `(.loadout || .state.loadout).name`, or the chassis name from `.chassis` / `.state.chassis`; a dash if none. The
  local row uses `G.rigs.bay.current.name`. NET should confirm which field it fills.
- Start: the host's click calls `input.lock()` + `audio.unlock()`, writes `state.mode`, then `G.net.start({mode})`.
  On `'net:start' {mode}` every peer sets the mode, closes the lobby and emits `ui:start` (clients have no gesture,
  so they get the existing "Click to capture the mouse" line).
- **HUD while `G.net.online`**: teammate plates under the radar (pilot dot or rig diamond, name, health bar,
  distance, red blinking DOWN) from `G.net.peers` and each peer's `.ent`; cyan world markers over teammates (red,
  pulsing, "Down · n m" when down); cyan teammate blips on the radar from team-0 `remote` entities; "E / Hold to
  revive NAME" with a progress bar from `state.player.revive {ent, progress}`; a "YOU ARE DOWN" banner with the
  spectated name and "LMB — Next teammate" when `state.player.mode === 'down'` (PLAYER's own prompt for that is
  suppressed; no debrief until `game:over`); HOST tag, room code and ping in the score block; the feed prefixes a
  name when a `score` event carries `name`, `by` or `player`. Down state is read from `peer.down`, `peer.ent.down`
  or `peer.state.down / .mode === 'down'`.
- **Pause online**: boot.js still pauses on Esc / lost pointer lock, so I bounce it (`ui:resume` in the same tick)
  and show the pause card as an overlay over the running game: lighter scrim, Restart and Rig Bay hidden, Title
  reads "Leave game" (calls `G.net.leave()` then `ui:title`). Resume or Esc closes it and re-requests the lock.
  `game:pause` + `game:resume` therefore fire once per overlay open while online.
- **Perk picker online**: `G.timeScale` is left at 1; offline it still drops to 0.05. Digits are swallowed with
  `input.consume` now.
- The Phase B Esc-in-bay re-pause workaround is removed (boot.js now skips its Esc mapping while the bay is open).
- Demo: `ui=lobby` (`uis=host|join|error|unavailable`), `ui=coop` (three teammates, one down and being revived;
  `uis=down` for the spectating banner). The fake net lives in `ui_demo.js`.
- Checked with `--eval` and a spy `G.net`: a 2-character code is refused locally; Join calls `join('AB1D', 'Ada L.')`;
  a failed join shows `G.net.error`; Leave calls `leave()`; Create calls `create('Ada L.')`; the host picking
  Operation and pressing Start calls `start({mode:'operation'})` and writes `state.mode`; a non-host has no Start;
  `net:start` moves the phase to `playing`; `ui:pause` while online leaves the phase `playing` with the card and
  the HUD both visible and the clock still running; the perk picker leaves timeScale at 1 online, 0.05 offline.
- Read against the real `src/net.js` / `net_players.js` once they appeared, and adjusted: the rig name also reads
  `peer.lo` (NET's loadout object); `net:start` no longer emits `ui:start` itself because net.js emits
  `ui:start` / `ui:restart` right after it (I only start on the next tick if the phase is still `title`); a
  `net:closed` with reason `'left'` (our own Leave) is not shown as an error; downed puppets have `alive = false`,
  so the radar keeps them when `ent.down`; the "Back in the fight" toast ignores remote `player:revived`.
- With the real NET (`harness/ui_net.js`) in this sandbox the relay is unreachable, so `available()` resolved
  false and the lobby showed the "needs the web version" notice with the link: that path is confirmed end to end.
- Not run: two real pages against a relay. The lobby and co-op HUD have only been exercised with the fake net and
  a spy; the points above come from reading NET's code.

## Co-op fixes (after first playtest)
- **Deploy overlay**: while playing online with the mouse not captured and no `fallbackLook`, a full-screen
  "DEPLOY — Click to take control" plate sits over the running game (world and HUD visible behind). A click, Enter
  or Space calls `input.lock()` + `audio.unlock()` and hides it; if the lock does not arrive within 0.8 s it comes
  back. This covers a client when the host presses Start and anyone after Esc. Offline keeps the small
  "Click to capture the mouse" line. It is not shown under the pause card, the debrief or the victory card.
- **Roles online** (`G.ui.paintRoles()`, refreshed on `net:*` events and screen changes):
  client pause card = Resume + "Leave game"; client debrief = "Leave game" + "Waiting for host to restart" (no
  Retry, Enter does nothing); host pause card = Resume + Restart + "Back to lobby"; host debrief = Retry +
  "Back to lobby". Rig Bay is hidden on the pause card for everyone online. "Leave game" calls `G.net.leave()`
  (net.js then sends that player to the title); "Back to lobby" emits `ui:title`, which net.js turns into
  everyone-to-lobby, and the lobby screen opens by itself when the title phase arrives with `net.status === 'lobby'`.
- **Pause online**: the bounce workaround is gone. boot.js ignores `ui:pause` online, so I listen for `ui:pause`
  and show the pause card as an overlay; Resume or Esc closes it. No `game:pause` / `game:resume` fire online.
- Demo: `ui=coop&uis=deploy`, `ui=coop&uis=clientover`.
- Checked with `--eval` and a spy net: client start shows the overlay and not the small line; clicking it calls
  lock and audio unlock once each and hides it, and it returns while the lock is still absent; `ui:pause` online
  keeps the phase `playing` and shows the card; client and host see the button sets above; client Leave calls
  `leave()` and lands on the title; host Retry returns to `playing`; host Back to lobby lands on the title phase
  with the lobby open and no `leave()` call.

## Debug params
- `ui=title|hud|rig|pause|over` forces the screen with fake state (fake weapons, 10 fake entities, lock in
  progress + completed lock, missile warning, toasts, damage arcs, ace marker, kill feed).
- `uis=ready|drop|wait|low|inter|hot|tips` sub-state for `hud` / `rig`.
- `tips=1` replays the first-run tips. Harness only: `bg=bright|dark|fire`.

## Small frames, motion, cost
- Root size `clamp(12px, .9vmin + 6.5px, 20px)`; side gutters `max(16px, 2.4vmin, env(safe-area-inset-*))`.
  Below 900 px the title stacks and key-hint strip hides; below 760 px the bottom cluster stacks (meter, weapons,
  vitals), the radar shrinks and the feed keeps two rows. Menus scroll inside their card, never the page.
- `prefers-reduced-motion`: CSS animations/transitions collapse, radar pulse and marker scale effects stop.
- Cost: `hud.update` measured in the harness at 0.03 ms steady, 0.25 ms with every instrument animating
  (2000-call average). Writes are cached per element; the radar redraws every second frame from a pre-rendered dish.

## Tuning knobs
`RADAR_RANGE` and pool sizes at the top of `ui_hud.js`; tip text and `CAUSE` strings in `ui.js`; colours come from
the shell tokens (`--kt-cyan/amber/red/ink`); plate opacity `--plate` and text outline `--sh` in `ui_css.js`.

## Checked
- Screenshots at 1280×720, 1920×1080 and 420×800 for every screen, plus white / black / orange backdrops
  (`shots/ui-r*-*.png`).
- `--eval`: clicking Start moves `G.state.phase` title → playing, HUD shown, cursor hidden; Esc pauses; slider,
  quality and invert-Y changes land in `G.state.settings`, `G.quality.tier` and localStorage; Resume returns to
  playing; `player:dead` shows the debrief.
- `harness/ui_int.js` with the real player / combat / enemy: real weapon names, prompts, waves, ace marker,
  damage arcs and tips all show, no console errors.

## Known issues
- `dist/full-ui.html` builds, but `tools/shot.mjs` timed out taking its screenshot here (software GL, 30 s
  limit), so the UI has not been looked at over the real renderer's bloom and sky. Legibility was tested on flat
  white, black and orange instead.
- No real pointer lock in headless, so the lock / fallback paths are exercised by code reading only.
- Programmatic keyboard traversal is ours (see Keyboard); if core.js stops swallowing Tab, both would fire.
- Long weapon names ellipsise on the card below ~17 characters (e.g. "Lancet Launcher" fits at 1280, clips at 420).
- UI does not write `state.wave.bestWave` (ENEMY owns `state.wave`); the title shows `max(localStorage, bestWave)`.
- The HUD hides at once on `game:over`, so the last damage flash is not seen behind the debrief.

## Requests for lead
- `shell.html` has no `<meta charset="utf-8">`. esbuild escapes strings but not regex literals, so a raw "—" in a
  regex was mis-decoded when the page was opened from `file://`. I now use `\u` escapes; a charset meta would
  protect everyone.
- core.js `preventDefault`s Tab / Space / arrows even in menus. Limiting that to phase `playing` would let native
  focus traversal work and I could delete my own.
- boot.js: skip the Esc / P -> `ui:resume` mapping while `state.bay.open`, so I can drop the re-pause workaround.
- boot.js: a `won` phase (or at least no auto-pause after `game:won`) would remove the victory-card workaround.
- core.js: a supported way to consume a key (so 1/2/3 in the perk picker do not also reach PLAYER) instead of popping `input._q`.
- Consider not pausing on `pointerlock` loss when `auto=1` is absent but the lock was never granted (currently fine
  because no event fires in that case).
