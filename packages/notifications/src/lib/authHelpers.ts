/**
 * Auth helpers for notifications package
 */

import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';

export async function hasPermissionAsync(user: any, resource: string, action: string, trx?: Knex.Transaction): Promise<boolean> {
  return hasPermission(user, resource, action, trx);
}
