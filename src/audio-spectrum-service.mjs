import { createSpectrumAnalyzer } from './audio-analyzer.mjs';
import { createPcmFrameDecoder } from './audio-pcm.mjs';
import { createPipeWireAudioCapture } from './pipewire-audio.mjs';

const BAND_COUNT = 72;
const PUBLISH_INTERVAL_MS = 34;
const STATUSES = new Set(['active', 'silent', 'unavailable']);

function zeros() {
  return Array(BAND_COUNT).fill(0);
}

function clamp(value) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function sanitizeBands(values) {
  if (!values || values.length !== BAND_COUNT) return zeros();
  return Array.from(values, clamp);
}

function validateAudioConfig(config) {
  if (!config || typeof config !== 'object') throw new TypeError('audio config is required');
  if (typeof config.enabled !== 'boolean') throw new TypeError('audio.enabled must be a boolean');
  if (!Number.isFinite(config.gain) || config.gain < 0.25 || config.gain > 4) {
    throw new RangeError('audio.gain must be between 0.25 and 4');
  }
  return { ...config };
}

function cloneSnapshot(snapshot) {
  return {
    status: snapshot.status,
    sequence: snapshot.sequence,
    timestampMs: snapshot.timestampMs,
    left: [...snapshot.left],
    right: [...snapshot.right],
    rms: snapshot.rms,
  };
}

export function createAudioSpectrumService({
  config,
  createCapture = createPipeWireAudioCapture,
  createAnalyzer = createSpectrumAnalyzer,
  now = () => performance.now(),
  timers = globalThis,
} = {}) {
  let audioConfig = validateAudioConfig(config);
  let started = false;
  let captureRunning = false;
  let lifecycle = Promise.resolve();
  let publishTimer = null;
  let pendingAnalysis = null;
  let snapshot = {
    status: 'unavailable',
    sequence: 0,
    timestampMs: Math.max(0, now()),
    left: zeros(),
    right: zeros(),
    rms: 0,
  };
  const listeners = new Set();

  function publish(next) {
    const candidateTimestamp = now();
    const timestampMs = Math.max(
      snapshot.timestampMs,
      Number.isFinite(candidateTimestamp) ? candidateTimestamp : snapshot.timestampMs,
    );
    snapshot = {
      status: STATUSES.has(next.status) ? next.status : 'unavailable',
      sequence: snapshot.sequence + 1,
      timestampMs,
      left: sanitizeBands(next.left),
      right: sanitizeBands(next.right),
      rms: clamp(next.rms),
    };
    for (const listener of listeners) listener(cloneSnapshot(snapshot));
  }

  function cancelPendingPublish() {
    if (publishTimer !== null) timers.clearTimeout(publishTimer);
    publishTimer = null;
    pendingAnalysis = null;
  }

  function publishUnavailable() {
    cancelPendingPublish();
    publish({ status: 'unavailable', left: zeros(), right: zeros(), rms: 0 });
  }

  function onAnalysis(frame) {
    if (!started || !audioConfig.enabled) return;
    pendingAnalysis = {
      status: frame.silent ? 'silent' : 'active',
      left: frame.left,
      right: frame.right,
      rms: frame.rms,
    };
    if (publishTimer !== null) return;
    publishTimer = timers.setTimeout(() => {
      publishTimer = null;
      const next = pendingAnalysis;
      pendingAnalysis = null;
      if (next && started && audioConfig.enabled) publish(next);
    }, PUBLISH_INTERVAL_MS);
  }

  const analyzer = createAnalyzer({ gain: audioConfig.gain, onFrame: onAnalysis });
  const decoder = createPcmFrameDecoder((left, right) => analyzer.push(left, right));
  const capture = createCapture({
    onPcm(bytes) {
      if (started && audioConfig.enabled) decoder.push(bytes);
    },
    onState(nextState) {
      if (started && audioConfig.enabled && nextState === 'unavailable') publishUnavailable();
    },
  });

  function enqueue(operation) {
    lifecycle = lifecycle.then(operation, operation);
    return lifecycle;
  }

  async function disableCapture() {
    if (captureRunning) {
      await capture.stop();
      captureRunning = false;
    }
    cancelPendingPublish();
    decoder.reset();
    analyzer.reset();
    publishUnavailable();
  }

  return {
    start() {
      return enqueue(async () => {
        if (started) return;
        started = true;
        if (audioConfig.enabled) {
          capture.start();
          captureRunning = true;
        }
      });
    },
    stop() {
      return enqueue(async () => {
        if (!started && !captureRunning) return;
        started = false;
        if (captureRunning) {
          await capture.stop();
          captureRunning = false;
        }
        cancelPendingPublish();
        decoder.reset();
        analyzer.reset();
      });
    },
    updateConfig(nextConfig) {
      const validated = validateAudioConfig(nextConfig);
      return enqueue(async () => {
        const wasEnabled = audioConfig.enabled;
        const gainChanged = validated.gain !== audioConfig.gain;
        audioConfig = validated;
        if (gainChanged) analyzer.setGain(audioConfig.gain);
        if (!started) return;
        if (wasEnabled && !audioConfig.enabled) {
          await disableCapture();
        } else if (!wasEnabled && audioConfig.enabled) {
          capture.start();
          captureRunning = true;
        }
      });
    },
    getSnapshot() {
      return cloneSnapshot(snapshot);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      let subscribed = true;
      return () => {
        if (!subscribed) return;
        subscribed = false;
        listeners.delete(listener);
      };
    },
  };
}
