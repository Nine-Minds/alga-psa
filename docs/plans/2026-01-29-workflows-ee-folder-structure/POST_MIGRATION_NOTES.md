# Workflow UI EE selection (planned post-migration notes)

Status: **Not implemented yet** in the current repo state. This document describes the intended end state once the migration in `PRD.md` is completed.

## What changed

After migration, the Workflow UI should no longer rely on a `tsconfig.json` `paths` mapping for `@alga-psa/workflows/entry` (which can be picked up by Next’s JsConfigPathsPlugin and produce “hybrid” builds).

Instead, **Next config aliasing should be authoritative** and point directly at concrete files:

- EE: `ee/server/src/workflows/entry.tsx`
- CE: `server/src/empty/workflows/entry.tsx`

## Where the entry is selected

- `server/next.config.mjs`
  - Webpack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - Turbopack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - Optional EE guard: add a pre-resolution rewrite to ensure tsconfig path precedence cannot force the OSS stub into EE builds.

## TypeScript resolution

- `server/tsconfig.json` and `ee/server/tsconfig.json` should no longer map `@alga-psa/workflows/entry`.
- Typings are provided via `server/src/types/external-modules.d.ts` (`DnDFlow` + default export).

## Runtime import surface (unchanged)

- App code still imports `@alga-psa/workflows/entry` via `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- The loader may optionally fall back to a CE stub entry under `server/src/empty/**` if the primary dynamic import fails.

## Regression protection

Planned (not implemented yet):

- Build guard: add a script + CI workflow that runs an EE `next build` and scans `.next/server/**` for the known OSS stub string.
- UI smoke: add an automated test that visits `/msp/workflows` in EE mode and asserts the OSS stub UI is not rendered.
