// Story room: chapters → scenes → lines. Edit speakers, expressions, order, and preview the dialogue box.
import { h, toast, loading, errorBox, confirmBox, modal } from '../ui.js';
import { requestPanel } from './requests.js';

const FILE = 'data/story/prologue.json';
const CHARS = 'data/characters.json';
const STATUSES = ['확정', '초안', '수정필요', '작성필요'];
const statusClass = { 확정: 'ok', 초안: 'info', 수정필요: 'warn', 작성필요: 'danger' };
const CATEGORIES = { event: '이벤트', npc: 'NPC 대화', battle_start: '전투 시작', battle_after: '전투 후', field: '필드 조사', travel: '이동' };
const OPS = {
  set_flag: '플래그 설정', give_item: '아이템 지급', remove_item: '아이템 회수', show_cg: '일러스트 표시', hide_cg: '일러스트 숨김',
  fade_out: '화면 암전', fade_in: '암전 해제', camera_pan: '카메라 이동', start_battle: '전투 시작', add_party: '동료 합류', play_se: '효과음', wait: '잠시 대기',
};
const REPEAT = { none: '다시 말 걸면 반복 없음', tail: '끝부분 반복', separate: '별도 반복 대사' };

// Kept between route changes so unsaved edits survive moving between scenes.
let S = null;

async function load(ctx) {
  const [st, ch] = await Promise.all([ctx.store.getJSON(FILE), ctx.store.getJSON(CHARS, { characters: [] })]);
  if (!st.data) throw new Error('스토리 데이터(data/story/prologue.json)가 없어요.');
  S = { story: st.data, sha: st.sha, chars: ch.data, dirty: new Set(), flowDirty: false, checked: new Set(), openGroups: new Set(), store: ctx.store };
}

const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const isDirty = () => S && (S.dirty.size || S.flowDirty);
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

function speakers() {
  return [...S.chars.characters.map(c => ({ id: c.id, name: c.displayName || c.name })), ...(S.chars.extraSpeakers || [])];
}
const charOf = id => S.chars.characters.find(c => c.id === id);
const speakerName = st => st.name || speakers().find(s => s.id === st.speaker)?.name || st.speaker;
const emotionLabel = e => S.chars.emotions?.[e] || e;

async function portraitUrl(speaker, emotion) {
  const c = charOf(speaker);
  const file = c?.portraits?.[emotion] || c?.portraits?.normal;
  if (!file) return null;
  try { return await S.store.blobUrl(file); } catch { return null; }
}

function markDirty(sceneId) { S.dirty.add(sceneId); updateSaveBar(); }

let saveBar;
function updateSaveBar() {
  if (!saveBar) return;
  const n = S.dirty.size + (S.flowDirty ? 1 : 0);
  saveBar.querySelector('.msg').textContent = n ? `저장 안 한 변경 ${n}건` : '모두 저장됨';
  saveBar.querySelector('button.save').disabled = !n;
  saveBar.classList.toggle('dirty', !!n);
}

async function save(ctx) {
  const btn = saveBar.querySelector('button.save');
  btn.disabled = true;
  try {
    const dirty = [...S.dirty], flowDirty = S.flowDirty, deleted = S.deleted || new Set();
    // Merge only what changed here into the latest file, so Claude's edits to other scenes are kept.
    const next = await ctx.store.updateJSON(FILE, latest => {
      for (const id of dirty) {
        if (deleted.has(id)) delete latest.scenes[id];
        else if (S.story.scenes[id]) latest.scenes[id] = S.story.scenes[id];
      }
      if (flowDirty) latest.flow = S.story.flow;
      return latest;
    }, `스토리 수정: ${dirty.map(id => S.story.scenes[id]?.title || id).slice(0, 3).join(', ')}${dirty.length > 3 ? ' 외' : ''}`);
    S.story = next;
    S.dirty.clear(); S.flowDirty = false; S.deleted = new Set();
    toast('저장했어요.');
  } catch (e) { toast(e.message, true); }
  updateSaveBar();
}

