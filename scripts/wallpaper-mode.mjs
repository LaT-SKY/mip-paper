#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function setMode(pathname, mode) {
  if (!['kde', 'manual'].includes(mode)) throw new TypeError('mode must be kde or manual');
  const value = JSON.parse(await readFile(pathname, 'utf8'));
  value.wallpaper = { ...(value.wallpaper ?? {}), mode };
  const temporary = `${pathname}.${process.pid}.tmp`;
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, pathname);
}

async function getMode(pathname) {
  const value = JSON.parse(await readFile(pathname, 'utf8'));
  return value.wallpaper?.mode ?? 'kde';
}

const [command, pathname, mode] = process.argv.slice(2);
try {
  if (command === 'set' && pathname && mode) await setMode(pathname, mode);
  else if (command === 'get' && pathname && !mode) process.stdout.write(`${await getMode(pathname)}\n`);
  else throw new TypeError('Usage: wallpaper-mode.mjs {get CONFIG|set CONFIG MODE}');
} catch (error) {
  process.stderr.write(`Error: ${error?.message || error}\n`);
  process.exitCode = 1;
}
