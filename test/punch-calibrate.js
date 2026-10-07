// Measure effect of punching random extra wall-openings on path lengths.
const M = require('../js/maze.js');

function punch(g, frac, rand) {
  rand = rand || Math.random;
  const H = g.length, W = g[0].length;
  const cands = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++)
      if (g[y][x] === 1) {
        // horizontal corridor wall between two open cells
        if (g[y][x - 1] === 0 && g[y][x + 1] === 0) cands.push([x, y]);
        else if (g[y - 1][x] === 0 && g[y + 1][x] === 0) cands.push([x, y]);
      }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    const t = cands[i]; cands[i] = cands[j]; cands[j] = t;
  }
  const n = Math.round(cands.length * frac);
  for (let i = 0; i < n; i++) g[cands[i][1]][cands[i][0]] = 0;
  return g;
}

function stats(cells, frac, runs) {
  const doors = [], routes = [], opens = [];
  for (let r = 0; r < runs; r++) {
    const g = M.generate(cells, cells, Math.random);
    punch(g, frac);
    const W = g[0].length;
    const dS = M.distField(g, 1, 1);
    const door = M.farthestFrom(g, dS);
    const dD = M.distField(g, door.x, door.y);
    const key = M.farthestFrom(g, dD);
    // key must not BE the door; farthestFrom excludes nothing, but door itself yields dD=0, can't be max
    let open = 0, reach = 0;
    for (let y = 0; y < g.length; y++)
      for (let x = 0; x < W; x++)
        if (g[y][x] === 0) { open++; if (dS[y * W + x] >= 0) reach++; }
    if (open !== reach) { console.log('UNREACHABLE'); process.exit(1); }
    doors.push(door.d);
    routes.push(dS[key.y * W + key.x] + dD[key.y * W + key.x]);
    opens.push(open);
  }
  const med = a => a[Math.floor(a.length / 2)];
  console.log(`cells=${String(cells).padStart(2)} punch=${frac.toFixed(2)}  doorDist p50=${med(doors)}  route(start->key->door) p50=${med(routes)}  open p50=${med(opens)}`);
}

for (const f of [0, 0.08, 0.15, 0.3, 0.5]) stats(9, f, 50);
for (const f of [0, 0.08, 0.15, 0.3, 0.5]) stats(13, f, 50);
for (const f of [0, 0.08, 0.15, 0.3, 0.5]) stats(17, f, 50);
for (const f of [0, 0.08, 0.15, 0.3, 0.5]) stats(21, f, 50);