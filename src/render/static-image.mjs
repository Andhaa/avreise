import { spawn } from "node:child_process";

function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatMillimetres(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} mm`;
}

function palette(status) {
  if (status === "take-umbrella") return { accent: "#f2c94c", soft: "#f8e7a5", label: "TA MED PARAPLY" };
  if (status === "no-umbrella") return { accent: "#c8ddd0", soft: "#e5eee8", label: "DU TRENGER IKKE PARAPLY" };
  return { accent: "#d8d5cd", soft: "#e9e6de", label: "VÆRDATA UKJENT" };
}

function renderHeadlineArtwork({ x, y, width }) {
  const scale = width / 180;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#1d1d1b" stroke-linecap="round" stroke-linejoin="round" stroke-width="4">
    <path d="M18 64c14-34 39-50 72-50s58 16 72 50c-11-6-22-6-33 0-11-6-22-6-33 0-11-6-22-6-33 0-11-6-22-6-33 0Z" fill="#f2c94c"/>
    <path d="M90 64v34c0 10 6 16 15 16 8 0 13-5 13-11"/>
    <path d="M42 25v14M77 14v14M121 18v14"/>
  </g>`;
}

export function renderStatusSvg(state, { width = 800, height = 600 } = {}) {
  const isPortrait = height > width;
  const status = state?.decision?.status ?? "unknown";
  const colors = palette(status);
  const location = escapeXml(state?.location?.label ?? "Valgt sted");
  const source = state?.meta?.sourceLabel ?? (state?.weather?.source === "fixture" ? "Demoforecast" : "MET Norway");
  const windowStart = formatTime(state?.decision?.windowStart);
  const windowEnd = formatTime(state?.decision?.windowEnd);
  const updated = formatTime(state?.weather?.observedAt);
  const amount = formatMillimetres(state?.decision?.evidence?.precipitationMm);
  const temperature = typeof state?.weather?.currentTemperature === "number" ? `${state.weather.currentTemperature.toLocaleString("nb-NO")}°` : "—";
  const widthNumber = Number(width);
  const heightNumber = Number(height);

  const titleSize = isPortrait ? 32 : 40;
  const statusSize = status === "no-umbrella"
    ? (isPortrait ? 27 : 35)
    : (isPortrait ? 38 : 48);
  const left = isPortrait ? 34 : 42;
  const cardTop = isPortrait ? 146 : 132;
  const cardHeight = isPortrait ? 238 : 216;
  const cardWidth = widthNumber - left * 2;
  const footerY = heightNumber - (isPortrait ? 24 : 22);
  const timelineTop = cardTop + cardHeight + (isPortrait ? 38 : 34);
  const columnWidth = (cardWidth - 24) / 3;
  const artworkWidth = isPortrait ? 84 : 104;
  const artworkX = widthNumber - left - artworkWidth;
  const artworkY = isPortrait ? 73 : 72;
  const primaryMessage = status === "take-umbrella"
    ? "Regn mulig mens du er ute."
    : status === "no-umbrella"
      ? "Ingen målbar nedbør i avreisevinduet."
      : "Trykk oppdater eller sjekk Yr manuelt.";

  const timeline = (state?.weather?.intervals ?? []).slice(0, 3).map((interval, index) => {
    const x = left + index * (columnWidth + 12);
    const intervalAmount = typeof interval.precipitationMm === "number" ? interval.precipitationMm : 0;
    const barHeight = Math.max(8, Math.min(42, intervalAmount * 24));
    return `<g>
      <rect x="${x}" y="${timelineTop}" width="${columnWidth}" height="78" rx="4" fill="#fffdf8" stroke="#c8c1b5" stroke-width="1.5"/>
      <text x="${x + 12}" y="${timelineTop + 22}" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="700" fill="#1d1d1b">${escapeXml(formatTime(interval.start))}</text>
      <rect x="${x + 12}" y="${timelineTop + 64 - barHeight}" width="${columnWidth - 24}" height="${barHeight}" rx="2" fill="${colors.accent}" stroke="#1d1d1b" stroke-width="1"/>
      <text x="${x + columnWidth - 12}" y="${timelineTop + 59}" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" fill="#3f3e3a">${escapeXml(formatMillimetres(intervalAmount))}</text>
    </g>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${widthNumber}" height="${heightNumber}" viewBox="0 0 ${widthNumber} ${heightNumber}">
  <rect width="100%" height="100%" fill="#f5f1e8"/>
  <line x1="${left}" y1="70" x2="${widthNumber - left}" y2="70" stroke="#c8c1b5" stroke-width="1"/>
  <text x="${left}" y="42" font-family="Georgia, Times New Roman, serif" font-size="18" fill="#1d1d1b">Vær ved døren</text>
  <text x="${widthNumber - left}" y="42" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="1.3" fill="#6c685e">${escapeXml(location).toUpperCase()}</text>
  <text x="${left}" y="${isPortrait ? 112 : 106}" font-family="Georgia, Times New Roman, serif" font-size="${titleSize}" fill="#1d1d1b">Trenger du paraply?</text>
  ${renderHeadlineArtwork({ x: artworkX, y: artworkY, width: artworkWidth })}
  <rect x="${left}" y="${cardTop}" width="${cardWidth}" height="${cardHeight}" rx="6" fill="${colors.soft}" stroke="#1d1d1b" stroke-width="2"/>
  <circle cx="${left + 38}" cy="${cardTop + 47}" r="21" fill="${colors.accent}" stroke="#1d1d1b" stroke-width="2"/>
  <text x="${left + 38}" y="${cardTop + 56}" text-anchor="middle" font-family="Arial, DejaVu Sans, sans-serif" font-size="26" font-weight="700" fill="#1d1d1b">${status === "take-umbrella" ? "☂" : status === "no-umbrella" ? "✓" : "?"}</text>
  <text x="${left + 74}" y="${cardTop + 34}" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5" fill="#3f3e3a">VÆRSTATUS</text>
  <text x="${left + 74}" y="${cardTop + 84}" font-family="Arial, DejaVu Sans, sans-serif" font-size="${statusSize}" font-weight="800" fill="#1d1d1b">${escapeXml(colors.label)}</text>
  <text x="${left + 74}" y="${cardTop + 119}" font-family="Georgia, Times New Roman, serif" font-size="16" fill="#3f3e3a">${escapeXml(primaryMessage)}</text>
  <line x1="${left + 24}" y1="${cardTop + 148}" x2="${left + cardWidth - 24}" y2="${cardTop + 148}" stroke="#777269" stroke-width="1"/>
  <text x="${left + 24}" y="${cardTop + 181}" font-family="Arial, DejaVu Sans, sans-serif" font-size="13" fill="#3f3e3a">${escapeXml(location)} · ${escapeXml(windowStart)}–${escapeXml(windowEnd)}</text>
  <text x="${left + cardWidth - 24}" y="${cardTop + 181}" text-anchor="end" font-family="Arial, DejaVu Sans, sans-serif" font-size="13" font-weight="700" fill="#1d1d1b">oppdatert ${escapeXml(updated)}</text>
  <text x="${left}" y="${timelineTop - 12}" font-family="Arial, DejaVu Sans, sans-serif" font-size="12" font-weight="700" letter-spacing="1.2" fill="#6c685e">NEDBØR NESTE 90 MIN</text>
  ${timeline}
  <text x="${left}" y="${footerY}" font-family="Arial, DejaVu Sans, sans-serif" font-size="11" fill="#6c685e">MET Norway · ${escapeXml(source)} · ${escapeXml(amount)} · ${escapeXml(temperature)}</text>
</svg>`;
}

function spawnConvert(svg) {
  return new Promise((resolve, reject) => {
    const process = spawn("convert", ["-background", "none", "svg:-", "png:-"]);
    const chunks = [];
    const errors = [];
    process.stdout.on("data", (chunk) => chunks.push(chunk));
    process.stderr.on("data", (chunk) => errors.push(chunk));
    process.on("error", reject);
    process.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(`PNG renderer exited with code ${code}: ${Buffer.concat(errors).toString()}`));
    });
    process.stdin.end(svg);
  });
}

export async function renderStatusPng(state, options = {}) {
  return spawnConvert(renderStatusSvg(state, options));
}
