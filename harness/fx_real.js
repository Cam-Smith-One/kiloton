// FX harness with the REAL renderer / city / destruct (whatever currently builds): checks bloom, tone map, fog.
//   node build.mjs harness/fx_real.js h-fx-real --dev
import { boot } from '../src/boot.js';
import fx from '../src/fx.js';
import render from '../src/render.js';
import city from '../src/city.js';
import destruct from '../src/destruct.js';
import { runDemo } from './fx_demo.js';
boot({ use: { fx, render, city, destruct }, after(G) { if (!G.params.has('ui')) G.uiRoot.style.display = 'none'; setTimeout(() => runDemo(G), 0); } });
