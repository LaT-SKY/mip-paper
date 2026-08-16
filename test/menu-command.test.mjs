import assert from 'node:assert/strict';
import test from 'node:test';

import { createMenuCommandRunner, defaultFindExecutable } from '../src/menu-command.mjs';

function fakeExec() {
  const calls = [];
  const execProcess = (command, options, callback) => {
    calls.push({ command, options, callback });
  };
  return { calls, execProcess };
}

function fakeSpawn() {
  const calls = [];
  const children = [];
  const spawnProcess = (name, args, options) => {
    const child = { name, args, options, unrefCalled: false, unref() { this.unrefCalled = true; } };
    calls.push(child);
    children.push(child);
    return child;
  };
  return { calls, children, spawnProcess };
}

test('background mode executes the command via sh -c semantics and logs failures', () => {
  const exec = fakeExec();
  const logged = [];
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    homedir: '/home/tester',
    findExecutable: () => false,
    log: (message) => logged.push(message),
  });
  runner.run({ command: 'xdg-open ~/Downloads', mode: 'background' });
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].command, 'xdg-open ~/Downloads');
  assert.equal(exec.calls[0].options.cwd, '/home/tester');
  assert.equal(typeof exec.calls[0].callback, 'function');
  exec.calls[0].callback(new Error('boom'));
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Menu command failed/);
});

test('background is the default mode when mode is omitted', () => {
  const exec = fakeExec();
  const runner = createMenuCommandRunner({ execProcess: exec.execProcess, findExecutable: () => false });
  runner.run({ command: 'echo hi' });
  assert.equal(exec.calls.length, 1);
});

test('terminal mode exits the terminal when the command finishes by default', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'konsole',
  });
  // autoExit defaults to true: no --hold flag and no read suffix, so konsole
  // closes on its own once the command exits.
  runner.run({ command: 'sudo pacman -Syu', mode: 'terminal' });
  assert.equal(exec.calls.length, 0);
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'konsole');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'sudo pacman -Syu']);
  assert.equal(spawn.calls[0].options.detached, true);
  assert.equal(spawn.calls[0].options.stdio, 'ignore');
  assert.equal(spawn.calls[0].unrefCalled, true);
});

test('terminal mode keeps the window open when autoExit is disabled', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'konsole',
  });
  runner.run({ command: 'sudo pacman -Syu', mode: 'terminal', autoExit: false });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'konsole');
  // Native keep-open flag for konsole; the command stays unwrapped.
  assert.deepEqual(spawn.calls[0].args, ['--hold', '-e', 'sh', '-c', 'sudo pacman -Syu']);
});

test('terminal mode walks the fallback chain and wraps only when keeping open', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const available = new Set(['kitty']);
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    findExecutable: (name) => available.has(name),
  });
  // Default autoExit: kitty closes by itself, so the command is not wrapped.
  runner.run({ command: 'htop', mode: 'terminal' });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'kitty');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'htop']);
  // autoExit off: no native keep-open flag, so an interactive read suffix is
  // appended to keep the window visible.
  spawn.calls.length = 0;
  runner.run({ command: 'htop', mode: 'terminal', autoExit: false });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'kitty');
  assert.deepEqual(spawn.calls[0].args.slice(0, 3), ['-e', 'sh', '-c']);
  assert.match(spawn.calls[0].args[3], /^htop\nread -n 1 -s -r -p 'Press any key to close'/);
});

test('terminal mode uses the configured terminal when installed', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'alacritty',
  });
  runner.run({ command: 'htop', mode: 'terminal', terminal: 'alacritty' });
  assert.equal(exec.calls.length, 0);
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'alacritty');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'htop']);
});

test('terminal mode uses the generic invocation for an installed unpreset terminal', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'my-cool-term',
  });
  runner.run({ command: 'htop', mode: 'terminal', terminal: 'my-cool-term' });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'my-cool-term');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'htop']);
});

test('terminal mode falls back to auto-detect when the configured terminal is missing', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const logged = [];
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'konsole',
    log: (message) => logged.push(message),
  });
  runner.run({ command: 'htop', mode: 'terminal', terminal: 'missing-term' });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'konsole');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'htop']);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /Configured terminal not found/);
});

test('terminal mode ignores a blank configured terminal and auto-detects', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'konsole',
  });
  runner.run({ command: 'htop', mode: 'terminal', terminal: '   ' });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'konsole');
  assert.deepEqual(spawn.calls[0].args, ['-e', 'sh', '-c', 'htop']);
});

test('terminal mode falls back to background when no emulator exists', () => {
  const exec = fakeExec();
  const logged = [];
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    findExecutable: () => false,
    log: (message) => logged.push(message),
  });
  runner.run({ command: 'echo fallback', mode: 'terminal' });
  assert.equal(exec.calls.length, 1);
  assert.equal(exec.calls[0].command, 'echo fallback');
  assert.equal(logged.length, 1);
  assert.match(logged[0], /No terminal emulator found/);
});

test('defaultFindExecutable resolves real executables through a shell', () => {
  // 'command' is a shell builtin, not an executable; the lookup must go
  // through 'sh -c' or every terminal would report "not found".
  assert.equal(defaultFindExecutable('sh'), true);
  assert.equal(defaultFindExecutable('definitely-not-a-real-binary-mip-paper'), false);
});

test('findTerminal returns the first available emulator in preference order', () => {
  const available = new Set(['gnome-terminal', 'xdg-terminal-exec']);
  const runner = createMenuCommandRunner({
    findExecutable: (name) => available.has(name),
  });
  assert.equal(runner.findTerminal().name, 'gnome-terminal');
  const none = createMenuCommandRunner({ findExecutable: () => false });
  assert.equal(none.findTerminal(), null);
});
