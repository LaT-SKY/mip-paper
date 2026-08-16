import dbus from '@particle/dbus-next';

export const FULLSCREEN_SERVICE = 'org.mip.Paper';
export const FULLSCREEN_PATH = '/Fullscreen';
export const FULLSCREEN_INTERFACE = 'org.mip.Paper.Fullscreen';
export const FULLSCREEN_METHOD = 'SetOutputFullscreen';

// Pure per-output fullscreen state tracker. Emits a change record only when a
// key actually toggles, so heartbeat re-pushes from the KWin script are deduped.
export function createFullscreenTracker() {
  const state = new Map();

  return {
    apply(outputKey, fullscreen) {
      const previous = state.get(outputKey) ?? false;
      if (previous === fullscreen) return null;
      state.set(outputKey, fullscreen);
      return { outputKey, paused: fullscreen };
    },
    reset() {
      const changes = [];
      for (const [outputKey, paused] of state) {
        if (paused) changes.push({ outputKey, paused: false });
      }
      state.clear();
      return changes;
    },
  };
}

function displayMatches(display, x, y, width, height) {
  const bounds = display.bounds;
  return Math.abs(bounds.x - x) <= 1
    && Math.abs(bounds.y - y) <= 1
    && Math.abs(bounds.width - width) <= 1
    && Math.abs(bounds.height - height) <= 1;
}

// Receives per-output fullscreen pushes from the KWin coordinator script over
// the session bus and translates them into per-display pause events.
export function createFullscreenWatcher({
  dbusModule = dbus,
  getDisplays,
  onStateChange = () => {},
  enabled = () => true,
  log = () => {},
} = {}) {
  let bus = null;
  let started = false;
  let enabledState = false;
  const pauseByDisplay = new Map();
  const tracker = createFullscreenTracker();

  function setPaused(displayId, paused) {
    const wasPaused = pauseByDisplay.has(displayId);
    if (wasPaused === paused) return;
    if (paused) pauseByDisplay.set(displayId, true);
    else pauseByDisplay.delete(displayId);
    onStateChange(displayId, paused);
  }

  function unpauseAll() {
    for (const change of tracker.reset()) {
      setPaused(Number(change.outputKey), false);
    }
  }

  function handleMethod(msg) {
    if (msg.path !== FULLSCREEN_PATH
      || msg.interface !== FULLSCREEN_INTERFACE
      || msg.member !== FULLSCREEN_METHOD) {
      return false;
    }
    const body = msg.body;
    if (!Array.isArray(body) || body.length !== 6) return false;
    const [, x, y, width, height, fullscreen] = body;
    // Always acknowledge well-formed pushes so the KWin script never logs
    // errors while the feature is disabled or a display is mid hot-plug.
    bus?.send(dbusModule.Message.newMethodReturn(msg, '', []));
    if (!enabledState) return true;
    const display = getDisplays().find((candidate) => displayMatches(candidate, x, y, width, height));
    if (!display) return true;
    const change = tracker.apply(String(display.id), Boolean(fullscreen));
    if (change) setPaused(display.id, change.paused);
    return true;
  }

  return {
    async start() {
      if (started) return;
      enabledState = Boolean(enabled());
      try {
        bus = dbusModule.sessionBus();
        await bus.requestName(FULLSCREEN_SERVICE);
        bus.addMethodHandler(handleMethod);
        started = true;
      } catch (error) {
        log(`Fullscreen D-Bus service unavailable: ${error?.message || error}`);
        try { bus?.disconnect(); } catch {}
        bus = null;
      }
    },
    setEnabled(nextEnabled) {
      const value = Boolean(nextEnabled);
      if (value === enabledState) return;
      enabledState = value;
      if (!value) unpauseAll();
    },
    isPaused(displayId) {
      return pauseByDisplay.has(displayId);
    },
    stop() {
      if (bus) {
        try { bus.removeMethodHandler(handleMethod); } catch {}
        try { bus.releaseName(FULLSCREEN_SERVICE); } catch {}
        try { bus.disconnect(); } catch {}
        bus = null;
      }
      started = false;
      pauseByDisplay.clear();
      tracker.reset();
    },
  };
}
