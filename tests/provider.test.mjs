import test from "node:test";
import assert from "node:assert/strict";
import { clearProviderCache, fetchMetWeather, normalizeLocation, normalizeNowcast } from "../src/providers/met.mjs";

const location = { label: "Oslo", latitude: 59.9139, longitude: 10.7522 };

function nowcastPayload({ radarCoverage = "ok" } = {}) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.7522, 59.9139] },
    properties: {
      meta: { updated_at: "2026-10-18T07:55:00Z", radar_coverage: radarCoverage },
      timeseries: [
        { time: "2026-10-18T08:00:00Z", data: { instant: { details: { air_temperature: 7, precipitation_rate: 0 } }, next_1_hours: { summary: { symbol_code: "cloudy" }, details: { precipitation_amount: 0 } } } },
        { time: "2026-10-18T08:05:00Z", data: { instant: { details: { precipitation_rate: 12 } } } },
      ],
    },
  };
}

function locationforecastPayload() {
  return {
    properties: {
      meta: { updated_at: "2026-10-18T07:00:00Z" },
      timeseries: [
        { time: "2026-10-18T08:00:00Z", data: { instant: { details: { air_temperature: 6 } }, next_1_hours: { details: { precipitation_amount: 0, probability_of_precipitation: 10 }, summary: { symbol_code: "cloudy" } } } },
      ],
    },
  };
}

function response(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json", ...headers } });
}

test("normalizes MET nowcast fields and radar coverage", () => {
  const result = normalizeNowcast(nowcastPayload(), location);
  assert.equal(result.source, "nowcast");
  assert.equal(result.coverage, "ok");
  assert.equal(result.currentTemperature, 7);
  assert.equal(result.intervals[1].precipitationMm, 1);
});

test("normalizes locations to four decimal places and validates ranges", () => {
  assert.deepEqual(normalizeLocation({ label: "A", latitude: 59.9139123, longitude: 10.7522345 }), { label: "A", latitude: 59.9139, longitude: 10.7522 });
  assert.throws(() => normalizeLocation({ latitude: 91, longitude: 10 }), /Latitude/);
  assert.throws(() => normalizeLocation({ latitude: 60, longitude: 181 }), /Longitude/);
});

test("falls back to locationforecast when nowcast is outside radar coverage", async () => {
  clearProviderCache();
  const requested = [];
  const result = await fetchMetWeather({
    location,
    fetchImpl: async (url) => {
      requested.push(url);
      return requested.length === 1 ? response(nowcastPayload({ radarCoverage: "no coverage" })) : response(locationforecastPayload());
    },
  });
  assert.equal(result.source, "locationforecast");
  assert.equal(requested.length, 2);
});

test("reuses a cached payload after a 304 response", async () => {
  clearProviderCache();
  let requestCount = 0;
  const fetchImpl = async (_url, options) => {
    requestCount += 1;
    if (requestCount === 1) return response(nowcastPayload(), 200, { etag: "forecast-1" });
    assert.equal(options.headers["If-None-Match"], "forecast-1");
    return new Response(null, { status: 304 });
  };
  const first = await fetchMetWeather({ location, fetchImpl });
  const second = await fetchMetWeather({ location, fetchImpl });
  assert.equal(first.observedAt, second.observedAt);
  assert.equal(requestCount, 2);
});

