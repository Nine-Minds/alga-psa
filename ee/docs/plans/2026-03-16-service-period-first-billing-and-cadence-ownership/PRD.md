# PRD — Service-Period-First Billing and Explicit Cadence Ownership

- Slug: `service-period-first-billing-and-cadence-ownership`
- Date: `2026-03-16`
- Revised: `2026-03-17`
- Status: Draft

## Summary

Reshape recurring billing so canonical service periods become the primary runtime object for recurring contract-backed charges, and cadence ownership becomes an explicit choice instead of an emergent mix of client billing cycles, contract start dates, proration flags, and timing branches.

This is not a narrow billing-engine refactor. It is a system-wide recurring-billing normalization that touches:

- recurring charge generation
- invoice generation and invoice detail persistence
- credits, prepayment, negative invoice, and reconciliation flows
- pricing schedules, discounts, bucket/allowance logic, and tax date evaluation
- contract-line data model, APIs, repositories, and UI configuration
- template-authored recurring defaults
- client portal invoice/line displays
- reporting and accounting exports
- migration, rollout, validation, and cleanup

The implementation must be sequenced so risk comes down, not up:

1. inventory and parity first
2. canonical service-period primitives second
3. client-cadence parity cutover third
4. contract-cadence capability only after parity is proven
5. cleanup and deletion last

## Problem

Recurring billing currently derives truth from too many overlapping abstractions at once:

- client billing cycles generated from billing frequency and anchor settings
- contract assignment start/end dates overlaid on top of those cycles
- `billing_timing` branches that redefine service periods differently for advance vs arrears
- separate proration paths for fixed charges versus product/license charges
- bucket, credit, pricing-schedule, and discount logic that implicitly assumes specific timing semantics
- stored `billing_cycle_alignment` options that are surfaced widely but do not form one clear execution model

This produces a growing list of special cases:

- mid-cycle starts and ends are handled through bespoke proration and skip logic
- arrears vs advance needs separate service-period mapping paths
- fixed charges are timed differently from products and licenses
- invoice detail and export consumers receive service-period metadata from a partially implicit model
- UI guidance teaches users to compensate for engine behavior with proration settings instead of choosing an explicit cadence model

The result is operationally workable but architecturally muddy. The system behaves like “invoice on the client’s calendar, then repair exceptions,” rather than starting from a single recurring-billing model and letting invoice windows consume the result.

## Goals

- Make service periods the canonical runtime concept for recurring contract-backed charges.
- Materialize future recurring service periods as first-class records so they can be reviewed, edited, skipped, regenerated, and locked explicitly.
- Make invoice windows a grouping layer for due service periods instead of the source of service-period truth.
- Preserve existing client-cadence behavior as the default path for current tenants during the initial cutover.
- Make `advance` and `arrears` a due-position concept on top of the same service-period model.
- Introduce explicit cadence ownership so a recurring obligation can derive periods from either:
  - the client billing schedule
  - the contract/assignment anniversary
- Remove or retire timing concepts that become redundant once service periods are explicit, especially `billing_cycle_alignment`.
- Specify the entire blast radius at implementation depth, not just the billing-engine core.
- Sequence the work so implementation is easy to validate:
  - parity first
  - new option second
  - cleanup last

## Non-goals

- Revisiting template normalization work covered by `ee/docs/plans/2026-03-16-contract-template-normalization/`.
- Unifying time-entry or usage-event semantics into the same canonical service-period model in the first cut.
- Rewriting historical invoices or retroactively regenerating historical invoice detail records.
- Redesigning the invoice designer, invoice rendering AST, or paper invoice layout system except where recurring timing metadata must stay correct.
- Changing accounting exports beyond what is necessary to preserve correct service-period data.
- Adding observability or feature-flag infrastructure as a product goal beyond what is necessary for safe rollout and validation.

## Scope

### In scope

- recurring fixed contract-backed charges
- recurring product charges
- recurring license charges
- persisted recurring service-period records and their lifecycle
- user-visible review and editing of future recurring service periods
- recurring bucket/allowance timing where it depends on recurring period semantics
- invoice generation, recurring runs, invoice detail persistence, and billed-through behavior
- credit/prepayment/negative invoice flows when they consume recurring charge timing
- pricing schedules, discounts, tax date evaluation, and other recurring-timing dependencies
- contract line data model, APIs, repos, forms, wizards, templates, and portal/report/export consumers
- cadence-owner migration/defaulting and staged cleanup

