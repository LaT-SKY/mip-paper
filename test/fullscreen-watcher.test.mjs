import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FULLSCREEN_INTERFACE,
  FULLSCREEN_METHOD,
  FULLSCREEN_PATH,
  FULLSCREEN_SERVICE,
  MENU_INTERFACE,
  MENU_METHOD,
  MENU_PATH,
  WORK_AREA_INTERFACE,
  WORK_AREA_METHOD,
  coordinatorScriptPath,
  createFullscreenTracker,
  createFullscreenWatcher,
  resyncCoordinatorScript,
} from '../src/fullscreen-watcher.mjs';

function fakeMessage({ path, interface: iface, member, body }) {
  return { path, interface: iface, member, body };
}

function createFakeBus() {
  const state = {
    requestNames: [],
    releases: [],
    disconnectCount: 0,
    addedHandlers: [],
    removedHandlers: [],
    sent: [],
  };
  const handlers = [];
  const bus = {
    async requestName(name, flags) { state.requestNames.push(name, flags); return 1; },
    releaseName(name) { state.releases.push(name); },
    disconnect() { state.disconnectCount += 1; },
    addMethodHandler(fn) { handlers.push(fn); state.addedHandlers.push(fn); },
    removeMethodHandler(fn) { state.removedHandlers.push(fn); },
    send(msg) { state.sent.push(msg); },
  };
  return { bus, handlers, state };
}

function createFakeDbus(bus) {
  return {
    sessionBus: () => bus,
    NameFlag: { REPLACE_EXISTING: 2, ALLOW_REPLACEMENT: 1 },
    Message: {
      newMethodReturn: (msg, signature, body) => ({ __reply: true, to: msg, signature, body }),
    },
  };
}

const DISPLAYS = Object.freeze([
  { id: 11, bounds: { x: 0, y: 0, width: 1920, height: 1080 } },
  { id: 22, bounds: { x: 1920, y: 0, width: 2560, height: 1440 } },
]);

function pushMessage({ x = 0, y = 0, width = 1920, height = 1080, fullscreen = true, name = 'DP-1' } = {}) {
  return fakeMessage({
    path: FULLSCREEN_PATH,
    interface: FULLSCREEN_INTERFACE,
    member: FULLSCREEN_METHOD,
    body: [name, x, y, width, height, fullscreen],
  });
}

function workAreaMessage({ x = 0, y = 0, width = 1920, height = 1040, name = 'DP-1' } = {}) {
  return fakeMessage({
    path: FULLSCREEN_PATH,
    interface: WORK_AREA_INTERFACE,
    member: WORK_AREA_METHOD,
    body: [name, x, y, width, height],
  });
}

test('tracker emits a change only when a key toggles and reset unpauses', () => {
  const tracker = createFullscreenTracker();
  assert.deepEqual(tracker.apply('11', true), { outputKey: '11', paused: true });
  assert.equal(tracker.apply('11', true), null);
  assert.deepEqual(tracker.apply('22', true), { outputKey: '22', paused: true });
  assert.deepEqual(tracker.reset(), [
    { outputKey: '11', paused: false },
    { outputKey: '22', paused: false },
  ]);
  assert.deepEqual(tracker.reset(), []);
});

test('watcher owns the service name and registers a method handler on start', async () => {
  const { bus, state } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const changes = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onStateChange: (displayId, paused) => changes.push([displayId, paused]),
  });
  await watcher.start();
  assert.deepEqual(state.requestNames, [FULLSCREEN_SERVICE, 2]);
  assert.equal(state.addedHandlers.length, 1);
  await watcher.stop();
  assert.equal(state.removedHandlers.length, 1);
  assert.deepEqual(state.releases, [FULLSCREEN_SERVICE]);
  assert.equal(state.disconnectCount, 1);
});

test('handles SetOutputFullscreen by geometry and broadcasts only real changes', async () => {
  const { bus, handlers, state } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const changes = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onStateChange: (displayId, paused) => changes.push([displayId, paused]),
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(pushMessage({ x: 0, y: 0, width: 1920, height: 1080, fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true]]);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].__reply, true);

  // Heartbeat re-push with the same state is acknowledged but deduped.
  assert.equal(handle(pushMessage({ x: 0, y: 0, width: 1920, height: 1080, fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true]]);
  assert.equal(state.sent.length, 2);

  // The second display pauses independently.
  assert.equal(handle(pushMessage({ x: 1920, y: 0, width: 2560, height: 1440, fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true], [22, true]]);

  // Leaving fullscreen resumes only that display.
  assert.equal(handle(pushMessage({ x: 1920, y: 0, width: 2560, height: 1440, fullscreen: false })), true);
  assert.deepEqual(changes, [[11, true], [22, true], [22, false]]);

  assert.equal(watcher.isPaused(11), true);
  assert.equal(watcher.isPaused(22), false);
  await watcher.stop();
});

