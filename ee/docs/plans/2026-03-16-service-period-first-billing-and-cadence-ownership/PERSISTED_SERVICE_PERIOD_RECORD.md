# Persisted Service-Period Record

## Purpose

`F231` defines the authoritative logical record contract for materialized recurring service periods before the physical table/index work in `F232`, lifecycle-transition rules in `F233`, and deeper provenance semantics in `F234`.

This artifact is intentionally logical first:

- one record shape should govern shared types, API payloads, repository reads, and future migration work
- the database schema may flatten fields into columns later, but it should not invent a different domain vocabulary
- runtime and UI work should refer to the same record identity and boundary concepts instead of open-coding their own shape

## Authoritative Type Surface

The shared logical contract now lives in `packages/types/src/interfaces/recurringTiming.interfaces.ts` as:

- `IPersistedRecurringObligationRef`
- `IRecurringServicePeriodRecordProvenance`
- `IRecurringServicePeriodRecord`
- `RecurringServicePeriodLifecycleState`
- `RecurringServicePeriodProvenanceKind`

The persisted record is a ledger entry for one future or historical recurring service-period slot. It is not the same thing as the in-memory `IRecurringServicePeriod` runtime helper, even though it reuses the same `[start, end)` range semantics.

## Record Identity

| Field | Meaning |
| --- | --- |
| `recordId` | Immutable physical row identity for one persisted record version. |
| `scheduleKey` | Stable schedule identity for one recurring obligation plus cadence owner plus due position. Regeneration should preserve this key for the same obligation schedule. |
| `periodKey` | Stable logical slot identity for one service period on that schedule. Different revisions of the same logical period keep the same `periodKey`. |
| `revision` | Monotonic record revision for regenerated or user-edited replacements of the same logical period slot. |

The combination of `scheduleKey` plus `periodKey` must remain meaningful across regeneration and user edits. `recordId` is allowed to change when a new revision supersedes an older one.

## Obligation And Cadence Linkage

Every persisted record must carry:

- `sourceObligation.tenant`
- `sourceObligation.obligationId`
- `sourceObligation.obligationType`
- `sourceObligation.chargeFamily`
- `cadenceOwner`
- `duePosition`

This keeps the record line-scoped and charge-family-aware without forcing callers to recover recurrence truth indirectly from invoice rows or client billing cycles.

## Boundary Contract

The authoritative boundary payload is:

- `servicePeriod`
  - canonical `[start, end)` recurring coverage boundary
- `invoiceWindow`
  - canonical `[start, end)` due window that will eventually group due work into invoice candidates
- `activityWindow`
  - optional clipped activity boundary when the source obligation covers only part of the generated service period
- `timingMetadata`
  - additive anchor or generator metadata such as anniversary anchor date, boundary source, or generation notes

`servicePeriod`, `invoiceWindow`, and `activityWindow` all retain `semantics = half_open`. Physical storage may flatten these ranges into columns later, but the logical contract stays range-based.

## Provenance And Lifecycle

The persisted record must carry both `provenance` and `lifecycleState`.

`provenance.kind` is currently constrained to:

- `generated`
- `user_edited`
- `regenerated`
- `repair`

`provenance` also carries:

- `sourceRuleVersion`
- `reasonCode`
- `sourceRunKey`
- `supersedesRecordId`

`lifecycleState` is currently constrained to:

- `generated`
- `edited`
- `skipped`
- `locked`
- `billed`
- `superseded`
- `archived`

`F233` now defines transition legality in `RECURRING_SERVICE_PERIOD_LIFECYCLE.md`. `F234` will define when `reasonCode`, `sourceRunKey`, and `supersedesRecordId` are required versus optional.

## F232 Physical Schema Landing

`F232` lands the first physical table as `server/migrations/20260318120000_create_recurring_service_periods.cjs`.

The first physical table is `recurring_service_periods`, with the logical record contract flattened into columns for:

- record identity
  - `record_id`
  - `schedule_key`
  - `period_key`
  - `revision`
- obligation linkage and cadence
  - `obligation_id`
  - `obligation_type`
  - `charge_family`
  - `cadence_owner`
  - `due_position`
  - `lifecycle_state`
- boundaries
  - `service_period_start`
  - `service_period_end`
  - `invoice_window_start`
  - `invoice_window_end`
  - `activity_window_start`
  - `activity_window_end`
- provenance
  - `provenance_kind`
  - `source_rule_version`
  - `reason_code`
  - `source_run_key`
  - `supersedes_record_id`

The initial index and constraint posture is:

- primary key on `(tenant, record_id)`
- unique key on `(tenant, schedule_key, period_key, revision)`
- lookup index on `(tenant, schedule_key, service_period_start)`
- obligation-state scan index on `(tenant, obligation_id, lifecycle_state)`
- due-selection index on `(tenant, lifecycle_state, invoice_window_start, invoice_window_end)`
- check constraints for every current enum-like field plus boundary ordering and valid optional activity-window clipping

## Deliberate Non-Goals For F231

This checkpoint does not yet define:

- the physical database table, indexes, or foreign-key layout for persisted service-period records
- due-selection queries that read persisted rows instead of deriving periods on demand
- invoice linkage fields or join contracts to `invoice_charge_details`
- regeneration algorithms, edit operations, or conflict resolution rules
- UI read/write surfaces for listing or editing persisted records

Those concerns remain sequenced behind:

- `F232` for schema and integrity constraints
- `F233-F255` for lifecycle, provenance, regeneration, and edit semantics
- `F241-F267` for invoice linkage, due selection, runtime adoption, and DB-backed validation
