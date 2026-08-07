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
  };
}

export function validateConfig(value) {
  validateShape(value, SCHEMA);
  return mergeConfig(value);
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
