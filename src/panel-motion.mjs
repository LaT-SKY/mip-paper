function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

const COLLAPSE_VECTORS = Object.freeze([
  Object.freeze({ x: -0.46, y: -0.28 }),
  Object.freeze({ x: 0.46, y: -0.28 }),
  Object.freeze({ x: -0.44, y: 0.18 }),
  Object.freeze({ x: 0.44, y: 0.18 }),
]);

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
    cards: cardCenters.map((center, index) => ({
      ...center,
      collapseX: center.collapseX ?? COLLAPSE_VECTORS[index]?.x ?? 0,
      collapseY: center.collapseY ?? COLLAPSE_VECTORS[index]?.y ?? 0,
      progress,
      startProgress: progress,
      target: progress,
      pending: progress,
      activateAt: 0,
      velocity: 0,
      previousVelocity: 0,
      bounceCount: 0,
      settling: false,
    })),
  };
}

export function updatePanelConfig(state, config) {
  if (!config || typeof config !== 'object') throw new TypeError('panel config is required');
  state.config = config;
  if (!config.autoExpandHide && state.expanded !== config.expanded) {
    const pointer = state.lastPointer ?? { x: 0, y: 0 };
    if (config.expanded) requestExpanded(state, pointer, state.timeMs);
    else requestCollapsed(state, pointer, state.timeMs);
  }
  return state;
}

function begin(state, order, target, now) {
  state.expanded = target === 1;
  state.order = order.map(({ id }) => id);
  order.forEach((orderedCard, index) => {
    const card = state.cards.find(({ id }) => id === orderedCard.id);
    card.startProgress = card.progress;
    card.pending = target;
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
    if (state.timeMs >= card.activateAt) card.target = card.pending;
    if (state.timeMs < card.activateAt || card.progress === card.target) continue;
    const substepCount = Math.max(1, Math.ceil(elapsedSeconds * 60));
    const substepSeconds = elapsedSeconds / substepCount;
    const springElapsed = Math.min(0.03, substepSeconds * 650 / state.config.animation.durationMs);
    const omega = Math.PI * 2 * 4.7;
    for (let step = 0; step < substepCount; step += 1) {
      const damping = card.settling ? 1.3 : 0.42;
      const acceleration = omega * omega * (card.target - card.progress)
        - 2 * damping * omega * card.velocity;
      card.velocity += acceleration * springElapsed;
      card.progress += card.velocity * springElapsed;
      const reversed = card.previousVelocity !== 0
        && Math.sign(card.velocity) !== Math.sign(card.previousVelocity);
      if (!card.settling && reversed) {
        card.bounceCount += 1;
        if (card.bounceCount === 2) {
          card.settling = true;
          card.velocity *= 0.38;
        }
      }
      card.previousVelocity = card.velocity;
    }
    if (Math.abs(card.target - card.progress) < 0.0005 && Math.abs(card.velocity) < 0.003) {
      card.progress = card.target;
      card.velocity = 0;
      card.previousVelocity = 0;
    }
  }
  return state;
}

export function getCardTransforms(state) {
  return state.cards.map((card) => {
    const collapsed = 1 - card.progress;
    const burst = Math.max(0, card.progress - 1);
    const visibleProgress = Math.max(0, Math.min(1, card.progress));
    return {
      id: card.id,
      progress: card.progress,
      translateXFactor: card.collapseX * collapsed,
      translateYFactor: card.collapseY * collapsed,
      scale: 1 - 0.12 * collapsed + burst * 0.22,
      opacity: state.config.collapsedOpacity
        + (1 - state.config.collapsedOpacity) * visibleProgress,
      brightness: 1 + burst * 0.95,
      saturation: 1 + burst * 1.3,
    };
  });
}
