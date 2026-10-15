# Quote Discount Group Allocation

## Problem

Quote discounts are stored as positive amounts that are subtracted from the quote total, but grouped quote rendering treats discount rows like ordinary positive line items and classifies them only from their own cadence fields. Existing targeted discounts commonly have `is_recurring=false` and no billing frequency, so a discount aimed at a recurring item can appear in one-time charges and increase a group subtotal.

## Goals

- Derive each included discount's monetary allocation from the eligible base items it targets.
- Apply each allocation exactly once and subtract it from the correct recurring or one-time group.
- Make draft/editor totals, saved quote totals, preview, custom templates, and generated PDFs agree.
- Correct existing quotes on read without tenant-specific repair or destructive backfill.
- Preserve positive stored discount amounts and the quote-level `subtotal - discount_total + tax` contract.

## Non-goals

- Redesigning quote taxation or billing cadence models.
- Rewriting customer template ASTs.
- Mutating historical quotes solely to repair presentation.
- Changing unrelated service/product/location grouping semantics.

## Users and flow

An MSP user adds fixed or percentage discounts to a whole quote, a specific item, or a service. The editor immediately shows correct totals. After save/reopen, preview and PDF group the reduction with the eligible target items. Existing saved discounts receive the same behavior on first load.

## Product semantics

1. Eligible bases are selected non-discount quote items. Optional unselected items contribute neither base nor allocation.
2. Item-targeted discounts allocate only to the matching eligible quote item. Service-targeted discounts allocate across all eligible items with that service. Whole-quote discounts allocate across all eligible base items.
3. Allocation is proportional to non-negative base amount by cadence group. Integer cents use deterministic largest-remainder allocation with stable quote display order as the tie-breaker, so allocations sum exactly to the resolved discount.
4. A target spanning recurring and one-time items is split proportionally across those cadence groups. No first-match cadence shortcut is allowed.
5. Missing/removed targets and zero eligible bases allocate zero. Fixed discounts are capped at the eligible base; percentage discounts use existing percentage rounding, then are capped at the eligible base.
6. Discount rows remain positive in persistence and in the general line-item collection. Group summaries represent their allocated reductions with subtraction semantics and never double-apply a discount.
7. Recompute from current item state whenever selection, target, cadence, quantity, price, or membership changes.

## Technical design

- Add a pure allocation module near the quote draft/calculation domain. It accepts normalized base items and discount definitions and returns resolved discount amount plus per-item/per-cadence allocations in cents.
- Replace duplicated target-base calculations in `quoteLineItemDraft.ts`, `QuoteLineItemsEditor.tsx`, and `quoteCalculationService.ts` with the shared rules (using adapters at type boundaries where needed).
- In `quoteAdapters.ts`, derive group membership from target relationships for every loaded quote, including legacy false/null-cadence discounts. Build recurring/one-time summaries from base items plus allocated discount reductions; keep `line_items` backward compatible for templates.
- Verify standard Grouped Quote bindings and duplicated/custom AST bindings consume the corrected collections/totals without AST migration.
- Keep tax behavior unchanged unless an existing directly implicated assertion proves the discount allocation must alter it.

## Risks and compatibility

- Mixed-cadence service targets can expose rounding drift; allocation conservation is an invariant.
- Consumers may assume every group collection entry maps one-to-one to a persisted row; adapter tests must lock the chosen representation.
- Oversized discounts must not create negative grouped bases or totals.
- Preserve unrelated `package-lock.json` changes and exclude them from commits.

## Acceptance criteria

- Two monthly services at $25 and $35 with separate $5 service-targeted discounts render $50 monthly; one-time charges are unchanged and quote discounts total $10.
- The same result holds for existing discounts persisted with false/null cadence, before and after save/reload.
- Item, service, and whole-quote targets; fixed and percentage forms; mixed cadence; optional selection; target removal; multiple discounts; zero bases; caps; and cent rounding have behavioral coverage.
- Editor, persisted calculation, preview, standard grouped PDF, and duplicated/custom-template PDF agree.
- Rendered evidence records rows and recurring/one-time/overall totals and explains the former positive-sum discrepancy.


## Conversion compatibility (takeover completion)

- New sales orders preserve allocated product net amounts in integer cents. When a quantity cannot share one cent price evenly, split it across at most two adjacent cent prices, preserving total quantity and per-unit cost snapshots. The preview uses the same split; direct invoice conversion remains available.
- Existing sales-order preview uses stored line quantities and prices. For orders claiming discounted products, compare per-service quantity and net amount against the current quote allocations before creating the remaining invoice. A mismatch disables that invoice action and fails execution before writing; contract conversion remains available. Reconcile the order explicitly rather than rewriting historical orders or assuming their discounts were already applied.
- Converted quote discounts remain fixed allocated invoice amounts through later invoice recalculation. No customer quote backfill or template rewrite is required.
