import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const FRESH_MS = 6 * 60 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function readInformationCache(pathname, now = Date.now()) {
  try {
    const snapshot = JSON.parse(await readFile(pathname, 'utf8'));
    const fetchedAt = Date.parse(snapshot?.fetchedAt);
    if (!Number.isFinite(fetchedAt)) return { snapshot: null, ageMs: null, status: 'unavailable' };
    const ageMs = Math.max(0, now - fetchedAt);
    if (ageMs > MAX_AGE_MS) return { snapshot: null, ageMs, status: 'expired' };
    return { snapshot, ageMs, status: ageMs > FRESH_MS ? 'stale' : 'fresh' };
  } catch {
    return { snapshot: null, ageMs: null, status: 'unavailable' };
  }
}

export async function writeInformationCache(pathname, snapshot) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const temporary = `${pathname}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  await rename(temporary, pathname);
}
