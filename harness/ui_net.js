// UI + real NET (and real player / combat / models / enemy / mission) on baseline city + render: lobby against the real G.net.
import { boot } from '../src/boot.js';
import ui from '../src/ui.js';
import models from '../src/models.js';
import combat from '../src/combat.js';
import player from '../src/player.js';
import enemy from '../src/enemy.js';
import mission from '../src/mission.js';
import net from '../src/net.js';
boot({ use: { ui, models, combat, player, enemy, mission, net } });
