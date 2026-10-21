import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUmbrella, DEFAULT_DECISION_RULES } from "./src/domain/umbrella.mjs";
import { DEFAULT_LOCATION, makeFixtureWeather } from "./src/providers/fixture.mjs";
import { fetchMetWeather, MET_DOCUMENTATION_URL, normalizeLocation } from "./src/providers/met.mjs";
import { renderStatusPng } from "./src/render/static-image.mjs";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_ROOT = resolve(ROOT, "public");
const PORT = Number(process.env.PORT || 8787);
const DEFAULT_MODE = process.env.WEATHER_MODE || "fixture";
const HOST = process.env.HOST || "127.0.0.1";

function normalizeBasePath(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || trimmed === "/") return "";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, "");
}

const BASE_PATH = normalizeBasePath(process.env.BASE_PATH);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function safeLabel(value) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, 80);
}

export function parseLocation(searchParams) {
  const hasLatitude = searchParams.has("lat");
  const hasLongitude = searchParams.has("lon");
  if (!hasLatitude && !hasLongitude) return DEFAULT_LOCATION;
  if (!hasLatitude || !hasLongitude) throw new Error("Both latitude and longitude are required.");
  return normalizeLocation({
    label: safeLabel(searchParams.get("label")) || "Valgt sted",
    latitude: searchParams.get("lat"),
    longitude: searchParams.get("lon"),
  });
}

export async function createWeatherState({
  location = DEFAULT_LOCATION,
  now = new Date(),
  mode = DEFAULT_MODE,
  scenario = "rain",
} = {}) {
  let weather;
  let notice;
  let resolvedMode = mode;

  if (mode === "live" || mode === "auto") {
    try {
      weather = await fetchMetWeather({ location });
      resolvedMode = "live";
    } catch (error) {
      if (mode === "live") throw error;
      weather = makeFixtureWeather({ location, now, scenario });
      resolvedMode = "fixture-fallback";
      notice = "MET Norway kunne ikke nås. Dette er en demoforecast, ikke ferske værdata.";
    }
  } else {
    weather = makeFixtureWeather({ location, now, scenario });
    resolvedMode = "fixture";
    notice = "Demoforecast for forhåndsvisning. Sett WEATHER_MODE=auto for å koble til MET Norway.";
  }

  const decision = classifyUmbrella({ weather, now, rules: DEFAULT_DECISION_RULES });
  return {
    location: weather.location,
    weather,
    decision,
    meta: {
      mode: resolvedMode,
      notice,
      fetchedAt: now.toISOString(),
      sourceLabel: weather.source === "fixture" ? "Demoforecast" : weather.source === "nowcast" ? "MET Nowcast" : "MET Locationforecast",
      attributionUrl: MET_DOCUMENTATION_URL,
      rules: DEFAULT_DECISION_RULES,
    },
  };
}

function commonHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(self)",
  };
}

function json(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    ...commonHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(PUBLIC_ROOT, `.${normalize(requested)}`);
  if (!filePath.startsWith(PUBLIC_ROOT)) return false;
  try {
    const contents = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...commonHeaders(),
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Content-Security-Policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'",
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(contents);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function routePath(pathname) {
  if (!BASE_PATH) return pathname;
  if (pathname === BASE_PATH) return "";
  if (pathname.startsWith(`${BASE_PATH}/`)) return pathname.slice(BASE_PATH.length) || "/";
  return null;
}

async function handleRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }

  const pathname = routePath(url.pathname);
  if (pathname === null) {
    json(res, 404, { error: "Not found" });
    return;
  }
  if (pathname === "" && BASE_PATH) {
    res.writeHead(301, { ...commonHeaders(), Location: `${BASE_PATH}/` });
    res.end();
    return;
  }

  if (pathname === "/healthz") {
    json(res, 200, { ok: true, service: "avreise" });
    return;
  }

  if (pathname === "/api/weather" || pathname === "/status.png") {
    try {
      const location = parseLocation(url.searchParams);
      const mode = url.searchParams.get("mode") || DEFAULT_MODE;
      const scenario = ["rain", "clear", "unknown"].includes(url.searchParams.get("scenario"))
        ? url.searchParams.get("scenario")
        : "rain";
      const state = await createWeatherState({ location, mode, scenario });

      if (pathname === "/status.png") {
        const width = Math.min(1600, Math.max(320, Number(url.searchParams.get("width") || 800)));
        const height = Math.min(1600, Math.max(320, Number(url.searchParams.get("height") || 600)));
        const image = await renderStatusPng(state, { width, height });
        res.writeHead(200, {
          ...commonHeaders(),
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
          "Content-Length": image.length,
        });
        res.end(image);
        return;
      }

      json(res, 200, state);
      return;
    } catch (error) {
      if (pathname === "/status.png") {
        const location = (() => {
          try {
            return parseLocation(url.searchParams);
          } catch {
            return DEFAULT_LOCATION;
          }
        })();
        const state = await createWeatherState({ location, mode: "fixture", scenario: "unknown" });
        state.meta.notice = "Værdata kunne ikke lastes. Bildet viser en ukjent tilstand.";
        const image = await renderStatusPng(state, {
          width: Math.min(1600, Math.max(320, Number(url.searchParams.get("width") || 800))),
          height: Math.min(1600, Math.max(320, Number(url.searchParams.get("height") || 600))),
        });
        res.writeHead(200, { ...commonHeaders(), "Content-Type": "image/png", "Cache-Control": "no-store", "Content-Length": image.length });
        res.end(image);
        return;
      }
      json(res, 503, {
        error: {
          kind: "weather-provider",
          message: "Værdata er ikke tilgjengelig akkurat nå.",
          detail: process.env.NODE_ENV === "test" ? error.message : undefined,
        },
      });
    }
    return;
  }

  if (!(await serveStatic(res, pathname))) {
    json(res, 404, { error: "Not found" });
  }
}

export function startServer({ port = PORT, host = HOST } = {}) {
  const server = createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      if (!res.headersSent) json(res, 500, { error: "Internal server error" });
      else res.destroy(error);
    });
  });
  return server.listen(port, host, () => {
    const address = server.address();
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    const displayPath = BASE_PATH || "/";
    console.log(`Avreise listening on http://${displayHost}:${typeof address === "object" ? address.port : port}${displayPath}`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  startServer();
}
