/* Minimal static server for local PWA testing: node test/http-server.js
   serves the project root at http://127.0.0.1:8077 (correct mime types). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = 8077;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(abs, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(abs)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`LABIRINTO test server: http://127.0.0.1:${PORT}`));