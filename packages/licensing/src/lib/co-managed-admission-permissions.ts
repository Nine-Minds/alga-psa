import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/**
 * The co-management permissions, written for a sponsor only when it is admitted to the
 * `co-managed` capability and never by a fleet-wide
 * catalog synchronization: the catalog tags them `capabilities: ['co-managed']`, so a
 * plain PSA tenant never receives them. A unit test pins this list to catalog.cjs.
 */
export const CO_MANAGED_PERMISSIONS = [
  { resource: 'co_management', action: 'manage', msp: true, client: false,
    description: 'Manage co-management provisioning and customer-approved scopes' },
  { resource: 'co_management', action: 'read', msp: true, client: false,
    description: 'View co-management relationships and scopes' },
] as const;

/** Role that holds the permissions in a sponsor workspace (catalog `defaultGrants.psa`). */
const SPONSOR_ADMIN_ROLE = { role_name: 'Admin', msp: true, client: false } as const;

/**
 * Seeds the co-management permissions for one sponsor and grants them to its `msp:Admin`
 * role. Idempotent: existing rows and grants are left alone, and no other tenant is touched.
 * Call inside a transaction after the sponsor entitlement lock, so concurrent
 * first admissions and reservations cannot race the insert.
 */
export async function admitCoManagedPermissions(trx: Knex.Transaction, sponsorTenant: string): Promise<void> {
  if (!trx.isTransaction) throw new Error('Co-managed permission admission requires an open transaction');
  const sponsor = tenantDb(trx, sponsorTenant);
  const existing = await sponsor.table('permissions').where({ resource: 'co_management' })
    .select('permission_id', 'action', 'msp', 'client');
  const ids = new Map<string, string>();
  for (const row of existing) if (row.msp && !row.client) ids.set(row.action, row.permission_id);

  const missing = CO_MANAGED_PERMISSIONS.filter(permission => !ids.has(permission.action));
  if (missing.length) {
    const rows = missing.map(permission => ({ tenant: sponsorTenant, permission_id: randomUUID(), ...permission }));
    await sponsor.table('permissions').insert(rows);
    for (const row of rows) ids.set(row.action, row.permission_id);
  }

  // A sponsor without the default Admin role (a customised tenant) still gets the
  // permissions; only the default grant is skipped, which an operator can add by hand.
  const roles = await sponsor.table('roles').where(SPONSOR_ADMIN_ROLE).select('role_id');
  if (roles.length !== 1) return;
  await sponsor.table('role_permissions')
    .insert([...ids.values()].map(permission_id => ({ tenant: sponsorTenant, role_id: roles[0].role_id, permission_id })))
    .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
}
