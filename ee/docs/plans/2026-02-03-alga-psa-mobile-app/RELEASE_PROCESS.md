# Mobile Release Process (Signing, Versioning, Release Notes)

Scope: The first-party `ee/mobile/` Expo app for hosted AlgaPSA environments.

Last updated: 2026-08-20

## Signing

### iOS (TestFlight / App Store)

- Builds are produced via EAS (`ee/mobile/eas.json`).
- Signing credentials are managed by EAS using App Store Connect (recommended).
- App must exist in App Store Connect and use the same bundle id as `ee/mobile/app.json` (`expo.ios.bundleIdentifier`).

### Android (Play Internal / Play Store)

- Builds are produced via EAS (`ee/mobile/eas.json`).
- Keystore is managed by EAS (recommended).
- App must exist in Google Play Console and use the same package name as `ee/mobile/app.json` (`expo.android.package`).

## Versioning

### Human version

- Update `expo.version` in `ee/mobile/app.json` and `version` in both
  `ee/mobile/package.json` and its lockfile. These values must match (for
  example, `1.4.0` → `1.5.0`).

### Build numbers

- iOS: increment `expo.ios.buildNumber` (string, monotonically increasing).
- Android: increment `expo.android.versionCode` (number, monotonically increasing).

Recommendation: bump both build numbers on every CI distribution run, even when `expo.version` stays the same.

Before committing a release bump, resolve the Expo config and verify the
effective version and build numbers:

```bash
cd ee/mobile
npm run verify:expo-config
```

## Release Notes

- Keep release notes in the release's plan folder so they are reviewable
  alongside scope.
- Create one file per release:
  - `ee/docs/plans/<release-plan>/RELEASE_NOTES.md`
- Minimum structure:
  - Highlights
  - Fixes
  - Known issues
  - Config changes / migrations (if any)

## CI / Automation

- GitHub Actions workflow: `.github/workflows/mobile-distribute.yml`
- Required secrets:
  - `EXPO_TOKEN`
  - `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` containing the complete Google Play
    service account key JSON (Play Internal only)
- Every distribution run has a required preflight job. Lint, typecheck, unit
  tests, and Expo config resolution must all pass before the EAS build job can
  start.
- For Android, CI validates `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` and writes it to
  the gitignored `ee/mobile/google-service-account.json` path on the ephemeral
  runner, then removes it after submission. Do not commit or upload this key as
  a build artifact.
- Before first run:
  - Create the Expo project and run `eas build:configure` locally once to bootstrap config/credentials.
  - Configure the store submit profiles in `ee/mobile/eas.json` and the
    corresponding repository secrets.
