# Alga PSA Mobile (Expo / React Native)

This is the first-party Alga PSA mobile app scaffold (iOS + Android) built with Expo (managed workflow).

## Prereqs

- Node.js `>=20`
- For device/simulator:
  - iOS: Xcode + iOS Simulator
  - Android: Android Studio + emulator

## Install

```bash
cd mobile
npm ci
```

Create a local env file:

```bash
cd mobile
cp .env.example .env
```

## Environment

- `EXPO_PUBLIC_ALGA_ENV`: `dev|stage|prod`
- `EXPO_PUBLIC_ALGA_BASE_URL`: hosted base URL (no trailing slash)

## Run

```bash
cd mobile
npm run start
```

Then choose a target:
- Press `i` for iOS simulator
- Press `a` for Android emulator

Or run directly:

```bash
cd mobile
npm run ios
npm run android
```

## Deep links

- Scheme: `alga://`
- Ticket detail route: `alga://ticket/:ticketId`

## Quality checks

```bash
cd mobile
npm run lint
npm run typecheck
npm run test
```

## Build / Release (draft)

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

Notes:

- `mobile/app.json` defines the bundle identifiers/package names used by EAS builds.
- `mobile/eas.json` includes placeholder submit configuration (e.g. `ascAppId`); replace with real values before using `eas submit`.
