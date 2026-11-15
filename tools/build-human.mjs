// InkBody — conversion du maillage MakeHuman (CC0) en modèle compact pour le navigateur.
// Usage : MH=/chemin/makehuman/makehuman/data node tools/build-human.mjs
// Sources (CC0, https://github.com/makehumancommunity/makehuman) : 3dobjs/base.obj, rigs/default_weights.mhw, targets/*.
// Sortie : assets/models/human.json + human.bin (+ .gz). Les morphologies sont stockées au niveau de base
// (13 380 sommets) ; la subdivision Catmull-Clark (linéaire) est faite dans le navigateur.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MH = process.env.MH || '/tmp/mh/makehuman/data';
const OUT = path.join(__dirname, '..', 'assets', 'models');
const S = 0.1; // décimètres → mètres

// ---------- base.obj
const V = [], VT = []; const groups = {}, groupsVT = {}; let g = null;
for (const line of fs.readFileSync(path.join(MH, '3dobjs/base.obj'), 'utf8').split('\n')) {
  if (line.startsWith('v ')) { const p = line.split(/\s+/); V.push([+p[1], +p[2], +p[3]]); }
  else if (line.startsWith('vt ')) { const p = line.split(/\s+/); VT.push([+p[1], +p[2]]); }
  else if (line.startsWith('g ')) { g = line.slice(2).trim(); groups[g] = groups[g] || []; groupsVT[g] = groupsVT[g] || []; }
  else if (line.startsWith('f ')) { const t = line.trim().split(/\s+/).slice(1); groups[g].push(t.map(x => parseInt(x, 10) - 1)); groupsVT[g].push(t.map(x => parseInt(x.split('/')[1], 10) - 1)); }
}
// ---------- proxys MakeHuman (CC0, assets système : cheveux, sourcils, cils) — format JSON three.js exporté par makehuman-data
const PX = process.env.PX || '/tmp/npmx/ex/package/public/data/proxies';
const HAIRS = [['short02', 'Courts'], ['short04', 'Courts dégagés'], ['short01', 'Courts coiffés'], ['short03', 'Mi-courts à raie'], ['bob02', 'Carré'], ['bob01', 'Carré frange'], ['long01', 'Longs'], ['ponytail01', 'Queue de cheval'], ['afro01', 'Afro'], ['Braid01', 'Tresse']];
const PROXIES = [...HAIRS.map(([n]) => ['hair', n]), ['eyebrows', 'eyebrow001'], ['eyelashes', 'eyelashes02']]
  .map(([dir, n]) => ({ dir, name: n, d: JSON.parse(fs.readFileSync(path.join(PX, dir, n, n + '.json'), 'utf8')) }));
const proxyRefs = [...new Set(PROXIES.flatMap(p => p.d.ref_vIdxs.flat()))];
const quadsOf = (name) => groups[name].map(f => f.length === 4 ? f : [f[0], f[1], f[2], f[2]]);
const vertsOf = (names) => [...new Set(names.flatMap(n => groups[n].flat()))].sort((a, b) => a - b);
const groundY = centroid(vertsOf(['joint-ground']))[1];
function centroid(ids) { const c = [0, 0, 0]; for (const i of ids) for (let a = 0; a < 3; a++) c[a] += V[i][a]; return c.map(x => x / ids.length); }

const JOINTS = ['pelvis', 'spine-1', 'spine-2', 'spine-3', 'spine-4', 'neck', 'head', 'head-2', 'l-shoulder', 'l-elbow', 'l-hand', 'l-finger-3-4', 'r-shoulder', 'r-elbow', 'r-hand', 'r-finger-3-4',
  'l-upper-leg', 'l-knee', 'l-ankle', 'l-toe-3-3', 'l-foot-1', 'r-upper-leg', 'r-knee', 'r-ankle', 'r-toe-3-3', 'r-foot-1', 'l-eye', 'r-eye'];
