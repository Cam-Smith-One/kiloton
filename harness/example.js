// Example harness: baseline everything except the module(s) under test.
//   node build.mjs harness/example.js h-example --dev && node tools/shot.mjs dist/h-example.html shots/h-example.png --q "auto=1&cam=96,30,150,96,10,96"
import { boot } from '../src/boot.js';
// import destruct from '../src/destruct.js';
boot({ use: { /* destruct */ }, after(G) { /* e.g. G.boom(90, 10, 80, { radius: 5, power: 160 }) */ } });
