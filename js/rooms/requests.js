// Request box: the user leaves requests per room; Claude reads data/requests.json and answers.
import { h, toast, fmtDate, confirmBox, loading, errorBox } from '../ui.js';
import { ROOMS, roomName } from '../app.js';
import { thumb, viewImage, fileToB64 } from '../assets.js';

const FILE = 'data/requests.json';
const STATUS = ['대기', '진행중', '완료', '보류'];
const statusClass = { 대기: 'warn', 진행중: 'info', 완료: 'ok', 보류: 'danger', 임시저장: 'draft' };
// '임시저장': 감독 에이전트가 써 둔 요청 초안. 사용자가 읽고 [요청 남기기]를 눌러야 '대기'가 되어 팀이 작업해요.
const DRAFT = '임시저장';

export function newId() {
  return 'req_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// A self-contained request panel. room=null shows every room.
export function requestPanel(ctx, room) {
  const wrap = h('div', {}, loading());
  let filter = null;   // 처음엔 임시저장이 있으면 그 탭부터

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
    // 그림 첨부: 게임 화면 사진 등 (파일 고르기 또는 붙여넣기 Ctrl+V)
    let files = [];
    const picked = h('div', { class: 'thumb-grid' });
    const drawPicked = () => picked.replaceChildren(...files.map((f, i) => h('div', { class: 'thumb-card' },
      h('img', { src: URL.createObjectURL(f), class: 'thumb' }),
      h('div', { class: 'cap' }, h('button', { class: 'btn small danger', onclick: () => { files.splice(i, 1); drawPicked(); } }, '빼기')))));
    const addFiles = list => { files.push(...[...list].filter(f => f.type.startsWith('image/'))); drawPicked(); };
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' }, onchange: e => { addFiles(e.target.files); e.target.value = ''; } });
    const onPaste = e => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } };
    title.addEventListener('paste', onPaste); body.addEventListener('paste', onPaste);
    const add = async () => {
      if (!title.value.trim()) return toast('요청 제목을 적어 주세요.', true);
      const now = new Date().toISOString();
      const req = { id: newId(), room: room || roomSel.value, title: title.value.trim(), body: body.value.trim(), status: '대기', createdAt: now, updatedAt: now, createdBy: '사용자', response: '' };
      try {
        if (files.length) {
          req.images = [];
          for (let i = 0; i < files.length; i++) {
            toast(`그림 올리는 중 ${i + 1}/${files.length}`);
            const ext = (files[i].name.match(/\.\w+$/) || ['.png'])[0].toLowerCase();
            const path = `docs/images/req/${req.id}_${i + 1}${ext}`;
            await ctx.store.putBinary(path, await fileToB64(files[i]), null, `요청 그림: ${path.split('/').pop()}`);
            req.images.push({ file: path });
          }
        }
      } catch (e) { return toast(e.message, true); }
      await mutate(list => list.unshift(req), `요청 추가: ${req.title}`);
      title.value = ''; body.value = ''; files = []; drawPicked();
      toast('요청을 남겼어요. Claude에게 "요청함 처리해줘"라고 말하면 작업해요.');
    };
    return h('div', { class: 'card' },
      h('h2', {}, '새 요청'),
      roomSel && h('label', { class: 'field' }, h('span', {}, '어느 룸에 대한 요청인가요?'), roomSel),
      h('label', { class: 'field' }, h('span', {}, '요청'), title),
      h('label', { class: 'field' }, h('span', {}, '자세히'), body),
      h('div', { class: 'field' }, h('span', {}, '그림 붙이기 (선택) — 게임 화면 사진을 붙이면 어디인지 바로 알 수 있어요. 글 칸에 Ctrl+V로 붙여 넣어도 돼요.'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => fileIn.click() }, '📎 그림 고르기'), fileIn), picked),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: add }, '요청 남기기')),
    );
  }

  // 요청에 붙은 그림 (사용자 첨부 또는 감독이 표시해 붙인 화면)
  function pics(r) {
    if (!r.images?.length) return null;
    return h('div', { class: 'thumb-grid req-pics' }, r.images.map(im => h('div', { class: 'thumb-card', onclick: () => viewImage(ctx.store, im.file, im.caption || r.title) },
      thumb(ctx.store, im.file), im.caption && h('div', { class: 'cap' }, im.caption))));
  }

  // 감독 에이전트가 써 둔 초안: 고쳐서 [요청 남기기] 또는 지우기
  function draftItem(r) {
    let editing = false;
    const li = h('li', { class: 'req draft' });
    const submit = () => mutate(list => {
      const x = list.find(q => q.id === r.id);
      if (x) { const now = new Date().toISOString(); x.status = '대기'; x.submittedAt = now; x.submittedBy = '사용자'; x.updatedAt = now; }
    }, `요청 남기기 (감독 초안): ${r.title}`).then(() => toast('요청을 남겼어요. 팀이 작업 시작할 때 처리해요.'));
    const del = async () => { if (await confirmBox('이 초안을 지울까요?', '지우기')) mutate(list => { const i = list.findIndex(q => q.id === r.id); if (i >= 0) list.splice(i, 1); }, `요청 초안 삭제: ${r.title}`); };
    const paint = () => {
      const title = h('input', { value: r.title });
      const body = h('textarea', { rows: 5 }); body.value = r.body || '';
      const save = () => mutate(list => {
        const x = list.find(q => q.id === r.id);
        if (x) { x.title = title.value.trim() || x.title; x.body = body.value.trim(); x.editedBy = '사용자'; x.updatedAt = new Date().toISOString(); }
      }, `요청 초안 고침: ${r.title}`);
      li.replaceChildren(
        h('span', { class: 'badge draft' }, '📝 임시저장'),
        h('div', { class: 'body' },
          editing ? h('label', { class: 'field' }, title) : h('div', { class: 'title' }, r.title),
          h('div', { class: 'meta' }, !room && `${roomName(r.room)} · `, `${r.createdBy || '감독'} 작성 · ${fmtDate(r.createdAt)}`, r.team && ` · 맡을 팀: ${r.team}`, r.editedBy && ' · 사용자가 고침'),
          editing ? h('label', { class: 'field' }, body) : r.body && h('div', { class: 'text' }, r.body),
          pics(r),
          r.why && h('div', { class: 'resp why' }, h('b', {}, '🔍 감독 판단 근거: '), r.why),
          h('div', { class: 'row', style: { marginTop: '6px' } },
            editing
              ? [h('button', { class: 'btn small primary', onclick: save }, '고친 내용 저장'), h('button', { class: 'btn small', onclick: () => { editing = false; paint(); } }, '취소')]
              : [h('button', { class: 'btn small primary', onclick: submit }, '요청 남기기'), h('button', { class: 'btn small', onclick: () => { editing = true; paint(); } }, '고치기')],
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn small danger', onclick: del }, '지우기'))));
    };
    paint();
    return li;
  }

  function item(r) {
    if (r.status === DRAFT) return draftItem(r);
    const setStatus = s => mutate(list => { const x = list.find(q => q.id === r.id); if (x) { x.status = s; x.updatedAt = new Date().toISOString(); } }, `요청 상태 변경: ${r.title} → ${s}`);
    const del = async () => { if (await confirmBox('이 요청을 지울까요?', '지우기')) mutate(list => { const i = list.findIndex(q => q.id === r.id); if (i >= 0) list.splice(i, 1); }, `요청 삭제: ${r.title}`); };
    return h('li', { class: 'req' },
      h('span', { class: `badge ${statusClass[r.status] || ''}` }, r.status),
      h('div', { class: 'body' },
        h('div', { class: 'title' }, r.title),
        h('div', { class: 'meta' }, !room && `${roomName(r.room)} · `, `${r.createdBy || ''} · ${fmtDate(r.createdAt)}`, r.updatedAt !== r.createdAt && ` · 수정 ${fmtDate(r.updatedAt)}`),
        r.body && h('div', { class: 'text' }, r.body),
        pics(r),
        r.response && h('div', { class: 'resp' }, h('b', {}, '💬 Claude: '), r.response),
        h('div', { class: 'row', style: { marginTop: '6px' } },
          STATUS.filter(s => s !== r.status).map(s => h('button', { class: 'btn small', onclick: () => setStatus(s) }, s === '대기' ? '다시 대기로' : s)),
          h('span', { class: 'spacer' }),
          h('button', { class: 'btn small danger', onclick: del }, '삭제')),
      ));
  }

  function draw(all) {
    const mine = all.filter(r => !room || r.room === room);
    const drafts = mine.filter(r => r.status === DRAFT);
    if (!filter) filter = drafts.length ? 'draft' : 'open';
    const pick = { draft: r => r.status === DRAFT, open: r => ['대기', '진행중'].includes(r.status), done: r => ['완료', '보류'].includes(r.status), all: () => true };
    const shown = mine.filter(pick[filter] || pick.open);
    const tab = (id, label, n) => h('a', { href: '#', class: filter === id ? 'on' : '', onclick: e => { e.preventDefault(); filter = id; draw(all); } }, `${label} (${n})`);
    wrap.replaceChildren(
      form(),
      h('div', { class: 'card' },
        h('div', { class: 'tabs' },
          tab('draft', '📝 감독 초안 (임시저장)', drafts.length),
          tab('open', '진행 전·중', mine.filter(r => ['대기', '진행중'].includes(r.status)).length),
          tab('done', '끝남', mine.filter(r => ['완료', '보류'].includes(r.status)).length),
          tab('all', '전체', mine.length)),
        filter === 'draft' && drafts.length > 0 && h('p', { class: 'muted', style: { fontSize: '13px', margin: '4px 0 8px' } }, '감독 에이전트가 "요청이 잘 반영되지 않았다"고 판단했거나 팀에게 맡기면 좋겠다고 써 둔 초안이에요. 읽어 보고 [요청 남기기]를 누르면 팀에게 가요. 고치거나 지워도 돼요.'),
        shown.length ? h('ul', { class: 'list' }, shown.map(item)) : h('div', { class: 'empty' }, filter === 'draft' ? '임시저장된 초안이 없어요.' : '요청이 없어요.'),
      ));
  }

  load();
  return wrap;
}

export async function render(ctx) {
  return h('div', { class: 'page' },
    h('h1', {}, '📮 요청함'),
    h('p', { class: 'sub' }, '모든 룸의 요청을 모아 봐요. 요청을 남긴 뒤 Claude에게 "요청함 처리해줘"라고 말하면 작업하고 결과를 여기에 남겨요. 🔍 감독 에이전트가 써 둔 초안은 "감독 초안" 탭에 있어요.'),
    requestPanel(ctx, null));
}
