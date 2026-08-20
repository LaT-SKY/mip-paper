import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const PANEL_LAYOUTS = Object.freeze(['trapezoid', 'grid-2x2', 'compact', 'stack']);
export const PANEL_CARD_IDS = Object.freeze(['time', 'weather', 'tide', 'calendar', 'custom']);
export const TIME_FORMATS = Object.freeze(['HH:mm', 'hh:mm a', 'HH:mm:ss']);
export const DATE_FORMATS = Object.freeze(['MMM dd, yyyy', 'yyyy-MM-dd', 'EEE, MMM dd']);
export const AUDIO_STYLES = Object.freeze(['ribbon', 'wave', 'mirror']);
export const AUDIO_COLOR_MODES = Object.freeze(['auto', 'manual']);
export const AUDIO_POSITIONS = Object.freeze(['top', 'center', 'bottom']);

export const DEFAULT_CONFIG = Object.freeze({
  mouse: Object.freeze({
    buttonsEnabled: true,
    interactionEnabled: true,
  }),
  wallpaper: Object.freeze({ mode: 'kde', fit: 'cover', crossfadeMs: 420, perDisplay: false }),
  color: Object.freeze({ mode: 'hybrid', transitionDurationMs: 900 }),
  appearance: Object.freeze({
    mode: 'system',
    dark: Object.freeze({ wallpaperBrightness: 0.72 }),
  }),
  audio: Object.freeze({
    enabled: true,
    gain: 1,
    silenceDelayMs: 600,
    fadeOutMs: 450,
    fadeInMs: 160,
    style: 'ribbon',
    colorMode: 'auto',
    colors: Object.freeze({ primary: '#ff3478', complement: '#4ae9b4', neutral: '#ffffff' }),
    sensitivity: 1,
    height: 104,
    position: 'bottom',
  }),
  frameRate: Object.freeze({
    interactive: 60,
    drift: 30,
  }),
  motion: Object.freeze({
    interactionSpeed: 1.15,
    returnSpeed: 0.3,
    driftSpeed: 1,
    deadZonePx: 2,
    horizontalPanPercent: 4.6,
    verticalPanPercent: 4.5,
    maxRotationDegrees: 0.7,
    pauseWhenFullscreen: true,
  }),
  panel: Object.freeze({
    autoExpandHide: true,
    expandTriggerDistancePx: 48,
    collapseDelaySeconds: 8,
    expanded: true,
    collapsedOpacity: 0.08,
    borderRadius: 16,
    surfaceOpacity: 0.77,
    shadowIntensity: 1,
    height: 400,
    animation: Object.freeze({ staggerDelayMs: 48, durationMs: 820 }),
    layout: 'trapezoid',
    cards: Object.freeze([
      Object.freeze({ id: 'time', enabled: true }),
      Object.freeze({ id: 'weather', enabled: true }),
      Object.freeze({ id: 'tide', enabled: true }),
      Object.freeze({ id: 'calendar', enabled: true }),
      Object.freeze({ id: 'custom', enabled: false }),
    ]),
    customCard: Object.freeze({
      title: 'NOTE',
      text: '',
      timeFormat: 'HH:mm',
      dateFormat: 'MMM dd, yyyy',
      showTime: false,
    }),
  }),
  weather: Object.freeze({
    location: Object.freeze({
      mode: 'auto',
      latitude: null,
      longitude: null,
      fallbackLocationId: '101281601',
    }),
    tideStationId: 'P2352',
  }),
  menu: Object.freeze({
    customCommands: Object.freeze([]),
    avoidObstacles: true,
    closeOnFocusChange: true,
    autoCloseMs: 0,
    // Terminal emulator for menu commands in terminal mode; empty means
    // auto-detect from the preference chain in menu-command.mjs.
    terminal: '',
  }),
});

