import {
  advancePanel,
  createPanelState,
  getCardTransforms,
  getPanelHeightFactor,
  panelRequestsInteractiveFps,
  recordPointer,
  updatePanelConfig,
} from '../panel-motion.mjs';
import { buildMonthCalendar } from '../month-calendar.mjs';
import { qweatherIconClass } from '../weather-icon.mjs';
import { getPanelLayout } from './panel-layout.mjs';

function field(root, name) { return root.querySelector(`[data-field="${name}"]`); }

function getVisibleIds(config) {
  const cards = config?.cards ?? [];
  return new Set(cards.filter((c) => c.enabled).map((c) => c.id));
}

function buildCenters(config, viewport) {
  const layout = getPanelLayout(config?.layout);
  const visible = config?.cards?.filter((c) => c.enabled) ?? [];
  return visible.map((entry) => {
    const center = layout.centers[entry.id] ?? { x: 0.5, y: 0.5 };
    return { id: entry.id, x: center.x * viewport.width, y: center.y * viewport.height };
  });
}

function applyLayoutClass(root, layout) {
  root.classList.remove('panel-layout--trapezoid', 'panel-layout--grid', 'panel-layout--compact', 'panel-layout--stack');
  const name = getPanelLayout(layout).css;
  root.classList.add(name);
}

