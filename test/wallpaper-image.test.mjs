import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  displayKey,
  importDisplayWallpaper,
  importWallpaper,
  inspectWallpaper,
  wallpaperDataDirectory,
  wallpaperPath,
} from '../src/wallpaper-image.mjs';

const images = Object.freeze({
  jpeg: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64'),
  png: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  webp: Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64'),
});

async function exists(pathname) {
  try {
    await access(pathname);
    return true;
  } catch {
    return false;
  }
}

test('resolves the managed wallpaper under XDG data storage', () => {
  assert.equal(displayKey('DP/1'), 'DP_1');
  assert.equal(
    wallpaperPath({ XDG_DATA_HOME: '/tmp/data' }, '/home/user'),
    '/tmp/data/mip-paper/wallpaper',
  );
  assert.equal(
    wallpaperDataDirectory({}, '/home/user'),
    '/home/user/.local/share/mip-paper',
  );
});

test('accepts valid JPEG, PNG and WebP images with dimensions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-images-'));
  try {
    for (const [format, contents] of Object.entries(images)) {
      const pathname = path.join(directory, format);
      await writeFile(pathname, contents);
      const result = await inspectWallpaper(pathname);
      assert.equal(result.format, format);
      assert.equal(result.width, 1);
      assert.equal(result.height, 1);
      assert.equal(result.size, contents.length);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsupported, truncated and non-file sources', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-images-'));
  try {
    const text = path.join(directory, 'text');
    const truncated = path.join(directory, 'truncated');
    await writeFile(text, 'not an image');
    await writeFile(truncated, images.png.subarray(0, 12));
    await assert.rejects(inspectWallpaper(text), /valid JPEG, PNG, or WebP/);
    await assert.rejects(inspectWallpaper(truncated), /valid JPEG, PNG, or WebP/);
    await assert.rejects(inspectWallpaper(directory), /regular file/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('atomically replaces a managed image and preserves it after failure', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-images-'));
  try {
    const source = path.join(directory, 'source.png');
    const invalid = path.join(directory, 'invalid.txt');
    const destinationDirectory = path.join(directory, 'data', 'mip-paper');
    const destination = path.join(destinationDirectory, 'wallpaper');
    await writeFile(source, images.png);
    await writeFile(invalid, 'broken');

    const result = await importWallpaper(source, destination);
    assert.equal(result.format, 'png');
    assert.deepEqual(await readFile(destination), images.png);
    assert.equal((await stat(destination)).mode & 0o777, 0o644);

    await assert.rejects(importWallpaper(invalid, destination), /valid JPEG, PNG, or WebP/);
    assert.deepEqual(await readFile(destination), images.png);
    assert.deepEqual(
      (await readdir(destinationDirectory)).filter((name) => name.startsWith('.wallpaper-')),
      [],
    );
    assert.equal(await exists(destination), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cleans a staged file when destination validation fails', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-images-'));
  try {
    const source = path.join(directory, 'source.png');
    const destinationDirectory = path.join(directory, 'data', 'mip-paper');
    const destination = path.join(destinationDirectory, 'wallpaper');
    await writeFile(source, images.png);
    await mkdir(destinationDirectory, { recursive: true });
    await mkdir(destination);

    await assert.rejects(importWallpaper(source, destination));
    assert.deepEqual(
      (await readdir(destinationDirectory)).filter((name) => name.startsWith('.wallpaper-')),
      [],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('identifies managed wallpapers by their validated content and persists the key', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-images-'));
  try {
    const firstSource = path.join(directory, 'first.png');
    const secondSource = path.join(directory, 'second.png');
    const thirdSource = path.join(directory, 'third.jpg');
    const firstDestination = path.join(directory, 'displays', 'first', 'wallpaper');
    const secondDestination = path.join(directory, 'displays', 'second', 'wallpaper');
    const thirdDestination = path.join(directory, 'displays', 'third', 'wallpaper');
    await writeFile(firstSource, images.png);
    await writeFile(secondSource, images.png);
    await writeFile(thirdSource, images.jpeg);

    const first = await importDisplayWallpaper(firstSource, firstDestination, { displayId: 'first', mtimeMs: 12345 });
    const second = await importDisplayWallpaper(secondSource, secondDestination, { displayId: 'second' });
    const third = await importDisplayWallpaper(thirdSource, thirdDestination, { displayId: 'third' });

    assert.match(first.contentKey, /^sha256:[0-9a-f]{64}$/);
    assert.equal(second.contentKey, first.contentKey);
    assert.notEqual(third.contentKey, first.contentKey);
    const metadata = JSON.parse(await readFile(path.join(path.dirname(firstDestination), 'metadata.json'), 'utf8'));
    assert.equal(metadata.contentKey, first.contentKey);
    assert.equal(metadata.mtimeMs, 12345);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
