import { spawn } from 'node:child_process';

import { PW_CAT_ARGS, parseDefaultSinkLine } from '../src/pipewire-audio.mjs';

const FORCE_KILL_MS = 250;
const MAX_METADATA_BYTES = 16 * 1024;

function probeTimeout(env = process.env) {
  if (env.AUDIO_PROBE_TIMEOUT_MS === undefined) return 2000;
  const value = Number(env.AUDIO_PROBE_TIMEOUT_MS);
  if (!Number.isInteger(value) || value < 50 || value > 5000) {
    throw new RangeError('invalid timeout');
  }
  return value;
}

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(forceTimer);
      resolve();
    };
    child.once('close', finish);
    child.kill('SIGTERM');
    const forceTimer = setTimeout(() => {
      child.kill('SIGKILL');
      finish();
    }, FORCE_KILL_MS);
  });
}

function readDefaultSink(timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('pw-metadata', ['-n', 'default'], {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let output = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void terminateChild(child).then(() => reject(new Error('metadata timeout')));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      output += String(chunk);
      if (Buffer.byteLength(output) > MAX_METADATA_BYTES) {
        settled = true;
        clearTimeout(timer);
        void terminateChild(child).then(() => reject(new Error('metadata output too large')));
      }
    });
    child.once('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('pw-metadata unavailable'));
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('pw-metadata failed'));
        return;
      }
      const sink = output.split(/\r?\n/)
        .map((line) => parseDefaultSinkLine(line))
        .find(Boolean);
      if (!sink) reject(new Error('default sink unavailable'));
      else resolve(sink);
    });
  });
}

function probeCapture(timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('pw-cat', PW_CAT_ARGS, {
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let bytes = 0;
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void terminateChild(child).then(resolve);
    };
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void terminateChild(child).then(() => reject(new Error(message)));
    };
    const timer = setTimeout(() => fail('capture timeout'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes >= 8) succeed();
    });
    child.once('error', () => fail('pw-cat unavailable'));
    child.once('close', (code) => {
      if (!settled) fail(code === 0 ? 'capture returned no data' : 'pw-cat failed');
    });
  });
}

async function main() {
  const timeoutMs = probeTimeout();
  const sink = await readDefaultSink(timeoutMs);
  await probeCapture(timeoutMs);
  process.stdout.write(`${JSON.stringify({ status: 'available', sink })}\n`);
}

main().catch((error) => {
  process.stderr.write(`Audio probe failed: ${error?.message || 'unknown error'}\n`);
  process.exitCode = 1;
});
