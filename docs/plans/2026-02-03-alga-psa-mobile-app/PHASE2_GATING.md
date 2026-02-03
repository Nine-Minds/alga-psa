# Phase 2 Feature Gating

Phase 2 modules (push notifications, self-hosted onboarding, etc.) are **non-goals** for the MVP and must not be exposed in production builds.

## Policy

- Production builds hard-disable Phase 2 features regardless of environment variables.
- Developers may temporarily enable Phase 2 stubs in development builds for incremental work.

## Implementation

See `mobile/src/features/phase2.ts`:

- `phase2Features.notifications`
- `phase2Features.selfHostedBaseUrl`

These flags only evaluate to `true` when `__DEV__ === true`.

## Dev-only toggles

- `EXPO_PUBLIC_PHASE2_NOTIFICATIONS=true`
- `EXPO_PUBLIC_PHASE2_SELF_HOSTED=true`

