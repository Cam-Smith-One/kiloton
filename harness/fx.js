// FX harness: baseline everything + real fx, with stand-in golden-hour lighting and a look-dev HDR post.
//   node build.mjs harness/fx.js h-fx --dev
//   node tools/shot.mjs dist/h-fx.html shots/fx-01.png --q "auto=1&demo=explosion&t=0.4&cam=100,6,122,100,5,100" --wait 2500
// params: demo=<name[,name]> t=<age s> hold=<timescale> at=x,z nopost=1 (raw baseline output)
import { boot } from '../src/boot.js';
import fx from '../src/fx.js';
import { goldenHour, installPost } from './fx_lookdev.js';
import { runDemo } from './fx_demo.js';
boot({
  use: { fx },
  after(G) {
    goldenHour(G);
    if (!G.params.has('nopost')) installPost(G);
    if (!G.params.has('ui')) G.uiRoot.style.display = 'none';
    // boot defines debugStep after `after`; run the demo on the next tick
    setTimeout(() => runDemo(G), 0);
  },
});
