// COMBAT harness: real combat module on the lead's baselines.
//   node build.mjs harness/combat.js h-combat --dev
//   node tools/shot.mjs dist/h-combat.html shots/combat-01.png --q "auto=1&demo=range&cam=40,14,20,50,4,50" --wait 5000
//   node tools/shot.mjs dist/h-combat.html /tmp/x.png --q "auto=1" --eval "KT.ct.all()"
import { boot } from '../src/boot.js';
import combat from '../src/combat.js';
import { setup } from './combat_lib.js';
boot({ use: { combat }, after(G) { setup(G, combat); } });
