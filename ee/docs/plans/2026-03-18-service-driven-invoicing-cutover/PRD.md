# PRD — Service-Driven Invoicing Cutover

- Slug: `service-driven-invoicing-cutover`
- Date: `2026-03-18`
- Status: Draft

## Summary

Finish the cutover from client-billing-cycle-driven recurring invoicing to service-period-driven recurring invoicing across the operator-facing billing workflow, public/internal API contracts, and recurring service-period lifecycle plumbing.

This plan is a finishing-cutover plan layered on top of the broader architecture in [2026-03-16-service-period-first-billing-and-cadence-ownership](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md). The engine can already consume selector-input execution windows and persisted recurring service periods, but the application still operates primarily on `client_billing_cycles` and `billing_cycle_id` assumptions in the places that matter most to billing operations:

- the `AutomaticInvoices` ready-to-invoice grid
- invoice preview and purchase-order overage checks
- invoiced history, reverse, and delete actions
- API preview/generation contracts
- billing-cycle-derived readers and filters
- operator workflows around service-period management and replenishment

The goal of this plan is to make “service-period-driven invoicing” true in practice, not only in the billing engine internals.

## Problem

The current codebase is in a split-brain state:

- recurring billing runtime can execute contract-cadence windows and selector-input invoice generation
- persisted `recurring_service_periods` can drive due selection in the engine
- contract cadence authoring is now writable

but the surrounding application still assumes that invoice-ready work is represented by `client_billing_cycles`.

That creates several concrete failures in product behavior:

- ready-to-invoice rows only exist for client billing cycles, so contract-cadence due windows are not first-class invoice targets in the normal billing screen
- preview and PO-overage analysis only accept `billing_cycle_id`, so contract-cadence execution windows do not have symmetric operator tooling
- invoiced-history and rollback/delete semantics are still anchored to client billing-cycle rows, which does not describe contract-cadence invoicing accurately
- public and internal API contracts still encode preview/generate requests as billing-cycle requests instead of due-window requests
- the codebase has almost no operator-facing read/write layer around `recurring_service_periods`, even though the engine depends on them

As a result, the system can technically invoice from service-driven cadence windows in selected code paths, but billing admins still cannot fully operate the product that way.

## Goals

- Make invoice-ready work visible and actionable from service-driven due windows, not only client billing cycles.
- Add a first-class due-work reader contract that can return both client-cadence and contract-cadence invoice targets.
- Move `AutomaticInvoices` ready, preview, generate, overage, and failure mapping flows onto execution-window identities and selector inputs.
- Add service-period-aware invoiced history so prior recurring invoices can be understood and managed without assuming a client billing-cycle row exists.
- Extend preview/generation API contracts to support selector-input execution windows in addition to compatibility billing-cycle bridges.
- Complete the application-facing lifecycle around `recurring_service_periods`:
  - generation/backfill
  - replenishment
  - billed linkage
  - reverse/delete repair
  - operator management permissions
- Ensure hourly and usage recurring obligations participate in service-driven invoicing windows by evaluating billable content inside the selected service period.
- Preserve compatibility for legacy client-cadence tenants and existing billing-cycle-backed invoices during the cutover.

## Non-goals

- Redesigning the broader recurring-billing architecture already covered by the March 16 service-period-first PRD.
- Rewriting historical invoices or backfilling historical invoice detail rows beyond necessary linkage/repair metadata.
- Replacing client billing schedules as a concept; they remain valid cadence sources and invoice-grouping constructs.
- Building a large standalone service-period admin application beyond what billing operations need to review and manage due recurring invoice work.
- Reworking manual invoice flows except where recurring preview/generation contract reuse is needed.
- Reworking accounting adapters beyond the recurring date-window metadata they consume.

## Users and Primary Flows

- Billing admin
  1. Opens Automatic Invoices and sees all due recurring invoice windows, regardless of whether they come from client cadence or contract cadence.
  2. Searches, filters, previews, selects, and generates invoices from those due windows.
  3. Sees PO-overage warnings, duplicate prevention, and failure messages keyed to the same service-driven window identity.
  4. Reviews invoiced recurring windows historically and can reverse/delete/repair them with correct service-period linkage behavior.

- Finance / billing ops
  1. Understands whether a ready or invoiced recurring row came from a client billing schedule or a contract anniversary cadence.
  2. Can tell what service period is being billed before invoice generation.
  3. Can safely operate mixed-cadence clients without leaving the normal billing UI.

