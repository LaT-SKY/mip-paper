// Executes user-defined context menu commands in the main process.
//
// The renderer only sends a command id; the command string is resolved here
// from the app's own validated config, so a compromised renderer cannot
// inject shell commands. Commands come from the user's own configuration
// file, so the trust boundary is the user themselves.
//
// Two execution modes:
//   background — `sh -c` fire-and-forget (xdg-open, launching apps, scripts)
//   terminal   — run inside a terminal emulator window that stays open
//                (sudo/interactive commands where the user must see output).

import { exec, execFileSync, spawn } from 'node:child_process';

// Terminal emulator chain in preference order. The wrapped command is passed
// as a single `sh -c` argument; terminals that cannot keep the window open
// after the command exits get an interactive read suffix appended.
const TERMINALS = Object.freeze([
  Object.freeze({ name: 'konsole', args: ['--hold', '-e', 'sh', '-c'], hold: true }),
  Object.freeze({ name: 'xfce4-terminal', args: ['--hold', '-e', 'sh', '-c'], hold: true }),
  Object.freeze({ name: 'kitty', args: ['-e', 'sh', '-c'], hold: false }),
  Object.freeze({ name: 'gnome-terminal', args: ['--', 'sh', '-c'], hold: false }),
  Object.freeze({ name: 'x-terminal-emulator', args: ['-e', 'sh', '-c'], hold: false }),
  Object.freeze({ name: 'xdg-terminal-exec', args: ['sh', '-c'], hold: false }),
]);

function defaultFindExecutable(name) {
  try {
    execFileSync('command', ['-v', name], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function createMenuCommandRunner({
  execProcess = exec,
  spawnProcess = spawn,
  homedir = process.env.HOME,
  findExecutable = defaultFindExecutable,
  log = () => {},
} = {}) {
  function findTerminal() {
    for (const terminal of TERMINALS) {
      if (findExecutable(terminal.name)) return terminal;
    }
    return null;
  }

  function runBackground(command) {
    execProcess(command, { cwd: homedir }, (error) => {
      if (error) {
        log('Menu command failed (' + (error.code ?? 'error') + '): ' + command);
      }
    });
  }

  function runTerminal(command, terminal) {
    const wrapped = terminal.hold
      ? command
      : command + "\nread -n 1 -s -r -p 'Press any key to close'";
    const child = spawnProcess(terminal.name, [...terminal.args, wrapped], {
      cwd: homedir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  function run({ command, mode = 'background' }) {
    if (mode === 'terminal') {
      const terminal = findTerminal();
      if (terminal) {
        runTerminal(command, terminal);
        return;
      }
      log('No terminal emulator found; running menu command in background');
    }
    runBackground(command);
  }

  return Object.freeze({
    run,
    findTerminal,
    TERMINALS,
  });
}
