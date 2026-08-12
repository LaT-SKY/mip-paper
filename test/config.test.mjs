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
    wallpaper: { mode: 'kde' },
    color: { mode: 'hybrid', transitionDurationMs: 900 },
    audio: {
      enabled: true,
      gain: 1,
      silenceDelayMs: 600,
      fadeOutMs: 450,
      fadeInMs: 160,
    },
    frameRate: {
      interactive: 60,
      drift: 12,
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

test('normalizes invalid audio values without weakening other config validation', () => {
  assert.deepEqual(validateConfig({ audio: {
    enabled: 'yes',
    gain: Number.NaN,
    silenceDelayMs: -1,
    fadeOutMs: 3001,
    fadeInMs: null,
  } }).audio, DEFAULT_CONFIG.audio);
  assert.deepEqual(validateConfig({ audio: null }).audio, DEFAULT_CONFIG.audio);
  assert.throws(
    () => validateConfig({ audio: { visualizer: 'bars' } }),
    /Unknown configuration field: audio\.visualizer/,
  );
  assert.throws(
    () => validateConfig({ motion: { deadZonePx: -1 } }),
    /motion\.deadZonePx/,
  );
});

test('accepts every audio boundary including immediate transitions', () => {
  assert.deepEqual(validateConfig({ audio: {
    enabled: false,
    gain: 0.25,
    silenceDelayMs: 0,
    fadeOutMs: 0,
    fadeInMs: 0,
  } }).audio, {
    enabled: false,
    gain: 0.25,
    silenceDelayMs: 0,
    fadeOutMs: 0,
    fadeInMs: 0,
  });
  assert.deepEqual(validateConfig({ audio: {
    gain: 4,
    silenceDelayMs: 5000,
    fadeOutMs: 3000,
    fadeInMs: 3000,
  } }).audio, {
    enabled: true,
    gain: 4,
    silenceDelayMs: 5000,
    fadeOutMs: 3000,
    fadeInMs: 3000,
  });
});

test('uses XDG_CONFIG_HOME when resolving the user config path', () => {
  assert.equal(
    configPath({ XDG_CONFIG_HOME: '/tmp/custom-config' }, '/home/tester'),
    '/tmp/custom-config/mip-paper/config.json',
  );
});

test('falls back to the home config directory', () => {
  assert.equal(
    configPath({}, '/home/tester'),
    '/home/tester/.config/mip-paper/config.json',
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
  assert.equal(value.wallpaper.mode, 'kde');
});

test('accepts KDE and manual wallpaper modes and rejects other values', () => {
  assert.equal(validateConfig({ wallpaper: { mode: 'kde' } }).wallpaper.mode, 'kde');
  assert.equal(validateConfig({ wallpaper: { mode: 'manual' } }).wallpaper.mode, 'manual');
  assert.throws(() => validateConfig({ wallpaper: { mode: 'auto' } }), /wallpaper\.mode must be kde or manual/);
  assert.throws(() => validateConfig({ wallpaper: { image: 'x' } }), /Unknown configuration field: wallpaper\.image/);
});

test('accepts color modes and transition duration boundaries', () => {
  assert.deepEqual(DEFAULT_CONFIG.color, { mode: 'hybrid', transitionDurationMs: 900 });
  for (const mode of ['default', 'kde', 'wallpaper', 'hybrid']) {
    assert.equal(validateConfig({ color: { mode } }).color.mode, mode);
  }
  assert.equal(validateConfig({ color: { transitionDurationMs: 0 } }).color.transitionDurationMs, 0);
  assert.equal(validateConfig({ color: { transitionDurationMs: 5000 } }).color.transitionDurationMs, 5000);
  assert.throws(() => validateConfig({ color: { mode: 'auto' } }), /color\.mode/);
  assert.throws(() => validateConfig({ color: { transitionDurationMs: 5001 } }), /color\.transitionDurationMs/);
  assert.throws(() => validateConfig({ color: { transitionDurationMs: 1.5 } }), /color\.transitionDurationMs/);
});

test('rejects unknown fields with their full path', () => {
  assert.throws(
    () => validateConfig({ motion: { blurAmount: 2 } }),
    /Unknown configuration field: motion\.blurAmount/,
  );
});

test('accepts integer render frame rates from 1 through 180', () => {
  for (const field of ['interactive', 'drift']) {
    assert.equal(validateConfig({ frameRate: { [field]: 1 } }).frameRate[field], 1);
    assert.equal(validateConfig({ frameRate: { [field]: 180 } }).frameRate[field], 180);
  }
});

test('rejects render frame rates outside the integer range from 1 through 180', () => {
  for (const field of ['interactive', 'drift']) {
    for (const value of [0, -1, 1.5, 181, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => validateConfig({ frameRate: { [field]: value } }),
        new RegExp(`frameRate\\.${field} must be an integer between 1 and 180`),
      );
    }
  }
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
