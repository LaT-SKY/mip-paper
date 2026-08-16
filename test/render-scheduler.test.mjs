import assert from 'node:assert/strict';
import test from 'node:test';

import { createScheduler, SCHEDULER_NAMES } from '../src/render-scheduler.mjs';

function createClock() {
  let time = 0;
  const rafQueue = [];
  const timers = new Map();
  let nextTimerId = 1;

  return {
    now: () => time,
    setTime(value) { time = value; },
    requestAnimationFrame(callback) { rafQueue.push(callback); return rafQueue.length; },
    runRaf(value) {
      time = value;
      const callback = rafQueue.shift();
      assert.ok(callback, 'expected a queued animation frame');
      callback(value);
    },
    setTimeout(callback, delay) {
      const id = nextTimerId++;
      timers.set(id, { callback, due: time + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    runTimer(value) {
      time = value;
      const entry = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
      assert.ok(entry, 'expected a queued timer');
      timers.delete(entry[0]);
      entry[1].callback();
    },
    queuedRaf() { return rafQueue.length; },
    queuedTimers() { return timers.size; },
  };
}

function setup(name, mode = 'interactive') {
  const clock = createClock();
  const state = { mode, untouched: { value: 1 } };
  const config = { frameRate: { interactive: 60, drift: 30 } };
  const viewport = { width: 100, height: 100 };
  const advances = [];
  const draws = [];
  const reports = [];
  const scheduler = createScheduler(name, clock);
  scheduler.start({
    state,
    config,
    viewport,
    advance: (...args) => advances.push(args),
    draw: (...args) => draws.push(args),
    report: (event) => reports.push(event),
  });
  return { name, clock, state, scheduler, advances, draws, reports };
}

function runFrame(run, time) {
  if (run.name === 'timer') {
    run.clock.runTimer(time);
    return;
  }
  if (run.name === 'adaptive') run.clock.runTimer(time);
  run.clock.runRaf(time);
}

for (const name of SCHEDULER_NAMES) {
  test(`${name} advances with elapsed seconds without mutating motion state`, () => {
    const { clock, state, scheduler, advances } = setup(name);
    runFrame({ name, clock }, 0);
    runFrame({ name, clock }, 25);
    assert.equal(advances.length, 2);
    assert.equal(advances[1][1], 0.025);
    assert.deepEqual(state, { mode: 'interactive', untouched: { value: 1 } });
    scheduler.stop();
  });
}

test('interactive mode draws at 60 FPS', () => {
  const { clock, scheduler, draws } = setup('raf');
  for (const time of [0, 1000 / 60, 2000 / 60]) clock.runRaf(time);
  assert.equal(draws.length, 3);
  scheduler.stop();
});

test('adaptive drift mode draws at its configured 30 FPS deadline', () => {
  const { clock, scheduler, draws } = setup('adaptive', 'drift');
  const run = { name: 'adaptive', clock };
  for (const time of [0, 1000 / 30, 2000 / 30, 3000 / 30, 4000 / 30]) runFrame(run, time);
  assert.equal(draws.length, 5);
  scheduler.stop();
});

test('panelActive overrides drift cadence to interactive', () => {
  const clock = createClock();
  const draws = [];
  const reports = [];
  const scheduler = createScheduler('adaptive', clock);
  scheduler.start({
    state: { mode: 'drift' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    panelActive: () => true,
    advance() {},
    draw: (...args) => draws.push(args),
    report: (event) => reports.push(event),
  });
  const run = { name: 'adaptive', clock };
  for (const time of [0, 1000 / 60, 2000 / 60, 3000 / 60]) runFrame(run, time);
  assert.equal(draws.length, 4);
  assert.ok(reports.every((event) => event.targetFrameRate === 60));
  scheduler.stop();
});

test('inactive panel keeps the motion drift cadence', () => {
  const clock = createClock();
  const draws = [];
  const reports = [];
  const scheduler = createScheduler('adaptive', clock);
  scheduler.start({
    state: { mode: 'drift' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    panelActive: () => false,
    advance() {},
    draw: (...args) => draws.push(args),
    report: (event) => reports.push(event),
  });
  const run = { name: 'adaptive', clock };
  for (const time of [0, 1000 / 30, 2000 / 30, 3000 / 30]) runFrame(run, time);
  assert.equal(draws.length, 4);
  assert.ok(reports.every((event) => event.targetFrameRate === 30));
  scheduler.stop();
});

test('panelActive flips cadence mid-run without restarting', () => {
  const clock = createClock();
  let frames = 0;
  const draws = [];
  const scheduler = createScheduler('adaptive', clock);
  scheduler.start({
    state: { mode: 'drift' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    panelActive: () => frames >= 2,
    advance() { frames += 1; },
    draw: (...args) => draws.push(args),
  });
  const run = { name: 'adaptive', clock };
  for (const time of [0, 1000 / 30, 1000 / 30 + 1000 / 60, 1000 / 30 + 2 * 1000 / 60, 1000 / 30 + 3 * 1000 / 60]) {
    runFrame(run, time);
  }
  assert.equal(draws.length, 5);
  scheduler.stop();
});

test('adaptive adopts drift cadence when motion requests the lower rate', () => {
  const clock = createClock();
  const state = { mode: 'returning' };
  const draws = [];
  const reports = [];
  const scheduler = createScheduler('adaptive', clock);
  scheduler.start({
    state,
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance(nextState) { nextState.mode = 'drift'; },
    draw: (...args) => draws.push(args),
    report: (event) => reports.push(event),
  });

  for (const time of [0, 1000 / 30, 2000 / 30, 3000 / 30]) runFrame({ name: 'adaptive', clock }, time);

  assert.equal(draws.length, 4);
  assert.ok(reports.every((event) => event.targetFrameRate === 30));
  scheduler.stop();
});

test('raf honors the 30 FPS drift deadline', () => {
  const { clock, scheduler, draws } = setup('raf', 'drift');
  for (const time of [0, 1000 / 60, 2000 / 60, 3000 / 60]) clock.runRaf(time);
  assert.equal(draws.length, 2);
  scheduler.stop();
});

test('adaptive carries a late callback deadline while raf resets its fixed deadline', () => {
  const raf = setup('raf', 'drift');
  const adaptive = setup('adaptive', 'drift');
  for (const time of [0, 100, 110]) {
    runFrame(raf, time);
    runFrame(adaptive, time);
  }
  assert.equal(raf.draws.length, 2);
  assert.equal(adaptive.draws.length, 3);
  raf.scheduler.stop();
  adaptive.scheduler.stop();
});

test('timer routes frames through timers and never requests RAF', () => {
  const clock = createClock();
  let rafCalls = 0;
  const scheduler = createScheduler('timer', {
    ...clock,
    requestAnimationFrame() { rafCalls += 1; },
  });
  const config = { frameRate: { interactive: 60, drift: 30 } };
  scheduler.start({
    state: { mode: 'interactive' },
    config,
    viewport: {},
    advance() {},
    draw() {},
  });
  clock.runTimer(0);
  assert.equal(rafCalls, 0);
  assert.equal(clock.queuedTimers(), 1);
  scheduler.stop();
});

test('adaptive waits for its deadline before requesting one VSync frame', () => {
  const clock = createClock();
  const scheduler = createScheduler('adaptive', clock);
  const advances = [];
  const draws = [];
  scheduler.start({
    state: { mode: 'drift' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance: (...args) => advances.push(args),
    draw: (...args) => draws.push(args),
  });

  assert.equal(clock.queuedTimers(), 1);
  assert.equal(clock.queuedRaf(), 0);
  clock.runTimer(0);
  assert.equal(clock.queuedTimers(), 0);
  assert.equal(clock.queuedRaf(), 1);
  assert.equal(advances.length, 0);

  clock.runRaf(0);
  assert.equal(advances.length, 1);
  assert.equal(draws.length, 1);
  assert.equal(clock.queuedRaf(), 0);
  assert.equal(clock.queuedTimers(), 1);

  clock.runTimer(1000 / 30);
  assert.equal(clock.queuedRaf(), 1);
  clock.runRaf(1000 / 30);
  assert.equal(advances.length, 2);
  assert.equal(draws.length, 2);
  scheduler.stop();
});

test('raf routes frames through RAF while adaptive gates RAF with a timer', () => {
  const rafClock = createClock();
  const rafScheduler = createScheduler('raf', rafClock);
  rafScheduler.start({
    state: { mode: 'interactive' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance() {},
    draw() {},
  });
  assert.equal(rafClock.queuedRaf(), 1);
  assert.equal(rafClock.queuedTimers(), 0);
  rafScheduler.stop();

  const adaptiveClock = createClock();
  const adaptiveScheduler = createScheduler('adaptive', adaptiveClock);
  adaptiveScheduler.start({
    state: { mode: 'interactive' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance() {},
    draw() {},
  });
  assert.equal(adaptiveClock.queuedRaf(), 0);
  assert.equal(adaptiveClock.queuedTimers(), 1);
  adaptiveScheduler.stop();
});

test('stop makes queued RAF callbacks inert', () => {
  const run = setup('raf');
  run.scheduler.stop();
  run.clock.runRaf(0);
  assert.equal(run.advances.length, 0);
  assert.equal(run.draws.length, 0);
});

test('restarting invalidates queued callbacks from the previous run', () => {
  const first = setup('raf');
  const draws = [];
  first.scheduler.start({
    state: { mode: 'interactive' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance() {},
    draw() { draws.push('new'); },
  });
  first.clock.runRaf(0);
  first.scheduler.start({
    state: { mode: 'interactive' },
    config: { frameRate: { interactive: 60, drift: 30 } },
    viewport: {},
    advance() {},
    draw() { draws.push('restart'); },
  });
  first.clock.runRaf(16);
  first.clock.runRaf(16);
  assert.deepEqual(draws, ['restart']);
  first.scheduler.stop();
});

test('late callbacks report a missed deadline', () => {
  const { clock, scheduler, reports } = setup('adaptive');
  const run = { name: 'adaptive', clock };
  runFrame(run, 0);
  runFrame(run, 100);
  const missed = reports.find((event) => event.type === 'missed-deadline');
  assert.ok(missed);
  assert.equal(missed.targetFrameRate, 60);
  assert.ok(missed.latenessMs > 0);
  scheduler.stop();
});

test('unknown scheduler names are rejected', () => {
  assert.throws(() => createScheduler('unknown', createClock()), /Unknown scheduler/);
});

test('VSync schedulers do not require timer dependencies', () => {
  const dependencies = {
    now: () => 0,
    requestAnimationFrame() {},
  };
  assert.doesNotThrow(() => createScheduler('raf', dependencies));
  assert.throws(
    () => createScheduler('adaptive', { ...dependencies, setTimeout: undefined, clearTimeout: undefined }),
    /setTimeout/,
  );
  assert.throws(
    () => createScheduler('timer', { ...dependencies, setTimeout: undefined, clearTimeout: undefined }),
    /setTimeout and clearTimeout/,
  );
});

test('reports actual callback intervals for probe timing percentiles', () => {
  const { clock, scheduler, reports } = setup('adaptive');
  const run = { name: 'adaptive', clock };
  runFrame(run, 0);
  runFrame(run, 16.7);
  assert.ok(reports.some((event) => event.type === 'callback' && Math.abs(event.intervalMs - 16.7) < 0.01));
  scheduler.stop();
});
