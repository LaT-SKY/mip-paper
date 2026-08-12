import path from 'node:path';
import { fileURLToPath } from 'node:url';

function groupParts(name) {
  return name.slice(1, -1).split('][');
}

function normalizeLocalImage(value) {
  if (!value) return null;
  try {
    if (value.startsWith('file://')) return fileURLToPath(value);
    if (value.startsWith('/') && !value.includes('\0')) return path.normalize(value);
  } catch {
    return null;
  }
  return null;
}

function result(candidate, overrides = {}) {
  return Object.freeze({
    screenIndex: candidate.screenIndex,
    containmentId: candidate.containmentId,
    plugin: candidate.plugin,
    sourcePath: candidate.sourcePath ?? null,
    status: candidate.status ?? 'supported',
    reason: candidate.reason ?? null,
    activityId: candidate.activityId ?? '',
    ...overrides,
  });
}

export function parsePlasmaWallpaperConfig(text, { activeActivityId = null } = {}) {
  if (typeof text !== 'string') throw new TypeError('Plasma configuration must be text');
  const groups = new Map();
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('[') && line.endsWith(']')) {
      current = line;
      if (!groups.has(current)) groups.set(current, new Map());
      continue;
    }
    if (!current || line.startsWith('#') || line.trim() === '') continue;
    const index = line.indexOf('=');
    if (index >= 0) groups.get(current).set(line.slice(0, index), line.slice(index + 1));
  }

  const selected = new Map();
  for (const [group, values] of groups) {
    const parts = groupParts(group);
    if (parts.length !== 2 || parts[0] !== 'Containments' || !/^\d+$/.test(parts[1])) continue;
    if (values.get('formfactor') !== '0' || values.get('location') !== '0') continue;
    const screenIndex = Number(values.get('lastScreen'));
    if (!Number.isInteger(screenIndex) || screenIndex < 0) continue;
    const containmentId = Number(parts[1]);
    const plugin = values.get('wallpaperplugin') ?? '';
    const base = { screenIndex, containmentId, plugin, activityId: values.get('activityId') ?? '' };
    let candidate;
    if (plugin !== 'org.kde.image') {
      candidate = result(base, { status: 'unsupported', reason: `unsupported wallpaper plugin: ${plugin || 'missing'}` });
    } else {
      const imageGroup = `[Containments][${parts[1]}][Wallpaper][org.kde.image][General]`;
      const sourcePath = normalizeLocalImage(groups.get(imageGroup)?.get('Image'));
      candidate = sourcePath
        ? result(base, { sourcePath })
        : result(base, { status: 'invalid', reason: 'missing or non-local static image' });
    }
    const previous = selected.get(screenIndex);
    const preferred = activeActivityId && base.activityId === activeActivityId;
    const previousPreferred = activeActivityId && previous?.activityId === activeActivityId;
    if (!previous || (preferred && !previousPreferred)
      || (preferred === previousPreferred && containmentId < previous.containmentId)) {
      selected.set(screenIndex, candidate);
    }
  }
  return Object.freeze([...selected.values()].sort((a, b) => a.screenIndex - b.screenIndex));
}