const SCHEMA = {
  mouse: {
    buttonsEnabled: 'boolean',
    interactionEnabled: 'boolean',
  },
  wallpaper: { mode: 'wallpaperMode', fit: 'wallpaperFit', crossfadeMs: 'crossfadeMs', perDisplay: 'boolean' },
  color: { mode: 'colorMode', transitionDurationMs: 'colorTransitionDuration' },
  appearance: {
    mode: 'themeMode',
    dark: { wallpaperBrightness: 'wallpaperBrightness' },
  },
  audio: {
    enabled: 'boolean',
    gain: 'positive',
    silenceDelayMs: 'nonNegative',
    fadeOutMs: 'nonNegative',
    fadeInMs: 'nonNegative',
    style: 'audioStyle',
    colorMode: 'audioColorMode',
    colors: { primary: 'hexColor', complement: 'hexColor', neutral: 'hexColor' },
    sensitivity: 'audioSensitivity',
    height: 'audioHeight',
    position: 'audioPosition',
  },
  frameRate: {
    interactive: 'frameRate',
    drift: 'frameRate',
  },
  motion: {
    interactionSpeed: 'positive',
    returnSpeed: 'positive',
    driftSpeed: 'positive',
    deadZonePx: 'nonNegative',
    horizontalPanPercent: 'nonNegative',
    verticalPanPercent: 'nonNegative',
    maxRotationDegrees: 'nonNegative',
    pauseWhenFullscreen: 'boolean',
  },
  panel: {
    autoExpandHide: 'boolean',
    expandTriggerDistancePx: 'nonNegative',
    collapseDelaySeconds: 'nonNegative',
    expanded: 'boolean',
    collapsedOpacity: 'opacity',
    borderRadius: 'panelRadius',
    surfaceOpacity: 'surfaceOpacity',
    shadowIntensity: 'shadowIntensity',
    height: 'panelHeight',
    animation: {
      staggerDelayMs: 'nonNegative',
      durationMs: 'animationDuration',
    },
    layout: 'panelLayout',
    cards: 'panelCards',
    customCard: {
      title: 'string',
      text: 'string',
      timeFormat: 'timeFormat',
      dateFormat: 'dateFormat',
      showTime: 'boolean',
    },
  },
  weather: {
    location: {
      mode: 'locationMode',
      latitude: 'nullableLatitude',
      longitude: 'nullableLongitude',
      fallbackLocationId: 'nonEmptyString',
    },
    tideStationId: 'nonEmptyString',
  },
  menu: {
    customCommands: 'menuCommandList',
    avoidObstacles: 'boolean',
    closeOnFocusChange: 'boolean',
    autoCloseMs: 'nonNegative',
    terminal: 'string',
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const MENU_COMMAND_KEYS = new Set(['id', 'label', 'command', 'mode', 'icon', 'autoExit']);
const MENU_MODES = new Set(['background', 'terminal']);
// 'settings' is reserved for the built-in action that opens the settings
// window from the wallpaper context menu; a custom command must not shadow it.
const RESERVED_MENU_COMMAND_IDS = new Set(['refresh', 'toggle-panel', 'toggle-pause', 'settings']);

function normalizeMenuCommands(value) {
  if (value === undefined) return [...DEFAULT_CONFIG.menu.customCommands];
  if (!Array.isArray(value)) {
    throw new TypeError('menu.customCommands must be an array');
  }
  const ids = new Set();
  return value.map((entry, index) => {
    const path = 'menu.customCommands[' + index + ']';
    if (!isObject(entry)) throw new TypeError(path + ' must be an object');
    for (const key of Object.keys(entry)) {
      if (!MENU_COMMAND_KEYS.has(key)) {
        throw new TypeError('Unknown configuration field: ' + path + '.' + key);
      }
    }
    const { id, label, command, mode, icon, autoExit } = entry;
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError(path + '.id must be a non-empty string');
    }
    if (ids.has(id)) throw new TypeError('Duplicate menu command id: ' + id);
    if (RESERVED_MENU_COMMAND_IDS.has(id)) {
      throw new TypeError('Menu command id is reserved: ' + id);
    }
    ids.add(id);
    if (typeof label !== 'string' || label.trim() === '') {
      throw new TypeError(path + '.label must be a non-empty string');
    }
    if (typeof command !== 'string' || command.trim() === '') {
      throw new TypeError(path + '.command must be a non-empty string');
    }
    if (mode !== undefined && !MENU_MODES.has(mode)) {
      throw new TypeError(path + '.mode must be background or terminal');
    }
    if (icon !== undefined && (typeof icon !== 'string' || icon.trim() === '')) {
      throw new TypeError(path + '.icon must be a non-empty string');
    }
    if (autoExit !== undefined && typeof autoExit !== 'boolean') {
      throw new TypeError(path + '.autoExit must be a boolean');
    }
    return {
      id,
      label,
      command,
      mode: mode ?? 'background',
      // Terminal windows close by default when the command finishes; set
      // autoExit: false to keep the window open.
      autoExit: autoExit ?? true,
      ...(icon !== undefined ? { icon } : {}),
    };
  });
}

function normalizeMenuConfig(value) {
  if (value === undefined) {
    return {
      customCommands: [...DEFAULT_CONFIG.menu.customCommands],
      avoidObstacles: DEFAULT_CONFIG.menu.avoidObstacles,
      closeOnFocusChange: DEFAULT_CONFIG.menu.closeOnFocusChange,
      autoCloseMs: DEFAULT_CONFIG.menu.autoCloseMs,
      terminal: DEFAULT_CONFIG.menu.terminal,
    };
  }
  if (!isObject(value)) throw new TypeError('menu must be an object');
  for (const key of Object.keys(value)) {
    if (key !== 'customCommands'
      && key !== 'avoidObstacles'
      && key !== 'closeOnFocusChange'
      && key !== 'autoCloseMs'
      && key !== 'terminal') {
      throw new TypeError('Unknown configuration field: menu.' + key);
    }
  }
  if (value.avoidObstacles !== undefined && typeof value.avoidObstacles !== 'boolean') {
    throw new TypeError('menu.avoidObstacles must be a boolean');
  }
  if (value.closeOnFocusChange !== undefined && typeof value.closeOnFocusChange !== 'boolean') {
    throw new TypeError('menu.closeOnFocusChange must be a boolean');
  }
  if (value.autoCloseMs !== undefined
    && (!Number.isFinite(value.autoCloseMs) || value.autoCloseMs < 0)) {
    throw new RangeError('menu.autoCloseMs must be a finite number at least 0');
  }
  return {
    customCommands: normalizeMenuCommands(value.customCommands),
    avoidObstacles: value.avoidObstacles ?? DEFAULT_CONFIG.menu.avoidObstacles,
    closeOnFocusChange: value.closeOnFocusChange ?? DEFAULT_CONFIG.menu.closeOnFocusChange,
    autoCloseMs: value.autoCloseMs ?? DEFAULT_CONFIG.menu.autoCloseMs,
    terminal: value.terminal === undefined
      ? DEFAULT_CONFIG.menu.terminal
      : (typeof value.terminal === 'string' ? value.terminal.trim() : value.terminal),
  };
}

const AUDIO_KEYS = new Set([
  'enabled',
  'gain',
  'silenceDelayMs',
  'fadeOutMs',
  'fadeInMs',
  'style',
  'colorMode',
  'colors',
  'sensitivity',
  'height',
  'position',
]);

function isHexColor(value) {
  return typeof value === 'string' && /^#(?:[0-9a-fA-F]{6})$/.test(value.trim());
}

function normalizeAudioConfig(value) {
  if (!isObject(value)) return { ...DEFAULT_CONFIG.audio, colors: { ...DEFAULT_CONFIG.audio.colors } };
  for (const key of Object.keys(value)) {
    if (!AUDIO_KEYS.has(key)) {
      throw new TypeError(`Unknown configuration field: audio.${key}`);
    }
  }
  const validRange = (candidate, min, max, fallback) => (
    Number.isFinite(candidate) && candidate >= min && candidate <= max ? candidate : fallback
  );
  const style = AUDIO_STYLES.includes(value.style) ? value.style : DEFAULT_CONFIG.audio.style;
  const colorMode = AUDIO_COLOR_MODES.includes(value.colorMode) ? value.colorMode : DEFAULT_CONFIG.audio.colorMode;
  const position = AUDIO_POSITIONS.includes(value.position) ? value.position : DEFAULT_CONFIG.audio.position;
  const colorsInput = isObject(value.colors) ? value.colors : {};
  const colors = {
    primary: isHexColor(colorsInput.primary) ? colorsInput.primary.toLowerCase() : DEFAULT_CONFIG.audio.colors.primary,
    complement: isHexColor(colorsInput.complement) ? colorsInput.complement.toLowerCase() : DEFAULT_CONFIG.audio.colors.complement,
    neutral: isHexColor(colorsInput.neutral) ? colorsInput.neutral.toLowerCase() : DEFAULT_CONFIG.audio.colors.neutral,
  };
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_CONFIG.audio.enabled,
    gain: validRange(value.gain, 0.25, 4, DEFAULT_CONFIG.audio.gain),
    silenceDelayMs: validRange(
      value.silenceDelayMs,
      0,
      5000,
      DEFAULT_CONFIG.audio.silenceDelayMs,
    ),
    fadeOutMs: validRange(value.fadeOutMs, 0, 3000, DEFAULT_CONFIG.audio.fadeOutMs),
    fadeInMs: validRange(value.fadeInMs, 0, 3000, DEFAULT_CONFIG.audio.fadeInMs),
    style,
    colorMode,
    colors,
    sensitivity: validRange(value.sensitivity, 0.3, 3, DEFAULT_CONFIG.audio.sensitivity),
    height: Number.isInteger(value.height) && value.height >= 48 && value.height <= 200 ? value.height : DEFAULT_CONFIG.audio.height,
    position,
  };
}

