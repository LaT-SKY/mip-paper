import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_CONFIG = Object.freeze({
  interactionEnabled: true,
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
    if (rule === 'frameRate' && (!Number.isFinite(fieldValue) || fieldValue < 30)) {
      throw new RangeError(`${fieldPath} must be at least 30`);
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
  validateShape(value, SCHEMA);
  const result = mergeConfig(value);
  const { mode, latitude, longitude } = result.weather.location;
  if (mode === 'fixed' && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new TypeError('weather.location fixed mode requires both latitude and longitude');
  }
  return result;
}

export function weatherCredentialsPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'animated-ocean-wallpaper', 'weather-credentials.json');
}

export function informationCachePath(env = process.env, homedir) {
  const base = env.XDG_CACHE_HOME || path.join(homedir, '.cache');
  return path.join(base, 'animated-ocean-wallpaper', 'information.json');
}

export function configPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'animated-ocean-wallpaper', 'config.json');
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
