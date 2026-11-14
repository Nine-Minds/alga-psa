import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { CapabilityKey } from '@alga-psa/core/capability';
import { tenantDb } from '@alga-psa/db';

/**
 * The seat role: what a client's technician holds while working inside the sponsoring MSP's
 * workspace on a co-managed seat. It is the only role a seat technician is given.
 *
 * Operational work only. It carries no sales, billing, accounting, settings or
 * user-administration permission, and it is one of three restrictions on a seat technician,
 * never the only one: the kernel's seat rules and the operational surface apply as well.
 *
 * The role belongs to the `co-managed-seat` capability. It is declared, with this grant list,
 * in the permission catalog's `CAPABILITY_ROLES` (a unit test pins the two together), it is
 * written for a sponsor when its first seat arrangement is admitted and for no other tenant,
 * and the role editor hides it from tenants the capability does not serve
 * (`@alga-psa/auth/lib/permissionCapabilities`).
 */
export const CO_MANAGED_SEAT_ROLE_CAPABILITY: CapabilityKey = 'co-managed-seat';
export const CO_MANAGED_SEAT_ROLE = { role_name: 'Seat Technician', msp: true, client: false } as const;
export const CO_MANAGED_SEAT_ROLE_DESCRIPTION = 'Client technician working this workspace on a co-managed seat';

/** `resource:action` of every MSP-scoped permission the seat role holds. A closed list. */
export const CO_MANAGED_SEAT_ROLE_GRANTS = [
  'asset:read',
  'canned_response:read',
  'client:read',
  'contact:read',
  'document:create',
  'document:read',
  'document:update',
  'project:read',
  'project_task:read',
  'project_task:update',
  'tag:create',
  'tag:read',
  'tag:update',
  'ticket:create',
  'ticket:read',
  'ticket:update',
  'time_entry:create',
  'time_entry:delete',
  'time_entry:read',
  'time_entry:update',
  'time_sheet:read',
  'time_sheet:submit',
  'time_sheet:update',
] as const;

/**
 * Seeds the seat role for one sponsor and returns its id. Idempotent and minimum-state: an
 * existing role is kept, missing grants are added, and nothing is removed. No other tenant is
 * touched and no permission row is written; a grant whose permission the tenant does not have
 * is left to catalog synchronization, which knows this role.
 *
 * Call inside a transaction that holds the sponsor's entitlement lock, as arrangement creation
 * and invitation acceptance do, so concurrent first admissions cannot both insert the role.
 */
export async function admitCoManagedSeatRole(trx: Knex.Transaction, sponsorTenant: string): Promise<string> {
  if (!trx.isTransaction) throw new Error('Seat role admission requires an open transaction');
  const sponsor = tenantDb(trx, sponsorTenant);

  const roles = await sponsor.table('roles').where(CO_MANAGED_SEAT_ROLE).orderBy('created_at').select('role_id');
  let roleId: string | undefined = roles[0]?.role_id;
  if (!roleId) {
    roleId = randomUUID();
    // write-admission: exempt — capability role, written by its owning admission under the pool lock
    await sponsor.table('roles').insert({
      tenant: sponsorTenant, role_id: roleId, ...CO_MANAGED_SEAT_ROLE, description: CO_MANAGED_SEAT_ROLE_DESCRIPTION,
    });
  }

  const wanted = new Set<string>(CO_MANAGED_SEAT_ROLE_GRANTS);
  const permissions = (await sponsor.table('permissions').where({ msp: true, client: false })
    .select('permission_id', 'resource', 'action'))
    .filter((permission: { resource: string; action: string }) => wanted.has(`${permission.resource}:${permission.action}`));
  if (permissions.length) {
    // write-admission: exempt — capability role grants, written by their owning admission under the pool lock
    await sponsor.table('role_permissions')
      .insert(permissions.map((permission: { permission_id: string }) => ({
        tenant: sponsorTenant, role_id: roleId, permission_id: permission.permission_id,
      })))
      .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
  }
  return roleId;
}
