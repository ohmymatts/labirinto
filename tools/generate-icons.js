/* Generates LABIRINTO PWA icons using a pure-Node PNG encoder (zlib + CRC32),
   drawing procedural art: dark gradient, maze pattern, glowing gold key.
   Outputs icons/icon-{192,512}.png and maskable variants. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('../js/maze.js');

const OUT = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- PNG encoder ---------- */
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = w * 4;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- painter ---------- */
function painter(size) {
  const buf = Buffer.alloc(size * size * 4);
  const px = (x, y, r, g, b, a) => {
    if (x < 0 || y < 0 || x >= size || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const alpha = Math.min(1, a);
    // source-over blend
    buf[i] = Math.round(buf[i] * (1 - alpha) + r * alpha);
    buf[i + 1] = Math.round(buf[i + 1] * (1 - alpha) + g * alpha);
    buf[i + 2] = Math.round(buf[i + 2] * (1 - alpha) + b * alpha);
    buf[i + 3] = 255;
  };
  const rect = (x, y, w, h, r, g, b, a) => {
    for (let yy = Math.round(y); yy < y + h; yy++) for (let xx = Math.round(x); xx < x + w; xx++) px(xx, yy, r, g, b, a);
  };
  const ring = (cx, cy, rad, thick, r, g, b, a) => {
    for (let y = Math.floor(cy - rad - thick); y <= cy + rad + thick; y++) {
      for (let x = Math.floor(cx - rad - thick); x <= cx + rad + thick; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rad + thick / 2 && d >= rad - thick / 2) px(x, y, r, g, b, a);
      }
    }
  };
  return { buf, px, rect, ring, fill: () => rect(0, 0, size, size, 5, 22, 255, 0) };
}

function drawIcon(scale, roundedCorners) {
  const S = 512;
  const P = painter(S);
  const T = (x, y) => [S / 2 + scale * (x - S / 2), S / 2 + scale * (y - S / 2)];
  const R = (w, h) => scale; // uniform scale for both axes

  // bg vertical gradient #0e1230 -> #05060f
  for (let y = 0; y < S; y++) {
    const t = y / S;
    const r = Math.round(14 + (5 - 14) * t);
    const g = Math.round(18 + (6 - 18) * t);
    const b = Math.round(48 + (15 - 48) * t);
    P.rect(0, y, S, 1, r, g, b, 1);
  }

  // maze 7x7 cells -> 15x15 grid, tile 32, centered at 256 with 16 margin
  const grid = M.generate(7, 7, Math.random);
  const tile = 32, half = (15 * tile) / 2;
  for (let gy = 0; gy < 15; gy++) {
    for (let gx = 0; gx < 15; gx++) {
      if (grid[gy][gx] === 1) {
        const [x0, y0] = T(256 - half + gx * tile, 256 - half + gy * tile);
        const jitter = ((gx * 7 + gy * 13) % 5) - 2;
        P.rect(x0, y0, tile * scale + 0.5, tile * scale + 0.5, 46 + jitter, 58 + jitter, 104 + jitter, 1);
        // lighter top edge when open below
        if (gy + 1 < 15 && grid[gy + 1][gx] === 0) {
          P.rect(x0, y0 + tile * scale - 3 * scale, tile * scale, 3 * scale, 74, 92, 158, 1);
        }
      }
    }
  }

  // key glow (radial falloff centered slightly left: bow side)
  const [kgx, kgy] = T(246, 256);
  const glowR = 130 * scale;
  for (let dy = -glowR; dy <= glowR; dy++) {
    for (let dx = -glowR; dx <= glowR; dx++) {
      const d = Math.hypot(dx, dy) / glowR;
      if (d > 1) continue;
      const a = (1 - d) * (1 - d) * 0.45;
      P.px(Math.round(kgx + dx), Math.round(kgy + dy), 251, 191, 36, a * 0.35);
    }
  }

  // key: bow ring + shaft + two teeth (gold #fde68a fill, darker outline)
  const gold = [253, 224, 71];
  const goldDark = [180, 140, 30];
  const [bx, by] = T(232, 256);
  P.ring(bx, by, 26 * scale, 11 * scale, gold[0], gold[1], gold[2], 1);
  const [s0x, s0y] = T(258, 250);
  const [s1x, s1y] = T(330, 262);
  P.rect(Math.min(s0x, s1x), Math.min(s0y, s1y), Math.abs(s1x - s0x), Math.abs(s1y - s0y), gold[0], gold[1], gold[2], 1);
  // teeth
  const t1 = T(298, 262); P.rect(t1[0], t1[1], 11 * scale, 18 * scale, gold[0], gold[1], gold[2], 1);
  const t2 = T(316, 262); P.rect(t2[0], t2[1], 11 * scale, 13 * scale, gold[0], gold[1], gold[2], 1);
  // thin outline pass (1-2px darker edges approximated by slight offset underlay)
  P.ring(bx, by, 26 * scale, 12 * scale, goldDark[0], goldDark[1], goldDark[2], 0.35);
  P.rect(Math.min(s0x, s1x), Math.max(s0y, s1y), Math.abs(s1x - s0x), 1.5 * scale, goldDark[0], goldDark[1], goldDark[2], 0.5);

  return P.buf;
}

function resample(buf, S, target) {
  const out = Buffer.alloc(target * target * 4);
  const f = S / target;
  for (let y = 0; y < target; y++) {
    for (let x = 0; x < target; x++) {
      const x0 = Math.floor(x * f), y0 = Math.floor(y * f);
      const x1 = Math.min(S, Math.floor((x + 1) * f)), y1 = Math.min(S, Math.floor((y + 1) * f));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * S + xx) * 4;
        r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; n++;
      }
      const o = (y * target + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); out[o + 3] = 255;
    }
  }
  return out;
}

const icon512 = drawIcon(1, false);
const mask512 = drawIcon(0.78, false); // maskable safe zone: content in inner 80%
fs.writeFileSync(path.join(OUT, 'icon-512.png'), encodePNG(512, 512, icon512));
fs.writeFileSync(path.join(OUT, 'icon-192.png'), encodePNG(192, 192, resample(icon512, 512, 192)));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), encodePNG(512, 512, mask512));
fs.writeFileSync(path.join(OUT, 'icon-maskable-192.png'), encodePNG(192, 192, resample(mask512, 512, 192)));
console.log('icons written to icons/: icon-512, icon-192, icon-maskable-512, icon-maskable-192');