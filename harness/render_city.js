// RENDER harness with the CITY agent's real city (falls back to the baseline while src/city.js is the placeholder).
//   node build.mjs harness/render_city.js h-render-city --dev
import { boot } from '../src/boot.js';
import render from '../src/render.js';
import city from '../src/city.js';
import { harnessAfter } from './render_demo.js';
boot({ use: { render, city }, after: harnessAfter });
