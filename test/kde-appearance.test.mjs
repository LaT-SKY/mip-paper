import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  createKdeAppearanceWatcher,
  parseKdeWindowBackground,
  relativeLuminance,
  resolveKdeTheme,
} from '../src/kde-appearance.mjs';

class FakeTimers {
  constructor() { this.nextId = 1; this.pending = new Map(); }
  setTimeout(callback) { const id = this.nextId++; this.pending.set(id, callback); return id; }
  clearTimeout(id) { this.pending.delete(id); }
  flush() { const callbacks = [...this.pending.values()]; this.pending.clear(); callbacks.forEach((callback) => callback()); }
}

class FakeWatcher extends EventEmitter {
  close() { this.closed = true; }
}

test('parses KDE window background with strict priority and fallback', () => {
  assert.deepEqual(parseKdeWindowBackground([
    '[Colors:Window]',
    'BackgroundNormal=12,34,56',
    '[Colors:View]',
    'BackgroundNormal=220,230,240',
  ].join('\n')), [12, 34, 56]);
  assert.deepEqual(parseKdeWindowBackground('[Colors:View]\r\nBackgroundNormal=220,230,240\r\n'), [220, 230, 240]);
  assert.equal(parseKdeWindowBackground('[Colors:Window]\nBackgroundNormal=bad'), null);
  assert.equal(parseKdeWindowBackground('[Colors:Window]\nBackgroundNormal=256,0,0'), null);
});

test('classifies KDE background using relative luminance', () => {
  assert.ok(relativeLuminance([0, 0, 0]) < 0.35);
  assert.ok(relativeLuminance([255, 255, 255]) > 0.35);
  assert.equal(resolveKdeTheme('[Colors:Window]\nBackgroundNormal=0,0,0').theme, 'dark');
  assert.equal(resolveKdeTheme('[Colors:Window]\nBackgroundNormal=255,255,255').theme, 'light');
  assert.throws(() => resolveKdeTheme('[Colors:Window]\nBackgroundNormal=bad'), /background color/);
});

test('watcher debounces reloads and ignores stale work after stop', async () => {
  const timers = new FakeTimers();
  const fsWatcher = new FakeWatcher();
  const themes = [];
  const errors = [];
  let release;
  let reads = 0;
  let schedule;
  const read = async () => {
    reads += 1;
    if (reads === 1) await new Promise((resolve) => { release = resolve; });
    return '[Colors:Window]\nBackgroundNormal=0,0,0';
  };
  const watcher = createKdeAppearanceWatcher({
    pathname: '/home/test/.config/kdeglobals',
    read,
    watch: (_directory, callback) => { schedule = callback; return fsWatcher; },
    timers,
    debounceMs: 20,
    onTheme: (theme) => themes.push(theme),
    onError: (error) => errors.push(error),
  });
  watcher.start();
  await Promise.resolve();
  schedule('change', 'kdeglobals');
  schedule('rename', 'kdeglobals');
  assert.equal(timers.pending.size, 1);
  timers.flush();
  watcher.stop();
  release();
  await watcher.whenIdle();
  assert.deepEqual(themes, []);
  assert.deepEqual(errors, []);
  assert.equal(fsWatcher.closed, true);
  watcher.stop();
});

test('watcher reports current file errors but suppresses errors after stop', async () => {
  const timers = new FakeTimers();
  const fsWatcher = new FakeWatcher();
  const errors = [];
  const watcher = createKdeAppearanceWatcher({
    pathname: '/home/test/.config/kdeglobals',
    read: async () => { throw new Error('broken KDE file'); },
    watch: () => fsWatcher,
    timers,
    onError: (error) => errors.push(error),
  });
  watcher.start();
  timers.flush();
  await watcher.whenIdle();
  assert.match(errors[0].message, /broken KDE file/);
  watcher.stop();
  fsWatcher.emit('error', new Error('late watcher error'));
  assert.equal(errors.length, 1);
});
