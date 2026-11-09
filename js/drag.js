// Pointer-based drag to reorder (works with mouse and touch). Shows an insertion line
// where the dragged item will land, and scrolls when the pointer nears an edge.

let indicator = null;
function line() {
  if (!indicator) { indicator = document.createElement('div'); indicator.className = 'drop-line'; document.body.append(indicator); }
  return indicator;
}

function scrollParent(el) {
  for (let p = el; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight) return p;
  }
  return document.querySelector('main');
}

// handle: element the user grabs. src: element being moved.
// accept(targetEl): may the item be dropped on/near this target?
// onDrop(targetEl, before): perform the move.
export function makeDraggable(handle, src, { accept, onDrop }) {
  handle.classList.add('drag-handle');
  handle.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
  handle.title = handle.title || '끌어서 옮기기';
  handle.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handle.setPointerCapture(e.pointerId);
    const rect = src.getBoundingClientRect();
    const ghost = src.cloneNode(true);
    Object.assign(ghost.style, { position: 'fixed', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, pointerEvents: 'none', opacity: '0.85', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,.2)' });
    ghost.classList.add('drag-ghost');
    document.body.append(ghost);
    src.classList.add('dragging');
    const offY = e.clientY - rect.top;
    let target = null, before = true, timer = null, lastY = e.clientY, lastX = e.clientX;

    const find = (x, y) => {
      ghost.style.display = 'none';
      const el = document.elementFromPoint(x, y)?.closest('[data-drop]');
      ghost.style.display = '';
      return el && el !== src && !src.contains(el) && accept(el) ? el : null;
    };
    const update = (x, y) => {
      ghost.style.top = `${y - offY}px`;
      target = find(x, y);
      const ln = line();
      if (!target) { ln.style.display = 'none'; return; }
      const r = target.getBoundingClientRect();
      before = y < r.top + r.height / 2;
      Object.assign(ln.style, { display: 'block', left: `${r.left}px`, width: `${r.width}px`, top: `${(before ? r.top : r.bottom) - 2}px` });
    };
    const autoScroll = () => {
      const sp = scrollParent(document.elementFromPoint(lastX, lastY) || src);
      if (sp) {
        const r = sp.getBoundingClientRect(), edge = 60;
        if (lastY < r.top + edge) sp.scrollTop -= 14;
        else if (lastY > r.bottom - edge) sp.scrollTop += 14;
      }
      update(lastX, lastY);
    };
    const move = ev => { lastX = ev.clientX; lastY = ev.clientY; update(lastX, lastY); };
    const up = () => {
      clearInterval(timer);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      ghost.remove();
      src.classList.remove('dragging');
      line().style.display = 'none';
      if (target) onDrop(target, before);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    timer = setInterval(autoScroll, 30);
    update(e.clientX, e.clientY);
  });
  return handle;
}

// Move an item inside one array: from index → before/after target index.
export function moveInArray(arr, from, to, before) {
  let dest = before ? to : to + 1;
  const [item] = arr.splice(from, 1);
  if (from < dest) dest--;
  arr.splice(dest, 0, item);
}
