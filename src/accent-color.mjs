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
