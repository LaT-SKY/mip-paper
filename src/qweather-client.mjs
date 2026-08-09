export class QWeatherError extends Error {
  constructor(code, message = 'Weather service request failed') {
    super(message);
    this.name = 'QWeatherError';
    this.code = code;
  }
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function percentage(value) {
  const result = numeric(value);
  if (result === null) return null;
  return result >= 0 && result <= 1 ? Math.round(result * 100) : result;
}

export function createQWeatherClient({ credentials, fetch: fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!/^[a-z0-9.-]+$/i.test(credentials?.apiHost ?? '')) throw new TypeError('Invalid weather apiHost');
  if (typeof credentials?.apiKey !== 'string' || !credentials.apiKey) throw new TypeError('Invalid weather apiKey');

  async function request(pathname, query) {
    const url = new URL(`https://${credentials.apiHost}${pathname}`);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url.href, {
        headers: { 'X-QW-Api-Key': credentials.apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new QWeatherError(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
      let body;
      try { body = await response.json(); } catch { throw new QWeatherError('INVALID_RESPONSE'); }
      if (body?.code && body.code !== '200') throw new QWeatherError(body.code === '429' ? 'RATE_LIMITED' : 'API_ERROR');
      return body;
    } catch (error) {
      if (error instanceof QWeatherError) throw error;
      if (error?.name === 'AbortError') throw new QWeatherError('TIMEOUT');
      throw new QWeatherError('NETWORK_ERROR');
    } finally { clearTimeout(timer); }
  }

  return {
    async resolveLocation(locationId) {
      const body = await request('/geo/v2/city/lookup', { location: locationId });
      const location = body.location?.[0];
      const latitude = numeric(location?.lat);
      const longitude = numeric(location?.lon);
      if (latitude === null || longitude === null) throw new QWeatherError('INVALID_RESPONSE');
      return { latitude, longitude };
    },
    async fetchCurrent({ latitude, longitude }) {
      const body = await request(`/weather/v1/current/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`);
      const current = body.current ?? body.now ?? body;
      const condition = current?.condition?.text ?? current?.text;
      const temperature = numeric(current?.temperature?.value ?? current?.temperature ?? current?.temp);
      if (temperature === null || typeof condition !== 'string') throw new QWeatherError('INVALID_RESPONSE');
      return {
        temperature,
        condition,
        icon: String(current.condition?.icon ?? current.icon ?? ''),
        humidity: percentage(current.humidity),
      };
    },
    async fetchDaily({ latitude, longitude }) {
      const body = await request(`/weather/v1/daily/${encodeURIComponent(latitude)}/${encodeURIComponent(longitude)}`);
      const rows = body.days ?? body.daily ?? body.dailyForecast;
      if (!Array.isArray(rows)) throw new QWeatherError('INVALID_RESPONSE');
      return rows.map((row) => ({
        date: row.forecastStartTime?.slice(0, 10) ?? row.fxDate ?? row.date,
        temperatureMax: numeric(row.temperatureMax?.value ?? row.tempMax ?? row.temperatureMax),
        temperatureMin: numeric(row.temperatureMin?.value ?? row.tempMin ?? row.temperatureMin),
        condition: row.daytime?.condition?.text ?? row.textDay ?? row.condition?.text ?? '',
        icon: String(row.daytime?.condition?.icon ?? row.iconDay ?? row.condition?.icon ?? ''),
      }));
    },
    async fetchTide({ stationId, date }) {
      const body = await request('/v7/ocean/tide', { location: stationId, date });
      if (!Array.isArray(body.tideTable)) throw new QWeatherError('INVALID_RESPONSE');
      return {
        events: body.tideTable.map((row) => ({ time: row.fxTime, heightMeters: numeric(row.height), type: row.type })),
        hourly: (body.tideHourly ?? []).map((row) => ({ time: row.fxTime, heightMeters: numeric(row.height) })),
      };
    },
  };
}