### Explicitly out of first hard cut

- event-driven time-entry billing logic
- event-driven usage-record billing logic
- materials/non-recurring charges

## Users and Primary Flows

- Billing admin
  1. Configures recurring contract-backed charges.
  2. Chooses whether cadence follows the client billing schedule or the contract anniversary.
  3. Reviews predictable future service periods and edits them when the default generated schedule does not match the commercial agreement.
  4. Generates invoices from explicit due service periods without manually reasoning through mid-cycle exceptions.

- Finance / operations
  1. Generates invoices with service periods that match the commercial promise.
  2. Understands why a charge appears on a specific invoice from explicit service-period metadata.
  3. Can safely roll out the change because parity behavior and cutover validation are explicit.

- Account manager / sales ops
  1. Can explain to the client whether a recurring service bills on the client’s consolidated schedule or on the contract anniversary.
  2. Can predict first invoice behavior for mid-cycle starts without relying on hidden engine rules.

- End client
  1. Sees invoice detail periods that match either the client schedule or the signed agreement, depending on the chosen cadence owner.

## Architecture Thesis

The recurring-billing truth should be:

- a recurring obligation has one cadence owner
- that cadence owner generates service-period boundaries
- materialized service-period records represent those boundaries as editable future billing objects
- assignment activity windows intersect those boundaries
- due-position rules map service periods onto invoice windows
- invoice generation selects due materialized service periods for a billing run
- invoice details persist the canonical service-period metadata

Everything else should be a consequence of that truth.

This implies:

- `advance` and `arrears` do not define different service-period models
- proration is not a free-standing subsystem; it is partial service-period coverage
- invoice cycles and client billing cycles are grouping constructs, not the source of recurring service dates
- charge families should not each implement their own timing math
- user edits to future recurring periods have an explicit persistence surface rather than being encoded as hidden overrides on source rules

## System Surfaces In Scope

- Runtime engine
  - `packages/billing/src/lib/billing/billingEngine.ts`
  - recurring charge-family logic
  - bucket/pricing/discount/tax dependencies

- Billing schedule and cadence generation
  - `shared/billingClients/createBillingCycles.ts`
  - `packages/billing/src/lib/billing/createBillingCycles.ts`
  - anchor settings and client billing schedule actions/UI

- Invoice generation and persistence
  - `packages/billing/src/actions/invoiceGeneration.ts`
  - recurring billing run actions
  - invoice models/services/repositories
  - service-period materialization and regeneration jobs
  - invoice detail persistence and billed-through semantics

- Dependent billing flows
  - credits and reconciliation
  - prepayment and negative-invoice flows
  - purchase-order support
  - pricing schedules and discounts

- Data model and APIs
  - contract line and template line repositories/models/actions
  - server schemas/services/interfaces
  - shared/package types
  - migration/defaulting logic

- UI and downstream consumers
  - billing dashboard recurring configuration
  - contract wizard and template wizard
  - client billing schedule UI
  - client portal billing/invoice/line details
  - reporting and accounting exports

## Pass 0 Appendices

- `PASS0_RECURRING_TIMING_APPENDIX.md`
  - implementation-grade system-surface matrix
  - source-backed recurring timing inventory
  - out-of-scope compatibility matrix
  - parity matrix, harness contract, and fixture-builder contract
- `pass-0-source-inventory.json`
  - source-backed file inventory for `resolveServicePeriod`, `billing_cycle_alignment`, persisted service-period readers, and downstream recurring timing consumers

## Implementation Sequence

### Pass 0 — Recursive inventory and parity scaffolding

- Inventory every code path where recurring timing semantics live or leak:
  - runtime billing
  - invoice generation
  - invoice detail persistence
  - credits/prepayment/negative invoice flows
  - pricing schedules/discounts/tax date selection
  - repositories/models/schemas/interfaces
  - UI/configuration surfaces
  - exports/reports/portal consumers
- Build a parity matrix covering:
  - billing frequency
  - timing mode
  - mid-cycle start/end
  - pricing schedules/discounts
  - credits/prepayment
  - bucket/product/license variations
- Define what counts as acceptable parity drift and what blocks rollout.

### Pass 1 — Shared recurring timing domain

