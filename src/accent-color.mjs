export const DEFAULT_ACCENT_RGB = Object.freeze([255, 52, 120]);

export function normalizeRgb(value) {
  if (!Array.isArray(value) || value.length !== 3
    || !value.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    return null;
  }
  return Object.freeze([...value]);
}

export function rgbToCss(value) {
  const rgb = normalizeRgb(value);
  if (!rgb) throw new TypeError('invalid RGB color');
  return `rgb(${rgb.join(' ')})`;
}

function rgbToHsl([red, green, blue]) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const maximum = Math.max(r, g, b);
  const minimum = Math.min(r, g, b);
  const delta = maximum - minimum;
  const lightness = (maximum + minimum) / 2;
  let hue = 0;
  if (delta > 0) {
    if (maximum === r) hue = ((g - b) / delta) % 6;
    else if (maximum === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue = (hue * 60 + 360) % 360;
  }
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return { hue, saturation, lightness };
}

function hslToRgb({ hue, saturation, lightness }) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const intermediate = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const offset = lightness - chroma / 2;
  let components;
  if (hue < 60) components = [chroma, intermediate, 0];
  else if (hue < 120) components = [intermediate, chroma, 0];
  else if (hue < 180) components = [0, chroma, intermediate];
  else if (hue < 240) components = [0, intermediate, chroma];
  else if (hue < 300) components = [intermediate, 0, chroma];
  else components = [chroma, 0, intermediate];
  return Object.freeze(components.map((channel) => Math.round((channel + offset) * 255)));
}

export function relativeLuminance(value) {
  const rgb = normalizeRgb(value);
  if (!rgb) throw new TypeError('invalid RGB color');
  const [red, green, blue] = rgb.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function complementaryRgb(value) {
  const rgb = normalizeRgb(value);
  if (!rgb) throw new TypeError('invalid RGB color');
  const hsl = rgbToHsl(rgb);
  return hslToRgb({
    hue: (hsl.hue + 180) % 360,
    saturation: Math.max(0.50, Math.min(0.78, hsl.saturation)),
    lightness: Math.max(0.48, Math.min(0.62, hsl.lightness)),
  });
}

export function contrastingNeutral(luminance) {
  if (!Number.isFinite(luminance) || luminance < 0 || luminance > 1) {
    throw new TypeError('invalid wallpaper luminance');
  }
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return blackContrast >= whiteContrast
    ? Object.freeze([0, 0, 0])
    : Object.freeze([255, 255, 255]);
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

export function selectAudioNeutral(pixels, width, { previous = null } = {}) {
  if (!pixels || typeof pixels.length !== 'number' || pixels.length % 4 !== 0
      || !Number.isInteger(width) || width < 1 || pixels.length / 4 % width !== 0) {
    throw new TypeError('audio sample must contain complete RGBA rows');
  }
  const height = pixels.length / 4 / width;
  const firstRow = height >= 4 ? Math.floor(height * 0.68) : 0;
  const lastRow = height >= 4 ? Math.max(firstRow + 1, Math.ceil(height * 0.82)) : height;
  const luminances = [];
  let darkShare = 0;
  let brightShare = 0;
  let colorfulShare = 0;
  let sum = 0;
  let count = 0;
  for (let y = firstRow; y < lastRow; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      if (pixels[index + 3] < 220) continue;
      const rgb = [pixels[index], pixels[index + 1], pixels[index + 2]];
      const luminance = relativeLuminance(rgb);
      const maximum = Math.max(...rgb);
      const minimum = Math.min(...rgb);
      luminances.push(luminance);
      sum += luminance;
      darkShare += luminance < 0.28 ? 1 : 0;
      brightShare += luminance > 0.72 ? 1 : 0;
      colorfulShare += maximum - minimum > 55 ? 1 : 0;
      count += 1;
    }
  }
  if (count === 0) return Object.freeze([255, 255, 255]);
  darkShare /= count;
  brightShare /= count;
  colorfulShare /= count;
  const mean = sum / count;
  const variance = luminances.reduce((total, value) => total + (value - mean) ** 2, 0) / count;
  const whiteScore = percentile(luminances.map((value) => 1.05 / (value + 0.05)), 0.20)
    + darkShare * 1.4 + colorfulShare * 6 + Math.sqrt(variance) * 1.5;
  const blackScore = percentile(luminances.map((value) => (value + 0.05) / 0.05), 0.20)
    + brightShare * 1.1;
  const previousIsWhite = Array.isArray(previous) && previous[0] > 127;
  const selected = Math.abs(whiteScore - blackScore) < 0.45
    ? previousIsWhite
    : whiteScore > blackScore;
  return Object.freeze(selected ? [255, 255, 255] : [0, 0, 0]);
}

function binColor(key) {
  return [((key >> 8) & 15) * 17, ((key >> 4) & 15) * 17, (key & 15) * 17];
}

export function selectWallpaperAccent(pixels) {
  if (!pixels || typeof pixels.length !== 'number' || pixels.length % 4 !== 0) {
    throw new TypeError('wallpaper sample must contain complete RGBA pixels');
  }
  const bins = new Map();
  let opaqueCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 220) continue;
    const key = ((pixels[index] >> 4) << 8)
      | ((pixels[index + 1] >> 4) << 4)
      | (pixels[index + 2] >> 4);
    bins.set(key, (bins.get(key) ?? 0) + 1);
    opaqueCount += 1;
  }
  if (opaqueCount === 0) return null;

  let selected = null;
  for (const [key, count] of bins) {
    const color = binColor(key);
    const hsl = rgbToHsl(color);
    const share = count / opaqueCount;
    const lightFit = 1 - Math.min(1, Math.abs(hsl.lightness - 0.52) / 0.52);
    const score = Math.sqrt(share) * 0.42 + hsl.saturation * 0.40 + lightFit * 0.18;
    if (!selected || score > selected.score
      || (score === selected.score && count > selected.count)
      || (score === selected.score && count === selected.count && key < selected.key)) {
      selected = { key, count, score, hsl };
    }
  }

  return hslToRgb({
    hue: selected.hsl.hue,
    saturation: Math.max(0.50, Math.min(0.78, selected.hsl.saturation)),
    lightness: Math.max(0.40, Math.min(0.62, selected.hsl.lightness)),
  });
}

export function analyzeWallpaperPixels(pixels, { width = null, previousAudioNeutral = null } = {}) {
  const rgb = selectWallpaperAccent(pixels);
  if (!rgb) return null;
  let luminance = 0;
  let opaqueCount = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 220) continue;
    luminance += relativeLuminance([pixels[index], pixels[index + 1], pixels[index + 2]]);
    opaqueCount += 1;
  }
  const sampleWidth = width ?? Math.max(1, Math.floor(Math.sqrt(pixels.length / 4)));
  return Object.freeze({
    rgb,
    luminance: luminance / opaqueCount,
    audioNeutral: selectAudioNeutral(pixels, sampleWidth, { previous: previousAudioNeutral }),
  });
}
