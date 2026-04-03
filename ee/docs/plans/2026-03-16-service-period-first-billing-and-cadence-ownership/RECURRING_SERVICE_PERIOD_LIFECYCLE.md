# Recurring Service-Period Lifecycle

## Purpose

`F233` defines the first explicit lifecycle model for persisted recurring service-period records created in `F231-F232`.

This checkpoint defines:

- what each lifecycle state means
- which transitions are allowed now
- which states are terminal for v1

This checkpoint does not yet define edit operations, regeneration conflict handling, invoice linkage, or corrective flows. Those remain sequenced behind `F238-F254`.

## State Meanings

| State | Meaning |
| --- | --- |
| `generated` | A future period created directly from source recurrence rules with no user override yet applied. |
| `edited` | A future period whose boundaries or scheduling semantics differ intentionally from the generated default. |
| `skipped` | A future period that remains on the ledger for auditability but is intentionally excluded from billing selection. |
| `locked` | A period whose boundaries are frozen for an upcoming billing action or operational review and should not be changed by normal authoring paths. |
| `billed` | A period that has already been consumed by invoice linkage and is immutable in normal v1 flows. |
| `superseded` | A period revision that has been replaced by a newer record for the same logical period slot. |
| `archived` | A period retained only for history, audit, or storage-management purposes and no longer participates in live operational flows. |

## Allowed Transitions

The v1 lifecycle contract is intentionally conservative:

- `generated -> edited | skipped | locked | billed | superseded | archived`
- `edited -> skipped | locked | billed | superseded | archived`
- `skipped -> edited | locked | superseded | archived`
- `locked -> billed | superseded | archived`
- `billed -> archived`
- `superseded -> archived`
- `archived ->` no further transitions

## Terminal States

The v1 terminal states are:

- `billed`
- `superseded`
- `archived`

`locked` is not terminal. It is intentionally a pre-billing freeze state that still permits lifecycle advancement into `billed`, `superseded`, or `archived`.

## Lifecycle Invariants

- `billed` periods are immutable in normal v1 flows. Later corrective flows must create explicit follow-on behavior instead of silently mutating billed records in place.
- `superseded` periods remain queryable for provenance but are no longer eligible for normal due selection.
- `skipped` periods remain visible on the ledger; skip is not the same thing as deletion.
- `archived` is a storage and audit state, not a billing state.
- transitions that are not explicitly listed above are invalid for v1 and must fail fast rather than being interpreted implicitly by callers.

## Authoritative Runtime Contract

The shared lifecycle transition contract now lives in:

- `shared/billingClients/recurringServicePeriodLifecycle.ts`

That module exports:

- `RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS`
- `RECURRING_SERVICE_PERIOD_TERMINAL_STATES`
- `canTransitionRecurringServicePeriodState(...)`
- `isRecurringServicePeriodStateTerminal(...)`

Future regeneration, editing, skip/defer, and billing-linkage flows should consume that shared transition contract rather than open-coding state rules locally.