- Define canonical types and helpers for:
  - service periods
  - invoice windows
  - cadence owners
  - cadence boundary generators
  - activity-window intersection
  - due-position mapping
- Unify date semantics across:
  - client billing cycles
  - contract start/end
  - invoice windows
  - invoice detail service-period fields

### Pass 2 — Materialized service-period foundation

- Add persisted service-period records as the authoritative future-billing object for recurring obligations.
- Define generation horizon, status model, locking rules, regeneration behavior, and invoice linkage.
- Define which user edits are supported in v1:
  - boundary adjustment
  - skip/defer
  - split/merge if supported
- Define how source-rule changes regenerate future periods without corrupting user overrides or billed history.

### Pass 3 — Client-cadence parity engine

- Implement client-cadence service-period generation using existing anchor behavior.
- Keep all existing recurring records effectively on client cadence while materializing future periods under parity rules.
- Add comparison mode between legacy timing outputs and service-period-first outputs.
- Do not expose contract cadence yet.

### Pass 4 — Fixed recurring cutover

- Move fixed recurring charges onto canonical service periods.
- Remove or bypass:
  - `resolveServicePeriod`
  - arrears skip special casing
  - advance termination credit special casing
  - bespoke fixed-only proration calculations
- Preserve FMV allocation, pricing schedule overrides, tax behavior, PO metadata, and invoice detail behavior.

### Pass 5 — Dependent recurring surfaces

- Move recurring product and recurring license timing onto canonical service periods.
- Align bucket/allowance semantics where they depend on recurring period boundaries.
- Ensure discounts, pricing schedules, tax, and billed-through calculations continue to work under the new model.

### Pass 6 — Invoice selection and downstream billing flows

- Refactor invoice generation to select due service periods for a billing run.
- Define the schedulable identity for recurring billing runs once client cadence is no longer the only recurring clock.
- Define how due service periods become invoice candidates and what constraints force invoice splitting instead of grouping.
- Preserve invoice header semantics while invoice detail rows become more canonical.
- Validate:
  - automatic recurring runs
  - preview flows
  - duplicate prevention
  - negative invoices
  - credits/prepayment/reconciliation

### Pass 7 — Data model, APIs, and configuration surfaces

- Add cadence-owner persistence/defaulting.
- Update shared/server/package interfaces and schemas.
- Update repositories/actions/services/wizards/forms/templates.
- De-emphasize and stage removal of `billing_cycle_alignment`.

### Pass 8 — Contract cadence and mixed-cadence behavior

- Introduce contract-owned cadence after client-cadence parity is proven.
- Define:
  - monthly/quarterly/semi-annual/annual contract-anchored boundaries
  - first/final invoice behavior
  - mixed-cadence grouping rules
  - unsupported combinations and validation errors

### Pass 9 — Downstream consumers, cleanup, and rollout

- Update:
  - client portal billing views
  - reporting
  - accounting exports
  - docs/help text
- Remove dead timing branches and legacy timing configuration from live execution.
- Add post-cutover source and DB-backed validation.

## Detailed Requirements

### Inventory and parity requirements

- The plan must inventory all recurring timing logic across runtime, data model, UI, and downstream consumers.
- The plan must define a parity harness that can compare legacy and new recurring outputs under client cadence.
- The plan must define fixture matrices broad enough to catch hidden dependencies before contract cadence is introduced.

### Shared domain requirements

- The system must have a single recurring timing vocabulary:
  - cadence owner
  - service period
  - invoice window
  - due position
  - activity-window intersection
- The system must use one inclusive/exclusive date semantic model consistently.
- The system must make derived service periods testable without invoice side effects.

### Materialized service-period requirements

- Future recurring service periods must be persisted as first-class records before invoice generation consumes them.
- Materialized service periods must track enough metadata to support:
  - source recurring obligation
  - cadence owner
  - generated-versus-user-edited provenance
  - status and lock state
  - linkage to resulting invoice detail rows
- The system must define a generation horizon and regeneration rules for future materialized service periods.
- Billed or otherwise locked service periods must be immutable except through explicitly designed corrective flows.
- User edits to future service periods must be explicit operations, not hidden mutations of source cadence rules.
- The plan must define how source-rule changes affect:
  - unedited future periods
  - edited future periods
  - billed historical periods
