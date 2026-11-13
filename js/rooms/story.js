// Story room: chapters → scenes → lines. Edit speakers, expressions, order, and preview the dialogue box.
import { h, toast, loading, errorBox, confirmBox, modal, closeModal, hoverZoom, hideHoverZoom } from '../ui.js';
import { requestPanel, newId } from './requests.js';
import { makeDraggable, moveInArray } from '../drag.js';
import { loadRegistry, updateRegistry, viewImage } from '../assets.js';
import { portraitLayer, loadDialogueLayout, layoutStage } from '../portrait.js';

// 장(파일) 선택: 프롤로그 + 작가 제안에서 편입된 장들 (data/story/*.json)
let FILE = localStorage.getItem('pyle.storyFile') || 'data/story/prologue.json';
const CHARS = 'data/characters.json';
const STATUSES = ['확정', '초안', '수정필요', '작성필요'];
const statusClass = { 확정: 'ok', 초안: 'info', 수정필요: 'warn', 작성필요: 'danger' };
const CATEGORIES = { event: '이벤트', npc: 'NPC 대화', battle_start: '전투 시작', battle_after: '전투 후', field: '필드 조사', travel: '이동' };
const OPS = {
  set_flag: '플래그 설정', give_item: '아이템 지급', remove_item: '아이템 회수', show_cg: '일러스트 표시', hide_cg: '일러스트 숨김',
  fade_out: '화면 암전', fade_in: '암전 해제', camera_pan: '카메라 이동', start_battle: '전투 시작', add_party: '동료 합류', play_se: '효과음', play_bgm: '배경음악', wait: '잠시 대기',
  title_motion: '타이틀 연출', flash: '화면 번쩍임', shake: '화면 흔들림',
};
const REPEAT = { none: '전체 대화를 다시 (기본)', tail: '끝부분만 반복 (긴 대화용)', separate: '다시 말 걸면 따로 쓴 대사' };

// Kept between route changes so unsaved edits survive moving between scenes.
let S = null;

async function load(ctx) {
  const [st, ch, reg] = await Promise.all([ctx.store.getJSON(FILE), ctx.store.getJSON(CHARS, { characters: [] }), loadRegistry(ctx.store).catch(() => []), loadDialogueLayout(ctx.store)]);
  if (!st.data) { if (FILE !== 'data/story/prologue.json') { FILE = 'data/story/prologue.json'; localStorage.removeItem('pyle.storyFile'); return load(ctx); } throw new Error('스토리 데이터(data/story/prologue.json)가 없어요.'); }
  S = { story: st.data, sha: st.sha, chars: ch.data, assets: reg, dirty: new Set(), flowDirty: false, checked: new Set(), openGroups: new Set(), store: ctx.store };
}