const bodyIdx = vertsOf(['body']);
const eyeL = vertsOf(['helper-l-eye']), eyeR = vertsOf(['helper-r-eye']), hairIdx = vertsOf(['helper-hair']);
const jointIdx = JOINTS.map(j => vertsOf(['joint-' + j]));
const teeth = vertsOf(['helper-upper-teeth', 'helper-lower-teeth']);
// sommets conservés (espace « keep ») : corps, yeux, calotte cheveux, articulations, dents (repères bouche)
const genIdx = vertsOf(['helper-genital']);
const keep = [...new Set([...bodyIdx, ...eyeL, ...eyeR, ...hairIdx, ...jointIdx.flat(), ...teeth, ...genIdx, ...proxyRefs])];
const map = new Map(keep.map((v, i) => [v, i]));
const K = keep.length;
console.log('Sommets conservés', K, '(corps', bodyIdx.length + ')');

// ---------- cibles (targets)
function readTarget(rel) {
  const d = new Float32Array(K * 3);
  const txt = fs.readFileSync(path.join(MH, 'targets', rel), 'utf8');
  for (const line of txt.split('\n')) {
    if (!line || line[0] === '#') continue; const p = line.trim().split(/\s+/); if (p.length < 4) continue;
    const k = map.get(+p[0]); if (k === undefined) continue;
    d[k * 3] += +p[1]; d[k * 3 + 1] += +p[2]; d[k * 3 + 2] += +p[3];
  }
  return d;
}
const add = (a, b, s = 1) => { for (let i = 0; i < a.length; i++) a[i] += b[i] * s; return a; };
const morphs = []; // {name, data}
const LV = ['min', 'average', 'max'];
for (const gen of ['female', 'male']) for (const m of LV) for (const w of LV)
  morphs.push({ name: `u-${gen}-${m}-${w}`, data: readTarget(`macrodetails/universal-${gen}-young-${m}muscle-${w}weight.target`) });
for (const gen of ['female', 'male']) {
  const r = new Float32Array(K * 3); for (const race of ['african', 'asian', 'caucasian']) add(r, readTarget(`macrodetails/${race}-${gen}-young.target`), 1 / 3);
  morphs.push({ name: `race-${gen}`, data: r });
}
morphs.push({ name: 'cup-min', data: readTarget('breast/female-young-averagemuscle-averageweight-mincup-averagefirmness.target') });
morphs.push({ name: 'cup-max', data: readTarget('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness.target') });
for (const [n, f] of [['vshape', 'torso/torso-vshape'], ['pectoral', 'torso/torso-muscle-pectoral'], ['hips', 'hip/hip-scale-horiz'], ['belly', 'stomach/stomach-pregnant']]) {
  morphs.push({ name: n + '-incr', data: readTarget(f + '-incr.target') }); morphs.push({ name: n + '-decr', data: readTarget(f + '-decr.target') });
}
for (const part of ['upperarm', 'lowerarm', 'upperleg', 'lowerleg']) for (const dir of ['incr', 'decr']) {
  const d = readTarget(`armslegs/l-${part}-fat-${dir}.target`); add(d, readTarget(`armslegs/r-${part}-fat-${dir}.target`));
  morphs.push({ name: `${part}-${dir}`, data: d });
}
console.log('Morphologies', morphs.length);

// ---------- humain par défaut (pour calculer repères et masques) : neutre 50/50
const base = new Float32Array(K * 3); keep.forEach((v, i) => { base[i * 3] = V[v][0]; base[i * 3 + 1] = V[v][1]; base[i * 3 + 2] = V[v][2]; });
const def = Float32Array.from(base);
for (const mo of morphs) { if (mo.name === 'u-female-average-average' || mo.name === 'u-male-average-average' || mo.name.startsWith('race-')) add(def, mo.data, 0.5); }
const P = (i) => [def[i * 3], def[i * 3 + 1], def[i * 3 + 2]];
const cen = (ids) => { const c = [0, 0, 0]; for (const v of ids) { const p = P(map.get(v)); for (let a = 0; a < 3; a++) c[a] += p[a]; } return c.map(x => x / ids.length); };

