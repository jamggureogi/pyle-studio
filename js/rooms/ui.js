// UI room: lay out the game's screens by hand. Everything here is saved to data/ui.json
// (and portrait positions to data/characters.json) and the game reads the same values.
import { h, toast, fill } from '../ui.js';
import { portraitLayer, frameFor, applyDialogue, DEFAULT_DIALOGUE, forgetDialogueLayout, loadDialogueLayout, layoutStage, LAYOUT } from '../portrait.js';

const UI = 'data/ui.json';
const CHARS = 'data/characters.json';
const STORY = 'data/story/prologue.json';
const REF_W = 1280, REF_H = 720;

export const DEFAULT_HUD = {
  joystick: { anchor: 'bl', x: 150, y: 150, size: 168 },
  action: { anchor: 'br', x: 104, y: 114, size: 132 },
  pendant: { anchor: 'tr', x: 60, y: 54, size: 88 },
  location: { anchor: 'tl', x: 20, y: 14, size: 22 },
  goal: { anchor: 'tl', x: 20, y: 46, size: 18 },
};
export const DEFAULT_MENUS = {
  systemMenu: [
    { id: 'continue', label: '계속하기', show: true }, { id: 'save', label: '저장하기', show: true },
    { id: 'items', label: '가진 물건 보기', show: true }, { id: 'party', label: '동료', show: false },
    { id: 'settings', label: '설정', show: false }, { id: 'title', label: '타이틀로', show: true }],
  titleMenu: [
    { id: 'continue', label: '이어하기', show: true }, { id: 'new', label: '처음부터 시작', show: true },
    { id: 'village', label: '마을 걸어 보기', show: true }, { id: 'battle', label: '전투만 해 보기', show: true }],
  battleUi: {
    panelSide: 'right', animation: true,
    commands: [
      { id: 'move', label: '이동', show: true }, { id: 'attack', label: '공격', show: true }, { id: 'skill', label: '기술', show: true },
      { id: 'item', label: '아이템', show: true }, { id: 'guard', label: '방어', show: true }, { id: 'wait', label: '대기', show: true }],
  },
};
const NOT_YET = { party: '게임에 아직 없음', settings: '게임에 아직 없음' };
const HUD_NAMES = { joystick: '조이스틱', action: '말 걸기 버튼', pendant: '펜던트 (메뉴)', location: '장소 이름', goal: '목표' };

let U = null; // { ui, sha, chars, story, store }

async function load(ctx) {
  const [ui, ch, st] = await Promise.all([ctx.store.getJSON(UI, {}), ctx.store.getJSON(CHARS, { characters: [] }), ctx.store.getJSON(STORY, { illustrations: {} }).catch(() => ({ data: {} }))]);
  U = { ui: ui.data || {}, chars: ch.data, story: st.data || {}, store: ctx.store, frameEdits: {} };
  forgetDialogueLayout(ctx.store);
  await loadDialogueLayout(ctx.store);   // also loads the game's dialogue frame picture
  U.dialogue = applyDialogue(U.ui.dialogue || {});
  U.hud = structuredClone({ ...DEFAULT_HUD, ...(U.ui.fieldHud || {}) });
  for (const k of Object.keys(DEFAULT_HUD)) U.hud[k] = { ...DEFAULT_HUD[k], ...(U.ui.fieldHud?.[k] || {}) };
  U.menus = {
    systemMenu: mergeList(DEFAULT_MENUS.systemMenu, U.ui.systemMenu),
    titleMenu: mergeList(DEFAULT_MENUS.titleMenu, U.ui.titleMenu),
    battleUi: { ...DEFAULT_MENUS.battleUi, ...(U.ui.battleUi || {}), commands: mergeList(DEFAULT_MENUS.battleUi.commands, U.ui.battleUi?.commands) },
  };
}

// keep the saved order/labels, add any new defaults at the end
function mergeList(defs, saved) {
  if (!Array.isArray(saved)) return structuredClone(defs);
  const out = saved.map(x => ({ ...(defs.find(d => d.id === x.id) || {}), ...x }));
  for (const d of defs) if (!out.find(x => x.id === d.id)) out.push({ ...d });
  return out;
}

