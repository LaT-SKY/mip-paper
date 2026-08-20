import { chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { inspectWallpaper, wallpaperDataDirectory, wallpaperPath } from './wallpaper-image.mjs';

const APP_ID = 'mip-paper';
const GALLERY_SUBDIR = 'gallery';
const INDEX_NAME = 'index.json';
const DEFAULT_MAX_HISTORY = 50;

function shortId(contentKey) {
  // sha256:<64 hex> -> first 12 hex chars (enough for uniqueness within 50 items)
  const hex = contentKey.startsWith('sha256:') ? contentKey.slice(7) : contentKey;
  return hex.slice(0, 12);
}

export function galleryDirectory(env = process.env, homedir) {
  return path.join(wallpaperDataDirectory(env, homedir || os.homedir()), GALLERY_SUBDIR);
}

export function galleryIndexPath(env = process.env, homedir) {
  return path.join(galleryDirectory(env, homedir), INDEX_NAME);
}

export function galleryEntryDirectory(contentKey, env = process.env, homedir) {
  return path.join(galleryDirectory(env, homedir), shortId(contentKey));
}

export function galleryEntryWallpaperPath(contentKey, env = process.env, homedir) {
  return path.join(galleryEntryDirectory(contentKey, env, homedir), 'wallpaper');
}

export function galleryEntryMetadataPath(contentKey, env = process.env, homedir) {
  return path.join(galleryEntryDirectory(contentKey, env, homedir), 'metadata.json');
}

function nowIso() {
  return new Date().toISOString();
}

async function readIndex(env, homedir) {
  const indexPath = galleryIndexPath(env, homedir);
  try {
    const raw = await readFile(indexPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize entries
    return parsed.filter(
      (e) => e && typeof e.id === 'string' && typeof e.contentKey === 'string' && typeof e.file === 'string',
    );
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    // Corrupted JSON -> treat as empty, will be overwritten on next write
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeIndexAtomic(env, homedir, entries) {
  const indexPath = galleryIndexPath(env, homedir);
  await mkdir(path.dirname(indexPath), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(indexPath), `.index-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(entries, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, indexPath);
    // Ensure gallery dir permissions
    await chmod(path.dirname(indexPath), 0o700).catch(() => {});
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

async function migrateLegacyWallpaperIfNeeded(env, homedir) {
  const index = await readIndex(env, homedir);
  if (index.length > 0) return index;
  const activePath = wallpaperPath(env, homedir);
  try {
    const inspected = await inspectWallpaper(activePath);
    const id = shortId(inspected.contentKey);
    const entryDir = galleryEntryDirectory(inspected.contentKey, env, homedir);
    const dest = galleryEntryWallpaperPath(inspected.contentKey, env, homedir);
    // If gallery entry already exists, skip copy
    try {
      await stat(dest);
    } catch {
      await mkdir(entryDir, { recursive: true, mode: 0o700 });
      await copyFile(activePath, dest);
      await chmod(dest, 0o644).catch(() => {});
    }
    const entry = {
      id,
      contentKey: inspected.contentKey,
      file: dest,
      format: inspected.format,
      width: inspected.width,
      height: inspected.height,
      size: inspected.size,
      mtimeMs: inspected.mtimeMs,
      importedAt: nowIso(),
      favorite: false,
      useCount: 1,
      lastUsed: nowIso(),
    };
    await mkdir(entryDir, { recursive: true, mode: 0o700 }).catch(() => {});
    await writeFile(galleryEntryMetadataPath(inspected.contentKey, env, homedir), JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
    const next = [entry];
    await writeIndexAtomic(env, homedir, next);
    return next;
  } catch {
    return index;
  }
}

export async function listGallery(env = process.env, homedir) {
  const base = homedir || os.homedir();
  // Auto-migrate legacy single wallpaper file on first list
  const migrated = await migrateLegacyWallpaperIfNeeded(env, base);
  if (migrated.length > 0) return migrated;
  const entries = await readIndex(env, base);
  // Verify files still exist, filter missing
  const verified = [];
  for (const e of entries) {
    try {
      await stat(e.file);
      verified.push(e);
    } catch {
      // Missing file -> skip, will be pruned on next write
    }
  }
  if (verified.length !== entries.length) {
    await writeIndexAtomic(env, base, verified).catch(() => {});
  }
  return verified;
}

export async function importToGallery(sourcePath, { env = process.env, homedir, favorite = false } = {}) {
  const base = homedir || os.homedir();
  const inspected = await inspectWallpaper(sourcePath);
  const id = shortId(inspected.contentKey);
  const destDir = galleryEntryDirectory(inspected.contentKey, env, base);
  const destFile = galleryEntryWallpaperPath(inspected.contentKey, env, base);
  const metaPath = galleryEntryMetadataPath(inspected.contentKey, env, base);

  // Check deduplication: if contentKey already in index, reuse
  let entries = await readIndex(env, base);
  const existing = entries.find((e) => e.contentKey === inspected.contentKey);
  if (existing) {
    // Ensure file exists
    try {
      await stat(destFile);
    } catch {
      await mkdir(destDir, { recursive: true, mode: 0o700 });
      await copyFile(sourcePath, destFile);
      await chmod(destFile, 0o644).catch(() => {});
    }
    // Update importedAt only, keep favorite/useCount
    existing.size = inspected.size;
    existing.mtimeMs = inspected.mtimeMs;
    existing.width = inspected.width;
    existing.height = inspected.height;
    existing.format = inspected.format;
    // Do not overwrite favorite, but allow caller to set favorite=true
    if (favorite) existing.favorite = true;
    await writeIndexAtomic(env, base, entries);
    await writeFile(metaPath, JSON.stringify(existing, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
    return { ...existing };
  }

  await mkdir(destDir, { recursive: true, mode: 0o700 });
  const tmp = path.join(destDir, `.wallpaper-${process.pid}-${Date.now()}.tmp`);
  try {
    await copyFile(sourcePath, tmp);
    await inspectWallpaper(tmp);
    await chmod(tmp, 0o644);
    await rename(tmp, destFile);
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }

  const entry = {
    id,
    contentKey: inspected.contentKey,
    file: destFile,
    format: inspected.format,
    width: inspected.width,
    height: inspected.height,
    size: inspected.size,
    mtimeMs: inspected.mtimeMs,
    importedAt: nowIso(),
    favorite: Boolean(favorite),
    useCount: 0,
    lastUsed: null,
  };
  entries = [...entries, entry];
  await writeIndexAtomic(env, base, entries);
  await writeFile(metaPath, JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  // Prune if over limit
  await pruneGallery({ env, homedir: base, maxHistory: DEFAULT_MAX_HISTORY }).catch(() => {});
  return { ...entry };
}

export async function setActiveGalleryImage(idOrContentKey, { env = process.env, homedir } = {}) {
  const base = homedir || os.homedir();
  const entries = await readIndex(env, base);
  const key = String(idOrContentKey);
  const entry = entries.find((e) => e.id === key || e.contentKey === key || e.contentKey === `sha256:${key}`);
  if (!entry) throw new Error(`Gallery entry not found: ${idOrContentKey}`);
  const dest = wallpaperPath(env, base);
  // Atomic copy to active wallpaper path (reuse importWallpaper semantics)
  const { importWallpaper } = await import('./wallpaper-image.mjs');
  await importWallpaper(entry.file, dest);
  // Update useCount/lastUsed
  entry.useCount = (entry.useCount || 0) + 1;
  entry.lastUsed = nowIso();
  await writeIndexAtomic(env, base, entries);
  await writeFile(galleryEntryMetadataPath(entry.contentKey, env, base), JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  return { ...entry, activePath: dest };
}

export async function removeFromGallery(idOrContentKey, { env = process.env, homedir } = {}) {
  const base = homedir || os.homedir();
  let entries = await readIndex(env, base);
  const key = String(idOrContentKey);
  const idx = entries.findIndex((e) => e.id === key || e.contentKey === key || e.contentKey === `sha256:${key}`);
  if (idx === -1) throw new Error(`Gallery entry not found: ${idOrContentKey}`);
  const [removed] = entries.splice(idx, 1);
  // Prevent removing the active wallpaper's gallery entry if it's the only copy: warn but allow
  // Remove files
  await rm(path.dirname(removed.file), { recursive: true, force: true }).catch(() => {});
  await writeIndexAtomic(env, base, entries);
  return removed;
}

export async function toggleFavorite(idOrContentKey, { env = process.env, homedir } = {}) {
  const base = homedir || os.homedir();
  const entries = await readIndex(env, base);
  const key = String(idOrContentKey);
  const entry = entries.find((e) => e.id === key || e.contentKey === key || e.contentKey === `sha256:${key}`);
  if (!entry) throw new Error(`Gallery entry not found: ${idOrContentKey}`);
  entry.favorite = !entry.favorite;
  await writeIndexAtomic(env, base, entries);
  await writeFile(galleryEntryMetadataPath(entry.contentKey, env, base), JSON.stringify(entry, null, 2) + '\n', { mode: 0o600 }).catch(() => {});
  return { ...entry };
}

export async function pruneGallery({ env = process.env, homedir, maxHistory = DEFAULT_MAX_HISTORY } = {}) {
  const base = homedir || os.homedir();
  let entries = await readIndex(env, base);
  // Active wallpaper contentKey (if exists) must not be pruned
  let activeKey = null;
  try {
    const active = await inspectWallpaper(wallpaperPath(env, base));
    activeKey = active.contentKey;
  } catch {}
  const nonFavorite = entries.filter((e) => !e.favorite && e.contentKey !== activeKey);
  if (nonFavorite.length <= maxHistory) return entries;
  // Sort by lastUsed/importedAt ascending, oldest first
  nonFavorite.sort((a, b) => {
    const ta = a.lastUsed || a.importedAt || '';
    const tb = b.lastUsed || b.importedAt || '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const toRemoveCount = nonFavorite.length - maxHistory;
  const toRemove = new Set(nonFavorite.slice(0, toRemoveCount).map((e) => e.id));
  const kept = [];
  for (const e of entries) {
    if (toRemove.has(e.id)) {
      await rm(path.dirname(e.file), { recursive: true, force: true }).catch(() => {});
    } else {
      kept.push(e);
    }
  }
  await writeIndexAtomic(env, base, kept);
  return kept;
}

export const __internal = { shortId, readIndex, writeIndexAtomic, DEFAULT_MAX_HISTORY };