const WALLPAPER_KEYS = new Set(['mode', 'fit', 'crossfadeMs', 'perDisplay']);
function normalizeWallpaperConfig(value) {
  if (!isObject(value)) return { ...DEFAULT_CONFIG.wallpaper };
  for (const key of Object.keys(value)) {
    if (!WALLPAPER_KEYS.has(key)) throw new TypeError(`Unknown configuration field: wallpaper.${key}`);
  }
  return {
    mode: value.mode ?? DEFAULT_CONFIG.wallpaper.mode,
    fit: value.fit ?? DEFAULT_CONFIG.wallpaper.fit,
    crossfadeMs: value.crossfadeMs ?? DEFAULT_CONFIG.wallpaper.crossfadeMs,
    perDisplay: typeof value.perDisplay === 'boolean' ? value.perDisplay : DEFAULT_CONFIG.wallpaper.perDisplay,
  };
}

const PANEL_KEYS = new Set(['autoExpandHide', 'expandTriggerDistancePx', 'collapseDelaySeconds', 'expanded', 'collapsedOpacity', 'borderRadius', 'surfaceOpacity', 'shadowIntensity', 'height', 'animation', 'layout', 'cards', 'customCard']);
function normalizePanelCards(value) {
  if (value === undefined) return DEFAULT_CONFIG.panel.cards.map((c) => ({ ...c }));
  if (!Array.isArray(value)) throw new TypeError('panel.cards must be an array');
  const allowed = new Set(PANEL_CARD_IDS);
  const seen = new Set();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    const path = `panel.cards[${i}]`;
    if (!isObject(entry)) throw new TypeError(`${path} must be an object`);
    const { id, enabled } = entry;
    if (typeof id !== 'string' || !allowed.has(id)) throw new TypeError(`${path}.id must be one of ${[...allowed].join(', ')}`);
    if (seen.has(id)) throw new TypeError(`Duplicate panel card id: ${id}`);
    seen.add(id);
    if (enabled !== undefined && typeof enabled !== 'boolean') throw new TypeError(`${path}.enabled must be a boolean`);
    result.push({ id, enabled: enabled ?? true });
    for (const k of Object.keys(entry)) if (k !== 'id' && k !== 'enabled') throw new TypeError(`Unknown configuration field: ${path}.${k}`);
  }
  // Ensure required 4 are present, auto-add missing disabled? Actually ensure present but don't throw if missing; fill defaults.
  for (const def of DEFAULT_CONFIG.panel.cards) {
    if (def.id !== 'custom' && !seen.has(def.id)) result.push({ ...def });
  }
  return result;
}
function normalizePanelConfig(value) {
  if (!isObject(value)) return { ...DEFAULT_CONFIG.panel, cards: DEFAULT_CONFIG.panel.cards.map((c)=>({...c})), customCard: { ...DEFAULT_CONFIG.panel.customCard }, animation: { ...DEFAULT_CONFIG.panel.animation } };
  for (const key of Object.keys(value)) if (!PANEL_KEYS.has(key)) throw new TypeError(`Unknown configuration field: panel.${key}`);
  const cards = normalizePanelCards(value.cards);
  const customCardInput = isObject(value.customCard) ? value.customCard : {};
  for (const k of Object.keys(customCardInput)) if (!['title','text','timeFormat','dateFormat','showTime'].includes(k)) throw new TypeError(`Unknown configuration field: panel.customCard.${k}`);
  const customCard = {
    title: typeof customCardInput.title === 'string' ? customCardInput.title : DEFAULT_CONFIG.panel.customCard.title,
    text: typeof customCardInput.text === 'string' ? customCardInput.text : DEFAULT_CONFIG.panel.customCard.text,
    timeFormat: TIME_FORMATS.includes(customCardInput.timeFormat) ? customCardInput.timeFormat : DEFAULT_CONFIG.panel.customCard.timeFormat,
    dateFormat: DATE_FORMATS.includes(customCardInput.dateFormat) ? customCardInput.dateFormat : DEFAULT_CONFIG.panel.customCard.dateFormat,
    showTime: typeof customCardInput.showTime === 'boolean' ? customCardInput.showTime : DEFAULT_CONFIG.panel.customCard.showTime,
  };
  if (customCard.title.length > 24) throw new TypeError('panel.customCard.title must be at most 24 characters');
  if (customCard.text.length > 120) throw new TypeError('panel.customCard.text must be at most 120 characters');
  return {
    autoExpandHide: typeof value.autoExpandHide === 'boolean' ? value.autoExpandHide : DEFAULT_CONFIG.panel.autoExpandHide,
    expandTriggerDistancePx: Number.isFinite(value.expandTriggerDistancePx) ? value.expandTriggerDistancePx : DEFAULT_CONFIG.panel.expandTriggerDistancePx,
    collapseDelaySeconds: Number.isFinite(value.collapseDelaySeconds) ? value.collapseDelaySeconds : DEFAULT_CONFIG.panel.collapseDelaySeconds,
    expanded: typeof value.expanded === 'boolean' ? value.expanded : DEFAULT_CONFIG.panel.expanded,
    collapsedOpacity: Number.isFinite(value.collapsedOpacity) ? value.collapsedOpacity : DEFAULT_CONFIG.panel.collapsedOpacity,
    borderRadius: Number.isFinite(value.borderRadius) ? value.borderRadius : DEFAULT_CONFIG.panel.borderRadius,
    surfaceOpacity: Number.isFinite(value.surfaceOpacity) ? value.surfaceOpacity : DEFAULT_CONFIG.panel.surfaceOpacity,
    shadowIntensity: Number.isFinite(value.shadowIntensity) ? value.shadowIntensity : DEFAULT_CONFIG.panel.shadowIntensity,
    height: Number.isFinite(value.height) ? value.height : DEFAULT_CONFIG.panel.height,
    animation: {
      staggerDelayMs: Number.isFinite(value.animation?.staggerDelayMs) ? value.animation.staggerDelayMs : DEFAULT_CONFIG.panel.animation.staggerDelayMs,
      durationMs: Number.isFinite(value.animation?.durationMs) ? value.animation.durationMs : DEFAULT_CONFIG.panel.animation.durationMs,
    },
    layout: PANEL_LAYOUTS.includes(value.layout) ? value.layout : DEFAULT_CONFIG.panel.layout,
    cards,
    customCard,
  };
}

