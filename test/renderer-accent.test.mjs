import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeWallpaperImage, applyAccentState } from '../src/renderer/accent.mjs';

function fakeRoot() {
  const values = new Map();
  return {
    style: {
      setProperty(name, value) { values.set(name, value); },
      getPropertyValue(name) { return values.get(name) ?? ''; },
    },
    dataset: {},
  };
}

test('applies validated accent roles and the configured duration', () => {
  const root = fakeRoot();
  assert.equal(applyAccentState(root, {
    rgb: [31, 173, 158], source: 'wallpaper', transitionDurationMs: 900,
  }, { reducedMotion: false }), true);
  assert.equal(root.style.getPropertyValue('--accent'), 'rgb(31 173 158)');
  assert.equal(root.style.getPropertyValue('--accent-dark'), 'rgb(22 120 110)');
  assert.equal(root.style.getPropertyValue('--accent-shadow'), 'rgb(31 173 158 / 0.76)');
  assert.equal(root.style.getPropertyValue('--accent-glow'), 'rgb(31 173 158 / 0.75)');
  assert.equal(root.style.getPropertyValue('--accent-audio-primary'), 'rgb(31 173 158)');
  assert.equal(root.style.getPropertyValue('--accent-audio-energy'), 'rgb(94 196 185)');
  assert.equal(root.style.getPropertyValue('--accent-audio-aux'), 'rgb(183 229 224)');
  assert.equal(root.style.getPropertyValue('--accent-transition-ms'), '900ms');
  assert.equal(root.dataset.accentSource, 'wallpaper');
});

test('reduced motion disables color transitions and malformed state is ignored', () => {
  const root = fakeRoot();
  assert.equal(applyAccentState(root, { rgb: [255, 52, 120], source: 'default', transitionDurationMs: 1200 }, { reducedMotion: true }), true);
  assert.equal(root.style.getPropertyValue('--accent-transition-ms'), '0ms');
  assert.equal(applyAccentState(root, { rgb: [999, 0, 0], source: 'bad', transitionDurationMs: 1 }), false);
});

test('samples a decoded wallpaper through a bounded 64 pixel canvas', () => {
  const calls = [];
  const pixels = new Uint8ClampedArray(64 * 32 * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = 20; pixels[index + 1] = 180; pixels[index + 2] = 160; pixels[index + 3] = 255;
  }
  const canvas = {
    width: 0, height: 0,
    getContext: () => ({
      drawImage: (...args) => calls.push(args),
      getImageData: () => ({ data: pixels }),
    }),
  };
  const rgb = analyzeWallpaperImage({ naturalWidth: 4000, naturalHeight: 2000 }, { createCanvas: () => canvas });
  assert.deepEqual(rgb, [22, 182, 166]);
  assert.equal(canvas.width, 64);
  assert.equal(canvas.height, 32);
  assert.deepEqual(calls[0].slice(1), [0, 0, 64, 32]);
});
