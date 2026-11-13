// Small DOM helpers shared by every room.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Like el.replaceChildren but skips null/false, the same way h() does.
export function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false).map(k => k instanceof Node ? k : document.createTextNode(String(k))));
  return el;
}

export function toast(msg, isError = false) {
  const box = document.getElementById('toast');
  const t = h('div', { class: isError ? 'err' : '' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), isError ? 6000 : 2600);
}

export function modal(title, body, actions = [{ label: '닫기', value: null }]) {
  return new Promise(resolve => {
    const close = v => { bg.remove(); resolve(v); };
    const bg = h('div', { class: 'modal-bg', onclick: e => { if (e.target === bg) close(null); } },
      h('div', { class: 'modal' },
        h('h3', {}, title),
        body,
        h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'flex-end' } },
          actions.map(a => h('button', { class: `btn ${a.primary ? 'primary' : ''} ${a.danger ? 'danger' : ''}`, onclick: () => close(typeof a.value === 'function' ? a.value() : a.value) }, a.label))),
      ));
    bg._close = close;
    document.body.append(bg);
    bg.querySelector('input,textarea')?.focus();
  });
}

// Close the top-most open modal (used by actions inside a modal).
export function closeModal(value = null) {
  const all = document.querySelectorAll('.modal-bg');
  all[all.length - 1]?._close?.(value);
}

export async function confirmBox(text, okLabel = '확인') {
  return modal('확인', h('p', {}, text), [{ label: '취소', value: false }, { label: okLabel, value: true, primary: true }]);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '방금';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function loading(text = '불러오는 중…') {
  return h('div', { class: 'empty' }, text);
}

export function errorBox(e) {
  console.error(e);
  return h('div', { class: 'card', style: { borderColor: '#e2b9b2' } }, h('b', {}, '문제가 생겼어요'), h('p', { class: 'muted' }, e.message || String(e)));
}

// 목록 페이지 나누기 (사용자 11/13: "모든 편집실을 통틀어 게시물의 갯수가 많아지면 적당한 분량으로 나눠서 페이지 처리").
// items 를 size 개씩 보여 주고 위·아래에 [‹ 이전] 1 2 … [다음 ›]. 보던 쪽은 탭마다 기억(sessionStorage, key).
export function paged(items, render, { key = location.hash, size = 10, tag = 'div', cls = '' } = {}) {
  const wrap = h('div', { class: 'paged' });
  const pages = Math.ceil(items.length / size);
  const mem = 'pg:' + key;
  let p = Math.min(Math.max(0, +sessionStorage.getItem(mem) || 0), Math.max(0, pages - 1));
  const list = h(tag, { class: cls });
  const bar = () => {
    if (pages <= 1) return null;
    const btn = (i, label, dis, on) => h('button', { class: `btn small ${on ? 'primary' : ''}`, disabled: dis, onclick: () => { p = i; draw(true); } }, label);
    const nums = [];
    let last = -1;
    for (let i = 0; i < pages; i++) {
      if (i === 0 || i === pages - 1 || Math.abs(i - p) <= 2) {
        if (last >= 0 && i - last > 1) nums.push(h('span', { class: 'muted' }, '…'));
        nums.push(btn(i, String(i + 1), false, i === p));
        last = i;
      }
    }
    return h('div', { class: 'pager' }, btn(p - 1, '‹ 이전', p === 0), nums, btn(p + 1, '다음 ›', p >= pages - 1),
      h('span', { class: 'muted pager-info' }, `${items.length}개 중 ${p * size + 1}–${Math.min(items.length, (p + 1) * size)}`));
  };
  const draw = scroll => {
    sessionStorage.setItem(mem, p);
    fill(list, items.slice(p * size, (p + 1) * size).map(render));
    fill(wrap, bar(), list, bar());
    if (scroll) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  draw(false);
  return wrap;
}

// 마우스를 올리면 그림을 크게 (사용자 11/13: 스토리 룸 일러스트 교체 때 "미리보기 이미지가 마우스 오버 했을 때 크게 보여야").
// 터치 화면(마우스 없음)에서는 쓰지 않음 — 그때는 카드의 🔍 버튼으로 크게 봄.
let hz = null;
export function hideHoverZoom() { hz?.classList.remove('on'); }
export function hoverZoom(el, getUrl) {
  if (!hz) { hz = h('div', { class: 'hover-zoom' }, h('img')); document.body.append(hz); }
  const place = e => {
    const vw = innerWidth, vh = innerHeight;
    const img = hz.firstChild;
    const ratio = img.naturalWidth ? img.naturalHeight / img.naturalWidth : 9 / 16;
    let w = Math.min(vw * 0.6, 1100);
    if (w * ratio > vh * 0.86) w = vh * 0.86 / ratio;
    const left = e.clientX < vw / 2 ? Math.min(vw - w - 12, e.clientX + 28) : Math.max(12, e.clientX - w - 28);
    const top = Math.min(Math.max(12, e.clientY - w * ratio / 2), vh - w * ratio - 12);
    Object.assign(hz.style, { left: left + 'px', top: top + 'px', width: w + 'px' });
  };
  el.addEventListener('mouseenter', e => {
    const u = getUrl();
    if (!u || matchMedia('(hover: none)').matches) return;
    hz.firstChild.onload = () => place(e);
    hz.firstChild.src = u;
    hz.classList.add('on');
    place(e);
  });
  el.addEventListener('mousemove', e => hz.classList.contains('on') && place(e));
  el.addEventListener('mouseleave', hideHoverZoom);
}
