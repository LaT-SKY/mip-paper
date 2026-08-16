import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BOTTOM_SAFE_PX,
  CLOSE_TRANSITION_MS,
  ICONS,
  MENU_STATES,
  OPEN_TRANSITION_MS,
  ROW_STAGGER_MS,
  SPRING,
  buildMenuItems,
  chooseMenuY,
  clampMenuPosition,
  iconFor,
  pickAnchorCorner,
} from '../src/renderer/context-menu.mjs';

test('buildMenuItems orders built-ins before a separator and custom commands', () => {
  const items = buildMenuItems({
    builtins: [
      { id: 'refresh', label: 'Refresh', icon: 'refresh' },
      { id: 'toggle-panel', label: 'Toggle Panel', icon: 'panel', state: 'on' },
    ],
    customCommands: [
      { id: 'downloads', label: 'Open Downloads', command: 'xdg-open ~/Downloads', mode: 'background' },
      { id: 'update', label: 'System Update', command: 'pacman -Syu', mode: 'terminal', icon: 'update' },
    ],
  });
  assert.deepEqual(items, [
    { type: 'builtin', id: 'refresh', label: 'Refresh', icon: 'refresh', state: undefined },
    { type: 'builtin', id: 'toggle-panel', label: 'Toggle Panel', icon: 'panel', state: 'on' },
    { type: 'separator' },
    { type: 'command', id: 'downloads', label: 'Open Downloads', icon: undefined, mode: 'background' },
    { type: 'command', id: 'update', label: 'System Update', icon: 'update', mode: 'terminal' },
  ]);
});

test('buildMenuItems omits the separator when there are no custom commands', () => {
  const items = buildMenuItems({ builtins: [{ id: 'refresh', label: 'Refresh' }], customCommands: [] });
  assert.deepEqual(items, [{ type: 'builtin', id: 'refresh', label: 'Refresh', icon: undefined, state: undefined }]);
});

test('clampMenuPosition keeps the menu inside the viewport at all four edges', () => {
  const viewport = { width: 1920, height: 1080 };
  const menu = { width: 260, height: 320 };
  const nearTopLeft = clampMenuPosition({ x: 0, y: 0, ...menu, viewportWidth: viewport.width, viewportHeight: viewport.height });
  assert.deepEqual(nearTopLeft, { x: 8, y: 8 });
  const nearBottomRight = clampMenuPosition({
    x: viewport.width,
    y: viewport.height,
    ...menu,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });
  assert.deepEqual(nearBottomRight, { x: viewport.width - 260 - 8, y: viewport.height - 320 - 8 });
  const center = clampMenuPosition({
    x: 960,
    y: 540,
    ...menu,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });
  assert.deepEqual(center, { x: 960, y: 540 });
});

test('chooseMenuY stays below, lifts slightly, or flips based on how tight the space is', () => {
  const height = 300;
  const margin = 8;
  const safeBottom = 962;
  // Plenty of room below: stays at the cursor.
  assert.equal(chooseMenuY({ y: 400, height, margin, safeBottom }), 400);
  // Fits exactly with no margin to spare: stays below.
  assert.equal(chooseMenuY({ y: 654, height, margin, safeBottom }), 654);
  // Slight overflow (96px < half the height): lift only to the safe bottom,
  // the menu still grows from near the cursor instead of flipping fully.
  assert.equal(chooseMenuY({ y: 750, height, margin, safeBottom }), safeBottom - height);
  // Large overflow (238px > half the height): flip fully above the cursor.
  assert.equal(chooseMenuY({ y: 900, height, margin, safeBottom }), 900 - height - margin);
  // Conservative bottom inset without a work area also lifts/flips sensibly.
  const noAreaSafeBottom = 1002 - BOTTOM_SAFE_PX;
  assert.equal(chooseMenuY({ y: 750, height, margin, safeBottom: noAreaSafeBottom }), noAreaSafeBottom - height);
  assert.equal(chooseMenuY({ y: 900, height, margin, safeBottom: noAreaSafeBottom }), 900 - height - margin);
});

test('clampMenuPosition keeps the menu inside a safe-area bounds rectangle', () => {
  const viewport = { width: 1920, height: 1080 };
  const menu = { width: 260, height: 320 };
  // A bottom application bar shrinks the work area to 1040px tall.
  const bounds = { x: 0, y: 0, width: 1920, height: 1040 };
  const position = clampMenuPosition({
    x: 960,
    y: 1080,
    ...menu,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    bounds,
  });
  assert.deepEqual(position, { x: 960, y: 1040 - 320 - 8 });
  // Without bounds the same request clamps to the full viewport.
  const unclamped = clampMenuPosition({
    x: 960,
    y: 1080,
    ...menu,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
  });
  assert.deepEqual(unclamped, { x: 960, y: 1080 - 320 - 8 });
});

