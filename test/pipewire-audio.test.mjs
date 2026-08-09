import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import {
  PW_CAT_ARGS,
  PW_METADATA_ARGS,
  createMetadataLineDecoder,
  createPipeWireAudioCapture,
  parseDefaultSinkLine,
} from '../src/pipewire-audio.mjs';

function sinkLine(name) {
  return `update: id:0 key:'default.audio.sink' value:'${JSON.stringify({ name })}' type:'Spa:String:JSON'`;
}

test('uses fixed pw-cat arguments for sink capture', () => {
  assert.deepEqual(PW_CAT_ARGS, [
    '--record',
    '--raw',
    '--rate=48000',
    '--channels=2',
    '--format=f32',
    '--latency=50ms',
    '--target=auto',
    '--properties',
    '{"stream.capture.sink":true,"media.role":"Music","node.name":"animated-ocean-wallpaper-spectrum"}',
    '-',
  ]);
  assert.deepEqual(PW_METADATA_ARGS, ['-m', '-n', 'default']);
  assert.equal(Object.isFrozen(PW_CAT_ARGS), true);
  assert.equal(Object.isFrozen(PW_METADATA_ARGS), true);
});

test('parses only strict default audio sink JSON updates', () => {
  assert.equal(parseDefaultSinkLine(sinkLine('alsa_output.usb-test.stereo')), 'alsa_output.usb-test.stereo');
  for (const invalid of [
    "update: id:0 key:'default.audio.source' value:'{\"name\":\"mic\"}'",
    "update: id:0 key:'default.audio.sink' value:'not-json'",
    "update: id:0 key:'default.audio.sink' value:'{\"name\":\"bad name\"}'",
    "update: id:0 key:'default.audio.sink' value:'{\"name\":\"\"}'",
    "update: id:0 key:'default.audio.sink' value:'null'",
  ]) {
    assert.equal(parseDefaultSinkLine(invalid), null);
  }
});

test('reassembles metadata lines split across stdout chunks', () => {
  const names = [];
  const decoder = createMetadataLineDecoder((name) => names.push(name));
  const line = sinkLine('sink.one');
  decoder.push(line.slice(0, 37));
  decoder.push(`${line.slice(37)}\n${sinkLine('sink.two')}\n`);
  assert.deepEqual(names, ['sink.one', 'sink.two']);
});

test('drops overlong unfinished metadata lines and validates the listener', () => {
  const names = [];
  const decoder = createMetadataLineDecoder((name) => names.push(name));
  decoder.push('x'.repeat(4097));
  decoder.push(`\n${sinkLine('sink.after-overflow')}\n`);
  assert.deepEqual(names, ['sink.after-overflow']);
  assert.throws(() => createMetadataLineDecoder(), /onSink must be a function/);
});

class FakeClock {
  constructor() {
    this.now = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  setTimeout(callback, delay) {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.set(id, { callback, due: this.now + delay });
    return id;
  }

  clearTimeout(id) {
    this.timers.delete(id);
  }

  advance(duration) {
    const target = this.now + duration;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.due <= target)
        .sort((left, right) => left[1].due - right[1].due || left[0] - right[0])[0];
      if (!next) break;
      this.now = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.now = target;
  }

  nextDelay() {
    const due = Math.min(...[...this.timers.values()].map((timer) => timer.due));
    return Number.isFinite(due) ? due - this.now : null;
  }

  pendingCount() {
    return this.timers.size;
  }
}

class FakeChild extends EventEmitter {
  constructor({ autoClose = true } = {}) {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
    this.killedSignals = [];
    this.autoClose = autoClose;
    this.closed = false;
  }

  kill(signal) {
    this.killedSignals.push(signal);
    if (this.autoClose && !this.closed) this.close(null, signal);
    return true;
  }

  close(code = 0, signal = null) {
    if (this.closed) return;
    this.closed = true;
    this.emit('close', code, signal);
  }
}

function createCaptureFixture({ autoClose = true } = {}) {
  const clock = new FakeClock();
  const spawns = [];
  const pcm = [];
  const states = [];
  const spawn = (command, args, options) => {
    const child = new FakeChild({ autoClose });
    spawns.push({ command, args, options, child });
    return child;
  };
  const capture = createPipeWireAudioCapture({
    spawn,
    timers: clock,
    onPcm: (bytes) => pcm.push(bytes),
    onState: (state) => states.push(state),
    logger: { warn() {} },
  });
  return {
    capture,
    clock,
    spawns,
    pcm,
    states,
    captureChildren: () => spawns.filter((entry) => entry.command === 'pw-cat').map((entry) => entry.child),
    metadataChildren: () => spawns.filter((entry) => entry.command === 'pw-metadata').map((entry) => entry.child),
    latestCapture: () => spawns.filter((entry) => entry.command === 'pw-cat').at(-1).child,
    latestMetadata: () => spawns.filter((entry) => entry.command === 'pw-metadata').at(-1).child,
  };
}

