// Writer room: the story writer agent's proposals. Approve a scene to move it into the real story line.
import { h, toast, confirmBox, paged } from '../ui.js';
import { thumb, viewImage } from '../assets.js';
import { renderMarkdown } from '../md.js';

const FILE = 'data/story_proposals.json';
const CHARS = 'data/characters.json';
const CMD = {
  fade_out: '화면 암전', fade_in: '암전 해제', camera_pan: '카메라 이동', start_battle: '전투 시작', add_party: '동료 합류', play_se: '효과음', play_bgm: '배경음악', wait: '잠시 대기',
  title_motion: '타이틀 연출', flash: '화면 번쩍임', shake: '화면 흔들림', show_illustration: '일러스트 표시', hide_illustration: '일러스트 닫기', move_actor: '인물 이동',
};
const TABS = [['open', '새 제안', p => !p.status || p.status === '제안'], ['hold', '보류·의견 보냄', p => p.status === '보류'], ['done', '편입됨', p => p.status === '편입됨'], ['no', '반려', p => p.status === '반려']];
const md = t => renderMarkdown(t || '');

export async function render(ctx, rest) {
  const tab = TABS.find(t => t[0] === rest[0]) ? rest[0] : 'open';
  const [{ data }, { data: chars }] = await Promise.all([ctx.store.getJSON(FILE, { proposals: [] }), ctx.store.getJSON(CHARS, { characters: [] })]);
  const all = data.proposals || [];
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '✍️ 작가 제안'),
    h('p', { class: 'sub' }, '스토리 작가가 다음 이야기를 제안해요. 장면마다 [승인]을 누르면 정식 스토리(스토리룸)로 옮겨져요. 마음에 안 드는 점은 의견으로 남기면 작가가 고쳐서 다시 제안해요.'),
    h('div', { class: 'tabs' }, TABS.map(([id, label, f]) => h('a', { href: `#/writer/${id}`, class: tab === id ? 'on' : '' }, `${label} (${all.filter(f).length})`))));
  const shown = all.filter(TABS.find(t => t[0] === tab)[2]);
  if (!shown.length) page.append(h('div', { class: 'card empty' }, tab === 'open' ? '아직 새 제안이 없어요. 작가가 곧 올릴 거예요.' : '해당하는 제안이 없어요.'));
  if (shown.length) page.append(paged(shown, p => card(ctx, p, chars), { key: 'writer-' + tab, size: 5 }));
  return page;
}

function speakerName(chars, p, id) {
  const c = chars.characters?.find(x => x.id === id) || chars.extraSpeakers?.find(x => x.id === id) || p.newElements?.characters?.find(x => x.id === id);
  return c ? (c.displayName || c.name) : id;
}

function stepView(chars, p, st) {
  if (st.kind === 'line') return h('div', { class: 'wp-line' }, h('b', {}, speakerName(chars, p, st.speaker)), st.emotion && h('span', { class: 'muted' }, ` (${chars.emotions?.[st.emotion] || st.emotion})`), ': ', st.text);
  if (st.kind === 'direction') return h('div', { class: 'wp-dir' }, st.text);
  if (st.kind === 'cmd') return h('div', { class: 'wp-cmd' }, `🎬 ${CMD[st.op] || st.op}`, st.args && Object.keys(st.args).length ? ` ${JSON.stringify(st.args)}` : '');
  return h('div', { class: 'muted' }, JSON.stringify(st));
}

function elements(p) {
  const e = p.newElements || {};
  const groups = [['characters', '새 인물'], ['places', '새 장소·마을'], ['npcs', 'NPC'], ['terrain', '지형·맵'], ['items', '물건·설정']];
  const parts = groups.filter(([k]) => e[k]?.length).map(([k, label]) => h('div', {}, h('b', {}, label), h('ul', {}, e[k].map(x => h('li', {}, typeof x === 'string' ? x : [h('b', {}, x.name || x.id), x.desc ? ` — ${x.desc}` : ''])))));
  return parts.length ? h('div', { class: 'wp-elements' }, parts) : null;
}

