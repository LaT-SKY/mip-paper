import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

test('uses the Mip-Paper package and runtime identity', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const main = await readFile('src/main.mjs', 'utf8');
  const pipewire = await readFile('src/pipewire-audio.mjs', 'utf8');
  const renderer = await readFile('src/renderer/index.html', 'utf8');

  assert.equal(packageJson.name, 'mip-paper');
  assert.match(main, /app\.setName\('Mip-Paper'\)/);
  assert.match(pipewire, /"node\.name":"mip-paper-spectrum"/);
  assert.match(renderer, /<title>Mip-Paper<\/title>/);
});

test('uses one mip-paper identity across Electron and KWin', async () => {
  await access('kwin/mip-paper/metadata.json');
  const windowManager = await readFile('src/window-manager.mjs', 'utf8');
  const coordinator = await readFile('kwin/mip-paper/contents/code/main.js', 'utf8');
  const metadata = JSON.parse(await readFile('kwin/mip-paper/metadata.json', 'utf8'));

  assert.match(windowManager, /const APP_ID = 'mip-paper'/);
  assert.match(coordinator, /const APP_ID = 'mip-paper'/);
  assert.equal(metadata.KPlugin.Id, 'mip-paper');
});

test('uses mip-paper configuration and probe namespaces', async () => {
  const config = await readFile('src/config.mjs', 'utf8');
  const main = await readFile('src/main.mjs', 'utf8');
  const probe = await readFile('scripts/render-probe.mjs', 'utf8');

  assert.match(config, /path\.join\(base, 'mip-paper'/);
  assert.match(main, /process\.env\.MIP_PAPER_CONFIG/);
  assert.match(main, /env\.MIP_PAPER_PROBE_STRATEGY/);
  assert.match(probe, /const SERVICE = 'mip-paper\.service'/);
  assert.match(probe, /MIP_PAPER_PROBE_STRATEGY/);
});

test('ships mip-paper command and service assets', async () => {
  await access('bin/mip-paper');
  await access('resources/mip-paper.service.in');
  const launcher = await readFile('bin/mip-paper', 'utf8');
  const unit = await readFile('resources/mip-paper.service.in', 'utf8');

  assert.match(launcher, /readonly APP_ID='mip-paper'/);
  assert.match(launcher, /readonly SERVICE_NAME='mip-paper\.service'/);
  assert.match(unit, /Description=Mip-Paper/);
});

test('contains no former product identity in tracked files', async () => {
  const formerIdentities = [
    ['animated', 'ocean', 'wallpaper'].join('-'),
    ['Animated', 'Ocean', 'Wallpaper'].join(' '),
    ['ANIMATED', 'OCEAN', 'WALLPAPER'].join('_'),
    ['ANIMATED', 'WALLPAPER'].join('_'),
  ];
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  const violations = [];

  for (const pathname of stdout.split('\0').filter(Boolean)) {
    const contents = await readFile(pathname).catch(() => null);
    if (!contents || contents.includes(0)) continue;
    for (const identity of formerIdentities) {
      if (contents.includes(identity)) violations.push(`${pathname}: ${identity}`);
    }
  }

  assert.deepEqual(violations, []);
});
