import { watch as nodeWatch } from 'node:fs';
import path from 'node:path';

export function createConfigWatcher({
  pathname,
  load,
  onConfig,
  onError,
  watch = nodeWatch,
  timers = globalThis,
  debounceMs = 100,
} = {}) {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    throw new TypeError('pathname is required');
  }
  if (typeof load !== 'function') throw new TypeError('load must be a function');
  if (typeof onConfig !== 'function') throw new TypeError('onConfig must be a function');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function');
  if (typeof watch !== 'function') throw new TypeError('watch must be a function');

  const directory = path.dirname(pathname);
  const basename = path.basename(pathname);
  let running = false;
  let fsWatcher = null;
  let debounceTimer = null;
  let loadGeneration = 0;

  function clearDebounce() {
    if (debounceTimer !== null) timers.clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  async function reload() {
    const generation = ++loadGeneration;
    try {
      const config = await load(pathname);
      if (running && generation === loadGeneration) onConfig(config);
    } catch (error) {
      if (running && generation === loadGeneration) onError(error);
    }
  }

  function schedule(eventType, filename) {
    if (!running) return;
    if (filename !== null && filename !== undefined && String(filename) !== basename) return;
    if (eventType !== 'change' && eventType !== 'rename') return;
    clearDebounce();
    debounceTimer = timers.setTimeout(() => {
      debounceTimer = null;
      void reload();
    }, debounceMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      try {
        fsWatcher = watch(directory, schedule);
        fsWatcher.on?.('error', (error) => {
          if (running) onError(error);
        });
      } catch (error) {
        running = false;
        fsWatcher = null;
        onError(error);
      }
    },
    stop() {
      if (!running && !fsWatcher) return;
      running = false;
      loadGeneration += 1;
      clearDebounce();
      fsWatcher?.close();
      fsWatcher = null;
    },
  };
}
