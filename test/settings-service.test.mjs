import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DEFAULT_CONFIG, loadConfig } from '../src/config.mjs';
import { loadWeatherCredentials } from '../src/weather-credentials.mjs';
import { saveConfigFile, saveWeatherCredentialsFile } from '../src/settings-service.mjs';

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-settings-'));
  return {
    directory,
    configPath: path.join(directory, 'config.json'),
    credentialsPath: path.join(directory, 'weather-credentials.json'),
  };
}

test('saveConfigFile persists a valid config that loadConfig round-trips', async () => {
  const { directory, configPath } = await fixture();
  try {
    const candidate = structuredClone(DEFAULT_CONFIG);
    candidate.frameRate.drift = 24;
    candidate.menu.customCommands = [{ id: 'x', label: 'X', command: 'true', mode: 'background' }];
    const saved = await saveConfigFile(configPath, candidate);
    assert.equal(saved.frameRate.drift, 24);
    const loaded = await loadConfig(configPath);
    assert.equal(loaded.frameRate.drift, 24);
    assert.equal(loaded.menu.customCommands[0].id, 'x');
    const metadata = await stat(configPath);
    assert.equal(metadata.mode & 0o077, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('saveConfigFile rejects unknown fields and out-of-range values', async () => {
  const { directory, configPath } = await fixture();
  try {
    await assert.rejects(
      saveConfigFile(configPath, { ...structuredClone(DEFAULT_CONFIG), unknownField: true }),
      /Unknown configuration field: unknownField/,
    );
    const bad = structuredClone(DEFAULT_CONFIG);
    bad.motion.interactionSpeed = -1;
    await assert.rejects(
      saveConfigFile(configPath, bad),
      /motion\.interactionSpeed must be a finite number greater than 0/,
    );
    const badMenu = structuredClone(DEFAULT_CONFIG);
    badMenu.menu.customCommands = [{ id: 'refresh', label: 'x', command: 'true' }];
    await assert.rejects(
      saveConfigFile(configPath, badMenu),
      /Menu command id is reserved: refresh/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('saveWeatherCredentialsFile normalizes the host and writes 0600', async () => {
  const { directory, credentialsPath } = await fixture();
  try {
    await saveWeatherCredentialsFile(credentialsPath, {
      apiHost: 'https://console.example.com/',
      apiKey: 'secret-key',
    });
    const raw = JSON.parse(await readFile(credentialsPath, 'utf8'));
    assert.equal(raw.apiHost, 'console.example.com');
    assert.equal(raw.apiKey, 'secret-key');
    const metadata = await stat(credentialsPath);
    assert.equal(metadata.mode & 0o077, 0);
    const loaded = await loadWeatherCredentials(credentialsPath);
    assert.equal(loaded.apiHost, 'console.example.com');
    assert.equal(loaded.apiKey, 'secret-key');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('saveWeatherCredentialsFile rejects insecure hosts and empty keys', async () => {
  const { directory, credentialsPath } = await fixture();
  try {
    await assert.rejects(
      saveWeatherCredentialsFile(credentialsPath, { apiHost: 'http://console.example.com', apiKey: 'k' }),
      /apiHost must be an HTTPS hostname/,
    );
    await assert.rejects(
      saveWeatherCredentialsFile(credentialsPath, { apiHost: 'console.example.com:8080', apiKey: 'k' }),
      /apiHost must be an HTTPS hostname/,
    );
    await assert.rejects(
      saveWeatherCredentialsFile(credentialsPath, { apiHost: 'console.example.com', apiKey: '   ' }),
      /apiKey is required/,
    );
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
