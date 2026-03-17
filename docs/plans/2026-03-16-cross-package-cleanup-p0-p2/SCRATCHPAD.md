# Scratchpad: Cross-Package Cleanup P0-P2

## Key Commands Reference

### Build & TypeScript
```bash
# Full build (the definitive check)
npm run build

# TypeScript check on specific package (faster than full build)
cd packages/<pkg> && npx tsc --noEmit
cd server && npx tsc --noEmit
cd ee/server && npx tsc --noEmit
cd ee/packages/workflows && npx tsc --noEmit
```

### Cross-Package Violations (Lint)
```bash
# Authoritative violation count (use this, NOT nx run-many which undercounts ~50%)
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | wc -l

# Per-source package breakdown
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*Feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# Per-target package breakdown
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | sed 's/.*feature package "\([^"]*\)".*/\1/' | sort | uniq -c | sort -rn

# Violations for a specific source package
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | grep 'Feature package "client-portal"'

# Violations for a specific target
npm run lint 2>&1 | grep "no-feature-to-feature-imports" | grep 'feature package "documents"'
```

### Circular Dependencies
```bash
# Generate Nx graph and check for new cycles
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --baseline .github/known-cycles.json

# Update baseline after fixing cycles (include tightened baseline in commit)
npx nx graph --file=/tmp/graph.json && node scripts/check-circular-deps.mjs /tmp/graph.json --update-baseline .github/known-cycles.json

# NOTE: As of 2026-03-16, nx graph may fail with "brace_expansion_1.default is not a function"
# Workaround: clear nx cache: npx nx reset && npx nx graph --file=/tmp/graph.json
```

### Grep Patterns for Finding Violations
```bash
# Find all imports of a package from outside it
grep -r "@alga-psa/documents" --include="*.ts" --include="*.tsx" packages/ | grep -v "packages/documents/" | grep -v node_modules

# Find imports of auth-compat
grep -r "auth-compat" --include="*.ts" --include="*.tsx" -l | grep -v node_modules

# Find type-only cross-vertical imports
grep -rn "import type.*@alga-psa/" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules

# Check what shared/ imports from workflows
grep -r "@alga-psa/workflows" shared/ --include="*.ts" --include="*.tsx" -l | grep -v node_modules
```

### Testing
```bash
# Run tests locally (requires .env.localtest)
npm run test:local

# Run affected tests only
npx vitest run --changed

# Run specific test file
cd server && npx vitest run path/to/test.test.ts
```

## Decisions

- **2026-03-16:** P0-1 test files moved to `ee/packages/workflows/` (not `packages/workflows/`) because the tests reference EE-specific domain event builders
- **2026-03-16:** `nx graph` has brace_expansion bug — may need `npx nx reset` or skip circular dep checking for some commits
- **2026-03-16:** `@alga-psa/shared` added as devDependency to `ee/packages/workflows/package.json` for moved test imports
- **2026-03-16:** Removed 18 baseline cycles that all contained the resolved `@alga-psa/shared -> @alga-psa/workflows` edge; used manual baseline pruning because local Nx graph generation is still broken by the `brace_expansion_1.default` runtime error

## Current State (2026-03-16)

- **Branch:** cleanup/circular_deps (rebased on origin/main)
- **Uncommitted:** P0-1 test file moves (10 files moved, ee/packages/workflows/package.json modified)
- **Known cycles baseline:** 12 cycles after removing the 18 entries that depended on the resolved shared->workflows edge
- **auth-compat callers:** 2 EE files (ee/server/src/app/api/extensions/_auth.ts, ee/server/src/app/api/provisioning/tenants/route.ts)
- **msp-composition missing re-exports:** assets/, billing/, clients/

## 2026-03-16 Progress Log

- Verified `shared/` only references `@alga-psa/workflows` in a comment within `shared/types/product-email-domains.d.ts`.
- Verified moved workflow tests compile with `cd ee/packages/workflows && npx tsc --noEmit`; `cd shared && npx tsc --noEmit` also passes.
- `npx nx graph --file=/tmp/graph.json` still fails locally with `brace_expansion_1.default is not a function`, including under Node 20, so cycle-baseline verification currently relies on the removed import edge plus baseline pruning.
- `npm run build` passed from repo root after the workflow test moves and cycle-baseline update; build emitted existing Next.js webpack warnings only.
- Pending workflow-test file moves and the related `ee/packages/workflows/package.json` devDependency update are ready to commit as the final P0-1 code delta.
- Authoritative `npm run lint` baseline is `103` `no-feature-to-feature-imports` violations when run directly from repo root.

### P0-2 Violation Breakdown (from `/tmp/p0-lint.log`)

