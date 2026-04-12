# Scratchpad — Unapproved Time Blocks Recurring Invoices

- Plan slug: `unapproved-time-blocks-recurring-invoices`
- Created: `2026-04-12`

## What This Is

Working notes for making recurring invoice approval blockers explicit in Automatic Invoices and enforcing the same rule server-side during generation.

## Decisions

- (2026-04-12) A recurring invoice window is blocked in full when it contains at least one uninvoiced billable time entry for that window whose `approval_status !== 'APPROVED'`.
- (2026-04-12) Blocked windows belong in a dedicated **Needs Approval** section above **Ready to Invoice**.
- (2026-04-12) The blocked row should show `X unapproved entries`, not blocked hours, because count is more actionable for approvers.
- (2026-04-12) Mixed-charge windows are blocked entirely; no partial invoice should be created for fixed or other non-time charges while related billable time is still unapproved.
- (2026-04-12) The generation path must re-check approval blockers immediately before invoice creation so stale UI state cannot bypass the rule.

## Discoveries / Constraints

- (2026-04-12) Reviewed billing-engine selection queries indicate contract-hourly and unresolved/non-contract time selection already filter `time_entries.approval_status = 'APPROVED'`. Relevant file: `packages/billing/src/lib/billing/billingEngine.ts`.
- (2026-04-12) `rolloverUnapprovedTime(...)` explicitly targets `DRAFT`, `SUBMITTED`, and `CHANGES_REQUESTED` entries after recurring invoice generation, which reinforces that unapproved time is conceptually expected to stay out of billed time selection. Relevant files: `packages/billing/src/lib/billing/billingEngine.ts`, `packages/billing/src/actions/invoiceGeneration.ts`.
- (2026-04-12) `AutomaticInvoices.tsx` already understands grouped recurring candidates and generic blocked states (`canGenerate` / `blockedReason`), so approval blockers can likely fit the existing grouped row model rather than requiring a brand new page architecture.
- (2026-04-12) `packages/billing/src/actions/billingAndTax.ts` appears to be the primary recurring due-work shaping path and likely the right place to compute approval-blocker metadata for the UI.
- (2026-04-12) `packages/types/src/interfaces/recurringTiming.interfaces.ts` already carries grouped due-work row and candidate metadata and likely needs approval-blocker count/reason fields.
- (2026-04-12) During review, no obvious source-linkage population path for `invoice_time_entries` / `invoice_usage_records` was found in the inspected invoice creation path. That looks adjacent to, but not required for, this blocker-focused change and should stay out of scope unless implementation depends on it.

## Commands / Runbooks

- (2026-04-12) Scaffolded this plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/scaffold_plan.py "Unapproved Time Blocks Recurring Invoices" --slug unapproved-time-blocks-recurring-invoices`
- (2026-04-12) Validate the plan with:
  - `python3 /Users/roberisaacs/.codex/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-04-12-unapproved-time-blocks-recurring-invoices`
- (2026-04-12) Design doc written to:
  - `docs/plans/2026-04-12-unapproved-time-blocks-recurring-invoices-design.md`

## Links / References

- Design doc: `docs/plans/2026-04-12-unapproved-time-blocks-recurring-invoices-design.md`
- Automatic invoices UI: `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
- Recurring due-work shaping: `packages/billing/src/actions/billingAndTax.ts`
- Recurring generation: `packages/billing/src/actions/invoiceGeneration.ts`
- Recurring billing runs: `packages/billing/src/actions/recurringBillingRunActions.ts`
- Billing engine selection logic: `packages/billing/src/lib/billing/billingEngine.ts`
- Due-work interfaces: `packages/types/src/interfaces/recurringTiming.interfaces.ts`
- Related grouped automatic-invoices plan: `ee/docs/plans/2026-03-20-grouped-automatic-invoices-selection/`

## Open Questions

- What is the exact target screen for `Review Approvals`, and can we deep-link/filter by client and invoice window in the first pass?

## Implementation Log (2026-04-12)

- Added shared recurring approval-blocker detection helper:
  - `packages/billing/src/actions/recurringApprovalBlockers.ts`
  - Centralizes blocker count logic for contract-hourly windows and unresolved/non-contract time selections.
  - Uses `approval_status !== 'APPROVED'`, excludes `invoiced=true`, and returns counts by recurring execution identity key.
