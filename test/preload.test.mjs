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
  assert.match(preload, /removeListener/);
});