export function createPanelController({ root, cards, config, viewport }) {
  applyLayoutClass(root, config?.layout);
  let visibleIds = getVisibleIds(config);
  // Show/hide DOM cards immediately
  for (const el of cards) {
    const id = el.dataset.panelCard;
    el.hidden = !visibleIds.has(id);
  }
  const centers = buildCenters(config, viewport);
  const state = createPanelState(config, centers);
  const elements = new Map(cards.map((element) => [element.dataset.panelCard, element]));
  let lastSecond = -1;
  let lastCalendarDate = '';
  recordPointer(state, viewport.width / 2, viewport.height / 2, performance.now());

  function renderClock(now) {
    if (!visibleIds.has('time')) return;
    if (now.getSeconds() === lastSecond) return;
    lastSecond = now.getSeconds();
    const cfg = state.config?.customCard;
    const timeFormat = cfg?.timeFormat ?? 'HH:mm';
    let timeText;
    if (timeFormat === 'hh:mm a') timeText = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: true }).format(now);
    else if (timeFormat === 'HH:mm:ss') timeText = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
    else timeText = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    field(root, 'time').textContent = timeText;
    const dateFormat = cfg?.dateFormat ?? 'EEE, MMM dd';
    // For time card date sub, keep existing EN uppercase format; customCard uses its own formats
    field(root, 'date').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: '2-digit' }).format(now).toUpperCase();
  }

  function renderCalendar(now) {
    if (!visibleIds.has('calendar')) return;
    const calendarDate = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (calendarDate === lastCalendarDate) return;
    lastCalendarDate = calendarDate;
    const model = buildMonthCalendar(now);
    field(root, 'month').textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(now).toUpperCase();
    field(root, 'calendar-weekdays').replaceChildren(...model.weekdays.map((weekday) => {
      const cell = document.createElement('span');
      cell.textContent = weekday;
      return cell;
    }));
    field(root, 'calendar-days').replaceChildren(...model.days.map((day) => {
      const cell = document.createElement('span');
      cell.textContent = String(day.day);
      cell.classList.toggle('outside-month', !day.inCurrentMonth);
      cell.classList.toggle('today', day.isToday);
      return cell;
    }));
  }

  function renderCustom(now) {
    if (!visibleIds.has('custom')) return;
    const cfg = state.config?.customCard;
    if (!cfg) return;
    const titleEl = field(root, 'custom-title');
    if (titleEl) titleEl.textContent = (cfg.title ?? '').toUpperCase();
    const textEl = field(root, 'custom-text');
    if (!textEl) return;
    let text = cfg.text ?? '';
    const timeFormat = cfg.timeFormat ?? 'HH:mm';
    const dateFormat = cfg.dateFormat ?? 'MMM dd, yyyy';
    const timeStr = timeFormat === 'hh:mm a'
      ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }).format(now)
      : timeFormat === 'HH:mm:ss'
        ? new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
        : new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    const dateStr = dateFormat === 'yyyy-MM-dd'
      ? `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
      : dateFormat === 'EEE, MMM dd'
        ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: '2-digit' }).format(now)
        : new Intl.DateTimeFormat('en-US', { month: 'short', day: '2-digit', year: 'numeric' }).format(now);
    text = text.replaceAll('{{time}}', timeStr).replaceAll('{{date}}', dateStr);
    textEl.textContent = text;
  }

  return {
    setConfig(nextConfig) {
      const prevLayout = state.config?.layout;
      const prevIds = [...visibleIds].sort().join(',');
      updatePanelConfig(state, nextConfig);
      visibleIds = getVisibleIds(nextConfig);
      for (const el of cards) {
        const id = el.dataset.panelCard;
        el.hidden = !visibleIds.has(id);
      }
      // If layout or visible set changed, rebuild centers and state cards
      const nextLayout = nextConfig?.layout;
      const nextIds = [...visibleIds].sort().join(',');
      if (prevLayout !== nextLayout || prevIds !== nextIds) {
        const newCenters = buildCenters(nextConfig, viewport);
        // Rebuild state cards preserving progress where possible
        const oldById = new Map(state.cards.map((c) => [c.id, c]));
        state.cards = newCenters.map((center) => {
          const existing = oldById.get(center.id);
          if (existing) {
            existing.x = center.x;
            existing.y = center.y;
            const layout = getPanelLayout(nextLayout);
            const vec = layout.vectors[center.id] ?? { x: 0, y: 0 };
            existing.collapseX = vec.x;
            existing.collapseY = vec.y;
            return existing;
          }
          const vec = getPanelLayout(nextLayout).vectors[center.id] ?? { x: 0, y: 0 };
          return {
            ...center,
            collapseX: vec.x,
            collapseY: vec.y,
            progress: state.expanded ? 1 : 0,
            startProgress: state.expanded ? 1 : 0,
            target: state.expanded ? 1 : 0,
            pending: state.expanded ? 1 : 0,
            activateAt: state.timeMs,
            velocity: 0,
            previousVelocity: 0,
            bounceCount: 0,
            settling: false,
          };
        });
        state.order = newCenters.map((c) => c.id);
        // Keep lastExpansionOrder consistent with available cards
        state.lastExpansionOrder = state.lastExpansionOrder.filter((id) => visibleIds.has(id));
        // Add new ids to the end if missing
        for (const id of visibleIds) if (!state.lastExpansionOrder.includes(id)) state.lastExpansionOrder.push(id);
      }
      applyLayoutClass(root, nextLayout);
    },
    expanded() { return state.expanded; },
    toggleExpanded() {
      const cfg = state.config;
      cfg.autoExpandHide = false;
      cfg.expanded = !state.expanded;
      updatePanelConfig(state, cfg);
      return cfg.expanded;
    },
    attention() { return panelRequestsInteractiveFps(state); },
    recordPointer(x, y, nowMs) { recordPointer(state, x, y, nowMs); },
    resize(width, height) {
      viewport.width = width;
      viewport.height = height;
      const layout = getPanelLayout(state.config?.layout);
      for (const card of state.cards) {
        const center = layout.centers[card.id] ?? { x: 0.5, y: 0.5 };
        card.x = center.x * width;
        card.y = center.y * height;
      }
    },
    advance(elapsedSeconds, camera, pointer) {
      advancePanel(state, elapsedSeconds);
      const now = new Date();
      renderClock(now);
      renderCalendar(now);
      renderCustom(now);
      const hf = getPanelHeightFactor(state.config);
      root.style.transform = `translate3d(${camera.x * 1.1 * hf}px, ${camera.y * 1.1 * hf - 8 * hf}px, ${42 * hf}px) rotate(${camera.angle}rad) rotateX(${-pointer.normalizedY * 1.25 * hf}deg) rotateY(${pointer.normalizedX * 1.8 * hf}deg)`;
      for (const transform of getCardTransforms(state)) {
        const element = elements.get(transform.id);
        if (!element || element.hidden) continue;
        // offsetWidth is 0 when hidden, but we already filtered
        element.style.setProperty('--panel-x', `${element.offsetWidth * transform.translateXFactor}px`);
        element.style.setProperty('--panel-y', `${element.offsetHeight * transform.translateYFactor}px`);
        element.style.setProperty('--panel-scale', String(transform.scale));
        element.style.opacity = String(transform.opacity);
        element.style.filter = transform.progress > 1
          ? `brightness(${transform.brightness}) saturate(${transform.saturation})`
          : 'none';
      }
    },
    setInformation(snapshot) {
      if (visibleIds.has('weather')) {
        const weatherCard = elements.get('weather');
        if (weatherCard) {
          const weather = snapshot?.weather ?? { status: 'unavailable' };
          weatherCard.dataset.status = weather.status;
          field(root, 'temperature').textContent = weather.current?.temperature == null ? '--°' : `${Math.round(weather.current.temperature)}°`;
          const iconEl = field(root, 'weather-icon');
          if (iconEl) iconEl.className = `weather-icon ${qweatherIconClass(weather.current?.icon)}`;
          const condEl = field(root, 'condition');
          if (condEl) condEl.textContent = weather.current
            ? `${weather.current.condition.toUpperCase()}${weather.current.humidity == null ? '' : ` · HUMIDITY ${weather.current.humidity}%`}`
            : 'UNAVAILABLE';
        }
      }
      if (visibleIds.has('tide')) {
        const tideCard = elements.get('tide');
        if (tideCard) {
          const tide = snapshot?.tide ?? { status: 'unavailable', events: [] };
          tideCard.dataset.status = tide.status;
          const next = tide.events?.find((event) => Date.parse(event.time) >= Date.now()) ?? tide.events?.[0];
          field(root, 'tide-state').textContent = next?.type === 'H' ? 'HIGH' : next?.type === 'L' ? 'LOW' : '--';
          field(root, 'tide-next').textContent = next ? `${next.heightMeters ?? '--'} M · ${new Date(next.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'UNAVAILABLE';
          field(root, 'tide-status').textContent = tide.status?.toUpperCase() ?? 'NO DATA';
        }
      }
    },
  };
}
