// Character room: people (portraits by expression), the image library with approval, and bulk upload.
import { h, toast, modal, confirmBox, closeModal } from '../ui.js';
import { portraitLayer, frameFor, loadDialogueLayout, layoutStage } from '../portrait.js';
import { requestPanel } from './requests.js';
import { motionCard, motionOverview, appliedPreview, SPRITES } from '../motion.js';
import {
  KINDS, STATUSES, statusClass, CHARS, loadRegistry, updateRegistry, uploadAssets, uploadSources, findDuplicates, thumb, viewImage,
} from '../assets.js';

const SPRITE_KINDS = ['field', 'battle', 'cutin', 'effect'];

// Approve assets. Portraits that know their character and expression are put to use right away.
async function approveAll(ctx, list) {
  const auto = list.filter(a => a.kind === 'portrait' && a.owner && a.emotion);
  if (auto.length) {
    await ctx.store.updateJSON(CHARS, d => {
      for (const a of auto) { const c = d.characters.find(x => x.id === a.owner); if (c) (c.portraits ||= {})[a.emotion] = a.file; }
      return d;
    }, `초상화 교체 ${auto.length}장`);
  }
  const ids = new Set(list.map(a => a.file));
  const autoIds = new Set(auto.map(a => a.file));
  const today = new Date().toISOString().slice(0, 10);
  await updateRegistry(ctx.store, all => {
    for (const x of all) if (ids.has(x.file)) { x.status = autoIds.has(x.file) ? '사용중' : '승인'; x.updatedAt = today; }
    // the replaced preview portraits go to the archive
    for (const a of auto) for (const x of all) if (x.owner === a.owner && x.kind === 'portrait' && x.file !== a.file && x.status === '사용중' && (x.emotion === a.emotion || x.file.endsWith(`/${a.owner}_${a.emotion}.webp`))) x.status = '보관';
  }, `그림 승인 ${list.length}장`);
  return auto.length;
}

export async function render(ctx, rest) {
  const tab = ['people', 'motion', 'requests'].includes(rest[0]) ? rest[0] : 'people';
  if (['library', 'upload'].includes(rest[0])) { ctx.go('#/art'); return h('div'); }
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '🧑 캐릭터룸'),
    h('p', { class: 'sub' }, '인물별 초상화·동작(걷기·전투 대기·전투 애니메이션)을 봐요. 모든 그림 목록은 🗂 그림 메뉴에 있어요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/character/people', class: tab === 'people' ? 'on' : '' }, '인물'),
      h('a', { href: '#/character/motion', class: tab === 'motion' ? 'on' : '' }, '🏃 동작'),
      h('a', { href: '#/art' }, '🗂 그림 메뉴로 →'),
      h('a', { href: '#/character/requests', class: tab === 'requests' ? 'on' : '' }, '요청함')));
  if (tab === 'requests') page.append(requestPanel(ctx, 'character'));
  else if (tab === 'motion') page.append(await motionOverview(ctx, (await loadAll(ctx)).chars));
  else page.append(await peopleView(ctx, rest[1]));
  return page;
}

async function loadAll(ctx) {
  const [reg, ch, sp] = await Promise.all([loadRegistry(ctx.store), ctx.store.getJSON(CHARS, { characters: [] }), ctx.store.getJSON(SPRITES, { sheets: {} })]);
  return { assets: reg, chars: ch.data, sprites: sp.data };
}

// ---------- people ----------
async function peopleView(ctx, id) {
  const { assets, chars, sprites } = await loadAll(ctx);
  const list = chars.characters;
  const cur = list.find(c => c.id === id) || list[0];
  const side = h('div', { class: 'card tree people-list' }, list.map(c => {
    const file = c.portraits?.normal || Object.values(c.portraits || {})[0];
    const n = assets.filter(a => (a.owner === c.id || a.owners?.includes(c.id)) && a.rework && ['요청', '요청됨'].includes(a.rework.status)).length;   // 수정 요청 중인 그림 수
    return h('a', { href: `#/character/people/${c.id}`, class: c.id === cur.id ? 'on' : '' },
      file ? thumb(ctx.store, file, 'avatar') : h('div', { class: 'avatar' }, c.name.slice(0, 1)),
      h('span', { class: 'name' }, c.name, c.displayName && h('small', { class: 'muted' }, ` (${c.displayName})`)),
      n ? h('span', { class: 'badge warn' }, n) : null);
  }));
  return h('div', {},
    h('div', { class: 'row', style: { marginBottom: '10px' } }, h('button', { class: 'btn small', onclick: () => compareAll(ctx, chars) }, '👥 대화창 키 한눈에 비교')),
    h('div', { class: 'split' }, side, personPage(ctx, cur, chars, assets, sprites)));
}

