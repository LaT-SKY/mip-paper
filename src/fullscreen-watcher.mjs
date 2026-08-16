import os from 'node:os';
import path from 'node:path';
import dbus from '@particle/dbus-next';

export const FULLSCREEN_SERVICE = 'org.mip.Paper';
export const FULLSCREEN_PATH = '/Fullscreen';
export const FULLSCREEN_INTERFACE = 'org.mip.Paper.Fullscreen';
export const FULLSCREEN_METHOD = 'SetOutputFullscreen';
export const WORK_AREA_INTERFACE = 'org.mip.Paper.WorkArea';
export const WORK_AREA_METHOD = 'SetOutputWorkArea';
// The KWin coordinator notifies the service whenever a non-wallpaper window
// is activated so open context menus can dismiss themselves (the wallpaper
// windows ignore focus, so they never fire this).
export const MENU_PATH = '/Menu';
export const MENU_INTERFACE = 'org.mip.Paper.Menu';
export const MENU_METHOD = 'WindowActivated';

const SCRIPTING_XML = [
  '<node>',
  '  <interface name="org.kde.kwin.Scripting">',
  '    <method name="isScriptLoaded"><arg type="s" name="pluginName" direction="in"/><arg type="b" direction="out"/></method>',
  '    <method name="unloadScript"><arg type="s" name="pluginName" direction="in"/><arg type="b" direction="out"/></method>',
  '    <method name="loadScript"><arg type="s" name="filePath" direction="in"/><arg type="s" name="pluginName" direction="in"/><arg type="i" direction="out"/></method>',
  '    <method name="start"/>',
  '  </interface>',
  '</node>',
].join('\n');

export function coordinatorScriptPath(env = process.env, home = os.homedir()) {
  const dataHome = env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(dataHome, 'kwin', 'scripts', 'mip-paper', 'contents', 'code', 'main.js');
}

// KWin scripting provides no timers, so the coordinator script cannot push a
// heartbeat on its own. Restarting it triggers its startup fullscreen push,
// which re-syncs state after this service (re)starts while a fullscreen
// window is already open.
export async function resyncCoordinatorScript(bus, scriptPathname, log = () => {}) {
  try {
    const object = await bus.getProxyObject('org.kde.KWin', '/Scripting', SCRIPTING_XML);
    const scripting = object.getInterface('org.kde.kwin.Scripting');
    try { await scripting.unloadScript('mip-paper'); } catch {}
    await scripting.loadScript(scriptPathname, 'mip-paper');
    await scripting.start();
    return true;
  } catch (error) {
    log(`Coordinator resync unavailable: ${error?.message || error}`);
    return false;
  }
}

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

// The work area is a rectangle inside the display bounds (panels are excluded),
// so match by containment instead of equality.
function displayContains(display, x, y, width, height) {
  const bounds = display.bounds;
  return x >= bounds.x - 1
    && y >= bounds.y - 1
    && x + width <= bounds.x + bounds.width + 1
    && y + height <= bounds.y + bounds.height + 1;
}

// Receives per-output fullscreen pushes from the KWin coordinator script over
// the session bus and translates them into per-display pause events.
export function createFullscreenWatcher({
  dbusModule = dbus,
  getDisplays,
  onStateChange = () => {},
  onWorkAreaChange = () => {},
  onWindowActivated = () => {},
  enabled = () => true,
  log = () => {},
  scriptPath = null,
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
    const isFullscreen = msg.path === FULLSCREEN_PATH
      && msg.interface === FULLSCREEN_INTERFACE
      && msg.member === FULLSCREEN_METHOD;
    const isWorkArea = msg.path === FULLSCREEN_PATH
      && msg.interface === WORK_AREA_INTERFACE
      && msg.member === WORK_AREA_METHOD;
    const isMenuActivated = msg.path === MENU_PATH
      && msg.interface === MENU_INTERFACE
      && msg.member === MENU_METHOD;
    if (!isFullscreen && !isWorkArea && !isMenuActivated) return false;
    if (isMenuActivated) {
      // Focus changed to a non-wallpaper window: acknowledge and let the
      // caller dismiss any open context menu.
      bus?.send(dbusModule.Message.newMethodReturn(msg, '', []));
      onWindowActivated();
      return true;
    }
    const body = msg.body;
    if (!Array.isArray(body)) return false;
    if (isFullscreen) {
      if (body.length !== 6) return false;
      // Always acknowledge well-formed pushes so the KWin script never logs
      // errors while the feature is disabled or a display is mid hot-plug.
      bus?.send(dbusModule.Message.newMethodReturn(msg, '', []));
      const [, x, y, width, height, fullscreen] = body;
      if (!enabledState) return true;
      const display = getDisplays().find((candidate) => displayMatches(candidate, x, y, width, height));
      if (!display) return true;
      const change = tracker.apply(String(display.id), Boolean(fullscreen));
      if (change) setPaused(display.id, change.paused);
      return true;
    }
    if (body.length !== 5) return false;
    bus?.send(dbusModule.Message.newMethodReturn(msg, '', []));
    const [, x, y, width, height] = body;
    // Work areas drive the context menu's obstacle avoidance and are never
    // gated by the fullscreen-pause feature.
    const display = getDisplays().find((candidate) => displayContains(candidate, x, y, width, height));
    if (!display) return true;
    onWorkAreaChange(display.id, { x, y, width, height });
    return true;
  }

  return {
    async start() {
      if (started) return;
      enabledState = Boolean(enabled());
      try {
        bus = dbusModule.sessionBus();
        // Take the name even from a stale instance (e.g. an orphaned dev run),
        // otherwise pushes would reach the old owner and pause nothing.
        const reply = await bus.requestName(
          FULLSCREEN_SERVICE,
          dbusModule.NameFlag?.REPLACE_EXISTING ?? 2,
        );
        if (reply !== 1 && reply !== 4) {
          log(`Fullscreen D-Bus name not acquired: reply=${reply}`);
        }
        bus.addMethodHandler(handleMethod);
        started = true;
        if (scriptPath) {
          void resyncCoordinatorScript(bus, scriptPath, log).catch(() => {});
        }
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
