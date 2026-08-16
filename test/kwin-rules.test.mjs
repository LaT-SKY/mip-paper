import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const helper = path.resolve('scripts/kwin-rules.sh');

async function runHelper(command, file) {
  return execFileAsync(helper, [command], {
    env: {
      ...process.env,
      KWIN_RULES_FILE: file,
      KWIN_RULES_NO_RELOAD: '1',
    },
  });
}

async function readKey(file, group, key, defaultValue = '') {
  const { stdout } = await execFileAsync('kreadconfig6', [
    '--file', file,
    '--group', group,
    '--key', key,
    '--default', defaultValue,
  ]);
  return stdout.trimEnd();
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-kwin-'));
  const file = path.join(directory, 'kwinrulesrc');
  await writeFile(file, [
    '[General]',
    'count=1',
    'rules=rustdesk-autohide',
    '',
    '[rustdesk-autohide]',
    'Description=Unrelated existing rule',
    'skiptaskbar=true',
    'skiptaskbarrule=2',
    '',
  ].join('\n'));
  return { directory, file };
}

test('install adds an exact project rule without replacing existing rules', async () => {
  const { directory, file } = await fixture();
  try {
    const { stdout } = await runHelper('install', file);
    assert.match(stdout, /Installed KWin rule: mip-paper/);
    assert.equal(await readKey(file, 'General', 'rules'), 'rustdesk-autohide,mip-paper');
    assert.equal(await readKey(file, 'General', 'count'), '2');
    assert.equal(await readKey(file, 'rustdesk-autohide', 'Description'), 'Unrelated existing rule');
    assert.equal(await readKey(file, 'mip-paper', 'wmclass'), 'mip-paper');
    assert.equal(await readKey(file, 'mip-paper', 'wmclassmatch'), '1');
    assert.equal(await readKey(file, 'mip-paper', 'title', 'missing'), 'missing');
    assert.equal(await readKey(file, 'mip-paper', 'titlematch', 'missing'), 'missing');
    assert.equal(await readKey(file, 'mip-paper', 'below'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'skiptaskbar'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'skippager'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'skipswitcher'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'acceptfocus'), 'false');
    assert.equal(await readKey(file, 'mip-paper', 'acceptfocusrule'), '2');
    assert.equal(await readKey(file, 'mip-paper', 'noborder'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'fullscreen', 'missing'), 'true');
    assert.equal(await readKey(file, 'mip-paper', 'fullscreenrule', 'missing'), '2');
    assert.equal(await readKey(file, 'mip-paper', 'desktops'), '*');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('install is idempotent and check detects the project rule', async () => {
  const { directory, file } = await fixture();
  try {
    await runHelper('install', file);
    await runHelper('install', file);
    assert.equal(await readKey(file, 'General', 'rules'), 'rustdesk-autohide,mip-paper');
    assert.equal(await readKey(file, 'General', 'count'), '2');
    const { stdout } = await runHelper('check', file);
    assert.match(stdout, /KWin rule is installed/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('install removes legacy exact-title matching keys', async () => {
  const { directory, file } = await fixture();
  try {
    await writeFile(file, [
      '',
      '[mip-paper]',
      'title=mip-paper',
      'titlematch=1',
      '',
    ].join('\n'), { flag: 'a' });

    await runHelper('install', file);

    assert.equal(await readKey(file, 'mip-paper', 'title', 'missing'), 'missing');
    assert.equal(await readKey(file, 'mip-paper', 'titlematch', 'missing'), 'missing');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('install rewrites the ignore-focus keys even on an older rule', async () => {
  const { directory, file } = await fixture();
  try {
    await writeFile(file, [
      '',
      '[mip-paper]',
      'acceptfocus=false',
      'acceptfocusrule=2',
      '',
    ].join('\n'), { flag: 'a' });

    await runHelper('install', file);

    assert.equal(await readKey(file, 'mip-paper', 'acceptfocus'), 'false');
    assert.equal(await readKey(file, 'mip-paper', 'acceptfocusrule'), '2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('remove deletes only project keys and preserves unrelated rules', async () => {
  const { directory, file } = await fixture();
  try {
    await runHelper('install', file);
    const { stdout } = await runHelper('remove', file);
    assert.match(stdout, /Removed KWin rule: mip-paper/);
    assert.equal(await readKey(file, 'General', 'rules'), 'rustdesk-autohide');
    assert.equal(await readKey(file, 'General', 'count'), '1');
    assert.equal(await readKey(file, 'rustdesk-autohide', 'Description'), 'Unrelated existing rule');
    const contents = await readFile(file, 'utf8');
    const projectSection = contents.match(/\[mip-paper\]([\s\S]*?)(?:\n\[|$)/)?.[1] ?? '';
    assert.doesNotMatch(projectSection, /=/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('check fails when the project rule is absent', async () => {
  const { directory, file } = await fixture();
  try {
    await assert.rejects(runHelper('check', file), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout, /KWin rule is not installed/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses the user kwinrulesrc file when no override is configured', async () => {
  const { directory, file } = await fixture();
  try {
    const { KWIN_RULES_FILE: _ignored, ...baseEnv } = process.env;
    await execFileAsync(helper, ['install'], {
      env: {
        ...baseEnv,
        HOME: directory,
        XDG_CONFIG_HOME: directory,
        KWIN_RULES_NO_RELOAD: '1',
      },
    });
    assert.equal(await readKey(file, 'General', 'rules'), 'rustdesk-autohide,mip-paper');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