const uid = p => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const isDirty = () => S && (S.dirty.size || S.flowDirty);
window.addEventListener('beforeunload', e => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

function speakers() {
  return [...S.chars.characters.map(c => ({ id: c.id, name: c.displayName || c.name })), ...(S.chars.extraSpeakers || [])];
}
const charOf = id => S.chars.characters.find(c => c.id === id);
const firstSpeaker = () => S?.chars?.characters?.[0]?.id || 'system';
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
  if (!S || S.store !== ctx.store || S.file !== FILE) await load(ctx);
  S.file = FILE;
  const sel = rest[1] && S.story.scenes[rest[1]] ? rest[1] : S.story.flow[0]?.id;
  const files = (await ctx.store.list('data/story').catch(() => [])).filter(f => f.name.endsWith('.json'));
  if (files.length > 1) {
    const fs = h('select', {}, files.map(f => h('option', { value: f.path, selected: f.path === FILE }, f.name === 'prologue.json' ? '프롤로그' : f.name.replace('.json', ''))));
    fs.onchange = async () => {
      if (isDirty() && !await confirmBox('저장 안 한 변경이 있어요. 버리고 다른 장으로 갈까요?', '이동')) { fs.value = FILE; return; }
      FILE = fs.value; localStorage.setItem('pyle.storyFile', FILE); S = null; ctx.go('#/story/edit');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    };
    page.append(h('div', { class: 'row', style: { marginBottom: '8px' } }, h('b', {}, '장'), fs));
  }
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
  const sceneLink = (id, indent, dropAttrs = {}) => {
    const s = S.story.scenes[id];
    if (!s) return null;
    const a = h('a', { href: `#/story/edit/${id}`, class: `${id === sel ? 'on' : ''} ${indent ? 'indent' : ''}`, ...dropAttrs },
      h('span', { class: 'grip' }, '⠿'),
      h('span', { class: `dot ${statusClass[s.status] || ''}`, title: s.status }),
      h('span', { class: 'name' }, s.title || id),
      s.claudeNote && h('span', { title: 'Claude가 새로 쓰거나 고친 대사 — 확인해 주세요' }, ' 🤖'),
      S.dirty.has(id) && h('span', { class: 'muted' }, ' •'));
    return a;
  };
  // Every row says where it lives: a top-level flow slot or a member slot inside a group.
  const wireDrag = (rowEl, src) => {
    const grip = rowEl.querySelector('.grip') || rowEl;
    makeDraggable(grip, rowEl, {
      accept: t => src.kind === 'flow' && S.story.flow[src.fi].kind === 'group' ? t.dataset.drop === 'flow' : true,
      onDrop: (t, before) => { moveFlow(src, t.dataset, before); S.flowDirty = true; rerender(ctx, sel); },
    });
  };
  const draw = () => {
    const term = q.value.trim();
    const match = id => {
      const s = S.story.scenes[id];
      if (!term || !s) return true;
      return (s.title || '').includes(term) || s.steps.some(st => (st.text || '').includes(term) || (st.name || '').includes(term));
    };
    list.replaceChildren(...S.story.flow.map((f, i) => {
      if (f.kind === 'scene') {
        if (!match(f.id)) return null;
        const row = h('div', { class: 'flow-item', 'data-drop': 'flow', 'data-fi': i }, sceneLink(f.id), flowTools(ctx, i));
        wireDrag(row, { kind: 'flow', fi: i });
        return row;
      }
      const members = f.members.filter(match);
      if (term && !members.length) return null;
      const open = term || S.openGroups.has(f.id) || f.members.includes(sel);
      const head = h('div', { class: 'group-head', onclick: e => { if (e.target.closest('.grip')) return; S.openGroups.has(f.id) ? S.openGroups.delete(f.id) : S.openGroups.add(f.id); draw(); } },
        h('span', { class: 'grip' }, '⠿'), h('span', {}, open ? '▾' : '▸'), h('span', { class: 'name' }, f.title), h('span', { class: 'badge' }, f.members.length), flowTools(ctx, i));
      const box = h('div', { class: 'flow-item group', 'data-drop': 'flow', 'data-fi': i }, head,
        open && h('div', {}, members.map(id => {
          const mi = f.members.indexOf(id);
          const link = sceneLink(id, true, { 'data-drop': 'member', 'data-gid': f.id, 'data-mi': mi });
          if (link) wireDrag(link, { kind: 'member', gid: f.id, mi });
          return link;
        }),
          h('a', { href: '#', class: 'indent add', onclick: e => { e.preventDefault(); addScene(ctx, { group: f }); } }, '+ 이 묶음에 NPC 대화 추가')));
      makeDraggable(head.querySelector('.grip'), box, {
        accept: t => t.dataset.drop === 'flow',
        onDrop: (t, before) => { moveFlow({ kind: 'flow', fi: i }, t.dataset, before); S.flowDirty = true; rerender(ctx, sel); },
      });
      return box;
    }));
  };
  q.addEventListener('input', draw);
  draw();
  const byClaude = Object.values(S.story.scenes).filter(x => x.claudeNote);
  const notice = byClaude.length && h('details', { class: 'claude-notice' },
    h('summary', {}, h('b', {}, `🤖 Claude가 새로 쓴 대사 ${byClaude.length}개`), ' — 눌러서 보기'),
    h('p', { class: 'muted', style: { margin: '4px 0' } }, '읽어 보고 장면마다 [확인했어요]를 눌러 주세요. 목록에도 🤖가 붙어 있어요.'),
    h('div', { class: 'links' }, byClaude.map(x => h('a', { href: `#/story/edit/${x.id}` }, x.title || x.id))));
  return h('div', { class: 'card tree story-tree' },
    notice,
    h('div', { class: 'row', style: { marginBottom: '8px', fontSize: '12px' } }, STATUSES.map(s => h('span', { class: `badge ${statusClass[s]}` }, `${s} ${counts[s] || 0}`))),
    q, list,
    h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn small', onclick: () => addScene(ctx, { after: sel }) }, '+ 장면'),
      h('button', { class: 'btn small', onclick: () => addGroup(ctx, sel) }, '+ NPC 묶음')));
}

