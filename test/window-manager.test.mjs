import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  AUDIO_CONFIG_UPDATED_CHANNEL,
  AUDIO_SPECTRUM_UPDATED_CHANNEL,
  BOOTSTRAP_CHANNEL,
  COLOR_UPDATED_CHANNEL,
  COLOR_SUBMIT_CHANNEL,
  INFORMATION_CHANNEL,
  INFORMATION_UPDATED_CHANNEL,
  createWindowManager,
  formatDisplayTargetTitle,
} from '../src/window-manager.mjs';

class FakeWebContents extends EventEmitter {
  static nextId = 1;

  constructor() {
    super();
    this.id = FakeWebContents.nextId;
    FakeWebContents.nextId += 1;
    this.openHandler = null;
    this.sent = [];
  }

  setWindowOpenHandler(handler) {
    this.openHandler = handler;
  }

  send(channel, value) { this.sent.push({ channel, value }); }
}

class FakeWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.title = options.title;
    this._webContents = new FakeWebContents();
    this.destroyed = false;
    this.throwOnDestroyedWebContents = false;
    this.ignoreMouse = null;
    this.loadedFile = null;
    this.visibleOnAllWorkspaces = null;
    FakeWindow.instances.push(this);
  }

  get webContents() {
    if (this.destroyed && this.throwOnDestroyedWebContents) {
      throw new Error('Object has been destroyed');
    }
    return this._webContents;
  }

  async loadFile(pathname) {
    this.loadedFile = pathname;
    this.title = 'mip-paper';
  }

  setBounds(bounds) {
    this.bounds = { ...bounds };
  }

  setTitle(title) {
    this.title = title;
  }

  updatePageTitle(title) {
    let prevented = false;
    this.emit('page-title-updated', {
      preventDefault() {
        prevented = true;
      },
    }, title, true);
    if (!prevented) this.title = title;
  }

  setIgnoreMouseEvents(value) {
    this.ignoreMouse = value;
  }

  setVisibleOnAllWorkspaces(value, options) {
    this.visibleOnAllWorkspaces = { value, options };
  }

  showInactive() {
    this.shownInactive = true;
  }

  close() {
    this.destroyed = true;
    this.emit('closed');
  }
}

test('formats a display target title from its identity and bounds', () => {
  assert.equal(formatDisplayTargetTitle({
    id: 22,
    bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  }), 'mip-paper|display=22|bounds=1920,0,2560,1440');
});

class FakeScreen extends EventEmitter {
  constructor(displays) {
    super();
    this.displays = displays;
  }

  getAllDisplays() {
    return this.displays;
  }
}

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }

  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel) {
    this.handlers.delete(channel);
  }
}

function createFixture(config = DEFAULT_CONFIG) {
  FakeWindow.instances = [];
  FakeWebContents.nextId = 1;
  const displays = [
    { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1 },
    { id: 22, bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 }, scaleFactor: 1.5 },
  ];
  const screen = new FakeScreen(displays);
  const ipcMain = new FakeIpcMain();
  const defaultSession = new EventEmitter();
  defaultSession.setPermissionRequestHandler = (handler) => { defaultSession.permissionHandler = handler; };
  defaultSession.webRequest = {
    onBeforeRequest(filter, handler) {
      defaultSession.requestFilter = filter;
      defaultSession.requestHandler = handler;
    },
  };
  const informationListeners = new Set();
  const informationService = {
    getSnapshot: () => ({ weather: { status: 'fresh' } }),
    subscribe(listener) { informationListeners.add(listener); return () => informationListeners.delete(listener); },
  };
  const audioListeners = new Set();
  const audioSnapshot = {
    status: 'unavailable',
    sequence: 0,
    timestampMs: 0,
    left: Array(72).fill(0),
    right: Array(72).fill(0),
    rms: 0,
  };
  const audioSpectrumService = {
    getSnapshot: () => audioSnapshot,
    subscribe(listener) {
      audioListeners.add(listener);
      return () => audioListeners.delete(listener);
    },
  };
  const colorSubmissions = [];
  const colorService = {
    getState: (displayId) => ({ rgb: displayId === 11 ? [255, 52, 120] : [10, 20, 30], source: 'default', transitionDurationMs: 900, analyzeWallpaper: false, wallpaperIdentity: null, generation: 0 }),
    submitWallpaperAccent: async (displayId, submission) => { colorSubmissions.push([displayId, submission]); return true; },
  };
  const manager = createWindowManager({
    BrowserWindow: FakeWindow,
    screen,
    ipcMain,
    defaultSession,
    config,
    informationService,
    audioSpectrumService,
    colorService,
    rendererPath: '/app/src/renderer/index.html',
    preloadPath: '/app/src/preload.mjs',
    wallpaperUrl: 'file:///home/test/.local/share/mip-paper/wallpaper',
  });
  return {
    manager,
    displays,
    screen,
    ipcMain,
    defaultSession,
    informationListeners,
    audioListeners,
    audioSnapshot,
    colorSubmissions,
  };
}

