// InkBody — service d'IA optionnel (Cloudflare Worker)
// La clé du fournisseur reste côté serveur (secret OPENAI_API_KEY). Le site GitHub Pages n'en contient aucune.
// Points d'entrée : GET /health, POST /generate
//
// Protections : liste d'origines, code d'accès facultatif, limitation par IP et quota global quotidien (KV),
// limite de taille, validation stricte des images et du texte. CORS seul ne protège pas contre les abus :
// ce sont le code d'accès et les quotas qui plafonnent la consommation.

const MAX_BODY = 14 * 1024 * 1024;      // 14 Mo de JSON au total
const MAX_IMAGE = 4 * 1024 * 1024;      // 4 Mo par image décodée
const MODES = new Set(['motif', 'liaison', 'composition']);

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const originOk = !allowed.length || allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': originOk && origin ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Access-Code',
      'Access-Control-Max-Age': '86400', 'Vary': 'Origin',
    };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true, model: env.OPENAI_IMAGE_MODEL || 'gpt-image-1' });
    if (url.pathname !== '/generate' || req.method !== 'POST') return json({ error: 'Route inconnue' }, 404);

    if (!originOk) return json({ error: 'Origine non autorisée' }, 403);
    if (env.ACCESS_CODE && req.headers.get('X-Access-Code') !== env.ACCESS_CODE) return json({ error: 'Code d’accès invalide' }, 401);
    if (!env.OPENAI_API_KEY) return json({ error: 'Service non configuré (secret OPENAI_API_KEY manquant)' }, 503);
    const len = Number(req.headers.get('Content-Length') || 0);
    if (len > MAX_BODY) return json({ error: 'Requête trop volumineuse' }, 413);

    // ---- limitation des requêtes
    const ip = req.headers.get('CF-Connecting-IP') || 'inconnu';
    if (env.RATE_LIMITER) { const { success } = await env.RATE_LIMITER.limit({ key: ip }); if (!success) return json({ error: 'Trop de requêtes, réessayez plus tard' }, 429); }
    if (env.QUOTA) {
      const day = new Date().toISOString().slice(0, 10);
      const perIp = Number(env.MAX_PER_IP_PER_DAY || 20), global = Number(env.MAX_PER_DAY || 150);
      const kIp = `ip:${day}:${ip}`, kAll = `all:${day}`;
      const [nIp, nAll] = await Promise.all([env.QUOTA.get(kIp), env.QUOTA.get(kAll)]).then(a => a.map(v => Number(v || 0)));
      if (nIp >= perIp) return json({ error: 'Quota quotidien atteint pour cet appareil' }, 429);
      if (nAll >= global) return json({ error: 'Quota quotidien du service atteint' }, 429);
      ctx.waitUntil(Promise.all([env.QUOTA.put(kIp, String(nIp + 1), { expirationTtl: 172800 }), env.QUOTA.put(kAll, String(nAll + 1), { expirationTtl: 172800 })]));
    }

    // ---- validation
    let body;
    try { const raw = await req.text(); if (raw.length > MAX_BODY) return json({ error: 'Requête trop volumineuse' }, 413); body = JSON.parse(raw); }
    catch { return json({ error: 'JSON invalide' }, 400); }
    const mode = String(body.mode || ''); if (!MODES.has(mode)) return json({ error: 'Mode invalide' }, 400);
    const prompt = String(body.prompt || '').slice(0, 800).trim();
    const style = String(body.style || '').slice(0, 60).replace(/[^\p{L}\p{N} '\-]/gu, '');
    const n = Math.min(2, Math.max(1, Number(body.n) || 1));
    let refs, zone = null, mask = null;
    try {
      refs = (Array.isArray(body.references) ? body.references : []).slice(0, 3).map(decodeImage);
      if (mode !== 'motif') {
        zone = decodeImage(body.zoneImage); mask = decodeImage(body.mask);
        if (mask.type !== 'image/png') throw new Error('Le masque doit être un PNG');
      }
    } catch (e) { return json({ error: e.message }, 400); }
    if (mode === 'motif' && !prompt) return json({ error: 'Description manquante' }, 400);

    const instr = {
      motif: `Tattoo design, ${style || 'fine line'} style. ${prompt}. Single standalone flash artwork on a fully transparent background, clean ink linework, no skin, no body, no text, no frame.`,
      liaison: `This is a photo of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin between the existing tattoos. Add ${style || 'fine line'} tattoo connecting elements that link the existing designs: ${prompt || 'subtle ornamental links'}. Do not modify existing tattoos, the body shape, lighting or background.`,
      composition: `This is a photo of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin. Suggest a ${style || 'fine line'} tattoo composition for this free area: ${prompt || 'harmonious with the existing tattoos'}. Do not modify existing tattoos, the body shape, lighting or background.`,
    }[mode] + (refs.length ? ' Match the style of the reference tattoo images provided.' : '');

    const model = env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    let res;
    try {
      if (mode === 'motif' && !refs.length) {
        res = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: instr, n, size: '1024x1024', background: 'transparent', output_format: 'png', quality: env.IMAGE_QUALITY || 'medium' }),
        });
      } else {
        const fd = new FormData();
        fd.append('model', model); fd.append('prompt', instr); fd.append('n', String(n)); fd.append('size', '1024x1024');
        fd.append('quality', env.IMAGE_QUALITY || 'medium');
        if (mode === 'motif') fd.append('background', 'transparent');
        const imgs = mode === 'motif' ? refs : [zone, ...refs];
        imgs.forEach((im, i) => fd.append('image[]', new Blob([im.bytes], { type: im.type }), `image${i}.${im.ext}`));
        if (mask) fd.append('mask', new Blob([mask.bytes], { type: 'image/png' }), 'mask.png');
        res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, body: fd });
      }
    } catch (e) { return json({ error: 'Fournisseur injoignable' }, 502); }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: (out.error && out.error.message) || `Erreur fournisseur ${res.status}` }, 502);
    const images = (out.data || []).map(d => d.b64_json).filter(Boolean).map(b => 'data:image/png;base64,' + b);
    return json({ images });
  },
};

function decodeImage(dataUrl) {
  const m = /^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Error('Image invalide (PNG, JPEG ou WebP en data URL attendu)');
  const bin = atob(m[3]); if (bin.length > MAX_IMAGE) throw new Error('Image trop lourde (4 Mo max)');
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // vérification de la signature réelle du fichier
  const sig = { png: [0x89, 0x50, 0x4e, 0x47], jpeg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46] }[m[2]];
  if (!sig.every((b, i) => bytes[i] === b)) throw new Error('Contenu d’image incohérent');
  return { type: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2], bytes };
}