test('matches display geometry within one pixel of rounding', async () => {
  const { bus, handlers } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const changes = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onStateChange: (displayId, paused) => changes.push([displayId, paused]),
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(pushMessage({ x: 1, y: 0, width: 1920, height: 1080, fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true]]);

  // A geometry that matches no display is acknowledged but ignored.
  assert.equal(handle(pushMessage({ x: 9999, y: 9999, width: 640, height: 480, fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true]]);
  await watcher.stop();
});

test('forwards work areas matched by containment and acknowledges pushes', async () => {
  const { bus, handlers, state } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const areas = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onWorkAreaChange: (displayId, rect) => areas.push([displayId, rect]),
  });
  await watcher.start();
  const handle = handlers[0];

  // A panel-shrunk work area on the first display (bottom bar excluded).
  assert.equal(handle(workAreaMessage({ x: 0, y: 0, width: 1920, height: 1040 })), true);
  assert.deepEqual(areas, [[11, { x: 0, y: 0, width: 1920, height: 1040 }]]);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].__reply, true);

  // The second display matches by containment inside its bounds.
  assert.equal(handle(workAreaMessage({ x: 1920, y: 40, width: 2560, height: 1400 })), true);
  assert.deepEqual(areas[1], [22, { x: 1920, y: 40, width: 2560, height: 1400 }]);

  // A rect that is inside no display is acknowledged but ignored.
  assert.equal(handle(workAreaMessage({ x: 9999, y: 9999, width: 100, height: 100 })), true);
  assert.equal(areas.length, 2);
  await watcher.stop();
});

test('work area pushes are not gated by the fullscreen-pause feature', async () => {
  const { bus, handlers } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const areas = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onWorkAreaChange: (displayId, rect) => areas.push([displayId, rect]),
    enabled: () => false,
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(workAreaMessage({ height: 1040 })), true);
  assert.deepEqual(areas, [[11, { x: 0, y: 0, width: 1920, height: 1040 }]]);

  // Fullscreen pushes remain gated.
  assert.equal(handle(pushMessage({ fullscreen: true })), true);
  assert.equal(watcher.isPaused(11), false);
  await watcher.stop();
});

test('ignores unrelated messages and malformed bodies', async () => {
  const { bus, handlers } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const changes = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onStateChange: (displayId, paused) => changes.push([displayId, paused]),
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(fakeMessage({ path: '/Elsewhere', interface: FULLSCREEN_INTERFACE, member: FULLSCREEN_METHOD, body: [] })), false);
  assert.equal(handle(fakeMessage({ path: FULLSCREEN_PATH, interface: 'org.example.Other', member: FULLSCREEN_METHOD, body: [] })), false);
  assert.equal(handle(fakeMessage({ path: FULLSCREEN_PATH, interface: FULLSCREEN_INTERFACE, member: 'OtherMethod', body: [] })), false);
  assert.equal(handle(fakeMessage({ path: FULLSCREEN_PATH, interface: FULLSCREEN_INTERFACE, member: FULLSCREEN_METHOD, body: ['only-one'] })), false);
  assert.equal(handle(fakeMessage({ path: FULLSCREEN_PATH, interface: FULLSCREEN_INTERFACE, member: FULLSCREEN_METHOD, body: null })), false);
  assert.deepEqual(changes, []);
  await watcher.stop();
});

