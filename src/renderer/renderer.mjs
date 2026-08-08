import {
  advanceMotion,
  applyPointerSample,
  createMotionState,
  requestedFrameRate,
} from '../motion.mjs';
import { createScheduler } from '../render-scheduler.mjs';
import { createProbeCollector } from '../performance-probe.mjs';

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

async function loadImage() {
  const image = new Image();
  image.src = new URL('../../assets/161-2.jpeg', import.meta.url).href;
  await image.decode();
  return image;
}

async function start() {
  const [bootstrap, image] = await Promise.all([
    window.wallpaper.getBootstrap(),
    loadImage(),
  ]);
  const { config, display } = bootstrap;
  const viewport = { width: Math.max(canvas.clientWidth, 1), height: Math.max(canvas.clientHeight, 1) };
  const state = createMotionState(config, viewport, displayPhase(display.id));
  const probe = bootstrap.probe?.enabled ? bootstrap.probe : null;
  if (probe) {
    const collector = createProbeCollector({ clock: () => performance.now() / 1000 });
    collector.configure({
      strategy: probe.strategy,
      displayId: display.id,
      mode: state.mode,
      scenario: probe.scenario,
      targetFrameRate: config.frameRate.interactive,
    });
    const scheduler = createScheduler(probe.strategy);
    scheduler.start({
      state,
      config,
      viewport,
      advance: (...args) => {
        const started = performance.now();
        advanceMotion(...args);
        collector.recordWork(performance.now() - started);
      },
      draw: (...args) => {
        const started = performance.now();
        draw(image, ...args);
        collector.recordDraw(performance.now() - started);
      },
      report: (event) => {
        if (event.type === 'missed-deadline') collector.recordMissedDeadline();
      },
    });
    window.setInterval(() => {
      const summary = collector.flush();
      if (summary) void window.wallpaper.reportProbe(summary);
    }, 1000);
    return;
  }
  let previousTime = performance.now();
  let timerId;
  let frameRequested = false;

  function requestNextFrame(immediate = false) {
    if (frameRequested) {
      return;
    }
    frameRequested = true;
    const delay = immediate ? 0 : Math.max(0, 1000 / requestedFrameRate(state, config) - 2);
    timerId = window.setTimeout(() => {
      requestAnimationFrame(frame);
    }, delay);
  }

  function frame(time) {
    frameRequested = false;
    const elapsed = Math.max(0, (time - previousTime) / 1000);
    previousTime = time;
    resizeCanvas(viewport);
    advanceMotion(state, elapsed, time / 1000, config, viewport);
    draw(image, state, viewport);
    requestNextFrame();
  }

  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const accepted = applyPointerSample(
      state.pointer,
      event.clientX - rect.left,
      event.clientY - rect.top,
      performance.now() / 1000,
      config.motion.deadZonePx,
      viewport,
    );
    if (accepted && state.mode === 'drift') {
      window.clearTimeout(timerId);
      frameRequested = false;
      requestNextFrame(true);
    }
  });

  canvas.addEventListener('pointerleave', () => {
    state.pointer.initialized = false;
    state.pointer.lastInput = -Infinity;
  });

  requestNextFrame(true);
}

start().catch(showError);