// A small dialogue-box stage with one portrait, used for fitting and comparing.
function mockStage(ctx, c, emotion, name, text = '대사창에서는 이 크기로 보여요.') {
  const stage = h('div', { class: 'pv-stage mock' },
    h('div', { class: 'pv-box' }, h('div', { class: 'pv-name' }, name || c.displayName || c.name), h('div', { class: 'pv-text' }, text)));
  const file = c.portraits?.[emotion];
  loadDialogueLayout(ctx.store).then(() => {
    requestAnimationFrame(() => layoutStage(stage));
    if (file) ctx.store.blobUrl(file).then(u => { const layer = portraitLayer(u, c, emotion); stage.append(layer); stage._layer = layer; });
  });
  return stage;
}

function fitCard(ctx, c, chars) {
  const emotions = chars.emotions || {};
  const emos = Object.keys(c.portraits);
  let emo = emos.includes('normal') ? 'normal' : emos[0];
  const own = () => c.portraitFrames?.[emo];
  const box = h('div');
  const draw = () => {
    const f = frameFor(c, emo);
    const stage = mockStage(ctx, c, emo);
    const refit = () => stage._layer?._fit();
    const slider = (key, label, min, max, step, fmt) => {
      const val = h('span', { class: 'muted', style: { width: '48px', textAlign: 'right' } }, fmt(f[key]));
      const r = h('input', { type: 'range', min, max, step, value: f[key] });
      r.oninput = () => {
        c.portraitFrames ||= {};
        c.portraitFrames[emo] = { ...(c.portraitFrames[emo] || {}), [key]: Number(r.value) };
        val.textContent = fmt(Number(r.value));
        refit();
      };
      return h('label', { class: 'fit-row' }, h('span', { class: 'fit-label' }, label), r, val);
    };
    const pct = v => `${Math.round(v * 100)}%`;
    const emoSel = h('select', {}, emos.map(e => h('option', { value: e, selected: e === emo }, emotions[e] || e)));
    emoSel.onchange = () => { emo = emoSel.value; draw(); };
    const save = async allEmotions => {
      const cur = frameFor(c, emo);
      try {
        await ctx.store.updateJSON(CHARS, d => {
          const x = d.characters.find(y => y.id === c.id);
          if (!x) return d;
          if (allEmotions) {
            // Each expression keeps its own face position; only size and nudges are shared.
            const shared = { scale: cur.scale, dx: cur.dx, dy: cur.dy };
            for (const t of [x, c]) {
              t.portraitFrame = { ...(t.portraitFrame || {}), ...shared };
              for (const k of Object.keys(t.portraitFrames || {})) Object.assign(t.portraitFrames[k], shared);
            }
          }
          else { (x.portraitFrames ||= {})[emo] = cur; }
          return d;
        }, `대화창 초상화 맞춤: ${c.name} ${allEmotions ? '전체' : emo}`);
        toast(allEmotions ? '모든 표정에 같은 크기·위치 조정을 저장했어요.' : `"${emotions[emo] || emo}" 표정만 저장했어요.`);
        draw();
      } catch (e) { toast(e.message, true); }
    };
    box.replaceChildren(
      h('div', { class: 'row' }, h('b', {}, '표정'), emoSel, own() && h('span', { class: 'badge info' }, '이 표정만 따로 맞춤')),
      h('div', { class: 'fit-wrap' }, stage,
        h('div', { class: 'fit-controls' },
          slider('scale', '크기', 0.6, 1.6, 0.01, pct),
          slider('dx', '좌우', -0.08, 0.08, 0.002, v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`),
          slider('dy', '위아래', -0.15, 0.15, 0.002, v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`),
          h('details', {}, h('summary', { class: 'muted' }, '얼굴 위치 (고급)'),
            slider('eye', '눈 높이', 0, 1, 0.005, pct), slider('chin', '턱 높이', 0, 1, 0.005, pct), slider('cx', '얼굴 가운데', 0, 1, 0.005, pct)),
          h('div', { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'btn small primary', onclick: () => save(false) }, '이 표정만 저장'),
            h('button', { class: 'btn small', onclick: () => save(true) }, '크기·위치를 모든 표정에 적용')))));
  };
  draw();
  return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, '대화창 맞추기'), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => compareEmotions(ctx, c, chars) }, '표정별 한눈에 보기')),
    h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 8px' } }, '모든 인물은 눈~턱 길이가 같아지도록 자동으로 맞춰지고, 대사 글자는 초상화 오른쪽에서 시작해요. 어색하면 슬라이더로 조정하고 저장하세요.'), box);
}

