// InkBody — génération de tatouages par IA, côté serveur (Railway).
// La clé OPENAI_API_KEY n'existe que dans les variables d'environnement du serveur : jamais dans le site ni le dépôt.
// Accès protégé par un code (ACCESS_CODE) + quotas par appareil et par jour, pour éviter qu'un inconnu consomme le crédit.
'use strict';

const MAX_BODY = 14 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const MODES = new Set(['motif', 'manchette', 'liaison', 'composition']);
const day = () => new Date().toISOString().slice(0, 10);
const counters = new Map(); // compteurs en mémoire (remis à zéro chaque jour / au redémarrage)
const hits = new Map();     // anti-rafale : horodatages récents par IP

function cfg() {
  return {
    key: process.env.OPENAI_API_KEY || '',
    code: process.env.ACCESS_CODE || '',
    model: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1',
    quality: process.env.IMAGE_QUALITY || 'medium',
    perIp: Number(process.env.MAX_PER_IP_PER_DAY || 30),
    perDay: Number(process.env.MAX_PER_DAY || 120),
  };
}

function send(res, status, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Requête trop volumineuse'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function decodeImage(dataUrl) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Image invalide (PNG, JPEG ou WebP attendu)');
  const bytes = Buffer.from(m[3], 'base64'); if (bytes.length > MAX_IMAGE) throw new Error('Image trop lourde (4 Mo max)');
  const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[2]];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('Contenu d’image incohérent');
  return { type: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2], bytes };
}

function clientIp(req) {
  const f = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return f || req.socket.remoteAddress || 'inconnu';
}

function quota(ip, c) {
  const d = day();
  for (const k of counters.keys()) if (!k.startsWith(d)) counters.delete(k);
  const kIp = d + '|' + ip, kAll = d + '|*';
  const nIp = counters.get(kIp) || 0, nAll = counters.get(kAll) || 0;
  if (nIp >= c.perIp) return 'Quota quotidien atteint pour cet appareil';
  if (nAll >= c.perDay) return 'Quota quotidien du service atteint';
  const now = Date.now(); const h = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (h.length >= 4) return 'Trop de demandes rapprochées, réessayez dans une minute';
  h.push(now); hits.set(ip, h); counters.set(kIp, nIp + 1); counters.set(kAll, nAll + 1);
  return '';
}

function instructions(mode, style, prompt, side, hasRefs) {
  const st = style || 'black and grey';
  const base = {
    motif: `Tattoo flash design, ${st} style. ${prompt}. One standalone artwork, black and grey ink only unless colours are requested, on a fully transparent background, crisp clean linework and shading, no skin, no body, no hands, no mockup, no text unless requested, no frame, no border.`,
    manchette: `Full arm sleeve tattoo design laid out as a single tall vertical stencil sheet (unrolled sleeve): the top of the image is the shoulder, the bottom is the wrist, ${side === 'l' ? 'left' : 'right'} arm. ${st} style. Theme: ${prompt}. Elements flow continuously from top to bottom with filler (ornamental scrolls, leaves, dotwork shading) so it reads as one cohesive sleeve, densest in the middle, tapering at the wrist. Black and grey ink only unless colours are requested, fully transparent background, no skin, no arm, no body, no mockup, no text, no frame.`,
    liaison: `This is a render of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin between the existing tattoos. Add ${st} tattoo connecting elements that link the existing designs: ${prompt || 'subtle ornamental links'}. Do not modify existing tattoos, the body shape, lighting or background.`,
    composition: `This is a render of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin. Suggest a ${st} tattoo composition for this free area: ${prompt || 'harmonious with the existing tattoos'}. Do not modify existing tattoos, the body shape, lighting or background.`,
  }[mode];
  return base + (hasRefs ? ' Match the drawing style of the reference tattoo images provided and reuse their motifs where it fits.' : '');
}

