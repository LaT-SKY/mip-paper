import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    appearance: { mode: 'system', dark: { wallpaperBrightness: 0.72 } },
    audio: {
      enabled: true,
      gain: 1,
      silenceDelayMs: 600,
      fadeOutMs: 450,
      fadeInMs: 160,
    },
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
      pauseWhenFullscreen: true,
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
    menu: { customCommands: [], avoidObstacles: true },
  });
});

test('validates appearance modes and wallpaper brightness boundaries', () => {
  for (const mode of ['light', 'dark', 'system']) {
    assert.equal(validateConfig({ appearance: { mode } }).appearance.mode, mode);
  }
  for (const wallpaperBrightness of [0.2, 1]) {
    assert.equal(
      validateConfig({ appearance: { dark: { wallpaperBrightness } } }).appearance.dark.wallpaperBrightness,
      wallpaperBrightness,
    );
  }
  for (const wallpaperBrightness of [0.199, 1.001, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => validateConfig({ appearance: { dark: { wallpaperBrightness } } }),
      /appearance\.dark\.wallpaperBrightness must be a finite number between 0\.2 and 1/,
    );
  }
  assert.throws(() => validateConfig({ appearance: { mode: 'auto' } }), /appearance\.mode must be light, dark, or system/);
  assert.throws(() => validateConfig({ appearance: { dark: { brightness: 0.5 } } }), /Unknown configuration field: appearance\.dark\.brightness/);
});

test('ships the explicit appearance defaults in the packaged config', async () => {
  const packaged = JSON.parse(await readFile('config/default.json', 'utf8'));
  assert.deepEqual(packaged.appearance, DEFAULT_CONFIG.appearance);
  assert.deepEqual(validateConfig(packaged).appearance, DEFAULT_CONFIG.appearance);
});

test('packaged frame rate default is never the stale 12 FPS drift', async () => {
  const packaged = JSON.parse(await readFile('config/default.json', 'utf8'));
  assert.notEqual(packaged.frameRate.drift, 12);
  assert.equal(packaged.frameRate.drift, DEFAULT_CONFIG.frameRate.drift);
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

test('validates the fullscreen pause toggle', () => {
  assert.equal(validateConfig({ motion: { pauseWhenFullscreen: false } }).motion.pauseWhenFullscreen, false);
  assert.throws(
    () => validateConfig({ motion: { pauseWhenFullscreen: 'yes' } }),
    /motion\.pauseWhenFullscreen must be a boolean/,
  );
  assert.throws(
    () => validateConfig({ motion: { pauseWhenFullscreen: 1 } }),
    /motion\.pauseWhenFullscreen must be a boolean/,
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

test('validates menu custom command entries', () => {
  const customCommands = [
    { id: 'downloads', label: 'Open Downloads', command: 'xdg-open ~/Downloads' },
    { id: 'update', label: 'System Update', command: 'pacman -Syu', mode: 'terminal', icon: 'update' },
  ];
  const value = validateConfig({ menu: { customCommands } });
  assert.deepEqual(value.menu.customCommands, [
    { id: 'downloads', label: 'Open Downloads', command: 'xdg-open ~/Downloads', mode: 'background' },
    { id: 'update', label: 'System Update', command: 'pacman -Syu', mode: 'terminal', icon: 'update' },
  ]);
});

test('rejects malformed menu command entries', () => {
  assert.throws(
    () => validateConfig({ menu: { customCommands: 'not-an-array' } }),
    /menu\.customCommands must be an array/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: 'A', command: 'echo a' }, { id: 'a', label: 'A2', command: 'echo a2' }] } }),
    /Duplicate menu command id: a/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: '', label: 'A', command: 'echo a' }] } }),
    /customCommands\[0\]\.id must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: '', command: 'echo a' }] } }),
    /customCommands\[0\]\.label must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: 'A', command: '  ' }] } }),
    /customCommands\[0\]\.command must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: 'A', command: 'echo a', mode: 'window' }] } }),
    /customCommands\[0\]\.mode must be background or terminal/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: 'A', command: 'echo a', icon: '' }] } }),
    /customCommands\[0\]\.icon must be a non-empty string/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'a', label: 'A', command: 'echo a', script: 'x' }] } }),
    /Unknown configuration field: menu\.customCommands\[0\]\.script/,
  );
  assert.throws(
    () => validateConfig({ menu: { customCommands: [{ id: 'refresh', label: 'Shadow', command: 'echo shadow' }] } }),
    /Menu command id is reserved: refresh/,
  );
  assert.throws(
    () => validateConfig({ menu: { items: [] } }),
    /Unknown configuration field: menu\.items/,
  );
});

test('packaged config ships the menu defaults', async () => {
  const packaged = JSON.parse(await readFile('config/default.json', 'utf8'));
  assert.deepEqual(packaged.menu, { customCommands: [], avoidObstacles: true });
  assert.deepEqual(validateConfig(packaged).menu, { customCommands: [], avoidObstacles: true });
});

test('validates the menu obstacle avoidance toggle', () => {
  assert.equal(validateConfig({ menu: { avoidObstacles: false } }).menu.avoidObstacles, false);
  assert.equal(validateConfig({}).menu.avoidObstacles, true);
  assert.throws(
    () => validateConfig({ menu: { avoidObstacles: 'yes' } }),
    /menu\.avoidObstacles must be a boolean/,
  );
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
