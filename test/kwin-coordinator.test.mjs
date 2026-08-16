import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

class Signal {
  handlers = [];

  connect(handler) {
    this.handlers.push(handler);
  }

  emit(...args) {
    for (const handler of this.handlers) handler(...args);
  }
}

function output(name, geometry) {
  return { name, geometry };
}

function wallpaper(id, title, currentOutput) {
  return {
    internalId: id,
    resourceClass: 'mip-paper',
    caption: title,
    output: currentOutput,
    frameGeometry: null,
    noBorder: false,
    fullScreen: false,
    captionChanged: new Signal(),
    fullScreenChanged: new Signal(),
    outputChanged: new Signal(),
    closed: new Signal(),
  };
}

function appWindow(id, currentOutput, fullScreen = false) {
  return {
    internalId: id,
    resourceClass: 'unrelated-application',
    caption: 'Some App',
    output: currentOutput,
    fullScreen,
    fullScreenChanged: new Signal(),
    outputChanged: new Signal(),
    closed: new Signal(),
  };
}

async function runCoordinator({ outputs, windows }) {
  const moves = [];
  const raises = [];
  const logs = [];
  const workspace = {
    screenOrder: outputs,
    windowList: () => windows,
    windowAdded: new Signal(),
    windowRemoved: new Signal(),
    screensChanged: new Signal(),
    screenOrderChanged: new Signal(),
    sendClientToScreen(window, target) {
      moves.push([window, target]);
      window.output = target;
      window.outputChanged.emit();
    },
    raiseWindow(window) { raises.push(window); },
  };
  const dbusCalls = [];
  const dbusCallbacks = [];
  const intervals = [];
  const context = {
    workspace,
    console: { info: (line) => logs.push(line) },
    callDBus(...args) {
      dbusCalls.push(args);
      const callback = args[args.length - 1];
      if (typeof callback === 'function') dbusCallbacks.push(callback);
    },
    setInterval(fn, ms) {
      intervals.push({ fn, ms });
      return intervals.length;
    },
  };
  const source = await readFile('kwin/mip-paper/contents/code/main.js', 'utf8');
  vm.runInNewContext(source, context);
  return { workspace, moves, raises, logs, dbusCalls, dbusCallbacks, intervals };
}

function pushArgs(call) {
  return {
    service: call[0],
    path: call[1],
    interface: call[2],
    method: call[3],
    output: call[4],
    x: call[5],
    y: call[6],
    width: call[7],
    height: call[8],
    fullscreen: call[9],
  };
}

function singlePush(result) {
  assert.equal(result.dbusCalls.length, 1);
  return pushArgs(result.dbusCalls[0]);
}

test('moves duplicate-output wallpaper windows to their declared targets', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const windows = [
    wallpaper('one', 'mip-paper|display=11|bounds=0,0,1536,960', secondary),
    wallpaper('two', 'mip-paper|display=22|bounds=1536,0,1932,1087', secondary),
  ];

  const { moves, raises } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], windows[0]);
  assert.equal(moves[0][1], primary);
  assert.equal(JSON.stringify(windows[0].frameGeometry), JSON.stringify(primary.geometry));
  assert.equal(windows[0].noBorder, true);
  assert.deepEqual(raises, [windows[1]]);
});

test('does not move a correctly assigned wallpaper window', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [
    wallpaper('one', 'mip-paper|display=11|bounds=0,0,1536,960', primary),
  ];

  const { moves } = await runCoordinator({ outputs: [primary], windows });

  assert.equal(moves.length, 0);
});

test('pins wallpaper geometry to the declared output and removes client borders', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [
    wallpaper('one', 'mip-paper|display=11|bounds=0,0,1536,960', primary),
  ];

  await runCoordinator({ outputs: [primary], windows });

  assert.equal(JSON.stringify(windows[0].frameGeometry), JSON.stringify(primary.geometry));
  assert.equal(windows[0].noBorder, true);
});

test('ignores windows outside the project WM class', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const other = wallpaper('other', 'mip-paper|display=11|bounds=0,0,1536,960', null);
  other.resourceClass = 'unrelated-application';

  const { moves, logs } = await runCoordinator({ outputs: [primary], windows: [other] });

  assert.equal(moves.length, 0);
  assert.equal(logs.length, 0);
});

test('matches output geometry with a one-DIP rounding difference', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const windows = [
    wallpaper('one', 'mip-paper|display=11|bounds=1,-1,1535,961', secondary),
  ];

  const { moves } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 1);
  assert.equal(moves[0][1], primary);
});

test('leaves an invalid target unresolved', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [wallpaper('one', 'mip-paper', null)];

  const { moves, logs } = await runCoordinator({ outputs: [primary], windows });

  assert.equal(moves.length, 0);
  assert.match(logs.join('\n'), /result=unresolved/);
});

test('refuses a second window that declares an already claimed output', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const target = 'mip-paper|display=11|bounds=0,0,1536,960';
  const windows = [
    wallpaper('first', target, primary),
    wallpaper('duplicate', target, secondary),
  ];

  const { moves, logs } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 0);
  assert.match(logs.join('\n'), /result=duplicate-target/);
});

