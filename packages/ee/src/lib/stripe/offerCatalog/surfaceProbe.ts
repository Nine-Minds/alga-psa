/** CE has no EE billing catalog; retain shared server action compatibility. */
export async function withBillingCatalogContext<T>(work: () => T | Promise<T>, _tenantId?: string): Promise<T> {
  return work();
}
