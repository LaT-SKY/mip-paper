import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  interactionEnabled: true,
  wallpaper: Object.freeze({ mode: 'kde' }),
  color: Object.freeze({ mode: 'hybrid', transitionDurationMs: 900 }),
  appearance: Object.freeze({
    mode: 'system',
    dark: Object.freeze({ wallpaperBrightness: 0.72 }),
  }),
  audio: Object.freeze({
    enabled: true,
    gain: 1,
    silenceDelayMs: 600,
    fadeOutMs: 450,
    fadeInMs: 160,
  }),
  frameRate: Object.freeze({
    interactive: 60,
    drift: 30,
  }),
  motion: Object.freeze({
    interactionSpeed: 1.15,
    returnSpeed: 0.3,
    driftSpeed: 1,
    deadZonePx: 2,
    horizontalPanPercent: 4.6,
    verticalPanPercent: 4.5,
    maxRotationDegrees: 0.7,
  }),
  panel: Object.freeze({
    autoExpandHide: true,
    expandTriggerDistancePx: 48,
    collapseDelaySeconds: 8,
    expanded: true,
    collapsedOpacity: 0.08,
    animation: Object.freeze({ staggerDelayMs: 60, durationMs: 950 }),
  }),
  weather: Object.freeze({
    location: Object.freeze({
      mode: 'auto',
      latitude: null,
      longitude: null,
      fallbackLocationId: '101281601',
    }),
    tideStationId: 'P2352',
  }),
});

const SCHEMA = {
  interactionEnabled: 'boolean',
  wallpaper: { mode: 'wallpaperMode' },
  color: { mode: 'colorMode', transitionDurationMs: 'colorTransitionDuration' },
  appearance: {
    mode: 'themeMode',
    dark: { wallpaperBrightness: 'wallpaperBrightness' },
  },
  audio: {
    enabled: 'boolean',
    gain: 'positive',
    silenceDelayMs: 'nonNegative',
    fadeOutMs: 'nonNegative',
    fadeInMs: 'nonNegative',
  },
  frameRate: {
    interactive: 'frameRate',
    drift: 'frameRate',
  },
  motion: {
    interactionSpeed: 'positive',
    returnSpeed: 'positive',
    driftSpeed: 'positive',
    deadZonePx: 'nonNegative',
    horizontalPanPercent: 'nonNegative',
    verticalPanPercent: 'nonNegative',
    maxRotationDegrees: 'nonNegative',
  },
  panel: {
    autoExpandHide: 'boolean',
    expandTriggerDistancePx: 'nonNegative',
    collapseDelaySeconds: 'nonNegative',
    expanded: 'boolean',
    collapsedOpacity: 'opacity',
    animation: {
      staggerDelayMs: 'nonNegative',
      durationMs: 'animationDuration',
    },
  },
  weather: {
    location: {
      mode: 'locationMode',
      latitude: 'nullableLatitude',
      longitude: 'nullableLongitude',
      fallbackLocationId: 'nonEmptyString',
    },
    tideStationId: 'nonEmptyString',
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const AUDIO_KEYS = new Set([
  'enabled',
  'gain',
  'silenceDelayMs',
  'fadeOutMs',
  'fadeInMs',
]);

function normalizeAudioConfig(value) {
  if (!isObject(value)) return { ...DEFAULT_CONFIG.audio };
  for (const key of Object.keys(value)) {
    if (!AUDIO_KEYS.has(key)) {
      throw new TypeError(`Unknown configuration field: audio.${key}`);
    }
  }
  const validRange = (candidate, min, max, fallback) => (
    Number.isFinite(candidate) && candidate >= min && candidate <= max ? candidate : fallback
  );
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.audio.enabled,
    gain: validRange(value.gain, 0.25, 4, DEFAULT_CONFIG.audio.gain),
    silenceDelayMs: validRange(
      value.silenceDelayMs,
      0,
      5000,
      DEFAULT_CONFIG.audio.silenceDelayMs,
    ),
    fadeOutMs: validRange(value.fadeOutMs, 0, 3000, DEFAULT_CONFIG.audio.fadeOutMs),
    fadeInMs: validRange(value.fadeInMs, 0, 3000, DEFAULT_CONFIG.audio.fadeInMs),
  };
}

function validateShape(value, schema, prefix = '') {
  if (!isObject(value)) {
    throw new TypeError(`${prefix || 'configuration'} must be an object`);
  }

  for (const key of Object.keys(value)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in schema)) {
      throw new TypeError(`Unknown configuration field: ${fieldPath}`);
    }

    const rule = schema[key];
    const fieldValue = value[key];
    if (isObject(rule)) {
      validateShape(fieldValue, rule, fieldPath);
      continue;
    }

    if (rule === 'boolean' && typeof fieldValue !== 'boolean') {
      throw new TypeError(`${fieldPath} must be a boolean`);
    }
    if (rule === 'frameRate' && (!Number.isInteger(fieldValue)
      || fieldValue < 1 || fieldValue > 180)) {
      throw new RangeError(`${fieldPath} must be an integer between 1 and 180`);
    }
    if (rule === 'positive' && (!Number.isFinite(fieldValue) || fieldValue <= 0)) {
      throw new RangeError(`${fieldPath} must be a finite number greater than 0`);
    }
    if (rule === 'nonNegative' && (!Number.isFinite(fieldValue) || fieldValue < 0)) {
      throw new RangeError(`${fieldPath} must be a finite number at least 0`);
    }
    if (rule === 'opacity' && (!Number.isFinite(fieldValue) || fieldValue < 0 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be between 0 and 1`);
    }
    if (rule === 'animationDuration' && (!Number.isFinite(fieldValue) || fieldValue < 400)) {
      throw new RangeError(`${fieldPath} must be at least 400`);
    }
    if (rule === 'locationMode' && !['auto', 'fixed'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be auto or fixed`);
    }
    if (rule === 'wallpaperMode' && !['kde', 'manual'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be kde or manual`);
    }
    if (rule === 'colorMode' && !['default', 'kde', 'wallpaper', 'hybrid'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be default, kde, wallpaper, or hybrid`);
    }
    if (rule === 'colorTransitionDuration' && (!Number.isInteger(fieldValue)
      || fieldValue < 0 || fieldValue > 5000)) {
      throw new RangeError(`${fieldPath} must be an integer between 0 and 5000`);
    }
    if (rule === 'themeMode' && !['light', 'dark', 'system'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be light, dark, or system`);
    }
    if (rule === 'wallpaperBrightness' && (!Number.isFinite(fieldValue)
      || fieldValue < 0.2 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be a finite number between 0.2 and 1`);
    }
    if (rule === 'nullableLatitude' && fieldValue !== null
      && (!Number.isFinite(fieldValue) || fieldValue < -90 || fieldValue > 90)) {
      throw new RangeError(`${fieldPath} must be null or between -90 and 90`);
    }
    if (rule === 'nullableLongitude' && fieldValue !== null
      && (!Number.isFinite(fieldValue) || fieldValue < -180 || fieldValue > 180)) {
      throw new RangeError(`${fieldPath} must be null or between -180 and 180`);
    }
    if (rule === 'nonEmptyString' && (typeof fieldValue !== 'string' || fieldValue.trim() === '')) {
      throw new TypeError(`${fieldPath} must be a non-empty string`);
    }
  }
}

