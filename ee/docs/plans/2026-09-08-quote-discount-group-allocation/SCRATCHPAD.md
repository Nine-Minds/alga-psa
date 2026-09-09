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
