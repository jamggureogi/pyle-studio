// Dialogue-box portrait layout shared by the story preview and the character room.
// Every portrait is scaled so the eye-to-chin distance is the same, then placed so the
// chin sits at the top edge of the dialogue box and the face center at a fixed x.

export const LAYOUT = {
  boxLeft: 0.03, boxRight: 0.03, boxBottom: 0.10, boxHeight: 0.28, // fractions of the stage
  textLeft: 0.31,      // where the dialogue text starts (fraction of stage width)
  clipRight: 0.30,     // portraits are trimmed right of this line so they never cover the text
  faceX: 0.155,        // face center x
  chinY: 0.665,         // chin y (just above the box top at 0.62)
  eyeToChin: 0.115,    // eye-to-chin distance (fraction of stage height)
};

export function frameFor(char, emotion) {
  const base = { eye: 0.35, chin: 0.5, cx: 0.5, scale: 1, dx: 0, dy: 0, ...(char?.portraitFrame || {}) };
  return { ...base, ...(char?.portraitFrames?.[emotion] || {}) };
}

// Returns css pixel box {left, top, width, height} for an image of natural size w×h on a stage W×H.
export function placePortrait(w, h, frame, W, H) {
  const L = LAYOUT;
  const s = (L.eyeToChin * H * (frame.scale || 1)) / Math.max(0.02, (frame.chin - frame.eye) * h);
  const width = w * s, height = h * s;
  const left = L.faceX * W + (frame.dx || 0) * W - frame.cx * width;
  const top = L.chinY * H + (frame.dy || 0) * H - frame.chin * height;
  return { left, top, width, height };
}

// Builds the portrait layer: a clip box (left side of the stage, down to the box bottom) with the image in it.
export function portraitLayer(url, char, emotion) {
  const clip = document.createElement('div');
  clip.className = 'pv-pclip';
  const img = document.createElement('img');
  img.className = 'pv-pimg';
  clip.append(img);
  const fit = () => {
    const stage = clip.parentElement;
    if (!stage || !img.naturalWidth) return;
    const W = stage.clientWidth, H = stage.clientHeight;
    const r = placePortrait(img.naturalWidth, img.naturalHeight, frameFor(char, emotion), W, H);
    Object.assign(clip.style, { width: `${LAYOUT.clipRight * W}px`, height: `${(1 - LAYOUT.boxBottom) * H}px` });
    Object.assign(img.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  img.onload = fit;
  img.src = url;
  clip._fit = fit;
  return clip;
}
