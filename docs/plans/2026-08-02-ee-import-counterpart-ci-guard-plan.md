# CI guard for `@ee/*` imports without CE counterparts

Date: 2026-08-02  
Card: alga0002210

## Problem

CE-shipped source can import `@ee/<subpath>` while the CE alias maps that specifier to `packages/ee/src/<subpath>`. Missing counterpart modules are found late by CE builds; the existing relocation audit does not enumerate all live CE imports.

## Design

1. Add `scripts/check-ee-import-counterparts.mjs`, resolving the repository root from the script location and walking production source in `server/`, `shared/`, and `packages/` while excluding `packages/ee`, dependencies, generated output, declarations, fixtures, and test-shaped paths.
2. Use the TypeScript parser to collect static imports, re-exports, side-effect imports, and literal dynamic imports. Reject malformed or traversal-like subpaths.
3. Resolve each specifier under `packages/ee/src` using supported exact-file and directory-index forms. Aggregate stable diagnostics containing importing file, line, specifier, and expected counterpart.
4. Export pure discovery/resolution helpers for behavioral tests and add root command `guard:ee-import-counterparts`.
5. Add a dedicated unconditional pull-request workflow rather than relying only on Nx affected selection. Retain the existing relocation audit and CE build.

## Behavioral tests

- Exact-file and directory-index counterparts pass.
- Missing static, re-export, side-effect, and literal dynamic imports fail with source locations.
- Comments, strings, non-literal dynamic imports, test paths, and EE-only source are excluded.
- Traversal-like subpaths cannot escape the counterpart root.
- CLI fixtures return zero for a complete tree and nonzero with all misses reported.

## Acceptance criteria

- Every PR runs the repository-wide guard.
- All supported production `@ee/*` imports require a resolvable CE counterpart.
- Diagnostics are complete and deterministic.
- The real checkout passes without a permanent allowlist.

## Evidence inspected

- Existing relocation audit, TypeScript/Vitest/Next aliases, unit/typecheck workflows, package scripts, current `@ee/*` usages, `packages/ee/src`, and the relocation scratchpad.

## Risks

- Scanner scope or resolver behavior can drift from packaging; centralize both as reviewed constants with fixture coverage.
- Presence does not prove runtime behavior; retain CE builds and feature tests.
