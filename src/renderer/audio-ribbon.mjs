const BAND_COUNT = 72;
const VIEWBOX_WIDTH = 1000;
const FADE_INTERPOLATION_MS = 70;
const STATUSES = new Set(['active', 'silent', 'unavailable']);

function clamp(value) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
}

function validateAudioConfig(config) {
  if (!config || typeof config !== 'object'
    || typeof config.enabled !== 'boolean'
    || !Number.isFinite(config.gain) || config.gain < 0.25 || config.gain > 4
    || !Number.isFinite(config.silenceDelayMs) || config.silenceDelayMs < 0 || config.silenceDelayMs > 5000
    || !Number.isFinite(config.fadeOutMs) || config.fadeOutMs < 0 || config.fadeOutMs > 3000
    || !Number.isFinite(config.fadeInMs) || config.fadeInMs < 0 || config.fadeInMs > 3000) {
    throw new TypeError('invalid audio config');
  }
  return { ...config };
}

function validBands(values) {
  return Array.isArray(values) && values.length === BAND_COUNT
    && values.every((value) => Number.isFinite(value));
}

export function createAudioRibbonState(config) {
  const audioConfig = validateAudioConfig(config);
  return {
    config: audioConfig,
    left: Array(BAND_COUNT).fill(0),
    right: Array(BAND_COUNT).fill(0),
    targetLeft: Array(BAND_COUNT).fill(0),
    targetRight: Array(BAND_COUNT).fill(0),
    rms: 0,
    targetRms: 0,
    sequence: -1,
    status: 'unavailable',
    silenceSinceMs: null,
    opacity: 0,
  };
}

export function applySpectrumSnapshot(state, snapshot, receivedAtMs) {
  if (!snapshot || !STATUSES.has(snapshot.status)
    || !Number.isInteger(snapshot.sequence) || snapshot.sequence < 0
    || !Number.isFinite(snapshot.timestampMs)
    || !validBands(snapshot.left) || !validBands(snapshot.right)
    || !Number.isFinite(snapshot.rms)) return false;
  if (snapshot.sequence <= state.sequence) return false;

  const wasSilent = state.status === 'silent';
  state.sequence = snapshot.sequence;
  state.status = snapshot.status;
  state.targetLeft = snapshot.left.map(clamp);
  state.targetRight = snapshot.right.map(clamp);
  state.targetRms = clamp(snapshot.rms);
  if (snapshot.status === 'silent') {
    if (!wasSilent || state.silenceSinceMs === null) state.silenceSinceMs = receivedAtMs;
  } else {
    state.silenceSinceMs = null;
  }
  if (snapshot.status === 'unavailable') {
    state.targetLeft.fill(0);
    state.targetRight.fill(0);
    state.targetRms = 0;
  }
  return true;
}

export function applyAudioConfig(state, config) {
  state.config = validateAudioConfig(config);
  if (!state.config.enabled) {
    state.status = 'unavailable';
    state.silenceSinceMs = null;
    state.targetLeft.fill(0);
    state.targetRight.fill(0);
    state.targetRms = 0;
  }
}

function approach(current, target, elapsedMs, durationMs) {
  if (durationMs === 0) return target;
  const step = Math.min(1, Math.max(0, elapsedMs) / durationMs);
  return current + (target - current) * step;
}

export function advanceAudioRibbon(state, elapsedMs, nowMs) {
  const blend = elapsedMs <= 0 ? 0 : 1 - Math.exp(-elapsedMs / FADE_INTERPOLATION_MS);
  for (let index = 0; index < BAND_COUNT; index += 1) {
    state.left[index] += (state.targetLeft[index] - state.left[index]) * blend;
    state.right[index] += (state.targetRight[index] - state.right[index]) * blend;
  }
  state.rms += (state.targetRms - state.rms) * blend;

  let visible = state.status === 'active';
  if (state.status === 'silent') {
    visible = state.silenceSinceMs === null
      || nowMs < state.silenceSinceMs + state.config.silenceDelayMs;
  }
  const targetOpacity = visible ? 1 : 0;
  const duration = targetOpacity > state.opacity ? state.config.fadeInMs : state.config.fadeOutMs;
  state.opacity = approach(state.opacity, targetOpacity, elapsedMs, duration);
  return state;
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

export function buildRibbonPoints(values, {
  baseline,
  amplitude,
  direction,
} = {}) {
  if (!Array.isArray(values) || values.length !== BAND_COUNT) {
    throw new TypeError('ribbon values must contain 72 bands');
  }
  const center = Number.isFinite(baseline) ? baseline : 70;
  const height = Number.isFinite(amplitude) ? amplitude : 20;
  const sign = direction === -1 ? -1 : 1;
  return values.map((rawValue, index) => {
    const t = index / (BAND_COUNT - 1);
    const edgeDistance = Math.min(t / 0.14, (1 - t) / 0.14);
    const taper = smoothstep(Math.max(0, Math.min(1, edgeDistance)));
    const value = clamp(rawValue) * taper;
    const y = index < 2 || index >= BAND_COUNT - 2
      ? center
      : center + sign * height * value;
    return { x: (VIEWBOX_WIDTH * index) / (BAND_COUNT - 1), y };
  });
}

function rounded(value) {
  return Number(value.toFixed(3));
}

export function pointsToSmoothPath(points) {
  if (!Array.isArray(points) || points.length < 2) {
    throw new TypeError('at least two ribbon points are required');
  }
  const start = points[0];
  let path = `M ${rounded(start.x)} ${rounded(start.y)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    path += ` C ${rounded(c1.x)} ${rounded(c1.y)}, ${rounded(c2.x)} ${rounded(c2.y)}, ${rounded(p2.x)} ${rounded(p2.y)}`;
  }
  return path;
}

export function buildEnergyPoints(rms) {
  return buildRibbonPoints(Array(BAND_COUNT).fill(clamp(rms)), {
    baseline: 70,
    amplitude: 6,
    direction: -1,
  });
}
