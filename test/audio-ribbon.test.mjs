import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  advanceAudioRibbon,
  applyAudioConfig,
  applySpectrumSnapshot,
  buildEnergyPoints,
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

test('maps merged stereo bands to a non-flat cyan energy curve', () => {
  const silent = buildEnergyPoints(Array(72).fill(0), Array(72).fill(0));
  const left = Array.from({ length: 72 }, (_, index) => (index === 24 ? 1 : 0));
  const right = Array.from({ length: 72 }, (_, index) => (index === 48 ? 0.8 : 0));
  const loud = buildEnergyPoints(left, right);
  assert.equal(silent.every((point) => point.y === 70), true);
  assert.deepEqual(loud[0], { x: 0, y: 70 });
  assert.deepEqual(loud.at(-1), { x: 1000, y: 70 });
  assert.ok(loud[24].y < 70);
  assert.ok(loud[48].y < 70);
  assert.equal(loud[35].y, 70);
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
