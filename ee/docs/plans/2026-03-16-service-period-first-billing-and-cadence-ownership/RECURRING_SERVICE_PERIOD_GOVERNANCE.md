# Recurring Service-Period Governance

`F253` defines the shared permission and audit-policy contract for viewing and mutating persisted recurring service periods before concrete controllers and dashboard actions land.

## Governance Contract

The shared governance helper now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts` as `IRecurringServicePeriodGovernanceRequirement`
- `shared/billingClients/recurringServicePeriodGovernance.ts` as `getRecurringServicePeriodGovernanceRequirement(...)`

The v1 governance actions are:

- `view`
- `edit_boundaries`
- `skip`
- `defer`
- `regenerate`
- `invoice_linkage_repair`
- `archive`

Each governance requirement returns:

- `action`
- `permissionKey`
- `auditEvent`
- `auditRequired`
- `allowed`
- `reason`

## Permission Keys

The first permission-key contract is intentionally narrow:

- `billing.recurring_service_periods.view`
- `billing.recurring_service_periods.manage_future`
- `billing.recurring_service_periods.regenerate`
- `billing.recurring_service_periods.correct_history`

The shared helper keeps `view` separate from mutation and correction work so future UI/API layers can gate inspection independently from edits.

## Audit Requirements

The first audit-event contract is also explicit:

- `view` -> `recurring_service_period.viewed` with `auditRequired = false`
- `edit_boundaries` -> `recurring_service_period.boundary_adjusted`
- `skip` -> `recurring_service_period.skipped`
- `defer` -> `recurring_service_period.deferred`
- `regenerate` -> `recurring_service_period.regenerated`
- `invoice_linkage_repair` -> `recurring_service_period.invoice_linkage_repaired`
- `archive` -> `recurring_service_period.archived`

All mutating or corrective operations require audit metadata even when the current lifecycle state still blocks the mutation itself.

## Lifecycle-Aware Decisions

The governance helper reuses the existing mutation policy:

- generated, edited, and skipped rows allow normal future-edit operations
- locked and billed rows reject edit, skip, defer, and regenerate
- locked and billed rows still allow `invoice_linkage_repair` and `archive`
- superseded and archived rows are historical and reject further mutation

That keeps permission/audit requirements and lifecycle legality on one shared contract instead of splitting them across later controllers.

## Deliberate Boundary

This checkpoint still does not define:

- real role-to-permission assignment storage
- audit-log payload schemas or actor-identity field names
- controller-level enforcement or database writes for those audit events
- tenant-specific overrides for who may inspect billed or archived rows

Those remain sequenced behind `F254-F259`.
