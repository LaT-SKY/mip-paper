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
