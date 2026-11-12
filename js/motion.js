// Motion previews: field 8-direction walk, battle-map idle loop, side-view battle animations.
// Reads the same data the game uses (data/sprites.json), so whatever the game uses is what you see here.
import { h } from './ui.js';

export const SPRITES = 'data/sprites.json';
const DIR8 = [['up_left', '↖'], ['up', '↑'], ['up_right', '↗'], ['left', '←'], [null, ''], ['right', '→'], ['down_left', '↙'], ['down', '↓'], ['down_right', '↘']];

const imgCache = new Map();
function loadImg(store, file) {
  if (!imgCache.has(file)) imgCache.set(file, store.blobUrl(file).then(u => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; })));
  return imgCache.get(file);
}

// One animated cell. frames = list of frame indexes in the sheet (index = row*cols + col).
export function motionCanvas(store, sheet, frames, fps = 8, height = 120) {
  const fw = sheet.frame[0], fh = sheet.frame[1];
  const cols = sheet.cols || null;
  const c = h('canvas', { class: 'motion-canvas', width: fw, height: fh, style: { height: `${height}px` } });
  const g = c.getContext('2d');
  let n = 0, timer = null;
  loadImg(store, sheet.file).then(img => {
    const perRow = cols || Math.max(1, Math.round(img.width / fw));
    const tick = () => {
      if (!c.isConnected && n > 2) { clearInterval(timer); return; }
      const idx = frames[n % frames.length];
      g.clearRect(0, 0, fw, fh);
      g.drawImage(img, (idx % perRow) * fw, Math.floor(idx / perRow) * fh, fw, fh, 0, 0, fw, fh);
      n++;
    };
    tick();
    timer = setInterval(tick, 1000 / fps);
  }).catch(() => c.replaceWith(h('div', { class: 'muted' }, '그림 없음')));
  return c;
}

// 8-direction walk as a 3x3 compass (center: label)
function walkCompass(store, sheet, label, height) {
  const per = sheet.frame && sheet.walk ? sheet.walk.length + 1 : 9;
  return h('div', { class: 'compass' }, DIR8.map(([d, arrow]) => {
    if (!d) return h('div', { class: 'compass-mid' }, label);
    const row = sheet.dirs8?.[d];
    if (row == null) return h('div');
    const frames = (sheet.walk || [0]).map(c => row * per + c);
    return h('div', { class: 'compass-cell', title: d }, motionCanvas(store, { ...sheet, cols: per }, frames, 10, height), h('small', { class: 'muted' }, arrow));
  }));
}

function cutinRow(store, sp, cut) {
  const sheet = sp.sheets?.[cut.sheet];
  if (!sheet) return null;
  const names = { attack: '공격', hit: '맞기', defeated: '쓰러짐' };
  const anims = Object.entries(cut.anims || {});
  const idle = cut.acts?.idle;
  const list = [];
  if (Array.isArray(idle) && idle.length > 1) list.push(['대기', idle, 6]);
  let sk = 0;
  for (const [k, a] of anims) list.push([names[k] || (k.startsWith('skill:') ? `기술 ${++sk}` : k), a.frames || [], a.fps || 10]);
  return h('div', { class: 'motion-row' }, list.filter(([, f]) => f.length).map(([label, frames, fps]) =>
    h('div', { class: 'motion-item' }, motionCanvas(store, { ...sheet, cols: sheet.cols || 8 }, frames, fps, 140), h('div', { class: 'cap' }, label))));
}

