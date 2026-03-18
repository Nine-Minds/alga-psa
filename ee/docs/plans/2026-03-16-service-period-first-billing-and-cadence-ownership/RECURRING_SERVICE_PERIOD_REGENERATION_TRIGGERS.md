# Recurring Service-Period Regeneration Triggers

`F254` defines when source-side edits must trigger future persisted service-period regeneration.

## Trigger Classification Contract

The shared trigger contract now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts`
  - `IRecurringServicePeriodRegenerationTriggerInput`
  - `IRecurringServicePeriodRegenerationDecision`
- `shared/billingClients/recurringServicePeriodRegenerationTriggers.ts`
  - `resolveRecurringServicePeriodRegenerationDecision(...)`

The contract answers one narrow question:

- does this source-side edit require regeneration of future materialized periods?
- if yes, what reason code and scope should later repositories or jobs use?

## Trigger Families

### Contract-Line Edits

Contract-line edits trigger regeneration only when they change recurrence-shaping fields such as:

- `billing_frequency`
- `billing_timing`
- `start_date`
- `end_date`
- `service_start_date`
- `service_end_date`

Those changes rebuild future candidate service periods for the affected obligation with:

- `triggerKind = contract_line_edit`
- `regenerationReasonCode = source_rule_changed`
- `scope = obligation_schedule_only`

Pure pricing edits do not regenerate persisted periods. They change future billing amounts, not future service-period boundaries or due-window mapping.

### Contract-Assignment Edits

Contract-assignment edits trigger regeneration when they change activity-window clipping fields such as:

- `assignment_start_date`
- `assignment_end_date`
- `service_start_date`
- `service_end_date`

Those changes rebuild future candidate coverage with:

- `triggerKind = contract_assignment_edit`
- `regenerationReasonCode = activity_window_changed`
- `scope = obligation_schedule_only`

### Cadence-Owner Changes

Cadence-owner changes are a special contract-line trigger.

They do not merely refresh one existing schedule. They replace future schedule identity:

- `triggerKind = cadence_owner_change`
- `regenerationReasonCode = cadence_owner_changed`
- `scope = replace_schedule_identity`

Operationally this means:

- supersede untouched future rows on the prior schedule key
- materialize future rows on the new cadence-owner schedule key
- preserve edited, locked, and billed rows under the existing override and immutability rules

### Billing-Schedule Changes

Billing-schedule edits trigger regeneration only for client-cadence obligations that depend on that client billing schedule.

The first v1 trigger fields are:

- `billing_frequency`
- `billing_day_of_month`
- `billing_month`
- `billing_anchor_date`
- `billing_cycle_anchor`
- `next_billing_date`

Those changes use:

- `triggerKind = billing_schedule_change`
- `regenerationReasonCode = billing_schedule_changed`
- `scope = client_cadence_dependents`

Contract-cadence obligations remain out of scope for this trigger because their invoice windows are contract-anniversary-owned rather than client-schedule-owned.

## Safety Invariants

Every positive regeneration trigger still carries the same safety posture:

- preserve user-edited future overrides
- preserve billed history
- leave conflict resolution to the explicit later conflict path when regenerated candidates diverge from preserved overrides

This keeps trigger detection aligned with the existing `F238-F249` regeneration and conflict rules instead of creating a second mutation path.

## Deliberate Boundary

This checkpoint does not yet wire live repositories, jobs, or controllers to invoke regeneration automatically.

It defines:

- the authoritative reason-code and scope classification
- the boundary between regeneration-required edits and amount-only edits
- the special schedule-replacement rule for cadence-owner changes

Live trigger wiring and DB-backed regeneration flow remain sequenced behind `F255-F259`.
