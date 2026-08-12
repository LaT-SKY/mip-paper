import { watch as nodeWatch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeRgb } from './accent-color.mjs';

function strictRgb(value) {
  if (typeof value !== 'string' || !/^\d{1,3},\d{1,3},\d{1,3}$/.test(value)) return null;
  return normalizeRgb(value.split(',').map(Number));
}

export function parseKdeAccent(text) {
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
  return strictRgb(values.get('General\0AccentColor'))
    || strictRgb(values.get('Colors:View\0DecorationFocus'));
}

export function createKdeAccentWatcher({
  pathname,
  read = (file) => readFile(file, 'utf8'),
  watch = nodeWatch,
  timers = globalThis,
  debounceMs = 350,
  onAccent = () => {},
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
      const accent = parseKdeAccent(await read(pathname));
      if (running && current === generation) onAccent(accent);
      return accent;
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
        fsWatcher.on?.('error', onError);
      } catch (error) {
        running = false;
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
