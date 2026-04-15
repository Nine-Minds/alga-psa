# PRD — Unapproved Time Blocks Recurring Invoices

- Slug: `unapproved-time-blocks-recurring-invoices`
- Date: `2026-04-12`
- Status: Draft

## Summary

Treat unapproved billable time as a first-class recurring invoicing blocker. Automatic Invoices should separate blocked windows into a dedicated **Needs Approval** section, keep **Ready to Invoice** limited to windows that can actually be generated now, and enforce the same approval rule server-side during recurring invoice generation.

This is intentionally both a UX and enforcement change. The billing engine already filters approved time for the billing paths reviewed, but the bulk recurring invoicing experience does not clearly expose approval-dependent windows or provide a dedicated queue for them.

## Problem

Operators running recurring invoices in bulk need a clear answer to two questions:

1. which invoice windows can be billed right now?
2. which invoice windows are waiting on time approval?

Today, that answer is not explicit enough:

- the recurring billing stack already filters approved time for contract-hourly and unresolved time selection, so unapproved entries do not have a visible first-class representation in Automatic Invoices
- bulk operators may not preview every candidate before generation, so preview-only warnings are insufficient
- mixed windows that also include fixed or other non-time charges are especially easy to misunderstand if labor approval is still pending
- the generation path should not rely only on whatever the UI happened to load earlier; it should re-check approval blockers before persisting an invoice

The resulting operator experience is confusing: windows can appear invoice-adjacent without a clear explanation that approval work still needs to happen first.

## Goals

- Make approval-blocked recurring invoice windows explicit in the product.
- Split Automatic Invoices into a visible **Needs Approval** queue and a clean **Ready to Invoice** queue.
- Block the entire invoice window when matching billable time is not approved.
- Show an actionable count of blocked entries (`X unapproved entries`) rather than a less actionable hour total.
- Preserve a simple finance rule: if a window is not fully approval-ready, it is not invoice-ready.
- Re-enforce the same approval blocker rule server-side during recurring invoice generation.
- Ensure blocker detection is window-specific and uses effective billability semantics rather than a loose client-level heuristic.

## Non-goals

- Partial invoicing of fixed, license, or usage charges while holding time back.
- Reworking time approval workflows themselves.
- Adding a new approval exception or override model.
- Replacing existing approved-time billing selection logic with a new billing model.
- Adding feature flags, analytics, or observability work as first-class scope.
- Solving unrelated invoice-source-linkage or `invoiced=true` consistency gaps beyond what is required for this blocker feature.

## Users and Primary Flows

- Billing admin / finance operator
  1. Opens Automatic Invoices.
  2. Sees approval-blocked windows in **Needs Approval**.
  3. Uses **Ready to Invoice** only for windows that are fully invoiceable now.
  4. Generates invoices in bulk without guessing whether hidden unapproved work still exists.

- Approver / delivery manager
  1. Opens the **Needs Approval** queue.
  2. Identifies a client + period blocked by `X unapproved entries`.
  3. Uses `Review Approvals` to navigate to the existing approval workflow.
  4. Approves or resolves those entries so the window becomes invoice-ready.

- Support / engineering
  1. Explains why a recurring window is not billable.
  2. Verifies that the product blocks the entire window consistently in UI and server generation.

## Product Decisions

### 1. Approval blockers block the entire invoice window

If a recurring invoice window contains at least one uninvoiced time entry that would otherwise be billable for that window and `approval_status !== 'APPROVED'`, the entire window is blocked.

This applies even if the same window also has fixed, usage, license, or other non-time charges.

### 2. Automatic Invoices must separate blocked windows from ready windows

Blocked windows belong in a dedicated **Needs Approval** section above **Ready to Invoice**.

Ready to Invoice should contain only windows that can actually be generated now.

### 3. Entry count is the primary actionable approval signal

Needs Approval rows should show `X unapproved entries`, not blocked hours, because entry count is more actionable for approvers.

### 4. The approval rule is window-specific, not client-global

A client having unrelated unapproved time elsewhere must not block unrelated recurring windows.

Detection must follow the same effective billability rules used by recurring billing selection.

### 5. Server-side generation must re-check blockers

Even if the UI previously showed a window as ready, recurring generation must reject it if approval state changed before invoice creation.

## UX / UI Notes

- Add a new **Needs Approval** section above **Ready to Invoice** on `AutomaticInvoices.tsx`.
- Needs Approval should use the same grouped `client + invoice window` mental model users already understand.
- Each grouped blocked row should show:
  - client
  - service period
  - invoice window
  - `X unapproved entries`
  - `Review Approvals` CTA
- Needs Approval rows are not selectable, not previewable for generation, and not generatable.
- Ready to Invoice should exclude windows with approval blockers.
- Section helper text should explain that these windows contain billable time that is not yet approved, so the whole window is blocked from invoicing.
- Existing Ready to Invoice grouping/selection semantics should remain intact for clean windows.
- If the product already uses blocked/disabled reason text on child or parent rows, approval blockers should use specific wording rather than a generic “not eligible” message.

