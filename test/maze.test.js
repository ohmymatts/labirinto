// Node smoke-test for js/maze.js: generation, braid, reachability, BFS.
const M = require('../js/maze.js');

function verify(lvl) {
  const cells = Math.min(9 + (lvl - 1) * 2, 21);
  const punch = Math.max(0.12, 0.34 - lvl * 0.012);
  for (let run = 0; run < 10; run++) {
    const g = M.generate(cells, cells, Math.random);
    M.punch(g, punch, Math.random);
    const W = g[0].length, H = g.length;
    if (W !== cells * 2 + 1 || H !== cells * 2 + 1) return `size wrong ${W}x${H}`;

    // RANDOM START anywhere in the open maze (mirrors game.js buildLevel)
    const open0 = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === 0) open0.push([x, y]);
    const sp = open0[(Math.random() * open0.length) | 0];
    const dfS = M.distField(g, sp[0], sp[1]);
    let reach = 0, open = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (g[y][x] === 0) { open++; if (dfS[y * W + x] >= 0) reach++; }
    if (reach !== open) return `unreachable cells (reach=${reach} open=${open})`;

    const door = M.farthestFrom(g, dfS);
    if (door.x < 0 || door.d < 0) return 'door placement failed';
    if (door.d < 8) return `door too close to random start (d=${door.d})`;

    // key placement: deep in the maze (never near start), longest route
    const dfd = M.distField(g, door.x, door.y);
    const deepMin = Math.max(6, Math.round(door.d * 0.25));
    let key = null, kBest = -1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (g[y][x] === 0 && x !== door.x && y !== door.y) {
          const a = dfS[y * W + x], b = dfd[y * W + x];
          if (a >= deepMin && a + b > kBest) { kBest = a + b; key = { x, y, ds: a, dd: b, route: a + b }; }
        }
    if (!key) return 'key placement failed';
    if (key.ds < deepMin) return `key not deep: ds=${key.ds} < ${deepMin}`;
    const speed = Math.min(6, 4.4 + lvl * 0.06);
    const eff = Math.min(0.4, 0.36 + lvl * 0.004);
    const time = Math.max(20, Math.round(key.route / (speed * eff)));
    if (run === 0) {
      console.log(`lvl ${lvl}: maze ${W}x${H}, door=${door.d}, key route=${key.route} (deep ds=${key.ds}), timer=${time}s`);
    }
    // timer must leave a generous margin over the optimal route
    if (time * speed < key.route * 2.45) return `timer too tight: time=${time} route=${key.route}`;
  }
  return null;
}

for (const l of [1, 2, 3, 5, 12, 20, 40]) {
  const err = verify(l);
  if (err) { console.log('FAIL', l, err); process.exit(1); }
}
console.log('MAZE_LOGIC_OK');