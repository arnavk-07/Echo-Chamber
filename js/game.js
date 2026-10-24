// Echo Chamber: core game loop, sonar, noise, creature AI, HUD.
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let DPR = 1;
  // Render at device pixel ratio so text and lines stay crisp on retina screens.
  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = innerWidth;
    H = innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
  }
  addEventListener('resize', resize);
  resize();

  // ---- Tuning ---------------------------------------------------------------
  const CFG = {
    player: { sneak: 60, walk: 120, run: 200, radius: 9, accel: 12 },
    noise: { walk: 2, run: 6, tap: 5, pingMin: 8, pingMax: 14, throwImpact: 10, radio: 9,
             hide: 3, pickup: 4, gasp: 4, breath: 2, ventDelta: -3, waterDelta: 3,
             creak: 6, snap: 8, struggle: 6, shock: 5, alarm: 20, taskFail: 7 },
    sonar: { tapRange: 200, pingRange: 560, chargeTime: 1.2, tapCd: 1.0, pingCd: 2.5,
             ringSpeed: 600, fade: 4.5, raysTap: 120, raysPing: 360 },
    creature: { patrol: 80, investigate: 120, search: 90, chase: 190, chaseTrigger: 5,
                loseTrack: 3, radius: 11, perKeyHearing: 0.1, perKeySpeed: 0.05 },
    breathMax: 6,
    breathRefill: 4,
    radioDur: 12,
    radioCharges: 3,
    throwRange: 7 * TILE,
    maxThrowables: 3,
    days: 5, // Granny-style: each capture costs a day
    dropNoise: 5,
    directorTick: 12,
    directorCooldown: 15,
    lightRadius: 80, // small always-on light: you see your feet, sonar shows the rest
    stamina: { max: 100, drain: 26, regen: 15, recover: 25 },
    trap: { bearDisarm: 2, wireCut: 1.2, mash: 8, stun: 1.5, creatureHeld: 8 },
    uv: { charges: 2, range: 6 * TILE, half: 0.6, stun: 30, noise: 3 },
  };

  const COL = {
    wall: [120, 230, 255],
    amber: [255, 180, 60],
    red: [255, 50, 60],
    drip: [90, 150, 255],
    vent: [170, 200, 230],
    hum: [80, 200, 200],
    exit: [230, 255, 230],
  };
  const KEYS = {
    red: { col: [255, 70, 90], shape: 'square', label: 'RED' },
    blue: { col: [80, 140, 255], shape: 'triangle', label: 'BLUE' },
    green: { col: [80, 255, 140], shape: 'circle', label: 'GREEN' },
  };
  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const TAU = Math.PI * 2;
  const DIFFS = [
    { name: 'EASY', speed: 0.85, hearing: 0.8, hints: true, score: 0.75 },
    { name: 'NORMAL', speed: 1, hearing: 1, hints: true, score: 1 },
    { name: 'HARD', speed: 1.1, hearing: 1.25, hints: false, score: 1.5 },
    { name: 'PRACTICE', speed: 1, hearing: 1, hints: true, score: 0, practice: true },
  ];
  let difficulty = 1;
  let best = loadBest();

  function loadBest() {
    try { return JSON.parse(localStorage.getItem('echoChamberBest')) || null; } catch (e) { return null; }
  }
  function saveBest(b) {
    try { localStorage.setItem('echoChamberBest', JSON.stringify(b)); } catch (e) { /* storage unavailable */ }
  }

  // ---- State -----------------------------------------------------------------
  let level;
  let grid;
  let game = null;
  let mode = 'menu'; // menu | play | paused | scare | dead | over | win
  let now = 0;
  let debug = false;
  let showHelp = true;
  let showJournal = false;
  let showMap = false;
  const keys = {};
  const mouse = { x: 0, y: 0 };
  const cam = { x: 0, y: 0 };
  let pulses = [];
  let marks = [];

  // ---- Helpers ---------------------------------------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const tileOf = (v) => Math.floor(v / TILE);
  const center = (t) => t * TILE + TILE / 2;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const walkable = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && grid[ty][tx] === 0;
  const zoneAt = (x, y) => (walkable(tileOf(x), tileOf(y)) ? level.zone[tileOf(y)][tileOf(x)] : '');
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function showMsg(text, dur = 3) { game.msg = { text, until: now + dur }; }

  // DDA grid raycast; returns where the ray meets a wall (or maxDist).
  function castRay(ox, oy, dx, dy, maxDist) {
    let mx = tileOf(ox);
    let my = tileOf(oy);
    const ddx = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const ddy = dy === 0 ? Infinity : Math.abs(TILE / dy);
    const stepX = dx < 0 ? -1 : 1;
    const stepY = dy < 0 ? -1 : 1;
    let sx = dx === 0 ? Infinity : (dx < 0 ? (ox - mx * TILE) / -dx : ((mx + 1) * TILE - ox) / dx);
    let sy = dy === 0 ? Infinity : (dy < 0 ? (oy - my * TILE) / -dy : ((my + 1) * TILE - oy) / dy);
    for (let i = 0; i < 200; i++) {
      let d;
      if (sx < sy) { d = sx; sx += ddx; mx += stepX; } else { d = sy; sy += ddy; my += stepY; }
      if (d > maxDist) break;
      if (!walkable(mx, my)) return { hit: true, dist: d, x: ox + dx * d, y: oy + dy * d };
    }
    return { hit: false, dist: maxDist, x: ox + dx * maxDist, y: oy + dy * maxDist };
  }

  function lineOfSight(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by);
    if (d < 1) return true;
    return castRay(ax, ay, (bx - ax) / d, (by - ay) / d, d).dist >= d - 1;
  }

  // Sound travels along corridors: BFS distance in tiles, capped at maxD.
  function pathDist(ax, ay, bx, by, maxD) {
    const sx = tileOf(ax), sy = tileOf(ay), tx = tileOf(bx), ty = tileOf(by);
    if (sx === tx && sy === ty) return 0;
    const seen = new Int16Array(MAP_W * MAP_H).fill(-1);
    const q = [sy * MAP_W + sx];
    seen[q[0]] = 0;
    for (let head = 0; head < q.length; head++) {
      const c = q[head];
      const d = seen[c];
      if (d >= maxD) continue;
      const cx = c % MAP_W, cy = (c / MAP_W) | 0;
      for (const [ox, oy] of DIR4) {
        const nx = cx + ox, ny = cy + oy;
        if (!walkable(nx, ny)) continue;
        const n = ny * MAP_W + nx;
        if (seen[n] !== -1) continue;
        seen[n] = d + 1;
        if (nx === tx && ny === ty) return d + 1;
        q.push(n);
      }
    }
    return Infinity;
  }

  // Distance field toward a target tile; the creature walks downhill on it.
  function buildField(tx, ty) {
    const f = new Int32Array(MAP_W * MAP_H).fill(-1);
    const q = [ty * MAP_W + tx];
    f[q[0]] = 0;
    for (let head = 0; head < q.length; head++) {
      const c = q[head];
      const cx = c % MAP_W, cy = (c / MAP_W) | 0;
      for (const [ox, oy] of DIR8) {
        const nx = cx + ox, ny = cy + oy;
        if (!walkable(nx, ny)) continue;
        if (ox && oy && (!walkable(cx + ox, cy) || !walkable(cx, cy + oy))) continue;
        const n = ny * MAP_W + nx;
        if (f[n] !== -1) continue;
        f[n] = f[c] + 1;
        q.push(n);
      }
    }
    return f;
  }

  function spatial(x, y) {
    const p = game.player;
    const d = dist(x, y, p.x, p.y);
    const gain = clamp(1 - d / (22 * TILE), 0, 1);
    return { gain: gain * gain, pan: clamp((x - p.x) / (8 * TILE), -1, 1), muffled: !lineOfSight(p.x, p.y, x, y) };
  }

  // ---- Setup -----------------------------------------------------------------
  function newGame() {
    level = buildFacility();
    grid = level.grid;
    const [px, py] = level.playerStart;
    const keycards = Object.keys(KEYS).map((color) => {
      const [x, y] = pick(level.keyCandidates[color]);
      return { color, x: center(x), y: center(y), taken: false };
    });
    game = {
      player: { x: center(px), y: center(py), hidden: false, prevX: 0, prevY: 0, charging: false,
                chargeStart: 0, stepTimer: 0, breath: CFG.breathMax, holding: false, breathLock: 0,
                breathTimer: 0, moving: false, sneaking: false, vx: 0, vy: 0, speedNow: 0, running: false,
                face: -Math.PI / 2, walk: 0,
                stamina: CFG.stamina.max, exhausted: false, stunUntil: 0, stuck: null, mash: 0, hold: null },
      creature: { x: 0, y: 0, state: 'patrol', field: null, tx: -1, ty: -1, next: null, intensity: 0,
                  heardAt: -99, lastHeard: -99, stepTimer: 0, searchEnd: 0, searchCx: 0, searchCy: 0 },
      keycards,
      cards: 0,
      notes: level.notes.map((n) => ({ ...n, px: center(n.x), py: center(n.y), read: false })),
      notesRead: [],
      bench: { x: center(level.workbench[0]), y: center(level.workbench[1]), parts: {}, built: false },
      uv: 0,
      uvFlash: null,
      visited: new Uint8Array(MAP_W * MAP_H),
      known: {}, // targets revealed by notes: red / blue / green / exit
      reading: null,
      held: null, // one item in your hands at a time: { kind: 'bottle' | 'key' | 'trap', color? }
      inserted: {},
      dayCard: { start: now, day: 1 },
      caption: null,
      nextMutter: now + 25,
      dropAt: null,
      pickups: level.throwables.map(([x, y]) => ({ kind: 'bottle', x: center(x), y: center(y), taken: false }))
        .concat(level.parts.map((pt) => ({ kind: 'part', part: pt.part, x: center(pt.x), y: center(pt.y), taken: false }))),
      radios: level.radios.map(([x, y]) => ({ x: center(x), y: center(y), charges: CFG.radioCharges, onUntil: 0, nextNoise: 0 })),
      lockers: level.lockers.map(([x, y]) => ({ x: center(x), y: center(y) })),
      emitters: level.emitters.map((e) => ({ x: center(e.x), y: center(e.y), type: e.type, next: rand(0, 3) })),
      exit: { x: center(level.exit[0]), y: center(level.exit[1]) },
      flying: [],
      pulseReadyAt: 0,
      noiseShown: 0,
      nextBeat: 0,
      creaturePath: 99,
      nextPathCheck: 0,
      directorCooldown: 0,
      nextDirector: 0,
      lastExitMsg: -99,
      msg: null,
      startTime: now,
      stats: { pulses: 0, detections: 0, deaths: 0 },
      deadAt: 0,
      endTime: 0,
      memory: new Uint8Array(MAP_W * MAP_H),
      trail: [],
      nextTrail: 0,
      nextBeacon: 0,
      lastCause: '',
      result: null,
      traps: level.traps.map((t) => ({ ...t, px: center(t.x), py: center(t.y), armed: true, cool: 0,
                                         swx: t.sw ? center(t.sw[0]) : 0, swy: t.sw ? center(t.sw[1]) : 0 })),
      task: null,
      scare: null,
      flash: null,
      lastChaseEnd: -99,
    };
    placeCreature(level.creatureStart);
    pulses = [];
    marks = [];
    mode = 'play';
    showMsg('Each pulse lets you SEE, and lets her HEAR. Read the note beside you (E).', 7);
  }

  function placeCreature([tx, ty]) {
    const c = game.creature;
    c.x = center(tx); c.y = center(ty);
    c.state = 'patrol'; c.field = null; c.next = null; c.tx = -1; c.intensity = 0;
    c.heardAt = -99; c.lastHeard = -99;
  }

  function respawn() {
    const p = game.player;
    const [px, py] = level.playerStart;
    Object.assign(p, { x: center(px), y: center(py), hidden: false, charging: false, breath: CFG.breathMax,
                       vx: 0, vy: 0, stuck: null, hold: null, stunUntil: 0, stamina: CFG.stamina.max, exhausted: false });
    const far = level.waypoints.reduce((a, b) =>
      dist(center(a[0]), center(a[1]), p.x, p.y) > dist(center(b[0]), center(b[1]), p.x, p.y) ? a : b);
    placeCreature(far);
    game.dayCard = { start: now, day: game.stats.deaths + 1 };
    game.directorCooldown = now + 20;
    game.trail = [];
    game.lastCause = '';
    game.task = null;
    pulses = [];
    marks = [];
    mode = 'play';
    showMsg(`You wake up. Door readers lit: ${game.cards}/3. Anything you held is where you fell.`, 5);
  }

  // ---- Sonar -----------------------------------------------------------------
  function sonar(ox, oy, range, rays, color = COL.wall, opts = {}) {
    const start = now;
    const pts = [];
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * TAU;
      const r = castRay(ox, oy, Math.cos(a), Math.sin(a), range);
      if (opts.memory && r.hit) game.memory[tileOf(r.y + Math.sin(a)) * MAP_W + tileOf(r.x + Math.cos(a))] = 1;
      pts.push({ x: r.x, y: r.y, hit: r.hit, t: start + r.dist / CFG.sonar.ringSpeed });
    }
    pulses.push({ ox, oy, start, range, pts, color, ring: opts.ring !== false, waves: opts.memory ? 3 : 1 });
    if (opts.entities !== false) revealEntities(ox, oy, range, start);
  }

  function revealEntities(ox, oy, range, start) {
    const list = [];
    for (const l of game.lockers) list.push({ kind: 'locker', x: l.x, y: l.y });
    for (const r of game.radios) list.push({ kind: 'radio', x: r.x, y: r.y });
    for (const t of game.pickups) if (!t.taken) list.push(itemMark(t));
    for (const k of game.keycards) if (!k.taken) list.push({ kind: 'key', x: k.x, y: k.y, color: k.color, terminal: true });
    for (const n of game.notes) list.push({ kind: 'note', x: n.px, y: n.py, read: n.read });
    list.push({ kind: 'bench', x: game.bench.x, y: game.bench.y });
    for (const t of game.traps) {
      if (t.gone) continue;
      list.push({ kind: 'trap', x: t.px, y: t.py, trap: t });
      if (t.type === 'shock') list.push({ kind: 'switch', x: t.swx, y: t.swy, trap: t });
    }
    list.push({ kind: 'exit', x: game.exit.x, y: game.exit.y });
    if (!DIFFS[difficulty].practice) list.push({ kind: 'creature', x: game.creature.x, y: game.creature.y });
    for (const e of list) {
      const d = dist(ox, oy, e.x, e.y);
      if (d > range || !lineOfSight(ox, oy, e.x, e.y)) continue;
      e.t = start + d / CFG.sonar.ringSpeed;
      marks.push(e);
    }
  }

  function pulseAlpha(t) { return now < t ? 0 : 1 - (now - t) / CFG.sonar.fade; }

  // ---- Noise -----------------------------------------------------------------
  function zoneNoise(n, x, y) {
    const z = zoneAt(x, y);
    if (z === 'vent') return Math.max(0, n + CFG.noise.ventDelta);
    if (z === 'water') return n + CFG.noise.waterDelta;
    return n;
  }

  function emitNoise(x, y, r, source, label = '') {
    if (r <= 0) return;
    if (source === 'player') game.noiseShown = Math.max(game.noiseShown, r);
    const c = game.creature;
    const hm = (1 + CFG.creature.perKeyHearing * game.cards) * DIFFS[difficulty].hearing;
    const maxD = Math.ceil(r * hm);
    const d = pathDist(x, y, c.x, c.y, maxD);
    if (d > maxD) return;
    creatureHear({ x, y, intensity: r * hm - d, source, d, label });
  }

  // ---- Creature AI -----------------------------------------------------------
  function setTarget(c, x, y) {
    let tx = tileOf(x), ty = tileOf(y);
    if (!walkable(tx, ty)) {
      const n = DIR8.map(([ox, oy]) => [tx + ox, ty + oy]).find(([a, b]) => walkable(a, b));
      if (!n) return;
      [tx, ty] = n;
    }
    if (tx === c.tx && ty === c.ty && c.field) return;
    c.tx = tx; c.ty = ty;
    c.field = buildField(tx, ty);
    c.next = null;
  }

  function creatureHear(s) {
    const c = game.creature;
    if (c.state === 'trapped' || DIFFS[difficulty].practice) return;
    const fromPlayer = s.source === 'player';
    if (fromPlayer && (s.d <= CFG.creature.chaseTrigger || c.state === 'chase')) {
      if (s.label) game.lastCause = s.label;
      if (c.state !== 'chase') {
        c.state = 'chase';
        game.stats.detections++;
        Sfx.growl(spatial(c.x, c.y));
        if (now - game.lastChaseEnd > 15) flashScare();
        showMsg('SHE HEARD YOU. RUN OR HIDE.', 2);
        say('chase', true);
      }
      c.lastHeard = now;
      c.heardAt = now;
      c.intensity = s.intensity;
      setTarget(c, s.x, s.y);
      return;
    }
    // A loud distraction can break a chase; weak ones are ignored mid-chase.
    if (c.state === 'chase' && (fromPlayer || s.intensity < 6)) return;
    const stale = now - c.heardAt > 2;
    if (c.state === 'investigate' && !stale && s.intensity < c.intensity - 1) return;
    if (c.state !== 'investigate') say('hear');
    c.state = 'investigate';
    c.intensity = s.intensity;
    c.heardAt = now;
    setTarget(c, s.x, s.y);
  }

  function startSearch(c) {
    c.state = 'search';
    c.searchCx = c.tx; c.searchCy = c.ty;
    c.searchEnd = now + rand(6, 10);
    pickSearchPoint(c);
  }

  function pickSearchPoint(c) {
    for (let i = 0; i < 20; i++) {
      const x = c.searchCx + Math.round(rand(-4, 4));
      const y = c.searchCy + Math.round(rand(-4, 4));
      if (walkable(x, y)) { setTarget(c, center(x), center(y)); return; }
    }
  }

  // Director: keeps the creature loosely near the player, and backs off after a chase.
  function pickPatrol() {
    const c = game.creature, p = game.player;
    const wps = level.waypoints;
    const d = (w) => dist(center(w[0]), center(w[1]), p.x, p.y);
    let wp;
    if (now < game.directorCooldown) wp = wps.reduce((a, b) => (d(a) > d(b) ? a : b));
    else if (Math.random() < 0.55) wp = wps.reduce((a, b) => (d(a) < d(b) ? a : b));
    else wp = pick(wps);
    if (wp[0] === c.tx && wp[1] === c.ty) wp = pick(wps);
    setTarget(c, center(wp[0]), center(wp[1]));
    game.nextDirector = now + CFG.directorTick;
  }

  function arrived(c) {
    if (c.state === 'investigate') startSearch(c);
    else if (c.state === 'search') pickSearchPoint(c);
    else if (c.state === 'patrol') pickPatrol();
  }

  function updateCreature(dt) {
    const c = game.creature, p = game.player;
    if (c.state === 'trapped') {
      if (now > c.trappedUntil) {
        showMsg(c.stunned ? 'She is recovering from the light...' : 'She tore free of the trap...', 2);
        c.stunned = false; startSearch(c); Sfx.howl();
      }
      return;
    }
    // Bear traps the player set
    for (const t of game.traps) {
      if (t.type === 'bear' && t.owner === 'player' && t.armed && dist(t.px, t.py, c.x, c.y) < 18) {
        t.armed = false; t.gone = true;
        c.state = 'trapped'; c.trappedUntil = now + CFG.trap.creatureHeld;
        Sfx.snap(); Sfx.howl();
        sonar(c.x, c.y, 90, 48, COL.red, { entities: false });
        showMsg(`YOUR TRAP CAUGHT HER! Held for ${CFG.trap.creatureHeld}s. Move!`, 3);
        say('trapped', true);
        return;
      }
    }
    if (c.state === 'chase' && now - c.lastHeard > CFG.creature.loseTrack) { game.lastChaseEnd = now; startSearch(c); say('search', true); }
    if (c.state === 'search' && now > c.searchEnd) {
      c.state = 'patrol';
      game.directorCooldown = now + CFG.directorCooldown;
      pickPatrol();
    }
    if (c.state === 'patrol' && (!c.field || now > game.nextDirector)) pickPatrol();

    const spd = CFG.creature[c.state] * (1 + CFG.creature.perKeySpeed * game.cards) * DIFFS[difficulty].speed;
    const cx = tileOf(c.x), cy = tileOf(c.y);
    if (!c.next || dist(c.x, c.y, center(c.next.x), center(c.next.y)) < 2) {
      const here = c.field[cy * MAP_W + cx];
      let best = null;
      let bv = here === -1 ? Infinity : here;
      if (here !== 0) {
        for (const [ox, oy] of DIR8) {
          const nx = cx + ox, ny = cy + oy;
          if (!walkable(nx, ny)) continue;
          if (ox && oy && (!walkable(cx + ox, cy) || !walkable(cx, cy + oy))) continue;
          const v = c.field[ny * MAP_W + nx];
          if (v >= 0 && v < bv) { bv = v; best = { x: nx, y: ny }; }
        }
      }
      c.next = best;
      if (!best) {
        if (dist(c.x, c.y, center(cx), center(cy)) < 2) arrived(c);
        else c.next = { x: cx, y: cy };
      }
    }
    c.moving = false;
    if (c.next) {
      const tx = center(c.next.x), ty = center(c.next.y);
      const dx = tx - c.x, dy = ty - c.y, l = Math.hypot(dx, dy);
      const s = Math.min(l, spd * dt);
      if (l > 0.01) { c.x += (dx / l) * s; c.y += (dy / l) * s; c.moving = true; }
    }

    if (now > game.nextTrail) {
      game.nextTrail = now + 0.2;
      game.trail.push({ x: c.x, y: c.y });
      if (game.trail.length > 60) game.trail.shift();
    }

    // Footsteps: sound is sight, so you briefly see it when it moves.
    if (c.moving) {
      c.stepTimer -= dt;
      if (c.stepTimer <= 0) {
        c.stepTimer = c.state === 'chase' ? 0.3 : 0.5;
        if (dist(c.x, c.y, p.x, p.y) < 16 * TILE) {
          sonar(c.x, c.y, 44, 24, COL.red, { ring: false, entities: false });
          marks.push({ kind: 'creature', x: c.x, y: c.y, t: now });
        }
        Sfx.creatureStep(spatial(c.x, c.y));
        if (Math.random() < 0.35) Sfx.scrape(spatial(c.x, c.y));
      }
    }

    // Up close it senses a careless player and growls before lunging (fair warning).
    if (c.state !== 'chase' && !p.hidden && !p.sneaking && game.creaturePath <= 3) {
      creatureHear({ x: p.x, y: p.y, intensity: 10, source: 'player', d: 0, label: 'movement up close' });
    }

    const d = dist(c.x, c.y, p.x, p.y);
    if (!p.hidden && d < CFG.creature.radius + CFG.player.radius) die();
    else if (p.hidden && c.state === 'chase' && d < 14) die();
  }

  // ---- Player ----------------------------------------------------------------
  function blocked(x, y, r) {
    return !walkable(tileOf(x - r), tileOf(y - r)) || !walkable(tileOf(x + r), tileOf(y - r)) ||
           !walkable(tileOf(x - r), tileOf(y + r)) || !walkable(tileOf(x + r), tileOf(y + r));
  }

  function updatePlayer(dt) {
    const p = game.player, c = game.creature;
    if (p.hidden) {
      const close = dist(c.x, c.y, p.x, p.y) < 5 * TILE;
      if (keys.KeyF && p.breath > 0 && now > p.breathLock) {
        p.holding = true;
        p.breath -= dt;
        if (p.breath <= 0) {
          p.breath = 0;
          p.holding = false;
          p.breathLock = now + 1.5;
          Sfx.gasp();
          showMsg('You gasp for air!', 2);
          emitNoise(p.x, p.y, CFG.noise.gasp, 'player', 'gasp for air');
        }
      } else {
        p.holding = false;
        p.breath = Math.min(CFG.breathMax, p.breath + dt * (CFG.breathMax / CFG.breathRefill));
        if (close) {
          p.breathTimer -= dt;
          if (p.breathTimer <= 0) {
            p.breathTimer = 1.2;
            Sfx.breath();
            emitNoise(p.x, p.y, CFG.noise.breath, 'player', 'breathing');
          }
        }
      }
      return;
    }

    const busy = !!(game.task || p.stuck);
    const stunned = now < p.stunUntil;
    let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (busy || stunned) { mx = 0; my = 0; }
    p.sneaking = !!keys.KeyC && !busy;
    p.moving = !!(mx || my);
    const running = p.moving && !p.sneaking && !p.exhausted && !!(keys.ShiftLeft || keys.ShiftRight);
    p.running = running;

    // Stamina: sprinting drains it; run dry and you're winded until it recovers.
    if (running) {
      p.stamina -= CFG.stamina.drain * dt;
      if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; showMsg('Out of breath!', 1.5); }
    } else {
      p.stamina = Math.min(CFG.stamina.max, p.stamina + CFG.stamina.regen * dt);
      if (p.exhausted && p.stamina >= CFG.stamina.recover) p.exhausted = false;
    }

    // Smooth acceleration with wall sliding
    const speed = p.sneaking ? CFG.player.sneak : running ? CFG.player.run : CFG.player.walk;
    const l = Math.hypot(mx, my) || 1;
    const k = Math.min(1, CFG.player.accel * dt);
    p.vx += ((mx / l) * speed - p.vx) * k;
    p.vy += ((my / l) * speed - p.vy) * k;
    if (busy) { p.vx = 0; p.vy = 0; }
    const r = CFG.player.radius;
    const nx = p.x + p.vx * dt;
    if (!blocked(nx, p.y, r)) p.x = nx; else p.vx = 0;
    const ny = p.y + p.vy * dt;
    if (!blocked(p.x, ny, r)) p.y = ny; else p.vy = 0;
    p.speedNow = Math.hypot(p.vx, p.vy);
    if (p.speedNow > 10) p.face = Math.atan2(p.vy, p.vx);
    p.walk += p.speedNow * dt * 0.09;
    const ptx = tileOf(p.x), pty = tileOf(p.y);
    for (let oy = -2; oy <= 2; oy++) for (let ox = -2; ox <= 2; ox++) {
      if (walkable(ptx + ox, pty + oy)) game.visited[(pty + oy) * MAP_W + ptx + ox] = 1;
    }

    if (p.speedNow > 25) {
      p.stepTimer -= dt;
      if (p.stepTimer <= 0) {
        p.stepTimer = p.sneaking ? 0.6 : running ? 0.3 : 0.45;
        const water = zoneAt(p.x, p.y) === 'water';
        const n = p.sneaking ? (water ? 1 : 0) : zoneNoise(running ? CFG.noise.run : CFG.noise.walk, p.x, p.y);
        if (water && n > 0) Sfx.splash();
        else if (!p.sneaking) Sfx.step(running);
        emitNoise(p.x, p.y, n, 'player', water ? 'splashing' : running ? 'running footsteps' : 'footsteps');
      }
    }

    if (!p.stuck) updateTraps();

    // Hold-E actions: disarm a bear trap, cut a tripwire
    if (p.hold) {
      const t = p.hold.target;
      if (!keys.KeyE || dist(t.px, t.py, p.x, p.y) > 46 || !t.armed) p.hold = null;
      else if ((p.hold.t += dt) >= p.hold.need) {
        t.armed = false;
        if (t.type === 'bear') { t.gone = true; game.held = { kind: 'trap' }; showMsg('Bear trap in your hands. Press G to set it for her.', 3); }
        else { t.cut = true; showMsg('Tripwire cut.', 2); }
        Sfx.click2();
        p.hold = null;
      }
    }
  }

  function updateTraps() {
    const p = game.player;
    for (const t of game.traps) {
      if (!t.armed || t.gone) continue;
      const d = dist(t.px, t.py, p.x, p.y);
      if (t.type === 'bear' && t.owner !== 'player' && d < 15) {
        t.armed = false;
        p.stuck = t; p.mash = 0; p.vx = 0; p.vy = 0; p.charging = false;
        Sfx.snap();
        emitNoise(p.x, p.y, CFG.noise.snap, 'player', 'bear trap snapping shut');
        showMsg('BEAR TRAP! Mash SPACE to pry it open. It can hear you...', 3);
      } else if (t.type === 'tripwire' && d < 16 && !p.sneaking) {
        t.armed = false; t.cut = true;
        Sfx.alarm();
        sonar(t.px, t.py, 120, 60, COL.red, { entities: false });
        emitNoise(t.px, t.py, CFG.noise.alarm, 'alarm', 'tripwire alarm');
        showMsg('ALARM! It knows where you are. HIDE!', 3);
      } else if (t.type === 'shock' && d < 20 && now > t.cool) {
        t.cool = now + 3;
        p.stunUntil = now + CFG.trap.stun;
        Sfx.shock();
        emitNoise(p.x, p.y, CFG.noise.shock, 'player', 'shock floor');
        showMsg('ZAP! Find the fuse switch to kill this floor.', 2.5);
      } else if (t.type === 'creak' && d < 18 && !p.sneaking && p.speedNow > 25 && now > t.cool) {
        t.cool = now + 1.2;
        Sfx.creak();
        emitNoise(p.x, p.y, CFG.noise.creak, 'player', 'creaky floor');
        showMsg('*CREAK* Sneak (C) over loose panels.', 2);
      }
    }
  }

  function struggle() {
    const p = game.player;
    p.mash++;
    Sfx.struggle();
    emitNoise(p.x, p.y, CFG.noise.struggle, 'player', 'struggling in a trap');
    if (p.mash >= CFG.trap.mash) { p.stuck.gone = true; p.stuck = null; showMsg('You pried the trap open!', 2); }
  }

  function placeTrap() {
    const p = game.player;
    if (p.hidden || p.stuck || game.task) return;
    if (!game.held || game.held.kind !== 'trap') { showMsg('You are not holding a bear trap. Sneak (C) + hold E on one to take it.', 2.5); return; }
    game.held = null;
    game.traps.push({ type: 'bear', owner: 'player', px: p.x, py: p.y, armed: true, cool: 0 });
    Sfx.click2();
    showMsg('Trap set. Lure it over with a bottle or radio.', 2.5);
  }

  function flashScare() { game.flash = { start: now }; Sfx.sting(); }

  function collectKey(k) {
    const p = game.player;
    k.taken = true;
    game.held = { kind: 'key', color: k.color };
    Sfx.key();
    emitNoise(p.x, p.y, CFG.noise.pickup, 'player', 'keycard pickup');
    showMsg(`${KEYS[k.color].label} KEYCARD in your hands. Carry it to the EXIT door, south of the hub.`, 4);
  }

  function insertKey() {
    const p = game.player, color = game.held.color;
    game.inserted[color] = true;
    game.cards++;
    game.held = null;
    Sfx.key();
    emitNoise(p.x, p.y, CFG.noise.pickup, 'player', 'card reader beep');
    showMsg(game.cards === 3
      ? 'ALL THREE READERS LIT. Press E to run the lockdown override. She hears better now...'
      : `${KEYS[color].label} reader lit (${game.cards}/3). Door progress is saved.`, 4);
  }

  function useBench() {
    const b = game.bench, h = game.held;
    if (b.built) { showMsg(`UV Flash already built. ${game.uv} charge${game.uv === 1 ? '' : 's'} left (F).`, 2.5); return; }
    if (h && h.kind === 'part') {
      b.parts[h.part] = true;
      game.held = null;
      Sfx.click2();
      const n = Object.keys(b.parts).length;
      showMsg(n === 3 ? 'All 3 parts on the bench. Press E to assemble the UV Flash!' : `${PART_NAMES[h.part]} placed on the workbench (${n}/3).`, 3);
      return;
    }
    if (Object.keys(b.parts).length === 3) { openConsole('craft', null); return; }
    const missing = Object.keys(PART_NAMES).filter((k) => !b.parts[k]).map((k) => PART_NAMES[k]);
    showMsg(`WORKBENCH: UV Flash needs ${missing.join(', ')}. Bring them here one at a time.`, 3.5);
  }

  // UV Flash: a cone of light toward the mouse. A hit stuns her for 30 seconds.
  function fireUV() {
    const p = game.player, c = game.creature;
    if (p.hidden || p.stuck || game.task) return;
    if (!game.bench.built) { showMsg('No weapon yet. Bring 3 parts to the hub WORKBENCH to build the UV Flash.', 3); return; }
    if (game.uv <= 0) { Sfx.buzz(); showMsg('The UV Flash is out of charge.', 2); return; }
    game.uv--;
    const aim = Math.atan2(mouse.y + cam.y - p.y, mouse.x + cam.x - p.x);
    game.uvFlash = { start: now, x: p.x, y: p.y, aim };
    Sfx.uv();
    sonar(p.x, p.y, CFG.uv.range, 90, [190, 140, 255], { ring: false });
    emitNoise(p.x, p.y, CFG.uv.noise, 'player', 'UV flash');
    const d = dist(c.x, c.y, p.x, p.y);
    const da = Math.abs(Math.atan2(Math.sin(Math.atan2(c.y - p.y, c.x - p.x) - aim), Math.cos(Math.atan2(c.y - p.y, c.x - p.x) - aim)));
    if (!DIFFS[difficulty].practice && d < CFG.uv.range && da < CFG.uv.half && lineOfSight(p.x, p.y, c.x, c.y)) {
      c.state = 'trapped'; c.trappedUntil = now + CFG.uv.stun; c.stunned = true;
      game.lastChaseEnd = now;
      say('stunned', true);
      Sfx.howl();
      showMsg(`DIRECT HIT! She is stunned for ${CFG.uv.stun} seconds. MOVE!`, 3);
    } else showMsg(`Missed! ${game.uv} charge${game.uv === 1 ? '' : 's'} left.`, 2);
  }

  function readNote(n) {
    game.reading = n;
    Sfx.pickup();
    if (!n.read) {
      n.read = true;
      game.notesRead.push(n);
      if (n.reveal && !game.known[n.reveal]) {
        game.known[n.reveal] = true;
        showMsg(`Marked on your screen: ${n.reveal === 'exit' ? 'the EXIT door' : KEYS[n.reveal].label + ' keycard terminal'}.`, 3.5);
      }
    }
  }

  // What to do next, always on screen.
  function objective() {
    const h = game.held;
    if (h && h.kind === 'key') return `Carry the ${KEYS[h.color].label} keycard to the EXIT door (south of the hub) and press E`;
    if (game.cards === 3) return 'All 3 readers lit: run the LOCKDOWN OVERRIDE at the EXIT door';
    if (!game.notesRead.length) return 'Read the note beside you (E) to learn how to escape';
    if (game.pickups.some((t) => !t.taken && t.kind === 'key')) return 'Go back for the keycard you dropped and bring it to the EXIT door';
    const left = game.keycards.filter((k) => !k.taken).map((k) => KEYS[k.color].label);
    return `Hack a keycard terminal (${left.join(' / ')} left), then carry the card to the EXIT door`;
  }

  const PART_NAMES = { battery: 'battery', bulb: 'UV bulb', wire: 'copper wire' };
  const itemName = (it) => (!it ? 'empty' : it.kind === 'bottle' ? 'bottle' : it.kind === 'trap' ? 'bear trap'
    : it.kind === 'part' ? PART_NAMES[it.part] : `${KEYS[it.color].label} keycard`);
  const itemMark = (t) => ({ kind: t.kind === 'key' ? 'key' : t.kind === 'trap' ? 'trapitem' : t.kind === 'part' ? 'part' : 'throwable',
    x: t.x, y: t.y, color: t.color, part: t.part });

  function pickUp(item) {
    if (game.held) { Sfx.denied(); showMsg(`Your hands are full (${itemName(game.held)}). Press X to drop it.`, 2.5); return; }
    item.taken = true;
    game.held = { kind: item.kind, color: item.color, part: item.part };
    Sfx.pickup();
    showMsg(item.kind === 'bottle' ? 'Picked up a bottle. Click to throw it as a distraction.'
      : item.kind === 'trap' ? 'Picked up a bear trap. Press G to set it.'
      : item.kind === 'part' ? `Picked up the ${PART_NAMES[item.part]}. Carry it to the WORKBENCH in the hub.`
      : `Picked up the ${KEYS[item.color].label} keycard. Take it to the EXIT door.`, 3);
  }

  // Dropping makes noise unless you set it down carefully (sneaking).
  function dropHeld() {
    const p = game.player;
    if (!game.held || p.hidden || game.task) return;
    game.pickups.push({ ...game.held, x: p.x, y: p.y, taken: false });
    showMsg(p.sneaking ? `You quietly set down the ${itemName(game.held)}.` : `You dropped the ${itemName(game.held)}. CLANG!`, 2);
    game.held = null;
    if (!p.sneaking) { Sfx.clink(null); emitNoise(p.x, p.y, CFG.dropNoise, 'player', 'dropped item'); }
  }

  // The Matron's voice: browser speech synthesis when available, always with a subtitle.
  const VOICE = {
    hear: ['I hear you...', 'Is someone there... playing with me?', 'Hee hee... I heard that.', 'Was that you... little one?'],
    chase: ['Found you! Hee hee hee!', 'Ready or not... here I come!', 'Don\'t run away... play with me!'],
    search: ['Come out, come out... wherever you are...', 'I know you\'re hiding...', 'Hide and seek... my favourite game.'],
    mutter: ['La la la... la la la...', 'Ring around the rosie...', 'Will you be my friend... forever?', 'I can hear your heart beating...'],
    caught: ['You\'re mine now... forever.', 'Tag... you\'re it.'],
    trapped: ['Owww! That hurts! You\'ll pay for that!'],
    stunned: ['Aaah! The light! It BURNS!', 'My eyes... you little brat!'],
  };
  const GIGGLE = { chase: true, caught: true, trapped: true };

  // Prefer a female system voice; pitched up and slowed down it sounds like a creepy little girl.
  let voicePick = null;
  function creepyVoice() {
    if (voicePick) return voicePick;
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return null;
    const prefs = ['Samantha', 'Victoria', 'Karen', 'Tessa', 'Moira', 'Fiona', 'Zira', 'Google UK English Female', 'Female', 'female', 'Google US English'];
    const en = vs.filter((v) => v.lang && v.lang.toLowerCase().startsWith('en'));
    voicePick = prefs.map((n) => en.find((v) => v.name.includes(n))).find(Boolean) || en[0] || vs[0];
    return voicePick;
  }

  let lastSpeech = -99;
  function say(kind, force = false) {
    if (DIFFS[difficulty].practice || (!force && now - lastSpeech < 5)) return;
    lastSpeech = now;
    const quote = pick(VOICE[kind]);
    game.caption = { text: quote, until: now + 3.5 };
    if (GIGGLE[kind]) Sfx.giggle(); else Sfx.musicBox();
    try {
      if (!window.speechSynthesis) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(quote);
      const v = creepyVoice();
      if (v) u.voice = v;
      u.pitch = 1.9 + Math.random() * 0.1;
      u.rate = GIGGLE[kind] ? 0.8 : 0.6;
      u.volume = 1;
      speechSynthesis.speak(u);
    } catch (e) { /* speech unavailable */ }
  }

  function startCharge() {
    const p = game.player;
    if (now < game.pulseReadyAt || game.task || p.stuck) return;
    p.charging = true;
    p.chargeStart = now;
  }

  function releasePulse() {
    const p = game.player, S = CFG.sonar;
    if (!p.charging) return;
    p.charging = false;
    const held = now - p.chargeStart;
    let n;
    if (held < 0.18) {
      sonar(p.x, p.y, S.tapRange, S.raysTap, COL.wall, { memory: true });
      Sfx.click();
      n = CFG.noise.tap;
      game.pulseReadyAt = now + S.tapCd;
    } else {
      const ch = clamp(held / S.chargeTime, 0, 1);
      sonar(p.x, p.y, S.tapRange + (S.pingRange - S.tapRange) * ch, S.raysPing, COL.wall, { memory: true });
      Sfx.ping(ch);
      n = CFG.noise.pingMin + (CFG.noise.pingMax - CFG.noise.pingMin) * ch;
      game.pulseReadyAt = now + S.pingCd;
    }
    game.stats.pulses++;
    const loud = zoneNoise(n, p.x, p.y);
    emitNoise(p.x, p.y, loud, 'player', 'sonar pulse');
    const heard = !DIFFS[difficulty].practice && game.creature.heardAt === now;
    game.noiseWave = { x: p.x, y: p.y, r: loud * TILE, start: now, heard };
    if (heard && game.creature.state !== 'chase') showMsg('⚠ Your pulse was HEARD. She is coming to look...', 2.5);
  }

  function interact() {
    const p = game.player;
    if (game.task) return;
    if (game.reading) { game.reading = null; return; }
    if (p.stuck) { struggle(); return; }
    if (p.hidden) {
      p.hidden = false;
      p.x = p.prevX; p.y = p.prevY;
      Sfx.locker();
      emitNoise(p.x, p.y, CFG.noise.hide, 'player', 'locker door');
      return;
    }
    const key = game.keycards.find((k) => !k.taken && dist(k.x, k.y, p.x, p.y) < 34);
    if (key) {
      if (game.held) { Sfx.denied(); showMsg(`Hands full (${itemName(game.held)}). Press X to drop it first.`, 2.5); return; }
      openConsole('key', key);
      return;
    }
    if (dist(game.exit.x, game.exit.y, p.x, p.y) < 40) {
      if (game.held && game.held.kind === 'key') { insertKey(); return; }
      if (game.cards === 3) { openConsole('exit', null); return; }
    }
    if (dist(game.bench.x, game.bench.y, p.x, p.y) < 34) { useBench(); return; }
    const item = game.pickups.find((t) => !t.taken && dist(t.x, t.y, p.x, p.y) < 28);
    if (item) { pickUp(item); return; }
    const note = game.notes.find((n) => dist(n.px, n.py, p.x, p.y) < 30);
    if (note) { readNote(note); return; }
    const fuse = game.traps.find((t) => t.type === 'shock' && t.armed && dist(t.swx, t.swy, p.x, p.y) < 30);
    if (fuse) { fuse.armed = false; Sfx.click2(); Sfx.shock(); showMsg('Fuse pulled. That shock floor is dead.', 2.5); return; }
    const locker = game.lockers.find((l) => dist(l.x, l.y, p.x, p.y) < 30);
    if (locker) {
      p.prevX = p.x; p.prevY = p.y;
      p.x = locker.x; p.y = locker.y;
      p.hidden = true;
      p.breathTimer = 0;
      Sfx.locker();
      emitNoise(p.x, p.y, CFG.noise.hide, 'player', 'locker door');
      if (Math.random() < 0.1) { flashScare(); showMsg('...something was in here with you. It\'s gone.', 2.5); }
      else showMsg('Hidden. Hold F to hold your breath when it is close. E to leave.', 3);
      return;
    }
    const radio = game.radios.find((r) => dist(r.x, r.y, p.x, p.y) < 40);
    if (radio) {
      if (now < radio.onUntil) showMsg('The radio is already playing.', 2);
      else if (radio.charges <= 0) { Sfx.denied(); showMsg('Radio battery is dead.', 2); }
      else {
        radio.charges--;
        radio.onUntil = now + CFG.radioDur;
        radio.nextNoise = now;
        Sfx.radio(spatial(radio.x, radio.y), CFG.radioDur);
        showMsg(`Radio on for ${CFG.radioDur}s. Get away from it! (${radio.charges} charges left)`, 3);
      }
      return;
    }
    const trap = nearestDisarmable();
    if (trap) {
      if (trap.type === 'bear' && game.held) { showMsg(`Hands full (${itemName(game.held)}). Drop it (X) to take the trap.`, 2.5); return; }
      if (!p.sneaking && !keys.KeyC) { showMsg('Sneak (hold C) and hold E to disarm.', 2); return; }
      p.hold = { target: trap, t: 0, need: trap.type === 'bear' ? CFG.trap.bearDisarm : CFG.trap.wireCut };
    }
  }

  function nearestDisarmable() {
    const p = game.player;
    return game.traps.find((t) => t.armed && !t.gone && dist(t.px, t.py, p.x, p.y) < 46 &&
      ((t.type === 'bear' && t.owner !== 'player') || t.type === 'tripwire')) || null;
  }

  function throwObject() {
    const p = game.player;
    if (p.hidden || p.stuck || game.task) return;
    if (!game.held || game.held.kind !== 'bottle') { Sfx.denied(); showMsg('You need a bottle in your hands to throw.', 2); return; }
    const wx = mouse.x + cam.x, wy = mouse.y + cam.y;
    const l = dist(wx, wy, p.x, p.y);
    if (l < 1) return;
    const dx = (wx - p.x) / l, dy = (wy - p.y) / l;
    const range = Math.min(l, CFG.throwRange);
    const r = castRay(p.x, p.y, dx, dy, range);
    const land = r.hit ? Math.max(0, r.dist - 8) : range;
    game.held = null;
    game.flying.push({ sx: p.x, sy: p.y, ex: p.x + dx * land, ey: p.y + dy * land, start: now, dur: 0.15 + land / 700 });
  }

  // ---- World updates ---------------------------------------------------------
  function updateWorld(dt) {
    const p = game.player;

    for (const f of game.flying) {
      if (now - f.start < f.dur) continue;
      f.done = true;
      Sfx.clink(spatial(f.ex, f.ey));
      sonar(f.ex, f.ey, 70, 48, COL.amber, { entities: false });
      emitNoise(f.ex, f.ey, CFG.noise.throwImpact, 'distraction');
      game.pickups.push({ kind: 'bottle', x: f.ex, y: f.ey, taken: false });
    }
    game.flying = game.flying.filter((f) => !f.done);

    for (const r of game.radios) {
      if (now < r.onUntil && now >= r.nextNoise) {
        r.nextNoise = now + 1;
        sonar(r.x, r.y, 50, 32, COL.amber, { ring: false, entities: false });
        marks.push({ kind: 'radio', x: r.x, y: r.y, t: now });
        emitNoise(r.x, r.y, CFG.noise.radio, 'distraction');
      }
    }

    // Ambient emitters give free, silent glimpses of the map nearby.
    for (const e of game.emitters) {
      if (now < e.next) continue;
      const period = { drip: 2.5, vent: 3.5, hum: 4 }[e.type];
      e.next = now + period * rand(0.7, 1.3);
      if (dist(e.x, e.y, p.x, p.y) > 14 * TILE) continue;
      const sp = spatial(e.x, e.y);
      if (e.type === 'drip') { Sfx.drip(sp); sonar(e.x, e.y, 56, 36, COL.drip); }
      if (e.type === 'vent') { Sfx.hiss(sp); sonar(e.x, e.y, 80, 44, COL.vent); }
      if (e.type === 'hum') { Sfx.hum(sp); sonar(e.x, e.y, 64, 40, COL.hum); }
    }

    if (!p.hidden) {
      if (dist(game.exit.x, game.exit.y, p.x, p.y) < 30 && now - game.lastExitMsg > 4) {
        game.lastExitMsg = now;
        if (game.held && game.held.kind === 'key') showMsg('Press E to insert the keycard.', 3);
        else if (game.cards === 3) showMsg('Press E to run the exit lockdown override.', 3);
        else { Sfx.denied(); showMsg(`EXIT LOCKED. Readers lit ${game.cards}/3. Bring keycards here one at a time.`, 3); }
      }
    }

    // Keycards chirp when you are near; once all three are found, the exit beacons.
    if (now > game.nextBeacon) {
      game.nextBeacon = now + 2;
      for (const k of game.keycards) {
        if (k.taken || dist(k.x, k.y, p.x, p.y) > 6 * TILE) continue;
        Sfx.beacon(spatial(k.x, k.y));
        if (DIFFS[difficulty].hints) marks.push({ kind: 'key', x: k.x, y: k.y, color: k.color, t: now });
      }
      if (game.cards === 3) {
        Sfx.beacon(spatial(game.exit.x, game.exit.y));
        sonar(game.exit.x, game.exit.y, 96, 48, COL.exit, { entities: false });
        marks.push({ kind: 'exit', x: game.exit.x, y: game.exit.y, t: now });
      }
    }

    // Heartbeat speeds up as the creature gets closer (by path, not straight line).
    if (now > game.nextPathCheck) {
      game.nextPathCheck = now + 0.5;
      game.creaturePath = DIFFS[difficulty].practice ? 99 : pathDist(p.x, p.y, game.creature.x, game.creature.y, 22);
    }
    const cp = game.creaturePath;
    if (cp < 20 && now > game.nextBeat) {
      Sfx.heartbeat(0.15 + 0.5 * (1 - cp / 20));
      game.nextBeat = now + 0.35 + (cp / 20) * 0.9;
    }

    if (now > game.nextMutter) { game.nextMutter = now + rand(25, 45); if (game.creature.state === 'patrol') say('mutter'); }

    game.noiseShown = Math.max(0, game.noiseShown - dt * 4);
    pulses = pulses.filter((pl) => now < pl.start + pl.range / CFG.sonar.ringSpeed + CFG.sonar.fade);
    marks = marks.filter((m) => now < m.t + CFG.sonar.fade);
  }

  function die() {
    game.dropAt = { x: game.player.hidden ? game.player.prevX : game.player.x, y: game.player.hidden ? game.player.prevY : game.player.y };
    say('caught', true);
    mode = 'scare';
    game.scare = { start: now, dur: 1.4 };
    game.task = null;
    game.reading = null;
    game.player.charging = false;
    game.player.stuck = null;
    Sfx.screech();
  }

  function finishDeath() {
    game.deadAt = now;
    game.stats.deaths++;
    if (game.held) { game.pickups.push({ ...game.held, x: game.dropAt.x, y: game.dropAt.y, taken: false }); game.held = null; }
    mode = game.stats.deaths >= CFG.days ? 'over' : 'dead';
  }

  // ---- Terminals (mini-games) ------------------------------------------------
  // Each keycard is locked in a terminal and the exit needs an override. The
  // creature keeps hunting while you work, and a failed attempt buzzes loudly.
  const CONSOLES = {
    red: { type: 'wires', name: 'RED TERMINAL // REWIRE THE LOCK' },
    blue: { type: 'timing', name: 'BLUE TERMINAL // CALIBRATE' },
    green: { type: 'simon', name: 'GREEN TERMINAL // ACCESS SEQUENCE' },
    exit: { type: 'hexes', name: 'EXIT // LOCKDOWN OVERRIDE' },
    craft: { type: 'craft', name: 'WORKBENCH // ASSEMBLE THE UV FLASH' },
  };
  const PW = 520, PH = 380;
  const panel = () => ({ x: Math.round(W / 2 - PW / 2), y: Math.round(H / 2 - PH / 2) });
  const local = () => { const o = panel(); return { x: mouse.x - o.x, y: mouse.y - o.y }; };
  const btn = (x, y, w, h, m) => m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function openConsole(kind, key) {
    const def = CONSOLES[kind === 'key' ? key.color : kind];
    const at = kind === 'key' ? key : kind === 'craft' ? game.bench : game.exit;
    game.player.charging = false;
    game.task = { kind, key, type: def.type, name: def.name, x: at.x, y: at.y, st: MINI[def.type].init() };
    Sfx.click2();
  }
  function completeTask() {
    const t = game.task;
    game.task = null;
    Sfx.task();
    if (t.kind === 'key') collectKey(t.key);
    else if (t.kind === 'craft') {
      game.bench.built = true;
      game.uv = CFG.uv.charges;
      showMsg(`UV FLASH BUILT! Aim with the mouse and press F to stun her for ${CFG.uv.stun}s (${CFG.uv.charges} charges).`, 5);
    } else win();
  }
  function failTask(msg) {
    Sfx.buzz();
    emitNoise(game.task.x, game.task.y, CFG.noise.taskFail, 'player', 'terminal buzzer');
    showMsg(msg + ' The buzzer echoed through the facility...', 2.5);
  }

  function text(str, x, y, size = 14, col = '#cfefff') {
    ctx.font = `${size >= 16 ? 'bold ' : ''}${size}px monospace`;
    ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.fillText(str, x, y);
  }
  function line(x1, y1, x2, y2, col, w) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawPart(kind, x, y, s = 1, a = 1) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    ctx.globalAlpha *= a;
    if (kind === 'battery') {
      ctx.fillStyle = '#3aa655'; ctx.fillRect(-6, -10, 12, 20);
      ctx.fillStyle = '#ccc'; ctx.fillRect(-3, -13, 6, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(-1, -6, 2, 8); ctx.fillRect(-4, -3, 8, 2);
    } else if (kind === 'bulb') {
      ctx.fillStyle = '#b07aff'; ctx.beginPath(); ctx.arc(0, -3, 7, 0, TAU); ctx.fill();
      ctx.fillStyle = '#999'; ctx.fillRect(-4, 4, 8, 6);
    } else {
      ctx.strokeStyle = '#e08a3a'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let k = 0; k < 14; k += 0.3) ctx.lineTo(Math.cos(k) * (2 + k * 0.5), Math.sin(k) * (2 + k * 0.5));
      ctx.stroke();
    }
    ctx.restore();
  }

  const MINI = {
    craft: {
      init() {
        const kinds = shuffle(['battery', 'bulb', 'wire']);
        return {
          slots: [{ kind: 'battery', x: 150, y: 170 }, { kind: 'bulb', x: 260, y: 130 }, { kind: 'wire', x: 370, y: 170 }],
          items: kinds.map((k, i) => ({ kind: k, hx: 150 + i * 110, hy: 310, x: 150 + i * 110, y: 310, placed: false })),
          drag: null,
        };
      },
      down(s, m) { s.drag = s.items.find((it) => !it.placed && dist(it.x, it.y, m.x, m.y) < 28) || null; },
      move(s, m) { if (s.drag) { s.drag.x = m.x; s.drag.y = m.y; } },
      up(s) {
        const it = s.drag;
        if (!it) return;
        const slot = s.slots.find((sl) => sl.kind === it.kind);
        if (dist(slot.x, slot.y, it.x, it.y) < 34) { it.placed = true; it.x = slot.x; it.y = slot.y; Sfx.click2(); }
        else { it.x = it.hx; it.y = it.hy; }
        s.drag = null;
        if (s.items.every((i) => i.placed)) completeTask();
      },
      draw(s) {
        text('Drag each part onto its outline to assemble the UV Flash.', PW / 2, 55, 13);
        ctx.strokeStyle = 'rgba(190,140,255,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(110, 100, 300, 110);
        for (const sl of s.slots) { ctx.beginPath(); ctx.arc(sl.x, sl.y, 26, 0, TAU); ctx.stroke(); }
        ctx.setLineDash([]);
        for (const sl of s.slots) text(PART_NAMES[sl.kind].toUpperCase(), sl.x, sl.y + 44, 11, 'rgba(210,190,255,0.8)');
        for (const it of s.items) drawPart(it.kind, it.x, it.y, 1.6);
      },
    },
    wires: {
      init: () => ({ cols: ['#ff4a4a', '#4a8cff', '#ffd84a', '#e04aff'], right: shuffle([0, 1, 2, 3]), conn: [-1, -1, -1, -1], drag: -1 }),
      L: (i) => ({ x: 70, y: 110 + i * 62 }),
      R: (k) => ({ x: 450, y: 110 + k * 62 }),
      down(s, m) { for (let i = 0; i < 4; i++) { const p = this.L(i); if (s.conn[i] < 0 && dist(p.x, p.y, m.x, m.y) < 24) s.drag = i; } },
      up(s, m) {
        if (s.drag < 0) return;
        for (let k = 0; k < 4; k++) {
          const p = this.R(k);
          if (dist(p.x, p.y, m.x, m.y) < 26) {
            if (s.right[k] === s.drag) { s.conn[s.drag] = k; Sfx.click2(); } else failTask('Short circuit!');
          }
        }
        s.drag = -1;
        if (s.conn.every((c) => c >= 0)) completeTask();
      },
      draw(s, m) {
        text('Drag each wire to its matching colour. Wrong ones short out.', PW / 2, 60, 13);
        for (let i = 0; i < 4; i++) {
          const a = this.L(i);
          ctx.fillStyle = s.cols[i]; ctx.fillRect(a.x - 40, a.y - 8, 40, 16);
          if (s.conn[i] >= 0) { const b = this.R(s.conn[i]); line(a.x, a.y, b.x, b.y, s.cols[i], 10); }
          const b = this.R(i); ctx.fillStyle = s.cols[s.right[i]]; ctx.fillRect(b.x, b.y - 8, 40, 16);
          ctx.fillStyle = '#ccc'; ctx.fillRect(a.x - 6, a.y - 10, 12, 20); ctx.fillRect(b.x - 6, b.y - 10, 12, 20);
        }
        if (s.drag >= 0) { const a = this.L(s.drag); line(a.x, a.y, m.x, m.y, s.cols[s.drag], 10); }
      },
    },
    timing: {
      init: () => ({ hits: 0, t: 0, speed: 1.8, zone: rand(0.1, 0.75), needle: 0 }),
      update(s, dt) { s.t += dt * s.speed; s.needle = (Math.sin(s.t) + 1) / 2; },
      down(s) {
        if (s.needle >= s.zone && s.needle <= s.zone + 0.13) {
          Sfx.beep(s.hits * 3);
          if (++s.hits >= 3) { completeTask(); return; }
          s.speed += 0.7; s.zone = rand(0.1, 0.75);
        } else { s.hits = 0; s.speed = 1.8; failTask('Calibration failed!'); }
      },
      draw(s) {
        text('Click when the needle is in the green zone. 3 in a row.', PW / 2, 55, 13);
        ctx.fillStyle = '#111'; ctx.fillRect(60, 170, 400, 36);
        ctx.fillStyle = 'rgba(93,255,106,0.6)'; ctx.fillRect(60 + 400 * s.zone, 170, 400 * 0.13, 36);
        ctx.fillStyle = '#fff'; ctx.fillRect(60 + 400 * s.needle - 2, 160, 4, 56);
        for (let i = 0; i < 3; i++) { ctx.fillStyle = i < s.hits ? '#5dff6a' : '#333'; ctx.beginPath(); ctx.arc(220 + i * 40, 260, 12, 0, TAU); ctx.fill(); }
      },
    },
    simon: {
      init: () => ({ seq: Array.from({ length: 4 }, () => Math.floor(Math.random() * 9)), round: 1, phase: 'show', t: -0.5, input: 0, lit: -1, litUntil: 0 }),
      cell: (i) => ({ x: 147 + (i % 3) * 78, y: 90 + Math.floor(i / 3) * 78 }),
      update(s, dt) {
        if (s.phase !== 'show') return;
        s.t += dt;
        const step = Math.floor(s.t / 0.6);
        if (s.t < 0) s.lit = -1;
        else if (step < s.round) { const nl = (s.t % 0.6) < 0.42 ? s.seq[step] : -1; if (nl !== s.lit && nl >= 0) Sfx.beep(nl); s.lit = nl; }
        else { s.phase = 'input'; s.input = 0; s.lit = -1; }
      },
      down(s, m) {
        if (s.phase !== 'input') return;
        for (let i = 0; i < 9; i++) {
          const c = this.cell(i);
          if (!btn(c.x, c.y, 68, 68, m)) continue;
          s.lit = i; s.litUntil = now + 0.2;
          if (i === s.seq[s.input]) {
            Sfx.beep(i);
            if (++s.input === s.round) {
              if (++s.round > s.seq.length) { completeTask(); return; }
              s.phase = 'show'; s.t = -0.5;
            }
          } else { s.round = 1; s.phase = 'show'; s.t = -0.8; failTask('Wrong sequence!'); }
        }
      },
      draw(s) {
        text(s.phase === 'show' ? 'Watch the access sequence...' : `Repeat it! (${s.input}/${s.round})`, PW / 2, 60, 14);
        for (let i = 0; i < 9; i++) {
          const c = this.cell(i);
          const lit = s.lit === i && (s.phase === 'show' || now < s.litUntil);
          ctx.fillStyle = lit ? '#5dd6ff' : '#0f2230'; ctx.fillRect(c.x, c.y, 68, 68);
          ctx.strokeStyle = '#3a7a9a'; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, 68, 68);
        }
        text(`Stage ${Math.min(s.round, s.seq.length)}/${s.seq.length}`, PW / 2, 345, 13);
      },
    },
    hexes: {
      init() {
        const on = new Array(7).fill(true);
        const s = { on };
        while (on.every((v) => v)) for (let i = 0; i < 3; i++) this.toggle(s, Math.floor(Math.random() * 7));
        return s;
      },
      pos: (i) => (i === 0 ? { x: 260, y: 210 } : { x: 260 + Math.cos((i - 1) * Math.PI / 3) * 92, y: 210 + Math.sin((i - 1) * Math.PI / 3) * 92 }),
      adj: (i) => (i === 0 ? [1, 2, 3, 4, 5, 6] : [0, (i % 6) + 1, ((i + 4) % 6) + 1]),
      toggle(s, i) { s.on[i] = !s.on[i]; for (const j of this.adj(i)) s.on[j] = !s.on[j]; },
      down(s, m) {
        for (let i = 0; i < 7; i++) {
          const p = this.pos(i);
          if (dist(p.x, p.y, m.x, m.y) < 38) { this.toggle(s, i); Sfx.click2(); if (s.on.every((v) => v)) completeTask(); return; }
        }
      },
      draw(s) {
        text('Light every cell. A click flips a cell AND its neighbours.', PW / 2, 55, 13);
        for (let i = 0; i < 7; i++) {
          const p = this.pos(i);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; ctx.lineTo(p.x + Math.cos(a) * 42, p.y + Math.sin(a) * 42); }
          ctx.closePath();
          ctx.fillStyle = s.on[i] ? '#bff4ff' : '#5a1a22'; ctx.fill();
          ctx.strokeStyle = '#0a1a24'; ctx.lineWidth = 3; ctx.stroke();
        }
      },
    },
  };

  function drawTaskPanel() {
    const t = game.task, o = panel(), m = local();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.fillStyle = '#071118'; ctx.fillRect(0, 0, PW, PH);
    ctx.strokeStyle = 'rgba(120,230,255,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, PW, PH);
    ctx.fillStyle = '#0c1e2a'; ctx.fillRect(0, 0, PW, 34);
    text(t.name, PW / 2 - 40, 23, 14, '#ffd84a');
    text('ESC: step away', PW - 62, 23, 11, 'rgba(255,255,255,0.5)');
    MINI[t.type].draw(t.st, m);
    ctx.restore();
    const c = game.creature;
    if (game.creaturePath < 8 && Math.sin(now * 12) > 0) text('⚠ IT IS CLOSE...', W / 2, o.y + PH + 30, 18, '#ff5a5a');
  }

  // Jump-scare face: the Matron up close. Milky blind eyes, bandaged head, wide grin.
  function drawScareFace(scale, shake, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + rand(-shake, shake), H / 2 + rand(-shake, shake));
    const s = scale * Math.min(W, H) / 520;
    ctx.scale(s, s);
    ctx.fillStyle = '#7d7b76';
    ctx.beginPath(); ctx.ellipse(0, -40, 185, 205, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(0, -232, 72, 55, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(40,40,40,0.4)'; ctx.lineWidth = 3;
    for (let i = -8; i <= 8; i++) { ctx.beginPath(); ctx.moveTo(i * 20, -230); ctx.quadraticCurveTo(i * 24, -120, i * 22, 40); ctx.stroke(); }
    const g = ctx.createRadialGradient(0, 0, 20, 0, 20, 180);
    g.addColorStop(0, '#eadfce'); g.addColorStop(0.7, '#b3a48c'); g.addColorStop(1, '#5e5244');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 20, 125, 165, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(80,55,40,0.55)'; ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, -10 + i * 14, 92 - i * 10, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke(); }
    for (const sx of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(sx * 72, 20); ctx.quadraticCurveTo(sx * 82, 80, sx * 58, 140); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(sx * 30, 5); ctx.quadraticCurveTo(sx * 45, 15, sx * 70, 0); ctx.stroke();
    }
    ctx.fillStyle = '#2a1a14';
    ctx.beginPath(); ctx.ellipse(-48, -30, 40, 30, -0.1, 0, TAU); ctx.ellipse(48, -30, 40, 30, 0.1, 0, TAU); ctx.fill();
    for (const ex of [-48, 48]) {
      const eg = ctx.createRadialGradient(ex, -30, 2, ex, -30, 24);
      eg.addColorStop(0, '#ffffff'); eg.addColorStop(1, '#bcc6bc');
      ctx.fillStyle = eg;
      ctx.beginPath(); ctx.ellipse(ex, -30, 25, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(120,130,120,0.3)';
      ctx.beginPath(); ctx.arc(ex + Math.sin(now * 30) * 2, -30, 8, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#9a8670';
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-16, 40); ctx.lineTo(16, 40); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#140808';
    ctx.beginPath(); ctx.ellipse(0, 98, 86, 36 + Math.sin(now * 40) * 5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d6c690';
    for (let i = -6; i <= 6; i++) {
      ctx.fillRect(i * 12 - 5, 66 + Math.abs(i) * 2, 9, 16 - Math.abs(i));
      ctx.fillRect(i * 12 - 5, 116 - Math.abs(i) * 2, 9, 14 - Math.abs(i));
    }
    ctx.save();
    ctx.rotate(-0.18);
    ctx.fillStyle = '#e6e0d4'; ctx.fillRect(-140, -118, 280, 30);
    ctx.fillStyle = 'rgba(150,20,20,0.8)';
    ctx.beginPath(); ctx.ellipse(40, -104, 22, 12, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // Always-on personal light: nearby walls, traps and objects stay faintly visible.
  function drawLight() {
    const p = game.player, R = CFG.lightRadius;
    const pts = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * TAU;
      pts.push(castRay(p.x, p.y, Math.cos(a), Math.sin(a), R));
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!a.hit || !b.hit || dist(a.x, a.y, b.x, b.y) > TILE * 0.8) continue;
      const al = 0.15 + 0.45 * (1 - a.dist / R);
      ctx.strokeStyle = rgba(COL.wall, al);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const near = [];
    const add = (kind, x, y, extra = {}) => { if (dist(x, y, p.x, p.y) < R && lineOfSight(p.x, p.y, x, y)) near.push({ kind, x, y, ...extra }); };
    for (const l of game.lockers) add('locker', l.x, l.y);
    for (const r of game.radios) add('radio', r.x, r.y);
    for (const t of game.pickups) if (!t.taken) { const m = itemMark(t); add(m.kind, m.x, m.y, m); }
    for (const k of game.keycards) if (!k.taken) add('key', k.x, k.y, { color: k.color, terminal: true });
    for (const n of game.notes) add('note', n.px, n.py, { read: n.read });
    add('bench', game.bench.x, game.bench.y);
    for (const t of game.traps) {
      if (t.gone) continue;
      add('trap', t.px, t.py, { trap: t });
      if (t.type === 'shock') add('switch', t.swx, t.swy, { trap: t });
    }
    add('exit', game.exit.x, game.exit.y);
    if (!DIFFS[difficulty].practice) add('creature', game.creature.x, game.creature.y);
    const t0 = now - CFG.sonar.fade * 0.35;
    const saved = marks;
    marks = near.map((m) => ({ ...m, t: t0 }));
    drawMarks();
    marks = saved;
  }

  function drawTrapMark(t, a) {
    if (t.gone) return;
    if (t.type === 'bear') {
      const col = t.owner === 'player' ? COL.amber : [210, 210, 210];
      const r = t.armed ? 12 : 7;
      ctx.strokeStyle = rgba(col, a); ctx.fillStyle = rgba(col, a); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(t.px, t.py, r, 0, TAU); ctx.stroke();
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * TAU;
        ctx.beginPath(); ctx.moveTo(t.px + Math.cos(ang) * r, t.py + Math.sin(ang) * r);
        ctx.lineTo(t.px + Math.cos(ang + 0.15) * (r - 5), t.py + Math.sin(ang + 0.15) * (r - 5));
        ctx.lineTo(t.px + Math.cos(ang + 0.3) * r, t.py + Math.sin(ang + 0.3) * r); ctx.fill();
      }
    } else if (t.type === 'tripwire') {
      ctx.fillStyle = rgba([180, 180, 180], a);
      ctx.fillRect(t.px - 20, t.py - 4, 5, 8); ctx.fillRect(t.px + 15, t.py - 4, 5, 8);
      if (t.armed) line(t.px - 15, t.py, t.px + 15, t.py, rgba(COL.red, a * (0.6 + Math.random() * 0.4)), 1.5);
    } else if (t.type === 'shock') {
      const col = t.armed ? [90, 160, 255] : [80, 80, 80];
      for (let i = -16; i <= 16; i += 8) {
        line(t.px + i, t.py - 16, t.px + i, t.py + 16, rgba(col, a * 0.8), 1.2);
        line(t.px - 16, t.py + i, t.px + 16, t.py + i, rgba(col, a * 0.8), 1.2);
      }
      if (t.armed && Math.random() < 0.5) line(t.px + rand(-14, 14), t.py + rand(-14, 14), t.px + rand(-14, 14), t.py + rand(-14, 14), rgba([200, 230, 255], a), 2);
    } else if (t.type === 'creak') {
      ctx.strokeStyle = rgba([200, 160, 110], a * 0.8); ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]); ctx.strokeRect(t.px - 15, t.py - 15, 30, 30); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(t.px - 10, t.py - 6); ctx.lineTo(t.px + 2, t.py + 2); ctx.lineTo(t.px + 9, t.py - 3); ctx.stroke();
    }
  }

  function drawSwitch(t, a) {
    ctx.strokeStyle = rgba([200, 200, 200], a); ctx.lineWidth = 2;
    ctx.strokeRect(t.swx - 8, t.swy - 11, 16, 22);
    ctx.fillStyle = rgba(t.armed ? COL.red : [93, 255, 106], a);
    ctx.fillRect(t.swx - 2, t.armed ? t.swy - 9 : t.swy + 1, 4, 8);
    if (t.armed) { ctx.fillStyle = rgba([200, 200, 200], a); ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.fillText('FUSE', t.swx, t.swy - 15); }
  }

  function currentPrompt() {
    const p = game.player;
    if (game.task || mode !== 'play') return '';
    if (p.stuck) return `MASH SPACE to pry the trap open (${p.mash}/${CFG.trap.mash})`;
    if (p.hidden) return 'E leave locker · hold F to hold breath';
    if (p.hold) return `${p.hold.target.type === 'bear' ? 'Disarming' : 'Cutting'}... ${Math.round((p.hold.t / p.hold.need) * 100)}%`;
    if (game.keycards.some((k) => !k.taken && dist(k.x, k.y, p.x, p.y) < 34)) return game.held ? 'Hands full: X to drop before hacking' : 'E: hack the keycard terminal';
    if (dist(game.exit.x, game.exit.y, p.x, p.y) < 40) {
      if (game.held && game.held.kind === 'key') return 'E: insert keycard';
      if (game.cards === 3) return 'E: run the lockdown override';
    }
    if (game.reading) return 'E: close note';
    if (dist(game.bench.x, game.bench.y, p.x, p.y) < 34) {
      if (game.bench.built) return 'Workbench: UV Flash built (F to fire)';
      if (game.held && game.held.kind === 'part') return `E: place the ${PART_NAMES[game.held.part]} on the workbench`;
      return Object.keys(game.bench.parts).length === 3 ? 'E: assemble the UV Flash' : `Workbench: parts ${Object.keys(game.bench.parts).length}/3`;
    }
    if (game.notes.some((n) => dist(n.px, n.py, p.x, p.y) < 30)) return 'E: read note';
    const item = game.pickups.find((t) => !t.taken && dist(t.x, t.y, p.x, p.y) < 28);
    if (item) return game.held ? 'Hands full: X to drop' : `E: pick up ${itemName(item)}`;
    if (game.traps.some((t) => t.type === 'shock' && t.armed && dist(t.swx, t.swy, p.x, p.y) < 30)) return 'E: pull the fuse';
    if (game.lockers.some((l) => dist(l.x, l.y, p.x, p.y) < 30)) return 'E: hide in locker';
    if (game.radios.some((r) => dist(r.x, r.y, p.x, p.y) < 40)) return 'E: switch on radio';
    if (nearestDisarmable()) return 'Hold C + hold E: disarm trap';
    return '';
  }

  function win() {
    mode = 'win';
    game.endTime = now;
    const s = game.stats;
    const t = now - game.startTime;
    const raw = 1000 + Math.max(0, 900 - t) + (s.detections === 0 ? 500 : 0) -
                s.deaths * 200 - s.detections * 75 - s.pulses * 3;
    const score = Math.max(0, Math.round(raw * DIFFS[difficulty].score));
    const grade = score >= 2000 ? 'S' : score >= 1500 ? 'A' : score >= 1000 ? 'B' : score >= 500 ? 'C' : 'D';
    const isBest = !DIFFS[difficulty].practice && (!best || score > best.score);
    if (isBest) {
      best = { score, grade, diff: DIFFS[difficulty].name };
      saveBest(best);
    }
    game.result = { score, grade, isBest };
    Sfx.win();
  }

  // Faint memory of walls you've already pinged (Easy/Normal) keeps navigation fair.
  function drawMemory() {
    ctx.fillStyle = 'rgba(120,230,255,0.13)';
    const m = game.memory;
    for (let i = 0; i < m.length; i++) {
      if (m[i]) ctx.fillRect((i % MAP_W) * TILE, ((i / MAP_W) | 0) * TILE, TILE, TILE);
    }
  }

  // ---- Rendering -------------------------------------------------------------
  function drawMapFull(alpha, color) {
    ctx.fillStyle = rgba(color, alpha);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (grid[y][x] !== 1) continue;
        const open = DIR4.some(([ox, oy]) => walkable(x + ox, y + oy));
        if (open) ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }

  function drawPulses() {
    ctx.lineCap = 'round';
    for (const pl of pulses) {
      const rr = (now - pl.start) * CFG.sonar.ringSpeed;
      // Concentric sonar waves rolling out from the source (three for the player's pulses)
      for (let w = 0; w < pl.waves && pl.ring; w++) {
        const wr = rr - w * 34;
        if (wr <= 0 || wr >= pl.range) continue;
        const fade = (1 - wr / pl.range) * (1 - w * 0.3);
        ctx.strokeStyle = rgba(pl.color, 0.12 * fade);
        ctx.lineWidth = 9;
        ctx.beginPath(); ctx.arc(pl.ox, pl.oy, wr, 0, TAU); ctx.stroke();
        ctx.strokeStyle = rgba(pl.color, 0.45 * fade);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pl.ox, pl.oy, wr, 0, TAU); ctx.stroke();
      }
      const n = pl.pts.length;
      for (let i = 0; i < n; i++) {
        const a = pl.pts[i], b = pl.pts[(i + 1) % n];
        if (!a.hit) {
          if (pl.color === COL.wall && i % 6 === 0) { const al = pulseAlpha(a.t); if (al > 0) drawRoute(pl, a, al); }
          continue;
        }
        const al = pulseAlpha(Math.max(a.t, b.hit ? b.t : a.t));
        if (al <= 0) continue;
        if (b.hit && dist(a.x, a.y, b.x, b.y) < TILE * 0.8) {
          ctx.strokeStyle = rgba(pl.color, al * 0.25);
          ctx.lineWidth = 6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          ctx.strokeStyle = rgba(pl.color, al);
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        } else {
          ctx.fillStyle = rgba(pl.color, al);
          ctx.fillRect(a.x - 1.5, a.y - 1.5, 3, 3);
        }
      }
    }
  }

  // A chevron where a pulse found open space: the route continues this way.
  function drawRoute(pl, a, al) {
    const ang = Math.atan2(a.y - pl.oy, a.x - pl.ox);
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(ang);
    ctx.strokeStyle = `rgba(120,255,170,${al * 0.7})`;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(0, 0); ctx.lineTo(-6, 6); ctx.stroke();
    ctx.restore();
  }

  function drawKeyShape(shape, x, y, s, fill, stroke) {
    ctx.beginPath();
    if (shape === 'square') ctx.rect(x - s, y - s, s * 2, s * 2);
    else if (shape === 'triangle') { ctx.moveTo(x, y - s * 1.2); ctx.lineTo(x + s * 1.1, y + s); ctx.lineTo(x - s * 1.1, y + s); ctx.closePath(); }
    else ctx.arc(x, y, s, 0, TAU);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  // The Matron as an echo: a hunched old woman with a bun and a cane.
  function drawCreatureShape(x, y, a) {
    const c = game.creature;
    const chasing = c.state === 'chase', stunned = c.state === 'trapped';
    const twitch = chasing ? rand(-1.5, 1.5) : Math.sin(now * 23) > 0.96 ? rand(-2, 2) : 0;
    ctx.save();
    ctx.translate(x + twitch, y - 8);
    ctx.globalAlpha *= a;
    ctx.shadowColor = stunned ? '#b07aff' : chasing ? '#ff2020' : '#ff6060';
    ctx.shadowBlur = 14;
    // tattered, bloodstained nightgown
    const gown = ctx.createLinearGradient(0, -6, 0, 26);
    gown.addColorStop(0, '#d9d2c2'); gown.addColorStop(1, '#6e665a');
    ctx.fillStyle = gown;
    ctx.beginPath();
    ctx.moveTo(-7, -6); ctx.quadraticCurveTo(-15, 8, -13, 25);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-13 + i * 4.3, 25 + (i % 2 ? -4 : 0));
    ctx.quadraticCurveTo(15, 8, 7, -6);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(120,10,10,0.85)';
    ctx.beginPath(); ctx.ellipse(-4, 10, 4, 6, 0.3, 0, TAU); ctx.ellipse(5, 18, 3, 4, 0, 0, TAU); ctx.fill();
    // bony arms; the right hand drags a bloody bat
    ctx.strokeStyle = '#cfc6b4'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-7, -3); ctx.lineTo(-12, 10 + Math.sin(now * 3) * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -3); ctx.lineTo(12, 7); ctx.stroke();
    ctx.save();
    ctx.translate(12, 7); ctx.rotate(chasing ? -0.9 + Math.sin(now * 10) * 0.3 : 0.5);
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-1.5, 0, 3.5, 20);
    ctx.fillStyle = 'rgba(140,15,15,0.9)'; ctx.fillRect(-1.5, 13, 3.5, 7);
    ctx.restore();
    // head: grey bun, stringy hair, bandage, milky glowing eyes, open mouth
    ctx.fillStyle = '#8c8a84';
    ctx.beginPath(); ctx.arc(0, -19, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#c9bfae';
    ctx.beginPath(); ctx.ellipse(0, -12, 6.5, 7.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#77756f'; ctx.lineWidth = 1.2;
    for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(i * 2, -18); ctx.quadraticCurveTo(i * 3, -10, i * 3.2, -3); ctx.stroke(); }
    ctx.fillStyle = '#ece6da'; ctx.fillRect(-7, -17, 14, 3);
    ctx.fillStyle = '#8a1010'; ctx.fillRect(1, -17, 3, 3);
    ctx.fillStyle = stunned ? '#c9a0ff' : chasing ? '#ff3030' : '#f4fff4';
    ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(-2.6, -12, 1.6, 0, TAU); ctx.arc(2.6, -12, 1.6, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#1a0606';
    ctx.beginPath(); ctx.ellipse(0, -7.5, 2.2, chasing ? 2.8 : 1.6, 0, 0, TAU); ctx.fill();
    ctx.restore();
    if (stunned) {
      ctx.fillStyle = rgba(c.stunned ? [200, 160, 255] : COL.amber, a);
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${c.stunned ? 'STUNNED' : 'TRAPPED'} ${Math.max(0, Math.ceil(c.trappedUntil - now))}s`, x, y - 40);
    }
  }

  function drawMarks() {
    for (const m of marks) {
      const a = pulseAlpha(m.t);
      if (a <= 0) continue;
      ctx.lineWidth = 2;
      if (m.kind === 'locker') {
        ctx.strokeStyle = rgba(COL.amber, a);
        ctx.strokeRect(m.x - 9, m.y - 13, 18, 26);
        ctx.beginPath(); ctx.moveTo(m.x - 5, m.y - 6); ctx.lineTo(m.x + 5, m.y - 6);
        ctx.moveTo(m.x - 5, m.y - 2); ctx.lineTo(m.x + 5, m.y - 2); ctx.stroke();
      } else if (m.kind === 'radio') {
        ctx.strokeStyle = rgba(COL.amber, a);
        ctx.strokeRect(m.x - 9, m.y - 5, 18, 11);
        ctx.beginPath(); ctx.moveTo(m.x + 5, m.y - 5); ctx.lineTo(m.x + 10, m.y - 14); ctx.stroke();
      } else if (m.kind === 'throwable') {
        ctx.strokeStyle = rgba(COL.amber, a);
        ctx.beginPath(); ctx.arc(m.x, m.y, 4, 0, TAU); ctx.stroke();
      } else if (m.kind === 'key') {
        const k = KEYS[m.color];
        drawKeyShape(k.shape, m.x, m.y, 7, rgba(k.col, a * 0.7), rgba(k.col, a));
        ctx.strokeStyle = rgba(k.col, a * 0.3);
        ctx.beginPath(); ctx.arc(m.x, m.y, 14 + Math.sin(now * 6) * 2, 0, TAU); ctx.stroke();
        if (m.terminal) {
          ctx.strokeStyle = rgba(k.col, a * 0.8);
          ctx.strokeRect(m.x - 13, m.y - 13, 26, 26);
          ctx.fillStyle = rgba(k.col, a);
          ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
          ctx.fillText(`${k.label} TERMINAL`, m.x, m.y - 20);
        }
      } else if (m.kind === 'note') {
        ctx.save();
        ctx.translate(m.x, m.y); ctx.rotate(0.2);
        ctx.fillStyle = rgba([255, 230, 160], a * (m.read ? 0.25 : 0.7));
        ctx.fillRect(-6, -8, 12, 16);
        ctx.strokeStyle = rgba([120, 90, 40], a);
        ctx.lineWidth = 1;
        for (let i = -4; i <= 4; i += 4) { ctx.beginPath(); ctx.moveTo(-3, i); ctx.lineTo(3, i); ctx.stroke(); }
        ctx.restore();
        if (!m.read) { ctx.fillStyle = rgba([255, 230, 160], a); ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText('NOTE', m.x, m.y - 13); }
      } else if (m.kind === 'exit') {
        ctx.strokeStyle = rgba(COL.exit, a);
        ctx.strokeRect(m.x - 14, m.y - 14, 28, 28);
        ctx.fillStyle = rgba(COL.exit, a);
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('EXIT', m.x, m.y + 4);
        ['red', 'blue', 'green'].forEach((c, i) => {
          const k = KEYS[c], lit = game.inserted[c];
          ctx.lineWidth = 1.5;
          drawKeyShape(k.shape, m.x - 14 + i * 14, m.y + 22, 4, lit ? rgba(k.col, a) : null, rgba(k.col, a * (lit ? 1 : 0.5)));
        });
      } else if (m.kind === 'creature') {
        drawCreatureShape(m.x, m.y, a);
      } else if (m.kind === 'part') {
        drawPart(m.part, m.x, m.y, 0.9, a);
        ctx.fillStyle = rgba([210, 170, 255], a); ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(PART_NAMES[m.part].toUpperCase(), m.x, m.y - 15);
      } else if (m.kind === 'bench') {
        const b = game.bench;
        ctx.strokeStyle = rgba([190, 140, 255], a); ctx.lineWidth = 2;
        ctx.strokeRect(m.x - 16, m.y - 10, 32, 20);
        ['battery', 'bulb', 'wire'].forEach((k, i) => drawPart(k, m.x - 10 + i * 10, m.y, 0.45, a * (b.parts[k] || b.built ? 1 : 0.25)));
        ctx.fillStyle = rgba([210, 170, 255], a); ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center';
        ctx.fillText(b.built ? 'WORKBENCH ✓' : 'WORKBENCH', m.x, m.y - 15);
      } else if (m.kind === 'trapitem') {
        ctx.strokeStyle = rgba([210, 210, 210], a);
        ctx.beginPath(); ctx.arc(m.x, m.y, 7, 0, TAU); ctx.moveTo(m.x - 7, m.y); ctx.lineTo(m.x + 7, m.y); ctx.stroke();
      } else if (m.kind === 'trap') {
        drawTrapMark(m.trap, a);
      } else if (m.kind === 'switch') {
        drawSwitch(m.trap, a);
      }
    }
  }

  // Top-down scientist: lab coat, swinging arms and legs, carrying whatever is in their hands.
  function drawPerson(p) {
    if (p.hidden) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath(); ctx.arc(p.x - 3, p.y - 2, 1.6, 0, TAU); ctx.arc(p.x + 3, p.y - 2, 1.6, 0, TAU); ctx.fill();
      return;
    }
    const stunned = now < p.stunUntil;
    const sw = Math.sin(p.walk) * Math.min(1, p.speedNow / 80) * 6;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(1.5, 2, 11, 9, 0, 0, TAU); ctx.fill();
    ctx.rotate(p.face);
    if (p.sneaking) ctx.scale(0.85, 0.85);
    ctx.fillStyle = '#2b3440';
    ctx.beginPath(); ctx.ellipse(sw, -4.5, 5, 2.8, 0, 0, TAU); ctx.ellipse(-sw, 4.5, 5, 2.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = stunned ? '#9fd0ff' : '#e8eef2';
    ctx.strokeStyle = '#1a2a33';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-6, -10, 11, 20, 5); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-3 + sw * 0.6, -13, 10, 4, 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.roundRect(-3 - sw * 0.6, 9, 10, 4, 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#f0c8a0';
    ctx.beginPath(); ctx.arc(1, 0, 5.5, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#3a2a1e';
    ctx.beginPath(); ctx.arc(0, 0, 5.5, Math.PI * 0.55, Math.PI * 1.45); ctx.closePath(); ctx.fill();
    const h = game.held;
    if (h) {
      ctx.translate(9 - sw * 0.6, 11);
      if (h.kind === 'bottle') { ctx.fillStyle = '#6fbf73'; ctx.fillRect(-2, -5, 4, 10); ctx.fillRect(-1, -8, 2, 3); }
      else if (h.kind === 'key') { const k = KEYS[h.color]; ctx.lineWidth = 1; drawKeyShape(k.shape, 0, 0, 3.5, rgba(k.col, 1), '#fff'); }
      else { ctx.strokeStyle = '#ccc'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 4, 0, TAU); ctx.stroke(); }
    }
    ctx.restore();
  }

  function wrapText(str, x, y, maxW, lh) {
    let ln = '';
    for (const w of str.split(' ')) {
      const t = ln ? ln + ' ' + w : w;
      if (ctx.measureText(t).width > maxW) { ctx.fillText(ln, x, y); ln = w; y += lh; } else ln = t;
    }
    ctx.fillText(ln, x, y);
    return y + lh;
  }

  const MINI_MAP = { w: 200, h: 134 };
  const miniRect = () => ({ x: W - MINI_MAP.w - 16, y: 12, w: MINI_MAP.w, h: MINI_MAP.h });

  // Map of what you've explored: walls your pulses found, floor you've walked, and known targets.
  function drawMapView(x0, y0, w, h, big) {
    const s = Math.min(w / MAP_W, h / MAP_H);
    const ox = x0 + (w - MAP_W * s) / 2, oy = y0 + (h - MAP_H * s) / 2;
    const p = game.player;
    ctx.fillStyle = 'rgba(3,12,18,0.88)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = 'rgba(120,230,255,0.5)'; ctx.lineWidth = 1;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      const tx = i % MAP_W, ty = (i / MAP_W) | 0;
      if (game.visited[i]) { ctx.fillStyle = 'rgba(120,230,255,0.13)'; ctx.fillRect(ox + tx * s, oy + ty * s, s + 0.5, s + 0.5); }
      if (game.memory[i]) { ctx.fillStyle = 'rgba(120,230,255,0.75)'; ctx.fillRect(ox + tx * s, oy + ty * s, s + 0.5, s + 0.5); }
    }
    const pt = (wx, wy) => [ox + (wx / TILE) * s, oy + (wy / TILE) * s];
    const r = big ? 6 : 3;
    for (const k of game.keycards) {
      if (k.taken || !game.known[k.color]) continue;
      const [mx, my] = pt(k.x, k.y); const d = KEYS[k.color];
      ctx.lineWidth = 1.5; drawKeyShape(d.shape, mx, my, r, rgba(d.col, 0.9), '#fff');
    }
    if (game.known.exit || game.cards > 0 || (game.held && game.held.kind === 'key')) {
      const [mx, my] = pt(game.exit.x, game.exit.y);
      ctx.fillStyle = rgba(COL.exit, 0.9); ctx.fillRect(mx - r, my - r, r * 2, r * 2);
      if (big) { ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillText('EXIT', mx, my + r + 14); }
    }
    { const [mx, my] = pt(game.bench.x, game.bench.y); ctx.fillStyle = 'rgba(190,140,255,0.9)'; ctx.fillRect(mx - r * 0.8, my - r * 0.8, r * 1.6, r * 1.6); }
    const [px, py] = pt(p.x, p.y);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(px, py, big ? 5 : 2.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + Math.cos(p.face) * (big ? 12 : 6), py + Math.sin(p.face) * (big ? 12 : 6)); ctx.stroke();
    if (big) {
      ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
      const labels = [['SERVER WING', 7, 9], ['CRYO WING', 30, 1.5], ['FLOODED WING', 52, 9], ['HUB', 30, 14.6], ['EXIT HALL', 30, 38]];
      ctx.fillStyle = 'rgba(200,240,255,0.45)';
      for (const [l, tx, ty] of labels) ctx.fillText(l, ox + tx * s, oy + ty * s);
    }
  }

  function drawMiniMap() {
    if (mode !== 'play' && mode !== 'paused') return;
    const m = miniRect();
    drawMapView(m.x, m.y, m.w, m.h, false);
    ctx.font = '10px monospace'; ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(200,240,255,0.8)';
    ctx.fillText('MAP · M / click to open', m.x + m.w, m.y + m.h + 12);
  }

  function drawBigMap() {
    const w = Math.min(W - 80, 1000), h = Math.min(H - 120, 660);
    const x0 = (W - w) / 2, y0 = (H - h) / 2 + 10;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
    drawMapView(x0, y0, w, h, true);
    ctx.textAlign = 'center'; ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#cfefff';
    ctx.fillText('FACILITY MAP: explored areas only · white = you · ■▲● terminals from notes · purple = workbench · M / click to close', W / 2, y0 - 10);
  }

  function drawObjective() {
    if (mode !== 'play' && mode !== 'paused') return;
    const str = 'OBJECTIVE: ' + objective();
    ctx.font = 'bold 13px monospace';
    const w = ctx.measureText(str).width + 24;
    ctx.fillStyle = 'rgba(5,20,30,0.8)';
    ctx.fillRect(W / 2 - w / 2, 12, w, 26);
    ctx.strokeStyle = 'rgba(255,210,120,0.5)';
    ctx.strokeRect(W / 2 - w / 2, 12, w, 26);
    ctx.fillStyle = '#ffd27a';
    ctx.textAlign = 'center';
    ctx.fillText(str, W / 2, 30);
  }

  function drawNote(n) {
    const bw = Math.min(560, W - 40), bh = 230;
    const x0 = W / 2 - bw / 2, y0 = H / 2 - bh / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e6dcc0'; ctx.fillRect(x0, y0, bw, bh);
    ctx.strokeStyle = '#8a7a50'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, bw, bh);
    ctx.fillStyle = '#3a2f1a'; ctx.textAlign = 'center';
    ctx.font = 'bold 18px serif'; ctx.fillText(n.title, W / 2, y0 + 36);
    ctx.font = '16px serif';
    wrapText(n.text, W / 2, y0 + 72, bw - 50, 22);
    ctx.font = 'italic 13px serif'; ctx.fillStyle = '#6a5a3a';
    ctx.fillText('E: close · J: journal of every note you have read', W / 2, y0 + bh - 16);
  }

  function drawJournal() {
    const bw = Math.min(640, W - 40);
    const x0 = W / 2 - bw / 2, y0 = 60;
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e6dcc0'; ctx.fillRect(x0, y0, bw, H - 120);
    ctx.textAlign = 'center'; ctx.fillStyle = '#3a2f1a';
    ctx.font = 'bold 20px serif';
    ctx.fillText(`JOURNAL (${game.notesRead.length}/${game.notes.length} notes) · J to close`, W / 2, y0 + 32);
    let y = y0 + 64;
    if (!game.notesRead.length) { ctx.font = 'italic 15px serif'; ctx.fillText('No notes yet. Look for glowing pages (NOTE) around the lab.', W / 2, y); }
    for (const n of game.notesRead) {
      ctx.font = 'bold 14px serif'; ctx.fillText(n.title, W / 2, y);
      ctx.font = '13px serif';
      y = wrapText(n.text, W / 2, y + 18, bw - 50, 17) + 6;
      if (y > H - 80) break;
    }
  }

  // Edge-of-screen arrows toward targets the notes have revealed.
  function drawGuides() {
    if (mode !== 'play') return;
    const p = game.player, targets = [];
    for (const k of game.keycards) if (!k.taken && game.known[k.color]) targets.push({ x: k.x, y: k.y, col: KEYS[k.color].col, label: KEYS[k.color].label });
    if (game.known.exit || (game.held && game.held.kind === 'key') || game.cards === 3) targets.push({ x: game.exit.x, y: game.exit.y, col: COL.exit, label: 'EXIT' });
    for (const t of targets) {
      const sx = t.x - cam.x, sy = t.y - cam.y;
      if (sx > 50 && sx < W - 50 && sy > 50 && sy < H - 50) continue;
      const a = Math.atan2(sy - H / 2, sx - W / 2);
      const r = Math.min((W / 2 - 60) / Math.abs(Math.cos(a) || 1e-6), (H / 2 - 60) / Math.abs(Math.sin(a) || 1e-6));
      const ax = W / 2 + Math.cos(a) * r, ay = H / 2 + Math.sin(a) * r;
      ctx.save();
      ctx.translate(ax, ay); ctx.rotate(a);
      ctx.fillStyle = rgba(t.col, 0.6 + 0.3 * Math.sin(now * 5));
      ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(-8, -9); ctx.lineTo(-3, 0); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = rgba(t.col, 0.9);
      ctx.fillText(`${t.label} ${Math.round(dist(t.x, t.y, p.x, p.y) / TILE)}m`, ax - Math.cos(a) * 26, ay - Math.sin(a) * 26 + 4);
    }
  }

  function drawPlayer() {
    const p = game.player;
    const R = CFG.lightRadius;
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
    g.addColorStop(0, 'rgba(200,240,255,0.16)');
    g.addColorStop(1, 'rgba(200,240,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, TAU); ctx.fill();
    if (p.stuck) { ctx.strokeStyle = '#bbb'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, TAU); ctx.stroke(); }
    // Idle ripple from the character: sonar is ready. Rings pull inward while charging.
    if (!p.hidden && !p.charging && now >= game.pulseReadyAt && mode === 'play') {
      const ph = (now % 1.6) / 1.6;
      ctx.strokeStyle = rgba(COL.wall, 0.35 * (1 - ph));
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, 12 + ph * 34, 0, TAU); ctx.stroke();
    }
    if (p.charging) {
      for (let w = 0; w < 3; w++) {
        const ph = ((now * 2 + w / 3) % 1);
        ctx.strokeStyle = rgba(COL.wall, 0.5 * ph);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 14 + (1 - ph) * 44, 0, TAU); ctx.stroke();
      }
    }
    drawPerson(p);
    if (game.uvFlash && now - game.uvFlash.start < 0.45) {
      const f = game.uvFlash, k = 1 - (now - f.start) / 0.45;
      ctx.fillStyle = `rgba(190,140,255,${0.45 * k})`;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, CFG.uv.range, f.aim - CFG.uv.half, f.aim + CFG.uv.half); ctx.closePath(); ctx.fill();
    }
    if (p.charging) {
      const ch = clamp((now - p.chargeStart) / CFG.sonar.chargeTime, 0, 1);
      ctx.strokeStyle = rgba(COL.wall, 0.8);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + ch * TAU); ctx.stroke();
      // The trade-off, made visible: how far you will SEE vs how far you will be HEARD.
      const tap = now - p.chargeStart < 0.18;
      const S = CFG.sonar, N = CFG.noise;
      const seeR = tap ? S.tapRange : S.tapRange + (S.pingRange - S.tapRange) * ch;
      const hearR = zoneNoise(tap ? N.tap : N.pingMin + (N.pingMax - N.pingMin) * ch, p.x, p.y) * TILE;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = rgba(COL.wall, 0.45);
      ctx.beginPath(); ctx.arc(p.x, p.y, seeR, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgba(COL.red, 0.55);
      ctx.beginPath(); ctx.arc(p.x, p.y, hearR, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = rgba(COL.wall, 0.8);
      ctx.fillText('YOU SEE', p.x, p.y - seeR - 6);
      ctx.fillStyle = rgba(COL.red, 0.9);
      ctx.fillText('SHE HEARS', p.x, p.y + hearR + 14);
    }
    for (const f of game.flying) {
      const t = clamp((now - f.start) / f.dur, 0, 1);
      const x = f.sx + (f.ex - f.sx) * t, y = f.sy + (f.ey - f.sy) * t - Math.sin(t * Math.PI) * 20;
      ctx.fillStyle = rgba(COL.amber, 0.7);
      ctx.beginPath(); ctx.arc(x, y, 3, 0, TAU); ctx.fill();
    }
  }

  function drawOverlay() {
    // Vignette that turns red as the creature closes in.
    const danger = mode === 'play' ? clamp(1 - game.creaturePath / 12, 0, 1) : 0;
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, danger > 0 ? `rgba(${90 * danger | 0},0,0,${0.5 + danger * 0.3})` : 'rgba(0,0,0,0.6)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    // Static tears across the screen when she is close
    if (danger > 0.4) {
      for (let i = 0; i < 18 * danger; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.03 + Math.random() * 0.08 * danger})`;
        ctx.fillRect(0, Math.random() * H, W, 1 + Math.random() * 3);
      }
    }
    // Film grain
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 160; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  function areaName(x, y) {
    const tx = tileOf(x), ty = tileOf(y);
    if (tx < 14) return 'SERVER WING';
    if (tx > 45) return 'FLOODED WING';
    if (ty < 9) return 'CRYO WING';
    if (ty >= 30) return 'EXIT HALL';
    if (tx >= 24 && tx <= 35 && ty >= 15 && ty <= 23) return 'HUB';
    return 'CORRIDOR';
  }

  function bar(x, y, w, h, frac, col, label) {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
    ctx.fillStyle = 'rgba(200,240,255,0.7)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y - 3);
  }

  function drawHUD() {
    const p = game.player;
    const x = 16, y = H - 196;
    ctx.fillStyle = 'rgba(5,20,30,0.75)';
    ctx.strokeStyle = 'rgba(120,230,255,0.4)';
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, 260, 180);
    ctx.strokeRect(x, y, 260, 180);
    ctx.fillStyle = 'rgba(120,230,255,0.9)';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('WRIST SCANNER  //  ' + areaName(p.x, p.y), x + 10, y + 16);

    let kx = x + 22;
    for (const k of game.keycards) {
      const def = KEYS[k.color];
      ctx.lineWidth = 2;
      const lit = game.inserted[k.color];
      drawKeyShape(def.shape, kx, y + 38, 8, lit ? rgba(def.col, 0.9) : null, rgba(def.col, lit ? 1 : 0.4));
      if (game.held && game.held.kind === 'key' && game.held.color === k.color) {
        ctx.strokeStyle = rgba(def.col, 0.5 + 0.5 * Math.sin(now * 8));
        ctx.beginPath(); ctx.arc(kx, y + 38, 14, 0, TAU); ctx.stroke();
      }
      kx += 34;
    }
    ctx.fillStyle = 'rgba(200,240,255,0.8)';
    ctx.font = '11px monospace';
    ctx.fillText(`DOOR ${game.cards}/3`, x + 120, y + 42);
    ctx.fillStyle = game.stats.deaths + 1 >= CFG.days ? '#ff6060' : 'rgba(200,240,255,0.8)';
    ctx.fillText(`DAY ${Math.min(game.stats.deaths + 1, CFG.days)}/${CFG.days}`, x + 185, y + 42);
    if (game.cards === 3) {
      ctx.save();
      ctx.translate(x + 244, y + 13);
      ctx.rotate(Math.atan2(game.exit.y - p.y, game.exit.x - p.x));
      ctx.fillStyle = rgba(COL.exit, 0.6 + 0.4 * Math.sin(now * 6));
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -6); ctx.lineTo(-3, 0); ctx.lineTo(-6, 6); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    const cdLeft = game.pulseReadyAt - now;
    if (p.charging) bar(x + 10, y + 68, 240, 8, (now - p.chargeStart) / CFG.sonar.chargeTime, rgba(COL.wall, 0.9), 'SONAR CHARGE');
    else bar(x + 10, y + 68, 240, 8, cdLeft > 0 ? 1 - cdLeft / CFG.sonar.pingCd : 1, cdLeft > 0 ? 'rgba(120,230,255,0.35)' : rgba(COL.wall, 0.9), cdLeft > 0 ? 'SONAR RECHARGING' : 'SONAR READY');

    const z = zoneAt(p.x, p.y);
    const zl = z === 'vent' ? ' (vent hiss masks you)' : z === 'water' ? ' (splashing is loud!)' : '';
    const nf = game.noiseShown / 14;
    bar(x + 10, y + 96, 240, 8, nf, nf > 0.5 ? 'rgba(255,60,60,0.9)' : nf > 0.2 ? 'rgba(255,180,60,0.9)' : 'rgba(80,255,140,0.9)', 'NOISE' + zl);

    bar(x + 10, y + 124, 240, 8, p.stamina / CFG.stamina.max, p.exhausted ? 'rgba(255,60,60,0.8)' : 'rgba(224,192,80,0.9)',
        p.exhausted ? 'STAMINA (winded!)' : `STAMINA (SHIFT run) · UV ${game.bench.built ? game.uv + ' (F)' : 'not built'}`);

    if (p.hidden) bar(x + 10, y + 152, 240, 8, p.breath / CFG.breathMax, p.holding ? 'rgba(255,255,255,0.9)' : 'rgba(150,180,255,0.7)', p.holding ? 'HOLDING BREATH' : 'BREATH (hold F)');
    else {
      ctx.fillStyle = 'rgba(200,240,255,0.6)';
      ctx.fillStyle = game.held ? '#ffd27a' : 'rgba(200,240,255,0.6)';
      ctx.fillText(`HANDS: ${itemName(game.held)}${game.held ? ' (X drop)' : ''}${p.sneaking ? ' · sneaking' : ''}`, x + 10, y + 160);
    }

    if (game.caption && now < game.caption.until) {
      ctx.textAlign = 'center';
      ctx.font = 'italic bold 18px serif';
      ctx.fillStyle = `rgba(255,90,90,${clamp(game.caption.until - now, 0, 1)})`;
      ctx.fillText(`"${game.caption.text}"`, W / 2, H - 84);
    }
    const prompt = currentPrompt();
    if (prompt) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px monospace';
      ctx.fillStyle = 'rgba(5,20,30,0.75)';
      ctx.fillRect(W / 2 - 200, H - 64, 400, 30);
      ctx.fillStyle = '#e8f8ff';
      ctx.fillText(prompt, W / 2, H - 44);
    }

    if (game.msg && now < game.msg.until) {
      const a = clamp(game.msg.until - now, 0, 1);
      ctx.font = 'bold 18px monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(220,245,255,${a})`;
      ctx.fillText(game.msg.text, W / 2, 68);
    }

    if (showHelp) {
      const lines = ['WASD move · C sneak · SHIFT run', 'SPACE tap = click · hold = charged ping',
                     'Mouse + click = throw bottle', 'E hide / radio / hack terminal / fuse', 'F hold breath · G set trap · X drop item', 'J journal · M map · F fire UV Flash', 'Trapped: mash SPACE · C + hold E: disarm',
                     'ESC pause · H hide help · ` debug map'];
      ctx.fillStyle = 'rgba(5,20,30,0.6)';
      ctx.fillRect(16, 16, 300, lines.length * 16 + 12);
      ctx.fillStyle = 'rgba(200,240,255,0.75)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'left';
      lines.forEach((l, i) => ctx.fillText(l, 26, 34 + i * 16));
    }

    if (debug) {
      const c = game.creature;
      ctx.fillStyle = '#f66';
      ctx.font = '12px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`creature: ${c.state}  path: ${game.creaturePath}  intensity: ${c.intensity.toFixed(1)}`, W - 16, 170);
    }
  }

  function centerText(lines, y0) {
    ctx.textAlign = 'center';
    lines.forEach(([text, font, col], i) => {
      ctx.font = font;
      ctx.fillStyle = col;
      ctx.fillText(text, W / 2, y0 + i * 30);
    });
  }

  function drawMenu() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 4; i++) {
      const r = ((now * 160 + i * 140) % 560);
      ctx.strokeStyle = rgba(COL.wall, 0.4 * (1 - r / 560));
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(W / 2, H / 2 - 40, r, 0, TAU); ctx.stroke();
    }
    centerText([
      ['ECHO CHAMBER', 'bold 56px monospace', '#bff4ff'],
      ['', '1px monospace', '#000'],
      ['A sonar pulse reveals walls, objects and routes, but every pulse is a sound she can hear.', '15px monospace', 'rgba(200,240,255,0.85)'],
      ['Balance what you need to see against staying quiet long enough to escape.', '14px monospace', 'rgba(200,240,255,0.7)'],
      [`You have ${CFG.days} days. One item in your hands at a time. Drop it, and she hears.`, '14px monospace', 'rgba(255,180,60,0.9)'],
      ['Hack 3 keycards (■ server, ▲ cryo, ● flooded) and carry each to the EXIT door.', '14px monospace', 'rgba(200,240,255,0.7)'],
      ['WASD move · C sneak · SHIFT run · SPACE sonar (hold to charge)', '14px monospace', 'rgba(200,240,255,0.7)'],
      ['Click throw · E hide/radio/hack terminals · F hold breath · G set trap', '14px monospace', 'rgba(200,240,255,0.7)'],
      ['Watch for bear traps, tripwires, shock floors and creaky panels.', '14px monospace', 'rgba(255,170,170,0.8)'],
      ['', '1px monospace', '#000'],
      [DIFFS.map((d, i) => (i === difficulty ? `[ ${i + 1} ${d.name} ]` : `  ${i + 1} ${d.name}  `)).join('   '), 'bold 16px monospace', '#bff4ff'],
      [best ? `Best: grade ${best.grade} · ${best.score} pts (${best.diff})` : 'Press 1-4 to choose difficulty (4 = practice, no Matron)', '14px monospace', 'rgba(200,240,255,0.7)'],
      ['🎧 Headphones strongly recommended', '14px monospace', 'rgba(255,180,60,0.9)'],
      [Math.sin(now * 4) > -0.3 ? 'CLICK TO ENTER THE FACILITY' : '', 'bold 20px monospace', '#fff'],
    ], H / 2 - 130);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (mode === 'menu') { drawMenu(); return; }
    const p = game.player;
    cam.x = Math.round(p.x - W / 2);
    cam.y = Math.round(p.y - H / 2);
    if (mode === 'play' && game.creature.state === 'chase' && game.creaturePath < 8) {
      const k = (8 - game.creaturePath) * 0.6;
      cam.x += Math.round(rand(-k, k)); cam.y += Math.round(rand(-k, k));
    }
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    if (DIFFS[difficulty].hints && (mode === 'play' || mode === 'paused')) drawMemory();
    if (mode === 'dead' || mode === 'over') drawMapFull(0.25, COL.red);
    else if (mode === 'win') drawMapFull(0.2, COL.wall);
    else if (debug) drawMapFull(0.15, COL.wall);
    ctx.globalCompositeOperation = 'lighter';
    drawPulses();
    drawMarks();
    if (mode !== 'menu') drawLight();
    ctx.globalCompositeOperation = 'source-over';
    drawPlayer();
    if (game.noiseWave) {
      const w = game.noiseWave, k = (now - w.start) / 1.1;
      if (k < 1) {
        const col = w.heard ? COL.red : [255, 160, 90];
        ctx.setLineDash([10, 8]);
        ctx.strokeStyle = rgba(col, 0.7 * (1 - k));
        ctx.lineWidth = 2;
        const rr = w.r * Math.min(1, k * 1.8);
        ctx.beginPath(); ctx.arc(w.x, w.y, rr, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = rgba(col, 0.9 * (1 - k));
        ctx.fillText(w.heard ? 'SOUND — HEARD!' : 'SOUND', w.x, w.y - rr - 6);
      }
    }
    if (mode === 'dead' && game.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,60,70,0.7)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      game.trail.forEach((pt, i) => (i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (debug || mode === 'dead') {
      const c = game.creature;
      drawCreatureShape(c.x, c.y, 1);
      if (debug && c.tx >= 0) { ctx.strokeStyle = '#f66'; ctx.strokeRect(c.tx * TILE, c.ty * TILE, TILE, TILE); }
    }
    ctx.restore();
    drawOverlay();
    drawHUD();
    drawGuides();
    drawObjective();
    drawMiniMap();
    if (showMap) drawBigMap();
    if (game.reading) drawNote(game.reading);
    if (showJournal) drawJournal();
    if (game.task) drawTaskPanel();
    if (game.flash) {
      const ft = (now - game.flash.start) / 0.45;
      if (ft < 1) drawScareFace(1 + ft * 0.3, 12, ft < 0.6 ? 0.95 : (1 - ft) * 2.3);
      else game.flash = null;
    }
    if (mode === 'scare') {
      const st = clamp((now - game.scare.start) / game.scare.dur, 0, 1);
      ctx.fillStyle = st < 0.08 ? '#fff' : `rgba(120,0,0,${0.6 + Math.random() * 0.3})`;
      ctx.fillRect(0, 0, W, H);
      drawScareFace(0.6 + Math.pow(st, 0.4) * 1.1, 26 * (1 - st * 0.5), 1);
    }
    if (game.dayCard && mode === 'play') {
      const dc = now - game.dayCard.start;
      if (dc < 3.2) {
        const a = dc < 1.4 ? 1 : 1 - (dc - 1.4) / 1.8;
        const d = game.dayCard.day, last = d >= CFG.days;
        ctx.fillStyle = `rgba(0,0,0,${a})`;
        ctx.fillRect(0, 0, W, H);
        centerText([
          [`DAY ${d}`, 'bold 64px monospace', last ? `rgba(255,80,80,${a})` : `rgba(230,230,230,${a})`],
          [last ? 'Your last chance.' : d === 1 ? `You have ${CFG.days} days to escape.` : `${CFG.days - d + 1} days left.`, '18px monospace', `rgba(210,210,210,${a})`],
        ], H / 2 - 20, 50);
      }
    }

    if (mode === 'dead') {
      ctx.fillStyle = 'rgba(60,0,0,0.35)';
      ctx.fillRect(0, 0, W, H);
      centerText([
        ['SHE CAUGHT YOU', 'bold 56px monospace', '#ff5060'],
        [game.lastCause ? `It tracked you by your ${game.lastCause}. The red line is its path.` : 'It found you in the dark.', '16px monospace', 'rgba(255,200,200,0.85)'],
        [`${CFG.days - game.stats.deaths} day${CFG.days - game.stats.deaths === 1 ? '' : 's'} left. Anything you held is where you fell.`, '16px monospace', '#ffd27a'],
        [now - game.deadAt > 1 ? `Press SPACE or click to wake up: Day ${game.stats.deaths + 1}` : '', '16px monospace', '#fff'],
      ], H / 2 - 40);
    } else if (mode === 'win') {
      const s = game.stats;
      const t = game.endTime - game.startTime;
      const rating = s.detections === 0 ? 'GHOST' : s.deaths === 0 ? 'SURVIVOR' : 'ESCAPEE';
      const r = game.result;
      ctx.fillStyle = 'rgba(0,20,30,0.6)';
      ctx.fillRect(0, 0, W, H);
      centerText([
        ['YOU ESCAPED', 'bold 56px monospace', '#bff4ff'],
        [`GRADE ${r.grade}  ·  ${rating}`, 'bold 28px monospace', '#ffb43c'],
        [`Score ${r.score}${r.isBest ? '  ★ NEW BEST' : `  (best ${best.score})`}  ·  ${DIFFS[difficulty].name}`, 'bold 18px monospace', '#fff'],
        [`Time ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} · Pulses ${s.pulses} · Detected ${s.detections} · Escaped on day ${s.deaths + 1}/${CFG.days}`, '16px monospace', 'rgba(200,240,255,0.85)'],
        ['Click to play again · M for menu', '16px monospace', '#fff'],
      ], H / 2 - 60);
    } else if (mode === 'over') {
      ctx.fillStyle = 'rgba(20,0,0,0.88)';
      ctx.fillRect(0, 0, W, H);
      drawScareFace(0.55, 0, 0.3);
      centerText([
        ['GAME OVER', 'bold 60px monospace', '#ff5060'],
        [`${CFG.days} days gone. The Matron keeps you forever.`, '16px monospace', 'rgba(255,200,200,0.9)'],
        [`Door readers lit ${game.cards}/3 · Pulses ${game.stats.pulses} · Detected ${game.stats.detections}`, '15px monospace', '#ddd'],
        [now - game.deadAt > 1.5 ? 'Click to try again · M for menu' : '', '16px monospace', '#fff'],
      ], H / 2 - 40);
    } else if (mode === 'paused') {
      ctx.fillStyle = 'rgba(0,10,15,0.7)';
      ctx.fillRect(0, 0, W, H);
      centerText([
        ['PAUSED', 'bold 48px monospace', '#bff4ff'],
        ['ESC / P resume · M main menu', '16px monospace', '#fff'],
      ], H / 2 - 30);
    }
  }

  // ---- Loop & input ----------------------------------------------------------
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (mode !== 'paused') now += dt;
    if (mode === 'scare' && now - game.scare.start > game.scare.dur) finishDeath();
    const waking = game && game.dayCard && now - game.dayCard.start < 1.6;
    if (mode === 'play' && !waking) {
      updatePlayer(dt);
      if (game.task && MINI[game.task.type].update) MINI[game.task.type].update(game.task.st, dt);
      if (mode === 'play') updateWorld(dt);
      if (mode === 'play' && !DIFFS[difficulty].practice) updateCreature(dt);
    }
    Sfx.chase(mode === 'play' && !!game && game.creature.state === 'chase' && !DIFFS[difficulty].practice);
    render();
    requestAnimationFrame(frame);
  }

  function start() { Sfx.init(); newGame(); }

  addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    if (mode === 'menu') {
      if (['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) difficulty = Number(e.code.slice(5)) - 1;
      else if (e.code === 'ArrowLeft') difficulty = Math.max(0, difficulty - 1);
      else if (e.code === 'ArrowRight') difficulty = Math.min(DIFFS.length - 1, difficulty + 1);
      else if (e.code === 'Space' || e.code === 'Enter') start();
      return;
    }
    if (mode === 'paused') {
      if (e.code === 'Escape' || e.code === 'KeyP') mode = 'play';
      else if (e.code === 'KeyM') mode = 'menu';
      return;
    }
    if (mode === 'scare') return;
    if (mode === 'dead') { if ((e.code === 'Space' || e.code === 'KeyR') && now - game.deadAt > 1) respawn(); return; }
    if (mode === 'win' || mode === 'over') {
      if ((e.code === 'Space' || e.code === 'Enter') && (mode === 'win' || now - game.deadAt > 1.5)) newGame();
      else if (e.code === 'KeyM') mode = 'menu';
      return;
    }
    if (e.code === 'Space') { if (game.player.stuck) struggle(); else startCharge(); }
    else if (e.code === 'KeyG') placeTrap();
    else if (e.code === 'KeyX') dropHeld();
    else if (e.code === 'KeyJ') showJournal = !showJournal;
    else if (e.code === 'KeyM') showMap = !showMap;
    else if (e.code === 'KeyF' && !game.player.hidden) fireUV();
    else if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyH') showHelp = !showHelp;
    else if (e.code === 'Backquote') debug = !debug;
    else if (e.code === 'Escape' && game.task) game.task = null;
    else if (e.code === 'Escape' || e.code === 'KeyP') { game.player.charging = false; mode = 'paused'; }
  });
  addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'Space' && mode === 'play') releasePulse();
  });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (mode === 'play') { game.player.charging = false; mode = 'paused'; }
  });
  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (mode === 'play' && game.task && MINI[game.task.type].move) MINI[game.task.type].move(game.task.st, local());
  });
  canvas.addEventListener('mouseup', () => {
    if (mode === 'play' && game.task && MINI[game.task.type].up) MINI[game.task.type].up(game.task.st, local());
  });
  canvas.addEventListener('mousedown', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (mode === 'menu') start();
    else if (mode === 'play') {
      const mm = miniRect();
      if (game.task) MINI[game.task.type].down(game.task.st, local());
      else if (showMap || btn(mm.x, mm.y, mm.w, mm.h, mouse)) showMap = !showMap;
      else throwObject();
    }
    else if (mode === 'dead' && now - game.deadAt > 1) respawn();
    else if (mode === 'win' || (mode === 'over' && now - game.deadAt > 1.5)) newGame();
    else if (mode === 'paused') mode = 'play';
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Console hook for playtesting/tuning: EchoDebug.state()
  window.EchoDebug = { state: () => ({ mode, game }), cfg: CFG, mini: MINI };

  requestAnimationFrame(frame);
})();
