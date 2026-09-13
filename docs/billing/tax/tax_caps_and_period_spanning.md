# Tax caps and period-spanning tax

This document describes the draft implementation of two additions to the tax
service. It records the behavior the code actually has, including the choices
made where the approved design left semantics open. Domain review is required
before treating any of this as production-ready.

## Tax caps

- `tax_rates.cap_amount` is a nullable `bigint` in the same unit as the net
  amount (the smallest currency unit used by invoices). `NULL` means uncapped;
  a stored `0` is a real cap that charges no tax.
- Caps are applied as `min(taxAmount, cap)` on the single-rate paths only:
  `calculateSimpleTax` (flat percentage) and `calculateThresholdBasedTax`
  (progressive brackets). Both are reached from the default-rate branch of
  `calculateTax` and `calculateTaxForPeriod`.
- The regional branch of `calculateTax`/`calculateTaxForPeriod` sums the
  percentages of every active rate in the region. It does not select
  `cap_amount` and is intentionally left uncapped, matching its existing
  single-date behavior.
- No UI reads or writes `cap_amount`. It can be set through the
  `addTaxRate`/`updateTaxRate` actions (which spread the full row) or directly
  in the database. The API tax-rate Zod schemas do not expose it.

## Period-spanning tax

`TaxService.calculateTaxForPeriod(clientId, netAmount, startDate, endDate,
regionCode?, is_taxable?, currencyCode?)` returns
`ITaxPeriodCalculationResult` (`taxAmount`, `taxRate`, `segments`).

- The period is half-open: `[startDate, endDate)`. The start day is charged,
  the end day is not.
- Dates are normalized to their UTC calendar day before arithmetic. This keeps
  a `date` column hydrated as local midnight and a `YYYY-MM-DD` string on the
  same day count.
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
  single-date `calculateTax` does.

### Gaps, invalid ranges, and missing rates

- An empty or reversed period (`end <= start`) throws
  `Tax period end date must be after start date`.
- On the regional path, a period that overlaps no active rate throws
  `ManualInvoiceError` with code `NO_TAX_RATE`.
- Days inside the period with no valid rate are returned as a segment with
  `taxAmount: 0` and `taxRate: 0`. The default-rate path only knows the
  client's one default rate, so a period extending past that rate's end is
  partly untaxed rather than rolling to a successor rate.
- A missing client throws; a tax-exempt client, a non-taxable charge, or a
  reverse-charge client returns `{ taxAmount: 0, taxRate: 0, segments: [] }`
  without resolving a rate. A client with no default rate also returns that
  zero result.

### Caps and progressive brackets across segments

- Caps apply per segment. Because each segment is a separate calculation, a
  two-segment period can charge up to `2 * cap_amount`. The alternative (a
  single cap across the whole period) is not implemented.
- Progressive brackets are evaluated per segment on that segment's prorated
  amount, so brackets reset at every rate boundary. A period that spans a rate
  change can therefore fall into a lower bracket on each side than the same
  total amount would if it were not split.

## Open questions for domain review

1. **Cap scope.** Should a cap be per calculation (current, per segment) or per
   period across all segments? The stored meaning currently says "per
   calculation".
2. **Cap currency/units.** `cap_amount` is assumed to be in the same unit as
   the net amount and the invoice currency. There is no per-currency cap and no
   validation that the cap is non-negative.
3. **Progressive thresholds across a split period.** Resetting brackets per
   segment is a guess. Real jurisdictions may want the brackets applied to the
   aggregate period amount instead.
4. **Gaps without a rate.** Silent zero tax for uncovered days may be wrong;
   some jurisdictions require the nearest effective rate or a hard failure.
5. **Regional path and caps.** A region can contain several rate rows; capping
   the summed result or capping each row's contribution is undefined. Neither
   is implemented.
6. **Rounding.** Per-segment `ceil` is deliberately conservative but may not
   match jurisdiction-specific rounding (e.g. round-half-up, per-invoice, or
   banker's rounding).

## Tests

- Unit: `packages/billing/tests/tax/taxService.calculateTax.test.ts`
  (flat-rate caps), `taxService.thresholdsAndComposite.test.ts` (progressive
  caps), `taxService.calculateTaxForPeriod.test.ts` (segmentation, proration,
  per-segment rounding, gaps, caps, invalid ranges, region/default paths).
- Server unit: `server/src/test/unit/taxService.test.ts` (cap clamping on the
  mocked default-rate path and period splitting).
- PostgreSQL: `packages/billing/src/services/taxService.rateSelection.db.test.ts`
  (persisted `cap_amount` through the create/update actions, cap read back as a
  string, region/tenant isolation, real rate-validity splitting).
