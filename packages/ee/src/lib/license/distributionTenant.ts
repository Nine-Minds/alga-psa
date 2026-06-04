/**
 * Appliance-license distribution-tenant gate — Community Edition stub.
 *
 * CE has no appliance-license distribution, so no tenant is ever a distributor.
 * The real implementation (resolved via `@enterprise/lib/license/distributionTenant`
 * on EE builds) lives in `ee/server/src/lib/license/distributionTenant.ts`.
 */
export function isLicenseDistributionTenant(_tenant: string | null | undefined): boolean {
  return false;
}