// All motions of one character id (field id or monster id)
export function motionCard(store, sp, id, name) {
  const sheets = sp.sheets || {};
  const fieldKey = sp.npcMap?.[id]?.sheet || (sheets[`${id}_walk8`] ? `${id}_walk8` : null);
  const walk = fieldKey && sheets[fieldKey]?.dirs8 ? sheets[fieldKey] : null;
  const bkey = sp.battleSprites?.[id];
  const bidle = bkey && sheets[bkey]?.idleLoop ? sheets[bkey] : null;
  const cut = sp.cutins?.[id];
  if (!walk && !bidle && !cut) return null;
  return h('div', { class: 'card motion-card' },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, `🏃 동작 미리보기${name ? ' · ' + name : ''}`),
      h('span', { class: 'muted', style: { fontSize: '12px' } }, '게임이 지금 쓰는 그림 (data/sprites.json) — 새로 바꾸면 여기도 바로 바뀌어요')),
    h('div', { class: 'motion-wrap' },
      walk && h('div', { class: 'motion-block' }, h('b', {}, '필드 걷기 (8방향)'), walkCompass(store, walk, '걷기', 76)),
      bidle && h('div', { class: 'motion-block' }, h('b', {}, '전투 맵 대기'),
        h('div', { class: 'checker', style: { padding: '8px' } }, motionCanvas(store, { ...bidle, cols: bidle.idleLoop.length }, bidle.idleLoop, bidle.fps || 8, 150)))),
    cut && h('div', { class: 'motion-block' }, h('b', {}, '전투 애니메이션 (옆모습)'), cutinRow(store, sp, cut)));
}

// Every character / monster that has motions, on one page
export async function motionOverview(ctx, chars) {
  const { data: sp } = await ctx.store.getJSON(SPRITES, { sheets: {} });
  const ids = new Set();
  for (const k of Object.keys(sp.sheets || {})) { const m = k.match(/^(.*)_(walk8|bidle8)$/); if (m) ids.add(m[1]); }
  for (const k of Object.keys(sp.cutins || {})) ids.add(k);
  const gid = Object.fromEntries(Object.entries(sp.npcMap || {}).map(([g, v]) => [v.sheet?.replace(/_walk8$/, ''), g]));
  const nameOf = id => chars.characters.find(c => c.id === id || c.id === gid[id])?.name || id;
  const order = [...ids].sort((a, b) => (chars.characters.findIndex(c => c.id === a) + 1 || 999) - (chars.characters.findIndex(c => c.id === b) + 1 || 999));
  return h('div', {}, h('p', { class: 'muted' }, '필드 걷기·전투 맵 대기·전투 애니메이션을 한눈에 봐요. 이상한 동작이 있으면 그 인물 이름과 방향을 요청함에 남겨 주세요.'),
    order.map(id => motionCard(ctx.store, { ...sp, npcMap: { ...sp.npcMap, [id]: sp.npcMap?.[gid[id] || id] || sp.npcMap?.[id] } }, id, nameOf(id))).filter(Boolean));
}

// 그림 파일 하나가 게임에서 어떻게 움직이는지 (그림 상세 창). 게임이 그 파일을 안 쓰면 null
export function appliedPreview(store, sp, file) {
  const keys = Object.entries(sp.sheets || {}).filter(([, v]) => v.file === file).map(([k]) => k);
  const parts = [];
  for (const k of keys) {
    const sh = sp.sheets[k];
    if (sh.dirs8) parts.push(h('div', { class: 'motion-block' }, h('b', {}, '필드 걷기 (8방향)'), walkCompass(store, sh, '걷기', 76)));
    else if (sh.idleLoop) parts.push(h('div', { class: 'motion-block' }, h('b', {}, `전투 맵 대기 (초당 ${sh.fps || 8}칸)`),
      h('div', { class: 'checker', style: { padding: '8px' } }, motionCanvas(store, { ...sh, cols: sh.idleLoop.length }, sh.idleLoop, sh.fps || 8, 150))));
    for (const [id, cut] of Object.entries(sp.cutins || {})) if (cut.sheet === k) parts.push(h('div', { class: 'motion-block' }, h('b', {}, '전투 애니메이션 (옆모습)'), cutinRow(store, sp, cut)));
  }
  return parts.length ? h('div', { class: 'motion-wrap' }, parts) : null;
}
