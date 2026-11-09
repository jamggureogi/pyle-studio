// Rooms that are not built yet: show what is coming, plus their request box.
import { h } from '../ui.js';
import { requestPanel } from './requests.js';

const INFO = {
  system: ['전투 규칙, 직업·전직 트리, 능력치 성장표, 기술 목록, 적·마물, 아이템·장비를 표와 그래프로 보고 고치는 곳이에요.', '지금은 시나리오룸의 "게임시스템" 문서에서 전투 규칙을 볼 수 있어요.'],
  character: ['인물별 초상화(표정), 필드 스프라이트, 전투 스프라이트, 전투 애니메이션을 등록·교체·승인하는 곳이에요.', '그림 여러 장을 끌어다 놓아 한 번에 올릴 수 있게 만들 예정이에요.'],
  story: ['장 → 장면 → 대사 순서로 스토리를 편집하는 곳이에요. 화자, 표정, 연출, 발생 조건, 대사창 미리보기를 넣을 예정이에요.', '이전 대사 편집실의 확정 대사를 그대로 옮겨 올 거예요.'],
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
