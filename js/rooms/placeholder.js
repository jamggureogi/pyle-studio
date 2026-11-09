// Rooms that are not built yet: show what is coming, plus their request box.
import { h } from '../ui.js';
import { requestPanel } from './requests.js';

const INFO = {
  map: ['타일로 맵을 그리고, NPC·출입구·이벤트를 배치하고, 스토리 장면과 연결하는 곳이에요.', '확정 타일세트 라이브러리도 여기에 들어가요.'],
};

export async function render(ctx, rest, def) {
  const [desc, note] = INFO[def.id] || ['', ''];
  return h('div', { class: 'page' },
    h('h1', {}, `${def.ico} ${def.name}룸`),
    h('p', { class: 'sub' }, desc),
    h('div', { class: 'card' }, h('b', {}, '🚧 만드는 중'), h('p', { class: 'muted', style: { margin: '6px 0 0' } }, note)),
    h('h2', { style: { fontSize: '17px', margin: '24px 0 10px' } }, '이 룸의 요청함'),
    requestPanel(ctx, def.id));
}
