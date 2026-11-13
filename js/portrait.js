// Dialogue-box portrait layout shared by the story preview and the character room.
// Every portrait is scaled so the eye-to-chin distance is the same, then placed so the
// face sits at a fixed spot. The portrait is never cut on its right side: instead the
// dialogue text is pushed right so it starts just past the portrait.

export const LAYOUT = {
  boxLeft: 0.03, boxBottom: 0.10, boxHeight: 0.28, // dialogue box, fractions of the stage
  faceX: 0.135,       // face center x
  chinY: 0.73,        // chin y (the box top is at 0.62, so the head rises above the box)
  eyeToChin: 0.078,   // eye-to-chin distance (fraction of stage height)
  minTextX: 0.25,     // the text never starts left of this
  maxTextX: 0.40,     // ...or right of this
  textGap: 0.018,     // space between the portrait and the text
};

// Dialogue settings shared with the game (data/ui.json → dialogue). Pixel values are in the
// game's 1280×720 screen and get scaled to the preview stage.
export const DEFAULT_DIALOGUE = {
  box: { left: 0.03, bottom: 0.10, height: 0.28 },
  portrait: { faceX: 0.135, chinY: 0.73, eyeToChin: 0.078 },
  name: { x: 0, y: 0, size: 21 },
  text: { x: 0, y: 0, size: 22 },
  noPortraitPad: 66,
  // 영역 나누기: the box is split into a portrait area and a text area by a divider.
  //   on        false = old automatic layout (text is pushed right of the portrait, nothing is cut)
  //   side      which side the portrait is on ('left' | 'right')
  //   left/right  divider x for each side, as a fraction of the 16:9 screen width
  //   flipRight mirror the picture when it is on the right
  split: { on: false, side: 'left', left: 0.25, right: 0.75, flipRight: false },
  // 'manual' = face-anchored placement (portrait.faceX/chinY/eyeToChin + per-portrait scale/dx/dy)
  // 'fill'   = the picture's height fills the portrait box (only when split.on); per-portrait values fine-tune it
  portraitFit: 'manual',
  portraitBox: { top: 0.47 },   // top of the portrait box (fraction of screen height). Its bottom is the dialogue box bottom.
  // text padding in 1280×720 px: top, the gap on the portrait/divider side, the gap on the frame-edge side
  textPad: { top: 20, portraitSide: 23, edgeSide: 48 },
  // 일러스트가 떠 있을 때만 (결정 D-079): portrait = 초상화 보이기, boxAlpha = 대화창 바탕 진하기 (1 = 일러스트가 없을 때와 같음)
  overCg: { portrait: false, boxAlpha: 0.72 },
};
export let DIALOGUE = structuredClone(DEFAULT_DIALOGUE);

export function applyDialogue(cfg = {}) {
  const d = structuredClone(DEFAULT_DIALOGUE);
  for (const k of Object.keys(d)) if (cfg[k] !== undefined) d[k] = typeof d[k] === 'object' ? { ...d[k], ...cfg[k] } : cfg[k];
  DIALOGUE = d;
  Object.assign(LAYOUT, { boxLeft: d.box.left, boxBottom: d.box.bottom, boxHeight: d.box.height, faceX: d.portrait.faceX, chinY: d.portrait.chinY, eyeToChin: d.portrait.eyeToChin });
  return d;
}

const loaded = new WeakMap();
let FRAME = null; // { url, margin } — the game's dialogue frame picture (data/ui.json → dialogueFrame)
// Reads data/ui.json once per store and applies its dialogue settings.
export async function loadDialogueLayout(store) {
  if (!loaded.has(store)) loaded.set(store, store.getJSON('data/ui.json', {}).then(async r => {
    const ui = r.data || {};
    const d = applyDialogue(ui.dialogue || {});
    FRAME = null;
    const fr = ui.dialogueFrame;
    if (fr?.file) { try { FRAME = { url: await store.blobUrl(fr.file), margin: fr.margin || [60, 56, 60, 56] }; } catch { FRAME = null; } }
    return d;
  }).catch(() => applyDialogue({})));
  return loaded.get(store);
}
export function forgetDialogueLayout(store) { loaded.delete(store); }

