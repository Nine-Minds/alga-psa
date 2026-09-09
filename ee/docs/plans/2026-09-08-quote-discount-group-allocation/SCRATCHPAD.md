# Scratchpad

## Current evidence

- `quoteLineItemDraft.ts` and `quoteCalculationService.ts` independently resolve discount bases; both need the same allocation contract.
- `createDraftDiscountQuoteItem` always writes one-time/null cadence.
- `quoteAdapters.ts` currently groups from each row's own `is_recurring` and adds positive discount `total_price`, causing legacy misclassification and sign errors.
- Standard/custom grouped templates bind directly to adapter collections and totals; fix the adapter contract rather than customer ASTs.

## Decisions

- Preserve positive persisted discount amounts and quote-level subtraction.
- Derive display allocation on read; no historical backfill.
- Mixed-cadence targets split proportionally by eligible non-negative base cents.
- Use largest remainder and stable display order for deterministic cent conservation.
- Cap discount allocation at eligible base; unmatched/zero targets allocate zero.

## Guardrails

- Do not include the pre-existing modified root `package-lock.json` in implementation commits.
- Do not claim exact customer PDF reproduction until local preview/PDF evidence exists.
- Coordinate overlapping quote adapter/template files with ticket 2354 and ticket 2355 work.

## Likely files

- `packages/billing/src/components/billing-dashboard/quotes/quoteLineItemDraft.ts`
- `packages/billing/src/components/billing-dashboard/quotes/QuoteLineItemsEditor.tsx`
- `packages/billing/src/lib/adapters/quoteAdapters.ts`
- `packages/billing/src/services/quoteCalculationService.ts`
- Focused unit/integration tests beside those modules and quote preview/PDF smoke evidence.

## Takeover completion

- Round-three repairs already preserved unmatched copy targets and fixed invoice allocations; retained them.
- New regressions reproduced a conversion-preview exception for a 100-cent discount over three products, and a legacy order showing 800 cents in preview while storing 1000 cents.
- Replaced indivisible-price refusal with deterministic quantity splitting (three 1000-cent units less 100 cents -> one at 966, two at 967).
- Existing orders are compared by service quantity and net amount, allowing equivalent line splits. Preview displays persisted order lines. Mismatches block the remaining invoice with a reconciliation message, with no order/quote repair writes.
- Updated both quote conversion dialogs to display the invoice-specific error and disable only invoice creation.
- New coverage: preview cases and DB-backed T215/T216. Uses isolated test database test_database_2353_takeover on port 5472.
- Billing package build/typecheck pass. Full test and evidence details are in docs/evidence/ticket-2353-quote-discount-group-allocation/TAKEOVER.md.
- The browser CLI timed out twice; the Browser runtime listed no connected browsers. Existing editor/PDF evidence remains valid for unchanged quote rendering; no new live screenshot of the conversion warning is claimed.
