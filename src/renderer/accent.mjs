import {
  analyzeWallpaperPixels,
  complementaryRgb,
  contrastingNeutral,
  normalizeRgb,
} from '../accent-color.mjs';

const SAMPLE_EDGE = 64;

function cssRgb(rgb, alpha = null) {
  const channels = rgb.join(' ');
  return alpha === null ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

export function applyAccentState(root, state, { reducedMotion = false } = {}) {
  const rgb = normalizeRgb(state?.rgb);
  const luminance = state?.wallpaperLuminance;
  if (!root?.style || !rgb || typeof state.source !== 'string'
      || !Number.isInteger(state.transitionDurationMs)
      || state.transitionDurationMs < 0 || state.transitionDurationMs > 5000
      || (luminance !== undefined && luminance !== null
        && (!Number.isFinite(luminance) || luminance < 0 || luminance > 1))) return false;
  const dark = rgb.map((channel) => Math.round(channel * 0.695));
  root.style.setProperty('--accent', cssRgb(rgb));
  root.style.setProperty('--accent-dark', cssRgb(dark));
  root.style.setProperty('--accent-shadow', cssRgb(rgb, 0.76));
  root.style.setProperty('--accent-glow', cssRgb(rgb, 0.75));
  root.style.setProperty('--accent-audio-primary', cssRgb(rgb));
  root.style.setProperty('--accent-audio-complement', cssRgb(complementaryRgb(rgb)));
  if (Number.isFinite(luminance)) {
    root.style.setProperty('--accent-audio-neutral', cssRgb(contrastingNeutral(luminance)));
  }
  root.style.setProperty('--accent-transition-ms', `${reducedMotion ? 0 : state.transitionDurationMs}ms`);
  root.dataset.accentSource = state.source;
  return true;
}

export function analyzeWallpaperImage(image, {
  createCanvas = () => document.createElement('canvas'),
} = {}) {
  if (!image || !Number.isFinite(image.naturalWidth) || image.naturalWidth < 1
      || !Number.isFinite(image.naturalHeight) || image.naturalHeight < 1) return null;
  const scale = SAMPLE_EDGE / Math.max(image.naturalWidth, image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = createCanvas();
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, width, height);
  return analyzeWallpaperPixels(context.getImageData(0, 0, width, height).data);
}
