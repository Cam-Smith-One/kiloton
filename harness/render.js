// RENDER harness. Baseline everything except the renderer (and, with ?city=real, the CITY agent's module).
//   node build.mjs harness/render.js h-render --dev
//   node tools/shot.mjs dist/h-render.html shots/render-01.png --q "auto=1&q=high&swatch=1&props=1&cam=60,9,60,96,6,96"
// Params: swatch=1 (material test wall), props=1 (standard-material test meshes), flash=1 (pulse the light pool),
//         boom=x,y,z,r (carve a crater after start), city=real
import { boot } from '../src/boot.js';
import render from '../src/render.js';
import { harnessAfter } from './render_demo.js';
boot({ use: { render }, after: harnessAfter });
