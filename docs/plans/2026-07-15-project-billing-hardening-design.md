# Project Billing Hardening — Design Addendum

**Date:** 2026-07-15
**Status:** Approved
**Parent design:** `docs/plans/2026-07-15-project-billing-design.md`

## Problem

The initial project-billing implementation covers configuration, schedules, caps, invoice generation, profitability, notifications, and portal summaries. A production-readiness review found several cross-cutting gaps:

- Budget thresholds notify, but there is no explicit first-overage event or workflow-catalog registration.
- A PostgreSQL transition trigger is not a safe lifecycle boundary for Citus-distributed schedule entries.
- Technicians have no advisory signal when a specifically designated payment must be received before work continues.
- Project invoice links navigate away instead of opening an invoice drawer.
- Client-portal project billing does not reuse the portal billing permission check and formats all values as USD.
- Project economics can label tenant-currency labor/material cost as though it were in the project revenue currency.
- Project-billing actions do not consistently return the application's structured action/permission error shapes.
- Some unfinalize failures are replaced by a generic client alert.
- Locale files are structurally complete, but newly added project-billing text still contains English fallbacks in non-English locales.

## Decisions

1. Required-payment behavior is advisory only. It never blocks task changes, timers, or time entry.
2. Only schedule entries explicitly marked as requiring payment before work create the warning.
3. The existing `ready` status remains a billing-review status and is not reused for payment state.
4. All capped T&M project charges use the shared hard cap. “Exceeded” means the first persisted write-down beyond that cap.
5. Lifecycle enforcement must behave identically on PostgreSQL and Citus; shard-maintained triggers are not accepted.
6. Technicians may see the generic work warning without billing access, but invoice identifiers, amounts, and previews remain billing-protected.
7. No implicit foreign-exchange conversion is introduced. Currency mismatches are displayed honestly and margin is withheld when amounts are not comparable.

## Considered approaches

### A. Harden the existing feature in place — selected

Derive payment state from linked invoices, enforce lifecycle transitions through atomic application updates, complete the workflow event catalog, reuse the existing drawer/preview infrastructure, and standardize action results. This minimizes new persisted state and keeps project billing inside established application boundaries.

### B. Persist project-wide commercial state and enforce it with triggers

This creates a simple read model but duplicates invoice payment state, requires synchronization for payment reversals/voids, and needs triggers installed and maintained on every Citus shard placement. It was rejected because the persisted state can become stale and shard rebalancing makes the enforcement boundary operationally fragile.

### C. Patch only the visible UI and permissions

This is smaller but leaves workflow automation, raw lifecycle bypasses, multi-currency mislabeling, and inconsistent server-action errors unresolved. It was rejected because the remaining gaps are in money and permission boundaries.

## Data model and lifecycle

Add `requires_payment_before_work boolean NOT NULL DEFAULT false` to `project_billing_schedule_entries`. It applies to milestone and deposit entries. Payment satisfaction is not stored on the schedule row; it is derived from the linked invoice's canonical status.

The warning state is:

- **not applicable:** flag is false or no linked invoice exists;
- **invoice preparation:** linked invoice is still draft;
- **payment outstanding:** invoice is payable and not paid, including partial/overdue states;
- **satisfied:** invoice is paid;
- **replacement needed:** invoice was voided/cancelled while the schedule requirement remains.

Remove the database status-transition trigger. Keep the status-value `CHECK` constraint. Make `status` unavailable to the generic schedule model update method and route every lifecycle change through a central transition function that performs an atomic `UPDATE ... WHERE schedule_entry_id = ? AND status = ?`. The central transition map covers pending, ready, held, approved, invoiced, cancelled, and the documented rollback paths. A stale source status returns a structured conflict error.

This deliberately treats application actions/models as the lifecycle boundary. Direct administrative SQL can bypass transition ordering, but PostgreSQL and Citus receive identical supported behavior without shard trigger maintenance.

## Payment warning data flow

A billing service query resolves a project or project-task to a minimal work-payment warning. The unrestricted technician projection contains only a warning kind and localized-safe message parameters. A billing-authorized projection may also include the schedule entry, invoice ID/number, status, and currency-safe amount.

The advisory warning appears:

- across all project views near the project header;
- in project task create/edit/detail drawers;
- after a project task is selected in time entry.

The warning does not disable controls or change server-side time-entry/task authorization. The client portal does not receive this internal work warning.

## Events, notifications, and workflows

Retain the existing `PROJECT_MILESTONE_READY` and `PROJECT_BUDGET_THRESHOLD_REACHED` events and register them in `system_event_catalog` with payload schemas and schema references.

