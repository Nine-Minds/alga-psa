# Scratchpad — Simplify Time Billing by Removing Unapproved-Time Rollover

- Date: 2026-05-21
- Status: Draft
- Context: Production investigation of invoice `cf729bfc-f143-4b0d-bbbe-11f60d444157` / `INV001522` for AI Med Consult.

## Findings

- `INV001522` billed 18 hours because the hourly billing engine rounds each entry to whole hours after configured 15-minute rounding.
- Three entries with `work_date = 2026-03-31` were billed in the April service period because their `start_time` is `2026-04-01T00:00:00Z`.
- For New York users, `2026-04-01T00:00:00Z` is `2026-03-31 20:00` local time, so `computeWorkDateFields(..., 'America/New_York')` correctly produces `work_date = 2026-03-31`.
- Bigger issue discovered: `BillingEngine.rolloverUnapprovedTime()` mutates `time_entries.start_time`, `end_time`, `work_date`, and `work_timezone`, but does not update `time_sheet_id`.
- Result: factual work date/time and time sheet membership can diverge, so time sheet screens can hide hours or show inconsistent totals.

## Key production examples

- Entry IDs linked to `INV001522` with `work_date = 2026-03-31`:
  - `056a739d-d1a1-425a-aa2d-0a99dd87bcdc`
  - `3b4169c1-4877-4714-8cf9-5eff1eeadb57`
  - `c228d57e-3e0d-4ee0-b4a3-8a27f275c4db`
- These entries are linked to time sheet `39f078c1-319b-42f0-99fe-1696fa51445a`, whose period is `2026-02-15` → `2026-03-01`, even though the current `work_date` is `2026-03-31`.
- That same sheet has 7 entries / 360 minutes whose `work_date` is outside the time sheet period.

## Simplification decision

- We will not build historical migration/repair as part of this scope.
- We will leave historical rollover-mutated records in the past unless a separate one-off support repair is explicitly requested.
- We will remove the future unapproved-time rollover mutation logic instead of adding a deferral model.
- Keep the hard rule: matching unapproved time blocks recurring invoice generation.
- Consequence: late-approved time after an invoice was generated must be handled through explicit finance actions, not silent future rollover.

## Deferred support tool

- The PRD documents a future read-only support/audit tool.
- It is intentionally not implemented in this scope.
- If built later, it should explain records with work_date/time_sheet mismatches, invoice links, local timezone evidence, and likely historical rollover classification.

## Important code paths

- Rollover mutation: `packages/billing/src/lib/billing/billingEngine.ts`, `rolloverUnapprovedTime()`.
- Invoice generation caller: `packages/billing/src/actions/invoiceGeneration.ts` calls `billingEngine.rolloverUnapprovedTime(client_id, cycleEnd, nextBillingTimestamp)` after invoice creation.
- Time sheet read path: `packages/scheduling/src/actions/timeSheetActions.ts`, `fetchTimeEntriesForTimeSheet()` loads by `time_sheet_id`.
- Time sheet UI grouping/filtering has `start_time` assumptions:
  - `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx`
  - `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx`
  - `packages/scheduling/src/components/time-management/approvals/TimeSheetApproval.tsx`
- Work date helper: `packages/db/src/lib/workDate.ts`, `computeWorkDateFields()`.

## 2026-05-21 Implementation Log (Codex)

- Completed `F001`: removed the recurring invoice-generation call site that invoked unapproved-time rollover mutation.
  - File: `packages/billing/src/actions/invoiceGeneration.ts`
  - Change: deleted `getNextBillingDate(...)` follow-up logic that computed `nextBillingTimestamp` only to call `billingEngine.rolloverUnapprovedTime(...)`.
  - Rationale: recurring billing must block on unapproved time, not mutate factual time-entry dates forward.

- Completed `F002`: removed the unapproved-time deferral mutation implementation from billing engine.
  - File: `packages/billing/src/lib/billing/billingEngine.ts`
  - Change: deleted `rolloverUnapprovedTime(...)` entirely (and removed related db imports used only by that method).
  - Rationale: enforce no billing path can mutate `time_entries.start_time`, `end_time`, `work_date`, or `work_timezone` for deferral.

- Completed `F003`: preserved approval-blocker behavior path and reason format.
  - File references: `packages/billing/src/actions/recurringApprovalBlockers.ts`, `packages/billing/src/actions/invoiceGeneration.ts`.
  - Change: no logic changes to blocker counting/throw path; only removed obsolete rollover path after invoice creation.
  - Rationale: keep hard blocker rule intact while removing rollover side effect.

- Completed `T001` + `T002` with focused regression coverage.
  - New test file: `packages/billing/tests/recurringApprovalBlockers.rolloverRemoval.test.ts`
  - `T001`: source-level regression asserting invoice generation and billing engine no longer contain `rolloverUnapprovedTime` hooks.
  - `T002`: assertion that approval-blocked reason remains descriptive and correctly singular/plural.

- Commands/runbook used:
  - `rg -n "rolloverUnapprovedTime|invoiceGeneration|approval blocker|unapproved" packages/billing -S`
  - `sed -n '1760,1865p' packages/billing/src/actions/invoiceGeneration.ts`
  - `sed -n '4800,4995p' packages/billing/src/lib/billing/billingEngine.ts`
  - `npx vitest run packages/billing/tests/recurringApprovalBlockers.rolloverRemoval.test.ts`

- Validation blocker/gotcha:
  - Vitest execution failed in this environment due to dependency resolution (`Cannot find package 'dotenv'` from generated Vitest config import path) and engine skew (`node v25.5.0` vs repo engine `>=20 <25`).
  - Tests were added and are logically scoped, but runtime verification is pending a compatible local Node/dependency environment.

## 2026-05-21 Implementation Log (Work-Date UI Canonicalization)

- Completed `F009`: added shared helper for canonical entry date resolution.
  - File: `packages/scheduling/src/components/time-management/time-entry/time-sheet/utils.ts`
  - Added:
    - `getTimeEntryWorkDate(entry)` → prefers `work_date`, falls back to `start_time` date.
    - `isTimeEntryOnWorkDate(entry, dateKey)` → date-key predicate used by grouping/filtering logic.

- Completed `F004` + `F005`: switched time sheet grid/list grouping/filtering from `start_time` day matching to shared work-date helper.
  - Files:
    - `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetTable.tsx`
    - `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheetListView.tsx`
  - Rationale: boundary entries now render/group under `work_date`; a later migration makes missing `work_date` invalid for persisted entries.

- Completed `F007`: quick-add continuation now locates same-day existing entries by resolved work-date.
  - File: `packages/scheduling/src/components/time-management/time-entry/time-sheet/TimeSheet.tsx`

- Completed `F006` + `F008`: approval views and daily summary breakdown now use resolved work-date.
  - File: `packages/scheduling/src/components/time-management/approvals/TimeSheetApproval.tsx`

- Completed `F010`: PRD already documents deferred read-only support/audit tool; marked implemented in checklist without code changes.

- Completed tests:
  - `T003` + `T008` helper behavior tests:
    - File: `packages/scheduling/src/components/time-management/time-entry/time-sheet/utils.test.ts`
  - `T004` + `T005` + `T006` + `T007` wiring regressions:
    - File: `packages/scheduling/src/components/time-management/time-entry/time-sheet/workDateWiring.test.ts`
  - Assertions verify grid/list/approval/quick-add paths use the shared helper.

- Additional command:
  - `npx vitest run packages/scheduling/src/components/time-management/time-entry/time-sheet/utils.test.ts`
  - Same environment blocker persists (`Cannot find package 'dotenv'` from vitest config import path).
