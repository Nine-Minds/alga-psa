import type { FixedBaseRateBasis } from '@alga-psa/types';

/**
 * The rate columns of a Fixed member patch. A number states what it means
 * (the stored basis, or per unit for a member that had none); `null` means
 * "use the catalog price / inherited", which has no basis by definition, so
 * none is sent. The DB pair CHECK requires `base_rate` and `base_rate_basis`
 * to be NULL together.
 */
export function buildFixedMemberRatePatch(
  baseRate: number | null,
  storedBasis: FixedBaseRateBasis | null | undefined,
): { base_rate: number | null; base_rate_basis?: FixedBaseRateBasis } {
  if (typeof baseRate !== 'number') {
    return { base_rate: null };
  }
  return { base_rate: baseRate, base_rate_basis: storedBasis ?? 'per_unit' };
}
