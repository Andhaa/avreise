# Avreise App — Agent Instructions

This file is a project-specific scaffold. Replace values marked `[DECIDE]` before the first production implementation, or keep the documented default when it is appropriate. Instructions in this file apply to the `umbrella-signage/` project and are intentionally separate from the course repository in the parent directory.

## Product goal

The product name is **Avreise**. Keep `umbrella-signage` only where it is a repository, deployment, service-account, or filesystem identifier that must remain stable for existing installations.

Build a small, reliable, web-based signage app for a fixed display near a home exit. Its primary question is:

> “Trenger du paraply?”

The project has two presentation targets:

1. An interactive webpage that can be hosted on a Raspberry Pi or a small web service and viewed on an old phone, tablet, desktop browser, or e-reader browser.
2. A generated static image, preferably PNG, that can be opened or downloaded by a device with a limited browser or image viewer, including a discarded Kindle or similar e-reader.

Both outputs must use the same normalized weather data, decision logic, Norwegian wording, and visual design tokens. The app must make the answer readable from a distance and must remain useful on low-power, grayscale, and e-ink displays. The answer must never imply certainty when the weather service is unavailable, stale, or outside its radar coverage.

## Scope for the first release

### Must have

- A clear primary state: `TA MED PARAPLY`, `DU TRENGER IKKE PARAPLY`, or `VÆRDATA UKJENT`.
- The primary user-facing heading must be the exact Norwegian Bokmål text `Trenger du paraply?`.
- Default status text must be Norwegian Bokmål. Use concise labels such as `TA MED PARAPLY`, `DU TRENGER IKKE PARAPLY`, and `VÆRDATA UKJENT`; keep all strings centralized so translations can be added later.
- A short explanation showing the relevant forecast window, precipitation amount/probability when available, and the local time of the last successful update.
- Two location modes:
  - **Use device location:** request browser geolocation only after a user action, explain the permission request, and handle denial or unavailable hardware.
  - **Set location manually:** allow the user to enter a place name plus latitude/longitude and save it locally. The MVP intentionally uses coordinates rather than a map or geocoding provider.
- A visible way to change location and switch between location modes.
- A visible data-source attribution and a link to the relevant MET Norway/Yr documentation.
- A useful offline and API-error state. Never silently reuse old data as if it were current.
- Responsive layout for a desktop browser and the intended signage viewport.
- A static image output containing the same primary heading, recommendation, relevant time window, and last-updated time as the webpage.
- A documented image URL or export command that can produce the image without requiring a browser UI.

### Explicitly out of scope unless requested

- User accounts, analytics, advertising, push notifications, or a mobile app wrapper.
- Route-based weather, multi-location dashboards, long-range planning, or a full weather map.
- Automatic background geolocation tracking.
- Scraping `yr.no` HTML pages.
- Treating a radar image as a precise point forecast by image-color sampling.
- Requiring an e-reader to execute JavaScript in order to display the static image.

## Presentation and deployment modes

The weather decision is the shared source of truth. Build two thin presentation layers around it:

### Live webpage

- The webpage may include location setup, settings, refresh controls, API status, and optional diagnostic details.
- Keep the default signage view visually static and usable without interacting with the page.
- Host it on a Raspberry Pi, a static frontend host with a server-side weather adapter, or another documented service.

### Static image

- Expose a PNG endpoint or a documented image-generation command, for example `/status.png` or `generate-status-image`.
- Generate the image from normalized application state and shared layout tokens. Do not take a screenshot of the live webpage as the production mechanism.
- Keep the image free of controls, hover states, animation, external fonts, and dependencies that an old device must execute.
- Use high-contrast grayscale-safe text and shapes. The recommendation must remain understandable if all color information is removed.
- Make the image dimensions configurable because old phones, tablets, Kindles, and e-readers do not share one screen size. Define a canonical default in the project README, for example `[DECIDE: 600 × 800 or 800 × 600]`.
- Include enough metadata in the image for a user to judge freshness: selected location label, forecast window, and last-updated time. Do not make tiny metadata more prominent than the recommendation.
- Prefer PNG as the compatibility baseline. Add other formats only when a target device is known to require them.

A static image file does not update an e-reader by itself. The project must document the refresh mechanism for the chosen deployment: manual reload, an e-reader browser opening the image URL, a Raspberry Pi or local job periodically downloading the image, or another supported workflow. Do not claim “automatic updates” without implementing and testing that mechanism.

## Decisions that must be explicit

Do not invent product behavior silently. Record a decision in this file or in the project README when a choice affects the user experience or data interpretation.

