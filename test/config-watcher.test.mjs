import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createConfigWatcher } from '../src/config-watcher.mjs';

class FakeClock {
  constructor() {
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { callback, delay });
    return id;
  }

  clearTimeout(id) { this.timers.delete(id); }

  advance(duration) {
    for (const [id, timer] of [...this.timers]) {
      if (timer.delay <= duration) {
        this.timers.delete(id);
        timer.callback();
      } else {
        timer.delay -= duration;
      }
    }
  }

  pendingCount() { return this.timers.size; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFixture({ loads = [] } = {}) {
  const clock = new FakeClock();
  const fsWatcher = new EventEmitter();
  fsWatcher.closed = false;
  fsWatcher.close = () => { fsWatcher.closed = true; };
  const watchCalls = [];
  const configs = [];
  const errors = [];
  let loadCount = 0;
  const watcher = createConfigWatcher({
    pathname: '/config/mip-paper/config.json',
    load: async () => {
      const result = loads[loadCount] ?? { audio: { enabled: true } };
      loadCount += 1;
      return result instanceof Promise ? result : result;
    },
    onConfig: (config) => configs.push(config),
    onError: (error) => errors.push(error),
    watch(directory, callback) {
      watchCalls.push(directory);
      fsWatcher.on('change', callback);
      return fsWatcher;
    },
    timers: clock,
  });
  return {
    watcher,
    clock,
    fsWatcher,
    watchCalls,
    configs,
    errors,
    get loadCount() { return loadCount; },
    emit(eventType = 'change', filename = 'config.json') {
      fsWatcher.emit('change', eventType, filename);
    },
    async flush() {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

test('debounces directory events and reloads atomic replacements', async () => {
  const fixture = createFixture();
  fixture.watcher.start();
  fixture.emit('rename', 'config.json');
  fixture.emit('change', 'config.json');
  fixture.emit('change', 'unrelated.json');
  assert.deepEqual(fixture.watchCalls, ['/config/mip-paper']);
  fixture.clock.advance(99);
  assert.equal(fixture.loadCount, 0);
  fixture.clock.advance(1);
  await fixture.flush();
  assert.equal(fixture.loadCount, 1);
  assert.deepEqual(fixture.configs, [{ audio: { enabled: true } }]);
});

test('accepts an unavailable filename and suppresses stale async loads', async () => {
  const first = deferred();
  const second = deferred();
  const fixture = createFixture({ loads: [first.promise, second.promise] });
  fixture.watcher.start();
  fixture.emit('change', null);
  fixture.clock.advance(100);
  fixture.emit('rename', 'config.json');
  fixture.clock.advance(100);
  second.resolve({ audio: { gain: 2 } });
  await fixture.flush();
  first.resolve({ audio: { gain: 1 } });
  await fixture.flush();
  assert.deepEqual(fixture.configs, [{ audio: { gain: 2 } }]);
});

test('keeps the last valid config after a failed load', async () => {
  const fixture = createFixture({ loads: [Promise.reject(new SyntaxError('broken json'))] });
  fixture.watcher.start();
  fixture.emit();
  fixture.clock.advance(100);
  await fixture.flush();
  assert.equal(fixture.configs.length, 0);
  assert.equal(fixture.errors.length, 1);
  assert.match(fixture.errors[0].message, /broken json/);
});

test('start and stop are idempotent and stop cancels pending work', () => {
  const fixture = createFixture();
  fixture.watcher.start();
  fixture.watcher.start();
  fixture.emit();
  fixture.watcher.stop();
  fixture.watcher.stop();
  assert.equal(fixture.watchCalls.length, 1);
  assert.equal(fixture.fsWatcher.closed, true);
  assert.equal(fixture.clock.pendingCount(), 0);
});