export async function render(ctx, rest) {
  const tab = rest[0] === 'requests' ? 'requests' : 'edit';
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '🎬 스토리룸'),
    h('p', { class: 'sub' }, '장면 순서, 대사, 화자와 표정, 연출을 편집해요. 저장하면 Claude와 게임이 같은 내용을 봐요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/story/edit', class: tab === 'edit' ? 'on' : '' }, '장면 편집'),
      h('a', { href: '#/story/requests', class: tab === 'requests' ? 'on' : '' }, '요청함')));
  if (tab === 'requests') { page.append(requestPanel(ctx, 'story')); return page; }
  if (!S || S.store !== ctx.store) await load(ctx);
  const sel = rest[1] && S.story.scenes[rest[1]] ? rest[1] : S.story.flow[0]?.id;
  saveBar = h('div', { class: 'savebar' },
    h('span', { class: 'msg' }),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn small', onclick: async () => { if (!isDirty() || await confirmBox('저장 안 한 변경을 버리고 최신 내용을 불러올까요?', '불러오기')) { await load(ctx); window.dispatchEvent(new HashChangeEvent('hashchange')); } } }, '최신 불러오기'),
    h('button', { class: 'btn small primary save', onclick: () => save(ctx) }, '저장'));
  updateSaveBar();
  page.append(saveBar, h('div', { class: 'story' }, flowTree(ctx, sel), sceneEditor(ctx, sel)));
  return page;
}

// ---------- left: flow tree ----------
function flowTree(ctx, sel) {
  const q = h('input', { class: 'search', placeholder: '대사·장면 검색' });
  const list = h('div', {});
  const counts = Object.values(S.story.scenes).reduce((a, s) => (a[s.status] = (a[s.status] || 0) + 1, a), {});
  const sceneLink = (id, indent) => {
    const s = S.story.scenes[id];
    if (!s) return null;
    return h('a', { href: `#/story/edit/${id}`, class: `${id === sel ? 'on' : ''} ${indent ? 'indent' : ''}` },
      h('span', { class: `dot ${statusClass[s.status] || ''}`, title: s.status }),
      h('span', { class: 'name' }, s.title || id),
      S.dirty.has(id) && h('span', { class: 'muted' }, ' •'));
  };
  const draw = () => {
    const term = q.value.trim();
    const match = id => {
      const s = S.story.scenes[id];
      if (!term || !s) return true;
      return (s.title || '').includes(term) || s.steps.some(st => (st.text || '').includes(term) || (st.name || '').includes(term));
    };
    list.replaceChildren(...S.story.flow.map((f, i) => {
      if (f.kind === 'scene') return match(f.id) ? h('div', { class: 'flow-item' }, sceneLink(f.id), flowTools(ctx, i)) : null;
      const members = f.members.filter(match);
      if (term && !members.length) return null;
      const open = term || S.openGroups.has(f.id) || f.members.includes(sel);
      return h('div', { class: 'flow-item group' },
        h('div', { class: 'group-head', onclick: () => { S.openGroups.has(f.id) ? S.openGroups.delete(f.id) : S.openGroups.add(f.id); draw(); } },
          h('span', {}, open ? '▾' : '▸'), h('span', { class: 'name' }, f.title), h('span', { class: 'badge' }, f.members.length), flowTools(ctx, i)),
        open && h('div', {}, members.map(id => sceneLink(id, true)),
          h('a', { href: '#', class: 'indent add', onclick: e => { e.preventDefault(); addScene(ctx, { group: f }); } }, '+ 이 묶음에 NPC 대화 추가')));
    }));
  };
  q.addEventListener('input', draw);
  draw();
  return h('div', { class: 'card tree story-tree' },
    h('div', { class: 'row', style: { marginBottom: '8px', fontSize: '12px' } }, STATUSES.map(s => h('span', { class: `badge ${statusClass[s]}` }, `${s} ${counts[s] || 0}`))),
    q, list,
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn small', onclick: () => addScene(ctx, { after: sel }) }, '+ 장면'),
      h('button', { class: 'btn small', onclick: () => addGroup(ctx, sel) }, '+ NPC 묶음')));
}

function flowTools(ctx, i) {
  const move = (e, d) => {
    e.preventDefault(); e.stopPropagation();
    const j = i + d;
    if (j < 0 || j >= S.story.flow.length) return;
    const f = S.story.flow;
    [f[i], f[j]] = [f[j], f[i]];
    S.flowDirty = true;
    rerender(ctx);
  };
  return h('span', { class: 'flow-tools' },
    h('button', { title: '위로', onclick: e => move(e, -1) }, '↑'),
    h('button', { title: '아래로', onclick: e => move(e, 1) }, '↓'));
}