test('reassigns a duplicate target when the previous claimant closes', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const target = 'mip-paper|display=22|bounds=1536,0,1932,1087';
  const previous = wallpaper('previous', target, secondary);
  const replacement = wallpaper('replacement', target, primary);
  const windows = [previous, replacement];
  const { moves } = await runCoordinator({ outputs: [primary, secondary], windows });

  previous.closed.emit();

  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], replacement);
  assert.equal(moves[0][1], secondary);
});

test('reconciles when the declared output appears', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const outputs = [secondary];
  const windows = [
    wallpaper('one', 'mip-paper|display=11|bounds=0,0,1536,960', secondary),
  ];
  const { workspace, moves } = await runCoordinator({ outputs, windows });

  outputs.unshift(primary);
  workspace.screensChanged.emit();

  assert.equal(moves.length, 1);
  assert.equal(moves[0][1], primary);
});

test('reconciles when screen order changes', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const outputs = [primary];
  const windows = [
    wallpaper('two', 'mip-paper|display=22|bounds=1536,0,1932,1087', primary),
  ];
  const { workspace, moves } = await runCoordinator({ outputs, windows });

  outputs.push(secondary);
  workspace.screenOrderChanged.emit();

  assert.equal(moves.length, 1);
  assert.equal(moves[0][1], secondary);
});

test('tracks and reconciles a newly added wallpaper window once', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const windows = [];
  const { workspace, moves } = await runCoordinator({ outputs: [primary, secondary], windows });
  const added = wallpaper(
    'added',
    'mip-paper|display=11|bounds=0,0,1536,960',
    secondary,
  );

  windows.push(added);
  workspace.windowAdded.emit(added);

  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], added);
  assert.equal(moves[0][1], primary);
});

test('pushes fullscreen state with output geometry on startup', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const fullscreen = appWindow('video', primary, true);
  const result = await runCoordinator({ outputs: [primary], windows: [fullscreen] });

  const push = singlePush(result);
  assert.equal(push.service, 'org.mip.Paper');
  assert.equal(push.path, '/Fullscreen');
  assert.equal(push.interface, 'org.mip.Paper.Fullscreen');
  assert.equal(push.method, 'SetOutputFullscreen');
  assert.equal(push.output, 'eDP-1');
  assert.equal(push.x, 0);
  assert.equal(push.y, 0);
  assert.equal(push.width, 1536);
  assert.equal(push.height, 960);
  assert.equal(push.fullscreen, true);
});

test('never pauses for the mip-paper windows themselves', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const own = wallpaper('own', 'mip-paper|display=11|bounds=0,0,1536,960', primary);
  own.fullScreen = true;
  const result = await runCoordinator({ outputs: [primary], windows: [own] });

  assert.equal(result.dbusCalls.length, 1);
  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, false);
});

test('pushes toggles when a window enters and leaves fullscreen', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const video = appWindow('video', primary, false);
  const result = await runCoordinator({ outputs: [primary], windows: [video] });
  result.dbusCalls.length = 0;

  video.fullScreen = true;
  video.fullScreenChanged.emit();
  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, true);

  video.fullScreen = false;
  video.fullScreenChanged.emit();
  assert.equal(pushArgs(result.dbusCalls[1]).fullscreen, false);
});

test('pushes unpause when a fullscreen window closes and leaves the list', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const video = appWindow('video', primary, true);
  const windows = [video];
  const result = await runCoordinator({ outputs: [primary], windows });
  result.dbusCalls.length = 0;

  video.closed.emit();
  windows.length = 0;
  result.workspace.windowRemoved.emit(video);

  assert.equal(result.dbusCalls.length, 1);
  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, false);
});

test('pushes when a fullscreen window is added to the workspace', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [];
  const result = await runCoordinator({ outputs: [primary], windows });
  result.dbusCalls.length = 0;
  const video = appWindow('video', primary, true);

  windows.push(video);
  result.workspace.windowAdded.emit(video);

  assert.equal(result.dbusCalls.length, 1);
  assert.equal(pushArgs(result.dbusCalls[0]).fullscreen, true);
});

test('pushes per-output state when a fullscreen window changes outputs', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const video = appWindow('video', primary, true);
  const result = await runCoordinator({ outputs: [primary, secondary], windows: [video] });
  result.dbusCalls.length = 0;

  video.output = secondary;
  video.outputChanged.emit();

  const pushes = result.dbusCalls.map(pushArgs);
  assert.equal(pushes.find((p) => p.output === 'eDP-1').fullscreen, false);
  assert.equal(pushes.find((p) => p.output === 'HDMI-A-1').fullscreen, true);
});

test('registers a heartbeat that force re-pushes unchanged state', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const video = appWindow('video', primary, true);
  const result = await runCoordinator({ outputs: [primary], windows: [video] });

  assert.equal(result.intervals.length, 1);
  assert.equal(result.intervals[0].ms, 5000);
  assert.equal(result.dbusCalls.length, 1);

  result.intervals[0].fn();

  assert.equal(result.dbusCalls.length, 2);
  assert.equal(pushArgs(result.dbusCalls[1]).fullscreen, true);
});

test('logs callDBus failures only for change-driven pushes', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const video = appWindow('video', primary, true);
  const result = await runCoordinator({ outputs: [primary], windows: [video] });

  result.dbusCallbacks[0]('No such service');

  assert.match(result.logs.join('\n'), /fullscreen-push-error output=eDP-1 fullscreen=true error=No such service/);
});
