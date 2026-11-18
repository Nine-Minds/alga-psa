/**
 * Per-unit margin (price − cost, minor units) for a catalog product, or null
 * when it does not fall straight out of the two numbers. Cost is never
 * converted: if it is tracked in another currency than the contract's there is
 * no margin to show.
 */
export function productUnitMarginCents(
  priceCents: number | null | undefined,
  cost: number | null | undefined,
  costCurrency: string | null | undefined,
  contractCurrency: string | null | undefined,
): number | null {
  if (priceCents == null || cost == null || !contractCurrency) return null;
  if (costCurrency && costCurrency !== contractCurrency) return null;
  return priceCents - cost;
}
