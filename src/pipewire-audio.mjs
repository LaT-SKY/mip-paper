import { spawn as nodeSpawn } from 'node:child_process';

export const PW_CAT_ARGS = Object.freeze([
  '--record',
  '--raw',
  '--rate=48000',
  '--channels=2',
  '--format=f32',
  '--latency=50ms',
  '--target=auto',
  '--properties',
  '{"stream.capture.sink":true,"media.class":"Stream/Input/Audio/Internal","media.role":"Music","node.name":"mip-paper-spectrum"}',
  '-',
]);

export const PW_METADATA_ARGS = Object.freeze(['-m', '-n', 'default']);

const MAX_METADATA_LINE = 4096;
const SAFE_NODE_NAME = /^[A-Za-z0-9_.:-]{1,256}$/;

export function parseDefaultSinkLine(line) {
  if (typeof line !== 'string') return null;
  const match = line.match(/\bkey:'default\.audio\.sink'\s+value:'([^']*)'/);
  if (!match) return null;
  try {
    const value = JSON.parse(match[1]);
    return value && typeof value.name === 'string' && SAFE_NODE_NAME.test(value.name)
      ? value.name
      : null;
  } catch {
    return null;
  }
}

export function createMetadataLineDecoder(onSink) {
  if (typeof onSink !== 'function') throw new TypeError('onSink must be a function');
  let buffer = '';
  let discarding = false;

  return {
    push(chunk) {
      const text = String(chunk);
      let offset = 0;
      while (offset < text.length) {
        const newline = text.indexOf('\n', offset);
        const segmentEnd = newline < 0 ? text.length : newline;
        const segment = text.slice(offset, segmentEnd);
        if (!discarding) {
          buffer += segment;
          if (buffer.length > MAX_METADATA_LINE) {
            buffer = '';
            discarding = true;
          }
        }
        if (newline < 0) break;
        if (!discarding) {
          const sink = parseDefaultSinkLine(buffer.replace(/\r$/, ''));
          if (sink) onSink(sink);
        }
        buffer = '';
        discarding = false;
        offset = newline + 1;
      }
    },
    reset() {
      buffer = '';
      discarding = false;
    },
  };
}

const CHILD_OPTIONS = Object.freeze({
  shell: false,
  stdio: Object.freeze(['ignore', 'pipe', 'pipe']),
});
const WATCHDOG_MS = 2000;
const STABLE_MS = 30_000;
const SINK_DEBOUNCE_MS = 150;
const FORCE_KILL_MS = 1000;

function restartDelay(failures) {
  return [500, 1000, 2000, 5000][Math.min(Math.max(failures - 1, 0), 3)];
}

