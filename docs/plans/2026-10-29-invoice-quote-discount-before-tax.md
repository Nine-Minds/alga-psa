# Design: apply discounts before tax (invoice + quote)

Card: ea4904a3 · PSA alga-2026-0002786 · Design Session deliverable (XO, conn).
Status: plan — no code in this step.

## The defect in one line

Tax is computed on the **pre-discount** charge amounts. `calculateAndDistributeTax`
collects each region's taxable entities, takes `positiveSum` of those amounts
(`packages/billing/src/services/invoiceService.ts:2383`), groups discount rows
per region into `regionGroups[region].discounts` (`:2343–:2373`) and then
**never uses them**. Tax is distributed pro rata over the undiscounted line
amounts, so every seller-funded discount over-collects tax. Quotes do the same
per line on `rowGrossAmount` and skip discount rows
(`packages/billing/src/services/quoteCalculationService.ts:316–:326`).

The captain's decision is a behavior change, not a toggle: tax follows the kind
of adjustment line, and there is no tenant setting.

## The mechanism (one general step, not per-call-site patches)

Introduce **discount allocation before tax**, as a shared step that every tax
path runs before it computes anything:

1. **Resolve adjustment lines into a region-scoped discount pool.**
   A discount lowers the taxable base *of the lines it applies to*. Today
   `discounts` are grouped by region; that is the right key but the wrong
   granularity — a discount with a scoped target (contract automatic discount,
   `adjustment_source_kind = 'discount'`) must reduce only its target's
   entities. So the pool is keyed by `(region, scope)`, where scope is the
   scoped target when one exists and the whole region otherwise.
2. **Reduce entity amounts in place, pro rata, capped at each entity's amount.**
   Each taxable entity (including each `invoice_charge_fixed_details`
   `allocated_amount` entity, so a discount hitting a fixed plan reduces the
   detail rows and not just the parent) receives
   `share = entityAmount / sum(scopeEntities)` of the pool, capped at the
   entity amount; leftover from caps redistributes once; if the pool exceeds
   the whole scope, the base floors at 0 (tax 0, never negative).
3. **Compute tax on the reduced entities.** `positiveSum`, the pro-rata tax
   distribution and the step-8/9 totals then work unchanged — this is the
   point of doing it as a pre-step: the distribution and rounding logic is
   already correct and should not be rewritten.
4. **Write the discount rows' own `tax_amount` as 0 and keep them
   `is_taxable: false`.** The reduction is expressed in the taxable entities'
   amounts; putting tax on the discount row too would double-count.
5. **Zero-amount / all-discount scope** yields base 0 and tax 0; never a
   negative base and never negative tax.

## Where it lands

- **Invoice path** — `packages/billing/src/services/invoiceService.ts`:
  extract steps 1–4 into `applyDiscountAllocation(entities, discounts)` in a
  billing lib module, call it at the head of `calculateAndDistributeTax`
  (`:2158`) after `regionGroups` is built and before `positiveSum` (`:2383`).
  All six callers (`invoiceGeneration.ts`, `manualInvoiceActions.ts`,
  `hourBlockActions.ts`, `salesOrderInvoicingActions.ts`, `taxSourceActions.ts`,
  `ee/server/src/lib/extensions/invoicingHostApi.ts`) inherit the fix through
  the shared function — check each still passes, do not fork per caller.
- **Discount persistence** — same file `~L1147–:1320`: manual negative lines
  already carry `is_discount`/`is_manual_credit`, manual discount rows are
  written `tax_amount 0, is_taxable false`. Keep that shape; the change is on
  the consuming side. `recalculatePercentageDiscountInvoiceCharges` (`:670–:740`)
  keeps computing discount amounts before tax; the new base must use the
  **recomputed** amounts.
- **Preview** — `packages/billing/src/actions/billingAndTax.ts`
  `calculatePreviewTax` (`:2320`): currently taxes "before discounts"
  (`:2336`). It must call the same allocation helper so preview ≡ final
  invoice, by construction rather than by duplicated arithmetic.
- **Quotes** — `packages/billing/src/services/quoteCalculationService.ts`:
  allocate `allocateIncludedQuoteDiscounts` (`packages/billing/src/lib/quoteTotals.ts`)
  onto rows *before* computing per-line tax, then tax `rowGrossAmount − share`.
  `quoteConversionService.ts` (`~:1209`) and the workflow-path mirror
  `shared/workflow/runtime/actions/businessOperations/crmWorkerDal.ts` (`~:1582`)
  copy per-line tax onto the invoice at conversion; they keep copying, so quote
  tax and converted-invoice tax agree because both were computed on the
  discounted base.
- **Accounting exports** — `quickBooksOnlineAdapter.ts` (`~:481`,
  `~:1519–1650`) and `xeroAdapter.ts` (`~:489`, `~:916`) treat discount lines as
  non-taxable and spread total tax over non-discount lines. With lines now
  carrying post-discount tax that spread must still reconcile to Alga's stored
  totals, in **both** tax modes: Alga as tax authority, and delegated
  (`pending_external`/`external`) where the external system's tax is
  authoritative. The adapter change is expected to be spread/summation only.
- **Finalized invoices** — untouched. Stored `tax_amount` is not recalculated
  on read or export; only generation/recalculation paths move.

## Order of work

1. Extract the allocation helper + unit tests (rounding matrix, cap/redistribute,
   discount > base, scoped vs region-wide, fixed-detail entities).
2. Wire `calculateAndDistributeTax` to it; re-run the invoice suites and update
   `manualInvoice.test.ts` expectations, and fix the misleading credit comment
   at `:479` while in the file.
3. Wire `calculatePreviewTax` to the same helper; add a preview ≡ invoice test
   for a discounted contract.
4. Quote path: allocate before per-line tax; assert quote tax == converted
   invoice tax for a discounted quote.
5. Exports: QBO (algasim emulator) and Xero adapter tests, Alga-authority and
   delegated modes.
6. Browser manual check: manual invoice (taxable service + discount) and a
   recurring invoice with a contract discount — detail, PDF and preview show
   tax on the discounted amount.

## Risks and things I am deliberately not doing

- **Rounding** is the real risk: pro-rata reduction of cents across entities
  must sum exactly to the pool. Allocate integer cents, give the remainder to
  the largest entity, and assert the sum invariant in tests.
- **Not in scope:** `calculateAndDistributeTax` calls
  `taxService.calculateTax` with `Temporal.Now.plainDateISO()` instead of the
  invoice/service date (`~:2400`). That is a separate defect (rate changes and
  tax holidays applying by generation date) and gets its own card.
- **No tenant setting / no toggle** — per the captain's decision.
- **No tax on discount rows** — reduction is expressed in the taxable entities.
- **Quotes and invoices must not drift**: the single helper is the guard; if the
  quote path ever re-implements the arithmetic, the conversion equality test is
  what will catch it.
