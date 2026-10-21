import test from "node:test";
import assert from "node:assert/strict";
import {
  geolocationCapability,
  locationErrorCopy,
  loadSavedLocation,
  normalizeLocation,
  permissionStatusCopy,
  readGeolocationPermission,
  requestCurrentLocation,
  saveLocation,
} from "../public/location.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("normalizes a location and records its source", () => {
  assert.deepEqual(normalizeLocation({ label: "  Hjem <3  ", latitude: 59.9139123, longitude: 10.7522345 }, { source: "device" }), {
    label: "Hjem 3",
    latitude: 59.9139,
    longitude: 10.7522,
    source: "device",
  });
});

test("rejects locations outside coordinate bounds", () => {
  assert.throws(() => normalizeLocation({ latitude: 91, longitude: 10 }), /Breddegrad/);
  assert.throws(() => normalizeLocation({ latitude: 60, longitude: 181 }), /Lengdegrad/);
});

test("loads and saves only a normalized local location", () => {
  const storage = memoryStorage();
  assert.equal(loadSavedLocation(storage), null);
  const saved = saveLocation({ label: "Hjem", latitude: "60.00009", longitude: "10.00009", source: "manual" }, storage);
  assert.deepEqual(saved, { label: "Hjem", latitude: 60.0001, longitude: 10.0001, source: "manual" });
  assert.deepEqual(loadSavedLocation(storage), saved);
});

test("reports whether browser geolocation can be used", () => {
  assert.deepEqual(geolocationCapability({ secureContext: false, navigatorRef: { geolocation: {} } }), { available: false, reason: "insecure-context" });
  assert.deepEqual(geolocationCapability({ secureContext: true, navigatorRef: {} }), { available: false, reason: "unsupported" });
  assert.deepEqual(geolocationCapability({ secureContext: true, navigatorRef: { geolocation: { getCurrentPosition() {} } } }), { available: true, reason: "available" });
});

test("reports a Permissions Policy block separately from browser permission", () => {
  const navigatorRef = { geolocation: { getCurrentPosition() {} } };
  const documentRef = { permissionsPolicy: { allowsFeature: (feature) => feature !== "geolocation" } };
  const capability = geolocationCapability({ secureContext: true, navigatorRef, documentRef });
  assert.deepEqual(capability, { available: false, reason: "permissions-policy" });
  assert.match(permissionStatusCopy({ permissionState: "granted", capability, secureContext: true }), /sikkerhetspolicy/);
});

test("does not call geolocation when Permissions Policy blocks it", async () => {
  let callCount = 0;
  const navigatorRef = {
    geolocation: {
      getCurrentPosition() {
        callCount += 1;
      },
    },
  };
  const documentRef = { permissionsPolicy: { allowsFeature: () => false } };
  await assert.rejects(
    requestCurrentLocation({ navigatorRef, documentRef, secureContext: true }),
    { code: "permissions-policy" },
  );
  assert.equal(callCount, 0);
  assert.match(locationErrorCopy({ code: "permissions-policy" }), /sikkerhetspolicy/);
});

test("reads the browser permission state without requesting it", async () => {
  let queried = 0;
  const navigatorRef = {
    permissions: {
      query: async ({ name }) => {
        assert.equal(name, "geolocation");
        queried += 1;
        return { state: "prompt" };
      },
    },
  };
  assert.equal(await readGeolocationPermission({ navigatorRef }), "prompt");
  assert.equal(queried, 1);
});

test("requests one current position with a fresh reading", async () => {
  let callCount = 0;
  const navigatorRef = {
    geolocation: {
      getCurrentPosition(success, _failure, options) {
        callCount += 1;
        assert.equal(options.maximumAge, 0);
        assert.equal(options.enableHighAccuracy, false);
        success({ coords: { latitude: 60.00009, longitude: 10.00009, accuracy: 22.4 } });
      },
    },
  };
  const result = await requestCurrentLocation({ navigatorRef, secureContext: true });
  assert.equal(callCount, 1);
  assert.deepEqual(result, {
    location: { label: "Enhetens posisjon", latitude: 60.0001, longitude: 10.0001, source: "device" },
    accuracy: 22,
  });
});

test("maps browser denial to an actionable message", async () => {
  const navigatorRef = {
    geolocation: {
      getCurrentPosition(_success, failure) {
        failure({ code: 1 });
      },
    },
  };
  await assert.rejects(requestCurrentLocation({ navigatorRef, secureContext: true }), { code: "permission-denied" });
  assert.match(locationErrorCopy({ code: "permission-denied" }), /nettstedet/);
  assert.match(permissionStatusCopy({ permissionState: "denied", capability: { available: true, reason: "available" }, secureContext: true }), /blokkert/);
});
