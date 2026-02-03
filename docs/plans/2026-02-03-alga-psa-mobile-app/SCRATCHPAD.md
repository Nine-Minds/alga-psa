# Scratchpad — Alga PSA Mobile App (2026-02-03)

Rolling notes for implementing `docs/plans/2026-02-03-alga-psa-mobile-app`.

## Log
- 2026-02-03: Initialized scratchpad.
- 2026-02-03: F001 scaffolded Expo (managed) app in `mobile/` with `mobile/README.md` runbook. Kept it outside npm workspaces to avoid dependency/React version coupling with the existing web app.
- 2026-02-03: F002 added hosted env config plumbing via `mobile/.env.example` + `mobile/src/config/appConfig.ts` (expects `EXPO_PUBLIC_ALGA_ENV` and `EXPO_PUBLIC_ALGA_BASE_URL`).
