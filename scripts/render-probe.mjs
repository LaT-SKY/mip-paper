import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'animated-ocean-wallpaper.service';
const STRATEGIES = ['raf', 'timer', 'adaptive'];
const SCENARIOS = ['idle', 'sweep', 'return'];

export function installSignalCleanup(restore, signals = process, exit = (code) => process.exit(code)) {
  let cleaning = false;
  const handler = (code) => {
    if (cleaning) return;
    cleaning = true;
    Promise.resolve(restore()).finally(() => exit(code));
  };
  const onTerm = () => handler(143);
  const onInterrupt = () => handler(130);
  signals.once('SIGTERM', onTerm);
  signals.once('SIGINT', onInterrupt);
  return () => {
    signals.removeListener('SIGTERM', onTerm);
    signals.removeListener('SIGINT', onInterrupt);
  };
}

function parseArgs(args) {
  const options = { duration: 60, output: path.join(os.tmpdir(), `animated-ocean-probe-${Date.now()}`), strategy: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--strategy') options.strategy = args[++index];
    else if (arg === '--duration') options.duration = Number(args[++index]);
    else if (arg === '--output') options.output = args[++index];
    else throw new TypeError(`Unknown probe option: ${arg}`);
  }
  if (options.strategy && !STRATEGIES.includes(options.strategy)) throw new RangeError(`Unknown probe strategy: ${options.strategy}`);
  if (!Number.isFinite(options.duration) || options.duration <= 0) throw new RangeError('Probe duration must be positive');
  return options;
}

async function systemctl(...args) {
  return execFileAsync('systemctl', ['--user', ...args], { maxBuffer: 2 * 1024 * 1024 });
}

async function sampleResource() {
  const { stdout } = await systemctl('show', SERVICE, '--property=CPUUsageNSec,MemoryCurrent', '--value');
  const values = stdout.trim().split(/\s+/).map(Number);
  return { cpuUsageNSec: values[0] || 0, memoryCurrent: values[1] || 0, at: new Date().toISOString() };
}

export async function runProbe(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  const strategies = options.strategy ? [options.strategy] : STRATEGIES;
  await mkdir(options.output, { recursive: true });
  const rawPath = path.join(options.output, 'renderer.jsonl');
  const metadataPath = path.join(options.output, 'metadata.json');
  await writeFile(metadataPath, `${JSON.stringify({ strategies, scenarios: SCENARIOS, duration: options.duration, electron: '43.3.0', machine: os.hostname(), session: env.XDG_SESSION_TYPE || 'unknown' }, null, 2)}\n`);
  const originalActive = (await systemctl('is-active', SERVICE).then(() => true).catch(() => false));
  const restore = async () => {
    await systemctl('unset-environment', 'ANIMATED_WALLPAPER_PROBE_STRATEGY', 'ANIMATED_WALLPAPER_PROBE_SCENARIO', 'ANIMATED_WALLPAPER_PROBE_RESULT').catch(() => {});
    if (originalActive) await systemctl('restart', SERVICE).catch(() => {});
    else await systemctl('stop', SERVICE).catch(() => {});
  };
  const removeSignalCleanup = installSignalCleanup(restore);
  const resources = [];
  try {
    for (const strategy of strategies) {
      for (const scenario of SCENARIOS) {
        await systemctl('set-environment', `ANIMATED_WALLPAPER_PROBE_STRATEGY=${strategy}`, `ANIMATED_WALLPAPER_PROBE_SCENARIO=${scenario}`, `ANIMATED_WALLPAPER_PROBE_RESULT=${rawPath}`);
        await systemctl('restart', SERVICE);
        await new Promise((resolve) => setTimeout(resolve, 30 * 1000));
        await new Promise((resolve) => setTimeout(resolve, options.duration * 1000));
        resources.push({ strategy, scenario, resource: await sampleResource() });
      }
    }
    await writeFile(path.join(options.output, 'metrics.json'), `${JSON.stringify(resources, null, 2)}\n`);
    await writeFile(path.join(options.output, 'comparison.md'), '# Rendering probe\n\nRaw renderer metrics are in `renderer.jsonl`; resource samples are in `metrics.json`.\n');
    return options.output;
  } finally {
    removeSignalCleanup();
    await restore();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runProbe().then((output) => console.log(`Probe complete: ${output}`)).catch((error) => {
    console.error(`Probe failed: ${error.message}`);
    process.exitCode = 1;
  });
}
