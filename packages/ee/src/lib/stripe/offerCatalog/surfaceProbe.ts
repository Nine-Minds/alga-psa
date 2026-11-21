/** CE has no EE billing catalog; retain shared server action compatibility. */
export async function withBillingCatalogContext<T>(work: () => T | Promise<T>): Promise<T> {
  return work();
}
