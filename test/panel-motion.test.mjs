import assert from 'node:assert/strict';
import test from 'node:test';

import {
  advancePanel,
  createPanelState,
  getCardTransforms,
  recordPointer,
  requestCollapsed,
  requestExpanded,
} from '../src/panel-motion.mjs';

const config = {
  autoExpandHide: true,
  expandTriggerDistancePx: 48,
  collapseDelaySeconds: 8,
  expanded: false,
  collapsedOpacity: 0.08,
  animation: { staggerDelayMs: 60, durationMs: 950 },
};
const centers = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 100, y: 0 }, { id: 'c', x: 200, y: 0 }, { id: 'd', x: 300, y: 0 }];

test('requires 48px pointer travel and expands nearest card first', () => {
  const state = createPanelState(config, centers);
  recordPointer(state, 200, 0, 0);
  recordPointer(state, 235, 0, 20);
  assert.equal(state.expanded, false);
  recordPointer(state, 248, 0, 40);
  assert.equal(state.expanded, true);
  assert.deepEqual(state.order, ['c', 'd', 'b', 'a']);
  assert.deepEqual(state.cards.map((card) => card.activateAt), [220, 160, 40, 100]);
});

test('automatic mode starts collapsed even when the fixed state is expanded', () => {
  const state = createPanelState({ ...config, expanded: true }, centers);
  assert.equal(state.expanded, false);
  assert.deepEqual(state.cards.map((card) => card.progress), [0, 0, 0, 0]);
});

test('collapse reverses the last expansion order', () => {
  const state = createPanelState(config, centers);
  requestExpanded(state, { x: 205, y: 0 }, 100);
  requestCollapsed(state, { x: 205, y: 0 }, 1000);
  assert.deepEqual(state.order, ['a', 'b', 'd', 'c']);
  assert.deepEqual(state.cards.map((card) => card.activateAt), [1000, 1060, 1180, 1120]);
});

test('950ms animation has one strong and one weak rebound then settles', () => {
  const state = createPanelState(config, [centers[0]]);
  requestExpanded(state, { x: 0, y: 0 }, 0);
  const velocities = [];
  for (let index = 0; index < 20; index += 1) {
    advancePanel(state, 0.05);
    velocities.push(state.cards[0].velocity);
  }
  const reversals = velocities.slice(1).filter((velocity, index) => velocity * velocities[index] < 0).length;
  assert.equal(reversals, 2);
  assert.equal(state.cards[0].bounceCount, 2);
  assert.equal(getCardTransforms(state)[0].opacity, 1);
  assert.equal(state.cards[0].progress, 1);
});

test('matches the frozen spring trajectory at 60 FPS', () => {
  const state = createPanelState(config, [centers[0]]);
  requestExpanded(state, { x: 0, y: 0 }, 0);
  for (let frame = 0; frame < 10; frame += 1) advancePanel(state, 1 / 60);
  assert.ok(Math.abs(state.cards[0].progress - 1.195777945550905) < 1e-10);
  assert.ok(Math.abs(state.cards[0].velocity - -0.9119418921296525) < 1e-10);
  assert.equal(state.cards[0].bounceCount, 1);
  for (let frame = 10; frame < 20; frame += 1) advancePanel(state, 1 / 60);
  assert.ok(Math.abs(state.cards[0].progress - 0.9623548657483698) < 1e-10);
  assert.equal(state.cards[0].bounceCount, 2);
  assert.equal(state.cards[0].settling, true);
});

test('preserves frozen card-specific collapse and energy mapping', () => {
  const state = createPanelState(config, centers);
  const collapsed = getCardTransforms(state);
  assert.deepEqual(collapsed.map(({ id, translateXFactor, translateYFactor, scale, opacity }) => ({ id, translateXFactor, translateYFactor, scale, opacity })), [
    { id: 'a', translateXFactor: -0.46, translateYFactor: -0.28, scale: 0.88, opacity: 0.08 },
    { id: 'b', translateXFactor: 0.46, translateYFactor: -0.28, scale: 0.88, opacity: 0.08 },
    { id: 'c', translateXFactor: -0.44, translateYFactor: 0.18, scale: 0.88, opacity: 0.08 },
    { id: 'd', translateXFactor: 0.44, translateYFactor: 0.18, scale: 0.88, opacity: 0.08 },
  ]);
  requestExpanded(state, { x: 0, y: 0 }, 0);
  for (let frame = 0; frame < 10; frame += 1) advancePanel(state, 1 / 60);
  const burst = getCardTransforms(state)[0];
  assert.ok(Math.abs(burst.scale - 1.0665645014873077) < 1e-10);
  assert.ok(Math.abs(burst.brightness - 1.1859890482733597) < 1e-10);
  assert.ok(Math.abs(burst.saturation - 1.2545113292161765) < 1e-10);
});
