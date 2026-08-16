// Right-click context menu for the wallpaper canvas: a small, modern control
// surface that opens from the click point with the project's spring physics
// (single subtle bounce), follows the light/dark theme, and never touches the
// per-frame render loop (static DOM, transform/opacity only).

export const MENU_STATES = Object.freeze({
  CLOSED: 'closed',
  OPENING: 'opening',
  OPEN: 'open',
  CLOSING: 'closing',
});

// Spring tuned from the panel spring (omega = 2 * PI * 4.7) for a smaller,
// faster control surface: one subtle bounce instead of the panel's double.
export const SPRING = Object.freeze({
  omega: Math.PI * 2 * 6.5,
  damping: 0.6,
  startScale: 0.92,
  targetScale: 1,
  settleEpsilon: 0.002,
  settleVelocity: 0.01,
});

export const OPEN_TRANSITION_MS = 120;
export const CLOSE_TRANSITION_MS = 110;
export const ROW_STAGGER_MS = 24;
export const VIEWPORT_MARGIN = 8;
// Conservative bottom inset used when no work area is known yet, so the menu
// flips above the cursor near a bottom panel even before the KWin work area
// arrives.
export const BOTTOM_SAFE_PX = 48;

// Small built-in 24x24 linear icon set referenced by name from config.
export const ICONS = Object.freeze({
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 5l12 7-12 7z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3"/><path d="M13 15h4"/>',
  update: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  app: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  settings: '<path d="M4 7h10"/><path d="M18 7h2"/><path d="M4 12h4"/><path d="M12 12h8"/><path d="M4 17h12"/><path d="M20 17h0"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="17" r="2"/>',
});

export function iconFor(name) {
  const paths = ICONS[name];
  if (!paths) return '';
  return '<svg viewBox="0 0 24 24" aria-hidden="true">' + paths + '</svg>';
}

// Assemble the flat item list: built-ins first, then a separator and the
// custom commands from config. Separator is omitted when there are none.
export function buildMenuItems({ builtins, customCommands }) {
  const items = [];
  for (const builtin of builtins) {
    items.push({
      type: 'builtin',
      id: builtin.id,
      label: builtin.label,
      icon: builtin.icon,
      state: builtin.state,
    });
  }
  if (customCommands.length > 0) {
    items.push({ type: 'separator' });
    for (const command of customCommands) {
      items.push({
        type: 'command',
        id: command.id,
        label: command.label,
        icon: command.icon,
        mode: command.mode,
      });
    }
  }
  return items;
}

// Choose the menu's vertical position so it opens below the cursor when it
// fits inside the safe area. When the space below is tight it lifts only as
// far as needed to stay inside the safe area (bottom panels, screen edge); it
// flips fully above the cursor only when that lift would push the menu top too
// far from the cursor (more than half its height). The safe bottom comes from
// the KDE work area when available, otherwise from a conservative viewport
// inset.
export function chooseMenuY({ y, height, margin, safeBottom, flipThreshold = 0.5 }) {
  if (y + height + margin <= safeBottom) return y;
  const raised = safeBottom - height;
  const lift = y - raised;
  if (lift <= height * flipThreshold) return raised;
  return y - height - margin;
}

// Keep the menu inside the viewport with a small margin. When a safe-area
// bounds rectangle is provided (e.g. the KDE work area excluding panels), the
// menu is clamped inside it instead, so it cannot be occluded by a dock or
// application bar.
export function clampMenuPosition({ x, y, width, height, viewportWidth, viewportHeight, bounds }) {
  const area = bounds ?? { x: 0, y: 0, width: viewportWidth, height: viewportHeight };
  const maxX = Math.max(area.x + VIEWPORT_MARGIN, area.x + area.width - width - VIEWPORT_MARGIN);
  const maxY = Math.max(area.y + VIEWPORT_MARGIN, area.y + area.height - height - VIEWPORT_MARGIN);
  return {
    x: Math.min(Math.max(x, area.x + VIEWPORT_MARGIN), maxX),
    y: Math.min(Math.max(y, area.y + VIEWPORT_MARGIN), maxY),
  };
}

// The menu corner nearest the cursor, so it appears to grow out of the
// right-click point ('top-left' | 'top-right' | 'bottom-left' | 'bottom-right').
export function pickAnchorCorner({ cursorX, cursorY, x, y, width, height }) {
  const horizontal = cursorX - x < width / 2 ? 'left' : 'right';
  const vertical = cursorY - y < height / 2 ? 'top' : 'bottom';
  return vertical + '-' + horizontal;
}

