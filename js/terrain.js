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
          let best = -1e9;
          const sc = [0, 0, 0, 0];
          for (let j = 0; j < n; j++) {
            const k = ks[j];
            const s = n === 1 ? 1 : ws[j] + (this.def(k).edgeAmp ?? 0.5) * this.noiseFor(k)[y * W + x] + 0.01 * k;
            sc[j] = s; if (s > best) best = s;
          }
          let tot = 0, R = 0, G = 0, B = 0, Hh = 0;
          for (let j = 0; j < n; j++) {
            const e = Math.exp(sharp * (sc[j] - best)); tot += e; Hh += e * ks[j];
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
