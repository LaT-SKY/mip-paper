import { requestedFrameRate } from './motion.mjs';

export const SCHEDULER_NAMES = Object.freeze(['raf', 'timer', 'adaptive']);

function defaultDependencies() {
  const root = typeof window === 'undefined' ? globalThis : window;
  return {
    now: () => (typeof performance === 'undefined' ? Date.now() : performance.now()),
    requestAnimationFrame: root.requestAnimationFrame?.bind(root),
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
  if (typeof timing.setTimeout !== 'function' || typeof timing.clearTimeout !== 'function') {
    throw new TypeError('setTimeout and clearTimeout must be functions');
  }

  let running = false;
  let timerId = null;
  let options = null;
  let previousTime = null;
  let drawAccumulatorMs = 0;
  let firstFrame = true;
  let previousIntervalMs = null;

  function schedule() {
    if (!running) return;
    if (name === 'timer') {
      const rate = requestedFrameRate(options.state, options.config);
      timerId = timing.setTimeout(() => {
        timerId = null;
        handleFrame(timing.now());
      }, 1000 / rate);
      return;
    }
    timing.requestAnimationFrame(handleFrame);
  }

  function handleFrame(time) {
    if (!running) return;
    const frameTime = Number.isFinite(time) ? time : timing.now();
    const hadPreviousTime = previousTime !== null;
    const elapsedMs = previousTime === null ? 0 : Math.max(0, frameTime - previousTime);
    previousTime = frameTime;

    const rate = requestedFrameRate(options.state, options.config);
    const intervalMs = 1000 / rate;
    if (previousIntervalMs !== intervalMs) {
      drawAccumulatorMs = 0;
      firstFrame = true;
      previousIntervalMs = intervalMs;
    }

    options.advance(options.state, elapsedMs / 1000, frameTime / 1000, options.config, options.viewport);

    if (hadPreviousTime && elapsedMs > intervalMs + 1e-6) {
      options.report?.({
        type: 'missed-deadline',
        latenessMs: elapsedMs - intervalMs,
        targetFrameRate: rate,
        timestamp: frameTime,
      });
    }

    let shouldDraw = firstFrame;
    firstFrame = false;
    if (!shouldDraw) {
      drawAccumulatorMs += elapsedMs;
      if (drawAccumulatorMs + 1e-6 >= intervalMs) {
        shouldDraw = true;
        drawAccumulatorMs -= intervalMs;
        if (drawAccumulatorMs < 0) drawAccumulatorMs = 0;
      }
    }
    if (shouldDraw) options.draw(options.state, options.viewport, frameTime / 1000);
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
      running = true;
      previousTime = null;
      drawAccumulatorMs = 0;
      firstFrame = true;
      previousIntervalMs = null;
      schedule();
    },
    stop() {
      running = false;
      if (timerId !== null) {
        timing.clearTimeout(timerId);
        timerId = null;
      }
    },
    handleFrame,
  };
}
