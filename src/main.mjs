import os from 'node:os';
import path from 'node:path';
import { appendFile } from 'node:fs/promises';
import { watch as nodeWatch } from 'node:fs';
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
import { createRuntimeConfigCoordinator } from './runtime-config-coordinator.mjs';
import { createWindowManager } from './window-manager.mjs';
import { SCHEDULER_NAMES } from './render-scheduler.mjs';
import { validateProbeSummary } from './performance-probe.mjs';
import { wallpaperPath } from './wallpaper-image.mjs';
import { createKdeWallpaperSync } from './kde-wallpaper-sync.mjs';
import { createKdeAccentWatcher } from './kde-accent.mjs';
import { createColorService, colorCacheDirectory } from './color-service.mjs';
import { createKdeAppearanceWatcher } from './kde-appearance.mjs';
import { createAppearanceCoordinator } from './appearance.mjs';
import { coordinatorScriptPath, createFullscreenWatcher } from './fullscreen-watcher.mjs';
import { createMenuCommandRunner } from './menu-command.mjs';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let manager;
let informationService;
let audioSpectrumService;
let configWatcher;
let credentialsWatcher;
let runtimeCoordinator;
let wallpaperSync;
let colorService;
let kdeAccentWatcher;
let appearanceCoordinator;
let fullscreenWatcher;
const wallpaperTransactions = new Map();

