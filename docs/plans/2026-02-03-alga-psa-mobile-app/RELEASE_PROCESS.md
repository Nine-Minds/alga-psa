# Mobile Release Process (Signing, Versioning, Release Notes)

Scope: Ticketing MVP + SSO (`mobile/` Expo app) for hosted Alga PSA environments.

Last updated: 2026-02-03

## Signing

### iOS (TestFlight / App Store)

- Builds are produced via EAS (`mobile/eas.json`).
- Signing credentials are managed by EAS using App Store Connect (recommended).
- App must exist in App Store Connect and use the same bundle id as `mobile/app.json` (`expo.ios.bundleIdentifier`).

### Android (Play Internal / Play Store)

- Builds are produced via EAS (`mobile/eas.json`).
- Keystore is managed by EAS (recommended).
- App must exist in Google Play Console and use the same package name as `mobile/app.json` (`expo.android.package`).

## Versioning

### Human version

- Update `mobile/app.json`:
  - `expo.version` (e.g. `1.0.0` → `1.0.1`)

### Build numbers

- iOS: increment `expo.ios.buildNumber` (string, monotonically increasing).
- Android: increment `expo.android.versionCode` (number, monotonically increasing).

Recommendation: bump both build numbers on every CI distribution run, even when `expo.version` stays the same.

## Release Notes

- Keep release notes in this plan folder so they are reviewable alongside scope.
- Create one file per release:
  - `docs/plans/2026-02-03-alga-psa-mobile-app/release-notes/YYYY-MM-DD.md`
- Minimum structure:
  - Highlights
  - Fixes
  - Known issues
  - Config changes / migrations (if any)

## CI / Automation

- GitHub Actions workflow: `.github/workflows/mobile-distribute.yml`
- Required secrets:
  - `EXPO_TOKEN`
- Before first run:
  - Create the Expo project and run `eas build:configure` locally once to bootstrap config/credentials.
  - Replace placeholders in `mobile/eas.json` submit profiles (e.g. `ascAppId`) and/or configure EAS submit credentials.

