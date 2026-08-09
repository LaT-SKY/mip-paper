import assert from 'node:assert/strict';
import test from 'node:test';

import { createQWeatherClient } from '../src/qweather-client.mjs';

function response(value, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => value };
}

test('uses header authentication and normalizes current weather', async () => {
  const calls = [];
  const client = createQWeatherClient({
    credentials: { apiHost: 'weather.example.com', apiKey: 'secret' },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return response({
        metadata: { tag: 'test', attributions: ['QWeather'] },
        condition: { text: 'Cloudy', code: '101', icon: '101' },
        temperature: { value: 31, unit: 'celsius' },
        humidity: 0.7,
      });
    },
  });
  assert.deepEqual(await client.fetchCurrent({ latitude: 23.1, longitude: 113.2 }), {
    temperature: 31, condition: 'Cloudy', icon: '101', humidity: 70,
  });
  assert.match(calls[0].url, /\/weather\/v1\/current\/23\.1\/113\.2$/);
  assert.doesNotMatch(calls[0].url, /secret|key=/);
  assert.equal(calls[0].options.headers['X-QW-Api-Key'], 'secret');
});

test('normalizes daily, tide and fallback location responses', async () => {
  const client = createQWeatherClient({
    credentials: { apiHost: 'weather.example.com', apiKey: 'secret' },
    fetch: async (url) => {
      if (url.includes('/daily/')) return response({
        metadata: { tag: 'test', attributions: ['QWeather'] },
        days: [{
          forecastStartTime: '2026-08-09T00:00+08:00',
          temperatureMax: { value: 33, unit: 'celsius' },
          temperatureMin: { value: 26, unit: 'celsius' },
          daytime: { condition: { text: 'Rain', icon: '305' } },
        }],
      });
      if (url.includes('/ocean/tide')) return response({ tideTable: [{ fxTime: '2026-08-09T04:00+08:00', height: '2.4', type: 'H' }] });
      return response({ location: [{ id: '101281601', lat: '23.02', lon: '113.75' }] });
    },
  });
  assert.equal((await client.fetchDaily({ latitude: 23, longitude: 113 }))[0].condition, 'Rain');
  assert.equal((await client.fetchTide({ stationId: 'P2352', date: '20260809' })).events[0].type, 'H');
  assert.deepEqual(await client.resolveLocation('101281601'), { latitude: 23.02, longitude: 113.75 });
});

test('reports typed failures without credential values', async () => {
  const client = createQWeatherClient({
    credentials: { apiHost: 'weather.example.com', apiKey: 'secret-value' },
    fetch: async () => response({}, 429),
  });
  await assert.rejects(client.fetchCurrent({ latitude: 23, longitude: 113 }), (error) => {
    assert.equal(error.code, 'RATE_LIMITED');
    assert.doesNotMatch(error.message, /secret-value|weather\.example\.com/);
    return true;
  });
});
