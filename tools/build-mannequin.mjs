// InkBody — générateur du mannequin procédural (exécuté une seule fois, hors ligne).
// Usage : node tools/build-mannequin.mjs  → écrit assets/models/mannequin.bin + mannequin.json
// Principe : champ de distance signée (SDF) composé de formes anatomiques fusionnées en douceur,
// puis extraction d'un maillage continu (surface nets) projeté sur la surface exacte.
// Le résultat est un vrai maillage indexé, sans primitives visibles, avec étiquettes de zones
// et poids de déformation doux par groupe anatomique.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'models');
const H = Number(process.env.GRID || 0.0042); // pas de grille (m)

// ---------- maths ----------
const v = (x, y, z) => [x, y, z];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

// ---------- primitives ----------
function sdRoundCone(px, py, pz, P) {
  const { a, ba, l2, rr, a2, il2, r1, r2 } = P;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * ba[0] + pay * ba[1] + paz * ba[2];
  const z = y - l2;
  const qx = pax * l2 - ba[0] * y, qy = pay * l2 - ba[1] * y, qz = paz * l2 - ba[2] * y;
  const x2 = qx * qx + qy * qy + qz * qz;
  const y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}
function sdEllipsoid(px, py, pz, P) {
  let x = px - P.c[0], y = py - P.c[1], z = pz - P.c[2];
  if (P.R) { const R = P.R; const lx = x * R[0][0] + y * R[0][1] + z * R[0][2]; const ly = x * R[1][0] + y * R[1][1] + z * R[1][2]; const lz = x * R[2][0] + y * R[2][1] + z * R[2][2]; x = lx; y = ly; z = lz; }
  const r = P.r;
  const k0 = Math.hypot(x / r[0], y / r[1], z / r[2]);
  const k1 = Math.hypot(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]));
  if (k1 < 1e-9) return -Math.min(r[0], r[1], r[2]);
  return k0 * (k0 - 1) / k1;
}
function roundCone(a, b, r1, r2, region, group) {
  const ba = sub(b, a), l2 = dot(ba, ba), rr = r1 - r2;
  return { t: 'rc', a, b, ba, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, r1, r2, region, group };
}
function ellipsoid(c, r, region, group, frame) {
  // frame : [u, v, w] axes locaux (lignes) → rotation monde→local
  return { t: 'el', c, r, R: frame || null, region, group };
}
const evalPrim = (p, x, y, z) => p.t === 'rc' ? sdRoundCone(x, y, z, p) : sdEllipsoid(x, y, z, p);

