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


## Repair round 3 (PR #4473 review)

### Finding 1: editor tax failure is visible

`QuoteForm.tsx` reads `draftTax.error`. On a rejected call, a permission error or a message error, the header
(`#quote-form-header-total-error`, inline `text-destructive` text with `role="alert"`) and the sidebar
(`#quote-form-sidebar-total-error`, standard destructive `Alert`) say the figures are not current, and the total,
subtotal, discount and tax show the "—" placeholder instead of the stale figures. The error clears on the next
successful result. A superseded response never reaches `setState` (request-id guard), so it cannot raise the error.
Copy: `quoteForm.header.totalsError` / `quoteForm.sidebar.totalsError` in `msp/quotes.json` (all locales; xx/yy
regenerated). Tests: `useQuoteDraftTax.test.tsx` (reject, permission, message, stale), `QuoteForm.test.tsx`.

### Finding 2: `client_tax_settings` reader inventory

What the old insert-on-read did: `TaxService.getClientTaxSettings` called `createDefaultTaxSettings` when the model
returned null, i.e. `initializeClientDefaultTax`: default billing profile, the settings row **and** the tenant-default
client-wide rate association (`client_tax_rates`, `is_default`). The association is what made the default-rate path
(no region) tax a client at all. So "no row" could change invoice results, not only leave a row missing.

Decision: the engine stays write-free. `calculateTaxForAmount` / `calculateTaxForPeriod` take an optional
`provisionMissingSettings` callback, called only when the profile has no row and only after the exemption and
taxability checks (the exact point the old code provisioned). `TaxService.calculateTax` /
`calculateTaxForPeriod` pass `createDefaultTaxSettings`; quotes pass nothing and read defaults in memory.
`TaxService.isReverseChargeApplicable` provisions as before.

| Reader (file: function) | With no row | Action |
| --- | --- | --- |
| `shared/billingClients/taxEngine.ts`: `readClientTaxSettings`, `findClientTaxSettingsRow` | Default settings in memory; no writes | Kept write-free. Added `findClientTaxSettingsRow` and the `provisionMissingSettings` seam. |
| `packages/billing/src/services/taxService.ts`: `calculateTax`, `calculateTaxForPeriod`, `isReverseChargeApplicable` | Before: engine read defaults, so a client with no default rate association was taxed 0 (single date) or hit `NO_TAX_RATE` (period) | **Fixed at the reader**: provisions via `createDefaultTaxSettings` exactly as before. Invoice results unchanged. |
| `packages/billing/src/lib/billing/billingEngine.ts`: tax-identity load (~l.1066-1100) | Already provisions per profile in its load phase when tax would be read | Already handled. No change. |
| `packages/billing/src/actions/invoiceGeneration.ts`: `createInvoiceFromBillingResult` (~l.4031) | Calls `ensureDefaultTaxSettings` when the client has no default region | Already handled. No change. |
| `packages/billing/src/actions/taxSettingsActions.ts`: `getClientTaxSettings` | Returns null | The settings forms call `createDefaultTaxSettings` on null. Already handled. |
| `packages/billing/src/models/clientTaxSettings.ts`: `ClientTaxSettings.get` | Returns null (it still calls `ensureClientDefaultBillingProfile`, a profile write that predates the branch). No non-test callers in `src`. | Left alone. |
| `packages/billing/src/actions/taxSourceActions.ts` and `shared/billingClients/taxSettings.ts`: tax source | `?.tax_source_override` on a missing row falls back to the tenant default | Already handles a missing row. |
| `packages/billing/src/actions/billingAndTax.ts` (two `cts` left joins) | `tax_source` is null, same as a null override | Already handles a missing row. |
| `ee/server/src/lib/billing/simulator/readOnlyTaxPorts.ts` | `Boolean(settings?.is_reverse_charge_applicable)` is false | Already handles a missing row (read-only by design). |
| `ee/temporal-workflows/src/db/product-upgrade-operations.ts` | Creates missing rows during upgrade and reports clients still missing | Already provisions. |
| `packages/clients/src/actions/clientActions.ts`, `packages/clients/src/lib/clientMergePlan.ts`, `server/src/lib/api/services/ClientService.ts`, `shared/workflow/.../businessOperations/clients.ts`, tenant deletion/test utils | Delete or move rows; zero rows is a no-op | Already handles a missing row. |
| Client creation (`shared/models/clientCreation.ts` `createClientWithDefaults`, used by `clientActions`, `ClientService`, workflows, imports, Entra/Datto) | Calls `initializeClientDefaultTax` in the client transaction | Already provisions explicitly. Only legacy clients lack a row. |

Fixture: `taxService.rateSelection.db.test.ts` is **reverted to its original** (no `initializeClientDefaultTax` call);
it passes unchanged. The `modelBackedTenantDb` unit-test helper remains (it only routes the engine's reads to the
existing model stubs). Test: `billingInvoiceGeneration_tax.test.ts` "taxes a client that has no client_tax_settings row
exactly as before" (engine writes nothing and taxes 0 with no default; TaxService provisions and taxes at 10%; manual
invoice end to end). `quoteTaxEngine.test.ts` T003 now also asserts TaxService provisions (plan T003 text adjusted).

### Finding 3: public quote "changed" path

What was missing: the public fingerprint covers per-row engine tax, but the stored `quotes.subtotal/discount_total/
tax/total_amount` were never compared with the engine. A page rendered after a rate correction fingerprints
identically at submit, so a sent quote with stale stored totals could be accepted at the stale figure.

Fix: `reconcileQuoteTotalsWithEngine` (`quoteCalculationService.ts`) recomputes through `resolveQuoteTaxes`; if the
stored figures differ it persists the corrected ones (`recalculateQuoteFinancials`) and returns true.
`decideInTransaction` (`quoteLinkDecisionService.ts`) calls it after input validation, before the fingerprint check,
and returns `{ status: 'changed' }`; the write commits with that transaction. So "changed" comes once, then the
reloaded page (fresh fingerprint over corrected figures) submits successfully.

For the review step's fixture and demo:
- Public page: `/quote/<token>` (`server/src/app/quote/[token]/page.tsx`). Submit: `POST /api/quote/<token>/decision`
  -> `submitQuoteLinkDecision`; `changed` is HTTP 409 `{ "status": "changed" }`. The panel shows "This quote has
  changed" (`#quote-link-changed`); the client must **reload** the page to see the corrected total.
- Fixture: quote `status = 'sent'`, a minted access link (`QuoteAccessLinks.mint`), a taxable item, a client with
  `region_code` and an active `tax_rates` row, and stored `quotes.tax` / `total_amount` not equal to the engine's
  (e.g. save the quote, then raise the rate, or `UPDATE quotes SET tax = 0, total_amount = subtotal`).
- Columns to check: `quotes.subtotal, discount_total, tax, total_amount, status`; `quote_decisions` (no row after the
  first submit, one row after the second); `quote_activities`.
- DB test: `server/src/test/integration/quoteLinkDecision.integration.test.ts` "stored tax that differs from the
  engine". Fixtures there now call `recalculateQuoteFinancials` so a sent quote's stored totals match the engine.
