/**
 * The domain model deliberately knows nothing about MET Norway, HTTP, or the
 * browser. Provider adapters normalize their responses into this shape before
 * the umbrella decision is made.
 */

export const DEFAULT_DECISION_RULES = Object.freeze({
  windowMinutes: 90,
  rainMmThreshold: 0.1,
  probabilityThreshold: 40,
  staleAfterMinutes: 30,
});

export const STATUS = Object.freeze({
  TAKE: "take-umbrella",
  NO: "no-umbrella",
  UNKNOWN: "unknown",
});

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function overlaps(start, end, windowStart, windowEnd) {
  return end > windowStart && start < windowEnd;
}

function unknownResult(reason, windowStart, windowEnd, extra = {}) {
  return {
    status: STATUS.UNKNOWN,
    reason,
    rule: "unknown",
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    ...extra,
  };
}

/**
 * Classify a normalized forecast for the next departure window.
 *
 * This function is intentionally pure. It is safe to run in tests, the API
 * server, and a future alternate presentation layer without network access.
 */
export function classifyUmbrella({
  weather,
  now = new Date(),
  rules = DEFAULT_DECISION_RULES,
} = {}) {
  const currentTime = asDate(now) ?? new Date();
  const windowStart = currentTime;
  const windowEnd = new Date(currentTime.getTime() + rules.windowMinutes * 60_000);

  if (!weather || !Array.isArray(weather.intervals)) {
    return unknownResult("missing-data", windowStart, windowEnd);
  }

  if (weather.coverage !== "ok") {
    return unknownResult("coverage", windowStart, windowEnd, {
      coverage: weather.coverage ?? "temporarily-unavailable",
    });
  }

  const observedAt = asDate(weather.observedAt);
  if (!observedAt) {
    return unknownResult("missing-observation-time", windowStart, windowEnd);
  }

  const age = currentTime.getTime() - observedAt.getTime();
  if (age > rules.staleAfterMinutes * 60_000 || age < -5 * 60_000) {
    return unknownResult("stale-data", windowStart, windowEnd, {
      observedAt: observedAt.toISOString(),
    });
  }

  const relevantIntervals = weather.intervals
    .map((interval) => ({
      ...interval,
      startDate: asDate(interval.start),
      endDate: asDate(interval.end),
      precipitationMm: finiteNumber(interval.precipitationMm),
      precipitationProbability: finiteNumber(interval.precipitationProbability),
    }))
    .filter(
      (interval) =>
        interval.startDate &&
        interval.endDate &&
        overlaps(interval.startDate, interval.endDate, windowStart, windowEnd),
    );

  if (relevantIntervals.length === 0) {
    return unknownResult("forecast-window-uncovered", windowStart, windowEnd);
  }

  let missingEvidence = false;
  let maximumAmount;
  let maximumProbability;

  for (const interval of relevantIntervals) {
    const amount = interval.precipitationMm;
    const probability = interval.precipitationProbability;

    if (amount === undefined && probability === undefined) {
      missingEvidence = true;
      continue;
    }

    if (amount !== undefined) {
      maximumAmount = Math.max(maximumAmount ?? amount, amount);
      if (amount >= rules.rainMmThreshold) {
        return {
          status: STATUS.TAKE,
          reason: "rain-amount",
          rule: `Målbar nedbør (≥ ${rules.rainMmThreshold.toLocaleString("nb-NO")} mm) i avreisevinduet.`,
          evidence: {
            precipitationMm: amount,
            precipitationProbability: probability,
          },
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        };
      }
    }

    if (probability !== undefined) {
      maximumProbability = Math.max(maximumProbability ?? probability, probability);
      if (probability >= rules.probabilityThreshold) {
        return {
          status: STATUS.TAKE,
          reason: "rain-probability",
          rule: `Regnsannsynlighet på minst ${rules.probabilityThreshold} % i avreisevinduet.`,
          evidence: {
            precipitationMm: amount,
            precipitationProbability: probability,
          },
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        };
      }
    }
  }

  if (missingEvidence) {
    return unknownResult("missing-precipitation-fields", windowStart, windowEnd, {
      maximumAmount,
      maximumProbability,
    });
  }

  return {
    status: STATUS.NO,
    reason: "no-significant-rain",
    rule: `Ingen målbar nedbør over ${rules.rainMmThreshold.toLocaleString("nb-NO")} mm eller ${rules.probabilityThreshold} % sannsynlighet.`,
    evidence: {
      precipitationMm: maximumAmount ?? 0,
      precipitationProbability: maximumProbability ?? 0,
    },
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
  };
}

