// MISSION harness: the real city, enemy, player, combat, destruct and models with the mission director.
// Baseline render / fx / audio / ui (fast). Use harness/mission_full.js for looks.
//   node build.mjs harness/mission.js h-mission --dev
//   node tools/shot.mjs dist/h-mission.html shots/mission-x.png --q "auto=1&mode=operation&q=low&god=1" --wait 20000 --eval "KT.mt.run()"
import { boot } from '../src/boot.js';
import city from '../src/city.js';
import destruct from '../src/destruct.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import mission from '../src/mission.js';
import { installTests } from './mission_lib.js';
boot({ use: { city, destruct, models, combat, player, enemy, mission }, after(G) { installTests(G); } });
