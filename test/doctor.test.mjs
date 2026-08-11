import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'mip-paper');

async function executable(pathname, contents) {
  await writeFile(pathname, contents);
  await chmod(pathname, 0o755);
}

async function fixture({
  invalidConfig = false,
  invalidCredentials = false,
  coordinator = 'valid',
  audio = 'valid',
} = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-doctor-'));
  const fakeBin = path.join(home, 'fake-bin');
  const configHome = path.join(home, '.config');
  const installRoot = path.join(home, '.local', 'lib', 'mip-paper');
  const rulesFile = path.join(configHome, 'kwinrulesrc');
  await mkdir(path.join(fakeBin), { recursive: true });
  await mkdir(path.join(installRoot, 'src'), { recursive: true });
  await mkdir(path.join(installRoot, 'scripts'), { recursive: true });
  await mkdir(path.join(installRoot, 'kwin', 'mip-paper'), { recursive: true });
  await mkdir(path.join(installRoot, 'assets'), { recursive: true });
  await mkdir(path.join(installRoot, 'node_modules', 'electron', 'dist'), { recursive: true });
  await mkdir(path.join(home, '.local', 'bin'), { recursive: true });
  await mkdir(path.join(configHome, 'mip-paper'), { recursive: true });
  await mkdir(path.join(configHome, 'systemd', 'user'), { recursive: true });
  await writeFile(path.join(installRoot, 'src', 'main.mjs'), 'export {};\n');
  await writeFile(path.join(installRoot, 'src', 'config.mjs'), "import { readFile } from 'node:fs/promises'; export async function loadConfig(pathname) { return JSON.parse(await readFile(pathname, 'utf8')); }\n");
  await writeFile(
    path.join(installRoot, 'src', 'pipewire-audio.mjs'),
    await readFile(path.join(repositoryRoot, 'src', 'pipewire-audio.mjs'), 'utf8'),
  );
  await writeFile(
    path.join(installRoot, 'scripts', 'audio-probe.mjs'),
    await readFile(path.join(repositoryRoot, 'scripts', 'audio-probe.mjs'), 'utf8'),
  );
  await executable(path.join(installRoot, 'node_modules', 'electron', 'dist', 'electron'), '#!/usr/bin/env bash\n');
  await writeFile(path.join(installRoot, 'assets', '161-2.jpeg'), Buffer.alloc(100001));
  await writeFile(path.join(installRoot, 'scripts', 'kwin-rules.sh'), '#!/usr/bin/env bash\nexit 0\n');
  await chmod(path.join(installRoot, 'scripts', 'kwin-rules.sh'), 0o755);
  const coordinatorHelper = await readFile(path.join(repositoryRoot, 'scripts', 'kwin-script.sh'), 'utf8');
  await writeFile(path.join(installRoot, 'scripts', 'kwin-script.sh'), coordinatorHelper);
  await chmod(path.join(installRoot, 'scripts', 'kwin-script.sh'), 0o755);
  if (coordinator !== 'missing') {
    await writeFile(path.join(installRoot, 'kwin', 'mip-paper', 'metadata.json'), '{}');
    await mkdir(path.join(installRoot, 'kwin', 'mip-paper', 'contents', 'code'), { recursive: true });
    await writeFile(path.join(installRoot, 'kwin', 'mip-paper', 'contents', 'code', 'main.js'), '{}');
    await mkdir(path.join(home, '.local', 'share', 'kwin', 'scripts', 'mip-paper', 'contents', 'code'), { recursive: true });
    await writeFile(path.join(home, '.local', 'share', 'kwin', 'scripts', 'mip-paper', 'metadata.json'), '{}');
    await writeFile(path.join(home, '.local', 'share', 'kwin', 'scripts', 'mip-paper', 'contents', 'code', 'main.js'), '{}');
  }
  await writeFile(path.join(configHome, 'mip-paper', 'config.json'), invalidConfig ? '{broken' : JSON.stringify({ interactionEnabled: true }));
  const credentialsPath = path.join(configHome, 'mip-paper', 'weather-credentials.json');
  await writeFile(credentialsPath, invalidCredentials ? '{}' : JSON.stringify({ apiHost: 'weather.example.com', apiKey: 'private' }), { mode: 0o600 });
  await writeFile(path.join(configHome, 'systemd', 'user', 'mip-paper.service'), '[Service]\n');
  await writeFile(path.join(configHome, 'kwinrc'), `[Plugins]\nmip-paperEnabled=${coordinator === 'valid'}\n`);
  await executable(path.join(home, '.local', 'bin', 'mip-paper'), '#!/usr/bin/env bash\n');
  await mkdir(path.dirname(rulesFile), { recursive: true });
  await writeFile(rulesFile, '[General]\ncount=1\nrules=mip-paper\n\n[mip-paper]\nDescription=Mip-Paper\n');

  await executable(path.join(fakeBin, 'plasmashell'), '#!/usr/bin/env bash\nprintf "plasmashell 6.7.4\\n"\n');
  await executable(path.join(fakeBin, 'kwin_wayland'), '#!/usr/bin/env bash\nprintf "kwin 6.7.4\\n"\n');
  await executable(path.join(fakeBin, 'pw-metadata'), `#!/bin/bash
printf '%s\n' "update: id:0 key:'default.audio.sink' value:'{\\\"name\\\":\\\"sink.test\\\"}' type:'Spa:String:JSON'"
`);
  await executable(path.join(fakeBin, 'pw-cat'), audio === 'timeout'
    ? '#!/bin/bash\nexec /bin/sleep 10\n'
    : audio === 'missing'
      ? '#!/bin/bash\nexit 127\n'
      : "#!/bin/bash\nprintf '12345678'\n");
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
      MIP_PAPER_SOURCE_ROOT: repositoryRoot,
      MIP_PAPER_INSTALL_ROOT: installRoot,
      KWIN_RULES_FILE: rulesFile,
      KWIN_RULES_NO_RELOAD: '1',
      XDG_DATA_HOME: path.join(home, '.local', 'share'),
      KWIN_CONFIG_FILE: path.join(configHome, 'kwinrc'),
      KWIN_SCRIPT_NO_RELOAD: '1',
      AUDIO_PROBE_TIMEOUT_MS: '50',
    },
  };
}

