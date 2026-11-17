# Scratchpad — One tax engine for quotes and invoices

Plan written 2026-11-16 from a code read of main at 88c634d5b5. Split out of the quote accept-and-pay plan
(`ee/docs/plans/2026-11-16-quote-accept-and-pay`, ticket alga-2026-0002958), which no longer needs it as a
prerequisite because its acceptance invoice copies quote tax and recomputes nothing.

## Decisions

- **`TaxService` is the reference.** Where the copies differ, the copies change.
- **The engine lives in `shared/billingClients/`.** `crmWorkerDal.ts` is under `shared/workflow` and cannot import
  `packages/billing`; `shared/billingClients/taxSettings.ts` already holds tax code both sides use.
- **Move the arithmetic, do not rewrite it.** The invoice results must not change, and the existing tests are the
  proof.
- **Unresolved is a result, not an exception.** The engine reports it; `TaxService` turns it into `NO_TAX_RATE`
  for invoice callers, and quote callers record it per line.
- **Not flagged.**

## Code map (main @ 88c634d5b5)

### `TaxService` (`packages/billing/src/services/taxService.ts`, 855 lines)

- `calculateTax` :234. Exempt and non-taxable return 0; reverse charge :263 returns 0.
  - Region path :269-333: sums the region's active rates, caps each rate's contribution
    (`regionalTaxAmount`, `normalizeTaxCapAmount`), raises `NO_TAX_RATE` when the region has no rate (:296).
  - Default path :335-395: the client's default rate association. No association, or an inactive rate, returns
    0 (same as the copies). Then `calculateCompositeTax` :633 or `calculateSimpleTax` :658.
- `calculateTaxForPeriod` :434: rate changes inside a period; `NO_TAX_RATE` at :508, :568, :595. Invoice-only.
- Composite :633: a compound component is taxed on net + tax so far; a non-compound one on net.
- Brackets :678: each bracket against the original base, then `applyCap`.
- `getClientTaxSettings` :756 inserts defaults when none exist (`createDefaultTaxSettings` :781).
- `createTenantKnex` is called in every method, including private helpers, and in `ClientTaxSettings` model
  calls. That is the import the worker cannot take.
- Constructed in: `invoiceGeneration.ts`, `manualInvoiceActions.ts`, `hourBlockActions.ts`,
  `salesOrderInvoicingActions.ts`, `billingEngine.ts`, `taxAfterDiscounts.ts`, `prepaidBlockFollowOnInvoice.ts`,
  `taxRateActions.ts`, `taxSettingsActions.ts`, `taxSourceActions.ts`, `FinancialService.ts`,
  `InvoiceService.ts`, `ee/server/src/lib/extensions/invoicingHostApi.ts`.

### Quote copy (`packages/billing/src/services/quoteCalculationService.ts`, 505 lines)

- `calculateThresholdBasedTax` :84 (shrinking remainder).
- Holiday helper :110, `calculateComponentTax` :126.
- `calculateTaxWithConnection` :138. Region path :169-187 never reads `cap_amount` and returns 0 for no rates.
  Composite :223-241 grows `taxableAmount` after a compound component and uses it for every later component.
- `resolveQuoteRowTaxes` :288 is the caller; it applies discount shares before tax. Keep that.
- `resolveQuoteItemTaxesIfIncluded` feeds the public view's live optional-item preview
  (`publicQuoteView.ts:153-164`). The public fingerprint covers per-row tax, so a tax change between render and
  submit returns `changed`.

### Worker copy (`shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts`)

- Brackets :200-220, composite :340-352, simple rate :372-376, `recalculateQuoteFinancials` :379.
- `LEVERAGE: pattern quote-recalc-dup` at :456.
- Other duplication in the same file, out of scope: `quote-expire-on-read` :598, `quote-item-dal-dup` :695,
  `quote-update-dal` :916, `quote-to-contract-conversion` :1350, `quote-convert-tax-source` :1602.

### Worker import guard

- `services/workflow-worker/scripts/validate-runtime-imports.mjs`, tightened in commit `e77488432b`
  ("keep worker runtime graph worker-safe"), which also created the copies.

### Related

- `getEffectiveTaxSourceForClient` (`shared/billingClients/taxSettings.ts:94`).
- Quote conversion copies line `tax_amount` onto the invoice and never recalculates
  (`quoteConversionService.ts`, invoice path from :1066).
- Tax cap configuration plan: `ee/docs/plans/2026-09-17-tax-rate-cap-configuration`.
- Board card "Security: Restrict tax configuration and client billing helper actions…" touches tax
  configuration actions, not the calculation.

## Risks and gotchas

- **Something may rely on the insert-on-read.** A client created before default tax settings were provisioned at
  creation gets its row the first time tax is calculated. After this change it gets defaults in memory and no
  row. Check what reads `client_tax_settings` directly and expects a row.
- **Billing profiles.** `client_tax_settings` is keyed per profile. The copies read by client only and take
  whichever row comes first. Moving quotes to the engine changes which row a multi-profile client's quote reads;
  confirm which profile a quote should use (the client's default, unless quotes carry a profile).
- **Rounding.** All three use `Math.ceil` per calculation, and the region path without a binding cap keeps the
  combined-rate expression, so the common case is byte-identical. Verify with the parity test, not by reading.
- **Citus.** Additive column, constant default. Never use `now()` in `CASE`/`COALESCE`.

## Before release

- Count tenants with any `tax_rates.cap_amount`, any `tax_rate_thresholds` row, or any composite rate, and how
  many open quotes they have. Record the counts here without identifiers.

## Commands

- Plan validation: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-11-16-quote-tax-engine-unification`
- Worker import guard: `node services/workflow-worker/scripts/validate-runtime-imports.mjs`
