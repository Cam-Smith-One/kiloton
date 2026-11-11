// PLAYER integration harness: the real CITY / DESTRUCT / FX / MODELS / COMBAT (+ optionally ENEMY, RENDER) with the
// look-dev HUD.   node build.mjs harness/player_full.js h-player-full --dev
// Params: real=render,enemy,ui (opt into the heavy ones), dummies=1, plus mech=1 meter=1 god=1.
import { boot } from '../src/boot.js';
import { G } from '../src/core.js';
import player from '../src/player.js';
import city from '../src/city.js';
import destruct from '../src/destruct.js';
import fx from '../src/fx.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import enemy from '../src/enemy.js';
import render from '../src/render.js';
import { installDummies, installHud } from './player_util.js';
const real = (G.params.get('real') || '').split(',');
const use = { player, city, destruct, fx, models, combat };
if (real.includes('enemy')) use.enemy = enemy;
if (real.includes('render')) use.render = render;
boot({ use, after(G) { installDummies(G); installHud(G); } });