function mergeConfig(value) {
  return {
    interactionEnabled: value.interactionEnabled ?? DEFAULT_CONFIG.interactionEnabled,
    wallpaper: {
      ...DEFAULT_CONFIG.wallpaper,
      ...(value.wallpaper ?? {}),
    },
    color: {
      ...DEFAULT_CONFIG.color,
      ...(value.color ?? {}),
    },
    appearance: {
      ...DEFAULT_CONFIG.appearance,
      ...(value.appearance ?? {}),
      dark: {
        ...DEFAULT_CONFIG.appearance.dark,
        ...(value.appearance?.dark ?? {}),
      },
    },
    audio: {
      ...DEFAULT_CONFIG.audio,
      ...(value.audio ?? {}),
    },
    frameRate: {
      ...DEFAULT_CONFIG.frameRate,
      ...(value.frameRate ?? {}),
    },
    motion: {
      ...DEFAULT_CONFIG.motion,
      ...(value.motion ?? {}),
    },
    panel: {
      ...DEFAULT_CONFIG.panel,
      ...(value.panel ?? {}),
      animation: {
        ...DEFAULT_CONFIG.panel.animation,
        ...(value.panel?.animation ?? {}),
      },
    },
    weather: {
      ...DEFAULT_CONFIG.weather,
      ...(value.weather ?? {}),
      location: {
        ...DEFAULT_CONFIG.weather.location,
        ...(value.weather?.location ?? {}),
      },
    },
  };
}

export function validateConfig(value) {
  if (!isObject(value)) validateShape(value, SCHEMA);
  const normalized = { ...value, audio: normalizeAudioConfig(value.audio) };
  validateShape(normalized, SCHEMA);
  const result = mergeConfig(normalized);
  const { mode, latitude, longitude } = result.weather.location;
  if (mode === 'fixed' && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new TypeError('weather.location fixed mode requires both latitude and longitude');
  }
  return result;
}

export function weatherCredentialsPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'mip-paper', 'weather-credentials.json');
}

export function informationCachePath(env = process.env, homedir) {
  const base = env.XDG_CACHE_HOME || path.join(homedir, '.cache');
  return path.join(base, 'mip-paper', 'information.json');
}

export function configPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'mip-paper', 'config.json');
}

export async function loadConfig(pathname) {
  let value;
  try {
    value = JSON.parse(await readFile(pathname, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid JSON in ${pathname}: ${error.message}`);
    }
    throw error;
  }
  return validateConfig(value);
}
