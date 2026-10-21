import { DEFAULT_DECISION_RULES } from "../domain/umbrella.mjs";

export const DEFAULT_LOCATION = Object.freeze({
  label: "Oslo",
  latitude: 59.9139,
  longitude: 10.7522,
});

function roundToFiveMinutes(date) {
  const rounded = new Date(date);
  rounded.setUTCSeconds(0, 0);
  rounded.setUTCMinutes(Math.floor(rounded.getUTCMinutes() / 5) * 5);
  return rounded;
}

function interval(start, minutes, details) {
  const end = new Date(start.getTime() + minutes * 60_000);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    ...details,
  };
}

/**
 * Deterministic, fresh-looking fixture data for local development and tests.
 * It never claims to be a live observation: the server labels it as fixture
 * data in the UI and the README documents how to switch to MET Norway.
 */
export function makeFixtureWeather({
  location = DEFAULT_LOCATION,
  now = new Date(),
  scenario = "rain",
} = {}) {
  const observedAt = new Date(now.getTime() - 6 * 60_000);
  const start = roundToFiveMinutes(new Date(now));

  if (scenario === "clear") {
    return {
      location,
      observedAt: observedAt.toISOString(),
      validUntil: new Date(start.getTime() + DEFAULT_DECISION_RULES.windowMinutes * 60_000).toISOString(),
      coverage: "ok",
      source: "fixture",
      currentTemperature: 8,
      currentSymbol: "partlycloudy_day",
      intervals: [
        interval(start, 30, { precipitationMm: 0, precipitationProbability: 12, symbolCode: "partlycloudy_day" }),
        interval(new Date(start.getTime() + 30 * 60_000), 30, { precipitationMm: 0, precipitationProbability: 8, symbolCode: "cloudy" }),
        interval(new Date(start.getTime() + 60 * 60_000), 30, { precipitationMm: 0, precipitationProbability: 5, symbolCode: "clearsky_day" }),
      ],
    };
  }

  if (scenario === "unknown") {
    return {
      location,
      observedAt: observedAt.toISOString(),
      validUntil: new Date(start.getTime() + 15 * 60_000).toISOString(),
      coverage: "temporarily-unavailable",
      source: "fixture",
      currentTemperature: undefined,
      currentSymbol: undefined,
      intervals: [],
    };
  }

  return {
    location,
    observedAt: observedAt.toISOString(),
    validUntil: new Date(start.getTime() + DEFAULT_DECISION_RULES.windowMinutes * 60_000).toISOString(),
    coverage: "ok",
    source: "fixture",
    currentTemperature: 7,
    currentSymbol: "lightrain",
    intervals: [
      interval(start, 30, { precipitationMm: 0, precipitationProbability: 18, symbolCode: "cloudy" }),
      interval(new Date(start.getTime() + 30 * 60_000), 30, { precipitationMm: 1.2, precipitationProbability: 72, symbolCode: "lightrain" }),
      interval(new Date(start.getTime() + 60 * 60_000), 30, { precipitationMm: 0.6, precipitationProbability: 55, symbolCode: "lightrain" }),
    ],
  };
}

