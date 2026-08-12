import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_ACCENT_RGB, normalizeRgb } from './accent-color.mjs';

const MODES = new Set(['default', 'kde', 'wallpaper', 'hybrid']);
const CACHE_VERSION = 3;
const ALGORITHM_VERSION = 2;
const CONTENT_KEY_PATTERN = /^sha256:([0-9a-f]{64})$/;

function normalizeConfig(value) {
  const color = value?.color ?? value;
  if (!color || !MODES.has(color.mode)) throw new TypeError('invalid color mode');
  if (!Number.isInteger(color.transitionDurationMs)
      || color.transitionDurationMs < 0 || color.transitionDurationMs > 5000) {
    throw new TypeError('invalid color transition duration');
  }
  return Object.freeze({ mode: color.mode, transitionDurationMs: color.transitionDurationMs });
}

function normalizeIdentity(value) {
  if (!value || typeof value.path !== 'string' || value.path.length === 0
      || !Number.isFinite(value.size) || value.size < 0
      || !Number.isFinite(value.mtimeMs) || value.mtimeMs < 0) {
    throw new TypeError('invalid wallpaper identity');
  }
  return Object.freeze({ path: value.path, size: value.size, mtimeMs: value.mtimeMs });
}

function normalizeContentKey(value) {
  const match = typeof value === 'string' ? CONTENT_KEY_PATTERN.exec(value) : null;
  if (!match) throw new TypeError('invalid wallpaper content key');
  return Object.freeze({ value, digest: match[1] });
}

