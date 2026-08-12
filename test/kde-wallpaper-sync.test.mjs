import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createKdeWallpaperSync } from '../src/kde-wallpaper-sync.mjs';

class Clock {
  constructor() { this.next = 1; this.timers = new Map(); }
  setTimeout(callback, delay) { const id = this.next++; this.timers.set(id, { callback, delay }); return id; }
  clearTimeout(id) { this.timers.delete(id); }
  advance(ms) {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delay <= ms) { this.timers.delete(id); timer.callback(); }
      else timer.delay -= ms;
    }
  }
}

test('reconciles each display and debounces Plasma changes', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-sync-'));
  const clock = new Clock();
  const watcher = new EventEmitter();
  watcher.close = () => {};
  const updates = [];
  const statuses = [];
  const imports = [];
  const sync = createKdeWallpaperSync({
    config: { wallpaper: { mode: 'kde' } },
    plasmaConfigPath: '/config/plasma-org.kde.plasma.desktop-appletsrc',
    env: { XDG_DATA_HOME: dataHome },
    homedir: '/home/tester',
    getDisplays: () => [{ id: 'a' }, { id: 'b' }],
    readConfig: async () => 'fixture',
    parse: () => [
      { screenIndex: 0, containmentId: 1, plugin: 'org.kde.image', sourcePath: '/one.png', status: 'supported' },
      { screenIndex: 1, containmentId: 2, plugin: 'org.kde.image', sourcePath: '/two.png', status: 'supported' },
    ],
    watch: (_directory, callback) => { watcher.on('change', callback); return watcher; },
    inspect: async (pathname) => ({ format: 'png', size: 7, contentKey: pathname.includes('/a/') ? `sha256:${'a'.repeat(64)}` : `sha256:${'b'.repeat(64)}` }),
    importDisplay: async (source, destination) => { imports.push([source, destination]); },
    defaultWallpaper: '/default.jpg',
    manualWallpaper: '/manual.jpg',
    timers: clock,
    onUpdate: (source) => updates.push(source),
    onStatus: (status) => statuses.push(status),
  });
  sync.start();
  await sync.whenIdle();
  assert.equal(imports.length, 0); // missing real source files fall back independently
  assert.equal(updates.length, 2);
  assert.equal(updates[0].displayId, 'a');
  assert.equal(updates[1].displayId, 'b');
  assert.notEqual(updates[0].contentKey, updates[1].contentKey);
  watcher.emit('change', 'change', 'plasma-org.kde.plasma.desktop-appletsrc');
  watcher.emit('change', 'rename', 'plasma-org.kde.plasma.desktop-appletsrc');
  watcher.emit('change', 'change', 'unrelatedrc');
  clock.advance(349);
  assert.equal(updates.length, 2);
  clock.advance(1);
  await sync.whenIdle();
  assert.equal(updates.length, 2);
  sync.stop();
  assert.ok(statuses.every((status) => status.displayId));
  await rm(dataHome, { recursive: true, force: true });
});

test('keeps an unchanged cached source synchronized', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-sync-'));
  const source = path.join(dataHome, 'source.png');
  await writeFile(source, 'fixture');
  const statuses = [];
  const sync = createKdeWallpaperSync({
    config: { wallpaper: { mode: 'kde' } },
    plasmaConfigPath: '/config/plasma-org.kde.plasma.desktop-appletsrc',
    env: { XDG_DATA_HOME: dataHome },
    homedir: '/home/tester',
    getDisplays: () => [{ id: 'a' }],
    readConfig: async () => 'fixture',
    parse: () => [{ screenIndex: 0, sourcePath: source, status: 'supported' }],
    inspect: async () => ({ format: 'png', size: 7, contentKey: `sha256:${'c'.repeat(64)}` }),
    importDisplay: async () => {},
    defaultWallpaper: '/default.jpg',
    onUpdate: (record) => statuses.push({ update: record }),
    onStatus: (status) => statuses.push(status),
  });
  sync.start();
  await sync.whenIdle();
  await sync.reconcile();
  assert.equal(statuses.at(-1).status, 'synchronized');
  assert.equal(statuses.find((entry) => entry.update)?.update.contentKey, `sha256:${'c'.repeat(64)}`);
  sync.stop();
  await rm(dataHome, { recursive: true, force: true });
});

test('manual mode publishes one managed image to every display', async () => {
  const updates = [];
  const sync = createKdeWallpaperSync({
    config: { wallpaper: { mode: 'manual' } },
    plasmaConfigPath: '/missing',
    env: { XDG_DATA_HOME: '/data' },
    homedir: '/home/tester',
    getDisplays: () => [{ id: 'a' }, { id: 'b' }],
    manualWallpaper: '/manual.jpg',
    inspect: async () => ({ format: 'png', size: 7, contentKey: `sha256:${'d'.repeat(64)}` }),
    onUpdate: (source) => updates.push(source),
  });
  sync.start();
  await sync.whenIdle();
  assert.deepEqual(updates.map(({ displayId, wallpaperUrl, contentKey }) => [displayId, wallpaperUrl, contentKey]), [
    ['a', 'file:///manual.jpg', `sha256:${'d'.repeat(64)}`],
    ['b', 'file:///manual.jpg', `sha256:${'d'.repeat(64)}`],
  ]);
});