function validateShape(value, schema, prefix = '') {
  if (!isObject(value)) {
    throw new TypeError(`${prefix || 'configuration'} must be an object`);
  }

  for (const key of Object.keys(value)) {
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in schema)) {
      throw new TypeError(`Unknown configuration field: ${fieldPath}`);
    }

    const rule = schema[key];
    const fieldValue = value[key];
    if (isObject(rule)) {
      validateShape(fieldValue, rule, fieldPath);
      continue;
    }

    if (rule === 'boolean' && typeof fieldValue !== 'boolean') {
      throw new TypeError(`${fieldPath} must be a boolean`);
    }
    if (rule === 'frameRate' && (!Number.isInteger(fieldValue)
      || fieldValue < 1 || fieldValue > 180)) {
      throw new RangeError(`${fieldPath} must be an integer between 1 and 180`);
    }
    if (rule === 'positive' && (!Number.isFinite(fieldValue) || fieldValue <= 0)) {
      throw new RangeError(`${fieldPath} must be a finite number greater than 0`);
    }
    if (rule === 'nonNegative' && (!Number.isFinite(fieldValue) || fieldValue < 0)) {
      throw new RangeError(`${fieldPath} must be a finite number at least 0`);
    }
    if (rule === 'opacity' && (!Number.isFinite(fieldValue) || fieldValue < 0 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be between 0 and 1`);
    }
    if (rule === 'panelRadius' && (!Number.isFinite(fieldValue) || fieldValue < 0 || fieldValue > 24)) {
      throw new RangeError(`${fieldPath} must be between 0 and 24`);
    }
    if (rule === 'animationDuration' && (!Number.isFinite(fieldValue) || fieldValue < 400)) {
      throw new RangeError(`${fieldPath} must be at least 400`);
    }
    if (rule === 'locationMode' && !['auto', 'fixed'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be auto or fixed`);
    }
    if (rule === 'wallpaperMode' && !['kde', 'manual'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be kde or manual`);
    }
    if (rule === 'colorMode' && !['default', 'kde', 'wallpaper', 'hybrid'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be default, kde, wallpaper, or hybrid`);
    }
    if (rule === 'colorTransitionDuration' && (!Number.isInteger(fieldValue)
      || fieldValue < 0 || fieldValue > 5000)) {
      throw new RangeError(`${fieldPath} must be an integer between 0 and 5000`);
    }
    if (rule === 'themeMode' && !['light', 'dark', 'system'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be light, dark, or system`);
    }
    if (rule === 'wallpaperBrightness' && (!Number.isFinite(fieldValue)
      || fieldValue < 0.2 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be a finite number between 0.2 and 1`);
    }
    if (rule === 'nullableLatitude' && fieldValue !== null
      && (!Number.isFinite(fieldValue) || fieldValue < -90 || fieldValue > 90)) {
      throw new RangeError(`${fieldPath} must be null or between -90 and 90`);
    }
    if (rule === 'nullableLongitude' && fieldValue !== null
      && (!Number.isFinite(fieldValue) || fieldValue < -180 || fieldValue > 180)) {
      throw new RangeError(`${fieldPath} must be null or between -180 and 180`);
    }
    if (rule === 'string' && typeof fieldValue !== 'string') {
      throw new TypeError(`${fieldPath} must be a string`);
    }
    if (rule === 'nonEmptyString' && (typeof fieldValue !== 'string' || fieldValue.trim() === '')) {
      throw new TypeError(`${fieldPath} must be a non-empty string`);
    }
    if (rule === 'wallpaperFit' && !['cover', 'contain', 'stretch', 'center'].includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be cover, contain, stretch, or center`);
    }
    if (rule === 'crossfadeMs' && (!Number.isInteger(fieldValue) || fieldValue < 0 || fieldValue > 1200)) {
      throw new RangeError(`${fieldPath} must be an integer between 0 and 1200`);
    }
    if (rule === 'surfaceOpacity' && (!Number.isFinite(fieldValue) || fieldValue < 0.2 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be between 0.2 and 1`);
    }
    if (rule === 'panelHeight' && (!Number.isFinite(fieldValue) || fieldValue < 240 || fieldValue > 560)) {
      throw new RangeError(`${fieldPath} must be between 240 and 560`);
    }
    if (rule === 'shadowIntensity' && (!Number.isFinite(fieldValue) || fieldValue < 0 || fieldValue > 1)) {
      throw new RangeError(`${fieldPath} must be between 0 and 1`);
    }
    if (rule === 'panelLayout' && !PANEL_LAYOUTS.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${[...PANEL_LAYOUTS].join(', ')}`);
    }
    if (rule === 'panelCards') {
      if (!Array.isArray(fieldValue)) throw new TypeError(`${fieldPath} must be an array`);
      const allowed = new Set(PANEL_CARD_IDS);
      const seen = new Set();
      for (let i = 0; i < fieldValue.length; i++) {
        const entry = fieldValue[i];
        const path = `${fieldPath}[${i}]`;
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`${path} must be an object`);
        if (typeof entry.id !== 'string' || !allowed.has(entry.id)) throw new TypeError(`${path}.id must be one of ${[...allowed].join(', ')}`);
        if (seen.has(entry.id)) throw new TypeError(`Duplicate panel card id: ${entry.id}`);
        seen.add(entry.id);
        if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') throw new TypeError(`${path}.enabled must be a boolean`);
        for (const k of Object.keys(entry)) if (k !== 'id' && k !== 'enabled') throw new TypeError(`Unknown configuration field: ${path}.${k}`);
      }
    }
    if (rule === 'timeFormat' && !TIME_FORMATS.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${TIME_FORMATS.join(', ')}`);
    }
    if (rule === 'dateFormat' && !DATE_FORMATS.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${DATE_FORMATS.join(', ')}`);
    }
    if (rule === 'audioStyle' && !AUDIO_STYLES.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${[...AUDIO_STYLES].join(', ')}`);
    }
    if (rule === 'audioColorMode' && !AUDIO_COLOR_MODES.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${[...AUDIO_COLOR_MODES].join(', ')}`);
    }
    if (rule === 'hexColor' && !isHexColor(fieldValue)) {
      throw new TypeError(`${fieldPath} must be a hex color like #ff3478`);
    }
    if (rule === 'audioSensitivity' && (!Number.isFinite(fieldValue) || fieldValue < 0.3 || fieldValue > 3)) {
      throw new RangeError(`${fieldPath} must be between 0.3 and 3`);
    }
    if (rule === 'audioHeight' && (!Number.isInteger(fieldValue) || fieldValue < 48 || fieldValue > 200)) {
      throw new RangeError(`${fieldPath} must be an integer between 48 and 200`);
    }
    if (rule === 'audioPosition' && !AUDIO_POSITIONS.includes(fieldValue)) {
      throw new TypeError(`${fieldPath} must be one of ${[...AUDIO_POSITIONS].join(', ')}`);
    }

  }
}

