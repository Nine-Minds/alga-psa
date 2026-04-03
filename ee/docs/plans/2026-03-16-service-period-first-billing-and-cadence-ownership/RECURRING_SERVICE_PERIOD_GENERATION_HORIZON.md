# Recurring Service-Period Generation Horizon

## Purpose

`F235` defines the v1 horizon and replenishment policy for future persisted recurring service periods.

This is intentionally an operational policy checkpoint, not full materialization runtime:

- initial materialization and backfill need one target horizon to fill toward
- steady-state maintenance needs one low-water mark that triggers replenishment before future coverage runs out
- continuity rules must stay explicit so generation does not quietly create overlapping or gapped future ledgers

## Authoritative Helper Surface

The shared v1 policy now lives in:

- `shared/billingClients/recurringServicePeriodGenerationHorizon.ts`
  - `DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS`
  - `DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS`
  - `resolveRecurringServicePeriodGenerationHorizon(...)`
  - `findRecurringServicePeriodContinuityIssues(...)`
  - `assessRecurringServicePeriodGenerationCoverage(...)`

## V1 Horizon Policy

The first-cut horizon is deliberately short-range:

- target future coverage window: `180` days
- low-water replenishment threshold: `45` days

That means:

- initial materialization or backfill should keep generating future periods until the furthest persisted future `service_period_end` reaches or exceeds `asOf + 180 days`
- steady-state maintenance should replenish once the furthest persisted future `service_period_end` falls at or before `asOf + 45 days`
- the threshold must remain below the target horizon; the shared helper rejects an inverted policy

This stays within the v1 boundary already set in the PRD and appendix: keep enough future schedule for billing operations and review, but do not silently expand into years of speculative schedule projection.

## Whole-Period Overshoot Rule

Generation still operates on whole service periods, not arbitrary date truncation.

Because of that:

- the generator may overshoot the target horizon to the end of the last whole generated period
- that overshoot is acceptable in v1
- continuity is more important than cutting a period short only to hit an exact day count

An annual cadence line may therefore stop with one full future annual period even if that single period extends past the nominal `180`-day target.

## Continuity Rule

The horizon policy is only valid when future persisted periods stay continuous under the canonical half-open `[start, end)` model.

The shared helper treats these as blocking continuity issues:

- `gap`
  - a persisted future period starts after the previous period ended
- `overlap`
  - a persisted future period starts before the previous period ended

Continuity issues do not justify silent replenishment. They require repair or regeneration work so the future ledger remains explainable.

## Operational Meaning

`assessRecurringServicePeriodGenerationCoverage(...)` now answers the minimum scheduling questions needed before real generation code lands:

- what is the current target horizon end date?
- what is the current low-water replenishment date?
- does the tenant currently meet the target horizon?
- has coverage dropped low enough that replenishment should run now?
- are the already persisted future periods continuous, or do gaps/overlaps need repair first?

This is the baseline contract for the later generation and regeneration passes:

- `F236-F237` materialization
- `F238-F239` regeneration and override preservation
- `F244` backfill
- `F267` DB-backed validation

## Deliberate Non-Goals For F235

This checkpoint does not yet define:

- which job enqueues horizon maintenance
- tenant-specific horizon overrides
- charge-family-specific horizon tuning
- how replenishment persists rows or updates revisions

Those remain later implementation work once real materialization begins.