// ---------- zones et groupes ----------
export const REGIONS = ['head', 'neck', 'torso', 'upperarm_l', 'upperarm_r', 'forearm_l', 'forearm_r', 'hand_l', 'hand_r', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
export const GROUPS = ['head', 'neck', 'torso', 'upperarm', 'forearm', 'hand', 'thigh', 'calf', 'foot'];
const R = Object.fromEntries(REGIONS.map((r, i) => [r, i]));
const G = Object.fromEntries(GROUPS.map((g, i) => [g, i]));

// ---------- anatomie (m, y vers le haut, regard vers +z, gauche du personnage = +x) ----------
const body = [], headParts = [], handParts = [], footParts = [], subtract = [], eyes = [];
const bones = {};

// Tronc
const torsoParts = [];
torsoParts.push(ellipsoid(v(0, 1.285, -0.005), v(0.146, 0.155, 0.097), R.torso, G.torso));
torsoParts.push(ellipsoid(v(0, 1.32, -0.032), v(0.138, 0.12, 0.082), R.torso, G.torso));
torsoParts.push(ellipsoid(v(0, 1.12, 0.006), v(0.13, 0.17, 0.09), R.torso, G.torso));
torsoParts.push(ellipsoid(v(0, 0.97, -0.006), v(0.15, 0.115, 0.097), R.torso, G.torso));
for (const s of [-1, 1]) {
  torsoParts.push(ellipsoid(v(0.064 * s, 1.30, 0.04), v(0.072, 0.058, 0.055), R.torso, G.torso));
  torsoParts.push(ellipsoid(v(0.068 * s, 0.925, -0.05), v(0.076, 0.088, 0.064), R.torso, G.torso));
  body.push(roundCone(v(0.05 * s, 1.47, -0.022), v(0.165 * s, 1.41, -0.018), 0.038, 0.045, R.torso, G.torso));
}
body.push(roundCone(v(-0.16, 1.395, -0.012), v(0.16, 1.395, -0.012), 0.05, 0.05, R.torso, G.torso));
// Cou
body.push(roundCone(v(0, 1.42, -0.012), v(0, 1.565, 0.004), 0.056, 0.049, R.neck, G.neck));
bones.neck = { a: [0, 1.42, -0.012], b: [0, 1.565, 0.004] };
bones.torso = { a: [0, 0.93, 0], b: [0, 1.42, -0.01] };
// Tête
headParts.push(ellipsoid(v(0, 1.655, -0.012), v(0.077, 0.098, 0.099), R.head, G.head));
headParts.push(ellipsoid(v(0, 1.592, 0.026), v(0.057, 0.074, 0.07), R.head, G.head));
headParts.push(ellipsoid(v(0, 1.535, 0.058), v(0.03, 0.024, 0.026), R.head, G.head));
headParts.push(roundCone(v(0, 1.64, 0.093), v(0, 1.606, 0.104), 0.0065, 0.0105, R.head, G.head));
headParts.push(ellipsoid(v(0, 1.567, 0.088), v(0.019, 0.0065, 0.008), R.head, G.head));
headParts.push(ellipsoid(v(0, 1.666, 0.066), v(0.05, 0.01, 0.018), R.head, G.head));
for (const s of [-1, 1]) {
  headParts.push(ellipsoid(v(0.079 * s, 1.625, -0.006), v(0.012, 0.03, 0.02), R.head, G.head));
  headParts.push(ellipsoid(v(0.038 * s, 1.615, 0.052), v(0.026, 0.02, 0.026), R.head, G.head));
  subtract.push(ellipsoid(v(0.031 * s, 1.647, 0.1), v(0.017, 0.0105, 0.013), R.head, G.head));
}

// Bras (posture en A, ~20° d'écart)
for (const s of [1, -1]) {
  const side = s > 0 ? 'l' : 'r';
  const sh = v(0.19 * s, 1.39, -0.012);
  const dir = norm(v(0.342 * s, -0.94, 0));
  const el = add(sh, mul(dir, 0.30));
  const wr = add(el, mul(dir, 0.26));
  body.push(ellipsoid(v(0.195 * s, 1.37, -0.006), v(0.056, 0.07, 0.058), R['upperarm_' + side], G.upperarm));
  body.push(roundCone(sh, el, 0.046, 0.036, R['upperarm_' + side], G.upperarm));
  body.push(roundCone(el, wr, 0.036, 0.026, R['forearm_' + side], G.forearm));
  const fFrame = [dir, v(0, 0, 1), cross(dir, v(0, 0, 1))];
  body.push(ellipsoid(add(sh, mul(dir, 0.15)), v(0.09, 0.038, 0.044), R['upperarm_' + side], G.upperarm, fFrame));
  body.push(ellipsoid(add(el, mul(dir, 0.08)), v(0.085, 0.033, 0.038), R['forearm_' + side], G.forearm, fFrame));
  bones['upperarm_' + side] = { a: sh, b: el };
  bones['forearm_' + side] = { a: el, b: wr };
  // Main : paume vers la cuisse, pouce vers l'avant
  const inward = v(-0.94 * s, -0.342, 0);
  const z = v(0, 0, 1);
  const frame = [dir, z, inward];
  const palmC = add(wr, mul(dir, 0.052));
  handParts.push(ellipsoid(palmC, v(0.056, 0.046, 0.016), R['hand_' + side], G.hand, frame));
  handParts.push(roundCone(add(wr, mul(dir, -0.01)), add(wr, mul(dir, 0.02)), 0.024, 0.022, R['hand_' + side], G.hand));
  const knuck = add(wr, mul(dir, 0.098));
  const fingers = [[0.0315, 0.074, 0.0076], [0.0105, 0.082, 0.0079], [-0.0105, 0.077, 0.0076], [-0.0305, 0.063, 0.0068]];
  for (const [oz, L, r] of fingers) {
    const base = add(knuck, add(mul(z, oz), mul(dir, -0.004)));
    const mid = add(base, mul(dir, L * 0.55));
    const tip = add(add(base, mul(dir, L)), mul(inward, 0.012));
    handParts.push(roundCone(base, mid, r * 1.05, r * 0.95, R['hand_' + side], G.hand));
    handParts.push(roundCone(mid, tip, r * 0.95, r * 0.8, R['hand_' + side], G.hand));
  }
  const tb = add(add(wr, mul(dir, 0.03)), add(mul(z, 0.024), mul(inward, 0.006)));
  const tm = add(add(wr, mul(dir, 0.065)), add(mul(z, 0.043), mul(inward, 0.012)));
  const tt = add(add(wr, mul(dir, 0.092)), add(mul(z, 0.05), mul(inward, 0.02)));
  handParts.push(roundCone(tb, tm, 0.013, 0.0105, R['hand_' + side], G.hand));
  handParts.push(roundCone(tm, tt, 0.0105, 0.0085, R['hand_' + side], G.hand));
  bones['hand_' + side] = { a: wr, b: add(wr, mul(dir, 0.18)) };
}

// Jambes
for (const s of [1, -1]) {
  const side = s > 0 ? 'l' : 'r';
  const hip = v(0.09 * s, 0.93, 0.0), knee = v(0.122 * s, 0.50, 0.012), ank = v(0.148 * s, 0.085, -0.022);
  body.push(roundCone(hip, knee, 0.083, 0.053, R['thigh_' + side], G.thigh));
  body.push(ellipsoid(v(0.1 * s, 0.77, 0.004), v(0.078, 0.15, 0.082), R['thigh_' + side], G.thigh));
  body.push(roundCone(knee, ank, 0.05, 0.031, R['calf_' + side], G.calf));
  body.push(ellipsoid(v(0.132 * s, 0.36, -0.028), v(0.052, 0.11, 0.056), R['calf_' + side], G.calf));
  bones['thigh_' + side] = { a: hip, b: knee };
  bones['calf_' + side] = { a: knee, b: ank };
  footParts.push(ellipsoid(v(0.155 * s, 0.038, 0.04), v(0.043, 0.036, 0.112), R['foot_' + side], G.foot));
  footParts.push(ellipsoid(v(0.151 * s, 0.042, -0.042), v(0.034, 0.036, 0.04), R['foot_' + side], G.foot));
  footParts.push(ellipsoid(v(0.162 * s, 0.024, 0.128), v(0.044, 0.022, 0.042), R['foot_' + side], G.foot));
  footParts.push(roundCone(ank, v(0.152 * s, 0.05, -0.01), 0.031, 0.034, R['foot_' + side], G.foot));
  bones['foot_' + side] = { a: v(0.151 * s, 0.03, -0.07), b: v(0.163 * s, 0.025, 0.165) };
}
const allPrims = [...torsoParts, ...body, ...headParts, ...handParts, ...footParts, ...eyes];

function partMin(list, x, y, z, k) {
  let d = 1e9;
  for (const p of list) { const e = evalPrim(p, x, y, z); d = k ? smin(d, e, k) : Math.min(d, e); }
  return d;
}
function sdf(x, y, z) {
  let d = smin(partMin(torsoParts, x, y, z, 0.05), partMin(body, x, y, z, 0.028), 0.03);
  // tête : fusion douce, orbites creusées, globes oculaires
  let hd = partMin(headParts, x, y, z, 0.016);
  for (const p of subtract) hd = smax(hd, -evalPrim(p, x, y, z), 0.008);
  for (const p of eyes) hd = smin(hd, evalPrim(p, x, y, z), 0.004);
  d = smin(d, hd, 0.02);
  if (Math.abs(x) > 0.3) d = smin(d, partMin(handParts, x, y, z, 0.0032), 0.012);
  if (y < 0.16) { const f = partMin(footParts, x, y, z, 0.016); d = smin(d, f, 0.02); }
  d = smax(d, -y, 0.006); // sol
  return d;
}
function gradient(x, y, z) {
  const e = 0.0005;
  const g = [sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)];
  const l = len(g) || 1; return [g[0] / l, g[1] / l, g[2] / l];
}