function mergeConfig(value) {
  return {
    mouse: {
      ...DEFAULT_CONFIG.mouse,
      ...(value.mouse ?? {}),
    },
    wallpaper: {
      ...DEFAULT_CONFIG.wallpaper,
      ...(value.wallpaper ?? {}),
    },
    color: {
      ...DEFAULT_CONFIG.color,
      ...(value.color ?? {}),
    },
    appearance: {
      ...DEFAULT_CONFIG.appearance,
      ...(value.appearance ?? {}),
      dark: {
        ...DEFAULT_CONFIG.appearance.dark,
        ...(value.appearance?.dark ?? {}),
      },
    },
    audio: {
      ...DEFAULT_CONFIG.audio,
      ...(value.audio ?? {}),
      colors: {
        ...DEFAULT_CONFIG.audio.colors,
        ...(value.audio?.colors ?? {}),
      },
    },
    frameRate: {
      ...DEFAULT_CONFIG.frameRate,
      ...(value.frameRate ?? {}),
    },
    motion: {
      ...DEFAULT_CONFIG.motion,
      ...(value.motion ?? {}),
    },
    panel: {
      ...DEFAULT_CONFIG.panel,
      ...(value.panel ?? {}),
      animation: {
        ...DEFAULT_CONFIG.panel.animation,
        ...(value.panel?.animation ?? {}),
      },
      customCard: {
        ...DEFAULT_CONFIG.panel.customCard,
        ...(value.panel?.customCard ?? {}),
      },
      cards: value.panel?.cards ?? DEFAULT_CONFIG.panel.cards,
    },
    weather: {
      ...DEFAULT_CONFIG.weather,
      ...(value.weather ?? {}),
      location: {
        ...DEFAULT_CONFIG.weather.location,
        ...(value.weather?.location ?? {}),
      },
    },
    menu: {
      ...DEFAULT_CONFIG.menu,
      ...(value.menu ?? {}),
      customCommands: value.menu?.customCommands ?? DEFAULT_CONFIG.menu.customCommands,
    },
  };
}

