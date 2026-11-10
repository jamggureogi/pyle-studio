// Terrain renderer: same idea as tools/tilegen/terrain.py in the game repo.
// Each terrain is a seamless texture sampled in world space; borders between terrains
// are bent by domain-warped noise and blended softly, so they look hand-painted.

const TILE = 64;

function hash(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  let fx = x - x0, fy = y - y0;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash(x0, y0, seed), b = hash(x0 + 1, y0, seed), c = hash(x0, y0 + 1, seed), d = hash(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx, bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}
export function fbm(x, y, seed, octaves = 4) {
  let v = 0, amp = 1, total = 0, f = 1;
  for (let o = 0; o < octaves; o++) { v += amp * vnoise(x * f, y * f, seed + o * 31); total += amp; amp *= 0.5; f *= 2; }
  return v / total;
}

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Placeholder texture when no painted texture is approved yet: the terrain color with soft noise.
function proceduralTexture(color, size, seed) {
  const [r, g, b] = hexToRgb(color);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    // tileable by sampling noise on a torus-like wrap: blend four shifted samples
    const u = x / size, v = y / size, s = 6;
    const n = (fbm(x / size * s, y / size * s, seed, 4) * (1 - u) * (1 - v) + fbm((x - size) / size * s, y / size * s, seed, 4) * u * (1 - v)
      + fbm(x / size * s, (y - size) / size * s, seed, 4) * (1 - u) * v + fbm((x - size) / size * s, (y - size) / size * s, seed, 4) * u * v);
    const fine = hash(x, y, seed + 7) * 0.12;
    const k = 0.78 + n * 0.4 + fine;
    const i = (y * size + x) * 4;
    data[i] = r * k; data[i + 1] = g * k; data[i + 2] = b * k; data[i + 3] = 255;
  }
  return { w: size, h: size, data };
}

async function imageTexture(url, size) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, size, size);
  return { w: size, h: size, data: g.getImageData(0, 0, size, size).data };
}

export class TerrainRenderer {
  // map: {cols, rows, terrains:[id...], corners:[...]} ; defs: data/terrains.json list
  constructor(map, defs, store, scale = 0.5) {
    Object.assign(this, { map, defs, store, scale });
    this.W = Math.round(map.cols * TILE * scale);
    this.H = Math.round(map.rows * TILE * scale);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(this.W, this.H);
    this.noise = new Map();
  }

  def(i) { return this.defs.find(d => d.id === this.map.terrains[i]) || { color: '#888888', edgeAmp: 0.5, edgeFreq: 8 }; }

  async init() {
    const texSize = Math.round(512 * this.scale);
    this.tex = await Promise.all(this.map.terrains.map(async (id, i) => {
      const d = this.def(i);
      if (d.file) {
        try { return await imageTexture(await this.store.blobUrl(d.file), texSize); } catch { /* fall back */ }
      }
      return proceduralTexture(d.color, texSize, 100 + i * 17);
    }));
  }

