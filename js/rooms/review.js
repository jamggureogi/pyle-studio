// Review room: images Claude wants the user to look at, with feedback per image.
import { h, toast, fmtDate, fill } from '../ui.js';

const FILE = 'data/review.json';

let zoomEl = null;
function zoom(url) {
  if (!zoomEl) {
    zoomEl = h('div', { class: 'zoom', onclick: () => zoomEl.classList.remove('on') }, h('img'));
    document.body.append(zoomEl);
  }
  zoomEl.firstChild.src = url;
  zoomEl.classList.add('on');
}

export async function render(ctx, rest) {
  const tab = ['sent', 'done'].includes(rest[0]) ? rest[0] : 'open';
  const { data } = await ctx.store.getJSON(FILE, { items: [] });
  const all = data.items || [];
  const groups = { open: all.filter(x => x.status === '확인 대기'), sent: all.filter(x => x.status === '피드백'), done: all.filter(x => x.status === '반영됨') };
  const list = h('div', { class: 'review-list' });
  const shown = groups[tab];
  if (!shown.length) list.append(h('div', { class: 'card empty' }, { open: '지금 확인할 그림이 없어요.', sent: '보낸 피드백이 없어요.', done: '반영된 항목이 없어요.' }[tab]));
  for (const it of shown) list.append(card(ctx, it, tab));
  return h('div', { class: 'page' },
    h('h1', {}, '🖼 확인'),
    h('p', { class: 'sub' }, 'Claude가 작업 결과를 그림으로 보여드리는 곳이에요. 그림을 누르면 크게 보여요. 그림마다 피드백을 남기고 제출하면 Claude가 다음 작업 때 반영해요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/review', class: tab === 'open' ? 'on' : '' }, `확인할 것 (${groups.open.length})`),
      h('a', { href: '#/review/sent', class: tab === 'sent' ? 'on' : '' }, `피드백 보냄 · 반영 대기 (${groups.sent.length})`),
      h('a', { href: '#/review/done', class: tab === 'done' ? 'on' : '' }, `반영됨 (${groups.done.length})`)),
    list);
}

function card(ctx, it, tab) {
  const el = h('div', { class: 'card review-card' });
  const fb = it.feedback || {};
  let verdict = fb.verdict || null;
  let editing = it.status === '확인 대기';
  const imgBox = h('div', { class: 'review-img' }, h('span', { class: 'muted' }, '불러오는 중…'));
  ctx.store.blobUrl(it.file).then(u => imgBox.replaceChildren(h('img', { src: u, onclick: () => zoom(u) }))).catch(() => imgBox.replaceChildren(h('span', { class: 'muted' }, '그림을 불러오지 못했어요')));
  const draw = () => {
    const comment = h('textarea', { rows: 3, placeholder: '의견 (선택) — 좋은 점, 고칠 점, 원하는 방향을 자유롭게', disabled: !editing });
    comment.value = fb.comment || '';
    const vbtn = (v, label) => h('button', { class: `btn ${verdict === v ? 'primary' : ''}`, disabled: !editing, onclick: () => { verdict = v; draw(); } }, label);
    const submit = async () => {
      if (!verdict && !comment.value.trim()) return toast('좋아요/고쳐 주세요를 고르거나 의견을 적어 주세요.', true);
      const feedback = { verdict, comment: comment.value.trim(), at: new Date().toISOString() };
      try {
        await ctx.store.updateJSON(FILE, d => { const x = d.items.find(y => y.id === it.id); if (x) { x.feedback = feedback; x.status = '피드백'; } return d; }, `확인 피드백: ${it.id} ${it.title}`, { items: [] });
        Object.assign(it, { feedback, status: '피드백' }); Object.assign(fb, feedback);
        toast('피드백을 보냈어요.');
        ctx.refreshBadges();
        if (tab === 'open') { el.classList.add('leaving'); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 450); return; }
        editing = false; draw();
      } catch (e) { toast(e.message, true); }
    };
    fill(el,
      h('div', { class: 'row' }, h('span', { class: 'did' }, it.id), h('h2', { style: { margin: 0, flex: 1 } }, it.title),
        h('span', { class: `badge ${it.status === '반영됨' ? 'ok' : it.status === '피드백' ? 'info' : 'warn'}` }, it.status)),
      h('div', { class: 'muted', style: { fontSize: '12px', margin: '2px 0 8px' } }, it.createdAt),
      imgBox,
      it.desc && h('p', { style: { fontSize: '14px', margin: '10px 0' } }, it.desc),
      it.status !== '반영됨' && h('div', { class: 'row' }, vbtn('좋아요', '👍 좋아요'), vbtn('고쳐 주세요', '✏️ 고쳐 주세요')),
      it.status !== '반영됨' && h('label', { class: 'field', style: { marginTop: '8px' } }, comment),
      it.status === '반영됨' && fb.verdict && h('p', { class: 'muted', style: { fontSize: '13px' } }, `내 피드백: ${fb.verdict}${fb.comment ? ' — ' + fb.comment : ''}`),
      it.response && h('div', { class: 'resp' }, h('b', {}, '💬 Claude: '), it.response),
      it.status !== '반영됨' && h('div', { class: 'row' },
        editing ? h('button', { class: 'btn primary', onclick: submit }, '제출') : h('button', { class: 'btn', onclick: () => { editing = true; draw(); } }, '고치기'),
        fb.at && !editing && h('span', { class: 'muted', style: { fontSize: '12px' } }, `${fmtDate(fb.at)} 제출`)));
    imgBox.isConnected || null;
  };
  draw();
  return el;
}
