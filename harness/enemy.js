// ENEMY harness: baseline everything + real enemy module, with a stand-in player entity.
//   node build.mjs harness/enemy.js h-enemy --dev
//   node tools/shot.mjs dist/h-enemy.html shots/enemy-01.png --q "auto=1&spawn=soldier,soldier,tank&cam=96,90,150,96,2,96"
// Params: standin=still|loop|rig|rigloop|none (default still), hp=N (stand-in hp, default 1e9), map=0 (hide the top-down map)
// Helpers in page: KT.h.report(), KT.h.dmg (damage taken by attacker kind), KT.h.run(seconds)
import { boot } from '../src/boot.js';
import enemy from '../src/enemy.js';
import { installHarness } from './enemy_common.js';
boot({ use: { enemy }, after(G) { installHarness(G, true); } });