  // Warped noise for terrain i, computed once per map at render scale, normalized to about -0.5..0.5.
  noiseFor(i) {
    if (this.noise.has(i)) return this.noise.get(i);
    const d = this.def(i), W = this.W, H = this.H, s = this.scale;
    const cell = 1280 / (d.edgeFreq || 8) * s, warp = 22 * s, seed = 1000 + i * 101;
    const arr = new Float32Array(W * H);
    let sum = 0, sum2 = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const wx = (fbm(x / (cell * 2), y / (cell * 2), seed + 5, 3) - 0.5) * 2 * warp;
      const wy = (fbm(x / (cell * 2), y / (cell * 2), seed + 9, 3) - 0.5) * 2 * warp;
      const n = fbm((x + wx) / cell, (y + wy) / cell, seed, 4);
      arr[y * W + x] = n; sum += n; sum2 += n * n;
    }
    const mean = sum / arr.length, std = Math.sqrt(Math.max(sum2 / arr.length - mean * mean, 1e-6));
    for (let k = 0; k < arr.length; k++) arr[k] = Math.max(-0.5, Math.min(0.5, (arr[k] - mean) / (std * 3)));
    this.noise.set(i, arr);
    return arr;
  }

  corner(r, c) { return this.map.corners[r * (this.map.cols + 1) + c]; }
  blendAt(r, c) { const b = this.map.blend; return b ? (b[r * (this.map.cols + 1) + c] || 0) : 0; }

  // Render tiles c0..c1, r0..r1 (inclusive) into the canvas.
  render(c0 = 0, r0 = 0, c1 = this.map.cols - 1, r1 = this.map.rows - 1) {
    const { W, H, scale } = this, T = TILE * scale, data = this.img.data;
    c0 = Math.max(0, c0); r0 = Math.max(0, r0); c1 = Math.min(this.map.cols - 1, c1); r1 = Math.min(this.map.rows - 1, r1);
    const x0 = Math.floor(c0 * T), y0 = Math.floor(r0 * T), x1 = Math.min(W, Math.ceil((c1 + 1) * T)), y1 = Math.min(H, Math.ceil((r1 + 1) * T));
    const m = Math.ceil(6 * scale) + 1; // margin for the shadow lookup
    const hx0 = Math.max(0, x0 - m), hy0 = Math.max(0, y0 - m), hw = x1 - hx0, hh = y1 - hy0;
    const height = new Float32Array(hw * hh);
    const sharp = 36, ks = [0, 0, 0, 0], ws = [0, 0, 0, 0];
    const pass = (writeColor, px0, py0, px1, py1) => {
      for (let y = py0; y < py1; y++) {
        const ty = (y + 0.5) / T, r = Math.min(this.map.rows - 1, Math.floor(ty)), fy = ty - r;
        for (let x = px0; x < px1; x++) {
          const tx = (x + 0.5) / T, c = Math.min(this.map.cols - 1, Math.floor(tx)), fx = tx - c;
          const q = [this.corner(r, c), this.corner(r, c + 1), this.corner(r + 1, c), this.corner(r + 1, c + 1)];
          const qw = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
          let n = 0;
          for (let j = 0; j < 4; j++) {
            let idx = ks.indexOf(q[j], 0);
            if (idx < 0 || idx >= n) { idx = n++; ks[idx] = q[j]; ws[idx] = 0; }
            ws[idx] += qw[j];
          }
          // 섞기 붓 (blend): 1 = 부드럽게(넓게 페이드), 2 = 거칠게(마른 붓처럼 찢긴 경계). tools/tilegen/terrain.py와 같은 계산
          let soft = 0, rough = 0;
          if (this.map.blend && n > 1) {
            const bq = [this.blendAt(r, c), this.blendAt(r, c + 1), this.blendAt(r + 1, c), this.blendAt(r + 1, c + 1)];
            for (let j = 0; j < 4; j++) { if (bq[j] === 1) soft += qw[j]; else if (bq[j] === 2) rough += qw[j]; }
          }
          let best = -1e9;
          const sc = [0, 0, 0, 0];
          for (let j = 0; j < n; j++) {
            const k = ks[j];
            let s;
            if (n === 1) s = 1;
            else if (soft || rough) {
              const amp = (this.def(k).edgeAmp ?? 0.5) * this.noiseFor(k)[y * W + x] * (1 - 0.6 * soft) * (1 + 0.8 * rough);
              const torn = rough ? rough * (1.6 * (fbm(x / (40 * scale), y / (40 * scale), 700 + k * 13, 3) - 0.5) + 0.9 * (fbm(x / (14 * scale), y / (14 * scale), 900 + k * 7, 2) - 0.5)) : 0;
              s = ws[j] + amp + torn + 0.01 * k;
            } else s = ws[j] + (this.def(k).edgeAmp ?? 0.5) * this.noiseFor(k)[y * W + x] + 0.01 * k;
            sc[j] = s; if (s > best) best = s;
          }
          const sh = soft ? sharp * (1 - soft) + 3.5 * soft : sharp;
          let tot = 0, R = 0, G = 0, B = 0, Hh = 0;
          for (let j = 0; j < n; j++) {
            const e = Math.exp(sh * (sc[j] - best)); tot += e; Hh += e * ks[j];
            if (writeColor) {
              const t = this.tex[ks[j]], ti = ((y % t.h) * t.w + (x % t.w)) * 4;
              R += e * t.data[ti]; G += e * t.data[ti + 1]; B += e * t.data[ti + 2];
            }
          }
          height[(y - hy0) * hw + (x - hx0)] = Hh / tot;
          if (writeColor) { const i = (y * W + x) * 4; data[i] = R / tot; data[i + 1] = G / tot; data[i + 2] = B / tot; data[i + 3] = 255; }
        }
      }
    };
    // heights for the margin (no color), then colors + heights for the region
    pass(false, hx0, hy0, x1, y0);
    pass(false, hx0, y0, x0, y1);
    pass(true, x0, y0, x1, y1);
    // soft drop shadow from higher terrain toward the lower right (light from the upper left)
    const d = Math.max(1, Math.round(4 * scale));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const hy = y - hy0, hx = x - hx0, here = height[hy * hw + hx];
      let drop = 0, cnt = 0;
      for (let k = d - 1; k <= d + 1; k++) {
        const sy = hy - k, sx = hx - k;
        if (sy >= 0 && sx >= 0) { drop += Math.max(0, height[sy * hw + sx] - here); cnt++; }
      }
      if (cnt) {
        const f = 1 - 0.35 * Math.min(1, drop / cnt), i = (y * W + x) * 4;
        data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
      }
    }
    this.ctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
  }
}

