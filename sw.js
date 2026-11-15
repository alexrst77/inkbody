// InkBody — service worker : rend l'application utilisable hors ligne après un premier chargement complet.
// Pensez à changer VERSION à chaque mise à jour du site pour renouveler le cache.
const VERSION = 'inkbody-2.1.0';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './assets/vendor/three.module.min.js', './assets/vendor/three-mesh-bvh.module.js',
  './assets/vendor/addons/OrbitControls.js', './assets/vendor/addons/GLTFLoader.js', './assets/vendor/addons/BufferGeometryUtils.js',
  './assets/models/mannequin.json', './assets/models/mannequin.bin.gz',
  './assets/samples/mandala.svg', './assets/samples/hirondelle.svg', './assets/samples/rose-lignes.svg',
  './assets/icons/icon.svg', './assets/icons/icon-180.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // jamais d'appel externe intercepté (ex. service IA)
  if (req.mode === 'navigate') { // page : réseau d'abord pour recevoir les mises à jour, cache si hors ligne
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', cp)); return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => { if (r.ok) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; })));
});