export async function compareEmotions(ctx, c, chars) {
  const grid = h('div', { class: 'compare-grid three' }, Object.keys(c.portraits || {}).map(e => mockStage(ctx, c, e, null, chars.emotions?.[e] || e)));
  await modal(`${c.name} · 표정별 비교`, grid);
}

async function compareAll(ctx, chars) {
  const grid = h('div', { class: 'compare-grid' },
    chars.characters.filter(c => c.portraits?.normal).map(c => mockStage(ctx, c, 'normal', null, c.name)));
  await modal('대화창 키 비교 (기본 표정)', grid);
}

function personPage(ctx, c, chars, assets, sprites) {
  const emotions = chars.emotions || {};
  const mine = assets.filter(a => a.owner === c.id || a.owners?.includes(c.id));
  const portraitGrid = h('div', { class: 'thumb-grid' },
    Object.entries(c.portraits || {}).map(([emo, file]) => h('div', { class: 'thumb-card', onclick: () => viewImage(ctx.store, file, `${c.name} · ${emotions[emo] || emo}`) },
      thumb(ctx.store, file), h('div', { class: 'cap' }, emotions[emo] || emo))));
  const byKind = {};
  for (const a of mine) (byKind[a.kind] ||= []).push(a);
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, c.name), c.displayName && h('span', { class: 'muted' }, `대사창 표시: ${c.displayName}`), h('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '12px' } }, `id: ${c.id}`)),
      h('p', { class: 'muted', style: { fontSize: '13px' } }, '인물 설정은 시나리오룸 → 등장인물 문서에 있어요.')),
    sprites ? motionCard(ctx.store, sprites, c.id, '') : null,
    h('div', { class: 'card' },
      h('h2', {}, '대화 초상화 (표정별)'),
      Object.keys(c.portraits || {}).length ? portraitGrid : h('div', { class: 'empty' }, '아직 초상화가 없어요. 그림 올리기에서 올리고 승인한 뒤 "표정 초상화로 지정"을 눌러 주세요.'),
      h('p', { class: 'muted', style: { fontSize: '12px' } }, '지금은 이전 편집실의 작은 미리보기 그림이에요. 원본 크기 그림을 올리면 교체할 수 있어요.')),
    Object.keys(c.portraits || {}).length ? fitCard(ctx, c, chars) : null,
    h('div', { class: 'card' },
      h('h2', {}, '이 인물의 등록 그림'),
      mine.length ? Object.entries(byKind).sort(([a], [b]) => (a === 'reference' ? -1 : b === 'reference' ? 1 : 0)).map(([k, arr]) => [h('h4', { class: 'muted' }, KINDS[k] || k), assetGrid(ctx, arr, chars)])
        : h('div', { class: 'empty' }, '등록된 그림이 없어요.')));
}

