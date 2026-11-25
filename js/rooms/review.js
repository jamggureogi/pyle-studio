// Review room: images Claude wants the user to look at, with feedback per image.
import { h, toast, fmtDate, fill, paged, confirmBox, newestFirst } from '../ui.js';
import { openAnnotator, uploadMarks, marksRow } from '../annotate.js';

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
  const tab = ['sent', 'done', 'old'].includes(rest[0]) ? rest[0] : 'open';
  const { data } = await ctx.store.getJSON(FILE, { items: [] });
  const all = newestFirst(data.items || []);
  const groups = { open: all.filter(x => x.status === '확인 대기'), sent: all.filter(x => x.status === '피드백'), done: all.filter(x => x.status === '반영됨'), old: all.filter(x => x.status === '지난 내용') };
  const list = h('div', { class: 'review-list' });
  const shown = groups[tab];
  if (!shown.length) list.append(h('div', { class: 'card empty' }, { open: '지금 확인할 그림이 없어요.', sent: '보낸 피드백이 없어요.', done: '반영된 항목이 없어요.', old: '지난 내용이 없어요.' }[tab]));
  if (shown.length) list.append(paged(shown, it => card(ctx, it, tab), { key: 'review-' + tab, size: 8 }));
  return h('div', { class: 'page' },
    h('h1', {}, '🖼 확인'),
    h('p', { class: 'sub' }, 'Claude가 작업 결과를 그림으로 보여드리는 곳이에요. 그림을 누르면 크게 보여요. 그림마다 피드백을 남기고 제출하면 Claude가 다음 작업 때 반영해요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/review', class: tab === 'open' ? 'on' : '' }, `확인할 것 (${groups.open.length})`),
      h('a', { href: '#/review/sent', class: tab === 'sent' ? 'on' : '' }, `피드백 보냄 · 반영 대기 (${groups.sent.length})`),
      h('a', { href: '#/review/done', class: tab === 'done' ? 'on' : '' }, `반영됨 (${groups.done.length})`),
      h('a', { href: '#/review/old', class: tab === 'old' ? 'on' : '' }, `지난 내용 (${groups.old.length})`)),
    tab === 'old' && h('p', { class: 'muted', style: { fontSize: '13px' } }, '새 버전이 나와서 답하지 않아도 되는 항목, 그리고 [🗑 지우기]로 지운 항목이에요. 팀들은 여기 있는 항목을 더 처리하지 않아요.'),
    list);
}

// 보낸 의견에 붙은 표시 그림들 (누르면 크게)
function sentMarks(ctx, paths) {
  if (!Array.isArray(paths) || !paths.length) return null;
  const box = h('div', { class: 'ann-marks' }, h('span', { class: 'muted', style: { fontSize: '12px' } }, `✏️ 보낸 표시 그림 ${paths.length}장`));
  for (const p of paths) ctx.store.blobUrl(p).then(u => box.append(h('span', { class: 'ann-mark' }, h('img', { src: u, onclick: () => zoom(u) })))).catch(() => {});
  return box;
}

