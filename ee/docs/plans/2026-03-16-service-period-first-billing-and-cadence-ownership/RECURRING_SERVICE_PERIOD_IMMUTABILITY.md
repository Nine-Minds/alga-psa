# Recurring Service-Period Immutability

## Purpose

`F240` defines the first mutation-guard policy for persisted recurring service-period records once they become locked or billed.

The v1 rule is intentionally strict:

- future unlocked rows may still be edited, skipped, deferred, or regenerated through normal flows
- locked or billed rows are immutable in place
- only explicitly designed corrective flows remain available once a row is locked or billed

## Authoritative Helper Surface

The shared v1 mutation guard now lives in:

- `shared/billingClients/recurringServicePeriodMutations.ts`
  - `RECURRING_SERVICE_PERIOD_MUTATION_OPERATIONS`
  - `evaluateRecurringServicePeriodMutationPermission(...)`

## Allowed Operations By State

### `generated`, `edited`, `skipped`

Normal future mutations are still allowed:

- `edit_boundaries`
- `skip`
- `defer`
- `regenerate`
- `archive`

`invoice_linkage_repair` is not valid yet because the row has not reached the linked locked/billed stage.

### `locked`, `billed`

These rows are immutable except for explicitly allowed corrective flows:

- `invoice_linkage_repair`
- `archive`

They must reject:

- `edit_boundaries`
- `skip`
- `defer`
- `regenerate`

### `superseded`, `archived`

These rows are historical only. No further mutation is allowed.

## Corrective-Flow Boundary

The only corrective flow named in v1 is `invoice_linkage_repair`.

That means:

- once `F241` lands invoice-detail linkage on persisted rows, repair tooling may correct bad linkage without reopening ordinary scheduling edits
- the existence of a corrective flow does not make billed rows generally editable again
- billing support and finance tooling must treat billed coverage boundaries as audit history, not as mutable schedule drafts

## Deliberate Non-Goals For F240

This checkpoint does not yet define:

- the persistence columns for invoice linkage
- operator UX for corrective flows
- whether archive is soft-delete, cold storage, or another later retention mechanism

Those remain later persistence and operational work.