// ---------- 높낮이 (높이 붓): 높은 칸 아래쪽 경계에 절벽 벽 / 언덕 비탈을 그린다 ----------
// 게임의 tools/sync_game.py apply_heights와 같은 생각: 칸 높이 → 잡음으로 구불구불한 경계 → 아래쪽에 벽.
export const CLIFF_FACE = 'assets/_inbox/codex/CX-018/cliff_face_strip.png';
export const CLIFF_LIP = 'assets/_inbox/codex/CX-018/cliff_grass_lip.png';

// 위아래 빈 띠를 잘라 낸 절벽 띠 그림 (없으면 null)
export async function loadStrip(store, file) {
  try {
    const img = new Image();
    img.src = await store.blobUrl(file);
    await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let top = -1, bot = -1;
    for (let y = 0; y < c.height; y++) {
      let s = 0;
      for (let x = 0; x < c.width; x += 4) { const i = (y * c.width + x) * 4; s += (d[i] + d[i + 1] + d[i + 2]) / 3 * d[i + 3] / 255; }
      if (s / (c.width / 4) > 25) { if (top < 0) top = y; bot = y; }
    }
    if (top < 0) return null;
    const o = document.createElement('canvas'); o.width = c.width; o.height = bot - top + 1;
    o.getContext('2d').drawImage(c, 0, top, c.width, o.height, 0, 0, c.width, o.height);
    return o;
  } catch { return null; }
}

export function hasHeights(map) { return Array.isArray(map.heights) && map.heights.some(v => v > 0); }

