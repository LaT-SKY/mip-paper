import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  advanceAudioRibbon,
  applyAudioConfig,
  applySpectrumSnapshot,
  buildMirroredRibbonPoints,
  buildRibbonPoints,
  createAudioRibbonState,
  pointsToSmoothPath,
} from '../src/renderer/audio-ribbon.mjs';

function spectrum(sequence, left, right, rms, status = 'active') {
  return {
    status,
    sequence,
    timestampMs: sequence * 10,
    left: Array(72).fill(left),
    right: Array(72).fill(right),
    rms,
  };
}

test('rejects stale snapshots and maps stereo channels independently', () => {
  const state = createAudioRibbonState(DEFAULT_CONFIG.audio);
  assert.equal(applySpectrumSnapshot(state, spectrum(2, 0.2, 0.8, 0.5), 100), true);
  assert.equal(applySpectrumSnapshot(state, spectrum(1, 1, 1, 1), 110), false);
  advanceAudioRibbon(state, 100, 200);
  assert.ok(state.left.every((value, index) => value < state.right[index]));
  assert.equal(state.sequence, 2);
});

test('uses configurable silence delay, fade out and fade in immediately', () => {
  const state = createAudioRibbonState({
    ...DEFAULT_CONFIG.audio,
    silenceDelayMs: 100,
    fadeOutMs: 200,
    fadeInMs: 50,
  });
  applySpectrumSnapshot(state, spectrum(1, 0.5, 0.5, 0.5), 0);
  advanceAudioRibbon(state, 50, 50);
  assert.equal(state.opacity, 1);
  applySpectrumSnapshot(state, spectrum(2, 0, 0, 0, 'silent'), 60);
  advanceAudioRibbon(state, 99, 159);
  assert.equal(state.opacity, 1);
  advanceAudioRibbon(state, 100, 259);
  assert.ok(state.opacity > 0 && state.opacity < 1);
  applyAudioConfig(state, { ...DEFAULT_CONFIG.audio, fadeInMs: 0 });
  applySpectrumSnapshot(state, spectrum(3, 0.5, 0.5, 0.5), 260);
  advanceAudioRibbon(state, 0, 260);
  assert.equal(state.opacity, 1);
});

test('unavailable and disabled states fade without resetting the last curves', () => {
  const state = createAudioRibbonState({ ...DEFAULT_CONFIG.audio, fadeOutMs: 100 });
  applySpectrumSnapshot(state, spectrum(1, 0.5, 0.5, 0.5), 0);
  advanceAudioRibbon(state, 160, 160);
  applySpectrumSnapshot(state, spectrum(2, 0, 0, 0, 'unavailable'), 170);
  const before = state.left[0];
  advanceAudioRibbon(state, 50, 220);
  assert.ok(state.opacity > 0 && state.opacity < 1);
  assert.ok(state.left[0] < before);
  applyAudioConfig(state, { ...DEFAULT_CONFIG.audio, enabled: false, fadeOutMs: 0 });
  advanceAudioRibbon(state, 0, 220);
  assert.equal(state.opacity, 0);
  assert.equal(state.status, 'unavailable');
});

test('tapers both ends to a flat baseline and emits a finite smooth path', () => {
  const points = buildRibbonPoints(Array(72).fill(1), {
    baseline: 50,
    amplitude: 20,
    direction: -1,
  });
  assert.deepEqual(points[0], { x: 0, y: 50 });
  assert.deepEqual(points.at(-1), { x: 1000, y: 50 });
  assert.equal(points[1].y, 50);
  assert.equal(points.at(-2).y, 50);
  assert.ok(points[10].y < 50);
  const path = pointsToSmoothPath(points);
  assert.match(path, /^M 0 50 C /);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test('builds the coaxial mirror from one baseline with expanded visual dynamics', () => {
  const values = Array(72).fill(0.25);
  const { left, energy, right } = buildMirroredRibbonPoints(values, values);
  const center = 35;

  for (const points of [left, energy, right]) {
    assert.equal(points[0].y, 70);
    assert.equal(points.at(-1).y, 70);
  }
  assert.ok(left[center].y < 70);
  assert.ok(energy[center].y < 70);
  assert.ok(right[center].y > 70);
  assert.ok(70 - left[center].y > 52 * 0.25);
  assert.ok(70 - energy[center].y > 40 * 0.25);
});

test('uses the full approved height for high-energy stereo bands', () => {
  const loud = Array(72).fill(1);
  const { left, energy, right } = buildMirroredRibbonPoints(loud, loud);
  assert.ok(left[35].y <= 18);
  assert.ok(energy[35].y <= 30);
  assert.ok(right[35].y >= 122);
});

test('rejects malformed snapshots and invalid audio config', () => {
  const state = createAudioRibbonState(DEFAULT_CONFIG.audio);
  assert.equal(applySpectrumSnapshot(state, { ...spectrum(1, 0, 0, 0), left: [] }, 0), false);
  assert.equal(applySpectrumSnapshot(state, { ...spectrum(1, 0, 0, 0), status: 'recording' }, 0), false);
  assert.throws(
    () => applyAudioConfig(state, { ...DEFAULT_CONFIG.audio, fadeInMs: -1 }),
    /invalid audio config/,
  );
});
