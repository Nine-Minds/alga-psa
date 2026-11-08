import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/**
 * Locks the tenant row inside the caller's transaction and answers whether this workspace is a
 * co-managed one. A sponsor/PSA tenant that merely participates keeps native behaviour (false =>
 * the caller answers `{ handled: false }`). Participation itself is decided by the seam's cached
 * gate before a provider is reached, so this is not a participation probe.
 */
export async function retainCoManagedWorkspace(trx: Knex.Transaction, tenant: string): Promise<boolean> {
  const row = await tenantDb(trx, tenant).table('tenants').forShare().first('product_code', 'suspended_at') as
    { product_code?: string | null; suspended_at?: Date | string | null } | undefined;
  if (!row || row.product_code !== 'co_managed') return false;
  if (row.suspended_at) throw new CoManagedSharedWorkError();
  return true;
}
