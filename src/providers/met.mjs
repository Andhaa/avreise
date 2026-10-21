const NOWCAST_URL = "https://api.met.no/weatherapi/nowcast/2.0/complete";
const LOCATIONFORECAST_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
export const MET_DOCUMENTATION_URL = "https://api.met.no/weatherapi/nowcast/2.0/documentation";
export const MET_USER_AGENT = "Avreise/1.0 (+https://github.com/anders/umbrella-signage)";

const responseCache = new Map();

function numberOrUndefined(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function normalizeLocation(input = {}) {
  const latitude = Number(input.latitude ?? input.lat);
  const longitude = Number(input.longitude ?? input.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be between -180 and 180.");
  }

  return {
    label: String(input.label || "Valgt sted").trim().slice(0, 80) || "Valgt sted",
    latitude: Number(latitude.toFixed(4)),
    longitude: Number(longitude.toFixed(4)),
  };
}

function createIntervals(timeseries, { fallbackMinutes = 5 } = {}) {
  return timeseries.map((item, index) => {
    const start = parseDate(item?.time);
    const nextStart = parseDate(timeseries[index + 1]?.time);
    const end = nextStart ?? (start ? new Date(start.getTime() + fallbackMinutes * 60_000) : undefined);
    const data = item?.data ?? {};
    const instant = data.instant?.details ?? {};
    const oneHour = data.next_1_hours?.details ?? {};
    const sixHours = data.next_6_hours?.details ?? {};
    const twelveHours = data.next_12_hours?.details ?? {};
    const period = Object.keys(oneHour).length ? oneHour : Object.keys(sixHours).length ? sixHours : twelveHours;
    const durationMinutes = start && end ? Math.max(1, (end.getTime() - start.getTime()) / 60_000) : fallbackMinutes;
    const rate = numberOrUndefined(instant.precipitation_rate);
    const explicitAmount = numberOrUndefined(period.precipitation_amount);
    const amount = explicitAmount ?? (rate === undefined ? undefined : rate * (durationMinutes / 60));

    return {
      start: start?.toISOString(),
      end: end?.toISOString(),
      precipitationMm: amount,
      precipitationProbability: numberOrUndefined(period.probability_of_precipitation),
      symbolCode: data.next_1_hours?.summary?.symbol_code ?? data.next_6_hours?.summary?.symbol_code ?? data.next_12_hours?.summary?.symbol_code,
    };
  });
}

function ensureForecastShape(payload) {
  if (!payload || typeof payload !== "object" || !payload.properties || !Array.isArray(payload.properties.timeseries)) {
    throw new Error("MET returned malformed forecast data.");
  }
  return payload;
}

export function normalizeNowcast(payload, location) {
  const forecast = ensureForecastShape(payload);
  const updatedAt = parseDate(forecast.properties.meta?.updated_at);
  const timeseries = forecast.properties.timeseries;
  const first = timeseries[0]?.data ?? {};
  const lastStart = parseDate(timeseries.at(-1)?.time);
  if (!updatedAt || !lastStart) {
    throw new Error("MET nowcast is missing a usable update time.");
  }

  return {
    location,
    observedAt: updatedAt.toISOString(),
    validUntil: new Date(lastStart.getTime() + 5 * 60_000).toISOString(),
    coverage: forecast.properties.meta?.radar_coverage ?? "temporarily-unavailable",
    source: "nowcast",
    currentTemperature: numberOrUndefined(first.instant?.details?.air_temperature),
    currentSymbol: first.next_1_hours?.summary?.symbol_code,
    intervals: createIntervals(timeseries),
  };
}

export function normalizeLocationforecast(payload, location) {
  const forecast = ensureForecastShape(payload);
  const updatedAt = parseDate(forecast.properties.meta?.updated_at);
  const timeseries = forecast.properties.timeseries;
  const lastStart = parseDate(timeseries.at(-1)?.time);
  if (!updatedAt || !lastStart) {
    throw new Error("MET location forecast is missing a usable update time.");
  }

  return {
    location,
    observedAt: updatedAt.toISOString(),
    validUntil: new Date(lastStart.getTime() + 6 * 60 * 60_000).toISOString(),
    coverage: "ok",
    source: "locationforecast",
    currentTemperature: numberOrUndefined(timeseries[0]?.data?.instant?.details?.air_temperature),
    currentSymbol: timeseries[0]?.data?.next_1_hours?.summary?.symbol_code ?? timeseries[0]?.data?.next_6_hours?.summary?.symbol_code,
    intervals: createIntervals(timeseries, { fallbackMinutes: 60 }),
  };
}

async function requestJson(url, { fetchImpl, cacheKey, timeoutMs }) {
  const cached = responseCache.get(cacheKey);
  const headers = {
    Accept: "application/json",
    "User-Agent": MET_USER_AGENT,
  };
  if (cached?.etag) headers["If-None-Match"] = cached.etag;
  if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers, signal: controller.signal });
    if (response.status === 304 && cached) {
      return cached.payload;
    }
    if (!response.ok) {
      const error = new Error(`MET returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    responseCache.set(cacheKey, {
      payload,
      etag: response.headers?.get?.("etag") ?? undefined,
      lastModified: response.headers?.get?.("last-modified") ?? undefined,
      fetchedAt: new Date().toISOString(),
    });
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMetWeather({
  location,
  fetchImpl = globalThis.fetch,
  timeoutMs = 4_500,
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("This runtime does not provide fetch().");
  const normalizedLocation = normalizeLocation(location);
  const query = `?lat=${normalizedLocation.latitude}&lon=${normalizedLocation.longitude}`;
  const cacheKey = `${normalizedLocation.latitude},${normalizedLocation.longitude}`;
  let nowcastError;

  try {
    const nowcast = normalizeNowcast(
      await requestJson(`${NOWCAST_URL}${query}`, { fetchImpl, cacheKey: `nowcast:${cacheKey}`, timeoutMs }),
      normalizedLocation,
    );
    if (nowcast.coverage === "ok") return nowcast;
    nowcastError = new Error(`Nowcast coverage is ${nowcast.coverage}.`);
  } catch (error) {
    nowcastError = error;
  }

  try {
    return normalizeLocationforecast(
      await requestJson(`${LOCATIONFORECAST_URL}${query}`, { fetchImpl, cacheKey: `locationforecast:${cacheKey}`, timeoutMs }),
      normalizedLocation,
    );
  } catch (fallbackError) {
    const error = new Error("MET weather data could not be loaded.");
    error.cause = { nowcast: nowcastError, locationforecast: fallbackError };
    throw error;
  }
}

export function clearProviderCache() {
  responseCache.clear();
}
