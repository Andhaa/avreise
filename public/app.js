import {
  geolocationCapability,
  locationErrorCopy,
  loadSavedLocation,
  normalizeLocation,
  permissionStatusCopy,
  readGeolocationPermission,
  requestCurrentLocation,
  saveLocation,
} from "./location.mjs";

const REFRESH_GUARD_MS = 5 * 60_000;

const elements = {
  hero: document.querySelector("#hero-card"),
  modeLabel: document.querySelector("#mode-label"),
  statusSymbol: document.querySelector("#status-symbol"),
  statusLabel: document.querySelector("#status-label"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
  statusRule: document.querySelector("#status-rule"),
  forecastWindow: document.querySelector("#forecast-window"),
  lastUpdated: document.querySelector("#last-updated"),
  statusLocation: document.querySelector("#status-location"),
  locationName: document.querySelector("#location-name"),
  locationMode: document.querySelector("#location-mode"),
  locationCoordinates: document.querySelector("#location-coordinates"),
  timeline: document.querySelector("#timeline"),
  maxPrecipitation: document.querySelector("#max-precipitation"),
  temperature: document.querySelector("#temperature"),
  sourceStatus: document.querySelector("#source-status"),
  notice: document.querySelector("#notice"),
  refreshWeather: document.querySelector("#refresh-weather"),
  detailsDrawer: document.querySelector("#details-drawer"),
  openDetails: document.querySelector("#open-details"),
  closeDetails: document.querySelector("#close-details"),
  closeDetailsBackdrop: document.querySelector("#close-details-backdrop"),
  drawer: document.querySelector("#location-drawer"),
  form: document.querySelector("#manual-location-form"),
  formError: document.querySelector("#form-error"),
  permissionNote: document.querySelector("#permission-note"),
  useGeolocation: document.querySelector("#use-geolocation"),
  openLocation: document.querySelector("#open-location"),
};

let currentLocation = loadSavedLocation();
let lastSuccessfulLoad = 0;
let requestInFlight = false;
let permissionState = "unknown";
let permissionRequestInFlight = false;

const timeFormatter = new Intl.DateTimeFormat("nb-NO", { hour: "2-digit", minute: "2-digit" });
const numberFormatter = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 1 });

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

