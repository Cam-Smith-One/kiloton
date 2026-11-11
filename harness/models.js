// MODELS harness: real models on the baseline world with look-dev lighting.
import { boot } from '../src/boot.js';
import models from '../src/models.js';
import { setup } from './models_common.js';
boot({ use: { models }, after(G) { setup(G); } });