async function saveUi(ctx, key, value, msg) {
  await ctx.store.updateJSON(UI, d => { d = d || {}; d[key] = value; return d; }, msg);
  U.ui[key] = value;
  forgetDialogueLayout(ctx.store);
  if (key === 'dialogue') { await loadDialogueLayout(ctx.store); U.dialogue = applyDialogue(value); }
  toast('저장했어요. 편집실 미리보기와 다음 시험판에 그대로 반영돼요.');
}

export async function render(ctx, rest) {
  if (!U || U.store !== ctx.store) await load(ctx);
  const tab = ['field', 'menu', 'battle'].includes(rest[0]) ? rest[0] : 'dialogue';
  const body = { dialogue: dialogueTab, field: fieldTab, menu: menuTab, battle: battleTab }[tab](ctx);
  return h('div', { class: 'page' },
    h('h1', {}, '🎨 UI'),
    h('p', { class: 'sub' }, '게임 화면의 배치를 직접 잡는 곳이에요. 끌어서 옮기고, 오른쪽 칸에서 크기를 바꾼 뒤 저장하세요. 저장한 값은 편집실 미리보기와 게임에 똑같이 들어가요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/ui', class: tab === 'dialogue' ? 'on' : '' }, '대화창'),
      h('a', { href: '#/ui/field', class: tab === 'field' ? 'on' : '' }, '필드 화면'),
      h('a', { href: '#/ui/menu', class: tab === 'menu' ? 'on' : '' }, '메뉴'),
      h('a', { href: '#/ui/battle', class: tab === 'battle' ? 'on' : '' }, '전투 화면')),
    body);
}

// ---------- small helpers ----------

function slider(label, value, min, max, step, onInput, fmt = v => v) {
  const val = h('span', { class: 'muted ui-val' }, fmt(value));
  const r = h('input', { type: 'range', min, max, step, value });
  r.oninput = () => { val.textContent = fmt(Number(r.value)); onInput(Number(r.value)); };
  const row = h('label', { class: 'fit-row' }, h('span', { class: 'fit-label' }, label), r, val);
  row.set = v => { r.value = v; val.textContent = fmt(v); };
  return row;
}

function dragOn(el, onMove, onEnd) {
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    let lx = e.clientX, ly = e.clientY;
    const move = ev => { onMove(ev.clientX - lx, ev.clientY - ly, ev); lx = ev.clientX; ly = ev.clientY; };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); onEnd?.(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
}

const pct = v => `${Math.round(v * 100)}%`;

// ---------- 대화창 ----------

