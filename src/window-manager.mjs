import { DEFAULT_CONFIG } from './config.mjs';

export const BOOTSTRAP_CHANNEL = 'wallpaper:get-bootstrap';
export const PROBE_REPORT_CHANNEL = 'wallpaper:report-probe';
export const INFORMATION_CHANNEL = 'wallpaper:get-information';
export const INFORMATION_UPDATED_CHANNEL = 'wallpaper:information-updated';
export const AUDIO_SPECTRUM_UPDATED_CHANNEL = 'wallpaper:audio-spectrum-updated';
export const CONFIG_UPDATED_CHANNEL = 'wallpaper:config-updated';
export const WALLPAPER_UPDATED_CHANNEL = 'wallpaper:wallpaper-updated';
export const COLOR_UPDATED_CHANNEL = 'wallpaper:color-updated';
export const COLOR_SUBMIT_CHANNEL = 'wallpaper:submit-color';
export const FULLSCREEN_UPDATED_CHANNEL = 'wallpaper:fullscreen-updated';
export const MENU_COMMAND_CHANNEL = 'wallpaper:menu-command';
export const WORK_AREA_UPDATED_CHANNEL = 'wallpaper:work-area-updated';
export const GET_WORK_AREA_CHANNEL = 'wallpaper:get-work-area';
export const MENU_OPENED_CHANNEL = 'wallpaper:menu-opened';
export const NOTIFY_MENU_OPENED_CHANNEL = 'wallpaper:notify-menu-opened';
// Broadcast by closeMenus() when a non-wallpaper window is activated, so
// every renderer dismisses its context menu. Distinct from MENU_OPENED_CHANNEL,
// which only fires when another display actually opened a menu.
export const MENU_CLOSE_CHANNEL = 'wallpaper:menu-close';
// Renderer -> main query used when the pointer leaves a wallpaper surface:
// the main process owns the app-UI window registry (future GUI windows such
// as a settings dialog) and reports whether the pointer is currently over
// one of them, so the wallpaper does not dismiss its menu onto our own UI.
export const IS_POINTER_OVER_APP_UI_CHANNEL = 'wallpaper:is-pointer-over-app-ui';
// Settings window: opened by the wallpaper renderers through the context-menu
// built-in action; state/save/credentials/import channels are used only by the
// settings renderer (see settings-preload.cjs).
export const SETTINGS_OPEN_CHANNEL = 'settings:open';
export const SETTINGS_STATE_CHANNEL = 'settings:get-state';
export const SETTINGS_SAVE_CONFIG_CHANNEL = 'settings:save-config';
export const SETTINGS_SAVE_CREDENTIALS_CHANNEL = 'settings:save-credentials';
export const SETTINGS_IMPORT_WALLPAPER_CHANNEL = 'settings:import-wallpaper';
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
  getWallpaperTransaction = (display) => ({ wallpaperUrl, displayId: display.id }),
  probe = null,
  onProbeReport = null,
  informationService = null,
  audioSpectrumService = null,
  colorService = null,
  onDisplaysChanged = () => {},
  appearance = null,
  menuCommandRunner = null,
  appVersion = null,
  // Settings window wiring (all optional; the context-menu entry and the
  // settings page are no-ops until these are provided by the main process).
  settingsPath = null,
  settingsPreloadPath = null,
  dialog = null,
  configPath = null,
  weatherCredentialsPath = null,
  settingsService = null,
  importWallpaper = null,
  wallpaperPath = null,
  getSettingsState = () => ({}),
  // Optional icon path for the settings window (Linux window icon) and a
  // hook fired after a wallpaper import succeeded, so the main process can
  // re-publish the manual wallpaper immediately instead of waiting for the
  // next sync cycle.
  settingsIconPath = null,
  onWallpaperImported = null,
}) {
  const windows = new Map();
  const bootstrapByWebContents = new Map();
  const informationUnsubscribers = new Map();
  const audioUnsubscribers = new Map();
  const pausedByDisplay = new Map();
  const workAreaByDisplay = new Map();
  // Non-wallpaper app UI windows (e.g. a future settings dialog). Their
  // renderers are part of our own interface, so the wallpaper must not
  // dismiss its context menu when the pointer moves onto them. The display
  // wallpaper windows are deliberately NOT registered here.
  const appUiWindows = new Set();
  let currentConfig = config;
  let currentAppearance = appearance;
  let queue = Promise.resolve();
  let started = false;
  // The single settings window (created lazily, reused until closed).
  let settingsWindow = null;

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
    window.setIgnoreMouseEvents(!currentConfig.mouse.buttonsEnabled);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.once('ready-to-show', () => window.showInactive());
    windows.set(display.id, window);
    bootstrapByWebContents.set(webContentsId, {
      config: currentConfig,
      ...(appVersion != null ? { appVersion } : {}),
      ...(currentAppearance ? { appearance: currentAppearance } : {}),
      display,
      paused: pausedByDisplay.get(display.id) ?? false,
      ...(workAreaByDisplay.has(display.id) ? { workArea: workAreaByDisplay.get(display.id) } : {}),
      wallpaper: getWallpaperTransaction(display),
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
    // Chromium's Wayland viewport can drift from the requested bounds under
    // fractional scaling; re-assert the exact content size so the wallpaper
    // never overflows into a neighbouring display.
    window.setContentSize?.(width, height);
    window.setTitle(formatDisplayTargetTitle(display));
  }

  function isSettingsSender(webContentsId) {
    return settingsWindow !== null
      && !settingsWindow.isDestroyed?.()
      && settingsWindow.webContents.id === webContentsId;
  }

  // Snapshot for the settings UI: the validated config, its defaults (for the
  // reset controls), appearance, accent, credentials presence (never the key),
  // wallpaper mode/path, and the user config path. Extra state from the main
  // process (credentials status, accent, wallpaper path) arrives through the
  // getSettingsState callback.
  function buildSettingsState() {
    const extra = getSettingsState ? getSettingsState() : {};
    const credentials = extra.credentials ?? { configured: false, apiHost: null };
    const wallpaper = extra.wallpaper ?? { mode: currentConfig.wallpaper?.mode ?? 'kde', path: wallpaperPath };
    return {
      config: structuredClone(currentConfig),
      defaults: structuredClone(DEFAULT_CONFIG),
      ...(currentAppearance ? { appearance: structuredClone(currentAppearance) } : {}),
      ...(extra.accent ? { accent: extra.accent } : {}),
      credentials,
      wallpaper,
      configPath,
      appVersion,
    };
  }

  // Create (or focus) the single settings window. It is a normal framed window
  // that renders above the wallpaper: the KWin window rule only matches the
  // wallpaper display-target captions, and the coordinator ignores its caption,
  // so neither fullscreen/below forcing nor geometry pinning applies. It is
  // registered in the app-UI set so wallpaper context menus stay open while
  // the pointer is over it.
  async function createSettingsWindow() {
    if (settingsWindow !== null && !settingsWindow.isDestroyed?.()) {
      if (settingsWindow.isMinimized?.()) settingsWindow.restore();
      settingsWindow.show();
      settingsWindow.focus();
      return settingsWindow;
    }
    const window = new BrowserWindow({
      title: 'Mip-Paper 设置',
      width: 880,
      height: 640,
      minWidth: 720,
      minHeight: 520,
      show: false,
      backgroundColor: '#152229',
      autoHideMenuBar: true,
      ...(settingsIconPath ? { icon: settingsIconPath } : {}),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: settingsPreloadPath,
      },
    });
    secureWebContents(window.webContents);
    window.once('ready-to-show', () => {
      window.show();
      // The wallpaper windows ignore focus, so the settings window must take
      // keyboard focus itself to be usable immediately.
      window.focus();
    });
    window.on('closed', () => {
      if (settingsWindow === window) settingsWindow = null;
    });
    registerAppUiWindow(window);
    settingsWindow = window;
    await window.loadFile(settingsPath);
    return window;
  }

  async function reconcile() {
    const displays = screen.getAllDisplays();
    const displayById = new Map(displays.map((display) => [display.id, display]));

    for (const [displayId, window] of windows) {
      if (!displayById.has(displayId)) {
        window.close();
      }
    }

    for (const displayId of [...pausedByDisplay.keys()]) {
      if (!displayById.has(displayId)) pausedByDisplay.delete(displayId);
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
        ...(appVersion != null ? { appVersion } : {}),
        ...(currentAppearance ? { appearance: currentAppearance } : {}),
        display,
        paused: pausedByDisplay.get(display.id) ?? false,
        ...(workAreaByDisplay.has(display.id) ? { workArea: workAreaByDisplay.get(display.id) } : {}),
        wallpaper: getWallpaperTransaction(display),
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
    ipcMain.handle(GET_WORK_AREA_CHANNEL, (event) => {
      const displayId = [...windows.entries()].find(([, window]) => window.webContents.id === event.sender.id)?.[0];
      if (displayId === undefined) throw new Error('Unknown wallpaper renderer');
      return workAreaByDisplay.get(displayId) ?? null;
    });
    // Wallpaper renderers ask whether the pointer is over one of our own app
    // UI windows (future settings dialog etc.) so the context menu is not
    // dismissed when the pointer moves onto our own interface.
    ipcMain.handle(IS_POINTER_OVER_APP_UI_CHANNEL, (event) => {
      if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
      return isPointerOverAppUi();
    });
    // Only one context menu may be open across all displays: when a renderer
    // opens its menu it tells every other window to close theirs.
    ipcMain.on(NOTIFY_MENU_OPENED_CHANNEL, (event) => {
      for (const window of windows.values()) {
        if (window.webContents.id !== event.sender.id) {
          window.webContents.send(MENU_OPENED_CHANNEL, {});
        }
      }
    });
    if (menuCommandRunner) {
      ipcMain.handle(MENU_COMMAND_CHANNEL, async (event, request) => {
        if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
        const id = request?.id;
        if (typeof id !== 'string' || id.trim() === '') {
          throw new TypeError('Menu command id must be a non-empty string');
        }
        const entry = (currentConfig.menu?.customCommands ?? []).find((command) => command.id === id);
        if (!entry) throw new Error('Unknown menu command: ' + id);
        await menuCommandRunner.run({
          command: entry.command,
          mode: entry.mode ?? 'background',
          terminal: currentConfig.menu?.terminal ?? '',
          autoExit: entry.autoExit !== false,
        });
        return { ok: true };
      });
    }
    // Settings window: the open request comes from the wallpaper renderers
    // (context-menu built-in action); everything else is the settings page.
    ipcMain.handle(SETTINGS_OPEN_CHANNEL, (event) => {
      if (!bootstrapByWebContents.has(event.sender.id)) throw new Error('Unknown wallpaper renderer');
      return createSettingsWindow();
    });
    if (settingsPath) {
      ipcMain.handle(SETTINGS_STATE_CHANNEL, (event) => {
        if (!isSettingsSender(event.sender.id)) throw new Error('Unknown settings renderer');
        return buildSettingsState();
      });
    }
    if (settingsService && configPath) {
      ipcMain.handle(SETTINGS_SAVE_CONFIG_CHANNEL, async (event, candidate) => {
        if (!isSettingsSender(event.sender.id)) throw new Error('Unknown settings renderer');
        // Validated + written atomically; the config watcher hot-reloads it.
        return settingsService.saveConfigFile(configPath, candidate);
      });
    }
    if (settingsService && weatherCredentialsPath) {
      ipcMain.handle(SETTINGS_SAVE_CREDENTIALS_CHANNEL, async (event, payload) => {
        if (!isSettingsSender(event.sender.id)) throw new Error('Unknown settings renderer');
        const saved = await settingsService.saveWeatherCredentialsFile(weatherCredentialsPath, payload);
        return { configured: true, apiHost: saved.apiHost };
      });
    }
    if (dialog && importWallpaper && wallpaperPath && settingsService && configPath) {
      ipcMain.handle(SETTINGS_IMPORT_WALLPAPER_CHANNEL, async (event) => {
        if (!isSettingsSender(event.sender.id)) throw new Error('Unknown settings renderer');
        const options = {
          title: '选择壁纸图片',
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
        };
        const result = settingsWindow && !settingsWindow.isDestroyed?.()
          ? await dialog.showOpenDialog(settingsWindow, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) {
          return { ok: false, canceled: true };
        }
        const source = result.filePaths[0];
        const imported = await importWallpaper(source, wallpaperPath);
        if (currentConfig.wallpaper.mode !== 'manual') {
          await settingsService.saveConfigFile(configPath, {
            ...currentConfig,
            wallpaper: { mode: 'manual' },
          });
        }
        // The config hot-reload flips the mode when it changed; when the mode
        // was already manual the file swap alone does not re-trigger the sync,
        // so always ask the main process to re-publish the manual wallpaper
        // right away (idempotent when the watcher already ran).
        if (onWallpaperImported) await onWallpaperImported();
        return { ok: true, mode: 'manual', path: wallpaperPath, imported: { ...imported } };
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
    ipcMain.removeHandler(GET_WORK_AREA_CHANNEL);
    ipcMain.removeHandler(IS_POINTER_OVER_APP_UI_CHANNEL);
    ipcMain.removeHandler(SETTINGS_OPEN_CHANNEL);
    ipcMain.removeHandler(SETTINGS_STATE_CHANNEL);
    ipcMain.removeHandler(SETTINGS_SAVE_CONFIG_CHANNEL);
    ipcMain.removeHandler(SETTINGS_SAVE_CREDENTIALS_CHANNEL);
    ipcMain.removeHandler(SETTINGS_IMPORT_WALLPAPER_CHANNEL);
    ipcMain.removeAllListeners(NOTIFY_MENU_OPENED_CHANNEL);
    if (informationService) ipcMain.removeHandler(INFORMATION_CHANNEL);
    if (probe && onProbeReport) ipcMain.removeHandler(PROBE_REPORT_CHANNEL);
    if (colorService) ipcMain.removeHandler(COLOR_SUBMIT_CHANNEL);
    if (menuCommandRunner) ipcMain.removeHandler(MENU_COMMAND_CHANNEL);
    settingsWindow?.close();
    settingsWindow = null;
    for (const window of [...windows.values()]) {
      window.close();
    }
    windows.clear();
    appUiWindows.clear();
    bootstrapByWebContents.clear();
    informationUnsubscribers.clear();
    audioUnsubscribers.clear();
  }

  function runtimePayload() {
    return structuredClone({ config: currentConfig, ...(currentAppearance ? { appearance: currentAppearance } : {}) });
  }

  function broadcastRuntime() {
    for (const window of windows.values()) {
      const bootstrap = bootstrapByWebContents.get(window.webContents.id);
      if (bootstrap) {
        bootstrapByWebContents.set(window.webContents.id, {
          ...bootstrap,
          config: currentConfig,
          ...(currentAppearance ? { appearance: currentAppearance } : {}),
        });
      }
      window.setIgnoreMouseEvents(!currentConfig.mouse.buttonsEnabled);
      window.webContents.send(CONFIG_UPDATED_CHANNEL, runtimePayload());
    }
    // The settings window subscribes to the same runtime broadcast so an open
    // settings page reflects config/appearance changes made by any writer.
    if (settingsWindow !== null && !settingsWindow.isDestroyed?.()) {
      settingsWindow.webContents.send(CONFIG_UPDATED_CHANNEL, runtimePayload());
    }
  }

  function updateRuntime({ config: nextConfig, appearance: nextAppearance } = {}) {
    currentConfig = nextConfig;
    currentAppearance = nextAppearance;
    broadcastRuntime();
  }

  function updateAppearance(nextAppearance) {
    currentAppearance = nextAppearance;
    broadcastRuntime();
  }

  function updateConfig(nextConfig) {
    currentConfig = nextConfig;
    broadcastRuntime();
  }

  function updateWallpaper(displayId, wallpaper) {
    const window = windows.get(displayId);
    if (!window) return false;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (!bootstrap) return false;
    bootstrapByWebContents.set(window.webContents.id, { ...bootstrap, wallpaper });
    window.webContents.send(WALLPAPER_UPDATED_CHANNEL, wallpaper);
    return true;
  }

  function updateColor(displayId, color) {
    const window = windows.get(displayId);
    if (!window) return false;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (!bootstrap) return false;
    bootstrapByWebContents.set(window.webContents.id, {
      ...bootstrap,
      color,
      ...(bootstrap.wallpaper ? { wallpaper: { ...bootstrap.wallpaper, color } } : {}),
    });
    window.webContents.send(COLOR_UPDATED_CHANNEL, color);
    return true;
  }

  function updateWorkArea(displayId, rect) {
    const display = screen.getAllDisplays().find((candidate) => candidate.id === displayId);
    if (!display || !rect) return false;
    const normalized = {
      x: rect.x - display.bounds.x,
      y: rect.y - display.bounds.y,
      width: rect.width,
      height: rect.height,
    };
    const previous = workAreaByDisplay.get(displayId);
    if (previous
      && previous.x === normalized.x && previous.y === normalized.y
      && previous.width === normalized.width && previous.height === normalized.height) {
      return false;
    }
    // Store even when the window does not exist yet, so a later bootstrap
    // carries the current work area regardless of push/boot ordering.
    workAreaByDisplay.set(displayId, normalized);
    const window = windows.get(displayId);
    if (!window) return true;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (bootstrap) {
      bootstrapByWebContents.set(window.webContents.id, { ...bootstrap, workArea: normalized });
    }
    window.webContents.send(WORK_AREA_UPDATED_CHANNEL, normalized);
    return true;
  }

  function updateFullscreen(displayId, paused) {
    const active = Boolean(paused);
    pausedByDisplay.set(displayId, active);
    const window = windows.get(displayId);
    if (!window) return false;
    const bootstrap = bootstrapByWebContents.get(window.webContents.id);
    if (bootstrap) {
      bootstrapByWebContents.set(window.webContents.id, { ...bootstrap, paused: active });
    }
    window.webContents.send(FULLSCREEN_UPDATED_CHANNEL, { paused: active });
    return true;
  }

  // Ask every renderer to dismiss its context menu (e.g. because a
  // non-wallpaper window was just activated). Unlike the global-uniqueness
  // broadcast on NOTIFY_MENU_OPENED_CHANNEL, this also reaches the sender.
  function closeMenus() {
    for (const window of windows.values()) {
      window.webContents.send(MENU_CLOSE_CHANNEL, {});
    }
  }

  // Registry for non-wallpaper app UI windows (a future settings dialog,
  // etc.). While the pointer is over one of them, wallpaper context menus
  // must stay open — interacting with our own interface is not "focusing
  // another app". The window is unregistered automatically when it closes.
  function registerAppUiWindow(window) {
    appUiWindows.add(window);
    window.once?.('closed', () => appUiWindows.delete(window));
  }

  function unregisterAppUiWindow(window) {
    appUiWindows.delete(window);
  }

  // Whether the current cursor position is inside any registered app UI
  // window. Used by the wallpaper renderers on pointer-leave to decide
  // whether dismissing the context menu would move the pointer onto our own
  // interface (then keep the menu open).
  function isPointerOverAppUi() {
    if (appUiWindows.size === 0) return false;
    let point;
    try {
      point = screen.getCursorScreenPoint();
    } catch {
      return false;
    }
    for (const window of [...appUiWindows]) {
      if (window.isDestroyed?.()) {
        appUiWindows.delete(window);
        continue;
      }
      const [x, y] = window.getPosition();
      const [width, height] = window.getSize();
      if (point.x >= x && point.x < x + width && point.y >= y && point.y < y + height) {
        return true;
      }
    }
    return false;
  }

  return {
    start,
    stop,
    updateConfig,
    updateRuntime,
    updateAppearance,
    updateWallpaper,
    updateColor,
    updateFullscreen,
    updateWorkArea,
    closeMenus,
    registerAppUiWindow,
    unregisterAppUiWindow,
    openSettings: () => createSettingsWindow(),
    whenIdle: () => queue,
  };
}
