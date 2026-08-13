export function deriveAppearanceState(config, systemTheme = null) {
  const mode = config.appearance.mode;
  const resolvedTheme = mode === 'system' ? (systemTheme?.theme || 'light') : mode;
  return Object.freeze({
    mode,
    resolvedTheme,
    wallpaperBrightness: resolvedTheme === 'dark' ? config.appearance.dark.wallpaperBrightness : 1,
    transitionDurationMs: config.color.transitionDurationMs,
  });
}

export function createAppearanceCoordinator({
  config,
  kdeWatcherFactory,
  onUpdate = () => {},
  onError = () => {},
} = {}) {
  if (typeof kdeWatcherFactory !== 'function') throw new TypeError('kdeWatcherFactory is required');
  let currentConfig = config;
  let systemTheme = null;
  let currentState = deriveAppearanceState(config);
  let watcher = null;
  let running = false;
  let generation = 0;

  function publish() {
    currentState = deriveAppearanceState(currentConfig, systemTheme);
    onUpdate(currentState);
    return currentState;
  }

  function stopWatcher() {
    generation += 1;
    watcher?.stop();
    watcher = null;
  }

  function startWatcher() {
    if (!running || currentConfig.appearance.mode !== 'system' || watcher) return;
    const current = ++generation;
    watcher = kdeWatcherFactory({
      onTheme(theme) {
        if (!running || current !== generation) return;
        systemTheme = theme;
        publish();
      },
      onError(error) {
        if (running && current === generation) onError(error);
      },
    });
    watcher.start();
  }

  return {
    start() {
      if (running) return;
      running = true;
      startWatcher();
    },
    async updateConfig(nextConfig, { publish: shouldPublish = true } = {}) {
      currentConfig = nextConfig;
      if (nextConfig.appearance.mode === 'system') {
        startWatcher();
      } else {
        stopWatcher();
      }
      currentState = deriveAppearanceState(currentConfig, systemTheme);
      if (shouldPublish) onUpdate(currentState);
      return currentState;
    },
    getState: () => structuredClone(currentState),
    whenIdle: () => watcher?.whenIdle?.() ?? Promise.resolve(),
    async stop() {
      if (!running && !watcher) return;
      running = false;
      const active = watcher;
      stopWatcher();
      await active?.whenIdle?.();
    },
  };
}
