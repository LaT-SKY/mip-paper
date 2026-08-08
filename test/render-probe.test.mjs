import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  installSignalCleanup,
  parseNvidiaSmiOutput,
  parseSystemdResourceOutput,
} from '../scripts/render-probe.mjs';

test('parses systemd resource fields by key rather than output order', () => {
  assert.deepEqual(
    parseSystemdResourceOutput('MemoryCurrent=204357632\nCPUUsageNSec=8558400000\n'),
    { cpuUsageNSec: 8558400000, memoryCurrent: 204357632 },
  );
});

test('parses one-shot nvidia-smi GPU metrics', () => {
  assert.deepEqual(
    parseNvidiaSmiOutput('0, NVIDIA GeForce RTX 5060 Laptop GPU, 12, 7, 1309, 8151, 27.61, 53\n'),
    [{
      index: 0,
      name: 'NVIDIA GeForce RTX 5060 Laptop GPU',
      utilizationGpuPercent: 12,
      utilizationMemoryPercent: 7,
      memoryUsedMiB: 1309,
      memoryTotalMiB: 8151,
      powerDrawW: 27.61,
      temperatureC: 53,
    }],
  );
});

test('signal cleanup restores probe environment before exiting', async () => {
  const signals = new EventEmitter();
  let restored = 0;
  let exitCode = null;
  installSignalCleanup(
    async () => { restored += 1; },
    signals,
    (code) => { exitCode = code; },
  );
  signals.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(restored, 1);
  assert.equal(exitCode, 143);
});
