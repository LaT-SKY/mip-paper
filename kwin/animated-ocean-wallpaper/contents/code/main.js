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
  return ['x', 'y', 'width', 'height']
    .every((key) => Math.abs(left[key] - right[key]) <= 1);
}

function projectWindows() {
  return workspace.windowList().filter((window) => window.resourceClass === APP_ID);
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
      if (!window.output || window.output.name !== targetOutput.name) {
        console.info(`${LOG_PREFIX} result=move reason=${reason} window=${window.internalId} target=${targetOutput.name}`);
        workspace.sendClientToScreen(window, targetOutput);
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
  window.closed.connect(() => tracked.delete(window));
}

workspace.windowList().forEach(track);
workspace.windowAdded.connect((window) => {
  track(window);
  reconcile('window-added');
});
workspace.screensChanged.connect(() => reconcile('screens-changed'));
workspace.screenOrderChanged.connect(() => reconcile('screen-order-changed'));
reconcile('startup');
