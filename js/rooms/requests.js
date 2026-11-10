// Request box: the user leaves requests per room; Claude reads data/requests.json and answers.
import { h, toast, fmtDate, confirmBox, loading, errorBox } from '../ui.js';
import { ROOMS, roomName } from '../app.js';

const FILE = 'data/requests.json';
const STATUS = ['대기', '진행중', '완료', '보류'];
const statusClass = { 대기: 'warn', 진행중: 'info', 완료: 'ok', 보류: 'danger' };

export function newId() {
  return 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// A self-contained request panel. room=null shows every room.
export function requestPanel(ctx, room) {
  const wrap = h('div', {}, loading());
  let filter = 'open';

  async function load() {
    try {
      const { data } = await ctx.store.getJSON(FILE, { requests: [] });
      draw(data.requests || []);
    } catch (e) { wrap.replaceChildren(errorBox(e)); }
  }

  async function mutate(fn, msg) {
    try {
      const data = await ctx.store.updateJSON(FILE, d => { d.requests ||= []; fn(d.requests); return d; }, msg, { requests: [] });
      draw(data.requests);
      ctx.refreshBadges();
    } catch (e) { toast(e.message, true); }
  }

  function form() {
    const roomSel = room ? null : h('select', {}, h('option', { value: 'general' }, '일반 (게임 전반에 걸친 요청)'), ROOMS.filter(r => !['home', 'requests'].includes(r.id)).map(r => h('option', { value: r.id }, r.name)));
    const title = h('input', { placeholder: '예) 주인공 웃는 표정 초상화 새로 만들어줘' });
    const body = h('textarea', { placeholder: '자세한 내용 (선택)' });
    const add = async () => {
      if (!title.value.trim()) return toast('요청 제목을 적어 주세요.', true);
      const now = new Date().toISOString();
      const req = { id: newId(), room: room || roomSel.value, title: title.value.trim(), body: body.value.trim(), status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' };
      await mutate(list => list.unshift(req), `요청 추가: ${req.title}`);
      title.value = ''; body.value = '';
      toast('요청을 남겼어요. Claude에게 "요청함 처리해줘"라고 말하면 작업해요.');
    };
    return h('div', { class: 'card' },
      h('h2', {}, '새 요청'),
      roomSel && h('label', { class: 'field' }, h('span', {}, '어느 룸에 대한 요청인가요?'), roomSel),
      h('label', { class: 'field' }, h('span', {}, '요청'), title),
      h('label', { class: 'field' }, h('span', {}, '자세히'), body),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: add }, '요청 남기기')),
    );
  }

  function item(r) {
    const setStatus = s => mutate(list => { const x = list.find(q => q.id === r.id); if (x) { x.status = s; x.updatedAt = new Date().toISOString(); } }, `요청 상태 변경: ${r.title} → ${s}`);
    const del = async () => { if (await confirmBox('이 요청을 지울까요?', '지우기')) mutate(list => { const i = list.findIndex(q => q.id === r.id); if (i >= 0) list.splice(i, 1); }, `요청 삭제: ${r.title}`); };
    return h('li', { class: 'req' },
      h('span', { class: `badge ${statusClass[r.status] || ''}` }, r.status),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, r.title),
        h('div', { class: 'meta' }, !room && `${roomName(r.room)} · `, `${r.createdBy || ''} · ${fmtDate(r.createdAt)}`, r.updatedAt !== r.createdAt && ` · 수정 ${fmtDate(r.updatedAt)}`),
        r.body && h('div', { class: 'text' }, r.body),
        r.response && h('div', { class: 'resp' }, h('b', {}, '💬 Claude: '), r.response),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          STATUS.filter(s => s !== r.status).map(s => h('button', { class: 'btn small', onclick: () => setStatus(s) }, s === '대기' ? '다시 대기로' : s)),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small danger', onclick: del }, '삭제')),
      ));
  }

  function draw(all) {
    const mine = all.filter(r => !room || r.room === room);
    const shown = mine.filter(r => filter === 'all' || (filter === 'open' ? ['대기', '진행중'].includes(r.status) : ['완료', '보류'].includes(r.status)));
    const tab = (id, label, n) => h('a', { href: '#', class: filter === id ? 'on' : '', onclick: e => { e.preventDefault(); filter = id; draw(all); } }, `${label} (${n})`);
    wrap.replaceChildren(
      form(),
      h('div', { class: 'card' },
        h('div', { class: 'tabs' },
          tab('open', '진행 전·중', mine.filter(r => ['대기', '진행중'].includes(r.status)).length),
          tab('done', '끝남', mine.filter(r => ['완료', '보류'].includes(r.status)).length),
          tab('all', '전체', mine.length)),
        shown.length ? h('ul', { class: 'list' }, shown.map(item)) : h('div', { class: 'empty' }, '요청이 없어요.'),
      ));
  }

  load();
  return wrap;
}

export async function render(ctx) {
  return h('div', { class: 'page' },
    h('h1', {}, '📮 요청함'),
    h('p', { class: 'sub' }, '모든 룸의 요청을 모아 봐요. 요청을 남긴 뒤 Claude에게 "요청함 처리해줘"라고 말하면 작업하고 결과를 여기에 남겨요.'),
    requestPanel(ctx, null));
}