## Requirements

### Functional Requirements

1. A recurring invoice window with at least one matching uninvoiced, non-approved billable time entry must be classified as approval-blocked.
2. Approval blocker detection must treat any `approval_status !== 'APPROVED'` as blocking.
3. Approval blocker detection for contract-hourly work must follow the same effective service-period, service-matching, assignment, client, and work-item semantics used by approved recurring billing selection.
4. Approval blocker detection for unresolved/non-contract time must apply only when unresolved/non-contract time is part of the recurring selection scope being represented.
5. Already invoiced time entries must not contribute to approval blocker counts.
6. The recurring due-work row/candidate model must carry approval-blocker metadata sufficient to classify windows and render `X unapproved entries`.
7. Automatic Invoices must render a **Needs Approval** section above **Ready to Invoice** whenever approval-blocked windows exist.
8. Needs Approval rows must show client, service period, invoice window, and unapproved entry count.
9. Needs Approval rows must expose a `Review Approvals` action to route the operator toward the existing approval workflow.
10. Needs Approval rows must not be selectable for invoice generation.
11. Ready to Invoice must exclude approval-blocked windows.
12. A mixed-charge recurring window (for example fixed + hourly) must still be fully blocked when matching billable hourly time is not approved.
13. The recurring invoice generation path must re-check approval blockers immediately before invoice creation.
14. Direct or stale generation attempts for blocked windows must fail with a descriptive error that includes the blocked entry count.
15. Grouped recurring billing runs must continue processing unrelated eligible windows even when one target is approval-blocked and rejected.
16. Once the relevant time entries become approved, the same window must move from Needs Approval to Ready to Invoice on refresh.
17. Existing ready/preview/generate behavior for windows without approval blockers must remain unchanged.
18. Product copy and plan docs must explain that the whole invoice window is blocked until the billable time is approved.

### Non-functional Requirements

- No partial recurring invoices when approval blockers exist.
- No silent fallback to “bill approved-only” for a blocked window.
- Detection logic should be shared or centralized enough that due-work classification and generation enforcement do not drift.
- DB-backed integration coverage must include at least one approval-blocked recurring window and one approval-cleared recurring window using real schema queries.
- Source-string or UI-only tests are insufficient as the only coverage for server-side enforcement.

## Data / API / Integrations

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` likely needs approval-blocker metadata added to recurring due-work rows and/or invoice candidates.
- `packages/billing/src/actions/billingAndTax.ts` is the most likely place to compute approval-blocker metadata during recurring due-work shaping.
- `packages/billing/src/components/billing-dashboard/AutomaticInvoices.tsx` will need a second grouped section for approval-blocked windows.
- `packages/billing/src/actions/invoiceGeneration.ts` and/or shared recurring generation helpers must re-check approval blockers before invoice persistence.
- `packages/billing/src/actions/recurringBillingRunActions.ts` must surface blocked-target failures cleanly without breaking unrelated eligible targets in the same run.
- A shared blocker helper is preferred over duplicating similar query logic in the read path and generate path.

## Security / Permissions

- No new permissions are intended for this change.
- Existing billing permissions continue to govern recurring invoice generation.
- Existing time approval / timesheet approval permissions continue to govern who can resolve blockers.
- The `Review Approvals` action should route to an existing approval surface rather than inventing a bypass around current approval permissions.

## Observability

- No new telemetry or analytics is required for the first pass.
- Descriptive server errors and existing logs are sufficient unless implementation reveals a stronger support need.

## Rollout / Migration

- This should ship as a direct behavior change rather than behind a feature flag, assuming blocker detection is accurate.
- Release notes/support guidance should call out that recurring invoice windows with unapproved billable time will now appear under **Needs Approval** and cannot be generated until approval is complete.
- Some tenants may newly notice approval backlog because windows that previously felt implicitly “almost ready” will now be explicitly blocked.

## Open Questions

- What is the exact destination for `Review Approvals` — a manager approvals dashboard, a filtered timesheet list, or another existing approval-focused screen?
- Does the product already support passing client/date filters into that approval destination, or is a generic landing page acceptable for the first pass?

## Acceptance Criteria (Definition of Done)

- Automatic Invoices shows approval-blocked recurring windows in a dedicated Needs Approval section above Ready to Invoice.
- Each blocked grouped row displays the client, service period, invoice window, and unapproved entry count.
- Approval-blocked windows cannot be selected or generated from Automatic Invoices.
- Ready to Invoice contains only windows that are fully approval-ready.
- Any recurring generation attempt for a blocked window fails server-side with a descriptive approval-blocker error.
- Mixed-charge windows are blocked entirely when matching billable time is not approved.
- When the blocking entries are approved, the window appears in Ready to Invoice on refresh.
- Automated coverage includes UI classification plus DB-backed/server generation enforcement cases.
