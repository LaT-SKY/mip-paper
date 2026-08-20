#!/usr/bin/env node
import os from 'node:os';

import {
  importToGallery,
  listGallery,
  pruneGallery,
  removeFromGallery,
  setActiveGalleryImage,
  toggleFavorite,
} from '../src/wallpaper-gallery.mjs';
import { setAssignment } from '../src/wallpaper-assignments.mjs';

async function printList(env, homedir) {
  const entries = await listGallery(env, homedir);
  if (entries.length === 0) {
    process.stdout.write('Gallery is empty.\n');
    return;
  }
  for (const e of entries) {
    const fav = e.favorite ? ' favorite' : '';
    const used = e.lastUsed ? ` lastUsed=${e.lastUsed}` : '';
    process.stdout.write(
      `${e.id} ${e.format} ${e.width}x${e.height} size=${e.size}${fav}${used} file=${e.file}\n`,
    );
  }
  process.stdout.write(`Total: ${entries.length} images\n`);
}

async function main(args) {
  const [command, value] = args;
  const env = process.env;
  const homedir = os.homedir();

  if (command === 'import' && value && args.length === 2) {
    const entry = await importToGallery(value, { env, homedir });
    // Activate immediately (used by `wallpaper set`)
    await setActiveGalleryImage(entry.id, { env, homedir });
    process.stdout.write(
      `Gallery imported: ${entry.id} format=${entry.format} size=${entry.size} dimensions=${entry.width}x${entry.height} favorite=${entry.favorite}\n`,
    );
    return;
  }
  if (command === 'import-only' && value && args.length === 2) {
    const entry = await importToGallery(value, { env, homedir });
    process.stdout.write(
      `Gallery imported: ${entry.id} format=${entry.format} size=${entry.size} dimensions=${entry.width}x${entry.height} favorite=${entry.favorite}\n`,
    );
    return;
  }
  if (command === 'list' && args.length === 1) {
    await printList(env, homedir);
    return;
  }
  if (command === 'list' && args.length === 2 && args[1] === '--json') {
    const entries = await listGallery(env, homedir);
    process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
    return;
  }
  if (command === 'show' && value && args.length === 2) {
    const entries = await listGallery(env, homedir);
    const entry = entries.find((e) => e.id === value || e.contentKey === value);
    if (!entry) throw new TypeError(`Gallery entry not found: ${value}`);
    process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
    return;
  }
  if (command === 'set' && value) {
    // Support: set ID [--display ID|all]
    let displayId = null;
    if (args.length === 4 && args[2] === '--display') displayId = args[3];
    else if (args.length !== 2) throw new TypeError('Usage: wallpaper-gallery.mjs {import PATH|list|show ID|set ID [--display ID|all]|favorite ID|unfavorite ID|toggle-favorite ID|remove ID|prune}');
    if (displayId !== null) {
      const entries = await listGallery(env, homedir);
      const entry = entries.find((e) => e.id === value || e.contentKey === value || e.contentKey === `sha256:${value}`);
      if (!entry) throw new TypeError(`Gallery entry not found: ${value}`);
      await setAssignment(displayId === 'all' ? 'fallback' : displayId, entry.contentKey, { env, homedir });
      process.stdout.write(`Gallery assigned: ${entry.id} -> display ${displayId}\n`);
      return;
    }
    const result = await setActiveGalleryImage(value, { env, homedir });
    process.stdout.write(`Gallery activated: ${result.id} -> ${result.activePath}\n`);
    return;
  }
  if (command === 'favorite' && value && args.length === 2) {
    const result = await toggleFavorite(value, { env, homedir });
    // toggleFavorite flips; ensure favorite true
    if (!result.favorite) await toggleFavorite(value, { env, homedir });
    const final = (await listGallery(env, homedir)).find((e) => e.id === result.id);
    process.stdout.write(`Gallery favorite: ${final.id} favorite=${final.favorite}\n`);
    return;
  }
  if (command === 'unfavorite' && value && args.length === 2) {
    const result = await toggleFavorite(value, { env, homedir });
    if (result.favorite) await toggleFavorite(value, { env, homedir });
    const final = (await listGallery(env, homedir)).find((e) => e.id === result.id);
    process.stdout.write(`Gallery unfavorited: ${final.id} favorite=${final.favorite}\n`);
    return;
  }
  if (command === 'toggle-favorite' && value && args.length === 2) {
    const result = await toggleFavorite(value, { env, homedir });
    process.stdout.write(`Gallery toggle: ${result.id} favorite=${result.favorite}\n`);
    return;
  }
  if (command === 'remove' && value && args.length === 2) {
    const removed = await removeFromGallery(value, { env, homedir });
    process.stdout.write(`Gallery removed: ${removed.id}\n`);
    return;
  }
  if (command === 'prune' && args.length === 1) {
    const kept = await pruneGallery({ env, homedir });
    process.stdout.write(`Gallery pruned, kept ${kept.length} images\n`);
    return;
  }
  throw new TypeError(
    'Usage: wallpaper-gallery.mjs {import PATH|list|show ID|set ID|favorite ID|unfavorite ID|toggle-favorite ID|remove ID|prune}',
  );
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Error: ${error?.message || String(error)}\n`);
  process.exitCode = error instanceof TypeError && /^Usage:/.test(error.message) ? 2 : 1;
});
