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

// Terminal emulator presets, in auto-detection preference order. The wrapped
// command is passed as a single `sh -c` argument. Terminal windows close by
// default once the command finishes; terminals that cannot keep the window
// open natively get an interactive read suffix appended when autoExit is off.
// Users may pin any of these (or an unpreset terminal, which falls back to
// the generic invocation) via the `menu.terminal` config key.
const TERMINALS = Object.freeze([
  Object.freeze({ name: 'konsole', args: ['-e', 'sh', '-c'], keepOpenFlag: '--hold' }),
  Object.freeze({ name: 'xfce4-terminal', args: ['-e', 'sh', '-c'], keepOpenFlag: '--hold' }),
  Object.freeze({ name: 'kitty', args: ['-e', 'sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'gnome-terminal', args: ['--', 'sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'alacritty', args: ['-e', 'sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'wezterm', args: ['start', '--', 'sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'foot', args: ['sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'x-terminal-emulator', args: ['-e', 'sh', '-c'], keepOpenFlag: null }),
  Object.freeze({ name: 'xdg-terminal-exec', args: ['sh', '-c'], keepOpenFlag: null }),
]);

// Generic invocation for a user-configured terminal with no preset: most
// terminals accept `-e sh -c <command>`; no native keep-open flag, so the
// interactive read suffix is used when autoExit is off.
const GENERIC_TERMINAL = Object.freeze({ args: ['-e', 'sh', '-c'], keepOpenFlag: null });

const TERMINAL_BY_NAME = new Map(TERMINALS.map((terminal) => [terminal.name, terminal]));

// 'command' is a shell builtin, not an executable, so it must be run
// through a shell ('sh -c'); execFileSync('command', ...) would always fail
// with ENOENT and every terminal lookup would report "not found". The name
// comes from the hard-coded TERMINALS list; it is still passed as $1 so no
// quoting or injection concerns arise.
export function defaultFindExecutable(name) {
  try {
    execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', name], { stdio: 'ignore' });
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

  // keepOpen: autoExit === false keeps the terminal window open after the
  // command finishes (--hold where the emulator supports it, otherwise an
  // interactive read suffix). The default (autoExit) lets the terminal close
  // on its own once the command exits.
  function runTerminal(command, name, args, keepOpenFlag, keepOpen) {
    const effectiveArgs = keepOpen && keepOpenFlag ? [keepOpenFlag, ...args] : args;
    const wrapped = keepOpen && !keepOpenFlag
      ? command + "\nread -n 1 -s -r -p 'Press any key to close'"
      : command;
    const child = spawnProcess(name, [...effectiveArgs, wrapped], {
      cwd: homedir,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  }

  function run({ command, mode = 'background', terminal = '', autoExit = true }) {
    if (mode === 'terminal') {
      const keepOpen = autoExit === false;
      const requested = typeof terminal === 'string' && terminal.trim() !== ''
        ? terminal.trim()
        : null;
      if (requested) {
        if (findExecutable(requested)) {
          const preset = TERMINAL_BY_NAME.get(requested) ?? GENERIC_TERMINAL;
          runTerminal(command, requested, preset.args, preset.keepOpenFlag, keepOpen);
          return;
        }
        log('Configured terminal not found: ' + requested + '; falling back to auto-detect');
      }
      const found = findTerminal();
      if (found) {
        runTerminal(command, found.name, found.args, found.keepOpenFlag, keepOpen);
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
