# Recurring Service-Period Parity Comparison

`F243` defines how staged rollout compares legacy derived recurring timing outputs to the persisted recurring service-period schedule.

This comparison is schedule parity, not invoice parity:

- it compares recurring service periods plus their due invoice windows
- it ignores persisted-record-only metadata such as provenance, revision ids, and invoice linkage
- it exists to prove that materialized schedules still match legacy client-cadence behavior before runtime cutover

## Normalized Identity

Parity comparison normalizes both sides onto the same identity:

- `scheduleKey`
- `periodKey`

The canonical helpers live in `shared/billingClients/recurringServicePeriodKeys.ts`.

Derived service periods build those keys from:

- `tenant`
- source obligation type / id
- cadence owner
- due position
- canonical `[servicePeriod.start, servicePeriod.end)` bounds

Persisted rows use the stored `scheduleKey` and `periodKey` directly.

## Drift Types

`shared/billingClients/recurringServicePeriodParity.ts` reports three explicit drift kinds:

- `missing_persisted_period`
- `unexpected_persisted_period`
- `invoice_window_mismatch`

Those are the schedule-level rollout questions that matter before the runtime cutover:

- did materialization miss a service period the legacy engine still derives?
- did materialization create a service period the legacy engine would not derive?
- did both sides agree on the service period but disagree on when it becomes due?

## Comparison Scope

The default comparison scope includes active schedule rows only:

- `generated`
- `edited`
- `locked`
- `billed`

`superseded` and `archived` rows are excluded from default parity checks because they represent historical or replaced schedule state, not the active schedule being validated for rollout.

## Deliberate Boundary

This checkpoint still does not:

- backfill historical billed coverage into persisted rows
- switch live invoice generation to the persisted ledger
- compare full invoice outputs or tax/discount subtotals at the persisted-schedule layer

Those remain sequenced behind `F244` and `F256`.