// ---------- extraction (surface nets) ----------
const X0 = -0.52, X1 = 0.52, Y0 = -0.012, Y1 = 1.775, Z0 = -0.2, Z1 = 0.25;
const nx = Math.ceil((X1 - X0) / H) + 1, ny = Math.ceil((Y1 - Y0) / H) + 1, nz = Math.ceil((Z1 - Z0) / H) + 1;
console.log(`Grille ${nx}×${ny}×${nz} (${(nx * ny * nz / 1e6).toFixed(1)} M nœuds, pas ${H * 1000} mm)`);
const F = new Float32Array(nx * ny * nz);
const idx = (i, j, k) => (k * ny + j) * nx + i;
let t0 = Date.now();
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) F[idx(i, j, k)] = sdf(X0 + i * H, Y0 + j * H, Z0 + k * H);
console.log('SDF', (Date.now() - t0) / 1000, 's');

const cellV = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
const cidx = (i, j, k) => (k * (ny - 1) + j) * (nx - 1) + i;
const pos = [];
const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
const cv = new Float32Array(8);
for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
  let mask = 0;
  for (let c = 0; c < 8; c++) { const o = corners[c]; cv[c] = F[idx(i + o[0], j + o[1], k + o[2])]; if (cv[c] < 0) mask |= 1 << c; }
  if (mask === 0 || mask === 255) continue;
  let sx = 0, sy = 0, sz = 0, n = 0;
  for (const [a, b] of edges) {
    const va = cv[a], vb = cv[b];
    if ((va < 0) === (vb < 0)) continue;
    const t = va / (va - vb), oa = corners[a], ob = corners[b];
    sx += oa[0] + (ob[0] - oa[0]) * t; sy += oa[1] + (ob[1] - oa[1]) * t; sz += oa[2] + (ob[2] - oa[2]) * t; n++;
  }
  cellV[cidx(i, j, k)] = pos.length / 3;
  pos.push(X0 + (i + sx / n) * H, Y0 + (j + sy / n) * H, Z0 + (k + sz / n) * H);
}
const tris = [];
function quad(a, b, c, d) {
  if (a < 0 || b < 0 || c < 0 || d < 0) return;
  tris.push(a, b, c, a, c, d);
}
for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
  const f0 = F[idx(i, j, k)] < 0;
  if (i < nx - 1 && f0 !== (F[idx(i + 1, j, k)] < 0)) quad(cellV[cidx(i, j - 1, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i, j - 1, k)]);
  if (j < ny - 1 && f0 !== (F[idx(i, j + 1, k)] < 0)) quad(cellV[cidx(i - 1, j, k - 1)], cellV[cidx(i, j, k - 1)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)]);
  if (k < nz - 1 && f0 !== (F[idx(i, j, k + 1)] < 0)) quad(cellV[cidx(i - 1, j - 1, k)], cellV[cidx(i, j - 1, k)], cellV[cidx(i, j, k)], cellV[cidx(i - 1, j, k)]);
}
const nV = pos.length / 3;
console.log('Sommets', nV, 'Triangles', tris.length / 3);

