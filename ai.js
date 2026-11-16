// InkBody — génération de tatouages par IA, côté serveur (Railway).
// La clé OPENAI_API_KEY n'existe que dans les variables d'environnement du serveur : jamais dans le site ni le dépôt.
// Accès protégé par un code (ACCESS_CODE) + quotas par appareil et par jour, pour éviter qu'un inconnu consomme le crédit.
'use strict';

const MAX_BODY = 14 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;
const MODES = new Set(['motif', 'manchette', 'ajouts', 'photo', 'liaison', 'composition']);
const day = () => new Date().toISOString().slice(0, 10);
const counters = new Map(); // compteurs en mémoire (remis à zéro chaque jour / au redémarrage)
const hits = new Map();     // anti-rafale : horodatages récents par IP
// modèles essayés dans l'ordre si le précédent n'existe pas / n'est pas accessible à ce compte (les noms évoluent).
// gpt-image-2.5-sunburst : modèle d'OpenAI orienté retouche précise (masque, fidélité aux images fournies) ;
// gpt-image-2 est déprécié. Aucun paramètre propre à un modèle (input_fidelity…) n'est envoyé : ils font échouer les autres.
const FALLBACKS = ['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
// contrôle visuel des ajouts (modèle texte + image, réponse JSON) : facultatif, l'app fonctionne sans
const VISION = ['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini'];
let visionWorking = null;
let working = null;

function cfg() {
  return {
    key: process.env.OPENAI_API_KEY || '',
    code: process.env.ACCESS_CODE || '',
    model: process.env.OPENAI_IMAGE_MODEL || working || FALLBACKS[0],
    quality: process.env.IMAGE_QUALITY || '',
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

function instructions(mode, style, prompt, side, hasRefs, gender, plan, forbidden) {
  const st = style || 'black and grey';
  const base = {
    motif: `Tattoo flash design, ${st} style. ${prompt}. One standalone artwork, black and grey ink only unless colours are requested, on a fully transparent background, crisp clean linework and shading, no skin, no body, no hands, no mockup, no text unless requested, no frame, no border.`,
    manchette: `Full arm sleeve tattoo design laid out as a single tall vertical stencil sheet (unrolled sleeve): the top of the image is the shoulder, the bottom is the wrist, ${side === 'l' ? 'left' : 'right'} arm. ${st} style. Theme: ${prompt}. Elements flow continuously from top to bottom with filler (ornamental scrolls, leaves, dotwork shading) so it reads as one cohesive sleeve, densest in the middle, tapering at the wrist. Black and grey ink only unless colours are requested, fully transparent background, no skin, no arm, no body, no mockup, no text, no frame.`,
    liaison: `This is a render of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin between the existing tattoos. Add ${st} tattoo connecting elements that link the existing designs: ${prompt || 'subtle ornamental links'}. Do not modify existing tattoos, the body shape, lighting or background.`,
    ajouts: ajoutsPrompt(st, prompt, side, plan, forbidden),
    photo: `Turn this 3D avatar render into a photorealistic studio photograph of a real adult ${gender === 'f' ? 'woman' : 'man'} with exactly the same pose, camera angle, framing, body shape and proportions. Keep EXACTLY the same tattoos, at the same places, with the same designs and the same black and grey ink: do not add, remove, move or redesign any tattoo, and do not add tattoos on bare skin. Natural skin texture and pores, soft studio lighting, neutral dark grey backdrop. The person wears plain dark ${gender === 'f' ? 'sports bra and briefs' : 'boxer briefs'}. ${prompt}`,
    composition: `This is a render of a 3D avatar with tattoos. Only paint inside the transparent area of the mask, on bare skin. Suggest a ${st} tattoo composition for this free area: ${prompt || 'harmonious with the existing tattoos'}. Do not modify existing tattoos, the body shape, lighting or background.`,
  }[mode];
  // références : style seulement. (Avant : « reuse their motifs » → le modèle recopiait le roi et le damier des références.)
  return base + (hasRefs ? (mode === 'ajouts' ? ' The extra reference images show ONLY the desired line weight and shading technique: never copy, redraw or quote their subjects, figures, objects or patterns.' : ' Match the drawing style of the reference tattoo images provided.') : '');
}

function clean(s, n) { return String(s || '').slice(0, n).replace(/[^\p{L}\p{N} ,.'’()\-]/gu, ' ').replace(/\s+/g, ' ').trim(); }
function ajoutsPrompt(st, prompt, side, plan, forbidden) {
  const p = plan && typeof plan === 'object' ? plan : {};
  const main = clean(p.main, 60), mainCm = Number(p.mainCm) || 0;
  const zones = (Array.isArray(p.zones) ? p.zones : []).slice(0, 6).map(z => clean(z.label, 60) + (z.wCm ? ` (about ${Math.round(z.wCm)} x ${Math.round(z.hCm)} cm)` : '')).filter(Boolean);
  const forb = clean(forbidden, 300);
  return [
    `The image is an UNROLLED tattoo stencil sheet of a ${side === 'l' ? 'left' : 'right'} arm: top edge = shoulder, bottom = hand, the dashed lines mark the elbow and the wrist, the vertical centre is the outer arm, the left and right edges are the inner arm (they meet).`,
    'LIGHT BLUE areas are FORBIDDEN: they are the client\'s existing tattoos (with a safety margin) or skin outside the arm. Never draw on light blue and never reproduce what might be there.',
    main && mainCm ? `The PALE YELLOW disc is the exact place and the MAXIMUM size of the main motif: draw ONE ${main} entirely inside the yellow disc (about ${mainCm} cm wide on the skin), well proportioned, petals or parts never larger than the disc.` : '',
    `Draw NEW ${st} tattoo artwork only on the white (and yellow) paper: ${prompt}.`,
    zones.length ? 'Areas to work in: ' + zones.join('; ') + '.' : '',
    'Composition: one coherent design that follows the length of the arm, wraps around the elbow and fades out progressively near the forearm tattoos; broad, well developed acanthus leaves with volume (outlines plus soft grey gradients and stippling), connecting ornaments and light shading. Hug the edges of the blue areas with a little air around them.',
    'Keep it airy: leave at least 35% of the white paper as bare skin, medium line weight similar to classic black and grey tattoos, NO large solid black fills, no black background packing, no motif repeated, no truncated shapes at the edges of the white areas.',
    'Never draw any copy or fragment of an existing tattoo' + (forb ? ', and never draw: ' + forb : '') + '. Words in the request that name existing tattoos (for example "around the king") only describe placement relative to the blue areas.',
    'Black and grey ink only, white paper kept white, no skin, no body, no text, no frame, no border.',
  ].filter(Boolean).join(' ');
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
  if (mode === 'ajouts' && body.forbidden != null && typeof body.forbidden !== 'string') return send(res, 400, { error: 'Liste d’interdits invalide' });
  const style = String(body.style || '').slice(0, 60).replace(/[^\p{L}\p{N} '\-]/gu, '');
  const side = body.side === 'l' ? 'l' : 'r';
  let n = Math.min(2, Math.max(1, Number(body.n) || 1));
  let refs, zone = null, mask = null;
  try {
    refs = (Array.isArray(body.references) ? body.references : []).slice(0, 3).map(decodeImage);
    if (mode === 'liaison' || mode === 'composition' || mode === 'ajouts' || mode === 'photo') {
      zone = decodeImage(body.zoneImage); mask = mode === 'photo' ? null : decodeImage(body.mask);
      if (mask && mask.type !== 'image/png') throw new Error('Le masque doit être un PNG');
    }
  } catch (e) { return send(res, 400, { error: e.message }); }
  if ((mode === 'motif' || mode === 'manchette') && !prompt) return send(res, 400, { error: 'Description manquante' });
  if (mode === 'photo') n = 1;
  const q = quota(clientIp(req), c); if (q) return send(res, 429, { error: q });

  const gender = body.gender === 'f' ? 'f' : 'm';
  const instr = instructions(mode, style, prompt, side, refs.length > 0, gender, body.plan, body.forbidden);
  const quality = c.quality || (mode === 'ajouts' || mode === 'photo' ? 'high' : 'medium'); // détails fins du tatouage
  const size = mode === 'photo' ? (['1024x1536', '1536x1024', '1024x1024'].includes(body.size) ? body.size : '1024x1536') : mode === 'manchette' || mode === 'ajouts' ? '1024x1536' : '1024x1024';
  const wantsAlpha = mode === 'motif' || mode === 'manchette';
  const call = async (model, alpha) => {
    if ((mode === 'motif' || mode === 'manchette') && !refs.length) {
      const body = { model, prompt: instr, n, size, quality };
      if (alpha) { body.background = 'transparent'; body.output_format = 'png'; }
      return fetch('https://api.openai.com/v1/images/generations', { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) });
    }
    const fd = new FormData();
    fd.append('model', model); fd.append('prompt', instr); fd.append('n', String(n)); fd.append('size', size); fd.append('quality', quality);
    if (alpha) fd.append('background', 'transparent');
    const imgs = zone ? [zone, ...refs] : refs;
    imgs.forEach((im, i) => fd.append('image[]', new Blob([im.bytes], { type: im.type }), `image${i}.${im.ext}`));
    if (mask) fd.append('mask', new Blob([mask.bytes], { type: 'image/png' }), 'mask.png');
    return fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${c.key}` }, body: fd, signal: AbortSignal.timeout(240000) });
  };
  const models = [...new Set([c.model, ...FALLBACKS])];
  let r, out = {}, lastErr = '';
  try {
    outer: for (const model of models) {
      let alpha = wantsAlpha;
      for (let attempt = 0; attempt < 2; attempt++) {
        r = await call(model, alpha); out = await r.json().catch(() => ({}));
        if (r.ok) { working = model; break outer; }
        const msg = (out.error && out.error.message) || `Erreur du fournisseur (${r.status})`; lastErr = msg;
        // paramètre non pris en charge par ce modèle (fond transparent) : on réessaie sans ; l'app retire le fond blanc
        if (alpha && /background|transparen|output_format/i.test(msg)) { alpha = false; continue; }
        if (/does not exist|not found|model_not_found|unknown model|not have access|must be verified|invalid model/i.test(msg) || r.status === 404) continue outer;
        return send(res, 502, { error: msg });
      }
    }
  } catch (e) { return send(res, 502, { error: e.name === 'TimeoutError' ? 'Le fournisseur d’IA a mis trop de temps' : 'Fournisseur d’IA injoignable' }); }
  if (!r || !r.ok) return send(res, 502, { error: 'Aucun modèle d’image disponible pour ce compte OpenAI (' + lastErr + '). Vérifiez la clé, le crédit et la vérification de l’organisation sur platform.openai.com.' });
  const images = (out.data || []).map(d => d.b64_json).filter(Boolean).map(b => 'data:image/png;base64,' + b);
  if (!images.length) return send(res, 502, { error: 'Aucune image renvoyée' });
  send(res, 200, { images, model: working });
}

// contrôle visuel : l'image des AJOUTS seuls (aucune photo du client) est examinée pour y repérer des motifs interdits
async function check(req, res) {
  const c = cfg();
  if (!c.key || !c.code) return send(res, 503, { error: 'IA non configurée' });
  if (String(req.headers['x-access-code'] || '') !== c.code) return send(res, 401, { error: 'Code d’accès invalide' });
  let body; try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'JSON invalide' }); }
  let img; try { img = decodeImage(body.image); } catch (e) { return send(res, 400, { error: e.message }); }
  const ip = clientIp(req), now = Date.now(), h = (hits.get('chk|' + ip) || []).filter(t => now - t < 60000); if (h.length >= 8) return send(res, 429, { error: 'Trop de contrôles rapprochés' }); h.push(now); hits.set('chk|' + ip, h);
  const forb = clean(body.forbidden, 300);
  const q = 'This image shows NEW tattoo elements on white (or transparent) background, on an unrolled arm stencil (top = shoulder). '
    + 'List every element that is NOT allowed. Allowed: ' + (clean(body.allowed, 200) || 'flowers asked by the client, acanthus leaves, scrolls, ornaments, dotwork shading') + '. '
    + 'Not allowed: chess pieces or parts of them, checkerboard patterns, crosses, daggers, skulls' + (forb ? ', ' + forb : '') + ', and anything that looks like a copy of another tattoo. '
    + 'Answer ONLY with JSON: {"found":[{"what":"short label","box":[x0,y0,x1,y1]}]} with box coordinates as fractions 0..1 of the image width and height; {"found":[]} if nothing.';
  const b64 = 'data:' + img.type + ';base64,' + img.bytes.toString('base64');
  const models = [...new Set([process.env.OPENAI_VISION_MODEL, visionWorking, ...VISION].filter(Boolean))];
  for (const model of models) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
        body: JSON.stringify({ model, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: b64 } }] }] }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const m = (j.error && j.error.message) || ''; if (r.status === 404 || /does not exist|model_not_found|not have access|unsupported/i.test(m)) continue; return send(res, 502, { error: m || 'Contrôle indisponible' }); }
      visionWorking = model;
      let out = {}; try { out = JSON.parse(j.choices[0].message.content); } catch (e) { out = {}; }
      const found = (Array.isArray(out.found) ? out.found : []).slice(0, 20).map(f => ({ what: clean(f.what, 60), box: Array.isArray(f.box) ? f.box.slice(0, 4).map(v => Math.min(1, Math.max(0, Number(v) || 0))) : null })).filter(f => f.box && f.box.length === 4);
      return send(res, 200, { found, model });
    } catch (e) { if (e.name === 'TimeoutError') return send(res, 502, { error: 'Contrôle trop long' }); }
  }
  send(res, 502, { error: 'Aucun modèle de contrôle disponible' });
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
  if (p === '/api/ai/check' && req.method === 'POST') {
    check(req, res).catch((e) => { if (!res.headersSent) send(res, 500, { error: 'Erreur interne' }); console.error(e); });
    return true;
  }
  send(res, 404, { error: 'Route inconnue' }); return true;
}

module.exports = { handle };