- Materialized service periods must be queryable independently of invoice generation so UI and operational tooling can inspect future billing intent.

### Runtime engine requirements

- Fixed recurring, recurring product, and recurring license charges must consume the same canonical materialized service-period model.
- Mid-cycle starts and ends must be handled by activity-window intersection, not by duplicated proration logic.
- `advance` and `arrears` must map due service periods to invoice windows, not generate alternative service-period definitions.
- Runtime behavior for existing client-cadence tenants must remain unchanged during the parity phase.

### Dependent recurring behavior requirements

- Pricing schedules must keep the same override precedence under service-period-first billing.
- Discounts must keep the same applicability rules unless the PRD explicitly changes them.
- Tax calculation inputs must remain stable and explainable.
- Bucket/allowance behavior must be explicitly categorized:
  - unchanged
  - adapted to canonical service periods
  - deferred to follow-on work

### Invoice and billing-flow requirements

- Invoice generation must operate on due materialized recurring service periods rather than recomputing service periods ad hoc.
- Recurring billing runs must have an explicit schedulable identity and retry model that works for both client-owned cadence and contract-owned cadence.
- The plan must specify how due recurring work is grouped into invoice candidates and which constraints force invoice splits:
  - contract scope
  - purchase-order scope
  - cadence-owner scope
  - downstream export or tax constraints where relevant
- Invoice detail rows must persist canonical service-period metadata consistently.
- The system must define a stable projection contract between persisted `invoice_charge_details`, parent invoice charges, preview rows, API responses, invoice rendering adapters, and portal readers.
- Credit/prepayment/negative invoice/reconciliation flows must continue to function correctly when recurring line timing changes.
- The plan must explicitly define whether non-service financial artifacts carry canonical service periods, null periods, or separate financial-date semantics.
- Duplicate prevention and billed-through logic must remain correct.
- Billed-through and mutation guards must stop relying on invoice header period fields when detail-level service periods become authoritative.

### Read-model and post-persist lifecycle requirements

- Invoice readers must support both historical flat invoice rows and post-cutover invoices with canonical recurring detail rows.
- The plan must define how one invoice charge maps to one or many persisted detail periods without breaking existing consumer contracts.
- Recalculation, edit, rerender, and post-generation mutation flows must preserve canonical service-period truth instead of silently degrading back to header-based timing assumptions.
- Legacy preview, dashboard, and export readers must either adopt canonical detail semantics or explicitly document their flattening behavior.

### Data model and API requirements

- `cadence_owner` must live on `contract_lines` for v1 because recurring timing is line-scoped in live execution; existing rows default to `client` cadence until broader authoring and template surfaces are migrated.
- Materialized service-period records must have a clearly defined persistence model and API surface for reads, edits, regeneration, and invoice linkage.
- Existing recurring records must default safely to client cadence.
- API/schema/model/repository surfaces must expose cadence owner and deprecate `billing_cycle_alignment` without destabilizing rollout.
- Unsupported combinations must fail early with clear validation.

### Authoring-path and storage-reconciliation requirements

- The plan must specify recurrence semantics across every authoring path:
  - contract wizard
  - contract line dialog
  - custom line creation
  - preset creation and reuse
  - template-line authoring
  - template-to-contract cloning
- Recurrence fields must have one authoritative storage model across live lines, template lines, and any preset-backed create flows.
- Repository and model write paths must stop silently dropping or normalizing recurrence fields differently by code path.
- The plan must reconcile stale model or documentation references to dropped recurrence-related tables before implementation begins.

### UI and downstream-consumer requirements

- UI must describe cadence in business terms:
  - invoice on client billing schedule
  - invoice on contract anniversary
- UI/help text must stop teaching “proration as timing workaround.”
- UI must let billing staff inspect future materialized service periods and understand whether a period is generated, edited, skipped, locked, or billed.
- Client portal, reporting, and accounting exports must continue to present consistent service-period information.
- The plan must explicitly decide which downstream consumers continue to use invoice-header dates and which must pivot to canonical recurring service-period dates.
- Adapter-specific flattening rules must be defined where external systems cannot represent the full canonical service-period structure.

### Contract-cadence requirements

- Contract cadence must be deterministic for monthly, quarterly, semi-annual, and annual recurring obligations.
- Contract cadence owns invoice windows as well as service-period boundaries:
  - `advance` bills on the contract-owned window that matches the due service period
  - `arrears` bills on the next contract-owned window after the covered service period ends
