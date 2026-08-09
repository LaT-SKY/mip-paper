import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);

async function executable(pathname, contents) {
  await writeFile(pathname, contents);
  await chmod(pathname, 0o755);
}

async function createFixture({ capture = 'success', metadata = 'valid' } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'wallpaper-audio-probe-'));
  const fakeBin = path.join(directory, 'bin');
  await mkdir(fakeBin);
  if (metadata !== 'missing') {
    const line = metadata === 'valid'
      ? `update: id:0 key:'default.audio.sink' value:'{"name":"sink.test"}' type:'Spa:String:JSON'`
      : 'invalid metadata';
    const escapedLine = line.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    await executable(path.join(fakeBin, 'pw-metadata'), `#!/bin/bash\nprintf '%s\\n' "${escapedLine}"\n`);
  }
  if (capture !== 'missing') {
    const body = capture === 'success'
      ? "printf 'PRIVATE_PCM_SENTINEL'\nexec /bin/sleep 10\n"
      : 'exec /bin/sleep 10\n';
    await executable(path.join(fakeBin, 'pw-cat'), `#!/bin/bash\n${body}`);
  }
  return {
    directory,
    env: {
      ...process.env,
      PATH: fakeBin,
      AUDIO_PROBE_TIMEOUT_MS: '100',
    },
  };
}

async function cleanup(fixture) {
  await rm(fixture.directory, { recursive: true, force: true });
}

test('reports default sink availability without echoing captured bytes', async () => {
  const fixture = await createFixture();
  try {
    const result = await execFileAsync(process.execPath, ['scripts/audio-probe.mjs'], {
      env: fixture.env,
      timeout: 2000,
    });
    assert.deepEqual(JSON.parse(result.stdout), { status: 'available', sink: 'sink.test' });
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_PCM_SENTINEL/);
  } finally {
    await cleanup(fixture);
  }
});

for (const [name, options] of [
  ['missing pw-cat', { capture: 'missing' }],
  ['invalid metadata', { metadata: 'invalid' }],
  ['capture timeout', { capture: 'timeout' }],
]) {
  test(`fails promptly for ${name} without leaking bytes`, async () => {
    const fixture = await createFixture(options);
    const started = Date.now();
    try {
      await assert.rejects(
        execFileAsync(process.execPath, ['scripts/audio-probe.mjs'], {
          env: fixture.env,
          timeout: 2000,
        }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stderr, /Audio probe failed/);
          assert.doesNotMatch(`${error.stdout}${error.stderr}`, /PRIVATE_PCM_SENTINEL/);
          return true;
        },
      );
      assert.ok(Date.now() - started < 1500);
    } finally {
      await cleanup(fixture);
    }
  });
}