// Box size/position and name/text style on a .pv-stage (with or without a portrait).
// pad: { left, right } css px from the box edges to the text (given by the portrait layer).
export function layoutStage(stage, pad = null) {
  const box = stage?.querySelector('.pv-box');
  if (!box) return;
  const W = stage.clientWidth, H = stage.clientHeight, k = W / 1280, d = DIALOGUE;
  Object.assign(box.style, { left: `${d.box.left * 100}%`, right: `${d.box.left * 100}%`, bottom: `${d.box.bottom * 100}%`, height: `${d.box.height * 100}%` });
  if (pad) { box.style.paddingLeft = `${Math.round(pad.left)}px`; box.style.paddingRight = `${Math.round(pad.right)}px`; }
  else if (box.classList.contains('noportrait')) { box.style.paddingLeft = `${Math.round(d.noPortraitPad * k)}px`; box.style.paddingRight = `${Math.round(d.textPad.edgeSide * k)}px`; }
  box.style.paddingTop = `${Math.round(d.textPad.top * k)}px`;
  if (FRAME) {
    // same 9-slice frame as the game, drawn by a child so the text padding stays measured from the box edge
    let fr = box.querySelector(':scope > .pv-frame');
    if (!fr) { fr = document.createElement('div'); fr.className = 'pv-frame'; box.prepend(fr); }
    const [ml, mt, mr, mb] = FRAME.margin;
    Object.assign(fr.style, { borderWidth: `${mt * k}px ${mr * k}px ${mb * k}px ${ml * k}px`, borderImage: `url(${FRAME.url}) ${mt} ${mr} ${mb} ${ml} fill stretch` });
    box.classList.add('framed');
  }
  const name = box.querySelector('.pv-name'), text = box.querySelector('.pv-text');
  if (name) Object.assign(name.style, { fontSize: `${(d.name.size * k).toFixed(1)}px`, transform: `translate(${d.name.x * k}px, ${d.name.y * k}px)` });
  if (text) Object.assign(text.style, { fontSize: `${(d.text.size * k).toFixed(1)}px`, transform: `translate(${d.text.x * k}px, ${d.text.y * k}px)` });
}

export function frameFor(char, emotion) {
  const base = { eye: 0.35, chin: 0.5, cx: 0.5, scale: 1, dx: 0, dy: 0, ...(char?.portraitFrame || {}) };
  return { ...base, ...(char?.portraitFrames?.[emotion] || {}) };
}

// Which side the portrait is on right now ('left' unless the split layout says otherwise).
export function sideNow(side) {
  const d = DIALOGUE;
  if (!d.split.on) return 'left';
  return (side || d.split.side) === 'right' ? 'right' : 'left';
}

// The portrait box of the split layout on a stage W×H: x0..x1 (box edge ↔ divider), top..bottom.
export function portraitArea(W, H, side) {
  const d = DIALOGUE, L = LAYOUT, right = sideNow(side) === 'right';
  const split = d.split[right ? 'right' : 'left'] * W;
  return { split, x0: right ? split : L.boxLeft * W, x1: right ? (1 - L.boxLeft) * W : split, top: d.portraitBox.top * H, bottom: (1 - L.boxBottom) * H };
}

// Returns css pixel box {left, top, width, height} for an image of natural size w×h on a stage W×H.
// (The game does the same sum in story_player.gd → _place_portrait.)
// mid: the middle of the drawn (non-transparent) part of the picture, 0..1 of its width (see contentMid).
export function placePortrait(w, h, frame, W, H, side, mid = 0.5) {
  const L = LAYOUT, d = DIALOGUE;
  const right = sideNow(side) === 'right', dir = right ? -1 : 1;
  const flip = right && d.split.flipRight;
  const cx = flip ? 1 - frame.cx : frame.cx;
  if (d.split.on && d.portraitFit === 'fill') {
    // fill: the picture is as tall as the portrait box, stands on the box bottom, and the PICTURE
    // (its drawn part, not the face) is centred in the area — so every portrait lines up the same way.
    const a = portraitArea(W, H, side);
    const height = Math.max(8, a.bottom - a.top) * (frame.scale || 1), width = w * height / h;
    const m = flip ? 1 - mid : mid;
    return { left: (a.x0 + a.x1) / 2 + dir * (frame.dx || 0) * W - m * width, top: a.bottom + (frame.dy || 0) * H - height, width, height };
  }
  const s = (L.eyeToChin * H * (frame.scale || 1)) / Math.max(0.02, (frame.chin - frame.eye) * h);
  const width = w * s, height = h * s;
  const face = right ? 1 - L.faceX - (frame.dx || 0) : L.faceX + (frame.dx || 0);
  const left = face * W - cx * width;
  const top = L.chinY * H + (frame.dy || 0) * H - frame.chin * height;
  return { left, top, width, height };
}