function rerender(ctx, sceneId) {
  const cur = sceneId || location.hash.split('/')[3];
  const target = `#/story/edit/${cur || ''}`;
  if (location.hash === target) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else ctx.go(target);
}

function newScene(category = 'event') {
  return { id: uid('scene'), title: category === 'npc' ? '새 NPC 대화' : '새 장면', category, location: '', note: '', status: '초안', steps: [] };
}

function addScene(ctx, { after, group }) {
  const s = newScene(group ? 'npc' : 'event');
  S.story.scenes[s.id] = s;
  if (group) group.members.push(s.id);
  else {
    const idx = S.story.flow.findIndex(f => f.id === after || f.members?.includes(after));
    S.story.flow.splice(idx + 1, 0, { kind: 'scene', id: s.id });
  }
  S.flowDirty = true;
  markDirty(s.id);
  rerender(ctx, s.id);
}

async function addGroup(ctx, after) {
  const name = h('input', { placeholder: '예) 신전 의논 이후 · 마을 대화' });
  const ok = await modal('새 NPC 대화 묶음', h('label', { class: 'field' }, h('span', {}, '묶음 이름 (언제의 대화인지)'), name), [{ label: '취소', value: false }, { label: '만들기', value: true, primary: true }]);
  if (!ok || !name.value.trim()) return;
  const idx = S.story.flow.findIndex(f => f.id === after || f.members?.includes(after));
  const g = { kind: 'group', id: uid('group'), title: name.value.trim(), members: [] };
  S.story.flow.splice(idx + 1, 0, g);
  S.openGroups.add(g.id);
  S.flowDirty = true;
  addScene(ctx, { group: g });
}

