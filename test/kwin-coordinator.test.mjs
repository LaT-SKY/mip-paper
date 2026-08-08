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
    resourceClass: 'animated-ocean-wallpaper',
    caption: title,
    output: currentOutput,
    captionChanged: new Signal(),
    outputChanged: new Signal(),
    closed: new Signal(),
  };
}

async function runCoordinator({ outputs, windows }) {
  const moves = [];
  const logs = [];
  const workspace = {
    screenOrder: outputs,
    windowList: () => windows,
    windowAdded: new Signal(),
    screensChanged: new Signal(),
    screenOrderChanged: new Signal(),
    sendClientToScreen(window, target) {
      moves.push([window, target]);
      window.output = target;
      window.outputChanged.emit();
    },
  };
  const source = await readFile('kwin/animated-ocean-wallpaper/contents/code/main.js', 'utf8');
  vm.runInNewContext(source, { workspace, console: { info: (line) => logs.push(line) } });
  return { workspace, moves, logs };
}

test('moves duplicate-output wallpaper windows to their declared targets', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const windows = [
    wallpaper('one', 'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960', secondary),
    wallpaper('two', 'animated-ocean-wallpaper|display=22|bounds=1536,0,1932,1087', secondary),
  ];

  const { moves } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], windows[0]);
  assert.equal(moves[0][1], primary);
});

test('does not move a correctly assigned wallpaper window', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [
    wallpaper('one', 'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960', primary),
  ];

  const { moves } = await runCoordinator({ outputs: [primary], windows });

  assert.equal(moves.length, 0);
});

test('ignores windows outside the project WM class', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const other = wallpaper('other', 'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960', null);
  other.resourceClass = 'unrelated-application';

  const { moves, logs } = await runCoordinator({ outputs: [primary], windows: [other] });

  assert.equal(moves.length, 0);
  assert.equal(logs.length, 0);
});

test('matches output geometry with a one-DIP rounding difference', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const windows = [
    wallpaper('one', 'animated-ocean-wallpaper|display=11|bounds=1,-1,1535,961', secondary),
  ];

  const { moves } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 1);
  assert.equal(moves[0][1], primary);
});

test('leaves an invalid target unresolved', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const windows = [wallpaper('one', 'animated-ocean-wallpaper', null)];

  const { moves, logs } = await runCoordinator({ outputs: [primary], windows });

  assert.equal(moves.length, 0);
  assert.match(logs.join('\n'), /result=unresolved/);
});

test('refuses a second window that declares an already claimed output', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const target = 'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960';
  const windows = [
    wallpaper('first', target, primary),
    wallpaper('duplicate', target, secondary),
  ];

  const { moves, logs } = await runCoordinator({ outputs: [primary, secondary], windows });

  assert.equal(moves.length, 0);
  assert.match(logs.join('\n'), /result=duplicate-target/);
});

test('reconciles when the declared output appears', async () => {
  const primary = output('eDP-1', { x: 0, y: 0, width: 1536, height: 960 });
  const secondary = output('HDMI-A-1', { x: 1536, y: 0, width: 1932, height: 1087 });
  const outputs = [secondary];
  const windows = [
    wallpaper('one', 'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960', secondary),
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
    wallpaper('two', 'animated-ocean-wallpaper|display=22|bounds=1536,0,1932,1087', primary),
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
    'animated-ocean-wallpaper|display=11|bounds=0,0,1536,960',
    secondary,
  );

  windows.push(added);
  workspace.windowAdded.emit(added);

  assert.equal(moves.length, 1);
  assert.equal(moves[0][0], added);
  assert.equal(moves[0][1], primary);
});
