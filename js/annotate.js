// 그림 위에 펜으로 표시하기 (사용자 11/23): 확인 룸·결정 룸의 스크린샷에 빨간 펜·연필 등으로 그려서 의견과 함께 보냄.
// openAnnotator(url, title) → Promise<Blob|null>  (완료하면 표시한 그림 한 장, 취소하면 null)
// uploadMarks(store, marks, prefix) → 올린 경로 목록   marks = [{ blob, src }]
import { h, toast } from './ui.js';

const TOOLS = [
  { key: 'red', label: '🔴 빨간 펜', color: '#ff2a2a', width: 6, alpha: 1 },
  { key: 'pencil', label: '✏️ 연필', color: '#1d1d1d', width: 3, alpha: 1 },
  { key: 'white', label: '⚪ 흰 펜', color: '#ffffff', width: 5, alpha: 1 },
  { key: 'yellow', label: '🖍 형광펜', color: '#ffe600', width: 22, alpha: 0.38 },
  { key: 'arrow', label: '➜ 화살표', color: '#ff2a2a', width: 6, alpha: 1, shape: 'arrow' },
  { key: 'box', label: '▭ 네모', color: '#ff2a2a', width: 5, alpha: 1, shape: 'box' },
  { key: 'circle', label: '◯ 동그라미', color: '#ff2a2a', width: 5, alpha: 1, shape: 'ellipse' },
];
const SIZES = [['가늘게', 0.6], ['보통', 1], ['굵게', 1.8]];

