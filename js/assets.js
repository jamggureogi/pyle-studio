// Shared image-asset helpers: registry access, upload, lazy thumbnails, viewer.
import { h, toast, modal } from './ui.js';
import { bytesToB64 } from './store.js';

export const REGISTRY = 'data/asset_registry.json';
export const CHARS = 'data/characters.json';
export const KINDS = {
  portrait: '초상화', field: '필드 스프라이트', battle: '전투 스프라이트', cutin: '전투 애니메이션',
  tile: '바닥 재질', decor: '바닥 장식', object: '맵 사물', effect: '이펙트', ui: 'UI', event: '이벤트 일러스트', reference: '디자인 시트·참고 자료',
};
export const STATUSES = ['후보', '승인', '사용중', '보관'];
export const statusClass = { 후보: 'warn', 승인: 'info', 사용중: 'ok', 보관: '' };

export async function loadRegistry(store) {
  const { data } = await store.getJSON(REGISTRY, { assets: [] });
  return data.assets || [];
}

export function updateRegistry(store, fn, message) {
  return store.updateJSON(REGISTRY, d => { d.assets ||= []; fn(d.assets); return d; }, message, { assets: [] });
}

export function safeName(name, fallback) {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : 'png';
  let base = (dot > 0 ? name.slice(0, dot) : name).toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!base) base = fallback;
  return `${base}.${ext}`;
}

// Content fingerprint: the same picture gives the same value whatever its file name.
export async function sha256Hex(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Mark items whose content already exists in the registry (or twice in this batch).
export async function findDuplicates(store, items) {
  const reg = await loadRegistry(store);
  const known = new Map(reg.filter(a => a.sha256).map(a => [a.sha256, a]));
  const seen = new Map();
  for (const it of items) {
    it.sha256 ||= await sha256Hex(await it.file.arrayBuffer());
    it.dupOf = known.get(it.sha256) || null;
    it.dupInBatch = seen.has(it.sha256) ? seen.get(it.sha256) : null;
    if (!seen.has(it.sha256)) seen.set(it.sha256, it.file.name);
  }
  return items;
}

export function fileToB64(file) {
  return file.arrayBuffer().then(buf => bytesToB64(new Uint8Array(buf)));
}

// Upload files to assets/_inbox and register them as candidates in one registry commit.
export async function uploadAssets(store, items, onProgress) {
  const today = new Date().toISOString().slice(0, 10);
  await findDuplicates(store, items);
  items = items.filter(it => !it.dupOf && !it.dupInBatch);
  const existing = new Set((await loadRegistry(store)).map(a => a.file));
  const added = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let name = safeName(it.file.name, `${it.kind}_${it.owner || 'misc'}_${Date.now().toString(36)}`);
    let path = `assets/_inbox/${name}`;
    for (let n = 2; existing.has(path); n++) path = `assets/_inbox/${name.replace(/(\.\w+)$/, `_${n}$1`)}`;
    existing.add(path);
    onProgress?.(i, items.length, it.file.name);
    await store.putBinary(path, await fileToB64(it.file), null, `그림 올리기: ${path.split('/').pop()}`);
    added.push({
      id: path.split('/').pop().replace(/\.\w+$/, ''), kind: it.kind, ...(it.owner ? { owner: it.owner } : {}),
      file: path, status: '후보', note: it.note || '', createdBy: '사용자', createdAt: today, sha256: it.sha256,
    });
  }
  await updateRegistry(store, list => list.push(...added), `그림 ${added.length}장 후보 등록`);
  return added;
}

// Lazy thumbnail: only downloads when scrolled into view.
const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); e.target._load?.(); }
}, { rootMargin: '200px' }) : null;

export function thumb(store, file, cls = 'thumb') {
  const box = h('div', { class: cls }, h('span', { class: 'muted' }, '…'));
  box._load = () => store.blobUrl(file)
    .then(u => box.replaceChildren(h('img', { src: u, loading: 'lazy' })))
    .catch(() => box.replaceChildren(h('span', { class: 'muted' }, '없음')));
  if (io) io.observe(box); else box._load();
  return box;
}

// Plays a sprite sheet frame by frame on a canvas.
export function spritePlayer(url, frames) {
  const canvas = h('canvas', { class: 'sprite-canvas' });
  const ctx = canvas.getContext('2d');
  const img = new Image();
  let timer = null, f = 0;
  const cfg = { cols: 4, rows: 1, fps: 8, row: 0, ...frames };
  const draw = () => {
    if (!img.width) return;
    const fw = img.width / cfg.cols, fh = img.height / cfg.rows;
    canvas.width = fw; canvas.height = fh;
    ctx.clearRect(0, 0, fw, fh);
    ctx.drawImage(img, (f % cfg.cols) * fw, cfg.row * fh, fw, fh, 0, 0, fw, fh);
    f++;
  };
  const restart = () => { clearInterval(timer); f = 0; draw(); timer = setInterval(draw, 1000 / Math.max(1, cfg.fps)); };
  img.onload = restart;
  img.src = url;
  canvas._set = patch => { Object.assign(cfg, patch); restart(); };
  canvas._stop = () => clearInterval(timer);
  canvas._cfg = cfg;
  return canvas;
}

export async function viewImage(store, file, title, extra) {
  const url = await store.blobUrl(file);
  const img = h('img', { src: url, class: 'viewer-img' });
  const info = h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '6px' } }, file);
  img.onload = () => info.textContent = `${file} · ${img.naturalWidth}×${img.naturalHeight}px`;
  return modal(title, h('div', {}, h('div', { class: 'checker' }, img), info, extra || null));
}

// Raw source files for Claude to process (sheets to cut, originals from Drive, etc.).
// They go to assets/_source/<folder>/ and are NOT registered as candidates; a request tells Claude.
export async function uploadSources(store, files, folder, note, onProgress) {
  const dir = `assets/_source/${folder}`;
  const existing = new Set((await store.list(dir)).map(f => f.name));
  const saved = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let name = safeName(f.name, `source_${Date.now().toString(36)}`);
    for (let n = 2; existing.has(name); n++) name = name.replace(/(_\d+)?(\.\w+)$/, `_${n}$2`);
    existing.add(name);
    onProgress?.(i, files.length, f.name);
    await store.putBinary(`${dir}/${name}`, await fileToB64(f), null, `원본 올리기: ${dir}/${name}`);
    saved.push(name);
  }
  const now = new Date().toISOString();
  await store.updateJSON('data/requests.json', d => {
    (d.requests ||= []).unshift({
      id: 'req_' + Date.now().toString(36), room: 'character', title: `원본 가공: ${dir} (${saved.length}개)`,
      body: `${note ? note + '\n' : ''}올린 위치: ${dir}/\n파일: ${saved.join(', ')}`,
      status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '',
    });
    return d;
  }, `요청 추가: 원본 가공 ${dir}`, { requests: [] });
  return { dir, saved };
}

// 요청·결정에 붙은 그림 (images: [{file, caption}]) — 작게 보이고 누르면 크게
export function imageStrip(store, images, title) {
  if (!images?.length) return null;
  return h('div', { class: 'thumb-grid req-pics' }, images.map(im => h('div', { class: 'thumb-card', onclick: () => viewImage(store, im.file, im.caption || title) },
    thumb(store, im.file), im.caption && h('div', { class: 'cap', title: im.caption }, im.caption))));
}
