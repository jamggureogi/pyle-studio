import { GitHubStore, LocalStore } from './store.js';
import { h, toast, errorBox, loading } from './ui.js';
import * as home from './rooms/home.js';
import * as scenario from './rooms/scenario.js';
import * as requests from './rooms/requests.js';
import * as story from './rooms/story.js';
import * as character from './rooms/character.js';
import * as system from './rooms/system.js';
import * as maproom from './rooms/map.js';
import * as decide from './rooms/decide.js';
import * as review from './rooms/review.js';
import * as codex from './rooms/codex.js';
import * as uiroom from './rooms/ui.js';
import * as writer from './rooms/writer.js';
import * as art from './rooms/art.js';

export const ROOMS = [
  { id: 'home', name: '홈', ico: '🏠', mod: home },
  { id: 'decide', name: '결정', ico: '🗳', mod: decide },
  { id: 'review', name: '확인', ico: '🖼', mod: review },
  { id: 'scenario', name: '시나리오', ico: '📜', mod: scenario },
  { id: 'system', name: '시스템', ico: '⚔️', mod: system },
  { id: 'character', name: '캐릭터', ico: '🧑', mod: character },
  { id: 'art', name: '그림', ico: '🗂', mod: art },
  { id: 'story', name: '스토리', ico: '🎬', mod: story },
  { id: 'writer', name: '작가 제안', ico: '✍️', mod: writer },
  { id: 'map', name: '맵', ico: '🗺️', mod: maproom },
  { id: 'ui', name: 'UI', ico: '🎨', mod: uiroom },
  { id: 'codex', name: '코덱스', ico: '🤝', mod: codex },
  { id: 'requests', name: '요청함', ico: '📮', mod: requests },
];
export const roomName = id => id === 'general' ? '일반' : ROOMS.find(r => r.id === id)?.name || id;

const DEFAULT_REPO = 'jamggureogi/pyle_claude';
const app = document.getElementById('app');
const params = new URLSearchParams(location.search);

function makeStore() {
  if (params.has('local')) return new LocalStore();
  const token = localStorage.getItem('pyle.token');
  if (!token) return null;
  const [owner, repo] = (localStorage.getItem('pyle.repo') || DEFAULT_REPO).split('/');
  return new GitHubStore({ token, owner, repo });
}

let store = makeStore();
const ctx = {
  get store() { return store; },
  go: hash => { location.hash = hash; },
  refreshBadges: () => updateBadges(),
  logout() {
    localStorage.removeItem('pyle.token');
    store = null;
    render();
  },
};

async function connectWith(token, repoStr) {
  const [owner, repo] = repoStr.split('/');
  const s = new GitHubStore({ token, owner, repo });
  await s.check();
  localStorage.setItem('pyle.token', token);
  localStorage.setItem('pyle.repo', `${owner}/${repo}`);
  store = s;
}

// Let the browser's password manager keep the key, so other computers signed into
// the same browser account can fill it in with one click. Nothing is stored online by the studio.
async function rememberInBrowser(token) {
  try {
    if ('PasswordCredential' in window) {
      await navigator.credentials.store(new PasswordCredential({ id: 'pyle-studio', password: token, name: '신광전승 편집실' }));
    }
  } catch { /* the browser may refuse; the normal form save prompt still works */ }
}

async function autoFillFromBrowser() {
  try {
    if (!('PasswordCredential' in window)) return null;
    const c = await navigator.credentials.get({ password: true, mediation: 'optional' });
    return c?.password || null;
  } catch { return null; }
}

