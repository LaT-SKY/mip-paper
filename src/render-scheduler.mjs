import { requestedFrameRate } from './motion.mjs';

export const SCHEDULER_NAMES = Object.freeze(['raf', 'timer', 'adaptive']);

function defaultDependencies() {
  const root = typeof window === 'undefined' ? globalThis : window;
  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    requestAnimationFrame: root.requestAnimationFrame?.bind(root),
    cancelAnimationFrame: root.cancelAnimationFrame?.bind(root),
    setTimeout: root.setTimeout?.bind(root),
    clearTimeout: root.clearTimeout?.bind(root),
  };
}

export function createScheduler(name, dependencies = {}) {
  if (!SCHEDULER_NAMES.includes(name)) {
    throw new RangeError(`Unknown scheduler: ${name}`);
  }

  const timing = { ...defaultDependencies(), ...dependencies };
  if (typeof timing.now !== 'function') throw new TypeError('now must be a function');
  if (name !== 'timer' && typeof timing.requestAnimationFrame !== 'function') {
    throw new TypeError('requestAnimationFrame must be a function');
  }
  if (name === 'adaptive'
    && (typeof timing.setTimeout !== 'function' || typeof timing.clearTimeout !== 'function')) {
    throw new TypeError('setTimeout and clearTimeout must be functions for adaptive scheduling');
  }
  if (name === 'timer'
    && (typeof timing.setTimeout !== 'function' || typeof timing.clearTimeout !== 'function')) {
    throw new TypeError('setTimeout and clearTimeout must be functions');
  }

  let running = false;
  let timerId = null;
  let animationFrameId = null;
  let options = null;
  let previousTime = null;
  let drawAccumulatorMs = 0;
  let firstFrame = true;
  let previousIntervalMs = null;
  let nextDeadlineMs = null;
  let generation = 0;

  function schedule(runGeneration = generation) {
    if (!running) return;
    if (name === 'timer') {
      const rate = requestedFrameRate(options.state, options.config);
      timerId = timing.setTimeout(() => {
        if (!running || runGeneration !== generation) return;
        timerId = null;
        handleFrame(timing.now());
      }, 1000 / rate);
      return;
    }
    if (name === 'adaptive') {
      const now = timing.now();
      if (nextDeadlineMs === null) nextDeadlineMs = now;
      timerId = timing.setTimeout(() => {
        if (!running || runGeneration !== generation) return;
        timerId = null;
        animationFrameId = timing.requestAnimationFrame((time) => {
          if (!running || runGeneration !== generation) return;
          animationFrameId = null;
          handleFrame(time);
        });
      }, Math.max(0, nextDeadlineMs - now));
      return;
    }
    timing.requestAnimationFrame((time) => {
      if (!running || runGeneration !== generation) return;
      handleFrame(time);
    });
  }

  function handleFrame(time) {
    if (!running) return;
    const frameTime = Number.isFinite(time) ? time : timing.now();
    const hadPreviousTime = previousTime !== null;
    const elapsedMs = previousTime === null ? 0 : Math.max(0, frameTime - previousTime);
    previousTime = frameTime;

    options.advance(options.state, elapsedMs / 1000, frameTime / 1000, options.config, options.viewport);

    const rate = requestedFrameRate(options.state, options.config);
    const intervalMs = 1000 / rate;
    if (previousIntervalMs !== intervalMs) {
      drawAccumulatorMs = 0;
      firstFrame = true;
      nextDeadlineMs = null;
      previousIntervalMs = intervalMs;
    }

    if (hadPreviousTime) {
      options.report?.({
        type: 'callback',
        intervalMs: elapsedMs,
        targetFrameRate: rate,
        timestamp: frameTime,
      });
    }

    const deadlineToleranceMs = Math.max(1, intervalMs * 0.05);
    if (hadPreviousTime && elapsedMs > intervalMs + deadlineToleranceMs) {
      options.report?.({
        type: 'missed-deadline',
        latenessMs: elapsedMs - intervalMs,
        targetFrameRate: rate,
        timestamp: frameTime,
      });
    }

    let shouldDraw = firstFrame;
    firstFrame = false;
    if (name === 'raf') {
      if (nextDeadlineMs === null) nextDeadlineMs = frameTime + intervalMs;
      if (!shouldDraw && frameTime + 1e-6 >= nextDeadlineMs) {
        shouldDraw = true;
        nextDeadlineMs = frameTime + intervalMs;
      }
    } else if (name === 'adaptive') {
      shouldDraw = true;
    } else if (!shouldDraw) {
      drawAccumulatorMs += elapsedMs;
      if (drawAccumulatorMs + 1e-6 >= intervalMs) {
        shouldDraw = true;
        drawAccumulatorMs -= intervalMs;
        if (drawAccumulatorMs < 0) drawAccumulatorMs = 0;
      }
    }
    if (shouldDraw) options.draw(options.state, options.viewport, frameTime / 1000);
    if (name === 'adaptive') {
      if (nextDeadlineMs === null || nextDeadlineMs <= frameTime + deadlineToleranceMs) {
        nextDeadlineMs = frameTime + intervalMs;
      } else {
        nextDeadlineMs += intervalMs;
        while (nextDeadlineMs <= frameTime + deadlineToleranceMs) {
          nextDeadlineMs += intervalMs;
        }
      }
    }
    schedule();
  }

  return {
    start(startOptions) {
      if (!startOptions || typeof startOptions !== 'object') {
        throw new TypeError('start options are required');
      }
      if (typeof startOptions.advance !== 'function' || typeof startOptions.draw !== 'function') {
        throw new TypeError('advance and draw must be functions');
      }
      options = startOptions;
      if (running) {
        running = false;
        if (timerId !== null) {
          timing.clearTimeout(timerId);
          timerId = null;
        }
        if (animationFrameId !== null && typeof timing.cancelAnimationFrame === 'function') {
          timing.cancelAnimationFrame(animationFrameId);
          animationFrameId = null;
        }
      }
      generation += 1;
      running = true;
      previousTime = null;
      drawAccumulatorMs = 0;
      firstFrame = true;
      previousIntervalMs = null;
      nextDeadlineMs = null;
      schedule(generation);
    },
    stop() {
      running = false;
      generation += 1;
      if (timerId !== null) {
        timing.clearTimeout(timerId);
        timerId = null;
      }
      if (animationFrameId !== null && typeof timing.cancelAnimationFrame === 'function') {
        timing.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    },
    handleFrame,
  };
}
