// 3D 맵 배치 (사용자 D-309 + D-348 C): 3D 맵은 충돌 판정을 만질 필요가 없으니 사물을 끌어 옮기고·더하고·지우는 화면만 둔다.
// 끌면 바로 임시 미리보기(구운 그늘 없이), '확정'하면 요청함에 "3D 다시 굽기"를 남겨 맵 팀이 다시 굽는다.
// 자료: data/maps3d/<맵>.layout.json (좌표는 블렌더 m: x 오른쪽, y 안쪽, z 위 → three.js 로는 (x, z, -y)).
// 사물 라이브러리 (사용자 RV-1025): 더할 수 있는 사물은 data/maps3d/object_library.json 에서 읽는다 — 맵 팀이 새 모델을 만들면 거기 한 줄 더함.
import { h, toast, fill } from '../ui.js';
import { newId } from './requests.js';

const PROPS_DIR = 'assets/_inbox/claude/test3d/props/';
const REQUESTS = 'data/requests.json';
const LIB_PATH = 'data/maps3d/object_library.json';
export const layoutPath = id => `data/maps3d/${id}.layout.json`;

const SCALE_DEF = [0.6, 1.5, 0.05];
const ALL = '전체';
// 게임 카메라 (data/maps/<맵>.json view3d.camera 와 같은 느낌): 50° 내려다봄, 망원
const GAME_CAM = { tilt: 50, fov: 11, dist: 49.6 };
const VIEW_CAM = { tilt: 50, fov: 24, dist: 78 };

let LIB = null;
async function lib() {
  if (!LIB) {
    LIB = Promise.all([import('three'), import('three/addons/loaders/GLTFLoader.js'), import('three/addons/controls/OrbitControls.js')])
      .then(([THREE, g, o]) => ({ THREE, GLTFLoader: g.GLTFLoader, OrbitControls: o.OrbitControls }))
      .catch(e => { LIB = null; throw new Error(`3D 그리기 도구(three.js)를 인터넷에서 불러오지 못했어요. 인터넷 연결을 확인해 주세요. (${e.message})`); });
  }
  return LIB;
}

// 모델 glb 는 한 번만 불러 두고 복제해서 씀 (store 가 바뀌면 새로). 카드 그림·폴더 목록도 같이 둠
let MODELS = { store: null, map: new Map(), thumbs: new Map(), dirs: new Map(), lib: null };
function cacheFor(store) {
  if (MODELS.store !== store) MODELS = { store, map: new Map(), thumbs: new Map(), dirs: new Map(), lib: null };
  return MODELS;
}
function loadModel(store, path) {
  const C = cacheFor(store);
  if (!C.map.has(path)) {
    const p = (async () => {
      const { GLTFLoader } = await lib();
      const url = await store.blobUrl(path);
      const g = await new GLTFLoader().loadAsync(url);
      return g.scene;
    })();
    p.catch(() => C.map.delete(path));
    C.map.set(path, p);
  }
  return C.map.get(path);
}

// ---------- 사물 라이브러리 ----------
function normLib(d) {
  return { missing: !d, items: Array.isArray(d?.items) ? d.items.filter(e => e && e.id && e.kind) : [],
    categories: Array.isArray(d?.categories) ? d.categories : [], kinds: d?.kinds || {} };
}
function loadLibrary(store) {
  const C = cacheFor(store);
  C.lib ||= store.getJSON(LIB_PATH, null).then(r => normLib(r.data)).catch(e => { console.error(e); return normLib(null); });
  return C.lib;
}
// 배치 목록의 사물 하나 → 라이브러리 카드 (모양(model)까지 같은 것 먼저)
function entryFor(LB, o) {
  const same = LB.items.filter(e => e.kind === o.kind);
  const exact = same.find(e => e.defaults?.model != null && e.defaults.model === o.model);
  if (exact) return exact;
  // 모양 구분이 없으면 처음 크기가 가장 가까운 것 (바위 작은·보통·큰)
  const plain = same.filter(e => e.defaults?.model == null);
  const ds = e => Math.abs((e.defaults?.scale ?? 1) - (o.scale ?? 1));
  return plain.sort((a, b) => ds(a) - ds(b))[0] || same[0] || null;
}
const kindName = (LB, k) => LB?.kinds[k]?.name || k;
const isNewKind = (LB, k) => !!LB && !LB.missing && !LB.kinds[k]?.bake;
const catIcon = (LB, c) => LB?.categories.find(x => x.id === c)?.icon || '📦';
// 놓을 사물 하나 만들기 (id 는 놓을 때). 키 순서는 맵 팀 배치 목록과 같게: id, kind, model, pos, rot, scale, 그 밖
function protoOf(e) {
  const d = e.defaults || {};
  const o = { id: null, kind: e.kind };
  if (d.model != null) o.model = d.model;
  o.pos = [0, 0]; o.rot = d.rot ?? 0; o.scale = d.scale ?? 1;
  for (const [k, v] of Object.entries(d)) if (!(k in o)) o[k] = structuredClone(v);
  for (const [k, r] of Object.entries(e.random || {})) {
    if (!Array.isArray(r) || r.length !== 2) continue;
    o[k] = typeof r[0] === 'number' ? Math.floor(r[0] + Math.random() * (r[1] - r[0] + 1)) : r[Math.random() < 0.5 ? 0 : 1];
  }
  return o;
}

