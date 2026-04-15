# Unapproved Time Blocks Recurring Invoices Design

Date: 2026-04-12
Slug: `unapproved-time-blocks-recurring-invoices`

## Summary

Recurring invoice windows that contain billable time entries which are not yet approved should be treated as **not invoice-ready**. Instead of silently billing partial work or burying the problem in preview flows, Automatic Invoices should split those windows into a dedicated **Needs Approval** section and prevent generation until the underlying time is approved.

## Current-State Findings

Code review in this worktree showed:

- Contract hourly billing already filters `time_entries.approval_status = 'APPROVED'` in `packages/billing/src/lib/billing/billingEngine.ts`.
- Unresolved/non-contract time billing also filters `time_entries.approval_status = 'APPROVED'` in the same billing engine.
- `rolloverUnapprovedTime(...)` explicitly targets `DRAFT`, `SUBMITTED`, and `CHANGES_REQUESTED` entries after recurring invoice generation.

So the primary issue is less “the core billing query intentionally bills unapproved time” and more:

1. recurring bulk invoicing does not clearly surface windows that are blocked by unapproved billable time,
2. operators lack a dedicated queue for approval-dependent windows, and
3. generation should still re-check the approval rule server-side in case the UI is stale.

## Product Rule

A recurring invoice window is blocked when it contains at least one uninvoiced time entry that would otherwise be billable for that window but whose `approval_status !== 'APPROVED'`.

This blocks the **entire invoice window**, even if the same window also contains fixed, license, usage, or other non-time charges.

## UX

### Automatic Invoices layout

Split the recurring invoice experience into two sections:

1. **Needs Approval**
   - Shown above Ready to Invoice.
   - Contains grouped invoice windows that are otherwise billable but blocked by unapproved time.
   - Shows client, service period, invoice window, and `X unapproved entries`.
   - Includes a `Review Approvals` action.
   - Rows are informational/actionable only: no generation, no selection.

2. **Ready to Invoice**
   - Contains only windows that are fully invoiceable now.
   - Existing preview/generate behaviors remain available.

### Operator messaging

- Section helper text should explain that these windows are blocked because billable time is not yet approved.
- Needs Approval rows should show blocked counts, not blocked hours, because entry count is more actionable for approvers.
- After bulk generation, the screen may still summarize how many windows remain in Needs Approval, but blocked windows should not be mixed into Ready to Invoice selection.

## Detection Rules

Approval blockers must be computed with the same effective billing semantics as invoice selection:

- **Contract hourly time**: use the same service-period timing, client/work-item scope, service matching, and assignment logic used for approved-billing selection, but search for non-approved entries.
- **Unresolved/non-contract time**: only treat unresolved time as a blocker when unresolved/non-contract time is actually part of the recurring selection scope.
- Ignore already invoiced entries.
- Treat any non-approved status as blocking, not only today’s named workflow states.

A client having unrelated unapproved time elsewhere must not block unrelated invoice windows.

## Enforcement

### Read path

The recurring due-work read path should classify windows with approval blockers and include blocker metadata in the row/candidate models.

### Generate path

Invoice generation must re-run the blocker check immediately before invoice creation and reject blocked windows with a descriptive error such as:

> This invoice window is blocked because it contains 7 unapproved time entries.

That protects against stale tabs, direct API calls, and approval-state races.

## Implementation Shape

Likely touchpoints:

- `packages/billing/src/actions/billingAndTax.ts`
- `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx`
- `packages/billing/src/actions/invoiceGeneration.ts`
- `packages/billing/src/actions/recurringBillingRunActions.ts`
- `packages/types/src/interfaces/recurringTiming.interfaces.ts`
- Possibly shared recurring due-work helpers / billing-engine helpers for reusable blocker detection

## Edge Cases

- Mixed fixed + hourly window with one matching unapproved time entry: block the whole window.
- Window becomes approved after manager action: it moves from Needs Approval to Ready to Invoice on refresh.
- UI showed ready earlier but approval status changed before generate: server rejects generation.

## Testing Focus

- Due-work classification between Needs Approval and Ready to Invoice
- Window-specific blocker semantics vs unrelated client time
- Server-side rejection of blocked generation attempts
- Automatic Invoices rendering and non-selectability of blocked rows
- Transition from blocked to ready after approval