const shutdownCoordinator = createShutdownCoordinator({
  quit: () => app.quit(),
  stopConfigWatcher: () => configWatcher?.stop(),
  stopCredentialsWatcher: () => credentialsWatcher?.stop(),
  stopRuntimeCoordinator: () => runtimeCoordinator?.stop(),
  stopAppearance: () => appearanceCoordinator?.stop(),
  stopAudioSpectrum: () => audioSpectrumService?.stop(),
  stopInformation: () => informationService?.stop(),
  stopWindowManager: () => manager?.stop(),
  stopWallpaperSync: () => wallpaperSync?.stop(),
  stopColorService: () => colorService?.stop(),
  stopFullscreenWatcher: () => fullscreenWatcher?.stop(),
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

function buildWeatherSources(config, credentials, cache) {
  const qweatherClient = credentials ? createQWeatherClient({ credentials }) : {};
  const portal = credentials && config.weather.location.mode === 'auto' ? createPortalLocationAdapter() : null;
  const locationProvider = credentials ? createLocationProvider({
    config: config.weather.location,
    portal,
    cache,
    geoLookup: (id) => qweatherClient.resolveLocation(id),
  }) : { resolve: async () => { throw new Error('Location unavailable'); } };
  return { locationProvider, qweatherClient };
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
  let currentConfig = config;
  const wallpaperPathname = wallpaperPath(process.env, os.homedir());
  const wallpaperUrl = pathToFileURL(wallpaperPathname).href;
  const probe = parseProbeOptions(process.env);
  informationService = await buildInformationService(config);
  audioSpectrumService = createAudioSpectrumService({ config: config.audio });
  const kdeGlobalsPath = path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
    'kdeglobals',
  );

  appearanceCoordinator = createAppearanceCoordinator({
    config,
    kdeWatcherFactory: ({ onTheme, onError }) => createKdeAppearanceWatcher({
      pathname: kdeGlobalsPath,
      onTheme,
      onError,
    }),
    onUpdate: (appearance) => manager?.updateAppearance(appearance),
    onError: (error) => console.error(`KDE appearance watcher: ${error?.message || error}`),
  });
  appearanceCoordinator.start();
  await appearanceCoordinator.whenIdle();

  kdeAccentWatcher = createKdeAccentWatcher({
    pathname: kdeGlobalsPath,
    onAccent: (rgb) => colorService?.setKdeAccent(rgb),
    onError: (error) => console.error(`KDE accent watcher: ${error?.message || error}`),
  });
  colorService = createColorService({
    config,
    displays: () => screen.getAllDisplays(),
    cacheRoot: colorCacheDirectory(process.env, os.homedir()),
    kdeWatcher: kdeAccentWatcher,
    onUpdate: (displayId, state) => manager?.updateColor(displayId, state),
  });
  await colorService.start();
  wallpaperSync = createKdeWallpaperSync({
    config,
    plasmaConfigPath: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'plasma-org.kde.plasma.desktop-appletsrc'),
    getDisplays: () => screen.getAllDisplays(),
    defaultWallpaper: wallpaperPathname,
    manualWallpaper: wallpaperPathname,
    watch: nodeWatch,
    async onUpdate(source) {
      const color = await colorService.wallpaperChanged(source.displayId, {
        identity: source.wallpaperIdentity,
        contentKey: source.contentKey,
      });
      const wallpaper = {
        ...source,
        generation: color.generation,
        wallpaperLuminance: color.wallpaperLuminance ?? null,
        color,
      };
      wallpaperTransactions.set(source.displayId, wallpaper);
      manager?.updateWallpaper(source.displayId, wallpaper);
    },
    onStatus: (status) => {
      if (status.status === 'watch-error' || status.status === 'config-error') console.error(`KDE wallpaper sync: ${status.reason}`);
    },
  });
  wallpaperSync.start();
  await wallpaperSync.whenIdle();

  const menuCommandRunner = createMenuCommandRunner({
    homedir: os.homedir(),
    log: (message) => console.error(message),
  });
  manager = createWindowManager({
    BrowserWindow,
    screen,
    ipcMain,
    defaultSession: session.defaultSession,
    config,
    appearance: appearanceCoordinator.getState(),
    appVersion: app.getVersion(),
    menuCommandRunner,
    informationService,
    audioSpectrumService,
    colorService,
    rendererPath: path.join(sourceDirectory, 'renderer', 'index.html'),
    preloadPath: path.join(sourceDirectory, 'preload.cjs'),
    wallpaperUrl,
    getWallpaperTransaction: (display) => {
      const active = wallpaperTransactions.get(display.id);
      if (active) return active;
      const color = colorService.getState(display.id);
      return {
        wallpaperUrl,
        wallpaperIdentity: { path: wallpaperPathname, size: 0, mtimeMs: 0 },
        contentKey: null,
        generation: 0,
        wallpaperLuminance: color?.wallpaperLuminance ?? null,
        color,
      };
    },
    onDisplaysChanged: () => {
      void colorService.reconcileDisplays();
      void wallpaperSync.reconcile();
    },
    probe,
    onProbeReport: probe ? async (summary) => {
      const validated = validateProbeSummary(summary);
      await appendFile(probe.resultPath, `${JSON.stringify(validated)}\n`, 'utf8');
      return { accepted: true };
    } : null,
  });
  await manager.start();
  fullscreenWatcher = createFullscreenWatcher({
    getDisplays: () => screen.getAllDisplays(),
    onStateChange: (displayId, paused) => manager?.updateFullscreen(displayId, paused),
    onWorkAreaChange: (displayId, rect) => manager?.updateWorkArea(displayId, rect),
    enabled: () => currentConfig.motion.pauseWhenFullscreen,
    log: (message) => console.error(message),
    scriptPath: coordinatorScriptPath(),
  });
  await fullscreenWatcher.start();
  informationService.start();
  await audioSpectrumService.start();
  const credentialsPathname = weatherCredentialsPath(process.env, os.homedir());
  const cachePathname = informationCachePath(process.env, os.homedir());
  const cache = {
    read: () => readInformationCache(cachePathname),
    write: (snapshot) => writeInformationCache(cachePathname, snapshot),
  };
  let credentials = null;
  try { credentials = await loadWeatherCredentials(credentialsPathname); } catch {}
  runtimeCoordinator = createRuntimeConfigCoordinator({
    config,
    credentials,
    onError: (error) => console.error(error.message),
    applyConfig: async (nextConfig, { assertCurrent }) => {
      const previousConfig = currentConfig;
      try {
        await audioSpectrumService.updateConfig(nextConfig.audio);
        assertCurrent();
        const sources = buildWeatherSources(nextConfig, credentials, cache);
        await informationService.updateSources({ config: nextConfig, ...sources });
        assertCurrent();
        colorService.updateConfig(nextConfig.color);
        assertCurrent();
        if (nextConfig.wallpaper.mode !== previousConfig.wallpaper.mode) {
          wallpaperSync.setMode(nextConfig.wallpaper.mode);
          await wallpaperSync.whenIdle();
          assertCurrent();
        }
        await appearanceCoordinator.updateConfig(nextConfig, { publish: false });
        const nextAppearance = appearanceCoordinator.getState();
        assertCurrent();
        manager.updateRuntime({ config: nextConfig, appearance: nextAppearance });
        currentConfig = nextConfig;
        fullscreenWatcher?.setEnabled(nextConfig.motion.pauseWhenFullscreen);
      } catch (error) {
        await audioSpectrumService.updateConfig(previousConfig.audio).catch(() => {});
        const previousSources = buildWeatherSources(previousConfig, credentials, cache);
        await informationService.updateSources({ config: previousConfig, ...previousSources }).catch(() => {});
        try { colorService.updateConfig(previousConfig.color); } catch {}
        if (nextConfig.wallpaper.mode !== previousConfig.wallpaper.mode) {
          try { wallpaperSync.setMode(previousConfig.wallpaper.mode); await wallpaperSync.whenIdle(); } catch {}
        }
        await appearanceCoordinator.updateConfig(previousConfig, { publish: false }).catch(() => {});
        throw error;
      }
    },
    applyCredentials: async (nextCredentials, { config: activeConfig, assertCurrent }) => {
      const previousCredentials = credentials;
      try {
        const sources = buildWeatherSources(activeConfig, nextCredentials, cache);
        await informationService.updateSources({ config: activeConfig, ...sources });
        assertCurrent();
        credentials = nextCredentials;
      } catch (error) {
        const previousSources = buildWeatherSources(activeConfig, previousCredentials, cache);
        await informationService.updateSources({ config: activeConfig, ...previousSources }).catch(() => {});
        throw error;
      }
    },
  });
  configWatcher = createConfigWatcher({
    pathname,
    load: loadConfig,
    onConfig(nextConfig) { void runtimeCoordinator.updateConfig(nextConfig); },
    onError(error) {
      console.error(`Configuration reload failed: ${error?.message || 'unknown error'}`);
    },
  });
  credentialsWatcher = createConfigWatcher({
    pathname: credentialsPathname,
    load: loadWeatherCredentials,
    onConfig(nextCredentials) { void runtimeCoordinator.updateCredentials(nextCredentials); },
    onError(error) { console.error(`Weather credentials reload failed: ${error?.message || 'unknown error'}`); },
  });
  configWatcher.start();
  credentialsWatcher.start();
}

app.on('window-all-closed', () => {});

run().catch((error) => {
  console.error(`Wallpaper startup failed: ${error.stack || error.message || error}`);
  app.exit(1);
});