- API/integration consumers
  1. Can preview or generate recurring invoices from either a compatibility billing-cycle bridge or an explicit recurring execution window.
  2. Can filter and interpret invoice data with service-period and execution-window metadata instead of relying only on `billing_cycle_id`.

## UX / UI Notes

- `AutomaticInvoices` must become a due-work UI, not a client-billing-cycle UI.
- Ready rows should expose:
  - client name
  - cadence source (`Client schedule` / `Contract anniversary`)
  - service period label
  - invoice window label
  - contract/line context when applicable
  - early/due state
  - PO-overage and duplicate state where relevant
- Selection and row actions must use a stable execution-window identity, not only `billing_cycle_id`.
- Preview from a row must work for both client-cadence and contract-cadence windows.
- Invoiced-history rows should preserve the operator’s mental model:
  - what service period was billed
  - what execution window produced it
  - what invoice was created
- Reverse/delete affordances must be explicit about whether they are affecting:
  - a client billing-cycle bridge invoice
  - a contract-cadence invoice backed only by recurring service-period linkage
- Minimal service-period management UX is in scope where needed to inspect future due windows, generation state, and repair/regeneration issues.

## Requirements

### Functional Requirements

1. Add a recurring due-work reader that returns invoice-ready execution windows from persisted recurring service periods and compatibility client billing-cycle sources.
2. The due-work reader must produce stable identities for:
   - row key
   - selection key
   - retry key
   - preview/generate input
3. `AutomaticInvoices` must list due recurring work using the due-work reader instead of `getAvailableBillingPeriods(...)`.
4. `AutomaticInvoices` preview must support selector-input execution windows for both cadence owners.
5. `AutomaticInvoices` batch generate must submit selector-input execution windows where no billing-cycle bridge exists.
6. PO-overage analysis must support selector-input execution windows, not only `billing_cycle_id`.
7. Failure reporting in UI and workflow events must map back to execution-window identities even when `billing_cycle_id` is absent.
8. Invoiced-history queries must be able to display recurring invoices produced from service-driven execution windows.
9. Reverse/delete flows must correctly repair recurring service-period linkage and lifecycle state for service-driven invoices.
10. API contracts for invoice preview and recurring generation must accept selector-input execution windows in addition to compatibility billing-cycle wrappers.
11. Service-period materialization must exist for all recurring families that can invoice on service-driven cadence, including hourly and usage obligation windows.
12. Hourly and usage billing must evaluate billable records inside the selected service period, not inside an unrelated client billing-cycle window.
13. Materialized recurring service periods must be replenished and regenerated reliably enough that due-work rows exist before billing ops needs them.
14. Billed recurring service periods must be linked back to invoice charge detail rows, and reverse/delete operations must be able to repair that linkage.
15. Permissions and UI states for viewing/managing recurring service periods must be wired into the billing experience where necessary.
16. Compatibility support for legacy client-billing-cycle-backed recurring invoices must remain intact during cutover.

### Non-functional Requirements

- Cutover must preserve existing client-cadence behavior for compatibility rows.
- Duplicate prevention must remain deterministic across client-cadence and contract-cadence recurring execution windows.
- Query contracts must be explicit about nullable `billing_cycle_id` and required execution-window identity.
- Operator-visible rows must be stable under pagination, filtering, and reruns.
- The cutover must be testable with DB-backed integration tests for:
  - due-work selection
  - preview/generate parity
  - service-period linkage repair
  - mixed client/contract cadence batches

## Data / API / Integrations

- Replace or complement `getAvailableBillingPeriods(...)` with a due-work reader over `recurring_service_periods` plus compatibility bridges for legacy billing-cycle rows.
- Extend invoice preview/generation actions and schemas to accept `IRecurringDueSelectionInput`.
- Extend invoice-service preview endpoints that currently require `billing_cycle_id`.
- Rework invoiced-history queries that currently join `client_billing_cycles` directly.
- Add query contracts for service-driven recurring invoice history and operator actions.
- Decide how much invoice list/filter API should expose:
  - `execution_window_kind`
  - `cadence_owner`
  - service period start/end
  - bridge `billing_cycle_id` where present
- Widen service-period physical/schema support as needed for hourly/usage charge-family or execution-window participation.

## Security / Permissions

