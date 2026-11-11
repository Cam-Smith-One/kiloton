// UI harness: baseline everything, real UI.   node build.mjs harness/ui.js h-ui --dev
//   ui=title|hud|rig|pause|over  uis=ready|drop|wait|low|inter|hot|tips   bg=bright|dark|fire (legibility stress backdrops)
import { boot } from '../src/boot.js';
import ui from '../src/ui.js';
boot({
  use: { ui },
  after(G) {
    const bg = G.params.get('bg'), T = G.THREE;
    if (bg) {
      G.scene.fog = null;
      if (bg === 'bright') G.scene.background = new T.Color(0xffffff);
      else if (bg === 'dark') G.scene.background = new T.Color(0x050608);
      else if (bg === 'fire') G.scene.background = new T.Color(0xffc46a);
      for (const o of [...G.scene.children]) if (o.isMesh) o.visible = false;
      G.scene.traverse(o => { if (o.isMesh) o.visible = false; });
      const base = G.render.update; G.render.update = function (dt) { base.call(this, dt, 0); G.scene.traverse(o => { if (o.isMesh) o.visible = false; }); };
    }
  },
});
