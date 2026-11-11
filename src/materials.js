// ============================================================================
// KILOTON — materials.js   OWNER: lead. Other modules must not edit this file.
// Voxel material table. A voxel is one byte: 0 = air, else an id from M.
//   strength : explosive power needed to break it (0..255). 255 = indestructible.
//   density  : relative mass (debris damage, structural load)
//   solid    : collides with bodies and bullets (foliage does not)
//   glass    : drawn translucent; shatters into shards
//   emissive : 0..4 glow multiplier (bloom picks this up)
//   debris   : 'chunk' | 'shard' | 'splinter' | 'dust' | 'none'  (what flies off when it breaks)
//   sound    : 'concrete' | 'metal' | 'glass' | 'wood' | 'dirt' | 'soft'
//   struct   : 1 = carries load (walls, columns, slabs), 0 = cladding / props (never holds anything up)
// ============================================================================
const T = [];
const def = (id, name, color, o = {}) => {
  T[id] = Object.assign({ id, name, color, strength: 60, density: 1, rough: 0.85, metal: 0, emissive: 0, glass: false, solid: true, debris: 'chunk', sound: 'concrete', struct: 1, flammable: false }, o);
};
def(0, 'air', 0x000000, { solid: false, strength: 0, density: 0, debris: 'none', struct: 0 });
def(1, 'bedrock', 0x24262b, { strength: 255, density: 3 });
def(2, 'dirt', 0x5b4a3a, { strength: 55, sound: 'dirt', debris: 'dust', rough: 1 });
def(3, 'asphalt', 0x2f3237, { strength: 75, rough: 0.92 });
def(4, 'line_white', 0xd9d9d2, { strength: 75, rough: 0.8 });
def(5, 'line_yellow', 0xd6a51f, { strength: 75, rough: 0.8 });
def(6, 'sidewalk', 0x8d8f92, { strength: 70, rough: 0.9 });
def(7, 'curb', 0xa4a6a8, { strength: 72 });
def(8, 'concrete', 0x9a9c9f, { strength: 95, density: 1.4 });
def(9, 'concrete_dark', 0x5f6368, { strength: 100, density: 1.4 });
def(10, 'plaster', 0xd9d6cf, { strength: 60 });
def(11, 'brick_red', 0x9a4a3c, { strength: 70, rough: 0.95 });
def(12, 'brick_dark', 0x5e3a34, { strength: 72, rough: 0.95 });
def(13, 'brick_tan', 0xb59a7a, { strength: 70, rough: 0.95 });
def(14, 'steel_beam', 0x4a4f57, { strength: 150, density: 2.4, metal: 1, rough: 0.5, sound: 'metal' });
def(15, 'metal_panel', 0x9aa3ad, { strength: 85, density: 1.2, metal: 0.9, rough: 0.4, sound: 'metal', struct: 0 });
def(16, 'metal_dark', 0x33383f, { strength: 90, density: 1.4, metal: 0.9, rough: 0.5, sound: 'metal', struct: 0 });
def(17, 'glass', 0x7fb4d6, { strength: 12, density: 0.3, glass: true, rough: 0.05, debris: 'shard', sound: 'glass', struct: 0 });
def(18, 'glass_dark', 0x2f4a60, { strength: 14, density: 0.3, glass: true, rough: 0.05, debris: 'shard', sound: 'glass', struct: 0 });
def(19, 'window_lit', 0xffd9a0, { strength: 12, density: 0.3, glass: true, emissive: 1.6, debris: 'shard', sound: 'glass', struct: 0 });
def(20, 'wood', 0x8a623c, { strength: 35, density: 0.6, debris: 'splinter', sound: 'wood', flammable: true });
def(21, 'wood_dark', 0x4e3524, { strength: 38, density: 0.6, debris: 'splinter', sound: 'wood', flammable: true });
def(22, 'roof_tar', 0x2b2d31, { strength: 60 });
def(23, 'roof_tile', 0x8c3f31, { strength: 50 });
def(24, 'grass', 0x4f7a3a, { strength: 40, sound: 'dirt', debris: 'dust', rough: 1 });
def(25, 'foliage', 0x3d6b33, { strength: 8, density: 0.1, solid: false, debris: 'dust', sound: 'soft', struct: 0, flammable: true });
def(26, 'trunk', 0x4a3626, { strength: 40, density: 0.7, debris: 'splinter', sound: 'wood', flammable: true });
def(27, 'car_blue', 0x1f4fa8, { strength: 45, metal: 0.7, rough: 0.3, sound: 'metal', struct: 0 });
def(28, 'car_red', 0xa8271f, { strength: 45, metal: 0.7, rough: 0.3, sound: 'metal', struct: 0 });
def(29, 'car_white', 0xd8dadd, { strength: 45, metal: 0.7, rough: 0.3, sound: 'metal', struct: 0 });
def(30, 'car_yellow', 0xe0aa12, { strength: 45, metal: 0.7, rough: 0.3, sound: 'metal', struct: 0 });
def(31, 'rubber', 0x16171a, { strength: 30, density: 0.5, rough: 1, sound: 'soft', struct: 0 });
def(32, 'light_white', 0xfff1d6, { strength: 15, emissive: 3.0, debris: 'shard', sound: 'glass', struct: 0 });
def(33, 'light_red', 0xff3b2e, { strength: 15, emissive: 2.5, debris: 'shard', sound: 'glass', struct: 0 });
def(34, 'light_green', 0x3bff7a, { strength: 15, emissive: 2.5, debris: 'shard', sound: 'glass', struct: 0 });
def(35, 'light_amber', 0xffa424, { strength: 15, emissive: 2.5, debris: 'shard', sound: 'glass', struct: 0 });
def(36, 'neon_cyan', 0x2ee6ff, { strength: 15, emissive: 3.2, debris: 'shard', sound: 'glass', struct: 0 });
def(37, 'neon_magenta', 0xff3fb4, { strength: 15, emissive: 3.2, debris: 'shard', sound: 'glass', struct: 0 });
def(38, 'neon_orange', 0xff7a1a, { strength: 15, emissive: 3.2, debris: 'shard', sound: 'glass', struct: 0 });
def(39, 'floor', 0x6f6a63, { strength: 80, density: 1.2 });               // interior floor slab
def(40, 'drywall', 0xcfcbc2, { strength: 25, density: 0.5, struct: 0 });
def(41, 'furniture', 0x6b5a4a, { strength: 20, density: 0.4, debris: 'splinter', sound: 'wood', struct: 0, flammable: true });
def(42, 'rebar', 0x6a4b3a, { strength: 130, density: 1.5, metal: 1, rough: 0.7, sound: 'metal' });
def(43, 'charred', 0x1c1a19, { strength: 40, rough: 1 });
def(44, 'rubble', 0x77736d, { strength: 30, rough: 1, struct: 0 });        // settled debris
def(45, 'hazard', 0xe2b100, { strength: 80, metal: 0.6, rough: 0.5, sound: 'metal', struct: 0 });
def(46, 'awning_red', 0xa83232, { strength: 10, density: 0.2, sound: 'soft', debris: 'dust', struct: 0, flammable: true });
def(47, 'awning_green', 0x2f7d5a, { strength: 10, density: 0.2, sound: 'soft', debris: 'dust', struct: 0, flammable: true });
def(48, 'stone', 0xb8b2a6, { strength: 105, density: 1.6, rough: 0.7 });
def(49, 'hvac', 0x7d858d, { strength: 55, metal: 0.8, rough: 0.5, sound: 'metal', struct: 0 });
def(50, 'solar', 0x14213a, { strength: 20, glass: false, metal: 0.4, rough: 0.15, sound: 'glass', debris: 'shard', struct: 0 });
def(51, 'copper', 0x2f8f86, { strength: 85, metal: 0.9, rough: 0.45, sound: 'metal', struct: 0 });
def(52, 'armor_enemy', 0x3a2f33, { strength: 170, density: 2.5, metal: 1, rough: 0.4, sound: 'metal' });
def(53, 'sandbag', 0x9c8a63, { strength: 65, sound: 'dirt', debris: 'dust', struct: 0 });
def(54, 'pipe', 0x8a5a2a, { strength: 80, metal: 1, rough: 0.5, sound: 'metal', struct: 0 });
def(55, 'crate', 0xa07a45, { strength: 22, density: 0.4, debris: 'splinter', sound: 'wood', struct: 0, flammable: true });
def(56, 'barrel_red', 0xb5281f, { strength: 18, metal: 0.6, sound: 'metal', struct: 0, flammable: true, explosive: true });  // DESTRUCT chains a small blast when one breaks
def(57, 'tile_white', 0xe6e6e2, { strength: 60, rough: 0.35 });
def(58, 'tile_teal', 0x3d8f96, { strength: 60, rough: 0.35 });
def(59, 'billboard', 0xf0e9d8, { strength: 25, emissive: 0.9, struct: 0, sound: 'metal' });
def(60, 'water', 0x2d5f7a, { strength: 255, solid: false, glass: true, rough: 0.02, debris: 'none', struct: 0 });

