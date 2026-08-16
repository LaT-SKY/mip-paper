import assert from 'node:assert/strict';
import test from 'node:test';

import { createMenuCommandRunner } from '../src/menu-command.mjs';

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

test('terminal mode prefers konsole with --hold and does not wrap the command', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    homedir: '/home/tester',
    findExecutable: (name) => name === 'konsole',
  });
  runner.run({ command: 'sudo pacman -Syu', mode: 'terminal' });
  assert.equal(exec.calls.length, 0);
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'konsole');
  assert.deepEqual(spawn.calls[0].args, ['--hold', '-e', 'sh', '-c', 'sudo pacman -Syu']);
  assert.equal(spawn.calls[0].options.detached, true);
  assert.equal(spawn.calls[0].options.stdio, 'ignore');
  assert.equal(spawn.calls[0].unrefCalled, true);
});

test('terminal mode walks the fallback chain and wraps non-hold terminals', () => {
  const exec = fakeExec();
  const spawn = fakeSpawn();
  const available = new Set(['kitty']);
  const runner = createMenuCommandRunner({
    execProcess: exec.execProcess,
    spawnProcess: spawn.spawnProcess,
    findExecutable: (name) => available.has(name),
  });
  runner.run({ command: 'htop', mode: 'terminal' });
  assert.equal(spawn.calls.length, 1);
  assert.equal(spawn.calls[0].name, 'kitty');
  assert.match(spawn.calls[0].args[3], /^htop\nread -n 1 -s -r -p 'Press any key to close'/);
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

test('findTerminal returns the first available emulator in preference order', () => {
  const available = new Set(['gnome-terminal', 'xdg-terminal-exec']);
  const runner = createMenuCommandRunner({
    findExecutable: (name) => available.has(name),
  });
  assert.equal(runner.findTerminal().name, 'gnome-terminal');
  const none = createMenuCommandRunner({ findExecutable: () => false });
  assert.equal(none.findTerminal(), null);
});
