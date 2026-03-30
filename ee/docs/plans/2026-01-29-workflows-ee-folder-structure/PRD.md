# PRD: Move Workflow EE UI into `ee/server` Folder Structure

## Problem Statement

The Workflow UI currently uses “feature package” entrypoints under `packages/workflows/src/{oss,ee}` and relies on build-time aliasing of `@alga-psa/workflows/entry` to select the correct implementation.

In practice, **Enterprise builds can still ship the OSS/CE stub UI** (“Enterprise Feature / Please upgrade…”) even when:
- The app is deployed with EE images, and
- Runtime env vars indicate Enterprise (`EDITION=enterprise`, `NEXT_PUBLIC_EDITION=enterprise`).

We observed this in the **HV dev2** environment: the deployed `.next` output contained the OSS/CE stub strings (historically under `packages/workflows/src/oss/entry.tsx`), indicating a “hybrid” build.

Root cause class: **TS path-based resolution (Next’s JsConfigPathsPlugin) can override/short-circuit webpack aliasing**, meaning the EE/OSS selection is not consistently enforced at build time.

This is confusing operationally and erodes trust: users see EE-only gating dialogs even in Enterprise deployments.

## Status (as of 2026-01-29)

This plan is **implemented** in the current repo state.

### Implemented (in repo today)

- The authoritative EE entry is `ee/server/src/workflows/entry.tsx` and exports `DnDFlow`.
- The authoritative CE stub entry is `server/src/empty/workflows/entry.tsx` and exports `DnDFlow` with the legacy stub text.
- `server/next.config.mjs` aliases `@alga-psa/workflows/entry` deterministically for both webpack + turbopack.
- `server/tsconfig.json` and `ee/server/tsconfig.json` no longer map `@alga-psa/workflows/entry`.
- Typings for `@alga-psa/workflows/entry` are provided via `server/src/types/external-modules.d.ts`.
- CI/build guards exist to prevent hybrid EE builds and to validate CE builds:
  - `scripts/guard-workflows-entry-edition-selection.mjs`
  - `scripts/guard-ee-workflows-next-build.mjs`
  - `scripts/guard-ce-workflows-next-build.mjs`
  - `.github/workflows/workflows-ee-build-guard.yml`
- A UI smoke test exists: `ee/server/src/__tests__/integration/workflows-ee-entry-smoke.playwright.test.ts`.

### Not yet implemented (still outstanding)

None. Remaining work is optional cleanup (e.g. removing any empty legacy directories under `packages/workflows/src/ee/**` if desired).

## User Value

- Enterprise deployments reliably load the real Workflow UI (designer, toggles, run studio).
- CE deployments reliably load stubs (or hide the feature), without “hybrid” behavior.
- A clearer code layout: EE-only UI lives in `ee/server/src/**`, aligning with other EE feature wiring.
- Fewer build-time footguns: no reliance on TS “paths” for runtime selection.

## Goals

1. **Relocate** the Workflow UI EE implementation from `packages/workflows/src/ee/**` into the EE tree under `ee/server/src/**`.
2. Ensure `@alga-psa/workflows/entry` resolves **deterministically** to:
   - `ee/server/src/**` in EE builds
   - `server/src/empty/**` (or other CE stub) in CE builds
3. Remove or neutralize TS path mappings that can cause the OSS stub to be bundled in EE.
4. Keep the import surface stable for app code (`@alga-psa/workflows/entry`, `@alga-psa/workflows/components/*`) to avoid widespread refactors.
5. Add regression tests that detect “OSS stub shipped in EE build”.

## Non-Goals

- Rewriting the workflow engine/runtime or Temporal workflows.
- Changing licensing/entitlement policy (still EE-only where intended).
- Migrating all workflow-related *shared* code into `ee/` (schemas/types/shared runtime can remain in `packages/workflows`).
- UI redesign.

## Background / Current Architecture

### Current entrypoint selection