export function openAnnotator(url, title = '') {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => start();
    img.onerror = () => { toast('그림을 불러오지 못했어요.', true); resolve(null); };
    img.src = url;
    const strokes = [];
    let tool = TOOLS[0], size = 1, cur = null;
    let base, ink, wrap, root;

    function start() {
      const W = img.naturalWidth, H = img.naturalHeight;
      base = h('canvas', { width: W, height: H, class: 'ann-base' });
      ink = h('canvas', { width: W, height: H, class: 'ann-ink' });
      base.getContext('2d').drawImage(img, 0, 0);
      wrap = h('div', { class: 'ann-stage' }, h('div', { class: 'ann-box' }, base, ink));
      const toolBtns = h('div', { class: 'ann-tools' });
      const sizeBtns = h('div', { class: 'ann-tools' });
      const drawBar = () => {
        toolBtns.replaceChildren(...TOOLS.map(t => h('button', { class: `btn small ${tool === t ? 'primary' : ''}`, onclick: () => { tool = t; drawBar(); } }, t.label)));
        sizeBtns.replaceChildren(...SIZES.map(([l, v]) => h('button', { class: `btn small ${size === v ? 'primary' : ''}`, onclick: () => { size = v; drawBar(); } }, l)));
      };
      drawBar();
      const close = v => { root.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const done = () => {
        if (!strokes.length) return toast('그림 위에 먼저 표시해 주세요. 표시 없이 닫으려면 [취소].', true);
        const out = h('canvas', { width: W, height: H });
        const g = out.getContext('2d'); g.drawImage(base, 0, 0); g.drawImage(ink, 0, 0);
        out.toBlob(b => close(b), 'image/webp', 0.9);
      };
      const onKey = e => { if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); } if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      root = h('div', { class: 'ann-modal' },
        h('div', { class: 'ann-bar' },
          h('b', { class: 'ann-title' }, title ? `✏️ 표시하기 — ${title}` : '✏️ 그림 위에 표시하기'),
          toolBtns, sizeBtns,
          h('div', { class: 'ann-tools' },
            h('button', { class: 'btn small', onclick: undo }, '↶ 되돌리기'),
            h('button', { class: 'btn small', onclick: () => { strokes.length = 0; redraw(); } }, '🗑 모두 지우기'),
            h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', onclick: () => close(null) }, '취소'),
            h('button', { class: 'btn small primary', onclick: done }, '✔ 완료'))),
        wrap,
        h('div', { class: 'muted ann-hint' }, '마우스·손가락·펜으로 그림 위에 그리세요. 화살표·네모·동그라미는 끌어서 크기를 정해요. [완료]를 누르면 의견과 함께 보낼 그림으로 붙어요.'));
      document.body.append(root);
      ink.addEventListener('pointerdown', down);
      ink.addEventListener('pointermove', move);
      ink.addEventListener('pointerup', up);
      ink.addEventListener('pointercancel', up);
    }
    function pos(e) {
      const r = ink.getBoundingClientRect();
      return [(e.clientX - r.left) * ink.width / r.width, (e.clientY - r.top) * ink.height / r.height];
    }
    // 화면에 작게 보여도 실제 그림 크기에 맞춰 굵기를 키움 (큰 스크린샷에서 선이 너무 가늘지 않게)
    const scaleW = () => Math.max(1, ink.width / 1100);
    function down(e) {
      e.preventDefault(); ink.setPointerCapture(e.pointerId);
      const p = pos(e);
      cur = { t: tool, w: tool.width * size * scaleW(), pts: [p] };
      strokes.push(cur); redraw();
    }
    function move(e) {
      if (!cur) return;
      const p = pos(e);
      if (cur.t.shape) cur.pts[1] = p; else cur.pts.push(p);
      redraw();
    }
    function up() { if (cur && cur.t.shape && cur.pts.length < 2) strokes.pop(); cur = null; redraw(); }
    function undo() { strokes.pop(); redraw(); }
    function redraw() {
      const g = ink.getContext('2d');
      g.clearRect(0, 0, ink.width, ink.height);
      for (const s of strokes) {
        g.save(); g.globalAlpha = s.t.alpha; g.strokeStyle = s.t.color; g.fillStyle = s.t.color; g.lineWidth = s.w; g.lineCap = 'round'; g.lineJoin = 'round';
        if (s.t.key === 'red' || s.t.key === 'arrow' || s.t.key === 'box' || s.t.key === 'circle') { g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = s.w * 0.8; }
        const [a, b] = [s.pts[0], s.pts[1] || s.pts[0]];
        if (s.t.shape === 'box') g.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        else if (s.t.shape === 'ellipse') { g.beginPath(); g.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 + 0.1, Math.abs(b[1] - a[1]) / 2 + 0.1, 0, 0, Math.PI * 2); g.stroke(); }
        else if (s.t.shape === 'arrow') {
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = s.w * 4;
          g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45)); g.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45)); g.closePath(); g.fill();
        } else if (s.pts.length === 1) { g.beginPath(); g.arc(a[0], a[1], s.w / 2, 0, Math.PI * 2); g.fill(); }
        else { g.beginPath(); g.moveTo(a[0], a[1]); for (const p of s.pts.slice(1)) g.lineTo(p[0], p[1]); g.stroke(); }
        g.restore();
      }
    }
  });
}

function blobToB64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
}

// 표시한 그림들을 저장소 docs/images/fb/ 에 올리고 경로 목록을 돌려줌
export async function uploadMarks(store, marks, prefix) {
  const out = [];
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  for (let i = 0; i < marks.length; i++) {
    const path = `docs/images/fb/${prefix}_${stamp}_${i + 1}.webp`;
    await store.putBinary(path, await blobToB64(marks[i].blob), null, `표시한 그림: ${prefix}`);
    out.push(path);
  }
  return out;
}

// 카드 안 '표시한 그림' 줄: 작은 미리보기 + ✕
export function marksRow(marks, onChange, editable = true) {
  if (!marks.length) return null;
  return h('div', { class: 'ann-marks' },
    h('span', { class: 'muted', style: { fontSize: '12px' } }, `✏️ 표시한 그림 ${marks.length}장 (의견과 함께 보내요)`),
    ...marks.map((m, i) => h('span', { class: 'ann-mark' },
      h('img', { src: m.url || (m.url = URL.createObjectURL(m.blob)) }),
      editable && h('button', { class: 'ann-x', title: '빼기', onclick: () => { marks.splice(i, 1); onChange(); } }, '✕'))));
}
