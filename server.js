// Serveur statique minimal pour Railway (aucune dépendance). GitHub Pages n'en a pas besoin.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const AI = require('./ai.js');
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gz': 'application/gzip', '.bin': 'application/octet-stream',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const BLOCK = /^\/(\.git|node_modules|serverless|tools|tests|server\.js|ai\.js|package(-lock)?\.json|Dockerfile)(\/|$)/;
http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (AI.handle(req, res, p)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (p === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}'); return; }
  if (BLOCK.test(p)) { res.writeHead(404).end('Introuvable'); return; }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Introuvable'); return; }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      // revalidation systématique : une mise à jour n'est jamais masquée par un ancien cache
      'Cache-Control': 'no-cache', 'Last-Modified': st.mtime.toUTCString(), 'ETag': 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"',
    };
    if (req.headers['if-none-match'] === headers.ETag) { res.writeHead(304, { ETag: headers.ETag, 'Cache-Control': 'no-cache' }); res.end(); return; }
    const compressible = /^(text\/|application\/(json|manifest)|image\/svg)/.test(headers['Content-Type']);
    if (compressible && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { headers['Content-Encoding'] = 'gzip'; headers['Vary'] = 'Accept-Encoding'; res.writeHead(200, headers); if (req.method === 'HEAD') return res.end(); fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res); return; }
    headers['Content-Length'] = st.size; res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log('InkBody en ligne sur le port ' + PORT));
