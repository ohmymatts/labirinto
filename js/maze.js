/* =========================================================================
   LABIRINTO — maze generation & graph helpers
   Grid convention: g[y][x] === 1 wall, 0 open. Dimensions are (2n+1)^2,
   corridors live on odd indices.
   ========================================================================= */
(function (root) {
  'use strict';

  /** Recursive-backtracker (perfect maze). rand: () -> [0,1) */
  function generate(cols, rows, rand) {
    rand = rand || Math.random;
    var W = cols * 2 + 1, H = rows * 2 + 1;
    var g = new Array(H);
    for (var y = 0; y < H; y++) {
      g[y] = new Array(W).fill(1);
    }
    var stack = [[1, 1]];
    g[1][1] = 0;
    var dirs = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    while (stack.length) {
      var x = stack[stack.length - 1][0];
      var y = stack[stack.length - 1][1];
      var opts = [];
      for (var i = 0; i < 4; i++) {
        var nx = x + dirs[i][0], ny = y + dirs[i][1];
        if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny][nx] === 1) opts.push([nx, ny]);
      }
      if (!opts.length) { stack.pop(); continue; }
      var p = opts[(rand() * opts.length) | 0];
      g[(y + p[1]) / 2][(x + p[0]) / 2] = 0; // knock the wall between
      g[p[1]][p[0]] = 0;
      stack.push(p);
    }
    return g;
  }

  /** Open some dead ends into loops (braiding). Fewer loops = harder. */
  function braid(grid, chance, rand) {
    rand = rand || Math.random;
    if (!(chance > 0)) return grid;
    var H = grid.length, W = grid[0].length;
    var n4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];
    var j4 = [[0, -2], [0, 2], [-2, 0], [2, 0]];
    for (var y = 1; y < H - 1; y += 2) {
      for (var x = 1; x < W - 1; x += 2) {
        var open = 0;
        for (var i = 0; i < 4; i++) if (grid[y + n4[i][1]][x + n4[i][0]] === 0) open++;
        if (open === 1 && rand() < chance) {
          var walls = [];
          for (var j = 0; j < 4; j++) {
            var nx = x + j4[j][0], ny = y + j4[j][1];
            if (nx <= 0 || ny <= 0 || nx >= W - 1 || ny >= H - 1) continue;
            if (grid[ny][nx] === 1 && grid[y + j4[j][1] / 2][x + j4[j][0] / 2] === 1) walls.push(j4[j]);
          }
          if (walls.length) {
            var w = walls[(rand() * walls.length) | 0];
            grid[y + w[1] / 2][x + w[0] / 2] = 0;
          }
        }
      }
    }
    return grid;
  }

  /**
   * Punch random extra openings through interior walls. Creates real
   * loops (not just dead-end openings), collapsing the pathological
   * "snake" path lengths of perfect mazes. frac = share of eligible
   * wall segments removed.
   */
  function punch(grid, frac, rand) {
    rand = rand || Math.random;
    if (!(frac > 0)) return grid;
    var H = grid.length, W = grid[0].length;
    var cands = [];
    for (var y = 1; y < H - 1; y++) {
      for (var x = 1; x < W - 1; x++) {
        if (grid[y][x] === 1) {
          if (grid[y][x - 1] === 0 && grid[y][x + 1] === 0) cands.push([x, y]);
          else if (grid[y - 1][x] === 0 && grid[y + 1][x] === 0) cands.push([x, y]);
        }
      }
    }
    // Fisher-Yates
    for (var i = cands.length - 1; i > 0; i--) {
      var j = (rand() * (i + 1)) | 0;
      var tmp = cands[i]; cands[i] = cands[j]; cands[j] = tmp;
    }
    var n = Math.round(cands.length * frac);
    for (var k = 0; k < n; k++) grid[cands[k][1]][cands[k][0]] = 0;
    return grid;
  }

  /** BFS distance field from (sx, sy). Int32Array indexed y*W+x, -1 = unreachable. */
  function distField(grid, sx, sy) {
    var H = grid.length, W = grid[0].length;
    var dist = new Int32Array(W * H).fill(-1);
    var q = new Int32Array(W * H);
    var qh = 0, qt = 0;
    dist[sy * W + sx] = 0;
    q[qt++] = sy * W + sx;
    while (qh < qt) {
      var c = q[qh++];
      var x = c % W, y = (c - x) / W;
      var d = dist[c] + 1;
      // right, left, down, up
      if (x + 1 < W && grid[y][x + 1] === 0 && dist[y * W + x + 1] === -1) { dist[y * W + x + 1] = d; q[qt++] = y * W + x + 1; }
      if (x - 1 >= 0 && grid[y][x - 1] === 0 && dist[y * W + x - 1] === -1) { dist[y * W + x - 1] = d; q[qt++] = y * W + x - 1; }
      if (y + 1 < H && grid[y + 1][x] === 0 && dist[(y + 1) * W + x] === -1) { dist[(y + 1) * W + x] = d; q[qt++] = (y + 1) * W + x; }
      if (y - 1 >= 0 && grid[y - 1][x] === 0 && dist[(y - 1) * W + x] === -1) { dist[(y - 1) * W + x] = d; q[qt++] = (y - 1) * W + x; }
    }
    return dist;
  }

  /** Farthest open cell from a distance field. */
  function farthestFrom(grid, dist) {
    var H = grid.length, W = grid[0].length;
    var best = -1, bx = -1, by = -1;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        if (grid[y][x] === 0) {
          var d = dist[y * W + x];
          if (d > best) { best = d; bx = x; by = y; }
        }
      }
    }
    return { x: bx, y: by, d: best };
  }

  /** Open 4-neighbours of a cell. */
  function neighborsOpen(grid, x, y) {
    var out = [];
    if (grid[y][x + 1] === 0) out.push([x + 1, y]);
    if (grid[y][x - 1] === 0) out.push([x - 1, y]);
    if (grid[y + 1] && grid[y + 1][x] === 0) out.push([x, y + 1]);
    if (grid[y - 1] && grid[y - 1][x] === 0) out.push([x, y - 1]);
    return out;
  }

  var api = {
    generate: generate,
    braid: braid,
    punch: punch,
    distField: distField,
    farthestFrom: farthestFrom,
    neighborsOpen: neighborsOpen
  };

  root.MazeLib = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);