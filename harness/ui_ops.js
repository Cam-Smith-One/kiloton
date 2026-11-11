// UI + real MISSION / ENEMY / PLAYER / COMBAT / MODELS on baseline city + render: checks the tracker against real objectives.
import { boot } from '../src/boot.js';
import ui from '../src/ui.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import mission from '../src/mission.js';
import audio from '../src/audio.js';
boot({ use: { ui, models, combat, player, enemy, mission, audio } });