// ---------- poids de peau → groupes InkBody
const GROUPS = ['head', 'neck', 'torso', 'upperarm', 'forearm', 'hand', 'thigh', 'calf', 'foot'];
const groupOf = (bone) => {
  if (/^(head|jaw|eye|oculi|orbicularis|oris|risorius|levator|special|tongue)/.test(bone)) return 0;
  if (/^neck/.test(bone)) return 1;
  if (/^(spine|root|pelvis|clavicle|breast)/.test(bone)) return 2;
  if (/^(shoulder|upperarm)/.test(bone)) return 3;
  if (/^lowerarm/.test(bone)) return 4;
  if (/^(wrist|metacarpal|finger)/.test(bone)) return 5;
  if (/^upperleg/.test(bone)) return 6;
  if (/^lowerleg/.test(bone)) return 7;
  if (/^(foot|toe)/.test(bone)) return 8;
  return 2;
};
const W = JSON.parse(fs.readFileSync(path.join(MH, 'rigs/default_weights.mhw'), 'utf8')).weights;
const gw = new Float32Array(bodyIdx.length * 9);
const bmap = new Map(bodyIdx.map((v, i) => [v, i]));
for (const [bone, list] of Object.entries(W)) { const gi = groupOf(bone); for (const [v, w] of list) { const b = bmap.get(v); if (b !== undefined) gw[b * 9 + gi] += w; } }
const gw8 = new Uint8Array(bodyIdx.length * 9);
for (let b = 0; b < bodyIdx.length; b++) { let s = 0; for (let k = 0; k < 9; k++) s += gw[b * 9 + k]; if (!s) { gw[b * 9 + 2] = 1; s = 1; } for (let k = 0; k < 9; k++) gw8[b * 9 + k] = Math.round(255 * gw[b * 9 + k] / s); }

// ---------- normales (maillage par défaut)
const bodyQuads = quadsOf('body');
const nrm = new Float32Array(K * 3);
for (const q of bodyQuads) {
  const [a, b, c, d] = q.map(v => P(map.get(v)));
  const n = [(c[1] - a[1]) * (d[2] - b[2]) - (c[2] - a[2]) * (d[1] - b[1]), (c[2] - a[2]) * (d[0] - b[0]) - (c[0] - a[0]) * (d[2] - b[2]), (c[0] - a[0]) * (d[1] - b[1]) - (c[1] - a[1]) * (d[0] - b[0])];
  for (const v of q) { const k = map.get(v); for (let t = 0; t < 3; t++) nrm[k * 3 + t] += n[t]; }
}
const N = (i) => { const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2], l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

// ---------- teintes locales (lèvres, sourcils, aréoles) et masques (barbe, nuque)
const EL = cen(eyeL), ER = cen(eyeR), mouth = cen(teeth);
const headJ = cen(vertsOf(['joint-head'])), neckJ = cen(vertsOf(['joint-neck']));
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const tint = new Uint8Array(bodyIdx.length * 3).fill(255);
const masks = new Uint8Array(bodyIdx.length * 3);
const nipples = [cen(vertsOf(['joint-l-clavicle'])), cen(vertsOf(['joint-r-clavicle']))];
for (let b = 0; b < bodyIdx.length; b++) {
  const k = map.get(bodyIdx[b]); const [x, y, z] = P(k); const n = N(k);
  const head = gw[b * 9] / Math.max(1e-6, gw.slice(b * 9, b * 9 + 9).reduce((s, v) => s + v, 0));
  let r = 1, gg = 1, bb = 1;
  // lèvres : ellipse devant la bouche
  const lx = x / 0.27, ly = (y - (mouth[1] - 0.005)) / 0.115; const lip = (1 - ss(0.75, 1.0, Math.hypot(lx, ly))) * ss(mouth[2] + 0.12, mouth[2] + 0.2, z) * (n[2] > 0.2 ? 1 : 0);
  r *= 1 - 0.1 * lip; gg *= 1 - 0.3 * lip; bb *= 1 - 0.26 * lip;
  // sourcils : arc au-dessus de chaque œil
  for (const E of [EL, ER]) {
    const dx = (x - E[0] - 0.035 * Math.sign(E[0])) / 0.28; if (Math.abs(dx) > 1.15 || z < E[2] - 0.05 || n[2] < 0.2) continue;
    const yc = E[1] + 0.2 - 0.06 * dx * dx + 0.02 * (Math.sign(E[0]) * dx); const d = Math.abs(y - yc) / (0.075 * (1 - 0.4 * Math.max(0, Math.sign(E[0]) * dx)));
    const br = (1 - ss(0.45, 1, d)) * (1 - ss(0.95, 1.2, Math.abs(dx)));
    r *= 1 - 0.6 * br; gg *= 1 - 0.64 * br; bb *= 1 - 0.66 * br;
  }
  tint[b * 3] = Math.round(255 * r); tint[b * 3 + 1] = Math.round(255 * gg); tint[b * 3 + 2] = Math.round(255 * bb);
  // barbe : bas du visage et mâchoire, hors lèvres
  const beardZone = head > 0.45 && y < mouth[1] + 0.2 && y > neckJ[1] + 0.25 && z > headJ[2] - 0.15 && Math.abs(x) < 0.62;
  masks[b * 3] = beardZone ? Math.round(255 * (1 - lip) * ss(neckJ[1] + 0.25, neckJ[1] + 0.45, y) * ss(headJ[2] - 0.15, headJ[2] + 0.2, z)) : 0;
  // nuque (cheveux mi-longs)
  const nape = (head > 0.3 || gw[b * 9 + 1] > 0.3) && z < headJ[2] - 0.25 && y > neckJ[1] - 0.15 && y < headJ[1] + 0.4;
  masks[b * 3 + 1] = nape ? Math.round(255 * ss(neckJ[1] - 0.15, neckJ[1] + 0.25, y) * ss(headJ[2] - 0.25, headJ[2] - 0.6, z)) : 0;
  // cuir chevelu : ligne d'implantation front → tempes → nuque, oreilles dégagées
  if (head > 0.4) {
    const E = (EL[1] + ER[1]) / 2; let thr = (E + 0.62) * ss(headJ[2] - 0.55, headJ[2] + 0.45, z) + (neckJ[1] + 0.62) * (1 - ss(headJ[2] - 0.55, headJ[2] + 0.45, z));
    if (Math.abs(x) > 0.5 && z > headJ[2] - 0.45 && z < headJ[2] + 0.35) thr = Math.max(thr, E + 0.16 + 0.25 * ss(headJ[2], headJ[2] + 0.35, z));
    masks[b * 3 + 2] = Math.round(255 * ss(thr, thr + 0.16, y));
  }
}

