import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const APP_ID = 'mip-paper';
const FILE_NAME = 'wallpaper';
const MAX_HEADER_BYTES = 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parsePng(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)
    || buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebp(buffer) {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    if (size > buffer.length - data) return null;
    if (type === 'VP8X' && size >= 10) {
      return { format: 'webp', width: readUInt24LE(buffer, data + 4) + 1, height: readUInt24LE(buffer, data + 7) + 1 };
    }
    if (type === 'VP8L' && size >= 5 && buffer[data] === 0x2f) {
      return {
        format: 'webp',
        width: 1 + buffer[data + 1] + ((buffer[data + 2] & 0x3f) << 8),
        height: 1 + (buffer[data + 2] >> 6) + (buffer[data + 3] << 2) + ((buffer[data + 4] & 0x0f) << 10),
      };
    }
    if (type === 'VP8 ' && size >= 10
      && buffer[data + 3] === 0x9d && buffer[data + 4] === 0x01 && buffer[data + 5] === 0x2a) {
      return {
        format: 'webp',
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }
    offset = data + size + (size & 1);
  }
  return null;
}

function parseJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) return null;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > buffer.length) return null;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || segmentLength > buffer.length - offset) return null;
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 7) return null;
      return { format: 'jpeg', width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return null;
}

async function imageDimensions(pathname, size) {
  const handle = await open(pathname, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, MAX_HEADER_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    return parsePng(header) || parseWebp(header) || parseJpeg(header);
  } finally {
    await handle.close();
  }
}

async function wallpaperContentKey(pathname) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(pathname)) hash.update(chunk);
  return `sha256:${hash.digest('hex')}`;
}

export function wallpaperDataDirectory(env = process.env, homedir) {
  const base = env.XDG_DATA_HOME || path.join(homedir, '.local', 'share');
  return path.join(base, APP_ID);
}

export function wallpaperPath(env = process.env, homedir) {
  return path.join(wallpaperDataDirectory(env, homedir), FILE_NAME);
}

export function displayKey(value) {
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
    const dimensions = await imageDimensions(pathname, metadata.size);
    if (!dimensions
        || !Number.isInteger(dimensions.width) || dimensions.width < 1
        || !Number.isInteger(dimensions.height) || dimensions.height < 1) {
      throw new TypeError('Wallpaper must be a valid JPEG, PNG, or WebP image');
    }
    return Object.freeze({
      pathname,
      format: dimensions.format,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs,
      width: dimensions.width,
      height: dimensions.height,
      contentKey: await wallpaperContentKey(pathname),
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