// Projection sur la surface exacte + orientation des triangles
for (let v2 = 0; v2 < nV; v2++) {
  let x = pos[v2 * 3], y = pos[v2 * 3 + 1], z = pos[v2 * 3 + 2];
  for (let it = 0; it < 3; it++) { const d = sdf(x, y, z); const g = gradient(x, y, z); x -= g[0] * d; y -= g[1] * d; z -= g[2] * d; }
  pos[v2 * 3] = x; pos[v2 * 3 + 1] = y; pos[v2 * 3 + 2] = z;
}
// Lissage de Taubin léger (supprime le crénelage résiduel sans rétrécir)
{
  const nbr = Array.from({ length: nV }, () => new Set());
  for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nbr[a].add(b).add(c); nbr[b].add(a).add(c); nbr[c].add(a).add(b); }
  const tmp = new Float32Array(pos.length);
  for (const lam of [0.45, -0.47, 0.45, -0.47]) {
    for (let i = 0; i < nV; i++) {
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (const j of nbr[i]) { sx += pos[j * 3]; sy += pos[j * 3 + 1]; sz += pos[j * 3 + 2]; n++; }
      if (!n) { tmp[i * 3] = pos[i * 3]; tmp[i * 3 + 1] = pos[i * 3 + 1]; tmp[i * 3 + 2] = pos[i * 3 + 2]; continue; }
      tmp[i * 3] = pos[i * 3] + lam * (sx / n - pos[i * 3]); tmp[i * 3 + 1] = pos[i * 3 + 1] + lam * (sy / n - pos[i * 3 + 1]); tmp[i * 3 + 2] = pos[i * 3 + 2] + lam * (sz / n - pos[i * 3 + 2]);
    }
    for (let i = 0; i < pos.length; i++) pos[i] = tmp[i];
  }
}
for (let t = 0; t < tris.length; t += 3) {
  const a = tris[t], b = tris[t + 1], c = tris[t + 2];
  const A = [pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]], B = [pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]], C = [pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]];
  const n = cross(sub(B, A), sub(C, A));
  const m = mul(add(add(A, B), C), 1 / 3);
  if (dot(n, gradient(m[0], m[1], m[2])) < 0) { tris[t + 1] = c; tris[t + 2] = b; }
}

