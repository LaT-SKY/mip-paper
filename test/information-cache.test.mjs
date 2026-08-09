import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readInformationCache, writeInformationCache } from '../src/information-cache.mjs';

test('atomically stores a private normalized snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'information-cache-'));
  const file = path.join(dir, 'information.json');
  try {
    const snapshot = { fetchedAt: '2026-08-09T00:00:00.000Z', current: { temperature: 30 } };
    await writeInformationCache(file, snapshot);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await readInformationCache(file, Date.parse('2026-08-09T01:00:00Z'))).status, 'fresh');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('classifies stale, expired, malformed and missing cache entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'information-cache-'));
  const file = path.join(dir, 'information.json');
  try {
    const now = Date.parse('2026-08-10T00:00:00Z');
    await writeInformationCache(file, { fetchedAt: new Date(now - 25 * 60 * 60 * 1000).toISOString() });
    assert.equal((await readInformationCache(file, now)).status, 'expired');
    await writeInformationCache(file, { fetchedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString() });
    assert.equal((await readInformationCache(file, now)).status, 'stale');
    await writeFile(file, '{broken');
    assert.equal((await readInformationCache(file, now)).status, 'unavailable');
    assert.equal((await readInformationCache(path.join(dir, 'missing'), now)).status, 'unavailable');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
