import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../src/config.mjs';
import { validateRuntimeConfig } from '../src/runtime-config.mjs';

test('accepts a complete main-validated snapshot and returns a defensive copy', () => {
  const copy = validateRuntimeConfig(DEFAULT_CONFIG);
  assert.deepEqual(copy, DEFAULT_CONFIG);
  assert.notEqual(copy, DEFAULT_CONFIG);
});

test('rejects malformed complete snapshots without Node-only dependencies', () => {
  assert.throws(() => validateRuntimeConfig({ ...DEFAULT_CONFIG, panel: null }), /invalid runtime/);
});
