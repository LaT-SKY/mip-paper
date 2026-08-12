import {
  chmod,
  copyFile,
  mkdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import path from 'node:path';

import { imageSizeFromFile } from 'image-size/fromFile';

const APP_ID = 'mip-paper';
const FILE_NAME = 'wallpaper';
const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export function wallpaperDataDirectory(env = process.env, homedir) {
  const base = env.XDG_DATA_HOME || path.join(homedir, '.local', 'share');
  return path.join(base, APP_ID);
}

export function wallpaperPath(env = process.env, homedir) {
  return path.join(wallpaperDataDirectory(env, homedir), FILE_NAME);
}

function displayKey(value) {
  const normalized = String(value).replace(/[^A-Za-z0-9_.-]/g, '_');
  return normalized || 'unknown';
}

export function displayWallpaperDirectory(displayId, env = process.env, homedir) {
  return path.join(wallpaperDataDirectory(env, homedir), 'wallpapers', displayKey(displayId));
}

export function displayWallpaperPath(displayId, env = process.env, homedir) {
  return path.join(displayWallpaperDirectory(displayId, env, homedir), FILE_NAME);
}

export function displayWallpaperMetadataPath(displayId, env = process.env, homedir) {
  return path.join(displayWallpaperDirectory(displayId, env, homedir), 'metadata.json');
}

export function displayWallpaperStatusPath(displayId, env = process.env, homedir) {
  return path.join(displayWallpaperDirectory(displayId, env, homedir), 'status.json');
}

export async function inspectWallpaper(pathname) {
  const metadata = await stat(pathname);
  if (!metadata.isFile()) {
    throw new TypeError('Wallpaper source must be a regular file');
  }

  try {
    const dimensions = await imageSizeFromFile(pathname);
    const format = dimensions.type === 'jpg' ? 'jpeg' : dimensions.type;
    if (!SUPPORTED_FORMATS.has(format)
        || !Number.isInteger(dimensions.width) || dimensions.width < 1
        || !Number.isInteger(dimensions.height) || dimensions.height < 1) {
      throw new TypeError('Wallpaper must be a JPEG, PNG, or WebP image');
    }
    return Object.freeze({
      pathname,
      format,
      size: metadata.size,
      width: dimensions.width,
      height: dimensions.height,
    });
  } catch (error) {
    if (error instanceof TypeError && /^Wallpaper must/.test(error.message)) {
      throw error;
    }
    throw new TypeError('Wallpaper must be a valid JPEG, PNG, or WebP image', { cause: error });
  }
}

export async function importWallpaper(source, destination) {
  await inspectWallpaper(source);
  const directory = path.dirname(destination);
  const temporary = path.join(directory, `.wallpaper-${process.pid}-${Date.now()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await copyFile(source, temporary);
    await inspectWallpaper(temporary);
    await chmod(temporary, 0o644);
    await rename(temporary, destination);
    return inspectWallpaper(destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function importDisplayWallpaper(source, destination, metadata = {}) {
  const result = await importWallpaper(source, destination);
  const metadataPath = path.join(path.dirname(destination), 'metadata.json');
  const temporary = `${metadataPath}.${process.pid}.tmp`;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(temporary, JSON.stringify({ ...metadata, ...result }) + '\n', { mode: 0o600 });
  await rename(temporary, metadataPath);
  return result;
}
