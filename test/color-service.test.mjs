import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createColorService } from '../src/color-service.mjs';

const identityA = Object.freeze({ path: '/wallpapers/a.png', size: 123, mtimeMs: 456 });
const identityB = Object.freeze({ path: '/wallpapers/b.png', size: 321, mtimeMs: 654 });
const keyA = `sha256:${'a'.repeat(64)}`;
const keyB = `sha256:${'b'.repeat(64)}`;
const colorA = Object.freeze([31, 173, 158]);
const colorB = Object.freeze([220, 90, 70]);

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

async function fixture(mode = 'default', { root, displayIds = ['DP-1', 'HDMI-1'] } = {}) {
  const cacheRoot = root ?? await mkdtemp(path.join(os.tmpdir(), 'mip-paper-colors-'));
  const updates = [];
  const kdeWatcher = fakeKdeWatcher();
  const service = createColorService({
    config: { color: { mode, transitionDurationMs: 900 } },
    displays: () => displayIds.map((id) => ({ id })),
    cacheRoot,
    kdeWatcher,
    onUpdate: (displayId, state) => updates.push([displayId, state]),
    now: () => new Date('2026-08-12T00:00:00.000Z'),
  });
  kdeWatcher.setListener((rgb) => service.setKdeAccent(rgb));
  return { root: cacheRoot, updates, kdeWatcher, service, cleanup: () => rm(cacheRoot, { recursive: true, force: true }) };
}

function wallpaper(value, contentKey) {
  return { identity: value, contentKey };
}

test('default mode never analyzes and publishes the approved accent per display', async () => {
  const f = await fixture();
  try {
    await f.service.start();
    assert.deepEqual(f.service.getState('DP-1'), {
      rgb: [255, 52, 120], source: 'default', transitionDurationMs: 900,
      analyzeWallpaper: false, wallpaperIdentity: null, contentKey: null, generation: 0,
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

test('A to B to A restores the cached color for A instead of inheriting B', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const a1 = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    assert.equal(a1.analyzeWallpaper, true);
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: a1.generation,
    }), true);
    const b = await f.service.wallpaperChanged('DP-1', wallpaper(identityB, keyB));
    assert.equal(b.analyzeWallpaper, true);
    assert.equal(b.source, 'fallback');
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorB, wallpaperIdentity: identityB, contentKey: keyB, generation: b.generation,
    }), true);
    const a2 = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    assert.deepEqual(a2.rgb, colorA);
    assert.equal(a2.source, 'wallpaper');
    assert.equal(a2.analyzeWallpaper, false);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('different displays retain independent colors while identical content reuses one result', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const first = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    const second = await f.service.wallpaperChanged('HDMI-1', wallpaper(identityB, keyB));
    await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: first.generation,
    });
    await f.service.submitWallpaperAccent('HDMI-1', {
      rgb: colorB, wallpaperIdentity: identityB, contentKey: keyB, generation: second.generation,
    });
    assert.deepEqual(f.service.getState('DP-1').rgb, colorA);
    assert.deepEqual(f.service.getState('HDMI-1').rgb, colorB);

    const shared = await f.service.wallpaperChanged('HDMI-1', wallpaper(identityA, keyA));
    assert.deepEqual(shared.rgb, colorA);
    assert.equal(shared.analyzeWallpaper, false);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('content cache survives service restart and a changed display id', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-colors-'));
  const first = await fixture('wallpaper', { root, displayIds: ['DP-OLD'] });
  try {
    await first.service.start();
    const request = await first.service.wallpaperChanged('DP-OLD', wallpaper(identityA, keyA));
    await first.service.submitWallpaperAccent('DP-OLD', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: request.generation,
    });
    first.service.stop();

    const second = await fixture('wallpaper', { root, displayIds: ['DP-NEW'] });
    try {
      await second.service.start();
      const restored = await second.service.wallpaperChanged('DP-NEW', wallpaper(identityA, keyA));
      assert.deepEqual(restored.rgb, colorA);
      assert.equal(restored.analyzeWallpaper, false);
    } finally { second.service.stop(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('rejects a submission when generation, identity, or content key is stale', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const request = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: request.generation - 1,
    }), false);
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityB, contentKey: keyA, generation: request.generation,
    }), false);
    assert.equal(await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyB, generation: request.generation,
    }), false);
  } finally { f.service.stop(); await f.cleanup(); }
});

test('writes versioned content cache and ignores stale or malformed entries', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const request = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: request.generation,
    });
    const pathname = path.join(f.root, 'by-content', `${'a'.repeat(64)}.json`);
    const cached = JSON.parse(await readFile(pathname, 'utf8'));
    assert.equal(cached.version, 2);
    assert.equal(cached.algorithmVersion, 1);
    assert.equal(cached.contentKey, keyA);

    await writeFile(pathname, JSON.stringify({ ...cached, algorithmVersion: 0, rgb: colorB }));
    f.service.stop();
    const stale = await fixture('wallpaper', { root: f.root, displayIds: ['NEW'] });
    try {
      await stale.service.start();
      const state = await stale.service.wallpaperChanged('NEW', wallpaper(identityA, keyA));
      assert.equal(state.analyzeWallpaper, true);
      assert.notDeepEqual(state.rgb, colorB);
    } finally { stale.service.stop(); }

    await mkdir(path.dirname(pathname), { recursive: true });
    await writeFile(pathname, JSON.stringify({ version: 2, algorithmVersion: 1, contentKey: keyA, rgb: [999, 0, 0] }));
    const malformed = await fixture('wallpaper', { root: f.root, displayIds: ['OTHER'] });
    try {
      await malformed.service.start();
      assert.equal((await malformed.service.wallpaperChanged('OTHER', wallpaper(identityA, keyA))).analyzeWallpaper, true);
    } finally { malformed.service.stop(); }
  } finally { await f.cleanup(); }
});

test('hot config changes modes and transition duration without losing valid state', async () => {
  const f = await fixture('wallpaper');
  try {
    await f.service.start();
    const request = await f.service.wallpaperChanged('DP-1', wallpaper(identityA, keyA));
    await f.service.submitWallpaperAccent('DP-1', {
      rgb: colorA, wallpaperIdentity: identityA, contentKey: keyA, generation: request.generation,
    });
    f.service.updateConfig({ mode: 'default', transitionDurationMs: 0 });
    assert.deepEqual(f.service.getState('DP-1').rgb, [255, 52, 120]);
    assert.equal(f.service.getState('DP-1').transitionDurationMs, 0);
    f.service.updateConfig({ mode: 'wallpaper', transitionDurationMs: 1200 });
    assert.deepEqual(f.service.getState('DP-1').rgb, colorA);
    assert.equal(f.service.getState('DP-1').transitionDurationMs, 1200);
  } finally { f.service.stop(); await f.cleanup(); }
});
