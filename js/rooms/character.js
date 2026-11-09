// Character room: people (portraits by expression), the image library with approval, and bulk upload.
import { h, toast, modal, confirmBox, closeModal } from '../ui.js';
import { requestPanel } from './requests.js';
import {
  KINDS, STATUSES, statusClass, CHARS, loadRegistry, updateRegistry, uploadAssets, thumb, spritePlayer, viewImage,
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
  const tab = ['people', 'library', 'upload', 'requests'].includes(rest[0]) ? rest[0] : 'people';
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '🧑 캐릭터룸'),
    h('p', { class: 'sub' }, '인물별 초상화와 스프라이트, 모든 그림의 후보·승인·사용 상태를 관리해요. Codex나 Claude가 만든 그림도 여기서 확인하고 승인해요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/character/people', class: tab === 'people' ? 'on' : '' }, '인물'),
      h('a', { href: '#/character/library', class: tab === 'library' ? 'on' : '' }, '그림 보관함'),
      h('a', { href: '#/character/upload', class: tab === 'upload' ? 'on' : '' }, '그림 올리기'),
      h('a', { href: '#/character/requests', class: tab === 'requests' ? 'on' : '' }, '요청함')));
  if (tab === 'requests') page.append(requestPanel(ctx, 'character'));
  else if (tab === 'upload') page.append(uploadView(ctx));
  else if (tab === 'library') page.append(await libraryView(ctx, rest.slice(1)));
  else page.append(await peopleView(ctx, rest[1]));
  return page;
}

async function loadAll(ctx) {
  const [reg, ch] = await Promise.all([loadRegistry(ctx.store), ctx.store.getJSON(CHARS, { characters: [] })]);
  return { assets: reg, chars: ch.data };
}

// ---------- people ----------
async function peopleView(ctx, id) {
  const { assets, chars } = await loadAll(ctx);
  const list = chars.characters;
  const cur = list.find(c => c.id === id) || list[0];
  const side = h('div', { class: 'card tree people-list' }, list.map(c => {
    const file = c.portraits?.normal || Object.values(c.portraits || {})[0];
    const n = assets.filter(a => a.owner === c.id && a.status === '후보').length;
    return h('a', { href: `#/character/people/${c.id}`, class: c.id === cur.id ? 'on' : '' },
      file ? thumb(ctx.store, file, 'avatar') : h('div', { class: 'avatar' }, c.name.slice(0, 1)),
      h('span', { class: 'name' }, c.name, c.displayName && h('small', { class: 'muted' }, ` (${c.displayName})`)),
      n ? h('span', { class: 'badge warn' }, n) : null);
  }));
  return h('div', { class: 'split' }, side, personPage(ctx, cur, chars, assets));
}

function personPage(ctx, c, chars, assets) {
  const emotions = chars.emotions || {};
  const mine = assets.filter(a => a.owner === c.id);
  const portraitGrid = h('div', { class: 'thumb-grid' },
    Object.entries(c.portraits || {}).map(([emo, file]) => h('div', { class: 'thumb-card', onclick: () => viewImage(ctx.store, file, `${c.name} · ${emotions[emo] || emo}`) },
      thumb(ctx.store, file), h('div', { class: 'cap' }, emotions[emo] || emo))));
  const byKind = {};
  for (const a of mine) (byKind[a.kind] ||= []).push(a);
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, c.name), c.displayName && h('span', { class: 'muted' }, `대사창 표시: ${c.displayName}`), h('span', { class: 'muted', style: { marginLeft: 'auto', fontSize: '12px' } }, `id: ${c.id}`)),
      h('p', { class: 'muted', style: { fontSize: '13px' } }, '인물 설정은 시나리오룸 → 등장인물 문서에 있어요.')),
    h('div', { class: 'card' },
      h('h2', {}, '대화 초상화 (표정별)'),
      Object.keys(c.portraits || {}).length ? portraitGrid : h('div', { class: 'empty' }, '아직 초상화가 없어요. 그림 올리기에서 올리고 승인한 뒤 "표정 초상화로 지정"을 눌러 주세요.'),
      h('p', { class: 'muted', style: { fontSize: '12px' } }, '지금은 이전 편집실의 작은 미리보기 그림이에요. 원본 크기 그림을 올리면 교체할 수 있어요.')),
    h('div', { class: 'card' },
      h('h2', {}, '이 인물의 등록 그림'),
      mine.length ? Object.entries(byKind).map(([k, arr]) => [h('h4', { class: 'muted' }, KINDS[k] || k), assetGrid(ctx, arr, chars)])
        : h('div', { class: 'empty' }, '등록된 그림이 없어요.')));
}

