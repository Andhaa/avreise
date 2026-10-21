import test from "node:test";
import assert from "node:assert/strict";
import { renderStatusPng, renderStatusSvg } from "../src/render/static-image.mjs";

const state = {
  location: { label: "Oslo", latitude: 59.9139, longitude: 10.7522 },
  weather: { source: "fixture", observedAt: "2026-10-18T07:55:00Z", currentTemperature: 7, intervals: [] },
  decision: { status: "take-umbrella", windowStart: "2026-10-18T08:00:00Z", windowEnd: "2026-10-18T09:30:00Z", evidence: { precipitationMm: 1.2 } },
  meta: { sourceLabel: "Demoforecast" },
};

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("static SVG uses the shared Norwegian heading and recommendation", () => {
  const svg = renderStatusSvg(state, { width: 800, height: 600 });
  assert.match(svg, /Trenger du paraply\?/);
  assert.match(svg, /TA MED PARAPLY/);
  assert.match(svg, /M18 64c14-34/);
});

test("static PNG is generated at the requested landscape dimensions", async () => {
  const image = await renderStatusPng(state, { width: 800, height: 600 });
  assert.deepEqual(pngDimensions(image), { width: 800, height: 600 });
});

test("static PNG supports the portrait target dimensions", async () => {
  const image = await renderStatusPng(state, { width: 600, height: 800 });
  assert.deepEqual(pngDimensions(image), { width: 600, height: 800 });
});
