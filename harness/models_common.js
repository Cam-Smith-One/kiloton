// MODELS look-dev harness (shared by harness/models.js and harness/models_real.js). Query params: see notes/models.md
export function setup(G, opts = {}) {
  const THREE = G.THREE, P = G.params;
  const num = (k, d) => P.has(k) ? parseFloat(P.get(k)) : d;
  const kinds = (P.get('kind') || 'mech').split(',');
  const ALL = [['pilot'], ['soldier', 'rifle'], ['soldier', 'rocketeer'], ['soldier', 'ace'], ['drone'], ['tank'], ['gunship'], ['mech'], ['emech', 'standard'], ['emech', 'heavy']];
  let list = kinds[0] === 'all' ? ALL : kinds.map(k => k.split(':'));
  const bx = num('x', 40), bz = num('z', 40), gy = G.GROUND_Y, gap = num('gap', 0);
  const yaw = num('yaw', 0);
  const rigs = [];
  let x = bx;
  for (const parts of list) {
    const [kind, variant] = parts;
    let rig;
    if (kind === 'rig') {           // rig:<default loadout index>  or  rig:<chassis>:<armL>:<armR>:<shL>:<shR>:<back>   (+ &paint=id)
      const R = G.rigs;
      let lo = isNaN(+variant) ? { chassis: variant, slots: { armL: parts[2] || 'none', armR: parts[3] || 'none', shL: parts[4] || 'none', shR: parts[5] || 'none', back: parts[6] || 'none' }, paint: 'teal' } : Object.assign({}, R.DEFAULT_LOADOUTS[+variant]);
      if (P.has('paint')) lo = Object.assign({}, lo, { paint: P.get('paint') });
      rig = G.models.create('mech', { loadout: lo });
      if (P.has('shield')) rig.setShield(num('shield', 1)); if (P.has('lost')) rig.setLimbLost(P.get('lost'));
    } else rig = G.models.create(kind, { variant });
    const w = Math.max(rig.radius * 2.6, 1.6) + gap;
    x += w / 2; rig.root.position.set(x, gy + (rig.kind === 'drone' || rig.kind === 'gunship' ? num('alt', 4) : 0) + num('y', 0), bz); x += w / 2;
    rig.root.rotation.y = yaw; G.scene.add(rig.root); rigs.push(rig);
    rig.steps = 0; rig.onFootstep = (side, p, heavy) => { rig.steps++; rig.lastStep = [side, +p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2), heavy]; };
  }
  const cx = (bx + x) / 2;
  const s = { speed: num('speed', 0), fwd: num('fwd', 1), strafe: num('strafe', 0), aimYaw: num('aimYaw', 0), aimPitch: num('aimPitch', 0), grounded: !P.has('air'), vy: num('vy', 0), jet: num('jet', 0), heat: num('heat', 0), dead: P.has('dead'), slide: num('slide', 0), crouch: num('crouch', 0) };
  const trigs = (P.get('trig') || '').split(',').filter(Boolean).map(t => { const a = t.split(':'); return { name: a[0], arg: a[1] === '' || a[1] == null ? undefined : isNaN(+a[1]) ? a[1] : +a[1], age: parseFloat(a[2] || '0') }; });
  const T = num('t', 2), dt = 1 / 60, N = Math.round(T / dt);
  const dmg = num('dmg', 0);
  const dl = P.has('dmgs') ? P.get('dmgs').split(',').map(Number) : null;
  rigs.forEach((r, i) => { const d = dl ? (dl[i] || 0) : dmg; if (d) r.setDamage(d); });
  const move = P.has('move');
  for (let i = 0; i <= N; i++) {
    for (const tr of trigs) if (i === N - Math.round(tr.age / dt)) for (const r of rigs) r.trigger(tr.name, tr.arg);
    for (const r of rigs) { if (move) { r.root.position.x += Math.sin(yaw) * s.speed * dt; r.root.position.z += Math.cos(yaw) * s.speed * dt; } r.update(dt, s); }
  }
  if (G.uiRoot) G.uiRoot.style.display = 'none';
  // camera
  const tgt = move ? rigs[0].root.position.clone() : new THREE.Vector3(cx, gy, bz); if (move) tgt.y = gy;
  const H = rigs.reduce((m, r) => Math.max(m, r.height), 0), dist = num('dist', H * 1.3 + (x - bx) * 0.5);
  const view = P.get('view') || 'q34';
  const V = { back: [0, 0.25, -1, 0.5], front: [0, 0.15, 1, 0.5], side: [1, 0.1, 0, 0.5], sideR: [-1, 0.1, 0, 0.5], q34: [0.62, 0.25, 0.78, 0.5], q34b: [-0.6, 0.38, -0.8, 0.5], chase: [0, 0.6, -1, 0.75], top: [0.01, 1, -0.3, 0.5], low: [0.5, 0.08, 0.85, 0.55], title: [-0.55, 0.12, 0.83, 0.6] }[view] || [0.62, 0.5, 0.78, 0.5];
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const off = new THREE.Vector3(V[0] * cy + V[2] * sy, V[1], -V[0] * sy + V[2] * cy).normalize().multiplyScalar(dist);
  const look = tgt.clone(); look.y += H * V[3] + (rigs[0].root.position.y - gy) * 0.8;
  const camPos = look.clone().add(off); if (view === 'chase') { camPos.copy(tgt).add(new THREE.Vector3(-sy * 15, 9, -cy * 15)); look.copy(tgt).add(new THREE.Vector3(sy * 8, 5.5, cy * 8)); }
  camPos.y = Math.max(camPos.y, gy + 0.4);
  if (!P.has('cam')) G.player.update = () => { G.camera.position.copy(camPos); G.camera.lookAt(look); if (P.has('fov')) { G.camera.fov = num('fov', 62); G.camera.updateProjectionMatrix(); } };
  // live animation
  if (P.has('live')) { const pu = G.player.update; G.player.update = (d) => { pu(d); for (const r of rigs) r.update(d, s); }; }
  // look-dev lighting on the baseline renderer
  if (opts.lit !== false && !P.has('nolit')) {
    const r = G.renderer; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    G.scene.background = new THREE.Color(0xa9b7cf); if (G.scene.fog) G.scene.fog.color.set(0xb9bccb);
    const sd = new THREE.Vector3(0.55, 0.42, 0.5).normalize(); if (P.has('sun')) { const a = P.get('sun').split(',').map(Number); sd.set(a[0], a[1], a[2]).normalize(); }
    G.scene.traverse(o => {
      if (o.isDirectionalLight) { o.color.set(0xffd2a0); o.intensity = 3.4; o.position.copy(tgt).addScaledVector(sd, 60); o.target.position.copy(tgt); G.scene.add(o.target); o.castShadow = true; const c = o.shadow.camera, e = Math.max(14, (x - bx) * 0.6 + 8); c.left = -e; c.right = e; c.top = e; c.bottom = -e; c.near = 1; c.far = 140; c.updateProjectionMatrix(); o.shadow.mapSize.set(1024, 1024); o.shadow.bias = -0.0004; o.shadow.normalBias = 0.03; }
      if (o.isHemisphereLight) { o.color.set(0x9db4e8); o.groundColor.set(0x6a5a4a); o.intensity = 1.25; }
      if (o.isMesh && o.material && o.material.isMeshLambertMaterial) o.receiveShadow = true;
    });
  }
  // freeze: stop drawing after a few frames so headless screenshots stay cheap on a loaded machine
  if (!P.has('live')) { const rr = G.render.render.bind(G.render); let nf = 0; G.render.render = (d) => { if (nf++ < num('frames', 3)) rr(d); else window.HM.frozen = true; }; }
  window.HM = { rigs, s, step(n = 1, d = dt) { for (let i = 0; i < n; i++) for (const r of rigs) r.update(d, s); return rigs.map(r => r.steps); }, trig(n, a) { for (const r of rigs) r.trigger(n, a); },
    info() { return rigs.map(r => { let tris = 0, meshes = 0; r.root.traverse(o => { if (o.isMesh) { meshes++; tris += o.geometry.attributes.position.count / 3; } }); const b = new THREE.Box3().setFromObject(r.root); return { kind: r.kind, variant: r.variant, meshes, tris, min: b.min.toArray().map(v => +v.toFixed(2)), max: b.max.toArray().map(v => +v.toFixed(2)), steps: r.steps, lastStep: r.lastStep, sockets: Object.keys(r.sockets).join(' ') }; }); } };
}
