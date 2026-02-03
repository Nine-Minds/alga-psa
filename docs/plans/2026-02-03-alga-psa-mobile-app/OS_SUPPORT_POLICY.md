# Minimum OS Support Policy

Date: `2026-02-03`

## Policy

- The mobile app supports the minimum iOS/Android OS versions supported by the **current Expo SDK** used in `mobile/`.
- When upgrading Expo SDK / React Native, minimum OS support may change; review and update this document as part of the upgrade.

## Current targets (MVP)

These targets are aligned to the Expo SDK pinned in `mobile/package.json` (SDK `~54`).

- iOS: **iOS 15+** (target)
- Android: **Android 8.0+ (API 26+)** (target)

## Upgrade checklist

- Confirm the supported OS matrix for the new Expo SDK.
- Update store listing “Requires” fields and release notes if minimums change.
- Update any CI/emulator configurations used for smoke testing.

