# Recurring Service-Period Charge Families

`F261` defines how fixed, product, and license recurring charge families map onto persisted service-period records without splitting into family-specific lifecycle models.

## Shared Ledger Rule

All recurring contract-backed charge families use the same persisted service-period record shape:

- one `scheduleKey`
- one `periodKey`
- one lifecycle-state model
- one provenance model
- one invoice-linkage model

Charge families may still differ in amount sourcing, catalog lookup, quantity logic, or tax inputs, but they do not get separate timing ledgers.

## Charge-Family Mapping

The first family mapping is:

- fixed recurring -> persisted periods drive fixed service coverage and invoice-window timing
- recurring product -> persisted periods drive catalog/contract price application for the covered period
- recurring license -> persisted periods drive quantity and price selection for the covered period

That keeps timing ownership and lifecycle semantics canonical even when commercial pricing logic still differs by family.

## Deliberate Boundary

This checkpoint still does not define:

- family-specific bulk-repair tooling
- a separate lifecycle state for bucket, product, or license-only exceptions
- event-driven time or usage migration onto the same ledger

Those remain sequenced behind `F267-F270`.
