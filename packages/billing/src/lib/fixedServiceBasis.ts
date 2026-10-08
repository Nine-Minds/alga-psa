import type { FixedPricingBasis } from '@alga-psa/types';
import { isUnitPricedFixedConfig } from './usageSemantics';

/**
 * Shared authoring rules for a fixed-line member's pricing basis.
 *
 * Both the wizard UI and the server-side persistence read these so the two
 * cannot disagree about which members are billable seats and which are bundle
 * allocations.
 *
 *  - 'unit': a standing whole-number quantity billed at a unit rate every
 *    period. Zero bills zero. The unit rate is stored in the service
 *    configuration's fixed `base_rate` (minor units) and never contributes to
 *    the line base rate.
 *  - 'bundle' / absent: the line base rate is authoritative and the member
 *    quantity only allocates a share of it.
 */
export interface FixedServiceBasisFields {
  pricing_basis?: FixedPricingBasis | string | null;
  quantity?: number | null;
  /** Unit rate in minor units of the contract currency. Only meaningful for 'unit'. */
  unit_rate?: number | null;
}

export type FixedServiceBasisIssue =
  | 'quantity_invalid'
  | 'unit_quantity_not_whole'
  | 'unit_rate_required';

export function isUnitFixedService(service: Pick<FixedServiceBasisFields, 'pricing_basis'>): boolean {
  return isUnitPricedFixedConfig(service.pricing_basis);
}

/** True when at least one member allocates a share of the line base rate. */
export function hasBundleFixedService(services: ReadonlyArray<Pick<FixedServiceBasisFields, 'pricing_basis'>>): boolean {
  return services.some((service) => !isUnitFixedService(service));
}

/** quantity × unit rate, rounded exactly as the billing engine rounds it. */
export function unitFixedServiceAmountCents(quantity: number, unitRateCents: number): number {
  return Math.ceil(quantity * Math.ceil(unitRateCents));
}

/**
 * Sum of the amount every member contributes to a recurring period: unit
 * members bill quantity × rate; the bundle members together bill the line
 * base rate (when there is at least one bundle member).
 */
export function fixedServicesRecurringTotalCents(
  services: ReadonlyArray<FixedServiceBasisFields>,
  bundleBaseRateCents: number | null | undefined,
): number {
  const unitTotal = services.reduce((sum, service) => {
    if (!isUnitFixedService(service)) return sum;
    const quantity = Number(service.quantity ?? 0);
    const rate = Number(service.unit_rate ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(rate)) return sum;
    return sum + unitFixedServiceAmountCents(quantity, rate);
  }, 0);
  return unitTotal + (hasBundleFixedService(services) ? Number(bundleBaseRateCents ?? 0) : 0);
}

/**
 * First authoring problem for one member, or null. Unit members: a whole
 * quantity >= 0 (zero is a legitimate stored zero) and a unit rate. Bundle
 * members keep the historical rule of a positive allocation quantity being
 * optional (defaults to 1), but never negative or non-finite.
 */
export function getFixedServiceBasisIssue(
  service: FixedServiceBasisFields,
  options: { requireUnitRate?: boolean } = {},
): FixedServiceBasisIssue | null {
  // Templates are currency-neutral: their unit rate is an optional default and
  // an empty one follows the catalog price in the contract's currency.
  const requireUnitRate = options.requireUnitRate ?? true;
  if (isUnitFixedService(service)) {
    const quantity = service.quantity;
    if (quantity == null || !Number.isFinite(quantity) || quantity < 0) return 'quantity_invalid';
    if (!Number.isInteger(quantity)) return 'unit_quantity_not_whole';
    const rate = service.unit_rate;
    if (rate == null) return requireUnitRate ? 'unit_rate_required' : null;
    if (!Number.isSafeInteger(rate) || rate < 0) return 'unit_rate_required';
    return null;
  }
  if (service.quantity != null && (!Number.isFinite(service.quantity) || service.quantity < 0)) {
    return 'quantity_invalid';
  }
  return null;
}

/**
 * Split a line base rate across the BUNDLE members only, proportionally to
 * their allocation quantity; the last bundle member absorbs the rounding
 * remainder so the shares always sum to the base rate. Unit members get no
 * share (their rate is quantity × unit rate, billed independently) — this is
 * what prevents a mixed line from double-billing seats.
 *
 * Returns one entry per input service (null for unit members).
 */
export function allocateBundleBaseRate<T extends FixedServiceBasisFields>(
  services: ReadonlyArray<T>,
  baseRateCents: number,
): Array<number | null> {
  const bundleIndexes = services
    .map((service, index) => (isUnitFixedService(service) ? -1 : index))
    .filter((index) => index >= 0);
  const totalQuantity =
    bundleIndexes.reduce((sum, index) => sum + (services[index].quantity ?? 1), 0) || bundleIndexes.length;

  const shares: Array<number | null> = services.map(() => null);
  let allocated = 0;
  bundleIndexes.forEach((serviceIndex, position) => {
    if (position === bundleIndexes.length - 1) {
      shares[serviceIndex] = baseRateCents - allocated;
      return;
    }
    const quantity = services[serviceIndex].quantity ?? 1;
    const share = Math.round(baseRateCents * (quantity / totalQuantity));
    shares[serviceIndex] = share;
    allocated = Math.round(allocated + share);
  });
  return shares;
}
