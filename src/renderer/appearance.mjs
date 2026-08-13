function finite(value) { return Number.isFinite(value); }

export function normalizeAppearanceState(value) {
  const valid = value !== null
    && typeof value === 'object'
    && ['light', 'dark', 'system'].includes(value.mode)
    && ['light', 'dark'].includes(value.resolvedTheme)
    && finite(value.wallpaperBrightness)
    && value.wallpaperBrightness >= 0.2
    && value.wallpaperBrightness <= 1
    && Number.isInteger(value.transitionDurationMs)
    && value.transitionDurationMs >= 0
    && value.transitionDurationMs <= 5000;
  if (!valid) throw new TypeError('invalid appearance state');
  return structuredClone(value);
}

export function createBrightnessTransition(initialBrightness = 1) {
  if (!finite(initialBrightness) || initialBrightness < 0.2 || initialBrightness > 1) {
    throw new RangeError('initial appearance brightness must be between 0.2 and 1');
  }
  return { current: initialBrightness, from: initialBrightness, target: initialBrightness, startedAt: 0, durationMs: 0 };
}

export function sampleBrightness(state, now) {
  if (state.durationMs <= 0) {
    state.current = state.target;
    return state.current;
  }
  const progress = Math.max(0, Math.min(1, (now - state.startedAt) / state.durationMs));
  state.current = state.from + (state.target - state.from) * progress;
  if (progress === 1) state.durationMs = 0;
  return state.current;
}

export function retargetBrightness(state, {
  target,
  durationMs,
  now,
  reducedMotion = false,
}) {
  if (!finite(target) || target < 0.2 || target > 1) throw new RangeError('appearance brightness target must be between 0.2 and 1');
  const visible = sampleBrightness(state, now);
  state.from = visible;
  state.target = target;
  state.startedAt = now;
  state.durationMs = reducedMotion ? 0 : durationMs;
  if (state.durationMs === 0) state.current = target;
  return state;
}

export function applyAppearanceState(root, value, {
  reducedMotion = false,
  now,
  transition,
}) {
  const appearance = normalizeAppearanceState(value);
  const durationMs = reducedMotion ? 0 : appearance.transitionDurationMs;
  root.dataset.theme = appearance.resolvedTheme;
  root.style.setProperty('--appearance-transition-ms', `${durationMs}ms`);
  root.style.setProperty('--accent-transition-ms', `${durationMs}ms`);
  retargetBrightness(transition, {
    target: appearance.wallpaperBrightness,
    durationMs: appearance.transitionDurationMs,
    now,
    reducedMotion,
  });
  return appearance;
}
