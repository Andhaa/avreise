export const LOCATION_STORAGE_KEY = "umbrella-signage-location";
export const LOCATION_PRECISION = 4;

function browserStorage() {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function browserNavigator() {
  return typeof navigator === "undefined" ? undefined : navigator;
}

function browserDocument() {
  return typeof document === "undefined" ? undefined : document;
}

function browserSecureContext() {
  return typeof isSecureContext === "boolean" ? isSecureContext : false;
}

function rounded(value) {
  return Number(Number(value).toFixed(LOCATION_PRECISION));
}

export class LocationServiceError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "LocationServiceError";
    this.code = code;
    this.cause = cause;
  }
}

/**
 * Validate and normalize the only location data the app needs.
 * `source` is intentionally limited to a displayable mode, never a tracking
 * state: the app does not watch the device in the background.
 */
export function normalizeLocation(input = {}, { source = "manual" } = {}) {
  const latitude = Number(input.latitude ?? input.lat);
  const longitude = Number(input.longitude ?? input.lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new LocationServiceError("invalid-location", "Breddegrad må være mellom −90 og 90.");
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new LocationServiceError("invalid-location", "Lengdegrad må være mellom −180 og 180.");
  }

  const label = String(input.label || "Valgt sted").replace(/[<>]/g, "").trim().slice(0, 80) || "Valgt sted";
  return {
    label,
    latitude: rounded(latitude),
    longitude: rounded(longitude),
    source: source === "device" ? "device" : "manual",
  };
}

export function loadSavedLocation(storage = browserStorage()) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const saved = JSON.parse(storage.getItem(LOCATION_STORAGE_KEY));
    if (!saved) return null;
    return normalizeLocation(saved, { source: saved.source });
  } catch {
    // A corrupt or unavailable preference must not prevent the signage from starting.
    return null;
  }
}

export function saveLocation(location, storage = browserStorage()) {
  const normalized = normalizeLocation(location, { source: location.source });
  try {
    storage?.setItem?.(LOCATION_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Private browsing or browser policy can make localStorage unavailable.
  }
  return normalized;
}

export function geolocationCapability({
  navigatorRef = browserNavigator(),
  documentRef = browserDocument(),
  secureContext = browserSecureContext(),
} = {}) {
  if (!secureContext) return { available: false, reason: "insecure-context" };
  if (!navigatorRef?.geolocation || typeof navigatorRef.geolocation.getCurrentPosition !== "function") {
    return { available: false, reason: "unsupported" };
  }

  // A site can have browser-level location permission and still be blocked by
  // the document's Permissions-Policy header. Detect that before calling the
  // API so the UI can point at the deployment configuration instead of asking
  // the user to change a permission that is already allowed.
  const policy = documentRef?.permissionsPolicy || documentRef?.featurePolicy;
  if (policy && typeof policy.allowsFeature === "function") {
    try {
      if (!policy.allowsFeature("geolocation")) return { available: false, reason: "permissions-policy" };
    } catch {
      // Older browser implementations may expose the policy object but not
      // support querying this feature. Let the geolocation API decide then.
    }
  }

  return { available: true, reason: "available" };
}

export async function readGeolocationPermission({ navigatorRef = browserNavigator() } = {}) {
  const permissions = navigatorRef?.permissions;
  if (!permissions || typeof permissions.query !== "function") return "unknown";
  try {
    const result = await permissions.query({ name: "geolocation" });
    return ["granted", "prompt", "denied"].includes(result?.state) ? result.state : "unknown";
  } catch {
    // Some older WebViews expose geolocation but not the Permissions API.
    return "unknown";
  }
}

/**
 * Request one current position. This function deliberately calls
 * getCurrentPosition synchronously before any await, so a click handler keeps
 * the browser's user-activation context and can open the native permission
 * prompt. It never starts watchPosition or background tracking.
 */
export function requestCurrentLocation({
  navigatorRef = browserNavigator(),
  documentRef = browserDocument(),
  secureContext = browserSecureContext(),
} = {}) {
  const capability = geolocationCapability({ navigatorRef, documentRef, secureContext });
  if (!capability.available) {
    const message = capability.reason === "insecure-context"
      ? "Nettstedet må åpnes med HTTPS før nettleseren kan spørre om posisjon."
      : capability.reason === "permissions-policy"
        ? "Nettstedet blokkerer posisjon gjennom en sikkerhetspolicy."
        : "Denne nettleseren støtter ikke posisjon.";
    return Promise.reject(new LocationServiceError(capability.reason, message));
  }

  return new Promise((resolve, reject) => {
    try {
      navigatorRef.geolocation.getCurrentPosition(
        (position) => {
          try {
            const location = normalizeLocation({
              label: "Enhetens posisjon",
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }, { source: "device" });
            resolve({ location, accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy) : undefined });
          } catch (error) {
            reject(error);
          }
        },
        (error) => {
          const code = error?.code === 1
            ? "permission-denied"
            : error?.code === 2
              ? "position-unavailable"
              : error?.code === 3
                ? "timeout"
                : "unknown";
          reject(new LocationServiceError(code, "Nettleseren kunne ikke hente posisjonen.", error));
        },
        {
          enableHighAccuracy: false,
          timeout: 15_000,
          maximumAge: 0,
        },
      );
    } catch (error) {
      reject(new LocationServiceError("request-failed", "Posisjon kunne ikke startes.", error));
    }
  });
}

export function permissionStatusCopy({ permissionState, capability, secureContext = browserSecureContext() } = {}) {
  if (capability?.reason === "insecure-context" || secureContext === false) {
    return "Åpne siden med HTTPS for å kunne bruke enhetens posisjon.";
  }
  if (capability?.reason === "unsupported") {
    return "Denne nettleseren kan ikke hente posisjon. Bruk et fast sted under.";
  }
  if (capability?.reason === "permissions-policy") {
    return "Denne siden blokkerer posisjon gjennom en sikkerhetspolicy. Administratoren må tillate geolocation for nettstedet, eller bruk et fast sted under.";
  }
  if (permissionState === "denied") {
    return "Posisjon er blokkert for dette nettstedet. Trykk på hengelåsen i adressefeltet, velg Sted → Tillat, og last siden på nytt.";
  }
  if (permissionState === "granted") {
    return "Nettleseren har allerede tillatelse. Trykk for å hente en ny posisjon én gang.";
  }
  return "Når du trykker, spør nettleseren om engangstilgang. Vi følger ikke posisjonen i bakgrunnen.";
}

export function locationErrorCopy(error) {
  switch (error?.code) {
    case "permission-denied":
      return "Posisjon er blokkert for dette nettstedet. Tillat Sted i nettleserens nettstedinnstillinger, eller bruk et fast sted under.";
    case "position-unavailable":
      return "Enheten fant ikke en posisjon. Kontroller at stedstjenester er slått på, eller bruk et fast sted under.";
    case "timeout":
      return "Det tok for lang tid å finne posisjonen. Prøv igjen nær et vindu, eller bruk et fast sted under.";
    case "insecure-context":
      return "Posisjon krever HTTPS. Åpne den sikre adressen, eller bruk et fast sted under.";
    case "unsupported":
      return "Denne nettleseren støtter ikke posisjon. Bruk et fast sted under.";
    case "permissions-policy":
      return "Denne siden blokkerer posisjon gjennom en sikkerhetspolicy. Administratoren må tillate geolocation for nettstedet, eller bruk et fast sted under.";
    default:
      return error?.message || "Posisjonen kunne ikke hentes. Bruk et fast sted under.";
  }
}
