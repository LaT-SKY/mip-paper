const APP_ID = 'mip-paper';
const LOG_PREFIX = 'mip-paper-coordinator:';
const TARGET_PATTERN = /^mip-paper\|display=(-?\d+)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/;
const FULLSCREEN_SERVICE = 'org.mip.Paper';
const FULLSCREEN_PATH = '/Fullscreen';
const FULLSCREEN_INTERFACE = 'org.mip.Paper.Fullscreen';
const tracked = new Map();
const fullscreenByOutput = new Map();
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

// Report whether any non-wallpaper window is fullscreen on the given output.
// The mip-paper windows are excluded because the KWin rule forces them
// fullscreen; they must never pause the wallpaper themselves.
function outputHasFullscreen(output) {
  return workspace.windowList().some((window) =>
    window.resourceClass !== APP_ID
    && window.output
    && window.output.name === output.name
    && window.fullScreen === true);
}

// Push per-output fullscreen state to the wallpaper service over D-Bus.
// Change-driven pushes log failures; heartbeat pushes (force) are silent so a
// stopped service does not spam the KWin log.
function pushFullscreenState({ force = false, silent = false } = {}) {
  for (const output of workspace.screenOrder) {
    const hasFullscreen = outputHasFullscreen(output);
    if (!force && fullscreenByOutput.get(output.name) === hasFullscreen) {
      continue;
    }
    fullscreenByOutput.set(output.name, hasFullscreen);
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
      hasFullscreen,
      (error) => {
        if (error && !silent) {
          console.info(`${LOG_PREFIX} fullscreen-push-error output=${output.name} fullscreen=${hasFullscreen} error=${error}`);
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
    window.fullScreenChanged.connect(() => pushFullscreenState());
  }
  if (window.outputChanged && typeof window.outputChanged.connect === 'function') {
    window.outputChanged.connect(() => pushFullscreenState());
  }
  if (window.closed && typeof window.closed.connect === 'function') {
    window.closed.connect(() => {
      tracked.delete(window);
      pushFullscreenState();
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
  pushFullscreenState();
});
workspace.windowRemoved.connect(() => pushFullscreenState());
workspace.windowActivated.connect(() => pushFullscreenState());
workspace.screensChanged.connect(() => {
  reconcile('screens-changed');
  pushFullscreenState();
});
workspace.screenOrderChanged.connect(() => {
  reconcile('screen-order-changed');
  pushFullscreenState();
});
reconcile('startup');
pushFullscreenState();
// KWin scripting provides no timers, so there is no script-side heartbeat.
// The wallpaper service restarts this script on startup (unload + load +
// start) and the startup push above re-syncs fullscreen state within a few
// seconds of the service coming up; live changes arrive through the signals.
