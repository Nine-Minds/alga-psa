# PRD — Recurring Invoicing Hard Cutover

- Slug: `recurring-invoicing-hard-cutover`
- Date: `2026-03-18`
- Status: Draft

## Summary

Finish the recurring-billing cutover by removing the remaining bridge assumptions that still treat `billing_cycle_id` and `client_billing_cycles` as the primary substrate for recurring invoice execution.

This plan is narrower than [2026-03-16-service-period-first-billing-and-cadence-ownership](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-16-service-period-first-billing-and-cadence-ownership/PRD.md), but stricter than [2026-03-18-service-driven-invoicing-cutover](/Users/roberisaacs/alga-psa.worktrees/feature/client-owned-contracts-simplification/ee/docs/plans/2026-03-18-service-driven-invoicing-cutover/PRD.md). It assumes the system already has:

- `cadence_owner`
- persisted `recurring_service_periods`
- selector-input recurring execution
- recurring invoice linkage back to service-period rows

The remaining problem is that the application still carries a large compatibility layer that allows recurring work to pretend it is billing-cycle-driven. That layer adds complexity, hides real data issues, and creates product ambiguity.

The target end state is:

- recurring due work comes only from `recurring_service_periods`
- recurring execution identity is service-period / execution-window based only
- recurring preview/generate/run/history/reversal do not require or infer truth from `billing_cycle_id`
- `client_billing_cycles` remain valid client cadence records, but only as source rules for `cadence_owner = client` and as optional historical metadata

## Problem

The codebase is in an uncomfortable middle state:

- the billing engine can already operate on canonical recurring execution windows
- recurring service periods can already be materialized and linked to invoice detail rows
- the UI and API can already represent some bridge-less recurring invoices

but many surrounding behaviors still preserve the old recurring model:

- due-work readers synthesize compatibility rows from `client_billing_cycles`
- missing service-period materialization is treated as a fallback path instead of a repairable failure
- duplicate prevention, reruns, and invoice identity still prefer `billing_cycle_id`
- recurring run orchestration still accepts cycle IDs as the operational handle
- history and reversal still model recurring invoice behavior as billing-cycle operations
- API contracts still make `billing_cycle_id` a first-class recurring request shape
- invoice reads still infer recurring semantics from `invoices.billing_cycle_id`
- accounting export and some invoice-linkage paths still preserve mixed canonical/fallback recurring provenance
- some business logic still treats `billing_cycle_id = null` as a proxy for unrelated invoice classes such as prepayments

This imposes a real complexity tax:

- more branching
- more migration-only tolerance in steady-state code
- more room for silent misclassification
- more operator confusion
- more tests spent preserving replaced behaviors

## Goals

- Make recurring service periods the only source of ready recurring invoice work.
- Remove recurring runtime dependence on `billing_cycle_id`.
- Remove recurring compatibility fallbacks that synthesize or tolerate client-cycle-based recurring work after service-period cutover.
- Keep `client_billing_cycles` only for legitimate client cadence administration, source-rule generation, and optional read-side historical context.
- Make recurring preview/generate/run/history/reverse/delete uniformly keyed by execution-window or service-period identity.
- Remove mixed-schema guards for recurring service-period structures.
- Remove recurring compatibility DTOs and request contracts whose only purpose is to preserve the billing-cycle bridge.
- Reclassify invoice kinds using explicit fields instead of null/non-null `billing_cycle_id`.
- Document the final recurring mental model clearly enough that future code does not regress.

## Non-goals

- Removing client billing schedules from the product.
- Removing `client_billing_cycles` as a table if it is still needed for client cadence management or non-recurring/client-schedule operations.
- Rewriting historical invoice records beyond what is necessary for consistent read models.
- Redesigning the broader cadence-ownership model or service-period materialization model.
- Removing billing-cycle-based APIs that are legitimately about client billing schedule administration rather than recurring invoice execution.
- Reworking manual invoice flows except where they are misclassified by the recurring bridge assumptions.

## Core Invariant

Recurring invoicing must obey this invariant:

1. A recurring obligation has a cadence owner.
2. The cadence owner and source rules generate persisted recurring service periods.
3. Ready recurring work is the set of due recurring service-period records.
4. Recurring invoice preview and generation operate on execution-window/service-period identity only.
5. Billed recurring invoices are understood historically from linked recurring service-period records and canonical recurring detail periods.
6. `billing_cycle_id` is never required to decide what recurring work exists, whether it is duplicate, how it should be previewed, how it should be generated, or how it should be reversed.

