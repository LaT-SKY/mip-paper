import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  galleryDirectory,
  galleryIndexPath,
  importToGallery,
  listGallery,
  pruneGallery,
  removeFromGallery,
  setActiveGalleryImage,
  toggleFavorite,
} from '../src/wallpaper-gallery.mjs';
import { wallpaperPath } from '../src/wallpaper-image.mjs';

async function copyAsset(source, dest) {
  const { copyFile } = await import('node:fs/promises');
  await copyFile(source, dest);
}

const ASSET = path.join(process.cwd(), 'assets', 'default-wallpaper.jpg');

test('import deduplicates by contentKey and preserves favorite', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  const first = await importToGallery(ASSET, { env, homedir });
  assert.equal(first.useCount, 0);
  assert.equal(first.favorite, false);
  const second = await importToGallery(ASSET, { env, homedir, favorite: true });
  assert.equal(second.contentKey, first.contentKey);
  assert.equal(second.id, first.id);
  assert.equal(second.favorite, true);

  const list = await listGallery(env, homedir);
  assert.equal(list.length, 1);
  assert.equal(list[0].favorite, true);

  await rm(dataHome, { recursive: true, force: true });
});

test('setActive copies to wallpaper path and bumps useCount', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  const entry = await importToGallery(ASSET, { env, homedir });
  const result = await setActiveGalleryImage(entry.id, { env, homedir });
  assert.equal(result.useCount, 1);
  assert.ok(result.activePath);
  const activeStat = await stat(wallpaperPath(env, homedir));
  assert.ok(activeStat.isFile());
  const list = await listGallery(env, homedir);
  assert.equal(list[0].useCount, 1);
  assert.ok(list[0].lastUsed);

  await rm(dataHome, { recursive: true, force: true });
});

test('toggleFavorite flips and remove deletes entry', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  const entry = await importToGallery(ASSET, { env, homedir });
  const fav = await toggleFavorite(entry.id, { env, homedir });
  assert.equal(fav.favorite, true);
  const unfav = await toggleFavorite(entry.id, { env, homedir });
  assert.equal(unfav.favorite, false);

  await removeFromGallery(entry.id, { env, homedir });
  const list = await listGallery(env, homedir);
  assert.equal(list.length, 0);

  await rm(dataHome, { recursive: true, force: true });
});

test('prune keeps favorites and active, evicts oldest', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  // Create two distinct images by copying asset and appending byte
  const img1 = path.join(dataHome, 'a.jpg');
  const img2 = path.join(dataHome, 'b.jpg');
  const img3 = path.join(dataHome, 'c.jpg');
  await copyAsset(ASSET, img1);
  await copyAsset(ASSET, img2);
  await copyAsset(ASSET, img3);
  // Make them distinct by appending
  await writeFile(img2, Buffer.concat([await readFile(img2), Buffer.from([1])]));
  await writeFile(img3, Buffer.concat([await readFile(img3), Buffer.from([2, 3])]));

  const e1 = await importToGallery(img1, { env, homedir });
  // Delay to ensure importedAt ordering
  await new Promise((r) => setTimeout(r, 10));
  const e2 = await importToGallery(img2, { env, homedir });
  await new Promise((r) => setTimeout(r, 10));
  const e3 = await importToGallery(img3, { env, homedir });

  await toggleFavorite(e1.id, { env, homedir });
  await setActiveGalleryImage(e2.id, { env, homedir });

  // Prune to maxHistory 1 -> should keep e1 (favorite) and e2 (active), evict e3 or e1?
  // Non-favorite non-active is e3 only -> not over limit, create one more
  const img4 = path.join(dataHome, 'd.jpg');
  await copyAsset(ASSET, img4);
  await writeFile(img4, Buffer.concat([await readFile(img4), Buffer.from([4, 5, 6])]));
  const e4 = await importToGallery(img4, { env, homedir });

  await pruneGallery({ env, homedir, maxHistory: 1 });
  const list = await listGallery(env, homedir);
  const ids = new Set(list.map((e) => e.id));
  assert.ok(ids.has(e1.id), 'favorite kept');
  assert.ok(ids.has(e2.id), 'active kept');
  // One of e3/e4 should be evicted, only 3 kept at most (fav+active+1)
  assert.ok(list.length <= 3);

  await rm(dataHome, { recursive: true, force: true });
});

test('corrupted index returns empty and recovers', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  await mkdir(galleryDirectory(env, homedir), { recursive: true, mode: 0o700 });
  await writeFile(galleryIndexPath(env, homedir), 'not json', 'utf8');
  const list = await listGallery(env, homedir);
  assert.equal(list.length, 0);

  const entry = await importToGallery(ASSET, { env, homedir });
  const list2 = await listGallery(env, homedir);
  assert.equal(list2.length, 1);
  assert.equal(list2[0].id, entry.id);

  await rm(dataHome, { recursive: true, force: true });
});

test('import rejects invalid image', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };
  const bad = path.join(dataHome, 'bad.txt');
  await writeFile(bad, 'hello');

  await assert.rejects(() => importToGallery(bad, { env, homedir }), /Wallpaper must be/);
  await rm(dataHome, { recursive: true, force: true });
});

test('legacy wallpaper migrates on first list', async () => {
  const dataHome = await mkdtemp(path.join(os.tmpdir(), 'mip-paper-gallery-'));
  const homedir = path.join(dataHome, 'home');
  await mkdir(homedir, { recursive: true });
  const env = { XDG_DATA_HOME: dataHome };

  // Simulate existing active wallpaper without gallery
  const active = wallpaperPath(env, homedir);
  await mkdir(path.dirname(active), { recursive: true, mode: 0o700 });
  await copyAsset(ASSET, active);

  const list = await listGallery(env, homedir);
  assert.equal(list.length, 1);
  assert.equal(list[0].useCount, 1);

  await rm(dataHome, { recursive: true, force: true });
});
