# Recurring Service-Period Post-Materialization Lifecycle

`F263` defines how billed-through, renewal, and replacement logic behave once recurring due work is anchored to persisted service periods instead of ad hoc period derivation.

## Billed-Through Rule

Billed-through now follows canonical linked service-period coverage:

- linked billed periods advance billed-through boundaries
- unlinked future rows do not count as billed-through just because they exist in the ledger
- ordinary mutation guards should prefer linked detail-backed coverage over invoice-header period fields

## Renewal And Replacement Rule

Renewal, replacement, or end-date changes must evaluate both:

- billed historical periods that are already linked and immutable
- future persisted periods that may still be regenerated, superseded, or explicitly edited

That keeps renewal and replacement decisions from relying on older header-only timing assumptions.

## Future-Row Adjustment Boundary

When a line is renewed, replaced, shortened, or otherwise mutated:

- billed linked periods remain historical truth
- eligible future generated rows may regenerate or be superseded
- preserved edited/locked future rows continue to follow the existing preservation and conflict rules

## Deliberate Boundary

This checkpoint still does not define:

- DB-backed mutation guards for every lifecycle operation
- historical invoice replay or rewrite during renewal
- support tooling that auto-merges replacement rows with prior edited future periods

Those remain sequenced behind `F267-F270`.
