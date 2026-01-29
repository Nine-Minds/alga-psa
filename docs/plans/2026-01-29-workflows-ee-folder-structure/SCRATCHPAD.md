# Workflows EE folder structure (2026-01-29)

Rolling working memory for implementing `docs/plans/2026-01-29-workflows-ee-folder-structure/PRD.md`.

## Context / problem

- Workflow UI entrypoint uses `@alga-psa/workflows/entry` which is dynamically imported by `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- The intent is “build-time selection” via `server/next.config.mjs` aliasing for EE vs CE.
- We have observed “hybrid” enterprise builds where the OSS/CE stub UI is bundled into the EE `.next` output, causing EE deployments to show “Enterprise Feature / Please upgrade…” messaging.

## Key files (current)

- `server/next.config.mjs`: webpack + turbopack aliases for `@alga-psa/workflows/entry` point to concrete entry files:
  - EE: `ee/server/src/workflows/entry.tsx`
  - CE: `server/src/empty/workflows/entry.tsx`
- `server/tsconfig.json` + `ee/server/tsconfig.json`: do **not** map `@alga-psa/workflows/entry` (avoid JsConfigPathsPlugin precedence).
- Typings: `server/src/types/external-modules.d.ts` declares `@alga-psa/workflows/entry`.
- Legacy OSS stub string to guard against: `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.` (present in `server/src/empty/workflows/entry.tsx` and used by build guards).

## Decisions / constraints (initial)

- Goal: move EE workflow UI into `ee/server/src/**` and make aliasing deterministic, without TS `paths` influencing runtime resolution.
- Keep app import surface stable: `@alga-psa/workflows/entry` remains the specifier.
- Provide typings via `.d.ts` rather than tsconfig `paths` for runtime-selected specifiers.

## Decisions (2026-01-29)

- Target EE entry file: `ee/server/src/workflows/entry.tsx`.
- Target EE component placement: use `ee/server/src/components/workflow-designer/**` (and related `workflow-graph`, `workflow-run-studio`) as the canonical EE UI home.
  - If there are duplicated workflow UI components elsewhere, migrate to the above directories and deprecate old locations.
- Target CE entry file: `server/src/empty/workflows/entry.tsx`.

## Implementation notes

- Added EE workflows entry at `ee/server/src/workflows/entry.tsx` exporting `DnDFlow` from `ee/server/src/components/workflow-designer/WorkflowDesigner`.
- Synced EE workflow designer + graph components from `packages/workflows/src/ee/components/**` into `ee/server/src/components/{workflow-designer,workflow-graph}/**` so the EE UI no longer depends on package-local `src/ee/**` copies.
  - `npm -w ee/server run typecheck` passes after the sync.
- Added CE workflows stub entry at `server/src/empty/workflows/entry.tsx` exporting `DnDFlow` with the legacy OSS stub string (used for build guards).
- Updated `packages/workflows/src/components/WorkflowComponentLoader.ts` fallback to load `@/empty/workflows/entry` so CE behavior is a visible stub (not a silent `null`) if the primary entry import fails.
- Updated webpack alias for `@alga-psa/workflows/entry` in `server/next.config.mjs` to point to concrete files:
  - EE: `ee/server/src/workflows/entry.tsx`
  - CE: `server/src/empty/workflows/entry.tsx`
- Updated turbopack alias for `@alga-psa/workflows/entry` in `server/next.config.mjs` to point to:
  - EE: `../ee/server/src/workflows/entry`
  - CE: `./src/empty/workflows/entry`
- Updated the EE `NormalModuleReplacementPlugin` guard in `server/next.config.mjs` to rewrite `@alga-psa/workflows/entry` to `ee/server/src/workflows/entry.tsx` (pre-resolution) to prevent tsconfig-paths “hybrid” builds.
- Removed `@alga-psa/workflows/entry` from `server/tsconfig.json` `paths` to prevent TS/JsConfig path resolution from influencing Next bundling.
  - `npm -w server run typecheck` passes relying on `server/src/types/external-modules.d.ts` for module typing.
- Removed `@alga-psa/workflows/entry` from `ee/server/tsconfig.json` `paths` for the same reason.
  - `npm -w ee/server run typecheck` passes.
- Expanded `server/src/types/external-modules.d.ts` typing for `@alga-psa/workflows/entry` (named `DnDFlow` + default export) so TS remains happy without a `paths` mapping.
- Confirmed workflow UI loader continues to import `@alga-psa/workflows/entry` (no legacy paths), with a CE stub fallback to `@/empty/workflows/entry`.
- Set `experimental.externalDir: true` in `server/next.config.mjs` to ensure the server app can compile aliased EE sources under `../ee/server/src/**` (including the new workflows entry).
- Added CI guard to prevent “hybrid” EE builds:
  - Script: `scripts/guard-ee-workflows-next-build.mjs` (scans `server/.next/server` for the legacy OSS stub string).
  - Workflow: `.github/workflows/workflows-ee-build-guard.yml` (runs an EE `next build` and then the guard script).
- Added Playwright smoke coverage for EE workflows entry selection: `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`.
- Added migration notes doc: `docs/plans/2026-01-29-workflows-ee-folder-structure/POST_MIGRATION_NOTES.md`.
- Removed legacy workflow entry shims: deleted `packages/workflows/src/{ee,oss}/**` and `packages/workflows/src/entry.ts`.

## Commands / runbooks

- Search for entry usage: `rg -n "@alga-psa/workflows/entry" -S .`
- Verify build artifact doesn’t contain OSS stub string (EE build): `rg -n "Workflow designer requires Enterprise Edition" .next/server -S`

## Test checklist

- T001: Covered by `scripts/guard-ee-workflows-next-build.mjs` + `.github/workflows/workflows-ee-build-guard.yml`.
- T002: Covered by `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts` (asserts CE stub text is absent on `/msp/workflows`).
