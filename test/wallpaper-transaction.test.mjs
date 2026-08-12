import assert from 'node:assert/strict';
import test from 'node:test';

import { createWallpaperTransactionCoordinator } from '../src/renderer/wallpaper-transaction.mjs';

const keyA = `sha256:${'a'.repeat(64)}`;
const keyB = `sha256:${'b'.repeat(64)}`;
const identityA = Object.freeze({ path: '/wallpapers/a', size: 10, mtimeMs: 20 });
const identityB = Object.freeze({ path: '/wallpapers/b', size: 11, mtimeMs: 21 });
const luminanceA = 0.32;

function transaction(name, { key, identity, generation, analyze = true, rgb = [255, 52, 120], luminance = null }) {
  return {
    wallpaperUrl: `file:///wallpapers/${name}`,
    wallpaperIdentity: identity,
    contentKey: key,
    generation,
    wallpaperLuminance: luminance,
    color: {
      rgb, source: analyze ? 'fallback' : 'wallpaper', transitionDurationMs: 900,
      analyzeWallpaper: analyze, wallpaperIdentity: identity, contentKey: key, generation,
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test('promotes and analyzes only the latest transaction when decodes finish out of order', async () => {
  const decodes = new Map([['file:///wallpapers/a', deferred()], ['file:///wallpapers/b', deferred()]]);
  const promoted = [];
  const submissions = [];
  const coordinator = createWallpaperTransactionCoordinator({
    loadImage: (url) => decodes.get(url).promise,
    analyzeImage: (image) => image.analysis,
    submitAccent: async (submission) => { submissions.push(submission); },
    applyColor: () => {},
    promoteImage: (image) => promoted.push(image.name),
  });

  const pendingA = coordinator.apply(transaction('a', { key: keyA, identity: identityA, generation: 1 }));
  const pendingB = coordinator.apply(transaction('b', { key: keyB, identity: identityB, generation: 2 }));
  decodes.get('file:///wallpapers/b').resolve({
    name: 'b', analysis: { rgb: [220, 90, 70], luminance: 0.2 },
  });
  await pendingB;
  decodes.get('file:///wallpapers/a').resolve({
    name: 'a', analysis: { rgb: [31, 173, 158], luminance: luminanceA },
  });
  await pendingA;

  assert.deepEqual(promoted, ['b']);
  assert.deepEqual(submissions.map(({ contentKey }) => contentKey), [keyB]);
});

test('does not submit analysis that becomes stale while analysis is pending', async () => {
  const analysisA = deferred();
  const submissions = [];
  const coordinator = createWallpaperTransactionCoordinator({
    loadImage: async (url) => ({ url }),
    analyzeImage: (image) => image.url.endsWith('/a')
      ? analysisA.promise
      : { rgb: [220, 90, 70], luminance: 0.2 },
    submitAccent: async (submission) => { submissions.push(submission); },
    applyColor: () => {},
    promoteImage: () => {},
  });

  const pendingA = coordinator.apply(transaction('a', { key: keyA, identity: identityA, generation: 1 }));
  await Promise.resolve();
  await coordinator.apply(transaction('b', { key: keyB, identity: identityB, generation: 2 }));
  analysisA.resolve({ rgb: [31, 173, 158], luminance: luminanceA });
  await pendingA;

  assert.deepEqual(submissions.map(({ contentKey }) => contentKey), [keyB]);
});

test('applies a cached color with image promotion and skips analysis', async () => {
  const events = [];
  const coordinator = createWallpaperTransactionCoordinator({
    loadImage: async () => ({ name: 'a' }),
    analyzeImage: () => { throw new Error('must not analyze'); },
    submitAccent: async () => { throw new Error('must not submit'); },
    applyColor: (color) => events.push(['color', color.rgb, color.wallpaperLuminance]),
    promoteImage: (image) => events.push(['image', image.name]),
  });
  await coordinator.apply(transaction('a', {
    key: keyA, identity: identityA, generation: 3, analyze: false,
    rgb: [31, 173, 158], luminance: luminanceA,
  }));
  assert.deepEqual(events, [['image', 'a'], ['color', [31, 173, 158], luminanceA]]);
});

test('rejects an invalid top-level wallpaper luminance before decoding', async () => {
  let loads = 0;
  const coordinator = createWallpaperTransactionCoordinator({
    loadImage: async () => { loads += 1; return {}; },
    analyzeImage: () => null,
    submitAccent: async () => {},
    applyColor: () => {},
    promoteImage: () => {},
  });
  await assert.rejects(
    coordinator.apply(transaction('a', {
      key: keyA, identity: identityA, generation: 1, luminance: 2,
    })),
    /invalid wallpaper transaction/,
  );
  assert.equal(loads, 0);
});

test('submits the immutable identity, content key, and generation from the analyzed transaction', async () => {
  const submissions = [];
  const coordinator = createWallpaperTransactionCoordinator({
    loadImage: async () => ({ name: 'a' }),
    analyzeImage: () => ({ rgb: [31, 173, 158], luminance: luminanceA }),
    submitAccent: async (submission) => { submissions.push(submission); },
    applyColor: () => {},
    promoteImage: () => {},
  });
  await coordinator.apply(transaction('a', { key: keyA, identity: identityA, generation: 7 }));
  assert.deepEqual(submissions, [{
    rgb: [31, 173, 158], luminance: luminanceA,
    wallpaperIdentity: identityA, contentKey: keyA, generation: 7,
  }]);
});
