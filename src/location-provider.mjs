import dbus from 'dbus-next';

function normalizeCoordinates(value, source) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`Invalid ${source} coordinates`);
  }
  return {
    latitude,
    longitude,
    source,
    accuracyMeters: Number.isFinite(Number(value?.accuracyMeters)) ? Number(value.accuracyMeters) : null,
  };
}

export function createLocationProvider({ config, portal, geoLookup, cache }) {
  return {
    async resolve() {
      if (config.mode === 'fixed') return normalizeCoordinates(config, 'fixed');
      try {
        if (portal) return normalizeCoordinates(await portal.resolve(), 'portal');
      } catch {}
      try {
        const cached = await cache?.getCoordinates?.();
        if (cached) return normalizeCoordinates(cached, 'cache');
      } catch {}
      if (!geoLookup) throw new Error('Location unavailable');
      return normalizeCoordinates(await geoLookup(config.fallbackLocationId), 'fallback');
    },
    stop() { return portal?.stop?.(); },
  };
}

function variantValue(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

export function createPortalLocationAdapter({ dbusModule = dbus, timeoutMs = 10_000 } = {}) {
  const bus = dbusModule.sessionBus();
  let sessionPath = null;

  async function responseFor(requestPath) {
    const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath);
    const request = object.getInterface('org.freedesktop.portal.Request');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Location Portal timed out')), timeoutMs);
      request.once('Response', (code, results) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error('Location Portal permission denied'));
        else resolve(results);
      });
    });
  }

  return {
    async resolve() {
      const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
      const location = object.getInterface('org.freedesktop.portal.Location');
      const token = `wallpaper_${process.pid}_${Date.now()}`;
      const createPath = await location.CreateSession({
        handle_token: new dbusModule.Variant('s', `${token}_create`),
        session_handle_token: new dbusModule.Variant('s', `${token}_session`),
        distance_threshold: new dbusModule.Variant('u', 10_000),
        time_threshold: new dbusModule.Variant('u', 1_800),
        accuracy: new dbusModule.Variant('u', 4),
      });
      const created = await responseFor(createPath);
      sessionPath = variantValue(created.session_handle);
      const update = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Location Portal timed out')), timeoutMs);
        location.on('LocationUpdated', (handle, values) => {
          if (handle !== sessionPath) return;
          clearTimeout(timer);
          resolve({
            latitude: variantValue(values.Latitude),
            longitude: variantValue(values.Longitude),
            accuracyMeters: variantValue(values.Accuracy),
          });
        });
      });
      await responseFor(await location.Start(sessionPath, '', {
        handle_token: new dbusModule.Variant('s', `${token}_start`),
      }));
      return update;
    },
    async stop() {
      if (sessionPath) {
        const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', sessionPath);
        await object.getInterface('org.freedesktop.portal.Session').Close();
        sessionPath = null;
      }
      bus.disconnect();
    },
  };
}
