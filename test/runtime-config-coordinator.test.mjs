import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuntimeConfigCoordinator } from '../src/runtime-config-coordinator.mjs';

test('commits only successful current-generation candidates and redacts errors', async () => {
  const applied = [];
  const errors = [];
  const coordinator = createRuntimeConfigCoordinator({
    config: { id: 0 },
    credentials: null,
    applyConfig: async (config) => { applied.push(config); },
    applyCredentials: async () => { throw new Error('apiHost=https://secret.example key=private'); },
    onError: (error) => errors.push(error),
  });
  await coordinator.updateConfig({ id: 1 });
  await coordinator.updateCredentials({ apiHost: 'secret', apiKey: 'private' });
  assert.deepEqual(coordinator.getState().config, { id: 1 });
  assert.equal(coordinator.getState().credentials, null);
  assert.equal(applied.length, 1);
  assert.match(errors[0].message, /redacted/);
  assert.doesNotMatch(errors[0].message, /secret|private/);
  coordinator.stop();
  await coordinator.updateConfig({ id: 2 });
  assert.deepEqual(coordinator.getState().config, { id: 1 });
});

test('supersedes queued work and drains an active operation during stop', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const applied = [];
  const coordinator = createRuntimeConfigCoordinator({
    config: { id: 0 },
    applyConfig: async (config, { assertCurrent }) => {
      applied.push(config.id);
      if (config.id === 1) await gate;
      if (config.id === 3) await stopGate;
      assertCurrent();
    },
  });
  const first = coordinator.updateConfig({ id: 1 });
  const second = coordinator.updateConfig({ id: 2 });
  release();
  assert.equal(await first, false);
  assert.equal(await second, true);
  assert.deepEqual(coordinator.getState().config, { id: 2 });

  let stopRelease;
  const stopGate = new Promise((resolve) => { stopRelease = resolve; });
  const active = coordinator.updateConfig({ id: 3 });
  await Promise.resolve();
  const stopping = coordinator.stop();
  stopRelease();
  await stopping;
  assert.equal(await active, false);
});
