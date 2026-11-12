// 그림 메뉴 (메인 메뉴): 모든 그림 — 적용(게임에 쓰는 중) / 보관. 수정 요청, 그림 올리기.
import { h } from '../ui.js';
import { libraryView, uploadView } from './character.js';
import { requestPanel } from './requests.js';

export async function render(ctx, rest) {
  const tab = ['list', 'upload', 'requests'].includes(rest[0]) ? rest[0] : 'list';
  const page = h('div', { class: 'page wide' },
    h('h1', {}, '🗂 그림'),
    h('p', { class: 'sub' }, '게임의 모든 그림이에요. Claude가 검수해서 바로 게임에 적용하고, 쓰지 않는 그림은 보관해요. 적용된 그림 중 마음에 안 드는 것은 눌러서 "수정 요청"을 남겨 주세요.'),
    h('div', { class: 'tabs' },
      h('a', { href: '#/art/list', class: tab === 'list' ? 'on' : '' }, '그림 목록'),
      h('a', { href: '#/art/upload', class: tab === 'upload' ? 'on' : '' }, '그림 올리기'),
      h('a', { href: '#/art/requests', class: tab === 'requests' ? 'on' : '' }, '요청함')));
  if (tab === 'requests') page.append(requestPanel(ctx, 'art'));
  else if (tab === 'upload') page.append(uploadView(ctx));
  else page.append(await libraryView(ctx, rest.slice(1)));
  return page;
}
