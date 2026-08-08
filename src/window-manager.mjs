export const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
export const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
const APP_ID = 'animated-ocean-wallpaper';

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
  probe = null,
  onProbeReport = null,
}) {
  const windows = new Map();
  const bootstrapByWebContents = new Map();
  let queue = Promise.resolve();
  let started = false;

  const enqueueReconcile = () => {
    queue = queue.then(reconcile);
    return queue;
  };

  const onDisplayAdded = () => { enqueueReconcile(); };
  const onDisplayRemoved = () => { enqueueReconcile(); };
  const onDisplayMetricsChanged = () => { enqueueReconcile(); };

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
    window.on('page-title-updated', (event) => event.preventDefault());
    window.setIgnoreMouseEvents(!config.interactionEnabled);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => window.showInactive());
    windows.set(display.id, window);
    bootstrapByWebContents.set(window.webContents.id, { config, display, ...(probe ? { probe } : {}) });
    window.once('closed', () => {
      windows.delete(display.id);
      bootstrapByWebContents.delete(window.webContents.id);
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
      bootstrapByWebContents.set(window.webContents.id, { config, display, ...(probe ? { probe } : {}) });
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
    if (probe && onProbeReport) {
      ipcMain.handle(PROBE_REPORT_CHANNEL, async (event, summary) => {
        if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
        return onProbeReport(summary, event.sender.id);
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
    if (probe && onProbeReport) ipcMain.removeHandler(PROBE_REPORT_CHANNEL);
    for (const window of [...windows.values()]) {
      window.close();
    }
    windows.clear();
    bootstrapByWebContents.clear();
  }

  return {
    start,
    stop,
    whenIdle: () => queue,
  };
}
