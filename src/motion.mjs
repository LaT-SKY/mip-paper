export const SIMULATION_STEP = 1 / 120;
const INTERACTION_HOLD_SECONDS = 0.95;
export const RETURN_INTERACTIVE_FPS_SECONDS = 1.5;
const SETTLE_SECONDS = 0.2;
const DRIFT_FREQUENCY = 1.15;
const DAMPING = 0.9;

export function createPointerState(x, y) {
  const initialized = Number.isFinite(x) && Number.isFinite(y);
  return {
    x: initialized ? x : 0,
    y: initialized ? y : 0,
    normalizedX: 0,
    normalizedY: 0,
    lastInput: -Infinity,
    initialized,
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function updateNormalizedPointer(state, viewport) {
  state.normalizedX = clamp(state.x / Math.max(viewport.width, 1) * 2 - 1, -1, 1);
  state.normalizedY = clamp(state.y / Math.max(viewport.height, 1) * 2 - 1, -1, 1);
}

export function applyPointerSample(state, x, y, time, radius, viewport) {
  if (!state.initialized) {
    state.x = x;
    state.y = y;
    state.initialized = true;
    updateNormalizedPointer(state, viewport);
    return false;
  }

  const dx = x - state.x;
  const dy = y - state.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance <= radius) {
    return false;
  }

  const excess = distance - radius;
  state.x += dx / distance * excess;
  state.y += dy / distance * excess;
  state.lastInput = time;
  updateNormalizedPointer(state, viewport);
  return true;
}

export function createCamera(scale = 1.07) {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    angle: 0,
    angleVelocity: 0,
    scale,
    scaleVelocity: 0,
  };
}

export function driftTarget(time) {
  return {
    x: Math.sin(time / 3.1) * 34 + Math.sin(time / 7.9) * 12,
    y: Math.cos(time / 4.2) * 19 + Math.sin(time / 2.3) * 5,
    angle: Math.sin(time / 6.8) * 0.006,
    scale: 1.07 + Math.sin(time / 5.1) * 0.006,
  };
}

function spring(value, velocity, target, frequency, deltaTime) {
  const omega = Math.PI * 2 * frequency;
  const acceleration = omega * omega * (target - value) - 2 * DAMPING * omega * velocity;
  const nextVelocity = velocity + acceleration * deltaTime;
  return [value + nextVelocity * deltaTime, nextVelocity];
}

function advanceCamera(camera, target, frequency, deltaTime) {
  [camera.x, camera.vx] = spring(camera.x, camera.vx, target.x, frequency, deltaTime);
  [camera.y, camera.vy] = spring(camera.y, camera.vy, target.y, frequency, deltaTime);
  [camera.angle, camera.angleVelocity] = spring(
    camera.angle,
    camera.angleVelocity,
    target.angle,
    frequency,
    deltaTime,
  );
  [camera.scale, camera.scaleVelocity] = spring(
    camera.scale,
    camera.scaleVelocity,
    target.scale,
    frequency,
    deltaTime,
  );
}

export function computeSafeScale(viewport, motion) {
  const aspect = Math.max(viewport.width, 1) / Math.max(viewport.height, 1);
  const angle = motion.maxRotationDegrees * Math.PI / 180;
  const cosine = Math.abs(Math.cos(angle));
  const sine = Math.abs(Math.sin(angle));
  const rotationScale = Math.max(cosine + sine / aspect, cosine + sine * aspect);
  const panScale = 2 * Math.max(motion.horizontalPanPercent, motion.verticalPanPercent) / 100;
  return rotationScale + panScale + 0.01;
}

function shapedAxis(value) {
  return Math.sign(value) * Math.abs(value) ** 1.45;
}

function interactiveTarget(pointer, viewport, config) {
  return {
    x: -shapedAxis(pointer.normalizedX) * viewport.width * config.motion.horizontalPanPercent / 100,
    y: -shapedAxis(pointer.normalizedY) * viewport.height * config.motion.verticalPanPercent / 100,
    angle: -pointer.normalizedX * config.motion.maxRotationDegrees * Math.PI / 180,
    scale: computeSafeScale(viewport, config.motion),
  };
}

export function hasReturnedToDrift(camera, reference) {
  return Math.abs(camera.x - reference.x) < 0.25
    && Math.abs(camera.y - reference.y) < 0.25
    && Math.abs(camera.vx - reference.vx) < 1
    && Math.abs(camera.vy - reference.vy) < 1
    && Math.abs(camera.angle - reference.angle) < 0.0003
    && Math.abs(camera.angleVelocity - reference.angleVelocity) < 0.0005
    && Math.abs(camera.scale - reference.scale) < 0.0003
    && Math.abs(camera.scaleVelocity - reference.scaleVelocity) < 0.0005;
}

export function createMotionState(config, viewport, phase = 0) {
  return {
    camera: createCamera(),
    driftReference: createCamera(),
    pointer: createPointerState(),
    mode: 'drift',
    driftTime: phase,
    accumulator: 0,
    returnElapsed: 0,
    settledDuration: 0,
    viewport: { ...viewport },
    safeScale: computeSafeScale(viewport, config.motion),
  };
}

function simulateStep(state, realTime, config, viewport) {
  state.driftTime += SIMULATION_STEP * config.motion.driftSpeed;
  const idleTarget = driftTarget(state.driftTime);
  advanceCamera(state.driftReference, idleTarget, DRIFT_FREQUENCY, SIMULATION_STEP);

  const interactive = realTime - state.pointer.lastInput < INTERACTION_HOLD_SECONDS;
  let target;
  let frequency;

  if (interactive) {
    target = interactiveTarget(state.pointer, viewport, config);
    frequency = config.motion.interactionSpeed;
  } else if (state.mode === 'returning') {
    target = state.driftReference;
    frequency = config.motion.returnSpeed;
  } else {
    target = idleTarget;
    frequency = DRIFT_FREQUENCY;
  }

  advanceCamera(state.camera, target, frequency, SIMULATION_STEP);

  if (interactive) {
    state.mode = 'interactive';
    state.returnElapsed = 0;
    state.settledDuration = 0;
    return;
  }

  if (state.mode === 'interactive') {
    state.mode = 'returning';
    state.returnElapsed = 0;
    state.settledDuration = 0;
  }

  if (state.mode !== 'returning') {
    return;
  }

  state.returnElapsed += SIMULATION_STEP;
  state.settledDuration = hasReturnedToDrift(state.camera, state.driftReference)
    ? state.settledDuration + SIMULATION_STEP
    : 0;

  if (state.settledDuration + Number.EPSILON >= SETTLE_SECONDS) {
    Object.assign(state.camera, state.driftReference);
    state.mode = 'drift';
    state.returnElapsed = 0;
    state.settledDuration = 0;
  }
}

export function advanceMotion(state, elapsedSeconds, realTime, config, viewport) {
  state.accumulator += clamp(elapsedSeconds, 0, 0.1);
  let steps = 0;
  while (state.accumulator + Number.EPSILON >= SIMULATION_STEP && steps < 12) {
    simulateStep(state, realTime, config, viewport);
    state.accumulator -= SIMULATION_STEP;
    if (Math.abs(state.accumulator) < Number.EPSILON) {
      state.accumulator = 0;
    }
    steps += 1;
  }
  return steps;
}

export function requestedFrameRate(state, config) {
  const driftCadence = state.mode === 'drift'
    || (state.mode === 'returning'
      && state.returnElapsed + SIMULATION_STEP * 1e-9 >= RETURN_INTERACTIVE_FPS_SECONDS);
  return driftCadence ? config.frameRate.drift : config.frameRate.interactive;
}
