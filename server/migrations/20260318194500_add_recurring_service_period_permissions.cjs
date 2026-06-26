const RESOURCE = 'billing.recurring_service_periods';
const ACTIONS = ['view', 'manage_future', 'regenerate', 'correct_history'];
const TARGET_ROLE_NAMES = ['admin', 'manager'];
const MIGRATION_TENANT = 'migration:20260318194500_add_recurring_service_period_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for recurring service period permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

async function assignPermissionsToRole(db, tenant, roleId, permissionIds) {
  if (!roleId || permissionIds.length === 0) {
    return;
  }

  const existing = await db.table('role_permissions')
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
    await db.table('role_permissions').insert(inserts);
  }
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const existingPerms = await db.table('permissions')
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
      await db.table('permissions').insert(permissionsToAdd);
    }

    const permissionRows = await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .select('permission_id');
    const permissionIds = permissionRows.map((row) => row.permission_id);

    const roles = await db.table('roles')
      .where({ tenant })
      .whereIn(
        knex.raw('LOWER(role_name)'),
        TARGET_ROLE_NAMES,
      )
      .select('role_id', 'role_name');

    for (const role of roles) {
      await assignPermissionsToRole(db, tenant, role.role_id, permissionIds);
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) {
    return;
  }

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionRows = await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .select('permission_id');
    const permissionIds = permissionRows.map((row) => row.permission_id);

    if (permissionIds.length === 0) {
      continue;
    }

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .delete();

    await db.table('permissions')
      .where({ tenant, resource: RESOURCE })
      .whereIn('action', ACTIONS)
      .delete();
  }
};
