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
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

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
  const sourceImage = path.join(home, 'source.png');
  await mkdir(fakeBin, { recursive: true });
  await mkdir(configHome, { recursive: true });
  await writeFile(rulesFile, '[General]\ncount=0\nrules=\n');
  await writeFile(systemctlLog, '');
  await writeFile(sourceImage, png);

  await writeExecutable(path.join(fakeBin, 'npm'), `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${FAKE_NPM_FAIL:-0}" == 1 ]]; then exit 42; fi
prefix=''
while (($#)); do
  if [[ "$1" == '--prefix' ]]; then prefix=$2; shift 2; else shift; fi
done
mkdir -p "$prefix/node_modules/fft.js"
printf '{"name":"fft.js","version":"4.0.4"}\n' > "$prefix/node_modules/fft.js/package.json"
`);

  await writeExecutable(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
if [[ "\${FAKE_SYSTEMCTL_FAIL_ENABLE:-0}" == 1 && "$*" == *'start mip-paper.service'* ]]; then exit 8; fi
case "$*" in
  *'is-enabled'*) exit 1 ;;
  *'is-active'*) [[ "\${FAKE_SYSTEMCTL_ACTIVE:-0}" == 1 ]] ;;
esac
exit 0
`);

  await writeExecutable(path.join(fakeBin, 'qdbus6'), `#!/usr/bin/env bash
