// ENEMY full harness: every real module (like main.js) + the debug map and counters. standin=none by default (real PLAYER).
//   node build.mjs harness/enemy_full.js h-enemy-full --dev
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
import { installHarness } from './enemy_common.js';
boot({ use: { city, render, destruct, fx, audio, models, combat, player, enemy, ui }, after(G) { installHarness(G, false); } });
