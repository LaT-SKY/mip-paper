const APP_ID = 'mip-paper';
const LOG_PREFIX = 'mip-paper-coordinator:';
const TARGET_PATTERN = /^mip-paper\|display=(-?\d+)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/;
const FULLSCREEN_SERVICE = 'org.mip.Paper';
const FULLSCREEN_PATH = '/Fullscreen';
const FULLSCREEN_INTERFACE = 'org.mip.Paper.Fullscreen';
const WORK_AREA_INTERFACE = 'org.mip.Paper.WorkArea';
const WORK_AREA_METHOD = 'SetOutputWorkArea';
// Context-menu dismissal: whenever a non-wallpaper window is activated, KWin
// notifies the wallpaper service so every open menu can close. The wallpaper
// windows ignore focus (acceptfocus=false), so they never fire this signal.
const MENU_PATH = '/Menu';
const MENU_INTERFACE = 'org.mip.Paper.Menu';
const MENU_METHOD = 'WindowActivated';
const tracked = new Map();
const fullscreenByOutput = new Map();
const workAreaByOutput = new Map();
let reconciling = false;

function parseTarget(caption) {
  const match = TARGET_PATTERN.exec(caption || '');
  if (!match) return null;
  return {
    displayId: Number(match[1]),
    bounds: {
      x: Number(match[2]),
      y: Number(match[3]),
      width: Number(match[4]),
      height: Number(match[5]),
    },
  };
}

function geometryMatches(left, right) {
  if (!left || !right) return false;
  return ['x', 'y', 'width', 'height']
    .every((key) => Math.abs(left[key] - right[key]) <= 1);
}

function geometryText(rect) {
  if (!rect) return 'none';
  return `${rect.x},${rect.y},${rect.width},${rect.height}`;
}

function projectWindows() {
  return workspace.windowList()
    .filter((window) => window.resourceClass === APP_ID && tracked.has(window));
}

function uniqueTargetOutput(target) {
  const matches = workspace.screenOrder
    .filter((candidate) => geometryMatches(target.bounds, candidate.geometry));
  return matches.length === 1 ? matches[0] : null;
}

function reconcile(reason) {
  if (reconciling) return;
  reconciling = true;
  try {
    const claims = new Map();
    for (const window of projectWindows()) {
      const target = parseTarget(window.caption);
      const targetOutput = target && uniqueTargetOutput(target);
      if (!target || !targetOutput) {
        console.info(`${LOG_PREFIX} result=unresolved reason=${reason} window=${window.internalId}`);
        continue;
      }
      if (claims.has(targetOutput.name)) {
        console.info(`${LOG_PREFIX} result=duplicate-target reason=${reason} output=${targetOutput.name}`);
        continue;
      }
      claims.set(targetOutput.name, window.internalId);
      console.info(`${LOG_PREFIX} geometry reason=${reason} window=${window.internalId}`
        + ` target=${geometryText(target.bounds)}`
        + ` frame=${geometryText(window.frameGeometry)}`
        + ` geometry=${geometryText(window.geometry)}`
        + ` output=${window.output ? window.output.name : 'none'}`
        + ` outputGeometry=${geometryText(targetOutput.geometry)}`);
      if (!window.output || window.output.name !== targetOutput.name) {
        console.info(`${LOG_PREFIX} result=move reason=${reason} window=${window.internalId} target=${targetOutput.name}`);
        workspace.sendClientToScreen(window, targetOutput);
      }
      // Wayland clients cannot reliably position themselves. Move to the
      // target output first, then pin the frame to its exact geometry.
      try {
        if (!geometryMatches(window.frameGeometry, target.bounds)) {
          window.frameGeometry = target.bounds;
        }
      if (window.noBorder !== true) {
        window.noBorder = true;
      }
      if (targetOutput.geometry.x > 0 && typeof workspace.raiseWindow === 'function') {
        workspace.raiseWindow(window);
        console.info(`${LOG_PREFIX} result=raise reason=${reason} window=${window.internalId} output=${targetOutput.name}`);
      }
      } catch (error) {
        console.info(`${LOG_PREFIX} apply-error window=${window.internalId} error=${error}`);
      }
    }
  } finally {
    reconciling = false;
  }
}