- A contract-cadence line that starts in the middle of a client billing cycle must still take its first invoice timing from the contract anniversary window, not from the enclosing client billing cycle.
- A contract-cadence line that ends in the middle of a generated contract-owned period must settle that partial final coverage on the contract-owned due window implied by its timing mode.
- Mixed cadence due work groups by invoice-window identity first:
  - if client-cadence and contract-cadence due work land on the same `[start, end)` invoice window and no stricter split constraint applies, cadence owner alone does not force a separate invoice
  - if their due windows differ, they become separate invoice candidates even when selected by the same recurring run
- Mixed cadence ownership on the same client must have documented invoice grouping behavior.
- First/final invoice behavior for contract cadence must be explicit and testable.

### Cleanup requirements

- `billing_cycle_alignment` must become non-executing before it is removed.
- `resolveServicePeriod` and other dead timing branches must be removed only after parity and contract-cadence rollout are validated.
- Post-cutover validation must prove recurring timing now flows through canonical materialized service periods.

## Risks

- Hidden timing dependencies outside the billing engine can make parity appear complete while downstream behavior still drifts.
- Credit/prepayment/negative invoice flows may implicitly rely on invoice-detail timing metadata in ways not obvious from the engine.
- Mixed cadence ownership can create invoice grouping ambiguity unless product rules are explicit before implementation.
- Time/usage flows may share utility code or billed-through assumptions with recurring logic even if they remain out of scope.
- Removing `billing_cycle_alignment` too early can break staged rollout even if the final model no longer needs it.
- Historical readers, exports, and portal screens may appear stable while silently dropping canonical detail periods if the read-model contract is not cut over explicitly.
- Stale references to dropped or deprecated recurrence tables can make rollout assumptions look cleaner than the codebase actually is.
- Materialization and editability increase lifecycle complexity because regeneration, locking, and override preservation must stay coherent when source contracts change.

## Open Questions

- What exact service-period edit operations should v1 support:
  - boundary adjustment only
  - skip/defer
  - split/merge
- What exact bucket/allowance behaviors should join the first cut versus a follow-on?
- Should time and usage remain explicitly frozen out of scope after the recurring cutover, or should they become a separate follow-on plan immediately?

## Follow-on Boundary — Time And Usage Unification

This plan makes the boundary explicit:

- time-entry billing and usage-record billing stay on their event-driven truth sources for recurring v1
- they do not inherit materialized recurring service periods implicitly just because recurring contract-backed billing does
- a separate follow-on plan is required before time or usage can adopt canonical service-period or ledger semantics

That follow-on plan should not start until recurring v1 has already proven:

- persisted recurring service-period generation is stable
- regeneration and override-preservation rules are coherent
- due selection and invoice linkage work without falling back to invoice-header timing
- support and finance workflows can explain canonical recurring periods confidently

When that follow-on plan begins, it must define at implementation depth:

- whether time and usage get their own materialized period ledger or a projection onto the recurring ledger model
- how event timestamps map to service periods without corrupting event truth
- how billed-through, duplicate prevention, credits, and exports behave when event-driven and period-driven domains coexist
- which metrics, dashboards, and reconciliation readers pivot to canonical periods versus staying on financial or event dates

## Follow-on Boundary — Advanced Service-Period Ledger Extensions

Recurring v1 includes persisted future service periods, explicit editability, regeneration, and invoice linkage. It does not automatically include every ledger optimization or retention strategy that a larger-scale service-period system might eventually need.

The following remain explicit follow-on work unless v1 proves insufficient in production:

- long-range materialization horizons beyond the v1 operational window
- archival or cold-storage strategies for billed or superseded service-period records
- performance-oriented denormalization, read-side caches, or projection tables built specifically for large service-period ledgers
- bulk backfill, mass repair, or historical rehydration workflows beyond the v1 rollout and correction flows

That follow-on should not start unless recurring v1 demonstrates a concrete limit such as:

- generation or regeneration cost that cannot be kept within the v1 horizon policy
- read performance that materially harms billing operations, support workflows, or downstream consumers
- storage growth or retention requirements that make the first-cut ledger shape operationally unsafe

When that follow-on begins, it must define at implementation depth:

