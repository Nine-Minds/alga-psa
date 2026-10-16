import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** Authoritative home RBAC, optionally retaining identity/permission rows. */
export async function hasCoManagedLocalPermission(db: Knex, actor: { tenant: string; userId: string },
  resource: string, action: string, lock = false): Promise<boolean> {
  if (lock && !db.isTransaction) throw new Error('Retaining co-management permission locks requires a transaction');
  // LEVERAGE: pattern retained-local-rbac — requester attachment admission uses the same locked grant shape with portal role flags.
  const home = tenantDb(db, actor.tenant);
  const query = home.table('users').where({ 'users.user_id': actor.userId, 'users.user_type': 'internal', 'users.is_inactive': false });
  home.tenantJoin(query, 'user_roles', 'users.user_id', 'user_roles.user_id');
  home.tenantJoin(query, 'roles', 'user_roles.role_id', 'roles.role_id');
  home.tenantJoin(query, 'role_permissions', 'roles.role_id', 'role_permissions.role_id');
  home.tenantJoin(query, 'permissions', 'role_permissions.permission_id', 'permissions.permission_id');
  query.where({ 'roles.msp': true, 'permissions.msp': true, 'permissions.resource': resource, 'permissions.action': action });
  if (lock) query.forShare();
  return Boolean(await query.first('permissions.permission_id'));
}
