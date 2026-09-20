# Tax caps and period-spanning tax

This document describes the draft implementation of two additions to the tax
service. It records the behavior the code actually has, including the choices
made where the approved design left semantics open. Domain review is required
before treating any of this as production-ready.

## Tax caps

- `tax_rates.cap_amount` is a nullable `bigint` in the same unit as the net
  amount (the smallest currency unit used by invoices). `NULL` means uncapped;
  a stored `0` is a real cap that charges no tax on paths that apply the cap.
- A database check constraint (`tax_rates_cap_amount_check`) rejects negative
  caps, and `normalizeTaxCapAmount` validates every cap the service reads or
  the actions write: it must be a non-negative, finite, safely representable
  whole number. Numeric strings are accepted because PostgreSQL `bigint`
  hydrates as a string. Malformed or negative values throw instead of silently
  disabling the cap or producing negative tax.
- Caps apply on these rate calculation paths:
  - **Simple and progressive default-rate paths**: `min(taxAmount, cap)` on the
    rate's single calculation, as before.
  - **Single-date regional path**: each rate's contribution is capped at that
    rate's `cap_amount`, the capped contributions are summed, and the sum is
    ceiling-rounded once. When no cap binds (no cap configured, or every
    contribution is at or below its cap) the original
    `ceil(netAmount * combinedRate / 100)` expression is used unchanged, so
    uncapped results stay bit-identical; summing per-rate contributions in
    floating point would drift (325 at 1.1% + 2.9% lands on
    `13.000000000000002` and overcharges by a cent). When a cap does bind, the
    contributions are summed with exact rational arithmetic (BigInt
    numerator/denominator) rather than an epsilon.
  - **Period regional path**: the same rule applies within each segment, and
    each segment's day-share is computed exactly as a rational before capped
    contributions are summed, so a period crossing several rate intervals
    charges each interval's cap without proration drift.
- **Component-based composite calculations do not apply the row cap.** A
  composite row can still contribute to a regional calculation, where its row
  percentage and cap apply. There are no per-component caps. A zero row cap
  therefore does not promise zero tax from component-based calculations.
- Configure caps in **Billing > Tax Rates**. The add/edit dialog, table, and
  advanced details use the same amount and currency contract. See
  [Configure tax caps](configuring_tax_caps.md) for the administrator workflow.
- A newly set or changed cap requires an explicit supported
  `tax_rates.currency_code`. This existing nullable column restricts the entire
  rate to that invoice currency. The UI accepts major units; persistence and
  API schemas use minor units. No base currency is inferred and no exchange
  conversion occurs. Precision follows the selected currency, including zero-
  and three-decimal currencies.
- Older capped rows with NULL currency retain their calculation behavior. The
  UI identifies them as currency-unspecified minor units. Unrelated edits
  preserve them; assigning a currency requires explicit confirmation, and
  clearing remains available without currency resolution.
- `addTaxRate`/`updateTaxRate` validate the effective cap/currency pair. Omitted
  update fields preserve stored values; explicit cap NULL clears it. Read
  boundaries normalize PostgreSQL bigint strings without accepting fractional
  strings or unsafe values. The supported range ends at 9007199254740991 minor
  units, even though PostgreSQL bigint can store larger values.
- Public create, update, response, and advanced schemas expose `cap_amount`
  and `currency_code`. The tax-rates GET route returns tenant-scoped rate rows.
  It does not add public mutation endpoints. See the
  [API field contract](../../api/tax_rates.md).

## Period-spanning tax

`TaxService.calculateTaxForPeriod(clientId, netAmount, startDate, endDate,
regionCode?, is_taxable?, currencyCode?)` returns
`ITaxPeriodCalculationResult` (`taxAmount`, `taxRate`, `segments`).

- The period is half-open: `[startDate, endDate)`. The start day is charged,
  the end day is not.
- Dates are strictly validated and normalized to a `YYYY-MM-DD` calendar day
  before any query or arithmetic; the same normalized days feed the SQL overlap
  filters and segmentation. Supported inputs:
  - `YYYY-MM-DD` calendar days.
  - ISO 8601 timestamps (`YYYY-MM-DD`, optional `THH:mm[:ss[.sss]]`, optional
    `Z` or `±HH:mm`). The calendar day is the one the timestamp spells out in
    its own offset, not the UTC instant, so an offset never shifts the day.
    Time and offset components are validated (`+99:99`, `+24:00`, `+12:60`,
    `+1:00` are rejected; `+14:00`, `-12:00`, `Z` are accepted).
  - `Date` objects, interpreted by their local calendar components because
    PostgreSQL `date` columns hydrate as local midnight.
  - Invalid dates (`2026-02-30`), trailing garbage, and impossible times throw.
    Leap days are accepted; a non-leap February 29 is rejected.
  - Years below 100 are built with `setUTCFullYear` instead of `Date.UTC`, so
    `0026-01-01` stays year 26 in segmentation and matches the `YYYY-MM-DD`
    string used in the SQL filters rather than silently becoming 1926.
