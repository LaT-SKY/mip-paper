import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadWeatherCredentials } from '../src/weather-credentials.mjs';

test('loads a private host and key without echoing them', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'weather-creds-'));
  const file = path.join(dir, 'weather-credentials.json');
  try {
    await writeFile(file, JSON.stringify({ apiHost: 'weather.example.com', apiKey: 'secret' }), { mode: 0o600 });
    assert.deepEqual(await loadWeatherCredentials(file), { apiHost: 'weather.example.com', apiKey: 'secret' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('rejects broad permissions and unsafe hosts without leaking values', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'weather-creds-'));
  const file = path.join(dir, 'weather-credentials.json');
  try {
    await writeFile(file, JSON.stringify({ apiHost: 'https://user:pass@example.com/path', apiKey: 'never-print-me' }));
    await chmod(file, 0o644);
    await assert.rejects(loadWeatherCredentials(file), /0600/);
    await chmod(file, 0o600);
    await assert.rejects(loadWeatherCredentials(file), (error) => {
      assert.doesNotMatch(error.message, /never-print-me|user:pass/);
      return /apiHost/.test(error.message);
    });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
