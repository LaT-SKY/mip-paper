import assert from 'node:assert/strict';
import test from 'node:test';

import { createProbeCollector, createProbeSummary } from '../src/performance-probe.mjs';

function clockFixture() {
  let time = 0;
  return { now: () => time, set(value) { time = value; } };
}

test('aggregates bounded timing samples and percentiles', () => {
  const clock = clockFixture();
  const collector = createProbeCollector({ clock: clock.now, intervalSeconds: 5 });
  collector.configure({ strategy: 'raf', displayId: 1, mode: 'interactive', scenario: 'sweep', targetFrameRate: 60 });
  collector.recordCallback(1);
  collector.recordCallback(2);
  collector.recordCallback(4);
  collector.recordDraw(3);
  collector.recordWork(5, true);
  collector.recordMissedDeadline();
  clock.set(5);
  assert.deepEqual(collector.flush(), {
    strategy: 'raf', displayId: 1, mode: 'interactive', scenario: 'sweep', targetFrameRate: 60,
    elapsedSeconds: 5, callback: { p50: 2, p95: 4, p99: 4 },
    draw: { p50: 3, p95: 3, p99: 3 }, work: { p50: 5, p95: 5, p99: 5 },
    drawCount: 1, missedDeadlineCount: 1, longFrameCount: 1,
  });
});

test('does not flush before the reporting interval unless forced', () => {
  const clock = clockFixture();
  const collector = createProbeCollector({ clock: clock.now });
  collector.configure({ strategy: 'timer', displayId: 2, mode: 'drift', scenario: 'idle', targetFrameRate: 30 });
  clock.set(4.99);
  assert.equal(collector.flush(), null);
  assert.equal(collector.flush(true).elapsedSeconds, 4.99);
});

test('rejects invalid summaries and collector samples', () => {
  assert.throws(() => createProbeSummary({ unknown: 1 }), /Unknown probe summary field/);
  const collector = createProbeCollector({ clock: () => 0 });
  collector.configure({ strategy: 'raf', displayId: 1, mode: 'drift', scenario: 'idle', targetFrameRate: 30 });
  assert.throws(() => collector.recordDraw(Number.NaN), /finite and non-negative/);
  assert.throws(() => createProbeCollector({ maxSamples: 2049 }), /between 1 and 2048/);
});

test('updates mode and target frame rate for each summary', () => {
  const clock = clockFixture();
  const collector = createProbeCollector({ clock: clock.now });
  collector.configure({ strategy: 'adaptive', displayId: 1, mode: 'drift', scenario: 'sweep', targetFrameRate: 30 });
  collector.updateContext({ mode: 'interactive', targetFrameRate: 60 });
  clock.set(5);
  const summary = collector.flush();
  assert.equal(summary.mode, 'interactive');
  assert.equal(summary.targetFrameRate, 60);
});
