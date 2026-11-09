// Dashboard: request status, approvals waiting, recent changes.
import { h, fmtDate } from '../ui.js';
import { roomName } from '../app.js';

export async function render(ctx) {
  const [reqs, assets, commits, decisions] = await Promise.all([
    ctx.store.getJSON('data/requests.json', { requests: [] }).then(r => r.data.requests || []).catch(() => []),
    ctx.store.getJSON('data/asset_registry.json', { assets: [] }).then(r => r.data.assets || []).catch(() => []),
    ctx.store.commits(12).catch(() => []),
    ctx.store.getJSON('data/decisions.json', { decisions: [] }).then(r => (r.data.decisions || []).filter(d => d.status === '대기')).catch(() => []),
  ]);
  const by = s => reqs.filter(r => r.status === s);
  const candidates = assets.filter(a => a.status === '후보');
  const stat = (n, label, cls, href) => h('a', { href, style: { textDecoration: 'none', color: 'inherit' } },
    h('div', { class: 'card', style: { textAlign: 'center', margin: 0 } },
      h('div', { style: { fontSize: '28px', fontWeight: 700 } }, n), h('span', { class: `badge ${cls}` }, label)));

  return h('div', { class: 'page' },
    h('h1', {}, '신관전승 편집실'),
    h('p', { class: 'sub' }, '게임의 모든 자료를 여기서 보고 고쳐요. 여기서 저장한 내용은 Claude와 게임이 같이 봐요.'),
    h('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', marginBottom: '14px' } },
      stat(by('대기').length, '요청 대기', 'warn', '#/requests'),
      stat(by('진행중').length, '진행 중', 'info', '#/requests'),
      stat(by('완료').length, '완료', 'ok', '#/requests'),
      stat(candidates.length, '승인 대기 그림', 'danger', '#/character/library/후보'),
      stat(decisions.length, '결정 대기', 'warn', '#/decide'),
    ),
    h('div', { class: 'grid' },
      h('div', { class: 'card' },
        h('h2', {}, '🗳 결정해 주세요'),
        decisions.length
          ? h('ul', { class: 'list' }, decisions.map(d => h('li', {}, h('a', { href: '#/decide' }, h('b', {}, d.id), ' ', d.title))))
          : h('div', { class: 'empty' }, '결정할 것이 없어요.')),
      h('div', { class: 'card' },
        h('h2', {}, '📮 대기 중인 요청'),
        by('대기').length
          ? h('ul', { class: 'list' }, by('대기').slice(0, 6).map(r => h('li', {}, h('b', {}, r.title), h('div', { class: 'muted', style: { fontSize: '12px' } }, `${roomName(r.room)} · ${fmtDate(r.createdAt)}`))))
          : h('div', { class: 'empty' }, '대기 중인 요청이 없어요.')),
      h('div', { class: 'card' },
        h('h2', {}, '🕘 최근 변경'),
        commits.length
          ? h('ul', { class: 'list' }, commits.map(c => h('li', {},
              h('div', {}, c.message.split('\n')[0]),
              h('div', { class: 'muted', style: { fontSize: '12px' } }, `${c.author} · ${fmtDate(c.date)}`))))
          : h('div', { class: 'empty' }, '기록이 없어요.')),
    ));
}
