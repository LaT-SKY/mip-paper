import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import { createAppearanceCoordinator, deriveAppearanceState } from '../src/appearance.mjs';

function config(mode = 'system', wallpaperBrightness = 0.72, transitionDurationMs = 900) {
  return {
    ...DEFAULT_CONFIG,
    color: { ...DEFAULT_CONFIG.color, transitionDurationMs },
    appearance: { mode, dark: { wallpaperBrightness } },
  };
}

function watcherFactoryFixture() {
  const watchers = [];
  const factory = ({ onTheme, onError }) => {
    const watcher = {
      starts: 0,
      stops: 0,
      start() { this.starts += 1; },
      stop() { this.stops += 1; },
      whenIdle: async () => {},
      emitTheme(theme) { onTheme({ theme, luminance: theme === 'dark' ? 0.1 : 0.9, rgb: [1, 2, 3] }); },
      emitError(error) { onError(error); },
    };
    watchers.push(watcher);
    return watcher;
  };
  return { factory, watchers };
}

test('derives forced and system appearance states with the shared transition', () => {
  assert.deepEqual(deriveAppearanceState(config('light', 0.5, 1200), { theme: 'dark' }), {
    mode: 'light', resolvedTheme: 'light', wallpaperBrightness: 1, transitionDurationMs: 1200,
  });
  assert.deepEqual(deriveAppearanceState(config('dark')), {
    mode: 'dark', resolvedTheme: 'dark', wallpaperBrightness: 0.72, transitionDurationMs: 900,
  });
  assert.equal(deriveAppearanceState(config('system'), { theme: 'dark' }).wallpaperBrightness, 0.72);
  assert.equal(deriveAppearanceState(config('system'), { theme: 'light' }).wallpaperBrightness, 1);
  assert.equal(deriveAppearanceState(config('system')).resolvedTheme, 'light');
});

test('starts one watcher only in system mode and retains the last valid system theme', async () => {
  const fixture = watcherFactoryFixture();
  const updates = [];
  const errors = [];
  const coordinator = createAppearanceCoordinator({
    config: config('system'),
    kdeWatcherFactory: fixture.factory,
    onUpdate: (state) => updates.push(state),
    onError: (error) => errors.push(error),
  });
  coordinator.start();
  coordinator.start();
  assert.equal(fixture.watchers.length, 1);
  assert.equal(fixture.watchers[0].starts, 1);
  fixture.watchers[0].emitTheme('dark');
  assert.equal(coordinator.getState().resolvedTheme, 'dark');
  fixture.watchers[0].emitError(new Error('temporary KDE error'));
  assert.equal(coordinator.getState().resolvedTheme, 'dark');
  assert.equal(errors.length, 1);

  await coordinator.updateConfig(config('light'));
  assert.equal(fixture.watchers[0].stops, 1);
  assert.equal(coordinator.getState().resolvedTheme, 'light');
  await coordinator.updateConfig(config('system'));
  assert.equal(fixture.watchers.length, 2);
  assert.equal(coordinator.getState().resolvedTheme, 'dark');
  await coordinator.stop();
  fixture.watchers[1].emitTheme('light');
  assert.equal(coordinator.getState().resolvedTheme, 'dark');
  assert.ok(updates.length >= 3);
});

test('supports a silent transactional config update', async () => {
  const fixture = watcherFactoryFixture();
  const updates = [];
  const coordinator = createAppearanceCoordinator({
    config: config('dark'),
    kdeWatcherFactory: fixture.factory,
    onUpdate: (state) => updates.push(state),
  });
  coordinator.start();
  updates.length = 0;
  await coordinator.updateConfig(config('dark', 0.5, 400), { publish: false });
  assert.deepEqual(coordinator.getState(), {
    mode: 'dark', resolvedTheme: 'dark', wallpaperBrightness: 0.5, transitionDurationMs: 400,
  });
  assert.deepEqual(updates, []);
});