function dialogueTab(ctx) {
  const d = U.dialogue;
  const people = U.chars.characters.filter(c => Object.keys(c.portraits || {}).length);
  const st = U.dlg ||= { char: people[0]?.id, emo: 'normal', bg: Object.entries(U.story.illustrations || {}).find(([, v]) => v.file)?.[0] || '', text: '대사가 여기에 나와요. 이름과 본문을 끌어서 위치를 맞춰 보세요.' };
  const charOf = id => U.chars.characters.find(c => c.id === id);
  const emoLabel = e => U.chars.emotions?.[e] || e;

  const stage = h('div', { class: 'pv-stage ui-stage' });
  const ctrl = h('div', { class: 'ui-ctrl' });
  let layer = null;

  const working = () => {
    const c = charOf(st.char);
    const f = frameFor(c, st.emo);
    const e = U.frameEdits[`${st.char}/${st.emo}`];
    return e ? { ...f, ...e } : f;
  };
  const fakeChar = () => {
    const c = charOf(st.char);
    return { ...c, portraitFrames: { ...(c.portraitFrames || {}), [st.emo]: working() } };
  };

  async function drawStage() {
    const c = charOf(st.char);
    const bgFile = U.story.illustrations?.[st.bg]?.file;
    const scene = h('div', { class: 'pv-scene' });
    if (bgFile) ctx.store.blobUrl(bgFile).then(u => { scene.style.backgroundImage = `url(${u})`; });
    const name = h('div', { class: 'pv-name ui-drag', title: '끌어서 이름 위치 옮기기' }, c?.displayName || c?.name || '');
    const text = h('div', { class: 'pv-text ui-drag', title: '끌어서 본문 위치 옮기기' }, st.text);
    const box = h('div', { class: `pv-box ${c?.portraits?.[st.emo] ? '' : 'noportrait'}` }, name, text);
    stage.replaceChildren(scene, box);
    const k = () => stage.clientWidth / REF_W;
    dragOn(name, (dx, dy) => { d.name.x += dx / k(); d.name.y += dy / k(); layoutStage(stage); });
    dragOn(text, (dx, dy) => { d.text.x += dx / k(); d.text.y += dy / k(); layoutStage(stage); });
    layer = null;
    const file = c?.portraits?.[st.emo] || c?.portraits?.normal;
    if (file) {
      const u = await ctx.store.blobUrl(file);
      layer = portraitLayer(u, fakeChar(), st.emo);
      stage.append(layer);
      // a grab handle over the portrait (the layer itself ignores the mouse)
      const grab = h('div', { class: 'ui-grab', title: '끌어서 초상화 옮기기 · 휠로 크기' });
      stage.append(grab);
      const place = () => {
        const img = layer.querySelector('img');
        if (!img) return;
        Object.assign(grab.style, { left: img.style.left, top: img.style.top, width: img.style.width, height: `${Math.min(parseFloat(img.style.height), stage.clientHeight * (1 - LAYOUT.boxBottom) - parseFloat(img.style.top))}px` });
      };
      const refit = () => { layer.remove(); layer = portraitLayer(u, fakeChar(), st.emo); stage.insertBefore(layer, grab); setTimeout(place, 30); syncSliders(); };
      layer.querySelector('img').addEventListener('load', () => setTimeout(place, 30));
      dragOn(grab, (dx, dy) => {
        const w = working();
        U.frameEdits[`${st.char}/${st.emo}`] = { dx: w.dx + dx / stage.clientWidth, dy: w.dy + dy / stage.clientHeight, scale: w.scale };
        refit();
      });
      grab.addEventListener('wheel', e => {
        e.preventDefault();
        const w = working();
        U.frameEdits[`${st.char}/${st.emo}`] = { dx: w.dx, dy: w.dy, scale: Math.max(0.4, Math.min(2, w.scale * (e.deltaY < 0 ? 1.03 : 0.97))) };
        refit();
      }, { passive: false });
      stage._refit = refit;
    }
    requestAnimationFrame(() => layoutStage(stage));
  }

  // portrait controls
  const sScale = slider('크기', working().scale, 0.4, 2, 0.01, v => { const w = working(); U.frameEdits[`${st.char}/${st.emo}`] = { dx: w.dx, dy: w.dy, scale: v }; stage._refit?.(); }, pct);
  const sDx = slider('좌우', working().dx, -0.2, 0.2, 0.002, v => { const w = working(); U.frameEdits[`${st.char}/${st.emo}`] = { dx: v, dy: w.dy, scale: w.scale }; stage._refit?.(); }, v => (v * 100).toFixed(1));
  const sDy = slider('위아래', working().dy, -0.25, 0.25, 0.002, v => { const w = working(); U.frameEdits[`${st.char}/${st.emo}`] = { dx: w.dx, dy: v, scale: w.scale }; stage._refit?.(); }, v => (v * 100).toFixed(1));
  function syncSliders() { const w = working(); sScale.set(w.scale); sDx.set(w.dx); sDy.set(w.dy); }

  async function savePortrait(all) {
    const w = working();
    const c = charOf(st.char);
    const keys = all ? Object.keys(c.portraits || {}) : [st.emo];
    try {
      await ctx.store.updateJSON(CHARS, data => {
        const x = data.characters.find(y => y.id === st.char);
        if (!x) return data;
        x.portraitFrames ||= {};
        for (const emo of keys) {
          const cur = { ...(x.portraitFrames[emo] || {}) };
          x.portraitFrames[emo] = { ...cur, scale: Number(w.scale.toFixed(3)), dx: Number(w.dx.toFixed(4)), dy: Number(w.dy.toFixed(4)) };
        }
        return data;
      }, `대화창 초상화 위치: ${c.name} ${all ? '모든 표정' : st.emo}`);
      for (const emo of keys) {
        c.portraitFrames ||= {};
        c.portraitFrames[emo] = { ...(c.portraitFrames[emo] || {}), scale: w.scale, dx: w.dx, dy: w.dy };
        delete U.frameEdits[`${st.char}/${emo}`];
      }
      toast(all ? '이 인물의 모든 표정에 저장했어요.' : '이 표정만 저장했어요.');
    } catch (e) { toast(e.message, true); }
  }

  const charSel = h('select', {}, people.map(c => h('option', { value: c.id, selected: c.id === st.char }, c.displayName || c.name)));
  const emoSel = h('select');
  const fillEmo = () => {
    const c = charOf(st.char);
    const emos = Object.keys(c?.portraits || {});
    if (!emos.includes(st.emo)) st.emo = emos.includes('normal') ? 'normal' : emos[0];
    emoSel.replaceChildren(...emos.map(e => h('option', { value: e, selected: e === st.emo }, emoLabel(e))));
  };
  fillEmo();
  charSel.onchange = () => { st.char = charSel.value; fillEmo(); syncSliders(); drawStage(); };
  emoSel.onchange = () => { st.emo = emoSel.value; syncSliders(); drawStage(); };
  const bgSel = h('select', {}, h('option', { value: '' }, '(배경 없음)'),
    Object.entries(U.story.illustrations || {}).filter(([, v]) => v.file).map(([k2, v]) => h('option', { value: k2, selected: k2 === st.bg }, v.title || k2)));
  bgSel.onchange = () => { st.bg = bgSel.value; drawStage(); };
  const textIn = h('input', { value: st.text });
  textIn.oninput = () => { st.text = textIn.value; const t = stage.querySelector('.pv-text'); if (t) t.textContent = st.text; };

  // box & text controls (global)
  const relayout = () => { applyDialogue(d); U.dialogue = d; drawStage(); };
  fill(ctrl,
    h('div', { class: 'card' },
      h('h4', { style: { marginTop: 0 } }, '미리 볼 장면'),
      h('label', { class: 'field' }, h('span', {}, '인물'), charSel),
      h('label', { class: 'field' }, h('span', {}, '표정'), emoSel),
      h('label', { class: 'field' }, h('span', {}, '배경'), bgSel),
      h('label', { class: 'field' }, h('span', {}, '대사'), textIn)),
    h('div', { class: 'card' },
      h('h4', { style: { marginTop: 0 } }, '초상화 (이 인물 · 이 표정)'),
      h('p', { class: 'muted small' }, '초상화를 끌어서 옮기고, 마우스 휠이나 아래 칸으로 크기를 바꿔요. 표정마다 얼굴 크기·위치가 달라도 괜찮아요.'),
      sScale, sDx, sDy,
      h('div', { class: 'row' },
        h('button', { class: 'btn small primary', onclick: () => savePortrait(false) }, '이 표정만 저장'),
        h('button', { class: 'btn small', onclick: () => savePortrait(true) }, '모든 표정에 같은 값'),
        h('button', { class: 'btn small', onclick: () => { delete U.frameEdits[`${st.char}/${st.emo}`]; syncSliders(); drawStage(); } }, '되돌리기'))),
    h('div', { class: 'card' },
      h('h4', { style: { marginTop: 0 } }, '글자 (모든 대화 공통)'),
      h('p', { class: 'muted small' }, '이름과 본문은 화면에서 직접 끌어서 옮길 수 있어요.'),
      slider('이름 크기', d.name.size, 14, 34, 1, v => { d.name.size = v; layoutStage(stage); }, v => `${v}px`),
      slider('본문 크기', d.text.size, 14, 34, 1, v => { d.text.size = v; layoutStage(stage); }, v => `${v}px`),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { d.name.x = 0; d.name.y = 0; layoutStage(stage); } }, '이름 위치 처음대로'),
        h('button', { class: 'btn small', onclick: () => { d.text.x = 0; d.text.y = 0; layoutStage(stage); } }, '본문 위치 처음대로'))),
    h('div', { class: 'card' },
      h('h4', { style: { marginTop: 0 } }, '대화창 틀 · 초상화 기준 (모든 대화 공통)'),
      slider('창 높이', d.box.height, 0.18, 0.4, 0.005, v => { d.box.height = v; relayout(); }, pct),
      slider('창 아래 여백', d.box.bottom, 0, 0.2, 0.005, v => { d.box.bottom = v; relayout(); }, pct),
      slider('창 좌우 여백', d.box.left, 0, 0.1, 0.002, v => { d.box.left = v; relayout(); }, pct),
      slider('얼굴 가로 위치', d.portrait.faceX, 0.05, 0.3, 0.002, v => { d.portrait.faceX = v; relayout(); }, pct),
      slider('턱 높이', d.portrait.chinY, 0.55, 0.85, 0.002, v => { d.portrait.chinY = v; relayout(); }, pct),
      slider('기본 얼굴 크기', d.portrait.eyeToChin, 0.05, 0.12, 0.001, v => { d.portrait.eyeToChin = v; relayout(); }, v => (v * 1000).toFixed(0)),
      h('div', { class: 'row' },
        h('button', { class: 'btn small primary', onclick: () => saveUi(ctx, 'dialogue', structuredClone(d), '대화창 배치 저장').catch(e => toast(e.message, true)) }, '대화창 설정 저장'),
        h('button', { class: 'btn small', onclick: () => { Object.assign(d, structuredClone(DEFAULT_DIALOGUE)); relayout(); toast('처음 값으로 돌렸어요. 저장해야 반영돼요.'); } }, '처음 값으로'))));

  setTimeout(drawStage, 20);
  window.addEventListener('resize', () => { if (stage.isConnected) drawStage(); });
  return h('div', { class: 'ui-wrap' }, h('div', { class: 'ui-main' }, stage, h('p', { class: 'muted small' }, '초상화·이름·본문을 끌어서 옮겨 보세요. 인물·표정을 바꿔 가며 확인할 수 있어요.')), ctrl);
}

