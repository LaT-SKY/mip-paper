import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createLocationProvider, createPortalLocationAdapter } from '../src/location-provider.mjs';

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

test('subscribes before Start and treats CreateSession result as a session path', async () => {
  const sessionPath = '/org/freedesktop/portal/desktop/session/1_42/wallpaper_session';
  const requestPath = '/org/freedesktop/portal/desktop/request/1_42/wallpaper_start';
  const location = new EventEmitter();
  const request = new EventEmitter();
  let requestSubscribed = false;
  let sessionClosed = false;
  request.once = (event, listener) => {
    if (event === 'Response') requestSubscribed = true;
    return EventEmitter.prototype.once.call(request, event, listener);
  };
  location.CreateSession = async (options) => {
    assert.equal(options['distance-threshold'].value, 10_000);
    assert.equal(options['time-threshold'].value, 1_800);
    assert.equal(options.accuracy.value, 2);
    assert.equal(options.distance_threshold, undefined);
    assert.equal(options.time_threshold, undefined);
    return sessionPath;
  };
  location.Start = async () => {
    assert.equal(requestSubscribed, true);
    request.emit('Response', 0, {});
    location.emit('LocationUpdated', sessionPath, {
      Latitude: 23.02,
      Longitude: 113.75,
      Accuracy: 500,
    });
    return requestPath;
  };

  const bus = {
    name: ':1.42',
    async getProxyObject(name, path) {
      assert.equal(name, 'org.freedesktop.portal.Desktop');
      if (path === '/org/freedesktop/portal/desktop') {
        return { getInterface: () => location };
      }
      if (path === requestPath) return { getInterface: () => request };
      if (path === sessionPath) {
        return { getInterface: () => ({ Close: async () => { sessionClosed = true; } }) };
      }
      throw new Error(`Unexpected proxy path: ${path}`);
    },
    disconnect() {},
  };
  class Variant {
    constructor(signature, value) {
      this.signature = signature;
      this.value = value;
    }
  }
  const portal = createPortalLocationAdapter({
    dbusModule: { sessionBus: () => bus, Variant },
    tokenFactory: (kind) => `wallpaper_${kind}`,
    timeoutMs: 100,
  });

  assert.deepEqual(await portal.resolve(), {
    latitude: 23.02,
    longitude: 113.75,
    accuracyMeters: 500,
  });
  await portal.stop();
  assert.equal(sessionClosed, true);
});

test('reports a Portal timeout without an unhandled location rejection', async () => {
  const sessionPath = '/org/freedesktop/portal/desktop/session/1_42/timeout_session';
  const requestPath = '/org/freedesktop/portal/desktop/request/1_42/timeout_start';
  const location = new EventEmitter();
  const request = new EventEmitter();
  location.CreateSession = async () => sessionPath;
  location.Start = async () => requestPath;
  const bus = {
    name: ':1.42',
    async getProxyObject(name, path) {
      if (path === '/org/freedesktop/portal/desktop') return { getInterface: () => location };
      if (path === requestPath) return { getInterface: () => request };
      if (path === sessionPath) return { getInterface: () => ({ Close: async () => {} }) };
      throw new Error(`Unexpected proxy path: ${path}`);
    },
    disconnect() {},
  };
  class Variant {
    constructor(signature, value) {
      this.signature = signature;
      this.value = value;
    }
  }
  const portal = createPortalLocationAdapter({
    dbusModule: { sessionBus: () => bus, Variant },
    tokenFactory: (kind) => `timeout_${kind}`,
    timeoutMs: 10,
  });

  await assert.rejects(portal.resolve(), /Location Portal timed out/);
  await portal.stop();
});