// Move a scene/group between top-level flow slots and NPC group member slots.
function moveFlow(src, dst, before) {
  const flow = S.story.flow;
  const groupOf = id => flow.find(f => f.kind === 'group' && f.id === id);
  // take the item out
  let item;
  if (src.kind === 'flow') item = flow[src.fi];
  else item = { kind: 'scene', id: groupOf(src.gid).members[src.mi] };
  // remember the target object before indices shift
  const dstFlowItem = dst.drop === 'flow' ? flow[Number(dst.fi)] : null;
  const dstGroup = dst.drop === 'member' ? groupOf(dst.gid) : null;
  const dstMemberId = dstGroup ? dstGroup.members[Number(dst.mi)] : null;
  if (src.kind === 'flow') flow.splice(src.fi, 1);
  else groupOf(src.gid).members.splice(src.mi, 1);
  if (dstGroup) {
    if (item.kind === 'group') { flow.splice(src.fi, 0, item); return; }
    const at = dstGroup.members.indexOf(dstMemberId);
    dstGroup.members.splice(before ? at : at + 1, 0, item.id);
  } else {
    const at = flow.indexOf(dstFlowItem);
    flow.splice(before ? at : at + 1, 0, item);
  }
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
  const name = h('input', { placeholder: '예) 사건 뒤 · 마을 대화' });
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

  const ack = () => { delete s.claudeNote; change(); rerender(ctx, id); toast('확인 표시를 했어요. [저장]을 누르면 반영돼요.'); };
  const claudeBox = s.claudeNote && h('div', { class: 'card claude-note' },
    h('div', { class: 'row' }, h('b', {}, '🤖 Claude가 새로 쓴 대사예요'), h('span', { class: 'spacer' }), h('button', { class: 'btn small primary', onclick: ack }, '확인했어요')),
    h('p', { style: { margin: '6px 0 0', fontSize: '14px' } }, s.claudeNote.text || ''),
    h('p', { class: 'muted', style: { margin: '4px 0 0', fontSize: '12px' } }, '마음에 안 들면 바로 고치시거나 지워도 돼요.'));
  return h('div', { class: 'scene-ed' },
    claudeBox,
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: `badge ${statusClass[s.status] || ''}` }, s.status),
        h('span', { class: 'muted', style: { fontSize: '12px' } }, `${CATEGORIES[s.category] || s.category} · id: ${s.id}`),
        h('span', { class: 'spacer' }),
        h('button', { class: 'btn small primary', onclick: () => preview(s) }, '▶ 미리보기'),
        h('button', { class: 'btn small', onclick: () => askReview(ctx, s) }, '💬 Claude 검토 요청'),
        h('button', { class: 'btn small danger', onclick: del }, '장면 삭제')),
      h('div', { class: 'scene-fields' },
        h('label', { class: 'field wide' }, h('span', {}, '장면 이름'), input('title')),
        h('label', { class: 'field' }, h('span', {}, '상태'), statusSel),
        h('label', { class: 'field' }, h('span', {}, '종류'), catSel),
        h('label', { class: 'field' }, h('span', {}, '장소'), input('location')),
        s.category === 'npc' && h('label', { class: 'field' }, h('span', {}, '대화 대상 (NPC 키)'), input('npc', { placeholder: '예) 인물 id 또는 resident_03' })),
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
  const row = h('div', { class: `step ${st.kind} ${S.checked.has(st.id) ? 'checked' : ''}`, 'data-drop': 'step', 'data-index': i });
  const grip = h('span', { class: 'grip' }, '⠿');
  makeDraggable(grip, row, {
    accept: t => t.dataset.drop === 'step' && t.parentElement === row.parentElement,
    onDrop: (t, before) => { moveInArray(steps, i, Number(t.dataset.index), before); change(); redraw(); },
  });
  const check = h('input', { type: 'checkbox', checked: S.checked.has(st.id), title: '복사할 대사 선택' });
  check.onchange = () => { check.checked ? S.checked.add(st.id) : S.checked.delete(st.id); row.classList.toggle('checked', check.checked); };
  const tools = h('div', { class: 'step-tools' },
    h('button', { title: '위로', onclick: () => { if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; change(); redraw(); } } }, '↑'),
    h('button', { title: '아래로', onclick: () => { if (i < steps.length - 1) { [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]; change(); redraw(); } } }, '↓'),
    h('button', { title: '복제', onclick: () => { steps.splice(i + 1, 0, { ...structuredClone(st), id: uid('L') }); change(); redraw(); } }, '⧉'),
    h('button', { title: '아래에 대사 추가', onclick: () => { steps.splice(i + 1, 0, newLine(st.kind === 'line' ? st.speaker : firstSpeaker())); change(); redraw(); } }, '+'),
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
    spk.onchange = () => { st.speaker = spk.value; change(); fillEmo(); loadPic(); nameIn.placeholder = `이름표: ${defName()}`; };
    emoSel.onchange = () => { st.emotion = emoSel.value; change(); loadPic(); };
    const defName = () => speakers().find(sp => sp.id === st.speaker)?.name || '';
    const nameIn = h('input', { class: 'name-in', placeholder: `이름표: ${defName()}`, value: st.name || '', title: '대사창에 뜨는 이름을 이 대사만 바꿔요. 비워 두면 기본 이름. 예) ???, 낯선 목소리, 풍차 관리인' });
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
    body = h('div', { class: 'cmd' }, h('span', { class: 'tag' }, '명령'), opSel, st.op === 'show_cg' ? cgPicker(ctx, st, change, redraw) : args);
    opSel.addEventListener('change', redraw);
  }
  row.append(grip, check, body, tools);
  return row;
}

