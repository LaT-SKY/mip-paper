import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parsePlasmaWallpaperConfig } from './plasma-wallpaper.mjs';
import { displayWallpaperMetadataPath, displayWallpaperPath, displayWallpaperStatusPath, importDisplayWallpaper, inspectWallpaper, wallpaperPath } from './wallpaper-image.mjs';

export function createKdeWallpaperSync({
  config,
  plasmaConfigPath,
  getDisplays = () => [],
  readConfig = (pathname) => readFile(pathname, 'utf8'),
  env = process.env,
  homedir,
  watch,
  parse = parsePlasmaWallpaperConfig,
  inspect = inspectWallpaper,
  importDisplay = importDisplayWallpaper,
  defaultWallpaper,
  manualWallpaper = wallpaperPath(env, homedir || os.homedir()),
  timers = globalThis,
  onUpdate = () => {},
  onStatus = () => {},
  debounceMs = 350,
} = {}) {
  let mode = config?.wallpaper?.mode ?? 'kde';
  let running = false;
  let generation = 0;
  let timer = null;
  let fsWatcher = null;
  let queue = Promise.resolve();
  const sources = new Map();

  function schedule() {
    if (!running || mode !== 'kde') return;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = null; queue = queue.then(reconcile); }, debounceMs);
  }

  function startWatcher() {
    if (!watch || fsWatcher || mode !== 'kde') return;
    try { fsWatcher = watch(path.dirname(plasmaConfigPath), watchEvent); fsWatcher.on?.('error', (error) => onStatus({ status: 'watch-error', reason: error.message })); } catch (error) { onStatus({ status: 'watch-error', reason: error.message }); }
  }

  function stopWatcher() { fsWatcher?.close?.(); fsWatcher = null; }

  async function persistStatus(displayId, record) {
    const pathname = displayWallpaperStatusPath(displayId, env, homedir || os.homedir());
    const temporary = `${pathname}.${process.pid}.tmp`;
    await mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
    await writeFile(temporary, JSON.stringify(record) + '\n', { mode: 0o600 });
    await rename(temporary, pathname);
  }

  function watchEvent(eventType, filename) {
    if (filename !== null && filename !== undefined && String(filename) !== path.basename(plasmaConfigPath)) return;
    if (eventType !== 'change' && eventType !== 'rename') return;
    schedule();
  }

  async function cachedRecord(display, reason) {
    const pathname = displayWallpaperPath(display.id, env, homedir || os.homedir());
    try {
      await inspect(pathname);
      return { displayId: display.id, mode: 'kde', status: 'preserved', wallpaperPath: pathname, reason };
    } catch {
      return { displayId: display.id, mode: 'kde', status: 'fallback', wallpaperPath: defaultWallpaper, reason };
    }
  }

  async function reconcile() {
    const currentGeneration = ++generation;
    const displays = getDisplays();
    if (mode === 'manual') {
      for (const display of displays) {
        const url = pathToFileURL(manualWallpaper).href;
        sources.set(display.id, { displayId: display.id, mode: 'manual', status: 'manual', wallpaperPath: manualWallpaper, wallpaperUrl: url });
        onUpdate(display.id, url);
      }
      return;
    }
    let parsed;
    try { parsed = parse(await readConfig(plasmaConfigPath)); } catch (error) {
      onStatus({ status: 'config-error', reason: error.message });
      return;
    }
    const byScreen = new Map(parsed.map((item) => [item.screenIndex, item]));
    for (const [index, display] of displays.entries()) {
      if (currentGeneration !== generation) return;
      const candidate = byScreen.get(index);
      const previousRecord = sources.get(display.id);
      let imageChanged = false;
      let record = await cachedRecord(display, candidate?.reason ?? 'no KDE wallpaper selected');
      if (candidate?.status === 'supported') {
        try {
          const metadata = await stat(candidate.sourcePath);
          const destination = displayWallpaperPath(display.id, env, homedir || os.homedir());
          let previous = sources.get(display.id);
          if (!previous) {
            try { previous = JSON.parse(await readFile(displayWallpaperMetadataPath(display.id, env, homedir || os.homedir()), 'utf8')); } catch {}
          }
          if (!previous || previous.sourcePath !== candidate.sourcePath || previous.size !== metadata.size || previous.mtimeMs !== metadata.mtimeMs) {
            await importDisplay(candidate.sourcePath, destination, { displayId: display.id, screenIndex: index, sourcePath: candidate.sourcePath, size: metadata.size, mtimeMs: metadata.mtimeMs });
            imageChanged = true;
          }
          await inspect(destination);
          record = { displayId: display.id, mode: 'kde', status: 'synchronized', wallpaperPath: destination, sourcePath: candidate.sourcePath, size: metadata.size, mtimeMs: metadata.mtimeMs };
        } catch (error) {
          record = await cachedRecord(display, error.message);
        }
      } else if (candidate) {
        record.status = candidate.status;
      }
      record.wallpaperUrl = pathToFileURL(record.wallpaperPath).href;
      if (record.status === 'synchronized') record.wallpaperUrl += `?v=${record.size}-${record.mtimeMs}`;
      sources.set(display.id, record);
      await persistStatus(display.id, record);
      if (!previousRecord || imageChanged || previousRecord.wallpaperPath !== record.wallpaperPath) {
        onUpdate(display.id, record.wallpaperUrl);
      }
      onStatus(record);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      startWatcher();
      queue = queue.then(reconcile);
    },
    stop() { running = false; generation += 1; if (timer !== null) timers.clearTimeout(timer); timer = null; stopWatcher(); },
    setMode(nextMode) { if (!['kde', 'manual'].includes(nextMode)) throw new TypeError('wallpaper mode must be kde or manual'); mode = nextMode; generation += 1; if (mode === 'kde') startWatcher(); else stopWatcher(); queue = queue.then(reconcile); },
    reconcile() { queue = queue.then(reconcile); return queue; },
    getDisplaySources() { return new Map(sources); },
    whenIdle() { return queue; },
  };
}