function emitSink(child, name) {
  child.stdout.emit('data', `${sinkLine(name)}\n`);
}

test('spawns capture and metadata without a shell and forwards only pcm bytes', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  assert.deepEqual(fixture.spawns.map(({ command }) => command), ['pw-cat', 'pw-metadata']);
  assert.equal(fixture.spawns.every(({ options }) => options.shell === false), true);
  assert.equal(fixture.spawns.every(({ options }) => (
    JSON.stringify(options.stdio) === JSON.stringify(['ignore', 'pipe', 'pipe'])
  )), true);
  const bytes = Buffer.alloc(16, 1);
  fixture.latestCapture().stdout.emit('data', bytes);
  assert.deepEqual(fixture.pcm, [bytes]);
  assert.equal(fixture.states.at(-1), 'active');
});

test('debounces a changed default sink and ignores its initial and duplicate names', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  emitSink(fixture.latestMetadata(), 'sink.one');
  fixture.clock.advance(150);
  assert.equal(fixture.captureChildren().length, 1);
  emitSink(fixture.latestMetadata(), 'sink.one');
  fixture.clock.advance(150);
  assert.equal(fixture.captureChildren().length, 1);
  emitSink(fixture.latestMetadata(), 'sink.two');
  fixture.clock.advance(149);
  assert.equal(fixture.captureChildren().length, 1);
  fixture.clock.advance(1);
  assert.equal(fixture.captureChildren().length, 2);
  assert.equal(fixture.capture.diagnostics.currentSink, 'sink.two');
});

test('watchdog and exits use capped capture backoff', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  fixture.clock.advance(2000);
  assert.equal(fixture.states.at(-1), 'unavailable');
  assert.ok(fixture.captureChildren()[0].killedSignals.includes('SIGTERM'));
  assert.equal(fixture.clock.nextDelay(), 500);
  fixture.clock.advance(500);
  for (const expectedDelay of [1000, 2000, 5000, 5000]) {
    fixture.latestCapture().close(1, null);
    assert.equal(fixture.clock.nextDelay(), expectedDelay);
    fixture.clock.advance(expectedDelay);
  }
});

test('stable capture resets the failure backoff after thirty seconds', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  fixture.latestCapture().close(1, null);
  fixture.clock.advance(500);
  for (let elapsed = 0; elapsed < 30_000; elapsed += 1500) {
    fixture.latestCapture().stdout.emit('data', Buffer.alloc(8));
    fixture.clock.advance(1500);
  }
  fixture.latestCapture().close(1, null);
  assert.equal(fixture.clock.nextDelay(), 500);
});

test('old child events cannot restart a replaced generation', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  const first = fixture.latestCapture();
  emitSink(fixture.latestMetadata(), 'sink.one');
  emitSink(fixture.latestMetadata(), 'sink.two');
  fixture.clock.advance(150);
  const spawnCount = fixture.captureChildren().length;
  first.emit('error', new Error('late error'));
  first.emit('close', 1, null);
  fixture.clock.advance(500);
  assert.equal(fixture.captureChildren().length, spawnCount);
});

test('one hundred sink replacements retain one live capture with bounded listeners', () => {
  const fixture = createCaptureFixture();
  fixture.capture.start();
  for (let index = 0; index < 100; index += 1) {
    emitSink(fixture.latestMetadata(), `sink.${index}`);
    fixture.clock.advance(150);
  }
  assert.equal(fixture.captureChildren().filter((child) => !child.closed).length, 1);
  assert.equal(fixture.metadataChildren().filter((child) => !child.closed).length, 1);
  assert.equal(fixture.latestCapture().stdout.listenerCount('data'), 1);
  assert.equal(fixture.latestCapture().listenerCount('close'), 1);
  assert.equal(fixture.latestMetadata().stdout.listenerCount('data'), 1);
});

test('stop terminates both children and forced kill closes stubborn children', async () => {
  const normal = createCaptureFixture();
  normal.capture.start();
  await normal.capture.stop();
  assert.equal(normal.clock.pendingCount(), 0);
  assert.equal(normal.spawns.every(({ child }) => child.killedSignals[0] === 'SIGTERM'), true);

  const stubborn = createCaptureFixture({ autoClose: false });
  stubborn.capture.start();
  const stopping = stubborn.capture.stop();
  assert.equal(stubborn.spawns.every(({ child }) => child.killedSignals[0] === 'SIGTERM'), true);
  stubborn.clock.advance(1000);
  assert.equal(stubborn.spawns.every(({ child }) => child.killedSignals.at(-1) === 'SIGKILL'), true);
  await stopping;
  assert.equal(stubborn.clock.pendingCount(), 0);
});
