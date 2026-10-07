# LABIRINTO 🔑

A browser maze-escape game. Descend into an endless labyrinth: find the hidden
key, unlock the far door, and get out before the clock (or the ghosts) stop you.
Every level gets harder.

**LIVE: https://ohmymatts.github.io/labirinto/** (GitHub Pages)

No build step, no dependencies, no server required — pure HTML/CSS/JS.

## Play

Open `index.html` in any modern browser (double-click it, or serve the folder
with any static server, e.g. `npx serve` or `python -m http.server`).

### PWA (installable + offline)

The game is a full PWA: `manifest.webmanifest` + `sw.js` + generated icons —
open it over HTTPS (or localhost) and the browser offers **Install app**;
afterwards it runs fullscreen and **offline** (all assets cached).
For packaging as an Android app and publishing on **Google Play**, see
**docs/play-store.md** (TWA route: PWABuilder or Bubblewrap, asset links,
Play Console checklist).

## Controls

| Input | Action |
|---|---|
| `WASD` / Arrow keys | Move |
| `P` or `Esc` | Pause / resume |
| `M` | Mute / unmute |
| Touch devices | On-screen d-pad appears automatically |

## Rules

- **🔑 Key** — hidden deep in the maze (never near the start). In dark
  levels a pulsing gold beacon marks it, visible only through the dark.
- **🚪 Door** — far from your start; a cyan/violet beacon marks it too.
  Only opens while you carry the key.
- **♥ Lives** — ghosts and the clock cost one each. 3 lives, bonus life every
  3rd level you clear (up to 4). Lives gone = run over; best level is saved.

## How it gets harder

Each level `N` tunes several dials:

0. **Random spawn** — every level starts at a random open cell (the cyan
   start pad marks it), and the door is the farthest cell from there;
   the eyes track where the character is moving.
1. **Maze grows** — 9×9 cells at level 1 up to 21×21, plus fewer punched
   shortcuts, so corridors twist more.
2. **Fog of war** — your light appears at level 2 and keeps shrinking while
   the hidden area goes nearly pitch black (the key and door beacons stay
   visible — the dark is between you and them).
3. **Ghosts** — appear at level 3, up to 5 of them; they get faster and
   switch from wandering to hunting (pathfinding) when you're close.
4. **Looser clock** — the timer is derived from the optimal route
   (start → key → door), guaranteed beatable, with a generous margin
   (~2.5–2.8× the optimal route). The HUD shows the digital clock.

## Project layout

```
index.html        page shell + HUD (+ PWA wiring)
styles.css        neon-arcade look
manifest.webmanifest  PWA identity (installable app)
sw.js             offline cache service worker
icons/            app icons (generated, see tools/)
js/maze.js        maze generation (recursive backtracker), wall punching, BFS
js/game.js        game loop, entities, fog, particles, audio, HUD
tools/            icon generator + preview (pure node, no image libs)
docs/             Play Store publishing kit + privacy policy template
test/             node smoke tests
  maze.test.js    generation reachability + route/timer sanity
  punch-calibrate.js  prints route-length stats vs wall-punch fraction
  simulate.js     headless end-to-end playthrough: boots the real game with
                  stubbed DOM, drives an AI walker through several levels
  browser.test.js real-browser e2e: headless Chrome + playwright-core, an AI
                  walker plays via real KeyboardEvents; screenshots key
                  moments (needs Chrome; connect with CDP_URL env var)
  visual.test.js  pixel verification of the e2e screenshots (pure-Node PNG
                  decoder: HUD, walls, fog gradient, player, ghosts, menu)
  http-server.js  tiny static server for PWA/e2e testing over localhost
  debug-lum.js    scanline luminance dumps for debugging shots
```

Run the tests with:

```
node test/maze.test.js
node test/simulate.js
# browser test (one-time: npm.cmd install; needs local Chrome):
#   start: chrome.exe --headless=new --remote-debugging-port=9222 --user-data-dir=.chrome-profile file:///D:/labirinto/index.html
$env:CDP_URL = 'http://127.0.0.1:9222'; node test/browser.test.js
node test/visual.test.js
```

`package.json` / `node_modules` are dev-only (playwright-core for the browser
test); the game itself has zero dependencies.

## Dev notes

`js/game.js` exposes a read-only `window.Labirinto` hook (state, grid, entity
positions) used by the headless simulation; it's harmless in production but
can also be used from the devtools console to inspect a live game.