// Virtual desktops (workspaces): a covering window only hides the wallpaper
// on the desktop it actually lives on. A fullscreen/maximized window on
// another workspace must not pause the wallpaper, otherwise switching
// desktops with a video running elsewhere would freeze the wallpaper
// forever. The wallpaper windows themselves are visible on all workspaces,
// so this never affects them.
//
// NOTE: KWin exposes window.desktops as an array-LIKE object (it has
// length/index access and even map/includes) but Array.isArray() returns
// false for it, so the list is normalized with a plain loop before
// comparing.
function windowOnCurrentDesktop(window) {
  if (window.onAllDesktops === true) return true;
  const current = workspace.currentDesktop;
  const desktops = window.desktops;
  if (desktops != null) {
    // Plasma 6: desktops lists the VirtualDesktop objects the window is on
    // (empty when on all desktops) and currentDesktop is a VirtualDesktop;
    // compare by identity or by id.
    const list = [];
    for (let i = 0; i < desktops.length; i += 1) list.push(desktops[i]);
    if (current && typeof current === 'object') {
      return list.includes(current)
        || list.some((desktop) => desktop && current.id != null && desktop.id === current.id);
    }
    return true;
  }
  if (typeof window.desktop === 'number') {
    // Plasma 5 fallback: the window carries a 1-based desktop number.
    const currentNumber = typeof current === 'number'
      ? current
      : Number.parseInt(current && current.id, 10);
    return currentNumber == null || window.desktop === currentNumber;
  }
  // No desktop API available (or an unmodeled window): assume the window is
  // on the current desktop so single-desktop setups keep working unchanged.
  return true;
}

// Report whether a non-wallpaper window hides the wallpaper on the output:
// explicitly fullscreen or fully maximized (MaximizeFull = 3) on the current
// virtual desktop. Geometry is deliberately NOT used: desktop-layer windows
// such as plasmashell also cover the output, so a geometric test would
// false-positive on them. The mip-paper windows are excluded because the KWin
// rule forces them fullscreen; they must never pause the wallpaper
// themselves.
function windowCoversOutput(window, output) {
  if (window.resourceClass === APP_ID) return false;
  if (!window.output || window.output.name !== output.name) return false;
  if (!windowOnCurrentDesktop(window)) return false;
  return window.fullScreen === true || window.maximizeMode === 3;
}

function outputHasCoveringWindow(output) {
  return workspace.windowList().some((window) => windowCoversOutput(window, output));
}

// The work area is the output geometry minus Plasma panels/docks, so the
// wallpaper's context menu can avoid being occluded by them. Falls back to
// the full output geometry when the KWin clientArea API is unavailable.
function outputWorkArea(output) {
  if (typeof KWin !== 'undefined'
    && typeof workspace.clientArea === 'function'
    && output && output.geometry) {
    try {
      const rect = workspace.clientArea(KWin.WorkArea, output, workspace.currentDesktop || 1);
      if (rect && rect.width > 0 && rect.height > 0) return rect;
    } catch (error) {
      console.info(`${LOG_PREFIX} work-area-error output=${output.name} error=${error}`);
    }
  }
  return output.geometry;
}

// Push per-output work areas to the wallpaper service over D-Bus. A work area
// equal to the full output geometry is treated as "no panels" and only pushed
// to clear a previously shrunk area, so a panel-free desktop stays quiet.
function pushWorkAreaState({ force = false, silent = false } = {}) {
  for (const output of workspace.screenOrder) {
    const rect = outputWorkArea(output);
    const previous = workAreaByOutput.get(output.name);
    const unchanged = previous && geometryMatches(previous, rect);
    const fullGeometry = output.geometry && geometryMatches(rect, output.geometry);
    if (!force && (unchanged || (previous === undefined && fullGeometry))) {
      continue;
    }
    workAreaByOutput.set(output.name, rect);
    const geometry = rect || {};
    callDBus(
      FULLSCREEN_SERVICE,
      FULLSCREEN_PATH,
      WORK_AREA_INTERFACE,
      WORK_AREA_METHOD,
      output.name,
      geometry.x || 0,
      geometry.y || 0,
      geometry.width || 0,
      geometry.height || 0,
      (error) => {
        if (error && !silent) {
          console.info(`${LOG_PREFIX} work-area-push-error output=${output.name} error=${error}`);
        }
      },
    );
  }
}