// ---------- angle de chaque sommet d'œil (pupille / iris / blanc) autour de l'axe du regard
const eyeAngle = (ids, C) => ids.map(v => { const p = P(map.get(v)); const d = [p[0] - C[0], p[1] - C[1], p[2] - C[2]]; const l = Math.hypot(...d) || 1; return Math.acos(Math.max(-1, Math.min(1, d[2] / l))); });

// ---------- écriture
const K_ = (arr) => arr.map(v => map.get(v));
const quant = morphs.map(mo => { let mx = 0; for (const x of mo.data) mx = Math.max(mx, Math.abs(x)); const s = mx / 127 || 1; const q = new Int8Array(mo.data.length); for (let i = 0; i < q.length; i++) q[i] = Math.round(mo.data[i] / s); return { name: mo.name, scale: s * S, q }; });
const basePos = new Float32Array(K * 3); for (let i = 0; i < K; i++) { basePos[i * 3] = base[i * 3] * S; basePos[i * 3 + 1] = (base[i * 3 + 1] - groundY) * S; basePos[i * 3 + 2] = base[i * 3 + 2] * S; }
const toU16 = (qs) => Uint16Array.from(qs.flat().map(v => map.get(v)));
const parts = [];
const push = (name, arr) => { parts.push({ name, arr }); };
push('basePos', basePos);
push('bodyIdx', Uint16Array.from(K_(bodyIdx)));
push('bodyQuads', toU16(bodyQuads));
push('eyeLQuads', toU16(quadsOf('helper-l-eye'))); push('eyeRQuads', toU16(quadsOf('helper-r-eye')));
push('hairQuads', toU16(quadsOf('helper-hair')));
push('eyeAngle', Float32Array.from([...eyeAngle(eyeL, cen(eyeL)), ...eyeAngle(eyeR, cen(eyeR))]));
push('eyeVerts', Uint16Array.from([...K_(eyeL), ...K_(eyeR)]));
push('groupW', gw8); push('tint', tint); push('masks', masks);
// UV du corps par coin de quad (skin MakeHuman)
const bodyVT = groupsVT['body'].map(f => f.length === 4 ? f : [f[0], f[1], f[2], f[2]]).flat();
push('bodyUV', Uint16Array.from(bodyVT.flatMap(t => [Math.round(VT[t][0] * 65535), Math.round(Math.min(1, Math.max(0, VT[t][1])) * 65535)])));
push('genQuads', toU16(quadsOf('helper-genital')));
// proxys : sommet = Σ w·v(ref) + décalage ; sommets dupliqués aux coutures UV
const proxyMeta = [];
for (const px of PROXIES) {
  const d = px.d, nv = d.ref_vIdxs.length, uvs = d.uvs[0];
  const refs = new Uint16Array(nv * 3), w = new Float32Array(nv * 3), off = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { refs[i * 3 + k] = map.get(d.ref_vIdxs[i][k]); w[i * 3 + k] = d.weights[i][k]; off[i * 3 + k] = d.offsets[i][k] * S; }
  const F = d.faces; const uniq = new Map(), outV = [], outUV = [], tri = [];
  const vid = (v, t) => { const key = v * 100000 + t; let id = uniq.get(key); if (id === undefined) { id = outV.length; uniq.set(key, id); outV.push(v); outUV.push(uvs[t * 2], uvs[t * 2 + 1]); } return id; };
  for (let i = 0; i < F.length;) {
    const type = F[i++]; const quad = type & 1, n = quad ? 4 : 3; const vs = F.slice(i, i + n); i += n;
    if (type & 2) i++; if (type & 4) i++;
    let ts = null; if (type & 8) { ts = F.slice(i, i + n); i += n; }
    if (type & 16) i++; if (type & 32) i += n; if (type & 64) i++; if (type & 128) i += n;
    const ids = vs.map((v, k) => vid(v, ts ? ts[k] : 0));
    tri.push(ids[0], ids[1], ids[2]); if (quad) tri.push(ids[0], ids[2], ids[3]);
  }
  const key = px.dir + ':' + px.name;
  push('px:' + key + ':refs', refs); push('px:' + key + ':w', w); push('px:' + key + ':off', off);
  push('px:' + key + ':v', Uint16Array.from(outV)); push('px:' + key + ':uv', Float32Array.from(outUV)); push('px:' + key + ':tri', Uint16Array.from(tri));
  const tex = d.materials[0].mapDiffuse ? path.basename(d.materials[0].mapDiffuse) : null;
  proxyMeta.push({ key, dir: px.dir, name: px.name, label: (HAIRS.find(h => h[0] === px.name) || [])[1] || px.name, tex: tex && (px.name + '.webp'), author: d.metadata.author });
  if (tex) fs.copyFileSync(path.join(PX, px.dir, px.name, d.materials[0].mapDiffuse), path.join(OUT, 'px', px.name + '.src.png'));
}
for (const q of quant) push('m:' + q.name, q.q);
const layout = {}; let off = 0;
for (const p of parts) { off = Math.ceil(off / 4) * 4; layout[p.name] = { offset: off, length: p.arr.length, type: p.arr.constructor.name }; off += p.arr.byteLength; }
const buf = Buffer.alloc(Math.ceil(off / 4) * 4);
for (const p of parts) Buffer.from(p.arr.buffer, p.arr.byteOffset, p.arr.byteLength).copy(buf, layout[p.name].offset);
fs.writeFileSync(path.join(OUT, 'human.bin'), buf);
fs.writeFileSync(path.join(OUT, 'human.bin.gz'), zlib.gzipSync(buf, { level: 9 }));
const meta = {
  format: 'inkbody-human', version: 1, source: 'MakeHuman 1.x base mesh, skin weights and targets (CC0 1.0) — github.com/makehumancommunity/makehuman',
  keepCount: K, bodyCount: bodyIdx.length, groups: GROUPS, layout,
  morphs: quant.map(q => ({ name: q.name, scale: q.scale })),
  joints: Object.fromEntries(JOINTS.map((j, i) => [j, K_(jointIdx[i])])),
  mouthVerts: K_(teeth),
  proxies: proxyMeta,
};
fs.writeFileSync(path.join(OUT, 'human.json'), JSON.stringify(meta));
console.log('human.bin', (buf.length / 1e6).toFixed(2), 'Mo — gzip', (zlib.gzipSync(buf, { level: 9 }).length / 1e6).toFixed(2), 'Mo');
