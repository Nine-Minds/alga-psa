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

/**
 * The persisted rate pair of a fixed member. The DB enforces
 * `(base_rate IS NULL) = (base_rate_basis IS NULL)`: a stored number always
 * states its meaning, and a NULL rate (catalog-priced / inherited) has none.
 */
export type FixedMemberRatePair =
  | { base_rate: null; base_rate_basis: null }
  | { base_rate: number; base_rate_basis: FixedRateBasis };

/**
 * A rate write that cannot be persisted (a basis with no rate, a seat priced
 * as a share, a rate with no meaning). Thrown before the DB CHECK so the
 * failure names the writer's mistake; `statusCode` makes the API answer 400.
 */
export class FixedMemberRatePairError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'FixedMemberRatePairError';
  }
}

/**
 * The single normaliser for a fixed member's `base_rate` / `base_rate_basis`
 * write. Every writer of `contract_line_service_fixed_config` (model, raw
 * inserts, patches) goes through it, so no path can persist a split pair.
 *
 * - A NULL rate drops any stated basis: "use the catalog price" has no basis.
 * - A number keeps the stated basis, else the row's stored one; a seat
 *   (`pricing_basis='unit'`) is per-unit by definition and never a share.
 */
export function resolveFixedMemberRatePair(input: {
  base_rate?: number | null;
  base_rate_basis?: FixedRateBasis | null;
  pricing_basis?: string | null;
  /** The row's stored basis, for patches that keep it (update paths). */
  storedBasis?: FixedRateBasis | null;
}): FixedMemberRatePair {
  if (input.base_rate === null || input.base_rate === undefined) {
    return { base_rate: null, base_rate_basis: null };
  }
  const isSeat = input.pricing_basis === 'unit';
  const basis = input.base_rate_basis ?? (isSeat ? 'per_unit' : input.storedBasis ?? null);
  if (basis === null) {
    throw new FixedMemberRatePairError('A fixed member base_rate requires base_rate_basis (per_unit or share).');
  }
  if (isSeat && basis === 'share') {
    throw new FixedMemberRatePairError("A seat (pricing_basis 'unit') member cannot carry a 'share' base_rate.");
  }
  return { base_rate: input.base_rate, base_rate_basis: basis };
}

/**
 * `contract_line_service_fixed_config.base_rate` is `numeric`, which the pg
 * driver returns as a string (`'1500.00'`). Every reader hands clients a
 * `number | null` through this one rule: null/undefined → null, else Number().
 */
export function coerceFixedMemberRate(value: number | string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Resolve a patch against the stored row. A patch that states only a basis
 * re-states it for the stored rate (a legitimate per_unit ↔ share change) and
 * is refused on a NULL-rate row, where a basis has nothing to describe.
 * Returns `undefined` when the patch touches neither column. Clearing the
 * basis alone never drops a stored rate: the rate keeps its stored meaning.
 */
export function resolveFixedMemberRatePatch(
  patch: { base_rate?: number | null; base_rate_basis?: FixedRateBasis | null; pricing_basis?: string | null },
  stored: { base_rate?: number | string | null; base_rate_basis?: FixedRateBasis | null; pricing_basis?: string | null } | null | undefined,
): FixedMemberRatePair | undefined {
  const statesRate = patch.base_rate !== undefined;
  const statesBasis = patch.base_rate_basis !== undefined;
  if (!statesRate && !statesBasis) return undefined;

  const storedRate = coerceFixedMemberRate(stored?.base_rate);
  const rate = statesRate ? patch.base_rate ?? null : storedRate;
  if (!statesRate && rate === null && patch.base_rate_basis !== null) {
    throw new FixedMemberRatePairError('A fixed member base_rate_basis requires base_rate');
  }
  return resolveFixedMemberRatePair({
    base_rate: rate,
    base_rate_basis: patch.base_rate_basis,
    pricing_basis: patch.pricing_basis ?? stored?.pricing_basis ?? null,
    storedBasis: stored?.base_rate_basis ?? null,
  });
}

/** Who owns a freshly written rate: a stored number is `custom`, NULL follows the catalog. */
export function fixedMemberRateProvenance(pair: FixedMemberRatePair): 'custom' | 'inherited' {
  return pair.base_rate === null ? 'inherited' : 'custom';
}
