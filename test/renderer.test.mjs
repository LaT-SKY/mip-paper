import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

test('renderer is a control-free full-screen Canvas page', async () => {
  const html = await readFile('src/renderer/index.html', 'utf8');
  const css = await readFile('src/renderer/styles.css', 'utf8');

  assert.match(html, /<canvas id="wallpaper"><\/canvas>/);
  assert.match(html, /<script type="module" src="\.\/renderer\.mjs"><\/script>/);
  assert.doesNotMatch(html, /<input|<button|type="range"|type="number"/);
  assert.match(css, /width:\s*100vw/);
  assert.match(css, /height:\s*100vh/);
  assert.match(css, /overflow:\s*hidden/);
});

test('renderer uses a non-alpha high-DPI Canvas without blur effects', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');

  assert.match(script, /getContext\('2d',\s*\{\s*alpha:\s*false\s*\}\)/);
  assert.match(script, /devicePixelRatio/);
  assert.match(script, /Math\.min\([^\n]*devicePixelRatio[^\n]*2\)/);
  assert.match(script, /imageSmoothingEnabled\s*=\s*true/);
  assert.match(script, /imageSmoothingQuality\s*=\s*'high'/);
  assert.doesNotMatch(script, /motionBlur|filter\s*=|shadowBlur/);
});

test('renderer loads only the installed local wallpaper image', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');
  const image = await stat('assets/161-2.jpeg');

  assert.match(script, /new URL\('\.\.\/\.\.\/assets\/161-2\.jpeg',\s*import\.meta\.url\)/);
  assert.ok(image.size > 6_000_000);
});

test('renderer consumes the motion core and read-only preload bootstrap', async () => {
  const script = await readFile('src/renderer/renderer.mjs', 'utf8');

  assert.match(script, /from '\.\.\/motion\.mjs'/);
  assert.match(script, /window\.wallpaper\.getBootstrap\(\)/);
  assert.match(script, /applyPointerSample/);
  assert.match(script, /advanceMotion/);
  assert.match(script, /requestedFrameRate/);
});
