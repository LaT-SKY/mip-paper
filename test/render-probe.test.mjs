import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { installSignalCleanup } from '../scripts/render-probe.mjs';

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
