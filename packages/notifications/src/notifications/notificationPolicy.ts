/**
 * Tenant notification policy reads that are safe for any caller that already
 * holds a tenant-scoped connection (server pages, REST services). Deliberately
 * not a "use server" module: every export there becomes client-callable.
 */

import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * Whether every ticket "Don't notify the customer" checkbox starts ticked.
 * Read-only: a tenant without a notification_settings row keeps the historical
 * unticked default instead of having a row created on its behalf.
 */
export async function readDontNotifyCustomerDefault(
  knex: Knex | Knex.Transaction,
  tenant: string,
): Promise<boolean> {
  if (!tenant) {
    throw new Error('Tenant is required to read the notification policy');
  }
  const row = await tenantDb(knex, tenant)
    .table('notification_settings')
    .select('default_dont_notify_customer')
    .first();
  return row?.default_dont_notify_customer === true;
}
