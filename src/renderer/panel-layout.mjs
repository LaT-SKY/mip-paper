export const PANEL_LAYOUTS = Object.freeze({
  trapezoid: Object.freeze({
    centers: Object.freeze({
      time: Object.freeze({ x: 0.22, y: 0.24 }),
      weather: Object.freeze({ x: 0.78, y: 0.24 }),
      tide: Object.freeze({ x: 0.145, y: 0.585 }),
      calendar: Object.freeze({ x: 0.855, y: 0.585 }),
      custom: Object.freeze({ x: 0.5, y: 0.585 }),
    }),
    vectors: Object.freeze({
      time: Object.freeze({ x: -0.46, y: -0.28 }),
      weather: Object.freeze({ x: 0.46, y: -0.28 }),
      tide: Object.freeze({ x: -0.44, y: 0.18 }),
      calendar: Object.freeze({ x: 0.44, y: 0.18 }),
      custom: Object.freeze({ x: 0, y: 0.22 }),
    }),
    css: 'panel-layout--trapezoid',
  }),
  'grid-2x2': Object.freeze({
    centers: Object.freeze({
      time: Object.freeze({ x: 0.25, y: 0.28 }),
      weather: Object.freeze({ x: 0.75, y: 0.28 }),
      tide: Object.freeze({ x: 0.25, y: 0.68 }),
      calendar: Object.freeze({ x: 0.75, y: 0.68 }),
      custom: Object.freeze({ x: 0.5, y: 0.68 }),
    }),
    vectors: Object.freeze({
      time: Object.freeze({ x: -0.30, y: -0.30 }),
      weather: Object.freeze({ x: 0.30, y: -0.30 }),
      tide: Object.freeze({ x: -0.30, y: 0.30 }),
      calendar: Object.freeze({ x: 0.30, y: 0.30 }),
      custom: Object.freeze({ x: 0, y: 0.30 }),
    }),
    css: 'panel-layout--grid',
  }),
  compact: Object.freeze({
    centers: Object.freeze({
      time: Object.freeze({ x: 0.20, y: 0.50 }),
      weather: Object.freeze({ x: 0.40, y: 0.50 }),
      tide: Object.freeze({ x: 0.60, y: 0.50 }),
      calendar: Object.freeze({ x: 0.80, y: 0.50 }),
      custom: Object.freeze({ x: 0.50, y: 0.72 }),
    }),
    vectors: Object.freeze({
      time: Object.freeze({ x: -0.30, y: 0 }),
      weather: Object.freeze({ x: -0.10, y: 0 }),
      tide: Object.freeze({ x: 0.10, y: 0 }),
      calendar: Object.freeze({ x: 0.30, y: 0 }),
      custom: Object.freeze({ x: 0, y: 0.22 }),
    }),
    css: 'panel-layout--compact',
  }),
  stack: Object.freeze({
    centers: Object.freeze({
      time: Object.freeze({ x: 0.50, y: 0.20 }),
      weather: Object.freeze({ x: 0.50, y: 0.38 }),
      tide: Object.freeze({ x: 0.50, y: 0.56 }),
      calendar: Object.freeze({ x: 0.50, y: 0.74 }),
      custom: Object.freeze({ x: 0.50, y: 0.88 }),
    }),
    vectors: Object.freeze({
      time: Object.freeze({ x: 0, y: -0.30 }),
      weather: Object.freeze({ x: 0, y: -0.10 }),
      tide: Object.freeze({ x: 0, y: 0.10 }),
      calendar: Object.freeze({ x: 0, y: 0.30 }),
      custom: Object.freeze({ x: 0, y: 0.22 }),
    }),
    css: 'panel-layout--stack',
  }),
});

export function getPanelLayout(name) {
  return PANEL_LAYOUTS[name] ?? PANEL_LAYOUTS.trapezoid;
}

export function getPanelCenters(layoutName, ids, viewport) {
  const layout = getPanelLayout(layoutName);
  return ids.map((id) => {
    const center = layout.centers[id] ?? { x: 0.5, y: 0.5 };
    return { id, x: center.x * viewport.width, y: center.y * viewport.height };
  });
}
