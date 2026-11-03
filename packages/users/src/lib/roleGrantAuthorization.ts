import type { Knex } from 'knex';
import User from '@alga-psa/db/models/user';
import { tenantDb } from '@alga-psa/db';

/**
 * Resolve grants from tenant-owned role data and prevent an actor from giving
 * an MSP account permissions the actor does not effectively hold.
 */
export async function assertMspRoleGrantsWithinActorPermissions(
  actorUserId: string,
  tenant: string,
  db: Knex | Knex.Transaction,
  roleIds: string[],
): Promise<void> {
  if (roleIds.length === 0) return;

  const scopedDb = tenantDb(db, tenant);
  const roles = await scopedDb.table('roles')
    .whereIn('role_id', [...new Set(roleIds)])
    .select('role_id', 'msp');
  if (roles.length !== new Set(roleIds).size) {
    throw new Error('Invalid role');
  }
  const mspRoleIds = roles.filter((role) => role.msp).map((role) => role.role_id);
  if (mspRoleIds.length === 0) return;

  const actorRoles = await User.getUserRolesWithPermissions(db, actorUserId);
  const actorPermissions = new Set(
    actorRoles
      .filter((role) => role.msp)
      .flatMap((role) => role.permissions
        .filter((permission) => permission.msp)
        .map((permission) => `${permission.resource}:${permission.action}`)),
  );

  const targetPermissionQuery = scopedDb.table('role_permissions as rp')
    .whereIn('rp.role_id', mspRoleIds)
    .where('p.msp', true)
    .select('rp.role_id', 'p.resource', 'p.action');
  scopedDb.tenantJoin(targetPermissionQuery, 'permissions as p', 'rp.permission_id', 'p.permission_id');
  const targetPermissionRows = await targetPermissionQuery;

  for (const permission of targetPermissionRows) {
    if (!actorPermissions.has(`${permission.resource}:${permission.action}`)) {
      throw new Error('Permission denied: Cannot assign an MSP role with permissions you do not hold');
    }
  }
}
