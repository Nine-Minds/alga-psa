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
- 2026-02-03: F015 added `useAppResume` + `usePullToRefresh` hooks and wired the tickets placeholder screen with pull-to-refresh and resume-triggered refresh.
- 2026-02-03: F016 added offline detection using `@react-native-community/netinfo` with a global `OfflineBanner` in `mobile/src/app/AppRoot.tsx`.
- 2026-02-03: F017 added baseline accessibility helpers (`mobile/src/ui/a11y.ts`) and ensured key pressables have roles/labels and minimum touch targets.
- 2026-02-03: F018 added localization scaffolding using `expo-localization` (`mobile/src/i18n/i18n.ts`) and started using `t()` for navigation titles.
- 2026-02-03: F019 implemented Settings diagnostics (app version/build, platform, env/base URL) in `mobile/src/screens/SettingsScreen.tsx` using `expo-application`.
- 2026-02-03: F020 added mobile CI checks (`.github/workflows/mobile-checks.yml`) and mobile `lint`/`typecheck` scripts with local `eslint.config.mjs`.
- 2026-02-03: F021 added mobile unit test harness (Vitest) + CI job (`mobile-tests`) and a first config unit test (`mobile/src/config/appConfig.test.ts`).
- 2026-02-03: F022 expanded `mobile/README.md` with env/deep-link/quality-check and a draft build/release runbook.
- 2026-02-03: F023 implemented Sign In screen CTA to open the system browser to hosted web login (`/auth/signin`) using configured `EXPO_PUBLIC_ALGA_BASE_URL`.
- 2026-02-03: F024 added deep link auth callback handler screen (`AuthCallback`) that validates `state` against locally stored pending auth state and captures `ott` for later exchange.
- 2026-02-03: F025 wired OTT exchange call (`POST /api/v1/mobile/auth/exchange`) and creates an in-memory mobile session on success, routing users into the signed-in app.
- 2026-02-03: F026 persists the issued mobile session to secure storage and restores it on cold start (clears it if expired).
- 2026-02-03: F027 adds proactive session refresh scheduling (refresh ~60s before expiry) and a resume-triggered refresh when near expiry (`POST /api/v1/mobile/auth/refresh`).
- 2026-02-03: F028 routes users back to Sign In when refresh indicates a revoked/expired session (401/403) or the access token reaches expiry.
- 2026-02-03: F029 added a shared `logout()` action that revokes the server-side mobile session (`POST /api/v1/mobile/auth/revoke`) and clears local secure storage/session state.
- 2026-02-03: F030 uses hosted web login (`/auth/signin`) for Microsoft SSO (no provider-specific native SDK).
- 2026-02-03: F031 uses hosted web login (`/auth/signin`) for Google SSO (no provider-specific native SDK).
- 2026-02-03: F032 includes device/app metadata on OTT exchange (platform, app version, build version, device id where available) for server-side audit/analytics.
- 2026-02-03: F033 added optional biometric re-open gate using `expo-local-authentication` (locks on resume; toggle stored in secure storage and exposed in Settings).
- 2026-02-03: F034 expanded log/error redaction rules to treat `ott` and `state` values as secrets so tokens are not logged or forwarded to error reporting.