- the authoritative boundary between canonical service-period truth and any denormalized or archived projections
- retention, replay, and restore behavior for archived or compacted service-period records
- reconciliation guarantees so invoice linkage, provenance, and auditability survive any denormalization or archival step
- migration and rollback posture when tenants may temporarily have both canonical live records and derived ledger extensions

## Follow-on Boundary — Persisted Recurring Execution Records

Recurring v1 introduces explicit execution-window identity, selector inputs, and retry keys, but it does not automatically require a durable ledger of recurring run attempts or due-selection snapshots.

The following remain explicit follow-on work unless v1 proves they are operationally necessary:

- persisted recurring run records keyed by execution-window identity
- durable selection snapshots for every due-work batch
- operator-facing replay history beyond the existing job/audit surfaces
- recovery tooling that depends on replaying a stored execution ledger instead of recomputing due work from source truth

That follow-on should not start unless recurring v1 demonstrates a concrete gap such as:

- retry or replay debugging cannot be explained from existing job metadata plus canonical invoice/detail persistence
- support or finance workflows require durable proof of exactly which due selections were considered for a failed run
- contract-cadence execution produces operational ambiguity that transient logs and current job payloads cannot resolve safely

When that follow-on begins, it must define at implementation depth:

- the authoritative relationship between persisted execution records and canonical recurring service-period truth
- retention and repair rules for execution records that outlive transient jobs
- replay semantics when a stored execution record disagrees with current source recurrence rules
- rollback posture when some tenants have durable recurring execution records and others still rely on transient scheduler metadata

## Follow-on Boundary — Invoice-Schema Versioning

Recurring v1 keeps dual old-shape and new-shape invoice support additive so historical flat invoices and canonical detail-backed invoices can coexist. It does not automatically introduce a versioned invoice schema contract.

The following remain explicit follow-on work unless dual-shape support becomes long-lived enough to justify it:

- explicit invoice payload version markers for API or export consumers
- schema-negotiation rules between historical flat invoices and canonical detail-backed invoices
- consumer-specific version pinning for portal, export, reporting, or workflow payloads
- backfill or re-projection work whose only goal is to collapse dual-shape support into one versioned contract

That follow-on should not start unless recurring v1 demonstrates a concrete limit such as:

- dual-shape compatibility branches remaining in place long enough to create real maintenance or consumer-onboarding risk
- downstream integrations needing an explicit version handshake instead of documented additive fields
- reader rollback or coexistence rules becoming too implicit to govern safely without a versioned contract

When that follow-on begins, it must define at implementation depth:

- the authoritative version boundary between historical flat invoice payloads and canonical detail-backed invoice payloads
- whether versioning applies only at API boundaries or also to stored export, workflow, and audit projections
- migration and coexistence rules for tenants that still need both shapes during the transition
- rollback posture when some consumers understand only the new versioned shape and others still depend on additive dual-shape compatibility

## Acceptance Criteria (Definition of Done)

- The plan fully specifies recurring-billing changes across runtime, invoice generation, downstream consumers, data model, UI, reporting, exports, migration, and cleanup.
- The plan fully specifies service-period materialization, period editability, regeneration, locking, invoice linkage, and lifecycle enforcement.
- The plan fully specifies recurring-billing execution identity, invoice grouping and splitting rules, read-model projection contracts, authoring-path propagation, and deprecation cleanup.
- Recurring contract-backed charges use one canonical materialized service-period model rather than separate timing models per charge type.
- Existing client-cadence recurring billing behavior is preserved for migrated tenants before any new cadence choice is enabled.
- `advance` and `arrears` no longer redefine service periods; they only determine when a service period is invoiced.
- A recurring obligation can explicitly choose `client` or `contract` cadence ownership.
- A monthly contract-owned recurring obligation starting on the 8th generates 8th-anchored service periods predictably.
- Billing staff can inspect and explicitly edit future materialized service periods without changing billed history implicitly.
- Mixed cadence ownership follows documented invoice grouping rules and persists explainable service-period detail on invoices.
- Invoice readers, portal views, reports, and accounting exports either consume canonical recurring detail periods correctly or follow an explicitly documented flattening policy.
- `billing_cycle_alignment` is no longer part of live execution for migrated recurring paths.
- Obsolete timing/proration branches are removed from recurring fixed/product/license billing once parity is reached.
