/* LABIRINTO service worker — offline-first cache for the whole game. */
'use strict';
var VERSION = 'labirinto-v1';
var CORE = [
  './',
  './index.html',
  './styles.css',
  './js/maze.js',
  './js/game.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // navigations: network first, fall back to cached index (offline)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }
  // everything else: cache first, refresh in background
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (resp) {
        if (resp && resp.ok && resp.type === 'basic') {
          var copy = resp.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});