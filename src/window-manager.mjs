export const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
export const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
export const INFORMATION_CHANNEL = 'wallpaper:get-information';
export const INFORMATION_UPDATED_CHANNEL = 'wallpaper:information-updated';
export const AUDIO_SPECTRUM_UPDATED_CHANNEL = 'wallpaper:audio-spectrum-updated';
export const CONFIG_UPDATED_CHANNEL = 'wallpaper:config-updated';
export const WALLPAPER_UPDATED_CHANNEL = 'wallpaper:wallpaper-updated';
export const COLOR_UPDATED_CHANNEL = 'wallpaper:color-updated';
export const COLOR_SUBMIT_CHANNEL = 'wallpaper:submit-color';
const APP_ID = 'mip-paper';

export function formatDisplayTargetTitle(display) {
  const { x, y, width, height } = display.bounds;
  return `${APP_ID}|display=${display.id}|bounds=${x},${y},${width},${height}`;
}

export function createWindowManager({
  BrowserWindow,
  screen,
  ipcMain,
  defaultSession,
  config,
  rendererPath,
  preloadPath,
  wallpaperUrl,
  getWallpaperUrl = () => wallpaperUrl,
  probe = null,
  onProbeReport = null,
  informationService = null,
  audioSpectrumService = null,
  colorService = null,
  onDisplaysChanged = () => {},
}) {
  const windows = new Map();
  const bootstrapByWebContents = new Map();
  const informationUnsubscribers = new Map();
  const audioUnsubscribers = new Map();
  let currentConfig = config;
  let queue = Promise.resolve();
  let started = false;

  const enqueueReconcile = () => {
    queue = queue.then(reconcile);
    return queue;
  };

  const onDisplayAdded = () => { enqueueReconcile(); onDisplaysChanged(); };
  const onDisplayRemoved = () => { enqueueReconcile(); onDisplaysChanged(); };
  const onDisplayMetricsChanged = () => { enqueueReconcile(); onDisplaysChanged(); };

  function secureWebContents(webContents) {
    webContents.on('will-navigate', (event) => event.preventDefault());
    webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  }

  async function createDisplayWindow(display) {
    const { x, y, width, height } = display.bounds;
    const window = new BrowserWindow({
      x,
      y,
      width,
      height,
      title: formatDisplayTargetTitle(display),
      frame: false,
      show: false,
      backgroundColor: '#152229',
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: preloadPath,
      },
    });

    secureWebContents(window.webContents);
    const webContentsId = window.webContents.id;
    window.on('page-title-updated', (event) => event.preventDefault());
    window.setIgnoreMouseEvents(!currentConfig.interactionEnabled);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => window.showInactive());
    windows.set(display.id, window);
    bootstrapByWebContents.set(webContentsId, {
      config: currentConfig,
      display,
      wallpaperUrl: getWallpaperUrl(display),
      ...(informationService ? { information: informationService.getSnapshot() } : {}),
      ...(audioSpectrumService ? { audioSpectrum: audioSpectrumService.getSnapshot() } : {}),
      ...(colorService ? { color: colorService.getState(display.id) } : {}),
      ...(probe ? { probe } : {}),
    });
    if (informationService) {
      informationUnsubscribers.set(webContentsId, informationService.subscribe((snapshot) => {
        window.webContents.send(INFORMATION_UPDATED_CHANNEL, snapshot);
      }));
    }
    if (audioSpectrumService) {
      audioUnsubscribers.set(webContentsId, audioSpectrumService.subscribe((snapshot) => {
        window.webContents.send(AUDIO_SPECTRUM_UPDATED_CHANNEL, snapshot);
      }));
    }
    window.once('closed', () => {
      informationUnsubscribers.get(webContentsId)?.();
      informationUnsubscribers.delete(webContentsId);
      audioUnsubscribers.get(webContentsId)?.();
      audioUnsubscribers.delete(webContentsId);
      windows.delete(display.id);
      bootstrapByWebContents.delete(webContentsId);
    });
    await window.loadFile(rendererPath);
    window.setTitle(formatDisplayTargetTitle(display));
  }

  async function reconcile() {
    const displays = screen.getAllDisplays();
    const displayById = new Map(displays.map((display) => [display.id, display]));

    for (const [displayId, window] of windows) {
      if (!displayById.has(displayId)) {
        window.close();
      }
    }

    for (const display of displays) {
      const window = windows.get(display.id);
      if (!window) {
        await createDisplayWindow(display);
        continue;
      }
      window.setTitle(formatDisplayTargetTitle(display));
      window.setBounds(display.bounds);
      bootstrapByWebContents.set(window.webContents.id, {
        config: currentConfig,
        display,
        wallpaperUrl: getWallpaperUrl(display),
        ...(informationService ? { information: informationService.getSnapshot() } : {}),
        ...(audioSpectrumService ? { audioSpectrum: audioSpectrumService.getSnapshot() } : {}),
        ...(colorService ? { color: colorService.getState(display.id) } : {}),
        ...(probe ? { probe } : {}),
      });
    }
  }

  function installSessionGuards() {
    defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    defaultSession.on('will-download', (event) => event.preventDefault());
    defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    );
  }

  async function start() {
    if (started) {
      return;
    }
    started = true;
    installSessionGuards();
    ipcMain.handle(BOOTSTRAP_CHANNEL, async (event) => {
      const bootstrap = bootstrapByWebContents.get(event.sender.id);
      if (!bootstrap) {
        throw new Error('Unknown wallpaper renderer');
      }
      return bootstrap;
    });
    if (informationService) {
      ipcMain.handle(INFORMATION_CHANNEL, async (event) => {
        if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
        return informationService.getSnapshot();
      });
    }
    if (probe && onProbeReport) {
      ipcMain.handle(PROBE_REPORT_CHANNEL, async (event, summary) => {
        if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
        return onProbeReport(summary, event.sender.id);
      });
    }
    if (colorService) {
      ipcMain.handle(COLOR_SUBMIT_CHANNEL, async (event, submission) => {
        const displayId = [...windows.entries()].find(([, window]) => window.webContents.id === event.sender.id)?.[0];
        if (displayId === undefined) throw new Error('Unknown wallpaper renderer');
        return colorService.submitWallpaperAccent(displayId, submission);
      });
    }
    screen.on('display-added', onDisplayAdded);
    screen.on('display-removed', onDisplayRemoved);
    screen.on('display-metrics-changed', onDisplayMetricsChanged);
    await enqueueReconcile();
  }

  function stop() {
    if (!started) {
      return;
    }
    started = false;
    screen.off('display-added', onDisplayAdded);
    screen.off('display-removed', onDisplayRemoved);
    screen.off('display-metrics-changed', onDisplayMetricsChanged);
    ipcMain.removeHandler(BOOTSTRAP_CHANNEL);
    if (informationService) ipcMain.removeHandler(INFORMATION_CHANNEL);
    if (probe && onProbeReport) ipcMain.removeHandler(PROBE_REPORT_CHANNEL);
    if (colorService) ipcMain.removeHandler(COLOR_SUBMIT_CHANNEL);
    for (const window of [...windows.values()]) {
      window.close();
    }
    windows.clear();
    bootstrapByWebContents.clear();
    informationUnsubscribers.clear();
    audioUnsubscribers.clear();
  }

  function updateConfig(nextConfig) {
    currentConfig = nextConfig;
    for (const window of windows.values()) {
      const bootstrap = bootstrapByWebContents.get(window.webContents.id);
      if (bootstrap) {
        bootstrapByWebContents.set(window.webContents.id, {
          ...bootstrap,
          config: currentConfig,
        });
      }
      window.setIgnoreMouseEvents(!currentConfig.interactionEnabled);
      window.webContents.send(CONFIG_UPDATED_CHANNEL, currentConfig);
    }
  }

  function updateWallpaper(displayId, nextWallpaperUrl) {
    const window = windows.get(displayId);
    if (!window) return false;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (!bootstrap) return false;
    bootstrapByWebContents.set(window.webContents.id, { ...bootstrap, wallpaperUrl: nextWallpaperUrl });
    window.webContents.send(WALLPAPER_UPDATED_CHANNEL, { wallpaperUrl: nextWallpaperUrl });
    return true;
  }

  function updateColor(displayId, color) {
    const window = windows.get(displayId);
    if (!window) return false;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (!bootstrap) return false;
    bootstrapByWebContents.set(window.webContents.id, { ...bootstrap, color });
    window.webContents.send(COLOR_UPDATED_CHANNEL, color);
    return true;
  }

  return {
    start,
    stop,
    updateConfig,
    updateWallpaper,
    updateColor,
    whenIdle: () => queue,
  };
}
