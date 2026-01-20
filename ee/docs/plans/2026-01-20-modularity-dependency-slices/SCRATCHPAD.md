# Scratchpad — Modular Dependency Slices (Billing ↔ Clients)

- Plan folder: `ee/docs/plans/2026-01-20-modularity-dependency-slices/`
- Date started: `2026-01-20`

## Current State (Discovery)
- There is an active effort to break a circular dependency between `@alga-psa/billing` and `@alga-psa/clients`.
- Temporary mitigation already introduced: dynamic import wrappers in billing:
  - `packages/billing/src/lib/clientsHelpers.ts`
  - Used by billing backend (e.g. `packages/billing/src/services/invoiceService.ts`) and billing UI (e.g. `packages/billing/src/components/billing-dashboard/BillingCycles.tsx`).
- There is also a clients→billing dynamic import:
  - `packages/clients/src/actions/clientContractActions.ts` dynamically imports `@alga-psa/billing/models/contract` to call `checkAndReactivateExpiredContract(...)`.

## Goal
Replace dynamic-import “escape hatches” with a new shared slice so dependencies flow down:
- `billing` → `shared-cross-slice`
- `clients` → `shared-cross-slice`
- No `billing` ↔ `clients` imports.

## Candidate “Cross Slice” Responsibilities
- Client contract assignment APIs (create/update/get/list) currently in clients but used by billing screens.
- Client lookup APIs used by billing screens (paginated + billing-cycle-range filtered).
- Default client tax region lookup currently in clients but used by billing invoice generation.
- Contract reactivation logic currently in billing contract model but invoked from clients.

## Decisions (Pending)
### Confirmed
- “Cross-dependencies” live in the existing lower slice `@alga-psa/shared` (not a new domain package).
- Move `ClientPicker` into `@alga-psa/ui` as part of this effort.
- Keep “default client tax region lookup” in `@alga-psa/shared` for now (no separate tax slice in this scope).
- Move contract reactivation-on-assignment-update logic into `@alga-psa/shared` so no billing import is needed from clients/shared.
- Pragmatic rule: limited *copying* of code is allowed to break dependencies without exploding package boundaries; if the same logic is copied >4 times, centralize it.

### Still open
- Exact `@alga-psa/shared` export/module path for these APIs (chosen: `@alga-psa/shared/billingClients`).

## Notes / Commands
- Find remaining billing imports of clients: `rg -n \"@alga-psa/clients\" packages/billing/src`
- Find remaining clients imports of billing: `rg -n \"@alga-psa/billing\" packages/clients/src`
- Existing plan folder format example: `ee/docs/plans/2026-01-09-billing-cycle-anchors/`
- Some code duplication and intentional copying is permissible if it simplifies modularization. We should be pragmatic!

## Scope Adjustment (2026-01-20)
- Validation focus: **build/typecheck checks only** to ensure deterministic builds and a clean dependency graph. Comprehensive new business-logic tests are intentionally deferred for this effort.

## Build Gotcha (2026-01-20)
- `npm run build` was failing in `server/src/invoice-templates/assemblyscript` because the installed `assemblyscript@0.27.36` package was missing its `dist/` folder (so `bin/asc.js` could not import `../dist/asc.js`).
- Fix: pin `assemblyscript` to the local tarball `assemblyscript-0.27.36.tgz` and run `npm install` with a repo-local cache (`--cache ../../../../.npm-cache`) to avoid global npm cache permission issues.

## Nx Cycle Follow-up (2026-01-20)
- `nx run-many -t build` revealed an additional cycle: `auth -> ui -> onboarding -> licensing -> auth`.
- Root cause: `@alga-psa/ui` contained onboarding-specific UI (wizard + dashboard onboarding widgets) and imported `@alga-psa/onboarding`.
- Fix: move onboarding-specific UI into `@alga-psa/onboarding` and keep `@alga-psa/ui` limited to shared UI primitives (wizard chrome, shared components).
- Also moved the onboarding wizard data shape (`WizardData`, etc.) down into `@alga-psa/types` to avoid `tenancy <-> onboarding` cycles.

## Nx Cycle Follow-up — UI Vertical Imports (2026-01-20)
- Additional cycle observed: `... -> auth -> ui -> tenancy -> client-portal -> clients -> ui`.
- Root cause: `@alga-psa/ui` contains multiple “feature” components that import vertical slice actions/components, including:
  - `@alga-psa/tenancy/actions` (branding + locale + tenant settings UIs)
  - `@alga-psa/users/actions` (user settings/profile/admin UIs; mentions search in editor; notification dropdown user lookup)
  - `@alga-psa/clients/actions` and `@alga-psa/clients/components` (settings and activity UIs)
  - `@alga-psa/client-portal/*` (domain settings entry, invitation flows)
- Fix strategy: move those “feature” components out of `@alga-psa/ui` into the owning vertical slice (e.g. `users`, `tenancy`, `client-portal`) or into top-level app (`server`), leaving `@alga-psa/ui` as pure, reusable UI primitives only.

## Nx Tooling Note (2026-01-20)
- On this worktree, `npx nx ...` frequently hangs while “Calculating the project graph on the Nx Daemon” under `node v25.1.0`, and `NX_DAEMON=false` can fail with `Failed to start plugin worker.`.
- Mitigation: the repo now pins Node to a supported range via `.nvmrc` (`20`) and root `package.json` `engines` (`>=20 <25`).
- Validation for this effort therefore relies on:
  - package typechecks (`tsc --noEmit`) for touched packages, and
  - import-greps confirming the key layering breaks (e.g. no `@alga-psa/ui` imports of `@alga-psa/tenancy|users|clients|client-portal`).
