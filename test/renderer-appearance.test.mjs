import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAppearanceState,
  createBrightnessTransition,
  normalizeAppearanceState,
  retargetBrightness,
  sampleBrightness,
} from '../src/renderer/appearance.mjs';

function appearance(overrides = {}) {
  return {
    mode: 'system',
    resolvedTheme: 'dark',
    wallpaperBrightness: 0.72,
    transitionDurationMs: 900,
    ...overrides,
  };
}

function rootFixture() {
  const properties = new Map();
  return {
    dataset: {},
    style: {
      setProperty(name, value) { properties.set(name, value); },
      getPropertyValue(name) { return properties.get(name) || ''; },
    },
  };
}

test('validates resolved appearance payloads defensively', () => {
  assert.deepEqual(normalizeAppearanceState(appearance()), appearance());
  for (const invalid of [
    null,
    appearance({ resolvedTheme: 'auto' }),
    appearance({ wallpaperBrightness: 0.1 }),
    appearance({ wallpaperBrightness: Number.NaN }),
    appearance({ transitionDurationMs: 5001 }),
  ]) {
    assert.throws(() => normalizeAppearanceState(invalid), /appearance/);
  }
});

test('interpolates brightness and retargets from the visible value', () => {
  const state = createBrightnessTransition(1);
  retargetBrightness(state, { target: 0.72, durationMs: 900, now: 100, reducedMotion: false });
  assert.equal(sampleBrightness(state, 100), 1);
  assert.equal(sampleBrightness(state, 550), 0.86);
  retargetBrightness(state, { target: 0.5, durationMs: 400, now: 550, reducedMotion: false });
  assert.equal(sampleBrightness(state, 550), 0.86);
  assert.ok(Math.abs(sampleBrightness(state, 750) - 0.68) < 1e-12);
  assert.equal(sampleBrightness(state, 950), 0.5);
});

test('settles immediately for zero duration or reduced motion', () => {
  const immediate = createBrightnessTransition(1);
  retargetBrightness(immediate, { target: 0.72, durationMs: 0, now: 0, reducedMotion: false });
  assert.equal(sampleBrightness(immediate, 0), 0.72);
  const reduced = createBrightnessTransition(1);
  retargetBrightness(reduced, { target: 0.72, durationMs: 900, now: 0, reducedMotion: true });
  assert.equal(sampleBrightness(reduced, 0), 0.72);
});

test('applies one shared transition duration to theme and accent variables', () => {
  const root = rootFixture();
  const transition = createBrightnessTransition(1);
  applyAppearanceState(root, appearance(), { reducedMotion: false, now: 0, transition });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(root.style.getPropertyValue('--appearance-transition-ms'), '900ms');
  assert.equal(root.style.getPropertyValue('--accent-transition-ms'), '900ms');
  assert.equal(sampleBrightness(transition, 900), 0.72);
  applyAppearanceState(root, appearance({ resolvedTheme: 'light', wallpaperBrightness: 1 }), {
    reducedMotion: true, now: 900, transition,
  });
  assert.equal(root.dataset.theme, 'light');
  assert.equal(root.style.getPropertyValue('--appearance-transition-ms'), '0ms');
  assert.equal(root.style.getPropertyValue('--accent-transition-ms'), '0ms');
  assert.equal(sampleBrightness(transition, 900), 1);
});
