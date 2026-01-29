# Workflows EE folder structure (2026-01-29)

Rolling working memory for implementing `docs/plans/2026-01-29-workflows-ee-folder-structure/PRD.md`.

## Status (as of 2026-01-29)

This plan is **not fully implemented** in the current repo state. Several notes below were previously written as-if completed, but the referenced files/scripts do not exist and the build wiring still points at `packages/workflows/src/**`.

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

- Add a CI guard (EE build) that fails if `.next/server/**` contains the OSS stub string.

## Implementation log

- 2026-01-29: Added canonical EE workflows entrypoint at `ee/server/src/workflows/entry.tsx` exporting `DnDFlow` from `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
- 2026-01-29: Rewired `@alga-psa/workflows/entry` aliasing to concrete EE/CE files, added CE stub at `server/src/empty/workflows/entry.tsx`, removed TS `paths` mapping for `@alga-psa/workflows/entry`, and deleted legacy package entrypoints under `packages/workflows/src/{entry.ts,ee/entry.tsx,oss/entry.tsx}`.
- 2026-01-29: CE stub entrypoint is now `server/src/empty/workflows/entry.tsx` (export: `DnDFlow`).
