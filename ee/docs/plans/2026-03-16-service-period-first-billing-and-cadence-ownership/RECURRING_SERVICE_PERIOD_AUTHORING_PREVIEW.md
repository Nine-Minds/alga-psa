# Recurring Service-Period Authoring Preview

`F258` defines how future materialized service periods participate in authoring previews and explainers before a recurring line is saved.

## Preview Contract

The shared preview helper continues to live in:

- `packages/billing/src/components/billing-dashboard/contracts/recurringAuthoringPreview.ts`

It now carries:

- cadence-owner summary copy
- billing-timing summary copy
- first-invoice summary copy
- partial-period summary copy
- `materializedPeriodsHeading`
- `materializedPeriodsSummary`
- `materializedPeriods[]` with illustrative service-period and invoice-window labels

## Illustrative Materialized Periods

Pre-save previews cannot read persisted rows for an unsaved contract line, so the helper generates illustrative future periods from the same cadence materialization logic used later in runtime work:

- client-cadence previews use the client-cadence materialization helper
- contract-cadence previews use the contract-cadence materialization helper
- the preview rows are explanatory examples, not persisted ledger records

That keeps authoring previews aligned with the canonical service-period-first model without pretending unsaved work already exists in the ledger.

## Required Preview Surfaces

The first shared rule is that both draft-step and review-step explainers should be able to show:

- what cadence owner controls the future periods
- when invoices will post relative to those periods
- the first upcoming illustrative service periods
- the matching illustrative invoice windows

This makes future materialized periods visible before save instead of appearing only after contract creation.

## Deliberate Boundary

This checkpoint still does not define:

- tenant-specific live preview generation against saved billing schedules or contract dates
- persistence of preview snapshots
- preview/edit reconciliation once a user starts changing persisted periods after save

Those remain sequenced behind `F259-F266`.
