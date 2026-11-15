// InkBody — service worker : rend l'application utilisable hors ligne après un premier chargement complet.
// Pensez à changer VERSION à chaque mise à jour du site pour renouveler le cache.
const VERSION = 'inkbody-3.0.2';
const CORE = [
  './', './index.html', './manifest.webmanifest',
  './assets/lib/three.module.min.js', './assets/lib/three-mesh-bvh.module.js',
  './assets/lib/addons/OrbitControls.js', './assets/lib/addons/GLTFLoader.js', './assets/lib/addons/BufferGeometryUtils.js',
  './assets/models/human.json', './assets/models/human.bin.gz',
  './assets/samples/mandala.svg', './assets/samples/hirondelle.svg', './assets/samples/rose-lignes.svg',
  './assets/icons/icon.svg', './assets/icons/icon-180.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // jamais d'appel externe intercepté (ex. service IA)
  // réseau d'abord (toujours la dernière version en ligne), cache seulement hors ligne
  e.respondWith(fetch(req).then(r => {
    if (r.ok && r.type === 'basic') { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req.mode === 'navigate' ? './index.html' : req, cp)); }
    return r;
  }).catch(() => caches.match(req.mode === 'navigate' ? './index.html' : req, { ignoreSearch: req.mode === 'navigate' })));
});
