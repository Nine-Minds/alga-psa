# AlgaPSA Mobile (Expo / React Native)

This is the first-party AlgaPSA mobile app scaffold (iOS + Android) built with Expo (managed workflow).

## Prereqs

- Node.js `>=20`
- For device/simulator:
  - iOS: Xcode + iOS Simulator
  - Android: Android Studio + emulator

## Install

```bash
cd ee/mobile
npm ci
```

Create a local env file:

```bash
cd ee/mobile
cp .env.example .env
```

## Environment

- `EXPO_PUBLIC_ALGA_ENV`: `dev|stage|prod`

## Run

```bash
cd ee/mobile
npm run start
```

Then choose a target:
- Press `i` for iOS simulator
- Press `a` for Android emulator

Or run directly:

```bash
cd ee/mobile
npm run ios
npm run android
```

## Deep links

- Scheme: `alga://`
- Ticket detail route: `alga://ticket/:ticketId`

## Quality checks

```bash
cd ee/mobile
npm run lint
npm run typecheck
npm run test
npm run verify:expo-config
```

All four checks are mandatory in the distribution workflow and complete before
an EAS build is started.

## Build / Release

This repo currently uses Expo managed workflow. A typical path to internal distribution:

1) Install EAS CLI: `npm i -g eas-cli`
2) Authenticate: `eas login`
3) Configure project: `eas build:configure`
4) Build:
   - iOS (TestFlight): `eas build -p ios --profile testflight`
   - Android (Play Internal): `eas build -p android --profile playInternal`

### CI distribution (GitHub Actions)

Workflow: `.github/workflows/mobile-distribute.yml` (manual trigger).

Required repo secrets:

- `EXPO_TOKEN` (Expo access token for EAS)
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` (the complete Google Play service account
  key JSON; required only for Play Internal submission)

Notes:

- `ee/mobile/app.json` defines the bundle identifiers/package names used by EAS builds.
- Keep `expo.version` in `ee/mobile/app.json` aligned with the version in
  `ee/mobile/package.json`, and increment both platform build numbers for each
  store build.
- The distribution workflow validates the Google Play JSON secret and writes
  it to the ignored `ee/mobile/google-service-account.json` path only on the
  ephemeral Android runner, then removes it after submission. Never commit the
  service account key.
- `ee/mobile/eas.json` contains the App Store Connect app ID and store submit
  profiles used by CI.
