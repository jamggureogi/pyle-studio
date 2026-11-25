// 3D 맵 배치 (사용자 D-309 + D-348 C): 3D 맵은 충돌 판정을 만질 필요가 없으니 사물을 끌어 옮기고·더하고·지우는 화면만 둔다.
// 끌면 바로 임시 미리보기(구운 그늘 없이), '확정'하면 요청함에 "3D 다시 굽기"를 남겨 맵 팀이 다시 굽는다.
// 자료: data/maps3d/<맵>.layout.json (좌표는 블렌더 m: x 오른쪽, y 안쪽, z 위 → three.js 로는 (x, z, -y)).
import { h, toast, fill } from '../ui.js';
import { newId } from './requests.js';

const PROPS_DIR = 'assets/_inbox/claude/test3d/props/';
const REQUESTS = 'data/requests.json';
export const layoutPath = id => `data/maps3d/${id}.layout.json`;

const KIND_NAMES = { cabin: '산장', lumber: '통나무 더미', workbench: '작업대', sawhorse: '톱질 받침', rock: '바위', tree: '나무' };
const KIND_ICON = { cabin: '🏠', lumber: '🪵', workbench: '🛠', sawhorse: '🪚', rock: '🪨', tree: '🌳' };
const TREE_MODELS = { N1_young: '어린 나무', N2_lean2: '기운 나무', N3_round3: '둥근 나무', N4_fork_big: '큰 갈래 나무', N5_fork_wide: '넓은 갈래 나무', N6_old4: '늙은 나무' };
const ROCK_SIZES = [[0.5, '작은 바위'], [0.8, '보통 바위'], [1.1, '큰 바위']];
const SCALE_RANGE = { rock: [0.3, 1.6, 0.05], tree: [0.6, 1.4, 0.01], default: [0.6, 1.5, 0.05] };
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

// 모델 glb 는 한 번만 불러 두고 복제해서 씀 (store 가 바뀌면 새로)
let MODELS = { store: null, map: new Map() };
function loadModel(store, path) {
  if (MODELS.store !== store) MODELS = { store, map: new Map() };
  if (!MODELS.map.has(path)) {
    const p = (async () => {
      const { GLTFLoader } = await lib();
      const url = await store.blobUrl(path);
      const g = await new GLTFLoader().loadAsync(url);
      return g.scene;
    })();
    p.catch(() => MODELS.map.delete(path));
    MODELS.map.set(path, p);
  }
  return MODELS.map.get(path);
}

const propsDir = L => (typeof L.props === 'string' && L.props.includes('<') ? L.props.slice(0, L.props.lastIndexOf('/') + 1) : PROPS_DIR);
const modelPath = (L, o) => propsDir(L) + (o.kind === 'tree' ? `tree_${o.model || 'N3_round3'}.glb` : `${o.kind}.glb`);
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

function warningsFor(L, hf, o) {
  const w = [];
  const [x, y] = o.pos;
  const b = L.bounds;
  if (b && (x < b[0] || y < b[1] || x > b[2] || y > b[3])) w.push('걸을 수 있는 땅 밖이에요');
  if (o.kind === 'rock') {
    const r = o.scale || 1;
    if (nearCliff(hf, x, y, r + 0.8, 0.22 + 0.15 * r)) w.push('절벽·비탈 끝이라 굽기 때 빠져요');
  } else if (o.kind === 'tree' && !o.big) {
    if (nearCliff(hf, x, y, 2.8, 0.9)) w.push('절벽 끝(2.8m 안)이라 굽기 때 빠져요');
  }
  return w;
}

