// Decisions room: Claude's proposals as clickable choices, with a comment box per item.
import { h, toast, fmtDate, fill, paged, newestFirst } from '../ui.js';
import { renderMarkdown } from '../md.js';
import { imageStrip, thumb, viewImage } from '../assets.js';
import { openAnnotator, uploadMarks, marksRow } from '../annotate.js';

const FILE = 'data/decisions.json';
const inline = t => renderMarkdown(t || '').replace(/^<p>|<\/p>$/g, '');

export async function render(ctx, rest) {
  const tab = ['sent', 'done'].includes(rest[0]) ? rest[0] : 'open';
  const { data } = await ctx.store.getJSON(FILE, { decisions: [] });
  const all = newestFirst(data.decisions || []);
  const open = all.filter(d => d.status === '대기');
  const sent = all.filter(d => d.status === '답변됨');
  const done = all.filter(d => d.status === '결정됨');
  const list = h('div', {});
  const page = h('div', { class: 'page' },
    h('h1', {}, '🗳 결정'),
    h('p', { class: 'sub' }, 'Claude가 정리한 결정안이에요. 보기를 눌러 고르고, 하고 싶은 말은 의견 칸에 적은 뒤 제출해 주세요. 제출한 것은 Claude가 다음 작업 때 반영해요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/decide', class: tab === 'open' ? 'on' : '' }, `결정할 것 (${open.length})`),
      h('a', { href: '#/decide/sent', class: tab === 'sent' ? 'on' : '' }, `제출됨 · 반영 대기 (${sent.length})`),
      h('a', { href: '#/decide/done', class: tab === 'done' ? 'on' : '' }, `결정됨 (${done.length})`)),
    list);
  const shown = tab === 'done' ? done : tab === 'sent' ? sent : open;
  const emptyText = { open: '지금은 결정할 것이 없어요. 👍', sent: '제출했지만 아직 반영되지 않은 항목이 없어요.', done: '아직 결정된 항목이 없어요.' }[tab];
  if (tab === 'sent' && sent.length) list.append(h('p', { class: 'muted', style: { fontSize: '13px' } }, 'Claude에게 "결정 반영해줘"라고 말하면 반영하고 "결정됨"으로 옮겨요. 반영 전에는 "고치기"로 답을 바꿀 수 있어요.'));
  if (!shown.length) list.append(h('div', { class: 'card empty' }, emptyText));
  if (shown.length) list.append(paged(shown, d => card(ctx, d, tab), { key: 'decide-' + tab, size: 8 }));
  return page;
}

function sentMarks(ctx, paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  const box = h('div', { class: 'ann-marks' }, h('span', { class: 'muted', style: { fontSize: '12px' } }, `✏️ 보낸 표시 그림 ${paths.length}장`));
  for (const p of paths) ctx.store.blobUrl(p).then(u => box.append(h('span', { class: 'ann-mark' }, h('img', { src: u, onclick: () => viewImage(ctx.store, p, '보낸 표시 그림') })))).catch(() => {});
  return box;
}

