import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  DEFAULT_CONFIG,
  configPath,
  loadConfig,
  validateConfig,
} from '../src/config.mjs';

test('defaults match the approved v1 design', () => {
  assert.deepEqual(DEFAULT_CONFIG, {
    interactionEnabled: true,
    frameRate: {
      interactive: 60,
      drift: 30,
    },
    motion: {
      interactionSpeed: 1.15,
      returnSpeed: 0.3,
      driftSpeed: 1,
      deadZonePx: 2,
      horizontalPanPercent: 4.6,
      verticalPanPercent: 4.5,
      maxRotationDegrees: 0.7,
    },
    panel: {
      autoExpandHide: true,
      expandTriggerDistancePx: 48,
      collapseDelaySeconds: 8,
      expanded: true,
      collapsedOpacity: 0.08,
      animation: { staggerDelayMs: 60, durationMs: 950 },
    },
    weather: {
      location: { mode: 'auto', latitude: null, longitude: null, fallbackLocationId: '101281601' },
      tideStationId: 'P2352',
    },
  });
});

test('uses XDG_CONFIG_HOME when resolving the user config path', () => {
  assert.equal(
    configPath({ XDG_CONFIG_HOME: '/tmp/custom-config' }, '/home/tester'),
    '/tmp/custom-config/animated-ocean-wallpaper/config.json',
  );
});

test('falls back to the home config directory', () => {
  assert.equal(
    configPath({}, '/home/tester'),
    '/home/tester/.config/animated-ocean-wallpaper/config.json',
  );
});

test('merges a partial configuration with defaults', () => {
  const value = validateConfig({
    interactionEnabled: false,
    motion: { deadZonePx: 5 },
  });

  assert.equal(value.interactionEnabled, false);
  assert.equal(value.motion.deadZonePx, 5);
  assert.equal(value.motion.interactionSpeed, 1.15);
  assert.deepEqual(value.frameRate, DEFAULT_CONFIG.frameRate);
});

test('rejects unknown fields with their full path', () => {
  assert.throws(
    () => validateConfig({ motion: { blurAmount: 2 } }),
    /Unknown configuration field: motion\.blurAmount/,
  );
});

test('rejects a render frame rate below 30', () => {
  assert.throws(
    () => validateConfig({ frameRate: { interactive: 29 } }),
    /frameRate\.interactive must be at least 30/,
  );
});

test('rejects non-finite and negative motion values', () => {
  assert.throws(
    () => validateConfig({ motion: { interactionSpeed: Number.NaN } }),
    /motion\.interactionSpeed must be a finite number greater than 0/,
  );
  assert.throws(
    () => validateConfig({ motion: { deadZonePx: -1 } }),
    /motion\.deadZonePx must be a finite number at least 0/,
  );
});

test('rejects invalid panel ranges and unpaired fixed coordinates', () => {
  assert.throws(() => validateConfig({ panel: { collapsedOpacity: 1.1 } }), /panel\.collapsedOpacity/);
  assert.throws(() => validateConfig({ panel: { animation: { durationMs: 399 } } }), /panel\.animation\.durationMs/);
  assert.throws(() => validateConfig({ weather: { location: { mode: 'fixed', latitude: 23.1 } } }), /latitude.*longitude/);
});

test('loads and validates JSON from disk', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-config-'));
  const pathname = path.join(directory, 'config.json');

  try {
    await writeFile(pathname, JSON.stringify({ frameRate: { drift: 45 } }));
    const value = await loadConfig(pathname);
    assert.equal(value.frameRate.drift, 45);
    assert.equal(value.frameRate.interactive, 60);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reports malformed JSON with the configuration path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-config-'));
  const pathname = path.join(directory, 'broken.json');

  try {
    await writeFile(pathname, '{not-json');
    await assert.rejects(loadConfig(pathname), new RegExp(`Invalid JSON in ${pathname}`));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
