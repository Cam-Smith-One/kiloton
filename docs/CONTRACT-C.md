# KILOTON — Phase C addendum: operations (missions) and progression

Read with CONTRACT.md and CONTRACT-B.md. New lead files (read-only): `src/progress.js` (`G.progress`: salvage,
unlock costs, field perks, `mult(key)`), `src/baseline/mission.js`. New module **`G.mission`** (agent MISSION owns
`src/mission.js`, `src/mission_*.js`, `harness/mission*.js`, `notes/mission.md`, `shots/mission-*.png`), initialised
after `enemy`, updated after `enemy`. New state `G.state.mode: 'survival' | 'operation'` (writer: UI, on the title screen).

## C1. Game modes
- **Survival** (existing): endless waves. After each `wave:clear`, `progress.offerPerks()` offers 3 field perks.
- **Operation "Blackout"**: a authored four-stage mission in Halden Yard with a win state. ENEMY's wave director is
  idle in this mode (`state.mode === 'operation'`); MISSION spawns everything through `G.enemy.spawn(kind, x, z, opts)`.

## C2. MISSION — Operation Blackout
`G.mission = { active, stage, objectives[], markers[], start(), reset(), update(dt), fail(reason) }`.
`objectives[]`: `{ id, text, sub, kind:'destroy'|'defend'|'reach'|'kill'|'survive', progress 0..1, count, total,
timer (s remaining or null), done, failed, x, y, z (world marker or null) }` — the HUD renders these as given.
Bus: `'objective:new' {objective}`, `'objective:update'`, `'objective:done' {objective, salvage}`,
`'mission:stage' {n, title, text}`, `'mission:won' {stats}`, `'mission:failed' {reason}` (then emit `'player:dead'
{cause:'mission'}` so the run ends through the normal path; on a win emit `'game:won'` and let UI show the debrief).
Stages (tune freely; target 12–18 minutes, clearly escalating, every stage shows off destruction):
1. **Cut the signal** (on foot): three Vanta jammer pylons stand at spread-out plazas/intersections (build them
   into the grid at mission start from voxels: `armor_enemy` lattice mast ~12 m with a glowing `neon_orange` core,
   sandbag/`barrier` ring; register each as an objective whose progress is the fraction of its voxels destroyed —
   blow the base and it falls). Guarded by infantry squads and a tank at the last. Rockets, cover and the Seeker matter.
2. **Hold the relay**: the rig meter is granted full; a friendly relay (a team-0 `prop` entity with hp inside a
   voxel housing on the central plaza) must survive 150 s of attacks from several directions (infantry, drones,
   tanks shelling it, then a Vanta rig). Fail if it dies.
3. **Breach the citadel**: one tall building is the Vanta command post (pick it at start; fortify it with
   `armor_enemy` plating on the lower floors, rooftop turrets as `turret` entities, a glowing core room mid-height).
   Objective: destroy the core (bring the building down or cut your way in). Gunships defend.
4. **Dreadnought**: the boss drops — `G.enemy.spawn('emech', x, z, { variant:'dreadnought' })` (ENEMY/MODELS add
   it: 2× heavy size class, ~9000 hp, phases; until it exists fall back to `variant:'heavy'` with boosted hp).
   Killing it wins the operation.
Between stages: a short lull, a `ui:message` briefing line, `progress.offerPerks()` via `'objective:done'`.
Checkpoints: none (single life), but the rig meter refills at each stage start. Debug: `mode=operation`, `stage=N`.
Also in survival mode MISSION may add light optional objectives (e.g. "Level the Vanta supply depot" bonus).

## C3. ENEMY
- When `state.mode === 'operation'` the wave director does not run; `spawn()` works as usual and counts nothing
  toward waves; expose `G.enemy.spawnGroup(list, x, z, opts)` and `G.enemy.clearAll()`; `opts.target` (entity)
  makes a unit attack that entity instead of the player (relay defence), `opts.hold` keeps a unit near its post.
- New kinds: `turret` (static emplacement entity, team 1, e_chain or e_rpg) and `emech` variant `'dreadnought'`
  (boss: three phases — ranged siege, shielded advance with drone escorts, enraged melee with jump-slams that
  level buildings; clear tells; limbs tearable only in phase 3).

## C4. PLAYER
Apply `G.progress.mult(k)` everywhere it belongs (keys: rigArmor, cool, rigSpeed, melee, jet, blast, energy,
pilotHp, meter, mag, shield); re-apply when `'perk:taken'` fires (plating also repairs). Refuse to drop a loadout
that is not `progress.loadoutUnlocked(lo)` (message). `'game:won'` → stop input, victory camera orbit.

## C5. UI
- Title: mode select (Survival / Operation Blackout with a one-line brief), salvage total.
- Rig Bay: locked chassis/modules show a lock and price; an "UNLOCK — n" action spends salvage
  (`progress.unlock(id)`); a loadout containing locked parts cannot be set as the drop.
- HUD: objective tracker (top-left under the radar: title, sub, progress bar or count, timer), world markers and
  radar blips for `G.mission.markers` / objectives with positions, stage banner on `'mission:stage'`, relay
  health bar while defending, boss health bar for the dreadnought (name plate, phases), salvage ticker on `'salvage'`.
- **Perk picker** on `'perk:offer'`: three cards (name, text), pick with click or 1/2/3; the game pauses via
  `ui:pause`-free slow motion (`G.timeScale = 0.05`, restore to 1 on pick) so it works without leaving pointer lock;
  auto-picks nothing; shows taken perks as small icons afterwards.
- Debrief: victory variant on `'game:won'`; show salvage earned this run (`progress.runSalvage`).
- Debug: `ui=objectives|perks|boss|won`.

## C6. MODELS / COMBAT / AUDIO / FX (small)
MODELS: `emech` variant `'dreadnought'` (original design, towering, asymmetric, visibly different phases via
setDamage), `turret` kind, a `relay` prop model. COMBAT: `e_turret`, dreadnought weapons (`e_siege` with a long
tell, `e_swarm`). AUDIO/FX: stingers and effects for objectives, perk pick, boss phases, victory.