// Push per-output fullscreen state to the wallpaper service over D-Bus.
// Change-driven pushes log failures; heartbeat pushes (force) are silent so a
// stopped service does not spam the KWin log.
function pushState(options) {
  pushFullscreenState(options);
  pushWorkAreaState(options);
}

function pushFullscreenState({ force = false, silent = false } = {}) {
  for (const output of workspace.screenOrder) {
    const covering = outputHasCoveringWindow(output);
    if (!force && fullscreenByOutput.get(output.name) === covering) {
      continue;
    }
    fullscreenByOutput.set(output.name, covering);
    const geometry = output.geometry || {};
    callDBus(
      FULLSCREEN_SERVICE,
      FULLSCREEN_PATH,
      FULLSCREEN_INTERFACE,
      'SetOutputFullscreen',
      output.name,
      geometry.x || 0,
      geometry.y || 0,
      geometry.width || 0,
      geometry.height || 0,
      covering,
      (error) => {
        if (error && !silent) {
          console.info(`${LOG_PREFIX} fullscreen-push-error output=${output.name} covering=${covering} error=${error}`);
        }
      },
    );
  }
}

function track(window) {
  if (!window || tracked.has(window)) return;
  tracked.set(window, true);
  // Fullscreen state is observed for every window, not only project windows.
  // Some window kinds lack certain signals, so guard each connection.
  if (window.fullScreenChanged && typeof window.fullScreenChanged.connect === 'function') {
    window.fullScreenChanged.connect(() => pushState());
  }
  if (window.maximizedChanged && typeof window.maximizedChanged.connect === 'function') {
    window.maximizedChanged.connect(() => pushState());
  }
  // Geometry changes settle after the maximize signal, so re-evaluate on the
  // final geometry as well; state changes are deduped before any D-Bus push.
  if (window.frameGeometryChanged && typeof window.frameGeometryChanged.connect === 'function') {
    window.frameGeometryChanged.connect(() => pushState());
  }
  if (window.outputChanged && typeof window.outputChanged.connect === 'function') {
    window.outputChanged.connect(() => pushState());
  }
  if (window.closed && typeof window.closed.connect === 'function') {
    window.closed.connect(() => {
      tracked.delete(window);
      pushState();
    });
  }
  if (window.resourceClass !== APP_ID) return;
  window.captionChanged.connect(() => reconcile('caption-changed'));
  window.outputChanged.connect(() => reconcile('output-changed'));
  window.closed.connect(() => reconcile('window-closed'));
}

workspace.windowList().forEach(track);
workspace.windowAdded.connect((window) => {
  track(window);
  reconcile('window-added');
  pushState();
});
workspace.windowRemoved.connect(() => pushState());
// Activation changes re-evaluate covering state and dismiss open context
// menus. Windows belonging to the app itself never dismiss menus: the
// wallpaper windows ignore focus (acceptfocus=false) and are never
// activated, and future app UI windows (e.g. a settings dialog) are part of
// our own interface — activating them must not count as "focusing another
// app". App windows are identified by resourceClass 'mip-paper' or a
// suffixed variant such as 'mip-paper-settings'.
function isAppWindow(window) {
  return typeof window.resourceClass === 'string'
    && (window.resourceClass === APP_ID || window.resourceClass.startsWith(APP_ID + '-'));
}

workspace.windowActivated.connect((window) => {
  pushState();
  if (!window || isAppWindow(window)) return;
  callDBus(
    FULLSCREEN_SERVICE,
    MENU_PATH,
    MENU_INTERFACE,
    MENU_METHOD,
    (error) => {
      if (error) {
        console.info(`${LOG_PREFIX} menu-activate-error error=${error}`);
      }
    },
  );
});
workspace.screensChanged.connect(() => {
  reconcile('screens-changed');
  pushState();
});
workspace.screenOrderChanged.connect(() => {
  reconcile('screen-order-changed');
  pushState();
});
if (workspace.currentDesktopChanged && typeof workspace.currentDesktopChanged.connect === 'function') {
  workspace.currentDesktopChanged.connect(() => pushState());
}
reconcile('startup');
pushState();
// KWin scripting provides no timers, so there is no script-side heartbeat.
// The wallpaper service restarts this script on startup (unload + load +
// start) and the startup push above re-syncs fullscreen state within a few
// seconds of the service coming up; live changes arrive through the signals.
