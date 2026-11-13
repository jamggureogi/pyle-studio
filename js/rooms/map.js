// Map room: paint terrain with natural noise-blended borders, place events linked to story scenes,
// place objects, and assign approved ground textures to terrain types.
import { h, toast, modal, confirmBox, fill } from '../ui.js';
import { requestPanel } from './requests.js';
import { TerrainRenderer, drawHeights, loadStrip, CLIFF_FACE, CLIFF_LIP, applyEffects, hasEffects, SHADOW_DEFAULT, BEVEL_DEFAULT } from '../terrain.js';
import { newId } from './requests.js';
import { loadRegistry, thumb, KINDS } from '../assets.js';

const TILE = 64;
const INDEX = 'data/maps/index.json';
const TERRAINS = 'data/terrains.json';
const STORY = 'data/story/prologue.json';
const EVENT_KINDS = { trigger: '이벤트 지점', npc: 'NPC', exit: '출입구', zone: '구역 (밟으면 장면)', enter: '맵에 들어오면 (첫 장면)', mark: '이름표 (카메라 이동용)', chest: '보물상자', battle: '전투 지점', start: '시작 위치' };
const EVENT_ICON = { trigger: '★', npc: '☺', exit: '⇥', zone: '▦', enter: '◉', mark: '⚑', chest: '▣', battle: '⚔', start: '▶' };
const FEEDBACK = 'data/requests.json';

let M = null; // { map, sha, id, dirty, defs, renderer, ... }

export async function render(ctx, rest) {
  const tab = ['edit', 'terrains', 'requests'].includes(rest[0]) ? rest[0] : 'edit';
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '🗺️ 맵룸'),
    h('p', { class: 'sub' }, '지형을 칠하면 경계가 자연스럽게 섞여요. 이벤트 지점을 찍고 스토리 장면과 연결할 수 있어요.'),
    h('div', { class: 'tabs' }, [['edit', '맵 편집'], ['terrains', '바닥 재질'], ['requests', '요청함']].map(([id, l]) => h('a', { href: `#/map/${id}`, class: tab === id ? 'on' : '' }, l))));
  if (tab === 'requests') { page.append(requestPanel(ctx, 'map')); return page; }
  if (tab === 'terrains') { page.append(await terrainsView(ctx)); return page; }
  page.append(await editView(ctx, rest[1]));
  return page;
}

window.addEventListener('beforeunload', e => { if (M?.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------- terrains (texture assignment) ----------
async function terrainsView(ctx) {
  const [{ data, sha }, assets] = await Promise.all([ctx.store.getJSON(TERRAINS, { terrains: [] }), loadRegistry(ctx.store)]);
  const tiles = assets.filter(a => a.kind === 'tile' && a.status !== '보관');
  const rows = data.terrains.map((t, i) => {
    const sel = h('select', {}, h('option', { value: '' }, '(임시 색으로 표시)'), tiles.map(a => h('option', { value: a.file, selected: a.file === t.file }, `${a.id} · ${a.status}`)));
    const color = h('input', { type: 'color', value: t.color });
    const amp = h('input', { type: 'number', step: 0.05, min: 0, max: 1, value: t.edgeAmp, class: 'num' });
    const freq = h('input', { type: 'number', step: 1, min: 2, max: 30, value: t.edgeFreq, class: 'num' });
    const walk = h('input', { type: 'checkbox', checked: t.walkable !== false });
    const fx = { shadow: t.shadow ? { ...t.shadow } : null, bevel: t.bevel ? { ...t.bevel } : null };
    const fxBtn = h('button', { class: 'btn small' });
    const fxLabel = () => { fxBtn.textContent = [fx.shadow?.on && '그림자', fx.bevel?.on && '베벨'].filter(Boolean).join('·') || '효과 없음'; };
    fxLabel();
    fxBtn.onclick = () => effectsDialog(ctx, data.terrains, i, fx, () => fxLabel());
    const collect = () => {
      const o = { ...t, file: sel.value || null, color: color.value, edgeAmp: Number(amp.value), edgeFreq: Number(freq.value), walkable: walk.checked };
      if (fx.shadow) o.shadow = fx.shadow; else delete o.shadow;
      if (fx.bevel) o.bevel = fx.bevel; else delete o.bevel;
      return o;
    };
    return { el: h('tr', {}, h('td', {}, i + 1), h('td', {}, h('b', {}, t.name), h('div', { class: 'muted', style: { fontSize: '11px' } }, t.id)),
      h('td', {}, t.file ? thumb(ctx.store, t.file, 'thumb mini') : h('span', { class: 'swatch', style: { background: t.color } })),
      h('td', {}, sel), h('td', {}, color), h('td', {}, amp), h('td', {}, freq), h('td', {}, walk), h('td', {}, fxBtn)), collect };
  });
  const save = async () => {
    try {
      await ctx.store.updateJSON(TERRAINS, d => ({ ...d, terrains: rows.map(r => r.collect()) }), '바닥 재질 설정 수정');
      toast('저장했어요. 맵 편집에서 바로 반영돼요.');
      M = null;
    } catch (e) { toast(e.message, true); }
  };
  return h('div', {},
    h('div', { class: 'card' },
      h('p', { class: 'muted' }, '지형마다 승인된 바닥 재질 그림을 연결해요. 그림이 없으면 임시 색으로 보여요. 위쪽 지형일수록 아래 지형 위에 덮여요. "경계 흔들림"이 클수록 경계가 구불구불하고, "경계 촘촘함"이 클수록 잘게 들쭉날쭉해요.'),
      h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'tbl' },
        h('tr', {}, ['순서', '지형', '그림', '바닥 재질 그림', '임시 색', '경계 흔들림', '경계 촘촘함', '걸을 수 있음', '그림자·베벨'].map(x => h('th', {}, x))),
        rows.map(r => r.el))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: save }, '저장'), h('span', { class: 'muted' }, `바닥 재질 후보·승인 그림 ${tiles.length}장`))));
}

// ---------- 지형 효과 (그림자·베벨) 설정 + 작은 미리보기 ----------
// 미리보기: 이 지형이 아래 지형 위에 덩어리로 놓인 6×4칸을 게임과 같은 방법으로 그린다.
async function effectsDialog(ctx, terrains, idx, fx, onDone) {
  const t = terrains[idx];
  const below = terrains.slice(0, idx).reverse().find(x => x.walkable !== false) || terrains.find(x => x.id !== t.id);
  const work = { shadow: { ...SHADOW_DEFAULT, on: false, ...(fx.shadow || {}) }, bevel: { ...BEVEL_DEFAULT, on: false, ...(fx.bevel || {}) } };
  const cv = h('canvas', { class: 'fx-preview' });
  const cols = 6, rows = 4;
  const corners = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) corners.push(r >= 1 && r <= 3 && c >= 1 && c <= 4 && !(r === 1 && c === 4) ? 1 : 0);
  const mini = { cols, rows, terrains: [below.id, t.id], corners };
  const defsNow = () => terrains.map((d, k) => k === idx ? { ...d, shadow: work.shadow, bevel: work.bevel } : d);
  const rend = new TerrainRenderer(mini, defsNow(), ctx.store, 1);
  let ready = false;
  const redraw = () => {
    if (!ready) return;
    cv.width = rend.W; cv.height = rend.H;
    const g = cv.getContext('2d'); g.drawImage(rend.canvas, 0, 0);
    const im = g.getImageData(0, 0, rend.W, rend.H);
    applyEffects(im.data, rend.W, rend.H, rend.cover, mini.terrains, defsNow(), 1);
    g.putImageData(im, 0, 0);
  };
  rend.init().then(() => { rend.render(); ready = true; redraw(); });
  const num = (obj, key, min, max, step, label) => {
    const r = h('input', { type: 'range', min, max, step, value: obj[key] });
    const v = h('span', { class: 'muted', style: { minWidth: '38px', display: 'inline-block' } }, obj[key]);
    r.oninput = () => { obj[key] = Number(r.value); v.textContent = r.value; redraw(); };
    return h('label', { class: 'fx-row' }, h('span', {}, label), r, v);
  };
  const chk = (obj, label) => { const c = h('input', { type: 'checkbox', checked: obj.on }); c.onchange = () => { obj.on = c.checked; redraw(); }; return h('label', { class: 'row', style: { fontWeight: 600 } }, c, label); };
  const color = h('input', { type: 'color', value: work.shadow.color }); color.oninput = () => { work.shadow.color = color.value; redraw(); };
  const ok = await modal(`그림자·베벨: ${t.name}`, h('div', { class: 'fx-dialog' },
    h('p', { class: 'muted', style: { fontSize: '12px', margin: '0 0 8px' } }, `미리보기: "${below.name}" 위에 놓인 "${t.name}" (게임 바닥과 같은 계산). 빛은 각도 쪽에서 와요 (135 = 왼쪽 위).`),
    cv,
    h('div', { class: 'fx-cols' },
      h('div', {}, chk(work.shadow, '그림자 (드롭섀도우)'),
        num(work.shadow, 'angle', 0, 360, 5, '각도'), num(work.shadow, 'distance', 0, 40, 1, '거리'), num(work.shadow, 'size', 0, 40, 1, '크기(번짐)'),
        num(work.shadow, 'opacity', 0, 1, 0.05, '불투명도'), h('label', { class: 'fx-row' }, h('span', {}, '색'), color)),
      h('div', {}, chk(work.bevel, '베벨 (경계를 볼록하게)'),
        num(work.bevel, 'angle', 0, 360, 5, '빛 각도'), num(work.bevel, 'size', 1, 40, 1, '크기'), num(work.bevel, 'depth', 0.2, 3, 0.1, '깊이'),
        num(work.bevel, 'highlight', 0, 1, 0.05, '밝은 쪽'), num(work.bevel, 'shade', 0, 1, 0.05, '어두운 쪽')))),
    [{ label: '취소', value: false }, { label: '적용 (저장은 표 아래 [저장])', value: true, primary: true }]);
  if (!ok) return;
  fx.shadow = work.shadow.on ? work.shadow : null;
  fx.bevel = work.bevel.on ? work.bevel : null;
  onDone();
}

