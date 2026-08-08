import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
} from 'electron';

import { configPath, loadConfig } from './config.mjs';
import { createWindowManager } from './window-manager.mjs';
import { SCHEDULER_NAMES } from './render-scheduler.mjs';
import { validateProbeSummary } from './performance-probe.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let manager;

export function parseProbeOptions(env = process.env) {
  const strategy = env.ANIMATED_WALLPAPER_PROBE_STRATEGY;
  if (!strategy) return null;
  if (!SCHEDULER_NAMES.includes(strategy)) throw new RangeError(`Unknown probe strategy: ${strategy}`);
  const resultPath = env.ANIMATED_WALLPAPER_PROBE_RESULT;
  if (!resultPath || !path.isAbsolute(resultPath)) throw new TypeError('Probe result path must be absolute');
  return Object.freeze({
    enabled: true,
    strategy,
    scenario: env.ANIMATED_WALLPAPER_PROBE_SCENARIO || 'idle',
    resultPath,
  });
}

app.setName('animated-ocean-wallpaper');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

async function run() {
  await app.whenReady();
  const pathname = process.env.ANIMATED_OCEAN_WALLPAPER_CONFIG
    || configPath(process.env, os.homedir());
  const config = await loadConfig(pathname);
  const probe = parseProbeOptions(process.env);

  manager = createWindowManager({
    BrowserWindow,
    screen,
    ipcMain,
    defaultSession: session.defaultSession,
    config,
    rendererPath: path.join(sourceDirectory, 'renderer', 'index.html'),
    preloadPath: path.join(sourceDirectory, 'preload.cjs'),
    probe,
    onProbeReport: probe ? async (summary) => {
      const validated = validateProbeSummary(summary);
      await appendFile(probe.resultPath, `${JSON.stringify(validated)}\n`, 'utf8');
      return { accepted: true };
    } : null,
  });
  await manager.start();
}

app.on('before-quit', () => manager?.stop());
app.on('window-all-closed', () => {});

run().catch((error) => {
  console.error(`Wallpaper startup failed: ${error.stack || error.message || error}`);
  app.exit(1);
});
