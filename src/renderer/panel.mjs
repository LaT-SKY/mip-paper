import {
  advancePanel,
  createPanelState,
  getCardTransforms,
  recordPointer,
} from '../panel-motion.mjs';
import { buildMonthCalendar } from '../month-calendar.mjs';
import { qweatherIconClass } from '../weather-icon.mjs';

const CARD_CENTERS = [
  { id: 'time', x: 0.22, y: 0.24 },
  { id: 'weather', x: 0.78, y: 0.24 },
  { id: 'tide', x: 0.145, y: 0.585 },
  { id: 'calendar', x: 0.855, y: 0.585 },
];

function field(root, name) { return root.querySelector(`[data-field="${name}"]`); }

export function createPanelController({ root, cards, config, viewport }) {
  const centers = CARD_CENTERS.map((center) => ({ ...center, x: center.x * viewport.width, y: center.y * viewport.height }));
  const state = createPanelState(config, centers);
  const elements = new Map(cards.map((element) => [element.dataset.panelCard, element]));
  let lastSecond = -1;
  let lastCalendarDate = '';
  recordPointer(state, viewport.width / 2, viewport.height / 2, performance.now());

  function renderClock(now) {
    if (now.getSeconds() === lastSecond) return;
    lastSecond = now.getSeconds();
    field(root, 'time').textContent = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
    field(root, 'date').textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: '2-digit' }).format(now).toUpperCase();
  }

  function renderCalendar(now) {
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

  return {
    recordPointer(x, y, nowMs) { recordPointer(state, x, y, nowMs); },
    resize(width, height) {
      viewport.width = width;
      viewport.height = height;
      CARD_CENTERS.forEach((center, index) => {
        state.cards[index].x = center.x * width;
        state.cards[index].y = center.y * height;
      });
    },
    advance(elapsedSeconds, camera, pointer) {
      advancePanel(state, elapsedSeconds);
      const now = new Date();
      renderClock(now);
      renderCalendar(now);
      root.style.transform = `translate3d(${camera.x * 1.1}px, ${camera.y * 1.1 - 8}px, 42px) rotate(${camera.angle}rad) rotateX(${-pointer.normalizedY * 1.25}deg) rotateY(${pointer.normalizedX * 1.8}deg)`;
      for (const transform of getCardTransforms(state)) {
        const element = elements.get(transform.id);
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
      const weatherCard = elements.get('weather');
      const weather = snapshot?.weather ?? { status: 'unavailable' };
      weatherCard.dataset.status = weather.status;
      field(root, 'temperature').textContent = weather.current?.temperature == null ? '--°' : `${Math.round(weather.current.temperature)}°`;
      field(root, 'weather-icon').className = `weather-icon ${qweatherIconClass(weather.current?.icon)}`;
      field(root, 'condition').textContent = weather.current
        ? `${weather.current.condition.toUpperCase()}${weather.current.humidity == null ? '' : ` · HUMIDITY ${weather.current.humidity}%`}`
        : 'UNAVAILABLE';
      const tideCard = elements.get('tide');
      const tide = snapshot?.tide ?? { status: 'unavailable', events: [] };
      tideCard.dataset.status = tide.status;
      const next = tide.events?.find((event) => Date.parse(event.time) >= Date.now()) ?? tide.events?.[0];
      field(root, 'tide-state').textContent = next?.type === 'H' ? 'HIGH' : next?.type === 'L' ? 'LOW' : '--';
      field(root, 'tide-next').textContent = next ? `${next.heightMeters ?? '--'} M · ${new Date(next.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'UNAVAILABLE';
      field(root, 'tide-status').textContent = tide.status?.toUpperCase() ?? 'NO DATA';
    },
  };
}
