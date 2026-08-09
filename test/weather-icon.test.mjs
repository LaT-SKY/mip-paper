import assert from 'node:assert/strict';
import test from 'node:test';

import { qweatherIconClass } from '../src/weather-icon.mjs';

test('maps QWeather condition codes to official classes', () => {
  assert.equal(qweatherIconClass('101'), 'qi-101');
  assert.equal(qweatherIconClass(305), 'qi-305');
  assert.equal(qweatherIconClass('999'), 'qi-999');
});

test('uses the official unknown icon for unsafe or missing codes', () => {
  for (const value of [null, undefined, '', 'rain', '101 extra', '<script>', 10, 1000]) {
    assert.equal(qweatherIconClass(value), 'qi-999');
  }
});
