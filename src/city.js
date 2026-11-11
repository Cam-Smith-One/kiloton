// ============================================================================
// KILOTON — city.js   OWNER: CITY.   Module G.city
// Procedural generator for the Halden Yard district. Deterministic from
// G.state.seed. Writes straight into the voxel grid, then publishes metadata:
// buildings, lot, buildingAt, spawns, roadNodes  (CONTRACT 6.1).
// Layout: 20-voxel ring road, 5x5 parcels (uneven sizes) separated by 22-voxel
// roadways; every parcel carries a 5-voxel sidewalk, so facades are 16 m apart.
// ============================================================================
import { G, NX, NY, NZ, VS, GROUND_J, mulberry32 } from './core.js';
import { M, SOLID } from './materials.js';
import { C, J0, FH, put, box, ring, get, begin, end, surface } from './city_util.js';
import * as B from './city_build.js';
import * as PR from './city_props.js';

const RING = 20, RW = 22, SW = 5;
const PWX = [44, 58, 52, 58, 44], PWZ = [48, 52, 56, 52, 48];
const X0 = [], Z0 = [];
{ let x = RING, z = RING; for (let n = 0; n < 5; n++) { X0.push(x); x += PWX[n] + RW; Z0.push(z); z += PWZ[n] + RW; } }
const parcel = (bx, bz) => ({ i0: X0[bx], i1: X0[bx] + PWX[bx] - 1, k0: Z0[bz], k1: Z0[bz] + PWZ[bz] - 1 });
const shrink = (r, n) => ({ i0: r.i0 + n, k0: r.k0 + n, i1: r.i1 - n, k1: r.k1 - n });
const roadX = (n) => X0[n] + PWX[n];            // first voxel of the n-th north-south roadway (n = 0..3)
const roadZ = (n) => Z0[n] + PWZ[n];
// centre lines of all drivable corridors (voxels): ring, 4 roads, ring
const LX = [11.5, ...[0, 1, 2, 3].map(n => roadX(n) + RW / 2), NX - 11.5];
const LZ = [11.5, ...[0, 1, 2, 3].map(n => roadZ(n) + RW / 2), NZ - 11.5];

const TEMPLATE = [
  ['shops', 'warehouse', 'apts2', 'parking', 'gas'],
  ['apts2', 'deco', 'glassA', 'podium', 'aptsL'],
  ['shops', 'twin', 'plaza', 'ribbon', 'office'],
  ['aptsL', 'glassB', 'hotel', 'officeTall', 'shops'],
  ['apts2', 'construction', 'shopsMix', 'park', 'shops'],
];
const NAMES = {
  tower: ['Meridian Exchange', 'Halden Mutual', 'Corvane Tower', 'Ostrander Building', 'Pallas House', 'Tessaly Centre', 'Lumen Works', 'Arden Quay One', 'Vireo Plaza', 'Kestrel Court'],
  apt: ['Marlowe Arms', 'Linden Court', 'The Foundry Lofts', 'Wren Street Flats', 'Cardew House', 'Alder Row', 'Saltmarsh Terrace', 'Pike Lane Flats', 'Hollis Mews', 'Tanner Block'],
  shop: [['BAR', 'Low Tide Bar', 'BAR'], ['24H', 'Corner 24H', '24H'], ['NOODLE', 'Noodle Yard', 'PHO'], ['CAFE', 'Cafe Orrin', 'JOE'], ['BOOKS', 'Halden Books', 'INK'], ['PAWN', 'Yard Pawn', 'GEM'], ['DINER', 'Dot Diner', 'EAT'], ['TEA', 'Tea Room', 'TEA'],
    ['VINYL', 'Vinyl Depot', 'LPS'], ['BIKES', 'Spoke Bikes', 'BMX'], ['DELI', 'Mott Deli', 'SUB'], ['GYM', 'Iron Gym', 'GYM'], ['PIZZA', 'Slice Pizza', 'PIE'], ['ARCADE', 'Coin Arcade', 'WIN'], ['TACOS', 'Taco Stand', 'MEX'], ['LAUNDRY', 'Suds Laundry', 'DRY'], ['PHARMA', 'Yard Pharmacy', 'RX+'], ['TOOLS', 'Hale Tools', 'FIX']],
};
const BRICKS = [M.brick_red, M.brick_tan, M.brick_dark, M.plaster, M.brick_red, M.brick_tan];
const NEONS = [M.neon_cyan, M.neon_magenta, M.neon_orange, M.light_amber, M.neon_magenta, M.neon_orange];
const AWN = [M.awning_red, M.awning_green];