// ---------- library ----------
async function libraryView(ctx, rest) {
  const { assets, chars } = await loadAll(ctx);
  const f = { status: rest[0] || '후보', kind: rest[1] || '', owner: rest[2] || '' };
  const go = patch => { const n = { ...f, ...patch }; ctx.go(`#/character/library/${n.status}/${n.kind}/${n.owner}`); };
  const sel = (opts, val, key) => {
    const s = h('select', {}, opts.map(([v, l]) => h('option', { value: v, selected: v === val }, l)));
    s.onchange = () => go({ [key]: s.value });
    return s;
  };
  const counts = Object.fromEntries(STATUSES.map(s => [s, assets.filter(a => a.status === s).length]));
  const shown = assets.filter(a => (f.status === '전체' || a.status === f.status) && (!f.kind || a.kind === f.kind) && (!f.owner || a.owner === f.owner));
  return h('div', {},
    h('div', { class: 'card row' },
      h('div', { class: 'tabs', style: { margin: 0, border: 0 } }, [...STATUSES, '전체'].map(s => h('a', { href: '#', class: s === f.status ? 'on' : '', onclick: e => { e.preventDefault(); go({ status: s }); } }, s === '전체' ? `전체 (${assets.length})` : `${s} (${counts[s]})`))),
      h('span', { class: 'spacer' }),
      sel([['', '모든 종류'], ...Object.entries(KINDS)], f.kind, 'kind'),
      sel([['', '모든 인물'], ...chars.characters.map(c => [c.id, c.name])], f.owner, 'owner')),
    f.status === '후보' && shown.length > 1 && h('div', { class: 'card row' },
      h('span', {}, `보이는 후보 ${shown.length}장`),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!await confirmBox(`보이는 후보 ${shown.length}장을 모두 승인할까요? 표정이 정해진 초상화는 바로 교체돼요.`, '모두 승인')) return;
        try { const n = await approveAll(ctx, shown); toast(`${shown.length}장을 승인했어요${n ? ` (초상화 ${n}장 교체)` : ''}.`); ctx.refreshBadges(); window.dispatchEvent(new HashChangeEvent('hashchange')); }
        catch (e) { toast(e.message, true); }
      } }, '✔ 모두 승인')),
    shown.length ? h('div', { class: 'card' }, assetGrid(ctx, shown, chars)) : h('div', { class: 'card empty' }, f.status === '후보' ? '승인 대기 중인 그림이 없어요.' : '조건에 맞는 그림이 없어요.'));
}

