# Workflow UI EE selection (post-migration notes)

Status: implemented in the current repo state.

## What changed

The Workflow UI no longer relies on a `tsconfig.json` `paths` mapping for `@alga-psa/workflows/entry` (which can be picked up by Next’s JsConfigPathsPlugin and produce “hybrid” builds).

Instead, **Next config aliasing is authoritative** and points directly at concrete files:

- EE: `ee/server/src/workflows/entry.tsx`
- CE: `server/src/empty/workflows/entry.tsx`

## Where the entry is selected

- `server/next.config.mjs`
  - Webpack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - Turbopack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - EE guard: keep `tsconfig` paths from influencing runtime-selected entrypoints (and remove legacy shims).

## TypeScript resolution

- `server/tsconfig.json` and `ee/server/tsconfig.json` do not map `@alga-psa/workflows/entry`.
- Typings are provided via `server/src/types/external-modules.d.ts` (`DnDFlow`).

## Runtime import surface (unchanged)

- App code still imports `@alga-psa/workflows/entry` via `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- The loader falls back to `@/empty/components/flow/DnDFlow` if the primary dynamic import fails.

## Regression protection

- Build guards:
  - `scripts/guard-workflows-entry-edition-selection.mjs` (asserts deterministic alias selection)
  - `scripts/guard-ee-workflows-next-build.mjs` (EE `next build` must not contain the CE stub string)
  - `scripts/guard-ce-workflows-next-build.mjs` (CE `next build` must contain the CE stub string)
  - `.github/workflows/workflows-ee-build-guard.yml`
- UI smoke:
  - `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`
