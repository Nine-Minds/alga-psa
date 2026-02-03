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