// ---------- editor ----------
async function loadMap(ctx, id) {
  const [idx, terr, story, assets, sprites, propsF] = await Promise.all([
    ctx.store.getJSON(INDEX, { maps: [] }), ctx.store.getJSON(TERRAINS, { terrains: [] }),
    ctx.store.getJSON(STORY, { scenes: {} }).catch(() => ({ data: { scenes: {} } })), loadRegistry(ctx.store),
    ctx.store.getJSON('data/sprites.json', {}).catch(() => ({ data: {} })),
    ctx.store.getJSON('data/props.json', { props: {} }).catch(() => ({ data: { props: {} } }))]);
  const list = idx.data.maps;
  const mid = id && list.find(m => m.id === id) ? id : list[0]?.id;
  if (!mid) return { list, empty: true };
  const f = await ctx.store.getJSON(`data/maps/${mid}.json`);
  return { list, id: mid, map: f.data, sha: f.sha, defs: terr.data.terrains, scenes: story.data.scenes || {}, assets, sprites: sprites.data || {}, props: (propsF.data || {}).props || {}, dirty: false, store: ctx.store };
}

async function editView(ctx, id) {
  if (!M || M.store !== ctx.store || (id && id !== M.id)) {
    if (M?.dirty && !(await confirmBox('저장 안 한 맵 변경이 있어요. 버리고 다른 맵을 열까요?', '버리기'))) { ctx.go(`#/map/edit/${M.id}`); }
    M = await loadMap(ctx, id);
  }
  if (M.empty) return h('div', { class: 'card empty' }, '맵이 없어요. ', h('button', { class: 'btn small', onclick: () => newMap(ctx) }, '+ 새 맵'));
  const st = M.ui ||= { tool: 'terrain', terrain: M.map.terrains.indexOf('dirt_path') >= 0 ? M.map.terrains.indexOf('dirt_path') : 0, brush: 1, grid: true, zoom: 0.5, quality: 0.5, sel: null, hlevel: 1, hstyle: 'cliff', blendMode: 1 };
  st.hlevel ??= 1; st.hstyle ??= 'cliff'; st.blendMode ??= 1; st.passMode ??= 2; st.showPass ??= false; st.passCell ??= TILE; st.passTarget ??= 'map';

  const stage = h('div', { class: 'map-stage' }, h('div', { class: 'empty' }, '지형 그리는 중… (처음엔 몇 초 걸려요)'));
  const side = h('div', { class: 'map-side' });
  const props = h('div', { class: 'card map-props' });
  const status = h('span', { class: 'muted' });

  const saveBtn = h('button', { class: 'btn small primary', disabled: !M.dirty }, '저장');
  const markDirty = () => { M.dirty = true; saveBtn.disabled = false; status.textContent = '저장 안 한 변경 있음'; };
  saveBtn.onclick = async () => {
    try {
      M.sha = await ctx.store.putText(`data/maps/${M.id}.json`, JSON.stringify(M.map) + '\n', M.sha, `맵 수정: ${M.map.name}`);
      M.dirty = false; saveBtn.disabled = true; status.textContent = '저장했어요'; toast('저장했어요.');
    } catch (e) { toast(e.message, true); }
  };

  const mapSel = h('select', {}, M.list.map(m => h('option', { value: m.id, selected: m.id === M.id }, m.name)));
  mapSel.onchange = () => ctx.go(`#/map/edit/${mapSel.value}`);
  const q = h('select', {}, [[0.5, '보통 화질 (빠름)'], [1, '고화질']].map(([v, l]) => h('option', { value: v, selected: v === st.quality }, l)));
  q.onchange = () => { st.quality = Number(q.value); M.renderer = null; draw(); };
  const zoomSel = h('select', {}, [[0.5, '50%'], [0.75, '75%'], [1, '100%'], [1.5, '150%']].map(([v, l]) => h('option', { value: v, selected: v === st.zoom }, l)));
  zoomSel.onchange = () => { st.zoom = Number(zoomSel.value); layout(); };
  const gridChk = h('input', { type: 'checkbox', checked: st.grid });
  gridChk.onchange = () => { st.grid = gridChk.checked; overlay(); };
  const passChk = h('input', { type: 'checkbox', checked: st.showPass });
  passChk.onchange = () => { st.showPass = passChk.checked; overlay(); };

  // canvases: terrain (from renderer) + overlay (grid, events, objects)
  const base = h('canvas', { class: 'map-base' });
  const over = h('canvas', { class: 'map-over' });
  const wrap = h('div', { class: 'map-canvas' }, base, over);
  const W = M.map.cols * TILE, H = M.map.rows * TILE;
  const objImgs = new Map();

  function layout() {
    for (const c of [base, over]) { c.style.width = `${W * st.zoom}px`; c.style.height = `${H * st.zoom}px`; }
    wrap.style.width = `${W * st.zoom}px`; wrap.style.height = `${H * st.zoom}px`;
  }
  async function draw() {
    if (!M.renderer || M.renderer.scale !== st.quality) {
      M.renderer = new TerrainRenderer(M.map, M.defs, ctx.store, st.quality);
      await M.renderer.init();
      await new Promise(r => setTimeout(r, 30));
      M.renderer.render();
    }
    if (!M.strips) M.strips = { face: await loadStrip(ctx.store, CLIFF_FACE), lip: await loadStrip(ctx.store, CLIFF_LIP) };
    base.width = M.renderer.W; base.height = M.renderer.H;
    paintBase();
    over.width = W; over.height = H;
    layout();
    stage.replaceChildren(wrap);
    overlay();
  }
  // ---------- 통행 지도 (게임 field.gd와 같은 규칙) ----------
  // 막힌 칸 = 걸을 수 없는 지형(모서리 4개 중 2개 이상) + 건물 발자리 + 절벽 벽(높은 칸 바로 아래, 비탈 아님) + 통행 붓.
  // 다리·계단은 걷는 자리만 열리고 난간은 칸보다 섬세하게 막힘 (자료 저장소의 사물 정보 파일).
  // 사물(나무·바위)은 밑동 둘레만 막혀서 주황 원으로 보여요.
  // 사물 정보 (data/props.json, 키 = 그림 파일 이름): 걷는 자리 walk, 막힘 자리 block, 깔림 ground … 맵에 직접 적은 값이 우선
  const propOf = o => ({ ...(M.props[(o.file || '').split('/').pop().replace(/\.[a-z]+$/, '')] || {}), ...o });
  function objBox(o) {
    const im = objImgs.get(o.file); if (!im) return null;
    const p = propOf(o), w = im.naturalWidth * o.scale, hh = im.naturalHeight * o.scale, x = o.x - w / 2, y = o.y - hh;
    const rect = r => { let a = r[0], b = r[2]; if (o.flip) { a = 1 - r[2]; b = 1 - r[0]; } return { x: x + w * a, y: y + hh * r[1], w: w * (b - a), h: hh * (r[3] - r[1]) }; };
    const bl = Array.isArray(p.block) && p.block.length ? (Array.isArray(p.block[0]) ? p.block : [p.block]).map(rect) : null;
    return { x, y, w, h: hh, ground: !!p.ground, bridge: !!p.bridge, walk: Array.isArray(p.walk) ? rect(p.walk) : null, block: bl, collide: p.collide };
  }
  // 네모 outer에서 keep(걷는 자리)을 뺀 나머지 조각들
  function minus(o, k) {
    const x0 = Math.max(o.x, k.x), y0 = Math.max(o.y, k.y), x1 = Math.min(o.x + o.w, k.x + k.w), y1 = Math.min(o.y + o.h, k.y + k.h);
    if (x1 <= x0 || y1 <= y0) return [o];
    const out = [];
    if (y0 > o.y) out.push({ x: o.x, y: o.y, w: o.w, h: y0 - o.y });
    if (y1 < o.y + o.h) out.push({ x: o.x, y: y1, w: o.w, h: o.y + o.h - y1 });
    if (x0 > o.x) out.push({ x: o.x, y: y0, w: x0 - o.x, h: y1 - y0 });
    if (x1 < o.x + o.w) out.push({ x: x1, y: y0, w: o.x + o.w - x1, h: y1 - y0 });
    return out;
  }
  let opened = [];
  function passGrid() {
    const { cols, rows } = M.map, P = new Uint8Array(cols * rows);
    opened = [];
    const walk = id => (M.defs.find(d => d.id === id) || {}).walkable !== false;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let bad = 0;
      for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) if (!walk(M.map.terrains[M.map.corners[cy * (cols + 1) + cx]])) bad++;
      if (bad >= 2) P[y * cols + x] = 1;
    }
    for (const b of M.map.buildings || []) {
      const op = new Set((b.open || []).map(c => `${c[0]},${c[1]}`));     // 건물 그림이 빈 발자리 칸 = 걸을 수 있음 (게임과 같음)
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < cols && y < rows && !op.has(`${x},${y}`)) P[y * cols + x] = 1;
    }
    const H = M.map.heights, L = M.map.hills || [];
    if (H) for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++) if ((H[y * cols + x] || 0) > (H[(y + 1) * cols + x] || 0) && !(L[y * cols + x] > 0)) P[(y + 1) * cols + x] = 1;
    // 다리·계단: 걷는 자리(walk)가 닿는 칸은 물·절벽이어도 열린다 (난간은 drawPass가 빨갛게)
    for (const o of M.map.objects) {
      const bx = objBox(o); if (!bx) continue;
      if (bx.walk) {
        const k = bx.walk;
        for (let ty = Math.floor(k.y / TILE); ty <= Math.floor((k.y + k.h - 0.01) / TILE); ty++)
          for (let tx = Math.floor(k.x / TILE); tx <= Math.floor((k.x + k.w - 0.01) / TILE); tx++)
            if (tx >= 0 && ty >= 0 && tx < cols && ty < rows && P[ty * cols + tx] === 1) { P[ty * cols + tx] = 0; opened.push([tx, ty, k]); }
      } else if (bx.bridge) {
        for (let ty = Math.floor((o.y - bx.h * 0.72) / TILE); ty <= Math.floor((o.y - bx.h * 0.2) / TILE); ty++)
          for (let tx = Math.floor(bx.x / TILE); tx <= Math.floor((bx.x + bx.w) / TILE); tx++) if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) P[ty * cols + tx] = 0;
      }
    }
    const po = M.map.passOverride;
    if (po) for (let i = 0; i < P.length; i++) { if (po[i] === 1) P[i] = 2; else if (po[i] === 2) P[i] = 3; }
    return P;   // 0 열림, 1 막힘, 2 붓으로 엶, 3 붓으로 막음
  }
  function drawPass(g) {
    const P = passGrid(), { cols, rows } = M.map;
    const col = ['', 'rgba(255,40,30,0.38)', 'rgba(60,130,255,0.38)', 'rgba(200,0,120,0.45)'];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const v = P[y * cols + x]; if (v) { g.fillStyle = col[v]; g.fillRect(x * TILE, y * TILE, TILE, TILE); } }
    // 칸보다 섬세한 막힘: 다리·계단의 난간(빨강)과 걷는 자리(초록), 넓은 사물의 발자리(빨강), 그 밖의 사물은 밑동 원(주황)
    const red = 'rgba(255,40,30,0.38)';
    g.fillStyle = red;
    for (const [tx, ty, k] of opened) for (const r of minus({ x: tx * TILE, y: ty * TILE, w: TILE, h: TILE }, k)) g.fillRect(r.x, r.y, r.w, r.h);
    for (const o of M.map.objects) {
      const bx = objBox(o); if (!bx) continue;
      if (bx.walk) {
        g.fillStyle = red; for (const r of minus(bx, bx.walk)) g.fillRect(r.x, r.y, r.w, r.h);
        g.fillStyle = 'rgba(50,220,100,0.32)'; g.fillRect(bx.walk.x, bx.walk.y, bx.walk.w, bx.walk.h);
      } else if (bx.block) {
        g.fillStyle = red; for (const r of bx.block) g.fillRect(r.x, r.y, r.w, r.h);
      } else if (bx.collide !== false && !bx.ground) {
        g.fillStyle = 'rgba(255,150,20,0.5)';
        g.beginPath(); g.arc(o.x, o.y - 8, Math.min(46, Math.max(10, bx.w * 0.16)), 0, Math.PI * 2); g.fill();
      }
    }
    // 칸보다 작은 통행 붓 (passFine, 16px 조각): 분홍 = 막기, 파랑 = 열기
    const pf = M.map.passFine;
    if (pf && pf.cells) for (const [k, v] of Object.entries(pf.cells)) {
      const [cx, cy] = k.split(',').map(Number), cs = pf.cell || 16;
      g.fillStyle = v === 2 ? 'rgba(200,0,120,0.5)' : 'rgba(60,130,255,0.5)'; g.fillRect(cx * cs, cy * cs, cs, cs);
    }
    // 사물에 칠하기: 고른 사물의 그림 테두리와 16px 눈금
    if (st.tool === 'pass' && st.passTarget === 'object' && st.sel && M.map.objects.includes(st.sel)) {
      const bx = objBox(st.sel);
      if (bx) {
        g.save(); g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1;
        for (let x = bx.x; x <= bx.x + bx.w; x += FINE) { g.beginPath(); g.moveTo(x, bx.y); g.lineTo(x, bx.y + bx.h); g.stroke(); }
        for (let y = bx.y; y <= bx.y + bx.h; y += FINE) { g.beginPath(); g.moveTo(bx.x, y); g.lineTo(bx.x + bx.w, y); g.stroke(); }
        g.setLineDash([10, 6]); g.strokeStyle = '#ffd34d'; g.lineWidth = 4; g.strokeRect(bx.x, bx.y, bx.w, bx.h); g.restore();
      }
    }
    if (st.tool === 'pass' && st.passTarget === 'object' && st.sel && (M.map.buildings || []).includes(st.sel)) {
      const b = st.sel;
      g.save(); g.setLineDash([10, 6]); g.strokeStyle = '#ffd34d'; g.lineWidth = 4; g.strokeRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE); g.restore();
    }
    if (rectDrag) {                                         // 사각형으로 칠하기: 끌고 있는 범위
      const x0 = Math.min(rectDrag.a.x, rectDrag.b.x), y0 = Math.min(rectDrag.a.y, rectDrag.b.y);
      g.save(); g.fillStyle = rectDrag.mode === 2 ? 'rgba(200,0,120,0.18)' : 'rgba(60,130,255,0.18)'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.setLineDash([8, 6]);
      g.fillRect(x0, y0, Math.abs(rectDrag.b.x - rectDrag.a.x), Math.abs(rectDrag.b.y - rectDrag.a.y));
      g.strokeRect(x0, y0, Math.abs(rectDrag.b.x - rectDrag.a.x), Math.abs(rectDrag.b.y - rectDrag.a.y)); g.restore();
    }
  }
  // ---------- 칸보다 작은 통행 붓 / 사물에 칠하는 통행 붓 (req_mwc8hc7v9a8q) ----------
  const FINE = 16;
  function paintPassFine(p) {
    const cs = st.passCell, n = st.brush - 1, k = cs / FINE;
    const c0 = Math.floor(p.x / cs) - n, r0 = Math.floor(p.y / cs) - n;
    M.map.passFine ||= { cell: FINE, cells: {} };
    const cells = M.map.passFine.cells; let changed = false;
    for (let r = r0; r <= r0 + 2 * n; r++) for (let c = c0; c <= c0 + 2 * n; c++)
      for (let yy = 0; yy < k; yy++) for (let xx = 0; xx < k; xx++) {
        const x = c * k + xx, y = r * k + yy; if (x < 0 || y < 0 || x * FINE >= M.map.cols * TILE || y * FINE >= M.map.rows * TILE) continue;
        const key = `${x},${y}`;
        if (curMode === 0) { if (key in cells) { delete cells[key]; changed = true; } }
        else if (cells[key] !== curMode) { cells[key] = curMode; changed = true; }
      }
    if (!changed) return;
    if (!Object.keys(cells).length) delete M.map.passFine;
    markDirty(); overlay();
  }
  // 사물 막힘을 16px 조각으로: o.blockCells(그림 안 조각 번호, 뒤집기 전 기준) → o.block(그림 안 비율 네모들, 게임이 읽음)
  function objCellsInit(o, bx) {
    if (o.blockCells) return;
    const cw = Math.ceil(bx.w / FINE), ch = Math.ceil(bx.h / FINE), set = new Set();
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
      const fx = (i + 0.5) * FINE / bx.w, fy = (j + 0.5) * FINE / bx.h;
      const wx = bx.x + (o.flip ? 1 - fx : fx) * bx.w, wy = bx.y + fy * bx.h;
      const inBlock = bx.block ? bx.block.some(r => wx >= r.x && wx < r.x + r.w && wy >= r.y && wy < r.y + r.h)
        : (!bx.walk && bx.collide !== false && !bx.ground && Math.hypot(wx - o.x, wy - (o.y - 8)) < Math.min(46, Math.max(10, bx.w * 0.16)));
      if (inBlock) set.add(`${i},${j}`);
    }
    o.blockCells = [...set];
  }
  function objCellsApply(o, bx) {
    const rows = {};
    for (const k of o.blockCells) { const [i, j] = k.split(',').map(Number); (rows[j] ||= []).push(i); }
    const rects = [];
    for (const [j, is] of Object.entries(rows)) {
      is.sort((a, b) => a - b);
      let a = is[0], b = is[0];
      const push = () => rects.push([+(a * FINE / bx.w).toFixed(4), +(j * FINE / bx.h).toFixed(4), +Math.min(1, (b + 1) * FINE / bx.w).toFixed(4), +Math.min(1, (+j + 1) * FINE / bx.h).toFixed(4)]);
      for (const i of is.slice(1)) { if (i === b + 1) b = i; else { push(); a = b = i; } }
      push();
    }
    o.block = rects;
    o.collide = rects.length > 0;
  }
  function paintObjPass(p) {
    const o = st.sel, bx = o && objBox(o);
    if (!bx) return;
    objCellsInit(o, bx);
    const set = new Set(o.blockCells), n = st.brush - 1, k = Math.max(1, st.passCell / FINE);
    let fx = (p.x - bx.x) / bx.w; if (o.flip) fx = 1 - fx;
    const ci = Math.floor(fx * bx.w / FINE / k) * k, cj = Math.floor((p.y - bx.y) / FINE / k) * k;
    let changed = false;
    for (let j = cj - n * k; j < cj + (n + 1) * k; j++) for (let i = ci - n * k; i < ci + (n + 1) * k; i++) {
      if (i < 0 || j < 0 || i * FINE >= bx.w || j * FINE >= bx.h) continue;
      const key = `${i},${j}`;
      if (curMode === 2) { if (!set.has(key)) { set.add(key); changed = true; } }
      else if (set.delete(key)) changed = true;
    }
    if (!changed) return;
    o.blockCells = [...set]; objCellsApply(o, bx);
    mirrorSame(o);
    markDirty(); overlay();
  }
  // req_mwej3enbhnjo: 한 사물의 충돌 판정을 고치면 이 맵의 같은 그림 사물 모두에 바로 (뒤집기 전 비율이라 뒤집힌 사물도 맞음)
  function mirrorSame(o) {
    for (const o2 of M.map.objects) {
      if (o2 === o || o2.file !== o.file) continue;
      o2.block = o.block.map(r => [...r]); o2.collide = o.collide; delete o2.blockCells;
    }
  }
  const propKey = o => (o.file || '').split('/').pop().replace(/\.[a-z]+$/, '');
  // 모든 맵에: data/props.json 의 그 그림 칸에 block 저장 → 이 맵 사물들의 개별 값은 지워서 기본값을 따르게
  async function saveObjPassToProps(o) {
    const key = propKey(o);
    try {
      const f = await ctx.store.getText('data/props.json');
      const pj = f ? JSON.parse(f.text) : { props: {} };
      pj.props ||= {};
      const cur = { ...(pj.props[key] || {}) };
      if (o.block && o.block.length) { cur.block = o.block.map(r => [...r]); delete cur.collide; }
      else { delete cur.block; cur.collide = false; }
      pj.props[key] = cur;
      // data/props.json 형식 유지: 사물 하나에 한 줄
      // 파이썬 json.dumps와 같은 띄어쓰기 (맵 팀 도구가 쓰는 형식 그대로, 바뀐 줄만 diff에 보이게)
      const py = v => Array.isArray(v) ? '[' + v.map(py).join(', ') + ']' : (v && typeof v === 'object') ? '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + py(x)).join(', ') + '}' : JSON.stringify(v);
      const its = Object.entries(pj.props), rest = Object.keys(pj).filter(k => k !== 'note' && k !== 'props');
      const lines = ['{', '  "note": ' + JSON.stringify(pj.note || '') + ',', '  "props": {',
        ...its.map(([k, v], i) => '    ' + JSON.stringify(k) + ': ' + py(v) + (i < its.length - 1 ? ',' : '')),
        '  }' + (rest.length ? ',' : ''), ...rest.map((k, i) => '  ' + JSON.stringify(k) + ': ' + py(pj[k]) + (i < rest.length - 1 ? ',' : '')), '}'];
      await ctx.store.putText('data/props.json', lines.join('\n') + '\n', f && f.sha, `사물 충돌 판정 저장: ${key}`);
      M.props[key] = cur;
      for (const o2 of M.map.objects) if (o2.file === o.file) { delete o2.block; delete o2.blockCells; delete o2.collide; }
      markDirty(); overlay(); drawSide();
      toast(`${key}: 모든 맵의 같은 그림에 저장했어요. 이 맵도 [저장]을 눌러 주세요.`);
    } catch (e) { toast(e.message, true); }
  }
  // 건물(신전 같은 큰 건물)은 발자리 칸 단위로: 막기 = open에서 빼기, 열기 = open에 넣기 (req_mwej5tsphqmq)
  function paintBuildingPass(b, p) {
    const n = st.brush - 1, cc = Math.floor(p.x / TILE), cr = Math.floor(p.y / TILE);
    const op = new Set((b.open || []).map(c => `${c[0]},${c[1]}`)); let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (c < b.x || r < b.y || c >= b.x + b.w || r >= b.y + b.h) continue;
      const k = `${c},${r}`;
      if (curMode === 2 || curMode === 0) { if (op.delete(k)) changed = true; }
      else if (!op.has(k)) { op.add(k); changed = true; }
    }
    if (!changed) return;
    b.open = [...op].map(k => k.split(',').map(Number)); if (!b.open.length) delete b.open;
    markDirty(); overlay();
  }
  const inBox = (o, p) => { const bx = o && objBox(o); return bx && p.x >= bx.x && p.x <= bx.x + bx.w && p.y >= bx.y && p.y <= bx.y + bx.h; };
  const hitObjBox = p => [...M.map.objects].reverse().find(o => inBox(o, p) && !propOf(o).ground) || [...M.map.objects].reverse().find(o => inBox(o, p));
  // 건물: 발자리 또는 그림 영역 (그림이 없을 때도 발자리로 고를 수 있게)
  const bldBox = b => {
    const sp = M.sprites?.buildings?.[b.id], img = sp && objImgs.get(sp.file), bottom = (b.y + b.h) * TILE;
    if (!img) return { x: b.x * TILE, y: b.y * TILE, w: b.w * TILE, h: b.h * TILE };
    const wt = (sp.widthTiles || b.w + 0.6) * TILE, hh = img.naturalHeight * wt / img.naturalWidth;
    return { x: b.x * TILE + b.w * TILE / 2 - wt / 2, y: bottom - hh + 0.3 * TILE, w: wt, h: hh };
  };
  const inFoot = (b, p) => p.x >= b.x * TILE && p.x < (b.x + b.w) * TILE && p.y >= b.y * TILE && p.y < (b.y + b.h) * TILE;
  const hitBuilding = p => (M.map.buildings || []).find(b => inFoot(b, p)) || [...(M.map.buildings || [])].sort((a, b) => (b.y + b.h) - (a.y + a.h)).find(b => { const r = bldBox(b); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; });
  const isBld = s => s && (M.map.buildings || []).includes(s);
  let curMode = 2, rectDrag = null;
  const paintPass = p => {
    if (st.passTarget === 'object') return isBld(st.sel) ? paintBuildingPass(st.sel, p) : paintObjPass(p);
    if (st.passCell < TILE) return paintPassFine(p);
    const { cols, rows } = M.map, cr = Math.floor(p.y / TILE), cc = Math.floor(p.x / TILE), n = st.brush - 1;
    M.map.passOverride ||= new Array(cols * rows).fill(0);
    let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const i = r * cols + c;
      if (M.map.passOverride[i] !== curMode) { M.map.passOverride[i] = curMode; changed = true; }
    }
    if (!changed) return;
    if (!M.map.passOverride.some(v => v)) delete M.map.passOverride;
    markDirty(); overlay();
  };

  // 바닥 그림 + 높낮이(절벽·언덕)
  function paintBase() {
    const g = base.getContext('2d');
    g.drawImage(M.renderer.canvas, 0, 0);
    if (hasEffects(M.defs, M.map.terrains)) {       // 바닥 재질 탭의 그림자·베벨
      const im = g.getImageData(0, 0, base.width, base.height);
      applyEffects(im.data, base.width, base.height, M.renderer.cover, M.map.terrains, M.defs, st.quality);
      g.putImageData(im, 0, 0);
    }
    M.hcache ||= {};
    if (M.hcache.scale !== st.quality) M.hcache = { scale: st.quality };
    drawHeights(g, M.map, st.quality, M.strips, M.hcache, M.renderer);
  }
  let baseQueued = false;
  const queueBase = () => { if (baseQueued) return; baseQueued = true; requestAnimationFrame(() => { baseQueued = false; paintBase(); }); };

  function overlay() {
    const g = over.getContext('2d');
    g.clearRect(0, 0, W, H);
    const loadImg = file => {
      if (!objImgs.has(file)) { objImgs.set(file, null); ctx.store.blobUrl(file).then(u => { const im = new Image(); im.onload = () => { objImgs.set(file, im); overlay(); }; im.src = u; }).catch(() => {}); }
      return objImgs.get(file);
    };
    // buildings (game data): picture if there is one, otherwise the footprint box
    const items = [...M.map.objects.map(o => ({ o, y: propOf(o).ground ? -1e9 : o.y })), ...(M.map.buildings || []).map(b => ({ b, y: (b.y + b.h) * TILE }))];
    for (const it of items.sort((a, b) => a.y - b.y)) {
      if (it.b) {
        const b = it.b, bottom = (b.y + b.h) * TILE;
        const sp = M.sprites?.buildings?.[b.id];
        const img = sp && loadImg(sp.file);
        if (img) {
          const wt = (sp.widthTiles || b.w + 0.6) * TILE, hh = img.naturalHeight * wt / img.naturalWidth;
          g.drawImage(img, b.x * TILE + b.w * TILE / 2 - wt / 2, bottom - hh + 0.3 * TILE, wt, hh);
        } else {
          g.fillStyle = 'rgba(120,80,50,0.55)'; g.fillRect(b.x * TILE, b.y * TILE, b.w * TILE, b.h * TILE);
        }
        if (st.grid) {
          g.save(); g.setLineDash([8, 6]); g.strokeStyle = 'rgba(255,90,60,0.9)'; g.lineWidth = 2;
          g.strokeRect(b.x * TILE + 1, b.y * TILE + 1, b.w * TILE - 2, b.h * TILE - 2); g.restore();
          if (b.label) { g.fillStyle = 'rgba(30,24,18,0.85)'; g.font = 'bold 16px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
            const tw = g.measureText(b.label).width + 14; g.fillRect(b.x * TILE + b.w * TILE / 2 - tw / 2, bottom - 26, tw, 22);
            g.fillStyle = '#f3e4b8'; g.fillText(b.label, b.x * TILE + b.w * TILE / 2, bottom - 15); }
        }
        continue;
      }
      const o = it.o;
      const img = objImgs.get(o.file);
      if (img) { const w = img.naturalWidth * o.scale, hh = img.naturalHeight * o.scale; g.drawImage(img, o.x - w / 2, o.y - hh, w, hh); }
      else if (!objImgs.has(o.file)) { objImgs.set(o.file, null); ctx.store.blobUrl(o.file).then(u => { const im = new Image(); im.onload = () => { objImgs.set(o.file, im); overlay(); }; im.src = u; }); }
      if (st.sel === o) { g.strokeStyle = '#ffd34d'; g.lineWidth = 3; g.beginPath(); g.arc(o.x, o.y, 12, 0, Math.PI * 2); g.stroke(); }
    }
    if (st.grid) {
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1;
      for (let x = 0; x <= W; x += TILE) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
      for (let y = 0; y <= H; y += TILE) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    }
    if (st.tool === 'height' && M.map.heights) {
      const cols = ['rgba(0,0,0,0)', 'rgba(255,214,90,0.28)', 'rgba(255,140,60,0.32)', 'rgba(230,70,70,0.36)', 'rgba(160,60,200,0.4)'];
      g.font = 'bold 18px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let r = 0; r < M.map.rows; r++) for (let c = 0; c < M.map.cols; c++) {
        const v = M.map.heights[r * M.map.cols + c] || 0, hill = (M.map.hills || [])[r * M.map.cols + c] > 0;
        if (!v && !hill) continue;
        g.fillStyle = cols[Math.min(4, v)]; g.fillRect(c * TILE, r * TILE, TILE, TILE);
        g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillText(`${v}${hill ? '↗' : ''}`, c * TILE + TILE / 2, r * TILE + TILE / 2);
      }
    }
    if (st.showPass || st.tool === 'pass') drawPass(g);
    if (st.tool === 'blend' && M.map.blend) {
      for (let r = 0; r <= M.map.rows; r++) for (let c = 0; c <= M.map.cols; c++) {
        const v = M.map.blend[r * (M.map.cols + 1) + c];
        if (!v) continue;
        g.fillStyle = v === 1 ? 'rgba(120,200,255,0.85)' : 'rgba(255,150,60,0.9)';
        g.beginPath(); g.arc(c * TILE, r * TILE, 7, 0, Math.PI * 2); g.fill();
      }
    }
    for (const ev of M.map.events) {
      if (ev.kind === 'zone') {
        g.save(); g.fillStyle = 'rgba(255,140,0,0.16)'; g.strokeStyle = 'rgba(255,140,0,0.9)'; g.lineWidth = 3; g.setLineDash([10, 6]);
        g.fillRect(ev.x * TILE, ev.y * TILE, (ev.w || 1) * TILE, (ev.h || 1) * TILE); g.strokeRect(ev.x * TILE, ev.y * TILE, (ev.w || 1) * TILE, (ev.h || 1) * TILE); g.restore();
      }
    }
    for (const ar of M.map.battleAreas || []) {
      if (!st.grid) break;
      g.save(); g.strokeStyle = 'rgba(255,80,200,0.9)'; g.lineWidth = 4; g.strokeRect(ar.x * TILE, ar.y * TILE, ar.w * TILE, ar.h * TILE);
      g.fillStyle = 'rgba(255,220,250,0.95)'; g.font = 'bold 16px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText(`전투 칸: ${ar.label || ar.id}`, ar.x * TILE + 6, ar.y * TILE + 6); g.restore();
    }
    for (const ev of M.map.events) {
      const cx = ev.x * TILE + TILE / 2, cy = ev.y * TILE + TILE / 2;
      g.fillStyle = st.sel === ev ? 'rgba(255,211,77,0.9)' : 'rgba(30,36,32,0.75)';
      g.beginPath(); g.roundRect(ev.x * TILE + 6, ev.y * TILE + 6, TILE - 12, TILE - 12, 10); g.fill();
      g.fillStyle = st.sel === ev ? '#2b2a27' : '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(EVENT_ICON[ev.kind] || '?', cx, cy - 4);
      g.font = '12px sans-serif'; g.fillText((ev.label || '').slice(0, 8), cx, cy + 18);
    }
  }

  // painting & placing
  const posOf = e => { const r = over.getBoundingClientRect(); return { x: (e.clientX - r.left) / st.zoom, y: (e.clientY - r.top) / st.zoom }; };
  let painting = false, dragObj = null;
  const paintAt = p => {
    const cr = Math.round(p.y / TILE), cc = Math.round(p.x / TILE), n = st.brush - 1;
    let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (r < 0 || c < 0 || r > M.map.rows || c > M.map.cols) continue;
      const i = r * (M.map.cols + 1) + c;
      if (M.map.corners[i] !== st.terrain) { M.map.corners[i] = st.terrain; changed = true; }
    }
    if (!changed) return;
    markDirty();
    M.renderer.render(cc - n - 1, cr - n - 1, cc + n, cr + n);
    queueBase();
  };
  // 높이 붓: 칸마다 높이(0~3)와 언덕(비탈) 표시
  const paintHeight = p => {
    const { cols, rows } = M.map, cr = Math.floor(p.y / TILE), cc = Math.floor(p.x / TILE), n = st.brush - 1;
    M.map.heights ||= new Array(cols * rows).fill(0);
    M.map.hills ||= new Array(cols * rows).fill(0);
    let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const i = r * cols + c, hill = st.hstyle === 'hill' ? 1 : 0;
      if (st.hstyle === 'hillonly') { if (M.map.hills[i] !== 1) { M.map.hills[i] = 1; changed = true; } continue; }
      if (M.map.heights[i] !== st.hlevel || M.map.hills[i] !== hill) { M.map.heights[i] = st.hlevel; M.map.hills[i] = hill; changed = true; }
    }
    if (!changed) return;
    if (!M.map.heights.some(v => v > 0) && !M.map.hills.some(v => v > 0)) { delete M.map.heights; delete M.map.hills; }
    markDirty(); queueBase(); overlay();
  };
  // 섞기 붓: 모서리마다 0 기본 / 1 부드럽게 / 2 거칠게
  const paintBlend = p => {
    const { cols, rows } = M.map, cr = Math.round(p.y / TILE), cc = Math.round(p.x / TILE), n = st.brush - 1;
    M.map.blend ||= new Array((cols + 1) * (rows + 1)).fill(0);
    let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (r < 0 || c < 0 || r > rows || c > cols) continue;
      const i = r * (cols + 1) + c;
      if (M.map.blend[i] !== st.blendMode) { M.map.blend[i] = st.blendMode; changed = true; }
    }
    if (!changed) return;
    if (!M.map.blend.some(v => v)) delete M.map.blend;
    markDirty();
    M.renderer.render(cc - n - 2, cr - n - 2, cc + n + 1, cr + n + 1);
    queueBase(); overlay();
  };
  const hitEvent = p => M.map.events.find(ev => ev.x === Math.floor(p.x / TILE) && ev.y === Math.floor(p.y / TILE));
  const hitObj = p => [...M.map.objects].reverse().find(o => Math.abs(o.x - p.x) < 40 && p.y < o.y + 10 && p.y > o.y - 120);
  over.addEventListener('pointerdown', e => {
    const p = posOf(e);
    over.setPointerCapture(e.pointerId);
    if (st.tool === 'terrain') { painting = true; paintAt(p); return; }
    if (st.tool === 'height') { painting = true; paintHeight(p); return; }
    if (st.tool === 'blend') { painting = true; paintBlend(p); return; }
    if (st.tool === 'pass') {
      // 마우스: 왼쪽 = 막기, 오른쪽 = 열기 (req_mwej3enbhnjo). 손가락·펜은 왼쪽 목록에서 고른 것
      curMode = e.pointerType === 'mouse' ? (e.button === 2 ? 1 : (st.passMode === 0 ? 0 : 2)) : st.passMode;
      const inSel = isBld(st.sel) ? (inFoot(st.sel, p) || (() => { const r = bldBox(st.sel); return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h; })()) : inBox(st.sel, p);
      if (st.passTarget === 'object' && !inSel) {     // 사물·건물 고르기 (고른 것은 노란 점선 테두리)
        st.sel = hitObjBox(p) || hitBuilding(p) || null; overlay(); drawProps(); drawSide();
        if (!st.sel) toast('통행을 칠할 사물이나 건물을 눌러 고르세요.', true);
        return;
      }
      if (st.passRect) { rectDrag = { a: p, b: p, mode: curMode }; overlay(); return; }
      painting = true; paintPass(p); return;
    }
    if (st.tool === 'event') {
      const hit = hitEvent(p);
      if (hit) st.sel = hit;
      else {
        const ev = { id: `ev_${Date.now().toString(36)}`, kind: 'trigger', x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE), label: '새 이벤트' };
        M.map.events.push(ev); st.sel = ev; markDirty();
      }
      overlay(); drawProps(); return;
    }
    if (st.tool === 'object') {
      const hit = hitObj(p);
      if (hit) { st.sel = hit; dragObj = { o: hit, dx: hit.x - p.x, dy: hit.y - p.y }; }
      else if (st.objFile) { const o = { file: st.objFile, x: Math.round(p.x), y: Math.round(p.y), scale: st.objScale || 0.5, collide: true }; M.map.objects.push(o); st.sel = o; markDirty(); }
      else toast('왼쪽에서 놓을 사물을 먼저 고르세요.', true);
      overlay(); drawProps(); return;
    }
    if (st.tool === 'select') { st.sel = hitEvent(p) || hitObj(p) || null; overlay(); drawProps(); }
  });
  over.addEventListener('pointermove', e => {
    const p = posOf(e);
    status.textContent = `칸 (${Math.floor(p.x / TILE)}, ${Math.floor(p.y / TILE)})${M.dirty ? ' · 저장 안 한 변경 있음' : ''}`;
    if (painting) (st.tool === 'height' ? paintHeight : st.tool === 'blend' ? paintBlend : st.tool === 'pass' ? paintPass : paintAt)(p);
    if (dragObj) { dragObj.o.x = Math.round(p.x + dragObj.dx); dragObj.o.y = Math.round(p.y + dragObj.dy); markDirty(); overlay(); }
    if (rectDrag) { rectDrag.b = p; overlay(); }
  });
  over.addEventListener('pointerup', () => {
    painting = false; dragObj = null;
    if (rectDrag) {                                         // 사각형 안 전체를 한 번에 막기·열기
      const r = rectDrag; rectDrag = null;
      const step = st.passTarget === 'object' ? (isBld(st.sel) ? TILE : Math.max(FINE, st.passCell < TILE ? st.passCell : FINE)) : st.passCell;
      const x0 = Math.min(r.a.x, r.b.x), x1 = Math.max(r.a.x, r.b.x), y0 = Math.min(r.a.y, r.b.y), y1 = Math.max(r.a.y, r.b.y);
      const keep = st.brush; st.brush = 1; curMode = r.mode;
      for (let y = Math.floor(y0 / step) * step + step / 2; y <= y1 + step / 2; y += step)
        for (let x = Math.floor(x0 / step) * step + step / 2; x <= x1 + step / 2; x += step) paintPass({ x: Math.min(x, x1), y: Math.min(y, y1) });
      st.brush = keep; overlay();
    }
  });
  over.addEventListener('contextmenu', e => { if (st.tool === 'pass') e.preventDefault(); });

  function drawSide() {
    const tools = [['terrain', '🖌 지형 붓'], ['blend', '🌫 섞기 붓'], ['height', '⛰ 높이 붓'], ['pass', '🚧 통행 붓'], ['event', '★ 이벤트'], ['object', '🌲 사물'], ['select', '👆 선택']];
    const objAssets = M.assets.filter(a => ['object', 'decor'].includes(a.kind) && a.status !== '보관');
    fill(side, 
      h('div', { class: 'card' },
        h('div', { class: 'tool-row' }, tools.map(([t, l]) => h('button', { class: `btn small ${st.tool === t ? 'primary' : ''}`, onclick: () => { st.tool = t; drawSide(); overlay(); } }, l))),
        st.tool === 'terrain' && h('div', {},
          h('h4', {}, '지형'),
          h('div', { class: 'palette' }, M.map.terrains.map((id, i) => {
            const d = M.defs.find(x => x.id === id) || { name: id, color: '#888' };
            return h('button', { class: `pal ${st.terrain === i ? 'on' : ''}`, onclick: () => { st.terrain = i; drawSide(); } },
              h('span', { class: 'swatch', style: { background: d.color } }), d.name);
          })),
          h('h4', {}, '붓 크기'),
          h('div', { class: 'tool-row' }, [1, 2, 3, 4].map(n => h('button', { class: `btn small ${st.brush === n ? 'primary' : ''}`, onclick: () => { st.brush = n; drawSide(); } }, n))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '칸의 모서리를 칠해요. 이웃 모서리와 다른 지형이면 그 사이가 자연스럽게 섞여요.'),
          h('h4', {}, '높낮이 지형 (절벽·언덕)'),
          h('div', { class: 'palette' }, [['cliff', 1, '🪨 절벽 (한 단 높게, 못 지나감)'], ['hill', 1, '⛰ 언덕 (비탈로 오르내림)'], ['cliff', 0, '⬇ 평지로 되돌리기']].map(([hs, lv, l]) =>
            h('button', { class: 'pal', onclick: () => { st.tool = 'height'; st.hstyle = hs; st.hlevel = lv; drawSide(); overlay(); } }, l))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '누르면 높이 붓으로 바뀌어요. 칠한 칸이 한 단 올라가고, 아래쪽 경계에 절벽 벽이 저절로 생겨요. 두 단 이상은 높이 붓에서 숫자를 골라요.')),
        st.tool === 'blend' && h('div', {},
          h('h4', {}, '경계 섞는 방법'),
          h('div', { class: 'palette' }, [[1, '🌫 부드럽게 (넓게 번짐)'], [2, '🖌 거칠게 (마른 붓 자국)'], [0, '↺ 기본으로 되돌리기']].map(([v, l]) =>
            h('button', { class: `pal ${st.blendMode === v ? 'on' : ''}`, onclick: () => { st.blendMode = v; drawSide(); } }, l))),
          h('h4', {}, '붓 크기'),
          h('div', { class: 'tool-row' }, [1, 2, 3, 4].map(n => h('button', { class: `btn small ${st.brush === n ? 'primary' : ''}`, onclick: () => { st.brush = n; drawSide(); } }, n))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '두 지형이 만나는 경계 위를 문지르세요. "부드럽게"는 경계가 넓게 페이드되며 섞이고, "거칠게"는 거친 붓으로 칠한 듯 들쭉날쭉해져요. 파란 점 = 부드럽게, 주황 점 = 거칠게.')),
        st.tool === 'height' && h('div', {},
          h('h4', {}, '높이'),
          h('div', { class: 'tool-row' }, [0, 1, 2, 3].map(v => h('button', { class: `btn small ${st.hlevel === v ? 'primary' : ''}`, onclick: () => { st.hlevel = v; drawSide(); } }, v === 0 ? '0 (평지)' : v))),
          h('h4', {}, '경계 모양'),
          h('div', { class: 'palette' }, [['cliff', '🪨 절벽 (못 지나감)'], ['hill', '⛰ 언덕 (비탈로 오르내림)'], ['hillonly', '↗ 높이는 그대로, 비탈만 내기']].map(([v, l]) =>
            h('button', { class: `pal ${st.hstyle === v ? 'on' : ''}`, onclick: () => { st.hstyle = v; drawSide(); } }, l))),
          h('h4', {}, '붓 크기'),
          h('div', { class: 'tool-row' }, [1, 2, 3, 4].map(n => h('button', { class: `btn small ${st.brush === n ? 'primary' : ''}`, onclick: () => { st.brush = n; drawSide(); } }, n))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '칸에 높이를 칠하면 높은 곳의 아래쪽 경계에 절벽 벽이 저절로 생겨요(경계는 구불구불). "언덕"으로 칠한 칸은 벽 대신 풀 비탈이 되고 캐릭터가 오르내릴 수 있어요. 절벽 쪽에 계단 자리를 내려면 "비탈만 내기"로 한두 칸 칠하세요. 칸의 숫자 = 높이, ↗ = 비탈.')),
        st.tool === 'pass' && h('div', {},
          h('h4', {}, '통행 붓'),
          h('div', { class: 'tool-row' }, [['map', '🗺 맵 바닥에'], ['object', '🎯 사물에']].map(([v, l]) =>
            h('button', { class: `btn small ${st.passTarget === v ? 'primary' : ''}`, onclick: () => { st.passTarget = v; drawSide(); overlay(); } }, l))),
          h('div', { class: 'palette' }, [[2, '⛔ 막기'], [1, st.passTarget === 'object' ? '✅ 열기 (막힘 지우기)' : '✅ 열기 (지나갈 수 있게)'], [0, '↺ 자동으로 되돌리기']].map(([v, l]) =>
            h('button', { class: `pal ${st.passMode === v ? 'on' : ''}`, onclick: () => { st.passMode = v; drawSide(); } }, l))),
          h('div', { class: 'tool-row' }, [[false, '🖌 붓으로'], [true, '▭ 사각형으로 (끌어서 범위)']].map(([v, l]) =>
            h('button', { class: `btn small ${!!st.passRect === v ? 'primary' : ''}`, onclick: () => { st.passRect = v; drawSide(); } }, l))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '마우스: 왼쪽 버튼 = 막기, 오른쪽 버튼 = 열기 (휴대폰·펜은 위 목록에서 고른 것). "자동으로 되돌리기"를 고르면 왼쪽 버튼이 되돌리기가 돼요.'),
          h('h4', {}, '붓 단위'),
          h('div', { class: 'tool-row' }, [[TILE, '1칸'], [32, '½칸'], [16, '¼칸']].map(([v, l]) =>
            h('button', { class: `btn small ${st.passCell === v ? 'primary' : ''}`, onclick: () => { st.passCell = v; drawSide(); } }, l))),
          st.passTarget === 'object' && h('p', { class: 'muted', style: { fontSize: '12px' } }, st.sel && M.map.objects.includes(st.sel)
            ? `고른 사물: ${(st.sel.file || '').split('/').pop()} — 노란 점선 안을 칠하면 이 맵의 같은 그림 사물 모두에 똑같이 붙어요(사물을 옮겨도 같이 움직여요). 다른 맵까지 바꾸려면 아래 💾 버튼. 다른 사물을 고르려면 점선 밖을 누르세요.`
            : isBld(st.sel) ? '' : '먼저 맵에서 사물이나 건물(신전처럼 큰 건물도)을 눌러 고르세요. 고른 것은 노란 점선 테두리로 보여요.'),
          st.passTarget === 'object' && st.sel && st.sel.blockCells && h('button', { class: 'btn small', onclick: () => { for (const o2 of M.map.objects) if (o2.file === st.sel.file) { delete o2.blockCells; delete o2.block; delete o2.collide; } markDirty(); overlay(); drawSide(); } }, '↺ 이 그림의 막힘을 기본으로'),
          st.passTarget === 'object' && st.sel && M.map.objects.includes(st.sel) && st.sel.block && h('button', { class: 'btn small primary', onclick: () => saveObjPassToProps(st.sel) }, '💾 이 사물의 충돌 판정을 모든 맵의 같은 그림에 저장'),
          st.passTarget === 'object' && isBld(st.sel) && h('p', { class: 'muted', style: { fontSize: '12px' } }, `고른 건물: ${st.sel.label || st.sel.id} — 건물은 발자리 칸 단위로 막기·열기 (파랑 = 걸을 수 있는 마당 칸).`),
          h('h4', {}, '붓 크기'),
          h('div', { class: 'tool-row' }, [1, 2, 3, 4].map(n => h('button', { class: `btn small ${st.brush === n ? 'primary' : ''}`, onclick: () => { st.brush = n; drawSide(); } }, n))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '½칸·¼칸 붓은 칸보다 작게 막거나 열어요 (작은 분홍·파랑 네모). 게임에서 지나갈 수 있는지를 칸마다 보여 줘요. 빨강 = 자동으로 막힌 곳(물·건물·절벽 벽·난간·넓은 사물), 초록 = 다리·계단의 걷는 자리, 주황 원 = 나무·바위 밑동, 분홍 = 붓으로 막은 칸, 파랑 = 붓으로 연 칸. 자동 판정이 어색한 곳만 붓으로 막거나 여세요. 위쪽 [🚧 통행]을 켜면 다른 도구를 쓸 때도 보여요.')),
        st.tool === 'event' && h('p', { class: 'muted', style: { fontSize: '13px' } }, '맵을 누르면 그 칸에 이벤트 지점이 생겨요. 이미 있는 지점을 누르면 선택돼요. 오른쪽에서 종류와 연결할 스토리 장면을 고르세요.'),
        st.tool === 'object' && h('div', {},
          h('p', { class: 'muted', style: { fontSize: '13px' } }, '사물을 고르고 맵을 누르면 그 자리에 놓여요(누른 곳이 사물의 발밑). 놓인 사물은 끌어서 옮겨요.'),
          objAssets.length ? h('div', { class: 'thumb-grid' }, objAssets.map(a => h('div', { class: `thumb-card ${st.objFile === a.file ? 'on' : ''}`, onclick: () => { st.objFile = a.file; drawSide(); } }, thumb(ctx.store, a.file), h('div', { class: 'cap' }, a.id))))
            : h('div', { class: 'empty' }, '맵 사물 그림이 아직 없어요. 캐릭터룸 → 그림 올리기에서 종류를 "맵 사물"로 올려 주세요.')),
        st.tool === 'select' && h('p', { class: 'muted', style: { fontSize: '13px' } }, '이벤트나 사물을 눌러 선택하면 오른쪽에서 고치거나 지울 수 있어요.')),
      h('div', { class: 'card' },
        h('h4', { style: { marginTop: 0 } }, '맵 정보'),
        h('div', { class: 'muted', style: { fontSize: '13px' } }, `${M.map.cols} × ${M.map.rows}칸 (${M.map.cols * TILE}×${M.map.rows * TILE}px)`),
        M.map.note && h('p', { class: 'muted', style: { fontSize: '12px' } }, M.map.note),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => resizeMap(ctx) }, '크기 바꾸기'), h('button', { class: 'btn small', onclick: () => newMap(ctx) }, '+ 새 맵'))));
  }

  function drawProps() {
    const s = st.sel;
    if (!s) { fill(props, h('div', { class: 'muted', style: { fontSize: '13px' } }, '선택한 것이 없어요.')); return; }
    const del = h('button', { class: 'btn small danger', onclick: () => {
      const arr = s.kind ? M.map.events : M.map.objects;
      arr.splice(arr.indexOf(s), 1); st.sel = null; markDirty(); overlay(); drawProps();
    } }, '지우기');
    if (s.kind) {
      const kind = h('select', {}, Object.entries(EVENT_KINDS).map(([v, l]) => h('option', { value: v, selected: v === s.kind }, l)));
      kind.onchange = () => { s.kind = kind.value; markDirty(); overlay(); drawProps(); };
      const label = h('input', { value: s.label || '' });
      label.oninput = () => { s.label = label.value; markDirty(); overlay(); };
      const scenes = Object.values(M.scenes);
      const cur = s.scene || (Array.isArray(s.scenes) ? s.scenes[0] : '');
      const scene = h('select', {}, h('option', { value: '' }, '(연결 안 함)'), scenes.map(sc => h('option', { value: sc.id, selected: sc.id === cur }, `${sc.title} [${sc.status}]`)));
      scene.onchange = () => {
        s.scene = scene.value || undefined;
        // 게임은 scenes 목록을 읽는다. 장면이 하나뿐인 지점만 함께 맞춘다 (여러 장면이 걸린 지점은 그대로)
        if (!Array.isArray(s.scenes) || s.scenes.length <= 1) { if (scene.value) s.scenes = [scene.value]; else delete s.scenes; }
        markDirty();
      };
      // 출구: 이동할 맵 + 그 맵의 시작 위치 (to = {map, start})
      const toObj = s.to && typeof s.to === 'object' ? s.to : { map: typeof s.to === 'string' ? s.to : '', start: '' };
      const toMap = h('select', {}, h('option', { value: '' }, '(고르기)'), M.list.map(m => h('option', { value: m.id, selected: m.id === toObj.map }, m.name)));
      const toStart = h('input', { value: toObj.start || '', placeholder: '그 맵의 시작 위치 id (예: ev_from_west)' });
      const setTo = () => { s.to = { map: toMap.value, start: toStart.value.trim() }; markDirty(); };
      toMap.onchange = setTo; toStart.oninput = setTo;
      const zw = h('input', { type: 'number', min: 1, max: 60, value: s.w || 1, class: 'num' });
      const zh = h('input', { type: 'number', min: 1, max: 60, value: s.h || 1, class: 'num' });
      zw.oninput = () => { s.w = Math.max(1, Number(zw.value) || 1); markDirty(); overlay(); };
      zh.oninput = () => { s.h = Math.max(1, Number(zh.value) || 1); markDirty(); overlay(); };
      const multi = Array.isArray(s.scenes) && s.scenes.length > 1;
      fill(props, h('h4', { style: { marginTop: 0 } }, `이벤트 (${s.x}, ${s.y})`),
        h('div', { class: 'muted', style: { fontSize: '11px' } }, s.id),
        h('label', { class: 'field' }, h('span', {}, '종류'), kind),
        h('label', { class: 'field' }, h('span', {}, '이름표'), label),
        !['start', 'mark'].includes(s.kind) && h('label', { class: 'field' }, h('span', {}, s.kind === 'zone' ? '밟으면 열릴 장면' : s.kind === 'enter' ? '맵에 들어오면 열릴 장면' : '연결할 스토리 장면'), scene),
        multi && h('div', { class: 'muted', style: { fontSize: '12px' } }, `장면 ${s.scenes.length}개가 차례로 걸려 있어요: ${s.scenes.join(', ')}`),
        s.kind === 'zone' && h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, '가로 칸'), zw), h('label', { class: 'field' }, h('span', {}, '세로 칸'), zh)),
        s.kind === 'zone' && h('p', { class: 'muted', style: { fontSize: '12px' } }, '주황 네모 안을 밟으면 장면이 한 번 열려요 (예: 마물과 마주침).'),
        s.kind === 'exit' && h('label', { class: 'field' }, h('span', {}, '이동할 맵'), toMap),
        s.kind === 'exit' && h('label', { class: 'field' }, h('span', {}, '도착할 시작 위치'), toStart),
        s.kind === 'exit' && s.conditions && h('div', { class: 'muted', style: { fontSize: '12px' } }, `나갈 수 있는 조건: ${Object.entries(s.conditions).map(([k, v]) => `${k}=${v}`).join(', ')}`),
        s.scene && h('a', { href: `#/story/edit/${s.scene}` }, '스토리룸에서 이 장면 열기 →'),
        h('div', { class: 'row', style: { marginTop: '8px' } }, del));
    } else {
      const sc = h('input', { type: 'number', step: 0.05, min: 0.05, value: s.scale, class: 'num' });
      sc.oninput = () => { s.scale = Number(sc.value) || 0.5; st.objScale = s.scale; markDirty(); overlay(); };
      const col = h('input', { type: 'checkbox', checked: s.collide !== false });
      col.onchange = () => { s.collide = col.checked; markDirty(); };
      fill(props, h('h4', { style: { marginTop: 0 } }, '사물'), h('div', { class: 'muted', style: { fontSize: '12px' } }, s.file),
        h('label', { class: 'field' }, h('span', {}, '크기 배율'), sc),
        h('label', { class: 'row' }, col, '지나갈 수 없음 (발밑)'),
        h('div', { class: 'row', style: { marginTop: '8px' } }, del));
    }
  }

  drawSide(); drawProps();
  setTimeout(draw, 20);
  return h('div', {},
    h('div', { class: 'savebar' }, mapSel, zoomSel, q, h('label', { class: 'row', style: { gap: '4px' } }, gridChk, '격자'), h('label', { class: 'row', style: { gap: '4px' }, title: '게임에서 지나갈 수 없는 칸을 빨갛게 보여요' }, passChk, '🚧 통행'), status, h('span', { class: 'spacer' }), saveBtn),
    h('div', { class: 'map-layout' }, side, stage, props),
    mapFeedback(ctx, M.id, M.map.name));
}

