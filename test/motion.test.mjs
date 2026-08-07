import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_CONFIG } from '../src/config.mjs';
import {
  SIMULATION_STEP,
  advanceMotion,
  applyPointerSample,
  computeSafeScale,
  createCamera,
  createMotionState,
  createPointerState,
  driftTarget,
  hasReturnedToDrift,
  requestedFrameRate,
} from '../src/motion.mjs';

const VIEWPORT = { width: 1920, height: 1080 };

test('uses a fixed 120 Hz simulation step', () => {
  assert.equal(SIMULATION_STEP, 1 / 120);
});

test('sliding dead zone ignores noise and advances only by excess distance', () => {
  const state = createPointerState(100, 100);

  assert.equal(applyPointerSample(state, 101, 100, 10, 2, VIEWPORT), false);
  assert.equal(state.lastInput, -Infinity);
  assert.equal(state.x, 100);

  assert.equal(applyPointerSample(state, 104, 100, 20, 2, VIEWPORT), true);
  assert.deepEqual({ x: state.x, y: state.y }, { x: 102, y: 100 });
  assert.equal(state.lastInput, 20);
});

test('sliding dead zone initializes without treating placement as input', () => {
  const state = createPointerState();

  assert.equal(applyPointerSample(state, 960, 540, 50, 2, VIEWPORT), false);
  assert.equal(state.initialized, true);
  assert.equal(state.lastInput, -Infinity);
  assert.equal(state.normalizedX, 0);
  assert.equal(state.normalizedY, 0);
});

test('safe scale matches the approved conservative overscan formula', () => {
  const scale = computeSafeScale(VIEWPORT, DEFAULT_CONFIG.motion);
  const angle = 0.7 * Math.PI / 180;
  const aspect = 1920 / 1080;
  const rotationScale = Math.max(
    Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) / aspect,
    Math.abs(Math.cos(angle)) + Math.abs(Math.sin(angle)) * aspect,
  );
  const expected = rotationScale + 2 * 0.046 + 0.01;

  assert.ok(Math.abs(scale - expected) < 1e-12);
  assert.ok(scale > 1.12);
});

test('drift target preserves the accepted preview trajectory', () => {
  assert.deepEqual(driftTarget(0), { x: 0, y: 19, angle: 0, scale: 1.07 });
  const at = driftTarget(3.1);
  assert.ok(Math.abs(at.x - (Math.sin(1) * 34 + Math.sin(3.1 / 7.9) * 12)) < 1e-12);
  assert.ok(Math.abs(at.scale - (1.07 + Math.sin(3.1 / 5.1) * 0.006)) < 1e-12);
});

test('render cadence does not change simulated motion speed', () => {
  const at30 = createMotionState(DEFAULT_CONFIG, VIEWPORT);
  const at60 = createMotionState(DEFAULT_CONFIG, VIEWPORT);

  for (let frame = 0; frame < 30 * 4; frame += 1) {
    advanceMotion(at30, 1 / 30, (frame + 1) / 30, DEFAULT_CONFIG, VIEWPORT);
  }
  for (let frame = 0; frame < 60 * 4; frame += 1) {
    advanceMotion(at60, 1 / 60, (frame + 1) / 60, DEFAULT_CONFIG, VIEWPORT);
  }

  for (const field of ['x', 'y', 'vx', 'vy', 'angle', 'angleVelocity', 'scale', 'scaleVelocity']) {
    assert.ok(Math.abs(at30.camera[field] - at60.camera[field]) < 1e-9, field);
  }
  assert.ok(Math.abs(at30.driftTime - at60.driftTime) < 1e-12);
});

test('returning uses interactive FPS until every camera component converges', () => {
  const state = createMotionState(DEFAULT_CONFIG, VIEWPORT);
  state.mode = 'returning';
  Object.assign(state.camera, state.driftReference);
  state.camera.angleVelocity += 0.001;

  assert.equal(hasReturnedToDrift(state.camera, state.driftReference), false);
  assert.equal(requestedFrameRate(state, DEFAULT_CONFIG), 60);

  state.camera = createCamera();
  state.driftReference = createCamera();
  state.settledDuration = 0.19;
  advanceMotion(state, SIMULATION_STEP, 2, DEFAULT_CONFIG, VIEWPORT);
  assert.equal(state.mode, 'returning');
  assert.equal(requestedFrameRate(state, DEFAULT_CONFIG), 60);

  for (let step = 0; step < 120 && state.mode !== 'drift'; step += 1) {
    Object.assign(state.camera, state.driftReference);
    advanceMotion(state, SIMULATION_STEP, 2 + (step + 1) * SIMULATION_STEP, DEFAULT_CONFIG, VIEWPORT);
  }
  assert.equal(state.mode, 'drift');
  assert.equal(requestedFrameRate(state, DEFAULT_CONFIG), 30);
});

test('effective input switches immediately to interactive mode', () => {
  const state = createMotionState(DEFAULT_CONFIG, VIEWPORT);
  applyPointerSample(state.pointer, 960, 540, 0, 2, VIEWPORT);
  applyPointerSample(state.pointer, 1200, 700, 1, 2, VIEWPORT);

  advanceMotion(state, SIMULATION_STEP, 1, DEFAULT_CONFIG, VIEWPORT);

  assert.equal(state.mode, 'interactive');
  assert.equal(requestedFrameRate(state, DEFAULT_CONFIG), 60);
});
