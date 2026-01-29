# Current workflow UI entrypoint resolution (post-migration)

This documents the **current** wiring (after the folder-structure migration described in `PRD.md`).

## Current wiring

### Runtime import surface

- The UI loader dynamically imports the stable specifier:
  - `packages/workflows/src/components/WorkflowComponentLoader.ts` imports `@alga-psa/workflows/entry` and uses `mod.DnDFlow`.

### Next.js build-time aliasing

`server/next.config.mjs` defines both:

- **Turbopack** alias (`experimental.turbo.resolveAlias`):
  - `@alga-psa/workflows/entry` -> `../ee/server/src/workflows/entry` when `isEE`
  - `@alga-psa/workflows/entry` -> `./src/empty/workflows/entry` when not EE
- **Webpack** alias (`webpack.resolve.alias`):
  - `@alga-psa/workflows/entry` -> `../ee/server/src/workflows/entry.tsx` when `isEE`
  - `@alga-psa/workflows/entry` -> `server/src/empty/workflows/entry.tsx` when not EE

### TypeScript path mapping (non-authoritative, but affects Next resolution)

`server/tsconfig.json` and `ee/server/tsconfig.json` do **not** map `@alga-psa/workflows/entry`. TypeScript is satisfied via `server/src/types/external-modules.d.ts`.

### Note: duplicate EE UI code exists but is not currently authoritative

There is EE workflow UI code under `ee/server/src/components/workflow-designer/**`, and it is now the canonical runtime implementation through `ee/server/src/workflows/entry.tsx`.

## Failure mode: “hybrid” EE build

Historically, Next.js injects a **JsConfigPathsPlugin** based on `tsconfig.json` `paths`, which could win before webpack aliasing and cause EE builds to bundle CE stubs (a “hybrid build”).

Known OSS stub string (used by guard tests later):

- `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.` (currently in `server/src/empty/workflows/entry.tsx`)

## Existing mitigation (in code today)

In addition to deterministic aliasing and removing TS path mappings for `@alga-psa/workflows/entry`, CI guard scripts validate:

- EE build output does **not** contain the stub string: `scripts/guard-ee-workflows-next-build.mjs`
- CE build output **does** contain the stub string: `scripts/guard-ce-workflows-next-build.mjs`
