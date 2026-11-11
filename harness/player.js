// PLAYER harness: baseline everything except the player module.
//   node build.mjs harness/player.js h-player --dev
//   node tools/shot.mjs dist/h-player.html shots/player-01.png --q "auto=1&dummies=1" --wait 3000
// Params: dummies=1 (static Vanta targets around the spawn), plus the player's own mech=1 meter=1 god=1.
import { boot } from '../src/boot.js';
import player from '../src/player.js';
import { installDummies, installGrabStub, installHud } from './player_util.js';
boot({ use: { player }, after(G) { installGrabStub(G); installDummies(G); installHud(G); } });
