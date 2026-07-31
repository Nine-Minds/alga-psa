import type { Knex } from 'knex';
import type { IUserWithRoles } from '@alga-psa/types';
import { tenantDb } from '@alga-psa/db';

export async function getClientIdFromPortalUser(
  connection: Knex | Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
): Promise<string | null> {
  if (!user.contact_id) return null;
  const contact = await tenantDb(connection, tenant).table('contacts')
    .where({ contact_name_id: user.contact_id })
    .select('client_id')
    .first<{ client_id: string | null }>();
  return contact?.client_id ?? null;
}

export async function hasClientBillingReadPermission(
  connection: Knex | Knex.Transaction,
  user: IUserWithRoles,
  tenant: string,
): Promise<boolean> {
  const scopedDb = tenantDb(connection, tenant);
  const query = scopedDb.table('role_permissions as rp')
    .where({
      'ur.user_id': user.user_id,
      'p.resource': 'billing',
      'p.action': 'read',
    })
    .first();
  scopedDb.tenantJoin(query, 'permissions as p', 'rp.permission_id', 'p.permission_id');
  scopedDb.tenantJoin(query, 'user_roles as ur', 'rp.role_id', 'ur.role_id');
  return Boolean(await query);
}
