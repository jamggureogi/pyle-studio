// Scenario room: read and edit the project documents (world, story, characters, system notes).
import { h, toast, loading, errorBox, confirmBox, modal } from '../ui.js';
import { renderMarkdown } from '../md.js';
import { requestPanel } from './requests.js';
import { ConflictError } from '../store.js';

const SECTIONS = [
  { title: '시나리오', dir: 'docs/시나리오' },
  { title: '캐릭터', dir: 'docs/캐릭터' },
  { title: '게임 시스템', dir: 'docs/게임시스템' },
  { title: '프로젝트', files: ['docs/결정대기.md', 'docs/진행상황.md', 'docs/그림_제작목록.md', 'docs/맵_제작가이드.md', 'docs/리소스_현황.md', 'CLAUDE.md', 'docs/편집실/설계안.md'] },
];
const DEFAULT_DOC = 'docs/시나리오/세계관.md';

export async function render(ctx, rest) {
  const tab = rest[0] === 'requests' ? 'requests' : rest[0] === 'todo' ? 'todo' : 'docs';
  const docPath = tab === 'docs' ? (rest.slice(1).join('/') || DEFAULT_DOC) : null;
  const tabs = h('div', { class: 'tabs' },
    h('a', { href: '#/scenario/docs', class: tab === 'docs' ? 'on' : '' }, '문서'),
    h('a', { href: '#/scenario/todo', class: tab === 'todo' ? 'on' : '' }, '미정 항목'),
    h('a', { href: '#/scenario/requests', class: tab === 'requests' ? 'on' : '' }, '요청함'));
  const page = h('div', { class: 'page' },
    h('h1', {}, '📜 시나리오룸'),
    h('p', { class: 'sub' }, '세계관, 줄거리, 인물, 시스템 설정을 모아 둔 곳이에요. 새로 합류한 사람이나 Claude도 여기서 게임을 파악해요.'),
    tabs);
  if (tab === 'requests') page.append(requestPanel(ctx, 'scenario'));
  else if (tab === 'todo') page.append(await todoView(ctx));
  else page.append(await docsView(ctx, docPath));
  return page;
}

async function allDocs(ctx) {
  const groups = await Promise.all(SECTIONS.map(async s => {
    const files = s.files ? s.files.map(p => ({ path: p, name: p.split('/').pop() }))
      : (await ctx.store.list(s.dir)).filter(f => f.type === 'file' && f.name.endsWith('.md'));
    return { ...s, files };
  }));
  return groups;
}

async function docsView(ctx, path) {
  const groups = await allDocs(ctx);
  const tree = h('div', { class: 'card tree' },
    groups.map(g => [h('h4', {}, g.title), g.files.map(f => h('a', { href: `#/scenario/docs/${f.path}`, class: f.path === path ? 'on' : '' }, f.name.replace(/\.md$/, '')))]),
    h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn small', onclick: () => newDoc(ctx) }, '+ 새 문서')));
  const body = h('div', {}, loading());
  showDoc(ctx, path, body);
  return h('div', { class: 'split' }, tree, body);
}

async function showDoc(ctx, path, body) {
  try {
    const f = await ctx.store.getText(path);
    if (!f) { body.replaceChildren(h('div', { class: 'card empty' }, '문서를 찾을 수 없어요.')); return; }
    let sha = f.sha, text = f.text;
    const view = () => body.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('span', { class: 'muted', style: { fontSize: '13px' } }, path), h('span', { class: 'spacer' }), h('button', { class: 'btn small', onclick: edit }, '✏️ 편집')),
      h('div', { class: 'md', html: renderMarkdown(text) })));
    const edit = () => {
      const ta = h('textarea', { class: 'editor' });
      ta.value = text;
      const save = async () => {
        try {
          sha = await ctx.store.putText(path, ta.value, sha, `문서 수정: ${path.split('/').pop()}`);
          text = ta.value;
          toast('저장했어요.');
          view();
        } catch (e) {
          if (e instanceof ConflictError) toast('그사이 다른 곳(Claude 등)에서 이 문서를 고쳤어요. 내용을 복사해 두고 새로고침해 주세요.', true);
          else toast(e.message, true);
        }
      };
      const cancel = async () => { if (ta.value === text || await confirmBox('고친 내용을 버릴까요?', '버리기')) view(); };
      body.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'row', style: { marginBottom: '8px' } }, h('b', {}, '편집 중'), h('span', { class: 'muted', style: { fontSize: '13px' } }, path), h('span', { class: 'spacer' }),
          h('button', { class: 'btn small', onclick: cancel }, '취소'), h('button', { class: 'btn small primary', onclick: save }, '저장')),
        ta,
        h('p', { class: 'muted', style: { fontSize: '13px' } }, '마크다운 형식이에요. # 제목, - 목록, **굵게**, | 표 | 를 쓸 수 있어요.')));
      ta.focus();
    };
    view();
  } catch (e) { body.replaceChildren(errorBox(e)); }
}