function newLine(speaker = firstSpeaker()) { return { id: uid('L'), kind: 'line', speaker, emotion: 'normal', text: '' }; }

function addButtons(steps, redraw, change) {
  const add = st => { steps.push(st); change(); redraw(); };
  return h('div', { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn small', onclick: () => add(newLine(steps.filter(x => x.kind === 'line').at(-2)?.speaker || firstSpeaker())) }, '+ 대사'),
    h('button', { class: 'btn small', onclick: () => add({ id: uid('D'), kind: 'direction', text: '' }) }, '+ 연출'),
    h('button', { class: 'btn small', onclick: () => add({ id: uid('C'), kind: 'cmd', op: 'set_flag', args: {} }) }, '+ 명령'),
    h('button', { class: 'btn small', title: '이벤트 일러스트를 띄워요. 추가한 뒤 어떤 그림인지 고르세요.', onclick: () => add({ id: uid('C'), kind: 'cmd', op: 'show_cg', args: { key: '', duration: 0.9 } }) }, '+ 🖼 일러스트'),
    h('button', { class: 'btn small', title: '띄워 둔 일러스트를 닫아요.', onclick: () => add({ id: uid('C'), kind: 'cmd', op: 'hide_cg', args: { duration: 0.6 } }) }, '+ 일러스트 닫기'));
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

async function askReview(ctx, s) {
  const what = h('textarea', { rows: 3, placeholder: '예) 이 인물 말투가 더 명랑했으면 좋겠어 / 맞춤법만 봐줘 (비워 두면 전체 검토)' });
  const ok = await modal(`"${s.title}" 검토 요청`, h('label', { class: 'field' }, h('span', {}, '무엇을 봐 줄까요?'), what), [{ label: '취소', value: false }, { label: '요청 남기기', value: true, primary: true }]);
  if (!ok) return;
  const now = new Date().toISOString();
  try {
    await ctx.store.updateJSON('data/requests.json', d => {
      (d.requests ||= []).unshift({ id: newId(), room: 'story', title: `장면 검토: ${s.title}`, body: `장면 id: ${s.id}\n${what.value.trim() || '대사 흐름, 말투, 맞춤법, 설정과 맞는지 전체 검토'}`, status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' });
      return d;
    }, `요청 추가: 장면 검토 ${s.title}`, { requests: [] });
    ctx.refreshBadges();
    toast('요청을 남겼어요. Claude에게 "요청함 처리해줘"라고 말해 주세요.');
  } catch (e) { toast(e.message, true); }
}

// ---------- illustration picker (show_cg) ----------
const MAX_CG = 3;
let hoverBox = null;
function hoverPreview(url, e) {
  if (!hoverBox) { hoverBox = h('div', { class: 'hover-preview' }); document.body.append(hoverBox); }
  if (!url) { hoverBox.style.display = 'none'; return; }
  hoverBox.replaceChildren(h('img', { src: url }));
  const w = Math.min(520, window.innerWidth * 0.5);
  const x = e.clientX + 20 + w > window.innerWidth ? e.clientX - w - 20 : e.clientX + 20;
  Object.assign(hoverBox.style, { display: 'block', width: `${w}px`, left: `${x}px`, top: `${Math.max(10, Math.min(e.clientY - 120, window.innerHeight - w * 0.62 - 10))}px` });
}

// 이 장면(칸)용으로 만들어진 그림 전부: 지금 고른 그림, 직접 연결한 그림, 이 칸 id로 등록된 이벤트 그림(보관 포함), 새것부터 (요청 req_mwdb484exvie)
function cgAllForKey(key) {
  const ill = S.story.illustrations?.[key] || {};
  const reg = S.assets.filter(a => a.kind === 'event' && a.illustrationKey === key)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  const files = [];
  const add = f => { if (f && !files.includes(f)) files.push(f); };
  add(ill.file);
  for (const a of reg) add(a.file);
  for (const f of ill.candidates || []) add(f);
  return files;
}

async function saveIllustrations(ctx, message) {
  await ctx.store.updateJSON(FILE, latest => { latest.illustrations = S.story.illustrations; return latest; }, message);
}

function cgPicker(ctx, st, change, redraw) {
  st.args ||= {};
  S.story.illustrations ||= {};
  const ills = S.story.illustrations;
  const keySel = h('select', {}, h('option', { value: '' }, '(일러스트 고르기)'),
    Object.entries(ills).map(([k, v]) => h('option', { value: k, selected: k === st.args.key }, `${v.title || k}${v.file ? '' : ' · 준비 중'}`)),
    h('option', { value: '__new' }, '+ 새 일러스트 칸 만들기'));
  keySel.onchange = async () => {
    if (keySel.value === '__new') {
      const title = h('input', { placeholder: '예) 비 오는 밤의 다리' });
      const want = h('textarea', { rows: 5, placeholder: '어떤 그림인지 자유롭게 적어 주세요. 예) 비 오는 밤, 돌다리 위에서 파일이 등을 돌린 채 서 있고, 멀리 마을 불빛이 흐리게 보인다. 쓸쓸한 분위기.' });
      const ok = await modal('새 일러스트 요청', h('div', {},
        h('label', { class: 'field' }, h('span', {}, '이름'), title),
        h('label', { class: 'field' }, h('span', {}, '원하는 그림 내용'), want),
        h('p', { class: 'muted', style: { fontSize: '12px', margin: 0 } }, '저장하면 Claude가 확인해서 Codex에게 그림을 요청해요. 그림이 오면 이 칸에 후보로 나타나요.')),
        [{ label: '취소', value: false }, { label: '요청하기', value: true, primary: true }]);
      if (!ok || !title.value.trim()) { if (ok) toast('이름을 적어 주세요.', true); keySel.value = st.args.key || ''; return; }
      const k = newIllustrationKey(ills);
      ills[k] = { title: title.value.trim(), file: null, status: '제작필요', candidates: [] };
      if (want.value.trim()) ills[k].request = { text: want.value.trim(), status: '대기', at: new Date().toISOString() };
      st.args.key = k;
      await saveIllustrations(ctx, `일러스트 칸 추가: ${ills[k].title}`).catch(e => toast(e.message, true));
      toast(want.value.trim() ? '요청을 남겼어요. Claude가 확인해서 Codex에게 맡겨요.' : '칸을 만들었어요. 아래에 원하는 그림 내용을 적어 주세요.');
    } else st.args.key = keySel.value;
    change(); redraw();
  };
  const dur = h('input', { type: 'number', step: 0.1, min: 0, value: st.args.duration ?? 0.9, class: 'dur', title: '나타나는 데 걸리는 시간(초)' });
  dur.oninput = () => { st.args.duration = Number(dur.value); change(); };

  const key = st.args.key;
  const strip = h('div', { class: 'cg-strip' });
  if (key && ills[key]) {
    const ill = ills[key];
    const all = cgAllForKey(key);
    const pick = async file => {
      ill.file = file; ill.status = '선택됨';
      try {
        await saveIllustrations(ctx, `일러스트 선택: ${key}`);
        await updateRegistry(ctx.store, list => { for (const a of list) if (a.file === file) a.status = '사용중'; else if (a.kind === 'event' && a.illustrationKey === key && a.status === '사용중') a.status = '보관'; }, `일러스트 교체: ${key}`);
        toast(`"${ill.title}" 일러스트를 바꿨어요.`);
      } catch (e) { toast(e.message, true); }
      hoverPreview(null); redraw();
    };
    // 지금 쓰는 그림 한 장 + [교체] (후보 3칸 대신, 이 장면용 그림 전부에서 고르기)
    const slot = h('button', { class: `cg-slot big ${ill.file ? 'on' : 'empty'}`, title: ill.file ? '마우스를 올리면 크게 보여요' : '' }, ill.file ? h('span', { class: 'muted' }, '…') : '아직 없음');
    if (ill.file) S.store.blobUrl(ill.file).then(u => {
      slot.replaceChildren(h('img', { src: u }));
      slot.onmouseenter = e => hoverPreview(u, e);
      slot.onmousemove = e => hoverPreview(u, e);
      slot.onmouseleave = () => hoverPreview(null);
      slot.onclick = () => viewImage(ctx.store, ill.file, ill.title);
    }).catch(() => slot.replaceChildren(h('span', { class: 'muted' }, '그림 없음')));
    strip.append(slot,
      h('button', { class: 'btn small', onclick: () => swapIllustration(ctx, key, all, pick) }, all.length ? `🔄 교체 (이 장면용 ${all.length}장)` : '🔄 교체'),
      h('span', { class: 'muted cg-note' }, ill.file ? '✓ 쓰는 중' : all.length ? '[교체]를 눌러 골라 주세요' : '이 장면용 그림이 아직 없어요'));
  }
  const hint = !key && h('p', { class: 'muted cg-hint' }, '아직 일러스트를 고르지 않았어요. 목록에서 고르거나, 마음에 드는 게 없으면 "+ 새 일러스트 칸 만들기"로 원하는 그림을 요청하세요.');
  return h('div', { class: 'cg-picker' }, h('div', { class: 'row' }, keySel, h('span', { class: 'muted', style: { fontSize: '12px' } }, '나타나는 시간'), dur, h('span', { class: 'muted', style: { fontSize: '12px' } }, '초')), strip, hint, key && ills[key] && requestBox(ctx, key, redraw));
}

// 일러스트 칸 id: 사용자는 신경 쓰지 않아도 되게 자동으로 짓는다.
function newIllustrationKey(ills) {
  let n = Object.keys(ills).length + 1, k;
  do { k = `cg_${String(n++).padStart(3, '0')}`; } while (ills[k]);
  return k;
}

const REQ_STATE = {
  '대기': '📨 Claude가 확인해서 Codex에게 그림을 맡길 예정이에요.',
  'Claude 초안': '✍️ Claude가 장면을 보고 적은 초안이에요. 원하는 대로 고친 뒤 [요청하기]를 눌러 주세요.',
  '감독 초안': '🔍 감독이 빈 칸을 찾아 장면을 보고 적은 초안이에요. 원하는 대로 고친 뒤 [요청하기]를 눌러 주세요.',
  '요청됨': '🤝 Codex에게 맡겼어요. 그림이 오면 위 칸에 후보로 나타나요.',
};

// 원하는 그림 내용 적기 → Claude가 data/codex_tasks.json에 Codex 작업으로 옮긴다.
function requestBox(ctx, key, redraw) {
  const ill = S.story.illustrations[key];
  const r = ill.request || {};
  const ta = h('textarea', { rows: 3, placeholder: '원하는 그림 내용 (장면, 인물, 구도, 분위기, 시간대 등)' });
  ta.value = r.text || '';
  const save = async () => {
    if (!ta.value.trim()) return toast('원하는 그림 내용을 적어 주세요.', true);
    ill.request = { text: ta.value.trim(), status: '대기', at: new Date().toISOString() };
    try { await saveIllustrations(ctx, `일러스트 요청: ${ill.title}`); toast('요청을 남겼어요. Claude가 확인해서 Codex에게 맡겨요.'); } catch (e) { toast(e.message, true); }
    redraw();
  };
  const open = !ill.file || ['대기', 'Claude 초안', '감독 초안'].includes(r.status);
  return h('details', { class: 'cg-request', open },
    h('summary', {}, ill.file ? '다른 그림으로 다시 요청하기' : '원하는 그림 요청하기', r.status && h('span', { class: 'badge info', style: { marginLeft: '6px' } }, r.codexTask ? `${r.status} · ${r.codexTask}` : r.status)),
    r.status && h('p', { class: 'muted', style: { fontSize: '12px', margin: '6px 0' } }, REQ_STATE[r.status] || ''),
    ta,
    h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: save }, r.status === '요청됨' ? '내용 고쳐서 다시 요청' : '요청하기')));
}

async function linkCandidate(ctx, key, redraw) {
  const events = S.assets.filter(a => a.kind === 'event' && a.status !== '보관');
  if (!events.length) return toast('이벤트 일러스트로 등록된 그림이 없어요. 캐릭터룸 → 그림 올리기에서 종류를 "이벤트 일러스트"로 올려 주세요.', true);
  const grid = h('div', { class: 'thumb-grid' });
  const choice = await new Promise(resolve => {
    for (const a of events) {
      let url = null;
      const card = h('div', { class: 'thumb-card', onclick: () => { hideHoverZoom(); resolve(a.file); closeModal(); } }, h('div', { class: 'thumb' }, '…'), h('div', { class: 'cap' }, a.id),
        h('button', { class: 'zoom-btn', title: '크게 보기', onclick: e => { e.stopPropagation(); hideHoverZoom(); viewImage(S.store, a.file, a.id); } }, '🔍'));
      S.store.blobUrl(a.file).then(u => { url = u; card.firstChild.replaceChildren(h('img', { src: u })); });
      hoverZoom(card, () => url);
      grid.append(card);
    }
    modal('후보로 연결할 그림 고르기', grid, [{ label: '취소', value: null }]).then(() => { hideHoverZoom(); resolve(null); });
  });
  if (!choice) return;
  const ill = S.story.illustrations[key];
  ill.candidates ||= [];
  if (!ill.candidates.includes(choice)) ill.candidates.push(choice);
  try { await saveIllustrations(ctx, `일러스트 후보 연결: ${key}`); } catch (e) { toast(e.message, true); }
  redraw();
}

// [교체]: 이 장면용으로 만든 그림 전부를 보여 주고 하나를 고르면 바로 바꿈. 다른 장면용 그림을 가져오려면 아래 [다른 그림 연결]
async function swapIllustration(ctx, key, files, pick) {
  const ill = S.story.illustrations[key];
  const grid = h('div', { class: 'thumb-grid big' });
  const choice = await new Promise(resolve => {
    if (!files.length) grid.append(h('div', { class: 'empty' }, '이 장면용 그림이 아직 없어요. 아래 "원하는 그림 요청하기"로 요청하거나 [다른 그림 연결]을 눌러 주세요.'));
    for (const f of files) {
      let url = null;
      const card = h('div', { class: `thumb-card ${f === ill.file ? 'on' : ''}`, onclick: () => { hideHoverZoom(); resolve(f); closeModal(); } }, h('div', { class: 'thumb' }, '…'),
        h('div', { class: 'cap' }, f === ill.file ? '✓ 지금 쓰는 그림' : f.split('/').slice(-2).join('/')),
        h('button', { class: 'zoom-btn', title: '크게 보기', onclick: e => { e.stopPropagation(); hideHoverZoom(); viewImage(S.store, f, f.split('/').pop()); } }, '🔍'));
      S.store.blobUrl(f).then(u => { url = u; card.firstChild.replaceChildren(h('img', { src: u })); });
      hoverZoom(card, () => url);
      grid.append(card);
    }
    modal(`「${ill.title || key}」 그림 교체 — 마우스를 올리면 크게 보이고, 고르면 바로 바뀌어요`, grid, [{ label: '다른 그림 연결', value: 'link' }, { label: '닫기', value: null }]).then(v => { hideHoverZoom(); resolve(v); });
  });
  if (choice === 'link') return linkCandidate(ctx, key, () => window.dispatchEvent(new HashChangeEvent('hashchange')));
  if (choice) pick(choice);
}

// ---------- preview ----------
async function preview(s) {
  const steps = s.steps.filter(st => st.kind !== 'cmd' || ['show_cg', 'hide_cg', 'fade_out', 'give_item', 'add_party', 'start_battle', 'flash', 'shake', 'title_motion'].includes(st.op));
  if (!steps.length) return toast('미리볼 대사가 없어요.', true);
  let i = 0, cg = null, missing = null;
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
        cg = ill?.file ? await S.store.blobUrl(ill.file).catch(() => null) : null;
        missing = ill && !ill.file ? ill.title : null;
      } else if (st.op === 'hide_cg') { cg = null; missing = null; }
      if (['show_cg', 'hide_cg'].includes(st.op)) return next();
    }
    const scene = h('div', { class: `pv-scene ${missing ? 'pv-missing' : ''}`, style: cg ? { backgroundImage: `url(${cg})` } : {} }, missing && `🖼 일러스트 준비 중: ${missing}`);
    if (st.kind === 'cmd' && st.op === 'flash') { stage.classList.remove('pv-flash'); void stage.offsetWidth; stage.classList.add('pv-flash'); }
    if (st.kind === 'cmd' && st.op === 'shake') { stage.classList.remove('pv-shake'); void stage.offsetWidth; stage.classList.add('pv-shake'); }
    let box, layer = null;
    if (st.kind === 'line') {
      const url = await portraitUrl(st.speaker, st.emotion);
      if (url) layer = portraitLayer(url, charOf(st.speaker), st.emotion);
      box = h('div', { class: `pv-box ${url ? '' : 'noportrait'}` },
        h('div', { class: 'pv-name' }, speakerName(st)),
        h('div', { class: 'pv-text' }, st.text || '(빈 대사)'));
    } else if (st.kind === 'direction') {
      box = h('div', { class: 'pv-box dir' }, h('div', { class: 'pv-text' }, `[연출] ${st.text}`));
    } else {
      box = h('div', { class: 'pv-box dir' }, h('div', { class: 'pv-text' }, `[${OPS[st.op] || st.op}] ${Object.values(st.args || {}).join(' ')}`));
    }
    requestAnimationFrame(() => layoutStage(stage));
    stage.replaceChildren(...[scene, box, layer].filter(Boolean),
      h('div', { class: 'pv-bar' }, h('span', {}, `${i} / ${steps.length}`), h('span', { class: 'spacer' }),
        h('button', { class: 'btn small', onclick: e => { e.stopPropagation(); i = Math.max(0, i - 2); next(); } }, '◀ 이전'),
        h('button', { class: 'btn small primary', onclick: e => { e.stopPropagation(); next(); } }, '다음 ▶'),
        h('button', { class: 'btn small', onclick: e => { e.stopPropagation(); close(); } }, '닫기')));
  };
  stage.addEventListener('click', e => { if (!e.target.closest('button')) next(); });
  next();
}
