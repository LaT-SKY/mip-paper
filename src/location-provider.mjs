import dbus from '@particle/dbus-next';

const REQUEST_XML = `
<node>
  <interface name="org.freedesktop.portal.Request">
    <method name="Close"/>
    <signal name="Response">
      <arg type="u" name="response"/>
      <arg type="a{sv}" name="results"/>
    </signal>
  </interface>
</node>`;

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

export function createPortalLocationAdapter({
  dbusModule = dbus,
  timeoutMs = 10_000,
  tokenFactory = (kind) => `wallpaper_${process.pid}_${Date.now()}_${kind}`,
} = {}) {
  const bus = dbusModule.sessionBus();
  let sessionPath = null;

  function predictedRequestPath(token) {
    if (!bus.name) throw new Error('Location Portal bus is not connected');
    const sender = bus.name.slice(1).replaceAll('.', '_');
    return `/org/freedesktop/portal/desktop/request/${sender}/${token}`;
  }

  async function subscribeResponse(requestPath) {
    const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', requestPath, REQUEST_XML);
    const request = object.getInterface('org.freedesktop.portal.Request');
    let listener;
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Location Portal timed out')), timeoutMs);
      listener = (code, results) => {
        clearTimeout(timer);
        if (code !== 0) reject(new Error('Location Portal permission denied'));
        else resolve(results);
      };
      request.once('Response', listener);
    });
    response.catch(() => {});
    return {
      response,
      cancel() {
        clearTimeout(timer);
        request.removeListener('Response', listener);
      },
    };
  }

  return {
    async resolve() {
      const object = await bus.getProxyObject('org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop');
      const location = object.getInterface('org.freedesktop.portal.Location');
      const sessionToken = tokenFactory('session');
      sessionPath = await location.CreateSession({
        session_handle_token: new dbusModule.Variant('s', sessionToken),
        'distance-threshold': new dbusModule.Variant('u', 10_000),
        'time-threshold': new dbusModule.Variant('u', 1_800),
        accuracy: new dbusModule.Variant('u', 2),
      });
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
      update.catch(() => {});
      const startToken = tokenFactory('start');
      const expectedRequestPath = predictedRequestPath(startToken);
      let subscription = await subscribeResponse(expectedRequestPath);
      const actualRequestPath = await location.Start(sessionPath, '', {
        handle_token: new dbusModule.Variant('s', startToken),
      });
      if (actualRequestPath !== expectedRequestPath) {
        subscription.cancel();
        subscription = await subscribeResponse(actualRequestPath);
      }
      const [, coordinates] = await Promise.all([subscription.response, update]);
      return coordinates;
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