// 0.3.2 shipped a single top-level interactionEnabled boolean that both
// made the wallpaper window click-through and disabled parallax. 0.3.3
// splits it into mouse.buttonsEnabled (receive mouse buttons / context menu)
// and mouse.interactionEnabled (pointer-driven parallax); a config that still
// carries the legacy key is migrated to both fields instead of being rejected.
function migrateLegacyConfig(value) {
  if (!isObject(value)) return value;
  let result = value;
  if (typeof result.interactionEnabled === 'boolean' && result.mouse === undefined) {
    const { interactionEnabled, ...rest } = result;
    result = {
      ...rest,
      mouse: { buttonsEnabled: interactionEnabled, interactionEnabled },
    };
  }
  // 0.4.0 removed panel.backdropBlurPx due to subpixel scanline; old configs
  // still carry it and must be stripped instead of rejected.
  if (isObject(result.panel) && 'backdropBlurPx' in result.panel) {
    const { backdropBlurPx, ...panelRest } = result.panel;
    result = { ...result, panel: panelRest };
  }
  // 0.4.1 adds panel.layout/cards/customCard and wallpaper.perDisplay and audio extensions; inject defaults for legacy.
  if (isObject(result.panel)) {
    let panel = result.panel;
    if (!('layout' in panel) || !PANEL_LAYOUTS.includes(panel.layout)) panel = { ...panel, layout: DEFAULT_CONFIG.panel.layout };
    if (!Array.isArray(panel.cards)) panel = { ...panel, cards: DEFAULT_CONFIG.panel.cards.map((c)=>({...c})) };
    else {
      const allowed = new Set(PANEL_CARD_IDS);
      const seen = new Set();
      const cleaned = [];
      for (const e of panel.cards) if (isObject(e) && typeof e.id === 'string' && allowed.has(e.id) && !seen.has(e.id)) {
        seen.add(e.id); cleaned.push({ id: e.id, enabled: e.enabled !== false });
      }
      for (const def of DEFAULT_CONFIG.panel.cards) if (def.id !== 'custom' && !seen.has(def.id)) cleaned.push({ ...def });
      panel = { ...panel, cards: cleaned };
    }
    if (!isObject(panel.customCard)) panel = { ...panel, customCard: { ...DEFAULT_CONFIG.panel.customCard } };
    else {
      const cc = panel.customCard;
      panel = { ...panel, customCard: {
        title: typeof cc.title === 'string' ? cc.title.slice(0,24) : DEFAULT_CONFIG.panel.customCard.title,
        text: typeof cc.text === 'string' ? cc.text.slice(0,120) : DEFAULT_CONFIG.panel.customCard.text,
        timeFormat: TIME_FORMATS.includes(cc.timeFormat) ? cc.timeFormat : DEFAULT_CONFIG.panel.customCard.timeFormat,
        dateFormat: DATE_FORMATS.includes(cc.dateFormat) ? cc.dateFormat : DEFAULT_CONFIG.panel.customCard.dateFormat,
        showTime: typeof cc.showTime === 'boolean' ? cc.showTime : DEFAULT_CONFIG.panel.customCard.showTime,
      }};
    }
    if (!isObject(panel.animation)) panel = { ...panel, animation: { ...DEFAULT_CONFIG.panel.animation } };
    result = { ...result, panel };
  }
  if (isObject(result.wallpaper) && !('perDisplay' in result.wallpaper)) {
    result = { ...result, wallpaper: { ...result.wallpaper, perDisplay: DEFAULT_CONFIG.wallpaper.perDisplay } };
  }
  if (isObject(result.audio)) {
    let audio = result.audio;
    if (!AUDIO_STYLES.includes(audio.style)) audio = { ...audio, style: DEFAULT_CONFIG.audio.style };
    if (!AUDIO_COLOR_MODES.includes(audio.colorMode)) audio = { ...audio, colorMode: DEFAULT_CONFIG.audio.colorMode };
    if (!isObject(audio.colors)) audio = { ...audio, colors: { ...DEFAULT_CONFIG.audio.colors } };
    else {
      const c = audio.colors;
      audio = { ...audio, colors: {
        primary: isHexColor(c.primary) ? c.primary.toLowerCase() : DEFAULT_CONFIG.audio.colors.primary,
        complement: isHexColor(c.complement) ? c.complement.toLowerCase() : DEFAULT_CONFIG.audio.colors.complement,
        neutral: isHexColor(c.neutral) ? c.neutral.toLowerCase() : DEFAULT_CONFIG.audio.colors.neutral,
      }};
    }
    if (!Number.isFinite(audio.sensitivity) || audio.sensitivity < 0.3 || audio.sensitivity > 3) audio = { ...audio, sensitivity: DEFAULT_CONFIG.audio.sensitivity };
    if (!Number.isInteger(audio.height) || audio.height < 48 || audio.height > 200) audio = { ...audio, height: DEFAULT_CONFIG.audio.height };
    if (!AUDIO_POSITIONS.includes(audio.position)) audio = { ...audio, position: DEFAULT_CONFIG.audio.position };
    // legacy barCount/mirrored silently dropped
    if ('barCount' in audio) { const { barCount, ...rest } = audio; audio = rest; }
    if ('mirrored' in audio) { const { mirrored, ...rest } = audio; audio = rest; }
    result = { ...result, audio };
  }
  return result;
}

