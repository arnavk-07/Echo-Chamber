// Ghost Ship: restore the ship's systems, survive the Matron, escape in the pod.
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = window.devicePixelRatio || 1;
    W = innerWidth; H = innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  }
  addEventListener('resize', resize);
  resize();

  // ---- Tuning ---------------------------------------------------------------
  const CFG = {
    walk: 115, run: 175, crouch: 60, accel: 12, radius: 10,
    stamina: { max: 100, drain: 24, regen: 14, recover: 25 },
    noise: { walk: 3, run: 8, creak: 6, struggle: 6, taskFail: 7, snap: 8, shock: 5 },
    vision: { cone: 330, ambient: 70, half: 0.55 },
    lives: 2,
    ghost: { wander: 75, investigate: 120, search: 90, chase: 160, checkvent: 125,
             sight: 8 * TILE, crouchSight: 5 * TILE, loseSec: 2.5, searchSec: 6, perTask: 0.025,
             stunSec: 30, trappedSec: 8 },
    uv: { charges: 2, range: 6 * TILE, half: 0.6 },
    bearDisarmSec: 2, wireCutSec: 1.2, mash: 8, stunSec: 1.5,
  };
  const TAU = Math.PI * 2;
  const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const PART_NAMES = { battery: 'Battery', bulb: 'UV Bulb', wire: 'Copper Wire' };

  // ---- State -----------------------------------------------------------------
  let level, grid, game = null;
  let mode = 'menu'; // menu | play | paused | scare | caught | over | win
  let now = 0;
  let showMap = false;
  const keys = {};
  const mouse = { x: 0, y: 0 };
  const cam = { x: 0, y: 0 };
  let floorCanvas = null;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const tileOf = (v) => Math.floor(v / TILE);
  const center = (t) => t * TILE + TILE / 2;
  const walkable = (tx, ty) => tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H && grid[ty][tx] === 0;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rand = (a, b) => a + Math.random() * (b - a);
  const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---- Audio (synthesised) ---------------------------------------------------
  let actx = null, master, noiseBuf;
  function audioInit() {
    if (actx) { actx.resume(); return; }
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.6; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function tone(type, f0, f1, dur, vol, delay = 0) {
    if (!actx) return;
    const t = actx.currentTime + delay;
    const o = actx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, type, freq, delay = 0) {
    if (!actx) return;
    const t = actx.currentTime + delay;
    const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = actx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = actx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  const Sfx = {
    step: (run) => noise(0.06, run ? 0.18 : 0.07, 'lowpass', run ? 1100 : 600),
    task: () => [660, 880, 1100].forEach((f, i) => tone('sine', f, f, 0.15, 0.2, i * 0.08)),
    click: () => tone('square', 1800, 1500, 0.03, 0.08),
    beep: (n) => tone('sine', 300 + n * 70, 300 + n * 70, 0.18, 0.15),
    buzz: () => tone('square', 140, 110, 0.35, 0.15),
    boom: () => noise(0.25, 0.25, 'lowpass', 700),
    clue: () => { noise(0.25, 0.2, 'highpass', 3000); tone('triangle', 520, 780, 0.3, 0.12); },
    vent: () => { noise(0.25, 0.3, 'bandpass', 400); tone('square', 140, 90, 0.15, 0.1); },
    creak: () => { tone('sawtooth', 180, 120, 0.5, 0.12); tone('sawtooth', 190, 130, 0.45, 0.08, 0.05); },
    snap: () => { noise(0.15, 0.6, 'highpass', 1500); tone('square', 600, 80, 0.2, 0.3); },
    struggle: () => { noise(0.1, 0.3, 'bandpass', 1200); tone('square', 300, 200, 0.08, 0.1); },
    shock: () => { noise(0.4, 0.4, 'highpass', 2000); tone('sawtooth', 900, 200, 0.4, 0.15); },
    alarm: () => { for (let i = 0; i < 5; i++) tone('square', 880, 620, 0.25, 0.15, i * 0.3); },
    sting: () => { tone('sawtooth', 1200, 300, 0.5, 0.25); tone('sawtooth', 1270, 320, 0.5, 0.2); noise(0.4, 0.3, 'bandpass', 2500); },
    screech: () => {
      [620, 700, 1050, 1400].forEach((f) => tone('sawtooth', f, f * 0.55, 1.3, 0.22));
      noise(1.3, 0.8, 'bandpass', 2400); tone('square', 110, 50, 1.3, 0.35);
    },
    whisper: () => { noise(1.4, 0.07, 'bandpass', 3200); noise(1.1, 0.05, 'bandpass', 1800, 0.3); },
    uv: () => { tone('sine', 2400, 600, 0.5, 0.25); noise(0.4, 0.3, 'highpass', 4000); },
    wail: () => { tone('sawtooth', 500, 900, 0.6, 0.2); tone('sawtooth', 900, 300, 0.8, 0.2, 0.6); },
    beat: (v) => { tone('sine', 62, 40, 0.13, v); tone('sine', 56, 38, 0.13, v * 0.8, 0.18); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => tone('triangle', f, f, 0.4, 0.2, i * 0.15)),
  };

  // ---- Geometry / pathing ----------------------------------------------------
  function castRay(ox, oy, dx, dy, maxDist) {
    let mx = tileOf(ox), my = tileOf(oy);
    const ddx = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const ddy = dy === 0 ? Infinity : Math.abs(TILE / dy);
    const sxStep = dx < 0 ? -1 : 1, syStep = dy < 0 ? -1 : 1;
    let sx = dx === 0 ? Infinity : (dx < 0 ? (ox - mx * TILE) / -dx : ((mx + 1) * TILE - ox) / dx);
    let sy = dy === 0 ? Infinity : (dy < 0 ? (oy - my * TILE) / -dy : ((my + 1) * TILE - oy) / dy);
    for (let i = 0; i < 200; i++) {
      let d;
      if (sx < sy) { d = sx; sx += ddx; mx += sxStep; } else { d = sy; sy += ddy; my += syStep; }
      if (d > maxDist) break;
      if (!walkable(mx, my)) return d;
    }
    return maxDist;
  }
  function lineOfSight(ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by);
    if (d < 1) return true;
    return castRay(ax, ay, (bx - ax) / d, (by - ay) / d, d) >= d - 1;
  }
  function buildField(tx, ty) {
    const f = new Int32Array(MAP_W * MAP_H).fill(-1);
    const q = [ty * MAP_W + tx];
    f[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % MAP_W, cy = (c / MAP_W) | 0;
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
  // Sound follows corridors: BFS distance in tiles, capped at maxD.
  function pathDist(ax, ay, bx, by, maxD) {
    const sx = tileOf(ax), sy = tileOf(ay), tx = tileOf(bx), ty = tileOf(by);
    if (sx === tx && sy === ty) return 0;
    const seen = new Int16Array(MAP_W * MAP_H).fill(-1);
    const q = [sy * MAP_W + sx];
    seen[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], d = seen[c];
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
  function roomAt(x, y) {
    const tx = tileOf(x), ty = tileOf(y);
    const r = level.rooms.find((r) => tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h);
    return r ? r.name : 'HALLWAY';
  }

  // ---- Floor art -------------------------------------------------------------
  function buildFloor() {
    floorCanvas = document.createElement('canvas');
    floorCanvas.width = MAP_W * TILE; floorCanvas.height = MAP_H * TILE;
    const f = floorCanvas.getContext('2d');
    let seed = 1337;
    const srand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const px = x * TILE, py = y * TILE;
        if (grid[y][x] === 0) {
          const shade = 40 + Math.floor(srand() * 8);
          f.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
          f.fillRect(px, py, TILE, TILE);
          f.strokeStyle = 'rgba(0,0,0,0.45)';
          f.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
          f.strokeStyle = 'rgba(255,255,255,0.04)';
          f.strokeRect(px + 1.5, py + 1.5, TILE - 3, TILE - 3);
          f.fillStyle = 'rgba(0,0,0,0.5)';
          for (const [rx, ry] of [[4, 4], [TILE - 5, 4], [4, TILE - 5], [TILE - 5, TILE - 5]]) f.fillRect(px + rx, py + ry, 2, 2);
          if (srand() < 0.12) {
            f.fillStyle = `rgba(0,0,0,${0.15 + srand() * 0.2})`;
            f.beginPath(); f.ellipse(px + srand() * TILE, py + srand() * TILE, 6 + srand() * 14, 4 + srand() * 8, srand() * 3, 0, TAU); f.fill();
          }
          if (srand() < 0.02) {
            f.fillStyle = 'rgba(90,10,10,0.55)';
            for (let i = 0; i < 6; i++) { f.beginPath(); f.arc(px + 16 + srand() * 20 - 10, py + 16 + srand() * 20 - 10, 2 + srand() * 5, 0, TAU); f.fill(); }
            f.strokeStyle = 'rgba(90,10,10,0.4)'; f.lineWidth = 3;
            f.beginPath(); f.moveTo(px + 16, py + 16); f.lineTo(px + 16 + srand() * 40 - 20, py + 16 + srand() * 40 - 20); f.stroke();
            f.lineWidth = 1;
          }
        } else if (DIR8.some(([ox, oy]) => walkable(x + ox, y + oy))) {
          f.fillStyle = '#14181f';
          f.fillRect(px, py, TILE, TILE);
          if (walkable(x, y + 1)) {
            f.fillStyle = '#262d38'; f.fillRect(px, py + TILE - 10, TILE, 10);
            f.fillStyle = '#3a4352'; f.fillRect(px, py + TILE - 10, TILE, 2);
            if (x % 3 === 0) { f.fillStyle = '#4a3a2a'; f.fillRect(px + 4, py + TILE - 22, 4, 12); }
          }
        }
      }
    }
    f.font = 'bold 20px sans-serif';
    f.textAlign = 'center';
    f.fillStyle = 'rgba(255,255,255,0.07)';
    for (const r of level.rooms) f.fillText(r.name, (r.x + r.w / 2) * TILE, (r.y + r.h / 2) * TILE + 8);
  }

  // ---- Setup -----------------------------------------------------------------
  function newGame() {
    level = buildShip();
    grid = level.grid;
    buildFloor();
    const [px, py] = level.playerStart;
    const code = String(Math.floor(1000 + Math.random() * 9000));
    const wb = level.workbench;
    game = {
      player: { x: center(px), y: center(py), vx: 0, vy: 0, aim: -Math.PI / 2, walk: 0, speedNow: 0,
                stamina: CFG.stamina.max, exhausted: false, crouch: false, running: false, stepTimer: 0,
                stunUntil: 0, hidden: null, stuck: null, mash: 0, hold: null },
      ghost: { x: center(level.ghostStart[0]), y: center(level.ghostStart[1]), state: 'wander', field: null,
               tx: -1, ty: -1, next: null, lastSeen: -99, until: 0, ventTarget: null },
      tasks: level.tasks.map((t) => ({ ...t, px: center(t.x), py: center(t.y), done: false })),
      bench: { name: 'Build UV Flash', room: 'CAFETERIA', type: 'craft', px: center(wb[0]), py: center(wb[1]), done: false, optional: true },
      parts: level.parts.map((p) => ({ ...p, px: center(p.x), py: center(p.y), taken: false })),
      traps: level.traps.map((t) => ({ ...t, px: center(t.x), py: center(t.y), armed: true, cool: 0,
                                         swx: t.sw ? center(t.sw[0]) : 0, swy: t.sw ? center(t.sw[1]) : 0 })),
      clues: level.clues.map((c) => ({ ...c, text: c.text.replace('{CODE}', code), px: center(c.x), py: center(c.y), read: false })),
      vents: level.vents.map(([x, y]) => ({ px: center(x), py: center(y) })),
      pod: { px: center(level.escapePod[0]), py: center(level.escapePod[1]) },
      code, codeKnown: false,
      lives: CFG.lives, done: 0, partsHeld: 0, bearTraps: 0, uv: 0, uvFlashAt: -9,
      revealUntil: 0, hiddenSeen: false, nextBeat: 0, lastChaseEnd: -99,
      flickerUntil: 0, nextFlicker: 20 + Math.random() * 20,
      msg: null, reading: null, task: null, scare: null, flash: null,
      startTime: now, endTime: 0, caughtAt: 0, noiseShown: 0,
      stats: { caught: 0, traps: 0, clues: 0, stuns: 0 },
    };
    mode = 'play';
    showMsg('Restore all 9 systems, then reach the ESCAPE POD. Something else is aboard...', 6);
  }

  function showMsg(text, dur = 3) { game.msg = { text, until: now + dur }; }
  function flashScare() { game.flash = { start: now }; Sfx.sting(); }

  // ---- Noise -----------------------------------------------------------------
  function emitNoise(x, y, r) {
    game.noiseShown = Math.max(game.noiseShown, r);
    const g = game.ghost;
    if (['chase', 'stunned', 'trapped', 'checkvent'].includes(g.state)) return;
    if (pathDist(x, y, g.x, g.y, r) > r) return;
    g.state = 'investigate';
    setTarget(g, x, y);
  }

  // ---- Ghost AI --------------------------------------------------------------
  function setTarget(g, x, y) {
    const tx = tileOf(x), ty = tileOf(y);
    if (!walkable(tx, ty) || (tx === g.tx && ty === g.ty && g.field)) return;
    g.tx = tx; g.ty = ty;
    g.field = buildField(tx, ty);
    g.next = null;
  }
  function wander(g) {
    g.state = 'wander';
    // Drift toward the player's half of the ship more often than not.
    const p = game.player;
    const rooms = level.rooms.slice().sort((a, b) =>
      dist(center(a.x), center(a.y), p.x, p.y) - dist(center(b.x), center(b.y), p.x, p.y));
    const r = Math.random() < 0.6 ? pick(rooms.slice(0, 4)) : pick(rooms);
    setTarget(g, center(r.x + Math.floor(rand(1, r.w - 1))), center(r.y + Math.floor(rand(1, r.h - 1))));
  }
  function startSearch(g) {
    const p = game.player;
    g.state = 'search';
    g.until = now + CFG.ghost.searchSec;
    // She checks a nearby vent if she saw you go in, or on a hunch.
    if (p.hidden && dist(g.x, g.y, p.hidden.px, p.hidden.py) < 5 * TILE && (game.hiddenSeen || Math.random() < 0.45)) {
      g.state = 'checkvent';
      g.ventTarget = p.hidden;
      setTarget(g, p.hidden.px, p.hidden.py);
    }
  }

  function updateGhost(dt) {
    const g = game.ghost, p = game.player;
    const d = dist(g.x, g.y, p.x, p.y);
    if (g.state === 'stunned' || g.state === 'trapped') {
      if (now > g.until) { startSearch(g); showMsg('She is moving again...', 2); Sfx.wail(); }
      return;
    }
    const sight = p.crouch ? CFG.ghost.crouchSight : CFG.ghost.sight;
    const sees = !p.hidden && d < sight && lineOfSight(g.x, g.y, p.x, p.y);
    if (sees) {
      if (g.state !== 'chase') {
        if (now - game.lastChaseEnd > 15) flashScare(); else Sfx.sting();
        showMsg('SHE SEES YOU! RUN! Break her line of sight!', 2);
      }
      g.state = 'chase';
      g.lastSeen = now;
      setTarget(g, p.x, p.y);
    } else if (g.state === 'chase' && now - g.lastSeen > CFG.ghost.loseSec) {
      game.lastChaseEnd = now;
      startSearch(g);
    }
    if (g.state === 'search' && now > g.until) wander(g);
    if (!g.field) wander(g);

    // Player-set bear traps
    for (const t of game.traps) {
      if (t.type === 'bear' && t.owner === 'player' && t.armed && dist(t.px, t.py, g.x, g.y) < 18) {
        t.armed = false; t.gone = true;
        g.state = 'trapped'; g.until = now + CFG.ghost.trappedSec;
        Sfx.snap(); Sfx.wail();
        showMsg(`Your trap caught her! She is stuck for ${CFG.ghost.trappedSec}s.`, 3);
        return;
      }
    }

    const spd = CFG.ghost[g.state] * (1 + CFG.ghost.perTask * game.done);
    const cx = tileOf(g.x), cy = tileOf(g.y);
    if (!g.next || dist(g.x, g.y, center(g.next.x), center(g.next.y)) < 2) {
      const here = g.field[cy * MAP_W + cx];
      let best = null, bv = here === -1 ? Infinity : here;
      if (here !== 0) {
        for (const [ox, oy] of DIR8) {
          const nx = cx + ox, ny = cy + oy;
          if (!walkable(nx, ny)) continue;
          if (ox && oy && (!walkable(cx + ox, cy) || !walkable(cx, cy + oy))) continue;
          const v = g.field[ny * MAP_W + nx];
          if (v >= 0 && v < bv) { bv = v; best = { x: nx, y: ny }; }
        }
      }
      g.next = best;
      if (!best) {
        if (dist(g.x, g.y, center(cx), center(cy)) > 2) g.next = { x: cx, y: cy };
        else if (g.state === 'wander') wander(g);
        else if (g.state === 'investigate') startSearch(g);
        else if (g.state === 'checkvent') {
          if (p.hidden && p.hidden === g.ventTarget) { catchPlayer(); return; }
          g.state = 'search'; g.until = now + CFG.ghost.searchSec;
        } else if (g.state === 'search') {
          const nx = cx + Math.round(rand(-3, 3)), ny = cy + Math.round(rand(-3, 3));
          if (walkable(nx, ny)) setTarget(g, center(nx), center(ny));
        }
      }
    }
    if (g.next) {
      const tx = center(g.next.x), ty = center(g.next.y);
      const dx = tx - g.x, dy = ty - g.y, l = Math.hypot(dx, dy);
      if (l > 0.01) { const s = Math.min(l, spd * dt); g.x += (dx / l) * s; g.y += (dy / l) * s; }
    }

    if ((!p.hidden && d < 22) || (p.hidden && game.hiddenSeen && d < 22)) catchPlayer();
  }

  function catchPlayer() {
    game.task = null;
    game.reading = null;
    game.scare = { start: now, dur: 1.4 };
    mode = 'scare';
    Sfx.screech();
  }

  function finishCatch() {
    game.lives--;
    game.stats.caught++;
    game.caughtAt = now;
    game.player.hidden = null;
    game.player.stuck = null;
    mode = game.lives <= 0 ? 'over' : 'caught';
    if (mode === 'over') game.endTime = now;
  }

  function respawn() {
    const p = game.player, [px, py] = level.playerStart;
    Object.assign(p, { x: center(px), y: center(py), vx: 0, vy: 0, stunUntil: 0, hidden: null, stuck: null, hold: null, stamina: CFG.stamina.max });
    const g = game.ghost;
    const far = level.rooms.reduce((a, b) =>
      dist(center(a.x), center(a.y), p.x, p.y) > dist(center(b.x), center(b.y), p.x, p.y) ? a : b);
    g.x = center(far.x + 2); g.y = center(far.y + 2);
    g.field = null; g.state = 'wander';
    mode = 'play';
    showMsg(`Last chance${game.lives > 1 ? 's' : ''}: ${game.lives}. Your progress is saved.`, 3);
  }

  // ---- Player ----------------------------------------------------------------
  function blocked(x, y, r) {
    return !walkable(tileOf(x - r), tileOf(y - r)) || !walkable(tileOf(x + r), tileOf(y - r)) ||
           !walkable(tileOf(x - r), tileOf(y + r)) || !walkable(tileOf(x + r), tileOf(y + r));
  }
  function nearest(list, p, range, kx = 'px', ky = 'py') {
    let best = null, bd = range;
    for (const o of list) { const d = dist(o[kx], o[ky], p.x, p.y); if (d < bd) { bd = d; best = o; } }
    return best;
  }
  const openTasks = () => game.tasks.filter((t) => !t.done).concat(game.bench.done ? [] : [game.bench]);

  function updatePlayer(dt) {
    const p = game.player;
    p.aim = Math.atan2(mouse.y + cam.y - p.y, mouse.x + cam.x - p.x);
    const busy = game.task || game.reading || p.hidden || p.stuck;
    const stunned = now < p.stunUntil;
    let mx = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    let my = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0);
    if (busy || stunned) { mx = 0; my = 0; }
    const moving = !!(mx || my);
    p.crouch = !!keys.KeyC && !busy;
    p.running = moving && !p.crouch && !p.exhausted && !!(keys.ShiftLeft || keys.ShiftRight);

    // Stamina
    if (p.running) {
      p.stamina -= CFG.stamina.drain * dt;
      if (p.stamina <= 0) { p.stamina = 0; p.exhausted = true; showMsg('Out of breath!', 1.5); }
    } else {
      p.stamina = Math.min(CFG.stamina.max, p.stamina + CFG.stamina.regen * dt);
      if (p.exhausted && p.stamina >= CFG.stamina.recover) p.exhausted = false;
    }

    // Smooth acceleration with wall sliding
    const speed = p.crouch ? CFG.crouch : p.running ? CFG.run : CFG.walk;
    const l = Math.hypot(mx, my) || 1;
    const k = Math.min(1, CFG.accel * dt);
    p.vx += ((mx / l) * speed - p.vx) * k;
    p.vy += ((my / l) * speed - p.vy) * k;
    if (busy) { p.vx = 0; p.vy = 0; }
    const nx = p.x + p.vx * dt;
    if (!blocked(nx, p.y, CFG.radius)) p.x = nx; else p.vx = 0;
    const ny = p.y + p.vy * dt;
    if (!blocked(p.x, ny, CFG.radius)) p.y = ny; else p.vy = 0;
    p.speedNow = Math.hypot(p.vx, p.vy);
    p.walk += p.speedNow * dt * 0.09;

    if (p.speedNow > 30) {
      p.stepTimer -= dt;
      if (p.stepTimer <= 0) {
        p.stepTimer = p.running ? 0.28 : p.crouch ? 0.6 : 0.45;
        if (!p.crouch) { Sfx.step(p.running); emitNoise(p.x, p.y, p.running ? CFG.noise.run : CFG.noise.walk); }
      }
    }

    if (!p.hidden && !p.stuck) updateTraps();

    // Hold-E actions (disarm bear trap, cut tripwire)
    if (p.hold) {
      const t = p.hold.target;
      if (!keys.KeyE || dist(t.px, t.py, p.x, p.y) > 46 || !t.armed) p.hold = null;
      else if ((p.hold.t += dt) >= p.hold.need) {
        if (t.type === 'bear') { t.armed = false; t.gone = true; game.bearTraps++; showMsg(`Bear trap disarmed and taken (${game.bearTraps}). Press G to set it for her.`, 3); }
        else { t.armed = false; t.cut = true; showMsg('Tripwire cut.', 2); }
        Sfx.click();
        p.hold = null;
      }
    }

    if (game.done === game.tasks.length && dist(game.pod.px, game.pod.py, p.x, p.y) < 30) {
      mode = 'win';
      game.endTime = now;
      Sfx.win();
    }
  }

  function updateTraps() {
    const p = game.player;
    for (const t of game.traps) {
      if (!t.armed || t.gone) continue;
      const d = dist(t.px, t.py, p.x, p.y);
      if (t.type === 'bear' && t.owner !== 'player' && d < 15) {
        t.armed = false;
        p.stuck = t; p.mash = 0; p.vx = 0; p.vy = 0;
        game.stats.traps++;
        Sfx.snap();
        emitNoise(p.x, p.y, CFG.noise.snap);
        showMsg('BEAR TRAP! Mash SPACE to pry it open. She can hear it...', 3);
      } else if (t.type === 'tripwire' && d < 16 && !p.crouch) {
        t.armed = false; t.cut = true;
        game.stats.traps++;
        Sfx.alarm();
        const g = game.ghost;
        if (!['chase', 'stunned', 'trapped'].includes(g.state)) { g.state = 'investigate'; setTarget(g, t.px, t.py); }
        showMsg('ALARM! She knows where you are. HIDE!', 3);
      } else if (t.type === 'shock' && d < 20 && now > t.cool) {
        t.cool = now + 3;
        p.stunUntil = now + CFG.stunSec;
        game.stats.traps++;
        Sfx.shock();
        emitNoise(p.x, p.y, CFG.noise.shock);
        showMsg('ZAP! Find the fuse switch to kill this floor.', 2.5);
      } else if (t.type === 'creak' && d < 18 && !p.crouch && p.speedNow > 30 && now > t.cool) {
        t.cool = now + 1.2;
        Sfx.creak();
        emitNoise(p.x, p.y, CFG.noise.creak);
        showMsg('*CREAK* Crouch (C) over loose floor panels.', 2);
      }
    }
  }

  function interact() {
    const p = game.player;
    if (game.task) return;
    if (game.reading) { game.reading = null; return; }
    if (p.stuck) { struggle(); return; }
    if (p.hidden) { p.hidden = null; Sfx.vent(); return; }
    const task = nearest(openTasks(), p, 38);
    if (task) {
      if (task.type === 'craft' && game.partsHeld < 3) {
        Sfx.buzz();
        showMsg(`UV Flash needs 3 parts (${game.partsHeld}/3). Battery: Electrical · Bulb: MedBay · Wire: Engine`, 4);
      } else openTask(task);
      return;
    }
    const part = nearest(game.parts.filter((x) => !x.taken), p, 34);
    if (part) {
      part.taken = true; game.partsHeld++;
      Sfx.task();
      showMsg(`Picked up ${PART_NAMES[part.kind]} (${game.partsHeld}/3).${game.partsHeld === 3 ? ' Build the UV Flash at the Cafeteria workbench!' : ''}`, 3);
      return;
    }
    const sw = nearest(game.traps.filter((t) => t.type === 'shock' && t.armed), p, 30, 'swx', 'swy');
    if (sw) { sw.armed = false; Sfx.click(); Sfx.shock(); showMsg('Fuse pulled. That shock floor is dead.', 2.5); return; }
    const clue = nearest(game.clues.filter((c) => !c.read), p, 34);
    if (clue) {
      clue.read = true;
      game.stats.clues++;
      game.reading = clue.text;
      if (clue.text.includes(game.code)) game.codeKnown = true;
      game.revealUntil = now + 8;
      Sfx.clue();
      return;
    }
    const vent = nearest(game.vents, p, 34);
    if (vent) {
      const g = game.ghost;
      game.hiddenSeen = g.state === 'chase' && dist(g.x, g.y, p.x, p.y) < 5 * TILE && lineOfSight(g.x, g.y, p.x, p.y);
      p.hidden = vent; p.x = vent.px; p.y = vent.py; p.vx = 0; p.vy = 0;
      Sfx.vent();
      if (!game.hiddenSeen && Math.random() < 0.12) { flashScare(); showMsg('...something was in here. It\'s gone now.', 2.5); }
      else showMsg(game.hiddenSeen ? 'She saw you crawl in...' : 'Hiding in the vent. Q = crawl to next vent · E = climb out', 3);
      return;
    }
    const trap = nearest(game.traps.filter((t) => t.armed && !t.gone && (t.type === 'bear' && t.owner !== 'player' || t.type === 'tripwire')), p, 46);
    if (trap) {
      if (!p.crouch && !keys.KeyC) { showMsg('Crouch (hold C) and hold E to disarm.', 2); return; }
      p.hold = { target: trap, t: 0, need: trap.type === 'bear' ? CFG.bearDisarmSec : CFG.wireCutSec };
    }
  }

  function struggle() {
    const p = game.player;
    p.mash++;
    Sfx.struggle();
    emitNoise(p.x, p.y, CFG.noise.struggle);
    if (p.mash >= CFG.mash) { p.stuck.gone = true; p.stuck = null; showMsg('You pried the trap open!', 2); }
  }

  function ventCrawl() {
    const p = game.player;
    if (!p.hidden) return;
    const i = game.vents.indexOf(p.hidden);
    const v = game.vents[(i + 1) % game.vents.length];
    p.hidden = v; p.x = v.px; p.y = v.py;
    game.hiddenSeen = false;
    Sfx.vent();
    showMsg(`Crawled to ${roomAt(v.px, v.py)}`, 1.5);
  }

  function placeTrap() {
    const p = game.player;
    if (p.hidden || p.stuck || game.task) return;
    if (game.bearTraps <= 0) { showMsg('No bear traps. Crouch + hold E on one to take it.', 2); return; }
    game.bearTraps--;
    game.traps.push({ type: 'bear', owner: 'player', px: p.x, py: p.y, armed: true, cool: 0 });
    Sfx.click();
    showMsg('Trap set. Lure her over it.', 2);
  }

  function fireUV() {
    const p = game.player, g = game.ghost;
    if (p.hidden || game.task) return;
    if (!game.bench.done) { showMsg('You have no weapon. Find 3 parts and build the UV Flash.', 2.5); return; }
    if (game.uv <= 0) { Sfx.buzz(); showMsg('UV Flash is out of charge.', 2); return; }
    game.uv--;
    game.uvFlashAt = now;
    Sfx.uv();
    const d = dist(g.x, g.y, p.x, p.y);
    if (d < CFG.uv.range && angDiff(Math.atan2(g.y - p.y, g.x - p.x), p.aim) < CFG.uv.half && lineOfSight(p.x, p.y, g.x, g.y)) {
      g.state = 'stunned'; g.until = now + CFG.ghost.stunSec;
      game.stats.stuns++;
      game.lastChaseEnd = now;
      Sfx.wail();
      showMsg(`DIRECT HIT! She is stunned for ${CFG.ghost.stunSec} seconds. MOVE!`, 3);
    } else showMsg(`Missed! ${game.uv} charge${game.uv === 1 ? '' : 's'} left.`, 2);
  }

  // ---- Mini-games ------------------------------------------------------------
  // Each task is a small hands-on puzzle in a panel; the ghost keeps moving meanwhile.
  const PW = 520, PH = 380;
  const panel = () => ({ x: Math.round(W / 2 - PW / 2), y: Math.round(H / 2 - PH / 2) });
  const local = () => { const o = panel(); return { x: mouse.x - o.x, y: mouse.y - o.y }; };

  function openTask(t) {
    game.task = { def: t, st: MINI[t.type].init() };
    Sfx.click();
  }
  function completeTask() {
    const t = game.task.def;
    t.done = true;
    game.task = null;
    Sfx.task();
    if (t.type === 'craft') {
      game.uv = CFG.uv.charges;
      showMsg(`UV FLASH BUILT! Aim with the mouse and press F to stun her for ${CFG.ghost.stunSec}s (${CFG.uv.charges} charges).`, 5);
      return;
    }
    game.done++;
    showMsg(game.done === game.tasks.length
      ? 'ALL SYSTEMS RESTORED! The ESCAPE POD in the Cafeteria is unlocked. RUN!'
      : `${t.name} complete (${game.done}/${game.tasks.length}). She's getting restless...`, 4);
  }
  function failTask(msg) {
    Sfx.buzz();
    emitNoise(game.task.def.px, game.task.def.py, CFG.noise.taskFail);
    showMsg(msg + ' The buzzer echoed through the ship...', 2.5);
  }

  const btn = (x, y, w, h, m) => m.x >= x && m.x <= x + w && m.y >= y && m.y <= y + h;

  const MINI = {
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
            if (s.right[k] === s.drag) { s.conn[s.drag] = k; Sfx.click(); } else { Sfx.shock(); game.player.stunUntil = now + 0.5; }
          }
        }
        s.drag = -1;
        if (s.conn.every((c) => c >= 0)) completeTask();
      },
      draw(s, m) {
        text('Drag each wire to the matching colour. Wrong ones shock you.', PW / 2, 60, 13);
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
        text(s.phase === 'show' ? 'Watch the reactor sequence...' : `Repeat it! (${s.input}/${s.round})`, PW / 2, 60, 14);
        for (let i = 0; i < 9; i++) {
          const c = this.cell(i);
          const lit = s.lit === i && (s.phase === 'show' || now < s.litUntil);
          ctx.fillStyle = lit ? '#5dd6ff' : '#1d2a3a'; ctx.fillRect(c.x, c.y, 68, 68);
          ctx.strokeStyle = '#4a6a8a'; ctx.lineWidth = 2; ctx.strokeRect(c.x, c.y, 68, 68);
        }
        text(`Stage ${Math.min(s.round, s.seq.length)}/${s.seq.length}`, PW / 2, 345, 13);
      },
    },
    keypad: {
      init: () => ({ entry: '' }),
      labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK'],
      key: (i) => ({ x: 165 + (i % 3) * 66, y: 125 + Math.floor(i / 3) * 56 }),
      down(s, m) {
        this.labels.forEach((lab, i) => {
          const k = this.key(i);
          if (!btn(k.x, k.y, 58, 48, m)) return;
          Sfx.click();
          if (lab === 'C') s.entry = '';
          else if (lab === 'OK') { if (s.entry === game.code) completeTask(); else { s.entry = ''; failTask('ACCESS DENIED.'); } }
          else if (s.entry.length < 4) s.entry += lab;
        });
      },
      draw(s) {
        text(game.codeKnown ? 'Enter the code from the sticky note.' : 'Code unknown. Someone left a sticky note in MedBay...', PW / 2, 60, 13);
        ctx.fillStyle = '#0a1a0a'; ctx.fillRect(165, 72, 190, 42);
        ctx.fillStyle = '#5dff6a'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
        ctx.fillText(s.entry.padEnd(4, '_').split('').join(' '), 260, 103);
        this.labels.forEach((lab, i) => {
          const k = this.key(i);
          ctx.fillStyle = '#2a3342'; ctx.fillRect(k.x, k.y, 58, 48);
          ctx.strokeStyle = '#5a6a80'; ctx.strokeRect(k.x, k.y, 58, 48);
          text(lab, k.x + 29, k.y + 31, 18, '#fff');
        });
      },
    },
    waypoints: {
      init() {
        const pts = [];
        while (pts.length < 6) {
          const p = { x: rand(50, 470), y: rand(80, 340) };
          if (pts.every((q) => dist(p.x, p.y, q.x, q.y) > 80)) pts.push(p);
        }
        return { pts, next: 0 };
      },
      down(s, m) {
        const i = s.pts.findIndex((p) => dist(p.x, p.y, m.x, m.y) < 20);
        if (i < 0) return;
        if (i === s.next) { Sfx.click(); if (++s.next === s.pts.length) completeTask(); }
        else { s.next = 0; failTask('Course corrupted!'); }
      },
      draw(s) {
        ctx.strokeStyle = 'rgba(80,140,200,0.2)'; ctx.lineWidth = 1;
        for (let x = 20; x < PW; x += 40) line(x, 70, x, PH - 20, 'rgba(80,140,200,0.2)', 1);
        for (let y = 70; y < PH - 20; y += 40) line(20, y, PW - 20, y, 'rgba(80,140,200,0.2)', 1);
        text('Click the navigation beacons in order: 1 → 6', PW / 2, 55, 13);
        for (let i = 1; i < s.next; i++) line(s.pts[i - 1].x, s.pts[i - 1].y, s.pts[i].x, s.pts[i].y, '#ffd84a', 3);
        s.pts.forEach((p, i) => {
          ctx.fillStyle = i < s.next ? '#ffd84a' : '#1d3a5a';
          ctx.beginPath(); ctx.arc(p.x, p.y, 16, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#7ab8ff'; ctx.lineWidth = 2; ctx.stroke();
          text(String(i + 1), p.x, p.y + 5, 14, i < s.next ? '#000' : '#fff');
        });
      },
    },
    asteroids: {
      init: () => ({ rocks: [], hit: 0, spawn: 0, need: 10 }),
      update(s, dt) {
        if ((s.spawn -= dt) <= 0) {
          s.spawn = 0.55;
          const r = rand(12, 22);
          s.rocks.push({ x: PW + r, y: rand(80, PH - 30), vx: -rand(110, 190), vy: rand(-30, 30), r, a: rand(0, 6) });
        }
        for (const r of s.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.a += dt; }
        s.rocks = s.rocks.filter((r) => r.x > -30);
      },
      down(s, m) {
        const i = s.rocks.findIndex((r) => dist(r.x, r.y, m.x, m.y) < r.r + 4);
        if (i < 0) return;
        s.rocks.splice(i, 1);
        Sfx.boom();
        if (++s.hit >= s.need) completeTask();
      },
      draw(s, m) {
        text(`Shoot the asteroids! ${s.hit}/${s.need}`, PW / 2, 55, 14);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 64, PW, PH - 64); ctx.clip();
        for (const r of s.rocks) {
          ctx.fillStyle = '#7a6a5a'; ctx.strokeStyle = '#3a3028'; ctx.lineWidth = 2;
          ctx.beginPath();
          for (let k = 0; k < 8; k++) { const a = r.a + (k / 8) * TAU, rr = r.r * (k % 2 ? 0.8 : 1); ctx.lineTo(r.x + Math.cos(a) * rr, r.y + Math.sin(a) * rr); }
          ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = '#5dff6a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(m.x, m.y, 12, 0, TAU); ctx.moveTo(m.x - 18, m.y); ctx.lineTo(m.x + 18, m.y); ctx.moveTo(m.x, m.y - 18); ctx.lineTo(m.x, m.y + 18); ctx.stroke();
      },
    },
    fuel: {
      init: () => ({ level: 0, holding: false, lo: 0.72, hi: 0.84 }),
      update(s, dt) {
        if (!s.holding) return;
        s.level += 0.38 * dt;
        if (s.level >= 1) { s.level = 0; s.holding = false; failTask('Fuel overflow!'); }
      },
      down(s, m) { if (btn(200, 300, 120, 44, m)) s.holding = true; },
      up(s) {
        if (!s.holding) return;
        s.holding = false;
        if (s.level >= s.lo && s.level <= s.hi) completeTask();
        else if (s.level > s.hi) { s.level = 0; failTask('Too much fuel!'); }
      },
      draw(s) {
        text('Hold the button and release inside the green band.', PW / 2, 55, 13);
        ctx.fillStyle = '#111'; ctx.fillRect(215, 75, 90, 210);
        ctx.fillStyle = 'rgba(93,255,106,0.3)'; ctx.fillRect(215, 75 + 210 * (1 - s.hi), 90, 210 * (s.hi - s.lo));
        ctx.fillStyle = '#d9a52b'; ctx.fillRect(219, 75 + 210 * (1 - s.level), 82, 210 * s.level);
        ctx.strokeStyle = '#888'; ctx.lineWidth = 3; ctx.strokeRect(215, 75, 90, 210);
        ctx.fillStyle = s.holding ? '#a33' : '#c44'; ctx.fillRect(200, 300, 120, 44);
        text(s.holding ? 'FILLING...' : 'HOLD', 260, 328, 15, '#fff');
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
    slider: {
      init: () => ({ val: 0.1, drag: false, hold: 0, tt: 0, ph: rand(0, 6), target: 0.5 }),
      Y: (v) => 70 + (1 - v) * 260,
      update(s, dt) {
        s.tt += dt;
        s.target = 0.5 + 0.32 * Math.sin(s.tt * 0.8 + s.ph) * Math.cos(s.tt * 0.37);
        if (Math.abs(s.val - s.target) < 0.04) s.hold += dt; else s.hold = Math.max(0, s.hold - dt * 1.5);
        if (s.hold >= 2) completeTask();
      },
      down(s, m) { if (Math.abs(m.x - 260) < 50 && Math.abs(m.y - this.Y(s.val)) < 24) s.drag = true; },
      move(s, m) { if (s.drag) s.val = clamp(1 - (m.y - 70) / 260, 0, 1); },
      up(s) { s.drag = false; },
      draw(s) {
        text('Drag the output lever and keep it on the moving yellow line.', PW / 2, 55, 13);
        ctx.fillStyle = '#111'; ctx.fillRect(250, 70, 20, 260);
        line(170, this.Y(s.target), 350, this.Y(s.target), '#ffd84a', 3);
        ctx.fillStyle = '#aab'; ctx.fillRect(220, this.Y(s.val) - 10, 80, 20);
        ctx.fillStyle = '#111'; ctx.fillRect(390, 70, 20, 260);
        ctx.fillStyle = '#5dff6a'; ctx.fillRect(390, 70 + 260 * (1 - s.hold / 2), 20, 260 * (s.hold / 2));
        text('SYNC', 400, 350, 11);
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
      adj: (i) => (i === 0 ? [1, 2, 3, 4, 5, 6] : [0, ((i - 1 + 1) % 6) + 1, ((i - 1 + 5) % 6) + 1]),
      toggle(s, i) { s.on[i] = !s.on[i]; for (const j of this.adj(i)) s.on[j] = !s.on[j]; },
      down(s, m) {
        for (let i = 0; i < 7; i++) {
          const p = this.pos(i);
          if (dist(p.x, p.y, m.x, m.y) < 38) { this.toggle(s, i); Sfx.click(); if (s.on.every((v) => v)) completeTask(); return; }
        }
      },
      draw(s) {
        text('Turn every shield cell white. A click flips a cell AND its neighbours.', PW / 2, 55, 13);
        for (let i = 0; i < 7; i++) {
          const p = this.pos(i);
          ctx.beginPath();
          for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + Math.PI / 6; ctx.lineTo(p.x + Math.cos(a) * 42, p.y + Math.sin(a) * 42); }
          ctx.closePath();
          ctx.fillStyle = s.on[i] ? '#e8f4ff' : '#b8302a'; ctx.fill();
          ctx.strokeStyle = '#223'; ctx.lineWidth = 3; ctx.stroke();
        }
      },
    },
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
        if (dist(slot.x, slot.y, it.x, it.y) < 34) { it.placed = true; it.x = slot.x; it.y = slot.y; Sfx.click(); }
        else { it.x = it.hx; it.y = it.hy; }
        s.drag = null;
        if (s.items.every((i) => i.placed)) completeTask();
      },
      draw(s) {
        text('Assemble the UV Flash: drag each part onto its outline.', PW / 2, 55, 13);
        ctx.strokeStyle = 'rgba(120,180,255,0.5)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(110, 100, 300, 110);
        for (const sl of s.slots) { ctx.beginPath(); ctx.arc(sl.x, sl.y, 26, 0, TAU); ctx.stroke(); }
        ctx.setLineDash([]);
        for (const sl of s.slots) text(PART_NAMES[sl.kind], sl.x, sl.y + 44, 11, 'rgba(180,210,255,0.7)');
        for (const it of s.items) drawPart(it.kind, it.x, it.y, 1.6);
      },
    },
  };

  function text(str, x, y, size = 14, col = '#d8e4f0') {
    ctx.font = `${size >= 16 ? 'bold ' : ''}${size}px sans-serif`;
    ctx.fillStyle = col; ctx.textAlign = 'center';
    ctx.fillText(str, x, y);
  }
  function line(x1, y1, x2, y2, col, w) {
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }

  function drawTaskPanel() {
    const t = game.task, o = panel(), m = local();
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.fillStyle = '#121822'; ctx.fillRect(0, 0, PW, PH);
    ctx.strokeStyle = '#5a7090'; ctx.lineWidth = 3; ctx.strokeRect(0, 0, PW, PH);
    ctx.fillStyle = '#1e2836'; ctx.fillRect(0, 0, PW, 34);
    text(t.def.name.toUpperCase(), PW / 2, 23, 16, '#ffd84a');
    text('ESC to step away', PW - 60, 23, 11, 'rgba(255,255,255,0.5)');
    MINI[t.def.type].draw(t.st, m);
    ctx.restore();
    // Danger tell while you're heads-down in a task
    const g = game.ghost;
    const d = dist(g.x, g.y, game.player.x, game.player.y) / TILE;
    if (d < 8 && Math.sin(now * 12) > 0) text('⚠ Something is close...', W / 2, o.y + PH + 30, 18, '#ff5a5a');
  }

  // ---- Drawing ---------------------------------------------------------------
  function drawPart(kind, x, y, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
    ctx.shadowColor = '#fff'; ctx.shadowBlur = 8;
    if (kind === 'battery') {
      ctx.fillStyle = '#3aa655'; ctx.fillRect(-7, -11, 14, 22);
      ctx.fillStyle = '#ccc'; ctx.fillRect(-3, -14, 6, 3);
      ctx.fillStyle = '#fff'; ctx.fillRect(-1, -6, 2, 8); ctx.fillRect(-4, -3, 8, 2);
    } else if (kind === 'bulb') {
      ctx.fillStyle = '#b07aff'; ctx.beginPath(); ctx.arc(0, -3, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = '#999'; ctx.fillRect(-4, 4, 8, 7);
    } else {
      ctx.strokeStyle = '#e08a3a'; ctx.lineWidth = 2.5; ctx.beginPath();
      for (let a = 0; a < 14; a += 0.3) ctx.lineTo(Math.cos(a) * (3 + a * 0.5), Math.sin(a) * (3 + a * 0.5));
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlayer() {
    const p = game.player;
    if (p.hidden) return;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(2, 3, 14, 11, 0, 0, TAU); ctx.fill();
    ctx.rotate(p.aim);
    if (p.crouch) ctx.scale(0.86, 0.86);
    const sw = Math.sin(p.walk) * Math.min(1, p.speedNow / 80) * 7;
    const stunned = now < p.stunUntil;
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath(); ctx.ellipse(sw, -6, 6, 3.5, 0, 0, TAU); ctx.ellipse(-sw, 6, 6, 3.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#6c7888'; ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(-15, -7, 8, 14, 3); ctx.fill(); ctx.stroke(); // oxygen pack
    ctx.fillStyle = stunned ? '#7fb8ff' : '#c8742a';
    ctx.beginPath(); ctx.roundRect(-8, -13, 15, 26, 7); ctx.fill(); ctx.stroke(); // torso
    ctx.beginPath(); ctx.roundRect(2, 5, 14, 6, 3); ctx.fill(); ctx.stroke(); // arm holding light
    ctx.beginPath(); ctx.roundRect(-3 - sw * 0.4, -15, 11, 5, 2.5); ctx.fill(); ctx.stroke(); // swinging arm
    ctx.fillStyle = '#bbb'; ctx.fillRect(15, 5.5, 8, 5);
    ctx.fillStyle = '#ddd'; ctx.beginPath(); ctx.arc(0, 0, 8, 0, TAU); ctx.fill(); ctx.stroke(); // helmet
    ctx.fillStyle = '#3d8fb0'; ctx.beginPath(); ctx.arc(1.5, 0, 6, -1.1, 1.1); ctx.closePath(); ctx.fill();
    ctx.restore();
    if (p.stuck) {
      ctx.strokeStyle = '#999'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y + 10, 12, 0, TAU); ctx.stroke();
    }
  }

  function drawMatron(x, y, alpha, opts = {}) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y + Math.sin(now * 2) * 3 - 18);
    const sc = opts.scale || 1;
    ctx.scale(sc, sc);
    ctx.shadowColor = opts.tint || '#cfe0ff'; ctx.shadowBlur = 18;
    const gg = ctx.createLinearGradient(0, -14, 0, 34);
    gg.addColorStop(0, 'rgba(225,228,232,0.95)'); gg.addColorStop(1, 'rgba(140,150,160,0.05)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.moveTo(-9, -12);
    ctx.quadraticCurveTo(-20, 10, -17, 34);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-17 + i * 5.7, 34 + (i % 2 ? -6 : 0) + Math.sin(now * 6 + i) * 2);
    ctx.quadraticCurveTo(20, 10, 9, -12);
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    // reaching arms
    const reach = Math.sin(now * 3) * 3;
    line(-9, -8, -19, 8 + reach, 'rgba(210,205,195,0.9)', 3);
    line(9, -8, 19, 8 - reach, 'rgba(210,205,195,0.9)', 3);
    ctx.fillStyle = '#cfcabd';
    ctx.beginPath(); ctx.ellipse(0, -20, 8, 10, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#080808'; ctx.lineWidth = 1.8;
    for (let i = -4; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 2.2, -30);
      ctx.quadraticCurveTo(i * 3.2, -16, i * 3.8 + Math.sin(now * 2 + i) * 1.5, i % 2 ? 4 : -2);
      ctx.stroke();
    }
    ctx.fillStyle = opts.tint || '#fff';
    ctx.shadowColor = opts.tint || '#fff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(-3.2, -20, 1.7, 0, TAU); ctx.arc(3.2, -20, 1.7, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(0, -14, 2.2, 3 + Math.sin(now * 4), 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawScareFace(scale, shake, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(W / 2 + rand(-shake, shake), H / 2 + rand(-shake, shake));
    const s = scale * Math.min(W, H) / 520;
    ctx.scale(s, s);
    ctx.fillStyle = '#040404';
    ctx.beginPath(); ctx.ellipse(0, -10, 210, 270, 0, 0, TAU); ctx.fill();
    const g = ctx.createRadialGradient(0, -20, 20, 0, 0, 190);
    g.addColorStop(0, '#ebe6da'); g.addColorStop(0.7, '#a39e8e'); g.addColorStop(1, '#4e4a40');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.ellipse(0, 10, 125, 170, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(60,40,40,0.5)'; ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      ctx.beginPath(); ctx.moveTo(-90 + i * 22, -110 + (i % 3) * 20);
      ctx.lineTo(-80 + i * 22 + Math.sin(i) * 20, -40 + (i % 2) * 30); ctx.stroke();
    }
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(-48, -30, 36, 46, -0.15, 0, TAU); ctx.ellipse(48, -30, 36, 46, 0.15, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#fff'; ctx.shadowBlur = 25;
    ctx.beginPath(); ctx.arc(-46, -24, 7, 0, TAU); ctx.arc(46, -24, 7, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(0, 95, 50, 75 + Math.sin(now * 40) * 6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#d8d0b8';
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath(); ctx.moveTo(i * 13 - 5, 30); ctx.lineTo(i * 13 + 5, 30); ctx.lineTo(i * 13, 50); ctx.fill();
      ctx.beginPath(); ctx.moveTo(i * 13 - 5, 162); ctx.lineTo(i * 13 + 5, 162); ctx.lineTo(i * 13, 142); ctx.fill();
    }
    ctx.strokeStyle = '#050505'; ctx.lineWidth = 4;
    for (let i = -6; i <= 6; i++) {
      ctx.beginPath(); ctx.moveTo(i * 18, -175);
      ctx.quadraticCurveTo(i * 24, -60, i * 26 + Math.sin(now * 20 + i) * 6, 60 + Math.abs(i) * 12);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawObjects() {
    for (const v of game.vents) {
      ctx.fillStyle = '#1a1e26'; ctx.strokeStyle = '#6a7384'; ctx.lineWidth = 2;
      ctx.fillRect(v.px - 13, v.py - 9, 26, 18); ctx.strokeRect(v.px - 13, v.py - 9, 26, 18);
      ctx.beginPath();
      for (let i = -8; i <= 8; i += 4) { ctx.moveTo(v.px + i, v.py - 7); ctx.lineTo(v.px + i, v.py + 7); }
      ctx.stroke();
    }
    for (const t of game.traps) {
      if (t.gone && !(t.type === 'bear' && t.owner !== 'player')) continue;
      if (t.type === 'bear') {
        if (t.gone) continue;
        const open = t.armed;
        ctx.strokeStyle = t.owner === 'player' ? '#d9a52b' : '#8a8a8a'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(t.px, t.py, open ? 12 : 7, 0, TAU); ctx.stroke();
        ctx.fillStyle = ctx.strokeStyle;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * TAU, r = open ? 12 : 7;
          ctx.beginPath(); ctx.moveTo(t.px + Math.cos(a) * r, t.py + Math.sin(a) * r);
          ctx.lineTo(t.px + Math.cos(a + 0.15) * (r - 5), t.py + Math.sin(a + 0.15) * (r - 5));
          ctx.lineTo(t.px + Math.cos(a + 0.3) * r, t.py + Math.sin(a + 0.3) * r); ctx.fill();
        }
        ctx.fillStyle = '#555'; ctx.fillRect(t.px - 3, t.py - 3, 6, 6);
      } else if (t.type === 'tripwire') {
        ctx.fillStyle = '#444'; ctx.fillRect(t.px - 20, t.py - 4, 5, 8); ctx.fillRect(t.px + 15, t.py - 4, 5, 8);
        if (t.armed) {
          ctx.strokeStyle = `rgba(255,40,40,${0.5 + Math.random() * 0.4})`; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(t.px - 15, t.py); ctx.lineTo(t.px + 15, t.py); ctx.stroke();
        }
      } else if (t.type === 'shock') {
        ctx.strokeStyle = t.armed ? '#3a7ac8' : '#333'; ctx.lineWidth = 1.5;
        for (let i = -16; i <= 16; i += 8) {
          ctx.beginPath(); ctx.moveTo(t.px + i, t.py - 16); ctx.lineTo(t.px + i, t.py + 16);
          ctx.moveTo(t.px - 16, t.py + i); ctx.lineTo(t.px + 16, t.py + i); ctx.stroke();
        }
        if (t.armed && Math.random() < 0.5) {
          ctx.strokeStyle = '#bfe4ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(t.px + rand(-14, 14), t.py + rand(-14, 14));
          for (let i = 0; i < 3; i++) ctx.lineTo(t.px + rand(-16, 16), t.py + rand(-16, 16));
          ctx.stroke();
        }
        ctx.fillStyle = '#2a2f38'; ctx.fillRect(t.swx - 8, t.swy - 11, 16, 22);
        ctx.strokeStyle = '#777'; ctx.strokeRect(t.swx - 8, t.swy - 11, 16, 22);
        ctx.fillStyle = t.armed ? '#ff4a4a' : '#5dff6a';
        ctx.fillRect(t.swx - 2, t.armed ? t.swy - 9 : t.swy + 1, 4, 8);
        if (t.armed) text('FUSE', t.swx, t.swy - 15, 9, '#aaa');
      } else if (t.type === 'creak') {
        ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5;
        ctx.strokeRect(t.px - 15, t.py - 15, 30, 30);
        ctx.beginPath(); ctx.moveTo(t.px - 10, t.py - 6); ctx.lineTo(t.px + 2, t.py + 2); ctx.lineTo(t.px + 9, t.py - 3);
        ctx.moveTo(t.px - 4, t.py + 9); ctx.lineTo(t.px + 6, t.py + 4); ctx.stroke();
      }
    }
    for (const pt of game.parts) if (!pt.taken) drawPart(pt.kind, pt.px, pt.py + Math.sin(now * 3) * 2);
    for (const c of game.clues) {
      if (c.read) continue;
      ctx.save();
      ctx.translate(c.px, c.py); ctx.rotate(0.2);
      ctx.fillStyle = '#d8ccaa'; ctx.fillRect(-7, -9, 14, 18);
      ctx.fillStyle = '#6a5a40';
      for (let i = -5; i <= 5; i += 4) ctx.fillRect(-4, i, 8, 1.2);
      ctx.restore();
    }
    for (const t of game.tasks.concat([game.bench])) {
      const bench = t === game.bench;
      ctx.fillStyle = bench ? '#4a3626' : '#262e3c';
      ctx.strokeStyle = t.done ? '#3d8a4a' : bench ? '#b07aff' : '#d8b84a';
      ctx.lineWidth = 2;
      ctx.fillRect(t.px - 14, t.py - 11, 28, 22); ctx.strokeRect(t.px - 14, t.py - 11, 28, 22);
      ctx.fillStyle = t.done ? '#3d8a4a' : bench ? '#8a6a4a' : `rgba(120,200,255,${0.5 + Math.sin(now * 4 + t.px) * 0.3})`;
      ctx.fillRect(t.px - 9, t.py - 7, 18, 9);
      if (!t.done) text(bench ? '⚒' : '!', t.px, t.py - 16 + Math.sin(now * 5) * 2, 16, bench ? '#b07aff' : '#ffd84a');
    }
    const unlocked = game.done === game.tasks.length;
    ctx.fillStyle = unlocked ? '#1f4a2a' : '#2a1f1f';
    ctx.strokeStyle = unlocked ? '#5dff6a' : '#a33';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.roundRect(game.pod.px - 24, game.pod.py - 18, 48, 36, 16); ctx.fill(); ctx.stroke();
    text(unlocked ? 'ESCAPE' : 'LOCKED', game.pod.px, game.pod.py + 4, 10, unlocked ? '#5dff6a' : '#ff8080');
  }

  function drawGhostAt(alpha) {
    const g = game.ghost;
    const stunned = g.state === 'stunned';
    drawMatron(g.x, g.y, alpha, { tint: stunned ? '#b07aff' : g.state === 'chase' ? '#ff4040' : null });
    if (stunned || g.state === 'trapped') {
      text(`${stunned ? 'STUNNED' : 'TRAPPED'} ${Math.ceil(g.until - now)}s`, g.x, g.y - 52, 12, stunned ? '#c9a0ff' : '#d9a52b');
    }
  }

  function drawWorld() {
    const p = game.player, g = game.ghost;
    cam.x = Math.round(p.x - W / 2); cam.y = Math.round(p.y - H / 2);
    ctx.fillStyle = '#030406';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(-cam.x, -cam.y);

    ctx.globalAlpha = 0.07;
    ctx.drawImage(floorCanvas, 0, 0);
    ctx.globalAlpha = 1;

    // Flashlight: a cone where you aim plus a small pool of ambient light.
    const lightOn = now > game.flickerUntil;
    const close = dist(g.x, g.y, p.x, p.y) < 6 * TILE;
    const flick = lightOn && !(close && Math.random() < 0.08);
    const V = CFG.vision;
    const coneR = p.hidden ? 0 : flick ? V.cone : 0;
    const amb = p.hidden ? 55 : V.ambient;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * TAU;
      const diff = angDiff(a, p.aim);
      const r = diff < V.half ? Math.max(amb, coneR * (1 - Math.pow(diff / V.half, 4) * 0.3)) : amb;
      const dx = Math.cos(a), dy = Math.sin(a);
      const d = castRay(p.x, p.y, dx, dy, r) + 4;
      if (i === 0) ctx.moveTo(p.x + dx * d, p.y + dy * d); else ctx.lineTo(p.x + dx * d, p.y + dy * d);
    }
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(floorCanvas, 0, 0);
    drawObjects();
    drawGhostAt(0.8 + Math.sin(now * 13) * 0.12);
    const R = Math.max(coneR, amb);
    const lg = ctx.createRadialGradient(p.x, p.y, amb * 0.4, p.x, p.y, R);
    lg.addColorStop(0, 'rgba(3,4,6,0)');
    lg.addColorStop(0.6, 'rgba(3,4,6,0.35)');
    lg.addColorStop(1, 'rgba(3,4,6,0.95)');
    ctx.fillStyle = lg;
    ctx.fillRect(p.x - R - 10, p.y - R - 10, R * 2 + 20, R * 2 + 20);
    if (coneR) {
      ctx.fillStyle = 'rgba(255,235,190,0.05)';
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, coneR, p.aim - V.half, p.aim + V.half); ctx.fill();
    }
    ctx.restore();

    drawPlayer();
    if (p.hidden) {
      ctx.strokeStyle = '#6a7384'; ctx.lineWidth = 2;
      ctx.strokeRect(p.hidden.px - 13, p.hidden.py - 9, 26, 18);
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(p.x - 4, p.y, 1.8, 0, TAU); ctx.arc(p.x + 4, p.y, 1.8, 0, TAU); ctx.fill();
    }
    if (now < game.revealUntil) drawGhostAt(0.3);

    // UV flash burst
    const uvA = 1 - (now - game.uvFlashAt) / 0.4;
    if (uvA > 0) {
      ctx.fillStyle = `rgba(190,140,255,${uvA * 0.5})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.arc(p.x, p.y, CFG.uv.range, p.aim - CFG.uv.half, p.aim + CFG.uv.half); ctx.fill();
    }
    ctx.restore();

    if (now < game.revealUntil) {
      const a = Math.atan2(g.y - p.y, g.x - p.x);
      ctx.save();
      ctx.translate(W / 2 + Math.cos(a) * 80, H / 2 + Math.sin(a) * 80);
      ctx.rotate(a);
      ctx.fillStyle = 'rgba(220,220,255,0.75)';
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-4, 0); ctx.lineTo(-8, 8); ctx.fill();
      ctx.restore();
    }

    const danger = clamp(1 - dist(g.x, g.y, p.x, p.y) / (10 * TILE), 0, 1);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(${110 * danger | 0},0,0,${0.55 + danger * 0.35})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }

  function drawHUD() {
    const p = game.player;
    const total = game.tasks.length;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(16, 16, 330, 30);
    ctx.fillStyle = '#2f6b3a'; ctx.fillRect(20, 20, 322 * (game.done / total), 22);
    ctx.strokeStyle = '#bbb'; ctx.lineWidth = 2; ctx.strokeRect(20, 20, 322, 22);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(`SYSTEMS RESTORED  ${game.done}/${total}`, 28, 36);

    const list = game.tasks.concat([game.bench]);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(16, 54, 250, 24 + list.length * 17);
    ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ffd84a';
    ctx.fillText('TASKS', 24, 70);
    ctx.font = '12px sans-serif';
    list.forEach((t, i) => {
      ctx.fillStyle = t.done ? '#5dff6a' : t.optional ? '#c9a0ff' : '#ddd';
      ctx.fillText(`${t.done ? '✔' : '•'} ${t.room}: ${t.name}${t.optional ? ' (weapon)' : ''}`, 24, 88 + i * 17);
    });

    ctx.textAlign = 'right';
    ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = '#ff4a4a';
    const hearts = clamp(game.lives, 0, CFG.lives);
    ctx.fillText('♥'.repeat(hearts) + '♡'.repeat(CFG.lives - hearts), W - 20, 40);
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#fff';
    ctx.fillText(roomAt(p.x, p.y), W - 20, 62);
    ctx.font = '12px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('M map · ESC pause', W - 20, 80);

    // Survival panel
    const bx = 16, by = H - 120;
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(bx, by, 260, 104);
    ctx.textAlign = 'left'; ctx.font = '11px sans-serif'; ctx.fillStyle = '#ccc';
    ctx.fillText(p.exhausted ? 'STAMINA (exhausted)' : 'STAMINA (Shift run)', bx + 10, by + 16);
    ctx.fillStyle = '#222'; ctx.fillRect(bx + 10, by + 21, 240, 7);
    ctx.fillStyle = p.exhausted ? '#a33' : '#e0c050'; ctx.fillRect(bx + 10, by + 21, 240 * (p.stamina / CFG.stamina.max), 7);
    ctx.fillStyle = '#ccc';
    ctx.fillText(p.crouch ? 'NOISE (crouching: silent)' : 'NOISE (C to crouch)', bx + 10, by + 44);
    ctx.fillStyle = '#222'; ctx.fillRect(bx + 10, by + 49, 240, 7);
    const nf = game.noiseShown / 8;
    ctx.fillStyle = nf > 0.6 ? '#ff4a4a' : nf > 0.3 ? '#ffb43c' : '#5dff6a'; ctx.fillRect(bx + 10, by + 49, 240 * clamp(nf, 0, 1), 7);
    let ix = bx + 18;
    for (const pt of game.parts) {
      ctx.globalAlpha = pt.taken && !game.bench.done ? 1 : 0.2;
      drawPart(pt.kind, ix, by + 78, 0.8);
      ix += 26;
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ddd'; ctx.font = '12px sans-serif';
    ctx.fillText(`UV ${game.bench.done ? game.uv + ' (F)' : '—'}   Traps ${game.bearTraps} (G)`, bx + 100, by + 76);
    if (game.codeKnown) { ctx.fillStyle = '#ffd84a'; ctx.fillText(`Note: admin code ${game.code}`, bx + 100, by + 94); }

    let prompt = '';
    if (p.stuck) prompt = `MASH SPACE to escape the trap (${p.mash}/${CFG.mash})`;
    else if (p.hidden) prompt = 'IN VENT · Q crawl to next vent · E climb out';
    else if (p.hold) prompt = `${p.hold.target.type === 'bear' ? 'Disarming' : 'Cutting'}... ${Math.round((p.hold.t / p.hold.need) * 100)}%`;
    else if (nearest(openTasks(), p, 38)) prompt = 'E to use console';
    else if (nearest(game.parts.filter((x) => !x.taken), p, 34)) prompt = 'E to pick up part';
    else if (nearest(game.traps.filter((t) => t.type === 'shock' && t.armed), p, 30, 'swx', 'swy')) prompt = 'E to pull fuse';
    else if (nearest(game.clues.filter((c) => !c.read), p, 34)) prompt = 'E to read';
    else if (nearest(game.vents, p, 34)) prompt = 'E to hide in vent';
    else if (nearest(game.traps.filter((t) => t.armed && !t.gone && (t.type === 'bear' && t.owner !== 'player' || t.type === 'tripwire')), p, 46)) prompt = 'Crouch (C) + hold E to disarm';
    if (prompt && !game.task) {
      ctx.textAlign = 'center'; ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(W / 2 - 190, H - 70, 380, 32);
      ctx.fillStyle = '#fff'; ctx.fillText(prompt, W / 2, H - 48);
    }

    if (game.msg && now < game.msg.until) {
      ctx.textAlign = 'center'; ctx.font = 'bold 19px sans-serif';
      ctx.fillStyle = `rgba(255,255,255,${clamp(game.msg.until - now, 0, 1)})`;
      ctx.fillText(game.msg.text, W / 2, 110);
    }

    if (game.reading) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, 0, W, H);
      const bw = Math.min(560, W - 40);
      ctx.fillStyle = '#d8ccaa'; ctx.fillRect(W / 2 - bw / 2, H / 2 - 90, bw, 180);
      ctx.fillStyle = '#3a2f1a'; ctx.textAlign = 'center';
      ctx.font = 'bold 18px serif'; ctx.fillText('— A crumpled page —', W / 2, H / 2 - 55);
      ctx.font = '16px serif';
      wrapText(game.reading, W / 2, H / 2 - 20, bw - 40, 22);
      ctx.font = 'italic 13px serif';
      ctx.fillText('A chill runs down your spine... you sense her (E to close)', W / 2, H / 2 + 72);
    }
    if (game.task) drawTaskPanel();
    if (showMap) drawMinimap();
  }

  function wrapText(str, x, y, maxW, lh) {
    let lineStr = '';
    for (const w of str.split(' ')) {
      const t = lineStr ? lineStr + ' ' + w : w;
      if (ctx.measureText(t).width > maxW) { ctx.fillText(lineStr, x, y); lineStr = w; y += lh; } else lineStr = t;
    }
    ctx.fillText(lineStr, x, y);
  }

  function drawMinimap() {
    const s = Math.min((W - 80) / (MAP_W * TILE), (H - 80) / (MAP_H * TILE));
    const ox = (W - MAP_W * TILE * s) / 2, oy = (H - MAP_H * TILE * s) / 2;
    ctx.fillStyle = 'rgba(0,8,20,0.88)'; ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy); ctx.scale(s, s);
    ctx.globalAlpha = 0.9; ctx.drawImage(floorCanvas, 0, 0); ctx.globalAlpha = 1;
    ctx.font = `bold ${18 / s}px sans-serif`; ctx.textAlign = 'center';
    for (const t of game.tasks) if (!t.done) { ctx.fillStyle = '#ffd84a'; ctx.fillText('!', t.px, t.py + 6 / s); }
    if (!game.bench.done) { ctx.fillStyle = '#b07aff'; ctx.fillText('⚒', game.bench.px, game.bench.py + 6 / s); }
    for (const pt of game.parts) if (!pt.taken) drawPart(pt.kind, pt.px, pt.py, 1.4 / s);
    if (now < game.revealUntil) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(game.ghost.x, game.ghost.y, 9 / s, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#c8742a'; ctx.beginPath(); ctx.arc(game.player.x, game.player.y, 9 / s, 0, TAU); ctx.fill();
    ctx.restore();
    text('SHIP MAP  ·  ! task  ·  ⚒ workbench  ·  glowing items = weapon parts  ·  orange = you', W / 2, oy - 14, 15, '#fff');
  }

  function centerText(lines, y0, gap = 34) {
    lines.forEach(([str, font, col], i) => { ctx.font = font; ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(str, W / 2, y0 + i * gap); });
  }

  function drawMenu() {
    ctx.fillStyle = '#030406'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = (i * 97 + now * 20 * (1 + i % 3)) % W, y = (i * 53) % H;
      ctx.fillStyle = `rgba(255,255,255,${0.2 + (i % 3) * 0.15})`;
      ctx.fillRect(x, y, 2, 2);
    }
    const flick = Math.random() < 0.97;
    if (flick) drawMatron(W / 2, H / 2 - 150, 0.9, { scale: 2.6, tint: Math.sin(now) > 0.9 ? '#ff4040' : null });
    centerText([
      ['GHOST SHIP', 'bold 64px sans-serif', '#e8e8e8'],
      ['The crew vanished. The Matron did not.', 'italic 18px serif', 'rgba(255,220,220,0.85)'],
      ['Restore 9 systems with hands-on tasks, then escape in the pod. You get 2 chances.', '15px sans-serif', '#ffd84a'],
      ['WASD move · Mouse aim flashlight · SHIFT run · C crouch (silent) · E interact', '14px sans-serif', 'rgba(255,255,255,0.75)'],
      ['Q crawl vents · F fire UV Flash · G set bear trap · M map · SPACE break free', '14px sans-serif', 'rgba(255,255,255,0.75)'],
      ['She hears every footstep. Bear traps, tripwires, shock floors and creaky panels everywhere.', '14px sans-serif', 'rgba(255,170,170,0.8)'],
      ['🎧 Play with headphones, in the dark.', '14px sans-serif', 'rgba(255,255,255,0.6)'],
      [Math.sin(now * 4) > -0.3 ? 'CLICK OR PRESS ENTER TO BOARD' : '', 'bold 20px sans-serif', '#ff5a5a'],
    ], H / 2 - 30, 32);
  }

  function render() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (mode === 'menu') { drawMenu(); return; }
    drawWorld();
    drawHUD();

    if (game.flash) {
      const t = (now - game.flash.start) / 0.45;
      if (t < 1) drawScareFace(1 + t * 0.3, 12, t < 0.6 ? 0.95 : (1 - t) * 2.3);
      else game.flash = null;
    }
    if (mode === 'scare') {
      const t = clamp((now - game.scare.start) / game.scare.dur, 0, 1);
      ctx.fillStyle = t < 0.08 ? '#fff' : `rgba(120,0,0,${0.6 + Math.random() * 0.3})`;
      ctx.fillRect(0, 0, W, H);
      drawScareFace(0.6 + Math.pow(t, 0.4) * 1.1, 26 * (1 - t * 0.5), 1);
    } else if (mode === 'caught') {
      ctx.fillStyle = 'rgba(40,0,0,0.85)'; ctx.fillRect(0, 0, W, H);
      centerText([
        ['SHE GOT YOU', 'bold 56px sans-serif', '#ff4a4a'],
        [`Chances left: ${game.lives}`, '18px sans-serif', '#fff'],
        [now - game.caughtAt > 1 ? 'Press ENTER or click to wake up in the Cafeteria' : '', '16px sans-serif', '#fff'],
      ], H / 2 - 20);
    } else if (mode === 'over' || mode === 'win') {
      const s = game.stats, t = game.endTime - game.startTime;
      const time = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
      let grade = '';
      if (mode === 'win') {
        const score = 1000 + Math.max(0, 900 - t) - s.caught * 300 - s.traps * 40 + s.clues * 25 + s.stuns * 50;
        grade = score >= 1500 ? 'S' : score >= 1200 ? 'A' : score >= 900 ? 'B' : 'C';
      }
      ctx.fillStyle = mode === 'win' ? 'rgba(0,25,10,0.85)' : 'rgba(25,0,0,0.9)';
      ctx.fillRect(0, 0, W, H);
      if (mode === 'over') drawMatron(W / 2, H / 2 - 150, 0.9, { scale: 2.2, tint: '#ff4040' });
      centerText([
        [mode === 'win' ? 'YOU ESCAPED THE SHIP' : 'YOU NEVER LEFT THE SHIP', 'bold 48px sans-serif', mode === 'win' ? '#5dff6a' : '#ff4a4a'],
        [mode === 'win' ? `Grade ${grade}` : `Systems restored: ${game.done}/${game.tasks.length}`, 'bold 26px sans-serif', '#ffd84a'],
        [`Time ${time} · Caught ${s.caught} · Traps triggered ${s.traps} · Stuns ${s.stuns} · Clues ${s.clues}/${game.clues.length}`, '16px sans-serif', '#fff'],
        ['Press ENTER or click to play again', '16px sans-serif', '#fff'],
      ], H / 2 - 20);
    } else if (mode === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
      centerText([['PAUSED', 'bold 48px sans-serif', '#fff'], ['ESC to resume', '16px sans-serif', '#fff']], H / 2 - 20);
    }
  }

  // ---- Loop & input ----------------------------------------------------------
  let last = performance.now();
  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    if (mode !== 'paused') now += dt;
    if (mode === 'scare' && now - game.scare.start > game.scare.dur) finishCatch();
    if (mode === 'play') {
      updatePlayer(dt);
      if (game.task) { const mg = MINI[game.task.def.type]; if (mg.update) mg.update(game.task.st, dt); }
      if (mode === 'play') updateGhost(dt);
      game.noiseShown = Math.max(0, game.noiseShown - dt * 4);
      // Random light failures
      if (now > game.nextFlicker) {
        game.nextFlicker = now + rand(20, 45);
        game.flickerUntil = now + rand(0.6, 1.4);
        Sfx.whisper();
      }
      const g = game.ghost;
      const d = dist(g.x, g.y, game.player.x, game.player.y) / TILE;
      if (mode === 'play' && d < 10 && now > game.nextBeat) {
        Sfx.beat(0.15 + 0.45 * (1 - d / 10));
        game.nextBeat = now + 0.3 + (d / 10) * 0.8;
      }
    }
    render();
    requestAnimationFrame(frame);
  }

  function advance() {
    if (mode === 'menu' || mode === 'over' || mode === 'win') { audioInit(); newGame(); }
    else if (mode === 'caught' && now - game.caughtAt > 1) respawn();
  }

  addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    if (e.repeat) return;
    if (mode !== 'play' && mode !== 'paused') { if (e.code === 'Enter' || e.code === 'Space') advance(); return; }
    if (e.code === 'Escape') {
      if (game.task) { game.task = null; return; }
      mode = mode === 'paused' ? 'play' : 'paused';
      return;
    }
    if (mode !== 'play') return;
    if (e.code === 'Space' && game.player.stuck) struggle();
    else if (e.code === 'KeyE') interact();
    else if (e.code === 'KeyQ') ventCrawl();
    else if (e.code === 'KeyF') fireUV();
    else if (e.code === 'KeyG') placeTrap();
    else if (e.code === 'KeyM' || e.code === 'Tab') showMap = !showMap;
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'play') mode = 'paused'; });
  canvas.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (game && game.task && MINI[game.task.def.type].move) MINI[game.task.def.type].move(game.task.st, local());
  });
  canvas.addEventListener('mousedown', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (mode === 'paused') { mode = 'play'; return; }
    if (mode === 'play' && game.task) { MINI[game.task.def.type].down(game.task.st, local()); return; }
    if (mode !== 'play') advance();
  });
  canvas.addEventListener('mouseup', () => {
    if (mode === 'play' && game.task && MINI[game.task.def.type].up) MINI[game.task.def.type].up(game.task.st, local());
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Console hook for playtesting: GhostDebug.state()
  window.GhostDebug = { state: () => ({ mode, game }), cfg: CFG, mini: MINI };

  requestAnimationFrame(frame);
})();
