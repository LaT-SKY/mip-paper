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
  assert.match(preload, /onAudioConfigUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onWallpaperUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /onColorUpdated\s*:\s*\(listener\)/);
  assert.match(preload, /submitWallpaperAccent\s*:\s*\(submission\)\s*=>\s*ipcRenderer\.invoke/);
  assert.match(preload, /removeListener/);
  assert.doesNotMatch(preload, /getAudioSpectrum|pw-cat|pw-metadata|spawn|rawPcm|selectAudioDevice/i);
});

test('main owns one audio service and config watcher wired to the quit barrier', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  const lifecycle = await readFile(new URL('../src/app-lifecycle.mjs', import.meta.url), 'utf8');
  assert.match(main, /createAudioSpectrumService/);
  assert.match(main, /createConfigWatcher/);
  assert.match(main, /audioSpectrumService\.updateConfig/);
  assert.match(main, /manager\.updateAudioConfig/);
  assert.match(main, /createKdeWallpaperSync/);
  assert.match(main, /manager\?\.updateWallpaper/);
  assert.match(main, /stopWallpaperSync:\s*\(\)\s*=>\s*wallpaperSync\?\.stop\(\)/);
  assert.match(main, /stopAudioSpectrum:\s*\(\)\s*=>\s*audioSpectrumService\?\.stop\(\)/);
  assert.match(lifecycle, /event\.preventDefault\(\)/);
  assert.match(lifecycle, /await stop\('audio spectrum',\s*stopAudioSpectrum\)/);
});