export function validateConfig(value) {
  if (!isObject(value)) validateShape(value, SCHEMA);
  const migrated = migrateLegacyConfig(value);
  const normalized = {
    ...migrated,
    audio: normalizeAudioConfig(migrated.audio),
    menu: normalizeMenuConfig(migrated.menu),
    wallpaper: normalizeWallpaperConfig(migrated.wallpaper),
    panel: normalizePanelConfig(migrated.panel),
  };
  validateShape(normalized, SCHEMA);
  const result = mergeConfig(normalized);
  const { mode, latitude, longitude } = result.weather.location;
  if (mode === 'fixed' && (!Number.isFinite(latitude) || !Number.isFinite(longitude))) {
    throw new TypeError('weather.location fixed mode requires both latitude and longitude');
  }
  return result;
}

export function weatherCredentialsPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'mip-paper', 'weather-credentials.json');
}

export function informationCachePath(env = process.env, homedir) {
  const base = env.XDG_CACHE_HOME || path.join(homedir, '.cache');
  return path.join(base, 'mip-paper', 'information.json');
}

export function configPath(env = process.env, homedir) {
  const base = env.XDG_CONFIG_HOME || path.join(homedir, '.config');
  return path.join(base, 'mip-paper', 'config.json');
}

export async function loadConfig(pathname) {
  let value;
  try {
    value = JSON.parse(await readFile(pathname, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid JSON in ${pathname}: ${error.message}`);
    }
    throw error;
  }
  return validateConfig(value);
}
