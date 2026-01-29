# Workflows EE folder structure (2026-01-29)

Rolling working memory for implementing `docs/plans/2026-01-29-workflows-ee-folder-structure/PRD.md`.

## Status (as of 2026-01-29)

This plan is **partially implemented** in the current repo state.

Use `features.json` and `tests.json` as the source of truth for what is actually implemented vs still pending.

## Current wiring (what the repo actually does today)

- Workflow UI entrypoint uses `@alga-psa/workflows/entry` which is dynamically imported by `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- `server/next.config.mjs` aliases `@alga-psa/workflows/entry` to:
  - EE: `../ee/server/src/workflows/entry(.tsx)`
  - CE: `server/src/empty/workflows/entry(.tsx)`
- `server/tsconfig.json` and `ee/server/tsconfig.json` no longer map `@alga-psa/workflows/entry` via `compilerOptions.paths` (to avoid JsConfigPathsPlugin “hybrid” resolution).
- OSS/CE stub string to guard against lives in `server/src/empty/workflows/entry.tsx`:
  - `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.`

## What still needs doing (high level)

- Remove legacy `packages/workflows/src/{ee,oss}/**` dirs (after entry migration) once safe.
- Complete tests checklist (`tests.json`) to lock in regression coverage.

## Implementation log

- 2026-01-29: Added canonical EE workflows entrypoint at `ee/server/src/workflows/entry.tsx` exporting `DnDFlow` from `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- 2026-01-29: Rewired `@alga-psa/workflows/entry` aliasing to concrete EE/CE files, added CE stub at `server/src/empty/workflows/entry.tsx`, removed TS `paths` mapping for `@alga-psa/workflows/entry`, and deleted legacy package entrypoints under `packages/workflows/src/{entry.ts,ee/entry.tsx,oss/entry.tsx}`.
- 2026-01-29: CE stub entrypoint is now `server/src/empty/workflows/entry.tsx` (export: `DnDFlow`).
- 2026-01-29: Webpack alias for `@alga-psa/workflows/entry` now targets the canonical EE/CE entry files (no package entrypoints).
- 2026-01-29: Turbopack resolveAlias for `@alga-psa/workflows/entry` now targets the canonical EE/CE entry files.
- 2026-01-29: Removed TS `paths` mapping for `@alga-psa/workflows/entry` (mitigates JsConfigPathsPlugin “hybrid build” risk).
- 2026-01-29: `server/tsconfig.json` no longer maps `@alga-psa/workflows/entry` via `compilerOptions.paths`.
- 2026-01-29: `ee/server/tsconfig.json` no longer maps `@alga-psa/workflows/entry` via `compilerOptions.paths`.
- 2026-01-29: Verified EE build works with new entry wiring: `EDITION=enterprise NEXT_PUBLIC_EDITION=enterprise npm -w server run build`.
- 2026-01-29: Added EE build guard script + CI workflow: `scripts/guard-ee-workflows-next-build.mjs` and `.github/workflows/workflows-ee-build-guard.yml`.
- 2026-01-29: Added Playwright smoke test asserting `/msp/workflows` renders the designer (not the CE stub): `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`.
- 2026-01-29: Playwright plumbing updates to make the smoke test runnable in CI/dev without local secrets:
  - `ee/server/playwright.config.ts`: force `NODE_ENV=test` and load env from `.env`/`.env.test`/`.env.example`.
  - `shared/core/getSecret.ts`: resilient `getSecret()` fallback when `@alga-psa/core/server` can't be imported (Playwright boot path).
  - `ee/server/src/__tests__/integration/helpers/playwrightAuthSessionHelper.ts`: simplified URL-scoped auth cookies (fixes `Invalid cookie fields`).
- 2026-01-29: Removed legacy workflows EE package directory `packages/workflows/src/ee/**` (EE UI is now in `ee/server/src/**`; CE stub is in `server/src/empty/**`).
- 2026-01-29: Verified EE build output guard passes (no CE stub string in `server/.next/server/**`): `node scripts/guard-ee-workflows-next-build.mjs`.
- 2026-01-29: Verified runtime smoke in EE mode via Playwright (`/msp/workflows` loads real UI and does not show CE stub): `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`.
- 2026-01-29: Verified CE build includes the workflows stub entry (and build succeeds): `node scripts/guard-ce-workflows-next-build.mjs`.
- 2026-01-29: Verified `tsc --noEmit` passes without any TS `paths` mapping for `@alga-psa/workflows/entry`: `npm -w server run typecheck` and `npm -w ee/server run typecheck`.
- 2026-01-29: Added opt-in Playwright “deployment smoke” coverage for HV dev2 (or any EE deploy) to assert workflows does **not** show the CE gating/stub message:
  - Config: `ee/server/playwright.deploy.config.ts`
  - Test: `ee/server/src/__tests__/deploy/workflows-ee-deploy-no-stub.playwright.test.ts`
  - Run (requires env): `DEPLOY_BASE_URL=... DEPLOY_EMAIL=... DEPLOY_PASSWORD=... npx playwright test -c ee/server/playwright.deploy.config.ts`
