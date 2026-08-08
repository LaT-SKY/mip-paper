import os from 'node:os';
import path from 'node:path';
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

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
let manager;

app.setName('animated-ocean-wallpaper');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

async function run() {
  await app.whenReady();
  const pathname = process.env.ANIMATED_OCEAN_WALLPAPER_CONFIG
    || configPath(process.env, os.homedir());
  const config = await loadConfig(pathname);

  manager = createWindowManager({
    BrowserWindow,
    screen,
    ipcMain,
    defaultSession: session.defaultSession,
    config,
    rendererPath: path.join(sourceDirectory, 'renderer', 'index.html'),
    preloadPath: path.join(sourceDirectory, 'preload.cjs'),
  });
  await manager.start();
}

app.on('before-quit', () => manager?.stop());
app.on('window-all-closed', () => {});

run().catch((error) => {
  console.error(`Wallpaper startup failed: ${error.stack || error.message || error}`);
  app.exit(1);
});
