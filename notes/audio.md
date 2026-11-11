# AUDIO — notes

Everything is synthesised with the Web Audio API at run time. No samples, no files, no AudioWorklet /
ScriptProcessor. **I have not heard any of it**: this environment has no audio output, so the work
was verified structurally and numerically (below). Round 1 was playtested on speakers by the user ("a bit
light on"); round 2 answers that and is again unheard. The tables under "Verification" are round 1; the
round 2 before/after table is in its own section. The mix needs a listening pass on real speakers; the
audition board (`dist/h-audio.html?auto=1&panel=1`) is there for that.

## Files

| File | What |
|---|---|
| `src/audio.js` | Engine: context, master chain, reverb, spatialisation, voice limiting, loops, bus wiring, music state selection |
| `src/audio_synth.js` | `SOUNDS[name](ctx, dst, t, opts) → seconds`: 83 one-shot recipes on any `BaseAudioContext`; node kit; cached noise buffers |
| `src/audio_music.js` | `createMusic(ctx, dst, reverbIn)`: adaptive score, 16th-note lookahead scheduler |
| `harness/audio.js` | Harness, test suite `window.AT`, audition board |

## Engine

- `unlock()` creates the `AudioContext` lazily and resumes it; safe to call repeatedly. Before unlock, and with
  `?mute=1` (no context is ever created), every call is a silent no-op. As a safety net `init()` also unlocks on
  the first `pointerdown` / `keydown` anywhere, so audio works even if the UI forgets to call `unlock()`.
- Graph: voice → `[gain → low-pass → stereo pan]` → SFX bus → master → compressor (−16 dB, 4:1) → limiter
  (−4 dB, 20:1, 1 ms) → soft-clip waveshaper (hard ceiling 0.97) → destination. Music layers → duck → music bus →
  master. Shared "city" convolution reverb: 2.4 s impulse built in code (facade slap-backs at 60–370 ms, then a
  tail that darkens with time); each voice has its own send, which grows with distance.
- Spatialisation is computed once per one-shot when it starts (no per-frame work per voice): distance
  attenuation `ref/(ref+d)` with a per-sound reference distance, low-pass `20 kHz·e^(−d/55 m)` (floor 420 Hz, a
  further ×0.65 behind the listener), stereo pan from the camera's right vector, and a speed-of-sound start
  delay `d/343 s` (capped 1.2 s) beyond 10 m. Distant explosions also get `lag = 2 ms/m` (max 0.4 s) between
  the crack and the sub/body, so they arrive as crack-then-boom.
- **Listener**: orientation from `G.camera`; position is the camera pulled 40 % towards `state.player.ent`, so the
  high rig chase camera does not make the rig's own surroundings sound 15 m away. Sounds flagged `own`
  (the player's weapons, steps, punches) play at full level with no delay and a narrowed pan.
- Voice limiting: 19 families, each with a voice cap and a minimum gap between starts (table `FAMDEF` in
  `audio.js`); when a family is full the oldest voice is faded out in ~12 ms and replaced. Global cap 56
  voices (explosions, collapses, big set pieces and stingers are exempt). Finished voices are disconnected by a
  sweep in `update()`; every source node also disconnects its own chain in `onended`.
- Continuous sounds are persistent nodes built once at unlock; `update()` only moves their parameters, and
  only when the target actually changes: player jet roar (two bands; thinner for the pilot jetpack), nearest
  other jet, nearest rocket in flight (from `G.combat.projectiles`, band shifts with closing speed), rig
  reactor hum (follows speed), Skylance solid lock tone, city wind bed.
- Repeating cues are timed on the audio clock: Skylance locking beeps (0.30 s → 0.09 s apart and rising in pitch
  with `state.player.lock.progress`, then the solid tone on `locked`), incoming-lock warning while
  `lock:warning {on:true}`, heartbeat below 35 % pilot health (faster as it drops), two-tone armour alarm below
  35 % rig armour.
- Volume: follows `state.settings.volume` / `.music` whenever they change, and `setVolume(master, music)`.
  Both are squared for a perceptual taper. Big explosions, slams and landings duck the music briefly. The pause
  menu muffles the music (650 Hz low-pass, −4 dB).

## Music

D minor, 126 bpm in play (title 96, inbound 132, defeat 72). Five layers — pad, bass, drums, brass, arp —
crossfaded by state; chords change every bar over a four-bar phrase. Bass and arp are persistent monosynths
driven purely by scheduled automation; drums, pad chords and brass are short voices scheduled 0.3 s ahead
(a 120 ms `setInterval` keeps scheduling if frames stall).

| State | When | Harmony | Character |
|---|---|---|---|
| `title` | phase `title` | Dm9 – B♭maj7 – Gm9 – A7sus | pads, slow arp, heartbeat kick |
| `foot` | playing, on foot | Dm – Dm7 – B♭ – C | 16th-note bass pulse, sparse kick/hat; snare, busier hats and arp come in with intensity |
| `inbound` | `mech:incoming {team:0}` / `player.mechIncoming > 0` | A7 pedal (dominant) | pedal bass crescendo, snare roll 8ths → 16ths → 32nds, arp climbing an octave per third, rising saw/noise riser timed to `eta` |
| `rig` | `player.mode === 'mech'` | Dm – F – B♭ – A | heavy kick/snare, metal clanks, tom fills, sub hit on the phrase downbeat, low brass stabs, horn line at high intensity |
| `intermission` | `wave.intermission > 0` or wave cleared | B♭add9 – F – Cadd9 – Dm7 | release: pads, light arp, one kick a bar |
| `defeat` | phase `over` / mode `dead` | Dm – Gm/D – B♭ – A | slow descending horn, low tom |

`mech:land {team:0}` calls `music.hit()`: the riser is cut and a stacked D hit + sub + wash lands on the impact,
and the phrase restarts on its downbeat. Intensity (0..1) = enemies alive + a "heat" value fed by shots,
explosions, collapses and damage taken, decaying over ~14 s.

## API beyond the contract

- `G.audio.names` — every `play()` name (below). `G.audio.musicStates`.
- `play(name, { x,y,z, vol, pitch, own, floor, nodelay, …recipe options })` → duration in seconds (0 if dropped).
  Without `x` the sound is non-positional. `own:true` = the player's own gear. `floor` = minimum level as a
  fraction of the sound's base gain regardless of distance (used for rig drops and self-destructs).
  Recipe options: `size` (explosion ≈ radius/10; collapse, crumble, glass, debris, slam 0..1), `kind`
  (explosion: `rocket|shell|pulse|mech|slam|grenade`), `alt` (pulse barrel 0/1), `hit` (punch), `dur`
  (`rig_drop_incoming`, `jet`, `lock_tone`), `pulse:true` (impacts: adds electric sizzle).
- `G.audio.stats { voices, peakVoices, played, dropped, stolen, nodes, state, music }`.
- `G.audio.forceMusic = 'rig' | … | null` (look-dev override), `G.audio.intensity` (read), `G.audio.heat = x` (write).
- `G.audio.renderOffline(name, opts, seconds)` and `renderMusicOffline(state, seconds, intensity)` →
  `Promise<AudioBuffer>` through the full master chain (tests). `buildGraph(ctx)` is exported from `audio.js`.

### play() names (83)

Player weapons: `rifle rocket_launch grenade pulse overheat salvo_rocket salvo skylance_launch rocket_flyby
lock_beep lock_on lock_tone lock_lost reload reload_heavy weapon_empty weapon_ready`
Vanta weapons: `e_rifle e_rocket e_shell e_drone e_chain e_pulse`
Impacts: `impact_concrete impact_metal impact_glass impact_wood impact_dirt impact_soft impact_armor whiz`
Destruction: `explosion collapse crumble glass_shatter debris_concrete debris_metal debris_glass debris_wood
debris_dirt levelled`
Rig: `footstep_rig punch_windup punch jet_ignite jet_off jet slam dash grab throw rig_drop_incoming rig_land
board eject selfdestruct_alarm selfdestruct damage_rig alarm_low`
Pilot: `footstep_pilot jetpack damage_pilot heartbeat`
Kills: `soldier_down drone_down wreck hit_confirm kill_confirm`
Cues: `rig_ready wave_start wave_clear enemy_drop ace_warning ace_called lock_warning defeat`
UI: `ui_click ui_hover ui_back ui_start ui_pause ui_resume ui_msg`

### Bus events handled

`shot` (by `weapon`: rifle, launcher, grenade, pulse — alternating pitch per shot —, salvo, skylance, e_rifle,
e_rpg, e_shell, e_drone, e_chain, e_gsrocket, e_pulse, e_salvo; unknown ids fall back by team), `tracer`
(near-miss whiz for enemy fire passing within ~5 m), `impact` (by `MAT[mat].sound`, or flesh/armour when `ent`
is set), `explosion`, `voxels:destroyed` (glass → shatter, ≥ 6 voxels of anything else → crumble), `collapse`,
`debris:impact`, `building:levelled`, `ent:damage` (player hurt / hit confirm), `ent:death`, `footstep`, `punch`,
`slam`, `jet`, `dash`, `mech:incoming`, `mech:land`, `mech:enter`, `mech:eject`, `mech:selfdestruct`, `grab`,
`throw`, `weapon:reload|overheat|empty|ready` (player's only), `lock`, `lock:warning`, `meter:ready`,
`ace:charging` (at most every 2.2 s), `ace:called`, `wave:start`, `wave:clear`, `ui:message`, `game:start`,
`game:pause`, `game:resume`, `game:over`, `ui:title`.

Not covered by an event (callers use `play`): UI button clicks/hover (`ui_click`, `ui_hover`), the punch
wind-up (`punch_windup`, if PLAYER wants the tell before the `punch` event).

## Debug params

- `mute=1` — no AudioContext at all.
- Harness only: `panel=1` — audition board (click = at the listener, shift+click = 80 m away, music state and
  intensity buttons, live stats).

## Verification (headless Chromium, no audio device)

Run: `node build.mjs harness/audio.js h-audio --dev`, then
`node tools/shot.mjs dist/h-audio.html shots/audio-01.png --q "auto=1" --eval "AT.events()"` (also `AT.names()`,
`AT.stress(3)`, `AT.idle(4,'rig')`, `AT.offline()`, `AT.music(16)`, `AT.rhythm('rig')`, `AT.muteCheck()`).

Structural, live `AudioContext` (state `running`):
- 126 bus emissions covering every event in section 7 with plausible payloads, plus 21 empty/undefined
  payloads: **0 exceptions, 0 console errors**. Most nodes created by one event: 72 (`collapse`); `mech:land` 70
  (including the music hit), `mech:selfdestruct` 56, explosions 29–47, a gunshot 12–17, an impact 11–22.
- All 83 names play near and far with no errors; every name has a table entry and vice versa.
- Firefight stress, 3 s: about 430–770 events/s offered (it varies with the frame rate). Voices peaked at 57
  (cap 56 + exempt families). In the two runs: 352 and 259 sounds played, 2041 and 1079 dropped, 191 and 83
  stolen, 2240 and 1671 nodes/s. 9 s later: **0 voices, every family counter back to 0**.
- `update()` cost: 0.01–0.02 ms idle with music running; 0.06 ms and 0.70 ms average in the two stress runs
  (the second on a loaded machine; the cost there is disconnecting finished voices).
- Music node creation: rig ≈ 70–80 nodes/s, foot ≈ 35–40, title ≈ 6–10.
- State selection followed the game state: foot → inbound (on `mech:incoming`) → foot (landed, not boarded) →
  rig → intermission → foot → defeat → foot (restart) → title. Heartbeat, lock beeps and lock warning repeat
  while their condition holds and stop after.
- `?mute=1`: no context, `play()` returns 0, `unlock()` returns false, no errors.

Numerical, `OfflineAudioContext` 44.1 kHz through the master chain (dry, base gain). Peak / RMS are linear full
scale; duration is to the last sample above −54 dB; bands are the share of energy below 150 Hz / 150–600 Hz /
600 Hz–4 kHz / above 4 kHz. **No NaN in any render.**

| Sound | Peak | RMS | Dur s | Centroid Hz | sub / low / mid / high % |
|---|---|---|---|---|---|
| rifle | 0.783 | 0.0156 | 0.25 | 3509 | 6 / 58 / 9 / 26 |
| pulse | 0.842 | 0.0234 | 0.2 | 565 | 56 / 18 / 24 / 2 |
| e_pulse | 0.834 | 0.0482 | 0.27 | 537 | 13 / 70 / 16 / 0 |
| e_rifle | 0.377 | 0.012 | 0.17 | 742 | 1 / 74 / 22 / 3 |
| rocket_launch | 0.774 | 0.0352 | 0.7 | 2649 | 58 / 10 / 13 / 19 |
| e_rocket | 0.684 | 0.0288 | 0.44 | 2166 | 64 / 6 / 14 / 15 |
| skylance_launch | 0.711 | 0.0242 | 0.46 | 1761 | 23 / 18 / 50 / 9 |
| salvo (6 rockets) | 0.815 | 0.0669 | 0.83 | 1709 | 68 / 11 / 8 / 13 |
| e_shell | 0.829 | 0.0731 | 1.13 | 287 | 73 / 21 / 5 / 1 |
| overheat | 0.793 | 0.0731 | 1.62 | 9358 | 0 / 16 / 13 / 72 |
| explosion, size 0.15 | 0.84 | 0.0629 | 1.15 | 340 | 63 / 26 / 10 / 1 |
| explosion, size 0.4 | 0.856 | 0.0798 | 1.8 | 282 | 65 / 26 / 8 / 1 |
| explosion, size 0.8 | 0.848 | 0.1039 | 2.61 | 186 | 80 / 15 / 5 / 1 |
| explosion, size 1.6 | 0.859 | 0.1299 | 4.42 | 220 | 72 / 20 / 7 / 1 |
| explosion, 0.3 s lag | 0.833 | 0.0984 | 2.52 | 317 | 76 / 16 / 7 / 1 |
| collapse, size 1 | 0.824 | 0.1802 | 5.46 | 272 | 76 / 15 / 7 / 1 |
| crumble | 0.282 | 0.0168 | 0.77 | 929 | 34 / 32 / 29 / 6 |
| glass_shatter | 0.562 | 0.0192 | 0.82 | 8624 | 0 / 0 / 8 / 92 |
| debris_concrete | 0.401 | 0.0072 | 0.19 | 1807 | 4 / 22 / 66 / 8 |
| debris_metal | 0.478 | 0.0184 | 0.39 | 1234 | 0 / 64 / 33 / 3 |
| debris_glass | 0.285 | 0.0089 | 0.22 | 5345 | 0 / 0 / 44 / 55 |
| impact_concrete | 0.288 | 0.0061 | 0.14 | 7363 | 1 / 5 / 38 / 56 |
| impact_metal | 0.489 | 0.0103 | 0.17 | 3887 | 0 / 0 / 67 / 33 |
| impact_glass | 0.386 | 0.0068 | 0.07 | 9199 | 0 / 0 / 1 / 99 |
| impact_wood | 0.349 | 0.0074 | 0.06 | 433 | 0 / 95 / 4 / 0 |
| impact_dirt | 0.37 | 0.0102 | 0.11 | 291 | 72 / 21 / 6 / 2 |
| footstep_rig | 0.797 | 0.0478 | 0.39 | 102 | 91 / 7 / 2 / 0 |
| footstep_pilot | 0.13 | 0.0021 | 0.05 | 1811 | 3 / 17 / 70 / 10 |
| punch (hit) | 0.834 | 0.0547 | 0.53 | 747 | 70 / 16 / 10 / 4 |
| slam | 0.853 | 0.0944 | 1.65 | 142 | 86 / 10 / 4 / 0 |
| dash | 0.564 | 0.0306 | 0.4 | 769 | 64 / 7 / 25 / 4 |
| jet (1.2 s) | 0.794 | 0.1077 | 1.2 | 431 | 58 / 27 / 12 / 2 |
| rig_drop_incoming (4 s) | 0.812 | 0.1508 | 4.03 | 279 | 56 / 26 / 18 / 0 |
| rig_land | 0.846 | 0.1385 | 2.84 | 351 | 76 / 16 / 6 / 2 |
| board | 0.816 | 0.1748 | 2.52 | 275 | 81 / 9 / 9 / 1 |
| eject | 0.828 | 0.1128 | 1.45 | 1427 | 5 / 2 / 85 / 8 |
| selfdestruct | 0.84 | 0.145 | 5.1 | 213 | 78 / 16 / 5 / 1 |
| heartbeat | 0.702 | 0.0394 | 0.37 | 52 | 99 / 1 / 0 / 0 |
| lock_beep | 0.28 | 0.0151 | 0.06 | 1277 | 0 / 0 / 100 / 0 |
| lock_tone | 0.262 | 0.048 | 0.67 | 1726 | 0 / 0 / 100 / 0 |
| lock_warning | 0.25 | 0.0323 | 0.21 | 1517 | 0 / 0 / 94 / 6 |
| rig_ready | 0.721 | 0.0447 | 0.78 | 692 | 34 / 15 / 51 / 0 |
| wave_start | 0.796 | 0.111 | 1.49 | 339 | 46 / 41 / 12 / 0 |
| wave_clear | 0.698 | 0.106 | 2.23 | 535 | 20 / 56 / 24 / 0 |
| defeat | 0.823 | 0.1703 | 3.2 | 229 | 52 / 39 / 9 / 0 |
| ui_click | 0.221 | 0.0035 | 0.04 | 3447 | 0 / 0 / 84 / 16 |
| wreck | 0.754 | 0.0711 | 1.28 | 338 | 11 / 84 / 5 / 0 |
| levelled | 0.739 | 0.1264 | 2.4 | 52 | 98 / 2 / 0 / 0 |
| **Pile-up**: 6 size-1.6 explosions + 6 rig landings + reverb, at once | **0.871** | 0.2335 | 3.95 | 149 | 89 / 8 / 3 / 1 |

Reading it: explosions, collapse, slam, rig steps and landings put 63–91 % of their energy below 150 Hz; glass
is 92–99 % above 4 kHz; metal sits in the mids; wood in the low mids; the player's pulse (sub thump + bright
zap) and Vanta's (low-mid square growl) have clearly different balances. The worst pile-up I could construct
peaks at 0.871, under the 0.97 ceiling.

Music, 16 s per state at the default music setting (0.6), intensity 0.8:

| State | Peak | RMS | Centroid Hz | sub / low / mid / high % |
|---|---|---|---|---|
| title | 0.446 | 0.093 | 612 | 7 / 51 / 42 / 0 |
| foot | 0.468 | 0.0793 | 450 | 47 / 28 / 25 / 1 |
| foot, intensity 0 | 0.332 | 0.0636 | 232 | 59 / 33 / 8 / 0 |
| inbound | 0.69 | 0.0983 | 1637 | 27 / 39 / 23 / 11 |
| rig | 0.68 | 0.1225 | 399 | 49 / 30 / 20 / 1 |
| intermission | 0.511 | 0.0956 | 614 | 12 / 53 / 35 / 0 |
| defeat | 0.39 | 0.0843 | 443 | 7 / 75 / 18 / 0 |

RMS per 16th-note slot, averaged over the bars of the rig theme (rhythm is there, not a drone):
`0.169 0.133 0.088 0.143 0.122 0.057 0.156 0.099 0.145 0.111 0.122 0.136 0.132 0.099 0.141 0.086`
(peaks on the kick steps, 3:1 between the loudest and quietest slot). Foot theme: `0.108 … 0.054`, 2:1.

The first balance pass had the score at 76–78 % sub-bass and roughly twice as loud; the bass, kick and overall
music gain were pulled back and pads/brass/arp raised to get the figures above. Explosions and the collapse
were also given more mid content after the first measurement (collapse went from 1 % to 7 % mid).

## Round 2 (after the first playtest: "a bit light on")

**Still unheard by me.** The changes below are measured, not auditioned.

What changed:
- **Loudness / density.** SFX bus now runs 1.5× into a tanh saturator before the master; compressor 4:1 at
  −14 dB with a 6 ms attack (transients pass), ×1.5 make-up into the limiter (−2.5 dB, 20:1), same 0.97 soft-clip
  ceiling. Constants `SFX_DRIVE`, `MAKEUP`, `OWN_BOOST`, `MUSIC_GAIN` at the top of `audio.js`.
  Note: Web Audio's compressor adds its own make-up gain, so small moves of the threshold change level a lot
  (a −24 dB threshold flattened every sound to the same peak; that was backed out).
- **Weight.** New `weight()` layer in `audio_synth.js`: sub sine + octave triangle with a pitch drop, a 130–270 Hz
  triangle/noise body and a click, summed *into* a WaveShaper. Added to explosions (all sizes), pulse cannon,
  salvo rockets, launcher, rifle (longer high-passed crack + saturated body), rig footsteps, rig landing (plus a
  second "suspension" hit), punch impact, slam, self-destruct. Collapse rebuilt: 3.6–8.2 s (was 2.6–6 s),
  saturated rumble, 38 Hz undertone, 3–7 separate storey-landing hits, then the rubble cascade.
- **Player in front.** `own` sounds get ×1.3 gain and 30 % less reverb; distant sounds keep their attenuation.
- **Ambience.** Wind bed raised, new 85 Hz city rumble loop, both scaling with a "war" level (heat, enemies
  alive, wave number). Scheduled on the audio clock: `amb_gunfire` (muffled bursts), `amb_boom`, `amb_siren`
  (7 s wail), random pan, more frequent as the fight heats up; they also run on the title screen. Fire crackle:
  explosions of radius ≥ 2.5 m (not pulse) register a burn site for 14 s + 3 s/m (8 sites, ring buffer); one
  loop follows the nearest.
- **New events.** `slide {ent,on}` → gravel scrape loop (level follows speed); `roll`, `crouch {on}`, `mantle` →
  new recipes; weapon `seeker` → `seeker_launch` (lock beeps already work on foot through `lock`);
  `ui:sound {name}` → `confirm` = `ui_confirm`, `back` = `ui_back`, `tick` = `ui_hover`, anything else `ui_<name>`
  if it exists, otherwise `ui_click`.
- **Music.** Up about 1 dB on foot and 4 dB in the rig theme (bass ×1.5 with more sub, heavier kick with a
  low-mid knock, bigger downbeat sub). To stay under the fight the music bus now drops by up to 30 % as heat
  rises, on top of the per-explosion ducking.
- New `play()` names (91 total): `seeker_launch roll crouch mantle amb_gunfire amb_boom amb_siren ui_confirm`.
  `play` also accepts `pan` (−1..1) for non-positional sounds.

Before → after, same offline method (dry, base gain, through the master chain):

| Sound | RMS before | RMS after | Change | sub-150 Hz % before → after | Peak after |
|---|---|---|---|---|---|
| explosion, size 0.15 | 0.0629 | 0.1554 | +7.9 dB | 63 → 85 | 0.870 |
| explosion, size 0.4 | 0.0798 | 0.1827 | +7.2 dB | 65 → 85 | 0.873 |
| explosion, size 0.8 | 0.1039 | 0.2208 | +6.5 dB | 80 → 90 | 0.871 |
| explosion, size 1.6 | 0.1299 | 0.2816 | +6.7 dB | 72 → 89 | 0.875 |
| pulse | 0.0234 | 0.0978 | +12.4 dB | 56 → 87 | 0.873 |
| salvo (6 rockets) | 0.0669 | 0.1771 | +8.5 dB | 68 → 84 | 0.871 |
| footstep_rig | 0.0478 | 0.1651 | +10.8 dB | 91 → 95 | 0.866 |
| rig_land | 0.1385 | 0.3042 | +6.8 dB | 76 → 92 | 0.870 |
| punch (hit) | 0.0547 | 0.1624 | +9.5 dB | 70 → 89 | 0.869 |
| slam | 0.0944 | 0.2573 | +8.7 dB | 86 → 95 | 0.868 |
| selfdestruct | 0.145 | 0.314 | +6.7 dB | 78 → 93 | 0.874 |
| collapse, size 1 | 0.1802 | 0.5034 | +8.9 dB | 76 → 88 | 0.882 |
| rifle | 0.0156 | 0.0649 | +12.4 dB | 6 → 68 | 0.874 |
| rocket_launch | 0.0352 | 0.1131 | +10.1 dB | 58 → 82 | 0.873 |
| e_pulse (unchanged recipe) | 0.0482 | 0.0832 | +4.7 dB | 13 → 10 | 0.872 |
| ui_click | 0.0035 | 0.0086 | +7.8 dB | 0 → 0 | 0.585 |
| Pile-up (6 huge explosions + 6 landings + reverb) | 0.2335 | 0.4972 | +6.6 dB | 89 → 92 | 0.867 |
| music: foot | 0.0793 | 0.0892 | +1.0 dB | 47 → 45 | 0.566 |
| music: rig | 0.1225 | 0.1996 | +4.2 dB | 49 → 66 | 0.863 |
| music: title | 0.093 | 0.1101 | +1.5 dB | 7 → 6 | 0.552 |

Sounds that were not rebuilt gained roughly 5–8 dB from the bus alone; the rebuilt ones 6.5–12.5 dB. No NaN in
any render; the highest peak anywhere is 0.882 against the 0.97 ceiling, so nothing clips. Rig-theme rhythm
still has a 2.9:1 swing between 16th-note slots (0.277 / 0.097).

Structural re-run (live context): 142 bus emissions including the new events and malformed payloads, 0
exceptions; all 91 names play. Stress, 3 s, ~830 events/s offered: 320 played, 2267 dropped, 171 stolen, peak
57 voices, 0 voices and all family counters at 0 nine seconds later, `update()` 0.026 ms average.
`node build.mjs src/main.js full-audio --dev` bundles; I did not re-run the full game at runtime this round.

Costs and caveats of round 2:
- Heavier sounds create more nodes: rifle 28 (was 13), pulse 34 (17), rocket explosion 51 (37), `mech:land`
  93 (70), **collapse 172 (72)**. Collapse is capped at 2 voices and one start per 0.4 s. Stress node rate rose
  to about 3100/s (was 1700–2200).
- The mix is now very sub-heavy by energy (85–95 % below 150 Hz for the big hits; the pulse cannon is 87 %).
  That is what "weight" measures like, but on small speakers the low-mid body and click carry it, and that
  balance is the first thing to check by ear. The pulse's zap layer was raised once for this reason.
- The rig theme in isolation (RMS 0.20) is about as loud as a medium explosion (0.18); in a fight the heat
  drop and ducking pull it down by up to ~3 dB plus the duck. If it still crowds the SFX, lower `MUSIC_GAIN`
  or the rig bass mix (`STATES.rig.mix[1]`).
- Fire sites are guessed from explosions, not from anything actually burning; FX may show fire elsewhere.
- Ambient gunfire, booms and sirens are not positional (random pan) and do not correspond to real enemies.

## Round 3 — Rig Bay (Phase B) and campaign (Phase C)

**Unheard, as before**: measured only. 132 `play()` names now.

New `play()` names:
- Weapons: `autocannon autocannon_wind lance_start lance_stop siege recoil swarm_launch swarm mortar mortar_split`
- Equipment / brawling: `shield_up shield_down shield_hit shield_break grapple_fire grapple_latch grapple_miss
  grapple_release limb_torn finisher_grab finisher brace_on brace_off airdash charge_mount charge_planted hijack`
- World: `fire_start`. Rig Bay UI: `bay_fit bay_paint bay_open`.
- Campaign: `objective_new objective_done stage_banner perk_offer perk_pick salvage boss_arrive boss_phase
  victory mission_failed`.

Events → sounds:

| Event | Sound |
|---|---|
| `shot` autocannon / lance / siege / swarm / mortar / mortar_b | `autocannon`, `lance_start` (once per burst), `siege`, `swarm_launch` (one per missile = the ripple), `mortar`, `mortar_split` (once per shell, at the split point) |
| `shot` e_turret / e_siege / e_swarm | existing Vanta recipes re-pitched (`e_chain` ×1.25, `e_shell` ×0.7, `e_rocket` ×1.45) |
| `impact` with weapon `lance` | nothing (10 ticks/s; the sizzle loop covers it) |
| `weapon:recoil {strength}` | `recoil`, scaled; strength ≥ 1 ducks the music |
| `shield {on, broken}` / `shield:hit {amount}` | `shield_up` / `shield_down` / `shield_break`; `shield_hit` |
| `punch {bash}` / `{heavy}` or combo ≥ 3 | punch + low `shield_hit`; lower, louder punch |
| `grapple {state}` | reel / pull / yank: `grapple_fire` + `grapple_latch` at the hook; miss: `grapple_fire` + `grapple_miss`; clinch: `grapple_latch`; release: `grapple_release` |
| `limb:torn`, `finisher {state}` | `limb_torn`; start = `finisher_grab`, slam = `finisher` (on top of the `slam` and `explosion` PLAYER also emits) |
| `brace {on}` | `brace_on` / `brace_off` |
| `dash {air}` or own chassis harrier | `airdash` instead of `dash` |
| `charge:mount`, `charge:planted` | `charge_mount`; `charge_planted` (beeps closing up across the 0.8 s fuse) |
| `mech:hijack` | `hijack` |
| `fire:start` | `fire_start` (at most every 0.5 s) |
| `bay:open` / `bay:close` | `bay_open` / `ui_back` |
| `bay:preview {loadout}` | compared with the previous loadout: chassis changed → big `bay_fit`, paint changed → `bay_paint`, anything else → small `bay_fit` (at most one per 90 ms, so the plating slider ticks rather than machine-guns) |
| `bay:changed {active}` when `active` changes | `ui_confirm` (set as drop / keys 1-2-3) |
| `objective:new`, `objective:done`, `mission:stage` | `objective_new`, `objective_done`, `stage_banner` |
| `perk:offer`, `perk:taken` | `perk_offer`, `perk_pick` |
| `salvage {amount}` | `salvage`, pitch climbing while ticks keep arriving within 1.2 s |
| `ent:add` with `variant:'dreadnought'` or `boss:true`; also `boss:spawn` / `boss:arrive` | `boss_arrive` (once per 6 s) |
| `boss:phase {phase}` | `boss_phase` |
| `game:won` (and `mission:won` sets the flag) | `victory`; music goes to the release theme instead of defeat, and `game:over` no longer plays `defeat` |
| `mission:failed` | `mission_failed` (the normal `defeat` follows from `game:over`) |

New persistent loops (parameters only, no node churn): autocannon motor (pitch and level from the highest
`w.spin` in `state.player.weapons`; `autocannon_wind` plays when it drops below 0.25), lance hum (while
`G.combat.beams` has an entry with `ttl > 0`; the player's at fixed level, others by distance; `lance_stop`
when the player's ends), lance sizzle at the beam's end point, shield hum (`state.player.ent.shield.on`,
level from `state.player.equip.shield.energy`), grapple winch (own reel / pull, pitch rising; times out
after 4 s), mortar whistle (nearest `mortar` / `mortar_b` projectile falling faster than 4 m/s within 90 m,
pitch dropping as it nears), fire crackle + low fire roar + gas-jet roar.

**Fire**: when `G.destruct.fires` exists (`{count, x[], y[], z[], heat[]}`) the fire loops follow it — nearest
cell sets level and pan, the total within 60 m adds a roar, at most 96 cells sampled per frame. When it is
absent the round-2 guess (recent big explosions) is used. **Gas jets**: `G.destruct.fires` has no jet flag in
the contract, so a cell counts as a jet if `fires.jet[i]` is set or `heat[i] >= 2`. If DESTRUCT's heat never
reaches 2 the gas roar will never play — see Requests.

**Footsteps by chassis** (own rig, from `state.player.chassis`; enemy steps use `e.chassis` if the event carries
it): harrier pitch ×1.3, shorter, level ×0.75; warden as before; bastion pitch ×0.78, longer, level ×1.2,
plus a 44 Hz undertone.

Measurements, round 3 (same offline method; everything from rounds 1–2 re-rendered too):

| Sound | Peak | RMS | Dur s | sub / low / mid / high % |
|---|---|---|---|---|
| footstep, harrier | 0.872 | 0.1295 | 0.38 | 91 / 8 / 1 / 0 |
| footstep, warden | 0.868 | 0.1653 | 0.53 | 95 / 4 / 1 / 0 |
| footstep, bastion | 0.863 | 0.2068 | 0.78 | 97 / 3 / 0 / 0 |
| autocannon (one round) | 0.868 | 0.0468 | 0.13 | 50 / 37 / 10 / 3 |
| lance_start | 0.875 | 0.043 | 0.25 | 34 / 36 / 23 / 7 |
| siege | 0.872 | 0.2802 | 2.7 | 90 / 7 / 2 / 0 |
| recoil | 0.873 | 0.067 | 0.72 | 67 / 30 / 3 / 0 |
| swarm (6 missiles) | 0.877 | 0.0549 | 0.61 | 9 / 61 / 16 / 14 |
| mortar | 0.864 | 0.1393 | 0.43 | 92 / 7 / 1 / 0 |
| mortar_split | 0.875 | 0.0444 | 0.23 | 35 / 19 / 11 / 35 |
| shield_up / shield_hit / shield_break | 0.87 / 0.876 / 0.87 | 0.075 / 0.049 / 0.218 | 0.56 / 0.33 / 0.99 | 72/15/13/0 · 37/15/48/0 · 48/36/13/3 |
| grapple_fire / grapple_latch | 0.868 / 0.876 | 0.046 / 0.053 | 0.31 / 0.43 | 68/19/7/6 · 36/45/19/0 |
| limb_torn | 0.872 | 0.2538 | 1.43 | 48 / 7 / 43 / 2 |
| finisher_grab / finisher | 0.881 / 0.871 | 0.168 / 0.319 | 1.13 / 1.63 | 34/50/15/0 · 94/5/1/0 |
| brace_on | 0.874 | 0.0985 | 0.78 | 80 / 5 / 3 / 13 |
| airdash | 0.872 | 0.0507 | 0.37 | 39 / 16 / 27 / 18 |
| charge_planted | 0.802 | 0.1598 | 0.82 | 0 / 0 / 85 / 15 |
| hijack | 0.871 | 0.1909 | 1.87 | 41 / 24 / 33 / 2 |
| bay_fit / bay_paint | 0.88 / 0.793 | 0.050 / 0.055 | 0.4 / 0.38 | 82/12/6/0 · 0/0/15/85 |
| objective_done | 0.879 | 0.1409 | 1.54 | 21 / 44 / 35 / 0 |
| stage_banner | 0.877 | 0.2183 | 1.93 | 69 / 23 / 8 / 0 |
| perk_pick | 0.872 | 0.1054 | 1.06 | 19 / 44 / 37 / 0 |
| salvage | 0.409 | 0.0101 | 0.09 | 0 / 0 / 99 / 1 |
| boss_arrive | 0.869 | 0.4115 | 3.83 | 76 / 20 / 4 / 0 |
| boss_phase | 0.875 | 0.2676 | 1.63 | 65 / 26 / 9 / 0 |
| victory | 0.882 | 0.2561 | 5.09 | 59 / 28 / 12 / 1 |

`boss_arrive` is the loudest sustained cue in the game: its base gain was cut from 0.7 to 0.2 and the bus
compressor still holds it at RMS 0.41 (it was 0.51). If it is too much by ear, lower the oscillator levels in the
recipe rather than the gain.

Across all 84 offline renders: **no NaN, highest peak 0.883** (ceiling 0.97). Pile-up case 0.874. Round-2 sounds
and the music re-measured within 0.002 RMS of their round-2 figures (explosion size 0.4: 0.1825; pulse 0.0987;
rig theme 0.198; foot theme 0.090).

Structural (live context): 208 bus emissions (all Phase B/C events with real-shaped and empty payloads), 0
exceptions; all 132 names play. Stress 3 s: 267 played, 1441 dropped, 117 stolen, peak 57 voices, 0 voices and
all family counters at 0 nine seconds later, `update()` 0.185 ms average during the stress. Loop test with faked
state (autocannon spin 0.8, a player lance beam, shield up, grapple reel, a falling bomblet, three fire cells one
of them at heat 2.5): every loop came up (gains spin 0.04, lance 0.09, sizzle 0.118, shield 0.08, reel 0.045,
whistle 0.047, fire 0.279, fire roar 0.061, gas 0.232) and every one returned to exactly 0 when the state was
cleared; `G.destruct.fires` undefined or `{count:0}` is handled. `full-audio` bundles; not run at runtime this round.

Not verified this round: any of it against the real PLAYER / COMBAT / DESTRUCT modules in play. The payload
shapes were read from their source and notes, and the loops were driven by faked state in the harness.

## Round 3b — fire and gas from DESTRUCT

Supersedes the fire paragraphs in rounds 2 and 3: the guessed fire sites (from explosions) and the
`heat >= 2` / `fires.jet` jet heuristic are **removed**.
- **Fire bed** reads `G.destruct.fires {count, x, y, z, heat}` every frame (at most 96 cells sampled, 70 m
  range). Crackle level = nearest cell (distance × heat) plus a term for the total; pan = the loudness-weighted
  centre of the burning cells; a low roar grows with the total. No `fires` (baseline DESTRUCT) = no fire sound.
- **Gas torches**: three loop pairs (hiss band + low roar, different noise rates) follow the three loudest
  entries of `G.destruct.jets {count, x, y, z, t}`, each with its own level and pan, fading over the last 0.6 s
  of `t`. A fourth simultaneous jet nearby is not heard separately.
- Events: `gas:jet {x,y,z,dur}` → `gas_jet` (bang, pressure shriek, catch); `fire:start` → `fire_start`;
  `fire:out` → `fire_out`. New names: `gas_jet`, `fire_out` (134 total).
- Checked in the harness with faked arrays (3 fire cells, 4 jets at different distances): fire 0.244, roar
  0.068, torches 0.31 / 0.185 / 0.067 (nearest first; the fourth, 110 m away, dropped), all back to 0 when the
  arrays empty; `fires` / `jets` undefined is handled. `gas_jet` offline: peak 0.868, RMS 0.18, 87 % below
  150 Hz. 210 bus emissions, 0 exceptions; stress peak 57 voices. `full-audio` bundles.
- **Not run against the real DESTRUCT fire sim** — only against arrays shaped like its notes describe.

## Tuning knobs

- `DEF` in `audio.js`: per sound `[family, gain, reference distance, reverb send]`.
- `FAMDEF`: per family `[max voices, min gap s, exempt from global cap]`. `MAX_VOICES`, `MUSIC_GAIN`.
- `spatial()`: attenuation law, low-pass distance constant (55 m), delay threshold (10 m), pan width (0.85).
- `buildGraph()`: compressor/limiter settings, reverb length and tap times.
- `audio_music.js` `STATES`: bpm, chords, 16-step patterns, layer mix per state; `applyMix()` layer levels.

## Known issues / limits

- **Unheard.** Levels and timbres are set from measurements and experience, not by ear. Expect the relative
  gains in `DEF` and the music mix to want a pass. The sub-heavy sounds will read weaker on laptop speakers.
- **Full-game check is a smoke test only.** `node build.mjs src/main.js full-audio --dev` bundles and, with the
  other agents' modules as they stood at the time, the game reached `playing` / wave 1 with the context
  running, the foot theme selected, 4 sounds played after about 4 s of stepped game time and one explosion,
  and no console errors. Two earlier attempts timed out while loading in software GL (`tools/shot.mjs` could
  not take its screenshot), so the one pass used a script without a screenshot. Everything else in this file
  was measured against the lead's baselines.
- A one-shot's position, pan and filter are fixed when it starts; long sounds (collapse, rig drop) do not track
  a fast-turning camera. Only the loops are re-panned each frame.
- No occlusion: a wall between you and a sound does not muffle it.
- One loop each for "nearest other jet" and "nearest rocket"; several at once are represented by the closest.
- In headless runs at ~5 real fps the frame-polled cues (lock beeps) fire less often than designed; they are
  bounded by the frame rate, not by game time.
- The inbound riser is timed in wall-clock seconds from `eta`; if PLAYER runs the drop in slow motion the riser
  peaks early and holds (it is cut on `mech:land`).

## Requests for lead

- UI should call `G.audio.unlock()` from its Start click (contract) and `G.audio.play('ui_click')` /
  `'ui_hover'` on buttons — no bus event covers those.
- `shot` payloads from COMBAT should carry `shooter` (used to tell the player's own fire from others); the
  baseline does. `footstep` has no entity, so "own" is inferred from team 0 + distance to `state.player.ent`.
- If PLAYER wants the punch tell, call `G.audio.play('punch_windup', {x,y,z, own:true})` when the wind-up
  starts; the `punch` event covers the ram and the impact.
- `ace:charging`: any emission rate is fine (I rate-limit to one cue per 2.2 s).
- ENEMY: no boss events are defined in CONTRACT-C. I react to `ent:add` with `variant:'dreadnought'` (or
  `boss:true`) on the entity, and to `boss:phase {phase}` if you emit it. If the entity does not carry `variant`,
  emit `boss:spawn`. Putting `chassis` on enemy `footstep` events would give enemy rigs the three step weights too.
- UI: Rig Bay edits are heard through `bay:preview`; nothing else is needed. `ui:sound` still works.
