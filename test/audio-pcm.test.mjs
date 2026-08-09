import assert from 'node:assert/strict';
import test from 'node:test';

import { createPcmFrameDecoder } from '../src/audio-pcm.mjs';

function pcm(frames) {
  const bytes = Buffer.alloc(frames.length * 8);
  frames.forEach(([left, right], index) => {
    bytes.writeFloatLE(left, index * 8);
    bytes.writeFloatLE(right, index * 8 + 4);
  });
  return bytes;
}

test('reassembles every byte split and preserves stereo order', () => {
  const source = pcm([[0.25, -0.5], [0.75, -1]]);
  for (let split = 1; split < source.length; split += 1) {
    const output = [];
    const decoder = createPcmFrameDecoder((left, right) => output.push([left, right]));
    decoder.push(source.subarray(0, split));
    decoder.push(source.subarray(split));
    assert.deepEqual(output.flatMap(([left]) => [...left]), [0.25, 0.75]);
    assert.deepEqual(output.flatMap(([, right]) => [...right]), [-0.5, -1]);
  }
});

test('drops non-finite frames and reports their count', () => {
  const output = [];
  const decoder = createPcmFrameDecoder((left, right) => output.push([left, right]));
  decoder.push(pcm([
    [Number.NaN, 1],
    [1, Number.POSITIVE_INFINITY],
    [0.5, 0.25],
  ]));
  assert.equal(decoder.invalidFrames, 2);
  assert.deepEqual([...output[0][0]], [0.5]);
  assert.deepEqual([...output[0][1]], [0.25]);
});

test('reset discards retained tail without resetting diagnostics', () => {
  const output = [];
  const decoder = createPcmFrameDecoder((left, right) => output.push([left, right]));
  decoder.push(pcm([[Number.NaN, 1], [0.5, 0.25]]).subarray(0, 13));
  decoder.reset();
  decoder.push(pcm([[1, -1]]));
  assert.deepEqual([...output.at(-1)[0]], [1]);
  assert.deepEqual([...output.at(-1)[1]], [-1]);
  assert.equal(decoder.invalidFrames, 1);
});

test('accepts Uint8Array chunks and rejects a missing callback', () => {
  const output = [];
  const decoder = createPcmFrameDecoder((left, right) => output.push([left, right]));
  decoder.push(new Uint8Array(pcm([[0.125, -0.125]])));
  assert.deepEqual([...output[0][0]], [0.125]);
  assert.throws(() => createPcmFrameDecoder(), /onFrames must be a function/);
});