function setupPage() {
  const user = h('input', { name: 'username', autocomplete: 'username', value: 'pyle-studio', readonly: true, class: 'hidden-user' });
  const tokenIn = h('input', { name: 'password', type: 'password', placeholder: 'github_pat_로 시작하는 열쇠', autocomplete: 'current-password' });
  const repoIn = h('input', { value: localStorage.getItem('pyle.repo') || DEFAULT_REPO });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, '연결하기');
  const connect = async token => {
    btn.disabled = true;
    try {
      await connectWith(token, repoIn.value.trim());
      await rememberInBrowser(token);
      toast('연결됐어요!');
      render();
    } catch (e) { toast(e.message, true); btn.disabled = false; }
  };
  const form = h('form', { method: 'post', action: '#', onsubmit: e => {
    e.preventDefault();
    const token = tokenIn.value.trim();
    if (!token) return toast('열쇠를 입력해 주세요.', true);
    connect(token);
  } },
    user,
    h('label', { class: 'field' }, h('span', {}, '열쇠 (GitHub 토큰)'), tokenIn),
    h('label', { class: 'field' }, h('span', {}, '게임 자료 저장소'), repoIn),
    h('div', { class: 'row' }, btn));
  // Ask the browser for a saved key right away (one tap on most browsers).
  autoFillFromBrowser().then(t => { if (t && !tokenIn.value) { tokenIn.value = t; toast('브라우저에 저장된 열쇠를 불러왔어요. "연결하기"를 눌러 주세요.'); } });
  return h('div', { class: 'setup' },
    h('div', { class: 'card' },
      h('h1', {}, '신광전승 편집실'),
      h('p', { class: 'muted' }, '열쇠(GitHub 토큰)로 연결해요. 연결할 때 브라우저가 "비밀번호를 저장할까요?"라고 물으면 ', h('b', {}, '저장'), '을 눌러 주세요. 같은 브라우저 계정(구글·마이크로소프트 등)으로 로그인한 다른 컴퓨터에서는 열쇠가 자동으로 채워져요.'),
      form),
    h('div', { class: 'card' },
      h('h2', {}, '열쇠 만드는 방법'),
      h('ol', {},
        h('li', {}, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank' }, 'GitHub 토큰 만들기 페이지'), '를 여세요.'),
        h('li', {}, 'Token name: ', h('b', {}, '신광전승 편집실'), ' / Expiration: 원하는 기간'),
        h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('b', {}, 'pyle_claude'), ' 선택'),
        h('li', {}, 'Permissions에서 ', h('b', {}, '+ Add permissions'), ' → ', h('b', {}, 'Contents'), ' 체크 → 권한을 ', h('b', {}, 'Read and write'), '로 변경 (Metadata는 자동으로 추가돼요)'),
        h('li', {}, '맨 아래 ', h('b', {}, 'Generate token'), ' → 나온 열쇠를 위 칸에 붙여넣기')),
      h('p', { class: 'muted' }, '⚠️ 열쇠는 채팅이나 다른 곳에 붙여넣지 마세요. 잃어버렸으면 같은 페이지에서 새로 만들면 돼요.')));
}

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { room: parts[0] || 'home', rest: parts.slice(1) };
}

let shellMain, navLinks = {};
function buildShell() {
  navLinks = {};
  const nav = h('nav', {}, ROOMS.map(r => {
    const a = h('a', { href: `#/${r.id}` }, h('span', { class: 'ico' }, r.ico), h('span', {}, r.name), h('span', { class: 'badge warn', style: { display: 'none' } }));
    navLinks[r.id] = a;
    return a;
  }));
  shellMain = h('main', { class: 'main' });
  app.replaceChildren(h('div', { class: 'shell' },
    h('aside', { class: 'side' },
      h('div', { class: 'brand' }, '신광전승', h('small', {}, '통합 편집실')),
      nav,
      h('div', { class: 'foot' }, store.label, h('br'), h('a', { href: '#', onclick: e => { e.preventDefault(); ctx.logout(); } }, '로그아웃')),
    ),
    shellMain));
}

async function updateBadges() {
  try {
    const safe = (path, fb) => store.getJSON(path, fb).catch(() => ({ data: fb }));
    const [{ data }, dec, rev, cx] = await Promise.all([safe('data/requests.json', { requests: [] }), safe('data/decisions.json', { decisions: [] }), safe('data/review.json', { items: [] }), safe('data/codex_tasks.json', { tasks: [] })]);
    const special = {
      decide: (dec.data.decisions || []).filter(d => d.status === '대기').length,
      review: (rev.data.items || []).filter(x => x.status === '확인 대기').length,
      codex: (cx.data.tasks || []).filter(t => ['완료', '질문'].includes(t.status)).length,
    };
    const waiting = (data.requests || []).filter(r => r.status === '대기' || r.status === '진행중');
    const drafts = (data.requests || []).filter(r => r.status === '임시저장').length;   // 감독 초안은 요청함에만 표시
    const count = room => waiting.filter(r => room === 'requests' || r.room === room).length + (room === 'requests' ? drafts : 0);
    for (const r of ROOMS) {
      const b = navLinks[r.id]?.querySelector('.badge');
      if (!b) continue;
      const n = r.id === 'home' ? 0 : r.id in special ? special[r.id] : count(r.id);
      b.textContent = n;
      b.style.display = n ? '' : 'none';
    }
  } catch { /* badges are optional */ }
}

let renderToken = 0;
async function render() {
  if (!store) { app.replaceChildren(setupPage()); return; }
  if (!shellMain || !document.body.contains(shellMain)) { buildShell(); updateBadges(); }
  const { room, rest } = parseHash();
  const def = ROOMS.find(r => r.id === room) || ROOMS[0];
  for (const [id, a] of Object.entries(navLinks)) a.classList.toggle('on', id === def.id);
  const my = ++renderToken;
  shellMain.replaceChildren(h('div', { class: 'page' }, loading()));
  try {
    const el = await def.mod.render(ctx, rest, def);
    if (my !== renderToken) return;
    shellMain.replaceChildren(el);
    shellMain.scrollTop = 0;
  } catch (e) {
    if (my !== renderToken) return;
    shellMain.replaceChildren(h('div', { class: 'page' }, errorBox(e)));
  }
}

window.addEventListener('hashchange', render);
render();
