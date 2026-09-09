# Ticket 2353 — Draft review packet

Latest completion and review entry point: [TAKEOVER.md](TAKEOVER.md).

Round-2 repair (standard-template catalog compatibility) entry point:
[round2/README-round2.md](round2/README-round2.md). It fixes the round-1 smoke
blocker: the shared `standard-quote-grouped` catalog row (ticket-2354 `lines`
Description columns) now evaluates and renders through the real quote
preview/PDF path. Runtime regression: infra test T220 in
`server/src/test/infrastructure/billing/quotes/quoteInfrastructure.test.ts`.

Branch: `feature/correct-recurring-quote-discount-allocation-and` (isolated
checkout, not pushed). Plan:
`ee/docs/plans/2026-09-08-quote-discount-group-allocation/`.

## What changed since rev 1 (review responses)

1. **Monthly sidebar figure** (`QuoteForm.tsx` +
   `quoteLineItemDraft.calculateDraftMonthlyRecurringNet`): the "$X recurring /
   month" figure is now derived from the shared per-base discount allocation,
   so discounts aimed at monthly services reduce it ($50.00, not $60.00) and
   mixed billing frequencies reduce only their own monthly rows. Verified in
   the editor on port 3172 after save/reopen
   (`editor/2353-editor-reopen-50monthly.png`) and by draft unit tests.

2. **Copy paths remap item targets** (`quoteActions.ts`
   `copyQuoteItemsToQuote` used by createQuoteFromTemplate, duplicateQuote,
   saveQuoteAsTemplate; `models/quote.ts` createRevision now two-phase):
   base rows are copied first, then discount rows receive the copied target's
   new id via a complete old→new map, regardless of display order. Persisted
   behavioral tests: infra `quoteConversion/quoteInfrastructure` T202 (revision)
   and T204 (helper used by duplication/template flows, discount stored ahead
   of its target); action-level unit tests T140/T141/T142 assert each copy flow
   remaps and saveQuoteAsTemplate forces selection.

3. **Conversion uses allocated shares** (`quoteConversionService.ts`): shared
   `resolveQuoteDiscountConversionShares` feeds preview and invoice execution.
   A whole-quote or mixed-cadence discount contributes only its allocated
   one-time share to one-time invoices; recurring reductions never leak into
   them. Invoice discount rows are sized from allocations (single-target rows
   keep an `applies_to_item_id`). Infra conversion tests T210/T211 (mixed
   service + whole-quote: $30 recurring / $10 one-time with a $4 discount ⇒
   invoice −$1.00 discount, $9.00 subtotal) plus updated T116.

4. **Unified eligibility**: adapter now applies the same included-item rule as
   the draft and the persisted recalculation (`required rows always count;
   optional rows only while selected`). Adapter T210 and infra T203 cover a
   required row with `is_selected=false` (draft $25−$5 = $20 also renders $20
   in the cadence totals) and an optional→required transition across
   save/reload. Optional-unselected rows still contribute neither base nor
   allocation.

5. **Read-time financial consistency**: the adapter now reports derived
   overall financials (and derived positive discount rows) instead of mixing
   persisted `discount_total`/`total_amount` with derived groups. Legacy
   oversized ($40 discount on a $25 base) and unmatched fixtures render $0 /
   $0 consistently (adapter T211/T212), with positive storage preserved and no
   backfill. Persisted rows are recalculated only when the quote is next saved.

6. **Evidence packet** (`docs/evidence/ticket-2353-quote-discount-group-allocation/`):
   editor screenshots are included in the commit (`.gitignore` negation);
   standard-grouped preview/PDF verified via a temporary shared-catalog swap
   (backup -> replace -> generate -> restore; the shared row and the quote's
   template id were restored afterwards - see
   `preview/2353-standard-catalog-blocker.txt` for the exact procedure;
   `pdfs/QUO-0003-standard-grouped-isolated-catalog.pdf`);
   custom-template coverage retained; a pre-fix render of the faithful fixture
   documents the old positive-discount-in-one-time grouping and explicitly
   leaves the customer's reported subtraction unresolved
   (`pdfs/QUO-0003-PRE-FIX-adapter-grouping.pdf` +
   `preview/pre-fix-viewmodel.json`); unsupported "production unaffected" /
   "2354 merge necessarily resolves" claims removed from the blocker note and
   README.