const city = {
  name: 'city',
  buildings: [], lot: new Uint8Array(NX * NZ), buildingAt: new Int16Array(NX * NZ),
  spawns: { player: { x: 96, z: 100, yaw: 0 }, edge: [], air: [], mechDrops: [] },
  roadNodes: [],
  gasMains: [],          // polylines: arrays of {x,y,z} in metres (trunks under the road, branches ending in a riser)
  sites: [],             // open build spots for MISSION: { x, z, kind:'plaza'|'intersection', clear (m) }, >= 12 m clear, spread-first order
  citadel: -1,           // building id best suited as a command post (tall, block north of the plaza)
  tankers: [],           // { x, z, y, yaw, length, width, i0,k0,i1,k1 } fuel tankers parked on streets
  // extras (beyond the contract)
  blocks: [],            // { bx, bz, kind, x0,z0,x1,z1 (metres) }
  streets: { x: [], z: [] },   // centre lines in metres, incl. the ring
  plaza: { x: 96, z: 96, r: 10 },
  genMs: 0, solid: 0,
  init() { this.generate(G.state.seed); },
  reset() { for (const b of this.buildings) b.alive = true; },

  generate(seed) {
    const t0 = performance.now(), g = G.grid, rng = mulberry32((seed >>> 0) ^ 0x51ed270b);
    C.d = g.data; C.lot = this.lot; C.bAt = this.buildingAt; C.rng = rng; C.buildings = this.buildings; C.cur = null; C.seed = seed & 0xffff;
    g.data.fill(0); this.lot.fill(0); this.buildingAt.fill(0); this.buildings.length = 0; this.blocks.length = 0;
    let mx = rng() < 0.5, mz = rng() < 0.5;
    const mp = G.params && G.params.get('mirror');           // debug: mirror=0..3 forces the layout variant
    if (mp !== null && mp !== undefined && mp !== '') { mx = !!(+mp & 1); mz = !!(+mp & 2); }
    this.mirror = { x: mx, z: mz };

    // ---- ground ----
    g.fillBox(0, 0, 0, NX - 1, 0, NZ - 1, M.bedrock);
    g.fillBox(0, 1, 0, NX - 1, J0 - 2, NZ - 1, M.dirt);
    g.fillBox(0, J0 - 1, 0, NX - 1, J0 - 1, NZ - 1, M.asphalt);
    this.roads(rng);

    // ---- blocks ----
    const nm = { tower: shuffle(NAMES.tower.slice(), rng), apt: shuffle(NAMES.apt.slice(), rng), shop: shuffle(NAMES.shop.slice(), rng) };
    for (let bz = 0; bz < 5; bz++) for (let bx = 0; bx < 5; bx++) {
      const kind = TEMPLATE[mz ? 4 - bz : bz][mx ? 4 - bx : bx], p = parcel(bx, bz), A = shrink(p, SW);
      const dx = 2 - bx, dz = 2 - bz;
      const front = (Math.abs(dx) >= Math.abs(dz) && dx !== 0) ? (dx > 0 ? 3 : 2) : (dz > 0 ? 1 : 0);
      this.blocks.push({ bx, bz, kind, x0: p.i0 * VS, z0: p.k0 * VS, x1: (p.i1 + 1) * VS, z1: (p.k1 + 1) * VS });
      this.block(kind, A, p, front, bx, bz, rng, nm);
    }
    const ax = LX[mx ? 3 : 2] * VS, pzv = (mz ? Z0[0] + 20 : Z0[4] + PWZ[4] - 20) * VS;
    this.spawns.player = { x: ax + 1.5, z: pzv, yaw: mz ? 0 : Math.PI };
    this.utilities(rng, mx, mz);
    this.furniture(rng, mx, mz);
    this.meta(mx, mz);

    // ---- per-building solid counts ----
    const d = g.data, bAt = this.buildingAt;
    for (const b of this.buildings) {
      let n = 0;
      if (b.i1 >= b.i0) for (let j = b.j0; j <= b.j1; j++) for (let k = b.k0; k <= b.k1; k++) { const o = NX * (k + NZ * j), ob = NX * k; for (let i = b.i0; i <= b.i1; i++) if (bAt[ob + i] === b.id + 1 && SOLID[d[o + i]]) n++; }
      else { b.i0 = b.i1 = b.k0 = b.k1 = 0; }
      b.voxels = n;
    }
    let solid = 0; for (let n = 0; n < d.length; n++) if (SOLID[d[n]]) solid++;
    this.solid = solid;
    C.cur = null;
    g.snapshot(); g.markAllDirty();
    this.genMs = performance.now() - t0;
  },

  // ------------------------------------------------------------------ roads
  roads(rng) {
    const lot = this.lot;
    // outer rim walk
    surface(0, 0, NX - 1, 2, M.sidewalk, 1); surface(0, NZ - 3, NX - 1, NZ - 1, M.sidewalk, 1); surface(0, 0, 2, NZ - 1, M.sidewalk, 1); surface(NX - 3, 0, NX - 1, NZ - 1, M.sidewalk, 1);
    surface(2, 2, NX - 3, 2, M.curb); surface(2, NZ - 3, NX - 3, NZ - 3, M.curb); surface(2, 2, 2, NZ - 3, M.curb); surface(NX - 3, 2, NX - 3, NZ - 3, M.curb);
    // parcels: sidewalk with a curb edge and paving joints
    for (let bz = 0; bz < 5; bz++) for (let bx = 0; bx < 5; bx++) {
      const p = parcel(bx, bz);
      surface(p.i0, p.k0, p.i1, p.k1, M.sidewalk, 1);
      const s = C.cur; C.cur = null;
      ring(p.i0, J0 - 1, p.k0, p.i1, J0 - 1, p.k1, M.curb);
      for (let i = p.i0 + 5; i < p.i1; i += 6) { box(i, J0 - 1, p.k0 + 1, i, J0 - 1, p.k0 + 4, M.concrete); box(i, J0 - 1, p.k1 - 4, i, J0 - 1, p.k1 - 1, M.concrete); }
      for (let k = p.k0 + 5; k < p.k1; k += 6) { box(p.i0 + 1, J0 - 1, k, p.i0 + 4, J0 - 1, k, M.concrete); box(p.i1 - 4, J0 - 1, k, p.i1 - 1, J0 - 1, k, M.concrete); }
      C.cur = s;
    }
    const S = (i0, k0, i1, k1, m) => box(i0, J0 - 1, k0, i1, J0 - 1, k1, m);
    // interior roads: markings per segment alongside each parcel row/column
    for (let n = 0; n < 4; n++) {
      const a0 = roadX(n), a1 = a0 + RW - 1, c0 = roadZ(n), c1 = c0 + RW - 1;
      for (let r = 0; r < 5; r++) {
        // north-south road n beside parcel row r
        let k0 = Z0[r], k1 = Z0[r] + PWZ[r] - 1;
        S(a0 + 10, k0 + 10, a0 + 10, k1 - 10, M.line_yellow);
        for (let i = a0 + 1; i < a1; i++) if ((i - a0) % 4 === 1 || (i - a0) % 4 === 2) { S(i, k0 + 1, i, k0 + 6, M.line_white); S(i, k1 - 6, i, k1 - 1, M.line_white); }
        S(a0 + 11, k0 + 9, a1 - 1, k0 + 9, M.line_white); S(a0 + 1, k1 - 9, a0 + 9, k1 - 9, M.line_white);
        for (let k = k0 + 14; k < k1 - 14; k++) if ((k - k0) % 8 < 4) { S(a0 + 4, k, a0 + 4, k, M.line_white); S(a1 - 4, k, a1 - 4, k, M.line_white); }
        // east-west road n beside parcel column r
        k0 = X0[r]; k1 = X0[r] + PWX[r] - 1;
        S(k0 + 10, c0 + 10, k1 - 10, c0 + 10, M.line_yellow);
        for (let k = c0 + 1; k < c1; k++) if ((k - c0) % 4 === 1 || (k - c0) % 4 === 2) { S(k0 + 1, k, k0 + 6, k, M.line_white); S(k1 - 6, k, k1 - 1, k, M.line_white); }
        S(k0 + 9, c0 + 1, k0 + 9, c0 + 9, M.line_white); S(k1 - 9, c0 + 11, k1 - 9, c1 - 1, M.line_white);
        for (let i = k0 + 14; i < k1 - 14; i++) if ((i - k0) % 8 < 4) { S(i, c0 + 4, i, c0 + 4, M.line_white); S(i, c1 - 4, i, c1 - 4, M.line_white); }
      }
    }
    // ring road: dashed centre line
    for (let t = RING + 2; t < NX - RING - 2; t++) if (t % 10 < 5) { S(t, 11, t, 11, M.line_yellow); S(t, NZ - 12, t, NZ - 12, M.line_yellow); S(11, t, 11, t, M.line_yellow); S(NX - 12, t, NX - 12, t, M.line_yellow); }
    // manholes and patches
    for (let t = 0; t < 46; t++) {
      const i = rng.int(6, NX - 8), k = rng.int(6, NZ - 8);
      if (lot[i + NX * k] || lot[i + 1 + NX * (k + 1)]) continue;
      if (t % 3 === 0) S(i, k, i + 1, k + 1, M.metal_dark); else if (get(i, J0 - 1, k) === M.asphalt) S(i, k, i + rng.int(2, 5), k + rng.int(1, 3), M.concrete_dark);
    }
  },

  // ------------------------------------------------------------------ blocks
  block(kind, A, p, front, bx, bz, rng, nm) {
    const W = A.i1 - A.i0 + 1, D = A.k1 - A.k0 + 1;
    const tname = () => nm.tower.pop() || 'Halden Tower', aname = () => nm.apt.pop() || 'Yard Flats';
    const shopv = () => nm.shop.pop() || ['BAR', 'Bar', 'BAR'];
    const mkShop = (R, v, o) => {
      const st = shopv(), wall = rng.pick([M.brick_red, M.brick_tan, M.plaster, M.tile_white, M.brick_dark, M.tile_teal, M.plaster]);
      return B.shop(R, Object.assign({ name: st[1], sign: st[0], short: st[2], wall, floors: rng() < 0.45 ? 2 : 1, awn: rng.pick(AWN), neon: rng.pick(NEONS), base: rng.pick([M.concrete_dark, M.stone, M.brick_dark]), trim: rng() < 0.5 ? M.stone : 0, paint: st[0] }, v, o));
    };
    // split a rect into n strips across the axis that the front runs along
    const strips = (R, n, gap) => {
      const alongZ = front >= 2, L = alongZ ? R.k1 - R.k0 + 1 : R.i1 - R.i0 + 1, w = Math.floor((L - gap * (n - 1)) / n), out = [];
      let a = alongZ ? R.k0 : R.i0;
      for (let t = 0; t < n; t++) { const len = t === n - 1 ? (alongZ ? R.k1 : R.i1) - a + 1 : w; out.push(alongZ ? { i0: R.i0, i1: R.i1, k0: a, k1: a + len - 1 } : { i0: a, i1: a + len - 1, k0: R.k0, k1: R.k1 }); a += len + gap; }
      return out;
    };
    const lo = front >= 2 ? 0 : 2, hi = front >= 2 ? 1 : 3;       // the two sides across which strips neighbour each other
    switch (kind) {
      case 'plaza': this.plazaBlock(p, A, rng); break;
      case 'park': this.parkBlock(p, A, rng); break;
      case 'glassA': B.towerGlass(A, { name: tname(), floors: 12, step: 3, stepFlank: rng() < 0.5, glass: M.glass_dark, span: M.concrete_dark, mull: M.metal_dark, front, doors: [0, 1, 2, 3], crown: 'screen', neon: M.neon_cyan, lit: 0.2, core: M.concrete }); break;
      case 'glassB': B.towerGlass(A, { name: tname(), floors: 10, glass: M.glass, span: M.metal_panel, mull: M.metal_panel, sill: true, front, doors: [front, front ^ 1], crown: 'flat', neon: M.light_white, lit: 0.26, mast: 12, core: M.tile_white, sign: 'ARDEN', signCol: M.neon_orange, base: M.concrete }); break;
      case 'deco': B.towerDeco(A, { name: tname(), tiers: [5, 4, 3], front, wall: M.stone, span: M.concrete_dark, sign: 'HALDEN' }); break;
      case 'podium': B.towerPodium(A, { name: tname(), podFloors: 3, floors: 8, front, cx: bx < 2, cz: bz < 2, wall: M.tile_white, glass: M.glass_dark, sign: 'LUMEN', signCol: M.neon_cyan }); break;
      case 'ribbon': B.towerPodium(A, { name: tname(), podFloors: 2, floors: 9, front, cx: bx > 2, cz: rng() < 0.5, wall: M.concrete, glass: M.glass, podWall: M.concrete_dark, helipad: true, lit: 0.28 }); break;
      case 'twin': B.towerTwin(A, { name: tname(), floors: 11, wing: 6, front, flip: rng() < 0.5, board: 'NOVA', neon: M.neon_magenta }); break;
      case 'hotel': B.hotel(A, { name: 'Hotel Castellan', floors: 10, front, wall: rng() < 0.5 ? M.brick_tan : M.plaster, bladeAt: rng() < 0.5 ? 'hi' : 'lo' }); break;
      case 'officeTall': B.officeMid(A, { name: tname(), floors: 8, front, wall: M.brick_dark, span: M.brick_red, glass: M.glass, mid: M.metal_dark, pil: M.brick_dark, cornice: M.stone, doors: [front, front ^ 1], awn: M.awning_green, sign: 'KESTREL', signCol: M.neon_orange, tank: true }); break;
      case 'office': B.officeMid(A, { name: tname(), floors: 6, front, wall: M.tile_teal, span: M.tile_white, glass: M.glass_dark, cornice: M.tile_white, doors: [front], awn: M.awning_red, sign: 'TESSALY', signCol: M.neon_cyan }); break;
      case 'parking': B.parking(A, { name: 'Yard Street Parking', decks: 4, front: front < 2 ? front : (bz < 2 ? 1 : 0), towerHi: rng() < 0.5 }); break;
      case 'warehouse': B.warehouse(A, { name: 'Halden Freight', front: front < 2 ? front : (bz < 2 ? 1 : 0), yardHi: bx > 2 ? false : true, sign: 'FREIGHT' }); break;
      case 'construction': B.construction(A, { name: 'Quay Two (under construction)', front: front < 2 ? front : (bz < 2 ? 1 : 0), craneHi: bx > 2, floors: 6 }); break;
      case 'gas': B.gasStation(A, { name: 'Yardline Fuel', front: front >= 2 ? front : (bx < 2 ? 3 : 2) }); break;
      case 'aptsL': {
        const wall = rng.pick(BRICKS), fl = rng.int(6, 7);
        B.apartment(A, { name: aname(), floors: fl, wall, front, balc: [front, front ^ 1], fire: lo, fireBay: 1, base: M.stone, shopFront: front, awn: rng.pick(AWN), lit: 0.36 });
        break;
      }
      case 'apts2': {
        const rs = strips(A, 2, 9);
        rs.forEach((R, t) => {
          const wall = BRICKS[(bx + bz * 2 + t * 3 + (rng() * 2 | 0)) % BRICKS.length], fl = rng.int(4, 6) + (t ? 0 : 1);
          B.apartment(R, { name: aname(), floors: fl, wall, front, balc: [t ? hi : lo, front], balcFrac: 0.55, fire: t ? lo : hi, fireBay: 1, base: wall === M.plaster ? M.concrete_dark : M.stone, trim: wall === M.brick_dark ? M.brick_tan : M.stone, awn: rng.pick(AWN) });
        });
        // alley clutter
        const a = front >= 2 ? { i: (A.i0 + A.i1) >> 1, k: rs[0].k1 + 2 } : { i: rs[0].i1 + 2, k: (A.k0 + A.k1) >> 1 };
        PR.crateStack(a.i, J0, a.k, 3); PR.bin(a.i + (front >= 2 ? 9 : 0), a.k + (front >= 2 ? 0 : 9)); PR.bin(a.i + (front >= 2 ? 10 : 0), a.k + (front >= 2 ? 0 : 10));
        break;
      }
      case 'shops': {
        const rs = strips(A, 3, 0);
        rs.forEach((R, t) => {
          const fronts = [front], blank = [];
          if (t > 0) blank.push(lo); else fronts.push(lo);
          if (t < 2) blank.push(hi); else fronts.push(hi);
          mkShop(R, { fronts, blank, paintSides: [front ^ 1] });
        });
        break;
      }
      case 'shopsMix': {
        const rs = strips(A, 3, 0);
        rs.forEach((R, t) => {
          const fronts = [front, front ^ 1], blank = [];
          if (t > 0) blank.push(lo); else fronts.push(lo);
          if (t < 2) blank.push(hi); else fronts.push(hi);
          if (t === 1) B.apartment(R, { name: aname(), floors: 5, wall: M.brick_red, front, balc: [front, front ^ 1], balcFrac: 0.7, blank, paint: 'ROOMS', base: M.stone, shopFront: front ^ 1, bays: [7, 6, 8, 5] });
          else mkShop(R, { fronts, blank, floors: t === 0 ? 2 : 1 });
        });
        break;
      }
    }
  },

  plazaBlock(p, A, rng) {
    const cx = (p.i0 + p.i1 + 1) >> 1, cz = (p.k0 + p.k1 + 1) >> 1;
    surface(p.i0 + 1, p.k0 + 1, p.i1 - 1, p.k1 - 1, M.stone, 3);
    C.cur = null;
    const S = (i, k, m) => put(i, J0 - 1, k, m);
    for (let k = p.k0 + 1; k < p.k1; k++) for (let i = p.i0 + 1; i < p.i1; i++) {
      const dx = i - cx + 0.5, dz = k - cz + 0.5, d = Math.sqrt(dx * dx + dz * dz), ang = Math.atan2(dz, dx);
      let m = 0;
      if (d < 2.5) m = M.tile_teal; else if (d < 4) m = M.tile_white;
      else if (d < 10.5) m = (Math.floor((ang + Math.PI) / (Math.PI / 8)) & 1) ? M.tile_teal : M.tile_white;
      else if (d < 12) m = M.concrete_dark;
      else if (d >= 15 && d < 16) m = M.tile_white;
      else if (Math.abs(dx) < 1 || Math.abs(dz) < 1) m = M.tile_white;
      else if (((i - p.i0) % 6 === 0) || ((k - p.k0) % 6 === 0)) m = M.sidewalk;
      if (m) S(i, k, m);
    }
    // corner planters with trees, benches, lamps
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const i = sx < 0 ? A.i0 + 1 : A.i1 - 7, k = sz < 0 ? A.k0 + 1 : A.k1 - 7;
      box(i, J0, k, i + 6, J0, k + 6, M.stone); box(i + 1, J0, k + 1, i + 5, J0, k + 5, M.grass);
      PR.tree(i + 3, k + 3, 2, J0 + 1);
      PR.bench(sx < 0 ? i + 8 : i - 5, sz < 0 ? k + 2 : k + 3, 0); PR.bench(sx < 0 ? i + 2 : i + 3, sz < 0 ? k + 8 : k - 5, 1);
      PR.parkLamp(sx < 0 ? i - 1 : i + 7, sz < 0 ? k + 8 : k - 2);              // lamps hug the edge: the centre stays clear
    }
    // monument on the north edge, reflecting pool on the south edge
    const b = begin('monument', 'Founders Column');
    box(cx - 3, J0, A.k0 + 1, cx + 2, J0 + 1, A.k0 + 6, M.stone); box(cx - 2, J0 + 2, A.k0 + 2, cx + 1, J0 + 4, A.k0 + 5, M.stone);
    box(cx - 1, J0 + 5, A.k0 + 3, cx, J0 + 20, A.k0 + 4, M.concrete_dark); box(cx - 1, J0 + 21, A.k0 + 3, cx, J0 + 22, A.k0 + 4, M.copper);
    put(cx - 1, J0 + 23, A.k0 + 3, M.light_amber); put(cx, J0 + 23, A.k0 + 4, M.light_amber); put(cx, J0 + 23, A.k0 + 3, M.light_amber); put(cx - 1, J0 + 23, A.k0 + 4, M.light_amber);
    for (let j = J0 + 8; j < J0 + 20; j += 4) ring(cx - 2, j, A.k0 + 2, cx + 1, j, A.k0 + 5, M.copper);
    end();
    box(cx - 9, J0 - 1, A.k1 - 6, cx + 8, J0 - 1, A.k1, M.stone);                // flush pool, nothing stands up near the centre
    box(cx - 8, J0 - 1, A.k1 - 5, cx + 7, J0 - 1, A.k1 - 1, M.water);
    for (const dx of [-12, 12]) { PR.parkLamp(cx + dx, A.k1 + 1); PR.parkLamp(cx + dx, A.k0 + 1); }
    for (const dz of [-8, 7]) { PR.planter(A.i0 + 1, cz + dz - 2, 3, 5, false); PR.planter(A.i1 - 3, cz + dz - 2, 3, 5, false); }
    // infantry cover on the plaza rim (outside the display circle)
    for (const sg of [-1, 1]) {
      PR.barrierRow(cx + sg * 14 - 5, A.k0 - 2, 0, 11); PR.barrierRow(cx + sg * 14 - 5, A.k1 + 2, 0, 11);
      PR.barrierRow(A.i0 - 2, cz + sg * 15 - 5, 1, 11); PR.barrierRow(A.i1 + 2, cz + sg * 15 - 5, 1, 11);
    }
    PR.sandbagNest(A.i0 + 9, A.k1 - 3, 0, -1); PR.sandbagNest(A.i1 - 14, A.k0 + 1, 0, 1);
    PR.crateCover(A.i0 + 9, A.k0 + 1, 0); PR.crateCover(A.i1 - 14, A.k1 - 2, 0);
    // guarantee: nothing above the paving within 7 m of the centre (14 m display circle)
    for (let a = -15; a <= 15; a++) for (let c = -15; c <= 15; c++) if (a * a + c * c <= 15 * 15) for (let j = J0; j < 30; j++) if (get(cx + a, j, cz + c)) put(cx + a, j, cz + c, 0);
    this.plaza = { x: cx * VS, z: cz * VS, r: 7 };
  },

  parkBlock(p, A, rng) {
    surface(A.i0, A.k0, A.i1, A.k1, M.grass, 3);
    C.cur = null;
    const cx = (A.i0 + A.i1) >> 1, cz = (A.k0 + A.k1) >> 1;
    // low wall with gates at the middle of every side
    ring(A.i0, J0, A.k0, A.i1, J0, A.k1, M.stone);
    for (let i = A.i0 + 2; i < A.i1 - 1; i++) if (Math.abs(i - cx) > 3) { put(i, J0 + 1, A.k0, M.foliage); put(i, J0 + 1, A.k1, M.foliage); }
    for (let k = A.k0 + 2; k < A.k1 - 1; k++) if (Math.abs(k - cz) > 3) { put(A.i0, J0 + 1, k, M.foliage); put(A.i1, J0 + 1, k, M.foliage); }
    box(cx - 2, J0, A.k0, cx + 2, J0, A.k0, 0); box(cx - 2, J0, A.k1, cx + 2, J0, A.k1, 0); box(A.i0, J0, cz - 2, A.i0, J0, cz + 2, 0); box(A.i1, J0, cz - 2, A.i1, J0, cz + 2, 0);
    for (const [i, k] of [[cx - 3, A.k0], [cx + 3, A.k0], [cx - 3, A.k1], [cx + 3, A.k1], [A.i0, cz - 3], [A.i0, cz + 3], [A.i1, cz - 3], [A.i1, cz + 3]]) { box(i, J0, k, i, J0 + 2, k, M.stone); put(i, J0 + 3, k, M.light_white); }
    // paths
    const path = (i0, k0, i1, k1) => box(i0, J0 - 1, k0, i1, J0 - 1, k1, M.sidewalk);
    path(cx - 1, A.k0, cx + 1, A.k1); path(A.i0, cz - 1, A.i1, cz + 1);
    for (let t = -30; t <= 30; t++) { const i = cx + t, k = cz + Math.round(t * 0.72); if (i > A.i0 + 1 && i < A.i1 - 1 && k > A.k0 + 1 && k < A.k1 - 1) { path(i, k, i + 1, k + 1); } }
    // fountain
    for (let a = -7; a <= 7; a++) for (let c = -7; c <= 7; c++) {
      const d = Math.sqrt(a * a + c * c);
      if (d < 7.4) put(cx + a, J0 - 1, cz + c, d < 5 ? M.water : M.stone);
      if (d >= 5 && d < 6.2) put(cx + a, J0, cz + c, M.stone);
    }
    box(cx, J0 - 1, cz, cx, J0 + 3, cz, M.stone); box(cx - 1, J0 + 2, cz - 1, cx + 1, J0 + 2, cz + 1, M.stone); put(cx, J0 + 4, cz, M.light_white);
    // trees on a jittered grid, benches, lamps
    this._pav = { i: A.i0 + 9, k: A.k1 - 9 };
    for (let a = A.i0 + 5; a < A.i1 - 3; a += 8) for (let c = A.k0 + 5; c < A.k1 - 3; c += 8) {
      const i = a + rng.int(-1, 2), k = c + rng.int(-1, 2), d = Math.hypot(i - cx, k - cz);
      if (d < 11 || Math.abs(i - cx) < 4 || Math.abs(k - cz) < 4) continue;
      if (this._pav && Math.abs(i - this._pav.i) < 9 && Math.abs(k - this._pav.k) < 9) continue;
      PR.tree(i, k, rng() < 0.4 ? 2 : 1);
    }
    for (const s of [-1, 1]) { PR.bench(cx - 2 + s * 9, cz + 2, 0); PR.bench(cx + 2, cz - 2 + s * 9, 1); PR.parkLamp(cx + s * 9, cz - 3); PR.parkLamp(cx - 3, cz + s * 9); }
    // bandstand
    const pi = A.i0 + 5, pk = A.k1 - 13;
    begin('pavilion', 'Park bandstand');
    box(pi, J0, pk, pi + 8, J0, pk + 8, M.wood); box(pi + 3, J0, pk - 1, pi + 5, J0, pk - 1, M.wood_dark);
    for (const [a, c] of [[0, 0], [8, 0], [0, 8], [8, 8], [4, 8], [0, 4], [8, 4]]) box(pi + a, J0 + 1, pk + c, pi + a, J0 + 6, pk + c, M.wood_dark);
    for (let a = 0; a <= 8; a++) { put(pi + a, J0 + 2, pk + 8, M.wood); put(pi, J0 + 2, pk + a, M.wood); put(pi + 8, J0 + 2, pk + a, M.wood); }
    for (let t = 0; t < 5; t++) box(pi - 1 + t, J0 + 7 + t, pk - 1 + t, pi + 9 - t, J0 + 7 + t, pk + 9 - t, t === 0 ? M.wood_dark : M.roof_tile);
    put(pi + 4, J0 + 12, pk + 4, M.copper); put(pi + 4, J0 + 6, pk + 4, M.light_white);
    end();
    // clear trees that grew into the bandstand: none are planted near it
  },

  // ------------------------------------------------------------------ gas mains & tankers
  utilities(rng, mx, mz) {
    C.cur = null;
    const JP = J0 - 2, mains = this.gasMains, bAt = this.buildingAt, sp = this.spawns.player;
    mains.length = 0; this.tankers.length = 0;
    const pt = (i, k, j = JP) => ({ x: (i + 0.5) * VS, y: (j + 0.5) * VS, z: (k + 0.5) * VS });
    const valve = (i, k) => { put(i, J0 - 1, k, M.pipe); put(i + 1, J0 - 1, k, M.hazard); };
    // trunk lines one voxel under the asphalt: two avenues and two cross streets, lane-centre
    const NS = [roadX(mx ? 2 : 1) + 6, roadX(mx ? 0 : 3) + 15], EW = [roadZ(mz ? 2 : 1) + 6, roadZ(mz ? 0 : 3) + 15];
    for (const i of NS) { box(i, JP, 12, i, JP, NZ - 13, M.gas_pipe); mains.push([pt(i, 12), pt(i, NZ - 13)]); for (let k = 30; k < NZ - 20; k += 26) valve(i, k); }
    for (const k of EW) { box(12, JP, k, NX - 13, JP, k, M.gas_pipe); mains.push([pt(12, k), pt(NX - 13, k)]); for (let i = 43; i < NX - 20; i += 26) valve(i, k); }
    // service branches: from a trunk sideways under the sidewalk to the first facade, then a riser up the wall
    const riser = (i, k, di, dk) => {
      let n = 1; for (; n < 24; n++) if (bAt[i + di * n + NX * (k + dk * n)]) break;
      if (n >= 24 || n < 6) return;
      const ei = i + di * (n - 1), ek = k + dk * (n - 1);
      for (let j = J0; j < J0 + 6; j++) if (get(ei, j, ek)) return;          // something already stands there
      box(i, JP, k, ei, JP, ek, M.gas_pipe);
      box(ei, J0 - 1, ek, ei, J0 + 5, ek, M.gas_pipe); put(ei, J0 + 2, ek, M.hazard);
      put(ei + di, J0 + 5, ek + dk, M.gas_pipe);                              // elbow into the wall
      mains.push([pt(i, k), pt(ei, ek), pt(ei, ek, J0 + 5)]);
    };
    for (const r of [0, 1, 3, 4]) { riser(NS[0], Z0[r] + 12 + r * 3, r & 1 ? 1 : -1, 0); riser(NS[1], Z0[r] + PWZ[r] - 14 - r * 2, r & 1 ? -1 : 1, 0); }
    for (const r of [0, 1, 3, 4]) { riser(X0[r] + 13 + r * 2, EW[0], 0, r & 1 ? -1 : 1); riser(X0[r] + PWX[r] - 15 - r, EW[1], 0, r & 1 ? 1 : -1); }
    // tankers in the kerb lane, mid-block, never near the player spawn
    const spots = [[0, 1, 3], [3, 0, 1], [4, 3, 2], [1, 4, 0], [3, 2, 1]];
    for (const [bx, bz, si] of spots) {
      if (this.tankers.length >= 4) break;
      const p = parcel(bx, bz), ax = si < 2 ? 0 : 1, fwd = [1, -1, -1, 1][si];
      const a = (ax === 0 ? (p.i0 + p.i1) >> 1 : (p.k0 + p.k1) >> 1) - 8;
      const i = ax === 0 ? a : (si === 3 ? p.i1 + 1 : p.i0 - 5), k = ax === 0 ? (si === 1 ? p.k1 + 1 : p.k0 - 5) : a;
      const x = (i + (ax === 0 ? 8 : 2.5)) * VS, z = (k + (ax === 0 ? 2.5 : 8)) * VS;
      if (Math.abs(x - sp.x) < 14 && Math.abs(z - sp.z) < 20) continue;
      PR.tanker(i, J0, k, ax, fwd);
      this.tankers.push({ x, z, y: J0 * VS, yaw: ax === 0 ? (fwd > 0 ? Math.PI / 2 : -Math.PI / 2) : (fwd > 0 ? 0 : Math.PI), length: 8, width: 2.5, i0: i, k0: k, i1: i + (ax === 0 ? 15 : 4), k1: k + (ax === 0 ? 4 : 15) });
    }
  },

  // ------------------------------------------------------------------ street furniture & vehicles
  furniture(rng, mx, mz) {
    C.cur = null;
    const lot = this.lot, bAt = this.buildingAt;
    const free = (i, k, h = 8) => { for (let j = J0; j < J0 + h; j++) if (get(i, j, k)) return false; return true; };
    const spawnRoad = mx ? 2 : 1;
    for (let bz = 0; bz < 5; bz++) for (let bx = 0; bx < 5; bx++) {
      const p = parcel(bx, bz), kind = TEMPLATE[mz ? 4 - bz : bz][mx ? 4 - bx : bx];
      // side descriptors: fixed coordinate of the curb row, run range, outward normal
      const sides = [
        { ax: 0, c: p.k0, a0: p.i0, a1: p.i1, n: -1 }, { ax: 0, c: p.k1, a0: p.i0, a1: p.i1, n: 1 },
        { ax: 1, c: p.i0, a0: p.k0, a1: p.k1, n: -1 }, { ax: 1, c: p.i1, a0: p.k0, a1: p.k1, n: 1 },
      ];
      sides.forEach((s, si) => {
        const at = (a, off) => s.ax === 0 ? [a, s.c - s.n * off] : [s.c - s.n * off, a];     // off = voxels inward from the curb
        const L = s.a1 - s.a0 + 1;
        // lamps
        const nl = 2;
        for (let t = 0; t < nl; t++) {
          const a = s.a0 + Math.round((t + 0.5) * L / nl) + (t & 1 ? 1 : -1);
          const [i, k] = at(a, 1);
          if (free(i, k, 12)) PR.lamp(i, k, s.ax === 0 ? 0 : s.n, s.ax === 0 ? s.n : 0);
        }
        // street trees, bins, hydrants, benches on the outer two sidewalk rows
        if (kind !== 'plaza' && kind !== 'gas') for (let a = s.a0 + 9; a < s.a1 - 8; a += 7) {
          const r = rng(); const [i, k] = at(a, 1); const [i2, k2] = at(a, 2);
          if (!free(i, k, 12) || !free(i2, k2, 6)) continue;
          let near = false; for (let d = -3; d <= 3; d++) { const [ii, kk] = at(a + d, 1); if (!free(ii, kk, 3)) near = true; }
          if (near) continue;
          if (r < 0.34 && kind !== 'construction' && kind !== 'parking') { put(i, J0 - 1, k, M.dirt); PR.tree(i, k, 0); }
          else if (r < 0.42) PR.bin(i, k);
          else if (r < 0.47) PR.hydrant(i, k);
          else if (r < 0.52) PR.bollard(i, k);
          else if (r < 0.58 && free(...at(a + 3, 2), 3)) PR.bench(...at(a, 2), s.ax);
        }
        // parked cars in the kerb lane
        const fwd = [1, -1, -1, 1][si];
        if (kind !== 'plaza') for (let a = s.a0 + 16; a + 9 < s.a1 - 15; a += 12) {
          const roll = rng();
          { const [ti, tk] = s.ax === 0 ? [a + 4, s.n > 0 ? s.c + 2 : s.c - 2] : [s.n > 0 ? s.c + 2 : s.c - 2, a + 4]; if (get(ti, J0, tk) || get(s.ax === 0 ? ti + 6 : ti, J0, s.ax === 0 ? tk : tk + 6) || get(s.ax === 0 ? ti - 4 : ti, J0, s.ax === 0 ? tk : tk - 4)) continue; }
          if (roll > 0.42) {   // no car here: sometimes infantry cover instead, hugging the kerb
            if (roll < 0.62 && kind !== 'gas') {
              const o1 = s.n > 0 ? s.c + 3 : s.c - 3, o0 = s.n > 0 ? s.c + 1 : s.c - 3, t = (roll * 1000 | 0) % 3;
              if (t === 0) PR.barrierRow(s.ax === 0 ? a : o1, s.ax === 0 ? o1 : a, s.ax, 11);
              else if (t === 1) PR.sandbagNest(s.ax === 0 ? a + 1 : o0, s.ax === 0 ? o0 : a + 1, s.ax, s.n);
              else PR.crateCover(s.ax === 0 ? a + 1 : o0 + (s.n > 0 ? 0 : 1), s.ax === 0 ? o0 + (s.n > 0 ? 0 : 1) : a + 1, s.ax);
            }
            continue;
          }
          { const sp = this.spawns.player, cx = (s.ax === 0 ? a + 4 : s.c) * VS, cz = (s.ax === 0 ? s.c : a + 4) * VS; if (Math.abs(cx - sp.x) < 9 && Math.abs(cz - sp.z) < 12) continue; }
          if (kind === 'gas' && rng() < 0.7) continue;
          const jit = rng.int(0, 2), [i, k] = s.ax === 0 ? [a + jit, s.n > 0 ? s.c + 1 : s.c - 4] : [s.n > 0 ? s.c + 1 : s.c - 4, a + jit];
          if (rng() < 0.08 && a + 13 < s.a1 - 15) PR.truck(s.ax === 0 ? i : (s.n > 0 ? i : i - 1), J0, s.ax === 0 ? (s.n > 0 ? k : k - 1) : k, s.ax, fwd, rng.pick([M.car_white, M.metal_panel, M.car_yellow]));
          else PR.car(i, J0, k, s.ax, fwd);
        }
      });
      // traffic lights on the four corners
      for (const [ci, ck] of [[p.i0 + 1, p.k0 + 1], [p.i1 - 1, p.k1 - 1]]) if (free(ci, ck, 12)) PR.trafficLight(ci, ck, (bx + bz) & 1);
    }
    // outer rim: lamps and the odd tree so the ring road has an edge
    for (let t = RING + 14; t < NX - RING - 8; t += 30) {
      PR.lamp(t, 1, 0, 1); PR.lamp(t + 15, NZ - 2, 0, -1); PR.lamp(1, t + 15, 1, 0); PR.lamp(NX - 2, t, -1, 0);
      if (rng() < 0.6) PR.tree(t + 9, 1, 0); if (rng() < 0.6) PR.tree(t + 22, NZ - 2, 0); if (rng() < 0.6) PR.tree(1, t + 5, 0); if (rng() < 0.6) PR.tree(NX - 2, t + 12, 0);
    }
    // a bus at a stop on the avenue east of the plaza, a couple of vehicles stopped in lanes
    const bxr = roadX(mx ? 1 : 2), pz = parcel(2, 2);
    PR.bus(bxr + RW - 6, J0, pz.k0 + 14, 1, 1);
    const sx = bxr + RW + 2; if (free(sx, pz.k0 + 30, 8) && free(sx, pz.k0 + 39, 8)) PR.busStop(sx, pz.k0 + 30, 1, 1); else PR.busStop(bxr - 3, pz.k0 + 30, 1, -1);
    const lanes = [[0, 1], [1, 3], [2, 0], [3, 2], [1, 0], [2, 4], [0, 3], [3, 1]];
    for (const [n, r] of lanes) {
      if (rng() < 0.25) continue;
      const vert = rng() < 0.5;
      if (vert) { if (n === spawnRoad && (mz ? r === 0 : r === 4)) continue; const up = rng() < 0.5; PR.car(roadX(n) + (up ? 13 : 5), J0, Z0[r] + rng.int(16, PWZ[r] - 26), 1, up ? -1 : 1); }
      else { const e = rng() < 0.5; PR.car(X0[r] + rng.int(16, PWX[r] - 26), J0, roadZ(n) + (e ? 13 : 5), 0, e ? 1 : -1); }
    }
    // billboards on poles along the ring
    const bb = [['ORBIT', M.neon_cyan], ['VOLT', M.neon_orange], ['KILO FM', M.neon_magenta]];
    const spots = [[X0[1] + 20, 0, 0, 1], [NX - 1, Z0[3] + 14, 1, -1], [X0[3] + 8, NZ - 1, 0, -1]];
    spots.forEach(([i, k, ax, face], n) => PR.billboard(i, J0 + 12, k, ax, 27, 10, 12, bb[n][0], face, bb[n][1]));
  },

  // ------------------------------------------------------------------ metadata
  meta(mx, mz) {
    const g = G.grid, sp = this.spawns;
    this.streets.x = LX.map(v => v * VS); this.streets.z = LZ.map(v => v * VS);
    // road graph
    const nodes = this.roadNodes; nodes.length = 0;
    const id = (a, c) => a + 6 * c;
    for (let c = 0; c < 6; c++) for (let a = 0; a < 6; a++) nodes.push({ x: LX[a] * VS, z: LZ[c] * VS, links: [] });
    const link = (p, q) => { if (!nodes[p].links.includes(q)) nodes[p].links.push(q); if (!nodes[q].links.includes(p)) nodes[q].links.push(p); };
    const unlink = (p, q) => { nodes[p].links = nodes[p].links.filter(n => n !== q); nodes[q].links = nodes[q].links.filter(n => n !== p); };
    for (let c = 0; c < 6; c++) for (let a = 0; a < 6; a++) { if (a < 5) link(id(a, c), id(a + 1, c)); if (c < 5) link(id(a, c), id(a, c + 1)); }
    // plaza: centre node tied to the middle of the four streets around it
    const pc = nodes.length; nodes.push({ x: this.plaza.x, z: this.plaza.z, links: [] });
    const mids = [[id(2, 2), id(3, 2), this.plaza.x, LZ[2] * VS], [id(2, 3), id(3, 3), this.plaza.x, LZ[3] * VS], [id(2, 2), id(2, 3), LX[2] * VS, this.plaza.z], [id(3, 2), id(3, 3), LX[3] * VS, this.plaza.z]];
    for (const [p, q, x, z] of mids) { const n = nodes.length; nodes.push({ x, z, links: [] }); unlink(p, q); link(p, n); link(n, q); link(n, pc); }
    // spawns
    sp.edge.length = 0; sp.air.length = 0; sp.mechDrops.length = 0;
    const E = 4, FX = NX * VS - E, FZ = NZ * VS - E;
    for (let n = 1; n <= 4; n++) { sp.edge.push({ x: LX[n] * VS, z: E }, { x: LX[n] * VS, z: FZ }, { x: E, z: LZ[n] * VS }, { x: FX, z: LZ[n] * VS }); }
    sp.edge.push({ x: E, z: E }, { x: FX, z: E }, { x: E, z: FZ }, { x: FX, z: FZ });
    const W = NX * VS, H = 44;
    for (const [x, z] of [[5, 5], [W / 2, 3], [W - 5, 5], [W - 3, W / 2], [W - 5, W - 5], [W / 2, W - 3], [5, W - 5], [3, W / 2], [W * 0.27, 3], [W * 0.73, W - 3], [3, W * 0.73], [W - 3, W * 0.27]]) sp.air.push({ x, y: H, z });
    // rig landing zones: every candidate must be a clear 10 m square up to rig height
    const clear = (x, z) => !g.boxSolid(x - 5, GROUND_J * VS + 0.05, z - 5, x + 5, GROUND_J * VS + 9, z + 5);
    const cand = [];
    for (let c = 1; c <= 4; c++) for (let a = 1; a <= 4; a++) cand.push([LX[a] * VS, LZ[c] * VS]);
    cand.push([this.plaza.x, this.plaza.z]);
    for (let n = 1; n <= 4; n++) cand.push([LX[n] * VS, 7.25], [LX[n] * VS, W - 7.25], [7.25, LZ[n] * VS], [W - 7.25, LZ[n] * VS]);
    for (const [x, z] of cand) if (clear(x, z)) sp.mechDrops.push({ x, z });
    // mission sites: 12 m clear squares, ordered so the first few are far apart and away from the player spawn
    const clear12 = (x, z) => !g.boxSolid(x - 6, GROUND_J * VS + 0.05, z - 6, x + 6, GROUND_J * VS + 12, z + 6);
    this.sites.length = 0;
    const order = [[1, 1], [4, 4], [4, 1], [1, 4], [2, 4], [3, 1], [1, 3], [4, 2], [2, 1], [3, 4], [1, 2], [4, 3], [2, 2], [3, 3], [3, 2], [2, 3]];
    const far = [], near = [];
    for (const [a, c] of order) { const x = LX[a] * VS, z = LZ[c] * VS; if (!clear12(x, z)) continue; (Math.hypot(x - sp.player.x, z - sp.player.z) > 45 ? far : near).push({ x, z, kind: 'intersection', clear: 12 }); }
    this.sites.push(...far, ...near);
    if (clear12(this.plaza.x, this.plaza.z)) this.sites.push({ x: this.plaza.x, z: this.plaza.z, kind: 'plaza', clear: 14 });
    // citadel: the tallest building on the block north of the plaza (streets on all four sides)
    { const p = parcel(2, 1); let best = null;
      for (const b of this.buildings) if (b.i1 >= p.i0 && b.i0 <= p.i1 && b.k1 >= p.k0 && b.k0 <= p.k1 && (b.kind === 'office' || b.kind === 'hotel') && (!best || b.j1 > best.j1)) best = b;
      this.citadel = best ? best.id : -1; }
    // player: on the avenue beside the plaza, at the far end, looking down its whole length
    let px = sp.player.x, pz = sp.player.z;
    for (let t = 0; t < 12 && g.boxSolid(px - 1, GROUND_J * VS + 0.05, pz - 1, px + 1, GROUND_J * VS + 3, pz + 1); t++) pz += mz ? 1.5 : -1.5;
    sp.player = { x: px, z: pz, yaw: mz ? 0 : Math.PI };
  },
};
function shuffle(a, rng) { for (let n = a.length - 1; n > 0; n--) { const m = Math.floor(rng() * (n + 1)); const t = a[n]; a[n] = a[m]; a[m] = t; } return a; }
export default city;
