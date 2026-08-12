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
import { validateRuntimeConfig } from '../runtime-config.mjs';

const canvas = document.getElementById('wallpaper');
const errorOutput = document.getElementById('error');
const context = canvas.getContext('2d', { alpha: false });

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

function resizeCanvas(viewport) {
  const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  const width = Math.max(canvas.clientWidth, 1);
  const height = Math.max(canvas.clientHeight, 1);
  const backingWidth = Math.round(width * dpr);
  const backingHeight = Math.round(height * dpr);

  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  viewport.width = width;
  viewport.height = height;
  return dpr;
}

function draw(image, state, viewport) {
  const dpr = resizeCanvas(viewport);
  const cover = Math.max(viewport.width / image.naturalWidth, viewport.height / image.naturalHeight);
  const drawWidth = image.naturalWidth * cover;
  const drawHeight = image.naturalHeight * cover;
  const camera = state.camera;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = '#152229';
  context.fillRect(0, 0, viewport.width, viewport.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.save();
  context.translate(viewport.width / 2 + camera.x, viewport.height / 2 + camera.y);
  context.rotate(camera.angle);
  context.scale(camera.scale, camera.scale);
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
  const applyColor = (nextColor) => {
    applyAccentState(document.documentElement, nextColor, { reducedMotion: reducedMotion.matches });
  };
  const wallpaperCoordinator = createWallpaperTransactionCoordinator({
    loadImage,
    analyzeImage: analyzeWallpaperImage,
    submitAccent: (submission) => window.wallpaper.submitWallpaperAccent(submission),
    applyColor,
    promoteImage: (nextImage) => { image = nextImage; },
  });
  const unsubscribeColor = window.wallpaper.onColorUpdated(applyColor);
  const unsubscribeWallpaper = window.wallpaper.onWallpaperUpdated((wallpaper) => {
    void wallpaperCoordinator.apply(wallpaper).catch((error) => {
      console.error(`Wallpaper update failed: ${error?.message || error}`);
    });
  });
  const [, information] = await Promise.all([
    wallpaperCoordinator.apply(bootstrap.wallpaper),
    window.wallpaper.getInformationSnapshot(),
  ]);
  const currentConfig = validateRuntimeConfig(bootstrap.config);
  const { display } = bootstrap;
  const viewport = { width: Math.max(canvas.clientWidth, 1), height: Math.max(canvas.clientHeight, 1) };
  const state = createMotionState(currentConfig, viewport, displayPhase(display.id));
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
  const unsubscribeInformation = window.wallpaper.onInformationUpdated((snapshot) => panel.setInformation(snapshot));
  const unsubscribeAudio = window.wallpaper.onAudioSpectrumUpdated((snapshot) => {
    audioRibbon.setSnapshot(snapshot, performance.now());
  });
  const unsubscribeConfig = window.wallpaper.onConfigUpdated((candidate) => {
    try {
      const nextConfig = validateRuntimeConfig(candidate);
      Object.assign(currentConfig, nextConfig);
      panel.setConfig(currentConfig.panel);
      audioRibbon.setConfig(currentConfig.audio);
      if (!currentConfig.interactionEnabled) {
        state.pointer.initialized = false;
        state.pointer.lastInput = -Infinity;
      }
    } catch (error) {
      console.error(`Runtime configuration ignored: ${error?.message || error}`);
    }
  });
  window.addEventListener('pagehide', () => {
    unsubscribeInformation();
    unsubscribeAudio();
    unsubscribeConfig();
    unsubscribeColor();
    unsubscribeWallpaper();
    audioRibbon.destroy();
  }, { once: true });
  const advanceScene = (...args) => {
    advanceMotion(...args);
    panel.advance(args[1], state.camera, state.pointer);
    audioRibbon.advance(args[1] * 1000, args[2] * 1000);
  };
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
      advance: (...args) => {
        const started = performance.now();
        advanceScene(...args);
        collector.recordWork(performance.now() - started);
      },
      draw: (...args) => {
        const started = performance.now();
        draw(image, ...args);
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
  const scheduler = createScheduler('adaptive');
  scheduler.start({
    state,
    config: currentConfig,
    viewport,
    advance: advanceScene,
    draw: (nextState, nextViewport) => draw(image, nextState, nextViewport),
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!currentConfig.interactionEnabled) return;
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

  window.addEventListener('resize', () => {
    panel.resize(
      Math.max(canvas.clientWidth, 1),
      Math.max(canvas.clientHeight, 1),
    );
    audioRibbon.resize();
  });

}

start().catch(showError);