- **Target audience:** one household or multiple users? Default: one household.
- **Target location:** Norway only, the Nordic area, or worldwide? Default: Norway/Nordic coverage.
- **Signage viewport:** `ios and android.  primarily older gen tablets. `.
- **Image viewport:** `800x600 and 600x800`.
- **Image refresh mechanism:** `on image request`.
- **Departure window:** `Current time, +60 min`. Recommended MVP default: from the current time through the next 90 minutes.
- **Rain threshold:** `any rain, configurable tolerance`. Recommended MVP default: warn when measurable precipitation is expected during the departure window, with a configurable low-precipitation tolerance.
- **Refresh policy:** `refresh on load`. Default: refresh on load, when the location changes, when the page becomes visible, and no more often than the provider’s update cadence or cache headers require.
- **Timezone:** use the location’s local civil time. Default: browser display time with a clearly documented assumption; use a timezone service only if the selected location can differ from the device timezone.
- **Language:** Default: Norwegian Bokmål (`nb`). The primary heading is `Trenger du paraply?`; keep strings centralized so English can be added later without changing decision logic.
- **Data retention:** default to local storage only for the selected location and preferences; do not store a location history.

## Weather-data integration

Use the official MET Norway Weather API at `api.met.no`; do not depend on undocumented `yr.no` page behavior.

### Recommended provider strategy

1. Use **Nowcast 2.0** as the primary decision source for the immediate umbrella question. It provides a two-hour forecast, is updated every five minutes, and is intended for immediate precipitation. Inspect and surface its radar-coverage status.
2. Use **Locationforecast 2.0 compact** as a fallback or supplementary source when the immediate nowcast is unavailable, clearly labeling the result as lower-confidence or forecast-based.
3. Treat **Radar 2.0** as an optional visual/status aid, not as the sole decision engine. Radar 2.0 returns static images or animations for areas; it is not a direct “rain at this coordinate” response.

The exact endpoint, schema, and supported coverage must be verified against the current official documentation before implementation. Keep the provider adapter isolated so another provider or a fixture can be substituted in tests.

### Required API behavior

- Send a specific identifying `User-Agent` from the server-side adapter, including the app name/version and a contact URL or email. Never put a secret or private contact detail in client-side JavaScript.
- Prefer a small backend, serverless function, or edge function for provider requests. A browser client cannot freely set the `User-Agent` header, and the provider requires an identifying user agent for normal use.
- Use HTTPS only.
- Round coordinates to no more than four decimal places before calling the provider, unless the current provider documentation states otherwise.
- Respect `Expires`, `Last-Modified`, and `304 Not Modified` responses. Avoid polling on every render or on a synchronized “top of the hour” schedule.
- Cache normalized responses for a short, documented period. Use bounded timeouts and at most a small number of backoff retries; do not create a retry loop.
- Normalize provider responses into an internal model such as:

  ```ts
  type WeatherDecisionInput = {
    location: { latitude: number; longitude: number; label?: string };
    observedAt: string;
    validUntil: string;
    coverage: "ok" | "temporarily-unavailable" | "no-coverage";
    intervals: Array<{
      start: string;
      end: string;
      precipitationMm?: number;
      precipitationProbability?: number;
      symbolCode?: string;
    }>;
    source: "nowcast" | "locationforecast" | "fixture";
  };
  ```

- Handle these states explicitly: loading, valid, stale, no coverage, provider error, malformed provider data, permission denied, and no location configured.
- Show “last updated” and “forecast valid through” times. If the data is stale past the defined limit, use `VÆRDATA UKJENT` rather than a confident yes/no answer.

### Decision logic

Keep umbrella classification pure and independently testable. It should accept normalized data, the current local time, the departure window, and thresholds; it should not call the network or read browser APIs.

At minimum, test:

- no precipitation in the window;
- precipitation starting within the window;
- light drizzle below and above the chosen tolerance;
- probability-only data;
- missing precipitation fields;
- stale data;
- no radar coverage or temporarily unavailable radar;
- a window crossing midnight or a daylight-saving transition;
- a location outside the provider’s supported area.

The UI must explain which rule produced the result. If the source cannot support a confident classification, return `WEATHER UNKNOWN` with a helpful next action such as “Check the forecast” or “Set a location.”

## Location and privacy

- Request geolocation only in response to an explicit action such as “Use my location.”
- Explain that the coordinates are sent to the weather provider and, if applicable, through the app’s backend. Do not request continuous tracking.
- Validate latitude and longitude ranges and normalize precision before storage and API requests.
- Store only the minimum local preference data required to restore the selected location.
- Do not log precise coordinates, raw provider responses, or browser permission details in production logs unless there is a documented retention and redaction policy.
- Do not place provider credentials, private keys, or privileged API configuration in the browser bundle.

## Low-power, e-ink, and accessibility requirements