// Zones (primitive dominante) et poids doux par groupe
const region = new Uint8Array(nV);
const weights = new Uint8Array(nV * GROUPS.length);
const wtmp = new Float64Array(GROUPS.length);
for (let i = 0; i < nV; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  let best = 1e9, br = 0; wtmp.fill(0);
  for (const p of allPrims) {
    const d = evalPrim(p, x, y, z);
    if (d < best) { best = d; br = p.region; }
    wtmp[p.group] += Math.exp(-Math.max(d, 0) / 0.022);
  }
  region[i] = br;
  let s = 0; for (let g = 0; g < GROUPS.length; g++) s += wtmp[g];
  for (let g = 0; g < GROUPS.length; g++) weights[i * GROUPS.length + g] = Math.round(255 * wtmp[g] / s);
}

// Quantification et écriture
let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < nV; i++) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], pos[i * 3 + a]); mx[a] = Math.max(mx[a], pos[i * 3 + a]); }
const qpos = new Uint16Array(nV * 3);
for (let i = 0; i < nV; i++) for (let a = 0; a < 3; a++) qpos[i * 3 + a] = Math.round(65535 * (pos[i * 3 + a] - mn[a]) / (mx[a] - mn[a]));
const index = new Uint32Array(tris);
const parts = [qpos, index, region, weights];
const offsets = []; let off = 0;
for (const p of parts) { offsets.push(off); off += p.byteLength; off = Math.ceil(off / 4) * 4; }
const buf = Buffer.alloc(off);
parts.forEach((p, i) => Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, offsets[i]));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'mannequin.bin'), buf);
fs.writeFileSync(path.join(OUT, 'mannequin.bin.gz'), zlib.gzipSync(buf, { level: 9 }));
const meta = {
  format: 'inkbody-mannequin', version: 1, generator: 'tools/build-mannequin.mjs', gridMm: H * 1000,
  vertexCount: nV, indexCount: index.length, min: mn, max: mx,
  layout: { position: offsets[0], index: offsets[1], region: offsets[2], weights: offsets[3] },
  regions: REGIONS, groups: GROUPS, bones, baseHeight: mx[1], hipY: 0.93,
  landmarks: { eyeL: [0.031, 1.648, 0.096], eyeR: [-0.031, 1.648, 0.096], mouth: [0, 1.566, 0.098], faceCenter: [0, 1.61, 0.11] },
  license: 'CC0 1.0 — modèle généré procéduralement pour InkBody',
};
fs.writeFileSync(path.join(OUT, 'mannequin.json'), JSON.stringify(meta));
console.log('Écrit', (buf.length / 1e6).toFixed(2), 'Mo en', (Date.now() - t0) / 1000, 's');