// g: 바닥 그림이 그려진 캔버스(배율 scale)의 2d 문맥. strips: {face, lip}
export function drawHeights(g, map, scale, strips, cache = {}) {
  if (!hasHeights(map)) return;
  const { cols, rows } = map, T = TILE * scale;
  const W = Math.round(cols * TILE * scale), H = Math.round(rows * TILE * scale);
  if (!cache.noise || cache.noise.length !== W * H) {
    const cell = Math.max(48, (cols * TILE * scale) / Math.max(6, cols >> 1));
    cache.noise = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) cache.noise[y * W + x] = fbm(x / cell, y / cell, 4242, 4) - 0.5;
  }
  const hAt = (r, c) => map.heights[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))] || 0;
  const hillAt = (r, c) => (map.hills || [])[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))] > 0;
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const face = strips?.face, lip = strips?.lip;
  const faceH = Math.max(4, Math.round(T)), lipH = Math.max(3, Math.round(faceH / 3));
  const sample = (cv, hh) => { if (!cv) return null; const c = document.createElement('canvas'); c.width = Math.round(cv.width * hh / cv.height); c.height = hh; c.getContext('2d').drawImage(cv, 0, 0, c.width, hh); return { w: c.width, h: hh, d: c.getContext('2d').getImageData(0, 0, c.width, hh).data }; };
  const F = sample(face, faceH), Lp = sample(lip, lipH);
  const maxH = Math.max(...map.heights);
  for (let lvl = 1; lvl <= maxH; lvl++) {
    const plat = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const ty = (y + 0.5) / T - 0.5, r0 = Math.floor(ty), fy = ty - r0;
      for (let x = 0; x < W; x++) {
        const tx = (x + 0.5) / T - 0.5, c0 = Math.floor(tx), fx = tx - c0;
        const v = (hAt(r0, c0) >= lvl) * (1 - fx) * (1 - fy) + (hAt(r0, c0 + 1) >= lvl) * fx * (1 - fy) + (hAt(r0 + 1, c0) >= lvl) * (1 - fx) * fy + (hAt(r0 + 1, c0 + 1) >= lvl) * fx * fy;
        plat[y * W + x] = v + 0.55 * cache.noise[y * W + x] > 0.5 ? 1 : 0;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let yb = 0; yb < H - 1; yb++) {
        if (!(plat[yb * W + x] && !plat[(yb + 1) * W + x])) continue;
        const hill = hillAt(Math.floor((yb - 20 * scale) / T), Math.floor(x / T)) || hillAt(Math.floor(yb / T), Math.floor(x / T));
        for (let v = 0; v < faceH && yb + 1 + v < H; v++) {
          const y = yb + 1 + v, i = (y * W + x) * 4;
          if (plat[y * W + x]) break;
          if (hill) { const k = 0.70 + 0.30 * Math.pow(v / faceH, 0.7); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; continue; }
          const k = 0.82 + 0.18 * (1 - v / faceH);
          if (F) { const fi = (v * F.w + (x % F.w)) * 4, a = F.d[fi + 3] / 255, rk = 118 * (1 - a), gk = 104 * (1 - a), bk = 88 * (1 - a); d[i] = (F.d[fi] * a + rk) * k; d[i + 1] = (F.d[fi + 1] * a + gk) * k; d[i + 2] = (F.d[fi + 2] * a + bk) * k; }
          else { d[i] = 118 * k; d[i + 1] = 104 * k; d[i + 2] = 88 * k; }
        }
        if (hill) continue;
        for (let v = 0; v < 20 * scale; v++) {           // 절벽 발치 그늘
          const y = yb + 1 + faceH + v; if (y >= H || plat[y * W + x]) break;
          const i = (y * W + x) * 4, k = 0.64 + 0.36 * v / (20 * scale); d[i] *= k; d[i + 1] *= k; d[i + 2] *= k;
        }
        if (Lp) {                                          // 위 가장자리에 늘어진 풀
          const top = yb - Math.floor(lipH / 3);
          for (let v = 0; v < lipH; v++) {
            const y = top + v; if (y < 0 || y >= H) continue;
            const li = (v * Lp.w + (x % Lp.w)) * 4, a = Lp.d[li + 3] / 255, i = (y * W + x) * 4;
            d[i] = d[i] * (1 - a) + Lp.d[li] * a; d[i + 1] = d[i + 1] * (1 - a) + Lp.d[li + 1] * a; d[i + 2] = d[i + 2] * (1 - a) + Lp.d[li + 2] * a;
          }
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
}
