import {
  advanceMotion,
  applyPointerSample,
  createMotionState,
} from '../motion.mjs';
import { createScheduler } from '../render-scheduler.mjs';
import { createProbeCollector } from '../performance-probe.mjs';
import { createPanelController } from './panel.mjs';
import { createAudioRibbonController } from './audio-ribbon.mjs';
import { analyzeWallpaperImage, applyAccentState } from './accent.mjs';
import { createWallpaperTransactionCoordinator } from './wallpaper-transaction.mjs';
import {
  applyAppearanceState,
  createBrightnessTransition,
  normalizeAppearanceState,
  sampleBrightness,
} from './appearance.mjs';
import { validateRuntimeConfig } from '../runtime-config.mjs';
import { buildMenuItems, createContextMenu } from './context-menu.mjs';

const canvas = document.getElementById('wallpaper');
const errorOutput = document.getElementById('error');
const context = canvas.getContext('2d', { alpha: false });
// The window's CSS viewport can exceed the display area under Wayland
// fractional scaling (Chromium computes it too large); the canvas always
// fills the window, so track the real canvas size separately from the
// logical display area we render into.
const canvasSize = { width: 0, height: 0 };

if (!context) {
  throw new Error('Canvas 2D context is unavailable');
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(error);
  errorOutput.value = `Wallpaper failed to start: ${message}`;
  errorOutput.hidden = false;
}

function displayPhase(displayId) {
  const text = String(displayId);
  let hash = 0;
  for (const character of text) {
    hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  }
  return hash % 10_000 / 10_000 * Math.PI * 2;
}

function resizeCanvas() {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  canvasSize.width = width;
  canvasSize.height = height;
  return dpr;
}

