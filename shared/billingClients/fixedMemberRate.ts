/**
 * The single interpreter for `contract_line_service_fixed_config.base_rate`.
 *
 * That column historically carried two meanings (a member's SHARE of the line
 * fee, or a PER-UNIT price) and nothing recorded which. `base_rate_basis`
 * now does, and every reader goes through this module instead of re-deriving
 * `rate × quantity` itself.
 *
 * Client-safe: no DB imports.
 */

export type FixedRateBasis = 'per_unit' | 'share';

/**
 * Stored label → meaning. Seats (`pricing_basis='unit'`) are always per-unit.
 * A NULL label on a non-NULL rate (pre-backfill rows, synthetic simulator rows)
 * reads as per_unit, which is exactly how the invoice engine bills such rows
 * today.
 */
export function fixedRateBasisOf(row: {
  pricing_basis?: string | null;
  base_rate_basis?: string | null;
}): FixedRateBasis {
  if (row.pricing_basis === 'unit') return 'per_unit';
  return row.base_rate_basis === 'share' ? 'share' : 'per_unit';
}

/**
 * The amount this member contributes to the line fee for one period:
 * per_unit → Math.round(rateCents × quantity); share → rateCents as-is.
 */
// LEVERAGE: friction fixed-member-rounding — bundle per-unit members round with
// Math.round here while pricing_basis='unit' seats round with Math.ceil
// (unitFixedServiceAmountCents). They differ only for non-integer rates or
// quantities; the helper would need both modes to unify them (plan §7).
export function fixedMemberContributionCents(
  rateCents: number,
  basis: FixedRateBasis,
  quantity: number,
): number {
  if (basis === 'share') return rateCents;
  return Math.round(rateCents * quantity);
}

/**
 * Exact-sum split of a fee across weighted members: floor each exact share,
 * then hand the leftover cents to the largest fractional remainders (ties
 * broken by key so the split never depends on row order). `totalCents` is in
 * the contract/invoice currency's minor units; nothing here knows or assumes a
 * currency. This is the single weight → cents allocator.
 */
export function allocateCentsByWeights(
  totalCents: number,
  members: ReadonlyArray<{ key: string; weight: number }>,
): { amounts: number[]; proportions: number[] } {
  const weightSum = members.reduce((sum, member) => sum + member.weight, 0);
  const exact = members.map((member) => (totalCents * member.weight) / weightSum);
  const amounts = exact.map((value) => Math.floor(value));
  let remainder = totalCents - amounts.reduce((sum, value) => sum + value, 0);
  const order = members
    .map((member, index) => ({ index, key: member.key, fraction: exact[index] - amounts[index] }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        a.index - b.index,
    );
  for (let cursor = 0; remainder > 0 && order.length > 0; cursor += 1) {
    amounts[order[cursor % order.length].index] += 1;
    remainder -= 1;
  }
  return {
    amounts,
    proportions: members.map((member) => member.weight / weightSum),
  };
}
