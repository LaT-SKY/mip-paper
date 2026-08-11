import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('uses the Mip-Paper package and runtime identity', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  const main = await readFile('src/main.mjs', 'utf8');
  const pipewire = await readFile('src/pipewire-audio.mjs', 'utf8');
  const renderer = await readFile('src/renderer/index.html', 'utf8');

  assert.equal(packageJson.name, 'mip-paper');
  assert.match(main, /app\.setName\('Mip-Paper'\)/);
  assert.match(pipewire, /"node\.name":"mip-paper-spectrum"/);
  assert.match(renderer, /<title>Mip-Paper<\/title>/);
});
