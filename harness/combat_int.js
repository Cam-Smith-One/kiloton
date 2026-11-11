// COMBAT integration harness: other agents' real modules with the baseline city (or the real one).
//   node build.mjs harness/combat_int.js h-combat-int --dev
//   ?int=render,fx,destruct,city,models   picks which real modules replace the baselines (default render,fx,destruct)
import { boot } from '../src/boot.js';
import combat from '../src/combat.js';
import render from '../src/render.js';
import fx from '../src/fx.js';
import destruct from '../src/destruct.js';
import city from '../src/city.js';
import { setup } from './combat_lib.js';
const all = { render, fx, destruct, city };
const want = (new URLSearchParams(location.search).get('int') || 'render,fx,destruct').split(',');
const use = { combat };
for (const k of want) if (all[k]) use[k] = all[k];
boot({ use, after(G) { setup(G, combat); } });
