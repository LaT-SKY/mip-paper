import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeWallpaperPixels,
  complementaryRgb,
  contrastingNeutral,
  DEFAULT_ACCENT_RGB,
  normalizeRgb,
  relativeLuminance,
  rgbToCss,
  selectWallpaperAccent,
} from '../src/accent-color.mjs';

function pixels(entries) {
  return new Uint8ClampedArray(entries.flatMap(({ rgb, count, alpha = 255 }) => (
    Array.from({ length: count }, () => [...rgb, alpha]).flat()
  )));
}

test('validates RGB tuples and formats CSS colors', () => {
  assert.deepEqual(DEFAULT_ACCENT_RGB, [255, 52, 120]);
  assert.deepEqual(normalizeRgb([105, 197, 211]), [105, 197, 211]);
  assert.equal(normalizeRgb([256, 0, 0]), null);
  assert.equal(normalizeRgb([1.5, 2, 3]), null);
  assert.equal(normalizeRgb('105,197,211'), null);
  assert.equal(rgbToCss([105, 197, 211]), 'rgb(105 197 211)');
  assert.throws(() => rgbToCss([999, 0, 0]), /invalid RGB/);
});

test('balances prevalence and saturation while ignoring isolated noise', () => {
  const sample = pixels([
    { rgb: [80, 82, 84], count: 60 },
    { rgb: [20, 160, 145], count: 30 },
    { rgb: [255, 0, 255], count: 1 },
  ]);
  const first = selectWallpaperAccent(sample);
  assert.deepEqual(first, [22, 182, 164]);
  assert.deepEqual(selectWallpaperAccent(sample), first);
  assert.equal(Object.isFrozen(first), true);
});

test('corrects neutral and extreme colors into usable accent bounds', () => {
  assert.deepEqual(selectWallpaperAccent(pixels([{ rgb: [128, 128, 128], count: 4 }])), [195, 77, 77]);
  assert.deepEqual(selectWallpaperAccent(pixels([{ rgb: [0, 0, 0], count: 4 }])), [153, 51, 51]);
  assert.deepEqual(selectWallpaperAccent(pixels([{ rgb: [255, 255, 255], count: 4 }])), [207, 110, 110]);
});

test('rejects malformed samples and ignores transparent pixels', () => {
  assert.throws(() => selectWallpaperAccent(new Uint8ClampedArray([1, 2, 3])), /RGBA/);
  assert.equal(selectWallpaperAccent(pixels([{ rgb: [255, 0, 0], count: 2, alpha: 219 }])), null);
  assert.equal(selectWallpaperAccent([]), null);
});

test('resolves equal scores by count and then stable numeric bin order', () => {
  const equal = pixels([
    { rgb: [0, 255, 0], count: 2 },
    { rgb: [255, 0, 0], count: 2 },
  ]);
  assert.deepEqual(selectWallpaperAccent(equal), [28, 227, 28]);
});

test('derives complementary and contrast-neutral audio colors', () => {
  assert.equal(relativeLuminance([0, 0, 0]), 0);
  assert.equal(relativeLuminance([255, 255, 255]), 1);
  assert.deepEqual(complementaryRgb([31, 173, 158]), [208, 37, 55]);
  assert.deepEqual(contrastingNeutral(0), [255, 255, 255]);
  assert.deepEqual(contrastingNeutral(1), [0, 0, 0]);
  assert.deepEqual(contrastingNeutral(0.179), [255, 255, 255]);
  assert.deepEqual(contrastingNeutral(0.18), [0, 0, 0]);
});

test('analyzes accent and luminance from the same opaque wallpaper sample', () => {
  const analysis = analyzeWallpaperPixels(pixels([{ rgb: [20, 180, 160], count: 4 }]));
  assert.deepEqual(analysis.rgb, [22, 182, 166]);
  assert.ok(Number.isFinite(analysis.luminance));
  assert.ok(analysis.luminance > 0 && analysis.luminance < 1);
});
