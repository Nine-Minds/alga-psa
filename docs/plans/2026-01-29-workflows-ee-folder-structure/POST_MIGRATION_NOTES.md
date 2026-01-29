# Workflow UI EE selection (post-migration notes)

## What changed

The Workflow UI no longer relies on a `tsconfig.json` `paths` mapping for `@alga-psa/workflows/entry` (which could be picked up by Next’s JsConfigPathsPlugin and produce “hybrid” builds).

Instead, **Next config aliasing is authoritative** and points directly at concrete files:

- EE: `ee/server/src/workflows/entry.tsx`
- CE: `server/src/empty/workflows/entry.tsx`

## Where the entry is selected

- `server/next.config.mjs`
  - Webpack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - Turbopack alias: `@alga-psa/workflows/entry` -> EE/CE concrete entry files
  - EE guard: a `NormalModuleReplacementPlugin` rewrites `@alga-psa/workflows/entry` to the canonical EE entry before resolution to avoid any tsconfig path precedence issues.

## TypeScript resolution

- `server/tsconfig.json` and `ee/server/tsconfig.json` no longer map `@alga-psa/workflows/entry`.
- Typings are provided via `server/src/types/external-modules.d.ts` (`DnDFlow` + default export).

## Runtime import surface (unchanged)

- App code still imports `@alga-psa/workflows/entry` via `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- The loader falls back to `@/empty/workflows/entry` if the primary dynamic import fails.

## Regression protection

- Build guard: `scripts/guard-ee-workflows-next-build.mjs` + `.github/workflows/workflows-ee-build-guard.yml`
- UI smoke: `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`

