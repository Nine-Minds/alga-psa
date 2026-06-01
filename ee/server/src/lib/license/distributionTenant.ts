/**
 * Appliance-license distribution-tenant gate — Enterprise Edition only.
 *
 * Resolved via `@enterprise/lib/license/distributionTenant` on EE builds (this
 * file); Community Edition gets the no-op stub at
 * `packages/ee/src/lib/license/distributionTenant.ts`. Keeping the real check
 * behind the `@enterprise` seam means no appliance-licensing logic ships in CE.
 *
 * Returns true only for the Nine Minds distribution tenant with distribution
 * switched on (see `isLicenseDistributionTenant` in `@alga-psa/licensing`).
 */
export { isLicenseDistributionTenant } from '@alga-psa/licensing';
