import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import { createAudioSpectrumService } from '../src/audio-spectrum-service.mjs';

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { callback, due: this.time + delay });
    return id;
  }

  clearTimeout(id) { this.timers.delete(id); }

  advance(duration) {
    this.time += duration;
    for (const [id, timer] of [...this.timers]) {
      if (timer.due <= this.time) {
        this.timers.delete(id);
        timer.callback();
      }
    }
  }

  pendingCount() { return this.timers.size; }
}

function pcm(frames) {
  const bytes = Buffer.alloc(frames.length * 8);
  frames.forEach(([left, right], index) => {
    bytes.writeFloatLE(left, index * 8);
    bytes.writeFloatLE(right, index * 8 + 4);
  });
  return bytes;
}

function createServiceFixture(overrides = {}) {
  const clock = new FakeClock();
  const capture = {
    startCalls: 0,
    stopCalls: 0,
    callbacks: null,
    start() { this.startCalls += 1; },
    async stop() { this.stopCalls += 1; },
    emitPcm(bytes) { this.callbacks.onPcm(bytes); },
    emitState(state) { this.callbacks.onState(state); },
  };
  const analyzer = {
    gain: null,
    pushes: [],
    resets: 0,
    callback: null,
    push(left, right) { this.pushes.push([left, right]); },
    setGain(value) { this.gain = value; },
    reset() { this.resets += 1; },
    emit(frame) { this.callback(frame); },
  };
  const config = { ...DEFAULT_CONFIG.audio, ...overrides };
  const service = createAudioSpectrumService({
    config,
    createCapture(callbacks) {
      capture.callbacks = callbacks;
      return capture;
    },
    createAnalyzer(options) {
      analyzer.gain = options.gain;
      analyzer.callback = options.onFrame;
      return analyzer;
    },
    now: () => clock.time,
    timers: clock,
  });
  return { service, capture, analyzer, config, clock };
}

function analysis(left = 0.2, right = 0.4, rms = 0.3, silent = false) {
  return {
    left: Array(72).fill(left),
    right: Array(72).fill(right),
    rms,
    silent,
  };
}

test('publishes the latest sanitized snapshot at no more than thirty hertz', async () => {
  const fixture = createServiceFixture();
  const received = [];
  fixture.service.subscribe((snapshot) => received.push(snapshot));
  await fixture.service.start();
  fixture.analyzer.emit(analysis(0.2, 0.4, 0.3));
  fixture.analyzer.emit(analysis(0.3, 0.5, 0.4));
  assert.equal(received.length, 0);
  fixture.clock.advance(34);
  assert.equal(received.length, 1);
  assert.deepEqual(Object.keys(received[0]), [
    'status', 'sequence', 'timestampMs', 'left', 'right', 'rms',
  ]);
  assert.equal(received[0].status, 'active');
  assert.equal(received[0].left.length, 72);
  assert.equal(received[0].left[0], 0.3);
  assert.equal(received[0].right[0], 0.5);
  assert.equal(received[0].timestampMs, 34);
});

test('decodes capture bytes before sending stereo samples to the analyzer', async () => {
  const fixture = createServiceFixture();
  await fixture.service.start();
  const bytes = pcm([[0.25, -0.5], [0.75, -1]]);
  fixture.capture.emitPcm(bytes.subarray(0, 9));
  fixture.capture.emitPcm(bytes.subarray(9));
  assert.deepEqual(fixture.analyzer.pushes.flatMap(([left]) => [...left]), [0.25, 0.75]);
  assert.deepEqual(fixture.analyzer.pushes.flatMap(([, right]) => [...right]), [-0.5, -1]);
});

test('starts no capture while disabled and serializes enabled and gain changes', async () => {
  const fixture = createServiceFixture({ enabled: false });
  await fixture.service.start();
  assert.equal(fixture.capture.startCalls, 0);
  await fixture.service.updateConfig({ ...fixture.config, enabled: true, gain: 2 });
  assert.equal(fixture.capture.startCalls, 1);
  assert.equal(fixture.analyzer.gain, 2);
  await fixture.service.updateConfig({ ...fixture.config, enabled: false, gain: 2 });
  assert.equal(fixture.capture.stopCalls, 1);
  assert.equal(fixture.analyzer.resets, 1);
});

test('maps silence and capture failure without exposing raw diagnostics', async () => {
  const fixture = createServiceFixture();
  const received = [];
  fixture.service.subscribe((snapshot) => received.push(snapshot));
  await fixture.service.start();
  fixture.analyzer.emit(analysis(0, 0, 0, true));
  fixture.clock.advance(34);
  assert.equal(received.at(-1).status, 'silent');
  fixture.capture.emitState('unavailable');
  const snapshot = received.at(-1);
  assert.equal(snapshot.status, 'unavailable');
  assert.deepEqual(snapshot.left, Array(72).fill(0));
  assert.doesNotMatch(JSON.stringify(snapshot), /pcm|device|stderr/i);
});

test('clamps invalid analysis values and increments sequence monotonically', async () => {
  const fixture = createServiceFixture();
  const received = [];
  fixture.service.subscribe((snapshot) => received.push(snapshot));
  await fixture.service.start();
  fixture.analyzer.emit({
    left: [Number.NaN, -1, 2, ...Array(69).fill(0.25)],
    right: Array(71).fill(1),
    rms: Number.POSITIVE_INFINITY,
    silent: false,
  });
  fixture.clock.advance(34);
  assert.deepEqual(received[0].left.slice(0, 3), [0, 0, 1]);
  assert.deepEqual(received[0].right, Array(72).fill(0));
  assert.equal(received[0].rms, 0);
  fixture.capture.emitState('unavailable');
  assert.ok(received[1].sequence > received[0].sequence);
  assert.ok(received[1].timestampMs >= received[0].timestampMs);
});

test('returns defensive snapshots and idempotent unsubscribe and stop operations', async () => {
  const fixture = createServiceFixture();
  let calls = 0;
  const unsubscribe = fixture.service.subscribe(() => { calls += 1; });
  await fixture.service.start();
  const first = fixture.service.getSnapshot();
  first.left[0] = 1;
  assert.equal(fixture.service.getSnapshot().left[0], 0);
  unsubscribe();
  unsubscribe();
  fixture.capture.emitState('unavailable');
  assert.equal(calls, 0);
  await fixture.service.stop();
  await fixture.service.stop();
  assert.equal(fixture.capture.stopCalls, 1);
  assert.equal(fixture.clock.pendingCount(), 0);
});
