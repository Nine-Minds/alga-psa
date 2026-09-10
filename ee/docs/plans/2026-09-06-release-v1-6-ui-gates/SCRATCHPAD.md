# Scratchpad

User authorization: UI-only gating; no API/runtime restrictions requested. Prior review in /private/tmp/alga-release-v1-6-review.md. Starting tree clean at 3045e04100, same content as origin/main a81661446e.

## Implementation and verification
- UI gates cover the six agreed groups. Existing unit/period-total configurations and by-ticket selections/defaults/custom layouts remain available.
- Store-only editor data uses release-v1-6-feature; mutation actions no longer pass flag restrictions to the domain layer. Optional domain policy parameters remain compatible.
- No billing arithmetic, attachment lifecycle, route, migration or API footprint changes.
- New behavioral checks cover flag-off configuration choices, existing configuration preservation, layout selection/rendering, saved collection bindings, billed-time presets, eligible month-end close, and Teams creation versus existing Join. Existing UI suites explicitly opt into enabled release flags.
- Billing form suites: 5 files, 28 tests pass. Server-focused suites cover usage overview, month-end, store-only editor filtering, designer presets and saved rebinding. Adjacent designer/preview/schedule suites pass after updating their feature-flag fixtures. No database or live browser suite run for this UI-only change.
- Validation used a local ignored node_modules overlay from the existing checkout, with the two missing lockfile dependencies installed temporarily; package manifests/lockfile were unchanged.

Final checks: `tsc --noEmit` passes for packages/billing, packages/scheduling, packages/clients and server; `git diff --check` passes. Logs in /private/tmp/release-*-tsc.log and /private/tmp/release-*-tests.log. Changes remain uncommitted for review.