## Allocation policy (unchanged, concrete amounts in tests)

Eligibility/scope/splits/rounding/caps as rev 1. Copy & conversion now consume
the same module/derived outputs.

## Validation commands (reproducible)

All Vitest commands run from `server/` (the repo's vitest config root; package
paths below are relative to it), against the local test DB (shared dev Postgres
on `127.0.0.1:5472`, secrets under `<repo>/secrets`; use a worktree-unique
`TEST_DB_NAME`). The typecheck runs from the repo root.

```bash
cd server

export TEST_DB_NAME=test_database_2353dbq DB_HOST=127.0.0.1 DB_PORT=5472 \
  DB_USER_ADMIN=postgres DB_USER_SERVER=app_user

# pure/unit + colocated adapter/draft suites:
npx vitest run \
  ../packages/billing/src/services/quoteDiscountAllocation.test.ts \
  ../packages/billing/src/components/billing-dashboard/quotes/quoteLineItemDraft.test.ts \
  ../packages/billing/src/lib/adapters/quoteAdapters.test.ts \
  ../packages/billing/tests/quote/quoteCalculationService.test.ts \
  ../packages/billing/src/services/quoteConversionService.preview.test.ts \
  ../packages/billing/tests/quote/quoteActions.test.ts

# DB-backed suites:
npx vitest run src/test/infrastructure/billing/quotes/quoteInfrastructure.test.ts
npx vitest run src/test/infrastructure/billing/quotes/quoteConversion.test.ts

# Typecheck (from the repo root):
cd .. && npm -w @alga-psa/billing run typecheck
```

Recorded results: see the current commit's test run summary (all listed suites
green; billing typecheck clean).

## What changed since rev 2 (review round 3)

7. **Copy paths preserve unmatched targets** (`quoteActions.ts`
   `copyQuoteItemsToQuote`, `models/quote.ts` createRevision): when a
   discount's item target is absent from the copied rows, the original target
   id is preserved (never nulled), so the copied discount stays item-scoped and
   resolves to zero instead of broadening into a whole-quote discount.
   Persisted tests T205 (revision, orphan target) and T206 (helper, removed
   item target plus a *present* service target — item precedence keeps it $0)
   cover duplication/template/revision.

8. **Sales-order conversion conserves product allocations**
   (`convertQuoteToDraftSalesOrder`): product-attributed discount shares are
   originally written as reduced per-unit product prices with indivisible
   reductions refused; takeover supersedes that restriction with quantity
   splitting (see TAKEOVER.md). Preview's
   sales-order bucket shows the same net product rows and invoice execution
   excludes product shares. Persisted test T212: $10 product + $10 service
   with a $4 whole-quote discount → SO line $8, invoice service −$2 → $8, full
   $4 conserved.

9. **Converted discounts are fixed allocated amounts**
   (`quoteConversionService.ts` invoiceChargeRowFor): discount rows written
   from a quote no longer carry `discount_type='percentage'` /
   `discount_percentage`, so ordinary invoice recalculation
   (`recalculatePercentageDiscountInvoiceCharges`) cannot rewrite an allocated
   share (−$6.00) into a percentage of the invoice target (−$3.50). Editing
   semantics documented in code: a converted percentage discount is a
   fixed-amount invoice line adjusted directly. Persisted tests T213
   (stacked/capped/mixed-cadence whole-quote 10%) and T214 (service-targeted
   10%) convert then run the actual recalculation and assert the allocated
   amounts and invoice totals survive.

## Reviewer: inspect first

1. `quoteDiscountAllocation.ts` (policy) and `quoteAdapters.ts` (eligibility +
   derived financials).
2. `quoteActions.ts` `copyQuoteItemsToQuote` + `models/quote.ts` createRevision.
3. `quoteConversionService.ts` shares + invoice/preview wiring.
4. New regressions: adapter T210–T212, infra T202–T206, conversion T210–T214,
   action unit T140–T142, draft monthly-net tests.
5. Evidence README/REVIEW and `preview/2353-standard-catalog-blocker.txt`.