test('creates hardened windows for full display bounds', async () => {
  const { manager, displays } = createFixture();
  await manager.start();

  assert.equal(FakeWindow.instances.length, 2);
  const first = FakeWindow.instances[0];
  assert.deepEqual(first.bounds, displays[0].bounds);
  assert.notDeepEqual(first.bounds, displays[0].workArea);
  assert.equal(first.options.frame, false);
  assert.equal(first.options.resizable, false);
  assert.equal(first.options.skipTaskbar, true);
  assert.deepEqual(first.options.webPreferences, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    preload: '/app/src/preload.mjs',
  });
  assert.deepEqual(first.visibleOnAllWorkspaces, {
    value: true,
    options: { visibleOnFullScreen: true },
  });
  assert.equal(first.loadedFile, '/app/src/renderer/index.html');
  assert.equal(first.title, 'mip-paper|display=11|bounds=0,0,1920,1080');
});

test('provides bootstrap data only to a managed renderer', async () => {
  const { manager, displays, ipcMain } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];
  const handler = ipcMain.handlers.get(BOOTSTRAP_CHANNEL);

  assert.deepEqual(await handler({ sender: first.webContents }), {
    config: DEFAULT_CONFIG,
    display: displays[0],
    wallpaperUrl: 'file:///home/test/.local/share/mip-paper/wallpaper',
    information: { weather: { status: 'fresh' } },
    audioSpectrum: {
      status: 'unavailable',
      sequence: 0,
      timestampMs: 0,
      left: Array(72).fill(0),
      right: Array(72).fill(0),
      rms: 0,
    },
    color: {
      rgb: [255, 52, 120], source: 'default', transitionDurationMs: 900,
      analyzeWallpaper: false, wallpaperIdentity: null, generation: 0,
    },
  });
  await assert.rejects(handler({ sender: { id: 999 } }), /Unknown wallpaper renderer/);
});

test('scopes wallpaper accent submissions and updates to the owning display', async () => {
  const { manager, ipcMain, colorSubmissions } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];
  const submission = {
    rgb: [31, 173, 158],
    wallpaperIdentity: { path: '/wallpaper', size: 12, mtimeMs: 34 },
    generation: 1,
  };
  assert.equal(await ipcMain.handlers.get(COLOR_SUBMIT_CHANNEL)({ sender: first.webContents }, submission), true);
  assert.deepEqual(colorSubmissions, [[11, submission]]);
  await assert.rejects(
    ipcMain.handlers.get(COLOR_SUBMIT_CHANNEL)({ sender: { id: 999 } }, submission),
    /Unknown wallpaper renderer/,
  );

  assert.equal(manager.updateColor(11, { rgb: [1, 2, 3] }), true);
  assert.deepEqual(first.webContents.sent.at(-1), { channel: COLOR_UPDATED_CHANNEL, value: { rgb: [1, 2, 3] } });
  assert.equal(manager.updateColor(999, { rgb: [1, 2, 3] }), false);
});

test('streams one spectrum service to every window and unsubscribes closed windows', async () => {
  const { manager, audioListeners } = createFixture();
  await manager.start();
  const snapshot = {
    status: 'active', sequence: 1, timestampMs: 10,
    left: Array(72).fill(0.2), right: Array(72).fill(0.4), rms: 0.3,
  };
  for (const listener of audioListeners) listener(snapshot);
  assert.deepEqual(FakeWindow.instances.map((window) => window.webContents.sent.at(-1)), [
    { channel: AUDIO_SPECTRUM_UPDATED_CHANNEL, value: snapshot },
    { channel: AUDIO_SPECTRUM_UPDATED_CHANNEL, value: snapshot },
  ]);
  const before = audioListeners.size;
  FakeWindow.instances[0].close();
  assert.equal(audioListeners.size, before - 1);
});

test('broadcasts only the validated audio subsection on runtime config changes', async () => {
  const { manager, ipcMain } = createFixture();
  await manager.start();
  const audio = { ...DEFAULT_CONFIG.audio, fadeInMs: 0 };
  manager.updateAudioConfig(audio);
  assert.deepEqual(FakeWindow.instances.map((window) => window.webContents.sent.at(-1)), [
    { channel: AUDIO_CONFIG_UPDATED_CHANNEL, value: audio },
    { channel: AUDIO_CONFIG_UPDATED_CHANNEL, value: audio },
  ]);
  const bootstrap = await ipcMain.handlers.get(BOOTSTRAP_CHANNEL)({
    sender: FakeWindow.instances[0].webContents,
  });
  assert.deepEqual(bootstrap.config.audio, audio);
});