// ---------- library ----------
// 상태는 두 가지로만 보여요: 적용(게임에 쓰는 중 = 사용중) / 보관(그 밖). Claude가 검수해서 바로 적용하고, 사용자는 적용된 것 중 마음에 안 드는 것을 수정 요청 (사용자 결정 11/12)
export const applied = a => a.status === '사용중';
export const shownStatus = a => applied(a) ? '적용' : '보관';
export async function libraryView(ctx, rest) {
  const { assets, chars } = await loadAll(ctx);
  const f = { status: rest[0] || '적용', kind: rest[1] || '', owner: rest[2] || '' };
  const go = patch => { const n = { ...f, ...patch }; ctx.go(`#/art/list/${n.status}/${n.kind}/${n.owner}`); };
  const sel = (opts, val, key) => {
    const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    s.onchange = () => go({ [key]: s.value });
    return s;
  };
  const reworking = a => a.rework && ['요청', '요청됨'].includes(a.rework.status);
  const TABS = [['적용', applied, '게임에 적용된 그림'], ['보관', a => !applied(a), '게임에 쓰지 않는 그림 (예전 그림·고르지 않은 후보·참고 자료)'], ['수정요청', reworking, '다시 만들어 달라고 요청한 그림'], ['전체', () => true, '']];
  const cur = TABS.find(t => t[0] === f.status) || TABS[0];
  const shown = assets.filter(a => cur[1](a) && (!f.kind || a.kind === f.kind) && (!f.owner || a.owner === f.owner || a.owners?.includes(f.owner)));
  return h('div', {},
    h('div', { class: 'card row' },
      h('div', { class: 'tabs', style: { margin: 0, border: 0 } }, TABS.map(([s, fn, tip]) => h('a', { href: '#', class: s === cur[0] ? 'on' : '', title: tip, onclick: e => { e.preventDefault(); go({ status: s }); } }, `${s === '수정요청' ? '↺ 수정 요청 중' : s} (${assets.filter(fn).length})`))),
      h('span', { class: 'spacer' }),
      sel([['', '모든 종류'], ...Object.entries(KINDS)], f.kind, 'kind'),
      sel([['', '모든 인물'], ...chars.characters.map(c => [c.id, c.name])], f.owner, 'owner')),
    cur[0] === '적용' && h('p', { class: 'muted', style: { fontSize: '13px' } }, '게임에 쓰고 있는 그림이에요. 마음에 안 드는 그림을 눌러 "↺ 수정 요청"을 남기면 Claude가 다시 만들어 바꿔 넣어요.'),
    shown.length ? h('div', { class: 'card' }, assetGrid(ctx, shown, chars)) : h('div', { class: 'card empty' }, '조건에 맞는 그림이 없어요.'));
}

function assetGrid(ctx, list, chars) {
  return h('div', { class: 'thumb-grid big' }, list.map(a => h('div', { class: 'thumb-card', onclick: () => assetDetail(ctx, a, chars) },
    thumb(ctx.store, a.file),
    h('div', { class: 'cap' }, h('span', { class: `badge ${applied(a) ? 'ok' : ''}` }, shownStatus(a)), a.rework && ['요청', '요청됨'].includes(a.rework.status) && h('span', { class: 'badge danger', title: a.rework.comment }, '↺ 재작업'), ' ', a.id),
    h('div', { class: 'cap muted' }, `${KINDS[a.kind] || a.kind}${a.owner ? ' · ' + (chars.characters.find(c => c.id === a.owner)?.name || a.owner) : ''} · ${a.createdBy || ''}`))));
}

