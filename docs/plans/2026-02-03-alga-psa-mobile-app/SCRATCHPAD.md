# Scratchpad — Alga PSA Mobile App (2026-02-03)

Rolling notes for implementing `docs/plans/2026-02-03-alga-psa-mobile-app`.

## Log
- 2026-02-03: Initialized scratchpad.
- 2026-02-03: F001 scaffolded Expo (managed) app in `mobile/` with `mobile/README.md` runbook. Kept it outside npm workspaces to avoid dependency/React version coupling with the existing web app.
- 2026-02-03: F002 added hosted env config plumbing via `mobile/.env.example` + `mobile/src/config/appConfig.ts` (expects `EXPO_PUBLIC_ALGA_ENV` and `EXPO_PUBLIC_ALGA_BASE_URL`).
- 2026-02-03: F003 added a minimal typed REST client wrapper in `mobile/src/api/*` returning structured `ApiResult<T>` with consistent error kinds (network/timeout/http/parse).
- 2026-02-03: F004 extended the client to stamp `Authorization: Bearer`, `x-tenant-id`, and `x-alga-client` headers via injectable getters.