// ---------- 카드 그림: 모델을 편집실에서 직접 찍어 둠 (메모리 + IndexedDB, 모델 파일이 바뀌면 다시) ----------
const THUMB_V = 3, THUMB_PX = 256, THUMB_OUT = 128;
let DB = null;
function idb() {
  return DB ||= new Promise(res => {
    try {
      const r = indexedDB.open('pyle-studio-m3d', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('thumbs');
      r.onsuccess = () => res(r.result); r.onerror = () => res(null);
    } catch { res(null); }
  });
}
async function idbGet(k) {
  const db = await idb(); if (!db) return null;
  return new Promise(res => { try { const q = db.transaction('thumbs').objectStore('thumbs').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch { res(null); } });
}
async function idbPut(k, v) { const db = await idb(); try { db?.transaction('thumbs', 'readwrite').objectStore('thumbs').put(v, k); } catch { /* 저장 못 해도 괜찮음 */ } }
async function fileSha(store, path) {
  const C = cacheFor(store), dir = path.slice(0, path.lastIndexOf('/'));
  if (!C.dirs.has(dir)) C.dirs.set(dir, store.list(dir).catch(() => []));
  const f = (await C.dirs.get(dir)).find(x => x.path === path || x.name === path.slice(dir.length + 1));
  return f ? (f.sha || f.size || '') : '';
}
const strHash = s => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36); };
let thumbR = null, thumbQ = Promise.resolve(), thumbIdle = 0;
function thumbOf(store, e, view3d) {
  const C = cacheFor(store);
  const key = e.thumb ? `t:${e.thumb}` : `m:${e.model}`;
  if (!C.thumbs.has(key)) {
    const p = e.thumb ? store.blobUrl(e.thumb) : (async () => {
      if (!e.model) return null;
      const k = `${e.model}|${await fileSha(store, e.model)}|${strHash(JSON.stringify([view3d?.matColor, view3d?.matTint]))}|${THUMB_V}`;
      const hit = await idbGet(k);
      if (hit) return hit;
      const url = await (thumbQ = thumbQ.then(() => shoot(store, e.model, view3d)).catch(() => null));
      if (url) idbPut(k, url);
      return url;
    })();
    p.catch(() => C.thumbs.delete(key));
    C.thumbs.set(key, p);
  }
  return C.thumbs.get(key);
}
async function shoot(store, path, view3d) {
  const { THREE } = await lib();
  const tpl = await loadModel(store, path);
  applyMatColors(THREE, tpl, view3d);
  clearTimeout(thumbIdle);
  if (!thumbR) {
    thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbR.setPixelRatio(1); thumbR.setSize(THUMB_PX, THUMB_PX, false);
  }
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
  sun.position.set(-3, 6, 4);
  scene.add(new THREE.HemisphereLight(0xdfe6f4, 0x6a5a44, 1.5), sun);
  const obj = tpl.clone(true);
  scene.add(obj);
  const box = new THREE.Box3().setFromObject(obj);
  // 카드에 꽉 차게: 비스듬히 본 모습의 화면 위 크기로 거리를 정함 (키 큰 나무도 작아지지 않게)
  const center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 2000);
  const dir = new THREE.Vector3(0.55, 0.5, 1).normalize();
  cam.position.copy(center).add(dir);
  cam.lookAt(center);
  cam.updateMatrixWorld();
  const inv = cam.matrixWorldInverse;
  let ext = 0, depth = 0;
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(center);
    const v = c.clone().add(center).applyMatrix4(inv).sub(center.clone().applyMatrix4(inv));
    ext = Math.max(ext, Math.abs(v.x), Math.abs(v.y)); depth = Math.max(depth, Math.abs(v.z));
  }
  const dist = ext / Math.tan(rad(14)) * 1.08 + depth;
  cam.position.copy(center).add(dir.multiplyScalar(dist));
  cam.lookAt(center);
  thumbR.render(scene, cam);
  const url = cropAlpha(thumbR.domElement, THUMB_OUT);
  thumbIdle = setTimeout(() => { thumbR?.dispose(); thumbR?.forceContextLoss(); thumbR = null; }, 4000);   // 다 찍으면 그리기 판 놓기
  return url;
}

// 잎 판(투명한 부분)까지 상자에 들어가 나무가 작게 찍히므로, 실제로 그려진 곳만 잘라 카드에 꽉 차게
function cropAlpha(src, out) {
  const W = src.width, H = src.height;
  const a = document.createElement('canvas'); a.width = W; a.height = H;
  const ax = a.getContext('2d'); ax.drawImage(src, 0, 0);
  const px = ax.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (px[(y * W + x) * 4 + 3] > 12) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const o = document.createElement('canvas'); o.width = o.height = out;
  if (x1 < 0) return o.toDataURL('image/png');
  const side = Math.max(x1 - x0, y1 - y0) * 1.1 + 2, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  o.getContext('2d').drawImage(a, cx - side / 2, cy - side / 2, side, side, 0, 0, out, out);
  return o.toDataURL('image/png');
}

const propsDir = L => (typeof L.props === 'string' && L.props.includes('<') ? L.props.slice(0, L.props.lastIndexOf('/') + 1) : PROPS_DIR);
// 라이브러리 카드가 딱 맞으면 그 모델, 아니면 예전 규칙 (<kind>.glb, 나무 tree_<model>.glb)
function modelPath(L, LB, o) {
  const e = LB && entryFor(LB, o);
  if (e?.model && (e.defaults?.model == null || e.defaults.model === o.model)) return e.model;
  return propsDir(L) + (o.kind === 'tree' ? `tree_${o.model || 'N3_round3'}.glb` : `${o.kind}.glb`);
}
const rad = d => d * Math.PI / 180;
const r3 = v => Math.round(v * 1000) / 1000;
const pmod = (a, n) => ((a % n) + n) % n;

// ---------- 땅 높이 (지형 삼각형을 1m 칸에 나눠 두고 바로 찾기) ----------
function heightField(THREE, root) {
  const tris = [];
  root.updateMatrixWorld(true);
  root.traverse(m => {
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position, idx = m.geometry.index;
    const v = i => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const n = idx ? idx.count : pos.count;
    for (let i = 0; i < n; i += 3) {
      const a = v(idx ? idx.getX(i) : i), b = v(idx ? idx.getX(i + 1) : i + 1), c = v(idx ? idx.getX(i + 2) : i + 2);
      tris.push([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z]);
    }
  });
  const box = new THREE.Box3().setFromObject(root);
  const x0 = Math.floor(box.min.x), z0 = Math.floor(box.min.z);
  const nx = Math.ceil(box.max.x) - x0 + 1, nz = Math.ceil(box.max.z) - z0 + 1;
  const cells = Array.from({ length: nx * nz }, () => []);
  tris.forEach((t, k) => {
    const ax = Math.floor(Math.min(t[0], t[3], t[6])) - x0, bx = Math.floor(Math.max(t[0], t[3], t[6])) - x0;
    const az = Math.floor(Math.min(t[2], t[5], t[8])) - z0, bz = Math.floor(Math.max(t[2], t[5], t[8])) - z0;
    for (let i = Math.max(0, ax); i <= Math.min(nx - 1, bx); i++) for (let j = Math.max(0, az); j <= Math.min(nz - 1, bz); j++) cells[j * nx + i].push(k);
  });
  // (x, z) three.js 좌표의 땅 높이. 지형 밖이면 null
  const at = (x, z) => {
    const i = Math.floor(x) - x0, j = Math.floor(z) - z0;
    if (i < 0 || j < 0 || i >= nx || j >= nz) return null;
    for (const k of cells[j * nx + i]) {
      const t = tris[k];
      const d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
      if (!d) continue;
      const l1 = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d;
      const l2 = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 >= -1e-6 && l2 >= -1e-6 && l3 >= -1e-6) return l1 * t[1] + l2 * t[4] + l3 * t[7];
    }
    return null;
  };
  return { at, box };
}

// 블렌더 (x, y) 의 땅 높이
const groundB = (hf, x, y) => hf.at(x, -y) ?? 0;

// 굽기 도구(cabin_g2_field.py)의 near_cliff 와 같은 방식: 둘레 r 안(반·끝 두 바퀴 8방향 + 가운데) 높이 차가 dh 넘으면 절벽 가까이
function nearCliff(hf, x, y, r, dh) {
  const hs = [groundB(hf, x, y)];
  for (let k = 0; k < 8; k++) {
    const a = k / 8 * Math.PI * 2;
    for (const rr of [r * 0.5, r]) hs.push(groundB(hf, x + Math.cos(a) * rr, y + Math.sin(a) * rr));
  }
  return Math.max(...hs) - Math.min(...hs) > dh;
}

