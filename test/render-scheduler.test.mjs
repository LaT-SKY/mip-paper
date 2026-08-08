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
  return { clock, state, scheduler, advances, draws, reports };
}

for (const name of SCHEDULER_NAMES) {
  test(`${name} advances with elapsed seconds without mutating motion state`, () => {
    const { clock, state, scheduler, advances } = setup(name);
    if (name === 'timer') {
      clock.runTimer(0);
      clock.runTimer(25);
    } else {
      clock.runRaf(0);
      clock.runRaf(25);
    }
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

test('adaptive drift mode skips alternate VSync callbacks at 30 FPS', () => {
  const { clock, scheduler, draws } = setup('adaptive', 'drift');
  for (const time of [0, 1000 / 60, 2000 / 60, 3000 / 60, 4000 / 60]) clock.runRaf(time);
  assert.equal(draws.length, 3);
  scheduler.stop();
});

test('raf draws every VSync callback, including drift mode', () => {
  const { clock, scheduler, draws } = setup('raf', 'drift');
  for (const time of [0, 1000 / 60, 2000 / 60, 3000 / 60]) clock.runRaf(time);
  assert.equal(draws.length, 4);
  scheduler.stop();
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
  clock.runRaf(0);
  clock.runRaf(100);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].type, 'missed-deadline');
  assert.equal(reports[0].targetFrameRate, 60);
  assert.ok(reports[0].latenessMs > 0);
  scheduler.stop();
});

test('unknown scheduler names are rejected', () => {
  assert.throws(() => createScheduler('unknown', createClock()), /Unknown scheduler/);
});
