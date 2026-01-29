# Workflows EE folder structure (2026-01-29)

Rolling working memory for implementing `docs/plans/2026-01-29-workflows-ee-folder-structure/PRD.md`.

## Context / problem

- Workflow UI entrypoint uses `@alga-psa/workflows/entry` which is dynamically imported by `packages/workflows/src/components/WorkflowComponentLoader.ts`.
- The intent is “build-time selection” via `server/next.config.mjs` aliasing for EE vs CE.
- We have observed “hybrid” enterprise builds where the OSS/CE stub UI is bundled into the EE `.next` output, causing EE deployments to show “Enterprise Feature / Please upgrade…” messaging.

## Key files (current)

- `server/next.config.mjs`: webpack + turbopack aliases for `@alga-psa/workflows/entry` currently point into `packages/workflows/src/{ee,oss}/entry(.tsx)`.
- `server/tsconfig.json`: `paths` includes `@alga-psa/workflows/entry` -> `packages/workflows/src/entry` (re-exports OSS stub), which can be resolved by Next’s JsConfigPathsPlugin before webpack aliasing.
- `ee/server/tsconfig.json`: also maps `@alga-psa/workflows/entry` -> `packages/workflows/src/entry`.
- `packages/workflows/src/entry.ts`: `export * from './oss/entry'`.
- OSS stub string to guard against: `Workflow designer requires Enterprise Edition. Please upgrade to access this feature.` in `packages/workflows/src/oss/entry.tsx`.

## Decisions / constraints (initial)

- Goal: move EE workflow UI into `ee/server/src/**` and make aliasing deterministic, without TS `paths` influencing runtime resolution.
- Keep app import surface stable: `@alga-psa/workflows/entry` remains the specifier.
- Provide typings via `.d.ts` rather than tsconfig `paths` for runtime-selected specifiers.

## Commands / runbooks

- Search for entry usage: `rg -n "@alga-psa/workflows/entry" -S .`
- Verify build artifact doesn’t contain OSS stub string (EE build): `rg -n "Workflow designer requires Enterprise Edition" .next/server -S`