// 경고: 걸을 수 있는 땅 밖, 라이브러리 rules.cliff (r·dh = [기본, 크기마다]) 로 절벽 끝
function warningsFor(L, hf, o, e) {
  const w = [];
  const [x, y] = o.pos;
  const b = L.bounds;
  if (b && (x < b[0] || y < b[1] || x > b[2] || y > b[3])) w.push('걸을 수 있는 땅 밖이에요');
  const c = e?.rules?.cliff;
  if (c && Array.isArray(c.r) && Array.isArray(c.dh) && !(c.skipIf && o[c.skipIf])) {
    const s = o.scale ?? 1, r = c.r[0] + (c.r[1] || 0) * s;
    if (nearCliff(hf, x, y, r, c.dh[0] + (c.dh[1] || 0) * s)) w.push(`절벽·비탈 끝(${Math.round(r * 10) / 10}m 안)이라 굽기 때 빠져요`);
  }
  return w;
}

function nextId(L, kind) {
  let max = 0;
  const re = new RegExp(`^${kind.replace(/[^\w]/g, '\\$&')}_(\\d+)$`);
  for (const o of L.objects) {
    if (o.id === kind) max = Math.max(max, 1);
    const m = o.id.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${kind}_${String(max + 1).padStart(2, '0')}`;
}

// ---------- 화면 ----------
// S: 맵 룸의 맵 상태 (S.id, S.map, S.layout, S.layoutSha, S.dirty). picker: 맵 고르는 select
export function map3dView(ctx, S, { picker }) {
  const root = h('div', { class: 'm3d' });
  if (!S.layout) {
    return fill(root, h('div', { class: 'savebar' }, picker),
      h('div', { class: 'card' }, h('h3', { style: { marginTop: 0 } }, '3D 맵이에요'),
        h('p', {}, `이 맵은 3D로 그려지지만 아직 배치 목록(${layoutPath(S.id)})이 없어요. 맵 팀에 배치 목록을 만들어 달라고 요청해 주세요.`)));
  }
  const L = S.layout;
  const st = S.l3 ||= { sel: null, undo: [], bright: 1.3, shadow: true };
  st.tab ||= 'lib'; st.cat ||= ALL; st.q ??= ''; st.placing = null;
  let LB = null;   // 사물 라이브러리 (불러온 뒤)

  const stage = h('div', { class: 'm3d-stage' }, h('div', { class: 'm3d-msg' }, '3D 화면 준비 중… (처음엔 모델을 받느라 몇 초 걸려요)'));
  const side = h('div', { class: 'card m3d-side' });
  const props = h('div', { class: 'card m3d-props' });
  const status = h('span', { class: 'muted m3d-status' }, S.dirty ? '저장 안 한 변경 있음' : '바뀐 것 없음');   // 늘 글자를 두어 끄는 중 화면이 밀리지 않게
  const saveBtn = h('button', { class: 'btn small primary', disabled: !S.dirty }, '저장');
  const bakeBtn = h('button', { class: 'btn small', title: '저장하고 맵 팀에 "이 배치로 다시 구워 주세요" 요청을 남겨요' }, '✅ 확정 (다시 굽기 요청)');
  const undoBtn = h('button', { class: 'btn small', disabled: !st.undo.length, title: '되돌리기 (Ctrl+Z)' }, '↶ 되돌리기');
  const bright = h('input', { type: 'range', min: 0.4, max: 1.8, step: 0.05, value: st.bright, style: { width: '110px' } });
  const shadowChk = h('input', { type: 'checkbox', checked: st.shadow });

  const markDirty = () => { S.dirty = true; saveBtn.disabled = false; status.textContent = '저장 안 한 변경 있음'; };
  const pushUndo = () => { st.undo.push(JSON.stringify(L.objects)); if (st.undo.length > 40) st.undo.shift(); undoBtn.disabled = false; };

  // 3D 쪽에서 채워 넣는 함수들 (모델을 다 받은 뒤)
  let V = null;

  async function save(msg) {
    for (const o of L.objects) { o.pos = o.pos.map(r3); o.rot = r3(o.rot || 0); o.scale = r3(o.scale ?? 1); }
    S.layoutSha = await ctx.store.putText(layoutPath(S.id), JSON.stringify(L, null, 1), S.layoutSha, msg);
    S.dirty = false; saveBtn.disabled = true; status.textContent = '저장했어요';
  }
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    try { await save(`3D 배치 수정: ${S.map.name || S.id}`); toast('저장했어요. 게임에 반영하려면 "확정"을 눌러 주세요.'); }
    catch (e) { toast(e.message, true); saveBtn.disabled = false; }
  };
  bakeBtn.onclick = async () => {
    bakeBtn.disabled = true;
    try {
      if (S.dirty || !S.layoutSha) await save(`3D 배치 확정: ${S.map.name || S.id}`);
      const now = new Date().toISOString();
      const fresh = [...new Set(L.objects.map(o => o.kind))].filter(k => isNewKind(LB, k));
      const req = { id: `req_bake_${S.id}_${Date.now()}`, room: 'map', team: '맵', mapId: S.id, title: `3D 다시 굽기: ${S.id}`,
        body: '편집실 3D 배치에서 확정 — 이 배치로 다시 구워 주세요 (D-348 C).' + (fresh.length ? ` 굽기 도구에 아직 없는 새 종류: ${fresh.join(', ')} — 굽기 도구에 먼저 넣어 주세요.` : ''),
        status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' };
      await ctx.store.updateJSON(REQUESTS, d => { d.requests ||= []; d.requests.unshift(req); return d; }, `3D 다시 굽기 요청: ${S.id}`, { requests: [] });
      ctx.refreshBadges?.();
      status.textContent = '확정했어요 — 맵 팀이 다시 구워요';
      toast('확정했어요. 요청함에 "3D 다시 굽기"를 남겼어요. 맵 팀이 다시 구우면(약 40분) 게임에 들어가요.');
    } catch (e) { toast(e.message, true); }
    bakeBtn.disabled = false;
  };
  undoBtn.onclick = () => undo();
  function undo() {
    if (!st.undo.length) return;
    L.objects = JSON.parse(st.undo.pop());
    undoBtn.disabled = !st.undo.length;
    if (st.sel && !L.objects.find(o => o.id === st.sel)) st.sel = null;
    markDirty();
    V?.syncAll();
  }

  const selObj = () => L.objects.find(o => o.id === st.sel) || null;
  const entOf = o => (LB ? entryFor(LB, o) : null);
  const warnOf = o => (V ? warningsFor(L, V.hf, o, entOf(o)) : []);
  const objName = o => entOf(o)?.name || kindName(LB, o.kind);
  const clampB = (x, y) => { const b = L.bounds || [-1e9, -1e9, 1e9, 1e9]; return [r3(Math.min(b[2], Math.max(b[0], x))), r3(Math.min(b[3], Math.max(b[1], y)))]; };
  const narrow = () => window.matchMedia('(max-width:1100px)').matches;   // 휴대폰·태블릿: 라이브러리는 아래에서 올라오는 판
  const openSheet = on => { side.classList.toggle('open', on); fab.textContent = on ? '✕ 닫기' : '📚 사물 더하기'; };
  const thumbImg = (e, cls = 'm3d-thumb') => {
    const box = h('span', { class: cls }, h('span', { class: 'm3d-thumb-ph' }, catIcon(LB, e.category)));
    thumbOf(ctx.store, e, S.map.view3d).then(url => { if (url) box.replaceChildren(h('img', { src: url, alt: e.name, draggable: 'false' })); }).catch(() => {});
    return box;
  };

  // ---------- 놓기: 라이브러리에서 고르고 → 땅을 누르면 놓임 (PC 는 카드를 3D 화면으로 끌어 놓아도 됨) ----------
  const placeBar = h('div', { class: 'm3d-placebar', hidden: true });
  const fab = h('button', { class: 'btn m3d-fab', onclick: () => openSheet(!side.classList.contains('open')) }, '📚 사물 더하기');
  function startPlacing(e, viaDrag) {
    if (st.sel) select(null);
    st.placing = { e, o: protoOf(e), viaDrag: !!viaDrag };
    st.tab = 'lib';
    if (narrow() && !viaDrag) openSheet(false);
    V?.setGhost(st.placing.o);
    drawPlaceBar(); drawLibDetail(); drawGrid();
  }
  function stopPlacing() {
    if (!st.placing) return;
    st.placing = null;
    V?.setGhost(null);
    drawPlaceBar(); drawLibDetail(); drawGrid();
  }
  function commitPlace(x, y) {
    const P = st.placing; if (!P) return;
    pushUndo();
    const o = structuredClone(P.o);
    o.id = nextId(L, o.kind);
    o.pos = clampB(x, y);
    L.objects.push(o);
    st.sel = o.id;
    markDirty();
    V?.syncAll();
    toast(`${P.e.name}을(를) 놓았어요.${st.keepPlacing ? ' 계속 누르면 더 놓여요.' : ''}`);
    if (st.keepPlacing && !P.viaDrag) { P.o = protoOf(P.e); V?.setGhost(P.o); }
    else stopPlacing();
  }
  function drawPlaceBar() {
    const P = st.placing;
    placeBar.hidden = !P;
    if (!P) return;
    const keep = h('input', { type: 'checkbox', checked: !!st.keepPlacing });
    keep.onchange = () => { st.keepPlacing = keep.checked; };
    fill(placeBar, thumbImg(P.e, 'm3d-thumb sm'),
      h('span', { class: 'm3d-placetext' }, h('b', {}, P.e.name), ' — 땅을 누르면 놓여요'),
      h('label', { class: 'row', style: { gap: '4px' } }, keep, '계속 놓기'),
      h('button', { class: 'btn small', onclick: () => stopPlacing() }, '그만'));
  }

  // ---------- 왼쪽(휴대폰은 아래 판): 사물 라이브러리 / 놓인 사물 ----------
  const tabBar = h('div', { class: 'm3d-tabs' });
  const libBox = h('div', { class: 'm3d-libbox' });
  const listBox = h('div', { class: 'm3d-list' });
  const search = h('input', { type: 'search', class: 'm3d-search', placeholder: '🔍 찾기 (예: 나무, 바위)', value: st.q });
  search.oninput = () => { st.q = search.value; drawGrid(); };
  const catBar = h('div', { class: 'm3d-cats' });
  const grid = h('div', { class: 'm3d-grid' });
  const libDetail = h('div', { class: 'm3d-libdetail' });

  function drawTabs() {
    const tab = (id, label) => h('button', { class: `m3d-tab ${st.tab === id ? 'on' : ''}`, onclick: () => { st.tab = id; drawSide(); } }, label);
    fill(tabBar, tab('lib', '📚 사물 라이브러리'), tab('list', `📋 놓인 사물 ${L.objects.length}`),
      h('button', { class: 'btn small m3d-sheetclose', onclick: () => openSheet(false) }, '✕'));
  }
  function drawSide() {
    drawTabs();
    libBox.hidden = st.tab !== 'lib';
    listBox.hidden = st.tab !== 'list';
    if (st.tab === 'lib') { drawCats(); drawGrid(); drawLibDetail(); } else drawList();
  }
  function drawCats() {
    if (!LB) return fill(catBar);
    const cats = [ALL, ...new Set([...LB.categories.map(c => c.id), ...LB.items.map(e => e.category || '기타')])]
      .filter(c => c === ALL || LB.items.some(e => (e.category || '기타') === c));
    fill(catBar, cats.map(c => h('button', { class: `m3d-cat ${st.cat === c ? 'on' : ''}`, onclick: () => { st.cat = c; drawCats(); drawGrid(); } },
      c === ALL ? '전체' : `${catIcon(LB, c)} ${c}`)));
  }
  function drawGrid() {
    if (!LB) return fill(grid, h('div', { class: 'muted m3d-empty' }, '사물 라이브러리 불러오는 중…'));
    if (LB.missing) return fill(grid, h('div', { class: 'muted m3d-empty' }, `사물 라이브러리 파일(${LIB_PATH})이 없어요. 맵 팀에 만들어 달라고 해 주세요.`));
    const q = st.q.trim().toLowerCase();
    const items = LB.items.filter(e => (st.cat === ALL || (e.category || '기타') === st.cat)
      && (!q || [e.name, e.desc, e.category, e.kind, e.id, kindName(LB, e.kind)].some(t => String(t || '').toLowerCase().includes(q))));
    if (!items.length) return fill(grid, h('div', { class: 'muted m3d-empty' }, '맞는 사물이 없어요.'));
    fill(grid, items.map(e => {
      const card = h('button', { class: `m3d-card ${st.placing?.e === e ? 'on' : ''}`, draggable: 'true', title: `${e.name} — ${e.desc || ''}`,
        onclick: () => (st.placing?.e === e ? stopPlacing() : startPlacing(e)) },
      thumbImg(e), h('span', { class: 'm3d-cardname' }, e.name),
      isNewKind(LB, e.kind) ? h('span', { class: 'badge warn m3d-new' }, '새 종류') : null);
      card.addEventListener('dragstart', ev => {
        ev.dataTransfer.setData('text/plain', e.id); ev.dataTransfer.effectAllowed = 'copy';
        startPlacing(e, true);
      });
      card.addEventListener('dragend', () => { if (st.placing?.viaDrag) stopPlacing(); });
      return card;
    }));
  }
  function drawLibDetail() {
    const e = st.placing?.e;
    if (!e) {
      return fill(libDetail, h('div', { class: 'muted' }, '사물을 누른 뒤 3D 화면의 땅을 누르면 그 자리에 놓여요.',
        narrow() ? null : ' 카드를 3D 화면으로 끌어다 놓아도 돼요.'));
    }
    fill(libDetail,
      h('div', { class: 'm3d-detailhead' }, thumbImg(e, 'm3d-thumb md'),
        h('div', {}, h('b', {}, e.name), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${catIcon(LB, e.category)} ${e.category || '기타'} · 종류 ${kindName(LB, e.kind)}`))),
      e.desc ? h('div', { style: { fontSize: '13px', margin: '4px 0' } }, e.desc) : null,
      isNewKind(LB, e.kind) ? h('div', { class: 'm3d-warn' }, '새 종류 — 맵 팀이 굽기 도구에 추가해야 해요. 놓아 둘 수는 있지만 굽기 전까지 게임에는 안 나와요.') : null,
      h('div', { class: 'm3d-hint' }, '👇 이제 3D 화면의 땅을 눌러 놓아 주세요.'));
  }
  function drawList() {
    if (st.tab !== 'list') { drawTabs(); return; }
    const groups = {};
    for (const o of L.objects) (groups[o.kind] ||= []).push(o);
    let warnTotal = 0;
    const rows = Object.entries(groups).map(([kind, list]) => h('div', {},
      h('div', { class: 'm3d-group' }, `${catIcon(LB, entOf(list[0])?.category)} ${kindName(LB, kind)} ${list.length}`, isNewKind(LB, kind) ? ' · 새 종류' : ''),
      list.map(o => {
        const w = warnOf(o); warnTotal += w.length ? 1 : 0;
        const e = entOf(o);
        return h('button', { class: `pal ${o.id === st.sel ? 'on' : ''}`, title: w.join(' / '), onclick: () => { select(o.id); V?.focus(o); if (narrow()) openSheet(false); } },
          h('span', {}, o.id), e && e.name !== kindName(LB, kind) && h('span', { class: 'muted', style: { fontSize: '12px' } }, e.name),
          w.length ? h('span', { class: 'badge warn', style: { marginLeft: 'auto' } }, '⚠') : null);
      })));
    drawTabs();
    fill(listBox, warnTotal ? h('div', { class: 'm3d-warnsum' }, `⚠ 주의 ${warnTotal}개 — 굽기 때 빠질 수 있어요`) : null, rows);
  }
  fill(libBox, search, catBar, grid, libDetail);
  fill(side, tabBar, libBox, listBox);

  // ---------- 오른쪽: 고른 사물 정보 ----------
  function drawProps() {
    const o = selObj();
    if (!o) {
      fill(props, h('h4', { style: { marginTop: 0 } }, '사물 고르기'),
        h('p', { class: 'muted', style: { fontSize: '13px' } }, '3D 화면에서 사물을 누르면 골라져요. 고른 채로 끌면 옮겨지고, 빈 곳을 끌면 화면이 돌아가요. 새 사물은 왼쪽 "사물 라이브러리"에서 골라요.'),
        h('ul', { class: 'm3d-help' },
          h('li', {}, '마우스: 왼쪽 끌기 = 돌려 보기, 오른쪽 끌기 = 옮겨 보기, 휠 = 가깝게/멀게'),
          h('li', {}, '휴대폰: 한 손가락 = 돌려 보기·사물 끌기, 두 손가락 = 가깝게/멀게·옮겨 보기'),
          h('li', {}, '키보드: Delete = 지우기, Ctrl+Z = 되돌리기, Q/E = 15° 돌리기, Esc = 놓기 그만')));
      return;
    }
    const w = warnOf(o);
    const e = entOf(o);
    const num = (val, step, onset) => {
      const i = h('input', { type: 'number', step, value: r3(val), class: 'num' });
      i.onchange = () => { const v = Number(i.value); if (!isNaN(v)) { pushUndo(); onset(v); markDirty(); V?.syncOne(o); } };
      return i;
    };
    let [smin, smax, sstep] = e?.rules?.scale || SCALE_DEF;
    const sv = o.scale ?? 1;
    smin = Math.min(smin, sv); smax = Math.max(smax, sv);
    const scVal = h('b', {}, r3(sv));
    const sc = h('input', { type: 'range', min: smin, max: smax, step: sstep, value: sv });
    sc.onpointerdown = () => pushUndo();
    sc.onkeydown = () => pushUndo();
    sc.oninput = () => { o.scale = Number(sc.value); scVal.textContent = r3(o.scale); markDirty(); V?.syncOne(o, true); };
    sc.onchange = () => V?.syncOne(o);
    const rotBtn = d => h('button', { class: 'btn small', onclick: () => rotate(d) }, d > 0 ? '⟲ 15°' : '⟳ 15°');
    const extra = [];
    // 같은 종류에 모양(model)이 여럿이면 모양 고르기 (나무 등)
    const shapes = (LB?.items || []).filter(x => x.kind === o.kind && x.defaults?.model != null);
    if (shapes.length > 1 || (o.model != null && shapes.length)) {
      const opts = shapes.map(x => h('option', { value: x.defaults.model, selected: x.defaults.model === o.model }, x.name));
      if (!shapes.some(x => x.defaults.model === o.model)) opts.unshift(h('option', { value: o.model ?? '', selected: true }, o.model ?? '(없음)'));
      const ms = h('select', {}, opts);
      ms.onchange = () => { pushUndo(); o.model = ms.value; markDirty(); V?.syncOne(o); drawList(); };
      extra.push(h('label', { class: 'field' }, h('span', {}, `${kindName(LB, o.kind)} 모양`), ms));
    }
    if ('mirror' in o || e?.random?.mirror) {
      const mir = h('input', { type: 'checkbox', checked: !!o.mirror });
      mir.onchange = () => { pushUndo(); o.mirror = mir.checked; markDirty(); V?.syncOne(o); };
      extra.push(h('label', { class: 'row' }, mir, '좌우 뒤집기'));
    }
    if (o.kind === 'rock') {
      const sqVal = h('b', {}, r3(o.sq ?? 0.75));
      const sq = h('input', { type: 'range', min: 0.6, max: 0.85, step: 0.01, value: o.sq ?? 0.75 });
      sq.onpointerdown = () => pushUndo();
      sq.oninput = () => { o.sq = Number(sq.value); sqVal.textContent = r3(o.sq); markDirty(); V?.syncOne(o, true); };
      sq.onchange = () => V?.syncOne(o);
      const seedBtn = h('button', { class: 'btn small', title: '바위 모양 번호를 새로 뽑아요 (굽기 때 모양이 바뀌어요)' }, `🎲 모양 ${o.seed ?? 0}`);
      seedBtn.onclick = () => { pushUndo(); o.seed = Math.floor(Math.random() * 200) - 100; markDirty(); V?.syncOne(o); drawProps(); };
      extra.push(h('label', { class: 'field' }, h('span', {}, '납작함 (0.6 납작 ~ 0.85 둥긂) '), h('div', { class: 'row' }, sq, sqVal)), seedBtn,
        h('div', { class: 'muted', style: { fontSize: '12px' } }, '미리보기 바위 모양은 하나뿐이에요. 실제 모양은 굽기 때 번호대로 만들어져요.'));
    }
    fill(props,
      h('div', { class: 'm3d-detailhead' }, e ? thumbImg(e, 'm3d-thumb md') : null, h('h4', { style: { margin: 0 } }, objName(o))),
      isNewKind(LB, o.kind) ? h('div', { class: 'm3d-warn' }, '새 종류 — 맵 팀이 굽기 도구에 추가해야 해요.') : null,
      w.length ? h('div', { class: 'm3d-warn' }, w.map(t => h('div', {}, `⚠ ${t}`))) : null,
      h('div', { class: 'm3d-kv' }, h('span', {}, '종류'), h('b', {}, kindName(LB, o.kind)), h('span', {}, '이름'), h('code', {}, o.id)),
      e?.desc ? h('div', { class: 'muted', style: { fontSize: '12px', marginBottom: '6px' } }, e.desc) : null,
      h('div', { class: 'field' }, h('span', {}, '위치 (m) — 가로 x · 안쪽 y (사람 키 ≈ 1.7m)'),
        h('div', { class: 'row' }, num(Math.round(o.pos[0] * 10) / 10, 0.1, v => { o.pos[0] = v; }), num(Math.round(o.pos[1] * 10) / 10, 0.1, v => { o.pos[1] = v; }))),
      h('div', { class: 'field' }, h('span', {}, '회전 (도)'),
        h('div', { class: 'row' }, rotBtn(15), rotBtn(-15), num(Math.round(o.rot || 0), 1, v => { o.rot = Math.round(v); }))),
      h('label', { class: 'field' }, h('span', {}, `${e?.rules?.scaleLabel || '크기 (배)'} `), h('div', { class: 'row' }, sc, scVal)),
      extra,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn small danger', onclick: () => remove() }, '🗑 지우기'),
        h('button', { class: 'btn small', onclick: () => select(null) }, '고르기 풀기')));
  }
  function rotate(d) {
    const o = selObj(); if (!o) return;
    pushUndo();
    o.rot = Math.round((((o.rot || 0) + d + 180) % 360 + 360) % 360 - 180);
    markDirty(); V?.syncOne(o); drawProps();
  }
  function remove() {
    const o = selObj(); if (!o) return;
    pushUndo();
    L.objects = L.objects.filter(x => x !== o);
    st.sel = null;
    markDirty(); V?.syncAll();
    toast(`${o.id}을(를) 지웠어요. 되돌리려면 ↶ 되돌리기.`);
  }
  function select(id) {
    st.sel = id;
    V?.highlight();
    drawProps(); drawList();
  }

  bright.oninput = () => { st.bright = Number(bright.value); V?.light(); };
  shadowChk.onchange = () => { st.shadow = shadowChk.checked; V?.light(); };

  const viewBtns = h('span', { class: 'row', style: { gap: '4px' } },
    h('button', { class: 'btn small', onclick: () => V?.camera(VIEW_CAM) }, '🗺 전체 보기'),
    h('button', { class: 'btn small', onclick: () => V?.camera(GAME_CAM, true) }, '🎮 게임 화면처럼'));
  drawSide(); drawProps();

  // 라이브러리 먼저, 그다음 3D 준비 (비동기)
  const libReady = loadLibrary(ctx.store).then(x => { LB = x; drawSide(); drawProps(); return x; });
  init().catch(e => { console.error(e); fill(stage, h('div', { class: 'm3d-msg err' }, `3D 화면을 열지 못했어요: ${e.message}`)); });

  async function init() {
    const { THREE, OrbitControls } = await lib();
    await libReady;
    const terrainPath = L.terrain || `${PROPS_DIR}terrain_${S.id}.glb`;
    const kinds = new Set(L.objects.map(o => modelPath(L, LB, o)));
    const [terrainTpl] = await Promise.all([loadModel(ctx.store, terrainPath), ...[...kinds].map(p => loadModel(ctx.store, p).catch(() => null))]);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const canvas = renderer.domElement;
    canvas.tabIndex = 0;
    canvas.className = 'm3d-canvas';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9aa6b8);
    const cam = new THREE.PerspectiveCamera(VIEW_CAM.fov, 1, 0.5, 600);

    // 빛: 노을 고정 (D-348) — 왼쪽 위 뒤쪽의 낮은 금빛 해 + 푸른 그늘빛
    const hemi = new THREE.HemisphereLight(0xa9b4e0, 0x5a4a34, 1.1);
    const sun = new THREE.DirectionalLight(0xffdcb8, 2.6);
    sun.position.set(-26, 24, -20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    scene.add(hemi, sun, sun.target);

    const terrain = terrainTpl.clone(true);
    terrain.traverse(m => {
      if (!m.isMesh) return;
      m.receiveShadow = true;
      // 꼭짓점 색(G=흙길 무게)은 색이 아니라 섞기 값이라 미리보기에선 풀/흙 두 색으로 섞음
      if (m.geometry.attributes.color) m.material = groundMaterial(THREE, m.material);
    });
    scene.add(terrain);
    const hf = heightField(THREE, terrain);

    const objRoot = new THREE.Group();
    scene.add(objRoot);
    const nodes = new Map();   // id → { node, key }
    const selBox = new THREE.BoxHelper(undefined, 0xffd84a);
    selBox.material.depthTest = false; selBox.renderOrder = 10; selBox.visible = false;
    scene.add(selBox);
    const warnMat = new THREE.MeshBasicMaterial({ color: 0xe0442c, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide });
    const warnGeo = new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2);
    const spotMat = new THREE.MeshBasicMaterial({ color: 0x5fe08a, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });

    function place(o, node) {
      const [x, y] = o.pos;
      const g = groundB(hf, x, y);
      const s = o.scale ?? 1;
      node.position.set(x, g, -y);
      node.rotation.set(0, rad(o.rot || 0), 0);
      if (o.kind === 'rock') {
        const sq = o.sq ?? 0.75;
        node.scale.set(s * (1 + 0.15 * pmod(o.seed || 0, 3)) / 1.15, s * sq / 0.75, s);
        node.position.y = g - 0.2 * s * sq;
      } else if (o.kind === 'tree') {
        node.scale.set(o.mirror ? -s : s, s, s);
        node.position.y = g - 0.1;
      } else node.scale.set(o.mirror ? -s : s, s, s);
      const w = warningsFor(L, hf, o, entOf(o));
      const ring = node.userData.ring;
      ring.visible = w.length > 0;
      const rr = o.kind === 'tree' ? 1.6 : o.kind === 'rock' ? s * 1.3 : (entOf(o)?.rules?.ring ?? 2);
      ring.scale.set(rr / Math.abs(node.scale.x), 1 / node.scale.y, rr / node.scale.z);
      ring.position.y = 0.15 / node.scale.y;
      const spot = node.userData.spot;
      if (spot) { spot.visible = !ring.visible; spot.scale.copy(ring.scale); spot.position.copy(ring.position); }
    }
    // ghost=true: 놓기 전 반투명 미리보기 (누를 수 없음, 그림자 없음)
    async function build(o, ghost) {
      const key = modelPath(L, LB, o);
      const tpl = await loadModel(ctx.store, key).catch(() => null);
      const node = new THREE.Group();
      if (!ghost) node.userData.oid = o.id;
      if (tpl) {
        applyMatColors(THREE, tpl, S.map.view3d);
        const m = tpl.clone(true);
        m.traverse(c => {
          if (!c.isMesh) return;
          if (ghost) {
            const see = mm => { const k = mm.clone(); k.transparent = true; k.opacity = 0.6; k.depthWrite = false; return k; };
            c.material = Array.isArray(c.material) ? c.material.map(see) : see(c.material);
            c.raycast = () => {};
          } else { c.castShadow = true; c.receiveShadow = true; }
        });
        node.add(m);
      } else {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xff00ff, transparent: !!ghost, opacity: ghost ? 0.6 : 1 }));
        if (ghost) b.raycast = () => {};
        node.add(b);
      }
      const ring = new THREE.Mesh(warnGeo, warnMat);
      ring.renderOrder = 9;
      ring.raycast = () => {};
      node.userData.ring = ring;
      node.add(ring);
      if (ghost) {   // 놓을 자리 표시: 괜찮으면 초록 고리 (경고면 빨간 고리만)
        const spot = new THREE.Mesh(warnGeo, spotMat);
        spot.renderOrder = 9; spot.raycast = () => {};
        node.userData.spot = spot;
        node.add(spot);
      }
      return { node, key };
    }
    // 목록과 3D 장면 맞추기
    let syncing = Promise.resolve();
    function syncAll() {
      syncing = syncing.then(async () => {
        const ids = new Set(L.objects.map(o => o.id));
        for (const [id, n] of nodes) if (!ids.has(id)) { objRoot.remove(n.node); nodes.delete(id); }
        for (const o of L.objects) {
          let n = nodes.get(o.id);
          if (n && n.key !== modelPath(L, LB, o)) { objRoot.remove(n.node); nodes.delete(o.id); n = null; }
          if (!n) { n = await build(o); nodes.set(o.id, n); objRoot.add(n.node); }
          place(o, n.node);
        }
        highlight();
        drawList(); drawProps();
        request();
      });
      return syncing;
    }
    // quick=true: 끄는 중 (목록·정보는 다시 안 그림)
    function syncOne(o, quick) {
      const n = nodes.get(o.id);
      if (!n || n.key !== modelPath(L, LB, o)) return syncAll();
      place(o, n.node);
      highlight();
      if (!quick) { drawList(); drawProps(); }
      request();
    }
    function highlight() {
      const n = st.sel && nodes.get(st.sel);
      selBox.visible = !!n;
      if (n) {
        const ring = n.node.userData.ring, vis = ring.visible;
        ring.visible = false;
        selBox.setFromObject(n.node);
        ring.visible = vis;
      }
      request();
    }
    function light() {
      hemi.intensity = 1.1 * st.bright;
      sun.intensity = 2.6 * st.bright;
      renderer.shadowMap.enabled = st.shadow;
      sun.castShadow = st.shadow;
      scene.traverse(m => { if (m.material) [].concat(m.material).forEach(mm => { mm.needsUpdate = true; }); });
      request();
    }

    // 놓기 전 미리보기 (마우스를 따라다님, 절벽 끝이면 빨간 고리)
    let ghost = null, ghostFor = null;
    async function setGhost(o) {
      ghostFor = o;
      if (ghost) { scene.remove(ghost.node); ghost = null; request(); }
      if (!o) return;
      const g = await build(o, true);
      if (ghostFor !== o) return;
      ghost = g; g.node.visible = false;
      scene.add(g.node);
    }
    function moveGhost(ndc) {
      if (!ghost || !st.placing || ghostFor !== st.placing.o) return;
      const p = groundHit(ndc);
      if (!p) { ghost.node.visible = false; request(); return; }
      ghostFor.pos = clampB(p.x, -p.z);
      place(ghostFor, ghost.node);
      ghost.node.visible = true;
      request();
    }
    const hideGhost = () => { if (ghost?.node.visible) { ghost.node.visible = false; request(); } };

    // 카메라: 남쪽(화면 아래)에서 tilt 만큼 내려다봄
    const controls = new OrbitControls(cam, canvas);
    function camera(c, game) {
      const [x, y] = game ? [2.1, -1.6] : [0, 1];      // 게임 = 파일이 깨어나는 자리 (산장 앞)
      const t = new THREE.Vector3(x, groundB(hf, x, y), -y);
      cam.fov = c.fov; cam.updateProjectionMatrix();
      cam.position.set(t.x, t.y + c.dist * Math.sin(rad(c.tilt)), t.z + c.dist * Math.cos(rad(c.tilt)));
      controls.target.copy(t);
      controls.update();
      request();
    }
    controls.maxPolarAngle = rad(85);
    controls.minDistance = 5; controls.maxDistance = 200;
    controls.screenSpacePanning = false;
    controls.addEventListener('change', () => request());

    // 목록에서 고르면 그 사물이 화면 가운데에 오게 (보는 각도·거리는 그대로)
    function focus(o) {
      const t = new THREE.Vector3(o.pos[0], groundB(hf, o.pos[0], o.pos[1]), -o.pos[1]);
      cam.position.add(t.clone().sub(controls.target));
      controls.target.copy(t);
      controls.update();
      request();
    }

    // 화면 한 점이 가리키는 땅 (three.js 좌표)
    const ray = new THREE.Raycaster();
    function groundHit(ndc) {
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObject(terrain, true)[0];
      if (hit) return hit.point;
      const t = (controls.target.y - ray.ray.origin.y) / ray.ray.direction.y;   // 땅 밖이면 목표 높이 평면
      return t > 0 ? ray.ray.at(t, new THREE.Vector3()) : null;
    }
    function viewCenter() {
      const p = groundHit(new THREE.Vector2(0, 0)) || controls.target;
      return clampB(p.x, -p.z);
    }

    // ---------- 누르기·끌기 ----------
    const ndcOf = e => { const r = canvas.getBoundingClientRect(); return new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); };
    const pickAt = ndc => {
      ray.setFromCamera(ndc, cam);
      for (const hit of ray.intersectObjects(objRoot.children, true)) {
        let n = hit.object;
        while (n && !n.userData.oid) n = n.parent;
        if (n) return n.userData.oid;
      }
      return null;
    };
    let drag = null, down = null, touches = 0;
    // OrbitControls 보다 먼저 듣기 (사물을 잡으면 화면 돌리기를 잠깐 끔). 놓는 중에는 사물을 잡지 않고 땅을 누르면 놓임
    canvas.addEventListener('pointerdown', e => {
      touches++;
      canvas.focus({ preventScroll: true });
      down = { x: e.clientX, y: e.clientY, hit: null };
      if (touches > 1) { if (drag) endDrag(); return; }
      if (e.button !== 0 || st.placing) return;
      const id = pickAt(ndcOf(e));
      down.hit = id;
      if (id) {
        controls.enabled = false;
        if (st.sel !== id) select(id);
        const o = selObj();
        const p = groundHit(ndcOf(e));
        drag = { o, moved: false, off: p ? [o.pos[0] - p.x, o.pos[1] + p.z] : [0, 0], pid: e.pointerId };
        canvas.setPointerCapture(e.pointerId);
      }
    }, true);
    canvas.addEventListener('pointermove', e => {
      if (st.placing && !drag && e.pointerType === 'mouse') moveGhost(ndcOf(e));
      if (!drag || e.pointerId !== drag.pid) return;
      const p = groundHit(ndcOf(e));
      if (!p) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
        pushUndo(); drag.moved = true;
      }
      drag.o.pos = clampB(p.x + drag.off[0], -p.z + drag.off[1]);
      markDirty();
      syncOne(drag.o, true);
    });
    canvas.addEventListener('pointerleave', hideGhost);
    function endDrag() {
      if (!drag) return;
      const d = drag; drag = null;
      controls.enabled = true;
      if (d.moved) { drawList(); drawProps(); }
    }
    const up = e => {
      touches = Math.max(0, touches - 1);
      const tap = down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && touches === 0;
      if (drag && e.pointerId === drag.pid) endDrag();
      else if (tap && st.placing && e.button === 0) {
        const p = groundHit(ndcOf(e));
        if (p) commitPlace(p.x, -p.z);
      } else if (tap && !down.hit && st.sel) select(null);
      if (touches === 0) { controls.enabled = true; down = null; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    // PC: 라이브러리 카드를 끌어다 놓기
    canvas.addEventListener('dragover', e => { if (!st.placing) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; moveGhost(ndcOf(e)); });
    canvas.addEventListener('dragleave', hideGhost);
    canvas.addEventListener('drop', e => {
      if (!st.placing) return;
      e.preventDefault();
      const p = groundHit(ndcOf(e));
      if (p) commitPlace(p.x, -p.z); else stopPlacing();
    });
    const onKey = e => {
      if (!canvas.isConnected || e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'q' || e.key === 'Q') rotate(15);
      else if (e.key === 'e' || e.key === 'E') rotate(-15);
      else if (e.key === 'Escape') { if (st.placing) stopPlacing(); else select(null); }
    };
    window.addEventListener('keydown', onKey);

    // ---------- 그리기 (바뀔 때만) ----------
    let pending = false, shown = false;
    function request() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (!canvas.isConnected) { if (shown) dispose(); return; }
        shown = true;
        renderer.render(scene, cam);
      });
    }
    // 다른 화면으로 가면 3D 자원 놓기
    const onLeave = () => setTimeout(() => { if (shown && !canvas.isConnected) dispose(); }, 50);
    window.addEventListener('hashchange', onLeave);
    const ro = new ResizeObserver(() => {
      const w = stage.clientWidth, hh = stage.clientHeight;
      if (!w || !hh) return;
      renderer.setSize(w, hh, false);
      cam.aspect = w / hh; cam.updateProjectionMatrix();
      request();
    });
    let disposed = false;
    function dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('hashchange', onLeave);
      window.removeEventListener('keydown', onKey);
      ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.forceContextLoss();
      if (V === api) V = null;
    }

    const api = { hf, syncAll, syncOne, highlight, light, camera, focus, viewCenter, request, setGhost, scene, cam, nodes };
    // 시험·디버그용: 블렌더 좌표 → 화면 좌표 (px, 캔버스 기준)
    api.toScreen = (x, y, up = 0.5) => {
      const v = new THREE.Vector3(x, groundB(hf, x, y) + up, -y).project(cam);
      const r = canvas.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    };
    V = api;
    root.m3d = api;
    stage.replaceChildren(canvas, placeBar, fab);
    ro.observe(stage);
    camera(S.l3cam || VIEW_CAM);
    light();
    await syncAll();
  }

  return fill(root,
    h('div', { class: 'savebar' }, picker, undoBtn, viewBtns,
      h('label', { class: 'row', style: { gap: '4px' }, title: '미리보기 밝기만 바뀌어요 (게임에는 영향 없음)' }, '☀️ 밝기', bright),
      h('label', { class: 'row', style: { gap: '4px' } }, shadowChk, '그림자'),
      status, h('span', { class: 'spacer' }), saveBtn, bakeBtn),
    h('p', { class: 'muted m3d-note' }, '미리보기는 구운 그늘 없이 보여요. "확정"을 누르면 맵 팀이 이 배치로 빛·그늘을 다시 구워 게임에 넣어요 (D-348). 시간대는 지금 노을로 고정이에요.'),
    h('div', { class: 'm3d-layout' }, side, stage, props));
}

