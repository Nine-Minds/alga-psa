# Recurring Service-Period Provenance

## Purpose

`F234` defines the authoritative provenance model for persisted recurring service-period records.

The goal is not just to label a row as "generated" or "edited". The persisted provenance payload must also explain:

- whether the current row still matches generated cadence rules or now diverges from them
- why the row exists in its current shape
- whether it replaced an earlier persisted record version
- whether a background materialization/regeneration run produced it or whether the change came from an explicit operator action

This keeps later edit, regeneration, repair, and support tooling work on one shared provenance vocabulary instead of ad hoc strings.

## Authoritative Type Surface

The shared provenance contract now lives in:

- `packages/types/src/interfaces/recurringTiming.interfaces.ts`
  - `RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES`
  - `GeneratedRecurringServicePeriodReasonCode`
  - `UserEditedRecurringServicePeriodReasonCode`
  - `RegeneratedRecurringServicePeriodReasonCode`
  - `RepairRecurringServicePeriodReasonCode`
  - `IRecurringServicePeriodRecordProvenance`
- `shared/billingClients/recurringServicePeriodProvenance.ts`
  - `isRecurringServicePeriodProvenanceReasonCode(...)`
  - `isRecurringServicePeriodProvenanceDivergent(...)`
  - `validateRecurringServicePeriodProvenance(...)`

The type is intentionally discriminated by `kind` so field requirements cannot drift silently.

## Provenance Kinds

| Kind | Meaning | Diverges from source cadence rules? |
| --- | --- | --- |
| `generated` | First materialized version produced directly from current source rules. | No |
| `user_edited` | Operator changed a future period explicitly and the new row supersedes the generated or previously edited row. | Yes |
| `regenerated` | System replaced a prior future row because source recurrence rules or cadence inputs changed. | Yes |
| `repair` | Administrative or integrity repair row used to correct a broken ledger state explicitly. | Usually yes; treat as exceptional. |

`isRecurringServicePeriodProvenanceDivergent(...)` is the v1 helper for this policy: every kind except `generated` represents a row that no longer reflects untouched rule-derived cadence output.

## Field Requirements By Kind

| Kind | `reasonCode` | `sourceRunKey` | `supersedesRecordId` |
| --- | --- | --- | --- |
| `generated` | Required. Must be one of the generated reason codes. | Required. Materialization should remain traceable to the generating run. | Must be null/absent. The first generated row does not supersede anything. |
| `user_edited` | Required. Must explain the operator-visible divergence. | Optional. A user edit may happen outside the background generation run path. | Required. An edit must point at the row it replaced. |
| `regenerated` | Required. Must explain which rule/input change forced replacement. | Required. Regeneration must stay traceable to the background run or explicit rebuild action. | Required. Regeneration replaces an earlier future row. |
| `repair` | Required. Must explain the repair class. | Optional. A repair may or may not be tied to a formal run. | Optional. Some repairs replace a prior row; others only correct metadata in place through a new revision. |

The shared validator enforces the same baseline literally:

- `Generated provenance requires sourceRunKey`
- `Generated provenance must not supersede an earlier record`
- `User-edited provenance requires supersedesRecordId`
- `Regenerated provenance requires sourceRunKey`
- `Regenerated provenance requires supersedesRecordId`

## Reason-Code Catalog

### `generated`

- `initial_materialization`
- `backfill_materialization`

### `user_edited`

- `boundary_adjustment`
- `invoice_window_adjustment`
- `activity_window_adjustment`
- `skip`
- `defer`

### `regenerated`

- `source_rule_changed`
- `billing_schedule_changed`
- `cadence_owner_changed`
- `activity_window_changed`
- `backfill_realignment`

### `repair`

- `integrity_repair`
- `invoice_linkage_repair`
- `admin_correction`

These reason codes are deliberately narrow. They explain why a persisted row differs without yet committing v1 to richer audit payloads or UI verb taxonomies that belong in later edit and permissions work.

## Operational Meaning

The persisted provenance contract now answers the first support-grade questions directly:

- Did the row come from untouched rule output or from a later override?
- If it changed, was the change user-authored, regeneration-driven, or repair-driven?
- What class of change happened?
- Which prior row did this one supersede?
- Which run key generated or regenerated it when a background process was involved?

This is the minimum v1 provenance needed before:

- `F238-F239` regeneration behavior
- `F245-F249` edit and conflict semantics
- `F253` permissions/audit requirements
- `F268` operator runbook work

## Deliberate Non-Goals For F234

This checkpoint does not yet define:

- actor identity, approval metadata, or full audit payloads for user edits
- the UI verbs or form contracts for editing future periods
- repair authorization policy
- whether repairs are always new revisions versus metadata corrections on existing rows

Those remain sequenced behind the later edit, permission, and runbook passes.
