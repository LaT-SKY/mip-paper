import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  SETTINGS_GROUPS,
  SETTINGS_ICONS,
  getPath,
  setPath,
} from '../src/settings-fields.mjs';

const CONFIG_LEAF_KEYS = [
  'mouse.buttonsEnabled',
  'mouse.interactionEnabled',
  'wallpaper.mode',
  'wallpaper.fit',
  'wallpaper.crossfadeMs',
  'wallpaper.perDisplay',
  'color.mode',
  'color.transitionDurationMs',
  'appearance.mode',
  'appearance.dark.wallpaperBrightness',
  'audio.enabled',
  'audio.gain',
  'audio.style',
  'audio.colorMode',
  'audio.colors.primary',
  'audio.colors.complement',
  'audio.colors.neutral',
  'audio.sensitivity',
  'audio.height',
  'audio.position',
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
  'panel.layout',
  'panel.cards',
  'panel.customCard.title',
  'panel.customCard.text',
  'panel.customCard.timeFormat',
  'panel.customCard.dateFormat',
  'panel.customCard.showTime',
  'panel.autoExpandHide',
  'panel.expandTriggerDistancePx',
  'panel.collapseDelaySeconds',
  'panel.expanded',
  'panel.collapsedOpacity',
  'panel.borderRadius',
  'panel.surfaceOpacity',
  'panel.shadowIntensity',
  'panel.height',
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
  'menu.terminal',
  'menu.customCommands',
];

const FIELD_KEYS = SETTINGS_GROUPS
  .filter((group) => !group.static)
  .flatMap((group) => group.fields
    .filter((field) => !field.external)
    .map((field) => field.key));

test('settings field schema covers every config leaf exactly once', () => {
  assert.deepEqual([...FIELD_KEYS].sort(), [...CONFIG_LEAF_KEYS].sort());
  assert.equal(new Set(FIELD_KEYS).size, FIELD_KEYS.length);
});

test('every config leaf has a readable default via the schema path helpers', () => {
  for (const key of CONFIG_LEAF_KEYS) {
    assert.notEqual(getPath(DEFAULT_CONFIG, key), undefined, 'DEFAULT_CONFIG is missing ' + key);
  }
});

test('settings navigation is a focused set of merged groups', () => {
  assert.deepEqual(SETTINGS_GROUPS.map((group) => group.id), [
    'interaction',
    'wallpaper',
    'appearance',
    'audio',
    'motion',
    'panel',
    'weather',
    'menu',
    'about',
  ]);
});

test('every navigation group and the brand mark have an SVG icon', () => {
  for (const group of SETTINGS_GROUPS) {
    assert.ok(SETTINGS_ICONS[group.icon], 'missing nav icon: ' + group.icon);
  }
  assert.ok(SETTINGS_ICONS.settings, 'missing brand icon: settings');
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
  assert.deepEqual(optionsFor('wallpaper.fit'), ['cover', 'contain', 'stretch', 'center']);
  assert.deepEqual(optionsFor('color.mode'), ['default', 'kde', 'wallpaper', 'hybrid']);
  assert.deepEqual(optionsFor('appearance.mode'), ['light', 'dark', 'system']);
  assert.deepEqual(optionsFor('weather.location.mode'), ['auto', 'fixed']);
  const commandModeOptions = SETTINGS_GROUPS
    .find((group) => group.id === 'menu').fields
    .find((field) => field.type === 'commands').fields
    .find((field) => field.key === 'mode').options.map((option) => option.value);
  assert.deepEqual(commandModeOptions, ['background', 'terminal']);
});

test('custom command subfields are editable fields with an auto-managed id', () => {
  const commandField = SETTINGS_GROUPS
    .find((group) => group.id === 'menu').fields
    .find((field) => field.type === 'commands');
  // The icon is a visual picker and the id is auto-managed, so neither is an
  // editable subfield.
  const keys = commandField.fields.map((field) => field.key);
  assert.deepEqual([...keys].sort(), ['command', 'label', 'mode']);
});

test('static and external fields carry no config keys', () => {
  const about = SETTINGS_GROUPS.find((group) => group.id === 'about');
  assert.equal(about.static, true);
  const weather = SETTINGS_GROUPS.find((group) => group.id === 'weather');
  for (const field of weather.fields) {
    if (field.external) {
      assert.equal(FIELD_KEYS.includes(field.key), false, field.key + ' must stay external');
    }
  }
});

test('path helpers read and write nested config values', () => {
  const target = structuredClone(DEFAULT_CONFIG);
  setPath(target, 'panel.animation.durationMs', 1200);
  assert.equal(getPath(target, 'panel.animation.durationMs'), 1200);
  assert.equal(getPath(target, 'wallpaper.mode'), 'kde');
  setPath(target, 'weather.location.latitude', 31.23);
  assert.equal(getPath(target, 'weather.location.latitude'), 31.23);
  setPath(target, 'mouse.interactionEnabled', false);
  assert.equal(getPath(target, 'mouse.interactionEnabled'), false);
  assert.equal(getPath({}, 'missing.deep.value'), undefined);
});
