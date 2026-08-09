import FFT from 'fft.js';

export const SAMPLE_RATE = 48_000;
export const FFT_SIZE = 2048;
export const HOP_SIZE = 1024;
export const BAND_COUNT = 72;
export const MIN_FREQUENCY = 30;
export const MAX_FREQUENCY = 18_000;

const NOISE_GATE_DB = -72;
const DISPLAY_CEILING_DB = -18;
const ATTACK = 0.68;
const RELEASE = 0.16;
const SILENCE_RMS = 0.001;
const LOG_FREQUENCY_SPAN = Math.log(MAX_FREQUENCY / MIN_FREQUENCY);

const HANN_WINDOW = Float64Array.from({ length: FFT_SIZE }, (_, index) => (
  0.5 * (1 - Math.cos(2 * Math.PI * index / (FFT_SIZE - 1)))
));
const WINDOW_AMPLITUDE_SCALE = 2 / HANN_WINDOW.reduce((sum, value) => sum + value, 0);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function bandIndexForFrequency(frequency) {
  if (!Number.isFinite(frequency) || frequency < MIN_FREQUENCY || frequency > MAX_FREQUENCY) {
    return -1;
  }
  const position = Math.log(frequency / MIN_FREQUENCY) / LOG_FREQUENCY_SPAN;
  return Math.min(Math.floor(position * BAND_COUNT), BAND_COUNT - 1);
}

export function aggregateLogBands(binValues) {
  if (!binValues || binValues.length !== FFT_SIZE / 2 + 1) {
    throw new TypeError('bin values must contain finite FFT magnitudes');
  }
  for (const value of binValues) {
    if (!Number.isFinite(value)) {
      throw new TypeError('bin values must contain finite FFT magnitudes');
    }
  }

  const binWidth = SAMPLE_RATE / FFT_SIZE;
  return Array.from({ length: BAND_COUNT }, (_, band) => {
    const low = MIN_FREQUENCY * Math.exp(LOG_FREQUENCY_SPAN * band / BAND_COUNT);
    const high = MIN_FREQUENCY * Math.exp(LOG_FREQUENCY_SPAN * (band + 1) / BAND_COUNT);
    const firstBin = Math.max(1, Math.ceil(low / binWidth));
    const lastBin = Math.min(FFT_SIZE / 2, Math.ceil(high / binWidth) - 1);
    if (firstBin <= lastBin) {
      let maximum = 0;
      for (let bin = firstBin; bin <= lastBin; bin += 1) {
        maximum = Math.max(maximum, binValues[bin]);
      }
      return maximum;
    }

    const position = Math.sqrt(low * high) / binWidth;
    const lower = Math.max(1, Math.min(Math.floor(position), FFT_SIZE / 2));
    const upper = Math.max(1, Math.min(Math.ceil(position), FFT_SIZE / 2));
    if (lower === upper) return binValues[lower];
    const fraction = position - lower;
    return binValues[lower] + (binValues[upper] - binValues[lower]) * fraction;
  });
}

function spatiallySmooth(values) {
  return values.map((value, index) => {
    const previous = values[Math.max(0, index - 1)];
    const next = values[Math.min(values.length - 1, index + 1)];
    return previous * 0.25 + value * 0.5 + next * 0.25;
  });
}

function applyTemporalSmoothing(previous, target) {
  for (let index = 0; index < target.length; index += 1) {
    const coefficient = target[index] > previous[index] ? ATTACK : RELEASE;
    previous[index] += (target[index] - previous[index]) * coefficient;
  }
  return [...previous];
}

function validateGain(value) {
  if (!Number.isFinite(value) || value < 0.25 || value > 4) {
    throw new RangeError('gain must be between 0.25 and 4');
  }
  return value;
}

export function createSpectrumAnalyzer({ gain = 1, onFrame } = {}) {
  if (typeof onFrame !== 'function') throw new TypeError('onFrame must be a function');
  let currentGain = validateGain(gain);
  let pendingLeft = [];
  let pendingRight = [];
  const previousLeft = new Float64Array(BAND_COUNT);
  const previousRight = new Float64Array(BAND_COUNT);
  const fft = new FFT(FFT_SIZE);

  function analyzeChannel(samples, previous) {
    const input = new Float64Array(FFT_SIZE);
    for (let index = 0; index < FFT_SIZE; index += 1) {
      input[index] = samples[index] * HANN_WINDOW[index];
    }
    const spectrum = fft.createComplexArray();
    fft.realTransform(spectrum, input);
    const binValues = Array(FFT_SIZE / 2 + 1).fill(0);
    for (let bin = 1; bin <= FFT_SIZE / 2; bin += 1) {
      const real = spectrum[bin * 2];
      const imaginary = spectrum[bin * 2 + 1];
      const magnitude = Math.hypot(real, imaginary) * WINDOW_AMPLITUDE_SCALE * currentGain;
      const decibels = 20 * Math.log10(Math.max(magnitude, 1e-12));
      const normalized = decibels <= NOISE_GATE_DB
        ? 0
        : clamp((decibels - NOISE_GATE_DB) / (DISPLAY_CEILING_DB - NOISE_GATE_DB));
      binValues[bin] = normalized;
    }
    const bands = aggregateLogBands(binValues);
    return applyTemporalSmoothing(previous, spatiallySmooth(bands));
  }

  function analyzeWindow() {
    const leftWindow = pendingLeft.slice(0, FFT_SIZE);
    const rightWindow = pendingRight.slice(0, FFT_SIZE);
    let sumSquares = 0;
    for (let index = 0; index < FFT_SIZE; index += 1) {
      sumSquares += leftWindow[index] ** 2 + rightWindow[index] ** 2;
    }
    const rawRms = Math.sqrt(sumSquares / (2 * FFT_SIZE));
    onFrame({
      left: analyzeChannel(leftWindow, previousLeft),
      right: analyzeChannel(rightWindow, previousRight),
      rms: clamp(rawRms * currentGain),
      silent: rawRms < SILENCE_RMS,
    });
    pendingLeft = pendingLeft.slice(HOP_SIZE);
    pendingRight = pendingRight.slice(HOP_SIZE);
  }

  return {
    push(left, right) {
      if (!left || !right || left.length !== right.length) {
        throw new TypeError('left and right channels must have equal lengths');
      }
      pendingLeft.push(...left);
      pendingRight.push(...right);
      while (pendingLeft.length >= FFT_SIZE) analyzeWindow();
    },
    setGain(value) {
      currentGain = validateGain(value);
    },
    reset() {
      pendingLeft = [];
      pendingRight = [];
      previousLeft.fill(0);
      previousRight.fill(0);
    },
  };
}
