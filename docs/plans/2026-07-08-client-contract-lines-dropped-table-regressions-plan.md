# Fix `client_contract_lines` dropped-table regressions (user error report)

**Branch:** `fix/user-error-report`
**Date:** 2026-07-08

## Problem

A user hit this on saving a time entry:

```
Error updating bucket usage for time entry <id>: error: select "ccl"."contract_line_id", ...
  from "client_contract_lines" as "ccl" inner join "contract_lines" ...
  - relation "client_contract_lines" does not exist  (code 42P01)
Error saving time entry: Error: Failed to update bucket usage: ... - relation "client_contract_lines" does not exist
```

## Root cause

The `client_contract_lines` table was dropped during the contract-lines migration
(contracts are now client-specific via `client_contracts`). The migration updated the
canonical bucket-usage service and its static guard tests, but **three runtime code paths
were never updated** and still query the dropped table:

| # | Location | Trigger | Notes |
|---|----------|---------|-------|
| 1 | `packages/scheduling/src/services/bucketUsageService.ts:79` (`calculatePeriod`) | Time-entry save via `timeEntryCrudActions.ts` — **the reported error** | Stale fork of the migrated service; identical export surface |
| 2 | `shared/workflow/runtime/actions/businessOperations/timeDomain.ts:708` (`resolveBucketUsagePeriod`) | Time entries created via workflow (`createWorkflowTimeEntry`) | Inline third copy of the bucket-period logic |
| 3 | `packages/billing/src/models/contractLine.ts:24` (`ContractLine.isInUse`) | Contract-line delete guard (only caller is `ContractLine.delete()`) | Separate stale reference |

The canonical, already-migrated implementation is
`packages/billing/src/services/bucketUsageService.ts`, which resolves the active plan via
`client_contracts as cc → contracts as ct → contract_lines as cl` (+ `recurring_service_periods`).
Its exported functions (`findOrCreateCurrentBucketUsageRecord`, `updateBucketUsageMinutes`,
`reconcileBucketUsageRecord`) have signatures identical to the scheduling fork.

**Why it slipped through:** `clientContractLineRuntimeSourceGuards.static.test.ts` only scans
`packages/billing/src/{actions,services}`, `packages/client-portal/src/actions`, and
`packages/clients/src/{actions,models}`. None of the three fix sites are covered, and its
regexes don't match the bare `tenantScopedTable(conn, tenant, 'client_contract_lines')` form
used in fix #3.

## Fixes

### Fix #1 — Time-entry save (reported error): delete the fork, re-point to billing

- **Delete** `packages/scheduling/src/services/bucketUsageService.ts`. The only runtime
  importer is `packages/scheduling/src/actions/timeEntryCrudActions.ts`.
- In `packages/scheduling/src/actions/timeEntryCrudActions.ts` change the import (line 6) from
  `'../services/bucketUsageService'` to `'@alga-psa/billing/services/bucketUsageService'`.
  This covers both call sites (~line 714 and ~line 1067).
- Add `"@alga-psa/billing": "*"` to `packages/scheduling/package.json` dependencies.
  - `@alga-psa/billing/services/bucketUsageService` is already imported by
    `packages/jobs/src/lib/handlers/reconcileBucketUsageHandler.ts`, so the subpath resolves.
  - No dependency cycle: `@alga-psa/billing` does not import `@alga-psa/scheduling` (verify via
    typecheck/build).
- **Behavior note:** the time-entry path now uses billing's migrated period resolution
  (`recurring_service_periods` + cadence disambiguation) instead of the fork's
  `client_billing_cycles` logic — this is the intended, consistent behavior.
- **Tests:**
  - Delete `packages/scheduling/tests/bucketUsageService.periods.test.ts` (it imports the
    deleted file; billing has equivalent coverage in
    `server/src/test/unit/billing/bucketUsageService.periods.test.ts`).
  - In `packages/scheduling/tests/timeEntryCrud.changeRequests.test.ts` (~line 42) update
    `vi.mock('../src/services/bucketUsageService', …)` to
    `vi.mock('@alga-psa/billing/services/bucketUsageService', …)`.

### Fix #2 — Workflow-created time entries: in-place migration

`shared/workflow/runtime` should not depend on `@alga-psa/billing` (layering), so migrate the
query in place rather than re-pointing.

- In `shared/workflow/runtime/actions/businessOperations/timeDomain.ts` `resolveBucketUsagePeriod`
  (~line 708), replace the `client_contract_lines as ccl → contract_lines as cl` join with
  `client_contracts as cc → contracts as ct → contract_lines as cl`
  (`cc.contract_id = ct.contract_id`, `cl.contract_id = ct.contract_id`,
  `cl.contract_line_id = contractLineId`, `cc.client_id = clientId`, `cc.is_active = true`,
  date window on `cc.start_date`/`cc.end_date`; select `cc.start_date`, `cl.billing_frequency`).
  Keep the existing `client_billing_cycles`-first strategy and `calculateAnchoredPeriod` fallback.
- Add a marker documenting the intentional non-dedup:
  `// LEVERAGE: pattern bucket-usage-period — same period logic also in @alga-psa/billing bucketUsageService; kept separate to respect the shared/workflow → billing layering boundary.`
- Update contract test `server/src/test/unit/scheduling/workflowTimeDomainTenantScoped.contract.test.ts`
  (~line 92): replace the `tenantScopedTable(trx, 'client_contract_lines as ccl', tenantId)`
  assertion with assertions matching the new `client_contracts` join shape.

### Fix #3 — Contract-line delete guard: in-place migration

- In `packages/billing/src/models/contractLine.ts` rewrite `ContractLine.isInUse(knexOrTrx, planId)`
  to count client assignments through the contract instead of the dropped table:
  `contract_lines cl (cl.contract_line_id = planId) → client_contracts cc (cc.contract_id = cl.contract_id)`,
  returning `count > 0`. Semantics: "in use by clients" = any `client_contracts` row exists for
  this line's contract (active-agnostic, mirroring the original unconditional count). Preserves
  the `delete()` guard message "Cannot delete contract line that is in use by clients".

### Regression guard (prevent recurrence)

Extend `server/src/test/unit/billing/clientContractLineRuntimeSourceGuards.static.test.ts`:

- Add scan roots covering the fix sites — at minimum `packages/scheduling/src`,
  `shared/workflow/runtime`, and `packages/billing/src/models`; prefer broadening to all
  `packages/*/src` plus `shared`.
- Add a pattern that catches the bare quoted string-literal argument form (e.g.
  `tenantScopedTable(…, 'client_contract_lines')`) for both `client_contract_lines` and
  `client_contract_services`. To avoid false positives on the many explanatory comments that
  legitimately name the dropped tables, strip line/block comments from the source before matching.

## Verification

- `npm run test` for the touched/extended unit + guard tests.
- Typecheck/build `@alga-psa/scheduling` to confirm the new `@alga-psa/billing` dependency
  introduces no cycle and resolves the subpath import.
- Optional read-only production sanity check (`alga-production-troubleshooting`): confirm the
  reporting tenant has an active bucket contract line so the migrated path resolves a period.

## Out of scope

- Deduplicating the workflow-runtime bucket-period logic into a shared package (fix #2 keeps a
  corrected separate copy behind the layering boundary; marked with a LEVERAGE comment).
