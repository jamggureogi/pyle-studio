// Codex room: Claude's image work orders for Codex, Codex's completion reports, and the user's check.
import { h, toast, fmtDate, fill, modal } from '../ui.js';
import { loadRegistry, KINDS } from '../assets.js';

const FILE = 'data/codex_tasks.json';
const STATUS = { 대기: 'warn', 작업중: 'info', 질문: 'danger', 완료: 'ok', 확인됨: '', '다시 요청': 'danger' };
const ASK = '편집실 업데이트 확인하고 data/codex_tasks.json에서 "대기"·"다시 요청" 작업을 AGENTS.md 규칙대로 처리해 줘.';

async function copy(text, what = '복사했어요.') {
  try { await navigator.clipboard.writeText(text); toast(what); } catch { toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.', true); }
}

export async function render(ctx, rest) {
  const tab = ['done', 'checked', 'all'].includes(rest[0]) ? rest[0] : 'open';
  const [{ data }, reg] = await Promise.all([ctx.store.getJSON(FILE, { tasks: [] }), loadRegistry(ctx.store).catch(() => [])]);
  const tasks = (data.tasks || []).slice().sort((a, b) => (a.priority || 9) - (b.priority || 9));
  const groups = {
    open: tasks.filter(t => ['대기', '작업중', '질문', '다시 요청'].includes(t.status)),
    done: tasks.filter(t => t.status === '완료'),
    checked: tasks.filter(t => t.status === '확인됨'),
    all: tasks,
  };
  const list = h('div', {});
  for (const t of groups[tab]) list.append(card(ctx, t, reg));
  if (!groups[tab].length) list.append(h('div', { class: 'card empty' }, { open: 'Codex에게 맡길 작업이 없어요.', done: '확인할 결과가 없어요.', checked: '확인을 마친 작업이 없어요.', all: '작업이 없어요.' }[tab]));
  return h('div', { class: 'page' },
    h('h1', {}, '🤝 코덱스'),
    h('p', { class: 'sub' }, 'Claude가 Codex에게 남기는 그림 작업 지시서예요. Codex가 그림을 만들어 올리고 "완료"로 표시하면, 여기서 결과를 보고 확인하거나 다시 요청해요.'),
    h('div', { class: 'card codex-how' },
      h('b', {}, 'Codex에게 이렇게 말하세요'),
      h('div', { class: 'row', style: { marginTop: '6px' } }, h('code', { class: 'ask' }, ASK), h('button', { class: 'btn small', onclick: () => copy(ASK, '말할 문장을 복사했어요. Codex에 붙여넣으세요.') }, '복사')),
      h('p', { class: 'muted', style: { fontSize: '13px', margin: '8px 0 0' } }, '결과 그림은 저장소의 ', h('code', {}, 'assets/_inbox/codex/<작업번호>/'), ' 에 들어가고, 그림 보관함에 "후보"로 등록돼요.')),
    h('div', { class: 'tabs' },
      h('a', { href: '#/codex', class: tab === 'open' ? 'on' : '' }, `할 일 (${groups.open.length})`),
      h('a', { href: '#/codex/done', class: tab === 'done' ? 'on' : '' }, `완료 · 확인 필요 (${groups.done.length})`),
      h('a', { href: '#/codex/checked', class: tab === 'checked' ? 'on' : '' }, `확인됨 (${groups.checked.length})`),
      h('a', { href: '#/codex/all', class: tab === 'all' ? 'on' : '' }, `전체 (${tasks.length})`)),
    list);
}

function card(ctx, t, reg) {
  const el = h('div', { class: `card codex-card st-${t.status}` });
  const outputs = reg.filter(a => a.taskId === t.id);
  const reportFiles = t.codexReport?.files || [];
  const files = [...new Set([...outputs.map(a => a.file), ...reportFiles])];
  const thumbs = files.length ? h('div', { class: 'thumb-grid' }, files.map(f => {
    const box = h('div', { class: 'thumb-card' }, h('div', { class: 'thumb' }, '…'), h('div', { class: 'cap' }, f.split('/').pop()));
    ctx.store.blobUrl(f).then(u => { box.firstChild.replaceChildren(h('img', { src: u })); box.onclick = () => modal(f.split('/').pop(), h('div', { class: 'checker' }, h('img', { src: u, class: 'viewer-img' }))); }).catch(() => box.firstChild.replaceChildren('없음'));
    return box;
  })) : null;

  const setStatus = async (status, comment) => {
    try {
      await ctx.store.updateJSON(FILE, d => {
        const x = d.tasks.find(y => y.id === t.id);
        if (x) { x.status = status; if (comment != null) x.userFeedback = { comment, at: new Date().toISOString() }; }
        return d;
      }, `코덱스 작업 ${status}: ${t.id} ${t.title}`, { tasks: [] });
      toast(status === '확인됨' ? '확인했어요.' : '다시 요청했어요. Codex가 다음에 고쳐서 올려요.');
      ctx.refreshBadges();
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) { toast(e.message, true); }
  };
  const again = async () => {
    const ta = h('textarea', { rows: 4, placeholder: '무엇을 어떻게 고쳐 달라고 할까요?' });
    const ok = await modal(`${t.id} 다시 요청`, h('label', { class: 'field' }, h('span', {}, 'Codex에게 전할 말'), ta), [{ label: '취소', value: false }, { label: '다시 요청', value: true, primary: true }]);
    if (ok) setStatus('다시 요청', ta.value.trim());
  };

  const refBox = h('div', { class: 'refs' }, (t.references || []).map(r => {
    const item = h('div', { class: 'ref' }, h('div', { class: 'thumb' }, '…'), h('div', { class: 'cap' }, r.why || ''), h('code', { class: 'cap' }, r.path));
    if (r.path?.startsWith('assets/') || r.path?.startsWith('docs/')) ctx.store.blobUrl(r.path).then(u => item.firstChild.replaceChildren(h('img', { src: u }))).catch(() => item.firstChild.replaceChildren('없음'));
    else item.firstChild.replaceChildren('📎');
    return item;
  }));

  fill(el,
    h('div', { class: 'row' },
      h('span', { class: 'did' }, t.id),
      h('h2', { style: { margin: 0, flex: 1 } }, t.title),
      h('span', { class: `badge ${STATUS[t.status] || ''}` }, t.status)),
    h('div', { class: 'muted', style: { fontSize: '12px', margin: '4px 0 8px' } },
      `우선순위 ${t.priority} · ${KINDS[t.kind] || t.kind} · ${t.count}장 · ${t.size}`, t.illustrationKey && ` · 일러스트 칸 ${t.illustrationKey}`, t.owner && ` · 인물 ${t.owner}`, ` · ${t.createdBy} ${t.createdAt || ''}`),
    h('div', { class: 'row out' }, h('span', { class: 'muted' }, '결과 넣을 곳'), h('code', {}, t.outputDir), h('button', { class: 'btn small', onclick: () => copy(t.outputDir) }, '복사')),
    t.notes && h('p', { class: 'notes' }, '📌 ', t.notes),
    h('details', { open: ['대기', '다시 요청', '질문'].includes(t.status) },
      h('summary', {}, '요청문 (프롬프트)'),
      h('pre', { class: 'prompt' }, t.prompt),
      h('button', { class: 'btn small', onclick: () => copy(t.prompt, '요청문을 복사했어요.') }, '요청문 복사')),
    (t.references || []).length && h('div', {}, h('h4', { style: { margin: '10px 0 6px' } }, '참고 그림 (Codex가 꼭 같이 넣을 것)'), refBox),
    t.userFeedback?.comment && h('div', { class: 'resp' }, h('b', {}, '🙋 내 요청: '), t.userFeedback.comment),
    t.codexReport && h('div', { class: 'resp codex' }, h('b', {}, '🤖 Codex: '), t.codexReport.note || '(메모 없음)', t.codexReport.completedAt && h('span', { class: 'muted' }, ` · ${fmtDate(t.codexReport.completedAt)}`)),
    thumbs && h('div', {}, h('h4', { style: { margin: '10px 0 6px' } }, `결과 ${files.length}장`), thumbs),
    t.status === '완료' && h('div', { class: 'row', style: { marginTop: '10px' } },
      h('button', { class: 'btn primary', onclick: () => setStatus('확인됨') }, '✔ 확인했어요'),
      h('button', { class: 'btn', onclick: again }, '↺ 다시 요청'),
      h('a', { href: '#/character/library/후보', class: 'small-link' }, '그림 보관함에서 승인하기 →')),
    t.status === '확인됨' && h('div', { class: 'row', style: { marginTop: '10px' } }, h('button', { class: 'btn small', onclick: again }, '↺ 다시 요청')));
  return el;
}
