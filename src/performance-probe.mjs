const MAX_SAMPLES = 2048;
const DEFAULT_INTERVAL_SECONDS = 5;
const SUMMARY_FIELDS = new Set([
  'strategy', 'displayId', 'mode', 'scenario', 'targetFrameRate', 'elapsedSeconds',
  'callback', 'draw', 'work', 'drawCount', 'missedDeadlineCount', 'longFrameCount',
]);

function finiteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and non-negative`);
}

function percentile(values, rank) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank) - 1));
  return sorted[index];
}

function distribution(values) {
  return { p50: percentile(values, 0.5), p95: percentile(values, 0.95), p99: percentile(values, 0.99) };
}

export function validateProbeSummary(summary) {
  if (summary === null || typeof summary !== 'object' || Array.isArray(summary)) {
    throw new TypeError('probe summary must be an object');
  }
  for (const key of Object.keys(summary)) {
    if (!SUMMARY_FIELDS.has(key)) throw new TypeError(`Unknown probe summary field: ${key}`);
  }
  for (const key of ['displayId', 'targetFrameRate', 'elapsedSeconds', 'drawCount', 'missedDeadlineCount', 'longFrameCount']) {
    if (summary[key] === undefined) throw new TypeError(`Missing probe summary field: ${key}`);
  }
  finiteNonNegative(summary.targetFrameRate, 'targetFrameRate');
  finiteNonNegative(summary.elapsedSeconds, 'elapsedSeconds');
  for (const key of ['drawCount', 'missedDeadlineCount', 'longFrameCount']) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) throw new RangeError(`${key} must be a non-negative integer`);
  }
  return summary;
}

export function createProbeCollector({ clock = () => performance.now() / 1000, intervalSeconds = DEFAULT_INTERVAL_SECONDS, maxSamples = MAX_SAMPLES } = {}) {
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  finiteNonNegative(intervalSeconds, 'intervalSeconds');
  if (intervalSeconds <= 0) throw new RangeError('intervalSeconds must be greater than 0');
  if (!Number.isInteger(maxSamples) || maxSamples <= 0 || maxSamples > MAX_SAMPLES) {
    throw new RangeError(`maxSamples must be an integer between 1 and ${MAX_SAMPLES}`);
  }
  let startedAt = null;
  let lastFlush = null;
  let strategy = null;
  let displayId = null;
  let mode = null;
  let scenario = null;
  let targetFrameRate = 0;
  let elapsedSeconds = 0;
  let drawCount = 0;
  let missedDeadlineCount = 0;
  let longFrameCount = 0;
  const callbacks = [];
  const draws = [];
  const work = [];

  function addSample(bucket, value, name) {
    finiteNonNegative(value, name);
    if (bucket.length < maxSamples) bucket.push(value);
  }

  function configure(value) {
    if (!value || typeof value !== 'object') throw new TypeError('probe configuration must be an object');
    ({ strategy, displayId, mode, scenario, targetFrameRate } = value);
    if (typeof strategy !== 'string' || !strategy) throw new TypeError('strategy must be a non-empty string');
    finiteNonNegative(targetFrameRate, 'targetFrameRate');
    startedAt = clock();
    lastFlush = startedAt;
  }

  function recordCallback(durationMs) { addSample(callbacks, durationMs, 'callback duration'); }
  function recordDraw(durationMs) { addSample(draws, durationMs, 'draw duration'); drawCount += 1; }
  function recordWork(durationMs, long = false) {
    addSample(work, durationMs, 'work duration');
    if (long) longFrameCount += 1;
  }
  function recordScenario(name) { scenario = name; }
  function recordMissedDeadline() { missedDeadlineCount += 1; }

  function flush(force = false) {
    if (startedAt === null) throw new Error('probe collector is not configured');
    const now = clock();
    finiteNonNegative(now, 'clock');
    if (!force && now - lastFlush < intervalSeconds) return null;
    elapsedSeconds = Math.max(0, now - startedAt);
    const summary = validateProbeSummary({
      strategy, displayId, mode, scenario, targetFrameRate, elapsedSeconds,
      callback: distribution(callbacks), draw: distribution(draws), work: distribution(work),
      drawCount, missedDeadlineCount, longFrameCount,
    });
    lastFlush = now;
    return structuredClone(summary);
  }

  return {
    configure, recordCallback, recordDraw, recordWork, recordScenario, recordMissedDeadline, flush,
  };
}

export function createProbeSummary(input) {
  return validateProbeSummary(structuredClone(input));
}
