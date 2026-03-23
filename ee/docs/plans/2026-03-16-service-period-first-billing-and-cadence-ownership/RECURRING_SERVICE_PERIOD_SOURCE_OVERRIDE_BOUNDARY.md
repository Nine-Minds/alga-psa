# Recurring Service-Period Source Versus Override Boundary

`F255` defines the cut line between source recurrence rules and explicit materialized service-period overrides.

## Authority Boundary Contract

The shared boundary contract now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts`
  - `IRecurringServicePeriodAuthorityBoundary`
- `shared/billingClients/recurringServicePeriodAuthorityBoundary.ts`
  - `getRecurringServicePeriodAuthorityBoundary(...)`
  - `listRecurringServicePeriodAuthorityBoundaries()`

The contract keeps one queryable answer for any subject:

- is this subject owned by source recurrence rules?
- is it an explicit materialized override?
- or is it persisted ledger state that changes only through corrective history flows?

## Source-Rule Subjects

The following remain source recurrence rules:

- `cadence_owner`
- `billing_frequency`
- `due_position`
- `activity_window`

These subjects:

- use `authorityLayer = source_rule`
- change through `changeChannel = edit_source_rule`
- affect future materialized rows through `futureEffect = regenerate_unedited_future`

That means authors change them by editing the source contract or billing schedule, not by editing one future service-period row.

## Materialized Override Subjects

The following are explicit materialized overrides on future rows:

- `service_period_boundary`
- `invoice_window_boundary`
- `skip_disposition`
- `defer_disposition`

These subjects:

- use `authorityLayer = materialized_override`
- change through `changeChannel = edit_materialized_period`
- create a new persisted revision with `futureEffect = supersede_current_revision`

That is the core v1 product distinction:

- source-rule changes regenerate future untouched schedule output
- row-level edits supersede one future row revision without redefining the source cadence model

## Ledger-State Subjects

The following are persisted ledger state, not ordinary source or override inputs:

- `lifecycle_state`
- `invoice_linkage`
- `provenance`

These subjects:

- use `authorityLayer = ledger_state`
- change through `changeChannel = corrective_flow`
- stay on `futureEffect = corrective_only`

This keeps billed-history lineage, repair work, and audit metadata out of everyday source-edit and schedule-edit semantics.

## Practical Product Rule

When a user asks "why did this invoice move?" the answer should fall into exactly one bucket:

- source-rule change: the obligation itself changed, so future untouched periods regenerated
- materialized override: billing staff explicitly edited, skipped, or deferred one future period
- corrective history flow: support or finance repaired billed-history linkage or archived ledger state

That prevents the system from hiding explicit future edits inside source-rule mutations or hiding billed-history correction inside ordinary schedule editing.

## Deliberate Boundary

This checkpoint does not yet define:

- client-facing wording for every authority subject in later dashboard or portal views
- automatic trigger wiring from every authoring surface into regeneration jobs
- repair tooling beyond the already-defined corrective-flow vocabulary

Those remain sequenced behind `F256-F266`.
