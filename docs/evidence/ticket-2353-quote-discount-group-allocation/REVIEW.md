# Ticket 2353 — Draft review packet (rev 2)

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
   standard-grouped preview/PDF verified via an isolated catalog swap that
   restores ticket 2354's shared catalog byte-for-byte
   (`pdfs/QUO-0003-standard-grouped-isolated-catalog.pdf`);
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

From the repo root against the local test DB (shared dev Postgres on
`127.0.0.1:5472`, secrets under `./secrets`; use a worktree-unique
`TEST_DB_NAME`):

```bash
export TEST_DB_NAME=test_database_2353dbq DB_HOST=127.0.0.1 DB_PORT=5472 \
  DB_USER_ADMIN=postgres DB_USER_SERVER=app_user

# pure/unit + colocated adapter/draft suites (server-root vitest config):
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

# Typecheck:
npm -w @alga-psa/billing run typecheck
```

Recorded results: adapter 15, draft 9, allocation 13, calculation-service 17,
conversion preview unit 3, quoteActions 42 all pass; quoteInfrastructure 88/88;
quoteConversion 18/18; billing typecheck clean.

## Reviewer: inspect first

1. `quoteDiscountAllocation.ts` (policy) and `quoteAdapters.ts` (eligibility +
   derived financials).
2. `quoteActions.ts` `copyQuoteItemsToQuote` + `models/quote.ts` createRevision.
3. `quoteConversionService.ts` shares + invoice/preview wiring.
4. New regressions: adapter T210–T212, infra T202–T204, conversion T210/T211,
   action unit T140–T142, draft monthly-net tests.
5. Evidence README/REVIEW and `preview/2353-standard-catalog-blocker.txt`.
