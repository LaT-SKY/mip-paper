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
  assert.match(preload, /removeListener/);
  assert.doesNotMatch(preload, /getAudioSpectrum|pw-cat|pw-metadata|spawn|rawPcm|selectAudioDevice/i);
});

test('main owns one audio service, one config watcher and an asynchronous quit barrier', async () => {
  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
  assert.match(main, /createAudioSpectrumService/);
  assert.match(main, /createConfigWatcher/);
  assert.match(main, /audioSpectrumService\.updateConfig/);
  assert.match(main, /manager\.updateAudioConfig/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /await audioSpectrumService\?\.stop\(\)/);
});
