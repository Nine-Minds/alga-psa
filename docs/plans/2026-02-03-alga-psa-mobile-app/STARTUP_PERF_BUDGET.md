# Startup Performance Budget (V1)

This document defines a simple startup performance budget for the Alga PSA mobile app and how to measure it consistently.

## Budget (targets)

- **Cold start → first interactive screen**: ≤ 2.5s on a modern device (release build).
- **Warm start / resume → interactive**: ≤ 1.0s (release build).
- **Auth restore**: session restore should not block UI beyond 250ms (no network).

These are initial targets for the ticketing MVP and should be revisited as the app grows.

## Measurement

- Prefer measuring on **release builds** (dev builds can be misleading).
- Record:
  - platform (iOS/Android)
  - build type (dev/release)
  - device model + OS version
  - network state (wifi/cellular/offline)
  - signed-in vs signed-out

### Manual measurement

- iOS: Xcode Instruments → Time Profiler + startup timeline.
- Android: Android Studio Profiler + startup trace.

### App-level telemetry

- The app emits a basic `app.startup.ready` event with the time from JS startup to “boot complete” so we can track regressions over time (provider TBD).

