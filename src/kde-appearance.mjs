import { watch as nodeWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

function strictRgb(value) {
  if (typeof value !== 'string' || !/^\d{1,3},\d{1,3},\d{1,3}$/.test(value)) return null;
  const rgb = value.split(',').map(Number);
  return rgb.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255) ? rgb : null;
}

export function parseKdeWindowBackground(text) {
  if (typeof text !== 'string') throw new TypeError('KDE configuration must be text');
  const values = new Map();
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[') && line.endsWith(']')) {
      section = line.slice(1, -1);
      continue;
    }
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    values.set(`${section}\0${line.slice(0, separator)}`, line.slice(separator + 1));
  }
  return strictRgb(values.get('Colors:Window\0BackgroundNormal'))
    || strictRgb(values.get('Colors:View\0BackgroundNormal'));
}

function channelLuminance(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(rgb) {
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new TypeError('invalid RGB value');
  }
  return 0.2126 * channelLuminance(rgb[0])
    + 0.7152 * channelLuminance(rgb[1])
    + 0.0722 * channelLuminance(rgb[2]);
}

export function resolveKdeTheme(text, threshold = 0.35) {
  const rgb = parseKdeWindowBackground(text);
  if (!rgb) throw new TypeError('KDE window background color is unavailable');
  const luminance = relativeLuminance(rgb);
  return Object.freeze({ rgb: Object.freeze(rgb), luminance, theme: luminance < threshold ? 'dark' : 'light' });
}

export function createKdeAppearanceWatcher({
  pathname,
  read = (file) => readFile(file, 'utf8'),
  watch = nodeWatch,
  timers = globalThis,
  debounceMs = 350,
  onTheme = () => {},
  onError = () => {},
} = {}) {
  if (typeof pathname !== 'string' || pathname.length === 0) throw new TypeError('pathname is required');
  let running = false;
  let fsWatcher = null;
  let timer = null;
  let generation = 0;
  let queue = Promise.resolve();

  async function performReload() {
    const current = ++generation;
    try {
      const theme = resolveKdeTheme(await read(pathname));
      if (running && current === generation) onTheme(theme);
      return theme;
    } catch (error) {
      if (running && current === generation) onError(error);
      return null;
    }
  }

  function reload() {
    queue = queue.then(performReload);
    return queue;
  }

  function schedule(eventType, filename) {
    if (!running || !['change', 'rename'].includes(eventType)) return;
    if (filename !== null && filename !== undefined && String(filename) !== path.basename(pathname)) return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; void reload(); }, debounceMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      try {
        fsWatcher = watch(path.dirname(pathname), schedule);
        fsWatcher.on?.('error', (error) => { if (running) onError(error); });
      } catch (error) {
        running = false;
        fsWatcher = null;
        onError(error);
      }
      if (running) void reload();
    },
    stop() {
      if (!running && !fsWatcher) return;
      running = false;
      generation += 1;
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      fsWatcher?.close?.();
      fsWatcher = null;
    },
    reload,
    whenIdle: () => queue,
  };
}
