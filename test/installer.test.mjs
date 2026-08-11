import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'mip-paper');

async function exists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function writeExecutable(pathname, contents) {
  await writeFile(pathname, contents);
  await chmod(pathname, 0o755);
}

async function createFixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-installer-'));
  const fakeBin = path.join(home, 'fake-bin');
  const configHome = path.join(home, '.config');
  const rulesFile = path.join(configHome, 'kwinrulesrc');
  const systemctlLog = path.join(home, 'systemctl.log');
  await mkdir(fakeBin, { recursive: true });
  await mkdir(configHome, { recursive: true });
  await writeFile(rulesFile, '[General]\ncount=0\nrules=\n');
  await writeFile(systemctlLog, '');

  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_NPM_FAIL:-0}" == 1 ]]; then exit 42; fi
prefix=''
while (($#)); do
  if [[ "$1" == '--prefix' ]]; then prefix=$2; shift 2; else shift; fi
done
mkdir -p "$prefix/node_modules/electron/dist" "$prefix/node_modules/fft.js" "$prefix/node_modules/.bin"
printf '{"name":"electron","version":"43.3.0"}\n' > "$prefix/node_modules/electron/package.json"
printf '{"name":"fft.js","version":"4.0.4"}\n' > "$prefix/node_modules/fft.js/package.json"
printf "module.exports = require('path').join(__dirname, 'dist', 'electron');\n" > "$prefix/node_modules/electron/index.js"
printf '#!/usr/bin/env bash\nexit 0\n' > "$prefix/node_modules/.bin/electron"
cp "$prefix/node_modules/.bin/electron" "$prefix/node_modules/electron/dist/electron"
chmod +x "$prefix/node_modules/.bin/electron" "$prefix/node_modules/electron/dist/electron"
`);

  await writeExecutable(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
if [[ "\${FAKE_SYSTEMCTL_FAIL_ENABLE:-0}" == 1 && "$*" == *'reenable --now'* ]]; then exit 8; fi
case "$*" in
  *'is-enabled'*) exit 1 ;;
  *'is-active'*) exit 1 ;;
esac
exit 0
`);

  await writeExecutable(path.join(fakeBin, 'qdbus6'), `#!/usr/bin/env bash
if [[ "\${FAKE_QDBUS_FAIL:-0}" == 1 ]]; then exit 9; fi
exit 0
`);

  const env = {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: configHome,
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'KDE',
    PATH: `${fakeBin}:${process.env.PATH}`,
    SYSTEMCTL_LOG: systemctlLog,
    KWIN_RULES_FILE: rulesFile,
    KWIN_RULES_NO_RELOAD: '1',
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    KWIN_CONFIG_FILE: path.join(configHome, 'kwinrc'),
    KWIN_SCRIPT_NO_RELOAD: '1',
    MIP_PAPER_SOURCE_ROOT: repositoryRoot,
  };

  return {
    home,
    env,
    rulesFile,
    systemctlLog,
    installRoot: path.join(home, '.local', 'lib', 'mip-paper'),
    launcher: path.join(home, '.local', 'bin', 'mip-paper'),
    config: path.join(configHome, 'mip-paper', 'config.json'),
    credentials: path.join(configHome, 'mip-paper', 'weather-credentials.json'),
    service: path.join(configHome, 'systemd', 'user', 'mip-paper.service'),
    kwinScript: path.join(home, '.local', 'share', 'kwin', 'scripts', 'mip-paper'),
    kwinrc: path.join(configHome, 'kwinrc'),
  };
}