- Respect existing `invoice.create`, `invoice.generate`, and `invoice.preview` permissions for recurring due-work operations.
- Wire existing recurring-service-period governance permissions into any new service-period review/manage actions:
  - `billing.recurring_service_periods.view`
  - `billing.recurring_service_periods.manage_future`
  - `billing.recurring_service_periods.regenerate`
  - `billing.recurring_service_periods.correct_history`
- Ensure contract-cadence rows do not bypass normal invoice authorization simply because they lack a `billing_cycle_id`.

## Observability

- Workflow/run events must distinguish `billing_cycle_window` and `contract_cadence_window`.
- Failures surfaced in UI should include execution-window identity for support/debugging.
- Service-period generation/replenishment should expose enough operational information to explain “why no due row exists.”

## Rollout / Migration

- This plan assumes the recurring engine and selector-input invoice generation path already exist.
- Compatibility wrappers around `billing_cycle_id` should remain until all operator-facing paths can consume selector-input windows.
- Migration work likely includes:
  - widening `recurring_service_periods` support for hourly/usage windows
  - adding read models / indexes for due-work and invoiced-history queries
  - backfilling service-period rows for active recurring obligations
  - repairing or linking existing billed recurring rows where needed for history and reverse/delete behavior
- Cleanup should only remove `client_billing_cycles` dependence from recurring invoicing surfaces after the service-period reader is proven in UI and tests.

## Open Questions

- Should `AutomaticInvoices` show one mixed table or separate grouped sections for client-cadence vs contract-cadence due work?
- For contract-cadence invoices without a `billing_cycle_id`, what is the exact operator action model for reverse/delete:
  - delete invoice only
  - delete invoice and reopen service period
  - archive/supersede the billed service-period linkage
- Should hourly and usage participation in service-driven invoicing widen the persisted `charge_family` enum, or should the materialized window remain family-agnostic and charge-family selection happen elsewhere?
- How much of invoice list/filter API should become execution-window-aware in the first cut vs follow-on cleanup?

## Remaining Work Backlog (2026-03-20)

The initial cutover slice is implemented, but the following items are still required to complete hard cleanup and post-drop alignment:

1. AutomaticInvoices grouped-candidate UX hardening:
   - preview should only be available for single-member candidates
   - grouped candidates must not silently preview only first member
   - contract metadata rendering should derive from member-level data and surface explicit missing-metadata warnings
   - cadence-source rendering should be exhaustive (no defaulting unknown values to client schedule)
2. Recurring run caller cleanup:
   - keep target mapping candidate-first end to end
   - ensure target pagination/totals semantics remain candidate-driven
3. Partial materialization safety:
   - block invoicing of partially materialized recurring windows
   - ensure due-work candidate grouping includes split keys used by real invoice partitioning
4. Legacy fallback-path cleanup:
   - remove legacy billing-window recurring generation entrypoints/callers
   - finish candidate-first assertion cleanup in recurring billing integration suites
5. Post-drop schema migration completion:
   - remove live `client_contract_lines` dependencies from `packages/clients` and `packages/client-portal`
   - remove template-contract fallback joins from live instantiated billing lookups
   - split template detail vs instantiated contract assignment query paths
   - stop runtime writes that backfill `template_contract_id` as live fallback state
6. Contract/type cleanup:
   - centralize paginated recurring due-work response types in `@alga-psa/types`
   - finalize `billingCycleId` semantics on recurring due-work rows (canonical removal vs explicit legacy metadata)
7. Hygiene guard expansion:
   - extend static post-drop checks to include `packages/client-portal` and `packages/clients`

## Acceptance Criteria (Definition of Done)

- Billing admins can see and generate all due recurring invoice work from `AutomaticInvoices`, including contract-cadence windows.
- Preview, PO-overage analysis, and recurring run execution all accept service-driven selector inputs.
- Invoiced recurring history accurately reflects service-driven windows and no longer depends exclusively on `client_billing_cycles`.
- Reverse/delete or repair operations behave correctly for service-driven recurring invoices and restore service-period linkage state.
- Hourly and usage recurring obligations bill content within the selected service period when cadence is service-driven.
- API contracts, schema validation, and workflow events reflect selector-input execution windows.
- Materialized recurring service periods are sufficiently generated/replenished that the invoicing UI reliably shows due work.
- Focused DB-backed integration coverage proves mixed client-cadence and contract-cadence recurring invoicing from selection through invoice persistence and history management.
