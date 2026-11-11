// UI integration harness: real player / combat / models / enemy / audio with baseline city + render (cheap to draw headless).
import { boot } from '../src/boot.js';
import ui from '../src/ui.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import audio from '../src/audio.js';
boot({ use: { ui, models, combat, player, enemy, audio } });