async function runCli(arguments_, fixture, extraEnv = {}) {
  return execFileAsync(cli, arguments_, {
    env: { ...fixture.env, ...extraEnv },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function cleanup(fixture) {
  await rm(fixture.home, { recursive: true, force: true });
}

test('install --no-start creates a relocatable snapshot without enabling the service', async () => {
  const fixture = await createFixture();
  try {
    const { stdout } = await runCli(['install', '--no-start'], fixture);
    assert.match(stdout, /Installation complete/);
    assert.equal(await exists(path.join(fixture.installRoot, 'src', 'main.mjs')), true);
    assert.equal(await exists(path.join(fixture.installRoot, 'node_modules', 'electron', 'package.json')), true);
    assert.equal(await exists(path.join(fixture.installRoot, 'node_modules', 'electron', 'dist', 'electron')), true);
    assert.equal(await exists(path.join(fixture.installRoot, 'node_modules', 'fft.js', 'package.json')), true);
    assert.equal(await exists(fixture.launcher), true);
    assert.equal(await exists(fixture.config), true);
    assert.equal(await exists(fixture.credentials), true);
    assert.equal((await stat(fixture.credentials)).mode & 0o777, 0o600);
    assert.equal(await exists(fixture.service), true);
    assert.equal(await exists(path.join(fixture.kwinScript, 'contents', 'code', 'main.js')), true);
    for (const pathname of [
      'src/audio-pcm.mjs',
      'src/audio-analyzer.mjs',
      'src/pipewire-audio.mjs',
      'src/audio-spectrum-service.mjs',
      'src/config-watcher.mjs',
      'src/renderer/audio-ribbon.mjs',
      'scripts/audio-probe.mjs',
    ]) {
      assert.equal(await exists(path.join(fixture.installRoot, pathname)), true, `missing ${pathname}`);
    }
    const installedConfig = JSON.parse(await readFile(fixture.config, 'utf8'));
    assert.deepEqual(installedConfig.audio, {
      enabled: true,
      gain: 1,
      silenceDelayMs: 600,
      fadeOutMs: 450,
      fadeInMs: 160,
    });
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=true/);
    const service = await readFile(fixture.service, 'utf8');
    assert.doesNotMatch(service, new RegExp(repositoryRoot));
    assert.match(service, /ExecStart=.*\/node_modules\/electron\/dist\/electron /);
    assert.doesNotMatch(service, /node_modules\/\.bin\/electron/);
    assert.match(service, /After=plasma-workspace\.target/);
    assert.match(service, /PartOf=graphical-session\.target/);
    assert.match(service, /WantedBy=plasma-workspace\.target/);
    assert.doesNotMatch(service, /WantedBy=default\.target/);
    assert.doesNotMatch(service, /KillSignal=/);
    assert.match(service, /KillMode=mixed/);
    assert.doesNotMatch(await readFile(fixture.systemctlLog, 'utf8'), /(?:enable|reenable) --now/);
  } finally {
    await cleanup(fixture);
  }
});

test('uninstall removes only the project KWin package', async () => {
  const fixture = await createFixture();
  try {
    const unrelated = path.join(fixture.home, '.local', 'share', 'kwin', 'scripts', 'unrelated', 'keep');
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(unrelated, 'keep');
    await runCli(['install', '--no-start'], fixture);
    await runCli(['uninstall'], fixture);
    assert.equal(await exists(fixture.kwinScript), false);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=false/);
  } finally {
    await cleanup(fixture);
  }
});

test('failed KWin activation restores the prior package and enabled state', async () => {
  const fixture = await createFixture();
  try {
    await mkdir(path.join(fixture.kwinScript, 'contents', 'code'), { recursive: true });
    await writeFile(path.join(fixture.kwinScript, 'metadata.json'), 'old-package');
    await writeFile(path.join(fixture.kwinScript, 'contents', 'code', 'main.js'), 'old-script');
    await writeFile(fixture.kwinrc, '[Plugins]\nmip-paperEnabled=false\nother-scriptEnabled=true\n');

    await assert.rejects(
      runCli(['install', '--no-start'], fixture, { KWIN_SCRIPT_NO_RELOAD: '0', FAKE_QDBUS_FAIL: '1' }),
      (error) => error.code !== 0,
    );
    assert.equal(await readFile(path.join(fixture.kwinScript, 'metadata.json'), 'utf8'), 'old-package');
    assert.equal(await readFile(path.join(fixture.kwinScript, 'contents', 'code', 'main.js'), 'utf8'), 'old-script');
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=false/);
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /other-scriptEnabled=true/);
  } finally {
    await cleanup(fixture);
  }
});

test('install re-enables and starts the Plasma session service by default', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install'], fixture);
    assert.match(
      await readFile(fixture.systemctlLog, 'utf8'),
      /--user reenable --now mip-paper\.service/,
    );
  } finally {
    await cleanup(fixture);
  }
});

test('repeated install preserves the existing user configuration', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install', '--no-start'], fixture);
    const custom = '{"interactionEnabled":false,"frameRate":{"interactive":75}}\n';
    await writeFile(fixture.config, custom);
    const credentials = '{"apiHost":"example.invalid","apiKey":"private"}\n';
    await writeFile(fixture.credentials, credentials, { mode: 0o600 });
    await runCli(['install', '--no-start'], fixture);
    assert.equal(await readFile(fixture.config, 'utf8'), custom);
    assert.equal(await readFile(fixture.credentials, 'utf8'), credentials);
  } finally {
    await cleanup(fixture);
  }
});

test('failed dependency staging leaves the installed snapshot unchanged', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install', '--no-start'], fixture);
    const marker = path.join(fixture.installRoot, 'old-version-marker');
    await writeFile(marker, 'keep');
    await assert.rejects(runCli(['install', '--no-start'], fixture, { FAKE_NPM_FAIL: '1' }), (error) => {
      assert.equal(error.code, 42);
      return true;
    });
    assert.equal(await readFile(marker, 'utf8'), 'keep');
  } finally {
    await cleanup(fixture);
  }
});

test('service lifecycle commands are forwarded to the user service', async () => {
  const fixture = await createFixture();
  try {
    for (const command of ['start', 'stop', 'restart', 'status']) {
      await runCli([command], fixture);
    }
    const log = await readFile(fixture.systemctlLog, 'utf8');
    for (const command of ['start', 'stop', 'restart', 'status']) {
      assert.match(log, new RegExp(`--user ${command} mip-paper\\.service`));
    }
  } finally {
    await cleanup(fixture);
  }
});

test('start confirms that the background wallpaper service was requested', async () => {
  const fixture = await createFixture();
  try {
    const { stdout } = await runCli(['start'], fixture);
    assert.match(stdout, /Wallpaper service start requested/);
  } finally {
    await cleanup(fixture);
  }
});

test('normal uninstall preserves config and purge removes it', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install', '--no-start'], fixture);
    await runCli(['uninstall'], fixture);
    assert.equal(await exists(fixture.installRoot), false);
    assert.equal(await exists(fixture.launcher), false);
    assert.equal(await exists(fixture.service), false);
    assert.equal(await exists(fixture.config), true);
    assert.equal(await exists(fixture.credentials), true);

    await runCli(['install', '--no-start'], fixture);
    await runCli(['uninstall', '--purge'], fixture);
    assert.equal(await exists(fixture.config), false);
    assert.equal(await exists(fixture.credentials), false);
  } finally {
    await cleanup(fixture);
  }
});
