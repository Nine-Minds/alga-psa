# Workflows EE folder structure (2026-01-29)

Rolling working memory for implementing `docs/plans/2026-01-29-workflows-ee-folder-structure/PRD.md`.

## Status (as of 2026-01-29)

This plan is **not fully implemented** in the current repo state. Several notes below were previously written as-if completed, but the referenced files/scripts do not exist and the build wiring still points at `packages/workflows/src/**`.

Use `features.json` and `tests.json` as the source of truth for what is actually implemented vs still pending.

## Current wiring (what the repo actually does today)

- Workflow UI entrypoint uses `@alga-psa/workflows/entry` which is dynamically imported by `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- `server/next.config.mjs` aliases `@alga-psa/workflows/entry` to:
  - EE: `../packages/workflows/src/ee/entry(.tsx)`
  - CE: `../packages/workflows/src/oss/entry(.tsx)`
- `server/tsconfig.json` and `ee/server/tsconfig.json` both map `@alga-psa/workflows/entry` -> `packages/workflows/src/entry` (which re-exports the OSS stub), which is the root cause class for “hybrid” builds.
- OSS stub string to guard against lives in `packages/workflows/src/oss/entry.tsx`:
  - `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.`

## What still needs doing (high level)

- Create a canonical CE stub entry under `server/src/empty/**` (e.g. `server/src/empty/workflows/entry.tsx`) exporting the stub UI.
- Update Next webpack + turbopack aliasing to point `@alga-psa/workflows/entry` at those concrete files.
- Remove TS `paths` mapping for `@alga-psa/workflows/entry` from both `server/tsconfig.json` and `ee/server/tsconfig.json`.
- Add a CI guard (EE build) that fails if `.next/server/**` contains the OSS stub string.

## Implementation log

- 2026-01-29: Added canonical EE workflows entrypoint at `ee/server/src/workflows/entry.tsx` exporting `DnDFlow` from `ee/server/src/components/workflow-designer/WorkflowDesigner.tsx`.
