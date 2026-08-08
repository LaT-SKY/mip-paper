import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve('.');
const helper = path.join(repositoryRoot, 'scripts', 'kwin-script.sh');

async function exists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-kwin-script-'));
  const configHome = path.join(directory, '.config');
  const dataHome = path.join(directory, '.local', 'share');
  const kwinrc = path.join(configHome, 'kwinrc');
  await mkdir(configHome, { recursive: true });
  await mkdir(dataHome, { recursive: true });
  await writeFile(kwinrc, '[Plugins]\nother-scriptEnabled=true\n');
  return {
    directory,
    env: {
      ...process.env,
      HOME: directory,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      KWIN_CONFIG_FILE: kwinrc,
      KWIN_SCRIPT_SOURCE: path.join(repositoryRoot, 'kwin', 'animated-ocean-wallpaper'),
      KWIN_SCRIPT_NO_RELOAD: '1',
    },
    destination: path.join(dataHome, 'kwin', 'scripts', 'animated-ocean-wallpaper'),
    kwinrc,
  };
}

async function runHelper(command, env) {
  return execFileAsync(helper, [command], { env });
}

test('installs, checks, idempotently reinstalls, and removes only the project package', async () => {
  const data = await fixture();
  try {
    const unrelated = path.join(data.directory, '.local', 'share', 'kwin', 'scripts', 'unrelated', 'keep');
    await mkdir(path.dirname(unrelated), { recursive: true });
    await writeFile(unrelated, 'keep');

    await runHelper('install', data.env);
    assert.equal(await exists(path.join(data.destination, 'metadata.json')), true);
    assert.equal(await exists(path.join(data.destination, 'contents', 'code', 'main.js')), true);
    await runHelper('check', data.env);
    assert.match(await readFile(data.kwinrc, 'utf8'), /animated-ocean-wallpaperEnabled=true/);

    await runHelper('install', data.env);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');

    await runHelper('remove', data.env);
    assert.equal(await exists(data.destination), false);
    assert.match(await readFile(data.kwinrc, 'utf8'), /animated-ocean-wallpaperEnabled=false/);
    assert.equal(await readFile(unrelated, 'utf8'), 'keep');
  } finally {
    await rm(data.directory, { recursive: true, force: true });
  }
});