export function createContextMenu({
  root,
  version,
  reducedMotion = false,
  onAction = () => {},
  viewport = null,
  // Auto-close safety net (ms, 0 disables). May be a number or a getter so a
  // hot-reloaded config value is read when the menu opens. Used when focus
  // change is not observable (e.g. the KWin coordinator is unavailable).
  autoCloseMs = 0,
}) {
  const win = root.ownerDocument.defaultView;
  let state = MENU_STATES.CLOSED;
  let token = 0;
  let items = [];
  let rows = [];
  let highlightIndex = -1;
  let motionFrame = null;
  let closeTimer = null;

  function setState(next) {
    state = next;
    root.dataset.state = next;
  }

  function setHighlight(index) {
    highlightIndex = index;
    rows.forEach((row, rowIndex) => {
      row.toggleAttribute('data-highlighted', rowIndex === index);
    });
  }

  function clearHighlight() {
    highlightIndex = -1;
    for (const row of rows) row.removeAttribute('data-highlighted');
  }

  function renderItems(nextItems) {
    items = nextItems;
    root.replaceChildren();
    if (version) {
      const header = document.createElement('div');
      header.className = 'context-menu-header';
      header.textContent = 'MIP-PAPER · ' + version;
      root.appendChild(header);
    }
    rows = [];
    for (const item of items) {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'context-menu-separator';
        separator.setAttribute('role', 'separator');
        root.appendChild(separator);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'context-menu-row';
      row.setAttribute('role', 'menuitem');
      row.tabIndex = -1;
      row.dataset.menuId = item.id;
      const iconMarkup = iconFor(item.icon);
      if (iconMarkup) {
        const icon = document.createElement('span');
        icon.className = 'context-menu-icon';
        icon.innerHTML = iconMarkup;
        row.appendChild(icon);
      }
      const label = document.createElement('span');
      label.className = 'context-menu-label';
      label.textContent = item.label;
      row.appendChild(label);
      if (item.state === 'on') {
        const mark = document.createElement('span');
        mark.className = 'context-menu-state';
        mark.textContent = '✓';
        row.appendChild(mark);
      }
      row.addEventListener('pointerenter', () => setHighlight(rows.indexOf(row)));
      row.addEventListener('click', () => {
        const id = row.dataset.menuId;
        close();
        onAction(id);
      });
      root.appendChild(row);
      rows.push(row);
    }
  }

  function cancelMotion() {
    if (motionFrame !== null) {
      win.cancelAnimationFrame(motionFrame);
      motionFrame = null;
    }
  }

  function cancelAutoClose() {
    if (closeTimer !== null) {
      win.clearTimeout(closeTimer);
      closeTimer = null;
    }
  }

  // Read the (possibly live) auto-close delay and arm a one-shot timer. The
  // menu stays dismissible by any existing path; this is purely a safety net
  // so a menu cannot linger forever when focus is not observable.
  function scheduleAutoClose() {
    cancelAutoClose();
    const delay = typeof autoCloseMs === 'function' ? autoCloseMs() : autoCloseMs;
    if (!Number.isFinite(delay) || delay <= 0) return;
    closeTimer = win.setTimeout(() => {
      closeTimer = null;
      close();
    }, delay);
  }

  function resetRowsForOpen() {
    rows.forEach((row, index) => {
      const delay = Math.min(index * ROW_STAGGER_MS, OPEN_TRANSITION_MS);
      row.style.transitionDelay = '0ms, ' + delay + 'ms, ' + delay + 'ms';
      row.style.opacity = '0';
      row.style.transform = 'translateY(2px)';
    });
  }

  function revealRows() {
    rows.forEach((row) => {
      row.style.opacity = '1';
      row.style.transform = 'none';
    });
  }

  function startOpenMotion(myToken) {
    const start = performance.now();
    let scale = SPRING.startScale;
    let velocity = 0;
    let previousVelocity = 0;
    let last = start;
    const omega = SPRING.omega;
    const damping = SPRING.damping;

    function frame(now) {
      if (token !== myToken) return;
      const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
      last = now;
      const elapsed = now - start;
      const opacityProgress = Math.min(1, elapsed / OPEN_TRANSITION_MS);
      root.style.opacity = String(1 - (1 - opacityProgress) * (1 - opacityProgress));
      const acceleration = omega * omega * (SPRING.targetScale - scale) - 2 * damping * omega * velocity;
      velocity += acceleration * dt;
      scale += velocity * dt;
      previousVelocity = velocity;
      root.style.transform = 'scale(' + scale.toFixed(4) + ')';
      if (opacityProgress >= 1 && state === MENU_STATES.OPENING) {
        setState(MENU_STATES.OPEN);
        revealRows();
      }
      const settled = Math.abs(SPRING.targetScale - scale) < SPRING.settleEpsilon
        && Math.abs(velocity) < SPRING.settleVelocity;
      if (settled || elapsed > 600) {
        root.style.transform = 'scale(1)';
        motionFrame = null;
        return;
      }
      motionFrame = win.requestAnimationFrame(frame);
    }
    motionFrame = win.requestAnimationFrame(frame);
  }

  function startCloseMotion(myToken) {
    const start = performance.now();
    const fromOpacity = Number.parseFloat(win.getComputedStyle(root).opacity) || 1;

    function frame(now) {
      if (token !== myToken) return;
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / CLOSE_TRANSITION_MS);
      const eased = progress * progress;
      root.style.opacity = String(fromOpacity * (1 - eased));
      root.style.transform = 'scale(' + (1 - 0.02 * eased).toFixed(4) + ')';
      if (progress < 1) {
        motionFrame = win.requestAnimationFrame(frame);
        return;
      }
      motionFrame = null;
      if (token === myToken) finishClose();
    }
    motionFrame = win.requestAnimationFrame(frame);
  }

  function finishClose() {
    root.hidden = true;
    root.style.opacity = '';
    root.style.transform = '';
    clearHighlight();
    setState(MENU_STATES.CLOSED);
  }

  // bounds is the safe rectangle the menu is clamped inside (the KDE work
  // area excluding panels); avoidObstacles=false disables every clamp and
  // flip so the menu appears exactly at the click point, even when that
  // overflows the viewport or a panel.
  function open(x, y, bounds = null, avoidObstacles = true) {
    token += 1;
    const myToken = token;
    cancelMotion();
    cancelAutoClose();
    setState(MENU_STATES.OPENING);
    root.style.opacity = '0';
    root.style.transform = '';
    root.hidden = false;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    let position;
    if (avoidObstacles === false) {
      position = { x, y };
    } else {
      const viewportWidth = viewport?.width ?? win.innerWidth;
      const viewportHeight = viewport?.height ?? win.innerHeight;
      const safeBottom = bounds ? bounds.y + bounds.height : viewportHeight - BOTTOM_SAFE_PX;
      const flippedY = chooseMenuY({ y, height, margin: VIEWPORT_MARGIN, safeBottom });
      position = clampMenuPosition({
        x,
        y: flippedY,
        width,
        height,
        viewportWidth,
        viewportHeight,
        bounds,
      });
    }
    root.style.left = position.x + 'px';
    root.style.top = position.y + 'px';
    root.dataset.origin = pickAnchorCorner({
      cursorX: x,
      cursorY: y,
      x: position.x,
      y: position.y,
      width,
      height,
    });
    resetRowsForOpen();
    scheduleAutoClose();
    if (reducedMotion) {
      root.style.opacity = '1';
      root.style.transform = 'scale(1)';
      revealRows();
      setState(MENU_STATES.OPEN);
      return;
    }
    startOpenMotion(myToken);
  }

  function close() {
    if (state === MENU_STATES.CLOSED || state === MENU_STATES.CLOSING) return;
    token += 1;
    const myToken = token;
    cancelMotion();
    cancelAutoClose();
    if (reducedMotion) {
      finishClose();
      return;
    }
    setState(MENU_STATES.CLOSING);
    startCloseMotion(myToken);
  }

  function isOpen() {
    return state === MENU_STATES.OPENING || state === MENU_STATES.OPEN;
  }

  function handleKeyDown(event) {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (state !== MENU_STATES.OPEN || rows.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (highlightIndex + step + rows.length) % rows.length;
      setHighlight(next);
      rows[next].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      setHighlight(0);
      rows[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      setHighlight(rows.length - 1);
      rows[rows.length - 1].focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (highlightIndex >= 0) rows[highlightIndex].click();
    }
  }

  function handlePointerDown(event) {
    if (!isOpen()) return;
    if (event.target !== root && !root.contains(event.target)) close();
  }

  function handleRootContextMenu(event) {
    event.preventDefault();
    close();
  }

  win.addEventListener('keydown', handleKeyDown);
  win.addEventListener('pointerdown', handlePointerDown, true);
  root.addEventListener('contextmenu', handleRootContextMenu);

  function destroy() {
    token += 1;
    cancelMotion();
    cancelAutoClose();
    win.removeEventListener('keydown', handleKeyDown);
    win.removeEventListener('pointerdown', handlePointerDown, true);
    root.removeEventListener('contextmenu', handleRootContextMenu);
    root.replaceChildren();
    root.hidden = true;
    setState(MENU_STATES.CLOSED);
  }

  return {
    open,
    close,
    isOpen,
    setItems: renderItems,
    destroy,
  };
}
