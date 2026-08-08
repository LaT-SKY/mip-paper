const APP_ID = 'animated-ocean-wallpaper';
const LOG_PREFIX = 'animated-ocean-coordinator:';
const TARGET_PATTERN = /^animated-ocean-wallpaper\|display=(-?\d+)\|bounds=(-?\d+),(-?\d+),(\d+),(\d+)$/;
const tracked = new Map();
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

function track(window) {
  if (!window || window.resourceClass !== APP_ID || tracked.has(window)) return;
  tracked.set(window, true);
  window.captionChanged.connect(() => reconcile('caption-changed'));
  window.outputChanged.connect(() => reconcile('output-changed'));
  window.closed.connect(() => {
    tracked.delete(window);
    reconcile('window-closed');
  });
}

workspace.windowList().forEach(track);
workspace.windowAdded.connect((window) => {
  track(window);
  reconcile('window-added');
});
workspace.screensChanged.connect(() => reconcile('screens-changed'));
workspace.screenOrderChanged.connect(() => reconcile('screen-order-changed'));
reconcile('startup');