// ---------- 필드 화면 ----------

function hudBox(name, it) {
  // centre (for round things) or top-left (labels), in the 1280x720 screen
  const isText = name === 'location' || name === 'goal';
  const ax = it.anchor[1] === 'r' ? REF_W - it.x : it.x;
  const ay = it.anchor[0] === 'b' ? REF_H - it.y : it.y;
  return { isText, x: ax, y: ay };
}

function anchorFrom(x, y) {
  return (y > REF_H / 2 ? 'b' : 't') + (x > REF_W / 2 ? 'r' : 'l');
}

function fieldTab(ctx) {
  const hud = U.hud;
  const stage = h('div', { class: 'pv-stage ui-stage' });
  let sel = U.hudSel || 'action';
  const ctrl = h('div', { class: 'ui-ctrl' });
  const els = {};

  function draw() {
    const k = stage.clientWidth / REF_W;
    const bg = h('div', { class: 'pv-scene' });
    if (U.ui.fieldPreviewBg) ctx.store.blobUrl(U.ui.fieldPreviewBg).then(u => { bg.style.backgroundImage = `url(${u})`; }).catch(() => {});
    stage.replaceChildren(bg);
    for (const [name, it] of Object.entries(hud)) {
      const b = hudBox(name, it);
      let el;
      if (name === 'location') el = h('div', { class: 'ui-hud-text' }, '장소 이름 · 시간');
      else if (name === 'goal') el = h('div', { class: 'ui-hud-text' }, '목표: 지금 할 일이 여기에 나와요');
      else if (name === 'pendant') { el = h('div', { class: 'ui-hud-round' }, '메뉴'); if (U.ui.pendant) ctx.store.blobUrl(U.ui.pendant).then(u => { el.style.backgroundImage = `url(${u})`; el.classList.add('img'); el.textContent = ''; }).catch(() => {}); }
      else el = h('div', { class: 'ui-hud-round' }, name === 'action' ? '말 걸기' : '');
      if (b.isText) Object.assign(el.style, { left: `${b.x * k}px`, top: `${b.y * k}px`, fontSize: `${it.size * k}px` });
      else Object.assign(el.style, { left: `${(b.x - it.size / 2) * k}px`, top: `${(b.y - it.size / 2) * k}px`, width: `${it.size * k}px`, height: `${it.size * k}px`, fontSize: `${it.size * 0.2 * k}px` });
      el.classList.add('ui-hud');
      if (name === sel) el.classList.add('sel');
      el.title = HUD_NAMES[name];
      dragOn(el, (dx, dy) => {
        const cur = hudBox(name, it);
        const nx = Math.max(0, Math.min(REF_W, cur.x + dx / k)), ny = Math.max(0, Math.min(REF_H, cur.y + dy / k));
        it.anchor = b.isText ? 'tl' : anchorFrom(nx, ny);
        it.x = Math.round(it.anchor[1] === 'r' ? REF_W - nx : nx);
        it.y = Math.round(it.anchor[0] === 'b' ? REF_H - ny : ny);
        draw();
      }, () => {});
      el.addEventListener('pointerdown', () => { if (sel !== name) { sel = U.hudSel = name; drawCtrl(); } });
      els[name] = el;
      stage.append(el);
    }
  }

  function drawCtrl() {
    const it = hud[sel];
    const isText = sel === 'location' || sel === 'goal';
    fill(ctrl,
      h('div', { class: 'card' },
        h('h4', { style: { marginTop: 0 } }, '고른 것: ', HUD_NAMES[sel]),
        h('p', { class: 'muted small' }, '화면에서 버튼·글자를 눌러 고르고, 끌어서 옮겨요. 화면 모서리를 기준으로 저장돼서 휴대폰 화면 비율이 달라도 같은 자리에 붙어요.'),
        slider(isText ? '글자 크기' : '크기', it.size, isText ? 12 : 40, isText ? 40 : 260, 1, v => { it.size = v; draw(); }, v => `${v}px`),
        h('div', { class: 'muted small' }, `기준 모서리: ${{ tl: '왼쪽 위', tr: '오른쪽 위', bl: '왼쪽 아래', br: '오른쪽 아래' }[it.anchor]} · ${it.x}, ${it.y}`)),
      h('div', { class: 'card' },
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => saveUi(ctx, 'fieldHud', structuredClone(hud), '필드 화면 배치 저장').catch(e => toast(e.message, true)) }, '필드 화면 저장'),
          h('button', { class: 'btn small', onclick: () => { for (const k2 of Object.keys(DEFAULT_HUD)) hud[k2] = structuredClone(DEFAULT_HUD[k2]); draw(); drawCtrl(); } }, '처음 값으로'))));
  }
  drawCtrl();
  setTimeout(draw, 20);
  window.addEventListener('resize', () => { if (stage.isConnected) draw(); });
  return h('div', { class: 'ui-wrap' }, h('div', { class: 'ui-main' }, stage), ctrl);
}