export function createPipeWireAudioCapture({
  onPcm,
  onState,
  spawn = nodeSpawn,
  timers = globalThis,
  logger = console,
} = {}) {
  if (typeof onPcm !== 'function') throw new TypeError('onPcm must be a function');
  if (typeof onState !== 'function') throw new TypeError('onState must be a function');
  if (typeof spawn !== 'function') throw new TypeError('spawn must be a function');

  let running = false;
  let state = null;
  let capture = null;
  let metadata = null;
  let captureGeneration = 0;
  let metadataGeneration = 0;
  let captureFailures = 0;
  let metadataFailures = 0;
  let captureRestartTimer = null;
  let metadataRestartTimer = null;
  let watchdogTimer = null;
  let captureStableTimer = null;
  let metadataStableTimer = null;
  let sinkDebounceTimer = null;
  let currentSink = null;
  let pendingSink = null;
  let lastStderr = '';
  const liveRecords = new Set();

  const clear = (name) => {
    const timer = {
      captureRestartTimer,
      metadataRestartTimer,
      watchdogTimer,
      captureStableTimer,
      metadataStableTimer,
      sinkDebounceTimer,
    }[name];
    if (timer !== null) timers.clearTimeout(timer);
    if (name === 'captureRestartTimer') captureRestartTimer = null;
    if (name === 'metadataRestartTimer') metadataRestartTimer = null;
    if (name === 'watchdogTimer') watchdogTimer = null;
    if (name === 'captureStableTimer') captureStableTimer = null;
    if (name === 'metadataStableTimer') metadataStableTimer = null;
    if (name === 'sinkDebounceTimer') sinkDebounceTimer = null;
  };

  function publishState(nextState) {
    if (state === nextState) return;
    state = nextState;
    onState(nextState);
  }

  function finishRecord(record) {
    if (record.finished) return;
    record.finished = true;
    if (record.killTimer !== null) timers.clearTimeout(record.killTimer);
    record.killTimer = null;
    liveRecords.delete(record);
    const callbacks = record.finishedCallbacks.splice(0);
    for (const callback of callbacks) callback();
  }

  function terminateRecord(record, onFinished = null) {
    if (!record || record.finished) {
      onFinished?.();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      record.finishedCallbacks.push(() => {
        onFinished?.();
        resolve();
      });
      if (record.retired) return;
      record.retired = true;
      record.child.kill('SIGTERM');
      if (record.finished || record.closed) {
        finishRecord(record);
        return;
      }
      record.killTimer = timers.setTimeout(() => {
        record.killTimer = null;
        record.child.kill('SIGKILL');
        record.closed = true;
        finishRecord(record);
      }, FORCE_KILL_MS);
    });
  }

  function rememberStderr(record, chunk) {
    record.stderr = `${record.stderr}${String(chunk)}`.slice(-1024);
    lastStderr = record.stderr;
  }

  function scheduleCaptureRestart() {
    if (!running || captureRestartTimer !== null) return;
    const delay = restartDelay(captureFailures);
    captureRestartTimer = timers.setTimeout(() => {
      captureRestartTimer = null;
      spawnCapture();
    }, delay);
  }

  function failCapture(record, detail) {
    if (!running || capture !== record || record.retired) return;
    capture = null;
    clear('watchdogTimer');
    clear('captureStableTimer');
    captureFailures += 1;
    publishState('unavailable');
    logger.warn?.(`PipeWire capture unavailable${detail == null ? '' : ` (${detail})`}`);
    void terminateRecord(record, scheduleCaptureRestart);
  }

  function resetWatchdog(record) {
    clear('watchdogTimer');
    watchdogTimer = timers.setTimeout(() => {
      watchdogTimer = null;
      failCapture(record, 'stalled');
    }, WATCHDOG_MS);
  }

  function attachCapture(child) {
    const record = {
      child,
      generation: ++captureGeneration,
      retired: false,
      closed: false,
      finished: false,
      killTimer: null,
      finishedCallbacks: [],
      stderr: '',
    };
    capture = record;
    liveRecords.add(record);
    child.stdout.on('data', (chunk) => {
      if (!running || capture !== record || record.retired || chunk.length === 0) return;
      resetWatchdog(record);
      publishState('active');
      onPcm(chunk);
    });
    child.stderr.on('data', (chunk) => rememberStderr(record, chunk));
    child.on('error', (error) => failCapture(record, error?.code || 'error'));
    child.on('close', (code, signal) => {
      if (record.finished) return;
      record.closed = true;
      if (record.retired) {
        finishRecord(record);
        return;
      }
      if (capture !== record) {
        finishRecord(record);
        return;
      }
      capture = null;
      clear('watchdogTimer');
      clear('captureStableTimer');
      finishRecord(record);
      if (running) {
        captureFailures += 1;
        publishState('unavailable');
        logger.warn?.(`PipeWire capture exited (${code ?? signal ?? 'unknown'})`);
        scheduleCaptureRestart();
      }
    });
    resetWatchdog(record);
    clear('captureStableTimer');
    captureStableTimer = timers.setTimeout(() => {
      captureStableTimer = null;
      if (running && capture === record && !record.retired) captureFailures = 0;
    }, STABLE_MS);
  }

  function spawnCapture() {
    if (!running || capture) return;
    try {
      attachCapture(spawn('pw-cat', PW_CAT_ARGS, CHILD_OPTIONS));
    } catch (error) {
      captureFailures += 1;
      publishState('unavailable');
      logger.warn?.(`PipeWire capture unavailable (${error?.code || 'spawn'})`);
      scheduleCaptureRestart();
    }
  }

  function replaceCapture() {
    if (!running) return;
    const record = capture;
    capture = null;
    clear('watchdogTimer');
    clear('captureStableTimer');
    if (!record) {
      spawnCapture();
      return;
    }
    void terminateRecord(record, () => {
      if (running && !capture) spawnCapture();
    });
  }

  function scheduleMetadataRestart() {
    if (!running || metadataRestartTimer !== null) return;
    const delay = restartDelay(metadataFailures);
    metadataRestartTimer = timers.setTimeout(() => {
      metadataRestartTimer = null;
      spawnMetadata();
    }, delay);
  }

  function failMetadata(record, detail) {
    if (!running || metadata !== record || record.retired) return;
    metadata = null;
    clear('metadataStableTimer');
    metadataFailures += 1;
    logger.warn?.(`PipeWire metadata unavailable${detail == null ? '' : ` (${detail})`}`);
    void terminateRecord(record, scheduleMetadataRestart);
  }

  function handleSink(name) {
    if (currentSink === null) {
      currentSink = name;
      return;
    }
    if (name === currentSink) return;
    pendingSink = name;
    clear('sinkDebounceTimer');
    sinkDebounceTimer = timers.setTimeout(() => {
      sinkDebounceTimer = null;
      if (!running || pendingSink === currentSink) return;
      currentSink = pendingSink;
      replaceCapture();
    }, SINK_DEBOUNCE_MS);
  }

  function attachMetadata(child) {
    const decoder = createMetadataLineDecoder(handleSink);
    const record = {
      child,
      generation: ++metadataGeneration,
      retired: false,
      closed: false,
      finished: false,
      killTimer: null,
      finishedCallbacks: [],
      stderr: '',
    };
    metadata = record;
    liveRecords.add(record);
    child.stdout.on('data', (chunk) => {
      if (running && metadata === record && !record.retired) decoder.push(chunk);
    });
    child.stderr.on('data', (chunk) => rememberStderr(record, chunk));
    child.on('error', (error) => failMetadata(record, error?.code || 'error'));
    child.on('close', (code, signal) => {
      if (record.finished) return;
      record.closed = true;
      if (record.retired) {
        finishRecord(record);
        return;
      }
      if (metadata !== record) {
        finishRecord(record);
        return;
      }
      metadata = null;
      clear('metadataStableTimer');
      finishRecord(record);
      if (running) {
        metadataFailures += 1;
        logger.warn?.(`PipeWire metadata exited (${code ?? signal ?? 'unknown'})`);
        scheduleMetadataRestart();
      }
    });
    clear('metadataStableTimer');
    metadataStableTimer = timers.setTimeout(() => {
      metadataStableTimer = null;
      if (running && metadata === record && !record.retired) metadataFailures = 0;
    }, STABLE_MS);
  }

  function spawnMetadata() {
    if (!running || metadata) return;
    try {
      attachMetadata(spawn('pw-metadata', PW_METADATA_ARGS, CHILD_OPTIONS));
    } catch (error) {
      metadataFailures += 1;
      logger.warn?.(`PipeWire metadata unavailable (${error?.code || 'spawn'})`);
      scheduleMetadataRestart();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      spawnCapture();
      spawnMetadata();
    },
    async stop() {
      if (!running && liveRecords.size === 0) return;
      running = false;
      for (const timerName of [
        'captureRestartTimer',
        'metadataRestartTimer',
        'watchdogTimer',
        'captureStableTimer',
        'metadataStableTimer',
        'sinkDebounceTimer',
      ]) clear(timerName);
      capture = null;
      metadata = null;
      await Promise.all([...liveRecords].map((record) => terminateRecord(record)));
    },
    get diagnostics() {
      return Object.freeze({
        currentSink,
        captureFailures,
        metadataFailures,
        lastStderr,
      });
    },
  };
}