function sameIdentity(left, right) {
  return Boolean(left && right && left.path === right.path
    && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

function copyIdentity(value) {
  return value ? { path: value.path, size: value.size, mtimeMs: value.mtimeMs } : null;
}

function recordFor(displayId) {
  return {
    displayId,
    identity: null,
    contentKey: null,
    generation: 0,
    wallpaperAnalysis: null,
    lastValidRgb: null,
    lastValidLuminance: null,
  };
}

export function colorCacheDirectory(env = process.env, homedir) {
  const base = env.XDG_DATA_HOME || path.join(homedir, '.local', 'share');
  return path.join(base, 'mip-paper', 'colors');
}

export function createColorService({
  config,
  displays = () => [],
  cacheRoot,
  kdeWatcher = null,
  onUpdate = () => {},
  now = () => new Date(),
} = {}) {
  let colorConfig = normalizeConfig(config);
  let kdeRgb = null;
  let started = false;
  let watcherStarted = false;
  const records = new Map();
  const contentCache = new Map();
  const root = cacheRoot;

  if (typeof root !== 'string' || root.length === 0) throw new TypeError('cacheRoot is required');

  function ensureRecord(displayId) {
    if (!records.has(displayId)) records.set(displayId, recordFor(displayId));
    return records.get(displayId);
  }

  function selected(record) {
    if (colorConfig.mode === 'kde' && kdeRgb) return { rgb: kdeRgb, source: 'kde' };
    if (colorConfig.mode === 'wallpaper') {
      if (record.wallpaperAnalysis) return { ...record.wallpaperAnalysis, source: 'wallpaper' };
      if (record.lastValidRgb) return {
        rgb: record.lastValidRgb, luminance: record.lastValidLuminance, source: 'fallback',
      };
    }
    if (colorConfig.mode === 'hybrid') {
      if (record.wallpaperAnalysis) return { ...record.wallpaperAnalysis, source: 'wallpaper' };
      if (kdeRgb) return { rgb: kdeRgb, source: 'kde' };
      if (record.lastValidRgb) return {
        rgb: record.lastValidRgb, luminance: record.lastValidLuminance, source: 'fallback',
      };
    }
    return { rgb: DEFAULT_ACCENT_RGB, source: 'default' };
  }

  function stateFor(record) {
    const choice = selected(record);
    return {
      rgb: [...choice.rgb],
      source: choice.source,
      wallpaperLuminance: choice.luminance ?? record.lastValidLuminance,
      transitionDurationMs: colorConfig.transitionDurationMs,
      analyzeWallpaper: (colorConfig.mode === 'wallpaper' || colorConfig.mode === 'hybrid')
        && Boolean(record.identity && record.contentKey) && !record.wallpaperAnalysis,
      wallpaperIdentity: copyIdentity(record.identity),
      contentKey: record.contentKey,
      generation: record.generation,
    };
  }

  function publish(displayId) {
    const record = records.get(displayId);
    if (record) onUpdate(displayId, stateFor(record));
  }

  function publishAll() {
    for (const displayId of records.keys()) publish(displayId);
  }

  function wantsKdeWatcher() {
    return colorConfig.mode === 'kde' || colorConfig.mode === 'hybrid';
  }

  function reconcileWatcher() {
    if (!started || !kdeWatcher) return;
    if (wantsKdeWatcher() && !watcherStarted) {
      kdeWatcher.start();
      watcherStarted = true;
    } else if (!wantsKdeWatcher() && watcherStarted) {
      kdeWatcher.stop();
      watcherStarted = false;
    }
  }

  function cachePath(contentKey) {
    const { digest } = normalizeContentKey(contentKey);
    return path.join(root, 'by-content', `${digest}.json`);
  }

  async function loadContentColor(contentKey) {
    if (contentCache.has(contentKey)) return contentCache.get(contentKey);
    let analysis = null;
    try {
      const value = JSON.parse(await readFile(cachePath(contentKey), 'utf8'));
      if (value.version === CACHE_VERSION && value.algorithmVersion === ALGORITHM_VERSION
          && value.contentKey === contentKey) {
        const rgb = normalizeRgb(value.rgb);
        if (rgb && Number.isFinite(value.luminance)
            && value.luminance >= 0 && value.luminance <= 1) {
          analysis = Object.freeze({ rgb, luminance: value.luminance });
        }
      }
    } catch {
      // Missing, stale, or malformed content cache is non-fatal.
    }
    contentCache.set(contentKey, analysis);
    return analysis;
  }

  async function persistContentColor(contentKey, analysis, generation) {
    const pathname = cachePath(contentKey);
    await mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
    const temporary = `${pathname}.${process.pid}.${generation}.tmp`;
    const payload = {
      version: CACHE_VERSION,
      algorithmVersion: ALGORITHM_VERSION,
      contentKey,
      rgb: [...analysis.rgb],
      luminance: analysis.luminance,
      updatedAt: now().toISOString(),
    };
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
    await rename(temporary, pathname);
  }

  async function reconcileDisplays() {
    const active = new Set();
    for (const display of displays()) {
      if (!display || (typeof display.id !== 'string' && typeof display.id !== 'number')) continue;
      const displayId = display.id;
      active.add(displayId);
      ensureRecord(displayId);
    }
    for (const displayId of records.keys()) {
      if (!active.has(displayId)) records.delete(displayId);
    }
  }

  return {
    async start() {
      if (started) return;
      await reconcileDisplays();
      started = true;
      reconcileWatcher();
      publishAll();
    },

    stop() {
      if (watcherStarted) kdeWatcher?.stop();
      watcherStarted = false;
      started = false;
    },

    getState(displayId) {
      const record = records.get(displayId);
      return record ? stateFor(record) : null;
    },

    async reconcileDisplays() {
      await reconcileDisplays();
      if (started) publishAll();
    },

    setKdeAccent(value) {
      if (value === null) kdeRgb = null;
      else {
        const rgb = normalizeRgb(value);
        if (!rgb) throw new TypeError('invalid RGB');
        kdeRgb = rgb;
      }
      if (started) publishAll();
    },

    updateConfig(value) {
      colorConfig = normalizeConfig(value);
      reconcileWatcher();
      if (started) publishAll();
    },

    async wallpaperChanged(displayId, value) {
      const record = ensureRecord(displayId);
      const identity = normalizeIdentity(value?.identity);
      const contentKey = normalizeContentKey(value?.contentKey).value;
      if (!sameIdentity(record.identity, identity) || record.contentKey !== contentKey) {
        record.identity = identity;
        record.contentKey = contentKey;
        record.generation += 1;
        record.wallpaperAnalysis = await loadContentColor(contentKey);
        if (record.wallpaperAnalysis) {
          record.lastValidRgb = record.wallpaperAnalysis.rgb;
          record.lastValidLuminance = record.wallpaperAnalysis.luminance;
        }
      }
      if (started) publish(displayId);
      return stateFor(record);
    },

    async submitWallpaperAccent(displayId, submission) {
      const record = records.get(displayId);
      if (!record || !submission || submission.generation !== record.generation) return false;
      let identity;
      let contentKey;
      try {
        identity = normalizeIdentity(submission.wallpaperIdentity);
        contentKey = normalizeContentKey(submission.contentKey).value;
      } catch {
        return false;
      }
      if (!sameIdentity(record.identity, identity) || record.contentKey !== contentKey) return false;
      const rgb = normalizeRgb(submission.rgb);
      if (!rgb) throw new TypeError('invalid RGB');
      if (!Number.isFinite(submission.luminance)
          || submission.luminance < 0 || submission.luminance > 1) {
        throw new TypeError('invalid wallpaper luminance');
      }
      const analysis = Object.freeze({ rgb, luminance: submission.luminance });
      contentCache.set(contentKey, analysis);
      for (const active of records.values()) {
        if (active.contentKey !== contentKey) continue;
        active.wallpaperAnalysis = analysis;
        active.lastValidRgb = rgb;
        active.lastValidLuminance = analysis.luminance;
      }
      await persistContentColor(contentKey, analysis, record.generation);
      if (started) {
        for (const active of records.values()) {
          if (active.contentKey === contentKey) publish(active.displayId);
        }
      }
      return true;
    },
  };
}
