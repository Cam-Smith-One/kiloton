// CITY harness: real city, baseline everything else.
//   node build.mjs harness/city.js h-city --dev
//   node tools/shot.mjs dist/h-city.html shots/city-01.png --q "auto=1&cam=60,30,60,96,12,96" --wait 6000
// Eval helpers: KT.cityCheck() -> metadata / budget / connectivity report.
import { boot } from '../src/boot.js';
import { G as G0 } from '../src/core.js';
import city from '../src/city.js';
import view from './city_view.js';
import { SOLID, STRUCT, M } from '../src/materials.js';
boot({
  use: G0.params.has('base') ? { city } : { city, render: view },
  after(G) {
    if (G.params.has('auto')) G.ui.el.style.display = 'none';
    G.cityCheck = () => {
      const g = G.grid, d = g.data, NX = G.NX, NY = G.NY, NZ = G.NZ, c = G.city;
      // flood fill from the ground through every non-air voxel (6-connected)
      const seen = new Uint8Array(d.length), st = new Int32Array(d.length); let sp = 0;
      const lay = NX * NZ;
      for (let n = 0; n < lay; n++) { seen[n] = 1; st[sp++] = n; }
      while (sp) {
        const o = st[--sp], i = o % NX, k = ((o / NX) | 0) % NZ, j = (o / lay) | 0;
        const tryo = (p) => { if (!seen[p] && d[p]) { seen[p] = 1; st[sp++] = p; } };
        if (i > 0) tryo(o - 1); if (i < NX - 1) tryo(o + 1); if (k > 0) tryo(o - NX); if (k < NZ - 1) tryo(o + NX); if (j > 0) tryo(o - lay); if (j < NY - 1) tryo(o + lay);
      }
      let floating = 0, floatSolid = 0, total = 0; const ex = [];
      for (let o = 0; o < d.length; o++) if (d[o]) { if (SOLID[d[o]]) total++; if (!seen[o]) { floating++; if (SOLID[d[o]]) { floatSolid++; if (ex.length < 12) ex.push([o % NX, (o / lay) | 0, ((o / NX) | 0) % NZ, d[o]]); } } }
      // struct-only support: flood from the ground through load-bearing materials only
      const sup = new Uint8Array(d.length); sp = 0;
      for (let n = 0; n < lay * 4; n++) { sup[n] = 1; st[sp++] = n; }
      while (sp) {
        const o = st[--sp], i = o % NX, k = ((o / NX) | 0) % NZ, j = (o / lay) | 0;
        const tryo = (p) => { if (!sup[p] && STRUCT[d[p]]) { sup[p] = 1; st[sp++] = p; } };
        if (i > 0) tryo(o - 1); if (i < NX - 1) tryo(o + 1); if (k > 0) tryo(o - NX); if (k < NZ - 1) tryo(o + NX); if (j > 0) tryo(o - lay); if (j < NY - 1) tryo(o + lay);
      }
      let structTotal = 0, structHung = 0; const hungBy = {};
      for (let o = lay * 4; o < d.length; o++) if (STRUCT[d[o]]) { structTotal++; if (!sup[o]) { structHung++; const b = c.buildingAt[o % lay]; const kd = b ? c.buildings[b - 1].kind : 'prop'; hungBy[kd] = (hungBy[kd] || 0) + 1; } }
      // knock-out test: delete every voxel of the ground storey of the tallest office and count what is left hanging
      const tb = c.buildings.filter(b => b.kind === 'office').sort((a, b) => b.j1 - a.j1)[0]; let ko = null;
      if (tb) {
        const save = d.slice();
        for (let j = 4; j < 10; j++) for (let k = tb.k0; k <= tb.k1; k++) for (let i = tb.i0; i <= tb.i1; i++) if (c.buildingAt[i + NX * k] === tb.id + 1 && STRUCT[d[i + NX * (k + NZ * j)]]) d[i + NX * (k + NZ * j)] = 0;
        const s2 = new Uint8Array(d.length); sp = 0; for (let n = 0; n < lay * 4; n++) { s2[n] = 1; st[sp++] = n; }
        while (sp) { const o = st[--sp], i = o % NX, k = ((o / NX) | 0) % NZ, j = (o / lay) | 0; const tryo = (p) => { if (!s2[p] && STRUCT[d[p]]) { s2[p] = 1; st[sp++] = p; } };
          if (i > 0) tryo(o - 1); if (i < NX - 1) tryo(o + 1); if (k > 0) tryo(o - NX); if (k < NZ - 1) tryo(o + NX); if (j > 0) tryo(o - lay); if (j < NY - 1) tryo(o + lay); }
        let left = 0, tot = 0; for (let j = 10; j <= tb.j1; j++) for (let k = tb.k0; k <= tb.k1; k++) for (let i = tb.i0; i <= tb.i1; i++) { const o = i + NX * (k + NZ * j); if (c.buildingAt[i + NX * k] === tb.id + 1 && STRUCT[d[o]]) { tot++; if (s2[o]) left++; } }
        ko = { name: tb.name, structAbove: tot, stillSupported: left }; d.set(save);
      }
      const kinds = {}; for (const b of c.buildings) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
      const lotN = [0, 0, 0, 0]; for (let n = 0; n < c.lot.length; n++) lotN[c.lot[n]]++;
      const open = (p, h) => !g.boxSolid(p.x - 0.4, 2.05, p.z - 0.4, p.x + 0.4, 2 + h, p.z + 0.4);
      const sum = c.buildings.reduce((a, b) => a + b.voxels, 0);
      const t0 = performance.now(); c.generate(G.state.seed); const regen = performance.now() - t0; g.takeDirty(1e9);
      return { genMs: Math.round(c.genMs), regenMs: Math.round(regen), solid: total, floating, floatSolid, ex, buildings: c.buildings.length, kinds, buildingVoxels: sum,
        tallest: Math.max(...c.buildings.map(b => b.j1)), lotN, player: c.spawns.player, playerOpen: open(c.spawns.player, 2), playerLot: c.lot[Math.floor(c.spawns.player.x * 2) + NX * Math.floor(c.spawns.player.z * 2)],
        edge: c.spawns.edge.length, edgeOpen: c.spawns.edge.filter(p => open(p, 3)).length, edgeRoad: c.spawns.edge.filter(p => c.lot[Math.floor(p.x * 2) + NX * Math.floor(p.z * 2)] === 0).length,
        air: c.spawns.air.length, airClear: c.spawns.air.filter(p => !g.boxSolid(p.x - 3, p.y - 3, p.z - 3, p.x + 3, p.y + 3, p.z + 3)).length,
        drops: c.spawns.mechDrops.length, nodes: c.roadNodes.length, nodesOpen: c.roadNodes.filter(p => open(p, 3)).length, links: c.roadNodes.reduce((a, n) => a + n.links.length, 0) / 2,
        mirror: c.mirror, sites: c.sites.length, sitesFar: c.sites.filter(q => Math.hypot(q.x - c.spawns.player.x, q.z - c.spawns.player.z) > 45).length, citadel: c.buildings[c.citadel] && [c.buildings[c.citadel].name, c.buildings[c.citadel].kind, c.buildings[c.citadel].j1], mains: c.gasMains.length, tankers: c.tankers.length, gasVox: (() => { let n = 0, f = 0, b = 0; for (let o = 0; o < d.length; o++) { if (d[o] === 61) n++; else if (d[o] === 62) f++; else if (d[o] === 63) b++; } return [n, f, b]; })(), plazaClear: !g.boxSolid(c.plaza.x - 4.9, 2.05, c.plaza.z - 4.9, c.plaza.x + 4.9, 14, c.plaza.z + 4.9) && (() => { for (let a = 0; a < 64; a++) { const x = c.plaza.x + Math.cos(a / 64 * 6.2832) * 6.9, z = c.plaza.z + Math.sin(a / 64 * 6.2832) * 6.9; if (g.boxSolid(x - 0.1, 2.05, z - 0.1, x + 0.1, 14, z + 0.1)) return false; } return true; })(), structTotal, structHung, hungBy, ko };
    };
  },
});