- Use a mostly static layout with no auto-rotating content, video, parallax, gradients, or decorative animation.
- Default to a black/white or near-black/near-white palette with one high-contrast status treatment. Never use color as the only signal; pair it with text, iconography, and structure.
- Prefer CSS borders, solid fills, and text over large raster images. If a radar image is shown, make it optional and never let it displace the primary answer.
- Support `prefers-reduced-motion`; default to no transitions.
- Avoid rapid polling, frequent DOM updates, and unnecessary image downloads.
- Use large, legible type, generous contrast, and a focus-visible keyboard path.
- Provide semantic headings, landmark elements, form labels, accessible status announcements, and meaningful text alternatives for icons.
- Ensure the primary status is visible without scrolling at the target viewport.
- Test with a real grayscale or e-ink device if available. At minimum, test browser grayscale, high contrast, keyboard navigation, zoom, and narrow viewport behavior.
- The static PNG must remain legible when viewed without the webpage controls or browser chrome.
- Avoid fine lines, low-contrast gray text, large photographic backgrounds, and details that disappear after e-ink dithering or grayscale conversion.

## Recommended implementation defaults

If no existing project stack is present, use:

- TypeScript with a small component-based frontend.
- A minimal CSS layer rather than a large visual component library.
- A thin server-side weather adapter with a provider interface and fixture-backed tests.
- A server-side image renderer or export command that consumes the same normalized state as the webpage.
- `localStorage` for the selected location and display preferences; no database for the MVP.
- A small, deterministic state machine for loading/data/error/unknown states.
- UTC timestamps internally and localized formatting only at the presentation boundary.

Do not add dependencies unless they solve a documented requirement. Keep the initial bundle small and inspect the production bundle before calling the app low-power optimized.

## Project structure

Use a structure close to this unless the existing repository already has a stronger convention:

```text
src/
  app/              # application shell and route/state composition
  components/       # presentational UI components
  domain/           # umbrella decision logic and normalized types
  providers/        # MET/Yr adapter and test fixtures
  location/         # geolocation, manual selection, persistence
  styles/           # grayscale/e-ink-friendly tokens and layout
server/             # provider proxy/edge handler, if required by deployment
tests/              # unit, integration, and accessibility checks
docs/               # API notes, decisions, and display setup
```

Keep provider-specific field names out of `domain/` and `components/`. Do not let UI components calculate precipitation thresholds.

## Verification requirements

Before declaring the work complete:

- Run the project’s formatter, linter, type checker, and test suite.
- Test the weather decision with deterministic fixtures; do not make CI depend on live weather.
- Test the provider adapter with mocked 200, 304, 403, 404/422, 429, 5xx, timeout, malformed JSON, and no-coverage responses.
- Test geolocation success, denial, timeout, unsupported browser, and manual-location fallback.
- Test a refresh with cached data and verify that no unnecessary provider request is made.
- Verify that no secrets or provider credentials are present in the client bundle.
- Test the production build at the documented signage viewport and in grayscale.
- Confirm the UI remains understandable when JavaScript is slow, the network is offline, or the forecast is stale.
- Generate the static PNG in tests and verify its dimensions, file type, grayscale readability, and presence of the Norwegian heading `Trenger du paraply?`.
- Verify that the live webpage and static image show the same recommendation, location, forecast window, and freshness state for the same fixture.
- Test the documented e-reader refresh workflow or clearly label the image workflow as manual if automatic refresh is not implemented.
- Include a short README section explaining setup, deployment, the weather source, attribution, privacy behavior, threshold defaults, and known coverage limits.

## Definition of done

The MVP is done only when a person can open the app, configure a location using either supported method, understand the current umbrella recommendation at a glance, see when and from where the data came, and receive an honest unknown/error state when the app cannot make a reliable recommendation. The app must pass the verification requirements above and must not rely on a developer’s undocumented local setup.

## Open decisions checklist

Resolve these before implementation is considered final:

- [ ] Target display dimensions, orientation, and viewing distance.
- [ ] Static image dimensions, format, and whether the default device is portrait or landscape.
- [ ] How the static image is refreshed on the target e-reader or discarded device.
- [x] Whether manual location means map pin, coordinate entry, or place-name search: coordinate entry with a place label; no geocoding provider.
- [ ] Departure window and precipitation thresholds.
- [ ] Whether the app should display a radar image at all.
- [ ] Whether Nowcast 2.0 coverage is sufficient for the intended locations.
- [ ] Backend/hosting choice for the provider adapter and identifying `User-Agent`.
- [ ] Language and exact user-facing wording.
- [ ] Stale-data maximum age and offline behavior.
- [ ] Attribution/license text and privacy notice.
