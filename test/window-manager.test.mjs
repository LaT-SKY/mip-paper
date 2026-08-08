import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  BOOTSTRAP_CHANNEL,
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
  }

  setWindowOpenHandler(handler) {
    this.openHandler = handler;
  }
}

class FakeWindow extends EventEmitter {
  static instances = [];

  constructor(options) {
    super();
    this.options = options;
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
    this.title = options.title;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.ignoreMouse = null;
    this.loadedFile = null;
    this.visibleOnAllWorkspaces = null;
    FakeWindow.instances.push(this);
  }

  async loadFile(pathname) {
    this.loadedFile = pathname;
    this.title = 'animated-ocean-wallpaper';
  }

  setBounds(bounds) {
    this.bounds = { ...bounds };
  }

  setTitle(title) {
    this.title = title;
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
  }), 'animated-ocean-wallpaper|display=22|bounds=1920,0,2560,1440');
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
  const manager = createWindowManager({
    BrowserWindow: FakeWindow,
    screen,
    ipcMain,
    defaultSession,
    config,
    rendererPath: '/app/src/renderer/index.html',
    preloadPath: '/app/src/preload.mjs',
  });
  return { manager, displays, screen, ipcMain, defaultSession };
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
  assert.equal(first.title, 'animated-ocean-wallpaper|display=11|bounds=0,0,1920,1080');
});

test('provides bootstrap data only to a managed renderer', async () => {
  const { manager, displays, ipcMain } = createFixture();
  await manager.start();
  const first = FakeWindow.instances[0];
  const handler = ipcMain.handlers.get(BOOTSTRAP_CHANNEL);

  assert.deepEqual(await handler({ sender: first.webContents }), {
    config: DEFAULT_CONFIG,
    display: displays[0],
  });
  await assert.rejects(handler({ sender: { id: 999 } }), /Unknown wallpaper renderer/);
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

  assert.equal(first.title, 'animated-ocean-wallpaper|display=11|bounds=-1600,0,1600,900');
});

test('uses configuration to control mouse passthrough', async () => {
  const passthrough = structuredClone(DEFAULT_CONFIG);
  passthrough.interactionEnabled = false;
  const { manager } = createFixture(passthrough);
  await manager.start();
  assert.equal(FakeWindow.instances[0].ignoreMouse, true);
});

test('stop closes windows, removes IPC, and detaches display listeners', async () => {
  const { manager, screen, ipcMain } = createFixture();
  await manager.start();
  manager.stop();

  assert.equal(FakeWindow.instances.every((window) => window.destroyed), true);
  assert.equal(ipcMain.handlers.has(BOOTSTRAP_CHANNEL), false);
  assert.equal(screen.listenerCount('display-added'), 0);
  assert.equal(screen.listenerCount('display-removed'), 0);
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
});