// ---------- right: scene editor ----------
function sceneEditor(ctx, id) {
  const s = S.story.scenes[id];
  if (!s) return h('div', { class: 'card empty' }, '장면을 골라 주세요.');
  const change = () => markDirty(id);
  const input = (key, attrs = {}) => {
    const el = h(attrs.tag || 'input', { ...attrs, tag: null });
    el.value = s[key] || '';
    el.addEventListener('input', () => { s[key] = el.value; change(); });
    return el;
  };
  const statusSel = h('select', {}, STATUSES.map(v => h('option', { value: v, selected: s.status === v }, v)));
  statusSel.onchange = () => { s.status = statusSel.value; change(); };
  const catSel = h('select', {}, Object.entries(CATEGORIES).map(([v, l]) => h('option', { value: v, selected: s.category === v }, l)));
  catSel.onchange = () => { s.category = catSel.value; change(); rerender(ctx, id); };

  const stepsBox = h('div', { class: 'steps' });
  const drawSteps = () => stepsBox.replaceChildren(...stepList(ctx, s, s.steps, drawSteps, change));
  drawSteps();

  const del = async () => {
    if (!await confirmBox(`"${s.title}" 장면을 지울까요? 저장하기 전에는 되돌릴 수 있어요(최신 불러오기).`, '지우기')) return;
    S.story.flow = S.story.flow.filter(f => f.id !== id);
    for (const f of S.story.flow) if (f.members) f.members = f.members.filter(m => m !== id);
    delete S.story.scenes[id];
    (S.deleted ||= new Set()).add(id);
    S.flowDirty = true;
    markDirty(id);
    rerender(ctx, S.story.flow[0]?.id);
  };

  return h('div', { class: 'scene-ed' },
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: `badge ${statusClass[s.status] || ''}` }, s.status),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `${CATEGORIES[s.category] || s.category} · id: ${s.id}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', onclick: () => preview(s) }, '▶ 미리보기'),
        h('button', { class: 'btn small danger', onclick: del }, '장면 삭제')),
      h('div', { class: 'scene-fields' },
        h('label', { class: 'field wide' }, h('span', {}, '장면 이름'), input('title')),
        h('label', { class: 'field' }, h('span', {}, '상태'), statusSel),
        h('label', { class: 'field' }, h('span', {}, '종류'), catSel),
        h('label', { class: 'field' }, h('span', {}, '장소'), input('location')),
        s.category === 'npc' && h('label', { class: 'field' }, h('span', {}, '대화 대상 (NPC 키)'), input('npc', { placeholder: '예) mirette, resident_03' })),
        h('label', { class: 'field wide' }, h('span', {}, '연출 메모 (게임에 나오지 않는 설명)'), input('note', { tag: 'textarea', rows: 2 }))),
      conditionsInfo(s)),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h2', { style: { margin: 0 } }, '대사와 연출'), h('span', { class: 'spacer' }), clipboardTools(s, s.steps, drawSteps, change)),
      stepsBox,
      addButtons(s.steps, drawSteps, change)),
    s.category === 'npc' && repeatEditor(ctx, s, change));
}

function conditionsInfo(s) {
  const parts = [];
  if (s.conditions && Object.keys(s.conditions).length) parts.push(`발생 조건: ${Object.entries(s.conditions).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  if (s.onceFlag) parts.push(`한 번만: ${s.onceFlag}`);
  return parts.length ? h('p', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 0' } }, parts.join(' · ')) : null;
}

function stepList(ctx, s, steps, redraw, change) {
  if (!steps.length) return [h('div', { class: 'empty' }, '아직 대사가 없어요. 아래 버튼으로 추가하세요.')];
  return steps.map((st, i) => stepRow(ctx, s, steps, st, i, redraw, change));
}

function stepRow(ctx, s, steps, st, i, redraw, change) {
  const row = h('div', { class: `step ${st.kind} ${S.checked.has(st.id) ? 'checked' : ''}`, draggable: 'true' });
  // drag to reorder (mouse); buttons work on touch screens
  row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', String(i)); row.classList.add('dragging'); });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('over'); });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', e => {
    e.preventDefault(); row.classList.remove('over');
    const from = Number(e.dataTransfer.getData('text/plain'));
    if (Number.isNaN(from) || from === i) return;
    const [moved] = steps.splice(from, 1);
    steps.splice(i, 0, moved);
    change(); redraw();
  });

  const check = h('input', { type: 'checkbox', checked: S.checked.has(st.id), title: '복사할 대사 선택' });
  check.onchange = () => { check.checked ? S.checked.add(st.id) : S.checked.delete(st.id); row.classList.toggle('checked', check.checked); };
  const tools = h('div', { class: 'step-tools' },
    h('button', { title: '위로', onclick: () => { if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; change(); redraw(); } } }, '↑'),
    h('button', { title: '아래로', onclick: () => { if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; change(); redraw(); } } }, '↓'),
    h('button', { title: '복제', onclick: () => { steps.splice(i + 1, 0, { ...structuredClone(st), id: uid('L') }); change(); redraw(); } }, '⧉'),
    h('button', { title: '아래에 대사 추가', onclick: () => { steps.splice(i + 1, 0, newLine(st.kind === 'line' ? st.speaker : 'pyle')); change(); redraw(); } }, '+'),
    h('button', { title: '삭제', class: 'del', onclick: () => { steps.splice(i, 1); change(); redraw(); } }, '✕'));

  let body;
  if (st.kind === 'line') {
    const pic = h('div', { class: 'pic' });
    const loadPic = () => portraitUrl(st.speaker, st.emotion).then(u => pic.replaceChildren(u ? h('img', { src: u }) : h('span', {}, speakerName(st).slice(0, 2))));
    loadPic();
    const spk = h('select', {}, speakers().map(sp => h('option', { value: sp.id, selected: sp.id === st.speaker }, sp.name)));
    const emoSel = h('select');
    const fillEmo = () => {
      const avail = Object.keys(charOf(st.speaker)?.portraits || {});
      const list = avail.length ? avail : ['normal'];
      if (!list.includes(st.emotion)) list.push(st.emotion || 'normal');
      emoSel.replaceChildren(...list.map(e => h('option', { value: e, selected: e === st.emotion }, emotionLabel(e) + (avail.length && !avail.includes(e) ? ' (그림 없음)' : ''))));
    };
    fillEmo();
    spk.onchange = () => { st.speaker = spk.value; change(); fillEmo(); loadPic(); };
    emoSel.onchange = () => { st.emotion = emoSel.value; change(); loadPic(); };
    const nameIn = h('input', { class: 'name-in', placeholder: '표시 이름', value: st.name || '' });
    nameIn.oninput = () => { st.name = nameIn.value || undefined; if (!st.name) delete st.name; change(); };
    const text = h('textarea', { rows: 2, placeholder: '대사를 입력하세요' });
    text.value = st.text || '';
    text.oninput = () => { st.text = text.value; change(); };
    body = h('div', { class: 'line' }, pic,
      h('div', { class: 'line-main' },
        h('div', { class: 'row line-head' }, spk, emoSel, nameIn, h('span', { class: 'sid' }, st.id)),
        text));
  } else if (st.kind === 'direction') {
    const text = h('textarea', { rows: 2, placeholder: '연출 설명 (화면 묘사, 움직임 등)' });
    text.value = st.text || '';
    text.oninput = () => { st.text = text.value; change(); };
    body = h('div', { class: 'dir' }, h('span', { class: 'tag' }, '연출'), text);
  } else {
    const opSel = h('select', {}, Object.entries(OPS).map(([v, l]) => h('option', { value: v, selected: v === st.op }, l)));
    if (!OPS[st.op]) opSel.append(h('option', { value: st.op, selected: true }, st.op));
    opSel.onchange = () => { st.op = opSel.value; change(); };
    const args = h('input', { value: Object.entries(st.args || {}).map(([k, v]) => `${k}=${v}`).join(', '), placeholder: '예) key=dinner' });
    args.oninput = () => {
      st.args = {};
      for (const part of args.value.split(',')) {
        const [k, ...v] = part.split('=');
        if (!k.trim()) continue;
        let val = v.join('=').trim();
        if (val === 'true') val = true; else if (val === 'false') val = false; else if (val !== '' && !isNaN(val)) val = Number(val);
        st.args[k.trim()] = val;
      }
      change();
    };
    body = h('div', { class: 'cmd' }, h('span', { class: 'tag' }, '명령'), opSel, args);
  }
  row.append(check, body, tools);
  return row;
}

