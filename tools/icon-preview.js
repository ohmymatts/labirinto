// Icon preview: ascii render of generated icons.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const cur = raw[pos++];
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const ul = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      if (filter === 0) v = cur;
      else if (filter === 1) v = (cur + left) & 255;
      else if (filter === 2) v = (cur + up) & 255;
      else if (filter === 3) v = (cur + ((left + up) >> 1)) & 255;
      else {
        const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v = (cur + ((pa <= pb && pa <= pc) ? left : (pb <= pc ? up : ul))) & 255;
      }
      out[y * stride + x] = v;
    }
  }
  return { w, h, bpp, data: out };
}

const file = process.argv[2] || 'icons/icon-512.png';
const img = decodePNG(path.join(__dirname, '..', file));
const COLS = 48, ROWS = 24, A = ' .:-=+*#%@';
let art = '';
for (let gy = 0; gy < ROWS; gy++) {
  for (let gx = 0; gx < COLS; gx++) {
    const x = Math.floor((gx + 0.5) * img.w / COLS), y = Math.floor((gy + 0.5) * img.h / ROWS);
    const i = (y * img.w + x) * img.bpp;
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (g > 150 && r > 180) art += 'K';                       // key gold
    else if (b > 90 && g > 70) art += '#';                    // walls
    else {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      art += A[Math.min(9, Math.floor(l * 14))];
    }
  }
  art += '\n';
}
console.log(file + ':');
console.log(art);