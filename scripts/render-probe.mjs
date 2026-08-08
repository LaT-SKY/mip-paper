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
  const options = {
    duration: 60,
    warmup: 0,
    output: path.join(os.tmpdir(), `animated-ocean-probe-${Date.now()}`),
    strategy: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--strategy') options.strategy = args[++index];
    else if (arg === '--duration') options.duration = Number(args[++index]);
    else if (arg === '--warmup') options.warmup = Number(args[++index]);
    else if (arg === '--output') options.output = args[++index];
    else throw new TypeError(`Unknown probe option: ${arg}`);
  }
  if (options.strategy && !STRATEGIES.includes(options.strategy)) throw new RangeError(`Unknown probe strategy: ${options.strategy}`);
  if (!Number.isFinite(options.duration) || options.duration <= 0) throw new RangeError('Probe duration must be positive');
  if (!Number.isFinite(options.warmup) || options.warmup < 0) throw new RangeError('Probe warmup must be non-negative');
  return options;
}

async function systemctl(...args) {
  return execFileAsync('systemctl', ['--user', ...args], { maxBuffer: 2 * 1024 * 1024 });
}

export function parseSystemdResourceOutput(stdout) {
  const values = {};
  for (const line of stdout.split(/\r?\n/)) {
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    values[line.slice(0, separator)] = Number(line.slice(separator + 1)) || 0;
  }
  return {
    cpuUsageNSec: values.CPUUsageNSec || 0,
    memoryCurrent: values.MemoryCurrent || 0,
  };
}

function parseMetric(value) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[N/A]') return null;
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

export function parseNvidiaSmiOutput(stdout) {
  return stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [index, name, gpuUtilization, memoryUtilization, memoryUsed, memoryTotal, powerDraw, temperature] = line.split(',');
    return {
      index: parseMetric(index),
      name: name?.trim() || null,
      utilizationGpuPercent: parseMetric(gpuUtilization),
      utilizationMemoryPercent: parseMetric(memoryUtilization),
      memoryUsedMiB: parseMetric(memoryUsed),
      memoryTotalMiB: parseMetric(memoryTotal),
      powerDrawW: parseMetric(powerDraw),
      temperatureC: parseMetric(temperature),
    };
  });
}

async function sampleResource() {
  const { stdout } = await systemctl(
    'show', SERVICE, '--property=CPUUsageNSec', '--property=MemoryCurrent',
  );
  const resource = { ...parseSystemdResourceOutput(stdout), at: new Date().toISOString() };
  try {
    const { stdout: gpuStdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=index,name,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,temperature.gpu',
      '--format=csv,noheader,nounits',
    ], { maxBuffer: 2 * 1024 * 1024 });
    resource.gpu = { provider: 'nvidia-smi', devices: parseNvidiaSmiOutput(gpuStdout) };
  } catch (error) {
    resource.gpu = { provider: 'nvidia-smi', devices: [], unavailable: error.code || error.message };
  }
  return resource;
}

export async function runProbe(args = process.argv.slice(2), env = process.env) {
  const options = parseArgs(args);
  const strategies = options.strategy ? [options.strategy] : STRATEGIES;
  await mkdir(options.output, { recursive: true });
  const rawPath = path.join(options.output, 'renderer.jsonl');
  const metadataPath = path.join(options.output, 'metadata.json');
  await writeFile(metadataPath, `${JSON.stringify({ strategies, scenarios: SCENARIOS, duration: options.duration, warmup: options.warmup, electron: '43.3.0', machine: os.hostname(), session: env.XDG_SESSION_TYPE || 'unknown' }, null, 2)}\n`);
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
        if (options.warmup > 0) await new Promise((resolve) => setTimeout(resolve, options.warmup * 1000));
        const start = await sampleResource();
        const startAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, options.duration * 1000));
        const end = await sampleResource();
        const elapsedMs = Math.max(1, Date.now() - startAt);
        resources.push({
          strategy,
          scenario,
          resource: {
            windowSeconds: elapsedMs / 1000,
            cpuPercent: Math.max(0, (end.cpuUsageNSec - start.cpuUsageNSec) / (elapsedMs * 1e6) * 100),
            rssBytes: end.memoryCurrent,
            gpu: end.gpu,
            start,
            end,
          },
        });
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
