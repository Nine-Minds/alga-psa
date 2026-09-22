/**
 * DEPRECATED FORK RETIRED (plan §0.5).
 *
 * This file used to be a 687-line duplicate of
 * `packages/billing/src/repositories/contractLineRepository.ts` and had already
 * drifted from it (clone-time rate precedence, `location_id`/`billing_profile_id`
 * reads, the partial-update rate defect). Three divergent copies of the rate
 * decision is how the catalog-price bug got in, so this path now re-exports the
 * package implementation rather than maintaining a second copy.
 */
export * from '@alga-psa/billing/repositories/contractLineRepository';
