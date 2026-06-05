# PRD — Maximize nx modularity to cut the turbopack build-memory compile floor

- Slug: `nx-modularity-build-memory`
- Date: `2026-06-04`
- Status: Draft (spike-gated)
- Follow-up to PR #2629 (build-mem R1+R2, −23%)

## Summary

`next build --turbo` recompiles ~20 workspace packages (`@alga-psa/*`) **from `src/`**
on every build, because `server/next.config.mjs` `turbopack.resolveAlias` points each
package's bare and sub-path specifiers at `../packages/<pkg>/src`. After capping the
static-gen worker pool (R2), this turbopack source-compilation is the single ~9 GB peak.
nx already models these packages as independently-buildable projects. This work makes
turbopack consume each package's **prebuilt `dist`** instead of recompiling its source,
to lower the compile-memory floor — validated against the `scripts/build-mem.sh` harness
and against a live app via browser smoke testing.

## Problem

- Build peak is ~10.9 GB; the dominant component is one `next build` process at ~9 GB of
  turbopack native compile memory. That is what causes CI OOMs and forces large runners.
- The src-aliasing means every consumer of `@alga-psa/ui` (3488 deep imports), `@alga-psa/auth`,
  etc. pulls TS/TSX that turbopack must parse + transform, multiplying the module graph.

## Goals

1. Reduce `npm run build` peak (cgroup `memory.peak`, cold, median of >=3) by a margin that
   **clearly beats the ~1 GB run-to-run variance** vs the PR #2629 baseline (10937 MB).
2. Do NOT regress total build wall-clock beyond normal variance (~+/-3-6 s); added nx
   `build-deps` time must be more than offset by reduced turbopack compile time.
3. Keep the app **runtime-correct**: every `@alga-psa/*` import resolves and the smoke flows
   pass in a live environment.

## Non-goals

- nx module federation / splitting the Next app into remotes (too large; separate effort).
- Rewriting the 3488+ app import sites. We make `dist` expose the sub-paths; imports stay.
- Touching non-package aliases (`@` -> `./src`, `server/src`, EE conditional aliases, the
  emoji-mart data alias). Only the `@alga-psa/*` -> `src` resolveAlias entries change.
- New tooling/observability beyond the existing build-mem harness.

## Users and Primary Flows

Primary "user" = the build pipeline (local + CI). Secondary = app users, whose flows must
still work after dist-consumption. Smoke flows (highest `@alga-psa/ui` traffic):
login → MSP dashboard → tickets list → ticket detail (rich-text editor) → clients →
a settings page.

## Requirements

### Functional

- FR1 (spike): Build the 1-2 highest-footprint packages to a `dist` that resolves the deep
  sub-path imports they receive; alias only those to dist; measure compile-peak delta.
- FR2: Gate — proceed to full rollout ONLY if the spike shows a >noise peak reduction with
  no build-time regression and a green build. Otherwise stop and document.
- FR3: For each in-scope package: fix its build (e.g. `@alga-psa/ui` font-asset resolution),
  configure tsup to emit per-subpath dist entries matching consumer import depth, and make
  `package.json` `exports` cover every used sub-path segment.
- FR4: Ensure `nx build-deps server` builds all in-scope packages' dist (so dist is fresh and
  ordered before `next build`).
- FR5: Remove the corresponding `@alga-psa/*` -> `src` entries from `turbopack.resolveAlias`
  so turbopack resolves via `exports` -> dist.
- FR6: `npm run build` passes (`exit 0` + `.next/BUILD_ID` + route manifests) with dist consumption.

### Non-functional

- NFR1: Peak reduction beats ~1 GB noise (median of >=3 harness runs).
- NFR2: Total build wall-clock within variance of the 58 s baseline.
- NFR3: No TypeScript/type-resolution regressions (`exports` `types` still -> src).

## Rollout / Migration

- Branch `improve/build-memory-consumption` (same as PR #2629) or a stacked branch.
- Incremental: spike packages first (own commit), then batch remaining by footprint.
- Reversible: re-adding a resolveAlias entry restores src compilation for any package.

## Open Questions

- OQ1: tsup glob entries (`src/**/*.{ts,tsx}`) vs explicit — which yields resolvable
  per-file dist without exploding nx build time? (answer in spike)
- OQ2: Do any packages have runtime-only side effects that change when bundled vs src? (smoke catches)
- OQ3: Is the per-subpath dist's own bundling enough smaller than src to net-reduce turbopack memory? (spike measures)

## Acceptance Criteria (Definition of Done)

- AC1: `scripts/build-mem.sh` median peak (>=3 runs) is below ~9900 MB (>1 GB under 10937),
  OR the spike is documented as sub-noise and the effort stopped with findings recorded.
- AC2: `npm run build` total time within variance of 58 s.
- AC3: Build green; all `@alga-psa/*` imports resolve from dist.
- AC4: Live smoke flows pass in a browser pane (login, dashboard, tickets list+detail editor,
  clients, settings) with no console import/resolution errors.
- AC5: PRD/features/tests/scratchpad updated; result (win or documented stop) committed.
