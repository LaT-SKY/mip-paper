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
  resolveManualWallpaper = null,
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
      const inspected = await inspect(pathname);
      return {
        displayId: display.id,
        mode: 'kde',
        status: 'preserved',
        wallpaperPath: pathname,
        size: inspected.size,
        mtimeMs: inspected.mtimeMs ?? 0,
        contentKey: inspected.contentKey,
        reason,
      };
    } catch {
      const inspected = await inspect(defaultWallpaper);
      return {
        displayId: display.id,
        mode: 'kde',
        status: 'fallback',
        wallpaperPath: defaultWallpaper,
        size: inspected.size,
        mtimeMs: inspected.mtimeMs ?? 0,
        contentKey: inspected.contentKey,
        reason,
      };
    }
  }

  async function publishRecord(record) {
    await onUpdate({
      displayId: record.displayId,
      wallpaperUrl: record.wallpaperUrl,
      wallpaperIdentity: {
        path: record.wallpaperPath,
        size: record.size ?? 0,
        mtimeMs: record.mtimeMs ?? 0,
      },
      contentKey: record.contentKey,
    });
  }

  async function reconcile() {
    const currentGeneration = ++generation;
    const displays = getDisplays();
    if (mode === 'manual') {
      for (const display of displays) {
        if (!running || mode !== 'manual' || currentGeneration !== generation) return;
        let targetPath = manualWallpaper;
        if (resolveManualWallpaper) {
          try {
            const resolved = await resolveManualWallpaper(display.id);
            if (resolved && resolved.path) targetPath = resolved.path;
          } catch {}
        }
        const url = pathToFileURL(targetPath).href;
        const inspected = await inspect(targetPath);
        if (!running || mode !== 'manual' || currentGeneration !== generation) return;
        const record = {
          displayId: display.id,
          mode: 'manual',
          status: 'manual',
          wallpaperPath: targetPath,
          // Cache-bust the file URL so a re-import (same path, new bytes)
          // always reloads instead of hitting Chromium's file cache.
          wallpaperUrl: url + '?v=' + inspected.size + '-' + (inspected.mtimeMs ?? 0),
          size: inspected.size,
          mtimeMs: inspected.mtimeMs ?? 0,
          contentKey: inspected.contentKey,
        };
        sources.set(display.id, record);
        await publishRecord(record);
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
      if (!running || mode !== 'kde' || currentGeneration !== generation) return;
      const candidate = byScreen.get(index);
      const previousRecord = sources.get(display.id);
      let imageChanged = false;
      let record = await cachedRecord(display, candidate?.reason ?? 'no KDE wallpaper selected');
      if (!running || mode !== 'kde' || currentGeneration !== generation) return;
      if (candidate?.status === 'supported') {
        try {
          const metadata = await stat(candidate.sourcePath);
          if (!running || mode !== 'kde' || currentGeneration !== generation) return;
          const destination = displayWallpaperPath(display.id, env, homedir || os.homedir());
          let previous = sources.get(display.id);
          if (!previous) {
            try { previous = JSON.parse(await readFile(displayWallpaperMetadataPath(display.id, env, homedir || os.homedir()), 'utf8')); } catch {}
          }
          if (!previous || previous.sourcePath !== candidate.sourcePath || previous.size !== metadata.size
              || previous.mtimeMs !== metadata.mtimeMs
              || !/^sha256:[0-9a-f]{64}$/.test(previous.contentKey)) {
            await importDisplay(candidate.sourcePath, destination, { displayId: display.id, screenIndex: index, sourcePath: candidate.sourcePath, size: metadata.size, mtimeMs: metadata.mtimeMs });
            if (!running || mode !== 'kde' || currentGeneration !== generation) return;
            imageChanged = true;
          }
          const inspected = await inspect(destination);
          if (!running || mode !== 'kde' || currentGeneration !== generation) return;
          record = {
            displayId: display.id,
            mode: 'kde',
            status: 'synchronized',
            wallpaperPath: destination,
            sourcePath: candidate.sourcePath,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
            contentKey: inspected.contentKey,
          };
        } catch (error) {
          record = await cachedRecord(display, error.message);
        }
      } else if (candidate) {
        record.status = candidate.status;
      }
      record.wallpaperUrl = pathToFileURL(record.wallpaperPath).href;
      if (record.status === 'synchronized') record.wallpaperUrl += `?v=${record.size}-${record.mtimeMs}`;
      if (!running || mode !== 'kde' || currentGeneration !== generation) return;
      await persistStatus(display.id, record);
      if (!running || mode !== 'kde' || currentGeneration !== generation) return;
      sources.set(display.id, record);
      if (!previousRecord || imageChanged || previousRecord.wallpaperPath !== record.wallpaperPath
          || previousRecord.size !== record.size || previousRecord.mtimeMs !== record.mtimeMs
          || previousRecord.contentKey !== record.contentKey) {
        await publishRecord(record);
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