test('forwards menu window-activation messages to the callback', async () => {
  const { bus, handlers, state } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const activations = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onWindowActivated: () => activations.push(1),
  });
  await watcher.start();
  const handle = handlers[0];

  const message = fakeMessage({
    path: MENU_PATH,
    interface: MENU_INTERFACE,
    member: MENU_METHOD,
    body: [],
  });
  assert.equal(handle(message), true);
  assert.deepEqual(activations, [1]);
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].__reply, true);

  // Repeated activations (e.g. focus moves between two apps) notify each time.
  assert.equal(handle(message), true);
  assert.deepEqual(activations, [1, 1]);

  // A menu message on the wrong path/interface/member is not an activation.
  assert.equal(handle(fakeMessage({ path: '/Menu', interface: MENU_INTERFACE, member: 'Other', body: [] })), false);
  assert.equal(handle(fakeMessage({ path: '/Elsewhere', interface: MENU_INTERFACE, member: MENU_METHOD, body: [] })), false);
  assert.equal(handle(fakeMessage({ path: MENU_PATH, interface: 'org.example.Other', member: MENU_METHOD, body: [] })), false);
  assert.deepEqual(activations, [1, 1]);
  await watcher.stop();
});

test('menu activation is never gated by the fullscreen-pause feature', async () => {
  const { bus, handlers } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const activations = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onWindowActivated: () => activations.push(1),
    enabled: () => false,
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(fakeMessage({
    path: MENU_PATH,
    interface: MENU_INTERFACE,
    member: MENU_METHOD,
    body: [],
  })), true);
  assert.deepEqual(activations, [1]);
  await watcher.stop();
});

test('acknowledges pushes while disabled but ignores them and unpauses on disable', async () => {
  const { bus, handlers, state } = createFakeBus();
  const dbusModule = createFakeDbus(bus);
  const changes = [];
  let enabled = true;
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    onStateChange: (displayId, paused) => changes.push([displayId, paused]),
    enabled: () => enabled,
  });
  await watcher.start();
  const handle = handlers[0];

  assert.equal(handle(pushMessage({ fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true]]);

  watcher.setEnabled(false);
  assert.deepEqual(changes, [[11, true], [11, false]]);
  assert.equal(watcher.isPaused(11), false);

  // While disabled, pushes are acknowledged but produce no state change.
  assert.equal(handle(pushMessage({ fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true], [11, false]]);
  assert.equal(state.sent.length, 2);

  // Re-enabling does not unpause; the heartbeat re-push re-learns state.
  watcher.setEnabled(true);
  assert.deepEqual(changes, [[11, true], [11, false]]);
  assert.equal(handle(pushMessage({ fullscreen: true })), true);
  assert.deepEqual(changes, [[11, true], [11, false], [11, true]]);
  await watcher.stop();
});

test('coordinator script path resolves under the data home', () => {
  assert.equal(
    coordinatorScriptPath({ XDG_DATA_HOME: '/custom/data' }, '/home/tester'),
    '/custom/data/kwin/scripts/mip-paper/contents/code/main.js',
  );
  assert.equal(
    coordinatorScriptPath({}, '/home/tester'),
    '/home/tester/.local/share/kwin/scripts/mip-paper/contents/code/main.js',
  );
});

test('resync restarts the coordinator script through the scripting interface', async () => {
  const calls = [];
  const bus = {
    async getProxyObject(service, pathname, xml) {
      calls.push(['proxy', service, pathname]);
      assert.match(xml, /org\.kde\.kwin\.Scripting/);
      return {
        getInterface: () => ({
          unloadScript: async (name) => { calls.push(['unload', name]); return true; },
          loadScript: async (file, name) => { calls.push(['load', file, name]); return 0; },
          start: async () => { calls.push(['start']); },
        }),
      };
    },
  };

  assert.equal(await resyncCoordinatorScript(bus, '/scripts/main.js'), true);
  assert.deepEqual(calls, [
    ['proxy', 'org.kde.KWin', '/Scripting'],
    ['unload', 'mip-paper'],
    ['load', '/scripts/main.js', 'mip-paper'],
    ['start'],
  ]);
});

test('resync logs and reports failure when the scripting interface is unavailable', async () => {
  const errors = [];
  const bus = {
    async getProxyObject() { throw new Error('bus gone'); },
  };
  assert.equal(await resyncCoordinatorScript(bus, '/scripts/main.js', (message) => errors.push(message)), false);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Coordinator resync unavailable/);
});

test('start failure logs and leaves the watcher stopped', async () => {
  const bus = {
    async requestName() { throw new Error('bus unavailable'); },
    disconnect() {},
  };
  const dbusModule = createFakeDbus(bus);
  const errors = [];
  const watcher = createFullscreenWatcher({
    dbusModule,
    getDisplays: () => DISPLAYS,
    log: (message) => errors.push(message),
  });
  await watcher.start();
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Fullscreen D-Bus service unavailable/);
  assert.equal(watcher.isPaused(11), false);
});