// ---------- 메뉴 ----------

function listEditor(list, onChange, notes = {}) {
  const box = h('div', { class: 'ui-list' });
  const draw = () => {
    box.replaceChildren(...list.map((it, i) => {
      const show = h('input', { type: 'checkbox', checked: it.show !== false, title: '보이기' });
      show.onchange = () => { it.show = show.checked; onChange(); };
      const label = h('input', { value: it.label });
      label.oninput = () => { it.label = label.value; onChange(); };
      const up = h('button', { class: 'btn small', disabled: i === 0, onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; draw(); onChange(); } }, '↑');
      const down = h('button', { class: 'btn small', disabled: i === list.length - 1, onclick: () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; draw(); onChange(); } }, '↓');
      return h('div', { class: 'ui-list-row' }, up, down, show, label, h('span', { class: 'muted small' }, notes[it.id] ? `${it.id} · ${notes[it.id]}` : it.id));
    }));
  };
  draw();
  return box;
}

function menuPreview(title, list) {
  return h('div', { class: 'ui-menu-preview' }, h('div', { class: 'ui-menu-title' }, title),
    list.filter(x => x.show !== false).map(x => h('div', { class: `ui-menu-btn ${NOT_YET[x.id] ? 'dim' : ''}` }, x.label)));
}

