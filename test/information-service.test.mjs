import assert from 'node:assert/strict';
import test from 'node:test';

import { createInformationService } from '../src/information-service.mjs';

const config = { weather: { tideStationId: 'P2352' } };

test('publishes a sanitized weather snapshot after a non-blocking start', async () => {
  const timers = [];
  const service = createInformationService({
    config,
    locationProvider: { resolve: async () => ({ latitude: 23, longitude: 113, source: 'portal' }) },
    qweatherClient: {
      fetchCurrent: async () => ({ temperature: 30, condition: 'Cloudy' }),
      fetchDaily: async () => [{ date: '2026-08-09', condition: 'Rain' }],
      fetchTide: async () => ({ events: [] }),
    },
    cache: { read: async () => ({ status: 'unavailable' }), write: async () => {} },
    clock: () => Date.parse('2026-08-09T08:00:00+08:00'),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  });
  assert.equal(service.getSnapshot().weather.status, 'unavailable');
  const updates = [];
  service.subscribe((snapshot) => updates.push(snapshot));
  service.start();
  await service.whenIdle();
  assert.equal(service.getSnapshot().weather.current.temperature, 30);
  assert.equal(service.getSnapshot().locationSource, 'portal');
  assert.equal('latitude' in service.getSnapshot(), false);
  assert.ok(timers.some(({ delay }) => delay === 30 * 60 * 1000));
  assert.equal(updates.length, 1);
});

test('uses stale cache when refresh fails and stop clears timers', async () => {
  const cleared = [];
  const cached = { fetchedAt: '2026-08-09T00:00:00Z', weather: { current: { temperature: 28 } }, tide: { events: [] } };
  const service = createInformationService({
    config,
    locationProvider: { resolve: async () => { throw new Error('denied'); }, stop: () => { cleared.push('location'); } },
    qweatherClient: {},
    cache: { read: async () => ({ status: 'stale', snapshot: cached }), write: async () => {} },
    clock: () => Date.parse('2026-08-09T08:00:00Z'),
    setTimeout: () => 41,
    clearTimeout: (id) => cleared.push(id),
  });
  service.start();
  await service.whenIdle();
  assert.equal(service.getSnapshot().weather.status, 'stale');
  service.stop();
  assert.ok(cleared.includes(41));
  assert.ok(cleared.includes('location'));
});
