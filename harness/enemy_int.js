// ENEMY integration harness: real CITY, DESTRUCT, COMBAT, MODELS + enemy, baseline render/player, stand-in player.
//   node build.mjs harness/enemy_int.js h-enemy-int --dev
import { boot } from '../src/boot.js';
import enemy from '../src/enemy.js';
import city from '../src/city.js';
import destruct from '../src/destruct.js';
import combat from '../src/combat.js';
import models from '../src/models.js';
import render from '../src/render.js';
import { installHarness } from './enemy_common.js';
boot({ use: { enemy, city, destruct, combat, models, render }, after(G) { installHarness(G, true); } });
