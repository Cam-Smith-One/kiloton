// MODELS harness under the REAL renderer (RENDER agent's lighting, shadows, bloom) on the baseline flat city.
import { boot } from '../src/boot.js';
import models from '../src/models.js';
import render from '../src/render.js';
import { setup } from './models_common.js';
boot({ use: { models, render }, after(G) { setup(G, { lit: false }); } });
