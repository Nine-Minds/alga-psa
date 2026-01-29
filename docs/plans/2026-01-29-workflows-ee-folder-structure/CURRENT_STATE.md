# Current workflow UI entrypoint resolution (pre-migration)

This documents the **current** wiring (before the folder-structure migration described in `PRD.md`) and the failure mode (“hybrid” EE build).

## Current wiring

### Runtime import surface

- The UI loader dynamically imports the stable specifier:
  - `packages/workflows/src/components/WorkflowComponentLoader.ts` imports `@alga-psa/workflows/entry` and uses `mod.DnDFlow`.

### Next.js build-time aliasing

`server/next.config.mjs` defines both:

- **Turbopack** alias (`experimental.turbo.resolveAlias`):
  - `@alga-psa/workflows/entry` -> `../packages/workflows/src/ee/entry` when `isEE`
  - `@alga-psa/workflows/entry` -> `../packages/workflows/src/oss/entry` when not EE
- **Webpack** alias (`webpack.resolve.alias`):
  - `@alga-psa/workflows/entry` -> `../packages/workflows/src/ee/entry.tsx` when `isEE`
  - `@alga-psa/workflows/entry` -> `../packages/workflows/src/oss/entry.tsx` when not EE

### TypeScript path mapping (non-authoritative, but affects Next resolution)

`server/tsconfig.json` includes:

- `@alga-psa/workflows/entry` -> `packages/workflows/src/entry`

And `packages/workflows/src/entry.ts` re-exports the OSS stub:

- `export * from './oss/entry';`

`ee/server/tsconfig.json` also maps:

- `@alga-psa/workflows/entry` -> `packages/workflows/src/entry`

## Failure mode: “hybrid” EE build

Next.js injects a **JsConfigPathsPlugin** based on `tsconfig.json` `paths`. In some cases, that path-based resolution can win/short-circuit before webpack aliasing, causing:

- EE images (with `EDITION=enterprise` / `NEXT_PUBLIC_EDITION=enterprise`) to ship `.next` output containing OSS stub strings from `packages/workflows/src/oss/entry.tsx`.
- The deployed EE app then renders the CE/OSS “Enterprise Feature / Please upgrade…” stub UI on workflow surfaces.

Known OSS stub string (used by guard tests later):

- `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.`

## Existing mitigation (in code today)

`server/next.config.mjs` currently includes a `webpack.NormalModuleReplacementPlugin` that rewrites imports of `@alga-psa/workflows/entry` to the EE source file before resolution in enterprise builds. This plan migrates the EE UI into `ee/server/src/**` and removes TS `paths` mappings so this class of issue cannot recur.

