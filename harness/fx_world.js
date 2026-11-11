// FX harness: baseline city + look-dev lighting/post, REAL destruct (debris, collapse, fire, gas) and real fx.
//   node build.mjs harness/fx_world.js h-fx-world --dev      demos: rfire rgas rtank (+ every demo in fx_demo.js)
import { boot } from '../src/boot.js';
import fx from '../src/fx.js';
import destruct from '../src/destruct.js';
import { goldenHour, installPost } from './fx_lookdev.js';
import { runDemo } from './fx_demo.js';
boot({ use: { fx, destruct }, after(G) { goldenHour(G); if (!G.params.has('nopost')) installPost(G); if (!G.params.has('ui')) G.uiRoot.style.display = 'none'; setTimeout(() => runDemo(G), 0); } });
