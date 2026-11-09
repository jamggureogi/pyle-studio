import { GitHubStore, LocalStore } from './store.js';
import { h, toast, errorBox, loading } from './ui.js';
import * as home from './rooms/home.js';
import * as scenario from './rooms/scenario.js';
import * as requests from './rooms/requests.js';
import * as placeholder from './rooms/placeholder.js';
import * as story from './rooms/story.js';

export const ROOMS = [
  { id: 'home', name: '홈', ico: '🏠', mod: home },
  { id: 'scenario', name: '시나리오', ico: '📜', mod: scenario },
  { id: 'system', name: '시스템', ico: '⚔️', mod: placeholder },
  { id: 'character', name: '캐릭터', ico: '🧑', mod: placeholder },
  { id: 'story', name: '스토리', ico: '🎬', mod: story },
  { id: 'map', name: '맵', ico: '🗺️', mod: placeholder },
  { id: 'requests', name: '요청함', ico: '📮', mod: requests },
];
export const roomName = id => ROOMS.find(r => r.id === id)?.name || id;

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

function setupPage() {
  const tokenIn = h('input', { type: 'password', placeholder: 'github_pat_로 시작하는 열쇠', autocomplete: 'off' });
  const repoIn = h('input', { value: localStorage.getItem('pyle.repo') || DEFAULT_REPO });
  const btn = h('button', { class: 'btn primary', onclick: connect }, '연결하기');
  async function connect() {
    const token = tokenIn.value.trim();
    if (!token) return toast('열쇠를 입력해 주세요.', true);
    btn.disabled = true;
    const [owner, repo] = repoIn.value.trim().split('/');
    const s = new GitHubStore({ token, owner, repo });
    try {
      await s.check();
      localStorage.setItem('pyle.token', token);
      localStorage.setItem('pyle.repo', `${owner}/${repo}`);
      store = s;
      toast('연결됐어요!');
      render();
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false;
    }
  }
  return h('div', { class: 'setup' },
    h('div', { class: 'card' },
      h('h1', {}, '신관전승 편집실'),
      h('p', { class: 'muted' }, '처음 한 번만 게임 자료 저장소의 열쇠(GitHub 토큰)를 넣어 주세요. 열쇠는 이 브라우저에만 저장되고 다른 곳으로 보내지지 않아요.'),
      h('label', { class: 'field' }, h('span', {}, '열쇠 (GitHub 토큰)'), tokenIn),
      h('label', { class: 'field' }, h('span', {}, '게임 자료 저장소'), repoIn),
      h('div', { class: 'row' }, btn),
    ),
    h('div', { class: 'card' },
      h('h2', {}, '열쇠 만드는 방법'),
      h('ol', {},
        h('li', {}, h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank' }, 'GitHub 토큰 만들기 페이지'), '를 여세요.'),
        h('li', {}, 'Token name: ', h('b', {}, '신관전승 편집실'), ' / Expiration: 원하는 기간'),
        h('li', {}, 'Repository access: ', h('b', {}, 'Only select repositories'), ' → ', h('b', {}, 'pyle_claude'), ' 선택'),
        h('li', {}, 'Permissions에서 ', h('b', {}, '+ Add permissions'), ' → ', h('b', {}, 'Contents'), ' 체크 → 권한을 ', h('b', {}, 'Read and write'), '로 변경 (Metadata는 자동으로 추가돼요)'),
        h('li', {}, '맨 아래 ', h('b', {}, 'Generate token'), ' → 나온 열쇠를 복사해서 위 칸에 붙여넣기'),
      ),
      h('p', { class: 'muted' }, '⚠️ 열쇠는 채팅이나 다른 곳에 붙여넣지 마세요.'),
    ),
  );
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
      h('div', { class: 'brand' }, '신관전승', h('small', {}, '통합 편집실')),
      nav,
      h('div', { class: 'foot' }, store.label, h('br'), h('a', { href: '#', onclick: e => { e.preventDefault(); ctx.logout(); } }, '열쇠 지우기')),
    ),
    shellMain));
}

async function updateBadges() {
  try {
    const { data } = await store.getJSON('data/requests.json', { requests: [] });
    const waiting = (data.requests || []).filter(r => r.status === '대기' || r.status === '진행중');
    const count = room => waiting.filter(r => room === 'requests' || r.room === room).length;
    for (const r of ROOMS) {
      const b = navLinks[r.id]?.querySelector('.badge');
      if (!b) continue;
      const n = r.id === 'home' ? 0 : count(r.id);
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
