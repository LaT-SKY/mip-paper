import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createShutdownCoordinator,
  installShutdownHandlers,
} from '../src/app-lifecycle.mjs';

test('shutdown is idempotent and awaits cleanup in order before quitting', async () => {
  const calls = [];
  let releaseAudio;
  const audioStopped = new Promise((resolve) => { releaseAudio = resolve; });
  const coordinator = createShutdownCoordinator({
    quit: () => calls.push('quit'),
    stopConfigWatcher: () => calls.push('config'),
    stopAudioSpectrum: async () => {
      calls.push('audio:start');
      await audioStopped;
      calls.push('audio:end');
    },
    stopInformation: () => calls.push('information'),
    stopWindowManager: () => calls.push('windows'),
  });

  const first = coordinator.requestShutdown();
  const second = coordinator.requestShutdown();
  assert.equal(first, second);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['config', 'audio:start']);

  releaseAudio();
  await first;
  assert.deepEqual(calls, [
    'config',
    'audio:start',
    'audio:end',
    'information',
    'windows',
    'quit',
  ]);
});

test('before-quit is prevented only until cleanup permits the final quit', async () => {
  const coordinator = createShutdownCoordinator({ quit() {} });
  let prevented = 0;
  const event = { preventDefault() { prevented += 1; } };

  await coordinator.handleBeforeQuit(event);
  assert.equal(prevented, 1);
  assert.equal(coordinator.handleBeforeQuit(event), null);
  assert.equal(prevented, 1);
});

test('cleanup failures are logged without skipping later steps', async () => {
  const calls = [];
  const errors = [];
  const coordinator = createShutdownCoordinator({
    quit: () => calls.push('quit'),
    stopConfigWatcher() { throw new Error('watcher failed'); },
    stopAudioSpectrum: async () => { throw new Error('audio failed'); },
    stopInformation: () => calls.push('information'),
    stopWindowManager: () => calls.push('windows'),
    logger: { error: (message) => errors.push(message) },
  });

  await coordinator.requestShutdown();
  assert.deepEqual(calls, ['information', 'windows', 'quit']);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /config watcher.*watcher failed/);
  assert.match(errors[1], /audio spectrum.*audio failed/);
});

test('shutdown invalidates runtime updates before stopping appearance and windows', async () => {
  const calls = [];
  const coordinator = createShutdownCoordinator({
    quit: () => calls.push('quit'),
    stopRuntimeCoordinator: () => calls.push('runtime'),
    stopConfigWatcher: () => calls.push('config'),
    stopCredentialsWatcher: () => calls.push('credentials'),
    stopAppearance: () => calls.push('appearance'),
    stopWindowManager: () => calls.push('windows'),
  });
  await coordinator.requestShutdown();
  assert.ok(calls.indexOf('runtime') < calls.indexOf('appearance'));
  assert.ok(calls.indexOf('config') < calls.indexOf('appearance'));
  assert.ok(calls.indexOf('appearance') < calls.indexOf('windows'));
});

test('Electron before-quit and SIGTERM share the coordinator', () => {
  const app = new EventEmitter();
  const processTarget = new EventEmitter();
  const requests = [];
  const coordinator = {
    handleBeforeQuit: (event) => requests.push(['before-quit', event]),
    requestShutdown: () => requests.push(['SIGTERM']),
  };
  const removeHandlers = installShutdownHandlers({ app, processTarget, coordinator });
  const event = { preventDefault() {} };

  app.emit('before-quit', event);
  processTarget.emit('SIGTERM');
  processTarget.emit('SIGTERM');
  assert.deepEqual(requests, [['before-quit', event], ['SIGTERM']]);

  removeHandlers();
  app.emit('before-quit', event);
  assert.equal(requests.length, 2);
});

test('main installs the shared application shutdown handlers', async () => {
  const main = await readFile('src/main.mjs', 'utf8');
  assert.match(main, /app\.setName\('Mip-Paper'\)/);
  assert.match(main, /createShutdownCoordinator/);
  assert.match(main, /installShutdownHandlers\(\{\s*app,\s*processTarget:\s*process,/);
  assert.doesNotMatch(main, /quitInProgress|quitReady/);
});