// 땅: 꼭짓점 색 G(흙길 무게)로 풀·흙 섞기 + 가파른 곳은 지형 glb 에 든 절벽 무늬. 무거운 바닥 그림(수 MB)은 받지 않음 (휴대폰)
function groundMaterial(THREE, old) {
  const cliff = old?.map || null;
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.cliffMap = { value: cliff };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 color;\nvarying float vPath;\nvarying vec3 vW;\nvarying vec3 vN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPath = color.g;\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vPath; varying vec3 vW; varying vec3 vN;
${cliff ? 'uniform sampler2D cliffMap;' : ''}
float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `
float n = vn(vW.xz * 0.35) * 0.6 + vn(vW.xz * 2.1) * 0.4;
vec3 grass = mix(vec3(0.11, 0.17, 0.035), vec3(0.22, 0.27, 0.05), n);
vec3 dirt = mix(vec3(0.24, 0.10, 0.04), vec3(0.34, 0.16, 0.07), n);
vec3 col = mix(grass, dirt, smoothstep(0.2, 0.65, vPath + (n - 0.5) * 0.25));
float steep = 1.0 - smoothstep(0.55, 0.8, abs(vN.y));
${cliff ? 'vec3 cl = texture2D(cliffMap, vec2(vW.x + vW.z, -vW.y) / 4.0).rgb;' : 'vec3 cl = vec3(0.2, 0.17, 0.14) * (0.7 + 0.6 * n);'}
col = mix(col, cl, steep);
vec4 diffuseColor = vec4(col, opacity);`);
  };
  return m;
}

// 블렌더 절차 무늬(나뭇결 등)는 glb 로 안 넘어오므로 맵 json view3d.matColor(색)·matTint(무늬에 곱할 색) 를 씀 — 게임과 같은 방식
function applyMatColors(THREE, root, view3d) {
  const col = view3d?.matColor || {}, tint = view3d?.matTint || {};
  root.traverse(m => {
    if (!m.isMesh) return;
    for (const mat of [].concat(m.material)) {
      if (mat.userData.m3dColored) continue;
      mat.userData.m3dColored = true;
      const c = col[mat.name] || tint[mat.name];
      if (c) mat.color.setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
    }
  });
}
