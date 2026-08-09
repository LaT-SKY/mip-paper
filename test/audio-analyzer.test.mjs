import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BAND_COUNT,
  FFT_SIZE,
  HOP_SIZE,
  bandIndexForFrequency,
  createSpectrumAnalyzer,
} from '../src/audio-analyzer.mjs';

function sine(frequency, amplitude, count, sampleRate = 48_000) {
  return Float32Array.from({ length: count }, (_, index) => (
    Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude
  ));
}

test('keeps left and right spectral peaks independent across overlapping windows', () => {
  const frames = [];
  const analyzer = createSpectrumAnalyzer({ onFrame: (frame) => frames.push(frame) });
  analyzer.push(
    sine(375, 0.8, FFT_SIZE + HOP_SIZE),
    sine(3000, 0.8, FFT_SIZE + HOP_SIZE),
  );
  assert.equal(frames.length, 2);
  const frame = frames.at(-1);
  assert.equal(frame.left.indexOf(Math.max(...frame.left)), bandIndexForFrequency(375));
  assert.equal(frame.right.indexOf(Math.max(...frame.right)), bandIndexForFrequency(3000));
  assert.equal(frame.left.length, BAND_COUNT);
  assert.equal(frame.right.length, BAND_COUNT);
  assert.ok(frame.rms > 0.4 && frame.rms < 0.7);
});

test('gates silence and releases more slowly than it attacks', () => {
  const frames = [];
  const analyzer = createSpectrumAnalyzer({ onFrame: (frame) => frames.push(frame) });
  const loud = sine(750, 0.7, FFT_SIZE);
  analyzer.push(loud, loud);
  const attacked = Math.max(...frames.at(-1).left);
  assert.ok(attacked > 0.25);
  analyzer.push(new Float32Array(FFT_SIZE), new Float32Array(FFT_SIZE));
  const beforeRelease = Math.max(...frames.at(-2).left);
  const released = Math.max(...frames.at(-1).left);
  assert.equal(frames.at(-1).silent, true);
  assert.ok(beforeRelease > attacked);
  assert.ok(released > 0 && released < beforeRelease);
});

test('gain raises quiet spectra without emitting invalid values', () => {
  const normalFrames = [];
  const boostedFrames = [];
  const normal = createSpectrumAnalyzer({ gain: 1, onFrame: (frame) => normalFrames.push(frame) });
  const boosted = createSpectrumAnalyzer({ gain: 4, onFrame: (frame) => boostedFrames.push(frame) });
  const signal = sine(1500, 0.03, FFT_SIZE);
  normal.push(signal, signal);
  boosted.push(signal, signal);
  assert.ok(Math.max(...boostedFrames[0].left) > Math.max(...normalFrames[0].left));
  for (const value of [
    ...boostedFrames[0].left,
    ...boostedFrames[0].right,
    boostedFrames[0].rms,
  ]) {
    assert.ok(Number.isFinite(value) && value >= 0 && value <= 1);
  }
});

test('validates channel lengths and gain, and reset clears pending samples', () => {
  const frames = [];
  const analyzer = createSpectrumAnalyzer({ onFrame: (frame) => frames.push(frame) });
  assert.throws(
    () => analyzer.push(new Float32Array(2), new Float32Array(1)),
    /equal lengths/,
  );
  assert.throws(() => analyzer.setGain(0), /gain must be between 0.25 and 4/);
  analyzer.push(sine(375, 0.8, FFT_SIZE - 1), sine(375, 0.8, FFT_SIZE - 1));
  analyzer.reset();
  analyzer.push(new Float32Array(FFT_SIZE), new Float32Array(FFT_SIZE));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].silent, true);
  assert.deepEqual(frames[0].left, Array(BAND_COUNT).fill(0));
});
