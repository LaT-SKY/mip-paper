#!/usr/bin/env node
import os from 'node:os';

import {
  importWallpaper,
  inspectWallpaper,
  wallpaperPath,
} from '../src/wallpaper-image.mjs';

async function main(arguments_) {
  const [command, source] = arguments_;
  const destination = wallpaperPath(process.env, os.homedir());

  if (command === 'set' && source && arguments_.length === 2) {
    const result = await importWallpaper(source, destination);
    process.stdout.write(
      `Wallpaper imported: ${result.pathname} format=${result.format} size=${result.size} dimensions=${result.width}x${result.height}\n`,
    );
    return;
  }
  if (command === 'status' && arguments_.length === 1) {
    const result = await inspectWallpaper(destination);
    process.stdout.write(
      `Wallpaper ready: ${result.pathname} format=${result.format} size=${result.size} dimensions=${result.width}x${result.height}\n`,
    );
    return;
  }
  throw new TypeError('Usage: wallpaper-image.mjs {set PATH|status}');
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Error: ${error?.message || String(error)}\n`);
  process.exitCode = error instanceof TypeError && /^Usage:/.test(error.message) ? 2 : 1;
});