test('streams information only to managed renderers and unsubscribes closed windows', async () => {
  const { manager, ipcMain, informationListeners } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];
  const informationHandler = ipcMain.handlers.get(INFORMATION_CHANNEL);
  assert.deepEqual(await informationHandler({ sender: first.webContents }), { weather: { status: 'fresh' } });
  await assert.rejects(informationHandler({ sender: { id: 999 } }), /Unknown wallpaper renderer/);
  for (const listener of informationListeners) listener({ weather: { status: 'stale' } });
  assert.deepEqual(first.webContents.sent.at(-1), {
    channel: INFORMATION_UPDATED_CHANNEL,
    value: { weather: { status: 'stale' } },
  });
  const before = informationListeners.size;
  first.close();
  assert.equal(informationListeners.size, before - 1);
});

test('blocks navigation, popup windows, downloads, permissions, and remote requests', async () => {
  const { manager, defaultSession } = createFixture();
  await manager.start();
  const webContents = FakeWindow.instances[0].webContents;
  let navigationPrevented = false;
  webContents.emit('will-navigate', { preventDefault: () => { navigationPrevented = true; } });
  assert.equal(navigationPrevented, true);
  assert.deepEqual(webContents.openHandler(), { action: 'deny' });

  let downloadPrevented = false;
  defaultSession.emit('will-download', { preventDefault: () => { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
  let permissionAllowed;
  defaultSession.permissionHandler({}, '', (allowed) => { permissionAllowed = allowed; });
  assert.equal(permissionAllowed, false);
  assert.deepEqual(defaultSession.requestFilter, { urls: ['http://*/*', 'https://*/*'] });
  let requestDecision;
  defaultSession.requestHandler({}, (decision) => { requestDecision = decision; });
  assert.deepEqual(requestDecision, { cancel: true });
});

test('reconciles display add, geometry changes, and removal', async () => {
  const { manager, displays, screen } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];

  const added = { id: 33, bounds: { x: -1280, y: 0, width: 1280, height: 1024 }, scaleFactor: 1 };
  displays.push(added);
  screen.emit('display-added', {}, added);
  await manager.whenIdle();
  assert.equal(FakeWindow.instances.length, 3);

  displays[0] = { ...displays[0], bounds: { x: 0, y: 0, width: 1600, height: 900 } };
  screen.emit('display-metrics-changed', {}, displays[0], ['bounds']);
  await manager.whenIdle();
  assert.deepEqual(first.bounds, displays[0].bounds);

  screen.emit('display-removed', {}, displays[1]);
  displays.splice(1, 1);
  await manager.whenIdle();
  assert.equal(FakeWindow.instances[1].destroyed, true);
});

test('refreshes the display target title when display metrics change', async () => {
  const { manager, displays, screen } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];

  displays[0] = { ...displays[0], bounds: { x: -1600, y: 0, width: 1600, height: 900 } };
  screen.emit('display-metrics-changed', {}, displays[0], ['bounds']);
  await manager.whenIdle();

  assert.equal(first.title, 'mip-paper|display=11|bounds=-1600,0,1600,900');
});

test('prevents the renderer page title from replacing the display target', async () => {
  const { manager } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];

  first.updatePageTitle('mip-paper');

  assert.equal(first.title, 'mip-paper|display=11|bounds=0,0,1920,1080');
});

test('uses configuration to control mouse passthrough', async () => {
  const passthrough = structuredClone(DEFAULT_CONFIG);
  passthrough.interactionEnabled = false;
  const { manager } = createFixture(passthrough);
  await manager.start();
  assert.equal(FakeWindow.instances[0].ignoreMouse, true);
});

test('stop closes windows, removes IPC, and detaches display listeners', async () => {
  const {
    manager, screen, ipcMain, informationListeners, audioListeners,
  } = createFixture();
  await manager.start();
  manager.stop();

  assert.equal(FakeWindow.instances.every((window) => window.destroyed), true);
  assert.equal(ipcMain.handlers.has(BOOTSTRAP_CHANNEL), false);
  assert.equal(ipcMain.handlers.has(INFORMATION_CHANNEL), false);
  assert.equal(ipcMain.handlers.has(COLOR_SUBMIT_CHANNEL), false);
  assert.equal(screen.listenerCount('display-added'), 0);
  assert.equal(screen.listenerCount('display-removed'), 0);
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
  assert.equal(informationListeners.size, 0);
  assert.equal(audioListeners.size, 0);
});

test('stop closes every window without reading webContents after destruction', async () => {
  const { manager } = createFixture();
  await manager.start();
  for (const window of FakeWindow.instances) window.throwOnDestroyedWebContents = true;

  assert.doesNotThrow(() => manager.stop());
  assert.equal(FakeWindow.instances.every((window) => window.destroyed), true);
});
