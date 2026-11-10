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
  const [idx, terr, story, assets, sprites] = await Promise.all([
    ctx.store.getJSON(INDEX, { maps: [] }), ctx.store.getJSON(TERRAINS, { terrains: [] }),
    ctx.store.getJSON(STORY, { scenes: {} }).catch(() => ({ data: { scenes: {} } })), loadRegistry(ctx.store),
    ctx.store.getJSON('data/sprites.json', {}).catch(() => ({ data: {} }))]);
  const list = idx.data.maps;
  const mid = id && list.find(m => m.id === id) ? id : list[0]?.id;
  if (!mid) return { list, empty: true };
  const f = await ctx.store.getJSON(`data/maps/${mid}.json`);
  return { list, id: mid, map: f.data, sha: f.sha, defs: terr.data.terrains, scenes: story.data.scenes || {}, assets, sprites: sprites.data || {}, dirty: false, store: ctx.store };
}

async function editView(ctx, id) {
  if (!M || M.store !== ctx.store || (id && id !== M.id)) {
    if (M?.dirty && !(await confirmBox('저장 안 한 맵 변경이 있어요. 버리고 다른 맵을 열까요?', '버리기'))) { ctx.go(`#/map/edit/${M.id}`); }
    M = await loadMap(ctx, id);
  }
  if (M.empty) return h('div', { class: 'card empty' }, '맵이 없어요. ', h('button', { class: 'btn small', onclick: () => newMap(ctx) }, '+ 새 맵'));
  const st = M.ui ||= { tool: 'terrain', terrain: M.map.terrains.indexOf('dirt_path') >= 0 ? M.map.terrains.indexOf('dirt_path') : 0, brush: 1, grid: true, zoom: 0.5, quality: 0.5, sel: null, hlevel: 1, hstyle: 'cliff', blendMode: 1 };
  st.hlevel ??= 1; st.hstyle ??= 'cliff'; st.blendMode ??= 1; st.passMode ??= 2; st.showPass ??= false;

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
  // 막힌 칸 = 걸을 수 없는 지형(모서리 4개 중 2개 이상) + 건물 발자리 + 절벽 벽(높은 칸 바로 아래, 비탈 아님) + 다리는 열림 + 통행 붓.
  // 사물(나무·바위)은 밑동 둘레만 막혀서 주황 원으로 보여요.
  function passGrid() {
    const { cols, rows } = M.map, P = new Uint8Array(cols * rows);
    const walk = id => (M.defs.find(d => d.id === id) || {}).walkable !== false;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      let bad = 0;
      for (const [cx, cy] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) if (!walk(M.map.terrains[M.map.corners[cy * (cols + 1) + cx]])) bad++;
      if (bad >= 2) P[y * cols + x] = 1;
    }
    for (const b of M.map.buildings || []) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) P[y * cols + x] = 1;
    const H = M.map.heights, L = M.map.hills || [];
    if (H) for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols; x++) if ((H[y * cols + x] || 0) > (H[(y + 1) * cols + x] || 0) && !(L[y * cols + x] > 0)) P[(y + 1) * cols + x] = 1;
    for (const o of M.map.objects) {
      if (!o.bridge) continue;
      const im = objImgs.get(o.file); if (!im) continue;
      const w = im.naturalWidth * o.scale, hh = im.naturalHeight * o.scale;
      for (let ty = Math.floor((o.y - hh * 0.72) / TILE); ty <= Math.floor((o.y - hh * 0.2) / TILE); ty++)
        for (let tx = Math.floor((o.x - w / 2) / TILE); tx <= Math.floor((o.x + w / 2) / TILE); tx++) if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) P[ty * cols + tx] = 0;
    }
    const po = M.map.passOverride;
    if (po) for (let i = 0; i < P.length; i++) { if (po[i] === 1) P[i] = 2; else if (po[i] === 2) P[i] = 3; }
    return P;   // 0 열림, 1 막힘, 2 붓으로 엶, 3 붓으로 막음
  }
  function drawPass(g) {
    const P = passGrid(), { cols, rows } = M.map;
    const col = ['', 'rgba(255,40,30,0.38)', 'rgba(60,130,255,0.38)', 'rgba(200,0,120,0.45)'];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const v = P[y * cols + x]; if (v) { g.fillStyle = col[v]; g.fillRect(x * TILE, y * TILE, TILE, TILE); } }
    g.fillStyle = 'rgba(255,150,20,0.5)';
    for (const o of M.map.objects) {
      if (o.collide === false || o.ground) continue;
      const im = objImgs.get(o.file); if (!im) continue;
      const r = Math.min(46, Math.max(10, im.naturalWidth * o.scale * 0.16));
      g.beginPath(); g.arc(o.x, o.y - 8, r, 0, Math.PI * 2); g.fill();
    }
  }
  const paintPass = p => {
    const { cols, rows } = M.map, cr = Math.floor(p.y / TILE), cc = Math.floor(p.x / TILE), n = st.brush - 1;
    M.map.passOverride ||= new Array(cols * rows).fill(0);
    let changed = false;
    for (let r = cr - n; r <= cr + n; r++) for (let c = cc - n; c <= cc + n; c++) {
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue;
      const i = r * cols + c;
      if (M.map.passOverride[i] !== st.passMode) { M.map.passOverride[i] = st.passMode; changed = true; }
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
    const items = [...M.map.objects.map(o => ({ o, y: o.y })), ...(M.map.buildings || []).map(b => ({ b, y: (b.y + b.h) * TILE }))];
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
    if (st.tool === 'pass') { painting = true; paintPass(p); return; }
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
  });
  over.addEventListener('pointerup', () => { painting = false; dragObj = null; });

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
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '칸의 모서리를 칠해요. 이웃 모서리와 다른 지형이면 그 사이가 자연스럽게 섞여요.')),
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
          h('div', { class: 'palette' }, [[2, '⛔ 막기'], [1, '✅ 열기 (지나갈 수 있게)'], [0, '↺ 자동으로 되돌리기']].map(([v, l]) =>
            h('button', { class: `pal ${st.passMode === v ? 'on' : ''}`, onclick: () => { st.passMode = v; drawSide(); } }, l))),
          h('h4', {}, '붓 크기'),
          h('div', { class: 'tool-row' }, [1, 2, 3, 4].map(n => h('button', { class: `btn small ${st.brush === n ? 'primary' : ''}`, onclick: () => { st.brush = n; drawSide(); } }, n))),
          h('p', { class: 'muted', style: { fontSize: '12px' } }, '게임에서 지나갈 수 있는지를 칸마다 보여 줘요. 빨강 = 자동으로 막힌 칸(물·건물·절벽 벽), 주황 원 = 나무·바위 밑동, 분홍 = 붓으로 막은 칸, 파랑 = 붓으로 연 칸. 자동 판정이 어색한 곳만 붓으로 막거나 여세요. 위쪽 [🚧 통행]을 켜면 다른 도구를 쓸 때도 보여요.')),
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
