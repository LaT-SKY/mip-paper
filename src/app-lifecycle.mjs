function errorMessage(error) {
  return error?.message || String(error);
}

export function createShutdownCoordinator({
  quit,
  stopConfigWatcher = () => {},
  stopCredentialsWatcher = () => {},
  stopRuntimeCoordinator = () => {},
  stopAppearance = () => {},
  stopWallpaperSync = () => {},
  stopColorService = () => {},
  stopAudioSpectrum = async () => {},
  stopInformation = () => {},
  stopWindowManager = () => {},
  logger = console,
} = {}) {
  if (typeof quit !== 'function') throw new TypeError('quit must be a function');

  let quitAllowed = false;
  let shutdownPromise = null;

  async function stop(name, operation) {
    try {
      await operation();
    } catch (error) {
      logger.error?.(`Failed to stop ${name}: ${errorMessage(error)}`);
    }
  }

  async function shutdown() {
    await stop('runtime config coordinator', stopRuntimeCoordinator);
    await stop('config watcher', stopConfigWatcher);
    await stop('credentials watcher', stopCredentialsWatcher);
    await stop('appearance', stopAppearance);
    await stop('wallpaper sync', stopWallpaperSync);
    await stop('color service', stopColorService);
    await stop('audio spectrum', stopAudioSpectrum);
    await stop('information service', stopInformation);
    await stop('window manager', stopWindowManager);
    quitAllowed = true;
    quit();
  }

  function requestShutdown() {
    if (!shutdownPromise) shutdownPromise = shutdown();
    return shutdownPromise;
  }

  function handleBeforeQuit(event) {
    if (quitAllowed) return null;
    event.preventDefault();
    return requestShutdown();
  }

  return { requestShutdown, handleBeforeQuit };
}

export function installShutdownHandlers({ app, processTarget, coordinator } = {}) {
  const onBeforeQuit = (event) => { void coordinator.handleBeforeQuit(event); };
  const onSigterm = () => { void coordinator.requestShutdown(); };
  app.on('before-quit', onBeforeQuit);
  processTarget.once('SIGTERM', onSigterm);
  return () => {
    app.off('before-quit', onBeforeQuit);
    processTarget.off('SIGTERM', onSigterm);
  };
}
