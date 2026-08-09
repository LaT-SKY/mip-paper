function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function bounceCurve(value) {
  if (value <= 0.62) return 1.12 * smoothstep(value / 0.62);
  if (value <= 0.82) return 1.12 + (0.96 - 1.12) * smoothstep((value - 0.62) / 0.2);
  if (value < 1) return 0.96 + 0.04 * smoothstep((value - 0.82) / 0.18);
  return 1;
}

export function createPanelState(config, cardCenters) {
  const progress = config.expanded ? 1 : 0;
  return {
    config,
    expanded: config.expanded,
    timeMs: 0,
    pointerOrigin: null,
    lastPointer: null,
    lastPointerAt: 0,
    order: cardCenters.map(({ id }) => id),
    lastExpansionOrder: cardCenters.map(({ id }) => id),
    cards: cardCenters.map((center) => ({
      ...center,
      progress,
      startProgress: progress,
      target: progress,
      activateAt: 0,
      velocity: 0,
      previousVelocity: 0,
      bounceCount: 0,
      settling: false,
    })),
  };
}

function begin(state, order, target, now) {
  state.expanded = target === 1;
  state.order = order.map(({ id }) => id);
  order.forEach((orderedCard, index) => {
    const card = state.cards.find(({ id }) => id === orderedCard.id);
    card.startProgress = card.progress;
    card.target = target;
    card.activateAt = now + index * state.config.animation.staggerDelayMs;
    card.velocity = 0;
    card.previousVelocity = 0;
    card.bounceCount = 0;
    card.settling = false;
  });
}

export function requestExpanded(state, pointer, now) {
  const order = [...state.cards].sort((left, right) => distance(left, pointer) - distance(right, pointer)
    || left.id.localeCompare(right.id));
  state.lastExpansionOrder = order.map(({ id }) => id);
  begin(state, order, 1, now);
}

export function requestCollapsed(state, _pointer, now) {
  const order = [...state.lastExpansionOrder].reverse().map((id) => state.cards.find((card) => card.id === id));
  begin(state, order, 0, now);
}

export function recordPointer(state, x, y, now) {
  const pointer = { x, y };
  state.timeMs = Math.max(state.timeMs, now);
  state.lastPointer = pointer;
  state.lastPointerAt = now;
  if (!state.pointerOrigin) state.pointerOrigin = pointer;
  if (state.config.autoExpandHide && !state.expanded
    && distance(state.pointerOrigin, pointer) >= state.config.expandTriggerDistancePx) {
    requestExpanded(state, pointer, now);
    state.pointerOrigin = pointer;
  }
}

export function advancePanel(state, elapsedSeconds) {
  const elapsedMs = elapsedSeconds * 1000;
  state.timeMs += elapsedMs;
  if (state.config.autoExpandHide && state.expanded && state.lastPointer
    && state.timeMs - state.lastPointerAt >= state.config.collapseDelaySeconds * 1000) {
    requestCollapsed(state, state.lastPointer, state.timeMs);
  }
  for (const card of state.cards) {
    if (state.timeMs < card.activateAt || card.progress === card.target) continue;
    const duration = state.config.animation.durationMs;
    const normalized = Math.min(1, (state.timeMs - card.activateAt) / duration);
    const curve = bounceCurve(normalized);
    const next = card.startProgress + (card.target - card.startProgress) * curve;
    const velocity = (next - card.progress) / Math.max(elapsedSeconds, 0.0001);
    if (card.previousVelocity && velocity && Math.sign(velocity) !== Math.sign(card.previousVelocity)) {
      card.bounceCount = Math.min(2, card.bounceCount + 1);
      if (card.bounceCount === 2) card.settling = true;
    }
    card.progress = normalized === 1 ? card.target : next;
    card.velocity = normalized === 1 ? 0 : velocity;
    if (velocity) card.previousVelocity = velocity;
  }
  return state;
}

export function getCardTransforms(state) {
  return state.cards.map((card) => ({
    id: card.id,
    progress: card.progress,
    opacity: Math.max(state.config.collapsedOpacity, Math.min(1, card.progress)),
    translatePercent: (1 - card.progress) * 18,
  }));
}