## Legitimate Concepts To Keep

These concepts remain valid:

- client billing schedule configuration
- client cadence anchors and previews
- client cadence as the source rule when `cadence_owner = client`
- optional invoice header metadata indicating a client-cycle bridge existed
- historical read-side enrichment by billing cycle where helpful

These concepts must stop driving recurring semantics:

- `billing_cycle_id` as recurring execution identity
- `client_billing_cycles` as the universal recurring due-work substrate
- compatibility rows that fabricate recurring work from billing cycles
- schema guards that hide missing recurring service-period structures
- history/reversal APIs framed as “billing cycle” operations for recurring invoices

## Users and Primary Flows

- Billing admin
  1. Opens recurring invoicing and sees due work sourced directly from recurring service periods.
  2. Previews and generates recurring invoices from execution-window/service-period identity.
  3. Reverses or deletes recurring invoices through service-period linkage repair, not through billing-cycle semantics.

- Finance / operations
  1. Understands recurring invoice history from canonical service periods.
  2. Does not need to know whether a billing-cycle bridge existed to reason about recurring work.
  3. Sees materialization failures as repairable service-period issues, not fallback-ready invoice rows.

- Developer / maintainer
  1. Reads one recurring model instead of a canonical model plus compatibility branch.
  2. Can change recurring runtime behavior without auditing for legacy billing-cycle fallback paths.

## UX / UI Notes

- `AutomaticInvoices` should be a recurring service-period execution surface.
- Client cadence rows for recurring work should appear only because they are materialized recurring service periods whose cadence owner is `client`, not because a `client_billing_cycles` row exists.
- Recurring invoice history should stop being presented as “invoiced billing cycles.”
- Reverse/delete affordances should describe service-period linkage and invoice effects directly.
- Operator-facing service-period gaps should become explicit errors or repair actions, not compatibility rows.
- Authoring UI may still default `cadence_owner` to `client` if that is the product choice, but that must be an explicit UX default, not a runtime fallback.

## System Surfaces In Scope

- Billing dashboard recurring UI
  - `AutomaticInvoices`
  - recurring history views
  - recurring service-period review/manage surfaces

- Billing actions
  - due-work readers
  - recurring run selection/orchestration
  - invoice preview/generation
  - reversal/delete flows
  - invoice modification / invoice kind logic

- Runtime / engine / linkage
  - billing engine recurring selection
  - invoice charge/detail linkage back to recurring service periods
  - duplicate prevention
  - billed-through and rerun logic
  - bucket recurring period resolution

- API / shared contracts
  - invoice schemas/controllers/services
  - shared recurring timing and invoice interfaces
  - financial schemas that still expose recurring billing-cycle request shapes

- Read models / exports
  - invoice queries
  - invoice service history/list/detail projections
  - accounting export recurring period provenance

- Migrations / cleanup
  - recurring-service-period required schema assumptions
  - possible retirement/deprecation path for `invoices.billing_cycle_id` as recurring runtime data

## Functional Requirements

