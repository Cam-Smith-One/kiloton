// MISSION look-dev harness: every real module (as main.js) + the test helpers.
//   node build.mjs harness/mission_full.js h-mission-full --dev
import { boot } from '../src/boot.js';
import city from '../src/city.js';
import render from '../src/render.js';
import destruct from '../src/destruct.js';
import fx from '../src/fx.js';
import audio from '../src/audio.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import ui from '../src/ui.js';
import mission from '../src/mission.js';
import { installTests } from './mission_lib.js';
boot({ use: { city, render, destruct, fx, audio, models, combat, player, enemy, mission, ui }, after(G) { installTests(G); } });