// 작가가 Codex에 의뢰해 받은 그림 (이벤트 일러스트·디자인 시트 등)
function gallery(ctx, p) {
  const items = [];
  for (const [k, il] of Object.entries(p.illustrations || {})) {
    if (il.file) items.push({ file: il.file, cap: `🎞 ${il.title || k}` });
    else items.push({ wait: true, cap: `🎞 ${il.title || k} — ${il.request?.codexTask ? il.request.codexTask + ' ' : ''}그림 기다리는 중` });
  }
  for (const im of p.images || []) items.push({ file: im.file, cap: im.caption || im.file.split('/').pop() });
  if (!items.length) return null;
  return h('div', {}, h('h3', {}, `그림 (${items.length})`), h('div', { class: 'thumb-grid big' }, items.map(it => it.wait
    ? h('div', { class: 'thumb-card' }, h('div', { class: 'empty', style: { height: '110px' } }, '⏳'), h('div', { class: 'cap' }, it.cap))
    : h('div', { class: 'thumb-card', onclick: () => viewImage(ctx.store, it.file, it.cap) }, thumb(ctx.store, it.file), h('div', { class: 'cap' }, it.cap)))));
}

function card(ctx, p, chars) {
  const target = p.targetFile || 'data/story/chapter1.json';
  const comment = h('textarea', { rows: 2, placeholder: '작가에게 할 말 (예: 미레트가 너무 쉽게 따라와요. 이유가 더 있어야 해요 / 이 인물 좋아요, 더 키워 주세요)' });
  const refresh = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const setProposal = (patch, msg) => ctx.store.updateJSON(FILE, d => {
    const x = (d.proposals || []).find(y => y.id === p.id);
    if (x) patch(x);
    return d;
  }, msg, { proposals: [] });

  const approveScene = async sc => {
    if (!await confirmBox(`"${sc.title}" 장면을 정식 스토리(${target.split('/').pop()})로 옮길까요? 스토리룸에서 바로 고칠 수 있어요.`, '승인하고 옮기기')) return;
    try {
      const now = new Date().toISOString();
      await ctx.store.updateJSON(target, d => {
        d.scenes ||= {}; d.flow ||= [];
        let id = sc.id;
        while (d.scenes[id]) id = `${sc.id}_${Math.random().toString(36).slice(2, 5)}`;
        // 장면이 쓰는 일러스트(show_illustration)를 정식 스토리의 illustrations로 함께 옮김
        const keys = (sc.steps || []).filter(st => st.kind === 'cmd' && st.op === 'show_illustration').map(st => st.args?.key || st.args?.id).filter(Boolean);
        d.illustrations ||= {};
        for (const k of keys) if (p.illustrations?.[k] && !d.illustrations[k]) {
          const il = p.illustrations[k];
          d.illustrations[k] = { title: il.title || k, ...(il.file ? { file: il.file } : {}), ...(il.request ? { request: il.request } : {}), fromProposal: p.id };
        }
        d.scenes[id] = { ...sc, id, status: '초안', note: `${sc.note || ''} [작가 제안 ${p.id}에서 승인 ${now.slice(0, 10)}]`.trim(), fromProposal: p.id };
        if (!d.flow.some(f => f.id === id)) d.flow.push({ kind: 'scene', id });
        return d;
      }, `작가 제안 편입: ${p.id} ${sc.title}`, { id: target.split('/').pop().replace('.json', ''), title: p.chapterTitle || p.chapter || '새 장', version: 1, illustrations: {}, flow: [], scenes: {}, objectives: {} });
      // 장면에 나오는 새 인물을 화자 목록(characters.json extraSpeakers)에 추가 — 스토리룸에서 이름이 바로 보이게
      const used = new Set((sc.steps || []).filter(st => st.kind === 'line').map(st => st.speaker));
      const fresh = (p.newElements?.characters || []).filter(c => c.id && used.has(c.id));
      if (fresh.length) await ctx.store.updateJSON(CHARS, d => {
        d.extraSpeakers ||= [];
        for (const c of fresh) if (!d.characters?.some(x => x.id === c.id) && !d.extraSpeakers.some(x => x.id === c.id)) d.extraSpeakers.push({ id: c.id, name: c.name || c.id });
        return d;
      }, `새 화자 추가 (작가 제안 ${p.id})`);
      await setProposal(x => {
        const s = x.scenes.find(y => y.id === sc.id);
        if (s) { s.approved = true; s.approvedAt = now; }
        if (x.scenes.every(y => y.approved)) x.status = '편입됨';
      }, `작가 제안 장면 승인: ${p.id} ${sc.id}`);
      toast('정식 스토리로 옮겼어요. 스토리룸에서 확인하세요.');
      refresh();
    } catch (e) { toast(e.message, true); }
  };

  const send = async status => {
    const text = comment.value.trim();
    if (status === '보류' && !text) return toast('작가에게 할 말을 적어 주세요.', true);
    try {
      await setProposal(x => {
        if (text) (x.feedback ||= []).push({ text, at: new Date().toISOString(), by: '사용자' });
        x.status = status;
      }, `작가 제안 ${status}: ${p.id}`);
      toast(status === '반려' ? '반려했어요.' : '의견을 보냈어요. 작가가 고쳐서 다시 제안해요.');
      refresh();
    } catch (e) { toast(e.message, true); }
  };

  const scenes = (p.scenes || []).map(sc => h('details', { class: 'wp-scene', open: !sc.approved },
    h('summary', {}, h('b', {}, sc.title), sc.location && h('span', { class: 'muted' }, ` · ${sc.location}`), ' ',
      sc.approved ? h('span', { class: 'badge ok' }, '✔ 편입됨') : null),
    sc.note && h('p', { class: 'muted', style: { fontSize: '13px' } }, sc.note),
    h('div', { class: 'wp-steps' }, (sc.steps || []).map(st => stepView(chars, p, st))),
    !sc.approved && h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn small primary', onclick: () => approveScene(sc) }, '✔ 이 장면 승인 → 정식 스토리로'))));

  return h('div', { class: 'card writer-card' },
    h('div', { class: 'row' }, h('h2', { style: { margin: 0 } }, `${p.id} · ${p.title}`), p.chapter && h('span', { class: 'badge info' }, p.chapter),
      h('span', { class: 'spacer' }), h('span', { class: 'muted', style: { fontSize: '12px' } }, `${p.createdBy || '스토리 작가'} · ${String(p.createdAt || '').slice(0, 10)}`)),
    p.logline && h('p', { style: { fontSize: '16px', fontWeight: 600 } }, p.logline),
    p.summary && h('div', { class: 'md' }, h('div', { html: md(p.summary) })),
    h('div', { class: 'wp-grid' },
      p.rationale && h('div', {}, h('b', {}, '왜 이 이야기인가 (당위성)'), h('div', { html: md(p.rationale) })),
      p.links && h('div', {}, h('b', {}, '앞 이야기와의 연결'), h('div', { html: md(p.links) })),
      p.inspirations?.length && h('div', {}, h('b', {}, '영감'), h('ul', {}, p.inspirations.map(x => h('li', {}, x))))),
    elements(p),
    gallery(ctx, p),
    p.feedback?.length && h('div', { class: 'resp wp-feedback' }, p.feedback.map(f => h('div', {}, h('b', {}, f.by === '작가' ? '✍️ 작가: ' : '💬 의견: '), f.text, h('span', { class: 'muted', style: { fontSize: '11px' } }, ` ${String(f.at || '').slice(0, 10)}`)))),
    h('h3', {}, `장면 (${(p.scenes || []).length})`), scenes,
    p.status !== '편입됨' && p.status !== '반려' && h('div', { class: 'wp-actions' }, comment,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => send('보류') }, '💬 의견 보내기 (고쳐서 다시)'),
        h('button', { class: 'btn small danger', onclick: async () => { if (await confirmBox('이 제안을 반려할까요? (의견이 있으면 같이 남아요)', '반려')) send('반려'); } }, '반려'))));
}
