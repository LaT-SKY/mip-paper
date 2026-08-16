// Main-process persistence helpers for the settings window. Pure Node — no
// Electron imports, so these are unit-testable directly. Every write is
// validated first (config.mjs / weather-credentials.mjs rules) and committed
// atomically (temp file + rename), so a crash or partial write can never
// replace the last valid configuration.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { validateConfig } from './config.mjs';
import { normalizeWeatherHost } from './weather-credentials.mjs';

async function writeAtomic(pathname, value) {
  const directory = path.dirname(pathname);
  const temporary = path.join(directory, `.mip-paper-${process.pid}-${Date.now()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, pathname);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

// Validate a candidate config with the exact rules config.mjs uses, then write
// it to the user config file. The running config watcher picks the file up and
// hot-reloads it, so the settings window never needs to restart anything.
export async function saveConfigFile(pathname, candidate) {
  const validated = validateConfig(candidate);
  await writeAtomic(pathname, validated);
  return validated;
}

// Normalize and persist QWeather credentials to weather-credentials.json with
// 0600 permissions (the loader rejects any file that is not 0600). apiKey must
// be a non-empty string; leaving it blank is handled by the UI (keep existing),
// not by this helper.
export async function saveWeatherCredentialsFile(pathname, { apiHost, apiKey } = {}) {
  const host = normalizeWeatherHost(apiHost);
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new TypeError('apiKey is required');
  }
  const value = { apiHost: host, apiKey: apiKey.trim() };
  await writeAtomic(pathname, value);
  return value;
}
