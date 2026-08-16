import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  COMMAND_ICON_OPTIONS,
  SETTINGS_GROUPS,
  getPath,
  setPath,
} from '../src/settings-fields.mjs';

const CONFIG_LEAF_KEYS = [
  'interactionEnabled',
  'wallpaper.mode',
  'color.mode',
  'color.transitionDurationMs',
  'appearance.mode',
  'appearance.dark.wallpaperBrightness',
  'audio.enabled',
  'audio.gain',
  'audio.silenceDelayMs',
  'audio.fadeOutMs',
  'audio.fadeInMs',
  'frameRate.interactive',
  'frameRate.drift',
  'motion.interactionSpeed',
  'motion.returnSpeed',
  'motion.driftSpeed',
  'motion.deadZonePx',
  'motion.horizontalPanPercent',
  'motion.verticalPanPercent',
  'motion.maxRotationDegrees',
  'motion.pauseWhenFullscreen',
  'panel.autoExpandHide',
  'panel.expandTriggerDistancePx',
  'panel.collapseDelaySeconds',
  'panel.expanded',
  'panel.collapsedOpacity',
  'panel.animation.staggerDelayMs',
  'panel.animation.durationMs',
  'weather.location.mode',
  'weather.location.latitude',
  'weather.location.longitude',
  'weather.location.fallbackLocationId',
  'weather.tideStationId',
  'menu.avoidObstacles',
  'menu.closeOnFocusChange',
  'menu.autoCloseMs',
  'menu.customCommands',
];

const FIELD_KEYS = SETTINGS_GROUPS
  .filter((group) => !group.external && !group.static)
  .flatMap((group) => group.fields.map((field) => field.key));

test('settings field schema covers every config leaf exactly once', () => {
  assert.deepEqual([...FIELD_KEYS].sort(), [...CONFIG_LEAF_KEYS].sort());
  assert.equal(new Set(FIELD_KEYS).size, FIELD_KEYS.length);
});

test('every config leaf has a readable default via the schema path helpers', () => {
  for (const key of CONFIG_LEAF_KEYS) {
    assert.notEqual(getPath(DEFAULT_CONFIG, key), undefined, `DEFAULT_CONFIG is missing ${key}`);
  }
});

test('number field ranges mirror config.mjs validation', () => {
  const byKey = new Map(FIELD_KEYS.map((key) => [key, SETTINGS_GROUPS
    .flatMap((group) => group.fields)
    .find((field) => field.key === key)]));

  assert.deepEqual(
    { min: byKey.get('frameRate.interactive').min, max: byKey.get('frameRate.interactive').max },
    { min: 1, max: 180 },
  );
  assert.equal(byKey.get('color.transitionDurationMs').max, 5000);
  assert.deepEqual(
    { min: byKey.get('appearance.dark.wallpaperBrightness').min, max: byKey.get('appearance.dark.wallpaperBrightness').max },
    { min: 0.2, max: 1 },
  );
  assert.equal(byKey.get('panel.collapsedOpacity').max, 1);
  assert.equal(byKey.get('panel.animation.durationMs').min, 400);
  assert.deepEqual(
    { min: byKey.get('audio.gain').min, max: byKey.get('audio.gain').max },
    { min: 0.25, max: 4 },
  );
  for (const key of ['audio.silenceDelayMs', 'audio.fadeOutMs', 'audio.fadeInMs']) {
    assert.equal(byKey.get(key).max, key === 'audio.silenceDelayMs' ? 5000 : 3000);
  }
});

test('enum options match config.mjs allowed values', () => {
  const optionsFor = (key) => SETTINGS_GROUPS
    .flatMap((group) => group.fields)
    .find((field) => field.key === key).options.map((option) => option.value);

  assert.deepEqual(optionsFor('wallpaper.mode'), ['kde', 'manual']);
  assert.deepEqual(optionsFor('color.mode'), ['default', 'kde', 'wallpaper', 'hybrid']);
  assert.deepEqual(optionsFor('appearance.mode'), ['light', 'dark', 'system']);
  assert.deepEqual(optionsFor('weather.location.mode'), ['auto', 'fixed']);
  const commandModeOptions = SETTINGS_GROUPS
    .find((group) => group.id === 'menu').fields
    .find((field) => field.type === 'commands').fields
    .find((field) => field.key === 'mode').options.map((option) => option.value);
  assert.deepEqual(commandModeOptions, ['background', 'terminal']);
});

test('custom command icon options cover the built-in icon set', () => {
  for (const name of ['folder', 'terminal', 'update', 'app', 'info', 'settings', 'refresh', 'panel', 'pause', 'play']) {
    assert.ok(COMMAND_ICON_OPTIONS.includes(name), `missing icon option: ${name}`);
  }
});

test('external and static groups carry no config keys', () => {
  const credentials = SETTINGS_GROUPS.find((group) => group.id === 'credentials');
  const about = SETTINGS_GROUPS.find((group) => group.id === 'about');
  assert.equal(credentials.external, true);
  assert.equal(about.static, true);
  for (const field of credentials.fields) {
    assert.equal(FIELD_KEYS.includes(field.key), false);
  }
});

test('path helpers read and write nested config values', () => {
  const target = structuredClone(DEFAULT_CONFIG);
  setPath(target, 'panel.animation.durationMs', 1200);
  assert.equal(getPath(target, 'panel.animation.durationMs'), 1200);
  assert.equal(getPath(target, 'wallpaper.mode'), 'kde');
  setPath(target, 'weather.location.latitude', 31.23);
  assert.equal(getPath(target, 'weather.location.latitude'), 31.23);
  assert.equal(getPath({}, 'missing.deep.value'), undefined);
});