function card(ctx, d, tab) {
  const prev = d.answer || {};
  const chosen = new Set(Array.isArray(prev.choice) ? prev.choice : prev.choice ? [prev.choice] : []);
  let editing = d.status === '대기';
  const el = h('div', { class: `card decision ${d.status}` });

  let typed = null;
  // 그림 위에 펜으로 표시 (사용자 11/23): 참고 그림·보기 그림마다 [✏️ 표시하기] → answer.images
  const marks = [];
  const pics = [...(d.images || []).map(x => typeof x === 'string' ? { file: x, name: '참고 그림' } : { file: x && x.file, name: (x && x.caption) || '참고 그림' }),
    ...d.options.filter(o => o.image).map(o => ({ file: o.image, name: `보기 ${o.key}` }))].filter(x => x.file);
  const annotate = async p => {
    try {
      const u = await ctx.store.blobUrl(p.file);
      const blob = await openAnnotator(u, `${d.id} ${p.name}`);
      if (blob) { marks.push({ blob, src: p.file }); if (!editing) editing = true; draw(); }
    } catch (e) { toast(`그림을 열지 못했어요 (${e.message})`, true); }
  };
  const draw = () => {
    const answered = d.status === '답변됨', decided = d.status === '결정됨';
    const optEls = d.options.map(o => {
      const on = chosen.has(o.key);
      return h('button', {
        class: `opt ${on ? 'on' : ''} ${o.recommended ? 'rec' : ''}`, disabled: !editing,
        onclick: () => {
          if (d.multi) on ? chosen.delete(o.key) : chosen.add(o.key);
          else { chosen.clear(); chosen.add(o.key); }
          draw();
        },
      },
        h('span', { class: `mark ${d.multi ? 'box' : 'radio'}` }, on ? (d.multi ? '✓' : '●') : ''),
        // 보기마다 그림 (일러스트 고르기 등): 그림을 누르면 크게, 나머지를 누르면 선택
        o.image && h('span', { class: 'opt-img', title: '눌러서 크게 보기', onclick: e => { e.stopPropagation(); viewImage(ctx.store, o.image, `${o.key}. ${o.label}`); } }, thumb(ctx.store, o.image)),
        h('span', { class: 'opt-body' },
          h('span', { class: 'opt-title' }, d.multi || /^[A-Z]$/.test(o.key) ? `${o.key}. ` : `${o.key} `, o.label, o.recommended && h('span', { class: 'rec-badge' }, '⭐ 추천')),
          o.desc && h('span', { class: 'opt-desc', html: inline(o.desc) })));
    });
    const comment = h('textarea', { rows: 3, placeholder: '내 의견 (선택) — 보기에 원하는 게 없거나, 덧붙이고 싶은 말을 적어 주세요', disabled: !editing });
    comment.value = typed ?? prev.comment ?? '';          // 보기를 눌러 다시 그려도 쓰던 의견이 지워지지 않게 (사용자 11/16)
    comment.addEventListener('input', () => { typed = comment.value; });
    const submit = async () => {
      if (!chosen.size && !comment.value.trim()) return toast('보기를 고르거나 의견을 적어 주세요.', true);
      try {
        const now = new Date().toISOString();
        const answer = { choice: d.multi ? [...chosen] : ([...chosen][0] || null), comment: comment.value.trim(), answeredAt: now };
        if (marks.length) { toast('표시한 그림을 올리는 중…'); answer.images = await uploadMarks(ctx.store, marks, d.id); marks.length = 0; }
        else if (Array.isArray(prev.images) && prev.images.length) answer.images = prev.images;
        await ctx.store.updateJSON(FILE, data => {
          const x = data.decisions.find(y => y.id === d.id);
          if (x) { x.answer = answer; x.status = '답변됨'; }
          return data;
        }, `결정 제출: ${d.id} ${d.title}`, { decisions: [] });
        Object.assign(d, { answer, status: '답변됨' });
        Object.assign(prev, answer);
        typed = null;
        editing = false;
        toast('제출했어요. "제출됨" 탭으로 옮겼어요.');
        ctx.refreshBadges();
        if (tab === 'open') { el.classList.add('leaving'); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 450); return; }
        el.className = 'card decision 답변됨';
        draw();
      } catch (e) { toast(`제출하지 못했어요 (${e.message}). 고른 보기와 의견은 그대로 있어요 — 다시 눌러 주세요.`, true); }
    };
    fill(el,
      h('div', { class: 'row' },
        h('span', { class: 'did' }, d.id),
        h('h2', { style: { margin: 0, flex: 1 } }, d.title),
        d.createdBy === '감독' && h('span', { class: 'badge draft' }, '🔍 감독 제안'),
        decided ? h('span', { class: 'badge ok' }, '결정됨') : answered ? h('span', { class: 'badge info' }, '제출함 · 반영 대기') : h('span', { class: 'badge warn' }, '대기')),
      d.context && h('p', { class: 'ctx', html: inline(d.context) }),
      imageStrip(ctx.store, d.images, d.title),
      d.link && h('a', { href: d.link, class: 'small-link' }, '관련 화면 열기 →'),
      h('div', { class: `opts ${d.options.some(o => o.image) ? 'with-img' : ''}` }, optEls),
      !decided && pics.length > 0 && h('div', { class: 'row ann-open-row', style: { flexWrap: 'wrap', marginTop: '8px' } }, ...pics.map(p => h('button', { class: 'btn small', title: '그림 위에 빨간 펜·연필로 표시해서 의견과 함께 보내요', onclick: () => annotate(p) }, `✏️ ${p.name}에 표시하기`))),
      marksRow(marks, draw, editing),
      !editing && sentMarks(ctx, prev.images),
      h('label', { class: 'field', style: { marginTop: '10px' } }, comment),
      decided && d.result && h('div', { class: 'resp' }, h('b', {}, '✅ 반영: '), d.result, d.decidedAt && h('span', { class: 'muted' }, ` · ${fmtDate(d.decidedAt)}`)),
      !decided && h('div', { class: 'row' },
        editing ? h('button', { class: 'btn primary', onclick: submit }, '제출')
          : h('button', { class: 'btn', onclick: () => { editing = true; draw(); } }, '고치기'),
        answered && !editing && prev.answeredAt && h('span', { class: 'muted', style: { fontSize: '12px' } }, `${fmtDate(prev.answeredAt)} 제출`)));
  };
  draw();
  return el;
}
