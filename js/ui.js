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