function menuTab(ctx) {
  const m = U.menus;
  const prevSys = h('div'), prevTitle = h('div');
  const redraw = () => { fill(prevSys, menuPreview('메뉴', m.systemMenu)); fill(prevTitle, menuPreview('타이틀', m.titleMenu)); };
  redraw();
  return h('div', {},
    h('div', { class: 'ui-wrap' },
      h('div', { class: 'card ui-main' },
        h('h3', { style: { marginTop: 0 } }, '시스템 메뉴 (펜던트를 누르면 열리는 메뉴)'),
        listEditor(m.systemMenu, redraw, NOT_YET),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn small primary', onclick: () => saveUi(ctx, 'systemMenu', structuredClone(m.systemMenu), '시스템 메뉴 저장').catch(e => toast(e.message, true)) }, '시스템 메뉴 저장'))),
      prevSys),
    h('div', { class: 'ui-wrap' },
      h('div', { class: 'card ui-main' },
        h('h3', { style: { marginTop: 0 } }, '타이틀 메뉴'),
        h('p', { class: 'muted small' }, '"이어하기"는 저장한 게 있을 때만 보여요.'),
        listEditor(m.titleMenu, redraw),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn small primary', onclick: () => saveUi(ctx, 'titleMenu', structuredClone(m.titleMenu), '타이틀 메뉴 저장').catch(e => toast(e.message, true)) }, '타이틀 메뉴 저장'))),
      prevTitle),
    h('p', { class: 'muted small' }, '아직 게임에 없는 기능(동료, 설정)은 보이게 해 두면 "준비 중"으로 나와요. 필요한 메뉴가 더 있으면 요청함에 적어 주세요.'));
}

// ---------- 전투 화면 ----------

function battleTab(ctx) {
  const b = U.menus.battleUi;
  const prev = h('div');
  const redraw = () => {
    const panel = h('div', { class: 'ui-battle-panel' }, h('div', { class: 'ui-menu-title' }, '캐릭터'),
      h('div', { class: 'ui-battle-grid' }, b.commands.filter(x => x.show !== false).map(x => h('div', { class: 'ui-menu-btn' }, x.label))));
    const board = h('div', { class: 'ui-battle-board' }, '전투 맵');
    fill(prev, h('div', { class: `ui-battle-prev ${b.panelSide}` }, board, panel));
  };
  redraw();
  const side = h('select', {}, h('option', { value: 'right', selected: b.panelSide === 'right' }, '오른쪽'), h('option', { value: 'left', selected: b.panelSide === 'left' }, '왼쪽'));
  side.onchange = () => { b.panelSide = side.value; redraw(); };
  const anim = h('input', { type: 'checkbox', checked: b.animation !== false });
  anim.onchange = () => { b.animation = anim.checked; };
  return h('div', { class: 'ui-wrap' },
    h('div', { class: 'card ui-main' },
      h('h3', { style: { marginTop: 0 } }, '전투 명령'),
      listEditor(b.commands, redraw),
      h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, '명령 칸 위치'), side),
      h('label', { class: 'row', style: { marginTop: '6px' } }, anim, '공격·기술을 쓰면 전투 애니메이션 화면 보여 주기 (처음 값)'),
      h('div', { class: 'row', style: { marginTop: '10px' } },
        h('button', { class: 'btn small primary', onclick: () => saveUi(ctx, 'battleUi', structuredClone(b), '전투 화면 저장').catch(e => toast(e.message, true)) }, '전투 화면 저장'))),
    prev);
}
