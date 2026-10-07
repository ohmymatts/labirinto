/* =========================================================================
   LABIRINTO — a descending maze escape.
   Find the key, open the far door, survive as every level gets harder:
   bigger mazes, shrinking light, faster ghosts, tighter timers.
   ========================================================================= */
(function () {
  'use strict';

  var M = window.MazeLib;
  var $ = function (s) { return document.querySelector(s); };
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };

  /* ---------------- DOM ---------------- */
  var canvas = $('#game');
  var ctx = canvas.getContext('2d');
  var stage = $('#stage');
  var overlayEl = $('#overlay');
  var toastEl = $('#toast');
  var bannerEl = $('#banner');
  var hudLevel = $('#hud-level');
  var hudKey = $('#hud-key');
  var hudLives = $('#hud-lives');
  var hudBest = $('#hud-best');
  var timefill = $('#timefill');
  var hudTime = $('#hud-time');
  var btnPause = $('#btn-pause');
  var btnMute = $('#btn-mute');
  var dpad = $('#dpad');

  /* ---------------- sound ---------------- */
  var Sound = {
    ac: null, on: true,
    ensure: function () {
      if (!this.ac) {
        try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.ac = null; }
      }
      if (this.ac && this.ac.state === 'suspended') this.ac.resume();
    },
    beep: function (freq, dur, type, vol, slideTo, delay) {
      if (!this.on || !this.ac) return;
      var t = this.ac.currentTime + (delay || 0);
      var o = this.ac.createOscillator();
      var g = this.ac.createGain();
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, t);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ac.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    pickup: function () { this.beep(740, .09, 'square', .14); this.beep(990, .14, 'square', .14, null, .08); },
    locked: function () { this.beep(180, .12, 'square', .12); this.beep(120, .16, 'square', .12, null, .09); },
    levelClear: function () {
      this.beep(523, .1, 'square', .13); this.beep(659, .1, 'square', .13, null, .09);
      this.beep(784, .1, 'square', .13, null, .18); this.beep(1047, .22, 'square', .14, null, .27);
    },
    hit: function () { this.beep(300, .3, 'sawtooth', .18, 60); },
    gameover: function () {
      this.beep(392, .25, 'sawtooth', .16); this.beep(311, .25, 'sawtooth', .16, null, .25);
      this.beep(233, .5, 'sawtooth', .18, null, .5);
    },
    step: null
  };

  /* ---------------- state ---------------- */
  var G = {
    state: 'menu', // menu | playing | clear | paused | gameover
    level: 1,
    lives: 3,
    best: 0,
    hasKey: false,
    timer: 0,
    timeMax: 60,
    invuln: 0,
    lockedCd: 0,
    clearT: 0,
    shake: 0,
    ghostFreeze: 0,
    time: 0
  };
  try { G.best = parseInt(localStorage.getItem('labirinto.best') || '0', 10) || 0; } catch (e) { }

  var grid = null, GW = 0, GH = 0;
  var cfg = { cols: 9, rows: 9, ghosts: 0, ghostSpeed: 1.6, ghostChase: 7, fogR: Infinity, time: 60 };
  var door = null, key = null, startCell = { x: 1, y: 1 };
  var player = { x: 1.5, y: 1.5, r: 0.32, speed: 4.4, face: { x: 0, y: 1 } };
  var ghosts = [];
  var particles = [];
  var pDist = null, pDistKey = -1; // cached BFS field toward player for ghost chasing
  var held = { up: false, down: false, left: false, right: false };
  var mazeCanvas = document.createElement('canvas');
  var fogCanvas = document.createElement('canvas');
  var tile = 24, dpr = 1;

  /* ---------------- difficulty scaling ---------------- */
  // Difficulty dials, in rough order of when they bite:
  //   1. maze size (9 -> 21 cells)
  //   2. punched shortcuts shrink -> more snake-like corridors
  //   3. fog of war appears at lvl 2 and keeps tightening
  //   4. ghosts appear at lvl 3, multiply up to 5 and speed up
  //   5. time margin tightens (timer is always >= ~1.8x optimal route)
  function levelConfig(level) {
    var cells = Math.min(9 + (level - 1) * 2, 21);
    return {
      cols: cells,
      rows: cells,
      punch: Math.max(0.12, 0.34 - level * 0.012),
      ghosts: Math.min(5, Math.max(0, level - 2)),
      ghostSpeed: Math.min(3.6, 1.6 + level * 0.16),
      ghostChase: Math.min(12, 6 + level),
      fogR: level === 1 ? Infinity : Math.max(4.2, 12 - level),
      fogAlpha: Math.min(0.985, 0.94 + level * 0.008),
      timeEff: Math.min(0.4, 0.36 + level * 0.004),
      playerSpeed: Math.min(6, 4.4 + level * 0.06)
    };
  }

  function flavor(level) {
    if (level === 2) return '🕯 your light starts to shrink…';
    if (level === 3) return '👻 ghosts drift in the dark…';
    if (level === 6) return '⚡ they hunt you now…';
    return '';
  }

  /* ---------------- level build ---------------- */
  function buildLevel(level) {
    cfg = levelConfig(level);
    grid = M.generate(cfg.cols, cfg.rows, Math.random);
    M.punch(grid, cfg.punch, Math.random);
    GW = grid[0].length; GH = grid.length;

    // Random spawn: any open cell can be the entry point — every run starts
    // a different journey. The door is then the farthest reachable cell from
    // that random start, and the key is placed deep between/away from both.
    var openCells = [];
    for (var y = 1; y < GH; y++) for (var x = 1; x < GW; x++)
      if (grid[y][x] === 0) openCells.push([x, y]);
    var sp = openCells[(Math.random() * openCells.length) | 0];
    startCell = { x: sp[0], y: sp[1] };

    var dFromStart = M.distField(grid, startCell.x, startCell.y);
    door = M.farthestFrom(grid, dFromStart);
    var dFromDoor = M.distField(grid, door.x, door.y);

    // Key: never in the start zone (it must live deep inside the maze) and,
    // subject to that, on the cell giving the longest route. This guarantees
    // there is always a real treasure hunt — no instant spawn pickups and
    // no levels where the key appears to be missing.
    var deepMin = Math.max(6, Math.round(door.d * 0.25));
    key = null;
    var kBest = -1;
    for (var ky2 = 1; ky2 < GH - 1; ky2++) {
      for (var kx2 = 1; kx2 < GW - 1; kx2++) {
        if (grid[ky2][kx2] !== 0) continue;
        if (kx2 === door.x && ky2 === door.y) continue; // never on the door itself
        var ds = dFromStart[ky2 * GW + kx2], dd = dFromDoor[ky2 * GW + kx2];
        if (ds >= deepMin && ds + dd > kBest) { kBest = ds + dd; key = { x: kx2, y: ky2 }; }
      }
    }
    if (!key) key = M.farthestFrom(grid, dFromDoor); // tiny-maze fallback
    // optimal route length: start -> key -> door
    var kr = dFromStart[key.y * GW + key.x] + dFromDoor[key.y * GW + key.x];
    var time = Math.max(20, Math.round(kr / (cfg.playerSpeed * cfg.timeEff)));

    // spawn at the random start cell, eyes facing an open corridor
    player.x = startCell.x + 0.5; player.y = startCell.y + 0.5;
    player.speed = cfg.playerSpeed;
    player.face = { x: 0, y: 1 };
    var spDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var sd = 0; sd < 4; sd++) {
      if (!solid(startCell.x + spDirs[sd][0], startCell.y + spDirs[sd][1])) {
        player.face = { x: spDirs[sd][0], y: spDirs[sd][1] };
        break;
      }
    }
    G.hasKey = false;
    G.timer = time; G.timeMax = time;
    G.invuln = 1.2; G.lockedCd = 0; G.shake = 0; G.ghostFreeze = 2;
    pDist = null; pDistKey = -1;
    particles.length = 0;

    // Fairness: ghosts never start closer than ghostMinD BFS-tiles from the
    // player's spawn, never nearer than 8 tiles to each other, and all
    // ghosts stay frozen for the first 2 seconds so level entry is never
    // an ambush (the on-screen "⚠ ghosts froze" toast only on their debut).
    ghosts = [];
    var maxD = door.d || 1;
    var ghostMinD = Math.max(14, Math.round(maxD * 0.45));

    var tries = 0;
    while (ghosts.length < cfg.ghosts && tries < 6000) {
      tries++;
      var c = openCells[(Math.random() * openCells.length) | 0];
      var d = dFromStart[c[1] * GW + c[0]];
      if (d < 0 || d < ghostMinD) continue;
      var far = true;
      for (var i = 0; i < ghosts.length; i++)
        if (Math.abs(ghosts[i].cx0 - c[0]) + Math.abs(ghosts[i].cy0 - c[1]) < 8) { far = false; break; }
      if (!far) continue;
      var hue = ['#ff6b81', '#c084fc', '#f97316', '#38bdf8', '#4ade80'][ghosts.length % 5];
      ghosts.push({
        cx: c[0], cy: c[1], cx0: c[0], cy0: c[1],
        fx: c[0], fy: c[1], nx: c[0], ny: c[1], t: 1,
        dir: [0, 0], color: hue, seed: Math.random() * 10
      });
    }

    layout();
    renderMaze();
    hudBest.textContent = G.best > 0 ? G.best : '–';
  }

  /* ---------------- geometry / collision ---------------- */
  function solid(x, y) {
    if (x < 0 || y < 0 || x >= GW || y >= GH) return true;
    return grid[y][x] === 1;
  }
  var EPS = 0.001;

  function moveEntity(e, dx, dy, dt, speed) {
    // facing tracks the actual movement input (diagonal when turning corners)
    if (dx !== 0) e.face.x = Math.sign(dx);
    if (dy !== 0) e.face.y = Math.sign(dy);
    if (dy === 0 && dx !== 0) e.face.y = 0;
    if (dx === 0 && dy !== 0) e.face.x = 0;
    var moved = false;
    if (dx !== 0) {
      var target = e.x + dx * speed * dt;
      var y0 = Math.floor(e.y - e.r), y1 = Math.floor(e.y + e.r);
      if (dx > 0) {
        var cx = Math.floor(target + e.r);
        if (solid(cx, y0) || solid(cx, y1)) { target = Math.min(target, cx - e.r - EPS); } else moved = true;
      } else {
        var cx2 = Math.floor(target - e.r);
        if (solid(cx2, y0) || solid(cx2, y1)) { target = Math.max(target, cx2 + 1 + e.r + EPS); } else moved = true;
      }
      if (target !== e.x && e.x !== target) { if (Math.abs(target - e.x) > EPS) moved = true; e.x = clamp(target, e.r + EPS, GW - 1 - e.r - EPS); }
    }
    if (dy !== 0) {
      var target2 = e.y + dy * speed * dt;
      var x0 = Math.floor(e.x - e.r), x1 = Math.floor(e.x + e.r);
      if (dy > 0) {
        var cy = Math.floor(target2 + e.r);
        if (solid(x0, cy) || solid(x1, cy)) { target2 = Math.min(target2, cy - e.r - EPS); } else moved = true;
      } else {
        var cy2 = Math.floor(target2 - e.r);
        if (solid(x0, cy2) || solid(x1, cy2)) { target2 = Math.max(target2, cy2 + 1 + e.r + EPS); } else moved = true;
      }
      if (Math.abs(target2 - e.y) > EPS) moved = true;
      e.y = clamp(target2, e.r + EPS, GH - 1 - e.r - EPS);
    }
    return moved;
  }

  function playerCell() {
    return { x: Math.floor(player.x), y: Math.floor(player.y) };
  }

  /* ---------------- ghosts ---------------- */
  function ghostStep(g) {
    var pc = playerCell();
    var neighbors = [];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (var i = 0; i < 4; i++) {
      var nx = g.cx + dirs[i][0], ny = g.cy + dirs[i][1];
      if (!solid(nx, ny)) neighbors.push([nx, ny, dirs[i]]);
    }
    if (!neighbors.length) return;
    var manh = Math.abs(pc.x - g.cx) + Math.abs(pc.y - g.cy);
    var choice = null;

    if (manh <= cfg.ghostChase && G.ghostFreeze <= 0) {
      var pcKey = pc.y * GW + pc.x;
      if (pDist === null || pcKey !== pDistKey) {
        pDist = M.distField(grid, pc.x, pc.y);
        pDistKey = pcKey;
      }
      var bestD = Infinity, ties = [];
      for (var n = 0; n < neighbors.length; n++) {
        var d = pDist[neighbors[n][1] * GW + neighbors[n][0]];
        if (d >= 0 && d < bestD) { bestD = d; ties = [neighbors[n]]; }
        else if (d >= 0 && d === bestD) { ties.push(neighbors[n]); }
      }
      if (ties.length) choice = ties[(Math.random() * ties.length) | 0];
      else choice = neighbors[(Math.random() * neighbors.length) | 0];
    } else {
      // wander: prefer continuing, never reverse unless dead end
      var pool = [];
      for (var w = 0; w < neighbors.length; w++) {
        var rev = (g.dir[0] === -neighbors[w][2][0] && g.dir[1] === -neighbors[w][2][1]);
        var straight = (g.dir[0] === neighbors[w][2][0] && g.dir[1] === neighbors[w][2][1]);
        if (neighbors.length > 1 && rev) continue;
        pool.push({ n: neighbors[w], wgt: straight ? 3 : 1 });
      }
      if (!pool.length) pool = [{ n: neighbors[0], wgt: 1 }];
      var total = 0;
      for (var p = 0; p < pool.length; p++) total += pool[p].wgt;
      var roll = Math.random() * total;
      for (var q = 0; q < pool.length; q++) {
        roll -= pool[q].wgt;
        if (roll <= 0) { choice = pool[q].n; break; }
      }
      if (!choice) choice = pool[pool.length - 1].n;
    }
    if (!choice) choice = neighbors[(Math.random() * neighbors.length) | 0];

    g.fx = g.cx; g.fy = g.cy;
    g.nx = choice[0]; g.ny = choice[1];
    g.dir = choice[2];
    g.t = 0;
  }

  function updateGhost(g, dt) {
    if (G.ghostFreeze > 0) return;
    if (g.t >= 1) {
      g.cx = g.nx; g.cy = g.ny;
      ghostStep(g);
    }
    g.t = Math.min(1, g.t + dt * cfg.ghostSpeed);
    g.px = g.fx + (g.nx - g.fx) * g.t + 0.5;
    g.py = g.fy + (g.ny - g.fy) * g.t + 0.5;
  }

  /* ---------------- particles ---------------- */
  function burst(x, y, color, n, speed) {
    for (var i = 0; i < n && particles.length < 320; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = (0.4 + Math.random()) * (speed || 2.4);
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, t: 0, color: color, r: 1.5 + Math.random() * 2.5 });
    }
  }
  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.t += dt;
      if (p.t >= p.life) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
    }
  }

  /* ---------------- game flow ---------------- */
  function showMenu() {
    overlayEl.innerHTML =
      '<div class="panel">' +
      '<h1>LABIRINTO</h1>' +
      '<p class="tag">find the key · unlock the door · escape</p>' +
      '<ul class="rules">' +
      '<li><b>WASD / Arrows</b> — move through the maze</li>' +
      '<li><b>🔑</b> — grab the hidden key</li>' +
      '<li><b>🚪</b> — the door opens <i>only</i> for the key-holder</li>' +
      '<li>each level the maze grows and the light fades…</li>' +
      '</ul>' +
      '<button id="btn-start">▶ START RUN</button>' +
      '<p class="stat-line">BEST: level <b>' + (G.best || '–') + '</b></p>' +
      '</div>';
    overlayEl.classList.remove('hidden');
    var b = $('#btn-start');
    if (b) b.addEventListener('click', startRun);
  }

  function showPause() {
    overlayEl.innerHTML =
      '<div class="panel">' +
      '<h2 class="safe">PAUSED</h2>' +
      '<p class="stat-line">the maze waits for no one… except now</p>' +
      '<button id="btn-resume">▶ RESUME</button>' +
      '</div>';
    overlayEl.classList.remove('hidden');
    var b = $('#btn-resume');
    if (b) b.addEventListener('click', togglePause);
  }

  function showGameOver() {
    var isNew = G.level > G.best;
    overlayEl.innerHTML =
      '<div class="panel">' +
      '<h2>GAME OVER</h2>' +
      '<p class="stat-line">you reached level <b>' + G.level + '</b>' + (isNew ? ' — <span style="color:var(--gold)">NEW BEST!</span>' : '') + '</p>' +
      '<p class="stat-line">best: level <b>' + G.best + '</b></p>' +
      '<button id="btn-retry">↻ DESCEND AGAIN</button>' +
      '</div>';
    overlayEl.classList.remove('hidden');
    var b = $('#btn-retry');
    if (b) b.addEventListener('click', startRun);
  }

  function hideOverlay() { overlayEl.classList.add('hidden'); }

  function startRun() {
    Sound.ensure();
    G.level = 1; G.lives = 3;
    buildLevel(1);
    G.state = 'playing';
    hideOverlay();
    banner('LEVEL 1', 'find the key 🔑');
    Sound.beep(392, .15, 'square', .12);
  }

  function togglePause() {
    if (G.state === 'playing') { G.state = 'paused'; showPause(); }
    else if (G.state === 'paused') { G.state = 'playing'; hideOverlay(); }
  }

  function loseLife(reason) {
    G.lives--;
    Sound.hit();
    G.shake = 0.4;
    burst(player.x, player.y, '#f87171', 26, 3);
    if (G.lives <= 0) {
      G.lives = 0;
      if (G.level > G.best) { G.best = G.level; saveBest(); }
      G.state = 'gameover';
      Sound.gameover();
      showGameOver();
      return;
    }
    if (reason === 'time') {
      G.hasKey = false;
      hudKey.classList.add('dim'); hudKey.classList.remove('lit');
      banner('TIME UP', 'the clock wins this round');
      G.timer = G.timeMax;
    } else {
      banner('CAUGHT', 'watch the shadows…');
    }
    // respawn
    player.x = startCell.x + 0.5; player.y = startCell.y + 0.5;
    G.invuln = 2.5;
    G.ghostFreeze = 2;
    pDist = null;
    for (var i = 0; i < ghosts.length; i++) {
      var g = ghosts[i];
      g.cx = g.cx0; g.cy = g.cy0; g.fx = g.cx0; g.fy = g.cy0; g.nx = g.cx0; g.ny = g.cy0; g.t = 1; g.dir = [0, 0];
    }
  }

  function saveBest() {
    try { localStorage.setItem('labirinto.best', String(G.best)); } catch (e) { }
  }

  function clearLevel() {
    var clearedLevel = G.level;
    if (clearedLevel > G.best) { G.best = clearedLevel; saveBest(); hudBest.textContent = G.best; }
    G.state = 'clear';
    G.clearT = 1.5;
    Sound.levelClear();
    burst(door.x + 0.5, door.y + 0.5, '#67e8f9', 34, 3.2);
    banner('LEVEL ' + clearedLevel + ' CLEARED', flavor(clearedLevel + 1) || 'going deeper…');
    if (clearedLevel % 3 === 0 && G.lives < 4) {
      G.lives++;
      toast('bonus life ♥');
    }
  }

  function nextLevel() {
    G.level++;
    buildLevel(G.level);
    G.state = 'playing';
    banner('LEVEL ' + G.level, G.hasKey ? '' : 'find the key 🔑');
  }

  /* ---------------- update ---------------- */
  function update(dt) {
    G.time += dt;
    updateParticles(dt);
    if (G.state !== 'playing') {
      if (G.state === 'clear') {
        G.clearT -= dt;
        if (G.clearT <= 0) nextLevel();
      }
      return;
    }

    if (G.invuln > 0) G.invuln -= dt;
    if (G.lockedCd > 0) G.lockedCd -= dt;
    if (G.shake > 0) G.shake -= dt;
    if (G.ghostFreeze > 0) G.ghostFreeze -= dt;

    // timer
    G.timer -= dt;
    if (G.timer <= 0) { G.timer = 0; loseLife('time'); return; }

    // player
    var dx = (held.right ? 1 : 0) - (held.left ? 1 : 0);
    var dy = (held.down ? 1 : 0) - (held.up ? 1 : 0);
    if (dx || dy) moveEntity(player, dx, dy, dt, player.speed);
    // cornering assist: while moving along one axis, gently recenter on the
    // other axis so junction turns never snag on the wall edge
    if (dx !== 0 && dy === 0) {
      var cc = Math.floor(player.y) + 0.5;
      player.y += (cc - player.y) * Math.min(1, dt * 12);
    } else if (dy !== 0 && dx === 0) {
      var ccx2 = Math.floor(player.x) + 0.5;
      player.x += (ccx2 - player.x) * Math.min(1, dt * 12);
    }

    // ghosts
    for (var i = 0; i < ghosts.length; i++) updateGhost(ghosts[i], dt);

    // ghost collision
    if (G.invuln <= 0) {
      for (var ig = 0; ig < ghosts.length; ig++) {
        var g = ghosts[ig];
        var ddx = player.x - (g.px !== undefined ? g.px : g.cx + 0.5);
        var ddy = player.y - (g.py !== undefined ? g.py : g.cy + 0.5);
        if (ddx * ddx + ddy * ddy < 0.55 * 0.55) { loseLife('ghost'); return; }
      }
    }

    // key pickup
    if (!G.hasKey) {
      var kdx = player.x - (key.x + 0.5), kdy = player.y - (key.y + 0.5);
      if (kdx * kdx + kdy * kdy < 0.45 * 0.45) {
        G.hasKey = true;
        Sound.pickup();
        burst(key.x + 0.5, key.y + 0.5, '#fbbf24', 30, 3);
        hudKey.classList.add('lit'); hudKey.classList.remove('dim');
        toast('🔑 key found — reach the door!');
      }
    }

    // door
    var ddx2 = player.x - (door.x + 0.5), ddy2 = player.y - (door.y + 0.5);
    if (ddx2 * ddx2 + ddy2 * ddy2 < 0.6 * 0.6) {
      if (G.hasKey) { clearLevel(); return; }
      else if (G.lockedCd <= 0) {
        G.lockedCd = 1.6;
        Sound.locked();
        toast('🚪 locked — find the key first!');
      }
    }
  }

  /* ---------------- layout / resize ---------------- */
  function layout() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    var sr = stage.getBoundingClientRect();
    var availW = Math.max(120, sr.width - 24);
    var availH = Math.max(120, sr.height - 24);
    var t = Math.floor(Math.min(availW / GW, availH / GH));
    tile = clamp(t, 10, 40);
    var w = tile * GW, h = tile * GH;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fogCanvas.width = canvas.width;
    fogCanvas.height = canvas.height;
    renderMaze();
  }

  /* ---------------- static maze render ---------------- */
  function renderMaze() {
    if (!grid) return;
    mazeCanvas.width = Math.round(GW * tile * dpr);
    mazeCanvas.height = Math.round(GH * tile * dpr);
    var m = mazeCanvas.getContext('2d');
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    // floor
    m.fillStyle = '#0d1130';
    m.fillRect(0, 0, GW * tile, GH * tile);
    // floor dots
    m.fillStyle = '#1a2352';
    for (var y = 1; y < GH; y += 2)
      for (var x = 1; x < GW; x += 2)
        m.fillRect(x * tile + (tile >> 1) - 1, y * tile + (tile >> 1) - 1, 2, 2);
    // walls
    for (var wy = 0; wy < GH; wy++) {
      for (var wx = 0; wx < GW; wx++) {
        if (grid[wy][wx] !== 1) continue;
        var px = wx * tile, py = wy * tile;
        m.fillStyle = '#232b4d';
        m.fillRect(px, py, tile, tile);
        // top highlight when open below-ish
        if (wy + 1 < GH && grid[wy + 1][wx] === 0) {
          m.fillStyle = '#3a4a80';
          m.fillRect(px, py + tile - 3, tile, 3);
        }
        if (wy > 0 && grid[wy - 1][wx] === 0) {
          m.fillStyle = '#2e3a68';
          m.fillRect(px, py, tile, 2);
        }
        if (wx + 1 < GW && grid[wy][wx + 1] === 0) {
          m.fillStyle = '#314070';
          m.fillRect(px + tile - 2, py, 2, tile);
        }
        if (wx > 0 && grid[wy][wx - 1] === 0) {
          m.fillStyle = '#1d2450';
          m.fillRect(px, py, 2, tile);
        }
      }
    }
    // start pad (at the randomized spawn cell)
    var sxp = startCell.x * tile, syp = startCell.y * tile;
    m.fillStyle = 'rgba(103,232,249,0.10)';
    m.fillRect(sxp, syp, tile, tile);
    m.strokeStyle = 'rgba(103,232,249,0.35)';
    m.strokeRect(sxp + 2.5, syp + 2.5, tile - 5, tile - 5);
  }

  /* ---------------- dynamic render ---------------- */
  function render() {
    if (!grid) return;
    var t = tile;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, GW * t, GH * t);

    // screen shake
    if (G.shake > 0) {
      var s = G.shake * 8;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    // static maze (draw mazeCanvas at natural size in css px)
    ctx.drawImage(mazeCanvas, 0, 0, GW * t, GH * t);

    drawDoor(t);
    drawKey(t);

    // particles
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = 1 - p.t / p.life;
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * t, p.y * t, p.r * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ghosts
    for (var ig = 0; ig < ghosts.length; ig++) drawGhost(ghosts[ig], t);

    // player
    drawPlayer(t);

    // fog
    drawFog(t);

    // objective beacons above the fog (key + door)
    drawBeacons(t);

    ctx.restore();
  }

  function drawKey(t) {
    if (!key || G.hasKey) return;
    var cx = (key.x + 0.5) * t, cy = (key.y + 0.5) * t + Math.sin(G.time * 3) * t * 0.08;
    var pulse = 0.75 + Math.sin(G.time * 4) * 0.25;
    ctx.save();
    ctx.shadowColor = '#fbbf24';
    ctx.shadowBlur = 14 * pulse;
    ctx.strokeStyle = '#fde68a';
    ctx.fillStyle = '#fbbf24';
    ctx.lineWidth = Math.max(2, t * 0.09);
    // bow
    ctx.beginPath();
    ctx.arc(cx - t * 0.12, cy, t * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    // shaft
    ctx.beginPath();
    ctx.moveTo(cx - t * 0.05, cy + t * 0.12);
    ctx.lineTo(cx + t * 0.3, cy + t * 0.05);
    ctx.stroke();
    // teeth
    ctx.beginPath();
    ctx.moveTo(cx + t * 0.18, cy + t * 0.07);
    ctx.lineTo(cx + t * 0.16, cy + t * 0.22);
    ctx.moveTo(cx + t * 0.28, cy + t * 0.05);
    ctx.lineTo(cx + t * 0.26, cy + t * 0.2);
    ctx.stroke();
    ctx.restore();
  }

  function drawDoor(t) {
    if (!door) return;
    var x = door.x * t, y = door.y * t;
    var open = G.hasKey;
    ctx.save();
    // frame
    ctx.fillStyle = '#3b2a6b';
    rrect(ctx, x + t * 0.08, y + t * 0.04, t * 0.84, t * 0.92, t * 0.16, true, false);
    // inner
    var grad = ctx.createLinearGradient(x, y, x, y + t);
    if (open) {
      grad.addColorStop(0, '#67e8f9'); grad.addColorStop(1, '#34d399');
      ctx.globalAlpha = 0.8 + Math.sin(G.time * 6) * 0.15;
    } else {
      grad.addColorStop(0, '#4c1d95'); grad.addColorStop(1, '#2e1065');
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = grad;
    ctx.shadowColor = open ? '#34d399' : '#a78bfa';
    ctx.shadowBlur = open ? 18 : 8 + Math.sin(G.time * 2) * 3;
    rrect(ctx, x + t * 0.18, y + t * 0.12, t * 0.64, t * 0.8, t * 0.12, true, false);
    ctx.globalAlpha = 1;
    // keyhole
    ctx.fillStyle = open ? '#0f172a' : '#e9d5ff';
    var kx = x + t * 0.5, ky = y + t * 0.5;
    ctx.beginPath();
    ctx.arc(kx, ky - t * 0.05, t * 0.09, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(kx - t * 0.05, ky);
    ctx.lineTo(kx + t * 0.05, ky);
    ctx.lineTo(kx, ky + t * 0.16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer(t) {
    if (G.invuln > 0 && Math.floor(G.time * 12) % 2 === 0 && G.state === 'playing') return;
    var cx = player.x * t, cy = player.y * t, r = player.r * t;
    ctx.save();
    ctx.shadowColor = '#67e8f9';
    ctx.shadowBlur = 16;
    var g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    g.addColorStop(0, '#cffafe');
    g.addColorStop(1, '#06b6d4');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // eyes: track the movement direction (normalized), spread perpendicular
    ctx.fillStyle = '#083344';
    var fl = Math.hypot(player.face.x, player.face.y) || 1;
    var nx = player.face.x / fl, ny = player.face.y / fl;
    var perpX = -ny, perpY = nx;
    var fwd = r * 0.34, side = r * 0.2;
    ctx.beginPath();
    ctx.arc(cx + nx * fwd + perpX * side, cy + ny * fwd + perpY * side - r * 0.08, r * 0.14, 0, Math.PI * 2);
    ctx.arc(cx + nx * fwd - perpX * side, cy + ny * fwd - perpY * side - r * 0.08, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGhost(g, t) {
    var cx = (g.px !== undefined ? g.px : g.cx + 0.5) * t;
    var cy = (g.py !== undefined ? g.py : g.cy + 0.5) * t;
    var r = t * 0.38;
    var bob = Math.sin(G.time * 5 + g.seed) * t * 0.04;
    var frozen = G.ghostFreeze > 0;
    ctx.save();
    if (frozen) ctx.globalAlpha = 0.45;
    ctx.shadowColor = g.color;
    ctx.shadowBlur = 12;
    ctx.fillStyle = g.color;
    ctx.beginPath();
    ctx.arc(cx, cy + bob - r * 0.1, r, Math.PI, 0);
    ctx.lineTo(cx + r, cy + bob + r * 0.55);
    // wavy skirt
    var waves = 3, wSeg = (r * 2) / waves;
    for (var i = 0; i < waves; i++) {
      var x1 = cx + r - wSeg * i - wSeg / 2;
      var dip = (i % 2 === 0) ? r * 0.85 : r * 0.55;
      ctx.quadraticCurveTo(x1, cy + bob + dip, x1 - wSeg / 2, cy + bob + r * 0.55);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // eyes
    ctx.fillStyle = '#0b0e22';
    var ex = (g.dir ? g.dir[0] : 0) * r * 0.22, ey = (g.dir ? g.dir[1] : 0) * r * 0.22;
    ctx.beginPath();
    ctx.arc(cx - r * 0.35 + ex, cy + bob - r * 0.15 + ey, r * 0.18, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.35 + ex, cy + bob - r * 0.15 + ey, r * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFog(t) {
    if (cfg.fogR === Infinity) return;
    var f = fogCanvas.getContext('2d');
    f.setTransform(dpr, 0, 0, dpr, 0, 0);
    f.clearRect(0, 0, GW * t, GH * t);
    f.fillStyle = 'rgba(3, 4, 14, ' + (cfg.fogAlpha || 0.97) + ')';
    f.fillRect(0, 0, GW * t, GH * t);
    f.globalCompositeOperation = 'destination-out';

    // player light
    var fx = player.x * t, fy = player.y * t;
    var r = cfg.fogR * t;
    var grad = f.createRadialGradient(fx, fy, 0, fx, fy, r);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.95)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    f.fillStyle = grad;
    f.beginPath();
    f.arc(fx, fy, r, 0, Math.PI * 2);
    f.fill();
    f.globalCompositeOperation = 'source-over';

    ctx.drawImage(fogCanvas, 0, 0, GW * t, GH * t);
  }

  /**
   * Objective beacons, drawn ON TOP of the fog: a pulsing gold halo marks
   * the key and a cyan/violet glow marks the door, so even in near-total
   * darkness you always have a visible goal to walk toward. The maze
   * between the beacons stays pitch dark — you must navigate it.
   */
  function drawBeacons(t) {
    if (cfg.fogR === Infinity) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (!G.hasKey && key) {
      var kx = (key.x + 0.5) * t, ky = (key.y + 0.5) * t;
      var pulse = 0.7 + Math.sin(G.time * 3) * 0.3;
      var rr = t * 2.1;
      var kg = ctx.createRadialGradient(kx, ky, 0, kx, ky, rr);
      kg.addColorStop(0, 'rgba(254, 230, 100, ' + (0.8 + 0.15 * pulse).toFixed(3) + ')');
      kg.addColorStop(0.4, 'rgba(251, 191, 36, ' + (0.3 + 0.08 * pulse).toFixed(3) + ')');
      kg.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = kg;
      ctx.beginPath(); ctx.arc(kx, ky, rr, 0, Math.PI * 2); ctx.fill();
      // bright key glyph dot
      ctx.fillStyle = 'rgba(253, 224, 71, ' + (0.8 + 0.15 * pulse).toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(kx, ky, t * 0.16 + t * 0.06 * pulse, 0, Math.PI * 2); ctx.fill();
    }
    if (door) {
      var dx3 = (door.x + 0.5) * t, dy3 = (door.y + 0.5) * t;
      var rr2 = t * 2.5;
      var dg = ctx.createRadialGradient(dx3, dy3, 0, dx3, dy3, rr2);
      var a = G.hasKey ? 0.6 : 0.34;
      dg.addColorStop(0, 'rgba(' + (G.hasKey ? '52, 211, 153' : '167, 139, 250') + ', ' + a + ')');
      dg.addColorStop(1, 'rgba(103, 232, 249, 0)');
      ctx.fillStyle = dg;
      ctx.beginPath(); ctx.arc(dx3, dy3, rr2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function rrect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
    if (arguments[6] !== false) c.fill();
  }

  /* ---------------- HUD / UI ---------------- */
  function hudTick() {
    hudLevel.textContent = G.level;
    var pct = clamp(G.timer / G.timeMax, 0, 1) * 100;
    timefill.style.width = pct + '%';
    timefill.classList.toggle('warn', pct < 28);
    var secs = Math.max(0, Math.ceil(G.timer));
    hudTime.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
    hudTime.classList.toggle('warn', pct < 28);
    var hearts = '';
    for (var i = 0; i < Math.max(G.lives, 1); i++) hearts += i < G.lives ? '♥' : '♡';
    hudLives.textContent = hearts || '—';
  }

  var toastTimer = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }

  var bannerTimer = null;
  function banner(msg, sub) {
    bannerEl.innerHTML = msg + (sub ? '<span class="sub">' + sub + '</span>' : '');
    bannerEl.classList.remove('show');
    void bannerEl.offsetWidth;
    bannerEl.classList.add('show');
    clearTimeout(bannerTimer);
  }

  /* ---------------- input ---------------- */
  var keyMap = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };

  window.addEventListener('keydown', function (e) {
    Sound.ensure();
    if (keyMap[e.code]) {
      held[keyMap[e.code]] = true;
      e.preventDefault();
    }
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') {
      Sound.on = !Sound.on;
      btnMute.textContent = Sound.on ? '🔊' : '🔇';
      toast(Sound.on ? 'sound on' : 'sound off');
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      if (G.state === 'menu' || G.state === 'gameover') { startRun(); e.preventDefault(); }
      else if (G.state === 'paused') { togglePause(); e.preventDefault(); }
    }
  });

  window.addEventListener('keyup', function (e) {
    if (keyMap[e.code]) held[keyMap[e.code]] = false;
  });

  // dpad (touch)
  if ('ontouchstart' in window || navigator.maxTouchPoints > 0) dpad.classList.add('show');
  dpad.addEventListener('pointerdown', function (e) {
    var dir = e.target.getAttribute && e.target.getAttribute('data-dir');
    if (dir) { held[dir] = true; e.preventDefault(); }
  });
  function releaseDirs() { held.up = held.down = held.left = held.right = false; }
  dpad.addEventListener('pointerup', releaseDirs);
  dpad.addEventListener('pointercancel', releaseDirs);
  dpad.addEventListener('pointerleave', releaseDirs);

  btnPause.addEventListener('click', function () { Sound.ensure(); if (G.state === 'playing' || G.state === 'paused') togglePause(); });
  btnMute.addEventListener('click', function () {
    Sound.ensure();
    Sound.on = !Sound.on;
    btnMute.textContent = Sound.on ? '🔊' : '🔇';
  });

  window.addEventListener('resize', function () { if (grid) layout(); });

  window.addEventListener('blur', function () {
    releaseDirs();
    if (G.state === 'playing') togglePause();
  });

  /* ---------------- main loop ---------------- */
  var lastT = 0;
  function frame(ts) {
    var dt = Math.min(0.05, (ts - lastT) / 1000 || 0);
    lastT = ts;
    update(dt);
    if (grid) { hudTick(); render(); }
    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */
  buildLevel(1);
  G.state = 'menu';
  showMenu();
  requestAnimationFrame(frame);

  /* ---------------- test hooks (read-only, used by headless sim) ---------------- */
  window.Labirinto = {
    getState: function () { return { state: G.state, level: G.level, lives: G.lives, hasKey: G.hasKey, timer: G.timer, timeMax: G.timeMax, invuln: G.invuln }; },
    getGrid: function () { return grid; },
    getDoor: function () { return door; },
    getKey: function () { return key; },
    getPlayer: function () { return player; },
    getGhosts: function () { return ghosts; },
    getHeld: function () { return { up: held.up, down: held.down, left: held.left, right: held.right }; }
  };
})();