1. The recurring due-work reader must load due rows only from `recurring_service_periods`.
2. Client-cadence recurring rows must be representable without a required `billing_cycle_id`.
3. Missing recurring service-period materialization must be treated as a failure/repair state, not a compatibility invoice row.
4. Mixed-schema guards for missing recurring service-period tables/columns must be removed from recurring invoice paths.
5. Recurring execution identity must be expressible without `billingCycleId`.
6. Client-cadence execution identity must be derived from canonical schedule/window/service-period identity, not a cycle UUID.
7. Recurring run target selection must operate on canonical due-work rows only.
8. Recurring job payloads/handlers must accept canonical recurring execution identity only.
9. Recurring preview must accept canonical selector input only.
10. Recurring generate must accept canonical selector input only.
11. Compatibility request wrappers that preserve `billing_cycle_id` as a recurring API option must be removed from recurring-facing contracts.
12. Duplicate prevention for recurring invoices must use canonical execution-window/service-period identity and linked rows, not `invoices.billing_cycle_id`.
13. Invoice insertion for recurring work must not require or derive a billing-cycle bridge.
14. Recurring invoice-linkage repair must not branch on whether the invoice header has `billing_cycle_id`.
15. Billed recurring detail rows must link back to recurring service-period records using canonical identity only.
16. Recurring history queries must be invoice/service-period based, not billing-cycle based.
17. Recurring reversal/delete operations must repair recurring service-period linkage and lifecycle state without treating billing cycles as the primary object.
18. Any recurring action naming or UI copy that still frames the object as a billing cycle must be updated.
19. Recurring invoice kind classification must not use null/non-null `billing_cycle_id` as a proxy for prepayment or non-recurring behavior.
20. Invoice list/read logic must stop inferring “recurring” from `invoices.billing_cycle_id`.
21. Recurring invoice DTOs must stop carrying bridge-only recurring fields as first-class semantics.
22. Canonical recurring detail periods must be the recurring read model; fallback recurring projection layers should be removed where they only preserve bridge logic.
23. Accounting export must use canonical recurring detail/service-period data only for recurring invoices.
24. Bucket recurring period resolution must align with canonical recurring service periods instead of preferring `client_billing_cycles`.
25. Client billing schedule changes must regenerate future recurring service periods rather than relying on future billing-cycle row mutation to define recurring work.
26. Client billing schedule APIs and UI that are not about recurring execution may remain.
27. The final recurring architecture must be documented clearly enough that future code does not reintroduce the bridge model.

## Non-functional Requirements

- The cutover should simplify, not merely relocate, compatibility branches.
- Errors that were previously hidden by compatibility fallbacks should fail explicitly and diagnostically.
- Historical invoices remain readable even if their bridge metadata is retained only as optional context.
- Query and type contracts should make recurring identity obvious and difficult to misuse.
- Test coverage must prove that client-cadence recurring execution still works after bridge removal.

## Data / API / Integrations

- Recurring API request contracts should standardize on canonical selector input.
- `billing_cycle_id` may remain in invoice headers and read models only as optional historical/client-context metadata.
- Shared interfaces should separate:
  - client billing schedule models
  - recurring execution identity
  - recurring history/detail metadata
- Accounting export should treat canonical recurring detail periods as the only recurring period source.
- Migration/cleanup may need to deprecate or eventually drop `invoices.billing_cycle_id` from recurring-specific logic even if the column remains temporarily for history.

## Rollout / Migration

This is a hard-cutover plan, not a coexistence plan.

Expected sequence:

1. Remove bridge assumptions from contracts and helpers first.
2. Cut due-work, recurring runs, preview, and generation to canonical identity only.
3. Rework history, reversal/delete, and read models.
4. Remove compatibility fallbacks and mixed-schema guards.
5. Clean up DTOs, exports, authoring compatibility shims, and invoice-kind misuse.
6. Validate that client-cadence recurring execution still works entirely through service periods.

The plan should identify every place where a temporary bridge must either:

- remain only as passive metadata
- or be removed entirely

## Risks

- Client-cadence recurring behavior may still rely on hidden `billing_cycle_id` assumptions in duplicate detection or rerun logic.
- Historical recurring invoices may have incomplete canonical linkage and need read-side fallback during cleanup.
- Some non-recurring flows may currently piggyback on `billing_cycle_id` nullability and need an explicit invoice-kind model before recurring cleanup lands.
- Accounting export and bucket logic may have more legacy cycle assumptions than the main invoicing UI.

## Open Questions

- Should `invoices.billing_cycle_id` remain as passive historical metadata indefinitely, or should there be a later physical removal plan?
- For history reads, how much fallback to incomplete historical recurring linkage is acceptable if it no longer shapes live recurring behavior?
- Should explicit invoice kind/type be introduced as a dedicated field now, or can prepayment/misc recurring misclassification be corrected with existing fields?

## Acceptance Criteria

- Ready recurring work is sourced only from `recurring_service_periods`.
- Recurring preview/generate/run flows accept only canonical recurring selector input.
- Recurring client-cadence execution still works without requiring `billing_cycle_id`.
- Recurring duplicate detection, linkage, and rerun logic are canonical and bridge-free.
- Recurring history, reverse, and delete operations are no longer modeled as billing-cycle operations.
- Recurring read models and exports derive recurring semantics from canonical service-period/detail data rather than `billing_cycle_id`.
- Mixed-schema guards and compatibility fallback rows are gone from recurring invoice paths.
- The remaining role of `client_billing_cycles` is clearly limited to cadence management/source rules and optional historical context.
