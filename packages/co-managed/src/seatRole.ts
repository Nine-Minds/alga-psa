import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { CapabilityKey } from '@alga-psa/core/capability';
import { CO_MANAGED_SEAT_ROLE_OWNER_KEY } from '@alga-psa/types';
import { registerManagedRoleIdentity, runAsRoleOwner, tenantDb } from '@alga-psa/db';

/**
 * The seat role: what a client's technician holds while working inside the sponsoring MSP's
 * workspace on a co-managed seat. It is the only role a seat technician is given.
 *
 * Operational work only. It carries no sales, billing, accounting, settings or
 * user-administration permission, and it is one of three restrictions on a seat technician,
 * never the only one: the kernel's seat rules and the operational surface apply as well.
 *
 * The role belongs to the `co-managed-seat` capability, and Alga alone controls it. It is declared,
 * with this grant list, in the permission catalog's `CAPABILITY_ROLES` (a unit test pins the two
 * together), it is written for a sponsor when its first seat arrangement is admitted and for no
 * other tenant, and the role editor hides it from tenants the capability does not serve
 * (`@alga-psa/auth/lib/permissionCapabilities`).
 *
 * Identity is `roles.managed_by = 'co-managed-seat'`, one row per tenant (a partial unique index),
 * never the role's name. The shared guard in `@alga-psa/db` (`managedRoleOwnership`) refuses every
 * write to that role's definition, grants and membership unless it runs inside this capability's
 * lifecycle (`runAsCoManagedSeatLifecycle`: arrangement admission, invitation acceptance,
 * revocation, conversion), and reserves the name against lookalikes.
 */
export const CO_MANAGED_SEAT_ROLE_CAPABILITY: CapabilityKey = 'co-managed-seat';
/** The `roles.managed_by` value of the seat role. */
export const CO_MANAGED_SEAT_ROLE_OWNER = CO_MANAGED_SEAT_ROLE_OWNER_KEY;
export const CO_MANAGED_SEAT_ROLE = { role_name: 'Seat Technician', msp: true, client: false } as const;
export const CO_MANAGED_SEAT_ROLE_DESCRIPTION = 'Client technician working this workspace on a co-managed seat';

// Reserves the identity in every host that loads the seat domain (server, Temporal worker).
registerManagedRoleIdentity({ owner: CO_MANAGED_SEAT_ROLE_OWNER, ...CO_MANAGED_SEAT_ROLE });

/** Runs a seat lifecycle command: its writes to the seat role are the only ones the shared guard admits. */
export function runAsCoManagedSeatLifecycle<T>(fn: () => PromiseLike<T>): Promise<T> {
  return runAsRoleOwner(CO_MANAGED_SEAT_ROLE_OWNER, fn);
}

/** The id of a sponsor's seat role by its stable identity, or undefined before the first admission. */
export async function findCoManagedSeatRoleId(db: Knex | Knex.Transaction, sponsorTenant: string): Promise<string | undefined> {
  const row = await tenantDb(db, sponsorTenant).table('roles').where({ managed_by: CO_MANAGED_SEAT_ROLE_OWNER }).first('role_id');
  return row?.role_id;
}

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
 * Seeds the seat role for one sponsor and returns its id. Idempotent, and the role's grants are
 * exactly `CO_MANAGED_SEAT_ROLE_GRANTS`: missing grants are added and any other grant is removed,
 * so an edit that predates ownership cannot survive admission. No other tenant is touched and no
 * permission row is written; a grant whose permission the tenant does not have is left to catalog
 * synchronization, which knows this role.
 *
 * The role is found by `managed_by`. Where none exists yet, a single unowned role of the same
 * name that nobody holds is adopted (a tenant that created it by hand before ownership existed);
 * anything else with that name is left alone and a new managed role is created. Reconciling
 * tenants that already have seats is the migration's job, which reports what it cannot decide.
 *
 * Call inside a transaction that holds the sponsor's entitlement lock, as arrangement creation
 * and invitation acceptance do, so concurrent first admissions cannot both insert the role.
 */
export async function admitCoManagedSeatRole(trx: Knex.Transaction, sponsorTenant: string): Promise<string> {
  if (!trx.isTransaction) throw new Error('Seat role admission requires an open transaction');
  return await runAsCoManagedSeatLifecycle(async () => {
    const sponsor = tenantDb(trx, sponsorTenant);

    let roleId = await findCoManagedSeatRoleId(trx, sponsorTenant);
    if (!roleId) {
      const lookalikes: Array<{ role_id: string }> = await sponsor.table('roles').where(CO_MANAGED_SEAT_ROLE)
        .whereNull('managed_by').orderBy('created_at').select('role_id');
      const adoptable = lookalikes.length === 1
        && !(await sponsor.table('user_roles').where({ role_id: lookalikes[0].role_id }).first('user_id'));
      if (adoptable) {
        roleId = lookalikes[0].role_id;
        await sponsor.table('roles').where({ role_id: roleId }).update({ managed_by: CO_MANAGED_SEAT_ROLE_OWNER });
      } else {
        roleId = randomUUID();
        // write-admission: exempt — capability role, written by its owning admission under the pool lock
        await sponsor.table('roles').insert({
          tenant: sponsorTenant, role_id: roleId, ...CO_MANAGED_SEAT_ROLE, description: CO_MANAGED_SEAT_ROLE_DESCRIPTION,
          managed_by: CO_MANAGED_SEAT_ROLE_OWNER,
        });
      }
    }
    await sponsor.table('roles').where({ role_id: roleId }).whereRaw('description IS DISTINCT FROM ?', [CO_MANAGED_SEAT_ROLE_DESCRIPTION])
      .update({ description: CO_MANAGED_SEAT_ROLE_DESCRIPTION });

    const wanted = new Set<string>(CO_MANAGED_SEAT_ROLE_GRANTS);
    const permissions = (await sponsor.table('permissions').where({ msp: true, client: false })
      .select('permission_id', 'resource', 'action'))
      .filter((permission: { resource: string; action: string }) => wanted.has(`${permission.resource}:${permission.action}`));
    const wantedIds = permissions.map((permission: { permission_id: string }) => permission.permission_id);
    // write-admission: exempt — capability role grants, reset to the catalog set by their owning admission
    await sponsor.table('role_permissions').where({ role_id: roleId }).whereNotIn('permission_id', wantedIds).del();
    if (permissions.length) {
      // write-admission: exempt — capability role grants, written by their owning admission under the pool lock
      await sponsor.table('role_permissions')
        .insert(permissions.map((permission: { permission_id: string }) => ({
          tenant: sponsorTenant, role_id: roleId, permission_id: permission.permission_id,
        })))
        .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
    }
    return roleId;
  });
}
