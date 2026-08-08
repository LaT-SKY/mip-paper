import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'animated-ocean-wallpaper');

async function executable(pathname, contents) {
  await writeFile(pathname, contents);
  await chmod(pathname, 0o755);
}

async function fixture({ invalidConfig = false } = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-doctor-'));
  const fakeBin = path.join(home, 'fake-bin');
  const configHome = path.join(home, '.config');
  const installRoot = path.join(home, '.local', 'lib', 'animated-ocean-wallpaper');
  const rulesFile = path.join(configHome, 'kwinrulesrc');
  await mkdir(path.join(fakeBin), { recursive: true });
  await mkdir(path.join(installRoot, 'src'), { recursive: true });
  await mkdir(path.join(installRoot, 'scripts'), { recursive: true });
  await mkdir(path.join(installRoot, 'assets'), { recursive: true });
  await mkdir(path.join(installRoot, 'node_modules', 'electron', 'dist'), { recursive: true });
  await mkdir(path.join(home, '.local', 'bin'), { recursive: true });
  await mkdir(path.join(configHome, 'animated-ocean-wallpaper'), { recursive: true });
  await mkdir(path.join(configHome, 'systemd', 'user'), { recursive: true });
  await writeFile(path.join(installRoot, 'src', 'main.mjs'), 'export {};\n');
  await writeFile(path.join(installRoot, 'src', 'config.mjs'), "import { readFile } from 'node:fs/promises'; export async function loadConfig(pathname) { return JSON.parse(await readFile(pathname, 'utf8')); }\n");
  await executable(path.join(installRoot, 'node_modules', 'electron', 'dist', 'electron'), '#!/usr/bin/env bash\n');
  await writeFile(path.join(installRoot, 'assets', '161-2.jpeg'), Buffer.alloc(100001));
  await writeFile(path.join(installRoot, 'scripts', 'kwin-rules.sh'), '#!/usr/bin/env bash\nexit 0\n');
  await chmod(path.join(installRoot, 'scripts', 'kwin-rules.sh'), 0o755);
  await writeFile(path.join(configHome, 'animated-ocean-wallpaper', 'config.json'), invalidConfig ? '{broken' : JSON.stringify({ interactionEnabled: true }));
  await writeFile(path.join(configHome, 'systemd', 'user', 'animated-ocean-wallpaper.service'), '[Service]\n');
  await executable(path.join(home, '.local', 'bin', 'animated-ocean-wallpaper'), '#!/usr/bin/env bash\n');
  await mkdir(path.dirname(rulesFile), { recursive: true });
  await writeFile(rulesFile, '[General]\ncount=1\nrules=animated-ocean-wallpaper\n\n[animated-ocean-wallpaper]\nDescription=Animated Ocean Wallpaper\n');

  await executable(path.join(fakeBin, 'plasmashell'), '#!/usr/bin/env bash\nprintf "plasmashell 6.7.4\\n"\n');
  await executable(path.join(fakeBin, 'kwin_wayland'), '#!/usr/bin/env bash\nprintf "kwin 6.7.4\\n"\n');
  await executable(path.join(fakeBin, 'systemctl'), `#!/usr/bin/env bash
case "$*" in
  *'is-enabled'*) printf 'enabled\\n'; exit 0 ;;
  *'is-active'*) printf 'active\\n'; exit 0 ;;
  *'show-environment'*) exit 0 ;;
esac
exit 0
`);

  return {
    home,
    installRoot,
    rulesFile,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fakeBin}:${process.env.PATH}`,
      XDG_CONFIG_HOME: configHome,
      XDG_CURRENT_DESKTOP: 'KDE',
      XDG_SESSION_TYPE: 'wayland',
      ANIMATED_WALLPAPER_SOURCE_ROOT: repositoryRoot,
      ANIMATED_WALLPAPER_INSTALL_ROOT: installRoot,
      KWIN_RULES_FILE: rulesFile,
      KWIN_RULES_NO_RELOAD: '1',
    },
  };
}

test('doctor reports automated PASS checks and explicit manual checks', async () => {
  const fixtureData = await fixture();
  try {
    const { stdout } = await execFileAsync(cli, ['doctor'], { env: fixtureData.env });
    for (const label of ['session', 'desktop', 'snapshot', 'config', 'service', 'KWin rule']) {
      assert.match(stdout, new RegExp(`PASS .*${label}`));
    }
    for (const label of ['window stacking', 'panel visibility', 'Alt\\+Tab', 'mouse input', 'multi-display', 'lock/suspend', 'resource usage']) {
      assert.match(stdout, new RegExp(`MANUAL .*${label}`));
    }
  } finally {
    await rm(fixtureData.home, { recursive: true, force: true });
  }
});

test('doctor returns non-zero and identifies invalid config', async () => {
  const fixtureData = await fixture({ invalidConfig: true });
  try {
    await assert.rejects(execFileAsync(cli, ['doctor'], { env: fixtureData.env }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /FAIL config/);
      return true;
    });
  } finally {
    await rm(fixtureData.home, { recursive: true, force: true });
  }
});
