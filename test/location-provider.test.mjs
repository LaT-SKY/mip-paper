import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocationProvider } from '../src/location-provider.mjs';

const autoConfig = { mode: 'auto', latitude: null, longitude: null, fallbackLocationId: '101281601' };

test('fixed mode returns configured coordinates without opening Portal', async () => {
  let portalCalls = 0;
  const provider = createLocationProvider({
    config: { ...autoConfig, mode: 'fixed', latitude: 23.02, longitude: 113.75 },
    portal: { resolve: async () => { portalCalls += 1; } },
  });
  assert.deepEqual(await provider.resolve(), { latitude: 23.02, longitude: 113.75, source: 'fixed', accuracyMeters: null });
  assert.equal(portalCalls, 0);
});

test('auto mode prefers Portal then cached coordinates', async () => {
  const portalProvider = createLocationProvider({
    config: autoConfig,
    portal: { resolve: async () => ({ latitude: 23.1, longitude: 113.2, accuracyMeters: 500 }) },
  });
  assert.equal((await portalProvider.resolve()).source, 'portal');

  const cacheProvider = createLocationProvider({
    config: autoConfig,
    portal: { resolve: async () => { throw new Error('denied'); } },
    cache: { getCoordinates: async () => ({ latitude: 23.3, longitude: 113.4 }) },
  });
  assert.equal((await cacheProvider.resolve()).source, 'cache');
});

test('resolves the fallback LocationID when Portal and cache are unavailable', async () => {
  const provider = createLocationProvider({
    config: autoConfig,
    portal: { resolve: async () => { throw new Error('timeout'); } },
    cache: { getCoordinates: async () => null },
    geoLookup: async (id) => {
      assert.equal(id, '101281601');
      return { latitude: 23.02, longitude: 113.75 };
    },
  });
  assert.equal((await provider.resolve()).source, 'fallback');
});
