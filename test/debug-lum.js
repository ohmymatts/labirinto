// Debug: real dims + scanline lums of screenshots, to ground the visual test regions.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function decodePNG(file) {
  const buf = fs.readFileSync(file);
  let off = 8, w = 0, h = 0, colorType = 0, bitDepth = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
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
const lum = (px, i) => (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;

const file = process.argv[2];
const img = decodePNG(path.join(__dirname, 'screens', file));
console.log(`${file}: ${img.w}x${img.h} bpp=${img.bpp}`);

function hline(y) {
  let s = 0, min = 1, max = 0, n = 0;
  for (let x = 0; x < img.w; x += 4) {
    const l = lum(img.data, (y * img.w + x) * img.bpp);
    s += l; n++;
    if (l < min) min = l; if (l > max) max = l;
  }
  console.log(`y=${y}\tavg=${(s / n).toFixed(3)}\tmin=${min.toFixed(3)}\tmax=${max.toFixed(3)}`);
}
function vline(x) {
  let s = 0, n = 0, max = 0, maxY = 0;
  for (let y = 0; y < img.h; y += 4) {
    const l = lum(img.data, (y * img.w + x) * img.bpp);
    s += l; n++;
    if (l > max) { max = l; maxY = y; }
  }
  console.log(`x=${x}\tavg=${(s / n).toFixed(3)}\tmax=${max.toFixed(3)}@y=${maxY}`);
}
console.log('-- horizontal scanlines (fraction of height) --');
for (const f of [0.02, 0.03, 0.4, 0.16, 0.20, 0.35, 0.39, 0.5, 0.62, 0.9]) hline(Math.round(f * img.h));
console.log('-- vertical scanlines --');
for (const f of [0.3, 0.5, 0.7]) vline(Math.round(f * img.w));