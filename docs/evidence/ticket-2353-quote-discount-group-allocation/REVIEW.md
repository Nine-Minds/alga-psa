# Ticket 2353 — Draft review packet

Branch: `feature/correct-recurring-quote-discount-allocation-and` (isolated
checkout, not yet pushed). Plan:
`ee/docs/plans/2026-09-08-quote-discount-group-allocation/` (18 features
F001–F018, 10 tests T001–T010; features and tests all marked implemented with
evidence pointers).

## What was implemented

A single pure allocation module, `quoteDiscountAllocation.ts`, is now the
shared source of truth for how a persisted (or draft) discount reduces the
eligible base items it targets:

- `packages/billing/src/services/quoteDiscountAllocation.ts` (new) —
  deterministic integer-cent allocation with largest-remainder rounding,
  stable display order tie-break, per-cadence splits, caps.
- `quoteLineItemDraft.ts` — draft totals and the editor's discount-row amount
  column derive from the shared module (`calculateDraftQuoteTotals`,
  `resolveDraftDiscountAmounts`).
- `QuoteLineItemsEditor.tsx` — discount rows display the derived resolved
  reduction; amount column and sidebar discount total agree.
- `quoteCalculationService.ts` — `recalculateQuoteFinancials` persists derived
  `discount_total`/item totals from the same module (quotes keep the
  `subtotal - discount_total + tax` contract; discount rows stay positive).
- `quoteAdapters.ts` — `mapLoadedQuoteToViewModel` derives cadence membership
  from target relationships (not the discount row's own cadence fields). Base
  items keep their cadence; each discount contributes a negative per-cadence
  row to `recurring_items`/`onetime_items`, exactly once; group subtotals are
  the sum of selected base rows plus those reductions. `line_items`,
  service/product/location/phase collections and overall quote totals are
  preserved. No customer recreation, backfill, or template AST rewrite.

## Allocation policy (with the concrete numbers the tests lock)

- Eligibility: selected, non-discount base items; optional-unselected items
  contribute neither base nor allocation. Zero/negative bases contribute
  nothing.
- Targets: item → only that item; service → every eligible item with that
  service (all rows/cadences, never just the first match); no target → all
  eligible base items.
- Cadence split: proportional to eligible base amount. Example: service with
  $30 recurring + $10 one-time base and a $4 fixed service discount →
  $3.00 recurring / $1.00 one-time (300/100 cents).
- Rounding: largest-remainder, exact cent conservation, display order as tie
  break. Example: $5 fixed over a $25/$35 whole-quote/… base → 208/292.
- Caps / overlap: discounts process in display order against remaining base
  capacity per item, so a group/base can never go negative. Nominal for a
  percentage is computed on the original eligible base with existing rounding,
  then capped by remaining capacity. Concrete locked examples:
  - Two $20 item discounts stacked on a $25 item → first 2000, second capped
    at 500, total 2500.
  - $25 item-targeted fixed discount then a whole-quote 10% over a $60 base →
    item consumes 2500; 10% nominal 600 then lands wholly on the remaining
    $35 item; total 3100. (Earlier discounts win; documented ambiguity
    resolved as "display order + per-base remaining capacity".)
  - Removed/unmatched targets and zero eligible bases → zero allocation.
- Persistence: discount rows remain positive with their original cadence
  fields; quote-level subtraction preserved.

## Existing-quote compatibility

On read, the adapter derives allocation purely from persisted target
relationships and positive amounts, so quotes saved before this change render
correctly on first load (and after save/reload, since re-saving runs the same
derivation). Backward-compatible `line_items`. Verified by the DB-backed
T005/T006 tests, adapter T007/T008, and the reopened QUO-0003 editor session.

## Validation results

- Pre-fix (HEAD adapter) reproduction: `quoteAdapters` discount-group suite
  6 failed / 6 passed — see
  `docs/evidence/ticket-2353-quote-discount-group-allocation/pre-fix-adapter-reproduction*.txt`.
- Post-fix unit suites (47 tests): allocation 13, draft 5, adapters 12,
  calculation service 17 — all pass.
- DB-backed: `quoteInfrastructure.test.ts` full file 85/85 pass (includes
  T200/T005 and T201/T006).
- Adjacent suites (24 tests): quote template bindings, standard quote
  templates, invoice standard templates, quote document-template editor
  existing-quote/tenant-branding — pass.
- Typecheck: `@alga-psa/billing` `tsc --noEmit` clean.
- Browser (localhost:3172): created quote QUO-0003 with the two monthly
  services ($25/$35), four one-time charges (37353/210863/5581/45000 cents),
  and two **Fixed Discount > Specific Service** $5 discounts; saved; reloaded.
  Editor shows rows `- USD 5.00` and sidebar Subtotal $3,047.97 / Discounts
  −$10.00 / Tax $0.00 / Total $3,037.97. DB after save/reload:
  304797 / 1000 / 0 / 303797.
- PDF evidence (same service the app calls): custom-template and explicit
  standard-grouped renders both show Monthly Items $50.00 (incl. two −$5
  discounts) and One-time $2,987.97 — see `pdfs/` + `preview/*.txt`.

## Artifacts

`docs/evidence/ticket-2353-quote-discount-group-allocation/`:
`README.md` (expected-vs-actual table), `editor/*.png`, `pdfs/*.pdf`,
`preview/*.txt` + `viewmodel.json`, blocker note, pre-fix reproductions.

## Discrepancies / remaining uncertainty

- **UI "Grouped Quote Template (Standard)" returns HTTP 500 in this shared
  dev DB** because ticket 2354 has overwritten the shared standard-template
  catalog AST with `lines` description columns this branch cannot evaluate
  (`preview/2353-standard-catalog-blocker.txt`). Rendered standard evidence
  therefore uses the branch-canonical code AST. Production (where migration
  and code match) is unaffected; this is a coordination item with 2354, not a
  product regression. After 2354 merges this goes away.
- Tax: new items under the Emerald City client defaulted to the tenant's 6%
  rate; to mirror the customer's zero-tax scenario the fixture rows were
  flagged non-taxable and re-saved through the app (recalculation path).
  Tax behavior itself is unchanged by this branch.
- The PDF service call from the UI returns 200, but this browser harness does
  not persist downloads to disk; the saved PDFs were produced by the exact
  same server code path (`downloadQuotePdf` → `pdfService.generatePDF`) in a
  vitest harness against the same quote/template/user.
- No customer reproduction of the exact PDF (different tenant/template/
  branding); production re-verification remains for a later approved
  deployment (tenant 8ec33c81…, quote b0ba8a84…/QUO-0001).

## Reviewer: inspect first

1. `packages/billing/src/services/quoteDiscountAllocation.ts` — policy and
   rounding/cap rules.
2. `quoteAdapters.ts` diff — cadence-group derivation and summary contract.
3. `quoteAdapters.test.ts` new describe — T007/T008 runtime assertions.
4. `quoteInfrastructure.test.ts` T200/T201 and `quoteCalculationService`
   T215 — save/reload/persistence.
5. `quoteLineItemDraft.test.ts` + editor/draft diffs.
