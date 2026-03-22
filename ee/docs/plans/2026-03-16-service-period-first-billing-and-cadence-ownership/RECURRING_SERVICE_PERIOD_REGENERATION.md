# Recurring Service-Period Regeneration

## Purpose

`F238` and `F239` define the first regeneration algorithm for persisted future recurring service periods.

The v1 rule is intentionally conservative:

- untouched generated future rows may be refreshed when source recurrence rules change
- user-edited or repair-driven future rows must not be silently overwritten
- replaced untouched rows become `superseded`
- newly regenerated rows keep the logical slot identity by reusing the prior `periodKey` and incrementing `revision`

## Authoritative Helper Surface

The shared v1 regeneration helper now lives in:

- `shared/billingClients/regenerateRecurringServicePeriods.ts`
  - `regenerateRecurringServicePeriods(...)`

## Regeneration Rules

The helper applies the following slot-order policy to future active rows on one schedule:

1. Sort existing active rows and new candidate rows by service-period order.
2. Preserve override rows instead of overwriting them.
   Override rows are currently:
   - `provenance.kind = user_edited`
   - `provenance.kind = repair`
   - lifecycle states `edited`, `locked`, or `billed`
3. For untouched generated rows:
   - if the candidate row is equivalent, keep the existing row as-is
   - if the candidate row changed, write a new `regenerated` row that:
     - reuses `scheduleKey`
     - reuses `periodKey`
     - increments `revision`
     - points `supersedesRecordId` at the prior row
   - mark the prior row as `superseded`
4. If an untouched existing future row no longer has any candidate slot, supersede it.
5. If new candidate slots remain after existing future rows are exhausted, keep them as new generated rows.

## Override-Preservation Rule

The first-cut override rule is explicit:

- regeneration must not silently replace user-edited future rows
- regeneration must not silently replace repair rows
- candidate rows that would have occupied those preserved slots are discarded until a later explicit conflict-handling flow exists

This keeps v1 safe before the later conflict-resolution work in `F249`.

## Deliberate Non-Goals For F238/F239

This checkpoint does not yet define:

- operator-facing conflict queues when preserved overrides and new source rules diverge materially
- bulk conflict resolution
- per-field merge behavior between a user edit and a regenerated candidate

Those remain later follow-on work after the first preservation-safe regeneration path.