// ---------- 이 맵에 대한 의견 (수정 요청) ----------
// 요청함(data/requests.json)에 room: "map", mapId 와 함께 남긴다. Claude가 작업하면 답이 여기에도 보인다.
function mapFeedback(ctx, mapId, mapName) {
  const box = h('div', { class: 'card map-feedback' });
  const list = h('ul', { class: 'list' });
  const body = h('textarea', { placeholder: '예) 북쪽 연못을 더 크게, 길 오른쪽에 바위를 몇 개 더 놓아 주세요.' });
  const send = h('button', { class: 'btn primary' }, '의견 보내기');
  const statusClass = { 대기: 'warn', 진행중: 'info', 완료: 'ok', 보류: 'danger' };
  const drawList = all => {
    const mine = all.filter(r => r.mapId === mapId);
    fill(list, mine.length ? mine.map(r => h('li', { class: 'req' },
      h('span', { class: `badge ${statusClass[r.status] || ''}` }, r.status),
      h('div', { class: 'body' },
        h('div', { class: 'meta' }, `${r.createdBy || ''} · ${new Date(r.createdAt).toLocaleString('ko-KR')}`),
        h('div', { class: 'text' }, r.body || r.title),
        r.response && h('div', { class: 'resp' }, h('b', {}, '💬 Claude: '), r.response)))) : h('li', { class: 'muted' }, '아직 이 맵에 남긴 의견이 없어요.'));
  };
  const load = async () => {
    try { const { data } = await ctx.store.getJSON(FEEDBACK, { requests: [] }); drawList(data.requests || []); }
    catch (e) { fill(list, h('li', { class: 'muted' }, `의견을 불러오지 못했어요: ${e.message}`)); }
  };
  send.onclick = async () => {
    const text = body.value.trim();
    if (!text) return toast('의견을 적어 주세요.', true);
    const now = new Date().toISOString();
    const req = { id: newId(), room: 'map', kind: 'map_feedback', mapId, team: '맵', title: `맵 의견: ${mapName}`, body: text, status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' };
    send.disabled = true;
    try {
      const data = await ctx.store.updateJSON(FEEDBACK, d => { d.requests ||= []; d.requests.unshift(req); return d; }, `맵 의견: ${mapName}`, { requests: [] });
      body.value = ''; drawList(data.requests); ctx.refreshBadges?.();
      toast('의견을 남겼어요. 요청함에도 들어가요. Claude에게 "요청함 처리해줘"라고 말하면 반영해요.');
    } catch (e) { toast(e.message, true); }
    send.disabled = false;
  };
  load();
  return fill(box,
    h('h3', { style: { marginTop: 0 } }, `💬 이 맵에 대한 의견 · ${mapName}`),
    h('p', { class: 'muted', style: { fontSize: '13px' } }, '고쳐 주었으면 하는 점을 적어 보내면 요청함에 들어가요. Claude가 작업하면 답이 아래에 보여요.'),
    body, h('div', { class: 'row' }, send), list);
}

async function newMap(ctx) {
  const name = h('input', { placeholder: '예) 숲속 마을' });
  const id = h('input', { placeholder: '영어 id (예: hazelin)' });
  const cols = h('input', { type: 'number', value: 30, min: 10, max: 120 });
  const rows = h('input', { type: 'number', value: 17, min: 8, max: 120 });
  const { data: terr } = await ctx.store.getJSON(TERRAINS, { terrains: [] });
  const baseSel = h('select', {}, terr.terrains.map(t => h('option', { value: t.id, selected: t.id === 'grass_a' }, t.name)));
  const ok = await modal('새 맵', h('div', {},
    h('label', { class: 'field' }, h('span', {}, '맵 이름'), name), h('label', { class: 'field' }, h('span', {}, 'id'), id),
    h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, '가로 칸'), cols), h('label', { class: 'field' }, h('span', {}, '세로 칸'), rows)),
    h('label', { class: 'field' }, h('span', {}, '바탕 지형'), baseSel),
    h('p', { class: 'muted', style: { fontSize: '12px' } }, '화면 한 장은 가로 20칸, 세로 11칸 정도예요.')),
    [{ label: '취소', value: false }, { label: '만들기', value: true, primary: true }]);
  if (!ok) return;
  const mid = (id.value.trim() || `map_${Date.now().toString(36)}`).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
  const c = Number(cols.value) || 30, r = Number(rows.value) || 17;
  const ids = terr.terrains.map(t => t.id);
  const map = { id: mid, name: name.value.trim() || mid, cols: c, rows: r, tile: TILE, terrains: ids, corners: new Array((c + 1) * (r + 1)).fill(ids.indexOf(baseSel.value)), objects: [], events: [] };
  try {
    await ctx.store.putText(`data/maps/${mid}.json`, JSON.stringify(map) + '\n', null, `새 맵: ${map.name}`);
    await ctx.store.updateJSON(INDEX, d => { d.maps ||= []; d.maps.push({ id: mid, name: map.name }); return d; }, `맵 목록에 추가: ${map.name}`, { maps: [] });
    M = null;
    ctx.go(`#/map/edit/${mid}`);
  } catch (e) { toast(e.message, true); }
}

