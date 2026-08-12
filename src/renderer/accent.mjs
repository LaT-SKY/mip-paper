import { normalizeRgb, selectWallpaperAccent } from '../accent-color.mjs';

const SAMPLE_EDGE = 64;

function cssRgb(rgb, alpha = null) {
  const channels = rgb.join(' ');
  return alpha === null ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`;
}

function mixWithWhite(rgb, amount) {
  return rgb.map((channel) => Math.round(channel + (255 - channel) * amount));
}

export function applyAccentState(root, state, { reducedMotion = false } = {}) {
  const rgb = normalizeRgb(state?.rgb);
  if (!root?.style || !rgb || typeof state.source !== 'string'
      || !Number.isInteger(state.transitionDurationMs)
      || state.transitionDurationMs < 0 || state.transitionDurationMs > 5000) return false;
  const dark = rgb.map((channel) => Math.round(channel * 0.695));
  const audioEnergy = mixWithWhite(rgb, 0.28);
  const audioAux = mixWithWhite(rgb, 0.68);
  root.style.setProperty('--accent', cssRgb(rgb));
  root.style.setProperty('--accent-dark', cssRgb(dark));
  root.style.setProperty('--accent-shadow', cssRgb(rgb, 0.76));
  root.style.setProperty('--accent-glow', cssRgb(rgb, 0.75));
  root.style.setProperty('--accent-audio-primary', cssRgb(rgb));
  root.style.setProperty('--accent-audio-energy', cssRgb(audioEnergy));
  root.style.setProperty('--accent-audio-aux', cssRgb(audioAux));
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
  return selectWallpaperAccent(context.getImageData(0, 0, width, height).data);
}