function draw(image, state, viewport, brightness) {
  const dpr = resizeCanvas();
  // Fill the whole window (which can be larger than the display under
  // Wayland fractional scaling), then clip the wallpaper itself to the
  // display area so it never bleeds onto a neighbouring screen.
  const fillWidth = canvasSize.width || viewport.width;
  const fillHeight = canvasSize.height || viewport.height;
  const cover = Math.max(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * cover;
  const drawHeight = image.naturalHeight * cover;
  const camera = state.camera;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#152229';
  context.fillRect(0, 0, fillWidth, fillHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.save();
  context.beginPath();
  context.rect(0, 0, viewport.width, viewport.height);
  context.clip();
  context.translate(viewport.width / 2 + camera.x, viewport.height / 2 + camera.y);
  context.rotate(camera.angle);
  context.scale(camera.scale, camera.scale);
  context.filter = `brightness(${brightness})`;
  context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
  context.restore();
}

async function loadImage(url) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function start() {
  const bootstrap = await window.wallpaper.getBootstrap();
  let image;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const currentConfig = validateRuntimeConfig(bootstrap.config);
  let currentAppearance = normalizeAppearanceState(bootstrap.appearance);
  let currentColor = bootstrap.color ?? bootstrap.wallpaper?.color ?? null;
  let fullscreenPaused = Boolean(bootstrap.paused);
  let manualPaused = false;
  let paused = fullscreenPaused || manualPaused;
  let latestWallpaper = bootstrap.wallpaper;
  let workArea = bootstrap.workArea ?? null;
  let scheduler = null;
  let schedulerOptions = null;
  let state;
  let viewport;
  const brightnessTransition = createBrightnessTransition(currentAppearance.wallpaperBrightness);
  applyAppearanceState(document.documentElement, currentAppearance, {
    reducedMotion: reducedMotion.matches,
    now: performance.now(),
    transition: brightnessTransition,
  });
  const applyColor = (nextColor) => {
    currentColor = nextColor;
    applyAccentState(document.documentElement, nextColor, { reducedMotion: reducedMotion.matches });
  };
  const wallpaperCoordinator = createWallpaperTransactionCoordinator({
    loadImage,
    analyzeImage: analyzeWallpaperImage,
    submitAccent: (submission) => window.wallpaper.submitWallpaperAccent(submission),
    applyColor,
    promoteImage: (nextImage) => {
      image = nextImage;
      if (paused) drawOnce();
    },
  });
  const unsubscribeColor = window.wallpaper.onColorUpdated(applyColor);
  const unsubscribeWallpaper = window.wallpaper.onWallpaperUpdated((wallpaper) => {
    latestWallpaper = wallpaper;
    void wallpaperCoordinator.apply(wallpaper).catch((error) => {
      console.error(`Wallpaper update failed: ${error?.message || error}`);
    });
  });
  const [, information] = await Promise.all([
    wallpaperCoordinator.apply(bootstrap.wallpaper),
    window.wallpaper.getInformationSnapshot(),
  ]);
  const { display } = bootstrap;
  // Render into the display area (device-independent pixels), not the window's
  // CSS viewport, so content stays inside the physical screen even when
  // Chromium over-sizes the Wayland window.
  viewport = { width: Math.max(display.bounds.width, 1), height: Math.max(display.bounds.height, 1) };
  state = createMotionState(currentConfig, viewport, displayPhase(display.id));
  const panel = createPanelController({
    root: document.getElementById('information-panel'),
    cards: [...document.querySelectorAll('[data-panel-card]')],
    config: currentConfig.panel,
    viewport,
  });
  const audioRibbon = createAudioRibbonController({
    root: document.querySelector('[data-audio-ribbon]'),
    config: currentConfig.audio,
  });
  panel.setInformation(information ?? bootstrap.information);
  audioRibbon.setSnapshot(bootstrap.audioSpectrum, performance.now());
  const menu = createContextMenu({
    root: document.getElementById('context-menu'),
    version: bootstrap.appVersion,
    reducedMotion: reducedMotion.matches,
    onAction: handleMenuAction,
    viewport,
  });

  function buildBuiltins() {
    return [
      { id: 'refresh', label: '刷新壁纸', icon: 'refresh' },
      {
        id: 'toggle-panel',
        label: panel.expanded() ? '收起信息面板' : '展开信息面板',
        icon: 'panel',
      },
      {
        id: 'toggle-pause',
        label: paused ? '恢复壁纸' : '暂停壁纸',
        icon: paused ? 'play' : 'pause',
      },
    ];
  }

  function rebuildMenuItems() {
    menu.setItems(buildMenuItems({
      builtins: buildBuiltins(),
      customCommands: currentConfig.menu?.customCommands ?? [],
    }));
  }

  function handleMenuAction(id) {
    if (id === 'refresh') {
      refreshWallpaper();
      return;
    }
    if (id === 'toggle-panel') {
      panel.toggleExpanded();
      return;
    }
    if (id === 'toggle-pause') {
      manualPaused = !manualPaused;
      applyEffectivePause();
      return;
    }
    void window.wallpaper.runMenuCommand({ id }).catch((error) => {
      console.error(`Menu command failed: ${error?.message || error}`);
    });
  }

  const unsubscribeInformation = window.wallpaper.onInformationUpdated((snapshot) => panel.setInformation(snapshot));
  const unsubscribeAudio = window.wallpaper.onAudioSpectrumUpdated((snapshot) => {
    audioRibbon.setSnapshot(snapshot, performance.now());
  });
  const unsubscribeConfig = window.wallpaper.onConfigUpdated((candidate) => {
    try {
      const nextConfig = validateRuntimeConfig(candidate.config);
      const nextAppearance = normalizeAppearanceState(candidate.appearance);
      Object.assign(currentConfig, nextConfig);
      currentAppearance = nextAppearance;
      applyAppearanceState(document.documentElement, currentAppearance, {
        reducedMotion: reducedMotion.matches,
        now: performance.now(),
        transition: brightnessTransition,
      });
      panel.setConfig(currentConfig.panel);
      audioRibbon.setConfig(currentConfig.audio);
      if (menu.isOpen()) rebuildMenuItems();
      if (!currentConfig.interactionEnabled) {
        state.pointer.initialized = false;
        state.pointer.lastInput = -Infinity;
      }
      if (paused) drawOnce();
    } catch (error) {
      console.error(`Runtime configuration ignored: ${error?.message || error}`);
    }
  });
  const unsubscribeFullscreen = window.wallpaper.onFullscreenUpdated(({ paused: nextPaused }) => {
    setPaused(Boolean(nextPaused));
  });
  const unsubscribeWorkArea = window.wallpaper.onWorkAreaUpdated((rect) => {
    workArea = rect ?? null;
  });
  const unsubscribeMenuOpened = window.wallpaper.onMenuOpened(() => {
    if (menu.isOpen()) menu.close();
  });
  // The KWin coordinator may push the work area before this renderer finished
  // subscribing; re-query once now that the listener is live.
  void window.wallpaper.getWorkArea().then((rect) => {
    if (rect) workArea = rect;
  }).catch(() => {});
  const onReducedMotionChanged = () => {
    applyAppearanceState(document.documentElement, currentAppearance, {
      reducedMotion: reducedMotion.matches,
      now: performance.now(),
      transition: brightnessTransition,
    });
    if (currentColor) applyColor(currentColor);
    if (paused) drawOnce();
  };
  reducedMotion.addEventListener('change', onReducedMotionChanged);
  window.addEventListener('pagehide', () => {
    unsubscribeInformation();
    unsubscribeAudio();
    unsubscribeConfig();
    unsubscribeColor();
    unsubscribeWallpaper();
    unsubscribeFullscreen();
    unsubscribeWorkArea();
    unsubscribeMenuOpened();
    reducedMotion.removeEventListener('change', onReducedMotionChanged);
    window.removeEventListener('pointerdown', handleAnyPointerDown);
    menu.destroy();
    audioRibbon.destroy();
  }, { once: true });
  const advanceScene = (...args) => {
    advanceMotion(...args);
    panel.advance(args[1], state.camera, state.pointer);
    audioRibbon.advance(args[1] * 1000, args[2] * 1000);
  };
  function drawOnce() {
    if (!image || !state || !viewport) return;
    draw(image, state, viewport, sampleBrightness(brightnessTransition, performance.now()));
  }

  function setPaused(nextFullscreenPaused) {
    fullscreenPaused = Boolean(nextFullscreenPaused);
    applyEffectivePause();
  }

  function applyEffectivePause() {
    const nextPaused = fullscreenPaused || manualPaused;
    if (paused === nextPaused) return;
    paused = nextPaused;
    if (paused) {
      scheduler?.stop();
    } else if (scheduler && schedulerOptions) {
      scheduler.start(schedulerOptions);
    }
  }

  function refreshWallpaper() {
    if (!latestWallpaper) return;
    const separator = latestWallpaper.wallpaperUrl.includes('?') ? '&' : '?';
    const freshUrl = latestWallpaper.wallpaperUrl + separator + 'v=' + Date.now();
    void wallpaperCoordinator.apply({ ...latestWallpaper, wallpaperUrl: freshUrl }).catch((error) => {
      console.error(`Wallpaper refresh failed: ${error?.message || error}`);
    });
  }
  const probe = bootstrap.probe?.enabled ? bootstrap.probe : null;
  if (probe) {
    const collector = createProbeCollector({ clock: () => performance.now() / 1000 });
    collector.configure({
      strategy: probe.strategy,
      displayId: display.id,
      mode: state.mode,
      scenario: probe.scenario,
      targetFrameRate: currentConfig.frameRate.interactive,
    });
    const scheduler = createScheduler(probe.strategy);
    scheduler.start({
      state,
      config: currentConfig,
      viewport,
      panelActive: () => panel.attention(),
      advance: (...args) => {
        const started = performance.now();
        advanceScene(...args);
        collector.recordWork(performance.now() - started);
      },
      draw: (...args) => {
        const started = performance.now();
        draw(image, args[0], args[1], sampleBrightness(brightnessTransition, performance.now()));
        collector.recordDraw(performance.now() - started);
      },
      report: (event) => {
        if (event.type === 'callback') collector.recordCallback(event.intervalMs);
        if (event.type === 'missed-deadline') collector.recordMissedDeadline();
        collector.updateContext({ mode: state.mode, targetFrameRate: event.targetFrameRate });
      },
    });
    if (probe.scenario === 'sweep') {
      let phase = 0;
      window.setInterval(() => {
        phase += 0.08;
        applyPointerSample(
          state.pointer,
          (Math.sin(phase) * 0.45 + 0.5) * viewport.width,
          (Math.cos(phase * 0.71) * 0.45 + 0.5) * viewport.height,
          performance.now() / 1000,
          currentConfig.motion.deadZonePx,
          viewport,
        );
      }, 16);
    } else if (probe.scenario === 'return') {
      const sampleTime = performance.now() / 1000;
      applyPointerSample(
        state.pointer,
        viewport.width / 2,
        viewport.height / 2,
        sampleTime,
        currentConfig.motion.deadZonePx,
        viewport,
      );
      applyPointerSample(
        state.pointer,
        viewport.width * 0.8,
        viewport.height * 0.7,
        sampleTime,
        currentConfig.motion.deadZonePx,
        viewport,
      );
    }
    window.setInterval(() => {
      const summary = collector.flush();
      if (summary) void window.wallpaper.reportProbe(summary);
    }, 1000);
    return;
  }
  scheduler = createScheduler('adaptive');
  schedulerOptions = {
    state,
    config: currentConfig,
    viewport,
    panelActive: () => panel.attention(),
    advance: advanceScene,
    draw: (nextState, nextViewport) => draw(
      image,
      nextState,
      nextViewport,
      sampleBrightness(brightnessTransition, performance.now()),
    ),
  };
  scheduler.start(schedulerOptions);
  if (paused) scheduler.stop();

  canvas.addEventListener('pointermove', (event) => {
    if (!currentConfig.interactionEnabled) return;
    if (menu.isOpen()) return;
    const rect = canvas.getBoundingClientRect();
    const accepted = applyPointerSample(
      state.pointer,
      event.clientX - rect.left,
      event.clientY - rect.top,
      performance.now() / 1000,
      currentConfig.motion.deadZonePx,
      viewport,
    );
    if (accepted && state.mode === 'drift') {
    }
    if (accepted) panel.recordPointer(event.clientX - rect.left, event.clientY - rect.top, performance.now());
  });

  canvas.addEventListener('pointerleave', () => {
    state.pointer.initialized = false;
    state.pointer.lastInput = -Infinity;
  });

  // Any pointer press on any display closes every other display's context
  // menu, so at most one menu exists across the whole desktop.
  const handleAnyPointerDown = () => {
    window.wallpaper.notifyMenuOpened();
  };
  window.addEventListener('pointerdown', handleAnyPointerDown);

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    rebuildMenuItems();
    let bounds = null;
    if (currentConfig.menu.avoidObstacles && workArea) {
      // The work area is normalized to the display, which is the same space
      // as the render viewport, so it can be used directly.
      bounds = workArea;
    }
    window.wallpaper.notifyMenuOpened();
    menu.open(event.clientX, event.clientY, bounds);
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    panel.resize(viewport.width, viewport.height);
    audioRibbon.resize();
    if (paused) drawOnce();
  });

}

start().catch(showError);
