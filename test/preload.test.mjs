import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

test('sandboxed BrowserWindow uses a CommonJS preload exposing bootstrap IPC', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const preload = await readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8');

  assert.match(main, /preload\.cjs/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\(['"]wallpaper['"]/);
  assert.match(preload, /getBootstrap\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(preload, /getInformationSnapshot\s*:\s*\(\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(preload, /onInformationUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onAudioSpectrumUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onConfigUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onWallpaperUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onColorUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onFullscreenUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /submitWallpaperAccent\s*:\s*\(submission\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(preload, /runMenuCommand\s*:\s*\(request\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(preload, /MENU_COMMAND_CHANNEL/);
  assert.match(preload, /removeListener/);
  assert.doesNotMatch(preload, /getAudioSpectrum|pw-cat|pw-metadata|spawn|rawPcm|selectAudioDevice/i);

test('both preload variants expose removable fullscreen updates', async () => {
  const [commonJs, module] = await Promise.all([
    readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload.mjs', import.meta.url), 'utf8'),
  ]);
  for (const preload of [commonJs, module]) {
    assert.match(preload, /onFullscreenUpdated\s*:\s*\(listener\)/);
    assert.match(preload, /FULLSCREEN_UPDATED_CHANNEL/);
    assert.match(preload, /removeListener\(FULLSCREEN_UPDATED_CHANNEL,\s*wrapper\)/);
  }
});
});

test('both preload variants expose global menu singleton signals', async () => {
  const [commonJs, module] = await Promise.all([
    readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload.mjs', import.meta.url), 'utf8'),
  ]);
  for (const preload of [commonJs, module]) {
    assert.match(preload, /notifyMenuOpened\s*:\s*\(\)\s*=>\s*ipcRenderer\.send/);
    assert.match(preload, /onMenuOpened\s*:\s*\(listener\)/);
    assert.match(preload, /MENU_OPENED_CHANNEL/);
    assert.match(preload, /NOTIFY_MENU_OPENED_CHANNEL/);
  }
});

test('both preload variants expose removable menu close requests', async () => {
  const [commonJs, module] = await Promise.all([
    readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload.mjs', import.meta.url), 'utf8'),
  ]);
  for (const preload of [commonJs, module]) {
    assert.match(preload, /onMenuCloseRequest\s*:\s*\(listener\)/);
    assert.match(preload, /MENU_CLOSE_CHANNEL/);
    assert.match(preload, /removeListener\(MENU_CLOSE_CHANNEL,\s*wrapper\)/);
  }
});

test('both preload variants expose removable work-area updates', async () => {
  const [commonJs, module] = await Promise.all([
    readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload.mjs', import.meta.url), 'utf8'),
  ]);
  for (const preload of [commonJs, module]) {
    assert.match(preload, /onWorkAreaUpdated\s*:\s*\(listener\)/);
    assert.match(preload, /WORK_AREA_UPDATED_CHANNEL/);
    assert.match(preload, /removeListener\(WORK_AREA_UPDATED_CHANNEL,\s*wrapper\)/);
  }
});

test('both preload variants expose removable complete runtime updates', async () => {
  const [commonJs, module] = await Promise.all([
    readFile(new URL('../src/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/preload.mjs', import.meta.url), 'utf8'),
  ]);
  for (const preload of [commonJs, module]) {
    assert.match(preload, /onConfigUpdated\s*:\s*\(listener\)/);
    assert.match(preload, /CONFIG_UPDATED_CHANNEL/);
    assert.match(preload, /removeListener\(CONFIG_UPDATED_CHANNEL,\s*wrapper\)/);
  }
});

test('main owns both configuration watchers and the runtime coordinator', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const lifecycle = await readFile(new URL('../src/app-lifecycle.mjs', import.meta.url), 'utf8');
  assert.match(main, /createAudioSpectrumService/);
  assert.match(main, /createConfigWatcher/);
  assert.match(main, /createRuntimeConfigCoordinator/);
  assert.match(main, /credentialsWatcher\s*=\s*createConfigWatcher/);
  assert.match(main, /audioSpectrumService\.updateConfig/);
  assert.match(main, /manager\.updateRuntime/);
  assert.match(main, /createKdeWallpaperSync/);
  assert.match(main, /manager\?\.updateWallpaper/);
  assert.match(main, /stopWallpaperSync:\s*\(\)\s*=>\s*wallpaperSync\?\.stop\(\)/);
  assert.match(main, /stopAudioSpectrum:\s*\(\)\s*=>\s*audioSpectrumService\?\.stop\(\)/);
  assert.match(main, /stopCredentialsWatcher:\s*\(\)\s*=>\s*credentialsWatcher\?\.stop\(\)/);
  assert.match(main, /stopRuntimeCoordinator:\s*\(\)\s*=>\s*runtimeCoordinator\?\.stop\(\)/);
  assert.match(lifecycle, /event\.preventDefault\(\)/);
  assert.match(lifecycle, /await stop\('audio spectrum',\s*stopAudioSpectrum\)/);
});

test('main binds wallpaper luminance into live and bootstrap transactions', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /wallpaperLuminance:\s*color\.wallpaperLuminance\s*\?\?\s*null/);
  assert.match(main, /const color = colorService\.getState\(display\.id\)/);
  assert.match(main, /wallpaperLuminance:\s*color\?\.wallpaperLuminance\s*\?\?\s*null/);
});