function newLine(speaker = 'pyle') { return { id: uid('L'), kind: 'line', speaker, emotion: 'normal', text: '' }; }

function addButtons(steps, redraw, change) {
  const add = st => { steps.push(st); change(); redraw(); };
  return h('div', { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn small', onclick: () => add(newLine(steps.filter(x => x.kind === 'line').at(-2)?.speaker || 'pyle')) }, '+ 대사'),
    h('button', { class: 'btn small', onclick: () => add({ id: uid('D'), kind: 'direction', text: '' }) }, '+ 연출'),
    h('button', { class: 'btn small', onclick: () => add({ id: uid('C'), kind: 'cmd', op: 'set_flag', args: {} }) }, '+ 명령'));
}

const CLIP = 'pyle.story.clipboard';
function clipboardTools(s, steps, redraw, change) {
  const copy = () => {
    const sel = steps.filter(st => S.checked.has(st.id));
    if (!sel.length) return toast('복사할 대사의 체크박스를 먼저 선택하세요.', true);
    localStorage.setItem(CLIP, JSON.stringify(sel));
    S.checked.clear();
    toast(`${sel.length}개를 복사했어요. 다른 장면에서도 붙여넣을 수 있어요.`);
    redraw();
  };
  const cut = () => {
    const sel = steps.filter(st => S.checked.has(st.id));
    if (!sel.length) return toast('잘라낼 대사의 체크박스를 먼저 선택하세요.', true);
    localStorage.setItem(CLIP, JSON.stringify(sel));
    for (const st of sel) steps.splice(steps.indexOf(st), 1);
    S.checked.clear();
    change(); redraw();
    toast(`${sel.length}개를 잘라냈어요. 옮길 장면에서 붙여넣으세요.`);
  };
  const paste = () => {
    const items = JSON.parse(localStorage.getItem(CLIP) || '[]');
    if (!items.length) return toast('복사한 대사가 없어요.', true);
    const at = steps.findIndex(st => S.checked.has(st.id));
    const copies = items.map(st => ({ ...st, id: uid(st.kind === 'line' ? 'L' : 'D') }));
    steps.splice(at >= 0 ? at + 1 : steps.length, 0, ...copies);
    S.checked.clear();
    change(); redraw();
    toast(`${copies.length}개를 붙여넣었어요.`);
  };
  return h('span', { class: 'row' },
    h('button', { class: 'btn small', onclick: copy }, '복사'),
    h('button', { class: 'btn small', onclick: cut }, '잘라내기'),
    h('button', { class: 'btn small', onclick: paste, title: '체크한 대사 아래(없으면 맨 끝)에 붙여넣기' }, '붙여넣기'));
}

function repeatEditor(ctx, s, change) {
  s.repeat ||= { mode: 'none', count: 1 };
  const r = s.repeat;
  const box = h('div');
  const draw = () => {
    const modeSel = h('select', {}, Object.entries(REPEAT).map(([v, l]) => h('option', { value: v, selected: r.mode === v }, l)));
    modeSel.onchange = () => { r.mode = modeSel.value; if (r.mode === 'separate') r.steps ||= []; change(); draw(); };
    const count = h('input', { type: 'number', min: 1, value: r.count || 1, style: { width: '70px' } });
    count.oninput = () => { r.count = Number(count.value) || 1; change(); };
    const parts = [h('div', { class: 'row' }, modeSel, r.mode === 'tail' && [count, h('span', { class: 'muted' }, '줄을 반복')])];
    if (r.mode === 'separate') {
      const list = h('div', { class: 'steps' });
      const redraw = () => list.replaceChildren(...stepList(ctx, s, r.steps, redraw, change));
      redraw();
      parts.push(list, addButtons(r.steps, redraw, change));
    }
    box.replaceChildren(...parts);
  };
  draw();
  return h('div', { class: 'card' }, h('h2', {}, '다시 말 걸었을 때'), box);
}

// ---------- preview ----------
async function preview(s) {
  const steps = s.steps.filter(st => st.kind !== 'cmd' || ['show_cg', 'hide_cg', 'fade_out', 'give_item', 'add_party', 'start_battle'].includes(st.op));
  if (!steps.length) return toast('미리볼 대사가 없어요.', true);
  let i = 0, cg = null;
  const stage = h('div', { class: 'pv-stage' });
  const bg = h('div', { class: 'modal-bg pv', onclick: e => { if (e.target === bg) close(); } }, stage);
  const close = () => { bg.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); else if ([' ', 'Enter', 'ArrowRight'].includes(e.key)) { e.preventDefault(); next(); } else if (e.key === 'ArrowLeft') { i = Math.max(0, i - 2); next(); } };
  document.addEventListener('keydown', key);
  document.body.append(bg);
  const next = async () => {
    if (i >= steps.length) return close();
    const st = steps[i++];
    if (st.kind === 'cmd') {
      if (st.op === 'show_cg') {
        const ill = S.story.illustrations?.[st.args?.key];
        cg = ill ? await S.store.blobUrl(ill.file).catch(() => null) : null;
      } else if (st.op === 'hide_cg') cg = null;
      if (['show_cg', 'hide_cg'].includes(st.op)) return next();
    }
    const scene = h('div', { class: 'pv-scene', style: cg ? { backgroundImage: `url(${cg})` } : {} });
    let box;
    if (st.kind === 'line') {
      const url = await portraitUrl(st.speaker, st.emotion);
      box = h('div', { class: 'pv-box' },
        url && h('img', { class: 'pv-portrait', src: url }),
        h('div', { class: 'pv-name' }, speakerName(st)),
        h('div', { class: 'pv-text' }, st.text || '(빈 대사)'));
    } else if (st.kind === 'direction') {
      box = h('div', { class: 'pv-box dir' }, h('div', { class: 'pv-text' }, `[연출] ${st.text}`));
    } else {
      box = h('div', { class: 'pv-box dir' }, h('div', { class: 'pv-text' }, `[${OPS[st.op] || st.op}] ${Object.values(st.args || {}).join(' ')}`));
    }
    stage.replaceChildren(scene, box,
      h('div', { class: 'pv-bar' }, h('span', {}, `${i} / ${steps.length}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: e => { e.stopPropagation(); i = Math.max(0, i - 2); next(); } }, '◀ 이전'),
        h('button', { class: 'btn small primary', onclick: e => { e.stopPropagation(); next(); } }, '다음 ▶'),
        h('button', { class: 'btn small', onclick: e => { e.stopPropagation(); close(); } }, '닫기')));
  };
  stage.addEventListener('click', e => { if (!e.target.closest('button')) next(); });
  next();
}
