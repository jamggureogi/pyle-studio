// Decisions room: Claude's proposals as clickable choices, with a comment box per item.
import { h, toast, fmtDate, fill } from '../ui.js';
import { renderMarkdown } from '../md.js';

const FILE = 'data/decisions.json';
const inline = t => renderMarkdown(t || '').replace(/^<p>|<\/p>$/g, '');

export async function render(ctx, rest) {
  const tab = ['done'].includes(rest[0]) ? rest[0] : 'open';
  const { data } = await ctx.store.getJSON(FILE, { decisions: [] });
  const all = data.decisions || [];
  const open = all.filter(d => d.status !== '결정됨');
  const done = all.filter(d => d.status === '결정됨');
  const list = h('div', {});
  const page = h('div', { class: 'page' },
    h('h1', {}, '🗳 결정'),
    h('p', { class: 'sub' }, 'Claude가 정리한 결정안이에요. 보기를 눌러 고르고, 하고 싶은 말은 의견 칸에 적은 뒤 제출해 주세요. 제출한 것은 Claude가 다음 작업 때 반영해요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/decide', class: tab === 'open' ? 'on' : '' }, `결정할 것 (${open.length})`),
      h('a', { href: '#/decide/done', class: tab === 'done' ? 'on' : '' }, `결정됨 (${done.length})`)),
    list);
  const shown = tab === 'done' ? done : open;
  if (!shown.length) list.append(h('div', { class: 'card empty' }, tab === 'done' ? '아직 결정된 항목이 없어요.' : '지금은 결정할 것이 없어요. 👍'));
  for (const d of shown) list.append(card(ctx, d));
  return page;
}

function card(ctx, d) {
  const prev = d.answer || {};
  const chosen = new Set(Array.isArray(prev.choice) ? prev.choice : prev.choice ? [prev.choice] : []);
  let editing = d.status === '대기';
  const el = h('div', { class: `card decision ${d.status}` });

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
        h('span', { class: 'opt-body' },
          h('span', { class: 'opt-title' }, d.multi || /^[A-Z]$/.test(o.key) ? `${o.key}. ` : `${o.key} `, o.label, o.recommended && h('span', { class: 'rec-badge' }, '⭐ 추천')),
          o.desc && h('span', { class: 'opt-desc', html: inline(o.desc) })));
    });
    const comment = h('textarea', { rows: 3, placeholder: '내 의견 (선택) — 보기에 원하는 게 없거나, 덧붙이고 싶은 말을 적어 주세요', disabled: !editing });
    comment.value = prev.comment || '';
    const submit = async () => {
      if (!chosen.size && !comment.value.trim()) return toast('보기를 고르거나 의견을 적어 주세요.', true);
      try {
        const now = new Date().toISOString();
        const answer = { choice: d.multi ? [...chosen] : ([...chosen][0] || null), comment: comment.value.trim(), answeredAt: now };
        await ctx.store.updateJSON(FILE, data => {
          const x = data.decisions.find(y => y.id === d.id);
          if (x) { x.answer = answer; x.status = '답변됨'; }
          return data;
        }, `결정 제출: ${d.id} ${d.title}`, { decisions: [] });
        Object.assign(d, { answer, status: '답변됨' });
        Object.assign(prev, answer);
        editing = false;
        toast('제출했어요. Claude가 다음 작업 때 반영해요.');
        ctx.refreshBadges();
        el.className = 'card decision 답변됨';
        draw();
      } catch (e) { toast(e.message, true); }
    };
    fill(el,
      h('div', { class: 'row' },
        h('span', { class: 'did' }, d.id),
        h('h2', { style: { margin: 0, flex: 1 } }, d.title),
        decided ? h('span', { class: 'badge ok' }, '결정됨') : answered ? h('span', { class: 'badge info' }, '제출함 · 반영 대기') : h('span', { class: 'badge warn' }, '대기')),
      d.context && h('p', { class: 'ctx', html: inline(d.context) }),
      d.link && h('a', { href: d.link, class: 'small-link' }, '관련 화면 열기 →'),
      h('div', { class: 'opts' }, optEls),
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