async function generate(req, res) {
  const c = cfg();
  if (!c.key) return send(res, 503, { error: 'IA non activée sur le serveur : ajoutez la variable OPENAI_API_KEY dans Railway.' });
  if (!c.code) return send(res, 503, { error: 'IA verrouillée : ajoutez la variable ACCESS_CODE dans Railway (code personnel demandé dans l’app).' });
  if (String(req.headers['x-access-code'] || '') !== c.code) return send(res, 401, { error: 'Code d’accès invalide' });
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, e.status || 400, { error: e.status ? e.message : 'JSON invalide' }); }
  const mode = String(body.mode || ''); if (!MODES.has(mode)) return send(res, 400, { error: 'Mode invalide' });
  const prompt = String(body.prompt || '').slice(0, 1000).trim();
  const style = String(body.style || '').slice(0, 60).replace(/[^\p{L}\p{N} '\-]/gu, '');
  const side = body.side === 'l' ? 'l' : 'r';
  const n = Math.min(2, Math.max(1, Number(body.n) || 1));
  let refs, zone = null, mask = null;
  try {
    refs = (Array.isArray(body.references) ? body.references : []).slice(0, 3).map(decodeImage);
    if (mode === 'liaison' || mode === 'composition') {
      zone = decodeImage(body.zoneImage); mask = decodeImage(body.mask);
      if (mask.type !== 'image/png') throw new Error('Le masque doit être un PNG');
    }
  } catch (e) { return send(res, 400, { error: e.message }); }
  if ((mode === 'motif' || mode === 'manchette') && !prompt) return send(res, 400, { error: 'Description manquante' });
  const q = quota(clientIp(req), c); if (q) return send(res, 429, { error: q });

  const instr = instructions(mode, style, prompt, side, refs.length > 0);
  const size = mode === 'manchette' ? '1024x1536' : '1024x1024';
  let r;
  try {
    if ((mode === 'motif' || mode === 'manchette') && !refs.length) {
      r = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: c.model, prompt: instr, n, size, background: 'transparent', output_format: 'png', quality: c.quality }),
        signal: AbortSignal.timeout(240000),
      });
    } else {
      const fd = new FormData();
      fd.append('model', c.model); fd.append('prompt', instr); fd.append('n', String(n)); fd.append('size', size); fd.append('quality', c.quality);
      if (mode === 'motif' || mode === 'manchette') fd.append('background', 'transparent');
      const imgs = zone ? [zone, ...refs] : refs;
      imgs.forEach((im, i) => fd.append('image[]', new Blob([im.bytes], { type: im.type }), `image${i}.${im.ext}`));
      if (mask) fd.append('mask', new Blob([mask.bytes], { type: 'image/png' }), 'mask.png');
      r = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${c.key}` }, body: fd, signal: AbortSignal.timeout(240000) });
    }
  } catch (e) { return send(res, 502, { error: e.name === 'TimeoutError' ? 'Le fournisseur d’IA a mis trop de temps' : 'Fournisseur d’IA injoignable' }); }
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return send(res, 502, { error: (out.error && out.error.message) || `Erreur du fournisseur (${r.status})` });
  const images = (out.data || []).map(d => d.b64_json).filter(Boolean).map(b => 'data:image/png;base64,' + b);
  if (!images.length) return send(res, 502, { error: 'Aucune image renvoyée' });
  send(res, 200, { images });
}

// renvoie true si la requête a été traitée
function handle(req, res, p) {
  if (!p.startsWith('/api/ai/')) return false;
  if (p === '/api/ai/health' && req.method === 'GET') {
    const c = cfg(); send(res, 200, { ok: true, ready: !!(c.key && c.code), key: !!c.key, code: !!c.code, model: c.model });
    return true;
  }
  if (p === '/api/ai/generate' && req.method === 'POST') {
    generate(req, res).catch((e) => { if (!res.headersSent) send(res, 500, { error: 'Erreur interne' }); console.error(e); });
    return true;
  }
  send(res, 404, { error: 'Route inconnue' }); return true;
}

module.exports = { handle };
