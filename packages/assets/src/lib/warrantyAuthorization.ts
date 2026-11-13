import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';

/** Canonical authorization for warranty transitions, including legacy inventory permission grants. */
export async function requireWarrantyPermission(
  user: any,
  action: 'create' | 'read' | 'update',
  knexConnection?: Knex | Knex.Transaction
): Promise<void> {
  const allowed = await hasPermission(user, 'warranty', action, knexConnection)
    || await hasPermission(user, 'inventory', action, knexConnection);
  if (!allowed) throw new Error(`Permission denied: warranty ${action} required`);
  if (action !== 'read' && !(await hasPermission(user, 'asset', 'update', knexConnection))) {
    throw new Error('Permission denied: asset update required');
  }
}