async function resizeMap(ctx) {
  const cols = h('input', { type: 'number', value: M.map.cols, min: 5, max: 120 });
  const rows = h('input', { type: 'number', value: M.map.rows, min: 5, max: 120 });
  const ok = await modal('맵 크기 바꾸기', h('div', {}, h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, '가로 칸'), cols), h('label', { class: 'field' }, h('span', {}, '세로 칸'), rows)),
    h('p', { class: 'muted', style: { fontSize: '12px' } }, '오른쪽·아래쪽이 늘어나거나 잘려요.')), [{ label: '취소', value: false }, { label: '바꾸기', value: true, primary: true }]);
  if (!ok) return;
  const nc = Number(cols.value), nr = Number(rows.value), old = M.map;
  const corners = [];
  for (let r = 0; r <= nr; r++) for (let c = 0; c <= nc; c++) corners.push(old.corners[Math.min(r, old.rows) * (old.cols + 1) + Math.min(c, old.cols)]);
  const regrid = (arr, w0, h0, w1, h1) => { if (!Array.isArray(arr)) return arr; const out = []; for (let r = 0; r < h1; r++) for (let c = 0; c < w1; c++) out.push(r < h0 && c < w0 ? arr[r * w0 + c] : 0); return out; };
  old.heights = regrid(old.heights, old.cols, old.rows, nc, nr);
  old.hills = regrid(old.hills, old.cols, old.rows, nc, nr);
  old.blend = regrid(old.blend, old.cols + 1, old.rows + 1, nc + 1, nr + 1);
  old.passOverride = regrid(old.passOverride, old.cols, old.rows, nc, nr);
  for (const k of ['heights', 'hills', 'blend', 'passOverride']) if (old[k] === undefined) delete old[k];
  Object.assign(old, { cols: nc, rows: nr, corners });
  old.events = old.events.filter(e => e.x < nc && e.y < nr);
  M.dirty = true; M.renderer = null;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
