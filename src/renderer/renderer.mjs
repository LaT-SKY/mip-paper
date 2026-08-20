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

export function computeWallpaperRect(viewport, image, fit = 'cover') {
  const vw = viewport.width;
  const vh = viewport.height;
  const iw = image.naturalWidth || image.width || 1;
  const ih = image.naturalHeight || image.height || 1;
  if (fit === 'stretch') {
    return { drawWidth: vw, drawHeight: vh, mode: 'stretch' };
  }
  if (fit === 'center') {
    return { drawWidth: iw, drawHeight: ih, mode: 'center' };
  }
  if (fit === 'contain') {
    const s = Math.min(vw / iw, vh / ih);
    return { drawWidth: iw * s, drawHeight: ih * s, mode: 'contain' };
  }
  const s = Math.max(vw / iw, vh / ih);
  return { drawWidth: iw * s, drawHeight: ih * s, mode: 'cover' };
}

function drawWallpaperImage(image, state, viewport, fit) {
  const rect = computeWallpaperRect(viewport, image, fit);
  const camera = state.camera;
  context.save();
  context.beginPath();
  context.rect(0, 0, viewport.width, viewport.height);
  context.clip();
  context.translate(viewport.width / 2 + camera.x, viewport.height / 2 + camera.y);
  context.rotate(camera.angle);
  context.scale(camera.scale, camera.scale);
  if (rect.mode === 'stretch') {
    context.drawImage(image, -rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
  } else {
    context.drawImage(image, -rect.drawWidth / 2, -rect.drawHeight / 2, rect.drawWidth, rect.drawHeight);
  }
  context.restore();
}

function draw(image, state, viewport, brightness, fit = 'cover', crossfade = null) {
  const dpr = resizeCanvas();
  const fillWidth = canvasSize.width || viewport.width;
  const fillHeight = canvasSize.height || viewport.height;
  const camera = state.camera;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#152229';
  context.fillRect(0, 0, fillWidth, fillHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  if (crossfade && crossfade.from && crossfade.to && crossfade.progress < 1) {
    const t = crossfade.progress;
    context.save();
    context.globalAlpha = 1 - t;
    context.filter = `brightness(${brightness})`;
    drawWallpaperImage(crossfade.from, state, viewport, fit);
    context.restore();
    context.save();
    context.globalAlpha = t;
    context.filter = `brightness(${brightness})`;
    drawWallpaperImage(crossfade.to, state, viewport, fit);
    context.restore();
    return;
  }
  context.save();
  context.filter = `brightness(${brightness})`;
  drawWallpaperImage(image, state, viewport, fit);
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
  let crossfadeState = null;
  let crossfadeRaf = 0;
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
      const prev = image;
      const duration = currentConfig.wallpaper.crossfadeMs ?? 420;
      const canCrossfade = prev && nextImage && prev !== nextImage && duration > 0 && !reducedMotion.matches;
      if (canCrossfade) {
        crossfadeState = { from: prev, to: nextImage, start: performance.now(), duration };
        image = nextImage;
        if (paused) {
          if (crossfadeRaf) cancelAnimationFrame(crossfadeRaf);
          drawOnceWithCrossfade();
        }
      } else {
        if (crossfadeRaf) { cancelAnimationFrame(crossfadeRaf); crossfadeRaf = 0; }
        crossfadeState = null;
        image = nextImage;
        if (paused) drawOnce();
      }
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
  function applyPanelRadius(radius) {
    const value = Number.isFinite(radius) ? Math.max(0, Math.min(24, radius)) : 16;
    document.documentElement.style.setProperty('--panel-radius', `${value}px`);
  }
  function applyPanelSurface(panelCfg) {
    const opacity = Number.isFinite(panelCfg.surfaceOpacity) ? Math.min(1, Math.max(0.2, panelCfg.surfaceOpacity)) : 0.77;
    const shadow = Number.isFinite(panelCfg.shadowIntensity) ? Math.min(1, Math.max(0, panelCfg.shadowIntensity)) : 1;
    document.documentElement.style.setProperty('--panel-surface-alpha', String(opacity));
    // shadowIntensity 控制重点色装饰的尺寸（图中红圈的描边与底线），非透明度
    document.documentElement.style.setProperty('--panel-shadow-size', String(shadow));
    // 兼容旧变量名
    document.documentElement.style.setProperty('--panel-shadow-alpha', String(shadow));
  }
  function applyPanelHeight(panelCfg) {
    const h = Number.isFinite(panelCfg.height) ? Math.min(560, Math.max(240, panelCfg.height)) : 400;
    // Expose as factor for CSS if needed, but primary motion scaling is in JS panel controller.
    document.documentElement.style.setProperty('--panel-height', `${h}px`);
  }
  applyPanelRadius(currentConfig.panel.borderRadius);
  applyPanelSurface(currentConfig.panel);
  applyPanelHeight(currentConfig.panel);
  function sampleCrossfade() {
    if (!crossfadeState) return null;
    const elapsed = performance.now() - crossfadeState.start;
    const t = Math.min(1, Math.max(0, elapsed / crossfadeState.duration));
    if (t >= 1) {
      const done = crossfadeState;
      crossfadeState = null;
      return { from: done.from, to: done.to, progress: 1 };
    }
    return { from: crossfadeState.from, to: crossfadeState.to, progress: t };
  }
  function drawOnceWithCrossfade() {
    if (!image || !state || !viewport) return;
    const fit = currentConfig.wallpaper.fit || 'cover';
    const brightness = sampleBrightness(brightnessTransition, performance.now());
    const cf = sampleCrossfade();
    draw(image, state, viewport, brightness, fit, cf);
    if (cf && cf.progress < 1) {
      crossfadeRaf = requestAnimationFrame(drawOnceWithCrossfade);
    } else if (crossfadeRaf) {
      cancelAnimationFrame(crossfadeRaf);
      crossfadeRaf = 0;
    }
  }
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
    // Read live so a hot-reloaded auto-close delay applies on the next open.
    autoCloseMs: () => currentConfig.menu.autoCloseMs,
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
      // Opens the visual settings window (normal framed window, above the
      // wallpaper). Handled here before the custom-command fallthrough; the id
      // is reserved in config.mjs so a user command cannot shadow it.
      { id: 'settings', label: '设置', icon: 'settings' },
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
    if (id === 'settings') {
      void window.wallpaper.openSettings().catch((error) => {
        console.error('Settings window failed to open: ' + (error?.message || error));
      });
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
      applyPanelRadius(currentConfig.panel.borderRadius);
      applyPanelSurface(currentConfig.panel);
      applyPanelHeight(currentConfig.panel);
      audioRibbon.setConfig(currentConfig.audio);
      if (menu.isOpen()) rebuildMenuItems();
      if (!currentConfig.mouse.interactionEnabled) {
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
  // Dismiss the menu when a non-wallpaper window is activated (focus moved
  // to another app) or when the KWin coordinator is unavailable to a timed
  // auto-close delay. Both paths are gated by menu config on their own side.
  const unsubscribeMenuClose = window.wallpaper.onMenuCloseRequest(() => {
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
    if (crossfadeState && reducedMotion.matches) {
      crossfadeState = null;
      if (crossfadeRaf) { cancelAnimationFrame(crossfadeRaf); crossfadeRaf = 0; }
    }
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
    unsubscribeMenuClose();
    reducedMotion.removeEventListener('change', onReducedMotionChanged);
    window.removeEventListener('pointerdown', handleAnyPointerDown);
    menu.destroy();
    audioRibbon.destroy();
  }, { once: true });
  const advanceScene = (...args) => {
    try {
      advanceMotion(...args);
    } catch (error) {
      console.error('motion advance failed:', error);
    }
    try {
      panel.advance(args[1], state.camera, state.pointer);
    } catch (error) {
      console.error('panel advance failed:', error);
    }
    try {
      audioRibbon.advance(args[1] * 1000, args[2] * 1000);
    } catch (error) {
      console.error('audio ribbon advance failed:', error);
    }
  };
  function drawOnce() {
    if (!image || !state || !viewport) return;
    if (crossfadeState) { drawOnceWithCrossfade(); return; }
    draw(image, state, viewport, sampleBrightness(brightnessTransition, performance.now()), currentConfig.wallpaper.fit || 'cover', null);
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
        const cf = sampleCrossfade();
        draw(image, args[0], args[1], sampleBrightness(brightnessTransition, performance.now()), currentConfig.wallpaper.fit || 'cover', cf);
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
    draw: (nextState, nextViewport) => {
      const cf = sampleCrossfade();
      draw(image, nextState, nextViewport, sampleBrightness(brightnessTransition, performance.now()), currentConfig.wallpaper.fit || 'cover', cf);
    },
  };
  scheduler.start(schedulerOptions);
  if (paused) scheduler.stop();

  canvas.addEventListener('pointermove', (event) => {
    if (!currentConfig.mouse.interactionEnabled) return;
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

  canvas.addEventListener('pointerleave', (event) => {
    state.pointer.initialized = false;
    state.pointer.lastInput = -Infinity;
    if (!currentConfig.menu.closeOnFocusChange || !menu.isOpen()) return;
    // Dismiss the open menu when the pointer leaves the wallpaper onto
    // another window/panel. Focus-change dismissal (windowActivated) only
    // fires when a DIFFERENT window gains focus, so clicking the window that
    // is already focused would otherwise leave the menu open. The pointer
    // must leave the wallpaper surface to click any other window, so this
    // covers that case. Same dismissal-policy toggle as focus change.
    //
    // The context menu itself is a sibling surface stacked above the canvas,
    // so moving the pointer onto it fires pointerleave on the canvas; never
    // dismiss the menu while the pointer is still over it.
    const menuRoot = document.getElementById('context-menu');
    const target = document.elementFromPoint(event.clientX, event.clientY)
      ?? event.relatedTarget;
    if (menuRoot && target && menuRoot.contains(target)) return;
    // Also keep the menu open when the pointer moves onto one of our own app
    // UI windows (e.g. a future settings dialog). The main process owns the
    // registry and answers with the current cursor position.
    void window.wallpaper.isPointerOverAppUi().then((overAppUi) => {
      if (overAppUi) return;
      if (menu.isOpen()) menu.close();
    }).catch(() => {
      if (menu.isOpen()) menu.close();
    });
  });

  // Any pointer press on any display closes every other display's context
  // menu, so at most one menu exists across the whole desktop.
  const handleAnyPointerDown = () => {
    window.wallpaper.notifyMenuOpened();
  };
  window.addEventListener('pointerdown', handleAnyPointerDown);

  canvas.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    // The window is click-through while mouse.buttonsEnabled is false, so
    // this event normally never arrives; keep the guard so a stray event can
    // never surface the menu.
    if (!currentConfig.mouse.buttonsEnabled) return;
    rebuildMenuItems();
    let bounds = null;
    if (currentConfig.menu.avoidObstacles && workArea) {
      // The work area is normalized to the display, which is the same space
      // as the render viewport, so it can be used directly.
      bounds = workArea;
    }
    window.wallpaper.notifyMenuOpened();
    menu.open(event.clientX, event.clientY, bounds, currentConfig.menu.avoidObstacles);
  });

  window.addEventListener('resize', () => {
    resizeCanvas();
    panel.resize(viewport.width, viewport.height);
    audioRibbon.resize();
    if (paused) drawOnce();
  });

}

start().catch(showError);
