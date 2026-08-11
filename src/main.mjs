import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  session,
} from 'electron';

import { configPath, informationCachePath, loadConfig, weatherCredentialsPath } from './config.mjs';
import { loadWeatherCredentials } from './weather-credentials.mjs';
import { readInformationCache, writeInformationCache } from './information-cache.mjs';
import { createLocationProvider, createPortalLocationAdapter } from './location-provider.mjs';
import { createQWeatherClient } from './qweather-client.mjs';
import { createInformationService } from './information-service.mjs';
import { createAudioSpectrumService } from './audio-spectrum-service.mjs';
import { createShutdownCoordinator, installShutdownHandlers } from './app-lifecycle.mjs';
import { createConfigWatcher } from './config-watcher.mjs';
import { createWindowManager } from './window-manager.mjs';
import { SCHEDULER_NAMES } from './render-scheduler.mjs';
import { validateProbeSummary } from './performance-probe.mjs';
import { inspectWallpaper, wallpaperPath } from './wallpaper-image.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let manager;
let informationService;
let audioSpectrumService;
let configWatcher;

const shutdownCoordinator = createShutdownCoordinator({
  quit: () => app.quit(),
  stopConfigWatcher: () => configWatcher?.stop(),
  stopAudioSpectrum: () => audioSpectrumService?.stop(),
  stopInformation: () => informationService?.stop(),
  stopWindowManager: () => manager?.stop(),
});

installShutdownHandlers({
  app,
  processTarget: process,
  coordinator: shutdownCoordinator,
});

async function buildInformationService(config) {
  const cachePathname = informationCachePath(process.env, os.homedir());
  const cache = {
    read: () => readInformationCache(cachePathname),
    write: (snapshot) => writeInformationCache(cachePathname, snapshot),
  };
  try {
    const credentials = await loadWeatherCredentials(weatherCredentialsPath(process.env, os.homedir()));
    const qweatherClient = createQWeatherClient({ credentials });
    const portal = config.weather.location.mode === 'auto' ? createPortalLocationAdapter() : null;
    const locationProvider = createLocationProvider({
      config: config.weather.location,
      portal,
      cache,
      geoLookup: (id) => qweatherClient.resolveLocation(id),
    });
    return createInformationService({ config, locationProvider, qweatherClient, cache });
  } catch {
    return createInformationService({
      config,
      locationProvider: { resolve: async () => { throw new Error('Location unavailable'); } },
      qweatherClient: {},
      cache,
    });
  }
}

export function parseProbeOptions(env = process.env) {
  const strategy = env.MIP_PAPER_PROBE_STRATEGY;
  if (!strategy) return null;
  if (!SCHEDULER_NAMES.includes(strategy)) throw new RangeError(`Unknown probe strategy: ${strategy}`);
  const resultPath = env.MIP_PAPER_PROBE_RESULT;
  if (!resultPath || !path.isAbsolute(resultPath)) throw new TypeError('Probe result path must be absolute');
  return Object.freeze({
    enabled: true,
    strategy,
    scenario: env.MIP_PAPER_PROBE_SCENARIO || 'idle',
    resultPath,
  });
}

app.setName('Mip-Paper');
const configDirectory = path.dirname(configPath(process.env, os.homedir()));
app.setPath('userData', configDirectory);
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

async function run() {
  await app.whenReady();
  const pathname = process.env.MIP_PAPER_CONFIG
    || configPath(process.env, os.homedir());
  const config = await loadConfig(pathname);
  const wallpaperPathname = wallpaperPath(process.env, os.homedir());
  await inspectWallpaper(wallpaperPathname);
  const wallpaperUrl = pathToFileURL(wallpaperPathname).href;
  const probe = parseProbeOptions(process.env);
  informationService = await buildInformationService(config);
  audioSpectrumService = createAudioSpectrumService({ config: config.audio });

  manager = createWindowManager({
    BrowserWindow,
    screen,
    ipcMain,
    defaultSession: session.defaultSession,
    config,
    informationService,
    audioSpectrumService,
    rendererPath: path.join(sourceDirectory, 'renderer', 'index.html'),
    preloadPath: path.join(sourceDirectory, 'preload.cjs'),
    wallpaperUrl,
    probe,
    onProbeReport: probe ? async (summary) => {
      const validated = validateProbeSummary(summary);
      await appendFile(probe.resultPath, `${JSON.stringify(validated)}\n`, 'utf8');
      return { accepted: true };
    } : null,
  });
  await manager.start();
  informationService.start();
  await audioSpectrumService.start();
  configWatcher = createConfigWatcher({
    pathname,
    load: loadConfig,
    onConfig(nextConfig) {
      manager.updateAudioConfig(nextConfig.audio);
      void audioSpectrumService.updateConfig(nextConfig.audio).catch((error) => {
        console.error(`Audio configuration update failed: ${error?.message || 'unknown error'}`);
      });
    },
    onError(error) {
      console.error(`Configuration reload failed: ${error?.message || 'unknown error'}`);
    },
  });
  configWatcher.start();
}

app.on('window-all-closed', () => {});

run().catch((error) => {
  console.error(`Wallpaper startup failed: ${error.stack || error.message || error}`);
  app.exit(1);
});
