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

`F233` will define transition legality between those states. `F234` will define when `reasonCode`, `sourceRunKey`, and `supersedesRecordId` are required versus optional.

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
