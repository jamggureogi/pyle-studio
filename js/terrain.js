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

// 지형이 닿는 정도(0~1)에 따라 경계 잡음을 부드럽게 줄인다. 딱 끊으면 칸 경계에서 잘린 조각이 남는다 (RV-502)
function ramp(w) { const t = Math.min(1, Math.max(0, w / 0.3)); return t * t * (3 - 2 * t); }

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
    // 지형별 덮인 정도 (0~255): 그림자·베벨 효과에 씀
    this.cover = map.terrains.map(() => new Uint8Array(this.W * this.H));
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
              const amp = (this.def(k).edgeAmp ?? 0.5) * this.noiseFor(k)[y * W + x] * (1 - 0.6 * soft) * (1 + 0.8 * rough) * ramp(ws[j]);
              const torn = rough ? rough * (1.6 * (fbm(x / (40 * scale), y / (40 * scale), 700 + k * 13, 3) - 0.5) + 0.9 * (fbm(x / (14 * scale), y / (14 * scale), 900 + k * 7, 2) - 0.5)) : 0;
              s = ws[j] + amp + torn * ramp(ws[j]) + 0.01 * k;
            } else s = ws[j] + (this.def(k).edgeAmp ?? 0.5) * this.noiseFor(k)[y * W + x] * ramp(ws[j]) + 0.01 * k;
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
          if (writeColor) {
            const i = (y * W + x) * 4, pi = y * W + x; data[i] = R / tot; data[i + 1] = G / tot; data[i + 2] = B / tot; data[i + 3] = 255;
            for (let t = 0; t < this.cover.length; t++) this.cover[t][pi] = 0;
            for (let j = 0; j < n; j++) this.cover[ks[j]][pi] = Math.round(255 * Math.exp(sh * (sc[j] - best)) / tot);
          }
        }
      }
    };
    // heights for the margin (no color), then colors + heights for the region
    pass(false, hx0, hy0, x1, y0);
    pass(false, hx0, y0, x0, y1);
    pass(true, x0, y0, x1, y1);
    // (예전의 고정 그림자는 없앰: 이제 바닥 재질 탭의 그림자·베벨 효과로 정함, 게임과 같게)
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
export function drawHeights(g, map, scale, strips, cache = {}, renderer = null) {
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
    const base = new Float32Array(d.length); for (let i = 0; i < d.length; i++) base[i] = d[i];
    const mul = (i, k) => { d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); };
    const rockAt = (i, v, x, k) => {
      if (F) { const fi = ((v % F.h) * F.w + (x % F.w)) * 4, a = F.d[fi + 3] / 255; d[i] = (F.d[fi] * a + 118 * (1 - a)) * k; d[i + 1] = (F.d[fi + 1] * a + 104 * (1 - a)) * k; d[i + 2] = (F.d[fi + 2] * a + 88 * (1 - a)) * k; }
      else { d[i] = 118 * k; d[i + 1] = 104 * k; d[i + 2] = 88 * k; }
    };
    const P = (x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : plat[y * W + x];
    // 1) 윗면: 같은 재질이지만 무늬를 어긋나게 다시 칠하고(아래 땅과 무늬가 이어지지 않게) 살짝 밝게 + 가장자리 테
    const pdy = Math.round((37 * lvl + 11) * scale), pdx = Math.round((23 * lvl + 5) * scale);
    const phase = (x, y, outArr) => {          // 지형별 덮인 정도 × 옮긴 무늬 (게임 apply_heights와 같은 계산)
      outArr[0] = outArr[1] = outArr[2] = 0;
      if (!renderer) { const i = (y * W + x) * 4; outArr[0] = base[i]; outArr[1] = base[i + 1]; outArr[2] = base[i + 2]; return; }
      for (let k = 0; k < renderer.cover.length; k++) {
        const w = renderer.cover[k][y * W + x] / 255; if (!w) continue;
        const t = renderer.tex[k], ti = (((y + pdy) % t.h) * t.w + ((x + pdx) % t.w)) * 4;
        outArr[0] += w * t.data[ti]; outArr[1] += w * t.data[ti + 1]; outArr[2] += w * t.data[ti + 2];
      }
    };
    const pc = [0, 0, 0];
    const rim = Math.max(2, Math.round(5 * scale));
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!plat[y * W + x]) continue;
      const i = (y * W + x) * 4;
      phase(x, y, pc);
      d[i] = Math.min(255, pc[0] * 1.06 + 3); d[i + 1] = Math.min(255, pc[1] * 1.06 + 3); d[i + 2] = Math.min(255, pc[2] * 1.06 + 3);
      if (!P(x - rim, y) || !P(x, y - rim)) mul(i, 1.16); else if (!P(x + rim, y)) mul(i, 0.8);
    }
    const sideW = Math.max(3, Math.round(14 * scale)), slopeLen = Math.round(faceH * 1.5), taper = Math.max(4, Math.round(40 * scale));
    // 2) 위쪽 경계 그늘, 3) 좌우 옆벽
    for (let y = 1; y < H; y++) for (let x = 0; x < W; x++) {
      if (plat[y * W + x] && !plat[(y - 1) * W + x]) for (let v = 0; v <= Math.round(6 * scale) && y - 1 - v >= 0; v++) mul(((y - 1 - v) * W + x) * 4, 0.7 + 0.22 * v / (6 * scale));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) {
      const a = plat[y * W + x], b = plat[y * W + x + 1];
      if (a && !b) for (let k = 1; k <= sideW && x + k < W && !plat[y * W + x + k]; k++) rockAt((y * W + x + k) * 4, y, x + k, 0.62 + 0.18 * k / sideW);
      if (!a && b) for (let k = 0; k < sideW && x - k >= 0 && !plat[y * W + x - k]; k++) rockAt((y * W + x - k) * 4, y, x - k, 0.95 - 0.15 * k / sideW);
    }
    // 4) 아래쪽 경계: 절벽 벽(비탈 옆은 끝이 비스듬히) 또는 언덕 경사면
    const isHill = (x, yb) => hillAt(Math.floor((yb - 20 * scale) / T), Math.floor(x / T)) || hillAt(Math.floor(yb / T), Math.floor(x / T));
    for (let x = 0; x < W; x++) {
      for (let yb = 0; yb < H - 1; yb++) {
        if (!(plat[yb * W + x] && !plat[(yb + 1) * W + x])) continue;
        if (isHill(x, yb)) {
          for (let v = 0; v < faceH && yb + 1 + v < H; v++) {   // 비탈: 윗면 무늬 → 아랫면 무늬로 매끄럽게
            const y = yb + 1 + v, i = (y * W + x) * 4, t = v / faceH, w = t * t * (3 - 2 * t), k = 1.03 - 0.14 * Math.sin(Math.PI * t);
            phase(x, y, pc);
            for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, (pc[c] * (1 - w) + base[i + c] * w) * k);
          }
          continue;
        }
        let fh = faceH;
        for (let k = 1; k <= taper; k++) if (isHill(x - k, yb) || isHill(x + k, yb)) { fh = Math.max(3, Math.round(faceH * k / taper)); break; }
        for (let v = 0; v < fh && yb + 1 + v < H; v++) {
          const y = yb + 1 + v;
          if (plat[y * W + x]) break;
          rockAt((y * W + x) * 4, v, x, 0.82 + 0.18 * (1 - v / faceH));
        }
        for (let v = 0; v < 20 * scale; v++) {           // 절벽 발치 그늘
          const y = yb + 1 + fh + v; if (y >= H || plat[y * W + x]) break;
          mul((y * W + x) * 4, 0.64 + 0.36 * v / (20 * scale));
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

// ---------- 지형 효과: 그림자(드롭섀도우)·베벨 (tools/tilegen/terrain.py apply_effects와 같은 계산) ----------
export const SHADOW_DEFAULT = { on: true, angle: 135, distance: 10, size: 12, opacity: 0.45, color: '#1a1408' };
export const BEVEL_DEFAULT = { on: true, angle: 135, size: 10, depth: 1, highlight: 0.25, shade: 0.35 };

function boxBlur(a, W, H, r) {
  r = Math.round(r);
  if (r < 1) return a;
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    const src = pass === 0 ? a : out;
    for (let y = 0; y < H; y++) {             // 가로
      let acc = 0; const row = y * W;
      for (let k = -r; k <= r; k++) acc += src[row + Math.min(W - 1, Math.max(0, k))];
      for (let x = 0; x < W; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
    }
    for (let x = 0; x < W; x++) {             // 세로
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
      for (let y = 0; y < H; y++) { out[y * W + x] = acc / n; acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x]; }
    }
  }
  return out;
}

export function hasEffects(defs, ids) {
  return ids.some(id => { const d = defs.find(x => x.id === id) || {}; return d.shadow?.on || d.bevel?.on; });
}

// data: RGBA 픽셀, cover: 지형 번호별 덮인 정도(Uint8), ids: 맵의 지형 id 목록(아래→위), scale: 그림 배율
export function applyEffects(data, W, H, cover, ids, defs, scale = 1) {
  const N = W * H;
  const present = ids.map((id, k) => k).filter(k => cover[k].some(v => v > 0));
  const above = new Float32Array(N);
  const coverAbove = {};
  for (let i = present.length - 1; i >= 0; i--) {
    const k = present[i];
    for (let p = 0; p < N; p++) above[p] += cover[k][p] / 255;
    coverAbove[k] = Float32Array.from(above);
  }
  for (const k of present) {
    const d = defs.find(x => x.id === ids[k]) || {};
    const sh = d.shadow, bv = d.bevel;
    if (!sh?.on && !bv?.on) continue;
    const C = new Float32Array(N);
    for (let p = 0; p < N; p++) C[p] = cover[k][p] / 255;
    if (sh?.on) {
      const a = (sh.angle ?? 135) * Math.PI / 180, dist = (sh.distance ?? 10) * scale;
      const dx = Math.round(-dist * Math.cos(a)), dy = Math.round(dist * Math.sin(a));
      const shifted = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.min(W - 1, Math.max(0, x - dx)), sy = Math.min(H - 1, Math.max(0, y - dy));
        shifted[y * W + x] = C[sy * W + sx];
      }
      const S = boxBlur(shifted, W, H, (sh.size ?? 12) * scale / 2);
      const op = sh.opacity ?? 0.45, col = parseInt((sh.color || '#1a1408').slice(1), 16), cr = col >> 16 & 255, cg = col >> 8 & 255, cb = col & 255;
      const ca = coverAbove[k];
      for (let p = 0; p < N; p++) {
        const al = Math.min(1, Math.max(0, op * S[p] * (1 - Math.min(1, ca[p]))));
        if (al <= 0) continue;
        const i = p * 4; data[i] = data[i] * (1 - al) + cr * al; data[i + 1] = data[i + 1] * (1 - al) + cg * al; data[i + 2] = data[i + 2] * (1 - al) + cb * al;
      }
    }
    if (bv?.on) {
      const r = Math.max(1, (bv.size ?? 10) * scale / 2);
      const B = boxBlur(C, W, H, r);
      const a = (bv.angle ?? 135) * Math.PI / 180, lx = Math.cos(a), ly = -Math.sin(a), depth = bv.depth ?? 1, hiK = bv.highlight ?? 0.25, loK = bv.shade ?? 0.35, nr = 2 * Math.round(r) + 1;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const p = y * W + x, m = C[p];
        if (m <= 0) continue;
        const gx = (B[p + 1] - B[p - 1]) / 2, gy = (B[p + W] - B[p - W]) / 2;
        const f = (-gx * lx - gy * ly) * nr * depth, i = p * 4;
        if (f > 0) { const hi = Math.min(1, f) * m * hiK; data[i] += (255 - data[i]) * hi; data[i + 1] += (255 - data[i + 1]) * hi; data[i + 2] += (255 - data[i + 2]) * hi; }
        else if (f < 0) { const lo = 1 - Math.min(1, -f) * m * loK; data[i] *= lo; data[i + 1] *= lo; data[i + 2] *= lo; }
      }
    }
  }
}
