import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('main wires KDE appearance into atomic runtime updates', async () => {
  const main = await readFile('src/main.mjs', 'utf8');
  assert.match(main, /createKdeAppearanceWatcher/);
  assert.match(main, /createAppearanceCoordinator/);
  assert.match(main, /onUpdate:\s*\(appearance\)\s*=>\s*manager\?\.updateAppearance\(appearance\)/);
  assert.match(main, /appearance:\s*appearanceCoordinator\.getState\(\)/);
  assert.match(main, /createWindowManager\(\{[\s\S]*appearance:\s*appearanceCoordinator\.getState\(\)/);
  assert.match(main, /appearanceCoordinator\.updateConfig\(nextConfig,\s*\{\s*publish:\s*false\s*\}\)/);
  assert.match(main, /manager\.updateRuntime\(\{\s*config:\s*nextConfig,\s*appearance:\s*nextAppearance\s*\}\)/);
  assert.match(main, /stopAppearance/);
});
