// KILOTON — main.js   OWNER: lead. The shipping entry point: every real module.
import { boot } from './boot.js';
import city from './city.js';
import render from './render.js';
import destruct from './destruct.js';
import fx from './fx.js';
import audio from './audio.js';
import models from './models.js';
import combat from './combat.js';
import player from './player.js';
import enemy from './enemy.js';
import ui from './ui.js';
import mission from './mission.js';
import net from './net.js';
boot({ use: { city, render, destruct, fx, audio, models, combat, player, enemy, mission, net, ui } });
