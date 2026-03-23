const RESOURCE = 'billing.recurring_service_periods';
const ACTIONS = ['view', 'manage_future', 'regenerate', 'correct_history'];
const TARGET_ROLE_NAMES = ['admin', 'manager'];

async function assignPermissionsToRole(knex, tenant, roleId, permissionIds) {
  if (!roleId || permissionIds.length === 0) {
    return;
  }

  const existing = await knex('role_permissions')
    .where({ tenant, role_id: roleId })
    .whereIn('permission_id', permissionIds)
    .select('permission_id');

  const existingIds = new Set(existing.map((row) => row.permission_id));
  const inserts = permissionIds
    .filter((permissionId) => !existingIds.has(permissionId))
    .map((permissionId) => ({
      tenant,
      role_id: roleId,
      permission_id: permissionId,
    }));

  if (inserts.length > 0) {
    await knex('role_permissions').insert(inserts);
  }
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const existingPerms = await knex('permissions')
      .where({ tenant, resource: RESOURCE })
      .select('permission_id', 'action');

    const existingActions = new Set(existingPerms.map((row) => row.action));
    const permissionsToAdd = ACTIONS
      .filter((action) => !existingActions.has(action))
      .map((action) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        resource: RESOURCE,
        action,
        created_at: new Date(),
      }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
    }

    const permissionRows = await knex('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .select('permission_id');
    const permissionIds = permissionRows.map((row) => row.permission_id);

    const roles = await knex('roles')
      .where({ tenant })
      .whereIn(
        knex.raw('LOWER(role_name)'),
        TARGET_ROLE_NAMES,
      )
      .select('role_id', 'role_name');

    for (const role of roles) {
      await assignPermissionsToRole(knex, tenant, role.role_id, permissionIds);
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const permissionRows = await knex('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .select('permission_id');
    const permissionIds = permissionRows.map((row) => row.permission_id);

    if (permissionIds.length === 0) {
      continue;
    }

    await knex('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .delete();

    await knex('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .delete();
  }
};
