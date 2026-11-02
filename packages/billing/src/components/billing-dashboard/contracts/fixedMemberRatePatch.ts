import type { FixedBaseRateBasis } from '@alga-psa/types';
import { FixedMemberRatePairError } from '@alga-psa/shared/billingClients/fixedMemberRate';

/**
 * The rate columns of a Fixed member patch. A number states what it means
 * (the stored basis, or per unit for a member that had none); `null` means
 * "use the catalog price / inherited", which has no basis by definition, so
 * none is sent. The DB pair CHECK requires `base_rate` and `base_rate_basis`
 * to be NULL together.
 */
export function buildFixedMemberRatePatch(
  baseRate: number | string | null | undefined,
  storedBasis: FixedBaseRateBasis | null | undefined,
): { base_rate: number | null; base_rate_basis?: FixedBaseRateBasis } {
  // Only an empty value means "catalog price"; anything else must be a number.
  if (baseRate === null || baseRate === undefined || baseRate === '') {
    return { base_rate: null };
  }
  const rate = typeof baseRate === 'number' ? baseRate : Number(baseRate);
  if (!Number.isFinite(rate)) {
    throw new FixedMemberRatePairError(`A fixed member base_rate must be a number (got ${JSON.stringify(baseRate)}).`);
  }
  return { base_rate: rate, base_rate_basis: storedBasis ?? 'per_unit' };
}
