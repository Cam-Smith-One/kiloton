// Gameplay capture for the explainer. Usage: node clips.mjs <clip> ; PREVIEW=15 node clips.mjs <clip> renders every 15th frame only.
import { launch, openGame, capture, WORK } from './lib.mjs';
const Q = process.env.Q || 'med';
const base = `auto=1&q=${Q}&god=1`;
const hideUI = p => p.evaluate(() => { KT.uiRoot.style.display = 'none'; });
const hideTips = p => p.evaluate(() => { const s = document.createElement('style'); s.textContent = '.ku-tips{display:none!important}'; document.head.appendChild(s); });
const ease = 'const E=x=>x<0?0:x>1?1:x*x*(3-2*x);';

const CLIPS = {
  // 1. establishing shot: slow arc over the district, no HUD
  async city(b) {
    const p = await openGame(b, base + '&noenemy=1'); await hideUI(p);
    await p.evaluate(() => KT.debugStep(60, 1 / 30));
    await capture(p, 'city', 210, { post: `const u=i/(n-1), a=(62+u*40)*Math.PI/180, r=128-u*10, h=64-u*8; window.__cam=[96+Math.cos(a)*r, h, 96+Math.sin(a)*r, 96, 16, 92, 50];` });
  },
  // 2. tower collapse: Kestrel Court (id 27) seen from the plaza; ground-floor supports blown out
  async collapse(b) {
    const p = await openGame(b, base + '&noenemy=1'); await hideUI(p);
    await p.evaluate(() => { KT.debugStep(30, 1 / 30); const B = KT.city.buildings[27]; const x0 = B.i0 / 2, x1 = B.i1 / 2, z0 = B.k0 / 2, z1 = B.k1 / 2; const pts = [];
      for (let x = x0 + 1.5; x <= x1 - 1; x += 3.4) for (let z = z0 + 1.5; z <= z1 - 1; z += 3.4) pts.push([x, z]);
      pts.sort((a, c) => (a[1] - c[1]) + (a[0] - c[0]) * 0.3); window.__pts = pts; });
    await capture(p, 'collapse', 216, {
      tick: `const k0=24, per=1; if(i>=k0){ for(let q=0;q<per*2;q++){ const pt=window.__pts.shift(); if(pt) KT.boom(pt[0], 4.2, pt[1], {radius:4.2, power:230, damage:0}); } }`,
      post: ease + `const u=E(i/(n-1)); window.__cam=[112-u*2, 7+u*3, 91-u*3, 96, 21-u*9, 134, 62];` });
  },
  // 3. pilot on foot -> rig called down from orbit -> (cut) aboard the rig (gameplay camera, HUD on)
  async pilot(b) {
    const p = await openGame(b, base + '&noenemy=1'); await hideTips(p);
    await p.evaluate(() => { window.K = (c, d) => KT.input._q.push([d ? 0 : 1, c]); window.D = KT.player.debug; KT.debugStep(45, 1 / 30); D.look(0, -0.02); });
    await capture(p, 'pilot', 100, { tick: `if(i==0){K('KeyW',1);K('ShiftLeft',1);} if(i==34)K('KeyC',1); if(i==60)K('KeyC',0); if(i==68)K('KeyX',1); if(i==70)K('KeyX',0); if(i==n-1){K('KeyW',0);K('ShiftLeft',0);}` });
    const info = await p.evaluate(() => { KT.debugStep(20, 1 / 30); D.fillMeter(); const e = D.info(); const r = D.callDrop(114.5, 75.5); KT.debugStep(52, 1 / 30); return [e, r, D.info()]; });
    console.log(JSON.stringify(info));
    await capture(p, 'drop', 105, { tick: `const m=KT.ents.list.find(e=>e.kind=='mech'&&e.team==0); if(m){ const y=Math.min(m.pos.y+5, 8+(m.pos.y-2)*0.5, 34); D.lookAt(m.pos.x, y, m.pos.z); }` });
    console.log(JSON.stringify(await p.evaluate(() => { const m = KT.ents.list.find(e => e.kind == 'mech' && e.team == 0); D.teleport(m.pos.x - 2.5, 2, m.pos.z - 2.5); KT.debugStep(3, 1 / 30); const r = D.board(); KT.debugStep(75, 1 / 30); D.look(0.15, 0.06); KT.debugStep(15, 1 / 30); return [r, D.info()]; })));
    await capture(p, 'rig', 105, { tick: `if(i==0)K('KeyW',1); const yaw=0.15+E(i/70)*0.5; D.look(yaw, 0.06+E(i/70)*0.1); if(i==22)KT.input._q.push([2,0]); if(i==58)KT.input._q.push([2,2]); if(i==70)KT.input._q.push([3,2]);`.replace(/^/, ease) });
  },
  // 4. Rig Bay: cycle Harrier -> Warden -> Bastion (title phase, real UI; captured at 15 fps, frames doubled in the edit)
  async bay(b) {
    const p = await openGame(b, `q=${Q}&unlock=1`);
    await p.evaluate(() => { window.KD = c => { window.dispatchEvent(new KeyboardEvent('keydown', { code: c })); window.dispatchEvent(new KeyboardEvent('keyup', { code: c })); }; KT.ui.openBay(); KT.debugStep(10, 1 / 30); KD('Digit2'); KT.debugStep(40, 1 / 30); });
    await capture(p, 'bay', 90, { dt: 1 / 15, sub: 2, tick: `if(i==30)KD('Digit1'); if(i==60)KD('Digit3');` });
  },
  // 5. gas main under the z=41.75 street: break it mid-run, the break travels both ways (and past a parked tanker)
  async gas(b) {
    const p = await openGame(b, base + '&noenemy=1'); await hideUI(p);
    await p.evaluate(() => KT.debugStep(30, 1 / 30));
    await capture(p, 'gas', 180, { tick: `if(i==16) KT.boom(100,1.6,41.75,{radius:3,power:220,damage:0});`,
      post: ease + `const u=E(i/(n-1)); window.__cam=[150+u*1, 11+u*2.5, 37.2, 100+u*9, 5, 42, 50];` });
  },
  // 6. Operation Blackout stage 4: the Dreadnought drops in; fight it from the Warden (gameplay camera, HUD on)
  async boss(b) {
    const p = await openGame(b, `auto=1&q=${Q}&god=1&mode=operation&stage=4&mech=1&loadout=0`); await hideTips(p);
    console.log(JSON.stringify(await p.evaluate(() => { window.K = (c, d) => KT.input._q.push([d ? 0 : 1, c]); window.D = KT.player.debug; KT.debugStep(240, 1 / 30); D.teleport(116.5, 2, 43); D.look(-0.1, 0.5); KT.debugStep(44, 1 / 30); const b = KT.mission.boss; return [KT.time, b && [b.pos.x, b.pos.y, b.pos.z], D.info()]; })));
    await capture(p, 'boss', 210, { tick: `const b=KT.mission.boss; if(b){ D.lookAt(b.pos.x, Math.min(b.pos.y+10, 40), b.pos.z); } if(i==70){KT.input._q.push([2,0]);K('KeyA',1);} if(i==96)KT.input._q.push([2,2]); if(i==110)KT.input._q.push([3,2]); if(i==120){K('KeyA',0);K('KeyD',1);} if(i==170)KT.input._q.push([2,2]); if(i==184)KT.input._q.push([3,2]);` });
  },
};
for (const name of process.argv.slice(2)) { const b = await launch(); try { await CLIPS[name](b); } catch (e) { console.log('FAILED', name, e); } finally { await b.close(); } }
