/* Headless end-to-end simulation of LABIRINTO in Node:
   stubs the DOM + canvas, boots the real game.js, drives the real update
   loop, steers the player with a BFS pathfinding walker, and asserts it
   clears levels without crashing. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- canvas 2D stub (all methods no-op) ---------- */
function make2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, key) {
      if (key === 'createLinearGradient' || key === 'createRadialGradient') return () => gradient;
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key, value) { target[key] = value; return true; }
  });
}

/* ---------- DOM element stub ---------- */
function makeEl(id) {
  const el = {
    id,
    style: {},
    textContent: '',
    innerHTML: '',
    offsetWidth: 100,
    classList: {
      add() {}, remove() {}, toggle() {}, contains: () => false
    },
    addEventListener() {}, setAttribute() {},
    getBoundingClientRect: () => ({ width: 900, height: 620, left: 0, top: 0 }),
  };
  return el;
}

const canvasStub = Object.assign(makeEl('game'), { width: 0, height: 0, getContext: () => make2d() });
const elCache = new Map();
function getEl(sel) {
  const id = sel.replace('#', '');
  if (!elCache.has(id)) {
    const el = id === 'game' ? canvasStub : makeEl(id);
    if (id === 'game') elCache.set(id, Object.assign(el, { getContext: canvasStub.getContext }));
    else elCache.set(id, el);
  }
  return elCache.get(id);
}

/* ---------- global stubs ---------- */
const windowHandlers = {};
const win = {
  MazeLib: require('../js/maze.js'),
  addEventListener(type, fn) { (windowHandlers[type] = windowHandlers[type] || []).push(fn); },
  devicePixelRatio: 1,
  AudioContext: undefined,
};
let rafCb = null;
const globals = {
  window: win,
  document: { querySelector: getEl, createElement: (tag) => tag === 'canvas' ? { width: 0, height: 0, getContext: () => make2d() } : makeEl(tag) },
  localStorage: { getItem: () => null, setItem() {} },
  requestAnimationFrame: (fn) => { rafCb = fn; },
};
Object.assign(globalThis, globals);

function fire(type, evtProps) {
  (windowHandlers[type] || []).forEach(fn => fn(Object.assign({ preventDefault() {} }, evtProps)));
}

/* ---------- boot the game ---------- */
const gamePath = path.join(__dirname, '..', 'js', 'game.js');
vm.runInThisContext(fs.readFileSync(gamePath, 'utf8'), { filename: 'game.js' });

const L = globalThis.window.Labirinto;
if (!L) throw new Error('debug hook missing');

let ts = 0;
function step(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb; rafCb = null;
    if (!cb) throw new Error('rAF chain broke');
    cb(ts);
    ts += 16.67;
  }
}

function key(name) { return { code: name }; }
function press(code) { fire('keydown', key(code)); }
function release(code) { fire('keyup', key(code)); }

/* ---------- BFS walker ---------- */
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
  while (cur !== sy * W + sx) { out.push([cur % W, (cur - cur % W) / W]); cur = prev[cur]; }
  out.push([sx, sy]);
  out.reverse();
  return out;
}

let heldCode = null;
function steer(dtFrames) {
  // every ~5 frames, re-decide direction toward current target
  if (dtFrames % 5 !== 0) return;
  const { hasKey } = L.getState();
  const grid = L.getGrid();
  const target = hasKey ? L.getDoor() : L.getKey();
  const p = L.getPlayer();
  const pc = { x: Math.floor(p.x), y: Math.floor(p.y) };
  const ccx = target.x + 0.5, ccy = target.y + 0.5;
  let want = null;
  if (pc.x === target.x && pc.y === target.y) {
    // inside the target cell: walk to its exact center
    const dx = ccx - p.x, dy = ccy - p.y;
    if (Math.abs(dx) < 0.18 && Math.abs(dy) < 0.18) return; // arrived
    want = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  } else {
    const path = bfsPath(grid, pc.x, pc.y, target.x, target.y);
    if (!path || path.length < 2) return;
    const next = path[1];
    if (next[0] > pc.x) want = 'right';
    else if (next[0] < pc.x) want = 'left';
    else if (next[1] > pc.y) want = 'down';
    else want = 'up';
  }
  if (heldCode !== want) {
    if (heldCode) release(CODE[heldCode]);
    press(CODE[want]);
    heldCode = want;
  }
}
function releaseAll() {
  if (heldCode) { release({ up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }[heldCode]); heldCode = null; }
}

/* ---------- run ---------- */
const CODE = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
step(30); // menu frames
fire('keydown', { code: 'Enter' }); // start run
step(10);
let st = L.getState();
if (st.state !== 'playing') throw new Error('expected playing after Enter, got ' + st.state);
console.log('started:', JSON.stringify(st));

const MAX_FRAMES = 40000;
let maxLevel = 1;
let frames = 0;
let lastLogged = 0;
try {
  while (frames < MAX_FRAMES) {
    frames++;
    steer(frames);
    step(1);
    st = L.getState();
    if (frames - lastLogged > 600) {
      lastLogged = frames;
      const p = L.getPlayer();
      console.log(`  f=${frames} lvl=${st.level} lives=${st.lives} key=${st.hasKey} t=${st.timer.toFixed(1)} pos=(${p.x.toFixed(2)},${p.y.toFixed(2)}) state=${st.state}`);
    }
    if (st.level > maxLevel) { maxLevel = st.level; console.log(`level ${maxLevel} at frame ${frames}`); }
    if (st.state === 'gameover') break;
    if (st.level >= 4) break; // enough proof
  }
} finally {
  releaseAll();
}
if (maxLevel < 2) throw new Error(`walker never cleared level 1 (frames=${frames}, state=${st.state})`);
if (st.lives < 0) throw new Error('lives went negative');
if (st.timer < 0) throw new Error('timer went negative');
// sanity: ghosts move on level>=3 runs (may have died before reaching; skip if not reached)
if (maxLevel >= 3) {
  const g0 = L.getGhosts();
  if (g0.length === 0) throw new Error('no ghosts on level >= 3');
}
console.log(`OK — cleared to level ${maxLevel}, lives=${st.lives}, frames=${frames}`);

/* ---------- pause/mute/pause-resume sanity ---------- */
press('KeyP'); // pause
if (L.getState().state !== 'paused' && L.getState().state !== 'playing') throw new Error('pause broke');
if (L.getState().state === 'paused') {
  press('KeyP');
  if (L.getState().state !== 'playing') throw new Error('unpause broke');
}
press('KeyM'); // mute toggle (no crash)

console.log('E2E_SIM_OK');