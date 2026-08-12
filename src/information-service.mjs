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
  let started = false;
  let idle = Promise.resolve();
  let coordinates = null;
  let currentConfig = config;
  let currentLocationProvider = locationProvider;
  let currentQWeatherClient = qweatherClient;
  let generation = 0;
  let snapshot = Object.freeze({
    ...localFields(clock()),
    fetchedAt: null,
    locationSource: null,
    weather: { status: 'unavailable', current: null, daily: [] },
    tide: { status: 'unavailable', events: [], hourly: [] },
  });

  function publish(next, operationGeneration = generation) {
    if (stopped || operationGeneration !== generation) return false;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
    return true;
  }

  function later(callback, delay) {
    if (stopped) return;
    const id = schedule(() => { timers.delete(id); callback(); }, delay);
    timers.add(id);
  }

  function clearTimers() {
    for (const id of timers) cancel(id);
    timers.clear();
  }

  async function loadFallback(operationGeneration = generation) {
    const cached = await cache?.read?.();
    if (stopped || operationGeneration !== generation) return false;
    if (!cached?.snapshot || !['fresh', 'stale'].includes(cached.status)) return false;
    publish({ ...cached.snapshot, ...localFields(clock()), weather: { ...cached.snapshot.weather, status: cached.status }, tide: { ...cached.snapshot.tide, status: cached.status } }, operationGeneration);
    return true;
  }

  async function refreshCurrent(operationGeneration = generation) {
    if (!coordinates) return;
    const current = await currentQWeatherClient.fetchCurrent(coordinates);
    if (stopped || operationGeneration !== generation) return;
    const next = {
      ...snapshot,
      ...localFields(clock()),
      fetchedAt: new Date(clock()).toISOString(),
      locationSource: coordinates.source,
      weather: { ...snapshot.weather, status: 'fresh', current },
    };
    publish(next, operationGeneration);
    await cache?.write?.(next);
  }

  async function refreshLong(operationGeneration = generation) {
    if (!coordinates) return;
    const date = new Date(clock()).toISOString().slice(0, 10).replaceAll('-', '');
    const [daily, tide] = await Promise.all([
      currentQWeatherClient.fetchDaily(coordinates),
      currentQWeatherClient.fetchTide({ stationId: currentConfig.weather.tideStationId, date }),
    ]);
    if (stopped || operationGeneration !== generation) return;
    const next = {
      ...snapshot,
      ...localFields(clock()),
      fetchedAt: new Date(clock()).toISOString(),
      locationSource: coordinates.source,
      weather: { ...snapshot.weather, status: 'fresh', daily },
      tide: { status: 'fresh', ...tide },
    };
    publish(next, operationGeneration);
    await cache?.write?.(next);
  }

  function scheduleCurrent(operationGeneration) {
    if (stopped || operationGeneration !== generation) return;
    later(() => {
      idle = refreshCurrent(operationGeneration)
        .catch(() => loadFallback(operationGeneration))
        .finally(() => scheduleCurrent(operationGeneration));
    }, CURRENT_REFRESH_MS);
  }

  function scheduleLong(operationGeneration) {
    if (stopped || operationGeneration !== generation) return;
    later(() => {
      idle = refreshLong(operationGeneration)
        .catch(() => loadFallback(operationGeneration))
        .finally(() => scheduleLong(operationGeneration));
    }, LONG_REFRESH_MS);
  }

  async function initialRefresh(operationGeneration = generation) {
    try {
      const resolved = await currentLocationProvider.resolve();
      if (stopped || operationGeneration !== generation) return;
      coordinates = resolved;
      const date = new Date(clock()).toISOString().slice(0, 10).replaceAll('-', '');
      const [current, daily, tide] = await Promise.all([
        currentQWeatherClient.fetchCurrent(coordinates),
        currentQWeatherClient.fetchDaily(coordinates),
        currentQWeatherClient.fetchTide({ stationId: currentConfig.weather.tideStationId, date }),
      ]);
      if (stopped || operationGeneration !== generation) return;
      const next = {
        ...localFields(clock()),
        fetchedAt: new Date(clock()).toISOString(),
        locationSource: coordinates.source,
        weather: { status: 'fresh', current, daily },
        tide: { status: 'fresh', ...tide },
      };
      publish(next, operationGeneration);
      await cache?.write?.(next);
    } catch {
      await loadFallback(operationGeneration);
    } finally {
      scheduleCurrent(operationGeneration);
      scheduleLong(operationGeneration);
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    start() {
      if (stopped || started) return;
      started = true;
      idle = initialRefresh(generation);
    },
    updateSources({ config: nextConfig, locationProvider: nextProvider, qweatherClient: nextClient }) {
      if (stopped) return Promise.resolve(false);
      if (!nextConfig?.weather || !nextProvider || !nextClient) {
        return Promise.reject(new TypeError('weather sources are required'));
      }
      const previousProvider = currentLocationProvider;
      currentConfig = nextConfig;
      currentLocationProvider = nextProvider;
      currentQWeatherClient = nextClient;
      coordinates = null;
      generation += 1;
      clearTimers();
      if (previousProvider !== nextProvider) previousProvider?.stop?.();
      if (!started) return Promise.resolve(true);
      idle = initialRefresh(generation);
      return Promise.resolve(true);
    },
    updateConfig(nextConfig) {
      return this.updateSources({
        config: nextConfig,
        locationProvider: currentLocationProvider,
        qweatherClient: currentQWeatherClient,
      });
    },
    whenIdle: () => idle,
    stop() {
      stopped = true;
      generation += 1;
      clearTimers();
      listeners.clear();
      currentLocationProvider?.stop?.();
    },
  };
}