function assetGrid(ctx, list, chars) {
  return h('div', { class: 'thumb-grid big' }, list.map(a => h('div', { class: 'thumb-card', onclick: () => assetDetail(ctx, a, chars) },
    thumb(ctx.store, a.file),
    h('div', { class: 'cap' }, h('span', { class: `badge ${statusClass[a.status] || ''}` }, a.status), ' ', a.id),
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

  // sprite preview for animation kinds
  let player = null;
  const spriteBox = h('div');
  if (SPRITE_KINDS.includes(a.kind)) {
    const url = await ctx.store.blobUrl(a.file);
    player = spritePlayer(url, a.frames || {});
    const num = (key, label, min = 1) => {
      const i = h('input', { type: 'number', min, value: player._cfg[key], style: { width: '64px' } });
      i.oninput = () => player._set({ [key]: Number(i.value) || min });
      return h('label', { class: 'row', style: { gap: '4px' } }, label, i);
    };
    const saveFrames = async () => {
      const { cols, rows, fps } = player._cfg;
      await updateRegistry(ctx.store, list => { const x = list.find(y => y.id === a.id && y.file === a.file); if (x) x.frames = { cols, rows, fps }; }, `스프라이트 칸 정보: ${a.id}`);
      toast('칸 나누기 정보를 저장했어요.');
    };
    spriteBox.append(h('div', { class: 'card', style: { marginTop: '10px' } },
      h('b', {}, '애니메이션 미리보기'),
      h('div', { class: 'checker', style: { minHeight: '120px' } }, player),
      h('div', { class: 'row' }, num('cols', '가로 칸'), num('rows', '세로 칸'), num('row', '재생 줄', 0), num('fps', '초당 프레임'), h('button', { class: 'btn small', onclick: saveFrames }, '칸 정보 저장'))));
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

  const actions = h('div', { class: 'row', style: { marginTop: '10px' } },
    a.status === '후보' && h('button', { class: 'btn primary', onclick: async () => { const n = await approveAll(ctx, [a]); toast(n ? '승인하고 초상화를 교체했어요.' : '승인했어요.'); ctx.refreshBadges(); refresh(); } }, '✔ 승인'),
    a.status !== '사용중' && a.status !== '후보' && h('button', { class: 'btn', onclick: () => setStatus('사용중', '사용 시작') }, '게임에 사용'),
    a.status !== '보관' && h('button', { class: 'btn', onclick: () => setStatus('보관', '보관') }, a.status === '후보' ? '반려(보관)' : '보관'),
    a.status === '보관' && h('button', { class: 'btn', onclick: () => setStatus('후보', '후보로 되돌리기') }, '후보로 되돌리기'),
    h('span', { class: 'spacer' }),
    h('button', { class: 'btn danger', onclick: del }, '삭제'));

  const extra = h('div', {},
    h('div', { class: 'row', style: { marginTop: '8px', fontSize: '13px' } },
      h('span', { class: `badge ${statusClass[a.status] || ''}` }, a.status),
      h('span', { class: 'muted' }, `${a.createdBy || ''} · ${a.createdAt || ''}`)),
    a.note && h('p', { style: { fontSize: '14px', margin: '6px 0' } }, a.note),
    actions, portraitAssign, spriteBox,
    h('details', { style: { marginTop: '10px' } }, h('summary', {}, '정보 수정'),
      h('label', { class: 'field' }, h('span', {}, '종류'), kindSel),
      h('label', { class: 'field' }, h('span', {}, '인물'), ownerSel),
      h('label', { class: 'field' }, h('span', {}, '메모'), note),
      h('button', { class: 'btn small primary', onclick: saveInfo }, '정보 저장')));
  await viewImage(ctx.store, a.file, a.id, extra);
  player?._stop();
}

// ---------- upload ----------
function uploadView(ctx) {
  const items = [];
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
      if (!file.type.startsWith('image/')) { toast(`${file.name}: 그림 파일만 올릴 수 있어요.`, true); continue; }
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name}: 25MB보다 커요.`, true); continue; }
      items.push({ file, kind: guessKind(file.name), owner: guessOwner(file.name), note: '', url: URL.createObjectURL(file) });
    }
    draw();
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
        h('div', { class: 'thumb checker' }, h('img', { src: it.url })),
        h('div', { class: 'upload-fields' },
          h('div', { class: 'row' }, h('b', {}, it.file.name), h('span', { class: 'muted' }, `${(it.file.size / 1024 / 1024).toFixed(1)}MB`)),
          h('div', { class: 'row' }, kind, owner, note)),
        h('button', { class: 'btn small danger', onclick: () => { items.splice(i, 1); draw(); } }, '빼기'));
    }));
  };
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const added = await uploadAssets(ctx.store, items, (i, n, name) => status.textContent = `올리는 중 ${i + 1}/${n}: ${name}`);
      status.textContent = '';
      toast(`${added.length}장을 후보로 올렸어요. 그림 보관함에서 승인할 수 있어요.`);
      ctx.refreshBadges();
      ctx.go('#/character/library/후보');
    } catch (e) { toast(e.message, true); btn.disabled = false; status.textContent = ''; }
  };

  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
  input.onchange = () => { add(input.files); input.value = ''; };
  const zone = h('div', { class: 'dropzone', onclick: () => input.click() },
    h('div', { style: { fontSize: '28px' } }, '🖼'),
    h('b', {}, '여기에 그림 파일을 끌어다 놓거나 눌러서 고르세요'),
    h('div', { class: 'muted' }, '여러 장을 한 번에 올릴 수 있어요. 올린 그림은 "후보"로 등록돼요.'));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('over'); add(e.dataTransfer.files); });

  return h('div', {}, h('div', { class: 'card' }, zone, input), h('div', { class: 'card' }, list, h('div', { class: 'row', style: { marginTop: '10px' } }, btn, status)));
}