async function assetDetail(ctx, a, chars) {
  const refresh = () => { closeModal(); window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const setStatus = async (status, msg) => {
    await updateRegistry(ctx.store, list => { const x = list.find(y => y.id === a.id && y.file === a.file); if (x) { x.status = status; x.updatedAt = new Date().toISOString().slice(0, 10); } }, `그림 ${msg}: ${a.id}`);
    toast(`${msg}했어요.`);
    ctx.refreshBadges();
    refresh();
  };
  const kindSel = h('select', {}, Object.entries(KINDS).map(([v, l]) => h('option', { value: v, selected: v === a.kind }, l)));
  const ownerSel = h('select', {}, [['', '(없음)'], ...chars.characters.map(c => [c.id, c.name])].map(([v, l]) => h('option', { value: v, selected: v === (a.owner || '') }, l)));
  const note = h('textarea', { rows: 2 }); note.value = a.note || '';
  const saveInfo = async () => {
    await updateRegistry(ctx.store, list => {
      const x = list.find(y => y.id === a.id && y.file === a.file);
      if (!x) return;
      x.kind = kindSel.value; x.note = note.value;
      if (ownerSel.value) x.owner = ownerSel.value; else delete x.owner;
    }, `그림 정보 수정: ${a.id}`);
    toast('정보를 저장했어요.'); refresh();
  };

  // 움직이는 그림: 게임이 실제로 쓰는 방식 그대로 보여 준다 (칸 나누기 입력 없음, 요청 req_mwczu4dzi0uz)
  const spriteBox = h('div');
  if (SPRITE_KINDS.includes(a.kind)) {
    const { data: sp } = await ctx.store.getJSON(SPRITES, { sheets: {} });
    const pv = appliedPreview(ctx.store, sp, a.file);
    spriteBox.append(h('div', { class: 'card', style: { marginTop: '10px' } },
      h('b', {}, pv ? '게임에서 보이는 모습' : '움직임 미리보기'),
      pv || h('p', { class: 'muted' }, a.status === '사용중' ? '게임 자료(sprites.json)에서 이 그림을 찾지 못했어요.' : '지금 게임에서 쓰지 않는 그림이라 움직임 미리보기가 없어요.')));
  }

  const portraitAssign = a.kind === 'portrait' && a.owner ? h('div', { class: 'row', style: { marginTop: '8px' } }, (() => {
    const emoSel = h('select', {}, Object.entries(chars.emotions || {}).map(([v, l]) => h('option', { value: v }, l)));
    return [h('span', {}, '표정 초상화로 지정:'), emoSel, h('button', { class: 'btn small primary', onclick: async () => {
      await ctx.store.updateJSON(CHARS, d => { const c = d.characters.find(x => x.id === a.owner); if (c) (c.portraits ||= {})[emoSel.value] = a.file; return d; }, `초상화 지정: ${a.owner} ${emoSel.value}`);
      await updateRegistry(ctx.store, list => { const x = list.find(y => y.id === a.id && y.file === a.file); if (x) x.status = '사용중'; }, `그림 사용 시작: ${a.id}`);
      toast('초상화로 지정했어요.'); refresh();
    } }, '지정')];
  })()) : null;

  const del = async () => {
    if (!await confirmBox('이 그림을 보관함과 저장소에서 완전히 지울까요? (변경 기록에는 남아요)', '지우기')) return;
    try {
      const f = await ctx.store.list(a.file.split('/').slice(0, -1).join('/'));
      const me = f.find(x => x.path === a.file);
      if (me) await ctx.store.remove(a.file, me.sha, `그림 삭제: ${a.id}`);
    } catch (e) { toast(e.message, true); }
    await updateRegistry(ctx.store, list => { const i = list.findIndex(y => y.id === a.id && y.file === a.file); if (i >= 0) list.splice(i, 1); }, `그림 등록 삭제: ${a.id}`);
    toast('지웠어요.'); refresh();
  };

  // 어떤 상태의 그림이든 의견과 함께 다시 만들어 달라고 요청 → Claude가 Codex 작업으로 옮긴다
  const rework = async () => {
    const ta = h('textarea', { rows: 4, placeholder: '무엇이 마음에 안 드나요? 예) 얼굴이 너무 어려 보여요 / 문이 작아서 들어갈 수 없을 것 같아요 / 색이 다른 그림과 안 어울려요' });
    const ok = await modal(`"${a.id}" 수정 요청`, h('div', {},
      h('label', { class: 'field' }, h('span', {}, '의견'), ta),
      h('p', { class: 'muted', style: { fontSize: '12px', margin: 0 } }, '저장하면 Claude가 확인해서 Codex에게 다시 그려 달라고 맡겨요. 새 그림이 오기 전까지 지금 그림은 그대로 써요.')),
      [{ label: '취소', value: false }, { label: '요청하기', value: true, primary: true }]);
    if (!ok) return;
    if (!ta.value.trim()) return toast('의견을 한 줄이라도 적어 주세요.', true);
    const now = new Date().toISOString();
    try {
      await updateRegistry(ctx.store, list => { const x = list.find(y => y.id === a.id && y.file === a.file); if (x) x.rework = { comment: ta.value.trim(), status: '요청', at: now }; }, `그림 다시 만들기 요청: ${a.id}`);
      await ctx.store.updateJSON('data/requests.json', d => {
        (d.requests ||= []).unshift({ id: 'req_' + Date.now().toString(36), room: 'character', kind: 'rework', assetId: a.id, file: a.file, title: `그림 다시 만들기: ${a.id}`, body: ta.value.trim(), status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' });
        return d;
      }, `요청 추가: 그림 다시 만들기 ${a.id}`, { requests: [] });
      toast('수정을 요청했어요.'); ctx.refreshBadges(); refresh();
    } catch (e) { toast(e.message, true); }
  };
  const rw = a.rework;
  const reworkInfo = rw && h('div', { class: 'resp', style: { marginTop: '8px' } },
    h('b', {}, `↺ 다시 만들기 ${rw.status}${rw.codexTask ? ' · ' + rw.codexTask : ''}: `), rw.comment,
    rw.response && h('div', { class: 'muted', style: { marginTop: '4px' } }, '🧩 Claude: ', rw.response));

  const actions = h('div', { class: 'row', style: { marginTop: '10px' } },
    h('button', { class: 'btn', onclick: rework, title: '마음에 안 들면 의견과 함께 다시 만들어 달라고 요청해요' }, '↺ 수정 요청'),
    h('span', { class: 'spacer' }),
    !applied(a) && h('button', { class: 'btn danger', onclick: del }, '삭제'));

  const extra = h('div', {},
    h('div', { class: 'row', style: { marginTop: '8px', fontSize: '13px' } },
      h('span', { class: `badge ${applied(a) ? 'ok' : ''}` }, shownStatus(a)),
      h('span', { class: 'muted' }, `${a.createdBy || ''} · ${a.createdAt || ''}`)),
    a.note && h('p', { style: { fontSize: '14px', margin: '6px 0' } }, a.note),
    reworkInfo, actions, portraitAssign, spriteBox,
    h('details', { style: { marginTop: '10px' } }, h('summary', {}, '정보 수정'),
      h('label', { class: 'field' }, h('span', {}, '종류'), kindSel),
      h('label', { class: 'field' }, h('span', {}, '인물'), ownerSel),
      h('label', { class: 'field' }, h('span', {}, '메모'), note),
      h('button', { class: 'btn small primary', onclick: saveInfo }, '정보 저장')));
  await viewImage(ctx.store, a.file, a.id, extra);
}

// ---------- upload ----------
export function uploadView(ctx) {
  const items = [];
  let mode = 'asset';
  const folderIn = h('input', { placeholder: '폴더 이름 (예: portraits, tiles_v1)', value: 'portraits' });
  const noteIn = h('textarea', { rows: 2, placeholder: 'Claude에게 할 말 (예: 드라이브 01-게임사용본 원본이야. 표정별로 잘라서 교체해 줘)' });
  const modeBox = h('div', { class: 'card' });
  const drawMode = () => {
    modeBox.replaceChildren(
      h('div', { class: 'tool-row' },
        h('button', { class: `btn small ${mode === 'asset' ? 'primary' : ''}`, onclick: () => { mode = 'asset'; drawMode(); draw(); } }, '바로 쓸 그림 (후보로 등록)'),
        h('button', { class: `btn small ${mode === 'source' ? 'primary' : ''}`, onclick: () => { mode = 'source'; drawMode(); draw(); } }, 'Claude가 가공할 원본')),
      mode === 'source'
        ? h('div', { style: { marginTop: '10px' } },
            h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 8px' } }, '여러 표정이 한 장에 있는 시트, 드라이브의 원본처럼 Claude가 잘라내거나 정리해야 하는 파일이에요. 저장소의 assets/_source/폴더이름/ 에 그대로 보관되고, 요청함에 가공 요청이 자동으로 남아요.'),
            h('label', { class: 'field' }, h('span', {}, '폴더 이름'), folderIn),
            h('label', { class: 'field' }, h('span', {}, 'Claude에게 할 말'), noteIn))
        : h('p', { class: 'muted', style: { fontSize: '13px', margin: '8px 0 0' } }, '게임에 쓸 그림이에요. 올리면 Claude가 확인해서 게임에 적용해요.'));
  };
  const list = h('div', { class: 'upload-list' });
  const btn = h('button', { class: 'btn primary', disabled: true }, '올리기');
  const status = h('span', { class: 'muted' });
  let chars = { characters: [] };
  ctx.store.getJSON(CHARS, { characters: [] }).then(r => { chars = r.data; draw(); });

  const guessKind = name => {
    const n = name.toLowerCase();
    if (/portrait|초상/.test(n)) return 'portrait';
    if (/walk|field|걷기|필드/.test(n)) return 'field';
    if (/battle|attack|전투/.test(n)) return 'battle';
    if (/cutin|컷인/.test(n)) return 'cutin';
    if (/grass|dirt|stone|cobble|water|sand|floor|texture|재질/.test(n)) return 'tile';
    if (/decor|장식/.test(n)) return 'decor';
    if (/tree|rock|bush|log|stump|house|object|나무|바위/.test(n)) return 'object';
    if (/dream|cg|event|일러스트/.test(n)) return 'event';
    return 'reference';
  };
  const guessOwner = name => chars.characters.find(c => name.toLowerCase().includes(c.id))?.id || '';

  const add = files => {
    for (const file of files) {
      if (mode === 'asset' && !file.type.startsWith('image/')) { toast(`${file.name}: 그림 파일만 올릴 수 있어요. (zip 등은 "Claude가 가공할 원본"으로)`, true); continue; }
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: 25MB보다 커요.`, true); continue; }
      items.push({ file, kind: guessKind(file.name), owner: guessOwner(file.name), note: '', url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    draw();
    if (mode === 'asset') findDuplicates(ctx.store, items).then(draw).catch(() => {});
  };
  const draw = () => {
    btn.disabled = !items.length;
    list.replaceChildren(...items.map((it, i) => {
      const kind = h('select', {}, Object.entries(KINDS).map(([v, l]) => h('option', { value: v, selected: v === it.kind }, l)));
      kind.onchange = () => it.kind = kind.value;
      const owner = h('select', {}, [['', '(인물 없음)'], ...chars.characters.map(c => [c.id, c.name])].map(([v, l]) => h('option', { value: v, selected: v === it.owner }, l)));
      owner.onchange = () => it.owner = owner.value;
      const note = h('input', { placeholder: '메모 (선택)', value: it.note });
      note.oninput = () => it.note = note.value;
      return h('div', { class: 'upload-item' },
        h('div', { class: 'thumb checker' }, it.url ? h('img', { src: it.url }) : h('span', { class: 'muted' }, '📦')),
        h('div', { class: 'upload-fields' },
          h('div', { class: 'row' }, h('b', {}, it.file.name), h('span', { class: 'muted' }, `${(it.file.size / 1024 / 1024).toFixed(1)}MB`),
            it.dupOf && h('span', { class: 'badge danger' }, `이미 있는 그림: ${it.dupOf.id} (${it.dupOf.status}) → 건너뜀`),
            it.dupInBatch && h('span', { class: 'badge danger' }, `같은 그림을 두 번 넣음 (${it.dupInBatch}) → 건너뜀`)),
          mode === 'asset' && h('div', { class: 'row' }, kind, owner, note)),
        h('button', { class: 'btn small danger', onclick: () => { items.splice(i, 1); draw(); } }, '빼기'));
    }));
  };
  btn.onclick = async () => {
    btn.disabled = true;
    if (mode === 'source') {
      const folder = (folderIn.value.trim() || 'misc').toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      try {
        const { dir, saved } = await uploadSources(ctx.store, items.map(i => i.file), folder, noteIn.value.trim(), (i, n, name) => status.textContent = `올리는 중 ${i + 1}/${n}: ${name}`);
        status.textContent = '';
        toast(`${saved.length}개를 ${dir}/ 에 올리고 요청함에 가공 요청을 남겼어요. Claude에게 "요청함 처리해줘"라고 말해 주세요.`);
        ctx.refreshBadges();
        ctx.go('#/requests');
      } catch (e) { toast(e.message, true); btn.disabled = false; status.textContent = ''; }
      return;
    }
    try {
      const total = items.length;
      const added = await uploadAssets(ctx.store, items, (i, n, name) => status.textContent = `올리는 중 ${i + 1}/${n}: ${name}`);
      status.textContent = '';
      const skipped = total - added.length;
      toast(`${added.length}장을 올렸어요. Claude가 확인해서 게임에 적용하거나 보관해요.${skipped ? ` 이미 있는 그림 ${skipped}장은 건너뛰었어요.` : ''}`);
      ctx.refreshBadges();
      ctx.go('#/art/list/보관');
    } catch (e) { toast(e.message, true); btn.disabled = false; status.textContent = ''; }
  };

  const input = h('input', { type: 'file', multiple: true, style: { display: 'none' } });
  input.onchange = () => { add(input.files); input.value = ''; };
  const zone = h('div', { class: 'dropzone', onclick: () => input.click() },
    h('div', { style: { fontSize: '28px' } }, '🖼'),
    h('b', {}, '여기에 그림 파일을 끌어다 놓거나 눌러서 고르세요'),
    h('div', { class: 'muted' }, '여러 개를 한 번에 올릴 수 있어요. 원본 모드에서는 zip 파일도 돼요.'));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); add(e.dataTransfer.files); });

  drawMode();
  return h('div', {}, modeBox, h('div', { class: 'card' }, zone, input), h('div', { class: 'card' }, list, h('div', { class: 'row', style: { marginTop: '10px' } }, btn, status)));
}