async function newDoc(ctx) {
  const dirSel = h('select', {}, SECTIONS.filter(s => s.dir).map(s => h('option', { value: s.dir }, s.title)));
  const name = h('input', { placeholder: '예) 지명과 국가' });
  const ok = await modal('새 문서', h('div', {}, h('label', { class: 'field' }, h('span', {}, '분류'), dirSel), h('label', { class: 'field' }, h('span', {}, '문서 이름'), name)),
    [{ label: '취소', value: false }, { label: '만들기', value: true, primary: true }]);
  if (!ok || !name.value.trim()) return;
  const path = `${dirSel.value}/${name.value.trim().replace(/[\\/]/g, ' ')}.md`;
  try {
    await ctx.store.putText(path, `# ${name.value.trim()}\n\n`, null, `새 문서: ${name.value.trim()}`);
    toast('문서를 만들었어요.');
    ctx.go(`#/scenario/docs/${path}`);
  } catch (e) { toast(e.message, true); }
}

// Collect every line marked 📝 or ❓ across the docs.
async function todoView(ctx) {
  const groups = await allDocs(ctx);
  const files = groups.flatMap(g => g.files);
  const texts = await Promise.all(files.map(f => ctx.store.getText(f.path).catch(() => null)));
  const items = [];
  const isList = l => /^\s*([-*]|\d+\.)\s+/.test(l);
  const strip = l => l.replace(/^\s*([-*]|\d+\.)\s*/, '');
  files.forEach((f, i) => {
    const t = texts[i]?.text;
    if (!t) return;
    let memo = false; // inside a "📝 메모" block or a heading marked 📝
    for (const line of t.split('\n')) {
      if (/^>/.test(line)) continue; // legend lines in quotes
      const heading = /^#{1,6}\s/.test(line);
      if (heading) { memo = /📝|❓/.test(line); continue; }
      if (/^\s*📝\s*(메모|연표 메모)?\s*$/.test(line)) { memo = true; continue; }
      if (/📝|❓/.test(line)) { items.push({ f, line: strip(line).replace(/^📝\s*/, '') }); continue; }
      if (memo && isList(line)) items.push({ f, line: strip(line) });
    }
  });
  if (!items.length) return h('div', { class: 'card empty' }, '미정 항목이 없어요.');
  const byFile = {};
  for (const it of items) (byFile[it.f.path] ||= []).push(it);
  return h('div', {},
    h('p', { class: 'muted' }, `문서에 📝, ❓로 표시된 미정 항목 ${items.length}개를 모았어요.`),
    Object.entries(byFile).map(([path, list]) => h('div', { class: 'card' },
      h('h2', {}, h('a', { href: `#/scenario/docs/${path}` }, path.split('/').pop().replace(/\.md$/, ''))),
      h('ul', { class: 'md' }, list.map(it => h('li', { html: renderMarkdown(it.line).replace(/^<p>|<\/p>$/g, '') }))))));
}
