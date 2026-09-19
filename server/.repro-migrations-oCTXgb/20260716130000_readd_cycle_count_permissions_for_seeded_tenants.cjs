/**
 * Repair cycle_count permissions for tenants provisioned after the cycle-count
 * table migration ran against an empty database. Mirrors the inventory
 * permission repair migration and is intentionally idempotent.
 */

const RESOURCE = 'cycle_count';
const ACTIONS = ['create', 'read', 'update', 'delete', 'approve'];

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const existing = await knex('permissions')
      .where({ tenant, resource: RESOURCE })
      .select('action');
    const existingActions = new Set(existing.map((permission) => permission.action));
    const permissionsToAdd = ACTIONS
      .filter((action) => !existingActions.has(action))
      .map((action) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        resource: RESOURCE,
        action,
        msp: true,
        client: false,
        description: `${action} ${RESOURCE}`,
        created_at: new Date(),
      }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
    }

    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();
    if (!adminRole) continue;

    const permissions = await knex('permissions')
      .where({ tenant, resource: RESOURCE, msp: true })
      .whereIn('action', ACTIONS)
      .select('permission_id');
    const currentGrants = await knex('role_permissions')
      .where({ tenant, role_id: adminRole.role_id })
      .select('permission_id');
    const grantedIds = new Set(currentGrants.map((grant) => grant.permission_id));
    const grantsToAdd = permissions
      .filter((permission) => !grantedIds.has(permission.permission_id))
      .map((permission) => ({
        tenant,
        role_id: adminRole.role_id,
        permission_id: permission.permission_id,
      }));

    if (grantsToAdd.length > 0) {
      await knex('role_permissions').insert(grantsToAdd);
    }
  }
};

exports.down = async function down() {
  // No-op: rows/grants may have been created by the original migration or seeds.
};