function nextId(L, kind) {
  let max = 0;
  for (const o of L.objects) {
    if (o.id === kind) max = Math.max(max, 1);
    const m = o.id.match(new RegExp(`^${kind}_(\\d+)$`));
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
  const st = S.l3 ||= { sel: null, undo: [], bright: 1, shadow: true };

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
      const req = { id: `req_bake_${S.id}_${Date.now()}`, room: 'map', team: '맵', mapId: S.id, title: `3D 다시 굽기: ${S.id}`,
        body: '편집실 3D 배치에서 확정 — 이 배치로 다시 구워 주세요 (D-348 C).', status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' };
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
  const warnOf = o => (V ? warningsFor(L, V.hf, o) : []);

  // ---------- 왼쪽: 더하기 + 사물 목록 ----------
  const treeSel = h('select', {}, Object.entries(TREE_MODELS).map(([k, l]) => h('option', { value: k }, l)));
  const rockSel = h('select', {}, ROCK_SIZES.map(([v, l]) => h('option', { value: v, selected: v === 0.8 }, l)));
  const listBox = h('div', { class: 'm3d-list' });
  function addObject(kind) {
    if (!V) return;
    pushUndo();
    const [x, y] = V.viewCenter();
    const o = { id: nextId(L, kind), kind, pos: [r3(x), r3(y)], rot: 0, scale: 1 };
    if (kind === 'rock') Object.assign(o, { scale: Number(rockSel.value), sq: 0.75, seed: Math.floor(Math.random() * 200) - 100 });
    if (kind === 'tree') Object.assign(o, { model: treeSel.value, scale: 1, mirror: Math.random() < 0.5 });
    L.objects.push(o);
    st.sel = o.id;
    markDirty();
    V.syncAll();
    toast(`${KIND_NAMES[kind]}을(를) 화면 가운데에 놓았어요. 끌어서 옮겨 주세요.`);
  }
  function drawList() {
    const groups = {};
    for (const o of L.objects) (groups[o.kind] ||= []).push(o);
    let warnTotal = 0;
    const rows = Object.entries(groups).map(([kind, list]) => h('div', {},
      h('div', { class: 'm3d-group' }, `${KIND_ICON[kind] || ''} ${KIND_NAMES[kind] || kind} ${list.length}`),
      list.map(o => {
        const w = warnOf(o); warnTotal += w.length ? 1 : 0;
        return h('button', { class: `pal ${o.id === st.sel ? 'on' : ''}`, title: w.join(' / '), onclick: () => { select(o.id); V?.focus(o); } },
          h('span', {}, o.id), o.kind === 'tree' && h('span', { class: 'muted', style: { fontSize: '12px' } }, TREE_MODELS[o.model] || o.model),
          w.length ? h('span', { class: 'badge warn', style: { marginLeft: 'auto' } }, '⚠') : null);
      })));
    fill(listBox, warnTotal ? h('div', { class: 'm3d-warnsum' }, `⚠ 주의 ${warnTotal}개 — 굽기 때 빠질 수 있어요`) : null, rows);
  }
  fill(side,
    h('h4', { style: { marginTop: 0 } }, '➕ 더하기'),
    h('div', { class: 'm3d-add' },
      ['cabin', 'lumber', 'workbench', 'sawhorse'].map(k => h('button', { class: 'btn small', onclick: () => addObject(k) }, `${KIND_ICON[k]} ${KIND_NAMES[k]}`))),
    h('div', { class: 'm3d-addrow' }, treeSel, h('button', { class: 'btn small', onclick: () => addObject('tree') }, '🌳 나무 더하기')),
    h('div', { class: 'm3d-addrow' }, rockSel, h('button', { class: 'btn small', onclick: () => addObject('rock') }, '🪨 바위 더하기')),
    h('p', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 0' } }, '새 사물은 지금 보는 화면 가운데에 놓여요.'),
    h('h4', {}, '놓인 사물'), listBox);

  // ---------- 오른쪽: 고른 사물 정보 ----------
  function drawProps() {
    const o = selObj();
    if (!o) {
      fill(props, h('h4', { style: { marginTop: 0 } }, '사물 고르기'),
        h('p', { class: 'muted', style: { fontSize: '13px' } }, '3D 화면에서 사물을 누르면 골라져요. 고른 채로 끌면 옮겨지고, 빈 곳을 끌면 화면이 돌아가요.'),
        h('ul', { class: 'm3d-help' },
          h('li', {}, '마우스: 왼쪽 끌기 = 돌려 보기, 오른쪽 끌기 = 옮겨 보기, 휠 = 가깝게/멀게'),
          h('li', {}, '휴대폰: 한 손가락 = 돌려 보기·사물 끌기, 두 손가락 = 가깝게/멀게·옮겨 보기'),
          h('li', {}, '키보드: Delete = 지우기, Ctrl+Z = 되돌리기, Q/E = 15° 돌리기')));
      return;
    }
    const w = warnOf(o);
    const num = (val, step, onset) => {
      const i = h('input', { type: 'number', step, value: r3(val), class: 'num' });
      i.onchange = () => { const v = Number(i.value); if (!isNaN(v)) { pushUndo(); onset(v); markDirty(); V?.syncOne(o); } };
      return i;
    };
    const [smin, smax, sstep] = SCALE_RANGE[o.kind] || SCALE_RANGE.default;
    const scVal = h('b', {}, r3(o.scale ?? 1));
    const sc = h('input', { type: 'range', min: smin, max: smax, step: sstep, value: o.scale ?? 1 });
    sc.onpointerdown = () => pushUndo();
    sc.onkeydown = () => pushUndo();
    sc.oninput = () => { o.scale = Number(sc.value); scVal.textContent = r3(o.scale); markDirty(); V?.syncOne(o, true); };
    sc.onchange = () => V?.syncOne(o);
    const rotBtn = d => h('button', { class: 'btn small', onclick: () => rotate(d) }, d > 0 ? '⟲ 15°' : '⟳ 15°');
    const extra = [];
    if (o.kind === 'tree') {
      const ms = h('select', {}, Object.entries(TREE_MODELS).map(([k, l]) => h('option', { value: k, selected: k === o.model }, l)));
      ms.onchange = () => { pushUndo(); o.model = ms.value; markDirty(); V?.syncOne(o); drawList(); };
      const mir = h('input', { type: 'checkbox', checked: !!o.mirror });
      mir.onchange = () => { pushUndo(); o.mirror = mir.checked; markDirty(); V?.syncOne(o); };
      extra.push(h('label', { class: 'field' }, h('span', {}, '나무 모양'), ms), h('label', { class: 'row' }, mir, '좌우 뒤집기'));
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
      h('h4', { style: { marginTop: 0 } }, `${KIND_ICON[o.kind] || ''} ${KIND_NAMES[o.kind] || o.kind}`),
      w.length ? h('div', { class: 'm3d-warn' }, w.map(t => h('div', {}, `⚠ ${t}`))) : null,
      h('div', { class: 'm3d-kv' }, h('span', {}, '종류'), h('b', {}, KIND_NAMES[o.kind] || o.kind), h('span', {}, '이름'), h('code', {}, o.id)),
      h('div', { class: 'field' }, h('span', {}, '위치 (m) — 가로 x · 안쪽 y'),
        h('div', { class: 'row' }, num(o.pos[0], 0.1, v => { o.pos[0] = v; }), num(o.pos[1], 0.1, v => { o.pos[1] = v; }))),
      h('div', { class: 'field' }, h('span', {}, '회전 (도)'),
        h('div', { class: 'row' }, rotBtn(15), rotBtn(-15), num(o.rot || 0, 1, v => { o.rot = v; }))),
      h('label', { class: 'field' }, h('span', {}, o.kind === 'rock' ? '크기 (반지름 m) ' : '크기 (배) '), h('div', { class: 'row' }, sc, scVal)),
      extra,
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn small danger', onclick: () => remove() }, '🗑 지우기'),
        h('button', { class: 'btn small', onclick: () => select(null) }, '고르기 풀기')));
  }
  function rotate(d) {
    const o = selObj(); if (!o) return;
    pushUndo();
    o.rot = r3((((o.rot || 0) + d + 180) % 360 + 360) % 360 - 180);
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
  drawList(); drawProps();

  // 3D 준비 (비동기)
  init().catch(e => { console.error(e); fill(stage, h('div', { class: 'm3d-msg err' }, `3D 화면을 열지 못했어요: ${e.message}`)); });

  async function init() {
    const { THREE, OrbitControls } = await lib();
    const terrainPath = L.terrain || `${PROPS_DIR}terrain_${S.id}.glb`;
    const kinds = new Set(L.objects.map(o => modelPath(L, o)));
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
      } else node.scale.setScalar(s);
      const w = warningsFor(L, hf, o);
      const ring = node.userData.ring;
      ring.visible = w.length > 0;
      const rr = o.kind === 'tree' ? 1.6 : o.kind === 'rock' ? s * 1.3 : 2;
      ring.scale.set(rr / Math.abs(node.scale.x), 1 / node.scale.y, rr / node.scale.z);
      ring.position.y = 0.15 / node.scale.y;
    }
    async function build(o) {
      const key = modelPath(L, o);
      const tpl = await loadModel(ctx.store, key).catch(() => null);
      const node = new THREE.Group();
      node.userData.oid = o.id;
      if (tpl) {
        applyMatColors(THREE, tpl, S.map.view3d);
        const m = tpl.clone(true);
        m.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        node.add(m);
      } else {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
        node.add(b);
      }
      const ring = new THREE.Mesh(warnGeo, warnMat);
      ring.renderOrder = 9;
      ring.raycast = () => {};
      node.userData.ring = ring;
      node.add(ring);
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
          if (n && n.key !== modelPath(L, o)) { objRoot.remove(n.node); nodes.delete(o.id); n = null; }
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
      if (!n || n.key !== modelPath(L, o)) return syncAll();
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

    // 화면 가운데가 가리키는 땅 (새 사물 놓을 자리) — 블렌더 (x, y)
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
      const b = L.bounds || [-1e9, -1e9, 1e9, 1e9];
      return [Math.min(b[2], Math.max(b[0], p.x)), Math.min(b[3], Math.max(b[1], -p.z))];
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
    // OrbitControls 보다 먼저 듣기 (사물을 잡으면 화면 돌리기를 잠깐 끔)
    canvas.addEventListener('pointerdown', e => {
      touches++;
      canvas.focus({ preventScroll: true });
      down = { x: e.clientX, y: e.clientY, hit: null };
      if (touches > 1) { if (drag) endDrag(); return; }
      if (e.button !== 0) return;
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
      if (!drag || e.pointerId !== drag.pid) return;
      const p = groundHit(ndcOf(e));
      if (!p) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - down.x, e.clientY - down.y) < 4) return;
        pushUndo(); drag.moved = true;
      }
      const b = L.bounds || [-1e9, -1e9, 1e9, 1e9];
      drag.o.pos = [r3(Math.min(b[2], Math.max(b[0], p.x + drag.off[0]))), r3(Math.min(b[3], Math.max(b[1], -p.z + drag.off[1])))];
      markDirty();
      syncOne(drag.o, true);
    });
    function endDrag() {
      if (!drag) return;
      const d = drag; drag = null;
      controls.enabled = true;
      if (d.moved) { drawList(); drawProps(); }
    }
    const up = e => {
      touches = Math.max(0, touches - 1);
      if (drag && e.pointerId === drag.pid) endDrag();
      else if (down && !down.hit && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && touches === 0 && st.sel) select(null);
      if (touches === 0) { controls.enabled = true; down = null; }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    const onKey = e => {
      if (!canvas.isConnected || e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'q' || e.key === 'Q') rotate(15);
      else if (e.key === 'e' || e.key === 'E') rotate(-15);
      else if (e.key === 'Escape') select(null);
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

    const api = { hf, syncAll, syncOne, highlight, light, camera, focus, viewCenter, request, scene, cam, nodes };
    // 시험·디버그용: 블렌더 좌표 → 화면 좌표 (px, 캔버스 기준)
    api.toScreen = (x, y, up = 0.5) => {
      const v = new THREE.Vector3(x, groundB(hf, x, y) + up, -y).project(cam);
      const r = canvas.getBoundingClientRect();
      return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
    };
    V = api;
    root.m3d = api;
    stage.replaceChildren(canvas);
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
