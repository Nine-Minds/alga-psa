/**
 * Community Edition stub for EE tenant-creation helpers.
 *
 * These are only available in Enterprise Edition.
 */

export async function createTenantComplete(): Promise<never> {
  throw new Error('EE-only: createTenantComplete is not available in Community Edition');
}

export async function rollbackTenant(): Promise<never> {
  throw new Error('EE-only: rollbackTenant is not available in Community Edition');
}