- Applied blocker metadata during due-work shaping:
  - `packages/billing/src/actions/billingAndTax.ts`
  - `getAvailableRecurringDueWork(...)` now computes and applies approval-blocker counts before pagination.
  - Candidates and members now carry blocker metadata and approval-specific blocked reason text.
- Extended recurring due-work interfaces for blocker metadata:
  - `packages/types/src/interfaces/recurringTiming.interfaces.ts`
  - Added `approvalBlockedEntryCount` on rows/candidates and `hasApprovalBlockers` on candidates.
- Added server-side recurring generation guard:
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - Re-resolves selector-input windows to matching recurring rows, re-checks approval blockers immediately before invoice creation, and throws `Blocked until approval: X unapproved entries.` when blocked.
  - Fixed pre-check query regression by joining `recurring_service_periods -> contract_lines -> contracts` and filtering by `contracts.owner_client_id`.
- Ensured grouped recurring runs continue when one target is blocked:
  - `packages/billing/src/actions/recurringBillingRunActions.ts`
  - Preserves per-target failure handling while continuing unrelated eligible targets.
  - Adjusted helper invocations to avoid passing explicit `undefined` bridge args.
- Added Automatic Invoices Needs Approval UX:
  - `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
  - New **Needs Approval** section above **Ready to Invoice**.
  - Blocked groups moved out of ready table.
  - Needs Approval rows show client, service period, invoice window, `X unapproved entries`, and `Review Approvals` link to `/msp/time-sheet-approvals` with query params.
  - Ready selection/preview/generate semantics remain for clean windows.

## Test Coverage Added / Updated

- Integration (DB-backed):
  - `server/src/test/integration/billingInvoiceTiming.integration.test.ts`
  - Added/updated:
    - `T001/T004` approval-blocked contract-hourly window with uninvoiced non-approved time.
    - `T002` unrelated non-approved time outside window does not block.
    - `T003/T008/T017` mixed-charge window blocked in full; direct generation rejects.
    - `T009/T011` stale-ready server rejection and approval-cleared transition back to ready.
  - Added helper options in `createApprovedTimeEntryForContractLine(...)` for `approvalStatus` and `invoiced`.
- UI unit:
  - `server/src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx`
  - Added Needs Approval rendering/assertions (section order, row content, review link, non-selectable/non-generatable behavior).
  - Added explicit `T007` coverage marker for preserving ready-list grouped behavior.
- Server generation unit:
  - `server/src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts`
  - Added `T008/T009` guard test validating pre-generation blocker rejection.
- Recurring run unit:
  - `server/src/test/unit/billing/recurringBillingRunActions.test.ts`
  - Added `T010` coverage ensuring blocked target failure does not stop unrelated eligible target.
- Docs/copy unit:
  - `server/src/test/unit/docs/unapprovedTimeBlocksRecurringInvoices.copy.test.ts`
  - Added `T012` assertions for runbook + in-product copy.

## Validation Commands Run

- `pnpm -s vitest run src/test/unit/billing/automaticInvoices.recurringDueWork.ui.test.tsx --coverage.enabled=false`
- `pnpm -s vitest run src/test/unit/billing/invoiceGeneration.selectorInputGenerate.test.ts --coverage.enabled=false`
- `pnpm -s vitest run src/test/unit/billing/recurringBillingRunActions.test.ts src/test/unit/docs/unapprovedTimeBlocksRecurringInvoices.copy.test.ts --coverage.enabled=false`
- `pnpm -s vitest run src/test/integration/billingInvoiceTiming.integration.test.ts -t "T001/T004|T002: recurring due-work does not block|T003/T008/T017|T009/T011" --coverage.enabled=false`

## Gotchas / Notes

- Running the full `billingInvoiceTiming.integration.test.ts` suite currently includes pre-existing failures unrelated to this approval-blocker scope; validation for this change set uses targeted DB-backed cases tied to plan IDs.
- One unit fixture (`invoiceGeneration.selectorInputGenerate`) required explicit recurring-service-period row fields (`owner_client_id`, matching invoice window) so the new pre-generation blocker query can resolve rows in the mocked environment.