def(61, 'gas_pipe', 0xc9b037, { strength: 60, metal: 1, rough: 0.45, sound: 'metal', struct: 0, flammable: true, explosive: true });   // gas main: breaks -> blast + jet of fire, chains along the run
def(62, 'fuel_tank', 0xb9bec4, { strength: 40, metal: 0.9, rough: 0.3, sound: 'metal', struct: 0, flammable: true, explosive: true });  // tanker truck / storage tank skin
def(63, 'barrier', 0xb7b2a8, { strength: 110, density: 1.8, struct: 0 });                                                                // jersey barrier / heavy cover block

export const MAT = T;
export const MAT_COUNT = 64;
export const M = {};                       // name -> id   (M.concrete === 8)
for (const m of T) if (m) M[m.name] = m.id;
// Flat lookup tables indexed by id (fast inner loops)
export const SOLID = new Uint8Array(256), STRENGTH = new Uint8Array(256), STRUCT = new Uint8Array(256), GLASS = new Uint8Array(256);
export const DENSITY = new Float32Array(256), EMISSIVE = new Float32Array(256);
export const COLOR = new Float32Array(256 * 3);     // linear-ish 0..1 sRGB components
for (const m of T) if (m) {
  SOLID[m.id] = m.solid ? 1 : 0; STRENGTH[m.id] = m.strength; STRUCT[m.id] = m.struct; GLASS[m.id] = m.glass ? 1 : 0;
  DENSITY[m.id] = m.density; EMISSIVE[m.id] = m.emissive;
  COLOR[m.id * 3] = ((m.color >> 16) & 255) / 255; COLOR[m.id * 3 + 1] = ((m.color >> 8) & 255) / 255; COLOR[m.id * 3 + 2] = (m.color & 255) / 255;
}
