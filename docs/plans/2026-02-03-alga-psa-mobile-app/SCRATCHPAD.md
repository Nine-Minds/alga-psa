# Scratchpad — Alga PSA Mobile App (2026-02-03)

Rolling notes for implementing `docs/plans/2026-02-03-alga-psa-mobile-app`.

## Log
- 2026-02-03: Initialized scratchpad.
- 2026-02-03: F001 scaffolded Expo (managed) app in `mobile/` with `mobile/README.md` runbook. Kept it outside npm workspaces to avoid dependency/React version coupling with the existing web app.
- 2026-02-03: F002 added hosted env config plumbing via `mobile/.env.example` + `mobile/src/config/appConfig.ts` (expects `EXPO_PUBLIC_ALGA_ENV` and `EXPO_PUBLIC_ALGA_BASE_URL`).
- 2026-02-03: F003 added a minimal typed REST client wrapper in `mobile/src/api/*` returning structured `ApiResult<T>` with consistent error kinds (network/timeout/http/parse).
- 2026-02-03: F004 extended the client to stamp `Authorization: Bearer`, `x-tenant-id`, and `x-alga-client` headers via injectable getters.
- 2026-02-03: F005 added timeout + retry/backoff (GET/HEAD only) to `mobile/src/api/client.ts` (retries on network/timeout and 502/503/504).
- 2026-02-03: F006 added basic app bootstrap/auth-gate skeleton in `mobile/src/app/AppRoot.tsx` with a minimal in-app loading sequence.
- 2026-02-03: F007 wired React Navigation (tabs + stacks) and deep link routing (`alga://ticket/:ticketId`) via `mobile/src/navigation/*` and `mobile/app.json` scheme.
- 2026-02-03: F008 added a minimal mobile theme (`mobile/src/ui/theme.ts`) and started using it across placeholder screens.
- 2026-02-03: F009 added standard empty/loading/error state components in `mobile/src/ui/states/*` and a basic `PrimaryButton`.
- 2026-02-03: F010 added secure storage wrapper using `expo-secure-store` in `mobile/src/storage/secureStorage.ts` (with web fallback).
- 2026-02-03: F011 added PII-safe logger with recursive redaction + log-level control in `mobile/src/logging/logger.ts` (configured via `EXPO_PUBLIC_LOG_LEVEL`).
- 2026-02-03: F012 added analytics scaffolding (`mobile/src/analytics/analytics.ts`) with opt-out toggle (currently logs redacted events; provider TBD).
- 2026-02-03: F013 added crash/error reporting hook scaffold with PII redaction (`mobile/src/errors/*`), including a global handler + React error boundary.
- 2026-02-03: F014 added a basic TTL cache utility + ticket list/detail cache helpers (`mobile/src/cache/*`) with invalidation hooks for future mutations.