function formatMillimetres(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${numberFormatter.format(value)} mm` : "—";
}

function formatTemperature(value) {
  return typeof value === "number" && Number.isFinite(value) ? `${numberFormatter.format(value)}°` : "—";
}

function locationModeLabel(location) {
  if (!location) return "Mangler sted";
  return location.source === "device" ? "Enhetens posisjon" : "Fast sted";
}

function updateLocationLabels() {
  if (currentLocation) {
    elements.locationName.textContent = currentLocation.label;
    elements.locationCoordinates.textContent = `${currentLocation.latitude.toFixed(4)}, ${currentLocation.longitude.toFixed(4)}`;
    elements.statusLocation.textContent = currentLocation.label;
  } else {
    elements.locationName.textContent = "Ikke valgt";
    elements.locationCoordinates.textContent = "Velg en posisjon for å se været.";
    elements.statusLocation.textContent = "—";
  }
  elements.locationMode.textContent = locationModeLabel(currentLocation);

  const labelInput = elements.form?.elements?.label;
  const latitudeInput = elements.form?.elements?.latitude;
  const longitudeInput = elements.form?.elements?.longitude;
  if (labelInput && document.activeElement !== labelInput) labelInput.value = currentLocation?.label || "";
  if (latitudeInput && document.activeElement !== latitudeInput) latitudeInput.value = currentLocation?.latitude ?? "";
  if (longitudeInput && document.activeElement !== longitudeInput) longitudeInput.value = currentLocation?.longitude ?? "";
}

function sourceLabel(source) {
  if (source === "nowcast") return "MET Nowcast";
  if (source === "locationforecast") return "MET Locationforecast";
  return "Demoforecast";
}

function statusCopy(status) {
  if (status === "take-umbrella") return { label: "TA MED PARAPLY", title: "Ja — ta med paraply", message: "Regn mulig mens du er ute.", symbol: "☂" };
  if (status === "no-umbrella") return { label: "DU TRENGER IKKE PARAPLY", title: "Nei — du klarer deg", message: "Ingen målbar nedbør i avreisevinduet.", symbol: "✓" };
  return { label: "VÆRDATA UKJENT", title: "Vent litt med svaret", message: "Trykk oppdater eller sjekk Yr manuelt.", symbol: "?" };
}

function renderTimeline(weather, decision) {
  elements.timeline.replaceChildren();
  const intervals = (weather?.intervals || []).slice(0, 3);
  const maxAmount = Math.max(0.1, ...intervals.map((interval) => Number(interval.precipitationMm) || 0));
  for (const interval of intervals) {
    const amount = Number(interval.precipitationMm);
    const amountKnown = Number.isFinite(amount);
    const status = !amountKnown && interval.precipitationProbability === undefined
      ? "unknown"
      : amount >= 0.1 || Number(interval.precipitationProbability) >= 40 ? "rain" : "none";
    const slot = document.createElement("div");
    slot.className = "timeline-slot";
    slot.dataset.rain = status;
    const bar = document.createElement("div");
    bar.className = "timeline-bar";
    bar.style.height = `${Math.max(12, Math.round(((amountKnown ? amount : 0) / maxAmount) * 60))}px`;
    const time = document.createElement("span");
    time.className = "timeline-time";
    time.textContent = formatTime(interval.start);
    const label = document.createElement("span");
    label.className = "timeline-amount";
    label.textContent = amountKnown ? formatMillimetres(amount) : "ukjent";
    slot.append(time, bar, label);
    elements.timeline.append(slot);
  }
  if (!intervals.length) {
    const empty = document.createElement("p");
    empty.className = "panel-copy";
    empty.textContent = decision?.reason === "no-location"
      ? "Velg et sted for å se nedbørsvinduet."
      : decision?.status === "unknown"
        ? "Ingen gyldig nedbørstidsserie tilgjengelig."
        : "Ingen intervaller tilgjengelig.";
    elements.timeline.append(empty);
  }
}

function renderNoLocationState() {
  elements.hero.dataset.status = "unknown";
  elements.modeLabel.textContent = "Ingen sted valgt";
  elements.statusSymbol.textContent = "?";
  elements.statusLabel.textContent = "VELG ET STED";
  elements.statusTitle.textContent = "Hvor skal vi se?";
  elements.statusMessage.textContent = "Velg en posisjon for å se været.";
  elements.statusRule.textContent = "Ingen værkall før et sted er valgt.";
  elements.forecastWindow.textContent = "—";
  elements.lastUpdated.textContent = "—";
  elements.maxPrecipitation.textContent = "—";
  elements.temperature.textContent = "—";
  elements.sourceStatus.textContent = "Ingen sted valgt";
  elements.notice.textContent = "Velg sted for å koble til MET Norway.";
  elements.refreshWeather.disabled = true;
  updateLocationLabels();
  renderTimeline(null, { status: "unknown", reason: "no-location" });
}

function renderState(state) {
  const { decision, weather, meta } = state;
  const copy = statusCopy(decision.status);
  elements.hero.dataset.status = decision.status;
  elements.modeLabel.textContent = meta.mode === "live" ? sourceLabel(weather.source) : "Demoforecast";
  elements.statusSymbol.textContent = copy.symbol;
  elements.statusLabel.textContent = copy.label;
  elements.statusTitle.textContent = copy.title;
  elements.statusMessage.textContent = copy.message;
  elements.statusRule.textContent = decision.rule || "Ingen forklaring tilgjengelig.";
  elements.forecastWindow.textContent = `${formatTime(decision.windowStart)}–${formatTime(decision.windowEnd)}`;
  elements.lastUpdated.textContent = formatTime(weather.observedAt);
  elements.maxPrecipitation.textContent = formatMillimetres(decision.evidence?.precipitationMm);
  elements.temperature.textContent = formatTemperature(weather.currentTemperature);
  elements.sourceStatus.textContent = weather.source === "fixture" ? "Demoforecast · MET Norway" : `MET Norway · ${sourceLabel(weather.source)}`;
  elements.notice.textContent = weather.source === "fixture"
    ? "Forhåndsvisning"
    : meta.notice || `Kontrollert ${formatTime(meta.fetchedAt)}.`;
  updateLocationLabels();
  renderTimeline(weather, decision);
}

function setBusy(isBusy) {
  document.body.classList.toggle("is-loading", isBusy);
  elements.refreshWeather.disabled = isBusy || !currentLocation;
  elements.refreshWeather.setAttribute("aria-busy", String(isBusy));
  elements.refreshWeather.firstChild.textContent = isBusy ? "Oppdaterer… " : "Oppdater nå ";
}

async function refreshWeather({ force = false } = {}) {
  if (!currentLocation) {
    renderNoLocationState();
    setBusy(false);
    return;
  }
  if (requestInFlight) return;
  if (!force && Date.now() - lastSuccessfulLoad < REFRESH_GUARD_MS) return;
  requestInFlight = true;
  setBusy(true);
  const query = new URLSearchParams({
    lat: currentLocation.latitude.toFixed(4),
    lon: currentLocation.longitude.toFixed(4),
    label: currentLocation.label,
  });
  try {
    const response = await fetch(`./api/weather?${query.toString()}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message || "Værdata er ikke tilgjengelig.");
    renderState(payload);
    lastSuccessfulLoad = Date.now();
  } catch (error) {
    elements.hero.dataset.status = "unknown";
    elements.statusSymbol.textContent = "?";
    elements.statusLabel.textContent = "VÆRDATA UKJENT";
    elements.statusTitle.textContent = "Vent litt med svaret";
    elements.statusMessage.textContent = "Trykk oppdater eller sjekk Yr manuelt.";
    elements.statusRule.textContent = "Ingen ny data ble brukt som om den var fersk.";
    elements.sourceStatus.textContent = "Tilkobling til værkilden feilet";
    elements.notice.textContent = error.message;
  } finally {
    requestInFlight = false;
    setBusy(false);
  }
}