test('clampMenuPosition tolerates a menu larger than the viewport', () => {
  const position = clampMenuPosition({
    x: 5,
    y: 5,
    width: 3000,
    height: 2000,
    viewportWidth: 1920,
    viewportHeight: 1080,
  });
  assert.equal(position.x, 8);
  assert.equal(position.y, 8);
});

test('pickAnchorCorner returns the menu corner nearest the cursor', () => {
  const width = 260;
  const height = 320;
  assert.equal(pickAnchorCorner({ cursorX: 10, cursorY: 10, x: 100, y: 100, width, height }), 'top-left');
  assert.equal(pickAnchorCorner({ cursorX: 300, cursorY: 10, x: 100, y: 100, width, height }), 'top-right');
  assert.equal(pickAnchorCorner({ cursorX: 10, cursorY: 400, x: 100, y: 100, width, height }), 'bottom-left');
  assert.equal(pickAnchorCorner({ cursorX: 300, cursorY: 400, x: 100, y: 100, width, height }), 'bottom-right');
});

test('iconFor returns inline SVG for known names and empty for unknown', () => {
  assert.match(iconFor('refresh'), /^<svg viewBox="0 0 24 24"/);
  assert.match(iconFor('folder'), /<path/);
  assert.equal(iconFor('missing-name'), '');
  for (const name of Object.keys(ICONS)) {
    assert.match(iconFor(name), /<svg viewBox="0 0 24 24"/);
  }
});

test('animation timing constants are exposed for the state machine', () => {
  assert.equal(OPEN_TRANSITION_MS, 120);
  assert.equal(CLOSE_TRANSITION_MS, 110);
  assert.equal(ROW_STAGGER_MS, 24);
  assert.deepEqual(Object.values(MENU_STATES).sort(), ['closed', 'closing', 'open', 'opening']);
  assert.ok(SPRING.omega > 0 && SPRING.damping > 0 && SPRING.startScale < 1);
});

test('context-menu.css keeps motion to transform/opacity and respects reduced motion', async () => {
  const css = await readFile('src/renderer/context-menu.css', 'utf8');
  assert.ok(!css.includes('transition: all'));
  assert.ok(css.includes('prefers-reduced-motion: reduce'));
  assert.ok(css.includes('transition: none !important'));
  assert.ok(css.includes('#context-menu :focus-visible'));
  assert.ok(css.includes('outline: 2px solid var(--accent)'));
  assert.ok(css.includes('max-height: min(520px, 80vh)'));
  assert.ok(css.includes('max-width: min(320px, calc(100vw - 16px))'));
  assert.ok(css.includes('border-radius: var(--menu-radius)'));
  assert.ok(css.includes('--menu-radius: 16px'));
  assert.ok(css.includes('[data-state="opening"]'));
  assert.ok(css.includes('[data-state="closing"]'));
});

test('context-menu.mjs implements the state machine with a race-safe token', async () => {
  const source = await readFile('src/renderer/context-menu.mjs', 'utf8');
  assert.ok(source.includes('MENU_STATES'));
  assert.ok(source.includes('token += 1'));
  assert.ok(source.includes('cancelMotion()'));
  assert.ok(source.includes('win.cancelAnimationFrame'));
  assert.ok(source.includes('requestAnimationFrame'));
  assert.ok(source.includes('finishClose()'));
  assert.ok(source.includes('setItems: renderItems'));
  assert.ok(source.includes('destroy'));
  // Positioning is set once at open; per-frame motion writes only opacity/transform.
  assert.equal(source.split('root.style.left').length - 1, 1);
  assert.equal(source.split('root.style.top').length - 1, 1);
  assert.ok(source.includes("root.style.opacity = String("));
  assert.ok(source.includes("root.style.transform = 'scale('"));
});

test('context-menu.mjs places the menu exactly at the cursor when avoidance is off', async () => {
  const source = await readFile('src/renderer/context-menu.mjs', 'utf8');
  assert.ok(source.includes('function open(x, y, bounds = null, avoidObstacles = true)'));
  assert.ok(source.includes('if (avoidObstacles === false)'));
  assert.ok(source.includes('position = { x, y };'));
});

test('context-menu.mjs arms a cancelable auto-close timer on open', async () => {
  const source = await readFile('src/renderer/context-menu.mjs', 'utf8');
  assert.ok(source.includes('autoCloseMs = 0'));
  assert.ok(source.includes('let closeTimer = null;'));
  assert.ok(source.includes('function cancelAutoClose()'));
  assert.ok(source.includes('function scheduleAutoClose()'));
  assert.ok(source.includes('win.setTimeout'));
  assert.ok(source.includes('win.clearTimeout'));
  // The timer is armed when the menu opens, cleared on close/destroy, and a
  // non-positive delay disables it entirely.
  assert.ok(source.includes('scheduleAutoClose();'));
  assert.ok(source.includes('cancelAutoClose();'));
  assert.ok(source.includes('delay <= 0'));
});
