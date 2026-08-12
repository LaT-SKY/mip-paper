import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createKdeAccentWatcher, parseKdeAccent } from '../src/kde-accent.mjs';

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

test('parses strict KDE accent values with the approved priority', () => {
  assert.deepEqual(parseKdeAccent('[General]\nAccentColor=105,197,211\n[Colors:View]\nDecorationFocus=1,2,3\n'), [105, 197, 211]);
  assert.deepEqual(parseKdeAccent('[Colors:View]\nDecorationFocus=1,2,3\n'), [1, 2, 3]);
  assert.deepEqual(parseKdeAccent('[General]\nAccentColor=1,2,999\n[Colors:View]\nDecorationFocus=4,5,6\n'), [4, 5, 6]);
  assert.equal(parseKdeAccent('[General]\nAccentColor=1, 2,3\n'), null);
  assert.equal(parseKdeAccent('[General]\nAccentColor=1,2\n'), null);
  assert.throws(() => parseKdeAccent(null), /text/);
});

test('watches atomic replacements with a 350ms debounce', async () => {
  const clock = new Clock();
  const emitter = new EventEmitter();
  emitter.close = () => { emitter.closed = true; };
  const accents = [];
  const directories = [];
  let reads = 0;
  const watcher = createKdeAccentWatcher({
    pathname: '/home/tester/.config/kdeglobals',
    read: async () => { reads += 1; return '[General]\nAccentColor=10,20,30\n'; },
    watch(directory, callback) { directories.push(directory); emitter.on('change', callback); return emitter; },
    timers: clock,
    onAccent: (accent) => accents.push(accent),
    onError: () => {},
  });
  watcher.start();
  emitter.emit('change', 'change', 'kdeglobals');
  emitter.emit('change', 'rename', 'kdeglobals');
  emitter.emit('change', 'change', 'other');
  clock.advance(349);
  assert.equal(reads, 0);
  clock.advance(1);
  await watcher.whenIdle();
  assert.deepEqual(directories, ['/home/tester/.config']);
  assert.equal(reads, 1);
  assert.deepEqual(accents, [[10, 20, 30]]);
  watcher.stop();
  assert.equal(emitter.closed, true);
});

test('reload publishes null and errors without stale work after stop', async () => {
  const emitter = new EventEmitter();
  emitter.close = () => {};
  const accents = [];
  const errors = [];
  let value = '[General]\nAccentColor=broken\n';
  const watcher = createKdeAccentWatcher({
    pathname: '/config/kdeglobals',
    read: async () => {
      if (value instanceof Error) throw value;
      return value;
    },
    watch: (_directory, callback) => { emitter.on('change', callback); return emitter; },
    onAccent: (accent) => accents.push(accent),
    onError: (error) => errors.push(error),
  });
  watcher.start();
  await watcher.reload();
  value = new Error('unavailable');
  await watcher.reload();
  watcher.stop();
  watcher.stop();
  emitter.emit('change', 'change', null);
  assert.deepEqual(accents, [null]);
  assert.match(errors[0].message, /unavailable/);
});