test('doctor reports automated PASS checks and explicit manual checks', async () => {
  const fixtureData = await fixture();
  try {
    const { stdout } = await execFileAsync(cli, ['doctor'], { env: fixtureData.env });
    for (const label of [
      'session', 'desktop', 'command:pw-cat', 'command:pw-metadata', 'snapshot', 'config',
      'weather-credentials', 'audio-output', 'service', 'KWin rule', 'KWin coordinator',
    ]) {
      assert.match(stdout, new RegExp(`PASS .*${label}`));
    }
    for (const label of ['window stacking', 'panel visibility', 'Alt\\+Tab', 'mouse input', 'multi-display', 'lock/suspend', 'resource usage']) {
      assert.match(stdout, new RegExp(`MANUAL .*${label}`));
    }
  } finally {
    await rm(fixtureData.home, { recursive: true, force: true });
  }
});

test('installed audio probe succeeds inside the healthy doctor fixture', async () => {
  const fixtureData = await fixture();
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(fixtureData.installRoot, 'scripts', 'audio-probe.mjs')],
      { env: fixtureData.env },
    );
    assert.deepEqual(JSON.parse(result.stdout), { status: 'available', sink: 'sink.test' });
  } finally {
    await rm(fixtureData.home, { recursive: true, force: true });
  }
});

for (const [name, audio] of [['missing command', 'missing'], ['capture timeout', 'timeout']]) {
  test(`doctor reports ${name} as unavailable audio output`, async () => {
    const fixtureData = await fixture({ audio });
    try {
      await assert.rejects(execFileAsync(cli, ['doctor'], { env: fixtureData.env }), (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /FAIL .*audio-output/);
        assert.doesNotMatch(`${error.stdout}${error.stderr}`, /12345678/);
        return true;
      });
    } finally {
      await rm(fixtureData.home, { recursive: true, force: true });
    }
  });
}

test('doctor returns non-zero for invalid weather credentials without printing values', async () => {
  const fixtureData = await fixture({ invalidCredentials: true });
  try {
    await assert.rejects(execFileAsync(cli, ['doctor'], { env: fixtureData.env }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /FAIL weather-credentials/);
      assert.doesNotMatch(error.stdout, /private|weather\.example\.com/);
      return true;
    });
  } finally {
    await rm(fixtureData.home, { recursive: true, force: true });
  }
});

test('doctor reports a missing or disabled KWin coordinator', async () => {
  const fixtureData = await fixture({ coordinator: 'missing' });
  try {
    await assert.rejects(execFileAsync(cli, ['doctor'], { env: fixtureData.env }), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /FAIL .*KWin coordinator/);
      return true;
    });
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