// For each row of the image, how far right the drawn (non-transparent) part reaches (0..1).
const profiles = new Map();
function rightProfile(img) {
  if (profiles.has(img.src)) return profiles.get(img.src);
  let prof = null;
  try {
    const rows = 160, cols = Math.max(16, Math.round(rows * img.naturalWidth / img.naturalHeight));
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, cols, rows);
    const px = g.getImageData(0, 0, cols, rows).data;
    prof = new Float32Array(rows);
    let lo = cols, hi = 0;   // leftmost / rightmost drawn column of the whole picture
    for (let y = 0; y < rows; y++) {
      let r = 0;
      for (let x = cols - 1; x >= 0; x--) if (px[(y * cols + x) * 4 + 3] > 40) { r = (x + 1) / cols; hi = Math.max(hi, x + 1); break; }
      for (let x = 0; x < cols; x++) if (px[(y * cols + x) * 4 + 3] > 40) { lo = Math.min(lo, x); break; }
      prof[y] = r;
    }
    prof.mid = hi > lo ? (lo + hi) / 2 / cols : 0.5;
  } catch { prof = null; } // cross-origin image: fall back to the image box
  profiles.set(img.src, prof);
  return prof;
}

// The middle of the drawn part of the picture, 0..1 of its width (0.5 when it cannot be read).
// (The game does the same in story_player.gd → _content_mid.)
export function contentMid(img) {
  return rightProfile(img)?.mid ?? 0.5;
}

// How far right the portrait reaches between stage rows y0..y1 (css px).
function reachRight(img, r, y0, y1) {
  const prof = rightProfile(img);
  if (!prof) return r.left + r.width;
  const n = prof.length;
  const a = Math.max(0, Math.floor((y0 - r.top) / r.height * n)), b = Math.min(n - 1, Math.ceil((y1 - r.top) / r.height * n));
  let m = 0;
  for (let i = a; i <= b; i++) m = Math.max(m, prof[i]);
  return r.left + m * r.width;
}

// Builds the portrait layer: a box over the stage, ending at the dialogue box bottom, with the image in it.
// Once placed it also sets the dialogue box's paddings so the text sits in its own area.
// Split layout: the layer also ends at the divider, so the picture is cut on the text side only
// (it may still spill over the outer edge and the top of the dialogue box).
export function portraitLayer(url, char, emotion, side) {
  const L = LAYOUT;
  const clip = document.createElement('div');
  clip.className = 'pv-pclip';
  const img = document.createElement('img');
  img.className = 'pv-pimg';
  clip.append(img);
  const fit = () => {
    const stage = clip.parentElement;
    if (!stage || !img.naturalWidth) return;
    const d = DIALOGUE, W = stage.clientWidth, H = stage.clientHeight, k = W / 1280;
    const r = placePortrait(img.naturalWidth, img.naturalHeight, frameFor(char, emotion), W, H, side, d.split.on && d.portraitFit === 'fill' ? contentMid(img) : 0.5);
    const boxTop = (1 - L.boxBottom - L.boxHeight) * H, boxBottom = (1 - L.boxBottom) * H;
    const right = sideNow(side) === 'right';
    let cl = 0, cw = W, pad;
    if (d.split.on) {
      const a = portraitArea(W, H, side);
      if (right) { cl = a.split; cw = W - a.split; } else cw = a.split;
      const inner = d.textPad.portraitSide * k, outer = d.textPad.edgeSide * k;
      pad = right ? { left: outer, right: (1 - L.boxLeft) * W - a.split + inner } : { left: a.split - L.boxLeft * W + inner, right: outer };
    } else {
      // Push the text right of whatever part of the portrait overlaps the box.
      const reach = reachRight(img, r, boxTop, boxBottom);
      const textX = Math.min(L.maxTextX * W, Math.max(L.minTextX * W, reach + L.textGap * W));
      pad = { left: textX - L.boxLeft * W, right: d.textPad.edgeSide * k };
    }
    Object.assign(clip.style, { left: `${cl}px`, width: `${Math.max(0, cw)}px`, height: `${boxBottom}px` });
    Object.assign(img.style, { left: `${r.left - cl}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, transform: right && d.split.flipRight ? 'scaleX(-1)' : '' });
    clip._rect = r;   // where the whole picture is, in stage px (before cutting)
    const box = stage.querySelector('.pv-box:not(.dir):not(.noportrait)');
    layoutStage(stage, box ? pad : null);

    // 초상화 가장자리 흐림은 쓰지 않는다 (게임과 같게). 위치는 UI 룸에서 직접 맞춘다.
    img.style.maskImage = img.style.webkitMaskImage = '';
    clip._onfit?.();
  };
  img.onload = fit;
  img.src = url;
  clip._fit = fit;
  // Keep it placed when the window size changes.
  const onResize = () => { if (clip.isConnected) fit(); else window.removeEventListener('resize', onResize); };
  window.addEventListener('resize', onResize);
  // The layer is often attached after the image loads; place it once it's in the page.
  requestAnimationFrame(() => requestAnimationFrame(fit));
  return clip;
}
