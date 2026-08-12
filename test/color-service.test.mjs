import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createColorService } from '../src/color-service.mjs';

const identity = Object.freeze({ path: '/wallpapers/a.png', size: 123, mtimeMs: 456 });

function fakeKdeWatcher() {
  let listener = null;
  return {
    startCalls: 0, stopCalls: 0,
    start() { this.startCalls += 1; },
    stop() { this.stopCalls += 1; },
    setListener(next) { listener = next; },
    publish(rgb) { listener?.(rgb); },
  };
}

async function fixture(mode = 'default') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-colors-'));
  const updates = [];
  const kdeWatcher = fakeKdeWatcher();
  const service = createColorService({
    config: { color: { mode, transitionDurationMs: 900 } },
    displays: () => [{ id: 'DP-1' }, { id: 'HDMI-1' }],
    cacheRoot: root,
    kdeWatcher,
    onUpdate: (displayId, state) => updates.push([displayId, state]),
    now: () => new Date('2026-08-12T00:00:00.000Z'),
  });
  kdeWatcher.setListener((rgb) => service.setKdeAccent(rgb));
  return { root, updates, kdeWatcher, service, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('default mode never analyzes and publishes the approved accent per display', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    assert.deepEqual(f.service.getState('DP-1'), {
      rgb: [255, 52, 120], source: 'default', transitionDurationMs: 900,
      analyzeWallpaper: false, wallpaperIdentity: null, generation: 0,
    });
    assert.equal(f.kdeWatcher.startCalls, 0);
    assert.equal(f.updates.length, 2);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('KDE mode fans a validated accent out to every display', async () => {
  const f = await fixture('kde');
  try {
    await f.service.start();
    assert.equal(f.kdeWatcher.startCalls, 1);
    f.service.setKdeAccent([105, 197, 211]);
    assert.deepEqual(f.service.getState('DP-1').rgb, [105, 197, 211]);
    assert.equal(f.service.getState('DP-1').source, 'kde');
    assert.deepEqual(f.service.getState('HDMI-1').rgb, [105, 197, 211]);
    assert.throws(() => f.service.setKdeAccent([999, 0, 0]), /invalid RGB/);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('wallpaper mode accepts only the current display generation and writes a private cache', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const request = await f.service.wallpaperChanged('DP-1', identity);
    assert.equal(request.analyzeWallpaper, true);
    assert.equal(request.generation, 1);
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: [31, 173, 158], wallpaperIdentity: identity, generation: 0,
    }), false);
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: [31, 173, 158], wallpaperIdentity: identity, generation: 1,
    }), true);
    assert.deepEqual(f.service.getState('DP-1').rgb, [31, 173, 158]);
    assert.equal(f.service.getState('DP-1').source, 'wallpaper');
    assert.equal(f.service.getState('HDMI-1').source, 'default');
    const cached = JSON.parse(await readFile(path.join(f.root, 'DP-1.json'), 'utf8'));
    assert.deepEqual(cached.wallpaperIdentity, identity);
    assert.equal(cached.version, 1);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('matching cache suppresses analysis and hybrid falls back to KDE', async () => {
  const f = await fixture('hybrid');
  try {
    await f.service.start();
    f.service.setKdeAccent([10, 20, 30]);
    const first = await f.service.wallpaperChanged('DP-1', identity);
    assert.equal(first.analyzeWallpaper, true);
    assert.deepEqual(first.rgb, [10, 20, 30]);
    await f.service.submitWallpaperAccent('DP-1', { rgb: [40, 150, 140], wallpaperIdentity: identity, generation: 1 });
    const second = await f.service.wallpaperChanged('DP-1', identity);
    assert.equal(second.analyzeWallpaper, false);
    assert.deepEqual(second.rgb, [40, 150, 140]);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('hot config changes modes and transition duration without losing valid state', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    await f.service.wallpaperChanged('DP-1', identity);
    await f.service.submitWallpaperAccent('DP-1', { rgb: [40, 150, 140], wallpaperIdentity: identity, generation: 1 });
    f.service.updateConfig({ mode: 'default', transitionDurationMs: 0 });
    assert.deepEqual(f.service.getState('DP-1').rgb, [255, 52, 120]);
    assert.equal(f.service.getState('DP-1').transitionDurationMs, 0);
    f.service.updateConfig({ mode: 'wallpaper', transitionDurationMs: 1200 });
    assert.deepEqual(f.service.getState('DP-1').rgb, [40, 150, 140]);
    assert.equal(f.service.getState('DP-1').transitionDurationMs, 1200);
  } finally { f.service.stop(); await f.cleanup(); }
});