```text
By source package
38 client-portal
14 workflows
13 tickets
12 clients
10 projects
 9 billing
 3 assets
 2 users
 2 integrations

By target package
39 documents
13 tickets
 9 billing
 8 sla
 7 clients
 6 scheduling
 6 projects
 6 integrations
 5 workflows
 4 users
```

- Migrated `ee/server/src/app/api/extensions/_auth.ts` to call `getSession()` directly from `@alga-psa/auth`, removing its dependency on `@/lib/auth-compat`.
- Migrated `ee/server/src/app/api/provisioning/tenants/route.ts` to call `getSession()` directly from `@alga-psa/auth`, leaving `server/src/lib/auth-compat.ts` with no remaining callers.
- Deleted `server/src/lib/auth-compat.ts`; the compatibility wrapper is fully retired in favor of `getSession()` from `@alga-psa/auth`.
- `npm run build` still passes after deleting `server/src/lib/auth-compat.ts`; only pre-existing webpack warnings were emitted.
- Auth-compat retirement is now represented by the committed `F008`-`F011` change series, so the P1-3 code path is fully checked in.
- Added `export * from './assets'` to `packages/msp-composition/src/index.ts` to expose the existing assets composition barrel from the package root.
- Added `export * from './billing'` to `packages/msp-composition/src/index.ts` so billing composition helpers are reachable from the main barrel.
- Added `export * from './clients'` to `packages/msp-composition/src/index.ts`; the root barrel now exposes assets, billing, clients, tickets, projects, and scheduling.
- `npm run build` passes with the expanded `@alga-psa/msp-composition` barrel; no new build regressions surfaced.
- The `msp-composition` export wiring is now fully committed via the `F013`-`F016` change series.
- P2-5a inventory: `packages/projects/src/actions/projectActions.ts` is the active `projects -> clients` direct import (`getContactByContactNameId`); `packages/scheduling/src` currently has no direct `@alga-psa/clients` imports.
- Verified `packages/clients/src/context/ClientCrossFeatureContext.tsx` already exports the client cross-feature provider + hook surface needed for composition-layer injection.
- Verified `packages/msp-composition/src/clients/MspClientCrossFeatureProvider.tsx` already bridges tickets/surveys/assets callbacks into the clients context.
- Current lint baseline has `0` active `projects -> clients` and `0` active `scheduling -> clients` warnings; the lone remaining direct import in `packages/projects/src/actions/projectActions.ts` is an intentionally justified server-action exception.
- P2-5a is effectively green in the current tree: the most recent root `npm run build` passed, and the client-related pair counts are already reduced to zero warnings.
- P2-5a now closes as verification/bookkeeping only because the context/provider migration had already landed before this plan pass.
- P2-5b inventory from the authoritative lint log: `documents` is still the top target with 39 warnings sourced from `projects` (10), `clients` (10), `client-portal` (7), `tickets` (5), `assets` (3), `users` (2), `workflows` (1), and `billing` (1). Common import shapes are entity-image helpers, document utilities, `Documents`/`DocumentUpload` UI, and KB types.
- Moved the public `uploadEntityImage` / `deleteEntityImage` entrypoint to `@alga-psa/storage` and updated the `client-portal`, `teams`, `users`, `tenancy`, and `clients` callers to import from the horizontal package instead of `@alga-psa/documents`.
- Added a horizontal `DocumentsCrossFeatureContext` to `@alga-psa/core` so remaining document UI imports can be replaced without introducing new vertical-to-vertical dependencies.
- `DocumentsCrossFeatureContext` must stay off the root `@alga-psa/core` barrel because exporting a client-only React context there causes server imports of `@alga-psa/core` to fail Next.js builds.
- T001 verified that `shared/` only mentions `@alga-psa/workflows` in the comment inside `shared/types/product-email-domains.d.ts`; there are no actual code imports left.
- T002 verified `cd ee/packages/workflows && npx tsc --noEmit` succeeds after the ten test-file moves.
- T003 verified a fresh repo-root `npm run build` succeeds after the workflow moves, auth cleanup, and storage entity-image extraction work.
- T004 hit the documented local skip condition: `npx nx graph --file=/tmp/graph.json` still fails with `brace_expansion_1.default is not a function`, so cycle verification continues to rely on the pruned baseline and removed import edge.
- T005 confirmed `.github/known-cycles.json` now contains `12` baselined cycles, down from the prior `30`.
- T006 reconfirmed that the direct lint command remains the authoritative measurement path; after the later document cleanup it reports `98` current violations.
- T007 reconfirmed the per-source lint breakdown pipeline; the latest run is led by `client-portal`, `workflows`, `tickets`, `clients`, and `projects`.
- T008 reconfirmed the per-target lint breakdown pipeline; `documents` remains the top target even after the entity-image move, followed by `tickets`, `billing`, and `sla`.
- T009 verified there are no remaining `auth-compat` source references anywhere in the repo.
- T010 verified `ee/server/src/app/api/extensions/_auth.ts` now imports `getSession` directly from `@alga-psa/auth`.
- T011 verified `ee/server/src/app/api/provisioning/tenants/route.ts` now imports `getSession` directly from `@alga-psa/auth`.
- T012 confirmed `server/src/lib/auth-compat.ts` no longer exists on disk.
- T013 reuses the latest repo-root green build to validate the auth-compat removal end-to-end.
- T014 verified `packages/msp-composition/src/index.ts` exports `./assets` from the root barrel.
- T015 verified `packages/msp-composition/src/index.ts` exports `./billing` from the root barrel.
- T016 verified `packages/msp-composition/src/index.ts` exports `./clients` from the root barrel.
- T017 reuses the latest repo-root green build to validate the expanded `msp-composition` barrel.
- T018 verified the current lint output has `0` active `projects -> clients` violations, which is below the historical non-zero starting point for P2-5a.
- T019 verified `packages/clients/src/context/ClientCrossFeatureContext.tsx` exists and exports the expected provider/hook pair.
- T020 reuses the latest repo-root green build to validate the current client-composition setup.
- T021 verified the latest lint run has `34` `documents`-target violations, which is below the `<36` target in the plan.
- T022 verified no vertical package now imports `uploadEntityImage` or `deleteEntityImage` from `@alga-psa/documents`; those callers now resolve through `@alga-psa/storage`.
- T023 reuses the latest repo-root green build to validate the current document-cleanup changes.
- F028 conditions are met in the current tree: repo-root build passes and the `documents` target is down to `34` warnings from the earlier `39` baseline.
- The current document-cleanup series is committed through `F025`, `F026`, and the follow-up barrel fix, so the implemented P2-5b work is fully checked in.
- Rolled the `DocumentsCrossFeatureContext` out into composition providers for MSP and client-portal shells, then migrated the remaining client-side document UI/util callers in `assets`, `tickets`, and `client-portal` to consume the context instead of importing `@alga-psa/documents` directly.
- Moved the client-portal document provider out of `packages/client-portal` and into `server/src/app/client-portal/ClientPortalDocumentsProvider.tsx` after lint exposed that a local provider would itself create a new `client-portal -> documents` violation.
- Validation after the provider rollout: `npm run lint` now reports `91` total `no-feature-to-feature-imports` warnings and only `27` targeting `documents` (down from `98`/`34` before this pass); repo-root `npm run build` also passes.
- F030 categorization snapshot from `/tmp/alga-lint-f030.log`: `client-portal` now has `34` remaining warnings. `6` are clearly fixable (`client-kb.ts`, `ClientKBArticleView.tsx`, `ClientKBPage.tsx` via `@alga-psa/types`; `ProjectDetailView.tsx` via a composition facade). The other `28` are inherent composition edges across `tickets`, `billing`, `clients`, and `users`, where client-portal is intentionally orchestrating vertical feature APIs/components and is a reasonable candidate for justified `eslint-disable` comments in F031.
- Acceptable/inherent client-portal edges: `client-billing.ts`, `client-tickets.ts`, `clientPaymentActions.ts`, `BillingOverview.tsx`, `ClientInvoicePreview.tsx`, `ClientProfile.tsx`, `ClientDetailsSettings.tsx`, `ClientPasswordChangeForm.tsx`, `UserManagementSettings.tsx`, `ClientAddTicket.tsx`, `TicketDetails.tsx`, `TicketDetails.originBadge.contract.test.ts`, and `TicketList.tsx`.
- Fixable client-portal edges queued for later items: `client-kb.ts`, `ClientKBArticleView.tsx`, `ClientKBPage.tsx` (type-only `documents` imports for P2-6), plus `ProjectDetailView.tsx` (presentation imports from `projects`, a good `client-portal` composition-facade candidate for F032).
- Added file-level `custom-rules/no-feature-to-feature-imports` disables with explicit justification comments to the acceptable/inherent client-portal composition files; a fresh `npm run lint` now reports `63` total violations and only `6` remaining `client-portal` warnings, all in the previously identified fixable KB/project files.

## Remaining Open Work

- **F032:** next up. Only the fixable `client-portal` edges remain: the three KB type imports from `documents` and the three `ProjectDetailView.tsx` presentation imports from `projects`.

## Gotchas

- `npm run lint` is the correct command (not `npx nx run-many --target=lint` which misses ~50% of violations)
- `nx graph` may fail with brace_expansion error — try `npx nx reset` first
- Never create re-export shims when migrating — update all callers directly
- `client-portal` is inherently a composition layer — some violations may be acceptable with eslint-disable
- When adding context facades, providers must go in `DefaultLayout.tsx` (not per-page) because DrawerOutlet renders at layout level
- `msp-composition` is a horizontal package so it's allowed to import from verticals — its internal violations are by design