if [[ "\${FAKE_QDBUS_FAIL:-0}" == 1 ]]; then exit 9; fi
exit 0
`);
  await writeExecutable(path.join(fakeBin, 'electron43'), '#!/usr/bin/env bash\nexit 0\n');
  await writeExecutable(path.join(fakeBin, 'plasmashell'), '#!/usr/bin/env bash\nprintf "plasmashell 6.7.4\\n"\n');
  await writeExecutable(path.join(fakeBin, 'kwin_wayland'), '#!/usr/bin/env bash\nprintf "kwin 6.7.4\\n"\n');

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
    sourceImage,
    installRoot: path.join(home, '.local', 'lib', 'mip-paper'),
    launcher: path.join(home, '.local', 'bin', 'mip-paper'),
    config: path.join(configHome, 'mip-paper', 'config.json'),
    credentials: path.join(configHome, 'mip-paper', 'weather-credentials.json'),
    service: path.join(configHome, 'systemd', 'user', 'mip-paper.service'),
    desktopEntry: path.join(home, '.local', 'share', 'applications', 'mip-paper.desktop'),
    icon: path.join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps', 'mip-paper.png'),
    kwinScript: path.join(home, '.local', 'share', 'kwin', 'scripts', 'mip-paper'),
    dataDirectory: path.join(home, '.local', 'share', 'mip-paper'),
    wallpaper: path.join(home, '.local', 'share', 'mip-paper', 'wallpaper'),
    kwinrc: path.join(configHome, 'kwinrc'),
  };
}

async function createPackagedFixture() {
  const fixture = await createFixture();
  const systemRoot = path.join(fixture.home, 'usr', 'lib', 'mip-paper');
  const systemService = path.join(fixture.home, 'usr', 'lib', 'systemd', 'user', 'mip-paper.service');
  const systemDesktop = path.join(fixture.home, 'usr', 'share', 'applications', 'mip-paper.desktop');
  const systemIcon = path.join(fixture.home, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', 'mip-paper.png');
  await mkdir(path.dirname(systemService), { recursive: true });
  await mkdir(path.dirname(systemDesktop), { recursive: true });
  await mkdir(path.dirname(systemIcon), { recursive: true });
  await writeFile(systemService, '[Service]\nExecStart=/usr/bin/electron43 /usr/lib/mip-paper\n');
  await writeFile(systemDesktop, await readFile(path.join(repositoryRoot, 'resources', 'mip-paper.desktop')));
  await writeFile(systemIcon, await readFile(path.join(repositoryRoot, 'assets', 'logo.png')));
  return {
    ...fixture,
    systemRoot,
    systemService,
    systemDesktop,
    systemIcon,
    env: {
      ...fixture.env,
      MIP_PAPER_MODE: 'packaged',
      MIP_PAPER_INSTALL_ROOT: systemRoot,
      MIP_PAPER_SERVICE_PATH: systemService,
      MIP_PAPER_DESKTOP_ENTRY_PATH: systemDesktop,
      MIP_PAPER_ICON_PATH: systemIcon,
    },
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
    assert.equal(await exists(path.join(fixture.installRoot, 'node_modules', 'electron')), false);
    assert.equal(await exists(path.join(fixture.installRoot, 'node_modules', 'fft.js', 'package.json')), true);
    assert.equal(await exists(path.join(fixture.installRoot, 'assets', 'default-wallpaper.jpg')), true);
    assert.equal(await exists(path.join(fixture.installRoot, 'assets', 'ATTRIBUTION.md')), true);
    assert.equal(await exists(fixture.launcher), true);
    assert.equal(
      await readFile(fixture.desktopEntry, 'utf8'),
      await readFile(path.join(repositoryRoot, 'resources', 'mip-paper.desktop'), 'utf8'),
    );
    assert.deepEqual(
      await readFile(fixture.icon),
      await readFile(path.join(repositoryRoot, 'assets', 'logo.png')),
    );
    assert.equal(await exists(fixture.config), true);
    assert.equal(JSON.parse(await readFile(fixture.config, 'utf8')).wallpaper.mode, 'kde');
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
      'scripts/wallpaper-image.mjs',
      'scripts/wallpaper-mode.mjs',
      'src/wallpaper-image.mjs',
      'src/plasma-wallpaper.mjs',
      'src/kde-wallpaper-sync.mjs',
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
      style: 'ribbon',
      colorMode: 'auto',
      colors: { primary: '#ff3478', complement: '#4ae9b4', neutral: '#ffffff' },
      sensitivity: 1,
      height: 104,
      position: 'bottom',
      barCount: 36,
      mirrored: true,
    });
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=true/);
    const service = await readFile(fixture.service, 'utf8');
    assert.doesNotMatch(service, new RegExp(repositoryRoot));
    assert.match(service, new RegExp(`ExecStart=${path.join(fixture.home, 'fake-bin', 'electron43')} `));
    assert.doesNotMatch(service, /node_modules\/electron/);
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
    assert.equal(await exists(fixture.desktopEntry), false);
    assert.equal(await exists(fixture.icon), false);
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
    await mkdir(path.dirname(fixture.desktopEntry), { recursive: true });
    await mkdir(path.dirname(fixture.icon), { recursive: true });
    await writeFile(fixture.desktopEntry, 'old-desktop-entry');
    await writeFile(fixture.icon, 'old-icon');
    await writeFile(fixture.kwinrc, '[Plugins]\nmip-paperEnabled=false\nother-scriptEnabled=true\n');

    await assert.rejects(
      runCli(['install', '--no-start'], fixture, { KWIN_SCRIPT_NO_RELOAD: '0', FAKE_QDBUS_FAIL: '1' }),
      (error) => error.code !== 0,
    );
    assert.equal(await readFile(path.join(fixture.kwinScript, 'metadata.json'), 'utf8'), 'old-package');
    assert.equal(await readFile(path.join(fixture.kwinScript, 'contents', 'code', 'main.js'), 'utf8'), 'old-script');
    assert.equal(await readFile(fixture.desktopEntry, 'utf8'), 'old-desktop-entry');
    assert.equal(await readFile(fixture.icon, 'utf8'), 'old-icon');
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=false/);
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /other-scriptEnabled=true/);
  } finally {
    await cleanup(fixture);
  }
});

test('install re-enables and explicitly starts the Plasma session service by default', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install', '--image', fixture.sourceImage], fixture);
    assert.equal(JSON.parse(await readFile(fixture.config, 'utf8')).wallpaper.mode, 'manual');
    const systemctlLog = await readFile(fixture.systemctlLog, 'utf8');
    assert.match(systemctlLog, /--user reenable mip-paper\.service/);
    assert.match(systemctlLog, /--user start mip-paper\.service/);
    assert.doesNotMatch(systemctlLog, /reenable --now/);
  } finally {
    await cleanup(fixture);
  }
});

test('install imports the default wallpaper before first start', async () => {
  const fixture = await createFixture();
  try {
    const { stdout } = await runCli(['install'], fixture);
    assert.deepEqual(
      await readFile(fixture.wallpaper),
      await readFile(path.join(repositoryRoot, 'assets', 'default-wallpaper.jpg')),
    );
    assert.match(await readFile(fixture.systemctlLog, 'utf8'), /--user start mip-paper\.service/);
    assert.match(stdout, /Wallpaper file:/);
    assert.match(stdout, /mip-paper wallpaper set/);
    assert.match(stdout, /Weather is not configured yet/);
    assert.match(stdout, /console\.qweather\.com/);
    assert.match(stdout, /chmod 600/);
  } finally {
    await cleanup(fixture);
  }
});

test('wallpaper set, status and failed replacement preserve the managed image', async () => {
  const fixture = await createFixture();
  try {
    const set = await runCli(['wallpaper', 'set', fixture.sourceImage], fixture, {
      FAKE_SYSTEMCTL_ACTIVE: '1',
    });
    assert.match(set.stdout, /format=png/);
    assert.deepEqual(await readFile(fixture.wallpaper), png);
    assert.match((await runCli(['wallpaper', 'status'], fixture)).stdout, /format=png/);
    assert.equal(JSON.parse(await readFile(fixture.config, 'utf8')).wallpaper.mode, 'manual');
    const log1 = await readFile(fixture.systemctlLog, 'utf8');
    assert.match(log1, /--user is-active mip-paper\.service/);
    assert.ok(!/restart mip-paper\.service/.test(log1), 'wallpaper set should hot-reload instead of restart');

    const invalid = path.join(fixture.home, 'invalid.txt');
    await writeFile(invalid, 'not an image');
    await assert.rejects(runCli(['wallpaper', 'set', invalid], fixture));
    assert.deepEqual(await readFile(fixture.wallpaper), png);
  } finally {
    await cleanup(fixture);
  }
});

test('wallpaper use-kde restores per-display synchronization mode', async () => {
  const fixture = await createFixture();
  try {
    await runCli(['install', '--no-start'], fixture);
    await runCli(['wallpaper', 'set', fixture.sourceImage], fixture);
    const { stdout } = await runCli(['wallpaper', 'use-kde'], fixture, { FAKE_SYSTEMCTL_ACTIVE: '1' });
    assert.match(stdout, /Wallpaper mode: kde/);
    assert.equal(JSON.parse(await readFile(fixture.config, 'utf8')).wallpaper.mode, 'kde');
    const log2 = await readFile(fixture.systemctlLog, 'utf8');
    assert.match(log2, /--user is-active mip-paper\.service/);
    assert.ok(!/restart mip-paper\.service/.test(log2) || /hot-reload/i.test(stdout), 'use-kde should hot-reload instead of hard restart');
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
    await runCli(['wallpaper', 'set', fixture.sourceImage], fixture);
    await runCli(['install', '--no-start'], fixture);
    await runCli(['uninstall'], fixture);
    assert.equal(await exists(fixture.installRoot), false);
    assert.equal(await exists(fixture.launcher), false);
    assert.equal(await exists(fixture.service), false);
    assert.equal(await exists(fixture.config), true);
    assert.equal(await exists(fixture.credentials), true);
    assert.equal(await exists(fixture.wallpaper), true);

    await runCli(['install', '--no-start'], fixture);
    await runCli(['uninstall', '--purge'], fixture);
    assert.equal(await exists(fixture.config), false);
    assert.equal(await exists(fixture.credentials), false);
    assert.equal(await exists(fixture.dataDirectory), false);
  } finally {
    await cleanup(fixture);
  }
});

test('packaged setup installs the coordinator into the user KWin data directory', async () => {
  const fixture = await createPackagedFixture();
  try {
    const { stdout } = await runCli(['setup', '--image', fixture.sourceImage], fixture);
    assert.deepEqual(await readFile(fixture.wallpaper), png);
    assert.equal(await exists(fixture.config), true);
    assert.equal(JSON.parse(await readFile(fixture.config, 'utf8')).wallpaper.mode, 'manual');
    assert.equal(await exists(fixture.credentials), true);
    assert.equal((await stat(fixture.credentials)).mode & 0o777, 0o600);
    assert.equal(await exists(path.join(fixture.kwinScript, 'contents', 'code', 'main.js')), true);
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=true/);
    assert.match(await readFile(fixture.systemctlLog, 'utf8'), /--user enable --now mip-paper\.service/);
    assert.match(stdout, /Imported custom wallpaper/);
    assert.match(stdout, /mip-paper wallpaper set/);
    assert.match(stdout, /Weather is not configured yet/);
  } finally {
    await cleanup(fixture);
  }
});

test('setup rejects KWin versions older than 6.7', async () => {
  const fixture = await createPackagedFixture();
  try {
    await writeExecutable(
      path.join(fixture.home, 'fake-bin', 'kwin_wayland'),
      '#!/usr/bin/env bash\nprintf "kwin 6.6.5\\n"\n',
    );
    await assert.rejects(runCli(['setup'], fixture), (error) => {
      assert.match(error.stderr, /KWin 6\.7 or newer is required.*6\.6\.5/);
      return true;
    });
  } finally {
    await cleanup(fixture);
  }
});

test('setup reports an unparseable KWin version', async () => {
  const fixture = await createPackagedFixture();
  try {
    await writeExecutable(
      path.join(fixture.home, 'fake-bin', 'kwin_wayland'),
      '#!/usr/bin/env bash\nprintf "unknown\\n"\n',
    );
    await assert.rejects(runCli(['setup'], fixture), (error) => {
      assert.match(error.stderr, /Unable to determine the KWin version/);
      return true;
    });
  } finally {
    await cleanup(fixture);
  }
});

test('packaged setup reuses an image and preserves config and credentials', async () => {
  const fixture = await createPackagedFixture();
  try {
    await runCli(['setup', '--image', fixture.sourceImage], fixture);
    const custom = '{"interactionEnabled":false}\n';
    const credentials = '{"apiHost":"example.invalid","apiKey":"private"}\n';
    await writeFile(fixture.config, custom);
    await writeFile(fixture.credentials, credentials, { mode: 0o600 });
    await runCli(['setup'], fixture);
    assert.equal(await readFile(fixture.config, 'utf8'), custom);
    assert.equal(await readFile(fixture.credentials, 'utf8'), credentials);
  } finally {
    await cleanup(fixture);
  }
});

test('packaged setup imports the default wallpaper on first start', async () => {
  const fixture = await createPackagedFixture();
  try {
    await runCli(['setup'], fixture);
    assert.deepEqual(
      await readFile(fixture.wallpaper),
      await readFile(path.join(repositoryRoot, 'assets', 'default-wallpaper.jpg')),
    );
    assert.match(await readFile(fixture.systemctlLog, 'utf8'), /enable --now/);
  } finally {
    await cleanup(fixture);
  }
});

test('packaged teardown preserves user data and purge removes exact app directories', async () => {
  const fixture = await createPackagedFixture();
  try {
    await runCli(['setup', '--image', fixture.sourceImage], fixture);
    await runCli(['teardown'], fixture);
    assert.equal(await exists(fixture.config), true);
    assert.equal(await exists(fixture.credentials), true);
    assert.equal(await exists(fixture.wallpaper), true);
    assert.equal(await exists(fixture.kwinScript), false);
    assert.match(await readFile(fixture.kwinrc, 'utf8'), /mip-paperEnabled=false/);

    await runCli(['setup'], fixture);
    await runCli(['teardown', '--purge'], fixture);
    assert.equal(await exists(path.dirname(fixture.config)), false);
    assert.equal(await exists(fixture.dataDirectory), false);
  } finally {
    await cleanup(fixture);
  }
});

test('packaged mode refuses commands that mutate pacman-owned files', async () => {
  const fixture = await createPackagedFixture();
  try {
    for (const command of ['install', 'uninstall']) {
      await assert.rejects(runCli([command], fixture), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /managed by pacman/);
        return true;
      });
    }
  } finally {
    await cleanup(fixture);
  }
});