- Every rate `start_date`/`end_date` strictly inside the period splits it into
  constant-rate segments. A period inside one rate interval is a single
  segment.
- Each segment's `netAmount` is its day-share of the requested net amount and
  may be fractional. Tax is `Math.ceil`-rounded per segment, not once for the
  whole period, so two half-periods can round up to one cent more than the
  whole period would.
- The aggregate `taxAmount` is the sum of the segments; `taxRate` is
  `taxAmount / netAmount * 100`.
- Exemption, reverse charge, currency filtering, and the region/default
  precedence are evaluated once for the whole period, exactly as the
  single-date `calculateTax` does, and short-circuit before any coverage check.

### Coverage is mandatory

- Every taxable day must have an applicable rate. An uncovered interval throws
  `TAX_RATE_COVERAGE_GAP` naming the first uncovered `[start, end)` interval; a
  period that overlaps no rate at all (regional) or has no usable default rate
  throws `NO_TAX_RATE`.
- The default path knows only the client's single default rate. If the period
  extends past that rate's validity it fails rather than understating tax or
  guessing a successor rate from the region. A successor must come from a
  supported association; none exists today, so this is an error, not a lookup.
- An empty or reversed period (`end <= start`) throws.
- A tax-exempt client, a non-taxable charge, or a reverse-charge client still
  returns `{ taxAmount: 0, taxRate: 0, segments: [] }` without a coverage check.

### Caps and progressive brackets across segments

- On the default path the rate must cover the whole period, so there is one
  segment and the cap applies once.
- On the regional path caps are per rate per segment: each rate's unrounded
  contribution is capped before the segment sum is ceiled, and a period crossing
  capped rate boundaries charges each interval's cap.
- Progressive thresholds on the default path apply to the whole covered amount.
  If a future caller supplies a multi-segment default path, brackets would be
  evaluated per segment on that segment's prorated amount; today partial
  coverage fails first, so this cannot happen.

## Open questions for domain review

1. **Cap scope.** Caps are per rate per calculation/segment. Whether a
   jurisdiction intends a per-period cap across all rates and segments is not
   resolved.
2. **Legacy cap currency.** New or changed caps use an explicit rate currency.
   Older currency-unspecified caps still use each invoice's minor units until
   an administrator deliberately resolves or clears them. Their intended
   original currency cannot be inferred from the stored integer.
3. **Progressive thresholds across a split period.** Applying brackets to the
   whole covered default amount (current, single segment) versus resetting per
   segment is a guess for any future multi-segment default path.
4. **Coverage semantics.** Failing hard on a gap is deliberate; some
   jurisdictions may instead want the nearest effective rate or a zero-tax
   period. The default path deliberately does not infer successor rates.
5. **Regional cap interaction.** Capping each rate's contribution before
   summing preserves uncapped rounding, but jurisdictions that define a
   combined-rate cap (rather than per-rate caps) would need different behavior.
6. **Composite totals.** Component-based calculations do not apply the row
   cap. Capping their combined component total requires a separate decision;
   the configuration UI does not change this arithmetic.
7. **Rounding.** Per-segment `ceil` is deliberately conservative but may not
   match jurisdiction-specific rounding (e.g. round-half-up, per-invoice, or
   banker's rounding).

## Tests

- Unit: `packages/billing/tests/tax/taxService.calculateTax.test.ts`
  (flat-rate caps on default and regional paths, malformed/negative caps,
  string hydration), `taxService.thresholdsAndComposite.test.ts` (progressive
  caps and rejection), `taxService.calculateTaxForPeriod.test.ts` (segmentation,
  proration, per-segment rounding, coverage gaps, regional per-rate caps,
  strict date validation, timezone offsets, Date hydration).
- Server unit: `server/src/test/unit/taxService.test.ts` (cap clamping on the
  mocked default-rate path, coverage gap).
- PostgreSQL: `packages/billing/src/services/taxService.rateSelection.db.test.ts`
  (persisted `cap_amount` through the create/update actions, bigint string
  hydration, the non-negative constraint, action validation, single-date and
  period regional caps across a rate boundary, coverage gaps, region/tenant
  isolation, real rate-validity splitting).