function card(ctx, it, tab) {
  const el = h('div', { class: 'card review-card' });
  const fb = it.feedback || {};
  let editing = it.status === '확인 대기';
  // 이미 피드백을 보낸 항목을 팀이 다시 '확인 대기'로 올린 경우: 지난 피드백은 위에 '지난번에 보낸 의견'으로만 보이고,
  // 입력 칸은 비워 둠 — 예전 글이 '안 보낸 초안'처럼 보이던 문제 (사용자 req_mwm6pvvd7m57)
  const prevFb = (editing && fb.at) ? { ...fb } : null;
  let verdict = prevFb ? null : (fb.verdict || null);
  const closed = it.status === '반영됨' || it.status === '지난 내용';
  // 그림 없이 글로만 보고한 항목은 깨진 그림 대신 아무것도 안 보이게 (사용자 RV-424·970 "미리보기 이미지가 깨져서")
  const imgBox = it.file ? h('div', { class: 'review-img' }, h('span', { class: 'muted' }, '불러오는 중…')) : null;
  // 그림이 여러 장인 항목(files): 첫 장 아래에 나머지도 보여 줌
  const extra = [...new Set([...(it.files || []), ...(it.images || []).map(x => typeof x === 'string' ? x : x && x.file)])].filter(f => f && f !== it.file);
  // 그림 위에 펜으로 표시 (사용자 11/23): 그림마다 [✏️ 표시하기] → 표시한 그림은 의견과 함께 feedback.images 로 감
  const marks = [];
  const allImgs = [it.file, ...extra].filter(Boolean);
  const annotate = async path => {
    try {
      const u = await ctx.store.blobUrl(path);
      const blob = await openAnnotator(u, it.id);
      if (blob) { marks.push({ blob, src: path }); if (!editing) editing = true; draw(); }
    } catch (e) { toast(`그림을 열지 못했어요 (${e.message})`, true); }
  };
  const extraBox = extra.length ? h('div', { class: 'review-img' }) : null;
  for (const f of extra) ctx.store.blobUrl(f).then(u => extraBox.append(h('img', { src: u, style: { marginTop: '8px' }, onclick: () => zoom(u) }))).catch(() => {});
  if (it.file) ctx.store.blobUrl(it.file).then(u => imgBox.replaceChildren(h('img', { src: u, onclick: () => zoom(u) }))).catch(() => imgBox.replaceChildren(h('span', { class: 'muted' }, `그림을 불러오지 못했어요 (${it.file})`)));
  let typed = null;          // 쓰던 의견 — 좋아요/고쳐 주세요를 눌러 다시 그려도 지워지지 않게 (사용자 11/16)
  const draw = () => {
    const comment = h('textarea', { rows: 3, placeholder: '의견 (선택) — 좋은 점, 고칠 점, 원하는 방향을 자유롭게', disabled: !editing });
    comment.value = typed ?? (prevFb ? '' : (fb.comment ?? ''));
    comment.addEventListener('input', () => { typed = comment.value; });
    const vbtn = (v, label) => h('button', { class: `btn ${verdict === v ? 'primary' : ''}`, disabled: !editing, onclick: () => { verdict = v; draw(); } }, label);
    const submit = async () => {
      if (!verdict && !comment.value.trim()) return toast('좋아요/고쳐 주세요를 고르거나 의견을 적어 주세요.', true);
      const feedback = { verdict, comment: comment.value.trim(), at: new Date().toISOString() };
      try {
        if (marks.length) { toast('표시한 그림을 올리는 중…'); feedback.images = await uploadMarks(ctx.store, marks, it.id); marks.length = 0; }
        await ctx.store.updateJSON(FILE, d => { const x = d.items.find(y => y.id === it.id); if (x) { if (x.feedback && x.feedback.at && x.feedback.at !== feedback.at) (x.feedbackHistory ||= []).push(x.feedback); x.feedback = feedback; x.status = '피드백'; } return d; }, `확인 피드백: ${it.id} ${it.title}`, { items: [] });
        Object.assign(it, { feedback, status: '피드백' }); Object.assign(fb, feedback); typed = null;
        toast('피드백을 보냈어요.');
        ctx.refreshBadges();
        if (tab === 'open') { el.classList.add('leaving'); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 450); return; }
        editing = false; draw();
      } catch (e) { toast(`보내지 못했어요 (${e.message}). 적은 의견은 그대로 있어요 — 다시 눌러 주세요.`, true); }
    };
    // 지우기 (사용자 req_mwlja6277bcb): 이미 지나간 안건이거나 다른 곳에서 의견을 냈다는 뜻 → '지난 내용'으로 옮기고 팀들은 더 손대지 않음
    const dismiss = async () => {
      if (!await confirmBox('이 안건을 지울까요? \'지난 내용\' 탭으로 옮겨지고, 팀들은 이 안건을 더 처리하지 않아요.', '지우기')) return;
      const at = new Date().toISOString();
      try {
        await ctx.store.updateJSON(FILE, d => { const x = d.items.find(y => y.id === it.id); if (x) { x.prevStatus = x.status; x.status = '지난 내용'; x.dismissed = { by: '사용자', at }; } return d; }, `확인 지우기: ${it.id} ${it.title}`, { items: [] });
        Object.assign(it, { prevStatus: it.status, status: '지난 내용', dismissed: { by: '사용자', at } });
        toast('지웠어요. \'지난 내용\' 탭에 남아 있어요.');
        ctx.refreshBadges();
        el.classList.add('leaving'); setTimeout(() => window.dispatchEvent(new HashChangeEvent('hashchange')), 450);
      } catch (e) { toast(`지우지 못했어요 (${e.message}).`, true); }
    };
    fill(el,
      h('div', { class: 'row' }, h('span', { class: 'did' }, it.id), h('h2', { style: { margin: 0, flex: 1 } }, it.title),
        it.status !== '지난 내용' && h('button', { class: 'btn small', title: '이미 지나간 안건이거나 다른 곳에서 의견을 낸 것 — 지난 내용으로 옮겨요', onclick: dismiss }, '🗑 지우기'),
        h('span', { class: `badge ${it.status === '반영됨' ? 'ok' : it.status === '피드백' ? 'info' : it.status === '지난 내용' ? '' : 'warn'}` }, it.status),
        it.replacedBy && h('span', { class: 'muted', style: { fontSize: '12px' } }, `→ ${it.replacedBy}`)),
      h('div', { class: 'muted', style: { fontSize: '12px', margin: '2px 0 8px' } }, it.createdAt),
      imgBox,
      extraBox,
      !closed && allImgs.length > 0 && h('div', { class: 'row ann-open-row' }, ...allImgs.map((p, i) => h('button', { class: 'btn small', title: '그림 위에 빨간 펜·연필로 표시해서 보내요', onclick: () => annotate(p) }, allImgs.length > 1 ? `✏️ ${i + 1}번 그림에 표시하기` : '✏️ 그림에 표시하기'))),
      marksRow(marks, draw, editing),
      it.desc && h('p', { style: { fontSize: '14px', margin: '10px 0' } }, it.desc),
      prevFb && h('p', { class: 'muted', style: { fontSize: '13px', borderLeft: '3px solid #8aa', paddingLeft: '8px' } }, `지난번에 보낸 의견 (${fmtDate(prevFb.at)} 제출됨): ${prevFb.verdict || ''}${prevFb.comment ? ' — ' + prevFb.comment : ''}`),
      sentMarks(ctx, (prevFb || (!editing ? fb : {})).images),
      !closed && h('div', { class: 'row' }, vbtn('좋아요', '👍 좋아요'), vbtn('고쳐 주세요', '✏️ 고쳐 주세요')),
      !closed && h('label', { class: 'field', style: { marginTop: '8px' } }, comment),
      closed && fb.verdict && h('p', { class: 'muted', style: { fontSize: '13px' } }, `내 피드백: ${fb.verdict}${fb.comment ? ' — ' + fb.comment : ''}`),
      it.response && h('div', { class: 'resp' }, h('b', {}, '💬 Claude: '), it.response),
      !closed && h('div', { class: 'row' },
        editing ? h('button', { class: 'btn primary', onclick: submit }, '제출') : h('button', { class: 'btn', onclick: () => { editing = true; draw(); } }, '고치기'),
        fb.at && !editing && !prevFb && h('span', { class: 'muted', style: { fontSize: '12px' } }, `${fmtDate(fb.at)} 제출`)));
  };
  draw();
  return el;
}