Add:

- `PROJECT_BUDGET_EXCEEDED`: emitted after commit when cumulative persisted write-down changes from zero to positive. Payload includes project, invoice, cap, billed amount, attempted amount, and write-down. Email and internal notifications target the project manager/client account manager and are naturally deduped by the zero-to-positive transition.
- `PROJECT_BILLING_SCHEDULE_STATUS_CHANGED`: emitted after successful schedule transitions with entry, project, source status, destination status, actor, and invoice where applicable.
- `PROJECT_BILLING_CONFIG_CHANGED`: emitted after create/update/delete with project, actor, operation, and changed fields.
- `PROJECT_BILLING_PAYMENT_STATUS_CHANGED`: emitted when a flagged schedule entry's linked invoice moves between outstanding and satisfied/replacement-needed states. Payment reversal is covered as well as settlement.

All project-billing event types are added to the event schema registry, publisher allowlist, and workflow catalog. Events publish only after their source transaction commits.

## Permissions and portal behavior

The internal billed header remains gated by server-side `billing:read`; regression tests cover both the ambient header and billing view.

Extract the client portal's contact-to-client and `billing:read` checks into a shared internal helper. `getClientProjectBillingSummary` must pass that helper before querying billing configuration or schedules. A client lacking billing permission receives a structured permission result, and the component renders no summary. Project ownership and `show_billing` remain additional required gates.

The portal summary continues to expose only descriptions, public statuses, dates, totals, and currency. It does not expose invoice IDs, invoice numbers, line items, or internal payment warnings.

## Invoice drawer

Extract the contract screen's invoice-preview drawer content into a reusable billing component. It loads available templates, owns template selection, handles missing-template and structured-error states, and renders the existing `InvoicePreviewPanel` at the established wide drawer width.

Project schedule invoice buttons and successful standalone generation open this drawer without route navigation. Billing server actions remain the authority for invoice access.

## Currency and employee cost

Employee labor cost remains effective-dated:

1. select a user-specific rate valid on the time entry work date;
2. otherwise select the tenant default rate valid on that date;
3. otherwise report the time as uncosted.

Labor cost is worked hours multiplied by the hourly cost rate. Material cost prefers actual inventory COGS and falls back to catalog standard cost.

Cost rates are tenant reporting-currency amounts. Extend `ProjectBillingEconomics` with `cost_currency` and uncosted/mismatch metadata. The delivery-economics card formats labor/material costs in that currency. It calculates projected margin only when project revenue and cost are comparable; otherwise it explains why margin is unavailable.

Project and client-portal billing amounts use the configured project/client billing currency and ISO minor-unit rules. Remove hardcoded USD and `/ 100` assumptions. Add coverage for EUR and zero-decimal JPY. Mixed active contract currencies remain rejected, and no FX conversion is invented.

## Structured errors

Every public project-billing action returns either its success payload or the standard action/permission error result. Expected permission, validation, allocation, lifecycle, currency, and invoice-generation failures are converted at the server boundary. Unexpected failures are logged and return a safe generic action error.

All UI callers check the structured result before reading success fields. Unfinalize keeps its accounting-export guard and returns other known business failures in the same form. Finalized invoice handlers display `getErrorMessage(result)`; bulk failures identify the invoice that stopped the operation. A generic fallback is reserved for genuinely unexpected transport/runtime failures.

## Internationalization

- Replace non-English project-billing English fallbacks with translated values for supported real locales.
- Remove hardcoded `USD`, `en-US`, and `date-fns` presentation where locale formatters exist.
- Verify interpolation, status labels, warning variants, drawer errors, and event/notification text.
- Regenerate pseudo-locales and run locale validation.

## Testing

The implementation requires:

- real-DB migration tests for the new flag and Citus-safe lifecycle contract;
- atomic lifecycle/concurrency tests without the trigger;
- event schema, workflow catalog, post-commit publication, and overage-dedupe tests;
- payment-warning query and UI tests for draft/outstanding/partial/paid/void/reversal states;
- internal and client-portal permission tests;
- invoice drawer tests for links and generation success;
- EUR/JPY and economics currency-mismatch tests;
- structured action-result and unfinalize reason propagation tests;
- real-locale, pseudo-locale, and hardcoded-string validation;
- a final browser smoke pass over fixed-price, hard-cap T&M, portal permissions, payment warnings, and invoice preview.

## Definition of done

The work is complete when the plan features/tests are implemented, automated suites pass at repository baselines, a live smoke pass confirms the key money/permission journeys, and no fixture data or generated invoices remain in the test environment.