async function updatePermissionStatus() {
  const capability = geolocationCapability();
  elements.useGeolocation.disabled = !capability.available;
  permissionState = await readGeolocationPermission();
  if (!permissionRequestInFlight && !elements.drawer.hidden) {
    elements.permissionNote.textContent = permissionStatusCopy({ permissionState, capability });
  }
}

function syncModalState() {
  document.body.classList.toggle("modal-open", !elements.drawer.hidden || !elements.detailsDrawer.hidden);
}

function toggleDetailsDrawer(isOpen) {
  elements.detailsDrawer.hidden = !isOpen;
  syncModalState();
  if (isOpen) {
    elements.closeDetails.focus();
  } else {
    elements.openDetails.focus();
  }
}

function toggleLocationDrawer(isOpen) {
  elements.drawer.hidden = !isOpen;
  syncModalState();
  if (isOpen) {
    elements.formError.textContent = "";
    elements.useGeolocation.focus();
    void updatePermissionStatus();
  } else {
    elements.openDetails.focus();
  }
}

elements.refreshWeather.addEventListener("click", () => refreshWeather({ force: true }));
elements.openDetails.addEventListener("click", () => toggleDetailsDrawer(true));
elements.closeDetails.addEventListener("click", () => toggleDetailsDrawer(false));
elements.closeDetailsBackdrop.addEventListener("click", () => toggleDetailsDrawer(false));
elements.openLocation.addEventListener("click", () => {
  toggleDetailsDrawer(false);
  toggleLocationDrawer(true);
});
document.querySelector("#close-location").addEventListener("click", () => toggleLocationDrawer(false));

elements.useGeolocation.addEventListener("click", async () => {
  // requestCurrentLocation invokes getCurrentPosition immediately, preserving
  // the click's user-activation context required by browser permission prompts.
  permissionRequestInFlight = true;
  elements.useGeolocation.disabled = true;
  elements.permissionNote.textContent = "Ber om engangstilgang til posisjonen din…";
  try {
    const result = await requestCurrentLocation();
    currentLocation = saveLocation(result.location);
    permissionState = "granted";
    elements.permissionNote.textContent = result.accuracy
      ? `Posisjonen er hentet med omtrent ±${result.accuracy} m nøyaktighet og lagret lokalt.`
      : "Posisjonen er hentet og lagret lokalt på denne enheten.";
    toggleLocationDrawer(false);
    await refreshWeather({ force: true });
  } catch (error) {
    permissionState = await readGeolocationPermission();
    elements.permissionNote.textContent = locationErrorCopy(error);
  } finally {
    permissionRequestInFlight = false;
    elements.useGeolocation.disabled = !geolocationCapability().available;
  }
});

elements.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const formData = new FormData(elements.form);
  try {
    currentLocation = saveLocation(normalizeLocation({
      label: String(formData.get("label") || "").trim(),
      latitude: formData.get("latitude"),
      longitude: formData.get("longitude"),
    }, { source: "manual" }));
    elements.formError.textContent = "";
    toggleLocationDrawer(false);
    void refreshWeather({ force: true });
  } catch (error) {
    elements.formError.textContent = error.message || "Skriv inn et navn og gyldige koordinater.";
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.drawer.hidden) {
    toggleLocationDrawer(false);
  } else if (!elements.detailsDrawer.hidden) {
    toggleDetailsDrawer(false);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshWeather();
});

updateLocationLabels();
if (currentLocation) void refreshWeather({ force: true });
else renderNoLocationState();
