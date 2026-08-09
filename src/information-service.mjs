const CURRENT_REFRESH_MS = 30 * 60 * 1000;
const LONG_REFRESH_MS = 6 * 60 * 60 * 1000;

function localFields(now) {
  const date = new Date(now);
  return {
    localTime: date.toISOString(),
    calendar: { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), weekday: date.getDay() },
  };
}

export function createInformationService({
  config,
  locationProvider,
  qweatherClient,
  cache,
  clock = Date.now,
  setTimeout: schedule = globalThis.setTimeout,
  clearTimeout: cancel = globalThis.clearTimeout,
}) {
  const listeners = new Set();
  const timers = new Set();
  let stopped = false;
  let idle = Promise.resolve();
  let coordinates = null;
  let snapshot = Object.freeze({
    ...localFields(clock()),
    fetchedAt: null,
    locationSource: null,
    weather: { status: 'unavailable', current: null, daily: [] },
    tide: { status: 'unavailable', events: [], hourly: [] },
  });

  function publish(next) {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
  }

  function later(callback, delay) {
    if (stopped) return;
    const id = schedule(() => { timers.delete(id); callback(); }, delay);
    timers.add(id);
  }

  async function loadFallback() {
    const cached = await cache?.read?.();
    if (!cached?.snapshot || !['fresh', 'stale'].includes(cached.status)) return false;
    publish({ ...cached.snapshot, ...localFields(clock()), weather: { ...cached.snapshot.weather, status: cached.status }, tide: { ...cached.snapshot.tide, status: cached.status } });
    return true;
  }

  async function refreshCurrent() {
    if (!coordinates) return;
    const current = await qweatherClient.fetchCurrent(coordinates);
    const next = {
      ...snapshot,
      ...localFields(clock()),
      fetchedAt: new Date(clock()).toISOString(),
      locationSource: coordinates.source,
      weather: { ...snapshot.weather, status: 'fresh', current },
    };
    publish(next);
    await cache?.write?.(next);
  }

  async function refreshLong() {
    if (!coordinates) return;
    const date = new Date(clock()).toISOString().slice(0, 10).replaceAll('-', '');
    const [daily, tide] = await Promise.all([
      qweatherClient.fetchDaily(coordinates),
      qweatherClient.fetchTide({ stationId: config.weather.tideStationId, date }),
    ]);
    const next = {
      ...snapshot,
      ...localFields(clock()),
      fetchedAt: new Date(clock()).toISOString(),
      locationSource: coordinates.source,
      weather: { ...snapshot.weather, status: 'fresh', daily },
      tide: { status: 'fresh', ...tide },
    };
    publish(next);
    await cache?.write?.(next);
  }

  async function initialRefresh() {
    try {
      coordinates = await locationProvider.resolve();
      const date = new Date(clock()).toISOString().slice(0, 10).replaceAll('-', '');
      const [current, daily, tide] = await Promise.all([
        qweatherClient.fetchCurrent(coordinates),
        qweatherClient.fetchDaily(coordinates),
        qweatherClient.fetchTide({ stationId: config.weather.tideStationId, date }),
      ]);
      const next = {
        ...localFields(clock()),
        fetchedAt: new Date(clock()).toISOString(),
        locationSource: coordinates.source,
        weather: { status: 'fresh', current, daily },
        tide: { status: 'fresh', ...tide },
      };
      publish(next);
      await cache?.write?.(next);
    } catch {
      await loadFallback();
    } finally {
      later(() => { idle = refreshCurrent().catch(loadFallback).finally(() => later(() => { idle = refreshCurrent(); }, CURRENT_REFRESH_MS)); }, CURRENT_REFRESH_MS);
      later(() => { idle = refreshLong().catch(loadFallback).finally(() => later(() => { idle = refreshLong(); }, LONG_REFRESH_MS)); }, LONG_REFRESH_MS);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() { if (stopped) return; idle = initialRefresh(); },
    whenIdle: () => idle,
    stop() {
      stopped = true;
      for (const id of timers) cancel(id);
      timers.clear();
      listeners.clear();
      locationProvider?.stop?.();
    },
  };
}
