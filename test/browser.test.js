/* Real-browser end-to-end test for LABIRINTO.
   Boots the actual game in headless Chrome, injects a BFS pathfinding
   walker that plays via real KeyboardEvents, screenshots key moments,
   and asserts gameplay progress + absence of page errors.

   Launching Chrome from inside Node hits the sandbox pipe-EPERM boundary,
   so this script EXPECTS an already-running Chrome started by pwsh with
   --remote-debugging-port (CDP over TCP) and passed via CDP_URL env var. */
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const CDP_URL = process.env.CDP_URL;
const URL = process.env.GAME_URL || 'file:///D:/labirinto/index.html';
const IS_HTTP = /^https?:/.test(URL);
const SHOTS = path.join(__dirname, 'screens');
const VIEW = { width: 1280, height: 820 };

function log(...a) { console.log(...a); }
async function shot(page, name) {
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p });
  log('  📸', name);
}

(async () => {
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  const resp = await fetch(CDP_URL + '/json/version');
  const ws = resp.webSocketDebuggerUrl || (await resp.json()).webSocketDebuggerUrl;
  log('connecting via CDP:', CDP_URL);
  const browser = await chromium.connectOverCDP(ws.startsWith('ws') ? ws : CDP_URL);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.setViewportSize(VIEW);

  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push('console.error: ' + m.text());
  });

  await page.goto(URL);
  // file:// same-URL navigation may not reload — force a real reload so any
  // stale intervals/walkers from previous tests are wiped with the context
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await shot(page, '01-menu');

  // ---- inject the walker ----
  await page.evaluate(() => {
    if (window.__walkerTick) { clearInterval(window.__walkerTick); window.__walkerTick = null; }
    if (window.__walker) return;
    window.__walker = true;
    const L = window.Labirinto;
    if (!L) throw new Error('Labirinto hook missing');
    const held = new Set();
    const ev = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    const press = (c) => { if (!held.has(c)) { held.add(c); ev('keydown', c); } };
    const release = (c) => { if (held.has(c)) { held.delete(c); ev('keyup', c); } };
    const all = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

    function bfsPath(grid, sx, sy, tx, ty) {
      const H = grid.length, W = grid[0].length;
      const prev = new Int32Array(W * H).fill(-1);
      const q = [sy * W + sx]; prev[sy * W + sx] = sy * W + sx;
      while (q.length) {
        const c = q.shift();
        const x = c % W, y = (c - x) / W;
        if (x === tx && y === ty) break;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H || grid[ny][nx] !== 0) continue;
          const idx = ny * W + nx;
          if (prev[idx] !== -1) continue;
          prev[idx] = c; q.push(idx);
        }
      }
      const out = [];
      let cur = ty * W + tx;
      if (prev[cur] === -1) return null;
      while (cur !== sy * W + sx) { out.push([cur % W, Math.floor(cur / W)]); cur = prev[cur]; }
      out.push([sx, sy]);
      out.reverse();
      return out;
    }

    window.__walkerTick = setInterval(() => {
      const s = L.getState();
      if (s.state === 'menu' || s.state === 'gameover') {
        Object.values(all).forEach(release); held.clear();
        ev('keydown', 'Enter'); ev('keyup', 'Enter');
        return;
      }
      if (s.state !== 'playing') return;
      const target = s.hasKey ? L.getDoor() : L.getKey();
      const p = L.getPlayer();
      const pc = { x: Math.floor(p.x), y: Math.floor(p.y) };
      const ccx = target.x + 0.5, ccy = target.y + 0.5;
      let want = null;
      if (pc.x === target.x && pc.y === target.y) {
        const dx = ccx - p.x, dy = ccy - p.y;
        if (Math.abs(dx) < 0.18 && Math.abs(dy) < 0.18) { Object.values(all).forEach(release); held.clear(); return; }
        want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      } else {
        const path = bfsPath(L.getGrid(), pc.x, pc.y, target.x, target.y);
        if (!path || path.length < 2) { Object.values(all).forEach(release); held.clear(); return; }
        const next = path[1];
        if (next[0] > pc.x) want = 'right';
        else if (next[0] < pc.x) want = 'left';
        else if (next[1] > pc.y) want = 'down';
        else want = 'up';
      }
      // hold the wanted key, release the rest
      Object.entries(all).forEach(([k, code]) => {
        if (k === want) press(code); else release(code);
      });
    }, 50);
  });

  // ---- poll & snapshot ----
  const assert = (cond, msg) => { if (!cond) throw new Error('ASSERT FAILED: ' + msg); };
  const deadline = Date.now() + 180000;
  let lastLevel = 0, sawKey = false, maxLevel = 0, deathCount = 0, lastLives = 3, ghostShot = false, beaconShot = false;
  let prevP = null, faceOk = 0, faceBad = 0, faceRace = 0, prevLevelForFace = 0;
  let lastHeldDir = null;
  const eyeDirPending = new Set(['up', 'down', 'left', 'right']);
  const trace = [];
  while (Date.now() < deadline) {
    await page.waitForTimeout(200);
    const s = await page.evaluate(() => {
      const L = window.Labirinto;
      return { ...L.getState(), ghosts: L.getGhosts().length };
    });
    trace.push({ t: Date.now(), ...s });

    // eye-direction tracking (intent semantics: eyes follow the held keys,
    // matching the cornering assist that slides the player while turning).
    // Teleports (level reset / respawn) are exempt — no key explains them.
    const pd = await page.evaluate(() => {
      const L = window.Labirinto;
      const p = L.getPlayer();
      return { x: p.x, y: p.y, fx: p.face.x, fy: p.face.y, held: L.getHeld() };
    });
    if (prevP && s.level === prevLevelForFace && s.state === 'playing') {
      const dpx = pd.x - prevP.x, dpy = pd.y - prevP.y;
      const teleported = Math.abs(dpx) > 1.5 || Math.abs(dpy) > 1.5;
      const h = pd.held;
      const dxi = (h.right ? 1 : 0) - (h.left ? 1 : 0);
      const dyi = (h.down ? 1 : 0) - (h.up ? 1 : 0);
      if (!teleported && (dxi || dyi)) {
        const expX = dxi !== 0 ? Math.sign(dxi) : 0;
        const expY = dyi !== 0 ? Math.sign(dyi) : 0;
        if (pd.fx === expX && pd.fy === expY) faceOk++;
        else {
          // keypress may have raced a frame — confirm after a settle
          await page.waitForTimeout(40);
          const pd2 = await page.evaluate(() => {
            const L = window.Labirinto;
            const p = L.getPlayer();
            const h = L.getHeld();
            return { fx: p.face.x, fy: p.face.y, held: h };
          });
          const ex2x = (pd2.held.right ? 1 : 0) - (pd2.held.left ? 1 : 0);
          const ex2y = (pd2.held.down ? 1 : 0) - (pd2.held.up ? 1 : 0);
          const ok2 = pd2.fx === (ex2x !== 0 ? Math.sign(ex2x) : 0) && pd2.fy === (ex2y !== 0 ? Math.sign(ex2y) : 0) && (ex2x || ex2y);
          if (ok2) faceRace++; else faceBad++;
        }
      }
    }
    prevLevelForFace = s.level;
    prevP = pd;

    // zoomed eye-direction crops: one per direction, sampled while a single
    // key has been held for 2 consecutive polls (~0.4s), not blinking
    if (eyeDirPending.size > 0 && s.state === 'playing' && s.invuln <= 0) {
      const dirsHeld = ['up', 'down', 'left', 'right'].filter(d2 => pd.held[d2]);
      if (dirsHeld.length === 1 && lastHeldDir === dirsHeld[0] && eyeDirPending.has(dirsHeld[0])) {
        const dirKey = dirsHeld[0];
        const geo = await page.evaluate(() => {
          const cvs = document.querySelector('#game');
          const r = cvs.getBoundingClientRect();
          const L = window.Labirinto;
          const t = cvs.width / L.getGrid()[0].length;
          const p = L.getPlayer();
          const half2 = Math.max(30, Math.round(t * 2.2));
          const ox = Math.max(0, Math.round(r.left + p.x * t - half2));
          const oy = Math.max(0, Math.round(r.top + p.y * t - half2));
          return { cx: r.left + p.x * t, cy: r.top + p.y * t, origin: { x: ox, y: oy }, half: half2 };
        });
        const w = Math.min(geo.half * 2, VIEW.width - geo.origin.x), h2 = Math.min(geo.half * 2, VIEW.height - geo.origin.y);
        await page.screenshot({ path: path.join(SHOTS, 'eye-' + dirKey + '.png'), clip: { x: geo.origin.x, y: geo.origin.y, width: w, height: h2 } });
        // authoritative pupil measurement straight from the live canvas,
        // restarting across blink frames; pupils are near-black #083344.
        // Attribution uses the CURRENT face each attempt (the walker keeps
        // moving while retries happen); expected: pupils offset forward.
        const res = await page.evaluate(async (dirK) => {
          const L = window.Labirinto;
          const cvs = document.querySelector('#game');
          const t = cvs.width / L.getGrid()[0].length;
          const r = 0.32 * t;
          for (let attempt = 0; attempt < 7; attempt++) {
            const st = L.getState();
            if (st.invuln > 0) return { ok: false, reason: 'invuln blink at capture' };
            const p = L.getPlayer();
            const fx = p.face.x, fy = p.face.y;
            const fl = Math.hypot(fx, fy);
            if (!fl) { await new Promise(rs => setTimeout(rs, 110)); continue; }
            const nx = fx / fl, ny = fy / fl;
            const px = Math.round(p.x * t), py = Math.round(p.y * t);
            const R = Math.ceil(r * 0.95) + 1;
            const img = cvs.getContext('2d').getImageData(px - R, py - R, R * 2, R * 2);
            let sx = 0, sy = 0, n = 0;
            for (let yy = 0; yy < img.height; yy++) {
              for (let xx = 0; xx < img.width; xx++) {
                const i = (yy * img.width + xx) * 4;
                if (img.data[i] < 20 && img.data[i + 1] >= 40 && img.data[i + 1] <= 62 && img.data[i + 2] >= 60 && img.data[i + 2] <= 80) { sx += xx; sy += yy; n++; }
              }
            }
            if (n >= 6) {
              const gx = sx / n - R, gy = sy / n - R;
              return {
                ok: true, n, attempt,
                face: { x: fx, y: fy },
                along: gx * nx + gy * ny,
                lateral: Math.abs(gx * -ny + (gy + 0.08 * r) * nx), // -0.08r is the designed high-bias
                offset: { x: +gx.toFixed(1), y: +gy.toFixed(1) }, r: +r.toFixed(1), tile: +t.toFixed(1),
              };
            }
            await new Promise(rs => setTimeout(rs, 110)); // blink frame — retry
          }
          return { ok: false, reason: 'no pupil pixels after retries' };
        }, dirKey);
        const eyeDone = res.ok;
        fs.writeFileSync(path.join(SHOTS, 'eye-' + dirKey + '.json'), JSON.stringify({ dir: dirKey, result: res }));
        if (eyeDone) eyeDirPending.delete(dirKey);
        log('  👁 eye crop:', dirKey, JSON.stringify(res));
      }
      lastHeldDir = dirsHeld.length === 1 ? dirsHeld[0] : null;
    }

    if (s.hasKey) sawKey = true;
    if (s.lives < lastLives) { deathCount++; lastLives = s.lives; }
    if (s.lives > lastLives) lastLives = s.lives;
    if (s.level > maxLevel) {
      maxLevel = s.level;
      log(`level ${maxLevel} reached (lives=${s.lives}, ghosts=${s.ghosts}, key=${s.hasKey})`);
      if (maxLevel >= 2) { await page.waitForTimeout(400); await shot(page, `0${maxLevel}-level-banner`); }
      if (maxLevel === 1) await shot(page, '02-level1-start');
      await page.waitForTimeout(1500); // let the banner fade & ghosts roam before encounter hunting
    }
    if (s.level >= 2 && !beaconShot && !s.hasKey && s.state === 'playing') {
      // wait for the level banner to fade, then capture the key beacon visible
      // through near-total darkness (with pixel coords for the visual test)
      await page.waitForTimeout(2600);
      const s2 = await page.evaluate(() => window.Labirinto.getState());
      if (s2.state === 'playing' && !s2.hasKey) {
        beaconShot = true;
        const meta = await page.evaluate(() => {
          const cvs = document.querySelector('#game');
          const r = cvs.getBoundingClientRect();
          const L = window.Labirinto;
          const gw = L.getGrid()[0].length;
          const t = cvs.width / gw;
          const p = L.getPlayer();
          const a2px = (cx, cy) => ({ x: r.left + (cx + 0.5) * t, y: r.top + (cy + 0.5) * t });
          return {
            player: a2px(p.x - 0.5, p.y - 0.5),
            key: a2px(L.getKey().x, L.getKey().y),
            door: a2px(L.getDoor().x, L.getDoor().y),
            tile: t,
            fog: !!document.querySelector('#game'),
          };
        });
        fs.writeFileSync(path.join(SHOTS, 'key-beacon.json'), JSON.stringify(meta));
        await shot(page, 'key-beacon');
      }
    }
    if (s.level >= 3 && !ghostShot) {
      // test instrumentation: teleport a ghost 2-3 tiles from the player so
      // the encounter is guaranteed visible (ghost then chases for real)
      const placed = await page.evaluate(() => {
        const L = window.Labirinto;
        const g = L.getGhosts()[0];
        if (!g) return false;
        const grid = L.getGrid();
        const p = L.getPlayer();
        const pc = { x: Math.floor(p.x), y: Math.floor(p.y) };
        for (let r = 2; r <= 4; r++) {
          for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
            const nx = pc.x + dx, ny = pc.y + dy;
            if (nx > 0 && ny > 0 && nx < grid[0].length - 1 && ny < grid.length - 1 && grid[ny][nx] === 0) {
              g.cx = nx; g.cy = ny; g.fx = nx; g.fy = ny; g.nx = nx; g.ny = ny; g.t = 0;
              g.px = nx + 0.5; g.py = ny + 0.5;
              return true;
            }
          }
        }
        return false;
      });
      if (placed) {
        ghostShot = true;
        // screenshot immediately: the ghost sits mid-lerp at the teleport
        // spot; waiting would let the (blind) walker walk into it
        const meta = await page.evaluate(() => {
          const cvs = document.querySelector('#game');
          const r = cvs.getBoundingClientRect();
          const L = window.Labirinto;
          const gw = L.getGrid()[0].length;
          const t = cvs.width / gw;
          const p = L.getPlayer();
          const px = (v) => (v !== undefined ? v : null);
          return {
            player: { x: r.left + p.x * t, y: r.top + p.y * t },
            tile: t,
            ghosts: L.getGhosts().map(g => ({ x: r.left + (px(g.px) !== null ? g.px : g.cx + 0.5) * t, y: r.top + (px(g.py) !== null ? g.py : g.cy + 0.5) * t })),
          };
        });
        fs.writeFileSync(path.join(SHOTS, 'ghost-encounter.json'), JSON.stringify(meta));
        await shot(page, 'ghost-encounter');
      }
    }
    if (s.timer < 2 && s.state === 'playing') await shot(page, '99-time-pressure');

    if (maxLevel >= 4) break;
  }
  const finalState = await page.evaluate(() => {
    const s = window.Labirinto.getState();
    let best = null;
    try { best = localStorage.getItem('labirinto.best'); } catch (e) { }
    return { ...s, best, ghosts: window.Labirinto.getGhosts().length };
  });
  log('final:', JSON.stringify(finalState));
  await page.evaluate(() => { if (window.__walkerTick) clearInterval(window.__walkerTick); });

  await shot(page, '99-final');

  // ---- PWA checks (only meaningful over http(s); file:// skips) ----
  if (IS_HTTP) {
    const pwState = await page.evaluate(async () => {
      const regs = await navigator.serviceWorker.getRegistrations();
      const icons = await fetch('./icons/icon-512.png').then(r => r.status).catch(() => 0);
      const manifest = await fetch('./manifest.webmanifest').then(r => r.status).catch(() => 0);
      const link = !!document.querySelector('link[rel="manifest"]');
      return { sw: regs.length, icons, manifest, link };
    });
    log('PWA pre-reload:', JSON.stringify(pwState));
    // hard reload so the freshly-installed SW takes control of the page
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    const ctl = await page.evaluate(() => !!navigator.serviceWorker.controller);
    assert(pwState.sw >= 1, 'service worker not registered over http');
    assert(pwState.manifest === 200, 'manifest.webmanifest not reachable');
    assert(pwState.icons === 200 && pwState.link, 'manifest link/icons not wired');
    assert(ctl, 'page is not controlled by the service worker after reload');
    console.log('PWA_OK — service worker controls page; manifest served');
  }

  await browser.close();

  // ---- assertions ----
  assert(maxLevel >= 3, `AI walker should clear >= 3 levels (got ${maxLevel})`);
  assert(sawKey, 'key pickup was never observed');
  assert(finalState.lives >= 0 && finalState.lives <= 4, 'lives out of range');
  assert(maxLevel === finalState.level || maxLevel >= finalState.level, 'level went backwards');
  const fatal = problems.filter(p => !/favicon/i.test(p));
  assert(fatal.length === 0, 'page errors: ' + fatal.join(' | '));
  assert(faceOk + faceRace >= 8, `eye-direction check needs >= 8 clean samples (got ok=${faceOk} race=${faceRace})`);
  assert(faceBad === 0, `eyes not matching movement direction in ${faceBad} persisted samples (ok: ${faceOk}, frame-races: ${faceRace})`);

  console.log(`\nBROWSER_E2E_OK — reached level ${maxLevel}, deaths=${deathCount}, ghosts=${finalState.ghosts}, best=${finalState.best}, eyes ok=${faceOk} race=${faceRace} bad=${faceBad}, pageErrors=0`);
})().catch((e) => { console.error(e); console.log('BROWSER_E2E_FAIL'); process.exit(1); });