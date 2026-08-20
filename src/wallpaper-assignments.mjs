import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { galleryDirectory } from './wallpaper-gallery.mjs';
import { wallpaperPath } from './wallpaper-image.mjs';
import { inspectWallpaper } from './wallpaper-image.mjs';

const ASSIGNMENTS_NAME = 'display-assignments.json';

export function assignmentsPath(env = process.env, homedir) {
  return path.join(galleryDirectory(env, homedir || os.homedir()), ASSIGNMENTS_NAME);
}

function emptyAssignments() {
  return { version: 1, fallback: null, assignments: {}, updatedAt: new Date().toISOString() };
}

export async function readAssignments(env = process.env, homedir) {
  const base = homedir || os.homedir();
  const p = assignmentsPath(env, base);
  try {
    const raw = await readFile(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || parsed.version !== 1) return emptyAssignments();
    const fallback = typeof parsed.fallback === 'string' && parsed.fallback.startsWith('sha256:') ? parsed.fallback : null;
    const assignments = {};
    if (parsed.assignments && typeof parsed.assignments === 'object' && !Array.isArray(parsed.assignments)) {
      for (const [k, v] of Object.entries(parsed.assignments)) {
        if (typeof k === 'string' && typeof v === 'string' && v.startsWith('sha256:')) assignments[k] = v;
      }
    }
    return { version: 1, fallback, assignments, updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString() };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      // Try legacy fallback migration: if global wallpaper exists, use its contentKey as fallback
      try {
        const inspected = await inspectWallpaper(wallpaperPath(env, base));
        const migrated = { version: 1, fallback: inspected.contentKey, assignments: {}, updatedAt: new Date().toISOString() };
        // Don't auto-write here; caller can decide. But we return migrated for resolve.
        // To avoid repeated inspect, write it lazily on next set.
        return migrated;
      } catch {
        return emptyAssignments();
      }
    }
    if (error instanceof SyntaxError) return emptyAssignments();
    throw error;
  }
}

async function writeAssignmentsAtomic(env, homedir, data) {
  const base = homedir || os.homedir();
  const p = assignmentsPath(env, base);
  await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
  const tmp = path.join(path.dirname(p), `.assignments-${process.pid}-${Date.now()}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
    await rename(tmp, p);
    await chmod(path.dirname(p), 0o700).catch(() => {});
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

export async function setAssignment(displayIdOrFallback, contentKey, { env = process.env, homedir } = {}) {
  const base = homedir || os.homedir();
  const current = await readAssignments(env, base);
  const next = { version: 1, assignments: { ...current.assignments }, fallback: current.fallback, updatedAt: new Date().toISOString() };
  if (displayIdOrFallback === 'fallback' || displayIdOrFallback === 'all') {
    next.fallback = contentKey;
  } else {
    const key = String(displayIdOrFallback);
    if (contentKey === null || contentKey === undefined) delete next.assignments[key];
    else next.assignments[key] = contentKey;
  }
  await writeAssignmentsAtomic(env, base, next);
  return next;
}

export async function clearAssignment(displayId, { env = process.env, homedir } = {}) {
  return setAssignment(displayId, null, { env, homedir });
}

export async function resolveContentKey(displayId, { env = process.env, homedir } = {}) {
  const base = homedir || os.homedir();
  const data = await readAssignments(env, base);
  const key = String(displayId);
  if (data.assignments[key]) return data.assignments[key];
  if (data.fallback) return data.fallback;
  try {
    const inspected = await inspectWallpaper(wallpaperPath(env, base));
    return inspected.contentKey;
  } catch {
    return null;
  }
}

export async function getAssignments(env = process.env, homedir) {
  return readAssignments(env, homedir);
}
