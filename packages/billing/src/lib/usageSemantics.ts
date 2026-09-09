import type { UsageMeasurementMode } from '@alga-psa/types';

/**
 * Contract quantity & usage semantics — small shared resolution helpers.
 *
 * Both concepts are explicit stored properties of a service configuration:
 * usage measurement mode (additive entries vs one replaceable period total) and
 * fixed pricing basis (unit/seat quantity × rate vs bundle total). The helpers
 * below keep the "legacy default" in one place so authoring, the billing
 * engine, diagnostics, and reports cannot drift apart.
 *
 * Legacy defaults are behavior-preserving:
 *  - usage with no mode or an unrecognized value behaves as additive;
 *  - fixed with no basis behaves as bundle (the pre-existing fixed semantics).
 *
 * Mode/basis are never inferred from a service name, unit of measure, or a
 * legacy configured quantity.
 */

export const USAGE_MEASUREMENT_MODE_ADDITIVE = 'additive';
export const USAGE_MEASUREMENT_MODE_PERIOD_TOTAL = 'period_total';

export const FIXED_PRICING_BASIS_UNIT = 'unit';
export const FIXED_PRICING_BASIS_BUNDLE = 'bundle';

export function resolveUsageMeasurementMode(
  mode: UsageMeasurementMode | string | null | undefined,
): UsageMeasurementMode {
  return mode === 'period_total' ? 'period_total' : 'additive';
}

export function isPeriodTotalMeasurement(
  mode: UsageMeasurementMode | string | null | undefined,
): boolean {
  return resolveUsageMeasurementMode(mode) === 'period_total';
}

/**
 * A fixed service configuration bills per unit only when its pricing basis is
 * explicitly 'unit'. NULL and 'bundle' both keep the bundle semantics.
 */
export function isUnitPricedFixedConfig(
  pricingBasis: string | null | undefined,
): boolean {
  return pricingBasis === 'unit';
}
