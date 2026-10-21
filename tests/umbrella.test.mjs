import test from "node:test";
import assert from "node:assert/strict";
import { classifyUmbrella, STATUS } from "../src/domain/umbrella.mjs";

const now = new Date("2026-10-18T08:00:00Z");

function weather(overrides = {}) {
  return {
    location: { label: "Test", latitude: 60, longitude: 10 },
    observedAt: new Date(now.getTime() - 5 * 60_000).toISOString(),
    validUntil: new Date(now.getTime() + 2 * 60 * 60_000).toISOString(),
    coverage: "ok",
    source: "fixture",
    intervals: [
      { start: now.toISOString(), end: new Date(now.getTime() + 30 * 60_000).toISOString(), precipitationMm: 0, precipitationProbability: 5 },
      { start: new Date(now.getTime() + 30 * 60_000).toISOString(), end: new Date(now.getTime() + 60 * 60_000).toISOString(), precipitationMm: 0, precipitationProbability: 5 },
      { start: new Date(now.getTime() + 60 * 60_000).toISOString(), end: new Date(now.getTime() + 90 * 60_000).toISOString(), precipitationMm: 0, precipitationProbability: 5 },
    ],
    ...overrides,
  };
}

test("returns no umbrella when the window is dry", () => {
  const result = classifyUmbrella({ weather: weather(), now });
  assert.equal(result.status, STATUS.NO);
  assert.equal(result.reason, "no-significant-rain");
});

test("warns when measurable rain starts inside the window", () => {
  const forecast = weather();
  forecast.intervals[1].precipitationMm = 0.3;
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.TAKE);
  assert.equal(result.reason, "rain-amount");
});

test("treats light drizzle below the tolerance as dry", () => {
  const forecast = weather();
  forecast.intervals[1].precipitationMm = 0.09;
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.NO);
});

test("warns for drizzle at or above the tolerance", () => {
  const forecast = weather();
  forecast.intervals[1].precipitationMm = 0.1;
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.TAKE);
});

test("can classify probability-only data", () => {
  const forecast = weather();
  forecast.intervals = forecast.intervals.map(({ start, end }) => ({ start, end, precipitationProbability: 60 }));
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.TAKE);
  assert.equal(result.reason, "rain-probability");
});

test("does not guess when precipitation fields are missing", () => {
  const forecast = weather();
  forecast.intervals[1] = { start: forecast.intervals[1].start, end: forecast.intervals[1].end };
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.UNKNOWN);
  assert.equal(result.reason, "missing-precipitation-fields");
});

test("returns unknown for stale weather data", () => {
  const forecast = weather({ observedAt: new Date(now.getTime() - 31 * 60_000).toISOString() });
  const result = classifyUmbrella({ weather: forecast, now });
  assert.equal(result.status, STATUS.UNKNOWN);
  assert.equal(result.reason, "stale-data");
});

test("returns unknown without radar coverage", () => {
  const result = classifyUmbrella({ weather: weather({ coverage: "no-coverage" }), now });
  assert.equal(result.status, STATUS.UNKNOWN);
  assert.equal(result.reason, "coverage");
});

test("handles a window crossing midnight", () => {
  const midnight = new Date("2026-10-18T23:45:00Z");
  const forecast = weather({
    observedAt: new Date(midnight.getTime() - 4 * 60_000).toISOString(),
    intervals: [
      { start: midnight.toISOString(), end: "2026-10-19T00:15:00Z", precipitationMm: 0, precipitationProbability: 0 },
      { start: "2026-10-19T00:15:00Z", end: "2026-10-19T00:45:00Z", precipitationMm: 0, precipitationProbability: 0 },
      { start: "2026-10-19T00:45:00Z", end: "2026-10-19T01:15:00Z", precipitationMm: 0, precipitationProbability: 0 },
    ],
  });
  const result = classifyUmbrella({ weather: forecast, now: midnight });
  assert.equal(result.status, STATUS.NO);
  assert.equal(result.windowEnd, "2026-10-19T01:15:00.000Z");
});

