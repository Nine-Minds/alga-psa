/**
 * Shared tenant-scoped admin-transaction helper. Extracted so multiple inbound
 * email modules (processInboundEmailInApp.ts, notificationLoopDetection.ts,
 * ...) can query tenant tables through the same `withAdminTransaction` +
 * `tenantDb` composition instead of each re-deriving it.
 */
export async function withTenantAdminTransaction<T>(
  tenantId: string,
  callback: (trx: any, db: any) => Promise<T>,
  existingConnection?: any
): Promise<T> {
  const { withAdminTransaction, tenantDb } = await import('@alga-psa/db');
  return withAdminTransaction(async (trx: any) => callback(trx, tenantDb(trx, tenantId)), existingConnection);
}