- `packages/workflows/src/components/WorkflowComponentLoader.ts` dynamically imports `@alga-psa/workflows/entry`.
- `server/next.config.mjs` attempts to alias `@alga-psa/workflows/entry` to:
  - EE: `packages/workflows/src/ee/entry.tsx`
  - OSS/CE: `packages/workflows/src/oss/entry.tsx`
- `server/tsconfig.json` currently maps `@alga-psa/workflows/entry` to `packages/workflows/src/entry` (which re-exports the OSS stub).

### Why this breaks

Next’s TS/JS config path resolver can resolve `@alga-psa/workflows/entry` via tsconfig `paths` before webpack aliasing, causing the OSS stub to end up in the EE bundle (hybrid build).

## Proposed Architecture

### Code placement

- EE Workflow UI lives under `ee/server/src/**` (new home), e.g.:
  - `ee/server/src/workflows/entry.tsx` (or `ee/server/src/components/workflows/entry.tsx`)
  - `ee/server/src/workflows/**` for designer subcomponents
- CE/OSS stub lives under `server/src/empty/**`, e.g.:
  - `server/src/empty/workflows/entry.tsx`
  - (or reuse existing `server/src/empty/components/flow/DnDFlow.tsx` with a thin entry wrapper)

### Build-time wiring (authoritative)

- In `server/next.config.mjs`, alias `@alga-psa/workflows/entry` directly to these **concrete files**.
- Ensure both webpack and turbopack aliasing cover it.

### TypeScript wiring (non-authoritative)

- Remove tsconfig `paths` mapping for `@alga-psa/workflows/entry` (and any similar “runtime-selected” specifiers).
- Provide typings via:
  - `server/src/types/external-modules.d.ts` (or a dedicated `workflows-entry.d.ts`) declaring `DnDFlow` and related exports.

This makes TS happy without allowing TS paths to affect runtime bundling.

## Migration / Rollout Plan

1. **Introduce new EE entry file** in `ee/server/src/**` that exports the expected `DnDFlow` named export.
2. **Introduce new CE stub entry file** in `server/src/empty/**` matching the export shape.
3. Update `server/next.config.mjs` to point `@alga-psa/workflows/entry` at the new locations for both webpack + turbopack.
4. Remove tsconfig `paths` entry for `@alga-psa/workflows/entry` (and update any dependent tsconfigs, e.g. `ee/server/tsconfig.json`).
5. **Remove legacy `packages/workflows/src/{ee,oss}` entrypoints** rather than keeping re-export shims, to prevent any accidental “hybrid” resolution paths in future builds.
6. Add a CI guard for EE builds:
   - After `next build` with EE env, grep `.next/server` for known OSS stub strings and fail if present.
7. Deploy to HV dev2 and validate:
   - Workflows page loads real designer UI
    - No EE-only gating dialog appears in EE deployments

## Risks

- Moving UI code may introduce import boundary violations (feature-to-feature lint rules).
- `ee/server/src` code may depend on packages not present in some build contexts; require careful aliasing and `transpilePackages`.
- Turbopack vs webpack differences: ensure both codepaths are wired identically.
- Any other “runtime-selected” entrypoints could have similar TS-path precedence issues; scope creep risk.

## Open Questions (needs user confirmation)

Resolved (2026-01-29):

1. **All workflow UI** will be moved into `ee/server/src/**` (designer, run studio, and related workflow surfaces).
2. CE behavior will be a **stub message** indicating the feature requires Enterprise.
3. Scope is **workflows-only** (do not expand to other runtime-selected entrypoints).

## Acceptance Criteria / Definition of Done

- In an EE `next build` output, `.next/server/**` does **not** contain strings from the OSS workflow stub entry.
- In HV dev2 (or equivalent), the deployed EE image loads the real workflow designer UI.
- CE builds still compile and behave as expected (stub/hide), with no EE-only code shipped unintentionally.
- Added CI regression check(s) prevent hybrid workflow builds going forward.
